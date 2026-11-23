import assert from "node:assert/strict";
import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { operationJournalModule } from "../modules/operation-journal";
import type OperationJournalService from "../modules/operation-journal/service";
import { nativePaymentFixture } from "./native-payment-fixture";

/** Whole native PostgreSQL restore with separately retained synthetic custody. */
export default async function verifyPaymentOutcomesRestore({ container }: ExecArgs) {
  assert.equal(process.env.NODE_ENV, "test"); assert.equal(process.env.RIFARE_COMMERCE_VERIFY, "disposable");
  if (process.env.RIFARE_C11_COMPILED === "true") assert.ok(__filename.endsWith(".js"));
  const journal = container.resolve<OperationJournalService>(operationJournalModule);
  const postgres = container.resolve(ContainerRegistrationKeys.PG_CONNECTION), phase = process.env.RIFARE_C11_RESTORE_PHASE;
  if (phase === "seed") {
    const f = await nativePaymentFixture(container, true), original = await f.makePaymentOriginal(), id = original.command.command_id;
    await journal.associateAuthorityPayment(id, f.context, f.verifier);
    const payments = container.resolve(Modules.PAYMENT), payment = await payments.authorizePaymentSession(original.session.id, {}); assert.ok(payment);
    await payments.capturePayment({ payment_id: payment.id, amount: 5 });
    await payments.refundPayment({ payment_id: payment.id, amount: 1, idempotency_key: "c11-restore-" + id });
    const result = await journal.recoverNativePaymentOutcome(id, f.context), row = await original.row();
    assert.equal(result.totals.live_capture_minor_units, "500"); assert.equal(result.totals.live_succeeded_refund_minor_units, "100");
    console.log("C11_RESTORE_FIXTURE=" + JSON.stringify({ merchant: f.merchant, privacyActor: f.privacyActor, context: f.context,
      command_id: id, native_payment_id: row.native_payment_id, native_payment_fingerprint: row.native_payment_fingerprint,
      native_payment_observed_at: row.native_payment_observed_at, observation_digest: result.observation_digest }));
    f.requestVerifier.close(); f.verifier.close(); return;
  }
  assert.ok(["recover", "erase", "reconcile-erase", "reconcile-uninstall"].includes(phase ?? ""));
  const f = JSON.parse(process.env.RIFARE_C11_RESTORE_FIXTURE ?? "");
  process.env.RIFARE_MERCHANT_NAMESPACE = f.merchant.merchant_namespace; process.env.RIFARE_NATIVE_STORE_ID = f.merchant.store_id;
  process.env.RIFARE_JOURNAL_PRIVACY_OPERATOR_ID = f.privacyActor.actor_id;
  const selected = () => postgres("rifare_operation").where({ original_command_uuid: f.command_id }).first();
  const before = await selected(); assert.equal(before.native_payment_id, f.native_payment_id);
  assert.equal(before.native_payment_fingerprint, f.native_payment_fingerprint);
  assert.equal(before.native_payment_observed_at.toISOString(), f.native_payment_observed_at);
  if (phase === "recover") {
    const result = await journal.recoverNativePaymentOutcome(f.command_id, f.context);
    assert.equal(result.native_payment!.id, f.native_payment_id); assert.equal(result.observation_digest, f.observation_digest);
    assert.equal(result.first_payment_observed_at!.toISOString(), f.native_payment_observed_at);
    assert.deepEqual(await selected(), before);
  } else {
    if (phase === "erase") await journal.erasePrivacySubject(f.context.actor.actor_id, f.privacyActor);
    else {
      const refusals = phase === "reconcile-erase" ? [JSON.parse(process.env.RIFARE_C11_RESTORE_REFUSAL ?? "")] : [];
      const reconcile = () => journal.reconcilePrivacyRestore(refusals, phase === "reconcile-erase" ? [f.context.actor.actor_id] : [],
        f.privacyActor, { installationUninstalled: phase === "reconcile-uninstall" });
      await reconcile(); await reconcile();
    }
    const after = await selected(); assert.equal(after.state, "retired"); assert.equal(after.id, before.id);
    assert.equal(after.native_payment_fingerprint, f.native_payment_fingerprint);
    for (const field of ["native_payment_id", "native_payment_observed_at", "payment_collection_id", "payment_session_id", "payment_provider_id",
      "payment_context_digest", "payment_observed_at", "command_bytes", "request_bytes", "receipt_bytes", "proof_context_bytes",
      "proof_submission_bytes", "final_command_bytes", "final_response_bytes"]) assert.equal(after[field], null, field);
    await assert.rejects(journal.recoverNativePaymentOutcome(f.command_id, f.context));
    if (phase === "erase") console.log("C11_RESTORE_CURRENT_REFUSAL=" + JSON.stringify({ id: after.id,
      original_command_uuid: after.original_command_uuid, challenge_fingerprint: after.challenge_fingerprint,
      receipt_fingerprint: after.receipt_fingerprint, final_command_uuid: after.final_command_uuid,
      payment_fingerprint: after.payment_fingerprint, native_payment_fingerprint: after.native_payment_fingerprint }));
  }
  console.log("C11_DATABASE_RESTORE_RESULT=" + JSON.stringify({ result: "pass", phase, source: "whole-postgresql-database",
    execution_authorized: false, external_settlement_verified: false }));
}
