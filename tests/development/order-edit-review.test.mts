import test from 'node:test';import assert from 'node:assert/strict';
import { usingEdits } from './order-edit-helpers.mts';
import { ExecutionStops } from '../../packages/commerce/execution-stops.mts';
import { OrderEdits } from '../../packages/commerce/order-edit-execution.mts';
import { OrderEditFixtureSource } from '../../packages/adapters/order-edit-fixture-source.mts';
import { PrivacyLifecycle } from '../../packages/commerce/privacy-lifecycle.mts';
import { DatabaseSync } from 'node:sqlite';

test('M04-REVIEW-01 canonical read interface reflects observed edited facts not the former catalog view',()=>usingEdits(async f=>{
 const e=f.authorize(f.quote({variant_id:'upgrade'})).order_edit_id;await f.edits.dispatch(f.a.scope,e);const observed=f.reads.orderStatus(f.a.scope,f.original.id);assert.equal(String(observed.order.totals.amount_minor),'3000');assert.equal(observed.order.lines[0].sku,'upgrade');
}));
test('M04-REVIEW-02 revoking the approver stops dispatch with no source effect',()=>usingEdits(async f=>{
 const e=f.authorize().order_edit_id;f.permissions.change(f.owner.scope,{actor_id:'reviewer',role:'reviewer',expected_revision:0,actions:['case.read'],resource_ids:null});await assert.rejects(f.edits.dispatch(f.a.scope,e),/APPROVAL_AUTHORITY_CHANGED/);assert.equal(f.sourceDb.prepare('SELECT count(*) n FROM edit_source_effects').get().n,0);
}));
test('M04-REVIEW-03 action-specific stop prevents dispatch and reset cannot reuse prior authorization',()=>usingEdits(async f=>{
 const e=f.authorize().order_edit_id,stops=new ExecutionStops(f.kernel);stops.set(f.owner.scope,{action:'diagnostic.order.edit',stopped:true,reason:'incident',expected_revision:0});await assert.rejects(f.edits.dispatch(f.a.scope,e),/EXECUTION_STOPPED/);stops.set(f.owner.scope,{action:'diagnostic.order.edit',stopped:false,reason:'reviewed_resume',expected_revision:1});await assert.rejects(f.edits.dispatch(f.a.scope,e),/REAUTHORIZATION/);
}));
test('M04-REVIEW-04 unknown operation can be investigated while execution is stopped',()=>usingEdits(async f=>{
 const e=f.authorize().order_edit_id;f.native.fault='after';f.native.faultStage='commit';await f.edits.dispatch(f.a.scope,e);new ExecutionStops(f.kernel).set(f.owner.scope,{action:'diagnostic.order.edit',stopped:true,reason:'incident',expected_revision:0});const r=f.edits.reconcile(f.a.scope,e);assert.equal(r.stages.find((x:any)=>x.stage==='commit').state,'confirmed');await assert.rejects(f.edits.dispatch(f.a.scope,e),/EXECUTION_STOPPED/);
}));
test('M04-REVIEW-05 same source label on a different database cannot replace the pinned identity',()=>usingEdits(async f=>{
 const e=f.authorize().order_edit_id,db=new DatabaseSync(':memory:');try{const source=new OrderEditFixtureSource(db,{mode:'fixture',identity:'edit-fixture',tenant:f.a.tenant,store:f.a.store},f.now);const other=new OrderEdits(f.kernel,source);await assert.rejects(other.dispatch(f.a.scope,e),/SOURCE_MISMATCH/);}finally{db.close();}
}));
test('M04-REVIEW-06 source injection cannot share the application database',()=>usingEdits(f=>{assert.throws(()=>new OrderEdits(f.kernel,{db:f.db} as any),/SEPARATE_FIXTURE_SOURCE/);}));
test('M04-REVIEW-07 concurrent restoration quarantine prohibits any new edit transport',()=>usingEdits(async f=>{
 const e=f.authorize().order_edit_id;f.db.prepare("INSERT INTO commerce_recovery_state VALUES(1,'test','quarantine',?,?,0)").run('test','test');await assert.rejects(f.edits.dispatch(f.a.scope,e),/RESTORE_/);assert.equal(f.sourceDb.prepare('SELECT count(*) n FROM edit_source_effects').get().n,0);
}));
test('M04-REVIEW-08 privacy export includes new addresses and erasure removes private copies',()=>usingEdits(f=>{
 const q=f.quote({kind:'address',line_id:null,variant_id:null,address:{...f.order.address,line1:'Delete this address'}}),privacy=new PrivacyLifecycle(f.kernel);const report=privacy.export(f.owner.scope,f.original.customer_id);assert.ok(JSON.stringify(report).includes('Delete this address'));privacy.erase(f.owner.scope,f.original.customer_id);assert.ok(!JSON.stringify(f.db.prepare('SELECT * FROM commerce_edit_inputs').all()).includes('Delete this address'));assert.ok(!JSON.stringify(f.db.prepare('SELECT * FROM commerce_edit_snapshots').all()).includes('Synthetic Customer'));assert.throws(()=>f.edits.prepare(f.a.scope,{quote_id:q.id,quote_digest:q.digest}),/ERASED|NOT_FOUND|CASE_|INVALID/);
}));
test('M04-REVIEW-10 negative hold acknowledgement cannot advance native editing',()=>usingEdits(async f=>{const e=f.authorize().order_edit_id,perform=f.native.perform.bind(f.native);f.native.perform=async c=>{const r=await perform(c);return c.stage.startsWith('hold:')?{...r,acknowledged:false}:r;};const r=await f.edits.dispatch(f.a.scope,e);assert.equal(r.state,'unknown');assert.equal(f.sourceDb.prepare("SELECT count(*) n FROM edit_source_effects WHERE json_extract(result,'$.stage')='begin'").get().n,0);}));
test('M04-REVIEW-11 warehouse acknowledgement for a different endpoint cannot advance release',()=>usingEdits(async f=>{const e=f.authorize().order_edit_id,perform=f.native.perform.bind(f.native);f.native.perform=async c=>{const r=await perform(c);return c.stage.startsWith('sync:')?{...r,warehouse_id:'wrong_endpoint'}:r;};const r=await f.edits.dispatch(f.a.scope,e);assert.equal(r.state,'unknown');await assert.rejects(f.edits.release(f.a.scope,e),/RECONCILIATION_REQUIRED/);}));
