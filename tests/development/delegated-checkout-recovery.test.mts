import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { usingIntent } from './delegated-intent-helpers.mts';
import { changedProof } from './delegated-checkout-helpers.mts';
import { verifiedCustomer } from './shopper-memory-helpers.mts';
import { CommerceKernel } from '../../packages/commerce/kernel.mts';
import type { Row, Scope } from '../../packages/commerce/kernel.mts';
import { DelegatedCheckoutIntents } from '../../packages/commerce/delegated-checkout-intents.mts';
import { INTENT_KIND, intentId, intentRecords } from '../../packages/commerce/delegated-checkout-intent-records.mts';
import type { IntentBody } from '../../packages/commerce/delegated-checkout-intent-records.mts';
import { eraseDelegatedIntents, revokeDelegatedIntentsForRestore } from '../../packages/commerce/delegated-checkout-intent-privacy.mts';
import { PrivacyLifecycle } from '../../packages/commerce/privacy-lifecycle.mts';
import { canonical, contentDigest } from '../../packages/commerce/configuration-values.mts';

type Fixture = Parameters<Parameters<typeof usingIntent>[0]>[0];
const sessionCount = (kernel: CommerceKernel): number =>
  Number((kernel.db.prepare('SELECT count(*) AS total FROM commerce_sessions').get() as Row).total);
function historyOnly(f: Fixture): DelegatedCheckoutIntents {
  f.removeContext(); f.receiptOwner.close(); f.previews.close(); f.signing.verifier.close();
  return new DelegatedCheckoutIntents(f.kernel);
}
function collidingIdentity(body: IntentBody): IntentBody {
  const original = body.identity_digest;
  return { ...body, identity_digest: original.slice(0,40) + (original[40] === 'a' ? 'b' : 'a') + original.slice(41) };
}
function replaceBody(f: Fixture, body: IntentBody): void {
  const result = f.db.prepare(`UPDATE commerce_support_documents SET body=?,digest=?
    WHERE tenant_id=? AND store_id=? AND kind=? AND id=? AND version=1`).run(
      canonical(body),contentDigest(body),body.tenant_id,body.store_id,INTENT_KIND,body.id);
  assert.equal(result.changes,1);
}
/** Arm the existing restricted-session guard at its last observed authority check. */
function finalAccessScope(f: Fixture, action: () => void): Scope {
  const session = f.kernel.require(f.customer);
  let calls = 0, trigger = Infinity;
  const scope = f.kernel.restrictedSession(session.token_hash,session.resource_id,['resource.read'],() => {
    if (++calls === trigger) action();
  },{});
  calls = 0;
  assert.deepEqual(f.intents.lookup(scope,f.intentRequest),f.intents.read(f.customer,f.intent.intent_id));
  assert(calls > 1); trigger = calls; calls = 0;
  return scope;
}

test('RCG5B-NATIVE-ORIGINAL original references recover the existing immutable historical view', () => usingIntent(f => {
  const before = f.effects(), rows = f.intentRows(), sessions = sessionCount(f.kernel);
  const result = f.intents.lookup(f.customer,f.intentRequest);
  assert.deepEqual(result,f.intent); assert.equal(result.intent_id,f.intent.intent_id);
  assert.equal(result.purchase!.total_payable_minor,'6800'); assert.equal(result.purchase!.currency,'USD');
  assert.equal(result.execution_authorized,false); assert.equal(result.evidence_status,'historical_observation');
  assert(Object.isFrozen(result)); assert(Object.isFrozen(result.purchase));
  assert.deepEqual(f.intentRows(),rows); assert.equal(sessionCount(f.kernel),sessions);
  assert.equal(f.verifyCalls,0); assert.deepEqual(f.effects(),before);
}));

test('RCG5B-NATIVE-NO-PROVENANCE signed history lookup uses no live preview context or verifier', () => usingIntent(async f => {
  const captured = await f.capture(), owner = historyOnly(f), rows = f.intentRows(), effects = f.effects();
  assert.deepEqual(owner.lookup(f.customer,f.intentRequest),captured);
  assert.deepEqual(owner.lookup(f.customer,f.intentRequest),owner.read(f.customer,captured.intent_id));
  assert.throws(() => owner.prepare(f.customer,f.intentRequest),/RECEIPT_UNAVAILABLE/);
  assert.equal(f.verifyCalls,1); assert.deepEqual(f.intentRows(),rows); assert.deepEqual(f.effects(),effects);
}));

test('RCG5B-NATIVE-RESTART another kernel recovers on-disk history with a preexisting bearer', () => usingIntent(async f => {
  const bearer = verifiedCustomer(f).bearer, captured = await f.capture();
  historyOnly(f);
  const sessions = sessionCount(f.kernel), rows = f.intentRows(), effects = f.effects();
  const db = new DatabaseSync(f.filename);
  try {
    const kernel = new CommerceKernel(db,f.now), customer = kernel.authenticate(bearer);
    const owner = new DelegatedCheckoutIntents(kernel);
    assert.deepEqual(owner.lookup(customer,f.intentRequest),captured);
    assert.throws(() => owner.prepare(customer,f.intentRequest),/RECEIPT_UNAVAILABLE/);
    assert.equal(sessionCount(kernel),sessions); assert.equal(intentRecords(kernel).length,1);
    assert.deepEqual(f.intentRows(),rows); assert.deepEqual(f.effects(),effects);
  } finally { db.close(); }
}));

test('RCG5B-NATIVE-ABSENT unknown original references never create renew or expire another intent', () => usingIntent(f => {
  const owner = historyOnly(f); f.advance(30000);
  const rows = f.intentRows(), effects = f.effects(), sessions = sessionCount(f.kernel);
  for (const request of [
    { ...f.intentRequest,preview_id:'unknown-preview' },
    { ...f.intentRequest,context_id:'unknown-context' },
    { preview_id:f.intentRequest.context_id,context_id:f.intentRequest.preview_id },
  ]) assert.throws(() => owner.lookup(f.customer,request),{ message:'NOT_FOUND' });
  assert.deepEqual(f.intentRows(),rows); assert.equal(f.record().body.expired,false);
  assert.equal(sessionCount(f.kernel),sessions); assert.equal(f.verifyCalls,0); assert.deepEqual(f.effects(),effects);
}));

test('RCG5B-NATIVE-INPUT lookup admits only the two bounded original references', () => usingIntent(f => {
  const rows = f.intentRows(), effects = f.effects();
  for (const request of [null,[],{}, { preview_id:f.intentRequest.preview_id },
    { ...f.intentRequest,context_id:'' }, { ...f.intentRequest,preview_id:'x'.repeat(97) },
    { ...f.intentRequest,context_id:'context/other' }, { ...f.intentRequest,preview_id:42 },
    { ...f.intentRequest,intent_id:f.intent.intent_id }, { ...f.intentRequest,tenant_id:f.a.tenant },
    { ...f.intentRequest,context:f.context }, { ...f.intentRequest,execution_authorized:true },
  ]) assert.throws(() => f.intents.lookup(f.customer,request as never));
  assert.deepEqual(f.intentRows(),rows); assert.deepEqual(f.effects(),effects); assert.equal(f.verifyCalls,0);
}));

test('RCG5B-NATIVE-PROOF-FIRST changed current proof is refused before existence or record parsing', () => usingIntent(f => {
  changedProof(f.checkout);
  f.db.prepare('UPDATE commerce_support_documents SET digest=? WHERE kind=?').run('a'.repeat(64),INTENT_KIND);
  const rows = f.intentRows();
  for (const request of [f.intentRequest,{ preview_id:'unknown-preview',context_id:'unknown-context' }])
    assert.throws(() => f.intents.lookup(f.customer,request),{ message:'CUSTOMER_VERIFICATION_REQUIRED' });
  assert.deepEqual(f.intentRows(),rows); assert.equal(f.verifyCalls,0);
}));

test('RCG5B-NATIVE-REVOKED current session revocation refuses present and absent references', () => usingIntent(f => {
  f.kernel.revoke(f.customer);
  const rows = f.intentRows();
  for (const request of [f.intentRequest,{ preview_id:'unknown-preview',context_id:'unknown-context' }])
    assert.throws(() => f.intents.lookup(f.customer,request),{ message:'ACCESS_DENIED' });
  assert.deepEqual(f.intentRows(),rows);
}));

test('RCG5B-NATIVE-SCOPE customer tenant store subject and role boundaries remain native', () => usingIntent(f => {
  const other = verifiedCustomer(f,f.a,'ORD-1002'), tenant = verifiedCustomer(f,f.b), store = verifiedCustomer(f,f.c);
  const rows = f.intentRows();
  for (const scope of [f.a.scope,f.agent.scope,f.b.scope,f.c.scope,other.scope,tenant.scope,store.scope])
    assert.throws(() => f.intents.lookup(scope,f.intentRequest),{ message:'NOT_FOUND' });
  assert.deepEqual(f.intentRows(),rows); assert.deepEqual(f.intents.lookup(f.customer,f.intentRequest),f.intent);
}));

test('RCG5B-NATIVE-RESOURCE another verified order for the same customer cannot recover this intent', () => usingIntent(f => {
  const original = f.kernel.lookup(f.a.scope,'order','synthetic','ORD-1001') as Row;
  f.kernel.ingest(f.a.scope,{ kind:'order',source_system:original.source_system,external_id:'ORD-RECOVERY-OTHER',
    source_version:1,source_updated_at:f.now(),customer_id:original.customer_id,payload:original.payload });
  const other = verifiedCustomer(f,f.a,'ORD-RECOVERY-OTHER');
  assert.equal(f.kernel.require(other.scope).customer_id,f.kernel.require(f.customer).customer_id);
  assert.notEqual(other.order.id,f.original.id);
  assert.throws(() => f.intents.lookup(other.scope,f.intentRequest),{ message:'NOT_FOUND' });
  assert.equal(f.intentRows().length,1);
}));

test('RCG5B-NATIVE-FULL-IDENTITY a valid minimized row with only the same 40-character prefix cannot match', () => usingIntent(f => {
  f.intents.cancel(f.customer,{ intent_id:f.intent.intent_id,expected_revision:1 });
  const original = f.record().body, forged = collidingIdentity(original);
  assert.equal(intentId(forged.identity_digest),original.id); assert.notEqual(forged.identity_digest,original.identity_digest);
  replaceBody(f,forged);
  assert.deepEqual(f.record().body,forged); // The ordinary strict record parser accepts this minimized historical shape.
  assert.equal(f.intents.read(f.customer,original.id).minimized,true);
  const rows = f.intentRows();
  assert.throws(() => f.intents.lookup(f.customer,f.intentRequest),{ message:'NOT_FOUND' });
  assert.deepEqual(f.intentRows(),rows);
}));

test('RCG5B-NATIVE-EXPIRY historical lookup observes the original expiry once without renewal', () => usingIntent(f => {
  const owner = historyOnly(f), effects = f.effects(); f.advance(30000);
  const expired = owner.lookup(f.customer,f.intentRequest);
  assert.deepEqual(expired,{ ...f.intent,state:'expired',revision:2 });
  assert.deepEqual(owner.lookup(f.customer,f.intentRequest),expired);
  assert.deepEqual(owner.read(f.customer,f.intent.intent_id),expired);
  f.advance(-1000);
  assert.deepEqual(new DelegatedCheckoutIntents(f.kernel).lookup(f.customer,f.intentRequest),expired);
  assert.equal(f.intentRows().length,1); assert.deepEqual(f.effects(),effects);
}));

test('RCG5B-NATIVE-RECEIPT-EXPIRY lookup preserves exact receipt expiry and historical evidence', () => usingIntent(async f => {
  const payload = structuredClone(f.payload); payload.expires_at = f.at(0).replace('.000Z','.000000001Z');
  const captured = await f.intents.verifyReceipt(f.customer,{ intent_id:f.intent.intent_id,compact_jws:await f.signing.sign(payload) });
  const owner = historyOnly(f); assert.deepEqual(owner.lookup(f.customer,f.intentRequest),captured);
  f.advance(1);
  const expired = owner.lookup(f.customer,f.intentRequest);
  assert.deepEqual(expired,{ ...captured,state:'expired',revision:3 });
  assert.deepEqual(owner.read(f.customer,captured.intent_id),expired); assert.equal(f.verifyCalls,1);
}));

test('RCG5B-NATIVE-CANCELLED-HELD cancellation keeps the same masked view with or without retained bytes', async () => {
  for (const held of [false,true]) await usingIntent(async f => {
    await f.capture();
    if (held) new PrivacyLifecycle(f.kernel).hold(f.ownerScope,{ customer_id:f.original.customer_id,
      reason:'retention_obligation',authority_ref:'recovery_hold',expires_at:f.now()+600000 });
    const cancelled = f.intents.cancel(f.customer,{ intent_id:f.intent.intent_id,expected_revision:2 });
    const owner = historyOnly(f), rows = f.intentRows();
    assert.equal(f.record().body.personal !== null,held);
    assert.equal(cancelled.purchase,null); assert.equal(cancelled.receipt,null); assert.equal(cancelled.minimized,!held);
    assert.deepEqual(owner.lookup(f.customer,f.intentRequest),cancelled);
    assert.deepEqual(owner.read(f.customer,cancelled.intent_id),cancelled); assert.deepEqual(f.intentRows(),rows);
  });
});

test('RCG5B-NATIVE-ERASED-RESTORED native privacy retirement cannot reconstruct personal history', async () => {
  for (const reason of ['subject_erased','restored'] as const) await usingIntent(async f => {
    await f.capture(); const original = f.record().body;
    if (reason === 'subject_erased') eraseDelegatedIntents(f.kernel,f.a.tenant,f.a.store,[original.subject_ref],[original.resource_id]);
    else revokeDelegatedIntentsForRestore(f.kernel);
    const owner = historyOnly(f), rows = f.intentRows(), expected = owner.read(f.customer,original.id);
    assert.equal(f.record().body.revocation_reason,reason); assert.equal(f.record().body.personal,null);
    assert.equal(expected.minimized,true); assert.equal(expected.authority_revoked,true);
    assert.equal(expected.purchase,null); assert.equal(expected.receipt,null); assert.equal(expected.execution_authorized,false);
    assert.deepEqual(owner.lookup(f.customer,f.intentRequest),expected); assert.deepEqual(f.intentRows(),rows);
  });
});

test('RCG5B-NATIVE-LATE-AUTHORITY final native guard rejects lost session or current proof', async () => {
  for (const loss of ['session','proof'] as const) await usingIntent(f => {
    let fired = false;
    const scope = finalAccessScope(f,() => { fired = true;
      if (loss === 'session') f.kernel.revoke(f.customer); else changedProof(f.checkout);
    });
    const rows = f.intentRows();
    assert.throws(() => f.intents.lookup(scope,f.intentRequest),
      { message:loss === 'session' ? 'ACCESS_DENIED' : 'CUSTOMER_VERIFICATION_REQUIRED' });
    assert.equal(fired,true); assert.deepEqual(f.intentRows(),rows);
  });
});

test('RCG5B-NATIVE-RECORD-FENCE the selected full-identity record remains bound through the final guard', () => usingIntent(f => {
  f.intents.cancel(f.customer,{ intent_id:f.intent.intent_id,expected_revision:1 });
  const original = f.record().body;
  let fired = false;
  const scope = finalAccessScope(f,() => { fired = true; replaceBody(f,collidingIdentity(original)); });
  const rows = f.intentRows();
  assert.throws(() => f.intents.lookup(scope,f.intentRequest),{ message:'INTENT_REVISION_CONFLICT' });
  assert.equal(fired,true); assert.deepEqual(f.intentRows(),rows); assert.deepEqual(f.record().body,original);
}));

test('RCG5B-NATIVE-EXPIRY-FENCE authority loss after expiry persistence rolls back the observation', () => usingIntent(f => {
  const session = f.kernel.require(f.customer), rows = f.intentRows();
  let fired = false;
  const scope = f.kernel.restrictedSession(session.token_hash,session.resource_id,['resource.read'],() => {
    if (!fired && f.record().body.expired) { fired = true; changedProof(f.checkout); }
  },{});
  f.advance(30000);
  assert.throws(() => f.intents.lookup(scope,f.intentRequest),{ message:'CUSTOMER_VERIFICATION_REQUIRED' });
  assert.equal(fired,true); assert.deepEqual(f.intentRows(),rows); assert.equal(f.record().body.expired,false);
}));
