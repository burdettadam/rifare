import { exact, id } from './kernel.mts';
import type { CommerceKernel, Scope } from './kernel.mts';
import { CheckoutPreviews } from './checkout-previews.mts';
import { checkoutSnapshot } from './checkout-preview.mts';
import type { FrozenCheckoutPreview } from './checkout-preview.mts';
import { subjectHash } from './data-guards.mts';
import type { GrantRef } from './delegated-receipt-binding.mts';
import { COMMAND_PROFILE, encodeDelegatedCommand } from '../adapters/delegated-commands/command-codec.mts';
import type { EncodedDelegatedCommand, StartUseCommand } from '../adapters/delegated-commands/command-codec.mts';

export type CheckoutStartRequest = Readonly<{ command_id: string; preview_id: string }>;
export type CheckoutStartConfiguration = Readonly<{ grant: GrantRef }>;
export type CheckoutStartBinding = Readonly<{
  preview_id: string; preview_digest: string;
  encoded: EncodedDelegatedCommand & Readonly<{ request: StartUseCommand }>;
}>;
type StartCode = 'CHECKOUT_START_CONFIG_INVALID' | 'CHECKOUT_START_INPUT_INVALID'
  | 'CHECKOUT_START_UNAVAILABLE' | 'CHECKOUT_START_CURRENT_INVALID' | 'CHECKOUT_START_PROVENANCE_INVALID';
export class DelegatedCheckoutStartDenied extends Error {
  readonly code: StartCode;
  constructor(code: StartCode) { super(code); this.name = 'DelegatedCheckoutStartDenied'; this.code = code; }
}
function fail(code: StartCode): never { throw new DelegatedCheckoutStartDenied(code); }

function encodeStart(commandId: string, grant: GrantRef,
  preview: Pick<FrozenCheckoutPreview, 'resource_id' | 'store_id' | 'preview_digest'>): CheckoutStartBinding['encoded'] {
  // RCG4BC3-FULL-PREVIEW-DIGEST: the sole native request-digest derivation.
  const requestDigest = 'sha256:' + preview.preview_digest;
  const encoded = encodeDelegatedCommand({ profile: COMMAND_PROFILE, command: 'START_USE', command_id: commandId,
    grant, operation: { action: 'urn:rifare:action:purchase:v1', resource_id: 'urn:rifare:resource:' + preview.resource_id,
      audience: 'urn:rifare:store:' + preview.store_id, request_profile: 'urn:rifare:checkout-preview:v1',
      request_digest: requestDigest } });
  return encoded as CheckoutStartBinding['encoded'];
}

/** Synchronous native construction only. Grant and provider authority remain
 * unverified; a binding cannot authorize sending, final use or a commerce effect.
 * The native owner retains previews. This source retains only weak provenance. */
export class DelegatedCheckoutStarts {
  readonly #kernel: CommerceKernel;
  readonly #current: CheckoutPreviews['current'];
  readonly #grant: GrantRef;
  readonly #bindings = new WeakMap<CheckoutStartBinding, { scope: Scope; preview: FrozenCheckoutPreview }>();
  #closed = false;

  constructor(kernel: CommerceKernel, previews: CheckoutPreviews, input: CheckoutStartConfiguration) {
    try {
      // Invoke concrete methods directly: forged prototypes/proxies fail their
      // private brands, and an instance override cannot supply purchase facts.
      if (!(previews instanceof CheckoutPreviews) || !CheckoutPreviews.prototype.boundTo.call(previews, kernel))
        fail('CHECKOUT_START_CONFIG_INVALID');
      this.#kernel = kernel; this.#current = CheckoutPreviews.prototype.current.bind(previews);
      const config = checkoutSnapshot(input); exact(config, ['grant']);
      // Pure C1 schema validation only. This discarded template is never a
      // native binding or a claimed command and produces no database work.
      this.#grant = encodeStart('00000000-0000-4000-8000-000000000001', config.grant,
        { resource_id: 'configuration', store_id: 'configuration', preview_digest: '0'.repeat(64) }).request.grant;
    } catch { fail('CHECKOUT_START_CONFIG_INVALID'); }
  }
  /** Owner identity is independent of access and confers no customer permission. */
  boundTo(kernel: CommerceKernel): boolean { return this.#kernel === kernel; }
  close(): void { this.#closed = true; }
  #available(): void { if (this.#closed) fail('CHECKOUT_START_UNAVAILABLE'); }
  #preview(scope: Scope, previewId: string): FrozenCheckoutPreview {
    this.#available();
    let preview: FrozenCheckoutPreview;
    try { preview = this.#current(scope, previewId); }
    catch { fail('CHECKOUT_START_CURRENT_INVALID'); }
    // Native callbacks may close this source while the preview remains valid.
    this.#available();
    // Held erasure preserves readable source data, not permission for new use.
    // Its original-subject event survives hold release/expiry. A plain hold does
    // not block construction. Only inert reads follow the native callbacks.
    try {
      if (this.#kernel.db.prepare(`SELECT 1 FROM commerce_privacy_events
        WHERE tenant_id=? AND store_id=? AND subject_hash=? AND event='erasure_held' LIMIT 1`)
        .get(preview.tenant_id, preview.store_id, subjectHash(preview.tenant_id, preview.store_id, preview.customer_id)))
        fail('CHECKOUT_START_CURRENT_INVALID');
    } catch { fail('CHECKOUT_START_CURRENT_INVALID'); }
    return preview;
  }

  prepare(scope: Scope, input: CheckoutStartRequest): CheckoutStartBinding {
    this.#available();
    let request: CheckoutStartRequest;
    try { request = checkoutSnapshot(input); exact(request, ['command_id','preview_id']); id(request.preview_id); }
    catch { fail('CHECKOUT_START_INPUT_INVALID'); }
    const preview = this.#preview(scope, request.preview_id);
    let encoded: CheckoutStartBinding['encoded'];
    try { encoded = encodeStart(request.command_id, this.#grant, preview); }
    catch { fail('CHECKOUT_START_INPUT_INVALID'); }
    const binding = checkoutSnapshot({ preview_id: preview.preview_id, preview_digest: preview.preview_digest, encoded });
    this.#bindings.set(binding, { scope, preview }); return binding;
  }

  /** Currentness is checked afresh, never restored from caller or journal JSON. */
  assertCurrent(scope: Scope, binding: CheckoutStartBinding): void {
    this.#available();
    const original = this.#bindings.get(binding);
    if (!original || original.scope !== scope) fail('CHECKOUT_START_PROVENANCE_INVALID');
    const current = this.#preview(scope, original.preview.preview_id);
    if (current !== original.preview || current.preview_id !== binding.preview_id ||
      current.preview_digest !== binding.preview_digest) fail('CHECKOUT_START_CURRENT_INVALID');
  }
}
