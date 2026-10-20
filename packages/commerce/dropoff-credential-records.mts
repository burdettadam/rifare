import {id,integer} from './kernel.mts';
import type {CommerceKernel,Scope,Row} from './kernel.mts';
import {canonical,contentDigest} from './configuration-values.mts';
import {permissionDecision} from './authorization.mts';
import {subjectHash} from './data-guards.mts';
import {appendReceipt,receiptFields} from './operation-receipts.mts';
import {DROPOFF_ISSUE_ACTION,DROPOFF_REVOKE_ACTION,DROPOFF_CREDENTIAL_ACTIONS,DROPOFF_CREDENTIAL_CONTRACT,DROPOFF_QUOTE_KIND,DROPOFF_OPERATION_KIND,DROPOFF_CREDENTIAL_LIMIT,DROPOFF_BINDING_FIELDS,dropoffShape,dropoffHash,dropoffCommand,dropoffResult,dropoffTerms,dropoffOperationId,dropoffHuman} from './dropoff-credential-values.mts';

const COMMON=['schema_version','kind','id',...DROPOFF_BINDING_FIELDS,'created_at','authority_revoked','minimized','source_cleanup'];
const QUOTE_FIELDS=[...COMMON,'terms_digest','consumed_by','terms'];
const OP_FIELDS=[...COMMON,'quote_id','quote_digest','command_digest','state','reason','attempt_count','native_revision','restored','personal','observation'];
const PERSONAL_FIELDS=['case_id','receipt_id','preview_id','preview_digest','approval_id','executor','approver'];
const ROW_FIELDS=['tenant_id','store_id','kind','id','version','body','digest','author','state','reviewer','review_digest','created_at','expires_at'];
const RECEIPT_FIELDS=['id','tenant_id','store_id','operation_id','actor_ref','resource_ref','action','payload_hash','state','operation_revision','code','source_ref','approval_ref','configuration_digest','policy_digest','correction_of','correction_reason','payload_ref','previous_digest','observed_at','financial_effect'];
const GATEWAY_FIELDS=['id','case_id','preview_id','preview_digest','approval_id','configuration_digest','case_revision','resource_version','actor_id','authority_revision','action','effect','dropoff_operation_id','state','financial_effect','approval_consumed','completed_at'];
export const DROPOFF_RECORD_TABLES=['commerce_support_documents','commerce_operations','commerce_operation_work','commerce_operation_targets','commerce_operation_controls','commerce_operation_receipts','commerce_action_receipts','commerce_action_previews','commerce_action_approvals','commerce_restored_operations'];
const MAPPING:Record<string,string[]>= {authorized:['queued','pending'],unknown:['unknown','unknown'],issued:['succeeded','done'],revoked:['succeeded','done'],rejected:['failed','dead'],cancelled:['failed','dead']};
export type DropoffRecord=Row&{body:Row};
export type DropoffOriginal=Record<string,Row[]>;

function rows(k:CommerceKernel,s:Row,table:string,where:Row={},limit=DROPOFF_CREDENTIAL_LIMIT+1,original?:DropoffOriginal):Row[] {
  if(!DROPOFF_RECORD_TABLES.includes(table))throw new Error('DROPOFF_CREDENTIAL_INTEGRITY');
  const match={tenant_id:s.tenant_id,store_id:s.store_id,...where};
  if(original)return (original[table]??[]).filter(r=>Object.entries(match).every(([key,value])=>r[key]===value)).slice(0,limit);
  return k.db.prepare('SELECT * FROM '+table+' WHERE '+Object.keys(match).map(key=>key+'=?').join(' AND ')+(table==='commerce_operation_receipts'?' ORDER BY seq':'')+' LIMIT ?').all(...Object.values(match),limit) as Row[];
}
function one(k:CommerceKernel,s:Row,table:string,where:Row,original?:DropoffOriginal):Row {
  const found=rows(k,s,table,where,2,original);if(found.length!==1)throw new Error('DROPOFF_CREDENTIAL_INTEGRITY');return found[0];
}
export function checkedDropoffRow(value:Row):DropoffRecord {
  const r=dropoffShape(value,ROW_FIELDS,131072);if(![DROPOFF_QUOTE_KIND,DROPOFF_OPERATION_KIND].includes(r.kind)||typeof r.body!=='string')throw new Error('DROPOFF_CREDENTIAL_INTEGRITY');
  const b=dropoffShape(JSON.parse(r.body),r.kind===DROPOFF_QUOTE_KIND?QUOTE_FIELDS:OP_FIELDS);dropoffHash(r.digest);
  for(const key of ['tenant_id','store_id','kind','id'])if(r[key]!==b[key])throw new Error('DROPOFF_CREDENTIAL_INTEGRITY');
  for(const key of ['id','tenant_id','store_id','resource_id','source_account_id','site_id','destination_id','method_id'])id(b[key]);
  for(const key of ['source_identity','directory_identity','family_ref','subject_ref','items_digest','method_digest','fees_digest'])dropoffHash(b[key]);
  for(const key of ['generation','expires_at','credential_expires_at'])integer(b[key],1);integer(b.created_at);
  if(b.replaces_operation_id!==null)id(b.replaces_operation_id);
  if(b.action===DROPOFF_ISSUE_ACTION){if(b.issue_operation_id!==null||(b.generation===1)!==(b.replaces_operation_id===null))throw new Error('DROPOFF_CREDENTIAL_INTEGRITY');}else id(b.issue_operation_id);
  if(contentDigest(b)!==r.digest||b.schema_version!==1||!DROPOFF_CREDENTIAL_ACTIONS.includes(b.action)||!['qr','code'].includes(b.credential_kind)||typeof b.authority_revoked!=='boolean'||typeof b.minimized!=='boolean'||b.minimized&&!b.authority_revoked||!['not_requested','pending','forgotten'].includes(b.source_cleanup)||b.source_cleanup!=='not_requested'&&!b.authority_revoked||b.expires_at<=b.created_at||r.version!==1||r.author!=='dropoff_credentials'||r.reviewer!==null||r.review_digest!==null||r.created_at!==b.created_at||r.expires_at!==b.expires_at||r.state!==(b.authority_revoked?'revoked':'active'))throw new Error('DROPOFF_CREDENTIAL_INTEGRITY');
  if(r.kind===DROPOFF_QUOTE_KIND){
    dropoffHash(b.terms_digest);if(b.consumed_by!==null)id(b.consumed_by);
    if(b.minimized){if(b.terms!==null)throw new Error('DROPOFF_CREDENTIAL_INTEGRITY');}
    else {
      const q=dropoffTerms(b.terms);
      if(contentDigest(q)!==b.terms_digest||q.quote_id!==b.id||q.subject_ref!==subjectHash(b.tenant_id,b.store_id,q.customer_id)||q.created_at!==b.created_at)throw new Error('DROPOFF_CREDENTIAL_INTEGRITY');
      for(const key of DROPOFF_BINDING_FIELDS)if(q[key]!==b[key])throw new Error('DROPOFF_CREDENTIAL_INTEGRITY');
    }
  }else{
    id(b.quote_id);dropoffHash(b.quote_digest);dropoffHash(b.command_digest);integer(b.attempt_count);integer(b.native_revision,1);
    if(!Object.hasOwn(MAPPING,b.state)||b.attempt_count>1||typeof b.restored!=='boolean'||b.restored&&!b.authority_revoked||typeof b.reason!=='string')throw new Error('DROPOFF_CREDENTIAL_INTEGRITY');
    if(b.minimized){if(b.personal!==null)throw new Error('DROPOFF_CREDENTIAL_INTEGRITY');}
    else {const p=dropoffShape(b.personal,PERSONAL_FIELDS);for(const key of PERSONAL_FIELDS)key==='preview_digest'?dropoffHash(p[key]):id(p[key]);if(p.executor===p.approver)throw new Error('DROPOFF_CREDENTIAL_INTEGRITY');}
    if(b.state==='authorized'&&(b.attempt_count!==0||b.restored||b.reason!=='DROPOFF_AUTHORIZED')||b.state==='unknown'&&(b.attempt_count===0&&!b.restored||b.reason!=='DROPOFF_OUTCOME_UNKNOWN')||b.state==='cancelled'&&(b.attempt_count!==0||b.restored||b.reason!=='DROPOFF_CANCELLED'))throw new Error('DROPOFF_CREDENTIAL_INTEGRITY');
    if(['authorized','unknown','cancelled'].includes(b.state)&&b.observation!==null||['issued','revoked','rejected'].includes(b.state)&&b.observation===null||b.state==='issued'&&b.action!==DROPOFF_ISSUE_ACTION||b.state==='revoked'&&b.action!==DROPOFF_REVOKE_ACTION)throw new Error('DROPOFF_CREDENTIAL_INTEGRITY');
  }
  return {...r,body:b};
}
export function dropoffQuoteRecord(k:CommerceKernel,s:Row,quoteId:string,original?:DropoffOriginal) {
  return checkedDropoffRow(one(k,s,'commerce_support_documents',{kind:DROPOFF_QUOTE_KIND,id:id(quoteId)},original));
}
/** The approval projection is rooted in a canonical stored quote. The actual
 * reviewer remains the authenticated caller; this returns no substitute Scope. */
export function dropoffReviewContext(k:CommerceKernel,scope:Scope,quoteId:string) {
  const s=dropoffHuman(k,scope),r=dropoffQuoteRecord(k,s,quoteId),b=r.body;
  if(b.authority_revoked||b.minimized||!b.terms||b.expires_at<=k.clock()||b.terms.owner===s.actor_id)throw new Error('DROPOFF_QUOTE_UNAVAILABLE');
  k.authorize(scope,'action.approve',b.resource_id);k.authorize(scope,'support.read',b.resource_id);return b.terms;
}
function gatewayReceipt(k:CommerceKernel,s:Row,c:Row,q:DropoffRecord,original?:DropoffOriginal) {
  const row=one(k,s,'commerce_action_receipts',{id:c.source_id},original),b=dropoffShape(JSON.parse(row.body),GATEWAY_FIELDS);
  for(const key of ['id','case_id','preview_id','approval_id','actor_id','dropoff_operation_id'])id(b[key]);for(const key of ['preview_digest','configuration_digest'])dropoffHash(b[key]);
  integer(b.case_revision,1);integer(b.resource_version,1);integer(b.authority_revision);integer(b.completed_at);
  if(row.id!==b.id||row.case_id!==b.case_id||row.preview_id!==b.preview_id||contentDigest(b)!==row.digest||row.digest!==c.source_digest||b.dropoff_operation_id!==c.operation_id||b.action!==c.action||b.effect!=='synthetic_dropoff_authorized'||b.state!=='authorized'||b.financial_effect!==false||b.approval_consumed!==true)throw new Error('DROPOFF_CREDENTIAL_INTEGRITY');
  const t=q.body.terms;if(t&&(b.case_id!==t.case_id||b.configuration_digest!==t.configuration_digest||b.case_revision!==t.case_revision||b.resource_version!==t.resource_version||b.actor_id!==t.owner||b.completed_at<t.created_at||b.completed_at>=t.expires_at))throw new Error('DROPOFF_CREDENTIAL_INTEGRITY');return b;
}
function auditChain(k:CommerceKernel,s:Row,op:Row,b:Row,receipt:Row,original?:DropoffOriginal) {
  const history=rows(k,s,'commerce_operation_receipts',{operation_id:op.id},4,original).sort((a,b)=>a.seq-b.seq);
  const length=({authorized:1,unknown:2,issued:3,revoked:3,rejected:3,cancelled:2} as Row)[b.state];
  if(history.length!==length)throw new Error('DROPOFF_CREDENTIAL_INTEGRITY');
  let previous:string|null=null;const result:Row[]=[];
  for(let i=0;i<history.length;i++){
    const r=history[i],v=dropoffShape(JSON.parse(r.body),RECEIPT_FIELDS);id(v.actor_ref);integer(v.observed_at);
    if(contentDigest(v)!==r.digest||v.id!==r.id||v.operation_id!==op.id||r.operation_id!==op.id||v.tenant_id!==s.tenant_id||v.store_id!==s.store_id||v.resource_ref!==op.resource_id||v.action!==b.action||v.payload_hash!==op.payload_hash||v.previous_digest!==previous||v.financial_effect!==false||v.operation_revision!==i+1||v.correction_of!==null||v.correction_reason!==null||v.payload_ref!==null)throw new Error('DROPOFF_CREDENTIAL_INTEGRITY');
    for(const key of ['source_ref','approval_ref'])if(v[key]!==null)id(v[key]);for(const key of ['configuration_digest','policy_digest'])if(v[key]!==null)dropoffHash(v[key]);
    previous=r.digest;result.push(v);
  }
  const first=result[0],last=result.at(-1)!,code=({authorized:'queued',unknown:'outcome_unknown',issued:'source_confirmed',revoked:'source_confirmed',rejected:'provider_rejected',cancelled:'credential_cancelled'} as Row)[b.state];
  if(first.code!=='queued'||first.state!=='queued'||first.source_ref!==op.source_id||first.approval_ref!==receipt.approval_id||first.configuration_digest!==receipt.configuration_digest||last.operation_revision!==op.revision||last.state!==op.state||last.code!==code)throw new Error('DROPOFF_CREDENTIAL_INTEGRITY');
  if(length>1&&b.state!=='cancelled'&&(result[1].code!=='outcome_unknown'||result[1].state!=='unknown')||['issued','revoked'].includes(b.state)&&last.source_ref!==b.observation.provider_ref)throw new Error('DROPOFF_CREDENTIAL_INTEGRITY');return result;
}
/** Native classification is entirely core-local. No live proof, provider,
 * current directory, key or owner attachment may grant an exemption here. */
export function dropoffOperationRecord(k:CommerceKernel,s:Row,operationId:string,original?:DropoffOriginal,allowMissingFence=false):Row|null {
  id(operationId);const natives=rows(k,s,'commerce_operations',{id:operationId},2,original),typed=rows(k,s,'commerce_support_documents',{kind:DROPOFF_OPERATION_KIND,id:operationId},2,original),op=natives[0];
  const claim=op&&DROPOFF_CREDENTIAL_ACTIONS.includes(JSON.parse(op.command).action);
  if(!claim&&!typed.length)return null;if(!claim||natives.length!==1||typed.length!==1)throw new Error('DROPOFF_CREDENTIAL_INTEGRITY');
  const record=checkedDropoffRow(typed[0]),b=record.body,command=dropoffCommand(JSON.parse(op.command)),quote=dropoffQuoteRecord(k,s,b.quote_id,original),q=quote.body;
  if(op.id!==b.id||op.id!==command.operation_id||op.id!==dropoffOperationId(s.tenant_id,s.store_id,op.source_id)||op.source_kind!=='case'||op.source_id!==command.source_id||op.resource_id!==b.resource_id||contentDigest(command)!==op.payload_hash||op.payload_hash!==b.command_digest||q.consumed_by!==b.id||q.terms_digest!==b.quote_digest||q.id!==command.quote_id||q.terms_digest!==command.quote_digest||op.created_at!==b.created_at||op.revision!==b.native_revision||op.state!==MAPPING[b.state][0])throw new Error('DROPOFF_CREDENTIAL_INTEGRITY');
  for(const key of DROPOFF_BINDING_FIELDS)if(command[key]!==b[key]||q[key]!==b[key])throw new Error('DROPOFF_CREDENTIAL_INTEGRITY');
  if(q.minimized!==b.minimized||b.minimized&&!q.authority_revoked)throw new Error('DROPOFF_CREDENTIAL_INTEGRITY');
  if(b.observation!==null){const outcome=dropoffResult(b.observation,command);if(outcome.state!==b.state||outcome.reason!==b.reason||outcome.provider_ref!==op.provider_ref||outcome.observed_at<q.created_at)throw new Error('DROPOFF_CREDENTIAL_INTEGRITY');}else if(op.provider_ref!==null)throw new Error('DROPOFF_CREDENTIAL_INTEGRITY');
  const work=one(k,s,'commerce_operation_work',{operation_id:op.id},original),target=one(k,s,'commerce_operation_targets',{operation_id:op.id},original),control=one(k,s,'commerce_operation_controls',{operation_id:op.id},original);
  if(work.state!==MAPPING[b.state][1]||work.attempts!==b.attempt_count||work.lease_token!==null||work.lease_until!==null||work.owner!==null||target.provider_id!==b.source_account_id||target.provider_identity!==b.source_identity||target.contract!==DROPOFF_CREDENTIAL_CONTRACT||control.revision!==1||q.terms&&control.stamp!==q.terms.control_stamp)throw new Error('DROPOFF_CREDENTIAL_INTEGRITY');
  integer(work.available_at);integer(op.updated_at);if(op.updated_at<op.created_at)throw new Error('DROPOFF_CREDENTIAL_INTEGRITY');
  const receipt=gatewayReceipt(k,s,command,quote,original),history=auditChain(k,s,op,b,receipt,original);let preview:Row|null=null,approval:Row|null=null;
  if(!b.minimized){
    const p=b.personal;preview=one(k,s,'commerce_action_previews',{id:p.preview_id},original);approval=one(k,s,'commerce_action_approvals',{id:p.approval_id},original);const v=JSON.parse(preview.body),a=dropoffShape(v.arguments,['quote_id','quote_digest']);
    if(p.case_id!==receipt.case_id||p.receipt_id!==receipt.id||p.preview_id!==receipt.preview_id||p.preview_digest!==receipt.preview_digest||p.approval_id!==receipt.approval_id||p.executor!==receipt.actor_id||p.executor!==q.terms.owner||preview.case_id!==p.case_id||preview.digest!==p.preview_digest||contentDigest(v)!==preview.digest||preview.proposer!==q.terms.owner||v.action!==b.action||v.tenant_id!==s.tenant_id||v.store_id!==s.store_id||v.resource_id!==b.resource_id||a.quote_id!==q.id||a.quote_digest!==q.terms_digest||v.expires_at!==q.expires_at||v.financial_effect!==false||approval.preview_id!==preview.id||approval.preview_digest!==preview.digest||approval.approver!==p.approver||approval.approver===preview.proposer||approval.uses!==1||approval.max_uses!==1||approval.expires_at!==q.expires_at)throw new Error('DROPOFF_CREDENTIAL_INTEGRITY');
  }
  if(b.action===DROPOFF_REVOKE_ACTION){
    const originalRow=one(k,s,'commerce_operations',{id:b.issue_operation_id},original);
    if(JSON.parse(originalRow.command).action!==DROPOFF_ISSUE_ACTION)throw new Error('DROPOFF_CREDENTIAL_INTEGRITY');
    const issued=dropoffOperationRecord(k,s,b.issue_operation_id,original,allowMissingFence)!;
    if(issued.record.body.state!=='issued')throw new Error('DROPOFF_CREDENTIAL_INTEGRITY');
    for(const key of ['tenant_id','store_id','resource_id','source_identity','source_account_id','directory_identity','family_ref','subject_ref','items_digest','method_digest','fees_digest','site_id','destination_id','method_id','credential_kind','generation','replaces_operation_id','credential_expires_at'])if(b[key]!==issued.command[key])throw new Error('DROPOFF_CREDENTIAL_INTEGRITY');
    if(b.state==='revoked'&&b.observation.credential_id!==issued.record.body.observation.credential_id)throw new Error('DROPOFF_CREDENTIAL_INTEGRITY');
  }
  if(b.restored&&!original&&!allowMissingFence&&!rows(k,s,'commerce_restored_operations',{operation_id:op.id},2).length)throw new Error('DROPOFF_CREDENTIAL_INTEGRITY');
  return {record,quote,native:op,command,work,target,control,receipt,history,preview,approval};
}
export function dropoffRecords(k:CommerceKernel,scope?:Row,original?:DropoffOriginal,allowMissingFence=false):DropoffRecord[] {
  const scopes:Row[]=scope?[scope]:original?[...new Map([...(original.commerce_support_documents??[]),...(original.commerce_operations??[])].map(r=>[canonical([r.tenant_id,r.store_id]),{tenant_id:r.tenant_id,store_id:r.store_id}])).values()]:k.db.prepare('SELECT tenant_id,store_id FROM commerce_stores').all() as Row[];const result:DropoffRecord[]=[];
  for(const s of scopes){
    const selected:DropoffRecord[]=[];for(const kind of [DROPOFF_QUOTE_KIND,DROPOFF_OPERATION_KIND]){const found=rows(k,s,'commerce_support_documents',{kind},DROPOFF_CREDENTIAL_LIMIT+1,original);if(found.length>DROPOFF_CREDENTIAL_LIMIT)throw new Error('DROPOFF_RECORD_LIMIT');selected.push(...found.map(checkedDropoffRow));}
    const ids=new Set(selected.map(r=>r.kind+':'+r.id));if(ids.size!==selected.length)throw new Error('DROPOFF_CREDENTIAL_INTEGRITY');
    for(const r of selected){if(r.kind===DROPOFF_OPERATION_KIND)dropoffOperationRecord(k,s,r.id,original,allowMissingFence);else if(r.body.consumed_by!==null){const op=selected.find(o=>o.kind===DROPOFF_OPERATION_KIND&&o.id===r.body.consumed_by);if(!op||op.body.quote_id!==r.id)throw new Error('DROPOFF_CREDENTIAL_INTEGRITY');}}
    const claimed=original?(original.commerce_operations??[]).filter(r=>r.tenant_id===s.tenant_id&&r.store_id===s.store_id&&DROPOFF_CREDENTIAL_ACTIONS.includes(JSON.parse(r.command).action)):k.db.prepare("SELECT id FROM commerce_operations WHERE tenant_id=? AND store_id=? AND json_extract(command,'$.action') IN (?,?) LIMIT ?").all(s.tenant_id,s.store_id,...DROPOFF_CREDENTIAL_ACTIONS,DROPOFF_CREDENTIAL_LIMIT+1) as Row[];
    if(claimed.length>DROPOFF_CREDENTIAL_LIMIT||claimed.some(op=>!ids.has(DROPOFF_OPERATION_KIND+':'+op.id)))throw new Error('DROPOFF_CREDENTIAL_INTEGRITY');result.push(...selected);
  }return result;
}
export function saveDropoffRecord(k:CommerceKernel,body:Row,existing=false) {
  if(!existing){const n=k.db.prepare('SELECT count(*) n FROM commerce_support_documents WHERE tenant_id=? AND store_id=? AND kind=?').get(body.tenant_id,body.store_id,body.kind) as Row;if(n.n>=DROPOFF_CREDENTIAL_LIMIT)throw new Error('DROPOFF_RECORD_LIMIT');}
  const r={tenant_id:body.tenant_id,store_id:body.store_id,kind:body.kind,id:body.id,version:1,body:canonical(body),digest:contentDigest(body),author:'dropoff_credentials',state:body.authority_revoked?'revoked':'active',reviewer:null,review_digest:null,created_at:body.created_at,expires_at:body.expires_at};checkedDropoffRow(r);
  if(existing){const n=k.db.prepare('UPDATE commerce_support_documents SET body=?,digest=?,state=? WHERE tenant_id=? AND store_id=? AND kind=? AND id=? AND version=1').run(r.body,r.digest,r.state,r.tenant_id,r.store_id,r.kind,r.id);if(n.changes!==1)throw new Error('DROPOFF_CREDENTIAL_INTEGRITY');}
  else k.db.prepare('INSERT INTO commerce_support_documents VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...ROW_FIELDS.map(key=>r[key]));return {...r,body};
}
export function dropoffView(value:Row) {
  const b=value.record?.body??value.body??value;return {schema_version:1,operation_id:b.id,action:b.action,state:b.state,reason:b.reason,attempt_count:b.attempt_count,generation:b.generation,replaces_operation_id:b.replaces_operation_id,issue_operation_id:b.issue_operation_id,credential_expires_at:b.credential_expires_at,provider_ref:b.observation?.provider_ref??null,authority_revoked:b.authority_revoked,restored:b.restored,minimized:b.minimized,source_cleanup:b.source_cleanup,command_digest:b.command_digest,source_identity:b.source_identity,observation:b.observation,execution_authorized:false,qualification:'synthetic_only',financial_effect:false};
}
export function authorizeDropoffRead(k:CommerceKernel,scope:Scope,value:Row,reconcile=false) {
  const s=dropoffHuman(k,scope),b=value.record.body;if(s.tenant_id!==b.tenant_id||s.store_id!==b.store_id)throw new Error('ACCESS_DENIED');
  const actions=reconcile?['operation.read','operation.reconcile']:['operation.read'];
  if(b.minimized||b.restored||b.authority_revoked){k.authorize(scope,'privacy.manage');for(const action of actions)if(!permissionDecision(k.db,s,action,b.resource_id).allowed)throw new Error('ACCESS_DENIED');}
  else for(const action of actions)k.authorize(scope,action,b.resource_id);return s;
}
export function transitionDropoff(k:CommerceKernel,s:Row,value:Row,state:string,reason:string,observation:Row|null=null,attempt=value.record.body.attempt_count,restored=value.record.body.restored) {
  const b=value.record.body,allowed=b.state==='authorized'?['unknown','cancelled']:b.state==='unknown'?[b.action===DROPOFF_ISSUE_ACTION?'issued':'revoked','rejected']:[];
  if(!allowed.includes(state)||state==='cancelled'&&(b.attempt_count!==0||b.restored)||attempt>1)throw new Error('DROPOFF_TRANSITION_DENIED');
  const provider=observation?.provider_ref??null,[native,work]=MAPPING[state],code=({unknown:'outcome_unknown',cancelled:'credential_cancelled',issued:'source_confirmed',revoked:'source_confirmed',rejected:'provider_rejected'} as Row)[state];
  k.db.prepare('UPDATE commerce_operations SET state=?,revision=revision+1,provider_ref=?,updated_at=? WHERE tenant_id=? AND store_id=? AND id=?').run(native,provider,k.clock(),b.tenant_id,b.store_id,b.id);
  k.db.prepare('UPDATE commerce_operation_work SET state=?,attempts=?,available_at=?,lease_token=NULL,lease_until=NULL,owner=NULL,last_code=? WHERE tenant_id=? AND store_id=? AND operation_id=?').run(work,attempt,k.clock(),reason,b.tenant_id,b.store_id,b.id);
  const op=k.db.prepare('SELECT * FROM commerce_operations WHERE tenant_id=? AND store_id=? AND id=?').get(b.tenant_id,b.store_id,b.id) as Row;appendReceipt(k,{...s,actor_id:s.actor_id??'dropoff_lifecycle'},op,receiptFields(code,provider));
  const body={...b,state,reason,attempt_count:attempt,native_revision:op.revision,restored,authority_revoked:b.authority_revoked||restored,observation};saveDropoffRecord(k,body,true);return body;
}
