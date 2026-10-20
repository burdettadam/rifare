import {exact,id,integer} from './kernel.mts';
import type {CommerceKernel,Scope,Row} from './kernel.mts';
import {contentDigest,jsonValue} from './configuration-values.mts';
import {money} from './money.mts';

export const DROPOFF_ISSUE_ACTION='diagnostic.dropoff.issue',DROPOFF_REVOKE_ACTION='diagnostic.dropoff.revoke';
export const DROPOFF_CREDENTIAL_ACTIONS=[DROPOFF_ISSUE_ACTION,DROPOFF_REVOKE_ACTION];
export const DROPOFF_CREDENTIAL_CONTRACT='rifare-dropoff-credential-fixture-v1';
export const DROPOFF_QUOTE_KIND='dropoff_credential_quote',DROPOFF_OPERATION_KIND='dropoff_credential_operation';
export const DROPOFF_CREDENTIAL_LIMIT=1000,DROPOFF_QUOTE_TTL=5000,DROPOFF_CREDENTIAL_TTL=20000;
export const DROPOFF_BINDING_FIELDS=['tenant_id','store_id','resource_id','source_identity','source_account_id','directory_identity','family_ref','subject_ref','action','items_digest','method_digest','fees_digest','site_id','destination_id','method_id','credential_kind','generation','replaces_operation_id','issue_operation_id','expires_at','credential_expires_at'];
export const DROPOFF_COMMAND_FIELDS=['schema_version','action','operation_id','tenant_id','store_id','resource_id','source_id','source_digest','source_identity','source_contract','source_account_id','directory_identity','family_ref','subject_ref','quote_id','quote_digest','items_digest','method_digest','fees_digest','site_id','destination_id','method_id','credential_kind','generation','replaces_operation_id','issue_operation_id','expires_at','credential_expires_at','financial_effect'];
export const DROPOFF_RESULT_FIELDS=['schema_version','operation_id','action','command_digest','source_identity','source_account_id','family_ref','items_digest','method_digest','generation','issue_operation_id','credential_id','credential_kind','credential_expires_at','state','reason','provider_ref','observed_at','digest'];
export const DROPOFF_CREDENTIAL_FIELDS=['schema_version','tenant_id','store_id','source_identity','source_account_id','family_ref','subject_ref','operation_id','command_digest','items_digest','method_digest','credential_id','kind','generation','expires_at','revoked_at','replaced_by'];
export const DROPOFF_TERM_FIELDS=['schema_version','quote_id',...DROPOFF_BINDING_FIELDS,'case_id','request_id','customer_id','items','method','source_digest','request_digest','native_return_digest','configuration_digest','policy_digest','case_revision','resource_version','resource_digest','owner','owner_role','ownership_generation','proof_hash','proof_expires_at','capability_revision','control_stamp','created_at','financial_effect'];
export const dropoffShape=(value:unknown,fields:string[],limit=65536)=>exact(jsonValue(value,limit),fields);
export function dropoffHash(value:unknown):string {if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))throw new Error('DROPOFF_CREDENTIAL_INTEGRITY');return value;}
export function dropoffHuman(k:CommerceKernel,scope:Scope) {const s=k.require(scope,['owner','operator','reviewer']);if(!['owner','operator','reviewer'].includes(s.role)||k.workerIdentity(scope)!==null)throw new Error('ACCESS_DENIED');return s;}
export const dropoffOperationId=(tenant:string,store:string,receipt:string)=>'op_'+contentDigest([tenant,store,'case',receipt]).slice(0,40);
export const dropoffFamily=(tenant:string,store:string,request:string)=>contentDigest([tenant,store,request]);
export const dropoffPick=(value:Row,fields:string[])=>Object.fromEntries(fields.map(field=>[field,value[field]]));
function binding(value:Row) {
  for(const field of ['tenant_id','store_id','resource_id','source_account_id','site_id','destination_id','method_id'])id(value[field]);
  for(const field of ['source_identity','directory_identity','family_ref','subject_ref','items_digest','method_digest','fees_digest'])dropoffHash(value[field]);
  integer(value.generation,1);integer(value.expires_at,1);integer(value.credential_expires_at,1);
  if(!DROPOFF_CREDENTIAL_ACTIONS.includes(value.action)||!['qr','code'].includes(value.credential_kind))throw new Error('DROPOFF_CREDENTIAL_INTEGRITY');
  if(value.replaces_operation_id!==null)id(value.replaces_operation_id);
  if(value.action===DROPOFF_ISSUE_ACTION){if(value.issue_operation_id!==null||(value.generation===1)!==(value.replaces_operation_id===null))throw new Error('DROPOFF_CREDENTIAL_INTEGRITY');}
  else id(value.issue_operation_id);
}
export function dropoffCommand(value:unknown) {
  const p=dropoffShape(value,DROPOFF_COMMAND_FIELDS);binding(p);
  for(const field of ['operation_id','source_id','quote_id'])id(p[field]);for(const field of ['source_digest','quote_digest'])dropoffHash(p[field]);
  if(p.schema_version!==1||p.source_contract!==DROPOFF_CREDENTIAL_CONTRACT||p.financial_effect!==false||p.operation_id!==dropoffOperationId(p.tenant_id,p.store_id,p.source_id)||p.issue_operation_id===p.operation_id||p.replaces_operation_id===p.operation_id)throw new Error('DROPOFF_COMMAND_INVALID');return p;
}
export function dropoffResult(value:unknown,command:Row) {
  const c=dropoffCommand(command),p=dropoffShape(value,DROPOFF_RESULT_FIELDS),{digest:hash,...body}=p;
  for(const field of ['operation_id','action','source_identity','source_account_id','family_ref','items_digest','method_digest','generation','credential_kind','credential_expires_at'])if(p[field]!==c[field])throw new Error('DROPOFF_RESULT_INVALID');
  dropoffHash(hash);dropoffHash(p.command_digest);integer(p.observed_at);
  if(p.schema_version!==1||p.command_digest!==contentDigest(c)||contentDigest(body)!==hash||p.issue_operation_id!==(c.action===DROPOFF_ISSUE_ACTION?c.operation_id:c.issue_operation_id))throw new Error('DROPOFF_RESULT_INVALID');
  if(p.state==='rejected'){
    if(!['DROPOFF_PROVIDER_REJECTED','DROPOFF_TERMS_EXPIRED'].includes(p.reason)||p.credential_id!==null||p.provider_ref!==null)throw new Error('DROPOFF_RESULT_INVALID');
  }else{
    const issue=c.action===DROPOFF_ISSUE_ACTION;id(p.credential_id);id(p.provider_ref);
    if(p.state!==(issue?'issued':'revoked')||p.reason!==(issue?'DROPOFF_ISSUED':'DROPOFF_REVOKED')||issue&&p.credential_id!=='dc_'+p.command_digest.slice(0,40)||p.provider_ref!==(issue?'credential_':'revocation_')+p.command_digest.slice(0,40))throw new Error('DROPOFF_RESULT_INVALID');
  }return p;
}
export function dropoffCredentialBody(value:unknown) {
  const p=dropoffShape(value,DROPOFF_CREDENTIAL_FIELDS);
  for(const field of ['tenant_id','store_id','source_account_id','operation_id','credential_id'])id(p[field]);
  for(const field of ['source_identity','family_ref','subject_ref','command_digest','items_digest','method_digest'])dropoffHash(p[field]);
  integer(p.generation,1);integer(p.expires_at,1);if(p.revoked_at!==null)integer(p.revoked_at);if(p.replaced_by!==null)id(p.replaced_by);
  if(p.schema_version!==1||!['qr','code'].includes(p.kind)||p.credential_id!=='dc_'+p.command_digest.slice(0,40)||p.replaced_by===p.operation_id)throw new Error('DROPOFF_CREDENTIAL_INTEGRITY');return p;
}
export function dropoffStatus(value:unknown,command:Row,result:Row,now:number,startedAt=now) {
  const p=dropoffShape(value,[...DROPOFF_CREDENTIAL_FIELDS,'state','delivery_available','observed_at','digest']),{digest:hash,state,delivery_available,observed_at,...body}=p;
  dropoffCredentialBody(body);dropoffResult(result,command);integer(observed_at);integer(now);integer(startedAt);
  for(const field of ['tenant_id','store_id','source_identity','source_account_id','family_ref','subject_ref','operation_id','items_digest','method_digest','generation'])if(p[field]!==command[field])throw new Error('DROPOFF_CREDENTIAL_INVALID');
  const expected=p.revoked_at!==null?'revoked':p.expires_at<=observed_at?'expired':'active';
  if(result.state!=='issued'||p.command_digest!==contentDigest(command)||p.credential_id!==result.credential_id||p.kind!==command.credential_kind||p.expires_at!==command.credential_expires_at||hash!==contentDigest({...body,state,delivery_available,observed_at})||typeof delivery_available!=='boolean'||observed_at<startedAt||observed_at>now||now-startedAt>1000||state!==expected||state==='active'&&p.expires_at<=now||p.revoked_at!==null&&p.revoked_at>observed_at||p.replaced_by!==null&&state==='active'||delivery_available&&state!=='active')throw new Error('DROPOFF_CREDENTIAL_INVALID');return p;
}
export function dropoffTerms(value:unknown) {
  const p=dropoffShape(value,DROPOFF_TERM_FIELDS);binding(p);
  for(const field of ['quote_id','case_id','request_id','customer_id','owner'])id(p[field]);
  for(const field of ['source_digest','request_digest','native_return_digest','configuration_digest','policy_digest','resource_digest','proof_hash'])dropoffHash(p[field]);
  for(const field of ['case_revision','resource_version','ownership_generation','proof_expires_at','capability_revision'])integer(p[field],1);integer(p.created_at);
  if(p.schema_version!==1||p.financial_effect!==false||!['owner','operator','reviewer'].includes(p.owner_role)||p.family_ref!==dropoffFamily(p.tenant_id,p.store_id,p.request_id)||p.expires_at<=p.created_at||p.expires_at>p.created_at+DROPOFF_QUOTE_TTL||p.expires_at>p.proof_expires_at||p.action===DROPOFF_ISSUE_ACTION&&p.credential_expires_at!==p.created_at+DROPOFF_CREDENTIAL_TTL||typeof p.control_stamp!=='string'||!/^\d+:\d+:\d+$/.test(p.control_stamp))throw new Error('DROPOFF_QUOTE_INVALID');
  if(!Array.isArray(p.items)||!p.items.length||p.items.length>20)throw new Error('DROPOFF_QUOTE_INVALID');
  const seen=new Set<string>();for(const raw of p.items){const i=dropoffShape(raw,['line_id','item_id','category','quantity']);for(const key of ['line_id','item_id','category'])id(i[key]);integer(i.quantity,1);if(seen.has(i.line_id))throw new Error('DROPOFF_QUOTE_INVALID');seen.add(i.line_id);}
  const m=dropoffShape(p.method,['choice_id','site_id','destination_id','method_id','packaging','label_required','credential_kind','instructions_ref','accessible_alternative','availability','items','state','eligible','reasons','fees']);
  for(const key of ['site_id','destination_id','method_id','credential_kind'])if(m[key]!==p[key])throw new Error('DROPOFF_QUOTE_INVALID');
  id(m.instructions_ref);dropoffHash(m.choice_id);
  if(m.choice_id!==contentDigest([m.site_id,m.destination_id,m.method_id])||!['box_required','provider_packaging'].includes(m.packaging)||typeof m.label_required!=='boolean'||!['printed_code','staff_assisted_code'].includes(m.accessible_alternative)||m.state!=='eligible'||m.eligible!==true||!Array.isArray(m.reasons)||m.reasons.length||!Array.isArray(m.items)||m.items.length!==p.items.length)throw new Error('DROPOFF_QUOTE_INVALID');
  for(let n=0;n<p.items.length;n++){const i=dropoffShape(m.items[n],['line_id','item_id','category','quantity','state','eligible','reasons']);if(contentDigest(dropoffPick(i,['line_id','item_id','category','quantity']))!==contentDigest(p.items[n])||i.state!=='eligible'||i.eligible!==true||!Array.isArray(i.reasons)||i.reasons.length)throw new Error('DROPOFF_QUOTE_INVALID');}
  const a=dropoffShape(m.availability,['state','observed_at','expires_at']);integer(a.observed_at);integer(a.expires_at,1);if(a.state!=='available'||a.expires_at<=a.observed_at)throw new Error('DROPOFF_QUOTE_INVALID');
  const fees=dropoffShape(m.fees,['partner_fee','destination_handling_estimate','total_minor','charged']);
  for(const key of ['partner_fee','destination_handling_estimate']){const f=dropoffShape(fees[key],['amount_minor','currency','basis']);money(f.currency,f.amount_minor);if(f.basis!=='per_handoff')throw new Error('DROPOFF_QUOTE_INVALID');}
  if(fees.total_minor!==null||fees.charged!==false||contentDigest(p.items)!==p.items_digest||contentDigest(m)!==p.method_digest||contentDigest(fees)!==p.fees_digest)throw new Error('DROPOFF_QUOTE_INVALID');return p;
}
