import type {CommerceKernel,Row} from './kernel.mts';
import {LOYALTY_QUOTE_KIND,LOYALTY_OPERATION_KIND,LOYALTY_REDEEM_ACTION,redemptionShape,redemptionHash} from './loyalty-redemption-values.mts';
import {canonical,contentDigest} from './configuration-values.mts';
import {loyaltyRecords,loyaltyOperationRecord,saveLoyaltyRecord,transitionLoyalty} from './loyalty-redemption-records.mts';
import type {LoyaltyRecord} from './loyalty-redemption-records.mts';
import {LoyaltyRedemptionFixtureSource} from '../adapters/loyalty-redemption-fixture-source.mts';
import {assertSeparateLoyaltyDatabases} from '../adapters/loyalty-fixture-source.mts';

// A transient native-owner reference, not a durable registry or an effect
// endpoint. Recovery has no source dependency; it conservatively retains holds.
const releaseSources=new WeakMap<CommerceKernel,Map<string,LoyaltyRedemptionFixtureSource>>();
export function bindLoyaltyPrivacySource(k:CommerceKernel,source:LoyaltyRedemptionFixtureSource) {
  if(!(source instanceof LoyaltyRedemptionFixtureSource))throw new Error('LOYALTY_SOURCE_OWNER_MISMATCH');
  assertSeparateLoyaltyDatabases(k.db,source.db);const map=releaseSources.get(k)??new Map(),key=JSON.stringify([source.tenant,source.store,source.identity]),old=map.get(key);
  if(old&&(old.db!==source.db||old.balanceSource!==source.balanceSource||old.account!==source.account))throw new Error('LOYALTY_SOURCE_OWNER_MISMATCH');
  if(!old)map.set(key,source);releaseSources.set(k,map);
}

function held(k:CommerceKernel,r:LoyaltyRecord) {
  return !!k.db.prepare('SELECT 1 FROM commerce_privacy_holds WHERE tenant_id=? AND store_id=? AND subject_hash=? AND released=0 AND expires_at>?').get(r.tenant_id,r.store_id,r.body.subject_ref,k.clock());
}
function suppressed(k:CommerceKernel,r:LoyaltyRecord,checkpoint?:Row) {
  if(k.db.prepare('SELECT 1 FROM commerce_privacy_subjects WHERE tenant_id=? AND store_id=? AND subject_hash=?').get(r.tenant_id,r.store_id,r.body.subject_ref)||checkpoint?.subjects?.some((s:Row)=>s.tenant_id===r.tenant_id&&s.store_id===r.store_id&&s.subject_hash===r.body.subject_ref))return true;
  const resources=new Set([r.body.resource_id]),caseId=r.body.terms?.case_id??r.body.personal?.case_id;
  if(caseId){const c=k.db.prepare('SELECT resource_id FROM commerce_cases WHERE tenant_id=? AND store_id=? AND id=?').get(r.tenant_id,r.store_id,caseId) as Row|undefined;if(c)resources.add(c.resource_id);}
  return [...resources].some(resource=>!!k.db.prepare('SELECT 1 FROM commerce_privacy_resources WHERE tenant_id=? AND store_id=? AND resource_id=?').get(r.tenant_id,r.store_id,resource)||!!checkpoint?.resources?.some((s:Row)=>s.tenant_id===r.tenant_id&&s.store_id===r.store_id&&s.resource_id===resource));
}
function retained(body:Row,minimize:boolean) {
  const b={...body,authority_revoked:true,minimized:body.minimized||minimize};
  if(b.minimized){if(b.kind===LOYALTY_QUOTE_KIND)b.terms=null;else b.personal=null;}return b;
}
function selected(k:CommerceKernel,t:string,s:string,subject?:string) {
  return loyaltyRecords(k,{tenant_id:t,store_id:s}).filter(r=>subject===undefined||r.body.subject_ref===subject);
}
function resourceRecords(k:CommerceKernel,t:string,s:string,resources:string[]) {
  if(!resources.length)return [];
  const ids=new Set(resources),cases=new Set((k.db.prepare('SELECT id,resource_id FROM commerce_cases WHERE tenant_id=? AND store_id=?').all(t,s) as Row[]).filter(r=>ids.has(r.resource_id)).map(r=>r.id));
  return selected(k,t,s).filter(r=>ids.has(r.body.resource_id)||cases.has(r.body.terms?.case_id??r.body.personal?.case_id));
}
export function loyaltyRedemptionResourceSubjects(k:CommerceKernel,t:string,s:string,resources:string[]) {
  return [...new Set(resourceRecords(k,t,s,resources).map(r=>r.body.subject_ref))];
}
// Only the new loyalty preview copies belong to this helper. An immutable
// receipt still binds the consumed preview after its erasable body is retired.
// Replaying suppression also catches original previews restored beside already
// minimized quotes, including quotes that never consumed an approval.
function retireCopies(k:CommerceKernel,records:LoyaltyRecord[]) {
  for(const r of records){
    if(r.kind===LOYALTY_OPERATION_KIND){
      k.db.prepare('DELETE FROM commerce_receipt_payloads WHERE tenant_id=? AND store_id=? AND receipt_id IN (SELECT id FROM commerce_operation_receipts WHERE tenant_id=? AND store_id=? AND operation_id=?)').run(r.tenant_id,r.store_id,r.tenant_id,r.store_id,r.id);
      continue;
    }
    if(r.kind!==LOYALTY_QUOTE_KIND)continue;
    const q=r.body,receipt=q.consumed_by?loyaltyOperationRecord(k,r,q.consumed_by)!.receipt:null;
    const previews=k.db.prepare("SELECT * FROM commerce_action_previews WHERE tenant_id=? AND store_id=? AND (id=? OR (json_extract(body,'$.action')=? AND json_extract(body,'$.arguments.quote_id')=?))").all(r.tenant_id,r.store_id,receipt?.preview_id??'',LOYALTY_REDEEM_ACTION,r.id) as Row[];
    for(const p of previews){
      const b=JSON.parse(p.body);if(contentDigest(b)!==p.digest)throw new Error('LOYALTY_REDEMPTION_INTEGRITY');
      if(b.redacted===true){redemptionShape(b,['redacted','original_digest']);redemptionHash(b.original_digest);if(!receipt||p.id!==receipt.preview_id)throw new Error('LOYALTY_REDEMPTION_INTEGRITY');}
      else {const a=redemptionShape(b.arguments,['quote_id','quote_digest']);if(b.action!==LOYALTY_REDEEM_ACTION||b.tenant_id!==r.tenant_id||b.store_id!==r.store_id||b.resource_id!==q.resource_id||a.quote_id!==r.id||a.quote_digest!==q.terms_digest||receipt&&p.id===receipt.preview_id&&p.digest!==receipt.preview_digest)throw new Error('LOYALTY_REDEMPTION_INTEGRITY');}
      k.db.prepare('UPDATE commerce_action_approvals SET revoked=1 WHERE tenant_id=? AND store_id=? AND preview_id=?').run(r.tenant_id,r.store_id,p.id);
      if(!b.redacted){const body={redacted:true,original_digest:p.digest};k.db.prepare('UPDATE commerce_action_previews SET body=?,digest=? WHERE tenant_id=? AND store_id=? AND id=?').run(canonical(body),contentDigest(body),r.tenant_id,r.store_id,p.id);}
    }
  }
}
export function preflightLoyaltyRedemptions(k:CommerceKernel,scope?:Row,original?:Record<string,Row[]>) {
  loyaltyRecords(k,scope);if(original)loyaltyRecords(k,scope,original);
}
export function hasLoyaltyRedemptionSubject(k:CommerceKernel,t:string,s:string,subject:string) {return selected(k,t,s,subject).length>0;}
export function exportLoyaltyRedemptionSubject(k:CommerceKernel,t:string,s:string,subject:string) {
  return selected(k,t,s,subject).map(r=>({id:r.id,kind:r.kind,subject_ref:r.body.subject_ref,resource_id:r.body.resource_id,points:r.body.points,unit:'points',state:r.kind===LOYALTY_QUOTE_KIND?'quoted':r.body.state,authority_revoked:r.body.authority_revoked,minimized:r.body.minimized,retained_under_hold:held(k,r),source_identity:r.body.source_identity,original_operation_id:r.kind===LOYALTY_OPERATION_KIND?r.id:r.body.consumed_by,subject_projection:true}));
}

/** Core evidence alone cannot exclude a contradictory source booking. Release
 * requires the configured exact native source as well. Without it, erasure can
 * minimize/revoke the record while the original reserved quantity remains held. */
function releaseLive(k:CommerceKernel,r:LoyaltyRecord,actor?:string) {
  if(r.kind!==LOYALTY_OPERATION_KIND||r.body.state!=='reserved')return r.body;
  const value=loyaltyOperationRecord(k,r,r.id)!;
  if(r.body.restored||r.body.attempt_count!==0||value.history.some((e:Row)=>!['queued','payload_attached','payload_erased'].includes(e.code)))throw new Error('LOYALTY_RESERVATION_UNCERTAIN');
  const source=releaseSources.get(k)?.get(JSON.stringify([r.tenant_id,r.store_id,r.body.source_identity]));
  if(!source)return r.body;
  assertSeparateLoyaltyDatabases(k.db,source.db);
  if(source.account!==r.body.source_account_id)throw new Error('LOYALTY_SOURCE_SCOPE_MISMATCH');
  const account=source.observeAccount(r.body.account_key);
  if(account.subject_ref!==r.body.subject_ref||source.lookup(r.id)!==null)throw new Error('LOYALTY_RESERVATION_UNCERTAIN');
  return transitionLoyalty(k,{...r,actor_id:actor??'loyalty_privacy'},value,'released','LOYALTY_AUTHORITY_REVOKED');
}
export function eraseLoyaltyRedemptionSubject(k:CommerceKernel,t:string,s:string,subject:string,actor?:string) {
  eraseRecords(k,selected(k,t,s,subject),actor);
}
export function eraseLoyaltyRedemptionResources(k:CommerceKernel,t:string,s:string,resources:string[],actor?:string) {
  eraseRecords(k,resourceRecords(k,t,s,resources),actor);
}
function eraseRecords(k:CommerceKernel,records:LoyaltyRecord[],actor?:string) {
  const bodies=new Map<string,Row>();
  // Validate and complete native live releases while both linked personal
  // records still agree. Then minimize both kinds as one lifecycle transaction.
  for(const r of records)bodies.set(r.kind+':'+r.id,releaseLive(k,r,actor));
  for(const r of records)saveLoyaltyRecord(k,retained(bodies.get(r.kind+':'+r.id)!,true),true);
  retireCopies(k,records);
}
export function revokeLoyaltyRedemptionsForUninstall(k:CommerceKernel,t:string,s:string) {
  const records=selected(k,t,s),bodies=new Map<string,Row>();
  for(const r of records)bodies.set(r.kind+':'+r.id,releaseLive(k,r));
  for(const r of records)saveLoyaltyRecord(k,retained(bodies.get(r.kind+':'+r.id)!,suppressed(k,r)||!held(k,r)),true);
  retireCopies(k,records.filter(r=>r.body.minimized||suppressed(k,r)||!held(k,r)));
}
/** Invoke before copied quotes are retired or suppression can cancel queued
 * work. Reimport validates the destination and never recopies old native rows. */
export function revokeLoyaltyRedemptionsForRestore(k:CommerceKernel,scope?:Row,checkpoint?:Row) {
  const records=loyaltyRecords(k,scope),bodies=new Map<string,Row>();
  for(const r of records){
    let b=r.body;
    if(r.kind===LOYALTY_OPERATION_KIND){
      const value=loyaltyOperationRecord(k,r,r.id)!;
      k.db.prepare('INSERT OR IGNORE INTO commerce_restored_operations VALUES(?,?,?)').run(r.tenant_id,r.store_id,r.id);
      if(b.state==='reserved')b=transitionLoyalty(k,{...r,actor_id:'loyalty_recovery'},value,'unknown','LOYALTY_OUTCOME_UNKNOWN',null,0,true);
      else b={...b,restored:true,authority_revoked:true};
    }
    bodies.set(r.kind+':'+r.id,b);
  }
  for(const r of records)saveLoyaltyRecord(k,retained(bodies.get(r.kind+':'+r.id)!,suppressed(k,r,checkpoint)||!held(k,r)),true);
  retireCopies(k,records.filter(r=>r.body.minimized||suppressed(k,r,checkpoint)||!held(k,r)));
}
