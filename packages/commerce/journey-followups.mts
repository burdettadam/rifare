import type {CommerceKernel,Scope,Row} from './kernel.mts';
import {exact,id,integer} from './kernel.mts';
import {canonical,contentDigest,jsonValue} from './configuration-values.mts';
import {subjectHash} from './data-guards.mts';
import {growthCustomerProof} from './growth-shopping-core.mts';
import {CommerceJourneys} from './commerce-journeys.mts';
import {SupportDelivery} from './support-delivery.mts';
import {SupportTracking} from './support-tracking.mts';
import {SupportRules,nextRuleTime} from './support-rules.mts';
import {SupportConversations} from './support-conversations.mts';
import {emailAddress} from './support-consent.mts';
import {supportCase,ownershipRow,assertSupportOwner,saveDocument} from './support-core.mts';
import {journeyHash,journeyReference,journeyRecords} from './journey-records.mts';
import {memoryId,MEMORY_PURPOSE,memoryRecords} from './shopper-memory-records.mts';
import {FOLLOWUP_KIND,FOLLOWUP_MAX_ROWS,FOLLOWUP_MAX_AGE,followupRecords,followupLogicalKey,followupId,followupJobId,immutableFollowupJob} from './journey-followup-records.mts';
import {nativeFollowupOwners,followupPrivate,currentFollowupRule,currentFollowupReason,followupJobBinding,followupReason,deliveryFollowupBinding} from './journey-followup-guard.mts';
import type {FollowupBinding,FollowupOwners} from './journey-followup-guard.mts';
import {followupCopies,retireFollowup} from './journey-followup-privacy.mts';

const COMMON=['case_id','link_id','expected_generation'];
type CustomerBinding={s:Row;c:Row;current:ReturnType<typeof growthCustomerProof>;link:Row;owner:Row;subject:string};
function scheduleInput(value:unknown) {
  const p=exact(jsonValue(value,32768),['rule','journey','event','expected_generation','expires_at']);
  const r=exact(p.rule,['id','version','digest']),j=exact(p.journey,['id','version','context_digest','intent_id','reference']);
  [r.id,j.id,j.intent_id].forEach(id);integer(r.version,1);integer(j.version,1);integer(p.expected_generation,1);integer(p.expires_at,1);
  if(!journeyHash(r.digest)||!journeyHash(j.context_digest))throw new Error('JOURNEY_FOLLOWUP_INPUT_INVALID');
  if(j.reference!==null)journeyReference(j.reference);
  const e=exact(p.event,['id','case_id','trigger','channel','at','visited','depth','link_id','sender_id']);
  [e.id,e.case_id,e.link_id,e.sender_id].forEach(id);integer(e.at);integer(e.depth);
  if(!['message_received','shipment_exception','return_requested'].includes(e.trigger)||e.channel!=='email'||!Array.isArray(e.visited)||
    e.visited.length>8||new Set(e.visited).size!==e.visited.length||e.depth>=4)throw new Error('JOURNEY_FOLLOWUP_INPUT_INVALID');
  e.visited.forEach(id);return p;
}
function projection(job:string,caseId:string,state:string,reason:string|null,operation:string|null,delivered=false,restricted=false) {
  const terminal=['cart_purchased','refund_settled','credit_issued','edit_released','edit_cancelled','edit_abandoned'];
  return {job_id:job,case_id:caseId,state,reason,operation_id:restricted?null:operation,customer_delivered:!restricted&&delivered,
    restricted,manual_action_required:restricted||!['waiting','queued','accepted','delivered'].includes(state)&&!(state==='suppressed'&&terminal.includes(reason??'')),
    execution_authorized:false,production_qualified:false};
}

export class JourneyFollowups {
  readonly k:CommerceKernel;readonly journeys:CommerceJourneys;readonly delivery:SupportDelivery;readonly owners:FollowupOwners;readonly rules:SupportRules;
  constructor(k:CommerceKernel,journeys:CommerceJourneys) {
    if(!(journeys instanceof CommerceJourneys))throw new Error('JOURNEY_FOLLOWUP_OWNER_MISMATCH');
    const descriptor=Object.getOwnPropertyDescriptors(journeys);
    if(descriptor.k?.value!==k||!Object.hasOwn(descriptor.owners??{},'value')||!Object.hasOwn(descriptor.reads??{},'value'))throw new Error('JOURNEY_FOLLOWUP_OWNER_MISMATCH');
    const supplied=descriptor.owners.value,delivery=Object.getOwnPropertyDescriptor(supplied,'delivery')?.value;
    if(!(delivery instanceof SupportDelivery)||Object.getOwnPropertyDescriptor(delivery,'k')?.value!==k||
      !(delivery.tracking instanceof SupportTracking)||delivery.tracking.k!==k||delivery.tracking.reads!==descriptor.reads.value)throw new Error('JOURNEY_FOLLOWUP_OWNER_MISMATCH');
    const selected:Row={};
    for(const key of ['cart','resolution','edits']){const d=Object.getOwnPropertyDescriptor(supplied,key);if(d&&!Object.hasOwn(d,'value'))throw new Error('JOURNEY_FOLLOWUP_OWNER_MISMATCH');if(d?.value!==undefined)selected[key]=d.value;}
    const owners=nativeFollowupOwners(k,selected);
    for(const key of ['cart','resolution','edits'] as const)if(owners[key]!==delivery.followupOwners[key])throw new Error('JOURNEY_FOLLOWUP_OWNER_MISMATCH');
    this.k=k;this.journeys=journeys;this.delivery=delivery;this.owners=owners;this.rules=new SupportRules(k,delivery);
  }
  #binding(scope:Scope,proof:Scope,p:Row,write=false) {
    const k=this.k,{s,c}=supportCase(k,scope,p.case_id),v=k.require(proof);
    if(v.role!=='customer'||v.tenant_id!==s.tenant_id||v.store_id!==s.store_id||v.resource_id!==c.resource_id||v.customer_id!==c.customer_id)throw new Error('CUSTOMER_VERIFICATION_REQUIRED');
    supportCase(k,proof,c.id);const current=growthCustomerProof(k,v,c.resource_id,c.customer_id),link=new SupportConversations(k).linkRecord(scope,p.link_id),owner=ownershipRow(k,s,c.id);
    if(link.case_id!==c.id||link.resource_id!==c.resource_id||link.customer_id!==c.customer_id||link.channel!=='email')throw new Error('JOURNEY_FOLLOWUP_LINK_MISMATCH');
    if(!owner||owner.generation!==p.expected_generation)throw new Error('SUPPORT_OWNERSHIP_CHANGED');
    if(s.role!=='customer')assertSupportOwner(k,scope,c.id,p.expected_generation);
    const contact=k.db.prepare('SELECT * FROM commerce_support_contacts WHERE tenant_id=? AND store_id=? AND link_id=? AND erased=0')
      .get(s.tenant_id,s.store_id,link.id) as Row;
    if(!contact||contentDigest(contact.address)!==contact.address_digest||contact.address!==emailAddress(JSON.parse(current.customer.payload).email))throw new Error('CONTACT_VERIFICATION_REQUIRED');
    if(write){k.authorize(scope,'support.reply',c.resource_id);k.authorize(scope,'operation.read',c.resource_id);k.authorize(scope,'support.send',c.resource_id);if(s.role==='customer')throw new Error('ACCESS_DENIED');}
    return {s,c,current,link,owner,subject:subjectHash(s.tenant_id,s.store_id,c.customer_id)};
  }
  #view(scope:Scope,b:CustomerBinding,binding:FollowupBinding) {
    const k=this.k,job=binding.job;
    if(job.case_id!==b.c.id||job.resource_id!==b.c.resource_id||binding.record.body.subject_ref!==b.subject)throw new Error('JOURNEY_FOLLOWUP_INTEGRITY');
    if(!followupPrivate(k,scope,b.c.resource_id))return projection(job.id,b.c.id,'restricted',null,null,false,true);
    const copies=followupCopies(k,binding.rows);if(copies.length>1)throw new Error('JOURNEY_FOLLOWUP_INTEGRITY');
    const copy=copies[0];if(copy){if(copy.erased)throw new Error('NOT_FOUND');deliveryFollowupBinding(k,b.s,copy.row,copy.payload);}
    const storedResult=JSON.parse(job.result);
    if(job.state==='completed'&&storedResult.operation_id!==copy?.row.operation_id)throw new Error('JOURNEY_FOLLOWUP_INTEGRITY');
    let native=copy?this.delivery.inspect(scope,copy.row.operation_id):null;
    if(native&&(['unknown','sending','succeeded'].includes(copy!.op.state)||native.state==='failed'))
      return projection(job.id,b.c.id,native.state,native.state==='unknown'?'native_unknown':null,copy!.row.operation_id,native.customer_delivered);
    let reason=followupReason(k,scope,binding,this.owners,this.delivery.tracking);
    if(!reason&&(job.state==='cancelled'||native&&['suppressed','failed'].includes(native.state)))reason='unavailable';
    if(reason){retireFollowup(k,b.s,binding.rows,reason);native=copy?this.delivery.inspect(scope,copy.row.operation_id):null;}
    const state=native?.state==='retry_wait'?'retry_wait':reason?'suppressed':native?.state??'waiting';
    return projection(job.id,b.c.id,state,reason,copy?.row.operation_id??null,native?.customer_delivered===true);
  }
  schedule(scope:Scope,customerProof:Scope,value:unknown) {
    const p=scheduleInput(value),common={case_id:p.event.case_id,link_id:p.event.link_id,expected_generation:p.expected_generation};
    return this.k.transaction(()=>{
      const k=this.k,b=this.#binding(scope,customerProof,common,true),retained=followupRecords(k,b.s),logical=followupLogicalKey(b.s.tenant_id,b.s.store_id,p.journey.id,p.journey.intent_id),
        ref=followupId(logical),previous=retained.filter(row=>row.id===ref),hash=contentDigest(p);
      if(previous.length){if(previous.at(-1)!.body.request_hash!==hash)throw new Error('JOURNEY_FOLLOWUP_CONFLICT');return this.#view(scope,b,followupJobBinding(k,b.s,previous[0].body.job_id,retained));}
      const now=k.clock();if(retained.length>=FOLLOWUP_MAX_ROWS)throw new Error('JOURNEY_FOLLOWUP_ROW_LIMIT');
      if(p.event.at>now||p.expires_at<=now||p.expires_at>now+FOLLOWUP_MAX_AGE)throw new Error('JOURNEY_FOLLOWUP_INPUT_INVALID');
      const context=this.journeys.context(scope,customerProof,common);
      if(context.id!==p.journey.id||context.version!==p.journey.version||context.context_digest!==p.journey.context_digest||context.status!=='active')throw new Error('JOURNEY_FOLLOWUP_CONTEXT_CHANGED');
      const journey=journeyRecords(k,b.s).find(row=>row.id===context.id&&row.version===context.version)!;
      const rule=currentFollowupRule(k,b.s,p.rule,p.event);if(!rule)throw new Error('JOURNEY_FOLLOWUP_INELIGIBLE');
      const due=nextRuleTime(p.event.at+rule.body.wait_ms,rule.body.calendar);
      if(p.expires_at<=due||p.expires_at>rule.expires_at)throw new Error('JOURNEY_FOLLOWUP_INPUT_INVALID');
      const job={tenant_id:b.s.tenant_id,store_id:b.s.store_id,id:followupJobId(b.s.tenant_id,b.s.store_id,rule.id,p.event.id),case_id:b.c.id,resource_id:b.c.resource_id,
        rule_id:rule.id,version:rule.version,rule_digest:rule.digest,event_id:p.event.id,event_body:canonical(p.event),generation:b.owner.generation,due_at:due};
      const identity={case_id:b.c.id,resource_id:b.c.resource_id,subject_ref:b.subject},memoryRef=memoryId(b.s.tenant_id,b.s.store_id,{...identity,purpose:MEMORY_PURPOSE}),
        memory=memoryRecords(k,b.s).filter(row=>row.id===memoryRef).at(-1);
      const body={schema_version:1,...identity,logical_key:logical,request_hash:hash,status:'current',job_id:job.id,job_digest:contentDigest(immutableFollowupJob(job)),
        journey:{id:journey.id,version:journey.version,digest:journey.digest,intent_id:p.journey.intent_id,reference:p.journey.reference},memory:{id:memoryRef,version:memory?.version??0},
        source:{customer_resource_id:b.current.customer.id,customer_source_version:b.current.customer.source_version,customer_source_digest:contentDigest(JSON.parse(b.current.customer.payload)),
          order_source_version:b.current.order.source_version,order_source_digest:contentDigest(JSON.parse(b.current.order.payload)),observed_at:now},
        link_id:b.link.id,link_revision:b.link.source_revision,rule:p.rule,sender_id:p.event.sender_id,generation:b.owner.generation,due_at:due,expires_at:p.expires_at};
      if(currentFollowupReason(k,scope,body,this.owners,this.delivery.tracking))throw new Error('JOURNEY_FOLLOWUP_INELIGIBLE');
      const guard=saveDocument(k,{...b.s,actor_id:FOLLOWUP_KIND},FOLLOWUP_KIND,ref,0,body,'active',body.expires_at),pin={guard_id:guard.id,guard_version:guard.version,guard_digest:guard.digest};
      const scheduled=this.rules.schedule(scope,p.event,{rule:p.rule,journey_guard:pin});
      if(scheduled.jobs.length!==1||scheduled.jobs[0].id!==job.id)throw new Error('JOURNEY_FOLLOWUP_INTEGRITY');
      return this.#view(scope,b,followupJobBinding(k,b.s,job.id));
    });
  }
  inspect(scope:Scope,customerProof:Scope,value:unknown) {
    const p=exact(jsonValue(value,32768),[...COMMON,'job_id']);[p.case_id,p.link_id,p.job_id].forEach(id);integer(p.expected_generation,1);
    return this.k.transaction(()=>{const b=this.#binding(scope,customerProof,p);return this.#view(scope,b,followupJobBinding(this.k,b.s,p.job_id));});
  }
}
