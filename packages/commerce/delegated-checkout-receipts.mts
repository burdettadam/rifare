import { exact, id, integer } from './kernel.mts';
import type { CommerceKernel, Scope } from './kernel.mts';
import { contentDigest } from './configuration-values.mts';
import { growthCustomer } from './growth-shopping-core.mts';
import { assertRecoveryEgress } from './data-guards.mts';
import { CheckoutPreviews } from './checkout-previews.mts';
import { checkoutSnapshot } from './checkout-preview.mts';
import type { FrozenCheckoutPreview } from './checkout-preview.mts';
import { DelegatedReceiptBinder, ReceiptBindingDenied, assertReceiptFresh } from './delegated-receipt-binding.mts';
import type { ExpectedReceiptBinding, DomainEvidenceExpectation, ReceiptTrustPolicy,
  TrustedReceiptJoseVerifier, BoundDelegatedReceipt } from './delegated-receipt-binding.mts';

type ExternalPins = Pick<ExpectedReceiptBinding, 'delegated_ceiling'|'issuer'|'organization_id'|
  'actor'|'subject'|'status_issuer'|'binding'|'grant'|'operation'|'policy'|'challenge'>;
export type ReceiptBindingContext = Readonly<ExternalPins & {
  context_id: string; revision: number; valid_until: number;
  tenant_id: string; store_id: string; resource_id: string; customer_id: string;
  preview_id: string; preview_digest: string;
}> & DomainEvidenceExpectation;

/** Internal, server-owned current context. No provider implementation ships here.
 * Resolve must be synchronous; external work belongs before publishing a context.
 * assertCurrent must be a synchronous, side-effect-free state/generation check,
 * including exact context facts, authorization and validity; no I/O or callbacks.
 * Neither method may derive expectations from the received signed receipt. */
export interface ReceiptContextSource {
  resolve(scope: Scope, preview: FrozenCheckoutPreview, contextId: string): ReceiptBindingContext | undefined;
  assertCurrent(scope: Scope, context: ReceiptBindingContext): void;
}
export type CurrentReceiptVerifier = TrustedReceiptJoseVerifier & { assertCurrent(): void };
export type ReceiptVerificationConfiguration = Readonly<{
  contexts: ReceiptContextSource; jose: CurrentReceiptVerifier; trust: ReceiptTrustPolicy;
  verification_timeout_ms?: number; max_pending?: number;
}>;
export type ReceiptEvidenceRequest = Readonly<{ preview_id: string; context_id: string; compact_jws: string }>;
export type CurrentReceiptBinding = Readonly<{ preview: FrozenCheckoutPreview; context: ReceiptBindingContext }>;
function fail(code: string): never { throw new ReceiptBindingDenied(code); }

/** Evidence only. No raw receipt storage, replay redemption, final-use provider
 * operation, approval or commerce dispatch. Absence of configuration is unavailable. */
export class DelegatedCheckoutReceipts {
  readonly #kernel: CommerceKernel;
  readonly #clock: () => number;
  readonly #current: CheckoutPreviews['current'];
  readonly #resolve: ReceiptContextSource['resolve'] | undefined;
  readonly #assertContext: ReceiptContextSource['assertCurrent'] | undefined;
  readonly #assertTrust: (() => void) | undefined;
  readonly #binder: DelegatedReceiptBinder | undefined;
  readonly #maximum: number;
  // Object provenance stays process-local. JSON/SQL copies are never current handles.
  readonly #bindings = new WeakMap<CurrentReceiptBinding, { scope: Scope; startedAt: number }>();
  readonly #receipts = new WeakMap<BoundDelegatedReceipt, CurrentReceiptBinding>();
  #pending = 0;
  #lastTime = 0;
  #closed = false;

  constructor(kernel: CommerceKernel, previews: CheckoutPreviews, config?: ReceiptVerificationConfiguration) {
    try {
      if (!(previews instanceof CheckoutPreviews) || !CheckoutPreviews.prototype.boundTo.call(previews,kernel))
        fail('RECEIPT_CONFIG_INVALID');
    } catch { fail('RECEIPT_CONFIG_INVALID'); }
    this.#kernel = kernel; this.#clock = kernel.clock.bind(kernel);
    this.#current = CheckoutPreviews.prototype.current.bind(previews);
    if (!config) { this.#maximum = 16; return; }
    if (Reflect.ownKeys(config).some(key => typeof key !== 'string' ||
      !['contexts','jose','trust','verification_timeout_ms','max_pending'].includes(key))) fail('RECEIPT_CONFIG_INVALID');
    if (!config.contexts || typeof config.contexts.resolve !== 'function' ||
      typeof config.contexts.assertCurrent !== 'function' || !config.jose ||
      typeof config.jose.verify !== 'function' || typeof config.jose.assertCurrent !== 'function')
      fail('RECEIPT_CONFIG_INVALID');
    const maximum = config.max_pending ?? 16;
    integer(maximum, 1); if (maximum > 32) fail('RECEIPT_CONFIG_INVALID');
    this.#maximum = maximum;
    this.#resolve = config.contexts.resolve.bind(config.contexts);
    this.#assertContext = config.contexts.assertCurrent.bind(config.contexts);
    this.#assertTrust = config.jose.assertCurrent.bind(config.jose);
    this.#binder = new DelegatedReceiptBinder({ jose: config.jose, trust: config.trust,
      contentDigest, now: () => this.#now(), verification_timeout_ms: config.verification_timeout_ms });
  }

  get available(): boolean { return this.#available(); }
  #available(): boolean { return !this.#closed && !!this.#binder; }
  boundTo(kernel: CommerceKernel): boolean { return this.#kernel === kernel; }
  close(): void { this.#closed = true; }
  #now(): number {
    if (!this.#available()) fail('RECEIPT_UNAVAILABLE');
    const now = this.#clock();
    if (!Number.isSafeInteger(now) || now < this.#lastTime) fail('RECEIPT_CLOCK_INVALID');
    this.#lastTime = now; return now;
  }
  #context(scope: Scope, preview: FrozenCheckoutPreview, contextId: string): ReceiptBindingContext {
    const raw = this.#resolve!(scope, preview, contextId);
    if (raw instanceof Promise) {
      void raw.catch(() => {});
      fail('RECEIPT_CONTEXT_INVALID');
    }
    if (!raw) fail('RECEIPT_CONTEXT_UNAVAILABLE');
    const context = checkoutSnapshot(raw);
    const fields = ['context_id','revision','valid_until','tenant_id','store_id','resource_id',
      'customer_id','preview_id','preview_digest','delegated_ceiling','issuer','organization_id',
      'actor','subject','status_issuer','binding','grant','operation','policy','challenge','require_domain_evidence'];
    if (context.require_domain_evidence === true) fields.push('domain_evaluator','domain_profile','domain_document_digest');
    exact(context, fields); integer(context.revision, 1); integer(context.valid_until, 1);
    if (context.context_id !== contextId || context.preview_id !== preview.preview_id ||
      context.preview_digest !== preview.preview_digest || context.tenant_id !== preview.tenant_id ||
      context.store_id !== preview.store_id || context.resource_id !== preview.resource_id ||
      context.customer_id !== preview.customer_id) fail('RECEIPT_CONTEXT_MISMATCH');
    return context;
  }
  #fence(scope: Scope, context: ReceiptBindingContext): void {
    // A promise or a boolean is not a completed current-state assertion.
    const result: unknown = this.#assertContext!(scope, context);
    if (result !== undefined) {
      if (result instanceof Promise) void result.catch(() => {});
      fail('RECEIPT_CONTEXT_INVALID');
    }
    const trustResult: unknown = this.#assertTrust!();
    if (trustResult !== undefined) {
      if (trustResult instanceof Promise) void trustResult.catch(() => {});
      fail('RECEIPT_TRUST_INVALID');
    }
    if (!this.#available()) fail('RECEIPT_UNAVAILABLE');
  }

  /** Internal capture of server-owned current facts; it grants no execution authority. */
  currentBinding(scope: Scope, input: Readonly<{ preview_id: string; context_id: string }>): CurrentReceiptBinding {
    if (!this.#available()) fail('RECEIPT_UNAVAILABLE');
    const request = checkoutSnapshot(input); exact(request, ['preview_id','context_id']);
    id(request.preview_id); id(request.context_id);
    const startedAt = this.#now(), preview = this.#current(scope, request.preview_id);
    const context = this.#context(scope, preview, request.context_id);
    if (startedAt >= context.valid_until) fail('RECEIPT_CONTEXT_EXPIRED');
    this.#fence(scope, context);
    const binding = Object.freeze({ preview, context });
    this.#bindings.set(binding, { scope, startedAt });
    return binding;
  }

  #finish(scope: Scope, binding: CurrentReceiptBinding, receipt?: BoundDelegatedReceipt): void {
    const provenance = this.#bindings.get(binding);
    if (!provenance || provenance.scope !== scope) fail('RECEIPT_PROVENANCE_INVALID');
    const { preview, context } = binding;
    this.#fence(scope, context);
    const current = this.#current(scope, preview.preview_id);
    if (current !== preview || current.preview_digest !== preview.preview_digest) fail('RECEIPT_CHECKOUT_CHANGED');
    // All source callbacks finish before these pure retirement and local guards.
    this.#fence(scope, context);
    const session = growthCustomer(this.#kernel, scope, preview.resource_id, preview.customer_id);
    assertRecoveryEgress(this.#kernel);
    const completedAt = this.#now();
    if (completedAt >= context.valid_until) fail('RECEIPT_CONTEXT_EXPIRED');
    if (completedAt >= session.expires_at) fail('RECEIPT_SCOPE_EXPIRED');
    if (receipt) assertReceiptFresh(receipt.expires_at, preview, completedAt, provenance.startedAt);
    else if (completedAt >= preview.expires_at) fail('RECEIPT_CHECKOUT_EXPIRED');
  }

  /** Synchronous final transaction guard, never a rehydration or dispatch port. */
  assertBindingCurrent(scope: Scope, binding: CurrentReceiptBinding): void { this.#finish(scope, binding); }
  /** Only this instance's actual verified result can carry live provenance. */
  assertCurrent(scope: Scope, receipt: BoundDelegatedReceipt): CurrentReceiptBinding {
    const binding = this.#receipts.get(receipt);
    if (!binding) fail('RECEIPT_PROVENANCE_INVALID');
    this.#finish(scope, binding, receipt); return binding;
  }

  async verify(scope: Scope, input: ReceiptEvidenceRequest): Promise<BoundDelegatedReceipt> {
    if (!this.#available()) fail('RECEIPT_UNAVAILABLE');
    if (this.#pending >= this.#maximum) fail('RECEIPT_VERIFICATION_CAPACITY');
    this.#pending++;
    try {
      const request = checkoutSnapshot(input);
      exact(request, ['preview_id','context_id','compact_jws']);
      id(request.preview_id); id(request.context_id);
      const binding = DelegatedCheckoutReceipts.prototype.currentBinding.call(this,scope,
        { preview_id: request.preview_id, context_id: request.context_id });
      const { preview, context } = binding;
      const { context_id: _id, revision: _revision, valid_until: _until,
        preview_id: _preview, preview_digest: _digest, resource_id: _resource,
        tenant_id: _tenant, store_id: _store, customer_id: _customer, ...pins } = context;
      const expected = { ...pins, preview, tenant_id: preview.tenant_id, store_id: preview.store_id,
        merchant_id: preview.merchant_id, customer_id: preview.customer_id } as ExpectedReceiptBinding;
      const receipt = await this.#binder!.verifyAndBind(request.compact_jws, expected);
      this.#finish(scope, binding, receipt);
      this.#receipts.set(receipt, binding);
      return receipt;
    } finally { this.#pending--; }
  }
}
