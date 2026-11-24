import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { claimOracle } from './delegated-command-claim-helpers.mts';
import { delegatedUsePeer } from './delegated-use-client-helpers.mts';

test('compiled authority adapters relocate and perform C1 and public mTLS without repository imports', async () => {
  const application = fileURLToPath(new URL('../../apps/commerce-backend/', import.meta.url));
  const build = spawnSync(process.execPath, ['tools/build-authority-adapters.mjs'], {
    cwd: application, encoding: 'utf8', timeout: 30000,
  });
  assert.equal(build.status, 0, build.stderr);
  const parent = realpathSync(tmpdir());
  const directory = mkdtempSync(join(parent, 'rifare-compiled-authority-'));
  let peer: Awaited<ReturnType<typeof delegatedUsePeer>> | undefined;
  let client: { close(): void } | undefined;
  try {
    cpSync(join(application, '.medusa/server/rifare'), directory, { recursive: true });
    const receiptRequire = createRequire(new URL('../../packages/adapters/delegated-receipts/package.json', import.meta.url));
    const jose = dirname(dirname(dirname(receiptRequire.resolve('jose'))));
    cpSync(jose, join(directory, 'node_modules/jose'), { recursive: true });
    const { wire, codec } = await import(pathToFileURL(join(directory, 'authority-adapters.mjs')).href);
    const original = claimOracle.commands.find((value: any) => value.name === 'start_use');
    const encoded = codec.encodeDelegatedCommand(original.request);
    assert.equal(encoded.canonical_json, original.canonical_json);
    assert.equal(encoded.command_digest, original.command_digest);
    peer = await delegatedUsePeer();
    const selected = peer;
    peer.setHandler((_request, response) => {
      response.statusCode = 200;
      response.setHeader('link', '<' + selected.config.origin + '/v1/flows/instances/' +
        claimOracle.challenge_response.result.challenge_id + '/request>; rel="urn:marty:delegated-use:request"');
      response.end(JSON.stringify(claimOracle.challenge_response));
    });
    const transport = new wire.PublicDelegatedUseClient(peer.config);
    client = transport;
    const response = await transport.start(encoded.request, () => {});
    assert.deepEqual(response.response, claimOracle.challenge_response);
    assert.equal(response.execution_authorized, false);
    assert.equal(peer.requests[0].path, '/v1/organizations/' +
      peer.correlation.organization_id + '/delegated-use-commands');
    assert.equal(peer.requests[0].raw.toString(), original.canonical_json);
    assert.equal(peer.requests[0].tls_authorized, true);
  } finally {
    client?.close();
    await peer?.close();
    assert.equal(dirname(realpathSync(directory)), parent);
    assert.ok(basename(directory).startsWith('rifare-compiled-authority-'));
    rmSync(directory, { recursive: true });
  }
});
