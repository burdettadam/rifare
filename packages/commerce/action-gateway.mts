import { assertSupportAutomation } from './support-qualification.mts';
import { EDIT_ACTION,editGatewayQuote,commitOrderEdit } from './order-edit-core.mts';
import { LIFECYCLE_ACTIONS,assertReturnWritable } from './return-lifecycle-core.mts';
import { lifecycleGatewayQuote,commitLifecycle } from './lifecycle-gateway.mts';
import { FULFILLMENT_ACTIONS,fulfillmentGatewayQuote,commitFulfillment } from './return-fulfillment-core.mts';
import { RESOLVE_ACTION } from './resolution-ledger.mts';
import { resolutionGatewayQuote,commitResolution } from './refund-quotes.mts';
import { INTAKE_ACTION } from './return-eligibility.mts';
import { returnGatewayQuote,commitReturnRequest } from './return-intake-core.mts';
import { qualifyLocalDraft,assertReady } from './integration-readiness.mts';
import { assertCaseWorkerScope } from './work-leases.mts';
import { assertExecution } from './execution-stops.mts';
import { recordCaseExecution } from './operation-store.mts';
import { CommerceKernel,exact,id,integer,token } from './kernel.mts';
import type { Scope,Row } from './kernel.mts';
import { canonical,contentDigest,jsonValue,returnDecision } from './configuration-values.mts';
import { CaseConfigurations,WRITE_CONTRACT,WRITE_CONTRACT_DIGEST } from './case-configurations.mts';
import { money } from './money.mts';
import { permissionDecision } from './authorization.mts';

export class ActionGateway {
  #k:CommerceKernel;readonly cases:CaseConfigurations;
  constructor(kernel:CommerceKernel){this.#k=kernel;this.cases=new CaseConfigurations(kernel);}
  configure(scope:Scope,input:unknown){
    const k=this.#k,s=k.authorize(scope,'action.configure'),p=exact(jsonValue(input),['enabled','expected_revision','profile_id','policy_id']);integer(p.expected_revision);id(p.profile_id);id(p.policy_id);
    if(typeof p.enabled!=='boolean')throw new Error('INVALID_INPUT');
    return k.transaction(()=>{
      k.authorize(scope,'action.configure');
      const r=k.db.prepare('SELECT revision FROM commerce_execution_settings WHERE tenant_id=? AND store_id=?').get(s.tenant_id,s.store_id) as Row;
      if((r?.revision??0)!==p.expected_revision)throw new Error('CAPABILITY_CHANGED');
      k.db.prepare(`INSERT INTO commerce_execution_settings VALUES(?,?,?,?,?,?) ON CONFLICT(tenant_id,store_id) DO UPDATE SET enabled=excluded.enabled,revision=excluded.revision,profile_id=excluded.profile_id,policy_id=excluded.policy_id`)
        .run(s.tenant_id,s.store_id,p.enabled?1:0,p.expected_revision+1,p.profile_id,p.policy_id);
      if(p.enabled)qualifyLocalDraft(k,s,p.expected_revision+1);
      return {enabled:p.enabled,revision:p.expected_revision+1,contract:WRITE_CONTRACT};
    });
  }
  state(scope:Scope,caseId:string){const c=this.cases.inspect(scope,caseId),s=this.#k.require(scope);
    const r=this.#k.db.prepare('SELECT revision,resolution,amount_minor,currency FROM commerce_case_effects WHERE tenant_id=? AND store_id=? AND case_id=?').get(s.tenant_id,s.store_id,c.id) as Row;
    return {case_id:c.id,...(r??{revision:0,resolution:'none',amount_minor:'0',currency:null}),effect:'local_case_plan_only',financial_effect:false};}
  #proposal(input:unknown){const p=exact(jsonValue(input),['case_id','action','arguments']);id(p.case_id);
    if(p.action===EDIT_ACTION||Object.values(FULFILLMENT_ACTIONS).includes(p.action)||Object.values(LIFECYCLE_ACTIONS).includes(p.action)){const a=exact(p.arguments,['quote_id','quote_digest']);id(a.quote_id);if(typeof a.quote_digest!=='string'||!/^[a-f0-9]{64}$/.test(a.quote_digest))throw new Error('INVALID_INPUT');return p;}
    if(p.action===RESOLVE_ACTION){const a=exact(p.arguments,['quote_id','quote_digest']);id(a.quote_id);if(typeof a.quote_digest!=='string'||!/^[a-f0-9]{64}$/.test(a.quote_digest))throw new Error('INVALID_INPUT');return p;}
    if(p.action===INTAKE_ACTION){const a=exact(p.arguments,['quote_id','quote_digest','override_id']);id(a.quote_id);if(typeof a.quote_digest!=='string'||!/^[a-f0-9]{64}$/.test(a.quote_digest))throw new Error('INVALID_INPUT');if(a.override_id!==null)id(a.override_id);return p;}
    if(p.action!=='diagnostic.resolution.set')throw new Error('UNSUPPORTED_ACTION');
    const a=exact(p.arguments,['resolution']);if(!['none','refund','exchange'].includes(a.resolution))throw new Error('INVALID_INPUT');return p;}
  #quote(scope:Scope,p:Row,quotedAt:number){
    const scopeRow=this.#k.require(scope),request=this.#k.db.prepare('SELECT id FROM commerce_return_requests WHERE tenant_id=? AND store_id=? AND case_id=?').get(scopeRow.tenant_id,scopeRow.store_id,p.case_id) as Row;
    if(request&&!Object.values(LIFECYCLE_ACTIONS).includes(p.action)&&p.action!==FULFILLMENT_ACTIONS.void)assertReturnWritable(this.#k,scopeRow,request.id);
    if(p.action===EDIT_ACTION)return editGatewayQuote(this.#k,scope,p,quotedAt);
    if(Object.values(LIFECYCLE_ACTIONS).includes(p.action))return lifecycleGatewayQuote(this.#k,scope,p,quotedAt);
    if(Object.values(FULFILLMENT_ACTIONS).includes(p.action))return fulfillmentGatewayQuote(this.#k,scope,p,quotedAt);
    if(p.action===RESOLVE_ACTION)return resolutionGatewayQuote(this.#k,scope,p,quotedAt);
    if(p.action===INTAKE_ACTION)return returnGatewayQuote(this.#k,scope,p,quotedAt);
    const k=this.#k,c=this.cases.resume(scope,p.case_id),s=k.require(scope),verified=this.cases.verified(scope,p.case_id),effect=this.state(scope,p.case_id);
    const control=assertExecution(k,s,p.action);
    const settings=k.db.prepare('SELECT * FROM commerce_execution_settings WHERE tenant_id=? AND store_id=?').get(s.tenant_id,s.store_id) as Row;
    if(!settings?.enabled)throw new Error('CAPABILITY_UNAVAILABLE');
    const integration=assertReady(k,s,p.action);
    if(c.pins.profile.id!==settings.profile_id||c.pins.policy.policy_id!==settings.policy_id)throw new Error('CONFIGURATION_NOT_APPROVED');
    const order=c.order,body=order.payload,values=c.pins.composition.effective;
    if(order.source_system!=='synthetic'||order.kind!=='order')throw new Error('CAPABILITY_UNAVAILABLE');
    if(k.clock()-order.observed_at>values['data.max_age_seconds']*1000||order.observed_at>k.clock())throw new Error('SOURCE_STALE');
    const raw=body.total_minor;
    if(typeof raw!=='string'&&!Number.isSafeInteger(raw))throw new Error('SOURCE_FACTS_MISSING');
    const amount=money(body.currency,p.arguments.resolution==='refund'?String(raw):'0');
    let decision={eligible:true,reasons:['REVERSIBLE_CLEAR']};
    if(p.arguments.resolution!=='none'){
      if(!Number.isSafeInteger(body.delivered_at)||body.delivered_at<0||body.delivered_at>quotedAt||!Array.isArray(body.tags)||typeof body.evidence_verified!=='boolean')throw new Error('SOURCE_FACTS_MISSING');
      decision=returnDecision(c.pins.policy.body.rules,{delivered_at:body.delivered_at,requested_at:quotedAt,tags:body.tags,evidence_provided:body.evidence_verified,outcome:p.arguments.resolution});
      if(!decision.eligible)throw new Error('POLICY_DENIED');
    }
    return {schema_version:1,tenant_id:s.tenant_id,store_id:s.store_id,case_id:c.id,case_revision:c.revision,configuration_digest:c.configuration_digest,
      resource_id:order.id,resource_version:order.source_version,source_digest:contentDigest({payload:body,customer_id:order.customer_id,observed_at:order.observed_at}),
      customer_id:verified.customer_id,action:p.action,arguments:p.arguments,amount,amount_ceiling:amount,
      readiness_digest:integration.evidence_digest,control_stamp:control.stamp,capability_revision:settings.revision,adapter_contract_digest:WRITE_CONTRACT_DIGEST,policy_digest:c.pins.policy.digest,decision,
      effect_version:effect.revision,quoted_at:quotedAt,expires_at:Math.min(quotedAt+300000,verified.expires_at),max_uses:1,financial_effect:false};
  }
  #preview(scope:Scope,previewId:string){const s=this.#k.require(scope);id(previewId);
    const r=this.#k.db.prepare('SELECT * FROM commerce_action_previews WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,previewId) as Row;
    if(!r)throw new Error('NOT_FOUND');const b=JSON.parse(r.body);
    this.cases.inspect(scope,r.case_id);
    if(contentDigest(b)!==r.digest||b.tenant_id!==s.tenant_id||b.store_id!==s.store_id||b.case_id!==r.case_id)throw new Error('PREVIEW_INTEGRITY');return {...r,preview:b};}
  #current(scope:Scope,r:Row){
    if(r.preview.expires_at<=this.#k.clock())throw new Error('PREVIEW_EXPIRED');
    const proposal=this.#proposal({case_id:r.case_id,action:r.preview.action,arguments:r.preview.arguments}),q=this.#quote(scope,proposal,r.preview.quoted_at);
    if(contentDigest(q)!==r.digest)throw new Error('PREVIEW_STALE');return q;
  }
  prepare(scope:Scope,input:unknown){
    const k=this.#k,p=this.#proposal(input),c=this.cases.inspect(scope,p.case_id),s=k.authorize(scope,p.action===INTAKE_ACTION?'return.request':'action.propose',c.resource_id);
    return k.transaction(()=>{
      k.authorize(scope,p.action===INTAKE_ACTION?'return.request':'action.propose',c.resource_id);assertCaseWorkerScope(k,scope,c.id);
      const preview=this.#quote(scope,p,k.clock());assertSupportAutomation(k,scope,preview,'propose');const ref='preview_'+token().slice(0,32),hash=contentDigest(preview);
      k.db.prepare('INSERT INTO commerce_action_previews VALUES(?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,ref,p.case_id,canonical(preview),hash,s.actor_id);
      return {id:ref,digest:hash,preview,approval_required:true,execution_authorized:false};
    });
  }
  approve(scope:Scope,input:unknown){
    const k=this.#k,p=exact(jsonValue(input),['preview_id','preview_digest']);
    return k.transaction(()=>{
      const r=this.#preview(scope,p.preview_id),s=k.authorize(scope,'action.approve',r.preview.resource_id);
      if(r.proposer===s.actor_id)throw new Error('SELF_APPROVAL_DENIED');
      if(r.digest!==p.preview_digest)throw new Error('PREVIEW_STALE');this.#current(scope,r);
      if(k.db.prepare('SELECT 1 FROM commerce_action_approvals WHERE tenant_id=? AND store_id=? AND preview_id=?').get(s.tenant_id,s.store_id,r.id))throw new Error('APPROVAL_EXISTS');
      const ref='apv_'+token().slice(0,32),revision=permissionDecision(k.db,s,'action.approve',r.preview.resource_id).authority_revision;
      k.db.prepare('INSERT INTO commerce_action_approvals VALUES(?,?,?,?,?,?,?,?,1,0,0)').run(s.tenant_id,s.store_id,ref,r.id,r.digest,s.actor_id,revision,r.preview.expires_at);
      return {id:ref,preview_id:r.id,preview_digest:r.digest,max_uses:1,expires_at:r.preview.expires_at,financial_authorization:false};
    });
  }
  revokeApproval(scope:Scope,approvalId:string){const k=this.#k,s=k.require(scope);id(approvalId);
    const r=k.db.prepare('SELECT * FROM commerce_action_approvals WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,approvalId) as Row;
    if(!r)throw new Error('NOT_FOUND');const p=this.#preview(scope,r.preview_id);k.authorize(scope,'action.approve',p.preview.resource_id);
    k.db.prepare('UPDATE commerce_action_approvals SET revoked=1 WHERE tenant_id=? AND store_id=? AND id=?').run(s.tenant_id,s.store_id,approvalId);return {revoked:true};}
  execute(scope:Scope,input:unknown){
    const k=this.#k,p=exact(jsonValue(input),['preview_id','preview_digest','approval_id']);id(p.approval_id);
    return k.transaction(()=>{
      const r=this.#preview(scope,p.preview_id),s=k.authorize(scope,'action.execute',r.preview.resource_id);
      assertCaseWorkerScope(k,scope,r.case_id);
      if(r.digest!==p.preview_digest)throw new Error('PREVIEW_STALE');
      const a=k.db.prepare('SELECT * FROM commerce_action_approvals WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,p.approval_id) as Row;
      if(!a||a.revoked||a.expires_at<=k.clock()||a.preview_id!==r.id||a.preview_digest!==r.digest||a.max_uses!==1||a.uses!==0)throw new Error('APPROVAL_UNAVAILABLE');
      const m=k.db.prepare('SELECT * FROM commerce_members WHERE tenant_id=? AND store_id=? AND actor_id=? AND active=1').get(s.tenant_id,s.store_id,a.approver) as Row;
      const authority=m&&permissionDecision(k.db,m,'action.approve',r.preview.resource_id);
      if(!authority?.allowed||authority.authority_revision!==a.authority_revision||a.approver===r.proposer)throw new Error('APPROVAL_AUTHORITY_CHANGED');
      const q=this.#current(scope,r);assertSupportAutomation(k,scope,q,'execute');
      const consumed=k.db.prepare('UPDATE commerce_action_approvals SET uses=1 WHERE tenant_id=? AND store_id=? AND id=? AND uses=0 AND revoked=0').run(s.tenant_id,s.store_id,a.id);
      if(consumed.changes!==1)throw new Error('APPROVAL_UNAVAILABLE');
      const receiptId='receipt_'+token().slice(0,32);
      const editId=q.action===EDIT_ACTION?commitOrderEdit(k,s,q,receiptId):null;
      const returnId=q.action===INTAKE_ACTION?commitReturnRequest(k,s,{...q,preview_id:r.id},receiptId):null;
      const resolutionId=q.action===RESOLVE_ACTION?commitResolution(k,s,q,receiptId):null;
      const lifecycleId=Object.values(LIFECYCLE_ACTIONS).includes(q.action)?commitLifecycle(k,s,q,receiptId):null;
      const fulfillmentId=Object.values(FULFILLMENT_ACTIONS).includes(q.action)?commitFulfillment(k,s,q,receiptId):null;
      if(q.action!==INTAKE_ACTION&&q.action!==RESOLVE_ACTION&&!fulfillmentId&&!lifecycleId&&!editId)k.db.prepare(`INSERT INTO commerce_case_effects VALUES(?,?,?,?,?,?,?) ON CONFLICT(tenant_id,store_id,case_id)
        DO UPDATE SET revision=excluded.revision,resolution=excluded.resolution,amount_minor=excluded.amount_minor,currency=excluded.currency`)
        .run(s.tenant_id,s.store_id,q.case_id,q.effect_version+1,q.arguments.resolution,q.amount.minor,q.amount.currency);
      const receipt={id:receiptId,case_id:q.case_id,preview_id:r.id,preview_digest:r.digest,approval_id:a.id,
        configuration_digest:q.configuration_digest,case_revision:q.case_revision,resource_version:q.resource_version,actor_id:s.actor_id,
        authority_revision:permissionDecision(k.db,s,'action.execute',q.resource_id).authority_revision,effect:editId?'synthetic_order_edit_authorized':lifecycleId?'synthetic_lifecycle_authorized':returnId?'local_return_request_only':resolutionId?'synthetic_resolution_authorized':fulfillmentId?'synthetic_fulfillment_authorized':'local_case_plan_only',
        ...(editId?{order_edit_id:editId}:{}),...(lifecycleId?{lifecycle_operation_id:lifecycleId}:{}),...(returnId?{return_request_id:returnId}:{}),...(resolutionId?{resolution_operation_id:resolutionId}:{}),...(fulfillmentId?{fulfillment_operation_id:fulfillmentId}:{}),resolution:editId?'order_edit_authorized':lifecycleId?'lifecycle_authorized':returnId?'return_requested':resolutionId?'resolution_authorized':fulfillmentId?'fulfillment_authorized':q.arguments.resolution,amount:q.amount,effect_revision:q.effect_version+1,financial_effect:false,approval_consumed:true,completed_at:k.clock()};
      k.db.prepare('INSERT INTO commerce_action_receipts VALUES(?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,receipt.id,q.case_id,r.id,canonical(receipt),contentDigest(receipt));
      if(!returnId&&!resolutionId&&!fulfillmentId&&!lifecycleId&&!editId)recordCaseExecution(k,s,receipt,q);
      return receipt;
    });
  }
  receipt(scope:Scope,receiptId:string){const s=this.#k.require(scope);id(receiptId);
    const r=this.#k.db.prepare('SELECT * FROM commerce_action_receipts WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,receiptId) as Row;
    if(!r)throw new Error('NOT_FOUND');this.cases.inspect(scope,r.case_id);
    const result=JSON.parse(r.body);if(contentDigest(result)!==r.digest)throw new Error('RECEIPT_INTEGRITY');return result;}
}
