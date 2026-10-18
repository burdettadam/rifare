import { exact, id } from './kernel.mts';
import type { CommerceKernel, Scope, Row } from './kernel.mts';
import { contentDigest, jsonValue } from './configuration-values.mts';
import { money } from './money.mts';
import { assertNotErased } from './data-guards.mts';
import { PartnerReadiness, partnerCurrentActor } from './partner-readiness.mts';
import { partnerResource, partnerRow, partnerBody, partnerInsert, partnerUpdate, partnerSource, serviceContext, currentCustomer } from './partner-service-core.mts';
import { PartnerFixtureSource, PartnerNoEffectError } from '../adapters/partner-fixture-source.mts';

/** The provider's eligibility observation and a canonical payment observation
 * are distinct. Confirmation records eligibility only; it cannot move money. */
export class HsaFsa {
  readonly k: CommerceKernel; readonly source: PartnerFixtureSource;
  constructor(k: CommerceKernel, source: PartnerFixtureSource) {this.k = k; this.source = source;}
  #facts(scope: Scope, p: Row) {
    const {s, order} = partnerResource(this.k, scope, p.resource_id), {context, pin, configuration} = serviceContext(this.k, scope, this.source, 'hsa_fsa', p.region, 'eligibility');
    const eligibility = this.source.eligibility(p.eligibility_id);
    if (!eligibility || eligibility.authority !== 'synthetic_provider_observation' || eligibility.resource_id !== p.resource_id || eligibility.product_id !== p.product_id ||
      eligibility.source_identity !== context.source_identity || eligibility.account_id !== context.account_id || eligibility.source_config_digest !== context.source_config_digest ||
      eligibility.region !== p.region || eligibility.expires_at <= this.k.clock() || !configuration.body.terms.products.includes(p.product_id)) throw new Error('PROVIDER_ELIGIBILITY_REQUIRED');
    if (!eligibility.eligible) throw new Error('PROVIDER_ELIGIBILITY_REQUIRED');
    // An order-authenticated customer may confirm this exact order-linked
    // observation; no general payment-resource read is granted to that session.
    const payment = this.k.db.prepare("SELECT * FROM commerce_resources WHERE tenant_id=? AND store_id=? AND id=? AND kind='payment'")
      .get(s.tenant_id, s.store_id, id(p.payment_resource_id)) as Row | undefined;
    if (!payment || payment.customer_id !== order.customer_id || payment.source_system !== configuration.body.terms.payment_source_identity ||
      payment.source_updated_at > this.k.clock()) throw new Error('PAYMENT_OBSERVATION_REQUIRED');
    assertNotErased(this.k, s, payment.id, payment.customer_id); const payload = jsonValue(JSON.parse(payment.payload));
    exact(payload, ['order_resource_id', 'provider_reference', 'state', 'currency', 'amount_minor', 'account_id']);
    money(payload.currency, payload.amount_minor);
    if (payload.order_resource_id !== order.id || payload.provider_reference !== eligibility.payment_reference || payload.account_id !== context.account_id ||
      !['authorized', 'captured'].includes(payload.state) || payload.currency !== eligibility.currency || payload.currency !== configuration.body.terms.currency ||
      BigInt(payload.amount_minor) > BigInt(eligibility.allowed_minor)) throw new Error('PAYMENT_OBSERVATION_REQUIRED');
    return {context, pin, eligibility, payment: {resource_id: payment.id, source_system: payment.source_system, source_version: payment.source_version,
      payload_digest: contentDigest(payload), provider_reference: payload.provider_reference, state: payload.state, currency: payload.currency, amount_minor: payload.amount_minor}};
  }
  propose(scope: Scope, input: unknown) {
    const p = exact(jsonValue(input), ['operation_id', 'resource_id', 'eligibility_id', 'payment_resource_id', 'product_id', 'region']); Object.values(p).forEach(id);
    return this.k.transaction(() => {
      const {s, subject_hash} = partnerResource(this.k, scope, p.resource_id, 'action.propose'), facts = this.#facts(scope, p);
      const preview = {...p, ...facts}, body = {preview, preview_digest: contentDigest(preview), proposed_by: s.actor_id,
        command: null, result: null, confirmation: null};
      const old = this.k.db.prepare('SELECT * FROM commerce_hsa_fsa_eligibility WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id, s.store_id, p.operation_id) as Row | undefined;
      const unknown = this.k.db.prepare("SELECT id FROM commerce_hsa_fsa_eligibility WHERE tenant_id=? AND store_id=? AND resource_id=? AND state='unknown'").get(s.tenant_id, s.store_id, p.resource_id) as Row | undefined;
      if (unknown && unknown.id !== p.operation_id) throw new Error('ORIGINAL_OPERATION_REQUIRED');
      if (old) {if (partnerBody(old).body.preview_digest !== body.preview_digest) throw new Error('ELIGIBILITY_OPERATION_CONFLICT');}
      else partnerInsert(this.k, 'commerce_hsa_fsa_eligibility', s, p.operation_id, p.resource_id, subject_hash, 'proposed', body);
      return this.read(scope, p.operation_id);
    });
  }
  #current(scope: Scope, ref: string) {
    const row = partnerRow(this.k, scope, 'commerce_hsa_fsa_eligibility', ref, 'resource.read'), b = row.body;
    if (b.redacted || !b.preview || contentDigest(b.preview) !== b.preview_digest || b.preview.operation_id !== row.id || b.preview.resource_id !== row.resource_id) throw new Error('ELIGIBILITY_PREVIEW_INTEGRITY');
    const facts = this.#facts(scope, b.preview), previous = {context: b.preview.context, pin: b.preview.pin, eligibility: b.preview.eligibility, payment: b.preview.payment};
    if (contentDigest(facts) !== contentDigest(previous)) throw new Error('PREVIEW_CHANGED');
    const s = this.k.require(scope); if (!partnerCurrentActor(this.k, s, b.proposed_by, 'action.propose', row.resource_id)) throw new Error('PARTNER_AUTHOR_AUTHORITY_CHANGED'); return row;
  }
  #finish(scope: Scope, row: Row, result: Row) {
    const c = row.body.command;
    if (row.body.redacted || !c || result.operation_id !== row.id || result.resource_id !== row.resource_id || result.source_identity !== this.source.identity ||
      result.account_id !== c.context.account_id || result.command_digest !== contentDigest(c) || result.state !== 'eligibility_confirmed' ||
      result.payment_reference !== c.payment_reference || result.payment_effect_executed !== false) throw new Error('PARTNER_SOURCE_INTEGRITY');
    partnerUpdate(this.k, 'commerce_hsa_fsa_eligibility', row, 'eligibility_confirmed', {...row.body, result}); return this.read(scope, row.id);
  }
  async confirm(scope: Scope, input: unknown) {
    const p = exact(jsonValue(input), ['operation_id', 'preview_digest']), original = partnerRow(this.k, scope, 'commerce_hsa_fsa_eligibility', p.operation_id, 'resource.read');
    currentCustomer(this.k, scope, original.resource_id);
    if (p.preview_digest !== original.body.preview_digest) throw new Error('PREVIEW_CHANGED');
    if (original.state !== 'proposed') return this.read(scope, original.id);
    const row = this.#current(scope, p.operation_id), preview = row.body.preview, customer = currentCustomer(this.k, scope, row.resource_id);
    const command = {operation_id: row.id, resource_id: row.resource_id, context: preview.context, eligibility_id: preview.eligibility_id,
      eligibility_digest: contentDigest(preview.eligibility), payment_reference: preview.payment.provider_reference, preview_digest: row.body.preview_digest};
    this.source.bindEligibility(command);
    this.k.transaction(() => {
      this.#current(scope, row.id); currentCustomer(this.k, scope, row.resource_id);
      partnerUpdate(this.k, 'commerce_hsa_fsa_eligibility', row, 'unknown', {...row.body, command,
        confirmation: {session_hash: customer.token_hash, preview_digest: p.preview_digest, eligibility_only: true}});
    });
    let result: Row;
    try {result = await this.source.qualifyPurchase(command, () => {
      const current = this.#current(scope, row.id); currentCustomer(this.k, scope, row.resource_id);
      if (current.state !== 'unknown' || contentDigest(current.body.command) !== contentDigest(command) ||
        current.body.confirmation?.session_hash !== customer.token_hash) throw new Error('ORIGINAL_OPERATION_REQUIRED');
    });} catch (error) {
      const current = partnerRow(this.k, scope, 'commerce_hsa_fsa_eligibility', row.id, 'resource.read');
      if (error instanceof PartnerNoEffectError && !current.body.redacted) partnerUpdate(this.k, 'commerce_hsa_fsa_eligibility', current, 'blocked', {...current.body, reason: error.message});
      return this.read(scope, row.id);
    }
    return this.k.transaction(() => this.#finish(scope, partnerRow(this.k, scope, 'commerce_hsa_fsa_eligibility', row.id, 'resource.read'), result));
  }
  async reconcile(scope: Scope, ref: string) {
    const row = partnerRow(this.k, scope, 'commerce_hsa_fsa_eligibility', ref, 'operation.reconcile');
    if (row.state !== 'unknown') return this.read(scope, ref); if (row.body.redacted || !row.body.command) throw new Error('OPERATION_REDACTED');
    partnerSource(this.k, scope, this.source, row.body.command.context); new PartnerReadiness(this.k).assertReconcile(scope, row.body.command.context);
    const result = await this.source.lookupEligibility(row.id); if (!result) return this.read(scope, ref);
    return this.k.transaction(() => this.#finish(scope, partnerRow(this.k, scope, 'commerce_hsa_fsa_eligibility', ref), result));
  }
  read(scope: Scope, ref: string) {
    const row = partnerRow(this.k, scope, 'commerce_hsa_fsa_eligibility', ref, 'resource.read'), b = row.body;
    return {id: row.id, resource_id: row.resource_id, state: row.state, preview_digest: b.preview_digest ?? null,
      eligibility_ref: b.preview?.eligibility_id ?? null, native_id: b.result?.native_id ?? null,
      payment_reference: b.preview?.payment?.provider_reference ?? null, payment_status: b.preview?.payment?.state ?? 'unobserved',
      payment_effect_executed: false, tax_or_medical_assurance: false, qualification: 'synthetic_local_only', external_qualified: false};
  }
}
