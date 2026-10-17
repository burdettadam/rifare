import test from 'node:test';import assert from 'node:assert/strict';
import { usingEdits } from './order-edit-helpers.mts';

test('M04-JOURNEY-01 equal-value edit reaches only final warehouse version',()=>usingEdits(async f=>{
 const receipt=f.authorize(),edit=receipt.order_edit_id;assert.ok(edit);const run=await f.edits.dispatch(f.a.scope,edit);assert.equal(run.state,'ready_for_release');assert.equal(f.native.canPick(f.original.id,'warehouse_one'),false);
 const released=await f.edits.release(f.a.scope,edit);assert.equal(released.state,'released');assert.equal(f.native.order(f.original.id).lines[0].variant_id,'equal');assert.equal(f.native.canPick(f.original.id,'warehouse_one'),true);assert.equal(f.native.catalog('equal').stock,9);
}));
test('M04-JOURNEY-02 paid upgrade blocks fulfillment until exact settlement and final sync',()=>usingEdits(async f=>{
 const r=f.authorize(f.quote({variant_id:'upgrade'})),e=r.order_edit_id;const pending=await f.edits.dispatch(f.a.scope,e);assert.equal(pending.state,'awaiting_invoice');assert.equal(pending.source.balance_due_minor,'1000');assert.equal(f.native.tryPick(f.original.id,'warehouse_one').picked,false);
 await assert.rejects(f.edits.release(f.a.scope,e),/PAYMENT_OUTSTANDING/);f.native.settle(e);assert.equal((await f.edits.dispatch(f.a.scope,e)).state,'ready_for_release');const done=await f.edits.release(f.a.scope,e);assert.equal(done.source.finance.state,'settled');assert.equal(f.native.canPick(f.original.id,'warehouse_one'),true);
}));
test('M04-JOURNEY-03 cheaper edit remains changed while refund awaits settlement',()=>usingEdits(async f=>{
 const e=f.authorize(f.quote({variant_id:'cheaper'})).order_edit_id,pending=await f.edits.dispatch(f.a.scope,e);assert.equal(pending.state,'awaiting_refund');assert.equal(pending.source.total_minor,'1000');assert.equal(pending.source.finance.state,'accepted');await assert.rejects(f.edits.release(f.a.scope,e),/PAYMENT_OUTSTANDING/);f.native.settle(e);await f.edits.dispatch(f.a.scope,e);assert.equal((await f.edits.release(f.a.scope,e)).state,'released');
}));
test('M04-JOURNEY-04 cancellation confirms every fulfillment source and preserves refund leg',()=>usingEdits(async f=>{
 const e=f.authorize(f.quote({kind:'cancel',line_id:null,variant_id:null})).order_edit_id,p=await f.edits.dispatch(f.a.scope,e);assert.equal(p.source.cancelled,true);assert.equal(p.source.warehouses[0].cancelled,true);assert.equal(p.state,'awaiting_refund');f.native.settle(e);await f.edits.dispatch(f.a.scope,e);assert.equal((await f.edits.release(f.a.scope,e)).state,'cancelled');assert.equal(f.native.canPick(f.original.id,'warehouse_one'),false);
}));
