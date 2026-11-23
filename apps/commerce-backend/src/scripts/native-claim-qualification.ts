import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ContainerRegistrationKeys, Modules, ProductStatus } from "@medusajs/framework/utils";
import {
  addShippingMethodToCartWorkflow, beginClaimOrderWorkflow, beginReceiveReturnWorkflow, cancelBeginOrderClaimWorkflow,
  cancelOrderClaimWorkflow, cancelOrderWorkflow, capturePaymentWorkflow, completeCartWorkflow,
  confirmClaimRequestWorkflow, confirmReturnReceiveWorkflow, createCartWorkflow, createClaimShippingMethodWorkflow,
  createInventoryLevelsWorkflow, createOrderFulfillmentWorkflow, createPaymentCollectionForCartWorkflow,
  createPaymentSessionsWorkflow, createProductsWorkflow, createShippingOptionsWorkflow, orderClaimAddNewItemWorkflow, orderClaimItemWorkflow,
  orderClaimRequestItemReturnWorkflow, receiveItemReturnRequestWorkflow, refundPaymentWorkflow,
} from "@medusajs/medusa/core-flows";

/** Ordinary upstream claims only; no application route, external provider or settlement. */
export async function qualifyNativeClaims(container: any, fixture: {
  profileId: string; channelId: string; shippingId: string; locationId: string; serviceZoneId: string; regionId: string; cartInput: object;
}, check: (name: string, assertions: () => void) => void) {
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.RIFARE_COMMERCE_VERIFY, "disposable");
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const postgres = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const orders = container.resolve(Modules.ORDER);
  const inventory = container.resolve(Modules.INVENTORY);
  const graph = async (entity: string, id: string, fields: string[]) => {
    const { data } = await query.graph({ entity, fields, filters: { id } });
    assert.equal(data.length, 1); return data[0];
  };
  const rows = async (tables: string[]) => {
    const result: Record<string, unknown> = {};
    for (const table of tables) result[table] = await postgres(table).select("*").orderBy("id");
    return result;
  };
  const financial = () => rows(["payment", "capture", "refund"]);
  const effects = () => rows(["payment", "capture", "refund", "order", "order_item", "order_line_item",
    "order_claim", "order_claim_item", "order_change", "order_change_action", "reservation_item", "inventory_level",
    "payment_collection", "payment_session", "order_transaction", "order_credit_line", "order_summary",
    "return", "return_item", "return_fulfillment", "fulfillment", "fulfillment_item", "order_fulfillment"]);
  const suffix = randomUUID().replaceAll("-", "");
  const { result: products } = await createProductsWorkflow(container).run({ input: { products: [{
    title: `Rifare native claim ${suffix}`, status: ProductStatus.PUBLISHED,
    shipping_profile_id: fixture.profileId, sales_channels: [{ id: fixture.channelId }],
    options: [{ title: "Size", values: ["One"] }], variants: [{ title: "One", sku: `claim-${suffix}`,
      manage_inventory: true, allow_backorder: false, options: { Size: "One" },
      prices: [{ currency_code: "usd", amount: 12.5 }] }],
  }] } });
  const variant = products[0].variants[0];
  const item = await graph("product_variant", variant.id, ["inventory_items.inventory_item_id"]);
  const inventoryId = item.inventory_items[0].inventory_item_id;
  await createInventoryLevelsWorkflow(container).run({ input: { inventory_levels: [{
    inventory_item_id: inventoryId, location_id: fixture.locationId, stocked_quantity: 10,
  }] } });
  const level = async () => {
    const [value] = await inventory.listInventoryLevels({ inventory_item_id: inventoryId, location_id: fixture.locationId });
    return { stock: Number(value.stocked_quantity), reserved: Number(value.reserved_quantity) };
  };
  const orderFields = ["id", "version", "items.*", "payment_collections.payments.*"];
  const original = async () => {
    const { result: cart } = await createCartWorkflow(container).run({ input: {
      ...fixture.cartInput, items: [{ variant_id: variant.id, quantity: 2 }],
    } });
    await addShippingMethodToCartWorkflow(container).run({ input: { cart_id: cart.id, options: [{ id: fixture.shippingId }] } });
    const { result: collection } = await createPaymentCollectionForCartWorkflow(container).run({ input: { cart_id: cart.id } });
    await createPaymentSessionsWorkflow(container).run({ input: { payment_collection_id: collection.id, provider_id: "pp_system_default" } });
    const { result: result } = await completeCartWorkflow(container).run({ input: { id: cart.id } });
    const order = await graph("order", result.id, orderFields);
    const paymentId = order.payment_collections[0].payments[0].id;
    await capturePaymentWorkflow(container).run({ input: { payment_id: paymentId } });
    await createOrderFulfillmentWorkflow(container).run({ input: { order_id: order.id, location_id: fixture.locationId,
      shipping_option_id: fixture.shippingId, items: [{ id: order.items[0].id, quantity: 2 }], no_notification: true } });
    return { order: await graph("order", order.id, orderFields), paymentId };
  };
  const rejectUnchanged = async (name: string, invoke: () => Promise<unknown>, expression = /cancel|not found/i) => {
    const before = await effects();
    await assert.rejects(invoke, (error: any) => {
      assert.match(error?.message ?? "", expression); return true;
    });
    assert.deepEqual(await effects(), before, `${name}: rejected call changed native effects`);
    check(name, () => {});
  };
  const refundOriginal = await original();
  assert.deepEqual(await level(), { stock: 8, reserved: 0 });
  const originalFinancial = await financial();
  const { result: draft } = await beginClaimOrderWorkflow(container).run({ input: { order_id: refundOriginal.order.id, type: "refund" } });
  assert.ok(draft.claim_id);
  await orderClaimItemWorkflow(container).run({ input: { claim_id: draft.claim_id,
    items: [{ id: refundOriginal.order.items[0].id, quantity: 1, reason: "production_failure" }] } });
  const pending = await graph("order_change", draft.id, ["id", "order_id", "claim_id", "status", "actions.*"]);
  check("native-refund-claim-draft-retains-original-item-and-no-payment-or-stock-effects", () => {
    assert.equal(pending.order_id, refundOriginal.order.id);
    assert.equal(pending.claim_id, draft.claim_id);
    const writes = pending.actions.filter((action: any) => action.action === "WRITE_OFF_ITEM");
    assert.equal(writes.length, 1);
    assert.equal(writes[0].details.reference_id, refundOriginal.order.items[0].id);
    assert.equal(Number(writes[0].details.quantity), 1);
    assert.equal(writes[0].details.reason, "production_failure");
  });
  assert.deepEqual(await level(), { stock: 8, reserved: 0 });
  assert.deepEqual(await financial(), originalFinancial);
  await cancelBeginOrderClaimWorkflow(container).run({ input: { claim_id: draft.claim_id } });
  check("native-draft-claim-cancellation-leaves-original-payment-and-stock", () => {});
  const canceledDraft = await postgres("order_claim").where({ id: draft.claim_id }).first();
  assert.ok(canceledDraft.deleted_at, "Native draft cancellation must soft-delete its claim");
  await assert.rejects(orders.retrieveOrderClaim(draft.claim_id), /not found/i);
  assert.deepEqual(await level(), { stock: 8, reserved: 0 });
  assert.deepEqual(await financial(), originalFinancial);
  await rejectUnchanged("native-canceled-claim-add-refuses-without-effects", () =>
    orderClaimItemWorkflow(container).run({ input: { claim_id: draft.claim_id,
      items: [{ id: refundOriginal.order.items[0].id, quantity: 1, reason: "production_failure" }] } }));
  await rejectUnchanged("native-canceled-claim-confirm-refuses-without-effects", () =>
    confirmClaimRequestWorkflow(container).run({ input: { claim_id: draft.claim_id } }));

  const replacementOriginal = await original();
  assert.deepEqual(await level(), { stock: 6, reserved: 0 });
  const replacementFinancial = await financial();
  const { result: replacement } = await beginClaimOrderWorkflow(container).run({ input: { order_id: replacementOriginal.order.id, type: "replace" } });
  await orderClaimItemWorkflow(container).run({ input: { claim_id: replacement.claim_id!,
    items: [{ id: replacementOriginal.order.items[0].id, quantity: 1, reason: "wrong_item" }] } });
  await orderClaimAddNewItemWorkflow(container).run({ input: { claim_id: replacement.claim_id!, items: [{ variant_id: variant.id, quantity: 1 }] } });
  await createClaimShippingMethodWorkflow(container).run({ input: { claim_id: replacement.claim_id!, shipping_option_id: fixture.shippingId } });
  assert.deepEqual(await level(), { stock: 6, reserved: 0 });
  await confirmClaimRequestWorkflow(container).run({ input: { claim_id: replacement.claim_id! } });
  const confirmed = await orders.retrieveOrderClaim(replacement.claim_id!, { relations: ["claim_items", "additional_items"] });
  const retained = await graph("order", replacementOriginal.order.id, orderFields);
  check("native-replacement-claim-reserves-exactly-one-unit-on-original-paid-order", () => {
    assert.equal(confirmed.order_id, replacementOriginal.order.id);
    assert.equal(confirmed.claim_items.length, 1);
    assert.equal(confirmed.claim_items[0].item_id, replacementOriginal.order.items[0].id);
    assert.equal(Number(confirmed.claim_items[0].quantity), 1);
    assert.equal(confirmed.additional_items.length, 1);
    assert.equal(Number(confirmed.additional_items[0].quantity), 1);
    assert.deepEqual(retained.payment_collections.flatMap((collection: any) => collection.payments.map((payment: any) => payment.id)), [replacementOriginal.paymentId]);
    assert.equal(retained.version, replacementOriginal.order.version + 1);
  });
  assert.deepEqual(await level(), { stock: 6, reserved: 1 }, "Confirmed replacement must reserve exactly one native unit");
  assert.deepEqual(await financial(), replacementFinancial);
  await cancelOrderClaimWorkflow(container).run({ input: { claim_id: replacement.claim_id!, no_notification: true } });
  check("native-confirmed-claim-cancellation-releases-only-replacement-reservation", () => {});
  assert.ok((await orders.retrieveOrderClaim(replacement.claim_id!)).canceled_at);
  assert.deepEqual(await level(), { stock: 6, reserved: 0 }, "Canceled replacement must release its native reservation");
  assert.deepEqual(await financial(), replacementFinancial);

  const { result: adversarial } = await beginClaimOrderWorkflow(container).run({ input: { order_id: refundOriginal.order.id, type: "refund" } });
  await rejectUnchanged("native-claim-foreign-order-item-refuses-without-effects", () =>
    orderClaimItemWorkflow(container).run({ input: { claim_id: adversarial.claim_id!,
      items: [{ id: replacementOriginal.order.items[0].id, quantity: 1 }] } }), /item.*not found/i);
  await rejectUnchanged("native-claim-excess-original-quantity-refuses-without-effects", () =>
    orderClaimItemWorkflow(container).run({ input: { claim_id: adversarial.claim_id!,
      items: [{ id: refundOriginal.order.items[0].id, quantity: 3 }] } }), /more items than what was ordered/i);
  await rejectUnchanged("native-claim-repeated-original-quantity-refuses-without-effects", () =>
    orderClaimItemWorkflow(container).run({ input: { claim_id: adversarial.claim_id!,
      items: [{ id: refundOriginal.order.items[0].id, quantity: 1 }, { id: refundOriginal.order.items[0].id, quantity: 2 }] } }), /more items than what was ordered/i);
  await rejectUnchanged("native-competing-active-claim-refuses-without-effects", () =>
    beginClaimOrderWorkflow(container).run({ input: { order_id: refundOriginal.order.id, type: "replace" } }), /existing active order change/i);
  await cancelBeginOrderClaimWorkflow(container).run({ input: { claim_id: adversarial.claim_id! } });

  // A native workflow error can follow a successful provider effect. Observe the
  // actual System call and bookkeeping; do not infer no-effect from rejection.
  const { result: active } = await beginClaimOrderWorkflow(container).run({ input: { order_id: refundOriginal.order.id, type: "refund" } });
  const payments = container.resolve(Modules.PAYMENT), provider = payments.paymentProviderService_;
  const events = container.resolve(Modules.EVENT_BUS);
  const originalRefund = provider.refundPayment, originalEmit = events.emit;
  let providerCalls = 0, refundEvents = 0;
  const providerArguments: any[] = [];
  provider.refundPayment = async function (...args: any[]) {
    providerCalls++; providerArguments.push({ provider_id: args[0], amount: args[1].amount, key: args[1].context.idempotency_key });
    return originalRefund.apply(this, args);
  };
  events.emit = async function (input: any, ...rest: any[]) {
    for (const event of (Array.isArray(input) ? input : [input])) if (event.name === "payment.refunded") refundEvents++;
    return originalEmit.call(this, input, ...rest);
  };
  const key = `rifare-claim-refund-${suffix}`;
  const refundState = async () => {
    const current = await graph("order", refundOriginal.order.id, ["id", "summary.*", "credit_lines.*"]);
    return { refunds: await postgres("refund").where({ payment_id: refundOriginal.paymentId }).orderBy("id"),
      transactions: await postgres("order_transaction").where({ order_id: refundOriginal.order.id, reference: "refund" }).orderBy("id"),
      credits: current.credit_lines, refunded: Number(current.summary.refunded_total), providerCalls, refundEvents };
  };
  const refundInput = { payment_id: refundOriginal.paymentId, amount: 1, idempotency_key: key };
  const expectRefundError = async (input: typeof refundInput, expression: RegExp) => {
    await assert.rejects(refundPaymentWorkflow(container).run({ input }), (error: any) => {
      assert.match(error?.message ?? "", expression); return true;
    });
  };
  try {
    const baseline = await refundState();
    assert.equal(baseline.refunds.length, 0); assert.equal(baseline.credits.length, 0);
    await expectRefundError(refundInput, /existing active order change/i);
    const first = await refundState();
    const nativePayment = await postgres("payment").where({ id: refundOriginal.paymentId }).first();
    check("native-active-claim-refund-error-can-follow-one-successful-provider-refund", () => {
      assert.equal(first.providerCalls, 1); assert.equal(first.refundEvents, 0);
      assert.equal(nativePayment.currency_code, "usd"); assert.equal(nativePayment.provider_id, "pp_system_default");
      assert.deepEqual(providerArguments, [{ provider_id: nativePayment.provider_id, amount: { value: "1", precision: 20 }, key }]);
      assert.equal(first.refunds.length, 1); assert.equal(first.refunds[0].status, "succeeded");
      assert.equal(Number(first.refunds[0].amount), 1); assert.equal(first.refunds[0].idempotency_key, key);
      assert.equal(first.refunds[0].raw_amount.value, "1");
      assert.equal(first.transactions.length, 0); assert.equal(first.credits.length, 0); assert.equal(first.refunded, 0);
    });
    await expectRefundError(refundInput, /existing active order change/i);
    const sameKey = await refundState();
    check("native-active-claim-stable-refund-key-retains-original-effect-without-recalling-provider", () => {
      assert.equal(sameKey.providerCalls, 1); assert.equal(sameKey.refunds.length, 1);
      assert.equal(sameKey.refunds[0].id, first.refunds[0].id);
      assert.equal(sameKey.transactions.length, 0); assert.equal(sameKey.credits.length, 0); assert.equal(sameKey.refundEvents, 0);
    });
    await expectRefundError({ ...refundInput, amount: 2 }, /different amount/i);
    const changed = await refundState();
    check("native-refund-key-changed-amount-refuses-without-another-provider-effect", () => {
      assert.deepEqual(changed, sameKey);
    });
    await cancelBeginOrderClaimWorkflow(container).run({ input: { claim_id: active.claim_id! } });
    await refundPaymentWorkflow(container).run({ input: refundInput });
    const recovered = await refundState();
    check("native-cleared-claim-refund-key-recovers-original-bookkeeping-without-another-provider-call", () => {
      assert.equal(recovered.providerCalls, 1); assert.equal(recovered.refunds.length, 1);
      assert.equal(recovered.refunds[0].id, first.refunds[0].id);
      assert.equal(recovered.transactions.length, 1); assert.equal(recovered.transactions[0].reference_id, first.refunds[0].id);
      assert.equal(Number(recovered.transactions[0].amount), -1);
      assert.equal(recovered.credits.length, 1); assert.equal(Number(recovered.credits[0].amount), 1);
      assert.equal(recovered.refunded, 1); assert.equal(recovered.refundEvents, 1);
    });
    await refundPaymentWorkflow(container).run({ input: refundInput });
    check("native-recovered-refund-key-replay-has-one-provider-call-credit-transaction-and-event", () => {});
    assert.deepEqual(await refundState(), recovered);
    console.log("RIFARE_NATIVE_CLAIM_REFUND_RESULT=" + JSON.stringify({ original_order_id: refundOriginal.order.id,
      original_payment_id: refundOriginal.paymentId, original_refund_id: first.refunds[0].id,
      provider_calls: providerCalls, refund_events: refundEvents, amount: 1, currency: nativePayment.currency_code,
      initial_workflow_error_after_provider_success: true, recovered_original_bookkeeping: true,
      real_financial_effect: false, production_qualified: false }));
  } finally { provider.refundPayment = originalRefund; events.emit = originalEmit; }

  // Separate original: receiving is an actual native transition, not a claim label.
  const receivingOriginal = await original();
  assert.deepEqual(await level(), { stock: 4, reserved: 0 });
  const receivingFinancial = await financial();
  const { result: receiving } = await beginClaimOrderWorkflow(container).run({ input: { order_id: receivingOriginal.order.id, type: "replace" } });
  await orderClaimRequestItemReturnWorkflow(container).run({ input: { claim_id: receiving.claim_id!, return_id: "",
    location_id: fixture.locationId, items: [{ id: receivingOriginal.order.items[0].id, quantity: 1 }] } });
  const pendingReturn = await orders.retrieveOrderClaim(receiving.claim_id!);
  const { result: returnOptions } = await createShippingOptionsWorkflow(container).run({ input: [{
    name: `Rifare synthetic claim return ${suffix}`, price_type: "flat", provider_id: "manual_manual",
    service_zone_id: fixture.serviceZoneId, shipping_profile_id: fixture.profileId,
    type: { label: "Synthetic return", description: "No physical carrier", code: `return-${suffix}` },
    prices: [{ currency_code: "usd", amount: 0 }, { region_id: fixture.regionId, amount: 0 }],
    rules: [{ attribute: "enabled_in_store", operator: "eq", value: "true" }, { attribute: "is_return", operator: "eq", value: "true" }],
  }] });
  await createClaimShippingMethodWorkflow(container).run({ input: { claim_id: receiving.claim_id!,
    return_id: pendingReturn.return_id!, shipping_option_id: returnOptions[0].id } });
  await orderClaimAddNewItemWorkflow(container).run({ input: { claim_id: receiving.claim_id!, items: [{ variant_id: variant.id, quantity: 1 }] } });
  await createClaimShippingMethodWorkflow(container).run({ input: { claim_id: receiving.claim_id!, shipping_option_id: fixture.shippingId } });
  await confirmClaimRequestWorkflow(container).run({ input: { claim_id: receiving.claim_id! } });
  const withReturn = await orders.retrieveOrderClaim(receiving.claim_id!, { relations: ["additional_items"] });
  assert.ok(withReturn.return_id);
  assert.deepEqual(await level(), { stock: 4, reserved: 1 });
  const inboundLink = await postgres("return_fulfillment").where({ return_id: withReturn.return_id }).whereNull("deleted_at");
  assert.equal(inboundLink.length, 1);
  const inbound = await postgres("fulfillment").where({ id: inboundLink[0].fulfillment_id }).first();
  assert.equal(inbound.provider_id, "manual_manual"); assert.equal(inbound.shipping_option_id, returnOptions[0].id);
  assert.equal(inbound.canceled_at, null);
  await rejectUnchanged("native-claim-cancellation-with-live-return-fulfillment-refuses-without-effects", () =>
    cancelOrderClaimWorkflow(container).run({ input: { claim_id: receiving.claim_id!, no_notification: true } }));
  await createOrderFulfillmentWorkflow(container).run({ input: { order_id: receivingOriginal.order.id,
    location_id: fixture.locationId, shipping_option_id: fixture.shippingId,
    items: [{ id: withReturn.additional_items[0].item_id, quantity: 1 }], no_notification: true } });
  assert.deepEqual(await level(), { stock: 3, reserved: 0 });
  const outgoingItems = await postgres("fulfillment_item").where({ line_item_id: withReturn.additional_items[0].item_id }).whereNull("deleted_at");
  assert.equal(outgoingItems.length, 1);
  const outgoing = await postgres("fulfillment").where({ id: outgoingItems[0].fulfillment_id }).first();
  const outgoingOrder = await postgres("order_fulfillment").where({ fulfillment_id: outgoing.id }).whereNull("deleted_at");
  check("native-claim-replacement-fulfillment-consumes-only-one-reserved-stock-unit", () => {
    assert.equal(outgoingOrder.length, 1); assert.equal(outgoingOrder[0].order_id, receivingOriginal.order.id);
    assert.equal(outgoing.location_id, fixture.locationId); assert.equal(outgoing.shipping_option_id, fixture.shippingId);
    assert.equal(outgoingItems[0].inventory_item_id, inventoryId); assert.equal(Number(outgoingItems[0].quantity), 1);
  });
  await beginReceiveReturnWorkflow(container).run({ input: { return_id: withReturn.return_id } });
  await receiveItemReturnRequestWorkflow(container).run({ input: { return_id: withReturn.return_id,
    items: [{ id: receivingOriginal.order.items[0].id, quantity: 1 }] } });
  await confirmReturnReceiveWorkflow(container).run({ input: { return_id: withReturn.return_id } });
  assert.deepEqual(await level(), { stock: 4, reserved: 0 });
  assert.deepEqual(await financial(), receivingFinancial);
  const received = await postgres("return").where({ id: withReturn.return_id }).first();
  const receivedItems = await postgres("return_item").where({ return_id: received.id }).whereNull("deleted_at");
  check("native-claim-return-receiving-restocks-only-one-received-unit-without-payment-effects", () => {
    assert.equal(received.order_id, receivingOriginal.order.id); assert.equal(received.claim_id, receiving.claim_id);
    assert.equal(received.location_id, fixture.locationId); assert.equal(received.status, "received"); assert.ok(received.received_at);
    assert.equal(receivedItems.length, 1); assert.equal(receivedItems[0].item_id, receivingOriginal.order.items[0].id);
    assert.equal(Number(receivedItems[0].quantity), 1); assert.equal(Number(receivedItems[0].received_quantity), 1);
    assert.equal(Number(receivedItems[0].damaged_quantity), 0);
  });

  const { result: canceled } = await createCartWorkflow(container).run({ input: {
    ...fixture.cartInput, items: [{ variant_id: variant.id, quantity: 1 }],
  } });
  await addShippingMethodToCartWorkflow(container).run({ input: { cart_id: canceled.id, options: [{ id: fixture.shippingId }] } });
  const { result: collection } = await createPaymentCollectionForCartWorkflow(container).run({ input: { cart_id: canceled.id } });
  await createPaymentSessionsWorkflow(container).run({ input: { payment_collection_id: collection.id, provider_id: "pp_system_default" } });
  const { result: canceledOrder } = await completeCartWorkflow(container).run({ input: { id: canceled.id } });
  await cancelOrderWorkflow(container).run({ input: { order_id: canceledOrder.id, no_notification: true } });
  await rejectUnchanged("native-canceled-order-claim-refuses-without-effects", () =>
    beginClaimOrderWorkflow(container).run({ input: { order_id: canceledOrder.id, type: "refund" } }));
}
