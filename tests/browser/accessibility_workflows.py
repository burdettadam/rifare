"""Focused rendered keyboard/DOM observations with an explicit real local API bridge.

This is neither a human screen-reader observation nor target-stack qualification.
"""
import json
import os
from datetime import datetime, timezone
from pathlib import Path
import re
import urllib.error
import urllib.request
from playwright.sync_api import sync_playwright

cfg = json.loads(os.environ['RIFARE_TEST_INPUT'])
if 'url' in cfg:
    assert re.fullmatch(r'http://127\.0\.0\.1:[0-9]+', cfg['url'])
assets = Path(__file__).resolve().parents[2] / 'apps/commerce-api'
calls, network, observations = [], [], []
pages = ['status', 'returns', 'order-edits', 'execution', 'support', 'exceptions']
allowed = {
    '/v1/session/logout', '/v1/execution/preview', '/v1/execution/approve', '/v1/execution/execute',
    '/v1/returns/form', '/v1/returns/status', '/v1/returns/quote', '/v1/returns/prepare',
    '/v1/edit-workflows/open', '/v1/edit-workflows/status', '/v1/edit-workflows/quote',
    '/v1/order-edits/prepare', '/v1/order-edits/status', '/v1/order-edits/dispatch', '/v1/order-edits/release',
    '/v1/support/context', '/v1/support/takeover', '/v1/exceptions',
}

def bridge(path, options):
    assert path in allowed or re.fullmatch(r'/v1/orders/res_[A-Za-z0-9_-]+/status', path) or re.fullmatch(r'/v1/exceptions/[A-Za-z0-9_-]+/reconcile', path)
    assert 'url' in cfg, 'validation must not submit an invalid form'
    body = options.get('body')
    request = urllib.request.Request(cfg['url'] + path, data=body.encode() if body else None,
                                    headers=options.get('headers', {}), method=options.get('method', 'GET'))
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            status, value = response.status, json.load(response)
    except urllib.error.HTTPError as error:
        status, value = error.code, json.load(error)
    calls.append({'path': path, 'status': status})
    return {'status': status, 'value': value}

def focused(page, selector):
    page.wait_for_function('(s)=>document.querySelector(s)===document.activeElement', arg=selector)

def tab_to(page, selector, limit=60):
    for _ in range(limit):
        page.keyboard.press('Tab')
        if page.locator(selector).evaluate('(e)=>e===document.activeElement'):
            return
    raise AssertionError('KEYBOARD_UNREACHABLE: ' + selector)

def enter(page, selector):
    tab_to(page, selector)
    page.keyboard.press('Enter')

def type_text(page, selector, value):
    tab_to(page, selector)
    page.keyboard.press('Control+A')
    page.keyboard.type(value)

def audit(page, name):
    assert page.locator('html').get_attribute('lang') == 'en'
    assert page.get_by_role('main').count() == 1
    assert page.get_by_role('heading', level=1).count() == 1
    assert page.get_by_role('link', name='Skip to main content', exact=True).count() == 1
    missing = page.locator('input:not([type=hidden]),select,textarea').evaluate_all('''els=>els.filter(e=>
        !(e.labels?.length||e.getAttribute('aria-label')||e.getAttribute('aria-labelledby'))).map(e=>e.id)''')
    assert missing == [], ('UNNAMED_INPUT', missing)
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'), 'MOBILE_OVERFLOW'
    observations.append({'screen': name, 'landmarks_labels_mobile': True})

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('RIFARE_TEST_BROWSER', '/usr/bin/chromium'),
                                headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 360, 'height': 800})
    page.set_default_timeout(5000)
    if 'at' in cfg:
        page.clock.set_fixed_time(datetime.fromtimestamp(cfg['at'] / 1000, tz=timezone.utc))
    page.route('**/*', lambda route: (network.append(route.request.url), route.abort()))
    page.route_web_socket('**/*', lambda route: (network.append('websocket'), route.close()))
    page.expose_function('localBridge', bridge)

    def mount(name, client=True):
        html = (assets / (name + '.html')).read_text()
        styles = re.findall(r'<link[^>]+href="/([^"]+\.css)"[^>]*>', html)
        assert '/accessibility-client.js' in html and 'accessibility.css' in styles
        page.set_content(re.sub(r'<script[^>]*>.*?</script>|<link[^>]*>', '', html))
        for style in styles:
            page.add_style_tag(content=(assets / style).read_text())
        page.evaluate('''() => {
            window.storageTouched=false;
            for(const key of ['localStorage','sessionStorage']) Object.defineProperty(window,key,{configurable:true,get(){window.storageTouched=true;throw Error('PRIVATE_STORAGE_DENIED');}});
            window.fetch=async(path,options={})=>{const r=await window.localBridge(path,options);return {ok:r.status>=200&&r.status<300,json:async()=>r.value};};
        }''')
        page.add_script_tag(content=(assets / 'accessibility-client.js').read_text())
        if client:
            page.add_script_tag(content=(assets / (name + '-client.js')).read_text())
        audit(page, name)
        page.keyboard.press('Tab')
        focused(page, '.skip-link')
        page.keyboard.press('Enter')
        focused(page, '#main-content')

    scenario = cfg['scenario']
    if scenario == 'form-errors':
        for name in pages:
            mount(name, client=False)
            form = page.locator('form').first
            first = form.locator('input[required]').first
            field_id = first.get_attribute('id')
            submit = form.locator('button:not([type=button])').first
            submit.focus()
            page.keyboard.press('Enter')
            focused(page, '#' + field_id)
            assert first.get_attribute('aria-invalid') == 'true'
            error_id = first.get_attribute('aria-describedby').split()[-1]
            assert page.locator('#' + error_id).inner_text().strip()
            assert form.get_attribute('aria-describedby')
            first.press('a')
            assert first.get_attribute('aria-invalid') is None
            assert page.locator('#' + error_id).count() == 0
        assert calls == []
    elif scenario == 'faults':
        mount('execution', client=False)
        page.locator('#review').evaluate('(e)=>e.hidden=false')
        assert page.get_by_role('button', name='Approve this preview', exact=True).count() == 1
        page.locator('#approval button').evaluate('(e)=>e.textContent=""')
        assert page.get_by_role('button', name='Approve this preview', exact=True).count() == 0
        observations.append({'injected_fault': 'missing_approval_name', 'detected': True})
        page.locator('#approval button').evaluate('(e)=>{e.textContent="Approve this preview";e.tabIndex=-1;}')
        try:
            tab_to(page, '#approval button', limit=25)
        except AssertionError as error:
            assert 'KEYBOARD_UNREACHABLE' in str(error)
        else:
            raise AssertionError('lost keyboard access was not detected')
        observations.append({'injected_fault': 'approval_removed_from_tab_order', 'detected': True})
    else:
        mount(scenario)
        token_field = '#session' if scenario == 'returns' else '#token'
        type_text(page, token_field, cfg['token'])
        if scenario == 'status':
            type_text(page, '#order', cfg['resource'])
            page.keyboard.press('Enter')
            page.wait_for_function('!document.getElementById("result").hidden')
            focused(page, '#result-heading')
            assert 'USD' in page.locator('#result').inner_text()
            assert 'Observed at' in page.locator('#result').inner_text()
        elif scenario == 'execution':
            enter(page, '#preview-button')
            focused(page, '#preview-heading')
            assert page.get_by_role('button', name='Execute synthetic change once', exact=True).is_disabled()
            assert json.loads(page.locator('#preview').inner_text())['preview']['amount'] == {'currency': 'USD', 'minor': '12500'}
            type_text(page, '#reviewer', cfg['reviewer'])
            page.keyboard.press('Enter')
            focused(page, '#execute')
            page.keyboard.press('Enter')
            page.wait_for_function('document.getElementById("notice").textContent.includes("No financial effect")')
            focused(page, '#notice')
            result = json.loads(page.locator('#result').inner_text())
            assert result['financial_effect'] is False and result['approval_consumed'] is True
        elif scenario == 'returns':
            type_text(page, '#case', 'case_one'); page.keyboard.press('Enter')
            focused(page, '#items-heading')
            type_text(page, '#qty-one', '1')
            enter(page, '#calculate')
            focused(page, '#estimate-heading')
            assert 'USD 17.00' in page.locator('#estimate').inner_text()
            assert page.locator('#submit').is_disabled()
            tab_to(page, '#consent'); page.keyboard.press('Space')
            page.keyboard.press('Tab'); focused(page, '#submit'); page.keyboard.press('Enter')
            focused(page, '#request-heading')
            assert 'awaiting merchant review' in page.locator('#request-status').inner_text()
        elif scenario == 'order-edits':
            type_text(page, '#case', 'case_one'); type_text(page, '#skill', cfg['skill']); page.keyboard.press('Enter')
            focused(page, '#state-heading'); enter(page, '#intent button')
            focused(page, '#quote-heading')
            assert '1000' in page.locator('#quote').inner_text()
            type_text(page, '#reviewer', cfg['reviewer']); enter(page, '#approve')
            page.wait_for_function('!document.getElementById("actions").hidden'); focused(page, '#message')
            enter(page, '#dispatch')
            page.wait_for_function('document.getElementById("summary").textContent.includes("awaiting_invoice")')
            enter(page, '#release')
            page.wait_for_function('document.getElementById("message").textContent.includes("EDIT_PAYMENT_OUTSTANDING")')
            focused(page, '#message'); assert page.locator('#message').get_attribute('role') == 'alert'
        elif scenario == 'support':
            enter(page, '#signin button[type=submit]')
            page.wait_for_function('!document.getElementById("workspace").hidden'); focused(page, '#status')
            assert page.locator('#shipments article').count() == 2
            enter(page, '#takeover')
            page.wait_for_function('document.getElementById("status").textContent==="Current case state loaded."')
            focused(page, '#status')
            assert 'human' in page.locator('#ownership').inner_text()
        elif scenario == 'exceptions':
            enter(page, '#access button')
            page.wait_for_function('document.getElementById("notice").textContent==="Current server state loaded."')
            focused(page, '#notice')
            card = page.locator('article[data-operation="' + cfg['operation'] + '"]')
            assert card.get_by_role('button', name='Retry disabled', exact=True).is_disabled()
            button = card.get_by_role('button', name='Reconcile without resending', exact=True)
            assert button.get_attribute('aria-describedby')
            enter(page, 'article[data-operation="' + cfg['operation'] + '"] button:not([disabled])')
            page.wait_for_function('(id)=>!document.querySelector(`article[data-operation="${id}"]`)', arg=cfg['operation'])
            focused(page, '#notice')
        audit(page, scenario)
        assert page.locator(token_field).input_value() == ''
        logout = '#signout' if scenario == 'support' else '#logout'
        enter(page, logout)
        notice = '#status' if scenario == 'support' else '#message' if scenario in ['status', 'order-edits'] else '#notice'
        page.wait_for_function('(id)=>/signed out|cleared/i.test(document.querySelector(id).textContent)', arg=notice)
        focused(page, token_field)
        assert not page.evaluate('window.storageTouched')
    assert not network
    browser_version = browser.version
    browser.close()

print(json.dumps({'scenario': scenario, 'passed': True, 'calls': calls,
                  'observations': observations, 'browser_version': browser_version,
                  'direct_browser_network': network, 'bridge_to_actual_api': 'url' in cfg,
                  'human_assistive_technology_observed': False}))
