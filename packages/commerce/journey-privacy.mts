import type {CommerceKernel,Row} from './kernel.mts';
import {JOURNEY_KIND,checkedJourneyRecords,journeyRecords,journeyHeld,redactJourney,retireJourney} from './journey-records.mts';

export function preflightJourneys(k:CommerceKernel,scope?:Row,original?:Record<string,Row[]>) {
  journeyRecords(k,scope);
  if(original)checkedJourneyRecords((original.commerce_support_documents??[]).filter(row=>row.kind===JOURNEY_KIND),k.clock());
}
export function hasJourneySubject(k:CommerceKernel,t:string,s:string,subject:string) {
  return journeyRecords(k,{tenant_id:t,store_id:s}).some(row=>row.body.subject_ref===subject);
}
export function exportJourneySubject(k:CommerceKernel,t:string,s:string,subject:string) {
  return journeyRecords(k,{tenant_id:t,store_id:s}).filter(row=>row.body.subject_ref===subject).map(row=>{
    const held=journeyHeld(k,row);
    if(row.state==='revoked')retireJourney(k,row,'superseded',held);
    return {id:row.id,case_id:row.body.case_id,resource_id:row.body.resource_id,version:row.version,state:row.state,intents:row.body.intents,
      retained_under_hold:held&&row.body.status==='current',subject_projection:true};
  });
}
export function eraseJourneySubject(k:CommerceKernel,t:string,s:string,subject:string) {
  for(const row of journeyRecords(k,{tenant_id:t,store_id:s}).filter(row=>row.body.subject_ref===subject))redactJourney(k,row,'subject_erased');
}
export function revokeJourneysForUninstall(k:CommerceKernel,t:string,s:string) {
  for(const row of journeyRecords(k,{tenant_id:t,store_id:s}))retireJourney(k,row,'uninstalled',journeyHeld(k,row));
}
export function revokeJourneysForRestore(k:CommerceKernel,t?:string,s?:string) {
  const rows=journeyRecords(k,t===undefined?undefined:{tenant_id:t,store_id:s});
  const suppressed=(row:Row)=>!!k.db.prepare('SELECT 1 FROM commerce_privacy_subjects WHERE tenant_id=? AND store_id=? AND subject_hash=?')
    .get(row.tenant_id,row.store_id,row.body.subject_ref);
  // Current erasure wins over a copied hold, also on a repeated import where the
  // earlier suppression receipt already exists. Check every personal version.
  for(const row of rows)if(row.body.status==='current'&&!suppressed(row)&&journeyHeld(k,row))throw new Error('JOURNEY_RESTORE_HELD');
  for(const row of rows)if(row.body.status==='current')redactJourney(k,row,suppressed(row)?'subject_erased':'restored');
}
