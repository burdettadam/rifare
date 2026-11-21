import { compactVerify, importJWK, type JWK } from 'jose';
import { checkoutSnapshot } from '../../commerce/checkout-preview.mts';
import { JWS_TYP, JWS_PURPOSE, ReceiptBindingDenied } from '../../commerce/delegated-receipt-binding.mts';
import type { CryptographicallyVerifiedReceipt, ReceiptTrustPolicy, SignedKey,
  TrustedReceiptJoseVerifier } from '../../commerce/delegated-receipt-binding.mts';
import { strictReceiptJson } from './strict-json.mts';

export type ReceiptVerificationKey = Readonly<SignedKey & { public_jwk: Readonly<JWK> }>;
function fail(code: string): never { throw new ReceiptBindingDenied(code); }
const ensure = (value: unknown, code: string): void => { if (!value) fail(code); };
const object = (value: unknown, fields: readonly string[], optional: readonly string[] = []): Record<string, unknown> => {
  ensure(value && typeof value === 'object' && !Array.isArray(value), 'RECEIPT_KEY_CONFIG_INVALID');
  const data = value as Record<string, unknown>;
  ensure(fields.every(key => Object.hasOwn(data, key)) &&
    Object.keys(data).every(key => fields.includes(key) || optional.includes(key)), 'RECEIPT_KEY_CONFIG_INVALID');
  return data;
};
function segment(value: string): Uint8Array {
  ensure(/^[A-Za-z0-9_-]+$/.test(value), 'RECEIPT_COMPACT_INVALID');
  const bytes = Buffer.from(value, 'base64url');
  ensure(bytes.toString('base64url') === value, 'RECEIPT_COMPACT_INVALID');
  return bytes;
}

/** Optional local verifier. Public keys and signer purpose come exclusively from
 * trusted server configuration. No URL resolver, provider HTTP, signer or key
 * generation is installed by this adapter. Rotate by replacing and closing it. */
export class PinnedReceiptJoseVerifier implements TrustedReceiptJoseVerifier {
  readonly #keys: readonly ReceiptVerificationKey[];
  #closed = false;
  #pending = 0;

  constructor(input: readonly ReceiptVerificationKey[]) {
    try {
      const keys = checkoutSnapshot(input);
      ensure(Array.isArray(keys) && keys.length > 0 && keys.length <= 64, 'RECEIPT_KEY_CONFIG_INVALID');
      const identities = new Set<string>();
      for (const entry of keys) {
        object(entry, ['issuer','purpose','key_id','algorithm','public_jwk']);
        object(entry.issuer, ['type','id']);
        ensure(['USER','ORGANIZATION','SERVICE_ACCOUNT','MACHINE_IDENTITY','EXTERNAL'].includes(entry.issuer.type) &&
          typeof entry.issuer.id === 'string' && entry.issuer.id.length > 0 && entry.issuer.id.length <= 1024 &&
          typeof entry.key_id === 'string' && entry.key_id.length > 0 && entry.key_id.length <= 512 &&
          entry.purpose === JWS_PURPOSE && ['ES256','EdDSA'].includes(entry.algorithm), 'RECEIPT_KEY_CONFIG_INVALID');
        const identity = JSON.stringify([entry.issuer.type,entry.issuer.id,entry.purpose,entry.key_id]);
        ensure(!identities.has(identity), 'RECEIPT_KEY_CONFIG_INVALID'); identities.add(identity);
        const jwk = object(entry.public_jwk, entry.algorithm === 'ES256' ? ['kty','crv','x','y'] : ['kty','crv','x'],
          ['alg','kid','use','key_ops','ext']);
        ensure(jwk.kty === (entry.algorithm === 'ES256' ? 'EC' : 'OKP') &&
          jwk.crv === (entry.algorithm === 'ES256' ? 'P-256' : 'Ed25519') &&
          (!Object.hasOwn(jwk,'alg') || jwk.alg === entry.algorithm) &&
          (!Object.hasOwn(jwk,'kid') || jwk.kid === entry.key_id) &&
          (!Object.hasOwn(jwk,'use') || jwk.use === 'sig') &&
          (!Object.hasOwn(jwk,'ext') || typeof jwk.ext === 'boolean') &&
          (!Object.hasOwn(jwk,'key_ops') || (Array.isArray(jwk.key_ops) &&
            jwk.key_ops.length === 1 && jwk.key_ops[0] === 'verify')), 'RECEIPT_KEY_CONFIG_INVALID');
        for (const name of entry.algorithm === 'ES256' ? ['x','y'] : ['x']) {
          ensure(typeof jwk[name] === 'string' && segment(jwk[name] as string).length === 32,
            'RECEIPT_KEY_CONFIG_INVALID');
        }
      }
      this.#keys = keys;
    } catch { fail('RECEIPT_KEY_CONFIG_INVALID'); }
  }

  assertCurrent(): void { if (this.#closed) fail('RECEIPT_TRUST_RETIRED'); }
  close(): void { this.#closed = true; }
  #active(signal?: AbortSignal): void {
    this.assertCurrent();
    if (signal?.aborted) fail('RECEIPT_VERIFICATION_CANCELLED');
  }

  async verify(compactJws: string, input: ReceiptTrustPolicy, signal?: AbortSignal): Promise<CryptographicallyVerifiedReceipt> {
    this.#active(signal);
    ensure(this.#pending < 32, 'RECEIPT_VERIFICATION_CAPACITY');
    this.#pending++;
    try {
      ensure(typeof compactJws === 'string' && compactJws.length <= 100_000, 'RECEIPT_COMPACT_INVALID');
      const parts = compactJws.split('.');
      ensure(parts.length === 3 && parts.every(Boolean), 'RECEIPT_COMPACT_INVALID');
      const headerBytes = segment(parts[0]); segment(parts[1]);
      ensure(segment(parts[2]).length === 64, 'RECEIPT_SIGNATURE_INVALID');
      const header = strictReceiptJson(headerBytes, 2048) as Record<string, unknown>;
      ensure(header && typeof header === 'object' && !Array.isArray(header) &&
        Object.keys(header).sort().join(',') === 'alg,kid,typ' && header.typ === JWS_TYP &&
        (header.alg === 'ES256' || header.alg === 'EdDSA') && typeof header.kid === 'string',
        'RECEIPT_HEADER_INVALID');
      const trust = checkoutSnapshot(input);
      object(trust, ['issuer','organization_id','allowed_algorithms','trusted_key_ids']);
      object(trust.issuer, ['type','id']);
      ensure(Array.isArray(trust.allowed_algorithms) && Array.isArray(trust.trusted_key_ids) &&
        trust.allowed_algorithms.includes(header.alg as 'ES256'|'EdDSA') &&
        trust.trusted_key_ids.includes(header.kid as string), 'RECEIPT_KEY_UNTRUSTED');
      const entry = this.#keys.find(key => key.key_id === header.kid && key.algorithm === header.alg &&
        key.issuer.type === trust.issuer.type && key.issuer.id === trust.issuer.id && key.purpose === JWS_PURPOSE);
      ensure(entry, 'RECEIPT_KEY_UNTRUSTED');
      const selected = entry!;
      const key = await importJWK(selected.public_jwk, selected.algorithm);
      this.#active(signal);
      const verified = await compactVerify(compactJws, key, { algorithms: [selected.algorithm] });
      this.#active(signal);
      // Decode only the bytes authenticated by jose; no caller-supplied payload.
      const payload = strictReceiptJson(verified.payload);
      const result = checkoutSnapshot({
        protected_header: { typ: JWS_TYP, alg: selected.algorithm, kid: selected.key_id },
        trusted_key: { issuer: selected.issuer, purpose: selected.purpose,
          key_id: selected.key_id, algorithm: selected.algorithm }, payload,
      });
      this.#active(signal);
      return result;
    } catch (error) {
      if (error instanceof ReceiptBindingDenied) throw error;
      fail('RECEIPT_SIGNATURE_INVALID');
    } finally { this.#pending--; }
  }
}
