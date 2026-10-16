"""Synthetic browser-component boundary; NOT a served-browser qualification."""
import json
import os
import re
from pathlib import Path
from playwright.sync_api import sync_playwright

cfg = json.loads(os.environ['RIFARE_TEST_INPUT'])
assets = Path(__file__).resolve().parents[2] / 'apps/commerce-api'
html = re.sub(r'<script[^>]*>.*?</script>|<link[^>]*>', '', (assets / 'status.html').read_text())
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ['RIFARE_TEST_BROWSER'], headless=True, args=['--no-sandbox'])
    page = browser.new_page()
    network = []
    page.route('**/*', lambda route: (network.append(route.request.url), route.abort()))
    page.set_content(html)
    page.add_style_tag(content=(assets / 'status.css').read_text())
    page.evaluate('''cfg => {
      window.fixture=cfg;window.calls=[];window.storageCalls=[];
      for(const name of ['localStorage','sessionStorage'])Object.defineProperty(window,name,{get:()=>{
        window.storageCalls.push(name);return {length:0,setItem:()=>window.storageCalls.push('write'),getItem:()=>null};
      }});
      window.fetch=async (url,options)=>{
        window.calls.push({url,method:options.method});
        if (url==='/v1/session/logout')return {ok:true,json:async()=>({revoked:true})};
        if (url==='/v1/orders/'+cfg.other+'/status')return {ok:false,status:404};
        if (url!=='/v1/orders/'+cfg.order+'/status')throw new Error('UNEXPECTED_NETWORK_REQUEST');
        return {ok:true,json:async()=>structuredClone(cfg.facts)};
      };
    }''', cfg)
    page.add_script_tag(content=(assets / 'status-client.js').read_text())
    page.get_by_label('Operator or verified customer session').fill(cfg['bearer'])
    page.get_by_label('Order resource ID', exact=True).fill(cfg['order'])
    page.get_by_label('Order resource ID', exact=True).press('Enter')
    result = {'model_calls': 0, 'external_requests': 0, 'evidence_kind': 'browser_component_synthetic'}
    if cfg['scenario'] == 'stale':
        page.wait_for_function("document.getElementById('message').textContent.includes('Current source unavailable')")
        assert not page.locator('#result').is_visible()
        result['previous_facts_visible'] = False
    else:
        page.get_by_role('heading', name='Order ORD-1001', exact=True).wait_for()
        assert 'in_transit' in page.locator('#result').inner_text()
        assert 'Synthetic fixture snapshot' in page.locator('#result').inner_text()
        result.update(order='ORD-1001', input_cleared=page.locator('#token').input_value() == '', stored_token=page.evaluate('window.storageCalls.length > 0'))
        assert result['input_cleared']
        if cfg['scenario'] == 'denied':
            page.get_by_label('Order resource ID', exact=True).fill(cfg['other'])
            page.get_by_label('Order resource ID', exact=True).press('Enter')
            page.wait_for_function("document.getElementById('message').textContent.includes('Not permitted')")
            assert not page.locator('#result').is_visible()
            result['previous_facts_visible'] = False
        if cfg['scenario'] == 'logout':
            page.get_by_role('button', name='Sign out and clear').click()
            page.wait_for_function("document.getElementById('message').textContent.includes('Signed out')")
            assert not page.locator('#result').is_visible()
            result.update(previous_facts_visible=False,logout_requested=page.evaluate("window.calls.some(c=>c.url==='/v1/session/logout')"))
        if cfg['scenario'] == 'injection':
            assert '<img' in page.locator('#result').inner_text()
            assert not page.evaluate('Boolean(window.injected)')
            assert page.locator('#result img').count() == 0
            result['executed_script'] = False
    calls = page.evaluate('window.calls')
    assert len(calls) > 0
    assert all(c['url'].startswith('/v1/orders/') or c['url']=='/v1/session/logout' for c in calls)
    assert network == [], network
    assert page.evaluate('document.activeElement.id') == 'message'
    browser.close()
assert 'localStorage' not in (assets / 'status-client.js').read_text()
assert 'sessionStorage' not in (assets / 'status-client.js').read_text()
print(json.dumps(result))
