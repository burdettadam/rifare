import test from 'node:test';import assert from 'node:assert/strict';
import {usingQualifiedDestinations} from './qualified-destinations-helpers.mts';import {ReturnPolicyPacks} from '../../packages/commerce/return-policy-packs.mts';
function pack(f:any,allowed=['fragile-destination']){const c=f.cases.resume(f.a.scope,f.request.case_id),p=new ReturnPolicyPacks(f.kernel,f.caps,f.routing);p.put(f.owner.scope,{id:'native_route_pack',expected_revision:0,profile_id:c.pins.profile.id,policy_id:c.pins.policy.policy_id,required_capabilities:['order.read'],routing:{required:true,allowed_destination_ids:allowed},review:{mode:'specialist',always_review:true}});const request=f.db.prepare('SELECT body FROM commerce_return_requests WHERE id=?').get(f.request.id);return {p,input:{pack_id:'native_route_pack',selection:JSON.parse(request.body).selection,request_id:f.request.id}};}
test('M06-G14-REAL-QUALIFIED-DESTINATION-CONTRIBUTES-READINESS-WITHOUT-REAUTHORIZATION',()=>usingQualifiedDestinations(f=>{
 const {p,input}=pack(f),r=p.evaluate(f.a.scope,input);assert.equal(r.readiness.ready,true);assert.deepEqual(r.routing.eligible.map((d:any)=>d.destination_id),['fragile-destination']);assert.match(r.routing.source_snapshot,/^[a-f0-9]{64}$/);assert.equal(r.eligibility_basis,'new_selection_with_existing_request_reserved');assert.equal(r.return_request.original_quote_decision.decision,'allow');assert.equal(r.return_request.basis,'historical_original_quote_not_reauthorization');assert.equal(r.execution_authorized,false);assert.equal(f.fulfillmentDb.prepare('SELECT count(*) n FROM fixture_effects').get()!.n,0);
}));
test('M06-G14-PACK-DESTINATION-LIST-CANNOT-QUALIFY-UNCONTRACTED-DESTINATION',()=>usingQualifiedDestinations(f=>{
 const {p,input}=pack(f,['cheap-uncontracted']),r=p.evaluate(f.a.scope,input);assert.equal(r.readiness.ready,false);assert.deepEqual(r.readiness.missing_capabilities,['return.destination']);assert.deepEqual(r.routing.eligible,[]);
}));
test('M06-G14-REQUEST-AND-SELECTION-MUST-REFER-TO-THE-SAME-ITEMS',()=>usingQualifiedDestinations(f=>{
 const {p,input}=pack(f);assert.throws(()=>p.evaluate(f.a.scope,{...input,selection:{...input.selection,lines:[input.selection.lines[0]]}}),/PACK_REQUEST_MISMATCH/);
}));
test('M06-G14-PACK-READINESS-CHANGES-WHEN-NATIVE-DESTINATION-IS-REVOKED',()=>usingQualifiedDestinations(f=>{
 const {p,input}=pack(f),before=p.evaluate(f.a.scope,input);f.reviseDestination('fragile-destination',{enabled:false});const after=p.evaluate(f.a.scope,input);assert.equal(before.readiness.ready,true);assert.equal(after.readiness.ready,false);assert.notEqual(before.routing.source_snapshot,after.routing.source_snapshot);assert.deepEqual(after.eligibility,before.eligibility);
}));
