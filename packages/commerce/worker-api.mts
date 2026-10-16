import { CommerceKernel,exact,id,integer,token } from './kernel.mts';
import type { Row } from './kernel.mts';
import { WorkLeases,unresolvedEffects } from './work-leases.mts';
import { ActionGateway } from './action-gateway.mts';
import { Skills } from './skills.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { BusinessOperations } from './operation-store.mts';
import { controlState } from './execution-stops.mts';
import { recordSecurity } from './authorization.mts';

export class WorkerApi {
  #k:CommerceKernel;readonly leases:WorkLeases;readonly gateway:ActionGateway;
  constructor(k:CommerceKernel){this.#k=k;this.leases=new WorkLeases(k);this.gateway=new ActionGateway(k);}
  context(value:unknown,audience:string,generation:number){
    const {scope,grant,lease}=this.leases.scoped(value,audience,generation),c=this.leases.cases.resume(scope,grant.case_id),s=this.#k.require(scope);
    const skill=new Skills(this.#k).snapshot(scope,c.pins.skill.id,c.pins.skill.digest);
    // Only selected operational facts are exported; no raw customer payload or private thread.
    const body=c.order.payload,facts={resource_id:c.resource_id,status:typeof body.status==='string'?body.status:null,
      total_minor:body.total_minor??null,currency:body.currency??null,source_version:c.order.source_version,observed_at:c.order.observed_at};
    return {schema_version:1,envelope:{tenant_id:s.tenant_id,store_id:s.store_id,case_id:c.id,resource_id:c.resource_id,audience,generation,
        configuration_digest:c.configuration_digest,control_stamp:lease.control_stamp},lease,
      effective_skill:{id:skill.id,version:skill.version,digest:skill.digest,files:skill.files},
      configuration:{profile:c.pins.profile,policy:c.pins.policy,settings:c.pins.composition.effective},facts,
      blockers:unresolvedEffects(this.#k,s,c.resource_id),controls:controlState(this.#k,s,'diagnostic.resolution.set'),
      allowed_actions:['proposal.prepare','proposal.result','work.complete'],execution_authorized:false};
  }
  #envelope(value:unknown,audience:string,p:Row){
    const current=this.context(value,audience,p.generation);
    exact(p.envelope,Object.keys(current.envelope));
    if(contentDigest(p.envelope)!==contentDigest(current.envelope))throw new Error('WORK_ENVELOPE_REJECTED');return current;
  }
  #denied(value:unknown,audience:string){try{const {scope}=this.leases.historical(value,audience),s=this.#k.require(scope);recordSecurity(this.#k.db,s,'worker_submission','denied',this.#k.clock());}catch{/* Invalid tokens reveal no target. */}}
  submit(value:unknown,audience:string,input:unknown){const k=this.#k;
    try{return k.transaction(()=>{
      const p=exact(jsonValue(input),['generation','envelope','request_key','proposal']);integer(p.generation,1);id(p.request_key);
      const c=this.#envelope(value,audience,p),{scope,grant}=this.leases.scoped(value,audience,p.generation),s=k.require(scope),hash=contentDigest(p);
      const old=k.db.prepare('SELECT * FROM commerce_worker_submissions WHERE grant_hash=? AND generation=? AND request_key=?').get(grant.token_hash,p.generation,p.request_key) as Row;
      if(old){if(old.request_digest!==hash)throw new Error('WORK_IDEMPOTENCY_CONFLICT');return this.#body(old);}
      const a=exact(p.proposal,['action','arguments']),result=this.gateway.prepare(scope,{case_id:c.envelope.case_id,action:a.action,arguments:a.arguments});
      const response={id:'submission_'+token().slice(0,24),generation:p.generation,case_id:grant.case_id,decision:'approval_required',preview:result,financial_effect:false};
      k.db.prepare('INSERT INTO commerce_worker_submissions VALUES(?,?,?,?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,response.id,grant.case_id,p.generation,grant.token_hash,p.request_key,hash,canonical(response),contentDigest(response));return response;
    });}catch(error){this.#denied(value,audience);throw error;}
  }
  #body(row:Row){const b=JSON.parse(row.body);if(contentDigest(b)!==row.digest)throw new Error('WORK_RESULT_INTEGRITY');return b;}
  #submission(value:unknown,audience:string,submissionId:string){
    const {scope,grant}=this.leases.historical(value,audience),s=this.#k.require(scope);id(submissionId);
    const row=this.#k.db.prepare('SELECT * FROM commerce_worker_submissions WHERE tenant_id=? AND store_id=? AND id=? AND grant_hash=?').get(s.tenant_id,s.store_id,submissionId,grant.token_hash) as Row;
    if(!row)throw new Error('NOT_FOUND');const c=this.leases.cases.inspect(scope,grant.case_id);this.#k.authorize(scope,'resource.read',c.resource_id);return {row,scope,grant,s,result:this.#body(row)};
  }
  result(value:unknown,audience:string,submissionId:string){const r=this.#submission(value,audience,submissionId),k=this.#k;
    const effect=k.db.prepare('SELECT * FROM commerce_worker_effects WHERE tenant_id=? AND store_id=? AND submission_id=?').get(r.s.tenant_id,r.s.store_id,submissionId) as Row;
    return {submission:r.result,execution:effect?this.#body(effect):null};
  }
  execute(value:unknown,audience:string,input:unknown){const k=this.#k;
    try{return k.transaction(()=>{
      const p=exact(jsonValue(input),['generation','envelope','submission_id','approval_id']);integer(p.generation,1);id(p.approval_id);this.#envelope(value,audience,p);
      const {scope}=this.leases.scoped(value,audience,p.generation),r=this.#submission(value,audience,p.submission_id);
      if(r.row.generation!==p.generation)throw new Error('WORK_FENCE_REJECTED');
      const old=k.db.prepare('SELECT * FROM commerce_worker_effects WHERE tenant_id=? AND store_id=? AND submission_id=?').get(r.s.tenant_id,r.s.store_id,p.submission_id) as Row;
      if(old){if(old.approval_id!==p.approval_id)throw new Error('WORK_IDEMPOTENCY_CONFLICT');return this.#body(old);}
      const receipt=this.gateway.execute(scope,{preview_id:r.result.preview.id,preview_digest:r.result.preview.digest,approval_id:p.approval_id});
      const op=k.db.prepare("SELECT id FROM commerce_operations WHERE tenant_id=? AND store_id=? AND source_kind='case' AND source_id=?").get(r.s.tenant_id,r.s.store_id,receipt.id) as Row;
      const result={receipt,operation:new BusinessOperations(k).read(scope,op.id),customer_message_sent:false};
      k.db.prepare('INSERT INTO commerce_worker_effects VALUES(?,?,?,?,?,?)').run(r.s.tenant_id,r.s.store_id,p.submission_id,p.approval_id,canonical(result),contentDigest(result));return result;
    });}catch(error){this.#denied(value,audience);throw error;}
  }
}
