import { CommerceKernel,exact,id,integer } from './kernel.mts';
import type { Scope,Row } from './kernel.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { baseLayer,compileLayers } from './profile-layers.mts';
import { Profiles } from './profiles.mts';
import { Skills } from './skills.mts';
import { Policies } from './policies.mts';
import { SkillReleases } from './skill-releases.mts';
import { Capabilities } from './capabilities.mts';

export const WRITE_CONTRACT=Object.freeze({id:'rifare-synthetic-resolution',version:'1.0.0',actions:['diagnostic.resolution.set'],effect:'local_case_plan_only',external_effects:false});
export const WRITE_CONTRACT_DIGEST=contentDigest(WRITE_CONTRACT);
export class CaseConfigurations {
  #k:CommerceKernel;#skills:Skills;#profiles:Profiles;#policies:Policies;#releases:SkillReleases;
  constructor(k:CommerceKernel){this.#k=k;this.#skills=new Skills(k);this.#profiles=new Profiles(k,this.#skills);this.#policies=new Policies(k);this.#releases=new SkillReleases(k);}
  inspect(scope:Scope,caseId:string){
    const k=this.#k,s=k.require(scope);id(caseId);
    const c=k.db.prepare('SELECT * FROM commerce_cases WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,caseId) as Row;
    if(!c)throw new Error('NOT_FOUND');k.authorize(scope,'case.read',c.resource_id);const order=k.get(scope,c.resource_id);
    if(order.kind!=='order'||order.customer_id!==c.customer_id)throw new Error('CASE_CUSTOMER_CHANGED');
    const r=k.db.prepare('SELECT * FROM commerce_case_configurations WHERE tenant_id=? AND store_id=? AND case_id=? AND revision=?').get(s.tenant_id,s.store_id,c.id,c.revision) as Row;
    if(!r||contentDigest(JSON.parse(r.body))!==r.digest)throw new Error('CASE_PIN_INTEGRITY');
    const pins=JSON.parse(r.body);
    if(pins.tenant_id!==s.tenant_id||pins.store_id!==s.store_id||pins.case_id!==c.id||pins.case_revision!==c.revision||pins.customer_id!==c.customer_id||pins.resource_id!==c.resource_id)throw new Error('CASE_PIN_INTEGRITY');
    return {id:c.id,revision:c.revision,resource_id:c.resource_id,customer_id:c.customer_id,configuration_digest:r.digest,pins,order,execution_authorized:false};
  }
  #capture(scope:Scope,p:Row,revision:number){
    const k=this.#k,s=k.require(scope),order=k.get(scope,p.resource_id);
    if(order.kind!=='order'||order.source_system!=='synthetic'||!order.customer_id)throw new Error('CASE_CONTEXT_UNSUPPORTED');
    const profile=this.#profiles.get(scope,p.profile_id),policy=this.#policies.published(scope,p.policy_id);
    const selected=this.#releases.select(scope,profile.profile.skill_id,p.case_id,profile.profile.skill_digest);
    const cap=new Capabilities(k).evaluate(scope,'order.read',order.id);if(!cap.available)throw new Error('CAPABILITY_UNAVAILABLE');
    const layer={id:'published_configuration',kind:'store',revision:profile.profile.revision,tenant_id:s.tenant_id,store_id:s.store_id,
      source:{uri:'https://rifare.invalid/policies/'+policy.policy_id,revision:String(policy.version),sha256:policy.digest},values:{
        'returns.window_days':policy.body.rules.window_days,'returns.require_evidence':policy.body.rules.require_evidence,
        'returns.excluded_tags':policy.body.rules.excluded_tags,'returns.outcomes':policy.body.rules.outcomes,
        'presentation.tone':profile.profile.tone,'presentation.locale':profile.profile.locale}};
    const composition=compileLayers([baseLayer(),layer],{tenant_id:s.tenant_id,store_id:s.store_id,platform:'simulator',capabilities:['order.read']});
    return {schema_version:1,tenant_id:s.tenant_id,store_id:s.store_id,case_id:p.case_id,case_revision:revision,resource_id:order.id,customer_id:order.customer_id,
      profile:{...profile.profile,sha256:profile.sha256},policy,skill:{id:selected.bundle.id,version:selected.bundle.version,digest:selected.bundle.digest},
      activation:selected.activation,composition,adapter:{...WRITE_CONTRACT,sha256:WRITE_CONTRACT_DIGEST,connection_revision:cap.connection_revision},captured_at:k.clock()};
  }
  create(scope:Scope,input:unknown){
    const k=this.#k,s=k.require(scope),p=exact(jsonValue(input),['case_id','resource_id','profile_id','policy_id']);
    for(const v of Object.values(p))id(v);k.authorize(scope,'case.create',p.resource_id);
    return k.transaction(()=>{
      k.authorize(scope,'case.create',p.resource_id);
      if(k.db.prepare('SELECT 1 FROM commerce_cases WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,p.case_id))throw new Error('CASE_EXISTS');
      const pins=this.#capture(scope,p,1);
      k.db.prepare('INSERT INTO commerce_cases VALUES(?,?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,p.case_id,1,p.resource_id,pins.customer_id,s.role==='customer'?s.token_hash:null,s.actor_id);
      k.db.prepare('INSERT INTO commerce_case_configurations VALUES(?,?,?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,p.case_id,1,canonical(pins),contentDigest(pins),'created',s.actor_id,k.clock());
      return this.inspect(scope,p.case_id);
    });
  }
  resume(scope:Scope,caseId:string){
    const result=this.inspect(scope,caseId),p=result.pins,k=this.#k;
    this.#skills.snapshot(scope,p.skill.id,p.skill.digest);
    if(contentDigest(p.composition.effective)!==p.composition.effective_digest)throw new Error('CASE_PIN_INTEGRITY');
    const original=this.#policies.published(scope,p.policy.policy_id,p.policy.version),current=this.#policies.published(scope,p.policy.policy_id);
    if(original.digest!==p.policy.digest)throw new Error('CASE_PIN_INTEGRITY');
    if(p.policy.body.selection==='current_at_quote'&&current.digest!==original.digest)throw new Error('CONFIGURATION_REPREVIEW_REQUIRED');
    if(p.adapter.sha256!==WRITE_CONTRACT_DIGEST)throw new Error('CONFIGURATION_REPREVIEW_REQUIRED');
    const cap=new Capabilities(k).evaluate(scope,'order.read',result.resource_id);
    if(!cap.available||cap.connection_revision!==p.adapter.connection_revision)throw new Error('CONFIGURATION_REPREVIEW_REQUIRED');
    return result;
  }
  migrate(scope:Scope,caseId:string,input:unknown){
    const k=this.#k,c=this.inspect(scope,caseId),s=k.authorize(scope,'case.migrate',c.resource_id),p=exact(jsonValue(input),['expected_revision','profile_id','policy_id','reason']);
    integer(p.expected_revision,1);id(p.profile_id);id(p.policy_id);
    if(!['approved_update','revocation_recovery'].includes(p.reason))throw new Error('INVALID_INPUT');
    return k.transaction(()=>{
      k.authorize(scope,'case.migrate',c.resource_id);
      const current=this.inspect(scope,caseId);if(current.revision!==p.expected_revision)throw new Error('CASE_CHANGED');
      const revision=current.revision+1,pins=this.#capture(scope,{case_id:caseId,resource_id:current.resource_id,profile_id:p.profile_id,policy_id:p.policy_id},revision);
      k.db.prepare('INSERT INTO commerce_case_configurations VALUES(?,?,?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,caseId,revision,canonical(pins),contentDigest(pins),p.reason,s.actor_id,k.clock());
      k.db.prepare('UPDATE commerce_cases SET revision=? WHERE tenant_id=? AND store_id=? AND id=?').run(revision,s.tenant_id,s.store_id,caseId);
      return {...this.inspect(scope,caseId),requires_new_preview:true};
    });
  }
  verified(scope:Scope,caseId:string){
    const c=this.inspect(scope,caseId),s=this.#k.require(scope),k=this.#k;
    const r=k.db.prepare('SELECT ss.* FROM commerce_cases c JOIN commerce_sessions ss ON c.verification_hash=ss.token_hash WHERE c.tenant_id=? AND c.store_id=? AND c.id=?')
      .get(s.tenant_id,s.store_id,caseId) as Row;
    if(!r||r.role!=='customer'||r.revoked||r.expires_at<=k.clock()||r.last_seen<=k.clock()-900000||r.resource_id!==c.resource_id||r.customer_id!==c.customer_id||r.tenant_id!==s.tenant_id||r.store_id!==s.store_id)throw new Error('CUSTOMER_VERIFICATION_REQUIRED');
    return {customer_id:r.customer_id,resource_id:r.resource_id,expires_at:r.expires_at,identity_only_not_payment_consent:true};
  }
}
