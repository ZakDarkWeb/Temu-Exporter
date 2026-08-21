const fs = require('fs');
const path = require('path');

const root = __dirname;
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'content.css'), 'utf8');
const preview = fs.readFileSync(path.join(root, 'ui_preview.html'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(manifest.version === '2.9.0', 'manifest version is not 2.9.0');
assert(content.includes('data-action="settings"') && content.includes('data-action="history"'), 'drawer controls missing');
assert(content.includes('aria-expanded="false"') && content.includes('aria-hidden="true"'), 'drawer accessibility state missing');
assert(content.includes('setAttribute(\'aria-expanded\', \'true\')'), 'drawer open state is not exposed');
assert(css.includes('contain: layout paint'), 'panel containment missing');
assert(css.includes('@keyframes zhPanelIn'), 'panel enter animation missing');
assert(css.includes('@keyframes zhDrawerEnter') && css.includes('.temu-exporter-drawer-close'), 'drawer animation/close style missing');
assert(css.includes(':active'), 'active button interaction missing');
assert(css.includes(':focus-visible'), 'keyboard focus state missing');
assert(css.includes('@media (prefers-reduced-motion: reduce)'), 'reduced-motion fallback missing');
assert(preview.includes('data-role="settings-drawer"') && preview.includes('data-role="history-drawer"'), 'interactive preview drawers missing');
assert(preview.includes('data-action="minimize"'), 'interactive preview minimize control missing');
console.log('UI state and interaction test: PASS');
