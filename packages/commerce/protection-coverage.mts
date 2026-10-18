import { exact, id } from './kernel.mts';
import type { CommerceKernel, Scope, Row } from './kernel.mts';
import { contentDigest, jsonValue } from './configuration-values.mts';
import { PartnerReadiness, partnerCurrentActor } from './partner-readiness.mts';
import { partnerBody, partnerResource, partnerRow, partnerInsert, partnerUpdate, partnerSource, serviceContext, currentCustomer, originalCustomer } from './partner-service-core.mts';
import { PartnerFixtureSource, PartnerNoEffectError } from '../adapters/partner-fixture-source.mts';

export class ProtectionCoverage {
  readonly k: CommerceKernel; readonly source: PartnerFixtureSource;
  constructor(k: CommerceKernel, source: PartnerFixtureSource) {this.k = k; this.source = source;}
  propose(scope: Scope, input: unknown) {
    const p = exact(jsonValue(input), ['proposal_id', 'resource_id', 'product_id', 'region']); Object.values(p).forEach(id);
    return this.k.transaction(() => {
      const {s, order, subject_hash} = partnerResource(this.k, scope, p.resource_id, 'action.propose');
      const {context, pin} = serviceContext(this.k, scope, this.source, 'protection', p.region, 'issue');
      const quote = this.source.quoteProtection(p.resource_id, p.product_id, p.region);
      const unknown = this.k.db.prepare("SELECT 1 FROM commerce_protection_operations WHERE tenant_id=? AND store_id=? AND resource_id=? AND state='unknown'")
        .get(s.tenant_id, s.store_id, p.resource_id); if (unknown) throw new Error('ORIGINAL_OPERATION_REQUIRED');
      const preview = {...p, customer_id: order.customer_id, source_version: order.source_version, context, pin, quote: quote.body, quote_digest: quote.digest};
      const body = {preview, preview_digest: contentDigest(preview), proposed_by: s.actor_id, review: null};
      const old = this.k.db.prepare('SELECT * FROM commerce_protection_proposals WHERE tenant_id=? AND store_id=? AND id=?')
        .get(s.tenant_id, s.store_id, p.proposal_id) as Row | undefined;
      if (old) {if (partnerBody(old).body.preview_digest !== body.preview_digest) throw new Error('PROTECTION_PROPOSAL_CONFLICT');}
      else partnerInsert(this.k, 'commerce_protection_proposals', s, p.proposal_id, p.resource_id, subject_hash, 'proposed', body);
      return this.read(scope, p.proposal_id);
    });
  }
  #current(scope: Scope, ref: string, action = 'action.execute', requireReview = true) {
    const row = partnerRow(this.k, scope, 'commerce_protection_proposals', ref, action), b = row.body, p = b.preview;
    if (b.redacted || !p || contentDigest(p) !== b.preview_digest || p.proposal_id !== ref || p.resource_id !== row.resource_id) throw new Error('PROTECTION_PREVIEW_INTEGRITY');
    const {s, order} = partnerResource(this.k, scope, row.resource_id);
    if (order.customer_id !== p.customer_id || order.source_version !== p.source_version || !partnerCurrentActor(this.k, s, b.proposed_by, 'action.propose', row.resource_id)) throw new Error('PREVIEW_CHANGED');
    partnerSource(this.k, scope, this.source, p.context); new PartnerReadiness(this.k).assertReady(scope, p.context, p.pin); this.source.current(p.context);
    if (this.source.quoteProtection(row.resource_id, p.product_id, p.region).digest !== p.quote_digest || contentDigest(p.quote) !== p.quote_digest) throw new Error('PREVIEW_CHANGED');
    if (requireReview && (!b.review || b.review.preview_digest !== b.preview_digest || b.review.actor_id === b.proposed_by ||
      !partnerCurrentActor(this.k, s, b.review.actor_id, 'action.approve', row.resource_id))) throw new Error('INDEPENDENT_REVIEW_REQUIRED'); return row;
  }
  review(scope: Scope, input: unknown) {
    const p = exact(jsonValue(input), ['proposal_id', 'preview_digest']);
    return this.k.transaction(() => {
      const row = this.#current(scope, p.proposal_id, 'action.approve', false), s = this.k.require(scope);
      if (row.body.proposed_by === s.actor_id) throw new Error('INDEPENDENT_REVIEW_REQUIRED');
      if (p.preview_digest !== row.body.preview_digest) throw new Error('PREVIEW_CHANGED');
      partnerUpdate(this.k, 'commerce_protection_proposals', row, 'reviewed', {...row.body, review: {actor_id: s.actor_id, preview_digest: p.preview_digest}});
      return this.read(scope, row.id);
    });
  }
  confirm(scope: Scope, input: unknown) {
    const p = exact(jsonValue(input), ['proposal_id', 'preview_digest']);
    return this.k.transaction(() => {
      const row = this.#current(scope, p.proposal_id, 'resource.read'), s = currentCustomer(this.k, scope, row.resource_id);
      if (p.preview_digest !== row.body.preview_digest) throw new Error('PREVIEW_CHANGED');
      const old = this.k.db.prepare('SELECT * FROM commerce_protection_confirmations WHERE tenant_id=? AND store_id=? AND id=?')
        .get(s.tenant_id, s.store_id, row.id) as Row | undefined;
      if (old) {
        const c = partnerBody(old); if (c.state !== 'confirmed' || c.body.preview_digest !== p.preview_digest || c.body.redacted) throw new Error('CUSTOMER_CONFIRMATION_REVOKED');
        originalCustomer(this.k, row, c.body.session_hash);
      } else partnerInsert(this.k, 'commerce_protection_confirmations', s, row.id, row.resource_id, row.subject_hash, 'confirmed', {
        proposal_id: row.id, preview_digest: p.preview_digest, session_hash: s.token_hash, expires_at: Math.min(row.body.preview.pin.expires_at, s.expires_at),
        acknowledgements: ['exact_fee', 'loss_responsibility', 'exclusions', 'claims_and_settlement', 'synthetic_no_guarantee']});
      return this.read(scope, row.id);
    });
  }
  #confirmed(scope: Scope, ref: string) {
    const row = this.#current(scope, ref), c = partnerBody(this.k.db.prepare('SELECT * FROM commerce_protection_confirmations WHERE tenant_id=? AND store_id=? AND id=?')
      .get(row.tenant_id, row.store_id, ref) as Row | undefined);
    if (c.state !== 'confirmed' || c.body.redacted || c.body.preview_digest !== row.body.preview_digest || c.body.expires_at <= this.k.clock()) throw new Error('CUSTOMER_CONFIRMATION_REQUIRED');
    originalCustomer(this.k, row, c.body.session_hash); return row;
  }
  #operation(scope: Scope, ref: string, action = 'operation.read') {return partnerRow(this.k, scope, 'commerce_protection_operations', ref, action);}
  #finish(scope: Scope, row: Row, result: Row) {
    const c = row.body.command;
    if (!c || row.body.redacted || result.operation_id !== c.operation_id || result.resource_id !== row.resource_id || result.source_identity !== this.source.identity ||
      result.account_id !== c.context.account_id || result.command_digest !== contentDigest(c) || result.state !== 'issued' || result.fee_minor !== c.quote.fee_minor ||
      result.currency !== c.quote.currency || result.loss_party !== c.quote.loss_party) throw new Error('PARTNER_SOURCE_INTEGRITY');
    partnerUpdate(this.k, 'commerce_protection_operations', row, 'issued', {...row.body, result}); return this.read(scope, row.id);
  }
  async dispatch(scope: Scope, ref: string) {
    const current = partnerRow(this.k, scope, 'commerce_protection_proposals', ref, 'action.execute');
    const old = this.k.db.prepare('SELECT * FROM commerce_protection_operations WHERE tenant_id=? AND store_id=? AND id=?')
      .get(current.tenant_id, current.store_id, ref) as Row | undefined;
    if (old && old.state !== 'queued') return this.read(scope, ref);
    const row = this.#confirmed(scope, ref), p = row.body.preview;
    const command = {operation_id: 'coverage_' + contentDigest([row.tenant_id, row.store_id, row.id]).slice(0,32), resource_id: row.resource_id,
      context: p.context, quote: p.quote, quote_digest: p.quote_digest, proposal_digest: row.body.preview_digest};
    this.source.bindCoverage(command);
    this.k.transaction(() => {
      this.#confirmed(scope, ref); if (!old) partnerInsert(this.k, 'commerce_protection_operations', row, ref, row.resource_id, row.subject_hash, 'unknown', {command, result: null});
      else partnerUpdate(this.k, 'commerce_protection_operations', partnerBody(old), 'unknown', {command, result: null});
    });
    let result: Row;
    try {result = await this.source.issueCoverage(command, () => {
      this.#confirmed(scope, ref); const op = this.#operation(scope, ref, 'operation.dispatch');
      if (op.state !== 'unknown' || op.body.redacted || contentDigest(op.body.command) !== contentDigest(command)) throw new Error('ORIGINAL_OPERATION_REQUIRED');
    });} catch (error) {
      const op = this.#operation(scope, ref);
      if (error instanceof PartnerNoEffectError && !op.body.redacted) partnerUpdate(this.k, 'commerce_protection_operations', op, 'blocked', {...op.body, reason: error.message});
      return this.read(scope, ref);
    }
    return this.k.transaction(() => this.#finish(scope, this.#operation(scope, ref), result));
  }
  async reconcile(scope: Scope, ref: string) {
    const row = this.#operation(scope, ref, 'operation.reconcile'); if (row.state !== 'unknown') return this.read(scope, ref);
    if (row.body.redacted) throw new Error('OPERATION_REDACTED'); partnerSource(this.k, scope, this.source, row.body.command.context);
    new PartnerReadiness(this.k).assertReconcile(scope, row.body.command.context);
    const result = await this.source.lookupCoverage(row.body.command.operation_id); if (!result) return this.read(scope, ref);
    return this.k.transaction(() => this.#finish(scope, this.#operation(scope, ref), result));
  }
  read(scope: Scope, ref: string) {
    const row = partnerRow(this.k, scope, 'commerce_protection_proposals', ref, 'resource.read'), p = row.body.preview;
    const op = this.k.db.prepare('SELECT * FROM commerce_protection_operations WHERE tenant_id=? AND store_id=? AND id=?')
      .get(row.tenant_id, row.store_id, ref) as Row | undefined, operation = op ? partnerBody(op) : null;
    return {id: row.id, resource_id: row.resource_id, state: operation?.state ?? row.state, preview_digest: row.body.preview_digest ?? null,
      native_id: operation?.body.result?.native_id ?? null, original_operation_id: operation?.body.command?.operation_id ?? operation?.body.original_operation_id ?? null,
      fee_minor: p?.quote?.fee_minor ?? null, currency: p?.quote?.currency ?? null, loss_party: p?.quote?.loss_party ?? null,
      claims_ref: p?.quote?.claims_ref ?? null, settlement_ref: p?.quote?.settlement_ref ?? null,
      reimbursement_guaranteed: false, financial_settlement: 'unobserved', qualification: 'synthetic_local_only', external_qualified: false};
  }
}
