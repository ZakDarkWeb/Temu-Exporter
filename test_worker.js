const fs = require('fs');
const vm = require('vm');
const path = require('path');

const storage = {};
const listeners = { message: null, updated: null, removed: null, startup: null };
const tabs = new Map();
let nextTabId = 100;
const chrome = {
  storage: { local: {
    async get(key) { return { [key]: storage[key] }; },
    async set(value) { Object.assign(storage, value); }
  } },
  tabs: {
    onUpdated: { addListener(fn) { listeners.updated = fn; } },
    onRemoved: { addListener(fn) { listeners.removed = fn; } },
    async create(info) { const id = nextTabId++; tabs.set(id, { ...info, id }); return { ...info, id }; },
    async update(id, info) { const tab = tabs.get(id); if (tab) Object.assign(tab, info); return tab; },
    async remove(id) { tabs.delete(id); if (listeners.removed) await listeners.removed(id); },
    async query() { return [...tabs.values()]; },
    async sendMessage() { return {}; }
  },
  runtime: {
    lastError: undefined,
    onMessage: { addListener(fn) { listeners.message = fn; } },
    onStartup: { addListener(fn) { listeners.startup = fn; } }
  }
};

const context = { chrome, URL, URLSearchParams, Map, Set, Date, Math, JSON, String, Number, Boolean, Promise, Error, console, setTimeout, clearTimeout };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'worker.js'), 'utf8'), context, { filename: 'worker.js' });

function send(message, sender = {}) {
  return new Promise(resolve => listeners.message(message, sender, resolve));
}
function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

(async () => {
  const rows = [
    { orderNo: 'PO-1', packageId: 'PK-1' },
    { orderNo: 'PO-2', packageId: 'PK-2' },
    { orderNo: 'PO-3', packageId: 'PK-3' },
    { orderNo: 'PO-4', packageId: 'PK-4' },
    { orderNo: 'PO-5', packageId: 'PK-5' },
    { orderNo: 'PO-6', packageId: 'PK-6' }
  ];
  const start = await send({ type: 'TEMU_START_JOB', sourceUrl: 'https://seller.temu.com/buy-shipping-bulk-details.html?x=1&_x_sessn_id=n7gql3bxn0', rows }, { tab: { id: 9 } });
  assert(start.ok);
  await wait(80);
  let state = (await send({ type: 'TEMU_GET_STATE' })).state;
  assert(state.status === 'running');
  assert(state.inFlight.length === 2, `expected two in-flight tabs, got ${state.inFlight.length}`);
  assert(state.nextIndex === 2, `expected nextIndex 2, got ${state.nextIndex}`);
  assert(new Set(state.inFlight.map(item => item.key)).size === 2, 'duplicate in-flight keys detected');
  assert(tabs.size === 2, `expected two background tabs, got ${tabs.size}`);
  for (const tab of tabs.values()) assert(tab.url.includes('_x_sessn_id=n7gql3bxn0'), 'session identifier missing from detail URL');

  const firstTab = [...tabs.keys()][0];
  await listeners.updated(firstTab, { status: 'complete' }, { id: firstTab, url: 'https://seller.temu.com/no-auth.html' });
  state = (await send({ type: 'TEMU_GET_STATE' })).state;
  assert(state.retryQueue.length === 1, `expected retry queue length 1, got ${state.retryQueue.length}`);
  assert(state.attempts['PO-1::PK-1::0'] === 1);
  assert(!state.inFlight.some(item => item.key === 'PO-1::PK-1::0'), 'failed order remained in-flight');

  const remainingTab = [...tabs.keys()][0];
  vm.runInContext('activeTabs.clear()', context);
  await send({ type: 'TEMU_DETAIL_RESULT', record: {
    'Shipping Date': 'Aug 20, 2026', 'Order Date': 'Aug 19, 2026', 'Tracking Number': '1ZTEST',
    'Order No': 'PO-2', 'Customer Name': 'Test Customer', 'Product Details': 'Test Product',
    'Qty (No)': 1, 'Est. Revenue': '$10.00', 'Shipping Cost': '$3.00'
  } }, { tab: { id: remainingTab } });
  state = (await send({ type: 'TEMU_GET_STATE' })).state;
  assert(state.records.length === 1, `expected one completed record, got ${state.records.length}`);
  assert(state.errors.length === 0, `successful close created false errors: ${state.errors.length}`);
  assert(state.inFlight.length <= 2, `concurrency limit exceeded after success: ${state.inFlight.length}`);

  await send({ type: 'TEMU_STOP_JOB' });
  state = (await send({ type: 'TEMU_GET_STATE' })).state;
  assert(state.status === 'idle' && state.records.length === 0 && state.retryQueue.length === 0 && tabs.size === 0, `stop did not clear tabs: ${JSON.stringify([...tabs.keys()])}`);
  console.log('worker retry/concurrency test: PASS');
  process.exit(0);
})().catch(error => { console.error(error); process.exit(1); });

function assert(condition, message = 'assertion failed') {
  if (!condition) throw new Error(message);
}
