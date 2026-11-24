import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { ExecArgs } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import { nativePaymentFixture } from "./native-payment-fixture";
import { ensureNativeGenerationInstallation, executionFingerprint, requireNativeExecutionProfile } from "../modules/operation-journal/execution-claim";

/** Disposable process-loss witness. Observe real transaction returns; never
 * manufacture a claimed row or return worker credentials to the controller. */
export default async function verifyNativeClaimInterruption({ container }: ExecArgs) {
  requireNativeExecutionProfile();
  const stage = process.env.RIFARE_C12_CLAIM_INTERRUPTION;
  assert.ok(stage === "claim-commit" || stage === "activation-commit");
  const custody = process.env.RIFARE_C12_CLAIM_INTERRUPTION_CUSTODY;
  assert.ok(custody && isAbsolute(custody) && custody.endsWith("-private.json"));
  assert.ok(/^[A-Za-z0-9_-]{43}$/.test(process.env.RIFARE_JOURNAL_PRIVACY_KEY ?? ""), "Explicit fixture privacy key required");
  const f = await nativePaymentFixture(container, true, true);
  await ensureNativeGenerationInstallation(f.postgres);
  const original = await f.makePaymentOriginal();
  let providerCalls = 0;
  const payments: any = container.resolve(Modules.PAYMENT);
  for (const owner of [payments, payments.paymentProviderService_])
    for (const name of ["authorizePaymentSession", "authorizePayment", "capturePayment", "cancelPayment", "refundPayment", "getStatus"])
      owner[name] = async () => { providerCalls++; throw new Error("C12_CLAIM_UNEXPECTED_PROVIDER_ACTION"); };
  const journal: any = f.journal;
  const transaction = journal.withCurrentOriginal;
  let claimed: any;
  const interrupt = async () => {
    const row = await original.row();
    assert.equal(row.state, "unknown");
    assert.equal(row.execution_owner_fingerprint, executionFingerprint(claimed.worker.role));
    assert.equal(row.execution_generation, 1);
    assert.equal(row.execution_revoked_at, null);
    assert.equal(row.execution_payment_attempted_at, null);
    assert.equal(row.execution_order_id, null);
    assert.equal(providerCalls, 0);
    assert.equal((await f.postgres("payment").where({ payment_collection_id: original.collection.id })).length, 0);
    assert.equal((await f.postgres("order_cart").where({ cart_id: original.cart.id })).length, 0);
    assert.ok(row.execution_claimed_at instanceof Date);
    const role = (await f.postgres.raw("select rolcanlogin from pg_roles where rolname=?", [claimed.worker.role])).rows[0];
    assert.equal(role.rolcanlogin, stage === "activation-commit");
    const cart = await f.postgres("cart").where({ id: original.cart.id }).first();
    assert.equal(cart.metadata?.rifare_execution_owner ?? null,
      stage === "activation-commit" ? row.execution_owner_fingerprint : null);
    writeFileSync(custody!, JSON.stringify({ source: process.env.RIFARE_C12_SOURCE,
      original_id: original.command.command_id, execution: { stage, owner: row.execution_owner_fingerprint,
        seal: row.execution_seal_fingerprint, handle: row.execution_payment_handle_fingerprint },
      privacy: { merchant: f.merchant, customer_id: f.customer.id, actor: f.privacyActor, context: f.context },
      trust: f.trust }, null, 2), { flag: "wx", mode: 0o600 });
    // Deliberately skip catch/finally, retirement and framework shutdown. The
    // controller must observe the durable consumed original after process loss.
    process.exit(79);
  };
  journal.withCurrentOriginal = async function(...args: any[]) {
    const result = await transaction.apply(this, args);
    if (result?.disposition === "claimed_unknown") {
      claimed = result;
      if (stage === "claim-commit") await interrupt();
    } else if (claimed) {
      await interrupt();
    }
    return result;
  };
  await journal.claimNativeExecution(original.command.command_id, f.context, f.verifier);
  assert.fail("Expected abrupt process loss at the selected committed boundary");
}
