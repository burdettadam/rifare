import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import type { ExecArgs } from "@medusajs/framework/types";
import { nativePaymentFixture } from "./native-payment-fixture";
import { ensureNativeGenerationInstallation, executionFingerprint, requireNativeExecutionProfile } from "../modules/operation-journal/execution-claim";

/** Actual native prefixes, observed before journal recovery or compensation.
 * Only the disposable child is killed; no commerce rows are manufactured. */
export default async function verifyNativePrefixRestoreSeed({ container }: ExecArgs) {
  requireNativeExecutionProfile();
  const stage = process.env.RIFARE_C12_PREFIX_STAGE;
  const early = ["order-only", "order-cart-only", "order-payment-only", "cart-completed-only"].includes(stage ?? "");
  assert.ok(early || ["pre-payment", "provider-admitted", "unobserved-completion"].includes(stage ?? ""));
  const custody = process.env.RIFARE_C12_PREFIX_CUSTODY;
  assert.ok(custody && isAbsolute(custody) && custody.endsWith("-private.json"));
  assert.ok(/^[A-Za-z0-9_-]{43}$/.test(process.env.RIFARE_JOURNAL_PRIVACY_KEY ?? ""), "Explicit fixture privacy key required");
  const f = await nativePaymentFixture(container, true, true);
  let workerRole: string | undefined;
  let ownedChild: ReturnType<typeof spawn> | undefined;
  let join: Promise<{ code: number | null; signal: string | null }> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
  await ensureNativeGenerationInstallation(f.postgres);
  const original = await f.makePaymentOriginal();
  const claim = await f.journal.claimNativeExecution(original.command.command_id, f.context, f.verifier);
  assert.ok(claim.worker && claim.seal);
  workerRole = claim.worker.role;
  const database = new URL(process.env.DATABASE_URL!);
  database.username = claim.worker.role; database.password = claim.worker.password;
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: database.href, MEDUSA_WORKER_MODE: "server",
    RIFARE_C12_NATIVE_WORKER: JSON.stringify({ role: claim.worker.role }),
    RIFARE_C12_GENERATION_TASK: JSON.stringify({ role: claim.worker.role, cart_id: original.cart.id,
      original_id: original.command.command_id, execution_seal: claim.seal, healthy_completion: true,
      restore_stage: stage, lose_completion_ack: stage === "unobserved-completion" }) };
  for (const key of Object.keys(env)) if (key.startsWith("PG") || key.endsWith("_CUSTODY") ||
    /(?:API_KEY|_TOKEN|_PASSWORD|_SECRET|_PRIVATE_KEY|_CREDENTIALS)$/.test(key) ||
    key.endsWith("DATABASE_URL") && key !== "DATABASE_URL" || key.startsWith("RIFARE_JOURNAL_PRIVACY_") ||
    key.startsWith("RIFARE_C12_CONTROLLER_")) delete env[key];
  env.JWT_SECRET = randomBytes(32).toString("hex"); env.COOKIE_SECRET = randomBytes(32).toString("hex");
  const compiled = __filename.endsWith(".js");
  const entry = resolve(dirname(__filename), "native-execution-worker-entry." + (compiled ? "js" : "ts"));
  const args = compiled ? [entry] : ["-r", "ts-node/register", "-r", "tsconfig-paths/register", entry];
  const child = spawn(process.execPath, args, { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  ownedChild = child;
  let output = "", observed = false;
  const closed = new Promise<{ code: number | null; signal: string | null }>((resolveChild, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolveChild({ code, signal }));
  });
  join = closed;
  // Install all child listeners before waiting. Every error joins the child.
  for (const stream of [child.stdout!, child.stderr!]) stream.on("data", data => { output = (output + data).slice(-40000); });
  const boundary = new Promise<void>((resolveBoundary, reject) => {
    deadline = setTimeout(() => reject(new Error("Native prefix deadline")), 60000);
    child.on("message", (message: any) => {
      try {
        assert.equal(message.phase, "native-prefix-committed");
        assert.equal(message.stage, stage);
        assert.deepEqual(message.system_calls, { initiatePayment: 0, authorizePayment: 0, capturePayment: 0, refundPayment: 0, cancelPayment: 0 });
        observed = true; resolveBoundary();
      } catch (error) { reject(error); }
    });
    closed.then(result => {
      if (stage === "unobserved-completion" && result.code === 79) resolveBoundary();
      else if (!observed) reject(new Error("Native prefix child exited before boundary: " + output));
    }, reject);
  });
    await boundary;
    if (stage !== "unobserved-completion") {
      assert.equal(child.kill("SIGKILL"), true);
    }
    const exit = await closed;
    if (stage === "unobserved-completion") {
      assert.equal(exit.code, 79, output);
      assert.doesNotMatch(output, /C12_NATIVE_HEALTHY_COMPLETION_OBSERVATION=/);
    }
    const row = await original.row();
    assert.equal(row.state, "unknown"); assert.equal(row.execution_generation, 1);
    assert.equal(row.execution_revoked_at, null); assert.equal(row.native_payment_id, null);
    assert.equal(row.native_payment_fingerprint, null);
    assert.ok(row.execution_order_id);
    assert.equal(row.execution_order_fingerprint, executionFingerprint(row.execution_order_id));
    const order = await f.postgres("order").where({ id: row.execution_order_id }).first();
    assert.equal(order.metadata.rifare_execution_owner, executionFingerprint(claim.worker.role));
    assert.equal(order.customer_id, f.customer.id); assert.equal(order.currency_code, original.command.currency);
    const cartLinks = await f.postgres("order_cart").where({ cart_id: original.cart.id });
    const paymentLinks = await f.postgres("order_payment_collection").where({ payment_collection_id: original.collection.id });
    assert.equal(cartLinks.length, early ? Number(stage === "order-cart-only") : 1);
    assert.equal(paymentLinks.length, early ? Number(stage === "order-payment-only") : 1);
    for (const link of [...cartLinks, ...paymentLinks]) assert.equal(link.order_id, order.id);
    assert.equal((await f.postgres("order_item").where({ order_id: order.id })).length, 1);
    const cart = await f.postgres("cart").where({ id: original.cart.id }).first();
    if (early && stage !== "cart-completed-only") assert.equal(cart.completed_at, null);
    else assert.ok(cart.completed_at instanceof Date);
    const payments = await f.postgres("payment").where({ payment_collection_id: original.collection.id, payment_session_id: original.session.id });
    assert.equal(payments.length, stage === "unobserved-completion" ? 1 : 0);
    if (early || stage === "pre-payment") assert.equal(row.execution_payment_attempted_at, null);
    else assert.ok(row.execution_payment_attempted_at instanceof Date);
    if (payments[0]) {
      assert.equal(payments[0].provider_id, "pp_rifare_fenced_system_fixture");
      assert.equal(payments[0].currency_code, original.command.currency);
      assert.equal(String(payments[0].raw_amount.value), String(Number(original.command.payable_minor_units) / 10 ** original.command.currency_exponent));
      assert.equal(payments[0].data.rifare_native_execution.original_command_id, original.command.command_id);
    }
    writeFileSync(custody!, JSON.stringify({ source: process.env.RIFARE_C12_SOURCE,
      original_id: original.command.command_id, prefix: { stage, owner: row.execution_owner_fingerprint,
        seal: row.execution_seal_fingerprint, handle: row.execution_payment_handle_fingerprint,
        order_id: order.id, order_fingerprint: row.execution_order_fingerprint,
        cart_completed_at: cart.completed_at?.toISOString() ?? null,
        attempted_at: row.execution_payment_attempted_at?.toISOString() ?? null, payment_id: payments[0]?.id ?? null },
      privacy: { merchant: f.merchant, customer_id: f.customer.id, actor: f.privacyActor, context: f.context }, trust: f.trust }, null, 2), { flag: "wx", mode: 0o600 });
    console.log("C12_NATIVE_PREFIX_SEED=" + JSON.stringify({ stage, native_order_links: cartLinks.length === 1 && paymentLinks.length === 1,
      cart_links: cartLinks.length, payment_links: paymentLinks.length, cart_completed: cart.completed_at !== null,
      payment_present: payments.length === 1, attempted: row.execution_payment_attempted_at !== null,
      journal_outcome_observed: false, execution_authorized: false }));
  } finally {
    if (deadline) clearTimeout(deadline);
    if (ownedChild && ownedChild.exitCode === null && ownedChild.signalCode === null) ownedChild.kill("SIGKILL");
    try { if (join) await join; }
    finally {
      // Only contain this role. Preserve generation and unknown state for backup.
      try { if (workerRole) await f.postgres.raw(`alter role "${workerRole}" nologin`); }
      finally { f.requestVerifier.close(); f.verifier.close(); }
    }
  }
}
