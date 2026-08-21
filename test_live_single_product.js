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
const fixturePath = process.env.TEMU_DETAIL_FIXTURE || path.join(__dirname, '..', 'fixtures', 'detail_live.html');
if (!fs.existsSync(fixturePath)) { console.log('live single-product accuracy test: SKIP (private Temu HTML fixture is not present)'); process.exit(0); }
const rawData = extractRawData(fs.readFileSync(fixturePath, 'utf8'));
const parentOrderNo = rawData.store.parentOrderMap.parentOrderSn;
const packageId = rawData.store.parentOrderMap.localPackageInfoList[0].packageSn;
const meta = encodeURIComponent(JSON.stringify({ key: `${parentOrderNo}::${packageId}::0`, index: 0, orderNo: parentOrderNo, packageId, attempt: 1 }));
const context = {
  chrome: { runtime: { lastError: undefined, sendMessage(message, callback) { capturedMessage = message; callback({ ok: true }); } } },
  window: { rawData },
  document: { body: { innerText: '' }, title: 'Order details', scripts: [], querySelectorAll() { return []; } },
  location: { pathname: '/order-detail.html', href: `https://seller.temu.com/order-detail.html?parent_order_sn=${parentOrderNo}#temu-exporter=${meta}`, hash: `#temu-exporter=${meta}` },
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
    assert(record['Shipping Date']);
    assert(record['Order Date']);
    assert(record['Product Details']);
    assert(record['Qty (No)'] === 1, record['Qty (No)']);
    assert(/^\$\d+\.\d{2}$/.test(record['Est. Revenue']), record['Est. Revenue']);
    assert(/^\$\d+\.\d{2}$/.test(record['Shipping Cost']), record['Shipping Cost']);
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
