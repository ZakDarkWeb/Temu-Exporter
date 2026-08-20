const fs = require('fs');
const path = require('path');
const root = '/home/ubuntu/Temu-Exporter-v8.9.0';
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
if (manifest.version !== '8.9.0') throw new Error(`wrong version: ${manifest.version}`);
for (const file of ['background.js', 'content.js', 'popup.html', 'popup.js', 'README.md', 'libs/xlsx-js-style.js', 'icons/icon16.png', 'icons/icon32.png', 'icons/icon48.png', 'icons/icon128.png']) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`missing packaged file: ${file}`);
}
for (const file of ['background.js', 'popup.js', 'content.js']) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  if (file === 'background.js' && !text.includes('Est. total shipping cost')) throw new Error('shipping-cost fix missing');
  if (file === 'popup.js' && !text.includes('exportSelectedLabelSheets')) throw new Error('primary Sheets route missing');
  if (file === 'popup.js' && !text.includes('copyFallback')) throw new Error('clipboard fallback missing');
  if (file === 'background.js' && !text.includes('temuSelectedOrders_v2')) throw new Error('persistent selection missing');
  if (file === 'content.js' && !text.includes('btnRefreshShipped')) throw new Error('in-page workflow card missing');
  if (file === 'content.js' && !text.includes('selectedLabelRowsReady')) throw new Error('in-page Sheets result missing');
  if (file === 'content.js' && !text.includes("const source = mode === 'shipped' ? 'shipped' : 'unshipped'")) throw new Error('Shipped selection merge missing');
  if (file === 'content.js' && !text.includes('overflow: hidden; overflow-y: hidden')) throw new Error('minimized-card clipping missing');
}
const html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
for (const ident of ['selectedCount','matchedCount','pendingCount','refreshBtn','exportBtn','clearBtn','processLabel','processCount','processBar','tsvText','copyBtn']) {
  if (!html.includes(`id="${ident}"`)) throw new Error(`primary popup element missing: ${ident}`);
}
for (const legacy of ['Export Today', 'Sheets Sync Today', 'tabPages', 'tabDate', 'tabHistory', 'tabContentPages', 'tabContentDate', 'tabContentHistory']) {
  if (html.includes(legacy)) throw new Error(`legacy popup feature still present: ${legacy}`);
}
if (!html.includes('v8.9.0')) throw new Error('version label missing');
console.log('packaged extension verification passed:', manifest.version);
