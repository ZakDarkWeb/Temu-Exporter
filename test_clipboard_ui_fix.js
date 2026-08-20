const fs = require('fs');
const assert = require('assert');
const popupJs = fs.readFileSync('/home/ubuntu/Temu-Exporter/popup.js', 'utf8');
const popupHtml = fs.readFileSync('/home/ubuntu/Temu-Exporter/popup.html', 'utf8');

assert(popupJs.includes('navigator.clipboard?.writeText'), 'clipboard API path missing');
assert(popupJs.includes("document.execCommand('copy')"), 'manual clipboard fallback missing');
assert(popupJs.includes('copyFallback'), 'clipboard fallback helper missing');
assert(popupJs.includes("send('exportSelectedLabelSheets'"), 'primary Sheets export route missing');
assert(popupJs.includes("send('refreshSelectedShipped'"), 'primary Shipped refresh route missing');
assert(popupJs.includes('Extracting ${total} orders'), 'compact extraction status missing');
for (const legacy of ['startSelectionSheetsSync', 'startDateExport', 'downloadFromHistory', 'Export Today', 'Sheets Sync Today']) {
  assert(!popupJs.includes(legacy), `legacy popup route still present: ${legacy}`);
}
for (const ident of ['tsvText', 'copyBtn', 'processLabel', 'processCount', 'processBar']) {
  assert(popupHtml.includes(`id="${ident}"`), `primary popup element missing: ${ident}`);
}
for (const legacy of ['Export Today', 'Sheets Sync Today', 'tabPages', 'tabDate', 'tabHistory']) {
  assert(!popupHtml.includes(legacy), `legacy popup UI still present: ${legacy}`);
}
assert(popupHtml.includes('v8.9.0'), 'popup release label missing');
console.log('primary clipboard and UI regression checks passed');
