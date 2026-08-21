import json
import os
import re
from pathlib import Path

html_path = Path(os.environ.get('TEMU_DETAIL_FIXTURE', str(Path(__file__).resolve().parent.parent / 'fixtures' / 'detail_live.html')))
if not html_path.exists():
    print('structured bootstrap fixture: SKIP (private Temu HTML fixture is not present)')
    raise SystemExit(0)
content_path = Path(__file__).with_name('content.js')
text = html_path.read_text(errors='ignore')
raw = re.findall(r'window\.rawData\s*=\s*(\{.*?\});', text, flags=re.S)[0]
store = json.loads(raw)['store']
parent = store['parentOrderMap']
shipping = store['shippingInfo']
order = store['orderList'][0]
package = parent['localPackageInfoList'][0]
interline = package['interlineInfoForAggregationInfo'][0]

assert shipping['receiptName']
assert re.fullmatch(r'PO-[A-Za-z0-9-]+', parent['parentOrderSn'])
assert parent['localParentOrderTimeStr']
assert re.fullmatch(r'\$\d+\.\d{2}', parent['estimatedIncomeTotal'])
assert order['goodsName']
assert order['quantity'] == 1
assert re.fullmatch(r'[A-Z0-9]+', package['trackingNumber'])
assert package['sendTimeStr']
assert re.fullmatch(r'\$\d+\.\d{2}', interline['estimatedAmount'])

content = content_path.read_text()
for marker in ['window.rawData', 'localPackageInfoList', 'estimatedIncomeTotal', 'receiptName', 'Download Excel']:
    assert marker in content or marker in Path(__file__).with_name('xlsx.js').read_text(), marker
print('structured bootstrap fixture: PASS')
print('order:', parent['parentOrderSn'])
print('customer:', shipping['receiptName'])
print('tracking:', package['trackingNumber'])
