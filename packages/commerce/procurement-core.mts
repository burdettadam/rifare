import { exact,id,integer } from './kernel.mts';
import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { permissionDecision } from './authorization.mts';
import { ProcurementFixtureSource,procurementResult } from '../adapters/procurement-fixture-source.mts';

export const PROCUREMENT_TABLES=Object.freeze(['commerce_procurement_suppliers','commerce_replenishment_drafts','commerce_purchase_orders','commerce_purchase_order_versions','commerce_procurement_budgets','commerce_procurement_approvals','commerce_procurement_reservations','commerce_procurement_sends']);
export const PROCUREMENT_SEND_ACTION='diagnostic.procurement.send';
export const PROCUREMENT_QUALIFICATION='synthetic_local_preparation_only';
export function initialPurchaseOrderState(){return {state:'draft',source_stage:'not_sent'};}
export function assertProcurementSeparation(draftedBy:string,approvingActor:string){
 if (draftedBy === approvingActor) throw new Error('PROCUREMENT_SELF_APPROVAL_DENIED');
}
export function procurementBody(row:Row|undefined,allowMinimized=false):Row{
 if(!row)throw new Error('NOT_FOUND');const body=jsonValue(JSON.parse(row.body));
 if(contentDigest(body)!==row.digest)throw new Error('PROCUREMENT_RECORD_INTEGRITY');
 if(body.redacted&&!allowMinimized)throw new Error('PROCUREMENT_RECORD_ERASED');return body;
}
export function procurementScope(k:CommerceKernel,scope:Scope,resource:string,action='resource.read'){
 const s=k.authorize(scope,action,id(resource)),r=k.get(scope,resource);
 if(r.kind!=='catalog'||r.customer_id!==null)throw new Error('PROCUREMENT_CATALOG_RESOURCE_REQUIRED');return {s,r};
}
export function procurementResourcePin(r:Row){return contentDigest({id:r.id,kind:r.kind,source_system:r.source_system,external_id:r.external_id,source_version:r.source_version,customer_id:r.customer_id,payload:r.payload});}
export function procurementSourceScope(k:CommerceKernel,s:Row,source:ProcurementFixtureSource){
 const file=(db:CommerceKernel['db'])=>(db.prepare('PRAGMA database_list').all() as Row[]).find(row=>row.name==='main')?.file;
 if(!(source instanceof ProcurementFixtureSource)||source.db===k.db||file(k.db)&&file(k.db)===file(source.db))throw new Error('SEPARATE_PROCUREMENT_SOURCE_REQUIRED');
 if(source.tenant!==s.tenant_id||source.store!==s.store_id)throw new Error('PROCUREMENT_SOURCE_SCOPE');
}
export function procurementRow(k:CommerceKernel,scope:Scope,table:string,ref:string,action='resource.read'){
 if(!PROCUREMENT_TABLES.includes(table))throw new Error('PROCUREMENT_TABLE_DENIED');const s=k.require(scope),row=k.db.prepare('SELECT * FROM '+table+' WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,id(ref)) as Row|undefined;
 if(!row)throw new Error('NOT_FOUND');procurementScope(k,scope,row.resource_id,action);return {...row,body:procurementBody(row)};
}
export function procurementReference(input:unknown){const p=exact(jsonValue(input),['po_id','version','expected_digest']);id(p.po_id);integer(p.version,1);if(typeof p.expected_digest!=='string'||!/^[a-f0-9]{64}$/.test(p.expected_digest))throw new Error('INVALID_INPUT');return p;}
export function procurementSend(k:CommerceKernel,s:Row,po:string,version:number){const row=k.db.prepare('SELECT * FROM commerce_procurement_sends WHERE tenant_id=? AND store_id=? AND po_id=? AND po_version=?').get(s.tenant_id,s.store_id,po,version) as Row|undefined;
 if(!row)return null;return {...row,body:procurementBody(row)};
}
/** Authenticated immutable PO lineage. Receipt state never lives in this module.
 * Historical read access does not grant receipt, spending or replay authority. */
export function procurementPo(k:CommerceKernel,scope:Scope,input:unknown):Row{
 const p=procurementReference(input),s=k.require(scope),header=procurementRow(k,scope,'commerce_purchase_orders',p.po_id),version=k.db.prepare('SELECT * FROM commerce_purchase_order_versions WHERE tenant_id=? AND store_id=? AND po_id=? AND version=?').get(s.tenant_id,s.store_id,p.po_id,p.version) as Row|undefined;
 if(!version)throw new Error('NOT_FOUND');const body=procurementBody(version);
 if(version.digest!==p.expected_digest||version.resource_id!==header.resource_id||body.id!==p.po_id||body.version!==p.version||body.resource_id!==header.resource_id)throw new Error('PROCUREMENT_PO_VERSION_CHANGED');
 const original=procurementSend(k,s,p.po_id,p.version);let result:Row|null=null;
 if(original){const command=original.body.command;
  if(command.operation_id!==original.id||command.po_id!==p.po_id||command.po_version!==p.version||command.po_digest!==version.digest||command.source_identity!==body.supplier_source_identity
   ||command.tenant_id!==s.tenant_id||command.store_id!==s.store_id||command.resource_id!==header.resource_id||original.body.command_digest!==contentDigest(command))throw new Error('PROCUREMENT_SEND_INTEGRITY');
  if(original.body.result)result=procurementResult(command,original.body.result);
 }
 const stage=original?.state??'not_sent',state=header.current_version!==p.version?'superseded':original?stage:header.state;
 const lines=body.lines.map((line:Row)=>({...line,cancelled_quantity_base:result?.cancelled.filter((entry:Row)=>entry.line_id===line.line_id).reduce((n:number,entry:Row)=>n+entry.quantity_base,0)??0}));
 return {...body,lines,id:p.po_id,digest:version.digest,version:p.version,current_version:header.current_version,state,authority_revoked:header.body.authority_revoked===true||version.state==='revoked_restore',
  source_identity:body.supplier_source_identity,source_stage:stage,source_version:result?.source_version??null,source_digest:result?.digest??null,
  operation_id:original?.id??null,native_id:result?.native_id??null,acknowledgment_ref:result?.acknowledgment_ref??null,cancellation_events:result?.cancelled??[],
  payment_state:'unobserved',invoice_state:'unobserved',qualification:PROCUREMENT_QUALIFICATION,external_qualified:false};
}
export function procurementCurrentAuthor(k:CommerceKernel,s:Row,actor:string,resource:string,revision:number){
 const member=k.db.prepare('SELECT * FROM commerce_members WHERE tenant_id=? AND store_id=? AND actor_id=? AND active=1').get(s.tenant_id,s.store_id,actor) as Row|undefined;
 const permission=member&&permissionDecision(k.db,member,'action.propose',resource);
 if(!permission?.allowed||permission.authority_revision!==revision)throw new Error('PROCUREMENT_DRAFTER_AUTHORITY_CHANGED');return member;
}
export function revokeUnusedProcurementApprovals(k:CommerceKernel,s:Row,po:string,version:number){
 if(procurementSend(k,s,po,version))throw new Error('PROCUREMENT_ORIGINAL_SEND_REQUIRED');
 k.db.prepare("UPDATE commerce_procurement_approvals SET state='revoked' WHERE tenant_id=? AND store_id=? AND po_id=? AND po_version=? AND state='approved'").run(s.tenant_id,s.store_id,po,version);
 k.db.prepare("UPDATE commerce_procurement_reservations SET state='released' WHERE tenant_id=? AND store_id=? AND po_id=? AND po_version=? AND state='reserved'").run(s.tenant_id,s.store_id,po,version);
}
export function storeProcurementHeader(k:CommerceKernel,s:Row,po:string,version:number,state:string,body:Row){
 k.db.prepare('UPDATE commerce_purchase_orders SET current_version=?,state=?,body=?,digest=? WHERE tenant_id=? AND store_id=? AND id=?').run(version,state,canonical(body),contentDigest(body),s.tenant_id,s.store_id,po);
}
