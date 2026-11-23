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
import { configure } from "safe-stable-stringify";
import {
  eraseJournalSubject, exportJournalSubject, journalSubjectIsSuppressed, minimizedOperationFields,
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
  "request_observed_at", "request_expires_at"];
type JournalConfiguration = ReturnType<typeof journalConfiguration>;
type Merchant = NonNullable<ReturnType<typeof cartContextConfig>>;
type JournalRow = {
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
};
const conflict = () => new MedusaError(MedusaError.Types.CONFLICT, "Original commerce command unavailable");
const verifyRequest = PinnedRequestVerifier.prototype.verify;
const describeRequest = PinnedRequestVerifier.prototype.describe;
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
      if (row.request_digest !== result.request_digest || row.request_observed_at?.getTime() !== result.first_observed_at.getTime() ||
          (await requestClock(tx)).getTime() >= result.request_expires_at.getTime()) throw conflict();
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

function revisionFence(row: JournalRow) {
  return { id: row.id, revision: row.revision, state: "awaiting_authority" };
}

async function requestClock(transaction: Postgres): Promise<Date> {
  const value = (await transaction.raw("select clock_timestamp() as now")).rows[0]?.now;
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw conflict();
  return value;
}
