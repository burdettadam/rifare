"""Actual served Chromium journeys. A startup/host failure is a failed gate, never a skip.

This loads the real HTML/CSS/JS and uses browser fetch to the native server.
Faults discard or corrupt only responses to requests actually forwarded once.
No successful native facts are substituted. Output is bounded, sanitized metadata.
"""
import importlib.metadata
import json
import os
import sys
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright

cfg = json.loads(os.environ['RIFARE_TEST_INPUT'])
scenario = cfg['scenario']
stage = 'browser_startup'
receipt_scenario = scenario in {'receipt_journey', 'receipt_lost', 'receipt_invalid_binding',
                               'receipt_late_clear', 'receipt_mobile_keyboard'}
if receipt_scenario:
    assert set(cfg['receipts']) == {'primary', 'wrong_binding'}
    assert all(isinstance(value, str) and 0 < len(value) <= 100000 for value in cfg['receipts'].values())
else:
    assert scenario in {'journey', 'lost_prepare', 'absence', 'lost_cancel', 'conflict',
                        'late_clear', 'revoked', 'invalid_binding', 'mobile_keyboard'}
assert importlib.metadata.version('playwright') == '1.62.0'
origin = urlsplit(cfg['url'])
assert origin.scheme == 'http' and origin.hostname == '127.0.0.1' and origin.port
calls, external, errors, console, assets = [], [], [], [], {}
receipt_responses = []
fault_applied = False
committed_id = None
browser = None
primary_failure = None
callback_failures = []
cleanup_failures = []
playwright_body_finished = False


def safe_failure(error, step):
    """Keep only a finite class name and this worker's last traceback line."""
    allowed = {'AssertionError', 'Error', 'TimeoutError', 'TargetClosedError',
               'KeyError', 'TypeError', 'ValueError', 'JSONDecodeError'}
    error_name = type(error).__name__
    # A finite classification can distinguish a browser policy refusal without
    # retaining Playwright messages, which can contain fixture credentials.
    message = str(error)
    browser_error = 'csp_eval_blocked' if ('unsafe-eval' in message and
        ('Content Security Policy' in message or 'EvalError' in message)) else 'other'
    worker_line = None
    traceback = error.__traceback__
    while traceback is not None:
        if traceback.tb_frame.f_code.co_filename == __file__:
            worker_line = traceback.tb_lineno
        traceback = traceback.tb_next
    return {'stage': step, 'error': error_name if error_name in allowed else 'Exception',
            'worker_line': worker_line, 'browser_error': browser_error}


def listener(step, callback):
    def guarded(*args):
        try:
            callback(*args)
        except Exception as error:
            if len(callback_failures) < 4:
                callback_failures.append(safe_failure(error, step))
    return guarded

try:
    with sync_playwright() as p:
        context = None
        try:
            browser = p.chromium.launch(
                executable_path=os.environ.get('RIFARE_BROWSER_EXECUTABLE', '/usr/bin/chromium'),
                headless=True, args=['--no-sandbox'])
            stage = 'context_startup'
            context = browser.new_context(service_workers='block',
                                          viewport={'width': 390 if scenario in {'mobile_keyboard', 'receipt_mobile_keyboard'} else 1280, 'height': 900})
            stage = 'page_startup'
            page = context.new_page()
            page.set_default_timeout(4000)
            page.on('pageerror', listener('page_error_callback', lambda _: errors.append('page_error')))
            page.on('console', listener('console_callback', lambda message: console.append(message.text)))
            page.on('websocket', listener('websocket_callback', lambda _: external.append('websocket')))
            def response_seen(response):
                path = urlsplit(response.url).path
                if path in {'/checkout-review', '/checkout-review-client.js', '/checkout-review.css'}:
                    assets[path] = response.status
                if path == '/v1/delegated-checkout/receipt':
                    receipt_responses.append(response.status)
            page.on('response', listener('response_callback', response_seen))

            def boundary(route):
                global fault_applied, committed_id
                route_stage = 'route_request'
                try:
                    request = route.request
                    destination = urlsplit(request.url)
                    if (destination.scheme, destination.netloc) != (origin.scheme, origin.netloc):
                        external.append('foreign_origin')
                        route_stage = 'route_foreign_abort'
                        route.abort()
                        return
                    path = destination.path
                    if path.startswith('/v1/'):
                        route_stage = 'route_request_body'
                        assert request.method == 'POST'
                        assert destination.query == '' and destination.fragment == ''
                        calls.append({'path': path, 'body': request.post_data_json})
                    fault_route = (
                        scenario == 'lost_prepare' and path == '/v1/delegated-checkout/prepare' or
                        scenario == 'lost_cancel' and path == '/v1/delegated-checkout/cancel' or
                        scenario == 'conflict' and path == '/v1/delegated-checkout/cancel' or
                        scenario == 'late_clear' and path == '/v1/delegated-checkout/preview-status' or
                        scenario == 'invalid_binding' and path == '/v1/delegated-checkout-recovery/lookup' or
                        scenario in {'receipt_lost', 'receipt_late_clear'} and path == '/v1/delegated-checkout/receipt')
                    if fault_route and not fault_applied:
                        fault_applied = True
                        if scenario == 'conflict':
                            route_stage = 'route_conflict_post'
                            concurrent = context.request.post(request.url, data=request.post_data,
                                headers={'authorization': 'Bearer ' + cfg['bearer'], 'content-type': 'application/json'})
                            assert concurrent.status == 200
                        route_stage = 'route_fetch'
                        actual = route.fetch(max_redirects=0, max_retries=0)
                        route_stage = 'route_response'
                        if scenario == 'conflict':
                            assert actual.status == 409
                            route.fulfill(response=actual)
                        else:
                            assert actual.status == 200
                            native = actual.json()
                            if scenario in {'lost_prepare', 'receipt_lost', 'receipt_late_clear'}:
                                committed_id = native['result']['intent_id']
                            if receipt_scenario:
                                assert native['result']['state'] == 'evidence_verified'
                                assert native['result']['revision'] == 2
                                assert native['execution_authorized'] is False
                                assert native['result']['execution_authorized'] is False
                            if scenario in {'lost_prepare', 'lost_cancel', 'receipt_lost'}:
                                route_stage = 'route_lost_response_abort'
                                route.abort('failed')
                            elif scenario in {'late_clear', 'receipt_late_clear'}:
                                route_stage = 'route_clear_click'
                                page.get_by_role('button', name='Clear this page', exact=True).click()
                                route_stage = 'route_late_fulfill'
                                route.fulfill(response=actual)
                            else:
                                route_stage = 'route_invalid_binding_fulfill'
                                native['result']['original']['context_id'] = 'wrong-original-context'
                                route.fulfill(response=actual, json=native)
                        return
                    route_stage = 'route_continue'
                    route.continue_()
                except Exception as error:
                    if len(callback_failures) < 4:
                        callback_failures.append(safe_failure(error, route_stage))
                    # Never let a listener exception print Playwright's raw call log.
                    try:
                        route.abort('failed')
                    except Exception as abort_error:
                        if len(callback_failures) < 4:
                            callback_failures.append(safe_failure(abort_error, 'route_failure_abort'))
            context.route('**/*', boundary)
            stage = 'served_navigation'
            response = page.goto(cfg['url'] + '/checkout-review')
            stage = 'served_headers'
            assert response.status == 200
            assert response.headers['cache-control'] == 'no-store'
            assert "connect-src 'self'" in response.headers['content-security-policy']
            stage = 'served_heading'
            page.get_by_role('heading', name='Checkout review', exact=True).wait_for()
            stage = 'customer_session_fill'
            page.get_by_label('Customer session', exact=True).fill(cfg['bearer'])
            stage = 'customer_session_use'
            page.get_by_role('button', name='Use session', exact=True).click()
            stage = 'customer_session_cleared'
            assert page.locator('#session-input').input_value() == ''
            stage = 'original_preview_fill'
            page.get_by_label('Original preview ID', exact=True).fill(cfg['original']['preview_id'])
            stage = 'original_context_fill'
            page.get_by_label('Original context ID', exact=True).fill(cfg['original']['context_id'])

            def ready(button):
                global stage
                stage = {'prepare-intent': 'prepare_ready', 'recover-intent': 'recovery_ready',
                         'refresh-intent': 'status_ready', 'request-cancel': 'cancel_ready',
                         'submit-receipt': 'receipt_submit_ready'}[button]
                page.wait_for_function('(id) => !document.getElementById(id).disabled', arg=button)
            def visible_intent():
                global stage
                stage = 'intent_visible'
                page.locator('#intent-panel').wait_for(state='visible')
                ready('refresh-intent')
            def prepare():
                global stage
                stage = 'review_proposal_click'
                page.get_by_role('button', name='Review proposal', exact=True).click()
                stage = 'preview_visible'
                page.locator('#preview-panel').wait_for(state='visible')
                ready('prepare-intent')
                stage = 'prepare_click'
                page.get_by_role('button', name='Prepare once', exact=True).click()
            def cancel():
                global stage
                stage = 'cancel_request_click'
                page.get_by_role('button', name='Cancel preparation', exact=True).click()
                stage = 'cancel_confirmation_visible'
                page.locator('#cancel-confirmation').wait_for(state='visible')
                stage = 'cancel_confirm_click'
                page.get_by_role('button', name='Confirm cancellation', exact=True).click()
            def operation(name):
                return [call for call in calls if call['path'].endswith('/' + name)]
            stage = scenario

            if receipt_scenario:
                prepare()
                visible_intent()
                stage = 'receipt_control_available'
                page.locator('#receipt-panel').wait_for(state='visible')
                field = page.get_by_label('Signed receipt', exact=True)
                assert field.get_attribute('type') == 'password'
                assert field.get_attribute('maxlength') == '100000'
                assert field.get_attribute('autocomplete') == 'off'
                assert len(operation('prepare')) == 1
                assert operation('prepare')[0]['body'] == cfg['original']
                stage = 'receipt_input_fill'
                supplied = cfg['receipts']['wrong_binding' if scenario == 'receipt_invalid_binding' else 'primary']
                field.fill(supplied)
                ready('submit-receipt')
                stage = 'receipt_submit'
                if scenario == 'receipt_mobile_keyboard':
                    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
                    field.focus()
                    page.keyboard.press('Tab')
                    assert page.locator('#submit-receipt').evaluate('(element) => document.activeElement === element')
                    page.keyboard.press('Enter')
                else:
                    page.get_by_role('button', name='Check receipt', exact=True).click()
                stage = 'receipt_input_cleared'
                page.wait_for_function("() => document.getElementById('receipt-input').value === ''")
                assert not page.locator('#submit-receipt').is_enabled()
                if scenario == 'receipt_late_clear':
                    stage = 'receipt_late_clear_observed'
                    page.wait_for_function("() => document.getElementById('preview-id').value === ''")
                    assert committed_id is not None
                    assert not page.locator('#intent-panel').is_visible()
                    assert not page.locator('#receipt-panel').is_visible()
                    assert page.locator('#session-input').input_value() == ''
                elif scenario == 'receipt_invalid_binding':
                    stage = 'receipt_refused'
                    page.wait_for_function("() => document.getElementById('workflow-notice').getAttribute('role') === 'alert'")
                    assert len(receipt_responses) == 1 and receipt_responses[0] in {400, 403, 409}
                    assert not page.locator('#intent-panel').is_visible()
                    assert not page.locator('#request-cancel').is_enabled()
                else:
                    if scenario == 'receipt_lost':
                        ready('refresh-intent')
                        assert not page.locator('#intent-panel').is_visible()
                        assert not page.locator('#request-cancel').is_enabled()
                        assert len(operation('receipt')) == 1
                        assert len(operation('status')) == 0
                        stage = 'receipt_original_status_click'
                        page.get_by_role('button', name='Check status', exact=True).click()
                    stage = 'receipt_evidence_observed'
                    page.wait_for_function("() => document.getElementById('receipt-state').textContent === 'Historical evidence observed'")
                    ready('refresh-intent')
                    assert page.locator('#intent-state').text_content() == 'Evidence observed'
                    assert page.locator('#intent-revision').text_content() == '2'
                    assert page.locator('#receipt-input').input_value() == ''
                    assert not page.locator('#submit-receipt').is_enabled()
                    if scenario == 'receipt_lost':
                        assert operation('status')[-1]['body']['intent_id'] == committed_id
                    if scenario == 'receipt_journey':
                        stage = 'receipt_observation_screenshot'
                        os.makedirs('evidence/rcg5d-browser', exist_ok=True)
                        page.locator('.follow-card').screenshot(path='evidence/rcg5d-browser/receipt-observed.png')
                        cancel()
                        stage = 'receipt_revision_cancelled'
                        page.wait_for_function("() => document.getElementById('intent-state').textContent === 'Cancelled'")
                        assert operation('cancel')[0]['body']['expected_revision'] == 2
                        assert operation('cancel')[0]['body']['intent_id'] == operation('receipt')[0]['body']['intent_id']
                        assert page.locator('#intent-revision').text_content() == '3'
                stage = 'receipt_original_request_boundary'
                assert len(operation('receipt')) == 1
                assert len(operation('prepare')) == 1
                assert len(operation('cancel')) == (1 if scenario == 'receipt_journey' else 0)
                assert set(operation('receipt')[0]['body']) == {'intent_id', 'compact_jws'}
                assert operation('receipt')[0]['body']['compact_jws'] == supplied
                assert not page.locator('#submit-receipt').is_enabled()
                assert page.locator('#receipt-input').input_value() == ''
                for compact in cfg['receipts'].values():
                    assert compact not in page.locator('body').inner_text()
                    assert all(compact not in line for line in console)
                assert not any(call['path'].endswith('/preview') for call in calls)
            elif scenario == 'absence':
                stage = 'recover_original_click'
                page.get_by_role('button', name='Recover original', exact=True).click()
                ready('recover-intent')
                assert not page.locator('#intent-panel').is_visible()
                assert not page.locator('#prepare-intent').is_enabled()
                assert len(operation('prepare')) == 0
            elif scenario == 'late_clear':
                stage = 'review_proposal_click'
                page.get_by_role('button', name='Review proposal', exact=True).click()
                stage = 'late_clear_observed'
                page.wait_for_function("() => document.getElementById('preview-id').value === ''")
                assert not page.locator('#preview-panel').is_visible()
                assert not page.locator('#prepare-intent').is_enabled()
            elif scenario == 'invalid_binding':
                # Parent creates the original native intent for this history-only case.
                stage = 'recover_original_click'
                page.get_by_role('button', name='Recover original', exact=True).click()
                ready('recover-intent')
                assert not page.locator('#intent-panel').is_visible()
                assert not page.locator('#request-cancel').is_enabled()
                stage = 'recover_original_after_invalid_click'
                page.get_by_role('button', name='Recover original', exact=True).click()
                visible_intent()
                assert len(operation('prepare')) == 0
            else:
                prepare()
                if scenario == 'lost_prepare':
                    ready('recover-intent')
                    assert not page.locator('#intent-panel').is_visible()
                    assert not page.locator('#prepare-intent').is_enabled()
                    stage = 'recover_original_click'
                    page.get_by_role('button', name='Recover original', exact=True).click()
                visible_intent()
                assert len(operation('prepare')) == 1
                assert operation('prepare')[0]['body'] == cfg['original']
                stage = 'check_status_click'
                page.get_by_role('button', name='Check status', exact=True).click()
                ready('request-cancel')
                if scenario == 'lost_prepare':
                    assert operation('status')[-1]['body']['intent_id'] == committed_id
                if scenario == 'revoked':
                    stage = 'session_logout'
                    logout = context.request.post(cfg['url'] + '/v1/session/logout', data={},
                                                  headers={'authorization': 'Bearer ' + cfg['bearer']})
                    assert logout.status == 200
                    stage = 'revoked_status_click'
                    page.get_by_role('button', name='Check status', exact=True).click()
                    stage = 'revoked_notice'
                    page.wait_for_function("() => document.getElementById('workflow-notice').getAttribute('role') === 'alert'")
                    assert not page.locator('#intent-panel').is_visible()
                    assert not page.locator('#request-cancel').is_enabled()
                else:
                    if scenario == 'mobile_keyboard':
                        stage = 'mobile_keyboard'
                        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
                        assert page.get_by_role('link', name='Skip to main content').count() == 1
                        page.locator('#request-cancel').focus()
                        page.keyboard.press('Enter')
                        page.locator('#cancel-confirmation').wait_for(state='visible')
                        page.get_by_role('button', name='Keep preparation', exact=True).click()
                        assert len(operation('cancel')) == 0
                    cancel()
                    if scenario in {'lost_cancel', 'conflict'}:
                        ready('refresh-intent')
                        assert not page.locator('#request-cancel').is_enabled()
                        stage = 'cancel_recovery_status_click'
                        page.get_by_role('button', name='Check status', exact=True).click()
                    stage = 'cancelled_state'
                    page.wait_for_function("() => document.getElementById('intent-state').textContent.toLowerCase().includes('cancel')")
                    assert not page.locator('#preview-panel').is_visible()
                    assert not page.locator('#request-cancel').is_enabled()
                    assert len(operation('cancel')) == 1

            # Hidden panels are insufficient: remove the previous personal dynamic text.
            stage = 'private_dynamic_text_cleared'
            if scenario in {'journey', 'lost_prepare', 'lost_cancel', 'conflict', 'revoked', 'late_clear', 'mobile_keyboard'}:
                for private_id in ('preview-items', 'preview-subtotal', 'preview-tax', 'preview-shipping',
                                   'preview-fees', 'preview-total', 'preview-deadline', 'intent-money'):
                    assert page.locator('#' + private_id).text_content() == ''
            stage = 'privacy_and_boundary'
            assert external == [] and errors == []
            assert assets == {'/checkout-review': 200, '/checkout-review-client.js': 200, '/checkout-review.css': 200}
            assert page.url == cfg['url'] + '/checkout-review'
            assert page.evaluate('localStorage.length + sessionStorage.length') == 0
            assert page.evaluate('history.state') is None
            assert context.cookies() == []
            for private in (cfg['bearer'], cfg['original']['preview_id'], cfg['original']['context_id']):
                assert all(private not in line for line in console)
            if not receipt_scenario:
                assert not any(call['path'].endswith('/receipt') or call['path'].endswith('/preview') for call in calls)
            version = browser.version
            stage = 'final_clear_click'
            page.get_by_role('button', name='Clear this page', exact=True).click()
            stage = 'final_clear_observed'
            assert not page.locator('#intent-panel').is_visible()
            assert not page.locator('#preview-panel').is_visible()
            for field in ('session-input', 'preview-id', 'context-id'):
                assert page.locator('#' + field).input_value() == ''
            if receipt_scenario:
                assert page.locator('#receipt-input').input_value() == ''
                assert not page.locator('#receipt-panel').is_visible()
            for private_id in ('preview-items', 'preview-total', 'intent-money', 'receipt-state', 'reference-details',
                               'intent-state', 'intent-message', 'intent-revision', 'intent-deadline', 'cancel-revision'):
                assert page.locator('#' + private_id).text_content() == ''
        except Exception as error:
            # Preserve the action failure before either close can raise another one.
            primary_failure = safe_failure(error, stage)
        finally:
            if context is not None:
                try:
                    context.close()
                except Exception as error:
                    cleanup_failures.append(safe_failure(error, 'context_close'))
            if browser is not None:
                try:
                    browser.close()
                except Exception as error:
                    cleanup_failures.append(safe_failure(error, 'browser_close'))
                finally:
                    browser = None
        playwright_body_finished = True
except Exception as error:
    if playwright_body_finished:
        cleanup_failures.append(safe_failure(error, 'playwright_close'))
    elif primary_failure is None:
        primary_failure = safe_failure(error, stage)

if primary_failure is not None or callback_failures or cleanup_failures:
    first = primary_failure or (callback_failures + cleanup_failures)[0]
    # Never emit exception messages, Playwright call logs, paths or traceback text.
    print(json.dumps({'passed': False, 'scenario': scenario, **first,
                      'primary_failure': primary_failure, 'callback_failures': callback_failures,
                      'cleanup_failures': cleanup_failures, 'actual_served_browser': False}), file=sys.stderr)
    sys.exit(1)

print(json.dumps({'passed': True, 'scenario': scenario, 'actual_served_browser': True,
                  'playwright_version': importlib.metadata.version('playwright'), 'browser_version': version,
                  'preparation_requests': len(operation('prepare')), 'cancellation_requests': len(operation('cancel')),
                  **({'receipt_requests': len(operation('receipt'))} if receipt_scenario else {}),
                  'external_requests': 0, 'execution_authorized': False}))
