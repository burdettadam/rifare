import test from 'node:test';import assert from 'node:assert/strict';
import { usingEdits } from './order-edit-helpers.mts';
const effects=(f:any,stage:string)=>f.sourceDb.prepare("SELECT count(*) n FROM edit_source_effects WHERE json_extract(result,'$.stage')=?").get(stage).n;

test('CASE-M04-G05-01 native begin calculate commit preserve line mapping and stock',()=>usingEdits(async f=>{
 const e=f.authorize().order_edit_id;await f.edits.dispatch(f.a.scope,e);for(const stage of ['begin','change','commit'])assert.equal(effects(f,stage),1);assert.equal(f.native.catalog('basic').stock,11);assert.equal(f.native.catalog('equal').stock,9);const result=f.sourceDb.prepare("SELECT result FROM edit_source_effects WHERE json_extract(result,'$.stage')='commit'").get();assert.deepEqual(JSON.parse(result.result).line_mapping,[{original:'line_one',current:'line_one',variant:'equal'}]);
}));
test('CASE-M04-G05-02 vanished inventory blocks commit under retained hold',()=>usingEdits(async f=>{
 const e=f.authorize().order_edit_id;f.native.fixtureStock('equal',1);const state=await f.edits.dispatch(f.a.scope,e);assert.equal(state.state,'unknown');assert.equal(effects(f,'commit'),0);assert.equal(f.native.order(f.original.id).lines[0].variant_id,'basic');assert.equal(f.native.canPick(f.original.id,'warehouse_one'),false);
}));
test('CASE-M04-G05-03 lost commit response reconciles original edit without a second stock decrement',()=>usingEdits(async f=>{
 const e=f.authorize().order_edit_id;f.native.fault='after';f.native.faultStage='commit';assert.equal((await f.edits.dispatch(f.a.scope,e)).state,'unknown');await f.edits.dispatch(f.a.scope,e);assert.equal(effects(f,'commit'),1);f.edits.reconcile(f.a.scope,e);await f.edits.dispatch(f.a.scope,e);assert.equal(f.native.catalog('equal').stock,9);assert.equal(effects(f,'commit'),1);
}));
test('M04-G05-04 hang has a bounded unknown result and never auto retries',()=>usingEdits(async f=>{
 const e=f.authorize().order_edit_id;f.native.fault='hang';f.native.faultStage='begin';const start=Date.now();assert.equal((await f.edits.dispatch(f.a.scope,e)).state,'unknown');assert.ok(Date.now()-start<2000);assert.equal(effects(f,'begin'),0);assert.equal((await f.edits.dispatch(f.a.scope,e)).state,'unknown');
}));
test('M04-G05-05 source catalog price change cannot use the approved cheaper price',()=>usingEdits(async f=>{
 const e=f.authorize().order_edit_id,v=f.native.catalog('equal');v.unit_minor='3000';const {canonical,contentDigest}=await import('../../packages/commerce/configuration-values.mts');f.sourceDb.prepare('UPDATE edit_source_catalog SET body=?,digest=? WHERE id=?').run(canonical(v),contentDigest(v),'equal');const state=await f.edits.dispatch(f.a.scope,e);assert.equal(state.state,'unknown');assert.equal(effects(f,'commit'),0);
}));
test('M04-G05-06 duplicate authorized previews cannot create concurrent active edit sessions',()=>usingEdits(f=>{
 const first=f.quote(),second=f.quote();f.authorize(first);assert.throws(()=>f.authorize(second),/EDIT_ALREADY_ACTIVE/);assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_order_edits').get().n,1);
}));
test('CASE-M04-G09-01 cancellation confirms all eligible fulfillment endpoints',()=>usingEdits(async f=>{
 const e=f.authorize(f.quote({kind:'cancel',line_id:null,variant_id:null})).order_edit_id;const state=await f.edits.dispatch(f.a.scope,e);assert.equal(state.source.cancelled,true);assert.equal(state.source.warehouses[0].cancelled,true);assert.equal(state.source.finance.state,'accepted');assert.equal(state.completed,false);
}));
test('CASE-M04-G09-02 warehouse unavailable after store cancellation remains partial not complete',()=>usingEdits(async f=>{
 const e=f.authorize(f.quote({kind:'cancel',line_id:null,variant_id:null})).order_edit_id;f.native.fault='before';f.native.faultStage='sync:warehouse_one:cancellation';const state=await f.edits.dispatch(f.a.scope,e);assert.equal(state.source.cancelled,true);assert.equal(state.source.warehouses[0].cancelled,false);assert.equal(state.completed,false);assert.equal(f.native.canPick(f.original.id,'warehouse_one'),false);
}));
test('CASE-M04-G09-03 lost warehouse cancellation acknowledgment is recovered without repeating native cancellation',()=>usingEdits(async f=>{
 const e=f.authorize(f.quote({kind:'cancel',line_id:null,variant_id:null})).order_edit_id;f.native.fault='after';f.native.faultStage='sync:warehouse_one:cancellation';await f.edits.dispatch(f.a.scope,e);f.edits.reconcile(f.a.scope,e);await f.edits.dispatch(f.a.scope,e);assert.equal(effects(f,'sync:warehouse_one:cancellation'),1);assert.equal(effects(f,'commit'),1);
}));
test('M04-G09-04 partial cancellation preserves shipped line and its original value',()=>usingEdits(async f=>{
 const o=f.native.order(f.original.id),shipped={...o.lines[0],id:'sent',variant_id:'basic',status:'shipped'};f.native.fixtureOrder(f.original.id,{lines:[...o.lines,shipped],total_minor:'4000',net_paid_minor:'4000'});f.edits.refresh(f.a.scope,'case_one');const e=f.authorize(f.quote({kind:'cancel',line_id:null,variant_id:null})).order_edit_id;const state=await f.edits.dispatch(f.a.scope,e);assert.equal(state.source.total_minor,'2000');assert.equal(state.source.finance.amount_minor,'2000');assert.equal(f.native.order(f.original.id).lines.find((l:any)=>l.id==='sent').status,'shipped');
}));
