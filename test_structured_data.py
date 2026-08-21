import json
import re
from pathlib import Path

html_path = Path('/home/ubuntu/browser_html/seller_temu_com_order-detail.html_1787251854233.html')
content_path = Path(__file__).with_name('content.js')
text = html_path.read_text(errors='ignore')
raw = re.findall(r'window\.rawData\s*=\s*(\{.*?\});', text, flags=re.S)[0]
store = json.loads(raw)['store']
parent = store['parentOrderMap']
shipping = store['shippingInfo']
order = store['orderList'][0]
package = parent['localPackageInfoList'][0]
interline = package['interlineInfoForAggregationInfo'][0]

assert shipping['receiptName'] == 'Larry Northcutt'
assert parent['parentOrderSn'] == 'PO-211-01861395087993272'
assert parent['localParentOrderTimeStr'].startswith('Aug 19, 2026')
assert parent['estimatedIncomeTotal'] == '$16.02'
assert order['goodsName'].startswith('Callaway Golf Supersoft Golf Balls')
assert order['quantity'] == 1
assert package['trackingNumber'] == '1Z16E50BYW50615076'
assert package['sendTimeStr'].startswith('Aug 20, 2026')
assert interline['estimatedAmount'] == '$6.24'

content = content_path.read_text()
for marker in ['window.rawData', 'localPackageInfoList', 'estimatedIncomeTotal', 'receiptName', 'Download Excel']:
    assert marker in content or marker in Path(__file__).with_name('xlsx.js').read_text(), marker
print('structured bootstrap fixture: PASS')
print('order:', parent['parentOrderSn'])
print('customer:', shipping['receiptName'])
print('tracking:', package['trackingNumber'])
