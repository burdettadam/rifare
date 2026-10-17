import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { usingReturns } from './return-intake-helpers.mts';
import { RiskAssistance } from '../../packages/commerce/risk-assistance.mts';
import { ReturnEvidence } from '../../packages/commerce/return-evidence.mts';
import { CommerceKernel, digest } from '../../packages/commerce/kernel.mts';
import { contentDigest } from '../../packages/commerce/configuration-values.mts';
import { ExecutionStops } from '../../packages/commerce/execution-stops.mts';
import { subjectHash } from '../../packages/commerce/data-guards.mts';

const golden = JSON.parse(readFileSync(new URL('../fixtures/assistance/risk-golden.v1.json', import.meta.url), 'utf8'));
const photo = JSON.parse(readFileSync(new URL('../fixtures/return-intake/photo.v1.json', import.meta.url), 'utf8')).base64;
async function risk(f: any) {
  const evidence = new ReturnEvidence(f.kernel, { identity: 'risk-fixture-scan', scan: async bytes => ({ verdict: 'rejected', sha256: digest(bytes) }) });
  const upload = evidence.upload(f.customer, { case_id: 'case_one', mime: 'image/png', base64: photo, note: 'Private source text must not enter assistance.' });
  await evidence.scan(f.reviewer.scope, upload.id);
  const quote = f.quote({ evidence_ids: [upload.id] }), service = new RiskAssistance(f.kernel);
  const assess = (model: any = null) => service.assess(f.a.scope, { case_id: 'case_one', quote_id: quote.id, model });
  return { service, quote, upload, assess, report: assess() };
}

test('CASE-M06-G11-01 exact source indicators support separately authorized evidence review', () => usingReturns(async f => {
  const x = await risk(f), a = x.report.assessment;
  assert.deepEqual(a.indicators.map((i: any) => i.code), golden.expected_indicator_codes);
  assert.equal(a.indicators[0].sources[0].id, x.upload.id);
  assert.equal(a.indicators[0].sources[0].state, 'rejected');
  assert.equal(a.indicators[0].sources[0].scanner, 'risk-fixture-scan');
  assert.match(a.indicators[1].uncertainty, /not proof/);
  const reviewed = x.service.review(f.reviewer.scope, { assessment_id: x.report.assessment_id, assessment_digest: x.report.digest,
    action: 'request_evidence', reason: 'photo_unclear', expires_at: null });
  assert.equal(reviewed.history[0].result.status, 'evidence_requested');
  assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_return_review_events WHERE event=?').get('evidence_requested').n, 1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_action_receipts').get().n, 0);
}));
test('CASE-M06-G11-02 unsupported model accusations cannot deny or create public allegations', () => usingReturns(async f => {
  const x = await risk(f), before = f.quote().quote.decision;
  const a = x.assess(golden.hostile_proposal).assessment;
  assert.equal(a.automatic_denial, golden.expected_automatic_denial);
  assert.equal(a.public_allegation, golden.expected_public_allegation);
  assert.equal(a.model.status, 'rejected_untrusted_proposal');
  assert.equal(a.policy.decision_at_quote.decision, golden.expected_policy_decision);
  assert.deepEqual(f.quote().quote.decision, before);
  assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_action_receipts').get().n, 0);
  const stored = JSON.stringify(f.db.prepare('SELECT body FROM commerce_risk_assessments').all());
  assert.equal(stored.includes(golden.hostile_proposal.public_text), false);
  assert.equal(stored.includes('Private source text'), false);
}));
test('CASE-M06-G11-03 changed models and removed indicators retain rights and historical provenance', () => usingReturns(async f => {
  const x = await risk(f), before = x.report.assessment;
  const m = { provider: 'fixture', model: 'risk', revision: '1', source_digest: before.source_digest, indicator_codes: ['evidence_not_clean'] };
  const first = x.assess(m), second = x.assess({ ...m, revision: '2', indicator_codes: [] });
  assert.equal(first.assessment.model.revision, '1'); assert.equal(second.assessment.model.revision, '2');
  assert.deepEqual(first.assessment.policy, second.assessment.policy);
  const clean = f.quote(), next = x.service.assess(f.a.scope, { case_id: 'case_one', quote_id: clean.id, model: null });
  assert.equal(next.assessment.indicators.length, 0);
  assert.deepEqual(next.assessment.policy.rules.outcomes, golden.expected_policy_outcomes);
  const old = x.service.read(f.a.scope, { case_id: 'case_one', assessment_id: first.assessment_id });
  assert.equal(old.digest, first.digest); assert.equal(old.assessment.model.revision, '1');
  assert.deepEqual(old.assessment.source, first.assessment.source);
  assert.equal(f.quote().quote.decision.decision, 'allow');
}));
test('M06-RISK-04 customer view omits indicators, model records and source identifiers', () => usingReturns(async f => {
  const x = await risk(f), view = x.service.read(f.customer, { case_id: 'case_one', assessment_id: x.report.assessment_id });
  assert.equal(view.assessment, undefined); assert.equal(view.model, undefined); assert.equal(view.history, undefined);
  assert.equal(JSON.stringify(view).includes('risk-fixture-scan'), false); assert.equal(JSON.stringify(view).includes('fraud'), false);
  assert.deepEqual(view.appeal_reasons, ['source_incorrect', 'additional_evidence', 'request_human']);
}));
test('M06-RISK-05 evidence appeal requires the real scoped customer', () => usingReturns(async f => {
  const x = await risk(f), p = { assessment_id: x.report.assessment_id, reason: 'source_incorrect', evidence_ids: [x.upload.id] };
  assert.throws(() => x.service.appeal(f.a.scope, p), /CUSTOMER_VERIFICATION_REQUIRED/);
  assert.throws(() => x.service.appeal(f.agent.scope, p), /CUSTOMER_VERIFICATION_REQUIRED/);
  assert.throws(() => x.service.appeal(f.b.scope, p), /NOT_FOUND/);
  assert.equal(x.service.appeal(f.customer, p).status, 'human_review_requested');
  assert.equal(f.db.prepare("SELECT count(*) n FROM commerce_risk_reviews WHERE kind='appeal'").get().n, 1);
}));
test('M06-RISK-06 risk dismissal does not override published eligibility', () => usingReturns(async f => {
  const x = await risk(f), before = f.quote({ lines: [{ line_id: 'excluded', quantity: 1 }] }).quote.decision;
  const r = x.service.review(f.reviewer.scope, { assessment_id: x.report.assessment_id, assessment_digest: x.report.digest,
    action: 'dismiss', reason: 'insufficient_basis', expires_at: null });
  assert.equal(r.history[0].result.status, 'indicator_dismissed');
  assert.deepEqual(f.quote({ lines: [{ line_id: 'excluded', quantity: 1 }] }).quote.decision, before);
  assert.equal(before.decision, 'deny');
}));
test('M06-RISK-07 reviewer controls enforce current scope and prohibit self review', () => usingReturns(async f => {
  const x = await risk(f), p = { assessment_id: x.report.assessment_id, assessment_digest: x.report.digest,
    action: 'dismiss', reason: 'source_resolved', expires_at: null };
  assert.throws(() => x.service.review(f.agent.scope, p), /ACCESS_DENIED/);
  f.permissions.change(f.owner.scope, { actor_id: 'reviewer', role: 'reviewer', expected_revision: 0, actions: ['case.read', 'resource.read', 'return.read'], resource_ids: null });
  assert.throws(() => x.service.review(f.reviewer.scope, p), /ACCESS_DENIED/);
  const own = x.service.assess(f.owner.scope, { case_id: 'case_one', quote_id: x.quote.id, model: null });
  assert.throws(() => x.service.review(f.owner.scope, { ...p, assessment_id: own.assessment_id, assessment_digest: own.digest }), /SELF_REVIEW_DENIED/);
}));
test('M06-RISK-08 policy window override reuses the bounded existing review action', () => usingReturns(f => {
  const o = f.order(); f.kernel.ingest(f.a.scope, { kind: 'order', source_system: o.source_system, external_id: o.external_id,
    source_version: o.source_version + 1, source_updated_at: f.now(), customer_id: o.customer_id,
    payload: { ...o.payload, delivered_at: f.now() - 31 * 86400000 } });
  const q = f.quote(), service = new RiskAssistance(f.kernel), a = service.assess(f.a.scope, { case_id: 'case_one', quote_id: q.id, model: null });
  const r = service.review(f.reviewer.scope, { assessment_id: a.assessment_id, assessment_digest: a.digest,
    action: 'window_override', reason: 'shipping_delay', expires_at: f.now() + 60000 });
  assert.deepEqual(r.history[0].result.original_reasons, ['RETURN_WINDOW_EXPIRED']);
  assert.equal(r.history[0].result.financial_authority, false);
  assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_return_overrides').get().n, 1);
}));
test('M06-RISK-09 model stop still permits deterministic manual assistance', () => usingReturns(async f => {
  const x = await risk(f); new ExecutionStops(f.kernel).set(f.owner.scope, { action: 'model.run', stopped: true, reason: 'incident', expected_revision: 0 });
  const n = f.db.prepare('SELECT count(*) n FROM commerce_risk_assessments').get().n;
  assert.throws(() => x.assess(golden.hostile_proposal), /EXECUTION_STOPPED/);
  assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_risk_assessments').get().n, n);
  assert.equal(x.assess().assessment.model.status, 'not_used');
}));
test('M06-RISK-10 forged model source pins are rejected without altering the source result', () => usingReturns(async f => {
  const x = await risk(f), r = x.assess({ provider: 'fixture', model: 'risk', revision: '2', source_digest: 'a'.repeat(64), indicator_codes: ['evidence_not_clean'] });
  assert.equal(r.assessment.model.status, 'rejected_untrusted_proposal');
  assert.equal(r.assessment.source_digest, x.report.assessment.source_digest);
  assert.equal(r.assessment.automatic_denial, false);
}));
test('M06-RISK-11 scoped history remains available after restart with exact bytes', () => usingReturns(async f => {
  const x = await risk(f), db = new DatabaseSync(f.filename);
  try { const k = new CommerceKernel(db, f.now), service = new RiskAssistance(k), a = service.read(k.authenticate(f.a.bearer), { case_id: 'case_one', assessment_id: x.report.assessment_id });
    assert.equal(a.digest, x.report.digest); assert.deepEqual(a.assessment, x.report.assessment);
  } finally { db.close(); }
}));
test('M06-RISK-12 tenant and customer erasure boundaries cover history and new assessments', () => usingReturns(async f => {
  const x = await risk(f); assert.throws(() => x.service.read(f.b.scope, { case_id: 'case_one', assessment_id: x.report.assessment_id }), /NOT_FOUND/);
  f.db.prepare('INSERT INTO commerce_privacy_resources VALUES(?,?,?,?,?)').run(f.a.tenant, f.a.store, f.order().id, subjectHash(f.a.tenant, f.a.store, f.order().customer_id), f.now());
  assert.throws(() => x.service.read(f.a.scope, { case_id: 'case_one', assessment_id: x.report.assessment_id }), /SUBJECT_ERASED/);
  assert.throws(() => x.assess(), /SUBJECT_ERASED/);
}));
test('M06-RISK-13 tampering with durable provenance fails closed', () => usingReturns(async f => {
  const x = await risk(f); f.db.prepare("UPDATE commerce_risk_assessments SET body=json_set(body,'$.policy.rules.window_days',365) WHERE id=?").run(x.report.assessment_id);
  assert.throws(() => x.service.read(f.a.scope, { case_id: 'case_one', assessment_id: x.report.assessment_id }), /RISK_HISTORY_INTEGRITY/);
}));
test('M06-RISK-14 assistance never creates a business receipt or unsupported denial action', () => usingReturns(async f => {
  const x = await risk(f); assert.throws(() => x.service.review(f.reviewer.scope, { assessment_id: x.report.assessment_id,
    assessment_digest: x.report.digest, action: 'deny_all', reason: 'model_score', expires_at: null }), /UNSUPPORTED/);
  assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_action_receipts').get().n, 0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_order_edits').get().n, 0);
  assert.equal(contentDigest(x.report.assessment.policy.rules), contentDigest(f.cases.inspect(f.a.scope, 'case_one').pins.policy.body.rules));
}));
