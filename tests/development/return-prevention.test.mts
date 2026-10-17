import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { usingPrevention, preventionGolden } from './prevention-helpers.mts';
import { CommerceKernel } from '../../packages/commerce/kernel.mts';
import { ReturnPrevention } from '../../packages/commerce/return-prevention.mts';
import { OrderEdits } from '../../packages/commerce/order-edit-execution.mts';
import { OrderEditFixtureSource } from '../../packages/adapters/order-edit-fixture-source.mts';
import { contentDigest } from '../../packages/commerce/configuration-values.mts';
import { ExecutionStops } from '../../packages/commerce/execution-stops.mts';
import { confirmPreventionSource } from '../../packages/adapters/prevention-source-guards.mts';
import { subjectHash } from '../../packages/commerce/data-guards.mts';

test('CASE-M06-G13-01 approved multi-size suggestion preserves paid goods until customer-confirmed qualified edit', () => usingPrevention(async f => {
  const before = f.native.order(f.original.id), a = f.analyze();
  assert.deepEqual(a.offer.reasons, ['multiple_sizes', 'configured_fit_pair']);
  assert.equal(a.offer.text, preventionGolden.guidance);
  assert.deepEqual(f.native.order(f.original.id), before);
  const p = f.preview({ variant_id: 'equal' });
  assert.equal(p.preview.old_total_minor, '4000'); assert.equal(p.preview.new_total_minor, '4000');
  assert.equal(p.preview.original_lines.length, 2);
  assert.throws(() => f.edits.prepare(f.a.scope, { quote_id: p.quote_id, quote_digest: p.quote_digest }), /PREVENTION_CUSTOMER_CONFIRMATION_REQUIRED/);
  assert.equal(f.sourceDb.prepare('SELECT count(*) n FROM edit_source_effects').get().n, 0);
  f.confirm(p);
  assert.deepEqual(f.native.order(f.original.id), before);
  const receipt = f.authorize(p);
  await f.edits.dispatch(f.a.scope, receipt.order_edit_id); await f.edits.release(f.a.scope, receipt.order_edit_id);
  const after = f.native.order(f.original.id);
  assert.deepEqual(after.lines.map((l: any) => [l.variant_id, l.quantity]), [['equal', 1], ['equal', 1]]);
  assert.equal(after.total_minor, '4000'); assert.equal(after.cancelled, false);
  assert.equal(f.sourceDb.prepare('SELECT consumed FROM edit_source_prevention_consents').get().consumed, 1);
}));
test('CASE-M06-G13-02 agent risk suggestion cannot cancel paid goods or impersonate a customer', () => usingPrevention(f => {
  f.analyze(); const before = f.native.order(f.original.id), q = f.edits.quote(f.agent.scope,
    { case_id: 'case_one', kind: 'cancel', line_id: null, variant_id: null, address: null });
  assert.throws(() => f.edits.prepare(f.agent.scope, { quote_id: q.id, quote_digest: q.digest }), /PREVENTION_CUSTOMER_CONFIRMATION_REQUIRED/);
  const p = f.preview();
  for (const scope of [f.agent.scope, f.a.scope, f.owner.scope]) assert.throws(() => f.service.confirm(scope,
    { case_id: 'case_one', quote_id: p.quote_id, quote_digest: p.quote_digest }), /CUSTOMER_VERIFICATION_REQUIRED/);
  assert.deepEqual(f.native.order(f.original.id), before);
  assert.equal(f.sourceDb.prepare('SELECT count(*) n FROM edit_source_prevention_consents').get().n, 0);
  assert.equal(f.sourceDb.prepare('SELECT count(*) n FROM edit_source_effects').get().n, 0);
}));
test('CASE-M06-G13-03 repeated purchase events and restart preserve one offer and exposure', () => usingPrevention(f => {
  const first = f.analyze(); assert.equal(f.analyze('case_one', 'duplicate_purchase').duplicate, true);
  const db = new DatabaseSync(f.filename), sourceDb = new DatabaseSync(f.sourceFile);
  try {
    const k = new CommerceKernel(db, f.now), source = new OrderEditFixtureSource(sourceDb, { mode: 'fixture', identity: 'edit-fixture', tenant: f.a.tenant, store: f.a.store }, f.now);
    const service = new ReturnPrevention(new OrderEdits(k, source)), second = service.analyze(k.authenticate(f.a.bearer),
      { experiment_id: 'fit_trial', case_id: 'case_one', event_id: 'after_restart' });
    assert.equal(second.exposure_id, first.exposure_id); assert.equal(second.duplicate, true);
    const report = service.report(k.authenticate(f.a.bearer), { experiment_id: 'fit_trial' });
    assert.equal(report.arms.treatment.denominator, 1); assert.equal(report.arms.treatment.analyzed_cases, 1); assert.equal(report.arms.treatment.offered_cases, 1);
    assert.equal(db.prepare('SELECT count(*) n FROM commerce_prevention_exposures').get().n, 1);
  } finally { db.close(); sourceDb.close(); }
}));
test('M06-PREVENTION-04 unapproved guidance cannot enroll any purchase', () => usingPrevention(f => {
  assert.throws(() => f.service.freeze(f.owner.scope, f.freezeInput), /CONFIGURATION_UNAVAILABLE/);
  assert.equal(f.sourceDb.prepare('SELECT count(*) n FROM edit_source_prevention_enrollments').get().n, 0);
}, { unapproved: true }));
test('M06-PREVENTION-05 configuration and independent review enforce existing roles', () => usingPrevention(f => {
  assert.throws(() => f.service.configure(f.agent.scope, f.configuration({ expected_version: 1 })), /ACCESS_DENIED/);
  assert.throws(() => f.service.approve(f.owner.scope, { id: f.draft.id, version: f.draft.version, digest: f.draft.digest }), /SELF_REVIEW_DENIED/);
  assert.throws(() => f.service.approve(f.agent.scope, { id: f.draft.id, version: f.draft.version, digest: f.draft.digest }), /ACCESS_DENIED/);
}, { unapproved: true }));
test('M06-PREVENTION-06 stale knowledge and revoked reviewer block new suggestions', () => usingPrevention(f => {
  f.knowledge.revoke(f.a.scope, f.guide.id);
  assert.throws(() => f.analyze(), /NOT_FOUND/);
  assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_prevention_exposures').get().n, 0);
}));
test('M06-PREVENTION-07 source changes invalidate customer confirmation and staff approval', () => usingPrevention(f => {
  f.analyze(); const p = f.preview();
  f.native.fixtureOrder(f.original.id, { financial_state: 'partially_refunded' });
  assert.throws(() => f.confirm(p), /PREVENTION_SOURCE_CHANGED/);
  f.edits.refresh(f.a.scope, 'case_one');
  assert.throws(() => f.confirm(p), /PREVENTION_PREVIEW_CHANGED/);
  assert.equal(f.sourceDb.prepare('SELECT count(*) n FROM edit_source_effects').get().n, 0);
}));
test('M06-PREVENTION-08 disabling offers cannot authorize a previously unconfirmed quote', () => usingPrevention(f => {
  f.analyze(); const p = f.preview();
  const draft = f.service.configure(f.owner.scope, f.configuration({ expected_version: 1, enabled: false }));
  f.service.approve(f.reviewer.scope, { id: draft.id, version: draft.version, digest: draft.digest });
  assert.equal(f.service.read(f.customer, { case_id: 'case_one' }).offer_current, false);
  assert.throws(() => f.edits.prepare(f.a.scope, { quote_id: p.quote_id, quote_digest: p.quote_digest }), /PREVENTION_CUSTOMER_CONFIRMATION_REQUIRED/);
  assert.equal(f.confirm(p).confirmed, true);
  assert.ok(f.authorize(p).order_edit_id);
}));
test('M06-PREVENTION-09 independent cancellation remains possible through explicit customer confirmation', () => usingPrevention(async f => {
  f.analyze(); const p = f.preview({ kind: 'cancel', line_id: null, variant_id: null });
  assert.equal(p.preview.action, 'cancel'); assert.deepEqual(p.preview.line_ids, ['line_one', 'line_two']);
  assert.equal(p.preview.new_total_minor, '0'); assert.equal(p.preview.financial_obligation, 'refund');
  f.confirm(p); const receipt = f.authorize(p); await f.edits.dispatch(f.a.scope, receipt.order_edit_id);
  assert.equal(f.native.order(f.original.id).cancelled, true);
  assert.equal(f.native.finance(receipt.order_edit_id).state, 'accepted');
  assert.equal(f.native.finance(receipt.order_edit_id).settled, false);
}));
test('M06-PREVENTION-10 a pre-enrollment authorization cannot bypass a later enrolled boundary', () => usingPrevention(async f => {
  const q = f.quote(), preview = f.edits.prepare(f.a.scope, { quote_id: q.id, quote_digest: q.digest }), approval = f.gateway.approve(f.reviewer.scope, { preview_id: preview.id, preview_digest: preview.digest });
  const receipt = f.gateway.execute(f.a.scope, { preview_id: preview.id, preview_digest: preview.digest, approval_id: approval.id });
  f.analyze();
  await assert.rejects(f.edits.dispatch(f.a.scope, receipt.order_edit_id), /PREVENTION_CUSTOMER_CONFIRMATION_REQUIRED/);
  assert.equal(f.sourceDb.prepare('SELECT count(*) n FROM edit_source_effects').get().n, 0);
}));
test('M06-PREVENTION-11 customer revocation stops already authorized but unsent native edits', () => usingPrevention(async f => {
  f.analyze(); const p = f.preview(); f.confirm(p); const receipt = f.authorize(p);
  assert.equal(f.service.revoke(f.customer, { case_id: 'case_one', quote_id: p.quote_id }).already_committed, false);
  await assert.rejects(f.edits.dispatch(f.a.scope, receipt.order_edit_id), /PREVENTION_CONFIRMATION_UNAVAILABLE/);
  assert.equal(f.sourceDb.prepare('SELECT count(*) n FROM edit_source_effects').get().n, 0);
}));
test('M06-PREVENTION-12 customer session revocation invalidates unsent edit claims', () => usingPrevention(async f => {
  f.analyze(); const p = f.preview(); f.confirm(p); const receipt = f.authorize(p); f.kernel.revoke(f.customer);
  await assert.rejects(f.edits.dispatch(f.a.scope, receipt.order_edit_id), /PREVENTION_CONFIRMATION_UNAVAILABLE/);
  assert.equal(f.sourceDb.prepare('SELECT count(*) n FROM edit_source_effects').get().n, 0);
}));
test('M06-PREVENTION-13 native source rejects an unlabelled paid-goods command without customer consent', () => usingPrevention(async f => {
  f.analyze(); const p = f.preview(), q = JSON.parse(f.db.prepare('SELECT body FROM commerce_edit_quotes WHERE id=?').get(p.quote_id).body);
  const command = { operation_id: 'unlabelled_attack', edit_id: 'unlabelled_edit', stage: 'hold:edit:warehouse_one',
    tenant_id: f.a.tenant, store_id: f.a.store, source_identity: f.native.identity, source_revision: f.native.revision(),
    resource_id: f.original.id, customer_id: f.original.customer_id, original_version: q.source_order_version,
    original_digest: q.source_order_digest, intent: f.intent({ kind: 'cancel', line_id: null, variant_id: null }),
    line_ids: ['line_one', 'line_two'], warehouse_ids: ['warehouse_one'], new_total_minor: '0', delta_minor: '-4000' };
  await assert.rejects(f.native.perform(command), /PREVENTION_NATIVE_CUSTOMER_CONFIRMATION_REQUIRED/);
  assert.equal(f.sourceDb.prepare('SELECT count(*) n FROM edit_source_holds').get().n, 0);
  assert.equal(f.sourceDb.prepare('SELECT count(*) n FROM edit_source_effects').get().n, 0);
}));
test('M06-PREVENTION-14 native consent binds the exact action, original money and one operation identity', () => usingPrevention(async f => {
  f.analyze(); const p = f.preview({ variant_id: 'equal' }); f.confirm(p); const receipt = f.authorize(p), commands: any[] = [];
  const perform = f.native.perform.bind(f.native); f.native.perform = async command => { commands.push(structuredClone(command)); return perform(command); };
  await f.edits.dispatch(f.a.scope, receipt.order_edit_id);
  const before = f.native.order(f.original.id), command = commands.find(c => c.stage === 'commit');
  await assert.rejects(perform({ ...command, edit_id: 'cloned_edit', operation_id: 'cloned_operation' }), /CUSTOMER_CONFIRMATION_REQUIRED/);
  await assert.rejects(perform({ ...command, operation_id: 'changed_operation', intent: { ...command.intent, kind: 'cancel', line_id: null, variant_id: null }, new_total_minor: '0', delta_minor: '-4000' }), /CONFIRMATION_MISMATCH/);
  assert.deepEqual(f.native.order(f.original.id), before);
  assert.equal(f.sourceDb.prepare("SELECT count(*) n FROM edit_source_effects WHERE json_extract(result,'$.stage')='commit'").get().n, 1);
}));
test('M06-PREVENTION-15 lost commit response reconciles after revoked consent without duplicating goods', () => usingPrevention(async f => {
  f.analyze(); const p = f.preview({ variant_id: 'equal' }); f.confirm(p); const receipt = f.authorize(p);
  f.native.fault = 'after'; f.native.faultStage = 'commit'; const unknown = await f.edits.dispatch(f.a.scope, receipt.order_edit_id);
  assert.equal(unknown.state, 'unknown'); assert.equal(f.native.order(f.original.id).version, 2);
  assert.equal(f.service.revoke(f.customer, { case_id: 'case_one', quote_id: p.quote_id }).already_committed, true);
  const db = new DatabaseSync(f.filename), nativeDb = new DatabaseSync(f.sourceFile);
  try {
    const k = new CommerceKernel(db, f.now), source = new OrderEditFixtureSource(nativeDb, { mode: 'fixture', identity: 'edit-fixture', tenant: f.a.tenant, store: f.a.store }, f.now);
    const edits = new OrderEdits(k, source), scope = k.authenticate(f.a.bearer);
    assert.equal(edits.reconcile(scope, receipt.order_edit_id).stages.find((s: any) => s.stage === 'commit').state, 'confirmed');
    await edits.dispatch(scope, receipt.order_edit_id); await edits.release(scope, receipt.order_edit_id);
    assert.equal(source.order(f.original.id).version, 2);
    assert.equal(nativeDb.prepare("SELECT count(*) n FROM edit_source_effects WHERE json_extract(result,'$.stage')='commit'").get().n, 1);
  } finally { db.close(); nativeDb.close(); }
}));
test('M06-PREVENTION-16 customer confirmation is tied to exact quoted totals and preview digest', () => usingPrevention(f => {
  f.analyze(); const p = f.preview();
  assert.throws(() => f.confirm({ ...p, quote_digest: 'a'.repeat(64) }), /PREVENTION_PREVIEW_CHANGED/);
  assert.throws(() => f.service.confirm(f.customer, { case_id: 'case_one', quote_id: p.quote_id, quote_digest: p.quote_digest, customer_confirmed: true }), /INVALID_INPUT/);
  assert.equal(f.sourceDb.prepare('SELECT count(*) n FROM edit_source_prevention_consents').get().n, 0);
}));
test('M06-PREVENTION-17 deterministic manual prevention remains available with models disabled', () => usingPrevention(f => {
  new ExecutionStops(f.kernel).set(f.owner.scope, { action: 'model.run', stopped: true, reason: 'incident', expected_revision: 0 });
  assert.ok(f.analyze().offer); const p = f.preview(); assert.equal(f.confirm(p).confirmed, true);
  assert.equal(f.sourceDb.prepare('SELECT count(*) n FROM edit_source_effects').get().n, 0);
}));
test('M06-PREVENTION-18 erasure and store boundaries stop private reads and new consent', () => usingPrevention(f => {
  f.analyze(); const p = f.preview();
  assert.throws(() => f.service.read(f.b.scope, { case_id: 'case_one' }), /NOT_FOUND/);
  const publicView = f.service.read(f.customer, { case_id: 'case_one' });
  assert.equal(publicView.exposure, undefined); assert.equal(JSON.stringify(publicView).includes('session_hash'), false);
  f.db.prepare('INSERT INTO commerce_privacy_resources VALUES(?,?,?,?,?)').run(f.a.tenant, f.a.store, f.original.id, subjectHash(f.a.tenant, f.a.store, f.original.customer_id), f.now());
  assert.throws(() => f.service.read(f.a.scope, { case_id: 'case_one' }), /SUBJECT_ERASED/);
  assert.throws(() => f.confirm(p), /SUBJECT_ERASED/);
}));
test('M06-PREVENTION-19 the native bridge cannot accept staff or a fabricated customer scope', () => usingPrevention(f => {
  f.analyze(); const p = f.preview();
  assert.throws(() => confirmPreventionSource(f.native, f.kernel, f.a.scope, p.quote_id), /CUSTOMER_VERIFICATION_REQUIRED/);
  assert.throws(() => confirmPreventionSource(f.native, f.kernel, { role: 'customer' }, p.quote_id), /ACCESS_DENIED/);
}));
test('M06-PREVENTION-20 duplicate customer confirmation preserves the same native receipt', () => usingPrevention(f => {
  f.analyze(); const p = f.preview(), first = f.confirm(p), second = f.confirm(p);
  assert.equal(first.confirmation_digest, second.confirmation_digest);
  assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_prevention_confirmations').get().n, 1);
  assert.equal(f.sourceDb.prepare('SELECT count(*) n FROM edit_source_prevention_consents').get().n, 1);
  assert.equal(contentDigest(f.native.order(f.original.id)), contentDigest(f.order));
}));
test('M06-PREVENTION-21 a confirmation retry cannot endorse changed current source facts', () => usingPrevention(f => {
  f.analyze(); const p = f.preview(); f.confirm(p);
  f.native.fixtureStock('cheaper', 0);
  assert.throws(() => f.confirm(p), /PREVENTION_SOURCE_CHANGED/);
  assert.equal(f.sourceDb.prepare('SELECT count(*) n FROM edit_source_prevention_consents').get().n, 1);
}));
test('M06-PREVENTION-22 interrupted native registration remains unconfirmed and retries the same customer claim', () => usingPrevention(f => {
  f.analyze(); const p = f.preview(), prepare = f.sourceDb.prepare.bind(f.sourceDb);
  f.sourceDb.prepare = (sql: string) => {
    if (sql.startsWith('INSERT INTO edit_source_prevention_consents')) throw new Error('FIXTURE_NATIVE_REGISTRATION_UNAVAILABLE');
    return prepare(sql);
  };
  assert.throws(() => f.confirm(p), /FIXTURE_NATIVE_REGISTRATION_UNAVAILABLE/);
  const view = f.service.read(f.customer, { case_id: 'case_one' }).previews[0];
  assert.equal(view.customer_confirmation_recorded, true); assert.equal(view.native_confirmation_registered, false); assert.equal(view.confirmed, false);
  f.sourceDb.prepare = prepare;
  assert.equal(f.confirm(p).confirmed, true);
  assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_prevention_confirmations').get().n, 1);
  assert.equal(f.sourceDb.prepare('SELECT count(*) n FROM edit_source_prevention_consents').get().n, 1);
}));
