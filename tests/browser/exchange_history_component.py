"""Staff exchange components backed by the actual loopback HTTP service.

The native runner supplies already qualified synthetic fixtures. No successful
API response is fabricated here; the only delayed response is an actual source
read used to exercise stale-result invalidation.
"""
import json, os, re, urllib.request, urllib.error
from pathlib import Path
from playwright.sync_api import sync_playwright

cfg = json.loads(os.environ['RIFARE_TEST_INPUT'])
assert re.fullmatch(r'http://127\.0\.0\.1:[0-9]+', cfg['url'])
assert cfg['scenario'] in ('lineage', 'currency', 'instant', 'late')
assets = Path(__file__).resolve().parents[2] / 'apps/commerce-api'
html = re.sub(r'<script[^>]*>.*?</script>|<link[^>]*>', '', (assets / 'exchange-history.html').read_text())
allowed = {
    '/v1/exchange-lineage/materialize', '/v1/exchange-lineage/node',
    '/v1/exchange-money/bind', '/v1/exchange-money/currency',
    '/v1/exchange-money/refresh-fee', '/v1/exchange-money/fees',
    '/v1/instant-exchanges/authorize-quote', '/v1/instant-exchanges/reauthorize-quote',
    '/v1/instant-exchanges/capture-quote', '/v1/instant-exchanges/cancel-quote',
    '/v1/instant-exchanges/operation', '/v1/instant-exchanges/dispatch',
    '/v1/instant-exchanges/reconcile',
}
network, calls = [], []

def bridge(path, opts):
    assert path in allowed
    assert opts['method'] == 'POST'
    assert opts['headers']['authorization'] == 'Bearer ' + cfg['token']
    body = json.loads(opts['body'])
    request = urllib.request.Request(cfg['url'] + path, data=opts['body'].encode(), headers=opts['headers'], method='POST')
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            result = {'status': response.status, 'value': json.load(response)}
    except urllib.error.HTTPError as error:
        result = {'status': error.code, 'value': json.load(error)}
    calls.append({'path': path, 'body': body, 'result': result})
    return result

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 390, 'height': 844})
    page.route('**/*', lambda route: (network.append(route.request.url), route.abort()))
    page.set_content(html)
    page.add_style_tag(content=(assets / 'exchange-history.css').read_text())
    page.expose_function('bridge', bridge)
    page.evaluate('''() => {
      window.storageAccess=false;
      for(const name of ['localStorage','sessionStorage'])Object.defineProperty(window,name,{get:()=>{window.storageAccess=true;throw Error('NO_STORAGE')}});
      window.fetch=async(path,opts)=>{
        const result=await window.bridge(path,{method:opts.method,headers:opts.headers,body:opts.body});
        if(path==='/v1/exchange-money/currency'&&window.delayCurrency){await new Promise(resolve=>window.releaseResponse=resolve);window.delayedResponseDelivered=true;}
        return {ok:result.status>=200&&result.status<300,json:async()=>result.value};
      };
    }''')
    page.add_script_tag(content=(assets / 'exchange-history-client.js').read_text())
    page.locator('#operator-token').fill(cfg['token'])
    if cfg['scenario'] == 'lineage':
        section = 'lineage'
        page.locator('#lineage-operation-id').fill(cfg['operation_id'])
        page.locator('#materialize-lineage').click()
        expected_path = '/v1/exchange-lineage/materialize'
        expected_body = {'operation_id': cfg['operation_id']}
    elif cfg['scenario'] in ('currency', 'late'):
        section = 'money'
        page.locator('#money-allocation-id').fill(cfg['allocation_id'])
        page.locator('#bind-money').click()
        expected_path = '/v1/exchange-money/bind'
        expected_body = {'allocation_id': cfg['allocation_id']}
    else:
        section = 'instant'
        for field in ('exchange_quote_id', 'exchange_quote_digest', 'consent_id'):
            page.locator('#' + field.replace('_', '-')).fill(cfg[field])
        page.locator('#prepare-authorization').click()
        expected_path = '/v1/instant-exchanges/authorize-quote'
        expected_body = {key: cfg[key] for key in ('exchange_quote_id', 'exchange_quote_digest', 'consent_id')}
    page.wait_for_function('(name)=>!document.getElementById(name+"-result").hidden', arg=section)
    assert calls[-1]['path'] == expected_path and calls[-1]['body'] == expected_body
    assert calls[-1]['result']['status'] in (200, 201, 202)
    displayed = json.loads(page.locator('#' + section + '-raw').text_content())
    assert displayed == calls[-1]['result']['value'], 'raw source details must preserve the actual HTTP response'
    summary = page.locator('#' + section + '-summary').inner_text()
    status = page.locator('#' + section + '-status').inner_text()
    expected = cfg.get('expected', {})
    if expected.get('stage'):
        assert expected['stage'] in status or expected['stage'] in summary
    if expected.get('currency'):
        assert expected['currency'] in summary
    if expected.get('minor') is not None:
        assert '(' + str(expected['minor']) + ' minor units)' in summary
    for value in expected.get('contains', []):
        assert value in summary or value in status
    if cfg['scenario'] == 'instant':
        assert page.locator('#instant-next').is_visible()
        assert page.locator('#instant-next a').get_attribute('href') == '/execution'
        assert 'Quote prepared for review' in status
        assert not any(call['path'].endswith('/dispatch') for call in calls), 'preparing a quote must not dispatch'
    if cfg.get('screenshot'):
        page.screenshot(path=cfg['screenshot'], full_page=True)
    if cfg['scenario'] == 'late':
        page.evaluate('window.delayCurrency=true')
        page.locator('#read-money').click()
        page.wait_for_function('typeof window.releaseResponse === "function"')
        page.locator('#money-allocation-id').fill('changed-allocation')
        assert page.locator('#money-result').is_hidden()
        assert page.locator('#money-raw').text_content() == ''
        page.evaluate('window.releaseResponse()')
        page.wait_for_function('window.delayedResponseDelivered===true')
        assert page.locator('#money-result').is_hidden(), 'late data must not repopulate results for changed inputs'
        assert page.locator('#money-raw').text_content() == ''
        assert 'Inputs changed' in page.locator('#money-status').inner_text()
        assert calls[-1]['path'] == '/v1/exchange-money/currency'
        assert calls[-1]['body'] == {'allocation_id': cfg['allocation_id']}
    assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth'), 'mobile page overflow'
    assert not page.evaluate('window.storageAccess')
    assert not network
    count = len(calls)
    page.locator('#operator-token').fill(cfg['token'] + '-changed')
    for group in ('lineage', 'money', 'fees', 'instant'):
        assert page.locator('#' + group + '-result').is_hidden()
        assert page.locator('#' + group + '-raw').text_content() == ''
    assert len(calls) == count, 'changing input must not dispatch another request'
    page.evaluate("window.dispatchEvent(new Event('pagehide'))")
    assert page.locator('#operator-token').input_value() == ''
    browser.close()
print(json.dumps({'passed': True, 'scenario': cfg['scenario'], 'requests': [call['path'] for call in calls], 'direct_browser_network': network}))
