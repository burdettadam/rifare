import type { DatabaseSync } from 'node:sqlite';
import { exact, id, integer } from '../commerce/kernel.mts';
import type { CommerceKernel, Scope, Row } from '../commerce/kernel.mts';
import { canonical, contentDigest, jsonValue } from '../commerce/configuration-values.mts';

export const PREVENTION_COST_CATEGORIES = Object.freeze([
  'goods', 'shipping', 'return_shipping', 'platform_fees', 'operator_time', 'model', 'messaging', 'hosting', 'software',
]);
type Source = { db: DatabaseSync; identity: string; tenant: string; store: string; clock: () => number; order: (id: string) => Row };
function checked(row: Row | undefined) {
  if (!row) throw new Error('PREVENTION_SOURCE_MISSING');
  const value = JSON.parse(row.body);
  if (contentDigest(value) !== row.digest) throw new Error('PREVENTION_SOURCE_INTEGRITY');
  return value;
}
function safeDigest(order: Row) {
  const { address, ...rest } = order;
  return contentDigest({ ...rest, address_digest: contentDigest(address) });
}
function minor(x: unknown) {
  if (typeof x !== 'string' || !/^(0|[1-9][0-9]{0,23})$/.test(x)) throw new Error('PREVENTION_MONEY_INVALID');
  return BigInt(x);
}
function transaction<T>(db: DatabaseSync, fn: () => T) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
export function initializePreventionSource(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS edit_source_prevention_enrollments (
      order_id TEXT PRIMARY KEY, body TEXT NOT NULL CHECK(json_valid(body)), digest TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS edit_source_prevention_consents (
      edit_id TEXT PRIMARY KEY, order_id TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)),
      digest TEXT NOT NULL, revoked INTEGER NOT NULL CHECK(revoked IN (0,1)),
      consumed INTEGER NOT NULL CHECK(consumed IN (0,1))
    ) STRICT;
    CREATE TABLE IF NOT EXISTS edit_source_prevention_outcomes (
      order_id TEXT NOT NULL, version INTEGER NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)),
      digest TEXT NOT NULL, PRIMARY KEY(order_id,version)
    ) STRICT;
  `);
}

/** Trusted fixture bridge; never expose this administration function as an HTTP action. */
export function enrollPreventionSource(source: Source, input: Row) {
  const p = exact(jsonValue(input), ['resource_id', 'customer_id', 'experiment_id', 'configuration_digest', 'original_version', 'original_digest']);
  id(p.resource_id); id(p.customer_id); id(p.experiment_id); integer(p.original_version, 1);
  return transaction(source.db, () => {
    const old = source.db.prepare('SELECT * FROM edit_source_prevention_enrollments WHERE order_id=?').get(p.resource_id) as Row;
    if (old) {
      const b = checked(old);
      if (contentDigest(b.enrollment) !== contentDigest(p) || b.source_identity !== source.identity) throw new Error('PREVENTION_ENROLLMENT_CONFLICT');
      return b;
    }
    const order = source.order(p.resource_id);
    if (order.customer_id !== p.customer_id || order.version !== p.original_version || safeDigest(order) !== p.original_digest) throw new Error('PREVENTION_SOURCE_CHANGED');
    const value = { enrollment: p, source_identity: source.identity, original_paid_minor: order.net_paid_minor,
      original_units: order.lines.filter((l: Row) => l.status !== 'cancelled').reduce((n: number, l: Row) => n + l.quantity, 0),
      currency: order.currency, enrolled_at: source.clock(), qualification: 'synthetic_only' };
    source.db.prepare('INSERT INTO edit_source_prevention_enrollments VALUES(?,?,?)').run(p.resource_id, canonical(value), contentDigest(value));
    return value;
  });
}

/** Authentication is rechecked at the server bridge; a caller's claimed customer ID is insufficient. */
export function confirmPreventionSource(source: Source, k: CommerceKernel, scope: Scope, quoteId: string) {
  const s = k.require(scope);
  if (s.role !== 'customer') throw new Error('CUSTOMER_VERIFICATION_REQUIRED');
  const row = k.db.prepare('SELECT * FROM commerce_prevention_confirmations WHERE tenant_id=? AND store_id=? AND quote_id=?')
    .get(s.tenant_id, s.store_id, id(quoteId)) as Row;
  const c = checked(row);
  k.authorize(scope, 'return.request', row.resource_id);
  if (s.resource_id !== row.resource_id || s.customer_id !== row.customer_id || s.token_hash !== row.session_hash
    || row.revoked || c.customer_id !== s.customer_id || c.source_identity !== source.identity
    || s.tenant_id !== source.tenant || s.store_id !== source.store || c.expires_at <= source.clock()) throw new Error('PREVENTION_CONFIRMATION_CHANGED');
  return transaction(source.db, () => {
    const old = source.db.prepare('SELECT * FROM edit_source_prevention_consents WHERE edit_id=?').get(c.edit_id) as Row;
    if (old) {
      if (old.revoked || old.digest !== contentDigest(c)) throw new Error('PREVENTION_CONFIRMATION_CHANGED');
      checked(old); return { edit_id: c.edit_id, digest: old.digest, consumed: !!old.consumed };
    }
    const enrollment = checked(source.db.prepare('SELECT * FROM edit_source_prevention_enrollments WHERE order_id=?').get(row.resource_id) as Row);
    const order = source.order(row.resource_id);
    if (enrollment.source_identity !== source.identity || order.customer_id !== s.customer_id || order.version !== c.source_order_version
      || safeDigest(order) !== c.source_order_digest || order.currency !== c.currency) throw new Error('PREVENTION_SOURCE_CHANGED');
    source.db.prepare('INSERT INTO edit_source_prevention_consents VALUES(?,?,?,?,0,0)')
      .run(c.edit_id, row.resource_id, canonical(c), contentDigest(c));
    return { edit_id: c.edit_id, digest: contentDigest(c), consumed: false };
  });
}
export function revokePreventionSource(source: Source, editId: string) {
  return transaction(source.db, () => {
    const row = source.db.prepare('SELECT * FROM edit_source_prevention_consents WHERE edit_id=?').get(id(editId)) as Row;
    if (row) checked(row);
    source.db.prepare('UPDATE edit_source_prevention_consents SET revoked=1 WHERE edit_id=?').run(editId);
    return { revoked: true, already_committed: !!row?.consumed };
  });
}
export function preventionSourceConsent(source: Source, editId: string) {
  const row = source.db.prepare('SELECT * FROM edit_source_prevention_consents WHERE edit_id=?').get(id(editId)) as Row;
  if (!row) return null;
  const b = checked(row);
  if (b.source_identity !== source.identity) throw new Error('PREVENTION_SOURCE_CHANGED');
  return { digest: row.digest, revoked: !!row.revoked, consumed: !!row.consumed };
}

/** Runs inside the source's existing write transaction, including consent consumption. */
export function assertPreventionNative(source: Source, command: Row, order: Row) {
  const enrollment = source.db.prepare('SELECT * FROM edit_source_prevention_enrollments WHERE order_id=?').get(order.resource_id) as Row;
  if (!enrollment || command.intent?.kind === 'address') return;
  const e = checked(enrollment);
  if (e.source_identity !== source.identity || e.enrollment.customer_id !== order.customer_id) throw new Error('PREVENTION_SOURCE_CHANGED');
  const row = source.db.prepare('SELECT * FROM edit_source_prevention_consents WHERE edit_id=? AND order_id=?').get(command.edit_id, order.resource_id) as Row;
  if (!row) throw new Error('PREVENTION_NATIVE_CUSTOMER_CONFIRMATION_REQUIRED');
  const c = checked(row), beforeCommit = command.stage.startsWith('hold:') || ['begin', 'change', 'commit'].includes(command.stage);
  if (c.edit_id !== command.edit_id || c.customer_id !== order.customer_id || c.resource_id !== order.resource_id
    || c.source_identity !== source.identity || c.source_order_version !== command.original_version || c.source_order_digest !== command.original_digest
    || c.intent_digest !== contentDigest(command.intent) || c.new_total_minor !== command.new_total_minor || c.delta_minor !== command.delta_minor
    || c.currency !== order.currency || contentDigest(c.line_ids) !== contentDigest(command.line_ids)) throw new Error('PREVENTION_NATIVE_CONFIRMATION_MISMATCH');
  if (beforeCommit && (row.revoked || row.consumed || c.expires_at <= source.clock())) throw new Error('PREVENTION_NATIVE_CONFIRMATION_UNAVAILABLE');
  if (!beforeCommit && !row.consumed) throw new Error('PREVENTION_NATIVE_COMMIT_REQUIRED');
  if (command.stage === 'commit') source.db.prepare('UPDATE edit_source_prevention_consents SET consumed=1 WHERE edit_id=? AND consumed=0').run(command.edit_id);
}

/** A separate synthetic outcome/cost ledger. Its figures are fixture observations, never verified merchant economics. */
export function fixturePreventionOutcome(source: Source, input: Row) {
  const p = exact(jsonValue(input), ['resource_id', 'version', 'through_at', 'returned_units', 'retained_revenue_minor', 'costs', 'source_ref']);
  id(p.resource_id); id(p.source_ref); integer(p.version, 1); integer(p.through_at); integer(p.returned_units);
  if (p.through_at > source.clock()) throw new Error('PREVENTION_FOLLOWUP_INVALID');
  exact(p.costs, [...PREVENTION_COST_CATEGORIES]);
  for (const value of Object.values(p.costs)) if (value !== null) minor(value);
  if (p.retained_revenue_minor !== null) minor(p.retained_revenue_minor);
  return transaction(source.db, () => {
    const order = source.order(p.resource_id), enrollment = source.db.prepare('SELECT * FROM edit_source_prevention_enrollments WHERE order_id=?').get(p.resource_id) as Row;
    const initial = enrollment ? checked(enrollment) : { original_units: order.lines.reduce((n: number, l: Row) => n + l.quantity, 0), original_paid_minor: order.net_paid_minor };
    if (p.returned_units > initial.original_units || p.retained_revenue_minor !== null && minor(p.retained_revenue_minor) > minor(initial.original_paid_minor)) throw new Error('PREVENTION_OUTCOME_INVALID');
    const previous = source.db.prepare('SELECT * FROM edit_source_prevention_outcomes WHERE order_id=? ORDER BY version DESC LIMIT 1').get(p.resource_id) as Row;
    if (previous) {
      const prior = checked(previous);
      if (p.version === previous.version && contentDigest(prior.input) === contentDigest(p)) return prior;
      if (p.version !== previous.version + 1 || p.through_at < prior.input.through_at) throw new Error('PREVENTION_OUTCOME_CHANGED');
    } else if (p.version !== 1) throw new Error('PREVENTION_OUTCOME_CHANGED');
    const value = { input: p, source_identity: source.identity, customer_id: order.customer_id, currency: order.currency,
      basis: 'declared_separate_synthetic_outcome_ledger_not_processor_settlement', observed_at: source.clock() };
    source.db.prepare('INSERT INTO edit_source_prevention_outcomes VALUES(?,?,?,?)').run(p.resource_id, p.version, canonical(value), contentDigest(value));
    return value;
  });
}
export function preventionSourceOutcome(source: Source, resource: string) {
  const row = source.db.prepare('SELECT * FROM edit_source_prevention_outcomes WHERE order_id=? ORDER BY version DESC LIMIT 1').get(id(resource)) as Row;
  return row ? { version: row.version, body: checked(row), digest: row.digest } : null;
}
