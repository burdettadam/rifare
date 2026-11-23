import { checkoutFixture } from './delegated-checkout-helpers.mts';
import { signingFixture, clone, organization, syntheticIssuer } from './receipt-signature-helpers.mts';
import { contentDigest } from '../../packages/commerce/configuration-values.mts';
import { DelegatedCheckoutReceipts } from '../../packages/commerce/delegated-checkout-receipts.mts';
import type { ReceiptBindingContext, ReceiptContextSource } from '../../packages/commerce/delegated-checkout-receipts.mts';
import { ReceiptBindingDenied } from '../../packages/commerce/delegated-receipt-binding.mts';

export async function nativeReceiptFixture(options: { hold?: boolean; algorithm?: 'ES256'|'EdDSA';
  max_pending?: number; verification_timeout_ms?: number; near_session_expiry?: boolean } = {}) {
  const f = await checkoutFixture({ lamp: true });
  try {
    if (options.near_session_expiry) {
      f.advance(f.kernel.require(f.customer).expires_at - f.now() - 1000);
      f.quote('shipping'); f.quote('fee');
    }
    const read = f.quotes.read.bind(f.quotes);
    let reads = 0, armed = Infinity, quoteAction = () => {};
    f.quotes.read = (...args: Parameters<typeof read>) => {
      const result = read(...args); if (++reads === armed) quoteAction(); return result;
    };
    const previews = f.newOwner(), preview = await previews.prepare(f.customer, f.request);
    const signing = await signingFixture(options.algorithm);
    const start = f.now(), at = (offset: number) => new Date(start + offset).toISOString();
    const sha = (label: string) => 'sha256:' + contentDigest(label);
    let live: ReceiptBindingContext | undefined = {
      context_id: 'receipt-context', revision: 1, valid_until: start + 30000,
      tenant_id: preview.tenant_id, store_id: preview.store_id, resource_id: preview.resource_id,
      customer_id: preview.customer_id, preview_id: preview.preview_id, preview_digest: preview.preview_digest,
      delegated_ceiling: { currency: 'USD', maximum_minor: '8000' }, issuer: syntheticIssuer,
      organization_id: organization, actor: { type: 'SERVICE_ACCOUNT', id: 'urn:synthetic:delegate' },
      subject: { type: 'USER', id: 'urn:synthetic:represented-customer' }, status_issuer: syntheticIssuer,
      binding: { method: 'KEY', key_thumbprint: sha('synthetic sender key') },
      grant: { id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', revision: 1, terms_digest: sha('original grant terms') },
      operation: { action: 'urn:rifare:action:purchase:v1', resource_id: 'urn:rifare:resource:' + preview.resource_id,
        audience: 'urn:rifare:store:' + preview.store_id, request_profile: 'urn:rifare:checkout-preview:v1' },
      policy: { id: 'urn:synthetic:policy', version_digest: sha('policy version 1') },
      challenge: 'original_synthetic_challenge_123456789', require_domain_evidence: false,
    };
    const originalContext = clone(live);
    const contexts: ReceiptContextSource = {
      resolve(_scope, _preview, contextId) { return live?.context_id === contextId ? live : undefined; },
      assertCurrent(_scope, context) {
        if (!live || contentDigest(live) !== contentDigest(context)) throw new ReceiptBindingDenied('RECEIPT_CONTEXT_CHANGED');
      },
    };
    const payload: any = {
      profile: 'urn:marty:delegated-decision-receipt:v1', id: 'ffffeeee-dddd-4ccc-8bbb-aaaaaaaaaaaa',
      issuer: clone(live.issuer), decision: 'PERMIT', policy: clone(live.policy),
      issued_at: at(-500), expires_at: at(20000), evaluation: {
        profile: 'urn:marty:delegated-evaluation:v1', organization_id: organization,
        grant: clone(live.grant), actor: clone(live.actor), subject: clone(live.subject), binding: clone(live.binding),
        operation: { ...live.operation, request_digest: 'sha256:' + preview.preview_digest },
        approval_evidence_ref: 'urn:synthetic:approval', authority_evidence_ref: 'urn:synthetic:authority',
        proof_evidence_ref: 'urn:synthetic:proof', challenge: live.challenge,
        proof_verified_at: at(-3000), proof_valid_until: at(40000),
        status: { issuer: clone(live.status_issuer), grant: clone(live.grant), state: 'ACTIVE',
          checked_at: at(-2000), valid_until: at(50000), evidence_ref: 'urn:synthetic:status' },
        evaluated_at: at(-1000),
      },
    };
    const token = await signing.sign(payload);
    let enter!: () => void, release!: () => void, verifyCalls = 0;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const jose = { assertCurrent: signing.verifier.assertCurrent.bind(signing.verifier),
      async verify(...args: Parameters<typeof signing.verifier.verify>) {
        verifyCalls++;
        const verified = await signing.verifier.verify(...args); enter();
        if (options.hold) await gate;
        return verified;
      } };
    const config = { contexts, jose, trust: signing.trust, max_pending: options.max_pending,
      verification_timeout_ms: options.verification_timeout_ms };
    const owner = new DelegatedCheckoutReceipts(f.kernel, previews, config);
    const request = { preview_id: preview.preview_id, context_id: live.context_id, compact_jws: token };
    return { ...f, checkout: f, ownerScope: f.owner.scope, previews, receiptPreview: preview, signing, token, payload, receiptOwner: owner, config, contexts, request,
      originalContext, entered, release, start, at,
      verify: () => owner.verify(f.customer, request),
      get context() { return live!; }, get verifyCalls() { return verifyCalls; },
      removeContext: () => { live = undefined; },
      restoreContext: () => { live = clone(originalContext); },
      afterQuoteReads: (additional: number, action: () => void) => { armed = reads + additional; quoteAction = action; },
      cleanup: () => { release(); owner.close(); signing.verifier.close(); f.cleanup(); },
    };
  } catch (error) { f.cleanup(); throw error; }
}

export async function usingNativeReceipt(fn: (f: Awaited<ReturnType<typeof nativeReceiptFixture>>) => unknown,
  options: Parameters<typeof nativeReceiptFixture>[0] = {}) {
  const f = await nativeReceiptFixture(options); try { await fn(f); } finally { f.cleanup(); }
}
