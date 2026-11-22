import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readAdapterCatalog, validateAdapterCatalog, catalogCases } from '../../packages/conformance/adapter-catalog.mts';
import { contentDigest, jsonValue } from '../../packages/commerce/configuration-values.mts';

const source = 'packages/adapters/delegated-commands/command-codec.mts';
const cases = 'tests/development/delegated-command-codec.test.mts';
const adapter = (catalog: any) => catalog.adapters.find((value: any) => value.id === 'delegated_use_commands');

test('RCG4BC2-CATALOG-REGISTRATION unchanged C1 codec has four bounded operations and all twenty real cases', () => {
  const catalog = readAdapterCatalog(), checked = validateAdapterCatalog(catalog), value = adapter(catalog);
  assert.equal(checked.adapter_count, 48); assert.equal(checked.operation_count, 227);
  assert.equal(checked.native_case_count, 336); assert.equal(checked.direct_fixture_count, 47);
  assert.equal(value.kind, 'diagnostic');
  assert.deepEqual(value.source_files.map((pin: any) => pin.path), [source]);
  assert.deepEqual(value.operations.map((operation: any) => operation.id), [
    'delegated.command.encode', 'delegated.command.recover', 'delegated.response.bind', 'delegated.receipt.correlate',
  ]);
  const registered = catalogCases({ adapters: [value] });
  const real = [...readFileSync(new URL('./delegated-command-codec.test.mts', import.meta.url), 'utf8').matchAll(/test\('([^']+)'/g)]
    .map(match => match[1].split(' ')[0]).sort();
  assert.equal(real.length, 20); assert.deepEqual(registered.map((ref: any) => ref.id).sort(), real);
  for (const operation of value.operations) {
    assert.equal(operation.semantics, 'native'); assert.equal(operation.qualification, 'sandbox-only');
    assert.equal(operation.scope_kind, 'server_local_fixture_only'); assert.deepEqual(operation.required_scopes, []);
    assert.deepEqual(operation.direct_fixtures, []);
    assert(operation.native_cases.every((ref: any) => ref.path === cases));
  }
});

test('RCG4BC2-CATALOG-PRESERVATION every earlier coverage row retains independently frozen protected bytes', () => {
  const expected = JSON.parse(readFileSync(new URL('../fixtures/conformance/expected-coverage.v1.json', import.meta.url), 'utf8'));
  // ADR-0079: remove only the new internal-client coverage before the original C1 subtraction.
  delete expected.adapter_operations.delegated_use_internal_client;
  delete expected.adapter_contracts.delegated_use_internal_client;
  expected.declarations = expected.declarations.filter((path: string) => path !== 'packages/adapters/delegated-commands/internal-use-client.mts');
  expected.native_cases = expected.native_cases.filter((ref: any) => ref.path !== 'tests/development/delegated-use-client.test.mts');
  delete expected.adapter_operations.delegated_use_commands;
  delete expected.adapter_contracts.delegated_use_commands;
  expected.declarations = expected.declarations.filter((path: string) => path !== source);
  expected.native_cases = expected.native_cases.filter((ref: any) => ref.path !== cases);
  assert.equal(expected.native_cases.length, 308); assert.equal(Object.keys(expected.adapter_operations).length, 46);
  // Independently computed with Python json.dumps(sort_keys=True, separators)
  // and hashlib over protected 031bd32 before any catalog mutation.
  assert.equal(contentDigest(expected), '823c2dc824bcf515a909cb82594dc7dd5099c3ef055a5bdeaa17e6635f7cbfb0');
});

test('RCG4BC2-CATALOG-PINS source and case pins remain actual byte checks', () => {
  const catalog = readAdapterCatalog(), value = adapter(catalog);
  assert.equal(value.source_files[0].sha256, createHash('sha256')
    .update(readFileSync(new URL('../../' + source, import.meta.url))).digest('hex'));
  const changedSource = structuredClone(catalog);
  adapter(changedSource).source_files[0].sha256 = '0'.repeat(64);
  assert.throws(() => validateAdapterCatalog(changedSource), /ADAPTER_CATALOG_PIN_CHANGED/);
  const changedCase = structuredClone(catalog);
  adapter(changedCase).operations[0].native_cases[0].sha256 = '0'.repeat(64);
  assert.throws(() => validateAdapterCatalog(changedCase), /ADAPTER_CATALOG_PIN_CHANGED/);
  for (const path of ['packages/commerce/delegated-command-claim-privacy.mts',
    'packages/commerce/delegated-command-claim-records.mts']) {
    const pin = catalog.oracle_pins.find((value: any) => value.path === path);
    assert(pin, 'New typed lifecycle dependencies must remain catalog inputs: ' + path);
    assert.equal(pin.sha256, createHash('sha256')
      .update(readFileSync(new URL('../../' + path, import.meta.url))).digest('hex'));
    const changedDependency = structuredClone(catalog);
    changedDependency.oracle_pins.find((value: any) => value.path === path).sha256 = '0'.repeat(64);
    assert.throws(() => validateAdapterCatalog(changedDependency), /ADAPTER_CATALOG_PIN_CHANGED/);
  }
});

test('RCG4BC2-CATALOG-LIMITS additive registration preserves byte budget and cannot imply external qualification', () => {
  const catalog = readAdapterCatalog(), checked = validateAdapterCatalog(catalog);
  assert(Buffer.byteLength(JSON.stringify(jsonValue(catalog, 262144))) <= 262144);
  assert.equal(checked.external_qualification, false); assert.equal(checked.production_qualified, false);
  const removed = structuredClone(catalog); removed.adapters = removed.adapters.filter((value: any) => value.id !== 'delegated_use_commands');
  assert.throws(() => validateAdapterCatalog(removed), /ADAPTER_CATALOG_COVERAGE_CHANGED/);
  const claimed = structuredClone(catalog); adapter(claimed).external_scopes_attested = true;
  assert.throws(() => validateAdapterCatalog(claimed), /ADAPTER_CATALOG_EXTERNAL_QUALIFICATION_UNAVAILABLE/);
});
