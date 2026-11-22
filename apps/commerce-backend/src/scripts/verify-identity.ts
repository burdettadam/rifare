import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, createHmac, generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import type { ExecArgs } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import { createApiKeysWorkflow } from "@medusajs/medusa/core-flows";

const origin = "http://127.0.0.1:19037";
const issuer = "http://127.0.0.1:19036/auth/v1";
const callback = `${origin}/auth/customer/external-oidc/callback`;
const clientId = "0ec47ca0-0a91-43e8-a14b-2144156a9ed0"; // Synthetic UUID, not a registered client.
const clientSecret = "synthetic-rifare-secret-not-for-production-with+colon:";
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const decode = (token: string) => JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());

/** Independent synthetic peer uses Node crypto, not the adapter's OIDC library.
 * Actual PostgreSQL persistence and native Medusa HTTP routes are under test.
 */
export default async function verifyIdentity({ container }: ExecArgs) {
  if (process.env.NODE_ENV !== "test" || process.env.RIFARE_COMMERCE_VERIFY !== "disposable") {
    throw new Error("RIFARE_DISPOSABLE_IDENTITY_TEST_REQUIRED");
  }
  const checks: string[] = [];
  const check = (name: string, assertions: () => void) => {
    assertions(); checks.push(name); console.log(`IDENTITY_CHECK ${name}`);
  };
  const suffix = randomUUID();
  const subject = `synthetic-subject-${suffix}`;
  const email = `synthetic-${suffix}@example.invalid`;
  const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const wrongRsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const rsaJwk = { ...rsa.publicKey.export({ format: "jwk" }), kid: "synthetic-rsa", alg: "RS256", use: "sig" };
  const ecJwk = { ...ec.publicKey.export({ format: "jwk" }), kid: "synthetic-ec", alg: "ES256", use: "sig" };
  type Scenario = { claims?: Record<string, unknown>; wrongSignature?: boolean; wrongAlgorithm?: boolean; missingIdToken?: boolean };
  let scenario: Scenario = {};
  let exchanges = 0;
  let discoveryCount = 0;
  let jwksCount = 0;
  const codes = new Map<string, { parameters: URLSearchParams; scenario: Scenario }>();
  const peer = createServer(async (req, res) => {
    const url = new URL(req.url!, issuer);
    res.setHeader("content-type", "application/json");
    try {
      if (url.pathname === "/auth/v1/.well-known/openid-configuration") {
        discoveryCount++;
        res.end(JSON.stringify({ issuer, authorization_endpoint: `${issuer}/oauth/authorize`,
          token_endpoint: `${issuer}/oauth/token`, jwks_uri: `${issuer}/.well-known/jwks.json`,
          response_types_supported: ["code"], subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256", "ES256", "HS256"],
          token_endpoint_auth_methods_supported: ["client_secret_post"],
          code_challenge_methods_supported: ["S256", "plain"], authorization_response_iss_parameter_supported: true,
        }));
      } else if (url.pathname === "/auth/v1/.well-known/jwks.json") {
        jwksCount++; res.end(JSON.stringify({ keys: [rsaJwk, ecJwk] }));
      } else if (url.pathname === "/auth/v1/oauth/authorize") {
        assert.equal(url.searchParams.get("client_id"), clientId);
        assert.equal(url.searchParams.get("redirect_uri"), callback);
        assert.equal(url.searchParams.get("response_type"), "code");
        assert.equal(url.searchParams.get("scope"), "openid email");
        assert.equal(url.searchParams.get("code_challenge_method"), "S256");
        for (const name of ["state", "nonce", "code_challenge"]) assert.match(url.searchParams.get(name)!, /^[A-Za-z0-9_-]{43}$/);
        const code = randomBytes(32).toString("base64url");
        codes.set(code, { parameters: url.searchParams, scenario });
        const destination = new URL(callback);
        destination.search = new URLSearchParams({ code, state: url.searchParams.get("state")!, iss: issuer }).toString();
        res.writeHead(302, { location: destination.href }); res.end();
      } else if (url.pathname === "/auth/v1/oauth/token" && req.method === "POST") {
        exchanges++;
        assert.equal(req.headers.authorization, undefined);
        let body = ""; for await (const chunk of req) body += chunk;
        const parameters = new URLSearchParams(body);
        assert.equal(parameters.get("client_id"), clientId);
        assert.equal(parameters.get("client_secret"), clientSecret);
        const code = parameters.get("code")!;
        const pending = codes.get(code); codes.delete(code);
        assert.ok(pending, "unknown or replayed peer code");
        assert.equal(parameters.get("grant_type"), "authorization_code");
        assert.equal(parameters.get("redirect_uri"), callback);
        const challenge = createHash("sha256").update(parameters.get("code_verifier")!).digest("base64url");
        assert.equal(challenge, pending.parameters.get("code_challenge"));
        const now = Math.floor(Date.now() / 1000);
        const claims = { iss: issuer, sub: subject, aud: clientId, iat: now, exp: now + 600,
          nonce: pending.parameters.get("nonce"), email, email_verified: true,
          role: "admin", app_metadata: { user_id: "user_attacker", merchant_id: "merchant_attacker" },
          user_metadata: { role: "admin", email: "untrusted@example.invalid" }, ...pending.scenario.claims };
        const useEc = pending.scenario.wrongAlgorithm;
        const header = { alg: useEc ? "ES256" : "RS256", kid: useEc ? "synthetic-ec" : "synthetic-rsa" };
        const signingInput = `${encode(header)}.${encode(claims)}`;
        const key = useEc ? { key: ec.privateKey, dsaEncoding: "ieee-p1363" as const } :
          pending.scenario.wrongSignature ? wrongRsa.privateKey : rsa.privateKey;
        const idToken = `${signingInput}.${sign("sha256", Buffer.from(signingInput), key).toString("base64url")}`;
        res.end(JSON.stringify({ access_token: "synthetic-access-token-must-not-persist", token_type: "Bearer", expires_in: 600,
          refresh_token: "synthetic-refresh-token-must-not-persist", scope: "openid email",
          ...(pending.scenario.missingIdToken ? {} : { id_token: idToken }) }));
      } else { res.statusCode = 404; res.end("{}"); }
    } catch { res.statusCode = 400; res.end(JSON.stringify({ error: "invalid_request" })); }
  });
  await new Promise<void>((resolve, reject) => { peer.once("error", reject); peer.listen(19036, "127.0.0.1", resolve); });
  const auth = container.resolve(Modules.AUTH);
  const users = container.resolve(Modules.USER);
  const operatorEmail = `operator-${suffix}@example.invalid`;
  const password = randomBytes(32).toString("base64url");
  const operator = await users.createUsers({ email: operatorEmail });
  const registration = await auth.register("emailpass", { body: { email: operatorEmail, password } });
  assert.ok(registration.authIdentity);
  await auth.updateAuthIdentities({ id: registration.authIdentity.id, app_metadata: { user_id: operator.id } });
  const { result: keys } = await createApiKeysWorkflow(container).run({ input: { api_keys: [{
    title: `Synthetic identity ${suffix}`, type: "publishable", created_by: "rifare-local-verification",
  }] } });
  const server = spawn(process.execPath, ["run.mjs", "start", "--port", "19037"], {
    cwd: process.cwd(), env: { ...process.env, NODE_ENV: "test", DISABLE_MEDUSA_ADMIN: "true", RIFARE_WEB_ORIGIN: origin,
      RIFARE_IDENTITY_PROVIDER: "synthetic-oidc", RIFARE_OIDC_ISSUER: issuer, RIFARE_OIDC_CLIENT_ID: clientId,
      RIFARE_OIDC_CLIENT_SECRET: clientSecret, RIFARE_OIDC_CALLBACK_URL: callback, RIFARE_OIDC_SIGNING_ALG: "RS256" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverLog = "";
  for (const stream of [server.stdout, server.stderr]) stream.on("data", (chunk) => { serverLog = (serverLog + chunk).slice(-16000); });
  const serverExit = new Promise<void>((resolve) => server.once("exit", () => resolve()));
  const request = async (path: string, options: { method?: string; body?: unknown; cookie?: string; token?: string; origin?: string } = {}) => {
    const response = await fetch(path.startsWith(origin) ? path : origin + path, {
      method: options.method ?? "GET", redirect: "error", signal: AbortSignal.timeout(15000),
      headers: { "content-type": "application/json", "x-publishable-api-key": keys[0].token,
        ...(options.origin === "omit" ? {} : { origin: options.origin ?? origin }),
        ...(options.cookie ? { cookie: options.cookie } : {}), ...(options.token ? { authorization: `Bearer ${options.token}` } : {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    let value: any; try { value = JSON.parse(text); } catch { value = { message: text.slice(0, 300) }; }
    return { status: response.status, value, headers: response.headers };
  };
  const begin = async (nextScenario: Scenario = {}, cookie?: string) => {
    scenario = nextScenario;
    const start = await request("/auth/customer/external-oidc", { method: "POST", body: {}, cookie });
    assert.equal(start.status, 200, `begin: ${JSON.stringify(start.value)}; ${serverLog}`);
    assert.ok(start.value.location);
    const responseCookie = start.headers.get("set-cookie");
    const browser = responseCookie?.split(";", 1)[0] ?? cookie!;
    assert.ok(browser);
    if (responseCookie) {
      assert.match(responseCookie, /HttpOnly/); assert.match(responseCookie, /SameSite=Lax/);
      assert.match(responseCookie, /Max-Age=300/); assert.doesNotMatch(responseCookie, /Domain=/);
    }
    const authorized = await fetch(start.value.location, { redirect: "manual", signal: AbortSignal.timeout(10000) });
    assert.equal(authorized.status, 302);
    return { cookie: browser, url: authorized.headers.get("location")!, location: start.value.location };
  };
  const login = async (input: Scenario = {}, cookie?: string) => {
    const flow = await begin(input, cookie);
    return { ...await request(flow.url, { cookie: flow.cookie }), flow };
  };
  try {
    const deadline = Date.now() + 45000;
    let healthy = false;
    while (Date.now() < deadline && server.exitCode === null) {
      try { healthy = (await fetch(origin + "/health", { signal: AbortSignal.timeout(1000) })).ok; } catch { /* startup */ }
      if (healthy) break; await delay(100);
    }
    assert.ok(healthy, `Local Medusa HTTP startup failed: ${serverLog}`);
    for (const options of [{ method: "GET" }, { method: "POST", body: {}, origin: "omit" },
      { method: "POST", body: {}, origin: "https://attacker.invalid" },
      { method: "POST", body: { callback_url: "https://attacker.invalid" } }]) {
      assert.equal((await request("/auth/customer/external-oidc", options)).status, 403);
    }
    checks.push("login-requires-post-origin-and-fixed-callback");

    const pending = await begin();
    const beforeWrongBrowser = exchanges;
    const wrongBrowser = `rifare_oidc_browser=${randomBytes(32).toString("base64url")}`;
    const wrong = await request(pending.url, { cookie: wrongBrowser });
    check("wrong-browser-cannot-consume-or-complete-login", () => {
      assert.equal(wrong.status, 401); assert.equal(exchanges, beforeWrongBrowser);
    });
    assert.equal((await request(pending.url)).status, 403);
    const duplicate = new URL(pending.url); duplicate.searchParams.append("state", duplicate.searchParams.get("state")!);
    assert.equal((await request(duplicate.href, { cookie: pending.cookie })).status, 403);
    assert.equal((await request(pending.url, { method: "POST", body: { state: new URL(pending.url).searchParams.get("state") }, cookie: pending.cookie })).status, 403);
    for (const actor of ["user", "admin", "unknown"]) {
      assert.equal((await request(pending.url.replace("/customer/", `/${actor}/`), { cookie: pending.cookie })).status, 403);
    }
    for (const operation of ["register", "update", "reset-password"]) {
      assert.equal((await request(`/auth/customer/external-oidc/${operation}`, { method: "POST", body: {}, cookie: pending.cookie })).status, 403);
    }
    checks.push("ambiguous-input-and-actor-substitution-refused");
    const first = await request(pending.url, { cookie: pending.cookie });
    assert.equal(first.status, 200, `${JSON.stringify(first.value)}; ${serverLog}`);
    const firstClaims = decode(first.value.token);
    check("signed-code-flow-uses-discovery-jwks-and-limited-customer-token", () => {
      assert.ok(discoveryCount > 0); assert.ok(jwksCount > 0);
      assert.equal(firstClaims.actor_type, "customer"); assert.equal(firstClaims.actor_id, "");
      assert.equal(firstClaims.exp - firstClaims.iat, 300);
      assert.deepEqual(firstClaims.user_metadata, { email, email_verified: true });
      assert.equal(firstClaims.app_metadata.user_id, undefined); assert.equal(firstClaims.app_metadata.merchant_id, undefined);
    });
    const stored = await auth.retrieveAuthIdentity(firstClaims.auth_identity_id, { relations: ["provider_identities"] });
    const identity = stored.provider_identities!.find((item) => item.provider === "external-oidc")!;
    check("native-postgres-identity-retains-only-verified-subject-and-email", () => {
      assert.match(identity.entity_id, /^oidc:[a-f0-9]{64}$/);
      assert.deepEqual(identity.provider_metadata, { issuer, subject });
      assert.deepEqual(identity.user_metadata, { email, email_verified: true });
    });
    assert.equal((await request(pending.url, { cookie: pending.cookie })).status, 401);
    checks.push("completed-state-is-single-use");

    const concurrent = await begin();
    const beforeConcurrent = exchanges;
    const raced = await Promise.all([request(concurrent.url, { cookie: concurrent.cookie }), request(concurrent.url, { cookie: concurrent.cookie })]);
    check("concurrent-callbacks-exchange-only-once", () => {
      assert.deepEqual(raced.map((result) => result.status).sort(), [200, 401]); assert.equal(exchanges - beforeConcurrent, 1);
    });
    for (const [name, mutation] of [
      ["bad-signature", { wrongSignature: true }], ["bad-algorithm", { wrongAlgorithm: true }],
      ["bad-issuer", { claims: { iss: "https://attacker.invalid/auth/v1" } }],
      ["bad-audience", { claims: { aud: "another-client" } }], ["bad-nonce", { claims: { nonce: "wrong" } }],
      ["expired-id-token", { claims: { exp: Math.floor(Date.now() / 1000) - 120 } }],
      ["missing-id-token", { missingIdToken: true }], ["unverified-email", { claims: { email_verified: false } }],
      ["string-email-verification", { claims: { email_verified: "true" } }],
      ["missing-email", { claims: { email: null } }], ["missing-subject", { claims: { sub: "" } }],
    ] as const) {
      const result = await login(mutation);
      assert.equal(result.status, 401, name); assert.equal(result.value.token, undefined, name);
      checks.push(name);
    }
    const wrongState = await begin();
    const wrongStateUrl = new URL(wrongState.url); wrongStateUrl.searchParams.set("state", randomBytes(32).toString("base64url"));
    const beforeWrongState = exchanges;
    assert.equal((await request(wrongStateUrl.href, { cookie: wrongState.cookie })).status, 401);
    assert.equal(exchanges, beforeWrongState);
    assert.equal((await request(wrongState.url, { cookie: wrongState.cookie })).status, 200);
    checks.push("unknown-state-does-not-consume-pending-login");

    const mismatchedEmail = await request("/store/customers", { method: "POST", token: first.value.token, body: { email: "other@example.invalid" } });
    assert.equal(mismatchedEmail.status, 401);
    const account = await request("/store/customers", { method: "POST", token: first.value.token, body: { email, first_name: "Synthetic" } });
    assert.equal(account.status, 200, JSON.stringify(account.value));
    const customer = account.value.customer;
    const repeated = await login({}, pending.cookie);
    assert.equal(repeated.status, 200);
    const customerClaims = decode(repeated.value.token);
    check("native-customer-creation-and-repeat-login-retain-stable-binding", () => {
      assert.equal(customerClaims.auth_identity_id, firstClaims.auth_identity_id);
      assert.equal(customerClaims.actor_id, customer.id); assert.equal(customer.has_account, true);
    });
    const me = await request("/store/customers/me", { token: repeated.value.token });
    assert.equal(me.status, 200); assert.equal(me.value.customer.id, customer.id);
    const collision = await login({ claims: { sub: `different-${subject}` } });
    assert.equal(collision.status, 200);
    assert.notEqual(decode(collision.value.token).auth_identity_id, firstClaims.auth_identity_id);
    assert.equal(decode(collision.value.token).actor_id, "");
    const collisionAccount = await request("/store/customers", { method: "POST", token: collision.value.token, body: { email } });
    assert.equal(collisionAccount.status, 422); // Native DUPLICATE_ERROR HTTP mapping.
    assert.equal(collisionAccount.value.type, "duplicate_error");
    const collisionIdentity = await auth.retrieveAuthIdentity(decode(collision.value.token).auth_identity_id);
    assert.equal(collisionIdentity.app_metadata?.customer_id, undefined);
    checks.push("same-email-different-subject-cannot-take-over-customer");
    const changedEmail = await login({ claims: { email: `changed-${email}` } });
    assert.equal(changedEmail.status, 200); assert.equal(decode(changedEmail.value.token).actor_id, customer.id);
    const unchangedCustomer = await request("/store/customers/me", { token: changedEmail.value.token });
    assert.equal(unchangedCustomer.value.customer.email, email);
    checks.push("provider-email-change-never-reassigns-or-rewrites-customer");
    assert.equal((await request("/admin/users/me", { token: repeated.value.token })).status, 401);
    for (const path of ["/auth/session", "/auth/token/refresh"]) {
      const response = await request(path, { method: "POST", token: repeated.value.token, body: {} });
      assert.equal(response.status, 403); assert.equal(response.value.code, "RIFARE_CUSTOMER_REAUTHENTICATION_REQUIRED");
    }
    assert.equal((await request("/auth/mfa/factors", { token: repeated.value.token })).status, 401);
    assert.equal((await request("/auth/mfa/challenges/synthetic/verify", { method: "POST", token: repeated.value.token, body: { code: "000000" } })).status, 401);
    checks.push("customer-cannot-become-operator-or-extend-login-via-session-refresh-mfa");
    // Sign an already-expired synthetic application token with this disposable
    // environment's own secret; this checks native expiry without a five-minute sleep.
    const expiredInput = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ ...customerClaims, exp: Math.floor(Date.now() / 1000) - 60 })}`;
    const expired = `${expiredInput}.${createHmac("sha256", process.env.JWT_SECRET!).update(expiredInput).digest("base64url")}`;
    assert.equal((await request("/store/customers/me", { token: expired })).status, 401);
    checks.push("native-store-api-rejects-expired-application-credential");

    const operatorLogin = await request("/auth/user/emailpass", { method: "POST", body: { email: operatorEmail, password } });
    assert.equal(operatorLogin.status, 200);
    assert.equal((await request("/admin/users/me", { token: operatorLogin.value.token })).status, 200);
    assert.equal((await request("/auth/token/refresh", { method: "POST", token: operatorLogin.value.token, body: {} })).status, 200);
    const session = await request("/auth/session", { method: "POST", token: operatorLogin.value.token, body: {} });
    assert.equal(session.status, 200); assert.ok(session.headers.get("set-cookie"));
    const operatorCookie = session.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
    assert.equal((await request("/admin/users/me", { cookie: operatorCookie })).status, 200);
    assert.equal((await request("/auth/token/refresh", { method: "POST", cookie: operatorCookie, body: {} })).status, 200);
    assert.equal((await request("/auth/session", { method: "DELETE", cookie: operatorCookie })).status, 200);
    assert.equal((await request("/admin/users/me", { cookie: operatorCookie })).status, 401);
    checks.push("native-operator-login-bearer-refresh-session-use-and-logout-preserved");
    const unassociatedUser = await request("/auth/user/emailpass/register", { method: "POST", body: {
      email: `unassociated-${suffix}@example.invalid`, password,
    } });
    assert.equal(unassociatedUser.status, 200);
    assert.equal(decode(unassociatedUser.value.token).actor_id, "");
    for (const path of ["/auth/session", "/auth/token/refresh"]) {
      assert.equal((await request(path, { method: "POST", token: unassociatedUser.value.token, body: {} })).status, 403);
    }
    checks.push("unassociated-user-registration-cannot-pass-operator-renewal-guards");
    for (const [path, method] of [["/store/carts/cart_synthetic/complete", "POST"], ["/store/payment-collections", "POST"],
      ["/store/returns", "POST"], ["/store/orders/order_synthetic", "GET"], ["/hooks/payment/system_default", "POST"]]) {
      const result = await request(path, { method, token: repeated.value.token, body: method === "POST" ? {} : undefined });
      assert.equal(result.status, 503, path); assert.equal(result.value.code, "RIFARE_COMMERCE_IDENTITY_NOT_CONNECTED");
    }
    checks.push("authenticated-customer-still-cannot-cross-commerce-holds");
  } finally {
    server.kill("SIGTERM");
    await Promise.race([serverExit, delay(10000)]);
    if (server.exitCode === null) { server.kill("SIGKILL"); await serverExit; }
    peer.closeAllConnections(); await new Promise<void>((resolve) => peer.close(() => resolve()));
  }
  await verifyDevelopmentLogging();
  checks.push("development-logs-omit-callback-code-state-and-description");
  console.log(JSON.stringify({ status: "passed", checks, count: checks.length,
    scope: "synthetic-oidc-peer-real-postgres-and-medusa-http", hosted_provider_qualified: false }));
}

/** Exercise the development logger, which is skipped by upstream in NODE_ENV=test.
 * Unknown flow state must be rejected before any request to the configured issuer.
 */
async function verifyDevelopmentLogging() {
  const devOrigin = "http://127.0.0.1:19038";
  const server = spawn(process.execPath, ["run.mjs", "start", "--port", "19038"], {
    cwd: process.cwd(), env: { ...process.env, NODE_ENV: "development", DISABLE_MEDUSA_ADMIN: "true",
      LOG_LEVEL: "http", RIFARE_WEB_ORIGIN: devOrigin, RIFARE_IDENTITY_PROVIDER: "supabase",
      RIFARE_OIDC_ISSUER: "https://synthetic-provider.example.invalid/auth/v1", RIFARE_OIDC_CLIENT_ID: clientId,
      RIFARE_OIDC_CLIENT_SECRET: clientSecret, RIFARE_OIDC_SIGNING_ALG: "RS256",
      RIFARE_OIDC_CALLBACK_URL: `${devOrigin}/auth/customer/external-oidc/callback` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  for (const stream of [server.stdout, server.stderr]) stream.on("data", (chunk) => { log += chunk; });
  const exited = new Promise<void>((resolve) => server.once("exit", () => resolve()));
  const state = randomBytes(32).toString("base64url");
  const code = `synthetic-code-log-marker-${randomUUID()}`;
  const description = `synthetic-private-description-${randomUUID()}`;
  try {
    const deadline = Date.now() + 45000;
    let healthy = false;
    while (Date.now() < deadline && server.exitCode === null) {
      try { healthy = (await fetch(`${devOrigin}/health`, { signal: AbortSignal.timeout(1000) })).ok; } catch { /* startup */ }
      if (healthy) break; await delay(100);
    }
    assert.ok(healthy, `Development logging server failed: ${log.slice(-12000)}`);
    const params = new URLSearchParams({ code, state, error_description: description });
    const response = await fetch(`${devOrigin}/auth/customer/external-oidc/callback?${params}`, {
      headers: { cookie: `rifare_oidc_browser=${randomBytes(32).toString("base64url")}` },
      signal: AbortSignal.timeout(10000),
    });
    await response.text(); assert.equal(response.status, 401);
  } finally {
    server.kill("SIGTERM"); await Promise.race([exited, delay(10000)]);
    if (server.exitCode === null) { server.kill("SIGKILL"); await exited; }
  }
  assert.match(log, /Server is ready/); // Logging was active in an actual development server.
  for (const secret of [code, state, description, clientSecret]) assert.equal(log.includes(secret), false);
  console.log("IDENTITY_CHECK development-logs-omit-callback-code-state-and-description");
}
