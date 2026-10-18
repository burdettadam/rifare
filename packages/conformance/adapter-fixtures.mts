import {exact,id,integer} from '../commerce/kernel.mts';
import type {Row} from '../commerce/kernel.mts';
import {canonical,contentDigest,jsonValue} from '../commerce/configuration-values.mts';

export const ADAPTER_FIXTURE_VERSION='rifare_adapter_fixtures_v1';
export type AdapterBinding={
 descriptor:()=>Row;
 observe:()=>Promise<Row>|Row;
 invoke:()=>Promise<{status:number;body:Row}>|{status:number;body:Row};
};
function fail(code:string):never{throw new Error('CONFORMANCE_'+code);}
function text(value:unknown){if(typeof value!=='string'||!value.trim()||value.length>180)fail('FIXTURE_INVALID');return value;}
function keys(input:unknown){if(!Array.isArray(input)||input.length>30||new Set(input).size!==input.length)fail('FIXTURE_INVALID');return input.map(text).sort();}
function path(value:unknown,selector:unknown):unknown {
 if(typeof selector!=='string'||!selector||selector.length>180)fail('FIXTURE_INVALID');
 const parts=selector.split('.');if(parts.some(p=>!p||['__proto__','prototype','constructor'].includes(p)))fail('FIXTURE_INVALID');
 let result:any=value;for(const part of parts){if(result===null||typeof result!=='object'||!Object.hasOwn(result,part))fail('REQUIRED_FIELD_MISSING');result=result[part];}return result;
}
function fields(value:unknown,expected:Row){for(const [selector,wanted]of Object.entries(expected))if(canonical(path(value,selector))!==canonical(wanted))fail('SOURCE_OR_RESPONSE_MISMATCH');}
function source(input:unknown){
 const r=exact(jsonValue(input),['ledger_id','evidence_kind','records']);id(r.ledger_id);
 if(r.evidence_kind!=='separate_fixture_source'||!Array.isArray(r.records)||r.records.length>10000)fail('SOURCE_NOT_INDEPENDENT');
 const seen=new Set<string>();for(const row of r.records){exact(row,['id','body']);id(row.id);if(seen.has(row.id)||row.body===null||typeof row.body!=='object'||Array.isArray(row.body))fail('SOURCE_INVALID');seen.add(row.id);}
 return {...r,records:[...r.records].sort((a:Row,b:Row)=>a.id.localeCompare(b.id))};
}
export function adapterFixture(input:unknown){
 const f=exact(jsonValue(input),['schema_version','id','adapter','action','resource_state','source_ledger','before_count','after_count','response_status','response_fields','source_fields','correlations']);
 if(f.schema_version!==1)fail('VERSION_CHANGED');id(f.id);if(typeof f.action!=='string'||!/^[A-Za-z0-9_.-]{1,96}$/.test(f.action))fail('FIXTURE_INVALID');text(f.resource_state);id(f.source_ledger);
 const a=exact(f.adapter,['id','version','api_version','required_scopes','semantics','qualification']);id(a.id);text(a.version);text(a.api_version);a.required_scopes=keys(a.required_scopes);
 if(!['native','composed','manual','unavailable'].includes(a.semantics)||!['sandbox-only','unavailable'].includes(a.qualification))fail('FIXTURE_INVALID');
 integer(f.before_count);integer(f.after_count);integer(f.response_status,100);if(f.response_status>599||f.before_count>10000||f.after_count>10000)fail('FIXTURE_INVALID');
 for(const value of [f.response_fields,f.source_fields])if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>100)fail('FIXTURE_INVALID');
 if(!Array.isArray(f.correlations)||f.correlations.length>40)fail('FIXTURE_INVALID');
 for(const c of f.correlations){exact(c,['response','source']);text(c.response);text(c.source);}
 if(a.semantics==='unavailable'&&(a.qualification!=='unavailable'||f.after_count!==f.before_count||f.response_status<400))fail('FIXTURE_INVALID');
 if(a.semantics!=='unavailable'&&(a.qualification!=='sandbox-only'||f.response_status>=400||!Object.keys(f.source_fields).length))fail('SOURCE_ORACLE_REQUIRED');
 return f;
}
export function assertAdapterBinding(fixture:unknown,descriptor:unknown){
 const f=adapterFixture(fixture),d=exact(jsonValue(descriptor),['id','version','api_version','granted_scopes','semantics','qualification']);
 for(const key of ['id','version','api_version','semantics','qualification'])if(d[key]!==f.adapter[key])fail(key==='version'||key==='api_version'?'VERSION_CHANGED':'CAPABILITY_CHANGED');
 const grants=keys(d.granted_scopes);if(f.adapter.required_scopes.some((s:string)=>!grants.includes(s)))fail('SCOPE_MISSING');
 return {fixture:f,descriptor:{...d,granted_scopes:grants}};
}
/** A binding invokes its adapter and independently reads source records. A valid
 * HTTP response is only one assertion; it never substitutes for those records. */
export async function runAdapterFixture(input:unknown,binding:AdapterBinding){
 const {fixture:f,descriptor}=assertAdapterBinding(input,binding.descriptor());
 const before=source(await binding.observe());if(before.ledger_id!==f.source_ledger||before.records.length!==f.before_count)fail('SOURCE_BASE_MISMATCH');
 const result=exact(jsonValue(await binding.invoke()),['status','body']);
 const after=source(await binding.observe());
 // Detect a connection or capability change during the operation as well.
 if(contentDigest(assertAdapterBinding(f,binding.descriptor()).descriptor)!==contentDigest(descriptor))fail('BINDING_CHANGED');
 if(result.status!==f.response_status)fail('HTTP_STATUS_MISMATCH');fields(result.body,f.response_fields);
 if(after.ledger_id!==before.ledger_id||after.records.length!==f.after_count)fail('SOURCE_EFFECT_MISSING');
 fields(after,f.source_fields);
 for(const c of f.correlations)if(canonical(path(result.body,c.response))!==canonical(path(after,c.source)))fail('SOURCE_REFERENCE_MISMATCH');
 if(f.adapter.semantics==='unavailable'&&contentDigest(before)!==contentDigest(after))fail('UNAVAILABLE_EFFECT');
 return {schema_version:1,fixture_package:ADAPTER_FIXTURE_VERSION,fixture_id:f.id,fixture_digest:contentDigest(f),adapter:descriptor,action:f.action,resource_state:f.resource_state,
  outcome:'passed',response_digest:contentDigest(result),source_before_digest:contentDigest(before),source_after_digest:contentDigest(after),source_record_count:after.records.length,
  qualification:'local_fixture_only',source_observed:true,external_qualification:false,production_qualified:false};
}
