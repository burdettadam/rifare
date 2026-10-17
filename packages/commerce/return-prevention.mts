import { exact, id, integer } from './kernel.mts';
import type { CommerceKernel, Scope, Row } from './kernel.mts';
import { canonical, contentDigest, jsonValue } from './configuration-values.mts';
import { CaseConfigurations } from './case-configurations.mts';
import { Knowledge } from './knowledge.mts';
import { permissionDecision } from './authorization.mts';
import { OrderEdits } from './order-edit-execution.mts';
import { EDIT_ACTION, editBody, editSettings, editSnapshot, safeOrder } from './order-edit-core.mts';
import { assertExecution } from './execution-stops.mts';
import { assertRecoveryEgress } from './data-guards.mts';
import { assertCaseWorkerScope } from './work-leases.mts';
import { preventionBody, preventionEnrolled, assertPreventionConfirmation } from './return-prevention-guards.mts';
import { enrollPreventionSource, confirmPreventionSource, revokePreventionSource, preventionSourceConsent } from '../adapters/prevention-source-guards.mts';
import { PreventionExperiments } from './prevention-experiments.mts';

export class ReturnPrevention {
  readonly edits: OrderEdits;
  readonly k: CommerceKernel;
  readonly experiments: PreventionExperiments;
  constructor(edits: OrderEdits) {
    this.edits = edits; this.k = edits.kernel;
    this.experiments = new PreventionExperiments(this);
  }
  context(scope: Scope, caseId: string, action = 'case.read') {
    const c = new CaseConfigurations(this.k).inspect(scope, id(caseId));
    return { c, s: this.k.authorize(scope, action, c.resource_id) };
  }
  source(s: Row) {
    const native = this.edits.source;
    if (!native || native.db === this.k.db || native.tenant !== s.tenant_id || native.store !== s.store_id) throw new Error('PREVENTION_SOURCE_UNQUALIFIED');
    return native;
  }
  snapshot(scope: Scope, caseId: string) {
    const { s, c } = this.context(scope, caseId), settings = editSettings(this.k, s), snap = editSnapshot(this.k, s, c.resource_id, settings);
    const source = this.source(s), native = source.snapshot(c.resource_id);
    if (source.identity !== settings.source_identity || source.revision() !== settings.source_revision
      || native.order.customer_id !== c.customer_id || contentDigest(native) !== snap.digest) throw new Error('PREVENTION_SOURCE_CHANGED');
    return { s, c, settings, snapshot: snap.snapshot, digest: snap.digest, source };
  }

  configure(scope: Scope, input: unknown) {
    const p = exact(jsonValue(input), ['id', 'expected_version', 'enabled', 'expires_at', 'variant_sizes', 'fit_pairs', 'guidance']);
    id(p.id); integer(p.expected_version); integer(p.expires_at);
    if (typeof p.enabled !== 'boolean' || p.expires_at <= this.k.clock() || p.expires_at > this.k.clock() + 30 * 86400000
      || !Array.isArray(p.variant_sizes) || !p.variant_sizes.length || p.variant_sizes.length > 100
      || !Array.isArray(p.fit_pairs) || p.fit_pairs.length > 100) throw new Error('PREVENTION_CONFIGURATION_INVALID');
    const sizes = p.variant_sizes.map((v: Row) => {
      exact(v, ['variant_id', 'product_id', 'size']); id(v.variant_id); id(v.product_id); id(v.size); return v;
    }).sort((a: Row, b: Row) => a.variant_id.localeCompare(b.variant_id));
    if (new Set(sizes.map((v: Row) => v.variant_id)).size !== sizes.length) throw new Error('PREVENTION_CONFIGURATION_INVALID');
    const pairs = p.fit_pairs.map((v: Row) => {
      exact(v, ['from_variant_id', 'suggested_variant_id']); id(v.from_variant_id); id(v.suggested_variant_id);
      const from = sizes.find((s: Row) => s.variant_id === v.from_variant_id), to = sizes.find((s: Row) => s.variant_id === v.suggested_variant_id);
      if (!from || !to || from.product_id !== to.product_id || from.variant_id === to.variant_id) throw new Error('PREVENTION_CONFIGURATION_INVALID');
      return v;
    }).sort((a: Row, b: Row) => a.from_variant_id.localeCompare(b.from_variant_id));
    if (new Set(pairs.map((v: Row) => v.from_variant_id)).size !== pairs.length) throw new Error('PREVENTION_CONFIGURATION_INVALID');
    exact(p.guidance, ['id', 'revision', 'sha256']); id(p.guidance.id); integer(p.guidance.revision, 1);
    return this.k.transaction(() => {
      const s = this.k.authorize(scope, 'support.configure'), knowledge = new Knowledge(this.k).get(scope, p.guidance.id, p.guidance.revision);
      if (knowledge.source.sha256 !== p.guidance.sha256 || knowledge.access.visibility !== 'store' || knowledge.access.resource_id !== null
        || knowledge.source.expires_at < p.expires_at || !['catalog', 'support'].includes(knowledge.kind)) throw new Error('PREVENTION_GUIDANCE_UNQUALIFIED');
      const previous = this.k.db.prepare('SELECT max(version) version FROM commerce_prevention_configurations WHERE tenant_id=? AND store_id=? AND id=?')
        .get(s.tenant_id, s.store_id, p.id) as Row;
      if ((previous.version ?? 0) !== p.expected_version) throw new Error('PREVENTION_CONFIGURATION_CHANGED');
      const value = { enabled: p.enabled, expires_at: p.expires_at, variant_sizes: sizes, fit_pairs: pairs,
        guidance: { ...p.guidance, content: knowledge.content, source_uri: knowledge.source.uri },
        suggestion: 'Optional measurement and size-guide review; the current paid goods remain selected.',
        effect_authority: 'none', qualification: 'synthetic_only' };
      this.k.db.prepare("INSERT INTO commerce_prevention_configurations VALUES(?,?,?,?,?,?,?,NULL,NULL,'draft',?)")
        .run(s.tenant_id, s.store_id, p.id, p.expected_version + 1, canonical(value), contentDigest(value), s.actor_id, this.k.clock());
      return this.configuration(scope, { id: p.id, version: p.expected_version + 1 });
    });
  }
  configuration(scope: Scope, input: unknown) {
    const p = exact(jsonValue(input), ['id', 'version']), s = this.k.authorize(scope, 'support.read'); id(p.id); integer(p.version, 1);
    if (s.role === 'customer') throw new Error('ACCESS_DENIED');
    const row = this.k.db.prepare('SELECT * FROM commerce_prevention_configurations WHERE tenant_id=? AND store_id=? AND id=? AND version=?')
      .get(s.tenant_id, s.store_id, p.id, p.version) as Row;
    return { id: p.id, version: p.version, digest: row?.digest, state: row?.state, configuration: preventionBody(row), execution_authorized: false };
  }
  approve(scope: Scope, input: unknown) {
    const p = exact(jsonValue(input), ['id', 'version', 'digest']); id(p.id); integer(p.version, 1);
    return this.k.transaction(() => {
      const s = this.k.authorize(scope, 'policy.review'), row = this.k.db.prepare(
        'SELECT * FROM commerce_prevention_configurations WHERE tenant_id=? AND store_id=? AND id=? AND version=?'
      ).get(s.tenant_id, s.store_id, p.id, p.version) as Row;
      preventionBody(row);
      if (row.digest !== p.digest || row.state !== 'draft') throw new Error('PREVENTION_CONFIGURATION_CHANGED');
      if (row.author === s.actor_id) throw new Error('SELF_REVIEW_DENIED');
      this.k.db.prepare("UPDATE commerce_prevention_configurations SET state='approved',reviewer=?,reviewer_revision=? WHERE tenant_id=? AND store_id=? AND id=? AND version=?")
        .run(s.actor_id, permissionDecision(this.k.db, s, 'policy.review').authority_revision, s.tenant_id, s.store_id, p.id, p.version);
      return this.configuration(scope, { id: p.id, version: p.version });
    });
  }
  approved(scope: Scope, configId: string, version: number) {
    const s = this.k.require(scope), row = this.k.db.prepare(
      'SELECT * FROM commerce_prevention_configurations WHERE tenant_id=? AND store_id=? AND id=? AND version=?'
    ).get(s.tenant_id, s.store_id, id(configId), integer(version, 1)) as Row, b = preventionBody(row);
    const current = this.k.db.prepare("SELECT max(version) version FROM commerce_prevention_configurations WHERE tenant_id=? AND store_id=? AND id=? AND state='approved'")
      .get(s.tenant_id, s.store_id, configId) as Row;
    if (row.state !== 'approved' || current.version !== version || !b.enabled || b.expires_at <= this.k.clock()) throw new Error('PREVENTION_CONFIGURATION_UNAVAILABLE');
    const reviewer = this.k.db.prepare('SELECT * FROM commerce_members WHERE tenant_id=? AND store_id=? AND actor_id=? AND active=1')
      .get(s.tenant_id, s.store_id, row.reviewer) as Row;
    const authority = reviewer && permissionDecision(this.k.db, reviewer, 'policy.review');
    if (!authority?.allowed || authority.authority_revision !== row.reviewer_revision) throw new Error('PREVENTION_REVIEW_AUTHORITY_CHANGED');
    const knowledge = new Knowledge(this.k).get(scope, b.guidance.id, b.guidance.revision);
    if (knowledge.source.sha256 !== b.guidance.sha256 || knowledge.access.visibility !== 'store' || knowledge.access.resource_id !== null) throw new Error('PREVENTION_GUIDANCE_CHANGED');
    return { row, body: b, digest: row.digest };
  }

  freeze(scope: Scope, input: unknown) { return this.experiments.freeze(scope, input); }
  refreshOutcome(scope: Scope, input: unknown) { return this.experiments.refreshOutcome(scope, input); }
  report(scope: Scope, input: unknown) { return this.experiments.report(scope, input); }

  analyze(scope: Scope, input: unknown) {
    const p = exact(jsonValue(input), ['experiment_id', 'case_id', 'event_id']); id(p.experiment_id); id(p.event_id);
    const k = this.k;
    return k.transaction(() => {
      const { s, c } = this.context(scope, p.case_id, 'support.reply');
      if (s.role === 'customer') throw new Error('ACCESS_DENIED');
      assertCaseWorkerScope(k, scope, c.id);
      const { experiment, member } = this.experiments.member(scope, p.experiment_id, c.id);
      const prior = k.db.prepare('SELECT * FROM commerce_prevention_exposures WHERE tenant_id=? AND store_id=? AND (resource_id=? OR event_id=?)')
        .get(s.tenant_id, s.store_id, c.resource_id, p.event_id) as Row;
      if (prior) {
        if (prior.resource_id !== c.resource_id || prior.experiment_id !== p.experiment_id) throw new Error('PREVENTION_EVENT_CONFLICT');
        preventionBody(prior);
        return { ...this.read(scope, { case_id: c.id }), duplicate: true };
      }
      if (k.clock() < experiment.starts_at || k.clock() > experiment.ends_at) throw new Error('PREVENTION_EXPERIMENT_WINDOW');
      const config = this.approved(scope, experiment.configuration_id, experiment.configuration_version);
      if (config.digest !== experiment.configuration_digest) throw new Error('PREVENTION_CONFIGURATION_CHANGED');
      const snap = this.snapshot(scope, c.id), order = snap.snapshot.order;
      if (member.source_identity !== snap.source.identity || member.source_order_version !== order.version || member.source_order_digest !== contentDigest(safeOrder(order))) throw new Error('PREVENTION_PURCHASE_CHANGED');
      const active = order.lines.filter((l: Row) => !['cancelled', 'shipped'].includes(l.status));
      const lines = active.map((l: Row) => ({ id: l.id, variant_id: l.variant_id, product_id: l.product_id, quantity: l.quantity,
        size: config.body.variant_sizes.find((v: Row) => v.variant_id === l.variant_id && v.product_id === l.product_id)?.size ?? null }));
      const multiple = [...new Set(lines.map((l: Row) => l.product_id))].filter(product => new Set(lines.filter((l: Row) => l.product_id === product && l.size !== null).map((l: Row) => l.size)).size > 1);
      const fitPairs = config.body.fit_pairs.filter((pair: Row) => lines.some((l: Row) => l.variant_id === pair.from_variant_id)
        && snap.snapshot.catalog.some((v: Row) => v.id === pair.suggested_variant_id && v.available && !v.excluded && !v.subscription));
      const reasons = [...(multiple.length ? ['multiple_sizes'] : []), ...(fitPairs.length ? ['configured_fit_pair'] : [])];
      const offer = member.arm === 'treatment' && reasons.length ? {
        text: config.body.guidance.content, source: { id: config.body.guidance.id, revision: config.body.guidance.revision, sha256: config.body.guidance.sha256, uri: config.body.guidance.source_uri },
        reasons, lines, fit_pairs: fitPairs, choice: 'keep_current_order_or_request_customer_confirmed_edit',
        approved_configuration_digest: config.digest, automatic_action: false,
      } : null;
      const value = { case_id: c.id, experiment_id: p.experiment_id, arm: member.arm, original_purchase_digest: member.source_order_digest,
        source_identity: snap.source.identity, source_order_version: order.version, configuration_digest: config.digest,
        reasons, offer, counted_exposure: true, paid_goods_changed: false, external_messages_sent: 0,
        statistical_interpretation: 'predeclared_nonrandom_synthetic_descriptive_only', created_at: k.clock() };
      const ref = 'prevention_' + contentDigest([s.tenant_id, s.store_id, c.resource_id]).slice(0, 36);
      if (offer) {
        assertRecoveryEgress(k);
        enrollPreventionSource(snap.source, { resource_id: c.resource_id, customer_id: c.customer_id, experiment_id: p.experiment_id,
          configuration_digest: config.digest, original_version: order.version, original_digest: member.source_order_digest });
      }
      k.db.prepare('INSERT INTO commerce_prevention_exposures VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .run(s.tenant_id, s.store_id, ref, p.experiment_id, c.id, c.resource_id, c.customer_id, p.event_id, canonical(value), contentDigest(value), k.clock());
      return { ...this.read(scope, { case_id: c.id }), duplicate: false };
    });
  }

  read(scope: Scope, input: unknown) {
    const p = exact(jsonValue(input), ['case_id']), { s, c } = this.context(scope, p.case_id), k = this.k;
    const row = k.db.prepare('SELECT * FROM commerce_prevention_exposures WHERE tenant_id=? AND store_id=? AND resource_id=?')
      .get(s.tenant_id, s.store_id, c.resource_id) as Row;
    if (!row) return { case_id: c.id, exposure_id: null, offer: null, previews: [], execution_authorized: false };
    const b = preventionBody(row), experiment = this.experiments.experiment(s, row.experiment_id);
    let available = false;
    try { this.approved(scope, experiment.configuration_id, experiment.configuration_version); available = k.clock() <= experiment.ends_at; } catch { available = false; }
    const previews = (k.db.prepare('SELECT * FROM commerce_prevention_previews WHERE tenant_id=? AND store_id=? AND resource_id=? AND case_id=? ORDER BY created_at,quote_id')
      .all(s.tenant_id, s.store_id, c.resource_id, c.id) as Row[]).map(r => {
        const pb = preventionBody(r), qr = k.db.prepare('SELECT * FROM commerce_edit_quotes WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id, s.store_id, r.quote_id) as Row;
        const q = editBody(qr);
        if (qr.digest !== pb.quote_digest) throw new Error('PREVENTION_INTEGRITY');
        let customerConfirmed = false, nativeRegistered = false;
        try {
          const confirmation = k.db.prepare('SELECT * FROM commerce_prevention_confirmations WHERE tenant_id=? AND store_id=? AND quote_id=?')
            .get(s.tenant_id, s.store_id, r.quote_id) as Row, claim = preventionBody(confirmation);
          assertPreventionConfirmation(k, s, r.quote_id, q); customerConfirmed = true;
          const native = preventionSourceConsent(this.source(s), claim.edit_id);
          nativeRegistered = !!native && native.digest === confirmation.digest && !native.revoked;
        } catch { nativeRegistered = false; }
        return { quote_id: r.quote_id, quote_digest: qr.digest, preview: pb.customer_preview,
          confirmed: customerConfirmed && nativeRegistered, customer_confirmation_recorded: customerConfirmed,
          native_confirmation_registered: nativeRegistered, expires_at: q.expires_at };
      });
    return { case_id: c.id, exposure_id: row.id, digest: row.digest, offer: b.offer, offer_current: available,
      previews, customer_confirmation_required_for_paid_goods: b.offer !== null,
      independent_edits: 'A customer may confirm any fresh qualified edit preview even after declining or outliving this offer.',
      execution_authorized: false, external_messages_sent: 0, ...(s.role !== 'customer' ? { exposure: b } : {}) };
  }

  preview(scope: Scope, input: unknown) {
    const p = exact(jsonValue(input), ['case_id', 'intent']), { s, c } = this.context(scope, p.case_id, 'action.propose');
    exact(p.intent, ['kind', 'line_id', 'variant_id', 'address']);
    if (!preventionEnrolled(this.k, s, c.resource_id)) throw new Error('PREVENTION_NOT_ENROLLED');
    return this.k.transaction(() => {
      const quote = this.edits.quote(scope, { case_id: c.id, ...p.intent }), q = quote.quote, snap = this.snapshot(scope, c.id);
      const value = { quote_digest: quote.digest, customer_preview: { action: q.action, original_lines: snap.snapshot.order.lines.map((l: Row) => ({ id: l.id, variant_id: l.variant_id, quantity: l.quantity, status: l.status })),
        intent: p.intent, line_ids: q.line_ids, details: q.details, currency: q.currency, old_total_minor: q.old_total_minor,
        new_total_minor: q.new_total_minor, delta_minor: q.delta_minor, financial_obligation: q.financial_obligation,
        source_order_version: q.source_order_version, expires_at: q.expires_at, approval_required: true },
        basis: 'customer_selected_qualified_order_edit', created_at: this.k.clock() };
      this.k.db.prepare('INSERT INTO commerce_prevention_previews VALUES(?,?,?,?,?,?,?,?,?)')
        .run(s.tenant_id, s.store_id, quote.id, c.id, c.resource_id, c.customer_id, canonical(value), contentDigest(value), this.k.clock());
      return { case_id: c.id, quote_id: quote.id, quote_digest: quote.digest, preview: value.customer_preview,
        customer_confirmation_required: true, separate_staff_approval_required: true, external_effects: 0 };
    });
  }

  confirm(scope: Scope, input: unknown) {
    const p = exact(jsonValue(input), ['case_id', 'quote_id', 'quote_digest']), k = this.k;
    const value = k.transaction(() => {
      const { s, c } = this.context(scope, p.case_id, 'return.request');
      if (s.role !== 'customer' || s.customer_id !== c.customer_id || s.resource_id !== c.resource_id) throw new Error('CUSTOMER_VERIFICATION_REQUIRED');
      new CaseConfigurations(k).resume(scope, c.id);
      const row = k.db.prepare('SELECT * FROM commerce_edit_quotes WHERE tenant_id=? AND store_id=? AND id=?')
        .get(s.tenant_id, s.store_id, id(p.quote_id)) as Row, q = editBody(row);
      const preview = k.db.prepare('SELECT * FROM commerce_prevention_previews WHERE tenant_id=? AND store_id=? AND quote_id=? AND case_id=?')
        .get(s.tenant_id, s.store_id, row.id, c.id) as Row, pv = preventionBody(preview);
      if (row.digest !== p.quote_digest || pv.quote_digest !== row.digest || q.case_id !== c.id || q.resource_id !== c.resource_id
        || q.customer_id !== s.customer_id || q.expires_at <= k.clock()) throw new Error('PREVENTION_PREVIEW_CHANGED');
      const current = this.snapshot(scope, c.id);
      if (q.configuration_digest !== c.configuration_digest || q.case_revision !== c.revision || q.settings_digest !== current.settings.digest
        || q.snapshot_digest !== current.digest || q.source_order_version !== current.snapshot.order.version
        || q.source_order_digest !== contentDigest(safeOrder(current.snapshot.order))) throw new Error('PREVENTION_PREVIEW_CHANGED');
      assertExecution(k, s, EDIT_ACTION, q.control_stamp); assertRecoveryEgress(k);
      const old = k.db.prepare('SELECT * FROM commerce_prevention_confirmations WHERE tenant_id=? AND store_id=? AND quote_id=?')
        .get(s.tenant_id, s.store_id, row.id) as Row;
      if (old) {
        const prior = preventionBody(old);
        if (old.revoked || old.session_hash !== s.token_hash || prior.quote_digest !== row.digest) throw new Error('PREVENTION_CONFIRMATION_CHANGED');
        assertPreventionConfirmation(k, s, row.id, q); return prior;
      }
      const consent = { quote_id: row.id, quote_digest: row.digest, preview_digest: preview.digest,
        edit_id: 'edit_' + contentDigest([s.tenant_id, s.store_id, c.resource_id, q.source_order_version, row.digest]).slice(0, 40),
        case_id: c.id, resource_id: c.resource_id, customer_id: c.customer_id, configuration_digest: c.configuration_digest,
        source_identity: q.source_identity, source_order_version: q.source_order_version, source_order_digest: q.source_order_digest,
        settings_digest: q.settings_digest, intent_digest: q.intent_digest, line_ids: q.line_ids,
        currency: q.currency, new_total_minor: q.new_total_minor, delta_minor: q.delta_minor,
        confirmed_at: k.clock(), expires_at: Math.min(q.expires_at, s.expires_at),
        meaning: 'explicit_authenticated_customer_edit_confirmation_not_staff_approval', qualification: 'synthetic_only' };
      k.db.prepare('INSERT INTO commerce_prevention_confirmations VALUES(?,?,?,?,?,?,?,?,?,0,?)')
        .run(s.tenant_id, s.store_id, row.id, c.id, c.resource_id, c.customer_id, s.token_hash, canonical(consent), contentDigest(consent), k.clock());
      return consent;
    });
    // The source is a second durable ledger. Failure here leaves new native writes blocked;
    // the same customer can retry this exact confirmation to complete the bridge.
    const native = confirmPreventionSource(this.source(k.require(scope)), k, scope, value.quote_id);
    return { case_id: value.case_id, quote_id: value.quote_id, quote_digest: value.quote_digest,
      confirmation_digest: native.digest, confirmed: true, separate_staff_approval_required: true,
      expires_at: value.expires_at, paid_goods_changed: false, execution_authorized: false };
  }
  revoke(scope: Scope, input: unknown) {
    const p = exact(jsonValue(input), ['case_id', 'quote_id']), { s, c } = this.context(scope, p.case_id, 'return.request');
    if (s.role !== 'customer' || s.resource_id !== c.resource_id || s.customer_id !== c.customer_id) throw new Error('CUSTOMER_VERIFICATION_REQUIRED');
    const row = this.k.db.prepare('SELECT * FROM commerce_prevention_confirmations WHERE tenant_id=? AND store_id=? AND quote_id=? AND case_id=?')
      .get(s.tenant_id, s.store_id, id(p.quote_id), c.id) as Row, b = preventionBody(row);
    const native = revokePreventionSource(this.source(s), b.edit_id);
    this.k.db.prepare('UPDATE commerce_prevention_confirmations SET revoked=1 WHERE tenant_id=? AND store_id=? AND quote_id=?')
      .run(s.tenant_id, s.store_id, p.quote_id);
    return { revoked: true, already_committed: native.already_committed,
      consequence: native.already_committed ? 'Existing committed effects need reconciliation; consent cannot recall them.' : 'New paid-goods effects are blocked.', execution_authorized: false };
  }
}
