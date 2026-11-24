import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { nativePaymentFixture } from "./native-payment-fixture";
import { ensureNativeGenerationInstallation, requireNativeExecutionProfile, retireOriginalExecutionWorker } from "../modules/operation-journal/execution-claim";

/** Reproduces the first real upstream completion blocker. A passing baseline means
 * completion was refused and its concrete native residue was captured. */
export default async function verifyNativeCompletionBaseline({ container }: ExecArgs) {
  requireNativeExecutionProfile();
  const postgres = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  await ensureNativeGenerationInstallation(postgres);
  const fixture = await nativePaymentFixture(container, false, true);
  let workerRole: string | undefined;
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
  const digest = async () => {
    const rows: Record<string, unknown> = {};
    for (const table of tables) rows[table] = await postgres(table).orderBy("id");
    return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  };
  try {
    tables = (await postgres("pg_catalog.pg_tables").where({ schemaname: "public" })
      .whereIn("tablename", writableTables).pluck("tablename")).sort();
    assert.ok(tables.length > 0);
    const original = await fixture.makePaymentOriginal();
    const claim = await fixture.journal.claimNativeExecution(original.command.command_id, fixture.context, fixture.verifier);
    workerRole = claim.worker?.role;
    assert.equal(claim.disposition, "claimed_unknown"); assert.ok(claim.worker);
    const before = await digest();
    const database = new URL(process.env.DATABASE_URL!);
    database.username = claim.worker.role; database.password = claim.worker.password;
    const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: database.href, MEDUSA_WORKER_MODE: "server",
      RIFARE_C12_NATIVE_WORKER: JSON.stringify({ role: claim.worker.role }),
      RIFARE_C12_GENERATION_TASK: JSON.stringify({ role: claim.worker.role, cart_id: original.cart.id, healthy_completion: true }) };
    for (const key of Object.keys(env)) if (key.startsWith("PG") || key.endsWith("_CUSTODY") ||
      /(?:API_KEY|_TOKEN|_PASSWORD|_SECRET|_PRIVATE_KEY|_CREDENTIALS)$/.test(key) ||
      key.endsWith("DATABASE_URL") && key !== "DATABASE_URL" || key.startsWith("RIFARE_JOURNAL_PRIVACY_") ||
      key.startsWith("RIFARE_C12_CONTROLLER_")) delete env[key];
    env.JWT_SECRET = randomBytes(32).toString("hex"); env.COOKIE_SECRET = randomBytes(32).toString("hex");
    const compiled = __filename.endsWith(".js"), entry = resolve(dirname(__filename), "native-execution-worker-entry." + (compiled ? "js" : "ts"));
    const args = compiled ? [entry] : ["-r", "ts-node/register", "-r", "tsconfig-paths/register", entry];
    const child = await new Promise<{ code: number | null; output: string }>((resolveChild, reject) => {
      const processChild = spawn(process.execPath, args, { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe"] });
      let output = ""; const timer = setTimeout(() => { processChild.kill("SIGKILL"); reject(new Error("Native completion baseline deadline")); }, 60000);
      for (const stream of [processChild.stdout, processChild.stderr]) stream.on("data", data => { output = (output + data).slice(-40000); });
      processChild.once("error", error => { clearTimeout(timer); reject(error); });
      processChild.once("close", code => { clearTimeout(timer); resolveChild({ code, output }); });
    });
    assert.notEqual(child.code, 0, child.output);
    const line = child.output.split(/\r?\n/).find(value => value.startsWith("C12_NATIVE_HEALTHY_COMPLETION_OBSERVATION="));
    assert.ok(line, child.output);
    const observation = JSON.parse(line.slice("C12_NATIVE_HEALTHY_COMPLETION_OBSERVATION=".length));
    assert.ok(observation.errors.length > 0); assert.equal(observation.system_calls.authorizePayment, 0);
    const after = await digest(), residue = before !== after;
    assert.equal(residue, false);
    console.log("C12_NATIVE_COMPLETION_BASELINE=" + JSON.stringify({ result: "reproduced", errors: observation.errors,
      native_commerce_write_residue: residue, inspected_native_tables: tables.length,
      system_authorizations: observation.system_calls.authorizePayment,
      healthy_completion_qualified: false, full_C12_qualified: false }));
  } finally {
    try { if (workerRole) await retireOriginalExecutionWorker(postgres, workerRole); }
    finally { fixture.requestVerifier.close(); fixture.verifier.close(); }
  }
}
