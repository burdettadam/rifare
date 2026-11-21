/**
 * Native RCG-3 local evidence: bind a cryptographically verified ElevenID / Marty
 * Delegated Decision Receipt v1 to one frozen Rifare checkout preview.
 *
 * This is a consuming-domain claim check, NOT a JOSE implementation, wallet
 * verifier, public Gateway HTTP client, grant-status source or payment permit.
 * The deployment must inject an independently trusted JOSE verifier using a
 * maintained library, with pinned issuer/key-purpose/algorithm and trusted
 * key discovery. Do not accept an agent-provided verifier or 'verified' flag.
 *
 * Draft profile reconciled with ElevenID/marty-protocol a9ce6a1,
 * DECISION-EVIDENCE.md and the merged signature vectors. Runtime Gateway
 * publication and final-use semantics remain outside this local evidence slice.
 */
import {withinDelegatedCeiling, checkoutSnapshot, type FrozenCheckoutPreview} from './checkout-preview.mts';

export const RECEIPT_PROFILE = 'urn:marty:delegated-decision-receipt:v1';
export const EVALUATION_PROFILE = 'urn:marty:delegated-evaluation:v1';
export const JWS_TYP = 'mip-delegated-decision+jws';
export const JWS_PURPOSE = 'urn:marty:delegated-decision:jws-v1';

export type PrincipalType = 'USER' | 'ORGANIZATION' | 'SERVICE_ACCOUNT' | 'MACHINE_IDENTITY' | 'EXTERNAL';
export type Principal = Readonly<{ type: PrincipalType; id: string }>;
export type GrantRef = Readonly<{ id: string; revision: number; terms_digest: string }>;
export type KeyBinding = Readonly<{ method: 'KEY'; key_thumbprint: string }>;
export type SessionBinding = Readonly<{ method: 'SESSION'; session_ref: string; establishment_evidence_ref: string }>;
export type DelegateBinding = KeyBinding | SessionBinding;
export type Operation = Readonly<{
  action: string; resource_id: string; audience: string;
  request_profile: string; request_digest: string;
}>;
export type Policy = Readonly<{ id: string; version_digest: string }>;
export type SignedKey = Readonly<{
  issuer: Principal; purpose: string; key_id: string; algorithm: 'ES256' | 'EdDSA';
}>;
export type ProtectedHeader = Readonly<{ typ: string; alg: string; kid: string }>;

/** Output of a fully verified JWS and trusted key resolver, never from HTTP JSON. */
export type CryptographicallyVerifiedReceipt = Readonly<{
  protected_header: ProtectedHeader;
  trusted_key: SignedKey;
  payload: unknown;
}>;

export type ReceiptTrustPolicy = Readonly<{
  issuer: Principal;
  organization_id: string;
  allowed_algorithms: readonly ('ES256' | 'EdDSA')[];
  trusted_key_ids: readonly string[];
}>;

/**
 * MUST verify the compact JWS signature over its original protected header and
 * payload using trusted, pinned issuer keys. Reject non-allowed algorithms,
 * untrusted 'jku', 'x5u', 'jwk', 'crit' and key confusion. The returned payload
 * MUST be decoded from the bytes whose signature was verified.
 * Reject duplicate JSON keys before object construction. This binder cannot
 * recover duplicate fields after a decoder has discarded them.
 * Honor cancellation where possible; this read-only port must have no effects.
 * Never implement this port as decode-only or as a caller-provided flag.
 */
export interface TrustedReceiptJoseVerifier {
  /** Optional for pure test ports; the native service requires a retirement fence. */
  assertCurrent?(): void;
  verify(compactJws: string, trust: ReceiptTrustPolicy, signal?: AbortSignal):
    Promise<CryptographicallyVerifiedReceipt>;
}

/** The server must choose one complete constraint mode before verification. */
export type DomainEvidenceExpectation =
  | Readonly<{require_domain_evidence: false; domain_evaluator?: never;
      domain_profile?: never; domain_document_digest?: never}>
  | Readonly<{require_domain_evidence: true; domain_evaluator: Principal;
      domain_profile: string; domain_document_digest: string}>;

/** Expected values originate from authenticated Rifare server owners. */
export type ExpectedReceiptBinding = Readonly<{
  preview: FrozenCheckoutPreview;
  /** Server-resolved spending ceiling, independent of the provider's Cedar decision. */
  delegated_ceiling: Readonly<{currency: string;maximum_minor: string}>;
  tenant_id: string;
  store_id: string;
  merchant_id: string;
  customer_id: string;
  issuer: Principal;
  organization_id: string;
  actor: Principal;
  subject: Principal;
  status_issuer: Principal;
  binding: DelegateBinding;
  grant: GrantRef;
  operation: Omit<Operation, 'request_digest'>;
  policy: Policy;
  challenge: string;
}> & DomainEvidenceExpectation;

export type BoundDelegatedReceipt = Readonly<{
  receipt_id: string;
  grant_id: string;
  grant_revision: number;
  challenge: string;
  operation_digest: string;
  checkout_preview_digest: string;
  issuer_key_id: string;
  policy_version_digest: string;
  issued_at: string;
  expires_at: string;
  /** This is signed evidence only. NOT a merchant execution permit. */
  execution_authorized: false;
  qualification: 'candidate_contract_only';
}>;

export class ReceiptBindingDenied extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; this.name = 'ReceiptBindingDenied'; }
}
function deny(code: string): never { throw new ReceiptBindingDenied(code); }
function insist(value: unknown, code: string): asserts value { if (!value) deny(code); }
const SHA = /^sha256:[a-f0-9]{64}$/;
const HEX = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ID = /^[A-Za-z0-9_-]{1,96}$/;
const COMPACT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const ISO = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/;
const NS_PER_MS = 1_000_000n;
const PRINCIPAL_TYPES: readonly string[] = ['USER','ORGANIZATION','SERVICE_ACCOUNT','MACHINE_IDENTITY','EXTERNAL'];
/**
 * Capture bounded, plain data without invoking getters/toJSON. Readonly types
 * do not prevent aliases from changing while a verifier yields. No caller
 * object is retained or frozen. The trusted adapters still own origin checks.
 */
function snapshot<T>(input: T, code: string): T {
  try {
    // Reuse the reviewed native descriptor/canonical-JSON snapshot owner.
    const result = checkoutSnapshot(input);
    let nodes = 0;
    const count = (value: unknown): void => {
      insist(++nodes <= 8192, code);
      if (value && typeof value === 'object') for (const child of Object.values(value)) count(child);
    };
    count(result);
    return result as T;
  } catch (error) {
    if (error instanceof ReceiptBindingDenied) throw error;
    deny(code);
  }
}
function object(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  insist(value && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null),
  'RECEIPT_FIELDS_INVALID');
  const valueObject = value as Record<string, unknown>;
  const keys = Object.keys(valueObject);
  insist(required.every(k => Object.hasOwn(valueObject,k)) &&
    keys.every(k => required.includes(k) || optional.includes(k)), 'RECEIPT_FIELDS_INVALID');
  return valueObject;
}
function nonempty(value: unknown): string {
  insist(typeof value === 'string' && value.length > 0 && value.length <= 1024,
    'RECEIPT_FIELDS_INVALID');
  return value as string;
}
function principal(value: unknown): Principal {
  const r = object(value,['type','id']);
  insist(PRINCIPAL_TYPES.includes(r.type as string), 'RECEIPT_PRINCIPAL_INVALID');
  nonempty(r.id);
  return r as Principal;
}
function grant(value: unknown): GrantRef {
  const r = object(value,['id','revision','terms_digest']);
  insist(typeof r.id === 'string' && UUID.test(r.id) &&
    Number.isSafeInteger(r.revision) && (r.revision as number) >= 1 &&
    typeof r.terms_digest === 'string' && SHA.test(r.terms_digest), 'RECEIPT_GRANT_INVALID');
  return r as GrantRef;
}
function operation(value: unknown): Operation {
  const r = object(value,['action','resource_id','audience','request_profile','request_digest']);
  for (const k of ['action','resource_id','audience','request_profile']) nonempty(r[k]);
  insist(typeof r.request_digest === 'string' && SHA.test(r.request_digest),
    'RECEIPT_OPERATION_INVALID');
  return r as Operation;
}
function matchPrincipal(a: unknown, b: Principal, code: string): void {
  const p = principal(a);
  insist(p.type === b.type && p.id === b.id, code);
}
function matchGrant(a: unknown, b: GrantRef, code: string): void {
  const g = grant(a);
  insist(g.id === b.id && g.revision === b.revision &&
    g.terms_digest === b.terms_digest, code);
}
function matchOperation(a: unknown, b: Operation, code: string): void {
  const op = operation(a);
  for (const k of ['action','resource_id','audience','request_profile','request_digest'] as const)
    insist(op[k] === b[k], code);
}
function binding(value: unknown): DelegateBinding {
  const v = object(value,['method'],['key_thumbprint','session_ref','establishment_evidence_ref']);
  if (v.method === 'KEY') {
    insist(Object.keys(v).length === 2 && typeof v.key_thumbprint === 'string' &&
      SHA.test(v.key_thumbprint), 'RECEIPT_BINDING_INVALID');
  } else if (v.method === 'SESSION') {
    insist(Object.keys(v).length === 3 &&
      nonempty(v.session_ref) && nonempty(v.establishment_evidence_ref), 'RECEIPT_BINDING_INVALID');
  } else deny('RECEIPT_BINDING_INVALID');
  return v as DelegateBinding;
}
function sameBinding(a: unknown, b: DelegateBinding): void {
  const x=binding(a), y=binding(b);
  insist(x.method===y.method, 'RECEIPT_BINDING_MISMATCH');
  if (x.method==='KEY' && y.method==='KEY') insist(x.key_thumbprint === y.key_thumbprint,'RECEIPT_BINDING_MISMATCH');
  if (x.method==='SESSION' && y.method==='SESSION') insist(x.session_ref === y.session_ref &&
    x.establishment_evidence_ref === y.establishment_evidence_ref,'RECEIPT_BINDING_MISMATCH');
}
function timestamp(value: unknown): bigint {
  insist(typeof value === 'string', 'RECEIPT_TIME_INVALID');
  const match = ISO.exec(value);
  insist(match, 'RECEIPT_TIME_INVALID');
  // Parse whole seconds only, then validate the calendar instead of accepting
  // Date.parse normalization (for example February 30). Keep all nine digits.
  const ms = Date.parse(match[1] + 'Z');
  insist(Number.isFinite(ms) && new Date(ms).getUTCFullYear() >= 1 &&
    new Date(ms).toISOString().slice(0, 19) === match[1], 'RECEIPT_TIME_INVALID');
  return BigInt(ms) * NS_PER_MS + BigInt((match[2] ?? '').padEnd(9, '0'));
}
/** Exact historical receipt parsing shares the verifier's existing calendar/nanosecond rules. */
export { timestamp as receiptTimestampNs };
function evidenceRef(value: unknown): void { nonempty(value); }
function positiveDigest(value: unknown, code: string): void {
  insist(typeof value === 'string' && SHA.test(value),code);
}
function compareSnapshot(
  preview: FrozenCheckoutPreview, expected: ExpectedReceiptBinding,
  contentDigest: (value: unknown) => string, now: number,
): string {
  insist(preview.schema_version===1 && preview.qualification==='synthetic_only' &&
    preview.tenant_id===expected.tenant_id && preview.store_id===expected.store_id &&
    preview.merchant_id===expected.merchant_id && preview.customer_id===expected.customer_id,
  'RECEIPT_CHECKOUT_SCOPE_MISMATCH');
  insist(typeof preview.preview_digest === 'string' && HEX.test(preview.preview_digest) &&
    Number.isSafeInteger(preview.created_at) && Number.isSafeInteger(preview.expires_at) &&
    preview.created_at >= 0 && preview.expires_at > preview.created_at &&
    preview.expires_at - preview.created_at <= 600_000 &&
    now >= preview.created_at && now < preview.expires_at, 'RECEIPT_CHECKOUT_EXPIRED');
  const {preview_digest: _ignored,...body} = preview;
  insist(contentDigest(body)===preview.preview_digest,'RECEIPT_CHECKOUT_CHANGED');
  let withinCeiling=false;
  try { withinCeiling=withinDelegatedCeiling(preview,expected.delegated_ceiling.currency,
    expected.delegated_ceiling.maximum_minor); }
  catch { deny('RECEIPT_LOCAL_LIMIT_INVALID'); }
  insist(withinCeiling,'RECEIPT_LOCAL_LIMIT_EXCEEDED');
  return `sha256:${preview.preview_digest}`;
}

export type ReceiptBindingDependencies = Readonly<{
  jose: TrustedReceiptJoseVerifier;
  trust: ReceiptTrustPolicy;
  /** Provide Rifare's existing contentDigest, not another canonicalizer. */
  contentDigest(value: unknown): string;
  now(): number;
  /** Local elapsed-work bound, 1..30000 ms. Default 5000; no automatic retry. */
  verification_timeout_ms?: number;
}>;

export class DelegatedReceiptBinder {
  readonly #trust: ReceiptTrustPolicy;
  readonly #verify: TrustedReceiptJoseVerifier['verify'];
  readonly #contentDigest: ReceiptBindingDependencies['contentDigest'];
  readonly #now: ReceiptBindingDependencies['now'];
  readonly #timeoutMs: number;
  readonly #assertTrust: (()=>void)|undefined;

  constructor(deps: ReceiptBindingDependencies) {
    insist(deps && !!deps.jose && typeof deps.jose.verify==='function' &&
      typeof deps.contentDigest==='function' && typeof deps.now==='function',
      'RECEIPT_TRUST_NOT_CONFIGURED');
    insist(deps.jose.assertCurrent === undefined || typeof deps.jose.assertCurrent === 'function',
      'RECEIPT_TRUST_NOT_CONFIGURED');
    const trust = snapshot(deps.trust, 'RECEIPT_TRUST_NOT_CONFIGURED');
    object(trust, ['issuer','organization_id','allowed_algorithms','trusted_key_ids']);
    insist(Array.isArray(trust.allowed_algorithms) && trust.allowed_algorithms.length>0 &&
      trust.allowed_algorithms.every(a=>a==='ES256'||a==='EdDSA') &&
      new Set(trust.allowed_algorithms).size === trust.allowed_algorithms.length &&
      Array.isArray(trust.trusted_key_ids) && trust.trusted_key_ids.length>0 &&
      trust.trusted_key_ids.length<=64 &&
      trust.trusted_key_ids.every(id=>typeof id==='string' && id.length>0 && id.length<=512) &&
      new Set(trust.trusted_key_ids).size===trust.trusted_key_ids.length,
      'RECEIPT_TRUST_NOT_CONFIGURED');
    principal(trust.issuer);
    insist(typeof trust.organization_id==='string' && UUID.test(trust.organization_id),
      'RECEIPT_TRUST_NOT_CONFIGURED');
    const timeoutMs = deps.verification_timeout_ms === undefined ? 5000 : deps.verification_timeout_ms;
    insist(Number.isSafeInteger(timeoutMs) && timeoutMs>=1 && timeoutMs<=30_000,
      'RECEIPT_TRUST_NOT_CONFIGURED');
    this.#assertTrust=deps.jose.assertCurrent?.bind(deps.jose);
    this.#trust=trust;
    this.#verify=deps.jose.verify.bind(deps.jose);
    this.#contentDigest=deps.contentDigest.bind(deps);
    this.#now=deps.now.bind(deps);
    this.#timeoutMs=timeoutMs;
  }

  async #verifyWithDeadline(compactJws: string): Promise<CryptographicallyVerifiedReceipt> {
    const controller = new AbortController();
    const startedAt = performance.now();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        reject(new ReceiptBindingDenied('RECEIPT_VERIFICATION_TIMEOUT'));
        controller.abort();
      }, this.#timeoutMs);
    });
    try {
      // Promise.race observes late rejection too. Cancellation is cooperative;
      // a timeout never returns evidence or retries the original operation.
      const verified = await Promise.race([
        Promise.resolve().then(() => this.#verify(compactJws, this.#trust, controller.signal)),
        deadline,
      ]);
      // Timers cannot preempt a blocked event loop. A late success may reach
      // this continuation before the timer callback, so also check elapsed
      // monotonic time before returning any evidence.
      const elapsed = performance.now() - startedAt;
      if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= this.#timeoutMs) {
        timedOut = true;
        controller.abort();
        deny('RECEIPT_VERIFICATION_TIMEOUT');
      }
      return verified;
    } catch {
      deny(timedOut ? 'RECEIPT_VERIFICATION_TIMEOUT' : 'RECEIPT_SIGNATURE_INVALID');
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Read-only evidence verification; never execute based on this result alone.
   * Real Gateway publication, nonce final-use, grant refresh, merchant approval,
   * durable operation attachment and replay reservation remain separate gates.
   */
  async verifyAndBind(compactJws: string, input: ExpectedReceiptBinding): Promise<BoundDelegatedReceipt> {
    insist(typeof compactJws==='string' && compactJws.length <= 100_000 &&
      COMPACT.test(compactJws), 'RECEIPT_COMPACT_INVALID');
    const expected = snapshot(input, 'RECEIPT_EXPECTED_INVALID');
    object(expected, ['preview','delegated_ceiling','tenant_id','store_id','merchant_id',
      'customer_id','issuer','organization_id','actor','subject','status_issuer','binding',
      'grant','operation','policy','challenge','require_domain_evidence'],
      ['domain_evaluator','domain_profile','domain_document_digest']);
    object(expected.delegated_ceiling, ['currency','maximum_minor']);
    object(expected.policy, ['id','version_digest']);
    object(expected.operation, ['action','resource_id','audience','request_profile']);
    const now = this.#now();
    insist(Number.isSafeInteger(now) && now >= 0, 'RECEIPT_CLOCK_INVALID');
    const nowNs = BigInt(now) * NS_PER_MS;
    principal(expected.issuer);
    insist(expected.issuer.type===this.#trust.issuer.type &&
      expected.issuer.id===this.#trust.issuer.id &&
      expected.organization_id===this.#trust.organization_id,
      'RECEIPT_ISSUER_MISMATCH');
    for (const field of ['tenant_id','store_id','merchant_id','customer_id'] as const)
      insist(typeof expected[field]==='string' && ID.test(expected[field]), 'RECEIPT_EXPECTED_INVALID');
    matchGrant(expected.grant,expected.grant,'RECEIPT_GRANT_MISMATCH');
    principal(expected.actor);principal(expected.subject);principal(expected.status_issuer);
    sameBinding(expected.binding,expected.binding);
    insist(typeof expected.challenge==='string' && expected.challenge.length>=22 &&
      expected.challenge.length<=128 && /^[\x21-\x7E]+$/.test(expected.challenge),
      'RECEIPT_CHALLENGE_INVALID');
    for (const field of ['action','resource_id','audience','request_profile'] as const)
      nonempty(expected.operation[field]);
    nonempty(expected.policy.id);
    positiveDigest(expected.policy.version_digest,'RECEIPT_POLICY_MISMATCH');
    insist(typeof expected.require_domain_evidence === 'boolean', 'RECEIPT_DOMAIN_MISMATCH');
    if (expected.require_domain_evidence) {
      principal(expected.domain_evaluator);
      nonempty(expected.domain_profile);
      positiveDigest(expected.domain_document_digest,'RECEIPT_DOMAIN_MISMATCH');
    } else {
      insist(['domain_evaluator','domain_profile','domain_document_digest'].every(
        field => !Object.hasOwn(expected, field)), 'RECEIPT_DOMAIN_MISMATCH');
    }
    const request_digest = compareSnapshot(expected.preview, expected, this.#contentDigest, now);
    const expectedOperation = {...expected.operation,request_digest};

    const verified = snapshot(await this.#verifyWithDeadline(compactJws), 'RECEIPT_FIELDS_INVALID');
    object(verified, ['protected_header','trusted_key','payload']);
    const h = object(verified.protected_header,['typ','alg','kid']);
    const key = object(verified.trusted_key,['issuer','purpose','key_id','algorithm']);
    insist(h.typ===JWS_TYP && typeof h.kid==='string' && h.kid===key.key_id &&
      typeof h.alg==='string' && h.alg===key.algorithm &&
      this.#trust.allowed_algorithms.includes(h.alg as 'ES256'|'EdDSA') &&
      this.#trust.trusted_key_ids.includes(h.kid as string) &&
      key.purpose===JWS_PURPOSE, 'RECEIPT_KEY_UNTRUSTED');
    matchPrincipal(key.issuer,this.#trust.issuer,'RECEIPT_KEY_UNTRUSTED');

    const p = object(verified.payload,['profile','id','issuer','decision','evaluation','policy','issued_at','expires_at']);
    insist(p.profile===RECEIPT_PROFILE && p.decision==='PERMIT' &&
      typeof p.id==='string' && UUID.test(p.id), 'RECEIPT_PROFILE_INVALID');
    matchPrincipal(p.issuer,this.#trust.issuer,'RECEIPT_ISSUER_MISMATCH');
    const e = object(p.evaluation,[
      'profile','organization_id','grant','actor','subject','binding','operation',
      'approval_evidence_ref','authority_evidence_ref','proof_evidence_ref','challenge',
      'proof_verified_at','proof_valid_until','status','evaluated_at'
    ],['domain_evidence']);
    insist(e.profile===EVALUATION_PROFILE && e.organization_id===expected.organization_id,
      'RECEIPT_ORGANIZATION_MISMATCH');
    matchGrant(e.grant,expected.grant,'RECEIPT_GRANT_MISMATCH');
    matchPrincipal(e.actor,expected.actor,'RECEIPT_ACTOR_MISMATCH');
    matchPrincipal(e.subject,expected.subject,'RECEIPT_SUBJECT_MISMATCH');
    sameBinding(e.binding,expected.binding);
    matchOperation(e.operation,expectedOperation,'RECEIPT_OPERATION_MISMATCH');
    insist(e.challenge===expected.challenge,'RECEIPT_CHALLENGE_MISMATCH');
    evidenceRef(e.approval_evidence_ref);
    evidenceRef(e.authority_evidence_ref);
    evidenceRef(e.proof_evidence_ref);
    const status=object(e.status,['issuer','grant','state','checked_at','valid_until','evidence_ref']);
    matchPrincipal(status.issuer,expected.status_issuer,'RECEIPT_STATUS_MISMATCH');
    matchGrant(status.grant,expected.grant,'RECEIPT_STATUS_MISMATCH');
    insist(status.state==='ACTIVE', 'RECEIPT_STATUS_MISMATCH');
    evidenceRef(status.evidence_ref);
    const issued=timestamp(p.issued_at),expires=timestamp(p.expires_at),
      proofAt=timestamp(e.proof_verified_at),proofUntil=timestamp(e.proof_valid_until),
      statusAt=timestamp(status.checked_at),statusUntil=timestamp(status.valid_until),
      evaluated=timestamp(e.evaluated_at);
    insist(proofAt<=evaluated && statusAt<=evaluated && evaluated<=issued &&
      issued<=nowNs && nowNs<expires && expires<=proofUntil && expires<=statusUntil &&
      nowNs<proofUntil && nowNs<statusUntil && expires-issued<=600_000_000_000n,
      'RECEIPT_EXPIRED_OR_STALE');
    const pol = object(p.policy,['id','version_digest']);
    insist(pol.id===expected.policy.id && pol.version_digest===expected.policy.version_digest,
      'RECEIPT_POLICY_MISMATCH');
    positiveDigest(pol.version_digest,'RECEIPT_POLICY_MISMATCH');
    const domain = e.domain_evidence;
    if (!expected.require_domain_evidence)
      insist(!Object.hasOwn(e, 'domain_evidence'), 'RECEIPT_DOMAIN_MISMATCH');
    if (expected.require_domain_evidence) {
      insist(domain!==null && domain!==undefined,'RECEIPT_DOMAIN_MISSING');
      const d=object(domain,['evaluator','profile','document_digest','grant','operation',
        'decision','checked_at','valid_until','evidence_ref']);
      matchPrincipal(d.evaluator,expected.domain_evaluator,'RECEIPT_DOMAIN_MISMATCH');
      insist(d.profile===expected.domain_profile,'RECEIPT_DOMAIN_MISMATCH');
      positiveDigest(d.document_digest,'RECEIPT_DOMAIN_MISMATCH');
      insist(d.document_digest===expected.domain_document_digest,
        'RECEIPT_DOMAIN_MISMATCH');
      matchGrant(d.grant,expected.grant,'RECEIPT_DOMAIN_MISMATCH');
      matchOperation(d.operation,expectedOperation,'RECEIPT_DOMAIN_MISMATCH');
      insist(d.decision==='PERMIT' && timestamp(d.checked_at)<=evaluated &&
        timestamp(d.valid_until)>=expires && timestamp(d.valid_until)>nowNs,
        'RECEIPT_DOMAIN_MISMATCH');
      evidenceRef(d.evidence_ref);
    }
    // Complete hashing and trust retirement checks before the one final clock
    // sample. A digest callback or key retirement cannot outrun this deadline.
    insist(compareSnapshot(expected.preview, expected, this.#contentDigest, now) === request_digest,
      'RECEIPT_CHECKOUT_CHANGED');
    const trustResult: unknown = this.#assertTrust?.();
    if (trustResult !== undefined) {
      if (trustResult instanceof Promise) void trustResult.catch(() => {});
      deny('RECEIPT_TRUST_INVALID');
    }
    const completedAt = this.#now();
    assertReceiptFresh(p.expires_at as string, expected.preview, completedAt, now);
    return Object.freeze({
      receipt_id:p.id as string, grant_id:expected.grant.id,grant_revision:expected.grant.revision,
      challenge:expected.challenge,operation_digest:request_digest,
      checkout_preview_digest:expected.preview.preview_digest,
      issuer_key_id:h.kid as string,policy_version_digest:expected.policy.version_digest,
      issued_at:p.issued_at as string,expires_at:p.expires_at as string,
      execution_authorized:false as const,qualification:'candidate_contract_only' as const,
    });
  }
}

/** Final no-await time fence, shared by the binder and its native owner. */
export function assertReceiptFresh(expiresAt: string, preview: FrozenCheckoutPreview,
  now: number, startedAt: number): void {
  insist(Number.isSafeInteger(now) && now >= 0, 'RECEIPT_CLOCK_INVALID');
  insist(now >= startedAt && BigInt(now) * NS_PER_MS < timestamp(expiresAt),
    'RECEIPT_EXPIRED_OR_STALE');
  insist(now >= preview.created_at && now < preview.expires_at, 'RECEIPT_CHECKOUT_EXPIRED');
}
