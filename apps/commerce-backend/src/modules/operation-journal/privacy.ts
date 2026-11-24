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
  start_owner_digest: null,
  start_claimed_at: null,
  start_command_bytes: null,
  start_command_digest: null,
  start_correlation: null,
  start_response_bytes: null,
  start_response_digest: null,
  start_response_observed_at: null,
  request_bytes: null,
  request_digest: null,
  request_context_digest: null,
  request_nonce: null,
  request_observed_at: null,
  request_expires_at: null,
  proof_context_bytes: null,
  proof_context_digest: null,
  proof_digest: null,
  proof_owner_digest: null,
  proof_claimed_at: null,
  proof_submission_bytes: null,
  proof_submission_digest: null,
  proof_submission_observed_at: null,
  final_command_bytes: null,
  final_command_digest: null,
  final_owner_digest: null,
  final_claimed_at: null,
  final_response_bytes: null,
  final_response_digest: null,
  final_response_observed_at: null,
  payment_collection_id: null,
  payment_session_id: null,
  payment_provider_id: null,
  payment_context_digest: null,
  payment_observed_at: null,
  native_payment_id: null,
  native_payment_observed_at: null,
  execution_claimed_at: null,
  execution_expires_at: null,
  execution_order_id: null,
  receipt_bytes: null,
  receipt_digest: null,
  receipt_context_digest: null,
  receipt_id: null,
  receipt_observed_at: null,
  receipt_expires_at: null,
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

/** Internal read-only delivery comparison uses the same canonical marker IDs. */
export function journalPrivacyMarkerIds(transaction: Postgres, scope: SubjectScope, key: Buffer) {
  return [privacyRecordId(transaction, key, installationPurpose, scope),
    privacyRecordId(transaction, key, subjectPurpose, scope, scope.customer_id)];
}

function lockSubject(transaction: Postgres, scope: SubjectScope, key: Buffer) {
  return lockPrivacyRecord(transaction, privacyRecordId(transaction, key, subjectPurpose, scope, scope.customer_id));
}

function installationKeyPartition(scope: InstallationScope) {
  return JSON.stringify(["urn:rifare:medusa-journal-installation-key:v1", scope.merchant_namespace, scope.store_id]);
}

export function journalPrivacyInstallationId(scope: InstallationScope) {
  return `sha256:${createHash("sha256").update(installationKeyPartition(scope)).digest("hex")}`;
}

async function requireInstallationKey(transaction: Postgres, scope: InstallationScope, key: Buffer) {
  const partition = installationKeyPartition(scope);
  const id = journalPrivacyInstallationId(scope);
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
    "start_owner_digest", "start_claimed_at", "start_command_bytes", "start_command_digest", "start_correlation",
    "start_response_bytes", "start_response_digest", "start_response_observed_at",
    "request_bytes", "request_digest", "request_context_digest", "request_nonce", "request_observed_at", "request_expires_at",
    "proof_context_bytes", "proof_context_digest", "proof_digest", "proof_owner_digest",
    "proof_claimed_at", "proof_submission_bytes", "proof_submission_digest", "proof_submission_observed_at",
    "final_command_uuid", "final_command_bytes", "final_command_digest", "final_owner_digest",
    "final_claimed_at", "final_response_bytes", "final_response_digest", "final_response_observed_at",
    "payment_fingerprint", "payment_collection_id", "payment_session_id", "payment_provider_id", "payment_context_digest", "payment_observed_at",
    "native_payment_fingerprint", "native_payment_id", "native_payment_observed_at",
    "execution_owner_fingerprint", "execution_seal_fingerprint", "execution_payment_handle_fingerprint",
    "execution_generation", "execution_claimed_at", "execution_expires_at", "execution_revoked_at", "execution_payment_attempted_at",
    "execution_order_id", "execution_order_fingerprint",
    "receipt_fingerprint", "receipt_bytes", "receipt_digest", "receipt_context_digest", "receipt_id", "receipt_observed_at", "receipt_expires_at",
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
  receipt_fingerprint?: string | null;
  final_command_uuid?: string | null;
  payment_fingerprint?: string | null;
  native_payment_fingerprint?: string | null;
  execution_owner_fingerprint?: string;
  execution_seal_fingerprint?: string;
  execution_payment_handle_fingerprint?: string;
  execution_order_fingerprint?: string | null;
  execution_payment_attempted_at?: string | null;
}>;

const restoreConflict = () => new Error("Invalid or conflicting journal refusal identity");

function validateRefusalIdentity(row: RefusalIdentity) {
  const hasReceipt = row && Object.hasOwn(row, "receipt_fingerprint");
  const hasFinal = row && Object.hasOwn(row, "final_command_uuid");
  const hasPayment = row && Object.hasOwn(row, "payment_fingerprint");
  const hasNativePayment = row && Object.hasOwn(row, "native_payment_fingerprint");
  const executionKeys = ["execution_owner_fingerprint", "execution_seal_fingerprint", "execution_payment_handle_fingerprint",
    "execution_order_fingerprint", "execution_payment_attempted_at"] as const;
  const executionPresence = executionKeys.map(key => row && Object.hasOwn(row, key));
  const hasExecution = executionPresence.every(Boolean);
  const partialExecution = executionPresence.some(Boolean) && !hasExecution;
  const fingerprint = (value: unknown) => typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
  const attempted = hasExecution && row.execution_payment_attempted_at !== null &&
    typeof row.execution_payment_attempted_at === "string" ? new Date(row.execution_payment_attempted_at) : null;
  if (!row || typeof row !== "object" || partialExecution ||
      Object.keys(row).length !== (3 + Number(hasReceipt) + Number(hasFinal) + Number(hasPayment) + Number(hasNativePayment) + (hasExecution ? executionKeys.length : 0)) ||
      (hasExecution && (!hasPayment || !row.payment_fingerprint || !fingerprint(row.execution_owner_fingerprint) ||
        !fingerprint(row.execution_seal_fingerprint) || !fingerprint(row.execution_payment_handle_fingerprint) ||
        (row.execution_order_fingerprint !== null && !fingerprint(row.execution_order_fingerprint)) ||
        (row.execution_payment_attempted_at !== null && (!(attempted instanceof Date) ||
          Number.isNaN(attempted.getTime()) || attempted.toISOString() !== row.execution_payment_attempted_at)))) ||
      (hasNativePayment && (!hasPayment || row.native_payment_fingerprint !== null &&
        (typeof row.native_payment_fingerprint !== "string" || !/^sha256:[0-9a-f]{64}$/.test(row.native_payment_fingerprint) || !row.payment_fingerprint))) ||
      (hasPayment && (!hasFinal || !hasReceipt || row.payment_fingerprint !== null &&
        (typeof row.payment_fingerprint !== "string" || !/^sha256:[0-9a-f]{64}$/.test(row.payment_fingerprint) ||
          !row.final_command_uuid || !row.receipt_fingerprint))) ||
      (hasFinal && (!hasReceipt || row.final_command_uuid !== null &&
        (typeof row.final_command_uuid !== "string" ||
          !/^(?!00000000-0000-0000-0000-000000000000$)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(row.final_command_uuid) ||
          row.final_command_uuid === row.original_command_uuid))) ||
      (hasReceipt && row.receipt_fingerprint !== null &&
        (typeof row.receipt_fingerprint !== "string" || !/^sha256:[0-9a-f]{64}$/.test(row.receipt_fingerprint))) ||
      typeof row.id !== "string" || !/^rifop_[A-Za-z0-9_-]{1,100}$/.test(row.id) ||
      typeof row.original_command_uuid !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(row.original_command_uuid) ||
      row.original_command_uuid === "00000000-0000-0000-0000-000000000000" ||
      (row.challenge_fingerprint !== null &&
        (typeof row.challenge_fingerprint !== "string" || !/^sha256:[0-9a-f]{64}$/.test(row.challenge_fingerprint)))) {
    throw restoreConflict();
  }
  return { id: row.id, original_command_uuid: row.original_command_uuid, challenge_fingerprint: row.challenge_fingerprint,
    ...(hasReceipt ? { receipt_fingerprint: row.receipt_fingerprint! } : {}),
    ...(hasFinal ? { final_command_uuid: row.final_command_uuid! } : {}),
    ...(hasPayment ? { payment_fingerprint: row.payment_fingerprint! } : {}),
    ...(hasNativePayment ? { native_payment_fingerprint: row.native_payment_fingerprint! } : {}),
    ...(hasExecution ? {
      execution_owner_fingerprint: row.execution_owner_fingerprint!,
      execution_seal_fingerprint: row.execution_seal_fingerprint!,
      execution_payment_handle_fingerprint: row.execution_payment_handle_fingerprint!,
      execution_order_fingerprint: row.execution_order_fingerprint!,
      execution_payment_attempted_at: attempted,
    } : {}) };
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
      "id", "challenge_fingerprint", "receipt_fingerprint", "final_command_uuid", "payment_fingerprint", "native_payment_fingerprint",
      "execution_owner_fingerprint", "execution_seal_fingerprint", "execution_payment_handle_fingerprint",
      "execution_order_fingerprint", "execution_payment_attempted_at", "state", "merchant_namespace", "store_id", "privacy_hold",
    );
    const incomingExecution = Object.hasOwn(row, "execution_owner_fingerprint");
    const retainedExecution = retained?.execution_owner_fingerprint !== null;
    const retainedAttempt = retained?.execution_payment_attempted_at instanceof Date ?
      retained.execution_payment_attempted_at.toISOString() : null;
    if (!retained || retained.id !== row.id || retained.challenge_fingerprint !== row.challenge_fingerprint ||
        (retained.receipt_fingerprint !== null && retained.receipt_fingerprint !== row.receipt_fingerprint) ||
        (retained.final_command_uuid !== null && retained.final_command_uuid !== row.final_command_uuid) ||
        (retained.payment_fingerprint !== null && retained.payment_fingerprint !== row.payment_fingerprint) ||
        (retained.native_payment_fingerprint !== null && retained.native_payment_fingerprint !== row.native_payment_fingerprint) ||
        (retainedExecution && (!incomingExecution || retained.execution_owner_fingerprint !== row.execution_owner_fingerprint ||
          retained.execution_seal_fingerprint !== row.execution_seal_fingerprint ||
          retained.execution_payment_handle_fingerprint !== row.execution_payment_handle_fingerprint ||
          (retained.execution_order_fingerprint !== null && retained.execution_order_fingerprint !== row.execution_order_fingerprint) ||
          (retainedAttempt !== null && retainedAttempt !== (row.execution_payment_attempted_at?.toISOString() ?? null))))) {
      throw restoreConflict();
    }
    const execution = !incomingExecution ? {} : !retainedExecution ? {
      execution_owner_fingerprint: row.execution_owner_fingerprint,
      execution_seal_fingerprint: row.execution_seal_fingerprint,
      execution_payment_handle_fingerprint: row.execution_payment_handle_fingerprint,
      execution_order_fingerprint: row.execution_order_fingerprint,
      execution_payment_attempted_at: row.execution_payment_attempted_at,
    } : {
      ...(retained.execution_order_fingerprint === null && row.execution_order_fingerprint !== null ?
        { execution_order_fingerprint: row.execution_order_fingerprint } : {}),
      ...(retainedAttempt === null && row.execution_payment_attempted_at !== null ?
        { execution_payment_attempted_at: row.execution_payment_attempted_at } : {}),
    };
    if (retained.state === "retired" && retained.merchant_namespace === null && retained.store_id === null) {
      if (retained.receipt_fingerprint === null && row.receipt_fingerprint) await selected().update({ receipt_fingerprint: row.receipt_fingerprint });
      if (retained.final_command_uuid === null && row.final_command_uuid) await selected().update({ final_command_uuid: row.final_command_uuid });
      if (retained.payment_fingerprint === null && row.payment_fingerprint) await selected().update({ payment_fingerprint: row.payment_fingerprint });
      if (retained.native_payment_fingerprint === null && row.native_payment_fingerprint) await selected().update({ native_payment_fingerprint: row.native_payment_fingerprint });
      if (Object.keys(execution).length) await selected().update(execution);
      continue;
    }
    if (retained.privacy_hold || retained.merchant_namespace !== scope.merchant_namespace ||
        retained.store_id !== scope.store_id) throw restoreConflict();
    await selected().update({
      ...minimizedOperationFields,
      ...(row.receipt_fingerprint ? { receipt_fingerprint: row.receipt_fingerprint } : {}),
      ...(row.final_command_uuid ? { final_command_uuid: row.final_command_uuid } : {}),
      ...(row.payment_fingerprint ? { payment_fingerprint: row.payment_fingerprint } : {}),
      ...(row.native_payment_fingerprint ? { native_payment_fingerprint: row.native_payment_fingerprint } : {}),
      ...execution,
      state: "retired",
      revision: transaction.raw("revision + 1"),
      updated_at: transaction.fn.now(),
    });
  }
}
