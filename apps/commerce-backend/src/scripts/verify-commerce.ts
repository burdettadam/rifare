import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { ExecArgs } from "@medusajs/framework/types";
import { MedusaModule } from "@medusajs/framework/modules-sdk";
import { ContainerRegistrationKeys, Modules, ProductStatus, PromotionActions } from "@medusajs/framework/utils";
import {
  addShippingMethodToCartWorkflow, beginReturnOrderWorkflow, beginReceiveReturnWorkflow, cancelOrderWorkflow,
  capturePaymentWorkflow, completeCartWorkflow, confirmReturnRequestWorkflow, confirmReturnReceiveWorkflow,
  createApiKeysWorkflow, createCartWorkflow, createInventoryLevelsWorkflow,
  createOrderFulfillmentWorkflow, createPaymentCollectionForCartWorkflow,
  createPaymentSessionsWorkflow, createProductsWorkflow, createPromotionsWorkflow,
  createRegionsWorkflow, createSalesChannelsWorkflow, createShippingOptionsWorkflow,
  createShippingProfilesWorkflow, createStockLocationsWorkflow, createTaxRegionsWorkflow,
  linkSalesChannelsToApiKeyWorkflow, linkSalesChannelsToStockLocationWorkflow,
  receiveItemReturnRequestWorkflow, refundPaymentWorkflow, requestItemReturnWorkflow,
  updateCartPromotionsWorkflow, updateStoresWorkflow,
} from "@medusajs/medusa/core-flows";

/** Creates only synthetic records in an explicitly selected disposable local DB.
 * All commerce behavior below comes from upstream workflows/APIs, not a second engine.
 */
export default async function verifyCommerce({ container }: ExecArgs) {
  if (process.env.NODE_ENV !== "test" || process.env.RIFARE_COMMERCE_VERIFY !== "disposable") {
    throw new Error("RIFARE_DISPOSABLE_COMMERCE_TEST_REQUIRED");
  }
  const checks: string[] = [];
  const check = (name: string, assertions: () => void) => {
    assertions(); checks.push(name); console.log(`COMMERCE_CHECK ${name}`);
  };
  const suffix = randomUUID().replaceAll("-", "");
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const link = container.resolve(ContainerRegistrationKeys.LINK);
  const inventory = container.resolve(Modules.INVENTORY);
  const fulfillment = container.resolve(Modules.FULFILLMENT);
  const stores = container.resolve(Modules.STORE);
  const taxes = container.resolve(Modules.TAX);
  const graph = async (entity: string, id: string, fields: string[]) => {
    const { data } = await query.graph({ entity, fields, filters: { id } });
    assert.equal(data.length, 1); return data[0] as any;
  };
  check("core-modules-without-enterprise-rbac-or-audit", () => {
    for (const module of [Modules.CART, Modules.PRICING, Modules.PRODUCT, Modules.ORDER,
      Modules.INVENTORY, Modules.PROMOTION, Modules.PAYMENT, Modules.FULFILLMENT]) {
      assert.equal(MedusaModule.isInstalled(module), true, module);
      assert.ok(container.resolve(module), module);
    }
    // The framework registers unloaded modules as undefined placeholders.
    // Check loaded services rather than mere container-key presence.
    for (const module of [Modules.RBAC, Modules.AUDIT]) {
      assert.equal(MedusaModule.isInstalled(module), false, module);
      assert.equal(container.resolve(module, { allowUnregistered: true }), undefined, module);
    }
  });

  const { result: channels } = await createSalesChannelsWorkflow(container).run({
    input: { salesChannelsData: [{ name: `Rifare test ${suffix}` }] },
  });
  const channel = channels[0];
  const [store] = await stores.listStores();
  await updateStoresWorkflow(container).run({ input: { selector: { id: store.id }, update: {
    supported_currencies: [{ currency_code: "usd", is_default: true }],
    default_sales_channel_id: channel.id,
  } } });
  const { result: regions } = await createRegionsWorkflow(container).run({ input: { regions: [{
    name: `Rifare test ${suffix}`, currency_code: "usd", countries: ["us"],
    payment_providers: ["pp_system_default"], automatic_taxes: true,
  }] } });
  const region = regions[0];
  const existingTax = await taxes.listTaxRegions({ country_code: "us" });
  if (!existingTax.length) {
    await createTaxRegionsWorkflow(container).run({ input: [{ country_code: "us", provider_id: "tp_system",
      default_tax_rate: { rate: 10, code: "rifare-synthetic", name: "Synthetic ten percent" },
    }] });
  }
  const { result: locations } = await createStockLocationsWorkflow(container).run({ input: { locations: [{
    name: `Rifare test ${suffix}`, address: { country_code: "us", city: "Denver", address_1: "1 Synthetic Street" },
  }] } });
  const location = locations[0];
  await linkSalesChannelsToStockLocationWorkflow(container).run({ input: { id: location.id, add: [channel.id] } });
  await link.create({ [Modules.STOCK_LOCATION]: { stock_location_id: location.id },
    [Modules.FULFILLMENT]: { fulfillment_provider_id: "manual_manual" } });
  let [profile] = await fulfillment.listShippingProfiles({ type: "default" });
  if (!profile) {
    const created = await createShippingProfilesWorkflow(container).run({ input: { data: [{ name: "Default", type: "default" }] } });
    profile = created.result[0];
  }
  const set = await fulfillment.createFulfillmentSets({ name: `Rifare test ${suffix}`, type: "shipping",
    service_zones: [{ name: "Synthetic US", geo_zones: [{ country_code: "us", type: "country" }] }],
  });
  await link.create({ [Modules.STOCK_LOCATION]: { stock_location_id: location.id },
    [Modules.FULFILLMENT]: { fulfillment_set_id: set.id } });
  const { result: options } = await createShippingOptionsWorkflow(container).run({ input: [{
    name: "Synthetic manual shipping", price_type: "flat", provider_id: "manual_manual",
    service_zone_id: set.service_zones[0].id, shipping_profile_id: profile.id,
    type: { label: "Synthetic", description: "No real carrier", code: "synthetic" },
    prices: [{ currency_code: "usd", amount: 5 }, { region_id: region.id, amount: 5 }],
    rules: [{ attribute: "enabled_in_store", operator: "eq", value: "true" },
      { attribute: "is_return", operator: "eq", value: "false" }],
  }] });
  const shipping = options[0];
  const { result: products } = await createProductsWorkflow(container).run({ input: { products: [{
    title: `Rifare synthetic product ${suffix}`, status: ProductStatus.PUBLISHED,
    shipping_profile_id: profile.id, sales_channels: [{ id: channel.id }],
    options: [{ title: "Size", values: ["One"] }],
    variants: [{ title: "One", sku: `rifare-test-${suffix}`, manage_inventory: true, allow_backorder: false,
      options: { Size: "One" }, prices: [{ currency_code: "usd", amount: 12.5 }] }],
  }] } });
  const variant = products[0].variants[0];
  const variantGraph = await graph("product_variant", variant.id, ["id", "inventory_items.inventory_item_id"]);
  const inventoryId = variantGraph.inventory_items[0].inventory_item_id;
  await createInventoryLevelsWorkflow(container).run({ input: { inventory_levels: [{
    inventory_item_id: inventoryId, location_id: location.id, stocked_quantity: 5,
  }] } });
  const level = async () => (await inventory.listInventoryLevels({ inventory_item_id: inventoryId, location_id: location.id }))[0];
  check("postgres-inventory-owned-by-medusa", () => assert.ok(inventoryId));

  const { result: keys } = await createApiKeysWorkflow(container).run({ input: { api_keys: [{
    title: `Rifare synthetic ${suffix}`, type: "publishable", created_by: "rifare-local-verification",
  }] } });
  await linkSalesChannelsToApiKeyWorkflow(container).run({ input: { id: keys[0].id, add: [channel.id] } });
  const cartInput = {
    region_id: region.id, sales_channel_id: channel.id, email: `synthetic-${suffix}@example.invalid`,
    shipping_address: { first_name: "Synthetic", last_name: "Fixture", address_1: "1 Synthetic Street",
      city: "Denver", country_code: "us", postal_code: "80201" },
    items: [{ variant_id: variant.id, quantity: 2 }],
  };
  const { result: createdCart } = await createCartWorkflow(container).run({ input: cartInput });
  const cartFields = ["id", "completed_at", "currency_code", "item_subtotal", "shipping_subtotal", "discount_subtotal", "discount_total",
    "tax_total", "total", "items.*", "shipping_methods.*", "payment_collection.*"];
  let cart = await graph("cart", createdCart.id, cartFields);
  check("major-unit-prices-and-native-cart-totals", () => {
    assert.equal(Number(cart.items[0].unit_price), 12.5);
    assert.equal(Number(cart.item_subtotal), 25);
    assert.equal(Number(cart.tax_total), 2.5);
    assert.equal(Number(cart.total), 27.5);
    assert.equal(cart.completed_at, null);
  });
  const before = await level();
  check("cart-preparation-is-not-an-order-or-reservation", () => {
    assert.equal(Number(before.stocked_quantity), 5);
    assert.equal(Number(before.reserved_quantity), 0);
  });
  const promoCode = `RIFARE-${suffix}`;
  await createPromotionsWorkflow(container).run({ input: { promotionsData: [{
    code: promoCode, type: "standard", status: "active", is_automatic: false,
    application_method: { type: "percentage", target_type: "items", allocation: "across", value: 10, currency_code: "usd" },
  }] } });
  await updateCartPromotionsWorkflow(container).run({ input: { cart_id: cart.id, promo_codes: [promoCode], action: PromotionActions.ADD } });
  await addShippingMethodToCartWorkflow(container).run({ input: { cart_id: cart.id, options: [{ id: shipping.id }] } });
  cart = await graph("cart", cart.id, cartFields);
  check("native-promotion-shipping-and-tax-workflows", () => {
    assert.equal(Number(cart.item_subtotal), 25); assert.equal(Number(cart.discount_subtotal), 2.5);
    assert.equal(Number(cart.discount_total), 2.75); // Includes the 0.25 tax reduction.
    assert.equal(Number(cart.shipping_subtotal), 5); assert.equal(Number(cart.tax_total), 2.75);
    assert.equal(Number(cart.total), 30.25);
  });
  await assert.rejects(createCartWorkflow(container).run({ input: { ...cartInput, items: [{ variant_id: variant.id, quantity: 6 }] } }),
    (error: any) => {
      assert.equal(error.type, "not_allowed");
      assert.equal(error.code, "insufficient_inventory");
      return true;
    });
  checks.push("upstream-insufficient-inventory-rejection");

  // Make a complete, payable synthetic cart before exercising the public guard.
  // Removing that guard must reach a real native order effect, not just a missing-payment error.
  const { result: paymentCollection } = await createPaymentCollectionForCartWorkflow(container).run({ input: { cart_id: cart.id } });
  await createPaymentSessionsWorkflow(container).run({ input: { payment_collection_id: paymentCollection.id, provider_id: "pp_system_default" } });

  const server = spawn(process.execPath, ["run.mjs", "start", "--port", "19035"], {
    cwd: process.cwd(), env: { ...process.env, NODE_ENV: "test", DISABLE_MEDUSA_ADMIN: "true" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverLog = "";
  for (const stream of [server.stdout, server.stderr]) stream.on("data", (chunk) => { serverLog = (serverLog + chunk).slice(-16000); });
  const serverExit = new Promise<void>((resolve) => server.once("exit", () => resolve()));
  const origin = "http://127.0.0.1:19035";
  const request = async (path: string, method = "GET", body?: unknown) => {
    const response = await fetch(origin + path, { method, redirect: "error", signal: AbortSignal.timeout(10000),
      headers: { "content-type": "application/json", "x-publishable-api-key": keys[0].token },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const value = await response.json(); return { status: response.status, value };
  };
  try {
    const deadline = Date.now() + 45000;
    let healthy = false;
    while (Date.now() < deadline && server.exitCode === null) {
      try { healthy = (await fetch(origin + "/health", { signal: AbortSignal.timeout(1000) })).ok; } catch { /* startup */ }
      if (healthy) break; await delay(100);
    }
    assert.ok(healthy, `Local Medusa HTTP startup failed: ${serverLog}`);
    const read = await request(`/store/carts/${cart.id}`);
    check("real-store-api-reads-same-postgres-cart", () => {
      assert.equal(read.status, 200); assert.equal(read.value.cart.id, cart.id);
      assert.equal(read.value.cart.total, 30.25);
    });
    const poisoned = await request(`/store/carts/${cart.id}/line-items`, "POST",
      { variant_id: variant.id, quantity: 1, unit_price: 0.01 });
    const afterPoison = await request(`/store/carts/${cart.id}`);
    check("store-api-rejects-caller-supplied-prices", () => {
      assert.equal(poisoned.status, 400); assert.equal(afterPoison.value.cart.total, 30.25);
    });
    for (const [path, method, body] of [
      [`/store/carts/${cart.id}/complete`, "POST", {}],
      ["/store/payment-collections", "POST", { cart_id: cart.id }],
      ["/store/returns", "POST", { order_id: "order_unverified", items: [] }],
      ["/store/orders/order_unverified", "GET", undefined],
      ["/store/orders/order_unverified/transfer/accept", "POST", { token: "unverified" }],
      ["/hooks/payment/system_default", "POST", {}],
    ] as const) {
      const response = await request(path, method, body);
      assert.equal(response.status, 503, `${path}; native_order_present=${!!response.value.order?.id}`);
      assert.equal(response.value.code, "RIFARE_COMMERCE_IDENTITY_NOT_CONNECTED", path);
    }
    checks.push("public-checkout-return-order-transfer-and-payment-hooks-held");
    cart = await graph("cart", cart.id, cartFields);
    check("denied-public-completion-does-not-create-order", () => assert.equal(cart.completed_at, null));

    // This is trusted test setup exercising the upstream engine, not an exposed checkout route.
    const { result: completed } = await completeCartWorkflow(container).run({ input: { id: cart.id } });
    const orderFields = ["id", "status", "total", "items.*", "payment_collections.payments.*"];
    const order = await graph("order", completed.id, orderFields);
    const reserved = await level();
    check("native-cart-completion-creates-one-order-and-reservation", () => {
      assert.equal(Number(order.total), 30.25); assert.equal(Number(order.items[0].quantity), 2);
      assert.equal(Number(reserved.stocked_quantity), 5); assert.equal(Number(reserved.reserved_quantity), 2);
    });
    const repeated = await completeCartWorkflow(container).run({ input: { id: cart.id } });
    check("same-cart-recovery-retains-original-order", () => assert.equal(repeated.result.id, order.id));
    const paymentId = order.payment_collections[0].payments[0].id;
    await capturePaymentWorkflow(container).run({ input: { payment_id: paymentId } });
    await createOrderFulfillmentWorkflow(container).run({ input: { order_id: order.id, location_id: location.id,
      shipping_option_id: shipping.id, items: [{ id: order.items[0].id, quantity: 2 }], no_notification: true } });
    const fulfilled = await level();
    check("upstream-fulfillment-consumes-reservation-and-stock", () => {
      assert.equal(Number(fulfilled.stocked_quantity), 3); assert.equal(Number(fulfilled.reserved_quantity), 0);
    });
    const { result: change } = await beginReturnOrderWorkflow(container).run({ input: { order_id: order.id, location_id: location.id } });
    assert.ok(change.return_id);
    await requestItemReturnWorkflow(container).run({ input: { return_id: change.return_id!, items: [{ id: order.items[0].id, quantity: 1 }] } });
    await confirmReturnRequestWorkflow(container).run({ input: { return_id: change.return_id! } });
    await beginReceiveReturnWorkflow(container).run({ input: { return_id: change.return_id! } });
    await receiveItemReturnRequestWorkflow(container).run({ input: {
      return_id: change.return_id!, items: [{ id: order.items[0].id, quantity: 1 }],
    } });
    const { result: received } = await confirmReturnReceiveWorkflow(container).run({ input: { return_id: change.return_id! } });
    const returned = await level();
    check("native-return-receiving-restocks-only-received-unit", () => {
      assert.ok(received); assert.equal(Number(returned.stocked_quantity), 4);
      assert.equal(Number(returned.reserved_quantity), 0);
    });
    await refundPaymentWorkflow(container).run({ input: { payment_id: paymentId, amount: 5,
      idempotency_key: `rifare-synthetic-refund-${suffix}` } });
    const refunded = await container.resolve(Modules.PAYMENT).retrievePayment(paymentId, { relations: ["refunds"] });
    check("manual-provider-partial-refund-recorded-upstream", () => {
      assert.equal(refunded.refunds?.length, 1);
      assert.equal(Number(refunded.refunds![0].amount), 5);
    });
    const privateRead = await request(`/store/orders/${order.id}`);
    const adminRead = await request(`/admin/orders/${order.id}`);
    check("order-data-not-exposed-by-public-id-or-unauthenticated-admin", () => {
      assert.equal(privateRead.status, 503); assert.equal(adminRead.status, 401);
    });
    // A second cart proves cancellation releases its own reservation.
    const second = await createCartWorkflow(container).run({ input: { ...cartInput, items: [{ variant_id: variant.id, quantity: 1 }] } });
    await addShippingMethodToCartWorkflow(container).run({ input: { cart_id: second.result.id, options: [{ id: shipping.id }] } });
    const collection2 = await createPaymentCollectionForCartWorkflow(container).run({ input: { cart_id: second.result.id } });
    await createPaymentSessionsWorkflow(container).run({ input: { payment_collection_id: collection2.result.id, provider_id: "pp_system_default" } });
    const secondOrder = await completeCartWorkflow(container).run({ input: { id: second.result.id } });
    await cancelOrderWorkflow(container).run({ input: { order_id: secondOrder.result.id, no_notification: true } });
    const canceled = await graph("order", secondOrder.result.id, ["id", "status"]);
    const finalStock = await level();
    check("upstream-cancellation-releases-original-reservation", () => {
      assert.equal(canceled.status, "canceled"); assert.equal(Number(finalStock.stocked_quantity), 4);
      assert.equal(Number(finalStock.reserved_quantity), 0);
    });
    console.log("RIFARE_MEDUSA_RESULT=" + JSON.stringify({ result: "pass", medusa: "2.23.0",
      database: "PostgreSQL", payment_provider: "pp_system_default", checks,
      actual_financial_or_physical_effects: false, elevenid_connected: false, production_qualified: false }));
  } finally {
    if (server.exitCode === null) server.kill("SIGTERM");
    const stopDeadline = setTimeout(() => server.kill("SIGKILL"), 10000);
    await serverExit; clearTimeout(stopDeadline);
  }
}
