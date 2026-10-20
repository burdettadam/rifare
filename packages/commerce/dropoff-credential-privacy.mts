import type {CommerceKernel,Row} from './kernel.mts';
import {canonical,contentDigest} from './configuration-values.mts';
import {DROPOFF_QUOTE_KIND,DROPOFF_OPERATION_KIND,DROPOFF_CREDENTIAL_ACTIONS,dropoffShape,dropoffHash} from './dropoff-credential-values.mts';
import {DROPOFF_RECORD_TABLES,checkedDropoffRow,dropoffRecords,dropoffOperationRecord,saveDropoffRecord,transitionDropoff} from './dropoff-credential-records.mts';
import type {DropoffRecord,DropoffOriginal} from './dropoff-credential-records.mts';
import {DropoffCredentialFixtureSource} from '../adapters/dropoff-credential-fixture-source.mts';

// Actual native owners only. Recovery and detached erasure retain a durable
// pending marker; neither depends on key availability or an attached provider.
const sources=new WeakMap<CommerceKernel,Map<string,DropoffCredentialFixtureSource>>();
const sourceKey=(t:string,s:string,identity:string)=>canonical([t,s,identity]);
function held(k:CommerceKernel,r:DropoffRecord){return !!k.db.prepare('SELECT 1 FROM commerce_privacy_holds WHERE tenant_id=? AND store_id=? AND subject_hash=? AND released=0 AND expires_at>?').get(r.tenant_id,r.store_id,r.body.subject_ref,k.clock());}
function suppressed(k:CommerceKernel,r:DropoffRecord,checkpoint?:Row){
  if(k.db.prepare('SELECT 1 FROM commerce_privacy_subjects WHERE tenant_id=? AND store_id=? AND subject_hash=?').get(r.tenant_id,r.store_id,r.body.subject_ref)||checkpoint?.subjects?.some((s:Row)=>s.tenant_id===r.tenant_id&&s.store_id===r.store_id&&s.subject_hash===r.body.subject_ref))return true;
  const resources=new Set([r.body.resource_id]),caseId=r.body.terms?.case_id??r.body.personal?.case_id;
  if(caseId){const current=k.db.prepare('SELECT resource_id FROM commerce_cases WHERE tenant_id=? AND store_id=? AND id=?').get(r.tenant_id,r.store_id,caseId) as Row|undefined;if(current)resources.add(current.resource_id);}
  return [...resources].some(resource=>!!k.db.prepare('SELECT 1 FROM commerce_privacy_resources WHERE tenant_id=? AND store_id=? AND resource_id=?').get(r.tenant_id,r.store_id,resource)||!!checkpoint?.resources?.some((s:Row)=>s.tenant_id===r.tenant_id&&s.store_id===r.store_id&&s.resource_id===resource));
}
function retained(body:Row,minimize:boolean){
  const b={...body,authority_revoked:true,minimized:body.minimized||minimize,source_cleanup:body.source_cleanup==='forgotten'?'forgotten':'pending'};
  if(b.minimized){if(b.kind===DROPOFF_QUOTE_KIND)b.terms=null;else b.personal=null;}return b;
}
function selected(k:CommerceKernel,t:string,s:string,subject?:string){return dropoffRecords(k,{tenant_id:t,store_id:s}).filter(r=>subject===undefined||r.body.subject_ref===subject);}
function resourceRecords(k:CommerceKernel,t:string,s:string,resources:string[]){
  if(!resources.length)return [];const ids=new Set(resources),cases=new Set((k.db.prepare('SELECT id,resource_id FROM commerce_cases WHERE tenant_id=? AND store_id=?').all(t,s) as Row[]).filter(r=>ids.has(r.resource_id)).map(r=>r.id));
  return selected(k,t,s).filter(r=>ids.has(r.body.resource_id)||cases.has(r.body.terms?.case_id??r.body.personal?.case_id));
}
/** Only suppression may normalize a canonical old quote replayed beside its
 * minimized operation. The complete virtual graph is validated before any
 * write, and ordinary classification continues to reject that mismatch. */
function repairSuppressedQuotes(k:CommerceKernel,t:string,s:string,subject:string){
  const raw=k.db.prepare('SELECT * FROM commerce_support_documents WHERE tenant_id=? AND store_id=? AND kind IN (?,?)').all(t,s,DROPOFF_QUOTE_KIND,DROPOFF_OPERATION_KIND) as Row[],records=raw.map(checkedDropoffRow),repairs:Row[]=[];
  for(const q of records.filter(r=>r.kind===DROPOFF_QUOTE_KIND&&r.body.subject_ref===subject&&!r.body.minimized&&r.body.consumed_by!==null)){
    const op=records.find(r=>r.kind===DROPOFF_OPERATION_KIND&&r.id===q.body.consumed_by);
    if(!op?.body.minimized)continue;if(!suppressed(k,q)||op.body.quote_id!==q.id||op.body.quote_digest!==q.body.terms_digest)throw new Error('DROPOFF_CREDENTIAL_INTEGRITY');
    repairs.push({...q.body,authority_revoked:true,minimized:true,terms:null,source_cleanup:op.body.source_cleanup});
  }
  if(!repairs.length)return;
  const original:DropoffOriginal=Object.fromEntries(DROPOFF_RECORD_TABLES.map(table=>[table,k.db.prepare('SELECT * FROM '+table+' WHERE tenant_id=? AND store_id=?').all(t,s) as Row[]]));
  original.commerce_support_documents=original.commerce_support_documents.map(row=>{const body=repairs.find(b=>row.kind===b.kind&&row.id===b.id);return body?{...row,body:canonical(body),digest:contentDigest(body),state:'revoked'}:row;});
  dropoffRecords(k,{tenant_id:t,store_id:s},original);for(const b of repairs)saveDropoffRecord(k,b,true);
}
function retireCopies(k:CommerceKernel,records:DropoffRecord[],redact:boolean){
  for(const r of records){
    if(r.kind===DROPOFF_OPERATION_KIND){if(redact)k.db.prepare('DELETE FROM commerce_receipt_payloads WHERE tenant_id=? AND store_id=? AND receipt_id IN (SELECT id FROM commerce_operation_receipts WHERE tenant_id=? AND store_id=? AND operation_id=?)').run(r.tenant_id,r.store_id,r.tenant_id,r.store_id,r.id);continue;}
    const q=r.body,receipt=q.consumed_by?dropoffOperationRecord(k,r,q.consumed_by)!.receipt:null;
    const previews=k.db.prepare("SELECT * FROM commerce_action_previews WHERE tenant_id=? AND store_id=? AND (id=? OR (json_extract(body,'$.action') IN (?,?) AND json_extract(body,'$.arguments.quote_id')=?))").all(r.tenant_id,r.store_id,receipt?.preview_id??'',...DROPOFF_CREDENTIAL_ACTIONS,r.id) as Row[];
    for(const p of previews){
      const b=JSON.parse(p.body);if(contentDigest(b)!==p.digest)throw new Error('DROPOFF_CREDENTIAL_INTEGRITY');
      // Native repeated case scrubbing hashes the already-redacted body again.
      // This erasable marker carries no authority; the immutable gateway
      // receipt continues to bind the original consumed preview digest.
      if(b.redacted===true){dropoffShape(b,['redacted','original_digest']);dropoffHash(b.original_digest);if(!receipt||p.id!==receipt.preview_id)throw new Error('DROPOFF_CREDENTIAL_INTEGRITY');}
      else {const a=dropoffShape(b.arguments,['quote_id','quote_digest']);if(b.action!==q.action||b.tenant_id!==r.tenant_id||b.store_id!==r.store_id||b.resource_id!==q.resource_id||a.quote_id!==r.id||a.quote_digest!==q.terms_digest||receipt&&p.id===receipt.preview_id&&p.digest!==receipt.preview_digest)throw new Error('DROPOFF_CREDENTIAL_INTEGRITY');}
      k.db.prepare('UPDATE commerce_action_approvals SET revoked=1 WHERE tenant_id=? AND store_id=? AND preview_id=?').run(r.tenant_id,r.store_id,p.id);
      if(redact&&!b.redacted){const body={redacted:true,original_digest:p.digest};k.db.prepare('UPDATE commerce_action_previews SET body=?,digest=? WHERE tenant_id=? AND store_id=? AND id=?').run(canonical(body),contentDigest(body),r.tenant_id,r.store_id,p.id);}
    }
  }
}
function cleanupPending(k:CommerceKernel,records:DropoffRecord[]){
  const groups=new Map<string,DropoffRecord[]>();for(const r of records.filter(r=>r.body.source_cleanup==='pending')){const key=canonical([r.tenant_id,r.store_id,r.body.source_identity,r.body.subject_ref]);groups.set(key,[...(groups.get(key)??[]),r]);}
  for(const group of groups.values()){
    const first=group[0],source=sources.get(k)?.get(sourceKey(first.tenant_id,first.store_id,first.body.source_identity));if(!source)continue;
    try{
      DropoffCredentialFixtureSource.prototype.assertAttached.call(source,k.db);if(source.account!==first.body.source_account_id||group.some(r=>r.body.source_account_id!==source.account))throw new Error('DROPOFF_SOURCE_SCOPE');
      const result=dropoffShape(source.forgetSubject(first.body.subject_ref),['subject_ref','forgotten','provider_revoked','physical_media_erasure']);
      if(result.subject_ref!==first.body.subject_ref||!Number.isSafeInteger(result.forgotten)||result.forgotten<0||result.provider_revoked!==false||result.physical_media_erasure!==false)throw new Error('DROPOFF_CLEANUP_UNCONFIRMED');
    }catch{continue;}
    for(const r of group)saveDropoffRecord(k,{...r.body,source_cleanup:'forgotten'},true);
  }
}
export function bindDropoffPrivacySource(k:CommerceKernel,source:DropoffCredentialFixtureSource){
  if(!(source instanceof DropoffCredentialFixtureSource))throw new Error('DROPOFF_OWNER_MISMATCH');DropoffCredentialFixtureSource.prototype.assertAttached.call(source,k.db);
  const map=sources.get(k)??new Map(),key=sourceKey(source.tenant,source.store,source.identity),old=map.get(key);
  if(old&&(old.db!==source.db||old.directory!==source.directory||old.account!==source.account))throw new Error('DROPOFF_OWNER_MISMATCH');map.set(key,source);sources.set(k,map);
  k.transaction(()=>cleanupPending(k,selected(k,source.tenant,source.store).filter(r=>r.body.source_identity===source.identity)));
}
export function preflightDropoffCredentials(k:CommerceKernel,scope?:Row,original?:DropoffOriginal){dropoffRecords(k,scope);if(original)dropoffRecords(k,scope,original);}
export function hasDropoffCredentialSubject(k:CommerceKernel,t:string,s:string,subject:string){return selected(k,t,s,subject).length>0;}
export function dropoffCredentialResourceSubjects(k:CommerceKernel,t:string,s:string,resources:string[]){return [...new Set(resourceRecords(k,t,s,resources).map(r=>r.body.subject_ref))];}
export function exportDropoffCredentialSubject(k:CommerceKernel,t:string,s:string,subject:string){
  return selected(k,t,s,subject).map(r=>({id:r.id,kind:r.kind,subject_ref:r.body.subject_ref,resource_id:r.body.resource_id,action:r.body.action,generation:r.body.generation,state:r.kind===DROPOFF_QUOTE_KIND?'quoted':r.body.state,authority_revoked:r.body.authority_revoked,minimized:r.body.minimized,source_cleanup:r.body.source_cleanup,retained_under_hold:held(k,r),source_identity:r.body.source_identity,original_operation_id:r.kind===DROPOFF_OPERATION_KIND?r.id:r.body.consumed_by,subject_projection:true,credentials_included:false}));
}
function eraseRecords(k:CommerceKernel,records:DropoffRecord[],minimize=true){
  for(const r of records)saveDropoffRecord(k,retained(r.body,minimize),true);retireCopies(k,records,minimize);
  const scopes=new Map(records.map(r=>[canonical([r.tenant_id,r.store_id]),r]));for(const s of scopes.values())cleanupPending(k,selected(k,s.tenant_id,s.store_id).filter(r=>records.some(old=>old.kind===r.kind&&old.id===r.id)));
}
export function eraseDropoffCredentialSubject(k:CommerceKernel,t:string,s:string,subject:string,minimize=true){repairSuppressedQuotes(k,t,s,subject);eraseRecords(k,selected(k,t,s,subject),minimize);}
export function eraseDropoffCredentialResources(k:CommerceKernel,t:string,s:string,resources:string[],minimize=true){
  if(!resources.length)return;
  const ids=new Set(resources),cases=new Set((k.db.prepare('SELECT id,resource_id FROM commerce_cases WHERE tenant_id=? AND store_id=?').all(t,s) as Row[]).filter(r=>ids.has(r.resource_id)).map(r=>r.id));
  const raw=k.db.prepare('SELECT * FROM commerce_support_documents WHERE tenant_id=? AND store_id=? AND kind IN (?,?)').all(t,s,DROPOFF_QUOTE_KIND,DROPOFF_OPERATION_KIND) as Row[],records=raw.map(checkedDropoffRow);
  for(const subject of new Set(records.filter(r=>ids.has(r.body.resource_id)||cases.has(r.body.terms?.case_id??r.body.personal?.case_id)).map(r=>r.body.subject_ref)))repairSuppressedQuotes(k,t,s,subject);
  eraseRecords(k,resourceRecords(k,t,s,resources),minimize);
}
export function revokeDropoffCredentialsForUninstall(k:CommerceKernel,t:string,s:string){
  const records=selected(k,t,s);for(const r of records)saveDropoffRecord(k,retained(r.body,suppressed(k,r)||!held(k,r)),true);
  retireCopies(k,records.filter(r=>r.body.minimized||suppressed(k,r)||!held(k,r)),true);retireCopies(k,records.filter(r=>!r.body.minimized&&!suppressed(k,r)&&held(k,r)),false);cleanupPending(k,selected(k,t,s));
}
export function revokeDropoffCredentialsForRestore(k:CommerceKernel,scope?:Row,checkpoint?:Row){
  const records=dropoffRecords(k,scope),bodies=new Map<string,Row>();
  for(const r of records){let b=r.body;if(r.kind===DROPOFF_OPERATION_KIND){const value=dropoffOperationRecord(k,r,r.id)!;k.db.prepare('INSERT OR IGNORE INTO commerce_restored_operations VALUES(?,?,?)').run(r.tenant_id,r.store_id,r.id);
      b=b.state==='authorized'?transitionDropoff(k,{...r,actor_id:'dropoff_recovery'},value,'unknown','DROPOFF_OUTCOME_UNKNOWN',null,0,true):{...b,restored:true,authority_revoked:true};}
    bodies.set(r.kind+':'+r.id,b);
  }
  for(const r of records)saveDropoffRecord(k,retained(bodies.get(r.kind+':'+r.id)!,suppressed(k,r,checkpoint)||!held(k,r)),true);
  retireCopies(k,records.filter(r=>r.body.minimized||suppressed(k,r,checkpoint)||!held(k,r)),true);retireCopies(k,records.filter(r=>!r.body.minimized&&!suppressed(k,r,checkpoint)&&held(k,r)),false);
  cleanupPending(k,dropoffRecords(k,scope));
}
