import { createHash } from "node:crypto";
import { configure } from "safe-stable-stringify";
import { authorityAdapters, receiptJoseAdapter } from "./authority-assets";

type Row = Record<string, any>;
type Parser = (bytes: Uint8Array, maximum?: number) => unknown;
const factory = Symbol("native-receipt-verifier");
const stringify = configure({ strict: true, deterministic: true, bigint: false });
const digest = (value: string) => "sha256:" + createHash("sha256").update(value).digest("hex");
const sha = /^sha256:[0-9a-f]{64}$/;
const uuid = /^(?!00000000-0000-0000-0000-000000000000$)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isUuid = (value: unknown): value is string => typeof value === "string" && uuid.test(value);
const isDigest = (value: unknown): value is string => typeof value === "string" && sha.test(value);
const denied = (code: string): never => { throw new Error("NATIVE_RECEIPT_" + code); };
const requireValue = (value: unknown, code: string) => { if (!value) denied(code); };
const text = (value: unknown, max = 1024): value is string => typeof value === "string" &&
  value.length > 0 && value.length <= max && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
const principalTypes = ["USER", "ORGANIZATION", "SERVICE_ACCOUNT", "MACHINE_IDENTITY", "EXTERNAL"];
const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")!.get!;

function object(value: unknown, fields: string[], code: string): Row {
  requireValue(value && typeof value === "object" && !Array.isArray(value), code);
  const row = value as Row;
  requireValue(Object.keys(row).length === fields.length && fields.every(key => Object.hasOwn(row, key)), code);
  return row;
}
function principal(value: unknown, code: string) {
  const row = object(value, ["type", "id"], code);
  requireValue(principalTypes.includes(row.type) && text(row.id), code); return row;
}
function same(left: unknown, right: unknown, code: string) { requireValue(stringify(left) === stringify(right), code); }
function grant(value: unknown, code: string) {
  const row = object(value, ["id", "revision", "terms_digest"], code);
  requireValue(isUuid(row.id) && Number.isSafeInteger(row.revision) && row.revision > 0 && isDigest(row.terms_digest), code);
}
function policy(value: unknown, code: string) {
  const row = object(value, ["id", "version_digest"], code);
  requireValue(text(row.id) && isDigest(row.version_digest), code);
}
function amount(value: unknown, code: string): bigint {
  requireValue(typeof value === "string" && /^(0|[1-9][0-9]{0,18})$/.test(value), code);
  const result = BigInt(value as string); requireValue(result <= 9223372036854775807n, code); return result;
}
function trustConfiguration(value: unknown) {
  const code = "TRUST_INVALID";
  const trust = object(value, ["profile", "provider_ref", "organization_id", "actor", "issuer", "subject",
    "status_issuer", "binding", "policy", "delegated_ceiling", "key"], code);
  requireValue(trust.profile === "urn:rifare:native-delegated-receipt-trust:v1" && text(trust.provider_ref, 100) &&
    isUuid(trust.organization_id) && principal(trust.actor, code).type === "MACHINE_IDENTITY", code);
  principal(trust.issuer, code); principal(trust.subject, code); principal(trust.status_issuer, code);
  const binding = object(trust.binding, ["method", "key_thumbprint"], code);
  requireValue(binding.method === "KEY" && isDigest(binding.key_thumbprint), code); policy(trust.policy, code);
  const ceiling = object(trust.delegated_ceiling, ["currency", "maximum_minor"], code);
  requireValue(typeof ceiling.currency === "string" && /^[a-z]{3}$/.test(ceiling.currency), code);
  amount(ceiling.maximum_minor, code);
  const key = object(trust.key, ["issuer", "purpose", "key_id", "algorithm", "public_jwk"], code);
  same(key.issuer, trust.issuer, code);
  // The concrete reused JOSE adapter owns key/algorithm/purpose validation.
  return trust;
}
function contextConfiguration(value: unknown, trust: Row) {
  const code = "CONTEXT_INVALID";
  const context = object(value, ["provider_ref", "organization_id", "actor", "original_command_id", "grant", "operation",
    "cart_id", "store_id", "challenge_id", "nonce", "authorization_request_digest", "authorization_context_digest",
    "currency", "currency_exponent", "payable_minor_units"], code);
  requireValue(context.provider_ref === trust.provider_ref && context.organization_id === trust.organization_id &&
    isUuid(context.original_command_id) && isUuid(context.challenge_id) && text(context.nonce) &&
    isDigest(context.authorization_request_digest) && isDigest(context.authorization_context_digest) &&
    text(context.cart_id, 96) && text(context.store_id, 96), code);
  same(context.actor, trust.actor, code); grant(context.grant, code);
  const operation = object(context.operation, ["action", "audience", "resource_id", "request_profile", "request_digest"], code);
  requireValue(operation.action === "urn:rifare:action:purchase:v1" && operation.audience === "urn:rifare:store:" + context.store_id &&
    operation.resource_id === "urn:rifare:cart:" + context.cart_id &&
    operation.request_profile === "urn:rifare:medusa-original-operation:v1" && isDigest(operation.request_digest), code);
  requireValue(context.currency === trust.delegated_ceiling.currency && Number.isSafeInteger(context.currency_exponent) &&
    context.currency_exponent >= 0 && context.currency_exponent <= 4 &&
    amount(context.payable_minor_units, code) <= amount(trust.delegated_ceiling.maximum_minor, code), code);
  return context;
}

/** Independently administered server trust only. No request-directed key lookup. */
export async function createNativeReceiptVerifier(input: Uint8Array): Promise<NativeReceiptVerifier> {
  requireValue(input instanceof Uint8Array && input.byteLength > 0 && input.byteLength <= 32768, "TRUST_INVALID");
  const detached = Buffer.from(input);
  const { request_json, request_time } = await authorityAdapters();
  const receipt_jose = await receiptJoseAdapter();
  try {
    const trust = trustConfiguration(request_json.strictReceiptJson(detached, 32768));
    const jose = new receipt_jose.PinnedReceiptJoseVerifier([trust.key]);
    return new NativeReceiptVerifier(factory, request_json.strictReceiptJson, request_time.receiptTimestampNs,
      trust, jose.verify.bind(jose), jose.assertCurrent.bind(jose), jose.close.bind(jose));
  } catch { return denied("TRUST_INVALID"); }
}

/** Native claim binding, separate from the preserved legacy preview binder.
 * Its result remains evidence, with no live revocation or execution authority. */
export class NativeReceiptVerifier {
  readonly #results = new WeakMap<object, Readonly<Row>>();
  #closed = false;
  #pending = 0;
  #clockFloor = 0;
  readonly #parse: Parser;
  readonly #timestamp: (value: string) => bigint;
  readonly #trust: Row;
  readonly #verifyJose: (compact: string, trust: any, signal?: AbortSignal) => Promise<any>;
  readonly #currentJose: () => void;
  readonly #closeJose: () => void;
  constructor(token: symbol, parse: Parser, timestamp: (value: string) => bigint,
    trust: Row, verifyJose: (compact: string, trust: any, signal?: AbortSignal) => Promise<any>,
    currentJose: () => void, closeJose: () => void) {
    requireValue(token === factory, "TRUST_INVALID");
    this.#parse = parse; this.#timestamp = timestamp; this.#trust = trust;
    this.#verifyJose = verifyJose; this.#currentJose = currentJose; this.#closeJose = closeJose;
  }
  close() { this.#closed = true; this.#closeJose(); }
  #active(signal?: AbortSignal) {
    requireValue(!this.#closed, "UNAVAILABLE"); this.#currentJose();
    requireValue(!signal || !aborted.call(signal), "CANCELLED");
  }
  describe(handle: unknown): Readonly<Row> {
    this.#active(); const result = handle && typeof handle === "object" ? this.#results.get(handle) : undefined;
    requireValue(result, "RESULT_INVALID"); return result!;
  }
  async verify(input: Uint8Array, binding: Uint8Array, now: number, signal?: AbortSignal): Promise<object> {
    this.#active(signal); requireValue(this.#pending < 32, "CAPACITY"); this.#pending++;
    try {
      requireValue(input instanceof Uint8Array && input.byteLength > 0 && input.byteLength <= 100000 &&
        binding instanceof Uint8Array && binding.byteLength > 0 && binding.byteLength <= 8192, "CONTEXT_INVALID");
      const compact = Buffer.from(input).toString("ascii");
      requireValue(Buffer.from(compact, "ascii").equals(Buffer.from(input)), "SIGNATURE_INVALID");
      const context = contextConfiguration(this.#parse(Buffer.from(binding), 8192), this.#trust);
      requireValue(Number.isSafeInteger(now) && now >= this.#clockFloor, "TIME_INVALID"); this.#clockFloor = now;
      const started = performance.now();
      const verified = await this.#verifyJose(compact, { issuer: this.#trust.issuer,
        organization_id: this.#trust.organization_id, allowed_algorithms: [this.#trust.key.algorithm],
        trusted_key_ids: [this.#trust.key.key_id] }, signal);
      this.#active(signal);
      const elapsed = performance.now() - started;
      requireValue(Number.isFinite(elapsed) && elapsed >= 0 && elapsed < 5000, "TIME_INVALID");
      const payload = object(verified.payload, ["profile", "id", "issuer", "decision", "evaluation", "policy", "issued_at", "expires_at"], "FIELDS_INVALID");
      requireValue(payload.profile === "urn:marty:delegated-decision-receipt:v1" && isUuid(payload.id) && payload.decision === "PERMIT", "FIELDS_INVALID");
      same(payload.issuer, this.#trust.issuer, "ISSUER_MISMATCH"); same(payload.policy, this.#trust.policy, "POLICY_MISMATCH");
      const evaluation = object(payload.evaluation, ["profile", "organization_id", "grant", "actor", "subject", "binding", "operation",
        "approval_evidence_ref", "authority_evidence_ref", "proof_evidence_ref", "challenge", "proof_verified_at", "proof_valid_until", "status", "evaluated_at"], "FIELDS_INVALID");
      requireValue(evaluation.profile === "urn:marty:delegated-evaluation:v1" &&
        evaluation.organization_id === this.#trust.organization_id, "ORGANIZATION_MISMATCH");
      same(evaluation.grant, context.grant, "GRANT_MISMATCH"); same(evaluation.actor, this.#trust.actor, "ACTOR_MISMATCH");
      same(evaluation.subject, this.#trust.subject, "SUBJECT_MISMATCH"); same(evaluation.binding, this.#trust.binding, "BINDING_MISMATCH");
      same(evaluation.operation, context.operation, "OPERATION_MISMATCH");
      requireValue(evaluation.challenge === context.nonce, "NONCE_MISMATCH");
      for (const key of ["approval_evidence_ref", "authority_evidence_ref", "proof_evidence_ref"]) requireValue(text(evaluation[key]), "FIELDS_INVALID");
      const status = object(evaluation.status, ["issuer", "grant", "state", "checked_at", "valid_until", "evidence_ref"], "FIELDS_INVALID");
      same(status.issuer, this.#trust.status_issuer, "STATUS_MISMATCH"); same(status.grant, context.grant, "STATUS_MISMATCH");
      requireValue(status.state === "ACTIVE" && text(status.evidence_ref), "STATUS_MISMATCH");
      const issued = this.#timestamp(payload.issued_at), expires = this.#timestamp(payload.expires_at),
        proofAt = this.#timestamp(evaluation.proof_verified_at), proofUntil = this.#timestamp(evaluation.proof_valid_until),
        statusAt = this.#timestamp(status.checked_at), statusUntil = this.#timestamp(status.valid_until),
        evaluated = this.#timestamp(evaluation.evaluated_at), observed = BigInt(now) * 1000000n;
      requireValue(proofAt <= evaluated && statusAt <= evaluated && evaluated <= issued && issued <= observed && observed < expires &&
        expires <= proofUntil && expires <= statusUntil && observed < proofUntil && observed < statusUntil &&
        expires - issued <= 600000000000n, "TIME_INVALID");
      this.#active(signal);
      const result = Object.freeze({ compact_jws: compact, digest: digest(compact), receipt_id: payload.id,
        verification_context_digest: digest(stringify({ trust: this.#trust, context })!),
        observed_at: now, expires_at: payload.expires_at, nonce: context.nonce,
        original_command_id: context.original_command_id, operation_digest: context.operation.request_digest,
        execution_authorized: false, live_status_verified: false });
      const handle = Object.freeze(Object.create(null)); this.#results.set(handle, result); return handle;
    } catch (error) {
      if (error instanceof Error && /^NATIVE_RECEIPT_[A-Z_]+$/.test(error.message)) throw error;
      return denied("VERIFICATION_FAILED");
    } finally { this.#pending--; }
  }
}
