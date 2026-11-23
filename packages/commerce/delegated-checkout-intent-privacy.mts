import type { CommerceKernel, Row } from './kernel.mts';
import {
  INTENT_KIND,
  intentRecords,
  validateIntentRows,
  retireIntent,
  intentHeld,
} from './delegated-checkout-intent-records.mts';
import type { IntentBody, IntentRecord } from './delegated-checkout-intent-records.mts';

type IntentScope = { tenant_id: string; store_id: string };
type Original = Record<string, Row[]>;

function suppressed(k: CommerceKernel, body: IntentBody, checkpoint?: Row): boolean {
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

/** Validate the current destination independently of the original transferred
 * rows. An old package cannot authorize a malformed repeated-import destination. */
export function preflightDelegatedIntents(k: CommerceKernel, scope?: IntentScope, original?: Original): void {
  intentRecords(k, scope);
  if (original) validateIntentRows(k,
    (original.commerce_support_documents ?? []).filter(row => row.kind === INTENT_KIND));
}

export function hasDelegatedIntentSubject(k: CommerceKernel, tenant: string, store: string, subject: string): boolean {
  return intentRecords(k, { tenant_id: tenant, store_id: store })
    .some(record => record.body.subject_ref === subject);
}

export function delegatedIntentResourceSubjects(k: CommerceKernel, tenant: string, store: string, resources: readonly string[]): string[] {
  const ids = new Set(resources);
  return [...new Set(intentRecords(k, { tenant_id: tenant, store_id: store })
    .filter(record => ids.has(record.body.resource_id)).map(record => record.body.subject_ref))];
}

/** Original subject hashes retain ownership after resource reassignment and
 * after minimization. Within the caller's privacy transaction, current suppression
 * first scrubs any replayed personal copy. Export is data, never verifier provenance. */
export function exportDelegatedIntentSubject(k: CommerceKernel, tenant: string, store: string, subject: string) {
  return intentRecords(k, { tenant_id: tenant, store_id: store })
    .filter(record => record.body.subject_ref === subject)
    .map(record => suppressed(k, record.body) ? retireIntent(k, record, 'subject_erased', true) : record)
    .map(record => ({
      ...structuredClone(record.body),
      retained_under_hold: record.body.personal !== null && intentHeld(k, record.body),
      subject_projection: true,
      execution_authorized: false,
      credentials_included: false,
    }));
}

/** Call before resource pseudonymization, including the held and already-erased
 * paths. Existing suppression always removes replayed personal bytes, even if
 * an obsolete hold was copied alongside them. Claims are retained by retireIntent. */
export function eraseDelegatedIntents(k: CommerceKernel, tenant: string, store: string,
  subjects: readonly string[], resourceIds: readonly string[], minimize = true): void {
  const hashes = new Set(subjects), ids = new Set(resourceIds);
  const records = intentRecords(k, { tenant_id: tenant, store_id: store })
    .filter(record => hashes.has(record.body.subject_ref) || ids.has(record.body.resource_id));
  for (const record of records) {
    retireIntent(k, record, 'subject_erased', minimize || suppressed(k, record.body));
  }
}

export function revokeDelegatedIntentsForUninstall(k: CommerceKernel, tenant: string, store: string): void {
  const records = intentRecords(k, { tenant_id: tenant, store_id: store });
  for (const record of records) {
    retireIntent(k, record, 'uninstall', suppressed(k, record.body) || !intentHeld(k, record.body));
  }
}

/** Only first import, after its generic document PAUSE, passes allowRevokedRow.
 * Every ordinary preflight and repeated-import destination parse remains strict.
 * Check all holds before any retirement; the caller owns the enclosing atomic
 * restore/import transaction and has already validated the external checkpoint. */
export function revokeDelegatedIntentsForRestore(k: CommerceKernel, scope?: IntentScope,
  checkpoint?: Row, allowRevokedRow = false): void {
  const records: IntentRecord[] = intentRecords(k, scope, allowRevokedRow);
  const erased = new Set(records.filter(record => suppressed(k, record.body, checkpoint)));
  for (const record of records) {
    if (record.body.personal !== null && !erased.has(record) && intentHeld(k, record.body)) {
      throw new Error('DELEGATED_INTENT_RESTORE_HELD');
    }
  }
  for (const record of records) {
    retireIntent(k, record, erased.has(record) ? 'subject_erased' : 'restored', true);
  }
}
