import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { commerceFixture } from './commerce-helpers.mts';
import { warehouseReturnFixture } from './warehouse-return-events-helpers.mts';
import { CustomerAccess } from '../../packages/commerce/customer-access.mts';
import { contentDigest } from '../../packages/commerce/configuration-values.mts';
import { PartnerReadiness } from '../../packages/commerce/partner-readiness.mts';
import type { PartnerContext } from '../../packages/commerce/partner-readiness.mts';
import type { CommerceKernel, Scope, Row } from '../../packages/commerce/kernel.mts';
import { PartnerFixtureSource } from '../../packages/adapters/partner-fixture-source.mts';
import { ProtectionCoverage } from '../../packages/commerce/protection-coverage.mts';
import { DutyAssessments } from '../../packages/commerce/duty-assessments.mts';
import { ReverseHubs } from '../../packages/commerce/reverse-hubs.mts';
import { InternationalHandoffs } from '../../packages/commerce/international-handoffs.mts';
import { HsaFsa } from '../../packages/commerce/hsa-fsa.mts';
import { NetworkAlerts } from '../../packages/commerce/network-alerts.mts';

/** Uses the caller's existing store, scopes and native source identity. These
 * invented references are local fixture preparation, never contractual proof. */
export function installPartnerReadiness(k: CommerceKernel, owner: Scope, reviewer: Scope, context: PartnerContext,
  options: {expires_at?: number; capabilities?: string[]; regions?: string[]} = {}) {
  const readiness = new PartnerReadiness(k), prior = readiness.inspect(owner, context);
  const configuration = readiness.configure(owner, {
    service: context.service, account_id: context.account_id, source_identity: context.source_identity,
    source_config_digest: context.source_config_digest, regions: options.regions ?? [context.region],
    capabilities: options.capabilities ?? [context.capability], enabled: true, qualification: 'synthetic_local_only',
    expected_revision: prior.revision ?? 0, expires_at: options.expires_at ?? k.clock() + 240000,
    responsibilities: {contract_ref: 'synthetic_agreement_fixture', access_ref: 'synthetic_access_fixture',
      roles_ref: 'synthetic_roles_fixture', settlement_ref: 'synthetic_settlement_fixture',
      data_policy_ref: 'synthetic_data_policy_fixture', sla_ref: 'synthetic_sla_fixture', incident_owner: 'fixture_incident_owner'},
  });
  readiness.approve(reviewer, {service: context.service, account_id: context.account_id,
    approval_id: 'partner_approval_' + contentDigest([context.service, context.account_id, configuration.revision]).slice(0,28),
    expected_revision: configuration.revision, configuration_digest: configuration.digest,
    expires_at: options.expires_at ?? k.clock() + 240000});
  return {readiness, configuration, pin: readiness.assertReady(owner, context)};
}

export const partnerCapabilities: Row = {protection: 'issue', duties: 'estimate', reverse_hub: 'route',
  international_handoff: 'observe', hsa_fsa: 'eligibility', network_alerts: 'respond'};

export function partnerTerms(service: string, warehouseIdentity = 'unconfigured_warehouse'): Row {
  const values: Row = {
    protection: {products: ['shirt'], excluded_products: ['excluded'], currency: 'USD', fee_minor: '500',
      loss_party: 'synthetic_insurer', claims_ref: 'synthetic_claims', settlement_ref: 'synthetic_settlement', disclosure_ref: 'synthetic_disclosure'},
    duties: {routes: ['US_TEST_CA_TEST'], currency: 'USD', calculation_party: 'synthetic_calculator', remittance_party: 'synthetic_remitter', guaranteed: false},
    reverse_hub: {sites: [{site_id: 'hub_one', warehouse_source_identity: warehouseIdentity, location_id: 'warehouse-one', categories: ['apparel']}],
      currency: 'USD', fee_minor: '250', sla_ref: 'synthetic_receipt_sla'},
    international_handoff: {sites: ['origin', 'hub', 'customs', 'destination'], currency: 'USD'},
    hsa_fsa: {products: ['shirt'], currency: 'USD', payment_source_identity: 'synthetic'},
    network_alerts: {currency: 'USD', responses: ['acknowledge', 'review', 'decline'], fee_minor: '100'},
  };
  return values[service];
}

function services(f: any, owner: Scope, reviewer: Scope, resourceId: string, warehouseIdentity?: string) {
  const sourceDb = new DatabaseSync(join(f.directory, 'partner-source.sqlite'));
  const source = new PartnerFixtureSource(sourceDb, {mode: 'fixture', identity: 'partner-services', tenant: f.a.tenant, store: f.a.store}, f.now);
  const readiness = new PartnerReadiness(f.kernel), protection = new ProtectionCoverage(f.kernel, source), duties = new DutyAssessments(f.kernel, source),
    handoffs = new InternationalHandoffs(f.kernel, source), hsa = new HsaFsa(f.kernel, source), alerts = new NetworkAlerts(f.kernel, source);
  const configureSource = (service: string, patch: Row = {}) => source.configure({service, account_id: service + '_account',
    revision: (source.configuration(service)?.body.revision ?? 0) + 1, regions: ['US_TEST', 'CA_TEST'],
    expires_at: f.now() + 300000, terms: partnerTerms(service, warehouseIdentity), ...patch});
  for (const service of Object.keys(partnerCapabilities)) configureSource(service);
  const context = (service: string, capability = partnerCapabilities[service], region = 'US_TEST') => {
    const c = source.configuration(service)!;
    return {service, account_id: c.body.account_id, source_identity: source.identity, source_config_digest: c.digest, region, capability};
  };
  const enable = (service: string, options: Row = {}) => installPartnerReadiness(f.kernel, owner, reviewer, context(service), options);
  const proposal = (patch: Row = {}) => protection.propose(f.a.scope, {proposal_id: 'protection_proposal', resource_id: resourceId,
    product_id: 'shirt', region: 'US_TEST', ...patch});
  const reviewProtection = (p: Row) => protection.review(reviewer, {proposal_id: p.id, preview_digest: p.preview_digest});
  const estimate = (patch: Row = {}) => source.recordDuty({event_id: 'duty_estimate', resource_id: resourceId, route_id: 'US_TEST_CA_TEST',
    kind: 'estimate', quote_ref: 'duty_estimate', amount_minor: '700', currency: 'USD', party_ref: 'synthetic_calculator', observed_at: f.now(), ...patch});
  const dutyCase = () => {estimate(); return duties.open(f.a.scope, {case_id: 'duty_case', resource_id: resourceId, estimate_id: 'duty_estimate', region: 'US_TEST'});};
  const payment = f.kernel.ingest(f.a.scope, {kind: 'payment', source_system: 'synthetic', external_id: 'partner_payment', source_version: 1,
    source_updated_at: f.now(), customer_id: 'C-1001', payload: {order_resource_id: resourceId, provider_reference: 'native_payment_one',
      state: 'authorized', currency: 'USD', amount_minor: '12500', account_id: 'hsa_fsa_account'}});
  const eligibility = (patch: Row = {}) => source.recordEligibility({eligibility_id: 'eligibility_one', resource_id: resourceId, product_id: 'shirt',
    revision: 1, region: 'US_TEST', eligible: true, currency: 'USD', allowed_minor: '12500', payment_reference: 'native_payment_one',
    expires_at: f.now() + 120000, ...patch});
  const hsaProposal = () => {eligibility(); return hsa.propose(f.a.scope, {operation_id: 'eligibility_operation', resource_id: resourceId,
    eligibility_id: 'eligibility_one', payment_resource_id: payment.id, product_id: 'shirt', region: 'US_TEST'});};
  const alert = (patch: Row = {}) => source.recordAlert({event_id: 'network_event', alert_id: 'network_alert', resource_id: resourceId,
    account_id: 'network_alerts_account', deadline_at: f.now() + 60000, observed_at: f.now(), currency: 'USD', fee_minor: '100',
    fee_ref: 'network_fee_one', allowed_responses: ['acknowledge', 'review'], ...patch});
  const importAlert = () => {alert(); return alerts.import(f.a.scope, {event_id: 'network_event', resource_id: resourceId, region: 'US_TEST'});};
  const response = (patch: Row = {}) => alerts.propose(f.a.scope, {operation_id: 'network_response', alert_id: 'network_alert', response: 'acknowledge', ...patch});
  const approveResponse = (p: Row) => alerts.approve(reviewer, {operation_id: p.id, preview_digest: p.preview_digest});
  const journey = () => handoffs.plan(f.a.scope, {journey_id: 'journey_one', resource_id: resourceId, region: 'US_TEST',
    units: ['unit_one'], legs: [{leg_id: 'local', from_site: 'origin', to_site: 'hub'}, {leg_id: 'border', from_site: 'hub', to_site: 'destination'}]});
  const handoffEvent = (patch: Row = {}) => source.recordHandoff({event_id: 'handoff_one', journey_id: 'journey_one', resource_id: resourceId,
    sequence: 1, leg_id: 'local', from_site: 'origin', to_site: 'hub', kind: 'sent', custody_ref: 'custody_one', units: ['unit_one'],
    currency: 'USD', estimated_minor: '300', final_minor: null, fee_ref: null, observed_at: f.now(), ...patch});
  return {sourceDb, source, readiness, protection, duties, handoffs, hsa, alerts, configureSource, context, enable, proposal, reviewProtection,
    estimate, dutyCase, payment, eligibility, hsaProposal, alert, importAlert, response, approveResponse, journey, handoffEvent};
}

export function partnerFixture() {
  const f = commerceFixture();
  f.kernel.provisionMember(f.a.tenant, f.a.store, 'partner_owner', 'owner');
  f.kernel.provisionMember(f.a.tenant, f.a.store, 'partner_reviewer', 'reviewer');
  const owner = f.kernel.authenticate(f.kernel.issueSession(f.a.tenant, f.a.store, 'partner_owner')),
    reviewer = f.kernel.authenticate(f.kernel.issueSession(f.a.tenant, f.a.store, 'partner_reviewer'));
  const resource = f.seed(f.a.scope);
  f.kernel.ingest(f.a.scope, {kind: 'customer', source_system: 'synthetic', external_id: 'C-1001', source_version: 1,
    source_updated_at: f.now(), customer_id: null, payload: {email: 'partner-customer@example.invalid'}});
  const proofs: Row[] = [], access = new CustomerAccess(f.kernel, p => proofs.push(p));
  const challenge = access.request({store_id: f.a.store, order_number: 'ORD-1001', email: 'partner-customer@example.invalid'}, '127.0.0.39');
  const verified = access.complete({store_id: f.a.store, challenge_id: challenge.challenge_id, proof: proofs[0].proof});
  const customer = f.kernel.authenticate(verified.token), bundle = services(f, owner, reviewer, resource.id);
  const confirmProtection = (p: Row) => bundle.protection.confirm(customer, {proposal_id: p.id, preview_digest: p.preview_digest});
  const protectionReady = () => {bundle.enable('protection'); const p = bundle.proposal(); bundle.reviewProtection(p); confirmProtection(p); return p;};
  return {...f, ...bundle, owner, reviewer, customer, resource_id: resource.id, confirmProtection, protectionReady,
    cleanup() {bundle.sourceDb.close(); f.cleanup();}};
}
export async function usingPartner(run: (f: ReturnType<typeof partnerFixture>) => unknown) {
  const f = partnerFixture(); try {return await run(f);} finally {f.cleanup();}
}

export async function partnerWarehouseFixture() {
  const f = await warehouseReturnFixture(), bundle = services(f, f.owner.scope, f.reviewer.scope, f.order().id, f.warehouse.identity),
    hubs = new ReverseHubs(f.kernel, bundle.source, f.warehouse);
  const route = () => hubs.route(f.a.scope, {route_id: 'hub_route', request_id: f.request.id, site_id: 'hub_one', category: 'apparel', region: 'US_TEST'});
  return {...f, ...bundle, hubs, route, resource_id: f.order().id,
    cleanup() {bundle.sourceDb.close(); f.cleanup();}};
}
export async function usingPartnerWarehouse(run: (f: Awaited<ReturnType<typeof partnerWarehouseFixture>>) => unknown) {
  const f = await partnerWarehouseFixture(); try {return await run(f);} finally {f.cleanup();}
}

export async function changedPartnerModule(file: string, name: string, marker: string, replacement: string, run: (Module: any) => unknown) {
  const directory = mkdtempSync(join(tmpdir(), 'rifare-partner-fault-'));
  try {
    const url = new URL(file, import.meta.url), source = readFileSync(url, 'utf8');
    assert.equal(source.split(marker).length, 2, 'The named fault must mutate exactly one actual implementation statement');
    const changed = source.replace(marker, replacement).replace(/from '(\.[^']+)'/g, (_whole, path) => "from '" + new URL(path, url).href + "'");
    const target = join(directory, 'fault.mts'); writeFileSync(target, changed);
    return await run((await import(pathToFileURL(target).href))[name]);
  } finally {rmSync(directory, {recursive: true, force: true});}
}
