import {exact,id,integer} from './kernel.mts';
import type {CommerceKernel,Scope,Row} from './kernel.mts';
import {canonical,contentDigest,jsonValue} from './configuration-values.mts';
import {permissionDecision} from './authorization.mts';
import {assertSupportOwner,checkedDocument,documentRow,saveDocument} from './support-core.mts';
import {assertExecution} from './execution-stops.mts';
import {assertCaseWorkerScope} from './work-leases.mts';
import {CaseConfigurations} from './case-configurations.mts';
import {DecisionResources} from './decision-resources.mts';
import {DecisionShadow,verifyRoutingDecisionReceipt} from './decision-shadow.mts';
import {SupportRules} from './support-rules.mts';
import {validateRoutingProtocol,routingIdentity,scoreRoutingProtocol,decisionHandling} from '../agent/decision-calibration.mts';

const PROTOCOL='decision_protocols',QUALIFICATION='decision_qualifications',PUBLICATION='decision_publications',ACTIVE='decision_active',CANARY='decision_canaries',RECEIPT='decision_route';
const SNAPSHOT_PINS=['profile_digest','profile_revision','profile_variant','skill_digest','question_resource_digest','question_set_digest','preprocessing_version'];
const CONFIGURATION_PINS=['catalog_digest','reader_configuration_digest','evidence_kind','provider','adapter','model_id','model_revision','serving_revision','effective_context_tokens','max_request_bytes','confidence_semantics','context_qualification'];
function freezeValue<T>(v:T):T{if(v&&typeof v==='object'){Object.values(v).forEach(freezeValue);Object.freeze(v);}return v;}
function digestCore(r:Row){const {receipt_digest,...core}=r;return core;}
function protocolStorage(p:Row){return {...p,cases:p.cases.map((r:Row)=>[r.id,r.role,r.stratum,r.source_text_hash,r.labels.reported_problem,r.labels.requested_resolution,r.expected_handling])};}
function protocolView(p:Row){return {...p,cases:p.cases.map((r:any)=>{if(!Array.isArray(r)||r.length!==7)throw new Error('ROUTING_PROTOCOL_INTEGRITY');return {id:r[0],role:r[1],stratum:r[2],source_text_hash:r[3],labels:{reported_problem:r[4],requested_resolution:r[5]},expected_handling:r[6]};})};}

/** Decision-specific qualification within the existing versioned support records.
 * Subject observations/route receipts remain owned by actual assistance tasks. */
export class DecisionRouting {
 readonly k:CommerceKernel;readonly shadow:DecisionShadow;readonly rules:SupportRules;
 #prepared=new WeakMap<object,Row>();
 constructor(k:CommerceKernel,shadow:DecisionShadow,rules:SupportRules){if(shadow.k!==k||rules.k!==k)throw new Error('ROUTING_CONFIGURATION_CHANGED');this.k=k;this.shadow=shadow;this.rules=rules;}
 #expires(at:number){integer(at,1);if(at<=this.k.clock()||at>this.k.clock()+86400000)throw new Error('ROUTING_EXPIRY_INVALID');}
 #pins(scope:Scope,caseId:string,taskId:string,configurationId:string){
  const cfg=this.shadow.configuration(scope,configurationId),snapshot=new DecisionResources(this.k,this.shadow.reads,cfg.capabilities).snapshot(scope,{case_id:caseId,task_id:taskId,serving_configuration_ref:configurationId});
  if(!cfg.enabled||snapshot.status!=='ready')throw new Error('ROUTING_CONFIGURATION_CHANGED');
  const pins:Row={task_id:'return_intake_shadow',configuration_id:cfg.id,configuration_version:cfg.version,configuration_digest:cfg.digest,capabilities_digest:contentDigest(cfg.capabilities)};
  for(const key of CONFIGURATION_PINS)pins[key]=cfg[key];for(const key of SNAPSHOT_PINS)pins[key]=(snapshot as Row)[key];
  return {pins,snapshot,cfg};
 }
 #configuration(scope:Scope,pins:Row){
  const cfg=this.shadow.configuration(scope,pins.configuration_id);
  if(!cfg.enabled||cfg.version!==pins.configuration_version||cfg.digest!==pins.configuration_digest||contentDigest(cfg.capabilities)!==pins.capabilities_digest||CONFIGURATION_PINS.some(key=>(cfg as Row)[key]!==pins[key]))throw new Error('ROUTING_CONFIGURATION_CHANGED');return cfg;
 }
 #currentPins(scope:Scope,caseId:string,taskId:string,pins:Row){const current=this.#pins(scope,caseId,taskId,pins.configuration_id);if(canonical(current.pins)!==canonical(pins))throw new Error('ROUTING_CONFIGURATION_CHANGED');return current;}
 #reviewer(s:Row,r:Row){
  const member=this.k.db.prepare('SELECT active,role FROM commerce_members WHERE tenant_id=? AND store_id=? AND actor_id=?').get(s.tenant_id,s.store_id,r.reviewer) as Row;
  const authority=member?.active?permissionDecision(this.k.db,{...s,actor_id:r.reviewer,role:member.role},'policy.review'):null;
  if(!authority?.allowed||r.author===r.reviewer||r.review_digest!==contentDigest({digest:r.digest,revision:authority.authority_revision}))throw new Error('ROUTING_REVIEW_CHANGED');
 }
 #review(scope:Scope,kind:string,ref:string,version:number,expectedDigest:string){
  const s=this.k.authorize(scope,'policy.review'),r=documentRow(this.k,s,kind,ref,version);
  if(r.state!=='draft'||r.digest!==expectedDigest||r.author===s.actor_id||r.expires_at<=this.k.clock())throw new Error('ROUTING_REVIEW_INVALID');
  const revision=permissionDecision(this.k.db,s,'policy.review').authority_revision;
  this.k.db.prepare("UPDATE commerce_support_documents SET state='active',reviewer=?,review_digest=? WHERE tenant_id=? AND store_id=? AND kind=? AND id=? AND version=?").run(s.actor_id,contentDigest({digest:r.digest,revision}),s.tenant_id,s.store_id,kind,ref,version);
  return documentRow(this.k,s,kind,ref,version);
 }
 #frozen(scope:Scope,ref:string,version:number){
  const s=this.k.require(scope),r=checkedDocument(this.k,s,PROTOCOL,ref,version);
  if(r.body.encoding!=='cohort_tuples_v1')throw new Error('ROUTING_PROTOCOL_INTEGRITY');
  const protocol=validateRoutingProtocol(protocolView(r.body.protocol));
  if(contentDigest(protocol)!==r.body.protocol_digest||routingIdentity(r.body.pins,protocol)!==r.body.qualification_identity)throw new Error('ROUTING_PROTOCOL_INTEGRITY');
  // digest remains the persisted encoding digest; the protocol is a decoded view.
  return {...r,decoded_view:true,body:{...r.body,protocol}};
 }
 freeze(scope:Scope,input:unknown){
  const p=exact(jsonValue(input,65536),['id','expected_version','case_id','task_id','configuration_id','protocol','expires_at']);id(p.id);integer(p.expected_version);this.#expires(p.expires_at);const protocol=validateRoutingProtocol(p.protocol);
  return this.k.transaction(()=>{const s=this.k.authorize(scope,'support.configure'),{pins,snapshot}=this.#pins(scope,p.case_id,p.task_id,p.configuration_id);
   if(protocol.profile_variant!==pins.profile_variant||protocol.preprocessing_version!==pins.preprocessing_version||canonical(Object.fromEntries(Object.entries(snapshot.request!.questions).map(([key,q])=>[key,Object.keys((q as Row).options)])))!==canonical(protocol.vocabulary))throw new Error('ROUTING_CONFIGURATION_CHANGED');
   saveDocument(this.k,s,PROTOCOL,p.id,p.expected_version,{encoding:'cohort_tuples_v1',protocol:protocolStorage(protocol),protocol_digest:contentDigest(protocol),pins,qualification_identity:routingIdentity(pins,protocol)},'active',p.expires_at);
   return this.#frozen(scope,p.id,p.expected_version+1);
  });
 }
 #observations(scope:Scope,frozen:Row,input:unknown,requiredIds?:string[]){
  if(!Array.isArray(input)||input.length>120)throw new Error('ROUTING_OBSERVATIONS_INVALID');
  const protocol=frozen.body.protocol,pins=frozen.body.pins,known=new Map<string,Row>(protocol.cases.map((r:Row)=>[r.id,r])),seen=new Set<string>(),receiptIds=new Set<string>(),rows:Row[]=[],digests:string[]=[],receipts:Row[]=[];
  for(const raw of input){
   const p=exact(jsonValue(raw),['id','case_id','observation_id']);id(p.id);id(p.case_id);id(p.observation_id);
   if(!known.has(p.id)||seen.has(p.id)||receiptIds.has(p.observation_id)||requiredIds&&!requiredIds.includes(p.id))throw new Error('ROUTING_OBSERVATIONS_INVALID');seen.add(p.id);receiptIds.add(p.observation_id);
   const receipt=verifyRoutingDecisionReceipt(this.shadow.read(scope,p.case_id,p.observation_id)),reference=known.get(p.id)!;
   if(receipt.observed_at<=frozen.created_at||receipt.observed_at>this.k.clock())throw new Error('ROUTING_PROTOCOL_NOT_FROZEN');
   if(receipt.submitted_text_hash!==reference.source_text_hash||SNAPSHOT_PINS.some(key=>receipt[key]!==pins[key])||receipt.configuration_id!==pins.configuration_id||receipt.configuration_version!==pins.configuration_version||receipt.configuration_digest!==pins.configuration_digest||receipt.catalog_digest!==pins.catalog_digest||receipt.provenance.reader_configuration_digest!==pins.reader_configuration_digest||receipt.provenance.transport_kind!==pins.evidence_kind)throw new Error('ROUTING_COHORT_MISMATCH');
   const result=receipt.result,partial=receipt.gaps.includes('conversation_history_partial'),handling=decisionHandling(protocol,result,protocol.calibration.diagnostic_threshold);
   // Partial history cannot qualify a route that execute must send to review.
   rows.push({id:p.id,status:partial?'unavailable':result.status==='usable'?'usable':result.reason==='DECISION_OUTPUT_INVALID'?'malformed':'unavailable',labels:partial?null:handling.labels,probability:partial?null:handling.probability});
   digests.push(contentDigest([p.id,receipt.receipt_digest]));receipts.push(receipt);
  }
  const live=receipts.filter(r=>r.provenance.transport_kind==='live_test_unqualified'&&r.provenance.live_inference_observed&&r.provenance.dispatch==='live_test_unqualified').length;
  return {rows,receipts,fixture_observations:receipts.filter(r=>r.provenance.transport_kind==='synthetic_wire_fixture').length,live_observations:live,observation_set_digest:contentDigest(digests.sort())};
 }
 measure(scope:Scope,input:unknown){
  const p=exact(jsonValue(input,32768),['id','expected_version','protocol_id','protocol_version','observations']);id(p.id);integer(p.expected_version);
  return this.k.transaction(()=>{const s=this.k.authorize(scope,'support.configure'),frozen=this.#frozen(scope,p.protocol_id,p.protocol_version);this.#configuration(scope,frozen.body.pins);
   const observations=this.#observations(scope,frozen,p.observations),scoring=scoreRoutingProtocol(frozen.body.protocol,observations.rows),live=observations.live_observations,eligible=scoring.numeric_passed&&live===frozen.body.protocol.cases.length&&observations.fixture_observations===0;
   const pending:string[]=[];if(live<frozen.body.protocol.cases.length)pending.push('approved_live_backend_observations');if(!scoring.cohort_complete)pending.push('adequate_frozen_cohort');
   const distributions=Object.fromEntries(['reported_problem','requested_resolution'].map(key=>{const samples=observations.receipts.filter((r,i)=>observations.rows[i].status==='usable').map(r=>r.result.answers[key]);return [key,{samples:samples.length,mean_selected_option_probability:samples.length?samples.reduce((n,a)=>n+a.probabilities[a.choice],0)/samples.length:null,mean_provider_confidence:samples.length?samples.reduce((n,a)=>n+a.confidence.value,0)/samples.length:null}];}));
   const report={...scoring,status:eligible?'eligible_for_review':pending.length?'pending':'measured_failure',eligible_for_scoped_routing:eligible,fixture_observations:observations.fixture_observations,live_observations:live,observation_set_digest:observations.observation_set_digest,
    pending,measured_cost:null,measured_latency:null,usage_observations:observations.receipts.filter(r=>r.result.usage!==null).length,distributions,measured_at:this.k.clock(),business_resolution_qualified:false};
   return saveDocument(this.k,s,QUALIFICATION,p.id,p.expected_version,{protocol_id:frozen.id,protocol_version:frozen.version,protocol_record_digest:frozen.digest,protocol_digest:frozen.body.protocol_digest,qualification_identity:frozen.body.qualification_identity,pins:frozen.body.pins,report},'draft',frozen.expires_at);
  });
 }
 reviewQualification(scope:Scope,ref:string,version:number,digest:string){return this.k.transaction(()=>{const s=this.k.authorize(scope,'policy.review'),q=documentRow(this.k,s,QUALIFICATION,ref,version),frozen=this.#frozen(scope,q.body.protocol_id,q.body.protocol_version);if(q.body.protocol_record_digest!==frozen.digest)throw new Error('ROUTING_PROTOCOL_INTEGRITY');this.#configuration(scope,q.body.pins);return this.#review(scope,QUALIFICATION,ref,version,digest);});}
 #qualification(scope:Scope,ref:string,version:number){
  const s=this.k.require(scope),q=checkedDocument(this.k,s,QUALIFICATION,ref,version);this.#reviewer(s,q);const frozen=this.#frozen(scope,q.body.protocol_id,q.body.protocol_version);
  if(q.body.protocol_record_digest!==frozen.digest||q.body.protocol_digest!==frozen.body.protocol_digest||q.body.qualification_identity!==frozen.body.qualification_identity||canonical(q.body.pins)!==canonical(frozen.body.pins))throw new Error('ROUTING_PROTOCOL_INTEGRITY');this.#configuration(scope,q.body.pins);
  return {q,frozen};
 }
 #canary(scope:Scope,q:Row,frozen:Row){
  const s=this.k.require(scope);let c:Row;try{c=checkedDocument(this.k,s,CANARY,q.id);}catch{return null;}
  if(c.body.qualification_digest!==q.digest||!c.body.passed||c.body.live_observations!==frozen.body.protocol.canary.case_ids.length||!Number.isSafeInteger(c.body.oldest_observation_at)||this.k.clock()-c.body.oldest_observation_at>frozen.body.protocol.canary.maximum_age_ms)return null;return c;
 }
 recordCanary(scope:Scope,input:unknown){
  const p=exact(jsonValue(input),['qualification_id','qualification_version','expected_version','observations']);integer(p.expected_version);
  return this.k.transaction(()=>{const s=this.k.authorize(scope,'support.configure'),{q,frozen}=this.#qualification(scope,p.qualification_id,p.qualification_version),ids=frozen.body.protocol.canary.case_ids,observed=this.#observations(scope,frozen,p.observations,ids),threshold=q.body.report.selected_threshold??frozen.body.protocol.calibration.diagnostic_threshold;
   const prior=this.k.db.prepare('SELECT created_at FROM commerce_support_documents WHERE tenant_id=? AND store_id=? AND kind=? AND id=? ORDER BY version DESC LIMIT 1').get(s.tenant_id,s.store_id,CANARY,q.id) as Row|undefined,newerThan=Math.max(q.body.report.measured_at,prior?.created_at??0);
   if(observed.receipts.some(r=>r.observed_at<=newerThan))throw new Error('ROUTING_CANARY_STALE');
   const passed=observed.rows.length===ids.length&&observed.rows.every(row=>{const expected=frozen.body.protocol.cases.find((r:Row)=>r.id===row.id),route=row.status==='usable'&&row.probability>=threshold&&frozen.body.protocol.permitted_routes.some((r:Row)=>canonical(r.labels)===canonical(row.labels));return row.status==='usable'&&(route?'route':'review')===expected.expected_handling&&canonical(row.labels)===canonical(expected.labels);});
   return saveDocument(this.k,s,CANARY,q.id,p.expected_version,{qualification_digest:q.digest,protocol_digest:q.body.protocol_digest,passed,live_observations:observed.live_observations,fixture_observations:observed.fixture_observations,unavailable_observations:observed.rows.filter(r=>r.status==='unavailable').length,malformed_observations:observed.rows.filter(r=>r.status==='malformed').length,observation_set_digest:observed.observation_set_digest,oldest_observation_at:observed.receipts.length?Math.min(...observed.receipts.map(r=>r.observed_at)):null},'active',Math.min(q.expires_at,this.k.clock()+frozen.body.protocol.canary.maximum_age_ms));
  });
 }
 #mode(scope:Scope,q:Row,frozen:Row,mode:string){
  if(mode==='diagnostic'){if(q.body.pins.evidence_kind!=='synthetic_wire_fixture')throw new Error('ROUTING_QUALIFICATION_PENDING');return;}
  if(mode!=='scoped'||!q.body.report.eligible_for_scoped_routing||q.body.report.fixture_observations!==0||q.body.report.live_observations!==frozen.body.protocol.cases.length)throw new Error('ROUTING_QUALIFICATION_PENDING');
  // Both current transports report serving.revision:null. Supplied revision
  // labels are configuration pins and cannot replace observed canary evidence.
  if(!this.#canary(scope,q,frozen))throw new Error('ROUTING_CANARY_PENDING');
 }
 #rulePins(scope:Scope,input:unknown){
  const p=exact(jsonValue(input),['draft_return','handoff_request']);for(const action of ['draft_return','handoff_request']){const r=this.rules.selection(scope,p[action]);if(r.body.action!==action)throw new Error('ROUTING_RULE_UNSUPPORTED');}return p;
 }
 stage(scope:Scope,input:unknown){
  const p=exact(jsonValue(input),['id','expected_version','case_id','task_id','configuration_id','qualification_id','qualification_version','mode','rules','rollout_percent','expires_at']);id(p.id);integer(p.expected_version);this.#expires(p.expires_at);
  if(![25,50,100].includes(p.rollout_percent))throw new Error('ROUTING_ROLLOUT_INVALID');
  return this.k.transaction(()=>{const s=this.k.authorize(scope,'support.configure'),{q,frozen}=this.#qualification(scope,p.qualification_id,p.qualification_version);
   if(p.configuration_id!==q.body.pins.configuration_id)throw new Error('ROUTING_CONFIGURATION_CHANGED');this.#currentPins(scope,p.case_id,p.task_id,q.body.pins);this.#mode(scope,q,frozen,p.mode);const rules=this.#rulePins(scope,p.rules);
   return saveDocument(this.k,s,PUBLICATION,p.id,p.expected_version,{qualification_id:q.id,qualification_version:q.version,qualification_digest:q.digest,qualification_identity:q.body.qualification_identity,configuration_id:p.configuration_id,mode:p.mode,rules,rollout_percent:p.rollout_percent},'draft',Math.min(p.expires_at,q.expires_at));
  });
 }
 #publication(scope:Scope,ref:string,version:number){
  const s=this.k.require(scope),publication=checkedDocument(this.k,s,PUBLICATION,ref,version);this.#reviewer(s,publication);const {q,frozen}=this.#qualification(scope,publication.body.qualification_id,publication.body.qualification_version);
  if(publication.body.qualification_digest!==q.digest||publication.body.qualification_identity!==q.body.qualification_identity||publication.body.configuration_id!==q.body.pins.configuration_id)throw new Error('ROUTING_CONFIGURATION_CHANGED');this.#mode(scope,q,frozen,publication.body.mode);this.#rulePins(scope,publication.body.rules);return {publication,q,frozen};
 }
 review(scope:Scope,ref:string,version:number,digest:string){return this.k.transaction(()=>{const s=this.k.authorize(scope,'policy.review'),p=documentRow(this.k,s,PUBLICATION,ref,version),{q,frozen}=this.#qualification(scope,p.body.qualification_id,p.body.qualification_version);if(p.body.qualification_digest!==q.digest)throw new Error('ROUTING_CONFIGURATION_CHANGED');this.#mode(scope,q,frozen,p.body.mode);this.#rulePins(scope,p.body.rules);return this.#review(scope,PUBLICATION,ref,version,digest);});}
 #activeOptional(s:Row,ref:string){const exists=this.k.db.prepare('SELECT 1 FROM commerce_support_documents WHERE tenant_id=? AND store_id=? AND kind=? AND id=?').get(s.tenant_id,s.store_id,ACTIVE,ref);return exists?documentRow(this.k,s,ACTIVE,ref):null;}
 active(scope:Scope,ref:string){const s=this.k.authorize(scope,'support.read'),r=checkedDocument(this.k,s,ACTIVE,id(ref));return freezeValue({...r,revision:r.version});}
 publish(scope:Scope,input:unknown){
  const p=exact(jsonValue(input),['id','version','expected_revision','case_id','task_id']);integer(p.expected_revision);
  return this.k.transaction(()=>{const s=this.k.authorize(scope,'support.configure'),current=this.#activeOptional(s,p.id),{publication,q}=this.#publication(scope,p.id,p.version);this.#currentPins(scope,p.case_id,p.task_id,q.body.pins);
   if((current?.version??0)!==p.expected_revision)throw new Error('ROUTING_PUBLICATION_CHANGED');const fallback=current?.state==='active'?(current.body.rollout_percent===100?current.body.primary:current.body.fallback):null;
   if(publication.body.rollout_percent<100){if(!fallback)throw new Error('ROUTING_CANARY_FALLBACK_REQUIRED');const prior=this.#publication(scope,fallback.id,fallback.version);if(prior.publication.digest!==fallback.digest)throw new Error('ROUTING_PUBLICATION_CHANGED');if(prior.publication.body.rollout_percent!==100)throw new Error('ROUTING_ROLLOUT_INVALID');this.#currentPins(scope,p.case_id,p.task_id,prior.q.body.pins);}
   const r=saveDocument(this.k,s,ACTIVE,p.id,p.expected_revision,{primary:{id:publication.id,version:publication.version,digest:publication.digest},fallback,rollout_percent:publication.body.rollout_percent,operation:'publish'},'active',publication.expires_at);
   return freezeValue({...r,revision:r.version});
  });
 }
 rollback(scope:Scope,input:unknown){
  const p=exact(jsonValue(input),['id','publication_version','expected_revision','case_id','task_id']);integer(p.expected_revision,1);
  return this.k.transaction(()=>{const s=this.k.authorize(scope,'support.configure'),current=checkedDocument(this.k,s,ACTIVE,p.id),{publication,q}=this.#publication(scope,p.id,p.publication_version);if(current.version!==p.expected_revision)throw new Error('ROUTING_PUBLICATION_CHANGED');if(publication.body.rollout_percent!==100)throw new Error('ROUTING_ROLLOUT_INVALID');this.#currentPins(scope,p.case_id,p.task_id,q.body.pins);
   const history=this.k.db.prepare('SELECT body FROM commerce_support_documents WHERE tenant_id=? AND store_id=? AND kind=? AND id=? AND version<=?').all(s.tenant_id,s.store_id,ACTIVE,p.id,current.version) as Row[];
   if(!history.some(r=>{const b=JSON.parse(r.body);return b.primary.version===publication.version&&b.primary.digest===publication.digest;}))throw new Error('ROUTING_ROLLBACK_UNPUBLISHED');
   const r=saveDocument(this.k,s,ACTIVE,p.id,p.expected_revision,{primary:{id:publication.id,version:publication.version,digest:publication.digest},fallback:current.body.rollout_percent===100?current.body.primary:current.body.fallback,rollout_percent:100,operation:'rollback'},'active',publication.expires_at);return freezeValue({...r,revision:r.version});
  });
 }
 #revoke(scope:Scope,kind:string,ref:string,version:number){return this.k.transaction(()=>{const s=this.k.authorize(scope,'support.configure');documentRow(this.k,s,kind,ref,version);this.k.db.prepare("UPDATE commerce_support_documents SET state='revoked' WHERE tenant_id=? AND store_id=? AND kind=? AND id=? AND version=?").run(s.tenant_id,s.store_id,kind,ref,version);return {revoked:true,manual_workflow_available:true};});}
 revokeQualification(scope:Scope,ref:string,version:number){return this.#revoke(scope,QUALIFICATION,ref,version);}
 revokePublication(scope:Scope,ref:string,version:number){return this.#revoke(scope,PUBLICATION,ref,version);}
 disable(scope:Scope,ref:string,revision:number){return this.#revoke(scope,ACTIVE,ref,revision);}
 #selected(scope:Scope,active:Row,caseId:string){const bucket=parseInt(contentDigest([caseId,active.body.primary.digest]).slice(0,8),16)%100,ref=bucket<active.body.rollout_percent?active.body.primary:active.body.fallback;
  if(!ref)throw new Error('ROUTING_CANARY_FALLBACK_REQUIRED');const selected=this.#publication(scope,ref.id,ref.version);if(selected.publication.digest!==ref.digest)throw new Error('ROUTING_PUBLICATION_CHANGED');if(bucket>=active.body.rollout_percent&&selected.publication.body.rollout_percent!==100)throw new Error('ROUTING_ROLLOUT_INVALID');return selected;
 }
 prepare(scope:Scope,input:unknown){
  const p=exact(jsonValue(input),['publication_id','case_id','task_id','request_id']);Object.values(p).forEach(id);const s=this.k.authorize(scope,'model.run'),ownership=assertSupportOwner(this.k,scope,p.case_id),stamp=assertExecution(this.k,s,'model.run').stamp;assertCaseWorkerScope(this.k,scope,p.case_id);
  const active=this.active(scope,p.publication_id),selected=this.#selected(scope,active,p.case_id),current=this.#currentPins(scope,p.case_id,p.task_id,selected.q.body.pins),shadowInput={case_id:p.case_id,task_id:p.task_id,configuration_id:selected.q.body.pins.configuration_id,request_id:'routing_'+contentDigest(p.request_id).slice(0,40)};
  const ref='route_'+contentDigest([s.tenant_id,s.store_id,p.case_id,p.request_id]).slice(0,40),invocation_digest=contentDigest({...p,active_digest:active.digest,active_revision:active.version}),previous=this.k.db.prepare('SELECT id FROM commerce_assistance_receipts WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,ref);
  if(previous){const old=this.read(scope,p.case_id,ref);if(old.invocation_digest!==invocation_digest)throw new Error('ROUTING_OBSERVATION_CONFLICT');}
  const handle=Object.freeze({id:ref,mode:selected.publication.body.mode,execution_authorized:false});
  this.#prepared.set(handle,{input:p,ref,invocation_digest,tenant:s.tenant_id,store:s.store_id,actor:s.actor_id,session:s.token_hash,generation:ownership.owner.generation,stamp,active_digest:active.digest,active_revision:active.version,publication_digest:selected.publication.digest,qualification_digest:selected.q.digest,snapshot:current.snapshot,shadowInput,shadowHandle:previous?null:this.shadow.prepare(scope,shadowInput),replay:!!previous});return handle;
 }
 #guard(scope:Scope,p:Row){
  const s=this.k.authorize(scope,'model.run');if(s.tenant_id!==p.tenant||s.store_id!==p.store||s.actor_id!==p.actor||s.token_hash!==p.session)throw new Error('ACCESS_DENIED');
  this.k.authorize(scope,'support.reply');assertSupportOwner(this.k,scope,p.input.case_id,p.generation,p.actor);assertCaseWorkerScope(this.k,scope,p.input.case_id);assertExecution(this.k,s,'model.run',p.stamp);
  const active=this.active(scope,p.input.publication_id);if(active.digest!==p.active_digest||active.version!==p.active_revision)throw new Error('ROUTING_PUBLICATION_CHANGED');const selected=this.#selected(scope,active,p.input.case_id);
  if(selected.publication.digest!==p.publication_digest||selected.q.digest!==p.qualification_digest)throw new Error('ROUTING_CONFIGURATION_CHANGED');const current=this.#currentPins(scope,p.input.case_id,p.input.task_id,selected.q.body.pins);
  if(current.snapshot.input_hash!==p.snapshot.input_hash||current.snapshot.evidence_hash!==p.snapshot.evidence_hash||current.snapshot.case_configuration_digest!==p.snapshot.case_configuration_digest)throw new Error('DECISION_EVIDENCE_CHANGED');return {s,active,...selected};
 }
 async execute(scope:Scope,handle:object){
  const p=this.#prepared.get(handle);if(!p)throw new Error('ROUTING_PREPARATION_INVALID');this.#prepared.delete(handle);this.#guard(scope,p);if(p.replay)return this.read(scope,p.input.case_id,p.ref);
  const observation=verifyRoutingDecisionReceipt(await this.shadow.execute(scope,p.shadowHandle));this.#guard(scope,p);
  return this.k.transaction(()=>{const {s,active,publication,q,frozen}=this.#guard(scope,p);
   if(observation.input_hash!==p.snapshot.input_hash||observation.evidence_hash!==p.snapshot.evidence_hash||observation.configuration_digest!==q.body.pins.configuration_digest)throw new Error('DECISION_EVIDENCE_CHANGED');
   const threshold=publication.body.mode==='scoped'?q.body.report.selected_threshold:frozen.body.protocol.calibration.diagnostic_threshold;let handling=decisionHandling(frozen.body.protocol,observation.result,threshold);
   if(observation.gaps.includes('conversation_history_partial'))handling={...handling,handling:'review',action:'handoff_request'};
   const rule=publication.body.rules[handling.action],job=this.rules.applySelected(scope,{rule_id:rule.id,rule_version:rule.version,rule_digest:rule.digest,case_id:p.input.case_id,event_id:p.ref,expected_generation:p.generation});
   const core={schema_version:1,kind:RECEIPT,id:p.ref,case_id:p.input.case_id,task_id:p.input.task_id,invocation_digest:p.invocation_digest,observation_id:observation.id,observation_digest:observation.receipt_digest,publication_id:publication.id,publication_version:publication.version,publication_digest:publication.digest,active_revision:active.version,qualification_digest:q.digest,configuration_id:q.body.pins.configuration_id,rule_job_id:job.id,rule_digest:rule.digest,outcome:handling.handling==='route'?'routed':'review',action:handling.action,mode:publication.body.mode,evidence_kind:observation.provenance.transport_kind,manual_workflow_available:true,business_effects:0,case_resolution_qualified:false,execution_authorized:false,observed_at:this.k.clock()};
   const receipt={...core,receipt_digest:contentDigest(core)};this.k.db.prepare('INSERT INTO commerce_assistance_receipts VALUES(?,?,?,?,?,?)').run(s.tenant_id,s.store_id,receipt.id,receipt.task_id,receipt.observed_at,canonical(receipt));return this.read(scope,p.input.case_id,p.ref);
  });
 }
 async run(scope:Scope,input:unknown){return this.execute(scope,this.prepare(scope,input));}
 read(scope:Scope,caseId:string,ref:string){
  const c=new CaseConfigurations(this.k).inspect(scope,id(caseId)),s=this.k.authorize(scope,'return.read',c.resource_id);this.k.authorize(scope,'task.read');
  const row=this.k.db.prepare('SELECT a.body,a.task_id,t.resource_id FROM commerce_assistance_receipts a JOIN commerce_context_tasks t ON a.tenant_id=t.tenant_id AND a.store_id=t.store_id AND a.task_id=t.id WHERE a.tenant_id=? AND a.store_id=? AND a.id=?').get(s.tenant_id,s.store_id,id(ref)) as Row;
  if(!row||row.resource_id!==c.resource_id)throw new Error('NOT_FOUND');const r=jsonValue(JSON.parse(row.body));
  if(r.kind!==RECEIPT||r.schema_version!==1||r.case_id!==c.id||r.task_id!==row.task_id||r.id!==ref||r.receipt_digest!==contentDigest(digestCore(r))||r.business_effects!==0||r.case_resolution_qualified!==false||r.execution_authorized!==false||!['routed','review'].includes(r.outcome)||!['draft_return','handoff_request'].includes(r.action))throw new Error('ROUTING_RECEIPT_INTEGRITY');
  const observation=this.shadow.read(scope,caseId,r.observation_id),publication=documentRow(this.k,s,PUBLICATION,r.publication_id,r.publication_version),job=this.rules.job(scope,r.rule_job_id);
  if(observation.receipt_digest!==r.observation_digest||observation.task_id!==r.task_id||observation.provenance.transport_kind!==r.evidence_kind||publication.digest!==r.publication_digest||publication.body.qualification_digest!==r.qualification_digest||publication.body.mode!==r.mode||publication.body.configuration_id!==r.configuration_id||job.case_id!==c.id||job.rule_digest!==r.rule_digest||job.state!=='completed'||job.result.kind!==r.action)throw new Error('ROUTING_RECEIPT_INTEGRITY');return freezeValue(r);
 }
 compatibility(scope:Scope,input:unknown){
  this.k.authorize(scope,'support.analytics');if(!Array.isArray(input)||input.length>16)throw new Error('ROUTING_OBSERVATIONS_INVALID');const seen=new Set<string>(),rows=input.map(raw=>{const p=exact(jsonValue(raw),['id','version']);const {q,frozen}=this.#qualification(scope,p.id,p.version);if(seen.has(q.body.pins.reader_configuration_digest))throw new Error('ROUTING_OBSERVATIONS_INVALID');seen.add(q.body.pins.reader_configuration_digest);return {q,frozen};});
  const qualified=rows.filter(({q,frozen})=>q.body.report.eligible_for_scoped_routing&&!!this.#canary(scope,q,frozen));
  const taskIdentity=({q,frozen}:Row)=>contentDigest({task:q.body.pins.task_id,questions:q.body.pins.question_set_digest,profile:q.body.pins.profile_digest,preprocessing:q.body.pins.preprocessing_version,protocol:frozen.body.protocol});
  const pairs:Row[]=[];for(let i=0;i<qualified.length;i++)for(let j=i+1;j<qualified.length;j++)if(qualified[i].q.body.pins.provider!==qualified[j].q.body.pins.provider&&taskIdentity(qualified[i])===taskIdentity(qualified[j]))pairs.push({left:qualified[i].q.body.pins.configuration_id,right:qualified[j].q.body.pins.configuration_id,comparison:'configuration_specific_held_out_gate',numerical_differences:{left:qualified[i].q.body.report.distributions,right:qualified[j].q.body.report.distributions},quality_differences:{left:qualified[i].q.body.report.held_out,right:qualified[j].q.body.report.held_out}});
  const s=this.k.require(scope),enabled=new Set<string>(),activeIds=this.k.db.prepare('SELECT id,max(version) version FROM commerce_support_documents WHERE tenant_id=? AND store_id=? AND kind=? GROUP BY id').all(s.tenant_id,s.store_id,ACTIVE) as Row[];
  for(const activeId of activeIds){try{const active=checkedDocument(this.k,s,ACTIVE,activeId.id,activeId.version),refs=[active.body.primary,...(active.body.rollout_percent<100?[active.body.fallback]:[])];for(const ref of refs){const current=this.#publication(scope,ref.id,ref.version);if(current.publication.digest===ref.digest&&current.publication.body.mode==='scoped'&&qualified.some(row=>row.q.digest===current.q.digest))enabled.add(current.q.body.pins.configuration_id);}}catch{}}
  return {implemented_transports:rows.map(({q,frozen})=>({configuration_id:q.body.pins.configuration_id,provider:q.body.pins.provider,model_id:q.body.pins.model_id,model_revision:q.body.pins.model_revision,serving_revision:q.body.pins.serving_revision,observed_serving_revision:null,effective_context_tokens:q.body.pins.effective_context_tokens,max_request_bytes:q.body.pins.max_request_bytes,confidence_semantics:q.body.pins.confidence_semantics,revision_monitoring:this.#canary(scope,q,frozen)?'current':'pending',fixture_observations:q.body.report.fixture_observations,live_observations:q.body.report.live_observations,distributions:q.body.report.distributions})),
   one_backend_scoped_routing:{qualified:enabled.size>0,configuration_ids:[...enabled],eligible_configuration_ids:qualified.map(({q})=>q.body.pins.configuration_id),publication_required:true},backend_portability:{qualified:pairs.length>0,pairs,pending:pairs.length?[]:['two_actual_backend_comparison']},self_hosted:{qualified:false,pending:['optional_self_hosted_observation']},business_resolution_qualified:false};
 }
}
