/** Test-only ephemeral signing; no private key or upstream vector enters source exports. */
import { createRequire } from 'node:module';
import { createHash, KeyObject, sign as signBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { contentDigest, canonical } from '../../packages/commerce/configuration-values.mts';
import { JWS_TYP, JWS_PURPOSE } from '../../packages/commerce/delegated-receipt-binding.mts';
import type { ReceiptTrustPolicy } from '../../packages/commerce/delegated-receipt-binding.mts';
import { PinnedReceiptJoseVerifier } from '../../packages/adapters/delegated-receipts/jose-verifier.mts';
import type { ReceiptVerificationKey } from '../../packages/adapters/delegated-receipts/jose-verifier.mts';

const requireReceipt = createRequire(new URL('../../packages/adapters/delegated-receipts/package.json', import.meta.url));
const jose = await import(requireReceipt.resolve('jose'));
export const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
export const organization = '11111111-2222-4333-8444-555555555555';
export const syntheticIssuer = { type: 'SERVICE_ACCOUNT' as const, id: 'urn:rifare:synthetic:receipt-issuer' };

export async function signingFixture(algorithm: 'ES256'|'EdDSA' = 'ES256') {
  const pair = await jose.generateKeyPair(algorithm, { extractable: true });
  const key: ReceiptVerificationKey = { issuer: syntheticIssuer, purpose: JWS_PURPOSE,
    key_id: 'synthetic-' + algorithm, algorithm, public_jwk: await jose.exportJWK(pair.publicKey) };
  const trust: ReceiptTrustPolicy = { issuer: syntheticIssuer, organization_id: organization,
    allowed_algorithms: [algorithm], trusted_key_ids: [key.key_id] };
  const header = { typ: JWS_TYP, alg: algorithm, kid: key.key_id };
  const verifier = new PinnedReceiptJoseVerifier([key]);
  const sign = (payload: unknown, protectedHeader: any = header) =>
    new jose.CompactSign(new TextEncoder().encode(JSON.stringify(payload))).setProtectedHeader(protectedHeader).sign(pair.privateKey);
  const signText = (payload: string, protectedHeader: any = header) =>
    new jose.CompactSign(new TextEncoder().encode(payload)).setProtectedHeader(protectedHeader).sign(pair.privateKey);
  const signPayloadBytes = (payload: Uint8Array) =>
    new jose.CompactSign(payload).setProtectedHeader(header).sign(pair.privateKey);
  // Malformed/duplicate protected-header negatives require original raw JSON.
  // Node's maintained crypto API signs those test bytes; no primitive is implemented.
  const signRawHeader = (rawHeader: string, payload: string) => {
    const encoded = Buffer.from(rawHeader).toString('base64url') + '.' + Buffer.from(payload).toString('base64url');
    const signature = signBytes(algorithm === 'ES256' ? 'sha256' : null, Buffer.from(encoded),
      { key: KeyObject.from(pair.privateKey), dsaEncoding: 'ieee-p1363' });
    return encoded + '.' + signature.toString('base64url');
  };
  return { key, trust, header, verifier, sign, signText, signPayloadBytes, signRawHeader };
}

export function publishedVector(algorithm: 'ES256'|'EdDSA') {
  const source = JSON.parse(readFileSync(new URL('../fixtures/delegated-receipts/provider-source.v1.json', import.meta.url), 'utf8'));
  const bytes = readFileSync(new URL('../../' + source.local_fixture, import.meta.url));
  if (createHash('sha256').update(bytes).digest('hex') !== source.sha256) throw new Error('RECEIPT_VECTOR_SOURCE_MISMATCH');
  const vector = JSON.parse(bytes.toString('utf8')), entry = vector.vectors[algorithm];
  // Upstream assembly uses sorted-key compact UTF-8 JSON. For this fixed vector,
  // native canonical JSON produces exactly those bytes; signatures prove parity.
  const payload = Buffer.from(canonical(vector.payload)).toString('base64url');
  const token = entry.protected_header_segment + '.' + payload + '.' + entry.signature_segment;
  const key: ReceiptVerificationKey = { issuer: vector.payload.issuer, purpose: JWS_PURPOSE,
    key_id: entry.kid, algorithm, public_jwk: entry.public_jwk };
  const trust: ReceiptTrustPolicy = { issuer: key.issuer, organization_id: vector.payload.evaluation.organization_id,
    allowed_algorithms: [algorithm], trusted_key_ids: [key.key_id] };
  return { token, key, trust, payload: vector.payload, source, contentDigest };
}
