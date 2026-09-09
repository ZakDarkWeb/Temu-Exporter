'use strict';

importScripts('constants.js');
const C = self.TEMU_CONSTANTS;
const { STORAGE_KEYS, MSG, SELLER_ORIGIN, BULK_PATH, DETAIL_PATH } = C;

const STATE_KEY    = STORAGE_KEYS.STATE;
const UI_KEY       = STORAGE_KEYS.UI;
const SCHEDULE_KEY = STORAGE_KEYS.SCHEDULE;
const CONCURRENCY_KEY = STORAGE_KEYS.CONCURRENCY;
const NO_AUTH_PATHS = ['/no-auth.html', '/login.html'];

// Adaptive concurrency: starts at 2, auto-adjusts between 1-4 based on response times.
// Persisted in chrome.storage.session so a service-worker restart does not reset it.
const CONCURRENCY_MIN = 1;
const CONCURRENCY_MAX = 4;
const CONCURRENCY_DEFAULT = 2;
const CONCURRENCY_COOLDOWN_MS = 15000;
const CONCURRENCY_SAMPLE_SIZE = 6;
let adaptiveConcurrency = {
  current: CONCURRENCY_DEFAULT,
  responseTimes: [],   // last N successful response times (ms)
  lastTimeout: 0,      // timestamp of last timeout — used for cooldown
  cooldownUntil: 0     // don't increase during cooldown
};
let concurrencyReady = null; // promise resolved once persisted concurrency is loaded

const MAX_ATTEMPTS = 3;
const BASE_RETRY_DELAY = 1200;
const DETAIL_TIMEOUT = 30000;
const WAKE_ALARM     = 'temu-order-exporter-wake';
const SCHEDULE_ALARM = 'temu-order-exporter-schedule';

let activeTabs = new Map();
let tabPool = new Set();
let idleTabs = [];
let closingTabs = new Set();
let closingTasks = new Map();
let launchTasks = new Set();
let timeoutHandles = new Map();
let fallbackWakeTimer = null;
let pumpRunning = false;
let pumpAgain = false;
// Incremented whenever a control action invalidates pending tab launches.
// This lets Pause/Stop return immediately while late async launches self-cancel.
let operationEpoch = 0;
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
    try { await chrome.tabs.sendMessage(state.sourceTabId, { type: MSG.STATE_UPDATE, state }); } catch (_) {}
  }
  try { chrome.runtime.sendMessage({ type: MSG.STATE_UPDATE, state }, () => { void chrome.runtime.lastError; }); } catch (_) {}
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
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function getActiveProfile() {
  try {
    const stored = await chrome.storage.local.get(UI_KEY);
    const prefs = stored[UI_KEY] || {};
    const id = prefs.speedProfile || 'balanced';
    if (id === 'stealth') return C.SPEED_PROFILES.STEALTH;
    if (id === 'turbo') return C.SPEED_PROFILES.TURBO;
    return C.SPEED_PROFILES.BALANCED;
  } catch (_) {
    return C.SPEED_PROFILES.BALANCED;
  }
}

async function acquireWorkerTab() {
  while (idleTabs.length > 0) {
    const tabId = idleTabs.pop();
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab && !tab.discarded) {
        tabPool.add(tabId);
        return tabId;
      }
    } catch (_) {
      tabPool.delete(tabId);
    }
  }
  const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
  tabPool.add(tab.id);
  return tab.id;
}

async function releaseWorkerTab(tabId, state) {
  activeTabs.delete(tabId);
  if (!tabId || tabId < 0) return;
  const profile = await getActiveProfile();
  const maxTabs = profile.id === 'stealth' ? 1 : Math.min(profile.concurrency, adaptiveConcurrency.current);
  if (state?.status === 'running' && tabPool.has(tabId) && tabPool.size <= maxTabs) {
    try {
      await chrome.tabs.update(tabId, { url: 'about:blank' });
      if (!idleTabs.includes(tabId)) idleTabs.push(tabId);
      return;
    } catch (_) {
      // Tab may be closed or broken
    }
  }
  tabPool.delete(tabId);
  idleTabs = idleTabs.filter(id => id !== tabId);
  await closeTabIntentionally(tabId);
}

async function drainTabPool() {
  const tabsToClose = [...tabPool];
  tabPool.clear();
  idleTabs = [];
  await Promise.all(tabsToClose.map(id => closeTabIntentionally(id)));
}

function sessionStore() {
  return chrome.storage.session || chrome.storage.local;
}

async function loadConcurrency() {
  if (!concurrencyReady) {
    concurrencyReady = (async () => {
      try {
        const stored = await sessionStore().get(CONCURRENCY_KEY);
        const saved = stored[CONCURRENCY_KEY];
        if (saved && typeof saved === 'object') {
          adaptiveConcurrency = {
            current: Math.min(CONCURRENCY_MAX, Math.max(CONCURRENCY_MIN, Number(saved.current) || CONCURRENCY_DEFAULT)),
            responseTimes: Array.isArray(saved.responseTimes) ? saved.responseTimes.slice(-CONCURRENCY_SAMPLE_SIZE) : [],
            lastTimeout: Number(saved.lastTimeout) || 0,
            cooldownUntil: Number(saved.cooldownUntil) || 0
          };
        }
      } catch (_) { /* keep defaults */ }
    })();
  }
  return concurrencyReady;
}

function saveConcurrency() {
  try { sessionStore().set({ [CONCURRENCY_KEY]: adaptiveConcurrency }).catch(() => {}); } catch (_) {}
}

function resetConcurrency() {
  adaptiveConcurrency = { current: CONCURRENCY_DEFAULT, responseTimes: [], lastTimeout: 0, cooldownUntil: 0 };
  saveConcurrency();
}

// Send a log line to the card on the bulk page (content scripts are only
// reachable via tabs.sendMessage) and to any open extension page (tools).
function sendLog(level, message) {
  getState().then(state => {
    if (state.sourceTabId) chrome.tabs.sendMessage(state.sourceTabId, { type: MSG.LOG, level, message }, () => { void chrome.runtime.lastError; });
  }).catch(() => {});
  try { chrome.runtime.sendMessage({ type: MSG.LOG, level, message }, () => { void chrome.runtime.lastError; }); } catch (_) {}
}

// Adaptive concurrency: call after each success (responseMs = how long the tab took)
// or after a timeout (isTimeout = true). Adjusts adaptiveConcurrency.current and
// broadcasts a log message so the user can see speed changes in the card.
async function adjustConcurrency(responseMs, isTimeout = false) {
  const profile = await getActiveProfile();
  const ac = adaptiveConcurrency;
  if (profile.id === 'stealth') {
    ac.current = 1;
    saveConcurrency();
    return;
  }
  const minLimit = profile.id === 'turbo' ? 2 : 1;
  const maxLimit = profile.id === 'turbo' ? 4 : 3;

  if (isTimeout) {
    ac.lastTimeout = Date.now();
    ac.cooldownUntil = Date.now() + CONCURRENCY_COOLDOWN_MS;
    const prev = ac.current;
    ac.current = minLimit;
    ac.responseTimes = []; // reset history
    saveConcurrency();
    if (prev !== ac.current) sendLog('warn', `Speed reduced to ${ac.current} tab (timeout detected, ${CONCURRENCY_COOLDOWN_MS / 1000}s cooldown)`);
    return;
  }
  ac.responseTimes.push(responseMs);
  if (ac.responseTimes.length > CONCURRENCY_SAMPLE_SIZE) ac.responseTimes.shift();
  if (ac.responseTimes.length < 3) return; // need at least 3 samples
  const avg = ac.responseTimes.reduce((s, v) => s + v, 0) / ac.responseTimes.length;
  const now = Date.now();
  const inCooldown = now < ac.cooldownUntil;
  const prev = ac.current;
  if (!inCooldown && avg < 8000 && ac.current < maxLimit) {
    ac.current = Math.min(maxLimit, ac.current + 1);
  } else if (avg > 18000 && ac.current > minLimit) {
    ac.current = Math.max(minLimit, ac.current - 1);
  } else if (!inCooldown && avg < 12000 && ac.current < 2) {
    ac.current = 2;
  }
  saveConcurrency();
  if (prev !== ac.current) {
    const dir = ac.current > prev ? 'increased' : 'reduced';
    sendLog('info', `Speed ${dir} to ${ac.current} tabs (avg ${(avg / 1000).toFixed(1)}s/order) [${profile.label}]`);
  }
}

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
  await drainTabPool();
  operationEpoch += 1;
  resetConcurrency();
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
  let tabIds = new Set();
  const state = await commitState(current => {
    if (current.status !== 'running') return current;
    tabIds = new Set(current.inFlight.map(item => item.tabId).filter(Boolean));
    const queuedKeys = new Set(current.retryQueue.map(item => item.key));
    const requeued = current.inFlight
      .filter(item => item?.key && !queuedKeys.has(item.key))
      .map(item => ({ key: item.key, index: item.index, row: item.row, readyAt: 0 }));
    // A pause is not a failure: refund the attempt that launchItem charged for
    // each interrupted tab, otherwise repeated pauses exhaust MAX_ATTEMPTS.
    const attempts = { ...current.attempts };
    for (const item of current.inFlight) {
      if (!item?.key) continue;
      const charged = Number(attempts[item.key]) || 0;
      if (charged > 0) attempts[item.key] = charged - 1;
    }
    return {
      ...current,
      status: 'paused',
      inFlight: [],
      attempts,
      retryQueue: [...current.retryQueue, ...requeued]
    };
  });
  if (state.status !== 'paused') return state;
  operationEpoch += 1;
  clearAllRuntimeTimers();
  activeTabs.clear();
  await drainTabPool();
  // Closing active detail tabs makes Pause immediate. Their entries were
  // requeued above, so no extracted order is lost and no stale callback can
  // advance the queue after the pause. The browser close calls continue in
  // the background; the UI does not wait on slow tab-removal callbacks.
  Promise.all([...tabIds].map(tabId => closeTabIntentionally(tabId))).catch(() => {});
  clearWakeAlarm().catch(() => {});
  return state;
}

async function resumeJob(sender = {}) {
  const current = await getState();
  if (current.status !== 'paused' || !current.rows.length) return current;
  // A fast Resume immediately after Pause must not overlap the old detail
  // tabs with the new queue. Waiting here is safe because Pause itself is
  // already acknowledged without waiting.
  await waitForClosingTabs();
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
  if (closingTasks.has(tabId)) return closingTasks.get(tabId);
  closingTabs.add(tabId);
  const task = (async () => {
    try { await chrome.tabs.remove(tabId); } catch (_) {}
    finally {
      closingTabs.delete(tabId);
      activeTabs.delete(tabId);
      closingTasks.delete(tabId);
    }
  })();
  closingTasks.set(tabId, task);
  return task;
}

async function waitForClosingTabs() {
  const pending = [...closingTasks.values()];
  if (pending.length) await Promise.allSettled(pending);
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
  // Invalidate pending create/update operations before changing persistent
  // state. Any late-created tab will see the epoch mismatch and close itself.
  operationEpoch += 1;
  const stopped = await commitState(() => ({ ...defaultState(), runId: stopRunId }));
  clearAllRuntimeTimers();
  activeTabs.clear();
  await drainTabPool();
  pumpAgain = false;
  // The persistent state is already cleared. Close known tabs in the
  // background so Stop/Clear responds immediately even if Chrome is slow.
  Promise.all([...tabIds].map(tabId => closeTabIntentionally(tabId))).catch(() => {});
  // Orphan cleanup is best-effort and must not delay the user-facing Stop
  // response.
  closeOrphanDetailTabs().catch(() => {});
  clearWakeAlarm().catch(() => {});
  return stopped;
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


function validateIncomingRecords(records) {
  if (!Array.isArray(records) || !records.length) return { ok: false, message: 'Detail page returned no product records.' };
  const missing = [];
  records.forEach((record, index) => {
    const fields = C.missingRequiredFields(record, index);
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
  // Timeout detection for adaptive concurrency
  const isTimeoutMsg = /timed out|timeout/i.test(message || '') && !/service worker/i.test(message || '');
  if (isTimeoutMsg) { await loadConcurrency(); adjustConcurrency(DETAIL_TIMEOUT, true); }
  const state = await getState();
  const currentEntry = state.inFlight.find(item => item.key === entry.key);
  if (state.runId !== entry.runId || !currentEntry || (entry.attemptToken && currentEntry.attemptToken !== entry.attemptToken)) return;
  const attempts = state.attempts[entry.key] || entry.attempt;
  // BUG FIX: activeTabs.delete MOVED to after commitState (below).
  // Deleting before commitState created a race window: if onRemoved fired between
  // activeTabs.delete and commitState, findTrackedEntry would re-read the entry from
  // storage (still in inFlight) and trigger a second handleFailure for the same entry.
  if (attempts < MAX_ATTEMPTS && state.status !== 'idle') {
    const readyAt = Date.now() + retryDelay(attempts);
    const retryQueue = [...state.retryQueue.filter(item => item.key !== entry.key), { key: entry.key, index: entry.index, row: entry.row, readyAt }];
    const saved = await commitState(current => {
      if (current.runId !== entry.runId || !current.inFlight.some(item => item.key === entry.key)) return current;
      return { ...current, inFlight: current.inFlight.filter(item => item.key !== entry.key), retryQueue };
    });
    // Now safe to remove from activeTabs — entry is out of both activeTabs and inFlight
    await releaseWorkerTab(entry.tabId, saved);
    // Only pump if commitState actually modified state (guard didn't reject)
    if (saved.runId === entry.runId) {
      await scheduleWake(saved);
      pump(saved, saved.runId);
    }
    return;
  }
  const errorRecord = { key: entry.key, index: entry.index, orderNo: entry.row?.orderNo || '', packageId: entry.row?.packageId || '', attempts, message, at: new Date().toISOString() };
  const saved = await commitState(current => {
    if (current.runId !== entry.runId || !current.inFlight.some(item => item.key === entry.key)) return current;
    return { ...current, inFlight: current.inFlight.filter(item => item.key !== entry.key), errors: [...current.errors.filter(error => error.key !== entry.key), errorRecord] };
  });
  // Now safe to remove from activeTabs
  await releaseWorkerTab(entry.tabId, saved);
  if (saved.runId === entry.runId) {
    await scheduleWake(saved);
    pump(saved, saved.runId);
  }
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
  // Track response time for adaptive concurrency (only for the live attempt)
  if (currentEntry.startedAt) { await loadConcurrency(); adjustConcurrency(Date.now() - currentEntry.startedAt, false); }
  const warning = missing.length ? { key: entry.key, index: entry.index, orderNo: entry.row?.orderNo || '', packageId: entry.row?.packageId || '', message: `Parser warning: ${missing.join(', ')}`, at: new Date().toISOString() } : null;
  const saved = await commitState(current => {
    if (current.runId !== entry.runId || !current.inFlight.some(item => item.key === entry.key)) return current;
    const records = [...current.records.filter(item => item.__key !== entry.key), ...incomingRecords.map((record, lineIndex) => ({ ...record, __key: entry.key, __index: entry.index, __lineIndex: lineIndex, __attempts: current.attempts[entry.key] || entry.attempt }))];
    return { ...current, inFlight: current.inFlight.filter(item => item.key !== entry.key), records, warnings: warning ? [...current.warnings.filter(item => item.key !== entry.key), warning] : current.warnings };
  });
  await releaseWorkerTab(entry.tabId, saved);
  await scheduleWake(saved);
  pump(saved, saved.runId);
}

async function restoreTakenItem(item, runId) {
  if (!item?.key) return;
  const saved = await commitState(state => state.runId !== runId || state.status === 'idle' || state.status === 'complete' ? state : restoreQueuedItem(state, item));
  await scheduleWake(saved);
}

async function takeNextItem(runId, maxConcurrency = null) {
  const profile = await getActiveProfile();
  const limit = maxConcurrency ?? (profile.id === 'stealth' ? 1 : Math.min(profile.concurrency, adaptiveConcurrency.current));
  let selected = null;
  const saved = await commitState(state => {
    if (state.runId !== runId || state.status !== 'running' || state.inFlight.length >= limit) return state;
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
  const launchEpoch = operationEpoch;
  const task = (async () => {
    let entry = null;
    try {
      const current = await getState();
      if (launchEpoch !== operationEpoch) { await restoreTakenItem(item, runId); return; }
      if (current.status !== 'running' || current.runId !== runId) { await restoreTakenItem(item, runId); return; }
      if (!item.row?.orderNo || !item.row?.packageId) { await restoreTakenItem(item, runId); return; }
      const attempt = (current.attempts[item.key] || 0) + 1;
      const attemptToken = `${runId}:${item.key}:${attempt}:${Date.now()}`;
      entry = { key: item.key, index: item.index, row: item.row, attempt, attemptToken, runId, tabId: null, startedAt: Date.now(), deadlineAt: Date.now() + DETAIL_TIMEOUT };
      const tabId = await acquireWorkerTab();
      entry.tabId = tabId;
      if (launchEpoch !== operationEpoch) {
        await releaseWorkerTab(tabId, current);
        await restoreTakenItem(item, runId);
        return;
      }
      const queued = await commitState(state => {
        if (launchEpoch !== operationEpoch || state.status !== 'running' || state.runId !== runId) return state;
        return { ...state, attempts: { ...state.attempts, [item.key]: attempt }, inFlight: [...state.inFlight.filter(candidate => candidate.key !== item.key), entry] };
      });
      // Guard after commitState: if invalid, release tab
      if (queued.status !== 'running' || queued.runId !== runId || !queued.inFlight.some(candidate => candidate.attemptToken === attemptToken)) {
        await releaseWorkerTab(tabId, queued);
        await restoreTakenItem(item, runId);
        return;
      }
      activeTabs.set(tabId, entry);

      // Stealth / human-like pacing delay
      const profile = await getActiveProfile();
      if (profile.minDelay > 0) {
        const jitter = profile.minDelay + Math.random() * (profile.maxDelay - profile.minDelay);
        await sleep(jitter);
      }
      if (launchEpoch !== operationEpoch) {
        await releaseWorkerTab(tabId, queued);
        await restoreTakenItem(item, runId);
        return;
      }

      await chrome.tabs.update(tabId, { url: makeDetailUrl(queued, entry) });
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
    await loadConcurrency();
    const profile = await getActiveProfile();
    const effectiveMax = profile.id === 'stealth' ? 1 : Math.min(profile.concurrency, adaptiveConcurrency.current);
    const sourceState = normalizeState(inputState || await getState());
    if (sourceState.status !== 'running' || (expectedRunId !== null && sourceState.runId !== expectedRunId)) return;
    while (true) {
      const current = await getState();
      if (current.status !== 'running' || (expectedRunId !== null && current.runId !== expectedRunId)) return;
      if (current.inFlight.length >= effectiveMax) break;
      const next = await takeNextItem(current.runId, effectiveMax);
      if (!next.item) break;
      await launchItem(next.item, current.runId);
    }
    const refreshed = await getState();
    await scheduleWake(refreshed);
    if (refreshed.status === 'running' && refreshed.nextIndex >= refreshed.rows.length && !refreshed.retryQueue.length && !refreshed.inFlight.length) {
      const completed = await commitState(state => state.runId === refreshed.runId && state.status === 'running' ? { ...state, status: 'complete', completedAt: new Date().toISOString() } : state);
      await scheduleWake(completed);
      await drainTabPool();
      // Notify on completion
      try {
        const uiStored = await chrome.storage.local.get(UI_KEY);
        const prefs = uiStored[UI_KEY] || {};
        if (prefs.notifyOnComplete && chrome.notifications?.create) {
          const records = completed.records?.length || 0;
          const errors  = completed.errors?.length || 0;
          chrome.notifications.create('temu-complete-' + Date.now(), {
            type: 'basic',
            iconUrl: chrome.runtime.getURL('icons/icon128.png'),
            title: 'Temu Order Exporter — Export Complete',
            message: `${records} records exported${errors ? `, ${errors} error(s).` : ' successfully.'}`
          });
        }
      } catch (_) {}
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
        chrome.tabs.sendMessage(tab.id, { type: MSG.OPEN_PANEL }, () => { void chrome.runtime.lastError; });
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
  tabPool.delete(tabId);
  idleTabs = idleTabs.filter(id => id !== tabId);
  if (closingTabs.has(tabId)) return; // intentionally closing — ignore
  const entry = await findTrackedEntry(tabId);
  if (entry) await handleFailure(entry, 'Detail tab closed before extraction completed.');
});

if (chrome.alarms?.onAlarm?.addListener) chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm?.name === WAKE_ALARM) await recoverOpenDetailTabs();
  if (alarm?.name === SCHEDULE_ALARM) {
    // Scheduled daily auto-run: open or navigate to the bulk page
    try {
      const current = await getState();
      if (current.status === 'idle' || current.status === 'complete') {
        const stored = await chrome.storage.local.get(SCHEDULE_KEY);
        const schedule = stored[SCHEDULE_KEY] || {};
        if (schedule.enabled) {
          const tabs = await chrome.tabs.query({ url: `${SELLER_ORIGIN}${BULK_PATH}*` });
          if (tabs.length) {
            chrome.tabs.sendMessage(tabs[0].id, { type: MSG.OPEN_PANEL }, () => { void chrome.runtime.lastError; });
          } else {
            await chrome.tabs.create({ url: `${SELLER_ORIGIN}${BULK_PATH}` });
          }
        }
      }
    } catch (_) {}
  }
});
if (chrome.runtime.onStartup?.addListener) chrome.runtime.onStartup.addListener(() => recoverOpenDetailTabs().catch(() => {}));
recoverOpenDetailTabs().catch(() => {});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === MSG.START_JOB) sendResponse({ ok: true, state: await startJob(message, sender) });
    else if (message?.type === MSG.PAUSE_JOB) sendResponse({ ok: true, state: await pauseJob() });
    else if (message?.type === MSG.RETRY_FAILED) sendResponse({ ok: true, state: await retryFailedJob(sender) });
    else if (message?.type === MSG.RESUME_JOB) sendResponse({ ok: true, state: await resumeJob(sender) });
    else if (message?.type === MSG.STOP_JOB) sendResponse({ ok: true, state: await stopJob() });
    else if (message?.type === MSG.GET_STATE) sendResponse({ ok: true, state: await getState() });
    else if (message?.type === MSG.OPEN_PANEL) {
      const current = await getState();
      if (current.sourceTabId) {
        try { await chrome.tabs.sendMessage(current.sourceTabId, { type: MSG.OPEN_PANEL }); sendResponse({ ok: true }); }
        catch (_) { sendResponse({ ok: false, error: 'Open the Temu bulk page to resume the panel.' }); }
      } else sendResponse({ ok: false, error: 'Open the Temu bulk page to resume the panel.' });
    }
    else if (message?.type === MSG.OPEN_TOOLS) {
      try { await chrome.tabs.create({ url: chrome.runtime.getURL('tools.html') }); sendResponse({ ok: true }); }
      catch (_) { sendResponse({ ok: false, error: 'Could not open History & Tools.' }); }
    }
    else if (message?.type === MSG.UI_PREFS_UPDATE) sendResponse({ ok: true });
    else if (message?.type === MSG.SCHEDULE_SET) {
      try {
        if (canUseAlarms()) await chrome.alarms.clear(SCHEDULE_ALARM);
        if (message.enabled && message.time) {
          const [hours, minutes] = message.time.split(':').map(Number);
          const now = new Date();
          const next = new Date();
          next.setHours(hours, minutes, 0, 0);
          if (next <= now) next.setDate(next.getDate() + 1);
          await chrome.storage.local.set({ [SCHEDULE_KEY]: { enabled: true, time: message.time } });
          if (canUseAlarms()) {
            await chrome.alarms.create(SCHEDULE_ALARM, { when: next.getTime(), periodInMinutes: 1440 });
          }
          sendResponse({ ok: true, nextRun: next.toISOString() });
        } else {
          await chrome.storage.local.set({ [SCHEDULE_KEY]: { enabled: false } });
          sendResponse({ ok: true });
        }
      } catch (err) { sendResponse({ ok: false, error: err?.message }); }
    }
    else if (message?.type === MSG.DETAIL_RESULT && sender.tab?.id) {
      const entry = await findTrackedEntry(sender.tab.id);
      if (entry) await handleSuccess(entry, message.records || message.record, message.missing || []);
      sendResponse({ ok: Boolean(entry), accepted: Boolean(entry) });
    } else if (message?.type === MSG.DETAIL_ERROR && sender.tab?.id) {
      const entry = await findTrackedEntry(sender.tab.id);
      if (entry) await handleFailure(entry, message.message || 'Detail extraction failed.');
      sendResponse({ ok: Boolean(entry), accepted: Boolean(entry) });
    } else sendResponse({ ok: false, error: 'Unknown message type.' });
  })().catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
  return true;
});
