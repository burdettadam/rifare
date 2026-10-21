import type {CommerceKernel,Row} from './kernel.mts';
import {canonical,contentDigest} from './configuration-values.mts';
import {DROPOFF_QUOTE_KIND,DROPOFF_OPERATION_KIND} from './dropoff-credential-values.mts';
import {DROPOFF_RECORD_TABLES,checkedDropoffRow,dropoffRecords} from './dropoff-credential-records.mts';
import type {DropoffOriginal} from './dropoff-credential-records.mts';
import {handoffBinding} from './dropoff-handoff-values.mts';
import {DROPOFF_HANDOFF_TABLE,handoffRawRecords,checkedHandoffRow,handoffIssued,handoffPersonal,handoffScopeRows,dropoffHandoffRecords,saveHandoffRow} from './dropoff-handoff-records.mts';

function held(k:CommerceKernel,r:Row){return !!k.db.prepare('SELECT 1 FROM commerce_privacy_holds WHERE tenant_id=? AND store_id=? AND subject_hash=? AND released=0 AND expires_at>?').get(r.tenant_id,r.store_id,r.body.subject_ref,k.clock());}
function resources(k:CommerceKernel,r:Row,caseId:string){
  const ids=new Set<string>([r.body.resource_id]),current=k.db.prepare('SELECT resource_id FROM commerce_cases WHERE tenant_id=? AND store_id=? AND id=?').get(r.tenant_id,r.store_id,caseId) as Row|undefined;if(current)ids.add(current.resource_id);return ids;
}
function suppressed(k:CommerceKernel,r:Row,caseId:string,checkpoint?:Row){
  if(k.db.prepare('SELECT 1 FROM commerce_privacy_subjects WHERE tenant_id=? AND store_id=? AND subject_hash=?').get(r.tenant_id,r.store_id,r.body.subject_ref)||checkpoint?.subjects?.some((v:Row)=>v.tenant_id===r.tenant_id&&v.store_id===r.store_id&&v.subject_hash===r.body.subject_ref))return true;
  return [...resources(k,r,caseId)].some(resource=>!!k.db.prepare('SELECT 1 FROM commerce_privacy_resources WHERE tenant_id=? AND store_id=? AND resource_id=?').get(r.tenant_id,r.store_id,resource)||checkpoint?.resources?.some((v:Row)=>v.tenant_id===r.tenant_id&&v.store_id===r.store_id&&v.resource_id===resource));
}
function scopedSnapshot(k:CommerceKernel,s:Row):DropoffOriginal{
  return Object.fromEntries([...DROPOFF_RECORD_TABLES,DROPOFF_HANDOFF_TABLE,'commerce_return_requests','commerce_native_return_operations','commerce_cases'].map(table=>[table,k.db.prepare('SELECT * FROM '+table+' WHERE tenant_id=? AND store_id=?').all(s.tenant_id,s.store_id) as Row[]]));
}
/** Only a real suppression marker may repair canonical historical personal
 * copies beside already-minimized originals. No writes occur in preflight. */
function prepared(k:CommerceKernel,scope?:Row,checkpoint?:Row){
  const raw=handoffRawRecords(k,scope),scopes=[...new Map(raw.map(r=>[canonical([r.tenant_id,r.store_id]),r])).values()],result:Row[]=[];
  for(const s of scopes){
    const original=scopedSnapshot(k,s),documents=original.commerce_support_documents.filter(r=>[DROPOFF_QUOTE_KIND,DROPOFF_OPERATION_KIND].includes(r.kind)).map(checkedDropoffRow);
    const quoteRepairs=new Map<string,Row>();
    for(const q of documents.filter(r=>r.kind===DROPOFF_QUOTE_KIND&&!r.body.minimized&&r.body.consumed_by!==null)){
      const op=documents.find(r=>r.kind===DROPOFF_OPERATION_KIND&&r.id===q.body.consumed_by);if(!op?.body.minimized)continue;
      if(op.body.quote_id!==q.id||op.body.quote_digest!==q.body.terms_digest||!suppressed(k,q,q.body.terms.case_id,checkpoint))throw new Error('DROPOFF_HANDOFF_INTEGRITY');
      quoteRepairs.set(q.id,{...q.body,authority_revoked:true,minimized:true,terms:null,source_cleanup:op.body.source_cleanup});
    }
    original.commerce_support_documents=original.commerce_support_documents.map(r=>{const body=r.kind===DROPOFF_QUOTE_KIND?quoteRepairs.get(r.id):null;return body?{...r,body:canonical(body),digest:contentDigest(body),state:'revoked'}:r;});
    dropoffRecords(k,s,original);
    // Destination preflight remains strict about the local restore fence.
    for(const op of documents.filter(r=>r.kind===DROPOFF_OPERATION_KIND&&r.body.restored))if(!original.commerce_restored_operations.some(r=>r.operation_id===op.id))throw new Error('DROPOFF_HANDOFF_INTEGRITY');
    original[DROPOFF_HANDOFF_TABLE]=original[DROPOFF_HANDOFF_TABLE].map(r=>{
      if(!raw.some(v=>v.tenant_id===r.tenant_id&&v.store_id===r.store_id&&v.id===r.id))return r;
      const checked=checkedHandoffRow(r),b=checked.body,issued=handoffIssued(k,s,b.issue_operation_id,original),op=issued.record.body;
      if(b.authority_revoked===(op.authority_revoked||op.restored)&&b.minimized===op.minimized)return r;
      if(!op.minimized||b.minimized||!suppressed(k,checked,issued.receipt.case_id,checkpoint))throw new Error('DROPOFF_HANDOFF_INTEGRITY');
      handoffBinding(b.event,issued.command,op.observation);const mapping=handoffPersonal(k,s,b.personal,issued,original);
      if(b.quote_id!==issued.command.quote_id||b.quote_digest!==issued.command.quote_digest||canonical(mapping.expected)!==canonical(b.expected_units))throw new Error('DROPOFF_HANDOFF_INTEGRITY');
      const body={...b,authority_revoked:true,minimized:true,personal:null};return {...r,state:'revoked',body:canonical(body),digest:contentDigest(body)};
    });
    result.push(...dropoffHandoffRecords(k,s,original).map(r=>({...r,case_id:handoffIssued(k,s,r.body.issue_operation_id,original).receipt.case_id})));
  }return result;
}
export function preflightDropoffHandoffs(k:CommerceKernel,scope?:Row,original?:DropoffOriginal,checkpoint?:Row){
  prepared(k,scope,checkpoint);if(original)dropoffHandoffRecords(k,scope,original);
}
function retire(k:CommerceKernel,records:Row[],minimize:(r:Row)=>boolean){
  for(const r of records){const redacted=r.body.minimized||minimize(r),body={...r.body,authority_revoked:true,minimized:redacted,personal:redacted?null:r.body.personal};saveHandoffRow(k,body,true);}
}
/** The caller completes the paired G02 transition before returning. */
export function eraseDropoffHandoffs(k:CommerceKernel,tenant:string,store:string,subjects:readonly string[],resourceIds:readonly string[],minimize=true){
  const hashes=new Set(subjects),ids=new Set(resourceIds),records=prepared(k,{tenant_id:tenant,store_id:store}).filter(r=>hashes.has(r.body.subject_ref)||[...resources(k,r,r.case_id)].some(id=>ids.has(id)));
  retire(k,records,()=>minimize);
}
export function revokeDropoffHandoffsForRestore(k:CommerceKernel,scope?:Row,checkpoint?:Row){
  const records=prepared(k,scope,checkpoint);retire(k,records,r=>suppressed(k,r,r.case_id,checkpoint)||!held(k,r));
}
export function revokeDropoffHandoffsForUninstall(k:CommerceKernel,tenant:string,store:string){revokeDropoffHandoffsForRestore(k,{tenant_id:tenant,store_id:store});}
export function exportDropoffHandoffSubject(k:CommerceKernel,tenant:string,store:string,resourceIds:readonly string[],hash:string){
  const ids=new Set(resourceIds),records=dropoffHandoffRecords(k,{tenant_id:tenant,store_id:store});
  return records.filter(r=>r.body.subject_ref===hash||[...resources(k,r,handoffIssued(k,r,r.body.issue_operation_id).receipt.case_id)].some(id=>ids.has(id))).map(r=>{
    const body={...r.body,authority_revoked:true};return {...r,state:'revoked',body:canonical(body),digest:contentDigest(body),source_record_digest:r.digest,projection:'subject_export_without_authority'};
  });
}
