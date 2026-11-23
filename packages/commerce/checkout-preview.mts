/**
 * Source-backed synthetic checkout composition. CheckoutPreviews supplies native
 * authority, scoped lookup and original snapshot ownership. This helper alone
 * cannot establish that a caller supplied the original authorized snapshot.
 * No checkout, payment, authorization receipt or provider transport is executed.
 */
import { jsonValue } from './configuration-values.mts';

export type CheckoutQuote = Readonly<{
  quote_id: string;
  source_identity: string;
  source_revision: string;
  amount_minor: string;
  currency: string;
  explicit_zero: boolean;
}>;

export type CheckoutItemSource = Readonly<{
  variant_id: string;
  product_id: string;
  quantity: number;
  unit_minor: string;
  tax_minor: string;
  total_minor: string;
  currency: string;
  source_revision: string;
  terms: unknown;
}>;

export type CheckoutCartSource = Readonly<{
  cart_id: string;
  resource_id: string;
  subject_id: string;
  operation_id: string;
  preview_digest: string;
  state: string;
  status: string;
  committed: boolean;
  native_id: string | null;
  qualification: string;
}>;

/** Fields correspond to ShoppingCart.currentPreview's existing local contract. */
export type CurrentCartPreviewSource = Readonly<{
  cart_id: string;
  resource_id: string;
  subject_id: string;
  source_identity: string;
  currency: string;
  items: readonly CheckoutItemSource[];
  total_minor: string;
  catalog_digest: string;
  preview_digest: string;
  stored_preview_digest: string;
  requires_new_proposal: boolean;
  committed: boolean;
  state: string;
  checkout_supported: false;
  payment_authorized: false;
  qualification: 'synthetic_only';
}>;

/** All IDs and observations in this value must be produced by trusted server owners. */
export type TrustedCheckoutObservation = Readonly<{
  tenant_id: string;
  store_id: string;
  merchant_id: string;
  resource_id: string;
  customer_id: string;
  cart: CheckoutCartSource;
  current: CurrentCartPreviewSource;
  shipping_quote: CheckoutQuote | null;
  fee_quote: CheckoutQuote | null;
  /** Earliest validity deadline from the server-owned shipping and fee sources. */
  valid_until: number;
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

export type CheckoutPreviewRequest = Readonly<{
  cart_id: string;
  shipping_quote_id: string;
  fee_quote_id: string;
}>;

export interface CheckoutPreviewSource<Scope> {
  /**
   * Trusted adapter must enforce tenant/store/resource access and current
   * customer/merchant authority on EVERY call; never trust client identity.
   * Use ShoppingCart.readCart/currentPreview, not a new pricing/catalog engine.
   * Missing/stale source quote => null; NEVER manufacture a zero quote.
   */
  observe(scope: Scope, request: CheckoutPreviewRequest):
    Promise<TrustedCheckoutObservation> | TrustedCheckoutObservation;
}

export type CheckoutPreviewDependencies<Scope> = Readonly<{
  source: CheckoutPreviewSource<Scope>;
  /** Supply Rifare's existing contentDigest; do not introduce a second hasher. */
  contentDigest(value: unknown): string;
  now(): number;
  createId(): string;
  lifetime_ms: number;
}>;

const IDENTIFIER = /^[A-Za-z0-9_-]{1,96}$/;
const DIGEST = /^[a-f0-9]{64}$/;
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
function identifier(value: unknown): string {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) deny('CHECKOUT_SOURCE_INVALID');
  return value as string;
}
function digest(value: unknown): string {
  if (typeof value !== 'string' || !DIGEST.test(value)) deny('CHECKOUT_SOURCE_INVALID');
  return value as string;
}
function minor(value: unknown): bigint {
  if (typeof value !== 'string' || !MINOR.test(value)) deny('CHECKOUT_SOURCE_INVALID');
  const amount = BigInt(value as string);
  if (amount > MAX_MINOR) deny('CHECKOUT_AMOUNT_OUT_OF_RANGE');
  return amount;
}
function total(...parts: bigint[]): bigint {
  const amount = parts.reduce((a,b)=>a+b,0n);
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
function quote(value: CheckoutQuote | null, id: string, currency: string): CheckoutQuote {
  if (!value) deny('CHECKOUT_QUOTE_UNAVAILABLE');
  const q = value as CheckoutQuote;
  requireMatch(q && typeof q === 'object' && !Array.isArray(q) &&
    Object.keys(q).sort().join(',') === 'amount_minor,currency,explicit_zero,quote_id,source_identity,source_revision',
    'CHECKOUT_QUOTE_INVALID');
  requireMatch(identifier(q.quote_id) === id && !!identifier(q.source_identity) &&
    !!identifier(q.source_revision), 'CHECKOUT_QUOTE_CHANGED');
  requireMatch(typeof q.currency === 'string' && CURRENCY.test(q.currency) &&
    q.currency === currency, 'CHECKOUT_CURRENCY_MISMATCH');
  const n = minor(q.amount_minor);
  requireMatch(typeof q.explicit_zero === 'boolean' && q.explicit_zero === (n === 0n),
    'CHECKOUT_QUOTE_INVALID');
  return copy(q);
}
function validatedLines(lines: readonly CheckoutItemSource[], currency: string,
                        contentDigest: (value: unknown)=>string): {
  items: CheckoutPreviewItem[]; subtotal: bigint; tax: bigint;
} {
  requireMatch(Array.isArray(lines) && lines.length > 0 && lines.length <= 30,
    'CHECKOUT_SOURCE_INVALID');
  const seen = new Set<string>();
  let subtotal = 0n, tax = 0n;
  const items: CheckoutPreviewItem[] = lines.map((line) => {
    const variant_id = identifier(line.variant_id), product_id = identifier(line.product_id);
    requireMatch(!seen.has(variant_id), 'CHECKOUT_SOURCE_INVALID');
    seen.add(variant_id);
    requireMatch(Number.isSafeInteger(line.quantity) && line.quantity >= 1 && line.quantity <= 20,
      'CHECKOUT_SOURCE_INVALID');
    requireMatch(line.currency === currency, 'CHECKOUT_CURRENCY_MISMATCH');
    const unit = minor(line.unit_minor), lineTax = minor(line.tax_minor), lineTotal = minor(line.total_minor);
    requireMatch(lineTotal === total(unit * BigInt(line.quantity), lineTax), 'CHECKOUT_SOURCE_INVALID');
    subtotal = total(subtotal, unit * BigInt(line.quantity));
    tax = total(tax, lineTax);
    const terms_digest = digest(contentDigest(line.terms));
    return {
      variant_id, product_id, quantity: line.quantity,
      unit_minor: unit.toString(), tax_minor: lineTax.toString(),
      line_total_minor: lineTotal.toString(), currency,
      source_revision: identifier(line.source_revision), terms_digest,
    };
  });
  // Source's item order is not a permission input; a stable canonical order is.
  items.sort((a,b) => a.variant_id < b.variant_id ? -1 : a.variant_id > b.variant_id ? 1 : 0);
  return {items, subtotal, tax};
}

function compose<Scope>(observation: TrustedCheckoutObservation, request: CheckoutPreviewRequest,
                        deps: CheckoutPreviewDependencies<Scope>, id: string, createdAt: number,
                        expiresAt: number): FrozenCheckoutPreview {
  const o = observation, cart = o.cart, current = o.current;
  for (const field of ['tenant_id','store_id','merchant_id','resource_id','customer_id'] as const)
    identifier(o[field]);
  requireMatch(cart && current && typeof cart === 'object' && typeof current === 'object',
    'CHECKOUT_CART_UNAVAILABLE');
  requireMatch(cart.cart_id === request.cart_id && current.cart_id === request.cart_id &&
    cart.resource_id === o.resource_id && current.resource_id === o.resource_id &&
    cart.subject_id === o.customer_id && current.subject_id === o.customer_id &&
    identifier(cart.operation_id) !== '', 'CHECKOUT_CART_CHANGED');
  requireMatch(cart.committed === true && cart.state === 'committed' && cart.status === 'active' &&
    current.committed === true && current.state === 'committed' &&
    current.requires_new_proposal === false && typeof cart.native_id === 'string' &&
    cart.native_id.length > 0, 'CHECKOUT_CART_NOT_ACTIVE');
  requireMatch(cart.qualification === 'synthetic_only' && current.qualification === 'synthetic_only' &&
    current.checkout_supported === false && current.payment_authorized === false,
    'CHECKOUT_SOURCE_INVALID');
  requireMatch(digest(cart.preview_digest) === digest(current.preview_digest) &&
    cart.preview_digest === current.stored_preview_digest,
    'CHECKOUT_CART_CHANGED');
  requireMatch(typeof current.currency === 'string' && CURRENCY.test(current.currency),
    'CHECKOUT_CURRENCY_MISMATCH');
  const pricing_source_identity = identifier(current.source_identity);
  const pricing_source_revision = digest(current.catalog_digest);
  const {items, subtotal, tax} = validatedLines(current.items, current.currency, deps.contentDigest);
  requireMatch(total(subtotal,tax) === minor(current.total_minor), 'CHECKOUT_SOURCE_INVALID');
  const shipping = quote(o.shipping_quote, request.shipping_quote_id, current.currency);
  const fee = quote(o.fee_quote, request.fee_quote_id, current.currency);
  const totalPayable = total(subtotal, tax, minor(shipping.amount_minor), minor(fee.amount_minor));
  const terms_digest = digest(deps.contentDigest(items.map(item=>({
    variant_id:item.variant_id, terms_digest:item.terms_digest
  }))));
  const fields = {
    schema_version: 1 as const, preview_id: identifier(id),
    tenant_id: o.tenant_id, store_id: o.store_id, merchant_id: o.merchant_id,
    resource_id: o.resource_id, customer_id: o.customer_id,
    cart_id: request.cart_id, cart_operation_id: cart.operation_id,
    cart_preview_digest: cart.preview_digest, currency: current.currency,
    items, subtotal_minor: subtotal.toString(), tax_minor: tax.toString(),
    shipping_minor: shipping.amount_minor, fees_minor: fee.amount_minor,
    total_payable_minor: totalPayable.toString(),
    pricing_source_identity, pricing_source_revision,
    shipping_quote: shipping, fee_quote: fee, terms_digest,
    created_at: createdAt, expires_at: expiresAt, qualification: 'synthetic_only' as const,
  };
  return freeze({...fields, preview_digest: digest(deps.contentDigest(fields))});
}

/** Pure amount ceiling precheck. This is NOT delegated authorization or a permit. */
export function withinDelegatedCeiling(preview: FrozenCheckoutPreview,
                                       currency: string, maximum_minor: string): boolean {
  requireMatch(typeof currency === 'string' && CURRENCY.test(currency) &&
    preview.currency === currency, 'CHECKOUT_CURRENCY_MISMATCH');
  return minor(preview.total_payable_minor) <= minor(maximum_minor);
}

/** No persistence or effects: caller owns durable state in Rifare. */
export class CheckoutPreviewComposer<Scope> {
  readonly #deps: CheckoutPreviewDependencies<Scope>;
  constructor(deps: CheckoutPreviewDependencies<Scope>) {
    requireMatch(Number.isSafeInteger(deps.lifetime_ms) && deps.lifetime_ms >= 1000 &&
      deps.lifetime_ms <= 600000, 'CHECKOUT_CONFIG_INVALID');
    requireMatch(typeof deps.source?.observe === 'function' && typeof deps.now === 'function' &&
      typeof deps.createId === 'function' && typeof deps.contentDigest === 'function',
      'CHECKOUT_CONFIG_INVALID');
    this.#deps = Object.freeze({
      source:Object.freeze({observe:deps.source.observe.bind(deps.source)}),
      contentDigest:deps.contentDigest.bind(deps),now:deps.now.bind(deps),
      createId:deps.createId.bind(deps),lifetime_ms:deps.lifetime_ms,
    });
  }

  private request(input: CheckoutPreviewRequest): CheckoutPreviewRequest {
    input = checkoutSnapshot(input);
    requireMatch(!!input && typeof input === 'object' && !Array.isArray(input) &&
      Object.keys(input).sort().join(',') === 'cart_id,fee_quote_id,shipping_quote_id',
      'CHECKOUT_REQUEST_INVALID');
    return Object.freeze({cart_id:identifier(input.cart_id),
      shipping_quote_id:identifier(input.shipping_quote_id),
      fee_quote_id:identifier(input.fee_quote_id)});
  }

  private time(previous=0, deadline=Number.MAX_SAFE_INTEGER):number {
    const now=this.#deps.now();
    requireMatch(Number.isSafeInteger(now) && now>=previous, 'CHECKOUT_CLOCK_INVALID');
    requireMatch(now<deadline, 'CHECKOUT_PREVIEW_EXPIRED');
    return now;
  }

  private validity(observation:TrustedCheckoutObservation,now:number):number {
    requireMatch(Number.isSafeInteger(observation.valid_until) && observation.valid_until>now,
      'CHECKOUT_QUOTE_UNAVAILABLE');
    return observation.valid_until;
  }

  /** Reads authoritative sources twice to fail closed on in-flight changes. */
  async prepare(scope: Scope, input: CheckoutPreviewRequest): Promise<FrozenCheckoutPreview> {
    const request = this.request(input);
    const createdAt = this.time(), maximumExpiry = createdAt + this.#deps.lifetime_ms;
    requireMatch(Number.isSafeInteger(maximumExpiry), 'CHECKOUT_CLOCK_INVALID');
    const id = identifier(this.#deps.createId());
    const initial=checkoutSnapshot(await this.#deps.source.observe(scope, request));
    const observedAt=this.time(createdAt,maximumExpiry);
    const expiresAt=Math.min(maximumExpiry,this.validity(initial,observedAt));
    const first = compose(initial,request,this.#deps,id,createdAt,expiresAt);
    const current=checkoutSnapshot(await this.#deps.source.observe(scope, request));
    const second = compose(current,request,this.#deps,id,createdAt,expiresAt);
    requireMatch(first.preview_digest === second.preview_digest, 'CHECKOUT_SOURCE_CHANGED');
    const completedAt=this.time(observedAt,expiresAt);
    requireMatch(this.validity(current,completedAt)>=expiresAt,'CHECKOUT_SOURCE_CHANGED');
    return first;
  }

  /** Checks existing immutable preview against fresh authoritative observations. */
  async revalidate(scope: Scope, preview: FrozenCheckoutPreview): Promise<FrozenCheckoutPreview> {
    // Capture the entire expected binding before any clock/source dependency runs.
    preview = checkoutSnapshot(preview);
    requireMatch(!!preview && typeof preview === 'object' &&
      preview.qualification === 'synthetic_only' && preview.schema_version === 1,
      'CHECKOUT_PREVIEW_INVALID');
    requireMatch(Number.isSafeInteger(preview.created_at) && preview.created_at>=0 &&
      Number.isSafeInteger(preview.expires_at) && preview.expires_at>preview.created_at &&
      preview.expires_at-preview.created_at<=this.#deps.lifetime_ms, 'CHECKOUT_PREVIEW_INVALID');
    const {preview_digest:expectedDigest,...body}=preview;
    requireMatch(digest(this.#deps.contentDigest(body))===digest(expectedDigest),'CHECKOUT_PREVIEW_CHANGED');
    const now = this.time(preview.created_at,preview.expires_at);
    const request = this.request({cart_id:preview.cart_id,
      shipping_quote_id:preview.shipping_quote.quote_id,
      fee_quote_id:preview.fee_quote.quote_id});
    const current=checkoutSnapshot(await this.#deps.source.observe(scope, request));
    const recomputed = compose(current, request, this.#deps,
      preview.preview_id, preview.created_at, preview.expires_at);
    requireMatch(recomputed.preview_digest === expectedDigest, 'CHECKOUT_PREVIEW_CHANGED');
    const completedAt=this.time(now,preview.expires_at);
    requireMatch(this.validity(current,completedAt)>=preview.expires_at,'CHECKOUT_PREVIEW_CHANGED');
    return recomputed;
  }

  /** Native owner uses this synchronous check after its final await. Reuse the
   * exact composition rules instead of maintaining a second partial comparator. */
  assertObservation(preview:FrozenCheckoutPreview,observation:TrustedCheckoutObservation):void {
    const expected=checkoutSnapshot(preview),current=checkoutSnapshot(observation);
    const request=this.request({cart_id:expected.cart_id,shipping_quote_id:expected.shipping_quote.quote_id,
      fee_quote_id:expected.fee_quote.quote_id});
    const recomputed=compose(current,request,this.#deps,expected.preview_id,expected.created_at,expected.expires_at);
    requireMatch(recomputed.preview_digest===expected.preview_digest,'CHECKOUT_PREVIEW_CHANGED');
    const completedAt=this.time(expected.created_at,expected.expires_at);
    requireMatch(this.validity(current,completedAt)>=expected.expires_at,'CHECKOUT_PREVIEW_CHANGED');
  }
}
