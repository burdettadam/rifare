import type {CommerceKernel,Row} from './kernel.mts';
import {id} from './kernel.mts';
import {canonical,contentDigest} from './configuration-values.mts';
import {AGENCY_DELEGABLE_ACTIONS,AGENCY_ROLES} from './agency-access.mts';
import {PROFILE_ACTIONS} from './profiles.mts';

export const AGENCY_TABLES=Object.freeze(['commerce_agency_grants','commerce_shared_templates','commerce_template_offers','commerce_template_decisions']);
export const AGENCY_SUBJECT_TABLES=Object.freeze([] as string[]);
export const AGENCY_STORAGE_CLASSIFICATIONS=Object.freeze(AGENCY_TABLES.map(table=>({table,classification:table==='commerce_shared_templates'?'merchant_inert_presentation_template':'merchant_scoped_administration_authority',scope:['tenant_id','store_id'],customer_id_present:false,subject_export:'excluded_no_customer_facts',restore:table==='commerce_shared_templates'?'retain_typed_inert_presentation':'revoke_authority_without_replaying_effects'})));
type Rule=(value:any)=>any;
const identifier:Rule=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,96}$/.test(v)?v:null;
const hash:Rule=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)?v:null;
const nonnegative:Rule=v=>Number.isSafeInteger(v)&&v>=0?v:null;
const positive:Rule=v=>Number.isSafeInteger(v)&&v>=1?v:null;
const bool:Rule=v=>typeof v==='boolean'?v:null;
const choices=(values:readonly unknown[]):Rule=>v=>values.includes(v)?v:null;
const list=(item:Rule,max:number):Rule=>v=>v===null?null:Array.isArray(v)?v.slice(0,max).map(item).filter(x=>x!==null):[];
const object=(fields:Record<string,Rule>):Rule=>v=>v===null?null:!v||typeof v!=='object'||Array.isArray(v)?{}:Object.fromEntries(Object.keys(fields).filter(key=>Object.hasOwn(v,key)).map(key=>[key,fields[key](v[key])]));
const values=object({tone:choices(['neutral','warm','formal']),locale:choices(['en-US','en-GB','fr-CA'])});
const profile=object({id:identifier,revision:positive,tenant_id:identifier,store_id:identifier,skill_id:identifier,skill_digest:hash,tone:choices(['neutral','warm','formal']),locale:choices(['en-US','en-GB','fr-CA']),actions:list(choices(PROFILE_ACTIONS),4),data_scope:object({order:choices(['session_or_store']),knowledge:choices(['visible_only'])})});
const publication=object({tenant_id:identifier,store_id:identifier,template_id:identifier,version:positive,digest:hash});
const manifest=object({schema_version:choices([1]),agency_id:identifier,template_id:identifier,version:positive,values,published_at:nonnegative});
const schemas:Record<string,Rule>={
 commerce_agency_grants:object({agency_id:identifier,actor_id:identifier,role:choices(AGENCY_ROLES),actions:list(choices(AGENCY_DELEGABLE_ACTIONS),30),resource_ids:list(identifier,1000),revision:positive,permission_revision:positive,granted_by:identifier,updated_at:nonnegative,authority_revoked:bool}),
 commerce_shared_templates:manifest,
 commerce_template_offers:object({agency_id:identifier,proposer:identifier,proposer_permission_revision:positive,publication,manifest,profile_id:identifier,before_profile:profile,before_profile_digest:hash,created_at:nonnegative,authority_revoked:bool}),
 commerce_template_decisions:object({agency_id:identifier,offer_digest:hash,actor_id:identifier,owner_permission_revision:nonnegative,at:nonnegative,before_profile:profile,before_profile_digest:hash,after_profile:profile,after_profile_digest:hash,authority_revoked:bool})
};
function body(row:Row){const b=JSON.parse(row.body);if(contentDigest(b)!==row.digest)throw new Error('AGENCY_PRIVACY_INTEGRITY');return b;}
function records(k:CommerceKernel,table:string,tenant?:string,store?:string){return k.db.prepare('SELECT * FROM '+table+(tenant===undefined?'':' WHERE tenant_id=? AND store_id=?')+' ORDER BY rowid').all(...(tenant===undefined?[]:[tenant,store!])) as Row[];}
function update(k:CommerceKernel,table:string,row:Row,next:Row,state=row.state){const version=['commerce_shared_templates','commerce_template_decisions'].includes(table);
 k.db.prepare('UPDATE '+table+' SET state=?,body=?,digest=? WHERE tenant_id=? AND store_id=? AND id=?'+(version?' AND version=?':'')).run(state,canonical(next),contentDigest(next),row.tenant_id,row.store_id,row.id,...(version?[row.version]:[]));
}
function revokeGrant(k:CommerceKernel,row:Row,b:Row){
 const member=k.db.prepare('SELECT role FROM commerce_members WHERE tenant_id=? AND store_id=? AND actor_id=?').get(row.tenant_id,row.store_id,row.id) as Row;
 // Import intentionally does not restore membership. Inert grant history must
 // neither recreate a member nor turn an unrelated owner into an agency member.
 if(member&&AGENCY_ROLES.includes(member.role)){
  k.db.prepare("UPDATE commerce_permissions SET actions='[]',resource_ids='[]',revision=revision+1 WHERE tenant_id=? AND store_id=? AND actor_id=?").run(row.tenant_id,row.store_id,row.id);
  k.db.prepare('UPDATE commerce_members SET active=0 WHERE tenant_id=? AND store_id=? AND actor_id=?').run(row.tenant_id,row.store_id,row.id);
  k.db.prepare('UPDATE commerce_sessions SET revoked=1 WHERE tenant_id=? AND store_id=? AND actor_id=?').run(row.tenant_id,row.store_id,row.id);
  const p=k.db.prepare('SELECT revision FROM commerce_permissions WHERE tenant_id=? AND store_id=? AND actor_id=?').get(row.tenant_id,row.store_id,row.id) as Row;if(p)b.permission_revision=p.revision;
 }
 return {...b,actions:[],resource_ids:[],authority_revoked:true};
}
/** These records hold merchant administration and typed presentation only. */
export function exportAgencySubject(_k:CommerceKernel,_tenant:string,_store:string,_resources:readonly string[],_customer:string,_hash:string){return Object.fromEntries(AGENCY_TABLES.map(table=>[table,[] as Row[]]));}
/** Field-specific schemas reject malformed primitive values as well as nested
 * objects: a string in a tone, hash, permission, timestamp or identifier slot
 * does not automatically become retained merchant data. */
export function eraseAgencySubject(k:CommerceKernel,tenant:string,store:string,resourceIds:readonly string[],_hash:string){
 id(tenant);id(store);const subjects=new Set(resourceIds);let minimized=0;
 return k.transaction(()=>{for(const table of AGENCY_TABLES)for(const row of records(k,table,tenant,store)){
   const original=body(row);let next=schemas[table](original)??{};
   if(table==='commerce_agency_grants'&&Array.isArray(next.resource_ids))next.resource_ids=next.resource_ids.filter((resource:string)=>!subjects.has(resource));
   if(canonical(next)===canonical(original))continue;
   const state=table==='commerce_shared_templates'?'inert':'revoked';
   if(table==='commerce_agency_grants')next=revokeGrant(k,row,next);else if(table!=='commerce_shared_templates')next.authority_revoked=true;
   update(k,table,row,next,state);minimized++;
  }return {minimized,customer_records_present:false,source_effects_dispatched:0,original_case_pins_preserved:true};});
}
export function revokeAgencyForRestore(k:CommerceKernel,tenant?:string,store?:string){
 if((tenant===undefined)!==(store===undefined))throw new Error('AGENCY_SCOPE_REQUIRED');if(tenant!==undefined){id(tenant);id(store);}let sanitized=0;
 return k.transaction(()=>{for(const table of AGENCY_TABLES)for(const row of records(k,table,tenant,store)){
   const original=body(row);let next=schemas[table](original)??{},state=table==='commerce_shared_templates'?row.state:'revoked';
   if(table==='commerce_shared_templates'&&canonical(next)!==canonical(original))state='inert';
   if(table==='commerce_agency_grants')next=revokeGrant(k,row,next);else if(table!=='commerce_shared_templates')next.authority_revoked=true;
   update(k,table,row,next,state);sanitized++;
  }return {records_sanitized:sanitized,authority_revoked:true,member_sessions_revoked:true,member_sessions_created:0,source_effects_dispatched:0,original_case_pins_preserved:true};});
}
