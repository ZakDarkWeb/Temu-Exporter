const fs = require('fs');
const vm = require('vm');
const path = require('path');

const STATE_KEY = 'temuOrderExporterStateV7';
const now = Date.now();
const storage = {
  [STATE_KEY]: {
    version: 8,
    runId: 88,
    status: 'running',
    sourceUrl: 'https://seller.temu.com/buy-shipping-bulk-details.html?_x_sessn_id=live',
    rows: [{ orderNo: 'PO-ALARM', packageId: 'PK-ALARM' }],
    nextIndex: 1,
    retryQueue: [{ key: 'PO-ALARM::PK-ALARM::0', index: 0, row: { orderNo: 'PO-ALARM', packageId: 'PK-ALARM' }, readyAt: now + 2000 }],
    inFlight: [], attempts: {}, records: [], errors: []
  }
};
const listeners = { message: null, removed: null, updated: null, startup: null, alarm: null };
const alarms = new Map();
const chrome = {
  storage: { local: { async get(key) { return { [key]: storage[key] }; }, async set(value) { Object.assign(storage, value); } } },
  alarms: {
    onAlarm: { addListener(fn) { listeners.alarm = fn; } },
    async create(name, info) { alarms.set(name, info); },
    async clear(name) { alarms.delete(name); return true; }
  },
  tabs: {
    onUpdated: { addListener(fn) { listeners.updated = fn; } },
    onRemoved: { addListener(fn) { listeners.removed = fn; } },
    async query() { return []; },
    async sendMessage() { return {}; },
    async create(info) { return { id: 201, ...info }; },
    async update() { return {}; },
    async remove() {}
  },
  runtime: {
    lastError: undefined,
    sendMessage(_message, callback) { if (callback) callback(); },
    onMessage: { addListener(fn) { listeners.message = fn; } },
    onStartup: { addListener(fn) { listeners.startup = fn; } }
  }
};
const context = { chrome, URL, URLSearchParams, Map, Set, Date, Math, JSON, String, Number, Boolean, Promise, Error, console, setTimeout, clearTimeout };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'worker.js'), 'utf8'), context, { filename: 'worker.js' });

setTimeout(() => {
  try {
    assert(alarms.has('temu-order-exporter-wake'), 'wake alarm was not scheduled');
    assert(Number.isFinite(alarms.get('temu-order-exporter-wake').when), 'wake alarm has no timestamp');
    console.log('worker alarm scheduling test: PASS');
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}, 100);

function assert(condition, message = 'assertion failed') {
  if (!condition) throw new Error(message);
}
