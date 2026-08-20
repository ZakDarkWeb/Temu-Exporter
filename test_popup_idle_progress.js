const fs = require('fs');
const assert = require('assert');

const html = fs.readFileSync('/home/ubuntu/Temu-Exporter/popup.html', 'utf8');
const js = fs.readFileSync('/home/ubuntu/Temu-Exporter/popup.js', 'utf8');

assert(html.includes('Saved order selection'), 'minimal selection panel is missing');
assert(html.includes('Debug Detection'), 'selection debug control is missing');
assert(!html.includes('Processing'), 'popup must not show an idle processing panel');
assert(!html.includes('Export as'), 'popup must not expose an export-format selector');
assert(!js.includes('progressSec') && !js.includes('autoBtn'), 'legacy popup progress/export controller remains');
console.log('minimal popup idle surface regression test passed');
