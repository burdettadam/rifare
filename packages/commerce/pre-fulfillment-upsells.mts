import { exact,id } from './kernel.mts';
import type { Scope,Row } from './kernel.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { OrderEdits } from './order-edit-execution.mts';
import { editBody,editContext,EDIT_ACTION } from './order-edit-core.mts';
import { growthBody,growthCustomer } from './growth-shopping-core.mts';
import { assertExecution } from './execution-stops.mts';
import { assertRecoveryEgress } from './data-guards.mts';
import { assertUpsellConfirmation } from './upsell-guards.mts';
import { confirmUpsellSource,upsellTerms } from '../adapters/upsell-source-guards.mts';

/** Additions use the original OrderEdits executor, invoice and warehouse fulfillment. */
export class PreFulfillmentUpsells {
 readonly edits:OrderEdits;readonly kernel;
 constructor(edits:OrderEdits){this.edits=edits;this.kernel=edits.kernel;}
 #source(s:Row){const source=this.edits.source;if(!source||source.tenant!==s.tenant_id||source.store!==s.store_id)throw new Error('UPSELL_SOURCE_UNAVAILABLE');return source;}
 #row(scope:Scope,offerId:string){const k=this.kernel,s=k.require(scope),row=k.db.prepare('SELECT * FROM commerce_upsell_offers WHERE tenant_id=? AND store_id=? AND offer_id=?').get(s.tenant_id,s.store_id,id(offerId)) as Row,b=growthBody(row),{c}=editContext(k,scope,row.case_id),qrow=k.db.prepare('SELECT * FROM commerce_edit_quotes WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,row.quote_id) as Row,q=editBody(qrow);k.authorize(scope,'resource.read',row.resource_id);
  if(b.offer_id!==row.offer_id||b.quote_id!==row.quote_id||b.quote_digest!==qrow.digest||q.resource_id!==row.resource_id||c.resource_id!==row.resource_id||q.customer_id!==row.customer_id)throw new Error('UPSELL_INTEGRITY');return {s,row,b,q,qrow};
 }
 offer(scope:Scope,input:unknown){const p=exact(jsonValue(input),['offer_id','case_id','variant_id','quantity','warehouse_id']);id(p.offer_id);const k=this.kernel,s=k.require(scope),old=k.db.prepare('SELECT * FROM commerce_upsell_offers WHERE tenant_id=? AND store_id=? AND offer_id=?').get(s.tenant_id,s.store_id,p.offer_id) as Row|undefined;
  if(old){if(growthBody(old).input_digest!==contentDigest(p))throw new Error('UPSELL_OFFER_CONFLICT');return this.status(scope,p.offer_id);}
  this.edits.refresh(scope,p.case_id);return k.transaction(()=>{const quote=this.edits.quote(scope,{case_id:p.case_id,kind:'add',line_id:null,variant_id:p.variant_id,address:null,quantity:p.quantity,warehouse_id:p.warehouse_id}),q=quote.quote,source=this.#source(s),terms=upsellTerms(source,p.variant_id),body={offer_id:p.offer_id,quote_id:quote.id,quote_digest:quote.digest,input_digest:contentDigest(p),variant_id:p.variant_id,terms:terms.terms,terms_digest:terms.digest,created_at:k.clock(),qualification:'synthetic_only'};
   k.db.prepare('INSERT INTO commerce_upsell_offers VALUES(?,?,?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,p.offer_id,q.case_id,q.resource_id,q.customer_id,quote.id,canonical(body),contentDigest(body));return this.status(scope,p.offer_id);});
 }
 confirm(scope:Scope,input:unknown){const p=exact(jsonValue(input),['offer_id','quote_digest']),k=this.kernel,{s,row,b,q,qrow}=this.#row(scope,p.offer_id);growthCustomer(k,scope,row.resource_id,row.customer_id);if(p.quote_digest!==qrow.digest)throw new Error('UPSELL_PREVIEW_CHANGED');assertRecoveryEgress(k);assertExecution(k,s,EDIT_ACTION,q.control_stamp);const source=this.#source(s);
  const value=k.transaction(()=>{const old=k.db.prepare('SELECT * FROM commerce_upsell_confirmations WHERE tenant_id=? AND store_id=? AND quote_id=?').get(s.tenant_id,s.store_id,row.quote_id) as Row|undefined;
   if(old){
      // Repeated customer acceptance only returns the original confirmation.
      const prior=growthBody(old);if(old.revoked||old.session_hash!==s.token_hash||prior.quote_digest!==qrow.digest)throw new Error('UPSELL_CONFIRMATION_CHANGED');return prior;
   }
   if(q.expires_at<=k.clock()||source.identity!==q.source_identity||source.revision()!==q.source_revision||contentDigest(source.snapshot(row.resource_id))!==q.snapshot_digest||upsellTerms(source,b.variant_id).digest!==b.terms_digest)throw new Error('UPSELL_PREVIEW_CHANGED');
   const consent={offer_id:row.offer_id,quote_id:row.quote_id,quote_digest:qrow.digest,edit_id:'edit_'+contentDigest([s.tenant_id,s.store_id,row.resource_id,q.source_order_version,qrow.digest]).slice(0,40),case_id:row.case_id,resource_id:row.resource_id,customer_id:row.customer_id,source_identity:q.source_identity,source_order_version:q.source_order_version,source_order_digest:q.source_order_digest,intent_digest:q.intent_digest,configuration_digest:q.configuration_digest,new_total_minor:q.new_total_minor,delta_minor:q.delta_minor,currency:q.currency,line_ids:q.line_ids,variant_id:b.variant_id,terms_digest:b.terms_digest,confirmed_at:k.clock(),expires_at:Math.min(q.expires_at,s.expires_at),meaning:'explicit_customer_acceptance_of_original_order_addition_not_staff_approval',qualification:'synthetic_only'};
   k.db.prepare('INSERT INTO commerce_upsell_confirmations VALUES(?,?,?,?,?,?,0,?,?)').run(s.tenant_id,s.store_id,row.quote_id,row.resource_id,row.customer_id,s.token_hash,canonical(consent),contentDigest(consent));assertUpsellConfirmation(k,s,row.quote_id,q);return consent;
  });const native=confirmUpsellSource(source,k,scope,row.quote_id);return {offer_id:row.offer_id,quote_id:row.quote_id,quote_digest:qrow.digest,edit_id:value.edit_id,confirmed:true,confirmation_digest:native.digest,separate_staff_approval_required:true,qualification:'synthetic_only',connected_qualified:false};
 }
 status(scope:Scope,offerId:string){const {s,row,b,q}=this.#row(scope,offerId),confirmation=this.kernel.db.prepare('SELECT * FROM commerce_upsell_confirmations WHERE tenant_id=? AND store_id=? AND quote_id=?').get(s.tenant_id,s.store_id,row.quote_id) as Row|undefined,c=confirmation?growthBody(confirmation):null;
  return {offer_id:row.offer_id,case_id:row.case_id,resource_id:row.resource_id,quote_id:row.quote_id,quote_digest:b.quote_digest,quote:q,terms:b.terms,terms_digest:b.terms_digest,confirmed:!!c&&!confirmation!.revoked,edit_id:c?.edit_id??null,qualification:'synthetic_only',connected_qualified:false};
 }
}
