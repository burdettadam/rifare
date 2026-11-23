import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, ModulesSdkUtils } from "@medusajs/framework/utils";
import { nativePaymentFixture } from "./native-payment-fixture";
import { bytes } from "./native-receipt-fixture";
import { operationJournalModule } from "../modules/operation-journal";
import type OperationJournalService from "../modules/operation-journal/service";
import { executionFingerprint, requireNativeExecutionProfile } from "../modules/operation-journal/execution-claim";

/** Genuine retained C7/C8/C9 evidence plus actual PostgreSQL durable first claim.
 * No native completion or provider authorization is dispatched by this stage. */
export default async function verifyNativeExecutionClaim({ container }: ExecArgs) {
  requireNativeExecutionProfile();
  if (process.env.RIFARE_C12_CLAIM_WORKER) {
    const task = JSON.parse(process.env.RIFARE_C12_CLAIM_WORKER);
    const journal = container.resolve<OperationJournalService>(operationJournalModule);
    const verifier = await journal.createAuthorityReceiptVerifier(bytes(task.trust));
    try {
      const result = await journal.claimNativeExecution(task.id, task.context, verifier);
      assert.equal(result.disposition, "recovery_only"); assert.equal(result.worker, null); assert.equal(result.seal, null);
      console.log("C12_CLAIM_RESTART_RECOVERY_ONLY"); return;
    } finally { verifier.close(); }
  }
  const f = await nativePaymentFixture(container, false, true), { journal, postgres, context, verifier } = f;
  const checks: string[] = [], check = async (name: string, run: () => Promise<void>) => {
    await run(); checks.push(name); console.log("C12_CLAIM_CHECK " + name);
  };
  const roleCount = async () => Number((await postgres.raw("select count(*) as n from pg_roles where rolname ~ '^rifare_exec_[a-f0-9]{32}$'")).rows[0].n);
  const financial = async () => {
    const rows: Record<string, unknown> = {};
    for (const table of ["cart", "cart_line_item", "order", "reservation_item", "payment_collection", "payment_session", "payment", "capture", "refund"])
      rows[table] = await postgres(table).orderBy("id");
    return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  };
  const noEffect = async (run: () => Promise<unknown>) => {
    const before = await financial(); try { return await run(); } finally { assert.equal(await financial(), before); }
  };
  const sample = await f.makePaymentOriginal(), id = sample.command.command_id;
  let claim: Awaited<ReturnType<OperationJournalService["claimNativeExecution"]>>;
  await check("C12-CLAIM-FIRST genuine finalization and receipt consume one durable original without a native effect", async () => {
    const count = await roleCount();
    claim = await noEffect(() => journal.claimNativeExecution(id, context, verifier)) as typeof claim;
    assert.equal(claim.disposition, "claimed_unknown"); assert.equal(claim.execution_authorized, false); assert.equal(claim.native_fence_qualified, false);
    assert.ok(claim.worker); assert.ok(claim.seal); assert.equal(await roleCount(), count + 1);
    const row = await sample.row(); assert.equal(row.state, "unknown"); assert.equal(row.execution_generation, 1);
    assert.equal(row.execution_owner_fingerprint, executionFingerprint(claim.worker!.role));
    assert.equal(row.execution_seal_fingerprint, executionFingerprint(claim.seal!));
    assert.equal(row.execution_payment_handle_fingerprint, executionFingerprint(sample.session.data.rifare_native_execution.handle));
    assert.equal(row.payment_provider_id, "pp_rifare_fenced_system_fixture");
    assert.equal(row.execution_revoked_at, null); assert.equal(row.payable_minor_units, "1250");
    assert.equal(row.execution_expires_at.getTime(), row.receipt_expires_at.getTime());
    assert.ok(process.env.RIFARE_C12_CLAIM_CUSTODY?.endsWith("-private.json"));
    writeFileSync(process.env.RIFARE_C12_CLAIM_CUSTODY!, JSON.stringify({ source: process.env.RIFARE_C12_SOURCE,
      original_id: id, worker: claim.worker, seal: claim.seal }, null, 2), { flag: "wx", mode: 0o600 });
  });
  await check("C12-CLAIM-REPEAT uncertainty returns recovery only and never another worker or seal", async () => {
    const before = await sample.row(), count = await roleCount();
    for (let i = 0; i < 2; i++) {
      const result = await noEffect(() => journal.claimNativeExecution(id, context, verifier)) as typeof claim;
      assert.equal(result.disposition, "recovery_only"); assert.equal(result.worker, null); assert.equal(result.seal, null);
    }
    assert.deepEqual(await sample.row(), before); assert.equal(await roleCount(), count);
  });
  await check("C12-CLAIM-RESTART a distinct controller process cannot resend the claimed original", async () => {
    const count = await roleCount(), before = await sample.row();
    const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      const child = spawn(process.execPath, ["run.mjs", "exec", __filename], { cwd: process.cwd(), env: { ...process.env,
        RIFARE_C12_CLAIM_WORKER: JSON.stringify({ id, trust: f.trust, context }) }, stdio: ["ignore", "pipe", "pipe"] });
      let output = ""; const timer = setTimeout(() => { child.kill(); reject(new Error("C12 claim worker deadline")); }, 45000);
      for (const stream of [child.stdout, child.stderr]) stream.on("data", value => { output = (output + value).slice(-16000); });
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("exit", code => { clearTimeout(timer); resolve({ code, output }); });
    });
    assert.equal(result.code, 0, result.output); assert.match(result.output, /C12_CLAIM_RESTART_RECOVERY_ONLY/);
    assert.deepEqual(await sample.row(), before); assert.equal(await roleCount(), count);
  });
  await check("C12-CLAIM-IMMUTABLE SQL cannot reset owner generation seal attempt time or uncertainty", async () => {
    const row = await sample.row();
    for (const change of [{ execution_owner_fingerprint: "sha256:" + "1".repeat(64) }, { execution_generation: 0 },
      { execution_seal_fingerprint: null }, { execution_claimed_at: new Date(row.execution_claimed_at.getTime() + 1) },
      { execution_expires_at: new Date(row.execution_expires_at.getTime() + 1) }, { state: "awaiting_authority" },
      { execution_revoked_at: new Date() }]) {
      await assert.rejects(postgres("rifare_operation").where({ id: row.id }).update(change), (error: any) => error.code === "23514");
      assert.deepEqual(await sample.row(), row);
    }
    await assert.rejects(journal.cancel(id, row.revision, context));
  });
  await check("C12-CLAIM-ROLE native login cannot read or forge journal authority or become controller", async () => {
    const url = new URL(process.env.DATABASE_URL!); url.username = claim!.worker!.role; url.password = claim!.worker!.password;
    const pool = ModulesSdkUtils.createPgConnection({ clientUrl: url.href, pool: { min: 0, max: 1 } });
    try {
      assert.equal((await pool.raw("select session_user as role")).rows[0].role, claim!.worker!.role);
      assert.ok(await pool("cart").where({ id: sample.cart.id }).first("id"));
      await assert.rejects(pool("rifare_operation").select("id"), (error: any) => error.code === "42501");
      await assert.rejects(pool("rifare_operation").where({ id: (await sample.row()).id }).update({ execution_generation: 999 }), (error: any) => error.code === "42501");
      const controller = (await postgres.raw("select session_user as role")).rows[0].role;
      assert.match(controller, /^[a-zA-Z0-9_]+$/);
      await assert.rejects(pool.raw('set role "' + controller + '"'), (error: any) => error.code === "42501");
    } finally { await pool.destroy(); }
  });
  await check("C12-CLAIM-ADMISSION missing genuine final or receipt and legacy System cannot mint a worker", async () => {
    for (const options of [{ withFinalization: false }, { retainReceipt: false }, { providerId: "pp_system_default" }]) {
      const other = await f.makePaymentOriginal(options), before = await other.row(), count = await roleCount();
      await noEffect(() => assert.rejects(journal.claimNativeExecution(other.command.command_id, context, verifier)));
      assert.deepEqual(await other.row(), before); assert.equal(await roleCount(), count);
    }
    const other = await f.makePaymentOriginal(), before = await other.row(), count = await roleCount();
    await assert.rejects(journal.claimNativeExecution(other.command.command_id, context, { verified: true }));
    const previous = process.env.RIFARE_TEST_NATIVE_EXECUTION; delete process.env.RIFARE_TEST_NATIVE_EXECUTION;
    try { await assert.rejects(journal.claimNativeExecution(other.command.command_id, context, verifier)); }
    finally { process.env.RIFARE_TEST_NATIVE_EXECUTION = previous; }
    assert.deepEqual(await other.row(), before); assert.equal(await roleCount(), count);
  });
  await check("C12-CLAIM-PRIVACY hold erasure revokes generation and minimization retains refusal identity", async () => {
    const first = await sample.row();
    assert.equal(await journal.setPrivacyHold(f.customer.id, first.id, first.revision, true, f.privacyActor), true);
    await journal.erasePrivacySubject(f.customer.id, f.privacyActor);
    const held = await sample.row(); assert.equal(held.state, "retired"); assert.equal(held.execution_generation, 2);
    assert.ok(held.execution_revoked_at instanceof Date); assert.equal(held.execution_owner_fingerprint, first.execution_owner_fingerprint);
    assert.ok(held.execution_claimed_at instanceof Date);
    const exported = await journal.exportPrivacySubject(f.customer.id, f.privacyActor);
    assert.ok(exported.some((row: any) => row.id === first.id && row.execution_owner_fingerprint === first.execution_owner_fingerprint));
    assert.equal(await journal.setPrivacyHold(f.customer.id, held.id, held.revision, false, f.privacyActor), true);
    const minimized = await sample.row();
    for (const field of ["execution_claimed_at", "execution_expires_at", "execution_order_id"]) assert.equal(minimized[field], null);
    for (const field of ["execution_owner_fingerprint", "execution_seal_fingerprint", "execution_payment_handle_fingerprint"])
      assert.equal(minimized[field], first[field]);
    assert.equal(minimized.execution_generation, 2);
    const count = await roleCount(); await assert.rejects(journal.claimNativeExecution(id, context, verifier)); assert.equal(await roleCount(), count);
  });
  f.requestVerifier.close(); verifier.close();
  console.log("C12_NATIVE_EXECUTION_CLAIM_RESULT=" + JSON.stringify({ result: "pass", checks,
    dispatch_implemented: false, native_early_write_fencing_qualified: false, full_C12_qualified: false,
    connected_authority_qualified: false, production_qualified: false }));
}
