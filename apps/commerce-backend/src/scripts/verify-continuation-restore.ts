import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { operationJournalModule } from "../modules/operation-journal";
import type OperationJournalService from "../modules/operation-journal/service";
import { nativeReceiptFixture, bytes } from "./native-receipt-fixture";

const fields = ["proof_context_bytes", "proof_context_digest", "proof_digest", "proof_owner_digest", "proof_claimed_at",
  "proof_submission_bytes", "proof_submission_digest", "proof_submission_observed_at", "final_command_bytes", "final_command_digest",
  "final_owner_digest", "final_claimed_at", "final_response_bytes", "final_response_digest", "final_response_observed_at"];

/** Invoked by the whole-database dump/restore qualification owner. All records
 * and keys are synthetic; current privacy state is carried independently. */
export default async function verifyContinuationRestore({ container }: ExecArgs) {
  if (process.env.NODE_ENV !== "test" || process.env.RIFARE_COMMERCE_VERIFY !== "disposable") throw new Error("RIFARE_DISPOSABLE_CONTINUATION_REQUIRED");
  if (process.env.RIFARE_C9_COMPILED === "true") assert.ok(__filename.endsWith(".js"));
  const journal = container.resolve<OperationJournalService>(operationJournalModule), postgres = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const phase = process.env.RIFARE_C9_RESTORE_PHASE;
  if (phase === "seed") {
    const f = await nativeReceiptFixture(container, "https://authority.example.invalid", true), original = await f.makeOriginal();
    const id = original.command.command_id, proof = Buffer.from("e30.e30.cmVzdG9yZS1zeW50aGV0aWMtcHJvb2Y"), hash = (input: Uint8Array) => "sha256:" + createHash("sha256").update(input).digest("hex");
    const intent = await journal.prepareAuthorityProof(id, proof, f.context, f.requestVerifier); intent.prepared.close();
    await journal.claimAuthorityProofDispatch(id, intent.send_ticket!, hash(proof), f.context, f.requestVerifier);
    await journal.observeAuthorityProof(id, bytes({ submission_id: randomUUID(), challenge_id: original.challenge, proof_digest: hash(proof),
      received_at: new Date(await f.clock()).toISOString(), recovered: false }), hash(proof), f.context);
    const final = await journal.prepareAuthorityFinalization(id, f.context); await journal.claimAuthorityFinalization(id, final.send_ticket!, f.context);
    const receipt = await original.receipt(), claims = JSON.parse(Buffer.from(receipt.toString().split(".")[1], "base64url").toString());
    const row = await original.row();
    await journal.observeAuthorityFinalization(id, bytes({ profile: "urn:marty:delegation-command-response:v1", original_command_id: row.final_command_uuid,
      command_digest: final.command_digest, recovered: false, result: { kind: "FINAL_USE", challenge_id: original.challenge, decision: "PERMIT",
        receipt_ref: "urn:marty:delegated-receipt:" + claims.id, receipt_digest: hash(receipt), recorded_at: new Date(await f.clock()).toISOString(),
        authorization_expires_at: claims.expires_at, semantics: "EVIDENCE_ONLY" } }), false, f.context);
    await journal.verifyAuthorityReceipt(id, receipt, f.context, f.verifier);
    const retained = await original.row();
    console.log("C9_RESTORE_FIXTURE=" + JSON.stringify({ merchant: f.merchant, privacyActor: f.privacyActor, context: f.context,
      command_id: id, proof_digest: retained.proof_digest, final_command_uuid: retained.final_command_uuid,
      receipt_fingerprint: retained.receipt_fingerprint }));
    f.requestVerifier.close(); f.verifier.close(); return;
  }
  assert.ok(["erase", "reconcile-erase", "reconcile-uninstall"].includes(phase ?? ""));
  const f = JSON.parse(process.env.RIFARE_C9_RESTORE_FIXTURE ?? "");
  process.env.RIFARE_MERCHANT_NAMESPACE = f.merchant.merchant_namespace; process.env.RIFARE_NATIVE_STORE_ID = f.merchant.store_id;
  process.env.RIFARE_JOURNAL_PRIVACY_OPERATOR_ID = f.privacyActor.actor_id;
  const selected = () => postgres("rifare_operation").where({ original_command_uuid: f.command_id }).first();
  const before = await selected(); assert.equal(before.proof_digest, f.proof_digest); assert.equal(before.final_command_uuid, f.final_command_uuid);
  assert.ok(before.proof_submission_bytes); assert.ok(before.final_response_bytes); assert.ok(before.receipt_bytes);
  if (phase === "erase") await journal.erasePrivacySubject(f.context.actor.actor_id, f.privacyActor);
  else {
    const refusals = phase === "reconcile-erase" ? [JSON.parse(process.env.RIFARE_C9_RESTORE_REFUSAL ?? "")] : [];
    const reconcile = () => journal.reconcilePrivacyRestore(refusals, phase === "reconcile-erase" ? [f.context.actor.actor_id] : [],
      f.privacyActor, { installationUninstalled: phase === "reconcile-uninstall" });
    await reconcile(); await reconcile();
  }
  const after = await selected(); assert.equal(after.state, "retired"); assert.equal(after.id, before.id);
  assert.equal(after.final_command_uuid, f.final_command_uuid); assert.equal(after.receipt_fingerprint, f.receipt_fingerprint);
  for (const field of [...fields, "request_bytes", "receipt_bytes"]) assert.equal(after[field], null, field);
  await assert.rejects(journal.checkAuthorityProofRecovery(f.command_id, f.proof_digest, f.context));
  await assert.rejects(journal.prepareAuthorityFinalRecovery(f.command_id, f.context));
  if (phase === "erase") console.log("C9_RESTORE_CURRENT_REFUSAL=" + JSON.stringify({ id: after.id,
    original_command_uuid: after.original_command_uuid, challenge_fingerprint: after.challenge_fingerprint,
    receipt_fingerprint: after.receipt_fingerprint, final_command_uuid: after.final_command_uuid }));
  console.log("C9_DATABASE_RESTORE_RESULT=" + JSON.stringify({ result: "pass", phase, source: "whole-postgresql-database", execution_authorized: false }));
}
