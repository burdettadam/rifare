import type {CommerceKernel,Row} from './kernel.mts';
import {id} from './kernel.mts';
import {subjectHash} from './data-guards.mts';
import {contentDigest,jsonValue} from './configuration-values.mts';

export const IMAGE_RECEIPT_KINDS=Object.freeze(['image_approval','image_observation','image_disagreement']);
export function isImageRecord(row:Row){return IMAGE_RECEIPT_KINDS.includes(JSON.parse(row.body).kind);}
function records(k:CommerceKernel,t?:string,st?:string):Row[]{
  return k.db.prepare(`SELECT * FROM commerce_assistance_receipts ${t===undefined?'':'WHERE tenant_id=? AND store_id=?'}`).all(...(t===undefined?[]:[t,st!])) as Row[];
}
function checked(row:Row){
  const value=jsonValue(JSON.parse(row.body)),{receipt_digest,...body}=value;
  if(!IMAGE_RECEIPT_KINDS.includes(value.kind)||value.id!==row.id||value.task_id!==row.task_id||!Number.isSafeInteger(value.observed_at)||value.observed_at<0||value.observed_at!==row.created_at||contentDigest(body)!==receipt_digest||!value.source||typeof value.source.sha256!=='string'||!/^[a-f0-9]{64}$/.test(value.source.sha256))throw new Error('IMAGE_RECEIPT_INTEGRITY');id(value.case_id);id(value.source.evidence_id);return value;
}
/** Erasure runs inside the owning lifecycle transaction, after its hold check.
 * Selection is by canonical image/case identity, not free text or task alone. */
export function eraseImageRecords(k:CommerceKernel,t:string,st:string,selection:{case_ids?:string[];evidence_ids?:string[];approval_ids?:string[]}){
  for(const row of records(k,t,st)){
    if(!isImageRecord(row))continue;const value=JSON.parse(row.body);
    if(selection.case_ids?.includes(value.case_id)||selection.evidence_ids?.includes(value.source?.evidence_id)||selection.approval_ids?.includes(value.kind==='image_approval'?value.id:value.approval_id))
      k.db.prepare('DELETE FROM commerce_assistance_receipts WHERE tenant_id=? AND store_id=? AND id=?').run(t,st,row.id);
  }
}
/** No raw imported body or task facts enter this subject projection. */
export function exportImageRecords(k:CommerceKernel,t:string,st:string,caseIds:string[]){
  const result:Row[]=[];
  for(const row of records(k,t,st)){
    if(!isImageRecord(row))continue;const value=checked(row);if(!caseIds.includes(value.case_id))continue;
    const linked=k.db.prepare(`SELECT c.id FROM commerce_cases c JOIN commerce_context_tasks task ON task.tenant_id=c.tenant_id AND task.store_id=c.store_id AND task.resource_id=c.resource_id
      WHERE c.tenant_id=? AND c.store_id=? AND c.id=? AND task.id=?`).get(t,st,value.case_id,row.task_id);
    if(!linked)throw new Error('IMAGE_CONTEXT_CHANGED');
    const projection:Row={id:row.id,kind:value.kind,case_id:value.case_id,source:{evidence_id:value.source?.evidence_id,sha256:value.source?.sha256},observed_at:value.observed_at,subject_projection:true,original_receipt_digest:value.receipt_digest};
    // Fixed choices/reason enums and their independent source binding suffice
    // for review/export; arbitrary provider or imported fields are excluded.
    if(value.kind==='image_observation'){
      projection.status=value.result?.status==='usable'?'usable':'unavailable';
      projection.observations=Object.fromEntries(['relevant_item_visible','usable_clarity','requested_detail_visible'].map(q=>[q,['yes','no','cannot_assess'].includes(value.result?.answers?.[q]?.choice)?value.result.answers[q].choice:null]));
      projection.handling=value.handling==='review'?'review':'cannot_assess';
      projection.execution_authorized=false;
    }
    if(value.kind==='image_disagreement')projection.reason=['image_unclear','wrong_item','detail_not_visible','other_review'].includes(value.reason)?value.reason:null;
    if(value.kind==='image_approval'){projection.purpose='return_evidence_usability';projection.expires_at=Number.isSafeInteger(value.expires_at)?value.expires_at:null;}
    result.push(projection);
  }
  return result;
}
export function imageRecipientCaseIds(k:CommerceKernel,t:string,st:string,customer:string){
  const rows=k.db.prepare('SELECT * FROM commerce_gift_cases WHERE tenant_id=? AND store_id=?').all(t,st) as Row[];
  return rows.flatMap(row=>{const body=JSON.parse(row.body);if(contentDigest(body)!==row.digest)throw new Error('GIFT_INTEGRITY');return body.recipient_customer_id===customer?[row.case_id]:[];});
}
/** Uninstall retains held content and invalidates every configuration version. */
export function revokeImageAuthority(k:CommerceKernel,t?:string,st?:string){
  k.db.prepare(`UPDATE commerce_support_documents SET state='revoked' WHERE kind='image_configuration' ${t===undefined?'':'AND tenant_id=? AND store_id=?'}`).run(...(t===undefined?[]:[t,st!]));
}
export function imageCaseHeld(k:CommerceKernel,t:string,st:string,caseId:string){
  const row={tenant_id:t,store_id:st};
  const c=k.db.prepare('SELECT customer_id FROM commerce_cases WHERE tenant_id=? AND store_id=? AND id=?').get(row.tenant_id,row.store_id,caseId) as Row|undefined;
  const gift=k.db.prepare('SELECT body,digest FROM commerce_gift_cases WHERE tenant_id=? AND store_id=? AND case_id=?').get(row.tenant_id,row.store_id,caseId) as Row|undefined;
  let recipient:string|undefined;if(gift){const body=JSON.parse(gift.body);if(contentDigest(body)!==gift.digest)throw new Error('GIFT_INTEGRITY');recipient=body.recipient_customer_id;}
  return [c?.customer_id,recipient].filter(Boolean).some(customer=>k.db.prepare('SELECT 1 FROM commerce_privacy_holds WHERE tenant_id=? AND store_id=? AND subject_hash=? AND released=0 AND expires_at>?')
    .get(row.tenant_id,row.store_id,subjectHash(row.tenant_id,row.store_id,customer!),k.clock()));
}
/** New image approvals/results are nonportable. A held copy requires separate
 * retention administration; refuse the restore/import instead of discarding it. */
export function revokeImagesForRestore(k:CommerceKernel,t?:string,st?:string){
  const rows=records(k,t,st).filter(isImageRecord);
  for(const row of rows)if(imageCaseHeld(k,row.tenant_id,row.store_id,checked(row).case_id))throw new Error('IMAGE_RESTORE_HELD_CONTENT');
  revokeImageAuthority(k,t,st);
  for(const row of rows)k.db.prepare('DELETE FROM commerce_assistance_receipts WHERE tenant_id=? AND store_id=? AND id=?').run(row.tenant_id,row.store_id,row.id);
}
