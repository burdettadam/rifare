import { exact, id, integer } from './kernel.mts';
import type { Scope, Row } from './kernel.mts';
import { canonical, contentDigest, jsonValue } from './configuration-values.mts';
import { safeOrder } from './order-edit-core.mts';
import { preventionBody } from './return-prevention-guards.mts';
import type { ReturnPrevention } from './return-prevention.mts';
import { PREVENTION_COST_CATEGORIES, preventionSourceOutcome } from '../adapters/prevention-source-guards.mts';
import { assertRecoveryEgress } from './data-guards.mts';

const ARMS = Object.freeze(['baseline', 'control', 'treatment']);
function minor(value: unknown) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,23})$/.test(value)) throw new Error('PREVENTION_MONEY_INVALID');
  return BigInt(value);
}

/** Frozen denominators and descriptive fixture economics; no automatic experiment activation. */
export class PreventionExperiments {
  readonly parent: ReturnPrevention;
  constructor(parent: ReturnPrevention) { this.parent = parent; }
  experiment(s: Row, experimentId: string) {
    const row = this.parent.k.db.prepare('SELECT * FROM commerce_prevention_experiments WHERE tenant_id=? AND store_id=? AND id=?')
      .get(s.tenant_id, s.store_id, id(experimentId)) as Row;
    return preventionBody(row);
  }
  member(scope: Scope, experimentId: string, caseId: string) {
    const { s, c } = this.parent.context(scope, caseId), experiment = this.experiment(s, experimentId);
    const row = this.parent.k.db.prepare('SELECT * FROM commerce_prevention_members WHERE tenant_id=? AND store_id=? AND experiment_id=? AND resource_id=?')
      .get(s.tenant_id, s.store_id, experimentId, c.resource_id) as Row;
    const member = preventionBody(row);
    if (row.case_id !== c.id || row.customer_id !== c.customer_id || member.case_id !== c.id) throw new Error('PREVENTION_MEMBER_MISMATCH');
    return { s, c, experiment, member };
  }
  freeze(scope: Scope, input: unknown) {
    const p = exact(jsonValue(input), ['id', 'configuration_id', 'configuration_version', 'starts_at', 'ends_at', 'members']), k = this.parent.k;
    id(p.id); id(p.configuration_id); integer(p.configuration_version, 1); integer(p.starts_at); integer(p.ends_at);
    if (p.starts_at < k.clock() || p.ends_at <= p.starts_at || p.ends_at - p.starts_at > 30 * 86400000
      || !Array.isArray(p.members) || p.members.length < 3 || p.members.length > 500) throw new Error('PREVENTION_COHORT_INVALID');
    for (const m of p.members) { exact(m, ['case_id', 'arm']); id(m.case_id); if (!ARMS.includes(m.arm)) throw new Error('PREVENTION_COHORT_INVALID'); }
    if (new Set(p.members.map((m: Row) => m.case_id)).size !== p.members.length || ARMS.some(arm => !p.members.some((m: Row) => m.arm === arm))) throw new Error('PREVENTION_COHORT_INVALID');
    return k.transaction(() => {
      const s = k.authorize(scope, 'support.configure'), config = this.parent.approved(scope, p.configuration_id, p.configuration_version);
      if (config.body.expires_at < p.ends_at) throw new Error('PREVENTION_CONFIGURATION_EXPIRES');
      if (k.db.prepare('SELECT 1 FROM commerce_prevention_experiments WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id, s.store_id, p.id)) throw new Error('PREVENTION_EXPERIMENT_FROZEN');
      const members = p.members.map((member: Row) => {
        const snap = this.parent.snapshot(scope, member.case_id), o = snap.snapshot.order;
        if (o.currency !== 'USD' || o.cancelled || o.financial_state !== 'paid' || o.balance_due_minor !== '0') throw new Error('PREVENTION_PURCHASE_UNQUALIFIED');
        const orderedUnits = o.lines.filter((l: Row) => l.status !== 'cancelled').reduce((n: number, l: Row) => n + integer(l.quantity, 1), 0);
        integer(orderedUnits, 1); minor(o.net_paid_minor);
        if (orderedUnits > 50000000) throw new Error('PREVENTION_PURCHASE_UNQUALIFIED');
        if (k.db.prepare('SELECT 1 FROM commerce_prevention_members WHERE tenant_id=? AND store_id=? AND resource_id=?')
          .get(s.tenant_id, s.store_id, snap.c.resource_id)) throw new Error('PREVENTION_PURCHASE_ALREADY_ENROLLED');
        return { case_id: member.case_id, resource_id: snap.c.resource_id, customer_id: snap.c.customer_id, arm: member.arm,
          source_identity: snap.source.identity, source_order_version: o.version, source_order_digest: contentDigest(safeOrder(o)),
          ordered_units: orderedUnits, original_paid_minor: o.net_paid_minor, currency: o.currency };
      }).sort((a: Row, b: Row) => a.case_id.localeCompare(b.case_id));
      if (new Set(members.map((m: Row) => m.resource_id)).size !== members.length) throw new Error('PREVENTION_PURCHASE_ALREADY_ENROLLED');
      const denominators = Object.fromEntries(ARMS.map(arm => {
        const rows = members.filter((m: Row) => m.arm === arm);
        return [arm, { cases: rows.length, ordered_units: rows.reduce((n: number, m: Row) => n + m.ordered_units, 0),
          original_paid_minor: rows.reduce((n: bigint, m: Row) => n + minor(m.original_paid_minor), 0n).toString() }];
      }));
      const value = { id: p.id, configuration_id: p.configuration_id, configuration_version: p.configuration_version,
        configuration_digest: config.digest, starts_at: p.starts_at, ends_at: p.ends_at,
        members: members.map((m: Row) => ({ case_id: m.case_id, resource_id: m.resource_id, arm: m.arm })),
        denominator: members.length, denominators, currency: 'USD', currency_exponent: 2,
        outcome_definition: 'Returned purchased units during the declared window with source coverage through its end.',
        cost_categories: [...PREVENTION_COST_CATEGORIES], allocation: 'predeclared_nonrandom_synthetic',
        missing_outcome_rule: 'Retain the original denominator and suppress complete comparative claims.',
        baseline_definition: 'Predeclared baseline arm, not a reconstructed historical merchant baseline.', frozen_at: k.clock() };
      k.db.prepare('INSERT INTO commerce_prevention_experiments VALUES(?,?,?,?,?,?)')
        .run(s.tenant_id, s.store_id, p.id, canonical(value), contentDigest(value), k.clock());
      for (const member of members) k.db.prepare('INSERT INTO commerce_prevention_members VALUES(?,?,?,?,?,?,?,?,?)')
        .run(s.tenant_id, s.store_id, p.id, member.case_id, member.resource_id, member.customer_id, member.arm, canonical(member), contentDigest(member));
      return { experiment_id: p.id, digest: contentDigest(value), denominator: members.length, denominators,
        baseline_definition: value.baseline_definition, execution_authorized: false, production_qualified: false };
    });
  }
  refreshOutcome(scope: Scope, input: unknown) {
    const p = exact(jsonValue(input), ['experiment_id', 'case_id']), k = this.parent.k;
    return k.transaction(() => {
      const { s, c } = this.parent.context(scope, p.case_id, 'support.analytics'), { experiment, member } = this.member(scope, id(p.experiment_id), c.id);
      assertRecoveryEgress(k);
      const source = this.parent.source(s), current = preventionSourceOutcome(source, c.resource_id);
      if (!current) return { case_id: c.id, state: 'source_outcome_missing', complete: false };
      const value = current.body, observation = value.input;
      if (value.source_identity !== member.source_identity || source.identity !== member.source_identity || value.customer_id !== c.customer_id
        || value.currency !== experiment.currency || observation.resource_id !== c.resource_id
        || observation.through_at > k.clock() || observation.through_at < experiment.starts_at || observation.returned_units > member.ordered_units
        || observation.retained_revenue_minor !== null && minor(observation.retained_revenue_minor) > minor(member.original_paid_minor)) throw new Error('PREVENTION_OUTCOME_INVALID');
      const previous = k.db.prepare('SELECT * FROM commerce_prevention_outcomes WHERE tenant_id=? AND store_id=? AND experiment_id=? AND resource_id=? ORDER BY source_version DESC LIMIT 1')
        .get(s.tenant_id, s.store_id, p.experiment_id, c.resource_id) as Row;
      if (previous) {
        const prior = preventionBody(previous);
        if (current.version < previous.source_version || observation.through_at < prior.input.through_at) throw new Error('PREVENTION_OUTCOME_REGRESSION');
        if (current.version === previous.source_version) {
          if (current.digest !== previous.digest) throw new Error('PREVENTION_OUTCOME_CHANGED');
          return { case_id: c.id, source_version: current.version, source_digest: current.digest, duplicate: true, complete: observation.through_at >= experiment.ends_at };
        }
      }
      k.db.prepare('INSERT INTO commerce_prevention_outcomes VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(s.tenant_id, s.store_id, p.experiment_id, c.id, c.resource_id, c.customer_id, current.version,
          canonical(value), current.digest, k.clock());
      return { case_id: c.id, source_version: current.version, source_digest: current.digest, duplicate: false,
        complete: observation.through_at >= experiment.ends_at, qualification: value.basis };
    });
  }
  report(scope: Scope, input: unknown) {
    const p = exact(jsonValue(input), ['experiment_id']), k = this.parent.k, s = k.authorize(scope, 'support.analytics'), experiment = this.experiment(s, id(p.experiment_id));
    const arms: Row = Object.fromEntries(ARMS.map(arm => [arm, { denominator: experiment.denominators[arm].cases,
      ordered_units: experiment.denominators[arm].ordered_units, original_paid_minor: experiment.denominators[arm].original_paid_minor,
      analyzed_cases: 0, offered_cases: 0, observed_cases: 0, missing_outcomes: 0, unavailable_cases: 0, incomplete_cost_cases: 0,
      known_returned_units: 0, known_retained_revenue_minor: '0', known_total_cost_minor: '0',
      returned_units: null, retained_revenue_minor: null, total_cost_minor: null, contribution_minor: null, return_rate: null } ]));
    const cases: Row[] = [];
    for (const frozen of experiment.members) {
      const arm = arms[frozen.arm];
      try { this.parent.context(scope, frozen.case_id); }
      catch { arm.unavailable_cases++; arm.missing_outcomes++; cases.push({ arm: frozen.arm, state: 'unavailable_still_in_denominator' }); continue; }
      const memberRow = k.db.prepare('SELECT * FROM commerce_prevention_members WHERE tenant_id=? AND store_id=? AND experiment_id=? AND resource_id=?')
        .get(s.tenant_id, s.store_id, p.experiment_id, frozen.resource_id) as Row;
      const member = preventionBody(memberRow);
      if (member.case_id !== frozen.case_id || member.arm !== frozen.arm) throw new Error('PREVENTION_INTEGRITY');
      const exposed = k.db.prepare('SELECT * FROM commerce_prevention_exposures WHERE tenant_id=? AND store_id=? AND experiment_id=? AND resource_id=?')
        .get(s.tenant_id, s.store_id, p.experiment_id, frozen.resource_id) as Row;
      if (exposed) { const b = preventionBody(exposed); arm.analyzed_cases++; if (b.offer !== null) arm.offered_cases++; }
      const row = k.db.prepare('SELECT * FROM commerce_prevention_outcomes WHERE tenant_id=? AND store_id=? AND experiment_id=? AND resource_id=? ORDER BY source_version DESC LIMIT 1')
        .get(s.tenant_id, s.store_id, p.experiment_id, frozen.resource_id) as Row;
      const value = row ? preventionBody(row) : null, outcome = value?.input;
      const complete = !!outcome && outcome.through_at >= experiment.ends_at && k.clock() >= experiment.ends_at;
      if (!complete) { arm.missing_outcomes++; cases.push({ case_id: frozen.case_id, arm: frozen.arm, state: 'missing_or_immature_followup', source_digest: row?.digest ?? null }); continue; }
      if (value.source_identity !== member.source_identity || value.customer_id !== member.customer_id || value.currency !== experiment.currency
        || outcome.returned_units > member.ordered_units || outcome.through_at > k.clock()) throw new Error('PREVENTION_OUTCOME_INVALID');
      arm.observed_cases++; arm.known_returned_units += outcome.returned_units;
      exact(outcome.costs, [...PREVENTION_COST_CATEGORIES]);
      const missing = PREVENTION_COST_CATEGORIES.filter(category => outcome.costs[category] === null), revenue = outcome.retained_revenue_minor;
      if (revenue === null || missing.length) arm.incomplete_cost_cases++;
      const cost = PREVENTION_COST_CATEGORIES.reduce((sum, category) => sum + (outcome.costs[category] === null ? 0n : minor(outcome.costs[category])), 0n);
      if (revenue !== null && minor(revenue) > minor(member.original_paid_minor)) throw new Error('PREVENTION_OUTCOME_INVALID');
      arm.known_total_cost_minor = (BigInt(arm.known_total_cost_minor) + cost).toString();
      arm.known_retained_revenue_minor = (BigInt(arm.known_retained_revenue_minor) + (revenue === null ? 0n : minor(revenue))).toString();
      cases.push({ case_id: frozen.case_id, arm: frozen.arm, state: 'observed_synthetic', source_digest: row.digest, source_version: row.source_version,
        source_ref: outcome.source_ref, through_at: outcome.through_at, returned_units: outcome.returned_units,
        retained_revenue_minor: revenue, total_cost_minor: missing.length ? null : cost.toString(),
        contribution_minor: revenue === null || missing.length ? null : (minor(revenue) - cost).toString(),
        missing_cost_categories: missing, costs: outcome.costs, economic_basis: value.basis });
    }
    for (const arm of Object.values(arms) as Row[]) {
      if (!arm.missing_outcomes) {
        arm.returned_units = arm.known_returned_units;
        arm.return_rate = { numerator: arm.known_returned_units, denominator: arm.ordered_units };
        if (!arm.incomplete_cost_cases) {
          arm.retained_revenue_minor = arm.known_retained_revenue_minor;
          arm.total_cost_minor = arm.known_total_cost_minor;
          arm.contribution_minor = (BigInt(arm.retained_revenue_minor) - BigInt(arm.total_cost_minor)).toString();
        }
      }
    }
    const compare = (other: string) => {
      const treatment = arms.treatment, reference = arms[other];
      // Per-case differences preserve unequal arm sizes, using exact rational minor units.
      return { reference_arm: other, interpretation: 'descriptive_noncausal_synthetic',
        contribution_difference_minor: treatment.contribution_minor === null || reference.contribution_minor === null ? null : {
          numerator: (BigInt(treatment.contribution_minor) * BigInt(reference.denominator) - BigInt(reference.contribution_minor) * BigInt(treatment.denominator)).toString(),
          denominator: treatment.denominator * reference.denominator,
        },
        return_rate_difference: treatment.return_rate === null || reference.return_rate === null ? null : {
          numerator: (BigInt(treatment.returned_units) * BigInt(reference.ordered_units) - BigInt(reference.returned_units) * BigInt(treatment.ordered_units)).toString(),
          denominator: (BigInt(treatment.ordered_units) * BigInt(reference.ordered_units)).toString(),
        } };
    };
    return { experiment_id: p.experiment_id, experiment_digest: contentDigest(experiment), denominator: experiment.denominator,
      starts_at: experiment.starts_at, ends_at: experiment.ends_at, currency: experiment.currency, currency_exponent: experiment.currency_exponent,
      baseline_definition: experiment.baseline_definition, allocation: experiment.allocation,
      cost_categories: experiment.cost_categories, arms, cases,
      comparisons: { treatment_vs_control: compare('control'), treatment_vs_baseline: compare('baseline') },
      bias_warning: 'Nonrandom, synthetic, predeclared arms do not establish causal improvement or merchant ROI. Missing and erased cases retain their denominator.',
      connected_pilot_observed: false, production_qualified: false, execution_authorized: false };
  }
}
