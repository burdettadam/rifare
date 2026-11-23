import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules, generateJwtToken } from "@medusajs/framework/utils";
import { createApiKeysWorkflow, linkSalesChannelsToApiKeyWorkflow } from "@medusajs/medusa/core-flows";

/** Private synthetic fixtures and independent native effect checks for the
 * relocated Admin browser. No real provider authentication is represented. */
export default async function verifyStandaloneAdmin({ container }: ExecArgs) {
  if (process.env.NODE_ENV !== "test" || process.env.RIFARE_COMMERCE_VERIFY !== "disposable") throw new Error("RIFARE_DISPOSABLE_ADMIN_REQUIRED");
  const file = process.env.RIFARE_ADMIN_FIXTURE_FILE; assert.ok(file);
  const postgres = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const effectSnapshot = async () => {
    const tables: Record<string, { count: number; digest: string }> = {};
    for (const table of ["cart", "cart_line_item", "payment_collection", "payment_session", "payment", "capture", "refund", "order", "order_line_item", "reservation_item", "inventory_level"]) {
      const rows = await postgres(table).orderBy("id").select("*");
      tables[table] = { count: rows.length, digest: createHash("sha256").update(JSON.stringify(rows)).digest("hex") };
    }
    return tables;
  };
  if (process.env.RIFARE_ADMIN_FIXTURE_PHASE === "seed") {
    assert.match(process.env.JWT_SECRET ?? "", /^[a-f0-9]{32}$/);
    const suffix = randomUUID(), customer = await container.resolve(Modules.CUSTOMER).createCustomers({ email: "admin-customer-" + suffix + "@example.invalid", has_account: true });
    const identity = await container.resolve(Modules.AUTH).createAuthIdentities({ app_metadata: { customer_id: customer.id } });
    const customerToken = generateJwtToken({ actor_id: customer.id, actor_type: "customer", auth_identity_id: identity.id,
      app_metadata: { customer_id: customer.id } }, { secret: process.env.JWT_SECRET, expiresIn: "10m" });
    const [store] = await container.resolve(Modules.STORE).listStores(); assert.ok(store.default_sales_channel_id);
    const { result: keys } = await createApiKeysWorkflow(container).run({ input: { api_keys: [{ title: "Synthetic Admin delivery " + suffix,
      type: "publishable", created_by: "rifare-local-verification" }] } });
    await linkSalesChannelsToApiKeyWorkflow(container).run({ input: { id: keys[0].id, add: [store.default_sales_channel_id] } });
    const cart = await container.resolve(Modules.CART).createCarts({ currency_code: "usd", sales_channel_id: store.default_sales_channel_id });
    const baseline = await effectSnapshot();
    writeFileSync(file, JSON.stringify({ synthetic: true, customerId: customer.id, customerToken,
      publishableKey: keys[0].token, cartId: cart.id, baseline }, null, 2) + "\n", { encoding: "utf8" });
    console.log("RIFARE_ADMIN_FIXTURE_SEEDED=" + JSON.stringify({ synthetic: true, customerId: customer.id, cartId: cart.id, protectedEffectTables: Object.keys(baseline).length }));
    return;
  }
  const fixture = JSON.parse(readFileSync(file, "utf8")); assert.equal(fixture.synthetic, true);
  assert.deepEqual(await effectSnapshot(), fixture.baseline, "Admin observation and refused public routes cannot mutate protected native effects");
  if (process.env.RIFARE_ADMIN_FIXTURE_PHASE === "effects") {
    console.log("RIFARE_ADMIN_EFFECTS_RESULT=" + JSON.stringify({ result: "pass", protectedEffectTablesUnchanged: Object.keys(fixture.baseline).length }));
    return;
  }
  assert.equal(process.env.RIFARE_ADMIN_FIXTURE_PHASE, "verify");
  const resultFile = process.env.RIFARE_ADMIN_BROWSER_RESULT; assert.ok(resultFile);
  const result = JSON.parse(readFileSync(resultFile, "utf8")); assert.equal(result.result, "pass");
  const row = await postgres("product").where({ id: result.product.id }).first();
  assert.equal(row.title, result.product.title); assert.equal(row.status, "draft"); assert.equal(row.deleted_at, null);
  const duplicates = await postgres("product").where({ title: row.title }).select("id"); assert.equal(duplicates.length, 1);
  const variants = await postgres("product_variant").where({ product_id: row.id }).whereNull("deleted_at");
  assert.equal(variants.length, 1); assert.equal(variants[0].manage_inventory, false);
  console.log("RIFARE_STANDALONE_ADMIN_NATIVE_RESULT=" + JSON.stringify({ result: "pass", productId: row.id,
    productTitle: row.title, productStatus: row.status, nativeVariants: variants.length,
    protectedEffectTablesUnchanged: Object.keys(fixture.baseline).length, executionAuthorized: false,
    connectedCustomerAuthenticationQualified: false, productionQualified: false }));
}
