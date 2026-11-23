/** Explicit served-browser gate. Keep separate from the minimal-DOM controller tests. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { runCheckoutBrowser } from './delegated-checkout-browser-process.mts';
import { usingReview } from './delegated-checkout-review-helpers.mts';

async function journey(scenario: string) {
  return usingReview(async fixture => {
    if (scenario === 'invalid_binding') {
      const response = await fixture.request('prepare', fixture.original);
      assert.equal(response.status, 200); await response.arrayBuffer();
    }
    const result = await runCheckoutBrowser({ scenario, url: fixture.url, bearer: fixture.bearer, original: fixture.original });
    assert.equal(result.outputOverflow, false); assert.equal(result.timedOut, false);
    assert.equal(result.guard?.cleanup_complete, true, 'Owned browser processes must be reaped');
    assert.equal(result.code, 0, result.stderr);
    const observed = JSON.parse(result.stdout);
    assert.equal(observed.passed, true); assert.equal(observed.actual_served_browser, true);
    assert.equal(observed.external_requests, 0); assert.equal(observed.execution_authorized, false);
    await fixture.close(['absence', 'late_clear'].includes(scenario) ? 0 : 1);
  });
}

test('RCG5C-BROWSER-NATIVE-JOURNEY', () => journey('journey'));
test('RCG5C-BROWSER-LOST-PREPARE', () => journey('lost_prepare'));
test('RCG5C-BROWSER-ABSENCE-NO-RETRY', () => journey('absence'));
test('RCG5C-BROWSER-LOST-CANCEL', () => journey('lost_cancel'));
test('RCG5C-BROWSER-REVISION-CONFLICT', () => journey('conflict'));
test('RCG5C-BROWSER-LATE-CLEAR', () => journey('late_clear'));
test('RCG5C-BROWSER-REVOKED-SESSION', () => journey('revoked'));
test('RCG5C-BROWSER-INVALID-BINDING', () => journey('invalid_binding'));
test('RCG5C-BROWSER-MOBILE-KEYBOARD', () => journey('mobile_keyboard'));
