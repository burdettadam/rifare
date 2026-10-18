import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {contentDigest} from '../../packages/commerce/configuration-values.mts';
import {suiteDigest} from '../../packages/agent/evaluation.mts';
import {readAdapterCatalog,fileHash} from '../../packages/conformance/adapter-catalog.mts';
import {readCatalogFixtures,runCatalogFixtures} from '../../packages/conformance/catalog-fixtures.mts';
import {nativeCatalogFactories} from './adapter-catalog-bindings.mts';
import {buildCompatibilityMatrix,compatibilityReadiness,evidenceDigest,requirementDigest,subjectDigest} from '../../packages/conformance/compatibility-matrix.mts';

const root=fileURLToPath(new URL('../../',import.meta.url));
const load=(name:string)=>JSON.parse(readFileSync(new URL('../fixtures/model-policy/'+name+'.json',import.meta.url),'utf8'));
const clock=1800000000000;
let observed:ReturnType<typeof runCatalogFixtures>|undefined;
// Two existing native fixture bindings produce the raw source observations once.
// This does not run the catalog's 231-case nested native runner.
async function setup(allCases=false){
 observed??=runCatalogFixtures(readAdapterCatalog(),readCatalogFixtures(),nativeCatalogFactories,{only:['simulator','openai']});
 const suite=load('evaluation-suite'),configuration=load('evaluation-configuration'),observations=load('evaluation-observations');
 if(!allCases){suite.cases=suite.cases.slice(0,1);observations.splice(1);}
 const adapter=readAdapterCatalog().adapters.find((a:any)=>a.id==='simulator');
 const subject={id:'local_fixture',configuration,runtime:{id:'return_typescript',version:'source_snapshot',
   engine:{name:'node',version:process.version},source_pins:[{path:'clients/return_runtime.mts',sha256:fileHash(readFileSync(new URL('../../clients/return_runtime.mts',import.meta.url)))}]},
   platform:{adapter_id:adapter.id,version:adapter.version,api_version:adapter.api_version},payment:null,fulfillment:null,
   model_capabilities:['structured_output','tool_calls'],granted_scopes:['read_orders'],
   configuration_digest:'c'.repeat(64),policy_digest:'d'.repeat(64),prompt_digest:'e'.repeat(64)};
 const requirement={id:allCases?'resolution_quality':'status_quality',tier:allCases?'bounded':'read_only',
   suite_digest:suiteDigest(suite),case_ids:suite.cases.map((c:any)=>c.id),critical_case_ids:suite.cases.map((c:any)=>c.id),
   minimum_correct_ppm:950000,required_model_capabilities:['structured_output','tool_calls'],
   operations:[{adapter_id:'simulator',operation_id:'order.read'}]};
 const evidence={id:allCases?'resolution_record':'status_record',subject_digest:subjectDigest(subject),
   observed_at:clock-2000,expires_at:clock+60000,state:'active',evaluation:{suite,configuration,observations},
   conformance:structuredClone(await observed)};
 const review={id:'review_one',author_id:'fixture_author',reviewer_id:'fixture_reviewer',state:'active',
   reviewed_at:clock-1000,expires_at:clock+60000,subject_digest:subjectDigest(subject),requirement_digest:requirementDigest(requirement),
   evidence_digest:evidenceDigest(evidence),decision:'allow_diagnostic_scope'};
 const row={id:allCases?'resolution_row':'read_row',subject,requirement,evidence,review};
 const matrix=()=>buildCompatibilityMatrix([row],{root,now:clock});
 return {row,matrix};
}

test('CASE-M07-G06-01',async()=>{
 const read=await setup(),resolution=await setup(true),m=buildCompatibilityMatrix([read.row,resolution.row],{root,now:clock});
 assert.equal(m.rows[0].status,'diagnostic_supported');
 assert.equal(m.rows[1].status,'unsupported');
 assert.equal(m.rows[1].quality.total,5);assert.equal(m.rows[1].quality.correct,2);
 assert(m.rows[1].reasons.includes('QUALITY_THRESHOLD_NOT_MET'));
 assert.equal(m.execution_authorized,false);assert.equal(m.production_qualified,false);
});
test('CASE-M07-G06-02',async()=>{
 for(const change of [
  (r:any)=>{r.evidence=null;},(r:any)=>{r.evidence.expires_at=clock;},
  (r:any)=>{r.evidence.state='revoked';},(r:any)=>{r.subject.configuration.provider='similar_provider';},
 ]){const f=await setup();change(f.row);assert.equal(f.matrix().rows[0].status,'unsupported');}
});
test('CASE-M07-G06-03',async()=>{
 for(const change of [(r:any)=>{r.subject.model_capabilities=['structured_output'];},
  (r:any)=>{r.subject.configuration_digest='f'.repeat(64);},(r:any)=>{r.subject.runtime.version='new_runtime';}]){
  const f=await setup();assert.equal(compatibilityReadiness(f.row,{root,now:clock}).diagnostic_ready,true);
  change(f.row);const ready=compatibilityReadiness(f.row,{root,now:clock});
  assert.equal(ready.diagnostic_ready,false);assert.equal(ready.execution_authorized,false);
 }
});
test('PORT-021',async()=>{
 const f=await setup(true),r=f.matrix().rows[0];
 assert.deepEqual(r.model_capabilities,['structured_output','tool_calls']);
 assert.equal(r.status,'unsupported');assert.equal(r.quality.correct_handling_ppm,400000);
 assert.equal(r.quality.authority_failures,1);assert(r.quality.failed_case_ids.includes('fabricated'));
 assert.equal(r.production_qualified,false);assert.equal(r.quality.evidence_kind,'synthetic_fixture');
});
test('M07-G06-IDENTITY-PINS-01',async()=>{
 for(const change of [(r:any)=>{r.subject.configuration.model='lookalike';},(r:any)=>{r.subject.configuration.model_digest='new_weights';},
  (r:any)=>{r.subject.platform.api_version='next';},(r:any)=>{r.subject.policy_digest='a'.repeat(64);},
  (r:any)=>{r.subject.prompt_digest='a'.repeat(64);},(r:any)=>{r.subject.runtime.engine.version='next';},
  (r:any)=>{r.subject.payment={...r.subject.platform};},(r:any)=>{r.subject.fulfillment={...r.subject.platform};}]){
  const f=await setup();change(f.row);assert.equal(f.matrix().rows[0].status,'unsupported');
 }
});
test('M07-G06-SOURCE-RECORDS-01',async()=>{
 const f=await setup(),r=f.row;
 r.evidence.conformance.observations[0].after.records[0].body.status='delivered';
 // Even an updated envelope digest cannot turn forged source facts into proof.
 r.review.evidence_digest=evidenceDigest(r.evidence);
 const result=f.matrix().rows[0];assert.equal(result.status,'unsupported');
 assert(result.reasons.includes('CONFORMANCE_INVALID'));
});
test('M07-G06-REVIEW-AND-THRESHOLD-01',async()=>{
 for(const change of [(r:any)=>{r.review=null;},(r:any)=>{r.review.reviewer_id=r.review.author_id;},
  (r:any)=>{r.review.state='revoked';},(r:any)=>{r.review.expires_at=clock;},
  (r:any)=>{r.requirement.case_ids=[];},(r:any)=>{r.requirement.minimum_correct_ppm=1;},
  (r:any)=>{r.review.decision='deny';}]){
  const f=await setup();change(f.row);assert.equal(f.matrix().rows[0].status,'unsupported');
 }
});
test('M07-G06-CLAIMS-RECOMPUTED-01',async()=>{
 const f=await setup();f.row.evidence.evaluation.observations[0].claims[1].value='delivered';
 f.row.review.evidence_digest=evidenceDigest(f.row.evidence);
 const r=f.matrix().rows[0];assert.equal(r.status,'unsupported');assert.equal(r.quality.correct,0);
 const copy=await setup();(copy.row.evidence.evaluation as any).passed=true;
 copy.row.review.evidence_digest=evidenceDigest(copy.row.evidence);
 assert.equal(copy.matrix().rows[0].status,'unsupported');
});
test('M07-G06-MISSING-PROOF-SCOPE-01',async()=>{
 const f=await setup();f.row.requirement.operations=[{adapter_id:'simulator',operation_id:'customer.read'}];
 f.row.review.requirement_digest=requirementDigest(f.row.requirement);
 assert.equal(f.matrix().rows[0].status,'unsupported');
 const unavailable=await setup();unavailable.row.requirement.operations=[{adapter_id:'simulator',operation_id:'order.refund'}];
 unavailable.row.review.requirement_digest=requirementDigest(unavailable.row.requirement);
 assert(unavailable.matrix().rows[0].reasons.includes('OPERATION_UNAVAILABLE:simulator:order.refund'));
});
test('M07-G06-RUNTIME-SOURCE-01',async()=>{
 const f=await setup();f.row.subject.runtime.source_pins[0].sha256='0'.repeat(64);
 f.row.evidence.subject_digest=subjectDigest(f.row.subject);f.row.review.subject_digest=subjectDigest(f.row.subject);
 f.row.review.evidence_digest=evidenceDigest(f.row.evidence);
 assert(f.matrix().rows[0].reasons.includes('RUNTIME_SOURCE_CHANGED'));
});
test('M07-G06-MINIMIZED-EXPORT-01',async()=>{
 const f=await setup(),m=f.matrix(),text=JSON.stringify(m);
 assert(!text.includes('ORD-FIXTURE'));assert(!text.includes('catalog-model-fixture'));
 assert.equal(m.catalog.adapter_count,35);assert.equal(m.catalog.operation_count,196);
 assert.equal(m.rows[0].report_hashes.evaluation,contentDigest(f.row.evidence.evaluation));
 assert.equal(m.rows[0].platform.api_version,'local-read-v1');assert.equal(m.rows[0].payment,null);
 assert.equal(m.rows[0].execution_authorized,false);assert.equal(m.rows[0].qualification,'local_fixture_only');
 const later=compatibilityReadiness(f.row,{root,now:clock+60000});assert.equal(later.diagnostic_ready,false);
});
