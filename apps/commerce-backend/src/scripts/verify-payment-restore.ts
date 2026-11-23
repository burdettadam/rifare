import assert from "node:assert/strict";
import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { operationJournalModule } from "../modules/operation-journal";
import type OperationJournalService from "../modules/operation-journal/service";
import { bytes } from "./native-receipt-fixture";
import { nativePaymentFixture } from "./native-payment-fixture";

/** Whole-database backup restore with independently retained current privacy state. */
export default async function verifyPaymentRestore({ container }: ExecArgs) {
  if (process.env.NODE_ENV !== "test" || process.env.RIFARE_COMMERCE_VERIFY !== "disposable") throw new Error("RIFARE_DISPOSABLE_PAYMENT_RESTORE_REQUIRED");
  if (process.env.RIFARE_C10_COMPILED === "true") assert.ok(__filename.endsWith(".js"));
  const journal = container.resolve<OperationJournalService>(operationJournalModule), postgres = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const phase = process.env.RIFARE_C10_RESTORE_PHASE;
  if (phase === "seed") {
    const f = await nativePaymentFixture(container, true), original = await f.makePaymentOriginal(), id = original.command.command_id;
    await journal.associateAuthorityPayment(id, f.context, f.verifier);
    const row = await original.row(); assert.ok(row.payment_fingerprint); assert.ok(row.payment_context_digest);
    console.log("C10_RESTORE_FIXTURE=" + JSON.stringify({ merchant: f.merchant, privacyActor: f.privacyActor, context: f.context,
      trust: f.trust, command_id: id, payment_fingerprint: row.payment_fingerprint, payment_context_digest: row.payment_context_digest }));
    f.requestVerifier.close(); f.verifier.close(); return;
  }
  assert.ok(["erase", "reconcile-erase", "reconcile-uninstall"].includes(phase ?? ""));
  const f = JSON.parse(process.env.RIFARE_C10_RESTORE_FIXTURE ?? "");
  process.env.RIFARE_MERCHANT_NAMESPACE = f.merchant.merchant_namespace; process.env.RIFARE_NATIVE_STORE_ID = f.merchant.store_id;
  process.env.RIFARE_JOURNAL_PRIVACY_OPERATOR_ID = f.privacyActor.actor_id;
  const selected = () => postgres("rifare_operation").where({ original_command_uuid: f.command_id }).first();
  const before = await selected(); assert.equal(before.payment_context_digest, f.payment_context_digest); assert.ok(before.payment_session_id);
  if (phase === "erase") await journal.erasePrivacySubject(f.context.actor.actor_id, f.privacyActor);
  else {
    const refusals = phase === "reconcile-erase" ? [JSON.parse(process.env.RIFARE_C10_RESTORE_REFUSAL ?? "")] : [];
    const reconcile = () => journal.reconcilePrivacyRestore(refusals, phase === "reconcile-erase" ? [f.context.actor.actor_id] : [],
      f.privacyActor, { installationUninstalled: phase === "reconcile-uninstall" });
    await reconcile(); await reconcile();
  }
  const after = await selected(); assert.equal(after.state, "retired"); assert.equal(after.id, before.id);
  assert.equal(after.payment_fingerprint, f.payment_fingerprint);
  for (const field of ["payment_collection_id", "payment_session_id", "payment_provider_id", "payment_context_digest", "payment_observed_at",
    "command_bytes", "request_bytes", "receipt_bytes", "proof_context_bytes", "proof_submission_bytes", "final_command_bytes", "final_response_bytes"]) assert.equal(after[field], null, field);
  const verifier = await journal.createAuthorityReceiptVerifier(bytes(f.trust));
  try { await assert.rejects(journal.recoverAuthorityPayment(f.command_id, f.context, verifier)); }
  finally { verifier.close(); }
  if (phase === "erase") console.log("C10_RESTORE_CURRENT_REFUSAL=" + JSON.stringify({ id: after.id,
    original_command_uuid: after.original_command_uuid, challenge_fingerprint: after.challenge_fingerprint,
    receipt_fingerprint: after.receipt_fingerprint, final_command_uuid: after.final_command_uuid, payment_fingerprint: after.payment_fingerprint }));
  console.log("C10_DATABASE_RESTORE_RESULT=" + JSON.stringify({ result: "pass", phase, source: "whole-postgresql-database", execution_authorized: false }));
}
