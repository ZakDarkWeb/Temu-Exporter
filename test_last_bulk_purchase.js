const fs = require('fs');
const vm = require('vm');

const listeners = [];
const context = {
  console,
  URL,
  URLSearchParams,
  btoa: value => Buffer.from(value, 'binary').toString('base64'),
  unescape,
  encodeURIComponent,
  importScripts() {},
  chrome: {
    runtime: { onMessage: { addListener: fn => listeners.push(fn) }, sendMessage: async () => {} },
    storage: {
      local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
      session: { get: async () => ({}), set: async () => {}, remove: async () => {} }
    },
    tabs: { query: () => {}, create: async () => ({ id: 1 }), get: async () => ({}), remove: async () => {} },
    scripting: { executeScript: async () => [{ result: null }] },
    downloads: { download: async () => {} },
    action: { setBadgeText: async () => {} }
  }
};
vm.createContext(context);
const backgroundSource = fs.readFileSync('background.js', 'utf8');
vm.runInContext(backgroundSource, context, { filename: 'background.js' });

for (const required of [
  "const BULK_HISTORY_KEY = 'temuBulkTaskHistory_v1'",
  'async function archiveActiveBulkRecord',
  'async function exportBulkHistory',
  "status: record.errorCount > 0 ? 'partial' : 'ready'"
]) {
  if (!backgroundSource.includes(required)) throw new Error(`missing task-history regression marker: ${required}`);
}

const rows = context.normalizeBulkSeedRows([
  { orderNumber: 'PO-211-12345678901234567', trackingNumber: '1ZABC', labelDate: 'Aug 19, 2026, 11:54 pm PKT', customerName: 'Buyer', productDetails: 'Ball', qty: '2', shippingCost: '$5.74' },
  { orderNumber: 'invalid', trackingNumber: 'ignored' }
], 'TK-1122384884531891619');

if (rows.length !== 1) throw new Error(`expected one valid row, got ${rows.length}`);
if (rows[0].orderNumber !== 'PO-211-12345678901234567') throw new Error('order number normalization failed');
if (rows[0].taskId !== 'TK-1122384884531891619') throw new Error('task ID was not preserved');
if (rows[0].shippingCost !== '$5.74') throw new Error('shipping cost was changed unexpectedly');

const good = context.isAllowedTemuOrderUrl('https://seller.temu.com/order-detail.html?parent_order_sn=PO-211-12345678901234567');
const badHost = context.isAllowedTemuOrderUrl('https://evil.example/order-detail.html?parent_order_sn=PO-211-12345678901234567');
const badPath = context.isAllowedTemuOrderUrl('https://seller.temu.com/orders.html?parent_order_sn=PO-211-12345678901234567');
const badId = context.isAllowedTemuOrderUrl('https://seller.temu.com/order-detail.html?parent_order_sn=not-an-order');
if (!good || badHost || badPath || badId) throw new Error('Temu order URL allowlist failed');

console.log('last bulk purchase helper tests passed');
