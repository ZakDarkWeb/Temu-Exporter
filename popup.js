/* Temu Order Exporter v8.8.7 — minimal selection-memory popup */
(() => {
  'use strict';

  const SELECTED_ORDERS_KEY = 'temuSelectedOrders_v2';
  const SELECTED_SHIPPED_KEY = 'temuSelectedShipped_v1';
  const LEGACY_SELECTION_KEY = 'temuSelections_v6';
  let activeTabId = null;
  let pollTimer = null;
  let lastCount = -1;

  const $ = id => document.getElementById(id);
  const setStatus = (text, kind = '') => {
    const box = $('statusBox');
    if (box) box.className = `status ${kind}`.trim();
    const msg = $('statusMsg');
    if (msg) msg.textContent = text;
  };

  function modeFromUrl(url = '') {
    try {
      const u = new URL(url);
      const active = u.searchParams.get('activeTab');
      if (active === '2') return 'Unshipped';
      if (active === '3' || active === '4') return 'Shipped';
      if (u.pathname.includes('orders')) return 'Orders';
      return 'Other';
    } catch (_) { return 'Orders'; }
  }

  async function getTemuTab() {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const tab = tabs.find(t => /^https:\/\/seller\.temu\.com\//i.test(t.url || ''));
    activeTabId = tab?.id || null;
    return tab || null;
  }

  async function readPageDetection(tabId) {
    if (!tabId) return { mode: 'No Temu tab', visiblePOs: [], checkedPOs: [], checkboxTotal: 0, checkboxChecked: 0, pageUrl: '' };
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const textOf = el => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
          const extractPO = text => (text.match(/PO-\d+-\d{8,}/) || [])[0] || '';
          const rows = Array.from(document.querySelectorAll('tr[data-testid="beast-core-table-body-tr"], tr'))
            .filter(row => !row.querySelector('th'));
          const visiblePOs = [];
          const checkedPOs = [];
          const checkedIn = row => {
            const box = row.querySelector('[data-testid="beast-core-checkbox"]');
            const input = box?.querySelector('input[type="checkbox"]') || row.querySelector('input[type="checkbox"]');
            return box?.getAttribute('data-checked') === 'true' || box?.getAttribute('aria-checked') === 'true' || !!input?.checked || !!row.querySelector('[data-checked="true"]');
          };
          rows.forEach(row => {
            const po = extractPO(textOf(row));
            if (!po) return;
            visiblePOs.push(po);
            if (checkedIn(row)) checkedPOs.push(po);
          });
          const allInputs = document.querySelectorAll('input[type="checkbox"]');
          const checkedInputs = document.querySelectorAll('input[type="checkbox"]:checked');
          return {
            mode: (() => { const a = new URLSearchParams(location.search).get('activeTab'); return a === '2' ? 'Unshipped' : (a === '3' || a === '4') ? 'Shipped' : 'Orders'; })(),
            pageUrl: location.href,
            visiblePOs: [...new Set(visiblePOs)],
            checkedPOs: [...new Set(checkedPOs)],
            checkboxTotal: allInputs.length,
            checkboxChecked: checkedInputs.length,
            actionBanner: [...document.querySelectorAll('*')].map(el => textOf(el)).find(t => /^Action on \d+ selected$/.test(t)) || ''
          };
        }
      });
      return results?.[0]?.result || { mode: 'Unknown', visiblePOs: [], checkedPOs: [], checkboxTotal: 0, checkboxChecked: 0, pageUrl: '' };
    } catch (error) {
      return { mode: 'Script error', visiblePOs: [], checkedPOs: [], checkboxTotal: 0, checkboxChecked: 0, pageUrl: '', error: error.message };
    }
  }

  async function getSavedCount() {
    const data = await chrome.storage.local.get([SELECTED_ORDERS_KEY, LEGACY_SELECTION_KEY]);
    const orders = data[SELECTED_ORDERS_KEY]?.orders || {};
    const durable = new Set(Object.values(orders).map(item => item?.orderNumber).filter(Boolean));
    if (durable.size) return durable.size;
    const legacy = data[LEGACY_SELECTION_KEY] || {};
    const fallback = new Set();
    Object.keys(legacy).forEach(key => {
      const group = legacy[key];
      if (!key.startsWith('page:') || !group || typeof group !== 'object') return;
      Object.keys(group).forEach(po => fallback.add(po));
    });
    return fallback.size;
  }

  async function refreshPopup() {
    const tab = await getTemuTab();
    const page = await readPageDetection(activeTabId);
    const count = await getSavedCount();
    if ($('headerSub')) $('headerSub').textContent = tab ? `${page.mode} · selection memory active` : 'Open Temu Manage Orders';
    if ($('selectionTab')) $('selectionTab').textContent = page.mode || modeFromUrl(tab?.url);
    if ($('selCount')) $('selCount').textContent = String(count);
    if ($('clearSelBtn')) $('clearSelBtn').disabled = count === 0;
    if ($('selDetectTxt')) $('selDetectTxt').textContent = tab ? `${page.checkedPOs.length} checked on this page · ${page.visiblePOs.length} orders visible` : 'No Temu Manage Orders tab detected';
    if (count !== lastCount) {
      lastCount = count;
      setStatus(count ? `${count} order${count === 1 ? '' : 's'} remembered` : 'Select orders on Unshipped to remember them', count ? 'success' : '');
    }
  }

  async function clearSelection() {
    await chrome.storage.local.remove([SELECTED_ORDERS_KEY, SELECTED_SHIPPED_KEY, LEGACY_SELECTION_KEY, 'temuLabelRun_v1']);
    lastCount = -1;
    await refreshPopup();
    setStatus('Saved selection cleared', 'success');
  }

  async function showDebug() {
    const box = $('selDebugBox');
    const pre = $('selDebugPre');
    const button = $('debugDetectBtn');
    if (!box || !pre) return;
    box.style.display = 'block';
    if (button) { button.disabled = true; button.textContent = 'Scanning…'; }
    const tab = await getTemuTab();
    const page = await readPageDetection(activeTabId);
    const saved = await chrome.storage.local.get([SELECTED_ORDERS_KEY, LEGACY_SELECTION_KEY]);
    const savedOrders = Object.values(saved[SELECTED_ORDERS_KEY]?.orders || {}).map(item => item?.orderNumber).filter(Boolean);
    pre.textContent = [
      `URL: ${page.pageUrl || tab?.url || '(none)'}`,
      `Mode: ${page.mode || '(unknown)'}`,
      `Visible order rows: ${page.visiblePOs.length}`,
      `Checked order rows: ${page.checkedPOs.length}`,
      `Checkbox inputs: ${page.checkboxTotal}`,
      `Checked inputs: ${page.checkboxChecked}`,
      `Action banner: ${page.actionBanner || '(not found)'}`,
      `Remembered Order Nos: ${savedOrders.length}`,
      `Current checked POs: ${page.checkedPOs.join(', ') || '(none)'}`,
      page.error ? `Error: ${page.error}` : ''
    ].filter(Boolean).join('\n');
    if (button) { button.disabled = false; button.textContent = 'Debug Detection'; }
  }

  $('clearSelBtn')?.addEventListener('click', () => clearSelection().catch(error => setStatus(error.message, 'error')));
  $('debugDetectBtn')?.addEventListener('click', () => showDebug().catch(error => setStatus(error.message, 'error')));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes[SELECTED_ORDERS_KEY] || changes[SELECTED_SHIPPED_KEY] || changes[LEGACY_SELECTION_KEY])) refreshPopup().catch(() => {});
  });

  refreshPopup().catch(error => setStatus(error.message, 'error'));
  pollTimer = setInterval(() => refreshPopup().catch(() => {}), 1500);
  window.addEventListener('unload', () => clearInterval(pollTimer));
})();
