import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, generateJwtToken, Modules, ProductStatus, PromotionActions } from "@medusajs/framework/utils";
import { createApiKeysWorkflow, createCartWorkflow, createCartCreditLinesWorkflow, createProductsWorkflow,
  createPromotionsWorkflow, createRegionsWorkflow, createSalesChannelsWorkflow,
  linkSalesChannelsToApiKeyWorkflow, updateCartPromotionsWorkflow, updateStoresWorkflow } from "@medusajs/medusa/core-flows";
import { factsDigest, minorUnits, observationFields, observeCart, projectCart } from "../cart-context/observation";
import { cartContextConfig } from "../config/local-commerce";
import { readLockedCartFacts } from "../modules/operation-journal/cart-facts";
import { parseOriginalCommand, requireCommandCartMatch } from "../modules/operation-journal/command";
import { operationJournalModule } from "../modules/operation-journal";
import type OperationJournalService from "../modules/operation-journal/service";

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

    await carts.addShippingMethods(aliceCart.id, [{ name: "Synthetic discount shipping", amount: 5,
      tax_lines: [{ rate: 10, code: "synthetic-ten-percent", provider_id: "tp_system" }] }]);
    const beforeShippingDiscount = await observe();
    assert.equal(beforeShippingDiscount.status, 200);
    const shippingMethod = beforeShippingDiscount.value.observation.facts.shipping_methods[0];
    await carts.addShippingMethodAdjustments(aliceCart.id, [{
      shipping_method_id: shippingMethod.id, code: "SYNTHETIC-SHIPPING-DISCOUNT", amount: 1,
    }]);
    const afterShippingDiscount = await observe();
    check("native-shipping-adjustment-without-tax-inclusion-flag", () => {
      assert.equal(afterShippingDiscount.status, 200, JSON.stringify(afterShippingDiscount.value));
      const facts = afterShippingDiscount.value.observation.facts;
      assert.equal(facts.shipping_methods[0].adjustments[0].amount, "1");
      assert.equal(facts.shipping_methods[0].adjustments[0].is_tax_inclusive, false);
      assert.equal(BigInt(beforeShippingDiscount.value.observation.facts.payable_total_minor) -
        BigInt(facts.payable_total_minor), 110n);
    });

    const postgres = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
    const admission = {
      actor: { actor_type: "customer", actor_id: alice.customer.id, auth_identity_id: alice.identity.id },
      salesChannelIds: [channels[0].id],
    };
    const readAdmission = (id = aliceCart.id, context = admission, selection = merchant) =>
      postgres.transaction(tx => readLockedCartFacts(tx, id, selection, context), { isolationLevel: "serializable" });
    await assert.rejects(readLockedCartFacts(postgres, aliceCart.id, merchant, admission), /transaction is required/);
    await assert.rejects(postgres.transaction(tx => readLockedCartFacts(tx, aliceCart.id, merchant, admission)),
      /Serializable isolation is required/);
    const lockedFacts = await readAdmission();
    check("serializable-cart-facts-match-native-observation", () => {
      assert.deepEqual(lockedFacts.facts, afterShippingDiscount.value.observation.facts);
      assert.equal(lockedFacts.factsDigest, afterShippingDiscount.value.observation.facts_digest);
      assert.match(lockedFacts.actorDigest, /^sha256:[a-f0-9]{64}$/);
    });
    const command = {
      cart_facts_digest: afterShippingDiscount.value.observation.facts_digest,
      cart_id: aliceCart.id,
      command_id: randomUUID(),
      currency: "usd",
      currency_exponent: 2,
      kind: "prepare_purchase",
      payable_minor_units: afterShippingDiscount.value.observation.facts.payable_total_minor,
      profile: "urn:rifare:medusa-original-operation:v1",
    };
    check("canonical-original-command-is-closed-and-bound-to-locked-cart", () => {
      const bytes = Buffer.from(JSON.stringify(command));
      const original = parseOriginalCommand(bytes);
      assert.equal(original.commandBytes, bytes.toString());
      assert.equal(original.commandDigest, "sha256:" + createHash("sha256").update(bytes).digest("hex"));
      requireCommandCartMatch(original, lockedFacts);
      for (const override of [
        { cart_id: bobCart.id }, { cart_facts_digest: "sha256:" + "0".repeat(64) },
        { payable_minor_units: "0" }, { currency: "jpy", currency_exponent: 0 },
      ]) {
        const changed = parseOriginalCommand(Buffer.from(JSON.stringify({ ...command, ...override })));
        assert.throws(() => requireCommandCartMatch(changed, lockedFacts), /does not match current cart facts/);
      }

      for (const invalid of [
        Buffer.from(" " + bytes.toString()),
        Buffer.from(bytes.toString().replace('{', '{"currency":"usd",')),
        Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(command).reverse()))),
        Buffer.from(JSON.stringify({ ...command, command_id: "00000000-0000-0000-0000-000000000000" })),
        Buffer.from(JSON.stringify({ ...command, currency_exponent: 3 })),
        Buffer.from(JSON.stringify({ ...command, payable_minor_units: "01" })),
        Buffer.from(JSON.stringify({ ...command, payable_minor_units: "9223372036854775808" })),
        Buffer.from(JSON.stringify({ ...command, kind: "finalize" })),
        Buffer.from(JSON.stringify({ ...command, merchant_namespace: "caller-choice" })),
        Buffer.from([0xc0, 0xaf]),
        Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes]),
        Buffer.alloc(1025, 0x20),
      ]) assert.throws(() => parseOriginalCommand(invalid), /Invalid original commerce command/);
    });

    const denied = /Cart context unavailable/;
    await assert.rejects(readAdmission(bobCart.id), denied);
    await assert.rejects(readAdmission(guest.id), denied);
    await assert.rejects(readAdmission(aliceCart.id, admission, { ...merchant, store_id: secondStore.id }), denied);
    await assert.rejects(readAdmission(aliceCart.id, { ...admission, salesChannelIds: [channels[1].id] }), denied);
    await assert.rejects(readAdmission(aliceCart.id, {
      ...admission, actor: { ...admission.actor, auth_identity_id: bob.identity.id },
    }), denied);
    await auth.updateAuthIdentities({ id: alice.identity.id, app_metadata: { customer_id: bob.customer.id } });
    await assert.rejects(readAdmission(), denied);
    await auth.updateAuthIdentities({ id: alice.identity.id, app_metadata: { customer_id: alice.customer.id } });
    check("serializable-admission-refuses-wrong-owner-identity-store-and-channel", () => {});

    const journal = container.resolve<OperationJournalService>(operationJournalModule);
    const key = randomBytes(32);
    const users = container.resolve(Modules.USER);
    const operator = await users.createUsers({ email: "privacy-" + suffix + "@example.invalid" });
    const operatorIdentity = await auth.createAuthIdentities({ app_metadata: { user_id: operator.id } });
    const privacyActor = { actor_type: "user", actor_id: operator.id, auth_identity_id: operatorIdentity.id };
    const configuration = {
      RIFARE_MERCHANT_NAMESPACE: merchant.merchant_namespace,
      RIFARE_NATIVE_STORE_ID: merchant.store_id,
      RIFARE_JOURNAL_PRIVACY_KEY: key.toString("base64url"),
      RIFARE_JOURNAL_PRIVACY_OPERATOR_ID: operator.id,
    };
    const originalEnv = Object.fromEntries(Object.keys(configuration).map(name => [name, process.env[name]]));
    const bytes = Buffer.from(JSON.stringify(command));
    try {
      Object.assign(process.env, configuration);
      delete process.env.RIFARE_JOURNAL_PRIVACY_KEY;
      await assert.rejects(journal.admit(bytes, admission), /Operation journal is unavailable/);
      process.env.RIFARE_JOURNAL_PRIVACY_KEY = configuration.RIFARE_JOURNAL_PRIVACY_KEY;

      process.env.RIFARE_JOURNAL_PRIVACY_OPERATOR_ID = "user_missing";
      await assert.rejects(journal.admit(bytes, admission), /Operation journal is unavailable/);
      process.env.RIFARE_JOURNAL_PRIVACY_OPERATOR_ID = operator.id;

      const [first, repeated] = await Promise.all([journal.admit(bytes, admission), journal.admit(bytes, admission)]);
      assert.deepEqual(first, repeated);
      assert.equal(first.state, "awaiting_authority");
      assert.equal(first.original_command_uuid, command.command_id);
      const owned = await postgres("rifare_operation").where({ original_command_uuid: command.command_id });
      assert.equal(owned.length, 1);
      assert.equal(owned[0].command_bytes, bytes.toString());
      assert.equal(owned[0].actor_digest, lockedFacts.actorDigest);
      assert.equal(owned[0].cart_facts_digest, lockedFacts.factsDigest);
      assert.equal(owned[0].payable_minor_units, command.payable_minor_units);
      assert.deepEqual(await journal.admit(bytes, admission), first);

      const authorityCommand = { ...command, command_id: randomUUID() };
      const authorityBytes = Buffer.from(JSON.stringify(authorityCommand));
      const contenders = await Promise.all([
        journal.admitForAuthority(authorityBytes, admission),
        journal.admitForAuthority(authorityBytes, admission),
      ]);
      const creators = contenders.filter(result => !result.recovery_only);
      assert.equal(creators.length, 1);
      assert.ok(creators[0].send_ticket);
      assert.equal(contenders.filter(result => result.send_ticket === null).length, 1);
      const authorityRow = () => postgres("rifare_operation")
        .where({ original_command_uuid: authorityCommand.command_id }).first();
      const beforeClaim = await authorityRow();
      assert.match(beforeClaim.start_owner_digest, /^sha256:[0-9a-f]{64}$/);
      assert.equal(JSON.stringify(beforeClaim).includes(creators[0].send_ticket), false);
      assert.equal(beforeClaim.start_claimed_at, null);
      await assert.rejects(journal.claimAuthorityDispatch(authorityCommand.command_id,
        randomBytes(32).toString("base64url"), admission), /Original commerce command unavailable/);
      await assert.rejects(journal.claimAuthorityDispatch(authorityCommand.command_id,
        creators[0].send_ticket!, admission), /Original commerce command unavailable/);
      const descriptor = {
        correlation: {
          actor: { id: "urn:rifare:synthetic:machine", type: "MACHINE_IDENTITY" },
          organization_id: "12345678-1234-4234-8234-123456789abc",
          provider_ref: "synthetic-provider",
        },
        grant: { id: "12345678-1234-4234-8234-123456789abc", revision: 1,
          terms_digest: "sha256:" + "a".repeat(64) },
      };
      const descriptorBytes = Buffer.from(JSON.stringify(descriptor));
      const retainedStart = await journal.retainAuthorityStart(authorityCommand.command_id,
        creators[0].send_ticket!, descriptorBytes, admission);
      const expectedStart = JSON.stringify({
        command: "START_USE", command_id: authorityCommand.command_id, grant: descriptor.grant,
        operation: { action: "urn:rifare:action:purchase:v1", audience: "urn:rifare:store:" + merchant.store_id,
          request_digest: "sha256:" + createHash("sha256").update(authorityBytes).digest("hex"),
          request_profile: "urn:rifare:medusa-original-operation:v1",
          resource_id: "urn:rifare:cart:" + command.cart_id },
        profile: "urn:marty:delegation-command:v1",
      });
      assert.equal(retainedStart.command_bytes, expectedStart);
      assert.equal(retainedStart.command_digest, "sha256:" + createHash("sha256").update(expectedStart).digest("hex"));
      assert.deepEqual(await journal.retainAuthorityStart(authorityCommand.command_id,
        creators[0].send_ticket!, descriptorBytes, admission), retainedStart);
      await assert.rejects(journal.retainAuthorityStart(authorityCommand.command_id,
        creators[0].send_ticket!, Buffer.from(JSON.stringify({ ...descriptor,
          grant: { ...descriptor.grant, revision: 2 } })), admission), /Original commerce command unavailable/);
      const claims = await Promise.allSettled([
        journal.claimAuthorityDispatch(authorityCommand.command_id, creators[0].send_ticket!, admission),
        journal.claimAuthorityDispatch(authorityCommand.command_id, creators[0].send_ticket!, admission),
      ]);
      assert.equal(claims.filter(result => result.status === "fulfilled").length, 1);
      assert.ok((await authorityRow()).start_claimed_at);
      assert.equal((await authorityRow()).revision, 2);
      const recovered = await journal.admitForAuthority(authorityBytes, admission);
      assert.equal(recovered.recovery_only, true);
      assert.equal(recovered.send_ticket, null);
      assert.equal((await journal.prepareRecovery(authorityCommand.command_id, admission)).id,
        recovered.operation.id);
      assert.deepEqual((await journal.prepareRecovery(authorityCommand.command_id, admission)).authority_start, retainedStart);
      console.log("RIFARE_NATIVE_AUTHORITY_START_FIXTURE=" + JSON.stringify(retainedStart));
      const priorOriginal = await journal.admitForAuthority(bytes, admission);
      assert.equal(priorOriginal.recovery_only, true);
      assert.equal(priorOriginal.send_ticket, null);
      check("journal-authority-start-ticket-is-issued-once-and-claims-once-in-postgres", () => {});

      const wireModule = await import(pathToFileURL(resolve(process.cwd(),
        "../../packages/adapters/delegated-commands/public-use-client.mts")).href);
      const peerModule = await import(pathToFileURL(resolve(process.cwd(),
        "../../tests/development/delegated-use-client-helpers.mts")).href);
      const peer = await peerModule.delegatedUsePeer();
      const transport = new wireModule.PublicDelegatedUseClient(peer.config);
      const remoteResults = new Map<string, unknown>();
      peer.setHandler((request: any, response: any) => {
        response.statusCode = 200;
        if (request.method === "GET") {
          response.setHeader("content-type", "application/oauth-authz-req+jwt");
          response.setHeader("pragma", "no-cache");
          response.setHeader("x-content-type-options", "nosniff");
          response.end("eyJhbGciOiJFUzI1NiJ9.eyJub25jZSI6InN5bnRoZXRpYyJ9.c3ludGhldGlj");
          return;
        }
        const id = request.body.command === "START_USE" ? request.body.command_id : request.body.original_command_id;
        if (request.body.command === "START_USE") {
          remoteResults.set(id, {
            profile: "urn:marty:delegation-command-response:v1", original_command_id: id,
            command_digest: "sha256:" + createHash("sha256").update(request.raw).digest("hex"),
            result: { kind: "CHALLENGE", challenge_id: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
              grant: request.body.grant, operation: request.body.operation,
              created_at: "2026-11-23T00:00:00.000Z", expires_at: "2026-11-23T00:10:00.000Z" },
          });
        }
        response.setHeader("link", "<" + peer.config.origin +
          '/v1/flows/instances/bbbbbbbb-cccc-4ddd-8eee-ffffffffffff/request>; rel="urn:marty:delegated-use:request"');
        response.end(JSON.stringify({ ...remoteResults.get(id) as object,
          recovered: request.body.command === "RECOVER_RESULT" }));
      });
      try {
        const senderCommand = { ...command, command_id: randomUUID() };
        const senderBytes = Buffer.from(JSON.stringify(senderCommand));
        const session = await journal.openAuthoritySession(senderBytes, descriptorBytes, admission, transport);
        assert.equal(peer.connections, 0);
        assert.equal("send_ticket" in session, false);
        const storedBeforeNetwork = await journal.prepareRecovery(senderCommand.command_id, admission);
        assert.ok(storedBeforeNetwork.authority_start);
        const bound = await session.start();
        assert.equal(session.recovery_only, true);
        assert.equal(peer.requests.length, 1);
        assert.equal(peer.requests[0].path, "/v1/organizations/" +
          descriptor.correlation.organization_id + "/delegated-use-commands");
        assert.equal(peer.requests[0].raw.toString(), storedBeforeNetwork.authority_start!.command_bytes);
        assert.equal(peer.requests[0].tls_authorized, true);
        await assert.rejects(session.start(), /Authority sender is unavailable/);
        assert.equal(peer.requests.length, 1);
        const resumed = await journal.openAuthoritySession(senderBytes, descriptorBytes, admission, transport);
        assert.equal(resumed.recovery_only, true);
        await assert.rejects(resumed.start(), /Authority sender is unavailable/);
        const recoveredBound = await resumed.recover();
        assert.equal(peer.requests[1].body.command, "RECOVER_RESULT");
        assert.equal(peer.requests[1].body.original_command_id, senderCommand.command_id);
        const artifact = await resumed.requestArtifact(recoveredBound);
        assert.equal((artifact as { execution_authorized: boolean }).execution_authorized, false);
        assert.equal(peer.requests[2].method, "GET");
        assert.equal((bound as { response: { recovered: boolean } }).response.recovered, false);
        session.close(); resumed.close();
        check("native-authority-session-retains-before-tls-and-recovers-only-the-original", () => {});
      } finally { transport.close(); await peer.close(); }

      const changed = Buffer.from(JSON.stringify({ ...command, payable_minor_units: "0" }));
      await assert.rejects(journal.admit(changed, admission), /Original commerce command unavailable/);
      const wrongFacts = { ...command, command_id: randomUUID(), payable_minor_units: "0" };
      await assert.rejects(journal.admit(Buffer.from(JSON.stringify(wrongFacts)), admission), /does not match current cart facts/);
      assert.equal(await postgres("rifare_operation").where({ original_command_uuid: wrongFacts.command_id }).first(), undefined);
      await assert.rejects(journal.admit(bytes, {
        ...admission, actor: { actor_type: "customer", actor_id: bob.customer.id, auth_identity_id: bob.identity.id },
      }), denied);

      const bobContext = {
        ...admission, actor: { actor_type: "customer", actor_id: bob.customer.id, auth_identity_id: bob.identity.id },
      };
      const bobFacts = await readAdmission(bobCart.id, bobContext);
      const bobOriginal = {
        ...command, cart_id: bobCart.id, cart_facts_digest: bobFacts.factsDigest,
        payable_minor_units: bobFacts.facts.payable_total_minor,
      };
      await assert.rejects(journal.admit(Buffer.from(JSON.stringify(bobOriginal)), bobContext), /Original commerce command unavailable/);
      process.env.RIFARE_MERCHANT_NAMESPACE = "another-merchant";
      try {
        await assert.rejects(journal.admit(bytes, admission), /Original commerce command unavailable/);
      } finally {
        process.env.RIFARE_MERCHANT_NAMESPACE = merchant.merchant_namespace;
      }

      const rollbackOriginal = { ...command, command_id: randomUUID() };
      const rollbackBytes = Buffer.from(JSON.stringify(rollbackOriginal));
      // PostgreSQL runs this constraint trigger at commit, after INSERT has
      // returned the candidate ID to the application's transaction callback.
      await postgres.raw(`
        create function rifare_fixture_reject_commit() returns trigger language plpgsql
        as 'begin raise exception ''RIFARE_FIXTURE_COMMIT_ABORT''; end;'
      `);
      try {
        await postgres.raw(`
          create constraint trigger rifare_fixture_commit_fault
          after insert on rifare_operation deferrable initially deferred
          for each row execute function rifare_fixture_reject_commit()
        `);
        await assert.rejects(journal.admit(rollbackBytes, admission), /RIFARE_FIXTURE_COMMIT_ABORT/);
        assert.equal(await postgres("rifare_operation").where({ original_command_uuid: rollbackOriginal.command_id }).first(), undefined);
      } finally {
        await postgres.raw("drop trigger if exists rifare_fixture_commit_fault on rifare_operation");
        await postgres.raw("drop function rifare_fixture_reject_commit()");
      }
      const recoveredRollback = await journal.admit(rollbackBytes, admission);
      const recoveredRows = await postgres("rifare_operation").where({ original_command_uuid: rollbackOriginal.command_id });
      assert.equal(recoveredRows.length, 1);
      assert.equal(recoveredRows[0].id, recoveredRollback.id);
      check("journal-commit-abort-rolls-back-insert-and-preserves-original-for-retry", () => {});

      const processOriginal = { ...command, command_id: randomUUID() };
      const processBytes = Buffer.from(JSON.stringify(processOriginal));
      const executeWorker = promisify(execFile);
      const worker = (loseAcknowledgement: boolean, input = processBytes) => executeWorker(process.execPath,
        ["run.mjs", "exec", "./src/scripts/verify-operation-journal-worker.ts"], {
          cwd: process.cwd(),
          timeout: 45000,
          env: {
            ...process.env,
            RIFARE_JOURNAL_TEST_COMMAND: input.toString("base64url"),
            RIFARE_JOURNAL_TEST_CONTEXT: JSON.stringify(admission),
            RIFARE_JOURNAL_TEST_LOSE_ACK: String(loseAcknowledgement),
          },
        });
      const lostAck = (error: unknown) => {
        const outcome = error as { code?: number; stdout?: string };
        return outcome.code === 79 && !outcome.stdout?.includes("RIFARE_JOURNAL_WORKER=");
      };
      const [acknowledged] = await Promise.all([worker(false), assert.rejects(worker(true), lostAck)]);
      const reply = acknowledged.stdout.split("\n").find(line => line.startsWith("RIFARE_JOURNAL_WORKER="));
      assert.ok(reply, "Independent process returned its operation");
      const { pid, result } = JSON.parse(reply.slice("RIFARE_JOURNAL_WORKER=".length));
      assert.notEqual(pid, process.pid);
      assert.deepEqual(result, await journal.admit(processBytes, admission));
      const processRows = await postgres("rifare_operation").where({ original_command_uuid: processOriginal.command_id });
      assert.equal(processRows.length, 1);
      assert.equal(processRows[0].id, result.id);
      const crashed = { ...command, command_id: randomUUID() };
      const crashBytes = Buffer.from(JSON.stringify(crashed));
      await assert.rejects(worker(true, crashBytes), lostAck);
      const committed = await postgres("rifare_operation").where({ original_command_uuid: crashed.command_id });
      assert.equal(committed.length, 1);
      assert.equal((await journal.admit(crashBytes, admission)).id, committed[0].id);
      check("independent-journal-processes-recover-the-same-original-after-lost-ack", () => {});

      const initialStatus = await journal.status(command.command_id, admission);
      assert.equal(initialStatus.id, first.id);
      assert.equal(initialStatus.revision, 0);
      assert.equal(initialStatus.first_observation_digest, null);
      const recovery = await journal.prepareRecovery(command.command_id, admission);
      assert.deepEqual(recovery, {
        id: first.id, original_command_uuid: command.command_id, command_digest: owned[0].command_digest,
      });
      const otherOwner = {
        ...admission, actor: { actor_type: "customer", actor_id: bob.customer.id, auth_identity_id: bob.identity.id },
      };
      await assert.rejects(journal.status(command.command_id, otherOwner), denied);
      await assert.rejects(journal.prepareRecovery(command.command_id, otherOwner), denied);
      await assert.rejects(journal.observe(command.command_id, 0, otherOwner), denied);
      await assert.rejects(journal.cancel(command.command_id, 0, otherOwner), denied);

      const observed = await journal.observe(command.command_id, 0, admission);
      assert.equal(observed.state, "awaiting_authority");
      assert.equal(observed.revision, 1);
      assert.equal(observed.first_observation_digest, factsDigest({
        profile: "urn:rifare:medusa-journal-cart-observation:v1",
        original_operation_id: first.id,
        original_command_digest: recovery.command_digest,
        cart_facts_digest: lockedFacts.factsDigest,
      }));
      assert.ok(observed.first_observed_at);
      await assert.rejects(journal.observe(command.command_id, 0, admission), /Original commerce command unavailable/);
      assert.equal((await request(`/store/carts/${aliceCart.id}`, alice.token, "POST",
        { shipping_address: { city: "Golden" } })).status, 200);
      assert.notEqual((await observe()).value.observation.facts_digest, lockedFacts.factsDigest);
      assert.deepEqual(await journal.observe(command.command_id, 1, admission), observed);
      assert.deepEqual(await journal.status(command.command_id, admission), observed);
      assert.deepEqual(await journal.prepareRecovery(command.command_id, admission), recovery);

      await assert.rejects(journal.cancel(command.command_id, 0, admission), /Original commerce command unavailable/);
      const cancelled = await journal.cancel(command.command_id, 1, admission);
      assert.equal(cancelled.state, "retired");
      assert.equal(cancelled.revision, 2);
      await assert.rejects(journal.status(command.command_id, admission), denied);
      await assert.rejects(journal.prepareRecovery(command.command_id, admission), denied);
      await assert.rejects(journal.observe(command.command_id, 2, admission), denied);
      await assert.rejects(journal.admit(bytes, admission), /Original commerce command unavailable/);
      const cancelledRow = await postgres("rifare_operation").where({ id: first.id }).first();
      assert.equal(cancelledRow.command_bytes, null);
      assert.equal(cancelledRow.first_observation_digest, null);

      assert.equal(await journal.setPrivacyHold(alice.customer.id, result.id, 0, true, privacyActor), true);
      const heldCancellation = await journal.cancel(processOriginal.command_id, 1, admission);
      assert.equal(heldCancellation.state, "cancelled");
      await assert.rejects(journal.status(processOriginal.command_id, admission), denied);
      assert.equal((await postgres("rifare_operation").where({ id: result.id }).first()).command_bytes, processBytes.toString());
      assert.equal(await journal.setPrivacyHold(alice.customer.id, result.id, 2, false, privacyActor), true);
      assert.equal((await postgres("rifare_operation").where({ id: result.id }).first()).command_bytes, null);
      check("journal-history-first-observation-recovery-and-revision-checked-cancellation", () => {});

      await assert.rejects(journal.exportPrivacySubject(alice.customer.id, admission.actor), denied);
      await assert.rejects(journal.erasePrivacySubject(alice.customer.id, admission.actor), denied);
      await assert.rejects(journal.restorePrivacyRefusals([], admission.actor), denied);
      await assert.rejects(journal.uninstallPrivacyJournal(admission.actor), denied);
      const unrelatedUser = await users.createUsers({ email: "other-" + suffix + "@example.invalid" });
      const unrelatedIdentity = await auth.createAuthIdentities({ app_metadata: { user_id: unrelatedUser.id } });
      await assert.rejects(journal.exportPrivacySubject(alice.customer.id, {
        actor_type: "user", actor_id: unrelatedUser.id, auth_identity_id: unrelatedIdentity.id,
      }), denied);
      await auth.updateAuthIdentities({ id: operatorIdentity.id, app_metadata: { user_id: unrelatedUser.id } });
      await assert.rejects(journal.erasePrivacySubject(alice.customer.id, privacyActor), denied);
      await auth.updateAuthIdentities({ id: operatorIdentity.id, app_metadata: { user_id: operator.id } });
      const exported = await journal.exportPrivacySubject(alice.customer.id, privacyActor);
      assert.ok(exported.some(row => row.id === committed[0].id));
      const exportedStart = exported.find(row => row.id === creators[0].operation.id)!;
      assert.equal(exportedStart.start_command_bytes, retainedStart.command_bytes);
      assert.equal(exportedStart.start_command_digest, retainedStart.command_digest);
      assert.equal(exportedStart.start_correlation, retainedStart.correlation);
      assert.equal(exportedStart.start_owner_digest, beforeClaim.start_owner_digest);
      assert.ok(exportedStart.start_claimed_at);
      assert.equal(JSON.stringify(exportedStart).includes(creators[0].send_ticket!), false);
      assert.equal((await journal.exportPrivacySubject(bob.customer.id, privacyActor)).length, 0);

      const revocation = await postgres.transaction();
      let exportResult: Promise<unknown> | undefined;
      try {
        const { rows: [{ pid }] } = await revocation.raw("select pg_backend_pid() as pid");
        await revocation("auth_identity").where({ id: operatorIdentity.id })
          .update({ app_metadata: JSON.stringify({ user_id: unrelatedUser.id }) });
        let settled = false;
        exportResult = journal.exportPrivacySubject(alice.customer.id, privacyActor)
          .then(() => "disclosed", (error: unknown) => error).finally(() => { settled = true; });
        let blocked = false;
        const deadline = Date.now() + 5000;
        // Refresh pg_stat_activity outside any cached statistics snapshot.
        while (!settled && Date.now() < deadline) {
          await revocation.raw("select pg_stat_clear_snapshot()");
          const { rows } = await revocation.raw(
            "select exists (select 1 from pg_stat_activity where ?::integer = any(pg_blocking_pids(pid))) as blocked",
            [pid],
          );
          blocked = rows[0].blocked;
          if (blocked) break;
          await delay(25);
        }
        assert.equal(blocked, true, "Privacy export must wait on the in-flight operator identity change");
        await revocation.commit();
        const result = await exportResult;
        assert.ok(result instanceof Error);
        assert.match(result.message, denied);
        await assert.rejects(journal.exportPrivacySubject(alice.customer.id, privacyActor), denied);
      } finally {
        if (!revocation.isCompleted()) await revocation.rollback();
        await exportResult;
      }
      await auth.updateAuthIdentities({ id: operatorIdentity.id, app_metadata: { user_id: operator.id } });
      check("journal-privacy-export-waits-for-in-flight-operator-revocation-and-refuses-disclosure", () => {});

      assert.equal(await journal.setPrivacyHold(alice.customer.id, creators[0].operation.id, 2, true, privacyActor), true);
      await journal.erasePrivacySubject(alice.customer.id, privacyActor);
      const heldExports = await journal.exportPrivacySubject(alice.customer.id, privacyActor);
      assert.equal(heldExports.length, 1);
      assert.equal(heldExports[0].start_command_bytes, retainedStart.command_bytes);
      assert.equal(heldExports[0].start_correlation, retainedStart.correlation);
      assert.equal(await journal.setPrivacyHold(alice.customer.id, creators[0].operation.id, 4, false, privacyActor), true);
      const minimizedStart = await authorityRow();
      for (const field of ["start_command_bytes", "start_command_digest", "start_correlation",
        "start_owner_digest", "start_claimed_at"]) assert.equal(minimizedStart[field], null);
      assert.equal((await journal.exportPrivacySubject(alice.customer.id, privacyActor)).length, 0);
      const refusal = { id: "rifop_" + randomUUID(), original_command_uuid: randomUUID(), challenge_fingerprint: null };
      await journal.restorePrivacyRefusals([refusal], privacyActor);
      assert.equal((await postgres("rifare_operation").where({ id: refusal.id }).first()).state, "retired");
      await journal.uninstallPrivacyJournal(privacyActor);
      await assert.rejects(journal.admit(Buffer.from(JSON.stringify({ ...command, cart_id: bobCart.id })), bobContext), denied);
      check("journal-privacy-owner-is-native-scoped-and-rechecked", () => {});
      await assert.rejects(journal.admit(bytes, admission), denied);
      const retired = await postgres("rifare_operation").where({ id: first.id }).first();
      assert.equal(retired.state, "retired");
      assert.equal(retired.command_bytes, null);
      check("journal-admission-is-durable-idempotent-and-privacy-gated", () => {});
    } finally {
      for (const [name, value] of Object.entries(originalEnv)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }

    await carts.updateCarts([{ id: aliceCart.id, completed_at: new Date() }]);
    assert.equal((await observe()).status, 403);
    await carts.updateCarts([{ id: aliceCart.id, completed_at: null }]);
    const order = await orders.createOrders({ currency_code: "usd", region_id: regions[0].id });
    await container.resolve(ContainerRegistrationKeys.LINK).create({ [Modules.ORDER]: { order_id: order.id }, [Modules.CART]: { cart_id: aliceCart.id } });
    const linked = await observe(); assert.equal(linked.status, 403); assert.equal(JSON.stringify(linked.value).includes(order.id), false);
    await assert.rejects(readAdmission(), denied);
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
