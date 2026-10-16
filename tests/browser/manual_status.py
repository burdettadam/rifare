"""Exercise the actual served manual UI. Never substitute intercepted API facts."""
import json
import os
from playwright.sync_api import sync_playwright

cfg = json.loads(os.environ['RIFARE_TEST_INPUT'])
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ['RIFARE_TEST_BROWSER'], headless=True, args=['--no-sandbox'])
    context = browser.new_context()
    external = []
    def boundary(route):
        if not route.request.url.startswith(cfg['url'] + '/'):
            external.append(route.request.url)
            route.abort()
        else:
            route.continue_()
    context.route('**/*', boundary)
    page = context.new_page()
    page.goto(cfg['url'] + '/status')
    page.get_by_label('Operator or verified customer session').fill(cfg['bearer'])
    page.get_by_label('Order resource ID', exact=True).fill(cfg['order'])
    page.get_by_label('Order resource ID', exact=True).press('Enter')
    result = {'model_calls': 0, 'external_requests': 0}
    if cfg['scenario'] == 'stale':
        page.wait_for_function("document.getElementById('message').textContent.includes('Current source unavailable')")
        assert not page.locator('#result').is_visible()
        result['previous_facts_visible'] = False
    else:
        page.get_by_role('heading', name='Order ORD-1001', exact=True).wait_for()
        assert 'in_transit' in page.locator('#result').inner_text()
        assert 'Synthetic fixture snapshot' in page.locator('#result').inner_text()
        result.update(order='ORD-1001', input_cleared=page.locator('#token').input_value() == '',
                      stored_token=page.evaluate('Boolean(localStorage.length || sessionStorage.length)'))
        assert result['input_cleared'] and not result['stored_token']
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
            result['previous_facts_visible'] = False
        if cfg['scenario'] == 'injection':
            assert '<img' in page.locator('#result').inner_text()
            assert not page.evaluate('Boolean(window.injected)')
            assert page.locator('#result img').count() == 0
            result['executed_script'] = False
    assert external == [], external
    assert page.locator('label[for=token]').count() == 1
    assert page.locator('label[for=order]').count() == 1
    assert page.evaluate('document.activeElement.id') == 'message'
    browser.close()
print(json.dumps(result))
