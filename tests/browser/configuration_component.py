"""Browser DOM with an explicit Python HTTP bridge; not served-browser qualification."""
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
html = re.sub(r'<script[^>]*>.*?</script>|<link[^>]*>', '', (assets / 'configuration.html').read_text())
requests = []
network = []

def bridge(path, options):
    assert re.fullmatch(r'/v1/(configuration(/[A-Za-z0-9_-]+){0,2}|session/logout)', path)
    headers = options['headers']
    data = options.get('body')
    req = urllib.request.Request(cfg['url'] + path, data=data.encode() if data else None, headers=headers, method=options['method'])
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            status, result = response.status, json.load(response)
    except urllib.error.HTTPError as error:
        status, result = error.code, json.load(error)
    requests.append({'path': path, 'status': status})
    if cfg['scenario'] == 'injection' and isinstance(result, dict) and 'diff' in result:
        result['diff'] = [{'path': 'x', 'before': '<img src=x onerror="window.injected=1">', 'after': 'safe'}]
    return {'status': status, 'result': result}

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('RIFARE_TEST_BROWSER', '/usr/bin/chromium'), headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 390 if cfg['scenario'] == 'mobile' else 1100, 'height': 850})
    page.route('**/*', lambda route: (network.append(route.request.url), route.abort()))
    page.set_content(html)
    page.add_style_tag(content=(assets / 'configuration.css').read_text())
    page.expose_function('requestBridge', bridge)
    page.evaluate("""() => {
      window.privateStorageAccessed=false;
      for(const name of ['localStorage','sessionStorage'])Object.defineProperty(window,name,{get:()=>{window.privateStorageAccessed=true;throw new Error('PRIVATE_STORAGE_DENIED');}});
      window.fetch=async(path,options)=>{const r=await window.requestBridge(path,options);return {ok:r.status>=200&&r.status<300,status:r.status,json:async()=>r.result};};
    }""")
    page.add_script_tag(content=(assets / 'configuration-client.js').read_text())
    page.get_by_label('Session token', exact=True).fill(cfg['bearer'])
    page.get_by_label('Draft ID', exact=True).press('Enter')
    page.wait_for_function("!document.getElementById('workspace').hidden")
    assert page.locator('#token').input_value() == ''
    starting = page.locator('#identity').inner_text().split(' · ')[1]
    if cfg['scenario'] in ('edit', 'undo', 'review', 'mobile'):
        page.get_by_label('Return window (days)').fill('14')
        page.get_by_label('Return window (days)').press('Enter')
        page.wait_for_function("document.getElementById('notice').textContent.startsWith('Draft saved')")
        assert '"after": 14' in page.locator('#diff').inner_text()
        page.get_by_role('button', name='Run boundary scenarios').focus()
        page.keyboard.press('Enter')
        page.wait_for_function("document.getElementById('results').textContent.includes('after_window')")
        rows = json.loads(page.locator('#results').inner_text())
        assert rows[0]['eligible'] is True and rows[1]['eligible'] is False
        assert rows[0]['facts']['requested_at'] == 14 * 86400000
        if cfg['scenario'] == 'undo':
            page.get_by_role('button', name='Restore starting settings').click()
            page.wait_for_function("document.getElementById('notice').textContent.startsWith('Starting settings')")
            assert page.locator('#identity').inner_text().split(' · ')[1] == starting
            assert page.get_by_role('button', name='Request publication review').is_disabled()
            assert json.loads(page.locator('#diff').inner_text())['diff'] == []
        if cfg['scenario'] == 'review':
            page.get_by_role('button', name='Request publication review').click()
            page.wait_for_function("document.getElementById('notice').textContent.includes('No policy has been published')")
    if cfg['scenario'] == 'injection':
        assert '<img' in page.locator('#diff').inner_text()
        assert page.locator('#diff img').count() == 0
        assert not page.evaluate('Boolean(window.injected)')
    if cfg['scenario'] in ('logout', 'denied'):
        page.get_by_role('button', name='Sign out').click()
        page.wait_for_function("document.getElementById('workspace').hidden")
        assert page.locator('#diff').inner_text() == ''
        if cfg['scenario'] == 'denied':
            page.get_by_label('Session token', exact=True).fill(cfg['bearer'])
            page.get_by_label('Draft ID', exact=True).press('Enter')
            page.wait_for_function("document.getElementById('notice').textContent.includes('ACCESS_DENIED')")
            assert not page.locator('#workspace').is_visible()
    assert not page.evaluate('window.privateStorageAccessed')
    assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth')
    assert network == [], network
    if cfg.get('screenshot'):
        page.screenshot(path=cfg['screenshot'], full_page=True)
    browser.close()
print(json.dumps({'scenario':cfg['scenario'],'requests':requests,'passed':True,'browser_network_requests':len(network),'evidence_kind':'browser_component_with_real_loopback_api_bridge','served_navigation_qualified':False}))
