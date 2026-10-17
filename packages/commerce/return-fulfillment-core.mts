import { exact,id,integer,token } from './kernel.mts';
import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { CaseConfigurations } from './case-configurations.mts';
import { checkedBody,allocationContext,resolutionSettings,minor } from './resolution-ledger.mts';
import { evidenceReviewState } from './return-intake-core.mts';
import { VariantExchanges } from './variant-exchanges.mts';
import { assertCaseWorkerScope } from './work-leases.mts';
import { assertExecution } from './execution-stops.mts';
import { assertReady,DRAFT_ACTION } from './integration-readiness.mts';
import { money } from './money.mts';

export const FULFILLMENT_ACTIONS=Object.freeze({replacement:'diagnostic.exchange.create',label:'diagnostic.label.purchase',void:'diagnostic.label.void'});
export const FULFILLMENT_CONTRACT={id:'rifare-fulfillment-fixture-v1',version:1,qualification:'synthetic_only',live_transport:false};
export function fulfillmentSettings(k:CommerceKernel,s:Row){const r=k.db.prepare('SELECT * FROM commerce_fulfillment_settings WHERE tenant_id=? AND store_id=?').get(s.tenant_id,s.store_id) as Row,b=checkedBody(r);
 if(!b.enabled||b.expires_at<=k.clock())throw new Error('FULFILLMENT_NOT_READY');assertReady(k,s,DRAFT_ACTION);return {...b,revision:r.revision,digest:r.digest};}
export class FulfillmentConfiguration {
 readonly kernel:CommerceKernel;constructor(k:CommerceKernel){this.kernel=k;}
 configure(scope:Scope,input:unknown){const p=exact(jsonValue(input),['expected_revision','enabled','source_identity','account_id','expires_at','resolution_trigger']);integer(p.expected_revision);integer(p.expires_at);id(p.source_identity);id(p.account_id);
  if(typeof p.enabled!=='boolean'||!['manual','carrier_transit','carrier_delivery','warehouse_receipt'].includes(p.resolution_trigger))throw new Error('INVALID_INPUT');
  const k=this.kernel;return k.transaction(()=>{const s=k.authorize(scope,'action.configure');assertReady(k,s,DRAFT_ACTION);
   if(p.expires_at<=k.clock()||p.expires_at>k.clock()+3600000)throw new Error('INVALID_INPUT');
   const r=k.db.prepare('SELECT revision FROM commerce_fulfillment_settings WHERE tenant_id=? AND store_id=?').get(s.tenant_id,s.store_id) as Row;if((r?.revision??0)!==p.expected_revision)throw new Error('FULFILLMENT_SETTINGS_CHANGED');
   const b={...p};delete b.expected_revision;k.db.prepare('INSERT INTO commerce_fulfillment_settings VALUES(?,?,?,?,?) ON CONFLICT(tenant_id,store_id) DO UPDATE SET revision=excluded.revision,body=excluded.body,digest=excluded.digest').run(s.tenant_id,s.store_id,p.expected_revision+1,canonical(b),contentDigest(b));
   return {revision:p.expected_revision+1,qualification:'synthetic_only',native_provider_qualified:false};});}
}
export function fulfillmentContext(k:CommerceKernel,scope:Scope,caseId:string,requestId:string,active=true){
 const s=k.require(scope),cases=new CaseConfigurations(k),c=active?cases.resume(scope,id(caseId)):cases.inspect(scope,id(caseId));k.authorize(scope,'return.read',c.resource_id);
 const r=k.db.prepare('SELECT * FROM commerce_return_requests WHERE tenant_id=? AND store_id=? AND id=? AND case_id=?').get(s.tenant_id,s.store_id,id(requestId),c.id) as Row;checkedBody(r);
 const n=k.db.prepare("SELECT * FROM commerce_native_return_operations WHERE tenant_id=? AND store_id=? AND request_id=? AND state='created'").get(s.tenant_id,s.store_id,r.id) as Row;
 if(!n)throw new Error('NATIVE_RETURN_REQUIRED');const native=JSON.parse(n.native_body);if(contentDigest(native)!==n.native_digest)throw new Error('NATIVE_RETURN_INTEGRITY');
 if(active&&!['OPEN','CLOSED'].includes(native.status))throw new Error('NATIVE_RETURN_UNAVAILABLE');
 if(active&&evidenceReviewState(k,s,c.id)?.event==='evidence_requested')throw new Error('RETURN_REVIEW_REQUIRED');
 return {s,c,request:r,native:n};
}
export function reservationRow(k:CommerceKernel,scope:Scope,ref:string,active=false){const s=k.require(scope),r=k.db.prepare('SELECT * FROM commerce_inventory_reservations WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,id(ref)) as Row,b=checkedBody(r);
 const ctx=allocationContext(k,scope,r.allocation_id,active);if(b.case_id!==ctx.c.id||b.resource_id!==ctx.c.resource_id||b.allocation_id!==r.allocation_id)throw new Error('RESERVATION_INTEGRITY');return {...r,reservation:b,ctx};}
export function labelRow(k:CommerceKernel,scope:Scope,ref:string){const s=k.require(scope),r=k.db.prepare('SELECT * FROM commerce_return_labels WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,id(ref)) as Row,b=checkedBody(r);fulfillmentContext(k,scope,r.case_id,r.request_id,false);
 if(b.id!==r.id||b.request_id!==r.request_id||b.case_id!==r.case_id||b.generation!==r.generation)throw new Error('LABEL_INTEGRITY');return {...r,label:b};}
export function parcelRow(k:CommerceKernel,scope:Scope,request:string){const s=k.require(scope),r=k.db.prepare('SELECT * FROM commerce_return_parcels WHERE tenant_id=? AND store_id=? AND request_id=?').get(s.tenant_id,s.store_id,id(request)) as Row,b=checkedBody(r);
 fulfillmentContext(k,scope,r.case_id,r.request_id);return {...r,parcel:b};}
export function currentLabel(k:CommerceKernel,s:Row,request:string){return k.db.prepare('SELECT * FROM commerce_return_shipments WHERE tenant_id=? AND store_id=? AND request_id=?').get(s.tenant_id,s.store_id,request) as Row|undefined;}

function sourcePin(k:CommerceKernel,scope:Scope,ctx:Row){const proof=new CaseConfigurations(k).verified(scope,ctx.c.id),settings=fulfillmentSettings(k,ctx.s);assertCaseWorkerScope(k,scope,ctx.c.id);
 const maxAge=ctx.c.pins.composition.effective['data.max_age_seconds']*1000;if(ctx.c.order.observed_at>k.clock()||k.clock()-ctx.c.order.observed_at>maxAge)throw new Error('FULFILLMENT_SOURCE_STALE');
 return {tenant_id:ctx.s.tenant_id,store_id:ctx.s.store_id,case_id:ctx.c.id,case_revision:ctx.c.revision,resource_id:ctx.c.resource_id,customer_id:proof.customer_id,
  configuration_digest:ctx.c.configuration_digest,policy_digest:ctx.c.pins.policy.digest,source_version:ctx.c.order.source_version,source_digest:contentDigest(ctx.c.order),
  resolution_trigger:settings.resolution_trigger,native_return_id:ctx.native.native_id,native_original_order_id:JSON.parse(ctx.native.native_body).order_id,native_return_digest:ctx.native.native_digest,settings_digest:settings.digest,settings_revision:settings.revision,
  source_identity:settings.source_identity,account_id:settings.account_id,proof_expires_at:proof.expires_at,settings_expires_at:settings.expires_at};}

export function fulfillmentValue(k:CommerceKernel,scope:Scope,kind:string,intent:Row,quotedAt:number,rate:Row|null=null){
 if(!Object.hasOwn(FULFILLMENT_ACTIONS,kind))throw new Error('UNSUPPORTED_ACTION');let ctx:Row,details:Row,obligation:string,expiry=quotedAt+300000,amount='0',currency='USD';
 if(kind==='replacement'){
  exact(intent,['reservation_id']);const r=reservationRow(k,scope,intent.reservation_id,true),b=r.reservation;
  if(r.state!=='active'||b.expires_at<=k.clock())throw new Error('RESERVATION_UNAVAILABLE');
  const setting=fulfillmentSettings(k,r.ctx.s);if(b.source_identity!==setting.source_identity||b.settings_digest!==setting.digest)throw new Error('FULFILLMENT_SETTINGS_CHANGED');
  const q=new VariantExchanges(k).validateForReview(scope,{quote_id:b.exchange_quote_id,quote_digest:b.exchange_quote_digest});
  if(q.allocation_id!==r.allocation_id||b.quantity!==q.quantity||b.variant_id!==q.replacement_variant)throw new Error('RESERVATION_INTEGRITY');
  ctx=fulfillmentContext(k,scope,r.case_id,r.ctx.plan.request_id);details={reservation_id:r.id,reservation_digest:r.digest,generation:r.generation,allocation_id:r.allocation_id,
   variant_id:b.variant_id,location_id:b.location_id,quantity:b.quantity,catalog_id:b.catalog_id,exchange_quote_digest:b.exchange_quote_digest,
   original_variant:q.original_variant,exchange_value_minor:q.replacement_minor,retained_discount_minor:q.retained_discount_minor,balance_minor:q.balance_minor};
  if(q.balance_minor!=='0')throw new Error('PRICE_DIFFERENCE_UNSUPPORTED');currency=q.currency;obligation=r.allocation_id;expiry=Math.min(expiry,b.expires_at,q.expires_at);
 }else if(kind==='label'){
  exact(intent,['request_id','replaces']);if(intent.replaces!==null)id(intent.replaces);const p=parcelRow(k,scope,intent.request_id);ctx=fulfillmentContext(k,scope,p.case_id,p.request_id);
  const old=currentLabel(k,ctx.s,p.request_id),generation=(old?.generation??0)+1;
  if(old){if(old.current_label_id!==intent.replaces)throw new Error('LABEL_REPLACEMENT_REQUIRED');const l=labelRow(k,scope,intent.replaces);
   if(!['confirmed','expired_unused'].includes(l.label.void_state))throw new Error('LABEL_REPLACEMENT_BLOCKED');}
  else if(intent.replaces!==null)throw new Error('LABEL_REPLACEMENT_INVALID');
  if(!rate||rate.parcel_digest!==p.digest||rate.parcel_revision!==p.revision||rate.service!==p.parcel.service||rate.expires_at<=k.clock())throw new Error('RATE_CHANGED');
  const settings=fulfillmentSettings(k,ctx.s);if(rate.account_id!==settings.account_id||rate.source_identity!==settings.source_identity||rate.tenant_id!==ctx.s.tenant_id||rate.store_id!==ctx.s.store_id)throw new Error('RATE_CHANGED');
  const {rate_id,...rateBody}=rate;if(rate_id!=='rate_'+contentDigest(rateBody).slice(0,40))throw new Error('RATE_CHANGED');
  minor(rate.amount_minor);money(rate.currency,rate.amount_minor);
  details={parcel_digest:p.digest,parcel_revision:p.revision,service:p.parcel.service,address_revision:p.parcel.address_revision,package:p.parcel.package,from_address_ref:p.parcel.from_address_ref,to_address_ref:p.parcel.to_address_ref,rate,generation,replaces:intent.replaces};
  amount=rate.amount_minor;currency=rate.currency;obligation=p.request_id+'_label_'+generation;expiry=Math.min(expiry,rate.expires_at);
 }else{
  exact(intent,['label_id']);const l=labelRow(k,scope,intent.label_id);ctx=fulfillmentContext(k,scope,l.case_id,l.request_id);
  if(l.label.tracking_state!=='label_created'||l.label.void_state!=='not_requested'||l.replaced_by)throw new Error('VOID_UNAVAILABLE');
  details={label_id:l.id,charge_id:l.label.charge_id,label_version:l.source_version,label_digest:l.digest};obligation=l.id;currency=l.label.currency;
 }
 const pin=sourcePin(k,scope,ctx),action=FULFILLMENT_ACTIONS[kind as keyof typeof FULFILLMENT_ACTIONS],control=assertExecution(k,ctx.s,action);
 return {kind,obligation,intent,case_id:ctx.c.id,request_id:ctx.request.id,resource_id:ctx.c.resource_id,pin,details,amount_minor:amount,currency,
  control_stamp:control.stamp,quoted_at:quotedAt,expires_at:Math.min(expiry,pin.proof_expires_at,pin.settings_expires_at),qualification:'synthetic_only',financial_effect:false};
}
export function saveFulfillmentQuote(k:CommerceKernel,scope:Scope,value:Row){const s=k.authorize(scope,'action.propose',value.resource_id),ref='fquote_'+token().slice(0,32),hash=contentDigest(value);
 k.db.prepare('INSERT INTO commerce_fulfillment_quotes VALUES(?,?,?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,ref,value.case_id,value.resource_id,value.kind,value.obligation,canonical(value),hash);
 return {id:ref,digest:hash,quote:value,proposal:{case_id:value.case_id,action:FULFILLMENT_ACTIONS[value.kind as keyof typeof FULFILLMENT_ACTIONS],arguments:{quote_id:ref,quote_digest:hash}},execution_authorized:false};}
export function fulfillmentQuoteRow(k:CommerceKernel,scope:Scope,ref:string){const s=k.require(scope),r=k.db.prepare('SELECT * FROM commerce_fulfillment_quotes WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,id(ref)) as Row,q=checkedBody(r);fulfillmentContext(k,scope,r.case_id,q.request_id,false);return {...r,quote:q};}
export function assertFulfillmentQuote(k:CommerceKernel,scope:Scope,r:Row){const q=r.quote;if(q.expires_at<=k.clock())throw new Error('FULFILLMENT_QUOTE_EXPIRED');
 const b=fulfillmentValue(k,scope,q.kind,q.intent,q.quoted_at,q.details.rate??null);if(contentDigest(b)!==r.digest)throw new Error('FULFILLMENT_QUOTE_CHANGED');return b;}
export function fulfillmentGatewayQuote(k:CommerceKernel,scope:Scope,p:Row,quotedAt:number){const args=exact(p.arguments,['quote_id','quote_digest']),r=fulfillmentQuoteRow(k,scope,args.quote_id),q=assertFulfillmentQuote(k,scope,r);
 if(r.digest!==args.quote_digest||q.case_id!==p.case_id||FULFILLMENT_ACTIONS[q.kind as keyof typeof FULFILLMENT_ACTIONS]!==p.action)throw new Error('FULFILLMENT_QUOTE_CHANGED');
 const pin=q.pin;return {schema_version:1,tenant_id:pin.tenant_id,store_id:pin.store_id,case_id:q.case_id,case_revision:pin.case_revision,configuration_digest:pin.configuration_digest,
  resource_id:q.resource_id,resource_version:pin.source_version,source_digest:pin.source_digest,customer_id:pin.customer_id,action:p.action,arguments:args,amount:money(q.currency,q.amount_minor),amount_ceiling:money(q.currency,q.amount_minor),
  readiness_digest:pin.settings_digest,control_stamp:q.control_stamp,capability_revision:pin.settings_revision,adapter_contract_digest:contentDigest(FULFILLMENT_CONTRACT),policy_digest:pin.policy_digest,
  decision:{eligible:true,reasons:['SYNTHETIC_FULFILLMENT_ONLY']},effect_version:0,quoted_at:quotedAt,expires_at:Math.min(quotedAt+300000,q.expires_at),max_uses:1,financial_effect:false};}
export function recordFulfillmentObservation(k:CommerceKernel,s:Row,op:string,stage:string,body:Row){k.db.prepare('INSERT INTO commerce_fulfillment_observations(tenant_id,store_id,operation_id,stage,body,digest,observed_at) VALUES(?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,op,stage,canonical(body),contentDigest(body),k.clock());}
export function commitFulfillment(k:CommerceKernel,s:Row,preview:Row,receipt:string){const r=k.db.prepare('SELECT * FROM commerce_fulfillment_quotes WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,preview.arguments.quote_id) as Row,q=checkedBody(r);
 if(k.db.prepare('SELECT 1 FROM commerce_fulfillment_operations WHERE tenant_id=? AND store_id=? AND kind=? AND obligation=?').get(s.tenant_id,s.store_id,q.kind,q.obligation))throw new Error('OBLIGATION_ALREADY_AUTHORIZED');
 const ref='fulfill_'+contentDigest([s.tenant_id,s.store_id,q.kind,q.obligation]).slice(0,40),command={operation_id:ref,kind:q.kind,obligation:q.obligation,tenant_id:s.tenant_id,store_id:s.store_id,
  source_identity:q.pin.source_identity,account_id:q.pin.account_id,case_id:q.case_id,resource_id:q.resource_id,request_id:q.request_id,customer_id:q.pin.customer_id,native_return_id:q.pin.native_return_id,
  original_order_id:q.resource_id,native_original_order_id:q.pin.native_original_order_id,settings_digest:q.pin.settings_digest,resolution_trigger:q.pin.resolution_trigger,currency:q.currency,amount_minor:q.amount_minor,...q.details};
 // Address references remain in the erasable quote; this synthetic authority needs only their digest.
 delete command.from_address_ref;delete command.to_address_ref;
 k.db.prepare("INSERT INTO commerce_fulfillment_operations VALUES(?,?,?,?,?,?,?,?,?,'authorized',?,?,NULL)").run(s.tenant_id,s.store_id,ref,q.case_id,q.resource_id,q.kind,q.obligation,r.id,receipt,canonical(command),contentDigest(command));
 recordFulfillmentObservation(k,s,ref,'authorized',{receipt_id:receipt,quote_digest:r.digest,kind:q.kind});return ref;}
