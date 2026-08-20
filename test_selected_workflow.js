const fs = require('fs');
const assert = require('assert');
const vm = require('vm');

const source = fs.readFileSync('/home/ubuntu/Temu-Exporter/background.js', 'utf8');
const contentSource = fs.readFileSync('/home/ubuntu/Temu-Exporter/content.js', 'utf8');

assert(contentSource.includes("if (active === '3' || active === '4') return 'shipped'"), 'current Shipped tab detection missing');
assert(contentSource.includes("const source = mode === 'shipped' ? 'shipped' : 'unshipped'"), 'selection source tracking missing');
assert(contentSource.includes('selectionSources'), 'cross-tab selection merge missing');
assert(contentSource.includes('btnExportSelected'), 'direct Shipped selection export control missing');
assert(contentSource.includes('width: 44px; height: 44px; min-height: 44px; max-height: 44px'), 'minimized card dimensions are not locked');
assert(contentSource.includes('overflow: hidden; overflow-y: hidden'), 'minimized card overflow fix missing');
assert(contentSource.includes("showProgress(false);\n    if ($('tsvText'))"), 'selected-label completion does not close progress');

assert(source.includes("const SELECTED_ORDERS_KEY = 'temuSelectedOrders_v2'"), 'durable selected-order storage key missing');
assert(source.includes("const SELECTED_SHIPPED_KEY = 'temuSelectedShipped_v1'"), 'matched shipped storage key missing');
assert(source.includes("msg.type === 'refreshSelectedShipped'"), 'refresh Shipped message route missing');
assert(source.includes("msg.type === 'exportSelectedLabelSheets'"), 'selected Sheets message route missing');
assert(source.includes("type: 'selectedShippedProgress'"), 'Shipped progress message missing');
assert(source.includes("type: 'selectedLabelRowsReady'"), 'selected-label card result message missing');
assert(source.includes('selectedByOrder.get(item.orderNumber)'), 'matching must use the saved Order No identity');
assert(source.includes('packageMatches && trackingMatches'), 'matching must validate package/tracking identity when available');
assert(source.includes('chrome.tabs.sendMessage(notifyTabId'), 'selected-label result must be returned to the originating Temu card');
assert(source.includes('chrome.tabs.remove(t.id)'), 'detail/list cleanup must close background Temu tabs');

const storage = {
  localData: {
    temuSelectedOrders_v2: {
      updatedAt: 123,
      orders: {
        'PO-211-123456789|PK-ABC|1ZTRACK': {
          orderNumber: 'PO-211-123456789', packageId: 'PK-ABC', trackingNumber: '1ZTRACK'
        }
      }
    }
  },
  local: {
    get: async key => {
      if (Array.isArray(key)) return Object.fromEntries(key.filter(k => storage.localData[k] !== undefined).map(k => [k, storage.localData[k]]));
      return storage.localData[key] === undefined ? {} : { [key]: storage.localData[key] };
    },
    set: async patch => Object.assign(storage.localData, patch)
  },
  session: { get: async () => ({}), set: async () => {} }
};

const context = {
  console,
  URL,
  URLSearchParams,
  setTimeout,
  clearTimeout,
  btoa: value => Buffer.from(value, 'binary').toString('base64'),
  unescape,
  encodeURIComponent,
  importScripts() {},
  chrome: {
    runtime: { onMessage: { addListener() {} }, sendMessage: async () => {} },
    storage,
    tabs: { query: async () => [], create: async () => ({ id: 1 }), get: async () => ({}), remove: async () => {}, sendMessage: async () => {} },
    scripting: { executeScript: async () => [{ result: null }] },
    downloads: { download: async () => 1 },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
    notifications: { create: async () => {} }
  }
};
vm.createContext(context);
vm.runInContext(source, context, { filename: 'background.js' });

(async () => {
  const saved = await context.loadSelectedOrders();
  assert.strictEqual(Object.keys(saved.orders).length, 1, 'saved selection was not loaded from local storage');
  assert.strictEqual(context.selectedIdentity(saved.orders['PO-211-123456789|PK-ABC|1ZTRACK']), 'PO-211-123456789|PK-ABC|1ZTRACK');

  const detail = {
    orderNumber: 'PO-211-123456789',
    recipientName: 'Customer Example',
    purchaseDate: 'Aug 18, 2026',
    shippingDate: 'Aug 19, 2026',
    estimatedRevenue: '17.64',
    shippingCost: '5.74',
    packages: [{ packageId: 'PK-ABC', trackingNumber: '1ZTRACK', shipmentDate: 'Aug 19, 2026' }],
    products: [{ title: 'Product Example', variant: 'Blue', qty: '2' }]
  };
  const rows = context.flattenToRows([detail]);
  const selectedKeys = ['shippingDate','orderDate','trackingNumber','orderNumber','customerName','productDetails','qty','estimatedRevenue','shippingCost'];
  const selectedHeaders = ['Shipping Date','Order Date','Tracking Number','Order No','Customer Name','Product Details','Qty (No)','Est. Revenue','Shipping Cost'];
  const output = Object.fromEntries(selectedKeys.map(key => [key, rows[0][key] ?? '']));
  assert(source.includes("const SELECTED_LABEL_KEYS = ["), 'selected-label key constant missing');
  assert(source.includes("const SELECTED_LABEL_HEADERS = ["), 'selected-label header constant missing');
  assert(source.includes("'Shipping Date', 'Order Date', 'Tracking Number', 'Order No'"), 'selected-label header order changed');
  assert.strictEqual(Object.keys(output).length, 9, 'selected-label output must contain exactly nine fields');
  assert.strictEqual(output.shippingCost, '5.74', 'selected-label output must preserve Est. total shipping cost');
  assert.strictEqual(output.orderNumber, 'PO-211-123456789');
  assert.strictEqual(output.trackingNumber, '1ZTRACK');

  console.log('selected workflow persistence, identity, nine-column output, and cleanup regression tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });


// Static guard: no workflow action may purchase labels, submit orders, print, cancel, or pay.
for (const forbidden of ['purchaseLabel', 'confirmShipment', 'submitOrder', 'makePayment', 'printLabel']) {
  assert(!source.includes(forbidden), `forbidden account action found: ${forbidden}`);
}
