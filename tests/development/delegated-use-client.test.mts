import test from 'node:test';
import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { claimOracle } from './delegated-command-claim-helpers.mts';
import { delegatedUsePeer, usingDelegatedUsePeer } from './delegated-use-client-helpers.mts';
import { InternalDelegatedUseClient, InternalUseClientDenied } from '../../packages/adapters/delegated-commands/internal-use-client.mts';

const start = claimOracle.commands.find((value: any) => value.name === 'start_use');
const final = claimOracle.commands.find((value: any) => value.name === 'finalize_use');
const otherId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const badDigest = 'sha256:' + '0'.repeat(64);
const clone = <T>(value: T): T => structuredClone(value);
const guard = () => {};
const outcome = <T>(pending: Promise<T>) => pending.then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }));
function denied(error: unknown) {
  assert(error instanceof InternalUseClientDenied);
  assert.match(error.message, /^INTERNAL_USE_[A-Z_]+$/);
  assert.equal(error.code, error.message);
  assert(!Object.hasOwn(error, 'cause'));
  return true;
}
async function refused(pending: Promise<unknown>) { await assert.rejects(pending, denied); }
async function bounded<T>(pending: Promise<T>) {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([pending, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('TLS_TEST_BARRIER_TIMEOUT')), 4000);
  })]); } finally { clearTimeout(timer!); }
}
type Peer = Awaited<ReturnType<typeof delegatedUsePeer>>;
async function usingClient(fn: (client: InternalDelegatedUseClient, peer: Peer) => unknown,
  options: Parameters<typeof delegatedUsePeer>[0] = {}) {
  await usingDelegatedUsePeer(async peer => {
    const client = new InternalDelegatedUseClient(peer.config);
    try { await fn(client, peer); } finally { client.close(); }
  }, options);
}
function unqualified(result: any) {
  assert.equal(result.provider_authenticated, false); assert.equal(result.receipt_signature_verified, false);
  assert.equal(result.execution_authorized, false); assert.equal(result.evidence_status, 'unverified_protocol_data');
  assert.equal(result.qualification, 'candidate_contract_only');
  assert(Object.isFrozen(result)); assert(Object.isFrozen(result.response)); assert(Object.isFrozen(result.response.result));
}

test('RCG4BC5-WIRE-START real mTLS transmits only the exact canonical START on its fixed organization path', context => usingClient(async (client, peer) => {
  context.diagnostic(JSON.stringify({ runtime: peer.runtime, server_leaf: peer.credentials.server.certificate_sha256,
    client_leaf: peer.config.certificate_sha256 }));
  let guards = 0;
  const result = await client.start(start.request, () => { guards++; });
  assert.equal(guards, 2); assert.deepEqual(result.response, claimOracle.challenge_response); unqualified(result);
  assert.equal(peer.requests.length, 1); const sent = peer.requests[0];
  assert.equal(sent.method, 'POST'); assert.equal(sent.path, '/internal/v1/organizations/' + peer.correlation.organization_id + '/delegated-use-commands');
  assert.equal(String(sent.raw), start.canonical_json); assert.deepEqual(sent.body, start.request);
  assert.equal(sent.tls_authorized, true); assert.equal(sent.certificate_sha256, peer.config.certificate_sha256);
  assert.equal(sent.session_reused, false); assert(peer.applicationBytes > sent.raw.length);
  assert.equal(sent.headers['content-type'], 'application/json'); assert.equal(sent.headers.accept, 'application/json');
  assert.equal(Number(sent.headers['content-length']), Buffer.byteLength(start.canonical_json));
  assert.deepEqual(Object.keys(sent.headers).sort(), ['accept', 'connection', 'content-length', 'content-type', 'host']);
  assert.match(peer.runtime.openssl_sha256, /^[0-9a-f]{64}$/); assert.match(peer.runtime.openssl_version, /^OpenSSL /);
}));

test('RCG4BC5-WIRE-RECOVERY explicit recovery uses retained original bytes and a fresh authenticated connection', () => usingClient(async (client, peer) => {
  await client.start(start.request, guard);
  const recovered = await client.recover(start.request, start.recovery_request, guard);
  assert.deepEqual(recovered.response, { ...claimOracle.challenge_response, recovered: true }); unqualified(recovered);
  assert.equal(peer.requests.length, 2); assert.equal(String(peer.requests[1].raw), start.recovery_canonical_json);
  assert.notEqual(peer.requests[0].connection_id, peer.requests[1].connection_id);
  assert.equal(peer.requests[1].session_reused, false); assert.equal(peer.connections, 2);
  assert.equal(peer.requests[1].body.expected_command_digest, start.command_digest);
}));

test('RCG4BC5-WIRE-INPUT only original START data is accepted and accessors never run', () => usingClient(async (client, peer) => {
  let getters = 0;
  const accessor = Object.defineProperty(clone(start.request), 'operation', { enumerable: true,
    get() { getters++; return start.request.operation; } });
  for (const input of [final.request, start.recovery_request, null, {}, accessor,
    { ...start.request, command_id: '00000000-0000-0000-0000-000000000000' },
    { ...start.request, command_id: otherId.toUpperCase() }, { ...start.request, may_send: true }])
    await refused(client.start(input, guard));
  assert.equal(getters, 0); assert.equal(peer.connections, 0); assert.equal(peer.applicationBytes, 0);
}));

test('RCG4BC5-WIRE-RECOVERY-INPUT recovery cannot change the original ID digest kind or request fields', () => usingClient(async (client, peer) => {
  for (const recovery of [start.request, final.recovery_request, {},
    { ...start.recovery_request, original_command_id: otherId },
    { ...start.recovery_request, expected_command_digest: badDigest },
    { ...start.recovery_request, retry: true }]) await refused(client.recover(start.request, recovery, guard));
  await refused(client.recover(final.request, final.recovery_request, guard));
  assert.equal(peer.connections, 0); assert.equal(peer.requests.length, 0);
}));

test('RCG4BC5-WIRE-CONFIG-DATA configuration is closed descriptor data with a full machine correlation', () => usingDelegatedUsePeer(peer => {
  let getters = 0;
  const accessor = Object.defineProperty({ ...peer.config }, 'ca_pem', { enumerable: true,
    get() { getters++; return peer.config.ca_pem; } });
  const actorGetter = Object.defineProperty({ type: 'MACHINE_IDENTITY' }, 'id', { enumerable: true,
    get() { getters++; return peer.correlation.actor.id; } });
  for (const config of [null, {}, accessor, Object.create(peer.config),
    { ...peer.config, agent: {} }, { ...peer.config, rejectUnauthorized: false },
    { ...peer.config, timeout_ms: 0 }, { ...peer.config, timeout_ms: 30_001 },
    { ...peer.config, correlation: { ...peer.correlation, actor: actorGetter } },
    { ...peer.config, correlation: { ...peer.correlation, actor: { type: 'HUMAN', id: peer.correlation.actor.id } } }])
    assert.throws(() => new InternalDelegatedUseClient(config as any), denied);
  assert.equal(getters, 0); assert.equal(peer.connections, 0);
}));

test('RCG4BC5-WIRE-CONFIG-ORIGIN explicit HTTPS trust and exact origin spelling cannot carry credentials or routes', () => usingDelegatedUsePeer(peer => {
  for (const origin of ['http://localhost', 'https://private:secret@localhost', peer.config.origin + '/',
    peer.config.origin + '/other', peer.config.origin + '?token=secret', peer.config.origin + '#secret',
    ' https://localhost', 'https:\\localhost', 'HTTPS://localhost', 'https://localhost:443'])
    assert.throws(() => new InternalDelegatedUseClient({ ...peer.config, origin }), denied);
  for (const ca_pem of ['', 'system', peer.credentials.client.certificate_pem])
    assert.throws(() => new InternalDelegatedUseClient({ ...peer.config, ca_pem }), denied);
  assert.equal(peer.connections, 0);
}));

test('RCG4BC5-WIRE-IDENTITY the selected non-CA leaf owns the exact key pin validity and sole canonical SPIFFE SAN', () => usingDelegatedUsePeer(peer => {
  const bad = [
    { private_key_pem: peer.credentials.server.private_key_pem }, { certificate_sha256: badDigest },
    { workload_uri: 'spiffe://rifare.test/other' }, { workload_uri: 'spiffe://RIFARE.test/internal-use' },
    { workload_uri: peer.config.workload_uri + '?secret' },
    peer.credentials.ca, peer.credentials.expiredClient, peer.credentials.ambiguousClient, peer.credentials.noUriClient,
    { certificate_pem: peer.config.certificate_pem + peer.credentials.ca.certificate_pem },
  ];
  for (const replacement of bad) assert.throws(() => new InternalDelegatedUseClient({ ...peer.config, ...replacement }), denied);
  assert.equal(peer.connections, 0);
}));

test('RCG4BC5-WIRE-DETACH caller aliases and instance overrides cannot replace retained configuration or command bytes', () => usingDelegatedUsePeer(async peer => {
  const config = clone(peer.config), request = clone(start.request), client = new InternalDelegatedUseClient(config);
  config.correlation.actor.id = 'urn:changed:actor'; config.correlation.organization_id = otherId;
  config.origin = 'https://wrong.example.invalid'; config.private_key_pem = '';
  assert.equal(InternalDelegatedUseClient.prototype.boundTo.call(client, peer.correlation), true);
  assert.equal(InternalDelegatedUseClient.prototype.boundTo.call(client, config.correlation), false);
  let calls = 0;
  try {
    const result = await client.start(request, () => { calls++; request.operation.resource_id = 'urn:changed:resource'; });
    assert.equal(calls, 2); assert.deepEqual(result.response, claimOracle.challenge_response);
    assert.equal(String(peer.requests[0].raw), start.canonical_json);
  } finally { client.close(); }
}));

test('RCG4BC5-WIRE-TLS wrong server trust hostname and client chain never reach the HTTP peer', async () => {
  for (const scenario of ['server-trust', 'hostname', 'client-trust']) await usingDelegatedUsePeer(async peer => {
    const config = { ...peer.config,
      ...(scenario === 'server-trust' ? { ca_pem: peer.credentials.otherCa.certificate_pem } : {}),
      ...(scenario === 'client-trust' ? peer.credentials.foreignClient : {}) };
    const client = new InternalDelegatedUseClient(config);
    try { await refused(client.start(start.request, guard)); }
    finally { client.close(); }
    assert.equal(peer.requests.length, 0); assert.equal(peer.applicationBytes, 0);
  }, { server_identity: scenario === 'hostname' ? 'wrong-host' : 'valid' });
});

test('RCG4BC5-WIRE-GUARDS synchronous guards run before connection and after TLS before any application byte', () => usingClient(async (client, peer) => {
  await refused(client.start(start.request, () => { throw new Error('private native detail'); }));
  assert.equal(peer.connections, 0);
  let calls = 0;
  await refused(client.start(start.request, () => { if (++calls === 2) throw new Error('late private detail'); }));
  assert.equal(calls, 2); assert.equal(peer.connections, 1); assert.equal(peer.requests.length, 0); assert.equal(peer.applicationBytes, 0);
  await refused(client.start(start.request, (() => Promise.reject(new Error('async guard forbidden'))) as any));
  await refused(client.start(start.request, (() => ({ then() { throw new Error('never invoke a thenable'); } })) as any));
  assert.equal(peer.connections, 1); assert.equal(peer.applicationBytes, 0);
}));

test('RCG4BC5-WIRE-CLOSE late closure aborts owned work before bytes and does not close another client', () => usingDelegatedUsePeer(async peer => {
  const first = new InternalDelegatedUseClient(peer.config), other = new InternalDelegatedUseClient(peer.config);
  let calls = 0;
  try {
    await refused(first.start(start.request, () => { if (++calls === 2) first.close(); }));
    assert.equal(calls, 2); assert.equal(peer.requests.length, 0); assert.equal(peer.applicationBytes, 0);
    await refused(first.start(start.request, guard));
    assert.deepEqual((await other.start(start.request, guard)).response, claimOracle.challenge_response);
    assert.equal(peer.requests.length, 1);
    peer.holdHandshake(); const pending = outcome(other.recover(start.request, start.recovery_request, guard));
    await bounded(peer.handshakeEntered); other.close(); peer.releaseHandshake();
    const stopped = await pending; assert.equal(stopped.ok, false); if (!stopped.ok) denied(stopped.error);
    assert.equal(peer.requests.length, 1);
  } finally { first.close(); other.close(); }
}));

test('RCG4BC5-WIRE-STATUS all non-success statuses remain finite uncertainty with no follow or automatic retry', () => usingClient(async (client, peer) => {
  for (const status of [201, 204, 301, 302, 307, 308, 400, 401, 403, 404, 408, 409, 413, 415, 503]) {
    peer.setHandler((_request, response) => {
      response.writeHead(status, { location: peer.config.origin + '/secret', 'content-type': 'application/json' });
      response.end(JSON.stringify({ detail: 'private provider detail', secret: 'do not disclose' }));
    });
    const before = peer.requests.length; await refused(client.start(start.request, guard));
    assert.equal(peer.requests.length, before + 1);
  }
}));

test('RCG4BC5-WIRE-BINDING successful JSON still requires exact original grant operation and CHALLENGE kind', () => usingClient(async (client, peer) => {
  for (const change of [(response: any) => { response.original_command_id = otherId; },
    (response: any) => { response.command_digest = badDigest; },
    (response: any) => { response.result.grant.revision++; },
    (response: any) => { response.result.operation.request_digest = badDigest; },
    (response: any) => { response.result = clone(claimOracle.final_response.result); }]) {
    peer.setHandler((_request, response, retained) => { const changed = clone(retained); change(changed); response.end(JSON.stringify(changed)); });
    await refused(client.start(start.request, guard));
  }
  assert.equal(peer.requests.length, 5);
}));

test('RCG4BC5-WIRE-RECOVERY-BINDING recovered true is mandatory only for explicit recovery and historical times stay inert', () => usingClient(async (client, peer) => {
  peer.responses.set(start.request.command_id, clone(claimOracle.challenge_response));
  peer.setHandler((_request, response, retained) => response.end(JSON.stringify({ ...retained, recovered: false })));
  await refused(client.recover(start.request, start.recovery_request, guard));
  peer.setHandler((_request, response, retained) => response.end(JSON.stringify({ ...retained, recovered: true })));
  const original = await client.start(start.request, guard), recovered = await client.recover(start.request, start.recovery_request, guard);
  assert.equal(original.response.recovered, true); assert.equal(recovered.response.recovered, true);
  assert.equal(recovered.response.result.created_at, claimOracle.challenge_response.result.created_at); unqualified(recovered);
}));

test('RCG4BC5-WIRE-STRICT duplicate members malformed UTF8 and malformed JSON reach the strict C1 boundary unchanged', () => usingClient(async (client, peer) => {
  const json = JSON.stringify(claimOracle.challenge_response);
  const invalid = [json.replace('"recovered":false', '"recovered":true,"recovered":false'),
    json.replace('"recovered":false', '"recovered":false,"recov\\u0065red":true'),
    json + '{}', json.slice(0, -1), Buffer.concat([Buffer.from(json), Buffer.from([0xff])]),
    json.replace('"CHALLENGE"', '"\\ud800"')];
  for (const raw of invalid) {
    peer.setHandler((_request, response) => response.end(raw)); await refused(client.start(start.request, guard));
  }
  assert.equal(peer.requests.length, invalid.length);
}));

test('RCG4BC5-WIRE-MEDIA success requires one selected JSON content type and uncompressed bytes', () => usingClient(async (client, peer) => {
  for (const headers of [{ 'content-type': 'text/plain' }, { 'content-type': ['application/json', 'application/json'] },
    { 'content-type': 'application/json', 'content-encoding': 'gzip' },
    { 'content-type': 'application/json; charset=latin1' }, { 'content-type': 'application/json; boundary=private' }]) {
    peer.setHandler((_request, response, retained) => { response.writeHead(200, headers); response.end(JSON.stringify(retained)); });
    await refused(client.start(start.request, guard));
  }
  peer.setHandler((_request, response, retained) => { response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(retained)); });
  unqualified(await client.start(start.request, guard));
}));

test('RCG4BC5-WIRE-BOUNDS declared and streaming bodies and response headers have finite byte ceilings', () => usingClient(async (client, peer) => {
  peer.setHandler((_request, response) => { response.writeHead(200, { 'content-length': '65537' }); response.flushHeaders(); });
  await refused(client.start(start.request, guard));
  peer.setHandler((_request, response) => { response.write(' '.repeat(32768)); response.end(' '.repeat(32769)); });
  await refused(client.start(start.request, guard));
  peer.setHandler((_request, response) => { response.writeHead(200, { 'x-private-padding': 'a'.repeat(17000) }); response.end('{}'); });
  await refused(client.start(start.request, guard)); assert.equal(peer.requests.length, 3);
}));

test('RCG4BC5-WIRE-LOSS connection loss and a truncated success never trigger a replacement START', () => usingClient(async (client, peer) => {
  peer.setHandler((_request, response) => response.destroy());
  await refused(client.start(start.request, guard)); assert.equal(peer.requests.length, 1);
  peer.setHandler((_request, response) => {
    response.writeHead(200, { 'content-length': '2000' }); response.write('{');
    response.socket!.end();
  });
  await refused(client.start(start.request, guard)); assert.equal(peer.requests.length, 2);
  peer.setHandler(undefined);
  assert.equal((await client.recover(start.request, start.recovery_request, guard)).response.recovered, true);
  assert.equal(peer.requests.length, 3);
}));

test('RCG4BC5-WIRE-DEADLINE one deadline covers handshake and body and identity is rechecked after TLS', async () => {
  for (const phase of ['handshake', 'body']) await usingDelegatedUsePeer(async peer => {
    const client = new InternalDelegatedUseClient({ ...peer.config, timeout_ms: 80 });
    if (phase === 'body') peer.setHandler((_request, response) => { response.writeHead(200); response.flushHeaders(); });
    try {
      const before = performance.now(); await refused(client.start(start.request, guard));
      assert(performance.now() - before < 1500);
      assert.equal(peer.requests.length, phase === 'body' ? 1 : 0);
      if (phase === 'handshake') { peer.releaseHandshake(); assert.equal(peer.applicationBytes, 0); }
    } finally { client.close(); }
  }, { hold_handshake: phase === 'handshake' });
  await usingClient(async (client, peer) => {
    const pending = outcome(client.start(start.request, guard)); await bounded(peer.handshakeEntered);
    const now = Date.now;
    try {
      Date.now = () => new X509Certificate(peer.config.certificate_pem).validToDate.getTime() + 1;
      peer.releaseHandshake(); const result = await pending;
      assert.equal(result.ok, false); if (!result.ok) denied(result.error);
      assert.equal(peer.requests.length, 0); assert.equal(peer.applicationBytes, 0);
    } finally { Date.now = now; }
  }, { hold_handshake: true });
});

test('RCG4BC5-WIRE-CAPACITY pending connections have a fixed bound and closure settles every owned promise', () => usingClient(async (client, peer) => {
  const pending = Array.from({ length: 8 }, () => outcome(client.start(start.request, guard)));
  await refused(client.start(start.request, guard));
  await bounded(peer.handshakeEntered); assert(peer.connections <= 8); assert.equal(peer.requests.length, 0);
  client.close(); peer.releaseHandshake();
  for (const result of await Promise.all(pending)) { assert.equal(result.ok, false); if (!result.ok) denied(result.error); }
  assert.equal(peer.applicationBytes, 0); assert.equal(peer.requests.length, 0);
}, { hold_handshake: true }));
