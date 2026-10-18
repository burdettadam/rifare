import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { exact, id, integer } from '../commerce/kernel.mts';
import type { Row } from '../commerce/kernel.mts';
import { canonical, contentDigest, jsonValue } from '../commerce/configuration-values.mts';
import { money } from '../commerce/money.mts';
import { partnerContext, partnerHash } from '../commerce/partner-readiness.mts';
import type { PartnerContext } from '../commerce/partner-readiness.mts';

export const PARTNER_SOURCE_VERSION = 'partner_fixture_v1';
export class PartnerNoEffectError extends Error {}
function strings(input: unknown, max = 50): string[] {
  if (!Array.isArray(input) || !input.length || input.length > max || new Set(input).size !== input.length) throw new Error('INVALID_INPUT');
  return input.map(id);
}
function terms(service: string, value: unknown): Row {
  const fields: Row = {protection: ['products', 'excluded_products', 'currency', 'fee_minor', 'loss_party', 'claims_ref', 'settlement_ref', 'disclosure_ref'],
    duties: ['routes', 'currency', 'calculation_party', 'remittance_party', 'guaranteed'],
    reverse_hub: ['sites', 'currency', 'fee_minor', 'sla_ref'], international_handoff: ['sites', 'currency'],
    hsa_fsa: ['products', 'currency', 'payment_source_identity'], network_alerts: ['currency', 'responses', 'fee_minor']};
  if (!fields[service]) throw new Error('PARTNER_SERVICE_UNSUPPORTED'); const p = exact(value, fields[service]); money(p.currency, p.fee_minor ?? '0');
  if (service === 'protection') {
    strings(p.products); if (!Array.isArray(p.excluded_products) || p.excluded_products.length > 50) throw new Error('INVALID_INPUT'); p.excluded_products.forEach(id);
    for (const key of ['loss_party', 'claims_ref', 'settlement_ref', 'disclosure_ref']) id(p[key]);
  } else if (service === 'duties') {
    strings(p.routes); id(p.calculation_party); id(p.remittance_party); if (p.guaranteed !== false) throw new Error('GUARANTEE_UNQUALIFIED');
  } else if (service === 'reverse_hub') {
    if (!Array.isArray(p.sites) || !p.sites.length || p.sites.length > 20) throw new Error('INVALID_INPUT'); const seen = new Set<string>();
    for (const site of p.sites) {exact(site, ['site_id', 'warehouse_source_identity', 'location_id', 'categories']);
      id(site.site_id); id(site.warehouse_source_identity); id(site.location_id); strings(site.categories);
      if (seen.has(site.site_id)) throw new Error('INVALID_INPUT'); seen.add(site.site_id);}
    id(p.sla_ref);
  } else if (service === 'international_handoff') strings(p.sites);
  else if (service === 'hsa_fsa') {strings(p.products); id(p.payment_source_identity);}
  else if (strings(p.responses).some(v => !['acknowledge', 'review', 'decline'].includes(v))) throw new Error('ALERT_RESPONSE_UNSUPPORTED');
  return p;
}

/** Separate invented provider records. No HTTP client, payment capture, refund,
 * stock mutation, commercial authentication or physical receipt API exists. */
export class PartnerFixtureSource {
  readonly db: DatabaseSync; readonly identity: string; readonly tenant: string; readonly store: string; readonly clock: () => number;
  readonly qualification = 'synthetic_local_only'; readonly api_version = PARTNER_SOURCE_VERSION;
  loseNextResponse = false; beforeCommit: (() => unknown) | null = null;
  calls = {coverage: 0, eligibility: 0, alert_response: 0, lookup: 0};
  constructor(db: DatabaseSync, options: {mode: 'fixture'; identity: string; tenant: string; store: string}, clock = Date.now) {
    exact(options, ['mode', 'identity', 'tenant', 'store']); if (options.mode !== 'fixture') throw new Error('FIXTURE_ONLY');
    id(options.identity); this.tenant = id(options.tenant); this.store = id(options.store); this.db = db; this.clock = clock;
    db.exec(`CREATE TABLE IF NOT EXISTS partner_source_identity(id INTEGER PRIMARY KEY CHECK(id=1),label TEXT NOT NULL,identity TEXT NOT NULL,tenant_id TEXT NOT NULL,store_id TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS partner_source_configurations(service TEXT PRIMARY KEY,body TEXT NOT NULL,digest TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS partner_source_bindings(operation_id TEXT PRIMARY KEY,kind TEXT NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS partner_source_coverage(operation_id TEXT PRIMARY KEY,resource_id TEXT NOT NULL,product_id TEXT NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL,UNIQUE(resource_id,product_id)) STRICT;
      CREATE TABLE IF NOT EXISTS partner_source_duties(event_id TEXT PRIMARY KEY,body TEXT NOT NULL,digest TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS partner_source_eligibility(eligibility_id TEXT PRIMARY KEY,body TEXT NOT NULL,digest TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS partner_source_eligibility_checks(operation_id TEXT PRIMARY KEY,body TEXT NOT NULL,digest TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS partner_source_handoffs(event_id TEXT PRIMARY KEY,body TEXT NOT NULL,digest TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS partner_source_alerts(event_id TEXT PRIMARY KEY,body TEXT NOT NULL,digest TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS partner_source_alert_responses(operation_id TEXT PRIMARY KEY,alert_id TEXT NOT NULL UNIQUE,body TEXT NOT NULL,digest TEXT NOT NULL) STRICT;`);
    db.prepare('INSERT OR IGNORE INTO partner_source_identity VALUES(1,?,?,?,?)').run(options.identity, 'partner_' + randomUUID().replaceAll('-', ''), this.tenant, this.store);
    const row = db.prepare('SELECT * FROM partner_source_identity WHERE id=1').get() as Row;
    if (row.label !== options.identity || row.tenant_id !== this.tenant || row.store_id !== this.store) throw new Error('PARTNER_SOURCE_SCOPE'); this.identity = row.identity;
  }
  #read(table: string, field: string, ref: string) {
    const row = this.db.prepare(`SELECT body,digest FROM ${table} WHERE ${field}=?`).get(id(ref)) as Row | undefined;
    if (!row) return null; const body = JSON.parse(row.body); if (contentDigest(body) !== row.digest) throw new Error('PARTNER_SOURCE_INTEGRITY'); return body;
  }
  #record(table: string, ref: string, body: Row) {
    const row = this.db.prepare(`SELECT body,digest FROM ${table} WHERE ${table === 'partner_source_eligibility' ? 'eligibility_id' : 'event_id'}=?`).get(ref) as Row | undefined;
    if (row) {if (row.digest !== contentDigest(body)) throw new Error('PARTNER_SOURCE_EVENT_CONFLICT'); return JSON.parse(row.body);}
    this.db.prepare(`INSERT INTO ${table} VALUES(?,?,?)`).run(ref, canonical(body), contentDigest(body)); return body;
  }
  configure(input: unknown) {
    const p = exact(jsonValue(input), ['service', 'account_id', 'revision', 'regions', 'expires_at', 'terms']);
    id(p.service); id(p.account_id); integer(p.revision, 1); strings(p.regions); integer(p.expires_at); terms(p.service, p.terms);
    if (p.expires_at <= this.clock()) throw new Error('PARTNER_SOURCE_EXPIRED'); const old = this.configuration(p.service);
    if (p.revision !== (old?.body.revision ?? 0) + 1) throw new Error('PARTNER_SOURCE_VERSION_CHANGED');
    const body = {...p, source_identity: this.identity, tenant_id: this.tenant, store_id: this.store, api_version: PARTNER_SOURCE_VERSION, qualification: this.qualification};
    this.db.prepare('INSERT INTO partner_source_configurations VALUES(?,?,?) ON CONFLICT(service) DO UPDATE SET body=excluded.body,digest=excluded.digest')
      .run(p.service, canonical(body), contentDigest(body)); return {body, digest: contentDigest(body)};
  }
  configuration(service: string) {const body = this.#read('partner_source_configurations', 'service', service); return body ? {body, digest: contentDigest(body)} : null;}
  current(context: PartnerContext) {
    const c = partnerContext(context), configuration = this.configuration(c.service);
    if (!configuration || c.source_identity !== this.identity || c.account_id !== configuration.body.account_id || c.source_config_digest !== configuration.digest ||
      !configuration.body.regions.includes(c.region) || configuration.body.expires_at <= this.clock()) throw new PartnerNoEffectError('PARTNER_SOURCE_CONTEXT_CHANGED');
    return configuration;
  }
  #bind(kind: string, value: unknown) {
    const command = jsonValue(value); id(command.operation_id); id(command.resource_id); partnerContext(command.context);
    if (command.context.source_identity !== this.identity) throw new Error('PARTNER_SOURCE_SCOPE');
    const old = this.db.prepare('SELECT * FROM partner_source_bindings WHERE operation_id=?').get(command.operation_id) as Row | undefined;
    if (old) {if (old.kind !== kind || old.digest !== contentDigest(command)) throw new Error('PARTNER_OPERATION_CONFLICT');}
    else this.db.prepare('INSERT INTO partner_source_bindings VALUES(?,?,?,?)').run(command.operation_id, kind, canonical(command), contentDigest(command));
    return command;
  }
  #bound(kind: string, command: Row) {
    const row = this.db.prepare('SELECT * FROM partner_source_bindings WHERE operation_id=?').get(command.operation_id) as Row | undefined;
    if (!row || row.kind !== kind || row.digest !== contentDigest(command) || contentDigest(JSON.parse(row.body)) !== row.digest) throw new PartnerNoEffectError('ORIGINAL_PARTNER_BINDING_REQUIRED');
  }
  #guard(guard: (() => unknown) | undefined) {
    if (typeof guard !== 'function') throw new PartnerNoEffectError('FINAL_PARTNER_GUARD_REQUIRED');
    try {
      const hook = this.beforeCommit?.(); if (hook instanceof Promise) throw new Error('ASYNC_PARTNER_GUARD_DENIED');
      const result = guard(); if (result instanceof Promise) throw new Error('ASYNC_PARTNER_GUARD_DENIED');
    } catch (error) {throw new PartnerNoEffectError(error instanceof Error ? error.message : 'FINAL_PARTNER_GUARD_FAILED');}
  }
  #response(result: Row) {if (this.loseNextResponse) {this.loseNextResponse = false; throw new Error('LOST_PARTNER_RESPONSE');} return result;}
  quoteProtection(resource: string, product: string, region: string) {
    id(resource); id(product); id(region); const c = this.configuration('protection');
    if (!c || c.body.expires_at <= this.clock() || !c.body.regions.includes(region)) throw new Error('REGION_UNSUPPORTED');
    const t = c.body.terms; if (!t.products.includes(product) || t.excluded_products.includes(product)) throw new Error('PRODUCT_EXCLUDED');
    const body = {resource_id: resource, product_id: product, region, source_identity: this.identity, account_id: c.body.account_id,
      source_config_digest: c.digest, currency: t.currency, fee_minor: t.fee_minor, loss_party: t.loss_party, claims_ref: t.claims_ref,
      settlement_ref: t.settlement_ref, disclosure_ref: t.disclosure_ref, expires_at: c.body.expires_at};
    return {body, digest: contentDigest(body)};
  }
  bindCoverage(value: unknown) {return this.#bind('coverage', value);}
  async issueCoverage(value: unknown, guard?: () => unknown) {
    const c = exact(jsonValue(value), ['operation_id', 'resource_id', 'context', 'quote', 'quote_digest', 'proposal_digest']);
    id(c.operation_id); id(c.resource_id); partnerHash(c.quote_digest); partnerHash(c.proposal_digest); this.calls.coverage++;
    this.#bound('coverage', c); this.db.exec('BEGIN IMMEDIATE');
    let result: Row;
    try {
      const old = this.#read('partner_source_coverage', 'operation_id', c.operation_id);
      if (old) {if (old.command_digest !== contentDigest(c)) throw new Error('PARTNER_OPERATION_CONFLICT'); result = old;}
      else {
        this.#guard(guard); this.current(c.context); const quote = this.quoteProtection(c.resource_id, c.quote.product_id, c.context.region);
        if (c.context.service !== 'protection' || c.context.capability !== 'issue' || quote.digest !== c.quote_digest || contentDigest(c.quote) !== quote.digest) throw new PartnerNoEffectError('PROTECTION_TERMS_CHANGED');
        const prior = this.db.prepare('SELECT operation_id FROM partner_source_coverage WHERE resource_id=? AND product_id=?').get(c.resource_id, c.quote.product_id);
        if (prior) throw new PartnerNoEffectError('ORIGINAL_OPERATION_REQUIRED');
        result = {operation_id: c.operation_id, resource_id: c.resource_id, source_identity: this.identity, account_id: c.context.account_id,
          native_id: 'policy_' + contentDigest([this.identity, c.operation_id]).slice(0,32), command_digest: contentDigest(c), state: 'issued',
          fee_minor: quote.body.fee_minor, currency: quote.body.currency, loss_party: quote.body.loss_party,
          claims_ref: quote.body.claims_ref, settlement_ref: quote.body.settlement_ref, qualification: this.qualification};
        this.db.prepare('INSERT INTO partner_source_coverage VALUES(?,?,?,?,?)').run(c.operation_id, c.resource_id, c.quote.product_id, canonical(result), contentDigest(result));
      }
      this.db.exec('COMMIT');
    } catch (error) {this.db.exec('ROLLBACK'); throw error;} return this.#response(result);
  }
  async lookupCoverage(ref: string) {this.calls.lookup++; return this.#read('partner_source_coverage', 'operation_id', ref);}
  coverageEffects() {return (this.db.prepare('SELECT operation_id FROM partner_source_coverage ORDER BY operation_id').all() as Row[]).map(r => this.#read('partner_source_coverage', 'operation_id', r.operation_id));}
  recordDuty(input: unknown) {
    const p = exact(jsonValue(input), ['event_id', 'resource_id', 'route_id', 'kind', 'quote_ref', 'amount_minor', 'currency', 'party_ref', 'observed_at']);
    for (const key of ['event_id', 'resource_id', 'route_id', 'quote_ref', 'party_ref']) id(p[key]); integer(p.observed_at); money(p.currency, p.amount_minor);
    if (!['estimate', 'assessment'].includes(p.kind) || p.observed_at > this.clock()) throw new Error('INVALID_INPUT');
    const cfg = this.configuration('duties'); if (!cfg) throw new Error('PARTNER_SOURCE_UNCONFIGURED');
    return this.#record('partner_source_duties', p.event_id, {...p, source_identity: this.identity, account_id: cfg.body.account_id,
      source_config_digest: cfg.digest, qualification: this.qualification});
  }
  duty(ref: string) {return this.#read('partner_source_duties', 'event_id', ref);}
  recordEligibility(input: unknown) {
    const p = exact(jsonValue(input), ['eligibility_id', 'resource_id', 'product_id', 'revision', 'region', 'eligible', 'currency', 'allowed_minor', 'payment_reference', 'expires_at']);
    for (const key of ['eligibility_id', 'resource_id', 'product_id', 'region', 'payment_reference']) id(p[key]); integer(p.revision, 1); integer(p.expires_at); money(p.currency, p.allowed_minor);
    if (typeof p.eligible !== 'boolean') throw new Error('INVALID_INPUT'); const cfg = this.configuration('hsa_fsa'); if (!cfg) throw new Error('PARTNER_SOURCE_UNCONFIGURED');
    const body = {...p, source_identity: this.identity, account_id: cfg.body.account_id, source_config_digest: cfg.digest, authority: 'synthetic_provider_observation', qualification: this.qualification};
    const old = this.eligibility(p.eligibility_id);
    if (old) {if (contentDigest(old) === contentDigest(body)) return old; if (p.revision !== old.revision + 1) throw new Error('PARTNER_SOURCE_VERSION_CHANGED');}
    else if (p.revision !== 1) throw new Error('PARTNER_SOURCE_VERSION_CHANGED');
    this.db.prepare('INSERT INTO partner_source_eligibility VALUES(?,?,?) ON CONFLICT(eligibility_id) DO UPDATE SET body=excluded.body,digest=excluded.digest')
      .run(p.eligibility_id, canonical(body), contentDigest(body)); return body;
  }
  eligibility(ref: string) {return this.#read('partner_source_eligibility', 'eligibility_id', ref);}
  bindEligibility(value: unknown) {return this.#bind('eligibility', value);}
  async qualifyPurchase(value: unknown, guard?: () => unknown) {
    const c = exact(jsonValue(value), ['operation_id', 'resource_id', 'context', 'eligibility_id', 'eligibility_digest', 'payment_reference', 'preview_digest']);
    this.calls.eligibility++; this.#bound('eligibility', c); this.db.exec('BEGIN IMMEDIATE'); let result: Row;
    try {
      const old = this.#read('partner_source_eligibility_checks', 'operation_id', c.operation_id);
      if (old) {if (old.command_digest !== contentDigest(c)) throw new Error('PARTNER_OPERATION_CONFLICT'); result = old;}
      else {
        this.#guard(guard); this.current(c.context); const observation = this.eligibility(c.eligibility_id);
        if (c.context.service !== 'hsa_fsa' || c.context.capability !== 'eligibility' || !observation || !observation.eligible || observation.expires_at <= this.clock() ||
          observation.resource_id !== c.resource_id || observation.account_id !== c.context.account_id || contentDigest(observation) !== c.eligibility_digest ||
          observation.payment_reference !== c.payment_reference) throw new PartnerNoEffectError('PROVIDER_ELIGIBILITY_REQUIRED');
        result = {operation_id: c.operation_id, resource_id: c.resource_id, source_identity: this.identity, account_id: c.context.account_id,
          native_id: 'eligibility_check_' + contentDigest([this.identity, c.operation_id]).slice(0,24), state: 'eligibility_confirmed',
          command_digest: contentDigest(c), eligibility_id: c.eligibility_id, payment_reference: c.payment_reference,
          payment_effect_executed: false, qualification: this.qualification};
        this.db.prepare('INSERT INTO partner_source_eligibility_checks VALUES(?,?,?)').run(c.operation_id, canonical(result), contentDigest(result));
      }
      this.db.exec('COMMIT');
    } catch (error) {this.db.exec('ROLLBACK'); throw error;} return this.#response(result);
  }
  async lookupEligibility(ref: string) {this.calls.lookup++; return this.#read('partner_source_eligibility_checks', 'operation_id', ref);}
  eligibilityEffects() {return (this.db.prepare('SELECT operation_id FROM partner_source_eligibility_checks ORDER BY operation_id').all() as Row[]).map(r => this.#read('partner_source_eligibility_checks', 'operation_id', r.operation_id));}
  recordHandoff(input: unknown) {
    const p = exact(jsonValue(input), ['event_id', 'journey_id', 'resource_id', 'sequence', 'leg_id', 'from_site', 'to_site', 'kind', 'custody_ref',
      'units', 'currency', 'estimated_minor', 'final_minor', 'fee_ref', 'observed_at']);
    for (const key of ['event_id', 'journey_id', 'resource_id', 'leg_id', 'from_site', 'to_site', 'custody_ref']) id(p[key]); strings(p.units, 100); integer(p.sequence, 1); integer(p.observed_at);
    money(p.currency, p.estimated_minor); if (p.final_minor !== null) money(p.currency, p.final_minor);
    if (!['sent', 'received', 'rejected'].includes(p.kind) || p.from_site === p.to_site || p.observed_at > this.clock() || (p.fee_ref === null) !== (p.final_minor === null)) throw new Error('INVALID_INPUT');
    if (p.fee_ref !== null) id(p.fee_ref); const cfg = this.configuration('international_handoff'); if (!cfg) throw new Error('PARTNER_SOURCE_UNCONFIGURED');
    return this.#record('partner_source_handoffs', p.event_id, {...p, source_identity: this.identity, account_id: cfg.body.account_id, qualification: this.qualification});
  }
  handoff(ref: string) {return this.#read('partner_source_handoffs', 'event_id', ref);}
  recordAlert(input: unknown) {
    const p = exact(jsonValue(input), ['event_id', 'alert_id', 'resource_id', 'account_id', 'deadline_at', 'observed_at', 'currency', 'fee_minor', 'fee_ref', 'allowed_responses']);
    for (const key of ['event_id', 'alert_id', 'resource_id', 'account_id', 'fee_ref']) id(p[key]); integer(p.deadline_at); integer(p.observed_at); money(p.currency, p.fee_minor);
    if (p.observed_at > this.clock() || strings(p.allowed_responses).some(v => !['acknowledge', 'review', 'decline'].includes(v))) throw new Error('INVALID_INPUT');
    return this.#record('partner_source_alerts', p.event_id, {...p, source_identity: this.identity, qualification: this.qualification});
  }
  alert(ref: string) {return this.#read('partner_source_alerts', 'event_id', ref);}
  bindAlertResponse(value: unknown) {return this.#bind('alert_response', value);}
  async respondAlert(value: unknown, guard?: () => unknown) {
    const c = exact(jsonValue(value), ['operation_id', 'resource_id', 'context', 'event_id', 'alert_id', 'event_digest', 'response', 'preview_digest']);
    this.calls.alert_response++; this.#bound('alert_response', c); this.db.exec('BEGIN IMMEDIATE'); let result: Row;
    try {
      const old = this.#read('partner_source_alert_responses', 'operation_id', c.operation_id);
      if (old) {if (old.command_digest !== contentDigest(c)) throw new Error('PARTNER_OPERATION_CONFLICT'); result = old;}
      else {
        this.#guard(guard); const configuration = this.current(c.context), event = this.alert(c.event_id);
        if (c.context.service !== 'network_alerts' || c.context.capability !== 'respond' || !event || event.resource_id !== c.resource_id || event.alert_id !== c.alert_id ||
          event.account_id !== c.context.account_id || contentDigest(event) !== c.event_digest || event.deadline_at <= this.clock() ||
          !event.allowed_responses.includes(c.response) || !configuration.body.terms.responses.includes(c.response)) throw new PartnerNoEffectError('ALERT_RESPONSE_UNAVAILABLE');
        if (this.db.prepare('SELECT 1 FROM partner_source_alert_responses WHERE alert_id=?').get(c.alert_id)) throw new PartnerNoEffectError('ORIGINAL_OPERATION_REQUIRED');
        result = {operation_id: c.operation_id, resource_id: c.resource_id, source_identity: this.identity, account_id: c.context.account_id,
          alert_id: c.alert_id, native_id: 'alert_response_' + contentDigest([this.identity, c.operation_id]).slice(0,24), state: 'acknowledged',
          command_digest: contentDigest(c), response: c.response, fee_minor: event.fee_minor, fee_ref: event.fee_ref,
          recovered_minor: '0', financial_effect_executed: false, qualification: this.qualification};
        this.db.prepare('INSERT INTO partner_source_alert_responses VALUES(?,?,?,?)').run(c.operation_id, c.alert_id, canonical(result), contentDigest(result));
      }
      this.db.exec('COMMIT');
    } catch (error) {this.db.exec('ROLLBACK'); throw error;} return this.#response(result);
  }
  async lookupAlertResponse(ref: string) {this.calls.lookup++; return this.#read('partner_source_alert_responses', 'operation_id', ref);}
  alertEffects() {return (this.db.prepare('SELECT operation_id FROM partner_source_alert_responses ORDER BY operation_id').all() as Row[]).map(r => this.#read('partner_source_alert_responses', 'operation_id', r.operation_id));}
}
