import { model } from "@medusajs/framework/utils";

export const operationStates = [
  "admitted", "awaiting_authority", "approved", "dispatching", "unknown",
  "observed", "completed", "denied", "cancelled", "retired",
] as const;

const Operation = model.define("rifare_operation", {
  id: model.id({ prefix: "rifop" }).primaryKey(),
  original_command_uuid: model.text(),
  challenge_fingerprint: model.text().nullable(),
  state: model.enum([...operationStates]),
  revision: model.number().default(0),
  merchant_namespace: model.text().nullable(),
  store_id: model.text().nullable(),
  customer_id: model.text().nullable(),
  cart_id: model.text().nullable(),
  actor_digest: model.text().nullable(),
  command_bytes: model.text().nullable(),
  command_digest: model.text().nullable(),
  cart_facts_digest: model.text().nullable(),
  payable_minor_units: model.text().nullable(),
  currency: model.text().nullable(),
  currency_exponent: model.number().nullable(),
  first_observation_digest: model.text().nullable(),
  first_observed_at: model.dateTime().nullable(),
  start_owner_digest: model.text().nullable(),
  start_claimed_at: model.dateTime().nullable(),
  start_command_bytes: model.text().nullable(),
  start_command_digest: model.text().nullable(),
  start_correlation: model.text().nullable(),
  start_response_bytes: model.text().nullable(),
  start_response_digest: model.text().nullable(),
  start_response_observed_at: model.dateTime().nullable(),
  request_bytes: model.text().nullable(),
  request_digest: model.text().nullable(),
  request_context_digest: model.text().nullable(),
  request_nonce: model.text().nullable(),
  request_observed_at: model.dateTime().nullable(),
  request_expires_at: model.dateTime().nullable(),
  receipt_fingerprint: model.text().nullable(),
  receipt_bytes: model.text().nullable(),
  receipt_digest: model.text().nullable(),
  receipt_context_digest: model.text().nullable(),
  receipt_id: model.text().nullable(),
  receipt_observed_at: model.dateTime().nullable(),
  receipt_expires_at: model.dateTime().nullable(),
  privacy_hold: model.boolean().default(false),
}).indexes([
  // An original cannot be reminted by changing its merchant, store or customer.
  { name: "rifare_operation_original_unique", on: ["original_command_uuid"], unique: true, where: null },
  { name: "rifare_operation_challenge_unique", on: ["challenge_fingerprint"], unique: true, where: null },
  { name: "rifare_operation_receipt_unique", on: ["receipt_fingerprint"], unique: true, where: null },
]).checks([
  { name: "rifare_operation_original_uuid", expression: "original_command_uuid ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'" },
  { name: "rifare_operation_revision", expression: "revision >= 0" },
  { name: "rifare_operation_no_soft_delete", expression: "deleted_at is null" },
  { name: "rifare_operation_challenge_digest", expression: "challenge_fingerprint ~ '^sha256:[0-9a-f]{64}$'" },
  { name: "rifare_operation_first_observation_pair", expression: "(first_observation_digest is null) = (first_observed_at is null)" },
  { name: "rifare_operation_start_owner", expression: "start_owner_digest ~ '^sha256:[0-9a-f]{64}$'" },
  { name: "rifare_operation_start_claim", expression: "start_claimed_at is null or start_owner_digest is not null" },
  { name: "rifare_operation_start_bytes", expression: "(start_command_bytes is null) = (start_command_digest is null) and (start_command_bytes is null) = (start_correlation is null)" },
  { name: "rifare_operation_start_digest", expression: "start_command_digest ~ '^sha256:[0-9a-f]{64}$'" },
  { name: "rifare_operation_start_response", expression: "(start_response_bytes is null) = (start_response_digest is null) and (start_response_bytes is null) = (start_response_observed_at is null)" },
  { name: "rifare_operation_start_response_digest", expression: "start_response_digest ~ '^sha256:[0-9a-f]{64}$'" },
  { name: "rifare_operation_request_tuple", expression: `(request_bytes is null) = (request_digest is null)
    and (request_bytes is null) = (request_context_digest is null) and (request_bytes is null) = (request_nonce is null)
    and (request_bytes is null) = (request_observed_at is null) and (request_bytes is null) = (request_expires_at is null)
    and (request_bytes is null or start_response_bytes is not null)` },
  { name: "rifare_operation_request_digest", expression: "request_digest ~ '^sha256:[0-9a-f]{64}$' and request_context_digest ~ '^sha256:[0-9a-f]{64}$'" },
  { name: "rifare_operation_request_bounds", expression: "octet_length(request_bytes) between 1 and 65536 and length(request_nonce) between 1 and 1024 and request_expires_at > request_observed_at" },
  { name: "rifare_operation_receipt_tuple", expression: `(receipt_bytes is null) = (receipt_digest is null)
    and (receipt_bytes is null) = (receipt_context_digest is null) and (receipt_bytes is null) = (receipt_id is null)
    and (receipt_bytes is null) = (receipt_observed_at is null) and (receipt_bytes is null) = (receipt_expires_at is null)
    and (receipt_bytes is null or (request_bytes is not null and receipt_fingerprint is not null))` },
  { name: "rifare_operation_receipt_digests", expression: "receipt_fingerprint ~ '^sha256:[0-9a-f]{64}$' and receipt_digest ~ '^sha256:[0-9a-f]{64}$' and receipt_context_digest ~ '^sha256:[0-9a-f]{64}$'" },
  { name: "rifare_operation_receipt_bounds", expression: "octet_length(receipt_bytes) between 1 and 100000 and receipt_expires_at > receipt_observed_at and receipt_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'" },
  { name: "rifare_operation_payable", expression: "payable_minor_units ~ '^(0|[1-9][0-9]{0,18})$' and (length(payable_minor_units) < 19 or payable_minor_units collate \"C\" <= '9223372036854775807')" },
  { name: "rifare_operation_currency", expression: "currency ~ '^[a-z]{3}$' and currency_exponent between 0 and 4" },
  { name: "rifare_operation_active_binding", expression: `
    state = 'retired' or (
      merchant_namespace is not null and store_id is not null and customer_id is not null
      and cart_id is not null and actor_digest is not null and command_bytes is not null
      and command_digest is not null and cart_facts_digest is not null
      and payable_minor_units is not null and currency is not null and currency_exponent is not null
    )
  ` },
]);

export default Operation;
