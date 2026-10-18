import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CommerceKernel, Scope, Row } from './kernel.mts';
import { exact, digest } from './kernel.mts';
import { contentDigest } from './configuration-values.mts';
import { storageInventoryCurrent } from './privacy-lifecycle.mts';

type SourcePin={path:string;sha256:string};
type Surface={id:string;control:'local_sqlite'|'operator'|'external'|'synthetic_only';tables:string[];implementation:string[];export:string;erasure:string;retention:string;observation_required:string};
type SurfaceContract={version:1;schema_digest:string;runtime_roots:string[];runtime_extensions:string[];runtime_sources:SourcePin[];surfaces:Surface[]};
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const EXTENSIONS=['.cjs','.html','.js','.jsx','.mjs','.mts','.py','.ts','.tsx'];
const SURFACES=[
  'business_resources','support_conversations','attachment_media','retrieval_index','agent_task_state',
  'analytics_readmodels','integration_replicas','security_and_configuration','operation_audit','privacy_and_restore_controls',
  'provider_copies','process_and_browser_memory','caller_export_artifacts','recovery_files_and_database_pages','synthetic_fixture_storage',
];
const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const safePath=(v:unknown)=>typeof v==='string'&&/^(apps|packages)\/[A-Za-z0-9_./-]+$/.test(v)&&!v.split('/').some(x=>x==='.'||x==='..'||!x);
const same=(a:string[],b:string[])=>a.length===b.length&&[...a].sort().every((x,i)=>x===[...b].sort()[i]);

/** Proposed review inventory, never a deployment attestation. Source/schema
 * changes require review before this diagnostic can report a current inventory. */
export function privacySurfaceContract():SurfaceContract{
  const bytes=readFileSync(new URL('./contracts/privacy-storage-surfaces.v1.json',import.meta.url));
  if(bytes.length>2*1024*1024)throw new Error('PRIVACY_SURFACE_CONTRACT_INVALID');
  let c:SurfaceContract;
  try{
    c=exact(JSON.parse(bytes.toString('utf8')),['version','schema_digest','runtime_roots','runtime_extensions','runtime_sources','surfaces']) as SurfaceContract;
    if(c.version!==1||!hash(c.schema_digest)||!same(c.runtime_roots,['apps','packages'])||!same(c.runtime_extensions,EXTENSIONS)||!Array.isArray(c.surfaces)||!same(c.surfaces.map(s=>s.id),SURFACES)||!Array.isArray(c.runtime_sources)||c.runtime_sources.length>2000)throw new Error();
    for(const s of c.surfaces){
      exact(s,['id','control','tables','implementation','export','erasure','retention','observation_required']);
      if(!['local_sqlite','operator','external','synthetic_only'].includes(s.control)||!Array.isArray(s.tables)||!Array.isArray(s.implementation)||!s.implementation.length||s.implementation.some(p=>!safePath(p))||s.tables.some(t=>!/^commerce_[a-z_]+$/.test(t)))throw new Error();
      if((s.control==='local_sqlite')!==(s.tables.length>0)||[s.export,s.erasure,s.retention,s.observation_required].some(x=>typeof x!=='string'||!x.length||x.length>3000))throw new Error();
    }
    for(const p of c.runtime_sources){exact(p,['path','sha256']);if(!safePath(p.path)||!hash(p.sha256))throw new Error();}
    if(new Set(c.runtime_sources.map(p=>p.path)).size!==c.runtime_sources.length)throw new Error();
    const paths=new Set(c.runtime_sources.map(p=>p.path));
    if(c.surfaces.some(s=>s.implementation.some(p=>!paths.has(p))))throw new Error();
  }catch{throw new Error('PRIVACY_SURFACE_CONTRACT_INVALID');}
  return c;
}

/** Read actual shipped executable/HTML source membership and bytes. This is a
 * review trigger for newly introduced stores, not discovery of live heap objects,
 * provider replicas, runtime-loaded plugins or caller-created export files. */
export function observePrivacyRuntimeSources():SourcePin[]{
  const sources:SourcePin[]=[];let totalBytes=0,visited=0;
  function walk(directory:string){
    const stat=lstatSync(directory);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('PRIVACY_RUNTIME_SOURCE_UNSAFE');
    for(const name of readdirSync(directory).sort()){
      if(++visited>10000)throw new Error('PRIVACY_RUNTIME_SOURCE_LIMIT');
      const path=join(directory,name),s=lstatSync(path);
      if(s.isSymbolicLink())throw new Error('PRIVACY_RUNTIME_SOURCE_UNSAFE');
      if(s.isDirectory()){walk(path);continue;}
      if(!EXTENSIONS.includes(extname(name)))continue;
      const rel=relative(ROOT,path).split('\\').join('/');
      if(!s.isFile()||!safePath(rel)||s.size>2*1024*1024||sources.length>=2000||(totalBytes+=s.size)>32*1024*1024)throw new Error('PRIVACY_RUNTIME_SOURCE_LIMIT');
      sources.push({path:rel,sha256:digest(readFileSync(path))});
    }
  }
  for(const directory of ['apps','packages'])walk(join(ROOT,directory));
  return sources.sort((a,b)=>a.path.localeCompare(b.path));
}

/** Pure comparison for source-review tooling. An arbitrary supplied list is not
 * authenticated evidence. auditPrivacyCoverage calls the actual source observer. */
export function checkPrivacyRuntimeSources(observed:unknown){
  const expected=privacySurfaceContract().runtime_sources;
  if(!Array.isArray(observed)||observed.length!==expected.length)throw new Error('PRIVACY_RUNTIME_REVIEW_REQUIRED');
  const pins=new Map<string,string>();
  for(const item of observed){
    try{exact(item,['path','sha256']);}catch{throw new Error('PRIVACY_RUNTIME_REVIEW_REQUIRED');}
    if(!safePath(item.path)||!hash(item.sha256)||pins.has(item.path))throw new Error('PRIVACY_RUNTIME_REVIEW_REQUIRED');
    pins.set(item.path,item.sha256);
  }
  if(expected.some(p=>pins.get(p.path)!==p.sha256))throw new Error('PRIVACY_RUNTIME_REVIEW_REQUIRED');
  return {sources:expected.length,manifest_sha256:contentDigest([...expected].sort((a,b)=>a.path.localeCompare(b.path)))};
}

/** Scope-bound read-only inventory. No export, erasure, activation or provider
 * cleanup is performed. Passing local structure cannot qualify privacy. */
export function auditPrivacyCoverage(k:CommerceKernel,scope:Scope,input:unknown={}){
  const s=k.authorize(scope,'privacy.manage'),options=exact(input,input&&typeof input==='object'&&Object.hasOwn(input,'observed_surfaces')?['observed_surfaces']:[]);
  return k.transaction(()=>{
    k.authorize(scope,'privacy.manage');
    const inventory=storageInventoryCurrent(k),contract=privacySurfaceContract();
    if(contract.schema_digest!==inventory.schema_digest)throw new Error('PRIVACY_SURFACE_INVENTORY_INCOMPLETE');
    const assignment=new Map<string,Surface>();
    for(const surface of contract.surfaces)for(const name of surface.tables){
      if(assignment.has(name))throw new Error('PRIVACY_SURFACE_INVENTORY_INCOMPLETE');assignment.set(name,surface);
    }
    if(!same([...assignment.keys()],inventory.tables.map((t:Row)=>t.name)))throw new Error('PRIVACY_SURFACE_INVENTORY_INCOMPLETE');
    let surfaceDeclarationMatched=false;
    if(Object.hasOwn(options,'observed_surfaces')){
      if(!Array.isArray(options.observed_surfaces)||options.observed_surfaces.some((x:unknown)=>typeof x!=='string')||!same(options.observed_surfaces,SURFACES))throw new Error('PRIVACY_SURFACE_INVENTORY_INCOMPLETE');
      surfaceDeclarationMatched=true;
    }
    const runtime=checkPrivacyRuntimeSources(observePrivacyRuntimeSources());
    const tables=inventory.tables.map((t:Row)=>({
      name:t.name,surface:assignment.get(t.name)!.id,handling:t.handling,
      scope:t.columns.includes('tenant_id')&&t.columns.includes('store_id')?'current_merchant':'shared_control_no_row_counts',
      rows:t.columns.includes('tenant_id')&&t.columns.includes('store_id')?Number((k.db.prepare(`SELECT count(*) n FROM ${t.name} WHERE tenant_id=? AND store_id=?`).get(s.tenant_id,s.store_id) as Row).n):null,
    }));
    return {
      version:'rifare-privacy-coverage-v1',tenant_id:s.tenant_id,store_id:s.store_id,observed_at:k.clock(),
      schema_digest:inventory.schema_digest,contract_sha256:contentDigest(contract),runtime,
      local_inventory_current:true,surface_declaration_matched:surfaceDeclarationMatched,
      tables,surfaces:contract.surfaces,
      outstanding:contract.surfaces.filter(surface=>surface.control!=='local_sqlite').map(surface=>({surface:surface.id,control:surface.control,required:surface.observation_required,state:'not_verified'})),
      subject_copy_outcomes:'not_exercised_by_inventory_audit',deployment_coverage_verified:false,
      privacy_qualified:false,physical_erasure:false,legal_compliance_certification:false,
      claims_limit:'Exact SQLite schema and source bytes identify review drift. They do not discover every dynamic cache, erase caller copies, authenticate deployment declarations, prove legal retention or verify physical deletion.',
    };
  });
}
