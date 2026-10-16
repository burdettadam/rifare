import { CommerceKernel, exact, id, integer, token } from './kernel.mts';
import type { Scope, Row } from './kernel.mts';
import { Capabilities } from './capabilities.mts';
import { Knowledge } from './knowledge.mts';
import { Skills } from './skills.mts';
import { Profiles } from './profiles.mts';
import type { ShopifyOrders } from '../adapters/shopify/orders.mts';

export interface SourceReference {
  system:string; native_id:string; revision:number; observed_at:number|null; source_updated_at:number|null;
  evidence_kind:string;
}
export class ReadContext {
  #kernel:CommerceKernel;#caps:Capabilities;#readers:Record<string,{cached:(scope:Scope,id:string)=>any}>;
  readonly knowledge:Knowledge;readonly skills:Skills;readonly profiles:Profiles;
  constructor(kernel:CommerceKernel,caps:Capabilities,options:{shopify?:ShopifyOrders;readers?:Record<string,{cached:(scope:Scope,id:string)=>any}>}={}) {
    this.#kernel=kernel;this.#caps=caps;this.#readers={...(options.shopify?{shopify:options.shopify}:{}),...options.readers};
    this.knowledge=new Knowledge(kernel);this.skills=new Skills(kernel);this.profiles=new Profiles(kernel,this.skills);
  }
  orderStatus(scope:Scope,resourceId:string) {
    const k=this.#kernel,s=k.require(scope),resource=k.get(scope,id(resourceId));
    if(resource.kind!=='order')throw new Error('INVALID_INPUT');
    if(resource.source_system!=='synthetic') {
      const reader=this.#readers[resource.source_system];if(!reader)throw new Error('ADAPTER_UNAVAILABLE');
      return {contract_version:'1.0.0',...reader.cached(scope,resourceId)};
    }
    const order=this.#caps.read(scope,'order.read',resourceId);
    const c=k.db.prepare('SELECT granted_scopes FROM commerce_connections WHERE tenant_id=? AND store_id=?').get(s.tenant_id,s.store_id) as Row;
    const canShip=JSON.parse(c.granted_scopes).includes('read_shipments');
    const shipments=canShip?(k.db.prepare(`SELECT * FROM commerce_resources WHERE tenant_id=? AND store_id=?
      AND kind='shipment' AND source_system=? AND customer_id IS ? AND json_extract(payload,'$.order_number')=? ORDER BY id`)
      .all(s.tenant_id,s.store_id,order.source_system,order.customer_id,order.external_id) as Row[]):[];
    const provenance=(r:Row):SourceReference=>({system:r.source_system,native_id:r.external_id,revision:r.source_version,
      observed_at:r.observed_at,source_updated_at:r.source_updated_at,evidence_kind:'synthetic_store'});
    return {contract_version:'1.0.0',resource_id:order.id,status:'fixture_snapshot',production_qualified:false,
      order:{number:order.external_id,fulfillment_status:order.payload.status,
        totals:{amount_minor:order.payload.total_minor,currency:order.payload.currency},lines:order.payload.items,
        shipments:shipments.map(row=>{const p=JSON.parse(row.payload);return {source_id:row.external_id,delivery_state:p.status,
          carrier:p.carrier,tracking_number:p.tracking,source:provenance(row)};}),
        shipments_status:canShip?'scoped_fixture_snapshot':'required_scope_missing'},source:provenance(order)};
  }
  action(scope:Scope,action:string,args:unknown) {
    this.#kernel.require(scope);
    switch(action) {
      case 'order.status': {const r=exact(args,['order_id']);return this.orderStatus(scope,id(r.order_id));}
      case 'knowledge.search': {const r=exact(args,['query']);return this.knowledge.search(scope,r.query);}
      case 'knowledge.get': {const r=exact(args,['source_id','revision']);return this.knowledge.get(scope,id(r.source_id),integer(r.revision,1));}
      case 'skill.read': {const r=exact(args,['skill_id','resource','bundle_digest']);return this.skills.read(scope,id(r.skill_id),r.resource,r.bundle_digest);}
      default:throw new Error('UNKNOWN_READ_ACTION');
    }
  }
  createTask(scope:Scope,input:unknown) {
    this.#kernel.authorize(scope,'task.read');
    const k=this.#kernel,s=k.require(scope),r=exact(input,['order_id','profile_id']);id(r.order_id);id(r.profile_id);
    const current=this.orderStatus(scope,r.order_id);
    if(!current.order)throw new Error('CURRENT_FACTS_UNAVAILABLE');
    const p=this.profiles.permit(scope,r.profile_id,'order.status').profile;
    const now=k.clock(),taskId='task_'+token().slice(0,32);
    const n=k.db.prepare('SELECT count(*) AS n FROM commerce_context_tasks WHERE tenant_id=? AND store_id=? AND expires_at>?').get(s.tenant_id,s.store_id,now) as Row;
    if(n.n>=1000)throw new Error('TASK_LIMIT');
    k.db.prepare('INSERT INTO commerce_context_tasks VALUES(?,?,?,?,?,?,?,?,?)')
      .run(s.tenant_id,s.store_id,taskId,r.order_id,r.profile_id,p.revision,p.skill_digest,now,now+3600000);
    return this.task(scope,taskId);
  }
  #record(scope:Scope,taskId:string) {
    const k=this.#kernel,s=k.require(scope);id(taskId);
    const r=k.db.prepare('SELECT * FROM commerce_context_tasks WHERE tenant_id=? AND store_id=? AND id=? AND expires_at>?')
      .get(s.tenant_id,s.store_id,taskId,k.clock()) as Row;
    if(!r)throw new Error('NOT_FOUND');k.get(scope,r.resource_id);
    const p=this.profiles.get(scope,r.profile_id).profile;
    if(p.revision!==r.profile_revision||p.skill_digest!==r.skill_digest)throw new Error('TASK_CONTEXT_CHANGED');
    return {r,p};
  }
  task(scope:Scope,taskId:string) {
    this.#kernel.authorize(scope,'task.read');
    const {r,p}=this.#record(scope,taskId);
    return {contract_version:'1.0.0',id:r.id,type:'order-status-read',state:'read_context',created_at:r.created_at,expires_at:r.expires_at,
      order_id:r.resource_id,profile:p,skill:this.skills.describe(scope,p.skill_id),facts:this.orderStatus(scope,r.resource_id),
      financial_actions_available:false,agent_runtime_required:false};
  }
  taskAction(scope:Scope,taskId:string,action:string,args:unknown) {
    this.#kernel.authorize(scope,'task.read');
    const {r,p}=this.#record(scope,taskId);this.profiles.permit(scope,r.profile_id,action);
    if(action==='order.status') {
      const input=exact(args,['order_id']);if(input.order_id!==r.resource_id)throw new Error('ACCESS_DENIED');
    }
    if(action==='knowledge.search') {
      const input=exact(args,['query']);return this.knowledge.search(scope,input.query,5,r.resource_id);
    }
    if(action==='knowledge.get') {
      const input=exact(args,['source_id','revision']);return this.knowledge.get(scope,id(input.source_id),integer(input.revision,1),r.resource_id);
    }
    if(action==='skill.read') {
      const input=exact(args,['skill_id','resource','bundle_digest']);
      if(input.skill_id!==p.skill_id||input.bundle_digest!==p.skill_digest)throw new Error('ACCESS_DENIED');
    }
    return this.action(scope,action,args);
  }
}
