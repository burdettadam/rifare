import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readAdapterCatalog, validateAdapterCatalog } from '../../packages/conformance/adapter-catalog.mts';
import { contentDigest } from '../../packages/commerce/configuration-values.mts';
import { removeExactPublicAdapter, removeExactPublicCoverage } from './public-catalog-baseline.mts';
import { withoutContinuationCatalog, continuationCases } from './continuation-catalog-baseline.mts';

test('RCG4BC6-CATALOG-REGISTRATION exact public inventory retains all earlier coverage bytes', () => {
  const catalog = readAdapterCatalog();
  removeExactPublicAdapter(catalog);
  withoutContinuationCatalog(catalog);
  const full = validateAdapterCatalog(catalog);
  const result = { ...full, adapter_count: full.adapter_count - 1, operation_count: full.operation_count - 4,
    native_case_count: full.native_case_count - continuationCases };
  assert.equal(result.adapter_count, 49); assert.equal(result.operation_count, 230);
  assert.equal(result.native_case_count, 359); assert.equal(result.direct_fixture_count, 47);
  assert.equal(result.external_qualification, false); assert.equal(result.production_qualified, false);
  const expected = JSON.parse(readFileSync(new URL('../fixtures/conformance/expected-coverage.v1.json', import.meta.url), 'utf8'));
  assert.equal(contentDigest(removeExactPublicCoverage(expected)), '06033d81d78481d8225cf83752cdefec171e77cfeadc6d3d79f4e8e9ef9c75ed');
});

test('RCG4BC6-CATALOG-NEGATIVE public subtraction rejects changed operations cases and external claims', () => {
  const catalog = readAdapterCatalog();
  for (const mutate of [
    (v: any) => { v.operations[0].id = 'delegated.public.other'; },
    (v: any) => { v.operations[1].native_cases.pop(); },
    (v: any) => { v.external_scopes_attested = true; },
    (v: any) => { v.source_files[0].sha256 = '0'.repeat(64); },
  ]) {
    const changed = structuredClone(catalog);
    mutate(changed.adapters.find((v: any) => v.id === 'delegated_use_public_client'));
    assert.throws(() => removeExactPublicAdapter(changed));
  }
});
