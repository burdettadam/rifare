import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { operationJournalModule } from "../modules/operation-journal";
import type OperationJournalService from "../modules/operation-journal/service";
import { parseOriginalCommand } from "../modules/operation-journal/command";
import { minorUnits } from "../cart-context/observation";
import { readLockedNativePayment } from "../modules/operation-journal/payment-context";
import { bytes } from "./native-receipt-fixture";
import { createHash, randomUUID } from "node:crypto";
import type { ExecArgs } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import { nativePaymentFixture } from "./native-payment-fixture";

/** Actual native PostgreSQL pending-payment identity. No payment execution,
 * external provider status or connected authority qualification is represented. */
export default async function verifyPaymentAssociation({ container }: ExecArgs) {
  if (process.env.NODE_ENV !== "test" || process.env.RIFARE_COMMERCE_VERIFY !== "disposable") throw new Error("RIFARE_DISPOSABLE_PAYMENT_ASSOCIATION_REQUIRED");
  if (process.env.RIFARE_C10_COMPILED === "true") assert.ok(__filename.endsWith(".js"));
  if (process.env.RIFARE_C10_WORKER) {
    const task = JSON.parse(process.env.RIFARE_C10_WORKER), journal = container.resolve<OperationJournalService>(operationJournalModule);
    const verifier = await journal.createAuthorityReceiptVerifier(bytes(task.trust));
    const result = task.mode === "recover" ? await journal.recoverAuthorityPayment(task.command_id, task.context, verifier) :
      await journal.associateAuthorityPayment(task.command_id, task.context, verifier);
    verifier.close(); if (task.mode === "associate-lose-ack") process.exit(79);
    console.log("C10_RECOVERED=" + JSON.stringify(result)); return;
  }
  const f = await nativePaymentFixture(container), { journal, context, verifier, postgres } = f;
  const payments = container.resolve(Modules.PAYMENT), checks: string[] = [];
  const check = async (name: string, run: () => unknown) => { await run(); checks.push(name); console.log("PAYMENT_ASSOCIATION_CHECK " + name); };
  const snapshot = async () => {
    const values: Record<string, unknown> = {};
    for (const table of ["cart", "cart_line_item", "payment_collection", "payment_session", "payment", "capture", "refund", "order", "reservation_item"]) {
      values[table] = await postgres(table).orderBy("id").select("*");
    }
    return createHash("sha256").update(JSON.stringify(values)).digest("hex");
  };
  const noEffects = async <T>(run: () => Promise<T>) => {
    const before = await snapshot(), calls: string[] = [], originals = new Map<string, any>();
    for (const name of ["authorizePaymentSession", "capturePayment", "cancelPayment", "refundPayment"]) {
      assert.equal(typeof payments[name], "function"); originals.set(name, payments[name]);
      const spy = async () => { calls.push(name); throw new Error("C10_UNEXPECTED_PAYMENT_ACTION"); };
      payments[name] = spy; assert.equal(payments[name], spy, "counter must instrument the actual native entry point");
    }
    try { return await run(); }
    finally {
      for (const [name, original] of originals) payments[name] = original;
      assert.deepEqual(calls, [], "association cannot call payment actions");
      assert.equal(await snapshot(), before, "native commerce/payment outcome records must stay byte-identical");
    }
  };
  const runWorker = (task: unknown) => new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["run.mjs", "exec", __filename], { cwd: process.cwd(), env: { ...process.env,
      RIFARE_C10_WORKER: JSON.stringify(task) }, stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; const timer = setTimeout(() => { child.kill(); reject(new Error("C10 child deadline")); }, 45000);
    for (const stream of [child.stdout, child.stderr]) stream.on("data", data => { output = (output + data).slice(-16000); });
    child.once("error", error => { clearTimeout(timer); reject(error); }); child.once("exit", code => { clearTimeout(timer); resolve({ code, output }); });
  });
  const original = await f.makePaymentOriginal(), id = original.command.command_id;
  await check("C10-FIRST actual C9/C8 original captures exact native identity and no authority", async () => {
    assert.equal(original.command.payable_minor_units, "1250"); assert.equal(original.command.currency, "usd");
    const result = await noEffects(() => journal.associateAuthorityPayment(id, context, verifier));
    assert.equal(result.payment_collection_id, original.collection.id); assert.equal(result.payment_session_id, original.session.id);
    assert.equal(result.payment_provider_id, "pp_system_default"); assert.equal(result.execution_authorized, false);
    assert.equal(result.live_provider_status_verified, false); assert.equal(result.evidence_status, "native_pending_payment_observation");
    const row = await original.row(); assert.equal(row.payment_context_digest, result.payment_context_digest);
    assert.match(row.payment_fingerprint, /^sha256:[0-9a-f]{64}$/); assert.ok(row.payment_observed_at); assert.equal(row.state, "awaiting_authority");
  });
  await check("C10-MONEY independent raw collection/session amount currency and fractional-minor refusals", async () => {
    for (const table of ["payment_collection", "payment_session"]) {
      const key = table === "payment_collection" ? original.collection.id : original.session.id;
      const previous = await postgres(table).where({ id: key }).first();
      for (const raw of ["12.49", "12.501", "-12.5", "92233720368547758.08", "1e100"]) {
        await postgres(table).where({ id: key }).update({ raw_amount: { value: raw, precision: 20 } });
        try { await noEffects(() => assert.rejects(journal.associateAuthorityPayment(id, context, verifier))); }
        finally { await postgres(table).where({ id: key }).update({ raw_amount: previous.raw_amount }); }
      }
      await postgres(table).where({ id: key }).update({ currency_code: "eur" });
      try { await noEffects(() => assert.rejects(journal.associateAuthorityPayment(id, context, verifier))); }
      finally { await postgres(table).where({ id: key }).update({ currency_code: previous.currency_code }); }
    }
  });
  await check("C10-DECIMAL selector preserves supported currency exponents and int64 bounds", async () => {
    // Component money/selection checks, not authenticated end-to-end foreign-
    // currency qualification. The full owner still rejects against the USD original.
    // Pinned Medusa has no four-decimal currency. Its command parser must
    // refuse unsupported CLF; only the existing decimal primitive is exercised at 4.
    assert.throws(() => parseOriginalCommand(bytes({ ...original.command, currency: "clf", currency_exponent: 4, payable_minor_units: "12345" })));
    assert.equal(minorUnits({ value: "1.2345", precision: 20 }, 4), "12345");
    assert.throws(() => minorUnits({ value: "1.23451", precision: 20 }, 4));
    const row = await original.row(), nativeCart = await postgres("cart").where({ id: original.cart.id }).first();
    const collection = await postgres("payment_collection").where({ id: original.collection.id }).first();
    const session = await postgres("payment_session").where({ id: original.session.id }).first();
    const binding = { ...f.merchant, region_id: nativeCart.region_id, final_command_uuid: row.final_command_uuid,
      final_response_digest: row.final_response_digest, receipt_digest: row.receipt_digest, receipt_context_digest: row.receipt_context_digest, receipt_id: row.receipt_id };
    try {
      for (const [currency, exponent, raw, minor, accepted] of [
        ["jpy", 0, "1234", "1234", true], ["jpy", 0, "1234.1", "1234", false],
        ["kwd", 3, "1.234", "1234", true], ["kwd", 3, "1.2341", "1234", false],
        ["usd", 2, "92233720368547758.07", "9223372036854775807", true],
        ["usd", 2, "92233720368547758.08", "9223372036854775807", false],
      ] as const) {
        for (const [table, key] of [["payment_collection", collection.id], ["payment_session", session.id]]) await postgres(table).where({ id: key })
          .update({ currency_code: currency, raw_amount: { value: raw, precision: 20 } });
        const input = parseOriginalCommand(bytes({ ...original.command, currency, currency_exponent: exponent, payable_minor_units: minor }));
        const select = async (): Promise<Awaited<ReturnType<typeof readLockedNativePayment>>> =>
          postgres.transaction(tx => readLockedNativePayment(tx, input, binding), { isolationLevel: "serializable" });
        if (accepted) assert.equal((await noEffects(select)).execution_authorized, false);
        else await noEffects(() => assert.rejects(select()));
      }
      await noEffects(() => assert.rejects(journal.recoverAuthorityPayment(id, context, verifier)));
    } finally {
      await postgres("payment_collection").where({ id: collection.id }).update({ currency_code: collection.currency_code, raw_amount: collection.raw_amount });
      await postgres("payment_session").where({ id: session.id }).update({ currency_code: session.currency_code, raw_amount: session.raw_amount });
    }
  });
  await check("C10-SELECT deleted duplicate shared and dangling native associations are not clean pending evidence", async () => {
    const link = await postgres("cart_payment_collection").where({ cart_id: original.cart.id }).first();
    for (const [table, key] of [["cart_payment_collection", link.id], ["payment_session", original.session.id], ["payment_collection", original.collection.id]]) {
      await postgres(table).where({ id: key }).update({ deleted_at: new Date() });
      try { await noEffects(() => assert.rejects(journal.recoverAuthorityPayment(id, context, verifier))); }
      finally { await postgres(table).where({ id: key }).update({ deleted_at: null }); }
    }
    const otherCart = await f.makeCart(), shared = { ...link, id: "capaycol_" + randomUUID().replaceAll("-", ""), cart_id: otherCart.id };
    await postgres("cart_payment_collection").insert(shared);
    try { await noEffects(() => assert.rejects(journal.recoverAuthorityPayment(id, context, verifier))); }
    finally { await postgres("cart_payment_collection").where({ id: shared.id }).delete(); }
    const dangling = "pay_col_" + randomUUID().replaceAll("-", "");
    await postgres("cart_payment_collection").where({ id: link.id }).update({ payment_collection_id: dangling });
    try { await noEffects(() => assert.rejects(journal.recoverAuthorityPayment(id, context, verifier))); }
    finally { await postgres("cart_payment_collection").where({ id: link.id }).update({ payment_collection_id: original.collection.id }); }
    const duplicate = await payments.createPaymentSession(original.collection.id, { provider_id: "pp_system_default", currency_code: "usd", amount: 12.5, data: {} });
    try { await noEffects(() => assert.rejects(journal.recoverAuthorityPayment(id, context, verifier))); }
    finally { await postgres("payment_session").where({ id: duplicate.id }).delete(); }
  });
  await check("C10-PROVIDER current configured enabled and region eligibility are independent", async () => {
    await postgres("payment_provider").where({ id: "pp_system_default" }).update({ is_enabled: false });
    try { await noEffects(() => assert.rejects(journal.recoverAuthorityPayment(id, context, verifier))); }
    finally { await postgres("payment_provider").where({ id: "pp_system_default" }).update({ is_enabled: true }); }
    const nativeCart = await postgres("cart").where({ id: original.cart.id }).first();
    await postgres("region").where({ id: nativeCart.region_id }).update({ deleted_at: new Date() });
    try { await noEffects(() => assert.rejects(journal.recoverAuthorityPayment(id, context, verifier))); }
    finally { await postgres("region").where({ id: nativeCart.region_id }).update({ deleted_at: null }); }
    const region = await postgres("region_payment_provider").where({ payment_provider_id: "pp_system_default" }).whereNull("deleted_at").first();
    assert.ok(region); await postgres("region_payment_provider").where({ id: region.id }).update({ deleted_at: new Date() });
    try { await noEffects(() => assert.rejects(journal.recoverAuthorityPayment(id, context, verifier))); }
    finally { await postgres("region_payment_provider").where({ id: region.id }).update({ deleted_at: null }); }
    await postgres("payment_session").where({ id: original.session.id }).update({ provider_id: "pp_unconfigured" });
    try { await noEffects(() => assert.rejects(journal.recoverAuthorityPayment(id, context, verifier))); }
    finally { await postgres("payment_session").where({ id: original.session.id }).update({ provider_id: "pp_system_default" }); }
  });
  await check("C10-HISTORY native authorization capture refund completion and replaced session histories refuse", async () => {
    for (const change of [{ status: "authorized" }, { authorized_at: new Date() }]) {
      const before = await postgres("payment_session").where({ id: original.session.id }).first();
      await postgres("payment_session").where({ id: before.id }).update(change);
      try { await noEffects(() => assert.rejects(journal.recoverAuthorityPayment(id, context, verifier))); }
      finally { await postgres("payment_session").where({ id: before.id }).update({ status: before.status, authorized_at: before.authorized_at }); }
    }
    const collection = await postgres("payment_collection").where({ id: original.collection.id }).first();
    for (const change of [{ completed_at: new Date() }, { raw_authorized_amount: { value: "1", precision: 20 } },
      { raw_captured_amount: { value: "1", precision: 20 } }, { raw_refunded_amount: { value: "1", precision: 20 } }]) {
      await postgres("payment_collection").where({ id: collection.id }).update(change);
      try { await noEffects(() => assert.rejects(journal.recoverAuthorityPayment(id, context, verifier))); }
      finally { await postgres("payment_collection").where({ id: collection.id }).update({ completed_at: collection.completed_at,
        raw_authorized_amount: collection.raw_authorized_amount, raw_captured_amount: collection.raw_captured_amount, raw_refunded_amount: collection.raw_refunded_amount }); }
    }
    const replaced = await f.makePaymentOriginal();
    await postgres("payment_session").where({ id: replaced.session.id }).update({ deleted_at: new Date() });
    await payments.createPaymentSession(replaced.collection.id, { provider_id: "pp_system_default", currency_code: "usd", amount: 12.5, data: {} });
    await noEffects(() => assert.rejects(journal.associateAuthorityPayment(replaced.command.command_id, context, verifier)));
    assert.equal((await replaced.row()).payment_context_digest, null);
    const paid = await f.makePaymentOriginal(), payment = await payments.authorizePaymentSession(paid.session.id, {});
    assert.ok(payment, "synthetic System payment must authorize before history refusals are exercised");
    await noEffects(() => assert.rejects(journal.associateAuthorityPayment(paid.command.command_id, context, verifier)));
    // Independent native links cannot conceal an outcome for the selected session.
    const mismatched = await f.makePaymentOriginal(), otherCollection = await f.makePaymentOriginal();
    const foreign = { ...(await postgres("payment").where({ id: payment.id }).first()),
      id: "pay_" + randomUUID().replaceAll("-", ""), payment_session_id: mismatched.session.id,
      payment_collection_id: otherCollection.collection.id, deleted_at: new Date() };
    await postgres("payment").insert(foreign);
    try { await noEffects(() => assert.rejects(journal.associateAuthorityPayment(mismatched.command.command_id, context, verifier))); }
    finally { await postgres("payment").where({ id: foreign.id }).delete(); }
    assert.equal((await mismatched.row()).payment_collection_id, null);
    await payments.capturePayment({ payment_id: payment.id });
    await noEffects(() => assert.rejects(journal.associateAuthorityPayment(paid.command.command_id, context, verifier)));
    await payments.refundPayment({ payment_id: payment.id, amount: 1 });
    await noEffects(() => assert.rejects(journal.associateAuthorityPayment(paid.command.command_id, context, verifier)));
    const priorCollection = await postgres("payment_collection").where({ id: paid.collection.id }).first();
    const priorSession = await postgres("payment_session").where({ id: paid.session.id }).first();
    await postgres("payment_collection").where({ id: paid.collection.id }).update({ status: "not_paid", completed_at: null,
      raw_authorized_amount: { value: "0", precision: 20 }, raw_captured_amount: { value: "0", precision: 20 }, raw_refunded_amount: { value: "0", precision: 20 } });
    await postgres("payment_session").where({ id: paid.session.id }).update({ status: "pending", authorized_at: null });
    await postgres("payment").where({ id: payment.id }).update({ deleted_at: new Date() });
    try { await noEffects(() => assert.rejects(journal.associateAuthorityPayment(paid.command.command_id, context, verifier))); }
    finally {
      await postgres("payment").where({ id: payment.id }).update({ deleted_at: null });
      await postgres("payment_collection").where({ id: paid.collection.id }).update({ status: priorCollection.status, completed_at: priorCollection.completed_at,
        raw_authorized_amount: priorCollection.raw_authorized_amount, raw_captured_amount: priorCollection.raw_captured_amount, raw_refunded_amount: priorCollection.raw_refunded_amount });
      await postgres("payment_session").where({ id: paid.session.id }).update({ status: priorSession.status, authorized_at: priorSession.authorized_at });
    }
    assert.equal((await paid.row()).payment_context_digest, null);
  });
  await check("C10-TOKENS provider opaque data and context never enter retained association or result", async () => {
    const marker = "C10_PROVIDER_TOKEN_MUST_NOT_ESCAPE", row = await original.row();
    await postgres("payment_session").where({ id: original.session.id }).update({ data: { token: marker }, context: { secret: marker, idempotency_key: marker } });
    const result = await noEffects(() => journal.recoverAuthorityPayment(id, context, verifier));
    assert.equal(result.payment_context_digest, row.payment_context_digest); assert.ok(!JSON.stringify(result).includes(marker));
    assert.ok(!JSON.stringify(await original.row()).includes(marker));
  });
  await check("C10-ORIGINAL genuine current C9 and private C8 verifier cannot be substituted", async () => {
    await noEffects(() => assert.rejects(journal.associateAuthorityPayment(id, context, { verified: true })));
    const legacy = await f.makePaymentOriginal({ withFinalization: false });
    await noEffects(() => assert.rejects(journal.associateAuthorityPayment(legacy.command.command_id, context, verifier)));
    const missing = await f.makePaymentOriginal({ retainReceipt: false });
    await noEffects(() => assert.rejects(journal.associateAuthorityPayment(missing.command.command_id, context, verifier)));
    assert.equal((await legacy.row()).payment_context_digest, null); assert.equal((await missing.row()).payment_context_digest, null);
  });
  await check("C10-CURRENT current customer and persisted observation clock cannot be bypassed", async () => {
    const before = await original.row();
    await postgres("auth_identity").where({ id: f.identity.id }).update({ app_metadata: { customer_id: "cus_other" } });
    try { await noEffects(() => assert.rejects(journal.recoverAuthorityPayment(id, context, verifier))); }
    finally { await postgres("auth_identity").where({ id: f.identity.id }).update({ app_metadata: { customer_id: f.customer.id } }); }
    await postgres("rifare_operation").where({ id: before.id }).update({ payment_observed_at: new Date(await f.clock() + 2000) });
    const fresh = await journal.createAuthorityReceiptVerifier(bytes(f.trust));
    try { await noEffects(() => assert.rejects(journal.recoverAuthorityPayment(id, context, fresh))); }
    finally { fresh.close(); await postgres("rifare_operation").where({ id: before.id }).update({ payment_observed_at: before.payment_observed_at }); }
    assert.deepEqual(await original.row(), before);
  });
  await check("C10-IMMUTABLE original association time and session fingerprint survive cancellation", async () => {
    const before = await original.row(), result = await noEffects(() => journal.recoverAuthorityPayment(id, context, verifier));
    assert.equal(result.first_observed_at.getTime(), before.payment_observed_at.getTime()); assert.equal((await original.row()).revision, before.revision);
    await journal.cancel(id, before.revision, context); const retired = await original.row();
    assert.equal(retired.payment_collection_id, null); assert.equal(retired.payment_fingerprint, before.payment_fingerprint);
    const other = await f.makePaymentOriginal({ existingCart: original.cart, reusePayment: true });
    await noEffects(() => assert.rejects(journal.associateAuthorityPayment(other.command.command_id, context, verifier)));
    assert.equal((await other.row()).payment_context_digest, null);
  });
  await check("C10-RACE concurrent exact observations retain one immutable native association", async () => {
    const sample = await f.makePaymentOriginal(), commandId = sample.command.command_id;
    const outcomes = await noEffects(() => Promise.allSettled([1, 2].map(() => journal.associateAuthorityPayment(commandId, context, verifier))));
    assert.ok(outcomes.some(value => value.status === "fulfilled")); const row = await sample.row(); assert.ok(row.payment_context_digest);
    const recovered = await noEffects(() => journal.recoverAuthorityPayment(commandId, context, verifier));
    assert.equal(recovered.first_observed_at.getTime(), row.payment_observed_at.getTime()); assert.equal((await sample.row()).revision, row.revision);
  });
  await check("C10-ROLLBACK deferred COMMIT failure retains no partial native association", async () => {
    const sample = await f.makePaymentOriginal(), commandId = sample.command.command_id, before = await sample.row();
    await postgres.raw(`create function public.c10_fail_commit() returns trigger language plpgsql as $$ begin if new.original_command_uuid='${commandId}' and new.payment_collection_id is not null then raise exception 'C10_TEST_COMMIT_FAILURE'; end if; return new; end $$`);
    await postgres.raw("create constraint trigger c10_commit after update on rifare_operation deferrable initially deferred for each row execute function public.c10_fail_commit()");
    try { await noEffects(() => assert.rejects(journal.associateAuthorityPayment(commandId, context, verifier), /C10_TEST_COMMIT_FAILURE/)); }
    finally { await postgres.raw("drop trigger c10_commit on rifare_operation; drop function public.c10_fail_commit()"); }
    assert.deepEqual(await sample.row(), before);
  });
  await check("C10-RESTART fresh processes retain and recover original identity after acknowledgement loss", async () => {
    const sample = await f.makePaymentOriginal(), task = { trust: f.trust, context, command_id: sample.command.command_id };
    const lost = await noEffects(() => runWorker({ ...task, mode: "associate-lose-ack" })); assert.equal(lost.code, 79, lost.output);
    const before = await sample.row(); assert.equal(before.payment_session_id, sample.session.id);
    const recovered = await noEffects(() => runWorker({ ...task, mode: "recover" })); assert.equal(recovered.code, 0, recovered.output);
    assert.ok(recovered.output.includes(before.payment_context_digest)); assert.ok(recovered.output.includes(before.payment_observed_at.toISOString()));
    assert.deepEqual(await sample.row(), before);
  });
  await check("C10-CLOSE retired receipt trust during actual blocked payment UPDATE rolls back", async () => {
    const sample = await f.makePaymentOriginal(), selected = await journal.createAuthorityReceiptVerifier(bytes(f.trust));
    const before = await sample.row(), blocker = await postgres.transaction();
    await blocker("rifare_operation").where({ id: before.id }).forUpdate().first();
    const rejected = assert.rejects(journal.associateAuthorityPayment(sample.command.command_id, context, selected), /NATIVE_RECEIPT_UNAVAILABLE/);
    try {
      let blocked = false;
      for (let n = 0; n < 100; n++) {
        const result = await postgres.raw("select 1 from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and wait_event_type='Lock' and query like 'update %rifare_operation%payment_collection_id%'");
        if (result.rows.length) { blocked = true; break; } await delay(20);
      }
      assert.ok(blocked, "actual payment association UPDATE must block"); selected.close();
    } finally { await blocker.commit(); }
    await rejected; assert.deepEqual(await sample.row(), before);
  });
  await check("C10-ABORT canceled entry cannot retain a payment association", async () => {
    const sample = await f.makePaymentOriginal(), before = await sample.row(), controller = new AbortController(); controller.abort();
    await noEffects(() => assert.rejects(journal.associateAuthorityPayment(sample.command.command_id, context, verifier, controller.signal)));
    assert.deepEqual(await sample.row(), before);
  });
  await check("C10-COMMIT-EXPIRY late COMMIT keeps history without returning a current association", async () => {
    const sample = await f.makePaymentOriginal({ receiptLifetime: 3000 }), commandId = sample.command.command_id;
    assert.ok((await sample.row()).receipt_expires_at.getTime() - await f.clock() > 1000, "receipt must be current before injecting COMMIT delay");
    await postgres.raw(`create function public.c10_delay_commit() returns trigger language plpgsql as $$ begin if new.original_command_uuid='${commandId}' and new.payment_collection_id is not null then perform pg_sleep(3.4); end if; return new; end $$`);
    await postgres.raw("create constraint trigger c10_delay after update on rifare_operation deferrable initially deferred for each row execute function public.c10_delay_commit()");
    try { await noEffects(() => assert.rejects(journal.associateAuthorityPayment(commandId, context, verifier))); }
    finally { await postgres.raw("drop trigger c10_delay on rifare_operation; drop function public.c10_delay_commit()"); }
    const before = await sample.row(); assert.equal(before.payment_session_id, sample.session.id);
    await assert.rejects(journal.recoverAuthorityPayment(commandId, context, verifier)); assert.deepEqual(await sample.row(), before);
  });
  await check("C10-COMMIT-OWNER ownership withdrawn at COMMIT prevents returning current evidence", async () => {
    const sample = await f.makePaymentOriginal(), commandId = sample.command.command_id;
    await postgres.raw(`create function public.c10_owner_commit() returns trigger language plpgsql as $$ begin if new.original_command_uuid='${commandId}' and new.payment_collection_id is not null then update auth_identity set app_metadata='{"customer_id":"cus_other"}'::jsonb where id='${f.identity.id}'; end if; return new; end $$`);
    await postgres.raw("create constraint trigger c10_owner after update on rifare_operation deferrable initially deferred for each row execute function public.c10_owner_commit()");
    try { await noEffects(() => assert.rejects(journal.associateAuthorityPayment(commandId, context, verifier))); }
    finally { await postgres.raw("drop trigger c10_owner on rifare_operation; drop function public.c10_owner_commit()");
      await postgres("auth_identity").where({ id: f.identity.id }).update({ app_metadata: { customer_id: f.customer.id } }); }
    const before = await sample.row(); assert.equal(before.payment_session_id, sample.session.id);
    const recovered = await noEffects(() => journal.recoverAuthorityPayment(commandId, context, verifier));
    assert.equal(recovered.first_observed_at.getTime(), before.payment_observed_at.getTime()); assert.deepEqual(await sample.row(), before);
  });
  await check("C10-PRIVACY hold export minimization and six-field refusal continuity cover association", async () => {
    const sample = await f.makePaymentOriginal(), commandId = sample.command.command_id;
    await journal.associateAuthorityPayment(commandId, context, verifier);
    const row = await sample.row(), exported = await journal.exportPrivacySubject(f.customer.id, f.privacyActor);
    const entry = exported.find(value => value.id === row.id)!; assert.equal(entry.payment_session_id, sample.session.id);
    assert.equal(await journal.setPrivacyHold(f.customer.id, row.id, row.revision, true, f.privacyActor), true);
    await journal.erasePrivacySubject(f.customer.id, f.privacyActor); const held = await sample.row();
    assert.equal(held.state, "retired"); assert.equal(held.payment_context_digest, row.payment_context_digest);
    await assert.rejects(journal.recoverAuthorityPayment(commandId, context, verifier));
    assert.equal(await journal.setPrivacyHold(f.customer.id, held.id, held.revision, false, f.privacyActor), true);
    const minimized = await sample.row();
    for (const name of ["payment_collection_id", "payment_session_id", "payment_provider_id", "payment_context_digest", "payment_observed_at"]) assert.equal(minimized[name], null, name);
    assert.equal(minimized.payment_fingerprint, row.payment_fingerprint);
    const refusal = { id: row.id, original_command_uuid: commandId, challenge_fingerprint: row.challenge_fingerprint,
      receipt_fingerprint: row.receipt_fingerprint, final_command_uuid: row.final_command_uuid, payment_fingerprint: row.payment_fingerprint };
    await journal.restorePrivacyRefusals([refusal], f.privacyActor);
    const { payment_fingerprint: _missing, ...legacy } = refusal; await assert.rejects(journal.restorePrivacyRefusals([legacy], f.privacyActor));
    await assert.rejects(journal.restorePrivacyRefusals([{ ...refusal, payment_fingerprint: "sha256:" + "0".repeat(64) }], f.privacyActor));
  });
  f.requestVerifier.close(); verifier.close();
  console.log("RIFARE_PAYMENT_ASSOCIATION_RESULT=" + JSON.stringify({ result: "pass", checks: checks.length,
    source: "native-postgresql-synthetic-signatures-and-local-system-provider", execution_authorized: false, live_provider_status_verified: false }));
}
