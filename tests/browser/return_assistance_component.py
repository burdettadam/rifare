"""Browser components bridged to the real local HTTP service, without egress."""
import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

cfg = json.loads(os.environ['RIFARE_TEST_INPUT'])
assert re.fullmatch(r'http://127\.0\.0\.1:[0-9]+', cfg['url'])
assert cfg['scenario'] in ('risk', 'route', 'prevention', 'pack', 'late', 'economics')
assets = Path(__file__).resolve().parents[2] / 'apps/commerce-api'
html = re.sub(r'<script[^>]*>.*?</script>|<link[^>]*>', '', (assets / 'return-assistance.html').read_text())
allowed = {'risk/assess', 'risk/appeal', 'destinations/evaluate', 'destinations/select', 'prevention/preview', 'prevention/confirm', 'packs/get', 'economics/report'}
network, calls = [], []

def bridge(path, opts):
    assert path.startswith('/v1/return-depth/')
    operation = path.removeprefix('/v1/return-depth/')
    assert operation in allowed and opts['method'] == 'POST'
    customer = operation in ('risk/appeal', 'prevention/confirm')
    assert opts['headers']['authorization'] == 'Bearer ' + cfg['customer_token' if customer else 'staff_token']
    request = urllib.request.Request(cfg['url'] + path, data=opts['body'].encode(), headers=opts['headers'], method='POST')
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            result = {'status': response.status, 'value': json.load(response)}
    except urllib.error.HTTPError as error:
        result = {'status': error.code, 'value': json.load(error)}
    calls.append({'path': path, 'body': json.loads(opts['body']), 'result': result})
    return result

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 390, 'height': 844})
    page.route('**/*', lambda route: (network.append(route.request.url), route.abort()))
    page.set_content(html)
    page.add_style_tag(content=(assets / 'return-assistance.css').read_text())
    page.expose_function('bridge', bridge)
    page.evaluate('''() => {
      window.storageAccess=false;
      for(const name of ['localStorage','sessionStorage'])Object.defineProperty(window,name,{get:()=>{window.storageAccess=true;throw Error('NO_STORAGE')}});
      window.fetch=async(path,opts)=>{
        const result=await window.bridge(path,{method:opts.method,headers:opts.headers,body:opts.body});
        if(window.delayResponse){await new Promise(resolve=>window.releaseResponse=resolve);window.delayedResponseDelivered=true;}
        return {ok:result.status>=200&&result.status<300,json:async()=>result.value};
      };
    }''')
    page.add_script_tag(content=(assets / 'return-assistance-client.js').read_text())
    page.locator('#staff-token').fill(cfg['staff_token'])
    page.locator('#customer-token').fill(cfg['customer_token'])
    scenario = cfg['scenario']
    group = 'pack' if scenario == 'late' else scenario
    if scenario == 'risk':
        page.locator('#risk-case').fill(cfg['case_id'])
        page.locator('#risk-quote').fill(cfg['quote_id'])
        page.locator('[data-action=risk-assess]').click()
    elif scenario == 'route':
        page.locator('#route-request').fill(cfg['request_id'])
        page.locator('[data-action=route-evaluate]').click()
    elif scenario == 'prevention':
        for name in ('case', 'line', 'variant'):
            page.locator('#prevention-' + name).fill(cfg[name + '_id'])
        page.locator('[data-action=prevention-preview]').click()
    elif scenario in ('pack', 'late'):
        page.locator('#pack-id').fill(cfg['pack_id'])
        page.locator('[data-action=pack-read]').click()
    else:
        page.locator('#economics-cohort').fill(cfg['cohort_id'])
        page.locator('[data-action=economics-read]').click()
    page.wait_for_function('(g)=>!document.getElementById(g+"-result").hidden', arg=group)
    assert calls[-1]['result']['status'] == 200
    assert json.loads(page.locator('#' + group + '-raw').text_content()) == calls[-1]['result']['value']
    summary = page.locator('#' + group + '-summary').inner_text()
    assert not page.locator('#' + group + '-result details').evaluate('(e)=>e.open')
    if scenario == 'risk':
        assert 'Uncertainty' in summary and 'Automatic denial' in summary and 'No' in summary
        assert 'Policy decision' in summary and 'allow' in summary
        page.locator('[data-action=risk-appeal]').click()
        page.wait_for_function('document.getElementById("risk-raw").textContent.includes("human_review_requested")')
        assert 'Your published policy rights are unchanged' in page.locator('#risk-summary').inner_text()
        assert calls[-1]['path'].endswith('/risk/appeal')
        assert 'assessment' not in calls[-1]['result']['value']
    elif scenario == 'route':
        assert 'fragile-destination' in summary and '150 minor units' in summary
        assert 'cheap-uncontracted' in summary and 'OWNERSHIP_UNQUALIFIED' in summary
        page.locator('#route-destination').fill('fragile-destination')
        page.locator('[data-action=route-select]').click()
        page.wait_for_function('!document.getElementById("route-result").hidden')
        assert calls[-1]['result']['value']['revision'] == 1
        assert calls[-1]['body']['expected_revision'] == 0
        assert calls[-1]['result']['value']['execution_authorized'] is False
    elif scenario == 'prevention':
        assert 'Original total' in summary and 'New total' in summary and '4000 minor units' in summary
        assert 'basic × 1' in summary and 'equal × 1' in summary
        exact_preview = calls[-1]['result']['value']
        page.locator('[data-action=prevention-confirm]').click()
        page.wait_for_function('document.getElementById("prevention-raw").textContent.includes("confirmation_digest")')
        assert calls[-1]['body'] == {key: exact_preview[key] for key in ('case_id', 'quote_id', 'quote_digest')}
        assert calls[-1]['result']['value']['paid_goods_changed'] is False
        assert calls[-1]['result']['value']['separate_staff_approval_required'] is True
        assert 'Confirmation recorded' in page.locator('#prevention-summary').inner_text()
    elif scenario in ('pack', 'late'):
        assert 'handle-return' in summary and 'warm' in summary and 'en-US' in summary
        assert calls[-1]['body'] == {'pack_id': cfg['pack_id'], 'revision': None}
    else:
        assert 'Unknown' in summary and 'Profitability verified' in summary and 'No' in summary
        assert calls[-1]['result']['value']['declared_contribution_minor'] is None
    if scenario == 'risk':
        before = len(calls)
        page.locator('#risk-case').fill('changed-case')
        assert page.locator('#risk-id').input_value() == '' and page.locator('#risk-digest').input_value() == ''
        page.locator('[data-action=risk-evidence]').click()
        page.wait_for_function('document.getElementById("risk-status").textContent.includes("Enter assessment id")')
        assert len(calls) == before
    elif scenario == 'prevention':
        before = len(calls)
        page.locator('#prevention-variant').fill('cheaper')
        assert page.locator('#prevention-quote').input_value() == '' and page.locator('#prevention-digest').input_value() == ''
        page.locator('[data-action=prevention-confirm]').click()
        page.wait_for_function('document.getElementById("prevention-status").textContent.includes("Enter edit quote id")')
        assert len(calls) == before
    if scenario == 'late':
        page.evaluate('window.delayResponse=true')
        page.locator('[data-action=pack-read]').click()
        page.wait_for_function('typeof window.releaseResponse==="function"')
        page.locator('#pack-id').fill('changed-pack')
        assert page.locator('#pack-result').is_hidden()
        page.evaluate('window.releaseResponse()')
        page.wait_for_function('window.delayedResponseDelivered===true')
        assert page.locator('#pack-result').is_hidden()
        assert page.locator('#pack-raw').text_content() == ''
    assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth'), 'mobile overflow'
    if cfg.get('screenshot'):
        page.screenshot(path=cfg['screenshot'], full_page=True)
    assert not page.evaluate('window.storageAccess') and not network
    assert all('/dispatch' not in call['path'] for call in calls)
    count = len(calls)
    page.locator('#customer-token').fill(cfg['customer_token'] + '-changed')
    for name in ('risk', 'route', 'prevention', 'pack', 'economics'):
        assert page.locator('#' + name + '-result').is_hidden()
        assert page.locator('#' + name + '-raw').text_content() == ''
    assert len(calls) == count
    page.evaluate("window.dispatchEvent(new Event('pagehide'))")
    assert page.locator('#staff-token').input_value() == '' and page.locator('#customer-token').input_value() == ''
    browser.close()
print(json.dumps({'passed': True, 'scenario': scenario, 'requests': [call['path'] for call in calls], 'direct_browser_network': network}))
