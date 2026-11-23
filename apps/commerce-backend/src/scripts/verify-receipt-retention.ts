import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { operationJournalModule } from "../modules/operation-journal";
import type OperationJournalService from "../modules/operation-journal/service";
import { bytes, nativeReceiptFixture } from "./native-receipt-fixture";

const fields = ["receipt_bytes", "receipt_digest", "receipt_context_digest", "receipt_id", "receipt_observed_at", "receipt_expires_at"];

export default async function verifyReceiptRetention({ container }: ExecArgs) {
  if (process.env.NODE_ENV !== "test" || process.env.RIFARE_COMMERCE_VERIFY !== "disposable") throw new Error("RIFARE_DISPOSABLE_RECEIPT_TEST_REQUIRED");
  const journal = container.resolve<OperationJournalService>(operationJournalModule), postgres = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  if (process.env.RIFARE_C8_COMPILED === "true") {
    assert.ok(__filename.endsWith(".js")); assert.ok(journal instanceof require("../modules/operation-journal/service").default);
  }
  if (process.env.RIFARE_C8_WORKER) {
    const task = JSON.parse(process.env.RIFARE_C8_WORKER), verifier = await journal.createAuthorityReceiptVerifier(bytes(task.trust));
    const result = task.mode === "recover" ? await journal.recoverVerifiedAuthorityReceipt(task.command_id, task.context, verifier) :
      await journal.verifyAuthorityReceipt(task.command_id, Buffer.from(task.artifact), task.context, verifier);
    if (task.mode === "retain-lose-ack") process.exit(79);
    console.log("C8_RECOVERED=" + JSON.stringify({ digest: result.receipt_digest, observed_at: result.first_observed_at })); verifier.close(); return;
  }
  const phase = process.env.RIFARE_C8_RESTORE_PHASE;
  if (phase && phase !== "seed") {
    const fixture = JSON.parse(process.env.RIFARE_C8_RESTORE_FIXTURE ?? "");
    process.env.RIFARE_MERCHANT_NAMESPACE = fixture.merchant.merchant_namespace; process.env.RIFARE_NATIVE_STORE_ID = fixture.merchant.store_id;
    process.env.RIFARE_JOURNAL_PRIVACY_OPERATOR_ID = fixture.privacyActor.actor_id;
    const row = () => postgres("rifare_operation").where({ original_command_uuid: fixture.command_id }).first();
    const before = await row(); assert.equal(before.receipt_digest, fixture.receipt_digest); assert.ok(before.receipt_bytes);
    if (phase === "erase") {
      await journal.erasePrivacySubject(fixture.context.actor.actor_id, fixture.privacyActor);
      const current = await row(); assert.equal(current.receipt_bytes, null); assert.equal(current.receipt_fingerprint, before.receipt_fingerprint);
      console.log("C8_RESTORE_CURRENT_REFUSAL=" + JSON.stringify({ id: current.id, original_command_uuid: current.original_command_uuid,
        challenge_fingerprint: current.challenge_fingerprint, receipt_fingerprint: current.receipt_fingerprint })); return;
    }
    assert.ok(phase === "reconcile-erase" || phase === "reconcile-uninstall");
    const refusal = JSON.parse(process.env.RIFARE_C8_RESTORE_REFUSAL ?? "null");
    const reconcile = () => phase === "reconcile-erase" ? journal.reconcilePrivacyRestore([refusal], [fixture.context.actor.actor_id], fixture.privacyActor) :
      journal.reconcilePrivacyRestore([], [], fixture.privacyActor, { installationUninstalled: true });
    await reconcile(); await reconcile(); const after = await row(); assert.equal(after.state, "retired");
    assert.equal(after.receipt_fingerprint, before.receipt_fingerprint); for (const field of fields) assert.equal(after[field], null);
    const verifier = await journal.createAuthorityReceiptVerifier(bytes(fixture.trust));
    await assert.rejects(journal.recoverVerifiedAuthorityReceipt(fixture.command_id, fixture.context, verifier)); verifier.close();
    console.log("C8_DATABASE_RESTORE_RESULT=" + JSON.stringify({ result: "pass", phase, source: "restored-whole-postgres-database", execution_authorized: false })); return;
  }
  const f = await nativeReceiptFixture(container);
  const { context, trust, verifier, makeOriginal } = f;
  if (phase === "seed") {
    const fixture = await makeOriginal(); await journal.verifyAuthorityReceipt(fixture.command.command_id, await fixture.receipt(), context, verifier);
    const row = await fixture.row(); console.log("C8_RESTORE_FIXTURE=" + JSON.stringify({ merchant: f.merchant, privacyActor: f.privacyActor, context, trust,
      command_id: fixture.command.command_id, receipt_digest: row.receipt_digest, receipt_fingerprint: row.receipt_fingerprint }));
    f.requestVerifier.close(); verifier.close(); return;
  }
  const checks: string[] = [], check = async (name: string, run: () => unknown) => { await run(); checks.push(name); console.log("RECEIPT_RETENTION_CHECK " + name); };
  const runWorker = (task: unknown) => new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["run.mjs", "exec", __filename], { cwd: process.cwd(), env: { ...process.env, RIFARE_C8_WORKER: JSON.stringify(task) }, stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; const timer = setTimeout(() => { child.kill(); reject(new Error("C8 child deadline")); }, 45000);
    for (const stream of [child.stdout, child.stderr]) stream.on("data", data => { output = (output + data).slice(-16000); });
    child.once("error", error => { clearTimeout(timer); reject(error); }); child.once("exit", code => { clearTimeout(timer); resolve({ code, output }); });
  });
  await check("C8-NATIVE-FIRST retained native context commits one inert immutable receipt", async () => {
    const fixture = await makeOriginal(), artifact = await fixture.receipt(), before = await fixture.row();
    await assert.rejects(journal.verifyAuthorityReceipt(fixture.command.command_id, Buffer.from("unverified"), context, verifier));
    assert.deepEqual(await fixture.row(), before);
    await assert.rejects(postgres("rifare_operation").where({ id: before.id }).update({ receipt_id: randomUUID() }), /rifare_operation_receipt_tuple/);
    const first = await journal.verifyAuthorityReceipt(fixture.command.command_id, artifact, context, verifier), stored = await fixture.row();
    assert.equal(stored.state, "awaiting_authority"); assert.equal(stored.receipt_bytes, artifact.toString()); assert.equal(stored.revision, before.revision + 1);
    assert.equal(stored.receipt_digest, "sha256:" + createHash("sha256").update(artifact).digest("hex")); assert.match(stored.receipt_fingerprint, /^sha256:[a-f0-9]{64}$/);
    assert.equal(verifier.describe(first.verification).execution_authorized, false);
    const retry = await journal.recoverVerifiedAuthorityReceipt(fixture.command.command_id, context, verifier);
    assert.equal(retry.first_observed_at.getTime(), first.first_observed_at.getTime()); assert.deepEqual(await fixture.row(), stored);
    await assert.rejects(journal.verifyAuthorityReceipt(fixture.command.command_id, await fixture.receipt(), context, verifier));
    const changed = await journal.createAuthorityReceiptVerifier(bytes({ ...trust, delegated_ceiling: { currency: "usd", maximum_minor: "999998" } }));
    await assert.rejects(journal.recoverVerifiedAuthorityReceipt(fixture.command.command_id, context, changed)); changed.close(); assert.deepEqual(await fixture.row(), stored);
  });
  await check("C8-NATIVE-RACE independently valid competing receipts have one native winner", async () => {
    const fixture = await makeOriginal(), artifacts = [await fixture.receipt(), await fixture.receipt()];
    const results = await Promise.allSettled(artifacts.map(artifact => journal.verifyAuthorityReceipt(fixture.command.command_id, artifact, context, verifier)));
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    const row = await fixture.row(); assert.ok(artifacts.some(artifact => artifact.toString() === row.receipt_bytes));
    await journal.recoverVerifiedAuthorityReceipt(fixture.command.command_id, context, verifier); assert.deepEqual(await fixture.row(), row);
  });
  await check("C8-NATIVE-CONTEXT missing C7 observation cross-original and current native owner fail closed", async () => {
    const first = await makeOriginal(), second = await makeOriginal(), missing = await makeOriginal(false), artifact = await first.receipt();
    await assert.rejects(journal.verifyAuthorityReceipt(missing.command.command_id, await missing.receipt(), context, verifier));
    await assert.rejects(journal.verifyAuthorityReceipt(second.command.command_id, artifact, context, verifier));
    await f.auth.updateAuthIdentities({ id: f.identity.id, app_metadata: { customer_id: "cus_other" } });
    try { await assert.rejects(journal.verifyAuthorityReceipt(first.command.command_id, artifact, context, verifier)); }
    finally { await f.auth.updateAuthIdentities({ id: f.identity.id, app_metadata: { customer_id: f.customer.id } }); }
    assert.equal((await first.row()).receipt_bytes, null); assert.equal((await second.row()).receipt_bytes, null);
  });
  await check("C8-NATIVE-CART changed persisted cart cannot reuse admitted receipt or original", async () => {
    const fixture = await makeOriginal(); await journal.verifyAuthorityReceipt(fixture.command.command_id, await fixture.receipt(), context, verifier);
    const before = await fixture.row(), [line] = await container.resolve(Modules.CART).listLineItems({ cart_id: fixture.cart.id });
    await container.resolve(Modules.CART).updateLineItems(line.id, { quantity: 2 });
    await assert.rejects(journal.recoverVerifiedAuthorityReceipt(fixture.command.command_id, context, verifier)); assert.deepEqual(await fixture.row(), before);
  });
  await check("C8-NATIVE-REPLAY receipt identity remains unique after original minimization", async () => {
    const first = await makeOriginal(), id = randomUUID(); await journal.verifyAuthorityReceipt(first.command.command_id, await first.receipt(id), context, verifier);
    const before = await first.row(); await journal.cancel(first.command.command_id, before.revision, context); const retired = await first.row();
    assert.equal(retired.receipt_bytes, null); assert.equal(retired.receipt_fingerprint, before.receipt_fingerprint);
    const second = await makeOriginal(); await assert.rejects(journal.verifyAuthorityReceipt(second.command.command_id, await second.receipt(id), context, verifier), /rifare_operation_receipt_unique/);
    assert.equal((await second.row()).receipt_bytes, null);
    const legacy = { id: retired.id, original_command_uuid: retired.original_command_uuid, challenge_fingerprint: retired.challenge_fingerprint };
    await assert.rejects(journal.restorePrivacyRefusals([legacy], f.privacyActor), /conflicting journal refusal/);
    const current = { ...legacy, receipt_fingerprint: retired.receipt_fingerprint };
    await postgres("rifare_operation").where({ id: retired.id }).update({ receipt_fingerprint: null });
    await journal.restorePrivacyRefusals([current], f.privacyActor); await journal.restorePrivacyRefusals([current], f.privacyActor);
    assert.equal((await first.row()).receipt_fingerprint, retired.receipt_fingerprint);
  });
  await check("C8-NATIVE-ROLLBACK deferred COMMIT failure leaves no partial receipt or revision", async () => {
    const fixture = await makeOriginal(), before = await fixture.row();
    await postgres.raw(`create function public.c8_fail_commit() returns trigger language plpgsql as $$ begin if new.original_command_uuid='${fixture.command.command_id}' and new.receipt_bytes is not null then raise exception 'C8_TEST_COMMIT_FAILURE'; end if; return new; end $$`);
    await postgres.raw("create constraint trigger c8_commit after update on rifare_operation deferrable initially deferred for each row execute function public.c8_fail_commit()");
    try { await assert.rejects(journal.verifyAuthorityReceipt(fixture.command.command_id, await fixture.receipt(), context, verifier), /C8_TEST_COMMIT_FAILURE/); }
    finally { await postgres.raw("drop trigger c8_commit on rifare_operation; drop function public.c8_fail_commit()"); }
    assert.deepEqual(await fixture.row(), before);
  });
  await check("C8-NATIVE-RESTART lost acknowledgement and fresh process preserve exact bytes and time", async () => {
    const fixture = await makeOriginal(), artifact = await fixture.receipt(), task = { trust, context, command_id: fixture.command.command_id };
    const lost = await runWorker({ ...task, mode: "retain-lose-ack", artifact: artifact.toString() }); assert.equal(lost.code, 79, lost.output);
    const before = await fixture.row(); assert.equal(before.receipt_bytes, artifact.toString());
    const recovered = await runWorker({ ...task, mode: "recover" }); assert.equal(recovered.code, 0, recovered.output);
    assert.ok(recovered.output.includes(before.receipt_digest)); assert.ok(recovered.output.includes(before.receipt_observed_at.toISOString())); assert.deepEqual(await fixture.row(), before);
  });
  await check("C8-NATIVE-CLOSE retirement while an actual UPDATE is blocked rolls back all receipt fields", async () => {
    const fixture = await makeOriginal(), selected = await journal.createAuthorityReceiptVerifier(bytes(trust));
    const blocker = await postgres.transaction(); await blocker("rifare_operation").where({ original_command_uuid: fixture.command.command_id }).forUpdate().first();
    const rejected = assert.rejects(journal.verifyAuthorityReceipt(fixture.command.command_id, await fixture.receipt(), context, selected), /NATIVE_RECEIPT_UNAVAILABLE/);
    try {
      let blocked = false; for (let n = 0; n < 100; n++) {
        const result = await postgres.raw("select 1 from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and wait_event_type='Lock' and query like 'update %rifare_operation%receipt_bytes%'");
        if (result.rows.length) { blocked = true; break; } await delay(20);
      }
      assert.ok(blocked, "actual receipt UPDATE must block on the owned native row"); selected.close();
    } finally { await blocker.commit(); }
    await rejected; assert.equal((await fixture.row()).receipt_bytes, null);
  });
  await check("C8-NATIVE-COMMIT-EXPIRY late commit retains history but returns no current verification", async () => {
    const fixture = await makeOriginal(), artifact = await fixture.receipt(randomUUID(), 1500);
    await postgres.raw(`create function public.c8_delay_commit() returns trigger language plpgsql as $$ begin if new.original_command_uuid='${fixture.command.command_id}' and new.receipt_bytes is not null then perform pg_sleep(1.7); end if; return new; end $$`);
    await postgres.raw("create constraint trigger c8_delay after update on rifare_operation deferrable initially deferred for each row execute function public.c8_delay_commit()");
    try { await assert.rejects(journal.verifyAuthorityReceipt(fixture.command.command_id, artifact, context, verifier)); }
    finally { await postgres.raw("drop trigger c8_delay on rifare_operation; drop function public.c8_delay_commit()"); }
    const before = await fixture.row(); assert.equal(before.receipt_bytes, artifact.toString());
    await assert.rejects(journal.recoverVerifiedAuthorityReceipt(fixture.command.command_id, context, verifier)); assert.deepEqual(await fixture.row(), before);
  });
  await check("C8-NATIVE-COMMIT-OWNER current owner withdrawn at COMMIT refuses returning evidence", async () => {
    const fixture = await makeOriginal(), artifact = await fixture.receipt();
    await postgres.raw(`create function public.c8_owner_commit() returns trigger language plpgsql as $$ begin if new.original_command_uuid='${fixture.command.command_id}' and new.receipt_bytes is not null then update auth_identity set app_metadata='{"customer_id":"cus_other"}'::jsonb where id='${f.identity.id}'; end if; return new; end $$`);
    await postgres.raw("create constraint trigger c8_owner after update on rifare_operation deferrable initially deferred for each row execute function public.c8_owner_commit()");
    try { await assert.rejects(journal.verifyAuthorityReceipt(fixture.command.command_id, artifact, context, verifier), /Cart context unavailable/); }
    finally { await postgres.raw("drop trigger c8_owner on rifare_operation; drop function public.c8_owner_commit()"); await f.auth.updateAuthIdentities({ id: f.identity.id, app_metadata: { customer_id: f.customer.id } }); }
    const before = await fixture.row(); assert.equal(before.receipt_bytes, artifact.toString());
    await journal.recoverVerifiedAuthorityReceipt(fixture.command.command_id, context, verifier); assert.deepEqual(await fixture.row(), before);
  });
  await check("C8-NATIVE-CLOCK persisted observation prevents fresh-verifier clock rewind", async () => {
    const fixture = await makeOriginal(); await journal.verifyAuthorityReceipt(fixture.command.command_id, await fixture.receipt(), context, verifier);
    const before = await fixture.row(), fresh = await journal.createAuthorityReceiptVerifier(bytes(trust));
    await postgres("rifare_operation").where({ id: before.id }).update({ receipt_observed_at: new Date(before.receipt_observed_at.getTime() + 2000) });
    try { await assert.rejects(journal.recoverVerifiedAuthorityReceipt(fixture.command.command_id, context, fresh)); }
    finally { fresh.close(); await postgres("rifare_operation").where({ id: before.id }).update({ receipt_observed_at: before.receipt_observed_at }); }
    assert.deepEqual(await fixture.row(), before);
  });
  await check("C8-NATIVE-HISTORICAL-REQUEST committed authenticated request remains context after JWT expiry", async () => {
    const fixture = await makeOriginal(true, 2); await delay(2200); const artifact = await fixture.receipt();
    await assert.rejects(journal.recoverVerifiedAuthorityRequest(fixture.command.command_id, context, f.requestVerifier));
    const result = await journal.verifyAuthorityReceipt(fixture.command.command_id, artifact, context, verifier);
    assert.equal(verifier.describe(result.verification).nonce, fixture.nonce); assert.equal((await fixture.row()).state, "awaiting_authority");
  });
  await check("C8-NATIVE-PRIVACY hold export erasure release and restored suppression cover every receipt field", async () => {
    const fixture = await makeOriginal(); await journal.verifyAuthorityReceipt(fixture.command.command_id, await fixture.receipt(), context, verifier);
    let before = await fixture.row(); assert.equal(await journal.setPrivacyHold(f.customer.id, before.id, before.revision, true, f.privacyActor), true);
    const exported = await journal.exportPrivacySubject(f.customer.id, f.privacyActor), held = exported.find(row => row.id === before.id)!;
    for (const field of fields) assert.ok(held[field]);
    await journal.erasePrivacySubject(f.customer.id, f.privacyActor); before = await fixture.row(); assert.ok(before.receipt_bytes); assert.equal(before.state, "retired");
    await assert.rejects(journal.recoverVerifiedAuthorityReceipt(fixture.command.command_id, context, verifier));
    assert.equal(await journal.setPrivacyHold(f.customer.id, before.id, before.revision, false, f.privacyActor), true);
    const after = await fixture.row(); for (const field of fields) assert.equal(after[field], null); assert.equal(after.receipt_fingerprint, before.receipt_fingerprint);
    await journal.reconcilePrivacyRestore([{ id: after.id, original_command_uuid: after.original_command_uuid,
      challenge_fingerprint: after.challenge_fingerprint, receipt_fingerprint: after.receipt_fingerprint }], [f.customer.id], f.privacyActor);
    assert.deepEqual(await fixture.row(), after);
  });
  f.requestVerifier.close(); verifier.close();
  console.log(JSON.stringify({ result: "pass", count: checks.length, checks, scope: "native-postgres-receipt-retention", connected_qualified: false, execution_authorized: false }));
}
