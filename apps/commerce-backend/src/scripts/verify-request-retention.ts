import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules, ProductStatus } from "@medusajs/framework/utils";
import { createCartWorkflow, createProductsWorkflow, createRegionsWorkflow,
  createSalesChannelsWorkflow, updateStoresWorkflow } from "@medusajs/medusa/core-flows";
import { configure } from "safe-stable-stringify";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { authorityAdapters } from "../modules/operation-journal/authority-sender";
import { readLockedCartFacts } from "../modules/operation-journal/cart-facts";
import { operationJournalModule } from "../modules/operation-journal";
import type OperationJournalService from "../modules/operation-journal/service";

/** Disposable native journal/cryptography tests. No deployed keys or providers. */
export default async function verifyRequestRetention({ container }: ExecArgs) {
  if (process.env.NODE_ENV !== "test" || process.env.RIFARE_COMMERCE_VERIFY !== "disposable") {
    throw new Error("RIFARE_DISPOSABLE_REQUEST_TEST_REQUIRED");
  }
  const journal = container.resolve<OperationJournalService>(operationJournalModule);
  const postgres = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const stringify = configure({ deterministic: true, strict: true, bigint: false });
  const bytes = (value: unknown) => Buffer.from(stringify(value)!);
  if (process.env.RIFARE_C7_WORKER) {
    const task = JSON.parse(process.env.RIFARE_C7_WORKER);
    const verifier = await journal.createAuthorityRequestVerifier(bytes(task.trust));
    const result = task.mode === "recover" ?
      await journal.recoverVerifiedAuthorityRequest(task.command_id, task.context, verifier) :
      await journal.verifyAuthorityRequest(task.command_id, Buffer.from(task.artifact), task.context, verifier);
    if (task.mode === "retain-lose-ack") process.exit(79);
    console.log("C7_RECOVERED=" + JSON.stringify({ digest: result.request_digest, observed_at: result.first_observed_at }));
    verifier.close(); return;
  }
  const checks: string[] = [];
  const check = async (name: string, run: () => unknown) => {
    await run(); checks.push(name); console.log("REQUEST_RETENTION_CHECK " + name);
  };
  const suffix = randomUUID();
  const stores = container.resolve(Modules.STORE), customers = container.resolve(Modules.CUSTOMER);
  const auth = container.resolve(Modules.AUTH), users = container.resolve(Modules.USER);
  const [store] = await stores.listStores();
  const merchant = { merchant_namespace: "synthetic-request", store_id: store.id };
  const { result: channels } = await createSalesChannelsWorkflow(container).run({ input: {
    salesChannelsData: [{ name: "C7 " + suffix }],
  } });
  await updateStoresWorkflow(container).run({ input: { selector: { id: store.id }, update: {
    supported_currencies: [{ currency_code: "usd", is_default: true }], default_sales_channel_id: channels[0].id,
  } } });
  const { result: regions } = await createRegionsWorkflow(container).run({ input: { regions: [{
    name: "C7 " + suffix, currency_code: "usd", countries: ["us"], automatic_taxes: false,
    payment_providers: ["pp_system_default"],
  }] } });
  const { result: products } = await createProductsWorkflow(container).run({ input: { products: [{
    title: "C7 " + suffix, status: ProductStatus.PUBLISHED, sales_channels: [{ id: channels[0].id }],
    options: [{ title: "Size", values: ["One"] }], variants: [{ title: "One", options: { Size: "One" },
      manage_inventory: false, prices: [{ currency_code: "usd", amount: 12.5 }] }],
  }] } });
  const customer = await customers.createCustomers({ email: "c7-" + suffix + "@example.invalid", has_account: true });
  const identity = await auth.createAuthIdentities({ app_metadata: { customer_id: customer.id } });
  const operator = await users.createUsers({ email: "c7-operator-" + suffix + "@example.invalid" });
  const operatorIdentity = await auth.createAuthIdentities({ app_metadata: { user_id: operator.id } });
  const privacyActor = { actor_type: "user" as const, actor_id: operator.id, auth_identity_id: operatorIdentity.id };
  process.env.RIFARE_MERCHANT_NAMESPACE = merchant.merchant_namespace;
  process.env.RIFARE_NATIVE_STORE_ID = store.id;
  process.env.RIFARE_JOURNAL_PRIVACY_KEY = randomBytes(32).toString("base64url");
  process.env.RIFARE_JOURNAL_PRIVACY_OPERATOR_ID = operator.id;
  const context = { actor: { actor_type: "customer" as const, actor_id: customer.id, auth_identity_id: identity.id },
    salesChannelIds: [channels[0].id] };
  const key = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const correlation = { actor: { id: "urn:rifare:synthetic:machine", type: "MACHINE_IDENTITY" },
    organization_id: randomUUID(), provider_ref: "synthetic-provider" };
  const trust = { profile: "urn:rifare:managed-authorization-request-trust:v1", ...correlation,
    origin: "https://authority.example.invalid", verifier_did: "did:web:verifier.example.invalid",
    client_id: "decentralized_identifier:did:web:verifier.example.invalid", key_id: "did:web:verifier.example.invalid#request",
    key_purpose: "oid4vp_request_signing", algorithm: "ES256", public_jwk: key.publicKey.export({ format: "jwk" }),
    max_lifetime_seconds: 300, dcql_query: { credentials: [{ id: "machine", format: "jwt_vc_json",
      require_cryptographic_holder_binding: true, meta: {
        marty_securing_profile: "marty_nested_vc2_jwt_v1", type_values: [["MachineCredential"]],
      } }] }, client_metadata: { vp_formats_supported: {
      jwt_vc_json: { alg_values_supported: ["ES256", "ES384", "EdDSA", "RS256"] },
      jwt_vp: { alg_values_supported: ["ES256", "ES384", "EdDSA", "RS256"] },
    } } };
  const verifier = await journal.createAuthorityRequestVerifier(bytes(trust));
  const makeOriginal = async (retainChallenge = true, lifetimeSeconds = 120) => {
    const { result: cart } = await createCartWorkflow(container).run({ input: { customer_id: customer.id,
      region_id: regions[0].id, sales_channel_id: channels[0].id,
      items: [{ variant_id: products[0].variants[0].id, quantity: 1 }],
    } });
    const facts = await postgres.transaction(tx => readLockedCartFacts(tx, cart.id, merchant, context), { isolationLevel: "serializable" });
    const command = { cart_facts_digest: facts.factsDigest, cart_id: cart.id, command_id: randomUUID(),
      currency: "usd", currency_exponent: 2, kind: "prepare_purchase", payable_minor_units: facts.facts.payable_total_minor,
      profile: "urn:rifare:medusa-original-operation:v1" };
    const descriptor = { correlation, grant: { id: randomUUID(), revision: 1, terms_digest: "sha256:" + "a".repeat(64) } };
    const now = Date.now(), challenge = randomUUID();
    if (retainChallenge) {
    const admitted = await journal.admitForAuthority(bytes(command), context);
    assert.ok(admitted.send_ticket);
    const start = await journal.retainAuthorityStart(command.command_id, admitted.send_ticket!, bytes(descriptor), context);
    const response = { profile: "urn:marty:delegation-command-response:v1", original_command_id: command.command_id,
      command_digest: start.command_digest, recovered: false, result: { kind: "CHALLENGE", challenge_id: challenge,
        grant: JSON.parse(start.command_bytes).grant, operation: JSON.parse(start.command_bytes).operation,
        created_at: new Date(now - 1000).toISOString(), expires_at: new Date(now + lifetimeSeconds * 1000).toISOString() } };
    await journal.observeAuthorityResponse(command.command_id, bytes(response), false, context);
    }
    const artifact = (nonce = "synthetic-" + randomUUID()) => {
      const header = bytes({ alg: "ES256", kid: trust.key_id, typ: "oauth-authz-req+jwt" }).toString("base64url");
      const payload = bytes({ aud: "https://self-issued.me/v2", client_id: trust.client_id, iss: trust.client_id,
        iat: Math.floor(now / 1000), exp: Math.floor((now + lifetimeSeconds * 1000) / 1000), nonce, state: challenge,
        response_type: "vp_token", response_mode: "direct_post", response_uri: trust.origin + "/v1/flows/instances/" + challenge + "/submit",
        dcql_query: trust.dcql_query, client_metadata: trust.client_metadata }).toString("base64url");
      const input = header + "." + payload;
      return Buffer.from(input + "." + sign("sha256", Buffer.from(input), { key: key.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url"));
    };
    return { command, cart, artifact, descriptor, row: () => postgres("rifare_operation").where({ original_command_uuid: command.command_id }).first() };
  };
  const runWorker = (task: unknown) => new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["run.mjs", "exec", __filename], { cwd: process.cwd(),
      env: { ...process.env, RIFARE_C7_WORKER: JSON.stringify(task) }, stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; for (const stream of [child.stdout, child.stderr]) stream.on("data", data => { output = (output + data).slice(-16000); });
    child.once("error", reject); child.once("exit", code => resolve({ code, output }));
  });
  await check("C7-NATIVE-FIRST exact signed bytes and verification context commit once with original time", async () => {
    const fixture = await makeOriginal(), artifact = fixture.artifact();
    await assert.rejects(journal.verifyAuthorityRequest(fixture.command.command_id, Buffer.from("unverified"), context, verifier));
    assert.equal((await fixture.row()).request_bytes, null);
    await assert.rejects(postgres("rifare_operation").where({ original_command_uuid: fixture.command.command_id })
      .update({ request_nonce: "orphan" }), /rifare_operation_request_tuple/);
    const first = await journal.verifyAuthorityRequest(fixture.command.command_id, artifact, context, verifier);
    const stored = await fixture.row(); assert.equal(stored.request_bytes, artifact.toString());
    assert.equal(stored.request_digest, "sha256:" + createHash("sha256").update(artifact).digest("hex"));
    assert.match(stored.request_context_digest, /^sha256:[a-f0-9]{64}$/); assert.ok(stored.request_nonce);
    assert.equal(first.request_digest, stored.request_digest);
    const retry = await journal.verifyAuthorityRequest(fixture.command.command_id, artifact, context, verifier);
    assert.equal(new Date(retry.first_observed_at).getTime(), new Date(first.first_observed_at).getTime());
    assert.deepEqual(await fixture.row(), stored);
    await assert.rejects(journal.verifyAuthorityRequest(fixture.command.command_id, fixture.artifact(), context, verifier));
    const changed = await journal.createAuthorityRequestVerifier(bytes({ ...trust, max_lifetime_seconds: 299 }));
    await assert.rejects(journal.verifyAuthorityRequest(fixture.command.command_id, artifact, context, changed)); changed.close();
  });
  await check("C7-NATIVE-RACE two different valid signed requests have one immutable native winner", async () => {
    const fixture = await makeOriginal(), artifacts = [fixture.artifact(), fixture.artifact()];
    const results = await Promise.allSettled(artifacts.map(artifact => journal.verifyAuthorityRequest(fixture.command.command_id, artifact, context, verifier)));
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    const row = await fixture.row(), winner = artifacts.find(value => value.toString() === row.request_bytes);
    assert.ok(winner); await journal.verifyAuthorityRequest(fixture.command.command_id, winner!, context, verifier);
    for (const artifact of artifacts.filter(value => value !== winner)) await assert.rejects(journal.verifyAuthorityRequest(fixture.command.command_id, artifact, context, verifier));
  });
  await check("C7-NATIVE-ORIGINAL signed request cannot cross the journal original or current customer association", async () => {
    const first = await makeOriginal(), second = await makeOriginal();
    await assert.rejects(journal.verifyAuthorityRequest(second.command.command_id, first.artifact(), context, verifier));
    await auth.updateAuthIdentities({ id: identity.id, app_metadata: { customer_id: "cus_other" } });
    await assert.rejects(journal.verifyAuthorityRequest(first.command.command_id, first.artifact(), context, verifier));
    await auth.updateAuthIdentities({ id: identity.id, app_metadata: { customer_id: customer.id } });
    assert.equal((await first.row()).request_bytes, null); assert.equal((await second.row()).request_bytes, null);
  });
  await check("C7-NATIVE-ROLLBACK failed deferred COMMIT retains no partial verified artifact", async () => {
    const fixture = await makeOriginal(), artifact = fixture.artifact(), before = await fixture.row();
    await postgres.raw(`create function public.c7_fail_request_commit() returns trigger language plpgsql as $$ begin
      if new.original_command_uuid = '${fixture.command.command_id}' and new.request_bytes is not null then
      raise exception 'C7_TEST_COMMIT_FAILURE'; end if; return new; end $$`);
    await postgres.raw("create constraint trigger c7_request_commit after update on rifare_operation deferrable initially deferred for each row execute function public.c7_fail_request_commit()");
    try { await assert.rejects(journal.verifyAuthorityRequest(fixture.command.command_id, artifact, context, verifier), /C7_TEST_COMMIT_FAILURE/); }
    finally { await postgres.raw("drop trigger c7_request_commit on rifare_operation; drop function public.c7_fail_request_commit()"); }
    assert.deepEqual(await fixture.row(), before);
    await journal.verifyAuthorityRequest(fixture.command.command_id, artifact, context, verifier);
  });
  await check("C7-NATIVE-RESTART acknowledgement loss and fresh process recover the same first artifact", async () => {
    const fixture = await makeOriginal(), artifact = fixture.artifact();
    const task = { trust, command_id: fixture.command.command_id, context };
    const lost = await runWorker({ ...task, artifact: artifact.toString(), mode: "retain-lose-ack" });
    assert.equal(lost.code, 79, lost.output); const row = await fixture.row(); assert.equal(row.request_bytes, artifact.toString());
    const recovered = await runWorker({ ...task, mode: "recover" }); assert.equal(recovered.code, 0, recovered.output);
    assert.ok(recovered.output.includes(row.request_digest)); assert.deepEqual(await fixture.row(), row);
  });
  await check("C7-NATIVE-CLOSE verifier retirement during a real blocked native write rolls back retention", async () => {
    const fixture = await makeOriginal(), selected = await journal.createAuthorityRequestVerifier(bytes(trust));
    const blocker = await postgres.transaction(); await blocker("rifare_operation").where({ original_command_uuid: fixture.command.command_id }).forUpdate().first();
    const pending = journal.verifyAuthorityRequest(fixture.command.command_id, fixture.artifact(), context, selected);
    const rejected = assert.rejects(pending, /REQUEST_TRUST_RETIRED/);
    try {
      let blocked = false; for (let n = 0; n < 100; n++) {
        const result = await postgres.raw("select 1 from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and wait_event_type='Lock' and query like 'update %rifare_operation%'");
        if (result.rows.length) { blocked = true; break; } await delay(20);
      }
      assert.ok(blocked, "actual request-retention UPDATE must wait on the owned row"); selected.close();
    } finally { await blocker.commit(); }
    await rejected; assert.equal((await fixture.row()).request_bytes, null);
  });
  await check("C7-NATIVE-COMMIT-EXPIRY late COMMIT retains original evidence but returns no current verification", async () => {
    const fixture = await makeOriginal(true, 3), artifact = fixture.artifact();
    await postgres.raw(`create function public.c7_delay_request_commit() returns trigger language plpgsql as $$ begin
      if new.original_command_uuid = '${fixture.command.command_id}' and new.request_bytes is not null then
      perform pg_sleep(3.2); end if; return new; end $$`);
    await postgres.raw("create constraint trigger c7_request_delay after update on rifare_operation deferrable initially deferred for each row execute function public.c7_delay_request_commit()");
    try { await assert.rejects(journal.verifyAuthorityRequest(fixture.command.command_id, artifact, context, verifier)); }
    finally { await postgres.raw("drop trigger c7_request_delay on rifare_operation; drop function public.c7_delay_request_commit()"); }
    const row = await fixture.row(); assert.equal(row.request_bytes, artifact.toString());
    await assert.rejects(journal.recoverVerifiedAuthorityRequest(fixture.command.command_id, context, verifier));
    assert.deepEqual(await fixture.row(), row);
  });
  await check("C7-NATIVE-WIRE actual C6 recovery and mTLS retrieval compose with original-bound native verification", async () => {
    const fixture = await makeOriginal(false);
    const helpers = await import(pathToFileURL(resolve(process.cwd(), "../../tests/development/delegated-use-client-helpers.mts")).href);
    const peer = await helpers.delegatedUsePeer();
    const selectedTrust = { ...trust, ...peer.correlation, origin: peer.config.origin };
    const selected = await journal.createAuthorityRequestVerifier(bytes(selectedTrust));
    const transport = await journal.createAuthorityTransport(peer.config);
    const { codec } = await authorityAdapters();
    let retainedResponse: any, compact = "", claims: any;
    const signedArtifact = () => {
      const input = bytes({ alg: "ES256", kid: trust.key_id, typ: "oauth-authz-req+jwt" }).toString("base64url") + "." + bytes(claims).toString("base64url");
      return input + "." + sign("sha256", Buffer.from(input), { key: key.privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
    };
    peer.setHandler((request: any, response: any) => {
      response.statusCode = 200;
      if (request.method === "GET") {
        response.setHeader("content-type", "application/oauth-authz-req+jwt"); response.setHeader("cache-control", "no-store");
        response.setHeader("pragma", "no-cache"); response.setHeader("x-content-type-options", "nosniff"); response.end(compact); return;
      }
      const command = JSON.parse(request.raw.toString());
      if (command.command === "START_USE") {
        const now = Date.now(), challenge = randomUUID();
        retainedResponse = { profile: "urn:marty:delegation-command-response:v1", original_command_id: command.command_id,
          command_digest: codec.encodeDelegatedCommand(command).command_digest, recovered: false,
          result: { kind: "CHALLENGE", challenge_id: challenge, grant: command.grant, operation: command.operation,
            created_at: new Date(now - 1000).toISOString(), expires_at: new Date(now + 120000).toISOString() } };
        claims = { aud: "https://self-issued.me/v2", client_id: trust.client_id, iss: trust.client_id, iat: Math.floor(now / 1000),
          exp: Math.floor((now + 120000) / 1000), nonce: "synthetic-c7-wire-" + randomUUID(), state: challenge,
          response_mode: "direct_post", response_type: "vp_token", response_uri: peer.config.origin + "/v1/flows/instances/" + challenge + "/submit",
          dcql_query: trust.dcql_query, client_metadata: trust.client_metadata };
        compact = signedArtifact(); response.destroy(); return;
      }
      assert.equal(command.command, "RECOVER_RESULT"); assert.ok(retainedResponse);
      response.setHeader("content-type", "application/json");
      response.setHeader("link", "<" + peer.config.origin + "/v1/flows/instances/" + retainedResponse.result.challenge_id + '/request>; rel="urn:marty:delegated-use:request"');
      response.end(JSON.stringify({ ...retainedResponse, recovered: true }));
    });
    const descriptor = bytes({ ...fixture.descriptor, correlation: peer.correlation });
    let first: any, session: any, other: any;
    try {
      first = await journal.openVerifiedAuthoritySession(bytes(fixture.command), descriptor, context, transport, selected);
      await assert.rejects(first.start()); first.close();
      session = await journal.openVerifiedAuthoritySession(bytes(fixture.command), descriptor, context, transport, selected);
      const challenge = await session.recover(); const handle = await session.verifyRequest(challenge);
      assert.equal((await fixture.row()).request_bytes, compact);
      assert.equal(JSON.parse((await fixture.row()).start_response_bytes).recovered, true);
      const current = await session.describeVerifiedRequest(handle); assert.equal(current.execution_authorized, false);
      other = await journal.openVerifiedAuthoritySession(bytes(fixture.command), descriptor, context, transport, selected);
      await assert.rejects(other.describeVerifiedRequest(handle), /Verified authority session is unavailable/);
      await assert.rejects(session.describeVerifiedRequest(structuredClone(handle)), /Verified authority session is unavailable/);
      await other.recoverVerifiedRequest();
      claims.nonce = "synthetic-replacement"; compact = signedArtifact();
      await assert.rejects(session.verifyRequest(challenge));
      assert.equal(peer.requests.filter((request: any) => request.method === "POST" && JSON.parse(request.raw.toString()).command === "START_USE").length, 1);
      assert.equal(peer.requests.filter((request: any) => request.method === "GET").length, 2);
    } finally { first?.close(); session?.close(); other?.close(); selected.close(); transport.close(); await peer.close(); }
  });
  await check("C7-NATIVE-PRIVACY holds export exact request while erasure and hold release minimize it", async () => {
    const held = await makeOriginal(), ordinary = await makeOriginal();
    await journal.verifyAuthorityRequest(held.command.command_id, held.artifact(), context, verifier);
    await journal.verifyAuthorityRequest(ordinary.command.command_id, ordinary.artifact(), context, verifier);
    const restoreSnapshot = await ordinary.row();
    const privacySnapshot = await postgres("rifare_operation_privacy_subject").select("*");
    let heldRow = await held.row();
    assert.equal(await journal.setPrivacyHold(customer.id, heldRow.id, heldRow.revision, true, privacyActor), true);
    const exported = await journal.exportPrivacySubject(customer.id, privacyActor);
    assert.ok(exported.find(row => row.id === heldRow.id)?.request_bytes);
    await journal.erasePrivacySubject(customer.id, privacyActor);
    heldRow = await held.row(); const erased = await ordinary.row();
    assert.ok(heldRow.request_bytes); assert.equal(erased.request_bytes, null); assert.equal(erased.request_nonce, null);
    await assert.rejects(journal.recoverVerifiedAuthorityRequest(held.command.command_id, context, verifier));
    assert.equal(await journal.setPrivacyHold(customer.id, heldRow.id, heldRow.revision, false, privacyActor), true);
    const released = await held.row();
    for (const column of ["request_bytes", "request_digest", "request_context_digest", "request_nonce", "request_observed_at", "request_expires_at"]) {
      assert.equal(released[column], null); assert.equal(erased[column], null);
    }
    // Recreate a paused old checkpoint, then apply current outside erasure facts
    // before any operation can be served from that restored checkpoint.
    await postgres("rifare_operation").where({ id: restoreSnapshot.id }).update(restoreSnapshot);
    await postgres.transaction(async tx => {
      await tx("rifare_operation_privacy_subject").delete(); await tx("rifare_operation_privacy_subject").insert(privacySnapshot);
    });
    await journal.reconcilePrivacyRestore([], [customer.id], privacyActor);
    assert.equal((await ordinary.row()).request_bytes, null);
    await assert.rejects(journal.recoverVerifiedAuthorityRequest(ordinary.command.command_id, context, verifier));
    // A second paused restore receives the installation's current uninstall fact.
    await postgres("rifare_operation").where({ id: restoreSnapshot.id }).update(restoreSnapshot);
    await journal.reconcilePrivacyRestore([], [], privacyActor, { installationUninstalled: true });
    assert.equal((await ordinary.row()).request_bytes, null);
    await assert.rejects(journal.recoverVerifiedAuthorityRequest(ordinary.command.command_id, context, verifier));
  });
  verifier.close();
  console.log(JSON.stringify({ result: "pass", checks, count: checks.length,
    scope: "native-postgres-selected-request-retention", connected_qualified: false, execution_authorized: false }));
}
