const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync('/home/ubuntu/Temu-Exporter/background.js', 'utf8');
assert(source.includes("/^Est\\.\\s*total\\s*shipping\\s*cost$/i"), 'exact Est. total shipping cost selector missing');
assert(source.includes('shipping cost` value'), 'guard comment for the lower-case shipping cost field missing');
assert(!source.includes("bodyText.match(/Est\\.?\\s*total\\s*shipping\\s*cost[^\\n]*\\n?[^\\n$]*\\$([\\d.,]+)/i)"), 'old broad shipping-cost fallback still present');

const context = {
  console,
  URL,
  URLSearchParams,
  btoa: value => Buffer.from(value, 'binary').toString('base64'),
  unescape,
  encodeURIComponent,
  importScripts() {},
  chrome: {
    runtime: { onMessage: { addListener() {} }, sendMessage: async () => {} },
    storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} }, session: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
    tabs: { query: async () => [], create: async () => ({ id: 1 }), get: async () => ({}), remove: async () => {} },
    scripting: { executeScript: async () => [{ result: null }] },
    downloads: { download: async () => 1 },
    action: { setBadgeText: async () => {} },
    notifications: { create: async () => {} }
  }
};
vm.createContext(context);
vm.runInContext(source, context, { filename: 'background.js' });

const rows = context.flattenToRows([{
  orderNumber: 'PO-211-20751913462391205',
  recipientName: 'Len Teague',
  purchaseDate: 'Aug 18, 2026',
  shippingCost: '5.74',
  estimatedRevenue: '17.64',
  basePrice: '14.65',
  courier: 'UPS Ground saver',
  packages: [{ packageId: 'PK-1122390514729733074', trackingNumber: '1Z16E50BYW71336687', shipmentDate: 'Aug 19, 2026' }],
  products: [{ title: 'TaylorMade Golf Special Speed Soft Blue Ink Golf Balls', variant: 'Young', qty: '1' }]
}]);
assert.strictEqual(rows.length, 1, 'expected one flattened row');
assert.strictEqual(rows[0].shippingCost, '5.74', 'sheet row did not preserve Est. total shipping cost');
assert.notStrictEqual(rows[0].shippingCost, '2.99', 'sheet row used the sales-proceeds shipping cost');
assert.strictEqual(rows[0].trackingNumber, '1Z16E50BYW71336687', 'tracking number changed unexpectedly');
assert.strictEqual(rows[0].packageId, 'PK-1122390514729733074', 'package ID was not preserved');
console.log('shipping-cost source and flattening regression tests passed');
