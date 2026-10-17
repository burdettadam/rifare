"""Rendered component with an explicit loopback API bridge, not served navigation."""
import json,os,re,urllib.request,urllib.error
from pathlib import Path
from playwright.sync_api import sync_playwright
cfg=json.loads(os.environ['RIFARE_TEST_INPUT']);assert re.fullmatch(r'http://127\.0\.0\.1:[0-9]+',cfg['url'])
assets=Path(__file__).resolve().parents[2]/'apps/commerce-api'
html=re.sub(r'<script[^>]*>.*?</script>|<link[^>]*>','',(assets/'return-operations.html').read_text());network=[]
def bridge(path,opts):
    assert path in ('/v1/return-workflows/open','/v1/return-workflows/status','/v1/return-workflows/quote','/v1/session/logout')
    request=urllib.request.Request(cfg['url']+path,data=opts['body'].encode(),headers=opts['headers'],method=opts['method'])
    try:
        with urllib.request.urlopen(request,timeout=5) as r:return {'status':r.status,'value':json.load(r)}
    except urllib.error.HTTPError as e:return {'status':e.code,'value':json.load(e)}
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox']);page=browser.new_page(viewport={'width':390,'height':844})
    page.route('**/*',lambda route:(network.append(route.request.url),route.abort()));page.set_content(html);page.add_style_tag(content=(assets/'return-operations.css').read_text());page.expose_function('bridge',bridge)
    page.evaluate('''() => {window.storageAccess=false;for(const n of ['localStorage','sessionStorage'])Object.defineProperty(window,n,{get:()=>{window.storageAccess=true;throw Error('NO_STORAGE')}});window.fetch=async(path,opts)=>{const r=await window.bridge(path,opts);if(path==='/v1/return-workflows/quote'&&window.delayQuote)await new Promise(resolve=>window.releaseQuote=resolve);return {ok:r.status>=200&&r.status<300,json:async()=>r.value};};}''');page.add_script_tag(content=(assets/'return-operations-client.js').read_text())
    page.locator('#token').fill(cfg['token']);page.locator('#request').fill(cfg['request_id']);page.locator('#skill').fill(cfg['skill_digest']);page.locator('#skill').press('Enter');page.wait_for_function("!document.getElementById('state').hidden")
    assert page.locator('#token').input_value()=='';assert 'complete' in page.locator('#summary').inner_text();assert 'Not started' in page.locator('#summary').inner_text()
    if cfg['scenario']=='late':page.evaluate('window.delayQuote=true')
    page.locator('#quote-button').click()
    if cfg['scenario']=='late':
        page.wait_for_function('typeof window.releaseQuote === "function"');page.locator('#allocation').select_option(index=1);page.evaluate('window.releaseQuote()');page.wait_for_timeout(80);assert page.locator('#quote-result').inner_text()==''
    else:
        page.wait_for_function("document.getElementById('quote-result').textContent.includes('amount_minor')");assert '1940' in page.locator('#quote-result').inner_text()
    assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth'),'mobile content widened page'
    if cfg.get('screenshot'):page.screenshot(path=cfg['screenshot'],full_page=True)
    page.locator('#logout').click();page.wait_for_function("document.getElementById('message').textContent==='Signed out.'")
    assert page.locator('#state').is_hidden();assert page.locator('#records').inner_text()=='';assert not network;assert not page.evaluate('window.storageAccess');browser.close()
print(json.dumps({'passed':True,'scenario':cfg['scenario'],'direct_browser_network':network}))
