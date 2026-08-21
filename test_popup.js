const fs = require('fs');
const path = require('path');

const root = __dirname;
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'popup.css'), 'utf8');
const js = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'worker.js'), 'utf8');
const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');

function assert(condition, message) { if (!condition) throw new Error(message); }

assert(manifest.version === '3.0.0', 'manifest version is not 3.0.0');
assert(manifest.action.default_popup === 'popup.html', 'popup is not registered in the manifest');
for (const marker of ['status-card', 'progress-fill', 'progressbar', 'data-metric="warnings"', 'data-role="action-feedback"', 'data-command="primary"', 'data-command="retry"', 'data-role="history-list"', 'data-stage="capture"']) assert(html.includes(marker), `popup markup missing ${marker}`);
for (const marker of ['TEMU_RETRY_FAILED', 'TEMU_RESUME_JOB', 'TEMU_POPUP_START', 'TEMU_OPEN_HISTORY', 'TemuXlsx.downloadWorkbook', 'HISTORY_KEY', 'actionBusy', 'runCommand', 'showActionFeedback']) assert(js.includes(marker), `popup behavior missing ${marker}`);
for (const marker of ['.to-popup-pipeline', '@keyframes zhCardEnter', 'prefers-reduced-motion', ':focus-visible']) assert(css.includes(marker), `popup style missing ${marker}`);
assert(worker.includes('TEMU_RETRY_FAILED') && worker.includes('failedRetryItems') && worker.includes('WAKE_ALARM') && worker.includes('commitState'), 'worker reliability contract missing');
assert(content.includes('TEMU_POPUP_START') && content.includes('TEMU_OPEN_HISTORY') && content.includes('drawerFocusables') && content.includes('handleDrawerKeydown'), 'content popup/drawer bridge missing');
assert(!/fetch\(|XMLHttpRequest|navigator\.sendBeacon/.test(`${js}\n${css}`), 'popup introduced network-upload code');
console.log('popup command-center test: PASS');
