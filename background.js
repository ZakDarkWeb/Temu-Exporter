// background.js — Temu Order Tab Exporter v5.0

// ── SheetJS (Style supported version) ─────────────────────────────────────────
let XLSX_LOADED = false;
try {
  // Fix 4: Switched from xlsx.full.min.js to styling-supported xlsx-js-style.js
  importScripts('libs/xlsx-js-style.js');
  XLSX_LOADED = typeof XLSX !== 'undefined';
} catch (e) {
  console.warn('[Temu Exporter] xlsx-js-style failed:', e.message);
}

// ── Constants ──────────────────────────────────────────────────────────────────
const BATCH_SIZE      = 3;    // manual mode batching
const PARALLEL_BATCH  = 1;    // Process tabs one-by-one: more reliable, no retry waste
const MAX_RETRIES     = 3;
const RETRY_DELAY_MS  = 1500;
const TAB_LOAD_TIMEOUT = 30000; // 30s per tab load

// ── Cancel flag — set by cancelExport message, checked in every batch loop ────
let cancelRequested = false;

const EXPORT_COLS = [
  'labelPurchasedDate', 'shippingDate', 'orderDate', 'trackingNumber',
  'orderNumber',  'customerName', 'productDetails', 'qty',
  'estimatedRevenue', 'shippingCost'
];
const EXPORT_HEADERS = [
  'Label Date', 'Shipping Date', 'Order Date', 'Tracking Number',
  'Order No',   'Customer Name', 'Product Details', 'Qty (No)',
  'Est. Revenue', 'Shipping Cost'
];

// ── Utility ────────────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function parseDateStr(str) {
  if (!str) return 0;
  // Strip timezone suffix like "PKT(UTC+5)", "EST", "PST" etc.
  // Temu list shows: "Aug 8, 2026, 4:35 am PKT(UTC+5)"
  // Detail page shows: "Aug 8, 2026, 4:35 am"
  var s = str.trim()
    .replace(/\s+[A-Z]{2,5}(\([^)]*\))?$/i, '') // strip "PKT(UTC+5)" or "EST" at end
    .replace(/\s+/g, ' ')
    .replace(/(\d+:\d+)\s*(am|pm)/i, '$1 $2');   // ensure space before am/pm

  // Try direct parse
  var d = new Date(s);
  if (!isNaN(d.getTime())) return d.getTime();

  // Manual parse for "Aug 8, 2026, 4:35 am" format
  var m = s.match(/^([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4}),?\s*(\d{1,2}):(\d{2})\s*(am|pm)$/i);
  if (m) {
    var months = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
    var mo = months[m[1].toLowerCase()];
    var dy = parseInt(m[2]);
    var yr = parseInt(m[3]);
    var hr = parseInt(m[4]) % 12 + (m[6].toLowerCase() === 'pm' ? 12 : 0);
    var mn = parseInt(m[5]);
    if (mo !== undefined) return new Date(yr, mo, dy, hr, mn).getTime();
  }

  // Fallback: strip time and parse date only
  var dateOnly = s.replace(/,\s*\d+:\d+\s*(am|pm)?/i, '').trim();
  var d2 = new Date(dateOnly);
  return isNaN(d2.getTime()) ? 0 : d2.getTime();
}

function isDateInRange(dateStr, from, to) {
  // dateStr: e.g. "Aug 5, 2026, 2:24 am" (purchaseDateRaw — local time)
  // from/to: "YYYY-MM-DDTHH:MM" (datetime-local — treated as local time by JS)
  const time = parseDateStr(dateStr);
  if (!time) return false;
  const fromTime = from ? new Date(from).getTime() : 0;
  const toTime   = to   ? new Date(to).getTime()   : Infinity;
  return time >= fromTime && time <= toTime;
}

function sendMsg(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {});
  // Also persist state so popup can restore it after being reopened
  saveState(msg);
}

// ── Persist export state to session storage ───────────────────────────────────
function saveState(msg) {
  let patch = { lastMsg: msg };
  if (msg.type === 'autoProgress' || msg.type === 'progress') {
    patch.running = true;
  } else if (msg.type === 'autoDone' || msg.type === 'done' ||
             msg.type === 'error'    || msg.type === 'noData') {
    patch.running = false;
  }
  chrome.storage.session.set(patch).catch(() => {});
}

function clearState() {
  chrome.storage.session.set({ running: false, lastMsg: null }).catch(() => {});
}

// ── Message router ─────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'startExport')     runExport(msg.format || 'csv');
  if (msg.type === 'startAutoExport') runAutoExport(
    msg.listTabId, msg.fromPage, msg.toPage, msg.format || 'csv',
    msg.tabDelay  ?? 1000,
    msg.randExtra ?? 1000,
    msg.filterEnabled  || false,
    msg.filterFromDate || '',
    msg.filterToDate   || ''
  );
  // ── Mode 2: Date Range export ─────────────────────────────────────────────────
  if (msg.type === 'startDateExport') runDateExport(
    msg.listTabId, msg.fromDate, msg.toDate, msg.format || 'csv',
    msg.tabDelay  ?? 1000,
    msg.randExtra ?? 1000,
    msg.maxPages  || 999,
    false /* sheetsMode */
  );
  // ── Mode 4: Sheets Sync — scan by date, store rows in session, popup copies to clipboard ──
  if (msg.type === 'startSheetsSync') runDateExport(
    msg.listTabId, msg.fromDate, msg.toDate, 'csv',
    msg.tabDelay  ?? 1200,
    msg.randExtra ?? 800,
    msg.maxPages  || 999,
    true /* sheetsMode */
  );
  // ── Mode 3: Selection export ──────────────────────────────────────────────────
  if (msg.type === 'startSelectionExport') runSelectionExport(
    msg.selectedUrls, msg.format || 'csv',
    msg.tabDelay  ?? 1000,
    msg.randExtra ?? 1000
  );
  // ── Cancel running export ────────────────────────────────────────────────────
  if (msg.type === 'cancelExport') {
    cancelRequested = true;
    clearState();
    chrome.action.setBadgeText({ text: '' }).catch(() => {}); // clear badge on cancel
    sendMsg({ type: 'cancelled' });
  }
  // ── History: re-download a past export ───────────────────────────────────────
  if (msg.type === 'downloadFromHistory') {
    try {
      const { dataUrl, filename } = generateExport(msg.rows, msg.rows.length, msg.format || 'xlsx');
      chrome.downloads.download({ url: dataUrl, filename });
    } catch (e) {
      sendMsg({ type: 'error', message: 'History download failed: ' + e.message });
    }
  }
  // Popup asking for current state on open
  if (msg.type === 'getState') {
    chrome.storage.session.get(['running', 'lastMsg'], (data) => {
      chrome.runtime.sendMessage({ type: 'stateSnapshot', ...data }).catch(() => {});
    });
  }
  // ── Status Tracker: check delivery status for a list of order URLs ──────────
  if (msg.type === 'startStatusCheck') {
    runStatusCheck(msg.orderUrls || []).catch(e => {
      sendMsg({ type: 'error', message: 'Status check failed: ' + e.message });
    });
  }
  // ── Content Script: Quick Export Today (from in-page floating panel) ─────────
  if (msg.type === 'quickExport' || msg.type === 'quickSheetsSync') {
    const sheetsMode = msg.type === 'quickSheetsSync';
    // Find the active seller.temu.com tab to use as listTabId
    chrome.tabs.query({ url: 'https://seller.temu.com/*', active: true }, async (tabs) => {
      let listTab = tabs[0];
      if (!listTab) {
        // Fall back to any seller tab
        const allTabs = await chrome.tabs.query({ url: 'https://seller.temu.com/*' });
        listTab = allTabs[0];
      }
      if (!listTab) {
        sendMsg({ type: 'error', message: 'No Temu seller tab found. Please navigate to seller.temu.com first.' });
        return;
      }
      const fromDate = msg.fromDate || (() => { const d = new Date(); d.setHours(0,0,0,0); return d.toISOString(); })();
      const toDate   = msg.toDate   || new Date().toISOString();
      runDateExport(
        listTab.id,
        fromDate,
        toDate,
        'xlsx',
        1200,  // tabDelay
        800,   // randExtra
        999,   // maxPages
        sheetsMode
      ).catch(e => sendMsg({ type: 'error', message: 'Quick export failed: ' + e.message }));
    });
  }
});


// ── Status Tracker ─────────────────────────────────────────────────────────────
//   Opens each order detail page in a hidden tab, reads delivery status, closes it.
//   DOM selectors confirmed from live seller.temu.com/order-detail.html page.

async function runStatusCheck(orderUrls) {
  if (!orderUrls || orderUrls.length === 0) {
    sendMsg({ type: 'statusCheckReady', results: [], error: 'No order URLs provided.' });
    return;
  }
  sendMsg({ type: 'statusProgress', done: 0, total: orderUrls.length });

  const results = [];
  for (let i = 0; i < orderUrls.length; i++) {
    const url = orderUrls[i];
    let tab;
    try {
      tab = await chrome.tabs.create({ url, active: false });
      // Wait for page to load
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('timeout')), 15000);
        function onUpdated(tabId, info) {
          if (tabId === tab.id && info.status === 'complete') {
            clearTimeout(timeout);
            chrome.tabs.onUpdated.removeListener(onUpdated);
            resolve();
          }
        }
        chrome.tabs.onUpdated.addListener(onUpdated);
      });
      // Small settle delay for React rendering
      await new Promise(r => setTimeout(r, 800));

      // Extract status from page
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: function() {
          function txt(sel, fallback) {
            const el = document.querySelector(sel);
            return el ? el.textContent.trim() : (fallback || '');
          }
          // Order ID from breadcrumb / page title area
          const orderId   = txt('._2k6GgcRG ._1KnTNdCB span') || txt('._2k6GgcRG span:last-child') || '';
          // Product name
          const product   = txt('._3A964f3j') || txt('._1NCZ7KPp .elli_outerWrapper_123') || '';
          // Tracking number
          const tracking  = txt('._2GydpeUD ._1KnTNdCB span') || '';
          // Main delivery status (e.g. "Shipped", "Waiting for pickup")
          const statusMain = txt('._2Vn1-Twz._24ZwUHjY') || txt('._2mobrKj6') || '';
          // Package-level status
          const pkgStatus  = txt('._2mobrKj6._zuJsGkxq') || txt('._2mobrKj6') || '';
          // Latest timeline event text
          const timelineEvent = txt('._dHI0jzvQ ._2-A9xoFi div') || txt('.TLE_itemDotDefault_123._TLE_itemDotDefaultCurrent_123 ~ .TLE_itemBody_123 .TLE_itemTitle_123') || '';
          // Latest timeline date
          const timelineDate = txt('._2UwizOIL') || txt('._1ZFc1gJB') || '';
          // Courier name
          const courier = txt('._2OTvT66D') || '';
          return {
            orderId:   orderId.replace(/\s+/g, ' ').trim(),
            product:   product.slice(0, 50),
            tracking:  tracking || '',
            status:    pkgStatus || statusMain || 'Unknown',
            lastEvent: timelineEvent.slice(0, 60),
            lastDate:  timelineDate,
            courier:   courier
          };
        }
      });
      if (result && result.result) {
        results.push({ url, ...result.result });
      } else {
        results.push({ url, orderId: url.split('parent_order_sn=')[1]?.split('&')[0] || '?', status: 'Read Failed', tracking: '', lastEvent: '', lastDate: '', product: '', courier: '' });
      }
    } catch (e) {
      results.push({ url, orderId: '?', status: 'Error: ' + e.message.slice(0, 30), tracking: '', lastEvent: '', lastDate: '', product: '', courier: '' });
    } finally {
      if (tab) chrome.tabs.remove(tab.id).catch(() => {});
    }
    sendMsg({ type: 'statusProgress', done: i + 1, total: orderUrls.length });
    // Small gap between tabs
    if (i < orderUrls.length - 1) await new Promise(r => setTimeout(r, 600));
  }

  // Store results in session and notify popup
  await chrome.storage.session.set({ statusCheckResults: JSON.stringify(results) }).catch(() => {});
  sendMsg({ type: 'statusCheckReady', count: results.length });
}


// ═══════════════════════════════════════════════════════════════════════════════
// MODE 1 — Manual: export open order-detail tabs
// ═══════════════════════════════════════════════════════════════════════════════

async function runExport(format) {
  const tabs      = await chrome.tabs.query({ url: 'https://seller.temu.com/*' });
  const orderTabs = tabs.filter(t => t.url && t.url.includes('order-detail'));

  if (orderTabs.length === 0) {
    sendMsg({ type: 'error', message: 'No open Temu order-detail tabs found.' });
    return;
  }

  const orderRecords = [], failedTabs = [], seenIds = new Set();
  const totalTabs = orderTabs.length;
  let processedCount = 0;

  for (let i = 0; i < totalTabs; i += BATCH_SIZE) {
    const batch   = orderTabs.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(batch.map(t => processTabWithRetry(t)));

    results.forEach((r, idx) => {
      if (r.status === 'fulfilled') {
        const res = r.value;
        if (res.ok && res.data) {
          const key = res.data.orderNumber || `__noid_${orderRecords.length}`;
          if (!seenIds.has(key)) { seenIds.add(key); orderRecords.push(res.data); }
        } else if (!res.ok) failedTabs.push(batch[idx]?.url || '?');
      } else failedTabs.push(batch[idx]?.url || '?');
    });

    processedCount += batch.length;
    sendMsg({ type: 'progress', current: processedCount, total: totalTabs, failed: failedTabs.length });
  }

  if (orderRecords.length === 0) {
    sendMsg({ type: 'noData', failedCount: failedTabs.length });
    return;
  }

  const flatRows = flattenToRows(orderRecords);
  sortRows(flatRows);

  try {
    const { dataUrl, filename } = generateExport(flatRows, orderRecords.length, format);
    chrome.downloads.download({ url: dataUrl, filename });
    sendMsg({ type: 'done', ordersFound: orderRecords.length, tabsProcessed: totalTabs,
              rowsExported: flatRows.length, failedCount: failedTabs.length,
              failedUrls: failedTabs.slice(0, 10), format });
  } catch (err) {
    sendMsg({ type: 'error', message: `Export failed: ${err.message}` });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODE 2 — Auto: paginate list page → collect URLs → extract → export
// ═══════════════════════════════════════════════════════════════════════════════

async function runAutoExport(listTabId, fromPage, toPage, format, tabDelay = 1000, randExtra = 1000,
                             filterEnabled = false, filterFromDate = '', filterToDate = '') {
  cancelRequested = false; // reset cancel flag
  const totalPages   = toPage - fromPage + 1;
  const allOrderUrls = [];

  // ── Phase 1: Collect order URLs by paginating the list ─────────────────────
  try {
    if (fromPage > 1) {
      sendMsg({ type: 'autoProgress', stage: 'navigating', page: fromPage, totalPages, scraped: 0 });
      await navigateListToPage(listTabId, fromPage);
      await sleep(3000);
    }

    for (let page = fromPage; page <= toPage; page++) {
      if (cancelRequested) return;
      sendMsg({ type: 'autoProgress', stage: 'scraping', page, totalPages, scraped: allOrderUrls.length });
      await sleep(700);

      const links = await getOrderLinksFromListTab(listTabId);
      links.forEach(l => { if (!allOrderUrls.includes(l)) allOrderUrls.push(l); });

      if (page < toPage) {
        const prevFirst = links[0] || null;
        const clicked   = await navigateNextOnList(listTabId);
        if (!clicked) {
          sendMsg({ type: 'autoProgress', stage: 'scraping', page: toPage, totalPages, scraped: allOrderUrls.length, note: 'No more pages found' });
          break;
        }
        await sleep(1500);
        await waitForListPageChange(listTabId, prevFirst);
        await sleep(800);
      }
    }
  } catch (err) {
    console.error('Auto-export scraping phase failed:', err);
    sendMsg({ type: 'error', message: `Page scraping failed: ${err.message}` });
    return;
  }

  if (allOrderUrls.length === 0) {
    sendMsg({ type: 'noData', failedCount: 0 });
    return;
  }

  // ── Phase 2+: Shared batch + retry + export ────────────────────────────────
  await _processBatchAndExport(
    allOrderUrls, format, tabDelay, randExtra,
    filterEnabled, filterFromDate, filterToDate,
    totalPages, null /* no labelDateMap for By Pages mode */
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODE 2b — Date Range Export: scan list pages, extract only date-matched orders
// ═══════════════════════════════════════════════════════════════════════════════

async function runDateExport(listTabId, fromDate, toDate, format, tabDelay = 1000, randExtra = 1000, maxPages = 999, sheetsMode = false) {
  cancelRequested = false; // reset cancel flag
  const fromTs = fromDate ? new Date(fromDate).getTime() : 0;
  const toTs   = toDate   ? new Date(toDate).getTime()   : Infinity;

  // ── BUG 4 FIX: Navigate to page 1 before scanning ─────────────────────────
  sendMsg({ type: 'autoProgress', stage: 'navigating', page: 1, totalPages: maxPages, scraped: 0 });
  try {
    await navigateListToPage(listTabId, 1);
    await sleep(2000);
  } catch(e) { /* ignore — page might already be at page 1 */ }

  const allOrderUrls = [];
  const labelDateMap = {}; // url → dateStr (for export column)

  // ── Phase 1: Scan pages, read label dates, collect matching URLs ──────────
  try {
    let page = 1;
    let noDatePageCount = 0; // BUG 5 FIX: track pages with zero label dates

    while (true) {
      if (cancelRequested) return;
      sendMsg({ type: 'autoProgress', stage: 'scraping', page, totalPages: maxPages,
                scraped: allOrderUrls.length });

      await sleep(700);

      const [{ result: pageData }] = await chrome.scripting.executeScript({
        target: { tabId: listTabId },
        func: function() {
          var baseUrl = window.location.origin + '/order-detail.html';
          var rows = [];
          document.querySelectorAll('tr').forEach(function(tr) {
            if (tr.querySelector('th')) return;
            var text = tr.textContent || '';
            var snMatch = text.match(/(PO-\d+-\d{9,})/);
            if (!snMatch) return;
            var sn = snMatch[1];
            // Label purchased date: "Label purchased: Aug 15, 2026, 12:09 am PKT"
            var labelMatch = text.match(/Label purchased:\s*([A-Za-z]{3}\s+\d{1,2},\s*\d{4},\s*\d{1,2}:\d{2}\s*(?:am|pm))/i);
            var dateStr = labelMatch ? labelMatch[1].trim() : '';
            var url = baseUrl + '?parent_order_sn=' + encodeURIComponent(sn);
            rows.push({ sn, url, dateStr });
          });
          return rows;
        }
      });

      if (!pageData || pageData.length === 0) break;

      let allOlderThanFrom = true;
      let hasAnyDate = false;

      pageData.forEach(function(row) {
        var rowTs = parseDateStr(row.dateStr);
        if (rowTs > 0) {
          hasAnyDate = true;
          if (rowTs >= fromTs && rowTs <= toTs) {
            if (!allOrderUrls.includes(row.url)) {
              allOrderUrls.push(row.url);
              labelDateMap[row.url] = row.dateStr; // store for export column
            }
          }
          if (rowTs >= fromTs) allOlderThanFrom = false;
        }
      });

      // BUG 5 FIX: Track consecutive pages with no label dates at all
      if (!hasAnyDate) {
        noDatePageCount++;
        if (noDatePageCount >= 5) {
          sendMsg({ type: 'autoProgress', stage: 'scraping', page, totalPages: page,
                    scraped: allOrderUrls.length, note: '5 consecutive pages with no label dates — stopping' });
          break;
        }
      } else {
        noDatePageCount = 0; // reset counter when dates are found
      }

      // Smart early exit: all label dates on this page are older than FROM date
      if (hasAnyDate && allOlderThanFrom) {
        sendMsg({ type: 'autoProgress', stage: 'scraping', page, totalPages: page,
                  scraped: allOrderUrls.length, note: 'Early exit — all labels older than date range' });
        break;
      }

      if (page >= maxPages) {
        sendMsg({ type: 'autoProgress', stage: 'scraping', page, totalPages: maxPages,
                  scraped: allOrderUrls.length, note: `Stopped at page ${maxPages} (user limit)` });
        break;
      }

      const prevFirst = pageData[0] ? pageData[0].url : null;
      const clicked = await navigateNextOnList(listTabId);
      if (!clicked) break;
      await sleep(1500);
      await waitForListPageChange(listTabId, prevFirst);
      await sleep(800);
      page++;
    }
  } catch (err) {
    sendMsg({ type: 'error', message: `Date scan failed: ${err.message}` });
    return;
  }

  if (allOrderUrls.length === 0) {
    sendMsg({ type: 'noData', failedCount: 0 });
    return;
  }

  // ── Phase 2+: Batch extract + retry + export ───────────────────────────────
  await _processBatchAndExport(
    allOrderUrls, format, tabDelay, randExtra,
    false, '', '', maxPages, labelDateMap, sheetsMode
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODE 3 — Selection Export: process only user-selected orders
// ═══════════════════════════════════════════════════════════════════════════════

async function runSelectionExport(selectedUrls, format, tabDelay = 1000, randExtra = 1000) {
  cancelRequested = false;
  if (!selectedUrls || selectedUrls.length === 0) {
    sendMsg({ type: 'noData', failedCount: 0 });
    return;
  }
  await _processBatchAndExport(selectedUrls, format, tabDelay, randExtra, false, '', '', selectedUrls.length, null);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHARED: Parallel batch processing + retry queue + export (used by all modes)
// ═══════════════════════════════════════════════════════════════════════════════

async function _processBatchAndExport(allOrderUrls, format, tabDelay, randExtra,
                                       filterEnabled, filterFromDate, filterToDate,
                                       totalPagesLabel, labelDateMap, sheetsMode = false) {
  const orderRecords = [], retryQueue = [], seenIds = new Set();
  const total = allOrderUrls.length;
  let failedCount = 0;

  function recordOrder(data, sourceUrl) {
    if (!data) return false;
    const key = data.orderNumber || `__noid_${orderRecords.length}`;
    if (seenIds.has(key)) return false;
    let passesFilter = true;
    if (filterEnabled && filterFromDate && filterToDate) {
      const dateForFilter = data.purchaseDateRaw || data.purchaseDate;
      passesFilter = isDateInRange(dateForFilter, filterFromDate, filterToDate);
    }
    if (passesFilter) {
      // IMP 6: Attach label date from list-page scan if available
      if (labelDateMap && sourceUrl && labelDateMap[sourceUrl]) {
        data.labelPurchasedDate = labelDateMap[sourceUrl];
      }
      seenIds.add(key);
      orderRecords.push(data);
      return true;
    }
    return false;
  }

  for (let i = 0; i < total; i += PARALLEL_BATCH) {
    if (cancelRequested) break; // IMP 4: check cancel flag
    const batchUrls = allOrderUrls.slice(i, i + PARALLEL_BATCH);
    // IMP 5: include live extracted/failed counts
    sendMsg({ type: 'autoProgress', stage: 'extracting', current: i, total,
              extracted: orderRecords.length, failed: failedCount,
              totalPages: totalPagesLabel, retrying: 0, retryTotal: 0 });

    const openResults = await Promise.allSettled(
      batchUrls.map(url => chrome.tabs.create({ url, active: false }))
    );
    const openTabs = [];
    openResults.forEach((r, idx) => {
      if (r.status === 'fulfilled') openTabs.push({ tab: r.value, url: batchUrls[idx] });
      else { retryQueue.push(batchUrls[idx]); failedCount++; }
    });

    await Promise.allSettled(openTabs.map(({ tab }) => waitForTabLoad(tab.id)));
    await sleep(500);

    const extractResults = await Promise.allSettled(
      openTabs.map(({ tab }) => processTabWithRetry(tab))
    );
    extractResults.forEach((r, idx) => {
      const { url } = openTabs[idx];
      if (r.status === 'fulfilled' && r.value.ok && r.value.data) {
        if (!recordOrder(r.value.data, url)) failedCount++;
      } else {
        retryQueue.push(url);
        failedCount++;
      }
    });

    await Promise.allSettled(openTabs.map(({ tab }) => chrome.tabs.remove(tab.id).catch(() => {})));
    if (i + PARALLEL_BATCH < total) await sleep(tabDelay + Math.floor(Math.random() * randExtra));
  }

  // Retry queue
  const permanentFails = [];
  if (!cancelRequested && retryQueue.length > 0) {
    for (let ri = 0; ri < retryQueue.length; ri++) {
      if (cancelRequested) break;
      const url = retryQueue[ri];
      sendMsg({ type: 'autoProgress', stage: 'retrying', current: orderRecords.length, total,
                extracted: orderRecords.length, failed: permanentFails.length,
                retrying: ri + 1, retryTotal: retryQueue.length, totalPages: totalPagesLabel });
      let retryTab;
      try { retryTab = await chrome.tabs.create({ url, active: false }); }
      catch(e) {
        try { permanentFails.push(new URL(url).searchParams.get('parent_order_sn') || url); } catch(_) { permanentFails.push(url); }
        continue;
      }
      await waitForTabLoad(retryTab.id);
      const retryResult = await processTabWithRetry(retryTab);
      if (retryResult.ok && retryResult.data) {
        recordOrder(retryResult.data, url);
      } else {
        try { permanentFails.push(new URL(url).searchParams.get('parent_order_sn') || url); }
        catch(_) { permanentFails.push(url); }
      }
      await chrome.tabs.remove(retryTab.id).catch(() => {});
      await sleep(2000 + Math.floor(Math.random() * 2000));
    }
  }

  if (orderRecords.length === 0) {
    sendMsg({ type: 'noData', failedCount: permanentFails.length });
    return;
  }

  const flatRows = flattenToRows(orderRecords);
  sortRows(flatRows);
  try {
    if (sheetsMode) {
      // ── SHEETS MODE: store rows in session — popup reads + copies to clipboard ──────
      const rowsJson = JSON.stringify(flatRows);
      await chrome.storage.session.set({ sheetsSyncRows: rowsJson, sheetsSyncOrderCount: orderRecords.length });

      // Chrome badge: show order count in green
      chrome.action.setBadgeText({ text: String(orderRecords.length) }).catch(() => {});
      chrome.action.setBadgeBackgroundColor({ color: '#10b981' }).catch(() => {});

      // Chrome notification
      chrome.notifications.create('temu_sheets_done', {
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: 'Temu Exporter — Labels Synced! ✅',
        message: `${orderRecords.length} orders ready. Open extension → Click “Copy to Clipboard” → Ctrl+V in Sheets.`
      });

      sendMsg({
        type: 'sheetsSyncReady',
        ordersFound:  orderRecords.length,
        rowsExported: flatRows.length,
        failedCount:  permanentFails.length,
        failedOrders: permanentFails.slice(0, 20),
        pagesScraped: totalPagesLabel
      });
    } else {
      // ── NORMAL MODE: download file ─────────────────────────────────────────────────
      const { dataUrl, filename } = generateExport(flatRows, orderRecords.length, format);
      chrome.downloads.download({ url: dataUrl, filename });

      // badge: show count briefly
      chrome.action.setBadgeText({ text: String(orderRecords.length) }).catch(() => {});
      chrome.action.setBadgeBackgroundColor({ color: '#6366f1' }).catch(() => {});
      setTimeout(() => chrome.action.setBadgeText({ text: '' }).catch(() => {}), 30000);

      sendMsg({
        type: 'autoDone', ordersFound: orderRecords.length, rowsExported: flatRows.length,
        failedCount: permanentFails.length, failedOrders: permanentFails.slice(0, 20),
        pagesScraped: totalPagesLabel, filterEnabled, filterFromDate, filterToDate, format
      });
    }
  } catch (err) {
    sendMsg({ type: 'error', message: `Export generation failed: ${err.message}` });
  }
}


async function navigateListToPage(tabId, pageNum) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func:   function(targetPage) {
      // Strategy 1: Click visible page number button (Temu beast-core & standard classes)
      var items = document.querySelectorAll(
        'li.PGT_pagerItem_123, [class*="PGT_pagerItem"], li[class*="pagerItem"], li.ant-pagination-item, [class*="pagination-item"], [class*="page-item"]'
      );
      for (var i = 0; i < items.length; i++) {
        if (items[i].textContent.trim() === String(targetPage)) {
          items[i].scrollIntoView({ block: 'center', inline: 'nearest' });
          items[i].click();
          return;
        }
      }

      // Strategy 2: Ant Design / custom quick-jumper input
      var jumper =
        document.querySelector('.ant-pagination-options-quick-jumper input') ||
        document.querySelector('input[class*="jumper"]') ||
        document.querySelector('input[class*="page-size"]');

      // Also search for an input near "Go to" text
      if (!jumper) {
        var inputs = document.querySelectorAll('input[type="number"], input[type="text"]');
        inputs.forEach(function(inp) {
          var parent = inp.parentElement;
          if (parent && /go\s*to|jump|page/i.test(parent.textContent)) jumper = inp;
        });
      }

      if (jumper) {
        jumper.focus();
        var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(jumper, String(targetPage));
        ['input', 'change'].forEach(function(ev) {
          jumper.dispatchEvent(new Event(ev, { bubbles: true }));
        });
        [13].forEach(function(code) {
          ['keydown','keypress','keyup'].forEach(function(ev) {
            jumper.dispatchEvent(new KeyboardEvent(ev, { keyCode: code, key: 'Enter', bubbles: true }));
          });
        });
        return;
      }
    },
    args: [pageNum]
  });
}

// ── Click the "Next Page" button on the list ───────────────────────────────────
// Uses Temu's actual beast-core pagination selectors (confirmed from DOM)
async function navigateNextOnList(tabId) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func:   function() {
        try {
          function isDisabled(el) {
            if (!el) return true;
            if (el.disabled) return true;
            if (el.getAttribute('aria-disabled') === 'true') return true;
            var cls = el.className || '';
            // Temu uses PGT_disabled_123 on the next button when on last page
            if (/disabled/i.test(cls)) return true;
            return false;
          }

          // ── Strategy 1: Temu's specific data-testid (most reliable) ──────────
          var next = document.querySelector('[data-testid="beast-core-pagination-next"]');
          if (next && !isDisabled(next)) {
            next.scrollIntoView({ block: 'center', inline: 'nearest' });
            next.click();
            return true;
          }

          // ── Strategy 2: Temu's PGT class ─────────────────────────────────────
          next = document.querySelector('li.PGT_next_123');
          if (next && !isDisabled(next)) {
            next.scrollIntoView({ block: 'center', inline: 'nearest' });
            next.click();
            return true;
          }

          // ── Strategy 3: aria-label fallback ──────────────────────────────────
          next = document.querySelector('[aria-label="Next Page"]:not([disabled])') ||
                 document.querySelector('[aria-label="next page"]:not([disabled])');
          if (next && !isDisabled(next)) {
            next.scrollIntoView({ block: 'center', inline: 'nearest' });
            next.click();
            return true;
          }

          // ── Strategy 4: ant-design pagination (legacy fallback) ───────────────
          next = document.querySelector('li.ant-pagination-next:not(.ant-pagination-disabled) button') ||
                 document.querySelector('li.ant-pagination-next:not(.ant-pagination-disabled)');
          if (next && !isDisabled(next)) {
            next.click();
            return true;
          }

          // ── Strategy 5: any li/button with › or > text that looks like next ──
          var allEls = Array.from(document.querySelectorAll('li[data-testid], li[class*="PGT"], li[class*="pager"]'));
          var candidate = allEls.find(function(el) {
            if (isDisabled(el)) return false;
            var txt = (el.textContent || '').trim();
            var testId = el.getAttribute('data-testid') || '';
            return testId.includes('next') || txt === '>' || txt === '›' || txt === '»';
          });
          if (candidate) {
            candidate.scrollIntoView({ block: 'center', inline: 'nearest' });
            candidate.click();
            return true;
          }

          return false;
        } catch(e) { return false; }
      }
    });
    return result === true;
  } catch(err) {
    console.warn('[Temu Exporter] navigateNextOnList failed:', err.message);
    return false;
  }
}

// ── Scrape order-detail URLs from the current list page ────────────────────────
async function getOrderLinksFromListTab(tabId) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func:   function() {
        try {
          var links = [], seen = new Set();
          var baseUrl = window.location.origin + '/order-detail.html';

          // Strategy 1: Find any direct anchor links
          document.querySelectorAll('a[href*="order-detail"]').forEach(function(a) {
            var href = a.href;
            if (href && href.includes('parent_order_sn') && !seen.has(href)) {
              seen.add(href); links.push(href);
            }
          });

          // Strategy 2: Extract PO numbers from table rows
          if (links.length === 0) {
            document.querySelectorAll('tr').forEach(function(tr) {
              if (tr.querySelector('th')) return;
              var text = tr.textContent || '';
              var m = text.match(/(PO-\d+-\d{8,})/);
              if (m && !seen.has(m[1])) {
                seen.add(m[1]);
                links.push(baseUrl + '?parent_order_sn=' + encodeURIComponent(m[1]));
              }
            });
          }

          // Strategy 3: Global body search fallback
          if (links.length === 0) {
            var bt = document.body ? (document.body.innerText || '') : '';
            var allM = bt.match(/PO-\d+-\d{8,}/g) || [];
            allM.forEach(function(po) {
              if (!seen.has(po)) {
                seen.add(po);
                links.push(baseUrl + '?parent_order_sn=' + encodeURIComponent(po));
              }
            });
          }

          return links;
        } catch(e) { return []; }
      }
    });
    return result || [];
  } catch(err) {
    console.warn('[Temu Exporter] getOrderLinksFromListTab failed:', err.message);
    return [];
  }
}

// ── Wait until list page shows different orders (page change detected) ─────────
async function waitForListPageChange(tabId, previousFirstUrl) {
  async function getCurrentOrderIds() {
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: function() {
          var ids = [];
          document.querySelectorAll('tr').forEach(function(tr) {
            if (tr.querySelector('th')) return;
            var text = tr.textContent || '';
            var m = text.match(/(PO-\d+-\d{8,})/);
            if (m) ids.push(m[1]);
          });
          if (ids.length === 0) {
            var bt = document.body ? (document.body.innerText || '') : '';
            ids = bt.match(/PO-\d+-\d{8,}/g) || [];
          }
          return ids.join(',');
        }
      });
      return result || '';
    } catch(e) { return ''; }
  }

  const prevIds = await getCurrentOrderIds();

  for (let attempt = 0; attempt < 30; attempt++) {
    await sleep(400);
    const currIds = await getCurrentOrderIds();
    // Page changed if new order IDs appeared and list is not empty
    if (currIds && prevIds && currIds !== prevIds) return;
  }
}

// ── Wait for a tab to finish loading ──────────────────────────────────────────
function waitForTabLoad(tabId) {
  return new Promise(resolve => {
    // Bug fix: check if tab is already complete BEFORE adding listener
    // Without this, if tab loads before listener is added, we wait 30s for nothing
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || !tab) { resolve(); return; }
      if (tab.status === 'complete') { resolve(); return; }
      // Tab still loading — add listener
      const onUpdated = (id, info) => {
        if (id === tabId && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(onUpdated);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(onUpdated);
      setTimeout(() => { chrome.tabs.onUpdated.removeListener(onUpdated); resolve(); }, TAB_LOAD_TIMEOUT);
    });
  });
}

// ── Wait for React to render the product table ─────────────────────────────────
// Polls via executeScript every 400ms until Goods ID or Purchase date appears.
// This runs in background.js (not in the page) — no serialization issues.
async function waitForPageReady(tabId, maxMs = 10000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: function() {
          // Primary: product table has loaded (Goods ID / SKU ID in tbody)
          var tbodies = document.querySelectorAll('tbody');
          for (var i = 0; i < tbodies.length; i++) {
            var t = tbodies[i].textContent || '';
            if (t.includes('Goods ID:') || t.includes('SKU ID:')) return 'products_ready';
          }
          // Secondary: purchase info visible (catches orders with no product table)
          var body = document.body ? (document.body.innerText || '') : '';
          if (body.includes('Purchase date') && body.includes('Recipient name')) return 'info_ready';
          return false;
        }
      });
      if (result) return; // page is ready — proceed
    } catch(e) { /* tab still loading — ignore */ }
    await sleep(400);
  }
  // Timed out after 10s — proceed anyway with whatever is on the page
}

// ── Single tab processor with retry ───────────────────────────────────────────
async function processTabWithRetry(tab, attempt = 0) {
  // Fix 3: Abort early if the tab has been closed by the user
  try {
    await chrome.tabs.get(tab.id);
  } catch (e) {
    return { ok: false, tabUrl: tab.url || 'Tab closed by user' };
  }

  try {
    // Wait for React to render before injecting extractor
    await waitForPageReady(tab.id);

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func:   extractPageData
    });
    // Log null results so DevTools shows which orders had no data
    if (!result) {
      console.warn('[Temu Exporter] extractPageData returned null for tab', tab.id, tab.url);
    }
    return { ok: true, data: result || null };
  } catch (err) {
    if (attempt < MAX_RETRIES) {
      await sleep(RETRY_DELAY_MS * (attempt + 1));
      return processTabWithRetry(tab, attempt + 1);
    }
    console.error(`[Temu Exporter] Tab ${tab.id} failed after ${MAX_RETRIES} retries:`, err.message, tab.url);
    return { ok: false, tabUrl: tab.url || `Tab ID ${tab.id}` };
  }
}

// ── Flatten orders: one row per package × product ──────────────────────────────
function flattenToRows(orderRecords) {
  const rows = [];
  orderRecords.forEach(order => {
    // ── Skip orders with no meaningful data (prevents empty/partial rows) ────
    if (!order) return;
    if (!order.orderNumber && !order.recipientName && (!order.products || order.products.length === 0)) return;

    const packages = (order.packages && order.packages.length > 0)
      ? order.packages
      : [{ trackingNumber: order.trackingNumber || '', shipmentDate: order.shipmentConfirmedAt || '' }];
    const products = (order.products && order.products.length > 0)
      ? order.products
      : [{ title: '', variant: '', qty: '' }];

    if (packages.length === 1) {
      const pkg = packages[0];
      products.forEach((prod, prodIdx) => rows.push({
        labelPurchasedDate: prodIdx === 0 ? (order.labelPurchasedDate || '') : '',
        shippingDate:     pkg.shipmentDate,
        orderDate:        order.purchaseDate,
        trackingNumber:   pkg.trackingNumber,
        orderNumber:      order.orderNumber,
        customerName:     order.recipientName,
        productDetails:   prod.title,
        productVariant:   prod.variant  || '',
        qty:              prod.qty,
        estimatedRevenue: prodIdx === 0 ? (order.estimatedRevenue || '') : '',
        shippingCost:     prodIdx === 0 ? (order.shippingCost     || '') : '',
        basePrice:        prodIdx === 0 ? (order.basePrice        || '') : '',
        courier:          prodIdx === 0 ? (order.courier          || '') : ''
      }));
    } else {
      const maxRows = Math.max(packages.length, products.length);
      for (let ri = 0; ri < maxRows; ri++) {
        const pkg  = packages[ri % packages.length];
        const prod = products[ri] || products[products.length - 1] || { title: '', variant: '', qty: '' };
        rows.push({
          labelPurchasedDate: ri === 0 ? (order.labelPurchasedDate || '') : '',
          shippingDate:     pkg.shipmentDate,
          orderDate:        order.purchaseDate,
          trackingNumber:   pkg.trackingNumber,
          orderNumber:      order.orderNumber,
          customerName:     order.recipientName,
          productDetails:   prod.title,
          productVariant:   prod.variant  || '',
          qty:              prod.qty,
          estimatedRevenue: ri === 0 ? (order.estimatedRevenue || '') : '',
          shippingCost:     ri === 0 ? (order.shippingCost     || '') : '',
          basePrice:        ri === 0 ? (order.basePrice        || '') : '',
          courier:          ri === 0 ? (order.courier          || '') : ''
        });
      }
    }
  });
  return rows;
}

// ── Sort rows: Order Date ↑ → Shipping Date ↑ (nulls at BOTTOM) ───────────────
function sortRows(flatRows) {
  const MAX = Number.MAX_SAFE_INTEGER;
  flatRows.sort((a, b) => {
    const oa = parseDateStr(a.orderDate)   || MAX; // null → sorts last
    const ob = parseDateStr(b.orderDate)   || MAX;
    if (oa !== ob) return oa - ob;
    const sa = parseDateStr(a.shippingDate) || MAX;
    const sb = parseDateStr(b.shippingDate) || MAX;
    return sa - sb;
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// DOM EXTRACTION — injected into each order-detail page
// Must be completely self-contained (no closures from background scope).
// executeScript serializes ONLY this one function — no external refs allowed.
// ═══════════════════════════════════════════════════════════════════════════════
function extractPageData() {
  // Top-level try/catch: if any DOM error occurs, return null
  // (prevents a single bad order from crashing the executeScript call)
  try {

  function ownText(el) {
    var t = '';
    el.childNodes.forEach(function(n) { if (n.nodeType === 3) t += n.textContent.trim() + ' '; });
    return t.trim();
  }

  function findByOwnText(txt, tags) {
    tags = tags || ['div','span','p','th'];
    var rx = new RegExp('^' + txt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i');
    for (var t = 0; t < tags.length; t++) {
      var els = document.querySelectorAll(tags[t]);
      for (var i = 0; i < els.length; i++) if (rx.test(ownText(els[i]))) return els[i];
    }
    return null;
  }

  function findAllByOwnTextRx(rx, tags) {
    tags = tags || ['div','span'];
    var found = [];
    for (var t = 0; t < tags.length; t++) {
      var els = document.querySelectorAll(tags[t]);
      for (var i = 0; i < els.length; i++) if (rx.test(ownText(els[i]))) found.push(els[i]);
    }
    return found;
  }

  function adjacentValue(el, depth) {
    depth = (depth === undefined) ? 3 : depth;
    if (!el || depth === 0) return null;
    var s = el.nextElementSibling;
    if (s && s.textContent.trim()) return s;
    return adjacentValue(el.parentElement, depth - 1);
  }

  function extractTNFromContainer(container) {
    if (!container) return '';
    // Strategy 1: find a leaf span or span-with-only-icon-child matching tracking format
    var sp = Array.from(container.querySelectorAll('span')).find(function(s) {
      // Get text of only TEXT_NODEs (ignoring icon child elements)
      var directText = Array.from(s.childNodes)
        .filter(function(n) { return n.nodeType === 3; })
        .map(function(n) { return n.textContent.trim(); })
        .join('');
      if (!directText) directText = s.textContent.trim();
      return directText.length >= 8 && /^[A-Z0-9\-]{6,40}$/i.test(directText);
    });
    if (sp) {
      // Return only the direct text, not the icon text
      var directText = Array.from(sp.childNodes)
        .filter(function(n) { return n.nodeType === 3; })
        .map(function(n) { return n.textContent.trim(); })
        .join('');
      return directText || sp.textContent.trim();
    }
    // Strategy 2: nested span > span
    var nested = container.querySelector('span > span');
    if (nested && /[A-Z0-9]{6,}/i.test(nested.textContent)) return nested.textContent.trim();
    return '';
  }

  function cleanDate(str) {
    if (!str) return '';
    str = str.replace(/\s*\(UTC[+\-]?\d+(?::\d+)?\)/i, '').trim();
    str = str.replace(/,\s*\d+:\d+\s*[apm]{2,3}(?:\s+[A-Z]{2,5})?/i, '').trim();
    return str;
  }

  var bodyText = document.body ? (document.body.innerText || '') : '';

  // 1. Order Number — always ensure 'PO-' prefix
  var orderNumber = '';
  try { orderNumber = new URLSearchParams(window.location.search).get('parent_order_sn') || ''; } catch(e) {}
  if (!orderNumber) {
    var m = bodyText.match(/Order\s*ID\s*:?\s*(PO-[\d\-]+)/i) || bodyText.match(/(PO-\d{3}-\d{10,})/);
    if (m) orderNumber = m[1];
  }
  // Some URLs have '211-...' without 'PO-' prefix — normalise it
  if (orderNumber && !orderNumber.startsWith('PO-') && /^\d{3}-\d{8,}/.test(orderNumber)) {
    orderNumber = 'PO-' + orderNumber;
  }

  // 2. Purchase Date
  var purchaseDate    = '';  // clean (for export sheet)
  var purchaseDateRaw = '';  // with time, no tz name (for datetime filter)
  var pdL = findByOwnText('Purchase date', ['div']);
  if (pdL) {
    var pdV   = adjacentValue(pdL);
    var pdStr = pdV ? pdV.textContent.trim() : '';
    // purchaseDateRaw: remove (UTC+X) and trailing timezone abbreviation, KEEP the time
    purchaseDateRaw = pdStr
      .replace(/\s*\(UTC[+\-]?\d+(?::\d+)?\)/i, '')
      .replace(/\s+[A-Z]{2,5}$/i, '')
      .trim();
    // purchaseDate: fully cleaned (no time) for the export sheet
    purchaseDate = cleanDate(pdStr);
  }
  if (!purchaseDate) {
    var pdM = bodyText.match(/Purchase\s*date\s*\n?\s*([A-Za-z]+ \d+,\s*\d{4}[^\n]{0,40})/i);
    if (pdM) {
      var pdStr2      = pdM[1].trim();
      purchaseDateRaw = pdStr2
        .replace(/\s*\(UTC[+\-]?\d+(?::\d+)?\)/i, '')
        .replace(/\s+[A-Z]{2,5}$/i, '')
        .trim();
      purchaseDate = cleanDate(pdStr2);
    }
  }

  // 3. Recipient Name — multiple fallback strategies
  var recipientName = '';

  // Strategy 1: "Recipient name" label → adjacent div (normal orders)
  var rnL = findByOwnText('Recipient name', ['div']);
  if (rnL) {
    var rnV = adjacentValue(rnL);
    if (rnV) {
      // Get only direct text content (ignore child icon elements)
      var rnText = Array.from(rnV.childNodes)
        .filter(function(n) { return n.nodeType === 3; })
        .map(function(n) { return n.textContent; })
        .join('').trim();
      // If no direct text, fall back to full textContent
      if (!rnText) rnText = rnV.textContent.trim();
      // Clean up: remove lock icons, copy button text, etc.
      rnText = rnText.replace(/\s*Copy\s*/gi, '').replace(/^\-+$/, '').trim();
      if (rnText && rnText !== '-') recipientName = rnText;
    }
  }

  // Strategy 2: body text regex — "Recipient name\n  Mark Pell"
  if (!recipientName) {
    var rnM = bodyText.match(/Recipient\s*name\s*[\n\r]+\s*([A-Z][A-Za-z '\-]{1,50})/);
    if (rnM) recipientName = rnM[1].trim();
  }

  // Strategy 3: "Contact buyer" section — shows masked name like "(Ma***ll)"
  // Useful when full name is hidden but partial name is shown
  if (!recipientName) {
    // Look for the masked-name element: text like (Xx***xx)
    var maskedEl = Array.from(document.querySelectorAll('div,span')).find(function(el) {
      var t = el.textContent.trim();
      return el.childElementCount <= 1 && /^\([A-Za-z*\s'\-]{2,40}\)$/.test(t);
    });
    if (maskedEl) {
      recipientName = maskedEl.textContent.trim();
    }
  }

  // Strategy 4: body text — look for "(Xx***xx)" masked name pattern
  if (!recipientName) {
    var maskedM = bodyText.match(/\(([A-Za-z][A-Za-z*\s'\-]{1,40})\)/);
    if (maskedM && /\*/.test(maskedM[1])) recipientName = '(' + maskedM[1] + ')';
  }

  // 4. All Tracking Numbers (one per package)
  var allTrackingNumbers = [];
  var tnLabels = findAllByOwnTextRx(/^Tracking\s*number$/i, ['span']);
  tnLabels.forEach(function(label) {
    var lc = label.closest ? label.closest('div') : label.parentElement;
    var vc = lc ? lc.nextElementSibling : null;
    var tn = extractTNFromContainer(vc);
    if (tn) allTrackingNumbers.push(tn);
  });
  if (allTrackingNumbers.length === 0) {
    var tnPs = [/\b(1Z[A-Z0-9]{16})\b/g, /\b(9[24]\d{20})\b/g, /\b(\d{12})\b/g];
    for (var pi2 = 0; pi2 < tnPs.length; pi2++) {
      var tnAll = Array.from(bodyText.matchAll(tnPs[pi2])).map(function(m2) { return m2[1]; });
      if (tnAll.length > 0) { allTrackingNumbers = tnAll; break; }
    }
  }

  // 5. All Shipment Confirmed Dates (one per package)
  var allShipmentDates = [];
  var sdLabels = findAllByOwnTextRx(/^Shipment\s*confirmed\s*at$/i, ['div']);
  sdLabels.forEach(function(label) {
    var sdV = adjacentValue(label);
    if (sdV) allShipmentDates.push(cleanDate(sdV.textContent.trim()));
  });
  if (allShipmentDates.length === 0) {
    var sdM = bodyText.match(/Shipment\s*confirmed\s*at\s*\n?\s*([A-Za-z]+ \d+,\s*\d{4}[^\n]{0,40})/i);
    if (sdM) allShipmentDates.push(cleanDate(sdM[1].trim()));
  }

  // Build packages array
  var numPkgs = Math.max(allTrackingNumbers.length, allShipmentDates.length, 1);
  var packages = [];
  for (var pi = 0; pi < numPkgs; pi++) {
    packages.push({ trackingNumber: allTrackingNumbers[pi] || '', shipmentDate: allShipmentDates[pi] || '' });
  }

  // 6. Products from Order Contents table
  var products = [];
  var allTbodies = document.querySelectorAll('tbody');
  var orderTbody = null;
  for (var bi = 0; bi < allTbodies.length; bi++) {
    // Use textContent (not innerText) — innerText fails on hidden/collapsed CSS elements
    var tbText = allTbodies[bi].textContent || '';
    if (tbText.includes('Goods ID:') || tbText.includes('SKU ID:') || tbText.includes('Order Item ID')) {
      orderTbody = allTbodies[bi]; break;
    }
  }
  if (orderTbody) {
    var productColIdx = 1, quantityColIdx = 2;
    var tbl = orderTbody.closest ? orderTbody.closest('table') : orderTbody.parentElement;
    var thead = tbl ? tbl.querySelector('thead') : null;
    if (thead) {
      thead.querySelectorAll('th').forEach(function(th, idx) {
        var txt = (th.textContent || '').trim().toLowerCase();
        if (txt === 'product')  productColIdx  = idx;
        if (txt === 'quantity') quantityColIdx = idx;
      });
    }
    orderTbody.querySelectorAll('tr').forEach(function(row) {
      var tds = row.querySelectorAll('td');
      if (tds.length <= productColIdx) return;
      var productTd  = tds[productColIdx];
      var quantityTd = tds.length > quantityColIdx ? tds[quantityColIdx] : null;

      var title = '';

      // Strategy 1: beast-core-ellipsis — try innerText first, then textContent
      var ellipsisEl = productTd.querySelector('[data-testid="beast-core-ellipsis"]');
      if (ellipsisEl) {
        // Try innerText (works when text is visible)
        var rawTitle = (ellipsisEl.innerText || '').trim();
        if (!rawTitle) rawTitle = (ellipsisEl.textContent || '').trim(); // fallback
        var lines = rawTitle.split('\n').map(function(l) { return l.trim(); }).filter(Boolean);
        var t0 = lines[0] || '';
        if (t0 && !/[{}]|webkit|display\s*:|Goods\s*ID|SKU\s*ID|Order\s*item/i.test(t0)) {
          title = t0;
        } else {
          // Try deeper — get textContent of the direct inner div (the actual title div)
          var innerDiv = ellipsisEl.querySelector('div > div, div');
          if (innerDiv) {
            var innerText = Array.from(innerDiv.childNodes)
              .filter(function(n) { return n.nodeType === 3; })
              .map(function(n) { return n.textContent.trim(); })
              .join('').trim();
            if (!innerText) innerText = (innerDiv.textContent || '').trim();
            if (innerText && innerText.length > 5 &&
                !/[{}]|webkit|Goods\s*ID|SKU\s*ID|Order\s*item/i.test(innerText)) {
              title = innerText;
            }
          }
          // Still no title — try other lines
          if (!title) {
            for (var li = 1; li < lines.length; li++) {
              if (!/[{}]|webkit|display\s*:|Goods\s*ID|SKU\s*ID|Order\s*item/i.test(lines[li]) && lines[li].length > 5) {
                title = lines[li]; break;
              }
            }
          }
        }
      }

      // Strategy 2: longest own-text node (TEXT_NODEs only) — primary fallback
      if (!title) {
        var cands = [];
        productTd.querySelectorAll('div,span,a').forEach(function(el) {
          // Try direct TEXT_NODE first (ownText)
          var ot = ownText(el);
          // Also try full textContent of small leaf elements (catches titles inside icon-containing divs)
          if (!ot && el.childElementCount <= 1) {
            var fc = el.firstElementChild;
            // If the only child is an icon (small, no own text), treat parent text as candidate
            if (!fc || (fc.childElementCount === 0 && (fc.textContent || '').trim().length === 0)) {
              ot = (el.textContent || '').trim();
            }
          }
          if (ot && ot.length > 5 &&
              !/Goods\s*ID|SKU\s*ID|Order\s*item|^\$|^\d+$|shipped|delivered|refund|Seller|Seller fulfilled|[{}]|webkit/i.test(ot)) {
            cands.push(ot);
          }
        });
        cands.sort(function(a, b) { return b.length - a.length; });
        if (cands.length > 0) title = cands[0];
      }

      // Strategy 3: bodyText regex — find product name near the order's goods/SKU IDs
      if (!title) {
        var prodM = bodyText.match(/([A-Za-z][^\n]{10,120})\s*\nGoods\s*ID\s*:/);
        if (prodM) title = prodM[1].trim();
      }

      // ── Extract Product Variant (color/size/style) ────────────────────────
      var variant = '';
      if (productTd) {
        // Strategy 1: dedicated variant/attribute div (Temu uses _3Le-rmeu or similar)
        var variantContainers = productTd.querySelectorAll('[class*="rmeu"],[class*="variant"],[class*="attr"],[class*="property"]');
        variantContainers.forEach(function(vc) {
          if (variant) return;
          var t = (vc.textContent || '').trim();
          if (t && t.length > 0 && t.length < 80 &&
              !/Goods\s*ID|SKU\s*ID|Order\s*item|^\$|^\d+$/i.test(t)) {
            variant = t;
          }
        });

        // Strategy 2: small span/div directly after the title div — typically variant label
        if (!variant && title) {
          var allLeafs = Array.from(productTd.querySelectorAll('span,div')).filter(function(el) {
            return el.childElementCount === 0;
          });
          allLeafs.forEach(function(el) {
            if (variant) return;
            var t = (el.textContent || '').trim();
            // Short text, not the title itself, not a price/number/ID
            if (t && t !== title && t.length > 0 && t.length < 60 &&
                !/Goods\s*ID|SKU\s*ID|Order\s*item|^\$|^\d{5,}|^Copy$/i.test(t) &&
                !/shipped|delivered|refund|Seller/i.test(t)) {
              variant = t;
            }
          });
        }

        // Strategy 3: bodyText — look for variant pattern: "Variant: White" or "Special\n"
        if (!variant) {
          var varM = bodyText.match(/\b(New|Special|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b(?=\s*\n(?:Goods\s*ID|SKU\s*ID))/);
          if (varM && varM[1] !== title) variant = varM[1].trim();
        }
      }

      var qty = '1';
      if (quantityTd) {
        var qEl = Array.from(quantityTd.querySelectorAll('div,span')).find(function(el) {
          return el.childElementCount === 0 && /^\d+$/.test(el.textContent.trim());
        });
        if (qEl) qty = qEl.textContent.trim();
        else { var qm = (quantityTd.textContent || '').match(/^[\s\n]*(\d+)/); if (qm) qty = qm[1]; }
      }

      // Always push the product row — even if title is empty
      // Skipping silently causes missing rows in the export sheet
      // A blank title is better than a missing order
      products.push({ title: title || '', variant: variant || '', qty: qty || '1' });
    });
  }

  // 7. Estimated Revenue — take LAST occurrence of "Estimated revenue" label
  //    (it appears in both the table row AND the Sales proceeds panel;
  //     the panel version is later in the DOM and is the correct order total)
  var estimatedRevenue = '';
  var erLabels = findAllByOwnTextRx(/^Estimated\s*revenue$/i, ['span', 'div']);
  if (erLabels.length > 0) {
    var erLabel = erLabels[erLabels.length - 1];
    var erV = adjacentValue(erLabel);
    if (erV) estimatedRevenue = erV.textContent.trim().replace(/[^0-9.,]/g, '').trim();
  }
  if (!estimatedRevenue) {
    var erM = bodyText.match(/Estimated\s*revenue[^\n]*\n?[^\n$]*\$([\d.,]+)/i);
    if (erM) estimatedRevenue = erM[1];
  }

  // 8. Est. Total Shipping Cost
  var shippingCost = '';
  var scLabel = findByOwnText('Est. total shipping cost', ['div']);
  if (scLabel) { var scV = adjacentValue(scLabel); shippingCost = scV ? scV.textContent.trim().replace(/[^0-9.,]/g, '').trim() : ''; }
  if (!shippingCost) {
    var scM = bodyText.match(/Est\.?\s*total\s*shipping\s*cost[^\n]*\n?[^\n$]*\$([\d.,]+)/i);
    if (scM) shippingCost = scM[1];
  }

  // 9. Courier — from "Courier" label in Package section
  // DOM: div._3ThFGSo9 "Courier" → sibling div._23odfCcn → inner div._2OTvT66D
  var courier = '';
  var courierLabel = findByOwnText('Courier', ['div', 'span']);
  if (courierLabel) {
    var courierV = adjacentValue(courierLabel);
    if (courierV) courier = courierV.textContent.trim().replace(/\s+/g, ' ');
  }
  if (!courier) {
    var courierM = bodyText.match(/Courier[\s\n]+([A-Za-z][^\n]{2,40})/);
    if (courierM) courier = courierM[1].trim();
  }

  // 10. Base Price — from Sales proceeds panel "Base price total"
  // DOM: span._NQzGIY9a "Base price total" → sibling span._3TKnz9iZ "$15.80"
  var basePrice = '';
  var bpLabels = findAllByOwnTextRx(/^Base\s*price\s*(?:total|subtotal)?$/i, ['span', 'div']);
  if (bpLabels.length > 0) {
    var bpLabel = bpLabels[bpLabels.length - 1];
    var bpV = adjacentValue(bpLabel);
    if (bpV) basePrice = bpV.textContent.trim().replace(/[^0-9.,]/g, '').trim();
  }
  if (!basePrice) {
    var bpM = bodyText.match(/Base\s*price\s*(?:total|subtotal)?\s*\n?\s*\$([\d.,]+)/i);
    if (bpM) basePrice = bpM[1];
  }

  // ── Guard: only skip if BOTH orderNumber AND recipientName are missing ─────
  // Previously: returned null when products.length === 0 even with a valid orderNumber
  // This caused digital/cancelled orders to be silently dropped (they have no product table)
  if (!orderNumber && !recipientName) return null;

  return { orderNumber, recipientName, purchaseDate, purchaseDateRaw, packages, products, estimatedRevenue, shippingCost, basePrice, courier };

  } catch(e) {
    // DOM error — return null so this order goes to retryQueue instead of crashing
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORT GENERATORS
// ═══════════════════════════════════════════════════════════════════════════════

function generateExport(flatRows, orderCount, format) {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const ts  = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`;
  const base = `temu_orders_${ts}_${orderCount}orders`;
  if (format === 'json') {
    const j = JSON.stringify(flatRows, null, 2);
    return { dataUrl: 'data:application/json;charset=utf-8;base64,' + btoa(unescape(encodeURIComponent(j))), filename: base + '.json' };
  }
  if (format === 'xlsx') return generateXLSX(flatRows, base);
  return generateCSV(flatRows, base);
}

function generateCSV(flatRows, base) {
  const esc = c => '"' + String(c == null ? '' : c).replace(/"/g, '""').replace(/[\r\n]+/g, ' ').trim() + '"';
  const lines = [EXPORT_HEADERS.map(esc).join(',')];
  flatRows.forEach(r => {
    const rowCells = EXPORT_COLS.map(k => {
      const val = r[k];
      if (val == null || val === '') return '';
      if (k === 'estimatedRevenue' || k === 'shippingCost') {
        const cleaned = String(val).replace(/,/g, '').trim();
        const num = parseFloat(cleaned);
        return isNaN(num) ? val : num;
      }
      if (k === 'qty') {
        const num = parseInt(String(val).trim(), 10);
        return isNaN(num) ? val : num;
      }
      return val;
    });
    lines.push(rowCells.map(esc).join(','));
  });
  const csv = '\uFEFF' + lines.join('\r\n');
  return { dataUrl: 'data:text/csv;charset=utf-8;base64,' + btoa(unescape(encodeURIComponent(csv))), filename: base + '.csv' };
}

function generateXLSX(flatRows, base) {
  if (!XLSX_LOADED || typeof XLSX === 'undefined') {
    console.warn('[Temu Exporter] SheetJS unavailable — falling back to CSV');
    return generateCSV(flatRows, base.replace(/\.xlsx$/, '') + '.csv');
  }
  const wsData = [EXPORT_HEADERS];
  flatRows.forEach(r => {
    wsData.push(EXPORT_COLS.map(k => {
      const val = r[k];
      if (val == null || val === '') return '';
      if (k === 'estimatedRevenue' || k === 'shippingCost') {
        const cleaned = String(val).replace(/,/g, '').trim();
        const num = parseFloat(cleaned);
        return isNaN(num) ? val : num;
      }
      if (k === 'qty') {
        const num = parseInt(String(val).trim(), 10);
        return isNaN(num) ? val : num;
      }
      return val;
    }));
  });
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = EXPORT_HEADERS.map((h, ci) => {
    const maxLen = wsData.reduce((mx, row) => Math.max(mx, String(row[ci] != null ? row[ci] : '').length), h.length);
    return { wch: Math.min(maxLen + 3, 65) };
  });
  ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activeCell: 'A2', sqref: 'A2' };
  EXPORT_HEADERS.forEach((_, ci) => {
    const ref = XLSX.utils.encode_cell({ r: 0, c: ci });
    if (ws[ref]) ws[ref].s = {
      font:      { bold: true, color: { rgb: 'FFFFFF' }, sz: 11 },
      fill:      { fgColor: { rgb: '00B050' }, patternType: 'solid' },
      alignment: { horizontal: 'center', vertical: 'center' },
      border:    { bottom: { style: 'thin', color: { rgb: '007A3D' } } }
    };
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Temu Orders');
  const b64 = XLSX.write(wb, { bookType: 'xlsx', type: 'base64', cellStyles: true });
  return {
    dataUrl:  'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,' + b64,
    filename: base + '.xlsx'
  };
}