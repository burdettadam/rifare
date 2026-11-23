import { createHash, createHmac } from "node:crypto";
import type { ModulesSdkUtils } from "@medusajs/framework/utils";

type Postgres = ReturnType<typeof ModulesSdkUtils.createPgConnection>;
type InstallationScope = Readonly<{ merchant_namespace: string; store_id: string }>;
type SubjectScope = InstallationScope & Readonly<{ customer_id: string }>;

export const minimizedOperationFields = {
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

function privacyRecordId(transaction: Postgres, key: Buffer, purpose: string, scope: InstallationScope, ...subject: string[]) {
  if (!transaction.isTransaction || key.byteLength !== 32) {
    throw new Error("A journal transaction and a 32-byte privacy key are required");
  }
  const partition = JSON.stringify([purpose, scope.merchant_namespace, scope.store_id, ...subject]);
  return `hmac-sha256:${createHmac("sha256", key).update(partition).digest("hex")}`;
}

const subjectPurpose = "urn:rifare:medusa-journal-privacy-subject:v1";
const installationPurpose = "urn:rifare:medusa-journal-installation:v1";
const privacyTable = "rifare_operation_privacy_subject";
const journalTable = "rifare_operation";

async function lockPrivacyRecord(transaction: Postgres, id: string) {
  // This update synchronizes both existing and newly created markers.
  const [record] = await transaction(privacyTable).insert({ id })
    .onConflict("id").merge({ updated_at: transaction.fn.now() })
    .returning(["id", "suppressed"]);
  return record as { id: string; suppressed: boolean };
}

function lockSubject(transaction: Postgres, scope: SubjectScope, key: Buffer) {
  return lockPrivacyRecord(transaction, privacyRecordId(transaction, key, subjectPurpose, scope, scope.customer_id));
}

async function requireInstallationKey(transaction: Postgres, scope: InstallationScope, key: Buffer) {
  const partition = JSON.stringify(["urn:rifare:medusa-journal-installation-key:v1", scope.merchant_namespace, scope.store_id]);
  const id = `sha256:${createHash("sha256").update(partition).digest("hex")}`;
  const keyBinding = `hmac-sha256:${createHmac("sha256", key).update(partition).digest("hex")}`;
  const installations = "rifare_operation_privacy_installation";
  await transaction(installations).insert({ id, key_binding: keyBinding }).onConflict("id").ignore();
  const installation = await transaction(installations).where({ id }).forShare().first("key_binding");
  if (installation?.key_binding !== keyBinding) throw new Error("Journal installation privacy key is unavailable");
}

async function lockInstallationForRead(transaction: Postgres, scope: InstallationScope, key: Buffer) {
  const id = privacyRecordId(transaction, key, installationPurpose, scope);
  await requireInstallationKey(transaction, scope, key);
  await transaction(privacyTable).insert({ id }).onConflict("id").ignore();
  const marker = await transaction(privacyTable).where({ id }).forShare().first("suppressed");
  if (!marker) throw new Error("Journal installation marker is unavailable");
  return marker.suppressed === true;
}

export async function journalSubjectIsSuppressed(transaction: Postgres, scope: SubjectScope, key: Buffer) {
  return await lockInstallationForRead(transaction, scope, key) || (await lockSubject(transaction, scope, key)).suppressed;
}

/** This is called inside the authorized privacy owner's transaction. */
export async function eraseJournalSubject(transaction: Postgres, scope: SubjectScope, key: Buffer) {
  await lockInstallationForRead(transaction, scope, key);
  const { id } = await lockSubject(transaction, scope, key);
  await transaction(privacyTable).where({ id }).update({ suppressed: true });
  await retireScopedOperations(transaction, scope);
}

async function retireScopedOperations(transaction: Postgres, scope: InstallationScope | SubjectScope) {
  const subjectOperations = () => transaction(journalTable).where(scope);
  const retire = {
    state: "retired",
    revision: transaction.raw("revision + 1"),
    updated_at: transaction.fn.now(),
  };
  await subjectOperations().where({ privacy_hold: true }).whereNot({ state: "retired" }).update(retire);
  await subjectOperations().where({ privacy_hold: false }).update({ ...retire, ...minimizedOperationFields });
}

/** Hold changes share the subject lock used by admission and erasure. */
export async function setJournalOperationHold(
  transaction: Postgres, scope: SubjectScope, key: Buffer, id: string, expectedRevision: number, held: boolean,
) {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || typeof held !== "boolean") return false;
  const uninstalled = await lockInstallationForRead(transaction, scope, key);
  const subject = await lockSubject(transaction, scope, key);
  const suppressed = uninstalled || subject.suppressed;
  const selected = () => transaction(journalTable).where({ ...scope, id, revision: expectedRevision })
    .whereNot({ privacy_hold: held });
  const row = await selected().forUpdate().first("state");
  if (!row) return false;
  const retired = suppressed || row.state === "cancelled" || row.state === "retired";
  if (held && retired) return false;

  const update = {
    privacy_hold: held,
    updated_at: transaction.fn.now(),
    revision: transaction.raw("revision + 1"),
  };
  const changed = await selected().update(retired ? { ...update, state: "retired", ...minimizedOperationFields } : update);
  return changed === 1;
}

/** Scoped privacy-owner export, including retained data under an active hold. */
export async function exportJournalSubject(transaction: Postgres, scope: SubjectScope, key: Buffer) {
  await lockInstallationForRead(transaction, scope, key);
  await lockSubject(transaction, scope, key);
  const rows = await transaction(journalTable).where(scope).orderBy("id").limit(1001).select(
    "id", "original_command_uuid", "challenge_fingerprint", "state", "revision", "privacy_hold",
    "merchant_namespace", "store_id", "customer_id", "cart_id", "actor_digest",
    "cart_facts_digest", "payable_minor_units", "currency", "currency_exponent",
    "command_bytes", "command_digest", "first_observation_digest", "first_observed_at",
    "created_at", "updated_at",
  );
  if (rows.length > 1000) throw new Error("Journal subject export limit exceeded");
  return rows;
}

export async function uninstallJournal(transaction: Postgres, scope: InstallationScope, key: Buffer) {
  const id = privacyRecordId(transaction, key, installationPurpose, scope);
  await requireInstallationKey(transaction, scope, key);
  await lockPrivacyRecord(transaction, id);
  await transaction(privacyTable).where({ id }).update({ suppressed: true });
  await retireScopedOperations(transaction, { merchant_namespace: scope.merchant_namespace, store_id: scope.store_id });
}

type RefusalIdentity = Readonly<{
  id: string;
  original_command_uuid: string;
  challenge_fingerprint: string | null;
}>;

const restoreConflict = () => new Error("Invalid or conflicting journal refusal identity");

function validateRefusalIdentity(row: RefusalIdentity) {
  if (!row || typeof row !== "object" || Object.keys(row).length !== 3 ||
      typeof row.id !== "string" || !/^rifop_[A-Za-z0-9_-]{1,100}$/.test(row.id) ||
      typeof row.original_command_uuid !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(row.original_command_uuid) ||
      row.original_command_uuid === "00000000-0000-0000-0000-000000000000" ||
      (row.challenge_fingerprint !== null &&
        (typeof row.challenge_fingerprint !== "string" || !/^sha256:[0-9a-f]{64}$/.test(row.challenge_fingerprint)))) {
    throw restoreConflict();
  }
  return { id: row.id, original_command_uuid: row.original_command_uuid, challenge_fingerprint: row.challenge_fingerprint };
}

/**
 * The trusted transfer owner supplies only refusal identifiers. Import and
 * restore share this path and preserve the destination privacy markers.
 */
export async function restoreJournalRefusalIdentities(
  transaction: Postgres, scope: InstallationScope, key: Buffer, records: readonly RefusalIdentity[],
) {
  if (!Array.isArray(records) || records.length > 1000) throw restoreConflict();
  const incoming = records.map(validateRefusalIdentity)
    .sort((a, b) => a.original_command_uuid.localeCompare(b.original_command_uuid));
  await lockInstallationForRead(transaction, scope, key);
  for (const row of incoming) {
    await transaction(journalTable).insert({ ...row, state: "retired" }).onConflict().ignore();
    const selected = () => transaction(journalTable).where({ original_command_uuid: row.original_command_uuid });
    const retained = await selected().forUpdate().first(
      "id", "challenge_fingerprint", "state", "merchant_namespace", "store_id", "privacy_hold",
    );
    if (!retained || retained.id !== row.id || retained.challenge_fingerprint !== row.challenge_fingerprint) {
      throw restoreConflict();
    }
    if (retained.state === "retired" && retained.merchant_namespace === null && retained.store_id === null) continue;
    if (retained.privacy_hold || retained.merchant_namespace !== scope.merchant_namespace ||
        retained.store_id !== scope.store_id) throw restoreConflict();
    await selected().update({
      ...minimizedOperationFields,
      state: "retired",
      revision: transaction.raw("revision + 1"),
      updated_at: transaction.fn.now(),
    });
  }
}
