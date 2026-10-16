"""DOM component plus explicit loopback bridge; not served-browser qualification."""
import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

cfg = json.loads(os.environ['RIFARE_TEST_INPUT'])
assert re.fullmatch(r'http://127\.0\.0\.1:[0-9]+', cfg['url'])
assets = Path(__file__).resolve().parents[2] / 'apps/commerce-api'
html = re.sub(r'<script[^>]*>.*?</script>|<link[^>]*>', '', (assets / 'execution.html').read_text())
requests = []
network = []

def http(path, options):
    assert path in ('/v1/execution/preview', '/v1/execution/approve', '/v1/execution/execute', '/v1/execution/configure', '/v1/session/logout')
    req = urllib.request.Request(cfg['url'] + path, data=options['body'].encode(), headers=options['headers'], method=options['method'])
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, json.load(error)

def bridge(path, options):
    status, result = http(path, options)
    requests.append({'path': path, 'status': status})
    if cfg['scenario'] == 'injection' and path.endswith('/preview') and status == 200:
        result['diagnostic_note'] = '<img src=x onerror="window.injected=1">'
    if cfg['scenario'] == 'stale' and path.endswith('/approve') and status == 200:
        status2, _ = http('/v1/execution/configure', {'method': 'POST', 'headers': {'authorization': 'Bearer ' + cfg['owner'], 'content-type': 'application/json'}, 'body': json.dumps({'enabled': False, 'expected_revision': 1, 'profile_id': 'default', 'policy_id': 'returns'})})
        assert status2 == 200
    return {'status': status, 'result': result}

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('RIFARE_TEST_BROWSER', '/usr/bin/chromium'), headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 390 if cfg['scenario'] == 'mobile' else 1000, 'height': 900})
    page.route('**/*', lambda route: (network.append(route.request.url), route.abort()))
    page.set_content(html)
    page.add_style_tag(content=(assets / 'configuration.css').read_text())
    page.expose_function('requestBridge', bridge)
    page.evaluate('''() => {
        window.privateStorageAccessed = false;
        for (const name of ['localStorage','sessionStorage']) Object.defineProperty(window,name,{get:()=>{window.privateStorageAccessed=true;throw new Error('PRIVATE_STORAGE_DENIED');}});
        window.fetch = async(path,options)=>{const r=await window.requestBridge(path,options);return {ok:r.status>=200&&r.status<300,json:async()=>r.result};};
    }''')
    page.add_script_tag(content=(assets / 'execution-client.js').read_text())
    page.get_by_label('Session token', exact=True).fill(cfg['bearer'])
    page.get_by_role('button', name='Create preview', exact=True).click()
    page.wait_for_function("!document.getElementById('review').hidden")
    assert page.locator('#token').input_value() == ''
    preview = json.loads(page.locator('#preview').inner_text())
    assert preview['preview']['amount'] == {'currency': 'USD', 'minor': '12500'}
    assert page.get_by_role('button', name='Execute synthetic change once').is_disabled()
    if cfg['scenario'] == 'injection':
        assert '<img' in page.locator('#preview').inner_text()
        assert page.locator('#preview img').count() == 0
        assert not page.evaluate('Boolean(window.injected)')
    page.get_by_label('Reviewer session', exact=True).fill(cfg['reviewer'])
    page.get_by_role('button', name='Approve this preview', exact=True).click()
    page.wait_for_function("!document.getElementById('execute').disabled")
    assert page.locator('#reviewer').input_value() == ''
    page.get_by_role('button', name='Execute synthetic change once').click()
    if cfg['scenario'] == 'stale':
        page.wait_for_function("document.getElementById('notice').textContent==='CAPABILITY_UNAVAILABLE'")
        assert page.locator('#result').inner_text() == ''
        assert page.locator('#preview').inner_text() == ''
        assert page.locator('#review').is_hidden()
    else:
        page.wait_for_function("document.getElementById('notice').textContent.includes('No financial effect')")
        receipt = json.loads(page.locator('#result').inner_text())
        assert receipt['financial_effect'] is False
        assert receipt['approval_consumed'] is True
        assert receipt['effect'] == 'local_case_plan_only'
    if cfg['scenario'] == 'mobile':
        assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth+2')
    page.get_by_role('button', name='Sign out and clear', exact=True).click()
    page.wait_for_function("document.getElementById('notice').textContent==='Signed out locally.'")
    assert page.locator('#result').inner_text() == ''
    assert not page.evaluate('window.privateStorageAccessed')
    assert not network
    browser.close()
print(json.dumps({'scenario': cfg['scenario'], 'passed': True, 'requests': requests, 'direct_browser_network': network}))
