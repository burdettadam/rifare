import test from 'node:test';
import assert from 'node:assert/strict';
import { usingNativeStart } from './delegated-checkout-start-helpers.mts';
import { usingNativeReceipt } from './delegated-receipt-native-helpers.mts';
import { usingCheckoutHttp } from './delegated-checkout-http-helpers.mts';
import { commerceFixture } from './commerce-helpers.mts';
import { CheckoutPreviews } from '../../packages/commerce/checkout-previews.mts';
import { DelegatedCheckoutApi } from '../../packages/commerce/delegated-checkout-api.mts';
import { DelegatedCheckoutReceipts } from '../../packages/commerce/delegated-checkout-receipts.mts';
import { DelegatedCheckoutIntents } from '../../packages/commerce/delegated-checkout-intents.mts';
import { Capabilities } from '../../packages/commerce/capabilities.mts';
import { CustomerAccess } from '../../packages/commerce/customer-access.mts';
import { StoreSimulator } from '../../packages/commerce/simulator.mts';
import { startCommerceServer } from '../../apps/commerce-api/server.mts';

function shadow(owner: object, keys: string[], counter: { calls: number }) {
  for (const key of keys) Object.defineProperty(owner, key, { configurable: true,
    get() { counter.calls++; throw new Error('untrusted instance shadow'); } });
}
function serverOptions(kernel: Parameters<typeof startCommerceServer>[0]['kernel'], checkout: unknown) {
  const caps = new Capabilities(kernel);
  return { kernel, caps, simulator: new StoreSimulator(kernel, caps),
    customers: new CustomerAccess(kernel, () => {}), checkout: checkout as DelegatedCheckoutApi };
}
async function refusesServer(kernel: Parameters<typeof startCommerceServer>[0]['kernel'], checkout: unknown) {
  let server: Awaited<ReturnType<typeof startCommerceServer>> | undefined, failure: unknown;
  try { server = await startCommerceServer(serverOptions(kernel, checkout)); }
  catch (error) { failure = error; }
  finally { if (server) await server.close(); }
  assert(failure instanceof Error, 'A forged wrapper must be rejected before listening');
  assert.equal(failure.message, 'CHECKOUT_CONFIG_INVALID');
}

test('RCG4BC4-OWNER-API-FORGED copied and proxy preview owners fail the actual private brand', () => usingNativeStart(f => {
  const copied = Object.assign(Object.create(CheckoutPreviews.prototype), {
    boundTo: () => true, prepare: async () => f.preview, read: async () => f.preview,
  });
  Object.defineProperty(copied, 'available', { value: true });
  for (const previews of [copied, new Proxy(f.previews, {})])
    assert.throws(() => new DelegatedCheckoutApi(f.kernel, { previews }), /CHECKOUT_CONFIG_INVALID/);
  assert.equal(f.claimRows().length, 0);
}));

test('RCG4BC4-OWNER-API-SHADOWS actual preview methods and availability survive instance accessor shadows', () => usingNativeStart(async f => {
  const counter = { calls: 0 };
  shadow(f.previews, ['boundTo', 'prepare', 'read', 'revalidate', 'available'], counter);
  const api = new DelegatedCheckoutApi(f.kernel, { previews: f.previews });
  const prepared = await api.post(f.customer, 'preview', f.request);
  const p = prepared.result as any;
  assert.equal(p.total_payable_minor, '6800'); assert.equal(p.cart_id, f.request.cart_id);
  const read = await api.post(f.customer, 'preview-status', { preview_id: p.preview_id });
  assert.deepEqual(read.result, p); assert.equal(counter.calls, 0);
  assert.equal(f.claimRows().length, 0);
}));

test('RCG4BC4-OWNER-API-AUTH direct canonical API calls retain private authorization', () => usingNativeStart(async f => {
  const api = new DelegatedCheckoutApi(f.kernel, { previews: f.previews }), counter = { calls: 0 };
  Object.defineProperty(api, 'authorize', { value: () => { counter.calls++; } });
  assert.throws(() => DelegatedCheckoutApi.prototype.contract.call(api, f.ownerScope), /NOT_FOUND/);
  assert.throws(() => DelegatedCheckoutApi.prototype.recoveryContract.call(api, f.ownerScope), /NOT_FOUND/);
  await assert.rejects(DelegatedCheckoutApi.prototype.post.call(api, f.ownerScope, 'preview', f.request), /NOT_FOUND/);
  assert.equal(counter.calls, 0); assert.equal(f.claimRows().length, 0);
}));

test('RCG4BC4-OWNER-SERVER-FORGED copied proxy and foreign wrappers fail before listening', () => usingNativeStart(async f => {
  const api = new DelegatedCheckoutApi(f.kernel, { previews: f.previews });
  const copied = Object.assign(Object.create(DelegatedCheckoutApi.prototype), {
    boundTo: () => true, authorize() {}, post() { return {}; }, contract() { return {}; },
  });
  await refusesServer(f.kernel, copied); await refusesServer(f.kernel, new Proxy(api, {}));
  const other = commerceFixture();
  try { await refusesServer(other.kernel, api); } finally { other.cleanup(); }
  assert.equal(f.claimRows().length, 0);
}));

test('RCG4BC4-OWNER-SERVER-SHADOWS concrete route dispatch ignores shadows before and after assembly', () => usingCheckoutHttp(async f => {
  const counter = { calls: 0 };
  shadow(f.api, ['boundTo', 'authorize', 'contract', 'post', 'recoveryContract', 'lookup'], counter);
  await f.restartServer();
  for (const [operation, input, expected] of [
    ['contract', undefined, 'contract'],
    ['preview-status', { preview_id: f.receiptPreview.preview_id }, 'preview-status'],
    ['/v1/delegated-checkout-recovery/contract', undefined, 'recovery-contract'],
    ['/v1/delegated-checkout-recovery/lookup', f.intentRequest, 'lookup'],
  ] as const) {
    const response = await f.request(operation, input);
    assert.equal(response.status, 200);
    const body = await response.json(); assert.equal(body.operation, expected);
    assert.equal(body.execution_authorized, false);
    if (expected === 'preview-status') assert.equal(body.result.preview_digest, f.receiptPreview.preview_digest);
    if (expected === 'lookup') assert.equal(body.result.intent.intent_id, f.intent.intent_id);
  }
  Object.defineProperty(f.api, 'authorize', { configurable: true,
    value() { counter.calls++; throw new Error('late overridden authorization'); } });
  assert.equal((await f.request('contract')).status, 200);
  assert.equal((await f.request('contract', undefined, f.owner.bearer)).status, 404);
  assert.equal(counter.calls, 0);
}));

test('RCG4BC4-OWNER-RECEIPT-FORGED copied and proxy previews cannot establish native receipt ownership', () => usingNativeReceipt(f => {
  const copied = Object.assign(Object.create(CheckoutPreviews.prototype), {
    boundTo: () => true, current: () => f.receiptPreview,
  });
  for (const previews of [copied, new Proxy(f.previews, {})])
    assert.throws(() => new DelegatedCheckoutReceipts(f.kernel, previews, f.config), /RECEIPT_CONFIG_INVALID/);
  assert.equal(f.verifyCalls, 0);
}));

test('RCG4BC4-OWNER-RECEIPT-SHADOWS native preview and internal binding dispatch ignore instance accessors', () => usingNativeReceipt(async f => {
  const counter = { calls: 0 };
  shadow(f.previews, ['boundTo', 'current'], counter);
  const owner = new DelegatedCheckoutReceipts(f.kernel, f.previews, f.config);
  try {
    shadow(owner, ['available', 'currentBinding'], counter);
    const receipt = await DelegatedCheckoutReceipts.prototype.verify.call(owner, f.customer, f.request);
    assert.equal(receipt.receipt_id, f.payload.id);
    assert.equal(DelegatedCheckoutReceipts.prototype.assertCurrent.call(owner, f.customer, receipt).preview, f.receiptPreview);
    assert.equal(counter.calls, 0); assert.equal(f.verifyCalls, 1);
  } finally { owner.close(); }
}));

test('RCG4BC4-OWNER-RECEIPT-CLOSED close during actual signature verification defeats shadowed availability', () => usingNativeReceipt(async f => {
  const pending = f.verify(); await f.entered;
  f.receiptOwner.close(); let calls = 0;
  Object.defineProperty(f.receiptOwner, 'available', { get() { calls++; return true; } });
  f.release(); await assert.rejects(pending, /RECEIPT_UNAVAILABLE/);
  assert.equal(calls, 0); assert.equal(f.verifyCalls, 1);
}, { hold: true }));

test('RCG4BC4-OWNER-INTENT-FORGED copied proxy and foreign receipt owners cannot create an intent owner', () => usingNativeReceipt(f => {
  const copied = Object.assign(Object.create(DelegatedCheckoutReceipts.prototype), {
    boundTo: () => true, currentBinding: () => ({ preview: f.receiptPreview, context: f.context }),
    verify: async () => ({}), assertBindingCurrent() {}, assertCurrent() {},
  });
  for (const receipts of [copied, new Proxy(f.receiptOwner, {})])
    assert.throws(() => new DelegatedCheckoutIntents(f.kernel, receipts), /INTENT_CONFIG_INVALID/);
  const other = commerceFixture();
  try { assert.throws(() => new DelegatedCheckoutIntents(other.kernel, f.receiptOwner), /INTENT_CONFIG_INVALID/); }
  finally { other.cleanup(); }
  assert.equal(f.verifyCalls, 0);
}));

test('RCG4BC4-OWNER-INTENT-SHADOWS captured concrete receipt methods preserve genuine verified evidence', () => usingNativeReceipt(async f => {
  const counter = { calls: 0 };
  shadow(f.receiptOwner, ['boundTo', 'available', 'currentBinding', 'verify', 'assertBindingCurrent', 'assertCurrent'], counter);
  const intents = new DelegatedCheckoutIntents(f.kernel, f.receiptOwner);
  const prepared = intents.prepare(f.customer, { preview_id: f.request.preview_id, context_id: f.request.context_id });
  const verified = await intents.verifyReceipt(f.customer, { intent_id: prepared.intent_id, compact_jws: f.token });
  assert.equal(verified.state, 'evidence_verified'); assert.equal(verified.receipt?.receipt_id, f.payload.id);
  assert.equal(verified.execution_authorized, false); assert.equal(f.verifyCalls, 1); assert.equal(counter.calls, 0);
}));

test('RCG4BC4-OWNER-INTENT-CLOSED closed receipt ownership stays unavailable despite a true availability shadow', () => usingNativeReceipt(f => {
  f.receiptOwner.close(); let calls = 0;
  Object.defineProperty(f.receiptOwner, 'available', { get() { calls++; return true; } });
  const intents = new DelegatedCheckoutIntents(f.kernel, f.receiptOwner);
  const before = f.db.prepare('SELECT COUNT(*) AS n FROM commerce_support_documents').get();
  assert.throws(() => intents.prepare(f.customer, { preview_id: f.request.preview_id, context_id: f.request.context_id }), /RECEIPT_UNAVAILABLE/);
  assert.deepEqual(f.db.prepare('SELECT COUNT(*) AS n FROM commerce_support_documents').get(), before);
  assert.equal(calls, 0); assert.equal(f.verifyCalls, 0);
}));

test('RCG4BC4-OWNER-DESCRIPTORS owner and command containers reject accessors without invoking them', () => usingNativeStart(f => {
  let calls = 0;
  const owners = Object.defineProperty({}, 'previews', { enumerable: true,
    get() { calls++; return f.previews; } });
  assert.throws(() => new DelegatedCheckoutApi(f.kernel, owners), /CHECKOUT_CONFIG_INVALID/);
  assert.equal(calls, 0);
  for (const key of ['correlation', 'starts']) {
    const commands = { correlation: f.correlation, starts: f.starts };
    Object.defineProperty(commands, key, { enumerable: true, get() { calls++; return key === 'starts' ? f.starts : f.correlation; } });
    assert.throws(() => new DelegatedCheckoutApi(f.kernel, { commands } as any), /CHECKOUT_CONFIG_INVALID/);
    assert.equal(calls, 0);
  }
  const inherited = Object.create({ previews: f.previews });
  assert.throws(() => new DelegatedCheckoutApi(f.kernel, inherited), /CHECKOUT_CONFIG_INVALID/);
  assert.equal(f.claimRows().length, 0);
}));
