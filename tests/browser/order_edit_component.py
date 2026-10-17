"""Real rendered component plus an explicit local API bridge; not served navigation."""
import json, os, re, urllib.request, urllib.error
from pathlib import Path
from playwright.sync_api import sync_playwright
cfg=json.loads(os.environ['RIFARE_TEST_INPUT'])
assert re.fullmatch(r'http://127\.0\.0\.1:[0-9]+',cfg['url'])
assets=Path(__file__).resolve().parents[2]/'apps/commerce-api'
html=re.sub(r'<script[^>]*>.*?</script>|<link[^>]*>','',(assets/'order-edits.html').read_text())
network=[]
def bridge(path,opts):
    assert path in ('/v1/edit-workflows/open','/v1/edit-workflows/status','/v1/edit-workflows/quote','/v1/order-edits/prepare','/v1/order-edits/status','/v1/order-edits/dispatch','/v1/order-edits/reconcile','/v1/order-edits/release','/v1/execution/approve','/v1/execution/execute','/v1/session/logout')
    req=urllib.request.Request(cfg['url']+path,data=opts['body'].encode(),headers=opts['headers'],method=opts['method'])
    try:
        with urllib.request.urlopen(req,timeout=8) as r:return {'status':r.status,'value':json.load(r)}
    except urllib.error.HTTPError as e:return {'status':e.code,'value':json.load(e)}
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':390,'height':844}); page.set_default_timeout(10000)
    page.route('**/*',lambda r:(network.append(r.request.url),r.abort()))
    page.set_content(html);page.add_style_tag(content=(assets/'order-edits.css').read_text());page.expose_function('bridge',bridge)
    page.evaluate('''() => {window.storageAccess=false;for(const name of ['localStorage','sessionStorage'])Object.defineProperty(window,name,{get:()=>{window.storageAccess=true;throw Error('NO_STORAGE')}});window.fetch=async(path,options)=>{const r=await window.bridge(path,options);if(path===window.delayPath)await new Promise(resolve=>window.finishDelay=resolve);return {ok:r.status>=200&&r.status<300,json:async()=>r.value};};}''')
    page.add_script_tag(content=(assets/'order-edits-client.js').read_text())
    page.locator('#token').fill(cfg['token']);page.locator('#case').fill('case_one');page.locator('#skill').fill(cfg['skill_digest']);page.locator('#skill').press('Enter')
    page.wait_for_function("!document.getElementById('state').hidden")
    assert page.locator('#token').input_value()==''
    scenario=cfg['scenario']
    if scenario=='late_quote':page.evaluate("window.delayPath='/v1/edit-workflows/quote'")
    page.locator('#intent button').click()
    if scenario=='late_quote':
        page.wait_for_function('typeof window.finishDelay === "function"');page.locator('#variant').fill('cheaper');page.evaluate('window.finishDelay()');page.wait_for_timeout(100)
        assert page.locator('#quote').inner_text()=='';assert page.locator('#review').is_hidden()
    else:
        page.wait_for_function("!document.getElementById('review').hidden")
        assert '1000' in page.locator('#quote').inner_text();page.locator('#reviewer').fill(cfg['reviewer'])
        if scenario=='late_status':page.evaluate("window.delayPath='/v1/order-edits/status'")
        page.locator('#approve').click()
        if scenario=='late_status':
            page.wait_for_function('typeof window.finishDelay === "function"');page.locator('#logout').click();page.wait_for_function("document.getElementById('message').textContent==='Signed out.'");page.evaluate('window.finishDelay()');page.wait_for_timeout(150)
            assert page.locator('#records').inner_text()=='','late status leaked after sign-out'
            assert page.locator('#message').inner_text()=='Signed out.'
        else:
            page.wait_for_function("!document.getElementById('actions').hidden")
            assert page.locator('#reviewer').input_value()=='';page.locator('#dispatch').click()
            page.wait_for_function("document.getElementById('summary').textContent.includes('awaiting_invoice')")
            assert 'unpaid' in page.locator('#summary').inner_text();assert 'not_complete' in page.locator('#summary').inner_text()
            page.locator('#release').click();page.wait_for_function("document.getElementById('message').textContent.includes('EDIT_PAYMENT_OUTSTANDING')")
            assert 'awaiting_invoice' in page.locator('#summary').inner_text()
    assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth'),'mobile content widened page'
    if cfg.get('screenshot'):page.screenshot(path=cfg['screenshot'],full_page=True)
    if scenario!='late_status':page.locator('#logout').click();page.wait_for_function("document.getElementById('message').textContent==='Signed out.'")
    assert page.locator('#state').is_hidden();assert page.locator('#records').inner_text()=='';assert not page.evaluate('window.storageAccess');assert not network
    browser.close()
print(json.dumps({'passed':True,'scenario':cfg['scenario'],'direct_browser_network':network}))
