import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, generateJwtToken, Modules, ProductStatus, PromotionActions } from "@medusajs/framework/utils";
import { createApiKeysWorkflow, createCartWorkflow, createCartCreditLinesWorkflow, createProductsWorkflow,
  createPromotionsWorkflow, createRegionsWorkflow, createSalesChannelsWorkflow,
  linkSalesChannelsToApiKeyWorkflow, updateCartPromotionsWorkflow, updateStoresWorkflow } from "@medusajs/medusa/core-flows";
import { factsDigest, minorUnits, observationFields, observeCart, projectCart } from "../cart-context/observation";
import { cartContextConfig } from "../config/local-commerce";
import { readLockedCartFacts } from "../modules/operation-journal/cart-facts";

/** Actual native PostgreSQL/HTTP fixtures. JWTs are synthetic credentials for
 * native persisted associations, not evidence of a new hosted provider journey.
 */
export default async function verifyCartContext({ container }: ExecArgs) {
  if (process.env.NODE_ENV !== "test" || process.env.RIFARE_COMMERCE_VERIFY !== "disposable") {
    throw new Error("RIFARE_DISPOSABLE_CART_CONTEXT_TEST_REQUIRED");
  }
  const checks: string[] = [];
  const check = (name: string, assertions: () => void) => { assertions(); checks.push(name); console.log(`CART_CONTEXT_CHECK ${name}`); };
  const suffix = randomUUID();
  const carts = container.resolve(Modules.CART);
  const customers = container.resolve(Modules.CUSTOMER);
  const auth = container.resolve(Modules.AUTH);
  const stores = container.resolve(Modules.STORE);
  const orders = container.resolve(Modules.ORDER);
  const payment = container.resolve(Modules.PAYMENT);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const [store] = await stores.listStores();
  const merchant = { merchant_namespace: "synthetic-rifare", store_id: store.id };
  const { result: channels } = await createSalesChannelsWorkflow(container).run({ input: {
    salesChannelsData: [{ name: `Context ${suffix}` }, { name: `Other ${suffix}` }],
  } });
  await updateStoresWorkflow(container).run({ input: { selector: { id: store.id }, update: {
    supported_currencies: [{ currency_code: "usd", is_default: true }], default_sales_channel_id: channels[0].id,
  } } });
  const { result: regions } = await createRegionsWorkflow(container).run({ input: { regions: [{
    name: `Context ${suffix}`, currency_code: "usd", countries: ["us"], automatic_taxes: false,
    payment_providers: ["pp_system_default"],
  }] } });
  const { result: products } = await createProductsWorkflow(container).run({ input: { products: [{
    title: `Context ${suffix}`, status: ProductStatus.PUBLISHED, sales_channels: [{ id: channels[0].id }],
    options: [{ title: "Size", values: ["One", "Two"] }],
    variants: [
      { title: "One", options: { Size: "One" }, manage_inventory: false, prices: [{ currency_code: "usd", amount: 12.5 }] },
      { title: "Two", options: { Size: "Two" }, manage_inventory: false, prices: [{ currency_code: "usd", amount: 5 }] },
    ],
  }] } });
  const variants = products[0].variants;
  const createActor = async (label: string) => {
    const customer = await customers.createCustomers({ email: `${label}-${suffix}@example.invalid`, has_account: true });
    const identity = await auth.createAuthIdentities({ app_metadata: { customer_id: customer.id } });
    const token = generateJwtToken({ actor_type: "customer", actor_id: customer.id,
      auth_identity_id: identity.id, app_metadata: { customer_id: customer.id } },
    { secret: process.env.JWT_SECRET!, expiresIn: "5m" });
    return { customer, identity, token };
  };
  const alice = await createActor("alice");
  const bob = await createActor("bob");
  const { result: keys } = await createApiKeysWorkflow(container).run({ input: { api_keys: [
    { title: `Context ${suffix}`, type: "publishable", created_by: "rifare-local-verification" },
    { title: `Other ${suffix}`, type: "publishable", created_by: "rifare-local-verification" },
  ] } });
  for (let i = 0; i < 2; i++) await linkSalesChannelsToApiKeyWorkflow(container).run({ input: { id: keys[i].id, add: [channels[i].id] } });
  const input = { region_id: regions[0].id, sales_channel_id: channels[0].id,
    shipping_address: { first_name: "Synthetic", last_name: "Fixture", address_1: "1 Synthetic Street",
      country_code: "us", city: "Denver", postal_code: "80201" },
    items: [{ variant_id: variants[0].id, quantity: 2 }, { variant_id: variants[1].id, quantity: 1 }],
  };
  const makeCart = async (customer_id?: string) => (await createCartWorkflow(container).run({ input: { ...input, customer_id } })).result;
  const aliceCart = await makeCart(alice.customer.id);
  const bobCart = await makeCart(bob.customer.id);
  const guest = await makeCart();
  const graph = async (id: string) => (await query.graph({ entity: "cart", fields: observationFields,
    filters: { id } }, { cache: { enable: false } })).data[0] as any;
  const aliceInitial = await graph(aliceCart.id);
  const bobInitial = await graph(bobCart.id);
  const promoCode = `CONTEXT-${suffix}`;
  await createPromotionsWorkflow(container).run({ input: { promotionsData: [{ code: promoCode, type: "standard",
    status: "active", is_automatic: false,
    application_method: { type: "percentage", target_type: "items", allocation: "across", value: 10, currency_code: "usd" },
  }] } });
  await updateCartPromotionsWorkflow(container).run({ input: { cart_id: aliceCart.id, promo_codes: [promoCode], action: PromotionActions.ADD } });
  await carts.setLineItemTaxLines(aliceCart.id, aliceInitial.items.map((item: any) => ({ item_id: item.id, rate: 10,
    code: "synthetic-ten-percent", provider_id: "tp_system" })));
  await carts.addShippingMethods(aliceCart.id, [{ name: "Synthetic persisted shipping", amount: 5,
    tax_lines: [{ rate: 10, code: "synthetic-ten-percent", provider_id: "tp_system" }] }]);

  const origin = "http://127.0.0.1:19039";
  const server = spawn(process.execPath, ["run.mjs", "start", "--port", "19039"], {
    cwd: process.cwd(), env: { ...process.env, NODE_ENV: "test", DISABLE_MEDUSA_ADMIN: "true",
      RIFARE_MERCHANT_NAMESPACE: merchant.merchant_namespace, RIFARE_NATIVE_STORE_ID: store.id },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverLog = "";
  for (const stream of [server.stdout, server.stderr]) stream.on("data", (chunk) => { serverLog = (serverLog + chunk).slice(-20000); });
  const serverExit = new Promise<void>((resolve) => server.once("exit", () => resolve()));
  const request = async (path: string, token?: string, method = "GET", body?: unknown, key = keys[0].token) => {
    const response = await fetch(origin + path, { method, redirect: "error", signal: AbortSignal.timeout(10000),
      headers: { "content-type": "application/json", "x-publishable-api-key": key, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, value: await response.json(), headers: response.headers };
  };
  const observe = (id = aliceCart.id, token = alice.token) => request(`/store/rifare/cart-observations/${id}`, token);
  try {
    const deadline = Date.now() + 45000;
    let healthy = false;
    while (Date.now() < deadline && server.exitCode === null) {
      try { healthy = (await fetch(origin + "/health", { signal: AbortSignal.timeout(1000) })).ok; } catch { /* startup */ }
      if (healthy) break; await delay(100);
    }
    assert.ok(healthy, `Local Medusa HTTP startup failed: ${serverLog}`);
    const own = await request(`/store/carts/${aliceCart.id}`, alice.token);
    check("native-owner-read", () => { assert.equal(own.status, 200, JSON.stringify(own.value)); assert.equal(own.value.cart.id, aliceCart.id); });
    const other = await request(`/store/carts/${aliceCart.id}`, bob.token);
    check("other-customer-cannot-read-owned-cart", () => assert.equal(other.status, 403));
    for (const token of [undefined, "invalid", generateJwtToken({ actor_type: "user", actor_id: alice.customer.id,
      auth_identity_id: alice.identity.id }, { secret: process.env.JWT_SECRET!, expiresIn: "5m" })]) {
      assert.equal((await request(`/store/carts/${aliceCart.id}`, token)).status, 403);
    }
    check("anonymous-invalid-and-operator-credentials-have-no-customer-authority", () => {});
    assert.equal((await request(`/STORE/CARTS/${aliceCart.id}/`, bob.token)).status, 403);
    assert.equal((await request(`/store/carts/${encodeURIComponent(aliceCart.id).replace("cart", "%63art")}`, bob.token)).status, 403);
    assert.equal((await request(`/store/carts/${aliceCart.id}`, alice.token, "GET", undefined, keys[1].token)).status, 403);
    check("route-normalization-and-publishable-channel-are-bound", () => {});

    for (const path of [`/store/shipping-options?cart_id=${aliceCart.id}`, `/store/products?cart_id=${aliceCart.id}`,
      `/store/product-variants?cart_id=${aliceCart.id}`]) assert.equal((await request(path, bob.token)).status, 403, path);
    assert.equal((await request("/store/shipping-options/so_synthetic/calculate", bob.token, "POST", { cart_id: aliceCart.id })).status, 403);
    assert.equal((await request(`/store/products?cart_id=${aliceCart.id}&cart_id=${guest.id}`, bob.token)).status, 403);
    check("alternate-cart-consumers-reject-other-owner-and-ambiguous-context", () => {});

    const beforeBobLine = (await graph(bobCart.id)).items.length;
    for (const carrier of [aliceCart.id, guest.id]) {
      const cross = await request(`/store/carts/${carrier}/line-items/${bobInitial.items[0].id}`, alice.token, "DELETE");
      assert.equal(cross.status, 403);
    }
    assert.equal((await graph(bobCart.id)).items.length, beforeBobLine);
    check("foreign-line-deletion-blocked-even-through-a-guest-cart", () => {});
    for (const field of ["shipping_address", "billing_address"]) {
      assert.equal((await request("/store/carts", alice.token, "POST", { ...input, [field]: bobInitial.shipping_address.id })).status, 403);
      assert.equal((await request(`/store/carts/${guest.id}`, undefined, "POST",
        { [field]: { id: bobInitial.shipping_address.id, city: "Attacker" } })).status, 403);
    }
    assert.equal((await graph(bobCart.id)).shipping_address.city, "Denver");
    check("foreign-address-references-cannot-create-or-mutate-carts", () => {});

    assert.equal((await request(`/store/carts/${guest.id}`)).status, 200);
    const emailOnly = await request("/store/carts", undefined, "POST", { ...input, email: alice.customer.email });
    assert.equal(emailOnly.status, 200, JSON.stringify(emailOnly.value));
    assert.notEqual((await graph(emailOnly.value.cart.id)).customer_id, alice.customer.id);
    const created = await request("/store/carts", alice.token, "POST", input);
    assert.equal(created.status, 200, JSON.stringify(created.value));
    assert.equal((await graph(created.value.cart.id)).customer_id, alice.customer.id);
    check("native-creation-preserves-guest-and-authenticated-association-rules", () => {});
    const removable = (await graph(created.value.cart.id)).items[0].id;
    const deleted = await request(`/store/carts/${created.value.cart.id}/line-items/${removable}`, alice.token, "DELETE");
    assert.equal(deleted.status, 200, JSON.stringify(deleted.value));
    assert.equal((await graph(created.value.cart.id)).items.some((item: any) => item.id === removable), false);
    assert.equal((await request(`/store/products?cart_id=${aliceCart.id}`, alice.token)).status, 200);
    check("authorized-native-child-deletion-and-product-context-remain-usable", () => {});

    for (const id of [guest.id, aliceCart.id]) assert.equal((await request(`/store/carts/${id}/customer`, bob.token, "POST", {})).status, 503);
    for (const [path, method] of [[`/store/carts/${aliceCart.id}/complete`, "POST"], ["/store/payment-collections", "POST"],
      ["/store/orders", "GET"], ["/store/returns", "POST"], ["/hooks/payment/system_default", "POST"]]) {
      assert.equal((await request(path, alice.token, method, method === "POST" ? {} : undefined)).status, 503, path);
    }
    check("customer-transfer-and-existing-commerce-effects-remain-held", () => {});

    const effectCounts = async () => ({ orders: (await orders.listAndCountOrders({}, { take: 1 }))[1],
      collections: (await payment.listAndCountPaymentCollections({}, { take: 1 }))[1],
      reservations: (await container.resolve(Modules.INVENTORY).listAndCountReservationItems({}, { take: 1 }))[1] });
    const countsBefore = await effectCounts();
    const persistedBefore = await graph(aliceCart.id);
    const first = await observe();
    check("closed-native-observation-and-exact-native-totals", () => {
      assert.equal(first.status, 200, JSON.stringify(first.value));
      const observation = first.value.observation;
      assert.equal(observation.semantics, "OBSERVATION_ONLY");
      assert.equal(observation.facts.merchant_namespace, merchant.merchant_namespace);
      assert.equal(observation.facts.store_id, store.id);
      assert.equal(observation.facts.currency_code, "usd"); assert.equal(observation.facts.currency_exponent, 2);
      assert.equal(observation.facts.amount_unit, "major");
      assert.equal(observation.facts.totals.subtotal, "35");
      assert.equal(observation.facts.totals.discount_total, "3.3");
      assert.equal(observation.facts.totals.tax_total, "3.2");
      assert.equal(observation.facts.totals.total, "35.2");
      assert.equal(observation.facts.payable_total_minor, "3520");
      assert.equal(first.headers.get("cache-control"), "no-store");
      const bytes = JSON.stringify(observation);
      for (const secret of [alice.customer.email, "1 Synthetic Street", "80201", "auth_identity_id", "payment_collection", "metadata"]) {
        assert.equal(bytes.includes(secret), false, secret);
      }
    });
    const repeated = await observe();
    assert.equal(repeated.value.observation.facts_digest, first.value.observation.facts_digest);
    assert.deepEqual(await effectCounts(), countsBefore);
    assert.deepEqual(await graph(aliceCart.id), persistedBefore);
    check("repeated-observation-is-stable-and-does-not-mutate-commerce", () => {});
    const secondStore = await stores.createStores({ name: "Synthetic extra store" });
    assert.equal((await observe()).status, 403);
    await stores.deleteStores(secondStore.id);
    const fixtureRequest = { scope: container, params: { id: aliceCart.id },
      auth_context: { actor_type: "customer", actor_id: alice.customer.id, auth_identity_id: alice.identity.id },
      publishable_key_context: { sales_channel_ids: [channels[0].id] } } as any;
    const priorMerchant = process.env.RIFARE_MERCHANT_NAMESPACE;
    const priorStore = process.env.RIFARE_NATIVE_STORE_ID;
    try {
      delete process.env.RIFARE_MERCHANT_NAMESPACE; delete process.env.RIFARE_NATIVE_STORE_ID;
      await assert.rejects(observeCart(fixtureRequest), /Cart observation is not configured/);
      process.env.RIFARE_MERCHANT_NAMESPACE = merchant.merchant_namespace;
      process.env.RIFARE_NATIVE_STORE_ID = "store_wrong";
      await assert.rejects(observeCart(fixtureRequest), /Cart context unavailable/);
    } finally {
      if (priorMerchant === undefined) delete process.env.RIFARE_MERCHANT_NAMESPACE; else process.env.RIFARE_MERCHANT_NAMESPACE = priorMerchant;
      if (priorStore === undefined) delete process.env.RIFARE_NATIVE_STORE_ID; else process.env.RIFARE_NATIVE_STORE_ID = priorStore;
    }
    check("observation-requires-configured-sole-native-store", () => {});
    // Independent JSON key-order oracle for this closed string/boolean/array DTO.
    const sorted = (value: any): any => Array.isArray(value) ? value.map(sorted) : value && typeof value === "object" ?
      Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])])) : value;
    assert.equal(first.value.observation.facts_digest,
      `sha256:${createHash("sha256").update(JSON.stringify(sorted(first.value.observation.facts))).digest("hex")}`);
    const reordered = structuredClone(persistedBefore); reordered.items.reverse();
    for (const item of reordered.items) { item.adjustments.reverse(); item.tax_lines.reverse(); }
    assert.equal(factsDigest(projectCart(reordered, merchant)), first.value.observation.facts_digest);
    check("independent-canonical-digest-and-row-order-invariance", () => {});
    assert.equal((await observe(aliceCart.id, bob.token)).status, 403);
    assert.equal((await observe(guest.id)).status, 403);
    assert.equal((await request(`/store/rifare/cart-observations/${aliceCart.id}`)).status, 401);
    assert.equal((await request(`/store/rifare/cart-observations/${aliceCart.id}?facts_digest=sha256:caller`, alice.token)).status, 400);
    check("observation-refuses-guest-other-owner-and-caller-facts", () => {});

    await auth.updateAuthIdentities({ id: alice.identity.id, app_metadata: { customer_id: bob.customer.id } });
    assert.equal((await request(`/store/carts/${aliceCart.id}`, alice.token)).status, 401);
    assert.equal((await observe()).status, 401);
    await auth.updateAuthIdentities({ id: alice.identity.id, app_metadata: { customer_id: alice.customer.id } });
    check("stale-jwt-association-is-rechecked-against-native-owner", () => {});

    const updated = await request(`/store/carts/${aliceCart.id}/line-items/${aliceInitial.items[0].id}`, alice.token, "POST", { quantity: 4 });
    assert.equal(updated.status, 200, JSON.stringify(updated.value));
    const changed = await observe();
    assert.equal(changed.status, 200, JSON.stringify(changed.value));
    assert.notEqual(changed.value.observation.facts_digest, first.value.observation.facts_digest);
    const addressUpdate = await request(`/store/carts/${aliceCart.id}`, alice.token, "POST", { shipping_address: { city: "Boulder" } });
    assert.equal(addressUpdate.status, 200, JSON.stringify(addressUpdate.value));
    const afterAddress = await observe();
    assert.equal(afterAddress.status, 200, JSON.stringify(afterAddress.value));
    assert.notEqual(afterAddress.value.observation.facts.contact_digest, changed.value.observation.facts.contact_digest);
    check("native-owner-item-and-inline-address-changes-alter-the-facts", () => {});
    await createCartCreditLinesWorkflow(container).run({ input: [{ cart_id: aliceCart.id, amount: 1,
      reference: "synthetic", reference_id: "synthetic-credit", metadata: null }] });
    const afterCredit = await observe();
    assert.equal(afterCredit.status, 200, JSON.stringify(afterCredit.value));
    assert.equal(afterCredit.value.observation.facts.credit_lines[0].amount, "1");
    assert.notEqual(afterCredit.value.observation.facts_digest, afterAddress.value.observation.facts_digest);
    check("native-credit-lines-participate-in-the-projection", () => {});

    const postgres = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
    await assert.rejects(readLockedCartFacts(postgres, aliceCart.id, merchant), /transaction is required/);
    await assert.rejects(postgres.transaction(tx => readLockedCartFacts(tx, aliceCart.id, merchant)),
      /Serializable isolation is required/);
    const lockedFacts = await postgres.transaction(tx => readLockedCartFacts(tx, aliceCart.id, merchant),
      { isolationLevel: "serializable" });
    check("serializable-cart-facts-match-native-observation", () => {
      assert.deepEqual(lockedFacts.facts, afterCredit.value.observation.facts);
      assert.equal(lockedFacts.factsDigest, afterCredit.value.observation.facts_digest);
    });

    await carts.updateCarts([{ id: aliceCart.id, completed_at: new Date() }]);
    assert.equal((await observe()).status, 403);
    await carts.updateCarts([{ id: aliceCart.id, completed_at: null }]);
    const order = await orders.createOrders({ currency_code: "usd", region_id: regions[0].id });
    await container.resolve(ContainerRegistrationKeys.LINK).create({ [Modules.ORDER]: { order_id: order.id }, [Modules.CART]: { cart_id: aliceCart.id } });
    const linked = await observe(); assert.equal(linked.status, 403); assert.equal(JSON.stringify(linked.value).includes(order.id), false);
    check("completed-or-already-ordered-carts-cannot-be-observed-for-preparation", () => {});
    await customers.softDeleteCustomers([bob.customer.id]);
    assert.equal((await request(`/store/carts/${bobCart.id}`)).status, 403);
    assert.equal((await request(`/store/carts/${bobCart.id}`, bob.token)).status, 401);
    check("deleted-customer-never-downgrades-to-guest-access", () => {});

    check("currency-aware-exact-decimals-and-bounded-values", () => {
      assert.equal(minorUnits({ value: "12.50" }, 2), "1250");
      assert.equal(minorUnits({ value: "123" }, 0), "123");
      assert.equal(minorUnits({ value: "1.234" }, 3), "1234");
      assert.equal(minorUnits({ value: "90071992547409.91" }, 2), "9007199254740991");
      assert.throws(() => minorUnits({ value: "1.001" }, 2));
      assert.throws(() => minorUnits({ value: "9223372036854775808" }, 0));
      assert.throws(() => minorUnits({ value: "NaN" }, 2));
      assert.throws(() => minorUnits({ value: "1e-9999999999" }, 2));
      assert.throws(() => minorUnits(12.5, 2));
      assert.throws(() => projectCart({ ...persistedBefore, currency_code: "xxx" }, merchant));
      assert.throws(() => projectCart({ ...persistedBefore, items: undefined }, merchant));
      assert.throws(() => projectCart({ ...persistedBefore, items: [persistedBefore.items[0], persistedBefore.items[0]] }, merchant));
      assert.throws(() => projectCart({ ...persistedBefore, raw_total: { value: "35.201" } }, merchant));
      assert.equal(projectCart({ ...persistedBefore, currency_code: "jpy", raw_total: { value: "35" } }, merchant).payable_total_minor, "35");
      assert.equal(projectCart({ ...persistedBefore, currency_code: "kwd" }, merchant).payable_total_minor, "35200");
      const fraction = structuredClone(persistedBefore); fraction.items[0].raw_unit_price = { value: "12.501" };
      assert.equal(projectCart(fraction, merchant).items.find(item => item.id === fraction.items[0].id)?.unit_price, "12.501");
    });
    check("merchant-configuration-requires-both-server-values", () => {
      assert.equal(cartContextConfig({}), undefined);
      assert.throws(() => cartContextConfig({ RIFARE_MERCHANT_NAMESPACE: "caller" }));
      assert.throws(() => cartContextConfig({ RIFARE_MERCHANT_NAMESPACE: "bad namespace", RIFARE_NATIVE_STORE_ID: store.id }));
      assert.deepEqual(cartContextConfig({ RIFARE_MERCHANT_NAMESPACE: merchant.merchant_namespace, RIFARE_NATIVE_STORE_ID: store.id }), merchant);
      assert.notEqual(factsDigest(projectCart(persistedBefore, { ...merchant, merchant_namespace: "other" })), first.value.observation.facts_digest);
    });
    console.log(JSON.stringify({ profile: "disposable-medusa-postgres-cart-context", passed: checks.length, checks,
      external_identity_link: false, delegated_commands: false, commerce_authority: false, production_qualified: false }, null, 2));
  } catch (error) {
    console.error(serverLog); throw error;
  } finally {
    server.kill("SIGTERM");
    await Promise.race([serverExit, delay(5000)]);
    if (server.exitCode === null) server.kill("SIGKILL");
  }
}
