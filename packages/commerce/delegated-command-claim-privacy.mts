import type { CommerceKernel, Row } from './kernel.mts';
import {
  CLAIM_KIND, commandClaimRecords, validateCommandClaimRows,
  commandClaimHeld, retireCommandClaim,
} from './delegated-command-claim-records.mts';
import type { CommandClaimBody } from './delegated-command-claim-records.mts';

type ClaimScope = { tenant_id: string; store_id: string };
type Original = Record<string, Row[]>;

function suppressed(k: CommerceKernel, body: CommandClaimBody, checkpoint?: Row): boolean {
  const subject = (row: Row) => row.tenant_id === body.tenant_id &&
    row.store_id === body.store_id && row.subject_hash === body.subject_ref;
  const resource = (row: Row) => row.tenant_id === body.tenant_id &&
    row.store_id === body.store_id && row.resource_id === body.resource_id;
  return !!k.db.prepare(
    'SELECT 1 FROM commerce_privacy_subjects WHERE tenant_id=? AND store_id=? AND subject_hash=?',
  ).get(body.tenant_id, body.store_id, body.subject_ref) ||
    !!k.db.prepare(
      'SELECT 1 FROM commerce_privacy_resources WHERE tenant_id=? AND store_id=? AND resource_id=?',
    ).get(body.tenant_id, body.store_id, body.resource_id) ||
    !!checkpoint?.subjects?.some(subject) || !!checkpoint?.resources?.some(resource);
}

/** A transferred package never authenticates later destination contents. Both
 * sides must pass the strict typed parser before the enclosing transaction writes. */
export function preflightDelegatedCommands(k: CommerceKernel, scope?: ClaimScope, original?: Original): void {
  commandClaimRecords(k, scope);
  if (original) validateCommandClaimRows(k,
    (original.commerce_support_documents ?? []).filter(row => row.kind === CLAIM_KIND));
}

export function hasDelegatedCommandSubject(k: CommerceKernel, tenant: string, store: string, subject: string): boolean {
  return commandClaimRecords(k, { tenant_id: tenant, store_id: store })
    .some(record => record.body.subject_ref === subject);
}

export function delegatedCommandResourceSubjects(k: CommerceKernel, tenant: string, store: string, resources: readonly string[]): string[] {
  const ids = new Set(resources);
  return [...new Set(commandClaimRecords(k, { tenant_id: tenant, store_id: store })
    .filter(record => ids.has(record.body.resource_id)).map(record => record.body.subject_ref))];
}

/** Privacy export is an authorized subject projection of unverified history.
 * Current suppression removes a replayed original even when an old hold exists. */
export function exportDelegatedCommandSubject(k: CommerceKernel, tenant: string, store: string, subject: string) {
  return commandClaimRecords(k, { tenant_id: tenant, store_id: store })
    .filter(record => record.body.subject_ref === subject)
    .map(record => suppressed(k, record.body) ? retireCommandClaim(k, record, 'subject_erased', true) : record)
    .map(record => ({
      ...structuredClone(record.body),
      retained_under_hold: record.body.personal !== null && commandClaimHeld(k, record.body),
      subject_projection: true,
      evidence_status: 'historical_unverified_observation',
      observation_origin: 'local_unverified_input',
      provider_authenticated: false,
      receipt_signature_verified: false,
      execution_authorized: false,
      credentials_included: false,
    }));
}

/** Run before native resource pseudonymization, including held and already-erased
 * paths. The retained UUID/digest and challenge fingerprints are never released. */
export function eraseDelegatedCommands(k: CommerceKernel, tenant: string, store: string,
  subjects: readonly string[], resources: readonly string[], minimize = true): void {
  const hashes = new Set(subjects), ids = new Set(resources);
  const records = commandClaimRecords(k, { tenant_id: tenant, store_id: store })
    .filter(record => hashes.has(record.body.subject_ref) || ids.has(record.body.resource_id));
  for (const record of records)
    retireCommandClaim(k, record, 'subject_erased', minimize || suppressed(k, record.body));
}

export function revokeDelegatedCommandsForUninstall(k: CommerceKernel, tenant: string, store: string): void {
  for (const record of commandClaimRecords(k, { tenant_id: tenant, store_id: store }))
    retireCommandClaim(k, record, 'uninstall', suppressed(k, record.body) || !commandClaimHeld(k, record.body));
}

/** Only the existing first-import document pause may permit an incoherent SQL
 * revoked state temporarily. All ordinary and repeated-import preflights stay
 * strict. Validate every hold before changing rows; callers own atomic rollback. */
export function revokeDelegatedCommandsForRestore(k: CommerceKernel, scope?: ClaimScope,
  checkpoint?: Row, allowRevokedRow = false): void {
  const records = commandClaimRecords(k, scope, allowRevokedRow);
  const erased = new Set(records.filter(record => suppressed(k, record.body, checkpoint)));
  for (const record of records) {
    if (record.body.personal !== null && !erased.has(record) && commandClaimHeld(k, record.body))
      throw new Error('DELEGATED_COMMAND_RESTORE_HELD');
  }
  for (const record of records)
    retireCommandClaim(k, record, erased.has(record) ? 'subject_erased' : 'restored', true);
}
