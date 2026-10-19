import {exact,id,digest} from './kernel.mts';
import type {CommerceKernel,Scope,Row} from './kernel.mts';
import {canonical,contentDigest,jsonValue} from './configuration-values.mts';
import {CaseConfigurations} from './case-configurations.mts';
import {SupportConversations} from './support-conversations.mts';
import {ReadContext} from './read-context.mts';
import type {SkillBundle} from './skills.mts';
import {validateDecisionRequest,validateDecisionCapabilities,DEFAULT_DECISION_CAPABILITIES} from '../agent/decisions.mts';
import type {DecisionCapabilities,DecisionRequest} from '../agent/decisions.mts';

export const DECISION_PREPROCESSING_VERSION='return_intake_text_v1';
const RESOURCE='references/return-intake-questions.v1.json';
const QUESTION_IDS=['reported_problem','requested_resolution'];
const bigDigest=(value:unknown)=>digest(JSON.stringify(jsonValue(value,2097152)));
const safeLabel=(value:unknown)=>typeof value==='string'&&/^[A-Za-z0-9_. -]{1,80}$/.test(value)?value:null;

/** Published vocabulary changes descriptions only. Profiles select declared
 * variants through existing typed presentation fields; answer IDs stay fixed. */
export function resolveDecisionQuestions(bundle:SkillBundle,configuration:unknown){
  const cfg=exact(jsonValue(configuration),['presentation.tone','presentation.locale']);
  const manifest=JSON.parse(bundle.files['commerce-manifest.json']);
  if(manifest.schema_version!==2||manifest.configuration.fields.slice().sort().join(',')!=='presentation.locale,presentation.tone')throw new Error('DECISION_RESOURCE_INVALID');
  const declared=manifest.resources.find((r:Row)=>r.path===RESOURCE),raw=bundle.files[RESOURCE];
  if(!declared||typeof raw!=='string'||digest(raw)!==declared.sha256)throw new Error('DECISION_RESOURCE_INVALID');
  const resource=exact(jsonValue(JSON.parse(raw)),['schema_version','id','logical_task_id','required_source_fields','required_capabilities','other_option','questions','variants']);
  if(resource.schema_version!==1||resource.logical_task_id!=='return_intake_shadow'||resource.other_option!=='other_unclear'
    ||canonical(resource.required_source_fields)!==canonical(['customer_messages','order_status'])
    ||canonical(resource.required_capabilities)!==canonical(['order.read']))throw new Error('DECISION_RESOURCE_INVALID');
  id(resource.id);exact(resource.questions,QUESTION_IDS);
  if(!Array.isArray(resource.variants)||!resource.variants.length||resource.variants.length>9)throw new Error('DECISION_RESOURCE_INVALID');
  const seen=new Set<string>();let selected:Row|undefined;
  for(const variant of resource.variants){
    exact(variant,['id','match','vocabulary']);id(variant.id);exact(variant.match,['presentation.tone','presentation.locale']);
    const key=canonical(variant.match);if(seen.has(key))throw new Error('DECISION_RESOURCE_INVALID');seen.add(key);
    if(!['neutral','warm','formal'].includes(variant.match['presentation.tone'])||!['en-US','en-GB','fr-CA'].includes(variant.match['presentation.locale']))throw new Error('DECISION_RESOURCE_INVALID');
    for(const [question,overrides] of Object.entries(variant.vocabulary) as [string,Row][]){
      if(!QUESTION_IDS.includes(question)||!overrides||Array.isArray(overrides)||typeof overrides!=='object')throw new Error('DECISION_VOCABULARY_OVERRIDE_DENIED');
      for(const [option,description] of Object.entries(overrides))if(!Object.hasOwn(resource.questions[question].options,option)||typeof description!=='string'||!description.trim()||description.length>4096)throw new Error('DECISION_VOCABULARY_OVERRIDE_DENIED');
    }
    if(key===canonical(cfg))selected=variant;
  }
  if(!selected)throw new Error('DECISION_PROFILE_UNAVAILABLE');
  const questions=structuredClone(resource.questions);
  for(const qid of QUESTION_IDS){
    const question=questions[qid];if(question.type!=='choice'||!Object.hasOwn(question.options,'other_unclear'))throw new Error('DECISION_RESOURCE_INVALID');
    const expected=qid==='reported_problem'?['damaged','other_unclear','size_fit']:['exchange','other_unclear','refund'];
    if(Object.keys(question.options).sort().join(',')!==expected.join(','))throw new Error('DECISION_RESOURCE_INVALID');
    Object.assign(question.options,selected.vocabulary[qid]??{});
  }
  const question_set_digest=contentDigest({resource_digest:declared.sha256,variant:selected.id,questions});
  validateDecisionRequest({task_id:resource.logical_task_id,question_set_id:resource.id,question_set_digest,serving_configuration_ref:'validation_only',state:'Resource schema validation.',questions});
  return {question_set_id:resource.id,logical_task_id:resource.logical_task_id,question_set_digest,question_resource_digest:declared.sha256,profile_variant:selected.id,questions,required_source_fields:resource.required_source_fields,required_capabilities:resource.required_capabilities};
}

export class DecisionResources {
  readonly k:CommerceKernel;readonly reads:ReadContext;readonly capabilities:DecisionCapabilities;
  constructor(k:CommerceKernel,reads:ReadContext,capabilities:DecisionCapabilities=DEFAULT_DECISION_CAPABILITIES){this.k=k;this.reads=reads;this.capabilities=validateDecisionCapabilities(capabilities);}
  snapshot(scope:Scope,input:unknown){
    const p=exact(jsonValue(input),['case_id','task_id','serving_configuration_ref']);for(const v of Object.values(p))id(v);
    const k=this.k,c=new CaseConfigurations(k).resume(scope,p.case_id),s=k.authorize(scope,'return.read',c.resource_id);
    const task=this.reads.task(scope,p.task_id);this.reads.profiles.permit(scope,task.profile.id,'skill.read');
    if(task.order_id!==c.resource_id||task.profile.id!==c.pins.profile.id||task.profile.revision!==c.pins.profile.revision
      ||task.profile.skill_digest!==c.pins.skill.digest||task.skill.bundle_digest!==c.pins.skill.digest)throw new Error('DECISION_TASK_CONTEXT_CHANGED');
    const bundle=this.reads.skills.snapshot(scope,c.pins.skill.id,c.pins.skill.digest);
    const effective=c.pins.composition.effective;
    if(effective['presentation.tone']!==task.profile.tone||effective['presentation.locale']!==task.profile.locale)throw new Error('DECISION_TASK_CONTEXT_CHANGED');
    const resolved=resolveDecisionQuestions(bundle,{'presentation.tone':effective['presentation.tone'],'presentation.locale':effective['presentation.locale']});
    const history=new SupportConversations(k).history(scope,c.id,0,100),messages=history.messages.filter((m:Row)=>m.direction==='incoming'&&m.visibility==='public');
    const gaps:string[]=[];if(!history.history_complete)gaps.push('conversation_history_partial');
    if(history.next_cursor!==null)gaps.push('required_message_window_exceeded');if(!messages.length)gaps.push('customer_messages_unavailable');
    const facts=task.facts,source=facts.source??null,age=effective['data.max_age_seconds']*1000;
    const fresh=source&&Number.isSafeInteger(source.observed_at)&&source.observed_at<=k.clock()&&k.clock()-source.observed_at<=age;
    const status=fresh?safeLabel(facts.order?.fulfillment_status):null;
    if(!status)gaps.push(fresh?'order_status_unavailable':'order_source_stale_or_unavailable');
    const shipmentsAvailable=fresh&&facts.order?.shipments_status==='scoped_fixture_snapshot';
    if(!shipmentsAvailable)gaps.push('shipment_status_unavailable');
    const state={preprocessing_version:DECISION_PREPROCESSING_VERSION,
      customer_claims:{authority:'reported_unverified',messages:messages.map((m:Row)=>m.text)},
      source_facts:{order_status:{availability:status?'observed':'unavailable',value:status,evidence_kind:source?.evidence_kind??'unavailable'},
        shipment_status:{availability:shipmentsAvailable?'observed':'unavailable',values:shipmentsAvailable?facts.order.shipments.map((x:Row)=>safeLabel(x.delivery_state)).filter(Boolean):[]}},gaps};
    // This complete bounded history is hashed before applying the much smaller
    // serving bound. A larger history is explicitly unavailable, never a prefix.
    const stateText=JSON.stringify(jsonValue(state,2097152));
    const request:DecisionRequest={task_id:resolved.logical_task_id,question_set_id:resolved.question_set_id,question_set_digest:resolved.question_set_digest,
      serving_configuration_ref:p.serving_configuration_ref,state:stateText,questions:resolved.questions};
    const evidence={case_configuration:c.configuration_digest,case_revision:c.revision,profile:c.pins.profile.sha256,task_id:task.id,task_expires_at:task.expires_at,
      skill_digest:bundle.digest,composition:c.pins.composition.effective_digest,order_source_digest:contentDigest(c.order),
      conversation_links:history.links,customer_message_refs:messages.map((m:Row)=>({id:m.id,source_at:m.source_at,observed_at:m.observed_at,text_sha256:digest(m.text)})),
      question_resource_digest:resolved.question_resource_digest,question_set_digest:resolved.question_set_digest,preprocessing_version:DECISION_PREPROCESSING_VERSION,gaps};
    const common={case_id:c.id,task_id:task.id,resource_id:c.resource_id,case_configuration_digest:c.configuration_digest,profile_digest:c.pins.profile.sha256,profile_revision:task.profile.revision,
      skill_digest:bundle.digest,question_resource_digest:resolved.question_resource_digest,question_set_digest:resolved.question_set_digest,profile_variant:resolved.profile_variant,
      preprocessing_version:DECISION_PREPROCESSING_VERSION,input_hash:history.next_cursor===null?bigDigest(request):null,submitted_text_hash:history.next_cursor===null?digest(stateText):null,
      evidence_hash:bigDigest(evidence),claims_digest:history.next_cursor===null?bigDigest({customer_messages:messages.map((m:Row)=>m.text),profile_variant:resolved.profile_variant}):null,
      gaps,encoded_request_bytes:Buffer.byteLength(JSON.stringify(request)),truncated:false as const};
    if(history.next_cursor!==null||!messages.length||!status)return {...common,status:'unavailable' as const,reason:history.next_cursor!==null?'DECISION_CONTEXT_LIMIT':'DECISION_EVIDENCE_CHANGED',request:null};
    try{return {...common,status:'ready' as const,reason:null,request:validateDecisionRequest(request,this.capabilities)};}
    catch(error){if(error instanceof Error&&['DECISION_CONTEXT_LIMIT','DECISION_CAPABILITY_UNAVAILABLE'].includes(error.message))return {...common,status:'unavailable' as const,reason:error.message,request:null};throw error;}
  }
}
