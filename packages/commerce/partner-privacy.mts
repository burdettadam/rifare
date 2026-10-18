import type { CommerceKernel, Row } from './kernel.mts';
import { canonical, contentDigest } from './configuration-values.mts';
import { subjectHash } from './data-guards.mts';
import { PARTNER_SUBJECT_TABLES } from './partner-service-core.mts';

export const PARTNER_CONFIG_TABLES = Object.freeze(['commerce_partner_configurations', 'commerce_partner_approvals']);
function rows(k: CommerceKernel, table: string, tenant: string, store: string): Row[] {
  return k.db.prepare(`SELECT * FROM ${table} WHERE tenant_id=? AND store_id=?`).all(tenant, store) as Row[];
}
function checked(row: Row) {const body = JSON.parse(row.body); if (contentDigest(body) !== row.digest) throw new Error('PARTNER_RECORD_INTEGRITY'); return body;}
function matches(row: Row, ids: Set<string>, tenant: string, store: string, hash: string, customer?: string) {
  const b = checked(row), candidates = [row.customer_id, b.customer_id, b.preview?.customer_id];
  return ids.has(row.resource_id) || row.subject_hash === hash || b.subject_hash === hash || candidates.some(value => typeof value === 'string' &&
    (value === customer || value === 'erased_' + hash.slice(0,32) || value === 'erased_' + hash.slice(0,40) || subjectHash(tenant, store, value) === hash));
}
function contextOf(body: Row) {return body.context ?? body.preview?.context ?? body.command?.context ?? null;}
function withoutAuthority(value: any): any {
  if (Array.isArray(value)) return value.map(withoutAuthority);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !['token_hash', 'session_hash', 'verification_hash', 'issuer_session_hash', 'confirming_session_hash'].includes(key))
    .map(([key, member]) => [key, withoutAuthority(member)]));
}
function projection(row: Row, kind = 'subject') {
  const body = withoutAuthority(checked(row));
  if (kind === 'configuration') body.enabled = false;
  return {...row, ...(kind === 'configuration' ? {enabled: 0} : kind === 'approval' ? {state: 'revoked'} : {}),
    body: canonical(body), digest: contentDigest(body), source_record_digest: row.digest, projection: 'subject_export_without_authority'};
}

/** Canonical PrivacyLifecycle owns authorization and the enclosing transaction. */
export function exportPartnerSubject(k: CommerceKernel, tenant: string, store: string, resourceIds: readonly string[], customer: string, hash: string) {
  const ids = new Set(resourceIds), result: Record<string, Row[]> = Object.fromEntries([...PARTNER_CONFIG_TABLES, ...PARTNER_SUBJECT_TABLES].map(name => [name, []]));
  const contexts = new Set<string>();
  for (const table of PARTNER_SUBJECT_TABLES) {
    const selected = rows(k, table, tenant, store).filter(row => matches(row, ids, tenant, store, hash, customer));
    for (const row of selected) {const context = contextOf(checked(row)); if (context) contexts.add(JSON.stringify([context.service, context.account_id]));}
    result[table] = selected.map(row => projection(row));
  }
  for (const table of PARTNER_CONFIG_TABLES) result[table] = rows(k, table, tenant, store).filter(row => contexts.has(JSON.stringify([row.service, row.account_id])))
    .map(row => projection(row, table === 'commerce_partner_configurations' ? 'configuration' : 'approval'));
  return result;
}
function minimized(table: string, row: Row, b: Row, hash: string) {
  const context = contextOf(b), event = b.event ?? null;
  const common = {redacted: true, subject_hash: hash, original_record_id: row.id, original_record_digest: b.original_record_digest ?? row.digest,
    source_identity: b.source_identity ?? context?.source_identity ?? event?.source_identity ?? null,
    original_context_digest: b.original_context_digest ?? (context ? contentDigest(context) : null),
    original_operation_id: b.original_operation_id ?? b.command?.operation_id ?? null,
    original_native_id: b.original_native_id ?? b.result?.native_id ?? null, replay_allowed: false};
  if (table === 'commerce_protection_proposals') return {...common, original_proposal_id: row.id, preview_digest: b.preview_digest ?? null};
  if (table === 'commerce_protection_confirmations') return {...common, original_proposal_id: b.original_proposal_id ?? b.proposal_id ?? row.id, authority_revoked: true};
  if (table === 'commerce_protection_operations') return common;
  if (table === 'commerce_duty_assessments') return {...common, original_estimate_id: b.original_estimate_id ?? b.estimate?.event_id ?? null,
    original_assessment_id: b.original_assessment_id ?? b.assessment?.event_id ?? null, variance_approval_revoked: true};
  if (table === 'commerce_reverse_hub_routes') return {...common, original_request_id: b.original_request_id ?? b.request_id ?? null,
    warehouse_source_identity: b.warehouse_source_identity ?? null, routing_revoked: true};
  if (table === 'commerce_international_handoffs') return {...common, original_journey_id: b.original_journey_id ?? b.journey_id ?? row.id,
    original_event_id: b.original_event_id ?? event?.event_id ?? null, original_custody_ref: b.original_custody_ref ?? event?.custody_ref ?? null,
    original_fee_ref: b.original_fee_ref ?? event?.fee_ref ?? null};
  if (table === 'commerce_hsa_fsa_eligibility') return {...common, original_eligibility_id: b.original_eligibility_id ?? b.preview?.eligibility_id ?? null,
    original_payment_reference: b.original_payment_reference ?? b.command?.payment_reference ?? null, confirmation_revoked: true};
  if (table === 'commerce_network_alerts') return {...common, original_alert_id: row.id, original_event_id: b.original_event_id ?? event?.event_id ?? null,
    original_fee_ref: b.original_fee_ref ?? event?.fee_ref ?? null};
  return {...common, original_alert_id: b.original_alert_id ?? b.alert_id ?? null, approval_revoked: true};
}
export function erasePartnerSubject(k: CommerceKernel, tenant: string, store: string, resourceIds: readonly string[], hash: string) {
  const ids = new Set(resourceIds); let count = 0;
  for (const table of PARTNER_SUBJECT_TABLES) for (const row of rows(k, table, tenant, store).filter(row => matches(row, ids, tenant, store, hash))) {
    const body = minimized(table, row, checked(row), hash), state = row.state === 'unknown' ? 'unknown' : 'erased';
    k.db.prepare(`UPDATE ${table} SET subject_hash=?,state=?,body=?,digest=? WHERE tenant_id=? AND store_id=? AND id=?`)
      .run(hash, state, canonical(body), contentDigest(body), tenant, store, row.id); count++;
  }
  return {minimized: count, original_unknown_outcomes_preserved: true, source_effects_dispatched: 0, physical_deletion: false};
}
export function revokePartnerForRestore(k: CommerceKernel, tenant?: string, store?: string) {
  const where = tenant === undefined ? '' : store === undefined ? ' WHERE tenant_id=?' : ' WHERE tenant_id=? AND store_id=?', args = tenant === undefined ? [] : store === undefined ? [tenant] : [tenant, store];
  k.db.prepare('UPDATE commerce_partner_configurations SET enabled=0' + where).run(...args);
  k.db.prepare("UPDATE commerce_partner_approvals SET state='revoked'" + where).run(...args);
  for (const table of PARTNER_SUBJECT_TABLES) {
    const all = k.db.prepare('SELECT * FROM ' + table + where).all(...args) as Row[];
    for (const row of all) {
      const original = checked(row); if (original.redacted) continue;
      let body = withoutAuthority(original), state = row.state;
      if (table === 'commerce_protection_confirmations') {body = {proposal_id: body.proposal_id, preview_digest: body.preview_digest, authority_revoked: true}; state = 'revoked_restore';}
      if (table === 'commerce_protection_proposals') body.review = null;
      if (table === 'commerce_hsa_fsa_eligibility') {body.confirmation = null; if (['proposed', 'blocked'].includes(state)) state = 'revoked_restore';}
      if (table === 'commerce_network_alert_actions') {body.approval = null; if (['proposed', 'approved', 'blocked'].includes(state)) state = 'revoked_restore';}
      if (table === 'commerce_reverse_hub_routes' || table === 'commerce_international_handoffs' && body.kind === 'plan') state = 'revoked_restore';
      if (table === 'commerce_duty_assessments' && body.variance?.approval) body.variance = {...body.variance, approval: null, state: 'review_required'};
      k.db.prepare(`UPDATE ${table} SET state=?,body=?,digest=? WHERE tenant_id=? AND store_id=? AND id=?`)
        .run(state, canonical(body), contentDigest(body), row.tenant_id, row.store_id, row.id);
    }
  }
  return {readiness_revoked: true, approvals_revoked: true, confirmations_revoked: true, original_unknown_outcomes_preserved: true, source_effects_dispatched: 0};
}
