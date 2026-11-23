import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

/** Exercise the generated database constraints with synthetic rows. */
export default async function verifyOperationJournalSchema({ container }: ExecArgs) {
  if (process.env.NODE_ENV !== "test" || process.env.RIFARE_COMMERCE_VERIFY !== "disposable") {
    throw new Error("RIFARE_DISPOSABLE_COMMERCE_TEST_REQUIRED");
  }
  const postgres = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const operations = () => postgres("rifare_operation");
  const digest = "sha256:" + "a".repeat(64);
  const original = {
    id: "rifop_" + randomUUID(),
    original_command_uuid: randomUUID(),
    challenge_fingerprint: digest,
    state: "awaiting_authority",
    merchant_namespace: "fixture-merchant",
    store_id: "store_fixture",
    customer_id: "cus_fixture",
    cart_id: "cart_fixture",
    actor_digest: digest,
    command_bytes: "{}",
    command_digest: digest,
    cart_facts_digest: digest,
    payable_minor_units: "9223372036854775807",
    currency: "usd",
    currency_exponent: 2,
  };
  const another = () => ({ ...original, id: "rifop_" + randomUUID(), original_command_uuid: randomUUID(), challenge_fingerprint: null });
  await operations().insert(original);

  const competingOriginal = { ...another(), original_command_uuid: original.original_command_uuid, merchant_namespace: "another-fixture" };
  const duplicateChallenge = { ...another(), challenge_fingerprint: digest };
  await assert.rejects(async () => operations().insert(competingOriginal), {
    code: "23505", constraint: "rifare_operation_original_unique",
  });
  await assert.rejects(async () => operations().insert(duplicateChallenge), {
    code: "23505", constraint: "rifare_operation_challenge_unique",
  });
  await assert.rejects(async () => operations().insert({ ...another(), customer_id: null }), {
    code: "23514", constraint: "rifare_operation_active_binding",
  });
  await assert.rejects(async () => operations().insert({ ...another(), payable_minor_units: "9223372036854775808" }), {
    code: "23514", constraint: "rifare_operation_payable",
  });
  await assert.rejects(async () => operations().where({ id: original.id }).update({ deleted_at: new Date() }), {
    code: "23514", constraint: "rifare_operation_no_soft_delete",
  });

  await operations().where({ id: original.id }).update({
    state: "retired", revision: 1, merchant_namespace: null, store_id: null, customer_id: null,
    cart_id: null, actor_digest: null, command_bytes: null, command_digest: null,
    cart_facts_digest: null, payable_minor_units: null, currency: null, currency_exponent: null,
  });
  await assert.rejects(async () => operations().insert(competingOriginal), {
    code: "23505", constraint: "rifare_operation_original_unique",
  });
  await assert.rejects(async () => operations().insert(duplicateChallenge), {
    code: "23505", constraint: "rifare_operation_challenge_unique",
  });
  const retained = await operations().where({ original_command_uuid: original.original_command_uuid });
  assert.equal(retained.length, 1);
  assert.equal(retained[0].state, "retired");
  assert.equal(retained[0].command_bytes, null);
  console.log("RIFARE_OPERATION_SCHEMA_RESULT=pass");
}
