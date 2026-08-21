const STATE_KEY = 'temuOrderExporterStateV7';
const DETAIL_PATH = '/order-detail.html';
const NO_AUTH_PATHS = ['/no-auth.html', '/login.html'];
const MAX_CONCURRENCY = 2;
const MAX_ATTEMPTS = 3;
const BASE_RETRY_DELAY = 1200;

let activeTabs = new Map();
let closingTabs = new Set();
let launchTasks = new Set();
let pumpTimer = null;
let pumpRunning = false;
let pumpAgain = false;

function defaultState() {
  return {
    version: 7,
    runId: null,
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
    updatedAt: null
  };
}

async function getState() {
  const result = await chrome.storage.local.get(STATE_KEY);
  return { ...defaultState(), ...(result[STATE_KEY] || {}) };
}

async function setState(state) {
  const next = { ...defaultState(), ...state, updatedAt: new Date().toISOString() };
  await chrome.storage.local.set({ [STATE_KEY]: next });
  broadcast(next).catch(() => {});
  return next;
}

async function broadcast(state) {
  if (!state.sourceTabId) return;
  try {
    await chrome.tabs.sendMessage(state.sourceTabId, { type: 'TEMU_STATE_UPDATE', state });
  } catch (_) {
    // The source tab may have navigated or closed; the checkpoint remains safe.
  }
}

function jobKey(row, index) {
  return `${row.orderNo || ''}::${row.packageId || ''}::${index}`;
}

function cleanSourceUrl(sourceUrl) {
  try {
    const url = new URL(sourceUrl);
    url.hash = '';
    return url.toString();
  } catch (_) {
    return sourceUrl;
  }
}

function makeDetailUrl(state, item) {
  const source = new URL(state.sourceUrl);
  const params = new URLSearchParams();
  params.set('parent_order_sn', item.row.orderNo);
  params.set('refer_page_name', 'buy-shipping-bulk-details');
  params.set('refer_page_id', 'temu-order-exporter');
  const sessn = source.searchParams.get('_x_sessn_id');
  if (sessn) params.set('_x_sessn_id', sessn);
  const metadata = encodeURIComponent(JSON.stringify({
    key: item.key,
    index: item.index,
    orderNo: item.row.orderNo,
    packageId: item.row.packageId,
    attempt: item.attempt
  }));
  return `${source.origin}${DETAIL_PATH}?${params.toString()}#temu-exporter=${metadata}`;
}

function isNoAuthUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    return NO_AUTH_PATHS.includes(pathname) || pathname.includes('no-auth');
  } catch (_) {
    return false;
  }
}

function isDetailUrl(url) {
  try {
    return new URL(url).pathname === DETAIL_PATH;
  } catch (_) {
    return false;
  }
}

function retryDelay(attempt) {
  return BASE_RETRY_DELAY * (2 ** Math.max(0, attempt - 1));
}

async function startJob(message, sender) {
  let current = await getState();
  const sourceUrl = cleanSourceUrl(message.sourceUrl || '');
  const preservedPausedTabs = current.status === 'paused' ? new Set(current.inFlight.map(item => item.tabId).filter(Boolean)) : new Set();
  await closeOrphanDetailTabs(preservedPausedTabs);
  if (current.status === 'running' && (current.inFlight.length || activeTabs.size)) {
    await stopJob();
    current = await getState();
  }
  const canResume = current.status === 'paused' && current.sourceUrl === sourceUrl && current.rows.length;
  if (canResume) {
    const resumed = await setState({ ...current, runId: current.runId || Date.now(), status: 'running', sourceTabId: sender.tab?.id || current.sourceTabId });
    pump(resumed, resumed.runId);
    return resumed;
  }

  const next = {
    ...defaultState(),
    runId: Date.now(),
    status: 'running',
    sourceUrl,
    sourceTabId: sender.tab?.id || null,
    rows: message.rows || [],
    updatedAt: new Date().toISOString()
  };
  const saved = await setState(next);
  pump(saved, saved.runId);
  return saved;
}

async function pauseJob() {
  const state = await getState();
  const paused = await setState({ ...state, status: 'paused' });
  return paused;
}

async function closeTabIntentionally(tabId) {
  if (!tabId || tabId < 0) return;
  closingTabs.add(tabId);
  try { await chrome.tabs.remove(tabId); } catch (_) { /* already closed */ }
}

function isExporterDetailTab(tab) {
  if (!isDetailUrl(tab?.url || '')) return false;
  try {
    const url = new URL(tab.url);
    return url.hash.startsWith('#temu-exporter=') || url.searchParams.get('refer_page_id') === 'temu-order-exporter' || url.searchParams.get('refer_page_name') === 'buy-shipping-bulk-details';
  } catch (_) {
    return false;
  }
}

async function closeOrphanDetailTabs(keepTabIds = new Set()) {
  const tabs = await chrome.tabs.query({ url: ['https://seller.temu.com/order-detail.html*'] });
  await Promise.all(tabs
    .filter(tab => isExporterDetailTab(tab) && !keepTabIds.has(tab.id))
    .map(tab => closeTabIntentionally(tab.id)));
}

async function stopJob() {
  const current = await getState();
  const stopRunId = Date.now();
  await setState({ ...defaultState(), runId: stopRunId });
  const tabIds = new Set([...activeTabs.keys(), ...current.inFlight.map(item => item.tabId).filter(Boolean)]);
  for (const tabId of tabIds) await closeTabIntentionally(tabId);
  if (launchTasks.size) await Promise.allSettled([...launchTasks]);
  await closeOrphanDetailTabs();
  activeTabs.clear();
  if (pumpTimer) clearTimeout(pumpTimer);
  pumpTimer = null;
  return getState();
}

async function findTrackedEntry(tabId) {
  if (closingTabs.has(tabId)) return null;
  if (activeTabs.has(tabId)) return activeTabs.get(tabId);
  const state = await getState();
  const entry = state.inFlight.find(item => item.tabId === tabId);
  if (entry) activeTabs.set(tabId, entry);
  return entry || null;
}

async function recoverOpenDetailTabs() {
  const state = await getState();
  const trackedTabIds = new Set();
  for (const entry of state.inFlight) {
    if (entry.tabId) {
      trackedTabIds.add(entry.tabId);
      if (state.status === 'running') activeTabs.set(entry.tabId, entry);
    }
  }
  await closeOrphanDetailTabs(state.status === 'running' ? trackedTabIds : new Set());
  if (state.status === 'running') pump(state, state.runId);
}

async function handleFailure(entry, message) {
  if (!entry || !entry.key) return;
  const state = await getState();
  if (state.runId !== entry.runId || !state.inFlight.some(item => item.key === entry.key)) return;
  const inFlight = state.inFlight.filter(item => item.key !== entry.key);
  const attempts = state.attempts[entry.key] || entry.attempt;
  const failedItem = { key: entry.key, index: entry.index, row: entry.row };
  activeTabs.delete(entry.tabId);
  if (attempts < MAX_ATTEMPTS && state.status !== 'stopped') {
    const retryQueue = [...state.retryQueue.filter(item => item.key !== entry.key), failedItem];
    const saved = await setState({ ...state, inFlight, retryQueue });
    await closeTabIntentionally(entry.tabId);
    pumpTimer = setTimeout(() => pump(saved, saved.runId), retryDelay(attempts));
    return;
  }
  const errors = [...state.errors, {
    key: entry.key,
    index: entry.index,
    orderNo: entry.row.orderNo,
    packageId: entry.row.packageId,
    attempts,
    message,
    at: new Date().toISOString()
  }];
  const saved = await setState({ ...state, inFlight, errors });
  await closeTabIntentionally(entry.tabId);
  pump(saved, saved.runId);
}

async function handleSuccess(entry, productRecords, missing = []) {
  if (!entry || !entry.key) return;
  const state = await getState();
  if (state.runId !== entry.runId || !state.inFlight.some(item => item.key === entry.key)) return;
  const inFlight = state.inFlight.filter(item => item.key !== entry.key);
  const incomingRecords = Array.isArray(productRecords) ? productRecords : (productRecords ? [productRecords] : []);
  const records = [...state.records.filter(item => item.__key !== entry.key), ...incomingRecords.map((record, lineIndex) => ({
    ...record,
    __key: entry.key,
    __index: entry.index,
    __lineIndex: lineIndex,
    __attempts: state.attempts[entry.key] || entry.attempt
  }))];
  const warnings = missing.length ? [...state.errors, {
    key: entry.key,
    index: entry.index,
    orderNo: entry.row.orderNo,
    packageId: entry.row.packageId,
    attempts: state.attempts[entry.key] || entry.attempt,
    message: `Missing fields: ${missing.join(', ')}`,
    at: new Date().toISOString()
  }] : state.errors;
  activeTabs.delete(entry.tabId);
  const saved = await setState({ ...state, inFlight, records, errors: warnings });
  await closeTabIntentionally(entry.tabId);
  pump(saved, saved.runId);
}

async function launchItem(state, item) {
  const task = (async () => {
    const current = await getState();
    if (current.status !== 'running' || current.runId !== state.runId) return;
    const key = item.key || jobKey(item.row, item.index);
    const attempt = (current.attempts[key] || 0) + 1;
    const entry = { key, index: item.index, row: item.row, attempt, runId: current.runId, tabId: null };
    try {
      const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
      entry.tabId = tab.id;
      const latest = await getState();
      if (latest.status !== 'running' || latest.runId !== current.runId) {
        await closeTabIntentionally(tab.id);
        return;
      }
      activeTabs.set(tab.id, entry);
      const nextAttempts = { ...latest.attempts, [key]: attempt };
      const nextInFlight = [...latest.inFlight.filter(itemInFlight => itemInFlight.key !== key), entry];
      const nextRetryQueue = latest.retryQueue.filter(itemInRetry => itemInRetry.key !== key);
      const nextIndex = Math.max(latest.nextIndex, state.nextIndex || 0);
      const queued = await setState({ ...latest, nextIndex, attempts: nextAttempts, retryQueue: nextRetryQueue, inFlight: nextInFlight });
      await chrome.tabs.update(tab.id, { url: makeDetailUrl(queued, entry) });
      setTimeout(async () => {
        const tracked = await findTrackedEntry(tab.id);
        if (tracked) await handleFailure(tracked, 'Timed out waiting for order-detail data.');
      }, 30000);
    } catch (error) {
      await handleFailure({ ...entry, tabId: entry.tabId || -1 }, error?.message || 'Could not create or navigate detail tab.');
    }
  })();
  launchTasks.add(task);
  try { await task; } finally { launchTasks.delete(task); }
}

async function pump(inputState = null, expectedRunId = null) {
  if (pumpRunning) {
    pumpAgain = true;
    return;
  }
  pumpRunning = true;
  try {
    const state = inputState || await getState();
    if (state.status !== 'running' || (expectedRunId !== null && state.runId !== expectedRunId)) return;
    for (const entry of state.inFlight) {
      if (entry.tabId && !activeTabs.has(entry.tabId)) activeTabs.set(entry.tabId, entry);
    }
    const occupied = new Set(state.inFlight.map(entry => entry.key));
    while (occupied.size < MAX_CONCURRENCY) {
      let item = null;
      if (state.retryQueue.length) {
        item = state.retryQueue.shift();
      } else if (state.nextIndex < state.rows.length) {
        item = { index: state.nextIndex, row: state.rows[state.nextIndex] };
        state.nextIndex += 1;
      }
      if (!item) break;
      occupied.add(item.key || jobKey(item.row, item.index));
      await launchItem(state, item);
    }
    const refreshed = await getState();
    if (refreshed.status !== 'running' || (expectedRunId !== null && refreshed.runId !== expectedRunId)) return;
    if (refreshed.nextIndex >= refreshed.rows.length && !refreshed.retryQueue.length && !refreshed.inFlight.length) {
      await setState({ ...refreshed, status: 'complete' });
    }
  } finally {
    pumpRunning = false;
    if (pumpAgain) {
      pumpAgain = false;
      const latest = await getState();
      if (latest.status === 'running') setTimeout(() => pump(latest, latest.runId), 0);
    }
  }
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (closingTabs.has(tabId)) return;
  const entry = await findTrackedEntry(tabId);
  if (!entry || !changeInfo.status || changeInfo.status !== 'complete') return;
  if (!tab.url || tab.url === 'about:blank' || tab.url.startsWith('chrome://')) return;
  if (isNoAuthUrl(tab.url || '')) {
    await handleFailure(entry, 'Temu opened a no-auth or no-internet page.');
    return;
  }
  if (!isDetailUrl(tab.url || '')) {
    await handleFailure(entry, `Unexpected page opened: ${tab.url || 'unknown URL'}`);
  }
});

chrome.tabs.onRemoved.addListener(async tabId => {
  if (closingTabs.has(tabId)) {
    closingTabs.delete(tabId);
    activeTabs.delete(tabId);
    return;
  }
  const entry = await findTrackedEntry(tabId);
  if (entry) await handleFailure(entry, 'Detail tab closed before extraction completed.');
});

if (chrome.runtime.onStartup?.addListener) chrome.runtime.onStartup.addListener(() => recoverOpenDetailTabs());
recoverOpenDetailTabs().catch(() => {});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === 'TEMU_START_JOB') {
      sendResponse({ ok: true, state: await startJob(message, sender) });
    } else if (message?.type === 'TEMU_PAUSE_JOB') {
      sendResponse({ ok: true, state: await pauseJob() });
    } else if (message?.type === 'TEMU_STOP_JOB') {
      sendResponse({ ok: true, state: await stopJob() });
    } else if (message?.type === 'TEMU_GET_STATE') {
      sendResponse({ ok: true, state: await getState() });
    } else if (message?.type === 'TEMU_DETAIL_RESULT' && sender.tab?.id) {
      const entry = await findTrackedEntry(sender.tab.id);
      if (entry) await handleSuccess(entry, message.records || message.record, message.missing || []);
      sendResponse({ ok: Boolean(entry) });
    } else if (message?.type === 'TEMU_DETAIL_ERROR' && sender.tab?.id) {
      const entry = await findTrackedEntry(sender.tab.id);
      if (entry) await handleFailure(entry, message.message || 'Detail extraction failed.');
      sendResponse({ ok: Boolean(entry) });
    }
  })().catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
  return true;
});
