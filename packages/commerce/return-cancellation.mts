import { lineageHistory } from './exchange-lineage.mts';
import { feeHistory } from './exchange-fees.mts';
import { instantHistory } from './instant-exchanges.mts';
import { exact,id,token } from './kernel.mts';
import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { returnContext,lifecycleBody,closureState,receiptSummary,LIFECYCLE_ACTIONS } from './return-lifecycle-core.mts';
import { assertReady,DRAFT_ACTION } from './integration-readiness.mts';
import { assertExecution } from './execution-stops.mts';
import { assertCaseWorkerScope } from './work-leases.mts';
import { ReplacementInventory } from './replacement-inventory.mts';
import { ReturnLabels } from './return-labels.mts';
import { FulfillmentFixtureSource } from '../adapters/fulfillment-fixture-source.mts';

export function cancellationValue(k:CommerceKernel,scope:Scope,intent:Row,quotedAt:number){const p=exact(intent,['request_id','reason']);if(!['customer_cancelled','unused_expired'].includes(p.reason))throw new Error('INVALID_INPUT');
 const ctx=returnContext(k,scope,p.request_id,'return.read',true),{s,c,r}=ctx;if(closureState(k,s,r.id))throw new Error('RETURN_CLOSED');assertCaseWorkerScope(k,scope,c.id);assertReady(k,s,DRAFT_ACTION);
 const expireAt=r.created_at+c.pins.composition.effective['returns.window_days']*86400000;if(p.reason==='unused_expired'&&k.clock()<expireAt)throw new Error('RETURN_NOT_EXPIRED');
 const instant=instantHistory(k,s,c.id);if(instant.unresolved_count)throw new Error('INSTANT_OBLIGATIONS_UNRESOLVED');
 const fees=feeHistory(k,s,c.id);if(fees.unresolved_count)throw new Error('FEE_DIFFERENCE_UNRESOLVED');
 const lineage=lineageHistory(k,s,c.id);if(lineage.unresolved_count)throw new Error('LINEAGE_TRANSFER_UNRESOLVED');
 const history={...(lineage.imports.length?{lineage}:{}),...(instant.obligations.length?{instant}:{}),...(fees.obligations.length?{fees}:{}),receiving:receiptSummary(k,s,r.id).digest,
  money:k.db.prepare('SELECT id,state,native_id FROM commerce_resolution_operations WHERE tenant_id=? AND store_id=? AND case_id=? ORDER BY id').all(s.tenant_id,s.store_id,c.id),
  fulfillment:k.db.prepare('SELECT id,state,native_id FROM commerce_fulfillment_operations WHERE tenant_id=? AND store_id=? AND case_id=? ORDER BY id').all(s.tenant_id,s.store_id,c.id),
  disposition:k.db.prepare('SELECT id,state,native_id FROM commerce_disposition_operations WHERE tenant_id=? AND store_id=? AND request_id=? ORDER BY id').all(s.tenant_id,s.store_id,r.id)};
 return {kind:'cancel',intent:p,tenant_id:s.tenant_id,store_id:s.store_id,case_id:c.id,request_id:r.id,resource_id:c.resource_id,customer_id:c.customer_id,case_revision:c.revision,configuration_digest:c.configuration_digest,policy_digest:c.pins.policy.digest,
  source_version:c.order.source_version,source_digest:contentDigest(c.order),history_digest:contentDigest(history),retained_history:history,expire_at:expireAt,quoted_at:quotedAt,expires_at:quotedAt+300000,control_stamp:assertExecution(k,s,LIFECYCLE_ACTIONS.cancel).stamp,qualification:'local_remaining_obligations_only'};
}
export class ReturnCancellation {
 readonly kernel:CommerceKernel;constructor(k:CommerceKernel){this.kernel=k;}
 quote(scope:Scope,input:unknown){const k=this.kernel;return k.transaction(()=>{const q=cancellationValue(k,scope,jsonValue(input),k.clock()),s=k.authorize(scope,'action.propose',q.resource_id),ref='lifequote_'+token().slice(0,32),hash=contentDigest(q);
  k.db.prepare('INSERT INTO commerce_lifecycle_quotes VALUES(?,?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,ref,q.request_id,q.case_id,'cancel',canonical(q),hash);
  return {id:ref,digest:hash,quote:q,proposal:{case_id:q.case_id,action:LIFECYCLE_ACTIONS.cancel,arguments:{quote_id:ref,quote_digest:hash}},execution_authorized:false};});}
 read(scope:Scope,requestId:string){const {s,r}=returnContext(this.kernel,scope,requestId),closure=closureState(this.kernel,s,r.id),k=this.kernel;
  const reservations=k.db.prepare('SELECT id,state,generation FROM commerce_inventory_reservations WHERE tenant_id=? AND store_id=? AND case_id=? ORDER BY id').all(s.tenant_id,s.store_id,r.case_id);
  const labels=(k.db.prepare('SELECT * FROM commerce_return_labels WHERE tenant_id=? AND store_id=? AND request_id=? ORDER BY generation').all(s.tenant_id,s.store_id,r.id) as Row[]).map(r=>{const b=lifecycleBody(r);return {id:r.id,void_state:b.void_state,reimbursement:b.reimbursement,requires_separate_void_approval:!['confirmed','requested'].includes(b.void_state)};});
  return {request_id:r.id,state:closure?.state??'open',closure,reservations,labels,instant:instantHistory(k,s,r.case_id),fees:feeHistory(k,s,r.case_id),lineage:lineageHistory(k,s,r.case_id),history_preserved:true,native_return_cancelled:false,notification_sent:false};}
 cleanup(scope:Scope,input:unknown,source:FulfillmentFixtureSource){const p=exact(jsonValue(input),['request_id']),ctx=returnContext(this.kernel,scope,p.request_id,'action.execute');if(!closureState(this.kernel,ctx.s,ctx.r.id))throw new Error('RETURN_NOT_CLOSED');
  const inventory=new ReplacementInventory(this.kernel,source),rows=this.kernel.db.prepare('SELECT id,generation FROM commerce_inventory_reservations WHERE tenant_id=? AND store_id=? AND case_id=?').all(ctx.s.tenant_id,ctx.s.store_id,ctx.r.case_id) as Row[];
  const result=rows.map(r=>{try{return inventory.releaseCancelled(scope,{reservation_id:r.id,generation:r.generation});}catch(error){return {id:r.id,state:'manual_reconciliation_required',reason:error instanceof Error?error.message:'UNAVAILABLE'};}});
  return {reservations:result,labels:this.read(scope,p.request_id).labels,notification_sent:false,requires_separate_void_approval:true};
 }
 quoteVoid(scope:Scope,input:unknown,source:FulfillmentFixtureSource){const p=exact(jsonValue(input),['label_id']);return new ReturnLabels(this.kernel,source).quoteVoid(scope,p);}
}
