import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules, ModulesSdkUtils } from "@medusajs/framework/utils";

/** C12 mechanism proof only. It is not the journal execution owner or a final
 * fence. The unguarded baseline demonstrates a stale native write. Optional
 * fixture guards test transaction ordering, not original authority or order coverage. */
export default async function verifyNativeWorkerIdentity({ container }: ExecArgs) {
  assert.equal(process.env.NODE_ENV, "test"); assert.equal(process.env.RIFARE_COMMERCE_VERIFY, "disposable");
  assert.equal(process.env.RIFARE_TEST_NATIVE_EXECUTION, "worker-identity");
  const guarded = process.env.RIFARE_C12_IDENTITY_GUARD === "statement";
  assert.ok(process.env.RIFARE_C12_IDENTITY_GUARD === undefined || guarded);
  assert.ok(process.env.RIFARE_C12_IDENTITY_GUARD_FAULT === undefined ||
    guarded && process.env.RIFARE_C12_IDENTITY_GUARD_FAULT === "omit");
  const postgres = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const carts = container.resolve(Modules.CART), payments: any = container.resolve(Modules.PAYMENT);
  for (const method of ["createPaymentCollections", "createPaymentSession", "authorizePaymentSession"])
    assert.equal(typeof payments[method], "function");
  if (process.env.RIFARE_C12_IDENTITY_WORKER) {
    const task = JSON.parse(process.env.RIFARE_C12_IDENTITY_WORKER);
    const identity = (await postgres.raw("select session_user as authenticated_role, current_user as effective_role, pg_backend_pid() as pid")).rows[0];
    assert.equal(identity.authenticated_role, task.role); assert.equal(identity.effective_role, task.role);
    await assert.rejects(postgres.raw('set role "' + task.foreign_role + '"'), (error: any) => error.code === "42501");
    await assert.rejects(postgres.raw('set session authorization "' + task.foreign_role + '"'), (error: any) => error.code === "42501");
    await assert.rejects(postgres("rifare_c12_identity_control").update({ active_role: task.role }), (error: any) => error.code === "42501");
    // Neither a session label nor a native metadata assertion authenticates a role.
    await postgres.raw("select set_config('application_name', ?, false)", [task.foreign_role]);
    if (task.action === "payment") {
      const result = await payments.authorizePaymentSession(task.session_id, {}); assert.ok(result?.id);
    } else {
      await carts.updateCarts(task.cart_id, { email: task.email, metadata: { asserted_worker: task.foreign_role, asserted_generation: 999 } });
      if (task.action === "cart-and-line") await carts.addLineItems({ cart_id: task.cart_id, title: "Synthetic native role proof", quantity: 1, unit_price: 1 });
    }
    console.log("C12_WORKER_AUTHENTICATED=" + JSON.stringify(identity)); return;
  }
  const original = await carts.createCarts({ currency_code: "usd", email: "before-c12@example.invalid" });
  const collection = (await payments.createPaymentCollections([{ currency_code: "usd", amount: 1 }]))[0];
  const session = await payments.createPaymentSession(collection.id, { provider_id: "pp_system_default", currency_code: "usd", amount: 1, data: {} });
  const roles = ["a", "b"].map(suffix => ({ role: "rifare_c12_" + suffix + "_" + randomUUID().replaceAll("-", ""), password: randomBytes(32).toString("hex") }));
  for (const value of roles) {
    assert.match(value.role, /^rifare_c12_[ab]_[a-f0-9]{32}$/); assert.match(value.password, /^[a-f0-9]{64}$/);
    try {
      await postgres.raw(`create role "${value.role}" login password '${value.password}' nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls`);
    } catch { throw new Error("C12_SYNTHETIC_ROLE_PROVISIONING_FAILED"); }
    await postgres.raw('grant usage on schema public to "' + value.role + '"');
    await postgres.raw('grant select, insert, update, delete on all tables in schema public to "' + value.role + '"');
    await postgres.raw('grant usage, select, update on all sequences in schema public to "' + value.role + '"');
  }
  assert.ok(process.env.RIFARE_C12_IDENTITY_CUSTODY?.endsWith("-private.json"));
  writeFileSync(process.env.RIFARE_C12_IDENTITY_CUSTODY!, JSON.stringify({ qualification_only: true,
    source: process.env.RIFARE_C12_SOURCE, roles, cart_id: original.id, collection_id: collection.id, session_id: session.id }, null, 2), { flag: "wx", mode: 0o600 });
  // Fixture-only tables are created after native grants: workers cannot modify
  // their control or forge the observed authenticated identity.
  await postgres.raw("create table public.rifare_c12_identity_control (id integer primary key, active_role text not null, generation bigint not null)");
  await postgres("rifare_c12_identity_control").insert({ id: 1, active_role: roles[0].role, generation: 1 });
  await postgres.raw("create table public.rifare_c12_identity_audit (id bigserial primary key, native_table text not null, action text not null, authenticated_role text not null, effective_role text not null, backend_pid integer not null, row_id text not null)");
  assert.match(original.id, /^cart_[A-Za-z0-9]+$/); assert.match(session.id, /^payses_[A-Za-z0-9]+$/);
  await postgres.raw(`create function public.rifare_c12_observe_identity() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
    begin
      insert into public.rifare_c12_identity_audit(native_table,action,authenticated_role,effective_role,backend_pid,row_id)
      values(TG_TABLE_NAME,TG_OP,session_user,current_user,pg_backend_pid(),coalesce(NEW.id,OLD.id));
      return coalesce(NEW,OLD);
    end $$;
    create trigger rifare_c12_identity after update on public.cart for each row when (NEW.id='${original.id}') execute function public.rifare_c12_observe_identity();
    create trigger rifare_c12_identity after insert on public.cart_line_item for each row when (NEW.cart_id='${original.id}') execute function public.rifare_c12_observe_identity();
    create trigger rifare_c12_identity after insert on public.payment for each row when (NEW.payment_session_id='${session.id}') execute function public.rifare_c12_observe_identity();
    create trigger rifare_c12_identity after update on public.payment_session for each row when (NEW.id='${session.id}') execute function public.rifare_c12_observe_identity();
    create trigger rifare_c12_identity after update on public.payment_collection for each row when (NEW.id='${collection.id}') execute function public.rifare_c12_observe_identity();`);
  if (guarded) {
    // Disposable mechanism only: one fixture control row and two test logins.
    // This is not durable journal admission or original row correlation.
    // FOR SHARE orders native write transactions against a revocation update,
    // including before any native row exists.
    await postgres.raw(`create function public.rifare_c12_require_current_identity() returns trigger
      language plpgsql security definer set search_path=pg_catalog,public as $$
      declare selected_role text;
      begin
        select active_role into selected_role from public.rifare_c12_identity_control where id=1 for share;
        if session_user::text ~ '^rifare_c12_[ab]_[a-f0-9]{32}$' and
          (selected_role is null or selected_role <> session_user::text) then
          raise exception 'C12 native worker is unavailable' using errcode='42501';
        end if;
        return null;
      end $$`);
    for (const table of ["cart", "cart_line_item", "payment", "payment_session", "payment_collection"])
      await postgres.raw(`create trigger rifare_c12_identity_guard before insert or update or delete on public.${table}
        for each statement execute function public.rifare_c12_require_current_identity()`);
  }
  const run = (index: number, action: string, email: string) => new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const selected = roles[index], foreign = roles[1 - index], database = new URL(process.env.DATABASE_URL!);
    database.username = selected.role; database.password = selected.password;
    const env = { ...process.env, DATABASE_URL: database.href,
      JWT_SECRET: randomBytes(32).toString("hex"), COOKIE_SECRET: randomBytes(32).toString("hex"),
      RIFARE_C12_IDENTITY_WORKER: JSON.stringify({ role: selected.role, foreign_role: foreign.role,
        action, email, cart_id: original.id, session_id: session.id }) };
    for (const key of Object.keys(env)) if (key === "PGPASSWORD" || key === "RIFARE_C12_IDENTITY_CUSTODY" ||
      key.startsWith("RIFARE_JOURNAL_PRIVACY_") || key.startsWith("RIFARE_C12_CONTROLLER_")) delete (env as any)[key];
    const child = spawn(process.execPath, ["run.mjs", "exec", __filename], { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; const timer = setTimeout(() => { child.kill(); reject(new Error("C12 native worker deadline")); }, 45000);
    for (const stream of [child.stdout, child.stderr]) stream.on("data", data => { output = (output + data).slice(-20000); });
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", code => { clearTimeout(timer); resolve({ code, output }); });
  });
  const current = await run(0, "cart-and-line", "current-c12@example.invalid"); assert.equal(current.code, 0, current.output);
  const payment = await run(0, "payment", "unused@example.invalid"); assert.equal(payment.code, 0, payment.output);
  const audit = await postgres("rifare_c12_identity_audit").orderBy("id");
  for (const table of ["cart", "cart_line_item", "payment", "payment_session", "payment_collection"]) {
    assert.ok(audit.some(row => row.native_table === table), "Actual native write missing from role evidence: " + table);
  }
  assert.ok(audit.every(row => row.authenticated_role === roles[0].role));
  assert.ok(new Set(audit.map(row => row.backend_pid)).size >= 2, "Separate native workers must reach separate backends");
  console.log("C12_NATIVE_ROLE_POSITIVE=" + JSON.stringify({ tables: [...new Set(audit.map(row => row.native_table))],
    authenticated_role: roles[0].role, native_backend_count: new Set(audit.map(row => row.backend_pid)).size,
    forged_application_name_and_metadata_did_not_change_identity: true, role_and_control_forgery_refused: true,
    native_payment_service_models_migrations_and_system_provider_unchanged: true }));
  if (guarded) {
    // Separate authenticated SQL transactions isolate the trigger lock ordering
    // proof from native-module propagation (proved above). Observe the real
    // blocking relationship rather than accepting a timer as evidence.
    const url = new URL(process.env.DATABASE_URL!); url.username = roles[0].role; url.password = roles[0].password;
    const workerPool = ModulesSdkUtils.createPgConnection({ clientUrl: url.href, pool: { min: 0, max: 1 } });
    const holder = await workerPool.transaction(), revoker = await postgres.transaction();
    let pending: Promise<unknown> | undefined;
    try {
      const holderPid = (await holder.raw("select pg_backend_pid() as pid")).rows[0].pid;
      const revokerPid = (await revoker.raw("select pg_backend_pid() as pid")).rows[0].pid;
      assert.notEqual(holderPid, revokerPid);
      await revoker.raw("set local statement_timeout='5s'");
      await holder("cart").where({ id: original.id }).update({ email: "ordered-c12@example.invalid" });
      let settled = false;
      pending = revoker("rifare_c12_identity_control").where({ id: 1 })
        .update({ active_role: roles[1].role, generation: 2 }).then(value => { settled = true; return value; });
      // Attach immediately so an unexpected timeout remains a reported failure.
      pending.catch(() => undefined);
      let observed = false;
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        const blockers = (await postgres.raw("select pg_blocking_pids(?) as blockers", [revokerPid])).rows[0].blockers;
        if (blockers.includes(holderPid)) { observed = true; break; }
        if (settled) break;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.ok(observed && !settled, "Revocation must wait on the actual native-write trigger transaction");
      await holder.commit(); await pending; await revoker.commit();
      console.log("C12_NATIVE_GUARD_ORDERING=" + JSON.stringify({ actual_blocker_observed: true, holder_pid: holderPid,
        revoker_pid: revokerPid, revocation_committed_after_write_transaction: true }));
    } finally {
      if (!holder.isCompleted()) await holder.rollback();
      if (!revoker.isCompleted()) await revoker.rollback();
      if (pending) await pending.catch(() => undefined);
      await workerPool.destroy();
    }
  } else {
  await postgres("rifare_c12_identity_control").where({ id: 1 }).update({ active_role: roles[1].role, generation: 2 });
  }
  const successor = await run(1, "cart", "successor-c12@example.invalid"); assert.equal(successor.code, 0, successor.output);
  const successorAudit = await postgres("rifare_c12_identity_audit").where({ authenticated_role: roles[1].role });
  assert.ok(successorAudit.some(row => row.native_table === "cart"));
  console.log("C12_NATIVE_ROLE_SUCCESSOR=" + JSON.stringify({ authenticated_role: roles[1].role, native_cart_write_observed: true }));
  if (process.env.RIFARE_C12_IDENTITY_GUARD_FAULT === "omit") {
    // Fault actual disposable enforcement, keeping the stale oracle unchanged.
    await postgres.raw(`create or replace function public.rifare_c12_require_current_identity() returns trigger
      language plpgsql security definer set search_path=pg_catalog,public as $$ begin return null; end $$`);
  }
  const auditBeforeStale = await postgres("rifare_c12_identity_audit").orderBy("id");
  const before = await postgres("cart").where({ id: original.id }).first();
  const stale = await run(0, "cart", "stale-c12@example.invalid");
  assert.notEqual(stale.code, 0, "C12 stale authenticated worker must be refused at the native write boundary");
  assert.deepEqual(await postgres("cart").where({ id: original.id }).first(), before);
  assert.deepEqual(await postgres("rifare_c12_identity_audit").orderBy("id"), auditBeforeStale,
    "Refused stale worker must produce zero native audit writes");
  console.log("C12_NATIVE_WORKER_IDENTITY_RESULT=" + JSON.stringify({ result: "pass", qualification_only: true,
    statement_write_guard_mechanism_qualified: guarded, native_order_coverage_qualified: false,
    execution_authorized: false, full_execution_owner_qualified: false }));
}
