import { exact, id, integer, token } from './kernel.mts';
import type { CommerceKernel, Scope, Row } from './kernel.mts';
import { canonical, contentDigest, jsonValue } from './configuration-values.mts';
import { CaseConfigurations } from './case-configurations.mts';
import { quoteRow, ReturnReview } from './return-intake-core.mts';
import { evidenceRows } from './return-evidence.mts';
import { sourceReturnLines } from './return-eligibility.mts';
import { permissionDecision } from './authorization.mts';
import { assertCaseWorkerScope } from './work-leases.mts';

function body(row: Row | undefined) {
  if (!row) throw new Error('NOT_FOUND');
  const value = JSON.parse(row.body);
  if (contentDigest(value) !== row.digest) throw new Error('RISK_HISTORY_INTEGRITY');
  return value;
}
const REASONS = Object.freeze({
  evidence_not_clean: 'The cited upload is not currently a clean usable evidence item.',
  evidence_state_conflict: 'The order evidence flag and the cited upload scanner state disagree.',
  source_snapshot_changed: 'The source order changed after the return quote was captured.',
  quantity_disagreement: 'The selected quantity exceeds the currently recorded unreturned fulfilled quantity.',
  evidence_missing: 'The pinned published policy requests evidence, and no upload is selected.',
});

/** Source observations and review records; this class cannot grant or deny a return. */
export class RiskAssistance {
  readonly k: CommerceKernel;
  constructor(k: CommerceKernel) { this.k = k; }

  #context(scope: Scope, caseId: string, action = 'return.read') {
    const c = new CaseConfigurations(this.k).inspect(scope, id(caseId));
    const s = this.k.authorize(scope, action, c.resource_id);
    return { s, c };
  }
  #assessment(scope: Scope, ref: string) {
    const s = this.k.require(scope), row = this.k.db.prepare(
      'SELECT * FROM commerce_risk_assessments WHERE tenant_id=? AND store_id=? AND id=?'
    ).get(s.tenant_id, s.store_id, id(ref)) as Row;
    const b = body(row), { c } = this.#context(scope, row.case_id);
    if (row.resource_id !== c.resource_id || row.customer_id !== c.customer_id || b.case_id !== c.id) throw new Error('RISK_HISTORY_INTEGRITY');
    return { s, c, row, b };
  }

  assess(scope: Scope, input: unknown) {
    const p = exact(jsonValue(input), ['case_id', 'quote_id', 'model']), k = this.k;
    return k.transaction(() => {
      const { s, c } = this.#context(scope, p.case_id, 'support.reply');
      if (s.role === 'customer') throw new Error('ACCESS_DENIED');
      assertCaseWorkerScope(k, scope, c.id);
      const q = quoteRow(k, scope, id(p.quote_id));
      if (q.case_id !== c.id || q.resource_id !== c.resource_id) throw new Error('RISK_SOURCE_MISMATCH');
      const selected = q.quote.selection, uploads = evidenceRows(k, s, c.id, selected.evidence_ids);
      const lines = sourceReturnLines(c.order), indicators: Row[] = [];
      const source = {
        order: { id: c.resource_id, source_system: c.order.source_system, version: c.order.source_version,
          digest: contentDigest(c.order), evidence_verified: c.order.payload.evidence_verified ?? null },
        quote: { id: q.id, digest: q.digest, source_version: q.quote.source_version, policy_digest: q.quote.policy_digest },
        uploads: uploads.map(u => ({ id: u.id, sha256: u.sha256, state: u.state, scanner: u.scanner, expires_at: u.expires_at })),
        quantities: selected.lines.map((l: Row) => {
          const current = lines.find(x => x.id === l.line_id);
          if (!current) throw new Error('RISK_SOURCE_MISMATCH');
          return { line_id: l.line_id, selected: l.quantity, fulfilled: current.fulfilled, returned: current.returned };
        }),
      };
      const add = (code: keyof typeof REASONS, refs: Row[]) => indicators.push({
        code, reason: REASONS[code], sources: refs,
        uncertainty: 'A source discrepancy is not proof of intent, fraud or a customer trait.',
        suggested_control: 'human_review', authority: 'observation_only',
      });
      for (const u of source.uploads) if (u.state !== 'clean') {
        add('evidence_not_clean', [{ kind: 'upload', id: u.id, sha256: u.sha256, state: u.state, scanner: u.scanner }]);
        if (source.order.evidence_verified === true) add('evidence_state_conflict', [
          { kind: 'order', id: source.order.id, version: source.order.version, digest: source.order.digest, evidence_verified: true },
          { kind: 'upload', id: u.id, sha256: u.sha256, state: u.state, scanner: u.scanner },
        ]);
      }
      if (q.quote.source_digest !== source.order.digest) add('source_snapshot_changed', [
        { kind: 'quote', id: q.id, digest: q.digest, version: q.quote.source_version },
        { kind: 'order', id: source.order.id, digest: source.order.digest, version: source.order.version },
      ]);
      for (const l of source.quantities) if (l.selected > Math.max(0, l.fulfilled - l.returned)) add('quantity_disagreement', [
        { kind: 'order_line', order_id: source.order.id, source_digest: source.order.digest, ...l },
      ]);
      if (c.pins.policy.body.rules.require_evidence && !uploads.length) add('evidence_missing', [
        { kind: 'policy', id: c.pins.policy.policy_id, version: c.pins.policy.version, digest: c.pins.policy.digest },
        { kind: 'quote', id: q.id, digest: q.digest, selected_evidence_count: 0 },
      ]);
      indicators.sort((a, b) => a.code.localeCompare(b.code) || contentDigest(a).localeCompare(contentDigest(b)));
      const sourceDigest = contentDigest(source);
      let model: Row = { status: 'not_used', provider_call_made: false };
      if (p.model !== null) {
        k.authorize(scope, 'model.run', c.resource_id);
        const proposal = jsonValue(p.model, 4096), rawDigest = contentDigest(proposal);
        let accepted = false;
        try {
          const m = exact(proposal, ['provider', 'model', 'revision', 'source_digest', 'indicator_codes']);
          id(m.provider); id(m.model); id(m.revision);
          accepted = m.source_digest === sourceDigest && Array.isArray(m.indicator_codes) && m.indicator_codes.length <= 20
            && new Set(m.indicator_codes).size === m.indicator_codes.length
            && m.indicator_codes.every((code: string) => indicators.some(i => i.code === code));
        } catch { accepted = false; }
        model = accepted ? { status: 'grounded_fixture_proposal', provider: proposal.provider, model: proposal.model,
          revision: proposal.revision, indicator_codes: proposal.indicator_codes, source_digest: sourceDigest,
          input_digest: rawDigest, provider_call_made: false, qualification: 'fixture_proposal_not_connected_model' }
          : { status: 'rejected_untrusted_proposal', input_digest: rawDigest, reason: 'Only existing source indicator codes may be suggested.', provider_call_made: false };
      }
      const value = { case_id: c.id, quote_id: q.id, quote_digest: q.digest, configuration_digest: c.configuration_digest,
        policy: { id: c.pins.policy.policy_id, version: c.pins.policy.version, digest: c.pins.policy.digest,
          rules: c.pins.policy.body.rules, decision_at_quote: q.quote.decision },
        source, source_digest: sourceDigest, indicators, model, policy_rights_changed: false,
        automatic_denial: false, public_allegation: false, execution_authorized: false,
        uncertainty: 'Incomplete synthetic source evidence; no calibrated fraud probability or intent conclusion.',
        appeal_path: 'Authenticated customer may request human review or cite additional case evidence.', created_at: k.clock() };
      const ref = 'risk_' + token().slice(0, 28);
      k.db.prepare('INSERT INTO commerce_risk_assessments VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(s.tenant_id, s.store_id, ref, c.id, c.resource_id, c.customer_id, s.actor_id, canonical(value), contentDigest(value), k.clock());
      return this.read(scope, { case_id: c.id, assessment_id: ref });
    });
  }

  read(scope: Scope, input: unknown) {
    const p = exact(jsonValue(input), ['case_id', 'assessment_id']), { s, c } = this.#context(scope, p.case_id);
    const r = p.assessment_id === null ? this.k.db.prepare(
      'SELECT * FROM commerce_risk_assessments WHERE tenant_id=? AND store_id=? AND case_id=? ORDER BY created_at DESC,id DESC LIMIT 1'
    ).get(s.tenant_id, s.store_id, c.id) as Row : this.#assessment(scope, id(p.assessment_id)).row;
    if (!r) return { case_id: c.id, assessment_id: null, status: 'not_assessed', execution_authorized: false };
    if (r.case_id !== c.id) throw new Error('NOT_FOUND');
    const value = body(r), rows = this.k.db.prepare(
      'SELECT * FROM commerce_risk_reviews WHERE tenant_id=? AND store_id=? AND assessment_id=? ORDER BY created_at,id'
    ).all(s.tenant_id, s.store_id, r.id) as Row[];
    const history = rows.map(row => ({ id: row.id, action: row.kind, at: row.created_at, ...body(row) }));
    if (s.role === 'customer') return { case_id: c.id, assessment_id: r.id,
      status: history.some(h => h.action === 'appeal') ? 'human_review_requested' : 'human_review_available',
      message: 'You may ask a reviewer to check the source records or add evidence. Your published policy rights are unchanged by assistance.',
      evidence_requests: history.filter(h => h.action === 'request_evidence').map(h => ({ reason: h.reason, at: h.at })),
      appeal_reasons: ['source_incorrect', 'additional_evidence', 'request_human'], execution_authorized: false };
    return { case_id: c.id, assessment_id: r.id, digest: r.digest, assessment: value, history,
      current_policy_digest: c.pins.policy.digest, historical_provenance_retained: true, execution_authorized: false };
  }

  review(scope: Scope, input: unknown) {
    const p = exact(jsonValue(input), ['assessment_id', 'assessment_digest', 'action', 'reason', 'expires_at']), k = this.k;
    return k.transaction(() => {
      const { c, row, b } = this.#assessment(scope, p.assessment_id), s = k.authorize(scope, 'return.review', c.resource_id);
      if (s.actor_id === row.author) throw new Error('SELF_REVIEW_DENIED');
      if (p.assessment_digest !== row.digest) throw new Error('RISK_ASSESSMENT_CHANGED');
      let result: Row;
      const review = new ReturnReview(k);
      if (p.action === 'request_evidence') {
        if (p.expires_at !== null) throw new Error('INVALID_INPUT');
        result = review.requestEvidence(scope, { quote_id: b.quote_id, reason: p.reason });
      } else if (p.action === 'window_override') {
        integer(p.expires_at);
        result = review.override(scope, { quote_id: b.quote_id, quote_digest: b.quote_digest, reason: p.reason, expires_at: p.expires_at });
      } else if (p.action === 'dismiss') {
        if (!['source_resolved', 'insufficient_basis', 'customer_explanation'].includes(p.reason) || p.expires_at !== null) throw new Error('INVALID_INPUT');
        result = { status: 'indicator_dismissed', policy_rights_changed: false };
      } else throw new Error('RISK_REVIEW_ACTION_UNSUPPORTED');
      this.#event(s, c, row.id, p.action, { reason: p.reason, assessment_digest: row.digest,
        authority_revision: permissionDecision(k.db, s, 'return.review', c.resource_id).authority_revision,
        result, policy_approval_not_granted_by_model: true });
      return this.read(scope, { case_id: c.id, assessment_id: row.id });
    });
  }

  appeal(scope: Scope, input: unknown) {
    const p = exact(jsonValue(input), ['assessment_id', 'reason', 'evidence_ids']), k = this.k;
    if (!['source_incorrect', 'additional_evidence', 'request_human'].includes(p.reason)
      || !Array.isArray(p.evidence_ids) || p.evidence_ids.length > 8 || new Set(p.evidence_ids).size !== p.evidence_ids.length) throw new Error('INVALID_INPUT');
    return k.transaction(() => {
      const { s, c, row } = this.#assessment(scope, p.assessment_id);
      if (s.role !== 'customer' || s.resource_id !== c.resource_id || s.customer_id !== c.customer_id) throw new Error('CUSTOMER_VERIFICATION_REQUIRED');
      k.authorize(scope, 'return.request', c.resource_id);
      const evidence = evidenceRows(k, s, c.id, p.evidence_ids);
      this.#event(s, c, row.id, 'appeal', { reason: p.reason, evidence: evidence.map(e => ({ id: e.id, sha256: e.sha256, state: e.state })),
        status: 'human_review_requested', customer_confirmed: true });
      return this.read(scope, { case_id: c.id, assessment_id: row.id });
    });
  }
  #event(s: Row, c: Row, assessment: string, kind: string, value: Row) {
    this.k.db.prepare('INSERT INTO commerce_risk_reviews VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(s.tenant_id, s.store_id, 'risk_review_' + token().slice(0, 24), assessment, c.id, c.resource_id,
        s.actor_id, kind, canonical(value), contentDigest(value), this.k.clock());
  }
}
