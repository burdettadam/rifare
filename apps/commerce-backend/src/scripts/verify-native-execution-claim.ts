import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, ModulesSdkUtils } from "@medusajs/framework/utils";
import { nativePaymentFixture } from "./native-payment-fixture";
import { bytes } from "./native-receipt-fixture";
import { operationJournalModule } from "../modules/operation-journal";
import type OperationJournalService from "../modules/operation-journal/service";
import { journalPrivacyInstallationId } from "../modules/operation-journal/privacy";
import { executionFingerprint, requireNativeExecutionProfile } from "../modules/operation-journal/execution-claim";

/** Genuine retained C7/C8/C9 evidence plus actual PostgreSQL durable first claim.
 * No native completion or provider authorization is dispatched by this stage. */
export default async function verifyNativeExecutionClaim({ container }: ExecArgs) {
  requireNativeExecutionProfile();
  if (process.env.RIFARE_C12_CLAIM_WORKER) {
    const task = JSON.parse(process.env.RIFARE_C12_CLAIM_WORKER);
    const journal = container.resolve<OperationJournalService>(operationJournalModule);
    const verifier = await journal.createAuthorityReceiptVerifier(bytes(task.trust));
    try {
      const result = await journal.claimNativeExecution(task.id, task.context, verifier);
      assert.equal(result.disposition, "recovery_only"); assert.equal(result.worker, null); assert.equal(result.seal, null);
      console.log("C12_CLAIM_RESTART_RECOVERY_ONLY"); return;
    } finally { verifier.close(); }
  }
  const f = await nativePaymentFixture(container, false, true), { journal, postgres, context, verifier } = f;
  const checks: string[] = [], check = async (name: string, run: () => Promise<void>) => {
    await run(); checks.push(name); console.log("C12_CLAIM_CHECK " + name);
  };
  const roleCount = async () => Number((await postgres.raw("select count(*) as n from pg_roles where rolname ~ '^rifare_exec_[a-f0-9]{32}$'")).rows[0].n);
  const financial = async () => {
    const rows: Record<string, unknown> = {};
    for (const table of ["cart", "cart_line_item", "order", "reservation_item", "payment_collection", "payment_session", "payment", "capture", "refund"])
      rows[table] = await postgres(table).orderBy("id");
    return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  };
  const noEffect = async (run: () => Promise<unknown>) => {
    const before = await financial(); try { return await run(); } finally { assert.equal(await financial(), before); }
  };
  const sample = await f.makePaymentOriginal(), id = sample.command.command_id;
  let claim: Awaited<ReturnType<OperationJournalService["claimNativeExecution"]>>;
  await check("C12-CLAIM-FIRST genuine finalization and receipt consume one durable original without a native effect", async () => {
    const count = await roleCount();
    claim = await noEffect(() => journal.claimNativeExecution(id, context, verifier)) as typeof claim;
    assert.equal(claim.disposition, "claimed_unknown"); assert.equal(claim.execution_authorized, false); assert.equal(claim.native_fence_qualified, false);
    assert.ok(claim.worker); assert.ok(claim.seal); assert.equal(await roleCount(), count + 1);
    const row = await sample.row(); assert.equal(row.state, "unknown"); assert.equal(row.execution_generation, 1);
    assert.equal(row.execution_owner_fingerprint, executionFingerprint(claim.worker!.role));
    assert.equal(row.execution_seal_fingerprint, executionFingerprint(claim.seal!));
    assert.equal(row.execution_payment_handle_fingerprint, executionFingerprint(sample.session.data.rifare_native_execution.handle));
    assert.equal(row.payment_provider_id, "pp_rifare_fenced_system_fixture");
    assert.equal(row.execution_revoked_at, null); assert.equal(row.payable_minor_units, "1250");
    assert.equal(row.execution_expires_at.getTime(), row.receipt_expires_at.getTime());
    assert.ok(process.env.RIFARE_C12_CLAIM_CUSTODY?.endsWith("-private.json"));
    writeFileSync(process.env.RIFARE_C12_CLAIM_CUSTODY!, JSON.stringify({ source: process.env.RIFARE_C12_SOURCE,
      original_id: id, worker: claim.worker, seal: claim.seal }, null, 2), { flag: "wx", mode: 0o600 });
  });
  await check("C12-CLAIM-REPEAT uncertainty returns recovery only and never another worker or seal", async () => {
    const before = await sample.row(), count = await roleCount();
    for (let i = 0; i < 2; i++) {
      const result = await noEffect(() => journal.claimNativeExecution(id, context, verifier)) as typeof claim;
      assert.equal(result.disposition, "recovery_only"); assert.equal(result.worker, null); assert.equal(result.seal, null);
    }
    assert.deepEqual(await sample.row(), before); assert.equal(await roleCount(), count);
  });
  await check("C12-CLAIM-RESTART a distinct controller process cannot resend the claimed original", async () => {
    const count = await roleCount(), before = await sample.row();
    const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      const child = spawn(process.execPath, ["run.mjs", "exec", __filename], { cwd: process.cwd(), env: { ...process.env,
        RIFARE_C12_CLAIM_WORKER: JSON.stringify({ id, trust: f.trust, context }) }, stdio: ["ignore", "pipe", "pipe"] });
      let output = ""; const timer = setTimeout(() => { child.kill(); reject(new Error("C12 claim worker deadline")); }, 45000);
      for (const stream of [child.stdout, child.stderr]) stream.on("data", value => { output = (output + value).slice(-16000); });
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("exit", code => { clearTimeout(timer); resolve({ code, output }); });
    });
    assert.equal(result.code, 0, result.output); assert.match(result.output, /C12_CLAIM_RESTART_RECOVERY_ONLY/);
    assert.deepEqual(await sample.row(), before); assert.equal(await roleCount(), count);
  });
  await check("C12-CLAIM-CONCURRENT separate transactions mint exactly one original worker", async () => {
    const other = await f.makePaymentOriginal(), count = await roleCount();
    const attempts = await noEffect(() => Promise.allSettled([
      journal.claimNativeExecution(other.command.command_id, context, verifier),
      journal.claimNativeExecution(other.command.command_id, context, verifier),
    ])) as PromiseSettledResult<typeof claim>[];
    const owners = attempts.filter((row): row is PromiseFulfilledResult<typeof claim> =>
      row.status === "fulfilled" && row.value.disposition === "claimed_unknown");
    assert.equal(owners.length, 1); assert.equal(await roleCount(), count + 1);
    const row = await other.row(); assert.equal(row.execution_owner_fingerprint, executionFingerprint(owners[0].value.worker!.role));
    writeFileSync(process.env.RIFARE_C12_CLAIM_CUSTODY!.replace("-private.json", "-concurrent-private.json"),
      JSON.stringify({ source: process.env.RIFARE_C12_SOURCE, original_id: other.command.command_id,
        worker: owners[0].value.worker, seal: owners[0].value.seal }, null, 2), { flag: "wx", mode: 0o600 });
    const retry = await journal.claimNativeExecution(other.command.command_id, context, verifier);
    assert.equal(retry.disposition, "recovery_only"); assert.equal(retry.worker, null);
  });
  await check("C12-CLAIM-EXPIRY actual signed receipt deadline cannot mint an attempt", async () => {
    const other = await f.makePaymentOriginal({ receiptLifetime: 1000 }), before = await other.row(), count = await roleCount();
    const remaining = before.receipt_expires_at.getTime() - await f.clock();
    if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining + 30));
    await noEffect(() => assert.rejects(journal.claimNativeExecution(other.command.command_id, context, verifier)));
    assert.deepEqual(await other.row(), before); assert.equal(await roleCount(), count);
  });
  await check("C12-CLAIM-IMMUTABLE SQL cannot reset owner generation seal attempt time or uncertainty", async () => {
    const row = await sample.row();
    for (const change of [{ execution_owner_fingerprint: "sha256:" + "1".repeat(64) }, { execution_generation: 0 },
      { execution_seal_fingerprint: null }, { execution_claimed_at: new Date(row.execution_claimed_at.getTime() + 1) },
      { execution_expires_at: new Date(row.execution_expires_at.getTime() + 1) }, { state: "awaiting_authority" },
      { execution_revoked_at: new Date() }]) {
      await assert.rejects(postgres("rifare_operation").where({ id: row.id }).update(change), (error: any) => error.code === "23514");
      assert.deepEqual(await sample.row(), row);
    }
    await assert.rejects(journal.cancel(id, row.revision, context));
  });
  await check("C12-CLAIM-SQL-NULL first admission and INSERT cannot bypass nonnull generation deadline or order identity", async () => {
    const other = await f.makePaymentOriginal(), before = await other.row();
    const proposed = { state: "unknown", execution_owner_fingerprint: executionFingerprint(randomUUID()),
      execution_seal_fingerprint: executionFingerprint(randomUUID()), execution_payment_handle_fingerprint: executionFingerprint(randomUUID()),
      execution_generation: 1, execution_claimed_at: new Date(await f.clock()), execution_expires_at: before.receipt_expires_at,
      payment_fingerprint: executionFingerprint(randomUUID()), payment_collection_id: other.collection.id, payment_session_id: other.session.id,
      payment_provider_id: "pp_rifare_fenced_system_fixture", payment_context_digest: executionFingerprint(randomUUID()), payment_observed_at: new Date(await f.clock()) };
    for (const change of [{ execution_generation: null }, { execution_expires_at: null },
      { execution_order_id: "order_prebound" }, { execution_order_fingerprint: executionFingerprint("prebound") },
      { execution_order_id: "order_prebound", execution_order_fingerprint: executionFingerprint("prebound") }]) {
      await assert.rejects(postgres("rifare_operation").where({ id: before.id }).update({ ...proposed, ...change }),
        (error: any) => error.code === "23514");
      assert.deepEqual(await other.row(), before);
    }
    const inserted = { ...before, ...proposed, id: "rifop_" + randomUUID().replaceAll("-", ""), original_command_uuid: randomUUID(),
      challenge_fingerprint: executionFingerprint(randomUUID()), receipt_fingerprint: executionFingerprint(randomUUID()), final_command_uuid: randomUUID() };
    for (const change of [{}, { execution_generation: null }, { execution_expires_at: null }])
      await assert.rejects(postgres("rifare_operation").insert({ ...inserted, ...change }), (error: any) => error.code === "23514");
  });
  await check("C12-CLAIM-ROLE native login cannot read or forge journal authority or become controller", async () => {
    const url = new URL(process.env.DATABASE_URL!); url.username = claim!.worker!.role; url.password = claim!.worker!.password;
    const pool = ModulesSdkUtils.createPgConnection({ clientUrl: url.href, pool: { min: 0, max: 1 } });
    try {
      assert.equal((await pool.raw("select session_user as role")).rows[0].role, claim!.worker!.role);
      assert.ok(await pool("cart").where({ id: sample.cart.id }).first("id"));
      await assert.rejects(pool("rifare_operation").select("id"), (error: any) => error.code === "42501");
      for (const table of ["auth_identity", "user", "api_key", "rifare_operation_privacy_subject"])
        await assert.rejects(pool(table).select("id"), (error: any) => error.code === "42501");
      assert.deepEqual(await pool("workflow_execution").select("id"), []);
      const checkpoint = { id: "wf_exec_" + randomUUID().replaceAll("-", ""), workflow_id: "complete-cart",
        transaction_id: claim!.seal!, run_id: randomUUID(), state: "not_started" };
      await pool("workflow_execution").insert(checkpoint);
      assert.deepEqual(await pool("workflow_execution").select("id"), [{ id: checkpoint.id }]);
      await pool("workflow_execution").where({ id: checkpoint.id }).delete();
      for (const change of [{ transaction_id: randomUUID() }, { workflow_id: "capture-payment" }])
        await assert.rejects(pool("workflow_execution").insert({ ...checkpoint, id: "wf_exec_" + randomUUID().replaceAll("-", ""),
          run_id: randomUUID(), ...change }), (error: any) => error.code === "42501");
      await assert.rejects(pool("customer").where({ id: f.customer.id }).update({ has_account: false }), (error: any) => error.code === "42501");
      await assert.rejects(pool("rifare_operation").where({ id: (await sample.row()).id }).update({ execution_generation: 999 }), (error: any) => error.code === "42501");
      const controller = (await postgres.raw("select session_user as role")).rows[0].role;
      assert.match(controller, /^[a-zA-Z0-9_]+$/);
      await assert.rejects(pool.raw('set role "' + controller + '"'), (error: any) => error.code === "42501");
    } finally { await pool.destroy(); }
  });
  await check("C12-CLAIM-WORKFLOW-POLICY altered or additional permissive policy blocks worker creation", async () => {
    const faults = [
      {
        apply: () => postgres.raw(`alter policy rifare_native_workflow_execution on public.workflow_execution
          using (true) with check (true)`),
        restore: () => postgres.raw(`alter policy rifare_native_workflow_execution on public.workflow_execution
          using (public.rifare_native_workflow_allowed(workflow_id,transaction_id))
          with check (public.rifare_native_workflow_allowed(workflow_id,transaction_id))`),
      },
      {
        apply: () => postgres.raw(`create policy c12_unapproved_permissive on public.workflow_execution
          as permissive for all to public using (true) with check (true)`),
        restore: () => postgres.raw("drop policy c12_unapproved_permissive on public.workflow_execution"),
      },
    ];
    for (const fault of faults) {
      const original = await f.makePaymentOriginal(), before = await original.row(), count = await roleCount();
      await fault.apply();
      try {
        assert.equal((await postgres.raw("select public.rifare_native_workflow_ready() as ready")).rows[0].ready, false);
        await noEffect(() => assert.rejects(journal.claimNativeExecution(original.command.command_id, context, verifier)));
        assert.deepEqual(await original.row(), before); assert.equal(await roleCount(), count);
      } finally { await fault.restore(); }
      assert.equal((await postgres.raw("select public.rifare_native_workflow_ready() as ready")).rows[0].ready, true);
    }
  });
  await check("C12-CLAIM-WORKFLOW-CONTROL ordinary nonworker workflow role remains unaffected", async () => {
    const role = "rifare_workflow_control_" + randomUUID().replaceAll("-", ""), password = randomUUID().replaceAll("-", "");
    const row = { id: "wf_exec_" + randomUUID().replaceAll("-", ""), workflow_id: "ordinary-control",
      transaction_id: randomUUID(), run_id: randomUUID(), state: "not_started" };
    let pool: ReturnType<typeof ModulesSdkUtils.createPgConnection> | undefined, created = false;
    try {
      await postgres.raw(`create role "${role}" login password '${password}' nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls`);
      created = true;
      await postgres.raw(`grant usage on schema public to "${role}"`);
      await postgres.raw(`grant select,insert,update,delete on public.workflow_execution to "${role}"`);
      const url = new URL(process.env.DATABASE_URL!); url.username = role; url.password = password;
      pool = ModulesSdkUtils.createPgConnection({ clientUrl: url.href, pool: { min: 0, max: 1 } });
      assert.equal((await pool.raw("select session_user as role")).rows[0].role, role);
      await pool("workflow_execution").insert(row);
      assert.deepEqual(await pool("workflow_execution").where({ id: row.id }).select("id"), [{ id: row.id }]);
      await pool("workflow_execution").where({ id: row.id }).delete();
    } finally {
      if (pool) await pool.destroy();
      await postgres("workflow_execution").where({ id: row.id }).delete();
      if (created) {
        await postgres.raw(`revoke all on public.workflow_execution from "${role}"`);
        await postgres.raw(`revoke usage on schema public from "${role}"`);
        await postgres.raw(`drop role "${role}"`);
      }
    }
  });
  await check("C12-CLAIM-ADMISSION missing genuine final or receipt and legacy System cannot mint a worker", async () => {
    for (const options of [{ withFinalization: false }, { retainReceipt: false }, { providerId: "pp_system_default" }]) {
      const other = await f.makePaymentOriginal(options), before = await other.row(), count = await roleCount();
      await noEffect(() => assert.rejects(journal.claimNativeExecution(other.command.command_id, context, verifier)));
      assert.deepEqual(await other.row(), before); assert.equal(await roleCount(), count);
    }
    const other = await f.makePaymentOriginal(), before = await other.row(), count = await roleCount();
    await assert.rejects(journal.claimNativeExecution(other.command.command_id, context, { verified: true }));
    const previous = process.env.RIFARE_TEST_NATIVE_EXECUTION; delete process.env.RIFARE_TEST_NATIVE_EXECUTION;
    try { await assert.rejects(journal.claimNativeExecution(other.command.command_id, context, verifier)); }
    finally { process.env.RIFARE_TEST_NATIVE_EXECUTION = previous; }
    assert.deepEqual(await other.row(), before); assert.equal(await roleCount(), count);
  });
  const requireRetiredCredential = async (other: Awaited<ReturnType<typeof f.makePaymentOriginal>>) => {
    const row = await other.row(); assert.equal(row.state, "unknown"); assert.equal(row.execution_generation, 2);
    assert.ok(row.execution_revoked_at instanceof Date);
    const roles = (await postgres.raw("select rolname, rolcanlogin from pg_roles where 'sha256:' || encode(sha256(convert_to(rolname::text,'UTF8')),'hex') = ?",
      [row.execution_owner_fingerprint])).rows;
    assert.equal(roles.length, 1); assert.equal(roles[0].rolcanlogin, false);
    const retry = await journal.claimNativeExecution(other.command.command_id, context, verifier);
    assert.equal(retry.disposition, "recovery_only"); assert.equal(retry.worker, null);
  };
  await check("C12-CLAIM-COMMIT-OWNER deferred ownership withdrawal never releases credentials", async () => {
    const other = await f.makePaymentOriginal(), commandId = other.command.command_id;
    assert.match(commandId, /^[a-f0-9-]{36}$/); assert.match(f.identity.id, /^authid_[A-Za-z0-9]+$/);
    await postgres.raw(`create function public.c12_claim_owner_commit() returns trigger language plpgsql as $$ begin
      if NEW.original_command_uuid='${commandId}' and OLD.execution_owner_fingerprint is null and NEW.execution_owner_fingerprint is not null
        then update public.auth_identity set app_metadata='{"customer_id":"cus_other"}'::jsonb where id='${f.identity.id}'; end if; return NEW; end $$;
      create constraint trigger c12_claim_owner after update on public.rifare_operation deferrable initially deferred
      for each row execute function public.c12_claim_owner_commit()`);
    try { await noEffect(() => assert.rejects(journal.claimNativeExecution(commandId, context, verifier))); }
    finally {
      await postgres.raw("drop trigger c12_claim_owner on public.rifare_operation; drop function public.c12_claim_owner_commit()");
      await postgres("auth_identity").where({ id: f.identity.id }).update({ app_metadata: { customer_id: f.customer.id } });
    }
    await requireRetiredCredential(other);
  });
  await check("C12-CLAIM-COMMIT-PRIVACY suppression during deferred COMMIT retains uncertainty and retires login", async () => {
    const other = await f.makePaymentOriginal(), commandId = other.command.command_id;
    const marker = "hmac-sha256:" + createHmac("sha256", Buffer.from(process.env.RIFARE_JOURNAL_PRIVACY_KEY!, "base64url"))
      .update(JSON.stringify(["urn:rifare:medusa-journal-privacy-subject:v1", f.merchant.merchant_namespace, f.merchant.store_id, f.customer.id])).digest("hex");
    assert.ok(await postgres("rifare_operation_privacy_subject").where({ id: marker, suppressed: false }).first());
    await postgres.raw(`create function public.c12_claim_privacy_commit() returns trigger language plpgsql as $$ begin
      if NEW.original_command_uuid='${commandId}' and OLD.execution_owner_fingerprint is null and NEW.execution_owner_fingerprint is not null
        then update public.rifare_operation_privacy_subject set suppressed=true where id='${marker}'; end if; return NEW; end $$;
      create constraint trigger c12_claim_privacy after update on public.rifare_operation deferrable initially deferred
      for each row execute function public.c12_claim_privacy_commit()`);
    try { await noEffect(() => assert.rejects(journal.claimNativeExecution(commandId, context, verifier))); }
    finally {
      await postgres.raw("drop trigger c12_claim_privacy on public.rifare_operation; drop function public.c12_claim_privacy_commit()");
      await postgres("rifare_operation_privacy_subject").where({ id: marker }).update({ suppressed: false });
    }
    await requireRetiredCredential(other);
  });
  for (const mode of ["abort", "expiry"]) await check("C12-CLAIM-COMMIT-" + mode.toUpperCase() + " actual blocked COMMIT prevents credential release", async () => {
    const other = await f.makePaymentOriginal(mode === "expiry" ? { receiptLifetime: 1500 } : {}), commandId = other.command.command_id;
    const controller = new AbortController(), blocker = await postgres.transaction();
    const blockerPid = (await blocker.raw("select pg_backend_pid() as pid")).rows[0].pid;
    await blocker.raw("select pg_advisory_xact_lock(120,12)");
    await postgres.raw(`create function public.c12_claim_wait_commit() returns trigger language plpgsql as $$ begin
      if NEW.original_command_uuid='${commandId}' and OLD.execution_owner_fingerprint is null and NEW.execution_owner_fingerprint is not null
        then perform pg_advisory_xact_lock(120,12); end if; return NEW; end $$;
      create constraint trigger c12_claim_wait after update on public.rifare_operation deferrable initially deferred
      for each row execute function public.c12_claim_wait_commit()`);
    const action = noEffect(() => journal.claimNativeExecution(commandId, context, verifier, controller.signal));
    action.catch(() => undefined);
    try {
      const deadline = Date.now() + 8000; let waiting = false;
      while (Date.now() < deadline) {
        const rows = (await postgres.raw("select pid from pg_stat_activity where wait_event='advisory' and ? = any(pg_blocking_pids(pid))", [blockerPid])).rows;
        if (rows.length) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.ok(waiting, "Actual first-claim COMMIT must be blocked");
      if (mode === "abort") controller.abort();
      else {
        const remaining = (await other.row()).receipt_expires_at.getTime() - await f.clock();
        if (remaining >= 0) await new Promise(resolve => setTimeout(resolve, remaining + 30));
      }
      await blocker.commit(); await assert.rejects(action);
    } finally {
      if (!blocker.isCompleted()) await blocker.rollback();
      await action.catch(() => undefined);
      await postgres.raw("drop trigger c12_claim_wait on public.rifare_operation; drop function public.c12_claim_wait_commit()");
    }
    await requireRetiredCredential(other);
  });
  for (const mode of ["owner", "privacy", "abort", "expiry", "installation-key", "clock-regression"]) await check("C12-CLAIM-ACTIVATION-" + mode.toUpperCase() + " terminal activation boundary prevents credential release", async () => {
    const other = await f.makePaymentOriginal(mode === "expiry" ? { receiptLifetime: 2000 } : {}), commandId = other.command.command_id;
    const marker = "hmac-sha256:" + createHmac("sha256", Buffer.from(process.env.RIFARE_JOURNAL_PRIVACY_KEY!, "base64url"))
      .update(JSON.stringify(["urn:rifare:medusa-journal-privacy-subject:v1", f.merchant.merchant_namespace, f.merchant.store_id, f.customer.id])).digest("hex");
    await postgres.raw(`create table public.rifare_c12_activation_phase(original_id text primary key, claim_xid bigint not null, activation_xid bigint null);
      create function public.c12_remember_claim_xid() returns trigger language plpgsql as $$ begin
        if NEW.original_command_uuid='${commandId}' and OLD.execution_owner_fingerprint is null and NEW.execution_owner_fingerprint is not null then
          insert into public.rifare_c12_activation_phase(original_id,claim_xid) values(NEW.original_command_uuid,txid_current());
        end if; return NEW; end $$;
      create trigger c12_remember_claim after update on public.rifare_operation for each row execute function public.c12_remember_claim_xid()`);
    const installation = await postgres("rifare_operation_privacy_installation").where({ id: journalPrivacyInstallationId(f.merchant) }).first();
    const actionSql = mode === "installation-key" ? `update public.rifare_operation_privacy_installation set key_binding='hmac-sha256:${"d".repeat(64)}' where id='${installation.id}';` :
      mode === "clock-regression" ? "perform 1;" : mode === "owner" ? `update public.auth_identity set app_metadata='{"customer_id":"cus_other"}'::jsonb where id='${f.identity.id}';` :
      mode === "privacy" ? `update public.rifare_operation_privacy_subject set suppressed=true where id='${marker}';` :
        "perform pg_advisory_xact_lock(120,13);";
    await postgres.raw(`create function public.c12_activation_commit() returns trigger language plpgsql as $$
      declare selected text; begin
        if NEW.id='${marker}' then
          update public.rifare_c12_activation_phase set activation_xid=txid_current()
            where original_id='${commandId}' and claim_xid<>txid_current() and activation_xid is null returning original_id into selected;
          if selected is not null then ${actionSql} end if;
        end if; return NEW; end $$;
      create constraint trigger c12_activation_commit after update on public.rifare_operation_privacy_subject
        deferrable initially deferred for each row execute function public.c12_activation_commit()`);
    const controller = new AbortController();
    const blocker = ["abort", "expiry"].includes(mode) ? await postgres.transaction() : undefined;
    let blockerPid: number | undefined;
    if (blocker) {
      blockerPid = (await blocker.raw("select pg_backend_pid() as pid")).rows[0].pid;
      await blocker.raw("select pg_advisory_xact_lock(120,13)");
    }
    // Controlled SQL timestamp fault only: do not alter host/database clocks.
    // The actual delivery SELECT reports one hour earlier only after activation
    // committed; the same unchanged rejection oracle must catch the regression.
    const raw = postgres.raw, rawDescriptor = Object.getOwnPropertyDescriptor(postgres, "raw")!;
    let clockQueries = 0;
    if (mode === "clock-regression") {
      assert.equal(rawDescriptor.configurable, true);
      Object.defineProperty(postgres, "raw", { ...rawDescriptor, value: function(sql: string, ...args: any[]) {
      if (sql.startsWith("with snapshot as")) {
        clockQueries++;
        sql = sql.replace("clock_timestamp() as observed_at", `(case when exists(select 1 from public.rifare_c12_activation_phase
          where original_id='${commandId}' and activation_xid is not null) then pg_catalog.clock_timestamp()-interval '1 hour'
          else pg_catalog.clock_timestamp() end) as observed_at`);
      }
      return raw.call(this, sql, ...args);
    } });
    }
    const action = noEffect(() => journal.claimNativeExecution(commandId, context, verifier, controller.signal));
    action.catch(() => undefined);
    try {
      if (blocker) {
        const deadline = Date.now() + 8000; let waiting = false;
        while (Date.now() < deadline) {
          const rows = (await postgres.raw("select pid from pg_stat_activity where wait_event='advisory' and ? = any(pg_blocking_pids(pid))", [blockerPid!])).rows;
          if (rows.length) { waiting = true; break; }
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        assert.ok(waiting, "Actual activation COMMIT, after first claim COMMIT, must be blocked");
        if (mode === "abort") controller.abort();
        else {
          const remaining = (await other.row()).receipt_expires_at.getTime() - await f.clock();
          if (remaining >= 0) await new Promise(resolve => setTimeout(resolve, remaining + 30));
        }
        await blocker.commit();
      }
      await assert.rejects(action);
      const phase = await postgres("rifare_c12_activation_phase").where({ original_id: commandId }).first();
      assert.ok(phase.activation_xid); assert.notEqual(phase.activation_xid, phase.claim_xid);
      if (mode === "clock-regression") assert.equal(clockQueries, 1, "Only the terminal autocommit SELECT is faulted; the transaction snapshot is untouched");
    } finally {
      if (blocker && !blocker.isCompleted()) await blocker.rollback();
      await action.catch(() => undefined);
      if (mode === "clock-regression") Object.defineProperty(postgres, "raw", rawDescriptor);
      await postgres.raw(`drop trigger c12_activation_commit on public.rifare_operation_privacy_subject;
        drop function public.c12_activation_commit(); drop trigger c12_remember_claim on public.rifare_operation;
        drop function public.c12_remember_claim_xid(); drop table public.rifare_c12_activation_phase`);
      if (mode === "installation-key") await postgres("rifare_operation_privacy_installation")
        .where({ id: installation.id }).update({ key_binding: installation.key_binding });
      if (mode === "owner") await postgres("auth_identity").where({ id: f.identity.id }).update({ app_metadata: { customer_id: f.customer.id } });
      if (mode === "privacy") await postgres("rifare_operation_privacy_subject").where({ id: marker }).update({ suppressed: false });
    }
    await requireRetiredCredential(other);
  });
  await check("C12-CLAIM-PRIVACY hold erasure revokes generation and minimization retains refusal identity", async () => {
    const first = await sample.row();
    assert.equal(await journal.setPrivacyHold(f.customer.id, first.id, first.revision, true, f.privacyActor), true);
    await journal.erasePrivacySubject(f.customer.id, f.privacyActor);
    const held = await sample.row(); assert.equal(held.state, "retired"); assert.equal(held.execution_generation, 2);
    assert.ok(held.execution_revoked_at instanceof Date); assert.equal(held.execution_owner_fingerprint, first.execution_owner_fingerprint);
    assert.ok(held.execution_claimed_at instanceof Date);
    const exported = await journal.exportPrivacySubject(f.customer.id, f.privacyActor);
    assert.ok(exported.some((row: any) => row.id === first.id && row.execution_owner_fingerprint === first.execution_owner_fingerprint));
    assert.equal(await journal.setPrivacyHold(f.customer.id, held.id, held.revision, false, f.privacyActor), true);
    const minimized = await sample.row();
    for (const field of ["execution_claimed_at", "execution_expires_at", "execution_order_id"]) assert.equal(minimized[field], null);
    for (const field of ["execution_owner_fingerprint", "execution_seal_fingerprint", "execution_payment_handle_fingerprint"])
      assert.equal(minimized[field], first[field]);
    assert.equal(minimized.execution_generation, 2);
    const count = await roleCount(); await assert.rejects(journal.claimNativeExecution(id, context, verifier)); assert.equal(await roleCount(), count);
  });
  f.requestVerifier.close(); verifier.close();
  console.log("C12_NATIVE_EXECUTION_CLAIM_RESULT=" + JSON.stringify({ result: "pass", checks,
    dispatch_implemented: false, native_early_write_fencing_qualified: false, full_C12_qualified: false,
    connected_authority_qualified: false, production_qualified: false }));
}
