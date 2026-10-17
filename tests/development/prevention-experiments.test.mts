import test from 'node:test';
import assert from 'node:assert/strict';
import { usingPrevention, preventionGolden } from './prevention-helpers.mts';
import { PREVENTION_COST_CATEGORIES } from '../../packages/adapters/prevention-source-guards.mts';
import { subjectHash } from '../../packages/commerce/data-guards.mts';

function refreshAll(f: any) {
  for (const member of f.members) { f.outcome(member.arm); f.service.refreshOutcome(f.a.scope, { experiment_id: 'fit_trial', case_id: member.case_id }); }
  return f.service.report(f.a.scope, { experiment_id: 'fit_trial' });
}
test('M06-PREVENTION-METRICS-01 frozen baseline control and treatment preserve exact independent known answers', () => usingPrevention(f => {
  for (const member of f.members) f.analyze(member.case_id, 'purchase_' + member.arm);
  f.advance(10000); const r = refreshAll(f);
  assert.equal(r.denominator, 3); assert.equal(r.currency, 'USD'); assert.equal(r.currency_exponent, 2);
  for (const arm of ['baseline', 'control', 'treatment']) {
    const observed = r.arms[arm], expected = preventionGolden.arms[arm];
    for (const key of ['denominator', 'returned_units', 'retained_revenue_minor', 'total_cost_minor', 'contribution_minor']) assert.equal(observed[key], expected[key]);
    assert.deepEqual(observed.return_rate, { numerator: expected.returned_units, denominator: 2 });
  }
  assert.deepEqual(r.comparisons.treatment_vs_control.contribution_difference_minor,
    { numerator: preventionGolden.treatment_minus_control_contribution_minor, denominator: 1 });
  assert.deepEqual(r.comparisons.treatment_vs_baseline.contribution_difference_minor,
    { numerator: preventionGolden.treatment_minus_baseline_contribution_minor, denominator: 1 });
  assert.equal(r.arms.baseline.offered_cases, 0); assert.equal(r.arms.control.offered_cases, 0); assert.equal(r.arms.treatment.offered_cases, 1);
  assert.equal(r.production_qualified, false); assert.match(r.bias_warning, /do not establish causal/);
}));
test('M06-PREVENTION-METRICS-02 missing outcome cases stay in the declared denominator', () => usingPrevention(f => {
  f.advance(10000); f.outcome('treatment'); f.service.refreshOutcome(f.a.scope, { experiment_id: 'fit_trial', case_id: 'case_one' });
  const r = f.service.report(f.a.scope, { experiment_id: 'fit_trial' });
  assert.equal(r.denominator, 3); assert.equal(r.arms.control.denominator, 1); assert.equal(r.arms.control.missing_outcomes, 1);
  assert.equal(r.arms.control.return_rate, null); assert.equal(r.arms.control.contribution_minor, null);
  assert.equal(r.comparisons.treatment_vs_control.contribution_difference_minor, null);
}));
test('M06-PREVENTION-METRICS-03 unknown costs are not silently replaced by zero profit', () => usingPrevention(f => {
  f.advance(10000); const costs = Object.fromEntries(PREVENTION_COST_CATEGORIES.map(category => [category, '0'])); costs.hosting = null;
  f.outcome('treatment', { costs }); f.service.refreshOutcome(f.a.scope, { experiment_id: 'fit_trial', case_id: 'case_one' });
  const r = f.service.report(f.a.scope, { experiment_id: 'fit_trial' });
  assert.equal(r.arms.treatment.incomplete_cost_cases, 1); assert.equal(r.arms.treatment.contribution_minor, preventionGolden.missing_cost_result);
  assert.deepEqual(r.cases.find((c: any) => c.case_id === 'case_one').missing_cost_categories, ['hosting']);
}));
test('M06-PREVENTION-METRICS-04 the same original purchase cannot inflate a later experiment cohort', () => usingPrevention(f => {
  assert.throws(() => f.service.freeze(f.owner.scope, { ...f.freezeInput, id: 'selected_winners' }), /PURCHASE_ALREADY_ENROLLED/);
  assert.throws(() => f.service.freeze(f.owner.scope, f.freezeInput), /EXPERIMENT_FROZEN/);
  assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_prevention_members').get().n, 3);
}));
test('M06-PREVENTION-METRICS-05 outcome-aware enrollment and selected denominators are rejected', () => usingPrevention(f => {
  f.advance(1);
  assert.throws(() => f.service.freeze(f.owner.scope, f.freezeInput), /COHORT_INVALID/);
  assert.throws(() => f.service.freeze(f.owner.scope, { ...f.freezeInput, starts_at: f.now(), members: [{ case_id: 'case_one', arm: 'treatment' }] }), /COHORT_INVALID/);
  assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_prevention_members').get().n, 0);
}, { unfrozen: true }));
test('M06-PREVENTION-METRICS-06 immature followup cannot count as a mature comparison', () => usingPrevention(f => {
  const r = refreshAll(f);
  assert.equal(r.arms.treatment.missing_outcomes, 1); assert.equal(r.arms.treatment.observed_cases, 0);
  assert.equal(r.comparisons.treatment_vs_baseline.return_rate_difference, null);
}));
test('M06-PREVENTION-METRICS-07 erasure preserves aggregate denominators without exposing the erased individual', () => usingPrevention(f => {
  f.advance(10000); refreshAll(f);
  f.db.prepare('INSERT INTO commerce_privacy_resources VALUES(?,?,?,?,?)').run(f.a.tenant, f.a.store, f.control.resource_id,
    subjectHash(f.a.tenant, f.a.store, f.original.customer_id), f.now());
  const r = f.service.report(f.a.scope, { experiment_id: 'fit_trial' });
  assert.equal(r.denominator, 3); assert.equal(r.arms.control.denominator, 1); assert.equal(r.arms.control.ordered_units, 2);
  assert.equal(r.arms.control.unavailable_cases, 1); assert.equal(r.arms.control.contribution_minor, null);
  assert.equal(JSON.stringify(r.cases).includes(f.control.case_id), false);
}));
test('M06-PREVENTION-METRICS-08 duplicate source refreshes retain one observation per native version', () => usingPrevention(f => {
  f.advance(10000); f.outcome('treatment');
  const p = { experiment_id: 'fit_trial', case_id: 'case_one' };
  const first = f.service.refreshOutcome(f.a.scope, p), second = f.service.refreshOutcome(f.a.scope, p);
  assert.equal(second.duplicate, true); assert.equal(first.source_digest, second.source_digest);
  assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_prevention_outcomes').get().n, 1);
}));
test('M06-PREVENTION-METRICS-09 late cost observations append history and update current contribution honestly', () => usingPrevention(f => {
  f.advance(10000); refreshAll(f);
  const costs = Object.fromEntries(PREVENTION_COST_CATEGORIES.map(category => [category, '0'])); costs.goods = '2200'; costs.return_shipping = '500';
  f.outcome('treatment', { version: 2, costs }); f.service.refreshOutcome(f.a.scope, { experiment_id: 'fit_trial', case_id: 'case_one' });
  const r = f.service.report(f.a.scope, { experiment_id: 'fit_trial' });
  assert.equal(r.arms.treatment.contribution_minor, '1300');
  assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_prevention_outcomes WHERE case_id=?').get('case_one').n, 2);
  assert.equal(r.cases.find((c: any) => c.case_id === 'case_one').source_version, 2);
}));
test('M06-PREVENTION-METRICS-10 native fixture rejects overcounted units fabricated profit and future coverage', () => usingPrevention(f => {
  assert.throws(() => f.outcome('treatment', { returned_units: 3 }), /OUTCOME_INVALID/);
  assert.throws(() => f.outcome('treatment', { retained_revenue_minor: '4001' }), /OUTCOME_INVALID/);
  assert.throws(() => f.outcome('treatment', { through_at: f.now() + 1 }), /FOLLOWUP_INVALID/);
  assert.equal(f.sourceDb.prepare('SELECT count(*) n FROM edit_source_prevention_outcomes').get().n, 0);
}));
test('M06-PREVENTION-METRICS-11 private outcomes and cohort identities are scoped to existing analytics authority', () => usingPrevention(f => {
  assert.throws(() => f.service.report(f.b.scope, { experiment_id: 'fit_trial' }), /NOT_FOUND/);
  assert.throws(() => f.service.report(f.customer, { experiment_id: 'fit_trial' }), /ACCESS_DENIED/);
  assert.throws(() => f.service.report(f.agent.scope, { experiment_id: 'fit_trial' }), /ACCESS_DENIED/);
  assert.throws(() => f.service.refreshOutcome(f.customer, { experiment_id: 'fit_trial', case_id: 'case_one' }), /ACCESS_DENIED/);
}));
test('M06-PREVENTION-METRICS-12 reusing an event for a different purchase cannot transfer its exposure', () => usingPrevention(f => {
  f.analyze('case_one', 'same_event');
  assert.throws(() => f.analyze(f.control.case_id, 'same_event'), /EVENT_CONFLICT/);
  assert.equal(f.service.report(f.a.scope, { experiment_id: 'fit_trial' }).arms.control.analyzed_cases, 0);
}));
