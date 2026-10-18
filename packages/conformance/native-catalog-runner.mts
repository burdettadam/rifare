import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {catalogCases,validateAdapterCatalog,CATALOG_ROOT,fileHash} from './adapter-catalog.mts';

const fail=(reason:string):never=>{throw new Error('ADAPTER_CATALOG_NATIVE_'+reason);};
const escaped=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
/** Existing native cases retain their identities and complete source assertions.
 * This runs them; it does not import a stored pass report or infer source effects
 * from an HTTP response. Test/helper/fixture bytes are pinned before and after. */
export async function runPinnedCatalogCases(input:unknown,options:{root?:string}={}){
 const root=options.root??CATALOG_ROOT,checked=validateAdapterCatalog(input,root),cases=catalogCases(checked.catalog),paths=[...new Set(cases.map(c=>c.path))].sort();
 if(!cases.length)fail('ZERO_CASES');
 const pattern='^(?:'+cases.map(c=>escaped(c.id)).join('|')+')(?:\\s|$)',args=['--experimental-strip-types','--test','--test-reporter=tap','--test-concurrency=1','--test-name-pattern='+pattern,...paths];
 // Start a complete native runner, including when called by node:test. Its
 // inherited private child-IPC flag would otherwise replace TAP with V8 bytes.
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 const result=await new Promise<{code:number|null;tap:string}>((resolve,reject)=>{const child=spawn(process.execPath,args,{cwd:root,env,stdio:['ignore','pipe','pipe']}),chunks:Buffer[]=[];let size=0,finished=false;
  const collect=(chunk:Buffer)=>{size+=chunk.length;if(size>8*1024*1024){child.kill();reject(new Error('ADAPTER_CATALOG_NATIVE_OUTPUT_LIMIT'));return;}chunks.push(chunk);};child.stdout.on('data',collect);child.stderr.on('data',collect);child.once('error',reject);
  const timer=setTimeout(()=>{if(!finished){child.kill();reject(new Error('ADAPTER_CATALOG_NATIVE_TIMEOUT'));}},120000);
  child.once('close',code=>{finished=true;clearTimeout(timer);resolve({code,tap:Buffer.concat(chunks).toString('utf8')});});});
 validateAdapterCatalog(checked.catalog,root);
 const observed=[...result.tap.matchAll(/^ok \d+ - (.+)$/gm)].map(m=>m[1].split(/\s+/)[0]);
 const failed=[...result.tap.matchAll(/^not ok \d+ - (.+)$/gm)].map(m=>m[1].split(/\s+/)[0]);
 const count=(key:string)=>{const m=result.tap.match(new RegExp('^# '+key+' (\\d+)$','m'));if(!m)throw Object.assign(new Error('ADAPTER_CATALOG_NATIVE_REPORT_INVALID'),{native:{exit_code:result.code,tap:result.tap}});return Number(m![1]);};
 const counts=Object.fromEntries(['tests','pass','fail','cancelled','skipped','todo'].map(k=>[k,count(k)]));
 if(result.code!==0||failed.length||counts.fail||counts.cancelled||counts.skipped||counts.todo)throw Object.assign(new Error('ADAPTER_CATALOG_NATIVE_CASE_FAILED'),{native:{exit_code:result.code,counts,failed,tap:result.tap}});
 const wanted=cases.map(c=>c.id).sort();if(counts.tests!==cases.length||counts.pass!==cases.length||new Set(observed).size!==observed.length||JSON.stringify(observed.sort())!==JSON.stringify(wanted))fail('CASE_SET_MISMATCH');
 return {schema_version:1,catalog_digest:checked.digest,runner:{executable:process.execPath,version:process.version,sha256:fileHash(readFileSync(process.execPath)),args},
  cases:cases.map(c=>({...c,observed:'passed',source_assertions:'executed_in_pinned_native_case'})),counts,tap:result.tap,tap_sha256:fileHash(result.tap),
  fixture_count:cases.length,source_observation_method:'pinned_native_fixture_assertions',external_qualification:false,production_qualified:false};
}
