import { exact,id,integer,token } from './kernel.mts';
import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { money } from './money.mts';
import { permissionDecision } from './authorization.mts';
import { assertRecoveryEgress } from './data-guards.mts';
import { assertExecution } from './execution-stops.mts';
import { SupplierPurchaseOrders } from './supplier-purchase-orders.mts';
import { procurementResult } from '../adapters/procurement-fixture-source.mts';
import { bindProcurementSourceGuard } from '../adapters/procurement-source-guards.mts';
import { PROCUREMENT_SEND_ACTION,procurementBody,procurementRow,procurementScope,procurementPo,procurementReference,procurementSourceScope,procurementSend,procurementCurrentAuthor,procurementResourcePin,assertProcurementSeparation,revokeUnusedProcurementApprovals,storeProcurementHeader } from './procurement-core.mts';

export class ProcurementApprovals {
 readonly k:CommerceKernel;readonly orders:SupplierPurchaseOrders;readonly deadline_ms:number;
 constructor(k:CommerceKernel,orders:SupplierPurchaseOrders,options:{deadline_ms?:number}={}){if(!(orders instanceof SupplierPurchaseOrders)||orders.k!==k)throw new Error('CANONICAL_PURCHASE_ORDERS_REQUIRED');this.k=k;this.orders=orders;this.deadline_ms=options.deadline_ms??1000;integer(this.deadline_ms,1);if(this.deadline_ms>1000)throw new Error('INVALID_INPUT');}
 #obligations(s:Row,budgetId:string){const rows=this.k.db.prepare("SELECT * FROM commerce_procurement_reservations WHERE tenant_id=? AND store_id=? AND budget_id=? AND state IN ('reserved','unknown','committed') ORDER BY id").all(s.tenant_id,s.store_id,budgetId) as Row[];let total=0n;
  for(const row of rows){const b=procurementBody(row);if(b.amount_minor!==row.amount_minor||b.currency_code!==row.currency_code||b.budget_id!==row.budget_id||b.po_id!==row.po_id||b.po_version!==row.po_version)throw new Error('PROCUREMENT_RESERVATION_INTEGRITY');money(row.currency_code,row.amount_minor);total+=BigInt(row.amount_minor);}return {total,rows};
 }
 configureBudget(scope:Scope,input:unknown){const p=exact(jsonValue(input),['budget_id','resource_id','expected_revision','currency_code','limit_minor','approval_limit_minor','expires_at']);id(p.budget_id);integer(p.expected_revision);integer(p.expires_at);money(p.currency_code,p.limit_minor);money(p.currency_code,p.approval_limit_minor);
  return this.k.transaction(()=>{const {s}=procurementScope(this.k,scope,p.resource_id,'action.configure'),old=this.k.db.prepare('SELECT * FROM commerce_procurement_budgets WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,p.budget_id) as Row|undefined,before=old?procurementBody(old):null;
   if((before?.revision??0)!==p.expected_revision||old&&old.resource_id!==p.resource_id)throw new Error('PROCUREMENT_BUDGET_CHANGED');
   const held=this.#obligations(s,p.budget_id);if(p.expires_at<=this.k.clock()||p.expires_at>this.k.clock()+366*86400000||BigInt(p.approval_limit_minor)>BigInt(p.limit_minor)||BigInt(p.approval_limit_minor)===0n||held.total>BigInt(p.limit_minor)||held.rows.some(row=>row.currency_code!==p.currency_code))throw new Error('PROCUREMENT_BUDGET_INVALID');
   const body={id:p.budget_id,resource_id:p.resource_id,revision:p.expected_revision+1,currency_code:p.currency_code,limit_minor:p.limit_minor,approval_limit_minor:p.approval_limit_minor,expires_at:p.expires_at,configured_by:s.actor_id,configured_at:this.k.clock()};
   this.k.db.prepare('INSERT INTO commerce_procurement_budgets VALUES(?,?,?,?,?,?,?) ON CONFLICT(tenant_id,store_id,id) DO UPDATE SET state=excluded.state,body=excluded.body,digest=excluded.digest').run(s.tenant_id,s.store_id,p.budget_id,p.resource_id,'active',canonical(body),contentDigest(body));return this.budget(scope,p.budget_id);
  });
 }
 budget(scope:Scope,budgetId:string){const row=procurementRow(this.k,scope,'commerce_procurement_budgets',budgetId),s=this.k.require(scope),held=this.#obligations(s,budgetId),b=row.body;
  if(held.rows.some(value=>value.currency_code!==b.currency_code)||held.total>BigInt(b.limit_minor))throw new Error('PROCUREMENT_BUDGET_INTEGRITY');
  return {...b,digest:row.digest,state:row.state,obligated_minor:held.total.toString(),remaining_minor:(BigInt(b.limit_minor)-held.total).toString(),payment_observed:false};
 }
 #supplier(scope:Scope,po:Row){const {s,r}=procurementScope(this.k,scope,po.resource_id);procurementSourceScope(this.k,s,this.orders.source);
  if(po.source_identity!==this.orders.source.identity||procurementResourcePin(r)!==po.resource_digest)throw new Error('PROCUREMENT_SOURCE_OR_RESOURCE_CHANGED');
  return this.orders.supplier(scope,{supplier_id:po.supplier_id,resource_id:po.resource_id,expected_terms_digest:po.supplier_terms_digest});
 }
 #approval(scope:Scope,po:Row){const s=this.k.require(scope),rows=this.k.db.prepare("SELECT * FROM commerce_procurement_approvals WHERE tenant_id=? AND store_id=? AND po_id=? AND po_version=? AND state='approved' ORDER BY id").all(s.tenant_id,s.store_id,po.id,po.version) as Row[];
  const matched=rows.map(row=>({...row,body:procurementBody(row)})).filter(row=>row.body.po_digest===po.digest);if(matched.length!==1)throw new Error('PROCUREMENT_APPROVAL_REQUIRED');const row=matched[0],a=row.body;
  if(a.expires_at<=this.k.clock())throw new Error('PROCUREMENT_APPROVAL_EXPIRED');
  const member=this.k.db.prepare('SELECT * FROM commerce_members WHERE tenant_id=? AND store_id=? AND actor_id=? AND active=1').get(s.tenant_id,s.store_id,a.approver) as Row|undefined,permission=member&&permissionDecision(this.k.db,member,'action.approve',po.resource_id);
  if(!permission?.allowed||permission.authority_revision!==a.authority_revision)throw new Error('PROCUREMENT_APPROVER_AUTHORITY_CHANGED');
  for(const author of po.drafting_authority){assertProcurementSeparation(author.actor_id,a.approver);procurementCurrentAuthor(this.k,s,author.actor_id,po.resource_id,author.authority_revision);}
  const budget=this.budget(scope,a.budget_id);if(budget.digest!==a.budget_digest||budget.state!=='active'||budget.expires_at<=this.k.clock()||budget.resource_id!==po.resource_id||budget.currency_code!==po.currency_code||BigInt(po.total_minor)>BigInt(budget.approval_limit_minor))throw new Error('PROCUREMENT_BUDGET_CHANGED');
  const reservation=procurementRow(this.k,scope,'commerce_procurement_reservations',a.reservation_id);
  if(!['reserved','unknown','committed'].includes(reservation.state)||reservation.body.approval_id!==row.id||reservation.amount_minor!==po.total_minor||reservation.currency_code!==po.currency_code||reservation.body.po_digest!==po.digest)throw new Error('PROCUREMENT_RESERVATION_CHANGED');
  return {...row,budget,reservation};
 }
 approve(scope:Scope,input:unknown){const p=exact(jsonValue(input),['po_id','version','expected_digest','budget_id','expires_at']);integer(p.expires_at);id(p.budget_id);const ref={po_id:p.po_id,version:p.version,expected_digest:p.expected_digest};
  return this.k.transaction(()=>{const po=procurementPo(this.k,scope,ref),s=this.k.authorize(scope,'action.approve',po.resource_id);if(po.version!==po.current_version||po.authority_revoked||procurementSend(this.k,s,po.id,po.version))throw new Error('PROCUREMENT_PO_NOT_APPROVABLE');
   for(const author of po.drafting_authority){assertProcurementSeparation(author.actor_id,s.actor_id);procurementCurrentAuthor(this.k,s,author.actor_id,po.resource_id,author.authority_revision);}
   const terms=this.#supplier(scope,po),budget=this.budget(scope,p.budget_id);if(budget.state!=='active'||budget.resource_id!==po.resource_id||budget.currency_code!==po.currency_code||budget.expires_at<=this.k.clock()||BigInt(po.total_minor)>BigInt(budget.approval_limit_minor))throw new Error('PROCUREMENT_BUDGET_LIMIT');
   if(p.expires_at<=this.k.clock()||p.expires_at>Math.min(terms.expires_at,budget.expires_at,this.k.clock()+86400000))throw new Error('PROCUREMENT_APPROVAL_EXPIRED');
   const old=this.k.db.prepare("SELECT 1 FROM commerce_procurement_approvals WHERE tenant_id=? AND store_id=? AND po_id=? AND po_version=? AND state='approved'").get(s.tenant_id,s.store_id,po.id,po.version);
   if(old)throw new Error('PROCUREMENT_APPROVAL_ALREADY_RECORDED');
   const held=this.#obligations(s,p.budget_id);if(held.total+BigInt(po.total_minor)>BigInt(budget.limit_minor))throw new Error('PROCUREMENT_BUDGET_EXCEEDED');
   const approvalId='po_approval_'+token().slice(0,28),reservationId='po_reserve_'+token().slice(0,28),control=assertExecution(this.k,s,PROCUREMENT_SEND_ACTION);
   const body={id:approvalId,po_id:po.id,po_version:po.version,po_digest:po.digest,resource_id:po.resource_id,approver:s.actor_id,authority_revision:permissionDecision(this.k.db,s,'action.approve',po.resource_id).authority_revision,budget_id:p.budget_id,budget_digest:budget.digest,reservation_id:reservationId,total_minor:po.total_minor,currency_code:po.currency_code,expires_at:p.expires_at,control_stamp:control.stamp,approved_at:this.k.clock()};
   const reservation={id:reservationId,budget_id:p.budget_id,po_id:po.id,po_version:po.version,po_digest:po.digest,approval_id:approvalId,amount_minor:po.total_minor,currency_code:po.currency_code,created_at:this.k.clock()};
   this.k.db.prepare('INSERT INTO commerce_procurement_approvals VALUES(?,?,?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,approvalId,po.resource_id,po.id,po.version,'approved',canonical(body),contentDigest(body));
   this.k.db.prepare('INSERT INTO commerce_procurement_reservations VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,reservationId,po.resource_id,p.budget_id,po.id,po.version,'reserved',po.total_minor,po.currency_code,canonical(reservation),contentDigest(reservation));
   const header=procurementRow(this.k,scope,'commerce_purchase_orders',po.id);storeProcurementHeader(this.k,s,po.id,po.version,'approved',header.body);this.k.audit(scope,'procurement_po_approved','allowed');return {...body,digest:contentDigest(body),state:'approved'};
  });
 }
 revoke(scope:Scope,approvalId:string){return this.k.transaction(()=>{const a=procurementRow(this.k,scope,'commerce_procurement_approvals',approvalId,'action.approve'),s=this.k.require(scope);
  this.k.db.prepare("UPDATE commerce_procurement_approvals SET state='revoked' WHERE tenant_id=? AND store_id=? AND id=?").run(s.tenant_id,s.store_id,a.id);
  if(!procurementSend(this.k,s,a.po_id,a.po_version))revokeUnusedProcurementApprovals(this.k,s,a.po_id,a.po_version);
  return {id:a.id,state:'revoked',supplier_cancellation:false,budget_released:!procurementSend(this.k,s,a.po_id,a.po_version)};
 });}
 #command(po:Row,operationId:string){return {schema_version:1,operation_id:operationId,tenant_id:this.orders.source.tenant,store_id:this.orders.source.store,resource_id:po.resource_id,source_identity:this.orders.source.identity,po_id:po.id,po_version:po.version,po_digest:po.digest,supplier_id:po.supplier_id,supplier_terms_version:po.supplier_terms_version,supplier_terms_digest:po.supplier_terms_digest,warehouse_source_identity:po.warehouse_source_identity,currency_code:po.currency_code,total_minor:po.total_minor,lines:po.lines.map((line:Row)=>{const {cancelled_quantity_base,...original}=line;return original;})};}
 #original(scope:Scope,operationId:string,action='operation.read'){const row=procurementRow(this.k,scope,'commerce_procurement_sends',operationId,action),s=this.k.require(scope);procurementSourceScope(this.k,s,this.orders.source);
  const c=row.body.command;if(c.operation_id!==row.id||c.po_id!==row.po_id||c.po_version!==row.po_version||c.resource_id!==row.resource_id||c.tenant_id!==s.tenant_id||c.store_id!==s.store_id||c.source_identity!==this.orders.source.identity||row.body.command_digest!==contentDigest(c))throw new Error('PROCUREMENT_SEND_INTEGRITY');return row;
 }
 originalCommand(scope:Scope,operationId:string){return jsonValue(this.#original(scope,operationId).body.command);}
 #current(scope:Scope,operationId:string){const row=this.#original(scope,operationId,'operation.dispatch'),s=this.k.authorize(scope,'action.execute',row.resource_id),po=procurementPo(this.k,scope,{po_id:row.po_id,version:row.po_version,expected_digest:row.body.command.po_digest});
  if(po.version!==po.current_version||po.authority_revoked||row.state!=='unknown')throw new Error('PROCUREMENT_SEND_NOT_CURRENT');
  if(s.actor_id!==row.body.sender_actor||permissionDecision(this.k.db,s,'operation.dispatch',po.resource_id).authority_revision!==row.body.sender_authority_revision)throw new Error('PROCUREMENT_SENDER_AUTHORITY_CHANGED');
  this.#supplier(scope,po);const approval=this.#approval(scope,po);if(approval.id!==row.body.approval_id||approval.digest!==row.body.approval_digest||approval.reservation.id!==row.body.reservation_id)throw new Error('PROCUREMENT_APPROVAL_CHANGED');
  assertRecoveryEgress(this.k);assertExecution(this.k,s,PROCUREMENT_SEND_ACTION,approval.body.control_stamp);
  if(contentDigest(this.#command(po,row.id))!==row.body.command_digest)throw new Error('PROCUREMENT_COMMAND_CHANGED');return {row,po,approval};
 }
 async #bounded<T>(call:()=>Promise<T>){let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([Promise.resolve().then(call),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('PROCUREMENT_SOURCE_TIMEOUT')),this.deadline_ms);})]);}finally{if(timer)clearTimeout(timer);}}
 async send(scope:Scope,input:unknown){const p=exact(jsonValue(input),['po_id','version','expected_digest','operation_id']);id(p.operation_id);const ref={po_id:p.po_id,version:p.version,expected_digest:p.expected_digest},po=procurementPo(this.k,scope,ref),s=this.k.authorize(scope,'action.execute',po.resource_id);this.k.authorize(scope,'operation.dispatch',po.resource_id);procurementSourceScope(this.k,s,this.orders.source);
  const previous=procurementSend(this.k,s,po.id,po.version);if(previous){if(previous.id!==p.operation_id)throw new Error('PROCUREMENT_ORIGINAL_SEND_REQUIRED');return procurementPo(this.k,scope,ref);}
  const prepared=this.k.transaction(()=>{const current=procurementPo(this.k,scope,ref);if(current.version!==current.current_version||current.authority_revoked)throw new Error('PROCUREMENT_PO_NOT_CURRENT');this.#supplier(scope,current);const approval=this.#approval(scope,current);
   assertRecoveryEgress(this.k);assertExecution(this.k,s,PROCUREMENT_SEND_ACTION,approval.body.control_stamp);const command=this.#command(current,p.operation_id),body={command,command_digest:contentDigest(command),approval_id:approval.id,approval_digest:approval.digest,reservation_id:approval.reservation.id,sender_actor:s.actor_id,sender_authority_revision:permissionDecision(this.k.db,s,'operation.dispatch',current.resource_id).authority_revision,result:null,attempted_at:this.k.clock()};
   this.k.db.prepare('INSERT INTO commerce_procurement_sends VALUES(?,?,?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,p.operation_id,current.resource_id,current.id,current.version,'unknown',canonical(body),contentDigest(body));
   this.k.db.prepare("UPDATE commerce_procurement_reservations SET state='unknown' WHERE tenant_id=? AND store_id=? AND id=?").run(s.tenant_id,s.store_id,approval.reservation.id);return command;
  });
  let active=true,dispose:(()=>void)|undefined;
  try{dispose=bindProcurementSourceGuard(this.orders.source.db,prepared,()=>{if(!active)throw new Error('PROCUREMENT_GUARD_ATTEMPT_CLOSED');this.#current(scope,p.operation_id);active=false;});this.#current(scope,p.operation_id);
   const result=await this.#bounded(()=>this.orders.source.send(prepared));return this.k.transaction(()=>this.#record(scope,p.operation_id,result));
  }catch{return procurementPo(this.k,scope,ref);}finally{active=false;dispose?.();}
 }
 #record(scope:Scope,operationId:string,value:Row){const row=this.#original(scope,operationId),s=this.k.require(scope),result=procurementResult(row.body.command,value),previous=row.body.result;
  if(previous){if(result.native_id!==previous.native_id||result.source_version<previous.source_version)throw new Error('PROCUREMENT_SOURCE_STAGE_REGRESSION');if(result.source_version===previous.source_version){if(result.digest!==previous.digest)throw new Error('PROCUREMENT_SOURCE_VERSION_CONFLICT');return procurementPo(this.k,scope,{po_id:row.po_id,version:row.po_version,expected_digest:row.body.command.po_digest});}
   if(previous.stage==='acknowledged'&&result.stage!=='acknowledged'||previous.cancelled.some((entry:Row)=>!result.cancelled.some((current:Row)=>canonical(entry)===canonical(current))))throw new Error('PROCUREMENT_SOURCE_STAGE_REGRESSION');
  }
  const body={...row.body,result};this.k.db.prepare('UPDATE commerce_procurement_sends SET state=?,body=?,digest=? WHERE tenant_id=? AND store_id=? AND id=?').run(result.stage,canonical(body),contentDigest(body),s.tenant_id,s.store_id,row.id);
  this.k.db.prepare("UPDATE commerce_procurement_reservations SET state='committed' WHERE tenant_id=? AND store_id=? AND id=?").run(s.tenant_id,s.store_id,row.body.reservation_id);
  return procurementPo(this.k,scope,{po_id:row.po_id,version:row.po_version,expected_digest:row.body.command.po_digest});
 }
 async reconcile(scope:Scope,input:unknown){const p=procurementReference(input),po=procurementPo(this.k,scope,p),s=this.k.authorize(scope,'operation.reconcile',po.resource_id),original=procurementSend(this.k,s,po.id,po.version);
  if(!original)throw new Error('PROCUREMENT_SEND_NOT_FOUND');const row=this.#original(scope,original.id,'operation.reconcile');let result:Row|null;
  try{result=await this.#bounded(()=>this.orders.source.lookup(row.id));}catch{return procurementPo(this.k,scope,p);}if(!result)return procurementPo(this.k,scope,p);return this.k.transaction(()=>this.#record(scope,row.id,result));
 }
}
