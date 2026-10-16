"""Exception UI with a real local API bridge; not direct served-browser evidence."""
import json, os, re, urllib.request, urllib.error
from pathlib import Path
from playwright.sync_api import sync_playwright
cfg=json.loads(os.environ['RIFARE_TEST_INPUT']); assert re.fullmatch(r'http://127\.0\.0\.1:[0-9]+',cfg['url'])
assets=Path(__file__).resolve().parents[2]/'apps/commerce-api'; network=[]; requests=[]
def http(path, options):
    assert path=='/v1/exceptions' or re.fullmatch(r'/v1/exceptions/[A-Za-z0-9_-]+/(reconcile|reauthorize)',path) or path in ('/v1/session/logout','/v1/work-release','/v1/work-grants','/v1/worker/claim')
    data=options.get('body'); req=urllib.request.Request(cfg['url']+path,data=None if data is None else data.encode(),headers=options['headers'],method=options['method'])
    try:
        with urllib.request.urlopen(req,timeout=5) as r: return r.status,json.load(r)
    except urllib.error.HTTPError as error: return error.code,json.load(error)
def bridge(path,options):
    status,result=http(path,options); requests.append({'path':path,'status':status})
    if cfg['scenario']=='injection' and path=='/v1/exceptions' and status==200: next(item for item in result['items'] if item['operation_id']==cfg['unknown'])['reason']='<img src=x onerror="window.injected=1">'
    return {'status':status,'result':result}
def post(path,data,bearer):
    status,result=http(path,{'method':'POST','headers':{'authorization':'Bearer '+bearer,'content-type':'application/json'},'body':json.dumps(data)})
    assert status in (200,201); return result
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('RIFARE_TEST_BROWSER','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':390 if cfg['scenario']=='mobile' else 1000,'height':900})
    page.route('**/*',lambda r:(network.append(r.request.url),r.abort()))
    page.set_content(re.sub(r'<script[^>]*>.*?</script>|<link[^>]*>','',(assets/'exceptions.html').read_text()))
    page.add_style_tag(content=(assets/'configuration.css').read_text());page.add_style_tag(content=(assets/'exceptions.css').read_text());page.expose_function('requestBridge',bridge)
    page.evaluate('''() => { window.storageTouched=false;for(const key of ['localStorage','sessionStorage'])Object.defineProperty(window,key,{get(){window.storageTouched=true;throw new Error('DENIED');}});window.fetch=async(path,options)=>{const r=await window.requestBridge(path,options);return {ok:r.status>=200&&r.status<300,json:async()=>r.result};};}''')
    page.add_script_tag(content=(assets/'exceptions-client.js').read_text());page.get_by_label('Session token',exact=True).fill(cfg['bearer']);page.get_by_role('button',name='Load exceptions',exact=True).click()
    page.wait_for_function("document.getElementById('notice').textContent==='Current server state loaded.'")
    card=page.locator('article[data-operation="'+cfg['unknown']+'"]');assert card.get_by_role('heading',name='Unknown outcome — reconcile first').count()==1
    assert page.get_by_role('heading',name='Known failure',exact=True).count()==1
    assert card.get_by_role('button',name='Retry disabled',exact=True).is_disabled()
    assert page.locator('#token').input_value()==''
    if cfg['scenario']=='reconcile':
        card.get_by_role('button',name='Reconcile without resending',exact=True).click();page.wait_for_function('(id)=>!document.querySelector("article[data-operation="+id+"]")',arg=cfg['unknown'])
    if cfg['scenario']=='owner':
        post('/v1/work-release',{'case_id':'case_one'},cfg['owner']);grant=post('/v1/work-grants',{'case_id':'case_one','lifetime_ms':100000},cfg['worker'])
        post('/v1/worker/claim',{'lease_ms':10000},grant['token']);page.get_by_role('button',name='Refresh',exact=True).click();page.wait_for_function("document.querySelector('#queue').textContent.includes('Owner: worker')")
        assert 'Generation: 3' in card.inner_text()
    if cfg['scenario']=='injection':
        assert '<img' in card.inner_text();assert page.locator('#queue img').count()==0;assert not page.evaluate('Boolean(window.injected)')
    if cfg['scenario']=='mobile': assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+2')
    if cfg['scenario']=='logout-race':
        page.evaluate("""() => {const original=window.fetch;window.fetch=async(path,options)=>{const response=await original(path,options);if(path==='/v1/exceptions'){window.heldReady=true;await new Promise(resolve=>window.releaseStale=resolve);}return response;};}""")
        page.get_by_role('button',name='Refresh',exact=True).click();page.wait_for_function('window.heldReady===true')
        page.get_by_role('button',name='Sign out and clear',exact=True).click();page.wait_for_function("document.getElementById('notice').textContent==='Signed out locally.'")
        page.evaluate('window.releaseStale()');page.wait_for_timeout(100)
        assert page.locator('#queue').inner_text()==''

    if cfg.get('screenshot'): page.screenshot(path=cfg['screenshot'],full_page=True)
    if cfg['scenario']!='logout-race': page.get_by_role('button',name='Sign out and clear',exact=True).click();page.wait_for_function("document.getElementById('notice').textContent==='Signed out locally.'")
    assert page.locator('#queue').inner_text()=='';assert not page.evaluate('window.storageTouched');assert not network;browser.close()
print(json.dumps({'scenario':cfg['scenario'],'passed':True,'requests':requests,'direct_browser_network':network}))
