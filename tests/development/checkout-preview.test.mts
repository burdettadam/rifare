import test from 'node:test';
import assert from 'node:assert/strict';
import { checkoutSnapshot, withinDelegatedCeiling } from '../../packages/commerce/checkout-preview.mts';
import { previewFixture } from './checkout-preview-helpers.mts';

test('checkout snapshot is detached and deeply frozen', () => {
  const input = previewFixture(), snapshot = checkoutSnapshot(input);
  (input.items[0] as any).product_id = 'changed';
  assert.equal(snapshot.items[0].product_id, 'desk_lamp');
  assert.ok(Object.isFrozen(snapshot)); assert.ok(Object.isFrozen(snapshot.items)); assert.ok(Object.isFrozen(snapshot.items[0]));
});

test('RCG2-COMPOSER-SPARSE-ARRAY-EXTRA-NUMERIC-KEY',()=>{
  const value=new Array(1);(value as any)['4294967295']='discarded';
  assert.throws(()=>checkoutSnapshot(value),/CHECKOUT_DATA_INVALID/);
});

test('snapshot rejects accessors and custom array traversal without invoking them', () => {
  let calls = 0;
  const input = Object.defineProperty({}, 'value', { enumerable: true, get() { calls++; return 1; } });
  const array = [1]; Object.defineProperty(array, 'map', { value: () => { calls++; return []; }, enumerable: true });
  for (const value of [input, array]) assert.throws(() => checkoutSnapshot(value), /CHECKOUT_DATA_INVALID/);
  assert.equal(calls, 0);
});

test('snapshot rejects symbols, nonenumerable fields, cycles and non-JSON values', () => {
  const hidden = Object.defineProperty({}, 'hidden', { value: 1 });
  const symbolic = { [Symbol('hidden')]: 1 }; const cycle: any = {}; cycle.self = cycle;
  for (const value of [hidden, symbolic, cycle, new Date(), { amount: 1n }]) assert.throws(() => checkoutSnapshot(value));
});

test('snapshot retains the depth, node and byte limits', () => {
  let depth: any = 0;
  for (let i = 0; i < 16; i++) depth = [depth];
  assert.deepEqual(checkoutSnapshot(depth), depth);
  assert.throws(() => checkoutSnapshot([depth]), /CHECKOUT_DATA_INVALID/);
  assert.equal(checkoutSnapshot(new Array(32767).fill(0)).length, 32767);
  assert.throws(() => checkoutSnapshot(new Array(32768).fill(0)), /CHECKOUT_DATA_INVALID/);
  assert.equal(checkoutSnapshot('x'.repeat(131070)).length, 131070);
  assert.throws(() => checkoutSnapshot('x'.repeat(131071)), /CONFIGURATION_INVALID/);
});

test('ceiling accepts equality and exact bounded minor units without granting permission', () => {
  const preview = previewFixture();
  assert.equal(withinDelegatedCeiling(preview, 'USD', '6800'), true);
  assert.equal(withinDelegatedCeiling(preview, 'USD', '6799'), false);
  const maximum = '999999999999999999999999';
  assert.equal(withinDelegatedCeiling({ ...preview, total_payable_minor: maximum }, 'USD', maximum), true);
  assert.equal(withinDelegatedCeiling({ ...preview, total_payable_minor: '0' }, 'USD', '0'), true);
});

test('ceiling rejects malformed money, overflow and currency mismatch', () => {
  const preview = previewFixture();
  for (const amount of ['01', '-1', '1.0', '1e3', '1000000000000000000000000', 6800]) {
    assert.throws(() => withinDelegatedCeiling(preview, 'USD', amount as string), /CHECKOUT_SOURCE_INVALID|CHECKOUT_AMOUNT_OUT_OF_RANGE/);
    assert.throws(() => withinDelegatedCeiling({ ...preview, total_payable_minor: amount as string }, 'USD', '8000'), /CHECKOUT_SOURCE_INVALID|CHECKOUT_AMOUNT_OUT_OF_RANGE/);
  }
  for (const currency of ['usd', 'CAD', '', 'US']) assert.throws(() => withinDelegatedCeiling(preview, currency, '8000'), /CHECKOUT_CURRENCY_MISMATCH/);
});
