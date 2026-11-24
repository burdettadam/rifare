import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:https';
import { setTimeout as delay } from 'node:timers/promises';
import type { ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { PublicDelegatedUseClient } from '../../packages/adapters/delegated-commands/public-use-client.mts';
import { createDelegatedRecovery } from '../../packages/adapters/delegated-commands/command-codec.mts';
import { claimOracle } from './command-fixtures.mts';
import { delegatedUsePeer } from './delegated-use-client-helpers.mts';

const start = claimOracle.commands.find((value: any) => value.name === 'start_use');
const final = claimOracle.commands.find((value: any) => value.name === 'finalize_use');
const challenge = claimOracle.challenge_response.result.challenge_id;
const proof = 'e30.e30.cHJvb2Y'; // Syntax-only fixture, never a verified presentation.
const receipt = claimOracle.receipt_byte_correlation.compact_jws_shape_only;
const receiptRef = 'urn:marty:delegated-receipt:12345678-1234-4234-8234-123456789abc';
const hash = (value: string | Buffer) => 'sha256:' + createHash('sha256').update(value).digest('hex');
const form = (value = proof, state = challenge, query = 'machine') => Buffer.from(new URLSearchParams({ state, vp_token: JSON.stringify({ [query]: [value] }) }).toString());
const admit = async () => {};
const guard = () => {};
const recovery = createDelegatedRecovery(final.request).request;
const reject = (code?: string) => (error: any) => /^PUBLIC_USE_/.test(error?.code) && (!code || error.code === code);
function deferred() { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; }
type Request = { method: string; path: string; raw: Buffer; headers: any; tls_authorized: boolean; certificate_sha256: string; session_reused: boolean };
type Hook = (kind: string, payload: any, request: Request, response: ServerResponse) => any;

/** New large-body loopback fixture reuses only the existing synthetic certificate
 * owner; the old peer and its 64KiB request-bound behavior remain unchanged. */
async function fixture(run: (client: PublicDelegatedUseClient, peer: any) => Promise<void>) {
  const seed = await delegatedUsePeer(), config = { ...seed.config, timeout_ms: 1000 }, credentials = seed.credentials;
  await seed.close();
  let hook: Hook | undefined, applicationBytes = 0, finalCalls = 0, proofCalls = 0;
  const requests: Request[] = [], sockets = new Set<Socket>();
  const finalResponse = () => ({ ...structuredClone(claimOracle.final_response), result: {
    ...structuredClone(claimOracle.final_response.result), receipt_ref: receiptRef, receipt_digest: hash(receipt) } });
  const server = createServer({ cert: credentials.server.certificate_pem, key: credentials.server.private_key_pem,
    ca: credentials.ca.certificate_pem, requestCert: true, rejectUnauthorized: true, minVersion: 'TLSv1.2' }, (req, res) => {
    const chunks: Buffer[] = []; let size = 0;
    req.on('error', () => res.destroy());
    req.on('data', bytes => { size += bytes.length; if (size > 786432) req.destroy(); else chunks.push(bytes); });
    req.on('end', () => {
      const raw = Buffer.concat(chunks), socket = req.socket as import('node:tls').TLSSocket;
      const request = { method: req.method!, path: req.url!, raw, headers: req.headers, tls_authorized: socket.authorized,
        certificate_sha256: hash(socket.getPeerCertificate().raw), session_reused: socket.isSessionReused() };
      requests.push(request); res.statusCode = 200;
      res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store');
      res.setHeader('pragma', 'no-cache'); res.setHeader('x-content-type-options', 'nosniff');
      let kind = '', payload: any;
      const document = () => JSON.parse(raw.toString());
      if (req.url === '/v1/flows/instances/' + challenge + '/submit') {
        kind = 'proof'; const vp = JSON.parse(new URLSearchParams(raw.toString()).get('vp_token')!); proofCalls++;
        payload = { submission_id: final.request.proof_submission_id, challenge_id: challenge, proof_digest: hash(Object.values(vp)[0][0]),
          received_at: '2026-01-02T03:04:15.1Z', recovered: proofCalls > 1 };
      } else if (req.url?.endsWith('/receipts/recover')) {
        kind = 'receipt'; payload = { original_response: { ...finalResponse(), recovered: true }, receipt_ref: receiptRef,
          receipt_digest: hash(receipt), compact_jws: receipt, semantics: 'EVIDENCE_ONLY' };
      } else if (document().command === 'START_USE') {
        kind = 'start'; payload = structuredClone(claimOracle.challenge_response);
        res.setHeader('link', '<' + config.origin + '/v1/flows/instances/' + challenge + '/request>; rel="urn:marty:delegated-use:request"');
      } else {
        kind = document().command === 'FINALIZE_USE' ? 'final' : 'recover'; if (kind === 'final') finalCalls++;
        payload = { ...finalResponse(), recovered: kind === 'recover' };
      }
      try { const changed = hook?.(kind, payload, request, res); if (changed !== false) res.end(typeof changed === 'string' ? changed : JSON.stringify(changed ?? payload)); }
      catch { res.destroy(); }
    });
  });
  server.on('secureConnection', socket => socket.on('data', bytes => { applicationBytes += bytes.length; }));
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); }); server.on('tlsClientError', () => {});
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string'); config.origin = 'https://localhost:' + address.port;
  const client = new PublicDelegatedUseClient(config);
  const peer = { config, requests, otherCa: credentials.otherCa.certificate_pem, setHook(next?: Hook) { hook = next; }, get applicationBytes() { return applicationBytes; },
    get finalCalls() { return finalCalls; }, get proofCalls() { return proofCalls; } };
  try { await run(client, peer); }
  finally { client.close(); for (const socket of sockets) socket.destroy(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
const started = (client: PublicDelegatedUseClient) => client.start(start.request, guard);

test('CONT-PROOF-WIRE exact public form uses explicit mTLS and compact-proof identity', () => fixture(async (client, peer) => {
  assert.equal(client.boundToOrigin(peer.config.origin), true); assert.equal(client.boundToOrigin('https://foreign.invalid'), false);
  assert.equal(client.boundToOrigin({ toString() { throw new Error('do not coerce'); } }), false);
  const bound = await started(client), result = await client.submitProofAfterAdmission(start.request, bound, 'machine', form(), admit, guard);
  const request = peer.requests[1]; assert.equal(request.path, '/v1/flows/instances/' + challenge + '/submit'); assert.equal(request.method, 'POST');
  assert.equal(request.raw.toString(), form().toString()); assert.equal(request.headers['content-type'], 'application/x-www-form-urlencoded');
  assert.equal(result.proof_digest, hash(proof)); assert.equal(result.presentation_verified, false); assert.equal(result.execution_authorized, false);
  assert.equal(request.tls_authorized, true); assert.equal(request.certificate_sha256, peer.config.certificate_sha256); assert.equal(request.session_reused, false);
}));
test('CONT-PROOF-HISTORY explicit identical-proof recovery preserves submission identity and original time', () => fixture(async client => {
  const bound = await started(client), a = await client.submitProofAfterAdmission(start.request, bound, 'machine', form(), admit, guard);
  const b = await client.submitProofAfterAdmission(start.request, bound, 'machine', form(), admit, guard);
  assert.equal(a.submission_id, b.submission_id); assert.equal(a.received_at, b.received_at); assert.equal(b.recovered, true);
}));
test('CONT-PROOF-OWNER cloned or another-client challenge cannot dispatch proof bytes', () => fixture(async (client, peer) => {
  const bound = await started(client), other = new PublicDelegatedUseClient(peer.config);
  try {
    await assert.rejects(client.submitProofAfterAdmission(start.request, { ...bound }, 'machine', form(), admit, guard), reject('PUBLIC_USE_INPUT_INVALID'));
    await assert.rejects(other.submitProofAfterAdmission(start.request, bound, 'machine', form(), admit, guard), reject('PUBLIC_USE_INPUT_INVALID'));
    assert.equal(peer.requests.length, 1);
  } finally { other.close(); }
}));
test('CONT-PROOF-FORM changed state query duplicates and escaped JSON fields fail before I/O', () => fixture(async (client, peer) => {
  const bound = await started(client);
  for (const value of [form(proof, start.request.command_id), form(proof, challenge, 'other'), Buffer.from(form() + '&state=' + challenge),
    Buffer.from(new URLSearchParams({ state: challenge, vp_token: '{"mach\\u0069ne":["' + proof + '"]}' }).toString())]) {
    await assert.rejects(client.submitProofAfterAdmission(start.request, bound, 'machine', value, admit, guard), reject('PUBLIC_USE_INPUT_INVALID'));
  }
  assert.equal(peer.requests.length, 1);
}));
test('CONT-PROOF-MAX exact 262144-byte compact proof crosses the real peer unchanged', () => fixture(async (client, peer) => {
  const value = 'a.' + 'b'.repeat(262140) + '.c', result = await client.submitProofAfterAdmission(start.request, await started(client), 'machine', form(value), admit, guard);
  assert.equal(result.proof_digest, hash(value)); assert.ok(peer.requests[1].raw.length > 262144);
}));
test('CONT-PROOF-BOUNDS oversized compact proof and form cannot reach the peer', () => fixture(async (client, peer) => {
  const bound = await started(client);
  for (const value of [form('a.' + 'b'.repeat(262141) + '.c'), Buffer.alloc(786433, 65)]) await assert.rejects(client.submitProofAfterAdmission(start.request, bound, 'machine', value, admit, guard), reject('PUBLIC_USE_INPUT_INVALID'));
  assert.equal(peer.requests.length, 1);
}));
test('CONT-ADMISSION TLS completes before native admission and no proof plaintext precedes its resolution', () => fixture(async (client, peer) => {
  const bound = await started(client), before = peer.applicationBytes, entered = deferred(), release = deferred();
  const pending = client.submitProofAfterAdmission(start.request, bound, 'machine', form(), () => { entered.resolve(); return release.promise; }, guard);
  await entered.promise; assert.equal(peer.applicationBytes, before); assert.equal(peer.requests.length, 1); release.resolve(); await pending;
}));
test('CONT-ADMISSION-DENIED rejected admission and arbitrary thenables emit no proof', () => fixture(async (client, peer) => {
  const bound = await started(client); let invoked = false;
  for (const admission of [async () => { throw new Error('withdrawn'); }, (() => ({ then() { invoked = true; } })) as any]) {
    await assert.rejects(client.submitProofAfterAdmission(start.request, bound, 'machine', form(), admission, guard), reject('PUBLIC_USE_GUARD_DENIED'));
  }
  assert.equal(invoked, false); assert.equal(peer.requests.length, 1);
}));
test('CONT-CLOSE retirement during native admission cannot send a late proof', () => fixture(async (client, peer) => {
  const bound = await started(client), entered = deferred(), release = deferred();
  const pending = assert.rejects(client.submitProofAfterAdmission(start.request, bound, 'machine', form(), () => { entered.resolve(); return release.promise; }, guard), reject());
  await entered.promise; client.close(); release.resolve(); await pending; await delay(5); assert.equal(peer.requests.length, 1);
}));
test('CONT-CANCEL abort during native admission cannot emit proof bytes', () => fixture(async (client, peer) => {
  const bound = await started(client), entered = deferred(), release = deferred(), cancellation = new AbortController();
  const pending = assert.rejects(client.submitProofAfterAdmission(start.request, bound, 'machine', form(), () => { entered.resolve(); return release.promise; }, guard, cancellation.signal), reject());
  await entered.promise; cancellation.abort(); release.resolve(); await pending; assert.equal(peer.requests.length, 1);
}));
test('CONT-SNAPSHOT caller form mutation during admission cannot alter captured bytes', () => fixture(async (client, peer) => {
  const bound = await started(client), entered = deferred(), release = deferred(), input = form();
  const pending = client.submitProofAfterAdmission(start.request, bound, 'machine', input, () => { entered.resolve(); return release.promise; }, guard);
  await entered.promise; input.fill(0); release.resolve(); await pending; assert.equal(peer.requests[1].raw.toString(), form().toString());
}));
test('CONT-PROOF-CORRELATION acknowledgement IDs digest types and original interval are checked', () => fixture(async (client, peer) => {
  const bound = await started(client);
  for (const changed of [{ challenge_id: start.request.command_id }, { proof_digest: hash('other') }, { submission_id: '00000000-0000-0000-0000-000000000000' },
    { recovered: 'true' }, { received_at: claimOracle.challenge_response.result.expires_at }, { verified: true }]) {
    peer.setHook((kind, payload) => kind === 'proof' ? { ...payload, ...changed } : payload);
    await assert.rejects(client.submitProofAfterAdmission(start.request, bound, 'machine', form(), admit, guard), reject('PUBLIC_USE_RESPONSE_INVALID'));
  }
}));
test('CONT-PROOF-DUPLICATE escaped duplicate acknowledgement members are refused', () => fixture(async (client, peer) => {
  const bound = await started(client); peer.setHook((kind, payload) => kind === 'proof' ? JSON.stringify(payload).replace('"recovered":', '"recov\\u0065red":true,"recovered":') : payload);
  await assert.rejects(client.submitProofAfterAdmission(start.request, bound, 'machine', form(), admit, guard), reject('PUBLIC_USE_RESPONSE_INVALID'));
}));
test('CONT-PROTECTED all continuation responses require unique no-store no-cache and nosniff headers', () => fixture(async (client, peer) => {
  for (const header of ['cache-control', 'pragma', 'x-content-type-options']) {
    peer.setHook((_kind, payload, _request, response) => { response.removeHeader(header); return payload; });
    await assert.rejects(client.finalizeAfterAdmission(final.request, admit, guard), reject('PUBLIC_USE_RESPONSE_INVALID'));
  }
}));
test('CONT-RESPONSE-BOUNDS oversized proof acknowledgement compression and wrong media fail closed', () => fixture(async (client, peer) => {
  const bound = await started(client);
  for (const change of ['large', 'encoding', 'media']) {
    peer.setHook((kind, payload, _request, response) => { if (kind !== 'proof') return payload;
      if (change === 'large') { response.end('x'.repeat(4097)); return false; }
      response.setHeader(change === 'media' ? 'content-type' : 'content-encoding', change === 'media' ? 'text/plain' : 'gzip'); return payload;
    });
    await assert.rejects(client.submitProofAfterAdmission(start.request, bound, 'machine', form(), admit, guard), reject('PUBLIC_USE_RESPONSE_INVALID'));
  }
}));
test('CONT-FINALIZE exact original canonical FINALIZE identity is sent once and stays inert', () => fixture(async (client, peer) => {
  const result = await client.finalizeAfterAdmission(final.request, admit, guard);
  assert.equal(peer.requests[0].raw.toString(), final.canonical_json); assert.equal(result.response.original_command_id, final.request.command_id);
  assert.equal(result.response.command_digest, final.command_digest); assert.equal(result.execution_authorized, false); assert.equal(peer.finalCalls, 1);
}));
test('CONT-FINAL-RECOVER explicit read retains the original finalization UUID digest and result', () => fixture(async (client, peer) => {
  const first = await client.finalizeAfterAdmission(final.request, admit, guard), result = await client.recoverFinalAfterAdmission(final.request, recovery, admit, guard);
  assert.equal(peer.requests[1].raw.toString(), createDelegatedRecovery(final.request).canonical_json); assert.deepEqual(result.response.result, first.response.result);
  assert.equal(result.response.recovered, true); assert.equal(peer.finalCalls, 1);
}));
test('CONT-DENY genuine denial is preserved as evidence without a retry or business permit', () => fixture(async (client, peer) => {
  peer.setHook((kind, payload) => { if (kind === 'final' || kind === 'recover') payload.result.decision = 'DENY'; return payload; });
  const result = await client.finalizeAfterAdmission(final.request, admit, guard); assert.equal(result.response.result.decision, 'DENY');
  assert.equal(result.execution_authorized, false); assert.equal(peer.requests.length, 1);
}));
test('CONT-RECOVERY-INPUT changed original recovery expectation is refused before transport', () => fixture(async (client, peer) => {
  for (const send of [client.recoverFinalAfterAdmission.bind(client), client.recoverReceiptAfterAdmission.bind(client)]) {
    await assert.rejects(send(final.request, { ...recovery, expected_command_digest: hash('other') }, admit, guard), reject('PUBLIC_USE_INPUT_INVALID'));
  }
  assert.equal(peer.requests.length, 0);
}));
test('CONT-FINAL-CORRELATION response original UUID digest challenge receipt namespace and semantics are bound', () => fixture(async (client, peer) => {
  for (const change of ['id', 'digest', 'challenge', 'reference', 'semantics', 'time', 'decision']) {
    peer.setHook((_kind, payload) => { const next = structuredClone(payload); if (change === 'id') next.original_command_id = start.request.command_id;
      if (change === 'digest') next.command_digest = hash('other'); if (change === 'challenge') next.result.challenge_id = start.request.command_id;
      if (change === 'reference') next.result.receipt_ref = 'https://foreign.invalid/receipt'; if (change === 'semantics') next.result.semantics = 'PERMIT_EXECUTION';
      if (change === 'time') next.result.authorization_expires_at = next.result.recorded_at; if (change === 'decision') next.result.decision = 'ALLOW'; return next; });
    await assert.rejects(client.finalizeAfterAdmission(final.request, admit, guard), reject('PUBLIC_USE_RESPONSE_INVALID'));
  }
}));
test('CONT-RECEIPT original outer and inner evidence bind exact bytes without enumerable artifact contents', () => fixture(async (client, peer) => {
  const result = await client.recoverReceiptAfterAdmission(final.request, recovery, admit, guard);
  assert.equal(peer.requests[0].path, '/v1/organizations/' + peer.config.correlation.organization_id + '/delegated-use/receipts/recover');
  assert.equal(result.compact_jws, receipt); assert.equal(result.receipt_digest, hash(receipt)); assert.equal(result.receipt_signature_verified, false);
  assert.ok(!Object.keys(result).includes('compact_jws')); assert.ok(!JSON.stringify(result).includes(receipt));
}));
test('CONT-RECEIPT-CORRELATION changed outer inner bytes semantics duplicate or excess evidence fails', () => fixture(async (client, peer) => {
  for (const change of ['outer', 'inner', 'bytes', 'semantics', 'duplicate', 'large', 'link']) {
    peer.setHook((_kind, payload, _request, response) => { const next = structuredClone(payload);
      if (change === 'outer') next.receipt_ref = 'urn:other'; if (change === 'inner') next.original_response.result.receipt_digest = hash('other');
      if (change === 'bytes') next.compact_jws = 'a.b.c'; if (change === 'semantics') next.semantics = 'EXECUTION';
      if (change === 'duplicate') return JSON.stringify(next).replace('"semantics":', '"semant\\u0069cs":"OTHER","semantics":');
      if (change === 'large') { response.setHeader('content-length', '131073'); response.end('x'); return false; }
      if (change === 'link') response.setHeader('link', '<https://foreign.invalid/>; rel="next"'); return next; });
    await assert.rejects(client.recoverReceiptAfterAdmission(final.request, recovery, admit, guard), reject('PUBLIC_USE_RESPONSE_INVALID'));
  }
}));
test('CONT-TRUST foreign CA fails the TLS handshake before finalization plaintext', () => fixture(async (_client, peer) => {
  const client = new PublicDelegatedUseClient({ ...peer.config, ca_pem: peer.otherCa });
  try { await assert.rejects(client.finalizeAfterAdmission(final.request, admit, guard), reject('PUBLIC_USE_TRANSPORT_FAILED')); assert.equal(peer.requests.length, 0); }
  finally { client.close(); }
}));
test('CONT-ONE-ATTEMPT redirects lost responses and unresolved status never cause automatic finalization retry', async () => {
  for (const mode of ['redirect', 'lost', 'pending']) await fixture(async (client, peer) => {
    peer.setHook((_kind, _payload, _request, response) => { if (mode === 'lost') response.destroy(); else { response.statusCode = mode === 'redirect' ? 302 : 409; response.setHeader('location', 'https://foreign.invalid/'); response.end('{}'); } return false; });
    await assert.rejects(client.finalizeAfterAdmission(final.request, admit, guard), reject()); await delay(5); assert.equal(peer.requests.length, 1); assert.equal(peer.finalCalls, 1);
  });
});
