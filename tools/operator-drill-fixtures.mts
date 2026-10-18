// Local diagnostic fixtures only. No arbitrary endpoint, token, command or shell
// input is accepted. The normal commerce modules perform each business transition.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {chmodSync} from 'node:fs';
import {CommerceKernel} from '../packages/commerce/kernel.mts';
import {MigrationCutover} from '../packages/commerce/migration-cutover.mts';
import {withMigrationWriter} from '../packages/commerce/migration-fence.mts';
import {RUNBOOKS,executeOperatorRunbook} from '../packages/commerce/operator-runbooks.mts';
import {ResolutionExecution} from '../packages/commerce/resolution-execution.mts';
import {WorkerApi} from '../packages/commerce/worker-api.mts';
import {DurableWork} from '../packages/commerce/durable-work.mts';
import {createRecoverySnapshot,restoreRecoverySnapshot,suppressionCheckpoint} from '../packages/commerce/safe-recovery.mts';
import {contentDigest} from '../packages/commerce/configuration-values.mts';
import {executionFixture} from '../tests/development/execution-helpers.mts';
import {returnPortabilityFixture,withPortabilityServer} from '../tests/development/return-portability-helpers.mts';
import {reliabilityFixture} from '../tests/development/reliability-helpers.mts';
import {controlsFixture,credentials} from '../tests/development/worker-controls-helpers.mts';
import {editFixture} from '../tests/development/order-edit-helpers.mts';

const count=(db:DatabaseSync,table:string)=>Number(db.prepare('SELECT count(*) n FROM '+table).get()!.n);
function expectedFailure(fn:()=>unknown,pattern:RegExp){try{fn();}catch(error){if(error instanceof Error&&pattern.test(error.message))return error.message;throw error;}throw new Error('DRILL_EXPECTED_DENIAL_MISSING');}
async function expectedRejection(fn:()=>Promise<unknown>,pattern:RegExp){try{await fn();}catch(error){if(error instanceof Error&&pattern.test(error.message))return error.message;throw error;}throw new Error('DRILL_EXPECTED_DENIAL_MISSING');}
function cloneFixtureDatabase(f:any,name='next.sqlite') {
 const filename=join(f.directory,name);f.db.prepare('VACUUM INTO ?').run(filename);chmodSync(filename,0o600);
 const db=new DatabaseSync(filename),kernel=new CommerceKernel(db,f.now);
 return {db,kernel,filename,bearer:f.owner.bearer,scope:kernel.authenticate(f.owner.bearer),operator:kernel.authenticate(f.a.bearer)};
}
/** Construction of disposable synthetic input only. Existing reusable fixture
 * builders seed three merchants. The migration contract requires exactly one.
 * No imported database, quarantine or protected source fixture is changed. */
export function prepareSingleMerchantFixture(f:any) {
 const quote=(name:string)=>'"'+name.replaceAll('"','""')+'"';
 const triggers=f.db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' ORDER BY name").all();
 const deletes=triggers.filter((r:any)=>/\b(?:BEFORE|AFTER|INSTEAD OF)\s+DELETE\b/i.test(r.sql));
 const tables=f.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE 'commerce_%' ORDER BY name").all();
 f.kernel.transaction(()=>{
  f.db.exec('PRAGMA defer_foreign_keys=ON');
  for(const row of deletes)f.db.exec('DROP TRIGGER '+quote(row.name));
  for(const row of tables){const columns=f.db.prepare('PRAGMA table_info('+quote(row.name)+')').all().map((r:any)=>r.name);
   if(columns.includes('tenant_id')&&columns.includes('store_id'))f.db.prepare('DELETE FROM '+quote(row.name)+' WHERE tenant_id<>? OR store_id<>?').run(f.a.tenant,f.a.store);
  }
  for(const row of deletes)f.db.exec(row.sql);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.deepEqual(f.db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' ORDER BY name").all(),triggers);
  assert.equal(count(f.db,'commerce_stores'),1);
 });
}
export async function usingMigrationFixture(fn:(f:any)=>unknown) {
 const f=executionFixture();let next:ReturnType<typeof cloneFixtureDatabase>|undefined;
 try{prepareSingleMerchantFixture(f);next=cloneFixtureDatabase(f);const coordinator=MigrationCutover.create(join(f.directory,'coordinator.sqlite'),{coordinator_id:'migration_fixture',tenant_id:f.a.tenant,store_id:f.a.store});
  coordinator.bind(f.kernel,f.owner.scope,'old',{initial_owner:true});coordinator.bind(next.kernel,next.scope,'next');
  const r=f.order(),input={kind:r.kind,source_system:r.source_system,external_id:r.external_id,source_version:r.source_version,source_updated_at:r.source_updated_at,customer_id:r.customer_id,payload:r.payload};
  return await fn({old:{db:f.db,kernel:f.kernel,filename:f.filename,bearer:f.owner.bearer,scope:f.owner.scope},next,coordinator,resource:r.id,input,now:f.now});
 }finally{next?.db.close();f.cleanup();}
}
function financialEffects(f:any){return {gateway_refunds:count(f.gatewayDb,'fixture_woo_gateway_refunds'),gateway_movements:count(f.gatewayDb,'fixture_woo_gateway_movements'),customer_messages:count(f.mailDb,'support_source_effects')};}
function identityRows(db:DatabaseSync){return {receipts:db.prepare('SELECT id,digest FROM commerce_action_receipts ORDER BY id').all(),refunds:db.prepare('SELECT id,receipt_id,digest FROM commerce_resolution_operations ORDER BY id').all()};}

async function financialMigration(pending:boolean) {
 const f=returnPortabilityFixture();let next:ReturnType<typeof cloneFixtureDatabase>|undefined;
 try{
  prepareSingleMerchantFixture(f);
  const operation=f.approved();let messageId:string|undefined;
  if(pending){
   const original=f.source.issue.bind(f.source);f.source.issue=async command=>{await original(command);throw new Error('DIAGNOSTIC_LOST_RESPONSE');};
   assert.equal((await f.executor.dispatch(f.a.scope,operation.id)).state,'unknown');
   assert.equal((await f.executor.reconcile(f.a.scope,operation.id)).state,'accepted');
   const queued=f.support.delivery.queue(f.a.scope,f.message(operation.id,{template_id:'return_refund_pending_v1'}));messageId=queued.operation_id;
   f.mailSource.fault='after';assert.equal((await f.support.delivery.dispatch(f.a.scope,messageId)).state,'unknown');
  }
  next=cloneFixtureDatabase(f);const identities=identityRows(f.db);
  assert.deepEqual(identityRows(next.db),identities);
  const coordinator=MigrationCutover.create(join(f.directory,'coordinator.sqlite'),{coordinator_id:'financial_migration_fixture',tenant_id:f.a.tenant,store_id:f.a.store});
  coordinator.bind(f.kernel,f.owner.scope,'old',{initial_owner:true});coordinator.bind(next.kernel,next.scope,'next');
  const other=new ResolutionExecution(next.kernel,f.source);
  await expectedRejection(()=>withMigrationWriter(next!.kernel,next!.operator,()=>other.dispatch(next!.operator,operation.id)),/MIGRATION_NOT_WRITER/);
  if(!pending){
   await withMigrationWriter(f.kernel,f.a.scope,async()=>{
    assert.equal((await f.executor.dispatch(f.a.scope,operation.id)).state,'accepted');f.advance(1);f.gatewaySource.settle(operation.id);
    assert.equal((await f.executor.reconcile(f.a.scope,operation.id)).state,'settled');
    messageId=f.support.delivery.queue(f.a.scope,f.message(operation.id)).operation_id;
    await f.support.delivery.dispatch(f.a.scope,messageId);
   });
  }
  const before=coordinator.compare(f.kernel,f.owner.scope,next.kernel,next.scope);
  if(pending)expectedFailure(()=>coordinator.cutover(f.kernel,f.owner.scope,next!.kernel,next!.scope,{expected_epoch:1,expected_history_digest:before.digest}),/MIGRATION_RECONCILIATION_REQUIRED/);
  const rollback=coordinator.rollback(f.kernel,f.owner.scope,next.kernel,next.scope,{expected_epoch:1});
  for(const [kernel,scope,executor] of [[f.kernel,f.a.scope,f.executor],[next.kernel,next.operator,other]] as const)
   await expectedRejection(()=>withMigrationWriter(kernel,scope,()=>executor.dispatch(scope,operation.id)),/MIGRATION_NOT_WRITER/);
  assert.deepEqual(identityRows(f.db),identities);assert.deepEqual(identityRows(next.db),identities);
  const effects=financialEffects(f);assert.deepEqual(effects,{gateway_refunds:1,gateway_movements:pending?0:1,customer_messages:1});
  assert.equal(f.mailSource.calls,1);assert.equal(count(f.db,'commerce_resolution_operations'),1);
  return {schema_version:1,drill:pending?'migration-pending':'migration-overlap',outcome:rollback.outcome,designated_writer:'old',rejected_writers:1,rollback,receipts_preserved:true,original_operations_preserved:true,
   operation_id:operation.id,message_operation_id:messageId,effects,customer_delivery_verified:false,live_effects:false,qualification:'local_fixture_drill',independent_operator_observed:false,
   mirror_method:'single-merchant synthetic fixture construction, then diagnostic SQLite snapshot before binding; no merchant import or live activation',source_accounts:'separate Woo refund, gateway and support fixture databases'};
 }finally{next?.db.close();f.cleanup();}
}

async function refundDrill() {
 const f=returnPortabilityFixture();
 try{const operation=f.approved(),original=f.source.issue.bind(f.source);f.source.issue=async command=>{await original(command);throw new Error('DIAGNOSTIC_LOST_RESPONSE');};
  assert.equal((await f.executor.dispatch(f.a.scope,operation.id)).state,'unknown');
  const evidence=await withPortabilityServer(f,async post=>{
   const call=async(path:string)=>{const r=await post(path,{operation_id:operation.id});assert.equal(r.status,200);return r.body;};
   return executeOperatorRunbook(RUNBOOKS['ambiguous-refund'],{
    'refund.inspect':()=>call('/v1/resolutions/operation'),
    'refund.reconcile':()=>call('/v1/resolutions/reconcile'),
    'fixture.gateway.settle':()=>{f.advance(1);return f.gatewaySource.settle(operation.id);},
    'refund.reconcile-settled':()=>call('/v1/resolutions/reconcile'),
   });
  });
  const effects=financialEffects(f);assert.deepEqual(effects,{gateway_refunds:1,gateway_movements:1,customer_messages:0});
  assert.equal(count(f.sourceDb,'fixture_woo_refund_records'),1);
  return {...evidence,before:'unknown',after:f.executor.read(f.a.scope,operation.id).state,operation_id:operation.id,command_repeated:false,effects,
   http_routes:['POST /v1/resolutions/operation','POST /v1/resolutions/reconcile']};
 }finally{f.cleanup();}
}
async function journalDrill(outage:boolean) {
 const f=reliabilityFixture();try{const op=f.executeOperation().op;f.journal.arm('after_accept');
  assert.equal((await f.work.dispatch(f.a.scope,op.id,f.journal)).state,'unknown');
  if(outage)f.journal.arm('lookup_unavailable');
  const commands={
   'operation.inspect':()=>f.ops.read(f.a.scope,op.id),
   'operation.reconcile':async()=>(await f.recon.one(f.a.scope,op.id,f.journal)).operation,
   'operation.reconcile-unavailable':async()=>(await f.recon.one(f.a.scope,op.id,f.journal)).operation,
   'fixture.provider.recover':()=>{f.journal.arm('none');return {state:'available'};},
  };
  const evidence=await executeOperatorRunbook(RUNBOOKS[outage?'provider-outage':'lost-webhook'],commands);
  const effects={source_records:f.journal.count(),webhook_deliveries:count(f.db,'commerce_webhook_inbox')};
  assert.deepEqual(effects,{source_records:1,webhook_deliveries:0});
  return {...evidence,before:'unknown',...(outage?{during_outage:'unknown'}:{}),after:f.ops.read(f.a.scope,op.id).state,operation_id:op.id,command_repeated:false,effects};
 }finally{f.cleanup();}
}
async function tokenDrill() {
 const f=controlsFixture();try{const c=credentials(f);c.put();f.advance(900001);let scope=f.a.scope;
  const evidence=await executeOperatorRunbook(RUNBOOKS['expired-token'],{
   'session.inspect-expired':()=>({state:expectedFailure(()=>f.kernel.authorize(scope,'resource.read'),/ACCESS_DENIED/)}),
   'session.issue-local':()=>{scope=f.kernel.authenticate(f.kernel.issueSession(f.a.tenant,f.a.store,'operator'));return {state:'active'};},
   'credential.probe':()=>c.service.probe(scope,'test-model'),
  });
  assert.equal(c.seen.length,1);expectedFailure(()=>f.kernel.authenticate(f.a.bearer),/ACCESS_DENIED/);
  return {...evidence,before:'ACCESS_DENIED',after:'succeeded',old_token_rejected:true,effects:{provider_probes:c.seen.length},secret_values_returned:false};
 }finally{f.cleanup();}
}
async function holdDrill() {
 const f=editFixture();try{const edit=f.authorize().order_edit_id;await f.edits.dispatch(f.a.scope,edit);
  f.native.foreignHold(f.original.id,'warehouse_one','fraud');
  const evidence=await executeOperatorRunbook(RUNBOOKS['stuck-hold'],{
   'hold.release':async()=>({state:await expectedRejection(()=>f.edits.release(f.a.scope,edit),/FOREIGN_HOLD/)}),
   'fixture.hold-owner-clear':()=>{
    const holds=f.native.warehouse(f.original.id,'warehouse_one').holds;
    assert.equal(holds.find((hold:any)=>hold.reason==='fraud')?.owner,'external');assert.equal(f.native.canPick(f.original.id,'warehouse_one'),false);
    expectedFailure(()=>f.gateway.prepare(f.agent.scope,{case_id:'case_one',action:'fulfillment.releaseAll',arguments:{}}),/UNSUPPORTED_ACTION/);
    f.native.clearForeignHold(f.original.id,'warehouse_one','fraud');return {state:'cleared'};
   },
   'hold.release-reviewed':()=>f.edits.release(f.a.scope,edit),
  });
  assert.equal(f.native.canPick(f.original.id,'warehouse_one'),true);
  return {...evidence,before:evidence.trace[0].observed_state,after:'released',edit_id:edit,foreign_hold_preserved_until_owner_clear:true,picking_before_owner_clear:false,hold_bypass_rejected:true,effects:{source_records:count(f.sourceDb,'edit_source_effects')},physical_shipping_observed:false};
 }finally{f.cleanup();}
}
async function restoreDrill() {
 const f=reliabilityFixture();let restoredDB:DatabaseSync|undefined;
 try{const op=f.executeOperation().op;let snapshot:any,restored:any;const cp=suppressionCheckpoint(f.kernel);
  const evidence=await executeOperatorRunbook(RUNBOOKS.restore,{
   'restore.snapshot':()=>{snapshot=createRecoverySnapshot(f.kernel,join(f.directory,'snapshot'));return {state:'snapshot_ready'};},
   'restore.quarantine':()=>{restored=restoreRecoverySnapshot({snapshot:snapshot.directory,destination:join(f.directory,'restored'),manifest_sha256:snapshot.manifest_sha256,suppression:cp,suppression_sha256:contentDigest(cp)},f.now);return {state:restored.mode};},
   'restore.inspect':()=>{
    restoredDB=new DatabaseSync(restored.database);const k=new CommerceKernel(restoredDB,f.now);expectedFailure(()=>k.authenticate(f.a.bearer),/ACCESS_DENIED/);
    const scope=k.authenticate(k.issueSession(f.a.tenant,f.a.store,'owner'));assert.equal(k.get(scope,f.order().id).id,f.order().id);
    expectedFailure(()=>new DurableWork(k).claim(scope,op.id),/RESTORE_WRITE_BLOCKED|RESTORED_OPERATION_REPLAY_BLOCKED/);
    expectedFailure(()=>k.authorize(scope,'model.run'),/RESTORE_EGRESS_BLOCKED|RESTORE_WRITE_BLOCKED/);
    assert.equal(restoredDB.prepare('SELECT operation_id FROM commerce_restored_operations WHERE operation_id=?').get(op.id)!.operation_id,op.id);
    return {state:String(restoredDB.prepare('SELECT mode FROM commerce_recovery_state WHERE id=1').get()!.mode)};
   },
  });
  assert.equal(f.journal.count(),0);
  return {...evidence,after:'quarantine',old_token_rejected:true,egress_enabled:false,old_operation_replay_blocked:true,operation_id:op.id,effects:{source_records:0},same_host_restore_only:true};
 }finally{restoredDB?.close();f.cleanup();}
}
async function agentDrill() {
 const f=returnPortabilityFixture();try{const worker=new WorkerApi(f.kernel,{resolutionExecution:f.executor}),audience='http://127.0.0.1:9001/v1/worker';let grant:any,lease:any;
  f.support.ownership.assign(f.owner.scope,{case_id:f.caseId,expected_generation:1,actor_id:f.agent.actor});
  const evidence=await executeOperatorRunbook(RUNBOOKS['agent-incident'],{
   'agent.claim':()=>{grant=worker.leases.issue(f.agent.scope,{case_id:f.caseId,lifetime_ms:100000},audience);lease=worker.leases.claim(grant.token,audience,10000);return {state:f.support.ownership.inspect(f.owner.scope,f.caseId)!.mode};},
   'agent.takeover':()=>({state:f.support.ownership.takeover(f.a.scope,{case_id:f.caseId,expected_generation:2,reason:'exception'}).mode}),
   'agent.verify-fence':()=>{
    expectedFailure(()=>worker.returnContext(grant.token,audience,lease.generation),/WORK_ACCESS_DENIED|WORK_FENCE_REJECTED/);
    expectedFailure(()=>f.support.ownership.takeover(f.a.scope,{case_id:f.caseId,expected_generation:2,reason:'exception'}),/SUPPORT_OWNERSHIP_CHANGED/);
    return {state:'rejected'};
   },
  });
  assert.equal(f.cases.resume(f.a.scope,f.caseId).id,f.caseId);assert.equal(count(f.mailDb,'support_source_effects'),0);
  return {...evidence,after:'human',old_lease_rejected:true,same_case_preserved:true,stale_generation_rejected:true,effects:{customer_messages:0}};
 }finally{f.cleanup();}
}
export const OPERATOR_DRILL_IDS=Object.freeze([...Object.keys(RUNBOOKS),'migration-overlap','migration-pending']);
export async function runOperatorDrill(id:string):Promise<any> {
 if(!OPERATOR_DRILL_IDS.includes(id))throw new Error('DRILL_UNKNOWN');
 if(id==='migration-overlap'||id==='migration-pending')return financialMigration(id==='migration-pending');
 const run=id==='ambiguous-refund'?refundDrill:id==='lost-webhook'?()=>journalDrill(false):id==='provider-outage'?()=>journalDrill(true):id==='expired-token'?tokenDrill:id==='stuck-hold'?holdDrill:id==='restore'?restoreDrill:agentDrill;
 return {schema_version:1,drill:id,...await run()};
}
