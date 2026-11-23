import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import type { ExecArgs } from "@medusajs/framework/types";
import { createPinnedRequestVerifier } from "../modules/operation-journal/request-verifier";

/** Synthetic keys and exact selected provider claims, never deployed trust. */
export default async function verifyRequestSignatures(_args: ExecArgs) {
  if (process.env.NODE_ENV !== "test" || process.env.RIFARE_COMMERCE_VERIFY !== "disposable") {
    throw new Error("RIFARE_DISPOSABLE_REQUEST_TEST_REQUIRED");
  }
  const checks: string[] = [];
  const check = async (name: string, run: () => unknown) => {
    await run(); checks.push(name); console.log("REQUEST_SIGNATURE_CHECK " + name);
  };
  const key = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const other = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const now = 1800000000000;
  const challenge = "12345678-1234-4234-8234-123456789abc";
  const trust = {
    profile: "urn:rifare:managed-authorization-request-trust:v1",
    provider_ref: "synthetic-provider", organization_id: "12345678-1234-4234-8234-123456789abd",
    actor: { type: "MACHINE_IDENTITY", id: "urn:rifare:synthetic:machine" },
    origin: "https://authority.example.invalid", verifier_did: "did:web:verifier.example.invalid",
    client_id: "decentralized_identifier:did:web:verifier.example.invalid",
    key_id: "did:web:verifier.example.invalid#request", key_purpose: "oid4vp_request_signing",
    algorithm: "ES256", public_jwk: key.publicKey.export({ format: "jwk" }), max_lifetime_seconds: 300,
    dcql_query: { credentials: [{ id: "machine", format: "jwt_vc_json",
      require_cryptographic_holder_binding: true,
      meta: { marty_securing_profile: "marty_nested_vc2_jwt_v1", type_values: [["MachineCredential"]] } }] },
    client_metadata: { vp_formats_supported: {
      jwt_vc_json: { alg_values_supported: ["ES256", "ES384", "EdDSA", "RS256"] },
      jwt_vp: { alg_values_supported: ["ES256", "ES384", "EdDSA", "RS256"] },
    } },
  };
  const context = { provider_ref: trust.provider_ref, organization_id: trust.organization_id, actor: trust.actor,
    challenge_id: challenge, created_at: new Date(now - 1000).toISOString(), expires_at: new Date(now + 120000).toISOString() };
  const claims = { aud: "https://self-issued.me/v2", client_id: trust.client_id, iss: trust.client_id,
    exp: now / 1000 + 120, iat: now / 1000, nonce: "synthetic-provider-frozen-nonce",
    response_mode: "direct_post", response_type: "vp_token",
    response_uri: trust.origin + "/v1/flows/instances/" + challenge + "/submit", state: challenge,
    dcql_query: trust.dcql_query, client_metadata: trust.client_metadata };
  const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));
  const header = { alg: "ES256", kid: trust.key_id, typ: "oauth-authz-req+jwt" };
  const signed = (payload = JSON.stringify(claims), selectedHeader = JSON.stringify(header), signer = key.privateKey) => {
    const input = Buffer.from(selectedHeader).toString("base64url") + "." + Buffer.from(payload).toString("base64url");
    return Buffer.from(input + "." + sign("sha256", Buffer.from(input), { key: signer, dsaEncoding: "ieee-p1363" }).toString("base64url"));
  };
  const verifier = await createPinnedRequestVerifier(bytes(trust));
  const original = signed();
  const verify = (artifact = original, binding = context, time = now) => verifier.verify(artifact, bytes(binding), time);
  await check("C7-SIGNATURE-VALID selected signed request retains exact bytes and provider nonce without effect authority", async () => {
    const handle = await verify(); const description = verifier.describe(handle);
    assert.equal(description.compact_jws, original.toString()); assert.equal(description.nonce, claims.nonce);
    assert.equal(description.challenge_id, challenge); assert.equal(description.execution_authorized, false);
    assert.equal(description.presentation_verified, false); assert.equal(Object.keys(handle).length, 0);
  });
  await check("C7-SIGNATURE-WRONG-KEY genuine other-key ES256 signature is refused", async () => {
    await assert.rejects(verify(signed(JSON.stringify(claims), JSON.stringify(header), other.privateKey)), /REQUEST_SIGNATURE_INVALID/);
  });
  for (const [name, changed] of Object.entries({
    audience: { aud: trust.origin }, client: { client_id: "decentralized_identifier:did:web:other.invalid" },
    issuer: { iss: trust.origin }, state: { state: "12345678-1234-4234-8234-123456789abe" },
    destination: { response_uri: "https://other.invalid/v1/flows/instances/" + challenge + "/submit" },
    query: { dcql_query: { ...trust.dcql_query, credential_sets: [] } },
    metadata: { client_metadata: { ...trust.client_metadata, jwks: { keys: [trust.public_jwk] } } },
    encrypted: { response_mode: "direct_post.jwt" }, response: { response_type: "id_token" },
    nonce: { nonce: "" }, expired: { exp: now / 1000 }, future: { iat: now / 1000 + 1 },
    challenge_expiry: { exp: now / 1000 + 121 }, before_challenge: { iat: now / 1000 - 2 },
    wallet_variant: { wallet_nonce: "unselected" },
  })) {
    await check("C7-CONTEXT-" + name + " valid signature cannot override selected request context", async () => {
      await assert.rejects(verify(signed(JSON.stringify({ ...claims, ...changed }))), /REQUEST_(CONTEXT|TIME)_INVALID/);
    });
  }
  for (const [name, changed] of Object.entries({ algorithm: { alg: "HS256" }, type: { typ: "JWT" },
    key: { kid: "did:web:other.invalid#key" }, remote: { jku: "https://other.invalid/keys" },
    certificate: { x5c: ["unselected"] }, critical: { crit: ["unselected"] } })) {
    await check("C7-HEADER-" + name + " signed unsupported key or profile selection is refused", async () => {
      await assert.rejects(verify(signed(JSON.stringify(claims), JSON.stringify({ ...header, ...changed }))), /REQUEST_HEADER_INVALID/);
    });
  }
  await check("C7-JSON-DUPLICATES escaped duplicate claims and headers fail before lossy parsing", async () => {
    await assert.rejects(verify(signed(JSON.stringify(claims).replace('"nonce":', '"n\\u006fnce":"other","nonce":'))), /REQUEST_JSON_INVALID/);
    await assert.rejects(verify(signed(JSON.stringify(claims), JSON.stringify(header).replace('"kid":', '"k\\u0069d":"other","kid":'))), /REQUEST_JSON_INVALID/);
  });
  await check("C7-ORIGINAL-CORRELATION trust cannot be substituted across provider organization or machine", async () => {
    for (const changed of [{ provider_ref: "other" }, { organization_id: challenge },
      { actor: { type: "MACHINE_IDENTITY", id: "urn:other" } }]) {
      await assert.rejects(verify(original, { ...context, ...changed }), /REQUEST_CONTEXT_INVALID/);
    }
  });
  await check("C7-HANDLES results cannot be forged cloned or transferred between verifier owners", async () => {
    const handle = await verify();
    assert.throws(() => verifier.describe({}), /REQUEST_HANDLE_INVALID/);
    assert.throws(() => verifier.describe(structuredClone(handle)), /REQUEST_HANDLE_INVALID/);
    const second = await createPinnedRequestVerifier(bytes(trust));
    assert.throws(() => second.describe(handle), /REQUEST_HANDLE_INVALID/); second.close();
  });
  await check("C7-INPUT-SNAPSHOT artifact and context mutations after invocation cannot change authenticated result", async () => {
    const artifact = Buffer.from(original), binding = bytes(context); const promise = verifier.verify(artifact, binding, now);
    artifact.fill(0); binding.fill(0); assert.equal(verifier.describe(await promise).compact_jws, original.toString());
  });
  await check("C7-TRUST-PROFILE unselected purpose private keys and unmarked credential profiles are refused", async () => {
    for (const change of [{ key_purpose: "receipt_signing" }, { public_jwk: key.privateKey.export({ format: "jwk" }) },
      { dcql_query: { credentials: [{ id: "machine", format: "jwt_vc_json" }] } }]) {
      await assert.rejects(createPinnedRequestVerifier(bytes({ ...trust, ...change })), /REQUEST_TRUST_INVALID/);
    }
  });
  await check("C7-CLOCK-REWIND trusted time cannot regress within a verifier lifetime", async () => {
    await assert.rejects(verify(original, context, now - 1), /REQUEST_TIME_INVALID/);
  });
  await check("C7-CLOSE retirement rejects pending verification and every existing handle", async () => {
    const handle = await verify(); const pending = verify(); verifier.close();
    await assert.rejects(pending, /REQUEST_TRUST_RETIRED/);
    assert.throws(() => verifier.describe(handle), /REQUEST_TRUST_RETIRED/);
    await assert.rejects(verify(), /REQUEST_TRUST_RETIRED/);
  });
  console.log(JSON.stringify({ result: "pass", checks, count: checks.length,
    scope: "synthetic-selected-request-signatures", native_retention_qualified: false, connected_qualified: false }));
}
