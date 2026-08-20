const fs = require('fs');
const assert = require('assert');

const html = fs.readFileSync('/home/ubuntu/Temu-Exporter/popup.html', 'utf8');
const popup = fs.readFileSync('/home/ubuntu/Temu-Exporter/popup.js', 'utf8');
const content = fs.readFileSync('/home/ubuntu/Temu-Exporter/content.js', 'utf8');
const background = fs.readFileSync('/home/ubuntu/Temu-Exporter/background.js', 'utf8');

for (const legacy of ['id="tabSheets"', 'id="tabContentSheets"', 'id="visSheets"', 'Auto Sheets Sync', 'Sync Today\'s Labels']) {
  assert(!html.includes(legacy), `Sheets tab UI still present: ${legacy}`);
}
for (const legacy of ['tabContentSheets', 'switchTab(\'sheets\')', 'sheetsSyncToday', 'sheetsSyncYesterday', 'sheetsSyncLast7', 'sheetsSyncCustomBtn']) {
  assert(!popup.includes(legacy), `obsolete Sheets popup route still present: ${legacy}`);
}
assert(content.includes("if (active === '3' || active === '4') return 'shipped';"), 'current Temu activeTab=4 Shipped detection missing');
assert(background.includes('const previousFirstOrder = pageData.items[0]?.orderNumber || \'\';'), 'scan does not preserve previous page marker');
assert(background.includes('const previousMarker = markerMatch ? markerMatch[0] : markerText;'), 'page-change wait does not use previous marker');
assert(background.includes('return ids[0] || \'\';'), 'page-change wait does not compare first Order No');
assert(background.includes('document.querySelector(\'[data-testid="beast-core-pagination-next"]\')'), 'primary Temu pagination selector missing');
assert(background.includes('document.querySelector(\'li.PGT_next_123\')'), 'PGT pagination fallback missing');
console.log('Sheets-tab removal and Shipped scan regression test passed');
