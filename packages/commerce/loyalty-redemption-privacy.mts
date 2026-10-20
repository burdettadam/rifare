import type {CommerceKernel,Row} from './kernel.mts';
import {LOYALTY_QUOTE_KIND,LOYALTY_OPERATION_KIND} from './loyalty-redemption-values.mts';
import {loyaltyRecords,loyaltyOperationRecord,saveLoyaltyRecord,transitionLoyalty} from './loyalty-redemption-records.mts';
import type {LoyaltyRecord} from './loyalty-redemption-records.mts';

function held(k:CommerceKernel,r:LoyaltyRecord) {
  return !!k.db.prepare('SELECT 1 FROM commerce_privacy_holds WHERE tenant_id=? AND store_id=? AND subject_hash=? AND released=0 AND expires_at>?').get(r.tenant_id,r.store_id,r.body.subject_ref,k.clock());
}
function suppressed(k:CommerceKernel,r:LoyaltyRecord,checkpoint?:Row) {
  return !!k.db.prepare('SELECT 1 FROM commerce_privacy_subjects WHERE tenant_id=? AND store_id=? AND subject_hash=?').get(r.tenant_id,r.store_id,r.body.subject_ref)||!!checkpoint?.subjects?.some((s:Row)=>s.tenant_id===r.tenant_id&&s.store_id===r.store_id&&s.subject_hash===r.body.subject_ref);
}
function retained(body:Row,minimize:boolean) {
  const b={...body,authority_revoked:true,minimized:body.minimized||minimize};
  if(b.minimized){if(b.kind===LOYALTY_QUOTE_KIND)b.terms=null;else b.personal=null;}return b;
}
function selected(k:CommerceKernel,t:string,s:string,subject?:string) {
  return loyaltyRecords(k,{tenant_id:t,store_id:s}).filter(r=>subject===undefined||r.body.subject_ref===subject);
}
export function preflightLoyaltyRedemptions(k:CommerceKernel,scope?:Row,original?:Record<string,Row[]>) {
  loyaltyRecords(k,scope);if(original)loyaltyRecords(k,scope,original);
}
export function hasLoyaltyRedemptionSubject(k:CommerceKernel,t:string,s:string,subject:string) {return selected(k,t,s,subject).length>0;}
export function exportLoyaltyRedemptionSubject(k:CommerceKernel,t:string,s:string,subject:string) {
  return selected(k,t,s,subject).map(r=>({id:r.id,kind:r.kind,subject_ref:r.body.subject_ref,resource_id:r.body.resource_id,points:r.body.points,unit:'points',state:r.kind===LOYALTY_QUOTE_KIND?'quoted':r.body.state,authority_revoked:r.body.authority_revoked,minimized:r.body.minimized,retained_under_hold:held(k,r),source_identity:r.body.source_identity,original_operation_id:r.kind===LOYALTY_OPERATION_KIND?r.id:r.body.consumed_by,subject_projection:true}));
}

/** A live native reservation with no dispatch marker is known unsent under the
 * two-phase owner protocol. Restored queued copies are converted first and can
 * never enter this branch. No unknown is cancelled, retried or released. */
function releaseLive(k:CommerceKernel,r:LoyaltyRecord,actor?:string) {
  if(r.kind!==LOYALTY_OPERATION_KIND||r.body.state!=='reserved')return r.body;
  const value=loyaltyOperationRecord(k,r,r.id)!;
  if(r.body.restored||r.body.attempt_count!==0||value.history.some((e:Row)=>!['queued','payload_attached','payload_erased'].includes(e.code)))throw new Error('LOYALTY_RESERVATION_UNCERTAIN');
  return transitionLoyalty(k,{...r,actor_id:actor??'loyalty_privacy'},value,'released','LOYALTY_AUTHORITY_REVOKED');
}
export function eraseLoyaltyRedemptionSubject(k:CommerceKernel,t:string,s:string,subject:string,actor?:string) {
  const records=selected(k,t,s,subject),bodies=new Map<string,Row>();
  // Validate and complete native live releases while both linked personal
  // records still agree. Then minimize both kinds as one lifecycle transaction.
  for(const r of records)bodies.set(r.kind+':'+r.id,releaseLive(k,r,actor));
  for(const r of records)saveLoyaltyRecord(k,retained(bodies.get(r.kind+':'+r.id)!,true),true);
}
export function revokeLoyaltyRedemptionsForUninstall(k:CommerceKernel,t:string,s:string) {
  const records=selected(k,t,s),bodies=new Map<string,Row>();
  for(const r of records)bodies.set(r.kind+':'+r.id,releaseLive(k,r));
  for(const r of records)saveLoyaltyRecord(k,retained(bodies.get(r.kind+':'+r.id)!,suppressed(k,r)||!held(k,r)),true);
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
}
