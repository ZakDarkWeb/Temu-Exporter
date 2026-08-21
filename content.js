(() => {
  'use strict';

  const STATE_KEY = 'temuOrderExporterStateV7';
  const BULK_PATH = '/buy-shipping-bulk-details.html';
  const DETAIL_PATH = '/order-detail.html';
  const PANEL_ID = 'temu-order-exporter-panel';
  const EXPORT_COLUMNS = [
    'Shipping Date',
    'Order Date',
    'Tracking Number',
    'Order No',
    'Customer Name',
    'Product Details',
    'Qty (No)',
    'Est. Revenue',
    'Shipping Cost'
  ];
  const TRACKING_RE = /\b(?:1Z[0-9A-Z]{8,}|GFUS[0-9A-Z]{8,}|[A-Z]{2,}\d{8,})\b/i;
  const AMOUNT_RE = /[$€£]\s?[\d,]+(?:\.\d{1,2})?/;
  const UI_KEY = 'temuOrderExporterUiV1';
  const HISTORY_KEY = 'temuOrderExporterHistoryV1';
  const HISTORY_LIMIT = 20;

  let state = defaultState();
  let panel = null;
  let logBox = null;
  let progressBox = null;
  let buttons = {};
  let statusChip = null;
  let statusTitle = null;
  let statusDetail = null;
  let progressFill = null;
  let progressPercent = null;
  let metrics = {};
  let pipelineStages = {};
  let uiPrefs = { minimized: false, motion: true, saveHistory: true };
  let historyEntries = [];
  let lastHistoryRunId = null;
  let settingsDrawer = null;
  let historyDrawer = null;
  let detailReported = false;
  let bootstrapStoreCache;
  const shownWarningKeys = new Set();
  let drawerFocusReturn = null;

  function defaultState() {
    return {
      version: 8,
      status: 'idle',
      sourceUrl: '',
      sourceTabId: null,
      rows: [],
      nextIndex: 0,
      retryQueue: [],
      inFlight: [],
      attempts: {},
      records: [],
      errors: [],
      warnings: [],
      updatedAt: null,
      completedAt: null
    };
  }

  async function loadUiData() {
    try {
      const stored = await chrome.storage.local.get([UI_KEY, HISTORY_KEY]);
      uiPrefs = { ...uiPrefs, ...(stored[UI_KEY] || {}) };
      historyEntries = Array.isArray(stored[HISTORY_KEY]) ? stored[HISTORY_KEY].slice(0, HISTORY_LIMIT) : [];
    } catch (_) {
      uiPrefs = { ...uiPrefs };
      historyEntries = [];
    }
  }

  async function saveUiPrefs() {
    try { await chrome.storage.local.set({ [UI_KEY]: uiPrefs }); } catch (_) { /* local preference is optional */ }
  }

  async function saveHistoryEntry() {
    if (!uiPrefs.saveHistory || !state.records.length || !state.runId) return;
    const cleanRecords = state.records.map(({ __key, __index, __attempts, __lineIndex, ...record }) => record);
    const existing = historyEntries.find(item => item.id === `run-${state.runId}`);
    if (existing?.completed && state.status === 'complete') return;
    const entry = {
      schemaVersion: 2,
      id: `run-${state.runId}`,
      runId: state.runId,
      createdAt: existing?.createdAt || new Date().toISOString(),
      completed: state.status === 'complete',
      orders: state.rows.length,
      rows: cleanRecords.length,
      errors: state.errors.length,
      warnings: state.warnings?.length || 0,
      records: cleanRecords,
      errorsData: [...state.errors, ...(state.warnings || []).map(warning => ({ ...warning, message: warning.message || 'Parser warning' }))]
    };
    historyEntries = [entry, ...historyEntries.filter(item => item.id !== entry.id)].slice(0, HISTORY_LIMIT);
    lastHistoryRunId = state.runId;
    try { await chrome.storage.local.set({ [HISTORY_KEY]: historyEntries }); } catch (_) { /* history is best effort */ }
    renderHistory();
  }

  function historyDate(value) {
    try { return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); } catch (_) { return value || ''; }
  }

  function downloadRecords(records, errors, message = 'Downloaded the Excel workbook.') {
    window.TemuXlsx.downloadWorkbook(records || [], errors || []);
    log(message);
  }

  function renderHistory() {
    const list = panel?.querySelector('[data-role="history-list"]');
    if (!list) return;
    if (!historyEntries.length) {
      list.innerHTML = '<div class="temu-exporter-empty-state"><span class="temu-exporter-empty-icon">▤</span><strong>No saved sheets yet</strong><small>Completed Excel exports will appear here.</small></div>';
      return;
    }
    list.innerHTML = historyEntries.map(entry => `
      <div class="temu-exporter-history-item" data-history-id="${String(entry.id).replace(/[^a-zA-Z0-9_-]/g, '')}">
        <div class="temu-exporter-history-main"><span class="temu-exporter-history-icon">▤</span><div><strong>${historyDate(entry.createdAt)}</strong><small>${entry.orders} orders · ${entry.rows} rows · ${entry.errors} errors</small></div></div>
        <div class="temu-exporter-history-actions"><button type="button" data-history-action="download" title="Download this sheet" aria-label="Download this sheet">↓</button><button type="button" data-history-action="delete" title="Delete this history item" aria-label="Delete this history item">×</button></div>
      </div>`).join('');
  }

  async function deleteHistoryEntry(id) {
    historyEntries = historyEntries.filter(entry => entry.id !== id);
    try { await chrome.storage.local.set({ [HISTORY_KEY]: historyEntries }); } catch (_) { /* best effort */ }
    renderHistory();
    log('History item deleted.');
  }

  async function clearHistory() {
    historyEntries = [];
    try { await chrome.storage.local.set({ [HISTORY_KEY]: historyEntries }); } catch (_) { /* best effort */ }
    renderHistory();
    log('Sheet history cleared.');
  }

  function closeDrawers(restoreFocus = true) {
    settingsDrawer?.classList.remove('is-open');
    historyDrawer?.classList.remove('is-open');
    settingsDrawer?.setAttribute('aria-hidden', 'true');
    historyDrawer?.setAttribute('aria-hidden', 'true');
    panel?.classList.remove('drawer-open');
    panel?.querySelector('[data-action="settings"]')?.setAttribute('aria-expanded', 'false');
    panel?.querySelector('[data-action="history"]')?.setAttribute('aria-expanded', 'false');
    if (restoreFocus && drawerFocusReturn && typeof drawerFocusReturn.focus === 'function') drawerFocusReturn.focus();
    if (restoreFocus) drawerFocusReturn = null;
  }

  function toggleDrawer(drawer) {
    const target = drawer === 'settings' ? settingsDrawer : historyDrawer;
    const trigger = panel?.querySelector(`[data-action="${drawer}"]`);
    const shouldOpen = !target?.classList.contains('is-open');
    if (!shouldOpen) {
      closeDrawers();
      return;
    }
    drawerFocusReturn = trigger || document.activeElement;
    closeDrawers(false);
    target?.classList.add('is-open');
    target?.setAttribute('aria-hidden', 'false');
    panel?.classList.add('drawer-open');
    trigger?.setAttribute('aria-expanded', 'true');
    if (drawer === 'history') renderHistory();
    setTimeout(() => target?.querySelector('button, input')?.focus(), 0);
  }

  async function setMinimized(value) {
    uiPrefs.minimized = Boolean(value);
    panel?.classList.toggle('is-minimized', uiPrefs.minimized);
    updatePanel();
    await saveUiPrefs();
  }

  function normalize(value) {
    return String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function textOf(element) {
    return normalize(element?.innerText || element?.textContent || '');
  }

  function dateOnly(value) {
    const text = normalize(value);
    if (!text) return '';
    const monthDate = text.match(/^(.+?,\s*\d{4})/);
    if (monthDate) return monthDate[1].trim();
    const isoDate = text.match(/^(\d{4}-\d{2}-\d{2})/);
    if (isoDate) return isoDate[1];
    const beforeTime = text.match(/^(.+?)(?=,?\s+\d{1,2}:\d{2}\s*(?:am|pm)?\b)/i);
    return beforeTime ? beforeTime[1].replace(/,\s*$/, '').trim() : text;
  }

  function cleanProductTitle(value) {
    let title = normalize(value);
    let previous = '';
    while (title && title !== previous) {
      previous = title;
      title = title.replace(/\s*(?:\([^()]*\)|\{[^{}]*\}|\[[^\[\]]*\])\s*$/, '').trim();
    }
    return title.replace(/\s{2,}/g, ' ');
  }

  function moneyNumber(value) {
    const cleaned = normalize(value).replace(/[^0-9.-]/g, '');
    if (!cleaned || cleaned === '-' || cleaned === '.') return null;
    const number = Number(cleaned);
    return Number.isFinite(number) ? number : null;
  }

  function moneyText(value) {
    return value === null || value === undefined || !Number.isFinite(value) ? '' : `$${value.toFixed(2)}`;
  }

  function allocateMoney(totalText, basisValues) {
    const total = moneyNumber(totalText);
    if (total === null || !basisValues.length) return basisValues.map(() => '');
    const weights = basisValues.map(value => Number.isFinite(value) && value > 0 ? value : 1);
    const weightTotal = weights.reduce((sum, value) => sum + value, 0);
    let allocated = 0;
    return weights.map((weight, index) => {
      const value = index === weights.length - 1 ? total - allocated : Math.round((total * weight / weightTotal) * 100) / 100;
      allocated += value;
      return moneyText(value);
    });
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Ripple effect: injects an animated span on button click
  function addRipple(button) {
    button.addEventListener('click', function(event) {
      const rect = button.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      const ripple = document.createElement('span');
      ripple.className = 'temu-ripple';
      ripple.style.cssText = `width:${size}px;height:${size}px;left:${event.clientX - rect.left - size / 2}px;top:${event.clientY - rect.top - size / 2}px`;
      button.appendChild(ripple);
      ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
    });
  }

  // Metric bump: scale-flash animation when value changes
  const _prevMetricValues = {};
  function bumpMetric(element, key, value) {
    if (!element) return;
    const str = String(value);
    if (_prevMetricValues[key] === str) return;
    _prevMetricValues[key] = str;
    element.classList.remove('temu-metric-bump');
    void element.offsetWidth; // reflow to restart animation
    element.classList.add('temu-metric-bump');
    element.addEventListener('animationend', () => element.classList.remove('temu-metric-bump'), { once: true });
  }

  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, response => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve(response || {});
      });
    });
  }

  async function sendMessageWithAck(message, attempts = 3) {
    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await sendMessage(message);
        if (response?.accepted || response?.ok) return response;
        lastError = new Error('Background worker did not accept the detail message.');
      } catch (error) {
        lastError = error;
      }
      if (attempt < attempts) await sleep(250 * attempt);
    }
    throw lastError || new Error('Background worker did not acknowledge the detail message.');
  }

  async function getCurrentState() {
    try {
      const response = await sendMessage({ type: 'TEMU_GET_STATE' });
      state = { ...defaultState(), ...(response.state || {}) };
    } catch (_) {
      const result = await chrome.storage.local.get(STATE_KEY);
      state = { ...defaultState(), ...(result[STATE_KEY] || {}) };
    }
    updatePanel();
    return state;
  }

  function exactTextElements(label, root = document) {
    return [...root.querySelectorAll('div,span,th,td')].filter(element => normalize(element.textContent) === label);
  }

  function findSiblingValue(label, root = document, pattern = null) {
    for (const labelElement of exactTextElements(label, root)) {
      let ancestor = labelElement.parentElement;
      for (let level = 0; ancestor && level < 5; level += 1, ancestor = ancestor.parentElement) {
        const candidates = [...ancestor.children]
          .filter(child => child !== labelElement && !child.contains(labelElement))
          .map(textOf)
          .filter(value => value && value !== label);
        const matching = pattern ? candidates.find(value => pattern.test(value)) : candidates[0];
        if (matching) return matching;
      }
    }
    return '';
  }

  function valueFromHeading(headingLabel, valueLabel, root = document, pattern = null) {
    for (const heading of exactTextElements(headingLabel, root)) {
      let ancestor = heading.parentElement;
      for (let level = 0; ancestor && level < 10; level += 1, ancestor = ancestor.parentElement) {
        if (!normalize(textOf(ancestor)).includes(valueLabel)) continue;
        const value = findSiblingValue(valueLabel, ancestor, pattern);
        if (value) return value;
      }
    }
    return '';
  }

  function topRightEstimatedRevenue(root = document) {
    return valueFromHeading('Sales proceeds', 'Estimated revenue', root, AMOUNT_RE)
      || findSiblingValue('Estimated revenue', root, AMOUNT_RE)
      || valueAfterLabel('Estimated revenue', root, /([$€£]\s?[\d,]+(?:\.\d{1,2})?)/);
  }

  function valueAfterLabel(label, root = document, pattern = null) {
    const content = textOf(root);
    const start = content.toLowerCase().indexOf(label.toLowerCase());
    if (start < 0) return '';
    const after = content.slice(start + label.length).trim();
    if (pattern) {
      const match = after.match(pattern);
      return match ? (match[1] || match[0]).trim() : '';
    }
    return after.split(/\s{2,}|\b(?:Courier|Tracking number|Shipping from|Dimensions|Package weight|Order status history)\b/i)[0].trim();
  }

  function findPackageContainer(packageId) {
    if (!packageId) return document;
    const matches = [...document.querySelectorAll('div,span')]
      .filter(element => normalize(element.textContent) === packageId);
    for (const match of matches) {
      let ancestor = match;
      for (let level = 0; ancestor && level < 12; level += 1, ancestor = ancestor.parentElement) {
        const content = textOf(ancestor);
        if (content.includes(packageId) && /Tracking number/i.test(content) && /Est\. total shipping cost/i.test(content)) return ancestor;
      }
    }
    return document;
  }

  function parseProductsFromDom() {
    const rows = [...document.querySelectorAll('tr[data-testid="beast-core-table-body-tr"]')]
      .filter(candidate => candidate.querySelectorAll('td').length >= 3);
    const fallbackRows = rows.length ? rows : [...document.querySelectorAll('table')]
      .flatMap(table => [...table.querySelectorAll('tr')])
      .filter(candidate => candidate.querySelectorAll('td').length >= 3);
    return fallbackRows.map(row => {
      const cells = [...row.querySelectorAll('td')];
      const rawProduct = normalize(textOf(cells[1]));
      const beforeIdentifiers = rawProduct.split(/\b(?:Goods ID|SKU ID|Order item ID)\s*:/i)[0].trim() || rawProduct;
      const quantityText = normalize(textOf(cells[2]));
      const quantity = quantityText.match(/(\d+)\s+shipped\b/i)?.[1] || quantityText.match(/(\d+)\s+item/i)?.[1] || quantityText.match(/\d+/)?.[0] || '';
      const proceedsText = normalize(textOf(cells[5]));
      const revenueMatches = proceedsText.match(/[$€£]\s?[\d,]+(?:\.\d{1,2})?/g) || [];
      const lineRevenue = revenueMatches.length ? revenueMatches[revenueMatches.length - 1] : '';
      return { productDetails: cleanProductTitle(beforeIdentifiers), quantity, lineRevenue };
    }).filter(product => product.productDetails || product.quantity);
  }

  function parseOrderNumberFromDom() {
    const match = textOf(document.body).match(/Order ID\s*:?\s*([A-Z0-9-]+)/i);
    return match?.[1] || new URL(location.href).searchParams.get('parent_order_sn') || '';
  }

  function extractRecipientNameFromDom() {
    // Walk all label-like divs looking for one whose visible text starts with "Recipient name"
    // The page structure is: div._3XfPagy1 > div._2t_pUr4h ("Recipient name") + div._2-2LmK96 (value)
    for (const el of document.querySelectorAll('div,span')) {
      const text = normalize(el.innerText || el.textContent || '');
      if (text !== 'Recipient name') continue;
      // Try nextElementSibling first (fastest path)
      const sibling = el.nextElementSibling;
      if (sibling) {
        const val = normalize(sibling.innerText || sibling.textContent || '');
        if (val && val !== 'Recipient name') return val;
      }
      // Also check parent's children
      const parent = el.parentElement;
      if (parent) {
        for (const child of parent.children) {
          if (child === el) continue;
          const val = normalize(child.innerText || child.textContent || '');
          if (val && val !== 'Recipient name') return val;
        }
      }
    }
    return '';
  }

  function parseDetailRecordsFromDom(active) {
    const packageRoot = findPackageContainer(active?.packageId || '');
    const products = parseProductsFromDom();
    const orderRevenue = topRightEstimatedRevenue(document);
    const shippingCost = findSiblingValue('Est. total shipping cost', packageRoot, AMOUNT_RE) || valueAfterLabel('Est. total shipping cost', packageRoot, /([$€£]\s?[\d,]+(?:\.\d{1,2})?)/);
    const firstRevenue = orderRevenue || products[0]?.lineRevenue || '';
    const firstShippingCost = shippingCost || '';
    const common = {
      'Shipping Date': dateOnly(findSiblingValue('Shipment confirmed at', packageRoot) || valueAfterLabel('Shipment confirmed at', packageRoot, /^(.*?)(?=\s+Courier\b|$)/i)),
      'Order Date': dateOnly(findSiblingValue('Purchase date') || valueAfterLabel('Purchase date', document, /^(.*?)(?=\s+Shipping service\b|$)/i)),
      'Tracking Number': valueAfterLabel('Tracking number', packageRoot, TRACKING_RE) || '',
      'Order No': parseOrderNumberFromDom() || active?.orderNo || '',
      'Customer Name': findSiblingValue('Recipient name') || extractRecipientNameFromDom()
    };
    return products.map((product, index) => ({
      ...common,
      'Product Details': cleanProductTitle(product.productDetails),
      'Qty (No)': product.quantity,
      'Est. Revenue': index === 0 ? firstRevenue : '',
      'Shipping Cost': index === 0 ? firstShippingCost : ''
    }));
  }

  function getActiveDetailMeta() {
    const raw = location.hash.startsWith('#temu-exporter=') ? location.hash.slice('#temu-exporter='.length) : '';
    if (!raw) return null;
    try { return JSON.parse(decodeURIComponent(raw)); } catch (_) { return null; }
  }

  function getPageBootstrapStore() {
    if (bootstrapStoreCache !== undefined) return bootstrapStoreCache;
    if (window.rawData?.store) {
      bootstrapStoreCache = window.rawData.store;
      return bootstrapStoreCache;
    }
    for (const script of [...document.scripts]) {
      const source = script.textContent || '';
      const marker = 'window.rawData';
      const markerIndex = source.indexOf(marker);
      if (markerIndex < 0) continue;
      const equalsIndex = source.indexOf('=', markerIndex + marker.length);
      const braceStart = source.indexOf('{', equalsIndex);
      if (equalsIndex < 0 || braceStart < 0) continue;
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (let index = braceStart; index < source.length; index += 1) {
        const character = source[index];
        if (inString) {
          if (escaped) escaped = false;
          else if (character.charCodeAt(0) === 92) escaped = true;
          else if (character === '"') inString = false;
          continue;
        }
        if (character === '"') { inString = true; continue; }
        if (character === '{') depth += 1;
        else if (character === '}') {
          depth -= 1;
          if (depth === 0) {
            try {
              bootstrapStoreCache = JSON.parse(source.slice(braceStart, index + 1)).store || null;
              return bootstrapStoreCache;
            } catch (_) { break; }
          }
        }
      }
    }
    return null;
  }

  function getStructuredRecords(active) {
    const store = getPageBootstrapStore();
    if (!store) return null;
    const parent = store.parentOrderMap || {};
    const shipping = store.shippingInfo || {};
    const orders = Array.isArray(store.orderList) ? store.orderList : [];
    if (!orders.length) return null;
    const packages = Array.isArray(parent.localPackageInfoList) ? parent.localPackageInfoList : [];
    const entries = orders.map((order, index) => {
      const orderPackage = Array.isArray(order.orderPackageInfoList) ? order.orderPackageInfoList[0] || {} : {};
      const packageSn = orderPackage.packageSn || order.packageSn || order.packageId || active?.packageId || '';
      const packageData = packages.find(item => item.packageSn === packageSn) || packages.find(item => item.packageSn === active?.packageId) || packages[0] || {};
      const interlines = Array.isArray(packageData.interlineInfoForAggregationInfo) ? packageData.interlineInfoForAggregationInfo : [];
      const interline = interlines.find(item => item.packageSn === packageSn || item.trackingNumber === packageData.trackingNumber) || interlines[0] || {};
      const basePrice = moneyNumber(order.estimatedIncome || order.orderRetailPrice || order.goodsRetailPrice || order.goodsBasePrice);
      return { order, index, orderPackage, packageSn, packageData, interline, basePrice };
    });
    const parentRevenue = normalize(parent.estimatedIncomeTotal || '');
    const packageGroups = new Map();
    entries.forEach((entry, index) => {
      const key = entry.packageSn || `__package_${index}`;
      if (!packageGroups.has(key)) packageGroups.set(key, []);
      packageGroups.get(key).push(index);
    });
    let shippingTotalNumber = 0;
    let shippingTotalFound = false;
    for (const indexes of packageGroups.values()) {
      const packageCost = entries[indexes[0]]?.interline?.estimatedAmount || entries[indexes[0]]?.packageData?.estimatedAmount || '';
      const numericCost = moneyNumber(packageCost);
      if (numericCost !== null) {
        shippingTotalNumber += numericCost;
        shippingTotalFound = true;
      }
    }
    const shippingTotal = shippingTotalFound ? moneyText(shippingTotalNumber) : normalize(entries[0]?.interline?.estimatedAmount || entries[0]?.packageData?.estimatedAmount || '');
    const orderNo = parent.parentOrderSn || active?.orderNo || '';
    const records = entries.map((entry, index) => {
      const order = entry.order;
      const productName = normalize(order.goodsName || order.originalGoodsName || '');
      const trackingNumber = normalize(entry.orderPackage?.trackingNumber || entry.packageData.trackingNumber || entry.interline.trackingNumber || '');
      return {
        'Shipping Date': dateOnly(entry.packageData.sendTimeStr || ''),
        'Order Date': dateOnly(parent.localParentOrderTimeStr || ''),
        'Tracking Number': trackingNumber,
        'Order No': normalize(orderNo),
        'Customer Name': normalize(
          shipping.receiptName ||
          shipping.receiverName ||
          shipping.consigneeName ||
          shipping.buyerName ||
          shipping.receiveName ||
          store.shippingInfo?.name ||
          ''
        ) || extractRecipientNameFromDom(),
        'Product Details': cleanProductTitle(productName),
        'Qty (No)': order.quantity ?? order.fulfillmentQuantity ?? order.originQuantity ?? '',
        'Est. Revenue': index === 0 ? (parentRevenue || normalize(order.estimatedIncome || '')) : '',
        'Shipping Cost': index === 0 ? shippingTotal : ''
      };
    });
    return { records, store };
  }

  function hasMinimumDetail(record) {
    return Boolean(record && (record['Order No'] || record['Tracking Number']) && (record['Product Details'] || record['Qty (No)']));
  }

  function missingFields(record, rowIndex = 0) {
    const allowedBlank = new Set(['Est. Revenue', 'Shipping Cost']);
    return EXPORT_COLUMNS.filter(column => !normalize(record?.[column]) && (rowIndex === 0 || !allowedBlank.has(column)));
  }

  function allRecordsComplete(records) {
    return records.length > 0 && records.every((record, index) => hasMinimumDetail(record) && missingFields(record, index).length === 0);
  }

  async function waitForDetailData(timeout = 30000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (getPageBootstrapStore()?.orderList?.length) return true;
      if (/no-auth|login/i.test(location.pathname)) throw new Error('Temu opened a no-auth page.');
      if (/no internet|network error|no connection/i.test(textOf(document.body))) throw new Error('Temu displayed a network error page.');
      if (/Purchase date/i.test(textOf(document.body)) && /Order details/i.test(document.title)) return true;
      await sleep(50);
    }
    throw new Error('Timed out waiting for structured order-detail data.');
  }

  async function processDetailPage() {
    if (detailReported) return;
    const active = getActiveDetailMeta();
    if (!active) return;
    detailReported = true;
    try {
      await waitForDetailData();
      const structured = getStructuredRecords(active);
      let records = structured?.records || [];
      if (!allRecordsComplete(records)) {
        const fallbackRecords = parseDetailRecordsFromDom(active);
        if (allRecordsComplete(fallbackRecords)) records = fallbackRecords;
      }
      const missing = [...new Set(records.flatMap((record, index) => missingFields(record, index)))];
      if (!allRecordsComplete(records)) throw new Error(`Order-detail data was incomplete after rendering. Missing: ${missing.join(', ') || 'unknown fields'}`);
      await sendMessageWithAck({ type: 'TEMU_DETAIL_RESULT', records, missing: [] });
    } catch (error) {
      try { await sendMessageWithAck({ type: 'TEMU_DETAIL_ERROR', message: error?.message || String(error) }); } catch (_) { /* worker timeout/recovery remains the final safeguard */ }
    }
  }

  function captureBulkRows() {
    const rows = [...document.querySelectorAll('tr[data-testid="beast-core-table-body-tr"]')];
    const header = document.querySelector('tr[data-testid="beast-core-table-header-tr"]');
    const headerCells = header ? [...header.querySelectorAll('th[data-testid="beast-core-table-th"], th')] : [];
    const headers = headerCells.map(textOf).map(value => value.toLowerCase());
    const indexOf = (patterns, fallback) => {
      const index = headers.findIndex(headerText => patterns.some(pattern => headerText.includes(pattern)));
      return index >= 0 ? index : fallback;
    };
    const indexes = {
      orderNo: indexOf(['order details', 'order id'], 0),
      packageId: indexOf(['package id', 'package'], 1),
      trackingNumber: indexOf(['tracking number', 'tracking'], 8),
      shippingCost: indexOf(['total shipping cost', 'shipping cost'], 7)
    };
    const seen = new Set();
    return rows.map((row, position) => {
      const cells = [...row.querySelectorAll('td[data-testid="beast-core-table-td"], td')];
      const orderNo = normalize(textOf(cells[indexes.orderNo]));
      const packageId = normalize(textOf(cells[indexes.packageId]));
      return { position, orderNo, packageId, trackingNumber: normalize(textOf(cells[indexes.trackingNumber])), shippingCost: normalize(textOf(cells[indexes.shippingCost])) };
    }).filter(row => {
      if (!row.orderNo || !row.packageId) return false;
      const key = `${row.orderNo}::${row.packageId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function log(message, type = 'info') {
    if (!logBox) return;
    const line = document.createElement('div');
    line.className = `temu-exporter-log-${type}`;
    line.textContent = `${new Date().toLocaleTimeString()}  ${message}`;
    logBox.appendChild(line);
    while (logBox.children.length > 80) logBox.removeChild(logBox.firstChild);
    logBox.scrollTop = logBox.scrollHeight;
  }

  function pipelineState(stage, stats) {
    if (!stats.total) return 'idle';
    if (stage === 'capture') return state.status === 'idle' ? 'idle' : 'complete';
    if (stage === 'details') {
      if (state.status === 'complete') return 'complete';
      if (state.status === 'running') return 'active';
      if (state.status === 'paused' && stats.done > 0) return 'paused';
      return stats.done > 0 ? 'complete' : 'idle';
    }
    if (state.status === 'complete') return 'complete';
    return state.records.length ? 'ready' : 'idle';
  }

  function panelStats() {
    const total = state.rows.length;
    const done = new Set(state.records.map(record => record.__key || `${record['Order No'] || ''}::${record['Tracking Number'] || ''}`)).size;
    const rows = state.records.length;
    const failed = state.errors.length;
    const active = state.inFlight.length;
    const retried = Object.values(state.attempts || {}).filter(value => value > 1).length;
    const percent = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
    const status = state.status === 'running' ? 'Running' : state.status === 'paused' ? 'Paused' : state.status === 'complete' ? 'Complete' : 'Ready';
    return { total, done, rows, failed, active, retried, percent, status };
  }

  function updatePanel() {
    if (!panel) return;
    const stats = panelStats();
    const detail = stats.total ? `${stats.done} of ${stats.total} orders processed` : 'Open a Temu bulk-shipping page to begin';
    const stateMessage = stats.status === 'running' ? 'Live extraction in progress' : stats.status === 'paused' ? 'Checkpoint saved — ready to resume' : stats.status === 'complete' ? 'Extraction complete — workbook ready' : 'Ready for a new extraction';
    const recoveryVisible = state.errors.length > 0 && stats.status !== 'running' && !stats.active;
    if (progressBox) progressBox.textContent = `${stats.status} — ${stats.done}/${stats.total || 0} orders — ${stats.rows} product rows — ${stats.active} active — ${stats.failed} errors — ${(state.warnings || []).length} warnings — ${stats.retried} retried`;
    if (statusChip) {
      statusChip.textContent = stats.status;
      statusChip.dataset.status = stats.status.toLowerCase();
    }
    if (statusTitle) statusTitle.textContent = stateMessage;
    if (statusDetail) statusDetail.textContent = detail;
    if (progressFill) progressFill.style.width = `${stats.percent}%`;
    if (progressPercent) progressPercent.textContent = `${stats.percent}%`;
    if (metrics.orders) { const v = `${stats.done}/${stats.total || 0}`; if (metrics.orders.textContent !== v) { metrics.orders.textContent = v; bumpMetric(metrics.orders, 'orders', v); } }
    if (metrics.rows) { const v = String(stats.rows); if (metrics.rows.textContent !== v) { metrics.rows.textContent = v; bumpMetric(metrics.rows, 'rows', v); } }
    if (metrics.errors) { const v = String(stats.failed); if (metrics.errors.textContent !== v) { metrics.errors.textContent = v; bumpMetric(metrics.errors, 'errors', v); } }
    if (metrics.active) { const v = String(stats.active); if (metrics.active.textContent !== v) { metrics.active.textContent = v; bumpMetric(metrics.active, 'active', v); } }
    Object.entries(pipelineStages).forEach(([stage, element]) => {
      element.dataset.stage = pipelineState(stage, stats);
    });
    const recovery = panel.querySelector('[data-role="recovery"]');
    const retryButton = buttons.retry;
    if (recovery) recovery.classList.toggle('is-visible', recoveryVisible);
    if (retryButton) {
      retryButton.disabled = !recoveryVisible;
      retryButton.innerHTML = `<span class="temu-exporter-button-icon" aria-hidden="true">↻</span><span>Retry ${state.errors.length || ''} failed${state.errors.length === 1 ? '' : 's'}</span>`;
    }
    panel.dataset.status = stats.status.toLowerCase();
    const minimizeButton = panel.querySelector('[data-action="minimize"]');
    if (minimizeButton) {
      minimizeButton.textContent = uiPrefs.minimized ? '↗' : '−';
      minimizeButton.title = uiPrefs.minimized ? 'Expand panel' : 'Minimize panel';
      minimizeButton.setAttribute('aria-label', uiPrefs.minimized ? 'Expand panel' : 'Minimize panel');
    }
    if (buttons.start) buttons.start.innerHTML = `<span class="temu-exporter-button-icon" aria-hidden="true">${state.status === 'paused' ? '▶' : '↗'}</span><span>${state.status === 'paused' ? 'Resume extraction' : 'Start extraction'}</span>`;
    if (buttons.pause) buttons.pause.disabled = state.status !== 'running';
    if (buttons.stop) buttons.stop.disabled = state.status === 'idle' && !state.records.length;
    if (buttons.download) buttons.download.disabled = !state.records.length;
  }

  function createPanel() {
    if (document.getElementById(PANEL_ID)) return;
    panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.setAttribute('aria-label', 'Temu Order Exporter');
    panel.innerHTML = `
      <div class="temu-exporter-header">
        <div class="temu-exporter-brand"><div class="temu-exporter-logo" aria-hidden="true"><span>TO</span></div><div class="temu-exporter-brand-copy"><strong>Temu Order Exporter</strong><small>Seller workflow assistant</small></div></div>
        <div class="temu-exporter-toolbar">
          <button type="button" data-action="history" title="Sheet history" aria-label="Open sheet history" aria-expanded="false">▤</button>
          <button type="button" data-action="settings" title="Settings" aria-label="Open settings" aria-expanded="false">⚙</button>
          <button type="button" data-action="minimize" title="Minimize panel" aria-label="Minimize panel">−</button>
        </div>
      </div>
      <div class="temu-exporter-body" data-role="panel-body">
        <div class="temu-exporter-status-card">
          <div class="temu-exporter-status-top"><div class="temu-exporter-status-orbit" aria-hidden="true"><span></span></div><div class="temu-exporter-status-copy"><strong data-role="status-title">Ready for a new extraction</strong><span data-role="status-detail">Open a Temu bulk-shipping page to begin</span></div><span class="temu-exporter-status-chip" data-role="status-chip">Ready</span></div>
          <div class="temu-exporter-progress-track" aria-label="Extraction progress"><span data-role="progress-fill"></span></div>
          <div class="temu-exporter-progress-meta"><span data-role="progress"></span><strong data-role="progress-percent">0%</strong></div>
        </div>
        <div class="temu-exporter-divider">Pipeline</div>
        <div class="temu-exporter-pipeline" data-role="pipeline" aria-label="Extraction pipeline">
          <div class="temu-exporter-pipeline-stage" data-pipeline-stage="capture"><span class="temu-exporter-pipeline-number">1</span><div><strong>Capture rows</strong><small>Bulk page</small></div></div>
          <span class="temu-exporter-pipeline-line" aria-hidden="true"></span>
          <div class="temu-exporter-pipeline-stage" data-pipeline-stage="details"><span class="temu-exporter-pipeline-number">2</span><div><strong>Read details</strong><small>Two tabs</small></div></div>
          <span class="temu-exporter-pipeline-line" aria-hidden="true"></span>
          <div class="temu-exporter-pipeline-stage" data-pipeline-stage="workbook"><span class="temu-exporter-pipeline-number">3</span><div><strong>Build XLSX</strong><small>Local file</small></div></div>
        </div>
        <div class="temu-exporter-divider">Statistics</div>
        <div class="temu-exporter-metrics" aria-label="Extraction statistics">
          <div class="temu-exporter-metric"><span class="temu-exporter-metric-icon orders" aria-hidden="true">↗</span><div><strong data-metric="orders">0/0</strong><small>Orders</small></div></div><div class="temu-exporter-metric"><span class="temu-exporter-metric-icon rows" aria-hidden="true">▦</span><div><strong data-metric="rows">0</strong><small>Product rows</small></div></div><div class="temu-exporter-metric"><span class="temu-exporter-metric-icon active" aria-hidden="true">◌</span><div><strong data-metric="active">0</strong><small>Active tabs</small></div></div><div class="temu-exporter-metric"><span class="temu-exporter-metric-icon errors" aria-hidden="true">!</span><div><strong data-metric="errors">0</strong><small>Errors</small></div></div>
        </div>
        <div class="temu-exporter-divider">Actions</div>
        <div class="temu-exporter-actions"><button type="button" data-action="start" class="primary"><span class="temu-exporter-button-icon" aria-hidden="true">↗</span><span>Start extraction</span></button><button type="button" data-action="download" class="download"><span class="temu-exporter-button-icon" aria-hidden="true">↓</span><span>Download Excel</span></button><button type="button" data-action="pause" class="secondary"><span class="temu-exporter-button-icon" aria-hidden="true">II</span><span>Pause</span></button><button type="button" data-action="stop" class="secondary danger"><span class="temu-exporter-button-icon" aria-hidden="true">×</span><span>Stop / clear</span></button></div>
        <div class="temu-exporter-recovery" data-role="recovery"><div><strong data-role="recovery-title">Some orders need attention</strong><small>Retry only failed orders; successful records stay untouched.</small></div><button type="button" data-action="retry" class="retry"><span class="temu-exporter-button-icon" aria-hidden="true">↻</span><span>Retry failed</span></button></div>
        <div class="temu-exporter-log-wrap"><div class="temu-exporter-log-label"><span>Activity</span><span class="temu-exporter-live-dot">Live</span></div><div class="temu-exporter-log" data-role="log" aria-live="polite"></div></div>
        <div class="temu-exporter-footer"><span>Local-only processing</span><span>v2.9.0</span></div>
      </div>
      <aside class="temu-exporter-drawer" data-role="settings-drawer" role="dialog" aria-modal="true" aria-hidden="true" aria-label="Settings"><div class="temu-exporter-drawer-head"><div><strong>Settings</strong><small>Personalize your workspace</small></div><button type="button" class="temu-exporter-drawer-close" data-action="close-settings" aria-label="Close settings">×</button></div><div class="temu-exporter-setting-row"><div><strong>Save sheet history</strong><small>Keep the last 20 sessions locally</small></div><label class="temu-exporter-switch" for="temu-setting-history"><input id="temu-setting-history" type="checkbox" data-setting="saveHistory" aria-label="Save sheet history"><span></span></label></div><div class="temu-exporter-setting-row"><div><strong>Motion effects</strong><small>Use subtle neon status animations</small></div><label class="temu-exporter-switch" for="temu-setting-motion"><input id="temu-setting-motion" type="checkbox" data-setting="motion" aria-label="Motion effects"><span></span></label></div><div class="temu-exporter-setting-note">Data stays in this browser. Nothing is uploaded.</div></aside>
      <aside class="temu-exporter-drawer" data-role="history-drawer" role="dialog" aria-modal="true" aria-hidden="true" aria-label="Sheet history"><div class="temu-exporter-drawer-head"><div><strong>Sheet history</strong><small>Last 20 exports stored locally</small></div><button type="button" class="temu-exporter-drawer-close" data-action="close-history" aria-label="Close history">×</button></div><div class="temu-exporter-history-list" data-role="history-list" tabindex="0"></div><button type="button" class="temu-exporter-clear-history" data-action="clear-history">Clear all history</button></aside>
    `;
    document.documentElement.appendChild(panel);
    progressBox = panel.querySelector('[data-role="progress"]');
    logBox = panel.querySelector('[data-role="log"]');
    settingsDrawer = panel.querySelector('[data-role="settings-drawer"]');
    historyDrawer = panel.querySelector('[data-role="history-drawer"]');
    statusChip = panel.querySelector('[data-role="status-chip"]');
    statusTitle = panel.querySelector('[data-role="status-title"]');
    statusDetail = panel.querySelector('[data-role="status-detail"]');
    progressFill = panel.querySelector('[data-role="progress-fill"]');
    progressPercent = panel.querySelector('[data-role="progress-percent"]');
    metrics = {
      orders: panel.querySelector('[data-metric="orders"]'),
      rows: panel.querySelector('[data-metric="rows"]'),
      active: panel.querySelector('[data-metric="active"]'),
      errors: panel.querySelector('[data-metric="errors"]')
    };
    buttons = {
      start: panel.querySelector('[data-action="start"]'),
      pause: panel.querySelector('[data-action="pause"]'),
      stop: panel.querySelector('[data-action="stop"]'),
      download: panel.querySelector('[data-action="download"]'),
      retry: panel.querySelector('[data-action="retry"]')
    };
    pipelineStages = {
      capture: panel.querySelector('[data-pipeline-stage="capture"]'),
      details: panel.querySelector('[data-pipeline-stage="details"]'),
      workbook: panel.querySelector('[data-pipeline-stage="workbook"]')
    };
    // Wire ripple to all action buttons
    Object.values(buttons).forEach(btn => { if (btn) addRipple(btn); });
    buttons.start.addEventListener('click', startJob);
    buttons.pause.addEventListener('click', pauseJob);
    buttons.stop.addEventListener('click', stopJob);
    buttons.retry.addEventListener('click', retryFailedJob);
    buttons.download.addEventListener('click', async () => {
      await saveHistoryEntry();
      const records = state.records.map(({ __key, __index, __attempts, __lineIndex, ...record }) => record);
      const statusRows = [...state.errors, ...(state.warnings || []).map(warning => ({ ...warning, message: warning.message || 'Parser warning' }))];
      downloadRecords(records, statusRows, `Downloaded ${records.length} records as an Excel workbook.`);
    });
    panel.querySelector('[data-action="history"]').addEventListener('click', () => toggleDrawer('history'));
    panel.querySelector('[data-action="settings"]').addEventListener('click', () => toggleDrawer('settings'));
    panel.querySelector('[data-action="minimize"]').addEventListener('click', () => setMinimized(!uiPrefs.minimized));
    // Click anywhere on FAB when minimized → expand
    panel.addEventListener('click', (event) => {
      if (uiPrefs.minimized && !event.target.closest('[data-action]')) {
        setMinimized(false);
      }
    });
    panel.querySelector('[data-action="close-settings"]').addEventListener('click', closeDrawers);
    panel.querySelector('[data-action="close-history"]').addEventListener('click', closeDrawers);
    panel.querySelector('[data-action="clear-history"]').addEventListener('click', clearHistory);
    panel.addEventListener('keydown', event => { if (event.key === 'Escape' && panel.classList.contains('drawer-open')) closeDrawers(); });
    panel.querySelector('[data-role="history-list"]').addEventListener('click', event => {
      const actionButton = event.target.closest('[data-history-action]');
      const item = event.target.closest('[data-history-id]');
      if (!actionButton || !item) return;
      const entry = historyEntries.find(candidate => candidate.id.replace(/[^a-zA-Z0-9_-]/g, '') === item.dataset.historyId);
      if (!entry) return;
      if (actionButton.dataset.historyAction === 'download') downloadRecords(entry.records, entry.errorsData, 'Downloaded the selected historical workbook.');
      if (actionButton.dataset.historyAction === 'delete') deleteHistoryEntry(entry.id);
    });
    panel.querySelectorAll('[data-setting]').forEach(input => input.addEventListener('change', async event => {
      uiPrefs[event.target.dataset.setting] = event.target.checked;
      panel.dataset.motion = uiPrefs.motion ? 'on' : 'off';
      await saveUiPrefs();
      log(`${event.target.dataset.setting === 'motion' ? 'Motion effects' : 'Sheet history'} ${event.target.checked ? 'enabled' : 'disabled'}.`);
    }));
    panel.querySelector('[data-setting="saveHistory"]').checked = uiPrefs.saveHistory;
    panel.querySelector('[data-setting="motion"]').checked = uiPrefs.motion;
    panel.classList.toggle('is-minimized', uiPrefs.minimized);
    panel.dataset.motion = uiPrefs.motion ? 'on' : 'off';
    renderHistory();
    chrome.runtime.onMessage.addListener(message => {
      if (message?.type === 'TEMU_STATE_UPDATE') {
        state = { ...defaultState(), ...(message.state || {}) };
        updatePanel();
        (state.warnings || []).forEach((warning, index) => {
          const key = warning.key || `${warning.type || 'warning'}:${index}:${warning.message}`;
          if (!shownWarningKeys.has(key)) { shownWarningKeys.add(key); log(warning.message || 'Extraction warning.', 'warning'); }
        });
        if (state.status === 'complete') {
          log(`Finished: ${state.records.length} records, ${state.errors.length} errors.`);
          saveHistoryEntry();
        }
      } else if (message?.type === 'TEMU_POPUP_START') {
        startJob().catch(error => log(error?.message || 'Could not start extraction.', 'error'));
      } else if (message?.type === 'TEMU_OPEN_PANEL') {
        setMinimized(false);
      } else if (message?.type === 'TEMU_OPEN_HISTORY') {
        setMinimized(false);
        toggleDrawer('history');
      }
    });
    updatePanel();
  }

  async function startJob() {
    const rows = captureBulkRows();
    if (!rows.length) {
      const noData = /\bno data\b/i.test(textOf(document.body));
      log(noData ? 'Bulk page has no loaded packages. Open Manage Orders, select orders, then choose Buy shipping in bulk.' : 'No valid rendered order rows found. Wait for the table and reload the page.', 'error');
      return;
    }
    const response = await sendMessage({ type: 'TEMU_START_JOB', sourceUrl: location.href, rows });
    if (response?.ok === false) throw new Error(response.error || 'Could not start extraction.');
    state = { ...defaultState(), ...(response.state || {}) };
    updatePanel();
    log(`Started ${rows.length} unique orders with two background detail tabs.`);
  }

  async function pauseJob() {
    const response = await sendMessage({ type: 'TEMU_PAUSE_JOB' });
    state = { ...defaultState(), ...(response.state || {}) };
    updatePanel();
    log('Paused. Current checkpoint is preserved.');
  }

  async function retryFailedJob() {
    if (!state.errors.length || state.status === 'running' || state.inFlight.length) return;
    const failedCount = state.errors.length; // capture before state is reset by response
    const response = await sendMessage({ type: 'TEMU_RETRY_FAILED' });
    state = { ...defaultState(), ...(response.state || {}) };
    updatePanel();
    log(`Retrying ${failedCount} failed order${failedCount === 1 ? '' : 's'} with a fresh attempt budget.`);
  }

  async function stopJob() {
    const response = await sendMessage({ type: 'TEMU_STOP_JOB' });
    state = { ...defaultState(), ...(response.state || {}) };
    if (logBox) logBox.textContent = '';
    updatePanel();
    log('Stopped and cleared the saved batch.');
  }

  async function init() {
    if (location.pathname === BULK_PATH) {
      await loadUiData();
      createPanel();
      await getCurrentState();
      if (state.status === 'running') log(`Batch active: ${state.records.length}/${state.rows.length} completed.`);
      else if (state.status === 'complete') {
        log(`Previous batch complete: ${state.records.length} records ready.`);
        saveHistoryEntry();
      }
      return;
    }
    if (location.pathname === DETAIL_PATH) await processDetailPage();
  }

  init().catch(error => console.error('[Temu Order Exporter]', error));
})();
