import test from 'node:test';
import assert from 'node:assert/strict';
import { PinnedReceiptJoseVerifier } from '../../packages/adapters/delegated-receipts/jose-verifier.mts';
import { ReceiptBindingDenied } from '../../packages/commerce/delegated-receipt-binding.mts';
import { signingFixture, publishedVector, clone } from './receipt-signature-helpers.mts';

const denied = (code?: string) => (error: unknown) => error instanceof ReceiptBindingDenied && (!code || error.code === code);

test('RCG3-JOSE-ES256 unchanged upstream signature verifies original bytes', async () => {
  const f = publishedVector('ES256'), verifier = new PinnedReceiptJoseVerifier([f.key]);
  const result = await verifier.verify(f.token, f.trust);
  assert.deepEqual(result.payload, f.payload); assert.equal(result.trusted_key.algorithm, 'ES256');
  assert(Object.isFrozen(result)); assert(Object.isFrozen(result.payload));
});

test('RCG3-JOSE-EDDSA unchanged upstream signature verifies original bytes', async () => {
  const f = publishedVector('EdDSA'), verifier = new PinnedReceiptJoseVerifier([f.key]);
  const result = await verifier.verify(f.token, f.trust);
  assert.deepEqual(result.payload, f.payload); assert.equal(result.trusted_key.algorithm, 'EdDSA');
});

test('RCG3-JOSE-TAMPER altered signed payload and signature deny for both algorithms', async () => {
  for (const alg of ['ES256','EdDSA'] as const) {
    const f = publishedVector(alg), verifier = new PinnedReceiptJoseVerifier([f.key]);
    const parts = f.token.split('.');
    const signature = Buffer.from(parts[2], 'base64url'); signature[0] ^= 1;
    await assert.rejects(verifier.verify(parts[0]+'.'+parts[1]+'.'+signature.toString('base64url'), f.trust), denied('RECEIPT_SIGNATURE_INVALID'));
    const changed = { ...f.payload, decision: 'DENY' };
    await assert.rejects(verifier.verify(parts[0]+'.'+Buffer.from(JSON.stringify(changed)).toString('base64url')+'.'+parts[2], f.trust), denied('RECEIPT_SIGNATURE_INVALID'));
  }
});

test('RCG3-JOSE-TRUST receipt cannot choose another issuer algorithm or unknown key', async () => {
  const f = await signingFixture(), token = await f.sign({ value: 'authentic' });
  for (const trust of [
    { ...f.trust, issuer: { ...f.trust.issuer, id: 'urn:other:issuer' } },
    { ...f.trust, allowed_algorithms: ['EdDSA'] },
    { ...f.trust, trusted_key_ids: ['unknown'] },
  ]) await assert.rejects(f.verifier.verify(token, trust as any), denied('RECEIPT_KEY_UNTRUSTED'));
  const unknown = await f.sign({ value: 1 }, { ...f.header, kid: 'unknown' });
  await assert.rejects(f.verifier.verify(unknown, { ...f.trust, trusted_key_ids: ['unknown'] }), denied('RECEIPT_KEY_UNTRUSTED'));
  const other = await signingFixture();
  await assert.rejects(other.verifier.verify(token, f.trust), denied('RECEIPT_SIGNATURE_INVALID'));
});

test('RCG3-JOSE-KEY-CONFIG private symmetric mismatched and ambiguous keys are rejected', async () => {
  const f = await signingFixture();
  const variants: any[] = [[], [f.key, f.key], [{ ...f.key, purpose: 'urn:other:purpose' }]];
  for (const patch of [
    { d: 'private' }, { kty: 'oct', k: 'secret' }, { crv: 'P-384' }, { alg: 'EdDSA' },
    { kid: 'different' }, { use: 'enc' }, { key_ops: ['sign'] }, { key_ops: ['verify','sign'] },
    { x: 'AA' }, { jku: 'https://untrusted.invalid/keys' },
  ]) variants.push([{ ...f.key, public_jwk: { ...f.key.public_jwk, ...patch } }]);
  for (const value of variants) assert.throws(() => new PinnedReceiptJoseVerifier(value), denied('RECEIPT_KEY_CONFIG_INVALID'));
});

test('RCG3-JOSE-HEADERS signed unknown remote-key and critical header fields deny', async () => {
  const f = await signingFixture();
  for (const extra of [{ jku: 'https://untrusted.invalid/keys' }, { jwk: f.key.public_jwk },
    { x5u: 'https://untrusted.invalid/cert' }, { x5c: [] }, { crit: ['extra'], extra: true },
    { b64: true }, { unrecognized: 'value' }]) {
    const token = f.signRawHeader(JSON.stringify({ ...f.header, ...extra }), '{"value":1}');
    await assert.rejects(f.verifier.verify(token, f.trust), denied('RECEIPT_HEADER_INVALID'));
  }
  for (const change of [{ typ: 'JWT' }, { alg: 'none' }, { alg: 'HS256' }, { alg: 'Ed25519' }]) {
    const token = f.signRawHeader(JSON.stringify({ ...f.header, ...change }), '{}');
    await assert.rejects(f.verifier.verify(token, f.trust), denied('RECEIPT_HEADER_INVALID'));
  }
});

test('RCG3-JOSE-HEADER-DUPLICATES valid signatures do not excuse raw or escaped duplicate names', async () => {
  const f = await signingFixture();
  for (const duplicate of ['"alg":"ES256"', '"\\u0061lg":"ES256"', '"kid":"'+f.key.key_id+'"']) {
    const header = JSON.stringify(f.header).slice(0,-1) + ',' + duplicate + '}';
    await assert.rejects(f.verifier.verify(f.signRawHeader(header, '{}'), f.trust), denied('RECEIPT_JSON_INVALID'));
  }
});

test('RCG3-JOSE-PAYLOAD-DUPLICATES reject authenticated duplicate fields at nested paths', async () => {
  const f = await signingFixture();
  for (const body of ['{"id":1,"id":2}', '{"outer":{"id":"a","\\u0069d":"b"}}',
    '{"array":[{"id":1,"id":2}]}'])
    await assert.rejects(f.verifier.verify(await f.signText(body), f.trust), denied('RECEIPT_JSON_INVALID'));
});

test('RCG3-JOSE-UTF8 authenticated invalid UTF8 BOM and unpaired Unicode deny', async () => {
  const f = await signingFixture();
  for (const body of [Uint8Array.from([0xc3,0x28]), Uint8Array.from([0xef,0xbb,0xbf,0x7b,0x7d])])
    await assert.rejects(f.verifier.verify(await f.signPayloadBytes(body), f.trust), denied('RECEIPT_JSON_INVALID'));
  for (const body of ['{"x":"\\ud800"}', '{"x":"\\udc00"}', '{"x":1e400}', '{"x":NaN}'])
    await assert.rejects(f.verifier.verify(await f.signText(body), f.trust), denied('RECEIPT_JSON_INVALID'));
});

test('RCG3-JOSE-JSON-VALID escaped strings arrays and distinct nested names retain exact values', async () => {
  const f = await signingFixture();
  const body = '{"a":{"id":1},"b":{"id":2},"strings":["a,{}:","quote\\\"slash\\\\","\\ud83d\\ude00"],"value":null}';
  const result = await f.verifier.verify(await f.signText(body), f.trust);
  assert.deepEqual(result.payload, JSON.parse(body));
});

test('RCG3-JOSE-BOUNDS token encoding and JSON nesting remain bounded', async () => {
  const f = await signingFixture(), token = await f.sign({ value: true }), parts = token.split('.');
  for (const malformed of ['', 'a.b', token+'.more', parts[0]+'=.'+parts[1]+'.'+parts[2],
    parts[0]+'..'+parts[2], 'a'.repeat(100001)])
    await assert.rejects(f.verifier.verify(malformed, f.trust), denied());
  const nested = '{"x":'.repeat(18) + '1' + '}'.repeat(18);
  await assert.rejects(f.verifier.verify(await f.signText(nested), f.trust), denied('RECEIPT_JSON_INVALID'));
  await assert.rejects(f.verifier.verify(f.signRawHeader(' '.repeat(2048)+JSON.stringify(f.header), '{}'), f.trust), denied('RECEIPT_JSON_INVALID'));
});

test('RCG3-JOSE-SNAPSHOTS caller mutation cannot change configured key or pending trust', async () => {
  const f = await signingFixture(), token = await f.sign({ value: 'original' });
  const mutableTrust = clone(f.trust), pending = f.verifier.verify(token, mutableTrust);
  (mutableTrust.trusted_key_ids as string[])[0] = 'replacement';
  (mutableTrust.issuer as any).id = 'replacement';
  (f.key.public_jwk as any).x = 'A'.repeat(43);
  const result = await pending;
  assert.equal(result.trusted_key.key_id, f.key.key_id);
  assert.deepEqual(result.payload, { value: 'original' });
  assert(Object.isFrozen(result.trusted_key.issuer));
});

test('RCG3-JOSE-RETIRE close rejects existing and in-flight key verification', async () => {
  for (const during of [false,true]) {
    const f = await signingFixture(), token = await f.sign({ value: 1 });
    if (!during) f.verifier.close();
    const pending = f.verifier.verify(token, f.trust);
    if (during) f.verifier.close();
    await assert.rejects(pending, denied('RECEIPT_TRUST_RETIRED'));
  }
});

test('RCG3-JOSE-CANCEL cancellation before or during import cannot return evidence', async () => {
  for (const during of [false,true]) {
    const f = await signingFixture(), token = await f.sign({ value: 1 }), abort = new AbortController();
    if (!during) abort.abort();
    const pending = f.verifier.verify(token, f.trust, abort.signal);
    if (during) abort.abort();
    await assert.rejects(pending, denied('RECEIPT_VERIFICATION_CANCELLED'));
  }
});
