import { readFileSync } from 'node:fs';
import { digest,exact,id } from './kernel.mts';
import type { Row } from './kernel.mts';
import { canonical,contentDigest,jsonValue,sourceReference } from './configuration-values.mts';
import { decodeSkillPackage } from './skill-installer.mts';
import { ACTION_CONTRACTS,validateManifest,withinVersion } from './skill-contract.mts';
import { catalogPath,readAdapterCatalog,CATALOG_ROOT } from '../conformance/adapter-catalog.mts';

export const EXTENSION_SDK_VERSION='rifare-extension-v1';
export const EXTENSION_ARTIFACT_LIMIT=131072;
export type ExtensionContext={root?:string};
const fail=(code:string):never=>{throw new Error('EXTENSION_'+code);};
export function extensionHash(value:unknown){if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))fail('INVALID_HASH');return value;}
function version(value:unknown){if(typeof value!=='string'||!withinVersion(value,{min:'0.0.0',max_exclusive:'999999.999999.999999'}))fail('VERSION_INVALID');return value;}
function identifiers(value:unknown,max=32){if(!Array.isArray(value)||!value.length||value.length>max||new Set(value).size!==value.length||value.some(v=>typeof v!=='string'||! /^[A-Za-z0-9_.-]{1,96}$/.test(v)))fail('INPUT_INVALID');return value as string[];}
function sourcePin(input:unknown,root:string){const p=exact(input,['path','sha256']);extensionHash(p.sha256);if(typeof p.path!=='string')fail('SOURCE_PIN_INVALID');if(digest(readFileSync(catalogPath(root,p.path)))!==p.sha256)fail('SOURCE_PIN_CHANGED');return p;}
function evidence(input:unknown,root:string){
 const e=exact(input,['fixture','source_pins','test_pins']),f=exact(e.fixture,['path','sha256','version']);
 if(typeof f.version!=='string'||!/^[A-Za-z0-9_.-]{1,96}$/.test(f.version)||typeof f.path!=='string'||!f.path.startsWith('tests/fixtures/')||!f.path.endsWith('.json'))fail('FIXTURE_INVALID');
 sourcePin({path:f.path,sha256:f.sha256},root);const document=JSON.parse(readFileSync(catalogPath(root,f.path),'utf8'));if(document.version!==f.version)fail('FIXTURE_VERSION_CHANGED');
 if(!Array.isArray(e.source_pins)||!e.source_pins.length||e.source_pins.length>32||!Array.isArray(e.test_pins)||!e.test_pins.length||e.test_pins.length>32)fail('EVIDENCE_REQUIRED');
 const sources=e.source_pins.map((p:unknown)=>sourcePin(p,root));if(new Set(sources.map((p:Row)=>p.path)).size!==sources.length)fail('SOURCE_PIN_INVALID');
 const tests=e.test_pins.map((input:unknown)=>{const p=exact(input,['id','path','sha256']);id(p.id);if(typeof p.path!=='string'||!/^tests\/development\/[a-z0-9-]+\.test\.mts$/.test(p.path))fail('TEST_PIN_INVALID');sourcePin({path:p.path,sha256:p.sha256},root);const text=readFileSync(catalogPath(root,p.path),'utf8');if(!text.includes("test('"+p.id+"'")&&!text.includes('test("'+p.id+'"')&&!text.includes("test('"+p.id+' ')&&!text.includes('test("'+p.id+' '))fail('TEST_REMOVED');return p;});
 if(new Set(tests.map((p:Row)=>p.id)).size!==tests.length)fail('TEST_PIN_INVALID');return {...e,source_pins:sources,test_pins:tests};
}
/** Pure bounded artifact inspection. Source/test hashes prove retained bytes,
 * never that tests ran, a contributor owns rights, or an account is qualified. */
export function inspectExtensionArtifact(input:unknown,options:ExtensionContext={}){
 const root=options.root??CATALOG_ROOT,a=exact(jsonValue(input,EXTENSION_ARTIFACT_LIMIT),['format','id','version','kind','origin','ownership','contract','evidence','payload']);
 if(a.format!=='rifare-extension-artifact-v1'||!['instruction','host_adapter'].includes(a.kind))fail('FORMAT');id(a.id);version(a.version);
 const origin=sourceReference(a.origin);if(!/^[a-f0-9]{40}$/.test(origin.revision))fail('IMMUTABLE_SOURCE_REQUIRED');if(origin.sha256!==contentDigest(a.payload))fail('CONTENT_CHANGED');
 const owner=exact(a.ownership,['owner_id','license','notice_sha256','provenance_sha256','support_id']);id(owner.owner_id);id(owner.support_id);
 if(!['Apache-2.0','MIT','AGPL-3.0-only'].includes(owner.license))fail('LICENSE_UNKNOWN');extensionHash(owner.notice_sha256);extensionHash(owner.provenance_sha256);
 const c=exact(a.contract,['sdk_version','engine_version','actions']);if(c.sdk_version!==EXTENSION_SDK_VERSION||c.engine_version!=='1.0.0'||!Array.isArray(c.actions)||c.actions.length>8)fail('CONTRACT_INCOMPATIBLE');
 for(const raw of c.actions){const action=exact(raw,['name','version']);if(typeof action.name!=='string'||!Object.hasOwn(ACTION_CONTRACTS,action.name)||ACTION_CONTRACTS[action.name]!==action.version)fail('CONTRACT_INCOMPATIBLE');}
 if(new Set(c.actions.map((x:Row)=>x.name)).size!==c.actions.length)fail('CONTRACT_INCOMPATIBLE');
 const proof=evidence(a.evidence,root);if(owner.provenance_sha256!==proof.fixture.sha256)fail('PROVENANCE_CHANGED');
 let bundle:ReturnType<typeof decodeSkillPackage>['bundle']|null=null,conformance_scope:string;
 if(a.kind==='instruction'){
  const decoded=decodeSkillPackage(Buffer.from(canonical(a.payload)),'json');bundle=decoded.bundle;
  if(decoded.origin!==new URL(origin.uri).href||bundle.id!==a.id||bundle.version!==a.version)fail('ARTIFACT_BINDING_CHANGED');
  const checked=validateManifest(JSON.parse(bundle.files['commerce-manifest.json']),bundle.files);
  if(canonical([...checked.required_capabilities].sort())!==canonical(c.actions.map((x:Row)=>x.name).sort()))fail('CONTRACT_INCOMPATIBLE');
  for(const path of ['packages/commerce/skill-contract.mts','packages/commerce/skill-installer.mts'])if(!proof.source_pins.some((p:Row)=>p.path===path))fail('HOST_CONTRACT_PIN_REQUIRED');
  for(const required of ['CASE-M02-G04-01','CASE-M02-G04-02','CASE-M02-G04-03'])if(!proof.test_pins.some((p:Row)=>p.id===required&&p.path==='tests/development/skill-contract.test.mts'))fail('HOST_TEST_PIN_REQUIRED');
  if(!Object.hasOwn(bundle.files,'references/NOTICE.txt')||digest(bundle.files['references/NOTICE.txt'])!==owner.notice_sha256)fail('NOTICE_CHANGED');
  conformance_scope='instruction_contract_only';
 }else{
  const p=exact(a.payload,['adapter_id','version','api_version','operations','source_pins','notice_text']);id(p.adapter_id);identifiers(p.operations);
  const catalog=readAdapterCatalog(root),host=catalog.adapters.find((x:Row)=>x.id===p.adapter_id);if(!host||host.version!==p.version||host.api_version!==p.api_version||c.actions.length)fail('HOST_ADAPTER_CHANGED');
  if(canonical(p.source_pins)!==canonical(host.source_files)||canonical(proof.source_pins)!==canonical(host.source_files))fail('HOST_ADAPTER_CHANGED');
  for(const pin of host.source_files)sourcePin(pin,root);
  const required:Row[]=[];for(const name of p.operations){const operation=host.operations.find((x:Row)=>x.id===name);if(!operation||operation.semantics==='unavailable'||!operation.native_cases.length)fail('HOST_ADAPTER_UNPROVEN');required.push(...operation.native_cases);}
  if(required.some(r=>!proof.test_pins.some((p:Row)=>p.id===r.id&&p.path===r.path&&p.sha256===r.sha256)))fail('HOST_ADAPTER_UNPROVEN');
  if(typeof p.notice_text!=='string'||p.notice_text.length>8192||digest(p.notice_text)!==owner.notice_sha256)fail('NOTICE_CHANGED');
  conformance_scope='retained_host_source_and_test_pins';
 }
 const artifact={...a,origin,ownership:owner,contract:c,evidence:proof},artifactDigest=contentDigest(artifact);
 return {artifact,digest:artifactDigest,subject:{id:a.id,version:a.version,kind:a.kind,origin,ownership:owner,content_digest:origin.sha256,contract_digest:contentDigest(c),evidence_digest:contentDigest(proof),sdk_version:c.sdk_version},contract:c,evidence:proof,bundle,conformance_scope,external_qualification:false,execution_authorized:false,license_rights_verified:false,native_tests_executed:0};
}
/** Raw mirror identity is checked before parsing. No mutable tag is resolved. */
export function inspectPinnedExtensionArtifact(bytes:Buffer,expectedSha256:string,options:ExtensionContext={}){
 if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>EXTENSION_ARTIFACT_LIMIT)fail('ARTIFACT_LIMIT');extensionHash(expectedSha256);const actual=digest(bytes);
 if(actual!==expectedSha256)throw new Error('EXTENSION_DIGEST_CHANGED');
 let value:unknown;try{value=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(bytes));}catch{fail('FORMAT');}
 return {...inspectExtensionArtifact(value,options),mirror_sha256:actual};
}
