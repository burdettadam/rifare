import test from 'node:test';
import assert from 'node:assert/strict';
import { usingNativeStart } from './delegated-checkout-start-helpers.mts';
import { changedPrice, changedProof, changedTerms } from './delegated-checkout-helpers.mts';
import { verifiedCustomer } from './shopper-memory-helpers.mts';
import { CommandClaimDenied } from '../../packages/commerce/delegated-command-claims.mts';
import { CLAIM_KIND } from '../../packages/commerce/delegated-command-claim-records.mts';

type Fixture = Parameters<Parameters<typeof usingNativeStart>[0]>[0];
const otherId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
function denied(action: () => unknown, code?: RegExp) {
  assert.throws(action, (error: any) => {
    assert(error instanceof CommandClaimDenied);
    assert.match(error.message, /^COMMAND_CLAIM_[A-Z_]+$/);
    if (code) assert.match(error.message, code);
    return true;
  });
}
const fresh = (f: Fixture, input = f.startRequest) => f.nativeClaims.claimNewCheckoutStart(f.customer, input);
const current = (f: Fixture, input = f.startRequest) => f.nativeClaims.currentCheckoutStart(f.customer, input);
function observation(first: ReturnType<typeof fresh>) {
  const original = JSON.parse(first.canonical_request!);
  return { profile: 'urn:marty:delegation-command-response:v1',
    original_command_id: original.command_id, command_digest: first.command_digest, recovered: false,
    result: { kind: 'CHALLENGE', challenge_id: otherId, grant: original.grant, operation: original.operation,
      created_at: '2026-11-20T12:00:00Z', expires_at: '2026-11-20T12:01:00Z' } };
}

test('RCG4BC5-ADMIT-ONCE a committed original consumes fresh admission while old exact-repeat behavior is preserved', () => usingNativeStart(f => {
  const effects = f.effects(), first = fresh(f), rows = f.claimRows();
  assert.equal(f.db.isTransaction, false); assert.equal(rows.length, 1);
  assert.equal(first.original_command_id, f.startRequest.command_id);
  assert.equal(first.state, 'claimed'); assert.equal(first.revision, 1); assert.equal(first.response, null);
  assert.equal(first.provider_authenticated, false); assert.equal(first.receipt_signature_verified, false);
  assert.equal(first.execution_authorized, false); assert.equal(first.observation_origin, 'local_unverified_input');
  denied(() => fresh(f)); assert.deepEqual(f.claimRows(), rows);
  assert.deepEqual(current(f), first);
  assert.deepEqual(f.nativeClaims.claimCheckoutStart(f.customer, f.startRequest), first);
  assert.deepEqual(f.claims.read(f.customer, f.startRequest.command_id), first);
  assert.deepEqual(f.effects(), effects);
}));

test('RCG4BC5-ADMIT-HISTORY preclaimed observed and cancelled originals never become fresh again', async () => {
  for (const state of ['preclaimed', 'observed', 'cancelled']) await usingNativeStart(f => {
    const first = f.claimNative();
    if (state === 'observed') f.nativeClaims.observe(f.customer, first.original_command_id, observation(first));
    if (state === 'cancelled') f.nativeClaims.cancel(f.customer, { command_id: first.original_command_id, expected_revision: 1 });
    const rows = f.claimRows(), historical = f.claims.read(f.customer, first.original_command_id);
    denied(() => fresh(f)); assert.deepEqual(f.claimRows(), rows);
    assert.deepEqual(f.claims.read(f.customer, first.original_command_id), historical);
    assert.equal(f.claimRows().length, 1);
  });
});

test('RCG4BC5-ADMIT-INPUT native admission and retained checks reject caller authority and do not invoke getters', () => usingNativeStart(f => {
  let getters = 0;
  const accessor = Object.defineProperty({ preview_id: f.preview.preview_id }, 'command_id',
    { enumerable: true, get() { getters++; return f.startRequest.command_id; } });
  const badInputs = [null, {}, [], accessor, { ...f.startRequest, may_send: true },
    { ...f.startRequest, command_id: otherId.toUpperCase() }, { ...f.startRequest, preview_id: 'absent-preview' }];
  for (const input of badInputs) {
    denied(() => f.nativeClaims.claimNewCheckoutStart(f.customer, input as any));
    denied(() => f.nativeClaims.currentCheckoutStart(f.customer, input as any));
  }
  assert.equal(getters, 0); assert.equal(f.claimRows().length, 0);
  const first = fresh(f), rows = f.claimRows();
  const other = verifiedCustomer(f, f.a, 'ORD-1002');
  for (const scope of [f.a.scope, other.scope, verifiedCustomer(f, f.b).scope, {}]) {
    denied(() => f.nativeClaims.claimNewCheckoutStart(scope, f.startRequest));
    denied(() => f.nativeClaims.currentCheckoutStart(scope, f.startRequest));
  }
  assert.deepEqual(f.claimRows(), rows);
  assert.deepEqual(f.claims.read(f.customer, first.original_command_id), first);
}));

test('RCG4BC5-ADMIT-ABSENCE retained checks cannot create or recreate an absent original under the same clock', () => usingNativeStart(f => {
  const now = f.now(), effects = f.effects();
  denied(() => current(f)); assert.equal(f.claimRows().length, 0);
  const first = fresh(f); assert.equal(f.now(), now);
  f.db.prepare('DELETE FROM commerce_support_documents WHERE kind=?').run(CLAIM_KIND);
  assert.equal(f.claimRows().length, 0);
  denied(() => current(f)); assert.equal(f.claimRows().length, 0); assert.equal(f.now(), now);
  denied(() => f.claims.read(f.customer, first.original_command_id));
  assert.deepEqual(f.effects(), effects);
}));

test('RCG4BC5-ADMIT-CURRENT retained original checks require the complete current purchase and native access', async () => {
  const changes = [changedPrice, changedTerms, changedProof,
    (f: Fixture) => f.starts.close(), (f: Fixture) => f.previews.close(),
    (f: Fixture) => f.db.prepare('INSERT INTO commerce_recovery_state VALUES(1,?,?,?,?,?)')
      .run('c5-quarantine', 'quarantine', 'a'.repeat(64), 'b'.repeat(64), f.now())];
  for (const change of changes) await usingNativeStart(f => {
    const first = fresh(f), rows = f.claimRows(); change(f);
    denied(() => current(f)); denied(() => fresh(f)); assert.deepEqual(f.claimRows(), rows);
    assert.equal(first.revision, 1); assert.equal(first.response, null);
  });
  await usingNativeStart(async f => {
    fresh(f); const rows = f.claimRows(), next = await f.previews.prepare(f.customer, f.request);
    assert.notEqual(next.preview_digest, f.preview.preview_digest);
    denied(() => current(f, { ...f.startRequest, preview_id: next.preview_id }));
    assert.deepEqual(f.claimRows(), rows);
  });
});

test('RCG4BC5-ADMIT-FENCE top-level commit ownership and the final existing-row fence survive native callbacks', () => usingNativeStart(f => {
  f.db.exec('BEGIN');
  try {
    denied(() => fresh(f), /TRANSACTION_OWNERSHIP/);
    denied(() => current(f), /TRANSACTION_OWNERSHIP/);
    assert.equal(f.claimRows().length, 0);
  } finally { f.db.exec('ROLLBACK'); }
  const first = fresh(f), rows = f.claimRows(); let fired = false;
  f.afterQuoteReads(3, () => {
    assert.equal(f.claimRows().length, 1, 'The original still exists during final native revalidation');
    fired = true; f.db.prepare('DELETE FROM commerce_support_documents WHERE kind=?').run(CLAIM_KIND);
  });
  denied(() => current(f));
  assert.equal(fired, true); assert.deepEqual(f.claimRows(), rows);
  assert.deepEqual(f.claims.read(f.customer, first.original_command_id), first);
}));
