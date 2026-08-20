const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync('/home/ubuntu/Temu-Exporter/background.js', 'utf8');

const completenessStart = source.indexOf('function isCompleteOrderData');
const completenessEnd = source.indexOf('async function processTabWithRetry');
assert(completenessStart >= 0 && completenessEnd > completenessStart, 'completeness validator missing');
const completenessContext = {};
vm.runInNewContext(source.slice(completenessStart, completenessEnd), completenessContext);
const complete = completenessContext.isCompleteOrderData;

const good = {
  orderNumber: 'PO-211-123456789012345',
  recipientName: 'Customer Name',
  purchaseDate: 'Aug 18, 2026',
  shippingCost: '5.74',
  products: [{ title: 'TaylorMade Tour', qty: '1' }],
  packages: [{ packageId: 'PK-123456789', trackingNumber: '1Z1234567890123456' }]
};
assert.strictEqual(complete(good), true, 'complete order should pass validation');
assert.strictEqual(complete({ ...good, products: [] }), false, 'order with no product details must retry/fail');
assert.strictEqual(complete({ ...good, shippingCost: '' }), false, 'order with no Est. total shipping cost must retry/fail');
assert.strictEqual(complete({ ...good, recipientName: '' }), false, 'order with no customer must retry/fail');

const expectedHeaders = ['Shipping Date','Order Date','Tracking Number','Order No','Customer Name','Product Details','Qty (No)','Est. Revenue','Shipping Cost'];
assert(source.includes(`const SELECTED_LABEL_HEADERS = [\n  '${expectedHeaders.slice(0, 4).join("', '")}'`), 'selected-label header constant missing');
expectedHeaders.forEach(header => assert(source.includes(`'${header}'`), `missing selected-label column: ${header}`));
assert(source.includes('const outputHeaders = selectedLabelMode ? SELECTED_LABEL_HEADERS : EXPORT_HEADERS'), 'selected-label output headers not wired');
assert(source.includes('const exportKeys = selectedLabelMode ? SELECTED_LABEL_KEYS : EXPORT_COLS'), 'selected-label output keys not wired');
assert(source.includes('String.fromCharCode(9)'), 'TSV column separator missing');
assert(source.includes('String.fromCharCode(10)'), 'TSV row separator missing');
assert(source.includes('body.includes(\'Order contents\') && body.includes(\'Est. total shipping cost\')'), 'full detail-shell readiness guard missing');
assert(source.includes('await sleep(900 + (attempt * 1100))'), 'post-readiness settle delay missing');
assert(source.includes("type: 'selectedLabelRowsReady'"), 'selected-label result delivery missing');
assert(!source.includes('saveSelectedLabelHistory'), 'history side effect must be removed');
assert(!source.includes('generateSelectedLabelXLSX'), 'XLSX generator must be removed');
assert(!source.includes('generateSelectedLabelCSV'), 'CSV generator must be removed');

const popup = fs.readFileSync('/home/ubuntu/Temu-Exporter/popup.js', 'utf8');
const html = fs.readFileSync('/home/ubuntu/Temu-Exporter/popup.html', 'utf8');
const content = fs.readFileSync('/home/ubuntu/Temu-Exporter/content.js', 'utf8');
assert(!popup.includes('History') && !popup.includes('startSelectionExport'), 'legacy popup export/history path remains');
assert(!html.includes('Download XLSX') && !html.includes('Download CSV'), 'legacy download markup remains');
assert(content.includes('Copy to Clipboard'), 'single clipboard action is missing');
assert(!content.includes('btnDownloadSelectedXlsx') && !content.includes('btnDownloadSelectedCsv'), 'in-page download controls remain');
console.log('selected-label readiness, exact schema, TSV delivery, and minimal-surface regression test passed');
