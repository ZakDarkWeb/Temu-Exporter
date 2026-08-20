(() => {
  'use strict';

  const SELECTED_ORDERS_KEY = 'temuSelectedOrders_v2';
  const SELECTED_SHIPPED_KEY = 'temuSelectedShipped_v1';
  const selectedKeys = ['shippingDate','orderDate','trackingNumber','orderNumber','customerName','productDetails','qty','estimatedRevenue','shippingCost'];
  const selectedHeaders = ['Shipping Date','Order Date','Tracking Number','Order No','Customer Name','Product Details','Qty (No)','Est. Revenue','Shipping Cost'];
  const $ = id => document.getElementById(id);

  let currentTabId = null;
  let currentMode = 'orders';
  let busy = false;

  function setStatus(text, type = '') {
    $('statusText').textContent = text;
    $('status').className = `status ${type}`;
  }

  function setBusy(value) {
    busy = value;
    $('stateDot').classList.toggle('busy', value);
    $('refreshBtn').disabled = value;
    $('exportBtn').disabled = value;
    $('clearBtn').disabled = value;
    $('process').classList.toggle('visible', value);
  }

  function updateProcess(label, count = '', pct = 0) {
    $('processLabel').textContent = label;
    $('processCount').textContent = count;
    $('processBar').style.width = `${Math.max(0, Math.min(100, pct))}%`;
  }

  function showResult(tsv, rowCount) {
    $('tsvText').value = tsv || '';
    $('resultCount').textContent = `${rowCount || 0} rows`;
    $('result').classList.toggle('visible', !!tsv);
  }

  function cleanCell(value) {
    return String(value == null ? '' : value).replace(/[\t\r\n]+/g, ' ').trim();
  }

  function buildSelectedTsv(rows, headers = selectedHeaders) {
    const keys = headers.length === selectedHeaders.length ? selectedKeys : selectedKeys;
    return [headers, ...rows.map(row => keys.map(key => cleanCell(row[key])))].map(row => row.join('\t')).join('\n');
  }

  function copyFallback(text) {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.cssText = 'position:fixed;left:-10000px;top:0;opacity:0;';
    document.body.appendChild(area);
    area.focus(); area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) {}
    area.remove();
    return ok ? Promise.resolve() : Promise.reject(new Error('Clipboard blocked'));
  }

  function copyText(text) {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).catch(() => copyFallback(text));
    return copyFallback(text);
  }

  function matches(row, selected) {
    const item = selected.find(order => order.orderNumber === row.orderNumber);
    if (!item) return false;
    return (!item.packageId || !row.packageId || item.packageId === row.packageId) &&
      (!item.trackingNumber || !row.trackingNumber || item.trackingNumber === row.trackingNumber);
  }

  async function loadState() {
    const data = await chrome.storage.local.get([SELECTED_ORDERS_KEY, SELECTED_SHIPPED_KEY]);
    const selected = Object.values(data[SELECTED_ORDERS_KEY]?.orders || {});
    const shipped = data[SELECTED_SHIPPED_KEY] || {};
    const rows = (shipped.rows || []).filter(row => matches(row, selected));
    $('selectedCount').textContent = selected.length;
    $('matchedCount').textContent = rows.length;
    $('pendingCount').textContent = Math.max(0, selected.length - rows.length);
    $('contextLabel').textContent = currentMode === 'unshipped' ? 'Unshipped' : currentMode === 'shipped' ? 'Shipped' : 'Orders';
    $('hint').textContent = currentMode === 'shipped'
      ? 'Select Shipped rows directly or refresh all saved orders before exporting.'
      : 'Select orders on Unshipped or Shipped. The saved selection survives browser restarts.';
    $('exportBtn').disabled = busy || rows.length === 0;
    return { selected, rows };
  }

  async function detectCurrentTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    currentTabId = tab?.id || null;
    if (!tab?.url?.includes('seller.temu.com')) {
      setStatus('Open seller.temu.com to use the workflow.', 'error');
      $('refreshBtn').disabled = true; $('exportBtn').disabled = true;
      return;
    }
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: currentTabId },
        func: () => {
          const params = new URLSearchParams(location.search);
          const active = params.get('activeTab');
          if (active === '2') return 'unshipped';
          if (active === '3') return 'shipped';
          const candidates = Array.from(document.querySelectorAll('[data-testid="beast-core-tab-itemLabel"], [data-testid="beast-core-tab"], [role="tab"]'));
          const activeEl = candidates.find(el => {
            const parent = el.closest('[role="tab"], li, div');
            return el.getAttribute('aria-selected') === 'true' || parent?.getAttribute('aria-selected') === 'true' || /active|selected/i.test(`${el.className} ${parent?.className || ''}`);
          });
          const label = (activeEl?.innerText || activeEl?.textContent || '').trim();
          if (/^Unshipped/i.test(label)) return 'unshipped';
          if (/^Shipped/i.test(label)) return 'shipped';
          const text = (document.body?.innerText || '').slice(0, 5000);
          return /\bShipped\b/.test(location.href) ? 'shipped' : /\bUnshipped\b/.test(location.href) ? 'unshipped' : /\bShipped\b/.test(text) ? 'shipped' : 'orders';
        }
      });
      currentMode = result || 'orders';
    } catch (_) {
      currentMode = tab.url.includes('shipped') ? 'shipped' : tab.url.includes('unshipped') ? 'unshipped' : 'orders';
    }
    setStatus(currentMode === 'shipped' ? 'Ready on Shipped tab.' : currentMode === 'unshipped' ? 'Ready on Unshipped tab.' : 'Ready to use on an order tab.');
    await loadState();
  }

  function send(type, payload = {}) {
    if (!currentTabId) { setStatus('No active Temu tab found.', 'error'); return; }
    chrome.runtime.sendMessage({ type, listTabId: currentTabId, ...payload });
  }

  async function refreshShipped() {
    if (busy) return;
    setBusy(true); updateProcess('Scanning Shipped pages…', '0 orders', 5); setStatus('Scanning Shipped orders…', 'info');
    send('refreshSelectedShipped');
  }

  async function exportSheets() {
    if (busy) return;
    const state = await loadState();
    if (!state.rows.length) { setStatus('Select Shipped rows or refresh first.', 'error'); return; }
    setBusy(true); updateProcess('Opening order details…', `${state.rows.length} orders`, 10); setStatus(`Extracting ${state.rows.length} orders…`, 'info');
    send('exportSelectedLabelSheets', { rows: state.rows });
  }

  async function clearSelection() {
    await chrome.storage.local.remove([SELECTED_ORDERS_KEY, SELECTED_SHIPPED_KEY]);
    showResult('', 0); await loadState(); setStatus('Saved selection cleared.');
  }

  $('refreshBtn').addEventListener('click', refreshShipped);
  $('exportBtn').addEventListener('click', exportSheets);
  $('clearBtn').addEventListener('click', clearSelection);
  $('copyBtn').addEventListener('click', () => {
    copyText($('tsvText').value).then(() => setStatus('TSV copied — paste into Google Sheets.')).catch(() => setStatus('Clipboard blocked; copy from the text box.', 'error'));
  });

  chrome.runtime.onMessage.addListener(async msg => {
    if (!msg) return;
    if (msg.type === 'selectedShippedProgress') {
      const total = Number(msg.total || 0), current = Number(msg.current || 0);
      setBusy(true); updateProcess(msg.message || 'Scanning Shipped pages…', `${current}/${total} orders`, total ? 10 + current / total * 80 : 15);
      setStatus(`${current} matched / ${total} selected`, 'info');
    } else if (msg.type === 'progress') {
      const total = Number(msg.total || 0), current = Number(msg.current || 0);
      setBusy(true); updateProcess(`Extracting order ${Math.min(current + 1, total)}…`, `${current}/${total} orders`, total ? 10 + current / total * 85 : 20);
      setStatus(`Extracting ${total} orders…`, 'info');
    } else if (msg.type === 'selectedShippedReady') {
      setBusy(false); updateProcess('Shipped scan complete', `${msg.matchedCount || 0} matched`, 100); setStatus(`${msg.matchedCount || 0} matched · ${msg.pendingCount || 0} pending`); await loadState();
    } else if (msg.type === 'selectedLabelRowsReady') {
      setBusy(false); showResult(msg.tsv || buildSelectedTsv(msg.rows || [], msg.headers || selectedHeaders), (msg.rows || []).length); setStatus(`${(msg.rows || []).length} rows ready for Sheets.`); await loadState();
    } else if (msg.type === 'sheetsSyncReady' && msg.source === 'selected-label') {
      const data = await chrome.storage.session.get(['sheetsSyncRows', 'sheetsSyncHeaders']);
      const rows = data.sheetsSyncRows ? JSON.parse(data.sheetsSyncRows) : [];
      setBusy(false); showResult(buildSelectedTsv(rows, data.sheetsSyncHeaders || selectedHeaders), rows.length); setStatus(`${rows.length} rows ready for Sheets.`); await loadState();
    } else if (msg.type === 'selectedShippedError' || msg.type === 'selectedLabelExportError' || msg.type === 'error' || msg.type === 'noData') {
      setBusy(false); setStatus(msg.message || 'No rows were extracted.', 'error');
    }
  });

  detectCurrentTab().catch(error => setStatus(error.message || 'Unable to read the active Temu tab.', 'error'));
})();
