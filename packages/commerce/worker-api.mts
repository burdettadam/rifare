import { CommerceKernel,exact,id,integer,token } from './kernel.mts';
import type { Scope,Row } from './kernel.mts';
import { WorkLeases,unresolvedEffects } from './work-leases.mts';
import { ActionGateway } from './action-gateway.mts';
import { Skills } from './skills.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { BusinessOperations } from './operation-store.mts';
import { controlState } from './execution-stops.mts';
import { permissionDecision,recordSecurity } from './authorization.mts';
import { ReturnIntake } from './return-intake.mts';
import { INTAKE_ACTION } from './return-eligibility.mts';
import { RESOLVE_ACTION } from './resolution-ledger.mts';
import { ResolutionExecution } from './resolution-execution.mts';

export class WorkerApi {
  #k:CommerceKernel;readonly leases:WorkLeases;readonly gateway:ActionGateway;
  readonly resolutionExecution:ResolutionExecution|null;
  constructor(k:CommerceKernel,options:{resolutionExecution?:ResolutionExecution|null}={}){
    if(Object.keys(options).some(key=>key!=='resolutionExecution')||options.resolutionExecution!==undefined&&options.resolutionExecution!==null&&(!(options.resolutionExecution instanceof ResolutionExecution)||options.resolutionExecution.kernel!==k))throw new Error('WORK_SOURCE_INVALID');
    this.#k=k;this.leases=new WorkLeases(k);this.gateway=new ActionGateway(k);this.resolutionExecution=options.resolutionExecution??null;
  }
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
  #returnPreview(s:Row,row:Row){
    const preview=JSON.parse(row.body);
    if(contentDigest(preview)!==row.digest||preview.tenant_id!==s.tenant_id||preview.store_id!==s.store_id||preview.case_id!==row.case_id)throw new Error('PREVIEW_INTEGRITY');
    if(![INTAKE_ACTION,RESOLVE_ACTION].includes(preview.action))return null;
    // This contract resumes the common refund subset. Exchange/credit previews
    // remain on their existing surfaces and cannot be smuggled through this one.
    if(preview.action===RESOLVE_ACTION){
      const quote=this.#k.db.prepare('SELECT body,digest FROM commerce_resolution_quotes WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,preview.arguments.quote_id) as Row;
      if(!quote||contentDigest(JSON.parse(quote.body))!==quote.digest)throw new Error('RESOLUTION_INTEGRITY');
      const body=JSON.parse(quote.body);if(body.kind!=='refund'||body.exchange_quote_id)return null;
    }
    return preview;
  }
  #approval(s:Row,preview:Row){
    const k=this.#k,row=k.db.prepare('SELECT * FROM commerce_action_approvals WHERE tenant_id=? AND store_id=? AND preview_id=?').get(s.tenant_id,s.store_id,preview.id) as Row;
    if(!row)return null;
    const member=k.db.prepare('SELECT * FROM commerce_members WHERE tenant_id=? AND store_id=? AND actor_id=? AND active=1').get(s.tenant_id,s.store_id,row.approver) as Row;
    const decision=member&&permissionDecision(k.db,member,'action.approve',preview.resource_id);
    return {id:row.id,preview_id:row.preview_id,preview_digest:row.preview_digest,uses:row.uses,max_uses:row.max_uses,revoked:!!row.revoked,expires_at:row.expires_at,
      authority_current:!!decision?.allowed&&decision.authority_revision===row.authority_revision&&row.approver!==preview.proposer&&row.preview_digest===preview.digest};
  }
  #resolutionRow(scope:Scope,caseId:string,ref:string){
    const s=this.#k.require(scope),row=this.#k.db.prepare('SELECT * FROM commerce_resolution_operations WHERE tenant_id=? AND store_id=? AND case_id=? AND id=?').get(s.tenant_id,s.store_id,caseId,id(ref)) as Row;
    if(!row)throw new Error('NOT_FOUND');this.#k.authorize(scope,'operation.read',row.resource_id);
    const command=JSON.parse(row.command);
    if(contentDigest(command)!==row.digest||command.operation_id!==row.id||command.allocation_id!==row.allocation_id||command.resource_id!==row.resource_id||command.kind!==row.kind||command.amount_minor!==row.amount_minor||command.currency!==row.currency)throw new Error('RESOLUTION_INTEGRITY');
    if(row.kind!=='refund'||command.exchange_quote_id)throw new Error('WORK_ACTION_UNAVAILABLE');return row;
  }
  returnContext(value:unknown,audience:string,generation:number){
    const base=this.context(value,audience,generation),{scope,grant}=this.leases.returnScoped(value,audience,generation),k=this.#k,s=k.require(scope),caseId=grant.case_id;
    k.authorize(scope,'return.read',base.envelope.resource_id);
    const request=new ReturnIntake(k).read(scope,caseId),previews:Row[]=[],receipts:Row[]=[];
    const rows=k.db.prepare('SELECT * FROM commerce_action_previews WHERE tenant_id=? AND store_id=? AND case_id=? ORDER BY id').all(s.tenant_id,s.store_id,caseId) as Row[];
    if(rows.length>250)throw new Error('WORK_CONTEXT_LIMIT');
    for(const row of rows){const preview=this.#returnPreview(s,row);if(!preview)continue;
      const stored=k.db.prepare('SELECT id FROM commerce_action_receipts WHERE tenant_id=? AND store_id=? AND case_id=? AND preview_id=?').get(s.tenant_id,s.store_id,caseId,row.id) as Row;
      const receipt=stored?this.gateway.receipt(scope,stored.id):null;
      if(receipt)receipts.push(receipt);
      previews.push({id:row.id,digest:row.digest,action:preview.action,configuration_digest:preview.configuration_digest,policy_digest:preview.policy_digest,case_revision:preview.case_revision,expires_at:preview.expires_at,
        approval:this.#approval(s,{...row,resource_id:preview.resource_id}),receipt_id:receipt?.id??null});
    }
    const operationRefs=k.db.prepare("SELECT id FROM commerce_resolution_operations WHERE tenant_id=? AND store_id=? AND case_id=? AND kind='refund' ORDER BY observed_at,id").all(s.tenant_id,s.store_id,caseId) as Row[];
    if(operationRefs.length>100)throw new Error('WORK_CONTEXT_LIMIT');
    const operations=operationRefs.map(ref=>{const row=this.#resolutionRow(scope,caseId,ref.id),observation=this.resolutionExecution?.read(scope,row.id);
      return {id:row.id,allocation_id:row.allocation_id,receipt_id:row.receipt_id,quote_id:row.quote_id,kind:row.kind,state:row.state,amount_minor:row.amount_minor,currency:row.currency,native_id:row.native_id,
        source_identity:row.source_identity,command_digest:row.digest,cash_settled:observation?.cash_settled??false,retry_allowed:false,
        qualification:observation?.qualification??'source_not_configured',live_financial_effect:false};});
    const actions:Record<string,string>={'approved-preview.execute':'action.execute','resolution.dispatch':'operation.dispatch','resolution.reconcile':'operation.reconcile'};
    const allowed=Object.entries(actions).filter(([action,permission])=>permissionDecision(k.db,s,permission,base.envelope.resource_id).allowed&&(action==='approved-preview.execute'||this.resolutionExecution!==null)).map(([action])=>action);
    return {...base,contract:{id:'rifare-common-return-worker',version:'1.0.0',qualification:'local_fixture_only'},observed_at:k.clock(),
      return_request:{case_id:caseId,id:request.id??null,state:request.state,preview_id:request.preview_id??null,preview_digest:request.preview_digest??null,receipt_id:request.receipt_id??null},
      previews,receipts,operations,allowed_actions:allowed,controls:{return_submit:controlState(k,s,INTAKE_ACTION),refund:controlState(k,s,RESOLVE_ACTION)},
      execution_authorized:false,live_financial_effect:false};
  }
  async returnAction(value:unknown,audience:string,input:unknown){
    try{
      const p=exact(jsonValue(input),['generation','envelope','action','arguments']);integer(p.generation,1);
      const current=this.returnContext(value,audience,p.generation);exact(p.envelope,Object.keys(current.envelope));
      if(contentDigest(p.envelope)!==contentDigest(current.envelope))throw new Error('WORK_ENVELOPE_REJECTED');
      const {scope,grant}=this.leases.returnScoped(value,audience,p.generation),k=this.#k,s=k.require(scope);
      if(p.action==='approved-preview.execute')return k.transaction(()=>{
        const args=exact(p.arguments,['preview_id','preview_digest','approval_id']);id(args.preview_id);id(args.approval_id);
        k.authorize(scope,'action.execute',current.envelope.resource_id);
        const row=k.db.prepare('SELECT * FROM commerce_action_previews WHERE tenant_id=? AND store_id=? AND case_id=? AND id=?').get(s.tenant_id,s.store_id,grant.case_id,args.preview_id) as Row;
        if(!row)throw new Error('NOT_FOUND');if(!this.#returnPreview(s,row))throw new Error('WORK_ACTION_UNAVAILABLE');
        if(row.digest!==args.preview_digest)throw new Error('PREVIEW_STALE');
        const old=k.db.prepare('SELECT id FROM commerce_action_receipts WHERE tenant_id=? AND store_id=? AND case_id=? AND preview_id=?').get(s.tenant_id,s.store_id,grant.case_id,row.id) as Row;
        if(old){const receipt=this.gateway.receipt(scope,old.id);if(receipt.approval_id!==args.approval_id||receipt.preview_digest!==args.preview_digest)throw new Error('WORK_IDEMPOTENCY_CONFLICT');return {receipt,replayed:true,financial_effect:false};}
        return {receipt:this.gateway.execute(scope,args),replayed:false,financial_effect:false};
      });
      if(!['resolution.dispatch','resolution.reconcile'].includes(p.action))throw new Error('WORK_ACTION_UNAVAILABLE');
      const args=exact(p.arguments,['operation_id']),row=this.#resolutionRow(scope,grant.case_id,args.operation_id);
      k.authorize(scope,p.action==='resolution.dispatch'?'operation.dispatch':'operation.reconcile',row.resource_id);
      if(!this.resolutionExecution)throw new Error('WORK_SOURCE_UNAVAILABLE');
      if(p.action==='resolution.dispatch'&&unresolvedEffects(k,s,row.resource_id).length)throw new Error('RECONCILIATION_REQUIRED');
      const operation=p.action==='resolution.dispatch'?await this.resolutionExecution.dispatch(scope,row.id):await this.resolutionExecution.reconcile(scope,row.id);
      // The canonical executor rechecks the restricted scope after async I/O;
      // the revoked runtime cannot attach a late result to the new generation.
      this.leases.returnScoped(value,audience,p.generation);
      return {operation,financial_effect:false,live_financial_effect:false};
    }catch(error){this.#denied(value,audience);throw error;}
  }
}
