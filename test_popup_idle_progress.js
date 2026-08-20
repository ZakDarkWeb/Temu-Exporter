const fs = require('fs');
const assert = require('assert');

const html = fs.readFileSync('/home/ubuntu/Temu-Exporter/popup.html', 'utf8');
const js = fs.readFileSync('/home/ubuntu/Temu-Exporter/popup.js', 'utf8');

assert(html.includes('#progressSection, .progress-section {\n    display: none;'), 'popup progress CSS is not hidden by default');
assert(html.includes('<div id="progressSection" style="display:none;">'), 'popup progress markup is not hidden by default');
assert(js.includes("progressSec.style.display = 'none';"), 'popup has no idle progress reset');
assert(js.includes("progressSec.style.display = 'block';"), 'popup has no explicit active progress transition');
console.log('popup idle progress regression test passed');
