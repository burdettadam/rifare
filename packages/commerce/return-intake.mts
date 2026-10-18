import { exact,id,integer,token } from './kernel.mts';
import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { ActionGateway } from './action-gateway.mts';
import { CaseConfigurations } from './case-configurations.mts';
import { returnSettings,returnSelection,sourceReturnLines,INTAKE_ACTION } from './return-eligibility.mts';
import { intakeSettings,intakeEvaluation,quoteRow,quoteView,reservations } from './return-intake-core.mts';
import {assertWooReturnFacts,wooReturnAuthority} from '../adapters/woocommerce/return-contract.mts';

export class ReturnIntake {
 #k:CommerceKernel;readonly gateway:ActionGateway;readonly cases:CaseConfigurations;
 constructor(k:CommerceKernel){this.#k=k;this.gateway=new ActionGateway(k);this.cases=this.gateway.cases;}
 configure(scope:Scope,input:unknown){const p=exact(jsonValue(input),['expected_revision','settings']);integer(p.expected_revision);const settings=returnSettings(p.settings),k=this.#k;
  return k.transaction(()=>{const s=k.authorize(scope,'action.configure'),r=k.db.prepare('SELECT revision FROM commerce_return_settings WHERE tenant_id=? AND store_id=?').get(s.tenant_id,s.store_id) as Row;
   if((r?.revision??0)!==p.expected_revision)throw new Error('RETURN_SETTINGS_CHANGED');
   k.db.prepare('INSERT INTO commerce_return_settings VALUES(?,?,?,?,?) ON CONFLICT(tenant_id,store_id) DO UPDATE SET revision=excluded.revision,body=excluded.body,digest=excluded.digest').run(s.tenant_id,s.store_id,p.expected_revision+1,canonical(settings),contentDigest(settings));
   return {revision:p.expected_revision+1,settings,digest:contentDigest(settings),financial_effect:false};});}
 form(scope:Scope,caseId:string){const c=this.cases.resume(scope,id(caseId)),s=this.#k.authorize(scope,'return.read',c.resource_id);this.cases.verified(scope,c.id);const settings=intakeSettings(this.#k,s),reserved=reservations(this.#k,s,c.order);
  if(c.order.source_system==='woocommerce')assertWooReturnFacts(this.#k,s,c.order);
  return {case_id:c.id,configuration_digest:c.configuration_digest,settings_revision:settings.revision,brand:settings.body.brand,contact:settings.body.contact,time_zone:settings.body.time_zone,
   currency:settings.body.currency,lines:sourceReturnLines(c.order).map((l:Row)=>({id:l.id,remaining:Math.max(0,l.fulfilled-l.returned-(reserved.quantities[l.id]??0)),unit_minor:l.unit_minor})),
   outcomes:c.order.source_system==='woocommerce'?c.pins.policy.body.rules.outcomes.filter((x:string)=>x==='refund'):c.pins.policy.body.rules.outcomes,fees:{shipping_minor:settings.body.shipping_minor,restocking_bps:settings.body.restocking_bps,estimated_only:true},photo_types:['image/png'],evidence_requires_scanner:true,financial_effect:false,
   ...(c.order.source_system==='woocommerce'?{return_semantics:'composed_local_rma',native_return_available:false}: {})};}
 evaluate(scope:Scope,input:unknown){const p=returnSelection(input),k=this.#k;return k.transaction(()=>{
  const c=this.cases.inspect(scope,p.case_id),s=k.authorize(scope,'return.request',c.resource_id),at=k.clock(),body={...intakeEvaluation(k,scope,p,at),evaluated_at:at};
  const ref='rq_'+token().slice(0,32),hash=contentDigest(body),expires=at+300000;
  k.db.prepare('INSERT INTO commerce_return_quotes VALUES(?,?,?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,ref,c.id,c.resource_id,s.actor_id,canonical(body),hash,expires);
  return quoteView(k,scope,ref);
 });}
 prepare(scope:Scope,input:unknown){const p=exact(jsonValue(input),['quote_id','quote_digest','request_key','override_id']);id(p.request_key);if(p.override_id!==null)id(p.override_id);const k=this.#k;
  return k.transaction(()=>{const q=quoteRow(k,scope,p.quote_id),s=k.authorize(scope,'return.request',q.resource_id);if(q.digest!==p.quote_digest)throw new Error('RETURN_QUOTE_CHANGED');
   const old=k.db.prepare('SELECT * FROM commerce_return_requests WHERE tenant_id=? AND store_id=? AND (case_id=? OR request_key=?)').get(s.tenant_id,s.store_id,q.case_id,p.request_key) as Row;
   if(old){if(old.case_id!==q.case_id||old.quote_id!==q.id)throw new Error('RETURN_REQUEST_CONFLICT');return {...this.read(scope,old.case_id),duplicate:true};}
   const preview=this.gateway.prepare(scope,{case_id:q.case_id,action:INTAKE_ACTION,arguments:{quote_id:q.id,quote_digest:q.digest,override_id:p.override_id}});
   const ref='ret_'+token().slice(0,32),request={selection:q.quote.selection,quote_digest:q.digest,fees:q.quote.decision.fees,configuration_digest:q.quote.configuration_digest,override_id:p.override_id};
   k.db.prepare("INSERT INTO commerce_return_requests VALUES(?,?,?,?,?,?,?,?,?,'awaiting_review',?,?,NULL,?)").run(s.tenant_id,s.store_id,ref,q.case_id,q.resource_id,s.actor_id,p.request_key,q.id,preview.id,canonical(request),contentDigest(request),k.clock());
   return {...this.read(scope,q.case_id),duplicate:false};});}
 revise(scope:Scope,input:unknown){const p=exact(jsonValue(input),['quote_id','quote_digest','expected_preview_id','override_id']);id(p.expected_preview_id);if(p.override_id!==null)id(p.override_id);const k=this.#k;
  return k.transaction(()=>{const q=quoteRow(k,scope,p.quote_id),s=k.authorize(scope,'return.request',q.resource_id);
   if(q.digest!==p.quote_digest)throw new Error('RETURN_QUOTE_CHANGED');const old=k.db.prepare('SELECT * FROM commerce_return_requests WHERE tenant_id=? AND store_id=? AND case_id=?').get(s.tenant_id,s.store_id,q.case_id) as Row;
   if(!old||old.state!=='awaiting_review')throw new Error('RETURN_REQUEST_CONFLICT');
   if(old.preview_id!==p.expected_preview_id){if(old.quote_id===q.id)return {...this.read(scope,q.case_id),duplicate:true};throw new Error('RETURN_REQUEST_CONFLICT');}
   const preview=this.gateway.prepare(scope,{case_id:q.case_id,action:INTAKE_ACTION,arguments:{quote_id:q.id,quote_digest:q.digest,override_id:p.override_id}});
   const value={selection:q.quote.selection,quote_digest:q.digest,fees:q.quote.decision.fees,configuration_digest:q.quote.configuration_digest,override_id:p.override_id};
   k.db.prepare('UPDATE commerce_action_approvals SET revoked=1 WHERE tenant_id=? AND store_id=? AND preview_id=?').run(s.tenant_id,s.store_id,old.preview_id);
   k.db.prepare('UPDATE commerce_return_requests SET quote_id=?,preview_id=?,body=?,digest=? WHERE tenant_id=? AND store_id=? AND id=?').run(q.id,preview.id,canonical(value),contentDigest(value),s.tenant_id,s.store_id,old.id);
   return {...this.read(scope,q.case_id),duplicate:false};});}
 read(scope:Scope,caseId:string){const c=this.cases.inspect(scope,id(caseId)),k=this.#k,s=k.authorize(scope,'return.read',c.resource_id),r=k.db.prepare('SELECT * FROM commerce_return_requests WHERE tenant_id=? AND store_id=? AND case_id=?').get(s.tenant_id,s.store_id,c.id) as Row;
  const timeline=k.db.prepare('SELECT event,reason,observed_at FROM commerce_return_review_events WHERE tenant_id=? AND store_id=? AND case_id=? ORDER BY seq LIMIT 100').all(s.tenant_id,s.store_id,c.id);
  if(!r)return {case_id:c.id,state:'not_submitted',timeline,financial_effect:false};
  const body=JSON.parse(r.body);if(contentDigest(body)!==r.digest)throw new Error('RETURN_REQUEST_INTEGRITY');const p=k.db.prepare('SELECT * FROM commerce_action_previews WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,r.preview_id) as Row;
  if(!p||contentDigest(JSON.parse(p.body))!==p.digest)throw new Error('PREVIEW_INTEGRITY');
  return {id:r.id,case_id:c.id,state:r.state,quote_id:r.quote_id,preview_id:p.id,preview_digest:p.digest,preview:JSON.parse(p.body),request:body,receipt_id:r.receipt_id,timeline,financial_effect:false,execution_authorized:false,
   ...(c.order.source_system==='woocommerce'?{return_semantics:'composed_local_rma',native_return_id:null,return_authority:r.state==='submitted'?wooReturnAuthority(k,s,r.id):null}: {})};}
}
