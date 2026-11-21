import test from 'node:test';
import assert from 'node:assert/strict';
import { usingIntent } from './delegated-intent-helpers.mts';
import { target, changedMerchant, changedRecovery, snapshot, restoreInput, restored, noRestoreResidue } from './shopper-memory-helpers.mts';
import { PrivacyLifecycle } from '../../packages/commerce/privacy-lifecycle.mts';
import { restoreRecoverySnapshot } from '../../packages/commerce/safe-recovery.mts';
import { exportMerchant, exportMerchantSuppression, importMerchant, merchantSnapshotDigest } from '../../packages/commerce/merchant-portability.mts';
import { INTENT_KIND, intentRecords } from '../../packages/commerce/delegated-checkout-intent-records.mts';
import type { IntentBody, IntentRecord } from '../../packages/commerce/delegated-checkout-intent-records.mts';
import type { CommerceKernel, Row } from '../../packages/commerce/kernel.mts';
import { canonical, contentDigest } from '../../packages/commerce/configuration-values.mts';
import { subjectHash } from '../../packages/commerce/data-guards.mts';

type Fixture = Parameters<Parameters<typeof usingIntent>[0]>[0];
const customer = (f: Fixture) => f.original.customer_id as string;
const privacy = (f: Fixture) => new PrivacyLifecycle(f.kernel);
const hold = (f: Fixture, name = 'intent_hold') => privacy(f).hold(f.ownerScope, {
  customer_id: customer(f), reason: 'retention_obligation', authority_ref: name, expires_at: f.now() + 600000,
});
const transfer = (f: Fixture) => exportMerchant(f.kernel, f.ownerScope, { snapshot_id: 'delegated_intent_transfer' });
const suppression = (f: Fixture) => {
  const checkpoint = exportMerchantSuppression(f.kernel, f.ownerScope);
  return { suppression: checkpoint, suppression_sha256: merchantSnapshotDigest(checkpoint) };
};
const imported = (f: Fixture, t: ReturnType<typeof target>, value: ReturnType<typeof transfer>) =>
  importMerchant(t.kernel, t.scope, value, value.digest, suppression(f));
const one = (k: CommerceKernel): IntentRecord => {
  const records = intentRecords(k); assert.equal(records.length, 1); return records[0];
};
function restoreRow(k: CommerceKernel, row: Row): void {
  k.db.prepare('UPDATE commerce_support_documents SET body=?,digest=?,state=? WHERE tenant_id=? AND store_id=? AND kind=? AND id=? AND version=1')
    .run(row.body, row.digest, row.state, row.tenant_id, row.store_id, INTENT_KIND, row.id);
}
function assertRetired(k: CommerceKernel, before: IntentBody, minimized = true): IntentRecord {
  const record = one(k), b = record.body;
  assert.equal(record.row.state, 'revoked'); assert.equal(record.row.version, 1);
  assert.equal(b.authority_revoked, true); assert.equal(b.minimized, minimized);
  assert.equal(b.personal === null, minimized); assert.ok(b.revision > before.revision);
  for (const key of ['id', 'tenant_id', 'store_id', 'resource_id', 'subject_ref', 'identity_digest',
    'binding_digest', 'authority_namespace', 'challenge_fingerprint', 'receipt_fingerprint',
    'token_digest', 'receipt_expires_at', 'created_at', 'expires_at'] as const) assert.equal(b[key], before[key], key);
  assert.equal(record.row.body, canonical(b)); assert.equal(record.row.digest, contentDigest(b));
  return record;
}
function assertEmptyDestination(t: ReturnType<typeof target>): void {
  for (const table of ['commerce_resources', 'commerce_support_documents', 'commerce_recovery_state']) {
    assert.equal(Number((t.db.prepare('SELECT count(*) n FROM ' + table).get() as Row).n), 0, table);
  }
}

test('RCG4-PRIVACY-EXPORT signed receipt data remains subject-scoped and non-executing', () => usingIntent(async f => {
  const effects = f.effects(); await f.capture();
  const exported = privacy(f).export(f.ownerScope, customer(f));
  const rows = exported.delegated_checkout_intent_records;
  assert.equal(rows.length, 1); assert.equal(rows[0].id, f.intent.intent_id);
  assert.deepEqual(rows[0].personal, f.record().body.personal);
  assert.equal(rows[0].execution_authorized, false); assert.equal(rows[0].credentials_included, false);
  assert.equal(rows[0].subject_projection, true); assert.equal(rows[0].retained_under_hold, false);
  assert.equal(JSON.stringify(exported).includes(f.token), false);
  assert.throws(() => privacy(f).export(f.b.scope, customer(f)), /ACCESS_DENIED/);
  assert.deepEqual(f.effects(), effects);
}));

test('RCG4-PRIVACY-ERASE minimizes personal evidence and preserves all duplicate claims', () => usingIntent(async f => {
  await f.capture(); const before = f.record().body;
  assert.equal(privacy(f).erase(f.ownerScope, customer(f)).status, 'logically_erased');
  const after = assertRetired(f.kernel, before);
  assert.equal(after.body.revocation_reason, 'subject_erased');
  assert.equal((f.db.prepare('SELECT count(*) n FROM commerce_operations').get() as Row).n, 0);
}));

test('RCG4-PRIVACY-HELD erasure revokes use before retaining held personal data', () => usingIntent(async f => {
  await f.capture(); const before = f.record().body; hold(f);
  assert.equal(privacy(f).erase(f.ownerScope, customer(f)).status, 'held');
  const after = assertRetired(f.kernel, before, false);
  assert.deepEqual(after.body.personal, before.personal);
  const exported = privacy(f).export(f.ownerScope, customer(f)).delegated_checkout_intent_records;
  assert.equal(exported[0].retained_under_hold, true); assert.equal(exported[0].authority_revoked, true);
  privacy(f).releaseHold(f.ownerScope, customer(f), 'intent_hold');
  assert.equal(privacy(f).erase(f.ownerScope, customer(f)).status, 'logically_erased');
  assertRetired(f.kernel, after.body);
}));

test('RCG4-PRIVACY-ZERO-RESOURCES original subject can export hold and erase detached intent', () => usingIntent(async f => {
  await f.capture(); const before = f.record().body, originalCustomer = customer(f);
  f.db.prepare("UPDATE commerce_resources SET customer_id='reassigned_customer',external_id='reassigned_'||id WHERE tenant_id=? AND store_id=? AND (customer_id=? OR (kind='customer' AND external_id=?))")
    .run(f.a.tenant, f.a.store, originalCustomer, originalCustomer);
  const exported = privacy(f).export(f.ownerScope, originalCustomer);
  assert.deepEqual(exported.resources, []); assert.equal(exported.delegated_checkout_intent_records.length, 1);
  assert.equal(exported.delegated_checkout_intent_records[0].personal?.customer_id, originalCustomer);
  hold(f); assert.equal(privacy(f).erase(f.ownerScope, originalCustomer).status, 'held');
  assertRetired(f.kernel, before, false);
  privacy(f).releaseHold(f.ownerScope, originalCustomer, 'intent_hold');
  assert.equal(privacy(f).erase(f.ownerScope, originalCustomer).status, 'logically_erased');
  assert.equal(one(f.kernel).body.personal, null);
}));

test('RCG4-PRIVACY-REASSIGNED-HOLD current resource erasure respects the original intent subject hold', () => usingIntent(async f => {
  await f.capture(); const before = f.record().body; hold(f);
  f.db.prepare('UPDATE commerce_resources SET customer_id=? WHERE id=?').run('C-1002', f.original.id);
  assert.equal(privacy(f).erase(f.ownerScope, 'C-1002').status, 'held');
  assertRetired(f.kernel, before, false);
  privacy(f).releaseHold(f.ownerScope, customer(f), 'intent_hold');
  assert.equal(privacy(f).erase(f.ownerScope, 'C-1002').status, 'logically_erased');
  assert.equal(one(f.kernel).body.personal, null);
  assert.equal(f.db.prepare('SELECT 1 FROM commerce_privacy_subjects WHERE tenant_id=? AND store_id=? AND subject_hash=?')
    .get(f.a.tenant, f.a.store, before.subject_ref), undefined);
}));

test('RCG4-PRIVACY-ALREADY-ERASED scrubs a replayed personal row and obsolete hold', () => usingIntent(async f => {
  await f.capture(); const before = f.record();
  privacy(f).erase(f.ownerScope, customer(f)); restoreRow(f.kernel, before.row);
  assert.equal(privacy(f).erase(f.ownerScope, customer(f)).status, 'already_erased');
  assertRetired(f.kernel, before.body);
  restoreRow(f.kernel, before.row); hold(f, 'obsolete_hold');
  assert.equal(privacy(f).erase(f.ownerScope, customer(f)).status, 'held');
  assertRetired(f.kernel, before.body);
}));

test('RCG4-PRIVACY-UNINSTALL revokes detached intents and honors retention without preserving use', async () => {
  for (const retained of [false, true]) await usingIntent(async f => {
    await f.capture(); const before = f.record().body;
    if (retained) hold(f);
    assert.equal(privacy(f).uninstall(f.ownerScope).status, 'disconnected');
    assertRetired(f.kernel, before, !retained);
    assert.equal((f.db.prepare('SELECT active FROM commerce_stores WHERE tenant_id=? AND store_id=?').get(f.a.tenant, f.a.store) as Row).active, 0);
  });
});

test('RCG4-PRIVACY-RESTORE invalidates durable evidence while retaining duplicate-refusal identity', () => usingIntent(async f => {
  await f.capture(); const before = f.record().body, saved = snapshot(f, 'intent_backup');
  restored(f, saved, ({ kernel, result }) => {
    const record = assertRetired(kernel, before);
    assert.equal(record.body.revocation_reason, 'restored'); assert.equal(result.mode, 'quarantine');
    assert.equal(result.external_effects, false);
  }, 'intent_restored');
}));

test('RCG4-PRIVACY-RESTORE-HELD rejects an unsuppressed held history atomically', () => usingIntent(async f => {
  await f.capture(); hold(f); const before = f.intentRows(), saved = snapshot(f, 'held_intent_backup');
  const input = restoreInput(f, saved, 'held_intent_restored');
  assert.throws(() => restoreRecoverySnapshot(input, f.now), /DELEGATED_INTENT_RESTORE_HELD/);
  noRestoreResidue(f, input); assert.deepEqual(f.intentRows(), before);
}));

test('RCG4-PRIVACY-RESTORE-SUPPRESSION current erasure wins over an old held snapshot', () => usingIntent(async f => {
  await f.capture(); const before = f.record().body; hold(f);
  const saved = snapshot(f, 'suppressed_intent_backup');
  privacy(f).releaseHold(f.ownerScope, customer(f), 'intent_hold'); f.advance(1);
  privacy(f).erase(f.ownerScope, customer(f));
  restored(f, saved, ({ kernel, db }) => {
    assertRetired(kernel, before);
    assert.equal((db.prepare('SELECT released FROM commerce_privacy_holds WHERE authority_ref=?').get('intent_hold') as Row).released, 0);
  }, 'suppressed_intent_restored');
}));

test('RCG4-PRIVACY-RESTORE-INTEGRITY rejects a rehashed malformed intent without installing a database', () => usingIntent(async f => {
  await f.capture(); const saved = changedRecovery(snapshot(f, 'bad_intent_backup'), db => {
    const row = db.prepare('SELECT * FROM commerce_support_documents WHERE kind=?').get(INTENT_KIND) as Row;
    const body = { ...JSON.parse(row.body), authority_revoked: true };
    db.prepare('UPDATE commerce_support_documents SET body=?,digest=? WHERE kind=?').run(canonical(body), contentDigest(body), INTENT_KIND);
  });
  const input = restoreInput(f, saved, 'bad_intent_restored');
  assert.throws(() => restoreRecoverySnapshot(input, f.now), /INTENT_INTEGRITY/); noRestoreResidue(f, input);
}));

test('RCG4-PRIVACY-IMPORT normalizes the generic row pause and keeps repeated import idempotent', () => usingIntent(async f => {
  await f.capture(); const before = f.record().body, value = transfer(f), t = target(f);
  try {
    const first = imported(f, t, value); assert.equal((first as Row).mode, 'quarantine');
    const record = assertRetired(t.kernel, before); assert.equal(record.body.revocation_reason, 'restored');
    assert.deepEqual(imported(f, t, value), first); assert.deepEqual(one(t.kernel), record);
    assert.equal((t.db.prepare('SELECT count(*) n FROM commerce_operations').get() as Row).n, 0);
  } finally { t.close(); }
}));

test('RCG4-PRIVACY-IMPORT-HELD rejects held transferred personal bytes with no partial rows', () => usingIntent(async f => {
  await f.capture(); hold(f); const value = transfer(f), t = target(f);
  try { assert.throws(() => imported(f, t, value), /DELEGATED_INTENT_RESTORE_HELD/); assertEmptyDestination(t); }
  finally { t.close(); }
}));

test('RCG4-PRIVACY-IMPORT-SUPPRESSION current checkpoint defeats copied holds on first and repeated imports', () => usingIntent(async f => {
  await f.capture(); const before = f.record(); hold(f);
  const value = transfer(f), t = target(f);
  try {
    privacy(f).releaseHold(f.ownerScope, customer(f), 'intent_hold'); f.advance(1); privacy(f).erase(f.ownerScope, customer(f));
    const first = imported(f, t, value); assertRetired(t.kernel, before.body);
    assert.equal((t.db.prepare('SELECT released FROM commerce_privacy_holds WHERE authority_ref=?').get('intent_hold') as Row).released, 0);
    restoreRow(t.kernel, before.row);
    assert.deepEqual(imported(f, t, value), first); assertRetired(t.kernel, before.body);
    assert.equal((t.db.prepare('SELECT count(*) n FROM commerce_privacy_subjects WHERE subject_hash=?').get(before.body.subject_ref) as Row).n, 1);
  } finally { t.close(); }
}));

test('RCG4-PRIVACY-IMPORT-REPEAT-HELD preflights current destination holds and rolls back', () => usingIntent(async f => {
  await f.capture(); const before = f.record(), value = transfer(f), t = target(f);
  try {
    imported(f, t, value); restoreRow(t.kernel, before.row);
    const local = new PrivacyLifecycle(t.kernel);
    local.hold(t.scope, { customer_id: customer(f), reason: 'dispute', authority_ref: 'destination_intent_hold', expires_at: f.now() + 600000 });
    const rows = t.db.prepare('SELECT * FROM commerce_support_documents ORDER BY kind,id').all();
    const state = t.db.prepare('SELECT * FROM commerce_recovery_state').all();
    assert.throws(() => imported(f, t, value), /DELEGATED_INTENT_RESTORE_HELD/);
    assert.deepEqual(t.db.prepare('SELECT * FROM commerce_support_documents ORDER BY kind,id').all(), rows);
    assert.deepEqual(t.db.prepare('SELECT * FROM commerce_recovery_state').all(), state);
    local.releaseHold(t.scope, customer(f), 'destination_intent_hold'); imported(f, t, value); assertRetired(t.kernel, before.body);
  } finally { t.close(); }
}));

test('RCG4-PRIVACY-IMPORT-DESTINATION-INTEGRITY cannot normalize an incoherent repeated-import destination', () => usingIntent(async f => {
  await f.capture(); const before = f.record(), value = transfer(f), t = target(f);
  try {
    imported(f, t, value); restoreRow(t.kernel, { ...before.row, state: 'revoked' });
    const rows = t.db.prepare('SELECT * FROM commerce_support_documents ORDER BY kind,id').all();
    assert.throws(() => imported(f, t, value), /INTENT_INTEGRITY/);
    assert.deepEqual(t.db.prepare('SELECT * FROM commerce_support_documents ORDER BY kind,id').all(), rows);
  } finally { t.close(); }
}));

test('RCG4-PRIVACY-IMPORT-SOURCE-INTEGRITY validates original rows before any mutation', () => usingIntent(async f => {
  await f.capture(); const value = changedMerchant(transfer(f), copy => {
    const row = copy.rows.commerce_support_documents.find((r: Row) => r.kind === INTENT_KIND);
    const body = { ...JSON.parse(row.body), subject_ref: subjectHash(f.a.tenant, f.a.store, 'another_customer') };
    row.body = canonical(body); row.digest = contentDigest(body);
  }), t = target(f);
  try { assert.throws(() => imported(f, t, value), /INTENT_INTEGRITY/); assertEmptyDestination(t); }
  finally { t.close(); }
}));

test('RCG4-PRIVACY-IMPORT-REPLAYED-PERSONAL re-minimizes coherent personal history without renewing claims', () => usingIntent(async f => {
  await f.capture(); const before = f.record(), value = transfer(f), t = target(f);
  try {
    const first = imported(f, t, value); const retired = one(t.kernel);
    restoreRow(t.kernel, before.row);
    assert.deepEqual(imported(f, t, value), first);
    assert.deepEqual(one(t.kernel), retired);
  } finally { t.close(); }
}));


test('RCG4-PRIVACY-EXPORT-SUPPRESSION never exports replayed erased personal data under an obsolete hold', () => usingIntent(async f => {
  await f.capture(); const before = f.record();
  privacy(f).erase(f.ownerScope, customer(f)); restoreRow(f.kernel, before.row); hold(f, 'obsolete_export_hold');
  const exported = privacy(f).export(f.ownerScope, customer(f)).delegated_checkout_intent_records;
  assert.equal(exported.length, 1); assert.equal(exported[0].personal, null);
  assert.equal(exported[0].authority_revoked, true); assert.equal(exported[0].retained_under_hold, false);
  assertRetired(f.kernel, before.body);
}));
