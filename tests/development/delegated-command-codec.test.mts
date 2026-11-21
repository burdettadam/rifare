import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  encodeDelegatedCommand, createDelegatedRecovery, bindDelegatedResponse,
  correlateDelegatedReceipt, DelegatedCommandDenied, MAX_COMMAND_BYTES,
} from '../../packages/adapters/delegated-commands/command-codec.mts';

// These expectations were independently authored by the integration owner with
// Python's standard-library encoder/hash, never the production JS canonicalizer.
const fixture = JSON.parse(readFileSync(new URL('../fixtures/delegated-commands/consumer-vectors.v1.json', import.meta.url), 'utf8'));
const start = fixture.commands.find((x: any) => x.name === 'start_use');
const final = fixture.commands.find((x: any) => x.name === 'finalize_use');
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const wire = (value: unknown): Uint8Array => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
const changedUuid = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const changedDigest = 'sha256:' + '1'.repeat(64);
const denied = (action: () => unknown, code?: RegExp): void => {
  assert.throws(action, (error: unknown) => error instanceof DelegatedCommandDenied &&
    /^COMMAND_[A-Z_]+$/.test(error.message) && (!code || code.test(error.message)));
};
const reverseMembers = (value: any): any => value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reverseMembers(v)])) : value;

test('RCG4BC1-CODEC-ORACLE independent canonical bodies and mutation digests match', () => {
  for (const v of fixture.commands) {
    const encoded = encodeDelegatedCommand(v.request);
    assert.deepEqual(encoded.request, v.request);
    assert.equal(encoded.canonical_json, v.canonical_json);
    assert.equal(encoded.command_digest, v.command_digest);
    assert.equal(encoded.original_command_id, v.request.command_id);
    assert.equal(encoded.execution_authorized, false);
    assert.equal(encoded.qualification, 'candidate_contract_only');
    assert(Object.isFrozen(encoded)); assert(Object.isFrozen(encoded.request));
  }
});

test('RCG4BC1-CODEC-CANONICAL member order and equivalent escapes retain original digest', () => {
  const reversed = reverseMembers(start.request);
  assert.equal(encodeDelegatedCommand(reversed).canonical_json, start.canonical_json);
  const escaped = JSON.stringify(start.request).replace('"profile"', '"profi\\u006ce"').replace('START_USE', 'START_\\u0055SE');
  assert.equal(encodeDelegatedCommand(wire(escaped)).command_digest, start.command_digest);
  const changed = clone(start.request); changed.operation.audience = changed.operation.audience.replace('%2F', '%2f');
  assert.notEqual(encodeDelegatedCommand(changed).command_digest, start.command_digest);
  assert.equal((encodeDelegatedCommand(changed).request as any).operation.audience, changed.operation.audience);
});

test('RCG4BC1-CODEC-DIGEST-SCOPE every original mutation field participates in identity', () => {
  for (const [section, field, value] of [
    ['', 'command_id', changedUuid], ['grant', 'id', changedUuid], ['grant', 'revision', 8],
    ['grant', 'terms_digest', changedDigest], ['operation', 'action', 'urn:rifare:other:action'],
    ['operation', 'resource_id', 'urn:rifare:other:resource'], ['operation', 'audience', 'urn:rifare:other:audience'],
    ['operation', 'request_profile', 'urn:rifare:other:profile'], ['operation', 'request_digest', changedDigest],
  ] as const) {
    const c = clone(start.request); (section ? c[section] : c)[field] = value;
    assert.notEqual(encodeDelegatedCommand(c).command_digest, start.command_digest);
  }
  for (const key of ['command_id', 'challenge_id', 'proof_submission_id']) {
    const c = clone(final.request); c[key] = changedUuid;
    assert.notEqual(encodeDelegatedCommand(c).command_digest, final.command_digest);
  }
});

test('RCG4BC1-CODEC-CLOSED-REQUEST authority and other-command fields are refused', () => {
  for (const value of fixture.commands) for (const extra of [
    { tenant: 'tenant' }, { actor: { type: 'USER', id: 'user' } }, { verified: true },
    { grant_snapshot: start.request.grant }, { deadline: '2099-01-01T00:00:00Z' }, { execution_authorized: true },
  ]) denied(() => encodeDelegatedCommand({ ...value.request, ...extra }));
  for (const c of [
    { ...start.request, challenge_id: changedUuid }, { ...final.request, operation: start.request.operation },
    { ...start.recovery_request, command_id: changedUuid }, { ...start.request, command: 'CREATE_GRANT' },
    { ...start.request, profile: 'urn:other:profile' }, { ...start.request, command: null },
  ]) denied(() => encodeDelegatedCommand(c));
  const nested = clone(start.request); nested.grant.current = true; denied(() => encodeDelegatedCommand(nested));
  const op = clone(start.request); op.operation.verified = true; denied(() => encodeDelegatedCommand(op));
});

test('RCG4BC1-CODEC-SCALARS identifiers digests revisions and absolute URI subset are strict', () => {
  for (const value of ['', '00000000-0000-0000-0000-000000000000', changedUuid.toUpperCase(), '{'+changedUuid+'}', ' '+changedUuid])
    denied(() => encodeDelegatedCommand({ ...final.request, command_id: value }));
  for (const value of [0, -1, -0, 1.5, Number.MAX_SAFE_INTEGER + 1, '7', null, true]) {
    const c = clone(start.request); c.grant.revision = value; denied(() => encodeDelegatedCommand(c));
  }
  for (const value of ['sha256:'+'A'.repeat(64), '1'.repeat(64), changedDigest+'0']) {
    const c = clone(start.request); c.operation.request_digest = value; denied(() => encodeDelegatedCommand(c));
  }
  for (const value of ['relative/path', 'urn:bad:*', 'urn:bad: space', 'urn:bad:é', 'urn:bad:%', 'urn:bad:%gg',
    'https:example.invalid/path', 'https:///example.invalid', 'https://example.invalid\\path', 'https://',
    'https://example.invalid/"x"', 'https://user@@example.invalid', 'custom://host:bad',
    'custom://ho[st/path', 'urn:bad:'+'a'.repeat(1024)]) {
    const c = clone(start.request); c.operation.audience = value; denied(() => encodeDelegatedCommand(c));
  }
  const maximum = clone(start.request); maximum.grant.revision = Number.MAX_SAFE_INTEGER;
  assert.equal((encodeDelegatedCommand(maximum).request as any).grant.revision, Number.MAX_SAFE_INTEGER);
});

test('RCG4BC1-CODEC-STRICT-JSON duplicate decoded names malformed bytes and numeric aliases fail', () => {
  const s = JSON.stringify(start.request);
  for (const raw of [s.replace('"profile":', '"profile":"urn:other","profi\\u006ce":'),
    s.replace('"revision":7', '"revision":7.0'), s.replace('"revision":7', '"revision":7e0'),
    s.replace('"revision":7', '"revision":9007199254740991.1'),
    s.replace('synthetic-42', '\\ud800'), '\ufeff'+s,
    JSON.stringify({ ...start.request, extra: [[[[[[[[[[[[[[[[[1]]]]]]]]]]]]]]]]] }),
  ]) denied(() => encodeDelegatedCommand(wire(raw)));
  denied(() => encodeDelegatedCommand(new Uint8Array([0xc0, 0xaf])));
  denied(() => encodeDelegatedCommand(new Uint8Array()));
  denied(() => encodeDelegatedCommand(null));
  denied(() => encodeDelegatedCommand(JSON.stringify(start.request)));
});

test('RCG4BC1-CODEC-SNAPSHOT detached native data refuses accessors and caller alias mutation', () => {
  const input = clone(start.request), encoded = encodeDelegatedCommand(input);
  input.operation.audience = 'urn:changed:later'; input.grant.revision = 99;
  assert.equal(encoded.command_digest, start.command_digest);
  assert.deepEqual(encoded.request, start.request);
  assert(!Object.isFrozen(input)); assert(Object.isFrozen((encoded.request as any).operation));
  let calls = 0;
  const getter = clone(start.request); Object.defineProperty(getter, 'operation', { enumerable: true, get() { calls++; return start.request.operation; } });
  denied(() => encodeDelegatedCommand(getter)); assert.equal(calls, 0);
  for (const c of [Object.assign(Object.create({ inherited: true }), start.request), { ...start.request, toJSON() { calls++; return start.request; } }])
    denied(() => encodeDelegatedCommand(c));
  assert.equal(calls, 0);
});

test('RCG4BC1-CODEC-RECOVERY-ENCODING recovery retains original identity and digest', () => {
  for (const v of fixture.commands) {
    const recovery = createDelegatedRecovery(v.request);
    assert.deepEqual(recovery.request, v.recovery_request);
    assert.equal(recovery.canonical_json, v.recovery_canonical_json);
    assert.equal(recovery.command_digest, v.command_digest);
    assert.equal(recovery.original_command_id, v.request.command_id);
    assert(!Object.hasOwn(recovery.request, 'command_id'));
    assert.deepEqual(encodeDelegatedCommand(wire(v.recovery_request)), recovery);
    denied(() => createDelegatedRecovery(v.recovery_request));
  }
});

test('RCG4BC1-CODEC-START-BINDING challenge preserves every original grant and operation fact', () => {
  const valid = bindDelegatedResponse(start.request, fixture.challenge_response);
  assert.deepEqual(valid.response, fixture.challenge_response);
  for (const [section, field, value] of [
    ['grant', 'id', changedUuid], ['grant', 'revision', 8], ['grant', 'terms_digest', changedDigest],
    ['operation', 'action', 'urn:rifare:other:action'], ['operation', 'resource_id', 'urn:rifare:other:resource'],
    ['operation', 'audience', 'urn:rifare:other:audience'], ['operation', 'request_profile', 'urn:rifare:other:profile'],
    ['operation', 'request_digest', changedDigest],
  ] as const) {
    const c = clone(fixture.challenge_response); c.result[section][field] = value;
    denied(() => bindDelegatedResponse(start.request, c), /COMMAND_RESULT_MISMATCH/);
  }
});

test('RCG4BC1-CODEC-ENVELOPE exact original identity profile and closed success envelope required', () => {
  for (const [field, value] of [
    ['original_command_id', changedUuid], ['command_digest', changedDigest],
    ['profile', 'urn:other:response'], ['recovered', 1], ['extra', 'foreign'],
  ] as const) {
    const c = clone(fixture.challenge_response); c[field] = value;
    denied(() => bindDelegatedResponse(start.request, c));
  }
  for (const result of [{ kind: 'GRANT_SNAPSHOT', grant: start.request.grant }, { kind: 'NOT_FOUND' },
    { kind: 'PENDING' }, { kind: 'UNRESOLVED' }, fixture.final_response.result])
    denied(() => bindDelegatedResponse(start.request, { ...fixture.challenge_response, result }));
  denied(() => bindDelegatedResponse(start.recovery_request, fixture.challenge_response));
});

test('RCG4BC1-CODEC-FINAL-BINDING final result retains challenge decision and evidence semantics', () => {
  for (const decision of ['PERMIT', 'DENY']) {
    const c = clone(fixture.final_response); c.result.decision = decision;
    const parsed = bindDelegatedResponse(final.request, c);
    assert.equal(parsed.response.result.kind, 'FINAL_USE');
    assert.equal((parsed.response.result as any).decision, decision);
    assert.equal(parsed.execution_authorized, false);
  }
  for (const [field, value] of [['challenge_id', changedUuid], ['decision', 'ALLOW'],
    ['semantics', 'EXECUTION_AUTHORIZED'], ['receipt_ref', 'relative'], ['receipt_digest', 'bad'], ['extra', true]] as const) {
    const c = clone(fixture.final_response); c.result[field] = value;
    denied(() => bindDelegatedResponse(final.request, c));
  }
  denied(() => bindDelegatedResponse(final.request, { ...fixture.final_response, result: fixture.challenge_response.result }));
});

test('RCG4BC1-CODEC-HISTORICAL-TIME calendar nanoseconds and original ordering stay historical', () => {
  assert.deepEqual(bindDelegatedResponse(final.request, fixture.final_response).response, fixture.final_response);
  const sameInstant = clone(fixture.final_response); sameInstant.result.authorization_expires_at = '2026-01-02T03:04:15.100000000Z';
  denied(() => bindDelegatedResponse(final.request, sameInstant));
  const after = clone(fixture.challenge_response); after.result.expires_at = after.result.created_at;
  denied(() => bindDelegatedResponse(start.request, after));
  for (const value of ['2026-02-30T03:04:15Z', '0000-01-01T00:00:00Z', '2026-01-02T03:04:15+00:00',
    '2026-01-02T03:04:15.1234567890Z', '2026-01-02T03:04:60Z', '2026-01-02T03:04:15z']) {
    const c = clone(fixture.final_response); c.result.recorded_at = value;
    denied(() => bindDelegatedResponse(final.request, c));
  }
  const exact = clone(fixture.final_response); exact.result.authorization_expires_at = '2026-01-02T03:04:15.100000001Z';
  assert.equal((bindDelegatedResponse(final.request, exact).response.result as any).authorization_expires_at, exact.result.authorization_expires_at);
});

test('RCG4BC1-CODEC-RECOVERY-FLAG explicit recovery requires true while duplicate mutation may recover', () => {
  for (const [v, response] of [[start, fixture.challenge_response], [final, fixture.final_response]]) {
    for (const recovered of [false, true]) assert.equal(bindDelegatedResponse(v.request, { ...response, recovered }).response.recovered, recovered);
    denied(() => bindDelegatedResponse(v.request, response, { recovery: v.recovery_request }));
    const c = { ...response, recovered: true };
    assert.equal(bindDelegatedResponse(v.request, c, { recovery: wire(v.recovery_request) }).response.recovered, true);
    for (const recovery of [{ ...v.recovery_request, original_command_id: changedUuid },
      { ...v.recovery_request, expected_command_digest: changedDigest }, v.request])
      denied(() => bindDelegatedResponse(v.request, c, { recovery }));
  }
});

test('RCG4BC1-CODEC-RECOVERY-BINDING retained full original intent constrains recovered results', () => {
  const changedStart = clone(fixture.challenge_response); changedStart.recovered = true;
  changedStart.result.operation.request_digest = changedDigest;
  denied(() => bindDelegatedResponse(start.request, changedStart, { recovery: start.recovery_request }), /COMMAND_RESULT_MISMATCH/);
  const changedFinal = clone(fixture.final_response); changedFinal.recovered = true; changedFinal.result.challenge_id = changedUuid;
  denied(() => bindDelegatedResponse(final.request, changedFinal, { recovery: final.recovery_request }), /COMMAND_RESULT_MISMATCH/);
});

test('RCG4BC1-CODEC-HISTORY immutable prior results permit only recovered flag changes', () => {
  for (const [v, previous] of [[start, fixture.challenge_response], [final, fixture.final_response]]) {
    const recovered = reverseMembers({ ...previous, recovered: true });
    assert.deepEqual(bindDelegatedResponse(v.request, recovered, { recovery: v.recovery_request, previous }).response, { ...previous, recovered: true });
  }
  for (const [field, value] of [['decision', 'DENY'], ['receipt_ref', 'urn:rifare:replacement:receipt'],
    ['receipt_digest', changedDigest], ['recorded_at', '2026-01-02T03:04:15.100Z'],
    ['authorization_expires_at', '2026-01-02T03:04:50Z']] as const) {
    const c = clone(fixture.final_response); c.recovered = true; c.result[field] = value;
    denied(() => bindDelegatedResponse(final.request, c, { recovery: final.recovery_request, previous: fixture.final_response }), /COMMAND_HISTORY_CHANGED/);
  }
  const c = clone(fixture.challenge_response); c.result.challenge_id = changedUuid;
  denied(() => bindDelegatedResponse(start.request, c, { previous: fixture.challenge_response }), /COMMAND_HISTORY_CHANGED/);
});

test('RCG4BC1-CODEC-PRIOR-OPTIONS prior observations and option objects are independently validated', () => {
  const bad = { ...fixture.final_response, command_digest: changedDigest };
  denied(() => bindDelegatedResponse(final.request, fixture.final_response, { previous: bad }));
  for (const options of [{ previous: undefined }, { recovery: null }, { extra: true }, null])
    denied(() => bindDelegatedResponse(final.request, fixture.final_response, options as any));
  let calls = 0;
  const options = Object.defineProperty({}, 'previous', { enumerable: true, get() { calls++; return fixture.final_response; } });
  denied(() => bindDelegatedResponse(final.request, fixture.final_response, options)); assert.equal(calls, 0);
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  denied(() => bindDelegatedResponse(final.request, fixture.final_response, revoked.proxy), /COMMAND_OPTIONS_INVALID/);
  const hostile = new Proxy({}, { getPrototypeOf() { throw new Error('caller-private-value'); } });
  denied(() => bindDelegatedResponse(final.request, fixture.final_response, hostile), /COMMAND_OPTIONS_INVALID/);
});

test('RCG4BC1-CODEC-RECEIPT exact byte correlation does not verify a signature or retain token', () => {
  const compact = fixture.receipt_byte_correlation.compact_jws_shape_only;
  const correlated = correlateDelegatedReceipt(final.request, fixture.final_response, compact);
  assert.equal(correlated.receipt_digest_matched, true);
  assert.equal(correlated.receipt_signature_verified, false);
  assert.equal(correlated.provider_authenticated, false);
  assert.equal(correlated.execution_authorized, false);
  assert.equal((correlated.response.result as any).receipt_digest, fixture.receipt_byte_correlation.sha256);
  assert(!JSON.stringify(correlated).includes(compact)); assert(Object.isFrozen(correlated));
});

test('RCG4BC1-CODEC-RECEIPT-FAULTS changed oversized malformed or non-final receipt data fails', () => {
  const compact = fixture.receipt_byte_correlation.compact_jws_shape_only;
  denied(() => correlateDelegatedReceipt(final.request, fixture.final_response, compact+'a'), /COMMAND_RECEIPT_DIGEST_MISMATCH/);
  for (const value of [' '+compact, compact+'\n', 'a.b', 'a..b', 'a.b.c.d', 'a'.repeat(100001)+'.b.c', null, 2])
    denied(() => correlateDelegatedReceipt(final.request, fixture.final_response, value as any));
  denied(() => correlateDelegatedReceipt(start.request, fixture.challenge_response, compact));
});

test('RCG4BC1-CODEC-BOUNDS complete wire byte limits apply to commands and responses', () => {
  for (const [value, action] of [[start.request, (b: Uint8Array) => encodeDelegatedCommand(b)],
    [fixture.final_response, (b: Uint8Array) => bindDelegatedResponse(final.request, b)]] as const) {
    const original = wire(value), padded = new Uint8Array(16_384).fill(32); padded.set(original);
    action(padded);
    // The existing scanner also bounds its work to 32,768 scan steps. A document
    // below the byte ceiling can therefore be denied for excessive whitespace.
    const scannerBound = new Uint8Array(MAX_COMMAND_BYTES).fill(32); scannerBound.set(original);
    denied(() => action(scannerBound));
    const oversized = new Uint8Array(MAX_COMMAND_BYTES + 1).fill(32); oversized.set(original);
    denied(() => action(oversized));
  }
  denied(() => encodeDelegatedCommand({ ...start.request, extra: 'a'.repeat(MAX_COMMAND_BYTES) }));
  const raw = JSON.stringify(fixture.final_response).replace('"recovered":false', '"recovered":false,"recov\\u0065red":true');
  denied(() => bindDelegatedResponse(final.request, wire(raw)));
});

test('RCG4BC1-CODEC-NO-AUTHORITY parsing historical metadata causes no fetch clock or trust promotion', () => {
  const priorFetch = globalThis.fetch, priorNow = Date.now;
  let fetches = 0, clocks = 0;
  globalThis.fetch = (() => { fetches++; throw new Error('unexpected fetch'); }) as any;
  Date.now = () => { clocks++; throw new Error('unexpected clock'); };
  try {
    const result = bindDelegatedResponse(final.request, fixture.final_response);
    assert.equal(result.evidence_status, 'unverified_protocol_data');
    assert.equal(result.execution_authorized, false); assert.equal(result.provider_authenticated, false);
    assert.equal(result.receipt_signature_verified, false); assert.equal(fetches, 0); assert.equal(clocks, 0);
    assert(!Object.hasOwn(result, 'context')); assert(!Object.hasOwn(result, 'nonce'));
    assert(!Object.hasOwn(result, 'retry')); assert(!Object.hasOwn(result, 'dispatch'));
  } finally { globalThis.fetch = priorFetch; Date.now = priorNow; }
});
