"""Actual support UI with a declared bridge to the real local API, not served navigation."""
import json, os, re, urllib.request, urllib.error
from pathlib import Path
from playwright.sync_api import sync_playwright
cfg=json.loads(os.environ['RIFARE_TEST_INPUT'])
assert re.fullmatch(r'http://127\.0\.0\.1:[0-9]+',cfg['url'])
assets=Path(__file__).resolve().parents[2]/'apps/commerce-api'
html=re.sub(r'<script[^>]*>.*?</script>|<link[^>]*>','',(assets/('support-tracking.html' if cfg['scenario']=='tracking' else 'support.html')).read_text())
network=[]
def bridge(path,opts):
    assert path in ['/v1/support/'+name for name in ['context','takeover','metrics-close','queue','dispatch','reconcile','customer-message','consent']]+['/v1/session/logout']
    req=urllib.request.Request(cfg['url']+path,data=opts['body'].encode(),headers=opts['headers'],method=opts['method'])
    try:
        with urllib.request.urlopen(req,timeout=8) as r:return {'status':r.status,'value':json.load(r)}
    except urllib.error.HTTPError as e:return {'status':e.code,'value':json.load(e)}
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':390,'height':844});page.set_default_timeout(10000)
    page.route('**/*',lambda r:(network.append(r.request.url),r.abort()))
    page.set_content(html);page.add_style_tag(content=(assets/'support.css').read_text());page.expose_function('bridge',bridge)
    page.evaluate('''() => {window.storageAccess=false;for(const name of ['localStorage','sessionStorage'])Object.defineProperty(window,name,{get:()=>{window.storageAccess=true;throw Error('NO_STORAGE')}});window.fetch=async(path,options)=>{const r=await window.bridge(path,options);if(path===window.delayPath)await new Promise(resolve=>window.finishDelay=resolve);return {ok:r.status>=200&&r.status<300,json:async()=>r.value};};}''')
    page.add_script_tag(content=(assets/'support-client.js').read_text());page.locator('#token').fill(cfg['customer'] if cfg['scenario']=='customer' else cfg['token']);page.locator('#case').fill('support_case');page.locator('#case').press('Enter');page.wait_for_function("!document.getElementById('workspace').hidden");page.wait_for_function("document.getElementById('status').textContent==='Current case state loaded.'")
    assert page.locator('#token').input_value()==''
    assert page.locator('.card').count()==2
    assert 'not confirmed delivered' in page.locator('#tracking-summary').inner_text()
    assert 'Delivery estimate: not confirmed' in page.locator('#shipments').inner_text()
    if cfg['scenario']=='customer':
        assert 'Internal:' not in page.locator('#messages').inner_text()
        page.locator('#message').fill('<img src=x onerror="window.pwned=true"> Where is my parcel?')
        page.locator('#customer-message button').click();page.wait_for_function("document.getElementById('messages').textContent.includes('<img src=x')")
        assert not page.evaluate('Boolean(window.pwned)')
        assert page.locator('#takeover').is_disabled()
    elif cfg['scenario']=='manual':
        assert 'partial' in page.locator('#history-warning').inner_text()
        page.locator('#queue').click();page.wait_for_function("document.getElementById('deliveries').textContent.includes('queued')")
        page.locator('#dispatch').click();page.wait_for_function("document.getElementById('deliveries').textContent.includes('accepted')")
        assert 'customer delivered: not confirmed' in page.locator('#deliveries').inner_text()
        page.locator('#close').click();page.wait_for_function("document.getElementById('status').textContent==='Current case state loaded.'")
        if cfg.get('screenshot'):page.screenshot(path=cfg['screenshot'],full_page=True)
    elif cfg['scenario']=='stop':
        page.locator('#queue').click();page.wait_for_function("document.getElementById('deliveries').textContent.includes('queued')")
        stop=bridge('/v1/support/consent',{'method':'POST','headers':{'Content-Type':'application/json','Authorization':'Bearer '+cfg['customer']},'body':json.dumps({'case_id':'support_case','sender_id':'sender_one','channel':'email','purpose':'*','state':'withdrawn','event_id':'browser_stop','source_version':1,'effective_at':cfg['at'],'source_ref':'verified_stop'})})
        assert stop['status']==200
        page.locator('#dispatch').click();page.wait_for_function("document.getElementById('status').textContent==='DELIVERY_SUPPRESSED'")
        assert page.locator('#workspace').is_hidden()
        assert page.locator('#deliveries').inner_text()==''
    elif cfg['scenario']=='late':
        page.evaluate("window.delayPath='/v1/support/context'");page.locator('#refresh').click();page.wait_for_function('typeof window.finishDelay === "function"')
        page.locator('#signout').click();page.wait_for_function("document.getElementById('status').textContent==='Signed out.'");page.evaluate('window.finishDelay()');page.wait_for_timeout(100)
        assert page.locator('#workspace').is_hidden()
        assert page.locator('#shipments').inner_text()==''
        assert page.locator('#ownership').text_content()==''
        assert page.locator('#tracking-summary').text_content()==''
    assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth')
    if cfg['scenario']!='late':page.locator('#signout').click();page.wait_for_function("document.getElementById('status').textContent==='Signed out.'")
    assert page.locator('#workspace').is_hidden()
    assert not page.evaluate('window.storageAccess')
    assert not network
    browser.close()
print(json.dumps({'passed':True,'scenario':cfg['scenario'],'direct_browser_network':network,'bridge_to_actual_api':True}))
