import { readFileSync } from 'node:fs';
import { editFixture } from './order-edit-helpers.mts';
import { ReturnPrevention } from '../../packages/commerce/return-prevention.mts';
import { Knowledge } from '../../packages/commerce/knowledge.mts';
import { fixturePreventionOutcome, PREVENTION_COST_CATEGORIES } from '../../packages/adapters/prevention-source-guards.mts';

export const preventionGolden = JSON.parse(readFileSync(new URL('../fixtures/assistance/prevention-golden.v1.json', import.meta.url), 'utf8'));
export function preventionFixture(options: any = {}) {
  const line = { id: 'line_one', variant_id: 'basic', product_id: 'shirt', warehouse_id: 'warehouse_one', quantity: 1,
    unit_minor: '2000', discount_minor: '0', tax_minor: '0', tax_bps: 0, status: 'unfulfilled', subscription: false };
  const f = editFixture({ order: { lines: [line, { ...line, id: 'line_two', variant_id: 'equal' }],
    total_minor: '4000', net_paid_minor: '4000' } });
  const service = new ReturnPrevention(f.edits), knowledge = new Knowledge(f.kernel);
  const guide = knowledge.put(f.a.scope, f.source({ id: 'fit_guide', kind: 'catalog', title: 'Fixture garment measurements',
    content: preventionGolden.guidance, expires_at: f.now() + 600000 }));
  const configuration = (extra: any = {}) => ({ id: 'fit', expected_version: 0, enabled: true, expires_at: f.now() + 300000,
    variant_sizes: [{ variant_id: 'basic', product_id: 'shirt', size: 'S' }, { variant_id: 'equal', product_id: 'shirt', size: 'M' },
      { variant_id: 'cheaper', product_id: 'shirt', size: 'L' }, { variant_id: 'upgrade', product_id: 'shirt', size: 'XL' }],
    fit_pairs: [{ from_variant_id: 'basic', suggested_variant_id: 'equal' }],
    guidance: { id: guide.id, revision: guide.revision, sha256: guide.source.sha256 }, ...extra });
  const draft = service.configure(f.owner.scope, configuration());
  if (!options.unapproved) service.approve(f.reviewer.scope, { id: draft.id, version: draft.version, digest: draft.digest });
  const extra = (arm: string) => {
    const original = f.kernel.ingest(f.a.scope, { kind: 'order', source_system: 'synthetic', external_id: 'prevention_' + arm,
      source_version: 1, source_updated_at: f.now(), customer_id: f.original.customer_id, payload: { ...f.original.payload } });
    f.native.seed({ ...f.order, resource_id: original.id }, f.catalog);
    f.cases.create(f.a.scope, { case_id: 'prevention_' + arm, resource_id: original.id, profile_id: 'default', policy_id: 'returns' });
    f.edits.refresh(f.a.scope, 'prevention_' + arm);
    return { case_id: 'prevention_' + arm, arm, resource_id: original.id };
  };
  const baseline = extra('baseline'), control = extra('control'), treatment = { case_id: 'case_one', arm: 'treatment', resource_id: f.original.id };
  const members = [baseline, control, treatment], freezeInput = { id: 'fit_trial', configuration_id: 'fit', configuration_version: 1,
    starts_at: f.now(), ends_at: f.now() + 10000, members: members.map(({ case_id, arm }) => ({ case_id, arm })) };
  if (!options.unfrozen && !options.unapproved) service.freeze(f.owner.scope, freezeInput);
  const analyze = (caseId = 'case_one', eventId = 'purchase_one') => service.analyze(f.a.scope, { experiment_id: 'fit_trial', case_id: caseId, event_id: eventId });
  const preview = (extra: any = {}) => service.preview(f.a.scope, { case_id: 'case_one', intent: { kind: 'item', line_id: 'line_one', variant_id: 'cheaper', address: null, ...extra } });
  const confirm = (p: any) => service.confirm(f.customer, { case_id: 'case_one', quote_id: p.quote_id, quote_digest: p.quote_digest });
  const authorize = (p: any) => f.authorize({ id: p.quote_id, digest: p.quote_digest });
  const outcome = (arm: string, extra: any = {}) => {
    const member = members.find(m => m.arm === arm)!, golden = preventionGolden.arms[arm];
    const costs = Object.fromEntries(PREVENTION_COST_CATEGORIES.map(category => [category, '0']));
    costs.goods = golden.total_cost_minor;
    return fixturePreventionOutcome(f.native, { resource_id: member.resource_id, version: 1, through_at: f.now(),
      returned_units: golden.returned_units, retained_revenue_minor: golden.retained_revenue_minor, costs,
      source_ref: 'fixture_outcome_' + arm, ...extra });
  };
  return { ...f, service, knowledge, guide, configuration, draft, freezeInput, members, baseline, control, treatment,
    analyze, preview, confirm, authorize, outcome };
}
export async function usingPrevention(fn: (f: ReturnType<typeof preventionFixture>) => unknown, options: any = {}) {
  const f = preventionFixture(options);
  try { return await fn(f); } finally { f.cleanup(); }
}
