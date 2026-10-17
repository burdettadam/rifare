import test from 'node:test';import assert from 'node:assert/strict';
import { usingEdits } from './order-edit-helpers.mts';

test('CASE-M04-G02-01 synthetic probe exercises picking inhibition and update acknowledgment',()=>usingEdits(f=>{
 const r=f.native.probe(['warehouse_one']);assert.equal(r.qualified,true);assert.equal(r.qualification,'synthetic_only');assert.equal(r.warehouses[0].picking_before,true);assert.equal(r.warehouses[0].picking_blocked,true);assert.equal(r.warehouses[0].update_consumed,true);assert.equal(f.sourceDb.prepare('SELECT count(*) n FROM edit_source_orders').get().n,1);
}));
test('CASE-M04-G02-02 tag-only warehouse fails qualification',()=>usingEdits(f=>{
 f.native.configureWarehouse('warehouse_one','tag_only');assert.equal(f.native.probe(['warehouse_one']).qualified,false);assert.throws(()=>f.edits.configure(f.owner.scope,{...f.settings,expected_revision:1}),/HOLD_PROBE_FAILED/);
}));
test('CASE-M04-G02-03 changed warehouse configuration invalidates prior qualification',()=>usingEdits(async f=>{
 const e=f.authorize().order_edit_id;f.native.configureWarehouse('warehouse_one','offline');await assert.rejects(f.edits.dispatch(f.a.scope,e),/READINESS_CHANGED/);assert.equal(f.sourceDb.prepare('SELECT count(*) n FROM edit_source_effects').get().n,0);
}));
test('M04-G02-04 owner cannot name an absent fulfillment endpoint as qualified',()=>usingEdits(f=>{assert.throws(()=>f.edits.configure(f.owner.scope,{...f.settings,expected_revision:1,warehouses:['unknown']}),/WAREHOUSE_UNAVAILABLE/);}));
test('M04-G02-05 unqualified source is not fabricated from a config file',()=>usingEdits(f=>{assert.throws(()=>f.edits.configure(f.a.scope,f.settings),/ACCESS_DENIED/);}));
test('CASE-M04-G03-01 payment and foreign holds remain independently owned',()=>usingEdits(async f=>{
 f.native.foreignHold(f.original.id,'warehouse_one','fraud');const e=f.authorize(f.quote({variant_id:'upgrade'})).order_edit_id;await f.edits.dispatch(f.a.scope,e);const holds=f.native.warehouse(f.original.id,'warehouse_one').holds;
 assert.deepEqual(holds.map((h:any)=>h.reason).sort(),['edit','fraud','payment']);assert.equal(holds.find((h:any)=>h.reason==='fraud').owner,'external');assert.equal(f.native.tryPick(f.original.id,'warehouse_one').picked,false);
}));
test('CASE-M04-G03-02 gateway refuses an agent requested release-all action',()=>usingEdits(f=>{assert.throws(()=>f.gateway.prepare(f.agent.scope,{case_id:'case_one',action:'fulfillment.releaseAll',arguments:{}}),/UNSUPPORTED_ACTION/);}));
test('CASE-M04-G03-03 distinct foreign hold mutations do not erase other reasons',()=>usingEdits(f=>{
 f.native.foreignHold(f.original.id,'warehouse_one','fraud');f.native.foreignHold(f.original.id,'warehouse_one','stock','inventory');f.native.clearForeignHold(f.original.id,'warehouse_one','fraud');assert.deepEqual(f.native.warehouse(f.original.id,'warehouse_one').holds.map((h:any)=>h.reason),['inventory']);
}));
test('CASE-M04-G10-01 only final acknowledged paid order releases owned holds',()=>usingEdits(async f=>{
 const e=f.authorize(f.quote({variant_id:'upgrade'})).order_edit_id;await f.edits.dispatch(f.a.scope,e);f.native.settle(e);await f.edits.dispatch(f.a.scope,e);const r=await f.edits.release(f.a.scope,e);assert.equal(r.state,'released');assert.deepEqual(r.source.warehouses[0].final_variant_ids,['upgrade']);assert.equal(r.source.warehouses[0].holds.length,0);
 const count=f.sourceDb.prepare('SELECT count(*) n FROM edit_source_effects').get().n;await f.edits.release(f.a.scope,e);assert.equal(f.sourceDb.prepare('SELECT count(*) n FROM edit_source_effects').get().n,count);
}));
test('CASE-M04-G10-02 foreign hold never disappears during Rifare release',()=>usingEdits(async f=>{
 const e=f.authorize().order_edit_id;await f.edits.dispatch(f.a.scope,e);f.native.foreignHold(f.original.id,'warehouse_one','fraud');await assert.rejects(f.edits.release(f.a.scope,e),/FOREIGN_HOLD/);assert.equal(f.native.warehouse(f.original.id,'warehouse_one').holds.length,2);
 f.native.clearForeignHold(f.original.id,'warehouse_one','fraud');await f.edits.release(f.a.scope,e);assert.equal(f.native.canPick(f.original.id,'warehouse_one'),true);
}));
test('CASE-M04-G10-03 blocker arriving between release preview and source CAS prevents shipping',()=>usingEdits(async f=>{
 const e=f.authorize().order_edit_id;await f.edits.dispatch(f.a.scope,e);const perform=f.native.perform.bind(f.native);f.native.perform=async c=>{if(c.stage.startsWith('release:')){f.native.foreignHold(f.original.id,'warehouse_one','raced');f.native.perform=perform;}return perform(c);};
 const state=await f.edits.release(f.a.scope,e);assert.equal(state.state,'unknown');assert.equal(f.native.canPick(f.original.id,'warehouse_one'),false);assert.ok(f.native.warehouse(f.original.id,'warehouse_one').holds.some((h:any)=>h.handle==='raced'));
}));
test('M04-G10-04 pending warehouse acknowledgment cannot be treated as current',()=>usingEdits(async f=>{
 const e=f.authorize().order_edit_id;f.native.fault='before';f.native.faultStage='sync:warehouse_one:final';await f.edits.dispatch(f.a.scope,e);await assert.rejects(f.edits.release(f.a.scope,e),/RECONCILIATION_REQUIRED/);assert.equal(f.native.canPick(f.original.id,'warehouse_one'),false);
}));
