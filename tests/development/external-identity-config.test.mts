import test from "node:test";
import assert from "node:assert/strict";
import { localCommerceConfig } from "../../apps/commerce-backend/src/config/local-commerce.ts";

const valid = () => ({
  RIFARE_COMMERCE_PROFILE: "local-medusa", NODE_ENV: "test",
  DATABASE_URL: "postgresql://test:synthetic@127.0.0.1:15473/rifare_test",
  JWT_SECRET: "synthetic-test-jwt-secret-0000000000000000",
  COOKIE_SECRET: "synthetic-test-cookie-secret-11111111111111",
  RIFARE_IDENTITY_PROVIDER: "supabase",
  RIFARE_OIDC_ISSUER: "https://synthetic.example.invalid/auth/v1",
  RIFARE_OIDC_CLIENT_ID: "synthetic-rifare-client",
  RIFARE_OIDC_CLIENT_SECRET: "synthetic-confidential-client-secret-000000000",
  RIFARE_OIDC_CALLBACK_URL: "http://127.0.0.1:9000/auth/customer/external-oidc/callback",
  RIFARE_OIDC_SIGNING_ALG: "RS256",
});

test("CASE-IDENTITY-APP-01-01 customer provider does not grant operator access", () => {
  const config = localCommerceConfig(valid());
  assert.deepEqual(config.projectConfig.http.authMethodsPerActor, { user: ["emailpass"], customer: ["external-oidc"] });
  assert.equal(config.projectConfig.http.jwtExpiresIn, "5m");
  assert.equal(config.modules[0].options.providers[1].resolve, "./src/modules/external-identity");
});
test("CASE-IDENTITY-APP-01-02 ambiguous callback destinations are refused", () => {
  for (const url of ["https://attacker.invalid/callback", "http://127.0.0.1:9000/auth/user/external-oidc/callback",
    valid().RIFARE_OIDC_CALLBACK_URL + "?next=attacker", valid().RIFARE_OIDC_CALLBACK_URL + "/"]) {
    assert.throws(() => localCommerceConfig({ ...valid(), RIFARE_OIDC_CALLBACK_URL: url }), /EXACT_CALLBACK_REQUIRED/);
  }
});
test("CASE-IDENTITY-APP-01-03 symmetric, unsigned and implicit algorithm choices are refused", () => {
  for (const algorithm of ["HS256", "none", "RS256,ES256", "", undefined]) {
    assert.throws(() => localCommerceConfig({ ...valid(), RIFARE_OIDC_SIGNING_ALG: algorithm }), /ASYMMETRIC_ALGORITHM_REQUIRED/);
  }
  localCommerceConfig({ ...valid(), RIFARE_OIDC_SIGNING_ALG: "ES256" });
});
test("CASE-IDENTITY-APP-01-04 issuer must be exact and HTTPS for hosted providers", () => {
  for (const issuer of ["http://synthetic.example.invalid/auth/v1", "https://u:p@synthetic.example.invalid/auth/v1",
    valid().RIFARE_OIDC_ISSUER + "/", valid().RIFARE_OIDC_ISSUER + "?tenant=other",
    valid().RIFARE_OIDC_ISSUER + "/.well-known/openid-configuration", "https://127.0.0.1/auth/v1"]) {
    assert.throws(() => localCommerceConfig({ ...valid(), RIFARE_OIDC_ISSUER: issuer }), /ISSUER_UNQUALIFIED/);
  }
});
test("CASE-IDENTITY-APP-01-05 HTTP peer exception requires test and disposable database intent", () => {
  const fixture = { ...valid(), RIFARE_IDENTITY_PROVIDER: "synthetic-oidc", RIFARE_OIDC_ISSUER: "http://127.0.0.1:19036/auth/v1" };
  assert.throws(() => localCommerceConfig(fixture), /PROFILE_UNQUALIFIED/);
  assert.throws(() => localCommerceConfig({ ...fixture, RIFARE_COMMERCE_VERIFY: "disposable", NODE_ENV: "development" }), /PROFILE_UNQUALIFIED/);
  localCommerceConfig({ ...fixture, RIFARE_COMMERCE_VERIFY: "disposable" });
});
test("CASE-IDENTITY-APP-01-06 incomplete or accidental identity configuration fails closed", () => {
  for (const input of [{ RIFARE_IDENTITY_PROVIDER: undefined }, { RIFARE_IDENTITY_PROVIDER: "unknown" },
    { RIFARE_OIDC_CLIENT_SECRET: "short" }, { RIFARE_OIDC_CLIENT_ID: "" }, { RIFARE_OIDC_CALLBACK_URL: undefined }]) {
    assert.throws(() => localCommerceConfig({ ...valid(), ...input }));
  }
});
