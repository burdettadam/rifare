import { exact,id,integer } from './kernel.mts';
import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { permissionDecision } from './authorization.mts';
import { CaseConfigurations } from './case-configurations.mts';
import { growthCustomer,growthText } from './growth-shopping-core.mts';
import { assertNotErased,assertRecoveryEgress,subjectHash } from './data-guards.mts';
import { PartnerReadiness } from './partner-readiness.mts';
import { InstantExchanges } from './instant-exchanges.mts';
import { minor } from './resolution-ledger.mts';
import { DeliveryTrialFacts,deliveryTrialBinding,deliveryTrialClock,deliveryTrialBalance } from '../adapters/delivery-trial-source-guards.mts';
import type { InstantExchangeFixtureSource } from '../adapters/instant-exchange-fixture-source.mts';
import type { WarehouseFixtureSource } from '../adapters/warehouse-fixture-source.mts';
import { installTrialSource,trialBody,trialRow,currentTrialTerms } from './delivery-trial-core.mts';

export const DELIVERY_TRIAL_CONTRACT=Object.freeze({id:'rifare-delivery-trials-fixture-v1',version:'1.0.0',qualification:'synthetic_local_only',live_transport:false});
export class DeliveryTrials {
 readonly kernel:CommerceKernel;readonly source:InstantExchangeFixtureSource;readonly facts:DeliveryTrialFacts;readonly instant:InstantExchanges;
 constructor(k:CommerceKernel,source:InstantExchangeFixtureSource,warehouse?:WarehouseFixtureSource){this.kernel=k;this.source=source;this.instant=new InstantExchanges(k,source);this.facts=new DeliveryTrialFacts(source);if(warehouse)this.facts.bindWarehouse(warehouse);installTrialSource(k,source,this.facts);}
 terms(scope:Scope,input:unknown){
  const p=exact(jsonValue(input),['terms_id','expected_version','account_id','region','notice','currency','maximum_minor','trial_ms','delivery_window_ms','return_grace_ms','maximum_extension_ms','expires_at']);
  for(const key of ['terms_id','account_id','region'])id(p[key]);integer(p.expected_version);for(const key of ['trial_ms','delivery_window_ms','return_grace_ms','maximum_extension_ms','expires_at'])integer(p[key]);growthText(p.notice,2000);minor(p.maximum_minor);
  const k=this.kernel;return k.transaction(()=>{const s=k.authorize(scope,'action.configure');assertRecoveryEgress(k);if(s.tenant_id!==this.source.tenant||s.store_id!==this.source.store)throw new Error('INSTANT_TRIAL_SOURCE_CHANGED');
   const config=this.facts.configuration(p.account_id);if(p.currency!=='USD'||p.maximum_minor==='0'||p.trial_ms<1||p.trial_ms>3600000||p.maximum_extension_ms>3600000||p.expires_at<=k.clock()||p.expires_at>Math.min(config.account.expires_at,config.window.expires_at)||p.delivery_window_ms+p.trial_ms+p.return_grace_ms>config.window.authorization_duration_ms)throw new Error('INSTANT_TRIAL_AUTHORIZATION_TOO_SHORT');
   const previous=k.db.prepare('SELECT max(version) version FROM commerce_trial_terms WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,p.terms_id) as Row;if((previous.version??0)!==p.expected_version)throw new Error('INSTANT_TRIAL_TERMS_CHANGED');
   const {expected_version,...definition}=p,body={...definition,version:p.expected_version+1,nonreturn_rule:'retained_trial_goods_v1',clock_rule:'delivery_correction_never_shortens_v1',source_identity:this.source.identity,source_config_digest:config.digest,qualification:'synthetic_local_only',external_qualified:false},hash=contentDigest(body);
   k.db.prepare('INSERT INTO commerce_trial_terms VALUES(?,?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,p.terms_id,body.version,s.actor_id,permissionDecision(k.db,s,'action.configure').authority_revision,canonical(body),hash);
   return {id:p.terms_id,version:body.version,body,digest:hash,approved:false};});
 }
 approveTerms(scope:Scope,input:unknown){const p=exact(jsonValue(input),['terms_id','version','terms_digest','approval_id','expires_at']);id(p.terms_id);id(p.approval_id);integer(p.version,1);integer(p.expires_at);const k=this.kernel;
  return k.transaction(()=>{const s=k.authorize(scope,'action.approve'),row=k.db.prepare('SELECT * FROM commerce_trial_terms WHERE tenant_id=? AND store_id=? AND id=? AND version=?').get(s.tenant_id,s.store_id,p.terms_id,p.version) as Row,body=trialBody(row);
   if(row.author===s.actor_id)throw new Error('INDEPENDENT_REVIEW_REQUIRED');if(row.digest!==p.terms_digest||p.expires_at<=k.clock()||p.expires_at>body.expires_at)throw new Error('INSTANT_TRIAL_TERMS_CHANGED');
   const author=k.db.prepare('SELECT * FROM commerce_members WHERE tenant_id=? AND store_id=? AND actor_id=? AND active=1').get(s.tenant_id,s.store_id,row.author) as Row,authority=author&&permissionDecision(k.db,author,'action.configure');if(!authority?.allowed||authority.authority_revision!==row.authority_revision)throw new Error('INSTANT_TRIAL_TERMS_AUTHORITY_CHANGED');
   new PartnerReadiness(k).assertReady(scope,{service:'trial_payments',account_id:body.account_id,source_identity:this.source.identity,source_config_digest:this.facts.configuration(body.account_id).digest,region:body.region,capability:'authorization'});
   const sourceTerms=this.facts.publishTerms({...body,merchant_approved:true,merchant_approval_ref:p.approval_id});
   const approved={terms_id:p.terms_id,version:p.version,terms_digest:row.digest,source_terms_digest:sourceTerms.digest,source_identity:this.source.identity,qualification:'synthetic_local_only'};
   k.db.prepare('INSERT INTO commerce_trial_term_approvals(tenant_id,store_id,id,terms_id,version,approver,authority_revision,expires_at,revoked,body,digest) VALUES(?,?,?,?,?,?,?,?,0,?,?)').run(s.tenant_id,s.store_id,p.approval_id,p.terms_id,p.version,s.actor_id,permissionDecision(k.db,s,'action.approve').authority_revision,p.expires_at,canonical(approved),contentDigest(approved));
   return {id:p.approval_id,digest:contentDigest(approved),source_terms_digest:sourceTerms.digest,expires_at:p.expires_at};});
 }
 create(scope:Scope,input:unknown){const p=exact(jsonValue(input),['trial_id','case_id','terms_id','terms_digest']);for(const key of ['trial_id','case_id','terms_id'])id(p[key]);const k=this.kernel;
  return k.transaction(()=>{const c=new CaseConfigurations(k).inspect(scope,p.case_id),s=k.authorize(scope,'action.propose',c.resource_id);new CaseConfigurations(k).verified(scope,c.id);assertNotErased(k,s,c.resource_id,c.customer_id);assertRecoveryEgress(k);
   if(k.db.prepare('SELECT 1 FROM commerce_delivery_trials WHERE tenant_id=? AND store_id=? AND (id=? OR resource_id=?)').get(s.tenant_id,s.store_id,p.trial_id,c.resource_id))throw new Error('INSTANT_TRIAL_ORIGINAL_OBLIGATION_REQUIRED');
   const terms=currentTrialTerms(k,s,p.terms_id),native=this.facts.order(c.resource_id);if(terms.row.digest!==p.terms_digest||native.customer_id!==c.customer_id||native.native_original_order_id!==c.order.payload.native_order_id||native.currency!==c.order.payload.currency||native.original_obligation_minor!==String(c.order.payload.total_minor))throw new Error('INSTANT_TRIAL_ORDER_CHANGED');
   const configuration=this.facts.configuration(terms.body.account_id);if(configuration.digest!==terms.body.source_config_digest)throw new Error('INSTANT_TRIAL_CONFIGURATION_CHANGED');
   new PartnerReadiness(k).assertReady(scope,{service:'trial_payments',account_id:terms.body.account_id,source_identity:this.source.identity,source_config_digest:configuration.digest,region:terms.body.region,capability:'authorization'});
   const allocation='trial_value_'+contentDigest([s.tenant_id,s.store_id,p.trial_id,c.resource_id]).slice(0,40),obligation='trial_obligation_'+contentDigest([s.tenant_id,s.store_id,c.resource_id]).slice(0,40);
   const binding=deliveryTrialBinding({workflow:'delivery_trial',trial_id:p.trial_id,obligation_id:obligation,allocation_id:allocation,case_id:c.id,resource_id:c.resource_id,customer_id:c.customer_id,native_original_order_id:native.native_original_order_id,currency:native.currency,units:native.units,original_obligation_minor:native.original_obligation_minor,quantity:native.units.length,order_digest:native.digest,created_at:k.clock()});
   const body={trial_id:p.trial_id,binding,terms_id:p.terms_id,terms_version:terms.row.version,terms_digest:terms.row.digest,native_terms_digest:terms.approved.source_terms_digest,account_id:terms.body.account_id,region:terms.body.region,maximum_minor:(minor(native.original_obligation_minor)<minor(terms.body.maximum_minor)?native.original_obligation_minor:terms.body.maximum_minor),created_at:k.clock(),qualification:'synthetic_local_only',external_qualified:false};
   k.db.prepare("INSERT INTO commerce_delivery_trials VALUES(?,?,?,?,?,?,?,1,'active',?,?)").run(s.tenant_id,s.store_id,p.trial_id,c.id,c.resource_id,c.customer_id,subjectHash(s.tenant_id,s.store_id,c.customer_id),canonical(body),contentDigest(body));return {id:p.trial_id,body,digest:contentDigest(body)};});
 }
 consent(scope:Scope,input:unknown){const p=exact(jsonValue(input),['trial_id','consent_id','terms_digest','maximum_minor','confirmed','extension_ms','reauthorization_of']);id(p.trial_id);id(p.consent_id);minor(p.maximum_minor);integer(p.extension_ms);if(p.reauthorization_of!==null)id(p.reauthorization_of);if(p.confirmed!==true)throw new Error('INSTANT_TRIAL_EXPLICIT_CONSENT_REQUIRED');const k=this.kernel;
  return k.transaction(()=>{const ctx=trialRow(k,scope,p.trial_id),{row,body}=ctx,s=growthCustomer(k,scope,row.resource_id,row.customer_id);assertRecoveryEgress(k);if(row.state!=='active'||body.erased)throw new Error('INSTANT_TRIAL_DISABLED');
   const terms=currentTrialTerms(k,s,body.terms_id,body.terms_version);if(p.terms_digest!==body.terms_digest||p.maximum_minor==='0'||minor(p.maximum_minor)>minor(body.maximum_minor))throw new Error('INSTANT_TRIAL_CONSENT_CHANGED');
   const configuration=this.facts.configuration(body.account_id),window=configuration.window;
   new PartnerReadiness(k).assertReady(scope,{service:'trial_payments',account_id:body.account_id,source_identity:this.source.identity,source_config_digest:configuration.digest,region:body.region,capability:p.reauthorization_of===null?'authorization':'reauthorization'});
   if(p.extension_ms>terms.body.maximum_extension_ms)throw new Error('INSTANT_TRIAL_EXTENSION_UNAPPROVED');
   const existing=this.source.db.prepare('SELECT body,digest FROM fixture_instant_obligations WHERE id=?').get(body.binding.obligation_id) as Row,obligation=existing?trialBody(existing):null;
   if(p.reauthorization_of===null&&obligation||p.reauthorization_of!==null&&(!obligation||p.reauthorization_of!==body.binding.obligation_id))throw new Error('INSTANT_TRIAL_FRESH_CONSENT_REQUIRED');
   const extension=(obligation?.trial_extension_ms??0)+p.extension_ms;if(extension>terms.body.maximum_extension_ms)throw new Error('INSTANT_TRIAL_EXTENSION_UNAPPROVED');
   const clock=deliveryTrialClock(this.source,body.binding,terms.body,extension),expires=k.clock()+window.authorization_duration_ms;
   if(clock.capture_after!==null&&clock.capture_after>=expires)throw new Error('INSTANT_TRIAL_REAUTHORIZATION_REQUIRED');
   const native={id:p.consent_id,account_id:body.account_id,terms_id:body.terms_id,terms_digest:body.native_terms_digest,binding:body.binding,maximum_minor:p.maximum_minor,trial_deadline_at:p.reauthorization_of===null?null:clock.ends_at,mandate_expires_at:expires,confirmed_at:k.clock(),consent_expires_at:expires,proof_ref:p.consent_id,reauthorization_of:p.reauthorization_of,extension_ms:extension,window_digest:window.digest,authorization_duration_ms:window.authorization_duration_ms};
   const result=this.source.grantConsent(native),consent={id:p.consent_id,trial_id:p.trial_id,terms_digest:body.terms_digest,maximum_minor:p.maximum_minor,currency:body.binding.currency,confirmed_at:k.clock(),authorization_expires_at:expires,session_hash:s.token_hash,native_digest:result.digest,native_consent_id:result.id,extension_ms:extension,reauthorization_of:p.reauthorization_of,qualification:'synthetic_local_only'};
   k.db.prepare('INSERT INTO commerce_trial_consents(tenant_id,store_id,id,trial_id,resource_id,customer_id,subject_hash,revoked,body,digest) VALUES(?,?,?,?,?,?,?,0,?,?)').run(s.tenant_id,s.store_id,p.consent_id,p.trial_id,row.resource_id,row.customer_id,subjectHash(s.tenant_id,s.store_id,row.customer_id),canonical(consent),contentDigest(consent));
   // A fresh authentic customer confirmation refreshes this same case's proof;
   // neither an operator nor an adapter can substitute their own session.
   k.db.prepare('UPDATE commerce_cases SET verification_hash=? WHERE tenant_id=? AND store_id=? AND id=?').run(s.token_hash,s.tenant_id,s.store_id,row.case_id);
   return {id:p.consent_id,digest:contentDigest(consent),maximum_minor:p.maximum_minor,authorization_expires_at:expires,execution_authorized:false};});
 }
 withdraw(scope:Scope,consentId:string){const k=this.kernel,s=k.require(scope),record=k.db.prepare('SELECT * FROM commerce_trial_consents WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,id(consentId)) as Row;trialBody(record);growthCustomer(k,scope,record.resource_id,record.customer_id);k.db.prepare('UPDATE commerce_trial_consents SET revoked=1 WHERE tenant_id=? AND store_id=? AND id=?').run(s.tenant_id,s.store_id,consentId);this.source.revokeConsent(consentId);return {revoked:true,completed_captures_reversed:false};}
 #event(s:Row,row:Row,eventId:string,kind:string,body:Row){const k=this.kernel,old=k.db.prepare('SELECT * FROM commerce_trial_events WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,eventId) as Row;
  if(old){if(old.trial_id!==row.id||old.kind!==kind||old.digest!==contentDigest(body))throw new Error('INSTANT_TRIAL_EVENT_CONFLICT');return;}
  k.db.prepare('INSERT INTO commerce_trial_events VALUES(?,?,?,?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,eventId,row.id,row.resource_id,row.customer_id,subjectHash(s.tenant_id,s.store_id,row.customer_id),kind,canonical(body),contentDigest(body));
 }
 observeDelivery(scope:Scope,input:unknown){const p=exact(jsonValue(input),['trial_id','event_id']),k=this.kernel;return k.transaction(()=>{const {s,row,body}=trialRow(k,scope,p.trial_id);k.authorize(scope,'resource.ingest',row.resource_id);assertNotErased(k,s,row.resource_id,row.customer_id);const event=this.facts.deliveryEvent(p.event_id);
  if(event.trial_id!==row.id||event.resource_id!==row.resource_id||event.native_original_order_id!==body.binding.native_original_order_id||event.source_identity!==this.source.identity)throw new Error('INSTANT_TRIAL_DELIVERY_BINDING');
  this.#event(s,row,event.event_id,'delivery',{trial_id:row.id,source_identity:this.source.identity,source_event_id:event.event_id,source_event_digest:event.digest,observed_at:event.observed_at,sequence:event.sequence,correction_of:event.correction_of});return this.read(scope,row.id);});
 }
 linkReturn(scope:Scope,input:unknown){const p=exact(jsonValue(input),['trial_id','request_id','warehouse_source_identity']),k=this.kernel;return k.transaction(()=>{const {s,row,body}=trialRow(k,scope,p.trial_id);k.authorize(scope,'warehouse.receive',row.resource_id);assertNotErased(k,s,row.resource_id,row.customer_id);
  const request=k.db.prepare('SELECT * FROM commerce_return_requests WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,id(p.request_id)) as Row,requestBody=trialBody(request),native=k.db.prepare("SELECT * FROM commerce_native_return_operations WHERE tenant_id=? AND store_id=? AND request_id=? AND state='created'").get(s.tenant_id,s.store_id,p.request_id) as Row;
  if(request.resource_id!==row.resource_id||!native||contentDigest(JSON.parse(native.native_body))!==native.native_digest||!['OPEN','CLOSED'].includes(JSON.parse(native.native_body).status))throw new Error('INSTANT_TRIAL_NATIVE_RETURN_REQUIRED');
  const expected:Row[]=[];for(const line of requestBody.selection.lines){const units=body.binding.units.filter((unit:Row)=>unit.line_id===line.line_id).sort((a:Row,b:Row)=>a.unit_index-b.unit_index);
   if(line.quantity>units.length||line.quantity<1||new Set(units.map((unit:Row)=>unit.obligation_minor)).size>1&&line.quantity<units.length)throw new Error('INSTANT_TRIAL_RECEIPT_UNITS_AMBIGUOUS');expected.push(...units.slice(0,line.quantity).map((unit:Row)=>({line_id:unit.line_id,unit_index:unit.unit_index})));}
  const link=this.facts.linkReturn({trial_id:row.id,request_id:request.id,native_return_id:native.native_id,resource_id:row.resource_id,source_identity:p.warehouse_source_identity,expected_units:expected});
  this.#event(s,row,'trial_return_'+contentDigest([row.id,request.id]).slice(0,40),'return',{trial_id:row.id,request_id:request.id,source_identity:p.warehouse_source_identity,native_return_id:native.native_id,source_event_digest:contentDigest(link),observed_at:k.clock()});return {linked:true,request_id:request.id,native_return_id:native.native_id,stock_changed:false};});
 }
 read(scope:Scope,trialId:string){const k=this.kernel,{s,row,body}=trialRow(k,scope,trialId),termsRow=k.db.prepare('SELECT * FROM commerce_trial_terms WHERE tenant_id=? AND store_id=? AND id=? AND version=?').get(s.tenant_id,s.store_id,body.terms_id,body.terms_version) as Row,terms=trialBody(termsRow);
  const nativeRow=this.source.db.prepare('SELECT body,digest FROM fixture_instant_obligations WHERE id=?').get(body.binding.obligation_id) as Row,obligation=nativeRow?trialBody(nativeRow):null;
  const clock=deliveryTrialClock(this.source,body.binding,terms,obligation?.trial_extension_ms??0),balance=deliveryTrialBalance(this.source,body.binding),operations=k.db.prepare('SELECT id,kind,state,native_id,generation FROM commerce_instant_operations WHERE tenant_id=? AND store_id=? AND obligation_id=? ORDER BY observed_at,id').all(s.tenant_id,s.store_id,body.binding.obligation_id) as Row[];
  const authorization=obligation?{expires_at:obligation.expires_at,maximum_minor:obligation.maximum_minor,mandate_id:obligation.mandate_id,revision:obligation.mandate_revision,operation_id:operations.find(operation=>['authorize','reauthorize'].includes(operation.kind)&&operation.generation===obligation.mandate_revision)?.id??null,state:obligation.state}:null;
  return {id:row.id,state:row.state,binding:body.binding,clock,authorization,maximum_minor:body.maximum_minor,currency:body.binding.currency,remaining_minor:balance.remaining.toString(),receipt_certain:balance.certain,operations,qualification:'synthetic_local_only',external_qualified:false,stock_changed:false};
 }
}
