import test from 'node:test';
import assert from 'node:assert/strict';
import { claimOracle } from './delegated-command-claim-helpers.mts';
import { delegatedUsePeer } from './delegated-use-client-helpers.mts';
import { PublicDelegatedUseClient } from '../../packages/adapters/delegated-commands/public-use-client.mts';

const original = claimOracle.commands.find((value: any) => value.name === 'start_use');
const compact = 'eyJhbGciOiJFUzI1NiJ9.eyJub25jZSI6InN5bnRoZXRpYyJ9.c3ludGhldGlj';
type Peer = Awaited<ReturnType<typeof delegatedUsePeer>>;
type Client = InstanceType<typeof PublicDelegatedUseClient>;

async function fixture(
  run: (client: Client, peer: Peer, uri: string) => Promise<void>,
  linkChange?: (link: string, uri: string) => string | string[],
  artifact = compact,
  media = 'application/oauth-authz-req+jwt',
) {
  const peer = await delegatedUsePeer();
  const challenge = claimOracle.challenge_response.result.challenge_id;
  const uri = peer.config.origin + '/v1/flows/instances/' + challenge + '/request';
  peer.setHandler((request, response) => {
    response.statusCode = 200;
    if (request.method === 'GET') {
      response.setHeader('content-type', media);
      response.end(artifact);
      return;
    }
    const body = structuredClone(claimOracle.challenge_response);
    body.recovered = request.body.command === 'RECOVER_RESULT';
    const link = '<' + uri + '>; rel="urn:marty:delegated-use:request"';
    response.setHeader('link', linkChange ? linkChange(link, uri) : link);
    response.end(JSON.stringify(body));
  });
  const client = new PublicDelegatedUseClient(peer.config);
  try { await run(client, peer, uri); }
  finally { client.close(); await peer.close(); }
}

test('PUBLIC-WIRE-START sends the exact original to the public command route', () => fixture(async (client, peer) => {
  const result = await client.start(original.request, () => {});
  assert.deepEqual(result.response, claimOracle.challenge_response);
  assert.equal(peer.requests.length, 1);
  assert.equal(peer.requests[0].path, '/v1/organizations/' + peer.correlation.organization_id + '/delegated-use-commands');
  assert.equal(peer.requests[0].raw.toString(), original.canonical_json);
  assert.equal(peer.requests[0].tls_authorized, true);
  assert.equal(peer.requests[0].certificate_sha256, peer.config.certificate_sha256);
  assert.equal(result.execution_authorized, false);
}));

test('PUBLIC-WIRE-ARTIFACT retains exact unverified bytes on a fresh authenticated connection', () => fixture(async (client, peer, uri) => {
  const bound = await client.start(original.request, () => {});
  const artifact = await client.fetchRequest(original.request, bound, () => {});
  assert.equal(artifact.compact_jws, compact);
  assert.equal(artifact.request_uri, uri);
  assert.equal(artifact.original_command_id, original.request.command_id);
  assert.equal(artifact.command_digest, original.command_digest);
  assert.equal(artifact.challenge_id, claimOracle.challenge_response.result.challenge_id);
  assert.equal(artifact.execution_authorized, false);
  assert.equal(artifact.request_signature_verified, false);
  assert.equal(peer.requests[1].method, 'GET');
  assert.equal(peer.requests[1].path, new URL(uri).pathname);
  assert.equal(peer.requests[1].raw.length, 0);
  assert.equal(peer.requests[1].tls_authorized, true);
  assert.notEqual(peer.requests[0].connection_id, peer.requests[1].connection_id);
}));

test('PUBLIC-WIRE-RECOVER preserves the original recovery bytes and request binding', () => fixture(async (client, peer) => {
  const bound = await client.recover(original.request, original.recovery_request, () => {});
  assert.equal(bound.response.recovered, true);
  assert.equal(peer.requests[0].raw.toString(), original.recovery_canonical_json);
  const artifact = await client.fetchRequest(original.request, bound, () => {});
  assert.equal(artifact.compact_jws, compact);
}));

test('PUBLIC-WIRE-LINK refuses duplicate, foreign, altered challenge and decorated destinations', async () => {
  const changes = [
    (link: string) => [link, link],
    (link: string) => link + ', ' + link,
    (_: string, uri: string) => '<' + uri.replace('localhost', 'foreign.example.invalid') + '>; rel="urn:marty:delegated-use:request"',
    (_: string, uri: string) => '<' + uri.replace(/instances\/[^/]+/, 'instances/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee') + '>; rel="urn:marty:delegated-use:request"',
    (_: string, uri: string) => '<' + uri + '?extra=1>; rel="urn:marty:delegated-use:request"',
    (_: string, uri: string) => '<' + uri + '#extra>; rel="urn:marty:delegated-use:request"',
    (link: string) => link.replace('urn:marty:delegated-use:request', 'alternate'),
  ];
  for (const change of changes) await fixture(async (client, peer) => {
    await assert.rejects(client.start(original.request, () => {}));
    assert.equal(peer.requests.length, 1);
  }, change);
});

test('PUBLIC-WIRE-BINDING refuses copied responses and changed originals before request retrieval', () => fixture(async (client, peer) => {
  const bound = await client.start(original.request, () => {});
  await assert.rejects(client.fetchRequest(original.request, structuredClone(bound), () => {}));
  const changed = { ...original.request, command_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' };
  await assert.rejects(client.fetchRequest(changed, bound, () => {}));
  assert.equal(peer.requests.length, 1);
}));

test('PUBLIC-WIRE-ARTIFACT-INVALID refuses malformed bytes, excess size and incorrect media', async () => {
  for (const value of ['', compact + '\n', 'not-a-jws', 'a.b.c.d', 'a'.repeat(100001)]) {
    await fixture(async client => {
      const bound = await client.start(original.request, () => {});
      await assert.rejects(client.fetchRequest(original.request, bound, () => {}));
    }, undefined, value);
  }
  await fixture(async client => {
    const bound = await client.start(original.request, () => {});
    await assert.rejects(client.fetchRequest(original.request, bound, () => {}));
  }, undefined, compact, 'application/json');
});

test('PUBLIC-WIRE-GUARD refuses retrieval without sending application bytes after withdrawal', () => fixture(async (client, peer) => {
  const bound = await client.start(original.request, () => {});
  const bytes = peer.applicationBytes;
  await assert.rejects(client.fetchRequest(original.request, bound, () => { throw new Error('withdrawn'); }));
  assert.equal(peer.requests.length, 1);
  assert.equal(peer.applicationBytes, bytes);
}));
