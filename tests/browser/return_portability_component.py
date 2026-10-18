"""Local browser component plus real loopback HTTP service; no browser egress."""
import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

cfg = json.loads(os.environ['RIFARE_TEST_INPUT'])
assert re.fullmatch(r'http://127\.0\.0\.1:[0-9]+', cfg['url'])
assert cfg['phase'] in ('request', 'notification', 'late')
assets = Path(__file__).resolve().parents[2] / 'apps/commerce-api'
html = re.sub(r'<script[^>]*>.*?</script>|<link[^>]*>', '', (assets / 'return-portability.html').read_text())
allowed = {
    '/v1/return-portability/context', '/v1/returns/quote', '/v1/returns/prepare',
    '/v1/returns/revise', '/v1/execution/approve', '/v1/execution/execute',
    '/v1/execution/preview', '/v1/resolutions/allocate', '/v1/resolutions/quote',
    '/v1/resolutions/dispatch', '/v1/resolutions/reconcile',
    '/v1/support/refund-message-preview', '/v1/support/queue',
    '/v1/support/dispatch', '/v1/support/reconcile'
}
network, calls = [], []

def bridge(path, opts):
    assert path in allowed and opts['method'] == 'POST'
    credential = cfg['reviewer_token'] if path == '/v1/execution/approve' else cfg['staff_token']
    assert opts['headers']['Authorization'] == 'Bearer ' + credential
    request = urllib.request.Request(cfg['url'] + path, data=opts['body'].encode(), headers=opts['headers'], method='POST')
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            result = {'status': response.status, 'value': json.load(response)}
    except urllib.error.HTTPError as error:
        result = {'status': error.code, 'value': json.load(error)}
    calls.append({'path': path, 'input': json.loads(opts['body']), 'result': result})
    return result

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 390, 'height': 844})
    page.route('**/*', lambda route: (network.append(route.request.url), route.abort()))
    page.set_content(html)
    page.add_style_tag(content=(assets / 'return-portability.css').read_text())
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
    page.add_script_tag(content=(assets / 'return-portability-client.js').read_text())
    for name, value in [('session', cfg['staff_token']), ('reviewer', cfg['reviewer_token']), ('case-id', cfg['case_id']), ('link-id', cfg['link_id']), ('sender-id', 'woo_sender')]:
        page.locator('#' + name).fill(value)

    def click(name):
        page.locator('#' + name).click()
        page.wait_for_function('!document.getElementById("load").disabled')
        assert not page.locator('#notice').evaluate('(e)=>e.classList.contains("error")'), page.locator('#notice').text_content()

    if cfg['phase'] == 'late':
        page.evaluate('window.delayResponse=true')
        page.locator('#load').click()
        page.wait_for_function('typeof window.releaseResponse==="function"')
        page.locator('#case-id').fill('changed-case')
        page.evaluate('window.releaseResponse()')
        page.wait_for_function('window.delayedResponseDelivered===true&&!document.getElementById("load").disabled')
        assert page.locator('#overview').is_hidden()
        assert page.locator('#references').text_content() == ''
        assert page.locator('#submit-return').is_disabled()
    else:
        click('load')
        assert page.locator('#platform').text_content() == 'woocommerce'
        if cfg['phase'] == 'request':
            click('preview-return')
            click('approve-return')
            # Reload must recover the same existing approval instead of requiring
            # another approval or creating another business request.
            approved = [call for call in calls if call['path'] == '/v1/execution/approve'][-1]['result']['value']
            click('load')
            assert not page.locator('#submit-return').is_disabled()
            click('submit-return')
            execution = [call for call in calls if call['path'] == '/v1/execution/execute'][-1]
            assert execution['input']['approval_id'] == approved['id']
            assert 'Local RMA; no native return ID.' in page.locator('#return-result').text_content()
            click('preview-refund')
            click('approve-refund')
            refund_approval = [call for call in calls if call['path'] == '/v1/execution/approve'][-1]['result']['value']
            click('load')
            click('authorize-refund')
            assert [call for call in calls if call['path'] == '/v1/execution/execute'][-1]['input']['approval_id'] == refund_approval['id']
            click('dispatch-refund')
            assert page.locator('#payment-state').text_content() == 'accepted'
            click('preview-message')
            assert 'Settlement has not been confirmed' in page.locator('#message-preview').text_content()
            assert not any(call['path'] == '/v1/support/queue' for call in calls)
        else:
            assert page.locator('#payment-state').text_content() == 'settled'
            click('preview-message')
            assert 'No live payment was made' in page.locator('#message-preview').text_content()
            click('queue-message')
            click('send-message')
            click('reconcile-message')
            assert 'Customer delivery is not confirmed' in page.locator('#message-result').text_content()
            assert len([call for call in calls if call['path'] == '/v1/support/dispatch']) == 1
        assert all(call['result']['status'] == 200 for call in calls)
        assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth'), 'mobile overflow'
        if cfg.get('screenshot'):
            page.screenshot(path=cfg['screenshot'], full_page=True)
        before = len(calls)
        page.locator('#session').fill(cfg['staff_token'] + '-changed')
        assert page.locator('#overview').is_hidden()
        assert page.locator('#references').text_content() == ''
        assert page.locator('#queue-message').is_disabled()
        assert len(calls) == before
    page.evaluate("window.dispatchEvent(new Event('pagehide'))")
    assert page.locator('#session').input_value() == '' and page.locator('#reviewer').input_value() == ''
    assert not page.evaluate('window.storageAccess') and not network
    browser.close()
print(json.dumps({'passed': True, 'phase': cfg['phase'], 'requests': [call['path'] for call in calls], 'direct_browser_network': network, 'evidence_kind': 'component_plus_real_local_http'}))
