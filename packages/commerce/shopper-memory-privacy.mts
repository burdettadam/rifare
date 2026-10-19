import type {CommerceKernel,Row} from './kernel.mts';
import {MEMORY_KIND,checkedMemoryRecords,memoryRecords,memoryHeld,memoryProvenance,redactMemory,retireMemory} from './shopper-memory-records.mts';

/** Preflight both a destination and (when supplied) the original transfer rows.
 * Package validation never follows the destination's subsequently erased sources. */
export function preflightShopperMemory(k:CommerceKernel,scope?:Row,original?:Record<string,Row[]>) {
  memoryRecords(k,scope);
  if(original)checkedMemoryRecords((original.commerce_support_documents??[]).filter(row=>row.kind===MEMORY_KIND),k.clock());
}
export function hasShopperMemorySubject(k:CommerceKernel,t:string,s:string,subject:string) {
  return memoryRecords(k,{tenant_id:t,store_id:s}).some(row=>row.body.subject_ref===subject);
}
export function exportShopperMemorySubject(k:CommerceKernel,t:string,s:string,subject:string) {
  const rows=memoryRecords(k,{tenant_id:t,store_id:s}).filter(row=>row.body.subject_ref===subject);
  return rows.map(row=>{
    const held=memoryHeld(k,row);
    // Released historical values can be cleaned without any live source lookup.
    // A latest active value is still the subject's retained data even if its
    // original order was reassigned; privacy export does not authorize its use.
    if(row.state==='revoked')retireMemory(k,row,'corrected',held);
    return {id:row.id,case_id:row.body.case_id,resource_id:row.body.resource_id,purpose:row.body.purpose,version:row.version,state:row.state,
      preferences:row.body.preferences,provenance:memoryProvenance(row),retained_under_hold:held&&row.body.status==='current',subject_projection:true};
  });
}
/** Called after the lifecycle's hold decision, before case/source pseudonymization.
 * Exact historical subject selection must also work with zero current resources. */
export function eraseShopperMemorySubject(k:CommerceKernel,t:string,s:string,subject:string) {
  const rows=memoryRecords(k,{tenant_id:t,store_id:s}).filter(row=>row.body.subject_ref===subject);
  for(const row of rows)redactMemory(k,row,'subject_erased');
}
export function revokeShopperMemoryForUninstall(k:CommerceKernel,t:string,s:string) {
  const rows=memoryRecords(k,{tenant_id:t,store_id:s});
  for(const row of rows)retireMemory(k,row,'uninstalled',memoryHeld(k,row));
}
export function revokeShopperMemoryForRestore(k:CommerceKernel,t?:string,s?:string) {
  const rows=memoryRecords(k,t===undefined?undefined:{tenant_id:t,store_id:s});
  const suppressed=(row:Row)=>!!k.db.prepare('SELECT 1 FROM commerce_privacy_subjects WHERE tenant_id=? AND store_id=? AND subject_hash=?')
    .get(row.tenant_id,row.store_id,row.body.subject_ref);
  // Check every held personal row before any cleanup. Existing current subject
  // suppression also overrides a copied hold on repeat imports.
  for(const row of rows)if(row.body.status==='current'&&!suppressed(row)&&memoryHeld(k,row))throw new Error('SHOPPER_MEMORY_RESTORE_HELD');
  for(const row of rows)if(row.body.status==='current')redactMemory(k,row,suppressed(row)?'subject_erased':'restored');
}
