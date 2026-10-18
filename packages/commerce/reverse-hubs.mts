import { exact, id } from './kernel.mts';
import type { CommerceKernel, Scope, Row } from './kernel.mts';
import { contentDigest, jsonValue } from './configuration-values.mts';
import { PartnerReadiness } from './partner-readiness.mts';
import { partnerResource, partnerRow, partnerBody, partnerInsert, partnerSource, serviceContext } from './partner-service-core.mts';
import { returnContext } from './return-lifecycle-core.mts';
import { WarehouseReturnEvents } from './warehouse-return-events.mts';
import { WarehouseFixtureSource } from '../adapters/warehouse-fixture-source.mts';
import type { PartnerFixtureSource } from '../adapters/partner-fixture-source.mts';

/** Routing is a local proposal. Only the original warehouse event importer can
 * materialize receipt/inspection observations; this service never owns stock. */
export class ReverseHubs {
  readonly k: CommerceKernel; readonly source: PartnerFixtureSource; readonly warehouse: WarehouseFixtureSource;
  readonly receiving: WarehouseReturnEvents;
  constructor(k: CommerceKernel, source: PartnerFixtureSource, warehouse: WarehouseFixtureSource) {
    this.k = k; this.source = source; this.warehouse = warehouse; this.receiving = new WarehouseReturnEvents(k, warehouse);
  }
  route(scope: Scope, input: unknown) {
    const p = exact(jsonValue(input), ['route_id', 'request_id', 'site_id', 'category', 'region']); Object.values(p).forEach(id);
    return this.k.transaction(() => {
      const {r} = returnContext(this.k, scope, p.request_id, 'action.propose'), {s, subject_hash} = partnerResource(this.k, scope, r.resource_id, 'action.propose');
      const {context, pin, configuration} = serviceContext(this.k, scope, this.source, 'reverse_hub', p.region, 'route');
      const site = configuration.body.terms.sites.find((v: Row) => v.site_id === p.site_id);
      if (!site || !site.categories.includes(p.category)) throw new Error('SITE_CATEGORY_UNSUPPORTED');
      if (site.warehouse_source_identity !== this.warehouse.identity || this.warehouse.tenant !== s.tenant_id || this.warehouse.store !== s.store_id) throw new Error('WAREHOUSE_SOURCE_MISMATCH');
      const body = {request_id: r.id, site_id: site.site_id, category: p.category, region: p.region, warehouse_source_identity: this.warehouse.identity,
        location_id: site.location_id, context, pin, proposed_by: s.actor_id, fee_minor: configuration.body.terms.fee_minor,
        currency: configuration.body.terms.currency, sla_ref: configuration.body.terms.sla_ref};
      const old = this.k.db.prepare('SELECT * FROM commerce_reverse_hub_routes WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id, s.store_id, p.route_id) as Row | undefined;
      if (old) {if (old.digest !== contentDigest(body)) throw new Error('HUB_ROUTE_CONFLICT');}
      else partnerInsert(this.k, 'commerce_reverse_hub_routes', s, p.route_id, r.resource_id, subject_hash, 'routed', body);
      return this.read(scope, p.route_id);
    });
  }
  importReceipt(scope: Scope, input: unknown) {
    const p = exact(jsonValue(input), ['route_id', 'event_id']); id(p.event_id);
    return this.k.transaction(() => {
      const row = partnerRow(this.k, scope, 'commerce_reverse_hub_routes', p.route_id, 'warehouse.receive'), b = row.body;
      if (b.redacted || row.state !== 'routed') throw new Error('HUB_ROUTE_REVOKED');
      partnerSource(this.k, scope, this.source, b.context); new PartnerReadiness(this.k).assertReconcile(scope, b.context);
      if (b.warehouse_source_identity !== this.warehouse.identity) throw new Error('WAREHOUSE_SOURCE_MISMATCH');
      const event = this.warehouse.returnEvent(p.event_id);
      if (!event || event.request_id !== b.request_id || event.resource_id !== row.resource_id || event.location_id !== b.location_id) throw new Error('WAREHOUSE_RETURN_MISMATCH');
      this.receiving.importEvent(scope, {request_id: b.request_id, event_id: p.event_id}); return this.read(scope, row.id);
    });
  }
  read(scope: Scope, ref: string) {
    const row = partnerRow(this.k, scope, 'commerce_reverse_hub_routes', ref), b = row.body;
    if (b.redacted) return {id: row.id, resource_id: row.resource_id, state: row.state, redacted: true, physical_receipt_qualified: false, external_qualified: false};
    const {receipt, events} = this.receiving.read(scope, b.request_id);
    return {id: row.id, resource_id: row.resource_id, request_id: b.request_id, state: row.state, site_id: b.site_id,
      warehouse_source_identity: b.warehouse_source_identity, events, observed_receipt_units: receipt.total_actual,
      discrepancies: receipt.discrepancies, physical_receipt_qualified: false, stock_effects: 0,
      qualification: 'synthetic_local_only', external_qualified: false};
  }
}
