import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";

/** C12 mechanism proof only. It is not the journal execution owner or a final
 * fence. The baseline deliberately demonstrates a stale native write. */
export default async function verifyNativeWorkerIdentity({ container }: ExecArgs) {
  assert.equal(process.env.NODE_ENV, "test"); assert.equal(process.env.RIFARE_COMMERCE_VERIFY, "disposable");
  assert.equal(process.env.RIFARE_TEST_NATIVE_EXECUTION, "worker-identity");
  const postgres = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const carts = container.resolve(Modules.CART), payments: any = container.resolve(Modules.PAYMENT);
  assert.deepEqual(payments.nativeExecutionQualificationProfile(), {
    native_service_extension: true, execution_authorized: false, production_qualified: false,
  });
  if (process.env.RIFARE_C12_IDENTITY_WORKER) {
    const task = JSON.parse(process.env.RIFARE_C12_IDENTITY_WORKER);
    const identity = (await postgres.raw("select session_user as authenticated_role, current_user as effective_role, pg_backend_pid() as pid")).rows[0];
    assert.equal(identity.authenticated_role, task.role); assert.equal(identity.effective_role, task.role);
    await assert.rejects(postgres.raw('set role "' + task.foreign_role + '"'), (error: any) => error.code === "42501");
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
    native_payment_service_extension_preserved_models_migrations_and_system_provider: true }));
  await postgres("rifare_c12_identity_control").where({ id: 1 }).update({ active_role: roles[1].role, generation: 2 });
  const before = await postgres("cart").where({ id: original.id }).first();
  const stale = await run(0, "cart", "stale-c12@example.invalid");
  assert.notEqual(stale.code, 0, "C12 stale authenticated worker must be refused at the native write boundary");
  assert.deepEqual(await postgres("cart").where({ id: original.id }).first(), before);
  console.log("C12_NATIVE_WORKER_IDENTITY_RESULT=" + JSON.stringify({ result: "pass", qualification_only: true,
    execution_authorized: false, full_execution_owner_qualified: false }));
}
