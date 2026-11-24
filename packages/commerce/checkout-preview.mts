/** Immutable protocol values and a pure ceiling precheck. Pricing belongs to Medusa. */
import { jsonValue } from './configuration-values.mts';

export type CheckoutQuote = Readonly<{
  quote_id: string;
  source_identity: string;
  source_revision: string;
  amount_minor: string;
  currency: string;
  explicit_zero: boolean;
}>;

export type CheckoutPreviewItem = Readonly<{
  variant_id: string;
  product_id: string;
  quantity: number;
  unit_minor: string;
  tax_minor: string;
  line_total_minor: string;
  currency: string;
  source_revision: string;
  terms_digest: string;
}>;

export type FrozenCheckoutPreview = Readonly<{
  schema_version: 1;
  preview_id: string;
  tenant_id: string;
  store_id: string;
  merchant_id: string;
  resource_id: string;
  customer_id: string;
  cart_id: string;
  cart_operation_id: string;
  cart_preview_digest: string;
  currency: string;
  items: readonly CheckoutPreviewItem[];
  subtotal_minor: string;
  tax_minor: string;
  shipping_minor: string;
  fees_minor: string;
  total_payable_minor: string;
  pricing_source_identity: string;
  pricing_source_revision: string;
  shipping_quote: CheckoutQuote;
  fee_quote: CheckoutQuote;
  terms_digest: string;
  created_at: number;
  expires_at: number;
  preview_digest: string;
  qualification: 'synthetic_only';
}>;

const MINOR = /^(0|[1-9][0-9]{0,23})$/;
const CURRENCY = /^[A-Z]{3}$/;
const MAX_MINOR = (10n ** 24n) - 1n;

export class CheckoutPreviewDenied extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = 'CheckoutPreviewDenied';
  }
}

function deny(code: string): never { throw new CheckoutPreviewDenied(code); }
function requireMatch(condition: boolean, code: string): void { if (!condition) deny(code); }
function minor(value: unknown): bigint {
  if (typeof value !== 'string' || !MINOR.test(value)) deny('CHECKOUT_SOURCE_INVALID');
  const amount = BigInt(value as string);
  if (amount > MAX_MINOR) deny('CHECKOUT_AMOUNT_OUT_OF_RANGE');
  return amount;
}
function copy<T>(value: T): T {
  // jsonValue owns Rifare's canonical JSON rules. Check array descriptors first:
  // its ordinary array traversal must never invoke an accessor or custom map.
  let visited = 0;
  function descriptors(input: unknown, depth = 0): void {
    requireMatch(depth <= 16 && ++visited <= 32768, 'CHECKOUT_DATA_INVALID');
    if (!input || typeof input !== 'object') return;
    const keys = Reflect.ownKeys(input);
    if (Array.isArray(input)) {
      requireMatch(Object.getPrototypeOf(input) === Array.prototype &&
        keys.length === input.length + 1, 'CHECKOUT_DATA_INVALID');
    }
    for (const key of keys) {
      requireMatch(typeof key === 'string', 'CHECKOUT_DATA_INVALID');
      const descriptor = Object.getOwnPropertyDescriptor(input,key)!;
      requireMatch(Object.hasOwn(descriptor,'value'), 'CHECKOUT_DATA_INVALID');
      if (Array.isArray(input) && key === 'length') continue;
      requireMatch(descriptor.enumerable === true && (!Array.isArray(input) ||
        (/^(0|[1-9][0-9]*)$/.test(key as string)&&Number(key)<input.length)), 'CHECKOUT_DATA_INVALID');
      descriptors(descriptor.value,depth+1);
    }
  }
  descriptors(value);
  return jsonValue(value) as T;
}
function freeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}
/** A bounded, detached native JSON snapshot; no retained caller object aliases. */
export function checkoutSnapshot<T>(value:T):Readonly<T> { return freeze(copy(value)); }
/** Pure amount ceiling precheck. This is NOT delegated authorization or a permit. */
export function withinDelegatedCeiling(preview: FrozenCheckoutPreview,
                                       currency: string, maximum_minor: string): boolean {
  requireMatch(typeof currency === 'string' && CURRENCY.test(currency) &&
    preview.currency === currency, 'CHECKOUT_CURRENCY_MISMATCH');
  return minor(preview.total_payable_minor) <= minor(maximum_minor);
}
