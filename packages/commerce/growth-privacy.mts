import type { CommerceKernel,Row } from './kernel.mts';
import { canonical,contentDigest } from './configuration-values.mts';
import { subjectHash } from './data-guards.mts';
import { eraseOptionalSubject,revokeOptionalForRestore } from './optional-lifecycle-core.mts';
import { exportMarketingSubject,eraseMarketingSubject,revokeMarketingForRestore } from './growth-marketing-privacy.mts';

const SHOPPING_TABLES=['commerce_shopping_carts','commerce_upsell_offers','commerce_upsell_confirmations','commerce_catalog_evaluations','commerce_catalog_changes','commerce_catalog_approvals'];
const OPTIONAL_SUBJECT_TABLES=['commerce_optional_consents','commerce_optional_media','commerce_optional_operations','commerce_optional_deletions'];
function rows(k:CommerceKernel,table:string,tenant:string,store:string){
  const result=k.db.prepare(`SELECT * FROM ${table} WHERE tenant_id=? AND store_id=?`).all(tenant,store) as Row[];
  if(result.length>10000)throw new Error('PRIVACY_BATCH_LIMIT');return result;
}
function body(row:Row){const value=JSON.parse(row.body);if(contentDigest(value)!==row.digest)throw new Error('GROWTH_INTEGRITY');return value;}
function withoutSession(row:Row){const copy={...row};delete copy.session_hash;delete copy.token_hash;return copy;}

/** Called only inside the canonical privacy-authorized subject export. Merchant
 * configuration is included only when referenced by this subject's records. */
export function exportGrowthSubject(k:CommerceKernel,tenant:string,store:string,resourceIds:string[],customer:string,hash:string){
  const owned=(row:Row)=>resourceIds.includes(row.resource_id)||row.subject_hash===hash||row.customer_id===customer;
  const result:Record<string,Row[]>={...exportMarketingSubject(k,tenant,store,resourceIds,customer,hash)};
  for(const table of [...SHOPPING_TABLES,...OPTIONAL_SUBJECT_TABLES])result[table]=rows(k,table,tenant,store).filter(owned).map(row=>{body(row);return withoutSession(row);});
  const kinds=new Set([...result.commerce_optional_consents,...result.commerce_optional_operations].map(row=>row.kind));
  result.commerce_optional_configurations=rows(k,'commerce_optional_configurations',tenant,store).filter(row=>kinds.has(row.kind));
  result.commerce_optional_quality=rows(k,'commerce_optional_quality',tenant,store).filter(row=>kinds.has(row.kind));
  return result;
}
function scalar(target:Row,key:string,value:unknown){
  if(value===null||typeof value==='string'||typeof value==='number'&&Number.isSafeInteger(value)||typeof value==='boolean')target[key]=value;
}
function shoppingAudit(table:string,row:Row,b:Row){
  const minimal:Row={redacted:true,original_digest:b.original_digest??row.digest,replay_allowed:false};
  if(table==='commerce_shopping_carts'){
    for(const key of ['cart_id','operation_id','source_identity','preview_digest'])scalar(minimal,key,b[key]??row[key]);
    scalar(minimal,'native_id',b.native_id??b.receipt?.native_id??null);
    scalar(minimal,'command_digest',b.command_digest??b.receipt?.command_digest??null);
  }else if(table==='commerce_upsell_offers'||table==='commerce_upsell_confirmations'){
    for(const key of ['offer_id','quote_id','quote_digest','edit_id','source_identity'])scalar(minimal,key,b[key]??row[key]);
  }else if(table==='commerce_catalog_evaluations'){
    for(const key of ['evaluation_id','observation_id','source_identity','source_observation_digest','prompt_digest','catalog_digest','model_digest'])scalar(minimal,key,b[key]??row[key]);
    const summary:Row={};for(const key of ['questions','observed_questions','mentions','citations','correct_claims','incorrect_claims','unsupported_questions'])scalar(summary,key,b.summary?.[key]);
    if(Object.keys(summary).length)minimal.summary=summary;
  }else if(table==='commerce_catalog_changes'){
    for(const key of ['change_id','operation_id','source_identity','command_digest'])scalar(minimal,key,b[key]??b.command?.[key]??row[key]);
    for(const key of ['native_id','before_revision','after_revision'])scalar(minimal,key,b[key]??b.receipt?.[key]??null);
  }else{
    scalar(minimal,'change_id',row.change_id);scalar(minimal,'command_digest',b.command_digest);
  }
  return minimal;
}
/** Rebuild explicit allowlists on every pass, including already redacted imports.
 * Native outcome identities survive; content, customer sessions and approval do not. */
export function eraseGrowthSubject(k:CommerceKernel,tenant:string,store:string,resourceIds:string[],hash:string){
  const pseudonym='erased_'+hash.slice(0,32);
  for(const table of SHOPPING_TABLES){
    const pk=(k.db.prepare('PRAGMA table_info('+table+')').all() as Row[]).filter(column=>column.pk).sort((a,b)=>a.pk-b.pk).map(column=>column.name);
    for(const row of rows(k,table,tenant,store).filter(row=>resourceIds.includes(row.resource_id)||subjectHash(tenant,store,row.customer_id)===hash)){
      const minimized=shoppingAudit(table,row,body(row));
      const extra=table==='commerce_upsell_confirmations'?",revoked=1,session_hash='erased'":table==='commerce_catalog_approvals'?',revoked=1,actor_id=?':'';
      k.db.prepare(`UPDATE ${table} SET body=?,digest=?,customer_id=?${extra} WHERE ${pk.map(column=>column+'=?').join(' AND ')}`)
        .run(canonical(minimized),contentDigest(minimized),pseudonym,...(table==='commerce_catalog_approvals'?[pseudonym]:[]),...pk.map(column=>row[column]));
    }
  }
  eraseMarketingSubject(k,tenant,store,resourceIds,hash);
  eraseOptionalSubject(k,tenant,store,resourceIds,hash);
}
/** Quarantine and uninstall invalidate configuration/consent/approval even for
 * subjects with no erasure tombstone. No source action is performed here. */
export function revokeGrowthForRestore(k:CommerceKernel,tenant?:string,store?:string){
  if((tenant===undefined)!==(store===undefined))throw new Error('INVALID_INPUT');
  const predicate=tenant===undefined?'':' WHERE tenant_id=? AND store_id=?',args=tenant===undefined?[]:[tenant,store!];
  k.db.prepare("UPDATE commerce_upsell_confirmations SET revoked=1,session_hash='erased'"+predicate).run(...args);
  k.db.prepare('UPDATE commerce_catalog_approvals SET revoked=1'+predicate).run(...args);
  revokeMarketingForRestore(k,tenant,store);revokeOptionalForRestore(k,tenant,store);
  return {authority_revoked:true,original_outcomes_retained:true,source_effects_dispatched:0};
}
