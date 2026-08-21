const fs = require('fs');
const vm = require('vm');
const path = require('path');

let capturedMessage = null;
const meta = encodeURIComponent(JSON.stringify({ key: 'PO-MULTI::PK-MULTI::0', index: 0, orderNo: 'PO-MULTI', packageId: 'PK-MULTI', attempt: 1 }));
const store = {
  parentOrderMap: {
    parentOrderSn: 'PO-MULTI',
    localParentOrderTimeStr: 'Aug 18, 2026, 10:15 pm PKT(UTC+5)',
    estimatedIncomeTotal: '$34.64',
    localPackageInfoList: [{
      packageSn: 'PK-MULTI',
      trackingNumber: 'GFUS01068500896131',
      sendTimeStr: 'Aug 21, 2026, 12:01 am PKT',
      interlineInfoForAggregationInfo: [{ packageSn: 'PK-MULTI', trackingNumber: 'GFUS01068500896131', estimatedAmount: '$0.00' }]
    }]
  },
  shippingInfo: { receiptName: 'Terry Wooldridge' },
  orderList: [
    {
      goodsName: 'Callaway Supersoft Splatter 360 Golf Balls Blue Spletter (Sleeve) (2026)',
      originalGoodsName: 'Callaway Supersoft Splatter 360 Golf Balls Blue Spletter (Sleeve) (2026)',
      quantity: 1,
      estimatedIncome: '$19.99',
      orderRetailPrice: '$19.99',
      orderPackageInfoList: [{ packageSn: 'PK-MULTI', trackingNumber: 'GFUS01068500896131' }]
    },
    {
      goodsName: 'Callaway Supersoft Stars & Stripes Golf Balls {Sleeve} (USA)',
      originalGoodsName: 'Callaway Supersoft Stars & Stripes Golf Balls {Sleeve} (USA)',
      quantity: 1,
      estimatedIncome: '$14.65',
      orderRetailPrice: '$14.65',
      orderPackageInfoList: [{ packageSn: 'PK-MULTI', trackingNumber: 'GFUS01068500896131' }]
    }
  ]
};

const chrome = {
  runtime: {
    lastError: undefined,
    sendMessage(message, callback) { capturedMessage = message; callback({ ok: true }); }
  }
};
const document = {
  body: { innerText: '' },
  title: 'Order details',
  scripts: [],
  querySelectorAll() { return []; },
  documentElement: { appendChild() {} }
};
const context = {
  chrome,
  window: { rawData: { store } },
  document,
  location: { pathname: '/order-detail.html', href: `https://seller.temu.com/order-detail.html?parent_order_sn=PO-MULTI#temu-exporter=${meta}`, hash: `#temu-exporter=${meta}` },
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
    assert(capturedMessage?.type === 'TEMU_DETAIL_RESULT', `unexpected message ${capturedMessage?.type}: ${capturedMessage?.message || ''}`);
    assert(Array.isArray(capturedMessage.records) && capturedMessage.records.length === 2, 'expected two product records');
    const [first, second] = capturedMessage.records;
    assert(first['Product Details'] === 'Callaway Supersoft Splatter 360 Golf Balls Blue Spletter', first['Product Details']);
    assert(second['Product Details'] === 'Callaway Supersoft Stars & Stripes Golf Balls', second['Product Details']);
    assert(first['Qty (No)'] === 1 && second['Qty (No)'] === 1, 'quantity mapping failed');
    assert(first['Est. Revenue'] === '$34.64' && second['Est. Revenue'] === '', 'first-row revenue placement failed');
    assert(first['Shipping Cost'] === '$0.00' && second['Shipping Cost'] === '', 'first-row shipping placement failed');
    assert(first['Order No'] === 'PO-MULTI' && second['Order No'] === 'PO-MULTI', 'order number not repeated');
    assert(first['Tracking Number'] === 'GFUS01068500896131' && second['Tracking Number'] === 'GFUS01068500896131', 'tracking mapping failed');
    console.log('multi-product extraction test: PASS');
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}, 100);

function assert(condition, message = 'assertion failed') {
  if (!condition) throw new Error(message);
}
