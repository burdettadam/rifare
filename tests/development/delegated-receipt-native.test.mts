import test from 'node:test';
import assert from 'node:assert/strict';
import { usingNativeReceipt } from './delegated-receipt-native-helpers.mts';
import { changedProof, changedPrice, changedTerms, customerScope } from './delegated-checkout-helpers.mts';
import { DelegatedCheckoutReceipts } from '../../packages/commerce/delegated-checkout-receipts.mts';
import { PrivacyLifecycle } from '../../packages/commerce/privacy-lifecycle.mts';
import { clone } from './receipt-signature-helpers.mts';

test('RCG3-NATIVE-SIGNED-EVIDENCE real signature binds native cart without merchant effects', async () => {
  for (const algorithm of ['ES256','EdDSA'] as const) await usingNativeReceipt(async f => {
    const before = f.effects(), result = await f.verify();
    assert.equal(f.receiptPreview.total_payable_minor, '6800');
    assert.equal(result.operation_digest, 'sha256:' + f.receiptPreview.preview_digest);
    assert.equal(result.receipt_id, f.payload.id); assert.equal(result.challenge, f.context.challenge);
    assert.equal(result.execution_authorized, false); assert.equal(result.qualification, 'candidate_contract_only');
    assert(Object.isFrozen(result)); assert.deepEqual(f.effects(), before);
    assert.equal(f.verifyCalls, 1);
  }, { algorithm });
});

test('RCG3-NATIVE-UNAVAILABLE no configuration cannot accept even a signed receipt', () => usingNativeReceipt(async f => {
  const absent = new DelegatedCheckoutReceipts(f.kernel, f.previews);
  assert.equal(absent.available, false);
  await assert.rejects(absent.verify(f.customer, f.request), /RECEIPT_UNAVAILABLE/);
  assert.equal(f.verifyCalls, 0);
}));

test('RCG3-NATIVE-REQUEST request cannot inject expectations snapshots or context facts', () => usingNativeReceipt(async f => {
  for (const extra of [{ expected: f.context }, { preview: f.receiptPreview }, { maximum_minor: '999999' }, { verified: true }])
    await assert.rejects(f.receiptOwner.verify(f.customer, { ...f.request, ...extra } as any));
  for (const request of [{ ...f.request, preview_id: 'missing' }, { ...f.request, context_id: 'missing' }])
    await assert.rejects(f.receiptOwner.verify(f.customer, request));
  assert.equal(f.verifyCalls, 0);
  assert.equal((await f.verify()).execution_authorized, false);
}));

test('RCG3-NATIVE-SCOPE tenant store customer resource and agent isolation remains native', () => usingNativeReceipt(async f => {
  for (const scope of [f.a.scope, f.agent.scope, f.b.scope, f.c.scope,
    customerScope(f.checkout, f.a.store, 'ORD-1002', 'other-apparel@example.invalid'),
    customerScope(f.checkout, f.b.store, 'ORD-1001', 'shopper-fragile@example.invalid'),
    customerScope(f.checkout, f.c.store, 'ORD-1001', 'shopper-apparel@example.invalid')])
    await assert.rejects(f.receiptOwner.verify(scope, f.request));
  assert.equal(f.verifyCalls, 0); await f.verify();
}));

test('RCG3-NATIVE-CONTEXT-BOUNDARY context must belong to the exact original native preview', () => usingNativeReceipt(async f => {
  for (const field of ['tenant_id','store_id','resource_id','customer_id','preview_id','preview_digest'] as const) {
    (f.context as any)[field] = 'wrong';
    await assert.rejects(f.verify(), /RECEIPT_CONTEXT_MISMATCH/); f.restoreContext();
  }
  assert.equal(f.verifyCalls, 0);
}));

test('RCG3-NATIVE-CLAIM-SUBSTITUTION valid signatures cannot replace bound facts', () => usingNativeReceipt(async f => {
  for (const [section, field, value] of [
    ['operation','request_digest','sha256:'+'a'.repeat(64)], ['operation','audience','urn:other:audience'],
    ['actor','id','urn:other:actor'], ['subject','id','urn:other:subject'], ['grant','revision',2],
    ['binding','key_thumbprint','sha256:'+'b'.repeat(64)],
  ] as const) {
    const payload = clone(f.payload); payload.evaluation[section][field] = value;
    const token = await f.signing.sign(payload);
    await assert.rejects(f.receiptOwner.verify(f.customer, { ...f.request, compact_jws: token }), /RECEIPT_.*MISMATCH/);
  }
  const payload = clone(f.payload); payload.evaluation.challenge = 'changed_challenge_123456789012345';
  await assert.rejects(f.receiptOwner.verify(f.customer, { ...f.request, compact_jws: await f.signing.sign(payload) }), /CHALLENGE_MISMATCH/);
}));

test('RCG3-NATIVE-LOCAL-CEILING signed permit does not override local amount or currency', () => usingNativeReceipt(async f => {
  for (const limit of [{ currency: 'USD', maximum_minor: '6799' }, { currency: 'CAD', maximum_minor: '8000' }]) {
    (f.context as any).delegated_ceiling = limit;
    await assert.rejects(f.verify(), limit.currency === 'USD' ? /LOCAL_LIMIT_EXCEEDED/ : /LOCAL_LIMIT_INVALID/); f.restoreContext();
  }
  assert.equal(f.verifyCalls, 0);
}));

test('RCG3-NATIVE-CURRENT-AUTHORITY authority lost during real signature work denies completion', async () => {
  for (const loss of ['revoke','proof','erase','uninstall','expiry'] as const) await usingNativeReceipt(async f => {
    const pending = f.verify(); await f.entered;
    if (loss === 'revoke') f.kernel.revoke(f.customer);
    if (loss === 'proof') changedProof(f.checkout);
    if (loss === 'erase') new PrivacyLifecycle(f.kernel).erase(f.ownerScope, f.original.customer_id);
    if (loss === 'uninstall') new PrivacyLifecycle(f.kernel).uninstall(f.ownerScope);
    if (loss === 'expiry') f.advance(1000);
    f.release(); await assert.rejects(pending);
  }, { hold: true, near_session_expiry: loss === 'expiry' });
});

test('RCG3-NATIVE-CURRENT-SOURCES quote price stock terms and purchase changes deny', async () => {
  for (const change of ['quote','price','stock','terms','purchase'] as const) await usingNativeReceipt(async f => {
    const pending = f.verify(); await f.entered;
    if (change === 'quote') f.quote('fee', { expected_revision: 1, amount_minor: '100', explicit_zero: false });
    if (change === 'price') changedPrice(f.checkout);
    if (change === 'stock') f.native.fixtureStock('basic', 0);
    if (change === 'terms') changedTerms(f.checkout);
    if (change === 'purchase') f.catalogSource.fixturePurchase(f.cartPreview.cart_id, 'later-purchase');
    f.release(); await assert.rejects(pending);
  }, { hold: true });
});

test('RCG3-NATIVE-CONTEXT-REVOCATION removed changed or same-revision context changes deny', async () => {
  for (const change of ['remove','revision','challenge'] as const) await usingNativeReceipt(async f => {
    const pending = f.verify(); await f.entered;
    if (change === 'remove') f.removeContext();
    if (change === 'revision') (f.context as any).revision++;
    if (change === 'challenge') (f.context as any).challenge = 'changed_challenge_123456789012345';
    f.release(); await assert.rejects(pending, /CONTEXT_CHANGED/);
  }, { hold: true });
});

test('RCG3-NATIVE-RETIRE retiring trust or service prevents in-flight evidence', async () => {
  for (const retire of ['trust','service'] as const) await usingNativeReceipt(async f => {
    const pending = f.verify(); await f.entered;
    if (retire === 'trust') f.signing.verifier.close(); else f.receiptOwner.close();
    f.release(); await assert.rejects(pending, /RETIRED|UNAVAILABLE/);
  }, { hold: true });
});

test('RCG3-NATIVE-LAST-SOURCE-FENCE context and trust changes in final quote reads deny', async () => {
  for (const loss of ['context','trust','proof','expiry'] as const) await usingNativeReceipt(async f => {
    const pending = f.verify(); await f.entered;
    f.afterQuoteReads(2, () => {
      if (loss === 'context') (f.context as any).revision++;
      if (loss === 'trust') f.signing.verifier.close();
      if (loss === 'proof') changedProof(f.checkout);
      if (loss === 'expiry') f.advance(20000);
    });
    f.release(); await assert.rejects(pending);
  }, { hold: true });
});

test('RCG3-NATIVE-DEADLINES original receipt preview and context deadlines cannot extend', async () => {
  for (const boundary of ['receipt','preview','context'] as const) await usingNativeReceipt(async f => {
    if (boundary === 'context') (f.context as any).valid_until = f.now() + 1000;
    const pending = f.verify(); await f.entered;
    f.advance(boundary === 'context' ? 1000 : boundary === 'receipt' ? 20000 : 60000);
    f.release(); await assert.rejects(pending, /EXPIRED|STALE|NOT_FOUND/);
  }, { hold: true });
});

test('RCG3-NATIVE-RECOVERY recovery quarantine blocks completion', () => usingNativeReceipt(async f => {
  const pending = f.verify(); await f.entered;
  f.db.prepare('INSERT INTO commerce_recovery_state VALUES(1,?,?,?,?,?)').run('receipt-restore','quarantine','a'.repeat(64),'b'.repeat(64),f.now());
  f.release(); await assert.rejects(pending, /RESTORE_EGRESS_BLOCKED/);
}, { hold: true }));

test('RCG3-NATIVE-CAPACITY pending work is bounded and slots recover after settlement', () => usingNativeReceipt(async f => {
  const pending = f.verify(); await f.entered;
  await assert.rejects(f.verify(), /VERIFICATION_CAPACITY/);
  f.release(); await pending;
  await f.verify(); assert.equal(f.verifyCalls, 2);
}, { hold: true, max_pending: 1 }));

test('RCG3-NATIVE-TIMEOUT late signature settlement cannot create evidence or retry', () => usingNativeReceipt(async f => {
  const before = f.effects(), pending = f.verify(); await f.entered;
  await assert.rejects(pending, /VERIFICATION_TIMEOUT/);
  f.release(); await new Promise<void>(done => setImmediate(done));
  assert.equal(f.verifyCalls, 1); assert.deepEqual(f.effects(), before);
}, { hold: true, verification_timeout_ms: 20 }));

test('RCG3-NATIVE-REPEATED-EVIDENCE repeated verification does not claim one-time redemption', () => usingNativeReceipt(async f => {
  const before = f.effects(), first = await f.verify(), second = await f.verify();
  assert.deepEqual(second, first); assert.equal(second.execution_authorized, false);
  assert.deepEqual(f.effects(), before);
}));

test('RCG3-NATIVE-CONFIG-CAPTURE configured methods and limits cannot be replaced in flight', () => usingNativeReceipt(async f => {
  f.config.contexts.resolve = () => { throw new Error('replacement resolver'); };
  f.config.jose.verify = async () => { throw new Error('replacement verifier'); };
  f.config.jose.assertCurrent = () => { throw new Error('replacement trust guard'); };
  f.config.contexts.assertCurrent = () => { throw new Error('replacement context guard'); };
  (f.config as any).max_pending = 0;
  assert.equal((await f.verify()).execution_authorized, false);
}));

test('RCG3-NATIVE-CLOCK final fractional and regressed clocks deny', async () => {
  for (const offset of [-1,0.5]) await usingNativeReceipt(async f => {
    const pending = f.verify(); await f.entered; f.advance(offset); f.release();
    await assert.rejects(pending, /CLOCK_INVALID|EXPIRED_OR_STALE/);
  }, { hold: true });
});

test('RCG3-NATIVE-REQUEST-SNAPSHOT caller edits cannot replace the original pending IDs or token', () => usingNativeReceipt(async f => {
  const request = clone(f.request), pending = f.receiptOwner.verify(f.customer, request); await f.entered;
  request.preview_id = 'replacement'; request.context_id = 'replacement'; request.compact_jws = 'replacement';
  f.release(); const receipt = await pending;
  assert.equal(receipt.checkout_preview_digest, f.receiptPreview.preview_digest);
  assert.equal(receipt.challenge, f.originalContext.challenge);
}, { hold: true }));

test('RCG3-NATIVE-SYNCHRONOUS-FENCES asynchronous or boolean assertions are not completed fences', () => usingNativeReceipt(async f => {
  for (const port of ['jose','contexts'] as const) for (const guard of [
    async () => undefined, () => Promise.reject(new Error('incomplete assertion')), () => false,
  ]) {
    const owner = new DelegatedCheckoutReceipts(f.kernel, f.previews,
      { ...f.config, [port]: { ...f.config[port], assertCurrent: guard as any } });
    try { await assert.rejects(owner.verify(f.customer, f.request), /TRUST_INVALID|CONTEXT_INVALID/); }
    finally { owner.close(); }
  }
}));

test('RCG3-NATIVE-RAW-REVISION signed fractional numeric aliases cannot become an expected integer', () => usingNativeReceipt(async f => {
  for (const spelling of ['1.000000000000000000001','0.999999999999999999999','1e0',
    '9007199254740993','9007199254740991.0000001','-0','1.0']) {
    const raw = JSON.stringify(f.payload).replaceAll('"revision":1', '"revision":'+spelling);
    assert.equal(raw.split('"revision":'+spelling).length-1, 2);
    const token = await f.signing.signText(raw);
    await assert.rejects(f.receiptOwner.verify(f.customer, { ...f.request, compact_jws: token }), /SIGNATURE_INVALID|JSON_INVALID/);
  }
}));
