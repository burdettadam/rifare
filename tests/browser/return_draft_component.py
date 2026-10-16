"""Rendered component and explicit local API bridge; not served-browser qualification."""
import json, os, re, urllib.request, urllib.error
from pathlib import Path
from playwright.sync_api import sync_playwright
cfg=json.loads(os.environ['RIFARE_TEST_INPUT'])
assert re.fullmatch(r'http://127\.0\.0\.1:[0-9]+',cfg['url'])
assets=Path(__file__).resolve().parents[2]/'apps/commerce-api'
html=re.sub(r'<script[^>]*>.*?</script>|<link[^>]*>','',(assets/'return-draft.html').read_text())
network=[];calls=[]
def bridge(path,opts):
    assert path in ('/v1/return-drafts/prepare','/v1/return-drafts/resume','/v1/execution/approve','/v1/execution/execute','/v1/session/logout')
    request=urllib.request.Request(cfg['url']+path,data=opts['body'].encode(),headers=opts['headers'],method=opts['method'])
    try:
        with urllib.request.urlopen(request,timeout=5) as r: code,value=r.status,json.load(r)
    except urllib.error.HTTPError as e: code,value=e.code,json.load(e)
    calls.append({'path':path,'status':code});return {'status':code,'value':value}
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('RIFARE_TEST_BROWSER','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1000,'height':900})
    page.route('**/*',lambda route:(network.append(route.request.url),route.abort()))
    page.set_content(html);page.add_style_tag(content=(assets/'configuration.css').read_text());page.expose_function('bridge',bridge)
    page.evaluate('''() => {window.storageAccess=false; for(const name of ['localStorage','sessionStorage']) Object.defineProperty(window,name,{get:()=>{window.storageAccess=true;throw new Error('PRIVATE_STORAGE_DENIED');}}); window.fetch=async(path,opts)=>{const r=await window.bridge(path,opts);return {ok:r.status>=200&&r.status<300,json:async()=>r.value};};}''')
    page.add_script_tag(content=(assets/'return-draft-client.js').read_text());page.locator('#token').fill(cfg['bearer']);page.locator('#case').fill(cfg['case'])
    if cfg['scenario']=='resume':
        page.locator('#resume').click();page.wait_for_function("!document.getElementById('review').hidden")
        assert page.locator('#token').input_value()==''
        assert not page.locator('#token').evaluate('(e)=>e.required'), 'resuming must preserve in-memory session usability'
        original=json.loads(page.locator('#preview').inner_text())
        page.locator('#preview-button').click();page.wait_for_function("document.getElementById('notice').textContent.startsWith('Preview created')")
        assert json.loads(page.locator('#preview').inner_text())['id']==original['id']
        page.locator('#reviewer').fill(cfg['reviewer']);page.locator('#approval button').click();page.wait_for_function("!document.getElementById('execute').disabled")
        page.locator('#execute').click();page.wait_for_function("document.getElementById('notice').textContent.includes('No financial effect')")
        assert json.loads(page.locator('#result').inner_text())['financial_effect'] is False
    else:
        page.locator('#preview-button').click();page.wait_for_function("document.getElementById('notice').textContent==='POLICY_DENIED'")
        assert page.locator('#review').is_hidden();assert page.locator('#preview').inner_text()=='';assert page.locator('#execute').is_disabled()
    page.locator('#logout').click();page.wait_for_function("document.getElementById('notice').textContent==='Signed out locally.'")
    assert page.locator('#result').inner_text()=='';assert not page.evaluate('window.storageAccess');assert not network
    browser.close()
print(json.dumps({'scenario':cfg['scenario'],'passed':True,'calls':calls,'direct_browser_network':network}))
