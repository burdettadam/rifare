import test from 'node:test';
import assert from 'node:assert/strict';
import { usingQualifiedDestinations } from './qualified-destinations-helpers.mts';

test('M06-G12-LOST-SELECTION-RESPONSE-RECOVERS-TO-QUALIFIED-ALTERNATIVE',()=>usingQualifiedDestinations(f=>{
 const select=f.native.select.bind(f.native);f.native.select=input=>{select(input);throw new Error('FIXTURE_SELECTION_RESPONSE_LOST');};
 assert.throws(()=>f.choose(),/FIXTURE_SELECTION_RESPONSE_LOST/);assert.equal(f.routing.read(f.a.scope,{request_id:f.request.id}).selection,null);assert.equal(f.native.selection(f.request.id).selection_revision,1);
 f.native.select=select;f.reviseDestination('fragile-destination',{enabled:false});
 const recovered=f.choose('alternate-destination',0);assert.equal(recovered.revision,2);assert.equal(recovered.route.destination_id,'alternate-destination');assert.equal(f.quote().quote.details.return_destination.destination_id,'alternate-destination');
 assert.equal(f.fulfillmentSource.effects().length,0);assert.equal(f.native.admissions().length,0);assert.equal(f.fulfillmentDb.prepare('SELECT COUNT(*) n FROM fixture_destination_routes').get().n,2);
}));
test('M06-G12-LOST-POLICY-RESPONSE-RECOVERS-WITH-CURRENT-RESTRICTIONS',()=>usingQualifiedDestinations(f=>{
 const sync=f.native.syncPolicy.bind(f.native);f.native.syncPolicy=input=>{sync(input);throw new Error('FIXTURE_POLICY_RESPONSE_LOST');};
 assert.throws(()=>f.routing.configure(f.owner.scope,{...f.policy,expected_revision:1,policy_version:2,allowed_destination_ids:['fragile-destination']}),/FIXTURE_POLICY_RESPONSE_LOST/);
 f.native.syncPolicy=sync;const recovered=f.routing.configure(f.owner.scope,{...f.policy,expected_revision:1,policy_version:3,allowed_destination_ids:['alternate-destination']});
 assert.equal(recovered.revision,3);assert.equal(f.native.policy('carrier-one').revision,3);assert.deepEqual(f.routing.evaluate(f.a.scope,{request_id:f.request.id}).destinations.filter((d:any)=>d.eligible).map((d:any)=>d.destination_id),['alternate-destination']);assert.equal(f.fulfillmentSource.effects().length,0);
}));
test('M06-G12-UNKNOWN-LABEL-BLOCKS-NEW-DESTINATION-SELECTION',()=>usingQualifiedDestinations(async f=>{
 f.choose();const op=f.authorizeFulfillment(f.quote());f.fulfillmentSource.fault='after';assert.equal((await f.execution.dispatch(f.a.scope,op.id)).state,'unknown');
 assert.throws(()=>f.choose('alternate-destination',1),/DESTINATION_RECONCILIATION_REQUIRED/);assert.equal(f.native.selection(f.request.id).selection_revision,1);
 assert.equal((await f.execution.reconcile(f.a.scope,op.id)).state,'purchased');assert.equal(f.fulfillmentSource.effects().length,1);assert.equal(f.native.admissions().length,1);
}));
test('M06-G12-CONFIRMED-VOID-RELEASES-CAPACITY-FOR-APPROVED-REPLACEMENT',()=>usingQualifiedDestinations(async f=>{
 f.choose();const bought=await f.buy();assert.equal(f.native.capacity('fragile-destination').admitted_units,3);
 assert.throws(()=>f.choose('alternate-destination',1),/DESTINATION_LABEL_ALREADY_PURCHASED/);
 const voided=await f.voidLabel(bought.labelId);assert.equal(f.native.capacity('fragile-destination').admitted_units,3);assert.throws(()=>f.choose('alternate-destination',1),/DESTINATION_LABEL_ALREADY_PURCHASED/);
 f.fulfillmentSource.confirmVoid(bought.labelId,true);await f.execution.reconcile(f.a.scope,voided.id);assert.equal(f.native.capacity('fragile-destination').admitted_units,0);
 f.choose('alternate-destination',1);const next=await f.buy(bought.labelId);assert.equal(next.result.state,'purchased');assert.equal(f.native.capacity('alternate-destination').admitted_units,3);
 assert.equal(f.fulfillmentSource.effects().filter((e:any)=>e.kind==='label').length,2);assert.equal(f.native.admissions().length,2);assert.equal(f.labels.inspect(f.a.scope,bought.labelId).reimbursement_counted,false);assert.equal(f.labels.inspect(f.a.scope,next.labelId).amount_minor,'500');
}));
