import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { withoutContinuationCatalog, withoutContinuationCoverage } from './continuation-catalog-baseline.mts';
const id = 'delegated_use_public_client';
const source = 'packages/adapters/delegated-commands/public-use-client.mts';
const tests = 'tests/development/public-delegated-use.test.mts';
const operations = ['delegated.public.start', 'delegated.public.recover', 'delegated.public.request_artifact'];
const hash = (path: string) => createHash('sha256').update(readFileSync(new URL('../../' + path, import.meta.url))).digest('hex');
const version = 'source-sha256:' + hash(source);
const api_version = 'public-mtls-p03-start-recovery-request-v1';
const refs = [...readFileSync(new URL('../../' + tests, import.meta.url), 'utf8').matchAll(/test\('([^']+)'/g)]
  .map(match => ({ id: match[1].split(' ')[0], name: match[1], path: tests, sha256: hash(tests) }));
assert.equal(refs.length, 23);
const sorted = (values: any[]) => [...values].sort((a, b) => a.id.localeCompare(b.id, 'en'));
const contracts = Object.fromEntries(operations.map(op => [op, { required_scopes: [], scope_kind: 'server_local_fixture_only' }]));
export function removeExactPublicAdapter(catalog: any) {
  catalog = withoutContinuationCatalog(catalog);
  const entries = catalog.adapters.filter((value: any) => value.id === id);
  assert.equal(entries.length, 1);
  const value = entries[0];
  assert.equal(value.kind, 'diagnostic');
  assert.deepEqual(value.source_files, [{ path: source, sha256: hash(source) }]);
  assert.equal(value.version, version); assert.equal(value.api_version, api_version);
  assert.equal(value.external_version, null); assert.equal(value.external_account, null);
  assert.equal(value.external_scopes_attested, false);
  assert.deepEqual(value.operations.map((op: any) => op.id), operations);
  for (const op of value.operations) {
    assert.equal(op.semantics, 'native'); assert.equal(op.qualification, 'sandbox-only');
    assert.deepEqual(op.required_scopes, []); assert.equal(op.scope_kind, 'server_local_fixture_only');
    assert.deepEqual(op.direct_fixtures, []); assert.deepEqual(sorted(op.native_cases), sorted(refs));
  }
  return { ...catalog, adapters: catalog.adapters.filter((value: any) => value.id !== id) };
}
export function removeExactPublicCoverage(expected: any) {
  expected = withoutContinuationCoverage(expected);
  assert.deepEqual(expected.adapter_operations[id], Object.fromEntries(operations.map(op => [op, { semantics: 'native', qualification: 'sandbox-only' }])));
  assert.deepEqual(expected.adapter_contracts[id], { version, api_version, operations: contracts });
  assert.equal(expected.declarations.filter((path: string) => path === source).length, 1);
  assert.deepEqual(sorted(expected.native_cases.filter((ref: any) => ref.path === tests)), sorted(refs));
  const previous = structuredClone(expected);
  delete previous.adapter_operations[id]; delete previous.adapter_contracts[id];
  previous.declarations = previous.declarations.filter((path: string) => path !== source);
  previous.native_cases = previous.native_cases.filter((ref: any) => ref.path !== tests);
  return previous;
}
