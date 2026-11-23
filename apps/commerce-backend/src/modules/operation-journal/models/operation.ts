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
  proof_context_bytes: model.text().nullable(),
  proof_context_digest: model.text().nullable(),
  proof_digest: model.text().nullable(),
  proof_owner_digest: model.text().nullable(),
  proof_claimed_at: model.dateTime().nullable(),
  proof_submission_bytes: model.text().nullable(),
  proof_submission_digest: model.text().nullable(),
  proof_submission_observed_at: model.dateTime().nullable(),
  final_command_uuid: model.text().nullable(),
  final_command_bytes: model.text().nullable(),
  final_command_digest: model.text().nullable(),
  final_owner_digest: model.text().nullable(),
  final_claimed_at: model.dateTime().nullable(),
  final_response_bytes: model.text().nullable(),
  final_response_digest: model.text().nullable(),
  final_response_observed_at: model.dateTime().nullable(),
  payment_fingerprint: model.text().nullable(),
  payment_collection_id: model.text().nullable(),
  payment_session_id: model.text().nullable(),
  payment_provider_id: model.text().nullable(),
  payment_context_digest: model.text().nullable(),
  payment_observed_at: model.dateTime().nullable(),
  native_payment_fingerprint: model.text().nullable(),
  native_payment_id: model.text().nullable(),
  native_payment_observed_at: model.dateTime().nullable(),
  receipt_fingerprint: model.text().nullable(),
  receipt_bytes: model.text().nullable(),
  receipt_digest: model.text().nullable(),
  receipt_context_digest: model.text().nullable(),
  receipt_id: model.text().nullable(),
  receipt_observed_at: model.dateTime().nullable(),
  receipt_expires_at: model.dateTime().nullable(),
  execution_owner_fingerprint: model.text().nullable(),
  execution_seal_fingerprint: model.text().nullable(),
  execution_payment_handle_fingerprint: model.text().nullable(),
  execution_generation: model.number().nullable(),
  execution_claimed_at: model.dateTime().nullable(),
  execution_expires_at: model.dateTime().nullable(),
  execution_revoked_at: model.dateTime().nullable(),
  execution_order_id: model.text().nullable(),
  execution_order_fingerprint: model.text().nullable(),
  privacy_hold: model.boolean().default(false),
}).indexes([
  // An original cannot be reminted by changing its merchant, store or customer.
  { name: "rifare_operation_original_unique", on: ["original_command_uuid"], unique: true, where: null },
  { name: "rifare_operation_challenge_unique", on: ["challenge_fingerprint"], unique: true, where: null },
  { name: "rifare_operation_final_uuid_unique", on: ["final_command_uuid"], unique: true, where: null },
  { name: "rifare_operation_payment_unique", on: ["payment_fingerprint"], unique: true, where: null },
  { name: "rifare_operation_native_payment_unique", on: ["native_payment_fingerprint"], unique: true, where: null },
  { name: "rifare_operation_receipt_unique", on: ["receipt_fingerprint"], unique: true, where: null },
  { name: "rifare_operation_execution_owner_unique", on: ["execution_owner_fingerprint"], unique: true, where: null },
  { name: "rifare_operation_execution_seal_unique", on: ["execution_seal_fingerprint"], unique: true, where: null },
  { name: "rifare_operation_execution_order_unique", on: ["execution_order_fingerprint"], unique: true, where: null },
]).checks([
  { name: "rifare_operation_execution_tuple", expression: `(execution_owner_fingerprint is null and execution_seal_fingerprint is null and execution_payment_handle_fingerprint is null
      and execution_generation is null and execution_claimed_at is null and execution_expires_at is null
      and execution_revoked_at is null and execution_order_id is null and execution_order_fingerprint is null)
    or (execution_owner_fingerprint is not null and execution_seal_fingerprint is not null and execution_payment_handle_fingerprint is not null
      and payment_fingerprint is not null and
      (state = 'retired' or (state in ('unknown','observed','completed') and execution_generation between 1 and 2147483647
        and execution_claimed_at is not null and execution_expires_at > execution_claimed_at))
      and (execution_order_id is null or execution_order_fingerprint is not null))` },
  { name: "rifare_operation_execution_shape", expression: "execution_owner_fingerprint ~ '^sha256:[0-9a-f]{64}$' and execution_seal_fingerprint ~ '^sha256:[0-9a-f]{64}$' and execution_payment_handle_fingerprint ~ '^sha256:[0-9a-f]{64}$' and execution_order_fingerprint ~ '^sha256:[0-9a-f]{64}$' and execution_order_id ~ '^order_[A-Za-z0-9]{1,100}$'" },
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
  { name: "rifare_operation_proof_context_tuple", expression: `(proof_context_bytes is null) = (proof_context_digest is null)
    and (proof_context_bytes is null) = (proof_digest is null) and (proof_context_bytes is null) = (proof_owner_digest is null)
    and (proof_context_bytes is null or request_bytes is not null)
    and (proof_claimed_at is null or proof_context_bytes is not null)` },
  { name: "rifare_operation_proof_digests", expression: "proof_context_digest ~ '^sha256:[0-9a-f]{64}$' and proof_digest ~ '^sha256:[0-9a-f]{64}$' and proof_owner_digest ~ '^sha256:[0-9a-f]{64}$' and proof_submission_digest ~ '^sha256:[0-9a-f]{64}$'" },
  { name: "rifare_operation_proof_submission_tuple", expression: `(proof_submission_bytes is null) = (proof_submission_digest is null)
    and (proof_submission_bytes is null) = (proof_submission_observed_at is null)
    and (proof_submission_bytes is null or (proof_context_bytes is not null and proof_claimed_at is not null))` },
  { name: "rifare_operation_proof_bounds", expression: "octet_length(proof_context_bytes) between 1 and 4096 and octet_length(proof_submission_bytes) between 1 and 4096" },
  { name: "rifare_operation_final_tuple", expression: `(final_command_bytes is null) = (final_command_digest is null)
    and (final_command_bytes is null) = (final_owner_digest is null)
    and (final_command_bytes is null or (final_command_uuid is not null and proof_submission_bytes is not null))
    and (final_command_uuid is null or final_command_bytes is not null or state = 'retired')
    and (final_claimed_at is null or final_command_bytes is not null)` },
  { name: "rifare_operation_final_uuid", expression: "final_command_uuid ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and final_command_uuid <> '00000000-0000-0000-0000-000000000000' and final_command_uuid <> original_command_uuid" },
  { name: "rifare_operation_final_digests", expression: "final_command_digest ~ '^sha256:[0-9a-f]{64}$' and final_owner_digest ~ '^sha256:[0-9a-f]{64}$' and final_response_digest ~ '^sha256:[0-9a-f]{64}$'" },
  { name: "rifare_operation_final_response_tuple", expression: `(final_response_bytes is null) = (final_response_digest is null)
    and (final_response_bytes is null) = (final_response_observed_at is null)
    and (final_response_bytes is null or final_command_bytes is not null)` },
  { name: "rifare_operation_final_bounds", expression: "octet_length(final_command_bytes) between 1 and 65536 and octet_length(final_response_bytes) between 1 and 65536" },
  { name: "rifare_operation_payment_tuple", expression: `(payment_collection_id is null) = (payment_session_id is null)
    and (payment_collection_id is null) = (payment_provider_id is null) and (payment_collection_id is null) = (payment_context_digest is null)
    and (payment_collection_id is null) = (payment_observed_at is null)
    and (payment_collection_id is null or (payment_fingerprint is not null and receipt_bytes is not null and final_command_bytes is not null))
    and (payment_fingerprint is null or payment_collection_id is not null or state = 'retired')` },
  { name: "rifare_operation_payment_digests", expression: "payment_fingerprint ~ '^sha256:[0-9a-f]{64}$' and payment_context_digest ~ '^sha256:[0-9a-f]{64}$'" },
  { name: "rifare_operation_payment_ids", expression: "payment_collection_id ~ '^pay_col_[A-Za-z0-9]{1,100}$' and payment_session_id ~ '^payses_[A-Za-z0-9]{1,100}$' and payment_provider_id ~ '^pp_[A-Za-z0-9_.:-]{1,250}$'" },
  { name: "rifare_operation_native_payment_tuple", expression: `(native_payment_id is null) = (native_payment_observed_at is null)
    and (native_payment_id is null or (native_payment_fingerprint is not null and payment_collection_id is not null))
    and (native_payment_fingerprint is null or (payment_fingerprint is not null and (native_payment_id is not null or state = 'retired')))` },
  { name: "rifare_operation_native_payment_shape", expression: "native_payment_id ~ '^pay_[A-Za-z0-9]{1,100}$' and native_payment_fingerprint ~ '^sha256:[0-9a-f]{64}$'" },
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
