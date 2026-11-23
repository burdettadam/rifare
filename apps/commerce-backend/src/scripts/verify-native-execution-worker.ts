import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { nativePaymentFixture } from "./native-payment-fixture";
import { requireNativeExecutionProfile } from "../modules/operation-journal/execution-claim";

/** Actual native boot/pool proof using a genuinely claimed restricted login.
 * This is not dispatch, original visibility, write fencing or C12 qualification. */
export default async function verifyNativeExecutionWorker({ container }: ExecArgs) {
  requireNativeExecutionProfile();
  const postgres = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  if (process.env.RIFARE_C12_NATIVE_WORKER) {
    const task = JSON.parse(process.env.RIFARE_C12_NATIVE_WORKER);
    const identity = (await postgres.raw("select session_user as authenticated_role, current_user as effective_role, pg_backend_pid() as pid")).rows[0];
    assert.equal(identity.authenticated_role, task.role); assert.equal(identity.effective_role, task.role);
    const cart = await container.resolve(Modules.CART).retrieveCart(task.cart_id);
    const payments: any = container.resolve(Modules.PAYMENT);
    const session = await payments.retrievePaymentSession(task.session_id);
    assert.equal(cart.id, task.cart_id); assert.equal(session.id, task.session_id);
    assert.equal(session.provider_id, "pp_rifare_fenced_system_fixture");
    for (const table of ["rifare_operation", "auth_identity", "user", "api_key", "workflow_execution"])
      await assert.rejects(postgres(table).select("id"), (error: any) => error.code === "42501");
    // Trusted test observation of the actual registered adapter's private pool;
    // this is not a production extension of the upstream native service.
    const provider = payments.paymentProviderService_.retrieveProvider("pp_rifare_fenced_system_fixture");
    const providerIdentity = (await provider.postgres.raw("select session_user as authenticated_role, current_user as effective_role, pg_backend_pid() as pid")).rows[0];
    assert.equal(providerIdentity.authenticated_role, task.role); assert.equal(providerIdentity.effective_role, task.role);
    for (const table of ["payment_provider", "tax_provider", "fulfillment_provider"])
      await assert.rejects(postgres(table).whereRaw("false").update({ is_enabled: false }), (error: any) => error.code === "42501");
    console.log("C12_NATIVE_RESTRICTED_WORKER=" + JSON.stringify({ identity, providerIdentity, actual_cart_and_payment_modules_read: true,
      journal_and_identity_tables_inaccessible: true, native_execution_qualified: false }));
    return;
  }
  const f = await nativePaymentFixture(container, false, true), original = await f.makePaymentOriginal();
  const claim = await f.journal.claimNativeExecution(original.command.command_id, f.context, f.verifier);
  assert.equal(claim.disposition, "claimed_unknown"); assert.ok(claim.worker); assert.ok(claim.seal);
  assert.ok(process.env.RIFARE_C12_WORKER_CUSTODY?.endsWith("-private.json"));
  writeFileSync(process.env.RIFARE_C12_WORKER_CUSTODY!, JSON.stringify({ source: process.env.RIFARE_C12_SOURCE,
    original_id: original.command.command_id, cart_id: original.cart.id, session_id: original.session.id,
    worker: claim.worker, seal: claim.seal }, null, 2), { flag: "wx", mode: 0o600 });
  const database = new URL(process.env.DATABASE_URL!); database.username = claim.worker!.role; database.password = claim.worker!.password;
  const env = { ...process.env, DATABASE_URL: database.href, JWT_SECRET: randomBytes(32).toString("hex"), COOKIE_SECRET: randomBytes(32).toString("hex"),
    RIFARE_C12_NATIVE_WORKER: JSON.stringify({ role: claim.worker!.role, cart_id: original.cart.id, session_id: original.session.id }) };
  for (const key of Object.keys(env)) if (key === "PGPASSWORD" || key.endsWith("_CUSTODY") ||
    key.startsWith("RIFARE_JOURNAL_PRIVACY_") || key.startsWith("RIFARE_C12_CONTROLLER_")) delete (env as any)[key];
  const catalogue = async () => {
    const rows: Record<string, unknown> = {};
    for (const table of ["payment_provider", "tax_provider", "fulfillment_provider"]) rows[table] = await f.postgres(table).orderBy("id");
    return JSON.stringify(rows);
  };
  const beforeCatalogue = await catalogue();
  const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["run.mjs", "exec", __filename], { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; const timer = setTimeout(() => { child.kill(); reject(new Error("C12 native worker deadline")); }, 45000);
    for (const stream of [child.stdout, child.stderr]) stream.on("data", data => { output = (output + data).slice(-24000); });
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", code => { clearTimeout(timer); resolve({ code, output }); });
  });
  console.log("C12_RESTRICTED_WORKER_BOOT_EXIT=" + result.code);
  assert.equal(result.code, 0, result.output);
  assert.doesNotMatch(result.output, /Error syncing|Loaders for module .* failed|Could not resolve module/,
    "A swallowed native loader error cannot count as a successful worker boot");
  assert.equal(await catalogue(), beforeCatalogue, "Native boot must not change provider catalogue state");
  const line = result.output.split(/\r?\n/).find(value => value.startsWith("C12_NATIVE_RESTRICTED_WORKER=")); assert.ok(line);
  console.log(line);
  const row = await original.row(); assert.equal(row.execution_generation, 1); assert.equal(row.execution_revoked_at, null);
  assert.equal((await f.postgres("payment").where({ payment_session_id: original.session.id })).length, 0);
  f.requestVerifier.close(); f.verifier.close();
  console.log("C12_RESTRICTED_WORKER_RESULT=" + JSON.stringify({ result: "pass", native_boot_and_module_pool_qualified: true,
    original_visibility_qualified: false, early_write_fencing_qualified: false, full_C12_qualified: false }));
}
