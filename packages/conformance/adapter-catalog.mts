import {readFileSync,readdirSync,lstatSync,realpathSync} from 'node:fs';
import {resolve,relative,dirname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {exact,id} from '../commerce/kernel.mts';
import type {Row} from '../commerce/kernel.mts';
import {canonical,jsonValue} from '../commerce/configuration-values.mts';

export const ADAPTER_CATALOG_VERSION='rifare-adapter-catalog-v1';
export const CATALOG_ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const catalogFile='tests/fixtures/conformance/adapter-catalog.v1.json';
const coverageFile='tests/fixtures/conformance/expected-coverage.v1.json';
// ADR-0038: retaining the additive source/case inventory exceeds the generic
// configuration ceiling. Only this local catalog receives the bounded budget.
const CATALOG_BYTES=262144;
const fail=(reason:string):never=>{throw new Error('ADAPTER_CATALOG_'+reason);};
export const fileHash=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
export function catalogPath(root:string,path:unknown){if(typeof path!=='string'||! /^(?:apps|packages|migrations|tests|planning|examples)\/[A-Za-z0-9_./-]+$/.test(path)||path.split('/').includes('..'))fail('PATH_INVALID');
 const base=realpathSync(root),name=resolve(base,path),actual=realpathSync(name),inside=relative(base,actual);if(inside==='..'||inside.startsWith('..'+sep)||actual===base||lstatSync(name).isSymbolicLink())fail('PATH_INVALID');return actual;}
function pin(root:string,p:Row){exact(p,['path','sha256']);if(typeof p.sha256!=='string'||! /^[a-f0-9]{64}$/.test(p.sha256)||fileHash(readFileSync(catalogPath(root,p.path)))!==p.sha256)fail('PIN_CHANGED');}
function values(input:unknown,max=200):string[]{if(!Array.isArray(input)||input.length>max||new Set(input).size!==input.length||input.some(v=>typeof v!=='string'||!v||v.length>180))fail('INVALID');return input as string[];}
function files(root:string,path:string):string[]{return readdirSync(resolve(root,path),{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(root,path+'/'+e.name):e.isFile()&&e.name.endsWith('.mts')?[path+'/'+e.name]:[]).sort();}
export function readAdapterCatalog(root=CATALOG_ROOT){return JSON.parse(readFileSync(catalogPath(root,catalogFile),'utf8'));}
export function catalogCases(input:Row){const found=new Map<string,Row>();for(const a of input.adapters)for(const op of a.operations)for(const ref of op.native_cases){const old=found.get(ref.id);if(old&&canonical(old)!==canonical(ref))fail('CASE_CONFLICT');found.set(ref.id,ref);}return [...found.values()].sort((a,b)=>a.id.localeCompare(b.id));}
/** Source and native-test pins are reviewable inputs. This function cannot grant
 * runtime capability, enable transport, or qualify an external account. */
export function validateAdapterCatalog(input:unknown,root=CATALOG_ROOT){
 const c=exact(jsonValue(input,CATALOG_BYTES),['schema_version','catalog_version','scope','qualification','declaration_pins','source_files','adapters','fixture_administration','oracle_pins']);
 if(c.schema_version!==1||c.catalog_version!==ADAPTER_CATALOG_VERSION||c.scope!=='local_reusable_fixture_package'||c.qualification!=='external_qualification_blocked')fail('VERSION_CHANGED');
 const expected=JSON.parse(readFileSync(catalogPath(root,coverageFile),'utf8'));if(expected.schema_version!==1)fail('VERSION_CHANGED');
 if(!Array.isArray(c.adapters)||!c.adapters.length||c.adapters.length>100)fail('INVALID');
 const ids=new Set<string>(),sourceFiles=new Set<string>(),shape:Row={};
 for(const p of [...c.declaration_pins,...c.oracle_pins])pin(root,p);
 for(const a of c.adapters){exact(a,['id','kind','source_files','version','api_version','external_version','external_account','external_scopes_attested','source_oracle','operations']);id(a.id);
  if(ids.has(a.id)||!['platform','support','model','diagnostic'].includes(a.kind))fail('DUPLICATE_OR_UNKNOWN_ADAPTER');ids.add(a.id);
  if(a.external_version!==null||a.external_account!==null||a.external_scopes_attested!==false)fail('EXTERNAL_QUALIFICATION_UNAVAILABLE');
  for(const value of [a.version,a.api_version,a.source_oracle])if(typeof value!=='string'||!value.trim()||value.length>600)fail('INVALID');
  if(!Array.isArray(a.source_files)||!a.source_files.length)fail('SOURCE_REQUIRED');for(const p of a.source_files){pin(root,p);sourceFiles.add(p.path);}
  if(!Array.isArray(a.operations)||!a.operations.length)fail('OPERATIONS_REQUIRED');shape[a.id]={};
  for(const op of a.operations){exact(op,['id','semantics','qualification','required_scopes','scope_kind','native_cases','direct_fixtures']);
   if(typeof op.id!=='string'||! /^[A-Za-z0-9_.-]{1,96}$/.test(op.id)||Object.hasOwn(shape[a.id],op.id))fail('OPERATION_INVALID');
   if(!['native','composed','manual','unavailable'].includes(op.semantics)||op.qualification!==(op.semantics==='unavailable'?'unavailable':'sandbox-only'))fail('CAPABILITY_INVALID');
   values(op.required_scopes,30);if(!['server_local_fixture_only','configured_fixture_read_scopes','declared_read_scope_fixture_grant','configured_fixture_read_write_scopes'].includes(op.scope_kind))fail('SCOPE_INVALID');
   values(op.direct_fixtures,20);if(op.direct_fixtures.some((ref:string)=>!ref.startsWith(op.id+':')||ref.split(':').length!==2))fail('BINDING_INVALID');
   if(!Array.isArray(op.native_cases)||!op.native_cases.length&&!op.direct_fixtures.length)fail('PROOF_REQUIRED');
   for(const ref of op.native_cases){exact(ref,['id','name','path','sha256']);id(ref.id);if(typeof ref.name!=='string'||ref.name.split(/\s+/)[0]!==ref.id||!/^tests\/development\/[a-z0-9-]+\.test\.mts$/.test(ref.path))fail('CASE_INVALID');pin(root,{path:ref.path,sha256:ref.sha256});
    const text=readFileSync(catalogPath(root,ref.path),'utf8');if(!text.includes("test('"+ref.name+"'")&&!text.includes('test("'+ref.name+'"'))fail('CASE_REMOVED');}
   shape[a.id][op.id]={semantics:op.semantics,qualification:op.qualification};
  }
 }
 if(canonical(shape)!==canonical(expected.adapter_operations))fail('COVERAGE_CHANGED');
 const contracts=Object.fromEntries(c.adapters.map((a:Row)=>[a.id,{version:a.version,api_version:a.api_version,operations:Object.fromEntries(a.operations.map((o:Row)=>[o.id,{required_scopes:o.required_scopes,scope_kind:o.scope_kind}]))}]));
 if(canonical(contracts)!==canonical(expected.adapter_contracts))fail('CONTRACT_CHANGED');
 const declared=[...sourceFiles].sort();if(canonical(declared)!==canonical(c.source_files)||canonical(declared)!==canonical(expected.declarations))fail('SOURCE_COVERAGE_CHANGED');
 const actual=files(root,'packages/adapters');if(actual.some(path=>!sourceFiles.has(path)))fail('UNDECLARED_ADAPTER_SOURCE');
 for(const path of ['packages/agent/providers.mts','packages/agent/local-model.mts','packages/commerce/capabilities.mts','packages/commerce/simulator.mts'])if(!sourceFiles.has(path))fail('UNDECLARED_ADAPTER_SOURCE');
 for(const provider of ['openai','anthropic'])if(!ids.has(provider))fail('PROVIDER_REMOVED');
 for(const platform of ['shopify','woocommerce']){const p=JSON.parse(readFileSync(catalogPath(root,'examples/platforms/'+platform+'.json'),'utf8'));if(p.platform!==platform||p.status!=='design_example_unverified'||p.tested_api_version!==null)fail('PLATFORM_DECLARATION_CHANGED');}
 const cases=catalogCases(c);if(canonical(cases)!==canonical(expected.native_cases))fail('CASE_SET_CHANGED');
 return {catalog:c,digest:fileHash(JSON.stringify(c)),adapter_count:ids.size,operation_count:c.adapters.reduce((n:number,a:Row)=>n+a.operations.length,0),native_case_count:cases.length,direct_fixture_count:c.adapters.reduce((n:number,a:Row)=>n+a.operations.reduce((m:number,o:Row)=>m+o.direct_fixtures.length,0),0),external_qualification:false,production_qualified:false};
}
export function catalogDescriptor(adapter:Row,operation:Row){return {id:adapter.id,version:adapter.version,api_version:adapter.api_version,granted_scopes:[...operation.required_scopes],semantics:operation.semantics,qualification:operation.qualification};}
export function catalogOperation(catalog:Row,adapterId:string,operationId:string){const adapter=catalog.adapters.find((a:Row)=>a.id===adapterId),operation=adapter?.operations.find((o:Row)=>o.id===operationId);if(!adapter||!operation)fail('OPERATION_UNAVAILABLE');return {adapter,operation,descriptor:catalogDescriptor(adapter,operation)};}
