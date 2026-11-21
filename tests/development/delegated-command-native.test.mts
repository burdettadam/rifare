import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { usingNativeReceipt, nativeReceiptFixture } from './delegated-receipt-native-helpers.mts';
import {
  COMMAND_PROFILE, RESPONSE_PROFILE, encodeDelegatedCommand, createDelegatedRecovery,
  bindDelegatedResponse, correlateDelegatedReceipt,
} from '../../packages/adapters/delegated-commands/command-codec.mts';

type Fixture = Awaited<ReturnType<typeof nativeReceiptFixture>>;
const startId = '28a2e366-e141-456e-8a4b-24cc5d00a779';
const finalId = 'f358c5e1-e970-443a-9fb6-2b7ac55bc706';
const challengeId = '6637cb57-c689-43f8-927d-5efb1bd9f1c4';
const proofId = 'd424373c-c139-4249-a059-28edc98d7db5';
const rawDigest = (bytes: string) => 'sha256:' + createHash('sha256').update(bytes, 'utf8').digest('hex');

// These protocol observations are independently authored synthetic data. Native
// purchase facts and actual signed receipts come from the existing real owners;
// no upstream service, authority source or HTTP transport is modeled as qualified.
function requests(f: Fixture) {
  const start = {
    profile: COMMAND_PROFILE, command: 'START_USE', command_id: startId,
    grant: f.context.grant,
    operation: { ...f.context.operation, request_digest: 'sha256:' + f.receiptPreview.preview_digest },
  };
  const final = {
    profile: COMMAND_PROFILE, command: 'FINALIZE_USE', command_id: finalId,
    challenge_id: challengeId, proof_submission_id: proofId,
  };
  return { start, final };
}
function challengeResponse(f: Fixture, start: ReturnType<typeof requests>['start']) {
  return {
    profile: RESPONSE_PROFILE, original_command_id: startId,
    command_digest: encodeDelegatedCommand(start).command_digest, recovered: false,
    result: { kind: 'CHALLENGE', challenge_id: challengeId, grant: start.grant,
      operation: start.operation, created_at: f.at(-5000), expires_at: f.at(30000) },
  };
}
function finalResponse(f: Fixture, final: ReturnType<typeof requests>['final'],
  token = f.token, decision: 'PERMIT' | 'DENY' = 'PERMIT') {
  return {
    profile: RESPONSE_PROFILE, original_command_id: finalId,
    command_digest: encodeDelegatedCommand(final).command_digest, recovered: false,
    result: { kind: 'FINAL_USE', challenge_id: challengeId, decision,
      receipt_ref: 'urn:rifare:synthetic:receipt:' + f.payload.id, receipt_digest: rawDigest(token),
      recorded_at: f.payload.issued_at, authorization_expires_at: f.payload.expires_at,
      semantics: 'EVIDENCE_ONLY' },
  };
}
function assertUnqualified(value: ReturnType<typeof bindDelegatedResponse>) {
  assert.equal(value.execution_authorized, false);
  assert.equal(value.qualification, 'candidate_contract_only');
  assert.equal(value.evidence_status, 'unverified_protocol_data');
  assert.equal(value.provider_authenticated, false);
  assert.equal(value.receipt_signature_verified, false);
  assert(Object.isFrozen(value));
}

test('RCG4BC1-NATIVE-PREVIEW original native purchase digest survives command and challenge binding', () =>
  usingNativeReceipt(async f => {
    const before = f.effects(), { start } = requests(f);
    const encoded = encodeDelegatedCommand(start);
    const body = JSON.parse(encoded.canonical_json);
    assert.equal(f.receiptPreview.total_payable_minor, '6800');
    assert.equal(body.operation.request_digest, 'sha256:' + f.receiptPreview.preview_digest);
    assert.deepEqual(body.grant, f.context.grant);
    const response = challengeResponse(f, start), bound = bindDelegatedResponse(start, response);
    assertUnqualified(bound);
    assert.notEqual(response.result.challenge_id, f.context.challenge,
      'P03 challenge record UUID must not replace the independently established proof nonce');
    assert.equal(f.verifyCalls, 0);
    assert.throws(() => f.receiptOwner.assertCurrent(f.customer, bound as any), /RECEIPT_PROVENANCE_INVALID/);
    const wrong = structuredClone(response);
    wrong.result.operation.request_digest = 'sha256:' + '0'.repeat(64);
    assert.throws(() => bindDelegatedResponse(start, wrong));
    assert.deepEqual(f.effects(), before);
  }));

test('RCG4BC1-NATIVE-RECEIPT actual ES256 and Ed25519 receipt bytes correlate without moving authority', async () => {
  for (const algorithm of ['ES256', 'EdDSA'] as const) await usingNativeReceipt(async f => {
    const before = f.effects(), { final } = requests(f), response = finalResponse(f, final);
    const correlated = correlateDelegatedReceipt(final, response, f.token);
    assertUnqualified(correlated); assert.equal(correlated.receipt_digest_matched, true);
    assert.equal(f.verifyCalls, 0, 'Digest correlation must not claim or invoke JOSE verification');
    assert(!JSON.stringify(correlated).includes(f.token), 'Raw signed bytes must not survive in the result');
    assert.throws(() => f.receiptOwner.assertCurrent(f.customer, correlated as any), /RECEIPT_PROVENANCE_INVALID/);
    const native = await f.verify();
    assert.equal(f.verifyCalls, 1);
    assert.equal(native.receipt_id, f.payload.id);
    assert.equal(native.operation_digest, 'sha256:' + f.receiptPreview.preview_digest);
    assert.equal(native.execution_authorized, false);
    assert.deepEqual(f.effects(), before);
  }, { algorithm });
});

test('RCG4BC1-NATIVE-FORGED-RECEIPT matching metadata digest cannot qualify an invalid native signature', () =>
  usingNativeReceipt(async f => {
    const before = f.effects(), { final } = requests(f);
    const parts = f.token.split('.'), signature = Buffer.from(parts[2], 'base64url');
    signature[0] ^= 1; parts[2] = signature.toString('base64url');
    const invalidToken = parts.join('.'), response = finalResponse(f, final, invalidToken);
    const correlated = correlateDelegatedReceipt(final, response, invalidToken);
    assertUnqualified(correlated); assert.equal(correlated.receipt_digest_matched, true);
    assert.equal(f.verifyCalls, 0);
    await assert.rejects(f.receiptOwner.verify(f.customer, { ...f.request, compact_jws: invalidToken }));
    assert.equal(f.verifyCalls, 1);
    assert.deepEqual(f.effects(), before);
  }));

test('RCG4BC1-NATIVE-HISTORY historical recovery cannot refresh expired native receipt authority', () =>
  usingNativeReceipt(async f => {
    const before = f.effects(), { final } = requests(f), original = finalResponse(f, final);
    const recovery = createDelegatedRecovery(final), historical = { ...original, recovered: true };
    f.advance(21000);
    const bound = bindDelegatedResponse(final, historical,
      { recovery: recovery.request, previous: original });
    assertUnqualified(bound);
    assert.deepEqual(bound.response.result, original.result);
    const correlated = correlateDelegatedReceipt(final, historical, f.token,
      { recovery: recovery.request, previous: original });
    assertUnqualified(correlated);
    await assert.rejects(f.verify(), /EXPIRED|STALE|NOT_FOUND/);
    assert.deepEqual(f.effects(), before);
  }));

test('RCG4BC1-NATIVE-DENY completed signed denial stays denial and cannot become native purchase evidence', () =>
  usingNativeReceipt(async f => {
    const before = f.effects(), { final } = requests(f);
    const deniedToken = await f.signing.sign({ ...f.payload, decision: 'DENY' });
    const original = finalResponse(f, final, deniedToken, 'DENY');
    const bound = correlateDelegatedReceipt(final, original, deniedToken);
    assertUnqualified(bound); assert.equal(bound.response.result.kind, 'FINAL_USE');
    assert.deepEqual(bound.response.result, original.result);
    const recovered = { ...original, recovered: true };
    const history = bindDelegatedResponse(final, recovered,
      { recovery: createDelegatedRecovery(final).request, previous: original });
    assert.deepEqual(history.response.result, original.result);
    await assert.rejects(f.receiptOwner.verify(f.customer, { ...f.request, compact_jws: deniedToken }));
    assert.deepEqual(f.effects(), before);
  }));
