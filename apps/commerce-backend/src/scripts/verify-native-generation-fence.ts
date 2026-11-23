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
    assert.equal((await postgres.raw("select pg_catalog.has_schema_privilege(session_user,'public','CREATE') as permitted")).rows[0].permitted, false);
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
      const current = { metadata: { c12_generation_probe: "current", asserted_generation: 999, asserted_worker: "postgres" } };
      if (task.ordering) {
        // Observe a real native Cart method inside its actual module transaction,
        // rather than inferring transaction identity from a separate raw write.
        const repository = (carts as any).baseRepository_;
        await repository.transaction(async (transactionManager: any) => {
          const tx = transactionManager.getTransactionContext(); assert.equal(tx?.isTransaction, true);
          const native = (await tx.raw("select session_user as role, pg_backend_pid() as pid")).rows[0];
          assert.equal(native.role, task.role);
          await carts.updateCarts(task.cart_id, current, { transactionManager });
          // MikroORM can defer its SQL flush until outer transaction commit.
          // Pause only after the native UPDATE and its trigger actually ran.
          await transactionManager.flush();
          assert.equal((await tx("cart").where({ id: task.cart_id }).first("metadata")).metadata.c12_generation_probe, "current");
          const release = new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("Native transaction release deadline")), 15000);
            process.once("message", message => { clearTimeout(timer); try { assert.deepEqual(message, { phase: "commit" }); resolve(); } catch (error) { reject(error); } });
          });
          process.send!({ phase: "native-transaction-open", identity: native });
          await release;
        });
      } else await carts.updateCarts(task.cart_id, current);
      if (task.correlation) {
        const refused = async (table: string, run: () => Promise<unknown>) => {
          await assert.rejects(run(), (error: any) => error.code === "42501" && error.message.includes("Native original unavailable on " + table),
            "Current worker must be confined to its exact native original");
          console.log("C12_NATIVE_ORIGINAL_REFUSAL=" + table);
        };
        await refused("cart", () => carts.updateCarts(task.other_cart_id, { metadata: { c12_wrong_original: true } }));
        await refused("cart_line_item", () => carts.addLineItems({ cart_id: task.other_cart_id, title: "Wrong original", quantity: 1, unit_price: 1 }));
        await refused("cart_line_item", () => postgres("cart_line_item").where({ id: task.other_line_id }).update({ cart_id: task.cart_id }));
        await refused("order_address", () => container.resolve(Modules.ORDER).createOrders({ customer_id: task.customer_id,
          currency_code: "usd", email: "wrong-original@example.invalid", shipping_address: { first_name: "Wrong", last_name: "Original",
            address_1: "2 Synthetic Street", city: "Synthetic", country_code: "us", postal_code: "00000" } }));
        await refused("order_address", () => postgres("order_address").where({ id: task.foreign_address_id }).update({ city: "Synthetic" }));
        await refused("reservation_item", () => container.resolve(Modules.INVENTORY).createReservationItems({ inventory_item_id: task.inventory_item_id,
          location_id: task.location_id, quantity: 1, line_item_id: task.foreign_order_line_id }));
        await refused("payment_session", () => container.resolve(Modules.PAYMENT).createPaymentSession(task.other_collection_id, {
          provider_id: "pp_rifare_fenced_system_fixture", currency_code: "usd", amount: 12.5, data: {} }));
        await refused("payment_session", () => postgres("payment_session").where({ id: task.other_session_id }).update({
          payment_collection_id: task.collection_id, provider_id: "pp_rifare_fenced_system_fixture",
          currency_code: "usd", amount: 12.5, raw_amount: task.original_raw_amount }));
        assert.deepEqual(calls, Object.fromEntries(names.map(name => [name, 0])));
        console.log("C12_NATIVE_ORIGINAL_RESULT=" + JSON.stringify({ current_wrong_original_refusals: 8, native_system_calls: calls }));
      }
      if (task.reconnect) {
        assert.equal(typeof process.send, "function");
        // Bound the actual native pools' acquisition wait so a retired login
        // produces an observed refusal instead of waiting on Knex's 60s default.
        // This changes test timing only; connection creation/authentication stays
        // in the installed pools and PostgreSQL.
        const pools = [postgres, (carts as any).baseRepository_.getFreshManager().getKnex()];
        for (const pool of new Set(pools)) {
          assert.ok(pool.client?.pool); pool.client.pool.acquireTimeoutMillis = 2000;
          pool.client.pool.createRetryIntervalMillis = 100; pool.client.pool.propagateCreateError = true;
        }
        const wait = (expected: string) => new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("Native reconnect " + expected + " deadline")), 15000);
          process.once("message", message => { clearTimeout(timer); try { assert.deepEqual(message, { phase: expected }); resolve(); } catch (error) { reject(error); } });
        });
        const reconnect = wait("reconnect"); process.send!({ phase: "ready", identity }); await reconnect;
        let reconnected: any, losses = 0;
        for (let attempt = 0; attempt < 3 && !reconnected; attempt++) {
          try { reconnected = (await postgres.raw("select session_user as role,pg_backend_pid() as pid")).rows[0]; }
          catch (error: any) {
            assert.ok(["57P01", "57P02", "08003", "08006"].includes(error.code), "Unexpected active reconnect error: " + error.code); losses++;
          }
        }
        assert.ok(reconnected); assert.equal(reconnected.role, task.role); assert.notEqual(reconnected.pid, identity.pid);
        await carts.updateCarts(task.cart_id, { metadata: { c12_generation_probe: "reconnected-current" } });
        const resume = wait("resume"); process.send!({ phase: "reconnected", identity: reconnected, previous_pid: identity.pid, losses }); await resume;
        let direct: any, directError: any;
        try { direct = await postgres.client.acquireRawConnection(); }
        catch (error) { directError = error; }
        if (direct) await postgres.client.destroyRawConnection(direct);
        let pooled: any, poolError: any;
        try { pooled = await postgres.raw("select session_user as role,pg_backend_pid() as pid"); }
        catch (error) { poolError = error; }
        if (pooled) console.log("C12_NATIVE_RECONNECT_FAULT=retired-credential-reconnected");
        const credentialRefused = (error: any) => error && (error.code === "28000" || /not permitted to log in/i.test(error.message));
        const poolRefused = (error: any) => credentialRefused(error) || error &&
          (error.name === "KnexTimeoutError" || /acquiring a connection/i.test(error.message));
        assert.ok(credentialRefused(directError),
          "PostgreSQL must reject the retired credential");
        assert.ok(poolRefused(poolError),
          "The installed native pool must refuse retired credential acquisition");
        await assert.rejects(carts.updateCarts(task.cart_id, { metadata: { c12_generation_probe: "stale-reconnected" } }), poolRefused);
        assert.deepEqual(calls, Object.fromEntries(names.map(name => [name, 0])));
        console.log("C12_NATIVE_GENERATION_RECONNECT=" + JSON.stringify({ active_pool_reconnected: true,
          backend_changed: true, retired_pool_reconnect_refused: true, native_system_calls: calls }));
        return;
      }
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
  const f = await nativePaymentFixture(container, false, true);
  try {
  const seededCart = await f.makeCart(), addressId = "caaddr_" + randomBytes(12).toString("hex");
  const address = { id: addressId, customer_id: f.customer.id, company: null, first_name: "Original", last_name: "Customer",
    address_1: "1 Original Street", address_2: null, city: "Synthetic", country_code: "us", province: null,
    postal_code: "00000", phone: null, metadata: null };
  await postgres("cart_address").insert(address); await postgres("cart").where({ id: seededCart.id }).update({ shipping_address_id: addressId });
  const original = await f.makePaymentOriginal({ existingCart: seededCart });
  const inventory = container.resolve(Modules.INVENTORY), locations = container.resolve(Modules.STOCK_LOCATION);
  const item = await inventory.createInventoryItems({ sku: "c12-generation-" + randomBytes(8).toString("hex") });
  const location = await locations.createStockLocations({ name: "C12 synthetic generation" });
  await inventory.createInventoryLevels({ inventory_item_id: item.id, location_id: location.id, stocked_quantity: 5 });
  const line = await postgres("cart_line_item").where({ cart_id: original.cart.id }).first("id");
  const carts = container.resolve(Modules.CART), payments = container.resolve(Modules.PAYMENT);
  const otherCart = await carts.createCarts({ currency_code: "usd", email: "wrong-original@example.invalid" });
  const otherLine = await carts.addLineItems({ cart_id: otherCart.id, title: "Wrong original fixture", quantity: 1, unit_price: 1 });
  const otherCollection = (await payments.createPaymentCollections([{ currency_code: "usd", amount: 12.5 }]))[0];
  const otherSession = await payments.createPaymentSession(otherCollection.id, {
    provider_id: "pp_rifare_fenced_system_fixture", currency_code: "usd", amount: 12.5, data: {} });
  const foreignAddressId = "ordaddr_" + randomBytes(12).toString("hex");
  await postgres("order_address").insert({ ...address, id: foreignAddressId });
  const originalLine = await postgres("cart_line_item").where({ id: line.id }).first();
  const originalCartRow = await postgres("cart").where({ id: original.cart.id }).first();
  const foreignOrder = await container.resolve(Modules.ORDER).createOrders({ customer_id: f.customer.id, currency_code: originalCartRow.currency_code,
    email: originalCartRow.email, items: [{ title: originalLine.title, quantity: originalLine.quantity, unit_price: originalLine.unit_price,
      variant_id: originalLine.variant_id, product_id: originalLine.product_id, metadata: originalLine.metadata }] });
  const foreignOrderItem = await postgres("order_item").where({ order_id: foreignOrder.id }).first("item_id");
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
  const custody = process.env.RIFARE_C12_GENERATION_CUSTODY!; assert.ok(custody.endsWith("-private.json"));
  const setupFault = process.env.RIFARE_C12_GENERATION_SETUP_FAULT === "occupied";
  if (setupFault) writeFileSync(custody, JSON.stringify({ fixture: "occupied before claim" }), { flag: "wx", mode: 0o600 });
  const claim = await f.journal.claimNativeExecution(original.command.command_id, f.context, f.verifier);
  let definition: string | null = null, originalDefinition: string | null = null;
  let deliveredLogin: boolean | undefined, retirement: Promise<void> | undefined;
  let revocationPause: any;
  const fault = process.env.RIFARE_C12_GENERATION_FAULT === "omit";
  const ordering = process.env.RIFARE_C12_GENERATION_ORDERING === "write-first";
  const revokeFirst = process.env.RIFARE_C12_GENERATION_ORDERING === "revoke-first";
  const reconnect = process.env.RIFARE_C12_GENERATION_ORDERING === "reconnect";
  const reconnectFault = process.env.RIFARE_C12_GENERATION_RECONNECT_FAULT === "restore-login";
  const correlation = process.env.RIFARE_C12_ORIGINAL === "verify";
  const correlationFault = process.env.RIFARE_C12_ORIGINAL_FAULT === "omit";
  const orderingFault = process.env.RIFARE_C12_GENERATION_ORDERING_FAULT === "omit-locks";
  try {
  assert.ok(claim.worker); assert.ok(claim.seal);
  deliveredLogin = (await postgres("pg_catalog.pg_roles").where({ rolname: claim.worker.role }).first()).rolcanlogin;
  assert.equal(deliveredLogin, true);
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
  writeFileSync(custody, JSON.stringify({ source: process.env.RIFARE_C12_SOURCE, original_id: original.command.command_id,
    worker: claim.worker, seal: claim.seal }, null, 2), { flag: "wx", mode: 0o600 });
  definition = (await postgres.raw("select pg_get_functiondef(to_regprocedure('public.rifare_guard_native_generation()')) as definition")).rows[0].definition as string | null;
  originalDefinition = (await postgres.raw("select pg_get_functiondef(to_regprocedure('public.rifare_guard_native_original()')) as definition")).rows[0].definition as string | null;
  if (fault || orderingFault) assert.ok(definition, "The enforcement fault requires an installed generation function");
  if (orderingFault) {
    assert.ok(ordering); assert.equal((definition!.match(/for share/gi) ?? []).length, 2);
    await postgres.raw(definition!.replace(/for share/gi, ""));
  }
  if (correlationFault) {
    assert.ok(correlation && originalDefinition);
    await postgres.raw(`create or replace function public.rifare_guard_native_original() returns trigger
      language plpgsql security definer set search_path=pg_catalog as $$ begin return coalesce(NEW,OLD); end $$`);
  }
  await postgres.raw(`create table public.rifare_c12_generation_audit(id bigserial primary key,native_table text not null,authenticated_role text not null);
    create function public.rifare_c12_generation_observe() returns trigger language plpgsql security definer set search_path=pg_catalog as $$ begin
      if session_user::text ~ '^rifare_exec_[a-f0-9]{32}$' then insert into public.rifare_c12_generation_audit(native_table,authenticated_role) values(TG_TABLE_NAME,session_user); end if;
      return coalesce(NEW,OLD); end $$`);
  const tables = ["cart", "cart_line_item", "order_address", "order", "order_item", "order_line_item", "order_summary", "order_cart", "order_payment_collection",
    "reservation_item", "inventory_level", "payment_collection", "payment_session", "payment", "capture", "refund"];
  for (const table of tables) await postgres.raw(`create trigger rifare_c12_generation_audit after insert or update or delete on public."${table}"
    for each row execute function public.rifare_c12_generation_observe()`);
  if (revokeFirst) await postgres.raw(`create function public.rifare_c12_pause_retirement() returns trigger
    language plpgsql set search_path=pg_catalog as $$ begin
      if OLD.execution_revoked_at is null and NEW.execution_revoked_at is not null then
        perform pg_advisory_xact_lock(1940052,1);
      end if;
      return NEW;
    end $$;
    create trigger rifare_c12_pause_retirement after update on public.rifare_operation
      for each row execute function public.rifare_c12_pause_retirement()`);
  const snapshot = async () => {
    const rows: Record<string, unknown> = {}; for (const table of tables) rows[table] = await postgres(table).orderBy("id");
    return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  };
  const database = new URL(process.env.DATABASE_URL!); database.username = claim.worker!.role; database.password = claim.worker!.password;
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: database.href, MEDUSA_WORKER_MODE: "server",
    RIFARE_C12_NATIVE_WORKER: JSON.stringify({ role: claim.worker!.role }), RIFARE_C12_GENERATION_TASK: JSON.stringify({ role: claim.worker!.role,
      cart_id: original.cart.id, customer_id: f.customer.id, collection_id: original.collection.id, line_item_id: line.id,
      inventory_item_id: item.id, location_id: location.id, ordering }) };
  env.RIFARE_C12_GENERATION_TASK = JSON.stringify({ role: claim.worker!.role, cart_id: original.cart.id,
    customer_id: f.customer.id, collection_id: original.collection.id, line_item_id: line.id,
    inventory_item_id: item.id, location_id: location.id, ordering, reconnect, correlation,
    other_cart_id: otherCart.id, other_line_id: otherLine[0].id, other_collection_id: otherCollection.id,
    other_session_id: otherSession.id, foreign_address_id: foreignAddressId, foreign_order_line_id: foreignOrderItem.item_id,
    original_raw_amount: original.session.raw_amount });
  for (const key of Object.keys(env)) if (key.startsWith("PG") || key.endsWith("_CUSTODY") || /(?:API_KEY|_TOKEN|_PASSWORD|_SECRET|_PRIVATE_KEY|_CREDENTIALS)$/.test(key) ||
    key.endsWith("DATABASE_URL") && key !== "DATABASE_URL" || key.startsWith("RIFARE_JOURNAL_PRIVACY_") || key.startsWith("RIFARE_C12_CONTROLLER_")) delete env[key];
  env.JWT_SECRET = randomBytes(32).toString("hex"); env.COOKIE_SECRET = randomBytes(32).toString("hex");
  let beforeStale: string | undefined, beforeAudit: unknown, parentFailure: unknown;
  let orderingObservation: unknown;
    if (correlation) { beforeStale = await snapshot(); beforeAudit = await postgres("rifare_c12_generation_audit").orderBy("id"); }
    const result = await new Promise<{ code: number | null; output: string }>((complete, reject) => {
      const compiled = __filename.endsWith(".js"), entry = resolvePath();
      function resolvePath() { return resolve(dirname(__filename), "native-execution-worker-entry." + (compiled ? "js" : "ts")); }
      const args = compiled ? [entry] : ["-r", "ts-node/register", "-r", "tsconfig-paths/register", entry];
      const child = spawn(process.execPath, args, { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe", "ipc"] });
      let output = "", ready = false;
      const handlers = new Set<Promise<void>>();
      const timer = setTimeout(() => { parentFailure ??= new Error("Native generation worker deadline"); child.kill("SIGKILL"); }, 45000);
      for (const stream of [child.stdout!, child.stderr!]) stream.on("data", data => { output = (output + data).slice(-30000); });
      child.on("message", message => {
        const handling = (async () => {
        const phase = message as any;
        assert.equal(phase.identity.role, claim.worker!.role);
        if (phase.phase === "native-transaction-open") {
          assert.ok(ordering && !retirement && !ready);
          let settled = false;
          retirement = retireOriginalExecutionWorker(postgres, claim.worker!.role).finally(() => { settled = true; });
          retirement.catch(() => undefined);
          let blocked: any;
          const deadline = Date.now() + 4000;
          while (Date.now() < deadline && !settled) {
            blocked = (await postgres.raw(`select pid,pg_blocking_pids(pid) as blockers from pg_catalog.pg_stat_activity
              where datname=current_database() and pid<>pg_backend_pid() and ?::integer=any(pg_blocking_pids(pid))
              and query ilike '%update%rifare_operation%'`, [phase.identity.pid])).rows[0];
            if (blocked) break;
            await new Promise(resolve => setTimeout(resolve, 20));
          }
          if (settled) await retirement;
          assert.ok(blocked && !settled, "Revocation must wait on the actual native Cart transaction's journal generation lock");
          orderingObservation = { actual_blocker_observed: true, native_pid: phase.identity.pid,
            revoker_pid: blocked.pid, blockers: blocked.blockers, native_cart_write_precedes_revocation_commit: true };
          child.send({ phase: "commit" });
          await retirement;
          return;
        }
        if (reconnect && phase.phase === "ready") {
          assert.equal(ready, false); ready = true;
          assert.equal((await postgres("cart").where({ id: original.cart.id }).first()).metadata.c12_generation_probe, "current");
          assert.equal((await postgres("rifare_c12_generation_audit")).length, 1);
          assert.equal((await postgres.raw("select pg_terminate_backend(?) as terminated", [phase.identity.pid])).rows[0].terminated, true);
          const deadline = Date.now() + 3000;
          while ((await postgres("pg_catalog.pg_stat_activity").where({ pid: phase.identity.pid })).length) {
            assert.ok(Date.now() < deadline, "Lost current worker backend must exit"); await new Promise(resolve => setTimeout(resolve, 20));
          }
          child.send({ phase: "reconnect" }); return;
        }
        if (reconnect && phase.phase === "reconnected") {
          assert.equal(ready, true); assert.notEqual(phase.identity.pid, phase.previous_pid);
          assert.equal((await postgres("cart").where({ id: original.cart.id }).first()).metadata.c12_generation_probe, "reconnected-current");
          beforeAudit = await postgres("rifare_c12_generation_audit").orderBy("id"); assert.equal((beforeAudit as any[]).length, 2);
          beforeStale = await snapshot(); await retireOriginalExecutionWorker(postgres, claim.worker!.role);
          if (reconnectFault) await postgres.raw(`alter role "${claim.worker!.role}" login`);
          const sessions = await postgres("pg_catalog.pg_stat_activity").where({ usename: claim.worker!.role }).select("pid");
          for (const session of sessions) assert.equal((await postgres.raw("select pg_terminate_backend(?) as terminated", [session.pid])).rows[0].terminated, true);
          const deadline = Date.now() + 3000;
          while ((await postgres("pg_catalog.pg_stat_activity").where({ usename: claim.worker!.role })).length) {
            assert.ok(Date.now() < deadline, "Retired worker backends must exit before reconnect"); await new Promise(resolve => setTimeout(resolve, 20));
          }
          orderingObservation = { actual_backend_loss: true, active_reconnect_pid_changed: true,
            retired_sessions_terminated: sessions.length, fault_restored_login: reconnectFault };
          child.send({ phase: "resume" }); return;
        }
        assert.equal(ready, false); ready = true;
        assert.equal(phase.phase, "ready");
        if (ordering) { assert.ok(retirement); await retirement; }
        assert.equal((await postgres("cart").where({ id: original.cart.id }).first()).metadata.c12_generation_probe, "current");
        beforeAudit = await postgres("rifare_c12_generation_audit").orderBy("id");
        assert.equal((beforeAudit as any[]).length, 1); beforeStale = await snapshot();
        if (revokeFirst) {
          // Pause the canonical retirement AFTER its actual journal UPDATE has
          // acquired the row, not a copied retirement or a timer-based ordering.
          revocationPause = await postgres.transaction();
          await revocationPause.raw("select pg_advisory_xact_lock(1940052,1)");
          const holder = (await revocationPause.raw("select pg_backend_pid() as pid")).rows[0].pid;
          retirement = retireOriginalExecutionWorker(postgres, claim.worker!.role); retirement.catch(() => undefined);
          const observe = async (predicate: string, args: any[]) => {
            const deadline = Date.now() + 4000;
            while (Date.now() < deadline) {
              const found = (await postgres.raw(`select pid,pg_blocking_pids(pid) as blockers from pg_catalog.pg_stat_activity
                where datname=current_database() and pid<>pg_backend_pid() and ${predicate}`, args)).rows[0];
              if (found) return found;
              await new Promise(resolve => setTimeout(resolve, 20));
            }
          };
          const revoker = await observe("?::integer=any(pg_blocking_pids(pid)) and query ilike '%update%rifare_operation%'", [holder]);
          assert.ok(revoker, "Canonical retirement must hold its journal UPDATE while paused");
          if (fault) await postgres.raw(`create or replace function public.rifare_guard_native_generation() returns trigger
            language plpgsql security definer set search_path=pg_catalog as $$ begin return null; end $$`);
          child.send({ phase: "resume" });
          const writer = await observe("usename=? and ?::integer=any(pg_blocking_pids(pid))", [claim.worker!.role,revoker.pid]);
          assert.ok(writer, "Native Cart write must wait on the actual uncommitted journal revocation");
          orderingObservation = { revoke_first: true, actual_blocker_observed: true, pause_holder_pid: holder,
            revoker_pid: revoker.pid, native_pid: writer.pid, blockers: writer.blockers,
            revocation_update_precedes_native_write: true };
          await revocationPause.commit(); await retirement;
          const revoked = await original.row(); assert.equal(revoked.execution_generation, 2); assert.ok(revoked.execution_revoked_at);
          return;
        }
        await retireOriginalExecutionWorker(postgres, claim.worker!.role);
        const revoked = await original.row(); assert.equal(revoked.execution_generation, 2); assert.ok(revoked.execution_revoked_at);
        if (fault) await postgres.raw(`create or replace function public.rifare_guard_native_generation() returns trigger
          language plpgsql security definer set search_path=pg_catalog as $$ begin return null; end $$`);
        child.send({ phase: "resume" });
        })().catch(error => { parentFailure ??= error; child.kill("SIGKILL"); });
        handlers.add(handling); void handling.finally(() => handlers.delete(handling));
      });
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("close", code => {
        clearTimeout(timer);
        void Promise.all([...handlers]).then(() => {
          writeFileSync(custody.replace("-private.json", "-worker-native.log"), output, { flag: "wx", mode: 0o600 }); complete({ code, output });
        }).catch(reject);
      });
    });
    writeFileSync(custody.replace("-private.json", "-observations.json"), JSON.stringify({ worker_exit: result.code, before_stale: beforeStale,
      after_stale: await snapshot(), audit: await postgres("rifare_c12_generation_audit").orderBy("id"), fault,
      ordering, revoke_first: revokeFirst, reconnect, reconnect_fault: reconnectFault,
      correlation, correlation_fault: correlationFault,
      ordering_fault: orderingFault, ordering_observation: orderingObservation }, null, 2), { flag: "wx" });
    if (parentFailure) throw parentFailure;
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /C12_NATIVE_MODULE_WORKER_SHUTDOWN=complete/);
    assert.equal(await snapshot(), beforeStale, "Stale native writes must have zero effects, including early address and reservation rows");
    assert.deepEqual(await postgres("rifare_c12_generation_audit").orderBy("id"), beforeAudit);
    if (ordering || revokeFirst || reconnect) { assert.ok(orderingObservation); console.log("C12_NATIVE_GENERATION_ORDERING=" + JSON.stringify(orderingObservation)); }
    console.log(result.output.split(/\r?\n/).filter(value => value.startsWith("C12_NATIVE_GENERATION_")).join("\n"));
    console.log("C12_NATIVE_GENERATION_RESULT=" + JSON.stringify({ result: "pass",
      ...(reconnect ? { actual_backend_loss_and_reconnect: true, active_reconnect_native_writes: 1,
        post_retirement_native_method_acquisition_refusals: 1, same_existing_authenticated_session: false } :
        { actual_native_stale_write_refusals: 5, same_existing_authenticated_session: true,
          ...(correlation ? { current_wrong_original_refusals: 8 } : {}) }),
      original_visibility_qualified: false, current_authority_fence_qualified: false,
      provider_effect_time_fence_qualified: false, full_C12_qualified: false }));
  } finally {
    try {
      try {
        if (revocationPause && !revocationPause.isCompleted()) await revocationPause.rollback();
        if (retirement) await retirement;
      }
      finally {
        if ((fault || orderingFault) && definition) {
          await postgres.raw(definition);
          assert.equal((await postgres.raw("select pg_get_functiondef('public.rifare_guard_native_generation()'::regprocedure) as definition")).rows[0].definition, definition);
          console.log("C12_NATIVE_GENERATION_FAULT_RESTORED=exact");
        }
        if (correlationFault && originalDefinition) {
          await postgres.raw(originalDefinition);
          assert.equal((await postgres.raw("select pg_get_functiondef('public.rifare_guard_native_original()'::regprocedure) as definition")).rows[0].definition, originalDefinition);
          console.log("C12_NATIVE_ORIGINAL_FAULT_RESTORED=exact");
        }
      }
    } finally {
      try {
        if (revokeFirst) await postgres.raw(`drop trigger if exists rifare_c12_pause_retirement on public.rifare_operation;
          drop function if exists public.rifare_c12_pause_retirement()`);
      } finally {
      if (claim.worker) {
        await retireOriginalExecutionWorker(postgres, claim.worker.role);
        if (reconnectFault) console.log("C12_NATIVE_RECONNECT_FAULT_RESTORED=nologin");
        if (setupFault) {
          const row = await original.row(), role = await postgres("pg_catalog.pg_roles").where({ rolname: claim.worker.role }).first("rolcanlogin");
          assert.equal(row.state, "unknown"); assert.equal(row.execution_generation, 2); assert.ok(row.execution_revoked_at);
          assert.equal(role.rolcanlogin, false); assert.equal(deliveredLogin, true);
          assert.equal((await postgres("pg_catalog.pg_stat_activity").where({ usename: claim.worker.role })).length, 0);
          const count = Number((await postgres.raw("select count(*) as n from pg_roles where rolname ~ '^rifare_exec_[a-f0-9]{32}$'")).rows[0].n);
          const retry = await f.journal.claimNativeExecution(original.command.command_id, f.context, f.verifier);
          assert.equal(retry.disposition, "recovery_only"); assert.equal(retry.worker, null); assert.equal(retry.seal, null);
          assert.equal(Number((await postgres.raw("select count(*) as n from pg_roles where rolname ~ '^rifare_exec_[a-f0-9]{32}$'")).rows[0].n), count);
          writeFileSync(custody.replace("-private.json", "-setup-retirement.json"), JSON.stringify({ source: process.env.RIFARE_C12_SOURCE,
            original_id: original.command.command_id, role: claim.worker.role, delivered_login_was_active: deliveredLogin,
            after_failure_login: false, retained_generation: row.execution_generation, retained_state: row.state,
            recovery_only_no_replacement: true }, null, 2), { flag: "wx" });
          console.log("C12_NATIVE_GENERATION_SETUP_FAILURE_RETIRED=verified");
        }
      }
      }
    }
  }
  } finally { f.requestVerifier.close(); f.verifier.close(); }
}
