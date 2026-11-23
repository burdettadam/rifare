import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readAdapterCatalog, validateAdapterCatalog } from '../../packages/conformance/adapter-catalog.mts';
import { assertPreviousCatalog, withoutContinuationCatalog, withoutContinuationCoverage } from './continuation-catalog-baseline.mts';

test('CONT-CATALOG-ADDITIVE exact new profile preserves the complete prior C6 catalog and coverage', () => {
  const catalog = readAdapterCatalog(), expected = JSON.parse(readFileSync(new URL('../fixtures/conformance/expected-coverage.v1.json', import.meta.url), 'utf8'));
  const result = validateAdapterCatalog(catalog);
  assert.equal(result.adapter_count, 50); assert.equal(result.operation_count, 234); assert.equal(result.native_case_count, 383); assert.equal(result.direct_fixture_count, 47);
  assert.equal(result.external_qualification, false); assert.equal(result.production_qualified, false);
  assertPreviousCatalog(catalog, expected);
});
test('CONT-CATALOG-NEGATIVE subtraction refuses changed claims source cases and prior metadata', () => {
  for (const mutate of [(entry: any) => { entry.external_scopes_attested = true; }, (entry: any) => { entry.operations[0].native_cases.pop(); },
    (entry: any) => { entry.operations[1].id = 'other'; }, (entry: any) => { entry.source_files[0].sha256 = '0'.repeat(64); }]) {
    const changed = readAdapterCatalog(); mutate(changed.adapters.find((entry: any) => entry.id === 'delegated_use_public_continuation'));
    assert.throws(() => withoutContinuationCatalog(changed));
  }
  const expected = JSON.parse(readFileSync(new URL('../fixtures/conformance/expected-coverage.v1.json', import.meta.url), 'utf8'));
  const changed = structuredClone(expected); changed.adapter_contracts.delegated_use_public_continuation.api_version = 'other';
  assert.throws(() => withoutContinuationCoverage(changed));
  const previousChanged = readAdapterCatalog(); previousChanged.adapters[0].operations[0].semantics = 'unsupported';
  assert.throws(() => assertPreviousCatalog(previousChanged, expected));
});
