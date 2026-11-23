import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { usingNativeStart } from './delegated-checkout-start-helpers.mts';
import { changedPrice, changedProof, changedTerms } from './delegated-checkout-helpers.mts';
import { verifiedCustomer } from './shopper-memory-helpers.mts';
import { CommerceKernel } from '../../packages/commerce/kernel.mts';
import { CheckoutPreviews } from '../../packages/commerce/checkout-previews.mts';
import { ShoppingCart } from '../../packages/commerce/shopping-cart.mts';
import { DelegatedCheckoutStarts, DelegatedCheckoutStartDenied } from '../../packages/commerce/delegated-checkout-starts.mts';
import { DelegatedCommandClaims, CommandClaimDenied } from '../../packages/commerce/delegated-command-claims.mts';
import { CLAIM_KIND, retireCommandClaim } from '../../packages/commerce/delegated-command-claim-records.mts';

type Fixture = Parameters<Parameters<typeof usingNativeStart>[0]>[0];
const clone = <T>(value: T): T => structuredClone(value);
const otherId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
function denied(fn: () => unknown, pattern?: RegExp) {
  assert.throws(fn, (error: any) => {
    assert(error instanceof DelegatedCheckoutStartDenied || error instanceof CommandClaimDenied);
    assert.match(error.message, /^(?:CHECKOUT_START|COMMAND_CLAIM)_[A-Z_]+$/);
    if (pattern) assert.match(error.message, pattern); return true;
  });
}
function expectedRequest(f: Fixture) {
  // Explicit wire order is the independent canonical expectation. No production
  // serializer or START constructor supplies the expected mapping or hash.
  return { command: 'START_USE', command_id: f.startRequest.command_id,
    grant: { id: f.grant.id, revision: f.grant.revision, terms_digest: f.grant.terms_digest },
    operation: { action: 'urn:rifare:action:purchase:v1', audience: 'urn:rifare:store:' + f.preview.store_id,
      request_digest: 'sha256:' + f.preview.preview_digest, request_profile: 'urn:rifare:checkout-preview:v1',
      resource_id: 'urn:rifare:resource:' + f.preview.resource_id }, profile: 'urn:marty:delegation-command:v1' };
}
function afterInsertScope(f: Fixture, action: () => void) {
  const session = f.kernel.require(f.customer); let fired = false;
  const scope = f.kernel.restrictedSession(session.token_hash, session.resource_id, ['resource.read'], () => {
    if (!fired && f.claimRows().length > 0) { fired = true; action(); }
  }, {});
  return { scope, fired: () => fired };
}
function quarantine(f: Fixture) {
  f.db.prepare('INSERT INTO commerce_recovery_state VALUES(1,?,?,?,?,?)')
    .run('native-start-restore', 'quarantine', 'a'.repeat(64), 'b'.repeat(64), f.now());
}

test('RCG4BC3-START-MAPPING exact native purchase facts determine canonical START and full digest', () => usingNativeStart(f => {
  const before = f.effects(), binding = f.starts.prepare(f.customer, f.startRequest);
  const request = expectedRequest(f), expected = JSON.stringify(request);
  assert.deepEqual(binding.encoded.request, request);
  assert.equal(binding.encoded.canonical_json, expected);
  assert.equal(binding.encoded.command_digest, 'sha256:' + createHash('sha256').update(expected).digest('hex'));
  assert.equal(binding.preview_id, f.preview.preview_id); assert.equal(binding.preview_digest, f.preview.preview_digest);
  assert.equal(f.preview.total_payable_minor, '6800');
  assert.equal(binding.encoded.execution_authorized, false);
  assert.equal(binding.encoded.qualification, 'candidate_contract_only');
  for (const value of [binding, binding.encoded, binding.encoded.request, binding.encoded.request.grant,
    binding.encoded.request.operation]) assert(Object.isFrozen(value));
  assert.equal(f.starts.assertCurrent(f.customer, binding), undefined);
  assert.equal(f.claimRows().length, 0); assert.deepEqual(f.effects(), before);
}));

test('RCG4BC3-START-CONFIG closed original grant configuration rejects invalid data without invoking accessors', () => usingNativeStart(f => {
  for (const config of [null, {}, { grant: f.grant, operation: {} }, { grant: { ...f.grant, extra: true } },
    { grant: { ...f.grant, id: '00000000-0000-0000-0000-000000000000' } },
    { grant: { ...f.grant, revision: 0 } }, { grant: { ...f.grant, terms_digest: 'sha256:' + 'A'.repeat(64) } }])
    denied(() => new DelegatedCheckoutStarts(f.kernel, f.previews, config as any), /CONFIG_INVALID/);
  let calls = 0;
  const getter = Object.defineProperty({}, 'grant', { enumerable: true, get() { calls++; return f.grant; } });
  const nested = Object.defineProperty(clone(f.grant), 'id', { enumerable: true, get() { calls++; return f.grant.id; } });
  for (const config of [getter, { grant: nested }]) denied(() => new DelegatedCheckoutStarts(f.kernel, f.previews, config as any), /CONFIG_INVALID/);
  assert.equal(calls, 0); assert.equal(f.claimRows().length, 0);
}));

test('RCG4BC3-START-DETACHED original grant and request aliases cannot change an established binding', () => usingNativeStart(f => {
  const config = { grant: clone(f.grant) }, original = clone(config);
  const starts = new DelegatedCheckoutStarts(f.kernel, f.previews, config);
  config.grant.revision++; config.grant.terms_digest = 'sha256:' + 'a'.repeat(64);
  const input = clone(f.startRequest), binding = starts.prepare(f.customer, input);
  input.command_id = otherId; input.preview_id = 'foreign-preview';
  assert.deepEqual(binding.encoded.request.grant, original.grant);
  assert.equal(binding.encoded.original_command_id, f.startRequest.command_id);
  assert.equal(binding.preview_id, f.preview.preview_id); assert(!Object.isFrozen(config.grant));
  assert.equal(starts.assertCurrent(f.customer, binding), undefined); starts.close();
}));

test('RCG4BC3-START-OWNERS concrete private brands exclude forged foreign and overridden providers', () => usingNativeStart(async f => {
  const fake = { boundTo: () => true, current: () => f.preview };
  for (const previews of [fake, Object.create(CheckoutPreviews.prototype), new Proxy(f.previews, {})])
    denied(() => new DelegatedCheckoutStarts(f.kernel, previews as any, { grant: f.grant }), /CONFIG_INVALID/);
  const db = new DatabaseSync(f.filename);
  try {
    const foreign = new CommerceKernel(db, f.now);
    denied(() => new DelegatedCheckoutStarts(foreign, f.previews, { grant: f.grant }), /CONFIG_INVALID/);
    denied(() => new DelegatedCommandClaims(foreign, f.correlation, f.starts), /CONFIG_INVALID/);
  } finally { db.close(); }
  for (const starts of [fake, Object.create(DelegatedCheckoutStarts.prototype), new Proxy(f.starts, {})])
    denied(() => new DelegatedCommandClaims(f.kernel, f.correlation, starts as any), /CONFIG_INVALID/);
  let calls = 0;
  const previews = f.newOwner(), preview = await previews.prepare(f.customer, f.request);
  Object.defineProperties(previews, {
    current: { get() { calls++; return () => f.preview; } },
    boundTo: { get() { calls++; return () => true; } },
  });
  const starts = new DelegatedCheckoutStarts(f.kernel, previews, { grant: f.grant });
  Object.defineProperties(starts, {
    prepare: { get() { calls++; throw new Error('must not invoke'); } },
    assertCurrent: { get() { calls++; throw new Error('must not invoke'); } },
    boundTo: { get() { calls++; return () => true; } },
  });
  const claims = new DelegatedCommandClaims(f.kernel, f.correlation, starts);
  assert.equal(claims.claimCheckoutStart(f.customer, { ...f.startRequest, preview_id: preview.preview_id }).state, 'claimed');
  assert.equal(calls, 0); starts.close();
}));

test('RCG4BC3-START-PROVENANCE copied foreign and other-scope bindings cannot assert current purchase facts', () => usingNativeStart(f => {
  const binding = f.starts.prepare(f.customer, f.startRequest);
  const other = new DelegatedCheckoutStarts(f.kernel, f.previews, { grant: f.grant });
  const freshScope = f.kernel.authenticate(f.bearer);
  for (const copied of [clone(binding), { ...binding }, null, {}])
    denied(() => f.starts.assertCurrent(f.customer, copied as any), /PROVENANCE_INVALID/);
  denied(() => other.assertCurrent(f.customer, binding), /PROVENANCE_INVALID/);
  denied(() => f.starts.assertCurrent(freshScope, binding), /PROVENANCE_INVALID/);
  assert.equal(f.starts.assertCurrent(f.customer, binding), undefined); other.close();
}));

test('RCG4BC3-START-INPUT only original command and owner preview IDs are accepted', () => usingNativeStart(f => {
  const before = f.effects(); let calls = 0;
  const getter = Object.defineProperty({ preview_id: f.preview.preview_id }, 'command_id',
    { enumerable: true, get() { calls++; return f.startRequest.command_id; } });
  for (const input of [null, [], {}, { ...f.startRequest, command_id: otherId.toUpperCase() },
    { ...f.startRequest, command_id: '00000000-0000-0000-0000-000000000000' },
    { ...f.startRequest, preview_id: {} }, { ...f.startRequest, preview: f.preview },
    { ...f.startRequest, operation: expectedRequest(f).operation }, { ...f.startRequest, execution_authorized: true }, getter]) {
    denied(() => f.starts.prepare(f.customer, input as any));
    denied(() => f.nativeClaims.claimCheckoutStart(f.customer, input as any));
  }
  assert.equal(calls, 0); assert.equal(f.claimRows().length, 0); assert.deepEqual(f.effects(), before);
  denied(() => f.claims.claimCheckoutStart(f.customer, f.startRequest), /CONFIG_INVALID/);
}));

test('RCG4BC3-START-CLAIM native construction retains the existing historical view and exact-repeat row', () => usingNativeStart(f => {
  const before = f.effects(), first = f.claimNative(), rows = f.claimRows();
  assert.equal(first.canonical_request, JSON.stringify(expectedRequest(f)));
  assert.equal(first.state, 'claimed'); assert.equal(first.revision, 1); assert.equal(first.response, null);
  assert.equal(first.execution_authorized, false); assert.equal(first.provider_authenticated, false);
  assert.equal(first.receipt_signature_verified, false); assert.equal(first.observation_origin, 'local_unverified_input');
  assert.equal(first.evidence_status, 'historical_unverified_observation'); assert.equal(first.qualification, 'candidate_contract_only');
  assert(Object.isFrozen(first)); assert.equal(f.db.isTransaction, false);
  assert.deepEqual(Object.keys(f.record().body.personal!).sort(), ['canonical_request','correlation','customer_id','first_response']);
  f.advance(1); assert.deepEqual(f.claimNative(), first); assert.deepEqual(f.claimRows(), rows);
  assert.deepEqual(f.claims.read(f.customer, f.startRequest.command_id), first); assert.deepEqual(f.effects(), before);
}));

test('RCG4BC3-START-CONFLICT same original ID cannot switch a valid native preview or grant', () => usingNativeStart(async f => {
  f.claimNative(); const rows = f.claimRows(), next = await f.previews.prepare(f.customer, f.request);
  assert.notEqual(next.preview_digest, f.preview.preview_digest);
  denied(() => f.nativeClaims.claimCheckoutStart(f.customer, { ...f.startRequest, preview_id: next.preview_id }), /CLAIM_CONFLICT/);
  const starts = new DelegatedCheckoutStarts(f.kernel, f.previews, { grant: { ...f.grant, revision: f.grant.revision + 1 } });
  const claims = new DelegatedCommandClaims(f.kernel, f.correlation, starts);
  denied(() => claims.claimCheckoutStart(f.customer, f.startRequest), /CLAIM_CONFLICT/);
  assert.deepEqual(f.claimRows(), rows); starts.close();
}));

test('RCG4BC3-START-RAW-CONVERGENCE an identical earlier raw claim still requires current native checks', () => usingNativeStart(f => {
  const earlier = f.claims.claim(f.customer, expectedRequest(f)), rows = f.claimRows();
  assert.deepEqual(f.claimNative(), earlier); assert.deepEqual(f.claimRows(), rows);
  changedTerms(f); denied(() => f.claimNative(), /BINDING_INVALID/);
  assert.deepEqual(f.claimRows(), rows); assert.deepEqual(f.claims.read(f.customer, f.startRequest.command_id), earlier);
}));

test('RCG4BC3-START-SCOPE current customer proof and original order isolate construction and claims', () => usingNativeStart(f => {
  f.claimNative(); const rows = f.claimRows(), other = verifiedCustomer(f, f.a, 'ORD-1002');
  const foreign = verifiedCustomer(f, f.b), otherTenant = verifiedCustomer(f, f.c);
  for (const scope of [f.a.scope, f.agent.scope, other.scope, foreign.scope, otherTenant.scope, {}]) {
    denied(() => f.starts.prepare(scope, f.startRequest));
    denied(() => f.nativeClaims.claimCheckoutStart(scope, f.startRequest));
  }
  assert.deepEqual(f.claimRows(), rows);
}));

test('RCG4BC3-START-SOURCE-CHANGES original price terms quotes and cart state remain authoritative', async () => {
  for (const change of [changedPrice, changedTerms,
    (f: Fixture) => f.quote('shipping', { expected_revision: 1, amount_minor: '100', explicit_zero: false }),
    (f: Fixture) => f.quote('fee', { expected_revision: 1, amount_minor: '50', explicit_zero: false }),
    (f: Fixture) => f.catalogSource.fixturePurchase(f.preview.cart_id, 'changed-native-order'),
    (f: Fixture) => f.native.fixtureStock('basic', 0),
    (f: Fixture) => f.quotes.close()]) await usingNativeStart(f => {
      const binding = f.starts.prepare(f.customer, f.startRequest); change(f);
      denied(() => f.starts.assertCurrent(f.customer, binding), /CURRENT_INVALID/);
      denied(() => f.claimNative(), /BINDING_INVALID/); assert.equal(f.claimRows().length, 0);
    });
});

test('RCG4BC3-START-EXPIRY-CLOSE expiry clock rollback and owner closure cannot revive current bindings', async () => {
  for (const change of [(f: Fixture) => f.advance(60000), (f: Fixture) => f.advance(-1),
    (f: Fixture) => f.starts.close(), (f: Fixture) => f.previews.close()]) await usingNativeStart(f => {
      const binding = f.starts.prepare(f.customer, f.startRequest), historical = f.claimNative(), rows = f.claimRows();
      change(f); denied(() => f.starts.assertCurrent(f.customer, binding)); denied(() => f.claimNative());
      assert.deepEqual(f.claimRows(), rows);
      if (f.now() >= historical.created_at) assert.deepEqual(f.claims.read(f.customer, f.startRequest.command_id), historical);
    });
  await usingNativeStart(f => {
    let fired = false; f.afterQuoteReads(1, () => { fired = true; f.starts.close(); });
    denied(() => f.starts.prepare(f.customer, f.startRequest), /UNAVAILABLE/);
    assert.equal(fired, true); assert.equal(f.claimRows().length, 0);
  });
});

test('RCG4BC3-START-PROOF-RECOVERY native proof revocation and restored-store quarantine deny construction', async () => {
  for (const change of [changedProof, (f: Fixture) => f.kernel.revoke(f.customer), quarantine]) await usingNativeStart(f => {
    const binding = f.starts.prepare(f.customer, f.startRequest); change(f);
    denied(() => f.starts.assertCurrent(f.customer, binding)); denied(() => f.claimNative());
    assert.equal(f.claimRows().length, 0);
  });
});

test('RCG4BC3-START-TRANSACTION native claims reject nested savepoints before any database or preview work', () => usingNativeStart(f => {
  const sessions = f.db.prepare('SELECT * FROM commerce_sessions').all(), before = f.effects();
  let quoted = false; f.afterQuoteReads(1, () => { quoted = true; }); f.advance(1);
  f.kernel.transaction(() => {
    denied(() => f.claimNative(), /TRANSACTION_OWNERSHIP/);
    assert.deepEqual(f.db.prepare('SELECT * FROM commerce_sessions').all(), sessions);
  });
  f.db.exec('BEGIN IMMEDIATE');
  try { denied(() => f.claimNative(), /TRANSACTION_OWNERSHIP/); } finally { f.db.exec('ROLLBACK'); }
  assert.equal(quoted, false); assert.equal(f.claimRows().length, 0); assert.deepEqual(f.effects(), before);
}));

test('RCG4BC3-START-COMMIT failed durable commit cannot return or retain a native START claim', () => usingNativeStart(f => {
  f.db.exec(`CREATE TEMP TABLE start_parent(id INTEGER PRIMARY KEY);
    CREATE TEMP TABLE start_commit_failure(id INTEGER REFERENCES start_parent(id) DEFERRABLE INITIALLY DEFERRED);
    CREATE TEMP TRIGGER start_commit_fail AFTER INSERT ON main.commerce_support_documents
    WHEN NEW.kind='delegated_command_claim' BEGIN INSERT INTO start_commit_failure VALUES(1); END;`);
  denied(() => f.claimNative(), /STORAGE_UNAVAILABLE/); assert.equal(f.db.isTransaction, false);
  assert.equal(f.claimRows().length, 0); f.db.exec('DROP TRIGGER start_commit_fail');
  assert.equal(f.claimNative().revision, 1);
}));

test('RCG4BC3-START-FINAL-CURRENTNESS a source change during final native access rolls back the original claim', () => usingNativeStart(f => {
  // Targeted-fault witness: the first capture is valid, and this mutation leaves
  // command rows internally coherent. Only the late concrete native check sees it.
  const guard = afterInsertScope(f, () => changedTerms(f));
  denied(() => f.nativeClaims.claimCheckoutStart(guard.scope, f.startRequest), /BINDING_INVALID/);
  assert.equal(guard.fired(), true); assert.equal(f.claimRows().length, 0); assert.equal(f.db.isTransaction, false);
}));

test('RCG4BC3-START-JOURNAL-FENCE a final source callback cannot delete or coherently retire the claim', async () => {
  for (const flaw of ['delete','retire']) await usingNativeStart(f => {
    let fired = false;
    f.afterQuoteReads(3, () => {
      fired = true; assert.equal(f.claimRows().length, 1);
      if (flaw === 'delete') f.db.prepare('DELETE FROM commerce_support_documents WHERE kind=?').run(CLAIM_KIND);
      else assert.equal(retireCommandClaim(f.kernel, f.record(), 'cancelled', true).body.retired, true);
    });
    denied(() => f.claimNative(), /REVISION_CONFLICT/);
    assert.equal(fired, true); assert.equal(f.claimRows().length, 0);
  });
});

test('RCG4BC3-START-FINAL-AUTHORITY late proof loss recovery fencing or closure cannot commit an active claim', async () => {
  for (const mode of ['proof','quarantine','closed']) await usingNativeStart(f => {
    let fired = false;
    f.afterQuoteReads(3, () => {
      fired = true;
      if (mode === 'proof') changedProof(f); else if (mode === 'quarantine') quarantine(f); else f.starts.close();
    });
    denied(() => f.claimNative()); assert.equal(fired, true); assert.equal(f.claimRows().length, 0);
    assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_recovery_state').get()!.n, 0);
  });
});

test('RCG4BC3-START-REENTRANCY a source callback cannot create a nested original claim', () => usingNativeStart(f => {
  let fired = false;
  f.afterQuoteReads(3, () => {
    fired = true;
    denied(() => f.nativeClaims.claimCheckoutStart(f.customer, { ...f.startRequest, command_id: otherId }), /TRANSACTION_OWNERSHIP/);
    denied(() => f.claims.claim(f.customer, f.final.request), /TRANSACTION_OWNERSHIP/);
  });
  assert.equal(f.claimNative().state, 'claimed'); assert.equal(fired, true); assert.equal(f.claimRows().length, 1);
}));

test('RCG4BC3-START-RESTART durable history cannot reconstruct a native preview in a fresh owner', () => usingNativeStart(f => {
  const first = f.claimNative(), rows = f.claimRows(), db = new DatabaseSync(f.filename);
  try {
    const kernel = new CommerceKernel(db, f.now), scope = kernel.authenticate(f.bearer);
    const previews = new CheckoutPreviews(kernel, new ShoppingCart(kernel, f.catalogSource), f.quotes);
    const starts = new DelegatedCheckoutStarts(kernel, previews, { grant: f.grant });
    const claims = new DelegatedCommandClaims(kernel, f.correlation, starts);
    assert.deepEqual(claims.read(scope, f.startRequest.command_id), first);
    assert.equal(claims.recovery(scope, f.startRequest.command_id).request.expected_command_digest, first.command_digest);
    denied(() => claims.claimCheckoutStart(scope, f.startRequest), /BINDING_INVALID/);
    assert.deepEqual(f.claimRows(), rows); starts.close(); previews.close();
  } finally { db.close(); }
}));
