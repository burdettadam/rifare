/** Real native HTTP observations through the page controller; not browser qualification. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { usingReview } from './delegated-checkout-review-helpers.mts';
import { controllerFixture } from './delegated-checkout-controller-helpers.mts';
import type { Fault } from './delegated-checkout-controller-helpers.mts';

type Controller = ReturnType<typeof controllerFixture>;
type NativeFixture = Parameters<Parameters<typeof usingReview>[0]>[0];
const called = (c: Controller, operation: string) => c.calls.filter(call => call.path.endsWith('/' + operation));
const turn = () => new Promise(resolve => setTimeout(resolve, 15));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function useController(f: NativeFixture, run: (c: Controller) => Promise<void>, fault?: Fault, now?: () => number) {
  const c = controllerFixture(f.url, fault, now);
  try { await run(c); } finally { await c.dispose(); }
}
async function prepare(c: Controller, f: NativeFixture) {
  await c.input('session-input', f.bearer); await c.click('use-session');
  await c.input('preview-id', f.original.preview_id); await c.input('context-id', f.original.context_id);
  await c.click('load-preview');
  await c.until(() => !c.node('prepare-intent').disabled, 'Native proposal ready');
  await c.click('prepare-intent');
  await c.until(() => !c.node('intent-panel').hidden && !c.node('refresh-intent').disabled, 'Original native preparation observed');
  assert.equal(f.inspect().length, 1); assert.equal(f.inspect()[0].state, 'prepared');
  assert.equal(f.inspect()[0].revision, 1);
  assert.equal(c.node('receipt-panel').hidden, false, 'Prepared original exposes receipt submission');
  assert.equal(c.node('receipt-input').disabled, false);
}
async function submit(c: Controller, compact: string) {
  await c.input('receipt-input', compact);
  assert.equal(c.node('submit-receipt').disabled, false);
  await c.click('submit-receipt');
  assert.equal(c.node('receipt-input').value, '', 'Clear sensitive input before dispatch completes');
  assert.equal(c.node('submit-receipt').disabled, true);
}
async function settled(c: Controller) {
  await c.until(() => !c.node('workflow-notice').textContent.includes('…'), 'Receipt response settled');
}
function noPrivatePresentation(c: Controller, f: NativeFixture) {
  const text = [...c.document.nodes.values()].map(node => node.textContent).join('\n');
  for (const secret of [f.bearer, f.primaryReceipt, f.pendingReceipt])
    assert.equal(text.includes(secret), false, 'Sensitive input must not enter rendered text');
}
function cleared(c: Controller) {
  for (const id of ['receipt-input', 'session-input', 'preview-id', 'context-id'])
    assert.equal(c.node(id).value, '', 'Cleared field: ' + id);
  for (const id of ['preview-items', 'preview-total', 'intent-money', 'reference-details', 'receipt-state'])
    assert.equal(c.node(id).textContent, '', 'Cleared sensitive details: ' + id);
  assert.equal(c.node('intent-panel').hidden, true); assert.equal(c.node('receipt-panel').hidden, true);
  assert.equal(c.node('submit-receipt').disabled, true); assert.equal(c.node('request-cancel').disabled, true);
}
async function status(c: Controller) {
  assert.equal(c.node('refresh-intent').disabled, false);
  await c.click('refresh-intent');
  await c.until(() => !c.node('intent-panel').hidden && !c.node('refresh-intent').disabled, 'Explicit original status observed');
}
function originalOnly(c: Controller, f: NativeFixture, id: string, revision: number) {
  assert.equal(f.inspect().length, 1); assert.equal(f.inspect()[0].id, id);
  assert.equal(f.inspect()[0].revision, revision); assert.equal(called(c, 'prepare').length, 1);
  assert.equal(called(c, 'receipt').length, 1); noPrivatePresentation(c, f);
}

test('RCG5D-CONTROLLER-NATIVE-RECEIPT', () => usingReview(async f => {
  await useController(f, async c => {
    await prepare(c, f); const id = f.inspect()[0].id;
    assert.equal(c.node('receipt-input').type, 'password');
    await submit(c, f.primaryReceipt); await settled(c);
    assert.equal(c.node('intent-state').textContent, 'Evidence observed');
    assert.equal(c.node('receipt-state').textContent, 'Historical evidence observed');
    assert.equal(c.node('intent-revision').textContent, '2');
    const request = called(c, 'receipt')[0].body;
    assert.deepEqual(Object.keys(request).sort(), ['compact_jws', 'intent_id']);
    assert.equal(request.intent_id, id);
    assert.equal(request.compact_jws === f.primaryReceipt, true, 'Send the exact supplied compact receipt');
    assert.equal(f.inspect()[0].state, 'evidence_verified');
    assert.equal(typeof f.inspect()[0].token_digest, 'string');
    assert.equal(JSON.stringify(f.inspect()).includes(f.primaryReceipt), false, 'Native persistence excludes compact bytes');
    await status(c);
    await c.node('receipt-form').dispatch('submit');
    assert.equal(c.node('submit-receipt').disabled, true);
    originalOnly(c, f, id, 2);
    await c.click('request-cancel'); await c.click('confirm-cancel');
    await c.until(() => c.node('intent-state').textContent === 'Cancelled', 'Cancellation uses observed receipt revision');
    assert.deepEqual(called(c, 'cancel')[0].body, { intent_id: id, expected_revision: 2 });
    assert.equal(f.inspect()[0].revision, 3); assert.equal(f.inspect()[0].personal, null);
    assert.equal(c.node('receipt-input').value, ''); assert.equal(c.node('receipt-panel').hidden, true);
  }); await f.close(1);
}));

test('RCG5D-CONTROLLER-LOCAL-INPUT-BOUNDS', () => usingReview(async f => {
  await useController(f, async c => {
    await prepare(c, f);
    for (const invalid of ['', 'not-a-receipt', 'a.b', 'a.b.c ', 'a.β.c', 'a.b.' + 'c'.repeat(99997)]) {
      await c.input('receipt-input', invalid);
      assert.equal(c.node('submit-receipt').disabled, true, 'Invalid compact input stays unsent');
      await c.node('receipt-form').dispatch('submit');
      assert.equal(called(c, 'receipt').length, 0);
    }
    assert.equal(f.inspect()[0].revision, 1); assert.equal(f.inspect()[0].state, 'prepared');
    await c.input('receipt-input', f.primaryReceipt);
    assert.equal(c.node('submit-receipt').disabled, false, 'Invalid local input consumes no attempt');
    noPrivatePresentation(c, f);
  }); await f.close(1);
}));

async function refusedReceipt(f: NativeFixture, compact: string) {
  await useController(f, async c => {
    await prepare(c, f); const id = f.inspect()[0].id;
    await submit(c, compact); await settled(c);
    assert.equal(c.node('intent-panel').hidden, true); assert.equal(c.node('receipt-input').value, '');
    assert.equal(c.node('submit-receipt').disabled, true); assert.equal(c.node('request-cancel').disabled, true);
    assert.equal(f.inspect()[0].state, 'prepared'); assert.equal(f.inspect()[0].token_digest, null);
    originalOnly(c, f, id, 1);
  }); await f.close(1);
}
test('RCG5D-CONTROLLER-WRONG-RECEIPT-BINDING', () => usingReview(f => refusedReceipt(f, f.pendingReceipt)));
test('RCG5D-CONTROLLER-BAD-RECEIPT-SIGNATURE', () => usingReview(f => {
  const parts = f.primaryReceipt.split('.');
  parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
  return refusedReceipt(f, parts.join('.'));
}));

test('RCG5D-CONTROLLER-LOST-RECEIPT-RESPONSE', () => usingReview(async f => {
  await useController(f, async c => {
    await prepare(c, f); const id = f.inspect()[0].id;
    await submit(c, f.primaryReceipt); await settled(c);
    assert.equal(c.node('intent-panel').hidden, true); assert.equal(c.node('request-cancel').disabled, true);
    assert.equal(f.inspect()[0].state, 'evidence_verified');
    await status(c);
    assert.equal(c.node('intent-state').textContent, 'Evidence observed');
    assert.deepEqual(called(c, 'status')[0].body, { intent_id: id });
    await c.node('receipt-form').dispatch('submit');
    assert.equal(c.node('submit-receipt').disabled, true); originalOnly(c, f, id, 2);
  }, async (request, forward) => {
    const response = await forward(); if (!request.path.endsWith('/receipt')) return response;
    assert.equal(response.status, 200);
    const native = (await response.json()).result;
    assert.equal(native.state, 'evidence_verified'); assert.equal(native.execution_authorized, false);
    throw new TypeError('Synthetic response loss after native receipt commit');
  }); await f.close(1);
}));

test('RCG5D-CONTROLLER-UNKNOWN-PREPARED-NO-RESEND', () => usingReview(async f => {
  await useController(f, async c => {
    await prepare(c, f); const id = f.inspect()[0].id;
    await submit(c, f.primaryReceipt); await settled(c);
    assert.equal(c.node('request-cancel').disabled, true);
    await status(c);
    assert.equal(c.node('intent-state').textContent, 'Prepared');
    assert.equal(c.node('submit-receipt').disabled, true, 'An absent receipt does not authorize another attempt');
    assert.equal(c.node('receipt-input').disabled, true); assert.equal(c.node('receipt-input').value, '');
    await c.node('receipt-form').dispatch('submit'); originalOnly(c, f, id, 1);
    assert.equal(c.node('request-cancel').disabled, false, 'Explicit status permits ordinary revision-bound cancellation');
  }, async (request, forward) => {
    if (request.path.endsWith('/receipt')) throw new TypeError('Synthetic transport loss before native delivery');
    return forward();
  }); await f.close(1);
}));

test('RCG5D-CONTROLLER-UNVERIFIED-SUCCESS-REFUSED', () => usingReview(async f => {
  await useController(f, async c => {
    await prepare(c, f); const id = f.inspect()[0].id;
    await submit(c, f.primaryReceipt); await settled(c);
    assert.equal(c.node('intent-panel').hidden, true, 'Receipt success without evidence is not accepted');
    assert.equal(c.node('request-cancel').disabled, true);
    await status(c); assert.equal(c.node('intent-state').textContent, 'Evidence observed');
    originalOnly(c, f, id, 2);
  }, async (request, forward) => {
    if (!request.path.endsWith('/receipt')) return forward();
    const before = await f.request('status', { intent_id: request.body.intent_id });
    assert.equal(before.status, 200); const prior = (await before.json()).result;
    const response = await forward(); assert.equal(response.status, 200);
    const envelope = await response.json(); assert.equal(envelope.result.state, 'evidence_verified');
    envelope.result = prior; return Response.json(envelope);
  }); await f.close(1);
}));

test('RCG5D-CONTROLLER-AUTHORITY-SUCCESS-REFUSED', () => usingReview(async f => {
  await useController(f, async c => {
    await prepare(c, f); const id = f.inspect()[0].id;
    await submit(c, f.primaryReceipt); await settled(c);
    assert.equal(c.node('intent-panel').hidden, true); assert.equal(c.node('request-cancel').disabled, true);
    await status(c); assert.equal(c.node('intent-state').textContent, 'Evidence observed');
    originalOnly(c, f, id, 2);
  }, async (request, forward) => {
    const response = await forward(); if (!request.path.endsWith('/receipt')) return response;
    assert.equal(response.status, 200); const envelope = await response.json();
    envelope.result.receipt.execution_authorized = true;
    return Response.json(envelope);
  }); await f.close(1);
}));

test('RCG5D-CONTROLLER-LATE-RECEIPT-BODY-CLEARED', () => usingReview(async f => {
  const reading = deferred<void>(), release = deferred<void>();
  await useController(f, async c => {
    await prepare(c, f); const id = f.inspect()[0].id;
    await submit(c, f.primaryReceipt); await reading.promise;
    await c.click('clear-local'); release.resolve(); await turn();
    cleared(c); originalOnly(c, f, id, 2); assert.equal(f.inspect()[0].state, 'evidence_verified');
  }, async (request, forward) => {
    const response = await forward(); if (!request.path.endsWith('/receipt')) return response;
    assert.equal(response.status, 200); const bytes = new Uint8Array(await response.arrayBuffer());
    const body = new ReadableStream<Uint8Array>({ async start(stream) {
      reading.resolve(); await release.promise; stream.enqueue(bytes); stream.close();
    } });
    return new Response(body, { status: 200, headers: response.headers });
  }); await f.close(1);
}));

test('RCG5D-CONTROLLER-LATE-RECEIPT-SESSION-CHANGE', () => usingReview(async f => {
  const received = deferred<void>(), release = deferred<void>();
  await useController(f, async c => {
    await prepare(c, f); const id = f.inspect()[0].id;
    await submit(c, f.primaryReceipt); await received.promise;
    await c.input('session-input', 'different-session'); release.resolve(); await turn();
    assert.equal(c.node('receipt-input').value, ''); assert.equal(c.node('receipt-panel').hidden, true);
    assert.equal(c.node('intent-panel').hidden, true); assert.equal(c.node('preview-id').value, '');
    assert.equal(c.node('submit-receipt').disabled, true); assert.equal(c.node('request-cancel').disabled, true);
    originalOnly(c, f, id, 2);
  }, async (request, forward) => {
    const response = await forward(); if (!request.path.endsWith('/receipt')) return response;
    assert.equal(response.status, 200); const bytes = await response.arrayBuffer();
    received.resolve(); await release.promise;
    return new Response(bytes, { status: 200, headers: response.headers });
  }); await f.close(1);
}));

test('RCG5D-CONTROLLER-RECEIPT-EXPIRY-AT-ACTION', () => usingReview(async f => {
  // Only the page clock advances. Native validity and expiry enforcement stay unchanged.
  let observedNow: number | null = null;
  const received = deferred<void>(), release = deferred<void>();
  await useController(f, async c => {
    await prepare(c, f); await c.input('receipt-input', f.primaryReceipt);
    assert.equal(c.node('submit-receipt').disabled, false);
    const deadline = f.inspect()[0].expires_at, id = f.inspect()[0].id;
    observedNow = deadline;
    await c.click('submit-receipt'); await turn();
    assert.equal(called(c, 'receipt').length, 0); assert.equal(c.node('receipt-input').value, '');
    assert.equal(c.node('submit-receipt').disabled, true); assert.equal(c.node('receipt-panel').hidden, true);
    assert.equal(f.inspect()[0].revision, 1); noPrivatePresentation(c, f);
    // A local validation refusal consumed no attempt. Re-observe actual native
    // status with the real clock, then lose freshness while delivery is pending.
    observedNow = null; await status(c); await submit(c, f.primaryReceipt); await received.promise;
    observedNow = deadline; release.resolve(); await settled(c);
    assert.equal(c.node('intent-panel').hidden, true, 'Late receipt success cannot repopulate expired review');
    assert.equal(c.node('request-cancel').disabled, true); assert.equal(c.node('receipt-input').value, '');
    assert.equal(c.node('submit-receipt').disabled, true); assert.equal(c.node('refresh-intent').disabled, false);
    originalOnly(c, f, id, 2);
    await status(c); assert.equal(c.node('intent-state').textContent, 'Evidence observed');
    assert.equal(c.node('intent-amount').hidden, true, 'Explicit status remains historical after the observed deadline');
  }, async (request, forward) => {
    const response = await forward(); if (!request.path.endsWith('/receipt')) return response;
    assert.equal(response.status, 200); const bytes = await response.arrayBuffer();
    received.resolve(); await release.promise;
    return new Response(bytes, { status: 200, headers: response.headers });
  }, () => observedNow ?? Date.now()); await f.close(1);
}));

test('RCG5D-CONTROLLER-RECEIPT-PAGE-LIFECYCLE', () => usingReview(async f => {
  await useController(f, async c => {
    assert.equal(c.node('receipt-panel').hidden, true); assert.equal(c.node('receipt-input').disabled, true);
    await prepare(c, f); await c.input('receipt-input', f.primaryReceipt);
    await c.event('pagehide'); await c.event('pageshow', { persisted: true });
    cleared(c); assert.equal(called(c, 'receipt').length, 0);
    assert.equal(f.inspect()[0].revision, 1); noPrivatePresentation(c, f);
  }); await f.close(1);
}));
