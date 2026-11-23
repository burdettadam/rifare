import { createHash } from "node:crypto";
import { configure } from "safe-stable-stringify";
import { authorityAdapters } from "./authority-assets";

type Row = Record<string, any>;
type Parser = (bytes: Uint8Array, maximum?: number) => unknown;
const factory = Symbol("prepared-native-proof-association");
const canonical = configure({ strict: true, deterministic: true, bigint: false });
const hash = (value: string | Uint8Array) => "sha256:" + createHash("sha256").update(value).digest("hex");
const uuid = /^(?!00000000-0000-0000-0000-000000000000$)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isUuid = (value: unknown) => typeof value === "string" && uuid.test(value);
const isDigest = (value: unknown) => typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
const denied = (): never => { throw new Error("PROOF_ASSOCIATION_UNAVAILABLE"); };
const requireValue = (value: unknown) => { if (!value) denied(); };
function object(value: unknown, fields: string[]): Row {
  requireValue(value && typeof value === "object" && !Array.isArray(value));
  const row = value as Row;
  requireValue(Object.keys(row).length === fields.length && fields.every(field => Object.hasOwn(row, field))); return row;
}

/** Pure wire preparation. The context must later come from the actual native C7
 * owner. This codec does not verify a request, presentation or permission. */
export async function prepareProofAssociation(context: Uint8Array, compactProof: Uint8Array): Promise<PreparedProofAssociation> {
  let capturedContext: Buffer | undefined, proof: Buffer | undefined;
  try {
    requireValue(context instanceof Uint8Array && context.byteLength > 0 && context.byteLength <= 4096 &&
      compactProof instanceof Uint8Array && compactProof.byteLength > 0 && compactProof.byteLength <= 262144);
    capturedContext = Buffer.from(context); proof = Buffer.from(compactProof);
    const { request_json, request_time } = await authorityAdapters();
    const selected = object(request_json.strictReceiptJson(capturedContext, 4096), ["profile", "origin", "original_command_id", "challenge_id",
      "created_at", "expires_at", "query_id", "nonce", "request_digest", "request_context_digest"]);
    requireValue(selected.profile === "urn:rifare:native-proof-context:v1" && isUuid(selected.original_command_id) && isUuid(selected.challenge_id) &&
      typeof selected.query_id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(selected.query_id) &&
      typeof selected.nonce === "string" && selected.nonce.length > 0 && selected.nonce.length <= 1024 &&
      selected.nonce.trim() === selected.nonce && !/[\u0000-\u001f\u007f]/.test(selected.nonce) &&
      isDigest(selected.request_digest) && isDigest(selected.request_context_digest));
    requireValue(typeof selected.origin === "string" && selected.origin.length <= 1024);
    const origin = new URL(selected.origin);
    requireValue(origin.protocol === "https:" && origin.origin === selected.origin && !origin.username && !origin.password);
    const created = request_time.receiptTimestampNs(selected.created_at), expires = request_time.receiptTimestampNs(selected.expires_at);
    requireValue(created < expires);
    const compact = proof.toString("ascii");
    requireValue(Buffer.from(compact, "ascii").equals(proof) && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(compact));
    const form = Buffer.from(new URLSearchParams({ state: selected.challenge_id, vp_token: JSON.stringify({ [selected.query_id]: [compact] }) }).toString());
    requireValue(form.byteLength <= 786432);
    return new PreparedProofAssociation(factory, form, hash(proof), selected, hash(canonical(selected)!),
      request_json.strictReceiptJson, request_time.receiptTimestampNs);
  } catch { return denied(); }
  finally { proof?.fill(0); capturedContext?.fill(0); }
}

/** Private raw form storage avoids accidental JSON/inspection enumeration.
 * close releases our buffer; it cannot erase caller copies or runtime memory. */
export class PreparedProofAssociation {
  readonly #form: Buffer;
  readonly #proofDigest: string;
  readonly #context: Row;
  readonly #contextDigest: string;
  readonly #parse: Parser;
  readonly #timestamp: (value: string) => bigint;
  #closed = false;
  constructor(token: symbol, form: Buffer, proofDigest: string, context: Row, contextDigest: string,
    parser: Parser, timestamp: (value: string) => bigint) {
    requireValue(token === factory); this.#form = form; this.#proofDigest = proofDigest; this.#context = context;
    this.#contextDigest = contextDigest; this.#parse = parser; this.#timestamp = timestamp; Object.freeze(this);
  }
  #active() { requireValue(!this.#closed); }
  close() { this.#closed = true; this.#form.fill(0); }
  formBytes(): Buffer { this.#active(); return Buffer.from(this.#form); }
  describe() {
    this.#active();
    return Object.freeze({ original_command_id: this.#context.original_command_id, challenge_id: this.#context.challenge_id,
      response_uri: this.#context.origin + "/v1/flows/instances/" + this.#context.challenge_id + "/submit",
      query_id: this.#context.query_id, proof_digest: this.#proofDigest, context_digest: this.#contextDigest,
      presentation_verified: false, execution_authorized: false });
  }
  bindSubmission(input: Uint8Array) {
    this.#active(); requireValue(input instanceof Uint8Array && input.byteLength > 0 && input.byteLength <= 4096);
    try {
      const result = object(this.#parse(Buffer.from(input), 4096), ["submission_id", "challenge_id", "proof_digest", "received_at", "recovered"]);
      requireValue(isUuid(result.submission_id) && result.challenge_id === this.#context.challenge_id &&
        result.proof_digest === this.#proofDigest && typeof result.recovered === "boolean");
      const received = this.#timestamp(result.received_at);
      requireValue(this.#timestamp(this.#context.created_at) <= received && received < this.#timestamp(this.#context.expires_at));
      const semantic = { submission_id: result.submission_id, challenge_id: result.challenge_id,
        proof_digest: result.proof_digest, received_at: result.received_at };
      return Object.freeze({ ...semantic, semantic_digest: hash(canonical(semantic)!), recovered: result.recovered,
        original_command_id: this.#context.original_command_id, context_digest: this.#contextDigest,
        presentation_verified: false, execution_authorized: false });
    } catch { return denied(); }
  }
}
