import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { usingCommandClaim, claimCorrelation } from './delegated-command-claim-helpers.mts';
import { changedProof } from './delegated-checkout-helpers.mts';
import { verifiedCustomer } from './shopper-memory-helpers.mts';
import { CommerceKernel } from '../../packages/commerce/kernel.mts';
import { DelegatedCommandClaims, CommandClaimDenied } from '../../packages/commerce/delegated-command-claims.mts';
import { CLAIM_KIND, CLAIM_MAX_ROWS, CLAIM_MAX_BODY_BYTES, commandClaimRecords,
  validateCommandClaimRows, retireCommandClaim } from '../../packages/commerce/delegated-command-claim-records.mts';
import { canonical, contentDigest } from '../../packages/commerce/configuration-values.mts';
import { PrivacyLifecycle } from '../../packages/commerce/privacy-lifecycle.mts';
import type { Scope } from '../../packages/commerce/kernel.mts';

type Fixture = Parameters<Parameters<typeof usingCommandClaim>[0]>[0];
const clone = <T>(value: T): T => structuredClone(value);
const otherId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const otherDigest = 'sha256:' + 'a'.repeat(64);
function denied(fn: () => unknown, pattern?: RegExp) {
  assert.throws(fn, (error: any) => {
    assert(error instanceof CommandClaimDenied);
    assert.match(error.message, /^COMMAND_CLAIM_[A-Z_]+$/);
    if (pattern) assert.match(error.message, pattern);
    return true;
  });
}
function rewrite(f: Fixture, change: (body: any) => void) {
  const r = f.record(), body = clone(r.body); change(body);
  f.db.prepare('UPDATE commerce_support_documents SET body=?,digest=? WHERE kind=? AND id=?')
    .run(canonical(body), contentDigest(body), CLAIM_KIND, r.body.id);
}
function finalGuard(f: Fixture, action: () => void): Scope {
  const session = f.kernel.require(f.customer); let calls = 0, fireAt = Infinity;
  const scope = f.kernel.restrictedSession(session.token_hash, session.resource_id, ['resource.read'],
    () => { if (++calls === fireAt) action(); }, {});
  calls = 0; f.claims.read(scope, f.start.request.command_id);
  assert(calls > 1); fireAt = calls; calls = 0; return scope;
}

test('RCG4BC2-CLAIM-ORACLE canonical original intent is committed once and detached', () => usingCommandClaim(f => {
  const input = clone(f.start.request), first = f.claims.claim(f.customer, input);
  input.operation.audience = 'urn:changed:after';
  assert.equal(first.canonical_request, f.start.canonical_json); assert.equal(first.command_digest, f.start.command_digest);
  assert.equal(first.state, 'claimed'); assert.equal(first.revision, 1); assert.equal(first.response, null);
  assert(Object.isFrozen(first)); assert(!Object.isFrozen(input));
  const rows = f.claimRows(); f.advance(5);
  assert.deepEqual(f.claims.claim(f.customer, f.start.request), first); assert.deepEqual(f.claimRows(), rows);
  assert.equal(f.record().body.personal!.canonical_request, f.start.canonical_json);
  assert.equal(f.db.isTransaction, false);
}));

test('RCG4BC2-CLAIM-CONFIG closed bounded correlation cannot invoke accessors or carry authority', () => usingCommandClaim(f => {
  for (const config of [null, {}, { ...claimCorrelation, tenant_id: 'other' },
    { ...claimCorrelation, actor: { type: 'USER', id: 'urn:person' } },
    { ...claimCorrelation, actor: { type: 'MACHINE_IDENTITY', id: 'urn:bad:%20' } },
    { ...claimCorrelation, organization_id: '00000000-0000-0000-0000-000000000000' },
    { ...claimCorrelation, provider_ref: 'a'.repeat(97) }])
    denied(() => new DelegatedCommandClaims(f.kernel, config as any), /CONFIG_INVALID/);
  let calls = 0;
  const config = Object.defineProperty({ ...claimCorrelation }, 'actor', { enumerable: true, get() { calls++; return claimCorrelation.actor; } });
  denied(() => new DelegatedCommandClaims(f.kernel, config)); assert.equal(calls, 0);
  const mutable = clone(claimCorrelation), owner = new DelegatedCommandClaims(f.kernel, mutable);
  mutable.actor.id = 'urn:changed:actor'; assert.deepEqual(owner.claim(f.customer, f.start.request), f.claimStart());
}));

test('RCG4BC2-CLAIM-IDENTITY same UUID cannot replace any valid original mutation', () => usingCommandClaim(f => {
  f.claimStart(); const rows = f.claimRows();
  for (const [section, field, value] of [['grant','id',otherId], ['grant','revision',8], ['grant','terms_digest',otherDigest],
    ['operation','action','urn:changed:action'], ['operation','resource_id','urn:changed:resource'],
    ['operation','audience','urn:changed:audience'], ['operation','request_profile','urn:changed:profile'],
    ['operation','request_digest',otherDigest]] as const) {
    const request = clone(f.start.request); request[section][field] = value;
    denied(() => f.claims.claim(f.customer, request), /CLAIM_CONFLICT/);
  }
  denied(() => f.claims.claim(f.customer, { ...f.final.request, command_id: f.start.request.command_id }), /CLAIM_CONFLICT/);
  const reversed = Object.fromEntries(Object.entries(f.start.request).reverse());
  assert.equal(f.claims.claim(f.customer, new TextEncoder().encode(JSON.stringify(reversed))).command_digest, f.start.command_digest);
  assert.deepEqual(f.claimRows(), rows);
}));

test('RCG4BC2-CLAIM-SCOPE original subject and resource deny claim reuse before digest disclosure', () => usingCommandClaim(f => {
  f.claimStart(); const other = verifiedCustomer(f, f.a, 'ORD-1002');
  const changed = clone(f.start.request); changed.operation.request_digest = otherDigest;
  for (const input of [f.start.request, changed]) denied(() => f.claims.claim(other.scope, input), /NOT_FOUND/);
  for (const scope of [f.a.scope, f.agent.scope, other.scope]) {
    denied(() => f.claims.read(scope, f.start.request.command_id), /NOT_FOUND/);
    denied(() => f.claims.cancel(scope, { command_id: f.start.request.command_id, expected_revision: 1 }), /NOT_FOUND/);
  }
  f.kernel.ingest(f.a.scope, { kind: 'order', source_system: f.original.source_system, external_id: 'ORD-OTHER-CLAIM',
    source_version: 1, source_updated_at: f.now(), customer_id: f.original.customer_id, payload: f.original.payload });
  const sameSubject = verifiedCustomer(f, f.a, 'ORD-OTHER-CLAIM');
  denied(() => f.claims.claim(sameSubject.scope, f.start.request), /NOT_FOUND/);
  assert.equal(f.claimRows().length, 1);
}));

test('RCG4BC2-CLAIM-PROOF-FIRST current native proof and session precede existence and stored parsing', () => usingCommandClaim(f => {
  f.claimStart(); changedProof(f);
  f.db.prepare('UPDATE commerce_support_documents SET digest=? WHERE kind=?').run('f'.repeat(64), CLAIM_KIND);
  const rows = f.claimRows();
  for (const command of [f.start.request.command_id, otherId]) denied(() => f.claims.read(f.customer, command), /ACCESS_DENIED/);
  denied(() => f.claims.claim(f.customer, f.final.request), /ACCESS_DENIED/);
  f.kernel.revoke(f.customer);
  denied(() => f.claims.recovery(f.customer, otherId), /ACCESS_DENIED/); assert.deepEqual(f.claimRows(), rows);
}));

test('RCG4BC2-CLAIM-NAMESPACE complete configured namespace and native tenant-store partition identity', () => usingCommandClaim(f => {
  const original = f.claimStart();
  for (const config of [{ ...claimCorrelation, provider_ref: 'another-provider' },
    { ...claimCorrelation, organization_id: otherId },
    { ...claimCorrelation, actor: { type: 'SERVICE_ACCOUNT' as const, id: claimCorrelation.actor.id } },
    { ...claimCorrelation, actor: { ...claimCorrelation.actor, id: 'urn:another:machine' } }]) {
    const other = new DelegatedCommandClaims(f.kernel, config).claim(f.customer, f.start.request);
    assert.notEqual(other.claim_id, original.claim_id); assert.notEqual(other.namespace_digest, original.namespace_digest);
  }
  for (const store of [f.b, f.c]) {
    const proof = verifiedCustomer(f, store), view = f.claims.claim(proof.scope, f.start.request);
    assert.notEqual(view.claim_id, original.claim_id);
  }
  assert.equal(f.claimRows().length, 7);
  denied(() => f.claims.claim(f.customer, { ...f.start.request, actor: claimCorrelation.actor }), /INPUT_INVALID/);
}));

test('RCG4BC2-CLAIM-OBSERVE first historical result is retained without authority or expiry renewal', () => usingCommandClaim(f => {
  f.claimStart(); f.advance(10); const observed = f.observeStart();
  assert.equal(observed.state, 'observed'); assert.equal(observed.revision, 2);
  assert.equal(observed.observed_at, f.now()); assert.deepEqual(observed.response, f.challengeResponse);
  assert(Object.isFrozen(observed.response)); assert(Object.isFrozen(observed.response!.result));
  const rows = f.claimRows(); f.advance(100);
  assert.deepEqual(f.claims.read(f.customer, f.start.request.command_id), observed); assert.deepEqual(f.claimRows(), rows);
  f.claimFinal(); assert.equal(f.observeFinal().response!.result.kind, 'FINAL_USE');
}));

test('RCG4BC2-CLAIM-RESPONSE-BINDING rejects substituted original grant operation kind and challenge', () => usingCommandClaim(f => {
  f.claimStart(); f.claimFinal(); const rows = f.claimRows();
  for (const change of [(r: any) => { r.original_command_id = otherId; },
    (r: any) => { r.command_digest = otherDigest; }, (r: any) => { r.result.grant.revision++; },
    (r: any) => { r.result.operation.request_digest = otherDigest; }, (r: any) => { r.result = f.finalResponse.result; }]) {
    const response = clone(f.challengeResponse); change(response);
    denied(() => f.claims.observe(f.customer, f.start.request.command_id, response), /BINDING_INVALID/);
  }
  const response = clone(f.finalResponse); response.result.challenge_id = otherId;
  denied(() => f.claims.observe(f.customer, f.final.request.command_id, response), /BINDING_INVALID/);
  denied(() => f.claims.observe(f.customer, otherId, f.finalResponse), /NOT_FOUND/); assert.deepEqual(f.claimRows(), rows);
}));

test('RCG4BC2-CLAIM-HISTORY only recovered may differ and the first stored response never changes', () => usingCommandClaim(f => {
  f.claimFinal(); const first = f.observeFinal(), rows = f.claimRows(); f.advance(10);
  const recovered = { ...f.finalResponse, recovered: true };
  assert.deepEqual(f.claims.observe(f.customer, f.final.request.command_id, recovered,
    { recovery: f.final.recovery_request }), first);
  for (const [key, value] of [['decision','DENY'], ['receipt_ref','urn:changed:receipt'], ['receipt_digest',otherDigest],
    ['recorded_at','2026-01-02T03:04:15.100Z'], ['authorization_expires_at','2026-01-02T03:04:46Z']] as const) {
    const response = clone(recovered); response.result[key] = value;
    denied(() => f.claims.observe(f.customer, f.final.request.command_id, response), /BINDING_INVALID/);
  }
  assert.deepEqual(f.claimRows(), rows);
}));

test('RCG4BC2-CLAIM-RECOVERY retained original produces recovery without making another mutation', () => usingCommandClaim(f => {
  f.claimStart(); const rows = f.claimRows(), recovered = f.claims.recovery(f.customer, f.start.request.command_id);
  assert.deepEqual(recovered.request, f.start.recovery_request); assert.equal(recovered.command_digest, f.start.command_digest);
  assert.equal(recovered.canonical_json, f.start.recovery_canonical_json); assert.equal(recovered.execution_authorized, false);
  denied(() => f.claims.claim(f.customer, f.start.recovery_request), /INPUT_INVALID/);
  denied(() => f.claims.observe(f.customer, f.start.request.command_id, f.challengeResponse,
    { recovery: f.start.recovery_request }), /BINDING_INVALID/);
  denied(() => f.claims.observe(f.customer, f.start.request.command_id, f.challengeResponse,
    { previous: f.challengeResponse } as any), /INPUT_INVALID/);
  assert.deepEqual(f.claimRows(), rows);
}));

test('RCG4BC2-CLAIM-CANCEL revision-bound retirement masks held bytes and never recreates content', async () => {
  for (const held of [false, true]) await usingCommandClaim(f => {
    f.claimFinal(); f.observeFinal();
    if (held) new PrivacyLifecycle(f.kernel).hold(f.ownerScope, { customer_id: f.original.customer_id,
      reason: 'retention_obligation', authority_ref: 'command_hold', expires_at: f.now() + 600000 });
    denied(() => f.claims.cancel(f.customer, { command_id: f.final.request.command_id, expected_revision: 1 }), /REVISION_CONFLICT/);
    const cancelled = f.claims.cancel(f.customer, { command_id: f.final.request.command_id, expected_revision: 2 });
    assert.equal(cancelled.state, 'cancelled'); assert.equal(cancelled.retired, true);
    assert.equal(cancelled.canonical_request, null); assert.equal(cancelled.response, null);
    assert.equal(f.record(f.final.request.command_id).body.personal !== null, held);
    assert.deepEqual(f.claims.claim(f.customer, f.final.request), cancelled);
    assert.deepEqual(f.claims.cancel(f.customer, { command_id: f.final.request.command_id, expected_revision: 3 }), cancelled);
    denied(() => f.observeFinal(), /RETIRED/); denied(() => f.claims.recovery(f.customer, f.final.request.command_id), /RETIRED/);
    const changed = { ...f.final.request, proof_submission_id: otherId };
    denied(() => f.claims.claim(f.customer, changed), /CLAIM_CONFLICT/);
  });
});

test('RCG4BC2-CLAIM-FINAL-CHALLENGE another UUID cannot take the original finalized challenge', () => usingCommandClaim(f => {
  f.claimFinal(); const replacement = { ...f.final.request, command_id: otherId };
  denied(() => f.claims.claim(f.customer, replacement), /CHALLENGE_CONFLICT/);
  f.claims.cancel(f.customer, { command_id: f.final.request.command_id, expected_revision: 1 });
  const owner = new DelegatedCommandClaims(f.kernel, f.correlation);
  denied(() => owner.claim(f.customer, replacement), /CHALLENGE_CONFLICT/); assert.equal(f.claimRows().length, 1);
  assert.equal(new DelegatedCommandClaims(f.kernel, { ...f.correlation, provider_ref: 'other' }).claim(f.customer, replacement).state, 'claimed');
}));

test('RCG4BC2-CLAIM-RESTART a fresh kernel reads and recovers disk history using the existing bearer', () => usingCommandClaim(f => {
  f.claimStart(); const observed = f.observeStart(), rows = f.claimRows();
  const db = new DatabaseSync(f.filename);
  try {
    const kernel = new CommerceKernel(db, f.now), scope = kernel.authenticate(f.bearer);
    const owner = new DelegatedCommandClaims(kernel, f.correlation);
    assert.deepEqual(owner.read(scope, f.start.request.command_id), observed);
    assert.deepEqual(owner.recovery(scope, f.start.request.command_id).request, f.start.recovery_request);
    assert.deepEqual(owner.claim(scope, f.start.request), observed); assert.equal(commandClaimRecords(kernel).length, 1);
    assert.deepEqual(f.claimRows(), rows);
  } finally { db.close(); }
}));

test('RCG4BC2-CLAIM-TRANSACTION mutations refuse caller-owned transactions before database work', () => usingCommandClaim(f => {
  f.claimStart(); const rows = f.claimRows(), sessions = f.db.prepare('SELECT * FROM commerce_sessions').all(); f.advance(10);
  f.kernel.transaction(() => {
    for (const action of [() => f.claimFinal(), () => f.observeStart(), () => f.claims.cancel(f.customer,
      { command_id: f.start.request.command_id, expected_revision: 1 })]) denied(action, /TRANSACTION_OWNERSHIP/);
    assert.deepEqual(f.db.prepare('SELECT * FROM commerce_sessions').all(), sessions);
  });
  assert.deepEqual(f.claimRows(), rows);
  f.db.exec('BEGIN IMMEDIATE');
  try { denied(() => f.claimFinal(), /TRANSACTION_OWNERSHIP/); } finally { f.db.exec('ROLLBACK'); }
}));

test('RCG4BC2-CLAIM-COMMIT failed deferred commit cannot return or retain a claim acknowledgement', () => usingCommandClaim(f => {
  f.db.exec(`CREATE TEMP TABLE claim_parent(id INTEGER PRIMARY KEY);
    CREATE TEMP TABLE claim_commit_failure(id INTEGER REFERENCES claim_parent(id) DEFERRABLE INITIALLY DEFERRED);
    CREATE TEMP TRIGGER claim_commit_fail AFTER INSERT ON main.commerce_support_documents
    WHEN NEW.kind='delegated_command_claim' BEGIN INSERT INTO claim_commit_failure VALUES(1); END;`);
  denied(() => f.claimStart(), /STORAGE_UNAVAILABLE/);
  assert.equal(f.db.isTransaction, false); assert.equal(f.claimRows().length, 0);
  f.db.exec('DROP TRIGGER claim_commit_fail'); assert.equal(f.claimStart().revision, 1);
}));

test('RCG4BC2-CLAIM-ACCESS-FENCE native access and restored-store boundaries survive the final callback', async () => {
  await usingCommandClaim(f => {
    f.claimStart(); const rows = f.claimRows(), session = f.kernel.require(f.customer);
    f.db.exec(`CREATE TEMP TRIGGER command_revoke_after_write AFTER UPDATE ON main.commerce_support_documents
      WHEN NEW.kind='delegated_command_claim' BEGIN UPDATE commerce_sessions SET revoked=1; END;`);
    denied(() => f.observeStart(), /ACCESS_DENIED/); assert.deepEqual(f.claimRows(), rows);
    assert.equal(f.db.prepare('SELECT revoked FROM commerce_sessions WHERE token_hash=?').get(session.token_hash)!.revoked, 0);
  });
  const quarantine = (f: Fixture, mode = 'quarantine') => f.db.prepare('INSERT INTO commerce_recovery_state VALUES(1,?,?,?,?,?)')
    .run('command-restore', mode, 'a'.repeat(64), 'b'.repeat(64), f.now());
  for (const mode of ['quarantine', 'diagnostic_only']) await usingCommandClaim(f => {
    const first = f.claimStart(), rows = f.claimRows(); quarantine(f, mode);
    denied(() => f.claimFinal(), /ACCESS_DENIED/); denied(() => f.observeStart(), /ACCESS_DENIED/);
    denied(() => f.claims.recovery(f.customer, f.start.request.command_id), /ACCESS_DENIED/);
    assert.deepEqual(f.claimRows(), rows); assert.deepEqual(f.claims.read(f.customer, f.start.request.command_id), first);
    assert.equal(f.claims.cancel(f.customer, { command_id: f.start.request.command_id, expected_revision: 1 }).state, 'cancelled');
  });
  for (const method of ['claim','observe','recovery']) await usingCommandClaim(f => {
    f.claimStart(); const rows = f.claimRows(); let fired = false;
    const scope = finalGuard(f, () => { fired = true; quarantine(f); });
    denied(() => method === 'claim' ? f.claims.claim(scope, f.final.request)
      : method === 'observe' ? f.claims.observe(scope, f.start.request.command_id, f.challengeResponse)
        : f.claims.recovery(scope, f.start.request.command_id), /ACCESS_DENIED/);
    assert(fired); assert.deepEqual(f.claimRows(), rows);
    assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_recovery_state').get()!.n, 0,
      'A recovery fence added during this transaction also rolls back with the failed method');
  });
});

test('RCG4BC2-CLAIM-REENTRANT-FENCE last authorization callback cannot replace or delete the selected record', async () => {
  for (const flaw of ['replace','delete']) await usingCommandClaim(f => {
    f.claimStart(); const rows = f.claimRows(); let fired = false;
    const scope = finalGuard(f, () => {
      fired = true;
      if (flaw === 'delete') f.db.prepare('DELETE FROM commerce_support_documents WHERE kind=?').run(CLAIM_KIND);
      else rewrite(f, b => { b.updated_at++; });
    });
    denied(() => f.claims.read(scope, f.start.request.command_id), /REVISION_CONFLICT|INTEGRITY/);
    assert(fired); assert.deepEqual(f.claimRows(), rows);
  });
});

test('RCG4BC2-CLAIM-CLOCK persisted mutation time survives a new owner and does not renew history', () => usingCommandClaim(f => {
  f.claimStart(); f.advance(20); const observed = f.observeStart(), rows = f.claimRows(); f.advance(-10);
  const owner = new DelegatedCommandClaims(f.kernel, f.correlation);
  assert.deepEqual(owner.read(f.customer, f.start.request.command_id), observed);
  denied(() => owner.claim(f.customer, f.final.request), /CLOCK_INVALID/);
  denied(() => owner.cancel(f.customer, { command_id: f.start.request.command_id, expected_revision: 2 }), /CLOCK_INVALID/);
  assert.deepEqual(f.claimRows(), rows);
}));

test('RCG4BC2-CLAIM-INTEGRITY exact source rows full identities bounds and minimized digests remain checked', async () => {
  for (const flaw of ['identity','namespace','request','response','original_id','shape']) await usingCommandClaim(f => {
    f.claimStart(); f.observeStart();
    rewrite(f, b => {
      if (flaw === 'identity') b.identity_digest = b.identity_digest.slice(0, 40) + 'a'.repeat(24);
      if (flaw === 'namespace') b.personal.correlation.provider_ref = 'different';
      if (flaw === 'request') b.personal.canonical_request = b.personal.canonical_request.replace('synthetic-42', 'synthetic-43');
      if (flaw === 'response') b.result_digest = 'a'.repeat(64);
      if (flaw === 'original_id') b.original_command_id = otherId;
      if (flaw === 'shape') b.foreign = true;
    });
    denied(() => f.claims.read(f.customer, f.start.request.command_id), /INTEGRITY/);
  });
  await usingCommandClaim(f => {
    f.claimStart(); const row = f.claimRows()[0];
    denied(() => validateCommandClaimRows(f.kernel, Array(CLAIM_MAX_ROWS + 1).fill(row)), /ROW_LIMIT/);
    denied(() => validateCommandClaimRows(f.kernel, [{ ...row, body: ' '.repeat(CLAIM_MAX_BODY_BYTES + 1) }]), /INTEGRITY/);
    f.kernel.transaction(() => retireCommandClaim(f.kernel, f.record(), 'restored', true));
    denied(() => f.claims.claim(f.customer, { ...f.start.request, grant: { ...f.start.request.grant, revision: 8 } }), /CLAIM_CONFLICT/);
  });
});

test('RCG4BC2-CLAIM-NO-AUTHORITY local protocol retention creates no business or native verification effects', () => usingCommandClaim(f => {
  const effects = f.effects(), beforeFetch = globalThis.fetch; let fetches = 0;
  globalThis.fetch = (() => { fetches++; throw new Error('unexpected provider'); }) as any;
  try {
    f.claimFinal(); const view = f.observeFinal(), recovery = f.claims.recovery(f.customer, f.final.request.command_id);
    for (const result of [view, recovery]) {
      assert.equal(result.execution_authorized, false); assert.equal(result.provider_authenticated, false);
      assert.equal(result.receipt_signature_verified, false); assert.equal(result.observation_origin, 'local_unverified_input');
      assert.equal(result.qualification, 'candidate_contract_only'); assert(!Object.hasOwn(result, 'may_send'));
    }
    assert.equal(fetches, 0); assert.equal(f.db.prepare("SELECT count(*) n FROM commerce_support_documents WHERE kind='delegated_checkout_intent'").get()!.n, 0);
    assert(!JSON.stringify(f.claimRows()).includes(f.bearer)); assert.deepEqual(f.effects(), effects);
  } finally { globalThis.fetch = beforeFetch; }
}));
