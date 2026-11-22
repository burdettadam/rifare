import test from "node:test";
import assert from "node:assert/strict";
import { localCommerceConfig } from "../../apps/commerce-backend/src/config/local-commerce.ts";

const valid = () => ({
  RIFARE_COMMERCE_PROFILE: "local-medusa", NODE_ENV: "test",
  DATABASE_URL: "postgresql://test:synthetic@127.0.0.1:15473/rifare_test",
  JWT_SECRET: "synthetic-test-jwt-secret-0000000000000000",
  COOKIE_SECRET: "synthetic-test-cookie-secret-11111111111111",
});

test("CASE-COMMERCE-ENGINE-01-01 explicit local configuration selects PostgreSQL without fallback", () => {
  const env = valid(); const config = localCommerceConfig(env);
  assert.equal(config.projectConfig.databaseUrl, env.DATABASE_URL);
  assert.equal(config.projectConfig.http.storeCors, "http://127.0.0.1:9000");
});
test("CASE-COMMERCE-ENGINE-01-02 unspecified and production profiles are rejected", () => {
  for (const env of [{ ...valid(), RIFARE_COMMERCE_PROFILE: undefined },
    { ...valid(), NODE_ENV: "production" }, { ...valid(), NODE_ENV: "staging" }]) {
    assert.throws(() => localCommerceConfig(env), /PROFILE_UNQUALIFIED/);
  }
});
test("CASE-COMMERCE-ENGINE-01-03 remote databases, URL overrides and missing credentials are rejected", () => {
  for (const url of ["postgresql://u:p@database.example/rifare", "file:synthetic.sqlite",
    "postgresql://u:p@localhost/rifare", "postgresql://u@127.0.0.1/rifare",
    "postgresql://u:p@127.0.0.1/rifare?host=remote.example", "postgresql://u:p@127.0.0.1/rifare#x"]) {
    assert.throws(() => localCommerceConfig({ ...valid(), DATABASE_URL: url }), /LOCAL_DATABASE_REQUIRED/);
  }
});
test("CASE-COMMERCE-ENGINE-01-04 default, missing and shared session secrets are refused", () => {
  for (const env of [{ ...valid(), JWT_SECRET: "supersecret" },
    { ...valid(), COOKIE_SECRET: undefined }, { ...valid(), COOKIE_SECRET: valid().JWT_SECRET }]) {
    assert.throws(() => localCommerceConfig(env), /SEPARATE_SESSION_SECRETS_REQUIRED/);
  }
});
test("CASE-COMMERCE-ENGINE-01-05 CORS remains a single explicit local origin", () => {
  for (const origin of ["https://store.example", "http://127.0.0.1:9000/path", "http://u:p@127.0.0.1",
    "http://127.0.0.1/?redirect=remote.example", "*"]) {
    assert.throws(() => localCommerceConfig({ ...valid(), RIFARE_WEB_ORIGIN: origin }));
  }
});
test("CASE-COMMERCE-ENGINE-01-06 enterprise features stay off and local operator login cannot become customer identity", () => {
  const config = localCommerceConfig({ ...valid(), MEDUSA_FF_RBAC: "true" });
  assert.equal(config.featureFlags.rbac, false);
  assert.equal(config.featureFlags.analytics, false);
  assert.deepEqual(config.projectConfig.http.authMethodsPerActor, { user: ["emailpass"], customer: [] });
  assert.deepEqual(config.projectConfig.http.requireActorAssociation, { emailpass: true });
  assert.equal(config.modules[0].options.providers[0].resolve, "@medusajs/medusa/auth-emailpass");
});
test("CASE-COMMERCE-ENGINE-01-07 ambient cloud endpoints cannot activate external integrations", () => {
  for (const input of [{ EXECUTION_CONTEXT: "medusa-cloud" }, { MEDUSA_CLOUD_EMAILS_API_KEY: "synthetic" },
    { MEDUSA_CLOUD_PAYMENTS_ENDPOINT: "https://payments.example" }]) {
    assert.throws(() => localCommerceConfig({ ...valid(), ...input }), /CLOUD_CONFIGURATION_UNSUPPORTED/);
  }
  const config = localCommerceConfig({ ...valid(), MEDUSA_BACKEND_URL: "https://untrusted.example" });
  assert.equal(config.admin.backendUrl, "/");
  assert.deepEqual(config.plugins, [{ resolve: "@medusajs/cloud", options: { disabled: true } }]);
});
