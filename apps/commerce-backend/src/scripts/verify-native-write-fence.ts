import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";

/** Disposable database experiment. No application migration or runtime fence is installed. */
export default async function verifyNativeWriteFence({ container }: ExecArgs) {
  if (process.env.NODE_ENV !== "test" || process.env.RIFARE_COMMERCE_VERIFY !== "disposable") {
    throw new Error("RIFARE_DISPOSABLE_COMMERCE_TEST_REQUIRED");
  }
  const postgres = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const carts = container.resolve(Modules.CART);
  const workerCart = process.env.RIFARE_FENCE_WORKER_CART;
  if (workerCart) {
    assert.match(workerCart, /^cart_[A-Za-z0-9]+$/);
    await carts.updateCarts(workerCart, { email: "after-fence@example.invalid" });
    console.log("RIFARE_FENCE_WORKER_RESULT=pass");
    return;
  }
  const cart = await carts.createCarts({ currency_code: "usd", email: "before-fence@example.invalid" });
  const connection = await postgres.client.acquireConnection();
  const onOwner = (sql: string) => postgres.raw(sql).connection(connection);
  let held = false;
  let pending: Promise<{ stdout: string; stderr: string }> | undefined;
  const server = createServer(async (_request, response) => {
    try {
      const row = await postgres("cart").where({ id: cart.id }).first("email");
      assert.equal(row.email, "before-fence@example.invalid");
      response.end("frozen");
    } catch {
      response.statusCode = 500;
      response.end("failed");
    }
  });
  try {
    // BEFORE STATEMENT obtains the shared lock before a native writer takes row locks.
    // All identifiers and lock keys are fixed test data in this disposable database.
    await postgres.raw(`
      create function rifare_fixture_write_gate() returns trigger language plpgsql as $$
      begin
        perform pg_advisory_xact_lock_shared(1940051, 1);
        return null;
      end $$;
      create trigger rifare_fixture_write_gate before insert or update or delete on cart
      for each statement execute function rifare_fixture_write_gate();
    `);
    await onOwner("select pg_advisory_lock(1940051, 1)");
    held = true;
    const ownerPid = (await onOwner("select pg_backend_pid() as pid")).rows[0].pid;
    pending = promisify(execFile)(process.execPath, [
      "run.mjs", "exec", "./src/scripts/verify-native-write-fence.ts",
    ], {
      env: { ...process.env, RIFARE_FENCE_WORKER_CART: cart.id },
      timeout: 30000,
    });
    // Attach immediately so a worker failure cannot become an unhandled rejection.
    const worker = pending.then(value => ({ value, error: undefined }),
      (error: unknown) => ({ value: undefined, error }));
    let blockedPid: number | undefined;
    const deadline = Date.now() + 15000;
    while (!blockedPid && Date.now() < deadline) {
      const { rows } = await postgres.raw(`
        select pid from pg_locks
        where locktype = 'advisory' and classid = 1940051 and objid = 1
          and not granted and ?::integer = any(pg_blocking_pids(pid))
      `, [ownerPid]);
      blockedPid = rows[0]?.pid;
      if (!blockedPid) await delay(25);
    }
    assert.ok(blockedPid, "A separate native Medusa process must wait on the session fence");
    assert.notEqual(blockedPid, ownerPid);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const state = await postgres("pg_stat_activity").where({ pid: ownerPid }).first("state", "xact_start");
    assert.equal(state.state, "idle");
    assert.equal(state.xact_start, null, "The fence owner must hold no transaction during HTTP");
    const response = await fetch(`http://127.0.0.1:${address.port}`, { signal: AbortSignal.timeout(3000) });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "frozen");
    assert.equal((await postgres("cart").where({ id: cart.id }).first("email")).email,
      "before-fence@example.invalid");
    await onOwner("select pg_advisory_unlock(1940051, 1)");
    held = false;
    const completed = await worker;
    if (completed.error) throw completed.error;
    assert.ok(completed.value?.stdout.includes("RIFARE_FENCE_WORKER_RESULT=pass"));
    assert.equal((await carts.retrieveCart(cart.id, { select: ["email"] })).email,
      "after-fence@example.invalid");
    console.log("RIFARE_NATIVE_WRITE_FENCE_RESULT=" + JSON.stringify({
      status: "pass", native_writer_process: true, network_without_transaction: true,
      scope: "disposable-cart-table-statement-trigger", production_qualified: false,
    }));
  } finally {
    if (held) await onOwner("select pg_advisory_unlock(1940051, 1)");
    await pending?.catch(() => {});
    await postgres.client.releaseConnection(connection);
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    await postgres.raw("drop trigger if exists rifare_fixture_write_gate on cart");
    await postgres.raw("drop function if exists rifare_fixture_write_gate()");
    await carts.deleteCarts(cart.id);
  }
}
