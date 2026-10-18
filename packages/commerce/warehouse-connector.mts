import { exact, id } from './kernel.mts';
import type { CommerceKernel, Scope, Row } from './kernel.mts';
import { jsonValue } from './configuration-values.mts';
import { assertNotErased, assertRecoveryEgress } from './data-guards.mts';
import { OrderEditFixtureSource, WAREHOUSE_CONNECTOR } from '../adapters/order-edit-fixture-source.mts';

export { WAREHOUSE_CONNECTOR };

/** Server-local administration and observed readiness for the fixed synthetic
 * warehouse adapter. OrderEdits remains the only edit/approval/dispatch engine. */
export class WarehouseConnector {
  readonly kernel:CommerceKernel;
  readonly source:OrderEditFixtureSource;
  constructor(kernel:CommerceKernel,source:OrderEditFixtureSource) {
    if(!(source instanceof OrderEditFixtureSource)||source.db===kernel.db)
      throw new Error('SEPARATE_FIXTURE_SOURCE_REQUIRED');
    this.kernel=kernel;this.source=source;
  }
  #scope(scope:Scope,permission:string,resource:string|null=null) {
    const s=this.kernel.authorize(scope,permission,resource);
    if(s.tenant_id!==this.source.tenant||s.store_id!==this.source.store)
      throw new Error('EDIT_SOURCE_MISMATCH');
    return s;
  }
  configure(scope:Scope,input:unknown) {
    this.#scope(scope,'action.configure');assertRecoveryEgress(this.kernel);
    const binding=this.source.configureConnector(jsonValue(input));
    return {binding,connector:WAREHOUSE_CONNECTOR,qualification:'synthetic_only',
      live_qualified:false,formal_goal_accepted:false,external_effects:0};
  }
  status(scope:Scope,input:unknown) {
    this.#scope(scope,'action.configure');
    const p=exact(jsonValue(input),['warehouse_id']),binding=this.source.connectorBinding(id(p.warehouse_id));
    if(!binding)throw new Error('WAREHOUSE_CONNECTOR_NOT_CONFIGURED');
    return {binding,reasons:this.source.connectorIssues(p.warehouse_id),
      live_qualified:false,formal_goal_accepted:false,qualification:'synthetic_only'};
  }
  qualify(scope:Scope,input:unknown) {
    this.#scope(scope,'action.configure');assertRecoveryEgress(this.kernel);
    const p=exact(jsonValue(input),['warehouses']);
    if(!Array.isArray(p.warehouses)||p.warehouses.length<1||p.warehouses.length>4)
      throw new Error('INVALID_INPUT');
    for(const w of p.warehouses)if(!this.source.connectorBinding(id(w)))
      throw new Error('WAREHOUSE_CONNECTOR_NOT_CONFIGURED');
    const observed=this.source.probe(p.warehouses);
    return {...observed,connector:WAREHOUSE_CONNECTOR,live_qualified:false,
      formal_goal_accepted:false,connected_account:false,physical_qualification:false};
  }
  inspect(scope:Scope,input:unknown) {
    const p=exact(jsonValue(input),['resource_id','warehouse_id']);
    const s=this.#scope(scope,'resource.read',id(p.resource_id));
    const resource=this.kernel.get(scope,p.resource_id);
    assertNotErased(this.kernel,s,resource.id,resource.customer_id);
    const order=this.source.order(resource.id);
    if(order.tenant_id!==s.tenant_id||order.store_id!==s.store_id||
      order.customer_id!==resource.customer_id)throw new Error('EDIT_SOURCE_MISMATCH');
    if(!order.lines.some((l:Row)=>l.warehouse_id===id(p.warehouse_id)))
      throw new Error('EDIT_WAREHOUSE_MISSING');
    return {resource_id:resource.id,warehouse:this.source.warehouse(resource.id,p.warehouse_id),
      can_pick:this.source.canPick(resource.id,p.warehouse_id),
      binding:this.source.connectorBinding(p.warehouse_id),qualification:'synthetic_only',
      live_qualified:false,physical_qualification:false,formal_goal_accepted:false};
  }
}
