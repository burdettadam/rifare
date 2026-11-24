import test from 'node:test';
import assert from 'node:assert/strict';
import { PinnedReceiptJoseVerifier } from '../../packages/adapters/delegated-receipts/jose-verifier.mts';
import { ReceiptBindingDenied } from '../../packages/commerce/delegated-receipt-binding.mts';
import { publishedVector } from '../development/receipt-signature-helpers.mts';

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
