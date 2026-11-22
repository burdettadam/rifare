import { readFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { strictReceiptJson } from '../adapters/delegated-receipts/strict-json.mts';
import { exact, id, integer } from './kernel.mts';
import type { CommerceKernel, Scope } from './kernel.mts';
import { growthCustomer } from './growth-shopping-core.mts';
import { CheckoutPreviews } from './checkout-previews.mts';
import { CheckoutPreviewDenied, checkoutSnapshot } from './checkout-preview.mts';
import { DelegatedCheckoutReceipts } from './delegated-checkout-receipts.mts';
import { ReceiptBindingDenied } from './delegated-receipt-binding.mts';
import { DelegatedCheckoutIntents } from './delegated-checkout-intents.mts';
import { DelegatedCommandClaims, CommandClaimDenied } from './delegated-command-claims.mts';
import type { CommandCorrelation } from './delegated-command-claims.mts';
import { commandClaimUuid } from './delegated-command-claim-records.mts';
import type { DelegatedCheckoutStarts } from './delegated-checkout-starts.mts';

export const CHECKOUT_RECEIPT_BODY_BYTES = 102400;
export const CHECKOUT_HTTP_OPERATIONS = Object.freeze([
  'preview', 'preview-status', 'prepare', 'status', 'receipt', 'cancel',
] as const);
export type CheckoutHttpOperation = typeof CHECKOUT_HTTP_OPERATIONS[number];
export const CHECKOUT_COMMAND_HTTP_OPERATIONS = Object.freeze(['start', 'status', 'recovery', 'cancel'] as const);
export type CheckoutCommandHttpOperation = typeof CHECKOUT_COMMAND_HTTP_OPERATIONS[number];
type Owners = Readonly<{ previews?: CheckoutPreviews; receipts?: DelegatedCheckoutReceipts;
  commands?: Readonly<{ correlation: CommandCorrelation; starts?: DelegatedCheckoutStarts }> }>;

const contract = JSON.parse(readFileSync(new URL('./contracts/delegated-checkout-api.v1.json', import.meta.url), 'utf8'));
const recoveryContract = JSON.parse(readFileSync(new URL('./contracts/delegated-checkout-recovery.v1.json', import.meta.url), 'utf8'));
const commandsContract = JSON.parse(readFileSync(new URL('./contracts/delegated-checkout-commands.v1.json', import.meta.url), 'utf8'));
const forbidden = new Set(['ACCESS_DENIED', 'CUSTOMER_VERIFICATION_REQUIRED', 'SUBJECT_ERASED']);
const unavailable = new Set(['CHECKOUT_UNAVAILABLE', 'CHECKOUT_QUOTE_UNAVAILABLE', 'RECEIPT_UNAVAILABLE',
  'RECEIPT_CONTEXT_UNAVAILABLE', 'SHOPPING_SOURCE_UNAVAILABLE', 'CHECKOUT_COMMANDS_UNAVAILABLE', 'CHECKOUT_COMMAND_START_UNAVAILABLE']);
const capacity = new Set(['CHECKOUT_PREVIEW_CAPACITY', 'RECEIPT_VERIFICATION_CAPACITY', 'INTENT_ROW_LIMIT']);
const conflicts = new Set(['INTENT_BINDING_CONFLICT', 'INTENT_CHALLENGE_CONFLICT', 'INTENT_RECEIPT_CONFLICT',
  'INTENT_RECEIPT_REUSED', 'INTENT_REVISION_CONFLICT', 'INTENT_REVOKED', 'INTENT_EXPIRED', 'INTENT_CLOCK_INVALID',
  'CHECKOUT_CLOCK_INVALID', 'CHECKOUT_PREVIEW_EXPIRED', 'SHOPPING_CART_CONFLICT', 'SHOPPING_CART_MISMATCH',
  'SHOPPING_PREVIEW_CHANGED', 'SHOPPING_RECONCILIATION_REQUIRED', 'SHOPPING_SOURCE_CHANGED',
  'RESTORE_EGRESS_BLOCKED', 'RESTORE_WRITE_BLOCKED']);
const invalid = new Set(['INVALID_INPUT', 'INVALID_JSON', 'RECEIPT_COMPACT_INVALID', 'SHOPPING_ORDER_REQUIRED',
  'SHOPPING_ITEM_UNSUPPORTED', 'SHOPPING_SOURCE_SCOPE_MISMATCH']);
const commandConflicts = new Set(['COMMAND_CLAIM_BINDING_INVALID', 'COMMAND_CLAIM_CONFLICT',
  'COMMAND_CLAIM_CHALLENGE_CONFLICT', 'COMMAND_CLAIM_REVISION_CONFLICT', 'COMMAND_CLAIM_RETIRED',
  'COMMAND_CLAIM_TRANSACTION_OWNERSHIP', 'COMMAND_CLAIM_CLOCK_INVALID']);

/** Configuration containers hold concrete owners, so snapshot their data slots
 * rather than traversing the owners or invoking getters/inherited selections. */
function ownerFields(input: unknown, allowed: readonly string[], required: readonly string[] = []): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input) ||
    ![Object.prototype,null].includes(Object.getPrototypeOf(input))) throw new Error('CHECKOUT_CONFIG_INVALID');
  const descriptors = Object.getOwnPropertyDescriptors(input), result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || !allowed.includes(key)) throw new Error('CHECKOUT_CONFIG_INVALID');
    const descriptor = descriptors[key];
    if (!descriptor.enumerable || !Object.hasOwn(descriptor,'value')) throw new Error('CHECKOUT_CONFIG_INVALID');
    result[key] = descriptor.value;
  }
  if (required.some(key => !Object.hasOwn(result,key))) throw new Error('CHECKOUT_CONFIG_INVALID');
  return result;
}

/** The separate recovery contract rejects duplicate/ambiguous JSON before native lookup. */
export async function checkoutRecoveryBody(req: IncomingMessage): Promise<unknown> {
  if (req.headers['content-type'] !== 'application/json') throw new Error('JSON_REQUIRED');
  if (Number(req.headers['content-length'] ?? 0) > 4096) { req.resume(); throw new Error('BODY_TOO_LARGE'); }
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 4096) { req.resume(); throw new Error('BODY_TOO_LARGE'); }
    chunks.push(bytes);
  }
  try { return strictReceiptJson(Buffer.concat(chunks), 4096); }
  catch { throw new Error('INVALID_JSON'); }
}

/** Deliberately finite transport mapping; arbitrary error text never reaches a caller/log. */
export function checkoutHttpFailure(error: unknown): { status: number; error: string } {
  const code = error instanceof Error ? error.message : '';
  if (error instanceof CommandClaimDenied) {
    if (code === 'COMMAND_CLAIM_NOT_FOUND') return { status: 404, error: 'NOT_FOUND' };
    if (code === 'COMMAND_CLAIM_ACCESS_DENIED') return { status: 403, error: code };
    if (code === 'COMMAND_CLAIM_INPUT_INVALID') return { status: 400, error: code };
    if (code === 'COMMAND_CLAIM_CONFIG_INVALID') return { status: 503, error: 'CHECKOUT_COMMANDS_UNAVAILABLE' };
    if (code === 'COMMAND_CLAIM_ROW_LIMIT') return { status: 429, error: code };
    if (commandConflicts.has(code)) return { status: 409, error: code };
    if (code === 'COMMAND_CLAIM_INTEGRITY' || code === 'COMMAND_CLAIM_STORAGE_UNAVAILABLE') return { status: 500, error: code };
    return { status: 500, error: 'INTERNAL_ERROR' };
  }
  if (forbidden.has(code)) return { status: 403, error: code };
  if (code === 'NOT_FOUND' || code === 'RESOURCE_DENIED') return { status: 404, error: 'NOT_FOUND' };
  if (code === 'BODY_TOO_LARGE') return { status: 413, error: code };
  if (code === 'JSON_REQUIRED') return { status: 415, error: code };
  if (unavailable.has(code)) return { status: 503, error: code };
  if (capacity.has(code)) return { status: 429, error: code };
  if (conflicts.has(code)) return { status: 409, error: code };
  if (invalid.has(code)) return { status: 400, error: code };
  if (error instanceof ReceiptBindingDenied) return { status: 400, error: 'RECEIPT_REJECTED' };
  if (error instanceof CheckoutPreviewDenied) return { status: 400, error: 'CHECKOUT_REJECTED' };
  return { status: 500, error: 'INTERNAL_ERROR' };
}

/** Local application composition. Configuration is server-owned and never an HTTP input. */
export class DelegatedCheckoutApi {
  readonly #kernel: CommerceKernel;
  readonly #preparePreview: CheckoutPreviews['prepare'] | undefined;
  readonly #readPreview: CheckoutPreviews['revalidate'] | undefined;
  readonly #previewAvailable: (() => boolean) | undefined;
  readonly #intents: DelegatedCheckoutIntents;
  readonly #commands: DelegatedCommandClaims | undefined;
  readonly #canStart: boolean;

  constructor(kernel: CommerceKernel, owners: Owners = {}) {
    try {
      const selected = ownerFields(owners,['previews','receipts','commands']);
      const previews = selected.previews as CheckoutPreviews | undefined;
      const receipts = selected.receipts as DelegatedCheckoutReceipts | undefined;
      if ((previews !== undefined && (!(previews instanceof CheckoutPreviews) || !CheckoutPreviews.prototype.boundTo.call(previews,kernel))) ||
        (receipts !== undefined && (!(receipts instanceof DelegatedCheckoutReceipts) || !DelegatedCheckoutReceipts.prototype.boundTo.call(receipts,kernel))))
        throw new Error('CHECKOUT_CONFIG_INVALID');
      this.#kernel = kernel;
      this.#preparePreview = previews === undefined ? undefined : CheckoutPreviews.prototype.prepare.bind(previews);
      // The public read alias dispatches through this.revalidate; capture the concrete owner directly.
      this.#readPreview = previews === undefined ? undefined : CheckoutPreviews.prototype.revalidate.bind(previews);
      this.#previewAvailable = previews === undefined ? undefined
        : Object.getOwnPropertyDescriptor(CheckoutPreviews.prototype,'available')!.get!.bind(previews);
      this.#intents = new DelegatedCheckoutIntents(kernel,receipts);
      this.#canStart = false;
      if (selected.commands !== undefined) {
        const commands = ownerFields(selected.commands,['correlation','starts'],['correlation']);
        this.#commands = new DelegatedCommandClaims(kernel,commands.correlation as CommandCorrelation,
          commands.starts as DelegatedCheckoutStarts | undefined);
        this.#canStart = commands.starts !== undefined;
      }
    } catch { throw new Error('CHECKOUT_CONFIG_INVALID'); }
  }
  boundTo(kernel: CommerceKernel): boolean { return this.#kernel === kernel; }

  /** Invoke before collecting a receipt body; native owners repeat checks after collection/await. */
  authorize(scope: Scope): void { this.#authorize(scope); }
  #authorize(scope: Scope): void {
    const session = this.#kernel.require(scope);
    if (session.role !== 'customer') throw new Error('NOT_FOUND');
    growthCustomer(this.#kernel, scope, session.resource_id, session.customer_id);
  }
  #envelope(operation: string, result: unknown) {
    return { profile: 'commerce-sqlite-diagnostic', qualification: 'candidate_contract_only',
      evidence_status: 'historical_observation', execution_authorized: false, operation, result } as const;
  }
  contract(scope: Scope) {
    this.#authorize(scope);
    return this.#envelope('contract', structuredClone(contract));
  }
  recoveryContract(scope: Scope) {
    this.#authorize(scope);
    return this.#envelope('recovery-contract', structuredClone(recoveryContract));
  }
  lookup(scope: Scope, input: unknown) {
    this.#authorize(scope);
    const p = exact(input, ['preview_id', 'context_id']);
    const original = Object.freeze({ preview_id: id(p.preview_id), context_id: id(p.context_id) });
    const intent = this.#intents.lookup(scope, original);
    return this.#envelope('lookup', { original, intent });
  }
  async post(scope: Scope, operation: CheckoutHttpOperation, input: unknown) {
    this.#authorize(scope);
    let result: unknown;
    switch (operation) {
      case 'preview': {
        const p = exact(input, ['cart_id', 'shipping_quote_id', 'fee_quote_id']);
        if (!this.#previewAvailable?.() || !this.#preparePreview) throw new Error('CHECKOUT_UNAVAILABLE');
        result = await this.#preparePreview(scope, { cart_id: id(p.cart_id),
          shipping_quote_id: id(p.shipping_quote_id), fee_quote_id: id(p.fee_quote_id) });
        break;
      }
      case 'preview-status': {
        const p = exact(input, ['preview_id']);
        if (!this.#previewAvailable?.() || !this.#readPreview) throw new Error('CHECKOUT_UNAVAILABLE');
        result = await this.#readPreview(scope, id(p.preview_id)); break;
      }
      case 'prepare': {
        const p = exact(input, ['preview_id', 'context_id']);
        result = this.#intents.prepare(scope, { preview_id: id(p.preview_id), context_id: id(p.context_id) }); break;
      }
      case 'status': result = this.#intents.read(scope, id(exact(input, ['intent_id']).intent_id)); break;
      case 'receipt': {
        const p = exact(input, ['intent_id', 'compact_jws']);
        result = await this.#intents.verifyReceipt(scope, { intent_id: id(p.intent_id), compact_jws: p.compact_jws }); break;
      }
      case 'cancel': {
        const p = exact(input, ['intent_id', 'expected_revision']);
        result = this.#intents.cancel(scope, { intent_id: id(p.intent_id), expected_revision: p.expected_revision }); break;
      }
      default: throw new Error('NOT_FOUND');
    }
    return this.#envelope(operation, result);
  }

  commandsContract(scope: Scope) {
    this.#authorize(scope); return this.#envelope('command-contract',structuredClone(commandsContract));
  }
  postCommand(scope: Scope, operation: CheckoutCommandHttpOperation, input: unknown) {
    // Preserve C2's refusal before authorization can update session last_seen.
    if ((operation === 'start' || operation === 'cancel') && this.#kernel.db.isTransaction)
      throw new CommandClaimDenied('COMMAND_CLAIM_TRANSACTION_OWNERSHIP');
    this.#authorize(scope);
    if (!this.#commands) throw new Error('CHECKOUT_COMMANDS_UNAVAILABLE');
    let value: unknown;
    try { value = checkoutSnapshot(input); } catch { throw new Error('INVALID_INPUT'); }
    let result: unknown;
    switch (operation) {
      case 'start': {
        const p = exact(value,['command_id','preview_id']); commandClaimUuid(p.command_id); id(p.preview_id);
        if (!this.#canStart) throw new Error('CHECKOUT_COMMAND_START_UNAVAILABLE');
        result = this.#commands.claimCheckoutStart(scope,{ command_id: p.command_id, preview_id: p.preview_id }); break;
      }
      case 'status': {
        const p = exact(value,['command_id']); commandClaimUuid(p.command_id);
        result = this.#commands.read(scope,p.command_id); break;
      }
      case 'recovery': {
        const p = exact(value,['command_id']); commandClaimUuid(p.command_id);
        result = this.#commands.recovery(scope,p.command_id); break;
      }
      case 'cancel': {
        const p = exact(value,['command_id','expected_revision']); commandClaimUuid(p.command_id); integer(p.expected_revision,1);
        result = this.#commands.cancel(scope,{ command_id: p.command_id, expected_revision: p.expected_revision }); break;
      }
      default: throw new Error('NOT_FOUND');
    }
    return this.#envelope('command-' + operation,result);
  }
}
