import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { operationJournalModule } from "../modules/operation-journal";
import type OperationJournalService from "../modules/operation-journal/service";

const executionKeys = ["execution_owner_fingerprint", "execution_seal_fingerprint",
  "execution_payment_handle_fingerprint", "execution_order_fingerprint", "execution_payment_attempted_at"] as const;

/** Test-only transfer of inert refusal identity. No provider or worker is invoked. */
export default async function verifyExecutionRefusalTransfer({ container }: ExecArgs) {
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.RIFARE_COMMERCE_VERIFY, "disposable");
  const phase = process.env.RIFARE_C12_EXECUTION_TRANSFER_PHASE;
  assert.ok(phase === "export" || phase === "import" || phase === "reconcile");
  const fixture = JSON.parse(process.env.RIFARE_C12_EXECUTION_TRANSFER_FIXTURE ?? "");
  const journal = container.resolve<OperationJournalService>(operationJournalModule);
  const postgres = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const selected = () => postgres("rifare_operation").where({ original_command_uuid: fixture.original_id }).first();

  if (phase === "export") {
    const exported = await journal.exportPrivacySubject(fixture.privacy.customer_id, fixture.privacy.actor);
    const row = exported.find((candidate: any) => candidate.original_command_uuid === fixture.original_id);
    assert.ok(row?.execution_owner_fingerprint);
    const refusal = {
      id: row.id, original_command_uuid: row.original_command_uuid, challenge_fingerprint: row.challenge_fingerprint,
      receipt_fingerprint: row.receipt_fingerprint, final_command_uuid: row.final_command_uuid,
      payment_fingerprint: row.payment_fingerprint, native_payment_fingerprint: row.native_payment_fingerprint,
      execution_owner_fingerprint: row.execution_owner_fingerprint,
      execution_seal_fingerprint: row.execution_seal_fingerprint,
      execution_payment_handle_fingerprint: row.execution_payment_handle_fingerprint,
      execution_order_fingerprint: row.execution_order_fingerprint,
      execution_payment_attempted_at: row.execution_payment_attempted_at?.toISOString() ?? null,
    };
    assert.ok(refusal.execution_payment_attempted_at);
    console.log("C12_EXECUTION_REFUSAL_TRANSFER=" + JSON.stringify(refusal));
    return;
  }

  const refusal = JSON.parse(process.env.RIFARE_C12_EXECUTION_TRANSFER_RECORD ?? "");
  if (process.env.RIFARE_C12_EXECUTION_TRANSFER_FAULT === "omit-attempt") {
    delete refusal.execution_payment_attempted_at;
    console.log("C12_EXECUTION_REFUSAL_TRANSFER_FAULT=omit-attempt");
  }
  const existingAttempt = phase === "reconcile" ?
    (await postgres.raw("select execution_payment_attempted_at::text as attempted from rifare_operation where original_command_uuid=?", [fixture.original_id])).rows[0].attempted : null;
  if (phase === "import" && process.env.RIFARE_C12_EXECUTION_TRANSFER_OLDER === "without-attempt") {
    await journal.restorePrivacyRefusals([{ ...refusal, execution_payment_attempted_at: null }], fixture.privacy.actor);
    const older = await selected(); assert.equal(older.state, "retired");
    assert.equal(older.execution_payment_attempted_at, null);
  }
  await journal.restorePrivacyRefusals([refusal], fixture.privacy.actor);
  await journal.restorePrivacyRefusals([refusal], fixture.privacy.actor);
  const row = await selected();
  assert.equal(row.state, "retired");
  assert.equal(row.execution_payment_attempted_at.toISOString(), refusal.execution_payment_attempted_at);
  for (const key of executionKeys.slice(0, 4)) assert.equal(row[key], refusal[key], key);
  for (const key of ["merchant_namespace", "store_id", "customer_id", "cart_id", "execution_claimed_at",
    "execution_expires_at", "execution_order_id"]) assert.equal(row[key], null, key);
  if (phase === "reconcile") {
    const after = (await postgres.raw("select execution_payment_attempted_at::text as attempted from rifare_operation where original_command_uuid=?", [fixture.original_id])).rows[0].attempted;
    assert.equal(after, existingAttempt, "Reconciliation must not rewrite a retained PostgreSQL attempt timestamp");
    assert.equal(row.execution_generation, 2); assert.ok(row.execution_revoked_at instanceof Date);
  } else {
    assert.equal(row.execution_generation, null); assert.equal(row.execution_revoked_at, null);
  }
  const rowCount = async () => Number((await postgres("rifare_operation").count({ count: "*" }).first())?.count);
  const before = await rowCount();
  const legacy = { ...refusal }; for (const key of executionKeys) delete legacy[key];
  await assert.rejects(journal.restorePrivacyRefusals([legacy], fixture.privacy.actor), /conflicting journal refusal/);
  await assert.rejects(journal.restorePrivacyRefusals([{ ...refusal,
    execution_owner_fingerprint: "sha256:" + "0".repeat(64) }], fixture.privacy.actor), /conflicting journal refusal/);
  await assert.rejects(journal.restorePrivacyRefusals([{ ...refusal, id: "rifop_" + randomUUID().replaceAll("-", ""),
    original_command_uuid: randomUUID() }], fixture.privacy.actor));
  assert.equal(await rowCount(), before);
  assert.equal(Number((await postgres.raw("select count(*) as n from pg_roles where rolcanlogin and rolname ~ '^rifare_exec_[a-f0-9]{32}$'")).rows[0].n), 0);
  assert.equal((await postgres.raw("select has_function_privilege('public','public.rifare_require_native_execution_payment(text,text,text)','execute') as allowed")).rows[0].allowed, false);
  console.log("C12_EXECUTION_REFUSAL_IMPORT=" + JSON.stringify({ result: "pass", execution_authorized: false,
    provider_invoked: false, attempted_at_retained: true, idempotent: true }));
}
