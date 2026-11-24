import test from 'node:test';
import assert from 'node:assert/strict';
import { digest, exact, id } from '../../packages/commerce/values.mts';
import { commandCorrelation, CommandClaimDenied } from '../../packages/commerce/command-correlation.mts';
import { claimCorrelation } from './command-fixtures.mts';

test('shared primitives retain SHA256 bytes and strict scalar boundaries', () => {
  assert.equal(digest('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(digest(Buffer.from('abc')), digest('abc'));
  assert.equal(id('A_1-2'), 'A_1-2'); assert.equal(id('x'.repeat(96)).length, 96);
  for (const value of ['', 'x'.repeat(97), '../escape', 'https://provider', 1, null])
    assert.throws(() => id(value), /INVALID_INPUT/);

});

test('shared shape validation retains exact key sets', () => {
  const input = { b: 2, a: 1 }; assert.equal(exact(input, ['a', 'b']), input);
  for (const value of [null, [], { a: 1 }, { a: 1, b: 2, c: 3 }])
    assert.throws(() => exact(value, ['a', 'b']), /INVALID_INPUT/);
});

test('command correlation is detached frozen data and never endpoint authority', () => {
  const original = structuredClone(claimCorrelation); const result = commandCorrelation(original);
  original.actor.id = 'changed'; assert.equal(result.actor.id, claimCorrelation.actor.id);
  assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.actor));
  for (const input of [
    { ...claimCorrelation, provider_ref: 'https://provider.invalid' },
    { ...claimCorrelation, organization_id: '00000000-0000-0000-0000-000000000000' },
    { ...claimCorrelation, organization_id: claimCorrelation.organization_id.toUpperCase() },
    { ...claimCorrelation, actor: { type: 'CUSTOMER', id: 'customer' } },
    { ...claimCorrelation, actor: { ...claimCorrelation.actor, extra: true } },
    { ...claimCorrelation, actor: { ...claimCorrelation.actor, id: 'x'.repeat(257) } },
  ]) assert.throws(() => commandCorrelation(input), error => error instanceof CommandClaimDenied && error.code === 'COMMAND_CLAIM_CONFIG_INVALID');
  let accessed = false;
  const getter = Object.defineProperty({}, 'provider_ref', { enumerable: true, get() { accessed = true; return 'provider'; } });
  assert.throws(() => commandCorrelation(getter), CommandClaimDenied); assert.equal(accessed, false);
});
