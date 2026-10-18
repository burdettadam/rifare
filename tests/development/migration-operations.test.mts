import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {renameSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {CommerceKernel} from '../../packages/commerce/kernel.mts';
import {MigrationCutover} from '../../packages/commerce/migration-cutover.mts';
import {exportMerchant,importMerchant,exportMerchantSuppression,merchantSnapshotDigest} from '../../packages/commerce/merchant-portability.mts';
import {usingExecution} from './execution-helpers.mts';
import {usingReturns} from './return-intake-helpers.mts';
import {usingSupport} from './support-helpers.mts';
import {NativeReturns} from '../../packages/commerce/native-returns.mts';
import {ShopifyReturnFixtureAdapter,CREATE_RETURN} from '../../packages/adapters/shopify-return-fixture.mts';
import {SupportConsent} from '../../packages/commerce/support-consent.mts';
import {PrivacyLifecycle} from '../../packages/commerce/privacy-lifecycle.mts';
import {ExecutionStops} from '../../packages/commerce/execution-stops.mts';
import {canonical,contentDigest} from '../../packages/commerce/configuration-values.mts';
import {withMigrationWriter,withMigrationReconciliation} from '../../packages/commerce/migration-fence.mts';
import {RUNBOOKS,validateRunbook} from '../../packages/commerce/operator-runbooks.mts';
import {usingMigrationFixture,runOperatorDrill,prepareSingleMerchantFixture} from '../../tools/operator-drill-fixtures.mts';

test('CASE-M07-G08-01',()=>usingMigrationFixture(async f=>{
 const before=f.coordinator.compare(f.old.kernel,f.old.scope,f.next.kernel,f.next.scope);
 assert.equal(before.matched,true);assert.equal(before.source_ids,7);assert.equal(before.case_ids,1);
 assert.throws(()=>f.old.kernel.attach(f.old.scope,f.resource,{ordinary:true}),/MIGRATION_WRITE_CONTEXT_REQUIRED/);
 await withMigrationWriter(f.old.kernel,f.old.scope,()=>f.old.kernel.attach(f.old.scope,f.resource,{writer:'old'}));
 await assert.rejects(()=>withMigrationWriter(f.next.kernel,f.next.scope,()=>f.next.kernel.attach(f.next.scope,f.resource,{writer:'next'})),/MIGRATION_NOT_WRITER/);
 const switched=f.coordinator.cutover(f.old.kernel,f.old.scope,f.next.kernel,f.next.scope,{expected_epoch:1,expected_history_digest:before.digest});
 assert.equal(switched.owner,'next');assert.equal(switched.epoch,2);
 await withMigrationWriter(f.next.kernel,f.next.scope,()=>f.next.kernel.attach(f.next.scope,f.resource,{writer:'next'}));
 await assert.rejects(()=>withMigrationWriter(f.old.kernel,f.old.scope,()=>f.old.kernel.attach(f.old.scope,f.resource,{writer:'old-again'})),/MIGRATION_NOT_WRITER/);
 assert.equal(f.old.db.prepare('SELECT count(*) n FROM commerce_attachments').get()!.n,1);
 assert.equal(f.next.db.prepare('SELECT count(*) n FROM commerce_attachments').get()!.n,1);
}));

test('CASE-M07-G08-02',async()=>{
 await usingExecution(f=>{
  const coordinator=MigrationCutover.create(join(f.directory,'rejected-coordinator.sqlite'),{coordinator_id:'multi_store_rejected',tenant_id:f.a.tenant,store_id:f.a.store});
  assert.throws(()=>coordinator.bind(f.kernel,f.owner.scope,'old',{initial_owner:true}),/MIGRATION_SINGLE_MERCHANT_REQUIRED/);
  assert.equal(f.db.prepare("SELECT count(*) n FROM commerce_support_documents WHERE kind='migration_binding'").get()!.n,0);
  assert.deepEqual(coordinator.inspect().installations,[]);
  assert.equal(f.seed(f.b.scope,'beta','UNRELATED-STORE-STILL-WRITABLE').source_version,1);
 });
 return usingMigrationFixture(async f=>{
 const compared=f.coordinator.compare(f.old.kernel,f.old.scope,f.next.kernel,f.next.scope);
 assert.throws(()=>f.coordinator.bind(f.next.kernel,f.next.scope,'old'),/MIGRATION_ALREADY_BOUND/);
 await withMigrationWriter(f.old.kernel,f.old.scope,()=>f.old.kernel.ingest(f.old.scope,{...f.input,source_version:f.input.source_version+1,payload:{...f.input.payload,status:'changed'}}));
 assert.throws(()=>f.coordinator.cutover(f.old.kernel,f.old.scope,f.next.kernel,f.next.scope,{expected_epoch:1,expected_history_digest:compared.digest}),/MIGRATION_HISTORY_CONFLICT/);
 assert.equal(f.coordinator.inspect().owner,'old');
 });
});

test('CASE-M07-G08-03',async()=>{
 const r=await runOperatorDrill('migration-pending');
 assert.equal(r.outcome,'paused_pending_reconciliation');assert.equal(r.effects.gateway_refunds,1);
 assert.equal(r.effects.gateway_movements,0);assert.equal(r.effects.customer_messages,1);
 assert.equal(r.rollback.owner,null);assert.equal(r.rollback.replayed_operations,0);
 assert.equal(r.receipts_preserved,true);assert.equal(r.original_operations_preserved,true);
});

test('M07-G08-PORT-022',async()=>{
 const r=await runOperatorDrill('migration-overlap');
 assert.equal(r.designated_writer,'old');assert.equal(r.rejected_writers,1);
 assert.deepEqual(r.effects,{gateway_refunds:1,gateway_movements:1,customer_messages:1});
 assert.equal(r.receipts_preserved,true);assert.equal(r.live_effects,false);
});

test('M07-G08-COORDINATOR-LOSS-AND-RESTART-FAIL-CLOSED',()=>usingMigrationFixture(async f=>{
 const renamed=f.coordinator.path+'.offline';renameSync(f.coordinator.path,renamed);
 const db=new DatabaseSync(f.old.filename);
 try{const k=new CommerceKernel(db,f.now),scope=k.authenticate(f.old.bearer);
  await assert.rejects(()=>withMigrationWriter(k,scope,()=>k.attach(scope,f.resource,{unsafe:true})),/MIGRATION_COORDINATOR_UNAVAILABLE/);
  assert.throws(()=>k.attach(scope,f.resource,{unsafe:true}),/MIGRATION_COORDINATOR_UNAVAILABLE/);
 }finally{db.close();renameSync(renamed,f.coordinator.path);}
 assert.equal(f.old.db.prepare('SELECT count(*) n FROM commerce_attachments').get()!.n,0);
 const interrupted=new DatabaseSync(f.coordinator.path);
 try{interrupted.prepare("INSERT INTO migration_executions VALUES('abandoned_execution','old',1,'write',?,'started',NULL)").run(f.now());}finally{interrupted.close();}
 const reopened=new DatabaseSync(f.old.filename);
 try{const k=new CommerceKernel(reopened,f.now),scope=k.authenticate(f.old.bearer);
  await assert.rejects(()=>withMigrationWriter(k,scope,()=>k.attach(scope,f.resource,{})),/MIGRATION_EXECUTION_UNRESOLVED/);
 }finally{reopened.close();}
}));

test('M07-G08-BINDING-CANNOT-BE-REMOVED-OR-COPIED',()=>usingMigrationFixture(f=>{
 assert.throws(()=>f.old.db.exec("DELETE FROM commerce_support_documents WHERE kind='migration_binding'"),/MIGRATION_BINDING_IMMUTABLE/);
 const binding=f.old.db.prepare("SELECT body FROM commerce_support_documents WHERE kind='migration_binding'").get()!;
 assert.match(String(binding.body),/coordinator_id/);
 const copied=join(f.old.filename+'-copied.sqlite');f.old.db.prepare('VACUUM INTO ?').run(copied);
 const copyDB=new DatabaseSync(copied);
 try{const k=new CommerceKernel(copyDB,f.now),scope=k.authenticate(f.old.bearer);assert.throws(()=>k.attach(scope,f.resource,{}),/MIGRATION_DATABASE_CHANGED/);}finally{copyDB.close();}
 f.old.db.exec('DROP TRIGGER commerce_migration_binding_no_delete');
 f.old.db.exec("DELETE FROM commerce_support_documents WHERE kind='migration_binding'");
 const db=new DatabaseSync(f.old.filename);
 try{const k=new CommerceKernel(db,f.now),scope=k.authenticate(f.old.bearer);assert.throws(()=>k.attach(scope,f.resource,{}),/MIGRATION_BINDING_INVALID/);}finally{db.close();}
}));

test('M07-G08-CUTOVER-CANNOT-RACE-INFLIGHT-WRITE',()=>usingMigrationFixture(async f=>{
 let release!:()=>void;const paused=new Promise<void>(resolve=>release=resolve);
 const pending=withMigrationWriter(f.old.kernel,f.old.scope,async()=>{await paused;return f.old.kernel.attach(f.old.scope,f.resource,{completed:true});});
 const before=f.coordinator.compare(f.old.kernel,f.old.scope,f.next.kernel,f.next.scope);
 assert.throws(()=>f.coordinator.cutover(f.old.kernel,f.old.scope,f.next.kernel,f.next.scope,{expected_epoch:1,expected_history_digest:before.digest}),/MIGRATION_COORDINATOR_BUSY/);
 release();await pending;assert.equal(f.coordinator.inspect().owner,'old');
}));

test('M07-G08-STALE-EPOCH-AND-RECONCILE-CONTEXT-CANNOT-WRITE',()=>usingMigrationFixture(async f=>{
 const before=f.coordinator.compare(f.old.kernel,f.old.scope,f.next.kernel,f.next.scope);
 assert.throws(()=>f.coordinator.cutover(f.old.kernel,f.old.scope,f.next.kernel,f.next.scope,{expected_epoch:0,expected_history_digest:before.digest}),/MIGRATION_EPOCH_CHANGED/);
 await assert.rejects(()=>withMigrationReconciliation(f.next.kernel,f.next.scope,()=>f.next.kernel.attach(f.next.scope,f.resource,{})),/MIGRATION_RECONCILE_ONLY/);
}));

test('M07-G08-RETURN-AND-CURRENT-AUTHORITY-FAIL-CLOSED',async()=>{
 async function mirror(f:any,label:string,run:(m:any)=>Promise<void>){
  const path=join(f.directory,label+'-mirror.sqlite');f.db.prepare('VACUUM INTO ?').run(path);const db=new DatabaseSync(path);
  try{const next=new CommerceKernel(db,f.now),owner=next.authenticate(f.owner.bearer),operator=next.authenticate(f.a.bearer),customer=next.authenticate(f.customerBearer);
   const coordinator=MigrationCutover.create(join(f.directory,label+'-coordinator.sqlite'),{coordinator_id:label,tenant_id:f.a.tenant,store_id:f.a.store});
   coordinator.bind(f.kernel,f.owner.scope,'old',{initial_owner:true});coordinator.bind(next,owner,'next');
   const compare=()=>coordinator.compare(f.kernel,f.owner.scope,next,owner);
   const blocked=()=>{const review=compare();assert.equal(review.matched,false);assert.equal(review.comparison_mode,'exact_writable_authority');
    assert.throws(()=>coordinator.cutover(f.kernel,f.owner.scope,next,owner,{expected_epoch:1,expected_history_digest:review.digest}),/MIGRATION_HISTORY_CONFLICT/);
    assert.equal(coordinator.inspect().owner,'old');return review;};
   assert.equal(compare().matched,true);await run({db,next,owner,operator,customer,coordinator,compare,blocked});
  }finally{db.close();}
 }
 await usingReturns(async f=>{
  prepareSingleMerchantFixture(f);
  const photo=JSON.parse(readFileSync(new URL('../fixtures/return-intake/photo.v1.json',import.meta.url),'utf8')).base64;
  const evidence=f.evidence.upload(f.customer,{case_id:'case_one',mime:'image/png',base64:photo,note:'Migration evidence'});await f.evidence.scan(f.reviewer.scope,evidence.id);
  const request=f.prepare(f.quote({evidence_ids:[evidence.id]}));f.submit(request);
  await mirror(f,'native_history',async m=>{
   // Independent, deliberately non-idempotent fixture ledger: each create gets
   // another native ID. A missing history row must stop ownership transfer.
   const records=new Map<string,any>();
   const adapter=new ShopifyReturnFixtureAdapter({mode:'fixture',identity:'migration-native-source',tenant:f.a.tenant,store:f.a.store,transport:async({query,variables})=>{
    assert.equal(query,CREATE_RETURN);const input=variables.returnInput;
    const record={id:'gid://shopify/Return/'+(501+records.size),status:'OPEN',order:{id:input.orderId},
     returnLineItems:{nodes:input.returnLineItems.map((line:any,i:number)=>({id:'gid://shopify/ReturnLineItem/'+(601+i),quantity:line.quantity,returnReasonNote:line.returnReasonNote,fulfillmentLineItem:{id:line.fulfillmentLineItemId}})),pageInfo:{hasNextPage:false}},
     reverseFulfillmentOrders:{nodes:[{id:'gid://shopify/ReverseFulfillmentOrder/701'}],pageInfo:{hasNextPage:false}}};
    records.set(record.id,record);return {status:200,api_version:'2026-10',body:{data:{returnCreate:{return:record,userErrors:[]}}}};
   }});
   const original=await withMigrationWriter(f.kernel,f.a.scope,()=>new NativeReturns(f.kernel,adapter).create(f.a.scope,request.id));
   assert.equal(original.state,'created');assert.equal(records.size,1);
   assert.equal(f.db.prepare('SELECT state FROM commerce_return_requests WHERE id=?').get(request.id)!.state,'native_created');
   assert.equal(m.db.prepare('SELECT state FROM commerce_return_requests WHERE id=?').get(request.id).state,'submitted');m.blocked();
   await assert.rejects(()=>withMigrationWriter(m.next,m.operator,()=>new NativeReturns(m.next,adapter).create(m.operator,request.id)),/MIGRATION_NOT_WRITER/);
   assert.deepEqual([...records.keys()],['gid://shopify/Return/501']);
   const row=f.db.prepare('SELECT * FROM commerce_native_return_operations WHERE request_id=?').get(request.id)!;
   for(const field of ['request_digest','source_identity','native_id']){
    const changed=field==='request_digest'?'0'.repeat(64):field==='native_id'?'gid://shopify/Return/999':'different-source';
    try{f.db.prepare('UPDATE commerce_native_return_operations SET '+field+'=? WHERE id=?').run(changed,row.id);
     assert.throws(m.compare,/MIGRATION_NATIVE_RETURN_INTEGRITY/);
    }finally{f.db.prepare('UPDATE commerce_native_return_operations SET '+field+'=? WHERE id=?').run(row[field],row.id);}
   }
   const altered={...JSON.parse(String(row.native_body)),order_id:'gid://shopify/Order/999'};
   try{f.db.prepare('UPDATE commerce_native_return_operations SET native_body=? WHERE id=?').run(canonical(altered),row.id);assert.throws(m.compare,/MIGRATION_RECEIPT_INTEGRITY/);
    f.db.prepare('UPDATE commerce_native_return_operations SET native_digest=? WHERE id=?').run(contentDigest(altered),row.id);assert.throws(m.compare,/MIGRATION_NATIVE_RETURN_INTEGRITY/);
   }finally{f.db.prepare('UPDATE commerce_native_return_operations SET native_body=?,native_digest=? WHERE id=?').run(row.native_body,row.native_digest,row.id);}
   assert.equal(m.blocked().unresolved.length,0,'Completed-but-missing effects must conflict even without pending work');
  });
 });
 await usingSupport(async f=>{
  prepareSingleMerchantFixture(f);f.consent.record(f.customer,f.grant());
  await mirror(f,'current_authority',async m=>{
   const nextConsent=new SupportConsent(m.next),withdrawal=f.grant({state:'withdrawn',event_id:'withdrawal',source_version:2});
   assert.throws(()=>f.consent.record(f.customer,withdrawal),/MIGRATION_WRITE_CONTEXT_REQUIRED/);
   assert.throws(()=>nextConsent.record(m.customer,withdrawal),/MIGRATION_WRITE_CONTEXT_REQUIRED/);
   await assert.rejects(()=>withMigrationWriter(m.next,m.customer,()=>nextConsent.record(m.customer,withdrawal)),/MIGRATION_NOT_WRITER/);
   assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_support_consent_events').get()!.n,1);
   await withMigrationWriter(f.kernel,f.customer,()=>f.consent.record(f.customer,withdrawal));
   assert.equal(f.consent.eligibility(f.a.scope,'case_one','sender_one','email','marketing').allowed,false);
   assert.equal(nextConsent.eligibility(m.operator,'case_one','sender_one','email','marketing').allowed,true);let previous=m.blocked().old_digest;
   const privacy=new PrivacyLifecycle(f.kernel),customer=f.order().customer_id;
   assert.throws(()=>privacy.hold(f.owner.scope,{customer_id:customer,reason:'investigation',authority_ref:'migration-hold',expires_at:f.now()+1000}),/MIGRATION_WRITE_CONTEXT_REQUIRED/);
   await withMigrationWriter(f.kernel,f.owner.scope,()=>privacy.hold(f.owner.scope,{customer_id:customer,reason:'investigation',authority_ref:'migration-hold',expires_at:f.now()+1000}));
   assert.notEqual(m.blocked().old_digest,previous);previous=m.compare().old_digest;
   new ExecutionStops(f.kernel).setGlobal({stopped:true,reason:'incident',expected_revision:0});
   assert.notEqual(m.blocked().old_digest,previous);previous=m.compare().old_digest;
   assert.equal(m.db.prepare('SELECT count(*) n FROM commerce_execution_stops WHERE tenant_id IS NULL').get().n,0);
   await withMigrationWriter(f.kernel,f.owner.scope,()=>privacy.releaseHold(f.owner.scope,customer,'migration-hold'));
   await withMigrationWriter(f.kernel,f.owner.scope,()=>privacy.erase(f.owner.scope,customer));
   assert.notEqual(m.blocked().old_digest,previous);
   assert.equal(m.db.prepare('SELECT count(*) n FROM commerce_privacy_subjects').get().n,0);
   assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_privacy_subjects').get()!.n,1);
   assert.equal(f.sourceDb.prepare('SELECT count(*) n FROM support_source_effects').get()!.n,0);
  });
 });
});

test('M07-G08-MERCHANT-IMPORT-STAYS-QUARANTINED-AFTER-CUTOVER',()=>usingExecution(async f=>{
 prepareSingleMerchantFixture(f);
 const snapshot=exportMerchant(f.kernel,f.owner.scope,{snapshot_id:'migration_import'}),db=new DatabaseSync(join(f.directory,'merchant-target.sqlite'));
 try{const k=new CommerceKernel(db,f.now);k.provisionStore(f.a.tenant,f.a.store);k.provisionMember(f.a.tenant,f.a.store,'new_owner','owner');
  const scope=k.authenticate(k.issueSession(f.a.tenant,f.a.store,'new_owner'));
  const suppression=exportMerchantSuppression(f.kernel,f.owner.scope);
  const imported=importMerchant(k,scope,snapshot,snapshot.digest,{suppression,suppression_sha256:merchantSnapshotDigest(suppression)});assert.equal(imported.mode,'quarantine');
  const coordinator=MigrationCutover.create(join(f.directory,'import-coordinator.sqlite'),{coordinator_id:'import_cutover',tenant_id:f.a.tenant,store_id:f.a.store});
  coordinator.bind(f.kernel,f.owner.scope,'old',{initial_owner:true});coordinator.bind(k,scope,'next');
  const compared=coordinator.compare(f.kernel,f.owner.scope,k,scope);assert.equal(compared.matched,true);
  assert.equal(compared.comparison_mode,'quarantined_import_history_only');assert.equal(compared.live_activation_supported,false);
  const switched=coordinator.cutover(f.kernel,f.owner.scope,k,scope,{expected_epoch:1,expected_history_digest:compared.digest});
  assert.equal(switched.owner,'next');assert.equal(switched.imported_work_resumed,false);
  const reverse=coordinator.compare(k,scope,f.kernel,f.owner.scope);
  assert.throws(()=>coordinator.cutover(k,scope,f.kernel,f.owner.scope,{expected_epoch:2,expected_history_digest:reverse.digest}),/MIGRATION_IMPORT_CANNOT_ACTIVATE/);
  assert.equal(coordinator.inspect().owner,'next');
  await assert.rejects(()=>withMigrationWriter(k,scope,()=>k.attach(scope,f.order().id,{})),/RESTORE_WRITE_BLOCKED/);
  await assert.rejects(()=>withMigrationWriter(k,scope,()=>k.authorize(scope,'model.run')),/RESTORE_WRITE_BLOCKED|RESTORE_EGRESS_BLOCKED/);
  assert.throws(()=>k.authenticate(f.owner.bearer),/ACCESS_DENIED/);assert.equal(db.prepare('SELECT mode FROM commerce_recovery_state').get()!.mode,'quarantine');
  try{db.exec('UPDATE commerce_execution_settings SET enabled=1');assert.throws(()=>coordinator.compare(f.kernel,f.owner.scope,k,scope),/MIGRATION_IMPORT_PAUSE_CHANGED/);}
  finally{db.exec('UPDATE commerce_execution_settings SET enabled=0');}
  const receipt=db.prepare("SELECT digest FROM commerce_support_documents WHERE kind='merchant_import'").get()!;
  try{db.prepare("UPDATE commerce_support_documents SET digest=? WHERE kind='merchant_import'").run('0'.repeat(64));assert.throws(()=>coordinator.compare(f.kernel,f.owner.scope,k,scope),/MIGRATION_IMPORT_QUARANTINE_INVALID/);}
  finally{db.prepare("UPDATE commerce_support_documents SET digest=? WHERE kind='merchant_import'").run(receipt.digest);}
 }finally{db.close();}
}));

test('CASE-M07-G09-01',async()=>{
 const processResult=spawnSync(process.execPath,['--experimental-strip-types',fileURLToPath(new URL('../../tools/operator-drill.mts',import.meta.url)),'--run','ambiguous-refund'],{encoding:'utf8',timeout:15000});
 assert.equal(processResult.status,0,processResult.stderr);const r=JSON.parse(processResult.stdout);
 assert.equal(r.before,'unknown');assert.equal(r.after,'settled');assert.equal(r.command_repeated,false);
 assert.deepEqual(r.effects,{gateway_refunds:1,gateway_movements:1,customer_messages:0});
 assert.equal(r.trace.every((step:any)=>step.actual_method&&step.observed_state),true);
 assert.equal(r.qualification,'local_fixture_drill');assert.equal(r.independent_operator_observed,false);
});

test('CASE-M07-G09-02',()=>{
 for(const command of ['refund.retry','fulfillment.releaseAll','permission.bypass','sh -c arbitrary']){
  const bad=structuredClone(RUNBOOKS['ambiguous-refund']);bad.steps[1].command=command;
  assert.throws(()=>validateRunbook(bad),/RUNBOOK_UNSAFE_COMMAND/);
 }
});

test('CASE-M07-G09-03',()=>{
 const renamed=structuredClone(RUNBOOKS['ambiguous-refund']);renamed.steps[1].command='refund.reconcile.v2';
 assert.throws(()=>validateRunbook(renamed),/RUNBOOK_STALE_COMMAND/);
 const stale=structuredClone(RUNBOOKS['ambiguous-refund']);stale.steps[1].expects='settled';
 assert.throws(()=>validateRunbook(stale),/RUNBOOK_STALE_TRANSITION/);
});

test('M07-G09-LOST-WEBHOOK-RECOVERS-FROM-SOURCE-LEDGER',async()=>{
 const r=await runOperatorDrill('lost-webhook');assert.equal(r.before,'unknown');assert.equal(r.after,'succeeded');
 assert.equal(r.effects.source_records,1);assert.equal(r.effects.webhook_deliveries,0);assert.equal(r.command_repeated,false);
});

test('M07-G09-EXPIRED-TOKEN-REQUIRES-NEW-LOCAL-SESSION',async()=>{
 const r=await runOperatorDrill('expired-token');assert.equal(r.before,'ACCESS_DENIED');assert.equal(r.after,'succeeded');
 assert.equal(r.old_token_rejected,true);assert.equal(r.effects.provider_probes,1);assert.equal(JSON.stringify(r).includes('SYNTHETIC-KEY'),false);
});

test('M07-G09-STUCK-HOLD-KEEPS-FOREIGN-OWNER',async()=>{
 const r=await runOperatorDrill('stuck-hold');assert.equal(r.before,'EDIT_FOREIGN_HOLD');assert.equal(r.after,'released');
 assert.equal(r.foreign_hold_preserved_until_owner_clear,true);assert.equal(r.picking_before_owner_clear,false);
 assert.equal(r.hold_bypass_rejected,true);
});

test('M07-G09-PROVIDER-OUTAGE-DOES-NOT-GUESS-ABSENCE',async()=>{
 const r=await runOperatorDrill('provider-outage');assert.equal(r.before,'unknown');assert.equal(r.during_outage,'unknown');
 assert.equal(r.after,'succeeded');assert.equal(r.effects.source_records,1);assert.equal(r.command_repeated,false);
});

test('M07-G09-RESTORE-PRESERVES-OLD-OPERATION-BLOCK',async()=>{
 const r=await runOperatorDrill('restore');assert.equal(r.after,'quarantine');assert.equal(r.old_token_rejected,true);
 assert.equal(r.egress_enabled,false);assert.equal(r.old_operation_replay_blocked,true);assert.equal(r.effects.source_records,0);
});

test('M07-G09-AGENT-INCIDENT-REVOKES-OLD-LEASE',async()=>{
 const r=await runOperatorDrill('agent-incident');assert.equal(r.after,'human');assert.equal(r.old_lease_rejected,true);
 assert.equal(r.same_case_preserved,true);assert.equal(r.stale_generation_rejected,true);assert.equal(r.effects.customer_messages,0);
});
