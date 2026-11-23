import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { ExecArgs } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import { beginClaimOrderWorkflow, cancelBeginOrderClaimWorkflow, capturePaymentWorkflow,
  completeCartWorkflow, refundPaymentWorkflow } from "@medusajs/medusa/core-flows";
import { nativePaymentFixture } from "./native-payment-fixture";

/** Native historical observations only; trusted setup actions are kept outside observations. */
export default async function verifyPaymentOutcomes({ container }: ExecArgs) {
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.RIFARE_COMMERCE_VERIFY, "disposable");
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
    await delay(Math.max(0, expiry - await f.clock()) + 30);
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
    console.log("RIFARE_NATIVE_PAYMENT_OUTCOMES_RESULT=" + JSON.stringify({ result: "pass", checks,
      profile: "native-historical-observation", actual_financial_effects: false, execution_authorized: false, production_qualified: false }));
  } finally { verifier.close(); f.requestVerifier.close(); }
}
