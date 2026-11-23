import { PaymentCollectionStatus, PaymentSessionStatus } from "@medusajs/framework/utils";
import type { ModulesSdkUtils } from "@medusajs/framework/utils";
import { factsDigest, minorUnits } from "../../cart-context/observation";
import type { parseOriginalCommand } from "./command";

type Postgres = ReturnType<typeof ModulesSdkUtils.createPgConnection>;
type Original = ReturnType<typeof parseOriginalCommand>;
type Binding = { merchant_namespace: string; store_id: string; region_id: string;
  final_command_uuid: string; final_response_digest: string; receipt_digest: string; receipt_context_digest: string; receipt_id: string };
const unavailable = (): never => { throw new Error("NATIVE_PAYMENT_ASSOCIATION_UNAVAILABLE"); };
const requireValue = (value: unknown) => { if (!value) unavailable(); };

/** Read only current native payment identity/money. This performs no provider
 * lookup or workflow, and pending native state does not prove no remote effect. */
export async function readLockedNativePayment(transaction: Postgres, original: Original, binding: Binding) {
  requireValue(transaction.isTransaction && process.env.RIFARE_COMMERCE_PROFILE === "local-medusa" &&
    [undefined, "development", "test"].includes(process.env.NODE_ENV));
  const isolation = (await transaction.raw("show transaction_isolation")).rows[0]?.transaction_isolation;
  requireValue(isolation === "serializable");
  const live = (table: string) => transaction(table).whereNull("deleted_at").orderBy("id").forUpdate();
  const links = await transaction("cart_payment_collection").where({ cart_id: original.command.cart_id }).orderBy("id").forUpdate()
    .limit(2).select("id", "cart_id", "payment_collection_id", "deleted_at");
  requireValue(links.length === 1 && links[0].deleted_at === null);
  const collection = await live("payment_collection").where({ id: links[0].payment_collection_id }).first(
    "id", "currency_code", "raw_amount", "raw_authorized_amount", "raw_captured_amount", "raw_refunded_amount", "completed_at", "status");
  requireValue(collection && /^pay_col_[A-Za-z0-9]{1,100}$/.test(collection.id) && collection.completed_at === null &&
    [PaymentCollectionStatus.NOT_PAID, PaymentCollectionStatus.AWAITING].includes(collection.status) && collection.currency_code === original.command.currency);
  const aliases = await transaction("cart_payment_collection").where({ payment_collection_id: collection.id }).orderBy("id").forUpdate()
    .limit(2).select("id", "cart_id", "deleted_at");
  requireValue(aliases.length === 1 && aliases[0].deleted_at === null && aliases[0].cart_id === original.command.cart_id && aliases[0].id === links[0].id);
  const sessions = await transaction("payment_session").where({ payment_collection_id: collection.id }).orderBy("id").forUpdate().limit(2).select(
    "id", "currency_code", "raw_amount", "provider_id", "status", "authorized_at", "deleted_at");
  requireValue(sessions.length === 1 && sessions[0].deleted_at === null); const session = sessions[0];
  requireValue(/^payses_[A-Za-z0-9]{1,100}$/.test(session.id) && session.currency_code === original.command.currency &&
    session.status === PaymentSessionStatus.PENDING && session.authorized_at === null &&
    session.provider_id === "pp_system_default");
  const exponent = original.command.currency_exponent;
  requireValue(minorUnits(collection.raw_amount, exponent) === original.command.payable_minor_units &&
    minorUnits(session.raw_amount, exponent) === original.command.payable_minor_units);
  for (const field of ["raw_authorized_amount", "raw_captured_amount", "raw_refunded_amount"]) {
    requireValue(collection[field] === null || minorUnits(collection[field], exponent) === "0");
  }
  const provider = await live("payment_provider").where({ id: session.provider_id }).first("id", "is_enabled");
  requireValue(provider?.is_enabled === true);
  const eligibility = await live("region_payment_provider").where({ region_id: binding.region_id,
    payment_provider_id: session.provider_id }).limit(2).select("id");
  requireValue(eligibility.length === 1);
  // Include soft-deleted native payment history. Absence is still not a remote
  // no-effect proof; presence always requires the separate reconciliation owner.
  const payment = await transaction("payment").where({ payment_collection_id: collection.id }).orderBy("id").forUpdate().first("id");
  requireValue(!payment);
  const context = { profile: "urn:rifare:native-pending-payment-context:v1", payment_provider_profile: "urn:rifare:local-medusa-system-pending:v1", merchant_namespace: binding.merchant_namespace,
    store_id: binding.store_id, original_command_id: original.command.command_id, command_digest: original.commandDigest,
    cart_id: original.command.cart_id, final_command_uuid: binding.final_command_uuid, final_response_digest: binding.final_response_digest,
    receipt_digest: binding.receipt_digest, receipt_context_digest: binding.receipt_context_digest, receipt_id: binding.receipt_id,
    payment_collection_id: collection.id, payment_session_id: session.id, provider_id: session.provider_id,
    currency: original.command.currency, currency_exponent: exponent, payable_minor_units: original.command.payable_minor_units };
  return Object.freeze({ payment_collection_id: collection.id as string, payment_session_id: session.id as string,
    payment_provider_id: session.provider_id as string, payment_context_digest: factsDigest(context),
    payment_fingerprint: factsDigest({ profile: "urn:rifare:medusa-payment-refusal:v1", merchant_namespace: binding.merchant_namespace,
      store_id: binding.store_id, provider_id: session.provider_id, payment_session_id: session.id }),
    execution_authorized: false, live_provider_status_verified: false });
}
