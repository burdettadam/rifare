import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ContainerRegistrationKeys, Modules, ProductStatus } from "@medusajs/framework/utils";
import {
  addShippingMethodToCartWorkflow, beginClaimOrderWorkflow, cancelBeginOrderClaimWorkflow,
  cancelOrderClaimWorkflow, cancelOrderWorkflow, capturePaymentWorkflow, completeCartWorkflow,
  confirmClaimRequestWorkflow, createCartWorkflow, createClaimShippingMethodWorkflow,
  createInventoryLevelsWorkflow, createOrderFulfillmentWorkflow, createPaymentCollectionForCartWorkflow,
  createPaymentSessionsWorkflow, createProductsWorkflow, orderClaimAddNewItemWorkflow, orderClaimItemWorkflow,
} from "@medusajs/medusa/core-flows";

/** Ordinary upstream claims only; no application route, external provider or settlement. */
export async function qualifyNativeClaims(container: any, fixture: {
  profileId: string; channelId: string; shippingId: string; locationId: string; cartInput: object;
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
    "order_claim", "order_claim_item", "order_change", "order_change_action", "reservation_item", "inventory_level"]);
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
    return { order, paymentId };
  };
  const rejectUnchanged = async (name: string, invoke: () => Promise<unknown>) => {
    const before = await effects();
    await assert.rejects(invoke, (error: any) => {
      assert.match(error?.message ?? "", /cancel|not found/i); return true;
    });
    check(name, () => {});
    assert.deepEqual(await effects(), before, `${name}: rejected call changed native effects`);
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

  const { result: canceled } = await createCartWorkflow(container).run({ input: {
    ...fixture.cartInput, items: [{ variant_id: variant.id, quantity: 1 }],
  } });
  const { result: collection } = await createPaymentCollectionForCartWorkflow(container).run({ input: { cart_id: canceled.id } });
  await createPaymentSessionsWorkflow(container).run({ input: { payment_collection_id: collection.id, provider_id: "pp_system_default" } });
  const { result: canceledOrder } = await completeCartWorkflow(container).run({ input: { id: canceled.id } });
  await cancelOrderWorkflow(container).run({ input: { order_id: canceledOrder.id, no_notification: true } });
  await rejectUnchanged("native-canceled-order-claim-refuses-without-effects", () =>
    beginClaimOrderWorkflow(container).run({ input: { order_id: canceledOrder.id, type: "refund" } }));
}
