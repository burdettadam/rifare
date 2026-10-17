import test from 'node:test';import assert from 'node:assert/strict';
import { usingEdits } from './order-edit-helpers.mts';
import { canonical,contentDigest } from '../../packages/commerce/configuration-values.mts';
const count=(f:any,stage:string)=>f.sourceDb.prepare("SELECT count(*) n FROM edit_source_effects WHERE json_extract(result,'$.stage')=?").get(stage).n;

test('CASE-M04-G06-01 cheaper edit creates exact separately visible refund obligation',()=>usingEdits(async f=>{
 const e=f.authorize(f.quote({variant_id:'cheaper'})).order_edit_id,p=await f.edits.dispatch(f.a.scope,e);assert.equal(p.source.total_minor,'1000');assert.equal(p.source.finance.amount_minor,'1000');assert.equal(p.source.finance.kind,'refund');assert.equal(p.source.finance.settled,false);assert.equal(p.completed,false);
}));
test('CASE-M04-G06-02 refund failure preserves actual edited order and blocked shipping',()=>usingEdits(async f=>{
 const e=f.authorize(f.quote({variant_id:'cheaper'})).order_edit_id;f.native.fault='before';f.native.faultStage='refund';const r=await f.edits.dispatch(f.a.scope,e);assert.equal(r.source.total_minor,'1000');assert.equal(r.source.finance,null);assert.equal(r.state,'unknown');assert.equal(f.native.canPick(f.original.id,'warehouse_one'),false);
}));
test('CASE-M04-G06-03 lost refund response never causes second refund or repeat edit',()=>usingEdits(async f=>{
 const e=f.authorize(f.quote({variant_id:'cheaper'})).order_edit_id;f.native.fault='after';f.native.faultStage='refund';await f.edits.dispatch(f.a.scope,e);await f.edits.dispatch(f.a.scope,e);f.edits.reconcile(f.a.scope,e);await f.edits.dispatch(f.a.scope,e);assert.equal(count(f,'refund'),1);assert.equal(count(f,'commit'),1);f.native.settle(e);await f.edits.dispatch(f.a.scope,e);assert.equal((await f.edits.release(f.a.scope,e)).state,'released');assert.equal(f.native.order(f.original.id).net_paid_minor,'1000');
}));
test('M04-G06-04 original line discount is retained and not replaced by catalog marketing',()=>usingEdits(async f=>{
 const o=f.native.order(f.original.id);o.lines[0].discount_minor='200';f.native.fixtureOrder(f.original.id,{lines:o.lines,total_minor:'1800',net_paid_minor:'1800'});f.edits.refresh(f.a.scope,'case_one');const q=f.quote({variant_id:'cheaper'});assert.equal(q.quote.old_total_minor,'1800');assert.equal(q.quote.new_total_minor,'800');assert.equal(q.quote.amount_minor,'1000');
}));
test('M04-G06-05 price reduction cannot refund already returned native payment value',()=>usingEdits(async f=>{
 const e=f.authorize(f.quote({variant_id:'cheaper'})).order_edit_id;const perform=f.native.perform.bind(f.native);f.native.perform=async c=>{if(c.stage==='refund'){f.native.fixtureOrder(f.original.id,{net_paid_minor:'1000'});}return perform(c);};const r=await f.edits.dispatch(f.a.scope,e);assert.equal(r.state,'unknown');assert.equal(count(f,'refund'),0);
}));
test('CASE-M04-G07-01 higher-price edit creates one exact invoice and separate payment hold',()=>usingEdits(async f=>{
 const e=f.authorize(f.quote({variant_id:'upgrade'})).order_edit_id,r=await f.edits.dispatch(f.a.scope,e);assert.equal(r.source.finance.amount_minor,'1000');assert.equal(r.source.finance.currency,'USD');assert.equal(r.source.finance.order_version,2);assert.equal(r.source.finance.state,'unpaid');assert.ok(r.source.warehouses[0].holds.some((h:any)=>h.reason==='payment'));
}));
test('CASE-M04-G07-02 invoice creation failure cannot report paid upgrade',()=>usingEdits(async f=>{
 const e=f.authorize(f.quote({variant_id:'upgrade'})).order_edit_id;f.native.fault='before';f.native.faultStage='invoice';const r=await f.edits.dispatch(f.a.scope,e);assert.equal(r.source.balance_due_minor,'1000');assert.equal(r.source.finance,null);assert.equal(r.completed,false);await assert.rejects(f.edits.release(f.a.scope,e),/RECONCILIATION_REQUIRED/);
}));
test('CASE-M04-G07-03 timeout after invoice commit reconciles the original payable request',()=>usingEdits(async f=>{
 const e=f.authorize(f.quote({variant_id:'upgrade'})).order_edit_id;f.native.fault='after';f.native.faultStage='invoice';await f.edits.dispatch(f.a.scope,e);await f.edits.dispatch(f.a.scope,e);f.edits.reconcile(f.a.scope,e);await f.edits.dispatch(f.a.scope,e);assert.equal(count(f,'invoice'),1);assert.equal(f.sourceDb.prepare('SELECT count(*) n FROM edit_source_finance').get().n,1);
}));
test('CASE-M04-G08-01 exact settled payment is necessary but warehouse sync remains separate',()=>usingEdits(async f=>{
 const e=f.authorize(f.quote({variant_id:'upgrade'})).order_edit_id;await f.edits.dispatch(f.a.scope,e);f.native.settle(e);f.edits.reconcile(f.a.scope,e);await assert.rejects(f.edits.release(f.a.scope,e),/WAREHOUSE_STALE/);await f.edits.dispatch(f.a.scope,e);assert.equal((await f.edits.release(f.a.scope,e)).state,'released');
}));
test('CASE-M04-G08-02 partial failed expired and missing payments preserve fulfillment hold',()=>usingEdits(async f=>{
 const e=f.authorize(f.quote({variant_id:'upgrade'})).order_edit_id;await f.edits.dispatch(f.a.scope,e);
 for(const state of ['partial','failed','unpaid']){f.native.settle(e,{state,paid_minor:state==='partial'?'100':null});await assert.rejects(f.edits.release(f.a.scope,e),/PAYMENT_OUTSTANDING/);assert.equal(f.native.canPick(f.original.id,'warehouse_one'),false);}
 f.advance(60001);assert.equal(f.edits.status(f.a.scope,e).source.finance.state,'expired');await assert.rejects(f.edits.release(f.a.scope,e),/PAYMENT_OUTSTANDING/);
}));
test('CASE-M04-G08-03 duplicate settlement is not counted twice and late settlement stays version bound',()=>usingEdits(async f=>{
 const e=f.authorize(f.quote({variant_id:'upgrade'})).order_edit_id;await f.edits.dispatch(f.a.scope,e);f.advance(60001);f.native.settle(e);f.native.settle(e);assert.equal(f.native.order(f.original.id).net_paid_minor,'3000');await f.edits.dispatch(f.a.scope,e);await f.edits.release(f.a.scope,e);assert.equal(count(f,'invoice'),1);
}));
test('M04-G08-04 altered payment currency does not clear a hold',()=>usingEdits(async f=>{
 const e=f.authorize(f.quote({variant_id:'upgrade'})).order_edit_id;await f.edits.dispatch(f.a.scope,e);f.native.settle(e);const record=f.native.finance(e);record.currency='EUR';f.sourceDb.prepare('UPDATE edit_source_finance SET body=?,digest=? WHERE edit_id=?').run(canonical(record),contentDigest(record),e);await assert.rejects(f.edits.release(f.a.scope,e),/PAYMENT_MISMATCH/);assert.equal(f.native.canPick(f.original.id,'warehouse_one'),false);
}));
test('M04-G08-05 payment for another order version cannot settle the current edit',()=>usingEdits(async f=>{
 const e=f.authorize(f.quote({variant_id:'upgrade'})).order_edit_id;await f.edits.dispatch(f.a.scope,e);f.native.fixtureOrder(f.original.id,{status_note:'changed'});assert.throws(()=>f.native.settle(e),/PAYMENT_VERSION_CHANGED/);assert.equal(f.native.finance(e).state,'unpaid');
}));
test('M04-G08-06 restoring old or mixed financial observations fails exact identity checks',()=>usingEdits(async f=>{
 const e=f.authorize(f.quote({variant_id:'upgrade'})).order_edit_id;await f.edits.dispatch(f.a.scope,e);const record=f.native.finance(e);record.customer_id='other';f.sourceDb.prepare('UPDATE edit_source_finance SET body=?,digest=? WHERE edit_id=?').run(canonical(record),contentDigest(record),e);assert.throws(()=>f.edits.reconcile(f.a.scope,e),/PAYMENT_MISMATCH/);
}));
