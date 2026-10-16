import { id } from './kernel.mts';
import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { canonical,contentDigest } from './configuration-values.mts';
import { ActionGateway } from './action-gateway.mts';
import { CaseConfigurations } from './case-configurations.mts';
import { assertRecoveryEgress } from './data-guards.mts';
import { assertExecution } from './execution-stops.mts';
import { assertReady,DRAFT_ACTION } from './integration-readiness.mts';
import { permissionDecision } from './authorization.mts';
import { evidenceReviewState } from './return-intake-core.mts';
import { ShopifyReturnFixtureAdapter,nativeReturnRequest } from '../adapters/shopify-return-fixture.mts';

export class NativeReturns {
 #k:CommerceKernel;#adapter:ShopifyReturnFixtureAdapter;#cases:CaseConfigurations;
 constructor(k:CommerceKernel,adapter:ShopifyReturnFixtureAdapter){this.#k=k;this.#adapter=adapter;this.#cases=new CaseConfigurations(k);}
 #request(scope:Scope,ref:string,action='operation.dispatch') {
  const k=this.#k,s=k.require(scope);if(s.tenant_id!==this.#adapter.tenant||s.store_id!==this.#adapter.store)throw new Error('NATIVE_SOURCE_MISMATCH');
  const r=k.db.prepare('SELECT * FROM commerce_return_requests WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,id(ref)) as Row;
  if(!r)throw new Error('NOT_FOUND');const sending=action==='operation.dispatch',c=sending?this.#cases.resume(scope,r.case_id):this.#cases.inspect(scope,r.case_id);k.authorize(scope,action,c.resource_id);if(sending)this.#cases.verified(scope,c.id);
  const body=JSON.parse(r.body);if(contentDigest(body)!==r.digest)throw new Error('RETURN_REQUEST_INTEGRITY');
  if(!r.receipt_id||!['submitted','native_unknown','native_created'].includes(r.state))throw new Error('RETURN_APPROVAL_REQUIRED');
  const receipt=new ActionGateway(k).receipt(scope,r.receipt_id);
  if(receipt.return_request_id!==r.id||receipt.effect!=='local_return_request_only')throw new Error('RETURN_APPROVAL_REQUIRED');
  const approval=k.db.prepare('SELECT * FROM commerce_action_approvals WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,receipt.approval_id) as Row;
  const m=approval&&k.db.prepare('SELECT * FROM commerce_members WHERE tenant_id=? AND store_id=? AND actor_id=? AND active=1').get(s.tenant_id,s.store_id,approval.approver) as Row;
  const authority=m&&permissionDecision(k.db,m,'action.approve',c.resource_id);
  if(!approval||sending&&(approval.revoked||approval.expires_at<=k.clock()||!authority?.allowed||authority.authority_revision!==approval.authority_revision))throw new Error('APPROVAL_AUTHORITY_CHANGED');
  if(sending&&receipt.configuration_digest!==c.configuration_digest)throw new Error('CONFIGURATION_REPREVIEW_REQUIRED');
  const preview=k.db.prepare('SELECT body FROM commerce_action_previews WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,r.preview_id) as Row;
  const p=JSON.parse(preview.body);
  const quote=k.db.prepare('SELECT body,digest FROM commerce_return_quotes WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,r.quote_id) as Row;
  if(!quote||contentDigest(JSON.parse(quote.body))!==quote.digest||quote.digest!==p.arguments.quote_digest)throw new Error('RETURN_QUOTE_INTEGRITY');
  const original=JSON.parse(quote.body);
  if(sending&&(evidenceReviewState(k,s,r.case_id)?.seq??0)!==original.review_revision)throw new Error('RETURN_REVIEW_CHANGED');
  if(sending&&p.override){const override=k.db.prepare('SELECT * FROM commerce_return_overrides WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,p.override.id) as Row;
   const reviewer=override&&k.db.prepare('SELECT * FROM commerce_members WHERE tenant_id=? AND store_id=? AND actor_id=? AND active=1').get(s.tenant_id,s.store_id,override.actor_id) as Row;const role=reviewer&&permissionDecision(k.db,reviewer,'return.review',c.resource_id);
   if(!override||override.revoked||override.expires_at<=k.clock()||!role?.allowed||role.authority_revision!==override.authority_revision)throw new Error('RETURN_OVERRIDE_UNAVAILABLE');
  }
  if(sending&&(c.order.source_version!==receipt.resource_version||contentDigest(c.order)!==original.source_digest))throw new Error('RETURN_SOURCE_CHANGED');
  const input=nativeReturnRequest(original.native_order_id,p.lines,r.id);
  return {s,r,c,input,receipt,request_digest:contentDigest({input,receipt:r.receipt_id,configuration:receipt.configuration_digest,source:this.#adapter.identity})};
 }
 read(scope:Scope,requestId:string){const {s,r}=this.#request(scope,requestId,'operation.read'),o=this.#k.db.prepare('SELECT * FROM commerce_native_return_operations WHERE tenant_id=? AND store_id=? AND request_id=?').get(s.tenant_id,s.store_id,r.id) as Row;
  if(!o)return {request_id:r.id,state:'not_started',qualification:'fixture_only',financial_effect:false};
  if(o.source_identity!==this.#adapter.identity)throw new Error('NATIVE_SOURCE_MISMATCH');
  const record=o.native_body?JSON.parse(o.native_body):null;if(record&&contentDigest(record)!==o.native_digest)throw new Error('NATIVE_RETURN_INTEGRITY');
  return {id:o.id,request_id:r.id,state:o.state,native:record,qualification:'fixture_only',retry_allowed:false,financial_effect:false};}
 async create(scope:Scope,requestId:string){const k=this.#k;
  const prepared=k.transaction(()=>{const inspected=this.#request(scope,requestId,'operation.read');const {s,r}=inspected;
   const old=k.db.prepare('SELECT * FROM commerce_native_return_operations WHERE tenant_id=? AND store_id=? AND request_id=?').get(s.tenant_id,s.store_id,r.id) as Row;
   if(old){if(old.request_digest!==inspected.request_digest||old.source_identity!==this.#adapter.identity)throw new Error('NATIVE_SOURCE_MISMATCH');return {existing:true,ctx:inspected};}
   assertRecoveryEgress(k);const ctx=this.#request(scope,requestId);
   assertReady(k,s,DRAFT_ACTION);const controls=assertExecution(k,s,'diagnostic.return.create');
   const ref='nret_'+contentDigest([s.tenant_id,s.store_id,r.id]).slice(0,40);
   // Persist uncertainty before invoking a non-idempotent provider mutation. A crash
   // after this point requires read-only reconciliation, never a fresh create.
   k.db.prepare("INSERT INTO commerce_native_return_operations VALUES(?,?,?, ?,?,'unknown',?,NULL,NULL,NULL,?)").run(s.tenant_id,s.store_id,ref,r.id,this.#adapter.identity,ctx.request_digest,k.clock());
   k.db.prepare("UPDATE commerce_return_requests SET state='native_unknown' WHERE tenant_id=? AND store_id=? AND id=?").run(s.tenant_id,s.store_id,r.id);
   return {existing:false,ctx,controls};});
  if(prepared.existing)return this.read(scope,requestId);
  try{
   const current=this.#request(scope,requestId);assertExecution(k,current.s,'diagnostic.return.create',prepared.controls!.stamp);assertReady(k,current.s,DRAFT_ACTION);
   if(current.request_digest!==prepared.ctx.request_digest)throw new Error('NATIVE_SOURCE_MISMATCH');
   const response=await this.#adapter.create(current.input);
   k.transaction(()=>{const ctx=this.#request(scope,requestId);if(ctx.request_digest!==prepared.ctx.request_digest)throw new Error('NATIVE_SOURCE_MISMATCH');
    if(response.rejected)k.db.prepare("UPDATE commerce_native_return_operations SET state='rejected',observed_at=? WHERE tenant_id=? AND store_id=? AND request_id=?").run(k.clock(),ctx.s.tenant_id,ctx.s.store_id,requestId);
    else this.#record(ctx,response.record);
   });
  }catch{
   // Never infer no effect from an exception, malformed response, or late authority change.
  }
  return this.read(scope,requestId);
 }
 #record(ctx:Row,record:Row){const k=this.#k,{s,r}=ctx;
  const old=k.db.prepare('SELECT * FROM commerce_native_return_operations WHERE tenant_id=? AND store_id=? AND request_id=?').get(s.tenant_id,s.store_id,r.id) as Row;
  if(old.native_id&&old.native_id!==record.id)throw new Error('NATIVE_RETURN_MISMATCH');
  k.db.prepare("UPDATE commerce_native_return_operations SET state='created',native_id=?,native_body=?,native_digest=?,observed_at=? WHERE tenant_id=? AND store_id=? AND request_id=?").run(record.id,canonical(record),contentDigest(record),k.clock(),s.tenant_id,s.store_id,r.id);
  k.db.prepare("UPDATE commerce_return_requests SET state='native_created' WHERE tenant_id=? AND store_id=? AND id=?").run(s.tenant_id,s.store_id,r.id);
 }
 async reconcile(scope:Scope,requestId:string,nativeId:string){const before=this.#request(scope,requestId,'operation.reconcile'),k=this.#k;
  const old=k.db.prepare('SELECT * FROM commerce_native_return_operations WHERE tenant_id=? AND store_id=? AND request_id=?').get(before.s.tenant_id,before.s.store_id,requestId) as Row;
  if(!old||old.source_identity!==this.#adapter.identity||old.request_digest!==before.request_digest)throw new Error('NATIVE_SOURCE_MISMATCH');
  if(old.native_id&&old.native_id!==nativeId)throw new Error('NATIVE_RETURN_MISMATCH');
  const record=await this.#adapter.lookup(nativeId,before.input);
  k.transaction(()=>{const current=this.#request(scope,requestId,'operation.reconcile');if(current.request_digest!==before.request_digest)throw new Error('NATIVE_SOURCE_MISMATCH');this.#record(current,record);});
  return this.read(scope,requestId);
 }
}
