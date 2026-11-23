import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { jsonValue, contentDigest } from '../../packages/commerce/configuration-values.mts';

export const continuationId = 'delegated_use_public_continuation';
const source = 'packages/adapters/delegated-commands/public-use-client.mts';
const tests = 'tests/development/public-delegated-continuation.test.mts';
const coverage = 'tests/fixtures/conformance/expected-coverage.v1.json';
const previousHash = 'e05461dc4bec360cdcb2ce58cd6965f1c63ee53092e186d174aa9825636bf0a1';
const fileHash = (path: string) => createHash('sha256').update(readFileSync(new URL('../../' + path, import.meta.url))).digest('hex');
const version = 'source-sha256:' + fileHash(source);
const api = 'public-mtls-p03-proof-finalize-receipt-v1';
const operations = ['delegated.public.proof_submit', 'delegated.public.finalize', 'delegated.public.recover_final', 'delegated.public.recover_receipt'];
const refs = [...readFileSync(new URL('../../' + tests, import.meta.url), 'utf8').matchAll(/test\('([^']+)'/g)]
  .map(match => ({ id: match[1].split(' ')[0], name: match[1], path: tests, sha256: fileHash(tests) }));
assert.equal(refs.length, 24);
export const continuationCases = refs.length;
const contracts = Object.fromEntries(operations.map(id => [id, { required_scopes: [], scope_kind: 'server_local_fixture_only' }]));
const oracle = 'Synthetic loopback mutual-TLS peers qualify continuation wire handling only. No signature verification, native proof authority, credential custody, connected provider or commerce effect is qualified.';

export function withoutContinuationCatalog(catalog: any) {
  const found = catalog.adapters.filter((value: any) => value.id === continuationId);
  assert.equal(found.length, 1);
  assert.deepEqual(found[0], { id: continuationId, kind: 'diagnostic', source_files: [{ path: source, sha256: fileHash(source) }],
    version, api_version: api, external_version: null, external_account: null, external_scopes_attested: false, source_oracle: oracle,
    operations: operations.map(id => ({ id, semantics: 'native', qualification: 'sandbox-only', required_scopes: [],
      scope_kind: 'server_local_fixture_only', native_cases: refs, direct_fixtures: [] })) });
  return { ...catalog, adapters: catalog.adapters.filter((value: any) => value.id !== continuationId) };
}
export function withoutContinuationCoverage(expected: any) {
  assert.deepEqual(expected.adapter_operations[continuationId], Object.fromEntries(operations.map(id => [id, { semantics: 'native', qualification: 'sandbox-only' }])));
  assert.deepEqual(expected.adapter_contracts[continuationId], { version, api_version: api, operations: contracts });
  assert.deepEqual(expected.native_cases.filter((ref: any) => ref.path === tests).sort((a: any, b: any) => a.id.localeCompare(b.id)),
    [...refs].sort((a, b) => a.id.localeCompare(b.id)));
  assert.equal(expected.declarations.filter((path: string) => path === source).length, 1);
  const previous = structuredClone(expected); delete previous.adapter_operations[continuationId]; delete previous.adapter_contracts[continuationId];
  previous.native_cases = previous.native_cases.filter((ref: any) => ref.path !== tests);
  return previous; // The source declaration is shared with the retained C6 profile.
}
function previousPublicVersion(value: any) {
  const publicEntry = value.adapters.find((entry: any) => entry.id === 'delegated_use_public_client');
  assert.equal(publicEntry.version, version); assert.deepEqual(publicEntry.source_files, [{ path: source, sha256: fileHash(source) }]);
  publicEntry.version = 'source-sha256:' + previousHash; publicEntry.source_files[0].sha256 = previousHash;
}
export function assertPreviousCatalog(catalog: any, expected: any) {
  const previous = structuredClone(withoutContinuationCatalog(catalog)); previousPublicVersion(previous);
  const pin = previous.oracle_pins.find((entry: any) => entry.path === coverage);
  assert.equal(pin.sha256, fileHash(coverage)); pin.sha256 = 'd6f5f15a8e60033ecfc585fe1760bd7019ff0523f21008dc784393460e3c6b53';
  assert.equal(createHash('sha256').update(JSON.stringify(jsonValue(previous, 327680))).digest('hex'),
    '525fe0356ee0912d35ab1cd0c9404837e4054d524f602850ed6293990e37256a');
  const coverageBefore = withoutContinuationCoverage(expected);
  assert.equal(coverageBefore.adapter_contracts.delegated_use_public_client.version, version);
  coverageBefore.adapter_contracts.delegated_use_public_client.version = 'source-sha256:' + previousHash;
  assert.equal(contentDigest(coverageBefore), 'a0dd3d8aae778fb027edda176f621d333a6c4d55251fc2064c3f9e28b1cd952d');
}
