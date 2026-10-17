import type {CommerceKernel,Scope,Row} from './kernel.mts';
import {id,integer,exact} from './kernel.mts';
import {canonical,contentDigest,jsonValue} from './configuration-values.mts';
import {supportCase,assertSupportOwner,checkedDocument,documentRow,supportEvent} from './support-core.mts';
import {SupportConversations} from './support-conversations.mts';
import {SupportConsent} from './support-consent.mts';
import {SupportTracking} from './support-tracking.mts';
import {queueOperation,operationRow,transitionOperation,BusinessOperations} from './operation-store.mts';
import {DurableWork,retryDelay,MAX_OPERATION_ATTEMPTS} from './durable-work.mts';
import {assertExecution,assertOperationExecution} from './execution-stops.mts';
import {assertRecoveryEgress} from './data-guards.mts';
import type {SupportSource} from '../adapters/support-fixture-source.mts';

export const SUPPORT_TEMPLATES=Object.freeze({tracking_status_v1:{purpose:'transactional'},support_status_v1:{purpose:'transactional'},marketing_test_v1:{purpose:'marketing'}});
export class SupportDelivery {
 readonly k:CommerceKernel;readonly consent:SupportConsent;readonly tracking:SupportTracking;readonly sources:ReadonlyMap<string,SupportSource>;
 constructor(k:CommerceKernel,tracking:SupportTracking,sources:SupportSource[]=[]){this.k=k;this.tracking=tracking;this.consent=new SupportConsent(k);const map=new Map<string,SupportSource>();for(const source of sources){if(map.has(source.identity))throw new Error('SOURCE_IDENTITY_CONFLICT');map.set(source.identity,source);}this.sources=map;}
 #source(s:Row,row:Row) {const source=this.sources.get(row.source_identity);if(!source||source.tenant!==s.tenant_id||source.store!==s.store_id||source.account!==row.account_id||source.contract!==row.source_contract)throw new Error('SUPPORT_SOURCE_UNAVAILABLE');return source;}
 #row(scope:Scope,opId:string,action='support.read') {const k=this.k,s=k.require(scope);id(opId);const row=k.db.prepare('SELECT * FROM commerce_support_deliveries WHERE tenant_id=? AND store_id=? AND operation_id=?').get(s.tenant_id,s.store_id,opId) as Row;
  if(!row||row.erased)throw new Error('NOT_FOUND');supportCase(k,scope,row.case_id,action);if(contentDigest(JSON.parse(row.body))!==row.digest)throw new Error('SUPPORT_DELIVERY_INTEGRITY');return {s,row,payload:JSON.parse(row.body),op:operationRow(k,s,opId)};}
 queue(scope:Scope,input:unknown){const p=exact(jsonValue(input),['case_id','link_id','sender_id','template_id','event_id','expected_generation']);id(p.event_id);id(p.sender_id);integer(p.expected_generation,1);
  if(!Object.hasOwn(SUPPORT_TEMPLATES,p.template_id))throw new Error('TEMPLATE_UNSUPPORTED');
  return this.k.transaction(()=>{const {s,c,owner}=assertSupportOwner(this.k,scope,p.case_id,p.expected_generation);this.k.authorize(scope,'support.send',c.resource_id);assertExecution(this.k,s,'customer.message');
   const link=new SupportConversations(this.k).linkRecord(scope,p.link_id);if(link.case_id!==c.id||link.channel!=='email')throw new Error('SUPPORT_CHANNEL_MISMATCH');
   const sender=checkedDocument(this.k,s,'sender',p.sender_id);this.#source(s,sender.body);
   const intentId='notify_'+contentDigest([s.tenant_id,s.store_id,c.id,p.link_id,p.sender_id,p.template_id,p.event_id]).slice(0,40);
   const existing=this.k.db.prepare("SELECT id FROM commerce_operations WHERE tenant_id=? AND store_id=? AND source_kind='event' AND source_id=?").get(s.tenant_id,s.store_id,intentId) as Row;
   if(existing)return this.inspect(scope,existing.id);
   const contact=this.k.db.prepare('SELECT * FROM commerce_support_contacts WHERE tenant_id=? AND store_id=? AND link_id=? AND erased=0').get(s.tenant_id,s.store_id,link.id) as Row;
   if(!contact||!contact.address||contentDigest(contact.address)!==contact.address_digest)throw new Error('CONTACT_VERIFICATION_REQUIRED');
   const view=this.tracking.read(scope,c.id);if(view.status!=='available')throw new Error('TRACKING_UNAVAILABLE');
   const text=p.template_id==='marketing_test_v1'?'Synthetic marketing test. No live campaign is configured.':view.shipments.map((r:any)=>`Package ${r.id}: ${r.status}. Source observed ${r.source.observed_at}.`).join('\n')||'Shipment status is unavailable. Please contact support.';
   const purpose=SUPPORT_TEMPLATES[p.template_id as keyof typeof SUPPORT_TEMPLATES].purpose;
   const payload={kind:'email',account_id:sender.body.account_id,from:sender.body.address,to:contact.address,subject:p.template_id==='marketing_test_v1'?'Synthetic offer':'Your order status',text,purpose,template_id:p.template_id,case_id:c.id,link_id:link.id,resource_id:c.resource_id,source_digest:view.source_digest,contact_revision:contact.revision};
   return this.#queue(s,c,owner,link,sender,payload,intentId);
  });
 }
 queueHelpdesk(scope:Scope,input:unknown){const p=exact(jsonValue(input),['case_id','link_id','sender_id','kind','event_id','expected_generation','assignee_id']);id(p.event_id);integer(p.expected_generation,1);if(!['note','handoff'].includes(p.kind)||p.kind==='note'&&p.assignee_id!==null)throw new Error('SUPPORT_INPUT_INVALID');if(p.assignee_id!==null)id(p.assignee_id);
  return this.k.transaction(()=>{const {s,c,owner}=assertSupportOwner(this.k,scope,p.case_id,p.expected_generation);this.k.authorize(scope,'support.note',c.resource_id);assertExecution(this.k,s,'helpdesk.write');
   const link=new SupportConversations(this.k).linkRecord(scope,p.link_id);if(link.case_id!==c.id||link.channel!=='helpdesk')throw new Error('SUPPORT_CHANNEL_MISMATCH');const sender=checkedDocument(this.k,s,'sender',p.sender_id);this.#source(s,sender.body);
   if(link.account_id!==sender.body.account_id)throw new Error('SUPPORT_CHANNEL_MISMATCH');
   const ref='help_'+contentDigest([s.tenant_id,s.store_id,c.id,link.id,p.kind,p.event_id]).slice(0,40);
   const payload={kind:p.kind,account_id:link.account_id,conversation_id:link.external_id,assignee_id:p.assignee_id,purpose:'internal',case_id:c.id,resource_id:c.resource_id,text:`Rifare case ${c.id}; order ${c.resource_id}; requires human review.`,operation_reference:ref};
   const old=this.k.db.prepare("SELECT id FROM commerce_operations WHERE tenant_id=? AND store_id=? AND source_kind='event' AND source_id=?").get(s.tenant_id,s.store_id,ref) as Row;
   if(old){const r=this.#row(scope,old.id);if(r.row.digest!==contentDigest(payload))throw new Error('IDEMPOTENCY_CONFLICT');return this.inspect(scope,old.id);}
   return this.#queue(s,c,owner,link,sender,payload,ref);
  });
 }
 #queue(s:Row,c:Row,owner:Row,link:Row,sender:Row,payload:Row,ref:string) {
  const k=this.k,hash=contentDigest(payload),op=queueOperation(k,s,c.resource_id,'event',ref,{schema_version:1,action:payload.kind==='email'?'customer.message':'helpdesk.write',resource_id:c.resource_id,source_id:ref,payload_digest:hash,financial_effect:false},{configuration_digest:c.configuration_digest});
  k.db.prepare('INSERT INTO commerce_support_deliveries VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,0)')
   .run(s.tenant_id,s.store_id,op.id,c.id,c.resource_id,link.id,payload.kind,payload.purpose,payload.kind==='email'?'email':'helpdesk',sender.id,sender.body.source_identity,sender.body.source_contract,sender.body.account_id,sender.version,owner.generation,owner.owner,s.token_hash,canonical(payload),hash,k.clock(),Math.min(k.clock()+3600000,sender.expires_at));
  // This account/contract pin is independent of a display name or current default.
  k.db.prepare('INSERT INTO commerce_operation_targets VALUES(?,?,?,?,?,?)').run(s.tenant_id,s.store_id,op.id,sender.id,sender.body.source_identity,sender.body.source_contract);
  supportEvent(k,s,c.id,'delivery_queued',owner.generation,op.id);return {operation_id:op.id,state:'queued',customer_delivered:false,execution_authorized:false};
 }
 inspect(scope:Scope,opId:string){const {s,row,op}=this.#row(scope,opId),observation=row.observation?JSON.parse(row.observation):null;
  if(observation&&contentDigest(observation)!==row.observation_digest)throw new Error('SUPPORT_DELIVERY_INTEGRITY');
  const w=this.k.db.prepare('SELECT last_code FROM commerce_operation_work WHERE tenant_id=? AND store_id=? AND operation_id=?').get(s.tenant_id,s.store_id,op.id) as Row;
  return {operation_id:op.id,case_id:row.case_id,kind:row.kind,purpose:row.purpose,state:op.state==='succeeded'?observation?.stage:op.state==='failed'&&w.last_code==='FINAL_AUTHORIZATION_DENIED'?'suppressed':op.state,operation_state:op.state,native_reference:op.provider_ref,source_stage:observation?.stage??null,customer_delivered:observation?.customer_delivered===true,source_identity:row.source_identity,created_at:row.created_at,expires_at:row.expires_at,execution_authorized:false};}
 #final(scope:Scope,operationId:string) {
  const {s,row,payload,op}=this.#row(scope,operationId,'operation.dispatch'),k=this.k;
  const parent=k.restrictedSession(row.owner_session_hash,row.resource_id,['support.read','case.read','resource.read','support.send','support.note','model.run'],()=>{},{});
  assertSupportOwner(k,parent,row.case_id,row.generation,row.owner);k.authorize(parent,row.kind==='email'?'support.send':'support.note',row.resource_id);
  if(row.expires_at<=k.clock())throw new Error('DELIVERY_EXPIRED');assertOperationExecution(k,s,op);
  const sender=checkedDocument(k,s,'sender',row.sender_id);if(sender.version!==row.sender_revision||sender.body.source_identity!==row.source_identity)throw new Error('SENDER_CHANGED');this.#source(s,row);
  if(row.kind==='email'){
   const eligibility=this.consent.eligibility(scope,row.case_id,row.sender_id,row.channel,row.purpose);if(!eligibility.allowed)throw new Error('DELIVERY_SUPPRESSED');
   const contact=k.db.prepare('SELECT * FROM commerce_support_contacts WHERE tenant_id=? AND store_id=? AND link_id=? AND erased=0').get(s.tenant_id,s.store_id,row.link_id) as Row;
   if(!contact||contact.revision!==payload.contact_revision||contact.address!==payload.to)throw new Error('CONTACT_CHANGED');
   const current=this.tracking.read(scope,row.case_id);if(current.source_digest!==payload.source_digest||current.status!=='available')throw new Error('MESSAGE_FACTS_CHANGED');
  }
  return {s,row,payload,op};
 }
 async dispatch(scope:Scope,opId:string,options:{beforeFinal?:()=>Promise<void>;timeout_ms?:number}={}) {
  const timeout=options.timeout_ms??1000;integer(timeout,1);if(timeout>5000)throw new Error('INVALID_INPUT');
  const k=this.k,{s,row}=this.#row(scope,opId,'operation.dispatch');assertRecoveryEgress(k);const source=this.#source(s,row),work=new DurableWork(k),claim=work.claim(scope,opId,10000);
  if(!claim)return this.inspect(scope,opId);if(options.beforeFinal)await options.beforeFinal();
  let payload:Row;
  try{payload=k.transaction(()=>{const ready=this.#final(scope,opId);work.beginSend(scope,opId,claim.lease_token);return ready.payload;});}
  catch(e){k.transaction(()=>{const w=k.db.prepare('SELECT * FROM commerce_operation_work WHERE tenant_id=? AND store_id=? AND operation_id=?').get(s.tenant_id,s.store_id,opId) as Row;
    if(w.state==='leased'&&w.lease_token===claim.lease_token){k.db.prepare("UPDATE commerce_operation_work SET state='dead',lease_token=NULL,lease_until=NULL,owner=NULL,last_code='FINAL_AUTHORIZATION_DENIED' WHERE tenant_id=? AND store_id=? AND operation_id=?").run(s.tenant_id,s.store_id,opId);transitionOperation(k,s,opId,'failed','provider_rejected');}});throw e;}
  // No asynchronous step between the final committed authorization and invoking this source.
  let result:any,timer:ReturnType<typeof setTimeout>|undefined;
  try{const attempt=source.send({tenant_id:s.tenant_id,store_id:s.store_id,operation_id:opId,payload_hash:contentDigest(payload),payload});result=await Promise.race([Promise.resolve(attempt),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('DELIVERY_TIMEOUT')),timeout);})]);}
  catch{result={kind:'unknown'};}finally{if(timer)clearTimeout(timer);}
  return k.transaction(()=>{const now=this.#row(scope,opId,'operation.dispatch'),w=k.db.prepare('SELECT * FROM commerce_operation_work WHERE tenant_id=? AND store_id=? AND operation_id=?').get(s.tenant_id,s.store_id,opId) as Row;
   if(w.state!=='sending'||w.lease_token!==claim.lease_token||w.lease_until<=k.clock())throw new Error('LEASE_UNAVAILABLE');
   if(this.#valid(now.row,result)){this.#accept(scope,now.row,result);}
   else{const notSent=result?.kind==='not_sent'&&result.operation_id===opId&&result.payload_hash===now.row.digest,exhausted=w.attempts>=MAX_OPERATION_ATTEMPTS;
    const state=notSent?(exhausted?'failed':'retry_wait'):result?.kind==='rejected'&&result.operation_id===opId&&result.payload_hash===now.row.digest?'failed':'unknown';
    k.db.prepare('UPDATE commerce_operation_work SET state=?,available_at=?,lease_token=NULL,lease_until=NULL,owner=NULL,last_code=? WHERE tenant_id=? AND store_id=? AND operation_id=?')
     .run(state==='failed'?'dead':state,k.clock()+(notSent?retryDelay(w.attempts):0),notSent?'KNOWN_NOT_SENT':state==='failed'?'SOURCE_REJECTED':'OUTCOME_UNKNOWN',s.tenant_id,s.store_id,opId);
    transitionOperation(k,s,opId,state,state==='unknown'?'outcome_unknown':state==='retry_wait'?'retry_scheduled':'provider_rejected');}
   return this.inspect(scope,opId);
  });
 }
 #valid(row:Row,r:any){return r&&r.kind==='accepted'&&r.operation_id===row.operation_id&&r.payload_hash===row.digest&&r.source_identity===row.source_identity&&r.account_id===row.account_id&&typeof r.native_id==='string'&&/^[A-Za-z0-9_-]{1,96}$/.test(r.native_id)&&Number.isSafeInteger(r.version)&&r.version>=1&&Number.isSafeInteger(r.observed_at)&&r.observed_at<=this.k.clock()&&['accepted','delivered','bounced','failed','internal_note','assigned'].includes(r.stage)&&r.purpose===row.purpose&&r.customer_delivered===(r.stage==='delivered')&&(row.kind==='email'?!['internal_note','assigned'].includes(r.stage):r.stage===(row.kind==='note'?'internal_note':'assigned'));}
 #accept(scope:Scope,row:Row,observation:Row) {const k=this.k,s=k.require(scope),old=row.observation?JSON.parse(row.observation):null;
  if(old&&(old.native_id!==observation.native_id||old.version>observation.version||old.version===observation.version&&contentDigest(old)!==contentDigest(observation)))throw new Error('DELIVERY_OBSERVATION_CONFLICT');
  if(old&&old.stage==='delivered'&&observation.stage==='accepted')throw new Error('DELIVERY_OBSERVATION_CONFLICT');
  if(old&&contentDigest(old)===contentDigest(observation))return;
  k.db.prepare('UPDATE commerce_support_deliveries SET observation=?,observation_digest=? WHERE tenant_id=? AND store_id=? AND operation_id=?').run(canonical(observation),contentDigest(observation),s.tenant_id,s.store_id,row.operation_id);
  k.db.prepare("UPDATE commerce_operation_work SET state='done',lease_token=NULL,lease_until=NULL,owner=NULL,last_code='SOURCE_CONFIRMED' WHERE tenant_id=? AND store_id=? AND operation_id=?").run(s.tenant_id,s.store_id,row.operation_id);
  transitionOperation(k,s,row.operation_id,'succeeded','source_confirmed',observation.native_id);
  supportEvent(k,s,row.case_id,'delivery_observed',row.generation,row.operation_id);
 }
 async reconcile(scope:Scope,opId:string) {const k=this.k,{s,row}=this.#row(scope,opId,'operation.reconcile'),source=this.#source(s,row);assertRecoveryEgress(k);let response:Row|null;
  try{response=await source.lookup(opId,row.digest);}catch{return this.inspect(scope,opId);}
  if(!response)return this.inspect(scope,opId);
  return k.transaction(()=>{const latest=this.#row(scope,opId,'operation.reconcile');if(!this.#valid(latest.row,response))throw new Error('DELIVERY_OBSERVATION_CONFLICT');this.#accept(scope,latest.row,response);return this.inspect(scope,opId);});
 }
}
