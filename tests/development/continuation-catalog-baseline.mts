import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { jsonValue, contentDigest } from '../../packages/commerce/configuration-values.mts';

export const continuationId = 'delegated_use_public_continuation';
const source = 'packages/adapters/delegated-commands/public-use-client.mts';
const tests = 'tests/development/public-delegated-continuation.test.mts';
const coverage = 'tests/fixtures/conformance/expected-coverage.v1.json';
const fixtures = 'tests/fixtures/conformance/contract-cases.v1.json';
const receiptHelper = 'tests/development/receipt-signature-helpers.mts';
const previousHash = 'e05461dc4bec360cdcb2ce58cd6965f1c63ee53092e186d174aa9825636bf0a1';
const previousFixtureHash = '07c551fc00de3372ead114e8d892ae7ed01debc066f3b3fb91d00e33adc43bcb';
const previousReceiptHelperHash = 'c6707e20284f7aad81e56cc7c7c1e936141c6e3fef1b6e3b17815130a61ff477';
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

// Historical comparisons reconstruct only these reviewed pin renewals. Current
// bytes and exact occurrence counts must match before substituting old hashes;
// runtime catalog validation still checks the unmodified current inputs.
function restorePreviousPreparationPins(value: any, kind: 'catalog'|'coverage') {
  const pins = [
    { path: 'tests/development/growth-marketing.test.mts', current: 'e068b909ca74b9aebe2d16d1d0832c80bf92c14998112359477606e630345262', previous: 'c6d1efb28caff707c65399a952e555a371772afb0b02397ad195c583adad3651', count: kind === 'catalog' ? 8 : 6 },
    { path: 'tests/fixtures/ecosystem-assurance/sdk-pins.v1.json', current: 'b729bce723fd803f8597a561b8b6524ddc6b2c0656d5531b558f39ae86f3d00c', previous: 'ce3736f79bd8c8e95836acec84ab2ed6ac84ca58b19d2b3c95b33d2387f1a107', count: kind === 'catalog' ? 1 : 0 },
    { path: 'tests/fixtures/ecosystem-assurance/typed-source-pins.v1.json', current: '75a744c8820f3f704c9c0095e297679f3722fb4bae0f6e8e19aa08d39b71de1f', previous: '6eec87b7021bc8a9f85eae12cc427e8cfacf70adbcf4c7faabd3a1ec57bf9f17', count: kind === 'catalog' ? 1 : 0 },
  ];
  const copy = structuredClone(value), counts = new Map(pins.map(pin => [pin.path, 0]));
  function walk(current: any) {
    if (!current || typeof current !== 'object') return;
    const pin = pins.find(pin => current.path === pin.path);
    if (pin) {
      assert.equal(fileHash(pin.path), pin.current); assert.equal(current.sha256, pin.current); current.sha256 = pin.previous;
      counts.set(pin.path, counts.get(pin.path)! + 1);
    }
    for (const child of Object.values(current)) walk(child);
  }
  walk(copy);
  for (const pin of pins) assert.equal(counts.get(pin.path), pin.count);
  return copy;
}

export function withoutContinuationCatalog(catalog: any) {
  const found = catalog.adapters.filter((value: any) => value.id === continuationId);
  assert.equal(found.length, 1);
  assert.deepEqual(found[0], { id: continuationId, kind: 'diagnostic', source_files: [{ path: source, sha256: fileHash(source) }],
    version, api_version: api, external_version: null, external_account: null, external_scopes_attested: false, source_oracle: oracle,
    operations: operations.map(id => ({ id, semantics: 'native', qualification: 'sandbox-only', required_scopes: [],
      scope_kind: 'server_local_fixture_only', native_cases: refs, direct_fixtures: [] })) });
  return restorePreviousPreparationPins({ ...catalog, adapters: catalog.adapters.filter((value: any) => value.id !== continuationId) }, 'catalog');
}
export function withoutContinuationCoverage(expected: any) {
  assert.deepEqual(expected.adapter_operations[continuationId], Object.fromEntries(operations.map(id => [id, { semantics: 'native', qualification: 'sandbox-only' }])));
  assert.deepEqual(expected.adapter_contracts[continuationId], { version, api_version: api, operations: contracts });
  assert.deepEqual(expected.native_cases.filter((ref: any) => ref.path === tests).sort((a: any, b: any) => a.id.localeCompare(b.id)),
    [...refs].sort((a, b) => a.id.localeCompare(b.id)));
  assert.equal(expected.declarations.filter((path: string) => path === source).length, 1);
  const previous = structuredClone(expected); delete previous.adapter_operations[continuationId]; delete previous.adapter_contracts[continuationId];
  previous.native_cases = previous.native_cases.filter((ref: any) => ref.path !== tests);
  return restorePreviousPreparationPins(previous, 'coverage'); // Source declaration is shared with retained C6.
}
function previousPublicVersion(value: any) {
  const publicEntry = value.adapters.find((entry: any) => entry.id === 'delegated_use_public_client');
  assert.equal(publicEntry.version, version); assert.deepEqual(publicEntry.source_files, [{ path: source, sha256: fileHash(source) }]);
  publicEntry.version = 'source-sha256:' + previousHash; publicEntry.source_files[0].sha256 = previousHash;
}
export function restorePreviousCatalogFixturePin(value: any) {
  const pin = value.oracle_pins.find((entry: any) => entry.path === fixtures);
  assert.equal(pin.sha256, fileHash(fixtures)); pin.sha256 = previousFixtureHash;
  return value;
}
export function restorePreviousReceiptHelperPin(value: any) {
  const pin = value.oracle_pins.find((entry: any) => entry.path === receiptHelper);
  assert.equal(pin.sha256, fileHash(receiptHelper)); pin.sha256 = previousReceiptHelperHash;
  return value;
}
export function assertPreviousCatalog(catalog: any, expected: any) {
  const previous = structuredClone(withoutContinuationCatalog(catalog)); previousPublicVersion(previous);
  const pin = previous.oracle_pins.find((entry: any) => entry.path === coverage);
  assert.equal(pin.sha256, fileHash(coverage)); pin.sha256 = 'd6f5f15a8e60033ecfc585fe1760bd7019ff0523f21008dc784393460e3c6b53';
  restorePreviousCatalogFixturePin(previous);
  restorePreviousReceiptHelperPin(previous);
  assert.equal(createHash('sha256').update(JSON.stringify(jsonValue(previous, 327680))).digest('hex'),
    '525fe0356ee0912d35ab1cd0c9404837e4054d524f602850ed6293990e37256a');
  const coverageBefore = withoutContinuationCoverage(expected);
  assert.equal(coverageBefore.adapter_contracts.delegated_use_public_client.version, version);
  coverageBefore.adapter_contracts.delegated_use_public_client.version = 'source-sha256:' + previousHash;
  assert.equal(contentDigest(coverageBefore), 'a0dd3d8aae778fb027edda176f621d333a6c4d55251fc2064c3f9e28b1cd952d');
}
