'use strict';

const STATE_KEY = 'temuOrderExporterStateV7';
const DETAIL_PATH = '/order-detail.html';
const BULK_PATH = '/buy-shipping-bulk-details.html';
const NO_AUTH_PATHS = ['/no-auth.html', '/login.html'];
const SELLER_ORIGIN = 'https://seller.temu.com';
const MAX_CONCURRENCY = 2;
const MAX_ATTEMPTS = 3;
const BASE_RETRY_DELAY = 1200;
const DETAIL_TIMEOUT = 30000;
const WAKE_ALARM = 'temu-order-exporter-wake';
const EXPORT_COLUMNS = [
  'Shipping Date', 'Order Date', 'Tracking Number', 'Order No', 'Customer Name',
  'Product Details', 'Qty (No)', 'Est. Revenue', 'Shipping Cost'
];

let activeTabs = new Map();
let closingTabs = new Set();
let launchTasks = new Set();
let timeoutHandles = new Map();
let fallbackWakeTimer = null;
let pumpRunning = false;
let pumpAgain = false;
let stateWriteChain = Promise.resolve();

function defaultState() {
  return {
    version: 8, runId: null, status: 'idle', sourceUrl: '', sourceTabId: null,
    rows: [], nextIndex: 0, retryQueue: [], inFlight: [], attempts: {},
    records: [], errors: [], warnings: [], updatedAt: null, completedAt: null
  };
}

function normalizeState(raw) {
  const state = { ...defaultState(), ...(raw || {}) };
  state.version = 8;
  state.rows = Array.isArray(state.rows) ? state.rows : [];
  state.retryQueue = Array.isArray(state.retryQueue) ? state.retryQueue : [];
  state.inFlight = Array.isArray(state.inFlight) ? state.inFlight : [];
  state.attempts = state.attempts && typeof state.attempts === 'object' ? state.attempts : {};
  state.records = Array.isArray(state.records) ? state.records : [];
  state.errors = Array.isArray(state.errors) ? state.errors : [];
  state.warnings = Array.isArray(state.warnings) ? state.warnings : [];
  state.nextIndex = Number.isInteger(state.nextIndex) && state.nextIndex >= 0 ? state.nextIndex : 0;
  if (!['idle', 'running', 'paused', 'complete'].includes(state.status)) state.status = 'idle';
  state.retryQueue = state.retryQueue.filter(item => item && item.row).map(item => ({ ...item, readyAt: Number(item.readyAt) || 0 }));
  state.inFlight = state.inFlight.filter(item => item && item.key).map(item => ({
    ...item,
    attempt: Number(item.attempt) || 1,
    startedAt: Number(item.startedAt) || Date.now(),
    deadlineAt: Number(item.deadlineAt) || Date.now() + DETAIL_TIMEOUT,
    attemptToken: item.attemptToken || `${state.runId || 'legacy'}:${item.key}:${item.attempt}`
  }));
  return state;
}

async function getState() {
  const result = await chrome.storage.local.get(STATE_KEY);
  return normalizeState(result[STATE_KEY]);
}

async function broadcast(state) {
  if (state.sourceTabId) {
    try { await chrome.tabs.sendMessage(state.sourceTabId, { type: 'TEMU_STATE_UPDATE', state }); } catch (_) {}
  }
  try { chrome.runtime.sendMessage({ type: 'TEMU_STATE_UPDATE', state }, () => { void chrome.runtime.lastError; }); } catch (_) {}
}

async function setState(nextState) {
  const next = normalizeState({ ...nextState, version: 8, updatedAt: new Date().toISOString() });
  await chrome.storage.local.set({ [STATE_KEY]: next });
  broadcast(next).catch(() => {});
  return next;
}

function commitState(mutator) {
  const operation = stateWriteChain.then(async () => {
    const current = await getState();
    const next = await mutator(current);
    return setState(next === undefined ? current : next);
  });
  stateWriteChain = operation.catch(() => {});
  return operation;
}

function jobKey(row, index) {
  return `${row?.orderNo || ''}::${row?.packageId || ''}::${index}`;
}

function failedRetryItems(state) {
  const items = [];
  const seen = new Set();
  for (const error of state.errors || []) {
    const index = Number.isInteger(error.index) ? error.index : Number(error.index);
    if (!Number.isInteger(index) || !state.rows[index]) continue;
    const row = state.rows[index];
    const key = error.key || jobKey(row, index);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ key, index, row, readyAt: 0 });
  }
  return items;
}

function cleanSourceUrl(sourceUrl) {
  try { const url = new URL(sourceUrl); url.hash = ''; return url.toString(); } catch (_) { return sourceUrl; }
}

function isValidSourceUrl(sourceUrl) {
  try { const url = new URL(sourceUrl); return url.origin === SELLER_ORIGIN && url.pathname === BULK_PATH; } catch (_) { return false; }
}

function makeDetailUrl(state, item) {
  const source = new URL(state.sourceUrl);
  if (source.origin !== SELLER_ORIGIN || source.pathname !== BULK_PATH) throw new Error('Invalid Temu bulk-page source URL.');
  const params = new URLSearchParams();
  params.set('parent_order_sn', item.row.orderNo);
  params.set('refer_page_name', 'buy-shipping-bulk-details');
  params.set('refer_page_id', 'temu-order-exporter');
  const sessn = source.searchParams.get('_x_sessn_id');
  if (sessn) params.set('_x_sessn_id', sessn);
  const metadata = encodeURIComponent(JSON.stringify({
    key: item.key, index: item.index, orderNo: item.row.orderNo,
    packageId: item.row.packageId, attempt: item.attempt, attemptToken: item.attemptToken
  }));
  return `${source.origin}${DETAIL_PATH}?${params.toString()}#temu-exporter=${metadata}`;
}

function isNoAuthUrl(url) {
  try { const parsed = new URL(url); return parsed.origin === SELLER_ORIGIN && (NO_AUTH_PATHS.includes(parsed.pathname) || parsed.pathname.includes('no-auth')); } catch (_) { return false; }
}

function isDetailUrl(url) {
  try { const parsed = new URL(url); return parsed.origin === SELLER_ORIGIN && parsed.pathname === DETAIL_PATH; } catch (_) { return false; }
}

function retryDelay(attempt) { return BASE_RETRY_DELAY * (2 ** Math.max(0, attempt - 1)); }
function canUseAlarms() { return Boolean(chrome.alarms?.create && chrome.alarms?.clear && chrome.alarms?.onAlarm?.addListener); }

function clearEntryTimer(key, attemptToken = null) {
  const current = timeoutHandles.get(key);
  if (!current || (attemptToken && current.attemptToken !== attemptToken)) return;
  clearTimeout(current.handle);
  timeoutHandles.delete(key);
}

function clearAllRuntimeTimers() {
  for (const timer of timeoutHandles.values()) clearTimeout(timer.handle);
  timeoutHandles.clear();
  if (fallbackWakeTimer) clearTimeout(fallbackWakeTimer);
  fallbackWakeTimer = null;
}

async function clearWakeAlarm() {
  if (!canUseAlarms()) return;
  try { await chrome.alarms.clear(WAKE_ALARM); } catch (_) {}
}

function earliestWakeAt(state) {
  const deadlines = (state.inFlight || []).map(entry => Number(entry.deadlineAt) || 0).filter(Boolean);
  const retries = (state.retryQueue || []).map(item => Number(item.readyAt) || 0).filter(value => value > 0);
  return [...deadlines, ...retries].sort((a, b) => a - b)[0] || null;
}

async function scheduleWake(state) {
  const nextWakeAt = earliestWakeAt(state);
  if (!nextWakeAt || state.status === 'idle' || state.status === 'complete') {
    if (fallbackWakeTimer) clearTimeout(fallbackWakeTimer);
    fallbackWakeTimer = null;
    await clearWakeAlarm();
    return;
  }
  const delay = Math.max(50, nextWakeAt - Date.now() + 25);
  if (fallbackWakeTimer) clearTimeout(fallbackWakeTimer);
  fallbackWakeTimer = setTimeout(() => {
    fallbackWakeTimer = null;
    recoverOpenDetailTabs().catch(() => {});
  }, delay);
  if (canUseAlarms()) {
    try { await chrome.alarms.create(WAKE_ALARM, { when: Math.max(Date.now() + 500, nextWakeAt) }); } catch (_) {}
  }
}

function armEntryTimeout(entry) {
  clearEntryTimer(entry.key);
  const remaining = Math.max(50, (Number(entry.deadlineAt) || Date.now() + DETAIL_TIMEOUT) - Date.now());
  const handle = setTimeout(async () => {
    timeoutHandles.delete(entry.key);
    const tracked = await findTrackedEntry(entry.tabId);
    if (tracked && tracked.attemptToken === entry.attemptToken) await handleFailure(tracked, 'Timed out waiting for order-detail data.');
  }, remaining);
  timeoutHandles.set(entry.key, { handle, attemptToken: entry.attemptToken });
}

function restoreQueuedItem(state, item) {
  if (!item?.key || state.retryQueue.some(candidate => candidate.key === item.key) || state.inFlight.some(candidate => candidate.key === item.key)) return state;
  return { ...state, retryQueue: [...state.retryQueue, { ...item, readyAt: 0 }] };
}

async function startJob(message, sender) {
  let current = await getState();
  const sourceUrl = cleanSourceUrl(message.sourceUrl || '');
  if (!isValidSourceUrl(sourceUrl)) throw new Error('Open the Temu bulk-shipping page before starting extraction.');
  const preservedPausedTabs = current.status === 'paused' ? new Set(current.inFlight.map(item => item.tabId).filter(Boolean)) : new Set();
  await closeOrphanDetailTabs(preservedPausedTabs);
  if (current.status === 'running' && (current.inFlight.length || activeTabs.size)) {
    await stopJob();
    current = await getState();
  }
  const canResume = current.status === 'paused' && current.sourceUrl === sourceUrl && current.rows.length;
  if (canResume) {
    const resumed = await commitState(state => ({ ...state, status: 'running', sourceTabId: sender.tab?.id || state.sourceTabId }));
    for (const entry of resumed.inFlight) armEntryTimeout(entry);
    await scheduleWake(resumed);
    pump(resumed, resumed.runId);
    return resumed;
  }
  clearAllRuntimeTimers();
  activeTabs.clear();
  const rows = Array.isArray(message.rows) ? message.rows : [];
  const validRows = rows.filter(row => row && row.orderNo && row.packageId);
  const invalidRows = rows.length - validRows.length;
  if (!validRows.length) throw new Error('No valid order rows found. Each row needs an Order No and Package ID.');
  const next = {
    ...defaultState(), runId: Date.now(), status: 'running', sourceUrl,
    sourceTabId: sender.tab?.id || null, rows: validRows, nextIndex: 0,
    warnings: invalidRows ? [{ type: 'preflight', message: `${invalidRows} rendered row(s) were skipped because Order No or Package ID was missing.`, at: new Date().toISOString() }] : []
  };
  const saved = await commitState(() => next);
  await scheduleWake(saved);
  pump(saved, saved.runId);
  return saved;
}

async function pauseJob() {
  const state = await commitState(current => current.status === 'running' ? { ...current, status: 'paused' } : current);
  await scheduleWake(state);
  return state;
}

async function resumeJob(sender = {}) {
  const current = await getState();
  if (current.status !== 'paused' || !current.rows.length) return current;
  const resumed = await commitState(state => ({ ...state, status: 'running', sourceTabId: sender.tab?.id || state.sourceTabId || null }));
  for (const entry of resumed.inFlight) armEntryTimeout(entry);
  await scheduleWake(resumed);
  pump(resumed, resumed.runId);
  return resumed;
}

async function retryFailedJob(sender = {}) {
  const current = await getState();
  const items = failedRetryItems(current);
  if (!items.length || current.status === 'running' || current.inFlight.length || activeTabs.size) return current;
  const failedKeys = new Set(items.map(item => item.key));
  await closeOrphanDetailTabs();
  activeTabs.clear();
  clearAllRuntimeTimers();
  const next = {
    ...current, runId: Date.now(), status: 'running', sourceTabId: sender.tab?.id || current.sourceTabId || null,
    nextIndex: current.rows.length, retryQueue: items, inFlight: [],
    attempts: Object.fromEntries(Object.entries(current.attempts).filter(([key]) => !failedKeys.has(key))),
    records: current.records.filter(record => !failedKeys.has(record.__key)), errors: [], completedAt: null
  };
  const saved = await commitState(() => next);
  await scheduleWake(saved);
  pump(saved, saved.runId);
  return saved;
}

async function closeTabIntentionally(tabId) {
  if (!tabId || tabId < 0) return;
  closingTabs.add(tabId);
  try { await chrome.tabs.remove(tabId); } catch (_) {} finally { closingTabs.delete(tabId); activeTabs.delete(tabId); }
}

function isExporterDetailTab(tab) {
  if (!isDetailUrl(tab?.url || '')) return false;
  try {
    const url = new URL(tab.url);
    return url.hash.startsWith('#temu-exporter=') || url.searchParams.get('refer_page_id') === 'temu-order-exporter' || url.searchParams.get('refer_page_name') === 'buy-shipping-bulk-details';
  } catch (_) { return false; }
}

async function closeOrphanDetailTabs(keepTabIds = new Set()) {
  const tabs = await chrome.tabs.query({ url: [`${SELLER_ORIGIN}${DETAIL_PATH}*`] });
  await Promise.all(tabs.filter(tab => isExporterDetailTab(tab) && !keepTabIds.has(tab.id)).map(tab => closeTabIntentionally(tab.id)));
}

async function stopJob() {
  const current = await getState();
  const stopRunId = Date.now();
  const tabIds = new Set([...activeTabs.keys(), ...current.inFlight.map(item => item.tabId).filter(Boolean)]);
  await commitState(() => ({ ...defaultState(), runId: stopRunId }));
  clearAllRuntimeTimers();
  await Promise.all([...tabIds].map(tabId => closeTabIntentionally(tabId)));
  if (launchTasks.size) await Promise.allSettled([...launchTasks]);
  await closeOrphanDetailTabs();
  activeTabs.clear();
  pumpAgain = false;
  await clearWakeAlarm();
  return getState();
}

async function findTrackedEntry(tabId) {
  if (closingTabs.has(tabId)) return null;
  const active = activeTabs.get(tabId);
  if (active) return active;
  const state = await getState();
  const entry = state.inFlight.find(item => item.tabId === tabId);
  if (entry) activeTabs.set(tabId, entry);
  return entry || null;
}

async function queryOpenTabs() { try { return await chrome.tabs.query({}); } catch (_) { return []; } }

async function recoverOpenDetailTabs() {
  const state = await getState();
  const tabs = await queryOpenTabs();
  const openById = new Map(tabs.filter(tab => tab?.id !== undefined).map(tab => [tab.id, tab]));
  const trackedTabIds = new Set();
  const missingEntries = [];
  for (const entry of state.inFlight) {
    if (!entry.tabId || !openById.has(entry.tabId)) { missingEntries.push(entry); continue; }
    trackedTabIds.add(entry.tabId);
    activeTabs.set(entry.tabId, entry);
    if (state.status === 'running' || state.status === 'paused') {
      if (entry.deadlineAt <= Date.now()) await handleFailure(entry, 'Detail tab timed out while the service worker was inactive.');
      else armEntryTimeout(entry);
    }
  }
  for (const entry of missingEntries) await handleFailure(entry, 'Detail tab was missing during worker recovery.');
  await closeOrphanDetailTabs(state.status === 'running' || state.status === 'paused' ? trackedTabIds : new Set());
  const refreshed = await getState();
  await scheduleWake(refreshed);
  if (refreshed.status === 'running') pump(refreshed, refreshed.runId);
}

function recordMissingFields(record, index) {
  const allowedBlank = new Set(['Est. Revenue', 'Shipping Cost']);
  return EXPORT_COLUMNS.filter(column => !String(record?.[column] ?? '').trim() && (index === 0 || !allowedBlank.has(column)));
}

function validateIncomingRecords(records) {
  if (!Array.isArray(records) || !records.length) return { ok: false, message: 'Detail page returned no product records.' };
  const missing = [];
  records.forEach((record, index) => {
    const fields = recordMissingFields(record, index);
    if (!(record && typeof record === 'object')) fields.push('record');
    if (!record?.['Order No'] && !record?.['Tracking Number']) fields.push('Order identity');
    if (!record?.['Product Details'] && !record?.['Qty (No)']) fields.push('Product identity');
    if (fields.length) missing.push(`row ${index + 1}: ${[...new Set(fields)].join(', ')}`);
  });
  return missing.length ? { ok: false, message: `Invalid detail payload. Missing ${missing.join('; ')}` } : { ok: true };
}

async function handleFailure(entry, message) {
  if (!entry || !entry.key) return;
  clearEntryTimer(entry.key, entry.attemptToken);
  const state = await getState();
  const currentEntry = state.inFlight.find(item => item.key === entry.key);
  if (state.runId !== entry.runId || !currentEntry || (entry.attemptToken && currentEntry.attemptToken !== entry.attemptToken)) return;
  const attempts = state.attempts[entry.key] || entry.attempt;
  activeTabs.delete(entry.tabId);
  if (attempts < MAX_ATTEMPTS && state.status !== 'idle') {
    const readyAt = Date.now() + retryDelay(attempts);
    const retryQueue = [...state.retryQueue.filter(item => item.key !== entry.key), { key: entry.key, index: entry.index, row: entry.row, readyAt }];
    const saved = await commitState(current => {
      if (current.runId !== entry.runId || !current.inFlight.some(item => item.key === entry.key)) return current;
      return { ...current, inFlight: current.inFlight.filter(item => item.key !== entry.key), retryQueue };
    });
    await closeTabIntentionally(entry.tabId);
    await scheduleWake(saved);
    pump(saved, saved.runId);
    return;
  }
  const errorRecord = { key: entry.key, index: entry.index, orderNo: entry.row?.orderNo || '', packageId: entry.row?.packageId || '', attempts, message, at: new Date().toISOString() };
  const saved = await commitState(current => {
    if (current.runId !== entry.runId || !current.inFlight.some(item => item.key === entry.key)) return current;
    return { ...current, inFlight: current.inFlight.filter(item => item.key !== entry.key), errors: [...current.errors.filter(error => error.key !== entry.key), errorRecord] };
  });
  await closeTabIntentionally(entry.tabId);
  await scheduleWake(saved);
  pump(saved, saved.runId);
}

async function handleSuccess(entry, productRecords, missing = []) {
  if (!entry || !entry.key) return;
  const incomingRecords = Array.isArray(productRecords) ? productRecords : (productRecords ? [productRecords] : []);
  const validation = validateIncomingRecords(incomingRecords);
  if (!validation.ok) { await handleFailure(entry, validation.message); return; }
  const state = await getState();
  const currentEntry = state.inFlight.find(item => item.key === entry.key);
  if (state.runId !== entry.runId || !currentEntry || (entry.attemptToken && currentEntry.attemptToken !== entry.attemptToken)) return;
  clearEntryTimer(entry.key, entry.attemptToken);
  const warning = missing.length ? { key: entry.key, index: entry.index, orderNo: entry.row?.orderNo || '', packageId: entry.row?.packageId || '', message: `Parser warning: ${missing.join(', ')}`, at: new Date().toISOString() } : null;
  const saved = await commitState(current => {
    if (current.runId !== entry.runId || !current.inFlight.some(item => item.key === entry.key)) return current;
    const records = [...current.records.filter(item => item.__key !== entry.key), ...incomingRecords.map((record, lineIndex) => ({ ...record, __key: entry.key, __index: entry.index, __lineIndex: lineIndex, __attempts: current.attempts[entry.key] || entry.attempt }))];
    return { ...current, inFlight: current.inFlight.filter(item => item.key !== entry.key), records, warnings: warning ? [...current.warnings.filter(item => item.key !== entry.key), warning] : current.warnings };
  });
  activeTabs.delete(entry.tabId);
  await closeTabIntentionally(entry.tabId);
  await scheduleWake(saved);
  pump(saved, saved.runId);
}

async function restoreTakenItem(item, runId) {
  if (!item?.key) return;
  const saved = await commitState(state => state.runId !== runId || state.status === 'idle' || state.status === 'complete' ? state : restoreQueuedItem(state, item));
  await scheduleWake(saved);
}

async function takeNextItem(runId) {
  let selected = null;
  const saved = await commitState(state => {
    if (state.runId !== runId || state.status !== 'running' || state.inFlight.length >= MAX_CONCURRENCY) return state;
    const occupied = new Set(state.inFlight.map(entry => entry.key));
    const retryIndex = state.retryQueue.findIndex(item => !occupied.has(item.key) && (!item.readyAt || item.readyAt <= Date.now()));
    if (retryIndex >= 0) {
      selected = { ...state.retryQueue[retryIndex] };
      return { ...state, retryQueue: state.retryQueue.filter((_, index) => index !== retryIndex) };
    }
    if (state.nextIndex < state.rows.length) {
      const index = state.nextIndex;
      const row = state.rows[index];
      selected = { key: jobKey(row, index), index, row, readyAt: 0 };
      return { ...state, nextIndex: index + 1 };
    }
    return state;
  });
  return { state: saved, item: selected };
}

async function launchItem(item, runId) {
  const task = (async () => {
    let entry = null;
    try {
      const current = await getState();
      if (current.status !== 'running' || current.runId !== runId) { await restoreTakenItem(item, runId); return; }
      if (!item.row?.orderNo || !item.row?.packageId) { await restoreTakenItem(item, runId); return; }
      const attempt = (current.attempts[item.key] || 0) + 1;
      const attemptToken = `${runId}:${item.key}:${attempt}:${Date.now()}`;
      entry = { key: item.key, index: item.index, row: item.row, attempt, attemptToken, runId, tabId: null, startedAt: Date.now(), deadlineAt: Date.now() + DETAIL_TIMEOUT };
      const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
      entry.tabId = tab.id;
      const queued = await commitState(state => {
        if (state.status !== 'running' || state.runId !== runId) return state;
        return { ...state, attempts: { ...state.attempts, [item.key]: attempt }, inFlight: [...state.inFlight.filter(candidate => candidate.key !== item.key), entry] };
      });
      if (queued.status !== 'running' || queued.runId !== runId || !queued.inFlight.some(candidate => candidate.attemptToken === attemptToken)) { await closeTabIntentionally(tab.id); await restoreTakenItem(item, runId); return; }
      activeTabs.set(tab.id, entry);
      await chrome.tabs.update(tab.id, { url: makeDetailUrl(queued, entry) });
      armEntryTimeout(entry);
      await scheduleWake(queued);
    } catch (error) {
      if (entry?.tabId) await handleFailure(entry, error?.message || 'Could not create or navigate detail tab.');
      else await restoreTakenItem(item, runId);
    }
  })();
  launchTasks.add(task);
  try { await task; } finally { launchTasks.delete(task); }
}

async function pump(inputState = null, expectedRunId = null) {
  if (pumpRunning) { pumpAgain = true; return; }
  pumpRunning = true;
  try {
    const sourceState = normalizeState(inputState || await getState());
    if (sourceState.status !== 'running' || (expectedRunId !== null && sourceState.runId !== expectedRunId)) return;
    while (true) {
      const current = await getState();
      if (current.status !== 'running' || (expectedRunId !== null && current.runId !== expectedRunId)) return;
      if (current.inFlight.length >= MAX_CONCURRENCY) break;
      const next = await takeNextItem(current.runId);
      if (!next.item) break;
      await launchItem(next.item, current.runId);
    }
    const refreshed = await getState();
    await scheduleWake(refreshed);
    if (refreshed.status === 'running' && refreshed.nextIndex >= refreshed.rows.length && !refreshed.retryQueue.length && !refreshed.inFlight.length) {
      const completed = await commitState(state => state.runId === refreshed.runId && state.status === 'running' ? { ...state, status: 'complete', completedAt: new Date().toISOString() } : state);
      await scheduleWake(completed);
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

if (chrome.action?.onClicked?.addListener) {
  chrome.action.onClicked.addListener(async tab => {
    try {
      if (tab?.id && tab.url?.startsWith(SELLER_ORIGIN) && new URL(tab.url).pathname === BULK_PATH) {
        chrome.tabs.sendMessage(tab.id, { type: 'TEMU_OPEN_PANEL' }, () => { void chrome.runtime.lastError; });
        return;
      }
      if (tab?.id) await chrome.tabs.update(tab.id, { url: `${SELLER_ORIGIN}${BULK_PATH}` });
      else await chrome.tabs.create({ url: `${SELLER_ORIGIN}${BULK_PATH}` });
    } catch (_) { /* user can reopen the bulk page manually if a tab is unavailable */ }
  });
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (closingTabs.has(tabId)) return;
  const entry = await findTrackedEntry(tabId);
  if (!entry || changeInfo.status !== 'complete') return;
  if (!tab.url || tab.url === 'about:blank' || tab.url.startsWith('chrome://')) return;
  if (isNoAuthUrl(tab.url)) { await handleFailure(entry, 'Temu opened a no-auth or no-internet page.'); return; }
  if (!isDetailUrl(tab.url)) await handleFailure(entry, `Unexpected page opened: ${tab.url || 'unknown URL'}`);
});

chrome.tabs.onRemoved.addListener(async tabId => {
  if (closingTabs.has(tabId)) { closingTabs.delete(tabId); activeTabs.delete(tabId); return; }
  const entry = await findTrackedEntry(tabId);
  if (entry) await handleFailure(entry, 'Detail tab closed before extraction completed.');
});

if (chrome.alarms?.onAlarm?.addListener) chrome.alarms.onAlarm.addListener(async alarm => { if (alarm?.name === WAKE_ALARM) await recoverOpenDetailTabs(); });
if (chrome.runtime.onStartup?.addListener) chrome.runtime.onStartup.addListener(() => recoverOpenDetailTabs().catch(() => {}));
recoverOpenDetailTabs().catch(() => {});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === 'TEMU_START_JOB') sendResponse({ ok: true, state: await startJob(message, sender) });
    else if (message?.type === 'TEMU_PAUSE_JOB') sendResponse({ ok: true, state: await pauseJob() });
    else if (message?.type === 'TEMU_RETRY_FAILED') sendResponse({ ok: true, state: await retryFailedJob(sender) });
    else if (message?.type === 'TEMU_RESUME_JOB') sendResponse({ ok: true, state: await resumeJob(sender) });
    else if (message?.type === 'TEMU_STOP_JOB') sendResponse({ ok: true, state: await stopJob() });
    else if (message?.type === 'TEMU_GET_STATE') sendResponse({ ok: true, state: await getState() });
    else if (message?.type === 'TEMU_OPEN_PANEL') {
      const current = await getState();
      if (current.sourceTabId) {
        try { await chrome.tabs.sendMessage(current.sourceTabId, { type: 'TEMU_OPEN_PANEL' }); sendResponse({ ok: true }); }
        catch (_) { sendResponse({ ok: false, error: 'Open the Temu bulk page to resume the panel.' }); }
      } else sendResponse({ ok: false, error: 'Open the Temu bulk page to resume the panel.' });
    }
    else if (message?.type === 'TEMU_OPEN_TOOLS') {
      try { await chrome.tabs.create({ url: chrome.runtime.getURL('tools.html') }); sendResponse({ ok: true }); }
      catch (_) { sendResponse({ ok: false, error: 'Could not open History & Tools.' }); }
    }
    else if (message?.type === 'TEMU_UI_PREFS_UPDATE') sendResponse({ ok: true });
    else if (message?.type === 'TEMU_DETAIL_RESULT' && sender.tab?.id) {
      const entry = await findTrackedEntry(sender.tab.id);
      if (entry) await handleSuccess(entry, message.records || message.record, message.missing || []);
      sendResponse({ ok: Boolean(entry), accepted: Boolean(entry) });
    } else if (message?.type === 'TEMU_DETAIL_ERROR' && sender.tab?.id) {
      const entry = await findTrackedEntry(sender.tab.id);
      if (entry) await handleFailure(entry, message.message || 'Detail extraction failed.');
      sendResponse({ ok: Boolean(entry), accepted: Boolean(entry) });
    } else sendResponse({ ok: false, error: 'Unknown message type.' });
  })().catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
  return true;
});
