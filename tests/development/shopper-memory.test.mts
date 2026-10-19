import test from 'node:test';
import assert from 'node:assert/strict';
import {canonical,contentDigest} from '../../packages/commerce/configuration-values.mts';
import {PrivacyLifecycle} from '../../packages/commerce/privacy-lifecycle.mts';
import {restoreRecoverySnapshot,suppressionCheckpoint} from '../../packages/commerce/safe-recovery.mts';
import {SupportService} from '../../packages/commerce/support-service.mts';
import {subjectHash} from '../../packages/commerce/data-guards.mts';
import {
  usingMemory,contextInput,recordInput,forgetInput,readMemory,memoryRows,caseRows,
  assertEmpty,assertRedacted,replaceRow,updateResource,verifiedCustomer,secondSubject,secondStore,
  snapshot,restoreInput,restored,noRestoreResidue,merchant,target,imported,changedMerchant,changedRecovery,count,
  PURPOSE,CONTEXT_FIELDS,PROVENANCE_FIELDS,ACTIVE_FIELDS,SOURCE_FIELDS,
} from './shopper-memory-helpers.mts';
import type {Value} from './shopper-memory-helpers.mts';

// Written independently from the runtime under ADR-0053. These are 25 native
// cases, with no nested test expansion, provider calls or alternate test runner.

test('CASE-M18-G01-01',()=>usingMemory(f=>{
  f.memory.record(f.customer,recordInput(f));
  const email=readMemory(f),web=readMemory(f,{link_id:f.web.id});
  assert.equal(email.status,'available');assert.deepEqual(email.preferences,{fit_preference:'regular',response_style:'concise'});
  assert.deepEqual(web.preferences,email.preferences);assert.equal(web.version,1);assert.notEqual(web.context_digest,email.context_digest);
  f.memory.record(f.customer,recordInput(f,{link_id:f.web.id,expected_version:1,request_id:'correct_from_web',preferences:{fit_preference:'relaxed'}}));
  for(const link of [f.link,f.web]){
    const current=readMemory(f,{link_id:link.id});assert.equal(current.version,2);assert.equal(current.status,'available');
    assert.deepEqual(current.preferences,{fit_preference:'relaxed'});assert.equal(current.provenance.link_id,f.web.id);
  }
  f.memory.forget(f.customer,forgetInput(f,{expected_version:2}));
  for(const link of [f.link,f.web]){const current=readMemory(f,{link_id:link.id});assertEmpty(current,'forgotten');assert.equal(current.version,3);}
  for(const row of caseRows(f.db))assertRedacted(row);
}));

test('CASE-M18-G01-02',()=>usingMemory(f=>{
  const observed=f.now();f.memory.record(f.customer,recordInput(f));
  const context=readMemory(f,{link_id:f.web.id}),row=caseRows(f.db)[0],body=JSON.parse(row.body);
  assert.deepEqual(Object.keys(context).sort(),CONTEXT_FIELDS);assert.equal(context.schema_version,1);
  assert.equal(context.case_id,'case_one');assert.equal(context.resource_id,f.order().id);assert.equal(context.purpose,PURPOSE);
  assert.deepEqual(Object.keys(context.provenance).sort(),PROVENANCE_FIELDS);
  assert.equal(context.provenance.kind,'explicit');assert.equal(context.provenance.source,'verified_customer_request');
  assert.equal(context.provenance.link_id,f.link.id);assert.equal(context.provenance.source_revision,1);assert.equal(context.provenance.observed_at,observed);
  assert.match(context.provenance.reference,/^[a-f0-9]{64}$/);assert.notEqual(context.provenance.reference,'memory_request_one');
  assert.match(context.provenance.source_digest,/^[a-f0-9]{64}$/);assert.match(context.context_digest,/^[a-f0-9]{64}$/);
  assert.deepEqual(context.history,{status:'unavailable',source_revision:1,missing_history_is_explicit:true});
  assert.equal(context.ownership_generation,1);assert.equal(context.retained_under_hold,false);
  assert.equal(context.model_thread_required,false);assert.equal(context.execution_authorized,false);assert.equal(context.production_qualified,false);
  assert.deepEqual(Object.keys(body).sort(),ACTIVE_FIELDS);assert.deepEqual(Object.keys(body.source).sort(),SOURCE_FIELDS);
  assert.equal(body.source.kind,'verified_customer_request');assert.equal(body.source.observed_at,observed);assert.equal(row.created_at,observed);
  assert.equal(body.source.customer_source_version,1);assert.equal(body.source.order_source_version,2);
  assert.equal(body.subject_ref,subjectHash(f.a.tenant,f.a.store,'C-1001'));assert.equal(row.author,'verified_customer');
  assert.equal(row.reviewer,null);assert.equal(row.review_digest,null);assert.equal(row.digest,contentDigest(body));
  const retained=JSON.stringify([context,row]);
  for(const forbidden of [f.customerBearer,f.kernel.require(f.customer).token_hash,'memory_request_one','shopper-apparel@example.invalid'])assert.equal(retained.includes(forbidden),false);
}));

test('CASE-M18-G01-03',()=>usingMemory(f=>{
  f.memory.record(f.customer,recordInput(f));const old=readMemory(f),order=f.order();
  updateResource(f,order,{...order.payload,status:'delivered'});
  for(const link of [f.link,f.web]){const current=readMemory(f,{link_id:link.id});assertEmpty(current,'source_changed');assert.notEqual(current.context_digest,old.context_digest);}
  assertRedacted(caseRows(f.db)[0],'source_changed');
  assert.throws(()=>f.memory.record(f.customer,{...recordInput(f,{expected_version:1,request_id:'old_runtime_transcript'}),transcript:'The previous shopper preferred regular fit.'}));
  assertEmpty(readMemory(f),'source_changed');assert.equal(caseRows(f.db).length,1);
  f.memory.record(f.customer,recordInput(f,{expected_version:1,request_id:'fresh_customer_statement',preferences:{fit_preference:'close'}}));
  assert.deepEqual(readMemory(f,{link_id:f.web.id}).preferences,{fit_preference:'close'});assert.equal(readMemory(f).version,2);
}));

test('M18-G01-EXACT-SCOPE-AND-SIMILAR-NAME',()=>usingMemory(f=>{
  f.memory.record(f.customer,recordInput(f));
  const customer=f.kernel.lookup(f.a.scope,'customer','synthetic','C-1002');updateResource(f,customer,{...customer.payload,name:'Synthetic shopper'});
  const other=secondSubject(f),before=memoryRows(f.db);
  assertEmpty(f.memory.context(other.scope,other.scope,contextInput(f,{case_id:'case_other',link_id:other.link.id})),'missing');
  assert.throws(()=>f.memory.context(other.scope,other.scope,contextInput(f)));
  assert.throws(()=>f.memory.context(f.a.scope,other.scope,contextInput(f)));
  assert.throws(()=>f.memory.context(f.customer,f.customer,contextInput(f,{case_id:'case_other',link_id:other.link.id})));
  for(const scope of [f.b.scope,f.c.scope])assert.throws(()=>f.memory.context(scope,f.customer,contextInput(f)));
  assert.deepEqual(memoryRows(f.db),before);assert.deepEqual(readMemory(f).preferences,{fit_preference:'regular',response_style:'concise'});
}));

test('M18-G01-VERIFIED-LINK-AND-CUSTOMER-WRITES-ONLY',()=>usingMemory(f=>{
  f.memory.record(f.customer,recordInput(f));f.create('case_two');
  const second=f.conversations.link(f.a.scope,f.customer,{case_id:'case_two',channel:'webchat',account_id:'widget',external_id:'browser_two',history:'complete',source_revision:1});
  assert.throws(()=>readMemory(f,{link_id:second.id}));
  for(const link_id of ['browser_one','thread_one','missing_verified_link'])assert.throws(()=>readMemory(f,{link_id}));
  for(const proof of [{},f.a.scope,f.agent.scope])assert.throws(()=>f.memory.context(f.a.scope,proof,contextInput(f)));
  for(const scope of [f.a.scope,f.owner.scope,f.agent.scope,f.a.worker]){
    assert.throws(()=>f.memory.record(scope,recordInput(f,{expected_version:1,request_id:'staff_statement'})));
    assert.throws(()=>f.memory.forget(scope,forgetInput(f)));
  }
  assertEmpty(f.memory.context(f.customer,f.customer,contextInput(f,{case_id:'case_two',link_id:second.id})),'missing');
  assert.equal(caseRows(f.db).length,1);assert.equal(readMemory(f).status,'available');
}));

test('M18-G01-CURRENT-CONTACT-PROOF',()=>usingMemory(f=>{
  f.memory.record(f.customer,recordInput(f));const source=f.kernel.lookup(f.a.scope,'customer','synthetic','C-1001');
  updateResource(f,source,{...source.payload,email:'corrected-shopper@example.invalid'});
  assert.throws(()=>readMemory(f));assert.throws(()=>readMemory(f,{},f.a.scope,f.customer));
  assert.throws(()=>f.memory.record(f.customer,recordInput(f,{expected_version:1,request_id:'old_contact_request'})));
  const current=verifiedCustomer(f);
  assertEmpty(f.memory.context(current.scope,current.scope,contextInput(f,{link_id:f.web.id})),'source_changed');
  assertRedacted(caseRows(f.db)[0],'source_changed');
  f.memory.record(current.scope,recordInput(f,{expected_version:1,request_id:'verified_corrected_contact',preferences:{response_style:'detailed'}}));
  const resumed=f.memory.context(f.a.scope,current.scope,contextInput(f));
  assert.deepEqual(resumed.preferences,{response_style:'detailed'});assert.equal(resumed.version,2);
  assert.throws(()=>f.memory.context(f.a.scope,f.customer,contextInput(f)));
}));

test('M18-G01-CURRENT-ORDER-OWNERSHIP',()=>usingMemory(f=>{
  f.memory.record(f.customer,recordInput(f));const order=f.order(),before=caseRows(f.db);
  updateResource(f,order,order.payload,'C-1002');
  assert.throws(()=>f.memory.context(f.customer,f.customer,contextInput(f)));
  assert.throws(()=>f.memory.record(f.customer,recordInput(f,{expected_version:1,request_id:'former_owner'})));
  const newOwner=verifiedCustomer(f);
  assert.throws(()=>f.memory.context(f.a.scope,newOwner.scope,contextInput(f)));
  assert.throws(()=>f.conversations.link(f.a.scope,newOwner.scope,{case_id:'case_one',channel:'webchat',account_id:'widget',external_id:'browser_one',history:'complete',source_revision:2}));
  assert.deepEqual(caseRows(f.db),before,'an invalid caller cannot rewrite the former subject record while trying to retrieve it');
  const currentOrder=f.kernel.get(f.a.scope,order.id);
  // Explicit source-removal fixture: the old subject no longer owns a source
  // resource, while its retained memory still needs export and erasure.
  f.db.prepare("DELETE FROM commerce_resources WHERE tenant_id=? AND store_id=? AND (customer_id='C-1001' OR (kind='customer' AND external_id='C-1001'))").run(f.a.tenant,f.a.store);
  const privacy=new PrivacyLifecycle(f.kernel),exported:any=privacy.export(f.owner.scope,'C-1001');
  assert.equal(exported.resources.length,0);assert.equal(exported.shopper_memory_records.length,1);
  assert.equal(exported.shopper_memory_records[0].case_id,'case_one');
  assert.deepEqual(exported.shopper_memory_records[0].preferences,{fit_preference:'regular',response_style:'concise'});
  assert.equal(privacy.erase(f.owner.scope,'C-1001').status,'logically_erased');
  assertRedacted(caseRows(f.db)[0],'subject_erased');assert.deepEqual(f.kernel.get(f.a.scope,order.id),currentOrder);
  const checkpoint:any=suppressionCheckpoint(f.kernel);assert.equal(checkpoint.subjects.length,1);assert.equal(checkpoint.resources.length,0);
}));

test('M18-G01-CURRENT-PERMISSION-AND-SESSION',()=>usingMemory(f=>{
  f.memory.record(f.customer,recordInput(f));assert.equal(readMemory(f,{},f.a.scope).status,'available');
  f.permissions.change(f.owner.scope,{actor_id:'operator',role:'operator',expected_revision:0,actions:['case.read','resource.read'],resource_ids:null});
  assert.throws(()=>readMemory(f,{},f.a.scope),/ACCESS_DENIED/);
  assert.equal(readMemory(f).status,'available');const before=caseRows(f.db);
  f.kernel.revoke(f.customer);
  assert.throws(()=>readMemory(f));assert.throws(()=>f.memory.context(f.owner.scope,f.customer,contextInput(f)));
  assert.throws(()=>f.memory.record(f.customer,recordInput(f,{expected_version:1,request_id:'revoked_request'})));
  assert.throws(()=>f.memory.forget(f.customer,forgetInput(f)));
  assert.deepEqual(caseRows(f.db),before);
}));

test('M18-G01-PURPOSE-AND-INPUT-MINIMIZATION',()=>usingMemory(f=>{
  const invalid:Value[]=[
    {purpose:'marketing'},{purpose:'support_journey_and_marketing'},{preferences:{}},{preferences:{fit_preference:''}},
    {preferences:{fit_preference:'whatever the last transcript said'}},{preferences:{response_style:'friendly'}},
    {preferences:{fit_preference:'regular',inferred:true}},{preferences:{policy_override:true}},
    {preferences:{customer_email:'shopper-apparel@example.invalid'}},{preferences:['regular']},{preferences:null},
    {transcript:'PRIVATE_PROVIDER_TRANSCRIPT'},{provider_thread_id:'private_provider_thread'},{observed_at:f.now()-1},
    {inference:{model:'any'}},{source:{kind:'inferred'}},{resource_id:f.order().id},
    {request_id:'bad request id'},{expected_generation:-1},{expected_version:0.5},
  ];
  for(const patch of invalid)assert.throws(()=>f.memory.record(f.customer,recordInput(f,patch)),JSON.stringify(patch));
  assert.throws(()=>f.memory.context(f.customer,f.customer,{...contextInput(f),provider_thread_id:'private_provider_thread'}));
  assert.throws(()=>f.memory.forget(f.customer,{...forgetInput(f,{expected_version:0}),preferences:{fit_preference:'regular'}}));
  assert.throws(()=>readMemory(f,{purpose:'marketing'}));assert.equal(memoryRows(f.db).length,0);
  const descriptor=recordInput(f);Object.defineProperty(descriptor.preferences,'response_style',{enumerable:true,get:()=>{throw new Error('GETTER_MUST_NOT_EXECUTE');}});
  assert.throws(()=>f.memory.record(f.customer,descriptor),(e:any)=>e.message!=='GETTER_MUST_NOT_EXECUTE');
  assert.equal(memoryRows(f.db).length,0);
}));

test('M18-G01-FINITE-PREFERENCES-AND-EXPIRY-BOUNDS',()=>usingMemory(f=>{
  let version=0;
  for(const fit_preference of ['close','regular','relaxed'])for(const response_style of ['concise','detailed']){
    f.memory.record(f.customer,recordInput(f,{expected_version:version,request_id:'finite_'+version,preferences:{fit_preference,response_style}}));version++;
    assert.deepEqual(readMemory(f).preferences,{fit_preference,response_style});assert.equal(readMemory(f).version,version);
  }
  f.memory.record(f.customer,recordInput(f,{expected_version:version,request_id:'only_fit',preferences:{fit_preference:'regular'}}));version++;
  assert.deepEqual(readMemory(f).preferences,{fit_preference:'regular'});
  f.memory.record(f.customer,recordInput(f,{expected_version:version,request_id:'only_response',preferences:{response_style:'detailed'},expires_at:f.now()+30*86400000}));version++;
  assert.deepEqual(readMemory(f).preferences,{response_style:'detailed'});
  const before=caseRows(f.db);
  for(const [i,expires_at] of [f.now(),f.now()-1,f.now()+30*86400000+1,Number.MAX_SAFE_INTEGER+1,f.now()+0.5,null,'later'].entries())
    assert.throws(()=>f.memory.record(f.customer,recordInput(f,{expected_version:version,request_id:'expiry_invalid_'+i,expires_at})));
  assert.deepEqual(caseRows(f.db),before);
}));

test('M18-G01-MISSING-HISTORY-AND-SOURCE-LINK-REVISION',()=>usingMemory(f=>{
  const first=readMemory(f,{link_id:f.web.id});assertEmpty(first,'missing');assert.equal(first.version,0);
  assert.deepEqual(first.history,{status:'unavailable',source_revision:1,missing_history_is_explicit:true});
  f.conversations.link(f.a.scope,f.customer,{case_id:'case_one',channel:'webchat',account_id:'widget',external_id:'browser_one',history:'complete',source_revision:2});
  const next=readMemory(f,{link_id:f.web.id});assertEmpty(next,'missing');assert.notEqual(next.context_digest,first.context_digest);
  assert.deepEqual(next.history,{status:'complete',source_revision:2,missing_history_is_explicit:true});assert.equal(memoryRows(f.db).length,0);
  f.memory.record(f.customer,recordInput(f));
  f.conversations.link(f.a.scope,f.customer,{case_id:'case_one',channel:'email',account_id:'merchant_mail',external_id:'thread_one',history:'complete',source_revision:2});
  assertEmpty(readMemory(f,{link_id:f.web.id}),'source_changed');assertRedacted(caseRows(f.db)[0],'source_changed');
}));

test('M18-G01-RETAINED-INTEGRITY-AND-RESTORE-PREFLIGHT',()=>usingMemory(f=>{
  f.memory.record(f.customer,recordInput(f));f.create('case_two');const original=caseRows(f.db)[0],body=JSON.parse(original.body);
  const backup=snapshot(f),transfer=merchant(f);
  const patches:Value[]=[{body:'{'},{digest:'0'.repeat(64)},{author:'operator'},{reviewer:'reviewer'},{review_digest:'a'.repeat(64)},
    {expires_at:original.expires_at+1},{created_at:-1}];
  for(const changed of [{...body,transcript:'UNPERMITTED_TRANSCRIPT'},{...body,case_id:'case_two'},{...body,resource_id:'unrelated_resource'},
    {...body,subject_ref:'0'.repeat(64)},{...body,source:{...body.source,customer_resource_id:'unrelated_customer'}}])patches.push({body:canonical(changed),digest:contentDigest(changed)});
  for(const patch of patches){
    replaceRow(f.db,{...original,...patch});const before=memoryRows(f.db);
    assert.throws(()=>readMemory(f));assert.throws(()=>f.memory.record(f.customer,recordInput(f,{expected_version:1,request_id:'after_tamper'})));
    assert.deepEqual(memoryRows(f.db),before,'failed validation cannot partially redact or append');replaceRow(f.db,original);
  }
  new PrivacyLifecycle(f.kernel).erase(f.owner.scope,'C-1001');
  const tamper=(row:Value)=>{const changed={...JSON.parse(row.body),transcript:'MUST_NOT_HIDE_BEHIND_SUBJECT_ERASURE'};return {...row,body:canonical(changed),digest:contentDigest(changed)};};
  const badBackup=changedRecovery(backup,db=>replaceRow(db,tamper(caseRows(db)[0]))),input=restoreInput(f,badBackup,'malformed_memory_restore');
  assert.throws(()=>restoreRecoverySnapshot(input,f.now));noRestoreResidue(f,input);
  const badTransfer=changedMerchant(transfer,x=>{const rows=x.rows.commerce_support_documents,i=rows.findIndex((r:Value)=>r.kind==='shopper_memory');rows[i]=tamper(rows[i]);}),t=target(f);
  try{assert.throws(()=>imported(f,t,badTransfer));assert.equal(count(t.db,'commerce_resources'),0);assert.equal(memoryRows(t.db).length,0);assert.equal(count(t.db,'commerce_recovery_state'),0);}finally{t.close();}
}));

test('M18-G01-CORRECTION-SCRUBS-ALL-VERSIONS',()=>usingMemory(f=>{
  f.memory.record(f.customer,recordInput(f));const old=caseRows(f.db)[0],oldProvenance=readMemory(f).provenance.source_digest;
  f.memory.record(f.customer,recordInput(f,{expected_version:1,request_id:'correction_two',preferences:{fit_preference:'close'}}));
  f.memory.record(f.customer,recordInput(f,{expected_version:2,request_id:'correction_three',preferences:{response_style:'detailed'}}));
  const rows=caseRows(f.db);assert.deepEqual(rows.map(r=>r.version),[1,2,3]);assert.equal(new Set(rows.map(r=>r.id)).size,1);
  for(const row of rows.slice(0,2)){assertRedacted(row,'corrected');assert.equal(row.body.includes(old.digest),false);assert.equal(row.body.includes(oldProvenance),false);}
  assert.deepEqual(readMemory(f,{link_id:f.web.id}).preferences,{response_style:'detailed'});
  assert.deepEqual(JSON.parse(rows[2].body).preferences,{response_style:'detailed'});assert.equal(rows[2].state,'active');
  assert.equal(new Set(rows.map(r=>JSON.parse(r.body).request_hash)).size,3);
}));

test('M18-G01-VERSION-CONFLICT-AND-REQUEST-REPLAY',()=>usingMemory(f=>{
  f.memory.record(f.customer,recordInput(f));
  f.memory.record(f.customer,recordInput(f,{expected_version:1,request_id:'next_statement',preferences:{fit_preference:'close'}}));
  let before=caseRows(f.db);
  assert.throws(()=>f.memory.record(f.customer,recordInput(f,{expected_version:1,request_id:'stale_version'})));
  assert.throws(()=>f.memory.record(f.customer,recordInput(f,{expected_version:2,request_id:'memory_request_one'})));
  assert.throws(()=>f.memory.record(f.customer,recordInput(f,{expected_version:2,request_id:'next_statement'})));
  assert.throws(()=>f.memory.forget(f.customer,forgetInput(f,{expected_version:1})));
  assert.deepEqual(caseRows(f.db),before);assert.deepEqual(readMemory(f).preferences,{fit_preference:'close'});
  f.memory.forget(f.customer,forgetInput(f,{expected_version:2}));before=caseRows(f.db);
  for(const request_id of ['memory_request_one','next_statement','forget_request_one'])
    assert.throws(()=>f.memory.record(f.customer,recordInput(f,{expected_version:3,request_id})));
  assert.deepEqual(caseRows(f.db),before);assertEmpty(readMemory(f),'forgotten');
  f.memory.record(f.customer,recordInput(f,{expected_version:3,request_id:'new_explicit_request',preferences:{fit_preference:'relaxed'}}));
  assert.equal(readMemory(f).version,4);assert.deepEqual(readMemory(f).preferences,{fit_preference:'relaxed'});
}));

test('M18-G01-EXPIRY-NEVER-FALLS-BACK',()=>usingMemory(f=>{
  f.memory.record(f.customer,recordInput(f,{expires_at:f.now()+10000}));
  f.memory.record(f.customer,recordInput(f,{expected_version:1,request_id:'short_lived_correction',preferences:{fit_preference:'close'},expires_at:f.now()+50}));
  f.advance(50);
  for(const link of [f.link,f.web]){const context=readMemory(f,{link_id:link.id});assertEmpty(context,'expired');assert.equal(context.version,2);}
  const rows=caseRows(f.db);assertRedacted(rows[0],'corrected');assertRedacted(rows[1],'expired');
  assert.equal(rows.length,2);assert.equal(readMemory(f).retained_under_hold,false);
}));

test('M18-G01-SUBJECT-EXPORT-ALLOWLIST',()=>usingMemory(f=>{
  f.memory.record(f.customer,recordInput(f));
  f.memory.record(f.customer,recordInput(f,{expected_version:1,request_id:'export_correction',preferences:{fit_preference:'close'}}));
  const other=secondSubject(f);f.memory.record(other.scope,other.input);
  f.conversations.ingest(f.a.scope,{link_id:f.link.id,external_id:'export_staff_note',direction:'internal',visibility:'staff',text:'MEMORY_PRIVATE_TRANSCRIPT_SENTINEL',source_at:f.now()});
  const privacy=new PrivacyLifecycle(f.kernel),exported:any=privacy.export(f.owner.scope,'C-1001'),records=exported.shopper_memory_records;
  assert.ok(Array.isArray(records));const active=records.find((r:Value)=>r.version===2);assert.ok(active);
  assert.equal(active.case_id,'case_one');assert.equal(active.resource_id,f.order().id);assert.equal(active.purpose,PURPOSE);
  assert.equal(active.state,'active');assert.deepEqual(active.preferences,{fit_preference:'close'});assert.equal(active.subject_projection,true);assert.equal(active.retained_under_hold,false);
  const text=JSON.stringify(records);
  for(const forbidden of [f.customerBearer,f.kernel.require(f.customer).token_hash,f.kernel.require(f.a.scope).token_hash,'memory_request_one','export_correction','other_customer_request',other.order.id,'case_other','MEMORY_PRIVATE_TRANSCRIPT_SENTINEL','provider_thread_id','"response_style":"detailed"'])assert.equal(text.includes(forbidden),false,forbidden);
  assert.equal(exported.credentials_included,false);assert.throws(()=>privacy.export(f.b.scope,'C-1001'));
  const row=caseRows(f.db)[0];replaceRow(f.db,{...row,digest:'f'.repeat(64)});
  assert.throws(()=>privacy.export(f.owner.scope,'C-1001'),'export validates historical versions rather than silently omitting malformed records');
}));

test('M18-G01-ALL-VERSION-ERASURE-PRESERVES-OTHERS',()=>usingMemory(f=>{
  f.memory.record(f.customer,recordInput(f));
  f.memory.record(f.customer,recordInput(f,{expected_version:1,request_id:'erasure_correction',preferences:{fit_preference:'close'}}));
  const other=secondSubject(f);f.memory.record(other.scope,other.input);const anotherStore=secondStore(f);
  const otherBefore=caseRows(f.db,'case_other'),storeBefore=memoryRows(f.db,anotherStore.store),otherOrder=f.kernel.get(f.a.scope,other.order.id);
  assert.equal(new PrivacyLifecycle(f.kernel).erase(f.owner.scope,'C-1001').status,'logically_erased');
  for(const row of caseRows(f.db))assertRedacted(row);
  assertRedacted(caseRows(f.db).at(-1)!,'subject_erased');
  assert.deepEqual(caseRows(f.db,'case_other'),otherBefore);assert.deepEqual(memoryRows(f.db,anotherStore.store),storeBefore);
  assert.deepEqual(f.kernel.get(f.a.scope,other.order.id),otherOrder);
  assert.deepEqual(f.memory.context(other.scope,other.scope,contextInput(f,{case_id:'case_other',link_id:other.link.id})).preferences,{response_style:'detailed'});
  assert.throws(()=>readMemory(f));assert.throws(()=>f.memory.record(f.customer,recordInput(f,{expected_version:2,request_id:'after_subject_erasure'})));
}));

test('M18-G01-HOLD-RETENTION-AND-RELEASE-CLEANUP',()=>usingMemory(f=>{
  const privacy=new PrivacyLifecycle(f.kernel);f.memory.record(f.customer,recordInput(f));
  privacy.hold(f.owner.scope,{customer_id:'C-1001',reason:'retention_obligation',authority_ref:'memory_hold',expires_at:f.now()+10000});
  f.memory.record(f.customer,recordInput(f,{expected_version:1,request_id:'held_correction',preferences:{fit_preference:'close'}}));
  assert.deepEqual(readMemory(f).preferences,{fit_preference:'close'});assert.equal(readMemory(f).retained_under_hold,true);
  f.memory.forget(f.customer,forgetInput(f,{expected_version:2}));assertEmpty(readMemory(f),'forgotten');assert.equal(readMemory(f).retained_under_hold,true);
  let rows=caseRows(f.db);assert.deepEqual(rows.map(r=>r.version),[1,2,3]);
  assert.deepEqual(rows.slice(0,2).map(r=>JSON.parse(r.body).preferences),[{fit_preference:'regular',response_style:'concise'},{fit_preference:'close'}]);
  assert.ok(rows.every(r=>r.state==='revoked'));assertRedacted(rows[2],'forgotten');
  const exported:any=privacy.export(f.owner.scope,'C-1001');
  for(const version of [1,2]){const r=exported.shopper_memory_records.find((x:Value)=>x.version===version);assert.ok(r);assert.equal(r.state,'revoked');assert.equal(r.retained_under_hold,true);assert.ok(Object.keys(r.preferences).length>0);}
  assert.equal(privacy.erase(f.owner.scope,'C-1001').status,'held');assert.deepEqual(caseRows(f.db),rows);
  privacy.releaseHold(f.owner.scope,'C-1001','memory_hold');
  const after=readMemory(f,{link_id:f.web.id});assertEmpty(after,'forgotten');assert.equal(after.retained_under_hold,false);
  rows=caseRows(f.db);assert.equal(rows.length,3);for(const row of rows)assertRedacted(row);
}));

test('M18-G01-UNINSTALL-INVALIDATES-AND-RETAINS-HOLDS',()=>usingMemory(f=>{
  f.memory.record(f.customer,recordInput(f));const other=secondSubject(f);f.memory.record(other.scope,other.input);
  const anotherStore=secondStore(f),before=memoryRows(f.db,anotherStore.store),privacy=new PrivacyLifecycle(f.kernel);
  privacy.hold(f.owner.scope,{customer_id:'C-1001',reason:'dispute',authority_ref:'uninstall_hold',expires_at:f.now()+10000});
  assert.equal(privacy.uninstall(f.owner.scope).status,'disconnected');
  const held=caseRows(f.db)[0];assert.equal(held.state,'revoked');assert.deepEqual(JSON.parse(held.body).preferences,{fit_preference:'regular',response_style:'concise'});
  for(const row of caseRows(f.db,'case_other'))assertRedacted(row);
  assert.deepEqual(memoryRows(f.db,anotherStore.store),before);assert.throws(()=>readMemory(f));assert.throws(()=>f.kernel.require(f.customer));
  assert.equal((f.db.prepare('SELECT active FROM commerce_stores WHERE tenant_id=? AND store_id=?').get(f.a.tenant,f.a.store) as Value).active,0);
}));

test('M18-G01-NATIVE-RESTORE-CANNOT-RESURRECT-FORGET',()=>usingMemory(f=>{
  f.memory.record(f.customer,recordInput(f));const p=f.preview(),a=f.approve(p);f.execute(p,a,f.a.scope);
  const operationIds=f.db.prepare('SELECT id FROM commerce_operations ORDER BY id').all(),receiptIds=f.db.prepare('SELECT id FROM commerce_operation_receipts ORDER BY id').all();
  assert.equal(operationIds.length,1);assert.ok(receiptIds.length>0);const backup=snapshot(f);
  f.memory.forget(f.customer,forgetInput(f));assertEmpty(readMemory(f),'forgotten');
  restored(f,backup,({db,kernel,result})=>{
    const rows=caseRows(db);assert.equal(rows.length,1);assertRedacted(rows[0],'restored');
    assert.deepEqual(db.prepare('SELECT id FROM commerce_operations ORDER BY id').all(),operationIds);
    assert.deepEqual(db.prepare('SELECT id FROM commerce_operation_receipts ORDER BY id').all(),receiptIds);
    assert.equal(result.mode,'quarantine');assert.equal(result.external_effects,false);
    assert.equal((db.prepare('SELECT count(*) n FROM commerce_action_approvals WHERE revoked=0').get() as Value).n,0);
    assert.throws(()=>kernel.authenticate(f.customerBearer));assert.throws(()=>kernel.authenticate(f.a.bearer));
  });
}));

test('M18-G01-NATIVE-RESTORE-REPLAYS-SUBJECT-ERASURE',()=>usingMemory(f=>{
  f.memory.record(f.customer,recordInput(f));const privacy=new PrivacyLifecycle(f.kernel),order=f.order();
  privacy.hold(f.owner.scope,{customer_id:'C-1001',reason:'retention_obligation',authority_ref:'copied_subject_hold',expires_at:f.now()+10000});
  const backup=snapshot(f);privacy.releaseHold(f.owner.scope,'C-1001','copied_subject_hold');f.advance(1);
  assert.equal(privacy.erase(f.owner.scope,'C-1001').status,'logically_erased');
  restored(f,backup,({db,kernel})=>{
    for(const row of caseRows(db))assertRedacted(row);
    assert.equal((db.prepare('SELECT payload FROM commerce_resources WHERE id=?').get(order.id) as Value).payload,'{"redacted":true}');
    assert.equal((db.prepare('SELECT released FROM commerce_privacy_holds').get() as Value).released,0,'current source erasure supersedes the obsolete copied hold');
    assert.equal((db.prepare('SELECT mode FROM commerce_recovery_state').get() as Value).mode,'quarantine');
    assert.throws(()=>kernel.authenticate(f.customerBearer));assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  });
}));

test('M18-G01-NATIVE-HELD-RESTORE-IS-ATOMIC',()=>usingMemory(f=>{
  f.memory.record(f.customer,recordInput(f));const privacy=new PrivacyLifecycle(f.kernel);
  privacy.hold(f.owner.scope,{customer_id:'C-1001',reason:'investigation',authority_ref:'retained_memory_hold',expires_at:f.now()+10000});
  f.memory.record(f.customer,recordInput(f,{expected_version:1,request_id:'held_second_version',preferences:{fit_preference:'close'}}));
  const before=caseRows(f.db),backup=snapshot(f),input=restoreInput(f,backup,'held_memory_restore');
  assert.throws(()=>restoreRecoverySnapshot(input,f.now),/HELD/);noRestoreResidue(f,input);
  assert.deepEqual(caseRows(f.db),before);assert.equal(count(f.db,'commerce_recovery_state'),0);
  assert.deepEqual(readMemory(f).preferences,{fit_preference:'close'});
}));

test('M18-G01-MERCHANT-IMPORT-AND-REIMPORT-INVALIDATE',()=>usingMemory(f=>{
  f.memory.record(f.customer,recordInput(f));const original=caseRows(f.db)[0],transfer=merchant(f),t=target(f);
  f.memory.forget(f.customer,forgetInput(f));
  try{
    const first=imported(f,t,transfer);assert.equal(first.mode,'quarantine');assert.equal(first.live_activation_supported,false);
    assertRedacted(caseRows(t.db)[0],'restored');assert.throws(()=>t.kernel.authenticate(f.customerBearer));
    // Explicit stale-row replay fault: the same package must also invalidate
    // personal memory present in a destination that was imported previously.
    replaceRow(t.db,original);assert.deepEqual(JSON.parse(caseRows(t.db)[0].body).preferences,{fit_preference:'regular',response_style:'concise'});
    assert.deepEqual(imported(f,t,transfer),first);assertRedacted(caseRows(t.db)[0],'restored');
    const privacy=new PrivacyLifecycle(t.kernel);privacy.hold(t.scope,{customer_id:'C-1001',reason:'dispute',authority_ref:'destination_memory_hold',expires_at:f.now()+10000});
    replaceRow(t.db,original);const before=caseRows(t.db),state=t.db.prepare('SELECT * FROM commerce_recovery_state').all();
    assert.throws(()=>imported(f,t,transfer),/HELD/);assert.deepEqual(caseRows(t.db),before);assert.deepEqual(t.db.prepare('SELECT * FROM commerce_recovery_state').all(),state);
    privacy.releaseHold(t.scope,'C-1001','destination_memory_hold');imported(f,t,transfer);assertRedacted(caseRows(t.db)[0],'restored');
    assert.equal((t.db.prepare("SELECT count(*) n FROM commerce_support_documents WHERE kind='merchant_import'").get() as Value).n,1);
  }finally{t.close();}
}));

test('M18-G01-MERCHANT-HELD-ATOMICITY-AND-ERASURE',()=>usingMemory(f=>{
  f.memory.record(f.customer,recordInput(f));const privacy=new PrivacyLifecycle(f.kernel),order=f.order();
  privacy.hold(f.owner.scope,{customer_id:'C-1001',reason:'retention_obligation',authority_ref:'source_memory_hold',expires_at:f.now()+10000});
  const transfer=merchant(f),t=target(f);
  try{
    assert.throws(()=>imported(f,t,transfer),/HELD/);
    assert.equal(count(t.db,'commerce_resources'),0);assert.equal(count(t.db,'commerce_support_documents'),0);assert.equal(count(t.db,'commerce_recovery_state'),0);
    privacy.releaseHold(f.owner.scope,'C-1001','source_memory_hold');f.advance(1);assert.equal(privacy.erase(f.owner.scope,'C-1001').status,'logically_erased');
    const result=imported(f,t,transfer);assert.equal(result.mode,'quarantine');for(const row of caseRows(t.db))assertRedacted(row);
    assert.equal((t.db.prepare('SELECT payload FROM commerce_resources WHERE id=?').get(order.id) as Value).payload,'{"redacted":true}');
    assert.equal((t.db.prepare('SELECT released FROM commerce_privacy_holds').get() as Value).released,0);
    const before=caseRows(t.db);imported(f,t,transfer);assert.deepEqual(caseRows(t.db),before);assert.deepEqual(t.db.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{t.close();}
}));

test('M18-G01-MANUAL-DISPATCH-AND-OWNERSHIP-HANDOVER',()=>usingMemory(async f=>{
  const service=new SupportService(f.kernel,f.reads);assert.equal(service.runner,null);assert.equal(service.routing,null);
  await service.post(f.customer,'memory-record',recordInput(f));
  const get=(scope:any,generation:number)=>service.post(scope,'memory-context',{customer_token:f.customerBearer,context:contextInput(f,{link_id:f.web.id,expected_generation:generation})}) as Promise<Value>;
  const initial=await get(f.a.scope,1);assert.deepEqual(initial.preferences,{fit_preference:'regular',response_style:'concise'});assert.equal(initial.model_thread_required,false);
  const assigned=f.ownership.assign(f.owner.scope,{case_id:'case_one',expected_generation:1,actor_id:'agent'});assert.equal(assigned.generation,2);
  const builtIn=await get(f.agent.scope,2);assert.deepEqual(builtIn.preferences,initial.preferences);assert.notEqual(builtIn.context_digest,initial.context_digest);
  await assert.rejects(()=>get(f.a.scope,2));await assert.rejects(()=>get(f.agent.scope,1));
  const takeover=f.ownership.takeover(f.a.scope,{case_id:'case_one',expected_generation:2,reason:'provider_unavailable'});assert.equal(takeover.generation,3);
  await assert.rejects(()=>get(f.agent.scope,3));await assert.rejects(()=>service.post(f.customer,'memory-record',recordInput(f,{expected_version:1,expected_generation:2,request_id:'late_caller'})));
  await service.post(f.customer,'memory-record',recordInput(f,{expected_version:1,expected_generation:3,request_id:'current_manual_request',preferences:{fit_preference:'close'}}));
  assert.deepEqual((await get(f.a.scope,3)).preferences,{fit_preference:'close'});
  await assert.rejects(()=>service.post(f.a.scope,'memory-context',{customer_token:f.customerBearer,context:contextInput(f,{expected_generation:3}),provider_thread_id:'not_a_requirement'}));
  await assert.rejects(()=>service.post(f.a.scope,'model-read',{case_id:'case_one',task_id:'unused',route_id:'unused',untrusted_input:'unused'}),/MODEL_ROUTE_UNCONFIGURED/);
  await service.post(f.customer,'memory-forget',forgetInput(f,{expected_version:2,expected_generation:3}));assertEmpty(await get(f.a.scope,3),'forgotten');
  assert.equal(f.source.calls,0);assert.equal(count(f.db,'commerce_operations'),0);assert.equal(count(f.db,'commerce_model_reservations'),0);
  assert.equal(JSON.stringify(caseRows(f.db)).includes(f.customerBearer),false);
}));
