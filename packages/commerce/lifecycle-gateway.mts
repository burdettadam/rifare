import { exact,id } from './kernel.mts';
import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { canonical,contentDigest } from './configuration-values.mts';
import { money } from './money.mts';
import { LIFECYCLE_ACTIONS,lifecycleBody,returnContext,lifecycleObservation } from './return-lifecycle-core.mts';
import { dispositionValue } from './return-disposition.mts';
import { cancellationValue } from './return-cancellation.mts';

export function lifecycleGatewayQuote(k:CommerceKernel,scope:Scope,p:Row,quotedAt:number){const a=exact(p.arguments,['quote_id','quote_digest']),s=k.require(scope),r=k.db.prepare('SELECT * FROM commerce_lifecycle_quotes WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,id(a.quote_id)) as Row,q=lifecycleBody(r);
 if(q.case_id!==p.case_id||r.digest!==a.quote_digest||LIFECYCLE_ACTIONS[q.kind as keyof typeof LIFECYCLE_ACTIONS]!==p.action||q.expires_at<=k.clock())throw new Error('LIFECYCLE_QUOTE_CHANGED');
 const current=q.kind==='disposition'?dispositionValue(k,scope,q.intent,q.quoted_at):cancellationValue(k,scope,q.intent,q.quoted_at);if(contentDigest(current)!==r.digest)throw new Error('LIFECYCLE_QUOTE_CHANGED');
 return {schema_version:1,tenant_id:s.tenant_id,store_id:s.store_id,case_id:q.case_id,case_revision:q.case_revision,configuration_digest:q.configuration_digest,resource_id:q.resource_id,resource_version:q.source_version,source_digest:q.source_digest,customer_id:q.customer_id,action:p.action,arguments:a,
  amount:money('USD','0'),amount_ceiling:money('USD','0'),readiness_digest:q.settings_digest??q.configuration_digest,control_stamp:q.control_stamp,capability_revision:q.settings_revision??1,adapter_contract_digest:contentDigest({action:p.action,version:1,effect:q.kind==='disposition'?'synthetic_warehouse':'local_remaining_obligations'}),policy_digest:q.policy_digest,
  decision:{eligible:true,reasons:['SEPARATE_APPROVAL_REQUIRED']},effect_version:0,quoted_at:quotedAt,expires_at:Math.min(quotedAt+300000,q.expires_at),max_uses:1,financial_effect:false};}
export function commitLifecycle(k:CommerceKernel,s:Row,p:Row,receiptId:string){const r=k.db.prepare('SELECT * FROM commerce_lifecycle_quotes WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,p.arguments.quote_id) as Row,q=lifecycleBody(r);
 if(q.kind==='cancel'){
  const b={request_id:q.request_id,case_id:q.case_id,reason:q.intent.reason,cancelled_at:k.clock(),history_digest:q.history_digest,completed_effects_preserved:true,native_cancellation:false},state=q.intent.reason==='unused_expired'?'expired':'cancelled';
  k.db.prepare('INSERT INTO commerce_return_closures VALUES(?,?,?,?,?,1,?,?,?,?)').run(s.tenant_id,s.store_id,q.request_id,q.case_id,q.resource_id,state,receiptId,canonical(b),contentDigest(b));
  // Only unused approvals are revoked. Historical approval/effect receipts are not rewritten.
  k.db.prepare('UPDATE commerce_action_approvals SET revoked=1 WHERE tenant_id=? AND store_id=? AND uses=0 AND preview_id IN (SELECT id FROM commerce_action_previews WHERE tenant_id=? AND store_id=? AND case_id=?)').run(s.tenant_id,s.store_id,s.tenant_id,s.store_id,q.case_id);
  const event={request_id:q.request_id,state,receipt_id:receiptId,delivery:'not_sent'},ref='closure_'+contentDigest([s.tenant_id,s.store_id,q.request_id]).slice(0,40);
  k.db.prepare('INSERT INTO commerce_return_lifecycle_events VALUES(?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,ref,q.request_id,'return_closed',canonical(event),contentDigest(event));
  lifecycleObservation(k,s,q.request_id,ref,'remaining_work_cancelled',b);return ref;
 }
 const ref='disposition_'+contentDigest([s.tenant_id,s.store_id,q.request_id,q.intent.unit_ids]).slice(0,36),command={operation_id:ref,source_identity:q.source_identity,tenant_id:s.tenant_id,store_id:s.store_id,request_id:q.request_id,resource_id:q.resource_id,native_return_id:q.native_return_id,location_id:q.location_id,disposition:q.intent.disposition,units:q.units};
 k.db.prepare("INSERT INTO commerce_disposition_operations VALUES(?,?,?,?,?,?,?,?,'authorized',?,?,NULL)").run(s.tenant_id,s.store_id,ref,q.request_id,q.case_id,q.resource_id,r.id,receiptId,canonical(command),contentDigest(command));
 for(const unit of q.units)k.db.prepare('INSERT INTO commerce_disposition_units VALUES(?,?,?,?)').run(s.tenant_id,s.store_id,unit.id,ref);
 lifecycleObservation(k,s,q.request_id,ref,'authorized',{quote_digest:r.digest,receipt_id:receiptId});return ref;
}
