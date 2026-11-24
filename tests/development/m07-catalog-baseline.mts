import assert from 'node:assert/strict';
import { catalogCases, validateAdapterCatalog } from '../../packages/conformance/adapter-catalog.mts';

// These profiles were added after protected M07 checkpoint 0eec01456. Validate
// the complete catalog first, then subtract only this closed additive set before
// checking the retained 38/199/262/47 scope.
export const postM07AdapterIds = Object.freeze([
  'loyalty_balance_source',
  'loyalty_accrual_source',
  'loyalty_redemption_source',
  'loyalty_incentive_source',
  'dropoff_fixture_source',
  'dropoff_credential_source',
  'dropoff_handoff_source',
  'delegated_receipt_signatures',
  'delegated_use_commands',
  'delegated_use_internal_client',
  'delegated_use_public_client',
  'delegated_use_public_continuation',
]);

export function retainedM07Catalog(catalog: any) {
  const full = validateAdapterCatalog(catalog);
  assert.deepEqual(
    { adapters: full.adapter_count, operations: full.operation_count, cases: full.native_case_count, fixtures: full.direct_fixture_count },
    { adapters: 50, operations: 234, cases: 383, fixtures: 47 },
  );
  for (const id of postM07AdapterIds) assert.equal(catalog.adapters.filter((entry: any) => entry.id === id).length, 1);
  const retained = { ...catalog, adapters: catalog.adapters.filter((entry: any) => !postM07AdapterIds.includes(entry.id)) };
  const cases = catalogCases(retained);
  const counts = {
    adapters: retained.adapters.length,
    operations: retained.adapters.reduce((total: number, adapter: any) => total + adapter.operations.length, 0),
    cases: cases.length,
    fixtures: retained.adapters.reduce((total: number, adapter: any) => total
      + adapter.operations.reduce((sum: number, operation: any) => sum + operation.direct_fixtures.length, 0), 0),
  };
  assert.deepEqual(counts, { adapters: 38, operations: 199, cases: 262, fixtures: 47 });
  return { catalog: retained, cases, counts };
}
