import test from 'node:test';
import assert from 'node:assert/strict';
import { usingIntent } from './delegated-intent-helpers.mts';
import { startCommerceServer } from '../../apps/commerce-api/server.mts';
import { Capabilities } from '../../packages/commerce/capabilities.mts';
import { StoreSimulator } from '../../packages/commerce/simulator.mts';
import { request as httpRequest } from 'node:http';
import { usingCheckoutHttp } from './delegated-checkout-http-helpers.mts';
import { changedProof, changedPrice } from './delegated-checkout-helpers.mts';
import { CustomerAccess } from '../../packages/commerce/customer-access.mts';
import { DelegatedCheckoutApi } from '../../packages/commerce/delegated-checkout-api.mts';
import { commerceFixture } from './commerce-helpers.mts';

type HttpFixture = Parameters<Parameters<typeof usingCheckoutHttp>[0]>[0];
const intentInput = (f: HttpFixture) => ({ intent_id: f.intent.intent_id });
const receiptInput = (f: HttpFixture, token = f.token) => ({ ...intentInput(f), compact_jws: token });
async function result(response: Response, operation: string) {
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const envelope = await response.json();
  assert.deepEqual(Object.keys(envelope).sort(), ['evidence_status', 'execution_authorized', 'operation', 'profile', 'qualification', 'result']);
  assert.equal(envelope.profile, 'commerce-sqlite-diagnostic');
  assert.equal(envelope.qualification, 'candidate_contract_only');
  assert.equal(envelope.execution_authorized, false);
  assert.equal(envelope.evidence_status, 'historical_observation');
  assert.equal(envelope.operation, operation);
  return envelope.result;
}
async function refusal(response: Response, status: number, code?: string) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const value = await response.json();
  assert.deepEqual(Object.keys(value), ['error']);
  if (code) assert.equal(value.error, code);
  return value;
}
function raw(f: HttpFixture, path: string, text: string, options: { headers?: Record<string, string>; chunked?: boolean; unfinished?: boolean } = {}) {
  return new Promise<{ status: number; body: any; headers: import('node:http').IncomingHttpHeaders }>((resolve, reject) => {
    const req = httpRequest(f.server.url + path, { method: 'POST', headers: {
      authorization: 'Bearer ' + f.customerBearer, 'content-type': 'application/json',
      ...(!options.chunked ? { 'content-length': String(Buffer.byteLength(text)) } : {}), ...options.headers,
    } }, res => {
      const chunks: Buffer[] = []; res.on('data', b => chunks.push(b));
      res.on('end', () => { try { resolve({ status: res.statusCode!, body: JSON.parse(Buffer.concat(chunks).toString()), headers: res.headers }); }
        catch (error) { reject(error); } finally { req.destroy(); } });
    });
    req.on('error', reject); req.setTimeout(2000, () => req.destroy(new Error('HTTP_TEST_TIMEOUT')));
    if (options.unfinished) req.flushHeaders();
    else if (options.chunked) { req.write(text); req.end(); }
    else req.end(text);
  });
}

test('RCG4HTTP-HISTORY retained status is available without live receipt configuration', () => usingIntent(async f => {
  const caps = new Capabilities(f.kernel);
  const server = await startCommerceServer({ kernel: f.kernel, caps,
    simulator: new StoreSimulator(f.kernel, caps), customers: f.customers });
  try {
    const response = await fetch(server.url + '/v1/delegated-checkout/status', {
      method: 'POST', headers: { authorization: 'Bearer ' + f.customerBearer, 'content-type': 'application/json' },
      body: JSON.stringify({ intent_id: f.intent.intent_id }), signal: AbortSignal.timeout(3000),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.result.intent_id, f.intent.intent_id);
    assert.equal(result.result.state, 'prepared');
    assert.equal(result.execution_authorized, false);
  } finally { await server.close(); }
}));

test('RCG4HTTP-FLOW real signed receipt follows original intent and cancellation with no effects', () => usingCheckoutHttp(async f => {
  const before = f.effects();
  const prepared = await result(await f.request('prepare', f.intentRequest), 'prepare');
  assert.equal(prepared.intent_id, f.intent.intent_id); assert.equal(prepared.revision, 1);
  const captured = await result(await f.request('receipt', receiptInput(f)), 'receipt');
  assert.equal(captured.state, 'evidence_verified'); assert.equal(captured.revision, 2);
  assert.equal(captured.receipt.receipt_id, f.payload.id); assert.equal(captured.execution_authorized, false);
  assert.deepEqual(await result(await f.request('status', intentInput(f)), 'status'), captured);
  await refusal(await f.request('cancel', { ...intentInput(f), expected_revision: 1 }), 409, 'INTENT_REVISION_CONFLICT');
  assert.equal(f.record().body.revision, 2);
  const cancelled = await result(await f.request('cancel', { ...intentInput(f), expected_revision: 2 }), 'cancel');
  assert.equal(cancelled.state, 'cancelled'); assert.equal(cancelled.purchase, null); assert.equal(cancelled.receipt, null);
  assert.equal(cancelled.authority_revoked, true); assert.equal(cancelled.execution_authorized, false);
  assert.deepEqual(f.effects(), before); assert.equal(f.intentRows().length, 1);
  assert(!JSON.stringify(f.intentRows()).includes(f.token));
}));

test('RCG4HTTP-PREVIEW creates and revalidates native preview without caller prices', () => usingCheckoutHttp(async f => {
  const before = f.effects();
  const preview = await result(await f.request('preview', f.checkout.request), 'preview');
  assert.equal(preview.total_payable_minor, '6800'); assert.equal(preview.qualification, 'synthetic_only');
  assert.deepEqual(await result(await f.request('preview-status', { preview_id: preview.preview_id }), 'preview-status'), preview);
  changedPrice(f.checkout);
  await refusal(await f.request('preview-status', { preview_id: preview.preview_id }), 400, 'CHECKOUT_REJECTED');
  // The changed fixture facts are source changes, not an effect performed by the HTTP boundary.
  assert.deepEqual(f.effects().operations, before.operations);
}));

test('RCG4HTTP-CONTRACT exact customer-only contract describes the available local routes', () => usingCheckoutHttp(async f => {
  const contract = await result(await f.request('contract'), 'contract');
  assert.equal(contract.base_path, '/v1/delegated-checkout');
  assert.deepEqual(contract.routes.map((r: any) => r.operation), ['contract', 'preview', 'preview-status', 'prepare', 'status', 'receipt', 'cancel']);
  assert.deepEqual(contract.body_limits_bytes, { default: 4096, receipt: 102400, compact_jws_characters: 100000 });
  await refusal(await f.request('contract', undefined, f.owner.bearer), 404, 'NOT_FOUND');
}));

test('RCG4HTTP-UNAVAILABLE absent live configuration preserves reads and cancellation', () => usingCheckoutHttp(async f => {
  await refusal(await f.request('preview', f.checkout.request), 503, 'CHECKOUT_UNAVAILABLE');
  await refusal(await f.request('prepare', f.intentRequest), 503, 'RECEIPT_UNAVAILABLE');
  await refusal(await f.request('receipt', receiptInput(f)), 503, 'RECEIPT_UNAVAILABLE');
  assert.equal((await result(await f.request('status', intentInput(f)), 'status')).state, 'prepared');
  assert.equal((await result(await f.request('cancel', { ...intentInput(f), expected_revision: 1 }), 'cancel')).state, 'cancelled');
}, { configured: false }));

test('RCG4HTTP-SCOPE staff owners workers and foreign customer scopes cannot disclose intent', () => usingCheckoutHttp(async f => {
  for (const token of [f.owner.bearer, f.a.bearer, f.agent.bearer, f.a.workerBearer])
    await refusal(await f.request('status', intentInput(f), token), 404, 'NOT_FOUND');
  const messages: any[] = [], access = new CustomerAccess(f.kernel, p => messages.push(p));
  for (const [store_id, email] of [[f.b.store, 'shopper-fragile@example.invalid'], [f.c.store, 'shopper-apparel@example.invalid']]) {
    const challenge = access.request({ store_id, email, order_number: 'ORD-1001' }, '127.0.0.1');
    const customer = access.complete({ store_id, challenge_id: challenge.challenge_id, proof: messages.at(-1).proof });
    await refusal(await f.request('status', intentInput(f), customer.token), 404, 'NOT_FOUND');
    await refusal(await f.request('preview-status', { preview_id: f.receiptPreview.preview_id }, customer.token), 404, 'NOT_FOUND');
  }
  assert.equal(f.record().body.revision, 1);
}));

test('RCG4HTTP-AUTH-FIRST bearer and role refusal precedes unfinished large request body', () => usingCheckoutHttp(async f => {
  for (const [authorization, status, code] of [['', 403, 'ACCESS_DENIED'], ['Bearer ' + f.owner.bearer, 404, 'NOT_FOUND']] as const) {
    const response = await raw(f, '/v1/delegated-checkout/receipt', 'x'.repeat(102400), { unfinished: true, headers: { authorization } });
    assert.equal(response.status, status); assert.deepEqual(response.body, { error: code });
  }
  assert.equal(f.verifyCalls, 0); assert.equal(f.record().body.revision, 1);
}));

test('RCG4HTTP-PROOF-FIRST changed contact proof is refused before collecting receipt', () => usingCheckoutHttp(async f => {
  changedProof(f.checkout, true);
  const response = await raw(f, '/v1/delegated-checkout/receipt', 'x'.repeat(102400), { unfinished: true });
  assert.equal(response.status, 403); assert.deepEqual(response.body, { error: 'CUSTOMER_VERIFICATION_REQUIRED' });
  assert.equal(f.verifyCalls, 0); assert.equal(f.record().body.revision, 1);
}));

test('RCG4HTTP-REVOKED revoked session cannot read original history', () => usingCheckoutHttp(async f => {
  f.kernel.revoke(f.customer);
  await refusal(await f.request('status', intentInput(f)), 403, 'ACCESS_DENIED');
  assert.equal(f.record().body.revision, 1);
}));

test('RCG4HTTP-OWNER-BINDING incompatible native owners and server wrapper fail before listening', () => usingCheckoutHttp(async f => {
  const other = commerceFixture();
  try {
    assert.throws(() => new DelegatedCheckoutApi(other.kernel, { previews: f.previews }), /CHECKOUT_CONFIG_INVALID/);
    assert.throws(() => new DelegatedCheckoutApi(other.kernel, { receipts: f.receiptOwner }), /CHECKOUT_CONFIG_INVALID/);
    assert.throws(() => new DelegatedCheckoutApi(f.kernel, { previews: {} } as any), /CHECKOUT_CONFIG_INVALID/);
    await assert.rejects(startCommerceServer({ kernel: other.kernel, caps: new Capabilities(other.kernel),
      simulator: new StoreSimulator(other.kernel, new Capabilities(other.kernel)), customers: new CustomerAccess(other.kernel, () => {}),
      checkout: f.api }), /CHECKOUT_CONFIG_INVALID/);
    for (const checkout of [null, false, 0, '']) await assert.rejects(startCommerceServer({ kernel: f.kernel, caps: f.caps,
      simulator: f.simulator, customers: f.customers, checkout: checkout as any }), /CHECKOUT_CONFIG_INVALID/);
  } finally { other.cleanup(); }
}));

test('RCG4HTTP-INPUT receipt and native ID routes refuse caller authority fields', () => usingCheckoutHttp(async f => {
  const before = f.effects();
  const requests: [string, object][] = [['preview', f.checkout.request], ['preview-status', { preview_id: f.receiptPreview.preview_id }],
    ['prepare', f.intentRequest], ['status', intentInput(f)], ['receipt', receiptInput(f)], ['cancel', { ...intentInput(f), expected_revision: 1 }]];
  for (const [op, input] of requests)
    for (const extra of [{ verified: true }, { context: f.context }, { trust: {} }, { public_jwk: {} }, { provider_url: 'https://example.invalid/' }, { approved: true }])
      await refusal(await f.request(op, { ...input, ...extra }), 400, 'INVALID_INPUT');
  assert.equal(f.verifyCalls, 0); assert.deepEqual(f.effects(), before); assert.equal(f.record().body.revision, 1);
}));

test('RCG4HTTP-PARSING malformed and nonobject inputs remain bounded refusals', () => usingCheckoutHttp(async f => {
  const bad = await raw(f, '/v1/delegated-checkout/status', '{');
  assert.equal(bad.status, 400); assert.equal(bad.body.error, 'INVALID_JSON');
  const wrong = await raw(f, '/v1/delegated-checkout/status', '{}', { headers: { 'content-type': 'text/plain' } });
  assert.equal(wrong.status, 415); assert.equal(wrong.body.error, 'JSON_REQUIRED');
  for (const body of [null, [], 'anything', 42]) await refusal(await f.request('status', body), 400, 'INVALID_INPUT');
  assert.equal(f.record().body.revision, 1);
}));

test('RCG4HTTP-ROUTING unknown routes and methods cannot select the receipt allowance', () => usingCheckoutHttp(async f => {
  await refusal(await f.request('receipt'), 405, 'METHOD_NOT_ALLOWED');
  const contractPost = await f.request('contract', {}); assert.equal(contractPost.headers.get('allow'), 'GET');
  await refusal(contractPost, 405, 'METHOD_NOT_ALLOWED');
  for (const op of ['receipt/', 'receipt/extra', 'configure', 'context', 'final-use', 'execute', 'reconcile'])
    await refusal(await f.request(op, {}), 404, 'NOT_FOUND');
  await refusal(await f.request('/v1/delegated-checkout/status?intent_id=guess', intentInput(f)), 400, 'INVALID_INPUT');
  assert.equal(f.verifyCalls, 0);
}));

test('RCG4HTTP-ORIGIN established host and origin restrictions apply to checkout', () => usingCheckoutHttp(async f => {
  await refusal(await f.request('status', intentInput(f), f.customerBearer, { origin: 'https://foreign.invalid' }), 403, 'ORIGIN_DENIED');
  await refusal(await f.request('status', intentInput(f), f.customerBearer, { 'sec-fetch-site': 'cross-site' }), 403, 'ORIGIN_DENIED');
  const response = await raw(f, '/v1/delegated-checkout/status', JSON.stringify(intentInput(f)), { headers: { host: 'localhost:' + f.server.port } });
  assert.equal(response.status, 403); assert.equal(response.body.error, 'HOST_DENIED');
}));

test('RCG4HTTP-LONG-RECEIPT valid signed envelope above four KiB reaches native verification', () => usingCheckoutHttp(async f => {
  const token = await f.signing.signText(JSON.stringify(f.payload) + ' '.repeat(5000));
  assert(Buffer.byteLength(JSON.stringify(receiptInput(f, token))) > 4096);
  const captured = await result(await f.request('receipt', receiptInput(f, token)), 'receipt');
  assert.equal(captured.state, 'evidence_verified'); assert.equal(captured.receipt.receipt_id, f.payload.id);
  assert.equal(f.verifyCalls, 1); assert(!JSON.stringify(f.intentRows()).includes(token));
}));

test('RCG4HTTP-BODY-LIMIT announced and chunked oversized receipt bodies receive bounded errors', () => usingCheckoutHttp(async f => {
  const before = f.effects();
  for (const chunked of [false, true]) {
    const response = await raw(f, '/v1/delegated-checkout/receipt', 'x'.repeat(102401), { chunked });
    assert.equal(response.status, 413); assert.deepEqual(response.body, { error: 'BODY_TOO_LARGE' });
    assert.equal(response.headers['cache-control'], 'no-store');
  }
  assert.equal(f.verifyCalls, 0); assert.equal(f.record().body.revision, 1); assert.deepEqual(f.effects(), before);
}));

test('RCG4HTTP-OLD-LIMIT prior routes and all other checkout inputs retain four KiB limit', () => usingCheckoutHttp(async f => {
  const large = JSON.stringify({ padding: 'x'.repeat(4096) });
  const checkout = await raw(f, '/v1/delegated-checkout/status', large);
  assert.equal(checkout.status, 413); assert.equal(checkout.body.error, 'BODY_TOO_LARGE');
  const original = await raw(f, '/v1/actions', large, { headers: { authorization: 'Bearer ' + f.a.bearer } });
  assert.equal(original.status, 400); assert.equal(original.body.error, 'BODY_TOO_LARGE');
  assert.equal((await f.request('/health')).status, 200);
}));

test('RCG4HTTP-TOKEN-LIMIT native compact receipt bound remains below transport envelope ceiling', () => usingCheckoutHttp(async f => {
  await refusal(await f.request('receipt', receiptInput(f, 'x'.repeat(100001))), 400, 'RECEIPT_COMPACT_INVALID');
  assert.equal(f.verifyCalls, 0); assert.equal(f.record().body.revision, 1);
}));

test('RCG4HTTP-SANITIZE unexpected exceptions and signature failures never echo secret input', () => usingCheckoutHttp(async f => {
  const before = f.effects();
  await refusal(await f.request('receipt', receiptInput(f, f.token.slice(0, -8) + 'AAAAAAAA')), 400, 'RECEIPT_REJECTED');
  f.afterQuoteReads(1, () => { throw new Error(f.token + ' ' + f.customerBearer); });
  const failure = await refusal(await f.request('prepare', f.intentRequest), 500, 'INTERNAL_ERROR');
  const text = JSON.stringify([f.logs, failure]);
  assert(!text.includes(f.token)); assert(!text.includes(f.customerBearer)); assert(!text.includes(f.intent.intent_id));
  assert(f.logs.every((entry: any) => Object.keys(entry).sort().join(',') === 'code,event,status'));
  assert.deepEqual(f.effects(), before); assert.equal(f.record().body.revision, 1);
}));

test('RCG4HTTP-ASYNC-FENCES current proof context trust and source changes prevent late evidence', async () => {
  for (const change of ['proof', 'context', 'trust', 'source']) await usingCheckoutHttp(async f => {
    const pending = f.request('receipt', receiptInput(f)); await f.entered;
    if (change === 'proof') changedProof(f.checkout, true);
    else if (change === 'context') (f.context as any).revision++;
    else if (change === 'trust') f.signing.verifier.close();
    else changedPrice(f.checkout);
    f.release(); const response = await pending;
    assert.notEqual(response.status, 200); assert.deepEqual(Object.keys(await response.json()), ['error']);
    assert.equal(f.record().body.revision, 1); assert.equal(f.record().body.receipt_fingerprint, null);
  }, { receiptOptions: { hold: true } });
});

test('RCG4HTTP-CANCEL-INFLIGHT HTTP cancellation wins over pending signature verification', () => usingCheckoutHttp(async f => {
  const pending = f.request('receipt', receiptInput(f)); await f.entered;
  const cancelled = await result(await f.request('cancel', { ...intentInput(f), expected_revision: 1 }), 'cancel');
  assert.equal(cancelled.state, 'cancelled'); f.release();
  await refusal(await pending, 409, 'INTENT_REVOKED'); assert.equal(f.record().body.receipt_fingerprint, null);
}, { receiptOptions: { hold: true } }));

test('RCG4HTTP-CONCURRENT simultaneous HTTP captures converge on one retained observation', () => usingCheckoutHttp(async f => {
  const first = f.request('receipt', receiptInput(f)), second = f.request('receipt', receiptInput(f));
  await f.entered; f.release();
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual(await result(a, 'receipt'), await result(b, 'receipt'));
  assert.equal(f.record().body.revision, 2); assert.equal(f.intentRows().length, 1);
}, { receiptOptions: { hold: true } }));

test('RCG4HTTP-RETRY exact receipt retries remain historical after server reconfiguration and expiry', () => usingCheckoutHttp(async f => {
  const original = await result(await f.request('receipt', receiptInput(f)), 'receipt');
  await f.restartServer(false);
  assert.deepEqual(await result(await f.request('receipt', receiptInput(f)), 'receipt'), original);
  await refusal(await f.request('receipt', receiptInput(f, f.token + 'A')), 409, 'INTENT_RECEIPT_CONFLICT');
  f.advance(21000);
  const expired = await result(await f.request('status', intentInput(f)), 'status');
  assert.equal(expired.state, 'expired'); assert.equal(expired.revision, 3);
  assert.equal(expired.expires_at, original.expires_at);
  f.advance(-21000); await f.restartServer(false);
  assert.equal((await result(await f.request('status', intentInput(f)), 'status')).state, 'expired');
  assert.equal(f.verifyCalls, 1);
}));
