const fs = require('fs');
const assert = require('assert');

const content = fs.readFileSync('/home/ubuntu/Temu-Exporter/content.js', 'utf8');
const popup = fs.readFileSync('/home/ubuntu/Temu-Exporter/popup.html', 'utf8');

assert(content.includes('id="btnExportSelected">Export Sheet</button>'), 'minimal Export Sheet button missing');
assert(content.includes('id="btnRefreshShipped"'), 'Refresh Shipped button missing');
assert(content.includes('id="btnClearSelection"'), 'clear-selection button missing');
assert(content.includes('id="btnCancel"'), 'extraction cancel control missing');
assert(content.includes("id === 'btnExportSelected'"), 'Export Sheet event route missing');
assert(content.includes("id === 'btnRefreshShipped'"), 'Refresh Shipped event route missing');
assert(content.includes('id="btnCopySelected">Copy to Clipboard</button>'), 'single clipboard action missing');
assert(!content.includes('>⚡ Export Today</button>'), 'Export Today card button still exposed');
assert(!content.includes('>📊 Sheets Sync Today</button>'), 'Sheets Sync Today card button still exposed');
assert(!content.includes("id === 'btnExport'"), 'legacy Export Today event route still active');
assert(!content.includes("id === 'btnSheets'"), 'legacy Sheets Sync event route still active');
assert(!content.includes('btnDownloadSelectedXlsx') && !content.includes('btnDownloadSelectedCsv'), 'in-page download controls still present');
assert(!popup.includes('Pages') && !popup.includes('History') && !popup.includes('Settings'), 'legacy popup sections remain');
console.log('minimal primary card UI regression test passed');
