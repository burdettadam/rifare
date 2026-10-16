import { CommerceKernel,exact,id,integer,token } from './kernel.mts';
import type { Scope,Row } from './kernel.mts';
import { permissionDecision } from './authorization.mts';
import { canonical,contentDigest,jsonValue,returnRules,returnDecision,sourceReference,invalid } from './configuration-values.mts';

export class Policies {
  #k:CommerceKernel;
  constructor(kernel:CommerceKernel){this.#k=kernel;}
  #row(s:Row,policyId:string,version:number){
    id(policyId);integer(version,1);
    const r=this.#k.db.prepare('SELECT * FROM commerce_policy_versions WHERE tenant_id=? AND store_id=? AND policy_id=? AND version=?')
      .get(s.tenant_id,s.store_id,policyId,version) as Row;
    if(!r)throw new Error('NOT_FOUND');
    if(contentDigest(JSON.parse(r.body))!==r.digest)throw new Error('POLICY_INTEGRITY');
    return r;
  }
  #current(s:Row,policyId:string){
    id(policyId);
    const r=this.#k.db.prepare("SELECT version FROM commerce_policy_versions WHERE tenant_id=? AND store_id=? AND policy_id=? AND effective_at<=? ORDER BY effective_at DESC LIMIT 1")
      .get(s.tenant_id,s.store_id,policyId,this.#k.clock()) as Row;
    if(!r)throw new Error('POLICY_UNAVAILABLE');
    const row=this.#row(s,policyId,r.version);
    if(row.state!=='published')throw new Error('POLICY_REVOKED');
    return row;
  }
  create(scope:Scope,input:unknown){
    const k=this.#k,s=k.authorize(scope,'policy.draft'),r=exact(jsonValue(input),['policy_id','expected_version','rules','selection','sources']);
    id(r.policy_id);integer(r.expected_version);
    if(!['pin_at_request','current_at_quote'].includes(r.selection))invalid('selection','ENUM');
    if(!Array.isArray(r.sources)||!r.sources.length||r.sources.length>8)invalid('sources','COUNT');
    const body={rules:returnRules(r.rules),selection:r.selection,sources:r.sources.map(sourceReference)};
    return k.transaction(()=>{
      const old=k.db.prepare('SELECT max(version) AS version FROM commerce_policy_versions WHERE tenant_id=? AND store_id=? AND policy_id=?').get(s.tenant_id,s.store_id,r.policy_id) as Row;
      if((old.version??0)!==r.expected_version)throw new Error('POLICY_CHANGED');
      const version=r.expected_version+1;
      k.db.prepare("INSERT INTO commerce_policy_versions VALUES(?,?,?,?,?,?,?,'draft',NULL,NULL,NULL,NULL,?)")
        .run(s.tenant_id,s.store_id,r.policy_id,version,canonical(body),contentDigest(body),s.actor_id,k.clock());
      k.audit(scope,'policy_draft','allowed');return this.get(scope,r.policy_id,version);
    });
  }
  get(scope:Scope,policyId:string,version:number){const s=this.#k.authorize(scope,'policy.read');const r=this.#row(s,policyId,version);
    return {policy_id:r.policy_id,version:r.version,digest:r.digest,state:r.state,body:JSON.parse(r.body),author:r.author,reviewer:r.reviewer,effective_at:r.effective_at,execution_authorized:false};}
  test(scope:Scope,policyId:string,version:number,expectedDigest:string){
    const k=this.#k,s=k.authorize(scope,'policy.test');
    return k.transaction(()=>{
      const r=this.#row(s,policyId,version);if(r.digest!==expectedDigest)throw new Error('POLICY_CHANGED');
      if(!['draft','tested'].includes(r.state))throw new Error('POLICY_TRANSITION');
      const rules=JSON.parse(r.body).rules,at=86400000;
      const fixtures=[{id:'at_boundary',offset:rules.window_days*at,expected:true},{id:'after_boundary',offset:rules.window_days*at+1,expected:false}];
      const results=fixtures.map(f=>({...f,actual:returnDecision(rules,{delivered_at:0,requested_at:f.offset,tags:[],evidence_provided:true,outcome:rules.outcomes[0]}).eligible}));
      if(results.some(x=>x.expected!==x.actual))throw new Error('POLICY_TEST_FAILED');
      const test_digest=contentDigest({policy_digest:r.digest,results});
      k.db.prepare("UPDATE commerce_policy_versions SET state='tested',test_digest=? WHERE tenant_id=? AND store_id=? AND policy_id=? AND version=?")
        .run(test_digest,s.tenant_id,s.store_id,policyId,version);
      k.audit(scope,'policy_test','allowed');return {policy_digest:r.digest,test_digest,results,execution_authorized:false};
    });
  }
  review(scope:Scope,policyId:string,version:number,expectedDigest:string){
    const k=this.#k,s=k.authorize(scope,'policy.review');
    return k.transaction(()=>{
      const r=this.#row(s,policyId,version);
      if(r.digest!==expectedDigest)throw new Error('POLICY_CHANGED');
      if(r.state!=='tested'||!r.test_digest)throw new Error('POLICY_TRANSITION');
      if(r.author===s.actor_id)throw new Error('SELF_REVIEW_DENIED');
      const revision=permissionDecision(k.db,s,'policy.review').authority_revision;
      k.db.prepare("UPDATE commerce_policy_versions SET state='reviewed',reviewer=?,reviewer_revision=? WHERE tenant_id=? AND store_id=? AND policy_id=? AND version=?")
        .run(s.actor_id,revision,s.tenant_id,s.store_id,policyId,version);k.audit(scope,'policy_review','allowed');return this.get(scope,policyId,version);
    });
  }
  publish(scope:Scope,input:unknown){
    const k=this.#k,s=k.authorize(scope,'policy.publish'),p=exact(jsonValue(input),['policy_id','version','digest','expected_published_version','effective_at']);
    integer(p.expected_published_version);integer(p.effective_at);
    if(p.effective_at<k.clock()||p.effective_at>k.clock()+366*86400000)invalid('effective_at','RANGE');
    return k.transaction(()=>{
      const r=this.#row(s,p.policy_id,p.version);
      if(r.digest!==p.digest)throw new Error('POLICY_CHANGED');
      if(r.state!=='reviewed')throw new Error('POLICY_TRANSITION');
      const member=k.db.prepare('SELECT * FROM commerce_members WHERE tenant_id=? AND store_id=? AND actor_id=? AND active=1').get(s.tenant_id,s.store_id,r.reviewer) as Row;
      const decision=member&&permissionDecision(k.db,member,'policy.review');
      if(!decision?.allowed||decision.authority_revision!==r.reviewer_revision)throw new Error('REVIEW_AUTHORITY_CHANGED');
      const previous=k.db.prepare('SELECT max(version) AS version FROM commerce_policy_versions WHERE tenant_id=? AND store_id=? AND policy_id=? AND effective_at IS NOT NULL').get(s.tenant_id,s.store_id,p.policy_id) as Row;
      if((previous.version??0)!==p.expected_published_version||p.version<=p.expected_published_version)throw new Error('POLICY_CHANGED');
      const schedule=k.db.prepare('SELECT max(effective_at) AS at FROM commerce_policy_versions WHERE tenant_id=? AND store_id=? AND policy_id=?').get(s.tenant_id,s.store_id,p.policy_id) as Row;
      if(schedule.at!==null&&p.effective_at<=schedule.at)throw new Error('ACTIVATION_ORDER');
      const collision=k.db.prepare('SELECT 1 FROM commerce_policy_versions WHERE tenant_id=? AND store_id=? AND policy_id=? AND effective_at=?').get(s.tenant_id,s.store_id,p.policy_id,p.effective_at);
      if(collision)throw new Error('ACTIVATION_CONFLICT');
      k.db.prepare("UPDATE commerce_policy_versions SET state='published',effective_at=? WHERE tenant_id=? AND store_id=? AND policy_id=? AND version=?")
        .run(p.effective_at,s.tenant_id,s.store_id,p.policy_id,p.version);k.audit(scope,'policy_publish','allowed');return this.get(scope,p.policy_id,p.version);
    });
  }
  revoke(scope:Scope,policyId:string,version:number,expectedDigest:string){
    const k=this.#k,s=k.authorize(scope,'policy.revoke');return k.transaction(()=>{
      const r=this.#row(s,policyId,version);if(r.digest!==expectedDigest)throw new Error('POLICY_CHANGED');
      k.db.prepare("UPDATE commerce_policy_versions SET state='revoked' WHERE tenant_id=? AND store_id=? AND policy_id=? AND version=?").run(s.tenant_id,s.store_id,policyId,version);
      k.audit(scope,'policy_revoke','allowed');return {revoked:true,version};});
  }
  pin(scope:Scope,policyId:string,facts:unknown){
    const k=this.#k,s=k.authorize(scope,'policy.read'),r=this.#current(s,policyId),body=JSON.parse(r.body);
    returnDecision(body.rules,facts);const pin='pin_'+token().slice(0,32);
    k.db.prepare('INSERT INTO commerce_policy_pins VALUES(?,?,?,?,?,?,?,?)')
      .run(s.tenant_id,s.store_id,pin,policyId,r.version,body.selection,canonical(facts),s.actor_id);
    return {id:pin,policy_id:policyId,version:r.version,selection:body.selection,execution_authorized:false};
  }
  evaluatePin(scope:Scope,pinId:string){
    const k=this.#k,s=k.authorize(scope,'policy.read');id(pinId);
    const pin=k.db.prepare('SELECT * FROM commerce_policy_pins WHERE tenant_id=? AND store_id=? AND id=? AND author=?').get(s.tenant_id,s.store_id,pinId,s.actor_id) as Row;
    if(!pin)throw new Error('NOT_FOUND');
    const current=this.#current(s,pin.policy_id),original=this.#row(s,pin.policy_id,pin.version);
    if(original.state!=='published')throw new Error('POLICY_REVOKED');
    const r=pin.mode==='pin_at_request'?original:current;
    return {...returnDecision(JSON.parse(r.body).rules,JSON.parse(pin.facts)),policy_id:r.policy_id,version:r.version,policy_digest:r.digest,selection:pin.mode};
  }
}
