import { randomUUID } from "node:crypto";
import type { ModulesSdkUtils } from "@medusajs/framework/utils";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
import { unavailable } from "../../cart-context/policy";
import { cartContextConfig } from "../../config/local-commerce";
import { readLockedCartFacts } from "./cart-facts";
import { parseOriginalCommand, requireCommandCartMatch } from "./command";
import { journalSubjectIsSuppressed } from "./privacy";

type Postgres = ReturnType<typeof ModulesSdkUtils.createPgConnection>;
type AdmissionContext = Parameters<typeof readLockedCartFacts>[3];

const operations = "rifare_operation";
const conflict = () => new MedusaError(MedusaError.Types.CONFLICT, "Original commerce command unavailable");

export default class OperationJournalService {
  private readonly postgres: Postgres;

  constructor({ [ContainerRegistrationKeys.PG_CONNECTION]: postgres }: { [ContainerRegistrationKeys.PG_CONNECTION]: Postgres }) {
    this.postgres = postgres;
  }

  /** Internal entry point. The caller supplies framework-verified request context. */
  async admit(input: Uint8Array, context: AdmissionContext) {
    const merchant = cartContextConfig(process.env);
    const encodedKey = process.env.RIFARE_JOURNAL_PRIVACY_KEY ?? "";
    const key = Buffer.from(encodedKey, "base64url");
    if (!merchant || !/^[A-Za-z0-9_-]{43}$/.test(encodedKey) ||
        key.length !== 32 || key.toString("base64url") !== encodedKey) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Operation journal is unavailable");
    }
    const original = parseOriginalCommand(input);
    const { command, commandBytes, commandDigest } = original;
    const { actor, salesChannelIds } = context;
    if (actor.actor_type !== "customer" || !/^cus_[A-Za-z0-9]{1,100}$/.test(actor.actor_id) ||
        !actor.auth_identity_id) throw unavailable();
    const verifiedContext = { actor: { ...actor }, salesChannelIds: [...salesChannelIds] };
    const subject = { ...merchant, customer_id: verifiedContext.actor.actor_id };

    // Serialization failures are local rollbacks. Retry only this transaction,
    // using the same detached original bytes and verified context each time.
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.postgres.transaction(async tx => {
          if (await journalSubjectIsSuppressed(tx, subject, key)) throw unavailable();
          const locked = await readLockedCartFacts(tx, command.cart_id, merchant, verifiedContext);

          const retained = await tx(operations).where({ original_command_uuid: command.command_id }).first(
            "id", "original_command_uuid", "state", "revision", "merchant_namespace", "store_id",
            "customer_id", "cart_id", "actor_digest", "command_bytes", "command_digest",
          );
          if (retained) {
            if (retained.state === "retired" || retained.merchant_namespace !== subject.merchant_namespace ||
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
          }).onConflict("original_command_uuid").ignore().returning(["id", "original_command_uuid", "state", "revision"]);
          if (!created) throw conflict();
          return created;
        }, { isolationLevel: "serializable" });
      } catch (error) {
        if (attempt >= 3 || (error as { code?: string })?.code !== "40001") throw error;
      }
    }
  }
}
