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
    const task = JSON.parse(process.env.RIFARE_C12_GENERATION_TASK), carts = container.resolve(Modules.CART), payments = container.resolve(Modules.PAYMENT);
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
      Native.prototype[name] = async function(...args: any[]) {
        calls[name]++;
        if (name === "authorizePayment" && task.provider_ordering) {
          assert.equal(typeof process.send, "function");
          const release = new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("Native provider delegate release deadline")), 15000);
            process.once("message", message => { clearTimeout(timer); try {
              assert.deepEqual(message, { phase: "provider-delegate-release" }); resolve();
            } catch (error) { reject(error); } });
          });
          process.send!({ phase: "provider-delegate-open", identity });
          await release;
        }
        return originals.get(name).apply(this, args);
      };
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
      if (task.provider) {
        const provider = (payments as any).paymentProviderService_.retrieveProvider("pp_rifare_fenced_system_fixture");
        if (task.provider_expiry) {
          let expiryError: any;
          try { await provider.authorizePayment({ data: task.original_session_data, context: {} }); }
          catch (error) { expiryError = error; }
          if (!expiryError) console.log("C12_NATIVE_PROVIDER_EXPIRY_FAULT=system-authorized;calls=" + calls.authorizePayment);
          assert.match(expiryError?.message ?? "", /Native execution payment is unavailable/,
            "A payment-row wait crossing execution expiry must refuse before System");
          assert.equal(calls.authorizePayment, 0);
          console.log("C12_NATIVE_PROVIDER_EXPIRY_REFUSAL=after-payment-row-wait");
        } else {
        const collection = await postgres("payment_collection").where({ id: task.collection_id }).first("currency_code", "amount", "raw_amount");
        const refused = async (field: string) => {
          await assert.rejects(provider.authorizePayment({ data: task.original_session_data, context: {} }),
            /Native execution payment is unavailable/); assert.equal(calls.authorizePayment, 0);
          console.log("C12_NATIVE_PROVIDER_COLLECTION_REFUSAL=" + field);
        };
        await postgres("payment_collection").where({ id: task.collection_id }).update({ currency_code: "eur" });
        await refused("currency");
        await postgres("payment_collection").where({ id: task.collection_id }).update({ currency_code: collection.currency_code });
        const wrong = Number(collection.amount) + 1;
        await postgres("payment_collection").where({ id: task.collection_id }).update({ amount: wrong,
          raw_amount: { value: String(wrong), precision: 20 } });
        await refused("principal");
        await postgres("payment_collection").where({ id: task.collection_id }).update({ amount: collection.amount, raw_amount: collection.raw_amount });
        const raced = await Promise.allSettled([
          provider.authorizePayment({ data: task.original_session_data, context: {} }),
          provider.authorizePayment({ data: task.original_session_data, context: {} }),
        ]);
        const winners = raced.filter(result => result.status === "fulfilled"), losers = raced.filter(result => result.status === "rejected");
        if (winners.length === 2) console.log("C12_NATIVE_PROVIDER_ATTEMPT_FAULT=concurrent-system-authorized;calls=" + calls.authorizePayment);
        assert.equal(winners.length, 1, "Exactly one concurrent provider attempt may delegate");
        assert.equal(losers.length, 1); assert.match((losers[0] as PromiseRejectedResult).reason?.message ?? "", /Native execution payment is unavailable/);
        const authorized = (winners[0] as PromiseFulfilledResult<any>).value;
        assert.ok(authorized?.data?.rifare_native_execution?.original_command_id); assert.equal(calls.authorizePayment, 1);
        let duplicateError: any;
        try { await provider.authorizePayment({ data: task.original_session_data, context: {} }); }
        catch (error) { duplicateError = error; }
        if (!duplicateError) console.log("C12_NATIVE_PROVIDER_ATTEMPT_FAULT=duplicate-system-authorized;calls=" + calls.authorizePayment);
        assert.match(duplicateError?.message ?? "", /Native execution payment is unavailable/,
          "A committed provider attempt must make a duplicate current call recovery-only");
        assert.equal(calls.authorizePayment, 1);
        console.log("C12_NATIVE_PROVIDER_DUPLICATE_REFUSAL=recovery-only");
        for (const name of names.filter(name => name !== "authorizePayment")) assert.equal(calls[name], 0);
        assert.equal((await postgres("payment_session").where({ id: task.original_session_id }).first("status")).status, "pending");
        assert.equal((await postgres("payment").where({ payment_session_id: task.original_session_id })).length, 0);
        console.log("C12_NATIVE_PROVIDER_CURRENT=" + JSON.stringify({ session_id: task.original_session_id,
          pending_session: true, payment_rows: 0, actual_system_authorizations: 1 }));
        }
      }
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
        await refused("order_item", () => container.resolve(Modules.ORDER).createOrders({ customer_id: task.customer_id,
          currency_code: "usd", email: "unbound-order@example.invalid", items: [task.original_line] }));
        await refused("payment_session", () => container.resolve(Modules.PAYMENT).createPaymentSession(task.other_collection_id, {
          provider_id: "pp_rifare_fenced_system_fixture", currency_code: "usd", amount: 12.5, data: {} }));
        await refused("payment_session", () => postgres("payment_session").where({ id: task.other_session_id }).update({
          payment_collection_id: task.collection_id, provider_id: "pp_rifare_fenced_system_fixture",
          currency_code: "usd", amount: 12.5, raw_amount: task.original_raw_amount }));
        await postgres("payment_session").where({ id: task.original_session_id }).update({ raw_amount: task.original_raw_amount });
        const rawValue = String(task.original_raw_amount.value), equalRaw = { ...task.original_raw_amount,
          value: rawValue.includes(".") ? rawValue + "0" : rawValue + ".0" };
        await refused("payment_session", () => postgres("payment_session").where({ id: task.original_session_id }).update({ raw_amount: equalRaw }));
        assert.deepEqual(calls, Object.fromEntries(names.map(name => [name, 0])));
        console.log("C12_NATIVE_ORIGINAL_RESULT=" + JSON.stringify({ current_wrong_original_refusals: 10,
          healthy_original_session_writes: 1, native_system_calls: calls }));
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
      if (task.provider) {
        // The concurrent provider race warms more than one native pool backend,
        // so a later acquisition need not return the first PID.  The worker is
        // NOLOGIN before resume; any successful query as this role therefore
        // proves reuse of one of its already-authenticated native backends.
        assert.equal(same.role, identity.role, "Stale refusal must exercise an already-open worker backend");
      } else assert.deepEqual(same, identity, "Stale refusal must exercise the already-open backend");
      if (task.provider) {
        const provider = (payments as any).paymentProviderService_.retrieveProvider("pp_rifare_fenced_system_fixture");
        let providerError: any;
        try { await provider.authorizePayment({ data: task.original_session_data, context: {} }); }
        catch (error) { providerError = error; }
        if (!providerError) console.log("C12_NATIVE_PROVIDER_FAULT=retired-system-authorized;calls=" + calls.authorizePayment);
        assert.match(providerError?.message ?? "", /Native execution payment is unavailable/,
          "Retired current backend must be refused before another native System authorization");
        assert.equal(calls.authorizePayment, task.provider_expiry ? 0 : 1);
        console.log("C12_NATIVE_PROVIDER_RETIRED_REFUSAL=before-system-delegate");
      }
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
      assert.deepEqual(calls, Object.fromEntries(names.map(name => [name,
        name === "authorizePayment" && task.provider && !task.provider_expiry ? 1 : 0])));
      const finalIdentity = (await postgres.raw("select session_user as role, pg_backend_pid() as pid")).rows[0];
      if (task.provider) assert.equal(finalIdentity.role, identity.role);
      else assert.equal(finalIdentity.pid, identity.pid);
      console.log("C12_NATIVE_GENERATION_WORKER=" + JSON.stringify({ same_authenticated_backend: !task.provider,
        established_authenticated_worker_backend: true, native_tables: 5, native_system_calls: calls }));
    } finally { for (const [name, original] of originals) Native.prototype[name] = original; }
    return;
  }
  const providerPrivacy = process.env.RIFARE_C12_PROVIDER_PRIVACY === "retain";
  const f = await nativePaymentFixture(container, providerPrivacy, true);
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
  let definition: string | null = null, originalDefinition: string | null = null, paymentDefinition: string | null = null;
  let deliveredLogin: boolean | undefined, retirement: Promise<void> | undefined;
  let revocationPause: any, expiryPause: any, paymentHold: any, expiryHolder: number | undefined;
  const fault = process.env.RIFARE_C12_GENERATION_FAULT === "omit";
  const ordering = process.env.RIFARE_C12_GENERATION_ORDERING === "write-first";
  const revokeFirst = process.env.RIFARE_C12_GENERATION_ORDERING === "revoke-first";
  const reconnect = process.env.RIFARE_C12_GENERATION_ORDERING === "reconnect";
  const reconnectFault = process.env.RIFARE_C12_GENERATION_RECONNECT_FAULT === "restore-login";
  const correlation = process.env.RIFARE_C12_ORIGINAL === "verify";
  const correlationFault = process.env.RIFARE_C12_ORIGINAL_FAULT === "omit";
  const provider = process.env.RIFARE_C12_PROVIDER === "verify";
  const providerFault = process.env.RIFARE_C12_PROVIDER_FAULT === "omit-attempt";
  const providerOrdering = process.env.RIFARE_C12_PROVIDER_ORDERING === "delegate-open";
  const providerOrderingFault = process.env.RIFARE_C12_PROVIDER_ORDERING_FAULT === "omit-delegate-lock";
  const providerExpiry = process.env.RIFARE_C12_PROVIDER_EXPIRY === "payment-wait";
  const providerExpiryFault = process.env.RIFARE_C12_PROVIDER_EXPIRY_FAULT === "omit-post-lock-clock";
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
    worker: claim.worker, seal: claim.seal, ...(providerPrivacy ? { privacy: { merchant: f.merchant,
      customer_id: f.customer.id, actor: f.privacyActor, context: f.context } } : {}) }, null, 2), { flag: "wx", mode: 0o600 });
  definition = (await postgres.raw("select pg_get_functiondef(to_regprocedure('public.rifare_guard_native_generation()')) as definition")).rows[0].definition as string | null;
  originalDefinition = (await postgres.raw("select pg_get_functiondef(to_regprocedure('public.rifare_guard_native_original()')) as definition")).rows[0].definition as string | null;
  paymentDefinition = (await postgres.raw("select pg_get_functiondef(to_regprocedure('public.rifare_require_native_execution_payment(text,text,text)')) as definition")).rows[0].definition as string | null;
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
  if (providerFault) {
    assert.ok(provider && paymentDefinition);
    const attempted = `
          or (p_action='authorize' and original.execution_payment_attempted_at is not null)
          or (p_action='delegate' and original.execution_payment_attempted_at is null)`;
    const claim = `        if p_action='authorize' then
          update public.rifare_operation set execution_payment_attempted_at=observed,
            revision=revision+1,updated_at=clock_timestamp()
            where id=original.id and execution_payment_attempted_at is null
            returning original_command_uuid into claimed_original;
          if not found then raise exception 'Native execution payment unavailable' using errcode='42501'; end if;
          return claimed_original;
        end if;
        return original.original_command_uuid;`;
    assert.ok(paymentDefinition.includes(attempted)); assert.ok(paymentDefinition.includes(claim));
    const mutant = paymentDefinition.replace(attempted, "").replace(claim, "        return original.original_command_uuid;");
    assert.notEqual(mutant, paymentDefinition); await postgres.raw(mutant);
  }
  if (providerOrderingFault) {
    assert.ok(providerOrdering && provider && paymentDefinition && !providerFault);
    const checked = `        if session_user::text !~ '^rifare_exec_[a-f0-9]{32}$' or p_action is null or p_action not in ('authorize','delegate')
          or p_session !~ '^payses_[A-Za-z0-9]{1,100}$' or p_handle !~ '^[a-f0-9]{64}$' then
          raise exception 'Native execution payment unavailable' using errcode='42501';
        end if;`;
    const bypass = `${checked}
        if p_action='delegate' then
          select original_command_uuid into claimed_original from public.rifare_operation
            where execution_owner_fingerprint='sha256:' || encode(sha256(convert_to(session_user::text,'UTF8')),'hex');
          return claimed_original;
        end if;`;
    assert.ok(paymentDefinition.includes(checked));
    const mutant = paymentDefinition.replace(checked, () => bypass); assert.notEqual(mutant, paymentDefinition); await postgres.raw(mutant);
  }
  if (providerExpiryFault) {
    assert.ok(providerExpiry && provider && paymentDefinition && !providerFault && !providerOrderingFault);
    const postLock = `        observed := clock_timestamp();
        if observed >= original.execution_expires_at then
          raise exception 'Native execution payment unavailable' using errcode='42501';
        end if;
`;
    assert.ok(paymentDefinition.includes(postLock));
    const mutant = paymentDefinition.replace(postLock, ""); assert.notEqual(mutant, paymentDefinition); await postgres.raw(mutant);
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
  if (providerExpiry) {
    await postgres.raw(`create function public.rifare_c12_delay_provider_expiry() returns trigger
      language plpgsql set search_path=pg_catalog as $$ begin
        if OLD.execution_payment_attempted_at is null and NEW.execution_payment_attempted_at is not null then
          perform pg_advisory_xact_lock(1940052,3);
        end if;
        return NEW;
      end $$;
      create trigger aaa_rifare_c12_delay_provider_expiry before update on public.rifare_operation
        for each row execute function public.rifare_c12_delay_provider_expiry()`);
    expiryPause = await postgres.transaction();
    await expiryPause.raw("select pg_advisory_xact_lock(1940052,3)");
    expiryHolder = (await expiryPause.raw("select pg_backend_pid() as pid")).rows[0].pid;
  }
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
    inventory_item_id: item.id, location_id: location.id, ordering, reconnect, correlation, provider,
    provider_ordering: providerOrdering, provider_expiry: providerExpiry,
    other_cart_id: otherCart.id, other_line_id: otherLine[0].id, other_collection_id: otherCollection.id,
    other_session_id: otherSession.id, foreign_address_id: foreignAddressId, foreign_order_id: foreignOrder.id,
    foreign_order_line_id: foreignOrderItem.item_id, original_session_id: original.session.id, original_session_data: original.session.data,
    original_line: { title: originalLine.title, quantity: originalLine.quantity, unit_price: originalLine.unit_price,
      variant_id: originalLine.variant_id, product_id: originalLine.product_id, metadata: originalLine.metadata },
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
      const timer = setTimeout(() => { parentFailure ??= new Error("Native generation worker deadline"); child.kill("SIGKILL"); }, providerExpiry ? 90000 : 45000);
      if (providerExpiry) {
        const coordinating = (async () => {
          assert.ok(expiryPause && expiryHolder);
          let attemptedWriter: any;
          const blockedDeadline = Date.now() + 12000;
          while (Date.now() < blockedDeadline) {
            attemptedWriter = (await postgres.raw(`select pid from pg_catalog.pg_stat_activity
              where datname=current_database() and usename=? and ?::integer=any(pg_blocking_pids(pid))
                and query ilike '%rifare_require_native_execution_payment%'`, [claim.worker!.role, expiryHolder])).rows[0];
            if (attemptedWriter) break;
            await new Promise(resolve => setTimeout(resolve, 20));
          }
          assert.ok(attemptedWriter, "Provider admission must reach the actual attempt trigger");
          paymentHold = await postgres.transaction();
          const paymentHolder = (await paymentHold.raw("select pg_backend_pid() as pid")).rows[0].pid;
          let paymentAcquired = false;
          const acquiring = paymentHold.raw("update public.payment_session set updated_at=updated_at where id=?", [original.session.id])
            .then((value: any) => { paymentAcquired = true; return value; });
          let paymentQueued: any;
          const queueDeadline = Date.now() + 4000;
          while (Date.now() < queueDeadline && !paymentAcquired) {
            paymentQueued = (await postgres.raw(`select pid,pg_blocking_pids(pid) as blockers from pg_catalog.pg_stat_activity
              where pid=? and ?::integer=any(pg_blocking_pids(pid))`, [paymentHolder, attemptedWriter.pid])).rows[0];
            if (paymentQueued) break;
            await new Promise(resolve => setTimeout(resolve, 20));
          }
          assert.ok(paymentQueued && !paymentAcquired, "Controller payment UPDATE must queue behind provider admission");
          await expiryPause.commit();
          await acquiring;
          let delegateWaiter: any;
          const delegateDeadline = Date.now() + 4000;
          while (Date.now() < delegateDeadline) {
            delegateWaiter = (await postgres.raw(`select pid,pg_blocking_pids(pid) as blockers from pg_catalog.pg_stat_activity
              where datname=current_database() and usename=? and ?::integer=any(pg_blocking_pids(pid))
                and query ilike '%rifare_require_native_execution_payment%'`, [claim.worker!.role, paymentHolder])).rows[0];
            if (delegateWaiter) break;
            await new Promise(resolve => setTimeout(resolve, 20));
          }
          assert.ok(delegateWaiter, "Delegate gate must wait on the controller-held payment row");
          const attempted = await original.row(); assert.ok(attempted.execution_payment_attempted_at);
          const expiresAt = attempted.execution_expires_at;
          assert.equal((await postgres.raw("select clock_timestamp()<?::timestamptz as current", [expiresAt])).rows[0].current, true,
            "Delegate payment-row wait must be observed before immutable execution expiry");
          while (!(await postgres.raw("select clock_timestamp()>=?::timestamptz as expired", [expiresAt])).rows[0].expired)
            await new Promise(resolve => setTimeout(resolve, 20));
          await paymentHold.commit();
          orderingObservation = { payment_row_wait_crossed_expiry: true, attempted_writer_pid: attemptedWriter.pid,
            payment_update_pid: paymentHolder, delegate_waiter_pid: delegateWaiter.pid,
            queued_before_admission_release: true, delegate_blocked_on_payment_row: true,
            attempt_committed_before_expiry: true,
            payment_session_id: original.session.id };
        })().catch(error => { parentFailure ??= error; child.kill("SIGKILL"); });
        handlers.add(coordinating); void coordinating.finally(() => handlers.delete(coordinating));
      }
      for (const stream of [child.stdout!, child.stderr!]) stream.on("data", data => { output = (output + data).slice(-30000); });
      child.on("message", message => {
        const handling = (async () => {
        const phase = message as any;
        assert.equal(phase.identity.role, claim.worker!.role);
        if (providerOrdering && phase.phase === "provider-delegate-open") {
          assert.ok(provider && !retirement && !ready);
          let settled = false;
          retirement = retireOriginalExecutionWorker(postgres, claim.worker!.role).finally(() => { settled = true; });
          retirement.catch(() => undefined);
          let blocked: any;
          const deadline = Date.now() + 4000;
          while (Date.now() < deadline && !settled) {
            blocked = (await postgres.raw(`select pid,pg_blocking_pids(pid) as blockers from pg_catalog.pg_stat_activity
              where datname=current_database() and usename=current_user and query ilike '%update%rifare_operation%'
              and exists(select 1 from pg_catalog.pg_stat_activity blocker
                where blocker.pid=any(pg_blocking_pids(pg_stat_activity.pid)) and blocker.usename=?)`, [claim.worker!.role])).rows[0];
            if (blocked) break;
            await new Promise(resolve => setTimeout(resolve, 20));
          }
          const blockedBeforeRelease = Boolean(blocked) && !settled;
          if (!blockedBeforeRelease) console.log("C12_NATIVE_PROVIDER_EFFECT_FAULT=retirement-not-blocked-by-delegate");
          child.send({ phase: "provider-delegate-release" });
          await retirement;
          assert.ok(blockedBeforeRelease, "Canonical retirement must wait for the actual local System delegate transaction");
          orderingObservation = { provider_delegate_lock_observed: true, revoker_pid: blocked.pid,
            blockers: blocked.blockers, retirement_committed_after_system_delegate: true };
          return;
        }
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
        if (provider) {
          const audited = (beforeAudit as any[]).map(row => row.native_table);
          assert.deepEqual(audited, providerExpiry ? ["cart"] :
            ["cart", "payment_collection", "payment_collection", "payment_collection", "payment_collection"]);
          assert.equal((await postgres("payment_session").where({ id: original.session.id }).first("status")).status, "pending");
          assert.equal((await postgres("payment").where({ payment_session_id: original.session.id })).length, 0);
          assert.ok((await original.row()).execution_payment_attempted_at);
        } else assert.equal((beforeAudit as any[]).length, correlation ? 2 : 1);
        beforeStale = await snapshot();
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
        if (retirement) await retirement;
        else await retireOriginalExecutionWorker(postgres, claim.worker!.role);
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
      correlation, correlation_fault: correlationFault, provider, provider_fault: providerFault,
      provider_ordering: providerOrdering, provider_ordering_fault: providerOrderingFault,
      provider_expiry: providerExpiry, provider_expiry_fault: providerExpiryFault,
      provider_privacy: providerPrivacy,
      ordering_fault: orderingFault, ordering_observation: orderingObservation }, null, 2), { flag: "wx" });
    if (parentFailure) throw parentFailure;
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /C12_NATIVE_MODULE_WORKER_SHUTDOWN=complete/);
    assert.equal(await snapshot(), beforeStale, "Stale native writes must have zero effects, including early address and reservation rows");
    const finalAudit = await postgres("rifare_c12_generation_audit").orderBy("id");
    if (correlation) {
      assert.deepEqual(finalAudit.map((row: any) => row.native_table), ["cart", "payment_session"]);
      assert.ok(finalAudit.every((row: any) => row.authenticated_role === claim.worker!.role));
    } else assert.deepEqual(finalAudit, beforeAudit);
    if (ordering || revokeFirst || reconnect || providerOrdering || providerExpiry) {
      assert.ok(orderingObservation); console.log("C12_NATIVE_GENERATION_ORDERING=" + JSON.stringify(orderingObservation));
    }
    console.log(result.output.split(/\r?\n/).filter(value => value.startsWith("C12_NATIVE_")).join("\n"));
    console.log("C12_NATIVE_GENERATION_RESULT=" + JSON.stringify({ result: "pass",
      ...(reconnect ? { actual_backend_loss_and_reconnect: true, active_reconnect_native_writes: 1,
        post_retirement_native_method_acquisition_refusals: 1, same_existing_authenticated_session: false } :
        { actual_native_stale_write_refusals: 5, same_existing_authenticated_session: !provider,
          established_authenticated_worker_backend: true,
          ...(correlation ? { current_wrong_original_refusals: 10, healthy_original_session_writes: 1 } : {}) }),
      original_visibility_qualified: false, current_authority_fence_qualified: false,
      provider_admission_currentness_qualified: provider, provider_revocation_ordering_qualified: providerOrdering,
      provider_effect_time_fence_qualified: false, provider_expiry_at_delegate_qualified: providerExpiry,
      provider_one_shot_attempt_qualified: provider, attempted_state_privacy_restore_qualified: false,
      connected_provider_qualified: false, full_C12_qualified: false }));
  } finally {
    try {
      try {
        if (revocationPause && !revocationPause.isCompleted()) await revocationPause.rollback();
        if (paymentHold && !paymentHold.isCompleted()) await paymentHold.rollback();
        if (expiryPause && !expiryPause.isCompleted()) await expiryPause.rollback();
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
        if ((providerFault || providerOrderingFault || providerExpiryFault) && paymentDefinition) {
          await postgres.raw(paymentDefinition);
          assert.equal((await postgres.raw("select pg_get_functiondef('public.rifare_require_native_execution_payment(text,text,text)'::regprocedure) as definition")).rows[0].definition, paymentDefinition);
          console.log(providerExpiryFault ? "C12_NATIVE_PROVIDER_EXPIRY_FAULT_RESTORED=exact" :
            providerOrderingFault ? "C12_NATIVE_PROVIDER_EFFECT_FAULT_RESTORED=exact" : "C12_NATIVE_PROVIDER_FAULT_RESTORED=exact");
        }
      }
    } finally {
      try {
          if (revokeFirst) await postgres.raw(`drop trigger if exists rifare_c12_pause_retirement on public.rifare_operation;
          drop function if exists public.rifare_c12_pause_retirement()`);
          if (providerExpiry) await postgres.raw(`drop trigger if exists aaa_rifare_c12_delay_provider_expiry on public.rifare_operation;
            drop function if exists public.rifare_c12_delay_provider_expiry()`);
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
