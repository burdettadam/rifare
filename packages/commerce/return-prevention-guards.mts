import type { CommerceKernel, Row } from './kernel.mts';
import { contentDigest } from './configuration-values.mts';

export function preventionBody(row: Row | undefined) {
  if (!row) throw new Error('NOT_FOUND');
  const value = JSON.parse(row.body);
  if (contentDigest(value) !== row.digest) throw new Error('PREVENTION_INTEGRITY');
  return value;
}
export function preventionEnrolled(k: CommerceKernel, s: Row, resource: string) {
  const rows = k.db.prepare('SELECT * FROM commerce_prevention_exposures WHERE tenant_id=? AND store_id=? AND resource_id=?')
    .all(s.tenant_id, s.store_id, resource) as Row[];
  return rows.some(row => preventionBody(row).offer !== null);
}
/** An opt-in resource cannot escape confirmation by creating a fresh unlabelled edit quote. */
export function assertPreventionConfirmation(k: CommerceKernel, s: Row, quoteId: string, q: Row, afterCommit = false) {
  if (q.action === 'address' || !preventionEnrolled(k, s, q.resource_id)) return;
  const p = k.db.prepare('SELECT * FROM commerce_prevention_previews WHERE tenant_id=? AND store_id=? AND quote_id=?')
    .get(s.tenant_id, s.store_id, quoteId) as Row;
  const r = k.db.prepare('SELECT * FROM commerce_prevention_confirmations WHERE tenant_id=? AND store_id=? AND quote_id=?')
    .get(s.tenant_id, s.store_id, quoteId) as Row;
  if (!p || !r) throw new Error('PREVENTION_CUSTOMER_CONFIRMATION_REQUIRED');
  const preview = preventionBody(p), c = preventionBody(r);
  if (p.resource_id !== q.resource_id || p.case_id !== q.case_id || p.customer_id !== q.customer_id
    || r.resource_id !== q.resource_id || r.case_id !== q.case_id || r.customer_id !== q.customer_id
    || preview.quote_digest !== contentDigest(q) || c.quote_digest !== contentDigest(q)
    || c.preview_digest !== p.digest || c.intent_digest !== q.intent_digest
    || c.configuration_digest !== q.configuration_digest || c.source_identity !== q.source_identity
    || c.source_order_digest !== q.source_order_digest || c.source_order_version !== q.source_order_version
    || c.settings_digest !== q.settings_digest || c.currency !== q.currency || c.new_total_minor !== q.new_total_minor
    || c.delta_minor !== q.delta_minor || c.customer_id !== q.customer_id) throw new Error('PREVENTION_CONFIRMATION_CHANGED');
  if (afterCommit) return;
  const customer = k.db.prepare("SELECT * FROM commerce_sessions WHERE token_hash=? AND role='customer' AND revoked=0")
    .get(r.session_hash) as Row;
  if (r.revoked || c.expires_at <= k.clock() || !customer || customer.expires_at <= k.clock()
    || customer.last_seen <= k.clock() - 900000 || customer.tenant_id !== s.tenant_id || customer.store_id !== s.store_id
    || customer.customer_id !== q.customer_id || customer.resource_id !== q.resource_id) throw new Error('PREVENTION_CONFIRMATION_UNAVAILABLE');
}
