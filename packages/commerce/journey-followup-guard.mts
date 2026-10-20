import type {CommerceKernel,Scope,Row} from './kernel.mts';
import {exact,id,integer} from './kernel.mts';
import {canonical,contentDigest,jsonValue} from './configuration-values.mts';
import {permissionDecision} from './authorization.mts';
import {subjectHash} from './data-guards.mts';
import {supportCase,ownershipRow,checkedDocument} from './support-core.mts';
import {SupportConsent,emailAddress} from './support-consent.mts';
import type {SupportTracking} from './support-tracking.mts';
import {ShoppingCart} from './shopping-cart.mts';
import {ResolutionExecution} from './resolution-execution.mts';
import {OrderEdits} from './order-edit-execution.mts';
import {journeyRecords} from './journey-records.mts';
import {JourneyReferences,unresolvedJourneyEffects} from './journey-references.mts';
import {memoryRecords} from './shopper-memory-records.mts';
import {operationRow} from './operation-store.mts';
import {FOLLOWUP_STEP,followupRecords,followupJobId,followupPin,immutableFollowupJob,followupDeliveryIntent,followupDeliveryId} from './journey-followup-records.mts';
import type {FollowupRecord} from './journey-followup-records.mts';
import {followupCopies,retireFollowup} from './journey-followup-privacy.mts';

export type FollowupOwners={cart?:ShoppingCart;resolution?:ResolutionExecution;edits?:OrderEdits};
export type FollowupBinding={rows:FollowupRecord[];record:FollowupRecord;original:FollowupRecord;job:Row;event:Row;pin:Row;active:boolean};
export function nativeFollowupOwners(k:CommerceKernel,value:unknown):FollowupOwners {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('JOURNEY_FOLLOWUP_OWNER_MISMATCH');
  const classes:Row={cart:ShoppingCart,resolution:ResolutionExecution,edits:OrderEdits},out:Row={};
  for(const key of Reflect.ownKeys(value)) {
    const descriptor=Object.getOwnPropertyDescriptor(value,key)!;
    if(typeof key!=='string'||!Object.hasOwn(classes,key)||!Object.hasOwn(descriptor,'value'))throw new Error('JOURNEY_FOLLOWUP_OWNER_MISMATCH');
    const owner=descriptor.value;if(owner===undefined)continue;
    if(!(owner instanceof classes[key])||Object.getOwnPropertyDescriptor(owner,'kernel')?.value!==k)throw new Error('JOURNEY_FOLLOWUP_OWNER_MISMATCH');
    out[key]=owner;
  }
  return Object.freeze(out);
}
export function followupPrivate(k:CommerceKernel,scope:Scope,resource:string) {
  if(k.require(scope).role==='customer')return false;
  try{k.authorize(scope,'operation.read',resource);return true;}catch{return false;}
}
export function fenceFollowupCounterpart(k:CommerceKernel,s:Row,legacyId:string) {
  const guarded=legacyId.startsWith('sj_')?'sjf_'+legacyId.slice(3):legacyId;
  if(k.db.prepare('SELECT 1 FROM commerce_support_rule_jobs WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,guarded)||
    followupRecords(k,s).some(row=>row.body.job_id===guarded))throw new Error('JOURNEY_FOLLOWUP_CONFLICT');
}
export function refuseFollowupEvent(k:CommerceKernel,s:Row,eventId:string) {
  if(eventId.startsWith('sjf_'))throw new Error('JOURNEY_FOLLOWUP_ROUTE_UNSUPPORTED');
  if(eventId.startsWith('sj_'))fenceFollowupCounterpart(k,s,eventId);
}
export function followupJobBinding(k:CommerceKernel,s:Row,jobId:string,retained?:FollowupRecord[]):FollowupBinding {
  try {
    if(!/^sjf_[a-f0-9]{40}$/.test(jobId))throw new Error();
    const rows=(retained??followupRecords(k,s)).filter(row=>row.body.job_id===jobId),record=rows.at(-1);
    if(!record||new Set(rows.map(row=>row.id)).size!==1)throw new Error();
    const job=k.db.prepare('SELECT * FROM commerce_support_rule_jobs WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,jobId) as Row;
    if(!job)throw new Error();
    exact(job,['tenant_id','store_id','id','case_id','resource_id','rule_id','version','rule_digest','event_id','event_body','generation','due_at','state','result']);
    [job.case_id,job.resource_id,job.rule_id,job.event_id].forEach(id);integer(job.version,1);integer(job.generation,1);integer(job.due_at);
    if(!['waiting','completed','cancelled'].includes(job.state)||job.case_id!==record.body.case_id||job.resource_id!==record.body.resource_id||
      followupJobId(s.tenant_id,s.store_id,job.rule_id,job.event_id)!==jobId)throw new Error();
    const event=exact(jsonValue(JSON.parse(job.event_body),32768),['id','case_id','trigger','channel','at','visited','depth','link_id','sender_id']);
    if(canonical(event)!==job.event_body||event.id!==job.event_id||event.case_id!==job.case_id||event.channel!=='email'||
      !['message_received','shipment_exception','return_requested'].includes(event.trigger)||!Array.isArray(event.visited)||event.visited.length>8||
      new Set(event.visited).size!==event.visited.length||event.visited.includes(job.rule_id))throw new Error();
    [event.link_id,event.sender_id,...event.visited].forEach(id);integer(event.at);integer(event.depth);if(event.depth>=4||event.at>k.clock())throw new Error();
    const result=jsonValue(JSON.parse(job.result)),pin=followupPin(result?.journey_guard),original=rows.find(row=>row.version===pin.guard_version);
    if(canonical(result)!==job.result||!original||pin.guard_id!==record.id||job.state==='waiting'&&Object.keys(result).length!==1)throw new Error();
    if(job.state==='completed')id(result.operation_id);
    const active=record.state==='active'&&record.body.status==='current',b=record.body;
    if(active&&(record.version!==original.version||original.digest!==pin.guard_digest||contentDigest(immutableFollowupJob(job))!==b.job_digest||
      job.rule_id!==b.rule.id||job.version!==b.rule.version||job.rule_digest!==b.rule.digest||event.link_id!==b.link_id||event.sender_id!==b.sender_id||
      job.generation!==b.generation||job.due_at!==b.due_at))throw new Error();
    return {rows,record,original,job,event,pin,active};
  }catch(error){if(error instanceof Error&&error.message==='JOURNEY_FOLLOWUP_ROW_LIMIT')throw error;throw new Error('JOURNEY_FOLLOWUP_INTEGRITY');}
}
export function currentFollowupRule(k:CommerceKernel,s:Row,ref:Row,event?:Row):Row|null {
  let rule:Row;
  try{rule=checkedDocument(k,s,'support_rules',ref.id,ref.version);}
  catch(error){if(error instanceof Error&&/INTEGRITY/.test(error.message))throw new Error('JOURNEY_FOLLOWUP_INTEGRITY');return null;}
  const member=k.db.prepare('SELECT active,role FROM commerce_members WHERE tenant_id=? AND store_id=? AND actor_id=?')
    .get(s.tenant_id,s.store_id,rule.reviewer) as Row;
  const authority=member?.active?permissionDecision(k.db,{...s,actor_id:rule.reviewer,role:member.role},'policy.review'):null;
  if(rule.digest!==ref.digest||rule.body.action!=='queue_tracking'||!authority?.allowed||rule.review_digest!==contentDigest({digest:rule.digest,revision:authority.authority_revision}))return null;
  if(event&&(rule.body.trigger!==event.trigger||!['any',event.channel].includes(rule.body.conditions.channel)||event.visited.includes(rule.id)||event.depth>=4))return null;
  return rule;
}

function sourceRows(k:CommerceKernel,s:Row,c:Row,b:Row) {
  const order=k.db.prepare("SELECT * FROM commerce_resources WHERE tenant_id=? AND store_id=? AND id=? AND kind='order'").get(s.tenant_id,s.store_id,c.resource_id) as Row;
  const customer=k.db.prepare("SELECT * FROM commerce_resources WHERE tenant_id=? AND store_id=? AND id=? AND kind='customer'")
    .get(s.tenant_id,s.store_id,b.source.customer_resource_id) as Row;
  const present=!!order&&!!customer&&order.customer_id===c.customer_id&&customer.external_id===c.customer_id&&customer.source_system===order.source_system&&
    subjectHash(s.tenant_id,s.store_id,c.customer_id)===b.subject_ref;
  return {order,customer,present};
}
function sameSource(source:Row,current:ReturnType<typeof sourceRows>) {
  return current.present&&source.customer_resource_id===current.customer.id&&source.customer_source_version===current.customer.source_version&&
    source.customer_source_digest===contentDigest(JSON.parse(current.customer.payload))&&source.order_source_version===current.order.source_version&&
    source.order_source_digest===contentDigest(JSON.parse(current.order.payload));
}
function checkedLink(k:CommerceKernel,s:Row,c:Row,ref:string,revision:number) {
  const link=k.db.prepare('SELECT * FROM commerce_support_links WHERE tenant_id=? AND store_id=? AND id=? AND erased=0').get(s.tenant_id,s.store_id,ref) as Row;
  return link&&link.case_id===c.id&&link.resource_id===c.resource_id&&link.customer_id===c.customer_id&&link.source_revision===revision?link:null;
}

/** Native reads only. Neither a proposed cart nor an accepted refund is
 * completed by observing it. The actual dispatch scope supplies operation.read. */
export function currentFollowupReason(k:CommerceKernel,scope:Scope,b:Row,owners:FollowupOwners,tracking:SupportTracking):string|null {
  const {s,c}=supportCase(k,scope,b.case_id);k.authorize(scope,'operation.read',c.resource_id);
  if(s.role==='customer')throw new Error('ACCESS_DENIED');
  if(b.expires_at<=k.clock())return 'expired';
  const owner=ownershipRow(k,s,c.id);
  if(!owner||owner.generation!==b.generation||owner.owner!==s.actor_id)return 'ownership_changed';
  let journey:FollowupRecord|undefined;
  try{journey=journeyRecords(k,s).filter(row=>row.id===b.journey.id).at(-1);}
  catch{throw new Error('JOURNEY_FOLLOWUP_INTEGRITY');}
  if(!journey||journey.state!=='active'||journey.body.status!=='current'||journey.version!==b.journey.version||journey.digest!==b.journey.digest)return 'journey_changed';
  const intent=journey.body.intents.find((i:Row)=>i.id===b.journey.intent_id),reference=b.journey.reference;
  if(!intent||reference===null&&intent.kind!=='tracking'||reference!==null&&!intent.references.some((r:Row)=>canonical(r)===canonical(reference)))return 'journey_changed';
  const allowed=reference===null&&intent.kind==='tracking'||reference?.kind==='cart'&&intent.kind==='shopping'||
    reference?.kind==='resolution'&&['return','exchange'].includes(intent.kind)||reference?.kind==='edit'&&intent.kind==='edit';
  if(!allowed)return 'unavailable';
  if(reference) {
    let native:Row;
    try {
      const artifact=new JourneyReferences(k,s,c).resolve(reference,intent.kind);
      if(reference.kind==='cart'){if(!owners.cart)return 'native_owner_unavailable';native=owners.cart.readCart(scope,reference.id);}
      else if(reference.kind==='resolution'){
        if(!['refund','store_credit'].includes(artifact.row.kind))return 'unavailable';
        if(!owners.resolution)return 'native_owner_unavailable';native=owners.resolution.read(scope,reference.id);
      }else{if(!owners.edits)return 'native_owner_unavailable';native=owners.edits.status(scope,reference.id);}
    }catch(error){
      const message=error instanceof Error?error.message:'';
      if(/INTEGRITY|MISMATCH|INVALID|REFERENCE/.test(message))throw new Error('JOURNEY_FOLLOWUP_INTEGRITY');
      return /SOURCE_CHANGED/.test(message)?'source_changed':'native_owner_unavailable';
    }
    if(['unknown','sending'].includes(native.state))return 'native_unknown';
    if(reference.kind==='cart'&&native.status==='purchased')return 'cart_purchased';
    if(reference.kind==='resolution'&&native.cash_settled===true)return 'refund_settled';
    if(reference.kind==='resolution'&&native.credit_issued===true)return 'credit_issued';
    if(reference.kind==='edit'&&['released','cancelled','abandoned'].includes(native.state))return 'edit_'+native.state;
  }
  if(unresolvedJourneyEffects(k,s,c.resource_id).length)return 'native_unknown';
  const current=sourceRows(k,s,c,b);let memory:Row|undefined;
  try{memory=memoryRecords(k,s).filter(row=>row.id===b.memory.id).at(-1);}catch{throw new Error('JOURNEY_FOLLOWUP_INTEGRITY');}
  if((memory?.version??0)!==b.memory.version)return 'memory_changed';
  if(memory&&(memory.state!=='active'||memory.body.status!=='current'||memory.body.expires_at<=k.clock()||!sameSource(memory.body.source,current)||
    !checkedLink(k,s,c,memory.body.source.link_id,memory.body.source.link_revision)))return 'memory_changed';
  if(!sameSource(b.source,current))return 'source_changed';
  const link=checkedLink(k,s,c,b.link_id,b.link_revision);
  if(!link||link.channel!=='email')return 'source_changed';
  const contact=k.db.prepare('SELECT * FROM commerce_support_contacts WHERE tenant_id=? AND store_id=? AND link_id=? AND erased=0')
    .get(s.tenant_id,s.store_id,b.link_id) as Row;
  if(!contact||contentDigest(contact.address)!==contact.address_digest||contact.address!==emailAddress(JSON.parse(current.customer.payload).email))return 'source_changed';
  if(!currentFollowupRule(k,s,b.rule))return 'rule_changed';
  try{if(!new SupportConsent(k).eligibility(scope,c.id,b.sender_id,'email','transactional').allowed)return 'consent_changed';}
  catch(error){if(error instanceof Error&&/INTEGRITY/.test(error.message))throw new Error('JOURNEY_FOLLOWUP_INTEGRITY');return 'unavailable';}
  try{if(tracking.read(scope,c.id).status!=='available')return 'unavailable';}
  catch(error){if(error instanceof Error&&/INTEGRITY/.test(error.message))throw error;return 'unavailable';}
  return null;
}
export function followupReason(k:CommerceKernel,scope:Scope,binding:FollowupBinding,owners:FollowupOwners,tracking:SupportTracking) {
  return binding.active?currentFollowupReason(k,scope,binding.record.body,owners,tracking):binding.record.body.reason??'unavailable';
}
export function deliveryFollowupBinding(k:CommerceKernel,s:Row,row:Row,payload:Row):FollowupBinding|null {
  try {
    const retained=followupRecords(k,s),latest=new Map<string,FollowupRecord>();for(const r of retained)latest.set(r.id,r);
    const op=operationRow(k,s,row.operation_id),matching=[...latest.values()].filter(r=>{
      const intent=followupDeliveryIntent(s.tenant_id,s.store_id,r.body.case_id,row.link_id,row.sender_id,r.body.job_id);
      return op.source_id===intent&&row.operation_id===followupDeliveryId(s.tenant_id,s.store_id,intent)||payload.journey_followup?.job_id===r.body.job_id;
    });
    if(!matching.length){if(payload.journey_followup)throw new Error();return null;}
    if(matching.length!==1)throw new Error();const binding=followupJobBinding(k,s,matching[0].body.job_id,retained);
    const copy=followupCopies(k,binding.rows).find(copy=>copy.row.operation_id===row.operation_id);
    if(!copy||copy.erased||canonical(payload.journey_followup)!==canonical({job_id:binding.job.id,...binding.pin})||
      row.case_id!==binding.job.case_id||row.resource_id!==binding.job.resource_id||row.link_id!==binding.event.link_id||
      row.sender_id!==binding.event.sender_id||row.generation!==binding.job.generation)throw new Error();
    return binding;
  }catch(error){if(error instanceof Error&&error.message==='JOURNEY_FOLLOWUP_ROW_LIMIT')throw error;throw new Error('JOURNEY_FOLLOWUP_INTEGRITY');}
}
export function queueFollowupBinding(k:CommerceKernel,scope:Scope,p:Row) {
  const s=k.require(scope);
  if(!p.event_id.startsWith('sjf_')){if(p.event_id.startsWith('sj_'))fenceFollowupCounterpart(k,s,p.event_id);return null;}
  const binding=followupJobBinding(k,s,p.event_id),job=binding.job;
  if(p.case_id!==job.case_id||p.link_id!==binding.event.link_id||p.sender_id!==binding.event.sender_id||p.template_id!==FOLLOWUP_STEP||
    p.expected_generation!==job.generation)throw new Error('JOURNEY_FOLLOWUP_INTEGRITY');
  return binding;
}
export function requireFollowupCompleted(binding:FollowupBinding,operationId:string) {
  if(binding.job.state!=='completed'||JSON.parse(binding.job.result).operation_id!==operationId)throw new Error('JOURNEY_FOLLOWUP_NOT_READY');
}
export function preclaimFollowup(k:CommerceKernel,s:Row,row:Row,payload:Row) {
  const binding=deliveryFollowupBinding(k,s,row,payload);if(!binding)return;
  const work=k.db.prepare('SELECT * FROM commerce_operation_work WHERE tenant_id=? AND store_id=? AND operation_id=?')
    .get(s.tenant_id,s.store_id,row.operation_id) as Row;
  if(!work)throw new Error('JOURNEY_FOLLOWUP_INTEGRITY');
  if(work.attempts===0&&work.state==='pending')requireFollowupCompleted(binding,row.operation_id);
}
export class FollowupSuppressed extends Error {
  readonly reason:string;
  constructor(reason:string){super('JOURNEY_FOLLOWUP_SUPPRESSED');this.reason=reason;}
}
export function finalFollowup(k:CommerceKernel,scope:Scope,row:Row,payload:Row,owners:FollowupOwners,tracking:SupportTracking) {
  const binding=deliveryFollowupBinding(k,k.require(scope),row,payload);if(!binding)return;
  requireFollowupCompleted(binding,row.operation_id);
  const reason=followupReason(k,scope,binding,owners,tracking);if(reason)throw new FollowupSuppressed(reason);
}
export function retireDeliveryFollowup(k:CommerceKernel,s:Row,row:Row,payload:Row,reason:string) {
  const binding=deliveryFollowupBinding(k,s,row,payload);if(!binding)throw new Error('JOURNEY_FOLLOWUP_INTEGRITY');
  retireFollowup(k,s,binding.rows,reason);
}
