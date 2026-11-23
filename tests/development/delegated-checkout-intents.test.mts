import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { usingIntent } from './delegated-intent-helpers.mts';
import { usingNativeReceipt } from './delegated-receipt-native-helpers.mts';
import { changedProof, customerScope } from './delegated-checkout-helpers.mts';
import { DelegatedCheckoutIntents } from '../../packages/commerce/delegated-checkout-intents.mts';
import { DelegatedCheckoutReceipts } from '../../packages/commerce/delegated-checkout-receipts.mts';
import { CommerceKernel } from '../../packages/commerce/kernel.mts';
import { ShoppingCart } from '../../packages/commerce/shopping-cart.mts';
import { CheckoutPreviews } from '../../packages/commerce/checkout-previews.mts';
import { contentDigest, canonical } from '../../packages/commerce/configuration-values.mts';
import { INTENT_KIND, intentRecords, validateIntentRows } from '../../packages/commerce/delegated-checkout-intent-records.mts';

test('RCG4-INTENT-IDENTITY preparation preserves original identity facts and deadline', () => usingIntent(f => {
  const before = f.effects(); f.advance(10);
  const retry = f.intents.prepare(f.customer, f.intentRequest);
  assert.deepEqual(retry, f.intent); assert.equal(f.intentRows().length, 1);
  assert.equal(retry.state, 'prepared'); assert.equal(retry.execution_authorized, false);
  assert.equal(retry.purchase!.total_payable_minor, '6800');
  assert.equal(retry.expires_at, f.start + 30000); assert.deepEqual(f.effects(), before);
}));

test('RCG4-INTENT-CONFLICT same original IDs cannot replace context or challenge', () => usingIntent(f => {
  for (const mutate of [() => (f.context as any).revision++,
    () => (f.context as any).challenge = 'another_challenge_123456789012345']) {
    mutate(); assert.throws(() => f.intents.prepare(f.customer, f.intentRequest), /INTENT_BINDING_CONFLICT/);
    f.restoreContext();
  }
  assert.equal(f.record().body.revision, 1);
}));

test('RCG4-INTENT-INPUT public inputs cannot supply snapshots evidence or authority', () => usingIntent(async f => {
  for (const extra of [{ preview: f.receiptPreview }, { context: f.context }, { verified: true }, { expected_revision: 1 }])
    assert.throws(() => f.intents.prepare(f.customer, { ...f.intentRequest, ...extra } as any));
  await assert.rejects(f.intents.verifyReceipt(f.customer, { intent_id: f.intent.intent_id,
    compact_jws: f.token, receipt: {} } as any));
  assert.equal(f.verifyCalls, 0);
}));

test('RCG4-INTENT-SIGNED real signature stores only historical evidence with no work', () => usingIntent(async f => {
  const before = f.effects(), result = await f.capture();
  assert.equal(result.state, 'evidence_verified'); assert.equal(result.revision, 2);
  assert.equal(result.receipt!.receipt_id, f.payload.id); assert.equal(result.execution_authorized, false);
  assert.equal(result.receipt!.operation_digest, 'sha256:' + f.receiptPreview.preview_digest);
  const rows = JSON.stringify(f.intentRows());
  assert(!rows.includes(f.token)); assert(!rows.includes('private_key')); assert(!rows.includes('session_ref'));
  assert.equal(f.record().body.token_digest!.length, 64);
  assert.deepEqual(f.effects(), before); assert.equal(f.intentRows().length, 1);
}));

test('RCG4-INTENT-RETRY exact receipt retry preserves revision and reports retained state', () => usingIntent(async f => {
  const result = await f.capture(); f.advance(21000);
  assert.deepEqual(await f.capture(), { ...result, state: 'expired', revision: 3 }); assert.equal(f.verifyCalls, 1);
  const payload = structuredClone(f.payload); payload.id = 'cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  await assert.rejects(f.intents.verifyReceipt(f.customer, { intent_id: result.intent_id,
    compact_jws: await f.signing.sign(payload) }), /INTENT_RECEIPT_CONFLICT/);
}));

test('RCG4-INTENT-CONCURRENT two owners converge on one local evidence record', () => usingIntent(async f => {
  const second = new DelegatedCheckoutIntents(f.kernel, f.receiptOwner);
  const first = f.capture(), next = second.verifyReceipt(f.customer, { intent_id: f.intent.intent_id, compact_jws: f.token });
  await f.entered; f.release();
  const results = await Promise.all([first, next]);
  assert.deepEqual(results[0], results[1]); assert.equal(f.record().body.revision, 2);
  assert.equal(f.intentRows().length, 1);
}, { hold: true }));

test('RCG4-INTENT-CANCEL local cancellation is terminal and never renews claims', () => usingIntent(async f => {
  const original = f.record().body;
  const cancelled = f.intents.cancel(f.customer, { intent_id: f.intent.intent_id, expected_revision: 1 });
  assert.equal(cancelled.state, 'cancelled'); assert.equal(cancelled.authority_revoked, true);
  assert.equal(cancelled.purchase, null); assert.equal(f.record().body.personal, null);
  assert.equal(f.record().body.challenge_fingerprint, original.challenge_fingerprint);
  await assert.rejects(f.capture(), /INTENT_REVOKED/);
  assert.throws(() => f.intents.cancel(f.customer, { intent_id: f.intent.intent_id, expected_revision: 1 }), /INTENT_REVISION_CONFLICT/);
  assert.deepEqual(f.intents.read(f.customer, f.intent.intent_id), cancelled);
}));

test('RCG4-INTENT-CANCEL-INFLIGHT cancellation wins over pending cryptography', () => usingIntent(async f => {
  const pending = f.capture(); await f.entered;
  f.intents.cancel(f.customer, { intent_id: f.intent.intent_id, expected_revision: 1 });
  f.release(); await assert.rejects(pending, /INTENT_REVOKED|INTENT_REVISION_CONFLICT/);
  assert.equal(f.record().body.state, 'cancelled'); assert.equal(f.record().body.receipt_fingerprint, null);
}, { hold: true }));

test('RCG4-INTENT-CHALLENGE-CLAIM cancellation does not free challenge for a second identity', () => usingIntent(f => {
  f.intents.cancel(f.customer, { intent_id: f.intent.intent_id, expected_revision: 1 });
  (f.context as any).context_id = 'second-context';
  assert.throws(() => f.intents.prepare(f.customer, { ...f.intentRequest, context_id: 'second-context' }), /INTENT_CHALLENGE_CONFLICT/);
  assert.equal(f.intentRows().length, 1);
}));

test('RCG4-INTENT-REENTRANT-CLAIM source callback cannot commit duplicate challenge claims', () => usingNativeReceipt(f => {
  const intents = new DelegatedCheckoutIntents(f.kernel,f.receiptOwner);
  const request = { preview_id: f.request.preview_id, context_id: f.request.context_id };
  f.afterQuoteReads(3, () => {
    (f.context as any).context_id = 'nested-context';
    try { intents.prepare(f.customer,{ ...request, context_id: 'nested-context' }); }
    finally { f.restoreContext(); }
  });
  assert.throws(() => intents.prepare(f.customer,request), /INTENT_CHALLENGE_CONFLICT/);
  assert.equal(intentRecords(f.kernel).length,0);
}));

test('RCG4-INTENT-RECEIPT-CLAIM a signed receipt identity cannot attach to another intent', () => usingIntent(async f => {
  await f.capture();
  f.intents.cancel(f.customer, { intent_id: f.intent.intent_id, expected_revision: 2 });
  Object.assign(f.context, { context_id: 'second-context', challenge: 'second_synthetic_challenge_123456789' });
  const second = f.intents.prepare(f.customer, { ...f.intentRequest, context_id: 'second-context' });
  const payload = structuredClone(f.payload); payload.evaluation.challenge = f.context.challenge;
  await assert.rejects(f.intents.verifyReceipt(f.customer, { intent_id: second.intent_id,
    compact_jws: await f.signing.sign(payload) }), /INTENT_RECEIPT_REUSED/);
  assert.equal(f.intents.read(f.customer, second.intent_id).state, 'prepared');
  assert.equal(f.record().body.personal, null); assert(f.record().body.receipt_fingerprint);
}));

test('RCG4-INTENT-ORIGINAL-BINDING a new valid context cannot replace the prepared grant', () => usingIntent(async f => {
  (f.context as any).grant.revision = 2;
  const payload = structuredClone(f.payload); payload.evaluation.grant.revision = 2;
  payload.evaluation.status.grant.revision = 2;
  await assert.rejects(f.intents.verifyReceipt(f.customer, { intent_id: f.intent.intent_id,
    compact_jws: await f.signing.sign(payload) }), /INTENT_BINDING_CONFLICT/);
  assert.equal(f.record().body.revision, 1);
}));

test('RCG4-INTENT-TERMINAL-EXPIRY observed expiry survives clock rewind and another owner', () => usingIntent(async f => {
  f.advance(30001); assert.equal(f.intents.read(f.customer,f.intent.intent_id).state,'expired');
  f.advance(-25001);
  const another = new DelegatedCheckoutIntents(f.kernel,f.receiptOwner);
  assert.equal(another.read(f.customer,f.intent.intent_id).state,'expired');
  await assert.rejects(another.verifyReceipt(f.customer,{ intent_id: f.intent.intent_id, compact_jws: f.token }), /INTENT_EXPIRED|CLOCK_INVALID/);
  assert.equal(f.record().body.receipt_fingerprint,null);
}));

test('RCG4-INTENT-EXACT-TIME nanosecond receipt boundary preserves existing profile semantics', () => usingIntent(async f => {
  const payload = structuredClone(f.payload); payload.expires_at = f.at(0).replace('.000Z','.000000001Z');
  const token = await f.signing.sign(payload);
  const recorded = await f.intents.verifyReceipt(f.customer,{ intent_id: f.intent.intent_id, compact_jws: token });
  assert.equal(recorded.state,'evidence_verified'); assert.equal(f.record().body.receipt_expires_at,f.start+1);
  f.advance(1); assert.equal(f.intents.read(f.customer,recorded.intent_id).state,'expired');
}));

test('RCG4-INTENT-HISTORICAL-TIME recomputed records cannot invent impossible evidence intervals', () => usingIntent(async f => {
  await f.capture();
  for (const mutate of [
    (b: any) => { b.personal.receipt.issued_at = f.at(-600001); },
    (b: any) => { b.personal.receipt.issued_at = f.at(0).replace('.000Z','.000000001Z'); },
    (b: any) => { b.personal = null; b.minimized = true; b.authority_revoked = true; b.revocation_reason = 'cancelled'; b.state = 'cancelled'; b.receipt_expires_at = 0; },
  ]) {
    const row: any = structuredClone(f.intentRows()[0]), body = JSON.parse(row.body); mutate(body);
    row.body = canonical(body); row.digest = contentDigest(body); row.state = body.authority_revoked ? 'revoked' : 'active';
    assert.throws(() => validateIntentRows(f.kernel,[row]), /INTENT_INTEGRITY/);
  }
}));

test('RCG4-INTENT-FINAL-CANCEL cancellation in the final source callback prevents stale completion', () => usingIntent(async f => {
  // verify entry + completion, transaction entry and post-write completion each read two quotes.
  f.afterQuoteReads(8, () => f.intents.cancel(f.customer, { intent_id: f.intent.intent_id, expected_revision: 2 }));
  await assert.rejects(f.capture(), /INTENT_REVISION_CONFLICT/);
  assert.equal(f.record().body.state, 'prepared'); assert.equal(f.record().body.revision, 1);
}));

test('RCG4-INTENT-AUTHORITY-LOSS proof context trust and expiry deny pending write', async () => {
  for (const loss of ['proof','context','trust','expiry'] as const) await usingIntent(async f => {
    const pending = f.capture(); await f.entered;
    if (loss === 'proof') changedProof(f.checkout);
    if (loss === 'context') f.removeContext();
    if (loss === 'trust') f.signing.verifier.close();
    if (loss === 'expiry') f.advance(20000);
    f.release(); await assert.rejects(pending);
    assert.equal(f.record().body.state, 'prepared'); assert.equal(f.record().body.revision, 1);
  }, { hold: true });
});

test('RCG4-INTENT-COMMIT-FENCE context change during SQL persistence rolls back evidence', () => usingIntent(async f => {
  f.db.function('retire_intent_context', () => { f.removeContext(); return 1; });
  f.db.exec(`CREATE TEMP TRIGGER retire_during_intent_update AFTER UPDATE ON commerce_support_documents
    WHEN NEW.kind='delegated_checkout_intent' BEGIN SELECT retire_intent_context(); END`);
  await assert.rejects(f.capture(), /CONTEXT_CHANGED/);
  assert.equal(f.record().body.revision, 1); assert.equal(f.record().body.receipt_fingerprint, null);
}));

test('RCG4-INTENT-COMMIT-EXPIRY crossing receipt expiry during SQL write rolls back', () => usingIntent(async f => {
  f.db.function('expire_intent_receipt', () => { f.advance(20000); return 1; });
  f.db.exec(`CREATE TEMP TRIGGER expire_during_intent_update AFTER UPDATE ON commerce_support_documents
    WHEN NEW.kind='delegated_checkout_intent' BEGIN SELECT expire_intent_receipt(); END`);
  await assert.rejects(f.capture(), /EXPIRED/);
  assert.equal(f.record().body.state, 'prepared'); assert.equal(f.record().body.revision, 1);
}));

test('RCG4-INTENT-PROVENANCE copied receipt cannot become a current verification handle', () => usingIntent(async f => {
  const actual = await f.verify();
  assert.throws(() => f.receiptOwner.assertCurrent(f.customer, structuredClone(actual)), /RECEIPT_PROVENANCE_INVALID/);
  assert.equal(f.receiptOwner.assertCurrent(f.customer, actual).preview.preview_id, f.request.preview_id);
  const other = new DelegatedCheckoutReceipts(f.kernel, f.previews, f.config);
  assert.throws(() => other.assertCurrent(f.customer, actual), /RECEIPT_PROVENANCE_INVALID/);
  other.close();
}));

test('RCG4-INTENT-SCOPE historical access retains tenant store resource and proof isolation', () => usingIntent(async f => {
  await f.capture();
  for (const scope of [f.a.scope, f.agent.scope, f.b.scope, f.c.scope,
    customerScope(f.checkout, f.a.store, 'ORD-1002', 'other-apparel@example.invalid')]) {
    assert.throws(() => f.intents.read(scope, f.intent.intent_id));
    assert.throws(() => f.intents.cancel(scope, { intent_id: f.intent.intent_id, expected_revision: 2 }));
  }
  changedProof(f.checkout); assert.throws(() => f.intents.read(f.customer, f.intent.intent_id));
}));

test('RCG4-INTENT-RESTART fresh kernel reads persisted identity without restoring previews', () => usingIntent(async f => {
  const recorded = await f.capture(); f.receiptOwner.close(); f.previews.close();
  const db = new DatabaseSync(f.filename);
  try {
    const kernel = new CommerceKernel(db, f.now);
    const customer = customerScope({ ...f.checkout, kernel } as any, f.a.store, 'ORD-1001', 'shopper-apparel@example.invalid');
    const previews = new CheckoutPreviews(kernel, new ShoppingCart(kernel));
    const receipts = new DelegatedCheckoutReceipts(kernel, previews);
    const intents = new DelegatedCheckoutIntents(kernel, receipts);
    assert.deepEqual(intents.read(customer, recorded.intent_id), recorded);
    assert.equal(receipts.available, false);
    assert.throws(() => intents.prepare(customer, f.intentRequest), /RECEIPT_UNAVAILABLE/);
    assert.equal(intentRecords(kernel).length, 1); assert.equal(recorded.execution_authorized, false);
  } finally { db.close(); }
}));

test('RCG4-INTENT-CORRUPTION digest lifecycle shape and row ownership fail closed', async () => {
  for (const flaw of ['digest','authority','version','author','receipt'] as const) await usingIntent(f => {
    const row: any = f.intentRows()[0], body = JSON.parse(row.body);
    if (flaw === 'digest') row.digest = 'a'.repeat(64);
    if (flaw === 'authority') { body.authority_revoked = true; row.body = canonical(body); row.digest = contentDigest(body); }
    if (flaw === 'version') row.version = 2;
    if (flaw === 'author') row.author = 'caller';
    if (flaw === 'receipt') { body.personal.receipt = { execution_authorized: true }; row.body = canonical(body); row.digest = contentDigest(body); }
    f.db.prepare('UPDATE commerce_support_documents SET version=?,body=?,digest=?,author=? WHERE kind=?')
      .run(row.version, row.body, row.digest, row.author, INTENT_KIND);
    assert.throws(() => f.intents.read(f.customer, f.intent.intent_id), /INTENT_INTEGRITY/);
  });
});
