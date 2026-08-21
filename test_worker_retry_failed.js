const fs = require('fs');
const vm = require('vm');
const path = require('path');

const STATE_KEY = 'temuOrderExporterStateV7';
const storage = {
  [STATE_KEY]: {
    version: 7,
    runId: 44,
    status: 'complete',
    sourceUrl: 'https://seller.temu.com/buy-shipping-bulk-details.html?_x_sessn_id=retry-session',
    sourceTabId: 9,
    rows: [
      { orderNo: 'PO-1', packageId: 'PK-1' },
      { orderNo: 'PO-2', packageId: 'PK-2' },
      { orderNo: 'PO-3', packageId: 'PK-3' }
    ],
    nextIndex: 3,
    retryQueue: [],
    inFlight: [],
    attempts: { 'PO-1::PK-1::0': 1, 'PO-2::PK-2::1': 3, 'PO-3::PK-3::2': 2 },
    records: [{ __key: 'PO-1::PK-1::0', 'Order No': 'PO-1', 'Product Details': 'Successful product', 'Qty (No)': 1 }],
    errors: [
      { key: 'PO-2::PK-2::1', index: 1, orderNo: 'PO-2', packageId: 'PK-2', attempts: 3, message: 'Temu opened a no-auth page.' },
      { key: 'PO-3::PK-3::2', index: 2, orderNo: 'PO-3', packageId: 'PK-3', attempts: 2, message: 'Timed out waiting for order-detail data.' },
      { key: 'PO-3::PK-3::2', index: 2, orderNo: 'PO-3', packageId: 'PK-3', attempts: 2, message: 'Duplicate warning.' }
    ]
  }
};
const listeners = { message: null, updated: null, removed: null, startup: null };
const tabs = new Map();
let nextTabId = 200;
const chrome = {
  storage: { local: { async get(key) { return { [key]: storage[key] }; }, async set(value) { Object.assign(storage, value); } } },
  tabs: {
    onUpdated: { addListener(fn) { listeners.updated = fn; } },
    onRemoved: { addListener(fn) { listeners.removed = fn; } },
    async query() { return [...tabs.values()]; },
    async create(info) { const id = nextTabId++; const tab = { ...info, id }; tabs.set(id, tab); return tab; },
    async update(id, info) { const tab = tabs.get(id); if (tab) Object.assign(tab, info); return tab; },
    async remove(id) { tabs.delete(id); if (listeners.removed) await listeners.removed(id); },
    async sendMessage() { return {}; }
  },
  runtime: {
    lastError: undefined,
    sendMessage(_message, callback) { if (callback) callback({}); },
    onMessage: { addListener(fn) { listeners.message = fn; } },
    onStartup: { addListener(fn) { listeners.startup = fn; } }
  }
};
const context = { chrome, URL, URLSearchParams, Map, Set, Date, Math, JSON, String, Number, Boolean, Promise, Error, console, setTimeout, clearTimeout };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'worker.js'), 'utf8'), context, { filename: 'worker.js' });

function send(message, sender = {}) { return new Promise(resolve => listeners.message(message, sender, resolve)); }
function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function assert(condition, message = 'assertion failed') { if (!condition) throw new Error(message); }

(async () => {
  const response = await send({ type: 'TEMU_RETRY_FAILED' }, { tab: { id: 9 } });
  assert(response.ok, 'retry message was not acknowledged');
  let state = (await send({ type: 'TEMU_GET_STATE' })).state;
  assert(state.status === 'running', `expected running retry state, got ${state.status}`);
  assert(state.errors.length === 0, 'old errors were not cleared');
  assert(state.records.length === 1 && state.records[0].__key === 'PO-1::PK-1::0', 'successful records were not preserved');
  assert(response.state.retryQueue.length === 2, 'failed rows were not requeued in the returned checkpoint');
  assert(state.attempts['PO-2::PK-2::1'] === undefined && state.attempts['PO-3::PK-3::2'] === undefined, 'retry attempt budget was not reset');
  await wait(100);
  state = (await send({ type: 'TEMU_GET_STATE' })).state;
  assert(state.inFlight.length === 2, `retry exceeded two-tab limit or did not launch: ${state.inFlight.length}`);
  assert(state.nextIndex === 3, `retry changed nextIndex unexpectedly: ${state.nextIndex}`);
  assert([...tabs.values()].every(tab => tab.url.includes('_x_sessn_id=retry-session')), 'retry session identifier missing');
  console.log('worker retry-failed-only test: PASS');
  process.exit(0);
})().catch(error => { console.error(error); process.exit(1); });
