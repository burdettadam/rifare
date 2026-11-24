import { createHash } from "node:crypto";
import type { ModulesSdkUtils } from "@medusajs/framework/utils";
import { OrderStatus, PaymentCollectionStatus, PaymentSessionStatus, RefundStatus } from "@medusajs/framework/utils";
import { factsDigest, minorUnits } from "../../cart-context/observation";
import { nativeExecutionPaymentCommitments, nativePaymentCommitments } from "./payment-context";
import type { parseOriginalCommand } from "./command";

type Postgres = ReturnType<typeof ModulesSdkUtils.createPgConnection>;
type Original = ReturnType<typeof parseOriginalCommand>;
export type OutcomeAssociation = {
  merchant_namespace: string; store_id: string; final_command_uuid: string; final_response_digest: string;
  receipt_digest: string; receipt_context_digest: string; receipt_id: string;
  payment_collection_id: string; payment_session_id: string; payment_provider_id: string;
  payment_context_digest: string; payment_fingerprint: string;
  native_payment_id: string | null; native_payment_fingerprint: string | null;
  execution_order_id: string | null; execution_order_fingerprint: string | null;
};
const unavailable = (): never => { throw new Error("NATIVE_ORIGINAL_PAYMENT_OUTCOME_UNAVAILABLE"); };
const requireValue = (value: unknown) => { if (!value) unavailable(); };
const nativeId = (value: unknown, prefix: string) => {
  requireValue(typeof value === "string" && new RegExp("^" + prefix + "[A-Za-z0-9]{1,100}$").test(value as string));
  return value as string;
};
const timestamp = (value: unknown) => {
  if (value === null) return null;
  requireValue(value instanceof Date && Number.isFinite(value.getTime()));
  return (value as Date).toISOString();
};
const sum = (values: string[]) => values.reduce((total, value) => total + BigInt(value), 0n).toString();
async function bounded(query: any, maximum = 100): Promise<any[]> {
  const result = await query.orderBy("id").limit(maximum + 1);
  requireValue(result.length <= maximum); return result;
}

/** Consistent native snapshot, never a provider lookup or fresh payment authority.
 * Financial rows are read without write locks; the caller owns journal/privacy and
 * current actor checks in the same serializable transaction. */
export async function readOriginalPaymentOutcome(tx: Postgres, original: Original, binding: OutcomeAssociation,
  actor: { actor_id: string }, salesChannelIds: readonly string[]) {
  requireValue(tx.isTransaction && process.env.RIFARE_COMMERCE_PROFILE === "local-medusa" &&
    [undefined, "development", "test"].includes(process.env.NODE_ENV));
  requireValue((await tx.raw("show transaction_isolation")).rows[0]?.transaction_isolation === "serializable");
  const fenced = binding.payment_provider_id === "pp_rifare_fenced_system_fixture";
  const identity = (fenced ? nativeExecutionPaymentCommitments : nativePaymentCommitments)(original, binding, binding);
  requireValue(identity.payment_context_digest === binding.payment_context_digest && identity.payment_fingerprint === binding.payment_fingerprint &&
    (binding.payment_provider_id === "pp_system_default" || fenced));
  const principal = original.command.payable_minor_units, exponent = original.command.currency_exponent;
  const money = (raw: unknown, signed = false) => { const value = minorUnits(raw, exponent); requireValue(signed || BigInt(value) >= 0n); return value; };
  const aggregate = (raw: unknown) => raw === null ? null : money(raw);
  const links = await bounded(tx("cart_payment_collection").where(builder => builder.where({ cart_id: original.command.cart_id })
    .orWhere({ payment_collection_id: binding.payment_collection_id })).select("id", "cart_id", "payment_collection_id", "deleted_at"), 1);
  requireValue(links.length === 1 && links[0].cart_id === original.command.cart_id &&
    links[0].payment_collection_id === binding.payment_collection_id && links[0].deleted_at === null);
  const collections = await bounded(tx("payment_collection").where({ id: binding.payment_collection_id }).select("id", "currency_code", "raw_amount",
    "raw_authorized_amount", "raw_captured_amount", "raw_refunded_amount", "status", "deleted_at"), 1);
  const collection = collections[0];
  requireValue(collection && collection.deleted_at === null && collection.currency_code === original.command.currency && money(collection.raw_amount) === principal &&
    Object.values(PaymentCollectionStatus).includes(collection.status));
  const sessions = await bounded(tx("payment_session").where(builder => builder.where({ id: binding.payment_session_id })
    .orWhere({ payment_collection_id: binding.payment_collection_id })).select("id", "payment_collection_id", "provider_id", "currency_code", "raw_amount", "status", "authorized_at", "deleted_at"), 1);
  const session = sessions[0];
  requireValue(session && session.id === binding.payment_session_id && session.payment_collection_id === binding.payment_collection_id &&
    session.provider_id === binding.payment_provider_id && session.currency_code === original.command.currency &&
    session.deleted_at === null && money(session.raw_amount) === principal && Object.values(PaymentSessionStatus).includes(session.status));
  const candidates = await bounded(tx("payment").where(builder => builder.where({ payment_collection_id: binding.payment_collection_id })
    .orWhere({ payment_session_id: binding.payment_session_id })).select("id", "payment_collection_id", "payment_session_id", "provider_id",
    "currency_code", "raw_amount", "captured_at", "canceled_at", "deleted_at"), 1);
  const payment = candidates[0] ?? null;
  let fingerprint: string | null = null;
  if (payment) {
    nativeId(payment.id, "pay_");
    requireValue(payment.payment_collection_id === binding.payment_collection_id && payment.payment_session_id === binding.payment_session_id &&
      payment.provider_id === binding.payment_provider_id && payment.currency_code === original.command.currency &&
      payment.deleted_at === null && money(payment.raw_amount) === principal);
    fingerprint = factsDigest({ profile: "urn:rifare:native-payment-identity-refusal:v1", merchant_namespace: binding.merchant_namespace,
      store_id: binding.store_id, provider_id: binding.payment_provider_id, payment_id: payment.id });
  }
  requireValue(!binding.native_payment_id || payment && payment.id === binding.native_payment_id && fingerprint === binding.native_payment_fingerprint);
  const captures = payment ? await bounded(tx("capture").where({ payment_id: payment.id }).select("id", "raw_amount", "deleted_at")) : [];
  const refunds = payment ? await bounded(tx("refund").where({ payment_id: payment.id }).select("id", "raw_amount", "status", "deleted_at")) : [];
  const captureFacts = captures.map(row => ({ id: nativeId(row.id, "capt_"), amount_minor_units: money(row.raw_amount), deleted: timestamp(row.deleted_at) !== null }));
  const refundFacts = refunds.map(row => {
    requireValue(Object.values(RefundStatus).includes(row.status));
    return { id: nativeId(row.id, "ref_"), amount_minor_units: money(row.raw_amount), status: row.status as string, deleted: timestamp(row.deleted_at) !== null };
  });
  const cartOrders = await bounded(tx("order_cart").where({ cart_id: original.command.cart_id }).select("id", "order_id", "cart_id", "deleted_at"), 1);
  const collectionOrders = await bounded(tx("order_payment_collection").where({ payment_collection_id: binding.payment_collection_id })
    .select("id", "order_id", "payment_collection_id", "deleted_at"), 1);
  requireValue(cartOrders.length === collectionOrders.length && cartOrders.every(row => row.deleted_at === null) && collectionOrders.every(row => row.deleted_at === null));
  let order: any = null;
  if (cartOrders.length) {
    const orderId = nativeId(cartOrders[0].order_id, "order_");
    requireValue(collectionOrders[0].order_id === orderId);
    const aliases = await bounded(tx("order_cart").where({ order_id: orderId }).select("id", "cart_id", "deleted_at"), 1);
    requireValue(aliases.length === 1 && aliases[0].id === cartOrders[0].id && aliases[0].cart_id === original.command.cart_id && aliases[0].deleted_at === null);
    const native = (await bounded(tx("order").where({ id: orderId }).select("id", "version", "status", "customer_id", "sales_channel_id", "currency_code", "deleted_at"), 1))[0];
    requireValue(native && native.deleted_at === null && native.customer_id === actor.actor_id && salesChannelIds.includes(native.sales_channel_id) &&
      native.currency_code === original.command.currency && Object.values(OrderStatus).includes(native.status) && Number.isSafeInteger(native.version) && native.version >= 1);
    const summaries = await bounded(tx("order_summary").where({ order_id: orderId, version: native.version }).select("id", "totals", "deleted_at"), 1);
    requireValue(summaries.length === 1 && summaries[0].deleted_at === null);
    const totals = summaries[0].totals;
    const creditRows = await bounded(tx("order_credit_line").where({ order_id: orderId }).select("id", "version", "raw_amount", "deleted_at"));
    requireValue(creditRows.every(row => Number.isSafeInteger(row.version) && row.version >= 1));
    order = { id: orderId, version: native.version, status: native.status as string,
      summary: { paid_minor_units: money(totals.raw_paid_total, true), refunded_minor_units: money(totals.raw_refunded_total, true),
        credit_minor_units: money(totals.raw_credit_line_total, true), pending_difference_minor_units: money(totals.raw_pending_difference, true) },
      credit_lines: creditRows.map(row => ({ id: nativeId(row.id, "ordcl_"), version: row.version,
        amount_minor_units: money(row.raw_amount, true), deleted: timestamp(row.deleted_at) !== null })), transactions: [] };
  }
  const references = [...captureFacts.map(row => row.id), ...refundFacts.map(row => row.id)];
  const transactions = references.length ? await bounded(tx("order_transaction").whereIn("reference_id", references)
    .select("id", "order_id", "reference", "reference_id", "currency_code", "raw_amount", "deleted_at"), 200) : [];
  requireValue(transactions.every(row => order && row.order_id === order.id && row.currency_code === original.command.currency &&
    (row.reference === "capture" && captureFacts.some(capture => capture.id === row.reference_id) ||
      row.reference === "refund" && refundFacts.some(refund => refund.id === row.reference_id))));
  const transactionFacts = transactions.map(row => ({ id: nativeId(row.id, "ordtrx_"), reference: row.reference as string,
    reference_id: row.reference_id as string, amount_minor_units: money(row.raw_amount, true), deleted: timestamp(row.deleted_at) !== null }));
  if (order) order.transactions = transactionFacts;
  if (fenced) requireValue(order && binding.execution_order_id === order.id &&
    binding.execution_order_fingerprint === "sha256:" + createHash("sha256").update(order.id).digest("hex"));
  const captured = sum(captureFacts.filter(row => !row.deleted).map(row => row.amount_minor_units));
  const refunded = sum(refundFacts.filter(row => !row.deleted && row.status === RefundStatus.SUCCEEDED).map(row => row.amount_minor_units));
  const financial = { profile: "urn:rifare:native-original-payment-observation:v1", original_command_id: original.command.command_id,
    payment_context_digest: binding.payment_context_digest, payment_collection_id: binding.payment_collection_id,
    payment_session_id: binding.payment_session_id, payment_provider_id: binding.payment_provider_id,
    currency: original.command.currency, currency_exponent: exponent, original_minor_units: principal,
    native_payment: payment ? { id: payment.id as string, amount_minor_units: principal, captured_at: timestamp(payment.captured_at),
      canceled_at: timestamp(payment.canceled_at), deleted: false } : null,
    session: { status: session.status as string, authorized_at: timestamp(session.authorized_at) },
    captures: captureFacts, refunds: refundFacts,
    collection: { status: collection.status as string, authorized_minor_units: aggregate(collection.raw_authorized_amount),
      captured_minor_units: aggregate(collection.raw_captured_amount), refunded_minor_units: aggregate(collection.raw_refunded_amount) },
    totals: { live_capture_minor_units: captured, live_succeeded_refund_minor_units: refunded }, order,
    consistency: { collection_capture_matches_rows: collection.raw_captured_amount === null ? null : captured === aggregate(collection.raw_captured_amount),
      collection_refund_matches_rows: collection.raw_refunded_amount === null ? null : refunded === aggregate(collection.raw_refunded_amount),
      order_refund_transactions_complete: order ? refundFacts.filter(row => !row.deleted && row.status === RefundStatus.SUCCEEDED).every(refund => {
        const matching = transactionFacts.filter(row => !row.deleted && row.reference === "refund" && row.reference_id === refund.id);
        return matching.length === 1 && BigInt(matching[0].amount_minor_units) === -BigInt(refund.amount_minor_units);
      }) : null }, execution_authorized: false, live_provider_status_verified: false,
    external_settlement_verified: false, absence_of_remote_effect_proven: false };
  return { facts: financial, observation_digest: factsDigest(financial), native_payment_id: (payment?.id as string | undefined) ?? null,
    native_payment_fingerprint: fingerprint };
}
