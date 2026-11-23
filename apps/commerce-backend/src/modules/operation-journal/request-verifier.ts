import { createHash } from "node:crypto";
import { configure } from "safe-stable-stringify";
import { authorityAdapters } from "./authority-sender";

type Row = Record<string, any>;
type Parser = (bytes: Uint8Array, maximum?: number) => unknown;
const factory = Symbol("request-verifier-factory");
const stringify = configure({ strict: true, deterministic: true, bigint: false });
const digest = (value: string) => "sha256:" + createHash("sha256").update(value).digest("hex");
const deny = (code: string): never => { throw new Error("REQUEST_" + code); };
const ensure = (condition: unknown, code: string) => { if (!condition) deny(code); };
const uuid = /^(?!00000000-0000-0000-0000-000000000000$)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const text = (value: unknown, maximum = 1024): value is string => typeof value === "string" &&
  value.length > 0 && value.length <= maximum && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
function object(value: unknown, required: string[], optional: string[], code: string): Row {
  ensure(value && typeof value === "object" && !Array.isArray(value), code);
  const row = value as Row;
  ensure(required.every(key => Object.hasOwn(row, key)) &&
    Object.keys(row).every(key => required.includes(key) || optional.includes(key)), code);
  return row;
}
function segment(value: string, code: string) {
  ensure(/^[A-Za-z0-9_-]+$/.test(value), code);
  const bytes = Buffer.from(value, "base64url");
  ensure(bytes.toString("base64url") === value, code);
  return bytes;
}
const algorithms = ["ES256", "ES384", "EdDSA", "RS256"];
const selectedMetadata = { vp_formats_supported: {
  jwt_vc_json: { alg_values_supported: algorithms }, jwt_vp: { alg_values_supported: algorithms },
} };
function selectedQuery(value: unknown) {
  const query = object(value, ["credentials"], [], "TRUST_INVALID");
  ensure(Array.isArray(query.credentials) && query.credentials.length === 1, "TRUST_INVALID");
  const entry = object(query.credentials[0], ["id", "format", "meta", "require_cryptographic_holder_binding"], ["claims"], "TRUST_INVALID");
  ensure(typeof entry.id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(entry.id) &&
    entry.format === "jwt_vc_json" && entry.require_cryptographic_holder_binding === true &&
    (!Object.hasOwn(entry, "claims") || Array.isArray(entry.claims) && entry.claims.length === 0), "TRUST_INVALID");
  const meta = object(entry.meta, ["marty_securing_profile", "type_values"], [], "TRUST_INVALID");
  ensure(meta.marty_securing_profile === "marty_nested_vc2_jwt_v1" &&
    Array.isArray(meta.type_values) && meta.type_values.length > 0 && meta.type_values.length <= 64, "TRUST_INVALID");
  const sets = new Set<string>();
  for (const values of meta.type_values) {
    ensure(Array.isArray(values) && values.length > 0 && values.length <= 64 &&
      values.every(value => text(value, 2048)) && new Set(values).size === values.length, "TRUST_INVALID");
    const selected = values.filter(value => value !== "VerifiableCredential").sort();
    const identity = JSON.stringify(selected);
    ensure(selected.length > 0 && !sets.has(identity), "TRUST_INVALID"); sets.add(identity);
  }
}
function trustConfiguration(value: unknown) {
  const trust = object(value, ["profile", "provider_ref", "organization_id", "actor", "origin", "verifier_did",
    "client_id", "key_id", "key_purpose", "algorithm", "public_jwk", "dcql_query", "client_metadata", "max_lifetime_seconds"], [], "TRUST_INVALID");
  ensure(trust.profile === "urn:rifare:managed-authorization-request-trust:v1" &&
    text(trust.provider_ref, 100) && typeof trust.organization_id === "string" && uuid.test(trust.organization_id), "TRUST_INVALID");
  const actor = object(trust.actor, ["type", "id"], [], "TRUST_INVALID");
  ensure(actor.type === "MACHINE_IDENTITY" && text(actor.id, 256), "TRUST_INVALID");
  const origin = new URL(trust.origin);
  ensure(origin.protocol === "https:" && origin.origin === trust.origin && !origin.username && !origin.password &&
    text(trust.verifier_did) && /^did:(web|jwk|key):[^#?\s]+$/.test(trust.verifier_did) &&
    trust.client_id === "decentralized_identifier:" + trust.verifier_did &&
    text(trust.key_id) && trust.key_id.startsWith(trust.verifier_did + "#") &&
    trust.key_id.length > trust.verifier_did.length + 1 && trust.algorithm === "ES256" &&
    trust.key_purpose === "oid4vp_request_signing" && Number.isSafeInteger(trust.max_lifetime_seconds) &&
    trust.max_lifetime_seconds > 0 && trust.max_lifetime_seconds <= 900, "TRUST_INVALID");
  const key = object(trust.public_jwk, ["kty", "crv", "x", "y"], ["alg", "kid", "use", "key_ops", "ext"], "TRUST_INVALID");
  ensure(key.kty === "EC" && key.crv === "P-256" && typeof key.x === "string" && typeof key.y === "string" &&
    segment(key.x, "TRUST_INVALID").length === 32 && segment(key.y, "TRUST_INVALID").length === 32 &&
    (!Object.hasOwn(key, "alg") || key.alg === "ES256") && (!Object.hasOwn(key, "kid") || key.kid === trust.key_id) &&
    (!Object.hasOwn(key, "use") || key.use === "sig") && (!Object.hasOwn(key, "ext") || typeof key.ext === "boolean") &&
    (!Object.hasOwn(key, "key_ops") || JSON.stringify(key.key_ops) === '["verify"]'), "TRUST_INVALID");
  selectedQuery(trust.dcql_query);
  ensure(stringify(trust.client_metadata) === stringify(selectedMetadata), "TRUST_INVALID");
  return trust;
}

/** Internal factory: enrollment bytes must come from independently administered
 * server trust. Neither a request header nor an application customer supplies it. */
export async function createPinnedRequestVerifier(input: Uint8Array) {
  let detached: Buffer;
  try { ensure(input instanceof Uint8Array && input.byteLength > 0 && input.byteLength <= 32768, "TRUST_INVALID"); detached = Buffer.from(input); }
  catch { deny("TRUST_INVALID"); }
  const { request_json } = await authorityAdapters();
  try {
    const parse: Parser = request_json.strictReceiptJson;
    return new PinnedRequestVerifier(factory, parse, trustConfiguration(parse(detached!, 32768)));
  } catch { deny("TRUST_INVALID"); }
}

export class PinnedRequestVerifier {
  readonly #parse: Parser;
  readonly #trust: Row;
  readonly #trustDigest: string;
  readonly #results = new WeakMap<object, Readonly<Row>>();
  #closed = false;
  #pending = 0;
  #clockFloor = 0;
  constructor(token: symbol, parser: Parser, trust: Row) {
    ensure(token === factory, "TRUST_INVALID");
    this.#parse = parser; this.#trust = trust; this.#trustDigest = digest(stringify(trust)!);
  }
  close() { this.#closed = true; }
  #active() { if (this.#closed) deny("TRUST_RETIRED"); }
  describe(handle: unknown): Readonly<Row> {
    this.#active();
    const result = handle && typeof handle === "object" ? this.#results.get(handle) : undefined;
    if (!result) deny("HANDLE_INVALID");
    return result;
  }
  async verify(input: Uint8Array, binding: Uint8Array, now: number): Promise<object> {
    this.#active(); ensure(this.#pending < 32, "CAPACITY");
    this.#pending++;
    try {
      ensure(input instanceof Uint8Array && input.byteLength > 0 && input.byteLength <= 65536 &&
        binding instanceof Uint8Array && binding.byteLength > 0 && binding.byteLength <= 4096, "CONTEXT_INVALID");
      const compact = Buffer.from(input).toString("ascii"), contextBytes = Buffer.from(binding);
      ensure(Buffer.from(compact, "ascii").equals(Buffer.from(input)), "HEADER_INVALID");
      ensure(Number.isSafeInteger(now) && now >= this.#clockFloor, "TIME_INVALID"); this.#clockFloor = now;
      let context: Row;
      try { context = object(this.#parse(contextBytes, 4096), ["provider_ref", "organization_id", "actor", "challenge_id", "created_at", "expires_at"], [], "CONTEXT_INVALID"); }
      catch { deny("CONTEXT_INVALID"); }
      const trust = this.#trust;
      ensure(context!.provider_ref === trust.provider_ref && context!.organization_id === trust.organization_id &&
        stringify(context!.actor) === stringify(trust.actor) && typeof context!.challenge_id === "string" && uuid.test(context!.challenge_id), "CONTEXT_INVALID");
      const parts = compact.split("."); ensure(parts.length === 3 && parts.every(Boolean), "HEADER_INVALID");
      const protectedBytes = segment(parts[0], "HEADER_INVALID"), payloadBytes = segment(parts[1], "HEADER_INVALID");
      ensure(protectedBytes.length <= 2048 && segment(parts[2], "SIGNATURE_INVALID").length === 64, "HEADER_INVALID");
      let header: Row;
      try { header = this.#parse(protectedBytes, 2048) as Row; this.#parse(payloadBytes, 65536); }
      catch { deny("JSON_INVALID"); }
      object(header!, ["alg", "kid", "typ"], [], "HEADER_INVALID");
      ensure(header!.alg === "ES256" && header!.kid === trust.key_id && header!.typ === "oauth-authz-req+jwt", "HEADER_INVALID");
      const jose = await import("jose"); this.#active();
      let authenticated: Uint8Array;
      try {
        const key = await jose.importJWK(trust.public_jwk, "ES256"); this.#active();
        // C7 signature-verification targeted-fault boundary.
        authenticated = (await jose.compactVerify(compact, key, { algorithms: ["ES256"] })).payload;
      } catch (error) {
        this.#active(); deny("SIGNATURE_INVALID");
      }
      this.#active();
      let payload: Row;
      try { payload = this.#parse(authenticated!, 65536) as Row; } catch { deny("JSON_INVALID"); }
      object(payload!, ["aud", "client_id", "exp", "iat", "iss", "nonce", "response_mode", "response_type", "response_uri", "state", "dcql_query", "client_metadata"], [], "CONTEXT_INVALID");
      ensure(payload!.aud === "https://self-issued.me/v2" && payload!.iss === trust.client_id &&
        payload!.client_id === trust.client_id && payload!.state === context!.challenge_id &&
        payload!.response_uri === trust.origin + "/v1/flows/instances/" + context!.challenge_id + "/submit" &&
        payload!.response_mode === "direct_post" && payload!.response_type === "vp_token" && text(payload!.nonce) &&
        stringify(payload!.dcql_query) === stringify(trust.dcql_query) &&
        stringify(payload!.client_metadata) === stringify(trust.client_metadata), "CONTEXT_INVALID");
      const created = Date.parse(context!.created_at), expires = Date.parse(context!.expires_at), seconds = Math.floor(now / 1000);
      ensure(typeof context!.created_at === "string" && typeof context!.expires_at === "string" &&
        /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(context!.created_at) &&
        /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(context!.expires_at) &&
        Number.isFinite(created) && Number.isFinite(expires) && created <= now && now < expires &&
        Number.isSafeInteger(payload!.iat) && Number.isSafeInteger(payload!.exp) && payload!.iat >= Math.floor(created / 1000) &&
        payload!.iat <= seconds && payload!.exp > seconds && payload!.exp > payload!.iat &&
        payload!.exp <= Math.floor(expires / 1000) && payload!.exp - payload!.iat <= trust.max_lifetime_seconds, "TIME_INVALID");
      const result = Object.freeze({ compact_jws: compact, digest: digest(compact), nonce: payload!.nonce,
        challenge_id: context!.challenge_id, client_id: trust.client_id, key_id: trust.key_id,
        verification_context_digest: digest(stringify({ trust_digest: this.#trustDigest, context: context! })!),
        trust_digest: this.#trustDigest, observed_at: now, issued_at: payload!.iat, expires_at: payload!.exp,
        execution_authorized: false, presentation_verified: false });
      const handle = Object.freeze(Object.create(null)); this.#results.set(handle, result); return handle;
    } finally { this.#pending--; }
  }
}
