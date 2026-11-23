import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readAdapterCatalog, validateAdapterCatalog, catalogCases } from '../../packages/conformance/adapter-catalog.mts';
import { contentDigest, jsonValue } from '../../packages/commerce/configuration-values.mts';

const adapterId = 'delegated_use_internal_client';
const source = 'packages/adapters/delegated-commands/internal-use-client.mts';
const tests = 'tests/development/delegated-use-client.test.mts';
const select = (catalog: any) => catalog.adapters.find((value: any) => value.id === adapterId);
const fileHash = (path: string) => createHash('sha256').update(readFileSync(new URL('../../' + path, import.meta.url))).digest('hex');

test('RCG4BC5-CATALOG-REGISTRATION internal START and recovery have actual bounded wire cases and no external qualification', () => {
  const catalog = readAdapterCatalog(), result = validateAdapterCatalog(catalog), value = select(catalog);
  assert.equal(result.adapter_count, 48); assert.equal(result.operation_count, 227);
  assert.equal(result.native_case_count, 336); assert.equal(result.direct_fixture_count, 47);
  assert.deepEqual(value.source_files.map((pin: any) => pin.path), [source]);
  assert.deepEqual(value.operations.map((operation: any) => operation.id), ['delegated.internal.start', 'delegated.internal.recover']);
  const names = [...readFileSync(new URL('./delegated-use-client.test.mts', import.meta.url), 'utf8').matchAll(/test\('([^']+)'/g)]
    .map(match => match[1]);
  const registered = catalogCases({ adapters: [value] }); assert.equal(registered.length, 8);
  for (const ref of registered) { assert.equal(ref.path, tests); assert(names.includes(ref.name)); assert.equal(ref.sha256, fileHash(tests)); }
  for (const operation of value.operations) {
    assert.equal(operation.semantics, 'native'); assert.equal(operation.qualification, 'sandbox-only');
    assert.equal(operation.scope_kind, 'server_local_fixture_only'); assert.deepEqual(operation.required_scopes, []);
    assert.deepEqual(operation.direct_fixtures, []); assert(operation.native_cases.length > 0);
  }
  assert.equal(value.external_account, null); assert.equal(value.external_version, null);
  assert.equal(value.external_scopes_attested, false); assert.equal(result.external_qualification, false);
  assert.equal(result.production_qualified, false);
});

test('RCG4BC5-CATALOG-PRESERVATION all prior adapters and complete coverage retain independently frozen protected bytes', () => {
  const catalog = readAdapterCatalog(), previous = catalog.adapters.filter((value: any) => value.id !== adapterId);
  assert.equal(previous.length, 47);
  // Independently computed from public C4 9c61f30 with Python json.dumps
  // sort_keys/separators and hashlib before any C5 control mutation.
  assert.equal(createHash('sha256').update(JSON.stringify(jsonValue(previous, 262144))).digest('hex'),
    'b40a2d53f95055cae9ed4e5d5610f86f17e24775c9de522c2ef6c77b40179bcb');
  const expected = JSON.parse(readFileSync(new URL('../fixtures/conformance/expected-coverage.v1.json', import.meta.url), 'utf8'));
  delete expected.adapter_operations[adapterId]; delete expected.adapter_contracts[adapterId];
  expected.declarations = expected.declarations.filter((path: string) => path !== source);
  expected.native_cases = expected.native_cases.filter((ref: any) => ref.path !== tests);
  assert.equal(expected.native_cases.length, 328); assert.equal(Object.keys(expected.adapter_operations).length, 47);
  assert.equal(contentDigest(expected), '255cdb8ae87dd0a611cf08e0648728d270b5357a791caa5dda2d5ff99e7ff9e6');
});

test('RCG4BC5-CATALOG-PINS actual source dependency and case pins remain mandatory within the unchanged byte limit', () => {
  const catalog = readAdapterCatalog(), value = select(catalog);
  assert.equal(value.source_files[0].sha256, fileHash(source));
  assert(Buffer.byteLength(JSON.stringify(jsonValue(catalog, 262144))) <= 262144);
  const badSource = structuredClone(catalog); select(badSource).source_files[0].sha256 = '0'.repeat(64);
  assert.throws(() => validateAdapterCatalog(badSource), /ADAPTER_CATALOG_PIN_CHANGED/);
  const badCase = structuredClone(catalog); select(badCase).operations[0].native_cases[0].sha256 = '0'.repeat(64);
  assert.throws(() => validateAdapterCatalog(badCase), /ADAPTER_CATALOG_PIN_CHANGED/);
  for (const path of ['packages/commerce/delegated-command-claims.mts', 'tests/development/delegated-use-client-helpers.mts']) {
    const pin = catalog.oracle_pins.find((entry: any) => entry.path === path);
    assert(pin, 'A reached dependency must be pinned: ' + path); assert.equal(pin.sha256, fileHash(path));
    const changed = structuredClone(catalog); changed.oracle_pins.find((entry: any) => entry.path === path).sha256 = '0'.repeat(64);
    assert.throws(() => validateAdapterCatalog(changed), /ADAPTER_CATALOG_PIN_CHANGED/);
  }
  const removed = structuredClone(catalog); removed.adapters = removed.adapters.filter((entry: any) => entry.id !== adapterId);
  assert.throws(() => validateAdapterCatalog(removed), /ADAPTER_CATALOG_COVERAGE_CHANGED/);
  const falselyQualified = structuredClone(catalog); select(falselyQualified).external_scopes_attested = true;
  assert.throws(() => validateAdapterCatalog(falselyQualified), /ADAPTER_CATALOG_EXTERNAL_QUALIFICATION_UNAVAILABLE/);
});
