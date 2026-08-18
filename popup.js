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
const statPagesRing  = $('statPagesRing');
const statOrdersRing = $('statOrdersRing');
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
const cancelBtn     = $('cancelBtn');     // IMP 4
const liveCounter   = $('liveCounter');  // IMP 5

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

// ── Cancel button (IMP 4) ─────────────────────────────────────────────────────
cancelBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'cancelExport' });
  cancelBtn.disabled = true;
  cancelBtn.querySelector('span:last-child').textContent = 'Stopping…';
});

// ── Quick Date buttons (IMP 1+2) ──────────────────────────────────────────────

$('btnToday').addEventListener('click', () => {
  const now = new Date();
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  $('dateFrom').value = toLocalISO(start);
  $('dateTo').value   = toLocalISO(now);
});
$('btnYesterday').addEventListener('click', () => {
  const now = new Date();
  const start = new Date(now); start.setDate(start.getDate() - 1); start.setHours(0, 0, 0, 0);
  const end   = new Date(now); end.setDate(end.getDate() - 1);   end.setHours(23, 59, 59, 0);
  $('dateFrom').value = toLocalISO(start);
  $('dateTo').value   = toLocalISO(end);
});
$('btnLast7').addEventListener('click', () => {
  const now = new Date();
  const start = new Date(now); start.setDate(start.getDate() - 7); start.setHours(0, 0, 0, 0);
  $('dateFrom').value = toLocalISO(start);
  $('dateTo').value   = toLocalISO(now);
});

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

// ring circumference for r=30: 2*PI*30 ≈ 188.5
const RING_CIRC = 188;
const _ringMax = { pages: 10, orders: 500 }; // sensible maximums for arc fill

function updateRing(ringEl, val, maxVal) {
  if (!ringEl) return;
  const pct = Math.min(val / maxVal, 1);
  ringEl.style.strokeDashoffset = RING_CIRC * (1 - pct);
}

function bumpStat(el, val) {
  el.textContent = val;
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
  // update SVG ring
  if (el === statPagesVal)  updateRing(statPagesRing,  Number(val) || 0, _ringMax.pages);
  if (el === statOrdersVal) updateRing(statOrdersRing, Number(val) || 0, _ringMax.orders);
}

function setButtonLoading(btn, txtEl, loading, label) {
  if (loading) {
    btn.classList.add('loading');
    if (label) txtEl.textContent = label;
  } else {
    btn.classList.remove('loading');
  }
}

function setStep(stage) {
  // stage: 'navigating' | 'scraping' | 'extracting' | 'retrying' | 'done'
  const steps = [
    $('stepNav'), $('stepScrape'), $('stepExtract'), $('stepRetry')
  ];
  const map = { navigating: 0, scraping: 1, extracting: 2, retrying: 3, done: 4 };
  const active = map[stage] ?? -1;
  steps.forEach((el, i) => {
    el.className = 'step' + (i < active ? ' done' : i === active ? ' active' : '');
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
// Date mode max-pages stepper
wire('dateMaxPagesMinus', 'dateMaxPages', -1);
wire('dateMaxPagesPlus',  'dateMaxPages', +1);

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
      checkLabelRun();
    } else if (pageType === 'orders-other') {
      currentMode      = 'auto';
      currentListTabId = tab.id;
      showAutoMode(false);
      checkLabelRun();
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
    cancelBtn.style.display   = 'flex'; // IMP 4: show cancel while running
    setStep(msg.stage);

    if (msg.stage === 'navigating') {
      setProgress(2, `Navigating to page ${msg.page}…`);
      setStatus('🗺️', `Jumping to start page…`, 'info');
      liveCounter.style.display = 'none';
    }
    else if (msg.stage === 'scraping') {
      const pct = 2 + (msg.page / (msg.page + msg.totalPages)) * 28;
      setProgress(pct, `Reading page ${msg.page} — ${msg.scraped} links collected`);
      setStatus('📋', `Scanning page ${msg.page}… (${msg.scraped} orders found)`, 'info');
      bumpStat(statPagesVal, msg.page);
      setButtonLoading(autoBtn, autoBtnTxt, true, `⏳ Page ${msg.page}…`);
      liveCounter.style.display = 'none';
    }
    else if (msg.stage === 'extracting') {
      const pct = 30 + (msg.total > 0 ? (msg.current / msg.total) * 55 : 0);
      setProgress(pct, `Extracting order ${msg.current + 1} / ${msg.total}`);
      setStatus('⚡', `Extracting 1 by 1… ${msg.current}/${msg.total} done`, 'info');
      bumpStat(statOrdersVal, msg.current);
      // IMP 5: live extracted/failed counter
      if (msg.extracted !== undefined) {
        liveCounter.style.display = 'block';
        liveCounter.innerHTML = `✅ <strong>${msg.extracted}</strong> extracted&nbsp;&nbsp;${msg.failed ? `⚠️ <strong>${msg.failed}</strong> failed` : ''}`;
      }
    }
    else if (msg.stage === 'retrying') {
      const pct = 85 + (msg.retryTotal > 0 ? (msg.retrying / msg.retryTotal) * 13 : 0);
      setProgress(pct, `Retrying failed: ${msg.retrying} / ${msg.retryTotal}`);
      setStatus('🔄', `Retrying ${msg.retryTotal} failed order${msg.retryTotal > 1 ? 's' : ''}… (${msg.retrying}/${msg.retryTotal})`, 'info');
      if (msg.extracted !== undefined) {
        liveCounter.style.display = 'block';
        liveCounter.innerHTML = `✅ <strong>${msg.extracted}</strong> extracted&nbsp;&nbsp;${msg.failed ? `⚠️ <strong>${msg.failed}</strong> failed` : ''}`;
      }
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
    liveCounter.style.display = 'none';
    cancelBtn.style.display   = 'none';
    setStep('done');
    setButtonLoading(autoBtn, autoBtnTxt, false);
    bumpStat(statOrdersVal, msg.rowsExported);
    bumpStat(statPagesVal,  msg.pagesScraped);
    statPages.classList.add('active');
    statOrders.classList.add('active');
    showFailBox(msg.failedCount, msg.failedOrders || []);
    let doneMsg = `${msg.ordersFound} orders → ${msg.rowsExported} rows exported!`;
    if (msg.failedCount) doneMsg += ` (${msg.failedCount} failed — see below)`;
    if (msg.filterEnabled && msg.filterFromDate && msg.filterToDate) {
      doneMsg += ` | Date: ${msg.filterFromDate} → ${msg.filterToDate}`;
    }
    setStatus(msg.failedCount ? '⚠️' : '🎉', doneMsg, msg.failedCount ? 'info' : 'success');
    autoBtnTxt.textContent = '✅ Done!'; autoBtn.disabled = true;
    setTimeout(() => { autoBtnTxt.textContent = getAutoBtnLabel(); autoBtn.disabled = false; running = false; }, 4000);
  }

  else if (msg.type === 'error') {
    progressSec.style.display = 'none';
    liveCounter.style.display = 'none';
    cancelBtn.style.display   = 'none';
    // IMP 10: Better error messages for common failures
    let errMsg = msg.message || 'An error occurred.';
    if (/Script returned no result/i.test(errMsg)) {
      errMsg = 'Temu page not loaded yet. Please make sure the Shipped tab is open and fully loaded, then try again.';
    } else if (/Page scraping failed/i.test(errMsg)) {
      errMsg = 'Could not read orders from the list page. Make sure you are on the Shipped tab and the page is visible.';
    } else if (/Cannot access/i.test(errMsg)) {
      errMsg = 'Cannot access the Temu tab. Try closing and reopening the extension.';
    }
    setStatus('❌', errMsg, 'error');
    running = false;
    setButtonLoading(autoBtn,   autoBtnTxt,   false);
    setButtonLoading(manualBtn, manualBtnTxt, false);
    autoBtn.disabled = manualBtn.disabled = false;
    autoBtnTxt.textContent   = getAutoBtnLabel();
    manualBtnTxt.textContent = '⬇️ Export Open Tabs';
  }

  else if (msg.type === 'noData') {
    progressSec.style.display = 'none';
    liveCounter.style.display = 'none';
    cancelBtn.style.display   = 'none';
    const filterHint = msg.filterEnabled ? ' Date filter active — shayad koi order is range mein nahi tha.' : '';
    setStatus('⚠️', `No data extracted.${msg.failedCount ? ` ${msg.failedCount} tabs failed.` : ''}${filterHint}`, 'error');
    running = false;
    autoBtn.disabled = manualBtn.disabled = false;
    autoBtnTxt.textContent  = getAutoBtnLabel();
    manualBtnTxt.textContent = '⬇️ Export Open Tabs';
  }

  else if (msg.type === 'cancelled') {
    progressSec.style.display = 'none';
    liveCounter.style.display = 'none';
    cancelBtn.style.display   = 'none';
    cancelBtn.disabled = false;
    cancelBtn.querySelector('span:last-child').textContent = 'Stop Export';
    setStatus('⏹️', 'Export cancelled. You can start a new one.', 'info');
    running = false;
    setButtonLoading(autoBtn, autoBtnTxt, false);
    autoBtn.disabled = false;
    autoBtnTxt.textContent = getAutoBtnLabel();
  }
});

// ── Tab switching ─────────────────────────────────────────────────────────────

let activeTab = 'pages';  // 'pages' | 'date' | 'select' | 'sheets'

const tabContentMap = {
  pages:  $('tabContentPages'),
  date:   $('tabContentDate'),
  select: $('tabContentSelect'),
  sheets: $('tabContentSheets')
};

function getAutoBtnLabel() {
  if (activeTab === 'pages')  return '🚀 Start Auto-Export';
  if (activeTab === 'date')   return '🗓️ Start Date Export';
  if (activeTab === 'select') return '☑ Export Selected';
  if (activeTab === 'sheets') return null; // Sheets tab has its own buttons
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
  // Sheets tab has its own action buttons — hide/show main autoBtn
  const label = getAutoBtnLabel();
  if (label === null) {
    autoBtn.style.display = 'none';
  } else {
    if (currentMode === 'auto') autoBtn.style.display = 'flex';
    autoBtnTxt.textContent = label;
  }
  // IMP 8: remember last used tab
  chrome.storage.local.set({ lastActiveTab: tab }).catch(() => {});
  // Update selection count if switching to select tab
  if (tab === 'select') { startSelectionPolling(); checkLabelRun(); }
  else stopSelectionPolling();
  // Load sheets last sync info when switching to sheets tab
  if (tab === 'sheets') loadSheetsLastSync();
}

// Wire tab buttons
document.querySelectorAll('.mode-tab').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

// IMP 8: Restore last tab on startup
chrome.storage.local.get('lastActiveTab', ({ lastActiveTab }) => {
  if (lastActiveTab && tabContentMap[lastActiveTab]) {
    switchTab(lastActiveTab);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SHEETS SYNC MODULE v6.0
// ═══════════════════════════════════════════════════════════════════════════════

// Column metadata: { key, label }
const SHEETS_ALL_COLS = [
  { key: 'labelPurchasedDate', label: 'Label Date' },
  { key: 'trackingNumber',     label: 'Tracking No' },
  { key: 'orderNumber',        label: 'Order No' },
  { key: 'customerName',       label: 'Customer Name' },
  { key: 'productDetails',     label: 'Product Details' },
  { key: 'qty',                label: 'Qty' },
  { key: 'estimatedRevenue',   label: 'Est. Revenue' },
  { key: 'shippingCost',       label: 'Shipping Cost' },
  { key: 'shippingDate',       label: 'Ship Date' },
  { key: 'orderDate',          label: 'Order Date' },
];

// Pending rows for "Copy Again" button
let _lastSheetRows = [];

// ── TSV Builder ──────────────────────────────────────────────────────────────────

function buildTSV(rows, columns, includeHeaders) {
  const cols = columns.filter(c => SHEETS_ALL_COLS.some(a => a.key === c));
  const lines = [];
  if (includeHeaders) {
    const headers = cols.map(c => SHEETS_ALL_COLS.find(a => a.key === c)?.label || c);
    lines.push(headers.join('\t'));
  }
  rows.forEach(row => {
    const values = cols.map(c => {
      const v = row[c];
      if (v === undefined || v === null || v === '') return '';
      // Escape tabs and newlines in cell values
      return String(v).replace(/\t/g, ' ').replace(/\n/g, ' ');
    });
    lines.push(values.join('\t'));
  });
  return lines.join('\n');
}

// ── Clipboard write ────────────────────────────────────────────────────────────────

async function copyTextToClipboard(text) {
  try {
    // MV3 preferred method
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    // Fallback: execCommand (works when popup has focus + clipboardWrite permission)
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e2) { return false; }
  }
}

// ── Get selected columns from checkboxes ─────────────────────────────────────────

function getSelectedColumns() {
  const cols = [];
  document.querySelectorAll('#sheetsColGrid input[data-col]:checked').forEach(inp => {
    cols.push(inp.dataset.col);
  });
  // Preserve column order from SHEETS_ALL_COLS
  return SHEETS_ALL_COLS.map(c => c.key).filter(k => cols.includes(k));
}

// ── Duplicate detection registry (chrome.storage.local) ──────────────────────────

const REGISTRY_KEY   = 'temuSyncedOrders';
const REGISTRY_TTL_DAYS = 60; // remember synced orders for 60 days

async function loadSheetsRegistry() {
  try {
    const data = await chrome.storage.local.get(REGISTRY_KEY);
    const registry = data[REGISTRY_KEY] || {};
    // Clean old entries
    const cutoff = Date.now() - REGISTRY_TTL_DAYS * 86400000;
    Object.keys(registry).forEach(k => { if (registry[k] < cutoff) delete registry[k]; });
    return registry; // { orderNumber: syncedAtTimestamp }
  } catch (_) { return {}; }
}

async function updateSheetsRegistry(orderNumbers) {
  try {
    const registry = await loadSheetsRegistry();
    const now = Date.now();
    orderNumbers.forEach(on => { registry[on] = now; });
    await chrome.storage.local.set({ [REGISTRY_KEY]: registry });
  } catch (_) {}
}

// ── Last sync info display ───────────────────────────────────────────────────────────────

async function loadSheetsLastSync() {
  try {
    const data = await chrome.storage.local.get(['temuLastSync', 'temuLastSyncCount']);
    const el = $('sheetsLastSync');
    if (!el) return;
    if (data.temuLastSync) {
      const d = new Date(data.temuLastSync);
      const timeStr = d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      el.style.display = 'block';
      el.innerHTML = `Last sync: <strong>${timeStr}</strong> — <strong>${data.temuLastSyncCount || 0}</strong> orders`;
    }
    // Also update dup badge
    const registry = await loadSheetsRegistry();
    const dupBadge = $('sheetsDupBadge');
    const dupCount = Object.keys(registry).length;
    if (dupBadge && dupCount > 0) {
      dupBadge.style.display = 'inline-flex';
      dupBadge.textContent = `${dupCount} already synced`;
    }
  } catch (_) {}
}

async function saveLastSync(count) {
  await chrome.storage.local.set({ temuLastSync: Date.now(), temuLastSyncCount: count }).catch(() => {});
}

// ── Core: copy rows to clipboard after syncing ─────────────────────────────────────

async function processSheetsSyncResult(rows, ordersFound, failedCount) {
  if (!rows || rows.length === 0) {
    setStatus('⚠️', 'No orders found in selected date range.', 'error');
    return;
  }

  const columns         = getSelectedColumns();
  const includeHeaders  = $('sheetsIncludeHeaders')?.checked !== false;
  const newOnly         = $('sheetsNewOnly')?.checked || false;

  // Duplicate filtering
  const registry = await loadSheetsRegistry();
  let rowsToExport = rows;
  let dupCount = 0;
  if (newOnly) {
    rowsToExport = rows.filter(r => !registry[r.orderNumber]);
    dupCount = rows.length - rowsToExport.length;
  }

  if (rowsToExport.length === 0) {
    setStatus('ℹ️', `All ${rows.length} orders were already synced before. Uncheck "New Only" to copy all.`, 'info');
    return;
  }

  const tsv = buildTSV(rowsToExport, columns, includeHeaders);
  const copied = await copyTextToClipboard(tsv);

  // Update registry
  const orderNums = rowsToExport.map(r => r.orderNumber).filter(Boolean);
  await updateSheetsRegistry(orderNums);
  await saveLastSync(rowsToExport.length);

  // Store for "Copy Again"
  _lastSheetRows = rows;

  // Show result card
  const resultEl    = $('sheetsResult');
  const countEl     = $('sheetsResultCount');
  const subEl       = $('sheetsResultSub');
  const failNoteEl  = $('sheetsFailNote');
  if (resultEl) {
    resultEl.style.display = 'block';
    countEl.innerHTML = copied
      ? `✅ ${rowsToExport.length} order${rowsToExport.length !== 1 ? 's' : ''} copied to clipboard!`
      : `⚠️ ${rowsToExport.length} rows ready (clipboard write failed — see below)`;
    subEl.textContent = dupCount > 0 ? `(${dupCount} duplicate${dupCount !== 1 ? 's' : ''} skipped)` : `${rows.length} total orders found`;
    failNoteEl.textContent = failedCount > 0 ? `⚠️ ${failedCount} order${failedCount !== 1 ? 's' : ''} failed to extract` : '';
  }

  if (copied) {
    setStatus('📋', `${rowsToExport.length} rows copied! Open Sheets → Ctrl+V to paste.`, 'success');
  } else {
    // Fallback: show manual copy textarea
    setStatus('⚠️', 'Clipboard blocked. Data is ready — try clicking "Copy Again" button.', 'info');
  }

  // Update last sync display
  await loadSheetsLastSync();
}

// ── Message handler for sheetsSyncReady ───────────────────────────────────────────────
// Add to existing chrome.runtime.onMessage listener:

chrome.runtime.onMessage.addListener(msg => {
  if (msg.type !== 'sheetsSyncReady') return;

  // Hide progress, cancel button
  progressSec.style.display = 'none';
  liveCounter.style.display = 'none';
  cancelBtn.style.display   = 'none';
  running = false;

  // Disable all sheets sync buttons
  ['sheetsSyncToday','sheetsSyncYesterday','sheetsSyncLast7','sheetsSyncCustomBtn'].forEach(id => {
    const el = $(id); if (el) el.disabled = false;
  });

  // Read rows from session storage and process
  chrome.storage.session.get('sheetsSyncRows', async data => {
    try {
      const rows = data.sheetsSyncRows ? JSON.parse(data.sheetsSyncRows) : [];
      await processSheetsSyncResult(rows, msg.ordersFound, msg.failedCount);
    } catch (e) {
      setStatus('❌', 'Failed to process synced data: ' + e.message, 'error');
    }
    // Clear session data
    chrome.storage.session.remove('sheetsSyncRows').catch(() => {});
  });
});

// ── Helper: kick off a Sheets Sync for a given date range ───────────────────────────

function startSheetsSync(fromDate, toDate, maxPages = 10) {
  if (!currentListTabId) {
    setStatus('⚠️', 'Please open the Temu Shipped orders tab first.', 'error');
    return;
  }
  running = true;
  // Show progress UI
  progressSec.style.display = 'block';
  stepsRow.style.display    = 'flex';
  cancelBtn.style.display   = 'flex';
  liveCounter.style.display = 'none';
  $('sheetsResult').style.display = 'none';
  setStatus('🔄', 'Scanning Shipped orders…', 'info');

  // Disable all sheets sync buttons during run
  ['sheetsSyncToday','sheetsSyncYesterday','sheetsSyncLast7','sheetsSyncCustomBtn'].forEach(id => {
    const el = $(id); if (el) el.disabled = true;
  });

  const speed     = speedSlider?.value || 2;
  const tabDelay  = speed === '1' ? 2000 : speed === '3' ? 600 : 1200;
  const randExtra = speed === '1' ? 1500 : speed === '3' ? 400 : 800;

  chrome.runtime.sendMessage({
    type: 'startSheetsSync', listTabId: currentListTabId,
    fromDate, toDate, tabDelay, randExtra, maxPages
  });
}

// ── Button Handlers for Sheets Tab ──────────────────────────────────────────────────

// Today's Labels
$('sheetsSyncToday').addEventListener('click', () => {
  const now   = new Date();
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  startSheetsSync(toLocalISO(start), toLocalISO(now), 15);
});

// Yesterday
$('sheetsSyncYesterday').addEventListener('click', () => {
  const now   = new Date();
  const start = new Date(now); start.setDate(start.getDate()-1); start.setHours(0,0,0,0);
  const end   = new Date(now); end.setDate(end.getDate()-1); end.setHours(23,59,59,0);
  startSheetsSync(toLocalISO(start), toLocalISO(end), 15);
});

// Last 7 days
$('sheetsSyncLast7').addEventListener('click', () => {
  const now   = new Date();
  const start = new Date(now); start.setDate(start.getDate()-7); start.setHours(0,0,0,0);
  startSheetsSync(toLocalISO(start), toLocalISO(now), 50);
});

// Toggle custom range panel
$('sheetsSyncCustom').addEventListener('click', () => {
  const panel = $('sheetsCustomRange');
  if (!panel) return;
  const isHidden = panel.style.display === 'none';
  panel.style.display = isHidden ? 'block' : 'none';
  if (isHidden && !$('sheetsDateFrom').value) {
    // Pre-fill with today
    const now = new Date(); const start = new Date(now); start.setHours(0,0,0,0);
    $('sheetsDateFrom').value = toLocalISO(start);
    $('sheetsDateTo').value   = toLocalISO(now);
  }
});

// Custom range sync
$('sheetsSyncCustomBtn').addEventListener('click', () => {
  const from = $('sheetsDateFrom').value;
  const to   = $('sheetsDateTo').value;
  if (!from || !to) { setStatus('⚠️', 'Please select both From and To dates.', 'error'); return; }
  startSheetsSync(from, to, 999);
});

// Copy Again
$('sheetsCopyAgain').addEventListener('click', async () => {
  if (!_lastSheetRows.length) { setStatus('⚠️', 'No data to copy. Run a sync first.', 'info'); return; }
  const columns = getSelectedColumns();
  const includeHeaders = $('sheetsIncludeHeaders')?.checked !== false;
  const tsv = buildTSV(_lastSheetRows, columns, includeHeaders);
  const ok = await copyTextToClipboard(tsv);
  if (ok) setStatus('📋', `${_lastSheetRows.length} rows copied again! Ctrl+V in Sheets.`, 'success');
  else setStatus('⚠️', 'Clipboard write failed.', 'error');
});

// Save column settings when changed
$('sheetsColGrid').addEventListener('change', () => {
  const cols = {};
  document.querySelectorAll('#sheetsColGrid input[data-col]').forEach(inp => {
    cols[inp.dataset.col] = inp.checked;
  });
  chrome.storage.local.set({ temuSheetsColumns: cols }).catch(() => {});
});

// Load saved column settings
chrome.storage.local.get('temuSheetsColumns', ({ temuSheetsColumns }) => {
  if (!temuSheetsColumns) return;
  document.querySelectorAll('#sheetsColGrid input[data-col]').forEach(inp => {
    if (inp.dataset.col in temuSheetsColumns) {
      inp.checked = temuSheetsColumns[inp.dataset.col];
    }
  });
});

// Check for pending sync data (popup was closed during sync, then reopened)
chrome.storage.session.get(['sheetsSyncRows', 'sheetsSyncOrderCount'], async data => {
  if (data.sheetsSyncRows) {
    try {
      const rows = JSON.parse(data.sheetsSyncRows);
      if (rows.length > 0) {
        // Switch to sheets tab and show result
        switchTab('sheets');
        setStatus('📋', `${rows.length} synced orders ready to copy! Click below.`, 'info');
        await processSheetsSyncResult(rows, rows.length, 0);
        chrome.storage.session.remove('sheetsSyncRows').catch(() => {});
      }
    } catch (_) {}
  }
});

// ── Selection Mode — direct page reading via executeScript ───────────────────
// No content script needed: popup directly reads Temu's native checkbox state

let selPollInterval  = null;
let currentSelections = {};   // { orderSn: detailUrl } — kept in memory

async function readPageSelections() {
  if (!currentListTabId) return { pageNum: '1', visiblePOs: [], checkedPOs: {} };
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: currentListTabId },
      func: function() {
        var checkedPOs = {};
        var visiblePOs = [];
        var baseUrl = window.location.origin + '/order-detail.html';

        function extractPO(text) {
          var m = text.match(/(PO-\d+-\d{8,})/);
          return m ? m[1] : null;
        }

        function isChecked(el) {
          var inp = el.querySelector('input[type="checkbox"]');
          if (inp && inp.checked) return true;
          if (el.querySelector('label[data-checked="true"], [data-checked="true"]')) return true;
          if (el.querySelector('.CBX_active_123, .CBX_hasCheckSquare_123.CBX_active_123')) return true;
          if (el.getAttribute && el.getAttribute('data-checked') === 'true') return true;
          if (el.classList && el.classList.contains('CBX_active_123')) return true;
          return false;
        }

        document.querySelectorAll('tr').forEach(function(tr) {
          if (tr.querySelector('th')) return; // skip header
          var sn = extractPO(tr.textContent || '');
          if (!sn) return;
          visiblePOs.push(sn);
          if (isChecked(tr)) {
            checkedPOs[sn] = baseUrl + '?parent_order_sn=' + encodeURIComponent(sn);
          }
        });

        // Fallback for checked labels
        if (Object.keys(checkedPOs).length === 0) {
          var checkedLabels = [].slice.call(document.querySelectorAll(
            'label[data-checked="true"], .CBX_active_123, input[type="checkbox"]:checked'
          ));
          checkedLabels.forEach(function(label) {
            if (label.getAttribute && label.getAttribute('data-indeterminate') === 'true') return;
            var el = label;
            for (var i = 0; i < 10; i++) {
              if (!el || !el.parentElement) break;
              el = el.parentElement;
              var sn = extractPO(el.textContent || '');
              if (sn && !checkedPOs[sn]) {
                checkedPOs[sn] = baseUrl + '?parent_order_sn=' + encodeURIComponent(sn);
                if (!visiblePOs.includes(sn)) visiblePOs.push(sn);
                break;
              }
            }
          });
        }

        // ── Unique page key detection using visible PO numbers fingerprint ────
        // Using visible POs fingerprint as the sole page identifier eliminates race conditions
        // between React table rendering and pagination rendering during transitions.
        var pageNum = '';
        if (visiblePOs && visiblePOs.length > 0) {
          pageNum = 'fp:' + visiblePOs.slice(0, 5).join('|');
        }
        if (!pageNum) pageNum = '1';

        return { pageNum: pageNum, visiblePOs: visiblePOs, checkedPOs: checkedPOs };
      }
    });

    if (!results || !results[0]) return { pageNum: '1', visiblePOs: [], checkedPOs: {} };
    return results[0].result || { pageNum: '1', visiblePOs: [], checkedPOs: {} };
  } catch(e) {
    console.warn('[TemuExporter] readPageSelections error:', e.message);
    return { pageNum: '1', visiblePOs: [], checkedPOs: {} };
  }
}

let accumulatedSelections = {};
chrome.storage.local.get(['temuSelections_v6'], (data) => {
  accumulatedSelections = data.temuSelections_v6 || {};
});

function startSelectionPolling() {
  if (selPollInterval) return;
  _doPoll();
  selPollInterval = setInterval(_doPoll, 600);
}
function stopSelectionPolling() {
  clearInterval(selPollInterval);
  selPollInterval = null;
}

async function _doPoll() {
  if (activeTab !== 'select' || running) return;
  const { pageNum, visiblePOs, checkedPOs } = await readPageSelections();

  chrome.storage.local.get(['temuSelections_v6'], (data) => {
    let stored = data.temuSelections_v6 || {};

    // Group selections by page to prevent page-change deletions
    const pageKey = 'page:' + (pageNum || '1');

    // Only update if we have a valid page and rows are loaded
    if (visiblePOs && visiblePOs.length > 0) {
      stored[pageKey] = checkedPOs || {};
      chrome.storage.local.set({ temuSelections_v6: stored });
    }

    // Sum all pages to get total current selections
    let allChecked = {};
    Object.keys(stored).forEach(key => {
      if (key.startsWith('page:')) {
        Object.assign(allChecked, stored[key] || {});
      }
    });

    currentSelections = allChecked;
    const count = Object.keys(currentSelections).length;
    const selCountEl  = $('selCount');
    const clearSelBtn = $('clearSelBtn');
    const saveBtn     = $('saveForLabelBtn');
    if (selCountEl)  selCountEl.textContent = count;
    if (clearSelBtn) clearSelBtn.disabled = (count === 0);
    if (saveBtn)     saveBtn.disabled = (count === 0);
    autoBtn.disabled = (count === 0);
  });
}

// ── Label Sync — Save for Label Run ─────────────────────────────────────────

const saveForLabelBtn = $('saveForLabelBtn');
const saveRunStatus   = $('saveRunStatus');

if (saveForLabelBtn) {
  saveForLabelBtn.addEventListener('click', () => {
    const poNumbers = Object.keys(currentSelections);
    if (poNumbers.length === 0) {
      if (saveRunStatus) saveRunStatus.textContent = '⚠️ No orders selected yet.';
      return;
    }
    const payload = {
      savedAt: new Date().toISOString(),
      poNumbers,
      count: poNumbers.length
    };
    chrome.storage.local.set({ temuLabelRun_v1: payload }, () => {
      if (saveRunStatus) {
        saveRunStatus.textContent = `✅ ${poNumbers.length} orders saved! Switch to Shipped tab to restore.`;
        setTimeout(() => { if (saveRunStatus) saveRunStatus.textContent = ''; }, 5000);
      }
    });
  });
}

// ── Label Sync — Check & Show Restore Banner ─────────────────────────────────

function checkLabelRun() {
  const banner      = $('restoreBanner');
  const countEl     = $('restoreCount');
  const savedAtEl   = $('restoreSavedAt');
  if (!banner) return;

  chrome.storage.local.get(['temuLabelRun_v1'], (data) => {
    const run = data.temuLabelRun_v1;
    if (run && run.count > 0 && Array.isArray(run.poNumbers)) {
      if (countEl)   countEl.textContent = run.count;
      if (savedAtEl) {
        try {
          const d = new Date(run.savedAt);
          const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
          savedAtEl.textContent = `Saved ${dateStr} at ${timeStr}`;
        } catch(e) { savedAtEl.textContent = ''; }
      }
      banner.style.display = 'flex';
    } else {
      banner.style.display = 'none';
    }
  });
}

// ── Label Sync — Restore Selection ──────────────────────────────────────────

const restoreSelBtn = $('restoreSelBtn');
const clearRunBtn   = $('clearRunBtn');
const restoreResult = $('restoreResult');

if (restoreSelBtn) {
  restoreSelBtn.addEventListener('click', async () => {
    if (!currentListTabId) {
      if (restoreResult) {
        restoreResult.className = 'restore-result none';
        restoreResult.textContent = '❌ No Temu tab detected. Open the popup from the Shipped orders page.';
      }
      return;
    }

    const data = await new Promise(r => chrome.storage.local.get(['temuLabelRun_v1'], r));
    const run = data.temuLabelRun_v1;
    if (!run || !run.poNumbers || run.poNumbers.length === 0) {
      if (restoreResult) {
        restoreResult.className = 'restore-result none';
        restoreResult.textContent = '❌ No saved label run found.';
      }
      return;
    }

    restoreSelBtn.textContent = '⏳ Restoring…';
    restoreSelBtn.disabled = true;

    try {
      const savedPOs = run.poNumbers;
      // ── Step 1: Run script on Temu tab to find which POs are visible ──────
      // Also attempt DOM clicks as visual aid (may not work on React checkboxes)
      const results = await chrome.scripting.executeScript({
        target: { tabId: currentListTabId },
        func: function(savedPOs, baseUrl) {
          var matched = [];
          var total = savedPOs.length;

          function extractPO(text) {
            var m = text.match(/(PO-\d+-\d{8,})/);
            return m ? m[1] : null;
          }

          // Build fingerprint from first 5 visible POs (same logic as readPageSelections)
          var visiblePOs = [];
          document.querySelectorAll('tr').forEach(function(tr) {
            if (tr.querySelector('th')) return;
            var sn = extractPO(tr.textContent || '');
            if (sn) visiblePOs.push(sn);
          });
          var pageFingerprint = visiblePOs.length > 0
            ? 'fp:' + visiblePOs.slice(0, 5).join('|')
            : '1';

          // Find rows that match saved POs and attempt DOM click (visual only)
          document.querySelectorAll('tr').forEach(function(tr) {
            if (tr.querySelector('th')) return;
            var sn = extractPO(tr.textContent || '');
            if (!sn || savedPOs.indexOf(sn) === -1) return;
            matched.push(sn);
            // Try React-compatible click simulation
            var cb = tr.querySelector('input[type="checkbox"]');
            if (!cb) cb = tr.querySelector('label[data-indeterminate!="true"]');
            if (cb) {
              ['mousedown','mouseup','click'].forEach(function(ev) {
                cb.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true }));
              });
            }
          });

          return { matched: matched, total: total, pageFingerprint: pageFingerprint, baseUrl: baseUrl };
        },
        args: [savedPOs, 'https://seller.temu.com/order-detail.html']
      });

      const res = results && results[0] && results[0].result;
      if (!res) throw new Error('Script returned no result');

      // ── Step 2: Directly write matched POs into temuSelections_v6 ─────────
      // This is the authoritative fix — bypasses React DOM checkbox state issue
      if (res.matched.length > 0) {
        const storageData = await new Promise(r => chrome.storage.local.get(['temuSelections_v6'], r));
        const stored = storageData.temuSelections_v6 || {};
        const pageKey = 'page:' + res.pageFingerprint;

        // Build the PO → URL map for matched orders
        const matchedMap = {};
        res.matched.forEach(po => {
          matchedMap[po] = res.baseUrl + '?parent_order_sn=' + encodeURIComponent(po);
        });

        // Merge with existing selections on this page (don't overwrite other pages)
        stored[pageKey] = Object.assign({}, stored[pageKey] || {}, matchedMap);
        await new Promise(r => chrome.storage.local.set({ temuSelections_v6: stored }, r));
      }

      // ── Step 3: Show result feedback ──────────────────────────────────────
      if (restoreResult) {
        if (res.matched.length === 0) {
          restoreResult.className = 'restore-result none';
          restoreResult.textContent = `❌ 0/${res.total} matched on this page. Try page 2 or check order status.`;
        } else if (res.matched.length < res.total) {
          restoreResult.className = 'restore-result partial';
          restoreResult.textContent = `⚡ ${res.matched.length}/${res.total} saved on this page — go to next page and click Restore again.`;
        } else {
          restoreResult.className = 'restore-result success';
          restoreResult.textContent = `✅ All ${res.matched.length} orders restored! Click Export Selected below.`;
        }
      }
    } catch(e) {
      if (restoreResult) {
        restoreResult.className = 'restore-result none';
        restoreResult.textContent = '❌ Error: ' + e.message;
      }
    }

    restoreSelBtn.textContent = '🔁 Restore Selection';
    restoreSelBtn.disabled = false;
  });
}

if (clearRunBtn) {
  clearRunBtn.addEventListener('click', () => {
    chrome.storage.local.remove('temuLabelRun_v1', () => {
      const banner = $('restoreBanner');
      if (banner) banner.style.display = 'none';
      if (restoreResult) { restoreResult.className = 'restore-result'; restoreResult.textContent = ''; }
    });
  });
}

// Clear All — uncheck all checked orders across all pages
const clearSelBtn = $('clearSelBtn');
if (clearSelBtn) {
  clearSelBtn.addEventListener('click', async () => {
    if (currentListTabId) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: currentListTabId },
          func: function() {
            var checkedLabels = document.querySelectorAll('label[data-checked="true"], input[type="checkbox"]:checked');
            checkedLabels.forEach(function(label) {
              if (label.getAttribute && label.getAttribute('data-indeterminate') !== 'true') {
                label.click();
              }
            });
          }
        });
      } catch(e) {}
    }
    accumulatedSelections = {};
    currentSelections = {};
    chrome.storage.local.set({ temuSelections_v6: {} });
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
    bumpStat(statPagesVal,  '0');
    bumpStat(statOrdersVal, '0');
    updateRing(statPagesRing,  0, _ringMax.pages);
    updateRing(statOrdersRing, 0, _ringMax.orders);
    progressSec.style.display = 'block';
    stepsRow.style.display    = 'flex';
    setStep('navigating');
    setProgress(0, 'Starting…');
    setStatus('🚀', `Auto-export started! Pages ${from}–${to}`, 'info');
    setButtonLoading(autoBtn, autoBtnTxt, true, `⏳ Starting…`);
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

    const maxPagesInput = $('dateMaxPages');
    const maxPages = Math.max(1, parseInt((maxPagesInput && maxPagesInput.value) || '10') || 10);

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
    setStatus('📅', `Scanning up to ${maxPages} pages for orders in date range…`, 'info');
    autoBtnTxt.textContent = '⏳ Scanning…';
    autoBtn.disabled = true;

    chrome.runtime.sendMessage({
      type: 'startDateExport',
      listTabId: currentListTabId,
      fromDate: dFrom,
      toDate:   dTo,
      maxPages,
      format: autoFormat.value,
      tabDelay:  speed.tabDelay,
      randExtra: speed.randExtra
    });
  }

  // ── MODE: By Selection ──────────────────────────────────────────────────────
  else if (activeTab === 'select') {
    // Read all accumulated selections across all pages from storage
    const storedData = await new Promise(r => chrome.storage.local.get(['temuSelections_v6'], r));
    const stored = storedData.temuSelections_v6 || {};
    
    // Flatten the page-grouped structure into a single unique set of URLs
    let allChecked = {};
    Object.keys(stored).forEach(key => {
      if (key.startsWith('page:')) {
        Object.assign(allChecked, stored[key] || {});
      } else if (typeof stored[key] === 'string') {
        allChecked[key] = stored[key];
      }
    });
    
    // Merge memory states
    if (accumulatedSelections) {
      Object.keys(accumulatedSelections).forEach(key => {
        if (key.startsWith('page:')) {
          Object.assign(allChecked, accumulatedSelections[key] || {});
        } else if (typeof accumulatedSelections[key] === 'string') {
          allChecked[key] = accumulatedSelections[key];
        }
      });
    }
    if (currentSelections) {
      Object.keys(currentSelections).forEach(key => {
        if (key.startsWith('page:')) {
          Object.assign(allChecked, currentSelections[key] || {});
        } else if (typeof currentSelections[key] === 'string') {
          allChecked[key] = currentSelections[key];
        }
      });
    }

    const selectedUrls = Object.values(allChecked).filter(url => typeof url === 'string' && url.startsWith('http'));

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
