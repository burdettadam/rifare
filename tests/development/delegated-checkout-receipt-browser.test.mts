/** Receipt submission through actual served Chromium and unchanged native owners. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { runCheckoutBrowser } from './delegated-checkout-browser-process.mts';
import { usingReview } from './delegated-checkout-review-helpers.mts';

async function receiptJourney(scenario: string) {
  return usingReview(async fixture => {
    const result = await runCheckoutBrowser({
      scenario, url: fixture.url, bearer: fixture.bearer, original: fixture.original,
      receipts: { primary: fixture.primaryReceipt, wrong_binding: fixture.pendingReceipt },
    });
    assert.equal(result.outputOverflow, false); assert.equal(result.timedOut, false);
    assert.equal(result.guard?.cleanup_complete, true, 'Owned browser processes must be reaped');
    assert.equal(result.code, 0, result.stderr);
    const observed = JSON.parse(result.stdout);
    assert.equal(observed.passed, true); assert.equal(observed.actual_served_browser, true);
    assert.equal(observed.preparation_requests, 1); assert.equal(observed.receipt_requests, 1);
    assert.equal(observed.external_requests, 0); assert.equal(observed.execution_authorized, false);
    const records = fixture.inspect();
    assert.equal(records.length, 1);
    assert.equal(records[0].state, scenario === 'receipt_journey' ? 'cancelled' :
      scenario === 'receipt_invalid_binding' ? 'prepared' : 'evidence_verified');
    assert.equal(records[0].revision, scenario === 'receipt_journey' ? 3 :
      scenario === 'receipt_invalid_binding' ? 1 : 2);
    for (const compact of [fixture.primaryReceipt, fixture.pendingReceipt]) {
      assert.equal(JSON.stringify(records).includes(compact), false, 'Raw receipt must not be persisted');
      assert.equal((result.stdout + result.stderr).includes(compact), false, 'Raw receipt must not enter reports');
    }
    await fixture.close(1);
  });
}

test('RCG5D-BROWSER-NATIVE-RECEIPT', () => receiptJourney('receipt_journey'));
test('RCG5D-BROWSER-LOST-RECEIPT', () => receiptJourney('receipt_lost'));
test('RCG5D-BROWSER-WRONG-BINDING', () => receiptJourney('receipt_invalid_binding'));
test('RCG5D-BROWSER-LATE-CLEAR', () => receiptJourney('receipt_late_clear'));
test('RCG5D-BROWSER-MOBILE-KEYBOARD', () => receiptJourney('receipt_mobile_keyboard'));
