import { id } from './kernel.mts';
import type { CommerceKernel, Scope, Row } from './kernel.mts';
import { canonical, contentDigest } from './configuration-values.mts';
import { subjectHash, assertNotErased } from './data-guards.mts';
import { growthCustomer, growthCustomerProof } from './growth-shopping-core.mts';
import { PartnerReadiness } from './partner-readiness.mts';
import type { PartnerContext } from './partner-readiness.mts';
import { PartnerFixtureSource } from '../adapters/partner-fixture-source.mts';

export const PARTNER_SUBJECT_TABLES = Object.freeze(['commerce_protection_proposals', 'commerce_protection_confirmations', 'commerce_protection_operations',
  'commerce_duty_assessments', 'commerce_reverse_hub_routes', 'commerce_international_handoffs', 'commerce_hsa_fsa_eligibility',
  'commerce_network_alerts', 'commerce_network_alert_actions']);
function table(value: string) {if (!PARTNER_SUBJECT_TABLES.includes(value)) throw new Error('PARTNER_TABLE_INVALID'); return value;}
export function partnerBody(row: Row | undefined): Row {
  if (!row) throw new Error('NOT_FOUND'); const body = JSON.parse(row.body);
  if (contentDigest(body) !== row.digest) throw new Error('PARTNER_RECORD_INTEGRITY'); return {...row, body};
}
export function partnerResource(k: CommerceKernel, scope: Scope, resource: string, action = 'resource.read') {
  const s = k.authorize(scope, action, id(resource)), order = k.get(scope, resource);
  if (order.kind !== 'order' || !order.customer_id) throw new Error('PARTNER_ORDER_REQUIRED');
  assertNotErased(k, s, resource, order.customer_id);
  return {s, order, subject_hash: subjectHash(s.tenant_id, s.store_id, order.customer_id)};
}
export function partnerRow(k: CommerceKernel, scope: Scope, name: string, ref: string, action = 'operation.read') {
  const s = k.require(scope), row = partnerBody(k.db.prepare(`SELECT * FROM ${table(name)} WHERE tenant_id=? AND store_id=? AND id=?`)
    .get(s.tenant_id, s.store_id, id(ref)) as Row | undefined);
  k.authorize(scope, action, row.resource_id); k.get(scope, row.resource_id); return row;
}
export function partnerInsert(k: CommerceKernel, name: string, s: Row, ref: string, resource: string, hash: string, state: string, body: Row) {
  k.db.prepare(`INSERT INTO ${table(name)} VALUES(?,?,?,?,?,?,?,?,?)`)
    .run(s.tenant_id, s.store_id, id(ref), resource, hash, state, canonical(body), contentDigest(body), k.clock());
}
export function partnerUpdate(k: CommerceKernel, name: string, row: Row, state: string, body: Row) {
  k.db.prepare(`UPDATE ${table(name)} SET state=?,body=?,digest=? WHERE tenant_id=? AND store_id=? AND id=?`)
    .run(state, canonical(body), contentDigest(body), row.tenant_id, row.store_id, row.id);
}
export function partnerSource(k: CommerceKernel, scope: Scope, source: PartnerFixtureSource, context?: PartnerContext) {
  const s = k.require(scope);
  if (!(source instanceof PartnerFixtureSource)) throw new Error('SEPARATE_FIXTURE_SOURCE_REQUIRED');
  if (source.tenant !== s.tenant_id || source.store !== s.store_id || source.db === k.db || context && source.identity !== context.source_identity) throw new Error('PARTNER_SOURCE_SCOPE');
  const path = (db: any) => db.prepare('PRAGMA database_list').all().find((row: Row) => row.name === 'main')?.file;
  if (path(source.db) && path(source.db) === path(k.db)) throw new Error('SEPARATE_FIXTURE_SOURCE_REQUIRED'); return s;
}
export function serviceContext(k: CommerceKernel, scope: Scope, source: PartnerFixtureSource, service: string, region: string, capability: string) {
  partnerSource(k, scope, source); const configuration = source.configuration(service);
  if (!configuration) throw new Error('PARTNER_UNAVAILABLE');
  const context: PartnerContext = {service, account_id: configuration.body.account_id, source_identity: source.identity,
    source_config_digest: configuration.digest, region: id(region), capability: id(capability)};
  const pin = new PartnerReadiness(k).assertReady(scope, context);
  if (configuration.body.expires_at <= k.clock() || !configuration.body.regions.includes(region)) throw new Error('PARTNER_UNAVAILABLE');
  return {context, pin, configuration};
}
export function currentCustomer(k: CommerceKernel, scope: Scope, resource: string) {
  const {order} = partnerResource(k, scope, resource); return growthCustomer(k, scope, resource, order.customer_id);
}
export function originalCustomer(k: CommerceKernel, row: Row, tokenHash: string) {
  const session = k.db.prepare('SELECT * FROM commerce_sessions WHERE token_hash=? AND revoked=0 AND expires_at>? AND last_seen>?')
    .get(tokenHash, k.clock(), k.clock() - 900000) as Row | undefined;
  if (!session || session.tenant_id !== row.tenant_id || session.store_id !== row.store_id) throw new Error('CUSTOMER_VERIFICATION_REQUIRED');
  const order = k.db.prepare('SELECT customer_id FROM commerce_resources WHERE tenant_id=? AND store_id=? AND id=?')
    .get(row.tenant_id, row.store_id, row.resource_id) as Row | undefined;
  growthCustomerProof(k, session, row.resource_id, order?.customer_id); return session;
}
