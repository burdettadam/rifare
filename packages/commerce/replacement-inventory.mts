import { closureState,lifecycleObservation } from './return-lifecycle-core.mts';
import { exact,id,integer } from './kernel.mts';
import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { VariantExchanges } from './variant-exchanges.mts';
import { allocationContext,checkedBody,resolutionSettings } from './resolution-ledger.mts';
import { fulfillmentSettings,reservationRow,FULFILLMENT_ACTIONS } from './return-fulfillment-core.mts';
import { FulfillmentFixtureSource } from '../adapters/fulfillment-fixture-source.mts';
import { assertExecution } from './execution-stops.mts';
import { assertCaseWorkerScope } from './work-leases.mts';
import { CaseConfigurations } from './case-configurations.mts';
import { assertRecoveryEgress } from './data-guards.mts';
import { assertGiftOutcome } from './gift-proof.mts';

export function assertFulfillmentSource(k:CommerceKernel,source:FulfillmentFixtureSource,s?:Row){
 if(!(source instanceof FulfillmentFixtureSource)||source.db===k.db)throw new Error('SEPARATE_FIXTURE_SOURCE_REQUIRED');
 const path=(db:any)=>db.prepare('PRAGMA database_list').all().find((r:Row)=>r.name==='main')?.file;
 if(path(source.db)&&path(source.db)===path(k.db))throw new Error('SEPARATE_FIXTURE_SOURCE_REQUIRED');
 if(source.financeSource&&(source.financeSource.db===k.db||path(source.financeSource.db)&&path(source.financeSource.db)===path(k.db)))throw new Error('SEPARATE_FIXTURE_SOURCE_REQUIRED');
 if(s&&(s.tenant_id!==source.tenant||s.store_id!==source.store))throw new Error('FIXTURE_SOURCE_MISMATCH');
}
export class ReplacementInventory {
 readonly kernel:CommerceKernel;readonly source:FulfillmentFixtureSource;
 constructor(k:CommerceKernel,source:FulfillmentFixtureSource){assertFulfillmentSource(k,source);this.kernel=k;this.source=source;}
 #source(scope:Scope,allocation:string){const ctx=allocationContext(this.kernel,scope,allocation),settings=fulfillmentSettings(this.kernel,ctx.s);
  assertFulfillmentSource(this.kernel,this.source,ctx.s);if(settings.source_identity!==this.source.identity)throw new Error('FIXTURE_SOURCE_MISMATCH');
  this.kernel.authorize(scope,'action.propose',ctx.c.resource_id);assertCaseWorkerScope(this.kernel,scope,ctx.c.id);new CaseConfigurations(this.kernel).verified(scope,ctx.c.id);
  assertExecution(this.kernel,ctx.s,FULFILLMENT_ACTIONS.replacement);assertRecoveryEgress(this.kernel);return {ctx,settings};}
 #sync(scope:Scope,ref:string,result:Row){const k=this.kernel;return k.transaction(()=>{const r=reservationRow(k,scope,ref),b=r.reservation;
  assertFulfillmentSource(k,this.source,r.ctx.s);if(b.source_identity!==this.source.identity)throw new Error('FIXTURE_SOURCE_MISMATCH');
  exact(result,[...Object.keys(b),'state','native_reserved','qualification']);
  for(const key of Object.keys(b))if(canonical(result[key])!==canonical(b[key]))throw new Error('RESERVATION_RESULT_MISMATCH');
  if(!['active','expired','released','committed'].includes(result.state)||result.qualification!=='synthetic_only'||result.native_reserved!==(result.state==='active'&&b.expires_at>k.clock()))throw new Error('RESERVATION_RESULT_INVALID');
  if((['committed','released'].includes(r.state)&&r.state!==result.state)||(r.state==='expired'&&!['expired','released'].includes(result.state)))throw new Error('RESERVATION_STATE_REGRESSION');
  k.db.prepare('UPDATE commerce_inventory_reservations SET state=? WHERE tenant_id=? AND store_id=? AND id=?').run(result.state,r.ctx.s.tenant_id,r.ctx.s.store_id,ref);return this.read(scope,ref);});}
 reserve(scope:Scope,input:unknown){const p=exact(jsonValue(input),['quote_id','quote_digest','location_id','ttl_ms']);id(p.quote_id);id(p.location_id);integer(p.ttl_ms,1);if(p.ttl_ms>300000)throw new Error('INVALID_INPUT');
  const k=this.kernel,prepared=k.transaction(()=>{const q=new VariantExchanges(k).assertCurrent(scope,{quote_id:p.quote_id,quote_digest:p.quote_digest}),{ctx,settings}=this.#source(scope,q.allocation_id);
   const financial=q.balance_minor==='0'?null:resolutionSettings(k,ctx.s);
   if(financial&&(!this.source.financeSource||this.source.financeSource.identity!==financial.source_identity))throw new Error('EXCHANGE_FINANCE_SOURCE_REQUIRED');
   const gift=assertGiftOutcome(k,scope,ctx.c.id,'exchange',[ctx.b]),giftSettings=gift?resolutionSettings(k,ctx.s):null;
   if(gift){if(!this.source.financeSource||this.source.financeSource.identity!==giftSettings!.source_identity)throw new Error('GIFT_RECIPIENT_UNQUALIFIED');this.source.financeSource.assertGiftRecipient({resource_id:ctx.c.resource_id,customer_id:ctx.c.customer_id,recipient_customer_id:gift.recipient_customer_id,gift_source_digest:gift.source_digest});}
   const old=k.db.prepare('SELECT * FROM commerce_inventory_reservations WHERE tenant_id=? AND store_id=? AND allocation_id=? ORDER BY generation DESC LIMIT 1').get(ctx.s.tenant_id,ctx.s.store_id,q.allocation_id) as Row;
   if(old&&['unknown','active','committed'].includes(old.state)){const b=checkedBody(old);if(b.exchange_quote_id!==p.quote_id||b.location_id!==p.location_id)throw new Error('ALLOCATION_ALREADY_RESERVED');return {existing:old.id};}
   if(k.db.prepare("SELECT 1 FROM commerce_fulfillment_operations WHERE tenant_id=? AND store_id=? AND kind='replacement' AND obligation=?").get(ctx.s.tenant_id,ctx.s.store_id,q.allocation_id))throw new Error('OBLIGATION_ALREADY_AUTHORIZED');
   const catalog=k.get(scope,q.catalog_id),generation=(old?.generation??0)+1,ref='reservation_'+contentDigest([ctx.s.tenant_id,ctx.s.store_id,q.allocation_id,generation]).slice(0,36);
   const b={id:ref,source_identity:this.source.identity,tenant_id:ctx.s.tenant_id,store_id:ctx.s.store_id,allocation_id:q.allocation_id,case_id:ctx.c.id,resource_id:ctx.c.resource_id,generation,
    catalog_id:q.catalog_id,variant_id:q.replacement_variant,location_id:p.location_id,stock_version:catalog.source_version,quantity:q.quantity,buffer:q.buffer,
    exchange_quote_id:p.quote_id,exchange_quote_digest:p.quote_digest,settings_digest:settings.digest,expires_at:Math.min(k.clock()+p.ttl_ms,q.expires_at,settings.expires_at),
    ...(financial?{exchange_balance_minor:q.balance_minor,original_exchange_value_minor:q.available_exchange_value_minor,replacement_minor:q.replacement_minor,finance_source_identity:financial.source_identity}: {}),
    ...(gift?{gift_recipient_customer_id:gift.recipient_customer_id,gift_source_digest:gift.source_digest,gift_source_identity:giftSettings!.source_identity,original_customer_id:ctx.c.customer_id,original_native_order_id:ctx.c.order.payload.native_order_id}: {})};
   k.db.prepare("INSERT INTO commerce_inventory_reservations VALUES(?,?,?,?,?,?,?,'unknown',?,?)").run(ctx.s.tenant_id,ctx.s.store_id,ref,q.allocation_id,ctx.c.id,ctx.c.resource_id,generation,canonical(b),contentDigest(b));return {body:b};});
  if(prepared.existing)return this.reconcile(scope,prepared.existing);
  const b=prepared.body!;try{this.#source(scope,b.allocation_id);return this.#sync(scope,b.id,this.source.reserve(b));}catch(error){
   if(error instanceof Error&&['STOCK_UNAVAILABLE','STOCK_CHANGED','ALLOCATION_ALREADY_RESERVED','RESERVATION_EXPIRED'].includes(error.message)&&this.source.reservation(b.id)===null){
    k.transaction(()=>{const r=reservationRow(k,scope,b.id);k.authorize(scope,'action.propose',r.resource_id);if(r.state==='unknown')k.db.prepare("UPDATE commerce_inventory_reservations SET state='unavailable' WHERE tenant_id=? AND store_id=? AND id=?").run(r.ctx.s.tenant_id,r.ctx.s.store_id,b.id);});
   }return this.read(scope,b.id);
  }
 }
 reconcile(scope:Scope,ref:string){const r=reservationRow(this.kernel,scope,ref);this.kernel.authorize(scope,'operation.reconcile',r.resource_id);assertFulfillmentSource(this.kernel,this.source,r.ctx.s);
  if(r.reservation.source_identity!==this.source.identity)throw new Error('FIXTURE_SOURCE_MISMATCH');const result=this.source.reservation(ref);return result?this.#sync(scope,ref,result):this.read(scope,ref);}
 release(scope:Scope,input:unknown){const p=exact(jsonValue(input),['reservation_id','generation']);integer(p.generation,1);const k=this.kernel;
  const r=k.transaction(()=>{const row=reservationRow(k,scope,p.reservation_id,true);this.#source(scope,row.allocation_id);k.authorize(scope,'action.execute',row.resource_id);
   if(row.generation!==p.generation)throw new Error('RESERVATION_CHANGED');
   if(k.db.prepare("SELECT 1 FROM commerce_fulfillment_operations WHERE tenant_id=? AND store_id=? AND kind='replacement' AND obligation=?").get(row.ctx.s.tenant_id,row.ctx.s.store_id,row.allocation_id))throw new Error('RECONCILIATION_REQUIRED');
   if(row.state==='unknown')throw new Error('RECONCILIATION_REQUIRED');return row;});
  return this.#sync(scope,r.id,this.source.release(r.id,p.generation));}

 releaseCancelled(scope:Scope,input:unknown){const p=exact(jsonValue(input),['reservation_id','generation']);integer(p.generation,1);const k=this.kernel;
  const r=k.transaction(()=>{const row=reservationRow(k,scope,p.reservation_id,false),s=k.authorize(scope,'action.execute',row.resource_id);assertCaseWorkerScope(k,scope,row.case_id);assertRecoveryEgress(k);assertExecution(k,s,FULFILLMENT_ACTIONS.replacement);
   if(!closureState(k,s,row.ctx.plan.request_id))throw new Error('RETURN_NOT_CLOSED');assertFulfillmentSource(k,this.source,s);if(row.reservation.source_identity!==this.source.identity)throw new Error('FIXTURE_SOURCE_MISMATCH');if(row.generation!==p.generation)throw new Error('RESERVATION_CHANGED');
   const op=k.db.prepare("SELECT state FROM commerce_fulfillment_operations WHERE tenant_id=? AND store_id=? AND kind='replacement' AND obligation=?").get(s.tenant_id,s.store_id,row.allocation_id) as Row;
   if(row.state==='unknown'||op&&!['authorized','rejected'].includes(op.state))throw new Error('RECONCILIATION_REQUIRED');return row;});
  const result=this.#sync(scope,r.id,this.source.release(r.id,p.generation));
  k.transaction(()=>{const s=k.authorize(scope,'action.execute',r.resource_id);lifecycleObservation(k,s,r.ctx.plan.request_id,r.id,'reservation_cleanup',{state:result.state,generation:p.generation});});return result;
 }
 read(scope:Scope,ref:string){const r=reservationRow(this.kernel,scope,ref);return {id:r.id,allocation_id:r.allocation_id,generation:r.generation,state:r.state,expires_at:r.reservation.expires_at,
  quantity:r.reservation.quantity,location_id:r.reservation.location_id,source_identity:r.reservation.source_identity,native_reserved:r.state==='active'&&r.reservation.expires_at>this.kernel.clock(),
  reservation_scope:'fixture_native_only',live_stock_ownership:false,requires_source_recheck:true};}
}
