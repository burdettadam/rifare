import { exact,id } from './kernel.mts';
import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { allocationContext,minor } from './resolution-ledger.mts';
import { assertMoneySource,canonicalFeeEvents,currencyBinding } from './exchange-currency.mts';
import { feeSnapshot } from '../adapters/exchange-money-fixture-source.mts';
import { ResolutionFixtureSource } from '../adapters/resolution-fixture-source.mts';

const total=(fees:Row)=>minor(fees.restocking_minor)+minor(fees.return_shipping_minor)+minor(fees.tax_minor);
export function resolutionFeeValues(k:CommerceKernel,s:Row,allocationId:string,fallback:Row){
 const snapshot=feeSnapshot(canonicalFeeEvents(k,s,allocationId));if(!snapshot)return {...fallback,tax_minor:'0'};
 const binding=currencyBinding(k,s,allocationId);if(!binding)throw new Error('CURRENCY_BINDING_REQUIRED');const applied=snapshot.final??snapshot.estimate;
 if(applied.source_identity!==binding.source_identity||applied.shop_currency!==binding.shop_currency||applied.presentment_currency!==binding.presentment_currency||applied.resource_id!==binding.resource_id)throw new Error('FEE_HISTORY_INTEGRITY');
 return {...applied.shop,fee_snapshot:snapshot};
}
export class ExchangeFees {
 readonly kernel:CommerceKernel;readonly source:ResolutionFixtureSource;
 constructor(k:CommerceKernel,source:ResolutionFixtureSource){assertMoneySource(k,source);this.kernel=k;this.source=source;}
 refresh(scope:Scope,input:unknown){const p=exact(jsonValue(input),['allocation_id','event_id']),k=this.kernel;id(p.event_id);
  return k.transaction(()=>{const {s,a,c,plan}=allocationContext(k,scope,p.allocation_id,false);k.authorize(scope,'operation.reconcile',c.resource_id);
   const b=currencyBinding(k,s,a.id);if(!b||b.source_identity!==this.source.identity||s.tenant_id!==this.source.tenant||s.store_id!==this.source.store)throw new Error('CURRENCY_BINDING_REQUIRED');
   const event=this.source.money.event(p.event_id);
   for(const key of ['allocation_id','resource_id','customer_id','payment_id','source_identity','tenant_id','store_id','native_return_id','shop_currency','presentment_currency'])if(event[key]!==b[key])throw new Error('FEE_EVENT_MISMATCH');
   const existing=k.db.prepare('SELECT digest FROM commerce_exchange_fee_observations WHERE tenant_id=? AND store_id=? AND event_id=?').get(s.tenant_id,s.store_id,p.event_id) as Row,digest=contentDigest(event);
   if(existing){if(existing.digest!==digest)throw new Error('FEE_EVENT_CONFLICT');return this.read(scope,{allocation_id:a.id});}
   const previous=canonicalFeeEvents(k,s,a.id),estimate=previous.find(e=>e.phase==='estimated');
   if(event.phase==='estimated'&&estimate||event.phase==='final'&&(!estimate||event.native_fee_id!==estimate.native_fee_id))throw new Error('FEE_ESTIMATE_REQUIRED');
   k.db.prepare('INSERT INTO commerce_exchange_fee_observations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,a.id,c.id,c.resource_id,plan.request_id,event.event_id,event.phase,event.revision,this.source.identity,canonical(event),digest,k.clock());
   return this.read(scope,{allocation_id:a.id});
  });
 }
 read(scope:Scope,input:unknown){const p=exact(jsonValue(input),['allocation_id']),{s,c}=allocationContext(this.kernel,scope,p.allocation_id,false);this.kernel.authorize(scope,'operation.read',c.resource_id);
  const row=feeHistory(this.kernel,s,c.id).obligations.find((r:Row)=>r.allocation_id===p.allocation_id);if(!row)throw new Error('FEE_ESTIMATE_REQUIRED');return {...row,qualification:'synthetic_only',live_financial_authority:false};
 }
}
/** Lifecycle callers include this exact history in their cancellation/status digest. */
export function feeHistory(k:CommerceKernel,s:Row,caseId:string){
 const refs=k.db.prepare('SELECT DISTINCT allocation_id FROM commerce_exchange_fee_observations WHERE tenant_id=? AND store_id=? AND case_id=? ORDER BY allocation_id').all(s.tenant_id,s.store_id,id(caseId)) as Row[];
 const obligations=refs.map(({allocation_id})=>{const events=canonicalFeeEvents(k,s,allocation_id),snapshot=feeSnapshot(events)!;
  const op=k.db.prepare('SELECT * FROM commerce_resolution_operations WHERE tenant_id=? AND store_id=? AND allocation_id=?').get(s.tenant_id,s.store_id,allocation_id) as Row;
  let applied:Row|null=null;if(op){const command=JSON.parse(op.command);if(contentDigest(command)!==op.digest)throw new Error('RESOLUTION_INTEGRITY');applied=command.money_terms?.fee_snapshot??null;}
  const latest=snapshot.final??snapshot.estimate,approved=applied?.final??applied?.estimate??null;
  const binding=currencyBinding(k,s,allocation_id);if(!binding)throw new Error('CURRENCY_BINDING_REQUIRED');
  const exceeds=total(latest.shop)>=minor(binding.components.shop.paid_minor)||total(latest.presentment)>=minor(binding.components.presentment.paid_minor);
  const unresolved=exceeds||!!op&&canonical(applied)!==canonical(snapshot),delta=approved?{shop:(total(latest.shop)-total(approved.shop)).toString(),presentment:(total(latest.presentment)-total(approved.presentment)).toString()}:null;
  return {allocation_id,estimate:snapshot.estimate,final:snapshot.final,events,operation_id:op?.id??null,operation_state:op?.state??null,
   delta_from_estimate:{shop:(total(latest.shop)-total(snapshot.estimate.shop)).toString(),presentment:(total(latest.presentment)-total(snapshot.estimate.presentment)).toString()},
   delta_from_authorized:delta,unresolved,exceeds_original_value:exceeds,requires_new_approval:!!snapshot.final&&!op&&!exceeds,
   state:exceeds?'fee_exceeds_original_value':unresolved?'difference_requires_review':snapshot.final?'final_recorded':'awaiting_final',
   next_action:exceeds?'manual_fee_review':unresolved?'reconcile_original_operation':!op&&snapshot.final?'new_exact_preview':'none',new_effect_authorized:false};
 });
 const body={obligations,unresolved_count:obligations.filter(r=>r.unresolved).length};return {...body,digest:contentDigest(body)};
}
