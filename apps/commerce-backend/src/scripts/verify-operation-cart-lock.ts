import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";

/** Check the native cart lock boundary using only a disposable Medusa database. */
export default async function verifyOperationCartLock({ container }: ExecArgs) {
  if (process.env.NODE_ENV !== "test" || process.env.RIFARE_COMMERCE_VERIFY !== "disposable") {
    throw new Error("RIFARE_DISPOSABLE_COMMERCE_TEST_REQUIRED");
  }
  const postgres = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const carts = container.resolve(Modules.CART);
  const oldEmail = "before@example.invalid";
  const newEmail = "after@example.invalid";
  const cart = await carts.createCarts({ currency_code: "usd", email: oldEmail });

  const startTransaction = () => postgres.transaction();
  const writer = await startTransaction();
  let reader: Awaited<ReturnType<typeof startTransaction>> | undefined;
  let pending: Promise<unknown> | undefined;
  try {
    reader = await startTransaction();
    const writerPid = (await writer.raw("select pg_backend_pid() as pid")).rows[0].pid;
    const readerPid = (await reader.raw("select pg_backend_pid() as pid")).rows[0].pid;
    assert.notEqual(readerPid, writerPid);
    await writer.raw("set local statement_timeout = '10s'");
    await reader.raw("set local statement_timeout = '10s'");
    assert.equal(await writer("cart").where({ id: cart.id }).update({ email: newEmail }), 1);

    // Starting the query on a separate backend must wait for the actual native
    // row lock. pg_blocking_pids gives a database witness for the wait.
    const lockedRow = reader("cart").where({ id: cart.id }).forUpdate().first("email").then(
      (row) => ({ row, error: undefined }),
      (error: unknown) => ({ row: undefined, error }),
    );
    pending = lockedRow;

    const deadline = Date.now() + 5000;
    let blocked = false;
    while (!blocked && Date.now() < deadline) {
      const { rows } = await writer.raw(
        "select ?::integer = any(pg_blocking_pids(?::integer)) as blocked", [writerPid, readerPid],
      );
      blocked = rows[0].blocked;
      if (!blocked) await delay(25);
    }
    assert.equal(blocked, true, "The cart locking read must wait for the independent writer");

    await writer.commit();
    const { row, error } = await lockedRow;
    if (error) throw error;
    assert.equal(row?.email, newEmail, "Admission must read the cart after the competing update commits");

    assert.equal(await reader("cart").where({ id: cart.id }).update({ email: oldEmail }), 1);
    await reader.rollback();
    const retained = await carts.retrieveCart(cart.id, { select: ["email"] });
    assert.equal(retained.email, newEmail, "Rollback must preserve the previously committed native facts");
    console.log(JSON.stringify({ operationCartLock: "pass", writerPid, readerPid }));
  } finally {
    if (!writer.isCompleted()) await writer.rollback();
    await pending;
    if (reader && !reader.isCompleted()) await reader.rollback();
    await carts.deleteCarts(cart.id);
  }
}
