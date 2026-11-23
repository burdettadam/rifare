import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { MedusaError } from "@medusajs/framework/utils";
import OperationJournalService from "./service";

type Context = Parameters<OperationJournalService["admit"]>[1];
type RetainedStart = { command_bytes: string; command_digest: string; correlation: string };
const unavailable = () => new MedusaError(MedusaError.Types.NOT_ALLOWED, "Authority sender is unavailable");

/** The repository launcher retains the shared C1 and public transport sources.
 * Use their actual classes/codecs, without importing the diagnostic database owner. */
async function adapters() {
  const directory = resolve(process.cwd(), "../../packages/adapters/delegated-commands");
  const [wire, codec] = await Promise.all([
    import(pathToFileURL(resolve(directory, "public-use-client.mts")).href),
    import(pathToFileURL(resolve(directory, "command-codec.mts")).href),
  ]);
  return { wire, codec };
}

export async function openNativeAuthoritySession(
  journal: OperationJournalService, input: Uint8Array, descriptor: Uint8Array,
  context: Context, transport: unknown,
) {
  if (!(journal instanceof OperationJournalService) || !(input instanceof Uint8Array) ||
      !(descriptor instanceof Uint8Array) || input.byteLength > 1024 || descriptor.byteLength > 4096) {
    throw unavailable();
  }
  const originalBytes = Buffer.from(input), descriptorBytes = Buffer.from(descriptor);
  const capturedContext = { actor: { ...context.actor }, salesChannelIds: [...context.salesChannelIds] };
  const { wire, codec } = await adapters();
  if (!(transport instanceof wire.PublicDelegatedUseClient)) throw unavailable();
  const prototype = wire.PublicDelegatedUseClient.prototype;
  const boundTo = prototype.boundTo.bind(transport);
  const send = prototype.startAfterAdmission.bind(transport);
  const recover = prototype.recoverAfterAdmission.bind(transport);
  const fetchRequest = prototype.fetchRequestAfterAdmission.bind(transport);
  const owner = OperationJournalService.prototype;
  const admit = owner.admitForAuthority.bind(journal);
  const retain = owner.retainAuthorityStart.bind(journal);
  const claim = owner.claimAuthorityDispatch.bind(journal);
  const recovery = owner.prepareRecovery.bind(journal);
  const admitted = await admit(originalBytes, capturedContext);
  const commandId = admitted.operation.original_command_uuid;
  let ticket = admitted.send_ticket;
  let retained: RetainedStart;
  if (ticket) {
    retained = await retain(commandId, ticket, descriptorBytes, capturedContext);
  } else {
    const previous = await recovery(commandId, capturedContext);
    if (!previous.authority_start) throw unavailable();
    retained = previous.authority_start as RetainedStart;
  }
  const encoded = codec.encodeDelegatedCommand(Buffer.from(retained.command_bytes));
  if (encoded.request.command !== "START_USE" || encoded.canonical_json !== retained.command_bytes ||
      encoded.command_digest !== retained.command_digest || encoded.original_command_id !== commandId ||
      !boundTo(JSON.parse(retained.correlation))) throw unavailable();
  const recoveryCommand = codec.createDelegatedRecovery(encoded.request).request;
  let closed = false;
  const guard = () => { if (closed) throw unavailable(); };
  const checkRecovery = async () => {
    guard();
    const current = await recovery(commandId, capturedContext);
    if (!current.authority_start || current.authority_start.command_bytes !== retained.command_bytes ||
        current.authority_start.command_digest !== retained.command_digest ||
        current.authority_start.correlation !== retained.correlation) throw unavailable();
  };
  return Object.freeze({
    operation: Object.freeze({ ...admitted.operation }),
    get recovery_only() { return ticket === null; },
    async start(): Promise<unknown> {
      guard();
      const initialTicket = ticket;
      // Consume before any await, including failures before or during TLS.
      ticket = null;
      if (!initialTicket) throw unavailable();
      const response = await send(encoded.request, async () => {
        guard();
        await claim(commandId, initialTicket, capturedContext);
      }, guard);
      await checkRecovery();
      return response;
    },
    async recover(): Promise<unknown> {
      await checkRecovery();
      const response = await recover(encoded.request, recoveryCommand, checkRecovery, guard);
      await checkRecovery();
      return response;
    },
    async requestArtifact(challenge: unknown): Promise<unknown> {
      await checkRecovery();
      const artifact = await fetchRequest(encoded.request, challenge, checkRecovery, guard);
      await checkRecovery();
      return artifact;
    },
    close() { closed = true; ticket = null; },
  });
}
