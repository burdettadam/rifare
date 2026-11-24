import test from 'node:test';
import assert from 'node:assert/strict';
import { claimOracle } from './command-fixtures.mts';
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
  artifactHeaders: Record<string, string | string[] | undefined> = {},
) {
  const peer = await delegatedUsePeer();
  const challenge = claimOracle.challenge_response.result.challenge_id;
  const uri = peer.config.origin + '/v1/flows/instances/' + challenge + '/request';
  peer.setHandler((request, response) => {
    response.statusCode = 200;
    if (request.method === 'GET') {
      response.setHeader('content-type', media);
      response.setHeader('pragma', 'no-cache');
      response.setHeader('x-content-type-options', 'nosniff');
      for (const [name, value] of Object.entries(artifactHeaders)) {
        if (value === undefined) response.removeHeader(name);
        else response.setHeader(name, value);
      }
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
    (link: string) => link + '; extra="value"',
    (_: string, uri: string) => '<' + uri.replace('https://', 'https://user@') + '>; rel="urn:marty:delegated-use:request"',
    (_: string, uri: string) => '<' + uri.replace('/request', '/%72equest') + '>; rel="urn:marty:delegated-use:request"',
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

test('PUBLIC-WIRE-HEADERS requires the assigned artifact cache and content protections', async () => {
  const changes: Record<string, string | string[] | undefined>[] = [
    { 'cache-control': 'public' }, { pragma: undefined },
    { 'x-content-type-options': undefined }, { 'content-encoding': 'gzip' },
    { pragma: ['no-cache', 'no-cache'] },
  ];
  for (const headers of changes) await fixture(async client => {
    const bound = await client.start(original.request, () => {});
    await assert.rejects(client.fetchRequest(original.request, bound, () => {}));
  }, undefined, compact, 'application/oauth-authz-req+jwt', headers);
});

test('PUBLIC-WIRE-TLS refuses foreign server trust before application bytes', () => fixture(async (_client, peer) => {
  const client = new PublicDelegatedUseClient({ ...peer.config, ca_pem: peer.credentials.otherCa.certificate_pem });
  try {
    await assert.rejects(client.start(original.request, () => {}));
    assert.equal(peer.requests.length, 0);
    assert.equal(peer.applicationBytes, 0);
  } finally { client.close(); }
}));

test('PUBLIC-WIRE-TLS-GUARD checks withdrawal after the handshake before any HTTP bytes', () => fixture(async (client, peer) => {
  peer.holdHandshake();
  let allowed = true;
  const pending = client.start(original.request, () => { if (!allowed) throw new Error('withdrawn'); });
  const rejected = assert.rejects(pending);
  await peer.handshakeEntered;
  allowed = false;
  peer.releaseHandshake();
  await rejected;
  assert.equal(peer.requests.length, 0);
  assert.equal(peer.applicationBytes, 0);
}));

test('PUBLIC-WIRE-LOSS requires explicit original recovery after a lost response', () => fixture(async (client, peer) => {
  peer.setHandler((_request, response) => response.destroy());
  await assert.rejects(client.start(original.request, () => {}));
  assert.equal(peer.requests.length, 1);
  assert.equal(peer.requests[0].raw.toString(), original.canonical_json);
  peer.setHandler((request, response) => {
    response.statusCode = 200;
    response.setHeader('link', '<' + peer.config.origin + '/v1/flows/instances/' +
      claimOracle.challenge_response.result.challenge_id + '/request>; rel="urn:marty:delegated-use:request"');
    response.end(JSON.stringify({ ...claimOracle.challenge_response, recovered: true }));
  });
  const recovered = await client.recover(original.request, original.recovery_request, () => {});
  assert.equal(recovered.response.recovered, true);
  assert.equal(peer.requests.length, 2);
  assert.equal(peer.requests[1].raw.toString(), original.recovery_canonical_json);
}));

test('PUBLIC-WIRE-CLOSE refuses further calls and exposes no proof or finalization method', () => fixture(async (client, peer) => {
  assert.equal('finalize' in client, false);
  assert.equal('submitProof' in client, false);
  client.close();
  await assert.rejects(client.start(original.request, () => {}));
  assert.equal(peer.connections, 0);
}));

test('PUBLIC-WIRE-HOSTNAME refuses a trusted certificate for another server name', async () => {
  const peer = await delegatedUsePeer({ server_identity: 'wrong-host' });
  const client = new PublicDelegatedUseClient(peer.config);
  try {
    await assert.rejects(client.start(original.request, () => {}));
    assert.equal(peer.applicationBytes, 0);
    assert.equal(peer.requests.length, 0);
  } finally { client.close(); await peer.close(); }
});

test('PUBLIC-WIRE-CLIENT refuses a foreign chain and invalid local identity bindings', () => fixture(async (_client, peer) => {
  const foreign = new PublicDelegatedUseClient({ ...peer.config, ...peer.credentials.foreignClient });
  try {
    await assert.rejects(foreign.start(original.request, () => {}));
    assert.equal(peer.requests.length, 0);
  } finally { foreign.close(); }
  for (const identity of [peer.credentials.expiredClient, peer.credentials.ambiguousClient, peer.credentials.noUriClient]) {
    assert.throws(() => new PublicDelegatedUseClient({ ...peer.config, ...identity }));
  }
  assert.throws(() => new PublicDelegatedUseClient({ ...peer.config, certificate_sha256: 'sha256:' + '0'.repeat(64) }));
}));

test('PUBLIC-WIRE-ASYNC refuses an asynchronous guard without opening a connection', () => fixture(async (client, peer) => {
  await assert.rejects(client.start(original.request, async () => {}));
  assert.equal(peer.connections, 0);
  assert.equal(peer.applicationBytes, 0);
}));

test('PUBLIC-WIRE-DEADLINE bounds a stalled response and never retries', () => fixture(async (_client, peer) => {
  peer.setHandler(() => {});
  const client = new PublicDelegatedUseClient({ ...peer.config, timeout_ms: 60 });
  try {
    await assert.rejects(client.start(original.request, () => {}), error =>
      error instanceof Error && error.message === 'PUBLIC_USE_TIMEOUT');
    assert.equal(peer.requests.length, 1);
  } finally { client.close(); }
}));

test('PUBLIC-WIRE-CAPACITY bounds pending exchanges and close terminates active requests', () => fixture(async (client, peer) => {
  peer.setHandler(() => {});
  const pending = Array.from({ length: 8 }, () => client.start(original.request, () => {})
    .then(() => 'unexpected-success', error => (error as Error).message));
  await assert.rejects(client.start(original.request, () => {}), error =>
    error instanceof Error && error.message === 'PUBLIC_USE_CAPACITY');
  const deadline = Date.now() + 1000;
  while (peer.requests.length < 8 && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(peer.requests.length, 8);
  client.close();
  assert.deepEqual(await Promise.all(pending), Array(8).fill('PUBLIC_USE_UNAVAILABLE'));
}));

test('PUBLIC-WIRE-RESPONSE-BOUNDS refuses oversized headers, streaming bodies and truncated commands', async () => {
  const faults = ['headers', 'stream', 'truncated'];
  for (const fault of faults) await fixture(async (client, peer) => {
    peer.setHandler((_request, response) => {
      response.statusCode = 200;
      if (fault === 'headers') {
        response.setHeader('x-synthetic-padding', 'a'.repeat(20000));
        response.end(JSON.stringify(claimOracle.challenge_response));
      } else if (fault === 'stream') {
        response.write('a'.repeat(40000));
        response.end('b'.repeat(40000));
      } else {
        response.setHeader('content-length', '1000');
        response.end('{}');
      }
    });
    await assert.rejects(client.start(original.request, () => {}));
    assert.equal(peer.requests.length, 1);
  });
});

test('PUBLIC-WIRE-ARTIFACT-STREAM bounds a chunked request artifact without a declared length', () => fixture(async (client, peer) => {
  const bound = await client.start(original.request, () => {});
  peer.setHandler((_request, response) => {
    response.statusCode = 200;
    response.setHeader('content-type', 'application/oauth-authz-req+jwt');
    response.setHeader('pragma', 'no-cache');
    response.setHeader('x-content-type-options', 'nosniff');
    response.write('a'.repeat(60000));
    response.end('.' + 'b'.repeat(60000) + '.c');
  });
  await assert.rejects(client.fetchRequest(original.request, bound, () => {}));
  assert.equal(peer.requests.length, 2);
}));

test('PUBLIC-WIRE-NATIVE-ADMISSION runs after TLS and sends only captured bytes after commit', () => fixture(async (client, peer) => {
  let guards = 0, admissions = 0;
  const request = structuredClone(original.request);
  const bound = await client.startAfterAdmission(request, async () => {
    admissions++;
    assert.equal(peer.requests.length, 0);
    assert.equal(peer.applicationBytes, 0);
    assert.equal(guards, 2);
    request.command_id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  }, () => { guards++; });
  assert.deepEqual(bound.response, claimOracle.challenge_response);
  assert.equal(admissions, 1);
  assert.equal(guards, 2, 'No caller callback may run after the committed admission returns');
  assert.equal(peer.requests[0].raw.toString(), original.canonical_json);
}));

test('PUBLIC-WIRE-NATIVE-REFUSAL sends zero bytes when native admission fails', () => fixture(async (client, peer) => {
  await assert.rejects(client.startAfterAdmission(original.request, async () => {
    throw new Error('Synthetic native currentness refusal');
  }, () => {}));
  assert.equal(peer.requests.length, 0);
  assert.equal(peer.applicationBytes, 0);
}));

test('PUBLIC-WIRE-NATIVE-CLOSE cannot resume transmission after closing during admission', () => fixture(async (client, peer) => {
  let entered!: () => void, proceed!: () => void;
  const entry = new Promise<void>(resolve => { entered = resolve; });
  const release = new Promise<void>(resolve => { proceed = resolve; });
  const pending = client.startAfterAdmission(original.request, async () => {
    entered();
    await release;
  }, () => {});
  const rejected = assert.rejects(pending);
  await entry;
  client.close();
  proceed();
  await rejected;
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(peer.requests.length, 0);
  assert.equal(peer.applicationBytes, 0);
}));

test('PUBLIC-WIRE-NATIVE-HANDSHAKE cannot admit an original before TLS completes', () => fixture(async (client, peer) => {
  peer.holdHandshake();
  let admissions = 0;
  const pending = client.startAfterAdmission(original.request, async () => { admissions++; }, () => {});
  const rejected = assert.rejects(pending);
  await peer.handshakeEntered;
  assert.equal(admissions, 0);
  client.close();
  peer.releaseHandshake();
  await rejected;
  assert.equal(admissions, 0);
  assert.equal(peer.requests.length, 0);
}));
