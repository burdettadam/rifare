import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { ExecArgs } from "@medusajs/framework/types";
import { prepareProofAssociation, PreparedProofAssociation } from "../modules/operation-journal/proof-association";

export default async function verifyProofAssociation(_args: ExecArgs) {
  if (process.env.NODE_ENV !== "test" || process.env.RIFARE_COMMERCE_VERIFY !== "disposable") throw new Error("RIFARE_DISPOSABLE_PROOF_TEST_REQUIRED");
  const checks: string[] = [], check = async (name: string, run: () => unknown) => { await run(); checks.push(name); console.log("PROOF_ASSOCIATION_CHECK " + name); };
  const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));
  const context = { profile: "urn:rifare:native-proof-context:v1", origin: "https://authority.example.invalid",
    original_command_id: "12345678-1234-4234-8234-123456789abc", challenge_id: "12345678-1234-4234-8234-123456789abd",
    created_at: "2026-11-23T00:00:00.123456789Z", expires_at: "2026-11-23T00:01:00.123456789Z", query_id: "machine_1",
    nonce: "retained-authenticated-provider-nonce", request_digest: "sha256:" + "a".repeat(64), request_context_digest: "sha256:" + "b".repeat(64) };
  // Deliberately syntax-only bytes: no signature or presentation verification claim.
  const proof = Buffer.from("eyJhbGciOiJFUzI1NiJ9.eyJ2cCI6e319.c3ludGhldGlj");
  const digest = "sha256:" + createHash("sha256").update(proof).digest("hex");
  const prepared = await prepareProofAssociation(bytes(context), proof);
  const response = { submission_id: "12345678-1234-4234-8234-123456789abe", challenge_id: context.challenge_id,
    proof_digest: digest, received_at: "2026-11-23T00:00:30Z", recovered: false };
  await check("C9-FORM exact two fields preserve original compact proof under frozen query", () => {
    const form = new URLSearchParams(prepared.formBytes().toString());
    assert.deepEqual([...form.keys()], ["state", "vp_token"]); assert.equal(form.get("state"), context.challenge_id);
    assert.deepEqual(JSON.parse(form.get("vp_token")!), { machine_1: [proof.toString()] });
    assert.equal(prepared.describe().proof_digest, digest); assert.notEqual("sha256:" + createHash("sha256").update(prepared.formBytes()).digest("hex"), digest);
    assert.equal(prepared.describe().response_uri, context.origin + "/v1/flows/instances/" + context.challenge_id + "/submit");
    assert.equal(prepared.describe().presentation_verified, false); assert.equal(prepared.describe().execution_authorized, false);
  });
  await check("C9-RECOVERY historical response preserves immutable semantics across recovered observation", () => {
    const first = prepared.bindSubmission(bytes(response)), recovered = prepared.bindSubmission(bytes({ ...response, recovered: true }));
    assert.equal(first.semantic_digest, recovered.semantic_digest); assert.equal(first.received_at, recovered.received_at);
    assert.equal(recovered.recovered, true); assert.equal(recovered.original_command_id, context.original_command_id); assert.equal(recovered.execution_authorized, false);
  });
  await check("C9-QUERY-PROPERTY frozen prototype-like query identifiers remain ordinary JSON map keys", async () => {
    const selected = await prepareProofAssociation(bytes({ ...context, query_id: "__proto__" }), proof);
    const mapped = JSON.parse(new URLSearchParams(selected.formBytes().toString()).get("vp_token")!);
    assert.deepEqual(Object.keys(mapped), ["__proto__"]); assert.equal(mapped.__proto__[0], proof.toString()); selected.close();
  });
  for (const [name, changed] of Object.entries({ challenge: { challenge_id: context.original_command_id }, digest: { proof_digest: context.request_digest },
    nil: { submission_id: "00000000-0000-0000-0000-000000000000" }, uuid_case: { submission_id: response.submission_id.toUpperCase() },
    recovered: { recovered: "true" }, extra: { verified: true }, before: { received_at: "2026-11-23T00:00:00.123456788Z" },
    expiry: { received_at: context.expires_at }, offset: { received_at: "2026-11-23T00:00:30+00:00" }, calendar: { received_at: "2026-02-30T00:00:00Z" } })) {
    await check("C9-RESPONSE-" + name + " closed acknowledgement refuses independent mismatch", () => { assert.throws(() => prepared.bindSubmission(bytes({ ...response, ...changed })), /PROOF_ASSOCIATION_UNAVAILABLE/); });
  }
  await check("C9-TIME original lower bound and final nanosecond are preserved exactly", () => {
    assert.equal(prepared.bindSubmission(bytes({ ...response, received_at: context.created_at })).received_at, context.created_at);
    assert.equal(prepared.bindSubmission(bytes({ ...response, received_at: "2026-11-23T00:01:00.123456788Z" })).received_at, "2026-11-23T00:01:00.123456788Z");
  });
  await check("C9-DUPLICATES escaped duplicate fields cannot disappear in JSON parsing", async () => {
    assert.throws(() => prepared.bindSubmission(Buffer.from(JSON.stringify(response).replace('"recovered":', '"recov\\u0065red":true,"recovered":'))));
    await assert.rejects(prepareProofAssociation(Buffer.from(JSON.stringify(context).replace('"query_id":', '"query_\\u0069d":"other","query_id":')), proof));
  });
  await check("C9-CONTEXT server fields are closed canonical scoped inputs", async () => {
    for (const changed of [{ origin: "https://other.invalid/path" }, { origin: "https://user:pass@other.invalid" }, { origin: "http://authority.example.invalid" },
      { origin: context.origin + "/" }, { challenge_id: [context.challenge_id] }, { query_id: "other/query" }, { query_id: "" },
      { request_digest: "bad" }, { nonce: "bad\nnonce" }, { expires_at: context.created_at }, { verified: true }]) await assert.rejects(prepareProofAssociation(bytes({ ...context, ...changed }), proof));
  });
  await check("C9-BOUNDS proof context and acknowledgement enforce original size limits", async () => {
    await assert.rejects(prepareProofAssociation(Buffer.alloc(4097), proof)); await assert.rejects(prepareProofAssociation(bytes(context), Buffer.alloc(262145, 65)));
    const large = await prepareProofAssociation(bytes(context), Buffer.from("a." + "b".repeat(262140) + ".c"));
    assert.ok(large.formBytes().length <= 786432); large.close();
    assert.throws(() => prepared.bindSubmission(Buffer.alloc(4097)));
  });
  await check("C9-COMPACT unsupported syntax whitespace and non-ASCII are refused without decoding", async () => {
    for (const value of ["", "a.b", "a..c", "a.b.c.d", "a.b.c=", "a.b.c\n", "a.b.é"]) await assert.rejects(prepareProofAssociation(bytes(context), Buffer.from(value)));
  });
  await check("C9-DIAGNOSTICS malformed buffer access cannot expose caller diagnostic text", async () => {
    const hostile = new Proxy(bytes(context), { get(target, field) { if (field === "byteLength") throw new Error("synthetic-private-diagnostic"); return Reflect.get(target, field); } });
    await assert.rejects(prepareProofAssociation(hostile, proof), error => error instanceof Error && error.message === "PROOF_ASSOCIATION_UNAVAILABLE");
  });
  await check("C9-SNAPSHOT input mutations and caller form copies cannot change prepared bytes", async () => {
    const selected = bytes(context), input = Buffer.from(proof), pending = prepareProofAssociation(selected, input); selected.fill(0); input.fill(0);
    const captured = await pending, form = captured.formBytes(); form.fill(0); assert.equal(captured.describe().proof_digest, digest);
    assert.deepEqual(JSON.parse(new URLSearchParams(captured.formBytes().toString()).get("vp_token")!), { machine_1: [proof.toString()] }); captured.close();
  });
  await check("C9-PRIVATE raw proof is absent from ordinary diagnostic enumeration and retired objects refuse use", () => {
    assert.equal(JSON.stringify(prepared), "{}"); assert.deepEqual(Object.keys(prepared), []); assert.ok(Object.isFrozen(prepared));
    assert.throws(() => PreparedProofAssociation.prototype.describe.call(Object.create(PreparedProofAssociation.prototype)));
    prepared.close(); assert.throws(() => prepared.formBytes()); assert.throws(() => prepared.describe()); assert.throws(() => prepared.bindSubmission(bytes(response)));
  });
  console.log(JSON.stringify({ result: "pass", count: checks.length, checks, scope: "pure-proof-form-and-association-codec",
    native_retention_qualified: false, transport_qualified: false, connected_qualified: false, presentation_verified: false, execution_authorized: false }));
}
