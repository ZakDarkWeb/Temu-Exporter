const fs = require('fs');
const vm = require('vm');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'xlsx.js'), 'utf8');
const context = { window: {}, TextEncoder, Uint8Array, Set, Math, String, Number, Date };
vm.createContext(context);
vm.runInContext(source, context, { filename: 'xlsx.js' });

const records = [{
  'Shipping Date': 'Aug 20, 2026, 4:16 pm GMT',
  'Order Date': 'Aug 19, 2026, 8:35 pm GMT(UTC+0)',
  'Tracking Number': 'TRACK-TEST-1',
  'Order No': 'PO-TEST-1',
  'Customer Name': 'Test Customer',
  'Product Details': 'Callaway Golf Supersoft Golf Balls Blue Splatter Balls (Sleeve)',
  'Qty (No)': '1.00',
  'Est. Revenue': '$16.02',
  'Shipping Cost': '$6.24'
}, {
  'Shipping Date': 'Aug 20, 2026, 4:16 pm GMT',
  'Order Date': 'Aug 19, 2026, 8:35 pm GMT(UTC+0)',
  'Tracking Number': 'TRACK-TEST-1',
  'Order No': 'PO-TEST-1',
  'Customer Name': 'Test Customer',
  'Product Details': 'TaylorMade Blue Ink SpeedSoft Golf Balls',
  'Qty (No)': '1.00',
  'Est. Revenue': '',
  'Shipping Cost': ''
}];
const errors = [{ orderNo: 'PO-211-ERROR', packageId: 'PK-ERROR', attempts: 3, message: 'Temu opened a no-auth page.', at: '2026-08-21T00:00:00.000Z' }];
const bytes = context.window.TemuXlsx.buildWorkbook(records, errors);
fs.writeFileSync(path.join(__dirname, 'test-output.xlsx'), Buffer.from(bytes));
console.log(`xlsx bytes: ${bytes.length}`);
console.log('xlsx generator: PASS');
