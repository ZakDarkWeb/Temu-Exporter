const assert = require('assert');
const fs = require('fs');

const popup = fs.readFileSync('/home/ubuntu/Temu-Exporter/popup.html', 'utf8');
const popupJs = fs.readFileSync('/home/ubuntu/Temu-Exporter/popup.js', 'utf8');
const content = fs.readFileSync('/home/ubuntu/Temu-Exporter/content.js', 'utf8');
const manifest = JSON.parse(fs.readFileSync('/home/ubuntu/Temu-Exporter/manifest.json', 'utf8'));

assert.strictEqual(manifest.version, '8.8.7', 'minimal release version must be 8.8.7');
for (const id of ['selCount', 'clearSelBtn', 'debugDetectBtn', 'selDebugBox', 'selDebugPre']) {
  assert(popup.includes(`id="${id}"`), `minimal popup control missing: ${id}`);
}
for (const legacy of ['tabPages', 'tabDate', 'tabHistory', 'tabSettings', 'autoBtn', 'manualBtn', 'saveForLabelBtn', 'copySelectedSheetsBtn', 'restoreSelBtn', 'histList', 'autoFormat', 'Download XLSX', 'Download CSV']) {
  assert(!popup.includes(legacy), `legacy popup control remains: ${legacy}`);
}
for (const legacy of ['exportLabelBatch', 'Label Batch Export', 'btnDownloadSelectedXlsx', 'btnDownloadSelectedCsv', 'Download XLSX', 'Download CSV']) {
  assert(!content.includes(legacy), `legacy in-page feature remains: ${legacy}`);
}
assert(content.includes('id="btnRefreshShipped"'), 'Refresh Shipped control missing');
assert(content.includes('id="btnExportSelected"'), 'Export control missing');
assert(content.includes('id="btnCopySelected"'), 'clipboard control missing');
assert(content.includes('Copy to Clipboard'), 'clipboard label must be singular and clear');
assert(content.includes("type: 'refreshSelectedShipped'"), 'Refresh Shipped route missing');
assert(content.includes("type: 'exportSelectedLabelSheets'"), 'selected export route missing');
for (const legacy of ['startAutoExport', 'startDateExport', 'startSheetsSync', 'startSelectionExport', 'startSelectionSheetsSync', 'exportLabelBatch', 'startStatusCheck', 'quickExport', 'quickSheetsSync']) {
  const background = fs.readFileSync('/home/ubuntu/Temu-Exporter/background.js', 'utf8');
  assert(!background.includes(`msg.type === '${legacy}'`), `legacy background route remains: ${legacy}`);
}
console.log('minimal popup/card/background UI regression test passed');
