"""Rendered return component using an explicit local HTTP bridge, not live navigation."""
import json, os, re, urllib.request, urllib.error
from pathlib import Path
from playwright.sync_api import sync_playwright
cfg=json.loads(os.environ['RIFARE_TEST_INPUT']); assert re.fullmatch(r'http://127\.0\.0\.1:[0-9]+',cfg['url'])
assets=Path(__file__).resolve().parents[2]/'apps/commerce-api'
html=re.sub(r'<script[^>]*>.*?</script>|<link[^>]*>','',(assets/'returns.html').read_text())
network=[];calls=[]
def bridge(path,opts):
    assert path in ('/v1/returns/form','/v1/returns/quote','/v1/returns/prepare','/v1/returns/revise','/v1/returns/status','/v1/session/logout','/v1/return-evidence/upload')
    req=urllib.request.Request(cfg['url']+path,data=opts['body'].encode(),headers=opts['headers'],method=opts['method'])
    try:
        with urllib.request.urlopen(req,timeout=5) as r: code,value=r.status,json.load(r)
    except urllib.error.HTTPError as e: code,value=e.code,json.load(e)
    calls.append({'path':path,'status':code});return {'status':code,'value':value}
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('RIFARE_TEST_BROWSER','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':390,'height':844})
    page.route('**/*',lambda route:(network.append(route.request.url),route.abort()))
    page.set_content(html);page.add_style_tag(content=(assets/'returns.css').read_text());page.expose_function('bridge',bridge)
    page.evaluate('''() => {window.storageAccess=false;for(const n of ['localStorage','sessionStorage'])Object.defineProperty(window,n,{get:()=>{window.storageAccess=true;throw Error('NO_STORAGE')}});window.fetch=async(path,opts)=>{const r=await window.bridge(path,opts);if(path==='/v1/returns/quote'&&window.delayQuote)await new Promise(resolve=>window.releaseQuote=resolve);return {ok:r.status>=200&&r.status<300,json:async()=>r.value};};}''')
    page.add_script_tag(content=(assets/'returns-client.js').read_text())
    page.locator('#session').fill(cfg['bearer']);page.locator('#case').fill('case_one');page.locator('#case').press('Enter')
    page.wait_for_function("document.getElementById('notice').textContent==='Verified order loaded.'")
    assert page.locator('#session').input_value()==''
    if cfg['scenario']=='resume':
        assert page.locator('#request-status').inner_text()=='Your request is awaiting merchant review.'
        assert page.locator('#request-id').inner_text()==cfg['request_id']
    else:
        page.locator('#qty-one').focus();page.keyboard.press('Control+A');page.keyboard.type('1');page.keyboard.press('Tab')
        if cfg['scenario']=='late_quote':page.evaluate('window.delayQuote=true')
        page.locator('#calculate').click()
        if cfg['scenario']=='late_quote':
            page.wait_for_function('typeof window.releaseQuote === "function"');page.locator('#qty-one').fill('0');page.evaluate('window.releaseQuote()');page.wait_for_timeout(100)
            assert page.locator('#quote-panel').is_hidden(), 'an old quote must not repaint after item selection changes'
            assert page.locator('#submit').is_disabled()
        else:
            page.wait_for_function("!document.getElementById('quote-panel').hidden")
            if cfg['scenario']=='jpy': assert 'JPY 1700' in page.locator('#estimate').inner_text(), 'minor units must use the source currency exponent'
            else: assert 'USD 17.00' in page.locator('#estimate').inner_text()
            page.locator('#consent').focus();page.keyboard.press('Space');page.keyboard.press('Tab');assert page.locator('#submit').evaluate('(e)=>e===document.activeElement');page.keyboard.press('Enter')
            page.wait_for_function("document.getElementById('notice').textContent.startsWith('Request saved')")
            assert page.locator('#request-status').inner_text()=='Your request is awaiting merchant review.'
    assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth'), 'mobile content must not widen the page'
    if cfg.get('screenshot'): page.screenshot(path=cfg['screenshot'],full_page=True)
    page.locator('#logout').click();page.wait_for_function("document.getElementById('notice').textContent==='Signed out locally.'")
    assert page.locator('#status-panel').is_hidden();assert page.locator('#items').inner_text()=='';assert not page.evaluate('window.storageAccess');assert not network
    browser.close()
print(json.dumps({'scenario':cfg['scenario'],'passed':True,'calls':calls,'direct_browser_network':network}))
