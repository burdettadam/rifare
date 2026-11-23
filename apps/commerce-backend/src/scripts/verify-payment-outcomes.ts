import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import type { ExecArgs } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import { beginClaimOrderWorkflow, cancelBeginOrderClaimWorkflow, capturePaymentWorkflow,
  completeCartWorkflow, refundPaymentWorkflow } from "@medusajs/medusa/core-flows";
import { nativePaymentFixture } from "./native-payment-fixture";
import { operationJournalModule } from "../modules/operation-journal";
import type OperationJournalService from "../modules/operation-journal/service";

/** Native historical observations only; trusted setup actions are kept outside observations. */
export default async function verifyPaymentOutcomes({ container }: ExecArgs) {
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.RIFARE_COMMERCE_VERIFY, "disposable");
  if (process.env.RIFARE_C11_COMPILED === "true") assert.ok(__filename.endsWith(".js"));
  if (process.env.RIFARE_C11_WORKER) {
    const task = JSON.parse(process.env.RIFARE_C11_WORKER);
    const selected = container.resolve<OperationJournalService>(operationJournalModule);
    const paymentService: any = container.resolve(Modules.PAYMENT);
    for (const name of ["authorizePaymentSession", "capturePayment", "cancelPayment", "refundPayment"])
      paymentService[name] = async () => { throw new Error("C11_WORKER_UNEXPECTED_NATIVE_ACTION"); };
    for (const name of ["authorizePayment", "capturePayment", "cancelPayment", "refundPayment", "getStatus"])
      paymentService.paymentProviderService_[name] = async () => { throw new Error("C11_WORKER_UNEXPECTED_PROVIDER_ACTION"); };
    const recovered = await selected.recoverNativePaymentOutcome(task.command_id, task.context);
    if (task.mode === "lose-ack") process.exit(79);
    console.log("C11_RECOVERED=" + JSON.stringify(recovered)); return;
  }
  const f = await nativePaymentFixture(container), { journal, postgres, context, verifier } = f;
  const payments = container.resolve(Modules.PAYMENT), carts = container.resolve(Modules.CART);
  const checks: string[] = [];
  const check = async (name: string, run: () => Promise<void>) => { await run(); checks.push(name); console.log("PAYMENT_OUTCOME_CHECK " + name); };
  const observe = (id: string, selected = context, signal?: AbortSignal): Promise<any> =>
    journal.recoverNativePaymentOutcome(id, selected, signal);
  const nativeSnapshot = async () => {
    const value: Record<string, unknown> = {};
    for (const table of ["cart", "cart_line_item", "payment_collection", "payment_session", "payment", "capture", "refund",
      "order", "order_item", "order_line_item", "order_cart", "order_payment_collection", "order_transaction", "order_credit_line",
      "order_summary", "reservation_item", "inventory_level"]) value[table] = await postgres(table).orderBy("id");
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
  };
  const noEffects = async <T>(action: () => Promise<T>) => {
    const before = await nativeSnapshot(), calls: string[] = [], original = new Map<string, any>();
    for (const name of ["authorizePaymentSession", "capturePayment", "cancelPayment", "refundPayment"]) {
      original.set(name, (payments as any)[name]);
      (payments as any)[name] = async () => { calls.push(name); throw new Error("C11_UNEXPECTED_NATIVE_PAYMENT_CALL"); };
    }
    const provider = (payments as any).paymentProviderService_, providerMethods = new Map<string, any>();
    for (const name of ["authorizePayment", "capturePayment", "cancelPayment", "refundPayment", "getStatus"]) {
      assert.equal(typeof provider[name], "function"); providerMethods.set(name, provider[name]);
      provider[name] = async () => { calls.push("provider." + name); throw new Error("C11_UNEXPECTED_PROVIDER_CALL"); };
    }
    try { return await action(); } finally {
      for (const [name, fn] of original) (payments as any)[name] = fn;
      for (const [name, fn] of providerMethods) provider[name] = fn;
      assert.deepEqual(calls, []); assert.equal(await nativeSnapshot(), before, "Observation changed native commerce/financial rows");
    }
  };
  const makeAssociated = async (receiptLifetime = 60000) => {
    const cart = await f.makeCart();
    for (const item of await carts.listLineItems({ cart_id: cart.id })) await carts.updateLineItems(item.id, { requires_shipping: false });
    const original = await f.makePaymentOriginal({ existingCart: cart, receiptLifetime });
    await journal.associateAuthorityPayment(original.command.command_id, context, verifier);
    return original;
  };
  const runWorker = (task: unknown) => new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["run.mjs", "exec", __filename], { cwd: process.cwd(), env: { ...process.env,
      RIFARE_C11_WORKER: JSON.stringify(task) }, stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; const timer = setTimeout(() => { child.kill(); reject(new Error("C11 child deadline")); }, 45000);
    for (const stream of [child.stdout, child.stderr]) stream.on("data", data => { output = (output + data).slice(-20000); });
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", code => { clearTimeout(timer); resolve({ code, output }); });
  });
  const changed = async (table: string, key: string, values: Record<string, unknown>, action: () => Promise<void>) => {
    const before = await postgres(table).where({ id: key }).first(); assert.ok(before);
    await postgres(table).where({ id: key }).update(values);
    try { await action(); } finally {
      await postgres(table).where({ id: values.id ?? key }).update(Object.fromEntries(Object.keys(values).map(name => [name, before[name]])));
    }
  };
  const waitForLock = async (needle: string) => {
    for (let n = 0; n < 150; n++) {
      const result = await postgres.raw("select 1 from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and wait_event_type='Lock' and query like ?", ["%" + needle + "%"]);
      if (result.rows.length) return; await delay(20);
    }
    assert.fail("required real PostgreSQL lock wait not observed: " + needle);
  };
  try {
    const original = await makeAssociated(), id = original.command.command_id;
    if (process.env.RIFARE_C11_BASELINE === "pending-recovery") {
      const native = await payments.authorizePaymentSession(original.session.id, {}); assert.ok(native?.id);
      console.log("C11_BASELINE_NATIVE_AUTHORIZATION=" + JSON.stringify({ original_command_id: id,
        payment_collection_id: original.collection.id, payment_session_id: original.session.id, payment_id: native.id }));
      // Deliberate baseline witness: old pending-only recovery cannot recover this
      // genuine native authorization. This mode is never a passing qualification.
      const prior: any = await journal.recoverAuthorityPayment(id, context, verifier);
      assert.equal(prior.native_payment.id, native.id); throw new Error("C11_BASELINE_UNEXPECTEDLY_RECOVERED_HISTORY");
    }
    await check("C11-PENDING native absence remains unresolved and binds no payment", async () => {
      const result = await noEffects(() => observe(id));
      assert.equal(result.native_payment, null); assert.equal(result.first_payment_observed_at, null);
      assert.equal(result.absence_of_remote_effect_proven, false); assert.equal(result.execution_authorized, false);
      assert.equal((await original.row()).native_payment_id, null);
    });
    const native = await payments.authorizePaymentSession(original.session.id, {}); assert.ok(native?.id);
    let first: any;
    await check("C11-AUTH original native payment identity is retained once without authority", async () => {
      first = await noEffects(() => observe(id));
      assert.equal(first.profile, "urn:rifare:native-original-payment-observation:v1");
      assert.equal(first.native_payment.id, native.id); assert.equal(first.native_payment.amount_minor_units, "1250");
      assert.equal(first.payment_session_id, original.session.id); assert.equal(first.payment_collection_id, original.collection.id);
      assert.equal(first.live_provider_status_verified, false); assert.equal(first.external_settlement_verified, false);
      assert.equal(first.execution_authorized, false); assert.equal(first.absence_of_remote_effect_proven, false);
      const row = await original.row(); assert.equal(row.native_payment_id, native.id);
      assert.match(row.native_payment_fingerprint, /^sha256:[0-9a-f]{64}$/);
      assert.equal(row.native_payment_observed_at.getTime(), first.first_payment_observed_at.getTime());
      const again = await noEffects(() => observe(id));
      assert.equal(again.observation_digest, first.observation_digest);
      assert.equal(again.first_payment_observed_at.getTime(), first.first_payment_observed_at.getTime());
      await assert.rejects(journal.recoverAuthorityPayment(id, context, verifier));
    });
    await payments.capturePayment({ payment_id: native.id, amount: 5 });
    await check("C11-PARTIAL native capture amounts come from actual records", async () => {
      const result = await noEffects(() => observe(id));
      assert.equal(result.native_payment.id, native.id); assert.equal(result.captures.length, 1);
      assert.equal(result.captures[0].amount_minor_units, "500");
      assert.equal(result.totals.live_capture_minor_units, "500");
      assert.equal(result.collection.captured_minor_units, "500");
      assert.equal(result.consistency.collection_capture_matches_rows, true);
      assert.notEqual(result.observation_digest, first.observation_digest);
    });
    await payments.capturePayment({ payment_id: native.id, amount: 7.5 });
    await payments.refundPayment({ payment_id: native.id, amount: 1, idempotency_key: "c11-direct-" + id });
    await check("C11-REFUND original identity survives full capture and native refund", async () => {
      const result = await noEffects(() => observe(id));
      assert.equal(result.native_payment.id, native.id); assert.equal(result.captures.length, 2);
      assert.equal(result.totals.live_capture_minor_units, "1250"); assert.equal(result.refunds.length, 1);
      assert.equal(result.refunds[0].amount_minor_units, "100"); assert.equal(result.refunds[0].status, "succeeded");
      assert.equal(result.collection.refunded_minor_units, "100");
      assert.equal(result.consistency.collection_refund_matches_rows, true); assert.equal(result.order, null);
    });
    const expired = await makeAssociated(3000), expiredId = expired.command.command_id;
    const expiredNative = await payments.authorizePaymentSession(expired.session.id, {});
    const line = (await carts.listLineItems({ cart_id: expired.cart.id }))[0];
    await carts.updateLineItems(line.id, { quantity: 2 });
    const expiry = (await expired.row()).receipt_expires_at.getTime();
    const expiryDeadline = performance.now() + 10000;
    while (await f.clock() < expiry && performance.now() < expiryDeadline) await delay(50);
    await check("C11-HISTORICAL expired receipt and changed cart do not manufacture fresh authority", async () => {
      assert.ok(await f.clock() >= expiry);
      const result = await noEffects(() => observe(expiredId));
      assert.equal(result.native_payment.id, expiredNative!.id); assert.equal(result.native_payment.amount_minor_units, "1250");
      assert.equal(result.execution_authorized, false);
      await assert.rejects(journal.recoverAuthorityPayment(expiredId, context, verifier));
    });
    const ordered = await makeAssociated(), orderedId = ordered.command.command_id;
    const orderedNative = await payments.authorizePaymentSession(ordered.session.id, {}); assert.ok(orderedNative);
    await noEffects(() => observe(orderedId));
    const { result: order } = await completeCartWorkflow(container).run({ input: { id: ordered.cart.id } });
    await capturePaymentWorkflow(container).run({ input: { payment_id: orderedNative.id } });
    await check("C11-ORDER completed original cart and collection identify one paid order", async () => {
      const result = await noEffects(() => observe(orderedId));
      assert.equal(result.order.id, order.id); assert.equal(result.native_payment.id, orderedNative.id);
      assert.equal(result.order.summary.paid_minor_units, "1250");
    });
    const { result: draft } = await beginClaimOrderWorkflow(container).run({ input: { order_id: order.id, type: "refund" } });
    const refundInput = { payment_id: orderedNative.id, amount: 1, idempotency_key: "c11-order-" + orderedId };
    await assert.rejects(refundPaymentWorkflow(container).run({ input: refundInput }));
    await check("C11-BOOKKEEPING native refund success remains distinct from failed order bookkeeping", async () => {
      const result = await noEffects(() => observe(orderedId));
      assert.equal(result.refunds.length, 1); assert.equal(result.refunds[0].status, "succeeded");
      assert.equal(result.refunds[0].amount_minor_units, "100"); assert.equal(result.order.summary.refunded_minor_units, "0");
      assert.equal(result.consistency.order_refund_transactions_complete, false);
      assert.equal(result.external_settlement_verified, false);
    });
    await cancelBeginOrderClaimWorkflow(container).run({ input: { claim_id: draft.claim_id! } });
    await refundPaymentWorkflow(container).run({ input: refundInput });
    await check("C11-REPAIRED separate native setup changes bookkeeping without replacing original refund", async () => {
      const result = await noEffects(() => observe(orderedId));
      assert.equal(result.refunds.length, 1); assert.equal(result.order.summary.refunded_minor_units, "100");
      assert.equal(result.consistency.order_refund_transactions_complete, true);
    });
    await check("C11-CANCEL genuine native cancellation retains the original payment", async () => {
      const sample = await makeAssociated(), payment = await payments.authorizePaymentSession(sample.session.id, {}); assert.ok(payment);
      const before = await noEffects(() => observe(sample.command.command_id));
      await payments.cancelPayment(payment.id);
      const result = await noEffects(() => observe(sample.command.command_id));
      assert.equal(result.native_payment.id, payment.id); assert.ok(result.native_payment.canceled_at);
      assert.equal(result.first_payment_observed_at.getTime(), before.first_payment_observed_at.getTime());
      assert.equal(result.absence_of_remote_effect_proven, false);
    });
    await check("C11-MONEY original raw principal currency and provider must agree at every native layer", async () => {
      for (const [table, key] of [["payment_collection", original.collection.id], ["payment_session", original.session.id], ["payment", native.id]]) {
        for (const raw of ["12.49", "12.501", "-12.5", "92233720368547758.08", "1e100"])
          await changed(table, key, { raw_amount: { value: raw, precision: 20 } }, () => noEffects(() => assert.rejects(observe(id))));
        await changed(table, key, { currency_code: "eur" }, () => noEffects(() => assert.rejects(observe(id))));
        if (table !== "payment_collection") await changed(table, key, { provider_id: "pp_unconfigured" }, () => noEffects(() => assert.rejects(observe(id))));
      }
      assert.equal((await noEffects(() => observe(id))).native_payment.id, native.id);
    });
    await check("C11-SESSION original payment cannot migrate to another native session", async () => {
      const donor = await makeAssociated();
      await changed("payment", native.id, { payment_session_id: donor.session.id }, () => noEffects(() => assert.rejects(observe(id))));
      await changed("payment", native.id, { payment_collection_id: donor.collection.id }, () => noEffects(() => assert.rejects(observe(id))));
    });
    await check("C11-HISTORY missing replaced deleted and extra native identities never choose a convenient row", async () => {
      const sample = await makeAssociated(), payment = await payments.authorizePaymentSession(sample.session.id, {}); assert.ok(payment);
      const commandId = sample.command.command_id; await noEffects(() => observe(commandId));
      await changed("payment", payment.id, { deleted_at: new Date() }, () => noEffects(() => assert.rejects(observe(commandId))));
      await changed("payment", payment.id, { id: "pay_" + randomUUID().replaceAll("-", "") }, () => noEffects(() => assert.rejects(observe(commandId))));
      const donor = await makeAssociated();
      await changed("payment", payment.id, { payment_collection_id: donor.collection.id, payment_session_id: donor.session.id },
        () => noEffects(() => assert.rejects(observe(commandId))));
      const prior = await postgres("payment").where({ id: payment.id }).first();
      const extra = { ...prior, id: "pay_" + randomUUID().replaceAll("-", ""), payment_session_id: donor.session.id, deleted_at: new Date() };
      await postgres("payment").insert(extra);
      try { await noEffects(() => assert.rejects(observe(commandId))); }
      finally { await postgres("payment").where({ id: extra.id }).delete(); }
      const link = await postgres("cart_payment_collection").where({ cart_id: sample.cart.id }).first();
      await changed("cart_payment_collection", link.id, { deleted_at: new Date() }, () => noEffects(() => assert.rejects(observe(commandId))));
      const alias = { ...link, id: "capaycol_" + randomUUID().replaceAll("-", ""), cart_id: donor.cart.id, deleted_at: new Date() };
      await postgres("cart_payment_collection").insert(alias);
      try { await noEffects(() => assert.rejects(observe(commandId))); }
      finally { await postgres("cart_payment_collection").where({ id: alias.id }).delete(); }
      assert.equal((await noEffects(() => observe(commandId))).native_payment.id, payment.id);
    });
    await check("C11-RETIRED eligibility retirement does not erase historical access", async () => {
      await changed("payment_provider", "pp_system_default", { is_enabled: false }, async () => {
        assert.equal((await noEffects(() => observe(id))).native_payment.id, native.id);
      });
      const cart = await postgres("cart").where({ id: original.cart.id }).first();
      await changed("region", cart.region_id, { deleted_at: new Date() }, async () => {
        assert.equal((await noEffects(() => observe(id))).native_payment.id, native.id);
      });
    });
    await check("C11-ABSENT-AGGREGATE absent native totals are distinct from recorded zero", async () => {
      await changed("payment_collection", original.collection.id, { raw_authorized_amount: null, raw_captured_amount: null, raw_refunded_amount: null }, async () => {
        const result = await noEffects(() => observe(id));
        assert.equal(result.collection.authorized_minor_units, null); assert.equal(result.collection.captured_minor_units, null);
        assert.equal(result.collection.refunded_minor_units, null); assert.equal(result.consistency.collection_capture_matches_rows, null);
        assert.equal(result.consistency.collection_refund_matches_rows, null); assert.equal(result.totals.live_capture_minor_units, "1250");
      });
    });
    await check("C11-CURRENT historical evidence cannot bypass current access clock or abort", async () => {
      await noEffects(() => assert.rejects(observe(id, { ...context, salesChannelIds: [] })));
      await changed("auth_identity", f.identity.id, { app_metadata: { customer_id: "cus_other" } }, () => noEffects(() => assert.rejects(observe(id))));
      await changed("cart", original.cart.id, { customer_id: null }, () => noEffects(() => assert.rejects(observe(id))));
      const row = await original.row();
      await changed("rifare_operation", row.id, { native_payment_observed_at: new Date(await f.clock() + 60000) },
        () => noEffects(() => assert.rejects(observe(id))));
      const controller = new AbortController(); controller.abort();
      await noEffects(() => assert.rejects(observe(id, context, controller.signal)));
      assert.deepEqual(await original.row(), row);
    });
    await check("C11-ORDER-IDENTITY original order requires both original links and current customer", async () => {
      const link = await postgres("order_payment_collection").where({ payment_collection_id: ordered.collection.id }).first();
      await changed("order_payment_collection", link.id, { order_id: "order_other" }, () => noEffects(() => assert.rejects(observe(orderedId))));
      await changed("order", order.id, { customer_id: null }, () => noEffects(() => assert.rejects(observe(orderedId))));
    });
    await check("C11-TOKENS provider data context metadata and notes are excluded", async () => {
      const marker = "C11_PRIVATE_PAYLOAD_MUST_NOT_ESCAPE";
      await changed("payment_session", original.session.id, { data: { token: marker }, context: { idempotency_key: marker } }, async () => {
        await changed("payment", native.id, { data: { token: marker }, metadata: { secret: marker } }, async () => {
          assert.ok(!JSON.stringify(await noEffects(() => observe(id))).includes(marker));
          assert.ok(!JSON.stringify(await original.row()).includes(marker));
        });
      });
    });
    await check("C11-DELETED-ROWS native record deletion is visible and bounded history never truncates", async () => {
      const capture = await postgres("capture").where({ payment_id: native.id }).orderBy("id").first();
      const refund = await postgres("refund").where({ payment_id: native.id }).first();
      for (const [table, record] of [["capture", capture], ["refund", refund]] as const) {
        await changed(table, record.id, { deleted_at: new Date() }, async () => {
          const result = await noEffects(() => observe(id));
          assert.equal(result[table === "capture" ? "captures" : "refunds"].find((row: any) => row.id === record.id).deleted, true);
          assert.equal(result.consistency[table === "capture" ? "collection_capture_matches_rows" : "collection_refund_matches_rows"], false);
        });
      }
      const extra = Array.from({ length: 100 }, () => ({ ...capture, id: "capt_" + randomUUID().replaceAll("-", ""), deleted_at: new Date() }));
      await postgres("capture").insert(extra);
      try { await noEffects(() => assert.rejects(observe(id))); }
      finally { await postgres("capture").whereIn("id", extra.map(row => row.id)).delete(); }
    });
    await check("C11-WAIT-ABORT actual blocked first binding rolls back on cancellation", async () => {
      const sample = await makeAssociated(); await payments.authorizePaymentSession(sample.session.id, {});
      const before = await sample.row(), blocker = await postgres.transaction(), controller = new AbortController();
      await blocker("rifare_operation").where({ id: before.id }).forUpdate().first();
      const action = noEffects(() => assert.rejects(observe(sample.command.command_id, context, controller.signal)));
      try { await waitForLock('update "rifare_operation"'); controller.abort(); }
      finally { await blocker.commit(); }
      await action; assert.deepEqual(await sample.row(), before);
    });
    await check("C11-CONTEXT actor and channels are copied before actual lock waits", async () => {
      const sample = await makeAssociated(); const payment = await payments.authorizePaymentSession(sample.session.id, {}); assert.ok(payment);
      const before = await sample.row(), blocker = await postgres.transaction();
      await blocker("rifare_operation").where({ id: before.id }).forUpdate().first();
      const supplied = { actor: { ...context.actor }, salesChannelIds: [...context.salesChannelIds] };
      const action = noEffects(() => observe(sample.command.command_id, supplied));
      try { await waitForLock('update "rifare_operation"'); supplied.actor.actor_id = "cus_other"; supplied.salesChannelIds.length = 0; }
      finally { await blocker.commit(); }
      const result = await action; assert.equal(result.native_payment.id, payment.id);
    });
    await check("C11-COMMIT-OWNER current ownership withdrawn by deferred COMMIT prevents return", async () => {
      const sample = await makeAssociated(); const payment = await payments.authorizePaymentSession(sample.session.id, {}); assert.ok(payment);
      const commandId = sample.command.command_id;
      await postgres.raw(`create function public.c11_owner_commit() returns trigger language plpgsql as $$ begin if new.original_command_uuid='${commandId}' and new.native_payment_id is not null then update auth_identity set app_metadata='{"customer_id":"cus_other"}'::jsonb where id='${f.identity.id}'; end if; return new; end $$`);
      await postgres.raw("create constraint trigger c11_owner after update on rifare_operation deferrable initially deferred for each row execute function public.c11_owner_commit()");
      try { await noEffects(() => assert.rejects(observe(commandId))); }
      finally {
        await postgres.raw("drop trigger c11_owner on rifare_operation; drop function public.c11_owner_commit()");
        await postgres("auth_identity").where({ id: f.identity.id }).update({ app_metadata: { customer_id: f.customer.id } });
      }
      const retained = await sample.row(); assert.equal(retained.native_payment_id, payment.id);
      assert.equal((await noEffects(() => observe(commandId))).first_payment_observed_at.getTime(), retained.native_payment_observed_at.getTime());
    });
    await check("C11-COMMIT-PRIVACY suppression committed with first binding prevents historical return", async () => {
      const sample = await makeAssociated(); const payment = await payments.authorizePaymentSession(sample.session.id, {}); assert.ok(payment);
      const commandId = sample.command.command_id;
      const marker = "hmac-sha256:" + createHmac("sha256", Buffer.from(process.env.RIFARE_JOURNAL_PRIVACY_KEY!, "base64url"))
        .update(JSON.stringify(["urn:rifare:medusa-journal-privacy-subject:v1", f.merchant.merchant_namespace, f.merchant.store_id, f.customer.id])).digest("hex");
      assert.ok(await postgres("rifare_operation_privacy_subject").where({ id: marker, suppressed: false }).first());
      await postgres.raw(`create function public.c11_privacy_commit() returns trigger language plpgsql as $$ begin if new.original_command_uuid='${commandId}' and new.native_payment_id is not null then update rifare_operation_privacy_subject set suppressed=true where id='${marker}'; end if; return new; end $$`);
      await postgres.raw("create constraint trigger c11_privacy after update on rifare_operation deferrable initially deferred for each row execute function public.c11_privacy_commit()");
      try { await noEffects(() => assert.rejects(observe(commandId))); assert.equal((await sample.row()).native_payment_id, payment.id); }
      finally {
        await postgres.raw("drop trigger c11_privacy on rifare_operation; drop function public.c11_privacy_commit()");
        await postgres("rifare_operation_privacy_subject").where({ id: marker }).update({ suppressed: false });
      }
      assert.equal((await noEffects(() => observe(commandId))).native_payment.id, payment.id);
    });
    await check("C11-COMMIT-ABORT cancellation during deferred COMMIT keeps identity without returning it", async () => {
      const sample = await makeAssociated(); const payment = await payments.authorizePaymentSession(sample.session.id, {}); assert.ok(payment);
      const commandId = sample.command.command_id, blocker = await postgres.transaction(), controller = new AbortController();
      await blocker.raw("select pg_advisory_xact_lock(117, 911)");
      await postgres.raw(`create function public.c11_abort_commit() returns trigger language plpgsql as $$ begin if new.original_command_uuid='${commandId}' and new.native_payment_id is not null then perform pg_advisory_xact_lock(117, 911); end if; return new; end $$`);
      await postgres.raw("create constraint trigger c11_abort after update on rifare_operation deferrable initially deferred for each row execute function public.c11_abort_commit()");
      const action = noEffects(() => assert.rejects(observe(commandId, context, controller.signal)));
      try { await waitForLock('update "rifare_operation"'); controller.abort(); }
      finally { await blocker.commit(); }
      try { await action; assert.equal((await sample.row()).native_payment_id, payment.id); }
      finally { await postgres.raw("drop trigger c11_abort on rifare_operation; drop function public.c11_abort_commit()"); }
      assert.equal((await noEffects(() => observe(commandId))).native_payment.id, payment.id);
    });
    await check("C11-RACE concurrent first observations retain one immutable identity", async () => {
      const sample = await makeAssociated(); await payments.authorizePaymentSession(sample.session.id, {});
      const outcomes = await noEffects(() => Promise.allSettled([1, 2].map(() => observe(sample.command.command_id))));
      assert.ok(outcomes.some(value => value.status === "fulfilled"));
      const row = await sample.row(), recovered = await noEffects(() => observe(sample.command.command_id));
      for (const result of outcomes) if (result.status === "fulfilled") {
        assert.equal(result.value.native_payment.id, row.native_payment_id);
        assert.equal(result.value.first_payment_observed_at.getTime(), row.native_payment_observed_at.getTime());
      } else assert.equal(result.reason.code, "40001", "only native serialization contention is an expected losing observation");
      assert.equal(recovered.first_payment_observed_at.getTime(), row.native_payment_observed_at.getTime());
      assert.deepEqual(await sample.row(), row);
    });
    await check("C11-ROLLBACK deferred COMMIT failure persists no partial first identity", async () => {
      const sample = await makeAssociated(); await payments.authorizePaymentSession(sample.session.id, {});
      const commandId = sample.command.command_id, before = await sample.row();
      await postgres.raw(`create function public.c11_fail_commit() returns trigger language plpgsql as $$ begin if new.original_command_uuid='${commandId}' and new.native_payment_id is not null then raise exception 'C11_TEST_COMMIT_FAILURE'; end if; return new; end $$`);
      await postgres.raw("create constraint trigger c11_commit after update on rifare_operation deferrable initially deferred for each row execute function public.c11_fail_commit()");
      try { await noEffects(() => assert.rejects(observe(commandId), /C11_TEST_COMMIT_FAILURE/)); }
      finally { await postgres.raw("drop trigger c11_commit on rifare_operation; drop function public.c11_fail_commit()"); }
      assert.deepEqual(await sample.row(), before);
      assert.ok((await noEffects(() => observe(commandId))).native_payment.id);
    });
    await check("C11-RESTART fresh process recovers the committed original after acknowledgement loss", async () => {
      const sample = await makeAssociated(); const payment = await payments.authorizePaymentSession(sample.session.id, {}); assert.ok(payment);
      const task = { command_id: sample.command.command_id, context };
      const lost = await noEffects(() => runWorker({ ...task, mode: "lose-ack" })); assert.equal(lost.code, 79, lost.output);
      const before = await sample.row(); assert.equal(before.native_payment_id, payment.id);
      const recovered = await noEffects(() => runWorker({ ...task, mode: "recover" })); assert.equal(recovered.code, 0, recovered.output);
      assert.ok(recovered.output.includes(payment.id)); assert.ok(recovered.output.includes(before.native_payment_observed_at.toISOString()));
      assert.deepEqual(await sample.row(), before);
    });
    await check("C11-PRIVACY hold export erasure and refusal restore preserve the newer immutable refusal", async () => {
      const before = await original.row(), exported = await journal.exportPrivacySubject(f.customer.id, f.privacyActor);
      const entry = exported.find(value => value.id === before.id)!;
      assert.equal(entry.native_payment_id, native.id); assert.equal(entry.native_payment_fingerprint, before.native_payment_fingerprint);
      assert.equal(entry.native_payment_observed_at!.getTime(), before.native_payment_observed_at.getTime());
      assert.equal(await journal.setPrivacyHold(f.customer.id, before.id, before.revision, true, f.privacyActor), true);
      await journal.erasePrivacySubject(f.customer.id, f.privacyActor); const held = await original.row();
      assert.equal(held.state, "retired"); assert.equal(held.native_payment_id, native.id);
      await noEffects(() => assert.rejects(observe(id)));
      assert.equal(await journal.setPrivacyHold(f.customer.id, held.id, held.revision, false, f.privacyActor), true);
      const minimized = await original.row(); assert.equal(minimized.native_payment_id, null); assert.equal(minimized.native_payment_observed_at, null);
      assert.equal(minimized.native_payment_fingerprint, before.native_payment_fingerprint);
      const refusal = { id: before.id, original_command_uuid: id, challenge_fingerprint: before.challenge_fingerprint,
        receipt_fingerprint: before.receipt_fingerprint, final_command_uuid: before.final_command_uuid,
        payment_fingerprint: before.payment_fingerprint, native_payment_fingerprint: before.native_payment_fingerprint };
      await journal.restorePrivacyRefusals([refusal], f.privacyActor);
      const { native_payment_fingerprint: _missing, ...legacy } = refusal;
      await assert.rejects(journal.restorePrivacyRefusals([legacy], f.privacyActor));
      await assert.rejects(journal.restorePrivacyRefusals([{ ...refusal, native_payment_fingerprint: "sha256:" + "0".repeat(64) }], f.privacyActor));
      const duplicate = { ...minimized, id: "rifop_" + randomUUID().replaceAll("-", ""), original_command_uuid: randomUUID(),
        challenge_fingerprint: null, receipt_fingerprint: null, final_command_uuid: null,
        payment_fingerprint: "sha256:" + "1".repeat(64) };
      await assert.rejects(postgres("rifare_operation").insert(duplicate), (error: any) => error.code === "23505" && error.constraint === "rifare_operation_native_payment_unique");
      await journal.uninstallPrivacyJournal(f.privacyActor);
      assert.equal((await original.row()).native_payment_fingerprint, before.native_payment_fingerprint);
      await noEffects(() => assert.rejects(observe(id)));
    });
    console.log("RIFARE_NATIVE_PAYMENT_OUTCOMES_RESULT=" + JSON.stringify({ result: "pass", checks,
      profile: "native-historical-observation", actual_financial_effects: false, execution_authorized: false, production_qualified: false }));
  } finally { verifier.close(); f.requestVerifier.close(); }
}
