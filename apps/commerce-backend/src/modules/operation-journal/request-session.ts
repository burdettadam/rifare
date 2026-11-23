import OperationJournalService from "./service";
import { openNativeAuthoritySession } from "./authority-sender";
import { PinnedRequestVerifier } from "./request-verifier";

type Context = Parameters<OperationJournalService["admit"]>[1];
const unavailable = () => new Error("Verified authority session is unavailable");

/** Compose the real C6 retrieval with native verification. Its private results
 * cannot be supplied to another session as a verification or effect assertion. */
export async function openVerifiedAuthoritySession(journal: OperationJournalService,
  input: Uint8Array, descriptor: Uint8Array, context: Context, transport: unknown, verifier: unknown) {
  if (!(verifier instanceof PinnedRequestVerifier)) throw unavailable();
  const owner = OperationJournalService.prototype;
  const verify = owner.verifyAuthorityRequest.bind(journal) as OperationJournalService["verifyAuthorityRequest"];
  const recover = owner.recoverVerifiedAuthorityRequest.bind(journal) as OperationJournalService["recoverVerifiedAuthorityRequest"];
  const captured = { actor: { ...context.actor }, salesChannelIds: [...context.salesChannelIds] };
  const native = await openNativeAuthoritySession(journal, input, descriptor, captured, transport);
  const commandId = native.operation.original_command_uuid;
  const cancellation = new AbortController();
  const results = new WeakMap<object, Awaited<ReturnType<typeof verify>>>();
  let closed = false;
  const guard = () => { if (closed) throw unavailable(); };
  const retain = (result: Awaited<ReturnType<typeof verify>>) => {
    guard(); const handle = Object.freeze(Object.create(null)); results.set(handle, result); return handle;
  };
  return Object.freeze({
    operation: native.operation,
    get recovery_only() { return native.recovery_only; },
    start: native.start,
    recover: native.recover,
    async verifyRequest(challenge: unknown) {
      guard();
      const artifact = await native.requestArtifact(challenge) as { compact_jws: string };
      guard();
      return retain(await verify(commandId, Buffer.from(artifact.compact_jws), captured, verifier, cancellation.signal));
    },
    async recoverVerifiedRequest() {
      guard(); const result = await recover(commandId, captured, verifier); return retain(result);
    },
    async describeVerifiedRequest(handle: unknown) {
      guard();
      const original = handle && typeof handle === "object" ? results.get(handle) : undefined;
      if (!original) throw unavailable();
      const current = await recover(commandId, captured, verifier);
      guard();
      if (current.request_digest !== original.request_digest ||
          current.first_observed_at.getTime() !== original.first_observed_at.getTime()) throw unavailable();
      return Object.freeze({ request_digest: current.request_digest, first_observed_at: current.first_observed_at,
        expires_at: current.request_expires_at, execution_authorized: false, presentation_verified: false });
    },
    close() { closed = true; cancellation.abort(); native.close(); },
  });
}
