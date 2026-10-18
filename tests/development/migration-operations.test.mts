import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {renameSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {CommerceKernel} from '../../packages/commerce/kernel.mts';
import {MigrationCutover} from '../../packages/commerce/migration-cutover.mts';
import {exportMerchant,importMerchant,exportMerchantSuppression,merchantSnapshotDigest} from '../../packages/commerce/merchant-portability.mts';
import {usingExecution} from './execution-helpers.mts';
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
  const switched=coordinator.cutover(f.kernel,f.owner.scope,k,scope,{expected_epoch:1,expected_history_digest:compared.digest});
  assert.equal(switched.owner,'next');assert.equal(switched.imported_work_resumed,false);
  await assert.rejects(()=>withMigrationWriter(k,scope,()=>k.attach(scope,f.order().id,{})),/RESTORE_WRITE_BLOCKED/);
  await assert.rejects(()=>withMigrationWriter(k,scope,()=>k.authorize(scope,'model.run')),/RESTORE_WRITE_BLOCKED|RESTORE_EGRESS_BLOCKED/);
  assert.throws(()=>k.authenticate(f.owner.bearer),/ACCESS_DENIED/);assert.equal(db.prepare('SELECT mode FROM commerce_recovery_state').get()!.mode,'quarantine');
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
