import assert from "node:assert/strict";
import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { operationJournalModule } from "../modules/operation-journal";
import type OperationJournalService from "../modules/operation-journal/service";
import { minimizedOperationFields } from "../modules/operation-journal/privacy";
import { executionFingerprint } from "../modules/operation-journal/execution-claim";
import { bytes } from "./native-receipt-fixture";

/** Behavioral privacy and whole-database restore coverage for the durable
 * provider-attempt marker. This never invokes a payment provider. */
export default async function verifyProviderAttemptPrivacyRestore({ container }: ExecArgs) {
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.RIFARE_COMMERCE_VERIFY, "disposable");
  const phase = process.env.RIFARE_C12_ATTEMPT_PRIVACY_PHASE;
  assert.ok(["export", "erase", "recover", "reconcile-erase", "reconcile-uninstall"].includes(phase ?? ""));
  const fixture = JSON.parse(process.env.RIFARE_C12_ATTEMPT_PRIVACY_FIXTURE ?? "");
  if (process.env.RIFARE_C12_ATTEMPT_PRIVACY_FAULT === "clear-attempt") {
    (minimizedOperationFields as any).execution_payment_attempted_at = null;
    console.log("C12_PROVIDER_ATTEMPT_PRIVACY_FAULT=clear-attempt-on-minimization");
  }
  if (process.env.RIFARE_C12_ATTEMPT_PRIVACY_FAULT === "clear-order") {
    (minimizedOperationFields as any).execution_order_fingerprint = null;
    console.log("C12_PROVIDER_ATTEMPT_PRIVACY_FAULT=clear-order-on-minimization");
  }
  const journal = container.resolve<OperationJournalService>(operationJournalModule);
  const postgres = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const completed = fixture.completed;
  const claimed = fixture.execution;
  const prefix = fixture.prefix;
  const identity = claimed ?? prefix;
  const earlyPrefix = prefix && ["order-only", "order-cart-only", "order-payment-only", "cart-completed-only"].includes(prefix.stage);
  if (claimed) assert.ok(["claim-commit", "activation-commit"].includes(claimed.stage));
  if (prefix) assert.ok(earlyPrefix || ["pre-payment", "provider-admitted", "unobserved-completion"].includes(prefix.stage));
  const nativeTables = ["cart", "cart_address", "cart_line_item", "cart_line_item_adjustment", "cart_line_item_tax_line",
    "cart_shipping_method", "cart_shipping_method_adjustment", "cart_shipping_method_tax_line",
    "order", "order_address", "order_item", "order_line_item", "order_line_item_adjustment", "order_line_item_tax_line",
    "order_shipping", "order_shipping_method", "order_shipping_method_adjustment", "order_shipping_method_tax_line",
    "order_summary", "order_credit_line", "order_transaction", "reservation_item", "payment_collection",
    "payment_session", "payment", "capture", "refund", "order_cart", "order_payment_collection", "order_promotion",
    "cart_payment_collection"];
  const nativeSnapshot = async () => {
    const rows: Record<string, unknown> = {};
    for (const table of nativeTables) rows[table] = await postgres(table).orderBy("id");
    return JSON.stringify(rows);
  };
  let nativeBefore: string | undefined;
  if (completed || identity) {
    nativeBefore = await nativeSnapshot();
    const payments: any = container.resolve(Modules.PAYMENT);
    for (const owner of [payments, payments.paymentProviderService_])
      for (const method of ["authorizePaymentSession", "authorizePayment", "capturePayment", "cancelPayment", "refundPayment", "getStatus"])
        owner[method] = async () => { throw new Error("C12_AFTER_EFFECT_UNEXPECTED_PROVIDER_ACTION"); };
  }
  if (completed) {
    assert.equal(completed.order_fingerprint, executionFingerprint(completed.order_id));
    assert.ok(await postgres("order").where({ id: completed.order_id }).first());
    assert.ok(await postgres("payment").where({ id: completed.payment_id }).first());
  }
  assert.equal((await postgres.raw("select has_function_privilege('public','public.rifare_require_native_execution_payment(text,text,text)','execute') as allowed")).rows[0].allowed, false);
  const selected = () => postgres("rifare_operation").where({ original_command_uuid: fixture.original_id }).first();
  const before = await selected();
  if (identity) {
    assert.equal(before.state, "unknown");
    if (claimed || earlyPrefix || prefix.stage === "pre-payment") assert.equal(before.execution_payment_attempted_at, null);
    else {
      assert.ok(before.execution_payment_attempted_at instanceof Date);
      assert.equal(before.execution_payment_attempted_at.toISOString(), prefix.attempted_at);
    }
    assert.equal(before.execution_order_id, prefix?.order_id ?? null);
    assert.equal(before.execution_owner_fingerprint, identity.owner);
    assert.equal(before.execution_seal_fingerprint, identity.seal);
    assert.equal(before.execution_payment_handle_fingerprint, identity.handle);
    if (prefix) {
      assert.equal(prefix.order_fingerprint, executionFingerprint(prefix.order_id));
      assert.equal(before.execution_order_fingerprint, prefix.order_fingerprint);
      assert.ok(await postgres("order").where({ id: prefix.order_id }).first());
      const cartLinks = await postgres("order_cart").where({ cart_id: before.cart_id });
      const paymentLinks = await postgres("order_payment_collection").where({ payment_collection_id: before.payment_collection_id });
      assert.equal(cartLinks.length, earlyPrefix ? Number(prefix.stage === "order-cart-only") : 1);
      assert.equal(paymentLinks.length, earlyPrefix ? Number(prefix.stage === "order-payment-only") : 1);
      for (const link of [...cartLinks, ...paymentLinks]) assert.equal(link.order_id, prefix.order_id);
      const cart = await postgres("cart").where({ id: before.cart_id }).first();
      if (earlyPrefix && prefix.stage !== "cart-completed-only") assert.equal(cart.completed_at, null);
      else assert.ok(cart.completed_at instanceof Date);
      if ("cart_completed_at" in prefix) assert.equal(cart.completed_at?.toISOString() ?? null, prefix.cart_completed_at);
      const payments = await postgres("payment").where({ payment_collection_id: before.payment_collection_id });
      assert.equal(payments.length, prefix.stage === "unobserved-completion" ? 1 : 0);
      if (payments[0]) assert.equal(payments[0].id, prefix.payment_id);
      assert.equal(before.native_payment_id, null); assert.equal(before.native_payment_fingerprint, null);
    }
    const verifier = await journal.createAuthorityReceiptVerifier(bytes(fixture.trust));
    const countRoles = async () => Number((await postgres.raw("select count(*) as n from pg_roles where rolname ~ '^rifare_exec_[a-f0-9]{32}$'")).rows[0].n);
    const count = await countRoles();
    try {
      const recovered = await journal.claimNativeExecution(fixture.original_id, fixture.privacy.context, verifier);
      assert.equal(recovered.disposition, "recovery_only");
      assert.equal(recovered.worker, null); assert.equal(recovered.seal, null);
      assert.equal(await countRoles(), count);
      assert.deepEqual(await selected(), before);
    } finally { verifier.close(); }
  } else assert.ok(before?.execution_payment_attempted_at instanceof Date);
  const attemptedAt = before.execution_payment_attempted_at?.toISOString() ?? null;
  const attemptValue = (row: any) => row.execution_payment_attempted_at?.toISOString() ?? null;
  if (completed) {
    assert.equal(attemptedAt, completed.attempted_at);
    assert.equal(before.execution_order_fingerprint, completed.order_fingerprint);
    assert.equal(before.native_payment_id, completed.payment_id);
    assert.ok(before.native_payment_fingerprint);
  }
  const assertRetainedAttempt = async () => {
    const row = await selected();
    assert.equal(row.state, "retired");
    assert.equal(attemptValue(row), attemptedAt);
    assert.ok(row.execution_owner_fingerprint); assert.ok(row.execution_seal_fingerprint);
    assert.ok(row.execution_payment_handle_fingerprint); assert.ok(row.execution_revoked_at instanceof Date);
    assert.ok(row.execution_generation >= 2);
    if (identity) {
      assert.equal(row.execution_owner_fingerprint, identity.owner);
      assert.equal(row.execution_seal_fingerprint, identity.seal);
      assert.equal(row.execution_payment_handle_fingerprint, identity.handle);
    }
    if (prefix) {
      assert.equal(row.execution_order_fingerprint, prefix.order_fingerprint);
      assert.equal(row.native_payment_id, null); assert.equal(row.native_payment_fingerprint, null);
    }
    if (completed) {
      assert.equal(row.execution_order_fingerprint, completed.order_fingerprint);
      assert.equal(row.native_payment_fingerprint, before.native_payment_fingerprint);
      assert.equal(row.native_payment_id, null);
    }
    for (const field of ["execution_claimed_at", "execution_expires_at", "execution_order_id",
      "payment_collection_id", "payment_session_id", "payment_provider_id", "command_bytes", "receipt_bytes"])
      assert.equal(row[field], null, field);
    return row;
  };

  if (phase === "export" || phase === "recover") {
    const exported = await journal.exportPrivacySubject(fixture.privacy.customer_id, fixture.privacy.actor);
    const row = exported.find((candidate: any) => candidate.original_command_uuid === fixture.original_id);
    assert.ok(row);
    assert.equal(attemptValue(row), attemptedAt);
    assert.equal(attemptValue(await selected()), attemptedAt);
  } else if (phase === "erase") {
    assert.equal(await journal.setPrivacyHold(fixture.privacy.customer_id, before.id, before.revision, true,
      fixture.privacy.actor), true);
    const heldBeforeErase = await selected();
    const heldExport = await journal.exportPrivacySubject(fixture.privacy.customer_id, fixture.privacy.actor);
    const exported = heldExport.find((candidate: any) => candidate.id === before.id);
    assert.ok(exported); assert.equal(attemptValue(exported), attemptedAt);
    await journal.erasePrivacySubject(fixture.privacy.customer_id, fixture.privacy.actor);
    const held = await selected(); assert.equal(held.state, "retired");
    assert.equal(attemptValue(held), attemptedAt);
    assert.ok(held.execution_claimed_at instanceof Date);
    assert.equal(await journal.setPrivacyHold(fixture.privacy.customer_id, held.id, held.revision, false,
      fixture.privacy.actor), true);
    await assertRetainedAttempt();
    assert.ok(held.revision > heldBeforeErase.revision);
  } else {
    const reconcile = () => journal.reconcilePrivacyRestore([], phase === "reconcile-erase" ? [fixture.privacy.customer_id] : [],
      fixture.privacy.actor, { installationUninstalled: phase === "reconcile-uninstall" });
    await reconcile(); await reconcile();
    await assertRetainedAttempt();
  }
  if (completed || identity) assert.equal(await nativeSnapshot(), nativeBefore, "Privacy restore must not mutate or repeat native effects");
  console.log("C12_PROVIDER_ATTEMPT_PRIVACY_RESTORE=" + JSON.stringify({ result: "pass", phase,
    attempted_at_retained: true, completed_effect_retained: Boolean(completed),
    ...(claimed ? { claim_stage_retained: claimed.stage, inspected_native_tables: nativeTables.length } : {}),
    ...(prefix ? { native_prefix_retained: prefix.stage, inspected_native_tables: nativeTables.length } : {}),
    execution_authorized: false, provider_invoked: false }));
}
