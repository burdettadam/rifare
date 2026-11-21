import test from 'node:test';
import assert from 'node:assert/strict';
import { usingNativeStart } from './delegated-checkout-start-helpers.mts';
import { target, snapshot, restored } from './shopper-memory-helpers.mts';
import { PrivacyLifecycle } from '../../packages/commerce/privacy-lifecycle.mts';
import { exportMerchant, exportMerchantSuppression, importMerchant, merchantSnapshotDigest } from '../../packages/commerce/merchant-portability.mts';
import { commandClaimRecords } from '../../packages/commerce/delegated-command-claim-records.mts';
import { DelegatedCheckoutStarts } from '../../packages/commerce/delegated-checkout-starts.mts';
import { DelegatedCommandClaims } from '../../packages/commerce/delegated-command-claims.mts';
import type { CommerceKernel, Row } from '../../packages/commerce/kernel.mts';

type Fixture = Parameters<Parameters<typeof usingNativeStart>[0]>[0];
const anotherId = '1e821868-4c31-4a81-8a21-bade3be0663e';
const subject = (f: Fixture) => f.original.customer_id as string;
const one = (kernel: CommerceKernel) => {
  const records = commandClaimRecords(kernel);
  assert.equal(records.length, 1);
  return records[0];
};
const assertNoWork = (f: Fixture) => {
  assert.equal((f.db.prepare('SELECT count(*) n FROM commerce_operation_work').get() as Row).n, 0);
};

test('RCG4BC3-LIFE-EXPORT native originals use unchanged typed personal export without live binding provenance', () => usingNativeStart(f => {
  const effects = f.effects(), view = f.claimNative(), record = one(f.kernel);
  const exported = new PrivacyLifecycle(f.kernel).export(f.ownerScope, subject(f)).delegated_command_claim_records;
  assert.equal(record.row.version, 1); assert.equal(record.body.schema_version, 1);
  assert.equal(exported.length, 1); assert.deepEqual(exported[0].personal, record.body.personal);
  assert.equal(exported[0].execution_authorized, false); assert.equal(exported[0].provider_authenticated, false);
  assert.equal(exported[0].receipt_signature_verified, false); assert.equal(exported[0].credentials_included, false);
  const original = JSON.parse(exported[0].personal!.canonical_request);
  assert.equal(original.command, 'START_USE'); assert.equal(original.command_id, f.startRequest.command_id);
  assert.deepEqual(original.grant, f.grant);
  assert.equal(original.operation.request_digest, 'sha256:' + f.preview.preview_digest);
  assert.equal(record.body.command_digest, view.command_digest);
  assert.equal(JSON.stringify(exported).includes(f.bearer), false);
  assert.equal(Object.hasOwn(record.body, 'native_binding'), false);
  assert.equal(Object.hasOwn(record.body.personal!, 'preview'), false);
  assert.deepEqual(f.effects(), effects); assertNoWork(f);
}));

test('RCG4BC3-LIFE-CANCEL native repeats cannot repopulate a minimized original or release its UUID', () => usingNativeStart(f => {
  const effects = f.effects(), original = f.claimNative();
  const cancelled = f.nativeClaims.cancel(f.customer, {
    command_id: f.startRequest.command_id, expected_revision: original.revision,
  });
  assert.equal(cancelled.retired, true); assert.equal(cancelled.minimized, true);
  assert.equal(cancelled.canonical_request, null);
  const rows = f.claimRows();
  assert.deepEqual(f.claimNative(), cancelled);
  assert.deepEqual(f.claimRows(), rows);
  assert.equal(one(f.kernel).body.original_command_id, f.startRequest.command_id);
  assert.throws(() => f.nativeClaims.recovery(f.customer, f.startRequest.command_id), /RETIRED/);
  const replacement = new DelegatedCheckoutStarts(f.kernel, f.previews, {
    grant: { ...f.grant, revision: f.grant.revision + 1 },
  });
  try {
    const changed = new DelegatedCommandClaims(f.kernel, f.correlation, replacement);
    assert.throws(() => changed.claimCheckoutStart(f.customer, f.startRequest), /CONFLICT/);
  } finally { replacement.close(); }
  assert.deepEqual(f.claimRows(), rows); assert.deepEqual(f.effects(), effects); assertNoWork(f);
}));

test('RCG4BC3-LIFE-ERASE erasure retires the native original and revokes a previously captured live binding', () => usingNativeStart(f => {
  f.claimNative();
  const live = f.starts.prepare(f.customer, f.startRequest), before = one(f.kernel).body;
  assert.equal(new PrivacyLifecycle(f.kernel).erase(f.ownerScope, subject(f)).status, 'logically_erased');
  const after = one(f.kernel).body;
  assert.equal(after.retired, true); assert.equal(after.minimized, true); assert.equal(after.personal, null);
  assert.equal(after.original_command_id, before.original_command_id);
  assert.equal(after.command_digest, before.command_digest); assert.equal(after.identity_digest, before.identity_digest);
  assert.throws(() => f.starts.assertCurrent(f.customer, live));
  assert.throws(() => f.nativeClaims.claimCheckoutStart(f.customer, { ...f.startRequest, command_id: anotherId }));
  assert.equal(commandClaimRecords(f.kernel).length, 1); assertNoWork(f);
}));

test('RCG4BC3-LIFE-HOLD held erased originals remain exportable history without preserving native use', () => usingNativeStart(f => {
  f.claimNative();
  const live = f.starts.prepare(f.customer, f.startRequest), before = one(f.kernel).body;
  const privacy = new PrivacyLifecycle(f.kernel);
  privacy.hold(f.ownerScope, { customer_id: subject(f), reason: 'retention_obligation',
    authority_ref: 'native_start_hold', expires_at: f.now() + 600000 });
  f.starts.assertCurrent(f.customer, live);
  let erased: string | undefined;
  f.afterQuoteReads(2, () => { erased = privacy.erase(f.ownerScope, subject(f)).status; });
  assert.throws(() => f.starts.assertCurrent(f.customer, live));
  assert.equal(erased, 'held', 'The actual erasure occurs during the native quote read');
  const held = one(f.kernel).body;
  assert.equal(held.retired, true); assert.equal(held.minimized, false); assert.deepEqual(held.personal, before.personal);
  const view = f.nativeClaims.read(f.customer, f.startRequest.command_id);
  assert.equal(view.canonical_request, null); assert.equal(view.retired, true);
  assert.throws(() => f.starts.assertCurrent(f.customer, live));
  assert.throws(() => f.nativeClaims.claimCheckoutStart(f.customer, { ...f.startRequest, command_id: anotherId }));
  const exported = privacy.export(f.ownerScope, subject(f)).delegated_command_claim_records;
  assert.equal(exported[0].retained_under_hold, true); assert.deepEqual(exported[0].personal, before.personal);
  privacy.releaseHold(f.ownerScope, subject(f), 'native_start_hold');
  assert.throws(() => f.starts.assertCurrent(f.customer, live), 'Releasing retention does not withdraw the erasure request');
  assert.throws(() => f.nativeClaims.claimCheckoutStart(f.customer, { ...f.startRequest, command_id: anotherId }));
  assert.equal(privacy.erase(f.ownerScope, subject(f)).status, 'logically_erased');
  assert.equal(one(f.kernel).body.personal, null); assertNoWork(f);
}));

test('RCG4BC3-LIFE-UNINSTALL disconnection retires native claims and invalidates captured use', () => usingNativeStart(f => {
  f.claimNative();
  const live = f.starts.prepare(f.customer, f.startRequest), before = one(f.kernel).body;
  assert.equal(new PrivacyLifecycle(f.kernel).uninstall(f.ownerScope).status, 'disconnected');
  const after = one(f.kernel).body;
  assert.equal(after.retired, true); assert.equal(after.minimized, true); assert.equal(after.personal, null);
  assert.equal(after.identity_digest, before.identity_digest); assert.equal(after.command_digest, before.command_digest);
  assert.throws(() => f.starts.assertCurrent(f.customer, live));
  assert.throws(() => f.claimNative()); assertNoWork(f);
}));

test('RCG4BC3-LIFE-RESTORE native originals restore as the unchanged retired tombstone in quarantine', () => usingNativeStart(f => {
  f.claimNative();
  const before = one(f.kernel).body, saved = snapshot(f, 'native_start_backup');
  restored(f, saved, ({ kernel, result }) => {
    const after = one(kernel).body;
    assert.equal(after.retired, true); assert.equal(after.minimized, true); assert.equal(after.personal, null);
    assert.equal(after.retirement_reason, 'restored'); assert.equal(after.schema_version, 1);
    assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
    for (const key of ['id', 'identity_digest', 'namespace_digest', 'original_command_id', 'command_digest', 'resource_id', 'subject_ref'] as const)
      assert.equal(after[key], before[key]);
    assert.equal(result.mode, 'quarantine'); assert.equal(result.external_effects, false);
    assert.throws(() => new DelegatedCheckoutStarts(kernel, f.previews, { grant: f.grant }));
  }, 'native_start_restored');
}));

test('RCG4BC3-LIFE-IMPORT first and repeated merchant imports keep one retired native original', () => usingNativeStart(f => {
  f.claimNative();
  const before = one(f.kernel).body;
  const transfer = exportMerchant(f.kernel, f.ownerScope, { snapshot_id: 'native_start_transfer' });
  const suppression = exportMerchantSuppression(f.kernel, f.ownerScope);
  const t = target(f);
  try {
    const input = { suppression, suppression_sha256: merchantSnapshotDigest(suppression) };
    const first = importMerchant(t.kernel, t.scope, transfer, transfer.digest, input);
    const after = one(t.kernel);
    assert.equal((first as Row).mode, 'quarantine'); assert.equal(after.body.retired, true);
    assert.equal(after.body.minimized, true); assert.equal(after.body.personal, null);
    assert.equal(after.body.identity_digest, before.identity_digest);
    assert.equal(after.body.command_digest, before.command_digest);
    assert.deepEqual(importMerchant(t.kernel, t.scope, transfer, transfer.digest, input), first);
    assert.deepEqual(one(t.kernel), after);
    assert.equal((t.db.prepare('SELECT count(*) n FROM commerce_operation_work').get() as Row).n, 0);
  } finally { t.close(); }
}));

test('RCG4BC3-LIFE-HISTORY losing native preview ownership leaves only the original unverified journal history', () => usingNativeStart(f => {
  const effects = f.effects(), original = f.claimNative(), rows = f.claimRows();
  const live = f.starts.prepare(f.customer, f.startRequest);
  f.previews.close();
  assert.throws(() => f.starts.assertCurrent(f.customer, live));
  assert.throws(() => f.claimNative());
  assert.deepEqual(f.nativeClaims.read(f.customer, f.startRequest.command_id), original);
  const recovery = f.nativeClaims.recovery(f.customer, f.startRequest.command_id);
  assert.equal(recovery.request.command, 'RECOVER_RESULT');
  if (recovery.request.command !== 'RECOVER_RESULT') assert.fail('Expected original recovery');
  assert.equal(recovery.request.original_command_id, original.original_command_id);
  assert.equal(recovery.request.expected_command_digest, original.command_digest);
  assert.equal(recovery.provider_authenticated, false); assert.equal(recovery.execution_authorized, false);
  const replacement = new DelegatedCheckoutStarts(f.kernel, f.newOwner(), { grant: f.grant });
  try {
    const next = new DelegatedCommandClaims(f.kernel, f.correlation, replacement);
    assert.throws(() => next.claimCheckoutStart(f.customer, f.startRequest));
    assert.throws(() => replacement.assertCurrent(f.customer, live));
  } finally { replacement.close(); }
  assert.deepEqual(f.claimRows(), rows); assert.deepEqual(f.effects(), effects); assertNoWork(f);
}));
