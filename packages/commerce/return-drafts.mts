import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { exact,id } from './kernel.mts';
import { contentDigest,jsonValue } from './configuration-values.mts';
import { ActionGateway } from './action-gateway.mts';

export class ReturnDrafts {
  #k:CommerceKernel;readonly gateway:ActionGateway;
  constructor(k:CommerceKernel){this.#k=k;this.gateway=new ActionGateway(k);}
  prepare(scope:Scope,input:unknown) {
    const p=exact(jsonValue(input),['case_id','request_key','resolution']);id(p.case_id);id(p.request_key);
    if(!['refund','exchange'].includes(p.resolution))throw new Error('INVALID_INPUT');
    const k=this.#k;return k.transaction(()=>{
      const c=this.gateway.cases.resume(scope,p.case_id),s=k.authorize(scope,'action.propose',c.resource_id);
      const hash=contentDigest({case_id:p.case_id,resolution:p.resolution,configuration_digest:c.configuration_digest});
      const old=k.db.prepare('SELECT * FROM commerce_return_drafts WHERE tenant_id=? AND store_id=? AND (case_id=? OR request_key=?)').get(s.tenant_id,s.store_id,p.case_id,p.request_key) as Row;
      if(old){if(old.case_id!==p.case_id||old.request_digest!==hash)throw new Error('DRAFT_CONFLICT');return {...this.read(scope,p.case_id),duplicate:true};}
      // No direct case-effect or operation write: the canonical gateway computes and validates all facts.
      const preview=this.gateway.prepare(scope,{case_id:p.case_id,action:'diagnostic.resolution.set',arguments:{resolution:p.resolution}});
      k.db.prepare('INSERT INTO commerce_return_drafts VALUES(?,?,?,?,?,?)').run(s.tenant_id,s.store_id,p.case_id,p.request_key,hash,preview.id);
      return {...preview,case_id:p.case_id,duplicate:false,status:'awaiting_review',financial_effect:false};
    });
  }
  read(scope:Scope,caseId:string) {
    const k=this.#k,c=this.gateway.cases.inspect(scope,id(caseId)),s=k.require(scope);
    const d=k.db.prepare('SELECT * FROM commerce_return_drafts WHERE tenant_id=? AND store_id=? AND case_id=?').get(s.tenant_id,s.store_id,caseId) as Row;
    if(!d)throw new Error('NOT_FOUND');const p=k.db.prepare('SELECT * FROM commerce_action_previews WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,d.preview_id) as Row;
    if(!p||contentDigest(JSON.parse(p.body))!==p.digest)throw new Error('PREVIEW_INTEGRITY');const preview=JSON.parse(p.body);
    const receipt=k.db.prepare('SELECT id FROM commerce_action_receipts WHERE tenant_id=? AND store_id=? AND preview_id=?').get(s.tenant_id,s.store_id,p.id) as Row;
    return {case_id:caseId,id:p.id,digest:p.digest,preview,configuration_digest:c.configuration_digest,
      status:receipt?'recorded_local_plan':'awaiting_review',receipt_id:receipt?.id??null,approval_required:true,execution_authorized:false,financial_effect:false};
  }
}
