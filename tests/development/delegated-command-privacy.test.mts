import test from 'node:test';
import assert from 'node:assert/strict';
import { usingCommandClaim } from './delegated-command-claim-helpers.mts';
import { target, changedMerchant, changedRecovery, snapshot, restoreInput, restored, noRestoreResidue } from './shopper-memory-helpers.mts';
import { PrivacyLifecycle } from '../../packages/commerce/privacy-lifecycle.mts';
import { restoreRecoverySnapshot } from '../../packages/commerce/safe-recovery.mts';
import { exportMerchant, exportMerchantSuppression, importMerchant, merchantSnapshotDigest } from '../../packages/commerce/merchant-portability.mts';
import { CLAIM_KIND, commandClaimRecords } from '../../packages/commerce/delegated-command-claim-records.mts';
import type { CommandClaimBody, CommandClaimRecord } from '../../packages/commerce/delegated-command-claim-records.mts';
import type { CommerceKernel, Row } from '../../packages/commerce/kernel.mts';
import { canonical, contentDigest } from '../../packages/commerce/configuration-values.mts';
import { subjectHash } from '../../packages/commerce/data-guards.mts';

type Fixture = Parameters<Parameters<typeof usingCommandClaim>[0]>[0];
const customer = (f: Fixture) => f.original.customer_id as string;
const privacy = (f: Fixture) => new PrivacyLifecycle(f.kernel);
const prepare = (f: Fixture) => {
  f.claimFinal(); f.observeFinal(); return f.record(f.final.request.command_id);
};
const hold = (f: Fixture, authority_ref = 'command_hold') => privacy(f).hold(f.ownerScope, {
  customer_id: customer(f), reason: 'retention_obligation', authority_ref, expires_at: f.now() + 600000,
});
const transfer = (f: Fixture) => exportMerchant(f.kernel, f.ownerScope, { snapshot_id: 'command_transfer' });
const suppression = (f: Fixture) => {
  const checkpoint = exportMerchantSuppression(f.kernel, f.ownerScope);
  return { suppression: checkpoint, suppression_sha256: merchantSnapshotDigest(checkpoint) };
};
const imported = (f: Fixture, t: ReturnType<typeof target>, value: ReturnType<typeof transfer>) =>
  importMerchant(t.kernel, t.scope, value, value.digest, suppression(f));
const one = (k: CommerceKernel): CommandClaimRecord => {
  const records = commandClaimRecords(k); assert.equal(records.length, 1); return records[0];
};
function replay(k: CommerceKernel, row: Row): void {
  k.db.prepare('UPDATE commerce_support_documents SET body=?,digest=?,state=? WHERE tenant_id=? AND store_id=? AND kind=? AND id=? AND version=1')
    .run(row.body, row.digest, row.state, row.tenant_id, row.store_id, CLAIM_KIND, row.id);
}
function retired(k: CommerceKernel, before: CommandClaimBody, minimized = true): CommandClaimRecord {
  const record = one(k), body = record.body;
  assert.equal(record.row.state, 'revoked'); assert.equal(record.row.version, 1);
  assert.equal(body.retired, true); assert.equal(body.minimized, minimized);
  assert.equal(body.personal === null, minimized); assert.ok(body.revision > before.revision);
  for (const key of ['id', 'tenant_id', 'store_id', 'resource_id', 'subject_ref', 'identity_digest',
    'namespace_digest', 'original_command_id', 'command_kind', 'command_digest', 'challenge_fingerprint',
    'response_digest', 'result_digest', 'created_at', 'observed_at'] as const) assert.equal(body[key], before[key], key);
  assert.equal(record.row.body, canonical(body)); assert.equal(record.row.digest, contentDigest(body));
  return record;
}
function emptyDestination(t: ReturnType<typeof target>): void {
  for (const table of ['commerce_resources', 'commerce_support_documents', 'commerce_recovery_state'])
    assert.equal(Number((t.db.prepare('SELECT count(*) n FROM ' + table).get() as Row).n), 0, table);
}

test('RCG4BC2-PRIVACY-EXPORT original command and first observation export as unverified subject data', () => usingCommandClaim(f => {
  const effects = f.effects(), before = prepare(f);
  const exported = privacy(f).export(f.ownerScope, customer(f));
  const rows = exported.delegated_command_claim_records;
  assert.equal(rows.length, 1); assert.equal(rows[0].id, before.body.id);
  assert.deepEqual(rows[0].personal, before.body.personal);
  assert.equal(rows[0].execution_authorized, false); assert.equal(rows[0].credentials_included, false);
  assert.equal(rows[0].provider_authenticated, false); assert.equal(rows[0].receipt_signature_verified, false);
  assert.equal(rows[0].subject_projection, true); assert.equal(rows[0].retained_under_hold, false);
  assert.equal(JSON.stringify(exported).includes(f.bearer), false);
  assert.throws(() => privacy(f).export(f.b.scope, customer(f)), /ACCESS_DENIED/);
  assert.deepEqual(f.effects(), effects);
}));

test('RCG4BC2-PRIVACY-ERASE removes originals and results while keeping UUID and challenge refusal', () => usingCommandClaim(f => {
  const before = prepare(f).body;
  assert.equal(privacy(f).erase(f.ownerScope, customer(f)).status, 'logically_erased');
  assert.equal(retired(f.kernel, before).body.retirement_reason, 'subject_erased');
  assert.equal((f.db.prepare('SELECT count(*) n FROM commerce_operation_work').get() as Row).n, 0);
}));

test('RCG4BC2-PRIVACY-HELD retained bytes become unusable before the hold is released', () => usingCommandClaim(f => {
  const before = prepare(f).body; hold(f);
  assert.equal(privacy(f).erase(f.ownerScope, customer(f)).status, 'held');
  const after = retired(f.kernel, before, false); assert.deepEqual(after.body.personal, before.personal);
  const view = f.claims.read(f.customer, f.final.request.command_id);
  assert.equal(view.retired, true); assert.equal(JSON.stringify(view).includes('proof_submission_id'), false);
  assert.throws(() => f.claims.recovery(f.customer, f.final.request.command_id), /RETIRED/);
  assert.throws(() => f.observeFinal(), /RETIRED/);
  const exported = privacy(f).export(f.ownerScope, customer(f)).delegated_command_claim_records;
  assert.equal(exported[0].retained_under_hold, true); assert.equal(exported[0].retired, true);
  privacy(f).releaseHold(f.ownerScope, customer(f), 'command_hold');
  assert.equal(privacy(f).erase(f.ownerScope, customer(f)).status, 'logically_erased');
  retired(f.kernel, after.body);
}));

test('RCG4BC2-PRIVACY-DETACHED original subject can export hold and erase without live resources', () => usingCommandClaim(f => {
  const before = prepare(f).body, original = customer(f);
  f.db.prepare("UPDATE commerce_resources SET customer_id='reassigned_customer',external_id='reassigned_'||id WHERE tenant_id=? AND store_id=? AND (customer_id=? OR (kind='customer' AND external_id=?))")
    .run(f.a.tenant, f.a.store, original, original);
  const exported = privacy(f).export(f.ownerScope, original);
  assert.deepEqual(exported.resources, []); assert.equal(exported.delegated_command_claim_records.length, 1);
  assert.equal(exported.delegated_command_claim_records[0].personal?.customer_id, original);
  hold(f); assert.equal(privacy(f).erase(f.ownerScope, original).status, 'held');
  retired(f.kernel, before, false);
  privacy(f).releaseHold(f.ownerScope, original, 'command_hold');
  assert.equal(privacy(f).erase(f.ownerScope, original).status, 'logically_erased');
  assert.equal(one(f.kernel).body.personal, null);
}));

test('RCG4BC2-PRIVACY-REASSIGNED current resource erasure honors its original command subject hold', () => usingCommandClaim(f => {
  const before = prepare(f).body; hold(f);
  f.db.prepare('UPDATE commerce_resources SET customer_id=? WHERE id=?').run('C-1002', f.original.id);
  assert.equal(privacy(f).erase(f.ownerScope, 'C-1002').status, 'held'); retired(f.kernel, before, false);
  privacy(f).releaseHold(f.ownerScope, customer(f), 'command_hold');
  assert.equal(privacy(f).erase(f.ownerScope, 'C-1002').status, 'logically_erased');
  assert.equal(one(f.kernel).body.personal, null);
  assert.equal(f.db.prepare('SELECT 1 FROM commerce_privacy_subjects WHERE tenant_id=? AND store_id=? AND subject_hash=?')
    .get(f.a.tenant, f.a.store, before.subject_ref), undefined);
}));

test('RCG4BC2-PRIVACY-ERASE-REPLAY existing suppression scrubs replayed originals despite obsolete holds', () => usingCommandClaim(f => {
  const before = prepare(f);
  privacy(f).erase(f.ownerScope, customer(f)); replay(f.kernel, before.row);
  assert.equal(privacy(f).erase(f.ownerScope, customer(f)).status, 'already_erased'); retired(f.kernel, before.body);
  replay(f.kernel, before.row); hold(f, 'obsolete_command_hold');
  assert.equal(privacy(f).erase(f.ownerScope, customer(f)).status, 'held'); retired(f.kernel, before.body);
}));

test('RCG4BC2-PRIVACY-UNINSTALL retires commands with and without a retention hold', async () => {
  for (const held of [false, true]) await usingCommandClaim(f => {
    const before = prepare(f).body; if (held) hold(f);
    assert.equal(privacy(f).uninstall(f.ownerScope).status, 'disconnected'); retired(f.kernel, before, !held);
    assert.equal((f.db.prepare('SELECT active FROM commerce_stores WHERE tenant_id=? AND store_id=?').get(f.a.tenant, f.a.store) as Row).active, 0);
  });
});

test('RCG4BC2-PRIVACY-RESTORE restored history is minimized without releasing original fingerprints', () => usingCommandClaim(f => {
  const before = prepare(f).body, saved = snapshot(f, 'command_backup');
  restored(f, saved, ({ kernel, result }) => {
    assert.equal(retired(kernel, before).body.retirement_reason, 'restored');
    assert.equal(result.mode, 'quarantine'); assert.equal(result.external_effects, false);
  }, 'command_restored');
}));

test('RCG4BC2-PRIVACY-RESTORE-HELD unsuppressed held originals prevent installation atomically', () => usingCommandClaim(f => {
  prepare(f); hold(f); const before = f.claimRows(), saved = snapshot(f, 'held_command_backup');
  const input = restoreInput(f, saved, 'held_command_restored');
  assert.throws(() => restoreRecoverySnapshot(input, f.now), /DELEGATED_COMMAND_RESTORE_HELD/);
  noRestoreResidue(f, input); assert.deepEqual(f.claimRows(), before);
}));

test('RCG4BC2-PRIVACY-RESTORE-SUPPRESSION current erasure defeats an older held snapshot', () => usingCommandClaim(f => {
  const before = prepare(f).body; hold(f); const saved = snapshot(f, 'suppressed_command_backup');
  privacy(f).releaseHold(f.ownerScope, customer(f), 'command_hold'); f.advance(1); privacy(f).erase(f.ownerScope, customer(f));
  restored(f, saved, ({ kernel, db }) => {
    retired(kernel, before);
    assert.equal((db.prepare('SELECT released FROM commerce_privacy_holds WHERE authority_ref=?').get('command_hold') as Row).released, 0);
  }, 'suppressed_command_restored');
}));

test('RCG4BC2-PRIVACY-RESTORE-INTEGRITY rehashed incoherent command rows cannot install a database', () => usingCommandClaim(f => {
  prepare(f); const saved = changedRecovery(snapshot(f, 'invalid_command_backup'), db => {
    const row = db.prepare('SELECT * FROM commerce_support_documents WHERE kind=?').get(CLAIM_KIND) as Row;
    const body = { ...JSON.parse(row.body), retired: true };
    db.prepare('UPDATE commerce_support_documents SET body=?,digest=? WHERE kind=?').run(canonical(body), contentDigest(body), CLAIM_KIND);
  });
  const input = restoreInput(f, saved, 'invalid_command_restored');
  assert.throws(() => restoreRecoverySnapshot(input, f.now), /CLAIM_INTEGRITY/); noRestoreResidue(f, input);
}));

test('RCG4BC2-PRIVACY-IMPORT first and repeated imports preserve the same retired tombstone', () => usingCommandClaim(f => {
  const before = prepare(f).body, value = transfer(f), t = target(f);
  try {
    const first = imported(f, t, value); assert.equal((first as Row).mode, 'quarantine');
    const after = retired(t.kernel, before); assert.equal(after.body.retirement_reason, 'restored');
    assert.deepEqual(imported(f, t, value), first); assert.deepEqual(one(t.kernel), after);
    assert.equal((t.db.prepare('SELECT count(*) n FROM commerce_operation_work').get() as Row).n, 0);
  } finally { t.close(); }
}));

test('RCG4BC2-PRIVACY-IMPORT-HELD held transferred bytes leave no partial destination rows', () => usingCommandClaim(f => {
  prepare(f); hold(f); const value = transfer(f), t = target(f);
  try { assert.throws(() => imported(f, t, value), /DELEGATED_COMMAND_RESTORE_HELD/); emptyDestination(t); }
  finally { t.close(); }
}));

test('RCG4BC2-PRIVACY-IMPORT-SUPPRESSION erasure wins over copied holds on first and repeated import', () => usingCommandClaim(f => {
  const before = prepare(f); hold(f); const value = transfer(f), t = target(f);
  try {
    privacy(f).releaseHold(f.ownerScope, customer(f), 'command_hold'); f.advance(1); privacy(f).erase(f.ownerScope, customer(f));
    const first = imported(f, t, value); retired(t.kernel, before.body);
    assert.equal((t.db.prepare('SELECT released FROM commerce_privacy_holds WHERE authority_ref=?').get('command_hold') as Row).released, 0);
    replay(t.kernel, before.row); assert.deepEqual(imported(f, t, value), first); retired(t.kernel, before.body);
    assert.equal((t.db.prepare('SELECT count(*) n FROM commerce_privacy_subjects WHERE subject_hash=?').get(before.body.subject_ref) as Row).n, 1);
  } finally { t.close(); }
}));

test('RCG4BC2-PRIVACY-IMPORT-DESTINATION-HOLD current destination holds are checked independently', () => usingCommandClaim(f => {
  const before = prepare(f), value = transfer(f), t = target(f);
  try {
    imported(f, t, value); replay(t.kernel, before.row);
    const local = new PrivacyLifecycle(t.kernel);
    local.hold(t.scope, { customer_id: customer(f), reason: 'dispute', authority_ref: 'destination_command_hold', expires_at: f.now() + 600000 });
    const rows = t.db.prepare('SELECT * FROM commerce_support_documents ORDER BY kind,id').all();
    const state = t.db.prepare('SELECT * FROM commerce_recovery_state').all();
    assert.throws(() => imported(f, t, value), /DELEGATED_COMMAND_RESTORE_HELD/);
    assert.deepEqual(t.db.prepare('SELECT * FROM commerce_support_documents ORDER BY kind,id').all(), rows);
    assert.deepEqual(t.db.prepare('SELECT * FROM commerce_recovery_state').all(), state);
    local.releaseHold(t.scope, customer(f), 'destination_command_hold'); imported(f, t, value); retired(t.kernel, before.body);
  } finally { t.close(); }
}));

test('RCG4BC2-PRIVACY-IMPORT-DESTINATION-INTEGRITY repeated import cannot normalize a malformed destination', () => usingCommandClaim(f => {
  const before = prepare(f), value = transfer(f), t = target(f);
  try {
    imported(f, t, value); replay(t.kernel, { ...before.row, state: 'revoked' });
    const rows = t.db.prepare('SELECT * FROM commerce_support_documents ORDER BY kind,id').all();
    assert.throws(() => imported(f, t, value), /CLAIM_INTEGRITY/);
    assert.deepEqual(t.db.prepare('SELECT * FROM commerce_support_documents ORDER BY kind,id').all(), rows);
  } finally { t.close(); }
}));

test('RCG4BC2-PRIVACY-IMPORT-SOURCE-INTEGRITY transferred original subject mismatch is rejected before writes', () => usingCommandClaim(f => {
  prepare(f); const value = changedMerchant(transfer(f), copy => {
    const row = copy.rows.commerce_support_documents.find((r: Row) => r.kind === CLAIM_KIND);
    const body = { ...JSON.parse(row.body), subject_ref: subjectHash(f.a.tenant, f.a.store, 'another_customer') };
    row.body = canonical(body); row.digest = contentDigest(body);
  }), t = target(f);
  try { assert.throws(() => imported(f, t, value), /CLAIM_INTEGRITY/); emptyDestination(t); }
  finally { t.close(); }
}));

test('RCG4BC2-PRIVACY-IMPORT-REPLAY repeated transfer re-minimizes a coherent replay without renewal', () => usingCommandClaim(f => {
  const before = prepare(f), value = transfer(f), t = target(f);
  try {
    const first = imported(f, t, value), tombstone = one(t.kernel);
    replay(t.kernel, before.row); assert.deepEqual(imported(f, t, value), first);
    assert.deepEqual(one(t.kernel), tombstone);
  } finally { t.close(); }
}));

test('RCG4BC2-PRIVACY-EXPORT-SUPPRESSION erased bytes cannot escape through an obsolete export hold', () => usingCommandClaim(f => {
  const before = prepare(f); privacy(f).erase(f.ownerScope, customer(f));
  replay(f.kernel, before.row); hold(f, 'obsolete_export_hold');
  const rows = privacy(f).export(f.ownerScope, customer(f)).delegated_command_claim_records;
  assert.equal(rows.length, 1); assert.equal(rows[0].personal, null);
  assert.equal(rows[0].retired, true); assert.equal(rows[0].retained_under_hold, false); retired(f.kernel, before.body);
}));
