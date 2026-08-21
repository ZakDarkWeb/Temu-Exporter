const fs = require('fs');
const vm = require('vm');
const path = require('path');

function extractRawData(text) {
  const marker = 'window.rawData';
  const markerIndex = text.indexOf(marker);
  const equalsIndex = text.indexOf('=', markerIndex + marker.length);
  const braceStart = text.indexOf('{', equalsIndex);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = braceStart; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character.charCodeAt(0) === 92) escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return JSON.parse(text.slice(braceStart, index + 1));
    }
  }
  throw new Error('rawData not found');
}

let capturedMessage = null;
const rawData = extractRawData(fs.readFileSync('/home/ubuntu/browser_html/seller_temu_com_order-detail.html_1787251854233.html', 'utf8'));
const meta = encodeURIComponent(JSON.stringify({ key: 'PO-211-01861395087993272::PK-3937132821381893074::0', index: 0, orderNo: 'PO-211-01861395087993272', packageId: 'PK-3937132821381893074', attempt: 1 }));
const context = {
  chrome: { runtime: { lastError: undefined, sendMessage(message, callback) { capturedMessage = message; callback({ ok: true }); } } },
  window: { rawData },
  document: { body: { innerText: '' }, title: 'Order details', scripts: [], querySelectorAll() { return []; } },
  location: { pathname: '/order-detail.html', href: `https://seller.temu.com/order-detail.html?parent_order_sn=PO-211-01861395087993272#temu-exporter=${meta}`, hash: `#temu-exporter=${meta}` },
  URL,
  URLSearchParams,
  console,
  setTimeout,
  clearTimeout,
  Promise,
  Date,
  Math,
  Set,
  Map,
  Number,
  String,
  Boolean,
  JSON,
  Error
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'content.js'), 'utf8'), context, { filename: 'content.js' });

setTimeout(() => {
  try {
    assert(capturedMessage?.type === 'TEMU_DETAIL_RESULT', `unexpected message ${capturedMessage?.type}`);
    assert(capturedMessage.records.length === 1, 'expected one captured product record');
    const record = capturedMessage.records[0];
    assert(record['Shipping Date'] === 'Aug 20, 2026', record['Shipping Date']);
    assert(record['Order Date'] === 'Aug 19, 2026', record['Order Date']);
    assert(record['Product Details'] === 'Callaway Golf Supersoft Golf Balls Blue Splatter Balls', record['Product Details']);
    assert(record['Qty (No)'] === 1, record['Qty (No)']);
    assert(record['Est. Revenue'] === '$16.02', record['Est. Revenue']);
    assert(record['Shipping Cost'] === '$6.24', record['Shipping Cost']);
    console.log('live single-product accuracy test: PASS');
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}, 100);

function assert(condition, message = 'assertion failed') {
  if (!condition) throw new Error(message);
}
