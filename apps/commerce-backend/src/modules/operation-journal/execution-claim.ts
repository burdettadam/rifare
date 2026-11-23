import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { ModulesSdkUtils } from "@medusajs/framework/utils";

type Postgres = ReturnType<typeof ModulesSdkUtils.createPgConnection>;
export const executionColumns = ["execution_owner_fingerprint", "execution_seal_fingerprint",
  "execution_payment_handle_fingerprint", "execution_generation", "execution_claimed_at",
  "execution_expires_at", "execution_revoked_at", "execution_order_id", "execution_order_fingerprint"] as const;
export type ExecutionRow = {
  execution_owner_fingerprint: string | null; execution_seal_fingerprint: string | null;
  execution_payment_handle_fingerprint: string | null; execution_generation: number | null;
  execution_claimed_at: Date | null; execution_expires_at: Date | null; execution_revoked_at: Date | null;
  execution_order_id: string | null; execution_order_fingerprint: string | null;
};
export const executionFingerprint = (value: string) => "sha256:" + createHash("sha256").update(value).digest("hex");
export function requireNativeExecutionProfile() {
  if (process.env.NODE_ENV !== "test" || process.env.RIFARE_COMMERCE_VERIFY !== "disposable" ||
      process.env.RIFARE_COMMERCE_PROFILE !== "local-medusa" || process.env.RIFARE_TEST_NATIVE_EXECUTION !== "fenced-system")
    throw new Error("NATIVE_EXECUTION_PROFILE_UNAVAILABLE");
}

/** Internal disposable provisioning, never a route or a customer-supplied role.
 * One role per original attempt gives every native pool an authenticated identity.
 * This stage alone grants no qualified workflow dispatch; SQL fencing is pending.
 */
export async function createOriginalExecutionWorker(tx: Postgres) {
  requireNativeExecutionProfile();
  if (!tx.isTransaction) throw new Error("NATIVE_EXECUTION_TRANSACTION_REQUIRED");
  const role = "rifare_exec_" + randomUUID().replaceAll("-", ""), password = randomBytes(32).toString("hex");
  try {
    await tx.raw(`create role "${role}" login password '${password}' nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls`);
    await tx.raw(`grant usage on schema public to "${role}"`);
    // Journal and privacy state remain inaccessible. Never grant all tables:
    // doing so would let the worker forge its own durable original owner.
    const tables = await tx("pg_catalog.pg_tables").where({ schemaname: "public" }).select("tablename");
    for (const { tablename } of tables) {
      if (tablename.startsWith("rifare_operation")) continue;
      if (!/^[a-z_][a-z0-9_]*$/.test(tablename)) throw new Error("NATIVE_TABLE_NAME_UNAVAILABLE");
      await tx.raw(`grant select, insert, update, delete on table public."${tablename}" to "${role}"`);
    }
    await tx.raw(`grant usage, select on all sequences in schema public to "${role}"`);
    return { role, password, fingerprint: executionFingerprint(role) };
  } catch { throw new Error("NATIVE_EXECUTION_WORKER_UNAVAILABLE"); }
}
