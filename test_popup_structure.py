from bs4 import BeautifulSoup
from pathlib import Path

html = Path('/home/ubuntu/Temu-Exporter/popup.html').read_text(encoding='utf-8')
soup = BeautifulSoup(html, 'html.parser')

for ident in ['status', 'selectedCount', 'matchedCount', 'pendingCount', 'refreshBtn', 'exportBtn', 'clearBtn', 'process', 'processLabel', 'processCount', 'processBar', 'result', 'tsvText', 'copyBtn']:
    assert soup.find(id=ident) is not None, f'{ident} missing from primary popup'

for legacy in ['Export Today', 'Sheets Sync Today', 'tabPages', 'tabDate', 'tabHistory', 'tabContentPages', 'tabContentDate', 'tabContentHistory']:
    assert legacy not in html, f'legacy popup feature still present: {legacy}'

assert 'v8.9.0' in html, 'popup version not bumped to v8.9.0'
assert soup.find(id='process').find(id='processLabel') is not None
assert soup.find(id='process').find(id='processCount') is not None
print('primary-only popup DOM regression checks passed')
