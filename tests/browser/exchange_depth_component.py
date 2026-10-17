"""Real rendered components with an explicit loopback HTTP bridge.

Gift delivery uses a preissued fixture challenge; verify and choices still use
the real HTTP service. Public delivery routing is covered by the API tests.
"""
import json, os, re, urllib.request, urllib.error
from pathlib import Path
from playwright.sync_api import sync_playwright
cfg = json.loads(os.environ['RIFARE_TEST_INPUT'])
assert re.fullmatch(r'http://127\.0\.0\.1:[0-9]+', cfg['url'])
assets = Path(__file__).resolve().parents[2] / 'apps/commerce-api'
gift = cfg['scenario'] == 'gift'
html = re.sub(r'<script[^>]*>.*?</script>|<link[^>]*>', '', (assets / ('gift-returns.html' if gift else 'exchanges.html')).read_text())
network = []
def bridge(path, opts):
    assert path in ('/v1/resolutions/exchange-browse', '/v1/resolutions/exchange-quote', '/v1/gifts/challenges', '/v1/gifts/verify', '/v1/gifts/choices')
    if path == '/v1/gifts/challenges':
        assert json.loads(opts['body']) == cfg['gift_request']
        return {'status': 202, 'value': cfg['challenge']}
    request = urllib.request.Request(cfg['url'] + path, data=opts['body'].encode(), headers=opts['headers'], method=opts['method'])
    try:
        with urllib.request.urlopen(request, timeout=5) as r:
            return {'status': r.status, 'value': json.load(r)}
    except urllib.error.HTTPError as e:
        return {'status': e.code, 'value': json.load(e)}
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 390, 'height': 844})
    page.route('**/*', lambda route: (network.append(route.request.url), route.abort()))
    page.set_content(html)
    page.add_style_tag(content=(assets / 'exchange-depth.css').read_text())
    page.expose_function('bridge', bridge)
    page.evaluate('''() => {window.storageAccess=false;for(const n of ['localStorage','sessionStorage'])Object.defineProperty(window,n,{get:()=>{window.storageAccess=true;throw Error('NO_STORAGE')}});window.fetch=async(path,opts)=>{const r=await window.bridge(path,opts);if(path.endsWith('exchange-quote')&&window.delayQuote)await new Promise(resolve=>window.releaseQuote=resolve);return {ok:r.status>=200&&r.status<300,json:async()=>r.value};};}''')
    page.add_script_tag(content=(assets / 'exchange-depth-client.js').read_text())
    if gift:
        page.locator('#gift-store').fill(cfg['gift_request']['store_id'])
        page.locator('#gift-id').fill(cfg['gift_request']['gift_id'])
        page.locator('#gift-email').fill(cfg['gift_request']['email'])
        page.locator('#gift-email').press('Enter')
        page.wait_for_function("!document.getElementById('gift-verify').hidden")
        page.locator('#gift-proof').fill(cfg['proof'])
        page.locator('#gift-proof').press('Enter')
        page.wait_for_function("!document.getElementById('gift-choices').hidden")
        assert page.locator('#gift-proof').input_value() == ''
        text = page.locator('body').inner_text()
        for secret in ['Private Purchaser', 'Hidden Buyer Address', '8740', cfg['purchaser_id']]:
            assert secret not in text
        assert 'gamma: 1 available' in text
        assert page.get_by_role('button', name='Exchange the gift').count() == 1
        page.get_by_role('button', name='Choose store credit').click()
        assert 'Store credit selected' in page.locator('#gift-next').inner_text()
    else:
        page.locator('#operator-token').fill(cfg['token'])
        page.locator('#allocation-id').fill(cfg['allocation_id'])
        page.locator('#allocation-id').press('Enter')
        page.wait_for_function("document.querySelectorAll('#offers button').length===1")
        assert page.locator('#offers h3').inner_text() == 'coat-medium'
        assert page.locator('#offers p').inner_text() == 'USD 10.80'
        if cfg['scenario'] == 'late':
            page.evaluate('window.delayQuote=true')
        page.get_by_role('button', name='Get quote').click()
        if cfg['scenario'] == 'late':
            page.wait_for_function('typeof window.releaseQuote === "function"')
            page.locator('#allocation-id').fill('changed-allocation')
            page.evaluate('window.releaseQuote()')
            page.wait_for_function("document.getElementById('offers').children.length===0")
            assert page.locator('#quote').is_hidden()
        else:
            page.wait_for_function("!document.getElementById('quote').hidden")
            assert page.locator('#original-value').inner_text() == 'USD 10.00'
            assert page.locator('#difference').inner_text() == 'Payment due: USD 0.80'
            assert 'settle before' in page.locator('#quote-next').inner_text()
    assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth'), 'mobile page overflow'
    assert not page.evaluate('window.storageAccess')
    assert not network
    if cfg.get('screenshot'):
        page.screenshot(path=cfg['screenshot'], full_page=True)
    browser.close()
print(json.dumps({'passed': True, 'scenario': cfg['scenario'], 'direct_browser_network': network}))
