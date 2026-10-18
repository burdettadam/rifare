import { exact, id } from './kernel.mts';
import type { CommerceKernel, Scope, Row } from './kernel.mts';
import { contentDigest, jsonValue } from './configuration-values.mts';
import { PartnerReadiness } from './partner-readiness.mts';
import { partnerResource, partnerRow, partnerBody, partnerInsert, partnerSource, serviceContext } from './partner-service-core.mts';
import type { PartnerFixtureSource } from '../adapters/partner-fixture-source.mts';

export class InternationalHandoffs {
  readonly k: CommerceKernel; readonly source: PartnerFixtureSource;
  constructor(k: CommerceKernel, source: PartnerFixtureSource) {this.k = k; this.source = source;}
  plan(scope: Scope, input: unknown) {
    const p = exact(jsonValue(input), ['journey_id', 'resource_id', 'region', 'units', 'legs']); id(p.journey_id); id(p.resource_id); id(p.region);
    if (!Array.isArray(p.units) || !p.units.length || p.units.length > 100 || new Set(p.units).size !== p.units.length ||
      !Array.isArray(p.legs) || !p.legs.length || p.legs.length > 10) throw new Error('INVALID_INPUT'); p.units.forEach(id);
    return this.k.transaction(() => {
      const {s, subject_hash} = partnerResource(this.k, scope, p.resource_id, 'action.propose'), {context, pin, configuration} = serviceContext(this.k, scope, this.source, 'international_handoff', p.region, 'observe');
      const seen = new Set<string>(); let last: string | null = null;
      for (const leg of p.legs) {
        exact(leg, ['leg_id', 'from_site', 'to_site']); Object.values(leg).forEach(id);
        if (seen.has(leg.leg_id) || leg.from_site === leg.to_site || !configuration.body.terms.sites.includes(leg.from_site) || !configuration.body.terms.sites.includes(leg.to_site) ||
          last !== null && last !== leg.from_site) throw new Error('HANDOFF_ROUTE_UNSUPPORTED'); seen.add(leg.leg_id); last = leg.to_site;
      }
      const body = {kind: 'plan', journey_id: p.journey_id, units: p.units, legs: p.legs, context, pin, currency: configuration.body.terms.currency, proposed_by: s.actor_id};
      const old = this.k.db.prepare('SELECT * FROM commerce_international_handoffs WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id, s.store_id, p.journey_id) as Row | undefined;
      if (old) {if (old.digest !== contentDigest(body)) throw new Error('HANDOFF_PLAN_CONFLICT');}
      else partnerInsert(this.k, 'commerce_international_handoffs', s, p.journey_id, p.resource_id, subject_hash, 'planned', body);
      return this.read(scope, p.journey_id);
    });
  }
  #events(row: Row) {
    return (this.k.db.prepare('SELECT * FROM commerce_international_handoffs WHERE tenant_id=? AND store_id=? AND resource_id=? ORDER BY created_at,id')
      .all(row.tenant_id, row.store_id, row.resource_id) as Row[]).map(partnerBody).filter(r => r.body.kind === 'event' && r.body.journey_id === row.id)
      .map(r => r.body.event).sort((a: Row, b: Row) => a.sequence - b.sequence);
  }
  #project(row: Row, events: Row[]) {
    const b = row.body, custody = new Map<string, Row>(b.units.map((unit: string) => [unit, {unit_id: unit, site_id: b.legs[0].from_site, in_transit: false}]));
    const legs: Row[] = b.legs.map((leg: Row) => ({...leg, state: 'not_started', sent: new Set<string>(), received: new Set<string>(), rejected: false}));
    const fees = new Map<string, {amount: string; currency: string; leg_id: string}>(), estimates = new Map<string, string>();
    let next = 1;
    for (const e of events) {
      if (e.sequence !== next++) throw new Error('HANDOFF_SEQUENCE_MISSING'); const index = legs.findIndex(leg => leg.leg_id === e.leg_id), leg = legs[index];
      if (!leg || e.from_site !== leg.from_site || e.to_site !== leg.to_site || e.currency !== b.currency || e.units.some((unit: string) => !custody.has(unit))) throw new Error('HANDOFF_SOURCE_MISMATCH');
      if (index > 0 && e.units.some((unit: string) => !legs[index - 1].received.has(unit))) throw new Error('HANDOFF_CUSTODY_MISSING');
      if (e.kind === 'sent') {
        if (leg.rejected) throw new Error('HANDOFF_REJECTED');
        for (const unit of e.units) {const c = custody.get(unit)!; if (leg.sent.has(unit) || c.site_id !== leg.from_site || c.in_transit) throw new Error('HANDOFF_DUPLICATE_CUSTODY');
          leg.sent.add(unit); custody.set(unit, {unit_id: unit, site_id: leg.from_site, in_transit: true});}
      } else if (e.kind === 'received') {
        if (leg.rejected) throw new Error('HANDOFF_REJECTED');
        for (const unit of e.units) {if (!leg.sent.has(unit) || leg.received.has(unit)) throw new Error('HANDOFF_CUSTODY_MISSING');
          leg.received.add(unit); custody.set(unit, {unit_id: unit, site_id: leg.to_site, in_transit: false});}
      } else leg.rejected = true;
      leg.state = leg.rejected ? 'rejected' : leg.received.size === b.units.length ? 'received' : leg.sent.size ? 'in_transit' : 'not_started';
      if (!estimates.has(leg.leg_id)) estimates.set(leg.leg_id, e.estimated_minor);
      if (e.fee_ref !== null) {
        const old = fees.get(e.fee_ref), charge = {amount: e.final_minor, currency: e.currency, leg_id: e.leg_id};
        if (old && contentDigest(old) !== contentDigest(charge)) throw new Error('HANDOFF_FEE_CONFLICT'); fees.set(e.fee_ref, charge);
      }
    }
    return {legs, custody, fees, estimates};
  }
  import(scope: Scope, input: unknown) {
    const p = exact(jsonValue(input), ['journey_id', 'event_id']); id(p.event_id);
    return this.k.transaction(() => {
      const row = partnerRow(this.k, scope, 'commerce_international_handoffs', p.journey_id, 'operation.reconcile'), b = row.body;
      if (b.kind !== 'plan' || b.redacted || row.state !== 'planned') throw new Error('HANDOFF_PLAN_REVOKED');
      partnerSource(this.k, scope, this.source, b.context); new PartnerReadiness(this.k).assertReconcile(scope, b.context);
      const event = this.source.handoff(p.event_id);
      if (!event || event.resource_id !== row.resource_id || event.journey_id !== row.id || event.source_identity !== b.context.source_identity || event.account_id !== b.context.account_id) throw new Error('HANDOFF_SOURCE_MISMATCH');
      const events = this.#events(row), old = events.find(e => e.event_id === event.event_id);
      if (old) {if (contentDigest(old) !== contentDigest(event)) throw new Error('HANDOFF_EVENT_CONFLICT'); return this.read(scope, row.id);}
      this.#project(row, [...events, event]);
      partnerInsert(this.k, 'commerce_international_handoffs', row, 'handoff_' + contentDigest([row.id, event.event_id]).slice(0,32), row.resource_id, row.subject_hash,
        'observed', {kind: 'event', journey_id: row.id, event}); return this.read(scope, row.id);
    });
  }
  read(scope: Scope, ref: string) {
    const row = partnerRow(this.k, scope, 'commerce_international_handoffs', ref), b = row.body;
    if (b.kind !== 'plan' || b.redacted) return {id: row.id, resource_id: row.resource_id, redacted: true, all_completed: false, events: [], stock_effects: 0};
    const events = this.#events(row), projection = this.#project(row, events), legs = projection.legs.map(({sent, received, rejected, ...leg}) => ({...leg, sent_units: [...sent], received_units: [...received]}));
    return {id: row.id, resource_id: row.resource_id, legs, events, current_custody: [...projection.custody.values()],
      all_completed: legs.every(leg => leg.state === 'received'),
      estimated_cost_minor: [...projection.estimates.values()].reduce((sum, amount) => sum + BigInt(amount), 0n).toString(),
      final_cost_minor: [...projection.fees.values()].reduce((sum, fee) => sum + BigInt(fee.amount), 0n).toString(),
      final_cost_complete: legs.every(leg => leg.state === 'received' && [...projection.fees.values()].some(fee => fee.leg_id === leg.leg_id)),
      currency: b.currency, stock_effects: 0, physical_receipt_qualified: false, qualification: 'synthetic_local_only', external_qualified: false};
  }
}
