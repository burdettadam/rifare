"""Bounded locale observations of existing UI and an explicit actual loopback API.

The invalid-source scenario deliberately damages a copied response. It never
substitutes a successful source effect or supplies input to a financial action.
"""
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
import urllib.error
import urllib.request
from playwright.sync_api import sync_playwright

cfg = json.loads(os.environ['RIFARE_TEST_INPUT'])
assert re.fullmatch(r'http://127\.0\.0\.1:[0-9]+', cfg['url'])
root = Path(__file__).resolve().parents[2]
assets = root / 'apps/commerce-api'
calls, network, observations = [], [], []
quote_identity, prepare_count, fault = None, 0, None
allowed = {'/v1/returns/form', '/v1/returns/status', '/v1/returns/quote', '/v1/returns/prepare', '/v1/session/logout'}

def bridge(path, options):
    global quote_identity, prepare_count
    assert path in allowed or re.fullmatch(r'/v1/orders/res_[A-Za-z0-9_-]+/status', path)
    body = options.get('body')
    value = json.loads(body) if body else None
    if path == '/v1/returns/quote':
        assert value == {'case_id': 'case_one', 'lines': [{'line_id': 'one', 'quantity': 1}], 'outcome': 'refund', 'reason': 'size', 'note': '', 'evidence_ids': []}
    if path == '/v1/returns/prepare':
        assert cfg['scenario'] == 'confirmation' and quote_identity
        assert value == {'quote_id': quote_identity['id'], 'quote_digest': quote_identity['digest'], 'request_key': quote_identity['id'], 'override_id': None}
        prepare_count += 1
    request = urllib.request.Request(cfg['url'] + path, data=body.encode() if body else None,
                                    headers=options.get('headers', {}), method=options.get('method', 'GET'))
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            status, result = response.status, json.load(response)
    except urllib.error.HTTPError as error:
        status, result = error.code, json.load(error)
    calls.append({'path': path, 'status': status})
    if path == '/v1/returns/quote' and status == 200:
        quote_identity = {'id': result['id'], 'digest': result['digest']}
        if fault == 'localized-decimal':
            result['quote']['decision']['fees']['net_minor'] = '1,700'
        elif fault == 'unsupported-currency':
            result['quote']['decision']['fees']['currency'] = 'AUD'
    return {'status': status, 'value': result}

def text_space(value):
    return value.replace('\u00a0', ' ').replace('\u202f', ' ')

def fetch_asset(path):
    with urllib.request.urlopen(cfg['url'] + '/' + path, timeout=5) as response:
        assert response.status == 200 and response.headers['x-content-type-options'] == 'nosniff'
        assert "frame-ancestors 'none'" in response.headers['content-security-policy']
        return response.read().decode()

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path=os.environ.get('RIFARE_TEST_BROWSER', '/usr/bin/chromium'),
                                        headless=True, args=['--no-sandbox'])
    page = None

    def mount(name, fallback=False):
        global page
        if page is not None:
            page.close()
        page = browser.new_page(viewport={'width': 360, 'height': 800})
        page.set_default_timeout(4000)
        page.clock.set_fixed_time(datetime.fromtimestamp(cfg['at'] / 1000, tz=timezone.utc))
        page.route('**/*', lambda route: (network.append(route.request.url), route.abort()))
        page.route_web_socket('**/*', lambda route: (network.append('websocket'), route.close()))
        page.expose_function('localBridge', bridge)
        html = fetch_asset(name)
        scripts = re.findall(r'<script[^>]+src="/([^"]+)"[^>]*>\s*</script>', html)
        assert 'locale-presentation.js' in scripts and 'locale-client.js' in scripts
        page.set_content(re.sub(r'<script[^>]*>.*?</script>|<link[^>]*>', '', html))
        for style in re.findall(r'<link[^>]+href="/([^"]+\.css)"[^>]*>', html):
            page.add_style_tag(content=fetch_asset(style))
        page.evaluate('''() => {
            window.storageTouched=false;
            for(const key of ['localStorage','sessionStorage']) Object.defineProperty(window,key,{configurable:true,get(){window.storageTouched=true;throw Error('PRIVATE_STORAGE_DENIED');}});
            window.fetch=async(path,options={})=>{const r=await window.localBridge(path,options);return {ok:r.status>=200&&r.status<300,json:async()=>r.value};};
        }''')
        for script in scripts:
            if not fallback or script not in ['locale-presentation.js', 'locale-client.js']:
                page.add_script_tag(content=fetch_asset(script))
        assert page.locator('html').get_attribute('lang') == 'en'
        assert page.get_by_label('Number and date format', exact=True).count() == 1
        assert page.get_by_label('Display time zone', exact=True).count() == 1
        assert 'English' in page.locator('#presentation-notice').inner_text()
        if not fallback:
            assert not page.locator('#display-locale').is_disabled()
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')

    def returns_quote():
        page.locator('#session').fill(cfg['token'])
        page.locator('#case').fill('case_one')
        page.locator('#case').press('Enter')
        page.locator('#choose').wait_for(state='visible')
        page.locator('#qty-one').fill('1')
        page.locator('#calculate').click()
        page.locator('#quote-panel').wait_for(state='visible')

    scenario = cfg['scenario']
    if scenario == 'presentation':
        mount('status')
        page.locator('#token').fill(cfg['token']); page.locator('#order').fill(cfg['resource']); page.locator('#order').press('Enter')
        page.locator('#result').wait_for(state='visible')
        original = page.locator('#result [data-rifare-instant]').evaluate_all('els=>els.map(e=>e.dataset.rifareInstant)')
        expected = {'en-US': 'USD 125.00', 'en-GB': 'USD 125.00', 'de-DE': '125,00 USD', 'fr-FR': '125,00 USD', 'ja-JP': 'USD 125.00'}
        read_count = len(calls)
        for locale, total in expected.items():
            page.locator('#display-locale').select_option(locale)
            for zone in ['UTC', 'America/Denver']:
                page.locator('#display-zone').select_option(zone)
                assert text_space(page.locator('#result [data-rifare-money]').inner_text()) == total
                assert page.locator('#result [data-rifare-money]').get_attribute('data-canonical-minor') == '12500'
                assert page.locator('#result [data-rifare-money]').get_attribute('data-canonical-currency') == 'USD'
                assert page.locator('#result [data-rifare-instant]').evaluate_all('els=>els.map(e=>e.dataset.rifareInstant)') == original
                assert zone in page.locator('#result [data-rifare-instant]').first.inner_text()
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        assert len(calls) == read_count
        observations.append({'screen': 'status', 'locale_count': 5, 'zone_count': 2, 'canonical_values_retained': True})
        mount('returns'); returns_quote()
        canonical = page.locator('#estimate [data-rifare-money]').evaluate_all('els=>els.map(e=>[e.dataset.canonicalCurrency,e.dataset.canonicalMinor])')
        assert canonical == [['USD','2000'],['USD','200'],['USD','100'],['USD','1700']]
        deadline = page.locator('#deadline').get_attribute('data-rifare-deadline')
        quote_count = len(calls)
        for locale in expected:
            page.locator('#display-locale').select_option(locale)
            for zone in ['UTC', 'America/Denver']:
                page.locator('#display-zone').select_option(zone)
                assert page.locator('#estimate [data-rifare-money]').evaluate_all('els=>els.map(e=>[e.dataset.canonicalCurrency,e.dataset.canonicalMinor])') == canonical
                assert page.locator('#deadline').get_attribute('data-rifare-deadline') == deadline
                assert 'America/Denver' in page.locator('#deadline').inner_text() and deadline in page.locator('#deadline').inner_text()
                assert page.locator('#submit').is_disabled()
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        assert len(calls) == quote_count
        observations.append({'screen': 'returns', 'locale_count': 5, 'zone_count': 2, 'canonical_values_retained': True, 'approval_preserved': True})
        page.locator('#logout').click()
        assert page.locator('#estimate [data-rifare-money]').count() == 0
        assert not page.locator('#deadline').get_attribute('data-rifare-deadline')
    elif scenario == 'invalid-source':
        for injected in ['localized-decimal', 'unsupported-currency']:
            mount('returns'); fault = injected
            page.locator('#session').fill(cfg['token']); page.locator('#case').fill('case_one'); page.locator('#case').press('Enter')
            page.locator('#choose').wait_for(state='visible'); page.locator('#qty-one').fill('1'); page.locator('#calculate').click()
            page.wait_for_function('document.getElementById("notice").getAttribute("role")==="alert"')
            assert page.locator('#quote-panel').is_hidden() and page.locator('#submit').is_disabled()
            expected_error = 'integer minor units' if injected == 'localized-decimal' else 'currency is not supported'
            assert expected_error in page.locator('#notice').inner_text()
            observations.append({'injected_response_fault': injected, 'render_and_submission_blocked': True})
        assert prepare_count == 0
    elif scenario == 'confirmation':
        mount('returns'); returns_quote(); page.locator('#consent').check()
        page.locator('#display-locale').select_option('de-DE'); page.locator('#display-zone').select_option('Europe/Berlin')
        assert page.locator('#consent').is_checked()
        assert '17,00 USD' in text_space(page.locator('#estimate').inner_text())
        page.locator('#submit').click(); page.locator('#status-panel').wait_for(state='visible')
        page.wait_for_function('document.getElementById("request-status").textContent.includes("awaiting merchant review")')
        assert prepare_count == 1
        observations.append({'formatted_values_submitted': False, 'original_quote_identity_used': True})
    elif scenario == 'fallback':
        mount('returns', fallback=True); returns_quote()
        assert 'USD 17.00' in page.locator('#estimate').inner_text()
        assert page.locator('#display-locale').is_disabled() and page.locator('#display-zone').is_disabled()
        assert page.locator('#submit').is_disabled()
        observations.append({'canonical_fallback': True})
    else:
        raise AssertionError('unknown scenario')
    assert not page.evaluate('window.storageTouched')
    assert network == []
    version = browser.version
    browser.close()

print(json.dumps({'scenario': scenario, 'passed': True, 'calls': calls, 'observations': observations,
                  'browser_version': version, 'direct_browser_network': network,
                  'return_quote_count': sum(c['path']=='/v1/returns/quote' for c in calls),
                  'prepare_count': prepare_count, 'original_quote_identity_used': scenario == 'confirmation',
                  'canonical_fallback': scenario == 'fallback', 'human_assistive_technology_observed': False}))
