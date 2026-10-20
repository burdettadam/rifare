import { CommerceKernel,exact,id,integer,token,digest } from './kernel.mts';
import type { Scope,Row } from './kernel.mts';
import { CaseConfigurations } from './case-configurations.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { assertExecution,controlState,controlEvent } from './execution-stops.mts';

const WORK_ACTIONS=Object.freeze(['work.claim','resource.read','case.read','skill.read','policy.read','profile.read','capability.read','operation.read','action.propose','action.execute']);
// Separate opt-in scope for the shared return continuation API. Parent role and
// current resource permissions still apply; this list never grants an action.
const RETURN_WORK_ACTIONS=Object.freeze([...WORK_ACTIONS,'return.read','return.request','operation.dispatch','operation.reconcile']);
export const WORK_MAX_DEADLINE_MS=60000;
function duration(ms:number){integer(ms,10);if(ms>30000)throw new Error('INVALID_INPUT');return ms;}
import {loyaltyOperationRecord} from './loyalty-redemption-records.mts';
export function unresolvedEffects(k:CommerceKernel,s:Row,resource:string){
  const diagnostic=k.db.prepare("SELECT id,state FROM commerce_operations WHERE tenant_id=? AND store_id=? AND resource_id=? AND state IN ('unknown','sending') ORDER BY created_at,id")
    .all(s.tenant_id,s.store_id,resource) as Row[];
  const financial=k.db.prepare("SELECT id,state,kind AS operation_kind FROM commerce_resolution_operations WHERE tenant_id=? AND store_id=? AND resource_id=? AND state='unknown' ORDER BY observed_at,id")
    .all(s.tenant_id,s.store_id,resource) as Row[];
  return [...diagnostic.filter(row=>!loyaltyOperationRecord(k,s,row.id)),...financial.map(row=>({...row,kind:'resolution'}))];
}
export function assertCaseWorkerScope(k:CommerceKernel,scope:Scope,caseId:string,permittedOperationId?:string){
  const s=k.require(scope),identity=k.workerIdentity(scope);
  if(identity?.kind==='external_work'&&identity.case_id!==caseId)throw new Error('WORK_FENCE_REJECTED');
  const managed=k.db.prepare('SELECT * FROM commerce_case_work WHERE tenant_id=? AND store_id=? AND case_id=?').get(s.tenant_id,s.store_id,caseId) as Row;
  if(managed&&(s.role==='agent'||s.role==='worker'||identity?.kind==='external_work')){
    if(!identity||identity.kind!=='external_work'||identity.case_id!==caseId||identity.generation!==managed.generation
      ||identity.grant_hash!==managed.grant_hash||managed.state!=='active'||managed.expires_at<=k.clock()||managed.deadline_at<=k.clock())throw new Error('WORK_FENCE_REJECTED');
    assertExecution(k,s,'diagnostic.resolution.set',managed.control_stamp);
    // An already persisted send may check its own exact operation after moving
    // to unknown. Every other uncertain effect continues to block a new write.
    if(unresolvedEffects(k,s,managed.resource_id).some(row=>row.kind!=='resolution'||row.id!==permittedOperationId))throw new Error('RECONCILIATION_REQUIRED');
  }
}
export class WorkLeases {
  #k:CommerceKernel;readonly cases:CaseConfigurations;
  constructor(k:CommerceKernel){this.#k=k;this.cases=new CaseConfigurations(k);}
  issue(scope:Scope,input:unknown,audience:string){const k=this.#k,p=exact(jsonValue(input),['case_id','lifetime_ms']);id(p.case_id);integer(p.lifetime_ms,10);
    const u=new URL(audience);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||u.pathname!=='/v1/worker'||u.search||u.hash||u.username||u.password||p.lifetime_ms>300000)throw new Error('INVALID_INPUT');
    return k.transaction(()=>{
      const c=this.cases.inspect(scope,p.case_id),s=k.authorize(scope,'work.claim',c.resource_id),value='wrk_'+token(),expires=Math.min(k.clock()+p.lifetime_ms,s.expires_at);
      const count=k.db.prepare('SELECT count(*) AS n FROM commerce_worker_grants WHERE parent_session_hash=? AND revoked=0 AND expires_at>?').get(s.token_hash,k.clock()) as Row;
      if(count.n>=32)throw new Error('WORK_LIMIT');
      k.db.prepare('INSERT INTO commerce_worker_grants VALUES(?,?,?,?,?,?,?,?,0)').run(digest(value),s.tenant_id,s.store_id,c.id,s.actor_id,s.token_hash,audience,expires);
      return {token:value,audience,case_id:c.id,expires_at:expires,authorization_profile:'local_opaque_work_grant_not_oauth'};
    });
  }
  #grant(value:unknown,audience:string){
    if(typeof value!=='string'||!/^wrk_[A-Za-z0-9_-]{43}$/.test(value))throw new Error('WORK_ACCESS_DENIED');
    const g=this.#k.db.prepare('SELECT * FROM commerce_worker_grants WHERE token_hash=?').get(digest(value)) as Row;
    if(!g||g.audience!==audience||g.revoked||g.expires_at<=this.#k.clock())throw new Error('WORK_ACCESS_DENIED');return g;
  }
  #scope(g:Row,generation?:number,returnActions=false){
    const k=this.#k,c=k.db.prepare('SELECT resource_id FROM commerce_cases WHERE tenant_id=? AND store_id=? AND id=?').get(g.tenant_id,g.store_id,g.case_id) as Row;
    if(!c)throw new Error('WORK_ACCESS_DENIED');
    return k.restrictedSession(g.parent_session_hash,c.resource_id,returnActions?RETURN_WORK_ACTIONS:WORK_ACTIONS,()=>{
      const latest=k.db.prepare('SELECT revoked,expires_at FROM commerce_worker_grants WHERE token_hash=?').get(g.token_hash) as Row;
      if(!latest||latest.revoked||latest.expires_at<=k.clock())throw new Error('WORK_ACCESS_DENIED');
      if(generation!==undefined){
        const w=this.#row(g);if(!w||w.generation!==generation||w.grant_hash!==g.token_hash||w.state!=='active'||w.expires_at<=k.clock()||w.deadline_at<=k.clock())throw new Error('WORK_FENCE_REJECTED');
        const pins=k.db.prepare('SELECT cc.digest FROM commerce_cases c JOIN commerce_case_configurations cc ON cc.tenant_id=c.tenant_id AND cc.store_id=c.store_id AND cc.case_id=c.id AND cc.revision=c.revision WHERE c.tenant_id=? AND c.store_id=? AND c.id=?').get(g.tenant_id,g.store_id,g.case_id) as Row;
        if(pins?.digest!==w.configuration_digest)throw new Error('WORK_CONTEXT_CHANGED');
      }
    },{kind:'external_work',case_id:g.case_id,grant_hash:g.token_hash,generation:generation??null});
  }
  #row(g:Row){return this.#k.db.prepare('SELECT * FROM commerce_case_work WHERE tenant_id=? AND store_id=? AND case_id=?').get(g.tenant_id,g.store_id,g.case_id) as Row;}
  #view(w:Row){return {case_id:w.case_id,resource_id:w.resource_id,generation:w.generation,owner:w.owner,state:w.state,expires_at:w.expires_at,deadline_at:w.deadline_at,configuration_digest:w.configuration_digest,control_stamp:w.control_stamp};}
  authenticate(value:unknown,audience:string){const g=this.#grant(value,audience);this.#k.require(this.#scope(g));return {case_id:g.case_id};}
  claim(value:unknown,audience:string,leaseMs=10000){duration(leaseMs);const k=this.#k;
    return k.transaction(()=>{
      const g=this.#grant(value,audience),scope=this.#scope(g),c=this.cases.resume(scope,g.case_id),s=k.authorize(scope,'work.claim',c.resource_id),now=k.clock(),old=this.#row(g);
      if(old?.state==='active'&&old.expires_at>now&&old.deadline_at>now){
        if(old.grant_hash===g.token_hash)return this.#view(old);throw new Error('WORK_LEASE_HELD');
      }
      const generation=(old?.generation??0)+1,deadline=Math.min(now+WORK_MAX_DEADLINE_MS,g.expires_at);
      const control=controlState(k,s,'diagnostic.resolution.set');
      k.db.prepare(`INSERT INTO commerce_case_work VALUES(?,?,?,?,?,?,?,'active',?,?,?,?) ON CONFLICT(tenant_id,store_id,case_id) DO UPDATE SET generation=excluded.generation,owner=excluded.owner,grant_hash=excluded.grant_hash,state=excluded.state,expires_at=excluded.expires_at,deadline_at=excluded.deadline_at,configuration_digest=excluded.configuration_digest,control_stamp=excluded.control_stamp`)
        .run(s.tenant_id,s.store_id,c.id,c.resource_id,generation,s.actor_id,g.token_hash,Math.min(now+leaseMs,deadline),deadline,c.configuration_digest,control.stamp);
      controlEvent(k,s,'work_claimed',c.id,generation);return this.#view(this.#row(g));
    });
  }
  scoped(value:unknown,audience:string,generation:number){integer(generation,1);const g=this.#grant(value,audience),scope=this.#scope(g,generation);this.#k.authorize(scope,'work.claim',this.#row(g).resource_id);return {scope,grant:g,lease:this.#view(this.#row(g))};}
  returnScoped(value:unknown,audience:string,generation:number){integer(generation,1);const g=this.#grant(value,audience),scope=this.#scope(g,generation,true);this.#k.authorize(scope,'work.claim',this.#row(g).resource_id);return {scope,grant:g,lease:this.#view(this.#row(g))};}
  renew(value:unknown,audience:string,generation:number,leaseMs:number){duration(leaseMs);const k=this.#k;return k.transaction(()=>{
    const {scope,grant,lease}=this.scoped(value,audience,generation),s=k.require(scope),until=Math.min(k.clock()+leaseMs,lease.deadline_at);
    k.db.prepare('UPDATE commerce_case_work SET expires_at=? WHERE tenant_id=? AND store_id=? AND case_id=?').run(until,s.tenant_id,s.store_id,grant.case_id);
    return this.#view(this.#row(grant));
  });}
  release(scope:Scope,caseId:string){const k=this.#k;id(caseId);return k.transaction(()=>{
    const c=this.cases.inspect(scope,caseId),s=k.authorize(scope,'work.manage',c.resource_id),w=this.#row({...s,case_id:caseId});if(!w)throw new Error('NOT_FOUND');
    k.db.prepare("UPDATE commerce_case_work SET state='revoked',generation=generation+1,expires_at=? WHERE tenant_id=? AND store_id=? AND case_id=?").run(k.clock(),s.tenant_id,s.store_id,caseId);
    k.db.prepare('UPDATE commerce_worker_grants SET revoked=1 WHERE token_hash=?').run(w.grant_hash);controlEvent(k,s,'work_released',caseId,w.generation+1);return {released:true};
  });}
  complete(value:unknown,audience:string,input:unknown){const k=this.#k,p=exact(jsonValue(input),['generation','request_key','outcome','submission_id']);integer(p.generation,1);id(p.request_key);
    if(!['handoff','proposed'].includes(p.outcome)||(p.outcome==='handoff'?p.submission_id!==null:typeof p.submission_id!=='string'))throw new Error('INVALID_INPUT');
    return k.transaction(()=>{
      const g=this.#grant(value,audience),scope=this.#scope(g),s=k.require(scope),w=this.#row(g),hash=contentDigest(p);
      const old=k.db.prepare('SELECT * FROM commerce_worker_completions WHERE tenant_id=? AND store_id=? AND case_id=? AND generation=?').get(s.tenant_id,s.store_id,g.case_id,p.generation) as Row;
      if(old&&old.grant_hash===g.token_hash&&old.request_digest===hash&&w?.generation===p.generation){const b=JSON.parse(old.body);if(contentDigest(b)!==old.digest)throw new Error('WORK_RESULT_INTEGRITY');return b;}
      const live=this.scoped(value,audience,p.generation);k.authorize(live.scope,'work.claim',w.resource_id);
      if(p.outcome==='proposed'){
        const sub=k.db.prepare('SELECT 1 FROM commerce_worker_submissions WHERE tenant_id=? AND store_id=? AND id=? AND generation=? AND grant_hash=?').get(s.tenant_id,s.store_id,id(p.submission_id),p.generation,g.token_hash);
        if(!sub)throw new Error('WORK_RESULT_INVALID');
      }
      const result={case_id:g.case_id,generation:p.generation,outcome:p.outcome,submission_id:p.submission_id,completed_at:k.clock(),customer_message_sent:false,financial_effect:false};
      k.db.prepare('INSERT INTO commerce_worker_completions VALUES(?,?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,g.case_id,p.generation,g.token_hash,hash,canonical(result),contentDigest(result));
      k.db.prepare("UPDATE commerce_case_work SET state='completed' WHERE tenant_id=? AND store_id=? AND case_id=?").run(s.tenant_id,s.store_id,g.case_id);controlEvent(k,s,'work_completed',g.case_id,p.generation);return result;
    });
  }
  historical(value:unknown,audience:string){const grant=this.#grant(value,audience);return {grant,scope:this.#scope(grant)};}
}
