import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { usingReview } from './delegated-checkout-review-helpers.mts';
import { controllerFixture } from './delegated-checkout-controller-helpers.mts';
import type { Fault } from './delegated-checkout-controller-helpers.mts';

type Controller = ReturnType<typeof controllerFixture>;
type NativeFixture = Parameters<Parameters<typeof usingReview>[0]>[0];
async function enter(c: Controller, f: NativeFixture, original = f.original) {
  await c.input('session-input', f.bearer); await c.click('use-session');
  assert.equal(c.node('session-input').value, '');
  await c.input('preview-id', original.preview_id); await c.input('context-id', original.context_id);
}
async function review(c: Controller, f: NativeFixture) {
  await enter(c, f); await c.click('load-preview');
  await c.until(() => !c.node('preview-panel').hidden && !c.node('prepare-intent').disabled, 'Native preview visible');
}
async function prepare(c: Controller, f: NativeFixture) {
  await review(c, f); await c.click('prepare-intent');
  await c.until(() => !c.node('intent-panel').hidden && !c.node('refresh-intent').disabled, 'Native intent visible');
}
async function cancel(c: Controller) {
  await c.click('request-cancel'); assert.equal(c.node('cancel-confirmation').hidden, false);
  await c.click('confirm-cancel');
}
const called = (c: Controller, operation: string) => c.calls.filter(call => call.path.endsWith('/' + operation));
const turn = () => new Promise(resolve => setTimeout(resolve, 15));
function clearedPurchase(c: Controller) {
  for (const id of ['preview-items', 'preview-subtotal', 'preview-tax', 'preview-shipping',
    'preview-fees', 'preview-total', 'preview-deadline', 'intent-money'])
    assert.equal(c.node(id).textContent, '', 'Private dynamic content must be removed: ' + id);
}
function clearedDetails(c: Controller) {
  clearedPurchase(c);
  for (const id of ['reference-details', 'intent-state', 'intent-message', 'intent-revision',
    'receipt-state', 'intent-deadline', 'cancel-revision'])
    assert.equal(c.node(id).textContent, '', 'Cleared page must not retain dynamic details: ' + id);
}
async function useController(f: NativeFixture, run: (c: Controller) => Promise<void>, fault?: Fault, now?: () => number) {
  const c = controllerFixture(f.url, fault, now); try { await run(c); } finally { await c.dispose(); }
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

test('RCG5C-HTTP-SERVED-ASSETS', () => usingReview(async f => {
  for (const [path, mime, source] of [
    ['/checkout-review', 'text/html', 'checkout-review.html'],
    ['/checkout-review-client.js', 'text/javascript', 'checkout-review-client.js'],
    ['/checkout-review.css', 'text/css', 'checkout-review.css'],
  ]) {
    const response = await f.request(path, undefined, '');
    assert.equal(response.status, 200); assert.ok(response.headers.get('content-type')?.startsWith(mime));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('content-security-policy'), "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    assert.equal(await response.text(), readFileSync(new URL('../../apps/commerce-api/' + source, import.meta.url), 'utf8'));
  }
  assert.notEqual((await f.request('/checkout-review?session=untrusted', undefined, '')).status, 200);
  assert.notEqual((await f.request('/checkout-review', {}, '')).status, 200);
  await f.close(0);
}));

test('RCG5C-CONTROLLER-NATIVE-JOURNEY', () => usingReview(async f => {
  await useController(f, async c => {
    await prepare(c, f); assert.equal(f.inspect().length, 1);
    assert.deepEqual(called(c, 'prepare')[0].body, f.original);
    const first = f.inspect()[0]; assert.equal(first.revision, 1);
    await c.click('refresh-intent');
    await c.until(() => !c.node('request-cancel').disabled, 'Status enables cancellation');
    await c.click('request-cancel'); await c.click('keep-intent');
    assert.equal(called(c, 'cancel').length, 0);
    await cancel(c);
    await c.until(() => c.node('intent-state').textContent.toLowerCase().includes('cancel'), 'Cancelled status');
    assert.deepEqual(called(c, 'cancel')[0].body, { intent_id: first.id, expected_revision: 1 });
    const final = f.inspect()[0]; assert.equal(final.id, first.id); assert.equal(final.revision, 2);
    assert.equal(final.state, 'cancelled'); assert.equal(final.personal, null);
    clearedPurchase(c);
    assert.equal(c.node('preview-panel').hidden, true); assert.equal(c.node('request-cancel').disabled, true);
    assert.equal(called(c, 'prepare').length, 1);
  }); await f.close(1);
}));

test('RCG5C-CONTROLLER-LOST-PREPARE', () => usingReview(async f => {
  let committedId = '';
  await useController(f, async c => {
    await review(c, f); await c.click('prepare-intent');
    await c.until(() => !c.node('recover-intent').disabled, 'Explicit recovery after lost response');
    assert.equal(c.node('prepare-intent').disabled, true); assert.equal(c.node('intent-panel').hidden, true);
    clearedDetails(c);
    assert.equal(f.inspect().length, 1); assert.equal(f.inspect()[0].id, committedId);
    assert.equal(c.node('preview-id').readOnly || c.node('preview-id').disabled, true);
    await c.click('recover-intent');
    await c.until(() => !c.node('intent-panel').hidden && !c.node('refresh-intent').disabled, 'Recovered original');
    assert.deepEqual(called(c, 'lookup')[0].body, f.original);
    await c.click('refresh-intent'); await c.until(() => !c.node('request-cancel').disabled, 'Recovered status');
    assert.equal(called(c, 'status')[0].body.intent_id, committedId);
    assert.equal(called(c, 'prepare').length, 1); assert.equal(f.inspect()[0].revision, 1);
  }, async (request, forward) => {
    const response = await forward();
    if (!request.path.endsWith('/prepare')) return response;
    assert.equal(response.status, 200); committedId = (await response.json()).result.intent_id;
    throw new TypeError('Synthetic delivery loss after actual native commit');
  }); await f.close(1);
}));

test('RCG5C-CONTROLLER-ABSENCE-NO-RETRY', () => usingReview(async f => {
  await useController(f, async c => {
    await enter(c, f); await c.click('recover-intent');
    await c.until(() => !c.node('recover-intent').disabled, 'Explicit lookup settled');
    assert.equal(c.node('intent-panel').hidden, true); assert.equal(c.node('prepare-intent').disabled, true);
    assert.equal(called(c, 'prepare').length, 0); assert.equal(f.inspect().length, 0);
    assert.equal(c.node('preview-id').readOnly || c.node('preview-id').disabled, true);
  }); await f.close(0);
}));

test('RCG5C-CONTROLLER-LOST-CANCEL', () => usingReview(async f => {
  await useController(f, async c => {
    await prepare(c, f); const original = f.inspect()[0]; await cancel(c);
    await c.until(() => !c.node('refresh-intent').disabled, 'Status after lost cancellation');
    assert.equal(c.node('request-cancel').disabled, true); assert.equal(c.node('intent-panel').hidden, true);
    clearedDetails(c);
    await c.click('refresh-intent');
    await c.until(() => c.node('intent-state').textContent.toLowerCase().includes('cancel'), 'Observe original cancellation');
    assert.equal(called(c, 'cancel').length, 1); assert.equal(f.inspect()[0].id, original.id);
    assert.equal(f.inspect()[0].revision, 2); assert.equal(c.node('preview-panel').hidden, true);
  }, async (request, forward) => {
    const response = await forward();
    if (!request.path.endsWith('/cancel')) return response;
    assert.equal(response.status, 200); await response.arrayBuffer(); throw new TypeError('Actual cancellation response discarded');
  }); await f.close(1);
}));

test('RCG5C-CONTROLLER-REVISION-CONFLICT', () => usingReview(async f => {
  await useController(f, async c => {
    await prepare(c, f); await cancel(c);
    await c.until(() => !c.node('refresh-intent').disabled, 'Conflict requires status');
    assert.equal(c.node('request-cancel').disabled, true);
    assert.equal(called(c, 'cancel').length, 1); assert.equal(f.inspect()[0].revision, 2);
    await c.click('refresh-intent');
    await c.until(() => c.node('intent-state').textContent.toLowerCase().includes('cancel'), 'Refreshed terminal state');
    assert.equal(called(c, 'cancel').length, 1);
  }, async (request, forward) => {
    if (request.path.endsWith('/cancel')) {
      // A different caller really cancels at revision 1 before the UI's same request arrives.
      const concurrent = await f.request('cancel', request.body); assert.equal(concurrent.status, 200); await concurrent.arrayBuffer();
    }
    return forward();
  }); await f.close(1);
}));

test('RCG5C-CONTROLLER-LATE-READ-CLEARED', () => usingReview(async f => {
  const received = deferred<void>(), release = deferred<void>();
  await useController(f, async c => {
    await enter(c, f); await c.click('load-preview'); await received.promise;
    await c.click('clear-local'); release.resolve(); await turn();
    assert.equal(c.node('preview-panel').hidden, true); assert.equal(c.node('intent-panel').hidden, true);
    assert.equal(c.node('preview-id').value, ''); assert.equal(c.node('context-id').value, '');
    assert.equal(c.node('session-input').value, ''); assert.equal(c.node('prepare-intent').disabled, true);
    clearedDetails(c);
  }, async (_request, forward) => {
    const response = await forward(), bytes = await response.arrayBuffer(); received.resolve(); await release.promise;
    return new Response(bytes, { status: response.status, headers: response.headers });
  }); await f.close(0);
}));

test('RCG5C-CONTROLLER-LATE-MUTATION-SESSION', () => usingReview(async f => {
  const received = deferred<void>(), release = deferred<void>();
  await useController(f, async c => {
    await review(c, f); await c.click('prepare-intent'); await received.promise;
    await c.input('session-input', 'different-session'); release.resolve(); await turn();
    assert.equal(f.inspect().length, 1); assert.equal(c.node('intent-panel').hidden, true);
    assert.equal(c.node('preview-panel').hidden, true); assert.equal(c.node('preview-id').value, '');
    assert.equal(c.node('request-cancel').disabled, true); assert.equal(c.node('prepare-intent').disabled, true);
    clearedDetails(c);
    assert.equal(called(c, 'prepare').length, 1);
  }, async (request, forward) => {
    const response = await forward(); if (!request.path.endsWith('/prepare')) return response;
    const bytes = await response.arrayBuffer(); assert.equal(response.status, 200); received.resolve(); await release.promise;
    return new Response(bytes, { status: 200, headers: response.headers });
  }); await f.close(1);
}));

test('RCG5C-CONTROLLER-INVALID-MUTATION-RESPONSE', () => usingReview(async f => {
  await useController(f, async c => {
    await review(c, f); await c.click('prepare-intent');
    await c.until(() => !c.node('recover-intent').disabled, 'Invalid successful response leaves unknown outcome');
    assert.equal(c.node('intent-panel').hidden, true); assert.equal(c.node('prepare-intent').disabled, true);
    clearedDetails(c);
    assert.equal(f.inspect().length, 1);
    await c.click('recover-intent'); await c.until(() => !c.node('intent-panel').hidden, 'Explicit lookup after invalid response');
    assert.equal(called(c, 'prepare').length, 1);
  }, async (request, forward) => {
    const response = await forward(); if (!request.path.endsWith('/prepare')) return response;
    const envelope = await response.json(); envelope.execution_authorized = true;
    return Response.json(envelope);
  }); await f.close(1);
}));

test('RCG5C-CONTROLLER-LOOKUP-BINDING', () => usingReview(async f => {
  const saved = await f.request('prepare', f.original); assert.equal(saved.status, 200); await saved.arrayBuffer();
  let corrupt = true;
  await useController(f, async c => {
    await enter(c, f); await c.click('recover-intent');
    await c.until(() => !c.node('recover-intent').disabled, 'Mismatched lookup refused');
    assert.equal(c.node('intent-panel').hidden, true); assert.equal(c.node('request-cancel').disabled, true);
    corrupt = false; await c.click('recover-intent'); await c.until(() => !c.node('intent-panel').hidden, 'Original lookup accepted');
    assert.equal(called(c, 'prepare').length, 0);
  }, async (request, forward) => {
    const response = await forward(); if (!corrupt || !request.path.endsWith('/lookup')) return response;
    const envelope = await response.json(); envelope.result.original.context_id = f.pending.context_id;
    return Response.json(envelope);
  }); await f.close(1);
}));

test('RCG5C-CONTROLLER-REVOKED-SESSION', () => usingReview(async f => {
  await useController(f, async c => {
    await prepare(c, f);
    const logout = await f.request('/v1/session/logout', {}); assert.equal(logout.status, 200); await logout.arrayBuffer();
    await c.click('refresh-intent'); await c.until(() => c.node('intent-panel').hidden && !c.node('workflow-notice').textContent.includes('…'), 'Revocation clears history');
    assert.equal(c.node('preview-panel').hidden, true); assert.equal(c.node('request-cancel').disabled, true);
    assert.equal(c.node('prepare-intent').disabled, true);
    clearedDetails(c);
  }); await f.close(1);
}));

test('RCG5C-CONTROLLER-PAGE-LIFECYCLE', () => usingReview(async f => {
  await useController(f, async c => {
    await prepare(c, f); await c.event('pagehide'); await c.event('pageshow', { persisted: true });
    assert.equal(c.node('intent-panel').hidden, true); assert.equal(c.node('preview-panel').hidden, true);
    for (const id of ['session-input', 'preview-id', 'context-id']) assert.equal(c.node(id).value, '');
    assert.equal(c.node('prepare-intent').disabled, true); assert.equal(c.node('request-cancel').disabled, true);
    clearedDetails(c);
    assert.equal(called(c, 'prepare').length, 1);
  }); await f.close(1);
}));

test('RCG5C-CONTROLLER-BOUNDED-RESPONSE', () => usingReview(async f => {
  await useController(f, async c => {
    await enter(c, f); await c.click('load-preview');
    await c.until(() => !c.node('load-preview').disabled, 'Oversized response rejected');
    assert.equal(c.node('preview-panel').hidden, true); assert.equal(c.node('prepare-intent').disabled, true);
    assert.equal(called(c, 'prepare').length, 0);
  }, async (_request, forward) => {
    const response = await forward(); assert.equal(response.status, 200); await response.arrayBuffer();
    return new Response(' '.repeat(262145), { headers: { 'content-type': 'application/json' } });
  }); await f.close(0);
}));

test('RCG5C-CONTROLLER-RESPONSE-OPERATION', () => usingReview(async f => {
  await useController(f, async c => {
    await enter(c, f); await c.click('load-preview'); await c.until(() => !c.node('load-preview').disabled, 'Wrong response operation rejected');
    assert.equal(c.node('preview-panel').hidden, true); assert.equal(c.node('prepare-intent').disabled, true);
  }, async (_request, forward) => {
    const response = await forward(), envelope = await response.json(); envelope.operation = 'prepare'; return Response.json(envelope);
  }); await f.close(0);
}));

test('RCG5C-CONTROLLER-CROSS-REFERENCES', () => usingReview(async f => {
  await useController(f, async c => {
    await enter(c, f, { preview_id: f.original.preview_id, context_id: f.pending.context_id });
    await c.click('load-preview'); await c.until(() => !c.node('prepare-intent').disabled, 'Preview independent of foreign context');
    await c.click('prepare-intent'); await c.until(() => !c.node('recover-intent').disabled, 'Native mixed binding refused');
    assert.equal(c.node('intent-panel').hidden, true); assert.equal(c.node('prepare-intent').disabled, true);
    await c.click('recover-intent'); await c.until(() => !c.node('recover-intent').disabled, 'Original mixed lookup remains absent');
    assert.equal(called(c, 'prepare').length, 1); assert.equal(f.inspect().length, 0);
  }); await f.close(0);
}));

test('RCG5C-CONTROLLER-HISTORY-NO-OWNERS', () => usingReview(async f => {
  const saved = await f.request('prepare', f.original); assert.equal(saved.status, 200);
  const original = (await saved.json()).result;
  await f.restartHistory();
  await useController(f, async c => {
    await enter(c, f); await c.click('load-preview');
    await c.until(() => !c.node('load-preview').disabled, 'Missing live preview owner is unavailable');
    assert.equal(c.node('preview-panel').hidden, true); assert.equal(c.node('prepare-intent').disabled, true);
    await c.click('recover-intent'); await c.until(() => !c.node('intent-panel').hidden, 'Retained history from original references');
    await c.click('refresh-intent'); await c.until(() => !c.node('request-cancel').disabled, 'Current native proof still required');
    assert.equal(called(c, 'status')[0].body.intent_id, original.intent_id);
    assert.equal(called(c, 'prepare').length, 0); assert.equal(f.inspect()[0].revision, 1);
  }); await f.close(1);
}));

test('RCG5C-CONTROLLER-LATE-BODY-CLEARED', () => usingReview(async f => {
  const reading = deferred<void>(), release = deferred<void>();
  await useController(f, async c => {
    await enter(c, f); await c.click('load-preview'); await reading.promise;
    await c.click('clear-local'); release.resolve(); await turn();
    assert.equal(c.node('preview-panel').hidden, true); assert.equal(c.node('prepare-intent').disabled, true);
    assert.equal(c.node('preview-id').value, ''); assert.equal(called(c, 'prepare').length, 0);
    clearedDetails(c);
  }, async (_request, forward) => {
    const response = await forward(), bytes = new Uint8Array(await response.arrayBuffer());
    const body = new ReadableStream<Uint8Array>({ async start(stream) {
      reading.resolve(); await release.promise; stream.enqueue(bytes); stream.close();
    } });
    return new Response(body, { status: 200, headers: response.headers });
  }); await f.close(0);
}));

test('RCG5C-CONTROLLER-DUPLICATE-RESPONSE', () => usingReview(async f => {
  await useController(f, async c => {
    await review(c, f); await c.click('prepare-intent');
    await c.until(() => !c.node('recover-intent').disabled, 'Ambiguous JSON response rejected');
    assert.equal(c.node('intent-panel').hidden, true); assert.equal(c.node('prepare-intent').disabled, true);
    assert.equal(f.inspect().length, 1);
  }, async (request, forward) => {
    const response = await forward(); if (!request.path.endsWith('/prepare')) return response;
    const actual = await response.text();
    const ambiguous = actual.replace('"execution_authorized":false', '"execution_authorized":true,"execution_authorized":false');
    assert.notEqual(ambiguous, actual);
    return new Response(ambiguous, { headers: response.headers });
  }); await f.close(1);
}));

test('RCG5C-CONTROLLER-BODY-DEADLINE', () => usingReview(async f => {
  await useController(f, async c => {
    await review(c, f); const started = Date.now(); await c.click('prepare-intent');
    await c.until(() => !c.node('recover-intent').disabled, 'Body deadline leaves unknown original outcome', 12000);
    assert.ok(Date.now() - started < 12000);
    assert.equal(c.node('intent-panel').hidden, true); assert.equal(c.node('prepare-intent').disabled, true);
    assert.equal(called(c, 'prepare').length, 1); assert.equal(f.inspect().length, 1);
  }, async (request, forward) => {
    const response = await forward(); if (!request.path.endsWith('/prepare')) return response;
    assert.equal(response.status, 200); await response.arrayBuffer();
    return new Response(new ReadableStream<Uint8Array>({ start(stream) {
      request.init.signal!.addEventListener('abort', () => stream.error(new Error('Body delivery timed out')), { once: true });
    } }), { headers: response.headers });
  }); await f.close(1);
}));

test('RCG5C-CONTROLLER-NESTED-AUTHORITY', () => usingReview(async f => {
  await useController(f, async c => {
    await review(c, f); await c.click('prepare-intent');
    await c.until(() => !c.node('recover-intent').disabled, 'Nested authority escalation refused');
    assert.equal(c.node('intent-panel').hidden, true); assert.equal(c.node('request-cancel').disabled, true);
    assert.equal(c.node('prepare-intent').disabled, true); assert.equal(f.inspect().length, 1);
  }, async (request, forward) => {
    const response = await forward(); if (!request.path.endsWith('/prepare')) return response;
    const envelope = await response.json(); envelope.result.execution_authorized = true; return Response.json(envelope);
  }); await f.close(1);
}));

test('RCG5C-CONTROLLER-EXPIRY-AT-ACTION', () => usingReview(async f => {
  // Only the presentation clock advances; native fixture validity is not relaxed or changed.
  let now = Date.now(), deadline = 0;
  await useController(f, async c => {
    await review(c, f); assert.ok(deadline > now); now = deadline;
    await c.click('prepare-intent'); await turn();
    assert.equal(called(c, 'prepare').length, 0); assert.equal(c.node('prepare-intent').disabled, true);
    assert.equal(f.inspect().length, 0);
  }, async (_request, forward) => {
    const response = await forward(); deadline = (await response.clone().json()).result.expires_at; return response;
  }, () => now); await f.close(0);
}));
