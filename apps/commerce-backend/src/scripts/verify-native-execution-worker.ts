import assert from "node:assert/strict";
import { resolve as resolvePath } from "node:path";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { nativePaymentFixture } from "./native-payment-fixture";
import { requireNativeExecutionProfile, retireOriginalExecutionWorker } from "../modules/operation-journal/execution-claim";

/** Actual native boot/pool proof using a genuinely claimed restricted login.
 * This is not dispatch, original visibility, write fencing or C12 qualification. */
export default async function verifyNativeExecutionWorker({ container }: ExecArgs) {
  requireNativeExecutionProfile();
  const postgres = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  if (process.env.RIFARE_C12_NATIVE_WORKER) {
    const task = JSON.parse(process.env.RIFARE_C12_NATIVE_WORKER);
    assert.ok(!Object.keys(process.env).some(key => key.startsWith("PG") || key.startsWith("RIFARE_JOURNAL_PRIVACY_") || key.startsWith("RIFARE_C12_CONTROLLER_")));
    const identity = (await postgres.raw("select session_user as authenticated_role, current_user as effective_role, pg_backend_pid() as pid")).rows[0];
    assert.equal(identity.authenticated_role, task.role); assert.equal(identity.effective_role, task.role);
    const cart = await container.resolve(Modules.CART).retrieveCart(task.cart_id);
    const payments: any = container.resolve(Modules.PAYMENT);
    const session = await payments.retrievePaymentSession(task.session_id);
    assert.equal(cart.id, task.cart_id); assert.equal(session.id, task.session_id);
    assert.equal(session.provider_id, "pp_rifare_fenced_system_fixture");
    for (const table of ["rifare_operation", "auth_identity", "user", "api_key", "workflow_execution"])
      await assert.rejects(postgres(table).select("id"), (error: any) => error.code === "42501");
    const pools: Record<string, unknown> = {};
    const observePool = async (key: string, module: any) => {
      assert.equal(typeof module?.baseRepository_?.getFreshManager, "function", "Actual native repository absent: " + key);
      const pool = module.baseRepository_.getFreshManager().getKnex();
      const row = (await pool.raw("select session_user as authenticated_role, current_user as effective_role, pg_backend_pid() as pid")).rows[0];
      assert.equal(row.authenticated_role, task.role); assert.equal(row.effective_role, task.role); pools[key] = row;
    };
    for (const key of [Modules.CART, Modules.PAYMENT, Modules.ORDER, Modules.INVENTORY]) await observePool(key, container.resolve(key));
    const links = container.resolve(ContainerRegistrationKeys.LINK);
    await observePool("cart_payment_link", links.getLinkModule(Modules.CART, "cart_id", Modules.PAYMENT, "payment_collection_id"));
    await observePool("order_cart_link", links.getLinkModule(Modules.ORDER, "order_id", Modules.CART, "cart_id"));
    await assert.rejects(postgres("credit_line").whereRaw("false").update({ reference: "unapproved" }), (error: any) => error.code === "42501");
    // Trusted test observation of the actual registered adapter's private pool;
    // this is not a production extension of the upstream native service.
    const provider = payments.paymentProviderService_.retrieveProvider("pp_rifare_fenced_system_fixture");
    const providerIdentity = (await provider.postgres.raw("select session_user as authenticated_role, current_user as effective_role, pg_backend_pid() as pid")).rows[0];
    assert.equal(providerIdentity.authenticated_role, task.role); assert.equal(providerIdentity.effective_role, task.role);
    for (const table of ["payment_provider", "tax_provider", "fulfillment_provider", "notification_provider"])
      await assert.rejects(postgres(table).whereRaw("false").update({ is_enabled: false }), (error: any) => error.code === "42501");
    console.log("C12_NATIVE_RESTRICTED_WORKER=" + JSON.stringify({ identity, providerIdentity, pools, actual_cart_and_payment_modules_read: true,
      journal_and_identity_tables_inaccessible: true, native_execution_qualified: false }));
    if (task.action === "reject") throw new Error("C12_EXPECTED_EXECUTION_REJECTION");
    if (task.action === "registered-stop-callback") {
      // Invoke this entry's actual registered callback directly. Emitting SIGTERM
      // on this Windows runtime terminated the process before cleanup; do not
      // relabel a callback check as an OS graceful-signal qualification.
      const handlers = process.listeners("SIGTERM").filter(handler => handler.name === "stop");
      assert.equal(handlers.length, 1); handlers[0]("SIGTERM"); return;
    }
    if (task.action === "hard-loss") {
      console.log("C12_NATIVE_WORKER_HARD_LOSS_READY");
      await new Promise<void>(() => { setInterval(() => {}, 1000); });
    }
    return;
  }
  const f = await nativePaymentFixture(container, false, true), original = await f.makePaymentOriginal();
  const claim = await f.journal.claimNativeExecution(original.command.command_id, f.context, f.verifier);
  assert.equal(claim.disposition, "claimed_unknown"); assert.ok(claim.worker); assert.ok(claim.seal);
  try {
  assert.ok(process.env.RIFARE_C12_WORKER_CUSTODY?.endsWith("-private.json"));
  writeFileSync(process.env.RIFARE_C12_WORKER_CUSTODY!, JSON.stringify({ source: process.env.RIFARE_C12_SOURCE,
    original_id: original.command.command_id, cart_id: original.cart.id, session_id: original.session.id,
    worker: claim.worker, seal: claim.seal }, null, 2), { flag: "wx", mode: 0o600 });
  const database = new URL(process.env.DATABASE_URL!); database.username = claim.worker!.role; database.password = claim.worker!.password;
  const env = { ...process.env, MEDUSA_WORKER_MODE: "server", DATABASE_URL: database.href, JWT_SECRET: randomBytes(32).toString("hex"), COOKIE_SECRET: randomBytes(32).toString("hex"),
    RIFARE_C12_NATIVE_WORKER: JSON.stringify({ role: claim.worker!.role, cart_id: original.cart.id, session_id: original.session.id }) };
  for (const key of Object.keys(env)) if (key.startsWith("PG") || key.endsWith("_CUSTODY") ||
    /(?:API_KEY|_TOKEN|_PASSWORD|_SECRET|_PRIVATE_KEY|_CREDENTIALS)$/.test(key) ||
    key.endsWith("DATABASE_URL") && key !== "DATABASE_URL" ||
    key.startsWith("RIFARE_JOURNAL_PRIVACY_") || key.startsWith("RIFARE_C12_CONTROLLER_")) delete (env as any)[key];
  env.JWT_SECRET = randomBytes(32).toString("hex"); env.COOKIE_SECRET = randomBytes(32).toString("hex");
  const catalogue = async () => {
    const rows: Record<string, unknown> = {};
    for (const table of ["payment_provider", "tax_provider", "fulfillment_provider", "notification_provider", "locale"]) rows[table] = await f.postgres(table).orderBy("id");
    return JSON.stringify(rows);
  };
  const beforeCatalogue = await catalogue();
  const nativeRows = async () => {
    const rows: Record<string, unknown> = {};
    for (const table of ["cart", "cart_line_item", "order", "reservation_item", "payment_collection", "payment_session", "payment", "capture", "refund", "workflow_execution"])
      rows[table] = await f.postgres(table).orderBy("id");
    return JSON.stringify(rows);
  };
  const beforeNative = await nativeRows(), beforeOriginal = await original.row();
  const run = (action: string) => new Promise<{ code: number | null; output: string; killedAtReady: boolean }>((resolve, reject) => {
    const compiled = __filename.endsWith(".js");
    const entry = resolvePath(__dirname, "native-execution-worker-entry." + (compiled ? "js" : "ts"));
    const args = compiled ? [entry] : ["-r", "ts-node/register", "-r", "tsconfig-paths/register", entry];
    const child = spawn(process.execPath, args, { cwd: process.cwd(), env: { ...env,
      RIFARE_C12_NATIVE_WORKER: JSON.stringify({ role: claim.worker!.role, cart_id: original.cart.id, session_id: original.session.id, action }) }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "", killedAtReady = false; const timer = setTimeout(() => { child.kill(); reject(new Error("C12 native worker deadline")); }, 45000);
    for (const stream of [child.stdout, child.stderr]) stream.on("data", data => {
      output = (output + data).slice(-24000);
      if (action === "hard-loss" && !killedAtReady && output.includes("C12_NATIVE_WORKER_HARD_LOSS_READY"))
        killedAtReady = child.kill("SIGKILL");
    });
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", code => { clearTimeout(timer); resolve({ code, output, killedAtReady }); });
  });
  const noSessions = async () => {
    const deadline = Date.now() + 2000;
    while (true) {
      const rows = await f.postgres("pg_catalog.pg_stat_activity").where({ usename: claim.worker!.role });
      if (!rows.length) return;
      assert.ok(Date.now() < deadline, "Completed worker must retain no database sessions");
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };
  const result = await run("read");
  console.log("C12_RESTRICTED_WORKER_BOOT_EXIT=" + result.code);
  assert.equal(result.code, 0, result.output);
  assert.doesNotMatch(result.output, /Error syncing|Loaders for module .* failed|Could not resolve module|Failed to load locales/,
    "A swallowed native loader error cannot count as a successful worker boot");
  assert.match(result.output, /C12_NATIVE_MODULE_WORKER_SHUTDOWN=complete/);
  await noSessions();
  assert.equal(await nativeRows(), beforeNative, "Module startup/shutdown cannot write commerce or stored workflow state");
  assert.deepEqual(await original.row(), beforeOriginal);
  assert.equal(await catalogue(), beforeCatalogue, "Native boot must not change provider catalogue state");
  const line = result.output.split(/\r?\n/).find(value => value.startsWith("C12_NATIVE_RESTRICTED_WORKER=")); assert.ok(line);
  console.log(line);
  const row = await original.row(); assert.equal(row.execution_generation, 1); assert.equal(row.execution_revoked_at, null);
  assert.equal((await f.postgres("payment").where({ payment_session_id: original.session.id })).length, 0);
  for (const action of ["reject", "registered-stop-callback"]) {
    const stopped = await run(action); assert.notEqual(stopped.code, 0, stopped.output);
    assert.match(stopped.output, /C12_NATIVE_MODULE_WORKER_SHUTDOWN=complete/);
    assert.match(stopped.output, action === "reject" ? /C12_EXPECTED_EXECUTION_REJECTION/ : /NATIVE_MODULE_WORKER_INTERRUPTED/);
    await noSessions(); assert.equal(await nativeRows(), beforeNative); assert.equal(await catalogue(), beforeCatalogue);
    console.log("C12_NATIVE_WORKER_LIFECYCLE=" + action + ":clean");
  }
  const provider = await f.postgres("payment_provider").where({ id: "pp_rifare_fenced_system_fixture" }).first();
  await f.postgres("payment_provider").where({ id: provider.id }).update({ is_enabled: false });
  try {
    const partial = await run("read"); assert.notEqual(partial.code, 0, partial.output);
    assert.match(partial.output, /permission denied for table payment_provider/);
    assert.match(partial.output, /C12_NATIVE_MODULE_WORKER_SHUTDOWN=complete/);
    assert.equal((await f.postgres("payment_provider").where({ id: provider.id }).first()).is_enabled, false);
    await noSessions(); console.log("C12_NATIVE_WORKER_LIFECYCLE=missing-provisioning:refused-and-clean");
  } finally { await f.postgres("payment_provider").where({ id: provider.id }).update({ is_enabled: provider.is_enabled }); }
  const beforeRoles = Number((await f.postgres.raw("select count(*) as n from pg_roles where rolname ~ '^rifare_exec_[a-f0-9]{32}$'")).rows[0].n);
  const lost = await run("hard-loss"); assert.equal(lost.killedAtReady, true); assert.notEqual(lost.code, 0);
  await noSessions();
  const recovered = await f.journal.claimNativeExecution(original.command.command_id, f.context, f.verifier);
  assert.equal(recovered.disposition, "recovery_only"); assert.equal(recovered.worker, null); assert.equal(recovered.seal, null);
  assert.equal(Number((await f.postgres.raw("select count(*) as n from pg_roles where rolname ~ '^rifare_exec_[a-f0-9]{32}$'")).rows[0].n), beforeRoles);
  assert.equal(await nativeRows(), beforeNative); assert.equal(await catalogue(), beforeCatalogue);
  assert.deepEqual(await original.row(), beforeOriginal);
  console.log("C12_NATIVE_WORKER_LIFECYCLE=actual-owned-process-loss:recovery-only-no-replacement");
  } finally {
    await retireOriginalExecutionWorker(f.postgres, claim.worker!.role);
    f.requestVerifier.close(); f.verifier.close();
  }
  const retired = await original.row(); assert.equal(retired.state, "unknown"); assert.equal(retired.execution_generation, 2);
  assert.ok(retired.execution_revoked_at instanceof Date);
  assert.equal((await f.postgres("pg_catalog.pg_roles").where({ rolname: claim.worker!.role }).first()).rolcanlogin, false);
  console.log("C12_RESTRICTED_WORKER_RESULT=" + JSON.stringify({ result: "pass", native_module_application_boot_and_pool_qualified: true, server_defaults_owned_by_controller: true,
    rejected_execution_and_partial_boot_cleanup: true, controlled_registered_stop_callback_cleanup: true,
    actual_owned_process_loss_recovery_only: true, actual_OS_graceful_signal_qualified: false,
    original_visibility_qualified: false, early_write_fencing_qualified: false, full_C12_qualified: false }));
}
