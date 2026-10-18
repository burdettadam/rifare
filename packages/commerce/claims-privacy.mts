import type { CommerceKernel,Row } from './kernel.mts';
import { canonical,contentDigest } from './configuration-values.mts';
import { subjectHash } from './data-guards.mts';
import { CLAIMS_TABLES,CLAIMS_SUBJECT_TABLES } from './claims-core.mts';

export {CLAIMS_TABLES,CLAIMS_SUBJECT_TABLES};
export const CLAIMS_STORAGE_CLASSIFICATIONS=Object.freeze(CLAIMS_TABLES.map(table=>({table,classification:table==='commerce_warranty_terms'?'merchant_configuration':'subject_business_record',scope:table==='commerce_warranty_terms'?['tenant_id','store_id']:['tenant_id','store_id','resource_id','customer_id','subject_hash']})));
const checked=(row:Row)=>{const body=JSON.parse(row.body);if(contentDigest(body)!==row.digest)throw new Error('CLAIM_RECORD_INTEGRITY');return body;};
function rows(k:CommerceKernel,table:string,tenant:string,store:string){return k.db.prepare('SELECT * FROM '+table+' WHERE tenant_id=? AND store_id=?').all(tenant,store) as Row[];}
function matches(row:Row,resources:Set<string>,tenant:string,store:string,hash:string,customer?:string){return resources.has(row.resource_id)||row.subject_hash===hash||(row.customer_id==='erased_'+hash.slice(0,32)||row.customer_id==='erased_'+hash.slice(0,40))||typeof row.customer_id==='string'&&(row.customer_id===customer||subjectHash(tenant,store,row.customer_id)===hash);}
function project(row:Row,table:string){const body={...checked(row)};delete body.claimant_session_hash;delete body.proposer_session_hash;
  if(table==='commerce_claim_approvals'){delete body.approver;body.replay_allowed=false;}
  if(table==='commerce_claim_submissions'){delete body.approval_id;delete body.approval_digest;delete body.partner_pin;}
  const value={...row,body:canonical(body),digest:contentDigest(body),source_record_digest:row.digest,projection:'subject_export_without_execution_authority'};
  if(Object.hasOwn(value,'approval_id'))value.approval_id=null;
  if(table==='commerce_claim_approvals')value.state='revoked';return value;
}
/** Only the already-authorized canonical PrivacyLifecycle calls this projection. */
export function exportClaimsSubject(k:CommerceKernel,tenant:string,store:string,resourceIds:readonly string[],customer:string,hash:string){
  const resources=new Set(resourceIds),result:Record<string,Row[]>=Object.fromEntries(CLAIMS_TABLES.map(table=>[table,[]]));
  for(const table of CLAIMS_SUBJECT_TABLES)result[table]=rows(k,table,tenant,store).filter(row=>matches(row,resources,tenant,store,hash,customer)).map(row=>project(row,table));
  const terms=new Set(result.commerce_warranty_registrations.map(row=>checked(row).terms_id).filter(Boolean));
  result.commerce_warranty_terms=rows(k,'commerce_warranty_terms',tenant,store).filter(row=>terms.has(row.id)).map(row=>project(row,'commerce_warranty_terms'));
  return result;
}
function minimized(table:string,row:Row,body:Row,hash:string){
  const common={erased:true,redacted:true,subject_hash:hash,original_record_id:row.id,original_record_digest:body.original_record_digest??row.digest,replay_allowed:false};
  if(table==='commerce_warranty_registrations')return {...common,terms_id:body.terms_id??null,terms_digest:body.terms_digest??null,source_identity:body.source_identity??null,original_purchase_digest:body.original_purchase_digest??body.proof?.source_digest??null,registration_consent:false};
  if(table==='commerce_warranty_claims')return {...common,original_registration_id:body.original_registration_id??body.registration_id??null,original_operation_id:row.operation_id,outcome:body.outcome??null,source_identity:body.source_identity??body.operation_source_identity??body.context?.source_identity??null};
  if(table==='commerce_warranty_entitlements')return {...common,original_registration_id:body.original_registration_id??body.registration_id??null,original_operation_id:body.original_operation_id??null,quantity:1};
  if(table==='commerce_shipping_claims')return {...common,original_operation_id:row.operation_id??null,source_identity:body.source_identity??body.context?.source_identity??null};
  if(table==='commerce_dispute_packets')return {...common,original_dispute_id:body.original_dispute_id??body.data?.dispute_id??null,source_identity:body.source_identity??body.data?.source_identity??null,evidence_hash:body.evidence_hash??body.data?.evidence_hash??null};
  if(table==='commerce_claim_approvals')return {...common,original_target_digest:body.original_target_digest??body.target_digest??null,state:'revoked',expires_at:0};
  if(table==='commerce_claim_submissions')return {...common,original_operation_id:row.id,source_identity:body.source_identity??body.command?.source_identity??null,native_id:row.native_id??null,original_command_digest:body.original_command_digest??(body.command?contentDigest(body.command):null),original_target_digest:body.original_target_digest??body.target_digest??null,observed_recovered_minor:body.observed_recovered_minor??body.result?.recovered_minor??'0',currency:body.currency??body.result?.currency??null};
  return {...common,original_operation_id:row.operation_id,native_id:body.native_id??body.result?.native_id??body.result?.id??null,source_digest:body.source_digest??null};
}
/** Rebuild every allowlist on every call, including an already-pseudonymized
 * subject with no remaining resource list. Native source stores are not replayed. */
export function eraseClaimsSubject(k:CommerceKernel,tenant:string,store:string,resourceIds:readonly string[],hash:string){const resources=new Set(resourceIds);let count=0;
  for(const table of CLAIMS_SUBJECT_TABLES)for(const row of rows(k,table,tenant,store).filter(row=>matches(row,resources,tenant,store,hash))){
    const body=minimized(table,row,checked(row),hash),state=table==='commerce_claim_approvals'?'revoked':table==='commerce_warranty_registrations'?'erased':row.state;
    const clear=['commerce_warranty_claims','commerce_shipping_claims'].includes(table)?',approval_id=NULL':'';
    k.db.prepare('UPDATE '+table+' SET customer_id=?,subject_hash=?,state=?,body=?,digest=?'+clear+' WHERE tenant_id=? AND store_id=? AND id=?').run('erased_'+hash.slice(0,32),hash,state,canonical(body),contentDigest(body),tenant,store,row.id);count++;
  }
  return {minimized:count,source_effects_dispatched:0,original_entitlements_reserved:true,physical_erasure:false};
}
export function revokeClaimsForRestore(k:CommerceKernel,tenant?:string,store?:string){
  if((tenant===undefined)!==(store===undefined))throw new Error('INVALID_INPUT');const where=tenant===undefined?'':' WHERE tenant_id=? AND store_id=?',args=tenant===undefined?[]:[tenant,store!];
  k.db.prepare("UPDATE commerce_claim_approvals SET state='revoked'"+where).run(...args);
  k.db.prepare("UPDATE commerce_warranty_registrations SET state=CASE WHEN state='erased' THEN state ELSE 'review_required' END"+where).run(...args);
  for(const table of ['commerce_warranty_claims','commerce_shipping_claims']){
    const all=k.db.prepare('SELECT * FROM '+table+where).all(...args) as Row[];
    for(const row of all){const body={...checked(row)};delete body.claimant_session_hash;delete body.proposer_session_hash;const state=['proposed','approved'].includes(row.state)?'review_required':row.state;
      k.db.prepare('UPDATE '+table+' SET state=?,approval_id=NULL,body=?,digest=? WHERE tenant_id=? AND store_id=? AND id=?').run(state,canonical(body),contentDigest(body),row.tenant_id,row.store_id,row.id);
    }
  }
  return {approvals_revoked:true,registrations_require_review:true,claimant_proofs_removed:true,original_unknown_states_preserved:true,entitlement_reservations_preserved:true,source_effects_dispatched:0};
}
