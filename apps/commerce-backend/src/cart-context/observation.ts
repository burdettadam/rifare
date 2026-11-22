import { createHash } from "node:crypto";
import { configure } from "safe-stable-stringify";
import type { MedusaRequest } from "@medusajs/framework/http";
import { ContainerRegistrationKeys, defaultCurrencies, MathBN, MedusaError, Modules } from "@medusajs/framework/utils";
import { cartContextConfig } from "../config/local-commerce";
import { cartId, checkCartAccess, unavailable } from "./policy";

const stringify = configure({ strict: true, deterministic: true, bigint: false });
export const observationProfile = "urn:rifare:medusa-cart-observation:v1";
type Row = Record<string, unknown>;
const cartTotals = ["total", "subtotal", "tax_total", "discount_total", "discount_tax_total",
  "original_total", "original_tax_total", "item_total", "item_subtotal", "item_tax_total",
  "shipping_total", "shipping_subtotal", "shipping_tax_total", "credit_line_total",
  "credit_line_subtotal", "credit_line_tax_total"];
const lineTotals = ["total", "subtotal", "tax_total", "discount_total", "discount_tax_total",
  "original_total", "original_subtotal", "original_tax_total"];
export const observationFields = ["id", "customer_id", "region_id", "sales_channel_id", "currency_code",
  "completed_at", "email", "shipping_address.*", "billing_address.*", "items.*",
  "items.tax_lines.*", "items.adjustments.*", "shipping_methods.*", "shipping_methods.tax_lines.*",
  "shipping_methods.adjustments.*", "credit_lines.*", ...cartTotals, ...cartTotals.map((name) => `raw_${name}`)];

const invalid = () => new MedusaError(MedusaError.Types.INVALID_DATA, "Native cart facts cannot be represented by this observation profile");
function row(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as Row;
}
function text(value: unknown, nullable = false): string | null {
  if (nullable && value == null) return null;
  if (typeof value !== "string" || value.length > 2048 || (!nullable && !value)) throw invalid();
  return value;
}
function flag(value: unknown): boolean {
  if (typeof value !== "boolean") throw invalid();
  return value;
}
function collection(value: unknown, limit: number): Row[] {
  if (!Array.isArray(value) || value.length > limit) throw invalid();
  const entries = value.map(row).map((entry) => ({ entry, id: text(entry.id)! }));
  if (new Set(entries.map(({ id }) => id)).size !== entries.length) throw invalid();
  return entries.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(({ entry }) => entry);
}
export function factsDigest(facts: unknown): string {
  const bytes = stringify(facts);
  if (!bytes || Buffer.byteLength(bytes) > 131072) throw invalid();
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/** Preserve native decimal components, including fractional minor units. */
function decimal(raw: unknown): string {
  const value = row(raw).value;
  if (typeof value !== "string" || value.length > 100 || !/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value)) throw invalid();
  const power = /e([+-]?\d+)$/i.exec(value)?.[1];
  if (power && (!Number.isSafeInteger(Number(power)) || Math.abs(Number(power)) > 100)) throw invalid();
  const number = MathBN.convert(value);
  if (!number.isFinite() || number.abs().gt("9223372036854775807") || (number.decimalPlaces() ?? 101) > 100) throw invalid();
  return number.isZero() ? "0" : number.toFixed();
}
/** Convert only a representable payable total; never round or recalculate. */
export function minorUnits(raw: unknown, exponent: number): string {
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > 4) throw invalid();
  const scaled = MathBN.mult(decimal(raw), MathBN.exp(10, exponent));
  if (!scaled.isFinite() || !scaled.isInteger() || scaled.abs().gt("9223372036854775807")) throw invalid();
  return scaled.isZero() ? "0" : scaled.toFixed(0);
}
function nativeNumber(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) throw invalid();
  return MathBN.convert(value).toFixed();
}
function money(record: Row, names: string[]) {
  return Object.fromEntries(names.map((name) => [name, decimal(record[`raw_${name}`])]));
}
function adjustments(value: unknown) {
  return collection(value, 50).map((entry) => ({ id: text(entry.id), code: text(entry.code, true),
    promotion_id: text(entry.promotion_id, true), provider_id: text(entry.provider_id, true),
    is_tax_inclusive: flag(entry.is_tax_inclusive), amount: decimal(entry.raw_amount) }));
}
function taxes(value: unknown) {
  return collection(value, 50).map((entry) => ({ id: text(entry.id), code: text(entry.code, true),
    tax_rate_id: text(entry.tax_rate_id, true), provider_id: text(entry.provider_id, true), rate: nativeNumber(entry.rate) }));
}
function address(value: unknown) {
  if (value == null) return null;
  const source = row(value);
  return Object.fromEntries(["id", "customer_id", "first_name", "last_name", "phone", "company",
    "address_1", "address_2", "city", "country_code", "province", "postal_code"].map(
    (name) => [name, text(source[name], true)]));
}

/** Pure closed projection. No metadata, provider tokens, order or payment-session data. */
export function projectCart(source: unknown, merchant: { merchant_namespace: string; store_id: string }) {
  const cart = row(source);
  const currency = text(cart.currency_code)!;
  if (!/^[a-z]{3}$/.test(currency)) throw invalid();
  const exponent = defaultCurrencies[currency.toUpperCase()]?.decimal_digits;
  if (!Number.isInteger(exponent)) throw invalid();
  if (cart.completed_at != null) throw unavailable();
  return {
    profile: observationProfile, merchant_namespace: merchant.merchant_namespace, store_id: merchant.store_id,
    cart_id: text(cart.id), customer_id: text(cart.customer_id), sales_channel_id: text(cart.sales_channel_id),
    region_id: text(cart.region_id), currency_code: currency, currency_exponent: exponent, amount_unit: "major",
    payable_total_minor: minorUnits(cart.raw_total, exponent),
    // A commitment is still personal data; it is not an anonymization promise.
    contact_digest: factsDigest({ email: text(cart.email, true), shipping_address: address(cart.shipping_address),
      billing_address: address(cart.billing_address) }),
    totals: money(cart, cartTotals),
    items: collection(cart.items, 200).map((item) => ({
      id: text(item.id), product_id: text(item.product_id, true), variant_id: text(item.variant_id, true),
      quantity: nativeNumber(item.quantity), unit_price: decimal(item.raw_unit_price),
      requires_shipping: flag(item.requires_shipping), is_giftcard: flag(item.is_giftcard),
      is_discountable: flag(item.is_discountable), is_tax_inclusive: flag(item.is_tax_inclusive),
      is_custom_price: flag(item.is_custom_price), totals: money(item, lineTotals),
      adjustments: adjustments(item.adjustments), tax_lines: taxes(item.tax_lines),
    })),
    shipping_methods: collection(cart.shipping_methods, 20).map((method) => ({
      id: text(method.id), shipping_option_id: text(method.shipping_option_id, true),
      amount: decimal(method.raw_amount), is_tax_inclusive: flag(method.is_tax_inclusive),
      totals: money(method, lineTotals), adjustments: adjustments(method.adjustments),
      tax_lines: taxes(method.tax_lines),
    })),
    credit_lines: collection(cart.credit_lines, 100).map((credit) => ({
      id: text(credit.id), amount: decimal(credit.raw_amount),
      reference: text(credit.reference, true), reference_id: text(credit.reference_id, true),
    })),
  };
}

export async function observeCart(req: MedusaRequest) {
  const config = cartContextConfig(process.env);
  if (!config) throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Cart observation is not configured");
  const id = cartId(req.params.id);
  // Cooperates with the installed single-process native workflow lock. It is not
  // a database transaction, a durable revision, or a fence across later network work.
  return req.scope.resolve(Modules.LOCKING).execute(id, async () => {
    await checkCartAccess(req, id, true);
    const stores = await req.scope.resolve(Modules.STORE).listStores({}, { select: ["id"], take: 2 });
    if (stores.length !== 1 || stores[0].id !== config.store_id) throw unavailable();
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
    const { data: orders } = await query.graph({ entity: "order_cart", fields: ["order_id"], filters: { cart_id: id } },
      { cache: { enable: false } });
    if (orders.length) throw unavailable();
    const { data } = await query.graph({ entity: "cart", fields: observationFields, filters: { id } },
      { cache: { enable: false }, throwIfKeyNotFound: true });
    if (data.length !== 1) throw unavailable();
    // Recheck association in the graph actually projected, not an earlier cart read.
    const context = await checkCartAccess(req, id, true);
    if (data[0].customer_id !== context.customer_id || data[0].sales_channel_id !== context.sales_channel_id) throw unavailable();
    const facts = projectCart(data[0], config);
    return { semantics: "OBSERVATION_ONLY", observed_at: new Date().toISOString(), facts, facts_digest: factsDigest(facts) };
  }, { timeout: 2 });
}
