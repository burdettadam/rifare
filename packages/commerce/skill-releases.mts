import { CommerceKernel,exact,id,integer,token,digest } from './kernel.mts';
import type { Scope,Row } from './kernel.mts';
import { Skills } from './skills.mts';
import { jsonValue,contentDigest } from './configuration-values.mts';
import { permissionDecision } from './authorization.mts';

export class SkillReleases {
  #k:CommerceKernel;#skills:Skills;
  constructor(kernel:CommerceKernel){this.#k=kernel;this.#skills=new Skills(kernel);}
  #row(scope:Scope,releaseId:string):Row {
    const s=this.#k.authorize(scope,'skill.read');id(releaseId);
    const r=this.#k.db.prepare('SELECT * FROM commerce_skill_releases WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,releaseId) as Row;
    if(!r)throw new Error('NOT_FOUND');
    const b=this.#skills.snapshot(scope,r.skill_id,r.bundle_digest);
    if(r.state!=='draft'&&r.test_digest!==contentDigest(this.#evaluation(r,b)))throw new Error('RELEASE_INTEGRITY');
    return r;
  }
  #evaluation(r:Row,b:any){return {release_id:r.id,author:r.author,bundle_digest:b.digest,rollout_percent:r.rollout_percent,resource_count:Object.keys(b.files).length,validation:'instruction_contract_only',model_quality_qualified:false};}
  get(scope:Scope,releaseId:string){const r=this.#row(scope,releaseId);return {...r,execution_authorized:false};}
  stage(scope:Scope,input:unknown){
    const k=this.#k,s=k.authorize(scope,'skill.stage'),r=exact(jsonValue(input),['skill_id','bundle_digest','rollout_percent']);
    integer(r.rollout_percent,1);if(r.rollout_percent>100)throw new Error('INVALID_INPUT');
    const b=this.#skills.snapshot(scope,id(r.skill_id),r.bundle_digest),ref='rel_'+token().slice(0,32);
    k.db.prepare("INSERT INTO commerce_skill_releases VALUES(?,?,?,?,?,?,?,'draft',NULL,NULL,NULL,?)").run(s.tenant_id,s.store_id,ref,b.id,b.digest,r.rollout_percent,s.actor_id,k.clock());
    return this.get(scope,ref);
  }
  evaluate(scope:Scope,releaseId:string){
    const k=this.#k;k.authorize(scope,'skill.evaluate');const r=this.#row(scope,releaseId);
    if(!['draft','evaluated'].includes(r.state))throw new Error('RELEASE_TRANSITION');
    const b=this.#skills.snapshot(scope,r.skill_id,r.bundle_digest);
    const result=this.#evaluation(r,b);
    k.db.prepare("UPDATE commerce_skill_releases SET state='evaluated',test_digest=? WHERE tenant_id=? AND store_id=? AND id=?").run(contentDigest(result),r.tenant_id,r.store_id,r.id);
    return {...result,test_digest:contentDigest(result)};
  }
  review(scope:Scope,input:unknown){
    const k=this.#k,s=k.authorize(scope,'skill.review'),p=exact(jsonValue(input),['release_id','test_digest','rollout_percent']);
    return k.transaction(()=>{
      k.authorize(scope,'skill.review');
      const r=this.#row(scope,p.release_id);
      if(r.author===s.actor_id)throw new Error('SELF_REVIEW_DENIED');
      if(r.state!=='evaluated'||r.test_digest!==p.test_digest||r.rollout_percent!==p.rollout_percent)throw new Error('RELEASE_TRANSITION');
      k.db.prepare("UPDATE commerce_skill_releases SET state='reviewed',reviewer=?,reviewer_revision=? WHERE tenant_id=? AND store_id=? AND id=?")
        .run(s.actor_id,permissionDecision(k.db,s,'skill.review').authority_revision,s.tenant_id,s.store_id,r.id);
      return this.get(scope,r.id);
    });
  }
  #reviewCurrent(r:Row){
    const m=this.#k.db.prepare('SELECT * FROM commerce_members WHERE tenant_id=? AND store_id=? AND actor_id=? AND active=1').get(r.tenant_id,r.store_id,r.reviewer) as Row;
    const d=m&&permissionDecision(this.#k.db,m,'skill.review');
    if(!d?.allowed||d.authority_revision!==r.reviewer_revision)throw new Error('REVIEW_AUTHORITY_CHANGED');
  }
  publish(scope:Scope,input:unknown){
    const k=this.#k,s=k.authorize(scope,'skill.publish'),p=exact(jsonValue(input),['release_id','expected_revision','rollout_percent']);integer(p.expected_revision);
    return k.transaction(()=>{
      k.authorize(scope,'skill.publish');
      const r=this.#row(scope,p.release_id);if(r.state!=='reviewed'||r.rollout_percent!==p.rollout_percent)throw new Error('RELEASE_TRANSITION');this.#reviewCurrent(r);
      const active=k.db.prepare('SELECT * FROM commerce_skill_activation WHERE tenant_id=? AND store_id=? AND skill_id=?').get(s.tenant_id,s.store_id,r.skill_id) as Row;
      if((active?.revision??0)!==p.expected_revision)throw new Error('ACTIVATION_CHANGED');
      if(r.rollout_percent<100){if(!active)throw new Error('CANARY_FALLBACK_REQUIRED');const old=this.#row(scope,active.release_id);if(old.rollout_percent!==100||active.fallback_id)throw new Error('CANARY_FALLBACK_REQUIRED');}
      const fallback=r.rollout_percent<100?active.release_id:null;
      k.db.prepare("UPDATE commerce_skill_releases SET state='published' WHERE tenant_id=? AND store_id=? AND id=?").run(s.tenant_id,s.store_id,r.id);
      this.#activate(s,r,p.expected_revision+1,fallback,'publish');return this.active(scope,r.skill_id);
    });
  }
  #activate(s:Row,r:Row,revision:number,fallback:string|null,operation:string){
    const db=this.#k.db;
    db.prepare(`INSERT INTO commerce_skill_activation VALUES(?,?,?,?,?,?) ON CONFLICT(tenant_id,store_id,skill_id)
      DO UPDATE SET revision=excluded.revision,release_id=excluded.release_id,fallback_id=excluded.fallback_id`).run(s.tenant_id,s.store_id,r.skill_id,revision,r.id,fallback);
    db.prepare('INSERT INTO commerce_skill_activation_log VALUES(?,?,?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,r.skill_id,revision,r.id,fallback,operation,s.actor_id,this.#k.clock());
  }
  rollback(scope:Scope,input:unknown){
    const k=this.#k,s=k.authorize(scope,'skill.publish'),p=exact(jsonValue(input),['skill_id','target_release_id','expected_revision']);integer(p.expected_revision,1);
    return k.transaction(()=>{
      k.authorize(scope,'skill.publish');
      const current=this.active(scope,id(p.skill_id)),target=this.#row(scope,p.target_release_id);
      if(current.revision!==p.expected_revision)throw new Error('ACTIVATION_CHANGED');
      if(target.skill_id!==p.skill_id||target.state!=='published'||target.rollout_percent!==100)throw new Error('ROLLBACK_TARGET_INVALID');this.#reviewCurrent(target);
      const previous=k.db.prepare('SELECT 1 FROM commerce_skill_activation_log WHERE tenant_id=? AND store_id=? AND skill_id=? AND release_id=? AND revision<?').get(s.tenant_id,s.store_id,p.skill_id,target.id,current.revision);
      if(!previous)throw new Error('ROLLBACK_TARGET_INVALID');
      this.#activate(s,target,current.revision+1,null,'rollback');return this.active(scope,p.skill_id);
    });
  }
  active(scope:Scope,skillId:string){const s=this.#k.authorize(scope,'skill.read');id(skillId);
    return this.#k.db.prepare('SELECT * FROM commerce_skill_activation WHERE tenant_id=? AND store_id=? AND skill_id=?').get(s.tenant_id,s.store_id,skillId) as Row|undefined;}
  select(scope:Scope,skillId:string,caseId:string,defaultDigest:string){
    id(caseId);const a=this.active(scope,skillId);
    if(!a){const b=this.#skills.snapshot(scope,skillId,defaultDigest);return {bundle:b,activation:{revision:0,release_id:null,mode:'explicit_profile',bucket:null}};}
    const primary=this.#row(scope,a.release_id);if(primary.state!=='published')throw new Error('RELEASE_TRANSITION');
    const s=this.#k.require(scope),bucket=Number.parseInt(digest(JSON.stringify([s.tenant_id,s.store_id,skillId,caseId,a.revision])).slice(0,8),16)%100;
    const selected=bucket<primary.rollout_percent?primary:this.#row(scope,a.fallback_id);
    if(selected.state!=='published')throw new Error('RELEASE_TRANSITION');
    return {bundle:this.#skills.snapshot(scope,skillId,selected.bundle_digest),activation:{revision:a.revision,release_id:selected.id,mode:selected.id===primary.id?'primary':'canary_fallback',bucket}};
  }
  revoke(scope:Scope,input:unknown){
    const k=this.#k,s=k.authorize(scope,'skill.revoke'),p=exact(jsonValue(input),['skill_id','bundle_digest']);
    // Revocation is idempotent and remains independent of active publication pointers.
    id(p.skill_id);if(typeof p.bundle_digest!=='string'||!/^[a-f0-9]{64}$/.test(p.bundle_digest))throw new Error('INVALID_INPUT');
    if(!k.db.prepare('SELECT 1 FROM commerce_skill_archive WHERE tenant_id=? AND store_id=? AND skill_id=? AND bundle_digest=?').get(s.tenant_id,s.store_id,p.skill_id,p.bundle_digest))throw new Error('NOT_FOUND');
    k.db.prepare('INSERT OR IGNORE INTO commerce_skill_revocations VALUES(?,?,?,?,?,?)').run(s.tenant_id,s.store_id,p.skill_id,p.bundle_digest,s.actor_id,k.clock());
    return {revoked:true,skill_id:p.skill_id,bundle_digest:p.bundle_digest};
  }
}
