import type {CommerceKernel,Scope,Row} from './kernel.mts';
import {id,exact} from './kernel.mts';
import type {ReadContext} from './read-context.mts';
import {contentDigest,canonical,jsonValue} from './configuration-values.mts';
import {SupportConversations} from './support-conversations.mts';
import {SupportTracking} from './support-tracking.mts';
import {supportCase,assertSupportOwner,documentRow,saveDocument,supportEvent} from './support-core.mts';
import {Skills} from './skills.mts';
import {assertExecution} from './execution-stops.mts';
export class SupportWorkflows {
 readonly k:CommerceKernel;readonly reads:ReadContext;readonly conversations:SupportConversations;readonly tracking:SupportTracking;readonly skills:Skills;
 constructor(k:CommerceKernel,reads:ReadContext){this.k=k;this.reads=reads;this.conversations=new SupportConversations(k);this.tracking=new SupportTracking(k,reads);this.skills=reads.skills;}
 #pin(scope:Scope,caseId:string,workflow:string,expected:string){if(!['support-reply','shipment-assistance'].includes(workflow)||typeof expected!=='string'||!/^[a-f0-9]{64}$/.test(expected))throw new Error('SUPPORT_WORKFLOW_INVALID');
  const {s,c}=supportCase(this.k,scope,caseId),bundle=this.skills.describe(scope,workflow);if(bundle.bundle_digest!==expected)throw new Error('SKILL_CHANGED');const ref=caseId+'_'+(workflow==='support-reply'?'support':'shipment');id(ref);
  const pin={case_id:caseId,workflow,skill_digest:expected,configuration_digest:c.configuration_digest,profile_digest:c.pins.profile.sha256,policy_digest:c.pins.policy.digest};
  const existing=this.k.db.prepare("SELECT 1 FROM commerce_support_documents WHERE tenant_id=? AND store_id=? AND kind='workflow_pin' AND id=?").get(s.tenant_id,s.store_id,ref);
  if(existing){const r=documentRow(this.k,s,'workflow_pin',ref);if(contentDigest(pin)!==r.digest)throw new Error('SUPPORT_WORKFLOW_CHANGED');return r;}
  // Context pinning is durable case metadata, not publication or execution authority.
  return this.k.transaction(()=>{supportCase(this.k,scope,caseId);return saveDocument(this.k,s,'workflow_pin',ref,0,pin);});
 }
 context(scope:Scope,input:unknown){const p=exact(jsonValue(input),['case_id','workflow','skill_digest']),pin=this.#pin(scope,p.case_id,p.workflow,p.skill_digest),{c}=supportCase(this.k,scope,p.case_id),tracking=this.tracking.read(scope,c.id),history=this.conversations.history(scope,c.id,0,25);
  const resources=this.skills.describe(scope,p.workflow).resources.map((r:Row)=>({path:r.path,sha256:r.sha256}));
  const selected=this.reads.knowledge.search(scope,p.workflow==='support-reply'?'policy':'shipping',5,c.resource_id);
  const sources=(Array.isArray(selected)?selected:selected.results??selected.sources??[]).slice(0,5);
  const facts:Row[]=[];if(tracking.status==='available')for(const ship of tracking.shipments)facts.push({id:'shipment_'+contentDigest(ship.id).slice(0,24),kind:'shipment',shipment_id:ship.id,status:ship.status,estimated_delivery:null,source:ship.source});
  if(tracking.all_delivered)facts.push({id:'all_delivered',kind:'summary',status:'all_carrier_shipments_delivered',warehouse_received:false,source:tracking.source});
  facts.push({id:'policy_reference',kind:'policy',policy_id:c.pins.policy.policy_id,revision:c.pins.policy.version,digest:c.pins.policy.digest,eligibility_not_execution:true});
  const context={case_id:c.id,resource_id:c.resource_id,workflow:p.workflow,skill_digest:p.skill_digest,pin_digest:pin.digest,profile:{tone:c.pins.profile.tone,locale:c.pins.profile.locale},tracking,facts,knowledge:sources,
   untrusted_customer_data:{messages:history.messages.filter((m:Row)=>m.visibility==='public'),history_complete:history.history_complete,authority:false},ownership:history.ownership,resources,monetary_actions:[],model_thread_required:false};
  return {...context,context_digest:contentDigest(context),execution_authorized:false};
 }
 resource(scope:Scope,input:unknown){const p=exact(jsonValue(input),['case_id','workflow','skill_digest','path']);this.#pin(scope,p.case_id,p.workflow,p.skill_digest);const r=this.skills.read(scope,p.workflow,p.path,p.skill_digest);return r;}
 answer(scope:Scope,input:unknown){const p=exact(jsonValue(input),['case_id','workflow','skill_digest','context_digest','fact_ids','handling','request_id']);id(p.request_id);if(!Array.isArray(p.fact_ids)||p.fact_ids.length>100||new Set(p.fact_ids).size!==p.fact_ids.length||!['answer','handoff'].includes(p.handling))throw new Error('SUPPORT_OUTPUT_INVALID');p.fact_ids.forEach(id);
  return this.k.transaction(()=>{const {s,c,owner}=assertSupportOwner(this.k,scope,p.case_id);this.k.authorize(scope,'support.reply',c.resource_id);if(['agent','worker'].includes(s.role))assertExecution(this.k,s,'model.run');
   const intent=contentDigest(p),ref='sanswer_'+contentDigest([s.tenant_id,s.store_id,c.id,p.request_id]).slice(0,36),old=this.k.db.prepare('SELECT * FROM commerce_support_attempts WHERE tenant_id=? AND store_id=? AND id=? AND erased=0').get(s.tenant_id,s.store_id,ref) as Row;
   if(old){const b=JSON.parse(old.body);if(b.intent_digest!==intent)throw new Error('SUPPORT_ANSWER_CONFLICT');return {...b.result,id:ref,duplicate:true};}
   const ctx=this.context(scope,{case_id:c.id,workflow:p.workflow,skill_digest:p.skill_digest});if(ctx.context_digest!==p.context_digest)throw new Error('SUPPORT_CONTEXT_CHANGED');
   const selected=p.fact_ids.map((i:string)=>ctx.facts.find((f:Row)=>f.id===i));if(selected.some((f:Row)=>!f))throw new Error('UNGROUNDED_OUTPUT');
   if(p.handling==='answer'&&(ctx.tracking.status!=='available'||!ctx.tracking.shipments.length||ctx.tracking.shipments.some((sh:Row)=>sh.status==='unknown')||!ctx.facts.filter((f:Row)=>f.kind==='shipment').every((f:Row)=>p.fact_ids.includes(f.id))))throw new Error('SUPPORT_HANDOFF_REQUIRED');
   const text=p.handling==='handoff'?'An operator needs to review this case. No new business action has been authorized.':selected.filter((f:Row)=>f.kind==='shipment').map((f:Row)=>`Shipment ${f.shipment_id}: ${f.status}. No delivery date is confirmed.`).join('\n')+(ctx.tracking.all_delivered?'\nAll listed carrier shipments are delivered; warehouse inspection remains separate.':'\nThe full order is not confirmed delivered.');
   const result={status:p.handling==='answer'?'answered':'handoff',case_id:c.id,text,facts:selected,citations:selected.map((f:Row)=>({fact_id:f.id,source:f.source??{policy_digest:f.digest}})),context_digest:ctx.context_digest,knowledge_sources:ctx.knowledge,source_digest:ctx.tracking.source_digest??null,handling_correct_at_capture:p.handling==='handoff'||ctx.tracking.status==='available',customer_resolved:false,execution_authorized:false,generation:owner.generation};
   const b={intent_digest:intent,request:p,result,profile_digest:c.pins.profile.sha256,skill_digest:p.skill_digest};this.k.db.prepare('INSERT INTO commerce_support_attempts VALUES(?,?,?,?,?,?,?,?,?,0)').run(s.tenant_id,s.store_id,ref,c.id,c.resource_id,owner.generation,canonical(b),contentDigest(b),this.k.clock());supportEvent(this.k,s,c.id,p.handling==='answer'?'support_answered':'handoff_requested',owner.generation,ref);return {...result,id:ref,duplicate:false};});
 }
 complete(scope:Scope,caseId:string,workflow:string,skillDigest:string,requestId:string){const ctx=this.context(scope,{case_id:caseId,workflow,skill_digest:skillDigest});return this.answer(scope,{case_id:caseId,workflow,skill_digest:skillDigest,context_digest:ctx.context_digest,fact_ids:ctx.facts.filter((f:Row)=>f.kind==='shipment').map((f:Row)=>f.id),handling:ctx.tracking.status==='available'&&ctx.tracking.shipments.length>0&&!ctx.tracking.shipments.some((s:Row)=>s.status==='unknown')?'answer':'handoff',request_id:requestId});}
}
