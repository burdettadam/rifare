import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { ModulesSdkUtils } from "@medusajs/framework/utils";

type Postgres = ReturnType<typeof ModulesSdkUtils.createPgConnection>;
export const executionColumns = ["execution_owner_fingerprint", "execution_seal_fingerprint",
  "execution_payment_handle_fingerprint", "execution_generation", "execution_claimed_at",
  "execution_expires_at", "execution_revoked_at", "execution_payment_attempted_at", "execution_order_id", "execution_order_fingerprint"] as const;
export type ExecutionRow = {
  execution_owner_fingerprint: string | null; execution_seal_fingerprint: string | null;
  execution_payment_handle_fingerprint: string | null; execution_generation: number | null;
  execution_claimed_at: Date | null; execution_expires_at: Date | null; execution_revoked_at: Date | null;
  execution_payment_attempted_at: Date | null;
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
  if (!(await postgresGenerationReady(tx))) throw new Error("NATIVE_GENERATION_FENCE_NOT_READY");
  const role = "rifare_exec_" + randomUUID().replaceAll("-", ""), password = randomBytes(32).toString("hex");
  try {
    await tx.raw(`create role "${role}" nologin password '${password}' nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls`);
    if ((await tx.raw("select pg_catalog.has_schema_privilege(?::name,'public','CREATE') as permitted", [role])).rows[0]?.permitted !== false)
      throw new Error("NATIVE_EXECUTION_SCHEMA_PRIVILEGE_UNAVAILABLE");
    await tx.raw(`grant usage on schema public to "${role}"`);
    await tx.raw(`grant execute on function public.rifare_require_native_execution_payment(text,text,text) to "${role}"`);
    await tx.raw(`grant execute on function public.rifare_native_workflow_allowed(text,text) to "${role}"`);
    await tx.raw(`grant select, insert, update, delete on table public.workflow_execution to "${role}"`);
    await tx.raw(`grant execute on function public.rifare_native_cart_read_allowed(text) to "${role}"`);
    await tx.raw(`grant select on table public.cart_promotion to "${role}"`);
    await tx.raw(`grant execute on function public.rifare_native_product_read_allowed(text) to "${role}"`);
    await tx.raw(`grant select on table public.product_shipping_profile to "${role}"`);
    // Explicit native commerce allowlists; identity, user, API-key, workflow and
    // infrastructure state are never writable by an original execution worker.
    // Row-level original visibility/fencing is still a pending C12 boundary.
    const writes = new Set([
      "cart", "cart_address", "cart_line_item", "cart_line_item_adjustment", "cart_line_item_tax_line",
      "cart_shipping_method", "cart_shipping_method_adjustment", "cart_shipping_method_tax_line", "cart_credit_line",
      "order", "order_address", "order_item", "order_line_item", "order_line_item_adjustment", "order_line_item_tax_line",
      "order_shipping", "order_shipping_method", "order_shipping_method_adjustment", "order_shipping_method_tax_line",
      "order_summary", "order_credit_line", "order_transaction", "reservation_item",
      "payment_collection", "payment_session", "payment", "capture", "refund",
      "order_cart", "order_payment_collection", "order_promotion", "cart_payment_collection",
    ]);
    const reads = new Set([
      ...writes, "credit_line", "store", "store_currency", "sales_channel", "region", "region_country", "currency", "country",
      "customer", "customer_address", "tax_provider", "fulfillment_provider", "notification_provider", "locale", "payment_provider", "region_payment_provider", "product", "product_variant",
      "product_option", "product_option_value", "product_variant_option", "product_image", "product_category",
      "product_tag", "product_collection", "product_sales_channel", "product_variant_price_set", "price", "price_set",
      "price_rule", "price_list", "price_preference", "shipping_option", "shipping_profile", "shipping_option_rule",
      "shipping_option_type", "service_zone", "fulfillment_set", "stock_location", "inventory_item", "inventory_level",
      "tax_rate", "tax_region", "product_variant_inventory_item", "sales_channel_stock_location",
    ]);
    const tables = await tx("pg_catalog.pg_tables").where({ schemaname: "public" }).select("tablename");
    for (const { tablename } of tables) {
      if (!reads.has(tablename)) continue;
      if (!/^[a-z_][a-z0-9_]*$/.test(tablename)) throw new Error("NATIVE_TABLE_NAME_UNAVAILABLE");
      await tx.raw(`grant ${writes.has(tablename) ? "select, insert, update, delete" : "select"} on table public."${tablename}" to "${role}"`);
    }
    const sequences = (await tx.raw(`select distinct s.relname as name, t.relname as native_table
      from pg_catalog.pg_class s join pg_catalog.pg_namespace n on n.oid=s.relnamespace
      join pg_catalog.pg_depend d on d.objid=s.oid and d.deptype in ('a','i')
      join pg_catalog.pg_class t on t.oid=d.refobjid
      where s.relkind='S' and n.nspname='public'`)).rows;
    for (const sequence of sequences) {
      if (!writes.has(sequence.native_table)) continue;
      if (!/^[a-z_][a-z0-9_]*$/.test(sequence.name)) throw new Error("NATIVE_SEQUENCE_NAME_UNAVAILABLE");
      await tx.raw(`grant usage, select on sequence public."${sequence.name}" to "${role}"`);
    }
    return { role, password, fingerprint: executionFingerprint(role) };
  } catch { throw new Error("NATIVE_EXECUTION_WORKER_UNAVAILABLE"); }
}


export async function activateOriginalExecutionWorker(tx: Postgres, role: string) {
  requireNativeExecutionProfile();
  if (!tx.isTransaction || !/^rifare_exec_[a-f0-9]{32}$/.test(role)) throw new Error("NATIVE_EXECUTION_WORKER_UNAVAILABLE");
  await tx.raw(`alter role "${role}" login`);
}

/** Failed delivery retires access, not the original attempt or its uncertainty. */
export async function retireOriginalExecutionWorker(postgres: Postgres, role: string) {
  if (!/^rifare_exec_[a-f0-9]{32}$/.test(role)) throw new Error("NATIVE_EXECUTION_WORKER_UNAVAILABLE");
  await postgres.transaction(async tx => {
    await tx("rifare_operation").where({ execution_owner_fingerprint: executionFingerprint(role) })
      .whereNull("execution_revoked_at").update({ execution_generation: tx.raw("execution_generation + 1"),
        execution_revoked_at: tx.fn.now(), revision: tx.raw("revision + 1"), updated_at: tx.fn.now() });
    await tx.raw(`alter role "${role}" nologin`);
  });
}


async function postgresGenerationReady(postgres: Postgres) {
  return (await postgres.raw(`select public.rifare_native_generation_ready()
    and public.rifare_native_workflow_ready()
    and public.rifare_native_cart_read_ready()
    and public.rifare_native_product_read_ready()
    and public.rifare_native_order_binding_ready()
    and public.rifare_native_link_serialization_ready() as ready`)).rows[0]?.ready === true;
}

/** Native links migrate after modules. The provisioning controller completes
 * static guard attachment at lifecycle start; restricted workers only verify it.
 * No superuser event trigger or separate mandatory migration command is added. */
export async function ensureNativeGenerationInstallation(postgres: Postgres) {
  if (await postgresGenerationReady(postgres)) return;
  const role = (await postgres.raw("select session_user as role")).rows[0]?.role;
  if (typeof role !== "string" || /^rifare_exec_[a-f0-9]{32}$/.test(role)) throw new Error("NATIVE_GENERATION_FENCE_NOT_READY");
  await postgres.raw("select public.rifare_install_native_generation_fences()");
  await postgres.raw("select public.rifare_install_native_workflow_fence()");
  await postgres.raw("select public.rifare_install_native_cart_read_fence()");
  await postgres.raw("select public.rifare_install_native_product_read_fence()");
  await postgres.raw("select public.rifare_install_native_order_binding()");
  await postgres.raw("select public.rifare_install_native_link_serialization()");
  if (!(await postgresGenerationReady(postgres))) throw new Error("NATIVE_GENERATION_FENCE_NOT_READY");
}
