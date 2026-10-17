import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { usingFulfillment } from './fulfillment-helpers.mts';
import { usingQualifiedDestinations } from './qualified-destinations-helpers.mts';
import { FulfillmentFixtureSource } from '../../packages/adapters/fulfillment-fixture-source.mts';
import { FulfillmentExecution } from '../../packages/commerce/fulfillment-execution.mts';
import { QualifiedReturnDestinations } from '../../packages/commerce/qualified-return-destinations.mts';
import { contentDigest } from '../../packages/commerce/configuration-values.mts';

test('CASE-M06-G12-01',()=>usingQualifiedDestinations(async f=>{
 const e=f.routing.evaluate(f.a.scope,{request_id:f.request.id});assert.equal(e.recommended_destination_id,'fragile-destination');
 f.choose();const q=f.quote(),route=q.quote.details.return_destination;assert.equal(route.destination_id,'fragile-destination');
 assert.equal(route.handling_fee_estimate_minor,'150');assert.deepEqual(route.required_handling,['fragile','standard']);assert.equal(route.expected_disposition,'inspect_then_restock');
 assert.equal(q.quote.amount_minor,'500');assert.equal(q.quote.details.route_cost_estimate.total_minor,'650');
 const op=f.authorizeFulfillment(q),result=await f.execution.dispatch(f.a.scope,op.id);assert.equal(result.state,'purchased');
 const label=await f.fulfillmentSource.label(result.native_id!);assert.equal(label.return_destination.destination_id,'fragile-destination');assert.equal(label.amount_minor,'500');
 assert.equal(f.fulfillmentSource.effects().length,1);assert.equal(f.native.admissions().length,1);assert.equal(f.native.admissions()[0].quantity,3);assert.equal(f.native.admissions()[0].label_id,result.native_id);
}));
test('CASE-M06-G12-02',()=>usingQualifiedDestinations(f=>{
 const e=f.routing.evaluate(f.a.scope,{request_id:f.request.id});assert.deepEqual(e.destinations.filter((d:any)=>d.eligible).map((d:any)=>d.destination_id),f.golden.expected.eligible_destination_ids);
 for(const [destination_id,reasons] of Object.entries(f.golden.expected.rejections)){
  assert.deepEqual(e.destinations.find((d:any)=>d.destination_id===destination_id).reasons,reasons);
  assert.throws(()=>f.choose(destination_id),/DESTINATION_INELIGIBLE/);
 }
 assert.equal(f.fulfillmentSource.calls.buy,0);assert.equal(f.fulfillmentSource.effects().length,0);assert.equal(f.native.admissions().length,0);
}));
test('CASE-M06-G12-03',()=>usingQualifiedDestinations(f=>{
 f.choose();const q=f.quote();f.reviseDestination('fragile-destination',{enabled:false});
 assert.throws(()=>f.gateway.prepare(f.a.scope,q.proposal),/DESTINATION_CHANGED|DESTINATION_INELIGIBLE/);assert.equal(f.fulfillmentSource.calls.buy,0);assert.equal(f.fulfillmentSource.effects().length,0);
}));
test('M06-G12-REVOKED-AFTER-APPROVAL-BLOCKS-CORE-DISPATCH',()=>usingQualifiedDestinations(async f=>{
 f.choose();const op=f.authorizeFulfillment(f.quote());f.reviseDestination('fragile-destination',{enabled:false});
 await assert.rejects(()=>f.execution.dispatch(f.a.scope,op.id),/DESTINATION_CHANGED|DESTINATION_INELIGIBLE/);assert.equal(f.execution.read(f.a.scope,op.id).state,'authorized');assert.equal(f.fulfillmentSource.calls.buy,0);
}));
test('M06-G12-REVOKED-AFTER-APPROVAL-BLOCKS-NATIVE-PURCHASE',()=>usingQualifiedDestinations(async f=>{
 f.choose();const op=f.authorizeFulfillment(f.quote());f.reviseDestination('fragile-destination',{ownership:'uncontracted',agreement_id:null});
 await assert.rejects(()=>f.fulfillmentSource.buy(f.command(op.id)),/DESTINATION_CHANGED|DESTINATION_INELIGIBLE/);assert.equal(f.fulfillmentSource.effects().length,0);assert.equal(f.native.admissions().length,0);
}));
test('M06-G12-OPTIONAL-ROUTING-METADATA-STRIPPING-FAILS-CLOSED',()=>usingQualifiedDestinations(async f=>{
 f.choose();const op=f.authorizeFulfillment(f.quote()),command=f.command(op.id);delete command.return_destination;delete command.rate.return_destination;
 await assert.rejects(()=>f.fulfillmentSource.buy(command),/DESTINATION_BINDING_REQUIRED|DESTINATION_CHANGED/);assert.equal(f.fulfillmentSource.effects().length,0);assert.equal(f.native.admissions().length,0);
}));
test('M06-G12-UNREGISTERED-REQUEST-CANNOT-BYPASS-QUALIFIED-ACCOUNT',()=>usingQualifiedDestinations(async f=>{
 f.choose();const op=f.authorizeFulfillment(f.quote()),command=f.command(op.id);delete command.return_destination;delete command.rate.return_destination;
 command.request_id='different-request';command.resource_id='different-resource';command.native_return_id='gid://shopify/Return/1234';command.obligation='different-request_label_1';
 await assert.rejects(()=>f.fulfillmentSource.buy(command),/DESTINATION_BINDING_REQUIRED/);assert.equal(f.fulfillmentSource.effects().length,0);
}));
test('M06-G12-RECOMPUTED-RATE-HASH-CANNOT-BYPASS-NATIVE-ROUTING',()=>usingQualifiedDestinations(async f=>{
 f.choose();const op=f.authorizeFulfillment(f.quote()),command=f.command(op.id);delete command.return_destination;delete command.rate.return_destination;
 const {rate_id,...body}=command.rate;command.rate.rate_id='rate_'+contentDigest(body).slice(0,40);
 await assert.rejects(()=>f.fulfillmentSource.buy(command),/DESTINATION_BINDING_REQUIRED/);assert.equal(f.fulfillmentSource.effects().length,0);assert.equal(f.native.admissions().length,0);
}));
test('M06-G12-CAPACITY-EXHAUSTION-INVALIDATES-QUOTE',()=>usingQualifiedDestinations(f=>{
 f.choose();const q=f.quote();f.reviseDestination('fragile-destination',{capacity_units:3,occupied_units:1});
 assert.throws(()=>f.gateway.prepare(f.a.scope,q.proposal),/DESTINATION_CHANGED|DESTINATION_INELIGIBLE/);assert.equal(f.fulfillmentSource.effects().length,0);
}));
test('M06-G12-NATIVE-ITEM-AND-REGION-CHANGES-INVALIDATE-ROUTE',()=>usingQualifiedDestinations(f=>{
 f.choose();const q=f.quote();f.native.recordRequest({...f.sourceRequest,revision:2,region:'US-AK',items:f.sourceRequest.items.map((i:any)=>({...i,category:'hazardous'}))});
 assert.throws(()=>f.gateway.prepare(f.a.scope,q.proposal),/DESTINATION_BINDING_CHANGED/);assert.equal(f.fulfillmentSource.effects().length,0);
}));
test('M06-G12-SOURCE-ORIGINAL-ITEM-MISMATCH-IS-REJECTED',()=>usingQualifiedDestinations(f=>{
 assert.throws(()=>f.native.recordRequest({...f.sourceRequest,revision:2,items:f.sourceRequest.items.map((i:any)=>({...i,item_id:'other-item'}))}),/DESTINATION_ORIGINAL_ITEMS_IMMUTABLE/);
 assert.equal(f.fulfillmentSource.effects().length,0);
}));
test('M06-G12-HANDLING-FEE-CHANGE-INVALIDATES-LABEL-QUOTE',()=>usingQualifiedDestinations(f=>{
 f.choose();const q=f.quote();f.reviseDestination('fragile-destination',{handling_fee_estimate_minor:'175'});
 assert.throws(()=>f.gateway.prepare(f.a.scope,q.proposal),/DESTINATION_CHANGED/);assert.equal(f.fulfillmentSource.effects().length,0);
}));
test('M06-G12-POLICY-RESTRICTIONS-CANNOT-GRANT-DESTINATION-AUTHORITY',()=>usingQualifiedDestinations(f=>{
 f.routing.configure(f.owner.scope,{...f.policy,expected_revision:1,policy_version:2,allowed_destination_ids:['cheap-uncontracted']});
 const e=f.routing.evaluate(f.a.scope,{request_id:f.request.id});assert.equal(e.state,'needs_review');assert.equal(e.recommended_destination_id,null);assert.throws(()=>f.choose('cheap-uncontracted'),/DESTINATION_INELIGIBLE/);
 assert.throws(()=>f.quote(),/DESTINATION_SELECTION_REQUIRED/);assert.equal(f.fulfillmentSource.effects().length,0);
}));
test('M06-G12-POLICY-REVISION-INVALIDATES-PRIOR-APPROVAL',()=>usingQualifiedDestinations(async f=>{
 f.choose();const op=f.authorizeFulfillment(f.quote());f.routing.configure(f.owner.scope,{...f.policy,expected_revision:1,policy_version:2,allowed_destination_ids:['alternate-destination']});
 await assert.rejects(()=>f.execution.dispatch(f.a.scope,op.id),/DESTINATION_POLICY_CHANGED/);await assert.rejects(()=>f.fulfillmentSource.buy(f.command(op.id)),/DESTINATION_POLICY_CHANGED|DESTINATION_CHANGED/);assert.equal(f.fulfillmentSource.effects().length,0);
}));
test('M06-G12-NATIVE-QUALIFICATION-EXPIRY-BLOCKS-NEW-PURCHASE',()=>usingQualifiedDestinations(async f=>{
 f.choose();const op=f.authorizeFulfillment(f.quote());f.native.qualify({...f.qualification,revision:2,expires_at:f.now()+1});f.advance(1);
 await assert.rejects(()=>f.fulfillmentSource.buy(f.command(op.id)),/DESTINATION_QUALIFICATION_EXPIRED/);assert.equal(f.fulfillmentSource.effects().length,0);
}));
test('M06-G12-MISSING-NATIVE-CAPABILITY-BLOCKS-ROUTING',()=>usingQualifiedDestinations(f=>{
 f.native.qualify({...f.qualification,revision:2,capabilities:f.qualification.capabilities.filter((v:string)=>v!=='native_label_destination')});
 assert.throws(()=>f.routing.evaluate(f.a.scope,{request_id:f.request.id}),/DESTINATION_CAPABILITY_UNQUALIFIED/);assert.equal(f.fulfillmentSource.calls.buy,0);
}));
test('M06-G12-UNKNOWN-PURCHASE-RECONCILES-ORIGINAL-AFTER-REVOCATION',()=>usingQualifiedDestinations(async f=>{
 f.choose();const op=f.authorizeFulfillment(f.quote());f.fulfillmentSource.fault='after';assert.equal((await f.execution.dispatch(f.a.scope,op.id)).state,'unknown');
 f.reviseDestination('fragile-destination',{enabled:false});f.native.qualify({...f.qualification,revision:2,enabled:false});
 const reopenedDb=new DatabaseSync(f.sourceFile);try{
  const source=new FulfillmentFixtureSource(reopenedDb,{mode:'fixture',identity:'fulfillment-one',tenant:f.a.tenant,store:f.a.store,clock:f.now}),execution=new FulfillmentExecution(f.kernel,source);
  assert.equal((await execution.dispatch(f.a.scope,op.id)).state,'unknown');assert.equal(source.calls.buy,0);
  const result=await execution.reconcile(f.a.scope,op.id);assert.equal(result.state,'purchased');assert.equal(source.effects().length,1);assert.equal(source.destinations.admissions().length,1);assert.equal(source.calls.buy,0);
 }finally{reopenedDb.close();}
}));
test('M06-G12-MANUAL-PARCEL-DESTINATION-EDIT-CANNOT-BYPASS-SELECTION',()=>usingQualifiedDestinations(f=>{
 f.choose();f.labels.configureParcel(f.owner.scope,{...f.parcelInput,expected_revision:2,to_address_ref:'cheap-address',address_revision:3});
 assert.throws(()=>f.quote(),/DESTINATION_PARCEL_CHANGED/);assert.equal(f.fulfillmentSource.calls.rate,0);assert.equal(f.fulfillmentSource.effects().length,0);
}));
test('M06-G12-ROUTING-RECHECKS-TENANT-AND-AUTHORITY',()=>usingQualifiedDestinations(f=>{
 assert.throws(()=>f.routing.evaluate(f.b.scope,{request_id:f.request.id}),/NOT_FOUND/);
 assert.throws(()=>f.routing.select(f.customer,{request_id:f.request.id,destination_id:'fragile-destination',expected_revision:0}),/ACCESS_DENIED/);
 assert.throws(()=>f.routing.configure(f.customer,{...f.policy,expected_revision:1}),/ACCESS_DENIED/);
 f.kernel.revoke(f.a.scope);assert.throws(()=>f.routing.evaluate(f.a.scope,{request_id:f.request.id}),/ACCESS_DENIED/);assert.equal(f.fulfillmentSource.effects().length,0);
}));
test('M06-G12-NATIVE-SOURCE-MUST-BE-SEPARATE-FROM-CORE',()=>usingQualifiedDestinations(f=>{
 const source=new FulfillmentFixtureSource(f.db,{mode:'fixture',identity:'unsafe-core-source',tenant:f.a.tenant,store:f.a.store,clock:f.now});
 assert.throws(()=>new QualifiedReturnDestinations(f.kernel,source),/SEPARATE_FIXTURE_SOURCE_REQUIRED/);
}));
test('M06-G12-LEGACY-UNCONFIGURED-LABELS-RETAIN-EXISTING-BEHAVIOR',()=>usingFulfillment(async f=>{
 const q=f.labels.quote(f.a.scope,{request_id:f.request.id,replaces:null});assert.equal(Object.hasOwn(q.quote.details,'return_destination'),false);
 const op=f.authorizeFulfillment(q);assert.equal((await f.execution.dispatch(f.a.scope,op.id)).state,'purchased');assert.equal(f.fulfillmentSource.effects().length,1);assert.equal(f.fulfillmentSource.destinations.admissions().length,0);
}));
