import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { nativePaymentFixture } from "./native-payment-fixture";
import { ensureNativeGenerationInstallation, executionFingerprint, requireNativeExecutionProfile, retireOriginalExecutionWorker } from "../modules/operation-journal/execution-claim";

/** Qualifies the current actual upstream completion boundary through a genuine
 * restricted worker. Full stale/recovery C12 remains a separate gate. */
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
  const snapshot = async () => {
    const rows: Record<string, unknown> = {};
    for (const table of tables) rows[table] = await postgres(table).orderBy("id");
    return rows;
  };
  try {
    tables = (await postgres("pg_catalog.pg_tables").where({ schemaname: "public" })
      .whereIn("tablename", writableTables).pluck("tablename")).sort();
    assert.ok(tables.length > 0);
    const original = await fixture.makePaymentOriginal();
    const claim = await fixture.journal.claimNativeExecution(original.command.command_id, fixture.context, fixture.verifier);
    workerRole = claim.worker?.role;
    assert.equal(claim.disposition, "claimed_unknown"); assert.ok(claim.worker);
    const before = await snapshot();
    const database = new URL(process.env.DATABASE_URL!);
    database.username = claim.worker.role; database.password = claim.worker.password;
    const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: database.href, MEDUSA_WORKER_MODE: "server",
      RIFARE_C12_NATIVE_WORKER: JSON.stringify({ role: claim.worker.role }),
      RIFARE_C12_GENERATION_TASK: JSON.stringify({ role: claim.worker.role, cart_id: original.cart.id,
        execution_seal: claim.seal, healthy_completion: true }) };
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
    assert.equal(child.code, 0, child.output);
    const line = child.output.split(/\r?\n/).find(value => value.startsWith("C12_NATIVE_HEALTHY_COMPLETION_OBSERVATION="));
    assert.ok(line, child.output);
    const observation = JSON.parse(line.slice("C12_NATIVE_HEALTHY_COMPLETION_OBSERVATION=".length));
    assert.deepEqual(observation.errors, []); assert.match(observation.result_id, /^order_[A-Za-z0-9]+$/);
    assert.deepEqual(observation.system_calls, { initiatePayment: 0, authorizePayment: 1, capturePayment: 0,
      refundPayment: 0, cancelPayment: 0 });
    const after = await snapshot();
    const changedTables = tables.filter(table => JSON.stringify(before[table]) !== JSON.stringify(after[table]));
    const residue = changedTables.length > 0;
    assert.equal(residue, true);
    assert.deepEqual(changedTables, ["cart", "order", "order_address", "order_cart", "order_item", "order_line_item",
      "order_payment_collection", "order_summary", "payment", "payment_collection", "payment_session"]);
    const row = await original.row(), order = await postgres("order").where({ id: observation.result_id }).first();
    assert.equal(row.execution_order_id, observation.result_id);
    assert.equal(row.execution_order_fingerprint, executionFingerprint(observation.result_id));
    assert.equal(row.state, "unknown"); assert.equal(row.execution_generation, 1); assert.equal(row.execution_revoked_at, null);
    assert.ok(row.execution_payment_attempted_at instanceof Date);
    assert.equal(order.metadata.rifare_execution_owner, executionFingerprint(claim.worker.role));
    assert.equal(order.currency_code, original.command.currency); assert.equal(order.customer_id, fixture.customer.id);
    assert.equal(Number(await postgres("order").whereRaw("metadata->>'rifare_execution_owner' = ?",
      [executionFingerprint(claim.worker.role)]).count("id as n").first().then(value => value!.n)), 1);
    for (const [table, delta] of Object.entries({ order: 1, order_address: 1, order_cart: 1, order_item: 1,
      order_line_item: 1, order_payment_collection: 1, payment: 1, payment_collection: 0, payment_session: 0 }))
      assert.equal((after[table] as unknown[]).length - (before[table] as unknown[]).length, delta,
        `Unexpected native row delta for ${table}`);
    assert.equal(Number(await postgres("order_item").where({ order_id: observation.result_id }).count("id as n").first().then(value => value!.n)), 1);
    const originalOrderLinks = await postgres("order_cart").where({ cart_id: original.cart.id });
    assert.equal(originalOrderLinks.length, 1); assert.equal(originalOrderLinks[0].order_id, observation.result_id);
    assert.equal(Number(await postgres("order_payment_collection").where({ order_id: observation.result_id,
      payment_collection_id: original.collection.id }).count("id as n").first().then(value => value!.n)), 1);
    const payments = await postgres("payment").where({ payment_collection_id: original.collection.id,
      payment_session_id: original.session.id });
    assert.equal(payments.length, 1); assert.equal(payments[0].provider_id, "pp_rifare_fenced_system_fixture");
    assert.equal(payments[0].currency_code, original.command.currency);
    assert.equal(String(payments[0].raw_amount.value), String(Number(original.command.payable_minor_units) /
      10 ** original.command.currency_exponent));
    assert.equal(payments[0].data.rifare_native_execution.original_command_id, original.command.command_id);
    console.log("C12_NATIVE_COMPLETION_BASELINE=" + JSON.stringify({ result: "completed", errors: observation.errors,
      native_commerce_write_residue: residue, inspected_native_tables: tables.length,
      changed_native_tables: changedTables,
      system_authorizations: observation.system_calls.authorizePayment,
      order_id: observation.result_id, healthy_completion_qualified: true, full_C12_qualified: false }));
  } finally {
    try { if (workerRole) await retireOriginalExecutionWorker(postgres, workerRole); }
    finally { fixture.requestVerifier.close(); fixture.verifier.close(); }
  }
}
