import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { usingEdits } from './order-edit-helpers.mts';
import { OrderEditFixtureSource } from '../../packages/adapters/order-edit-fixture-source.mts';
import { OrderEdits } from '../../packages/commerce/order-edit-execution.mts';
import { WarehouseConnector, WAREHOUSE_CONNECTOR } from '../../packages/commerce/warehouse-connector.mts';
import { PrivacyLifecycle } from '../../packages/commerce/privacy-lifecycle.mts';
import { contentDigest } from '../../packages/commerce/configuration-values.mts';
import { safeOrder } from '../../packages/commerce/order-edit-core.mts';
import type { Row } from '../../packages/commerce/kernel.mts';

function binding(f:Row, patch:Row={}) {
  return {warehouse_id:'warehouse_one',expected_revision:0,connector_version:'1.0.0',
    api_version:'rifare-order-edit-fixture-v1',workflow_revision:'packing-v1',
    callbacks_connected:true,callback_observed_at:f.now(),callback_max_age_ms:30000,
    behavior:'qualified',...patch};
}
function connect(f:Row, patch:Row={}) {
  const connector=new WarehouseConnector(f.kernel,f.native);
  const configured=connector.configure(f.owner.scope,binding(f,patch));
  return {connector,configured};
}
function ready(f:Row) {
  const x=connect(f);
  f.edits.configure(f.owner.scope,{...f.settings,expected_revision:1});
  f.edits.refresh(f.a.scope,'case_one');
  return x;
}
const effects=(f:Row)=>f.sourceDb.prepare('SELECT count(*) n FROM edit_source_effects').get().n;

// Local preparation: original connected CASE-M08-G06-01 remains unperformed.
test('M08-G06-LOCAL-HOLD-UPDATE-AND-PICK-STATE',()=>usingEdits(async f=>{
  const {connector}=ready(f);
  const probe=connector.qualify(f.owner.scope,{warehouses:['warehouse_one']});
  assert.equal(probe.qualified,true);assert.equal(probe.live_qualified,false);
  assert.equal(probe.formal_goal_accepted,false);assert.equal(probe.qualification,'synthetic_only');
  assert.deepEqual(probe.connector,WAREHOUSE_CONNECTOR);
  assert.equal(probe.warehouses[0].picking_blocked,true);
  assert.equal(probe.warehouses[0].update_consumed,true);
  assert.equal(probe.warehouses[0].payload_digest_matched,true);
  const edit=f.authorize().order_edit_id;
  const done=await f.edits.dispatch(f.a.scope,edit);
  assert.equal(done.state,'ready_for_release');
  const state=connector.inspect(f.a.scope,{resource_id:f.original.id,warehouse_id:'warehouse_one'});
  assert.equal(state.can_pick,false);assert.equal(state.warehouse.ack_version,2);
  assert.deepEqual(state.warehouse.final_variant_ids,['equal']);
  assert.equal(state.warehouse.ack_digest,contentDigest(safeOrder(f.native.order(f.original.id))));
  assert.equal(state.warehouse.holds.length,1);
  await f.edits.release(f.a.scope,edit);
  assert.equal(f.native.tryPick(f.original.id,'warehouse_one').picked,true);
  assert.equal(f.native.warehouse(f.original.id,'warehouse_one').stage,'picking');
}));
test('M08-G06-LOCAL-TRANSPORT-ACK-DOES-NOT-QUALIFY-HOLD',()=>usingEdits(f=>{
  const {connector}=connect(f,{behavior:'transport_only'});
  const probe=connector.qualify(f.owner.scope,{warehouses:['warehouse_one']});
  assert.equal(probe.warehouses[0].transport_accepted,true);
  assert.equal(probe.warehouses[0].hold_acknowledged,false);
  assert.equal(probe.warehouses[0].picking_blocked,false);
  assert.equal(probe.qualified,false);
  assert.throws(()=>f.edits.configure(f.owner.scope,{...f.settings,expected_revision:1}),/EDIT_HOLD_PROBE_FAILED/);
  assert.equal(effects(f),0);
}));
test('M08-G06-LOCAL-IGNORED-UPDATE-FAILS-PAYLOAD-CONSUMPTION',()=>usingEdits(f=>{
  const {connector}=connect(f,{behavior:'ignore_updates'});
  const probe=connector.qualify(f.owner.scope,{warehouses:['warehouse_one']});
  assert.equal(probe.warehouses[0].hold_acknowledged,true);
  assert.equal(probe.warehouses[0].picking_blocked,true);
  assert.equal(probe.warehouses[0].transport_accepted,true);
  assert.equal(probe.warehouses[0].update_consumed,false);
  assert.equal(probe.warehouses[0].payload_digest_matched,false);
  assert.equal(probe.qualified,false);
  assert.throws(()=>f.edits.configure(f.owner.scope,{...f.settings,expected_revision:1}),/EDIT_HOLD_PROBE_FAILED/);
}));
test('M08-G06-LOCAL-WORKFLOW-CHANGE-INVALIDATES-APPROVED-EDIT',()=>usingEdits(async f=>{
  const {connector}=ready(f),edit=f.authorize().order_edit_id;
  const before=f.native.revision();
  connector.configure(f.owner.scope,binding(f,{expected_revision:1,workflow_revision:'packing-v2'}));
  assert.equal(f.native.revision(),before+1);
  await assert.rejects(f.edits.dispatch(f.a.scope,edit),/EDIT_READINESS_CHANGED/);
  assert.equal(effects(f),0);assert.equal(f.native.order(f.original.id).version,1);
}));
test('M08-G06-LOCAL-CALLBACK-DISCONNECT-BLOCKS-NEW-EFFECTS',()=>usingEdits(async f=>{
  const {connector}=ready(f),edit=f.authorize().order_edit_id;
  connector.configure(f.owner.scope,binding(f,{expected_revision:1,callbacks_connected:false}));
  const probe=connector.qualify(f.owner.scope,{warehouses:['warehouse_one']});
  assert.equal(probe.qualified,false);
  assert.deepEqual(probe.warehouses[0].reasons,['WAREHOUSE_CALLBACKS_DISCONNECTED']);
  await assert.rejects(f.edits.dispatch(f.a.scope,edit),/EDIT_READINESS_CHANGED|WAREHOUSE_CALLBACKS_DISCONNECTED/);
  assert.equal(effects(f),0);
}));
test('M08-G06-LOCAL-CALLBACK-LEASE-EXPIRES-WITHOUT-CONFIG-CHANGE',()=>usingEdits(async f=>{
  const {connector}=ready(f),edit=f.authorize().order_edit_id;
  const revision=f.native.revision();f.advance(30000);
  assert.equal(f.native.revision(),revision);
  assert.equal(connector.qualify(f.owner.scope,{warehouses:['warehouse_one']}).qualified,false);
  await assert.rejects(f.edits.dispatch(f.a.scope,edit),/WAREHOUSE_CALLBACKS_STALE/);
  assert.equal(effects(f),0);assert.equal(f.native.canPick(f.original.id,'warehouse_one'),false);
}));
test('M08-G06-LOCAL-VERSION-CONFIG-AND-CAS-ARE-STRICT',()=>usingEdits(f=>{
  const connector=new WarehouseConnector(f.kernel,f.native),before=f.native.revision();
  for(const patch of [{connector_version:'2.0.0'},{api_version:'other-v1'},
    {callback_observed_at:f.now()+1},{callback_max_age_ms:300001},{behavior:'live'}])
    assert.throws(()=>connector.configure(f.owner.scope,binding(f,patch)),/INVALID_INPUT|WAREHOUSE_VERSION_UNSUPPORTED/);
  assert.throws(()=>connector.configure(f.owner.scope,{...binding(f),endpoint:'https://unapproved.invalid'}),/INVALID_INPUT/);
  assert.equal(f.native.revision(),before);
  connector.configure(f.owner.scope,binding(f));
  assert.throws(()=>connector.configure(f.owner.scope,binding(f)),/WAREHOUSE_CONFIGURATION_CHANGED/);
}));
test('M08-G06-LOCAL-SCOPE-AND-OWNER-AUTHORITY-ARE-RECHECKED',()=>usingEdits(f=>{
  const {connector}=ready(f);
  assert.throws(()=>connector.configure(f.a.scope,binding(f,{expected_revision:1})),/ACCESS_DENIED/);
  assert.throws(()=>connector.qualify(f.b.scope,{warehouses:['warehouse_one']}),/ACCESS_DENIED|EDIT_SOURCE_MISMATCH/);
  assert.throws(()=>connector.inspect(f.b.scope,{resource_id:f.original.id,warehouse_id:'warehouse_one'}),/ACCESS_DENIED|NOT_FOUND|EDIT_SOURCE_MISMATCH/);
  assert.throws(()=>connector.inspect({}, {resource_id:f.original.id,warehouse_id:'warehouse_one'}),/ACCESS_DENIED/);
  f.kernel.revoke(f.owner.scope);
  assert.throws(()=>connector.configure(f.owner.scope,binding(f,{expected_revision:1})),/ACCESS_DENIED/);
}));
test('M08-G06-LOCAL-RESTART-RETAINS-BINDING-AND-CANARY-ROLLBACK',()=>usingEdits(f=>{
  const {connector,configured}=ready(f);
  const before=f.sourceDb.prepare('SELECT id,body,digest FROM edit_source_orders ORDER BY id').all();
  connector.qualify(f.owner.scope,{warehouses:['warehouse_one']});
  const reopened=new OrderEditFixtureSource(f.sourceDb,{mode:'fixture',identity:'edit-fixture',tenant:f.a.tenant,store:f.a.store},f.now);
  const next=new WarehouseConnector(f.kernel,reopened);
  assert.equal(reopened.identity,f.native.identity);
  assert.deepEqual(next.status(f.owner.scope,{warehouse_id:'warehouse_one'}).binding,configured.binding);
  assert.equal(next.qualify(f.owner.scope,{warehouses:['warehouse_one']}).qualified,true);
  assert.deepEqual(f.sourceDb.prepare('SELECT id,body,digest FROM edit_source_orders ORDER BY id').all(),before);
  assert.equal(f.sourceDb.prepare('SELECT count(*) n FROM edit_source_holds').get().n,0);
}));
test('M08-G06-LOCAL-UNKNOWN-SYNC-RECONCILES-ORIGINAL-RECEIPT',()=>usingEdits(async f=>{
  const {connector}=ready(f),edit=f.authorize().order_edit_id;
  f.native.fault='after';f.native.faultStage='sync:warehouse_one:final';
  const state=await f.edits.dispatch(f.a.scope,edit);
  assert.equal(state.state,'unknown');
  const unknown=state.stages.find((s:Row)=>s.state==='unknown');
  assert.equal(unknown.stage,'sync:warehouse_one:final');
  const count=effects(f);
  connector.configure(f.owner.scope,binding(f,{expected_revision:1,callbacks_connected:false}));
  const repaired=f.edits.reconcile(f.a.scope,edit);
  assert.equal(repaired.stages.find((s:Row)=>s.operation_id===unknown.operation_id).state,'confirmed');
  assert.equal(effects(f),count);
  await assert.rejects(f.edits.dispatch(f.a.scope,edit),/EDIT_READINESS_CHANGED|WAREHOUSE_CALLBACKS_DISCONNECTED/);
  assert.equal(f.native.warehouse(f.original.id,'warehouse_one').holds.length,1);
}));
test('M08-G06-LOCAL-NAMED-HTTP-ACCEPTANCE-FAULT-IS-DETECTED',()=>usingEdits(async f=>{
  connect(f,{behavior:'transport_only'});
  const oracle=(probe:Row)=>assert.equal(probe.qualified,false,'HTTP acceptance is not warehouse business completion');
  oracle(f.native.probe(['warehouse_one']));
  const url=new URL('../../packages/adapters/order-edit-fixture-source.mts',import.meta.url);
  const original=readFileSync(url,'utf8');
  const marker='qualified:results.every(r=>r.picking_before&&r.hold_acknowledged&&r.picking_blocked&&r.update_consumed&&r.payload_digest_matched)';
  assert.equal(original.split(marker).length,2);
  const faulty=original.replace(marker,'qualified:results.every(r=>r.transport_accepted)')
    .replace(/from '(\.[^']+)'/g,(_match,path)=>"from '"+new URL(path,url).href+"'");
  const dir=mkdtempSync(join(tmpdir(),'rifare-warehouse-fault-'));
  try {
    const file=join(dir,'order-edit-fixture-source.mts');writeFileSync(file,faulty);
    const {OrderEditFixtureSource:BrokenSource}=await import(pathToFileURL(file).href);
    const broken=new BrokenSource(f.sourceDb,{mode:'fixture',identity:'edit-fixture',tenant:f.a.tenant,store:f.a.store},f.now);
    const result=broken.probe(['warehouse_one']);
    assert.equal(result.warehouses[0].hold_acknowledged,false);
    assert.equal(result.warehouses[0].picking_blocked,false);
    assert.equal(result.qualified,true);
    assert.throws(()=>oracle(result),assert.AssertionError);
  } finally {rmSync(dir,{recursive:true,force:true});}
}));
test('M08-G06-LOCAL-ERASED-RESOURCE-CANNOT-READ-WAREHOUSE-COPY',()=>usingEdits(f=>{
  const {connector}=ready(f);
  const privacy=new PrivacyLifecycle(f.kernel);
  privacy.erase(f.owner.scope,f.original.customer_id);
  assert.throws(()=>connector.inspect(f.a.scope,{resource_id:f.original.id,warehouse_id:'warehouse_one'}),/SUBJECT_ERASED|NOT_FOUND/);
  assert.equal(f.native.order(f.original.id).customer_id,f.original.customer_id);
  assert.equal(effects(f),0);
}));
test('M08-G06-LOCAL-LEGACY-M04-PROBE-AND-APPROVAL-STILL-WORK',()=>usingEdits(async f=>{
  const probe=f.native.probe(['warehouse_one']);
  assert.equal(probe.qualified,true);assert.equal(probe.qualification,'synthetic_only');
  const connector=new WarehouseConnector(f.kernel,f.native);
  assert.throws(()=>connector.qualify(f.owner.scope,{warehouses:['warehouse_one']}),/WAREHOUSE_CONNECTOR_NOT_CONFIGURED/);
  const edit=f.authorize().order_edit_id;
  assert.equal((await f.edits.dispatch(f.a.scope,edit)).state,'ready_for_release');
  assert.equal((await f.edits.release(f.a.scope,edit)).state,'released');
  assert.equal(f.native.canPick(f.original.id,'warehouse_one'),true);
}));
