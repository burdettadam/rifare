import { exact,id,resourceKey } from './kernel.mts';
import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { allocationContext,financialFacts,checkedBody,resolutionSettings,minor } from './resolution-ledger.mts';
import { assertRecoveryEgress } from './data-guards.mts';
import { assertCaseWorkerScope } from './work-leases.mts';
import { assertExecution } from './execution-stops.mts';
import { CaseConfigurations } from './case-configurations.mts';
import { ExchangeLineageFixtureSource } from '../adapters/exchange-lineage-fixture-source.mts';
import { lineageNode } from './exchange-lineage-guards.mts';

const sources=new WeakMap<CommerceKernel,ExchangeLineageFixtureSource>();
export function exchangeLineagePin(k:CommerceKernel,scope:Scope,q:Row){
 const ctx=allocationContext(k,scope,q.allocation_id),source=sources.get(k),node=lineageNode(k,ctx.s,ctx.c.resource_id);
 if(!source){if(node)throw new Error('LINEAGE_SOURCE_REQUIRED');return null;}
 // A source may serve selected original orders. Registering it for the kernel does
 // not enroll unrelated legacy orders; a known descendant can never opt out.
 if(!node&&!source.registered(ctx.c.resource_id))return null;
 if(source.tenant!==ctx.s.tenant_id||source.store!==ctx.s.store_id||source.identity!==resolutionSettings(k,ctx.s).source_identity)throw new Error('LINEAGE_SOURCE_MISMATCH');
 const facts=financialFacts(k,ctx.c),catalog=k.get(scope,q.catalog_id).payload;
 const pin=source.pin({parent_resource_id:ctx.c.resource_id,allocation_id:ctx.a.id,customer_id:ctx.c.customer_id,payment_id:facts.payment_id,currency:facts.currency,native_original_order_id:ctx.c.order.payload.native_order_id,
  line_id:ctx.b.line_id,units:ctx.b.units,parent_paid_minor:ctx.b.components.paid_minor,entitlement_minor:q.available_exchange_value_minor,replacement_minor:q.replacement_minor,replacement_product_id:catalog.product_id,
  replacement_retail_minor:(minor(catalog.unit_price_minor)*BigInt(q.quantity)+minor(catalog.tax_per_unit_minor)*BigInt(q.quantity)+minor(catalog.shipping_minor)+minor(catalog.duties_per_unit_minor)*BigInt(q.quantity)).toString(),
  exchange_quote_id:q.quote_id,exchange_quote_digest:q.quote_digest,configuration_digest:ctx.c.configuration_digest,policy_digest:ctx.c.pins.policy.digest,...(ctx.b.bundle_component?{bundle_component:ctx.b.bundle_component}:{})});
 return {exchange_lineage:pin};
}
export class ExchangeLineage {
 readonly kernel:CommerceKernel;readonly source:ExchangeLineageFixtureSource;
 constructor(k:CommerceKernel,source:ExchangeLineageFixtureSource){
  const path=(db:any)=>db.prepare('PRAGMA database_list').all().find((r:Row)=>r.name==='main')?.file;
  if(!(source instanceof ExchangeLineageFixtureSource)||source.db===k.db||path(source.db)&&path(source.db)===path(k.db)||source.fulfillment.db===k.db||path(source.fulfillment.db)&&path(source.fulfillment.db)===path(k.db))throw new Error('SEPARATE_FIXTURE_SOURCE_REQUIRED');
  const old=sources.get(k);if(old&&(old.identity!==source.identity||old.fulfillment.identity!==source.fulfillment.identity))throw new Error('LINEAGE_SOURCE_MISMATCH');sources.set(k,source);this.kernel=k;this.source=source;
 }
 #context(scope:Scope,operation:string){const k=this.kernel,s=k.require(scope),op=k.db.prepare("SELECT * FROM commerce_fulfillment_operations WHERE tenant_id=? AND store_id=? AND id=? AND kind='replacement'").get(s.tenant_id,s.store_id,id(operation)) as Row;
  if(!op)throw new Error('NOT_FOUND');const c=new CaseConfigurations(k).inspect(scope,op.case_id);k.authorize(scope,'operation.reconcile',c.resource_id);assertCaseWorkerScope(k,scope,c.id);
  if(s.tenant_id!==this.source.tenant||s.store_id!==this.source.store||op.state!=='created'||op.resource_id!==c.resource_id)throw new Error('LINEAGE_REPLACEMENT_UNCONFIRMED');
  const command=JSON.parse(op.command);if(contentDigest(command)!==op.digest||command.source_identity!==this.source.fulfillment.identity||command.operation_id!==op.id)throw new Error('LINEAGE_INTEGRITY');return {s,op,c,command};
 }
 materialize(scope:Scope,input:unknown){const p=exact(jsonValue(input),['operation_id']),k=this.kernel,ctx=this.#context(scope,p.operation_id);assertRecoveryEgress(k);assertExecution(k,ctx.s,'diagnostic.exchange.create');
  const found=k.db.prepare('SELECT * FROM commerce_exchange_lineage_imports WHERE tenant_id=? AND store_id=? AND operation_id=?').get(ctx.s.tenant_id,ctx.s.store_id,ctx.op.id) as Row;
  if(found?.state==='imported')return this.read(scope,found.node_id);
  if(!found)k.transaction(()=>{const now=this.#context(scope,p.operation_id);k.db.prepare("INSERT INTO commerce_exchange_lineage_imports VALUES(?,?,?,?,?,'unknown',NULL)").run(now.s.tenant_id,now.s.store_id,now.op.id,now.c.id,now.c.resource_id);});
  let native:Row|null;try{native=found?(this.source.lookup(ctx.op.id)??this.source.transfer(ctx.op.id)):this.source.transfer(ctx.op.id);}catch{return {operation_id:ctx.op.id,state:'unknown',retry_allowed:false,requires_original_operation_lookup:true};}
  if(!native)return {operation_id:ctx.op.id,state:'unknown',retry_allowed:false,requires_original_operation_lookup:true};
  return k.transaction(()=>{const current=this.#context(scope,p.operation_id),hash=contentDigest(native!);assertRecoveryEgress(k);assertExecution(k,current.s,'diagnostic.exchange.create');
   if(native!.operation_id!==current.op.id||native!.parent_resource_id!==current.c.resource_id||native!.customer_id!==current.c.customer_id||native!.source_identity!==this.source.identity||native!.fulfillment_source_identity!==this.source.fulfillment.identity||native!.tenant_id!==current.s.tenant_id||native!.store_id!==current.s.store_id||canonical(this.source.lookup(current.op.id))!==canonical(native))throw new Error('LINEAGE_SOURCE_MISMATCH');
   const child=resourceKey(current.s.tenant_id,current.s.store_id,'order','synthetic',native!.external_id);if(child!==native!.resource_id)throw new Error('LINEAGE_INTEGRITY');k.authorize(scope,'resource.ingest',child);
   const prior=k.db.prepare('SELECT * FROM commerce_exchange_lineage_nodes WHERE tenant_id=? AND store_id=? AND operation_id=?').get(current.s.tenant_id,current.s.store_id,current.op.id) as Row;
   if(prior&&prior.digest!==hash)throw new Error('LINEAGE_INTEGRITY');
   if(!prior)k.db.prepare('INSERT INTO commerce_exchange_lineage_nodes VALUES(?,?,?,?,?,?,?,?,?,?)').run(current.s.tenant_id,current.s.store_id,native!.id,child,native!.parent_resource_id,current.op.id,native!.native_order_id,native!.customer_id,canonical(native),hash);
   // Ingest only the descendant's paid and physical facts. Ancestor/payment history is staff-only.
   k.ingest(scope,{kind:'order',source_system:'synthetic',external_id:native!.external_id,source_version:1,source_updated_at:native!.delivered_at,customer_id:native!.customer_id,payload:{status:'delivered',currency:native!.currency,total_minor:native!.carried_minor,delivered_at:native!.delivered_at,tags:[],evidence_verified:true,native_order_id:native!.native_order_id,counted_return_ids:[],
    return_lines:[{id:native!.line_id,fulfillment_line_id:native!.fulfillment_line_id,ordered:native!.quantity,fulfilled:native!.quantity,returned:0,unit_minor:(minor(native!.carried_minor)/BigInt(native!.quantity)).toString(),tags:[]}],
    resolution_facts:{revision:1,observed_at:k.clock(),currency:native!.currency,payment_id:native!.payment_id,original_paid_minor:native!.carried_minor,prior_refunded_minor:'0',accounted_operations:[],paid_lines:native!.paid_lines,instrument_allocations:native!.instrument_allocations,lineage_digest:hash},exchange_lineage:{node_id:native!.id,digest:hash}}});
   k.db.prepare("UPDATE commerce_exchange_lineage_imports SET state='imported',node_id=? WHERE tenant_id=? AND store_id=? AND operation_id=?").run(native!.id,current.s.tenant_id,current.s.store_id,current.op.id);return this.read(scope,native!.id);
  });
 }
 read(scope:Scope,nodeId:string){const k=this.kernel,s=k.require(scope,['operator','reviewer','owner','worker']),row=k.db.prepare('SELECT * FROM commerce_exchange_lineage_nodes WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,id(nodeId)) as Row,b=checkedBody(row,'LINEAGE_INTEGRITY');
  k.authorize(scope,'operation.read',b.parent_resource_id);k.get(scope,b.parent_resource_id);k.get(scope,b.resource_id);return {state:'imported',node:b,digest:row.digest,qualification:'synthetic_only'};
 }
}

export function lineageHistory(k:CommerceKernel,s:Row,caseId:string){
 const imports=k.db.prepare('SELECT operation_id,resource_id,state,node_id FROM commerce_exchange_lineage_imports WHERE tenant_id=? AND store_id=? AND case_id=? ORDER BY operation_id').all(s.tenant_id,s.store_id,id(caseId)) as Row[];
 const nodes=imports.filter(r=>r.state==='imported').map(r=>{const row=k.db.prepare('SELECT * FROM commerce_exchange_lineage_nodes WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,r.node_id) as Row,b=checkedBody(row,'LINEAGE_INTEGRITY');return {node_id:b.id,resource_id:b.resource_id,parent_resource_id:b.parent_resource_id,generation:b.generation,carried_minor:b.carried_minor,fees_minor:b.fees_minor,currency:b.currency};});
 return {imports,nodes,unresolved_count:imports.filter(r=>r.state==='unknown').length,digest:contentDigest({imports,nodes})};
}
