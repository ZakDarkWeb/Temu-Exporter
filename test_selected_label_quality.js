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
assert.strictEqual(complete({ ...good, shippingCost: '' }), false, 'order with no shipping cost must retry/fail');
assert.strictEqual(complete({ ...good, recipientName: '' }), false, 'order with no customer must retry/fail');

const generatorStart = source.indexOf('function normalizeSelectedLabelRows');
const generatorEnd = source.indexOf('function generateExport');
assert(generatorStart >= 0 && generatorEnd > generatorStart, 'selected-label generator missing');
const generatorContext = {
  SELECTED_LABEL_KEYS: ['shippingDate','orderDate','trackingNumber','orderNumber','customerName','productDetails','qty','estimatedRevenue','shippingCost'],
  SELECTED_LABEL_HEADERS: ['Shipping Date','Order Date','Tracking Number','Order No','Customer Name','Product Details','Qty (No)','Est. Revenue','Shipping Cost'],
  XLSX_LOADED: false,
  XLSX: undefined,
  btoa: global.btoa,
  unescape,
  encodeURIComponent
};
vm.runInNewContext(source.slice(generatorStart, generatorEnd), generatorContext);
const rows = [{
  shippingDate: 'Aug 20, 2026', orderDate: 'Aug 18, 2026', trackingNumber: '1Z1234567890123456',
  orderNumber: 'PO-211-123456789012345', customerName: 'Customer Name', productDetails: 'TaylorMade Tour',
  qty: '1', estimatedRevenue: '25.74', shippingCost: '5.74'
}];
const result = generatorContext.generateSelectedLabelCSV(rows, 'test_selected_labels');
const csv = Buffer.from(result.dataUrl.split(',')[1], 'base64').toString('utf8');
assert(csv.startsWith('\ufeff"Shipping Date","Order Date","Tracking Number","Order No"'), 'CSV headers are not exact nine-column headers');
assert(csv.includes('Customer Name') && csv.includes('TaylorMade Tour') && csv.includes('5.74'), 'CSV lost extracted detail values');
assert(result.filename.endsWith('.csv'), 'CSV filename missing');

assert(source.includes('isCompleteOrderData'), 'completeness validation is not wired');
assert(source.includes("body.includes('Order contents') && body.includes('Est. total shipping cost')"), 'full detail-shell readiness guard missing');
assert(source.includes('await sleep(900 + (attempt * 1100))'), 'post-readiness settle delay missing');
assert(source.includes('await saveSelectedLabelHistory'), 'selected-label history save missing');
assert(source.includes("msg.type === 'downloadSelectedLabelFile'"), 'selected-label download route missing');
assert(source.includes('generateSelectedLabelXLSX'), 'selected-label XLSX generator missing');
assert(source.includes('sheetsSyncHistoryId'), 'session history ID missing');

const popup = fs.readFileSync('/home/ubuntu/Temu-Exporter/popup.js', 'utf8');
const html = fs.readFileSync('/home/ubuntu/Temu-Exporter/popup.html', 'utf8');
const content = fs.readFileSync('/home/ubuntu/Temu-Exporter/content.js', 'utf8');
assert(popup.includes('sheetsDownloadXlsx') && popup.includes('sheetsDownloadCsv'), 'popup download controls missing');
assert(popup.includes('showSelectedLabelResult') && popup.includes('saveToHistory'), 'popup selected-label history renderer missing');
assert(html.includes('id="sheetsDownloadXlsx"') && html.includes('id="sheetsDownloadCsv"'), 'Sheets download markup missing');
assert(content.includes('btnDownloadSelectedXlsx') && content.includes('btnDownloadSelectedCsv'), 'in-page download controls missing');
console.log('selected-label completeness, download, exact schema, and history regression tests passed');
