import type { ModulesSdkUtils } from "@medusajs/framework/utils";

type Postgres = ReturnType<typeof ModulesSdkUtils.createPgConnection>;
type Binding = { operationId: string; cartId: string; collectionId: string; sessionId: string;
  customerId: string; identityId: string; storeId: string; operatorId: string; privacyIds: readonly string[]; role: string };

/** Transient delivery comparison, not a ledger, grant, pricing engine or effect
 * fence. The first snapshot is captured after actual native/C8/C9 validation in
 * its serializable transaction. One read-only autocommit statement compares all
 * those inputs after activation COMMIT, with no later asynchronous activation.
 * Bounds refuse truncated source inputs; raw records never leave PostgreSQL.
 */
export async function nativeExecutionDeliverySnapshot(postgres: Postgres, b: Binding) {
  const parts: [string, string, string[], number][] = [
    ["journal", "select * from public.rifare_operation where id=?", [b.operationId], 1],
    ["cart", "select * from public.cart where id=?", [b.cartId], 1],
    ["items", "select * from public.cart_line_item where cart_id=?", [b.cartId], 200],
    ["item_tax", "select t.* from public.cart_line_item_tax_line t join public.cart_line_item i on i.id=t.item_id where i.cart_id=?", [b.cartId], 10000],
    ["item_adjustments", "select t.* from public.cart_line_item_adjustment t join public.cart_line_item i on i.id=t.item_id where i.cart_id=?", [b.cartId], 10000],
    ["shipping", "select * from public.cart_shipping_method where cart_id=?", [b.cartId], 20],
    ["shipping_tax", "select t.* from public.cart_shipping_method_tax_line t join public.cart_shipping_method i on i.id=t.shipping_method_id where i.cart_id=?", [b.cartId], 10000],
    ["shipping_adjustments", "select t.* from public.cart_shipping_method_adjustment t join public.cart_shipping_method i on i.id=t.shipping_method_id where i.cart_id=?", [b.cartId], 10000],
    ["credits", "select * from public.credit_line where cart_id=?", [b.cartId], 100],
    ["addresses", "select * from public.cart_address where id in(select shipping_address_id from public.cart where id=? union select billing_address_id from public.cart where id=?)", [b.cartId,b.cartId], 2],
    ["order_links", "select * from public.order_cart where cart_id=?", [b.cartId], 1],
    ["collection_links", "select * from public.cart_payment_collection where cart_id=? or payment_collection_id=?", [b.cartId,b.collectionId], 1],
    ["collection", "select * from public.payment_collection where id=?", [b.collectionId], 1],
    ["sessions", "select * from public.payment_session where payment_collection_id=?", [b.collectionId], 1],
    ["payments", "select * from public.payment where payment_collection_id=? or payment_session_id=?", [b.collectionId,b.sessionId], 100],
    ["customer", "select * from public.customer where id=?", [b.customerId], 1],
    ["identity", "select * from public.auth_identity where id=?", [b.identityId], 1],
    ["stores", "select * from public.store where deleted_at is null", [], 1],
    ["region", "select * from public.region where id in(select region_id from public.cart where id=?)", [b.cartId], 1],
    ["channel", "select * from public.sales_channel where id in(select sales_channel_id from public.cart where id=?)", [b.cartId], 1],
    ["provider", "select * from public.payment_provider where id='pp_rifare_fenced_system_fixture'", [], 1],
    ["eligibility", "select * from public.region_payment_provider where payment_provider_id='pp_rifare_fenced_system_fixture' and region_id in(select region_id from public.cart where id=?)", [b.cartId], 1],
    ["operator", "select * from public.\"user\" where id=?", [b.operatorId], 1],
    ["privacy", "select * from public.rifare_operation_privacy_subject where id in (?,?)", [...b.privacyIds], 2],
  ];
  const bindings: string[] = [];
  const objects = parts.map(([name, sql, values, maximum]) => {
    bindings.push(...values);
    return `'${name}',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from (${sql} order by id limit ${maximum + 1}) r)`;
  });
  bindings.push(b.role);
  const bounded = parts.map(([name,,,maximum]) => `jsonb_array_length(data->'${name}')<=${maximum}`).join(" and ");
  const row = (await postgres.raw(`with snapshot as (select jsonb_build_object(${objects.join(",")}) as data)
    select clock_timestamp() as observed_at, encode(sha256(convert_to(data::text,'UTF8')),'hex') as fingerprint,
      (${bounded}) as bounded, (select rolcanlogin from pg_catalog.pg_roles where rolname=?) as can_login from snapshot`, bindings)).rows[0];
  if (!row?.bounded || !(row.observed_at instanceof Date) || !/^[a-f0-9]{64}$/.test(row.fingerprint))
    throw new Error("NATIVE_EXECUTION_DELIVERY_UNAVAILABLE");
  return { fingerprint: row.fingerprint as string, observedAt: row.observed_at as Date, canLogin: row.can_login === true };
}
