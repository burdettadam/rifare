import { createHmac } from "node:crypto";
import type { ModulesSdkUtils } from "@medusajs/framework/utils";

type Postgres = ReturnType<typeof ModulesSdkUtils.createPgConnection>;
type SubjectScope = Readonly<{ merchant_namespace: string; store_id: string; customer_id: string }>;

const minimized = {
  merchant_namespace: null,
  store_id: null,
  customer_id: null,
  cart_id: null,
  actor_digest: null,
  command_bytes: null,
  command_digest: null,
  cart_facts_digest: null,
  payable_minor_units: null,
  currency: null,
  currency_exponent: null,
  first_observation_digest: null,
  first_observed_at: null,
};

async function lockSubject(transaction: Postgres, scope: SubjectScope, key: Buffer) {
  if (!transaction.isTransaction || key.byteLength !== 32) {
    throw new Error("A journal transaction and a 32-byte privacy key are required");
  }
  const partition = JSON.stringify([
    "urn:rifare:medusa-journal-privacy-subject:v1", scope.merchant_namespace, scope.store_id, scope.customer_id,
  ]);
  const id = `hmac-sha256:${createHmac("sha256", key).update(partition).digest("hex")}`;
  // The conflicting update acquires the same PostgreSQL row lock even when the
  // subject had no prior record. It never clears an existing suppression.
  const [record] = await transaction("rifare_operation_privacy_subject")
    .insert({ id })
    .onConflict("id").merge({ updated_at: transaction.fn.now() })
    .returning(["id", "suppressed"]);
  return record as { id: string; suppressed: boolean };
}

export async function journalSubjectIsSuppressed(transaction: Postgres, scope: SubjectScope, key: Buffer) {
  return (await lockSubject(transaction, scope, key)).suppressed;
}

/** This is called inside the authorized privacy owner's transaction. */
export async function eraseJournalSubject(transaction: Postgres, scope: SubjectScope, key: Buffer) {
  const { id } = await lockSubject(transaction, scope, key);
  await transaction("rifare_operation_privacy_subject").where({ id }).update({ suppressed: true });
  const subjectOperations = () => transaction("rifare_operation").where(scope);
  const retire = {
    state: "retired",
    revision: transaction.raw("revision + 1"),
    updated_at: transaction.fn.now(),
  };
  await subjectOperations().where({ privacy_hold: true }).whereNot({ state: "retired" }).update(retire);
  await subjectOperations().where({ privacy_hold: false }).update({ ...retire, ...minimized });
}

/** Hold changes share the subject lock used by admission and erasure. */
export async function setJournalOperationHold(
  transaction: Postgres, scope: SubjectScope, key: Buffer, id: string, expectedRevision: number, held: boolean,
) {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || typeof held !== "boolean") return false;
  const { suppressed } = await lockSubject(transaction, scope, key);
  if (held && suppressed) return false;

  const update = {
    privacy_hold: held,
    updated_at: transaction.fn.now(),
    revision: transaction.raw("revision + 1"),
  };
  const changed = await transaction("rifare_operation").where({ ...scope, id, revision: expectedRevision })
    .whereNot({ privacy_hold: held })
    .update(suppressed ? { ...update, state: "retired", ...minimized } : update);
  return changed === 1;
}
