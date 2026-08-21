import json
import re
from pathlib import Path
from bs4 import BeautifulSoup

ROOT = Path('/home/ubuntu')
bulk_path = ROOT / 'browser_html/seller_temu_com_buy-shipping-bulk-details.html_1787251821675.html'
detail_path = ROOT / 'browser_html/seller_temu_com_order-detail.html_1787251854233.html'
manifest_path = Path(__file__).with_name('manifest.json')
content_path = Path(__file__).with_name('content.js')

bulk = BeautifulSoup(bulk_path.read_text(errors='ignore'), 'html.parser')
detail = BeautifulSoup(detail_path.read_text(errors='ignore'), 'html.parser')

rows = bulk.select('tr[data-testid="beast-core-table-body-tr"]')
assert len(rows) == 29, f'expected 29 body rows, got {len(rows)}'
first_cells = [re.sub(r'\s+', ' ', c.get_text(' ', strip=True)) for c in rows[0].select('td')]
assert first_cells[0] == 'PO-211-01861395087993272'
assert first_cells[1] == 'PK-3937132821381893074'
assert first_cells[7] == '$6.24'
assert first_cells[8] == '1Z16E50BYW50615076'
assert rows[0].select_one('[role="button"]:last-child').get_text(' ', strip=True) == 'View details'

# Verify direct label/value containers observed in the live rendered detail DOM.
def direct_value(label):
    label_el = detail.find(string=lambda s: s and s.strip() == label)
    assert label_el is not None, f'missing label: {label}'
    parent = label_el.parent.parent
    values = [re.sub(r'\s+', ' ', child.get_text(' ', strip=True)) for child in parent.find_all(recursive=False) if child is not label_el.parent]
    return next((v for v in values if v and v != label), '')

assert direct_value('Purchase date').startswith('Aug 19, 2026')
assert direct_value('Recipient name') == 'Larry Northcutt'
assert direct_value('Est. total shipping cost') == '$6.24'

body_text = re.sub(r'\s+', ' ', detail.get_text(' ', strip=True))
assert 'Order ID : PO-211-01861395087993272' in body_text or 'Order ID:PO-211-01861395087993272' in body_text
assert re.search(r'Shipment confirmed at\s+Aug 20, 2026, 4:16 pm GMT', body_text)
assert re.search(r'Tracking number\s+1Z16E50BYW50615076', body_text)
assert re.search(r'Estimated revenue\s+\$16\.02', body_text)

order_table = next(table for table in detail.find_all('table') if len(table.find_all('td')) >= 6)
order_row = order_table.find('tr')
order_cells = [re.sub(r'\s+', ' ', c.get_text(' ', strip=True)) for c in order_row.find_all('td')]
assert 'Callaway Golf Supersoft Golf Balls Blue Splatter Balls (Sleeve)' in order_cells[1]
assert '1 shipped' in order_cells[2]

manifest = json.loads(manifest_path.read_text())
assert manifest['manifest_version'] == 3
assert 'storage' in manifest['permissions']
assert manifest['content_scripts'][0]['matches'] == ['https://seller.temu.com/*']
content = content_path.read_text()
for required in ['Shipping Date', 'Order Date', 'Tracking Number', 'Order No', 'Customer Name', 'Product Details', 'Qty (No)', 'Est. Revenue', 'Shipping Cost', 'beast-core-table-body-tr', 'captureBulkRows']:
    assert required in content, f'missing implementation marker: {required}'

print('fixture tests: PASS')
print(f'bulk body rows: {len(rows)}')
print(f'first order: {first_cells[0]}')
print('detail labels and export mapping: PASS')
