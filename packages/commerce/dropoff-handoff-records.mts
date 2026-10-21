import {id,integer} from './kernel.mts';
import type {CommerceKernel,Row} from './kernel.mts';
import {canonical,contentDigest} from './configuration-values.mts';
import {DROPOFF_ISSUE_ACTION,dropoffShape,dropoffHash,dropoffFamily} from './dropoff-credential-values.mts';
import {dropoffOperationRecord} from './dropoff-credential-records.mts';
import type {DropoffOriginal} from './dropoff-credential-records.mts';
import {DROPOFF_HANDOFF_PREFIX,DROPOFF_HANDOFF_LIMIT,handoffId,handoffEvent,handoffBinding,handoffManifest,handoffHistory} from './dropoff-handoff-values.mts';

export const DROPOFF_HANDOFF_TABLE='commerce_international_handoffs';
export const HANDOFF_BODY_FIELDS=['schema_version','kind','tenant_id','store_id','id','resource_id','subject_ref','issue_operation_id','quote_id','quote_digest','command_digest','expected_units','event','personal','imported_by','imported_at','authority_revoked','minimized'];
const ROW_FIELDS=['tenant_id','store_id','id','resource_id','subject_hash','state','body','digest','created_at'];
export function isDropoffHandoffClaim(row:Row){return typeof row.id==='string'&&row.id.startsWith(DROPOFF_HANDOFF_PREFIX)||(typeof row.body==='string'?JSON.parse(row.body):row.body)?.kind==='dropoff_event';}
export function handoffScopeRows(k:CommerceKernel,s:Row,table:string,original?:DropoffOriginal):Row[]{
  if(![DROPOFF_HANDOFF_TABLE,'commerce_return_requests','commerce_native_return_operations','commerce_cases'].includes(table))throw new Error('DROPOFF_HANDOFF_INTEGRITY');
  // Portable originals never borrow a missing anchor from the destination.
  return original?(original[table]??[]).filter(r=>r.tenant_id===s.tenant_id&&r.store_id===s.store_id):k.db.prepare('SELECT * FROM '+table+' WHERE tenant_id=? AND store_id=?').all(s.tenant_id,s.store_id) as Row[];
}
export function handoffRawRecords(k:CommerceKernel,scope?:Row,original?:DropoffOriginal){
  const scopes=scope?[scope]:original?[...new Map((original[DROPOFF_HANDOFF_TABLE]??[]).map(r=>[canonical([r.tenant_id,r.store_id]),r])).values()]:k.db.prepare('SELECT tenant_id,store_id FROM commerce_stores').all() as Row[];
  return scopes.flatMap(s=>{const rows=handoffScopeRows(k,s,DROPOFF_HANDOFF_TABLE,original).filter(isDropoffHandoffClaim);if(rows.length>DROPOFF_HANDOFF_LIMIT)throw new Error('DROPOFF_HANDOFF_LIMIT');return rows;});
}
export function checkedHandoffRow(value:Row){
  const r=dropoffShape(value,ROW_FIELDS,131072),b=dropoffShape(JSON.parse(r.body),HANDOFF_BODY_FIELDS),e=handoffEvent(b.event);
  for(const key of ['tenant_id','store_id','id','resource_id']){id(b[key]);if(r[key]!==b[key])throw new Error('DROPOFF_HANDOFF_INTEGRITY');}
  for(const key of ['subject_ref','quote_digest','command_digest'])dropoffHash(b[key]);for(const key of ['issue_operation_id','quote_id','imported_by'])id(b[key]);integer(b.imported_at);
  if(b.schema_version!==1||b.kind!=='dropoff_event'||b.id!==handoffId(e)||r.subject_hash!==b.subject_ref||r.created_at!==b.imported_at||r.digest!==contentDigest(b)||r.body!==canonical(b)||typeof b.authority_revoked!=='boolean'||typeof b.minimized!=='boolean'||b.minimized&&!b.authority_revoked||r.state!==(b.authority_revoked?'revoked':'observed')||b.imported_at<e.observed_at)throw new Error('DROPOFF_HANDOFF_INTEGRITY');
  for(const key of ['tenant_id','store_id','resource_id','subject_ref','issue_operation_id','command_digest'])if(b[key]!==e[key])throw new Error('DROPOFF_HANDOFF_INTEGRITY');
  const refs=b.expected_units;if(!Array.isArray(refs)||!refs.length||refs.length>100||new Set(refs).size!==refs.length||canonical([...refs].sort())!==canonical(refs))throw new Error('DROPOFF_HANDOFF_INTEGRITY');refs.forEach(dropoffHash);
  if(e.units.some((u:Row)=>!refs.includes(u.unit_ref))||b.minimized!==(b.personal===null))throw new Error('DROPOFF_HANDOFF_INTEGRITY');return {...r,body:b};
}
/** Retained request and native-operation rows are canonical identity anchors.
 * Their adapter identity is not the unrelated directory fulfillment identity. */
export function handoffNativeAnchor(k:CommerceKernel,s:Row,issued:Row,requestId?:string,original?:DropoffOriginal){
  const c=issued.command,requests=handoffScopeRows(k,s,'commerce_return_requests',original).filter(r=>requestId?r.id===requestId:dropoffFamily(s.tenant_id,s.store_id,r.id)===c.family_ref);
  if(requests.length!==1)throw new Error('DROPOFF_HANDOFF_NATIVE_BINDING_INVALID');const request=requests[0];id(request.id);
  if(dropoffFamily(s.tenant_id,s.store_id,request.id)!==c.family_ref||request.case_id!==issued.receipt.case_id||request.resource_id!==c.resource_id)throw new Error('DROPOFF_HANDOFF_NATIVE_BINDING_INVALID');
  const natives=handoffScopeRows(k,s,'commerce_native_return_operations',original).filter(r=>r.request_id===request.id&&r.state==='created');
  if(natives.length!==1)throw new Error('DROPOFF_HANDOFF_NATIVE_BINDING_INVALID');const native=natives[0],body=JSON.parse(native.native_body);id(native.source_identity);dropoffHash(native.native_digest);
  if(native.id!=='nret_'+contentDigest([s.tenant_id,s.store_id,request.id]).slice(0,40)||typeof native.native_id!=='string'||!/^gid:\/\/shopify\/Return\/[A-Za-z0-9_-]+$/.test(native.native_id)||body.id!==native.native_id||native.native_digest!==contentDigest(body)||native.native_body!==canonical(body))throw new Error('DROPOFF_HANDOFF_NATIVE_BINDING_INVALID');
  return {request,native};
}
export function handoffPersonal(k:CommerceKernel,s:Row,value:unknown,issued:Row,original?:DropoffOriginal){
  const p=dropoffShape(value,['request_id','case_id','native_return_id','items']);id(p.request_id);id(p.case_id);
  const expected=handoffManifest(p.items,issued.command.family_ref,issued.command.items_digest),anchor=handoffNativeAnchor(k,s,issued,p.request_id,original),q=issued.quote.body.terms;
  if(p.case_id!==issued.receipt.case_id||p.native_return_id!==anchor.native.native_id||q&&(p.request_id!==q.request_id||p.case_id!==q.case_id||contentDigest(p.items)!==contentDigest(q.items)))throw new Error('DROPOFF_HANDOFF_PERSONAL_INVALID');
  return {personal:p,expected:expected.map(u=>u.unit_ref),...anchor};
}
export function handoffIssued(k:CommerceKernel,s:Row,issueId:string,original?:DropoffOriginal){
  const value=dropoffOperationRecord(k,s,id(issueId),original);
  if(!value||value.command.action!==DROPOFF_ISSUE_ACTION||value.record.body.state!=='issued'||!value.record.body.observation)throw new Error('DROPOFF_HANDOFF_ISSUE_REQUIRED');return value;
}
export function dropoffHandoffRecords(k:CommerceKernel,scope?:Row,original?:DropoffOriginal){
  const records=handoffRawRecords(k,scope,original).map(checkedHandoffRow),families=new Map<string,Row[]>();
  for(const r of records){
    const b=r.body,issued=handoffIssued(k,r,b.issue_operation_id,original),c=issued.command,op=issued.record.body;handoffBinding(b.event,c,op.observation);
    if(b.quote_id!==c.quote_id||b.quote_digest!==c.quote_digest||b.command_digest!==contentDigest(c)||b.authority_revoked!==(op.authority_revoked||op.restored)||b.minimized!==op.minimized)throw new Error('DROPOFF_HANDOFF_INTEGRITY');
    if(!b.minimized){const mapping=handoffPersonal(k,r,b.personal,issued,original);if(canonical(mapping.expected)!==canonical(b.expected_units))throw new Error('DROPOFF_HANDOFF_INTEGRITY');}
    const key=canonical([r.tenant_id,r.store_id,c.family_ref]);families.set(key,[...(families.get(key)??[]),r]);
  }
  for(const rows of families.values()){
    const first=rows[0].body;if(rows.some(r=>canonical(r.body.expected_units)!==canonical(first.expected_units)||r.body.minimized!==first.minimized||r.body.authority_revoked!==first.authority_revoked))throw new Error('DROPOFF_HANDOFF_INTEGRITY');
    handoffHistory(rows.map(r=>r.body.event),first.expected_units);
  }return records;
}
export function saveHandoffRow(k:CommerceKernel,body:Row,existing=false){
  const row={tenant_id:body.tenant_id,store_id:body.store_id,id:body.id,resource_id:body.resource_id,subject_hash:body.subject_ref,state:body.authority_revoked?'revoked':'observed',body:canonical(body),digest:contentDigest(body),created_at:body.imported_at};checkedHandoffRow(row);
  if(existing){const result=k.db.prepare('UPDATE commerce_international_handoffs SET state=?,body=?,digest=? WHERE tenant_id=? AND store_id=? AND id=?').run(row.state,row.body,row.digest,row.tenant_id,row.store_id,row.id);if(result.changes!==1)throw new Error('DROPOFF_HANDOFF_INTEGRITY');}
  else {if(handoffRawRecords(k,row).length>=DROPOFF_HANDOFF_LIMIT)throw new Error('DROPOFF_HANDOFF_LIMIT');k.db.prepare('INSERT INTO commerce_international_handoffs VALUES(?,?,?,?,?,?,?,?,?)').run(...ROW_FIELDS.map(key=>row[key]));}return {...row,body};
}
