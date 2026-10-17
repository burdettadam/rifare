import { exact,id,integer } from './kernel.mts';
import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { fulfillmentContext,fulfillmentSettings,fulfillmentValue,saveFulfillmentQuote,parcelRow,labelRow,currentLabel,FULFILLMENT_ACTIONS } from './return-fulfillment-core.mts';
import { assertFulfillmentSource } from './replacement-inventory.mts';
import { FulfillmentFixtureSource } from '../adapters/fulfillment-fixture-source.mts';
import { assertExecution } from './execution-stops.mts';
import { attachQualifiedDestinationSource,qualifiedDestinationPin } from './qualified-return-destinations.mts';

export class ReturnLabels {
 readonly kernel:CommerceKernel;readonly source:FulfillmentFixtureSource;
 constructor(k:CommerceKernel,source:FulfillmentFixtureSource){assertFulfillmentSource(k,source);attachQualifiedDestinationSource(k,source);this.kernel=k;this.source=source;}
 configureParcel(scope:Scope,input:unknown){const p=exact(jsonValue(input),['case_id','request_id','expected_revision','from_address_ref','to_address_ref','address_revision','package','service']);
  id(p.case_id);id(p.request_id);integer(p.expected_revision);integer(p.address_revision,1);id(p.from_address_ref);id(p.to_address_ref);id(p.service);
  exact(p.package,['weight_g','length_mm','width_mm','height_mm']);for(const n of Object.values(p.package)){integer(n,1);if((n as number)>100000)throw new Error('PACKAGE_UNSUPPORTED');}
  const k=this.kernel;return k.transaction(()=>{const ctx=fulfillmentContext(k,scope,p.case_id,p.request_id);k.authorize(scope,'action.configure',ctx.c.resource_id);
   const old=k.db.prepare('SELECT * FROM commerce_return_parcels WHERE tenant_id=? AND store_id=? AND request_id=?').get(ctx.s.tenant_id,ctx.s.store_id,p.request_id) as Row;
   if((old?.revision??0)!==p.expected_revision)throw new Error('PARCEL_CHANGED');const b={...p};delete b.expected_revision;
   k.db.prepare('INSERT INTO commerce_return_parcels VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,store_id,request_id) DO UPDATE SET revision=excluded.revision,body=excluded.body,digest=excluded.digest').run(ctx.s.tenant_id,ctx.s.store_id,p.request_id,p.case_id,ctx.c.resource_id,p.expected_revision+1,canonical(b),contentDigest(b));
   return {revision:p.expected_revision+1,digest:contentDigest(b),rates_invalidated:true};});}
 quote(scope:Scope,input:unknown){const p=exact(jsonValue(input),['request_id','replaces']);id(p.request_id);if(p.replaces!==null)id(p.replaces);const k=this.kernel;
  return k.transaction(()=>{const parcel=parcelRow(k,scope,p.request_id),ctx=fulfillmentContext(k,scope,parcel.case_id,parcel.request_id),settings=fulfillmentSettings(k,ctx.s);
   k.authorize(scope,'action.propose',ctx.c.resource_id);assertExecution(k,ctx.s,FULFILLMENT_ACTIONS.label);assertFulfillmentSource(k,this.source,ctx.s);if(settings.source_identity!==this.source.identity)throw new Error('FIXTURE_SOURCE_MISMATCH');
   const route=qualifiedDestinationPin(k,scope,ctx,parcel);
   const rate=this.source.rate({source_identity:this.source.identity,tenant_id:ctx.s.tenant_id,store_id:ctx.s.store_id,account_id:settings.account_id,service:parcel.parcel.service,parcel_digest:parcel.digest,parcel_revision:parcel.revision,
    ...(route?{request_id:ctx.request.id,resource_id:ctx.c.resource_id,native_return_id:ctx.native.native_id,return_destination:route}: {})});
   return saveFulfillmentQuote(k,scope,fulfillmentValue(k,scope,'label',p,k.clock(),rate));});}
 quoteVoid(scope:Scope,input:unknown){const p=exact(jsonValue(input),['label_id']);id(p.label_id);return this.kernel.transaction(()=>saveFulfillmentQuote(this.kernel,scope,fulfillmentValue(this.kernel,scope,'void',p,this.kernel.clock())));}
 inspect(scope:Scope,ref:string){const r=labelRow(this.kernel,scope,ref),s=this.kernel.require(scope),current=currentLabel(this.kernel,s,r.request_id);
  return {id:r.id,request_id:r.request_id,generation:r.generation,is_current:current?.current_label_id===r.id,replaces:r.replaces,replaced_by:r.replaced_by,
   tracking_code:r.label.tracking_code,tracking_state:r.label.tracking_state,void_state:r.label.void_state,valid_until:r.label.valid_until,
   charge_id:r.label.charge_id,amount_minor:r.label.amount_minor,currency:r.label.currency,reimbursement:r.label.reimbursement,
   reimbursement_counted:r.label.reimbursement.state==='refunded',qualification:'synthetic_only',usable:r.label.tracking_state==='label_created'&&['not_requested','rejected'].includes(r.label.void_state)&&r.label.valid_until>this.kernel.clock()};}
}
