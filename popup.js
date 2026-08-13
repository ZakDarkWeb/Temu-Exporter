// popup.js — Temu Order Exporter v4.1

// ── Speed presets (sent to background for delay tuning) ──────────────────────
const SPEED_PRESETS = {
  1: { label: 'Safe',     tabDelay: 2000, randExtra: 2000 },  // 2–4s between tabs
  2: { label: 'Balanced', tabDelay: 1000, randExtra: 1000 },  // 1–2s between tabs
  3: { label: 'Fast',     tabDelay: 400,  randExtra: 600  }   // 0.4–1s between tabs
};

// ── DOM refs ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const headerSub     = $('headerSub');
const modePill      = $('modePill');
const statPagesVal  = $('statPagesVal');
const statPagesLbl  = $('statPagesLabel');
const statOrdersVal = $('statOrdersVal');
const statPages     = $('statPages');
const statOrders    = $('statOrders');
const statusBox     = $('statusBox');
const statusIcon    = $('statusIcon');
const statusMsg     = $('statusMsg');
const autoPanel     = $('autoPanel');
const manualPanel   = $('manualPanel');
const progressSec   = $('progressSection');
const stepsRow      = $('stepsRow');
const barFill       = $('barFill');
const progLabel     = $('progLabel');
const progPct       = $('progPct');
const failBox       = $('failBox');
const autoBtn       = $('autoBtn');
const manualBtn     = $('manualBtn');
const autoBtnTxt    = $('autoBtnTxt');
const manualBtnTxt  = $('manualBtnTxt');
const fromPage      = $('fromPage');
const toPage        = $('toPage');
const estOrders     = $('estOrders');
const estTime       = $('estTime');
const speedSlider   = $('speedSlider');
const speedVal      = $('speedVal');
const autoFormat    = $('autoFormat');
const manualFormat  = $('manualFormat');
const dateFilterEnabled   = $('dateFilterEnabled');
const dateFilterInputs    = $('dateFilterInputs');
const dateFilterToggleRow = $('dateFilterToggleRow');
const fromDate      = $('fromDate');
const toDate        = $('toDate');

let currentMode      = 'manual';
let currentListTabId = null;
let running          = false;

// ── Date filter defaults ────────────────────────────────────────────
function toLocalISO(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function initDateDefaults() {
  const now = new Date();
  toDate.value = toLocalISO(now);          // To = right now

  const from30 = new Date(now);
  from30.setDate(from30.getDate() - 30);
  from30.setHours(0, 0, 0, 0);            // From = 30 days ago at midnight
  fromDate.value = toLocalISO(from30);
}

// ── Date filter toggle ────────────────────────────────────────────
dateFilterEnabled.addEventListener('change', () => {
  const on = dateFilterEnabled.checked;
  if (on) {
    dateFilterInputs.classList.add('visible');
    dateFilterToggleRow.classList.add('active');
  } else {
    dateFilterInputs.classList.remove('visible');
    dateFilterToggleRow.classList.remove('active');
  }
});
// Clicking anywhere on the row toggles the checkbox
dateFilterToggleRow.addEventListener('click', e => {
  if (e.target !== dateFilterEnabled) {
    dateFilterEnabled.checked = !dateFilterEnabled.checked;
    dateFilterEnabled.dispatchEvent(new Event('change'));
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function setStatus(icon, msg, type = 'idle') {
  statusIcon.textContent = icon;
  statusMsg.textContent  = msg;
  statusBox.className    = `status ${type}`;
}

function setProgress(pct, label) {
  barFill.style.width    = `${Math.min(pct, 100)}%`;
  progPct.textContent    = `${Math.round(pct)}%`;
  if (label !== undefined) progLabel.textContent = label;
}

function bumpStat(el, val) {
  el.textContent = val;
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
}

function setStep(stage) {
  // stage: 'navigating' | 'scraping' | 'extracting' | 'retrying' | 'done'
  const steps = [
    { el: $('stepNav'),     numEl: $('stepNavNum')     },
    { el: $('stepScrape'),  numEl: $('stepScrapeNum')  },
    { el: $('stepExtract'), numEl: $('stepExtractNum') },
    { el: $('stepRetry'),   numEl: $('stepRetryNum')   }
  ];
  const map = { navigating: 0, scraping: 1, extracting: 2, retrying: 3, done: 4 };
  const active = map[stage] ?? -1;
  steps.forEach(({ el, numEl }, i) => {
    el.className = 'step' + (i < active ? ' done' : i === active ? ' active' : '');
    if (i < active)       numEl.textContent = '✓';
    else if (i === active) numEl.textContent = '…';
    else                   numEl.textContent = i + 1;
  });
}

function showFailBox(count, orderNumbers = []) {
  if (!count) { failBox.style.display = 'none'; return; }
  // orderNumbers is now an array of PO-xxx strings (not full URLs)
  const items = orderNumbers.slice(0, 8).map(sn =>
    `<code style="font-size:10px;color:#ef4444;display:block;margin-top:2px">${sn}</code>`
  );
  failBox.style.display = 'block';
  failBox.innerHTML =
    `⚠️ <strong>${count} order${count > 1 ? 's' : ''} permanently failed</strong> after all retries — check manually:` +
    (items.length ? `<div style="margin-top:4px">${items.join('')}</div>` : '') +
    (count > 8 ? `<div style="font-size:10px;color:#9ca3af;margin-top:2px">…and ${count - 8} more</div>` : '');
}

function calcEstimate() {
  const from  = parseInt(fromPage.value) || 1;
  const to    = parseInt(toPage.value)   || 1;
  const pages = Math.max(0, to - from + 1);
  const low   = pages * 10;
  const high  = pages * 50;
  const speed = SPEED_PRESETS[parseInt(speedSlider.value) || 2];
  // Sequential (1 by 1): per order = react-wait(3s) + extract(1s) + delay
  const delayPerOrder = (speed.tabDelay + speed.randExtra / 2) / 1000;
  const avgSecPerOrder = 4 + delayPerOrder; // 3s render + 1s extract + inter-tab delay
  const minMin = Math.round(low  * avgSecPerOrder / 60);
  const maxMin = Math.round(high * avgSecPerOrder / 60);
  estOrders.textContent = `~${low}–${high} orders`;
  estTime.textContent   = `~${minMin}–${maxMin} min`;
  // Update slider CSS gradient
  const pct = ((parseInt(speedSlider.value) - 1) / 2 * 100).toFixed(0);
  speedSlider.style.setProperty('--pct', pct + '%');
  speedSlider.style.background =
    `linear-gradient(90deg, #3b82f6 ${pct}%, #1e2d45 ${pct}%)`;
}

// ── Stepper buttons ───────────────────────────────────────────────────────────

function wire(btnId, inputId, delta) {
  $(btnId).addEventListener('click', () => {
    const inp = $(inputId);
    inp.value = Math.max(1, (parseInt(inp.value) || 1) + delta);
    inp.dispatchEvent(new Event('input'));
  });
}
wire('fromMinus', 'fromPage', -1);
wire('fromPlus',  'fromPage', +1);
wire('toMinus',   'toPage',   -1);
wire('toPlus',    'toPage',   +1);

fromPage.addEventListener('input', calcEstimate);
toPage.addEventListener('input',   calcEstimate);
speedSlider.addEventListener('input', () => {
  speedVal.textContent = SPEED_PRESETS[parseInt(speedSlider.value)].label;
  calcEstimate();
});

// ── Mode detection ────────────────────────────────────────────────────────────

async function init() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url?.includes('seller.temu.com')) { showNoTemu(); return; }

    // Detect page type via DOM injection
    let pageType = 'other';
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: function() {
          var url = window.location.href;
          if (url.includes('order-detail') || url.includes('parent_order_sn')) return 'order-detail';

          var allText = (document.body?.innerText || '').substring(0, 3000);
          var tabEls  = Array.from(document.querySelectorAll('[class*="tab"],[role="tab"],li,a'));

          var hasOrderTabs =
            tabEls.some(el => /^Unshipped/.test(el.textContent.trim())) &&
            tabEls.some(el => /^Shipped/.test(el.textContent.trim()));

          if (!hasOrderTabs) {
            hasOrderTabs = /Unshipped\s*\d+/i.test(allText) ||
                           /Buy\s+shipping/i.test(allText)   ||
                           /Edit\s+shipment/i.test(allText);
          }
          if (!hasOrderTabs) return 'other';

          var isShipped = false;
          tabEls.forEach(el => {
            var txt  = el.textContent.trim();
            var cls  = (el.className || '').toString();
            var aria = el.getAttribute('aria-selected') || '';
            if (/^Shipped/.test(txt) &&
               (cls.includes('active') || cls.includes('selected') || cls.includes('current') || aria === 'true'))
              isShipped = true;
          });

          // Fallback: Shipped tab shows "Edit shipment", not "Buy shipping"
          if (!isShipped && /Edit\s+shipment/i.test(allText) && !/Buy\s+shipping/i.test(allText))
            isShipped = true;

          return isShipped ? 'orders-shipped' : 'orders-other';
        }
      });
      pageType = result || 'other';
    } catch(e) {
      if (tab.url.includes('manage-orders')) pageType = 'orders-shipped';
    }

    if (pageType === 'orders-shipped') {
      currentMode      = 'auto';
      currentListTabId = tab.id;
      showAutoMode(true);
    } else if (pageType === 'orders-other') {
      currentMode      = 'auto';
      currentListTabId = tab.id;
      showAutoMode(false);
    } else {
      currentMode = 'manual';
      await scanManualTabs();
    }

  } catch(e) {
    setStatus('❌', 'Cannot access tab. Check extension permissions.', 'error');
  }
}

async function scanManualTabs() {
  const tabs = await chrome.tabs.query({ url: 'https://seller.temu.com/*' });
  const order = tabs.filter(t => t.url?.includes('order-detail'));
  statPagesVal.textContent = order.length;
  statPagesLbl.textContent = 'Order Tabs';

  modePill.textContent  = 'Manual';
  modePill.className    = 'mode-pill manual';
  headerSub.textContent = 'Export open order tabs';
  autoPanel.style.display  = 'none';
  manualPanel.style.display = 'block';
  autoBtn.style.display    = 'none';
  manualBtn.style.display  = 'flex';
  stepsRow.style.display   = 'none';

  if (order.length === 0) {
    setStatus('⚠️', 'No order-detail tabs open. Or go to Manage Orders → Shipped for Auto-Export.', 'error');
    manualBtn.disabled = true;
  } else {
    setStatus('✅', `${order.length} order tab${order.length > 1 ? 's' : ''} found — ready to export.`, 'success');
    manualBtn.disabled = false;
  }
}

function showAutoMode(isShipped) {
  modePill.textContent  = 'Auto';
  modePill.className    = 'mode-pill auto';
  headerSub.textContent = 'Shipped orders list';
  autoPanel.style.display  = 'block';
  manualPanel.style.display = 'none';
  autoBtn.style.display    = 'flex';
  manualBtn.style.display  = 'none';
  statPagesLbl.textContent = 'Pages';
  calcEstimate();

  if (isShipped) {
    setStatus('🚀', 'Shipped orders detected! Set page range and click Start.', 'success');
    autoBtn.disabled = false;
  } else {
    setStatus('⚠️', 'Click the "Shipped" tab first, then reopen the extension.', 'info');
    autoBtn.disabled = true;
  }

  // Check if an export is already running and restore its state
  restoreRunningState();
}

// ── Restore running state when popup is reopened ──────────────────────────────
function restoreRunningState() {
  chrome.runtime.sendMessage({ type: 'getState' });
}

function showNoTemu() {
  setStatus('⚠️', 'Open seller.temu.com — Manage Orders → Shipped for Auto, or open order-detail tabs for Manual.', 'error');
  autoPanel.style.display  = 'none';
  manualPanel.style.display = 'block';
  manualBtn.style.display  = 'flex';
  manualBtn.disabled = true;
}

// ── Message listener ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(msg => {

  // ── Restore state when popup is reopened while export is running ──
  if (msg.type === 'stateSnapshot') {
    if (msg.running && msg.lastMsg) {
      const m = msg.lastMsg;
      running = true;
      autoBtn.disabled = true;
      autoBtnTxt.textContent = '⏳ Running…';
      progressSec.style.display = 'block';
      failBox.style.display     = 'none';

      if (m.type === 'autoProgress') {
        stepsRow.style.display = 'flex';
        setStep(m.stage);
        if (m.stage === 'scraping') {
          const pct = 2 + (m.page / (m.page + (m.totalPages || 1))) * 28;
          setProgress(pct, `Reading page ${m.page} — ${m.scraped} links collected`);
          setStatus('📋', `Export is running! Page ${m.page}… (${m.scraped} orders found)`, 'info');
          statPagesVal.textContent = m.page || 0;
        } else if (m.stage === 'extracting') {
          const pct = 30 + (m.total > 0 ? (m.current / m.total) * 55 : 0);
          setProgress(pct, `Batch: orders ${m.current + 1}–${Math.min(m.current + 3, m.total)} / ${m.total}`);
          setStatus('⚡', `Export running! Batch processing ${m.current}/${m.total}`, 'info');
          statOrdersVal.textContent = m.current || 0;
        } else if (m.stage === 'retrying') {
          const pct = 85 + (m.retryTotal > 0 ? (m.retrying / m.retryTotal) * 13 : 0);
          setProgress(pct, `Retrying failed: ${m.retrying} / ${m.retryTotal}`);
          setStatus('🔄', `Export running! Retrying failed orders… (${m.retrying}/${m.retryTotal})`, 'info');
        } else {
          setProgress(2, 'Navigating…');
          setStatus('🗺️', 'Export is running! Navigating pages…', 'info');
        }
      } else if (m.type === 'progress') {
        stepsRow.style.display = 'none';
        const pct = m.total > 0 ? (m.current / m.total) * 100 : 0;
        setProgress(pct, `Processing ${m.current} / ${m.total} tabs…`);
        setStatus('⏳', `Export is running! (${m.current}/${m.total})`, 'info');
      }
    }
    return;
  }

  if (msg.type === 'progress') {
    progressSec.style.display = 'block';
    stepsRow.style.display    = 'none';
    const pct = msg.total > 0 ? (msg.current / msg.total) * 100 : 0;
    setProgress(pct, `Processing ${msg.current} / ${msg.total} tabs…`);
    setStatus('⏳', `Exporting… (${msg.current}/${msg.total})`, 'info');
  }

  else if (msg.type === 'autoProgress') {
    progressSec.style.display = 'block';
    stepsRow.style.display    = 'flex';
    setStep(msg.stage);

    if (msg.stage === 'navigating') {
      setProgress(2, `Navigating to page ${msg.page}…`);
      setStatus('🗺️', `Jumping to start page…`, 'info');
    }
    else if (msg.stage === 'scraping') {
      const pct = 2 + (msg.page / (msg.page + msg.totalPages)) * 28;
      setProgress(pct, `Reading page ${msg.page} — ${msg.scraped} links collected`);
      setStatus('📋', `Scanning page ${msg.page}… (${msg.scraped} orders found)`, 'info');
      bumpStat(statPagesVal, msg.page);
    }
    else if (msg.stage === 'extracting') {
      const pct = 30 + (msg.total > 0 ? (msg.current / msg.total) * 55 : 0);
      setProgress(pct, `Extracting order ${msg.current + 1} / ${msg.total}`);
      setStatus('⚡', `Extracting 1 by 1… ${msg.current}/${msg.total} done`, 'info');
      bumpStat(statOrdersVal, msg.current);
    }
    else if (msg.stage === 'retrying') {
      const pct = 85 + (msg.retryTotal > 0 ? (msg.retrying / msg.retryTotal) * 13 : 0);
      setProgress(pct, `Retrying failed: ${msg.retrying} / ${msg.retryTotal}`);
      setStatus('🔄', `Retrying ${msg.retryTotal} failed order${msg.retryTotal > 1 ? 's' : ''}… (${msg.retrying}/${msg.retryTotal})`, 'info');
    }
  }

  else if (msg.type === 'done') {
    progressSec.style.display = 'none';
    bumpStat(statOrdersVal, msg.rowsExported);
    showFailBox(msg.failedCount, msg.failedUrls);
    setStatus(msg.failedCount ? '⚠️' : '🎉',
      `${msg.ordersFound} orders → ${msg.rowsExported} rows exported as ${msg.format?.toUpperCase()}!`,
      msg.failedCount ? 'info' : 'success');
    manualBtnTxt.textContent = '✅ Done!'; manualBtn.disabled = true;
    setTimeout(() => { manualBtnTxt.textContent = '⬇️ Export Open Tabs'; manualBtn.disabled = false; running = false; }, 3500);
  }

  else if (msg.type === 'autoDone') {
    progressSec.style.display = 'none';
    setStep('done');
    bumpStat(statOrdersVal, msg.rowsExported);
    bumpStat(statPagesVal,  msg.pagesScraped);
    statPages.classList.add('active');
    statOrders.classList.add('active');
    // failedOrders is now an array of PO-xxx strings
    showFailBox(msg.failedCount, msg.failedOrders || []);
    let doneMsg = `${msg.ordersFound} orders → ${msg.rowsExported} rows exported!`;
    if (msg.failedCount) doneMsg += ` (${msg.failedCount} failed — see below)`;
    if (msg.filterEnabled && msg.filterFromDate && msg.filterToDate) {
      doneMsg += ` | Date: ${msg.filterFromDate} → ${msg.filterToDate}`;
    }
    setStatus(msg.failedCount ? '⚠️' : '🎉', doneMsg, msg.failedCount ? 'info' : 'success');
    autoBtnTxt.textContent = '✅ Done!'; autoBtn.disabled = true;
    setTimeout(() => { autoBtnTxt.textContent = '🚀 Start Auto-Export'; autoBtn.disabled = false; running = false; }, 4000);
  }

  else if (msg.type === 'error') {
    progressSec.style.display = 'none';
    setStatus('❌', msg.message || 'An error occurred.', 'error');
    running = false;
    autoBtn.disabled = manualBtn.disabled = false;
    autoBtnTxt.textContent  = '🚀 Start Auto-Export';
    manualBtnTxt.textContent = '⬇️ Export Open Tabs';
  }

  else if (msg.type === 'noData') {
    progressSec.style.display = 'none';
    const filterHint = msg.filterEnabled ? ' Date filter active — shayad koi order is range mein nahi tha.' : '';
    setStatus('⚠️', `No data extracted.${msg.failedCount ? ` ${msg.failedCount} tabs failed.` : ''}${filterHint}`, 'error');
    running = false;
    autoBtn.disabled = manualBtn.disabled = false;
    autoBtnTxt.textContent  = getAutoBtnLabel();
    manualBtnTxt.textContent = '⬇️ Export Open Tabs';
  }
});

// ── Tab switching ─────────────────────────────────────────────────────────────

let activeTab = 'pages';  // 'pages' | 'date' | 'select'

const tabContentMap = {
  pages:  $('tabContentPages'),
  date:   $('tabContentDate'),
  select: $('tabContentSelect')
};

function getAutoBtnLabel() {
  if (activeTab === 'pages')  return '🚀 Start Auto-Export';
  if (activeTab === 'date')   return '🗓️ Start Date Export';
  if (activeTab === 'select') return '☑ Export Selected';
  return '🚀 Start';
}

function switchTab(tab) {
  activeTab = tab;
  // Update tab buttons
  document.querySelectorAll('.mode-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  // Update tab content panels
  Object.entries(tabContentMap).forEach(([key, el]) => {
    if (el) el.classList.toggle('active', key === tab);
  });
  // Update main action button label
  autoBtnTxt.textContent = getAutoBtnLabel();
  // Update selection count if switching to select tab
  if (tab === 'select') startSelectionPolling();
  else stopSelectionPolling();
}

// Wire tab buttons
document.querySelectorAll('.mode-tab').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

// ── Selection Mode — direct page reading via executeScript ───────────────────
// No content script needed: popup directly reads Temu's native checkbox state

let selPollInterval  = null;
let currentSelections = {};   // { orderSn: detailUrl } — kept in memory

// Read checked checkboxes directly from the Temu list tab
// DOM analysis shows: Temu uses data-checked="true" on <label> elements
// and CBX_active_123 class when checked. Standard input.checked is unreliable.
// Also: PO numbers appear as "PO-211-123456Copy" (no space before Copy button)
// so word boundaries \b fail — use plain capture group instead.
async function readPageSelections() {
  if (!currentListTabId) return {};
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: currentListTabId },
      func: function() {
        var sel = {};
        var baseUrl = window.location.origin + '/order-detail.html';

        // ── Extract PO number from text (no word boundary — "Copy" is attached) ─
        function extractPO(text) {
          var m = text.match(/(PO-\d+-\d{9,})/);  // no \b — "PO-211-123456Copy"
          return m ? m[1] : null;
        }

        // ── Is this element's row checked? ────────────────────────────────────
        // Temu DOM: <label data-checked="true" class="CBX_outerWrapper_123 CBX_active_123">
        function isChecked(el) {
          // Primary: data-checked attribute (Temu's own state flag)
          if (el.querySelector('label[data-checked="true"]')) return true;
          // Secondary: CBX_active_123 class added when checked
          if (el.querySelector('.CBX_active_123')) return true;
          // Tertiary: check the label itself (if el IS the label)
          if (el.getAttribute && el.getAttribute('data-checked') === 'true') return true;
          if (el.classList && el.classList.contains('CBX_active_123')) return true;
          return false;
        }

        // ── Strategy 1: Walk all <tr> rows ────────────────────────────────────
        var foundAny = false;
        document.querySelectorAll('tr').forEach(function(tr) {
          // Skip header rows (th cells present)
          if (tr.querySelector('th')) return;
          if (!isChecked(tr)) return;
          var sn = extractPO(tr.textContent || '');
          if (!sn) return;
          foundAny = true;
          sel[sn] = baseUrl + '?parent_order_sn=' + encodeURIComponent(sn);
        });

        // ── Strategy 2: Walk from checked labels upward to find PO number ─────
        // Handles cases where <tr> scan missed (e.g. virtual scroll, SPA delays)
        if (!foundAny) {
          var checkedLabels = [].slice.call(document.querySelectorAll(
            'label[data-checked="true"], .CBX_active_123'
          ));
          checkedLabels.forEach(function(label) {
            // Skip header "select all" checkbox (indeterminate state)
            if (label.getAttribute('data-indeterminate') === 'true') return;
            // Walk up max 10 levels to find a container with a PO number
            var el = label;
            for (var i = 0; i < 10; i++) {
              if (!el || !el.parentElement) break;
              el = el.parentElement;
              var sn = extractPO(el.textContent || '');
              if (sn && !sel[sn]) {
                sel[sn] = baseUrl + '?parent_order_sn=' + encodeURIComponent(sn);
                break;
              }
            }
          });
        }

        return sel;
      }
    });

    if (!results || !results[0]) return {};
    return results[0].result || {};
  } catch(e) {
    console.warn('[TemuExporter] readPageSelections error:', e.message);
    return {};
  }
}

function startSelectionPolling() {
  if (selPollInterval) return;
  _doPoll();
  selPollInterval = setInterval(_doPoll, 800);
}
function stopSelectionPolling() {
  clearInterval(selPollInterval);
  selPollInterval = null;
}

async function _doPoll() {
  if (activeTab !== 'select' || running) return;
  currentSelections = await readPageSelections();
  const count = Object.keys(currentSelections).length;
  const selCountEl  = $('selCount');
  const clearSelBtn = $('clearSelBtn');
  if (selCountEl)  selCountEl.textContent = count;
  if (clearSelBtn) clearSelBtn.disabled = (count === 0);
  autoBtn.disabled = (count === 0);
}

// Clear All — uncheck all checked orders on Temu page
const clearSelBtn = $('clearSelBtn');
if (clearSelBtn) {
  clearSelBtn.addEventListener('click', async () => {
    if (!currentListTabId) return;
    try {
      await chrome.scripting.executeScript({
        target: { tabId: currentListTabId },
        func: function() {
          // Click each checked label (Temu's React handler listens on the label)
          // Skip the header "select all" which may be indeterminate
          var checkedLabels = document.querySelectorAll('label[data-checked="true"]');
          checkedLabels.forEach(function(label) {
            if (label.getAttribute('data-indeterminate') !== 'true') {
              label.click();
            }
          });
        }
      });
    } catch(e) {}
    currentSelections = {};
    const selCountEl = $('selCount');
    if (selCountEl) selCountEl.textContent = '0';
    clearSelBtn.disabled = true;
    autoBtn.disabled = true;
  });
}

// ── Debug Detection button ────────────────────────────────────────────────────
const debugDetectBtn = $('debugDetectBtn');
const selDebugBox    = $('selDebugBox');
const selDebugPre    = $('selDebugPre');

if (debugDetectBtn) {
  debugDetectBtn.addEventListener('click', async () => {
    if (!currentListTabId) {
      if (selDebugPre) selDebugPre.textContent = 'ERROR: No list tab detected.';
      if (selDebugBox) selDebugBox.style.display = 'block';
      return;
    }
    debugDetectBtn.textContent = '⏳ Scanning…';
    debugDetectBtn.disabled = true;

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: currentListTabId },
        func: function() {
          var out = {};

          // 1. Count various checkbox indicators
          out.inputCheckboxTotal    = document.querySelectorAll('input[type="checkbox"]').length;
          out.inputCheckboxChecked  = document.querySelectorAll('input[type="checkbox"]:checked').length;
          out.antCheckedClass       = document.querySelectorAll('.ant-checkbox-checked').length;
          out.ariaCheckedTrue       = document.querySelectorAll('[aria-checked="true"]').length;

          // 2. Collect unique class names containing "check" on inputs
          var checkClasses = new Set();
          document.querySelectorAll('input[type="checkbox"]').forEach(function(cb) {
            cb.className.split(' ').forEach(function(c) {
              if (c) checkClasses.add(c);
            });
            // Also capture parent element classes
            if (cb.parentElement) {
              cb.parentElement.className.split(' ').forEach(function(c) {
                if (c && c.toLowerCase().includes('check')) checkClasses.add('PARENT:' + c);
              });
            }
          });
          out.inputClasses = Array.from(checkClasses).join(', ') || '(none)';

          // 3. Sample checked parent element classes
          var checkedParentClasses = [];
          var cbChecked = document.querySelectorAll('input[type="checkbox"]:checked');
          cbChecked.forEach(function(cb) {
            var el = cb;
            for (var i = 0; i < 4; i++) {
              if (!el.parentElement) break;
              el = el.parentElement;
              if (el.className) checkedParentClasses.push(el.tagName + '.' + el.className.replace(/\s+/g, '.'));
            }
          });
          out.checkedParentClasses = checkedParentClasses.slice(0, 8).join('\n') || '(none)';

          // 4. PO numbers visible in tr rows (regardless of checked state)
          var pos = [];
          document.querySelectorAll('tr').forEach(function(tr) {
            var m = (tr.textContent || '').match(/\b(PO-\d+-\d{9,})\b/);
            if (m) pos.push(m[1]);
          });
          out.poNumbersFound = pos.slice(0, 5).join(', ') || '(none)';

          // 5. Sample row structure around first checkbox
          var firstCb = document.querySelector('input[type="checkbox"]');
          if (firstCb) {
            var el = firstCb;
            var path = [];
            for (var i = 0; i < 5; i++) {
              path.unshift(el.tagName + (el.className ? '.' + el.className.trim().split(' ')[0] : ''));
              if (!el.parentElement) break;
              el = el.parentElement;
            }
            out.checkboxDOMPath = path.join(' → ');
          } else {
            out.checkboxDOMPath = 'No input[type=checkbox] found!';
          }

          // 6. Check if "Action on X selected" banner exists
          var actionText = '';
          document.querySelectorAll('*').forEach(function(el) {
            if (el.children.length === 0) {
              var t = el.textContent || '';
              if (t.match(/Action on \d+ selected/)) actionText = t.trim();
            }
          });
          out.actionBannerText = actionText || '(not found)';

          return out;
        }
      });

      if (results && results[0] && results[0].result) {
        const r = results[0].result;
        const txt = [
          `input[checkbox] total   : ${r.inputCheckboxTotal}`,
          `input[checkbox] checked : ${r.inputCheckboxChecked}`,
          `.ant-checkbox-checked   : ${r.antCheckedClass}`,
          `[aria-checked=true]     : ${r.ariaCheckedTrue}`,
          ``,
          `input classes           : ${r.inputClasses}`,
          ``,
          `checked parent classes  :`,
          r.checkedParentClasses,
          ``,
          `PO numbers in rows      : ${r.poNumbersFound}`,
          ``,
          `checkbox DOM path       : ${r.checkboxDOMPath}`,
          ``,
          `"Action on X" banner    : ${r.actionBannerText}`
        ].join('\n');

        if (selDebugPre) selDebugPre.textContent = txt;
        if (selDebugBox) selDebugBox.style.display = 'block';
      } else {
        if (selDebugPre) selDebugPre.textContent = 'Script returned no result.\nTab may be on a different domain or blocked.';
        if (selDebugBox) selDebugBox.style.display = 'block';
      }
    } catch(err) {
      if (selDebugPre) selDebugPre.textContent = 'Error: ' + err.message;
      if (selDebugBox) selDebugBox.style.display = 'block';
    }

    debugDetectBtn.textContent = '🔍 Debug Detection';
    debugDetectBtn.disabled = false;
  });
}

// ── Button handlers ───────────────────────────────────────────────────────────

autoBtn.addEventListener('click', async () => {
  if (running) return;
  const speed = SPEED_PRESETS[parseInt(speedSlider.value) || 2];

  // ── MODE: By Pages ──────────────────────────────────────────────────────────
  if (activeTab === 'pages') {
    const from = parseInt(fromPage.value) || 1;
    const to   = parseInt(toPage.value)   || 1;
    if (from > to) { setStatus('❌', '"From Page" cannot be greater than "To Page".', 'error'); return; }
    if (!currentListTabId) { setStatus('❌', 'List tab lost — close and reopen popup.', 'error'); return; }

    const filterOn  = dateFilterEnabled.checked;
    const fFromDate = fromDate.value;
    const fToDate   = toDate.value;
    if (filterOn) {
      if (!fFromDate || !fToDate) { setStatus('❌', 'Date filter on hai — From aur To datetime dono bharein.', 'error'); return; }
      if (fFromDate >= fToDate) { setStatus('❌', '"From Date & Time" "To Date & Time" se pehle honi chahiye.', 'error'); return; }
    }

    running = true;
    failBox.style.display = 'none';
    statPages.classList.remove('active');
    statOrders.classList.remove('active');
    statPagesVal.textContent  = '0';
    statOrdersVal.textContent = '0';
    progressSec.style.display = 'block';
    stepsRow.style.display    = 'flex';
    setStep('navigating');
    setProgress(0, 'Starting…');
    setStatus('🚀', `Auto-export started! Pages ${from}–${to}`, 'info');
    autoBtnTxt.textContent = '⏳ Running…';
    autoBtn.disabled = true;

    chrome.runtime.sendMessage({
      type: 'startAutoExport',
      listTabId: currentListTabId,
      fromPage: from, toPage: to,
      format: autoFormat.value,
      tabDelay: speed.tabDelay,
      randExtra: speed.randExtra,
      filterEnabled: filterOn,
      filterFromDate: fFromDate,
      filterToDate:   fToDate
    });
  }

  // ── MODE: By Date Range ─────────────────────────────────────────────────────
  else if (activeTab === 'date') {
    const dFrom = $('dateFrom').value;
    const dTo   = $('dateTo').value;
    if (!dFrom || !dTo) { setStatus('❌', 'Please set both From Date and To Date.', 'error'); return; }
    if (dFrom > dTo) { setStatus('❌', '"From Date" must be before "To Date".', 'error'); return; }
    if (!currentListTabId) { setStatus('❌', 'List tab lost — close and reopen popup.', 'error'); return; }

    running = true;
    failBox.style.display = 'none';
    statPages.classList.remove('active');
    statOrders.classList.remove('active');
    statPagesVal.textContent  = '?';
    statOrdersVal.textContent = '0';
    progressSec.style.display = 'block';
    stepsRow.style.display    = 'flex';
    setStep('navigating');
    setProgress(0, 'Starting date scan…');
    setStatus('📅', `Scanning all pages for orders in date range…`, 'info');
    autoBtnTxt.textContent = '⏳ Scanning…';
    autoBtn.disabled = true;

    chrome.runtime.sendMessage({
      type: 'startDateExport',
      listTabId: currentListTabId,
      fromDate: dFrom,
      toDate:   dTo,
      format: autoFormat.value,
      tabDelay:  speed.tabDelay,
      randExtra: speed.randExtra
    });
  }

  // ── MODE: By Selection ──────────────────────────────────────────────────────
  else if (activeTab === 'select') {
    // Final fresh read from page before exporting
    currentSelections = await readPageSelections();
    const selectedUrls = Object.values(currentSelections);

    if (selectedUrls.length === 0) {
      setStatus('❌', 'No orders selected. Tick orders on the Temu page first.', 'error');
      return;
    }

    running = true;
    stopSelectionPolling();
    failBox.style.display = 'none';
    statPages.classList.remove('active');
    statOrders.classList.remove('active');
    statPagesVal.textContent  = selectedUrls.length;
    statOrdersVal.textContent = '0';
    progressSec.style.display = 'block';
    stepsRow.style.display    = 'flex';
    setStep('extracting');
    setProgress(0, 'Starting selection export…');
    setStatus('☑', `Exporting ${selectedUrls.length} selected orders…`, 'info');
    autoBtnTxt.textContent = '⏳ Running…';
    autoBtn.disabled = true;

    chrome.runtime.sendMessage({
      type: 'startSelectionExport',
      selectedUrls,
      format: autoFormat.value,
      tabDelay:  speed.tabDelay,
      randExtra: speed.randExtra
    });
  }
});

manualBtn.addEventListener('click', () => {
  if (running) return;
  running = true;
  failBox.style.display = 'none';
  statOrdersVal.textContent = '0';
  progressSec.style.display = 'block';
  stepsRow.style.display    = 'none';
  setProgress(0, 'Starting export…');
  setStatus('⏳', 'Exporting…', 'info');
  manualBtnTxt.textContent = '⏳ Exporting…';
  manualBtn.disabled = true;
  chrome.runtime.sendMessage({ type: 'startExport', format: manualFormat.value });
});

// ── Init ──────────────────────────────────────────────────────────────────────
init();
calcEstimate();
speedVal.textContent = SPEED_PRESETS[parseInt(speedSlider.value)].label;
initDateDefaults();

// Set defaults for date export tab
(function setDateTabDefaults() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const toISO = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const dateTo = $('dateTo');
  const dateFrom = $('dateFrom');
  if (dateTo) dateTo.value = toISO(now);
  if (dateFrom) {
    const from7 = new Date(now);
    from7.setDate(from7.getDate() - 7);
    from7.setHours(0, 0, 0, 0);
    dateFrom.value = toISO(from7);
  }
})();
