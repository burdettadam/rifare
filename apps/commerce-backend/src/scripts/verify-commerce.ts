import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import type { ExecArgs } from "@medusajs/framework/types";
import { MedusaModule } from "@medusajs/framework/modules-sdk";
import { ContainerRegistrationKeys, MathBN, MedusaError, Modules, ProductStatus, PromotionActions } from "@medusajs/framework/utils";
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk";
import {
  acquireLockStep, addShippingMethodToCartWorkflow, beginExchangeOrderWorkflow, beginOrderEditOrderWorkflow, beginReturnOrderWorkflow,
  beginReceiveReturnWorkflow,
  cancelOrderWorkflow, capturePaymentWorkflow, completeCartWorkflow, confirmExchangeRequestWorkflow,
  confirmOrderEditRequestWorkflow, confirmReturnRequestWorkflow, confirmReturnReceiveWorkflow, createExchangeShippingMethodWorkflow,
  createApiKeysWorkflow, createCartWorkflow, createInventoryLevelsWorkflow,
  createOrderFulfillmentWorkflow, createPaymentCollectionForCartWorkflow,
  createPaymentSessionsWorkflow, createProductsWorkflow, createPromotionsWorkflow,
  createRegionsWorkflow, createSalesChannelsWorkflow, createShippingOptionsWorkflow,
  createShippingProfilesWorkflow, createStockLocationsWorkflow, createTaxRegionsWorkflow,
  linkSalesChannelsToApiKeyWorkflow, linkSalesChannelsToStockLocationWorkflow,
  orderEditAddNewItemWorkflow, orderEditUpdateItemQuantityWorkflow, orderExchangeAddNewItemWorkflow,
  orderExchangeRequestItemReturnWorkflow,
  receiveItemReturnRequestWorkflow, refundPaymentWorkflow, releaseLockStep, requestItemReturnWorkflow,
  requestOrderEditRequestWorkflow, updateCartPromotionsWorkflow, updateLineItemInCartWorkflow, updateStoresWorkflow,
} from "@medusajs/medusa/core-flows";

/** Creates only synthetic records in an explicitly selected disposable local DB.
 * All commerce behavior below comes from upstream workflows/APIs, not a second engine.
 */
export default async function verifyCommerce({ container }: ExecArgs) {
  if (process.env.NODE_ENV !== "test" || process.env.RIFARE_COMMERCE_VERIFY !== "disposable") {
    throw new Error("RIFARE_DISPOSABLE_COMMERCE_TEST_REQUIRED");
  }
  const { RIFARE_TEST_LOCK_CART, RIFARE_TEST_LOCK_LINE, RIFARE_TEST_LOCK_ACTION, RIFARE_TEST_LOCK_OWNER } = process.env;
  if (RIFARE_TEST_LOCK_CART || RIFARE_TEST_LOCK_LINE) {
    assert.ok(RIFARE_TEST_LOCK_CART);
    if (RIFARE_TEST_LOCK_ACTION === "acquire") {
      assert.equal(process.env.RIFARE_TEST_CHECKOUT_LOCK, "redis");
      assert.ok(RIFARE_TEST_LOCK_OWNER);
      await container.resolve(Modules.LOCKING).acquire(RIFARE_TEST_LOCK_CART, {
        ownerId: RIFARE_TEST_LOCK_OWNER, expire: 60,
      });
      console.log("RIFARE_CART_LOCK_CONTENDER=" + JSON.stringify({ pid: process.pid, acquired: true }));
      return;
    }
    if (RIFARE_TEST_LOCK_ACTION === "release") {
      const released = await container.resolve(Modules.LOCKING).release(RIFARE_TEST_LOCK_CART);
      console.log("RIFARE_CART_LOCK_CONTENDER=" + JSON.stringify({ pid: process.pid, released }));
      return;
    }
    assert.equal(RIFARE_TEST_LOCK_ACTION, "update");
    assert.ok(RIFARE_TEST_LOCK_LINE);
    const result = await updateLineItemInCartWorkflow(container).run({
      input: { cart_id: RIFARE_TEST_LOCK_CART, item_id: RIFARE_TEST_LOCK_LINE, update: { quantity: 2 } },
      throwOnError: false,
    });
    console.log("RIFARE_CART_LOCK_CONTENDER=" + JSON.stringify({
      pid: process.pid, error: result.errors[0]?.error?.message ?? null,
    }));
    return;
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

    // The first order has one fulfilled unit left to return after the partial return above.
    const orderService = container.resolve(Modules.ORDER);
    const { result: requestedExchange } = await beginExchangeOrderWorkflow(container).run({ input: { order_id: order.id } });
    assert.ok(requestedExchange.exchange_id);
    const exchangeId = requestedExchange.exchange_id;
    const draftExchange = await orderService.retrieveOrderExchange(exchangeId);
    const { result: inbound } = await orderExchangeRequestItemReturnWorkflow(container).run({ input: {
      exchange_id: exchangeId,
      // In 2.23 the type requires a string, but the workflow creates a return from the exchange.
      return_id: draftExchange.return_id ?? "",
      location_id: location.id,
      items: [{ id: order.items[0].id, quantity: 1 }],
    } });
    const exchangeReturnId = inbound.order_change.return_id;
    assert.ok(exchangeReturnId);
    await orderExchangeAddNewItemWorkflow(container).run({ input: {
      exchange_id: exchangeId, items: [{ variant_id: variant.id, quantity: 1 }],
    } });
    await createExchangeShippingMethodWorkflow(container).run({ input: {
      exchange_id: exchangeId, shipping_option_id: shipping.id,
    } });
    const draftStock = await level();
    check("native-exchange-draft-does-not-reserve-or-restock", () => {
      assert.equal(Number(draftStock.stocked_quantity), 4);
      assert.equal(Number(draftStock.reserved_quantity), 0);
    });

    await confirmExchangeRequestWorkflow(container).run({ input: { exchange_id: exchangeId } });
    const exchange = await orderService.retrieveOrderExchange(exchangeId, { relations: ["additional_items"] });
    const confirmedStock = await level();
    check("native-exchange-confirms-one-outbound-reservation-on-the-original-order", () => {
      assert.equal(exchange.order_id, order.id);
      assert.equal(exchange.return_id, exchangeReturnId);
      assert.equal(exchange.additional_items.length, 1);
      assert.equal(Number(exchange.additional_items[0].quantity), 1);
      assert.equal(Number(confirmedStock.stocked_quantity), 4);
      assert.equal(Number(confirmedStock.reserved_quantity), 1);
    });

    await beginReceiveReturnWorkflow(container).run({ input: { return_id: exchangeReturnId } });
    await receiveItemReturnRequestWorkflow(container).run({ input: {
      return_id: exchangeReturnId, items: [{ id: order.items[0].id, quantity: 1 }],
    } });
    await confirmReturnReceiveWorkflow(container).run({ input: { return_id: exchangeReturnId } });
    const exchangeReceived = await level();
    check("native-exchange-receipt-restocks-only-the-returned-unit", () => {
      assert.equal(Number(exchangeReceived.stocked_quantity), 5);
      assert.equal(Number(exchangeReceived.reserved_quantity), 1);
    });

    const { result: replacements } = await createProductsWorkflow(container).run({ input: { products: [{
      title: `Rifare synthetic replacement ${suffix}`, status: ProductStatus.PUBLISHED,
      shipping_profile_id: profile.id, sales_channels: [{ id: channel.id }],
      options: [{ title: "Size", values: ["One"] }],
      variants: [{ title: "Replacement", sku: `rifare-replacement-${suffix}`, manage_inventory: true,
        allow_backorder: false, options: { Size: "One" }, prices: [{ currency_code: "usd", amount: 12.5 }] }],
    }] } });
    const replacementId = replacements[0].variants[0].id;
    const replacementGraph = await graph("product_variant", replacementId, ["inventory_items.inventory_item_id"]);
    const replacementInventoryId = replacementGraph.inventory_items[0].inventory_item_id;
    await createInventoryLevelsWorkflow(container).run({ input: { inventory_levels: [{
      inventory_item_id: replacementInventoryId, location_id: location.id, stocked_quantity: 3,
    }] } });
    const replacementLevel = async () => (await inventory.listInventoryLevels({
      inventory_item_id: replacementInventoryId, location_id: location.id,
    }))[0];

    const { result: editCart } = await createCartWorkflow(container).run({
      input: { ...cartInput, items: [{ variant_id: variant.id, quantity: 1 }] },
    });
    await addShippingMethodToCartWorkflow(container).run({ input: { cart_id: editCart.id, options: [{ id: shipping.id }] } });
    const { result: editCollection } = await createPaymentCollectionForCartWorkflow(container).run({ input: { cart_id: editCart.id } });
    await createPaymentSessionsWorkflow(container).run({
      input: { payment_collection_id: editCollection.id, provider_id: "pp_system_default" },
    });
    const { result: editOrder } = await completeCartWorkflow(container).run({ input: { id: editCart.id } });
    const editSource = await graph("order", editOrder.id, orderFields);
    const editPaymentId = editSource.payment_collections[0].payments[0].id;
    await capturePaymentWorkflow(container).run({ input: { payment_id: editPaymentId } });
    await beginOrderEditOrderWorkflow(container).run({ input: { order_id: editOrder.id } });
    await orderEditUpdateItemQuantityWorkflow(container).run({ input: {
      order_id: editOrder.id, items: [{ id: editSource.items[0].id, quantity: 0 }],
    } });
    await orderEditAddNewItemWorkflow(container).run({ input: {
      order_id: editOrder.id, items: [{ variant_id: replacementId, quantity: 1 }],
    } });
    await requestOrderEditRequestWorkflow(container).run({ input: { order_id: editOrder.id } });
    const pendingEdit = await graph("order", editOrder.id, orderFields);
    const pendingOriginalLevel = await level();
    const pendingReplacementLevel = await replacementLevel();
    check("native-order-edit-request-keeps-original-order-and-reservation", () => {
      assert.deepEqual(pendingEdit.items.map(item => item.variant_id), [variant.id]);
      assert.equal(Number(pendingOriginalLevel.reserved_quantity), 2);
      assert.equal(Number(pendingReplacementLevel.reserved_quantity), 0);
    });
    await confirmOrderEditRequestWorkflow(container).run({ input: { order_id: editOrder.id } });
    const edited = await graph("order", editOrder.id, orderFields);
    const editedOriginalLevel = await level();
    const editedReplacementLevel = await replacementLevel();
    check("native-equal-price-order-edit-swaps-only-the-order-line-and-reservation", () => {
      assert.equal(edited.id, editOrder.id);
      const activeItems = edited.items.filter(item => Number(item.quantity) > 0);
      assert.deepEqual(activeItems.map(item => [item.variant_id, Number(item.quantity)]), [[replacementId, 1]]);
      assert.equal(Number(edited.total), Number(editSource.total));
      const payments = edited.payment_collections.flatMap(collection => collection.payments);
      assert.deepEqual(payments.map(payment => payment.id), [editPaymentId]);
      assert.equal(Number(editedOriginalLevel.stocked_quantity), 5);
      assert.equal(Number(editedOriginalLevel.reserved_quantity), 1);
      assert.equal(Number(editedReplacementLevel.stocked_quantity), 3);
      assert.equal(Number(editedReplacementLevel.reserved_quantity), 1);
    });

    // This disposable witness checks compensation ordering. It does not add a checkout hook
    // to the application or enable any protected route.
    const createPaymentCart = async () => {
      const { result: fixtureCart } = await createCartWorkflow(container).run({
        input: { ...cartInput, items: [{ variant_id: variant.id, quantity: 1 }] },
      });
      await addShippingMethodToCartWorkflow(container).run({
        input: { cart_id: fixtureCart.id, options: [{ id: shipping.id }] },
      });
      const { result: collection } = await createPaymentCollectionForCartWorkflow(container).run({
        input: { cart_id: fixtureCart.id },
      });
      const { result: session } = await createPaymentSessionsWorkflow(container).run({
        input: { payment_collection_id: collection.id, provider_id: "pp_system_default" },
      });
      return { fixtureCart, session };
    };
    const { fixtureCart: staleCart, session: staleSession } = await createPaymentCart();
    const payments = container.resolve(Modules.PAYMENT);
    const capturedOriginal = await payments.authorizePaymentSession(staleSession.id, {});
    assert.ok(capturedOriginal);
    await capturePaymentWorkflow(container).run({ input: { payment_id: capturedOriginal.id } });
    const paymentBeforeRefusal = await payments.retrievePayment(capturedOriginal.id, { relations: ["refunds"] });
    assert.ok(paymentBeforeRefusal.captured_at);
    assert.equal(paymentBeforeRefusal.refunds?.length, 0);
    const beforeQuantityChange = await graph("cart", staleCart.id, ["id", "total", "items.*"]);
    assert.ok(MathBN.eq(beforeQuantityChange.total, staleSession.amount));
    // Simulate a cart change for which the stored payment session was not refreshed.
    await container.resolve(Modules.CART).updateLineItems(beforeQuantityChange.items[0].id, { quantity: 2 });
    const afterQuantityChange = await graph("cart", staleCart.id, ["id", "total"]);
    assert.ok(MathBN.gt(afterQuantityChange.total, staleSession.amount));

    const runContender = async (
      cartId: string, action: "update" | "release" | "acquire", lineId = "", ownerId = "",
    ) => {
      const { stdout } = await promisify(execFile)(process.execPath, [
        "run.mjs", "exec", `./src/scripts/${basename(__filename)}`,
      ], {
        env: { ...process.env, RIFARE_TEST_LOCK_CART: cartId, RIFARE_TEST_LOCK_LINE: lineId,
          RIFARE_TEST_LOCK_ACTION: action, RIFARE_TEST_LOCK_OWNER: ownerId },
        timeout: 45000,
      });
      const prefix = "RIFARE_CART_LOCK_CONTENDER=";
      const line = stdout.split(/\r?\n/).find(value => value.startsWith(prefix));
      assert.ok(line);
      const outcome = JSON.parse(line.slice(prefix.length));
      assert.notEqual(outcome.pid, process.pid);
      return outcome;
    };
    type PaymentFixtureInput = {
      cartId: string; paymentSessionId: string; ownerId: string; ttl: number; successor?: string;
    };
    const checkPaymentBeforeCompletion = createStep("rifare-fixture-check-payment-before-completion",
      async ({ cartId, paymentSessionId, successor }: PaymentFixtureInput, { container: context }) => {
        const { data: [current] } = await context.resolve(ContainerRegistrationKeys.QUERY).graph({
          entity: "cart", filters: { id: cartId },
          fields: ["total", "currency_code", "payment_collection.payment_sessions.id",
            "payment_collection.payment_sessions.amount", "payment_collection.payment_sessions.currency_code"],
        });
        const sessions = current?.payment_collection?.payment_sessions;
        const session = sessions?.length === 1 ? sessions[0] : undefined;
        if (!current || !session || session.id !== paymentSessionId ||
            current.currency_code !== session.currency_code || !MathBN.eq(current.total, session.amount)) {
          throw new MedusaError(MedusaError.Types.INVALID_DATA, "Fixture payment failed entry validation");
        }
        if (successor) {
          // Pause the original worker after validation until a different process owns the expired key.
          await delay(1200);
          const contender = await runContender(cartId, "acquire", "", successor);
          assert.equal(contender.acquired, true);
        }
        return new StepResponse();
      });
    const completionWithEntryCheck = createWorkflow("rifare-fixture-completion-with-entry-check", (input: PaymentFixtureInput) => {
      acquireLockStep({ key: input.cartId, ownerId: input.ownerId, timeout: 10, ttl: input.ttl });
      checkPaymentBeforeCompletion(input);
      const result = completeCartWorkflow.runAsStep({ input: { id: input.cartId } });
      releaseLockStep({ key: input.cartId, ownerId: input.ownerId });
      return new WorkflowResponse(result);
    });
    const beforeEntry = await completionWithEntryCheck(container).run({
      input: { cartId: staleCart.id, paymentSessionId: staleSession.id, ownerId: randomUUID(), ttl: 60 }, throwOnError: false,
    });
    assert.equal(beforeEntry.errors[0]?.error?.message, "Fixture payment failed entry validation");
    const rejectedAtEntry = await graph("cart", staleCart.id, ["id", "completed_at"]);
    const paymentAfterEntryCheck = await payments.retrievePayment(capturedOriginal.id, { relations: ["refunds"] });
    check("native-entry-validation-refuses-stale-payment-before-compensation", () => {
      assert.equal(rejectedAtEntry.completed_at, null);
      assert.equal(paymentAfterEntryCheck.refunds?.length, 0);
    });
    const { fixtureCart: matchingCart, session: matchingSession } = await createPaymentCart();
    const { result: matchingOrder } = await completionWithEntryCheck(container).run({
      input: { cartId: matchingCart.id, paymentSessionId: matchingSession.id, ownerId: randomUUID(), ttl: 60 },
    });
    const matched = await graph("order", matchingOrder.id, orderFields);
    check("native-entry-validation-allows-matching-synthetic-payment", () => {
      assert.ok(MathBN.eq(matched.total, matchingSession.amount));
      assert.ok(MathBN.eq(matched.payment_collections[0].payments[0].amount, matchingSession.amount));
    });

    const checkoutLockProvider = process.env.RIFARE_TEST_CHECKOUT_LOCK;
    if (checkoutLockProvider === "postgres" || checkoutLockProvider === "redis") {
      const { fixtureCart: sharedCart } = await createPaymentCart();
      const { items: [sharedLine] } = await graph("cart", sharedCart.id, ["items.*"]);
      const locking = container.resolve(Modules.LOCKING);
      const postgres = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
      const ownerId = randomUUID();
      const updateSharedCart = () => runContender(sharedCart.id, "update", sharedLine.id);
      await locking.acquire(sharedCart.id, { ownerId, expire: 60 });
      try {
        const blocked = await updateSharedCart();
        assert.equal(typeof blocked.error, "string", "A separate Medusa process must reject the held cart lock");
        assert.match(blocked.error, /locked|failed to acquire lock/i);
        const lockedCart = await graph("cart", sharedCart.id, ["items.*"]);
        assert.equal(Number(lockedCart.items[0].quantity), 1);
        check(`native-${checkoutLockProvider}-cart-lock-fences-another-process-while-held`, () => {});
      } finally {
        await locking.release(sharedCart.id, { ownerId });
      }
      await locking.acquire(sharedCart.id, { ownerId, expire: 1 });
      if (checkoutLockProvider === "postgres") {
        try {
          await postgres.raw("select pg_sleep(1.1)");
          const row = await postgres("locking").where({ id: sharedCart.id })
            .first(postgres.raw("expiration <= now() as expired"));
          assert.equal(row?.expired, true);
          const expired = await updateSharedCart();
          assert.match(expired.error, /locked|failed to acquire lock/i);
          check("native-postgres-cart-lock-does-not-reclaim-another-owners-expired-lease", () => {});
        } finally {
          await locking.release(sharedCart.id, { ownerId });
        }
      } else {
        const successor = randomUUID();
        await delay(1200);
        await locking.acquire(sharedCart.id, { ownerId: successor, expire: 60 });
        try {
          assert.equal(await locking.release(sharedCart.id, { ownerId }), false);
          const blockedSuccessor = await updateSharedCart();
          assert.match(blockedSuccessor.error, /locked|failed to acquire lock/i);
          check("native-redis-cart-lock-reclaims-expiry-and-rejects-stale-named-release", () => {});
        } finally {
          await locking.release(sharedCart.id, { ownerId: successor });
        }

        // Medusa's native workflow steps omit ownerId and therefore share one Redis owner value.
        await locking.acquire(sharedCart.id, { expire: 1 });
        await delay(1200);
        await locking.acquire(sharedCart.id, { expire: 60 });
        try {
          const unownedRelease = await runContender(sharedCart.id, "release");
          assert.equal(unownedRelease.released, true);
          check("native-redis-ownerless-release-removes-the-successor-lock", () => {});
        } finally {
          await locking.release(sharedCart.id);
        }
      }
      const released = await updateSharedCart();
      assert.equal(released.error, null);
      const changedCart = await graph("cart", sharedCart.id, ["items.*"]);
      check(`native-${checkoutLockProvider}-cart-lock-allows-mutation-after-release`, () => {
        assert.equal(Number(changedCart.items[0].quantity), 2);
      });
    }

    if (checkoutLockProvider === "redis") {
      const { fixtureCart: expiringCart, session } = await createPaymentCart();
      const successor = randomUUID();
      const locking = container.resolve(Modules.LOCKING);
      const inventoryBefore = await level();
      try {
        const { result: lateOrder } = await completionWithEntryCheck(container).run({
          input: { cartId: expiringCart.id, paymentSessionId: session.id, ownerId: randomUUID(), ttl: 1, successor },
        });
        const completed = await graph("cart", expiringCart.id, ["completed_at"]);
        const order = await graph("order", lateOrder.id, orderFields);
        const authorized = await payments.retrievePaymentSession(session.id);
        const inventoryAfter = await level();
        const stillHeldBySuccessor = await locking.release(expiringCart.id, { ownerId: successor });
        check("native-redis-expired-wrapper-still-writes-checkout-effects-under-successor-lock", () => {
          assert.equal(stillHeldBySuccessor, true);
          assert.ok(completed.completed_at);
          assert.equal(order.items[0].variant_id, variant.id);
          assert.equal(authorized.status, "authorized");
          assert.ok(MathBN.eq(order.payment_collections[0].payments[0].amount, session.amount));
          assert.equal(Number(inventoryAfter.reserved_quantity), Number(inventoryBefore.reserved_quantity) + 1);
        });
      } finally {
        await locking.release(expiringCart.id, { ownerId: successor });
      }
    }

    completeCartWorkflow.hooks.validate(({ input, cart: checkoutCart }) => {
      if (input.id === staleCart.id) {
        const sessions = checkoutCart.payment_collection?.payment_sessions;
        if (sessions?.length !== 1 || sessions[0].id !== staleSession.id ||
            !MathBN.eq(checkoutCart.total, sessions[0].amount)) {
          throw new MedusaError(MedusaError.Types.INVALID_DATA, "Fixture payment amount does not match the cart");
        }
      }
      return new StepResponse();
    });
    const refused = await completeCartWorkflow(container).run({ input: { id: staleCart.id }, throwOnError: false });
    assert.equal(refused.errors[0]?.error?.message, "Fixture payment amount does not match the cart");
    const afterRefusal = await graph("cart", staleCart.id, ["id", "completed_at"]);
    const { data: unexpectedOrder } = await query.graph({
      entity: "order_cart", fields: ["order_id"], filters: { cart_id: staleCart.id },
    });
    const paymentAfterRefusal = await payments.retrievePayment(capturedOriginal.id, { relations: ["refunds"] });
    check("native-checkout-validation-refuses-order-but-can-refund-a-prior-capture", () => {
      assert.equal(afterRefusal.completed_at, null);
      assert.equal(unexpectedOrder.length, 0);
      assert.equal(paymentAfterRefusal.refunds?.length, 1);
      assert.ok(MathBN.eq(paymentAfterRefusal.refunds![0].amount, capturedOriginal.amount));
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
