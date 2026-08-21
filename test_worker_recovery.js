const fs = require('fs');
const vm = require('vm');
const path = require('path');

const STATE_KEY = 'temuOrderExporterStateV7';
const storage = {
  [STATE_KEY]: {
    version: 7,
    runId: 77,
    status: 'running',
    sourceUrl: 'https://seller.temu.com/buy-shipping-bulk-details.html?_x_sessn_id=live',
    sourceTabId: 9,
    rows: [{ orderNo: 'PO-KEEP', packageId: 'PK-KEEP' }],
    nextIndex: 1,
    retryQueue: [],
    inFlight: [{ key: 'PO-KEEP::PK-KEEP::0', index: 0, row: { orderNo: 'PO-KEEP', packageId: 'PK-KEEP' }, attempt: 1, tabId: 100 }],
    attempts: { 'PO-KEEP::PK-KEEP::0': 1 },
    records: [],
    errors: []
  }
};
const listeners = { removed: null, message: null, updated: null, startup: null };
const tabs = new Map([
  [100, { id: 100, url: 'https://seller.temu.com/order-detail.html?parent_order_sn=PO-KEEP#temu-exporter=keep' }],
  [101, { id: 101, url: 'https://seller.temu.com/order-detail.html?parent_order_sn=PO-ORPHAN#temu-exporter=orphan' }],
  [102, { id: 102, url: 'https://seller.temu.com/order-detail.html?parent_order_sn=PO-LEGACY&refer_page_name=buy-shipping-bulk-details&refer_page_id=old-exporter' }]
]);
const chrome = {
  storage: { local: {
    async get(key) { return { [key]: storage[key] }; },
    async set(value) { Object.assign(storage, value); }
  } },
  tabs: {
    onUpdated: { addListener(fn) { listeners.updated = fn; } },
    onRemoved: { addListener(fn) { listeners.removed = fn; } },
    async query(info) { return [...tabs.values()].filter(tab => !info?.url || info.url.some(pattern => pattern.includes('order-detail.html') && tab.url.includes('/order-detail.html'))); },
    async remove(id) { tabs.delete(id); if (listeners.removed) await listeners.removed(id); },
    async sendMessage() { return {}; },
    async create(info) { const id = 200; tabs.set(id, { ...info, id }); return { ...info, id }; }
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

setTimeout(() => {
  try {
    assert(tabs.has(100), 'persisted in-flight tab was closed');
    assert(!tabs.has(101), 'orphan detail tab was not closed');
    assert(!tabs.has(102), 'legacy orphan detail tab was not closed');
    console.log('worker orphan-tab recovery test: PASS');
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}, 100);

function assert(condition, message = 'assertion failed') {
  if (!condition) throw new Error(message);
}
