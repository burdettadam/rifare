import { readFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { strictReceiptJson } from '../adapters/delegated-receipts/strict-json.mts';
import { exact, id } from './kernel.mts';
import type { CommerceKernel, Scope } from './kernel.mts';
import { growthCustomer } from './growth-shopping-core.mts';
import { CheckoutPreviews } from './checkout-previews.mts';
import { CheckoutPreviewDenied } from './checkout-preview.mts';
import { DelegatedCheckoutReceipts } from './delegated-checkout-receipts.mts';
import { ReceiptBindingDenied } from './delegated-receipt-binding.mts';
import { DelegatedCheckoutIntents } from './delegated-checkout-intents.mts';

export const CHECKOUT_RECEIPT_BODY_BYTES = 102400;
export const CHECKOUT_HTTP_OPERATIONS = Object.freeze([
  'preview', 'preview-status', 'prepare', 'status', 'receipt', 'cancel',
] as const);
export type CheckoutHttpOperation = typeof CHECKOUT_HTTP_OPERATIONS[number];
type Owners = Readonly<{ previews?: CheckoutPreviews; receipts?: DelegatedCheckoutReceipts }>;

const contract = JSON.parse(readFileSync(new URL('./contracts/delegated-checkout-api.v1.json', import.meta.url), 'utf8'));
const recoveryContract = JSON.parse(readFileSync(new URL('./contracts/delegated-checkout-recovery.v1.json', import.meta.url), 'utf8'));
const forbidden = new Set(['ACCESS_DENIED', 'CUSTOMER_VERIFICATION_REQUIRED', 'SUBJECT_ERASED']);
const unavailable = new Set(['CHECKOUT_UNAVAILABLE', 'CHECKOUT_QUOTE_UNAVAILABLE', 'RECEIPT_UNAVAILABLE',
  'RECEIPT_CONTEXT_UNAVAILABLE', 'SHOPPING_SOURCE_UNAVAILABLE']);
const capacity = new Set(['CHECKOUT_PREVIEW_CAPACITY', 'RECEIPT_VERIFICATION_CAPACITY', 'INTENT_ROW_LIMIT']);
const conflicts = new Set(['INTENT_BINDING_CONFLICT', 'INTENT_CHALLENGE_CONFLICT', 'INTENT_RECEIPT_CONFLICT',
  'INTENT_RECEIPT_REUSED', 'INTENT_REVISION_CONFLICT', 'INTENT_REVOKED', 'INTENT_EXPIRED', 'INTENT_CLOCK_INVALID',
  'CHECKOUT_CLOCK_INVALID', 'CHECKOUT_PREVIEW_EXPIRED', 'SHOPPING_CART_CONFLICT', 'SHOPPING_CART_MISMATCH',
  'SHOPPING_PREVIEW_CHANGED', 'SHOPPING_RECONCILIATION_REQUIRED', 'SHOPPING_SOURCE_CHANGED',
  'RESTORE_EGRESS_BLOCKED', 'RESTORE_WRITE_BLOCKED']);
const invalid = new Set(['INVALID_INPUT', 'INVALID_JSON', 'RECEIPT_COMPACT_INVALID', 'SHOPPING_ORDER_REQUIRED',
  'SHOPPING_ITEM_UNSUPPORTED', 'SHOPPING_SOURCE_SCOPE_MISMATCH']);

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
  readonly #previews: CheckoutPreviews | undefined;
  readonly #preparePreview: CheckoutPreviews['prepare'] | undefined;
  readonly #readPreview: CheckoutPreviews['read'] | undefined;
  readonly #intents: DelegatedCheckoutIntents;

  constructor(kernel: CommerceKernel, owners: Owners = {}) {
    if (!owners || typeof owners !== 'object' || Reflect.ownKeys(owners).some(k => k !== 'previews' && k !== 'receipts') ||
      (owners.previews !== undefined && (!(owners.previews instanceof CheckoutPreviews) || !owners.previews.boundTo(kernel))) ||
      (owners.receipts !== undefined && (!(owners.receipts instanceof DelegatedCheckoutReceipts) || !owners.receipts.boundTo(kernel))))
      throw new Error('CHECKOUT_CONFIG_INVALID');
    this.#kernel = kernel; this.#previews = owners.previews;
    this.#preparePreview = owners.previews?.prepare.bind(owners.previews);
    this.#readPreview = owners.previews?.read.bind(owners.previews);
    this.#intents = new DelegatedCheckoutIntents(kernel, owners.receipts);
  }
  boundTo(kernel: CommerceKernel): boolean { return this.#kernel === kernel; }

  /** Invoke before collecting a receipt body; native owners repeat checks after collection/await. */
  authorize(scope: Scope): void {
    const session = this.#kernel.require(scope);
    if (session.role !== 'customer') throw new Error('NOT_FOUND');
    growthCustomer(this.#kernel, scope, session.resource_id, session.customer_id);
  }
  #envelope(operation: string, result: unknown) {
    return { profile: 'commerce-sqlite-diagnostic', qualification: 'candidate_contract_only',
      evidence_status: 'historical_observation', execution_authorized: false, operation, result } as const;
  }
  contract(scope: Scope) {
    this.authorize(scope);
    return this.#envelope('contract', structuredClone(contract));
  }
  recoveryContract(scope: Scope) {
    this.authorize(scope);
    return this.#envelope('recovery-contract', structuredClone(recoveryContract));
  }
  lookup(scope: Scope, input: unknown) {
    this.authorize(scope);
    const p = exact(input, ['preview_id', 'context_id']);
    const original = Object.freeze({ preview_id: id(p.preview_id), context_id: id(p.context_id) });
    const intent = this.#intents.lookup(scope, original);
    return this.#envelope('lookup', { original, intent });
  }
  async post(scope: Scope, operation: CheckoutHttpOperation, input: unknown) {
    this.authorize(scope);
    let result: unknown;
    switch (operation) {
      case 'preview': {
        const p = exact(input, ['cart_id', 'shipping_quote_id', 'fee_quote_id']);
        if (!this.#previews?.available || !this.#preparePreview) throw new Error('CHECKOUT_UNAVAILABLE');
        result = await this.#preparePreview(scope, { cart_id: id(p.cart_id),
          shipping_quote_id: id(p.shipping_quote_id), fee_quote_id: id(p.fee_quote_id) });
        break;
      }
      case 'preview-status': {
        const p = exact(input, ['preview_id']);
        if (!this.#previews?.available || !this.#readPreview) throw new Error('CHECKOUT_UNAVAILABLE');
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
}
