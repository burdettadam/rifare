import {readFileSync} from 'node:fs';
import {adapterFixture,runAdapterFixture} from './adapter-fixtures.mts';
import {CATALOG_ROOT,catalogPath,catalogOperation,validateAdapterCatalog,fileHash} from './adapter-catalog.mts';
import {canonical} from '../commerce/configuration-values.mts';
import {exact} from '../commerce/kernel.mts';
import type {Row} from '../commerce/kernel.mts';

export type CatalogFactory=()=>Promise<{invoke:()=>unknown;records:()=>Row[];cleanup:()=>unknown;descriptor?:Row;response_status?:number}>;
const fail=(reason:string):never=>{throw new Error('ADAPTER_CATALOG_FIXTURE_'+reason);};
export function readCatalogFixtures(root=CATALOG_ROOT){return JSON.parse(readFileSync(catalogPath(root,'tests/fixtures/conformance/contract-cases.v1.json'),'utf8'));}
export function validateCatalogFixtures(catalog:unknown,input:unknown,factories:Record<string,CatalogFactory>,root=CATALOG_ROOT){
 const checked=validateAdapterCatalog(catalog,root),p=exact(input,['schema_version','fixture_package','external_qualification','fixtures']);
 if(p.schema_version!==1||p.fixture_package!=='rifare_catalog_contracts_v1'||p.external_qualification!==false||!Array.isArray(p.fixtures)||!p.fixtures.length)fail('INVALID');
 const declared=checked.catalog.adapters.flatMap((a:Row)=>a.operations.flatMap((op:Row)=>op.direct_fixtures.map((ref:string)=>({key:ref.split(':')[1],adapter:a.id,operation:op.id}))));
 const expected=new Map(declared.map((r:Row)=>[r.key,r])),seen=new Set<string>();if(expected.size!==declared.length)fail('DUPLICATE_BINDING');
 for(const item of p.fixtures){exact(item,['key','fixture']);const d=expected.get(item.key);if(!d||seen.has(item.key)||typeof factories[item.key]!=='function')fail('BINDING_MISSING');seen.add(item.key);
  const f=adapterFixture(item.fixture),{adapter,operation}=catalogOperation(checked.catalog,d.adapter,d.operation);
  if(f.adapter.id!==d.adapter||f.action!==d.operation||f.adapter.version!==adapter.version||f.adapter.api_version!==adapter.api_version||f.adapter.semantics!==operation.semantics||f.adapter.qualification!==operation.qualification||canonical(f.adapter.required_scopes)!==canonical([...operation.required_scopes].sort()))fail('CONTRACT_DRIFT');
 }
 if(seen.size!==expected.size||Object.keys(factories).some(k=>!expected.has(k)))fail('COVERAGE_CHANGED');return {checked,package:p};
}
/** Native factory records come from an independently seeded wire fixture or a
 * raw source database query. Invocation results are never used as observation. */
export async function runCatalogFixtures(catalog:unknown,input:unknown,factories:Record<string,CatalogFactory>,options:{root?:string;only?:string[]}={}){
 const root=options.root??CATALOG_ROOT,{checked,package:p}=validateCatalogFixtures(catalog,input,factories,root),selected=options.only?new Set(options.only):null,results:Row[]=[],observations:Row[]=[];
 if(selected&&(!selected.size||selected.size!==options.only!.length||[...selected].some(k=>!Object.hasOwn(factories,k))))fail('SELECTION_INVALID');
 for(const item of p.fixtures){if(selected&&!selected.has(item.key))continue;const native=await factories[item.key]();
  try{const {descriptor}=catalogOperation(checked.catalog,item.fixture.adapter.id,item.fixture.action),effective={...descriptor,...native.descriptor};let before:Row|undefined,after:Row|undefined;
   const result=await runAdapterFixture(item.fixture,{descriptor:()=>structuredClone(effective),observe:()=>{const observed={ledger_id:item.fixture.source_ledger,evidence_kind:'separate_fixture_source',records:native.records()};if(!before)before=observed;else after=observed;return observed;},invoke:async()=>({status:native.response_status??200,body:await native.invoke() as Row})});
   results.push(result);observations.push({key:item.key,source_ledger:item.fixture.source_ledger,before,after});
  }catch(error){throw Object.assign(error instanceof Error?error:new Error(String(error)),{catalog_fixture:item.key});}finally{await native.cleanup();}
 }
 validateAdapterCatalog(checked.catalog,root);
 return {schema_version:1,catalog_digest:checked.digest,fixture_digest:fileHash(canonical(p)),fixture_count:results.length,results,observations,external_qualification:false,production_qualified:false};
}
