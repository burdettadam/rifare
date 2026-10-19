import type { CommerceKernel,Row } from './kernel.mts';
import { digest } from './kernel.mts';
import { canonical,contentDigest } from './configuration-values.mts';
import { decodeSkillPackage } from './skill-installer.mts';
import { checkedBundle } from './skills.mts';
import { ACTION_CONTRACTS,withinVersion } from './skill-contract.mts';
import { PROFILE_ACTIONS } from './profiles.mts';

export const EXTENSION_TABLES=Object.freeze(['commerce_extension_artifacts','commerce_extension_reviews','commerce_extension_transitions','commerce_extension_retirements']);
const AUTHORITY=new Set(EXTENSION_TABLES.slice(1));
type Check=(value:unknown)=>boolean;
const object=(value:unknown):Row=>value&&typeof value==='object'&&!Array.isArray(value)?value as Row:{};
const identifier:Check=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,96}$/.test(v);
const hash:Check=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const revision:Check=v=>typeof v==='string'&&/^[A-Za-z0-9_.-]{1,80}$/.test(v);
const version:Check=v=>{try{return typeof v==='string'&&withinVersion(v,{min:'0.0.0',max_exclusive:'999999.999999.999999'});}catch{return false;}};
const fixtureVersion:Check=v=>typeof v==='string'&&/^[A-Za-z0-9_.-]{1,96}$/.test(v);
const hostVersion:Check=v=>typeof v==='string'&&Boolean(v.trim())&&v.length<=600;
const integer:Check=v=>Number.isSafeInteger(v)&&Number(v)>=0;
const positive:Check=v=>integer(v)&&Number(v)>0;
const boolean:Check=v=>typeof v==='boolean';
const isFalse:Check=v=>v===false;
const isTrue:Check=v=>v===true;
const oneOf=(...values:unknown[]):Check=>v=>values.includes(v);
const nullable=(check:Check):Check=>v=>v===null||check(v);
const state=oneOf('staged','installed','superseded','active','proposed','reviewed','activated','rolled_back','revoked','revoked_privacy','revoked_restore');
const conformance=oneOf('instruction_contract_only','retained_host_source_and_test_pins');
const strategy=oneOf('retain_pins_and_repreview');
const pending=oneOf('retain_immutable_pins');
const action:Check=v=>typeof v==='string'&&Object.hasOwn(ACTION_CONTRACTS,v);
const path:Check=v=>typeof v==='string'&&/^(?:apps|packages|migrations|tests|planning|examples)\/[A-Za-z0-9_./-]+$/.test(v)&&!v.split('/').includes('..');
const uri:Check=v=>{if(typeof v!=='string'||v.length>400)return false;try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash;}catch{return false;}};
const testId=identifier;
const goalId:Check=v=>typeof v==='string'&&/^FEATURE-M[0-9]{2}-G[0-9]{2}$/.test(v);
const storeId:Check=v=>typeof v==='string'&&v.split('/').length===2&&v.split('/').every(identifier);

function fields(value:unknown,rules:Record<string,Check>){const source=object(value),out:Row={};for(const [field,check] of Object.entries(rules))if(Object.hasOwn(source,field)&&check(source[field]))out[field]=source[field];return out;}
function list(value:unknown,check:Check,max=128){return Array.isArray(value)?value.slice(0,max).filter(check):[];}
function map(value:unknown,clean:(value:unknown)=>unknown,max=128){return Array.isArray(value)?value.slice(0,max).map(clean):[];}
function same(a:unknown,b:unknown){try{return canonical(a)===canonical(b);}catch{return false;}}
// URI and opaque revision are one pinned reference. A missing/invalid content
// hash cannot justify retaining its otherwise identifier-shaped copied text.
const source=(value:unknown)=>{const v=object(value);return uri(v.uri)&&revision(v.revision)&&hash(v.sha256)?fields(v,{uri,revision,sha256:hash}):{};};
const pin=(value:unknown)=>fields(value,{path,sha256:hash});
const history={previous_state:state,authority_revoked:isTrue};
const actor={author:identifier,reviewer:nullable(identifier),reviewer_revision:nullable(integer),expires_at:integer,created_at:integer,human_adoption:isFalse,...history};

function profile(value:unknown,row:Row){const v=object(value);return {...fields(v,{id:identifier,revision:positive,tenant_id:x=>x===row.tenant_id,store_id:x=>x===row.store_id,skill_id:x=>x===row.extension_id,skill_digest:hash,tone:oneOf('neutral','warm','formal'),locale:oneOf('en-US','en-GB','fr-CA')}),actions:list(v.actions,oneOf(...PROFILE_ACTIONS),4),data_scope:fields(v.data_scope,{order:oneOf('session_or_store'),knowledge:oneOf('visible_only')})};}
function compatibility(value:unknown){const v=object(value);return {...fields(v,{classification:oneOf('compatible','breaking'),from_digest:hash,to_digest:hash,from_version:version,to_version:version,required_strategy:nullable(strategy),pending_cases:pending,execution_authorized:isFalse}),changed_contract_fields:list(v.changed_contract_fields,oneOf('contract','payload','engine','required_actions','configuration','input_schema','output_schema','configuration_schema'),8)};}
function profileChange(value:unknown){const v=object(value);return {...fields(v,{classification:oneOf('compatible','breaking'),before_digest:hash,after_digest:hash,skill_binding_changed:boolean,pending_cases:pending,execution_authorized:isFalse}),changed_fields:list(v.changed_fields,oneOf('id','revision','tenant_id','store_id','skill_id','skill_digest','tone','locale','actions','data_scope'),10),breaking_fields:list(v.breaking_fields,oneOf('actions','data_scope','skill_id'),3)};}
function impact(value:unknown){const v=object(value);return {...fields(v,{requires_human_adoption:isTrue,release_authorized:isFalse}),retained_tests:list(v.retained_tests,testId),removed_tests:list(v.removed_tests,testId),affected_goals:list(v.affected_goals,goalId),affected_stores:list(v.affected_stores,storeId)};}

function artifactReference(value:unknown,row:Row){const v=object(value);return {redacted:true,original_artifact_digest:hash(row.id)?row.id:null,...fields(row,{id:identifier,extension_id:identifier,version,kind:oneOf('instruction','host_adapter')}),...fields(v,{content_digest:hash})};}
/** Arbitrary artifact text survives only under the original semantic artifact,
 * payload, bundle and manifest resource pins. Current source files need not
 * equal historical source pins: this hook preserves history, not activation. */
function artifact(value:unknown,row:Row,bundleDigest:unknown){
 const v=object(value);if(v.redacted===true)return artifactReference(v,row);
 try{
  const c=object(v.contract),e=object(v.evidence),p=object(v.payload);
  const metadata={...fields(v,{format:oneOf('rifare-extension-artifact-v1'),id:x=>x===row.extension_id,version:x=>version(x)&&x===row.version,kind:x=>oneOf('instruction','host_adapter')(x)&&x===row.kind}),
   origin:source(v.origin),ownership:fields(v.ownership,{owner_id:identifier,license:oneOf('Apache-2.0','MIT','AGPL-3.0-only'),notice_sha256:hash,provenance_sha256:hash,support_id:identifier}),
   contract:{...fields(c,{sdk_version:oneOf('rifare-extension-v1'),engine_version:oneOf('1.0.0')}),actions:map(c.actions,x=>fields(x,{name:action,version}),8)},
   evidence:{fixture:fields(e.fixture,{path:x=>path(x)&&String(x).startsWith('tests/fixtures/')&&String(x).endsWith('.json'),sha256:hash,version:fixtureVersion}),source_pins:map(e.source_pins,pin,32),test_pins:map(e.test_pins,x=>fields(x,{id:testId,path:x=>typeof x==='string'&&/^tests\/development\/[a-z0-9-]+\.test\.mts$/.test(x),sha256:hash}),32)},payload:v.payload};
  if(!hash(row.id)||contentDigest(v)!==row.id||!same(metadata,v)||!hash(object(v.origin).sha256)||contentDigest(p)!==v.origin.sha256)throw Error();
  if(!/^[a-f0-9]{40}$/.test(v.origin.revision)||v.ownership.provenance_sha256!==e.fixture.sha256||!e.source_pins.length||!e.test_pins.length)throw Error();
  if(v.kind==='instruction'){
   const decoded=decodeSkillPackage(Buffer.from(canonical(p)),'json'),bundle=decoded.bundle;
   if(bundle.id!==row.extension_id||bundle.version!==row.version||bundle.digest!==bundleDigest||decoded.origin!==new URL(v.origin.uri).href||digest(bundle.files['references/NOTICE.txt'])!==v.ownership.notice_sha256)throw Error();
  }else{
   const host={...fields(p,{adapter_id:identifier,version:hostVersion,api_version:hostVersion,notice_text:x=>typeof x==='string'&&x.length<=8192&&digest(x)===v.ownership.notice_sha256}),operations:list(p.operations,x=>typeof x==='string'&&/^[A-Za-z0-9_.-]{1,96}$/.test(x),32),source_pins:map(p.source_pins,pin,32)};
   if(bundleDigest!==null||!same(host,p)||!same(p.source_pins,e.source_pins))throw Error();
  }
  return v;
 }catch{return artifactReference({content_digest:object(v.origin).sha256},row);}
}

function allowlist(table:string,value:unknown,row:Row){const b=object(value);
 if(b.redacted===true)return fields(b,{id:identifier,extension_id:identifier,artifact_id:hash,redacted:isTrue,subject_hash:hash,original_record_digest:hash,bundle_digest:nullable(hash),execution_authorized:isFalse,...history});
 if(table==='commerce_extension_artifacts')return {...fields(b,{id:x=>hash(x)&&x===row.id,extension_id:x=>x===row.extension_id,mirror_sha256:hash,bundle_digest:nullable(hash),conformance_scope:conformance,author:identifier,created_at:integer,external_qualification:isFalse,license_rights_verified:isFalse,...history}),artifact:artifact(b.artifact,row,b.bundle_digest),requested_actions:list(b.requested_actions,action,8)};
 if(table==='commerce_extension_reviews')return fields(b,{id:x=>identifier(x)&&x===row.id,tenant_id:x=>x===row.tenant_id,store_id:x=>x===row.store_id,artifact_id:x=>hash(x)&&x===row.artifact_id,artifact_digest:x=>hash(x)&&x===row.artifact_id,bundle_digest:nullable(hash),...actor,skill_approval_id:nullable(identifier),conformance_scope:conformance,contract_digest:hash,evidence_digest:hash,approved_at:integer,external_qualification:isFalse,license_rights_verified:isFalse});
 if(table==='commerce_extension_transitions')return {...fields(b,{id:x=>identifier(x)&&x===row.id,extension_id:x=>x===row.extension_id,tenant_id:x=>x===row.tenant_id,store_id:x=>x===row.store_id,from_artifact_id:hash,to_artifact_id:hash,review_id:identifier,profile_id:identifier,before_profile_digest:hash,after_profile_digest:hash,strategy:nullable(strategy),pending_cases:pending,...actor,activated_at:nullable(integer),rollback_at:nullable(integer),rollback_profile_revision:positive}),before_profile:profile(b.before_profile,row),after_profile:profile(b.after_profile,row),before_activation:b.before_activation===null?null:fields(b.before_activation,{tenant_id:x=>x===row.tenant_id,store_id:x=>x===row.store_id,skill_id:x=>x===row.extension_id,revision:positive,release_id:identifier,fallback_id:nullable(identifier)}),compatibility:compatibility(b.compatibility),profile_change:profileChange(b.profile_change)};
 return {...fields(b,{id:x=>identifier(x)&&x===row.id,extension_id:x=>x===row.extension_id,tenant_id:x=>x===row.tenant_id,store_id:x=>x===row.store_id,artifact_id:hash,replacement_artifact_id:nullable(hash),effective_at:integer,export_digest:hash,reader_retained:isTrue,strategy,...actor,external_contribution_qualified:isFalse}),notice:source(b.notice),impact:impact(b.impact)};
}
function rows(k:CommerceKernel,table:string,tenant?:string,store?:string){const where=tenant===undefined?'':' WHERE tenant_id=? AND store_id=?';return k.db.prepare('SELECT * FROM '+table+where+' ORDER BY tenant_id,store_id,id').all(...(tenant===undefined?[]:[tenant,store])) as Row[];}
function body(row:Row){try{return object(JSON.parse(row.body));}catch{return {};}}
type Binding={artifact_id:string;skill_id:string;version:string;bundle_digest:string;approval_ids:string[]};
/** Resolve exact canonical identities before removing any copied review pointer.
 * Archived bundles independently bind the skill/version/digest. A staged bundle
 * can instead bind through its real checked loader. No other skill is selected. */
function canonicalBindings(k:CommerceKernel,tenant:string,store:string){const result:Binding[]=[];
 for(const row of rows(k,'commerce_extension_artifacts',tenant,store)){
  if(row.kind!=='instruction'||!identifier(row.extension_id)||!version(row.version))continue;
  const b=body(row),candidate=new Set<string>();if(hash(b.bundle_digest))candidate.add(b.bundle_digest);
  for(const review of rows(k,'commerce_extension_reviews',tenant,store)){
   if(review.artifact_id!==row.id)continue;
   const r=body(review);if(r.artifact_digest===row.id&&hash(r.bundle_digest))candidate.add(r.bundle_digest);
   // A restore can corrupt both copied digests and add keys around otherwise
   // unchanged file strings. Recover revocation identity from the independently
   // checked archive plus its original canonical review approval. A copied
   // pointer or a matching skill/version alone never selects another bundle.
   if(!hash(row.id)||!identifier(r.skill_approval_id))continue;
   const archived=k.db.prepare(`SELECT a.bundle,a.bundle_digest,a.approval_id,p.origin FROM commerce_skill_archive a
    JOIN commerce_skill_approvals p ON p.tenant_id=a.tenant_id AND p.store_id=a.store_id AND p.id=a.approval_id
     AND p.skill_id=a.skill_id AND p.bundle_digest=a.bundle_digest
    WHERE a.tenant_id=? AND a.store_id=? AND a.skill_id=? AND a.approval_id=? AND p.version=?`).get(tenant,store,row.extension_id,r.skill_approval_id,row.version) as Row|undefined;
   try{if(archived){
    const saved=JSON.parse(archived.bundle),bundle=checkedBundle(saved.files),payload=object(object(b.artifact).payload),files=object(payload.files);
    if(bundle.id===row.extension_id&&bundle.version===row.version&&bundle.digest===archived.bundle_digest&&saved.digest===bundle.digest
     &&uri(payload.origin)&&new URL(payload.origin).href===archived.origin
     &&Object.entries(bundle.files).every(([path,content])=>Object.hasOwn(files,path)&&files[path]===content))candidate.add(bundle.digest);
   }}catch{}
  }
  // Copied digest fields may both be malformed. Recover identity only from the
  // untouched immutable artifact and its real package/content/origin bindings.
  try{const a=object(b.artifact),origin=object(a.origin);if(hash(row.id)&&a.kind===row.kind&&a.id===row.extension_id&&a.version===row.version&&contentDigest(a)===row.id&&contentDigest(a.payload)===origin.sha256){
   const decoded=decodeSkillPackage(Buffer.from(canonical(a.payload)),'json'),bundle=decoded.bundle;
   if(bundle.id===row.extension_id&&bundle.version===row.version&&typeof origin.uri==='string'&&decoded.origin===new URL(origin.uri).href)candidate.add(bundle.digest);
  }}catch{}
  for(const bundleDigest of candidate){let bound=false;
   const archived=k.db.prepare('SELECT bundle FROM commerce_skill_archive WHERE tenant_id=? AND store_id=? AND skill_id=? AND bundle_digest=?').get(tenant,store,row.extension_id,bundleDigest) as Row|undefined;
   try{if(archived){const saved=JSON.parse(archived.bundle),bundle=checkedBundle(saved.files);bound=bundle.id===row.extension_id&&bundle.version===row.version&&bundle.digest===bundleDigest&&saved.digest===bundleDigest;}}catch{}
   if(!bound)try{const decoded=decodeSkillPackage(Buffer.from(canonical(object(b.artifact).payload)),'json'),bundle=decoded.bundle;bound=bundle.id===row.extension_id&&bundle.version===row.version&&bundle.digest===bundleDigest;}catch{}
   if(!bound)continue;
   const approvals=k.db.prepare('SELECT id FROM commerce_skill_approvals WHERE tenant_id=? AND store_id=? AND skill_id=? AND version=? AND bundle_digest=?').all(tenant,store,row.extension_id,row.version,bundleDigest) as Row[];
   result.push({artifact_id:row.id,skill_id:row.extension_id,version:row.version,bundle_digest:bundleDigest,approval_ids:approvals.map(a=>a.id)});
  }
 }return result;
}
function revokeCanonical(k:CommerceKernel,tenant:string,store:string,bindings:Binding[],artifactIds:Set<string>|null){let count=0;for(const binding of bindings){if(artifactIds&&!artifactIds.has(binding.artifact_id))continue;for(const approval of binding.approval_ids)count+=Number(k.db.prepare('UPDATE commerce_skill_approvals SET revoked=1 WHERE tenant_id=? AND store_id=? AND id=? AND skill_id=? AND bundle_digest=? AND version=? AND revoked=0').run(tenant,store,approval,binding.skill_id,binding.bundle_digest,binding.version).changes);}return count;}

/** Extension configuration has no legitimate customer association. */
export function exportExtensionSubject(_k:CommerceKernel,_tenant:string,_store:string,_resourceIds:readonly string[],_customer:string,_hash:string){return Object.fromEntries(EXTENSION_TABLES.map(table=>[table,[]]));}
/** Reapply nested typed allowlists even for hash-only repeat erasure. Valid
 * unrelated merchant records remain byte-identical; copied fields are removed. */
export function eraseExtensionSubject(k:CommerceKernel,tenant:string,store:string,_resourceIds:readonly string[],_hash:string){
 return k.transaction(()=>{const bindings=canonicalBindings(k,tenant,store),revoked=new Set<string>();let minimized=0;
  for(const table of EXTENSION_TABLES)for(const row of rows(k,table,tenant,store)){const old=body(row),clean=allowlist(table,old,row);if(same(clean,old))continue;
   const damagedArtifact=table==='commerce_extension_artifacts'&&object(clean.artifact).redacted===true,state=AUTHORITY.has(table)?'revoked':damagedArtifact?'revoked_privacy':row.state;
   if(table==='commerce_extension_artifacts')revoked.add(row.id);
   if(table==='commerce_extension_reviews')revoked.add(row.artifact_id);
   if(table==='commerce_extension_transitions'){if(hash(old.from_artifact_id))revoked.add(old.from_artifact_id);if(hash(old.to_artifact_id))revoked.add(old.to_artifact_id);}
   if(table==='commerce_extension_retirements'&&hash(old.artifact_id))revoked.add(old.artifact_id);
   k.db.prepare('UPDATE '+table+' SET state=?,body=?,digest=? WHERE tenant_id=? AND store_id=? AND id=?').run(state,canonical(clean),contentDigest(clean),tenant,store,row.id);minimized++;
  }
  revokeCanonical(k,tenant,store,bindings,revoked);return {minimized,customer_records_exported:0,source_effects_dispatched:0,physical_deletion:false};
 });
}
export function revokeExtensionsForRestore(k:CommerceKernel,tenant?:string,store?:string){
 if((tenant===undefined)!==(store===undefined))throw new Error('EXTENSION_SCOPE_REQUIRED');
 return k.transaction(()=>{const scopes=new Map<string,[string,string]>();for(const row of rows(k,'commerce_extension_artifacts',tenant,store))scopes.set(row.tenant_id+'\0'+row.store_id,[row.tenant_id,row.store_id]);
  let approvals=0;for(const [t,s] of scopes.values())approvals+=revokeCanonical(k,t,s,canonicalBindings(k,t,s),null);
  for(const table of EXTENSION_TABLES)for(const row of rows(k,table,tenant,store)){const cleaned=allowlist(table,body(row),row),b={...cleaned,...(cleaned.previous_state===undefined&&state(row.state)?{previous_state:row.state}:{}),authority_revoked:true};
   const next=table==='commerce_extension_artifacts'?'revoked_restore':'revoked';
   k.db.prepare('UPDATE '+table+' SET state=?,body=?,digest=? WHERE tenant_id=? AND store_id=? AND id=?').run(next,canonical(b),contentDigest(b),row.tenant_id,row.store_id,row.id);
  }
  return {extension_authority_revoked:true,canonical_approvals_revoked:approvals,unrelated_skills_unchanged:true,archived_case_pins_preserved:true,source_effects_dispatched:0};
 });
}
