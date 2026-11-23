import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";

/** Actual native rows/backends in a disposable database; never an actor permission. */
export default async function verifyClaimAdmission({ container }: ExecArgs) {
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.RIFARE_COMMERCE_VERIFY, "disposable");
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION), orders = container.resolve(Modules.ORDER);
  const checks: string[] = [];
  const check = (name: string) => { checks.push(name); console.log("CLAIM_ADMISSION_CHECK " + name); };
  const makeOrder = () => orders.createOrders({ currency_code: "usd", email: `claim-${randomUUID()}@example.invalid` });
  const makeClaim = (orderId: string, fields: object = {}) => ({ id: `claim_${randomUUID().replaceAll("-", "")}`,
    order_id: orderId, order_version: 1, type: "refund", ...fields });
  const refuse = async (action: () => Promise<unknown>) => {
    const before = await pg("order_claim").orderBy("id");
    await assert.rejects(action, (error: any) => {
      assert.match(error?.message ?? "", /RIFARE_CANCELED_ORDER_CLAIM_UNAVAILABLE/);
      assert.equal(error.code ?? error.driverException?.code, "23514"); return true;
    });
    assert.deepEqual(await pg("order_claim").orderBy("id"), before);
  };
  const active = await makeOrder(), canceled = await makeOrder();
  await orders.cancel(canceled.id);
  await refuse(() => pg("order_claim").insert(makeClaim(canceled.id)));
  await refuse(() => pg("order_claim").insert(makeClaim("order_absent_synthetic")));
  await refuse(() => orders.createOrderClaims({ order_id: canceled.id, type: "refund" }));
  check("direct-and-native-module-insertion-refuse-canceled-or-missing-original");
  const timestampOnly = await makeOrder(), statusOnly = await makeOrder(), deleted = await makeOrder();
  await pg("order").where({ id: timestampOnly.id }).update({ canceled_at: pg.fn.now() });
  await pg("order").where({ id: statusOnly.id }).update({ status: "canceled" });
  await pg("order").where({ id: deleted.id }).update({ deleted_at: pg.fn.now() });
  for (const order of [timestampOnly, statusOnly, deleted]) await refuse(() => pg("order_claim").insert(makeClaim(order.id)));
  check("independent-status-timestamp-and-deletion-representations-refuse");
  const claim = makeClaim(active.id);
  await pg("order_claim").insert(claim);
  await refuse(() => pg("order_claim").where({ id: claim.id }).update({ order_id: canceled.id }));
  await pg("order_claim").where({ id: claim.id }).update({ deleted_at: pg.fn.now() });
  await orders.cancel(active.id);
  const historical = await pg("order_claim").where({ id: claim.id }).first();
  await refuse(() => pg("order_claim").where({ id: claim.id }).update({ deleted_at: null }));
  assert.deepEqual(await pg("order_claim").where({ id: claim.id }).first(), historical);
  const canceledClaim = makeClaim(canceled.id, { canceled_at: new Date() });
  await pg("order_claim").insert(canceledClaim);
  await refuse(() => pg("order_claim").where({ id: canceledClaim.id }).update({ canceled_at: null }));
  await pg("order_claim").where({ id: canceledClaim.id }).update({ deleted_at: pg.fn.now() });
  check("reassignment-restoration-and-uncancellation-refuse-while-history-cleanup-remains-available");

  const race = async (commitCancellation: boolean) => {
    const original = await makeOrder(), candidate = makeClaim(original.id);
    const cancel = await pg.transaction(), admission = await pg.transaction();
    let pending: Promise<{ error?: any }> | undefined;
    try {
      await cancel.raw("set local statement_timeout = '10s'");
      await admission.raw("set local statement_timeout = '10s'");
      const cancelPid = (await cancel.raw("select pg_backend_pid() as pid")).rows[0].pid;
      const admissionPid = (await admission.raw("select pg_backend_pid() as pid")).rows[0].pid;
      assert.notEqual(cancelPid, admissionPid);
      await cancel("order").where({ id: original.id }).update({ status: "canceled", canceled_at: cancel.fn.now() });
      pending = admission("order_claim").insert(candidate).then(() => ({}), (error: any) => ({ error }));
      let blocked = false; const deadline = Date.now() + 5000;
      while (!blocked && Date.now() < deadline) {
        blocked = (await cancel.raw("select ?::integer = any(pg_blocking_pids(?::integer)) as blocked", [cancelPid, admissionPid])).rows[0].blocked;
        if (!blocked) await delay(25);
      }
      assert.equal(blocked, true, "Claim must wait on the actual independent cancellation backend");
      if (commitCancellation) await cancel.commit(); else await cancel.rollback();
      const result = await pending;
      if (commitCancellation) {
        assert.equal(result.error?.code, "23514"); assert.match(result.error?.message, /RIFARE_CANCELED_ORDER_CLAIM_UNAVAILABLE/);
        await admission.rollback(); assert.equal(await pg("order_claim").where({ id: candidate.id }).first(), undefined);
      } else {
        assert.equal(result.error, undefined); await admission.commit();
        assert.ok(await pg("order_claim").where({ id: candidate.id }).first());
      }
    } finally {
      if (!cancel.isCompleted()) await cancel.rollback();
      await pending;
      if (!admission.isCompleted()) await admission.rollback();
    }
  };
  await race(true); check("waiting-admission-refuses-after-independent-cancellation-commit");
  await race(false); check("waiting-admission-succeeds-after-independent-cancellation-rollback");
  const later = await makeOrder(), laterClaim = makeClaim(later.id);
  await pg("order_claim").insert(laterClaim);
  const retained = await pg("order_claim").where({ id: laterClaim.id }).first();
  await orders.cancel(later.id);
  assert.deepEqual(await pg("order_claim").where({ id: laterClaim.id }).first(), retained);
  check("earlier-admission-does-not-prevent-later-native-cancellation-or-rewrite-history");
  console.log("RIFARE_NATIVE_CLAIM_ADMISSION_RESULT=" + JSON.stringify({ result: "pass", checks,
    independent_backends: true, scope: "native-claim-activation", execution_authorized: false, production_qualified: false }));
}
