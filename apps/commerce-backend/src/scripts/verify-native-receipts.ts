import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import type { ExecArgs } from "@medusajs/framework/types";
import { createNativeReceiptVerifier } from "../modules/operation-journal/receipt-verifier";

/** Genuine synthetic signatures over independently chosen native contexts.
 * This does not execute a provider, admit a journal observation or enable effects. */
export default async function verifyNativeReceipts(_args: ExecArgs) {
  if (process.env.NODE_ENV !== "test" || process.env.RIFARE_COMMERCE_VERIFY !== "disposable") {
    throw new Error("RIFARE_DISPOSABLE_RECEIPT_TEST_REQUIRED");
  }
  const checks: string[] = [];
  const check = async (name: string, run: () => unknown) => { await run(); checks.push(name); console.log("NATIVE_RECEIPT_CHECK " + name); };
  const key = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const other = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const hash = "sha256:" + "a".repeat(64), wrongHash = "sha256:" + "b".repeat(64);
  const now = 1800000000000, iso = (time: number) => new Date(time).toISOString();
  const issuer = { type: "ORGANIZATION", id: "did:web:receipts.example.invalid" };
  const trust = {
    profile: "urn:rifare:native-delegated-receipt-trust:v1", provider_ref: "synthetic-provider",
    organization_id: "12345678-1234-4234-8234-123456789abc",
    actor: { type: "MACHINE_IDENTITY", id: "urn:rifare:machine:synthetic" }, issuer,
    subject: { type: "ORGANIZATION", id: "urn:rifare:represented:synthetic" }, status_issuer: issuer,
    binding: { method: "KEY", key_thumbprint: hash }, policy: { id: "synthetic-policy", version_digest: hash },
    delegated_ceiling: { currency: "usd", maximum_minor: "5000" },
    key: { issuer, purpose: "urn:marty:delegated-decision:jws-v1", key_id: issuer.id + "#receipt",
      algorithm: "ES256", public_jwk: key.publicKey.export({ format: "jwk" }) },
  };
  const context = {
    provider_ref: trust.provider_ref, organization_id: trust.organization_id, actor: trust.actor,
    original_command_id: "12345678-1234-4234-8234-123456789abd",
    cart_id: "cart_synthetic", store_id: "store_synthetic", challenge_id: "12345678-1234-4234-8234-123456789abe",
    nonce: "provider-signed-original-nonce-0123456789", authorization_request_digest: hash, authorization_context_digest: hash,
    currency: "usd", currency_exponent: 2, payable_minor_units: "4999",
    grant: { id: "12345678-1234-4234-8234-123456789abf", revision: 2, terms_digest: hash },
    operation: { action: "urn:rifare:action:purchase:v1", audience: "urn:rifare:store:store_synthetic",
      resource_id: "urn:rifare:cart:cart_synthetic", request_profile: "urn:rifare:medusa-original-operation:v1", request_digest: hash },
  };
  const payload = {
    profile: "urn:marty:delegated-decision-receipt:v1", id: "12345678-1234-4234-8234-123456789ac0",
    issuer, decision: "PERMIT", policy: trust.policy, issued_at: iso(now - 1000), expires_at: iso(now + 30000),
    evaluation: {
      profile: "urn:marty:delegated-evaluation:v1", organization_id: trust.organization_id,
      grant: context.grant, actor: trust.actor, subject: trust.subject, binding: trust.binding, operation: context.operation,
      approval_evidence_ref: "urn:synthetic:approval", authority_evidence_ref: "urn:synthetic:authority", proof_evidence_ref: "urn:synthetic:proof",
      challenge: context.nonce, proof_verified_at: iso(now - 2000), proof_valid_until: iso(now + 90000),
      status: { issuer, grant: context.grant, state: "ACTIVE", checked_at: iso(now - 2000), valid_until: iso(now + 90000), evidence_ref: "urn:synthetic:status" },
      evaluated_at: iso(now - 1000),
    },
  };
  const header = { typ: "mip-delegated-decision+jws", alg: "ES256", kid: trust.key.key_id };
  const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));
  const signed = (value: unknown = payload, protectedHeader: unknown = header, signer = key.privateKey) => {
    const input = Buffer.from(JSON.stringify(protectedHeader)).toString("base64url") + "." +
      Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
    return Buffer.from(input + "." + sign("sha256", Buffer.from(input), { key: signer, dsaEncoding: "ieee-p1363" }).toString("base64url"));
  };
  const verifier = await createNativeReceiptVerifier(bytes(trust));
  const verify = (value = signed(), binding: unknown = context, time = now) => verifier.verify(value, bytes(binding), time);
  await check("C8-VALID native original digest and authenticated nonce bind real ES256 receipt", async () => {
    const handle = await verify(), result = verifier.describe(handle);
    assert.equal(result.operation_digest, hash); assert.equal(result.nonce, context.nonce);
    assert.equal(result.receipt_id, payload.id); assert.equal(result.execution_authorized, false);
    assert.equal(result.live_status_verified, false); assert.deepEqual(Object.keys(handle), []); assert.ok(Object.isFrozen(result));
  });
  await check("C8-SIGNATURE wrong private key cannot authenticate otherwise identical claims", async () => {
    await assert.rejects(verify(signed(payload, header, other.privateKey)));
  });
  for (const [name, changed] of Object.entries({ decision: { decision: "DENY" }, issuer: { issuer: { ...issuer, id: "other" } },
    policy: { policy: { ...trust.policy, version_digest: wrongHash } }, extra: { execution_authorized: true }, profile: { profile: "other" },
    expiry: { expires_at: iso(now) }, future: { issued_at: iso(now + 1) }, long_lifetime: { expires_at: iso(now + 700000) } })) {
    await check("C8-RECEIPT-" + name + " signed mismatch refused", async () => { await assert.rejects(verify(signed({ ...payload, ...changed }))); });
  }
  for (const [name, changed] of Object.entries({
    organization: { organization_id: context.challenge_id }, actor: { actor: { ...trust.actor, id: "other" } },
    subject: { subject: trust.actor }, binding: { binding: { method: "KEY", key_thumbprint: wrongHash } },
    grant: { grant: { ...context.grant, revision: 3 } }, nonce: { challenge: context.challenge_id },
    digest: { operation: { ...context.operation, request_digest: wrongHash } },
    legacy_preview: { operation: { ...context.operation, request_profile: "urn:rifare:checkout-preview:v1" } },
    status: { status: { ...payload.evaluation.status, state: "REVOKED" } },
    status_issuer: { status: { ...payload.evaluation.status, issuer: trust.actor } },
    status_grant: { status: { ...payload.evaluation.status, grant: { ...context.grant, terms_digest: wrongHash } } },
    proof_expiry: { proof_valid_until: iso(now + 29999) }, status_expiry: { status: { ...payload.evaluation.status, valid_until: iso(now + 29999) } },
    proof_future: { proof_verified_at: iso(now) }, empty_evidence: { proof_evidence_ref: "" },
    domain: { domain_evidence: { decision: "PERMIT" } }, extra: { presentation_verified: true },
  })) {
    await check("C8-EVALUATION-" + name + " signature cannot override original or trust context", async () => {
      await assert.rejects(verify(signed({ ...payload, evaluation: { ...payload.evaluation, ...changed } })));
    });
  }
  await check("C8-HEADERS embedded keys remote trust critical fields and wrong algorithms refused", async () => {
    for (const changed of [{ typ: "JWT" }, { alg: "HS256" }, { kid: "other" }, { jwk: trust.key.public_jwk },
      { jku: "https://other.invalid/keys" }, { crit: ["other"] }]) await assert.rejects(verify(signed(payload, { ...header, ...changed })));
  });
  await check("C8-DUPLICATES escaped duplicate signed claim does not disappear in JSON parsing", async () => {
    await assert.rejects(verify(signed(JSON.stringify(payload).replace('"decision":', '"decisi\\u006fn":"DENY","decision":'))));
  });
  await check("C8-CONTEXT closed server context and exact local ceiling cannot be bypassed", async () => {
    for (const changed of [{ provider_ref: "other" }, { actor: trust.subject }, { payable_minor_units: "5001" },
      { payable_minor_units: "4.99" }, { currency: "eur" }, { currency_exponent: 5 }, { nonce: "" },
      { authorization_request_digest: "bad" }, { operation: { ...context.operation, audience: "other" } }, { verified: true }]) {
      await assert.rejects(verify(signed(), { ...context, ...changed }));
    }
  });
  await check("C8-TYPES JSON arrays cannot coerce into UUID or digest strings", async () => {
    for (const changed of [{ original_command_id: [context.original_command_id] }, { challenge_id: [context.challenge_id] },
      { grant: { ...context.grant, id: [context.grant.id] } }, { authorization_request_digest: [hash] }]) {
      await assert.rejects(verify(signed(), { ...context, ...changed }));
    }
    await assert.rejects(verify(signed({ ...payload, id: [payload.id] })));
  });
  await check("C8-ED25519 independently selected EdDSA receipt key verifies its own signature", async () => {
    const ed = generateKeyPairSync("ed25519"), selected = { ...trust, key: { ...trust.key, algorithm: "EdDSA", public_jwk: ed.publicKey.export({ format: "jwk" }) } };
    const edVerifier = await createNativeReceiptVerifier(bytes(selected));
    const input = bytes({ ...header, alg: "EdDSA" }).toString("base64url") + "." + bytes(payload).toString("base64url");
    const compact = Buffer.from(input + "." + sign(null, Buffer.from(input), ed.privateKey).toString("base64url"));
    assert.equal(edVerifier.describe(await edVerifier.verify(compact, bytes(context), now)).receipt_id, payload.id); edVerifier.close();
  });
  await check("C8-TRUST server pins reject private key wrong purpose and substituted issuer", async () => {
    for (const changed of [{ key: { ...trust.key, purpose: "presentation_signing" } },
      { key: { ...trust.key, public_jwk: key.privateKey.export({ format: "jwk" }) } },
      { key: { ...trust.key, issuer: trust.actor } }, { binding: { method: "SESSION", session_ref: "other" } }]) {
      await assert.rejects(createNativeReceiptVerifier(bytes({ ...trust, ...changed })));
    }
  });
  await check("C8-OWNERSHIP forged cloned and other-verifier handles refused", async () => {
    const handle = await verify(), otherVerifier = await createNativeReceiptVerifier(bytes(trust));
    for (const fake of [{}, { ...handle }, Object.freeze(Object.create(null))]) assert.throws(() => verifier.describe(fake));
    assert.throws(() => otherVerifier.describe(handle)); otherVerifier.close();
  });
  await check("C8-SNAPSHOT caller mutations cannot change an awaited signature or trusted configuration", async () => {
    const original = signed(), artifact = Buffer.from(original), binding = bytes(context);
    const pending = verifier.verify(artifact, binding, now); artifact.fill(0); binding.fill(0);
    assert.equal(verifier.describe(await pending).compact_jws, original.toString());
    const mutable = bytes(trust), freshPromise = createNativeReceiptVerifier(mutable); mutable.fill(0);
    const fresh = await freshPromise; await fresh.verify(original, bytes(context), now); fresh.close();
  });
  await check("C8-TIME nanoseconds calendar and clock regression remain exact", async () => {
    await assert.rejects(verify(signed({ ...payload, expires_at: iso(now).replace('.000Z', '.000000001Z'), issued_at: iso(now - 1) }), context, now + 1));
    await assert.rejects(verify(signed({ ...payload, expires_at: "2027-02-30T00:00:00Z" })));
    await assert.rejects(verify(signed(), context, now - 1));
  });
  await check("C8-CANCEL cancellation and retirement invalidate pending and retained results", async () => {
    const fresh = await createNativeReceiptVerifier(bytes(trust)), cancellation = new AbortController();
    const pending = fresh.verify(signed(), bytes(context), now, cancellation.signal); cancellation.abort(); await assert.rejects(pending);
    const handle = await fresh.verify(signed(), bytes(context), now), closing = fresh.verify(signed(), bytes(context), now);
    fresh.close(); await assert.rejects(closing); assert.throws(() => fresh.describe(handle)); await assert.rejects(fresh.verify(signed(), bytes(context), now));
  });
  verifier.close();
  console.log(JSON.stringify({ result: "pass", count: checks.length, checks, scope: "synthetic-native-receipt-signatures",
    native_retention_qualified: false, connected_qualified: false, execution_authorized: false }));
}
