import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { operationJournalModule } from "../modules/operation-journal";
import type OperationJournalService from "../modules/operation-journal/service";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { ExecArgs } from "@medusajs/framework/types";
import { nativeReceiptFixture, bytes } from "./native-receipt-fixture";
import { authorityAdapters } from "../modules/operation-journal/authority-assets";

/** Real disposable PostgreSQL journal and genuine synthetic C7/C8 signatures.
 * No provider, presentation signature or commerce effect is qualified. */
export default async function verifyContinuationRetention({ container }: ExecArgs) {
  if (process.env.NODE_ENV !== "test" || process.env.RIFARE_COMMERCE_VERIFY !== "disposable") throw new Error("RIFARE_DISPOSABLE_CONTINUATION_REQUIRED");
  if (process.env.RIFARE_C9_COMPILED === "true") assert.ok(__filename.endsWith(".js"));
  if (process.env.RIFARE_C9_WORKER) {
    const journal = container.resolve<OperationJournalService>(operationJournalModule), task = JSON.parse(process.env.RIFARE_C9_WORKER);
    if (task.mode === "proof-intent-lose-ack") {
      const verifier = await journal.createAuthorityRequestVerifier(bytes(task.requestTrust));
      const result = await journal.prepareAuthorityProof(task.command_id, Buffer.from(task.proof, "base64"), task.context, verifier);
      result.prepared.close(); verifier.close(); process.exit(79);
    }
    if (task.mode === "proof-ack-lose-ack") {
      await journal.observeAuthorityProof(task.command_id, bytes(task.ack), task.proof_digest, task.context); process.exit(79);
    }
    if (task.mode === "final-intent-lose-ack") {
      await journal.prepareAuthorityFinalization(task.command_id, task.context); process.exit(79);
    }
    if (task.mode === "recover") {
      const result = await journal.prepareAuthorityFinalRecovery(task.command_id, task.context);
      console.log("C9_RECOVERED=" + JSON.stringify(result)); return;
    }
    throw new Error("C9_UNKNOWN_WORKER_MODE");
  }
  const fixture = await nativeReceiptFixture(container);
  const { journal, context, requestVerifier, verifier, postgres, clock, makeOriginal, privacyActor } = fixture;
  const checks: string[] = [];
  const check = async (name: string, run: () => unknown) => { await run(); checks.push(name); console.log("CONTINUATION_RETENTION_CHECK " + name); };
  const { codec } = await authorityAdapters();
  const proof = Buffer.from("e30.e30.c3ludGhldGljLXByb29m"), digest = "sha256:" + createHash("sha256").update(proof).digest("hex");
  const runWorker = (task: unknown) => new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["run.mjs", "exec", __filename], { cwd: process.cwd(),
      env: { ...process.env, RIFARE_C9_WORKER: JSON.stringify(task) }, stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; const timer = setTimeout(() => { child.kill(); reject(new Error("C9 child deadline")); }, 45000);
    for (const stream of [child.stdout, child.stderr]) stream.on("data", data => { output = (output + data).slice(-16000); });
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", code => { clearTimeout(timer); resolve({ code, output }); });
  });
  const original = await makeOriginal(), id = original.command.command_id;
  const intent = await journal.prepareAuthorityProof(id, proof, context, requestVerifier);
  const ack = { submission_id: randomUUID(), challenge_id: original.challenge, proof_digest: digest,
    received_at: new Date(await clock()).toISOString(), recovered: false };
  await check("native-context-and-digest-before-I-O-never-store-VP", async () => {
    const row = await original.row(); assert.equal(row.proof_digest, digest); assert.ok(row.proof_context_bytes.includes('"query_id":"machine"'));
    assert.equal(row.proof_context_digest, intent.prepared.describe().context_digest); assert.equal(row.proof_claimed_at, null);
    assert.ok(!JSON.stringify(row).includes(proof.toString())); assert.ok(intent.send_ticket); assert.equal(intent.recovery_only, false);
  });
  await check("first-proof-requires-real-current-C7-verifier", async () => {
    const another = await makeOriginal();
    await assert.rejects(journal.prepareAuthorityProof(another.command.command_id, proof, context, { verified: true }));
    assert.equal((await another.row()).proof_context_bytes, null);
    const noRequest = await makeOriginal(false);
    await assert.rejects(journal.prepareAuthorityProof(noRequest.command.command_id, proof, context, requestVerifier));
    assert.equal((await noRequest.row()).proof_digest, null);
  });
  await check("same-original-recovery-cannot-change-proof-or-renew-ticket", async () => {
    const before = await original.row();
    await assert.rejects(journal.prepareAuthorityProof(id, proof, context));
    await assert.rejects(journal.checkAuthorityProofRecovery(id, digest, context));
    await assert.rejects(journal.observeAuthorityProof(id, bytes(ack), digest, context));
    assert.deepEqual(await original.row(), before);
    await assert.rejects(postgres("rifare_operation").where({ id: before.id }).update({ proof_submission_bytes: bytes(ack).toString(),
      proof_submission_digest: digest, proof_submission_observed_at: new Date() }), /rifare_operation_proof_submission_tuple/);
    await assert.rejects(journal.prepareAuthorityProof(id, Buffer.from("a.b.c"), context)); assert.equal((await original.row()).proof_digest, digest);
  });
  await check("post-TLS-native-proof-claim-is-single-use", async () => {
    await journal.claimAuthorityProofDispatch(id, intent.send_ticket!, digest, context, requestVerifier);
    const before = await original.row(); assert.ok(before.proof_claimed_at);
    await assert.rejects(journal.claimAuthorityProofDispatch(id, intent.send_ticket!, digest, context, requestVerifier));
    assert.equal((await original.row()).revision, before.revision);
    const recovery = await journal.prepareAuthorityProof(id, proof, context); assert.equal(recovery.recovery_only, true);
    assert.equal(recovery.send_ticket, null); recovery.prepared.close();
  });
  await check("acknowledgement-mismatches-rollback-before-first-observation", async () => {
    for (const changed of [{ proof_digest: "sha256:" + "0".repeat(64) }, { challenge_id: randomUUID() }, { received_at: "2000-01-01T00:00:00Z" }, { verified: true }]) {
      await assert.rejects(journal.observeAuthorityProof(id, bytes({ ...ack, ...changed }), digest, context));
      assert.equal((await original.row()).proof_submission_bytes, null);
    }
  });
  let observed: Awaited<ReturnType<typeof journal.observeAuthorityProof>>;
  await check("first-semantic-submission-is-immutable-across-recovery", async () => {
    observed = await journal.observeAuthorityProof(id, bytes(ack), digest, context);
    const first = await original.row();
    const recovered = await journal.observeAuthorityProof(id, bytes({ ...ack, recovered: true }), digest, context);
    assert.deepEqual(recovered, observed); assert.equal((await original.row()).revision, first.revision);
    assert.ok(!first.proof_submission_bytes.includes("recovered"));
    await assert.rejects(journal.observeAuthorityProof(id, bytes({ ...ack, submission_id: randomUUID() }), digest, context));
    assert.equal((await original.row()).proof_submission_bytes, first.proof_submission_bytes);
  });
  await check("concurrent-first-proof-selects-only-one-owner-and-digest", async () => {
    const another = await makeOriginal();
    const results = await Promise.allSettled([proof, Buffer.from("a.b.c")].map(value => journal.prepareAuthorityProof(another.command.command_id, value, context, requestVerifier)));
    const successes = results.filter(result => result.status === "fulfilled"); assert.equal(successes.length, 1);
    for (const result of successes) if (result.status === "fulfilled") result.value.prepared.close();
    const row = await another.row(); assert.ok(row.proof_owner_digest); assert.equal(row.proof_claimed_at, null);
  });
  const final = await journal.prepareAuthorityFinalization(id, context);
  await check("distinct-original-FINALIZE-retained-before-send-and-recovery-reuses-it", async () => {
    const encoded = codec.encodeDelegatedCommand(Buffer.from(final.command_bytes)), row = await original.row();
    assert.equal(encoded.request.command, "FINALIZE_USE"); assert.notEqual(encoded.original_command_id, id);
    assert.equal(encoded.request.proof_submission_id, ack.submission_id); assert.equal(encoded.request.challenge_id, original.challenge);
    assert.equal(row.final_command_uuid, encoded.original_command_id); assert.equal(row.final_claimed_at, null);
    const recovered = await journal.prepareAuthorityFinalization(id, context); assert.equal(recovered.command_bytes, final.command_bytes);
    assert.equal(recovered.command_digest, final.command_digest); assert.equal(recovered.send_ticket, null);
    const noProof = await makeOriginal(); await assert.rejects(journal.prepareAuthorityFinalization(noProof.command.command_id, context));
  });
  await check("FINALIZE-native-dispatch-claim-is-single-use", async () => {
    await journal.claimAuthorityFinalization(id, final.send_ticket!, context);
    const before = await original.row(); assert.ok(before.final_claimed_at);
    await assert.rejects(journal.claimAuthorityFinalization(id, final.send_ticket!, context));
    assert.equal((await original.row()).revision, before.revision);
  });
  const receipt = await original.receipt(), claims = JSON.parse(Buffer.from(receipt.toString().split(".")[1], "base64url").toString());
  const response = { profile: "urn:marty:delegation-command-response:v1", original_command_id: (await original.row()).final_command_uuid,
    command_digest: final.command_digest, recovered: false, result: { kind: "FINAL_USE", challenge_id: original.challenge, decision: "PERMIT",
      receipt_ref: "urn:marty:delegated-receipt:" + claims.id, receipt_digest: "sha256:" + createHash("sha256").update(receipt).digest("hex"),
      recorded_at: new Date(await clock()).toISOString(), authorization_expires_at: claims.expires_at, semantics: "EVIDENCE_ONLY" } };
  await check("original-final-result-correlation-and-immutable-recovery", async () => {
    await assert.rejects(journal.observeAuthorityFinalization(id, bytes({ ...response, original_command_id: id }), false, context));
    assert.equal((await original.row()).final_response_bytes, null);
    await journal.observeAuthorityFinalization(id, bytes(response), false, context);
    const before = await original.row();
    await journal.observeAuthorityFinalization(id, bytes({ ...response, recovered: true }), true, context);
    assert.equal((await original.row()).revision, before.revision);
    await assert.rejects(journal.observeAuthorityFinalization(id, bytes({ ...response, result: { ...response.result, decision: "DENY" } }), false, context));
  });
  await check("signed-receipt-must-match-retained-final-result-before-C8-admission", async () => {
    const different = await original.receipt();
    await assert.rejects(journal.verifyAuthorityReceipt(id, different, context, verifier)); assert.equal((await original.row()).receipt_bytes, null);
    const result = await journal.verifyAuthorityReceipt(id, receipt, context, verifier);
    assert.equal(result.receipt_digest, response.result.receipt_digest); assert.equal((await original.row()).state, "awaiting_authority");
  });
  await check("genuine-DENY-remains-terminal-and-cannot-admit-a-PERMIT-receipt", async () => {
    const another = await makeOriginal(), otherId = another.command.command_id;
    const prepared = await journal.prepareAuthorityProof(otherId, proof, context, requestVerifier);
    await journal.claimAuthorityProofDispatch(otherId, prepared.send_ticket!, digest, context, requestVerifier); prepared.prepared.close();
    await journal.observeAuthorityProof(otherId, bytes({ ...ack, submission_id: randomUUID(), challenge_id: another.challenge, received_at: new Date(await clock()).toISOString() }), digest, context);
    const intent = await journal.prepareAuthorityFinalization(otherId, context);
    const signed = await another.receipt(), payload = JSON.parse(Buffer.from(signed.toString().split(".")[1], "base64url").toString());
    const denied = { ...response, original_command_id: (await another.row()).final_command_uuid, command_digest: intent.command_digest,
      result: { ...response.result, challenge_id: another.challenge, decision: "DENY", receipt_ref: "urn:marty:delegated-receipt:" + payload.id,
        receipt_digest: "sha256:" + createHash("sha256").update(signed).digest("hex"), recorded_at: new Date(await clock()).toISOString(), authorization_expires_at: payload.expires_at } };
    assert.equal((await journal.observeAuthorityFinalization(otherId, bytes(denied), false, context)).decision, "DENY");
    const recovered = await journal.prepareAuthorityFinalization(otherId, context); assert.equal(recovered.send_ticket, null); assert.equal(recovered.command_bytes, intent.command_bytes);
    await assert.rejects(journal.verifyAuthorityReceipt(otherId, signed, context, verifier)); assert.equal((await another.row()).receipt_bytes, null);
  });
  await check("historical-proof-recovery-does-not-require-a-new-current-C7-request", async () => {
    const historical = await makeOriginal(true, 2), historicalId = historical.command.command_id;
    const prepared = await journal.prepareAuthorityProof(historicalId, proof, context, requestVerifier);
    await journal.claimAuthorityProofDispatch(historicalId, prepared.send_ticket!, digest, context, requestVerifier); prepared.prepared.close();
    const deadline = (await historical.row()).request_expires_at.getTime();
    while (await clock() < deadline + 50) await delay(50);
    await assert.rejects(journal.recoverVerifiedAuthorityRequest(historicalId, context, requestVerifier));
    const recovered = await journal.prepareAuthorityProof(historicalId, proof, context); assert.equal(recovered.recovery_only, true); recovered.prepared.close();
    await journal.checkAuthorityProofRecovery(historicalId, digest, context);
  });
  await check("fresh-process-lost-proof-and-FINALIZE-acknowledgements-preserve-one-original", async () => {
    const another = await makeOriginal(), command_id = another.command.command_id;
    const task = { command_id, context, requestTrust: fixture.requestTrust };
    const lostProof = await runWorker({ ...task, mode: "proof-intent-lose-ack", proof: proof.toString("base64") }); assert.equal(lostProof.code, 79, lostProof.output);
    const before = await another.row(); assert.equal(before.proof_digest, digest); assert.equal(before.proof_claimed_at, null);
    await assert.rejects(journal.prepareAuthorityProof(command_id, proof, context));
    await assert.rejects(journal.checkAuthorityProofRecovery(command_id, digest, context)); assert.deepEqual(await another.row(), before);
    const admitted = await makeOriginal(), admittedId = admitted.command.command_id;
    const prepared = await journal.prepareAuthorityProof(admittedId, proof, context, requestVerifier);
    await journal.claimAuthorityProofDispatch(admittedId, prepared.send_ticket!, digest, context, requestVerifier); prepared.prepared.close();
    const admittedTask = { ...task, command_id: admittedId };
    const originalAck = { ...ack, submission_id: randomUUID(), challenge_id: admitted.challenge, received_at: new Date(await clock()).toISOString() };
    const lostAck = await runWorker({ ...admittedTask, mode: "proof-ack-lose-ack", ack: originalAck, proof_digest: digest }); assert.equal(lostAck.code, 79, lostAck.output);
    const retainedAck = await admitted.row(); await journal.observeAuthorityProof(admittedId, bytes({ ...originalAck, recovered: true }), digest, context);
    assert.equal((await admitted.row()).proof_submission_observed_at.getTime(), retainedAck.proof_submission_observed_at.getTime());
    const lostFinal = await runWorker({ ...admittedTask, mode: "final-intent-lose-ack" }); assert.equal(lostFinal.code, 79, lostFinal.output);
    const retainedFinal = await admitted.row(); assert.ok(retainedFinal.final_command_uuid); assert.equal(retainedFinal.final_claimed_at, null);
    const newProcess = await runWorker({ ...admittedTask, mode: "recover" }); assert.equal(newProcess.code, 0, newProcess.output);
    assert.ok(newProcess.output.includes(retainedFinal.final_command_digest)); assert.ok(newProcess.output.includes(retainedFinal.final_command_uuid));
    assert.deepEqual(await admitted.row(), retainedFinal);
  });
  await check("deferred-COMMIT-failure-rolls-back-proof-and-final-intent", async () => {
    const another = await makeOriginal(), commandId = another.command.command_id;
    await postgres.raw(`create function public.c9_fail_commit() returns trigger language plpgsql as $$ begin if new.original_command_uuid='${commandId}' and (new.proof_context_bytes is not null or new.final_command_uuid is not null) then raise exception 'C9_TEST_COMMIT_FAILURE'; end if; return new; end $$`);
    await postgres.raw("create constraint trigger c9_commit after update on rifare_operation deferrable initially deferred for each row execute function public.c9_fail_commit()");
    const before = await another.row();
    try { await assert.rejects(journal.prepareAuthorityProof(commandId, proof, context, requestVerifier), /C9_TEST_COMMIT_FAILURE/); }
    finally { await postgres.raw("drop trigger c9_commit on rifare_operation; drop function public.c9_fail_commit()"); }
    assert.deepEqual(await another.row(), before);
    const prepared = await journal.prepareAuthorityProof(commandId, proof, context, requestVerifier);
    await journal.claimAuthorityProofDispatch(commandId, prepared.send_ticket!, digest, context, requestVerifier); prepared.prepared.close();
    await journal.observeAuthorityProof(commandId, bytes({ ...ack, submission_id: randomUUID(), challenge_id: another.challenge, received_at: new Date(await clock()).toISOString() }), digest, context);
    const proofOnly = await another.row();
    await postgres.raw(`create function public.c9_fail_final() returns trigger language plpgsql as $$ begin if new.original_command_uuid='${commandId}' and new.final_command_uuid is not null then raise exception 'C9_TEST_FINAL_COMMIT_FAILURE'; end if; return new; end $$`);
    await postgres.raw("create constraint trigger c9_final after update on rifare_operation deferrable initially deferred for each row execute function public.c9_fail_final()");
    try { await assert.rejects(journal.prepareAuthorityFinalization(commandId, context), /C9_TEST_FINAL_COMMIT_FAILURE/); }
    finally { await postgres.raw("drop trigger c9_final on rifare_operation; drop function public.c9_fail_final()"); }
    assert.deepEqual(await another.row(), proofOnly);
  });
  await check("cancellation-during-actual-blocked-proof-UPDATE-rolls-back-context", async () => {
    const another = await makeOriginal(), commandId = another.command.command_id, before = await another.row(), cancellation = new AbortController();
    const blocker = await postgres.transaction(); await blocker("rifare_operation").where({ original_command_uuid: commandId }).forUpdate().first();
    const rejected = assert.rejects(journal.prepareAuthorityProof(commandId, proof, context, requestVerifier, cancellation.signal));
    try {
      let blocked = false;
      for (let n = 0; n < 100; n++) {
        const result = await postgres.raw("select 1 from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and wait_event_type='Lock' and query like 'update %rifare_operation%proof_context_bytes%'");
        if (result.rows.length) { blocked = true; break; } await delay(20);
      }
      assert.ok(blocked, "actual proof-context UPDATE must block"); cancellation.abort();
    } finally { await blocker.commit(); }
    await rejected; assert.deepEqual(await another.row(), before);
  });
  await check("late-COMMIT-retains-proof-history-without-returning-current-dispatch", async () => {
    const another = await makeOriginal(true, 2), commandId = another.command.command_id;
    await postgres.raw(`create function public.c9_delay_commit() returns trigger language plpgsql as $$ begin if new.original_command_uuid='${commandId}' and new.proof_context_bytes is not null then perform pg_sleep(2.2); end if; return new; end $$`);
    await postgres.raw("create constraint trigger c9_delay after update on rifare_operation deferrable initially deferred for each row execute function public.c9_delay_commit()");
    try { await assert.rejects(journal.prepareAuthorityProof(commandId, proof, context, requestVerifier)); }
    finally { await postgres.raw("drop trigger c9_delay on rifare_operation; drop function public.c9_delay_commit()"); }
    const retained = await another.row(); assert.equal(retained.proof_digest, digest); assert.equal(retained.proof_claimed_at, null);
    await assert.rejects(journal.prepareAuthorityProof(commandId, proof, context));
    await assert.rejects(journal.checkAuthorityProofRecovery(commandId, digest, context)); assert.deepEqual(await another.row(), retained);
  });
  await check("ownership-withdrawal-blocks-proof-and-final-recovery", async () => {
    await postgres("auth_identity").where({ id: fixture.identity.id }).update({ app_metadata: { customer_id: "cus_withdrawn" } });
    assert.equal((await postgres("auth_identity").where({ id: fixture.identity.id }).first()).app_metadata.customer_id, "cus_withdrawn");
    await assert.rejects(journal.checkAuthorityProofRecovery(id, digest, context)); await assert.rejects(journal.prepareAuthorityFinalRecovery(id, context));
    await postgres("auth_identity").where({ id: fixture.identity.id }).update({ app_metadata: { customer_id: fixture.customer.id } });
  });
  await check("privacy-export-hold-minimization-and-final-refusal-continuity", async () => {
    const exported = await journal.exportPrivacySubject(fixture.customer.id, privacyActor);
    const row = exported.find(value => value.original_command_uuid === id)!;
    assert.equal(row.proof_digest, digest); assert.ok(row.final_command_uuid); assert.equal(row.final_command_bytes, final.command_bytes);
    assert.ok(!JSON.stringify(exported).includes(proof.toString()));
    assert.equal(await journal.setPrivacyHold(fixture.customer.id, row.id, row.revision, true, privacyActor), true);
    await journal.erasePrivacySubject(fixture.customer.id, privacyActor);
    const held = await original.row(); assert.equal(held.state, "retired"); assert.equal(held.proof_digest, digest); assert.equal(held.final_command_bytes, final.command_bytes);
    await assert.rejects(journal.prepareAuthorityFinalRecovery(id, context));
    assert.equal(await journal.setPrivacyHold(fixture.customer.id, held.id, held.revision, false, privacyActor), true);
    const minimized = await original.row(); assert.equal(minimized.final_command_uuid, held.final_command_uuid);
    for (const name of ["proof_context_bytes", "proof_context_digest", "proof_digest", "proof_owner_digest", "proof_claimed_at", "proof_submission_bytes", "proof_submission_digest", "proof_submission_observed_at", "final_command_bytes", "final_command_digest", "final_owner_digest", "final_claimed_at", "final_response_bytes", "final_response_digest", "final_response_observed_at"]) assert.equal(minimized[name], null, name);
    const refusal = { id: minimized.id, original_command_uuid: id, challenge_fingerprint: minimized.challenge_fingerprint, receipt_fingerprint: minimized.receipt_fingerprint, final_command_uuid: minimized.final_command_uuid };
    await journal.restorePrivacyRefusals([refusal], privacyActor);
    const { final_command_uuid: _missing, ...oldRefusal } = refusal; await assert.rejects(journal.restorePrivacyRefusals([oldRefusal], privacyActor));
    await assert.rejects(journal.restorePrivacyRefusals([{ ...refusal, final_command_uuid: randomUUID() }], privacyActor));
  });
  intent.prepared.close(); requestVerifier.close(); verifier.close();
  console.log("RIFARE_CONTINUATION_RETENTION_RESULT=" + JSON.stringify({ result: "pass", checks: checks.length, source: "native-postgresql-synthetic-signatures", execution_authorized: false }));
}
