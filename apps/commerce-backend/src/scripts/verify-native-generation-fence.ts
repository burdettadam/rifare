import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { discoveryPath } from "@medusajs/medusa/payment";
import { nativePaymentFixture } from "./native-payment-fixture";
import { requireNativeExecutionProfile, retireOriginalExecutionWorker } from "../modules/operation-journal/execution-claim";

/** Journal-generation primitive on already-open actual native worker sessions.
 * No workflow dispatch, current-grant/row visibility or full C12 is claimed. */
export default async function verifyNativeGenerationFence({ container }: ExecArgs) {
  requireNativeExecutionProfile();
  const postgres = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  if (process.env.RIFARE_C12_GENERATION_TASK) {
    const task = JSON.parse(process.env.RIFARE_C12_GENERATION_TASK), carts = container.resolve(Modules.CART);
    const identity = (await postgres.raw("select session_user as role, pg_backend_pid() as pid")).rows[0];
    assert.equal(identity.role, task.role);
    await assert.rejects(postgres.raw('set role "postgres"'), (error: any) => error.code === "42501");
    await assert.rejects(postgres.raw('set session authorization "postgres"'), (error: any) => error.code === "42501");
    await assert.rejects(postgres.raw("set session_replication_role='replica'"), (error: any) => error.code === "42501");
    await assert.rejects(postgres.raw("alter table public.cart disable trigger rifare_native_generation"), (error: any) => error.code === "42501");
    await assert.rejects(postgres.raw("select public.rifare_install_native_generation_fences()"), (error: any) => error.code === "42501");
    const require = createRequire(discoveryPath), Native = require(resolve(dirname(discoveryPath), "providers/system.js")).SystemPaymentProvider;
    const names = ["initiatePayment", "authorizePayment", "capturePayment", "refundPayment", "cancelPayment"];
    const originals = new Map<string, any>(), calls = Object.fromEntries(names.map(name => [name, 0]));
    for (const name of names) {
      originals.set(name, Native.prototype[name]);
      Native.prototype[name] = async function(...args: any[]) { calls[name]++; return originals.get(name).apply(this, args); };
    }
    try {
      await carts.updateCarts(task.cart_id, { metadata: { c12_generation_probe: "current", asserted_generation: 999, asserted_worker: "postgres" } });
      const resumed = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Native generation resume deadline")), 15000);
        process.once("message", message => { clearTimeout(timer); try { assert.deepEqual(message, { phase: "resume" }); resolve(); } catch (error) { reject(error); } });
      });
      assert.equal(typeof process.send, "function"); process.send!({ phase: "ready", identity });
      await resumed;
      // A new-login prohibition does not close this established authenticated
      // backend. Neither session labels nor custom GUC assertions authenticate.
      await postgres.raw("select set_config('application_name','postgres',false), set_config('rifare.execution_generation','1',false)");
      const same = (await postgres.raw("select session_user as role, pg_backend_pid() as pid")).rows[0];
      assert.deepEqual(same, identity, "Stale refusal must exercise the already-open backend");
      const refused = async (table: string, run: () => Promise<unknown>) => {
        await assert.rejects(run(), (error: any) => error.code === "42501" && error.message.includes("Native execution generation unavailable on " + table),
          "C12 stale authenticated worker must be refused at the native write boundary");
        console.log("C12_NATIVE_GENERATION_REFUSAL=" + table);
      };
      await refused("cart", () => carts.updateCarts(task.cart_id, { metadata: { c12_generation_probe: "stale", asserted_generation: 1 } }));
      await refused("cart_line_item", () => carts.addLineItems({ cart_id: task.cart_id, title: "Synthetic stale line", quantity: 1, unit_price: 1 }));
      await refused("order_address", () => container.resolve(Modules.ORDER).createOrders({ customer_id: task.customer_id,
        currency_code: "usd", email: "c12-generation@example.invalid", shipping_address: { first_name: "Synthetic", last_name: "Generation",
          address_1: "1 Synthetic Street", city: "Synthetic", country_code: "us", postal_code: "00000" } }));
      await refused("reservation_item", () => container.resolve(Modules.INVENTORY).createReservationItems({ inventory_item_id: task.inventory_item_id,
        location_id: task.location_id, quantity: 1, line_item_id: task.line_item_id }));
      await refused("payment_session", () => container.resolve(Modules.PAYMENT).createPaymentSession(task.collection_id, {
        provider_id: "pp_rifare_fenced_system_fixture", currency_code: "usd", amount: 12.5, data: {} }));
      assert.deepEqual(calls, Object.fromEntries(names.map(name => [name, 0])));
      assert.equal((await postgres.raw("select pg_backend_pid() as pid")).rows[0].pid, identity.pid);
      console.log("C12_NATIVE_GENERATION_WORKER=" + JSON.stringify({ same_authenticated_backend: true, native_tables: 5, native_system_calls: calls }));
    } finally { for (const [name, original] of originals) Native.prototype[name] = original; }
    return;
  }
  const f = await nativePaymentFixture(container, false, true), original = await f.makePaymentOriginal();
  const inventory = container.resolve(Modules.INVENTORY), locations = container.resolve(Modules.STOCK_LOCATION);
  const item = await inventory.createInventoryItems({ sku: "c12-generation-" + randomBytes(8).toString("hex") });
  const location = await locations.createStockLocations({ name: "C12 synthetic generation" });
  await inventory.createInventoryLevels({ inventory_item_id: item.id, location_id: location.id, stocked_quantity: 5 });
  const line = await postgres("cart_line_item").where({ cart_id: original.cart.id }).first("id");
  for (const trigger of ["rifare_native_generation", "rifare_native_generation_commit"]) {
    const before = await original.row();
    const roles = Number((await postgres.raw("select count(*) as n from pg_roles where rolname ~ '^rifare_exec_[a-f0-9]{32}$'")).rows[0].n);
    await postgres.raw(`alter table public.cart disable trigger ${trigger}`);
    try {
      assert.equal((await postgres.raw("select public.rifare_native_generation_ready() as ready")).rows[0].ready, false);
      await assert.rejects(f.journal.claimNativeExecution(original.command.command_id, f.context, f.verifier), /NATIVE_GENERATION_FENCE_NOT_READY/);
      assert.deepEqual(await original.row(), before);
      assert.equal(Number((await postgres.raw("select count(*) as n from pg_roles where rolname ~ '^rifare_exec_[a-f0-9]{32}$'")).rows[0].n), roles);
    } finally { await postgres.raw(`alter table public.cart enable trigger ${trigger}`); }
  }
  assert.equal((await postgres.raw("select public.rifare_native_generation_ready() as ready")).rows[0].ready, true);
  const claim = await f.journal.claimNativeExecution(original.command.command_id, f.context, f.verifier);
  assert.ok(claim.worker); assert.ok(claim.seal);
  const missing = (await postgres.raw(`select p.tablename from pg_catalog.pg_tables p where p.schemaname='public'
    and (has_table_privilege(?,format('%I.%I',p.schemaname,p.tablename),'INSERT')
      or has_table_privilege(?,format('%I.%I',p.schemaname,p.tablename),'UPDATE')
      or has_table_privilege(?,format('%I.%I',p.schemaname,p.tablename),'DELETE'))
    and (not exists(select 1 from pg_catalog.pg_trigger where tgrelid=to_regclass(format('%I.%I',p.schemaname,p.tablename))
      and tgname='rifare_native_generation' and tgtype=62 and tgenabled='O' and tgfoid='public.rifare_guard_native_generation()'::regprocedure)
      or not exists(select 1 from pg_catalog.pg_trigger where tgrelid=to_regclass(format('%I.%I',p.schemaname,p.tablename))
      and tgname='rifare_native_generation_commit' and tgtype=29 and tgenabled='O' and tgdeferrable and tginitdeferred
      and tgfoid='public.rifare_guard_native_generation()'::regprocedure))`, [claim.worker!.role,claim.worker!.role,claim.worker!.role])).rows;
  assert.deepEqual(missing, [], "Every actually granted native write table needs both generation boundaries");
  const custody = process.env.RIFARE_C12_GENERATION_CUSTODY!; assert.ok(custody.endsWith("-private.json"));
  writeFileSync(custody, JSON.stringify({ source: process.env.RIFARE_C12_SOURCE, original_id: original.command.command_id,
    worker: claim.worker, seal: claim.seal }, null, 2), { flag: "wx", mode: 0o600 });
  const definition = (await postgres.raw("select pg_get_functiondef(to_regprocedure('public.rifare_guard_native_generation()')) as definition")).rows[0].definition as string | null;
  const fault = process.env.RIFARE_C12_GENERATION_FAULT === "omit";
  if (fault) assert.ok(definition, "The enforcement fault requires an installed generation function");
  await postgres.raw(`create table public.rifare_c12_generation_audit(id bigserial primary key,native_table text not null,authenticated_role text not null);
    create function public.rifare_c12_generation_observe() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$ begin
      if session_user::text ~ '^rifare_exec_[a-f0-9]{32}$' then insert into public.rifare_c12_generation_audit(native_table,authenticated_role) values(TG_TABLE_NAME,session_user); end if;
      return coalesce(NEW,OLD); end $$`);
  const tables = ["cart", "cart_line_item", "order_address", "order", "order_item", "order_line_item", "order_summary", "order_cart", "order_payment_collection",
    "reservation_item", "inventory_level", "payment_collection", "payment_session", "payment", "capture", "refund"];
  for (const table of tables) await postgres.raw(`create trigger rifare_c12_generation_audit after insert or update or delete on public."${table}"
    for each row execute function public.rifare_c12_generation_observe()`);
  const snapshot = async () => {
    const rows: Record<string, unknown> = {}; for (const table of tables) rows[table] = await postgres(table).orderBy("id");
    return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  };
  const database = new URL(process.env.DATABASE_URL!); database.username = claim.worker!.role; database.password = claim.worker!.password;
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: database.href, MEDUSA_WORKER_MODE: "server",
    RIFARE_C12_NATIVE_WORKER: JSON.stringify({ role: claim.worker!.role }), RIFARE_C12_GENERATION_TASK: JSON.stringify({ role: claim.worker!.role,
      cart_id: original.cart.id, customer_id: f.customer.id, collection_id: original.collection.id, line_item_id: line.id,
      inventory_item_id: item.id, location_id: location.id }) };
  for (const key of Object.keys(env)) if (key.startsWith("PG") || key.endsWith("_CUSTODY") || /(?:API_KEY|_TOKEN|_PASSWORD|_SECRET|_PRIVATE_KEY|_CREDENTIALS)$/.test(key) ||
    key.endsWith("DATABASE_URL") && key !== "DATABASE_URL" || key.startsWith("RIFARE_JOURNAL_PRIVACY_") || key.startsWith("RIFARE_C12_CONTROLLER_")) delete env[key];
  env.JWT_SECRET = randomBytes(32).toString("hex"); env.COOKIE_SECRET = randomBytes(32).toString("hex");
  let beforeStale: string | undefined, beforeAudit: unknown, parentFailure: unknown;
  try {
    const result = await new Promise<{ code: number | null; output: string }>((complete, reject) => {
      const compiled = __filename.endsWith(".js"), entry = resolvePath();
      function resolvePath() { return resolve(dirname(__filename), "native-execution-worker-entry." + (compiled ? "js" : "ts")); }
      const args = compiled ? [entry] : ["-r", "ts-node/register", "-r", "tsconfig-paths/register", entry];
      const child = spawn(process.execPath, args, { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe", "ipc"] });
      let output = "", ready = false;
      const timer = setTimeout(() => { child.kill(); reject(new Error("Native generation worker deadline")); }, 45000);
      for (const stream of [child.stdout!, child.stderr!]) stream.on("data", data => { output = (output + data).slice(-30000); });
      child.on("message", message => { void (async () => {
        assert.equal(ready, false); ready = true;
        const phase = message as any; assert.equal(phase.phase, "ready"); assert.equal(phase.identity.role, claim.worker!.role);
        assert.equal((await postgres("cart").where({ id: original.cart.id }).first()).metadata.c12_generation_probe, "current");
        beforeAudit = await postgres("rifare_c12_generation_audit").orderBy("id");
        assert.equal((beforeAudit as any[]).length, 1); beforeStale = await snapshot();
        await retireOriginalExecutionWorker(postgres, claim.worker!.role);
        const revoked = await original.row(); assert.equal(revoked.execution_generation, 2); assert.ok(revoked.execution_revoked_at);
        if (fault) await postgres.raw(`create or replace function public.rifare_guard_native_generation() returns trigger
          language plpgsql security definer set search_path=pg_catalog,public as $$ begin return null; end $$`);
        child.send({ phase: "resume" });
      })().catch(error => { parentFailure = error; child.kill(); }); });
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("close", code => {
        clearTimeout(timer);
        try { writeFileSync(custody.replace("-private.json", "-worker-native.log"), output, { flag: "wx", mode: 0o600 }); complete({ code, output }); }
        catch (error) { reject(error); }
      });
    });
    writeFileSync(custody.replace("-private.json", "-observations.json"), JSON.stringify({ worker_exit: result.code, before_stale: beforeStale,
      after_stale: await snapshot(), audit: await postgres("rifare_c12_generation_audit").orderBy("id"), fault }, null, 2), { flag: "wx" });
    if (parentFailure) throw parentFailure;
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /C12_NATIVE_MODULE_WORKER_SHUTDOWN=complete/);
    assert.equal(await snapshot(), beforeStale, "Stale native writes must have zero effects, including early address and reservation rows");
    assert.deepEqual(await postgres("rifare_c12_generation_audit").orderBy("id"), beforeAudit);
    console.log(result.output.split(/\r?\n/).filter(value => value.startsWith("C12_NATIVE_GENERATION_")).join("\n"));
    console.log("C12_NATIVE_GENERATION_RESULT=" + JSON.stringify({ result: "pass", actual_native_stale_write_refusals: 5,
      same_existing_authenticated_session: true, original_visibility_qualified: false, current_authority_fence_qualified: false,
      provider_effect_time_fence_qualified: false, full_C12_qualified: false }));
  } finally {
    if (fault && definition) {
      await postgres.raw(definition);
      assert.equal((await postgres.raw("select pg_get_functiondef('public.rifare_guard_native_generation()'::regprocedure) as definition")).rows[0].definition, definition);
      console.log("C12_NATIVE_GENERATION_FAULT_RESTORED=exact");
    }
    await retireOriginalExecutionWorker(postgres, claim.worker!.role); f.requestVerifier.close(); f.verifier.close();
  }
}
