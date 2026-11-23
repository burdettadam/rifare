import { createHash } from "node:crypto";
import OperationJournalService from "./service";
import { openVerifiedAuthoritySession } from "./request-session";
import { authorityAdapters } from "./authority-assets";
import { PreparedProofAssociation } from "./proof-association";

type Context = Parameters<OperationJournalService["admit"]>[1];
const unavailable = (): never => { throw new Error("NATIVE_CONTINUATION_UNAVAILABLE"); };

/** Internal server composition. Credential custody supplies exact proof bytes;
 * neither a public route nor a presentation signer is created here. */
export async function openNativeContinuationSession(journal: OperationJournalService, input: Uint8Array,
  descriptor: Uint8Array, context: Context, transport: unknown, requestVerifier: unknown, receiptVerifier: unknown) {
  const captured = { actor: { ...context.actor }, salesChannelIds: [...context.salesChannelIds] };
  const native = await openVerifiedAuthoritySession(journal, input, descriptor, captured, transport, requestVerifier);
  const commandId = native.operation.original_command_uuid;
  const owner = OperationJournalService.prototype, { wire, codec } = await authorityAdapters();
  const previous = await owner.prepareRecovery.call(journal, commandId, captured);
  if (!previous.authority_start || !(transport instanceof wire.PublicDelegatedUseClient)) unavailable();
  const start = codec.encodeDelegatedCommand(Buffer.from(previous.authority_start!.command_bytes));
  const prototype = wire.PublicDelegatedUseClient.prototype;
  const matchesOrigin = prototype.boundToOrigin.bind(transport);
  const sendProof = prototype.submitProofAfterAdmission.bind(transport);
  const sendFinal = prototype.finalizeAfterAdmission.bind(transport);
  const readFinal = prototype.recoverFinalAfterAdmission.bind(transport);
  const readReceipt = prototype.recoverReceiptAfterAdmission.bind(transport);
  const proofs = new WeakMap<object, { prepared: PreparedProofAssociation; ticket: string | null }>();
  const forms = new Set<PreparedProofAssociation>();
  const finals = new WeakMap<object, { bytes: string; digest: string; ticket: string | null }>();
  let closed = false; const cancellation = new AbortController();
  const guard = () => { if (closed) unavailable(); };
  const checkFinal = async () => { guard(); const result = await owner.prepareAuthorityFinalRecovery.call(journal, commandId, captured); guard(); return result; };
  const submit = async (prepared: PreparedProofAssociation, challenge: unknown, admission: () => Promise<void>) => {
    const summary = PreparedProofAssociation.prototype.describe.call(prepared), form = PreparedProofAssociation.prototype.formBytes.call(prepared);
    try {
      const result = await sendProof(start.request, challenge, summary.query_id, form, admission, guard, cancellation.signal);
      guard();
      const ack = Buffer.from(JSON.stringify({ submission_id: result.submission_id, challenge_id: result.challenge_id,
        proof_digest: result.proof_digest, received_at: result.received_at, recovered: result.recovered }));
      const observed = await owner.observeAuthorityProof.call(journal, commandId, ack, summary.proof_digest, captured, cancellation.signal);
      await owner.checkAuthorityProofRecovery.call(journal, commandId, summary.proof_digest, captured); guard();
      return Object.freeze({ ...observed, execution_authorized: false, presentation_verified: false });
    } finally { form.fill(0); PreparedProofAssociation.prototype.close.call(prepared); forms.delete(prepared); }
  };
  return Object.freeze({
    operation: native.operation, start: native.start, recover: native.recover,
    verifyRequest: native.verifyRequest, recoverVerifiedRequest: native.recoverVerifiedRequest,
    describeVerifiedRequest: native.describeVerifiedRequest,
    async prepareProof(input: Uint8Array) {
      guard();
      if (!(input instanceof Uint8Array) || !input.byteLength || input.byteLength > 262144) unavailable();
      const proof = Buffer.from(input);
      try {
        if (!matchesOrigin(await owner.authorityProofOrigin.call(journal, commandId, captured))) unavailable(); guard();
        const result = await owner.prepareAuthorityProof.call(journal, commandId, proof, captured, requestVerifier, cancellation.signal);
        if (!result.send_ticket || closed) { result.prepared.close(); unavailable(); }
        const handle = Object.freeze(Object.create(null)); forms.add(result.prepared);
        proofs.set(handle, { prepared: result.prepared, ticket: result.send_ticket }); return handle;
      } finally { proof.fill(0); }
    },
    async submitProof(handle: unknown, challenge: unknown) {
      guard(); const retained = handle && typeof handle === "object" ? proofs.get(handle) : undefined;
      if (!retained || !retained.ticket) unavailable();
      const ticket = retained!.ticket!; retained!.ticket = null;
      const summary = PreparedProofAssociation.prototype.describe.call(retained!.prepared);
      return submit(retained!.prepared, challenge, async () => {
        guard(); await owner.claimAuthorityProofDispatch.call(journal, commandId, ticket, summary.proof_digest,
          captured, requestVerifier, cancellation.signal); guard();
      });
    },
    async recoverProof(input: Uint8Array, challenge: unknown) {
      guard();
      if (!(input instanceof Uint8Array) || !input.byteLength || input.byteLength > 262144) unavailable();
      const proof = Buffer.from(input), digest = "sha256:" + createHash("sha256").update(proof).digest("hex");
      try {
        if (!matchesOrigin(await owner.authorityProofOrigin.call(journal, commandId, captured))) unavailable(); guard();
        await owner.checkAuthorityProofRecovery.call(journal, commandId, digest, captured); guard();
        const result = await owner.prepareAuthorityProof.call(journal, commandId, proof, captured, undefined, cancellation.signal);
        if (!result.recovery_only || closed) { result.prepared.close(); unavailable(); }
        forms.add(result.prepared);
        return submit(result.prepared, challenge, async () => {
          guard(); await owner.checkAuthorityProofRecovery.call(journal, commandId, digest, captured); guard();
        });
      } finally { proof.fill(0); }
    },
    async prepareFinalization() {
      guard(); const result = await owner.prepareAuthorityFinalization.call(journal, commandId, captured); guard();
      if (!result.send_ticket) unavailable();
      const handle = Object.freeze(Object.create(null));
      finals.set(handle, { bytes: result.command_bytes, digest: result.command_digest, ticket: result.send_ticket }); return handle;
    },
    async finalize(handle: unknown) {
      guard(); const retained = handle && typeof handle === "object" ? finals.get(handle) : undefined;
      if (!retained || !retained.ticket) unavailable();
      const ticket = retained!.ticket!; retained!.ticket = null;
      const original = codec.encodeDelegatedCommand(Buffer.from(retained!.bytes));
      const result = await sendFinal(original.request, async () => {
        guard(); await owner.claimAuthorityFinalization.call(journal, commandId, ticket, captured, cancellation.signal); guard();
      }, guard, cancellation.signal);
      const observed = await owner.observeAuthorityFinalization.call(journal, commandId, Buffer.from(JSON.stringify(result.response)), false, captured, cancellation.signal);
      await checkFinal(); return observed;
    },
    async recoverFinalization() {
      const current = await checkFinal(), original = codec.encodeDelegatedCommand(Buffer.from(current.command_bytes));
      const result = await readFinal(original.request, codec.createDelegatedRecovery(original.request).request,
        async () => { await checkFinal(); }, guard, cancellation.signal);
      const observed = await owner.observeAuthorityFinalization.call(journal, commandId, Buffer.from(JSON.stringify(result.response)), true, captured, cancellation.signal);
      await checkFinal(); return observed;
    },
    async recoverReceipt() {
      const current = await checkFinal(); if (!current.first_response) unavailable();
      const original = codec.encodeDelegatedCommand(Buffer.from(current.command_bytes));
      const result = await readReceipt(original.request, codec.createDelegatedRecovery(original.request).request,
        async () => { await checkFinal(); }, guard, cancellation.signal);
      guard();
      await owner.observeAuthorityFinalization.call(journal, commandId, Buffer.from(JSON.stringify(result.original_response)), true, captured, cancellation.signal);
      const verified = await owner.verifyAuthorityReceipt.call(journal, commandId, Buffer.from(result.compact_jws), captured, receiptVerifier, cancellation.signal);
      await checkFinal(); guard();
      return Object.freeze({ receipt_digest: verified.receipt_digest, first_observed_at: verified.first_observed_at,
        receipt_expires_at: verified.receipt_expires_at, execution_authorized: false, live_status_verified: false });
    },
    close() {
      closed = true; cancellation.abort(); native.close();
      for (const form of forms) PreparedProofAssociation.prototype.close.call(form); forms.clear();
    },
  });
}
