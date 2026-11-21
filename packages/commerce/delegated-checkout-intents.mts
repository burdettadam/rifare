import { exact, id, integer, digest } from './kernel.mts';
import type { CommerceKernel, Scope } from './kernel.mts';
import { contentDigest } from './configuration-values.mts';
import { checkoutSnapshot } from './checkout-preview.mts';
import { growthCustomer } from './growth-shopping-core.mts';
import { subjectHash } from './data-guards.mts';
import { DelegatedCheckoutReceipts } from './delegated-checkout-receipts.mts';
import type { CurrentReceiptBinding } from './delegated-checkout-receipts.mts';
import type { BoundDelegatedReceipt } from './delegated-receipt-binding.mts';
import { INTENT_KIND, INTENT_MAX_ROWS, intentRecords, intentIdentity, intentId, intentBindingDigest,
  challengeFingerprint, receiptFingerprint, receiptExpiryBoundary, insertIntent, updateIntent, retireIntent, intentHeld } from './delegated-checkout-intent-records.mts';
import type { IntentBody, IntentRecord } from './delegated-checkout-intent-records.mts';

export type DelegatedIntentView = Readonly<{
  intent_id: string; resource_id: string; revision: number; created_at: number; expires_at: number;
  state: 'prepared'|'evidence_verified'|'cancelled'|'expired'; authority_revoked: boolean; minimized: boolean;
  binding_digest: string; purchase: Readonly<{ currency: string; total_payable_minor: string; preview_digest: string }>|null;
  receipt: BoundDelegatedReceipt|null; verified_at: number|null;
  evidence_status: 'historical_observation'; execution_authorized: false; qualification: 'candidate_contract_only';
}>;

/** Local intent/evidence storage, never provider final use, replay redemption or dispatch. */
export class DelegatedCheckoutIntents {
  readonly #kernel: CommerceKernel;
  readonly #receipts: DelegatedCheckoutReceipts|undefined;
  readonly #capture: DelegatedCheckoutReceipts['currentBinding']|undefined;
  readonly #verify: DelegatedCheckoutReceipts['verify']|undefined;
  readonly #assertBinding: DelegatedCheckoutReceipts['assertBindingCurrent']|undefined;
  readonly #assertReceipt: DelegatedCheckoutReceipts['assertCurrent']|undefined;
  #lastTime = 0;

  constructor(kernel: CommerceKernel, receipts?: DelegatedCheckoutReceipts) {
    if (receipts && (!(receipts instanceof DelegatedCheckoutReceipts) || !receipts.boundTo(kernel)))
      throw new Error('INTENT_CONFIG_INVALID');
    this.#kernel = kernel; this.#receipts = receipts;
    this.#capture = receipts?.currentBinding.bind(receipts); this.#verify = receipts?.verify.bind(receipts);
    this.#assertBinding = receipts?.assertBindingCurrent.bind(receipts); this.#assertReceipt = receipts?.assertCurrent.bind(receipts);
  }
  #records(scope: Scope): IntentRecord[] {
    const s = this.#kernel.require(scope);
    if (s.role !== 'customer') throw new Error('NOT_FOUND');
    return intentRecords(this.#kernel,{ tenant_id: s.tenant_id, store_id: s.store_id });
  }
  #access(scope: Scope, record: IntentRecord): void {
    const b = record.body, s = this.#kernel.require(scope);
    if (s.tenant_id !== b.tenant_id || s.store_id !== b.store_id || s.resource_id !== b.resource_id ||
      s.role !== 'customer' || subjectHash(s.tenant_id,s.store_id,s.customer_id) !== b.subject_ref)
      throw new Error('NOT_FOUND');
    growthCustomer(this.#kernel,scope,b.resource_id,s.customer_id);
  }
  #lookup(scope: Scope, intent: string): IntentRecord {
    id(intent); const record = this.#records(scope).find(r => r.body.id === intent);
    if (!record) throw new Error('NOT_FOUND'); this.#access(scope,record); return record;
  }
  #view(record: IntentRecord): DelegatedIntentView {
    const b = record.body, p = b.authority_revoked ? null : b.personal;
    return checkoutSnapshot({ intent_id: b.id, resource_id: b.resource_id, revision: b.revision,
      created_at: b.created_at, expires_at: b.expires_at,
      state: b.state === 'cancelled' ? 'cancelled' : b.expired ? 'expired' : b.state,
      authority_revoked: b.authority_revoked, minimized: b.minimized, binding_digest: b.binding_digest,
      purchase: p ? { currency: p.currency, total_payable_minor: p.total_payable_minor, preview_digest: p.preview_digest } : null,
      receipt: p?.receipt ?? null, verified_at: p?.verified_at ?? null,
      evidence_status: 'historical_observation', execution_authorized: false, qualification: 'candidate_contract_only' });
  }
  #available(): void { if (!this.#receipts?.available) throw new Error('RECEIPT_UNAVAILABLE'); }
  #now(): number {
    const now = integer(this.#kernel.clock());
    if (now < this.#lastTime) throw new Error('INTENT_CLOCK_INVALID');
    this.#lastTime = now; return now;
  }
  #observeExpiry(scope: Scope, record: IntentRecord): IntentRecord {
    const b = record.body;
    if (b.expired || b.state === 'cancelled') return record;
    if (this.#now() < Math.min(b.expires_at,b.receipt_expires_at ?? b.expires_at)) return record;
    const expired = updateIntent(this.#kernel,record,{ ...b, expired: true, revision: b.revision + 1 });
    this.#access(scope,expired); this.#unchanged(expired); return expired;
  }
  #original(binding: CurrentReceiptBinding, createdAt: number): IntentBody {
    const { preview: p, context: c } = binding;
    const identity = intentIdentity(p.tenant_id,p.store_id,p.preview_id,c.context_id);
    const namespace = contentDigest(['rifare-delegated-authority-v1',c.issuer,c.organization_id]);
    const b: Omit<IntentBody,'binding_digest'> = { schema_version: 1, id: intentId(identity),
      tenant_id: p.tenant_id, store_id: p.store_id, resource_id: p.resource_id,
      subject_ref: subjectHash(p.tenant_id,p.store_id,p.customer_id), identity_digest: identity,
      authority_namespace: namespace, challenge_fingerprint: challengeFingerprint(namespace,c.challenge),
      receipt_fingerprint: null, token_digest: null, receipt_expires_at: null, created_at: createdAt,
      expires_at: Math.min(p.expires_at,c.valid_until), revision: 1, state: 'prepared',
      authority_revoked: false, revocation_reason: null, minimized: false, expired: false, personal: {
        customer_id: p.customer_id, preview_id: p.preview_id, preview_digest: p.preview_digest,
        context_id: c.context_id, context_digest: contentDigest(c), context_revision: c.revision,
        grant_id: c.grant.id, grant_revision: c.grant.revision, challenge: c.challenge,
        currency: p.currency, total_payable_minor: p.total_payable_minor, receipt: null, verified_at: null } };
    return { ...b, binding_digest: intentBindingDigest(b) };
  }
  #unchanged(record: IntentRecord): void {
    const b = record.body, row = this.#kernel.db.prepare(`SELECT digest,state FROM commerce_support_documents
      WHERE tenant_id=? AND store_id=? AND kind=? AND id=? AND version=1`).get(b.tenant_id,b.store_id,INTENT_KIND,b.id);
    if (!row || row.digest !== record.row.digest || row.state !== record.row.state) throw new Error('INTENT_REVISION_CONFLICT');
    const claims = this.#kernel.db.prepare(`SELECT count(*) AS total,
      sum(CASE WHEN json_extract(body,'$.challenge_fingerprint')=? THEN 1 ELSE 0 END) AS challenges,
      sum(CASE WHEN json_extract(body,'$.receipt_fingerprint')=? THEN 1 ELSE 0 END) AS receipts
      FROM commerce_support_documents WHERE tenant_id=? AND store_id=? AND kind=?`).get(
        b.challenge_fingerprint,b.receipt_fingerprint,b.tenant_id,b.store_id,INTENT_KIND)!;
    if (Number(claims.total) > INTENT_MAX_ROWS) throw new Error('INTENT_ROW_LIMIT');
    if (Number(claims.challenges) !== 1) throw new Error('INTENT_CHALLENGE_CONFLICT');
    if (b.receipt_fingerprint && Number(claims.receipts) !== 1) throw new Error('INTENT_RECEIPT_REUSED');
  }
  #finish(scope: Scope, record: IntentRecord, binding: CurrentReceiptBinding, receipt?: BoundDelegatedReceipt): DelegatedIntentView {
    const view = this.#view(record);
    if (receipt) this.#assertReceipt!(scope,receipt); else this.#assertBinding!(scope,binding);
    // Source callbacks can cancel/erase the intent too. Only an inert SQL read follows the final authority fence.
    this.#unchanged(record); return view;
  }

  prepare(scope: Scope, input: Readonly<{ preview_id: string; context_id: string }>): DelegatedIntentView {
    const request = checkoutSnapshot(input); exact(request,['preview_id','context_id']); id(request.preview_id); id(request.context_id);
    this.#available();
    return this.#kernel.transaction(() => {
      const binding = this.#capture!(scope,request), records = this.#records(scope);
      const key = intentId(intentIdentity(binding.preview.tenant_id,binding.preview.store_id,request.preview_id,request.context_id));
      const previous = records.find(r => r.body.id === key);
      const body = this.#original(binding,previous?.body.created_at ?? this.#now());
      if (previous) {
        this.#access(scope,previous);
        if (previous.body.binding_digest !== body.binding_digest) throw new Error('INTENT_BINDING_CONFLICT');
        return this.#finish(scope,previous,binding);
      }
      if (records.length >= INTENT_MAX_ROWS) throw new Error('INTENT_ROW_LIMIT');
      if (records.some(r => r.body.challenge_fingerprint === body.challenge_fingerprint)) throw new Error('INTENT_CHALLENGE_CONFLICT');
      this.#assertBinding!(scope,binding);
      return this.#finish(scope,insertIntent(this.#kernel,body),binding);
    });
  }
  read(scope: Scope, intentId: string): DelegatedIntentView {
    return this.#kernel.transaction(() => {
      const record = this.#observeExpiry(scope,this.#lookup(scope,intentId)), view = this.#view(record);
      this.#access(scope,record); this.#unchanged(record); return view;
    });
  }
  lookup(scope: Scope, input: Readonly<{ preview_id: string; context_id: string }>): DelegatedIntentView {
    const request = checkoutSnapshot(input); exact(request,['preview_id','context_id']); id(request.preview_id); id(request.context_id);
    return this.#kernel.transaction(() => {
      const s = this.#kernel.require(scope);
      if (s.role !== 'customer') throw new Error('NOT_FOUND');
      growthCustomer(this.#kernel,scope,s.resource_id,s.customer_id);
      const identity = intentIdentity(s.tenant_id,s.store_id,request.preview_id,request.context_id);
      const original = this.#lookup(scope,intentId(identity));
      // The public ID is truncated; retain the full identity check on this exact validated record.
      if (original.body.identity_digest !== identity) throw new Error('NOT_FOUND');
      const record = this.#observeExpiry(scope,original), view = this.#view(record);
      this.#access(scope,record); this.#unchanged(record); return view;
    });
  }
  async verifyReceipt(scope: Scope, input: Readonly<{ intent_id: string; compact_jws: string }>): Promise<DelegatedIntentView> {
    const request = checkoutSnapshot(input); exact(request,['intent_id','compact_jws']); id(request.intent_id);
    if (typeof request.compact_jws !== 'string' || request.compact_jws.length > 100000 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(request.compact_jws)) throw new Error('RECEIPT_COMPACT_INVALID');
    const tokenDigest = digest(request.compact_jws), original = this.#kernel.transaction(() =>
      this.#observeExpiry(scope,this.#lookup(scope,request.intent_id)));
    if (original.body.token_digest) {
      if (original.body.token_digest !== tokenDigest) throw new Error('INTENT_RECEIPT_CONFLICT');
      return this.read(scope,request.intent_id); // Retained status, explicitly not fresh verification.
    }
    if (original.body.authority_revoked || !original.body.personal) throw new Error('INTENT_REVOKED');
    if (original.body.expired || this.#now() >= original.body.expires_at) throw new Error('INTENT_EXPIRED');
    this.#available();
    const p = original.body.personal;
    const receipt = await this.#verify!(scope,{ preview_id: p.preview_id, context_id: p.context_id, compact_jws: request.compact_jws });
    return this.#kernel.transaction(() => {
      const binding = this.#assertReceipt!(scope,receipt), current = this.#lookup(scope,request.intent_id), b = current.body;
      if (b.authority_revoked || !b.personal) throw new Error('INTENT_REVOKED');
      if (b.expired) throw new Error('INTENT_EXPIRED');
      if (this.#original(binding,b.created_at).binding_digest !== b.binding_digest) throw new Error('INTENT_BINDING_CONFLICT');
      if (b.token_digest) {
        if (b.token_digest !== tokenDigest) throw new Error('INTENT_RECEIPT_CONFLICT');
        return this.#finish(scope,current,binding,receipt);
      }
      if (b.revision !== original.body.revision) throw new Error('INTENT_REVISION_CONFLICT');
      const fingerprint = receiptFingerprint(b.authority_namespace,receipt.receipt_id);
      if (this.#records(scope).some(r => r.body.id !== b.id && r.body.receipt_fingerprint === fingerprint))
        throw new Error('INTENT_RECEIPT_REUSED');
      const next = updateIntent(this.#kernel,current,{ ...b, revision: b.revision + 1,
        state: 'evidence_verified', receipt_fingerprint: fingerprint, token_digest: tokenDigest,
        receipt_expires_at: receiptExpiryBoundary(receipt.expires_at),
        personal: { ...b.personal, receipt, verified_at: this.#now() } });
      return this.#finish(scope,next,binding,receipt);
    });
  }
  cancel(scope: Scope, input: Readonly<{ intent_id: string; expected_revision: number }>): DelegatedIntentView {
    const request = checkoutSnapshot(input); exact(request,['intent_id','expected_revision']); id(request.intent_id); integer(request.expected_revision,1);
    return this.#kernel.transaction(() => {
      const record = this.#lookup(scope,request.intent_id);
      if (record.body.revision !== request.expected_revision) throw new Error('INTENT_REVISION_CONFLICT');
      const next = retireIntent(this.#kernel,record,'cancelled',!intentHeld(this.#kernel,record.body));
      const view = this.#view(next); this.#access(scope,next); this.#unchanged(next); return view;
    });
  }
}
