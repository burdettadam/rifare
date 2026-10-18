import { exact, id } from './kernel.mts';
import type { CommerceKernel, Scope, Row } from './kernel.mts';
import { contentDigest, jsonValue } from './configuration-values.mts';
import { PartnerReadiness, partnerCurrentActor } from './partner-readiness.mts';
import { partnerResource, partnerRow, partnerBody, partnerInsert, partnerUpdate, partnerSource, serviceContext } from './partner-service-core.mts';
import type { PartnerFixtureSource } from '../adapters/partner-fixture-source.mts';

export class DutyAssessments {
  readonly k: CommerceKernel; readonly source: PartnerFixtureSource;
  constructor(k: CommerceKernel, source: PartnerFixtureSource) {this.k = k; this.source = source;}
  open(scope: Scope, input: unknown) {
    const p = exact(jsonValue(input), ['case_id', 'resource_id', 'estimate_id', 'region']); Object.values(p).forEach(id);
    return this.k.transaction(() => {
      const {s, subject_hash} = partnerResource(this.k, scope, p.resource_id, 'action.propose'), {context, pin, configuration} = serviceContext(this.k, scope, this.source, 'duties', p.region, 'estimate');
      const estimate = this.source.duty(p.estimate_id);
      if (!estimate || estimate.kind !== 'estimate' || estimate.resource_id !== p.resource_id || estimate.source_identity !== context.source_identity || estimate.account_id !== context.account_id ||
        estimate.source_config_digest !== context.source_config_digest || estimate.currency !== configuration.body.terms.currency) throw new Error('PARTNER_SOURCE_SCOPE');
      if (!configuration.body.terms.routes.includes(estimate.route_id)) throw new Error('ROUTE_UNSUPPORTED');
      const body = {context, pin, estimate, assessment: null, variance: null, proposed_by: s.actor_id, responsibility: configuration.body.terms};
      const old = this.k.db.prepare('SELECT * FROM commerce_duty_assessments WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id, s.store_id, p.case_id) as Row | undefined;
      if (old) {if (contentDigest(partnerBody(old).body.estimate) !== contentDigest(estimate)) throw new Error('DUTY_CASE_CONFLICT');}
      else partnerInsert(this.k, 'commerce_duty_assessments', s, p.case_id, p.resource_id, subject_hash, 'estimated', body); return this.read(scope, p.case_id);
    });
  }
  assess(scope: Scope, input: unknown) {
    const p = exact(jsonValue(input), ['case_id', 'assessment_id']); id(p.assessment_id);
    return this.k.transaction(() => {
      const row = partnerRow(this.k, scope, 'commerce_duty_assessments', p.case_id, 'operation.reconcile'), {context, estimate} = row.body;
      if (row.body.redacted) throw new Error('OPERATION_REDACTED'); partnerSource(this.k, scope, this.source, context); new PartnerReadiness(this.k).assertReconcile(scope, context);
      const assessment = this.source.duty(p.assessment_id);
      if (!assessment || assessment.kind !== 'assessment' || assessment.resource_id !== row.resource_id || assessment.source_identity !== context.source_identity || assessment.account_id !== context.account_id ||
        assessment.currency !== estimate.currency || assessment.quote_ref !== estimate.event_id || assessment.route_id !== estimate.route_id) throw new Error('DUTY_ASSESSMENT_MISMATCH');
      if (row.body.assessment && contentDigest(row.body.assessment) !== contentDigest(assessment)) throw new Error('ASSESSMENT_CORRECTION_REVIEW_REQUIRED');
      const variance = {estimate_ref: estimate.event_id, assessment_ref: assessment.event_id, estimate_minor: estimate.amount_minor,
        assessment_minor: assessment.amount_minor, variance_minor: (BigInt(assessment.amount_minor) - BigInt(estimate.amount_minor)).toString(),
        currency: estimate.currency, state: estimate.amount_minor === assessment.amount_minor ? 'balanced' : 'review_required', approval: null};
      if (!row.body.assessment) partnerUpdate(this.k, 'commerce_duty_assessments', row, 'assessed', {...row.body, assessment, variance});
      return this.read(scope, row.id);
    });
  }
  approveVariance(scope: Scope, input: unknown) {
    const p = exact(jsonValue(input), ['case_id', 'variance_digest', 'obligation_ref']); id(p.obligation_ref);
    return this.k.transaction(() => {
      const row = partnerRow(this.k, scope, 'commerce_duty_assessments', p.case_id, 'action.approve'), s = this.k.require(scope), variance = row.body.variance;
      if (!variance || p.variance_digest !== contentDigest(variance) || variance.state !== 'review_required') throw new Error('DUTY_VARIANCE_CHANGED');
      if (row.body.proposed_by === s.actor_id) throw new Error('INDEPENDENT_REVIEW_REQUIRED');
      new PartnerReadiness(this.k).assertReady(scope, row.body.context, row.body.pin);
      if (!partnerCurrentActor(this.k, s, row.body.proposed_by, 'action.propose', row.resource_id)) throw new Error('PARTNER_AUTHOR_AUTHORITY_CHANGED');
      partnerUpdate(this.k, 'commerce_duty_assessments', row, 'assessed', {...row.body, variance: {...variance, state: 'approved_obligation',
        approval: {actor_id: s.actor_id, obligation_ref: p.obligation_ref, variance_digest: p.variance_digest}}}); return this.read(scope, row.id);
    });
  }
  read(scope: Scope, ref: string) {
    const row = partnerRow(this.k, scope, 'commerce_duty_assessments', ref), b = row.body, variance = b.variance;
    return {id: row.id, resource_id: row.resource_id, state: row.state, estimate_ref: b.estimate?.event_id ?? null,
      estimate_minor: b.estimate?.amount_minor ?? null, assessment_ref: variance?.assessment_ref ?? null,
      assessment_minor: variance?.assessment_minor ?? null, variance_minor: variance?.variance_minor ?? null,
      variance_state: variance?.state ?? 'unassessed', variance_digest: variance ? contentDigest(variance) : null,
      collection_minor: null, remittance_minor: null, financial_execution_authorized: false, guaranteed_landed_cost: false, qualification: 'synthetic_local_only', external_qualified: false};
  }
}
