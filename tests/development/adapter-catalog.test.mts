import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {readAdapterCatalog,validateAdapterCatalog,catalogCases} from '../../packages/conformance/adapter-catalog.mts';
import {readCatalogFixtures,validateCatalogFixtures,runCatalogFixtures} from '../../packages/conformance/catalog-fixtures.mts';
import {runPinnedCatalogCases} from '../../packages/conformance/native-catalog-runner.mts';
import {nativeCatalogFactories} from './adapter-catalog-bindings.mts';

test('CASE-M07-G05-01',async t=>{
 const catalog=readAdapterCatalog(),fixtures=readCatalogFixtures(),checked=validateAdapterCatalog(catalog);
 assert.equal(checked.adapter_count,33);assert.equal(checked.operation_count,178);assert.equal(checked.direct_fixture_count,47);assert.equal(checked.native_case_count,191);
 const direct=await runCatalogFixtures(catalog,fixtures,nativeCatalogFactories);
 assert.equal(direct.fixture_count,47);assert.equal(new Set(direct.results.map(r=>r.adapter.id)).size,25);
 for(const result of direct.results){assert.equal(result.outcome,'passed');assert.equal(result.source_observed,true);assert.equal(result.external_qualification,false);assert.equal(result.production_qualified,false);assert(['sandbox-only','unavailable'].includes(result.adapter.qualification));}
 const rma=direct.observations.find(r=>r.key==='woo_rma')!;assert.equal(rma.before.records.length,1);assert.equal(rma.after.records.length,2);assert.equal(rma.after.records[1].body.native_return_id,null);assert.deepEqual(rma.before.records[0],rma.after.records[0]);
 const manual=direct.observations.find(r=>r.key==='woo_manual')!;assert.equal(manual.after.records[0].body.refunded_payment,false);
 const gateway=direct.observations.find(r=>r.key==='woo_gateway')!;assert.equal(gateway.after.records[0].body.settled,false);
 const native=await runPinnedCatalogCases(catalog);assert.deepEqual(native.counts,{tests:191,pass:191,fail:0,cancelled:0,skipped:0,todo:0});assert.equal(native.cases.length,191);
 assert.deepEqual(native.cases.map(c=>c.id).sort(),catalogCases(catalog).map(c=>c.id).sort());
 t.diagnostic('33 declared adapters; 178 operations; 47 common-engine scenarios; 191 retained native cases executed; external qualification remains false.');
 // Optional author capture keeps inspectable fixture records outside source.
 // The normal native gate neither requires this path nor reads a stored report.
 if(process.env.RIFARE_CATALOG_EVIDENCE){const path=resolve(process.env.RIFARE_CATALOG_EVIDENCE);mkdirSync(path,{recursive:true});
  writeFileSync(join(path,'direct-source-observations.json'),JSON.stringify(direct,null,2)+'\n');
  writeFileSync(join(path,'retained-native.tap'),native.tap);
  const {tap,...report}=native;writeFileSync(join(path,'retained-native.json'),JSON.stringify(report,null,2)+'\n');}
});
test('M07-G05-CATALOG-ADAPTER-REMOVAL-01',()=>{const c=readAdapterCatalog();c.adapters.pop();assert.throws(()=>validateAdapterCatalog(c),/ADAPTER_CATALOG_COVERAGE_CHANGED/);});
test('M07-G05-CATALOG-OPERATION-REMOVAL-01',()=>{const c=readAdapterCatalog();c.adapters[0].operations.pop();assert.throws(()=>validateAdapterCatalog(c),/ADAPTER_CATALOG_COVERAGE_CHANGED/);});
test('M07-G05-CATALOG-VERSION-DRIFT-01',()=>{const c=readAdapterCatalog();c.adapters.find(a=>a.id==='woocommerce_refunds').version='unreviewed-refund-v2';assert.throws(()=>validateAdapterCatalog(c),/ADAPTER_CATALOG_CONTRACT_CHANGED/);});
test('M07-G05-CATALOG-API-DRIFT-01',()=>{const c=readAdapterCatalog();c.adapters.find(a=>a.id==='shopify_orders').api_version='2027-01';assert.throws(()=>validateAdapterCatalog(c),/ADAPTER_CATALOG_CONTRACT_CHANGED/);});
test('M07-G05-CATALOG-SCOPE-DRIFT-01',()=>{const c=readAdapterCatalog();c.adapters.find(a=>a.id==='woocommerce_refunds').operations[0].required_scopes=['read'];assert.throws(()=>validateAdapterCatalog(c),/ADAPTER_CATALOG_CONTRACT_CHANGED/);});
test('M07-G05-CATALOG-CAPABILITY-UPGRADE-01',()=>{const c=readAdapterCatalog(),o=c.adapters.find(a=>a.id==='woocommerce_rma').operations.find(o=>o.id==='returns.native-create');o.semantics='native';o.qualification='sandbox-only';assert.throws(()=>validateAdapterCatalog(c),/ADAPTER_CATALOG_COVERAGE_CHANGED/);});
test('M07-G05-CATALOG-EXTERNAL-QUALIFICATION-01',()=>{const c=readAdapterCatalog();c.adapters[0].external_scopes_attested=true;assert.throws(()=>validateAdapterCatalog(c),/ADAPTER_CATALOG_EXTERNAL_QUALIFICATION_UNAVAILABLE/);});
test('M07-G05-CATALOG-SOURCE-PIN-01',()=>{const c=readAdapterCatalog();c.adapters[0].source_files[0].sha256='0'.repeat(64);assert.throws(()=>validateAdapterCatalog(c),/ADAPTER_CATALOG_PIN_CHANGED/);});
test('M07-G05-CATALOG-NATIVE-PIN-01',()=>{const c=readAdapterCatalog();c.adapters[0].operations[0].native_cases[0].sha256='0'.repeat(64);assert.throws(()=>validateAdapterCatalog(c),/ADAPTER_CATALOG_PIN_CHANGED/);});
test('M07-G05-CATALOG-CASE-SET-01',()=>{const c=readAdapterCatalog();c.adapters.find(a=>a.id==='shopify_orders').operations[0].native_cases=[];assert.throws(()=>validateAdapterCatalog(c),/ADAPTER_CATALOG_CASE_SET_CHANGED/);});
test('M07-G05-CATALOG-NATIVE-FIRST-TOKEN-01',()=>{const c=readAdapterCatalog(),r=c.adapters[0].operations[0].native_cases[0];r.id='invented_native_case';assert.throws(()=>validateAdapterCatalog(c),/ADAPTER_CATALOG_CASE_INVALID/);});
test('M07-G05-CATALOG-MISSING-BINDING-01',()=>{const factories={...nativeCatalogFactories};delete factories.woo_refund;assert.throws(()=>validateCatalogFixtures(readAdapterCatalog(),readCatalogFixtures(),factories),/ADAPTER_CATALOG_FIXTURE_BINDING_MISSING/);});
test('M07-G05-CATALOG-MISSING-FIXTURE-01',()=>{const fixtures=readCatalogFixtures();fixtures.fixtures.pop();assert.throws(()=>validateCatalogFixtures(readAdapterCatalog(),fixtures,nativeCatalogFactories),/ADAPTER_CATALOG_FIXTURE_COVERAGE_CHANGED/);});
test('M07-G05-CATALOG-FIXTURE-CONTRACT-DRIFT-01',()=>{const fixtures=readCatalogFixtures();fixtures.fixtures.find(f=>f.key==='woo_refund').fixture.adapter.version='unreviewed';assert.throws(()=>validateCatalogFixtures(readAdapterCatalog(),fixtures,nativeCatalogFactories),/ADAPTER_CATALOG_FIXTURE_CONTRACT_DRIFT/);});
test('M07-G05-CATALOG-RESPONSE-ONLY-01',async()=>{const factories={...nativeCatalogFactories,support_email:async()=>{const f=await nativeCatalogFactories.support_email();return {...f,invoke:()=>({kind:'accepted',stage:'accepted',customer_delivered:false,native_id:'fabricated_http_success'})};}};
 await assert.rejects(()=>runCatalogFixtures(readAdapterCatalog(),readCatalogFixtures(),factories,{only:['support_email']}),/CONFORMANCE_SOURCE_EFFECT_MISSING/);
});
test('M07-G05-CATALOG-SOURCE-CORRELATION-01',async()=>{const factories={...nativeCatalogFactories,warehouse_restock:async()=>{const f=await nativeCatalogFactories.warehouse_restock();return {...f,invoke:async()=>({...await f.invoke() as any,id:'fabricated_native_id'})};}};
 await assert.rejects(()=>runCatalogFixtures(readAdapterCatalog(),readCatalogFixtures(),factories,{only:['warehouse_restock']}),/CONFORMANCE_SOURCE_REFERENCE_MISMATCH/);
});
test('M07-G05-CATALOG-UNAVAILABLE-IS-EXECUTED-01',async()=>{const r=await runCatalogFixtures(readAdapterCatalog(),readCatalogFixtures(),nativeCatalogFactories,{only:['chatwoot_customer']});assert.equal(r.results[0].adapter.semantics,'unavailable');assert.equal(r.observations[0].before.records.length,0);assert.deepEqual(r.observations[0].before,r.observations[0].after);});
test('M07-G05-CATALOG-PROVIDER-TRANSCRIPTS-01',async()=>{const r=await runCatalogFixtures(readAdapterCatalog(),readCatalogFixtures(),nativeCatalogFactories,{only:['openai_stateless','anthropic_stateless','openai_unapproved','anthropic_unapproved']});
 for(const row of r.observations){if(row.key.endsWith('unapproved')){assert.equal(row.after.records.length,1);assert.deepEqual(row.before,row.after);}else{const wire=row.after.records.find((x:any)=>x.id==='request').body.request;for(const forbidden of ['thread_id','previous_response_id','conversation_id'])assert.equal(Object.hasOwn(wire,forbidden),false);}}
});
