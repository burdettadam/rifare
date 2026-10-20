import {id,integer} from './kernel.mts';
import type {CommerceKernel,Scope,Row} from './kernel.mts';
import {canonical,contentDigest} from './configuration-values.mts';
import {permissionDecision} from './authorization.mts';
import {subjectHash} from './data-guards.mts';
import {appendReceipt,receiptFields,RECEIPT_CODES} from './operation-receipts.mts';
import {LOYALTY_REDEEM_ACTION,LOYALTY_REDEMPTION_CONTRACT,LOYALTY_QUOTE_KIND,LOYALTY_OPERATION_KIND,LOYALTY_REDEMPTION_LIMIT,REDEMPTION_STATES,redemptionShape,redemptionHash,redemptionCommand,redemptionResult,redemptionTerms,redemptionAccount,redemptionOperationId,redemptionBenefit,redemptionHuman} from './loyalty-redemption-values.mts';

const COMMON=['schema_version','kind','id','tenant_id','store_id','subject_ref','account_key','source_identity','source_account_id','resource_id','points','unit','benefit_id','benefit_digest','created_at','expires_at','authority_revoked','minimized'];
const QUOTE_FIELDS=[...COMMON,'terms_digest','consumed_by','terms'];
const OP_FIELDS=[...COMMON,'quote_id','quote_digest','command_digest','state','reason','attempt_count','native_revision','restored','personal','observation'];
const PERSONAL_FIELDS=['case_id','receipt_id','preview_id','preview_digest','approval_id','executor','approver'];
const ROW_FIELDS=['tenant_id','store_id','kind','id','version','body','digest','author','state','reviewer','review_digest','created_at','expires_at'];
const RECEIPT_FIELDS=['id','tenant_id','store_id','operation_id','actor_ref','resource_ref','action','payload_hash','state','operation_revision','code','source_ref','approval_ref','configuration_digest','policy_digest','correction_of','correction_reason','payload_ref','previous_digest','observed_at','financial_effect'];
const GATEWAY_RECEIPT_FIELDS=['id','case_id','preview_id','preview_digest','approval_id','configuration_digest','case_revision','resource_version','actor_id','authority_revision','effect','loyalty_operation_id','points','benefit','state','financial_effect','approval_consumed','completed_at'];
const TABLES=['commerce_support_documents','commerce_operations','commerce_operation_work','commerce_operation_targets','commerce_operation_controls','commerce_operation_receipts','commerce_action_receipts','commerce_action_previews','commerce_action_approvals','commerce_restored_operations'];
const MAPPING:Record<string,string[]>= {reserved:['queued','pending'],unknown:['unknown','unknown'],redeemed:['succeeded','done'],rejected:['failed','dead'],released:['failed','dead']};
export type LoyaltyRecord=Row&{body:Row};
type Original=Record<string,Row[]>;

/** Portable originals use the same validators before insertion or suppression.
 * The caller supplies an already envelope-validated native merchant package. */
function rows(k:CommerceKernel,s:Row,table:string,where:Row={},limit=LOYALTY_REDEMPTION_LIMIT+1,original?:Original):Row[] {
  if(!TABLES.includes(table))throw new Error('LOYALTY_REDEMPTION_INTEGRITY');
  const match={tenant_id:s.tenant_id,store_id:s.store_id,...where};
  if(original)return (original[table]??[]).filter(r=>Object.entries(match).every(([key,value])=>r[key]===value)).slice(0,limit);
  return k.db.prepare('SELECT * FROM '+table+' WHERE '+Object.keys(match).map(key=>key+'=?').join(' AND ')+(table==='commerce_operation_receipts'?' ORDER BY seq':'')+' LIMIT ?').all(...Object.values(match),limit) as Row[];
}
function one(k:CommerceKernel,s:Row,table:string,where:Row,original?:Original):Row {
  const result=rows(k,s,table,where,2,original);if(result.length!==1)throw new Error('LOYALTY_REDEMPTION_INTEGRITY');return result[0];
}
function boundCommon(row:Row,body:Row) {
  for(const field of ['tenant_id','store_id','kind','id'])if(row[field]!==body[field])throw new Error('LOYALTY_REDEMPTION_INTEGRITY');
  for(const field of ['id','tenant_id','store_id','account_key','source_account_id','resource_id','benefit_id'])id(body[field]);
  for(const field of ['subject_ref','source_identity','benefit_digest'])redemptionHash(body[field]);
  integer(body.points,1);integer(body.created_at);integer(body.expires_at,1);
  if(body.schema_version!==1||body.unit!=='points'||typeof body.authority_revoked!=='boolean'||typeof body.minimized!=='boolean'||body.minimized&&!body.authority_revoked||body.expires_at<=body.created_at||row.version!==1||row.author!=='loyalty_redemption'||row.reviewer!==null||row.review_digest!==null||row.created_at!==body.created_at||row.expires_at!==body.expires_at||row.state!==(body.authority_revoked?'revoked':'active'))throw new Error('LOYALTY_REDEMPTION_INTEGRITY');
}
export function checkedLoyaltyRow(value:Row):LoyaltyRecord {
  const row=redemptionShape(value,ROW_FIELDS,65536);if(![LOYALTY_QUOTE_KIND,LOYALTY_OPERATION_KIND].includes(row.kind)||typeof row.body!=='string')throw new Error('LOYALTY_REDEMPTION_INTEGRITY');
  const b=redemptionShape(JSON.parse(row.body),row.kind===LOYALTY_QUOTE_KIND?QUOTE_FIELDS:OP_FIELDS);redemptionHash(row.digest);
  if(contentDigest(b)!==row.digest)throw new Error('LOYALTY_REDEMPTION_INTEGRITY');boundCommon(row,b);
  if(row.kind===LOYALTY_QUOTE_KIND){
    redemptionHash(b.terms_digest);if(b.consumed_by!==null)id(b.consumed_by);
    if(b.minimized){if(b.terms!==null)throw new Error('LOYALTY_REDEMPTION_INTEGRITY');}
    else {
      const q=redemptionTerms(b.terms);
      if(contentDigest(q)!==b.terms_digest||q.quote_id!==b.id||q.subject_ref!==subjectHash(b.tenant_id,b.store_id,q.customer_id)||q.account_key!==redemptionAccount({tenant_id:q.tenant_id,store_id:q.store_id,source_account_id:q.source_account_id,balance_source_identity:q.balance_source_identity},q.subject_ref))throw new Error('LOYALTY_REDEMPTION_INTEGRITY');
      for(const field of ['tenant_id','store_id','subject_ref','account_key','source_identity','source_account_id','resource_id','points','unit','benefit_digest','created_at','expires_at'])if(q[field]!==b[field])throw new Error('LOYALTY_REDEMPTION_INTEGRITY');
      if(q.benefit.id!==b.benefit_id)throw new Error('LOYALTY_REDEMPTION_INTEGRITY');
    }
  }else{
    id(b.quote_id);redemptionHash(b.quote_digest);redemptionHash(b.command_digest);integer(b.attempt_count);integer(b.native_revision,1);
    if(!REDEMPTION_STATES.includes(b.state)||b.attempt_count>1||typeof b.restored!=='boolean'||b.restored&&!b.authority_revoked||typeof b.reason!=='string')throw new Error('LOYALTY_REDEMPTION_INTEGRITY');
    if(b.minimized){if(b.personal!==null)throw new Error('LOYALTY_REDEMPTION_INTEGRITY');}
    else {const p=redemptionShape(b.personal,PERSONAL_FIELDS);for(const field of PERSONAL_FIELDS)field==='preview_digest'?redemptionHash(p[field]):id(p[field]);if(p.executor===p.approver)throw new Error('LOYALTY_REDEMPTION_INTEGRITY');}
    if(b.state==='reserved'&&(b.attempt_count!==0||b.restored||b.reason!=='LOYALTY_RESERVED')||b.state==='unknown'&&(b.attempt_count===0&&!b.restored||b.reason!=='LOYALTY_OUTCOME_UNKNOWN')||b.state==='released'&&(b.attempt_count!==0||!['LOYALTY_RESERVATION_EXPIRED','LOYALTY_AUTHORITY_REVOKED'].includes(b.reason)))throw new Error('LOYALTY_REDEMPTION_INTEGRITY');
    if(['reserved','unknown','released'].includes(b.state)&&b.observation!==null||['redeemed','rejected'].includes(b.state)&&b.observation===null)throw new Error('LOYALTY_REDEMPTION_INTEGRITY');
  }
  return {...row,body:b};
}
export function loyaltyQuoteRecord(k:CommerceKernel,s:Row,quoteId:string,original?:Original) {
  return checkedLoyaltyRow(one(k,s,'commerce_support_documents',{kind:LOYALTY_QUOTE_KIND,id:id(quoteId)},original));
}
function gatewayReceipt(k:CommerceKernel,s:Row,command:Row,quote:LoyaltyRecord,original?:Original) {
  const r=one(k,s,'commerce_action_receipts',{id:command.source_id},original),b=redemptionShape(JSON.parse(r.body),GATEWAY_RECEIPT_FIELDS);
  const p=redemptionShape(b.points,['unit','quantity']),benefit=redemptionBenefit(b.benefit);
  for(const field of ['id','case_id','preview_id','approval_id','actor_id','loyalty_operation_id'])id(b[field]);
  for(const field of ['preview_digest','configuration_digest'])redemptionHash(b[field]);
  integer(b.case_revision,1);integer(b.resource_version,1);integer(b.authority_revision);integer(b.completed_at);
  if(r.id!==b.id||r.case_id!==b.case_id||r.preview_id!==b.preview_id||contentDigest(b)!==r.digest||r.digest!==command.source_digest||b.loyalty_operation_id!==command.operation_id||b.effect!=='synthetic_loyalty_authorized'||b.state!=='reserved'||b.financial_effect!==false||b.approval_consumed!==true||p.unit!=='points'||p.quantity!==command.points||benefit.points!==command.points||benefit.id!==command.benefit_id||contentDigest(benefit)!==command.benefit_digest)throw new Error('LOYALTY_REDEMPTION_INTEGRITY');
  const q=quote.body.terms;
  if(q&&(b.case_id!==q.case_id||b.configuration_digest!==q.configuration_digest||b.case_revision!==q.case_revision||b.resource_version!==q.resource_version||b.completed_at<q.created_at||b.completed_at>=q.expires_at))throw new Error('LOYALTY_REDEMPTION_INTEGRITY');
  return b;
}
function auditChain(k:CommerceKernel,s:Row,op:Row,body:Row,receipt:Row,original?:Original) {
  const history=rows(k,s,'commerce_operation_receipts',{operation_id:op.id},LOYALTY_REDEMPTION_LIMIT+1,original).sort((a,b)=>a.seq-b.seq);
  if(!history.length||history.length>LOYALTY_REDEMPTION_LIMIT)throw new Error('LOYALTY_REDEMPTION_INTEGRITY');
  let previous:string|null=null,revision=0;const transitions:Row[]=[];
  for(const r of history){
    const b=redemptionShape(JSON.parse(r.body),RECEIPT_FIELDS);
    if(contentDigest(b)!==r.digest||b.id!==r.id||b.operation_id!==op.id||r.operation_id!==op.id||b.tenant_id!==s.tenant_id||b.store_id!==s.store_id||b.resource_ref!==op.resource_id||b.action!==LOYALTY_REDEEM_ACTION||b.payload_hash!==op.payload_hash||b.previous_digest!==previous||b.financial_effect!==false||!RECEIPT_CODES.includes(b.code))throw new Error('LOYALTY_REDEMPTION_INTEGRITY');
    id(b.actor_ref);integer(b.observed_at);integer(b.operation_revision,1);if(b.operation_revision<revision||b.operation_revision>revision+1)throw new Error('LOYALTY_REDEMPTION_INTEGRITY');
    for(const key of ['source_ref','approval_ref','correction_of','payload_ref'])if(b[key]!==null)id(b[key]);
    for(const key of ['configuration_digest','policy_digest'])if(b[key]!==null)redemptionHash(b[key]);
    if(b.operation_revision>revision){transitions.push(b);revision=b.operation_revision;}
    else if(!['linked_correction','payload_attached','payload_erased'].includes(b.code)||b.state!==transitions.at(-1)!.state)throw new Error('LOYALTY_REDEMPTION_INTEGRITY');
    previous=r.digest;
  }
  const first=transitions[0],last=transitions.at(-1)!;
  if(first.code!=='queued'||first.state!=='queued'||first.source_ref!==op.source_id||first.approval_ref!==receipt.approval_id||first.configuration_digest!==receipt.configuration_digest||revision!==op.revision||last.state!==op.state)throw new Error('LOYALTY_REDEMPTION_INTEGRITY');
  if(transitions.length!==({reserved:1,unknown:2,redeemed:3,rejected:3,released:2} as Row)[body.state])throw new Error('LOYALTY_REDEMPTION_INTEGRITY');
  if(body.state!=='reserved'&&body.state!=='released'&&(transitions[1].code!=='outcome_unknown'||transitions[1].state!=='unknown'))throw new Error('LOYALTY_REDEMPTION_INTEGRITY');
  const code=({reserved:'queued',unknown:'outcome_unknown',redeemed:'source_confirmed',rejected:'provider_rejected',released:'reservation_released'} as Row)[body.state];
  if(last.code!==code||body.state==='redeemed'&&last.source_ref!==body.observation.provider_ref)throw new Error('LOYALTY_REDEMPTION_INTEGRITY');return history.map(r=>JSON.parse(r.body));
}

/** Classification depends on immutable native evidence and current typed
 * integrity, never current proof, ownership, quote expiry or provider uptime. */
export function loyaltyOperationRecord(k:CommerceKernel,s:Row,operationId:string,original?:Original,allowMissingFence=false):Row|null {
  id(operationId);const natives=rows(k,s,'commerce_operations',{id:operationId},2,original),typed=rows(k,s,'commerce_support_documents',{kind:LOYALTY_OPERATION_KIND,id:operationId},2,original),op=natives[0];
  const claim=op&&JSON.parse(op.command).action===LOYALTY_REDEEM_ACTION;
  if(!claim&&!typed.length)return null;
  if(!claim||natives.length!==1||typed.length!==1)throw new Error('LOYALTY_REDEMPTION_INTEGRITY');
  const record=checkedLoyaltyRow(typed[0]),b=record.body,command=redemptionCommand(JSON.parse(op.command)),quote=loyaltyQuoteRecord(k,s,b.quote_id,original),q=quote.body;
  if(op.id!==b.id||op.id!==command.operation_id||op.id!==redemptionOperationId(s.tenant_id,s.store_id,op.source_id)||op.source_kind!=='case'||op.source_id!==command.source_id||op.resource_id!==b.resource_id||contentDigest(command)!==op.payload_hash||op.payload_hash!==b.command_digest||q.consumed_by!==b.id||q.terms_digest!==b.quote_digest||q.id!==command.quote_id||q.terms_digest!==command.quote_digest||op.created_at!==b.created_at||op.revision!==b.native_revision||op.state!==MAPPING[b.state][0])throw new Error('LOYALTY_REDEMPTION_INTEGRITY');
  for(const field of ['tenant_id','store_id','subject_ref','account_key','source_identity','source_account_id','resource_id','points','unit','benefit_id','benefit_digest','expires_at'])if(command[field]!==b[field]||q[field]!==b[field])throw new Error('LOYALTY_REDEMPTION_INTEGRITY');
  if(q.minimized!==b.minimized||b.minimized&&!q.authority_revoked)throw new Error('LOYALTY_REDEMPTION_INTEGRITY');
  if(q.terms)for(const field of ['benefits_revision','benefits_digest','source_revision','snapshot_digest','rules_revision','rules_digest'])if(command[field]!==q.terms[field])throw new Error('LOYALTY_REDEMPTION_INTEGRITY');
  if(b.observation!==null){const outcome=redemptionResult(b.observation,command);if(outcome.state!==b.state||outcome.reason!==b.reason||outcome.provider_ref!==op.provider_ref)throw new Error('LOYALTY_REDEMPTION_INTEGRITY');}
  else if(op.provider_ref!==null)throw new Error('LOYALTY_REDEMPTION_INTEGRITY');
  const work=one(k,s,'commerce_operation_work',{operation_id:op.id},original),target=one(k,s,'commerce_operation_targets',{operation_id:op.id},original),control=one(k,s,'commerce_operation_controls',{operation_id:op.id},original);
  if(work.state!==MAPPING[b.state][1]||work.attempts!==b.attempt_count||work.lease_token!==null||work.lease_until!==null||work.owner!==null||target.provider_id!==b.source_account_id||target.provider_identity!==b.source_identity||target.contract!==LOYALTY_REDEMPTION_CONTRACT||control.revision!==1||q.terms&&control.stamp!==q.terms.control_stamp)throw new Error('LOYALTY_REDEMPTION_INTEGRITY');
  integer(work.available_at);integer(op.updated_at);if(op.updated_at<op.created_at)throw new Error('LOYALTY_REDEMPTION_INTEGRITY');
  const receipt=gatewayReceipt(k,s,command,quote,original),history=auditChain(k,s,op,b,receipt,original);
  let preview:Row|null=null,approval:Row|null=null;
  if(!b.minimized){
    const p=b.personal;preview=one(k,s,'commerce_action_previews',{id:p.preview_id},original);approval=one(k,s,'commerce_action_approvals',{id:p.approval_id},original);
    const v=JSON.parse(preview.body),a=redemptionShape(v.arguments,['quote_id','quote_digest']);
    if(p.case_id!==receipt.case_id||p.receipt_id!==receipt.id||p.preview_id!==receipt.preview_id||p.preview_digest!==receipt.preview_digest||p.approval_id!==receipt.approval_id||p.executor!==receipt.actor_id||preview.case_id!==p.case_id||preview.digest!==p.preview_digest||contentDigest(v)!==preview.digest||preview.proposer!==q.terms.owner||v.action!==LOYALTY_REDEEM_ACTION||v.tenant_id!==s.tenant_id||v.store_id!==s.store_id||v.resource_id!==b.resource_id||a.quote_id!==q.id||a.quote_digest!==q.terms_digest||v.expires_at!==q.expires_at||v.financial_effect!==false||v.points?.unit!=='points'||v.points?.quantity!==b.points||contentDigest(v.benefit)!==b.benefit_digest||approval.preview_id!==preview.id||approval.preview_digest!==preview.digest||approval.approver!==p.approver||approval.approver===preview.proposer||approval.uses!==1||approval.max_uses!==1||approval.expires_at!==q.expires_at)throw new Error('LOYALTY_REDEMPTION_INTEGRITY');
  }
  if(b.restored&&!original&&!allowMissingFence&&!rows(k,s,'commerce_restored_operations',{operation_id:op.id},2).length)throw new Error('LOYALTY_REDEMPTION_INTEGRITY');
  return {record,quote,native:op,command,work,target,control,receipt,history,preview,approval};
}

export function loyaltyRecords(k:CommerceKernel,scope?:Row,original?:Original,allowMissingFence=false):LoyaltyRecord[] {
  let scopes:Row[];
  if(scope)scopes=[scope];
  else if(original)scopes=[...new Map((original.commerce_support_documents??[]).filter(r=>[LOYALTY_QUOTE_KIND,LOYALTY_OPERATION_KIND].includes(r.kind)).map(r=>[canonical([r.tenant_id,r.store_id]),{tenant_id:r.tenant_id,store_id:r.store_id}])).values()];
  else scopes=k.db.prepare('SELECT tenant_id,store_id FROM commerce_stores').all() as Row[];
  const result:LoyaltyRecord[]=[];
  for(const s of scopes){
    const selected:LoyaltyRecord[]=[];
    for(const kind of [LOYALTY_QUOTE_KIND,LOYALTY_OPERATION_KIND]){
      const found=rows(k,s,'commerce_support_documents',{kind},LOYALTY_REDEMPTION_LIMIT+1,original);
      if(found.length>LOYALTY_REDEMPTION_LIMIT)throw new Error('LOYALTY_RECORD_LIMIT');selected.push(...found.map(checkedLoyaltyRow));
    }
    const ids=new Set(selected.map(r=>r.kind+':'+r.id));if(ids.size!==selected.length)throw new Error('LOYALTY_REDEMPTION_INTEGRITY');
    for(const r of selected){
      if(r.kind===LOYALTY_OPERATION_KIND)loyaltyOperationRecord(k,s,r.id,original,allowMissingFence);
      else if(r.body.consumed_by!==null){const related=selected.find(o=>o.kind===LOYALTY_OPERATION_KIND&&o.id===r.body.consumed_by);if(!related||related.body.quote_id!==r.id)throw new Error('LOYALTY_REDEMPTION_INTEGRITY');}
    }
    const claimed=original?(original.commerce_operations??[]).filter(r=>r.tenant_id===s.tenant_id&&r.store_id===s.store_id&&JSON.parse(r.command).action===LOYALTY_REDEEM_ACTION).slice(0,LOYALTY_REDEMPTION_LIMIT+1):k.db.prepare("SELECT id FROM commerce_operations WHERE tenant_id=? AND store_id=? AND json_extract(command,'$.action')=? LIMIT ?").all(s.tenant_id,s.store_id,LOYALTY_REDEEM_ACTION,LOYALTY_REDEMPTION_LIMIT+1) as Row[];
    if(claimed.length>LOYALTY_REDEMPTION_LIMIT||claimed.some(op=>!ids.has(LOYALTY_OPERATION_KIND+':'+op.id)))throw new Error('LOYALTY_REDEMPTION_INTEGRITY');
    result.push(...selected);
  }
  return result;
}

export function saveLoyaltyRecord(k:CommerceKernel,body:Row,existing=false) {
  if(!existing){const n=k.db.prepare('SELECT count(*) n FROM commerce_support_documents WHERE tenant_id=? AND store_id=? AND kind=?').get(body.tenant_id,body.store_id,body.kind) as Row;
    if(n.n>=LOYALTY_REDEMPTION_LIMIT)throw new Error('LOYALTY_RECORD_LIMIT');}
  const row={tenant_id:body.tenant_id,store_id:body.store_id,kind:body.kind,id:body.id,version:1,body:canonical(body),digest:contentDigest(body),author:'loyalty_redemption',state:body.authority_revoked?'revoked':'active',reviewer:null,review_digest:null,created_at:body.created_at,expires_at:body.expires_at};checkedLoyaltyRow(row);
  if(existing){const change=k.db.prepare('UPDATE commerce_support_documents SET body=?,digest=?,state=? WHERE tenant_id=? AND store_id=? AND kind=? AND id=? AND version=1').run(row.body,row.digest,row.state,row.tenant_id,row.store_id,row.kind,row.id);if(change.changes!==1)throw new Error('LOYALTY_REDEMPTION_INTEGRITY');}
  else k.db.prepare('INSERT INTO commerce_support_documents VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...ROW_FIELDS.map(field=>row[field]));
  return {...row,body};
}
export function loyaltyView(value:Row) {
  const b=value.record?.body??value.body??value;
  return {schema_version:1,operation_id:b.id,state:b.state,reason:b.reason,points:b.points,unit:'points',provider_ref:b.observation?.provider_ref??null,held_points:['reserved','unknown'].includes(b.state)?b.points:0,authority_revoked:b.authority_revoked,restored:b.restored,minimized:b.minimized,command_digest:b.command_digest,source_identity:b.source_identity,observation:b.observation,execution_authorized:false,production_qualified:false,financial_effect:false};
}
export function authorizeLoyaltyRead(k:CommerceKernel,scope:Scope,value:Row,reconcile=false) {
  const s=redemptionHuman(k,scope),b=value.record.body;
  if(s.tenant_id!==b.tenant_id||s.store_id!==b.store_id)throw new Error('ACCESS_DENIED');
  const actions=reconcile?['operation.read','operation.reconcile']:['operation.read'];
  if(b.minimized||b.restored){
    k.authorize(scope,'privacy.manage');for(const action of actions)if(!permissionDecision(k.db,s,action,b.resource_id).allowed)throw new Error('ACCESS_DENIED');
  }else for(const action of actions)k.authorize(scope,action,b.resource_id);
  return s;
}
/** Internal transaction helper; no public endpoint can append an observation. */
export function transitionLoyalty(k:CommerceKernel,s:Row,value:Row,state:string,reason:string,observation:Row|null=null,attempt=value.record.body.attempt_count,restored=value.record.body.restored) {
  const b=value.record.body,allowed=b.state==='reserved'?['unknown','released']:b.state==='unknown'?['redeemed','rejected']:[];
  if(!allowed.includes(state)||state==='released'&&(b.attempt_count!==0||b.restored)||attempt>1)throw new Error('LOYALTY_TRANSITION_DENIED');
  const provider=observation?.provider_ref??null,[native,work]=MAPPING[state],code=({unknown:'outcome_unknown',released:'reservation_released',redeemed:'source_confirmed',rejected:'provider_rejected'} as Row)[state];
  k.db.prepare('UPDATE commerce_operations SET state=?,revision=revision+1,provider_ref=?,updated_at=? WHERE tenant_id=? AND store_id=? AND id=?').run(native,provider,k.clock(),b.tenant_id,b.store_id,b.id);
  k.db.prepare('UPDATE commerce_operation_work SET state=?,attempts=?,available_at=?,lease_token=NULL,lease_until=NULL,owner=NULL,last_code=? WHERE tenant_id=? AND store_id=? AND operation_id=?').run(work,attempt,k.clock(),reason,b.tenant_id,b.store_id,b.id);
  const op=k.db.prepare('SELECT * FROM commerce_operations WHERE tenant_id=? AND store_id=? AND id=?').get(b.tenant_id,b.store_id,b.id) as Row;
  appendReceipt(k,{...s,actor_id:s.actor_id??'loyalty_lifecycle'},op,receiptFields(code,provider));
  const body={...b,state,reason,attempt_count:attempt,native_revision:op.revision,restored,authority_revoked:b.authority_revoked||restored,observation};
  saveLoyaltyRecord(k,body,true);return body;
}
