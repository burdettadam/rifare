import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { nativePaymentFixture } from "./native-payment-fixture";
import { ensureNativeGenerationInstallation, requireNativeExecutionProfile,
  retireOriginalExecutionWorker } from "../modules/operation-journal/execution-claim";

/** Pause the genuine completeCart workflow after its validation hook, retire its
 * original worker, observe recovery in a distinct process, then prove resuming
 * that exact workflow cannot write or delegate through the stale worker. */
export default async function verifyNativeWorkflowReversal({ container }: ExecArgs) {
  requireNativeExecutionProfile();
  const postgres = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  await ensureNativeGenerationInstallation(postgres);
  const fixture = await nativePaymentFixture(container, false, true);
  let role: string | undefined;
  let child: ChildProcess | undefined, childExit: Promise<number | null> | undefined;
  const writableTables = [
    "cart", "cart_address", "cart_line_item", "cart_line_item_adjustment", "cart_line_item_tax_line",
    "cart_shipping_method", "cart_shipping_method_adjustment", "cart_shipping_method_tax_line", "cart_credit_line",
    "order", "order_address", "order_item", "order_line_item", "order_line_item_adjustment", "order_line_item_tax_line",
    "order_shipping", "order_shipping_method", "order_shipping_method_adjustment", "order_shipping_method_tax_line",
    "order_summary", "order_credit_line", "order_transaction", "reservation_item", "payment_collection",
    "payment_session", "payment", "capture", "refund", "order_cart", "order_payment_collection", "order_promotion",
    "cart_payment_collection",
  ];
  let tables: string[] = [];
  const snapshot = async () => Object.fromEntries(await Promise.all(tables.map(async table =>
    [table, await postgres(table).orderBy("id")] as const)));
  try {
    tables = (await postgres("pg_catalog.pg_tables").where({ schemaname: "public" })
      .whereIn("tablename", writableTables).pluck("tablename")).sort();
    assert.equal(tables.length, 31, "Workflow reversal must inspect the complete installed worker-write table set");
    const original = await fixture.makePaymentOriginal();
    const claim = await fixture.journal.claimNativeExecution(original.command.command_id, fixture.context, fixture.verifier);
    assert.equal(claim.disposition, "claimed_unknown"); assert.ok(claim.worker); assert.ok(claim.seal);
    role = claim.worker.role;
    const before = await snapshot();
    const database = new URL(process.env.DATABASE_URL!); database.username = claim.worker.role; database.password = claim.worker.password;
    const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: database.href, MEDUSA_WORKER_MODE: "server",
      RIFARE_C12_NATIVE_WORKER: JSON.stringify({ role: claim.worker.role }),
      RIFARE_C12_GENERATION_TASK: JSON.stringify({ role: claim.worker.role, cart_id: original.cart.id,
        execution_seal: claim.seal, healthy_completion: true, pause_after_validate: true }) };
    for (const key of Object.keys(env)) if (key.startsWith("PG") || key.endsWith("_CUSTODY") ||
      /(?:API_KEY|_TOKEN|_PASSWORD|_SECRET|_PRIVATE_KEY|_CREDENTIALS)$/.test(key) ||
      key.endsWith("DATABASE_URL") && key !== "DATABASE_URL" || key.startsWith("RIFARE_JOURNAL_PRIVACY_") ||
      key.startsWith("RIFARE_C12_CONTROLLER_")) delete env[key];
    env.JWT_SECRET = randomBytes(32).toString("hex"); env.COOKIE_SECRET = randomBytes(32).toString("hex");
    const compiled = __filename.endsWith(".js"), entry = resolve(dirname(__filename), "native-execution-worker-entry." + (compiled ? "js" : "ts"));
    const args = compiled ? [entry] : ["-r", "ts-node/register", "-r", "tsconfig-paths/register", entry];
    const ownedChild = child = spawn(process.execPath, args, { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe", "ipc"] });
    childExit = new Promise<number | null>((resolveExit, reject) => {
      ownedChild.once("error", reject); ownedChild.once("close", resolveExit);
    });
    let output = "";
    for (const stream of [ownedChild.stdout, ownedChild.stderr]) stream!.on("data", data => { output = (output + data).slice(-50000); });
    const validated = await new Promise<any>((resolveMessage, reject) => {
      const timer = setTimeout(() => { ownedChild.kill("SIGKILL"); reject(new Error("completeCart validation pause deadline")); }, 60000);
      ownedChild.once("error", error => { clearTimeout(timer); reject(error); });
      ownedChild.on("message", message => {
        if ((message as any)?.phase === "complete-cart-validated") { clearTimeout(timer); resolveMessage(message); }
      });
    });
    assert.equal(validated.cart_id, original.cart.id); assert.equal(validated.identity.role, claim.worker.role);
    assert.deepEqual(await snapshot(), before, "Validation pause must precede native commerce writes");
    await retireOriginalExecutionWorker(postgres, claim.worker.role);
    const revoked = await original.row(); assert.equal(revoked.execution_generation, 2); assert.ok(revoked.execution_revoked_at);
    const recovery = await new Promise<{ code: number | null; output: string }>((resolveChild, reject) => {
      const generationScript = "./src/scripts/verify-native-generation-fence." + (__filename.endsWith(".js") ? "js" : "ts");
      const recoveryChild = spawn(process.execPath, ["run.mjs", "exec", generationScript], {
        cwd: process.cwd(), env: { ...process.env, RIFARE_C12_GENERATION_RECOVERY_TASK: JSON.stringify({
          id: original.command.command_id, context: fixture.context, trust: fixture.trust }) }, stdio: ["ignore", "pipe", "pipe"] });
      let recoveryOutput = ""; const timer = setTimeout(() => { recoveryChild.kill("SIGKILL"); reject(new Error("workflow recovery deadline")); }, 45000);
      for (const stream of [recoveryChild.stdout, recoveryChild.stderr]) stream.on("data", data => { recoveryOutput = (recoveryOutput + data).slice(-30000); });
      recoveryChild.once("error", error => { clearTimeout(timer); reject(error); });
      recoveryChild.once("close", code => { clearTimeout(timer); resolveChild({ code, output: recoveryOutput }); });
    });
    assert.equal(recovery.code, 0, recovery.output); assert.match(recovery.output, /C12_NATIVE_DISTINCT_RECOVERY_ONLY/);
    ownedChild.send({ phase: "resume-complete-cart" });
    const exit = await new Promise<number | null>((resolveExit, reject) => {
      const timer = setTimeout(() => { ownedChild.kill("SIGKILL"); reject(new Error("stale completeCart resume deadline")); }, 60000);
      childExit!.then(code => { clearTimeout(timer); resolveExit(code); }, error => { clearTimeout(timer); reject(error); });
    });
    assert.equal(exit, 1, output); assert.match(output, /Native execution generation unavailable|new row violates row-level security policy/);
    assert.match(output, /order_line_item/, "Stale workflow must fail during order creation before payment authorization");
    const observationLine = output.split(/\r?\n/).find(value => value.startsWith("C12_NATIVE_HEALTHY_COMPLETION_OBSERVATION="));
    assert.ok(observationLine, output);
    const observation = JSON.parse(observationLine.slice("C12_NATIVE_HEALTHY_COMPLETION_OBSERVATION=".length));
    assert.ok(observation.errors.length > 0); assert.deepEqual(observation.system_calls,
      { initiatePayment: 0, authorizePayment: 0, capturePayment: 0, refundPayment: 0, cancelPayment: 0 });
    assert.deepEqual(await snapshot(), before, "Retired completeCart resume must leave zero native commerce effects");
    assert.equal((await original.row()).execution_generation, 2);
    console.log("C12_NATIVE_WORKFLOW_REVERSAL=" + JSON.stringify({ result: "pass", validated_before_write: true,
      distinct_recovery_before_resume: true, stale_complete_cart_refused: true, inspected_native_tables: tables.length,
      native_effects: 0, system_calls: observation.system_calls,
      full_C12_qualified: false }));
  } finally {
    try {
      if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      if (childExit) await new Promise<void>((resolveCleanup, reject) => {
        const timer = setTimeout(() => reject(new Error("Owned workflow child cleanup deadline")), 10000);
        childExit!.then(() => { clearTimeout(timer); resolveCleanup(); }, () => { clearTimeout(timer); resolveCleanup(); });
      });
    } finally {
      try { if (role) await retireOriginalExecutionWorker(postgres, role); }
      finally { fixture.requestVerifier.close(); fixture.verifier.close(); }
    }
  }
}
