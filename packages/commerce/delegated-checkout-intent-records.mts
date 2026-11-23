import { exact, id, integer } from './kernel.mts';
import type { CommerceKernel, Row } from './kernel.mts';
import { canonical, contentDigest, jsonValue } from './configuration-values.mts';
import { checkoutSnapshot } from './checkout-preview.mts';
import { subjectHash } from './data-guards.mts';
import type { BoundDelegatedReceipt } from './delegated-receipt-binding.mts';
import { receiptTimestampNs } from './delegated-receipt-binding.mts';

export const INTENT_KIND = 'delegated_checkout_intent', INTENT_MAX_ROWS = 10000;
export type IntentRevocation = 'cancelled'|'subject_erased'|'uninstall'|'restored';
export type IntentPersonal = Readonly<{
  customer_id: string; preview_id: string; preview_digest: string;
  context_id: string; context_digest: string; context_revision: number;
  grant_id: string; grant_revision: number; challenge: string;
  currency: string; total_payable_minor: string;
  receipt: BoundDelegatedReceipt|null; verified_at: number|null;
}>;
export type IntentBody = Readonly<{
  schema_version: 1; id: string; tenant_id: string; store_id: string; resource_id: string;
  subject_ref: string; identity_digest: string; binding_digest: string; authority_namespace: string;
  challenge_fingerprint: string; receipt_fingerprint: string|null; token_digest: string|null;
  receipt_expires_at: number|null; created_at: number; expires_at: number; revision: number;
  state: 'prepared'|'evidence_verified'|'cancelled'; authority_revoked: boolean;
  revocation_reason: IntentRevocation|null; minimized: boolean; expired: boolean; personal: IntentPersonal|null;
}>;
export type IntentRecord = Readonly<{ row: Row; body: IntentBody }>;
const HEX = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ROW_KEYS = ['tenant_id','store_id','kind','id','version','body','digest','author','state',
  'reviewer','review_digest','created_at','expires_at'];
const BODY_KEYS = ['schema_version','id','tenant_id','store_id','resource_id','subject_ref',
  'identity_digest','binding_digest','authority_namespace','challenge_fingerprint','receipt_fingerprint',
  'token_digest','receipt_expires_at','created_at','expires_at','revision','state','authority_revoked',
  'revocation_reason','minimized','expired','personal'];
const PERSONAL_KEYS = ['customer_id','preview_id','preview_digest','context_id','context_digest',
  'context_revision','grant_id','grant_revision','challenge','currency','total_payable_minor','receipt','verified_at'];
const RECEIPT_KEYS = ['receipt_id','grant_id','grant_revision','challenge','operation_digest',
  'checkout_preview_digest','issuer_key_id','policy_version_digest','issued_at','expires_at',
  'execution_authorized','qualification'];
const REASONS: readonly unknown[] = ['cancelled','subject_erased','uninstall','restored'];
function requireTrue(value: unknown): asserts value { if (!value) throw new Error('INTENT_INTEGRITY'); }
function hash(value: unknown): asserts value is string { requireTrue(typeof value === 'string' && HEX.test(value)); }
function text(value: unknown, max = 512): asserts value is string {
  requireTrue(typeof value === 'string' && value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value));
}
/** First integer millisecond at/after exact expiry: never floor a valid nanosecond receipt. */
export function receiptExpiryBoundary(value: string): number {
  const ns = receiptTimestampNs(value); requireTrue(ns >= 0n);
  return integer(Number((ns + 999999n) / 1000000n));
}
export function intentIdentity(tenant: string, store: string, preview: string, context: string): string {
  return contentDigest(['rifare-delegated-intent-v1',tenant,store,preview,context]);
}
export const intentId = (identity: string): string => 'delegated_intent_' + identity.slice(0,40);
export const challengeFingerprint = (namespace: string, challenge: string): string =>
  contentDigest(['rifare-delegated-challenge-v1',namespace,challenge]);
export const receiptFingerprint = (namespace: string, receipt: string): string =>
  contentDigest(['rifare-delegated-receipt-v1',namespace,receipt]);
export function intentBindingDigest(b: Omit<IntentBody,'binding_digest'>|IntentBody): string {
  if (!b.personal) throw new Error('INTENT_MINIMIZED');
  const { receipt: _receipt, verified_at: _at, ...original } = b.personal;
  return contentDigest({ tenant_id: b.tenant_id, store_id: b.store_id, resource_id: b.resource_id,
    subject_ref: b.subject_ref, identity_digest: b.identity_digest, authority_namespace: b.authority_namespace,
    challenge_fingerprint: b.challenge_fingerprint, created_at: b.created_at, expires_at: b.expires_at, original });
}

/** Strict historical parsing never dereferences live resources or restores authority. */
export function validateIntentRows(k: CommerceKernel, rows: Row[], allowRevokedRow = false): IntentRecord[] {
  if (rows.length > INTENT_MAX_ROWS) throw new Error('INTENT_ROW_LIMIT');
  try {
    const now = integer(k.clock()), identities = new Set<string>(), challenges = new Set<string>(), receipts = new Set<string>();
    return rows.map(row => {
      exact(row, ROW_KEYS); id(row.tenant_id); id(row.store_id); id(row.id);
      requireTrue(row.kind === INTENT_KIND && row.version === 1 && row.author === 'delegated_checkout_intents' &&
        row.reviewer === null && row.review_digest === null && typeof row.body === 'string' &&
        Buffer.byteLength(row.body) <= 16384); hash(row.digest);
      const b = jsonValue(JSON.parse(row.body), 16384) as IntentBody; exact(b, BODY_KEYS);
      requireTrue(canonical(b) === row.body && contentDigest(b) === row.digest);
      for (const value of [b.id,b.tenant_id,b.store_id,b.resource_id]) id(value);
      for (const value of [b.subject_ref,b.identity_digest,b.binding_digest,b.authority_namespace,b.challenge_fingerprint]) hash(value);
      integer(b.created_at); integer(b.expires_at); integer(b.revision,1);
      requireTrue(b.schema_version === 1 && b.id === row.id && b.id === intentId(b.identity_digest) &&
        b.tenant_id === row.tenant_id && b.store_id === row.store_id && b.created_at === row.created_at &&
        b.expires_at === row.expires_at && b.created_at <= now && b.expires_at > b.created_at &&
        b.expires_at - b.created_at <= 600000 && ['prepared','evidence_verified','cancelled'].includes(b.state) &&
        typeof b.authority_revoked === 'boolean' && typeof b.minimized === 'boolean' && typeof b.expired === 'boolean' &&
        b.authority_revoked === (b.revocation_reason !== null) &&
        (b.revocation_reason === null || REASONS.includes(b.revocation_reason)) &&
        (b.state !== 'cancelled' || b.authority_revoked) &&
        (b.revocation_reason !== 'cancelled' || b.state === 'cancelled') &&
        b.minimized === (b.personal === null) && (!b.minimized || b.authority_revoked) &&
        (row.state === (b.authority_revoked ? 'revoked' : 'active') || allowRevokedRow && row.state === 'revoked'));
      const observed = b.receipt_fingerprint !== null;
      requireTrue(observed === (b.token_digest !== null) && observed === (b.receipt_expires_at !== null) &&
        (b.state !== 'evidence_verified' || observed) && (b.state !== 'prepared' || !observed));
      if (observed) { hash(b.receipt_fingerprint); hash(b.token_digest); integer(b.receipt_expires_at);
        requireTrue(b.receipt_expires_at! > b.created_at); }
      if (b.personal) {
        const p = b.personal; exact(p, PERSONAL_KEYS);
        for (const value of [p.customer_id,p.preview_id,p.context_id]) id(value);
        hash(p.preview_digest); hash(p.context_digest); integer(p.context_revision,1); integer(p.grant_revision,1);
        requireTrue(UUID.test(p.grant_id) && typeof p.challenge === 'string' && p.challenge.length >= 22 &&
          p.challenge.length <= 128 && /^[\x21-\x7e]+$/.test(p.challenge) && /^[A-Z]{3}$/.test(p.currency) &&
          typeof p.total_payable_minor === 'string' && /^(0|[1-9][0-9]{0,17})$/.test(p.total_payable_minor) &&
          subjectHash(b.tenant_id,b.store_id,p.customer_id) === b.subject_ref &&
          intentIdentity(b.tenant_id,b.store_id,p.preview_id,p.context_id) === b.identity_digest &&
          challengeFingerprint(b.authority_namespace,p.challenge) === b.challenge_fingerprint &&
          intentBindingDigest(b) === b.binding_digest && observed === (p.receipt !== null) && observed === (p.verified_at !== null));
        if (p.receipt) {
          const r = p.receipt; exact(r, RECEIPT_KEYS); integer(p.verified_at);
          const issued = receiptTimestampNs(r.issued_at), expires = receiptTimestampNs(r.expires_at);
          requireTrue(p.verified_at! >= b.created_at && p.verified_at! < b.expires_at && p.verified_at! <= now &&
            UUID.test(r.receipt_id) && r.grant_id === p.grant_id && r.grant_revision === p.grant_revision &&
            r.challenge === p.challenge && r.checkout_preview_digest === p.preview_digest &&
            r.operation_digest === 'sha256:' + p.preview_digest && /^sha256:[a-f0-9]{64}$/.test(r.policy_version_digest) &&
            r.execution_authorized === false && r.qualification === 'candidate_contract_only' &&
            receiptFingerprint(b.authority_namespace,r.receipt_id) === b.receipt_fingerprint &&
            receiptExpiryBoundary(r.expires_at) === b.receipt_expires_at && issued <= BigInt(p.verified_at!) * 1000000n &&
            expires > issued && expires - issued <= 600000000000n &&
            p.verified_at! < b.receipt_expires_at!); text(r.issuer_key_id);
        }
      }
      const prefix = canonical([b.tenant_id,b.store_id]);
      for (const [set, value] of [[identities,b.identity_digest],[challenges,b.challenge_fingerprint],
        ...(observed ? [[receipts,b.receipt_fingerprint]] : [])] as [Set<string>,string][]) {
        const key = prefix + value; requireTrue(!set.has(key)); set.add(key);
      }
      return { row: { ...row }, body: checkoutSnapshot(b) };
    });
  } catch { throw new Error('INTENT_INTEGRITY'); }
}
export function intentRecords(k: CommerceKernel, scope?: { tenant_id: string; store_id: string }, allowRevokedRow = false): IntentRecord[] {
  const rows = k.db.prepare(`SELECT * FROM commerce_support_documents WHERE kind=? ${scope ? 'AND tenant_id=? AND store_id=?' : ''}
    ORDER BY tenant_id,store_id,id,version LIMIT ?`).all(INTENT_KIND,
    ...(scope ? [id(scope.tenant_id),id(scope.store_id)] : []), INTENT_MAX_ROWS + 1) as Row[];
  return validateIntentRows(k, rows, allowRevokedRow);
}
function rowFor(b: IntentBody): Row {
  return { tenant_id: b.tenant_id, store_id: b.store_id, kind: INTENT_KIND, id: b.id, version: 1,
    body: canonical(b), digest: contentDigest(b), author: 'delegated_checkout_intents',
    state: b.authority_revoked ? 'revoked' : 'active', reviewer: null, review_digest: null,
    created_at: b.created_at, expires_at: b.expires_at };
}
export function insertIntent(k: CommerceKernel, body: IntentBody): IntentRecord {
  const record = validateIntentRows(k,[rowFor(body)])[0], r = record.row;
  k.db.prepare('INSERT INTO commerce_support_documents VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...ROW_KEYS.map(key => r[key]));
  return record;
}
export function updateIntent(k: CommerceKernel, previous: IntentRecord, body: IntentBody): IntentRecord {
  const before = previous.body;
  for (const key of ['id','tenant_id','store_id','resource_id','subject_ref','identity_digest','binding_digest',
    'authority_namespace','challenge_fingerprint','created_at','expires_at'] as const)
    if (body[key] !== before[key]) throw new Error('INTENT_BINDING_CONFLICT');
  if (body.revision !== before.revision + 1 || before.authority_revoked && !body.authority_revoked ||
    before.minimized && !body.minimized || before.expired && !body.expired ||
    before.receipt_fingerprint && body.receipt_fingerprint !== before.receipt_fingerprint ||
    before.token_digest && body.token_digest !== before.token_digest || before.state === 'cancelled' && body.state !== 'cancelled')
    throw new Error('INTENT_REVISION_CONFLICT');
  const record = validateIntentRows(k,[rowFor(body)])[0], r = record.row;
  const result = k.db.prepare(`UPDATE commerce_support_documents SET body=?,digest=?,state=?
    WHERE tenant_id=? AND store_id=? AND kind=? AND id=? AND version=1 AND digest=?`).run(r.body,r.digest,r.state,
    r.tenant_id,r.store_id,INTENT_KIND,r.id,previous.row.digest);
  if (result.changes !== 1) throw new Error('INTENT_REVISION_CONFLICT');
  return record;
}
export function intentHeld(k: CommerceKernel, body: IntentBody): boolean {
  return !!k.db.prepare(`SELECT 1 FROM commerce_privacy_holds WHERE tenant_id=? AND store_id=?
    AND subject_hash=? AND released=0 AND expires_at>?`).get(body.tenant_id,body.store_id,body.subject_ref,k.clock());
}
export function retireIntent(k: CommerceKernel, record: IntentRecord, reason: IntentRevocation, minimize: boolean): IntentRecord {
  const b = record.body;
  if (!REASONS.includes(reason)) throw new Error('INTENT_INPUT_INVALID');
  // Never resurrect minimized data or release retained duplicate-refusal identities.
  if (b.authority_revoked && (!minimize || b.minimized) && record.row.state === 'revoked') return record;
  return updateIntent(k,record,{ ...b, revision: b.revision + 1, authority_revoked: true,
    state: reason === 'cancelled' ? 'cancelled' : b.state,
    revocation_reason: b.minimized ? b.revocation_reason : reason,
    minimized: b.minimized || minimize, personal: minimize ? null : b.personal });
}
