import test from 'node:test';import assert from 'node:assert/strict';
import { usingEdits } from './order-edit-helpers.mts';
import { editEligibility } from '../../packages/commerce/order-edit-core.mts';
const denied=(code:string)=>new RegExp(code);

test('CASE-M04-G01-01 split fulfillment allows only the unshipped line',()=>usingEdits(f=>{
 const shipped={...f.order.lines[0],id:'shipped',status:'shipped',warehouse_id:'warehouse_two'};const o={...f.order,lines:[shipped,...f.order.lines]};
 assert.equal(editEligibility(o,f.settings.rules,'item','line_one',f.now()).eligible,true);assert.equal(editEligibility(o,f.settings.rules,'item','shipped',f.now()).eligible,false);assert.equal(editEligibility(o,f.settings.rules,'address',null,f.now()).eligible,false);
}));
test('CASE-M04-G01-02 per-action cutoffs reject at boundary before any source effect',()=>usingEdits(f=>{
 f.advance(59000);assert.throws(()=>f.quote({kind:'address',line_id:null,variant_id:null,address:{...f.order.address,line1:'2 Test'}}),/WINDOW_CLOSED/);assert.doesNotThrow(()=>f.quote());f.advance(60000);assert.throws(()=>f.quote(),/WINDOW_CLOSED/);assert.equal(f.sourceDb.prepare('SELECT count(*) n FROM edit_source_effects').get().n,0);
}));
test('CASE-M04-G01-03 picking after preview prevents native mutation',()=>usingEdits(async f=>{
 const e=f.authorize().order_edit_id;assert.equal(f.native.tryPick(f.original.id,'warehouse_one').picked,true);const result=await f.edits.dispatch(f.a.scope,e);assert.equal(result.state,'unknown');assert.equal(f.native.order(f.original.id).lines[0].variant_id,'basic');assert.equal(f.sourceDb.prepare('SELECT count(*) n FROM edit_source_calculated').get().n,0);
}));
test('M04-G01-04 unpaid source cannot enter another edit',()=>usingEdits(f=>{f.native.fixtureOrder(f.original.id,{financial_state:'partially_paid',balance_due_minor:'100'});f.edits.refresh(f.a.scope,'case_one');assert.throws(()=>f.quote(),/FINANCIAL_STATE/);}));
test('M04-G01-05 subscription lines are explicit unsupported operations',()=>usingEdits(f=>{const o=f.native.order(f.original.id);o.lines[0].subscription=true;f.native.fixtureOrder(f.original.id,{lines:o.lines});f.edits.refresh(f.a.scope,'case_one');assert.throws(()=>f.quote(),/SUBSCRIPTION/);}));
test('M04-G01-06 future creation time does not extend eligibility',()=>usingEdits(f=>{const o={...f.order,created_at:f.now()+1};assert.equal(editEligibility(o,f.settings.rules,'item','line_one',f.now()).eligible,false);}));
test('M04-G01-07 stale snapshot never supplies a current quotation',()=>usingEdits(f=>{f.advance(300001);assert.throws(()=>f.quote(),/SOURCE_STALE|CASE_VERIFICATION/);}));
test('M04-G01-08 wrong store and case cannot quote another order',()=>usingEdits(f=>{assert.throws(()=>f.edits.quote(f.b.scope,f.intent()),/NOT_FOUND/);}));
test('CASE-M04-G04-01 approved address within qualified region reaches final source version',()=>usingEdits(async f=>{
 const next={...f.order.address,line1:'17 New Test Street'},e=f.authorize(f.quote({kind:'address',line_id:null,variant_id:null,address:next})).order_edit_id;await f.edits.dispatch(f.a.scope,e);assert.deepEqual(f.native.order(f.original.id).address,next);await f.edits.release(f.a.scope,e);assert.equal(f.native.canPick(f.original.id,'warehouse_one'),true);
}));
test('CASE-M04-G04-02 unsupported country or tax zone is rejected before hold',()=>usingEdits(f=>{
 for(const address of [{...f.order.address,country:'CA'},{...f.order.address,state:'FL'},{...f.order.address,postal:'90210'}])assert.throws(()=>f.quote({kind:'address',line_id:null,variant_id:null,address}),/ADDRESS_UNSUPPORTED|TAX_SHIPPING/);
 assert.equal(f.sourceDb.prepare('SELECT count(*) n FROM edit_source_holds').get().n,0);
}));
test('CASE-M04-G04-03 changed address after approval blocks stale dispatch',()=>usingEdits(async f=>{
 const e=f.authorize(f.quote({kind:'address',line_id:null,variant_id:null,address:{...f.order.address,line1:'2 Changed'}})).order_edit_id;f.native.fixtureOrder(f.original.id,{address:{...f.order.address,line1:'Native change'}});assert.equal((await f.edits.dispatch(f.a.scope,e)).state,'unknown');assert.equal(f.native.order(f.original.id).address.line1,'Native change');
}));
test('M04-G04-04 source prices are never client input authority',()=>usingEdits(f=>{assert.throws(()=>f.edits.quote(f.a.scope,{...f.intent(),amount_minor:'1'}),/INVALID_INPUT/);}));
test('M04-G04-05 address details stay out of shared previews and audit events',()=>usingEdits(f=>{
 const q=f.quote({kind:'address',line_id:null,variant_id:null,address:{...f.order.address,line1:'Sensitive new address'}}),r=f.authorize(q);assert.ok(!JSON.stringify(q.quote).includes('Sensitive'));assert.ok(!JSON.stringify(r).includes('Sensitive'));assert.ok(!JSON.stringify(f.db.prepare('SELECT * FROM commerce_edit_events').all()).includes('Sensitive'));
}));
