import { exact, id } from './kernel.mts';
import type { CommerceKernel, Scope, Row } from './kernel.mts';
import { contentDigest, jsonValue } from './configuration-values.mts';
import { PartnerReadiness, partnerCurrentActor } from './partner-readiness.mts';
import { partnerResource, partnerRow, partnerBody, partnerInsert, partnerUpdate, partnerSource, serviceContext } from './partner-service-core.mts';
import { PartnerFixtureSource, PartnerNoEffectError } from '../adapters/partner-fixture-source.mts';

export class NetworkAlerts {
  readonly k: CommerceKernel; readonly source: PartnerFixtureSource;
  constructor(k: CommerceKernel, source: PartnerFixtureSource) {this.k = k; this.source = source;}
  import(scope: Scope, input: unknown) {
    const p = exact(jsonValue(input), ['event_id', 'resource_id', 'region']); Object.values(p).forEach(id);
    return this.k.transaction(() => {
      const {s, subject_hash} = partnerResource(this.k, scope, p.resource_id, 'event.process'); partnerSource(this.k, scope, this.source);
      const event = this.source.alert(p.event_id); if (!event || event.resource_id !== p.resource_id || event.source_identity !== this.source.identity) throw new Error('PARTNER_SOURCE_SCOPE');
      const old = this.k.db.prepare('SELECT * FROM commerce_network_alerts WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id, s.store_id, event.alert_id) as Row | undefined;
      if (old) {const previous = partnerBody(old); if (previous.body.redacted || previous.resource_id !== p.resource_id || contentDigest(previous.body.event) !== contentDigest(event)) throw new Error('ALERT_EVENT_CONFLICT');
        return this.read(scope, event.alert_id);}
      const {context, pin, configuration} = serviceContext(this.k, scope, this.source, 'network_alerts', p.region, 'respond');
      if (event.account_id !== context.account_id || event.currency !== configuration.body.terms.currency || event.fee_minor !== configuration.body.terms.fee_minor ||
        event.allowed_responses.some((response: string) => !configuration.body.terms.responses.includes(response))) throw new Error('PARTNER_SOURCE_SCOPE');
      // One fee observation per original provider fee. A new alert ID cannot
      // duplicate an already observed fee or turn it into a refund/charge.
      const fee = (this.k.db.prepare('SELECT * FROM commerce_network_alerts WHERE tenant_id=? AND store_id=?').all(s.tenant_id, s.store_id) as Row[])
        .map(partnerBody).find(r => r.body.event?.source_identity === event.source_identity && r.body.event?.account_id === event.account_id && r.body.event?.fee_ref === event.fee_ref);
      if (fee) throw new Error('ALERT_FEE_IDENTITY_CONFLICT');
      partnerInsert(this.k, 'commerce_network_alerts', s, event.alert_id, p.resource_id, subject_hash, 'received', {context, pin, event, imported_by: s.actor_id});
      return this.read(scope, event.alert_id);
    });
  }
  propose(scope: Scope, input: unknown) {
    const p = exact(jsonValue(input), ['operation_id', 'alert_id', 'response']); id(p.operation_id); id(p.alert_id);
    return this.k.transaction(() => {
      const row = partnerRow(this.k, scope, 'commerce_network_alerts', p.alert_id, 'action.propose'), b = row.body, s = this.k.require(scope);
      if (b.redacted) throw new Error('OPERATION_REDACTED');
      const existing = (this.k.db.prepare('SELECT * FROM commerce_network_alert_actions WHERE tenant_id=? AND store_id=? AND resource_id=?')
        .all(s.tenant_id, s.store_id, row.resource_id) as Row[]).map(partnerBody).find(r => r.body.alert_id === row.id);
      if (existing) {
        if (existing.id !== p.operation_id || existing.body.response !== p.response) throw new Error('ORIGINAL_OPERATION_REQUIRED'); return this.operation(scope, existing.id);
      }
      partnerSource(this.k, scope, this.source, b.context); new PartnerReadiness(this.k).assertReady(scope, b.context, b.pin); const cfg = this.source.current(b.context);
      if (b.event.deadline_at <= this.k.clock()) throw new Error('ALERT_DEADLINE_EXPIRED');
      if (!b.event.allowed_responses.includes(p.response) || !cfg.body.terms.responses.includes(p.response)) throw new Error('ALERT_RESPONSE_UNSUPPORTED');
      const preview = {alert_id: row.id, operation_id: p.operation_id, resource_id: row.resource_id, response: p.response, event_digest: contentDigest(b.event), context: b.context, pin: b.pin};
      partnerInsert(this.k, 'commerce_network_alert_actions', row, p.operation_id, row.resource_id, row.subject_hash, 'proposed',
        {alert_id: row.id, response: p.response, preview, preview_digest: contentDigest(preview), proposed_by: s.actor_id, approval: null, command: null, result: null});
      return this.operation(scope, p.operation_id);
    });
  }
  #current(scope: Scope, ref: string, action = 'action.execute', approved = true) {
    const row = partnerRow(this.k, scope, 'commerce_network_alert_actions', ref, action), b = row.body;
    if (b.redacted || !b.preview || contentDigest(b.preview) !== b.preview_digest || b.preview.operation_id !== row.id || b.preview.resource_id !== row.resource_id ||
      b.preview.alert_id !== b.alert_id || b.preview.response !== b.response) throw new Error('ALERT_PREVIEW_INTEGRITY');
    const alert = partnerRow(this.k, scope, 'commerce_network_alerts', b.alert_id), s = this.k.require(scope);
    if (alert.resource_id !== row.resource_id || alert.body.redacted || contentDigest(alert.body.event) !== b.preview.event_digest) throw new Error('ALERT_EVENT_CONFLICT');
    partnerSource(this.k, scope, this.source, b.preview.context); new PartnerReadiness(this.k).assertReady(scope, b.preview.context, b.preview.pin);
    const cfg = this.source.current(b.preview.context), current = this.source.alert(alert.body.event.event_id);
    if (!current || contentDigest(current) !== b.preview.event_digest || current.deadline_at <= this.k.clock()) throw new Error('ALERT_DEADLINE_EXPIRED');
    if (!current.allowed_responses.includes(b.response) || !cfg.body.terms.responses.includes(b.response)) throw new Error('ALERT_RESPONSE_UNSUPPORTED');
    if (!partnerCurrentActor(this.k, s, b.proposed_by, 'action.propose', row.resource_id)) throw new Error('PARTNER_AUTHOR_AUTHORITY_CHANGED');
    if (approved && (!b.approval || b.approval.preview_digest !== b.preview_digest || b.approval.actor_id === b.proposed_by ||
      !partnerCurrentActor(this.k, s, b.approval.actor_id, 'action.approve', row.resource_id))) throw new Error('INDEPENDENT_REVIEW_REQUIRED'); return {row, alert};
  }
  approve(scope: Scope, input: unknown) {
    const p = exact(jsonValue(input), ['operation_id', 'preview_digest']);
    return this.k.transaction(() => {
      const {row} = this.#current(scope, p.operation_id, 'action.approve', false), s = this.k.require(scope);
      if (s.actor_id === row.body.proposed_by) throw new Error('INDEPENDENT_REVIEW_REQUIRED');
      if (p.preview_digest !== row.body.preview_digest) throw new Error('PREVIEW_CHANGED');
      if (row.state !== 'proposed' && row.state !== 'approved') throw new Error('ORIGINAL_OPERATION_REQUIRED');
      partnerUpdate(this.k, 'commerce_network_alert_actions', row, 'approved', {...row.body, approval: {actor_id: s.actor_id, preview_digest: p.preview_digest}});
      return this.operation(scope, row.id);
    });
  }
  #finish(scope: Scope, row: Row, result: Row) {
    const c = row.body.command;
    if (row.body.redacted || !c || result.operation_id !== row.id || result.resource_id !== row.resource_id || result.source_identity !== this.source.identity ||
      result.account_id !== c.context.account_id || result.alert_id !== c.alert_id || result.command_digest !== contentDigest(c) || result.state !== 'acknowledged' ||
      result.financial_effect_executed !== false || result.recovered_minor !== '0') throw new Error('PARTNER_SOURCE_INTEGRITY');
    partnerUpdate(this.k, 'commerce_network_alert_actions', row, 'acknowledged', {...row.body, result}); return this.operation(scope, row.id);
  }
  async dispatch(scope: Scope, ref: string) {
    const old = partnerRow(this.k, scope, 'commerce_network_alert_actions', ref, 'action.execute');
    if (old.state !== 'approved') return this.operation(scope, ref); const {row, alert} = this.#current(scope, ref), b = row.body;
    const command = {operation_id: row.id, resource_id: row.resource_id, context: b.preview.context, event_id: alert.body.event.event_id,
      alert_id: b.alert_id, event_digest: b.preview.event_digest, response: b.response, preview_digest: b.preview_digest};
    this.source.bindAlertResponse(command);
    this.k.transaction(() => {this.#current(scope, ref); partnerUpdate(this.k, 'commerce_network_alert_actions', row, 'unknown', {...b, command});});
    let result: Row;
    try {result = await this.source.respondAlert(command, () => {
      const {row: current} = this.#current(scope, ref); this.k.authorize(scope, 'operation.dispatch', current.resource_id);
      if (current.state !== 'unknown' || contentDigest(current.body.command) !== contentDigest(command)) throw new Error('ORIGINAL_OPERATION_REQUIRED');
    });} catch (error) {
      const current = partnerRow(this.k, scope, 'commerce_network_alert_actions', ref);
      if (error instanceof PartnerNoEffectError && !current.body.redacted) partnerUpdate(this.k, 'commerce_network_alert_actions', current, 'blocked', {...current.body, reason: error.message});
      return this.operation(scope, ref);
    }
    return this.k.transaction(() => this.#finish(scope, partnerRow(this.k, scope, 'commerce_network_alert_actions', ref), result));
  }
  async reconcile(scope: Scope, ref: string) {
    const row = partnerRow(this.k, scope, 'commerce_network_alert_actions', ref, 'operation.reconcile'); if (row.state !== 'unknown') return this.operation(scope, ref);
    if (row.body.redacted || !row.body.command) throw new Error('OPERATION_REDACTED');
    partnerSource(this.k, scope, this.source, row.body.command.context); new PartnerReadiness(this.k).assertReconcile(scope, row.body.command.context);
    const result = await this.source.lookupAlertResponse(row.id); if (!result) return this.operation(scope, ref);
    return this.k.transaction(() => this.#finish(scope, partnerRow(this.k, scope, 'commerce_network_alert_actions', ref), result));
  }
  operation(scope: Scope, ref: string) {
    const row = partnerRow(this.k, scope, 'commerce_network_alert_actions', ref);
    return {id: row.id, resource_id: row.resource_id, alert_id: row.body.alert_id ?? null, state: row.state,
      preview_digest: row.body.preview_digest ?? null, native_id: row.body.result?.native_id ?? null, financial_effect_executed: false};
  }
  read(scope: Scope, ref: string) {
    const row = partnerRow(this.k, scope, 'commerce_network_alerts', ref), e = row.body.event;
    return {id: row.id, resource_id: row.resource_id, account_id: e?.account_id ?? null, deadline_at: e?.deadline_at ?? null,
      source_event_id: e?.event_id ?? null, fee_ref: e?.fee_ref ?? null, fee_minor: e?.fee_minor ?? null,
      recovered_minor: '0', network_coverage_qualified: false, qualification: 'synthetic_local_only', external_qualified: false};
  }
}
