import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { usingNativeStart } from './delegated-checkout-start-helpers.mts';
import { changedPrice, changedProof } from './delegated-checkout-helpers.mts';
import { verifiedCustomer } from './shopper-memory-helpers.mts';
import { delegatedUsePeer } from './delegated-use-client-helpers.mts';
import { InternalDelegatedUseClient, InternalUseClientDenied } from '../../packages/adapters/delegated-commands/internal-use-client.mts';
import { DelegatedCheckoutCommandSender, CommandSenderDenied } from '../../packages/commerce/delegated-checkout-command-sender.mts';
import { CommandClaimDenied } from '../../packages/commerce/delegated-command-claims.mts';
import { CLAIM_KIND } from '../../packages/commerce/delegated-command-claim-records.mts';
import { DelegatedCheckoutStarts } from '../../packages/commerce/delegated-checkout-starts.mts';

type Native = Parameters<Parameters<typeof usingNativeStart>[0]>[0];
type Peer = Awaited<ReturnType<typeof delegatedUsePeer>>;
type Pair = { f: Native; peer: Peer; transport: InternalDelegatedUseClient; sender: DelegatedCheckoutCommandSender };
const otherId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const otherChallenge = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const outcome = <T>(pending: Promise<T>) => pending.then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }));
function failure(result: Awaited<ReturnType<typeof outcome>>) {
  assert.equal(result.ok, false, 'The native operation must refuse');
  if (result.ok) throw new Error('unexpected success');
  assert(result.error instanceof CommandSenderDenied || result.error instanceof InternalUseClientDenied ||
    result.error instanceof CommandClaimDenied);
  assert.match(result.error.message, /^[A-Z][A-Z0-9_]{2,80}$/);
  return result.error;
}
async function bounded<T>(pending: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([pending, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('test barrier timed out: ' + label)), 5000);
  })]); } finally { clearTimeout(timer!); }
}
async function usingSender(fn: (p: Pair) => unknown, options: Parameters<typeof delegatedUsePeer>[0] = {}) {
  await usingNativeStart(async f => {
    const peer = await delegatedUsePeer(options);
    const transport = new InternalDelegatedUseClient(peer.config);
    const sender = new DelegatedCheckoutCommandSender(f.kernel, { correlation: f.correlation, starts: f.starts, transport });
    try { await fn({ f, peer, transport, sender }); }
    finally { sender.close(); transport.close(); await peer.close(); }
  });
}
function original(f: Native) {
  // Independent field selection/order; no production codec or START builder
  // supplies the expected native operation or its canonical digest.
  return { command: 'START_USE', command_id: f.startRequest.command_id,
    grant: { id: f.grant.id, revision: f.grant.revision, terms_digest: f.grant.terms_digest },
    operation: { action: 'urn:rifare:action:purchase:v1', audience: 'urn:rifare:store:' + f.preview.store_id,
      request_digest: 'sha256:' + f.preview.preview_digest, request_profile: 'urn:rifare:checkout-preview:v1',
      resource_id: 'urn:rifare:resource:' + f.preview.resource_id }, profile: 'urn:marty:delegation-command:v1' };
}
function challenge(f: Native) {
  const request = original(f);
  return { profile: 'urn:marty:delegation-command-response:v1', original_command_id: request.command_id,
    command_digest: 'sha256:' + createHash('sha256').update(JSON.stringify(request)).digest('hex'), recovered: false,
    result: { kind: 'CHALLENGE', challenge_id: otherChallenge, grant: request.grant, operation: request.operation,
      created_at: '2026-11-20T12:00:00Z', expires_at: '2026-11-20T12:01:00Z' } };
}
function respond(response: any, body: unknown) {
  response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store',
    pragma: 'no-cache', 'x-content-type-options': 'nosniff' });
  response.end(JSON.stringify(body));
}
const starts = (peer: Peer) => peer.requests.filter(request => request.body.command === 'START_USE');
function inert(view: any) {
  assert.equal(view.execution_authorized, false); assert.equal(view.provider_authenticated, false);
  assert.equal(view.receipt_signature_verified, false); assert.equal(view.observation_origin, 'local_unverified_input');
  assert.equal(view.evidence_status, 'historical_unverified_observation'); assert.equal(view.qualification, 'candidate_contract_only');
}

test('RCG4BC5-SENDER-START the exact native original commits before a real mutually authenticated request', t => usingSender(async ({ f, peer, sender }) => {
  t.diagnostic(JSON.stringify({ runtime: peer.runtime, client_certificate_sha256: peer.config.certificate_sha256,
    server_certificate_sha256: peer.credentials.server.certificate_sha256 }));
  const effects = f.effects(), request = original(f), canonical = JSON.stringify(request);
  let committed = false;
  peer.setHandler((incoming, response, retained) => {
    const view = f.claims.read(f.customer, f.startRequest.command_id);
    assert.equal(f.db.isTransaction, false); assert.equal(view.state, 'claimed'); assert.equal(view.revision, 1);
    assert.equal(view.canonical_request, canonical); assert.equal(f.claimRows().length, 1);
    assert.deepEqual(f.effects(), effects); committed = true; respond(response, retained);
  });
  const observed = await sender.start(f.customer, f.startRequest);
  assert.equal(committed, true); assert.equal(observed.state, 'observed'); assert.equal(observed.revision, 2);
  assert.equal(observed.canonical_request, canonical);
  assert.equal(observed.command_digest, 'sha256:' + createHash('sha256').update(canonical).digest('hex'));
  assert.equal(peer.requests.length, 1); const sent = peer.requests[0];
  assert.equal(sent.method, 'POST');
  assert.equal(sent.path, '/internal/v1/organizations/' + f.correlation.organization_id + '/delegated-use-commands');
  assert.equal(sent.tls_authorized, true); assert.equal(sent.certificate_sha256, peer.config.certificate_sha256);
  assert.equal(String(sent.raw), canonical); assert.deepEqual(sent.body, request);
  for (const name of Object.keys(sent.headers)) assert(!/authorization|cookie|x-service|x-marty|forwarded/i.test(name));
  inert(observed); assert.deepEqual(f.effects(), effects); assert.equal(f.claimRows().length, 1);
}));

test('RCG4BC5-SENDER-LOSS lost START responses never repeat the mutation and explicit history-only recovery retains one original', () => usingSender(async ({ f, peer, transport, sender }) => {
  const effects = f.effects();
  peer.setHandler((request, response, retained) => {
    if (request.body.command === 'START_USE') response.destroy(); else respond(response, retained);
  });
  failure(await outcome(sender.start(f.customer, f.startRequest)));
  const first = f.claims.read(f.customer, f.startRequest.command_id), rows = f.claimRows();
  assert.equal(first.state, 'claimed'); assert.equal(first.revision, 1); assert.equal(first.response, null);
  assert.equal(starts(peer).length, 1);
  // RCG4BC5-SECOND-START-WITNESS: a repeat-admission mutant also loses its
  // response, so the actual peer count—not an exception mismatch—detects it.
  failure(await outcome(sender.start(f.customer, f.startRequest)));
  assert.equal(starts(peer).length, 1, 'An uncertain original must never produce a second START');
  assert.deepEqual(f.claimRows(), rows);
  sender.close(); transport.close(); f.starts.close(); f.previews.close();
  const nextTransport = new InternalDelegatedUseClient(peer.config);
  const history = new DelegatedCheckoutCommandSender(f.kernel, { correlation: f.correlation, transport: nextTransport });
  try {
    const recovered = await history.recover(f.customer, first.original_command_id);
    assert.equal(recovered.claim_id, first.claim_id); assert.equal(recovered.command_digest, first.command_digest);
    assert.equal(recovered.canonical_request, first.canonical_request); assert.equal(recovered.created_at, first.created_at);
    assert.equal(recovered.response?.recovered, true); assert.equal(recovered.state, 'observed');
    assert.deepEqual(await history.recover(f.customer, first.original_command_id), recovered);
    assert.equal(starts(peer).length, 1); assert.equal(peer.requests.length, 3);
    for (const request of peer.requests.slice(1)) assert.deepEqual(request.body, {
      profile: 'urn:marty:delegation-command:v1', command: 'RECOVER_RESULT',
      original_command_id: first.original_command_id, expected_command_digest: first.command_digest,
    });
    inert(recovered); assert.equal(f.claimRows().length, 1); assert.deepEqual(f.effects(), effects);
  } finally { history.close(); nextTransport.close(); }
}));

test('RCG4BC5-SENDER-PRECLAIM existing local preparations and a provider 404 never reopen START admission', () => usingSender(async ({ f, peer, sender }) => {
  const first = f.claimNative(), rows = f.claimRows();
  failure(await outcome(sender.start(f.customer, f.startRequest))); assert.equal(peer.requests.length, 0);
  failure(await outcome(sender.recover(f.customer, first.original_command_id)));
  assert.equal(peer.requests.length, 1); assert.equal(peer.requests[0].body.command, 'RECOVER_RESULT');
  failure(await outcome(sender.start(f.customer, f.startRequest))); assert.equal(starts(peer).length, 0);
  failure(await outcome(sender.recover(f.customer, otherId))); assert.equal(peer.requests.length, 1);
  assert.deepEqual(f.claimRows(), rows); assert.deepEqual(f.claims.read(f.customer, first.original_command_id), first);
}));

test('RCG4BC5-SENDER-TLS-PRICE a purchase changed during TLS blocks every HTTP byte after the native final guard', () => usingSender(async ({ f, peer, sender }) => {
  const pending = outcome(sender.start(f.customer, f.startRequest));
  await bounded(peer.handshakeEntered, 'purchase handshake');
  const first = f.claims.read(f.customer, f.startRequest.command_id), rows = f.claimRows();
  assert.equal(f.db.isTransaction, false); changedPrice(f); const effects = f.effects(); peer.releaseHandshake();
  const settled = await pending;
  assert.equal(peer.requests.length, 0, 'A changed native purchase must not reach the TLS peer');
  assert.equal(peer.applicationBytes, 0); failure(settled);
  assert.deepEqual(f.claimRows(), rows); assert.equal(first.state, 'claimed'); assert.deepEqual(f.effects(), effects);
}, { hold_handshake: true }));

test('RCG4BC5-SENDER-TLS-DELETE a deleted original is never reconstructed during TLS under a fixed native clock', () => usingSender(async ({ f, peer, sender }) => {
  const now = f.now(), pending = outcome(sender.start(f.customer, f.startRequest));
  await bounded(peer.handshakeEntered, 'deletion handshake');
  const first = f.claims.read(f.customer, f.startRequest.command_id); assert.equal(first.revision, 1);
  f.db.prepare('DELETE FROM commerce_support_documents WHERE kind=?').run(CLAIM_KIND);
  assert.equal(f.claimRows().length, 0); peer.releaseHandshake(); failure(await pending);
  assert.equal(f.now(), now); assert.equal(f.claimRows().length, 0);
  assert.equal(peer.requests.length, 0); assert.equal(peer.applicationBytes, 0);
}, { hold_handshake: true }));

test('RCG4BC5-SENDER-TLS-PROOF current proof withdrawal and local cancellation during TLS block application bytes', async () => {
  for (const mutate of [(f: Native) => f.kernel.revoke(f.customer), changedProof,
    (f: Native) => f.nativeClaims.cancel(f.customer, { command_id: f.startRequest.command_id, expected_revision: 1 })]) {
    for (const operation of ['start', 'recover']) await usingSender(async ({ f, peer, sender }) => {
      if (operation === 'recover') f.claimNative();
      const pending = outcome(operation === 'start' ? sender.start(f.customer, f.startRequest)
        : sender.recover(f.customer, f.startRequest.command_id));
      await bounded(peer.handshakeEntered, operation + ' proof handshake'); mutate(f); const rows = f.claimRows();
      peer.releaseHandshake(); failure(await pending); assert.deepEqual(f.claimRows(), rows);
      assert.equal(peer.requests.length, 0); assert.equal(peer.applicationBytes, 0);
    }, { hold_handshake: true });
  }
});

test('RCG4BC5-SENDER-TLS-OBSERVED an independently observed original cannot proceed as a fresh START after TLS', () => usingSender(async ({ f, peer, sender }) => {
  const pending = outcome(sender.start(f.customer, f.startRequest));
  await bounded(peer.handshakeEntered, 'observed handshake');
  const observed = f.claims.observe(f.customer, f.startRequest.command_id, challenge(f)), rows = f.claimRows();
  peer.releaseHandshake(); failure(await pending);
  assert.equal(peer.requests.length, 0); assert.equal(peer.applicationBytes, 0);
  assert.deepEqual(f.claimRows(), rows); assert.deepEqual(f.claims.read(f.customer, f.startRequest.command_id), observed);
}, { hold_handshake: true }));

test('RCG4BC5-SENDER-POSTWAIT access withdrawal while the provider response is pending prevents local observation', async () => {
  for (const mutate of [(f: Native) => f.kernel.revoke(f.customer),
    (f: Native) => f.nativeClaims.cancel(f.customer, { command_id: f.startRequest.command_id, expected_revision: 1 })]) {
    for (const operation of ['start', 'recover']) await usingSender(async ({ f, peer, sender }) => {
      if (operation === 'recover') { f.claimNative(); peer.responses.set(f.startRequest.command_id, challenge(f)); }
      let release!: () => void, entered!: () => void;
      const waiting = new Promise<void>(resolve => { entered = resolve; });
      peer.setHandler((_request, response, retained) => { release = () => respond(response, retained); entered(); });
      const pending = outcome(operation === 'start' ? sender.start(f.customer, f.startRequest)
        : sender.recover(f.customer, f.startRequest.command_id));
      await bounded(waiting, operation + ' held provider response'); assert.equal(peer.requests.length, 1);
      assert.equal(peer.requests[0].body.command, operation === 'start' ? 'START_USE' : 'RECOVER_RESULT');
      mutate(f); const rows = f.claimRows(), effects = f.effects(); release(); failure(await pending);
      assert.deepEqual(f.claimRows(), rows); assert.deepEqual(f.effects(), effects);
      failure(await outcome(sender.recover(f.customer, f.startRequest.command_id)));
      assert.equal(peer.requests.length, 1);
    });
  }
});

test('RCG4BC5-SENDER-BINDING foreign originals digests and purchase results cannot enter native history', async () => {
  for (const change of [(value: any) => { value.original_command_id = otherId; },
    (value: any) => { value.command_digest = 'sha256:' + '0'.repeat(64); },
    (value: any) => { value.result.operation.request_digest = 'sha256:' + '0'.repeat(64); }]) {
    await usingSender(async ({ f, peer, sender }) => {
      peer.setHandler((_request, response, retained) => { const foreign = structuredClone(retained); change(foreign); respond(response, foreign); });
      failure(await outcome(sender.start(f.customer, f.startRequest)));
      const first = f.claims.read(f.customer, f.startRequest.command_id);
      assert.equal(first.state, 'claimed'); assert.equal(first.revision, 1); assert.equal(first.response, null);
      failure(await outcome(sender.start(f.customer, f.startRequest)));
      assert.equal(starts(peer).length, 1); assert.equal(f.claimRows().length, 1);
    });
  }
});

test('RCG4BC5-SENDER-IMMUTABLE a changed recovered result cannot replace the first native observation', () => usingSender(async ({ f, peer, sender }) => {
  const first = await sender.start(f.customer, f.startRequest), rows = f.claimRows();
  peer.setHandler((_request, response, retained) => {
    const changed = structuredClone(retained);
    changed.result.challenge_id = retained.result.challenge_id === otherChallenge ? otherId : otherChallenge;
    respond(response, changed);
  });
  failure(await outcome(sender.recover(f.customer, first.original_command_id)));
  assert.deepEqual(f.claimRows(), rows); assert.deepEqual(f.claims.read(f.customer, first.original_command_id), first);
  peer.setHandler((_request, response, retained) => respond(response, retained));
  assert.deepEqual(await sender.recover(f.customer, first.original_command_id), first);
  assert.equal(starts(peer).length, 1); assert.equal(peer.requests.length, 3);
}));

test('RCG4BC5-SENDER-CLOSE closing during TLS preserves the original and prevents later owner use', () => usingSender(async ({ f, peer, sender, transport }) => {
  const pending = outcome(sender.start(f.customer, f.startRequest));
  await bounded(peer.handshakeEntered, 'closing handshake'); const rows = f.claimRows();
  sender.close(); peer.releaseHandshake(); failure(await pending);
  failure(await outcome(sender.start(f.customer, { ...f.startRequest, command_id: otherId })));
  failure(await outcome(sender.recover(f.customer, f.startRequest.command_id)));
  assert.deepEqual(f.claimRows(), rows); assert.equal(peer.requests.length, 0); assert.equal(peer.applicationBytes, 0);
  // The injected transport is a distinct owner, still usable after this sender
  // is retired. A wire recovery does not itself persist a native observation.
  peer.responses.set(f.startRequest.command_id, challenge(f));
  const recovery = f.claims.recovery(f.customer, f.startRequest.command_id);
  const bound = await transport.recover(original(f), recovery.request, () => {
    f.claims.recovery(f.customer, f.startRequest.command_id);
  });
  assert.equal(bound.response.recovered, true); assert.equal(peer.requests.length, 1);
  assert.equal(peer.requests[0].body.command, 'RECOVER_RESULT'); assert.deepEqual(f.claimRows(), rows);
}, { hold_handshake: true }));

test('RCG4BC5-SENDER-OWNERS concrete private brands and captured dispatch reject forged or overridden owners', () => usingSender(async ({ f, peer, transport }) => {
  let getters = 0;
  const config = { correlation: f.correlation, starts: f.starts, transport };
  for (const fake of [{ boundTo: () => true }, Object.create(InternalDelegatedUseClient.prototype), new Proxy(transport, {})])
    assert.throws(() => new DelegatedCheckoutCommandSender(f.kernel, { ...config, transport: fake as any }), CommandSenderDenied);
  for (const fake of [{ boundTo: () => true }, Object.create(DelegatedCheckoutStarts.prototype), new Proxy(f.starts, {})])
    assert.throws(() => new DelegatedCheckoutCommandSender(f.kernel, { ...config, starts: fake as any }), CommandSenderDenied);
  const accessor = Object.defineProperty({ correlation: f.correlation, starts: f.starts }, 'transport',
    { enumerable: true, get() { getters++; return transport; } });
  assert.throws(() => new DelegatedCheckoutCommandSender(f.kernel, accessor as any), CommandSenderDenied);
  Object.defineProperties(transport, Object.fromEntries(['boundTo', 'start', 'recover'].map(name => [name,
    { get() { getters++; throw new Error('instance dispatch must not run'); } }])));
  Object.defineProperties(f.starts, Object.fromEntries(['boundTo', 'prepare', 'assertCurrent'].map(name => [name,
    { get() { getters++; throw new Error('instance dispatch must not run'); } }])));
  const concrete = new DelegatedCheckoutCommandSender(f.kernel, config);
  try { assert.equal((await concrete.start(f.customer, f.startRequest)).state, 'observed'); }
  finally { concrete.close(); }
  assert.equal(getters, 0); assert.equal(starts(peer).length, 1);
}));

test('RCG4BC5-SENDER-CORRELATION exact fixed transport namespace is required and caller aliases cannot replace it', () => usingSender(async ({ f, peer, transport }) => {
  for (const correlation of [{ ...f.correlation, provider_ref: 'other-provider' },
    { ...f.correlation, organization_id: otherId },
    { ...f.correlation, actor: { type: 'MACHINE_IDENTITY', id: 'urn:rifare:other-machine' } }])
    assert.throws(() => new DelegatedCheckoutCommandSender(f.kernel, { correlation, starts: f.starts, transport }), CommandSenderDenied);
  const correlation = structuredClone(f.correlation);
  const sender = new DelegatedCheckoutCommandSender(f.kernel, { correlation, starts: f.starts, transport });
  correlation.actor.id = 'urn:rifare:changed-after-construction'; correlation.organization_id = otherId;
  try {
    const view = await sender.start(f.customer, f.startRequest);
    assert.equal(view.namespace_digest, f.claims.read(f.customer, f.startRequest.command_id).namespace_digest);
    assert.equal(peer.requests[0].path, '/internal/v1/organizations/' + f.correlation.organization_id + '/delegated-use-commands');
  } finally { sender.close(); }
}));

test('RCG4BC5-SENDER-INPUT rejected inputs and foreign customer proof create no original or network request', () => usingSender(async ({ f, peer, sender }) => {
  let getters = 0;
  const accessor = Object.defineProperty({ preview_id: f.preview.preview_id }, 'command_id',
    { enumerable: true, get() { getters++; return f.startRequest.command_id; } });
  for (const input of [null, {}, accessor, { ...f.startRequest, provider_authenticated: true },
    { ...f.startRequest, preview_id: 'unknown-native-preview' }])
    failure(await outcome(sender.start(f.customer, input as any)));
  const other = verifiedCustomer(f, f.a, 'ORD-1002');
  failure(await outcome(sender.start(other.scope, f.startRequest)));
  assert.equal(getters, 0); assert.equal(f.claimRows().length, 0); assert.equal(peer.requests.length, 0);
  await sender.start(f.customer, f.startRequest); const count = peer.requests.length, rows = f.claimRows();
  failure(await outcome(sender.recover(other.scope, f.startRequest.command_id)));
  assert.equal(peer.requests.length, count); assert.deepEqual(f.claimRows(), rows);
}));

test('RCG4BC5-SENDER-TLS-FAILURE server identity failure still consumes admission without leaking application bytes', () => usingSender(async ({ f, peer, sender }) => {
  const error = failure(await outcome(sender.start(f.customer, f.startRequest)));
  assert(!error.message.includes(peer.config.origin)); assert(!error.message.includes('PRIVATE KEY'));
  const first = f.claims.read(f.customer, f.startRequest.command_id), rows = f.claimRows();
  assert.equal(first.state, 'claimed'); assert.equal(first.response, null);
  failure(await outcome(sender.start(f.customer, f.startRequest)));
  failure(await outcome(sender.recover(f.customer, first.original_command_id)));
  assert.equal(peer.requests.length, 0); assert.equal(peer.applicationBytes, 0);
  assert.deepEqual(f.claimRows(), rows); assert.equal(f.claimRows().length, 1);
}, { server_identity: 'wrong-host' }));
