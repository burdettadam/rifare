import type { CommerceKernel,Row } from './kernel.mts';
import { canonical,contentDigest } from './configuration-values.mts';
import { subjectHash } from './data-guards.mts';

export const TRIAL_TABLES=Object.freeze(['commerce_trial_terms','commerce_trial_term_approvals','commerce_delivery_trials','commerce_trial_consents','commerce_trial_events']);
const subjectTables=['commerce_delivery_trials','commerce_trial_consents','commerce_trial_events'];
const rows=(k:CommerceKernel,table:string,tenant:string,store:string)=>k.db.prepare(`SELECT * FROM ${table} WHERE tenant_id=? AND store_id=?`).all(tenant,store) as Row[];
const body=(row:Row)=>{const value=JSON.parse(row.body);if(contentDigest(value)!==row.digest)throw new Error('INSTANT_TRIAL_INTEGRITY');return value;};
const only=(value:Row,keys:string[])=>Object.fromEntries(keys.filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]]));
const pseudonym=(hash:string)=>'erased_'+hash.slice(0,32);
function matches(row:Row,tenant:string,store:string,resources:string[],hash:string){return resources.includes(row.resource_id)||row.subject_hash===hash||row.customer_id===pseudonym(hash)||typeof row.customer_id==='string'&&subjectHash(tenant,store,row.customer_id)===hash;}
function scrubBinding(value:Row,hash:string){const binding=only(value,['workflow','trial_id','obligation_id','allocation_id','case_id','resource_id','native_original_order_id','currency','quantity','original_obligation_minor','order_digest','created_at']);
 if(Array.isArray(value.units))binding.units=value.units.map((unit:Row)=>only(unit,['line_id','unit_index','variant_id','obligation_minor']));
 return {...binding,customer_id:pseudonym(hash),erased:true};
}
export function exportTrialSubject(k:CommerceKernel,tenant:string,store:string,resourceIds:string[],customer:string,hash:string){
 const selected=Object.fromEntries(subjectTables.map(table=>[table,rows(k,table,tenant,store).filter(row=>matches(row,tenant,store,resourceIds,hash))])) as Record<string,Row[]>;
 const terms=new Set(selected.commerce_delivery_trials.map(row=>body(row).terms_id));
 return Object.fromEntries(TRIAL_TABLES.map(table=>{const selectedRows=subjectTables.includes(table)?selected[table]:rows(k,table,tenant,store).filter(row=>terms.has(row.terms_id??row.id));
  return [table,selectedRows.map(row=>{const original=body(row),visible=table==='commerce_trial_consents'?only(original,['id','trial_id','terms_digest','maximum_minor','currency','confirmed_at','authorization_expires_at','native_consent_id','extension_ms','reauthorization_of','qualification','erased']):original;
   return {...row,body:canonical(visible),digest:contentDigest(visible),source_digest:row.digest};})];}));
}

/** Called in the canonical erasure transaction, including hash-only replay.
 * Rebuild allowlists on every call; an erased marker never skips minimization. */
export function eraseTrialSubject(k:CommerceKernel,tenant:string,store:string,resourceIds:string[],hash:string){
 const trials=rows(k,'commerce_delivery_trials',tenant,store).filter(row=>matches(row,tenant,store,resourceIds,hash)),trialIds=new Set(trials.map(row=>row.id));let changed=0;
 const obligationIds=new Set(trials.map(row=>body(row).binding?.obligation_id).filter((value:unknown)=>typeof value==='string'));
 for(const table of subjectTables)for(const row of rows(k,table,tenant,store).filter(row=>matches(row,tenant,store,resourceIds,hash)||trialIds.has(row.trial_id))){
  const original=body(row),value:Row={...only(original,table==='commerce_delivery_trials'?['trial_id','terms_id','terms_version','terms_digest','native_terms_digest','account_id','maximum_minor','created_at','qualification']:table==='commerce_trial_consents'?['id','trial_id','terms_digest','maximum_minor','currency','confirmed_at','authorization_expires_at','native_consent_id','extension_ms','reauthorization_of','qualification']:['trial_id','request_id','source_identity','source_event_id','source_event_digest','native_return_id','observed_at','sequence','correction_of']),erased:true,redacted:true};
  if(table==='commerce_delivery_trials'&&original.binding)value.binding=scrubBinding(original.binding,hash);
  k.db.prepare(`UPDATE ${table} SET customer_id=?,subject_hash=?,body=?,digest=?${table==='commerce_delivery_trials'?",state='erased',revision=revision+1":table==='commerce_trial_consents'?',revoked=1':''} WHERE tenant_id=? AND store_id=? AND id=?`).run(pseudonym(hash),hash,canonical(value),contentDigest(value),tenant,store,row.id);changed++;
 }
 // Shared merchant terms remain available to other customers. The erased trial
 // and its revoked consent cannot reuse them; restore/uninstall revokes all.
 // Only typed trial additions are changed. Original exchange commands remain
 // byte-identical. Native observation receipts contain minimal original IDs,
 // amounts and digests, remain append-only, and carry no proof/session material.
 const selectedBinding=(binding:Row,value:Row)=>binding?.workflow==='delivery_trial'&&(trialIds.has(binding.trial_id)||resourceIds.includes(binding.resource_id)||value.privacy_subject_hash===hash||binding.customer_id===pseudonym(hash)||typeof binding.customer_id==='string'&&subjectHash(tenant,store,binding.customer_id)===hash);
 for(const row of rows(k,'commerce_instant_obligations',tenant,store)){const original=body(row);if(!selectedBinding(original.binding,original))continue;
  obligationIds.add(row.id);
  const value={source_identity:original.source_identity,binding:scrubBinding(original.binding,hash),erased:true,privacy_subject_hash:hash,original_binding_digest:original.original_binding_digest??row.digest};k.db.prepare('UPDATE commerce_instant_obligations SET body=?,digest=? WHERE tenant_id=? AND store_id=? AND id=?').run(canonical(value),contentDigest(value),tenant,store,row.id);
 }
 for(const row of rows(k,'commerce_instant_operations',tenant,store)){const original=JSON.parse(row.command);if(contentDigest(original)!==row.digest)throw new Error('INSTANT_TRIAL_INTEGRITY');if(!selectedBinding(original.binding,original))continue;
  const value={...only(original,['operation_id','tenant_id','store_id','source_identity','obligation_id','kind','generation','mandate_revision','terms_id','terms_digest','consent_id','maximum_minor','amount_minor','trial_deadline_at','expires_at','authorization_duration_ms','authorization_window_digest','trial_delivery_digest','trial_receipt_digest']),binding:scrubBinding(original.binding,hash),erased:true,privacy_subject_hash:hash,original_command_digest:original.original_command_digest??row.digest};
  k.db.prepare('UPDATE commerce_instant_operations SET command=?,digest=? WHERE tenant_id=? AND store_id=? AND id=?').run(canonical(value),contentDigest(value),tenant,store,row.id);
 }
 for(const row of rows(k,'commerce_instant_quotes',tenant,store)){const original=body(row),binding=original.plan?.binding;if(!obligationIds.has(row.obligation_id)&&!selectedBinding(binding,original))continue;
  const value={...only(original,['amount_minor','currency','source_identity','quoted_at','expires_at','qualification']),kind:row.kind,case_id:row.case_id,resource_id:row.resource_id,obligation_id:row.obligation_id,erased:true,redacted:true,privacy_subject_hash:hash,original_quote_digest:original.original_quote_digest??original.original_digest??row.digest};k.db.prepare('UPDATE commerce_instant_quotes SET body=?,digest=? WHERE tenant_id=? AND store_id=? AND id=?').run(canonical(value),contentDigest(value),tenant,store,row.id);
 }
 return {records_minimized:changed,original_operations_preserved:true,source_erasure_confirmed:false};
}

export function revokeTrialsForRestore(k:CommerceKernel,tenant?:string,store?:string){
 if((tenant===undefined)!==(store===undefined))throw new Error('INSTANT_TRIAL_SCOPE_REQUIRED');
 const scopes=tenant!==undefined&&store!==undefined?[{tenant_id:tenant,store_id:store}]:(k.db.prepare('SELECT DISTINCT tenant_id,store_id FROM commerce_delivery_trials UNION SELECT DISTINCT tenant_id,store_id FROM commerce_trial_terms').all() as Row[]);
 for(const scope of scopes){
  k.db.prepare('UPDATE commerce_trial_term_approvals SET revoked=1 WHERE tenant_id=? AND store_id=?').run(scope.tenant_id,scope.store_id);
  for(const row of rows(k,'commerce_trial_consents',scope.tenant_id,scope.store_id)){const original=body(row),value=only(original,['id','trial_id','terms_digest','maximum_minor','currency','confirmed_at','authorization_expires_at','native_consent_id','extension_ms','reauthorization_of','qualification','erased','redacted']);
   k.db.prepare('UPDATE commerce_trial_consents SET revoked=1,body=?,digest=? WHERE tenant_id=? AND store_id=? AND id=?').run(canonical({...value,restore_revoked:true}),contentDigest({...value,restore_revoked:true}),scope.tenant_id,scope.store_id,row.id);}
  k.db.prepare("UPDATE commerce_delivery_trials SET state=CASE WHEN state='erased' THEN state ELSE 'restore_blocked' END,revision=revision+1 WHERE tenant_id=? AND store_id=?").run(scope.tenant_id,scope.store_id);
 }
 return {trial_authority_revoked:true,original_operations_preserved:true};
}
