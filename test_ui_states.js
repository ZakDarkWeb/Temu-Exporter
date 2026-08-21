const fs = require('fs');
const path = require('path');

const root = __dirname;
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'worker.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'content.css'), 'utf8');
const tools = fs.readFileSync(path.join(root, 'tools.html'), 'utf8');
const toolsJs = fs.readFileSync(path.join(root, 'tools.js'), 'utf8');

function assert(condition, message) { if (!condition) throw new Error(message); }

assert(manifest.version === '3.1.0', 'manifest version is not 3.1.0');
assert(!('default_popup' in manifest.action), 'popup is still registered');
assert(manifest.action.default_title.includes('Open Temu Exporter panel'), 'action title does not describe the popup-free flow');
for (const marker of ['data-action="tools"', 'History & Tools', 'data-action="start"', 'data-action="download"', 'data-action="retry"', 'data-action="stop"']) assert(content.includes(marker), `compact panel control missing ${marker}`);
assert(content.includes('data-metric="warnings"') === false, 'in-page card should keep diagnostics on the Tools page');
assert(worker.includes('chrome.action.onClicked') && worker.includes('TEMU_OPEN_TOOLS'), 'popup-free action bridge missing');
assert(tools.includes('History &amp; Tools') && tools.includes('data-role="history-list"') && tools.includes('data-role="diagnostics"'), 'dedicated tools page structure missing');
assert(toolsJs.includes('TEMU_GET_STATE') && toolsJs.includes('TEMU_RETRY_FAILED') && toolsJs.includes('downloadWorkbook'), 'tools page behavior missing');
assert(css.includes('max-height: min(760px') && css.includes('overscroll-behavior: contain'), 'compact panel bounds missing');
assert(css.includes('prefers-reduced-motion'), 'reduced-motion fallback missing');
assert(css.includes('animation: none !important'), 'repetitive vibration animation override missing');
console.log('popup-free compact UI state test: PASS');
