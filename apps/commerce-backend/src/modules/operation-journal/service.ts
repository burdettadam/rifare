import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { ModulesSdkUtils } from "@medusajs/framework/utils";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
import { factsDigest } from "../../cart-context/observation";
import { unavailable } from "../../cart-context/policy";
import { cartContextConfig } from "../../config/local-commerce";
import { lockCartOwner, readLockedCartFacts } from "./cart-facts";
import { parseOriginalCommand, requireCommandCartMatch } from "./command";
import { nativeAuthorityStart } from "./authority-start";
import { authorityAdapters, openNativeAuthoritySession } from "./authority-sender";
import { createPinnedRequestVerifier, PinnedRequestVerifier } from "./request-verifier";
import { openVerifiedAuthoritySession } from "./request-session";
import { openNativeContinuationSession } from "./continuation-session";
import { createNativeReceiptVerifier, NativeReceiptVerifier } from "./receipt-verifier";
import { retainedNativeReceiptContext } from "./receipt-context";
import { retainedNativeProofContext } from "./proof-context";
import { readLockedNativePayment, readLockedNativeExecutionPayment } from "./payment-context";
import { nativeExecutionDeliverySnapshot } from "./execution-delivery";
import { executionColumns, executionFingerprint, createOriginalExecutionWorker, activateOriginalExecutionWorker, retireOriginalExecutionWorker, requireNativeExecutionProfile, type ExecutionRow } from "./execution-claim";
import { readOriginalPaymentOutcome } from "./payment-outcome";
import { prepareProofAssociation, PreparedProofAssociation } from "./proof-association";
import { configure } from "safe-stable-stringify";
import {
  eraseJournalSubject, exportJournalSubject, journalSubjectIsSuppressed, journalPrivacyMarkerIds, journalPrivacyInstallationId, minimizedOperationFields,
  restoreJournalRefusalIdentities, setJournalOperationHold, uninstallJournal,
} from "./privacy";

type Postgres = ReturnType<typeof ModulesSdkUtils.createPgConnection>;
type AdmissionContext = Parameters<typeof readLockedCartFacts>[3];
type VerifiedActor = AdmissionContext["actor"];

const operations = "rifare_operation";
const stringify = configure({ strict: true, deterministic: true, bigint: false });
const originalId = /^(?!00000000-0000-0000-0000-000000000000$)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const statusColumns = ["id", "original_command_uuid", "state", "revision"];
const historyColumns = [...statusColumns, "cart_id", "actor_digest", "command_digest",
  "privacy_hold", "first_observation_digest", "first_observed_at", "command_bytes",
  "start_owner_digest", "start_claimed_at", "start_command_bytes", "start_command_digest",
  "start_correlation", "store_id", "start_response_bytes", "start_response_digest", "start_response_observed_at",
  "challenge_fingerprint", "request_bytes", "request_digest", "request_context_digest", "request_nonce",
  "request_observed_at", "request_expires_at", "receipt_fingerprint", "receipt_bytes", "receipt_digest",
  "receipt_context_digest", "receipt_id", "receipt_observed_at", "receipt_expires_at",
  "proof_context_bytes", "proof_context_digest", "proof_digest", "proof_owner_digest", "proof_claimed_at",
  "proof_submission_bytes", "proof_submission_digest", "proof_submission_observed_at",
  "final_command_uuid", "final_command_bytes", "final_command_digest", "final_owner_digest", "final_claimed_at",
  "final_response_bytes", "final_response_digest", "final_response_observed_at",
  "payment_fingerprint", "payment_collection_id", "payment_session_id", "payment_provider_id", "payment_context_digest", "payment_observed_at",
  "native_payment_fingerprint", "native_payment_id", "native_payment_observed_at", ...executionColumns];
type JournalConfiguration = ReturnType<typeof journalConfiguration>;
type Merchant = NonNullable<ReturnType<typeof cartContextConfig>>;
type JournalRow = ExecutionRow & {
  id: string; original_command_uuid: string; state: string; revision: number;
  cart_id: string; actor_digest: string; command_digest: string; privacy_hold: boolean;
  first_observation_digest: string | null; first_observed_at: Date | null;
  command_bytes: string; start_owner_digest: string | null; start_claimed_at: Date | null;
  start_command_bytes: string | null; start_command_digest: string | null;
  start_correlation: string | null; store_id: string;
  start_response_bytes: string | null; start_response_digest: string | null;
  start_response_observed_at: Date | null; challenge_fingerprint: string | null;
  request_bytes: string | null; request_digest: string | null; request_context_digest: string | null;
  request_nonce: string | null; request_observed_at: Date | null; request_expires_at: Date | null;
  payment_fingerprint: string | null; payment_collection_id: string | null; payment_session_id: string | null;
  payment_provider_id: string | null; payment_context_digest: string | null; payment_observed_at: Date | null;
  native_payment_fingerprint: string | null; native_payment_id: string | null; native_payment_observed_at: Date | null;
  final_command_uuid: string | null; final_command_bytes: string | null; final_command_digest: string | null;
  final_owner_digest: string | null; final_claimed_at: Date | null; final_response_bytes: string | null;
  final_response_digest: string | null; final_response_observed_at: Date | null;
  proof_context_bytes: string | null; proof_context_digest: string | null; proof_digest: string | null;
  proof_owner_digest: string | null; proof_claimed_at: Date | null; proof_submission_bytes: string | null;
  proof_submission_digest: string | null; proof_submission_observed_at: Date | null;
  receipt_fingerprint: string | null; receipt_bytes: string | null; receipt_digest: string | null;
  receipt_context_digest: string | null; receipt_id: string | null; receipt_observed_at: Date | null; receipt_expires_at: Date | null;
};
const conflict = () => new MedusaError(MedusaError.Types.CONFLICT, "Original commerce command unavailable");
const verifyRequest = PinnedRequestVerifier.prototype.verify;
const describeRequest = PinnedRequestVerifier.prototype.describe;
const verifyReceipt = NativeReceiptVerifier.prototype.verify;
const describeReceipt = NativeReceiptVerifier.prototype.describe;
const signalAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")!.get!;

export default class OperationJournalService {
  private readonly postgres: Postgres;

  constructor({ [ContainerRegistrationKeys.PG_CONNECTION]: postgres }: { [ContainerRegistrationKeys.PG_CONNECTION]: Postgres }) {
    this.postgres = postgres;
  }

  /** Internal composition only. No public route or commerce effect is enabled. */
  async openAuthoritySession(input: Uint8Array, descriptor: Uint8Array, context: AdmissionContext, transport: unknown) {
    return openNativeAuthoritySession(this, input, descriptor, context, transport);
  }

  async createAuthorityTransport(configuration: unknown) {
    const { wire } = await authorityAdapters();
    return new wire.PublicDelegatedUseClient(configuration);
  }

  /** Internal server construction. Trust enrollment is never customer input. */
  async createAuthorityRequestVerifier(configuration: Uint8Array) {
    return createPinnedRequestVerifier(configuration);
  }

  async openVerifiedAuthoritySession(input: Uint8Array, descriptor: Uint8Array, context: AdmissionContext,
    transport: unknown, verifier: unknown) {
    return openVerifiedAuthoritySession(this, input, descriptor, context, transport, verifier);
  }

  async openContinuationSession(input: Uint8Array, descriptor: Uint8Array, context: AdmissionContext,
    transport: unknown, requestVerifier: unknown, receiptVerifier: unknown) {
    return openNativeContinuationSession(this, input, descriptor, context, transport, requestVerifier, receiptVerifier);
  }

  /** Internal server construction, never customer-selected trust or keys. */
  async createAuthorityReceiptVerifier(configuration: Uint8Array) { return createNativeReceiptVerifier(configuration); }

  /** Retain inert signed evidence for the current native original. This neither
   * promotes its state to approved nor permits a payment/order workflow. */
  async verifyAuthorityReceipt(commandId: string, input: Uint8Array, context: AdmissionContext, verifier: unknown, signal?: AbortSignal) {
    if (!(verifier instanceof NativeReceiptVerifier) || !(input instanceof Uint8Array) ||
        !input.byteLength || input.byteLength > 100000) throw conflict();
    const detached = Buffer.from(input);
    const active = () => { if (signal && signalAborted.call(signal)) throw conflict(); };
    active();
    const result = await this.withCurrentOriginal(commandId, context, async (tx, row, configuration) => {
      if (row.state !== "awaiting_authority") throw conflict();
      const retained = await retainedNativeReceiptContext(row);
      requireCommandCartMatch(retained.original, await readLockedCartFacts(tx, row.cart_id, configuration.merchant, configuration.verifiedContext));
      const before = await requestClock(tx);
      if (before.getTime() < row.request_observed_at!.getTime() ||
          row.receipt_observed_at && before.getTime() < row.receipt_observed_at.getTime()) throw conflict();
      const handle = await verifyReceipt.call(verifier, detached, retained.bytes, before.getTime(), signal);
      const verified = describeReceipt.call(verifier, handle);
      if (row.final_command_uuid) {
        if (!row.final_response_bytes) throw conflict();
        const bound = await this.bindFinalResponse(row, Buffer.from(row.final_response_bytes));
        const result = bound.response.result;
        const { request_json, request_time } = await authorityAdapters();
        const claims = request_json.strictReceiptJson(Buffer.from(verified.compact_jws.split(".")[1], "base64url"), 100000);
        if (result.kind !== "FINAL_USE" || result.decision !== "PERMIT" || claims.decision !== result.decision ||
            result.receipt_ref !== "urn:marty:delegated-receipt:" + verified.receipt_id || result.receipt_digest !== verified.digest ||
            request_time.receiptTimestampNs(claims.issued_at) > request_time.receiptTimestampNs(result.recorded_at) ||
            request_time.receiptTimestampNs(result.recorded_at) > BigInt(before.getTime()) * 1000000n ||
            request_time.receiptTimestampNs(claims.expires_at) !== request_time.receiptTimestampNs(result.authorization_expires_at)) throw conflict();
      }
      active();
      requireCommandCartMatch(retained.original, await readLockedCartFacts(tx, row.cart_id, configuration.merchant, configuration.verifiedContext));
      const observed = await requestClock(tx);
      const expires = new Date(verified.expires_at);
      if (!Number.isFinite(expires.getTime()) || observed.getTime() < verified.observed_at || observed.getTime() >= expires.getTime()) throw conflict();
      describeReceipt.call(verifier, handle); active();
      if (row.receipt_bytes) {
        if (row.receipt_bytes !== verified.compact_jws || row.receipt_digest !== verified.digest ||
            row.receipt_context_digest !== verified.verification_context_digest || row.receipt_id !== verified.receipt_id ||
            row.receipt_fingerprint !== verified.receipt_fingerprint || row.receipt_expires_at?.getTime() !== expires.getTime()) throw conflict();
        return { verification: handle, receipt_digest: row.receipt_digest, first_observed_at: row.receipt_observed_at!,
          receipt_expires_at: row.receipt_expires_at! };
      }
      if (row.receipt_fingerprint) throw conflict();
      const [saved] = await tx(operations).where(revisionFence(row)).whereNull("receipt_bytes").update({
        receipt_fingerprint: verified.receipt_fingerprint, receipt_bytes: verified.compact_jws, receipt_digest: verified.digest,
        receipt_context_digest: verified.verification_context_digest, receipt_id: verified.receipt_id,
        receipt_observed_at: observed, receipt_expires_at: expires, revision: row.revision + 1, updated_at: tx.fn.now(),
      }).returning("id");
      if (!saved) throw conflict();
      describeReceipt.call(verifier, handle); active();
      return { verification: handle, receipt_digest: verified.digest as string, first_observed_at: observed, receipt_expires_at: expires };
    });
    describeReceipt.call(verifier, result.verification); active();
    await this.withCurrentOriginal(commandId, context, async (tx, row, configuration) => {
      requireCommandCartMatch(parseOriginalCommand(Buffer.from(row.command_bytes)),
        await readLockedCartFacts(tx, row.cart_id, configuration.merchant, configuration.verifiedContext));
      const current = (await requestClock(tx)).getTime();
      if (row.state !== "awaiting_authority" || row.receipt_digest !== result.receipt_digest ||
          row.receipt_observed_at?.getTime() !== result.first_observed_at.getTime() ||
          current < result.first_observed_at.getTime() || current >= result.receipt_expires_at.getTime()) throw conflict();
    });
    describeReceipt.call(verifier, result.verification); active();
    return Object.freeze(result);
  }

  async recoverVerifiedAuthorityReceipt(commandId: string, context: AdmissionContext, verifier: unknown) {
    const bytes = await this.withCurrentOriginal(commandId, context, async (_tx, row) => {
      if (!row.receipt_bytes) throw conflict(); return Buffer.from(row.receipt_bytes);
    });
    return this.verifyAuthorityReceipt(commandId, bytes, context, verifier);
  }

  /** Signature verification records evidence only. No approval or effect occurs. */
  async verifyAuthorityRequest(commandId: string, input: Uint8Array, context: AdmissionContext, verifier: unknown, signal?: AbortSignal) {
    if (!(verifier instanceof PinnedRequestVerifier) || !(input instanceof Uint8Array) ||
        !input.byteLength || input.byteLength > 65536) throw conflict();
    const detached = Buffer.from(input);
    const active = () => { if (signal && signalAborted.call(signal)) throw conflict(); };
    active();
    const result = await this.withCurrentOriginal(commandId, context, async (tx, row, configuration) => {
      if (row.state !== "awaiting_authority" || !row.start_command_bytes || !row.start_correlation ||
          !row.start_response_bytes || !row.start_response_digest) throw conflict();
      const { codec } = await authorityAdapters();
      const original = codec.encodeDelegatedCommand(Buffer.from(row.start_command_bytes));
      if (original.original_command_id !== row.original_command_uuid || original.command_digest !== row.start_command_digest ||
          original.canonical_json !== row.start_command_bytes || row.start_response_digest !==
          "sha256:" + createHash("sha256").update(row.start_response_bytes).digest("hex")) throw conflict();
      const bound = codec.bindDelegatedResponse(original.request, Buffer.from(row.start_response_bytes));
      if (bound.response.result.kind !== "CHALLENGE") throw conflict();
      const challenge = bound.response.result;
      const correlation = JSON.parse(row.start_correlation);
      const fingerprint = factsDigest({ profile: "urn:rifare:medusa-authority-challenge:v1", correlation,
        challenge_id: challenge.challenge_id });
      if (fingerprint !== row.challenge_fingerprint) throw conflict();
      const binding = Buffer.from(stringify({ ...correlation, challenge_id: challenge.challenge_id,
        created_at: challenge.created_at, expires_at: challenge.expires_at })!);
      const originalCommand = parseOriginalCommand(Buffer.from(row.command_bytes));
      requireCommandCartMatch(originalCommand, await readLockedCartFacts(tx, row.cart_id, configuration.merchant, configuration.verifiedContext));
      const before = await requestClock(tx);
      if (row.request_observed_at && before.getTime() < row.request_observed_at.getTime()) throw conflict();
      const handle = await verifyRequest.call(verifier, detached, binding, before.getTime());
      const verified = describeRequest.call(verifier, handle);
      active();
      requireCommandCartMatch(originalCommand, await readLockedCartFacts(tx, row.cart_id, configuration.merchant, configuration.verifiedContext));
      const observed = await requestClock(tx);
      if (observed.getTime() < verified.observed_at || observed.getTime() >= verified.expires_at * 1000) throw conflict();
      describeRequest.call(verifier, handle);
      active();
      if (row.request_bytes) {
        if (row.request_bytes !== verified.compact_jws || row.request_digest !== verified.digest ||
            row.request_context_digest !== verified.verification_context_digest || row.request_nonce !== verified.nonce ||
            row.request_expires_at?.getTime() !== verified.expires_at * 1000) throw conflict();
        return { verification: handle, request_digest: row.request_digest, first_observed_at: row.request_observed_at!,
          request_expires_at: row.request_expires_at! };
      }
      const expires = new Date(verified.expires_at * 1000);
      const [saved] = await tx(operations).where(revisionFence(row)).whereNull("request_bytes").update({
        request_bytes: verified.compact_jws, request_digest: verified.digest, request_context_digest: verified.verification_context_digest,
        request_nonce: verified.nonce, request_observed_at: observed, request_expires_at: expires,
        revision: row.revision + 1, updated_at: tx.fn.now(),
      }).returning("id");
      if (!saved) throw conflict();
      // Closing trust during the awaited write rolls the entire tuple back.
      describeRequest.call(verifier, handle);
      active();
      return { verification: handle, request_digest: verified.digest as string, first_observed_at: observed,
        request_expires_at: expires };
    });
    describeRequest.call(verifier, result.verification);
    active();
    await this.withCurrentOriginal(commandId, context, async (tx, row) => {
      const current = (await requestClock(tx)).getTime();
      if (row.request_digest !== result.request_digest || row.request_observed_at?.getTime() !== result.first_observed_at.getTime() ||
          current < result.first_observed_at.getTime() || current >= result.request_expires_at.getTime()) throw conflict();
    });
    describeRequest.call(verifier, result.verification);
    active();
    return Object.freeze(result);
  }

  async recoverVerifiedAuthorityRequest(commandId: string, context: AdmissionContext, verifier: unknown) {
    const bytes = await this.withCurrentOriginal(commandId, context, async (_tx, row) => {
      if (!row.request_bytes) throw conflict(); return Buffer.from(row.request_bytes);
    });
    return this.verifyAuthorityRequest(commandId, bytes, context, verifier);
  }

  async authorityProofOrigin(commandId: string, context: AdmissionContext) {
    return this.withCurrentOriginal(commandId, context, async (_tx, row) => {
      if (row.state !== "awaiting_authority") throw conflict();
      const selected = await retainedNativeProofContext(row);
      return JSON.parse(selected.bytes.toString()).origin as string;
    });
  }

  /** Capture a selected digest/context before proof I/O. The compact proof never
   * enters PostgreSQL. Existing intent is explicit historical recovery only. */
  async prepareAuthorityProof(commandId: string, input: Uint8Array, context: AdmissionContext,
    verifier?: unknown, signal?: AbortSignal) {
    if (!(input instanceof Uint8Array) || !input.byteLength || input.byteLength > 262144) throw conflict();
    const proof = Buffer.from(input), ticket = randomBytes(32).toString("base64url");
    const ownerDigest = "sha256:" + createHash("sha256").update(ticket).digest("hex");
    let prepared: PreparedProofAssociation | undefined;
    const active = () => { if (signal && signalAborted.call(signal)) throw conflict(); };
    try {
      active();
      const existing = await this.withCurrentOriginal(commandId, context, async (_tx, row) => !!row.proof_context_bytes);
      const verification = existing ? null : await this.recoverVerifiedAuthorityRequest(commandId, context, verifier);
      active();
      const result = await this.withCurrentOriginal(commandId, context, async (tx, row, configuration) => {
        if (row.state !== "awaiting_authority") throw conflict();
        const selected = await retainedNativeProofContext(row);
        requireCommandCartMatch(selected.original,
          await readLockedCartFacts(tx, row.cart_id, configuration.merchant, configuration.verifiedContext));
        prepared = await prepareProofAssociation(selected.bytes, proof);
        const summary = prepared.describe();
        active();
        if (row.proof_context_bytes) {
          if (row.proof_context_bytes !== selected.bytes.toString() || row.proof_context_digest !== summary.context_digest ||
              row.proof_digest !== summary.proof_digest || !row.proof_owner_digest || !row.proof_claimed_at) throw conflict();
          return { prepared, send_ticket: null, recovery_only: true };
        }
        if (!verification || !(verifier instanceof PinnedRequestVerifier)) throw conflict();
        this.requireCurrentProofRequest(row, verifier, verification, (await requestClock(tx)).getTime());
        active();
        const [saved] = await tx(operations).where(revisionFence(row)).whereNull("proof_context_bytes").update({
          proof_context_bytes: selected.bytes.toString(), proof_context_digest: summary.context_digest,
          proof_digest: summary.proof_digest, proof_owner_digest: ownerDigest,
          revision: row.revision + 1, updated_at: tx.fn.now(),
        }).returning("id");
        if (!saved) throw conflict();
        this.requireCurrentProofRequest(row, verifier, verification, (await requestClock(tx)).getTime());
        active(); return { prepared, send_ticket: ticket, recovery_only: false };
      });
      if (verification && verifier instanceof PinnedRequestVerifier && !result.recovery_only) {
        await this.withCurrentOriginal(commandId, context, async (tx, row, configuration) => {
          const selected = await retainedNativeProofContext(row);
          requireCommandCartMatch(selected.original,
            await readLockedCartFacts(tx, row.cart_id, configuration.merchant, configuration.verifiedContext));
          this.requireCurrentProofRequest(row, verifier, verification, (await requestClock(tx)).getTime());
        });
      }
      active(); return Object.freeze(result);
    } catch (error) { prepared?.close(); throw error; }
    finally { proof.fill(0); }
  }

  private requireCurrentProofRequest(row: JournalRow, verifier: PinnedRequestVerifier,
    verification: Awaited<ReturnType<OperationJournalService["recoverVerifiedAuthorityRequest"]>>, now: number) {
    const current = describeRequest.call(verifier, verification.verification);
    if (current.digest !== row.request_digest || current.verification_context_digest !== row.request_context_digest ||
        current.nonce !== row.request_nonce || !row.request_observed_at || !row.request_expires_at ||
        now < current.observed_at || now < row.request_observed_at.getTime() || now >= row.request_expires_at.getTime()) throw conflict();
  }

  /** Actual first proof admission occurs only after authenticated TLS. */
  async claimAuthorityProofDispatch(commandId: string, ticket: string, proofDigest: string,
    context: AdmissionContext, verifier: unknown, signal?: AbortSignal) {
    if (typeof ticket !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(ticket) ||
        typeof proofDigest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(proofDigest) ||
        !(verifier instanceof PinnedRequestVerifier)) throw conflict();
    const active = () => { if (signal && signalAborted.call(signal)) throw conflict(); };
    active();
    const verification = await this.recoverVerifiedAuthorityRequest(commandId, context, verifier);
    const ownerDigest = "sha256:" + createHash("sha256").update(ticket).digest("hex");
    await this.withCurrentOriginal(commandId, context, async (tx, row, configuration) => {
      if (row.state !== "awaiting_authority" || !row.proof_context_bytes || row.proof_digest !== proofDigest ||
          row.proof_owner_digest !== ownerDigest || row.proof_claimed_at || row.proof_submission_bytes) throw conflict();
      const selected = await retainedNativeProofContext(row);
      if (selected.bytes.toString() !== row.proof_context_bytes || factsDigest(JSON.parse(row.proof_context_bytes)) !== row.proof_context_digest) throw conflict();
      requireCommandCartMatch(selected.original,
        await readLockedCartFacts(tx, row.cart_id, configuration.merchant, configuration.verifiedContext));
      this.requireCurrentProofRequest(row, verifier, verification, (await requestClock(tx)).getTime()); active();
      const [saved] = await tx(operations).where(revisionFence(row)).whereNull("proof_claimed_at").update({
        proof_claimed_at: tx.fn.now(), revision: row.revision + 1, updated_at: tx.fn.now(),
      }).returning("id");
      if (!saved) throw conflict();
      this.requireCurrentProofRequest(row, verifier, verification, (await requestClock(tx)).getTime()); active();
    }, true);
    await this.withCurrentOriginal(commandId, context, async (tx, row, configuration) => {
      if (row.proof_owner_digest !== ownerDigest || row.proof_digest !== proofDigest || !row.proof_claimed_at) throw conflict();
      requireCommandCartMatch(parseOriginalCommand(Buffer.from(row.command_bytes)),
        await readLockedCartFacts(tx, row.cart_id, configuration.merchant, configuration.verifiedContext));
      this.requireCurrentProofRequest(row, verifier, verification, (await requestClock(tx)).getTime());
    });
    describeRequest.call(verifier, verification.verification); active();
  }

  /** Recovery checks current native ownership/privacy/cart while retaining the
   * historical request context. It never invents a currently valid C7 handle. */
  async checkAuthorityProofRecovery(commandId: string, proofDigest: string, context: AdmissionContext) {
    return this.withCurrentOriginal(commandId, context, async (tx, row, configuration) => {
      if (row.state !== "awaiting_authority" || !row.proof_context_bytes || !row.proof_claimed_at || row.proof_digest !== proofDigest) throw conflict();
      const selected = await retainedNativeProofContext(row);
      if (selected.bytes.toString() !== row.proof_context_bytes || factsDigest(JSON.parse(row.proof_context_bytes)) !== row.proof_context_digest) throw conflict();
      requireCommandCartMatch(selected.original,
        await readLockedCartFacts(tx, row.cart_id, configuration.merchant, configuration.verifiedContext));
      return { context_bytes: row.proof_context_bytes, context_digest: row.proof_context_digest,
        proof_digest: row.proof_digest, first_submission: row.proof_submission_bytes,
        first_submission_digest: row.proof_submission_digest };
    });
  }

  /** Preserve the first semantic acknowledgement, excluding the per-transport
   * recovered observation. No presentation signature or permission is inferred. */
  async observeAuthorityProof(commandId: string, input: Uint8Array, proofDigest: string,
    context: AdmissionContext, signal?: AbortSignal) {
    if (!(input instanceof Uint8Array) || !input.byteLength || input.byteLength > 4096) throw conflict();
    const bytes = Buffer.from(input), { request_json, request_time } = await authorityAdapters();
    const active = () => { if (signal && signalAborted.call(signal)) throw conflict(); };
    return this.withCurrentOriginal(commandId, context, async (tx, row, configuration) => {
      active();
      if (row.state !== "awaiting_authority" || !row.proof_context_bytes || !row.proof_claimed_at || row.proof_digest !== proofDigest) throw conflict();
      const selected = await retainedNativeProofContext(row);
      if (selected.bytes.toString() !== row.proof_context_bytes || factsDigest(JSON.parse(row.proof_context_bytes)) !== row.proof_context_digest) throw conflict();
      requireCommandCartMatch(selected.original,
        await readLockedCartFacts(tx, row.cart_id, configuration.merchant, configuration.verifiedContext));
      const ack = request_json.strictReceiptJson(bytes, 4096);
      if (!ack || typeof ack !== "object" || Array.isArray(ack) || Object.keys(ack).length !== 5 ||
          !["submission_id", "challenge_id", "proof_digest", "received_at", "recovered"].every(key => Object.hasOwn(ack, key)) ||
          typeof ack.submission_id !== "string" || !originalId.test(ack.submission_id) ||
          ack.challenge_id !== selected.bound.response.result.challenge_id || ack.proof_digest !== row.proof_digest ||
          typeof ack.recovered !== "boolean" || typeof ack.received_at !== "string") throw conflict();
      const challenge = selected.bound.response.result;
      const received = request_time.receiptTimestampNs(ack.received_at);
      if (received < request_time.receiptTimestampNs(challenge.created_at) ||
          received >= request_time.receiptTimestampNs(challenge.expires_at)) throw conflict();
      const semantic = stringify({ submission_id: ack.submission_id, challenge_id: ack.challenge_id,
        proof_digest: ack.proof_digest, received_at: ack.received_at })!;
      const digest = "sha256:" + createHash("sha256").update(semantic).digest("hex");
      if (row.proof_submission_bytes) {
        if (row.proof_submission_bytes !== semantic || row.proof_submission_digest !== digest) throw conflict();
        return { submission_id: ack.submission_id, semantic_digest: digest, first_observed_at: row.proof_submission_observed_at };
      }
      const [saved] = await tx(operations).where(revisionFence(row)).whereNull("proof_submission_bytes").update({
        proof_submission_bytes: semantic, proof_submission_digest: digest, proof_submission_observed_at: tx.fn.now(),
        revision: row.revision + 1, updated_at: tx.fn.now(),
      }).returning("proof_submission_observed_at");
      if (!saved) throw conflict(); active();
      return { submission_id: ack.submission_id, semantic_digest: digest, first_observed_at: saved.proof_submission_observed_at };
    });
  }

  /** A separate server-selected UUID is retained before FINALIZE I/O. A lost
   * ticket or acknowledgement always returns original recovery, never new intent. */
  async prepareAuthorityFinalization(commandId: string, context: AdmissionContext) {
    const ticket = randomBytes(32).toString("base64url");
    return this.withCurrentOriginal(commandId, context, async (tx, row, configuration) => {
      if (row.state !== "awaiting_authority") throw conflict();
      const { selected, ack } = await this.retainedProofSubmission(row);
      requireCommandCartMatch(selected.original,
        await readLockedCartFacts(tx, row.cart_id, configuration.merchant, configuration.verifiedContext));
      const { codec } = await authorityAdapters();
      if (row.final_command_bytes) {
        const encoded = await this.retainedFinalization(row);
        return { command_bytes: encoded.canonical_json, command_digest: encoded.command_digest,
          send_ticket: null, recovery_only: true };
      }
      if (row.final_command_uuid) throw conflict();
      const encoded = codec.encodeDelegatedCommand({ profile: "urn:marty:delegation-command:v1", command: "FINALIZE_USE",
        command_id: randomUUID(), challenge_id: ack.challenge_id, proof_submission_id: ack.submission_id });
      const [saved] = await tx(operations).where(revisionFence(row)).whereNull("final_command_uuid").update({
        final_command_uuid: encoded.original_command_id, final_command_bytes: encoded.canonical_json,
        final_command_digest: encoded.command_digest,
        final_owner_digest: "sha256:" + createHash("sha256").update(ticket).digest("hex"),
        revision: row.revision + 1, updated_at: tx.fn.now(),
      }).returning("id");
      if (!saved) throw conflict();
      return { command_bytes: encoded.canonical_json, command_digest: encoded.command_digest,
        send_ticket: ticket, recovery_only: false };
    });
  }

  private async retainedProofSubmission(row: JournalRow) {
    if (!row.proof_context_bytes || !row.proof_claimed_at || !row.proof_submission_bytes || !row.proof_digest ||
        factsDigest(JSON.parse(row.proof_context_bytes)) !== row.proof_context_digest ||
        "sha256:" + createHash("sha256").update(row.proof_submission_bytes).digest("hex") !== row.proof_submission_digest) throw conflict();
    const selected = await retainedNativeProofContext(row);
    if (selected.bytes.toString() !== row.proof_context_bytes || factsDigest(JSON.parse(row.proof_context_bytes)) !== row.proof_context_digest) throw conflict();
    const { request_json, request_time } = await authorityAdapters();
    const ack = request_json.strictReceiptJson(Buffer.from(row.proof_submission_bytes), 4096);
    if (!ack || typeof ack !== "object" || Array.isArray(ack) || Object.keys(ack).length !== 4 ||
        !["submission_id", "challenge_id", "proof_digest", "received_at"].every(key => Object.hasOwn(ack, key)) ||
        typeof ack.submission_id !== "string" || !originalId.test(ack.submission_id) ||
        ack.challenge_id !== selected.bound.response.result.challenge_id || ack.proof_digest !== row.proof_digest) throw conflict();
    const received = request_time.receiptTimestampNs(ack.received_at);
    const challenge = selected.bound.response.result;
    if (received < request_time.receiptTimestampNs(challenge.created_at) || received >= request_time.receiptTimestampNs(challenge.expires_at)) throw conflict();
    return { selected, ack };
  }

  private async retainedFinalization(row: JournalRow) {
    const { ack } = await this.retainedProofSubmission(row);
    if (!row.final_command_uuid || !row.final_command_bytes || !row.final_owner_digest) throw conflict();
    const { codec } = await authorityAdapters();
    const encoded = codec.encodeDelegatedCommand(Buffer.from(row.final_command_bytes));
    if (encoded.request.command !== "FINALIZE_USE" || encoded.canonical_json !== row.final_command_bytes ||
        encoded.original_command_id !== row.final_command_uuid || row.final_command_uuid === row.original_command_uuid ||
        encoded.command_digest !== row.final_command_digest || encoded.request.challenge_id !== ack.challenge_id ||
        encoded.request.proof_submission_id !== ack.submission_id) throw conflict();
    return encoded;
  }

  async claimAuthorityFinalization(commandId: string, ticket: string, context: AdmissionContext, signal?: AbortSignal) {
    if (typeof ticket !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(ticket)) throw conflict();
    const ownerDigest = "sha256:" + createHash("sha256").update(ticket).digest("hex");
    const active = () => { if (signal && signalAborted.call(signal)) throw conflict(); };
    await this.withCurrentOriginal(commandId, context, async (tx, row, configuration) => {
      active();
      if (row.state !== "awaiting_authority" || row.final_owner_digest !== ownerDigest || row.final_claimed_at || row.final_response_bytes) throw conflict();
      await this.retainedFinalization(row);
      requireCommandCartMatch(parseOriginalCommand(Buffer.from(row.command_bytes)),
        await readLockedCartFacts(tx, row.cart_id, configuration.merchant, configuration.verifiedContext));
      const [saved] = await tx(operations).where(revisionFence(row)).whereNull("final_claimed_at").update({
        final_claimed_at: tx.fn.now(), revision: row.revision + 1, updated_at: tx.fn.now(),
      }).returning("id");
      if (!saved) throw conflict(); active();
    }, true);
    const current = await this.prepareAuthorityFinalRecovery(commandId, context);
    if (current.first_response) throw conflict(); active();
  }

  async prepareAuthorityFinalRecovery(commandId: string, context: AdmissionContext) {
    return this.withCurrentOriginal(commandId, context, async (tx, row, configuration) => {
      if (row.state !== "awaiting_authority") throw conflict();
      const encoded = await this.retainedFinalization(row);
      requireCommandCartMatch(parseOriginalCommand(Buffer.from(row.command_bytes)),
        await readLockedCartFacts(tx, row.cart_id, configuration.merchant, configuration.verifiedContext));
      if (row.final_response_bytes) await this.bindFinalResponse(row, Buffer.from(row.final_response_bytes));
      return { command_bytes: encoded.canonical_json, command_digest: encoded.command_digest,
        first_response: row.final_response_bytes, first_response_digest: row.final_response_digest };
    });
  }

  private async bindFinalResponse(row: JournalRow, bytes: Uint8Array, recovered?: boolean) {
    const encoded = await this.retainedFinalization(row), { codec } = await authorityAdapters();
    if (row.final_response_bytes && "sha256:" + createHash("sha256").update(row.final_response_bytes).digest("hex") !== row.final_response_digest) throw conflict();
    const bound = codec.bindDelegatedResponse(encoded.request, bytes, {
      ...(recovered ? { recovery: codec.createDelegatedRecovery(encoded.request).request } : {}),
      ...(row.final_response_bytes ? { previous: Buffer.from(row.final_response_bytes) } : {}),
    });
    const result = bound.response.result;
    if (result.kind !== "FINAL_USE" || !result.receipt_ref.startsWith("urn:marty:delegated-receipt:") ||
        !originalId.test(result.receipt_ref.slice("urn:marty:delegated-receipt:".length))) throw conflict();
    const { selected, ack } = await this.retainedProofSubmission(row), { request_time } = await authorityAdapters();
    const recorded = request_time.receiptTimestampNs(result.recorded_at), expiry = request_time.receiptTimestampNs(result.authorization_expires_at);
    if (recorded < request_time.receiptTimestampNs(ack.received_at) ||
        expiry > request_time.receiptTimestampNs(selected.bound.response.result.expires_at)) throw conflict();
    return bound;
  }

  async observeAuthorityFinalization(commandId: string, input: Uint8Array, recovered: boolean, context: AdmissionContext,
    signal?: AbortSignal) {
    if (!(input instanceof Uint8Array) || !input.byteLength || input.byteLength > 65536 || typeof recovered !== "boolean") throw conflict();
    const bytes = Buffer.from(input), active = () => { if (signal && signalAborted.call(signal)) throw conflict(); };
    return this.withCurrentOriginal(commandId, context, async (tx, row, configuration) => {
      active(); if (row.state !== "awaiting_authority") throw conflict();
      const bound = await this.bindFinalResponse(row, bytes, recovered);
      requireCommandCartMatch(parseOriginalCommand(Buffer.from(row.command_bytes)),
        await readLockedCartFacts(tx, row.cart_id, configuration.merchant, configuration.verifiedContext));
      if (!row.final_response_bytes) {
        const response = stringify(bound.response)!;
        const [saved] = await tx(operations).where(revisionFence(row)).whereNull("final_response_bytes").update({
          final_response_bytes: response, final_response_digest: "sha256:" + createHash("sha256").update(response).digest("hex"),
          final_response_observed_at: tx.fn.now(), revision: row.revision + 1, updated_at: tx.fn.now(),
        }).returning("id");
        if (!saved) throw conflict(); active();
      }
      return Object.freeze({ decision: bound.response.result.decision, execution_authorized: false });
    });
  }

  /** Native pending payment identity only. No workflow/provider action or
   * execution authority follows from this immutable association. */
  async associateAuthorityPayment(commandId: string, context: AdmissionContext, verifier: unknown, signal?: AbortSignal) {
    if (!(verifier instanceof NativeReceiptVerifier)) throw conflict();
    const captured = { actor: { ...context.actor }, salesChannelIds: [...context.salesChannelIds] };
    const active = () => { if (signal && signalAborted.call(signal)) throw conflict(); };
    active();
    const receipt = await OperationJournalService.prototype.recoverVerifiedAuthorityReceipt.call(this, commandId, captured, verifier);
    active();
    const result = await this.withCurrentOriginal(commandId, captured, async (tx, row, configuration) => {
      const selected = await this.readCurrentAuthorityPayment(tx, row, configuration, verifier, receipt, active);
      const now = await requestClock(tx); active();
      if (row.payment_collection_id) {
        requirePaymentAssociation(row, selected);
        if (!row.payment_observed_at || row.payment_observed_at.getTime() > now.getTime()) throw conflict();
        return paymentAssociationResult(selected, row.payment_observed_at);
      }
      if (row.payment_fingerprint) throw conflict();
      const [saved] = await tx(operations).where(revisionFence(row)).whereNull("payment_collection_id").update({
        payment_fingerprint: selected.payment_fingerprint, payment_collection_id: selected.payment_collection_id,
        payment_session_id: selected.payment_session_id, payment_provider_id: selected.payment_provider_id,
        payment_context_digest: selected.payment_context_digest, payment_observed_at: now,
        revision: row.revision + 1, updated_at: tx.fn.now(),
      }).returning("id");
      if (!saved) throw conflict();
      const after = await this.readCurrentAuthorityPayment(tx, row, configuration, verifier, receipt, active);
      if (after.payment_context_digest !== selected.payment_context_digest || after.payment_fingerprint !== selected.payment_fingerprint) throw conflict();
      active(); return paymentAssociationResult(selected, now);
    }, true).catch(error => {
      if ((error as { code?: string }).code === "23505") throw conflict(); throw error;
    });
    active();
    await this.withCurrentOriginal(commandId, captured, async (tx, row, configuration) => {
      const selected = await this.readCurrentAuthorityPayment(tx, row, configuration, verifier, receipt, active);
      requirePaymentAssociation(row, selected);
      if (row.payment_context_digest !== result.payment_context_digest ||
          row.payment_observed_at?.getTime() !== result.first_observed_at.getTime() ||
          (await requestClock(tx)).getTime() < result.first_observed_at.getTime()) throw conflict();
    }, true);
    describeReceipt.call(verifier, receipt.verification); active();
    return Object.freeze(result);
  }

  /** First claim only, committed before any future native dispatch. No retry ticket
   * is reissued after uncertainty. Normal application profiles cannot call this.
   * Worker credentials are internal transient custody, never an HTTP response.
   * Dispatch/early-write/provider qualification is deliberately still pending. */
  async claimNativeExecution(commandId: string, context: AdmissionContext, verifier: unknown, signal?: AbortSignal) {
    requireNativeExecutionProfile();
    if (!(verifier instanceof NativeReceiptVerifier)) throw conflict();
    const captured = { actor: { ...context.actor }, salesChannelIds: [...context.salesChannelIds] };
    const active = () => { if (signal && signalAborted.call(signal)) throw conflict(); requireNativeExecutionProfile(); };
    const existing = await this.withCurrentOriginal(commandId, captured, async (_tx, row) => row.execution_owner_fingerprint !== null);
    if (existing) return Object.freeze({ disposition: "recovery_only" as const, original_command_id: commandId,
      execution_authorized: false, native_fence_qualified: false, worker: null, seal: null });
    active();
    const receipt = await OperationJournalService.prototype.recoverVerifiedAuthorityReceipt.call(this, commandId, captured, verifier);
    active();
    const claimed = await this.withCurrentOriginal(commandId, captured, async (tx, row, configuration) => {
      // Lock before role allocation; concurrent first claim cannot mint another.
      const current = await tx(operations).where({ id: row.id }).forUpdate().first(...executionColumns);
      if (current.execution_owner_fingerprint) throw conflict();
      const selected = await this.readCurrentAuthorityPayment(tx, row, configuration, verifier, receipt, active, true);
      const full = await readLockedNativeExecutionPayment(tx, parseOriginalCommand(Buffer.from(row.command_bytes)), {
        ...configuration.merchant, region_id: (await readLockedCartFacts(tx, row.cart_id, configuration.merchant, configuration.verifiedContext)).facts.region_id as string,
        final_command_uuid: row.final_command_uuid!, final_response_digest: row.final_response_digest!,
        receipt_digest: row.receipt_digest!, receipt_context_digest: row.receipt_context_digest!, receipt_id: row.receipt_id!,
      });
      if (row.payment_fingerprint) throw conflict(); // Never repurpose a C10 association.
      const worker = await createOriginalExecutionWorker(tx), seal = randomBytes(32).toString("hex"), now = await requestClock(tx);
      active(); describeReceipt.call(verifier, receipt.verification);
      if (now.getTime() >= row.receipt_expires_at!.getTime()) throw conflict();
      const [saved] = await tx(operations).where(revisionFence(row)).whereNull("execution_owner_fingerprint").update({
        payment_fingerprint: selected.payment_fingerprint, payment_collection_id: selected.payment_collection_id,
        payment_session_id: selected.payment_session_id, payment_provider_id: selected.payment_provider_id,
        payment_context_digest: selected.payment_context_digest, payment_observed_at: now,
        execution_owner_fingerprint: worker.fingerprint, execution_seal_fingerprint: executionFingerprint(seal),
        execution_payment_handle_fingerprint: executionFingerprint(full.handle), execution_generation: 1,
        execution_claimed_at: now, execution_expires_at: row.receipt_expires_at, state: "unknown",
        revision: row.revision + 1, updated_at: tx.fn.now(),
      }).returning("id");
      if (!saved) throw conflict(); active();
      return Object.freeze({ disposition: "claimed_unknown" as const, original_command_id: commandId,
        execution_authorized: false, native_fence_qualified: false,
        worker: Object.freeze({ role: worker.role, password: worker.password }), seal });
    }, true);
    let deliveryBinding: Parameters<typeof nativeExecutionDeliverySnapshot>[1] | undefined;
    let deliveryFingerprint: string | undefined, deliveryDeadline = 0, deliveryClockFloor = 0;
    try {
      // The committed claim may have lost its acknowledgement or current
      // authority. Reverify after COMMIT before enabling this first login.
      active();
      await this.withCurrentOriginal(commandId, captured, async (tx, row, configuration) => {
        if (row.state !== "unknown" || row.execution_owner_fingerprint !== executionFingerprint(claimed.worker.role) ||
            row.execution_seal_fingerprint !== executionFingerprint(claimed.seal) || row.execution_generation !== 1 ||
            row.execution_revoked_at || !row.execution_expires_at) throw conflict();
        const retained = await retainedNativeReceiptContext(row), now = await requestClock(tx);
        const handle = await verifyReceipt.call(verifier, Buffer.from(row.receipt_bytes!), retained.bytes, now.getTime(), signal);
        const fresh = { verification: handle, receipt_digest: row.receipt_digest!, first_observed_at: row.receipt_observed_at!,
          receipt_expires_at: row.receipt_expires_at! };
        const selected = await this.readCurrentAuthorityPayment(tx, row, configuration, verifier, fresh, active, true);
        requirePaymentAssociation(row, selected);
        const full = await readLockedNativeExecutionPayment(tx, parseOriginalCommand(Buffer.from(row.command_bytes)), {
          ...configuration.merchant, region_id: (await readLockedCartFacts(tx, row.cart_id, configuration.merchant, configuration.verifiedContext)).facts.region_id as string,
          final_command_uuid: row.final_command_uuid!, final_response_digest: row.final_response_digest!,
          receipt_digest: row.receipt_digest!, receipt_context_digest: row.receipt_context_digest!, receipt_id: row.receipt_id!,
        });
        if (row.execution_payment_handle_fingerprint !== executionFingerprint(full.handle) ||
            now.getTime() < row.execution_claimed_at!.getTime() || now.getTime() >= row.execution_expires_at.getTime()) throw conflict();
        deliveryBinding = { operationId: row.id, cartId: row.cart_id, collectionId: row.payment_collection_id!,
          sessionId: row.payment_session_id!, customerId: captured.actor.actor_id!, identityId: captured.actor.auth_identity_id!,
          storeId: configuration.merchant.store_id, operatorId: configuration.privacyOperator,
          privacyIds: journalPrivacyMarkerIds(tx, configuration.subject, configuration.key),
          installationId: journalPrivacyInstallationId(configuration.merchant), role: claimed.worker.role };
        const verifiedAt = await requestClock(tx);
        const delivery = await nativeExecutionDeliverySnapshot(tx, deliveryBinding);
        if (verifiedAt.getTime() < now.getTime() || delivery.observedAt.getTime() < verifiedAt.getTime()) throw conflict();
        deliveryFingerprint = delivery.fingerprint;
        deliveryClockFloor = delivery.observedAt.getTime();
        deliveryDeadline = row.execution_expires_at.getTime();
        active(); await activateOriginalExecutionWorker(tx, claimed.worker.role); active();
      }, true);
      // No write transaction or activation follows this terminal read. Include
      // the entire await interval as a conservative clock-delivery allowance.
      const began = performance.now();
      const delivered = await nativeExecutionDeliverySnapshot(this.postgres, deliveryBinding!);
      active(); describeReceipt.call(verifier, receipt.verification);
      if (!delivered.canLogin || delivered.fingerprint !== deliveryFingerprint ||
          delivered.observedAt.getTime() < deliveryClockFloor ||
          delivered.observedAt.getTime() + Math.ceil(performance.now() - began) >= deliveryDeadline) throw conflict();
      return claimed;
    } catch (error) {
      // Never mint a replacement if delivery fails. A failed retirement remains
      // a visible error and the immutable unknown claim remains retained.
      await retireOriginalExecutionWorker(this.postgres, claimed.worker.role);
      throw error;
    }
  }

  async recoverAuthorityPayment(commandId: string, context: AdmissionContext, verifier: unknown, signal?: AbortSignal) {
    const captured = { actor: { ...context.actor }, salesChannelIds: [...context.salesChannelIds] };
    await this.withCurrentOriginal(commandId, captured, async (_tx, row) => {
      if (!row.payment_collection_id || !row.payment_fingerprint || !row.payment_observed_at) throw conflict();
    });
    return OperationJournalService.prototype.associateAuthorityPayment.call(this, commandId, captured, verifier, signal);
  }

  /** Historical native records only. No fresh receipt grant, provider lookup or
   * effect follows from this observation; callers cannot submit its payment IDs. */
  async recoverNativePaymentOutcome(commandId: string, context: AdmissionContext, signal?: AbortSignal) {
    const captured = { actor: { ...context.actor }, salesChannelIds: [...context.salesChannelIds] };
    const active = () => { if (signal && signalAborted.call(signal)) throw conflict(); };
    active();
    const first = await this.withCurrentOriginal(commandId, captured, async (tx, row, configuration) => {
      const selected = await this.readHistoricalPayment(tx, row, configuration); active();
      if (selected.native_payment_id && !row.native_payment_id) {
        if (row.native_payment_fingerprint || row.native_payment_observed_at) throw conflict();
        const [saved] = await tx(operations).where({ id: row.id, revision: row.revision, state: row.state })
          .whereNull("native_payment_id").whereNull("native_payment_fingerprint").update({
            native_payment_id: selected.native_payment_id, native_payment_fingerprint: selected.native_payment_fingerprint,
            native_payment_observed_at: selected.observed_at, revision: row.revision + 1, updated_at: tx.fn.now(),
          }).returning("id");
        if (!saved) throw conflict(); active();
      }
      return { payment_id: selected.native_payment_id, observed_at: selected.observed_at };
    });
    active();
    const result = await this.withCurrentOriginal(commandId, captured, async (tx, row, configuration) => {
      const selected = await this.readHistoricalPayment(tx, row, configuration); active();
      if (selected.native_payment_id !== first.payment_id || row.native_payment_id !== first.payment_id ||
          selected.observed_at.getTime() < first.observed_at.getTime()) throw conflict();
      return Object.freeze({ ...selected.facts, observation_digest: selected.observation_digest,
        first_payment_observed_at: row.native_payment_observed_at ? new Date(row.native_payment_observed_at) : null,
        observed_at: new Date(selected.observed_at) });
    });
    active(); return result;
  }

  private async readHistoricalPayment(tx: Postgres, row: JournalRow, configuration: JournalConfiguration) {
    if ((row.native_payment_id === null) !== (row.native_payment_fingerprint === null) ||
        (row.native_payment_id === null) !== (row.native_payment_observed_at === null)) throw conflict();
    if (!row.payment_collection_id || !row.payment_session_id || !row.payment_provider_id || !row.payment_context_digest ||
        !row.payment_fingerprint || !row.payment_observed_at || !row.final_command_uuid || !row.final_response_digest ||
        !row.receipt_digest || !row.receipt_context_digest || !row.receipt_id || !row.receipt_bytes || !row.final_response_bytes) throw conflict();
    const original = parseOriginalCommand(Buffer.from(row.command_bytes));
    if (original.command.command_id !== row.original_command_uuid || original.command.cart_id !== row.cart_id ||
        original.commandDigest !== row.command_digest ||
        "sha256:" + createHash("sha256").update(row.receipt_bytes).digest("hex") !== row.receipt_digest ||
        "sha256:" + createHash("sha256").update(row.final_response_bytes).digest("hex") !== row.final_response_digest) throw conflict();
    const selected = await readOriginalPaymentOutcome(tx, original, { ...configuration.merchant,
      final_command_uuid: row.final_command_uuid, final_response_digest: row.final_response_digest,
      receipt_digest: row.receipt_digest, receipt_context_digest: row.receipt_context_digest, receipt_id: row.receipt_id,
      payment_collection_id: row.payment_collection_id, payment_session_id: row.payment_session_id,
      payment_provider_id: row.payment_provider_id, payment_context_digest: row.payment_context_digest,
      payment_fingerprint: row.payment_fingerprint, native_payment_id: row.native_payment_id,
      native_payment_fingerprint: row.native_payment_fingerprint }, configuration.verifiedContext.actor, configuration.verifiedContext.salesChannelIds);
    const observed = await requestClock(tx);
    if (observed.getTime() < row.payment_observed_at.getTime() ||
        row.native_payment_observed_at && observed.getTime() < row.native_payment_observed_at.getTime()) throw conflict();
    return { ...selected, observed_at: observed };
  }

  private async readCurrentAuthorityPayment(tx: Postgres, row: JournalRow, configuration: JournalConfiguration,
    verifier: NativeReceiptVerifier, receipt: Awaited<ReturnType<OperationJournalService["recoverVerifiedAuthorityReceipt"]>>,
    active: () => void, nativeExecution = false) {
    active();
    if ((row.state !== "awaiting_authority" && !(nativeExecution && row.state === "unknown")) || !row.final_command_uuid || !row.final_response_bytes || !row.final_response_digest ||
        !row.receipt_bytes || !row.receipt_id || !row.receipt_digest || !row.receipt_context_digest ||
        !row.receipt_observed_at || !row.receipt_expires_at) throw conflict();
    const original = parseOriginalCommand(Buffer.from(row.command_bytes));
    const locked = await readLockedCartFacts(tx, row.cart_id, configuration.merchant, configuration.verifiedContext);
    requireCommandCartMatch(original, locked);
    const bound = await this.bindFinalResponse(row, Buffer.from(row.final_response_bytes));
    if (bound.response.result.decision !== "PERMIT" || typeof locked.facts.region_id !== "string") throw conflict();
    const selected = await (nativeExecution ? readLockedNativeExecutionPayment : readLockedNativePayment)(tx, original, { ...configuration.merchant, region_id: locked.facts.region_id,
      final_command_uuid: row.final_command_uuid, final_response_digest: row.final_response_digest,
      receipt_digest: row.receipt_digest, receipt_context_digest: row.receipt_context_digest, receipt_id: row.receipt_id });
    const current = describeReceipt.call(verifier, receipt.verification), now = (await requestClock(tx)).getTime();
    if (current.digest !== row.receipt_digest || current.verification_context_digest !== row.receipt_context_digest ||
        current.original_command_id !== row.original_command_uuid || current.operation_digest !== row.command_digest ||
        new Date(current.expires_at).getTime() !== row.receipt_expires_at.getTime() ||
        current.receipt_id !== row.receipt_id || receipt.receipt_digest !== row.receipt_digest ||
        receipt.first_observed_at.getTime() !== row.receipt_observed_at.getTime() ||
        now < current.observed_at || now < row.receipt_observed_at.getTime() || now >= row.receipt_expires_at.getTime()) throw conflict();
    if (row.payment_observed_at && now < row.payment_observed_at.getTime()) throw conflict();
    describeReceipt.call(verifier, receipt.verification); active();
    return selected;
  }

  /** Internal entry point. The caller supplies framework-verified request context. */
  async admit(input: Uint8Array, context: AdmissionContext) {
    return (await this.admitOriginal(input, context)).operation;
  }

  /** Only the creating invocation receives the transient initial-send ticket. */
  async admitForAuthority(input: Uint8Array, context: AdmissionContext) {
    const ticket = randomBytes(32).toString("base64url");
    const ownerDigest = "sha256:" + createHash("sha256").update(ticket).digest("hex");
    const result = await this.admitOriginal(input, context, ownerDigest);
    return { operation: result.operation, recovery_only: !result.created,
      send_ticket: result.created ? ticket : null };
  }

  /** Called after TLS. No network activity occurs inside this transaction. */
  async claimAuthorityDispatch(commandId: string, ticket: string, context: AdmissionContext) {
    if (typeof ticket !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(ticket)) throw conflict();
    const ownerDigest = "sha256:" + createHash("sha256").update(ticket).digest("hex");
    await this.withCurrentOriginal(commandId, context, async (tx, row, configuration) => {
      if (row.state !== "awaiting_authority" || row.start_owner_digest !== ownerDigest ||
          row.start_claimed_at !== null || !row.start_command_bytes || !row.start_correlation) throw conflict();
      const locked = await readLockedCartFacts(tx, row.cart_id, configuration.merchant, configuration.verifiedContext);
      requireCommandCartMatch(parseOriginalCommand(Buffer.from(row.command_bytes)), locked);
      const [claimed] = await tx(operations).where(revisionFence(row))
        .where({ start_owner_digest: ownerDigest }).whereNull("start_claimed_at")
        .update({ start_claimed_at: tx.fn.now(), revision: row.revision + 1, updated_at: tx.fn.now() })
        .returning("id");
      if (!claimed) throw conflict();
    }, true);
  }

  /** Retain complete remote bytes before any transport is opened. */
  async retainAuthorityStart(commandId: string, ticket: string, descriptor: Uint8Array, context: AdmissionContext) {
    if (typeof ticket !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(ticket) ||
        !(descriptor instanceof Uint8Array) || descriptor.byteLength > 4096) throw conflict();
    const ownerDigest = "sha256:" + createHash("sha256").update(ticket).digest("hex");
    const detached = Buffer.from(descriptor);
    return this.withCurrentOriginal(commandId, context, async (tx, row) => {
      if (row.state !== "awaiting_authority" || row.start_owner_digest !== ownerDigest) throw conflict();
      const encoded = nativeAuthorityStart(detached, row);
      if (row.start_command_bytes) {
        if (row.start_command_bytes !== encoded.command_bytes ||
            row.start_command_digest !== encoded.command_digest ||
            row.start_correlation !== encoded.correlation) throw conflict();
        return encoded;
      }
      if (row.start_claimed_at !== null) throw conflict();
      const [retained] = await tx(operations).where(revisionFence(row)).whereNull("start_command_bytes")
        .update({ start_command_bytes: encoded.command_bytes, start_command_digest: encoded.command_digest,
          start_correlation: encoded.correlation, revision: row.revision + 1, updated_at: tx.fn.now() })
        .returning("id");
      if (!retained) throw conflict();
      return encoded;
    }, true);
  }

  /** Persist only the closed unverified C1 response, never the signed request artifact. */
  async observeAuthorityResponse(commandId: string, input: Uint8Array, recovered: boolean, context: AdmissionContext) {
    if (!(input instanceof Uint8Array) || !input.byteLength || input.byteLength > 65536 ||
        typeof recovered !== "boolean") throw conflict();
    const bytes = Buffer.from(input);
    const { codec } = await authorityAdapters();
    return this.withCurrentOriginal(commandId, context, async (tx, row) => {
      if (row.state !== "awaiting_authority" || !row.start_command_bytes || !row.start_correlation) throw conflict();
      const original = codec.encodeDelegatedCommand(Buffer.from(row.start_command_bytes));
      if (original.canonical_json !== row.start_command_bytes || original.command_digest !== row.start_command_digest ||
          original.original_command_id !== row.original_command_uuid) throw conflict();
      if (row.start_response_bytes && row.start_response_digest !==
          "sha256:" + createHash("sha256").update(row.start_response_bytes).digest("hex")) throw conflict();
      const bound = codec.bindDelegatedResponse(original.request, bytes, {
        ...(recovered ? { recovery: codec.createDelegatedRecovery(original.request).request } : {}),
        ...(row.start_response_bytes ? { previous: Buffer.from(row.start_response_bytes) } : {}),
      });
      if (bound.response.result.kind !== "CHALLENGE") throw conflict();
      if (row.start_response_bytes) return;
      const responseBytes = stringify(bound.response)!;
      const fingerprint = factsDigest({
        profile: "urn:rifare:medusa-authority-challenge:v1",
        correlation: JSON.parse(row.start_correlation),
        challenge_id: bound.response.result.challenge_id,
      });
      if (row.challenge_fingerprint && row.challenge_fingerprint !== fingerprint) throw conflict();
      const [observed] = await tx(operations).where(revisionFence(row)).whereNull("start_response_bytes")
        .update({
          start_response_bytes: responseBytes,
          start_response_digest: "sha256:" + createHash("sha256").update(responseBytes).digest("hex"),
          start_response_observed_at: tx.fn.now(), challenge_fingerprint: fingerprint,
          revision: row.revision + 1, updated_at: tx.fn.now(),
        }).returning("id");
      if (!observed) throw conflict();
    }).catch(error => {
      if ((error as { code?: string }).code === "23505") throw conflict();
      throw error;
    });
  }

  private async admitOriginal(input: Uint8Array, context: AdmissionContext, ownerDigest: string | null = null) {
    const { merchant, key, privacyOperator, verifiedContext, subject } = journalConfiguration(context);
    const original = parseOriginalCommand(input);
    const { command, commandBytes, commandDigest } = original;

    // Serialization failures are local rollbacks. Retry only this transaction,
    // using the same detached original bytes and verified context each time.
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.postgres.transaction(async tx => {
          if (!await liveUser(tx, privacyOperator)) throw journalUnavailable();
          if (await journalSubjectIsSuppressed(tx, subject, key)) throw unavailable();
          const locked = await readLockedCartFacts(tx, command.cart_id, merchant, verifiedContext);

          const retained = await tx(operations).where({ original_command_uuid: command.command_id }).first(
            "id", "original_command_uuid", "state", "revision", "merchant_namespace", "store_id",
            "customer_id", "cart_id", "actor_digest", "command_bytes", "command_digest",
          );
          if (retained) {
            if (["cancelled", "retired"].includes(retained.state) || retained.merchant_namespace !== subject.merchant_namespace ||
                retained.store_id !== subject.store_id || retained.customer_id !== subject.customer_id ||
                retained.cart_id !== command.cart_id || retained.actor_digest !== locked.actorDigest ||
                retained.command_bytes !== commandBytes || retained.command_digest !== commandDigest) throw conflict();
            return { operation: statusOf(retained), created: false };
          }

          requireCommandCartMatch(original, locked);
          const [created] = await tx(operations).insert({
            ...subject,
            id: "rifop_" + randomUUID(),
            original_command_uuid: command.command_id,
            state: "awaiting_authority",
            cart_id: command.cart_id,
            actor_digest: locked.actorDigest,
            command_bytes: commandBytes,
            command_digest: commandDigest,
            cart_facts_digest: locked.factsDigest,
            payable_minor_units: locked.facts.payable_total_minor,
            currency: locked.facts.currency_code,
            currency_exponent: locked.facts.currency_exponent,
            start_owner_digest: ownerDigest,
          }).onConflict("original_command_uuid").ignore().returning(statusColumns);
          if (!created) throw conflict();
          return { operation: statusOf(created), created: true };
        }, { isolationLevel: "serializable" });
      } catch (error) {
        if (attempt >= 3 || (error as { code?: string })?.code !== "40001") throw error;
      }
    }
  }

  async status(commandId: string, context: AdmissionContext) {
    return this.withCurrentOriginal(commandId, context, async (_tx, row) => ({
      ...statusOf(row),
      first_observation_digest: row.first_observation_digest,
      first_observed_at: row.first_observed_at,
    }));
  }

  async prepareRecovery(commandId: string, context: AdmissionContext) {
    return this.withCurrentOriginal(commandId, context, async (_tx, row) => {
      if (row.state !== "awaiting_authority") throw conflict();
      return { id: row.id, original_command_uuid: row.original_command_uuid, command_digest: row.command_digest,
        ...(row.start_command_bytes ? { authority_start: {
          command_bytes: row.start_command_bytes, command_digest: row.start_command_digest,
          correlation: row.start_correlation,
          ...(row.start_response_bytes ? { first_response: {
            bytes: row.start_response_bytes, digest: row.start_response_digest,
            observed_at: row.start_response_observed_at,
          } } : {}),
        } } : {}) };
    });
  }

  async observe(commandId: string, expectedRevision: number, context: AdmissionContext) {
    return this.withCurrentOriginal(commandId, context, async (tx, row, configuration) => {
      requireAwaitingRevision(row, expectedRevision);
      if (row.first_observation_digest) {
        return { ...statusOf(row), first_observation_digest: row.first_observation_digest,
          first_observed_at: row.first_observed_at };
      }
      const { merchant, verifiedContext } = configuration;
      const locked = await readLockedCartFacts(tx, row.cart_id, merchant, verifiedContext);
      // This commitment records local cart facts. It carries no provider result.
      const digest = factsDigest({
        profile: "urn:rifare:medusa-journal-cart-observation:v1",
        original_operation_id: row.id,
        original_command_digest: row.command_digest,
        cart_facts_digest: locked.factsDigest,
      });
      const [changed] = await tx(operations).where(revisionFence(row))
        .whereNull("first_observation_digest").update({
          first_observation_digest: digest,
          first_observed_at: tx.fn.now(),
          revision: row.revision + 1,
          updated_at: tx.fn.now(),
        }).returning([...statusColumns, "first_observation_digest", "first_observed_at"]);
      if (!changed) throw conflict();
      return changed;
    });
  }

  async cancel(commandId: string, expectedRevision: number, context: AdmissionContext) {
    return this.withCurrentOriginal(commandId, context, async (tx, row) => {
      requireAwaitingRevision(row, expectedRevision);
      const retirement = row.privacy_hold ? { state: "cancelled" } : { state: "retired", ...minimizedOperationFields };
      const [changed] = await tx(operations).where(revisionFence(row)).update({
        ...retirement,
        revision: row.revision + 1,
        updated_at: tx.fn.now(),
      }).returning(statusColumns);
      if (!changed) throw conflict();
      return changed;
    });
  }

  async exportPrivacySubject(customerId: string, actor: VerifiedActor) {
    return this.withPrivacyOwner(actor, (tx, merchant, key) =>
      exportJournalSubject(tx, privacySubject(merchant, customerId), key));
  }

  async erasePrivacySubject(customerId: string, actor: VerifiedActor) {
    return this.withPrivacyOwner(actor, (tx, merchant, key) =>
      eraseJournalSubject(tx, privacySubject(merchant, customerId), key));
  }

  async setPrivacyHold(customerId: string, id: string, expectedRevision: number, held: boolean, actor: VerifiedActor) {
    return this.withPrivacyOwner(actor, (tx, merchant, key) =>
      setJournalOperationHold(tx, privacySubject(merchant, customerId), key, id, expectedRevision, held));
  }

  async uninstallPrivacyJournal(actor: VerifiedActor) {
    return this.withPrivacyOwner(actor, (tx, merchant, key) => uninstallJournal(tx, merchant, key));
  }

  async restorePrivacyRefusals(records: Parameters<typeof restoreJournalRefusalIdentities>[3], actor: VerifiedActor) {
    return this.withPrivacyOwner(actor, (tx, merchant, key) =>
      restoreJournalRefusalIdentities(tx, merchant, key, records));
  }

  /** The recovery owner supplies current, verified refusals, erasures and installation state. */
  async reconcilePrivacyRestore(
    records: Parameters<typeof restoreJournalRefusalIdentities>[3],
    erasedCustomerIds: readonly string[],
    actor: VerifiedActor,
    { installationUninstalled = false }: { installationUninstalled?: boolean } = {},
  ) {
    if (typeof installationUninstalled !== "boolean" ||
        !Array.isArray(erasedCustomerIds) || erasedCustomerIds.length > 1000) throw unavailable();
    const orderedCustomers = [...new Set(erasedCustomerIds)].sort();
    return this.withPrivacyOwner(actor, async (tx, merchant, key) => {
      if (installationUninstalled) await uninstallJournal(tx, merchant, key);
      for (const customerId of orderedCustomers) {
        await eraseJournalSubject(tx, privacySubject(merchant, customerId), key);
      }
      await restoreJournalRefusalIdentities(tx, merchant, key, records);
    });
  }

  /** Internal only. Authentication is supplied by the Medusa request boundary. */
  private async withPrivacyOwner<T>(
    actor: VerifiedActor,
    use: (tx: Postgres, merchant: Merchant, key: Buffer) => Promise<T>,
  ) {
    const { merchant, key, privacyOperator } = installationConfiguration();
    const { actor_type, actor_id, auth_identity_id } = actor;
    if (actor_type !== "user" || actor_id !== privacyOperator || !auth_identity_id) throw unavailable();

    return this.postgres.transaction(async tx => {
      const user = await liveUser(tx, actor_id);
      const identity = await tx("auth_identity").where({ id: auth_identity_id }).whereNull("deleted_at")
        .forShare().first({ user_id: tx.raw("app_metadata ->> 'user_id'") });
      const stores = await tx("store").whereNull("deleted_at").limit(2).select("id");
      if (!user || identity?.user_id !== actor_id || stores.length !== 1 || stores[0].id !== merchant.store_id) {
        throw unavailable();
      }
      return use(tx, merchant, key);
    }, { isolationLevel: "serializable" }).catch(error => {
      // A concurrent identity change invalidates this authorization snapshot.
      if (error?.code === "40001") throw unavailable();
      throw error;
    });
  }

  private async withCurrentOriginal<T>(
    commandId: string, context: AdmissionContext,
    use: (tx: Postgres, row: JournalRow, configuration: JournalConfiguration) => Promise<T>,
    requireAdmissionOperator = false,
  ) {
    if (typeof commandId !== "string" || !originalId.test(commandId)) throw unavailable();
    const configuration = journalConfiguration(context);
    const { merchant, key, verifiedContext, subject } = configuration;
    return this.postgres.transaction(async tx => {
      if (requireAdmissionOperator && !await liveUser(tx, configuration.privacyOperator)) throw journalUnavailable();
      if (await journalSubjectIsSuppressed(tx, subject, key)) throw unavailable();
      const row = await tx<JournalRow>(operations).where({ ...subject, original_command_uuid: commandId })
        .whereNotIn("state", ["cancelled", "retired"]).first<JournalRow | undefined>(historyColumns);
      if (!row) throw unavailable();
      const owner = await lockCartOwner(tx, row.cart_id, merchant, verifiedContext);
      if (row.actor_digest !== owner.actorDigest) throw unavailable();
      return use(tx, row, configuration);
    }, { isolationLevel: "serializable" });
  }
}

function installationConfiguration() {
  const merchant = cartContextConfig(process.env);
  const encodedKey = process.env.RIFARE_JOURNAL_PRIVACY_KEY ?? "";
  const key = Buffer.from(encodedKey, "base64url");
  const privacyOperator = process.env.RIFARE_JOURNAL_PRIVACY_OPERATOR_ID ?? "";
  if (!merchant || !/^[A-Za-z0-9_-]{43}$/.test(encodedKey) ||
      key.length !== 32 || key.toString("base64url") !== encodedKey || !/^user_[A-Za-z0-9]{1,100}$/.test(privacyOperator)) {
    throw journalUnavailable();
  }
  return { merchant, key, privacyOperator };
}

function journalConfiguration(context: AdmissionContext) {
  const installation = installationConfiguration();
  const { actor, salesChannelIds } = context;
  if (actor.actor_type !== "customer" || !/^cus_[A-Za-z0-9]{1,100}$/.test(actor.actor_id) ||
      !actor.auth_identity_id) throw unavailable();
  const verifiedContext = { actor: { ...actor }, salesChannelIds: [...salesChannelIds] };
  const subject = privacySubject(installation.merchant, verifiedContext.actor.actor_id);

  return { ...installation, verifiedContext, subject };
}

function privacySubject(merchant: Merchant, customerId: string) {
  if (typeof customerId !== "string" || !/^cus_[A-Za-z0-9]{1,100}$/.test(customerId)) throw unavailable();
  return { ...merchant, customer_id: customerId };
}

function liveUser(tx: Postgres, userId: string) {
  return tx("user").where({ id: userId }).whereNull("deleted_at").forShare().first("id");
}

function journalUnavailable() {
  return new MedusaError(MedusaError.Types.NOT_ALLOWED, "Operation journal is unavailable");
}

function statusOf(row: JournalRow) {
  return { id: row.id, original_command_uuid: row.original_command_uuid, state: row.state, revision: row.revision };
}

function requireAwaitingRevision(row: JournalRow, expectedRevision: number) {
  if (row.state !== "awaiting_authority" || !Number.isSafeInteger(expectedRevision) || row.revision !== expectedRevision) {
    throw conflict();
  }
}

function requirePaymentAssociation(row: JournalRow, selected: Awaited<ReturnType<typeof readLockedNativePayment>>) {
  if (row.payment_fingerprint !== selected.payment_fingerprint || row.payment_collection_id !== selected.payment_collection_id ||
      row.payment_session_id !== selected.payment_session_id || row.payment_provider_id !== selected.payment_provider_id ||
      row.payment_context_digest !== selected.payment_context_digest) throw conflict();
}

function paymentAssociationResult(selected: Awaited<ReturnType<typeof readLockedNativePayment>>, firstObserved: Date) {
  return { payment_collection_id: selected.payment_collection_id, payment_session_id: selected.payment_session_id,
    payment_provider_id: selected.payment_provider_id, payment_context_digest: selected.payment_context_digest,
    first_observed_at: firstObserved, evidence_status: "native_pending_payment_observation", execution_authorized: false,
    live_provider_status_verified: false };
}

function revisionFence(row: JournalRow) {
  return { id: row.id, revision: row.revision, state: "awaiting_authority" };
}

async function requestClock(transaction: Postgres): Promise<Date> {
  const value = (await transaction.raw("select clock_timestamp() as now")).rows[0]?.now;
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw conflict();
  return value;
}
