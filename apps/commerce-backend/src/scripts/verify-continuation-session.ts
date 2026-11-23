import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:https";
import type { ServerResponse, IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ExecArgs } from "@medusajs/framework/types";
import { nativeReceiptFixture, bytes } from "./native-receipt-fixture";
import { authorityAdapters } from "../modules/operation-journal/authority-assets";

/** Actual native owner + explicit mTLS composition with genuine synthetic C7/C8
 * signatures. The peer is a diagnostic, never a connected provider or VP verifier. */
export default async function verifyContinuationSession({ container }: ExecArgs) {
  if (process.env.NODE_ENV !== "test" || process.env.RIFARE_COMMERCE_VERIFY !== "disposable") throw new Error("RIFARE_DISPOSABLE_CONTINUATION_REQUIRED");
  if (process.env.RIFARE_C9_COMPILED === "true") assert.ok(__filename.endsWith(".js"));
  const helperRoot = process.env.RIFARE_TEST_FIXTURE_ROOT ?? resolve(process.cwd(), "../..");
  const helpers = await import(pathToFileURL(resolve(helperRoot, "tests/development/delegated-use-client-helpers.mts")).href);
  const seed = await helpers.delegatedUsePeer(), credentials = seed.credentials, seedConfig = seed.config; await seed.close();
  const { wire, codec } = await authorityAdapters();
  const sockets = new Set<Socket>(), requests: { path: string; raw: Buffer; tls: boolean }[] = [];
  const hash = (input: Uint8Array) => "sha256:" + createHash("sha256").update(input).digest("hex");
  const proof = Buffer.from("e30.e30.bmF0aXZlLXNlc3Npb24tcHJvb2Y"), proofDigest = hash(proof);
  let fixture: Awaited<ReturnType<typeof nativeReceiptFixture>>;
  let original: Awaited<ReturnType<typeof fixture.makeOriginal>>;
  let ack: any, finalResponse: any, compactReceipt: Buffer | undefined;
  let proofCalls = 0, finalCalls = 0, applicationBytes = 0;
  const serve = async (request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = []; let count = 0;
    for await (const chunk of request) { count += chunk.length; if (count > 786432) throw new Error("FIXTURE_BODY_BOUND"); chunks.push(chunk); }
    const raw = Buffer.concat(chunks), socket = request.socket as import("node:tls").TLSSocket;
    requests.push({ path: request.url!, raw, tls: socket.authorized });
    response.setHeader("content-type", "application/json"); response.setHeader("cache-control", "no-store");
    response.setHeader("pragma", "no-cache"); response.setHeader("x-content-type-options", "nosniff");
    if (request.url === "/v1/flows/instances/" + original.challenge + "/submit") {
      const row = await original.row(); assert.ok(row.proof_claimed_at || proofCalls > 0); assert.equal(row.proof_digest, proofDigest);
      assert.ok(!JSON.stringify(row).includes(proof.toString()));
      const form = new URLSearchParams(raw.toString()); assert.equal(form.get("state"), original.challenge);
      assert.deepEqual(JSON.parse(form.get("vp_token")!), { machine: [proof.toString()] }); proofCalls++;
      if (!ack) ack = { submission_id: randomUUID(), challenge_id: original.challenge, proof_digest: proofDigest,
        received_at: new Date(await fixture.clock()).toISOString(), recovered: false };
      response.end(JSON.stringify({ ...ack, recovered: proofCalls > 1 })); return;
    }
    const command = codec.encodeDelegatedCommand(raw);
    if (request.url?.endsWith("/receipts/recover")) {
      assert.ok(finalResponse && compactReceipt); assert.equal(command.request.original_command_id, finalResponse.original_command_id);
      response.end(JSON.stringify({ original_response: { ...finalResponse, recovered: true }, receipt_ref: finalResponse.result.receipt_ref,
        receipt_digest: hash(compactReceipt!), compact_jws: compactReceipt!.toString(), semantics: "EVIDENCE_ONLY" })); return;
    }
    if (command.request.command === "FINALIZE_USE") {
      const row = await original.row(); assert.ok(row.final_claimed_at); assert.equal(row.final_command_bytes, raw.toString());
      assert.equal(command.request.proof_submission_id, ack.submission_id); assert.equal(command.request.challenge_id, original.challenge); finalCalls++;
      compactReceipt = await original.receipt();
      const payload = JSON.parse(Buffer.from(compactReceipt.toString().split(".")[1], "base64url").toString());
      finalResponse = { profile: "urn:marty:delegation-command-response:v1", original_command_id: command.original_command_id,
        command_digest: command.command_digest, recovered: false, result: { kind: "FINAL_USE", challenge_id: original.challenge, decision: "PERMIT",
          receipt_ref: "urn:marty:delegated-receipt:" + payload.id, receipt_digest: hash(compactReceipt),
          recorded_at: new Date(await fixture.clock()).toISOString(), authorization_expires_at: payload.expires_at, semantics: "EVIDENCE_ONLY" } };
      response.end(JSON.stringify(finalResponse)); return;
    }
    assert.equal(command.request.command, "RECOVER_RESULT");
    if (command.request.original_command_id === original.command.command_id) {
      const row = await original.row(), retained = JSON.parse(row.start_response_bytes);
      response.setHeader("link", "<" + config.origin + "/v1/flows/instances/" + original.challenge + "/request>; rel=\"urn:marty:delegated-use:request\"");
      response.end(JSON.stringify({ ...retained, recovered: true })); return;
    }
    assert.ok(finalResponse); assert.equal(command.request.original_command_id, finalResponse.original_command_id);
    assert.equal(command.request.expected_command_digest, finalResponse.command_digest);
    response.end(JSON.stringify({ ...finalResponse, recovered: true }));
  };
  const failures: unknown[] = [];
  const server = createServer({ cert: credentials.server.certificate_pem, key: credentials.server.private_key_pem,
    ca: credentials.ca.certificate_pem, requestCert: true, rejectUnauthorized: true }, (req, res) => { void serve(req, res).catch(error => { failures.push(error); res.destroy(); }); });
  server.on("connection", socket => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  server.on("secureConnection", socket => socket.on("data", bytes => { applicationBytes += bytes.length; })); server.on("tlsClientError", () => {});
  await new Promise<void>(yes => server.listen(0, "127.0.0.1", yes));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const config = { ...seedConfig, origin: "https://localhost:" + address.port, timeout_ms: 5000 };
  let client: any, session: any;
  const checks: string[] = [];
  const check = async (name: string, run: () => unknown) => { await run(); checks.push(name); console.log("CONTINUATION_SESSION_CHECK " + name); };
  try {
    fixture = await nativeReceiptFixture(container, config.origin); original = await fixture.makeOriginal();
    config.correlation = { provider_ref: fixture.trust.provider_ref, organization_id: fixture.trust.organization_id, actor: fixture.trust.actor };
    client = new wire.PublicDelegatedUseClient(config);
    const open = () => fixture.journal.openContinuationSession(bytes(original.command), bytes(original.descriptor), fixture.context,
      client, fixture.requestVerifier, fixture.verifier);
    session = await open(); const challenge = await session.recover();
    let handle: unknown;
    await check("prepared-unclaimed-restart-with-retired-C7-cannot-first-dispatch-via-recovery", async () => {
      const main = original, pending = await fixture.makeOriginal(), selected = await fixture.journal.createAuthorityRequestVerifier(bytes(fixture.requestTrust));
      original = pending;
      let pendingSession: any;
      try {
        const openPending = () => fixture.journal.openContinuationSession(bytes(pending.command), bytes(pending.descriptor), fixture.context, client, selected, fixture.verifier);
        pendingSession = await openPending(); await pendingSession.prepareProof(proof); pendingSession.close(); selected.close();
        pendingSession = await openPending(); const bound = await pendingSession.recover();
        const before = await pending.row(), count = requests.length, plaintext = applicationBytes;
        assert.equal(before.proof_claimed_at, null); assert.equal(before.proof_submission_bytes, null);
        await assert.rejects(pendingSession.recoverProof(proof, bound));
        assert.equal(requests.length, count, "unclaimed recovery emitted proof HTTP bytes"); assert.equal(applicationBytes, plaintext); assert.deepEqual(await pending.row(), before);
      } finally { pendingSession?.close(); selected.close(); original = main; }
    });
    await check("proof-snapshot-native-context-and-post-TLS-dispatch", async () => {
      const input = Buffer.from(proof), pending = session.prepareProof(input); input.fill(0); handle = await pending;
      const before = await original.row(); assert.equal(before.proof_digest, proofDigest); assert.equal(before.proof_claimed_at, null);
      const observed = await session.submitProof(handle, challenge); assert.equal(observed.presentation_verified, false);
      assert.equal(observed.execution_authorized, false); assert.equal(proofCalls, 1); assert.ok((await original.row()).proof_claimed_at);
      const sent = requests.find(request => request.path.endsWith("/submit"))!; assert.equal(sent.tls, true);
    });
    await check("consumed-private-proof-handle-cannot-dispatch-again", async () => {
      const before = requests.length; await assert.rejects(session.submitProof(handle, challenge)); assert.equal(requests.length, before);
      await assert.rejects(session.submitProof({}, challenge)); assert.equal(requests.length, before);
    });
    await check("explicit-proof-recovery-preserves-original-semantic-association", async () => {
      const before = await original.row(); await session.recoverProof(proof, challenge);
      const after = await original.row(); assert.equal(after.proof_submission_bytes, before.proof_submission_bytes);
      assert.equal(after.proof_submission_observed_at.getTime(), before.proof_submission_observed_at.getTime()); assert.equal(proofCalls, 2);
      const count = requests.length; await assert.rejects(session.recoverProof(Buffer.from("a.b.c"), challenge)); assert.equal(requests.length, count);
    });
    await check("distinct-FINALIZE-is-durable-and-native-claimed-before-peer-body", async () => {
      const finalHandle = await session.prepareFinalization(), row = await original.row(); assert.ok(row.final_command_bytes);
      assert.notEqual(row.final_command_uuid, original.command.command_id); assert.equal(row.final_claimed_at, null);
      const result = await session.finalize(finalHandle); assert.equal(result.decision, "PERMIT"); assert.equal(result.execution_authorized, false);
      await assert.rejects(session.finalize(finalHandle)); assert.equal(finalCalls, 1);
    });
    await check("new-session-recovers-original-final-and-admits-only-correlated-signed-receipt", async () => {
      session.close(); session = await open();
      const before = await original.row(), result = await session.recoverFinalization(); assert.equal(result.decision, "PERMIT"); assert.equal(finalCalls, 1);
      const observed = await session.recoverReceipt(), after = await original.row(); assert.equal(observed.execution_authorized, false);
      assert.equal(after.final_command_uuid, before.final_command_uuid); assert.equal(after.final_response_bytes, before.final_response_bytes);
      assert.equal(after.receipt_bytes, compactReceipt!.toString()); assert.equal(after.state, "awaiting_authority");
    });
    await check("configured-origin-must-match-C7-before-proof-intent-or-I-O", async () => {
      const another = await fixture.makeOriginal(), wrong = new wire.PublicDelegatedUseClient({ ...config, origin: "https://foreign.invalid" });
      const otherSession = await fixture.journal.openContinuationSession(bytes(another.command), bytes(another.descriptor), fixture.context,
        wrong, fixture.requestVerifier, fixture.verifier);
      try { const before = requests.length; await assert.rejects(otherSession.prepareProof(proof)); assert.equal(requests.length, before); assert.equal((await another.row()).proof_digest, null); }
      finally { otherSession.close(); wrong.close(); }
    });
    await check("changed-origin-existing-final-state-cannot-send-result-or-receipt-recovery", async () => {
      // Both SANs are valid and hit this actual peer. Without the origin guard,
      // these requests really reach the server; DNS/TLS refusal cannot fake zero I/O.
      const wrong = new wire.PublicDelegatedUseClient({ ...config, origin: "https://127.0.0.1:" + address.port });
      const otherSession = await fixture.journal.openContinuationSession(bytes(original.command), bytes(original.descriptor), fixture.context,
        wrong, fixture.requestVerifier, fixture.verifier);
      try {
        const count = requests.length, plaintext = applicationBytes, before = await original.row();
        await assert.rejects(otherSession.prepareFinalization());
        await assert.rejects(otherSession.recoverFinalization(), "changed-origin result recovery was accepted"); await assert.rejects(otherSession.recoverReceipt());
        assert.equal(requests.length, count); assert.equal(applicationBytes, plaintext); assert.deepEqual(await original.row(), before);
      } finally { otherSession.close(); wrong.close(); }
    });
    await check("retired-C7-trust-does-not-invent-current-verification-for-identical-proof-recovery", async () => {
      fixture.requestVerifier.close(); session.close(); session = await open(); const challenge = await session.recover();
      const before = await original.row(); await session.recoverProof(proof, challenge); assert.equal(proofCalls, 3);
      assert.equal((await original.row()).proof_submission_bytes, before.proof_submission_bytes);
      await assert.rejects(session.recoverVerifiedRequest());
    });
    await check("closed-session-cannot-send-or-return-fresh-evidence", async () => {
      session.close(); const before = applicationBytes; await assert.rejects(session.recoverReceipt()); assert.equal(applicationBytes, before);
      assert.deepEqual(failures, []); assert.ok(requests.every(value => value.tls));
    });
    fixture.verifier.close(); fixture.requestVerifier.close();
    console.log("RIFARE_CONTINUATION_SESSION_RESULT=" + JSON.stringify({ result: "pass", checks: checks.length, requests: requests.length,
      scope: "native-postgresql-synthetic-mtls-and-signatures", compiled: __filename.endsWith(".js"), execution_authorized: false }));
  } finally { session?.close(); client?.close(); for (const socket of sockets) socket.destroy(); server.closeAllConnections(); await new Promise<void>(yes => server.close(() => yes())); }
}
