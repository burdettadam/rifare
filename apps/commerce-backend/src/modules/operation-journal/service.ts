import { randomUUID } from "node:crypto";
import type { ModulesSdkUtils } from "@medusajs/framework/utils";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
import { factsDigest } from "../../cart-context/observation";
import { unavailable } from "../../cart-context/policy";
import { cartContextConfig } from "../../config/local-commerce";
import { lockCartOwner, readLockedCartFacts } from "./cart-facts";
import { parseOriginalCommand, requireCommandCartMatch } from "./command";
import {
  eraseJournalSubject, exportJournalSubject, journalSubjectIsSuppressed, minimizedOperationFields,
  restoreJournalRefusalIdentities, setJournalOperationHold, uninstallJournal,
} from "./privacy";

type Postgres = ReturnType<typeof ModulesSdkUtils.createPgConnection>;
type AdmissionContext = Parameters<typeof readLockedCartFacts>[3];
type VerifiedActor = AdmissionContext["actor"];

const operations = "rifare_operation";
const originalId = /^(?!00000000-0000-0000-0000-000000000000$)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const statusColumns = ["id", "original_command_uuid", "state", "revision"];
const historyColumns = [...statusColumns, "cart_id", "actor_digest", "command_digest",
  "privacy_hold", "first_observation_digest", "first_observed_at"];
type JournalConfiguration = ReturnType<typeof journalConfiguration>;
type Merchant = NonNullable<ReturnType<typeof cartContextConfig>>;
type JournalRow = {
  id: string; original_command_uuid: string; state: string; revision: number;
  cart_id: string; actor_digest: string; command_digest: string; privacy_hold: boolean;
  first_observation_digest: string | null; first_observed_at: Date | null;
};
const conflict = () => new MedusaError(MedusaError.Types.CONFLICT, "Original commerce command unavailable");

export default class OperationJournalService {
  private readonly postgres: Postgres;

  constructor({ [ContainerRegistrationKeys.PG_CONNECTION]: postgres }: { [ContainerRegistrationKeys.PG_CONNECTION]: Postgres }) {
    this.postgres = postgres;
  }

  /** Internal entry point. The caller supplies framework-verified request context. */
  async admit(input: Uint8Array, context: AdmissionContext) {
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
            return { id: retained.id, original_command_uuid: retained.original_command_uuid,
              state: retained.state, revision: retained.revision };
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
          }).onConflict("original_command_uuid").ignore().returning(statusColumns);
          if (!created) throw conflict();
          return created;
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
      return { id: row.id, original_command_uuid: row.original_command_uuid, command_digest: row.command_digest };
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
        .first({ user_id: tx.raw("app_metadata ->> 'user_id'") });
      const stores = await tx("store").whereNull("deleted_at").limit(2).select("id");
      if (!user || identity?.user_id !== actor_id || stores.length !== 1 || stores[0].id !== merchant.store_id) {
        throw unavailable();
      }
      return use(tx, merchant, key);
    }, { isolationLevel: "serializable" });
  }

  private async withCurrentOriginal<T>(
    commandId: string, context: AdmissionContext,
    use: (tx: Postgres, row: JournalRow, configuration: JournalConfiguration) => Promise<T>,
  ) {
    if (typeof commandId !== "string" || !originalId.test(commandId)) throw unavailable();
    const configuration = journalConfiguration(context);
    const { merchant, key, verifiedContext, subject } = configuration;
    return this.postgres.transaction(async tx => {
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
  return tx("user").where({ id: userId }).whereNull("deleted_at").first("id");
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
