import {exact,id,integer} from './kernel.mts';
import type {CommerceKernel,Scope,Row} from './kernel.mts';
import {canonical,contentDigest,jsonValue,stringSet} from './configuration-values.mts';
import {Profiles} from './profiles.mts';
import {Skills} from './skills.mts';
import {Policies} from './policies.mts';
import {Capabilities} from './capabilities.mts';
import {CaseConfigurations} from './case-configurations.mts';
import {intakeEvaluation} from './return-intake-core.mts';

type DestinationReader={evaluate:(scope:Scope,input:unknown)=>Row};

/** A versioned review of existing published configuration. A pack never activates
 * policy, grants an action, or creates a second eligibility engine. */
export class ReturnPolicyPacks {
 readonly k:CommerceKernel;readonly caps:Capabilities;
 readonly destinations:DestinationReader|null;
 constructor(k:CommerceKernel,caps:Capabilities,destinations:DestinationReader|null=null){this.k=k;this.caps=caps;this.destinations=destinations;}
 #row(s:Row,packId:string,revision?:number){
  id(packId);if(revision!==undefined)integer(revision,1);
  const row=this.k.db.prepare('SELECT * FROM commerce_return_policy_packs WHERE tenant_id=? AND store_id=? AND id=?'+(revision===undefined?' ORDER BY revision DESC LIMIT 1':' AND revision=?'))
   .get(s.tenant_id,s.store_id,packId,...(revision===undefined?[]:[revision])) as Row;
  if(!row)throw new Error('NOT_FOUND');
  const pack=JSON.parse(row.body);if(contentDigest(pack)!==row.digest||pack.tenant_id!==s.tenant_id||pack.store_id!==s.store_id||pack.id!==row.id||pack.revision!==row.revision)throw new Error('PACK_INTEGRITY');
  return {...row,pack};
 }
 put(scope:Scope,input:unknown){
  const k=this.k,s=k.authorize(scope,'action.configure'),p=exact(jsonValue(input),['id','expected_revision','profile_id','policy_id','required_capabilities','routing','review']);
  id(p.id);id(p.profile_id);id(p.policy_id);integer(p.expected_revision);
  const required_capabilities=stringSet(p.required_capabilities,'required_capabilities'),routing=exact(p.routing,['required','allowed_destination_ids']),review=exact(p.review,['mode','always_review']);
  const destinationIds=stringSet(routing.allowed_destination_ids,'routing.allowed_destination_ids');destinationIds.forEach(id);
  if(typeof routing.required!=='boolean'||routing.required&&!destinationIds.length)throw new Error('PACK_ROUTING_INVALID');
  if(!['standard','specialist','policy_exception'].includes(review.mode)||typeof review.always_review!=='boolean')throw new Error('PACK_REVIEW_INVALID');
  return k.transaction(()=>{
   k.authorize(scope,'action.configure');
   const old=k.db.prepare('SELECT max(revision) revision FROM commerce_return_policy_packs WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,p.id) as Row;
   if((old.revision??0)!==p.expected_revision)throw new Error('PACK_CHANGED');
   const skills=new Skills(k),profile=new Profiles(k,skills).get(scope,p.profile_id),policy=new Policies(k).published(scope,p.policy_id),skill=skills.snapshot(scope,profile.profile.skill_id,profile.profile.skill_digest);
   const pack={schema_version:1,id:p.id,revision:p.expected_revision+1,tenant_id:s.tenant_id,store_id:s.store_id,
    profile:{id:profile.profile.id,revision:profile.profile.revision,sha256:profile.sha256},policy,
    skill:{id:skill.id,version:skill.version,digest:skill.digest},presentation:{tone:profile.profile.tone,locale:profile.profile.locale},
    required_capabilities,routing:{required:routing.required,allowed_destination_ids:destinationIds},review,
    authority:'evaluation_and_restrictions_only'};
   k.db.prepare('INSERT INTO commerce_return_policy_packs VALUES(?,?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,p.id,pack.revision,canonical(pack),contentDigest(pack),s.actor_id,k.clock());
   k.audit(scope,'return_pack_record','allowed');return this.get(scope,p.id);
  });
 }
 get(scope:Scope,packId:string,revision?:number){
  const k=this.k,s=k.authorize(scope,'profile.read');k.require(scope,['operator','reviewer']);const r=this.#row(s,packId,revision);
  return {id:r.id,revision:r.revision,digest:r.digest,pack:r.pack,activation:'none',execution_authorized:false};
 }
 evaluate(scope:Scope,input:unknown){
  const p=exact(jsonValue(input),['pack_id','selection','request_id']);id(p.pack_id);if(p.request_id!==null)id(p.request_id);
  const k=this.k,s=k.require(scope),c=new CaseConfigurations(k).resume(scope,id(p.selection?.case_id));k.authorize(scope,'return.read',c.resource_id);
  const r=this.#row(s,p.pack_id),pack=r.pack,skills=new Skills(k),profile=new Profiles(k,skills).get(scope,pack.profile.id);
  if(profile.sha256!==pack.profile.sha256)throw new Error('PACK_PROFILE_CHANGED');
  skills.snapshot(scope,pack.skill.id,pack.skill.digest);
  const policy=new Policies(k).published(scope,pack.policy.policy_id,pack.policy.version);
  if(policy.digest!==pack.policy.digest)throw new Error('PACK_INTEGRITY');
  if(c.pins.policy.digest!==pack.policy.digest||c.pins.profile.sha256!==pack.profile.sha256||c.pins.skill.digest!==pack.skill.digest)throw new Error('PACK_CASE_MISMATCH');
  const current=intakeEvaluation(k,scope,p.selection,k.clock());
  let route:Row={state:pack.routing.required?'return_request_required':'optional',eligible:[],selected:null};
  if(p.request_id!==null){
   const request=k.db.prepare('SELECT case_id,resource_id FROM commerce_return_requests WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,p.request_id) as Row;
   if(!request||request.case_id!==c.id||request.resource_id!==c.resource_id)throw new Error('PACK_REQUEST_MISMATCH');
   route=this.destinations?this.destinations.evaluate(scope,{request_id:p.request_id}):{state:'destination_source_unavailable',eligible:[],selected:null};
  }
  const candidates=Array.isArray(route.eligible)?route.eligible:[];
  const eligible=candidates.filter((d:Row)=>pack.routing.allowed_destination_ids.includes(d.destination_id??d.id));
  const routeReady=eligible.length>0;
  const requirements=[...new Set([...pack.required_capabilities,...(pack.routing.required?['return.destination']:[])])].sort();
  const missing=requirements.filter(action=>action==='return.destination'?!routeReady:!this.caps.evaluate(scope,action,action==='order.read'?c.resource_id:undefined).available);
  return {pack_id:r.id,pack_revision:r.revision,pack_digest:r.digest,case_id:c.id,configuration_digest:c.configuration_digest,
   policy_digest:policy.digest,skill_digest:pack.skill.digest,effective_digest:c.pins.composition.effective_digest,
   presentation:pack.presentation,eligibility:current.decision,
   review:{...pack.review,reviewer_recommended:pack.review.always_review||current.decision.decision==='review',authority:'existing_scoped_reviewer_only'},
   routing:{...pack.routing,state:route.state??(routeReady?'qualified_candidates':'manual_review'),eligible,source_snapshot:route.snapshot_digest??null},
   readiness:{ready:missing.length===0,missing_capabilities:missing},source_version:current.source_version,source_digest:current.source_digest,
   action_approval:'separate_reviewer_required',activation:'none',execution_authorized:false,financial_effect:false,production_qualified:false};
 }
}
