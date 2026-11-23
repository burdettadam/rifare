import assert from "node:assert/strict";
import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { operationJournalModule } from "../modules/operation-journal";
import type OperationJournalService from "../modules/operation-journal/service";
import { minimizedOperationFields } from "../modules/operation-journal/privacy";

/** Behavioral privacy and whole-database restore coverage for the durable
 * provider-attempt marker. This never invokes a payment provider. */
export default async function verifyProviderAttemptPrivacyRestore({ container }: ExecArgs) {
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.RIFARE_COMMERCE_VERIFY, "disposable");
  const phase = process.env.RIFARE_C12_ATTEMPT_PRIVACY_PHASE;
  assert.ok(["export", "erase", "recover", "reconcile-erase", "reconcile-uninstall"].includes(phase ?? ""));
  const fixture = JSON.parse(process.env.RIFARE_C12_ATTEMPT_PRIVACY_FIXTURE ?? "");
  if (process.env.RIFARE_C12_ATTEMPT_PRIVACY_FAULT === "clear-attempt") {
    (minimizedOperationFields as any).execution_payment_attempted_at = null;
    console.log("C12_PROVIDER_ATTEMPT_PRIVACY_FAULT=clear-attempt-on-minimization");
  }
  const journal = container.resolve<OperationJournalService>(operationJournalModule);
  const postgres = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  assert.equal((await postgres.raw("select has_function_privilege('public','public.rifare_require_native_execution_payment(text,text,text)','execute') as allowed")).rows[0].allowed, false);
  const selected = () => postgres("rifare_operation").where({ original_command_uuid: fixture.original_id }).first();
  const before = await selected();
  assert.ok(before?.execution_payment_attempted_at instanceof Date);
  const attemptedAt = before.execution_payment_attempted_at.toISOString();
  const assertRetainedAttempt = async () => {
    const row = await selected();
    assert.equal(row.state, "retired");
    assert.equal(row.execution_payment_attempted_at.toISOString(), attemptedAt);
    assert.ok(row.execution_owner_fingerprint); assert.ok(row.execution_seal_fingerprint);
    assert.ok(row.execution_payment_handle_fingerprint); assert.ok(row.execution_revoked_at instanceof Date);
    assert.ok(row.execution_generation >= 2);
    for (const field of ["execution_claimed_at", "execution_expires_at", "execution_order_id",
      "payment_collection_id", "payment_session_id", "payment_provider_id", "command_bytes", "receipt_bytes"])
      assert.equal(row[field], null, field);
    return row;
  };

  if (phase === "export" || phase === "recover") {
    const exported = await journal.exportPrivacySubject(fixture.privacy.customer_id, fixture.privacy.actor);
    const row = exported.find((candidate: any) => candidate.original_command_uuid === fixture.original_id);
    assert.equal(row?.execution_payment_attempted_at.toISOString(), attemptedAt);
    assert.equal((await selected()).execution_payment_attempted_at.toISOString(), attemptedAt);
  } else if (phase === "erase") {
    assert.equal(await journal.setPrivacyHold(fixture.privacy.customer_id, before.id, before.revision, true,
      fixture.privacy.actor), true);
    const heldBeforeErase = await selected();
    const heldExport = await journal.exportPrivacySubject(fixture.privacy.customer_id, fixture.privacy.actor);
    assert.equal(heldExport.find((candidate: any) => candidate.id === before.id)?.execution_payment_attempted_at.toISOString(), attemptedAt);
    await journal.erasePrivacySubject(fixture.privacy.customer_id, fixture.privacy.actor);
    const held = await selected(); assert.equal(held.state, "retired");
    assert.equal(held.execution_payment_attempted_at.toISOString(), attemptedAt);
    assert.ok(held.execution_claimed_at instanceof Date);
    assert.equal(await journal.setPrivacyHold(fixture.privacy.customer_id, held.id, held.revision, false,
      fixture.privacy.actor), true);
    await assertRetainedAttempt();
    assert.ok(held.revision > heldBeforeErase.revision);
  } else {
    const reconcile = () => journal.reconcilePrivacyRestore([], phase === "reconcile-erase" ? [fixture.privacy.customer_id] : [],
      fixture.privacy.actor, { installationUninstalled: phase === "reconcile-uninstall" });
    await reconcile(); await reconcile();
    await assertRetainedAttempt();
  }
  console.log("C12_PROVIDER_ATTEMPT_PRIVACY_RESTORE=" + JSON.stringify({ result: "pass", phase,
    attempted_at_retained: true, execution_authorized: false, provider_invoked: false }));
}
