import test from 'node:test';import assert from 'node:assert/strict';
import {usingReturns} from './return-intake-helpers.mts';
import {usingPrevention} from './prevention-helpers.mts';
import {usingQualifiedDestinations} from './qualified-destinations-helpers.mts';
import {usingPolicyPack} from './return-policy-pack-helpers.mts';
import {withDepthServer} from './return-depth-test-helpers.mts';
import {SupportMetrics} from '../../packages/commerce/support-metrics.mts';
test('M06-G11-HTTP-ASSESSMENT-REVIEW-AND-NEUTRAL-CUSTOMER-APPEAL',()=>usingReturns(f=>withDepthServer(f,{},async post=>{
 const q=f.quote(),a=await post('risk/assess',{case_id:'case_one',quote_id:q.id,model:{accusation:'PRIVATE_UNSUPPORTED_FRAUD',deny_all:true}});
 assert.equal(a.status,200);assert.equal(a.body.assessment.model.status,'rejected_untrusted_proposal');assert.equal(a.body.assessment.automatic_denial,false);assert.equal(JSON.stringify(a.body).includes('PRIVATE_UNSUPPORTED_FRAUD'),false);
 const review={assessment_id:a.body.assessment_id,assessment_digest:a.body.digest,action:'request_evidence',reason:'photo_unclear',expires_at:null};
 assert.equal((await post('risk/review',review)).status,403);assert.equal((await post('risk/review',review,f.reviewer.bearer)).status,200);
 const read=await post('risk/read',{case_id:'case_one',assessment_id:null},f.customerBearer);assert.equal(read.status,200);assert.equal(read.body.assessment,undefined);assert.equal(read.body.evidence_requests[0].reason,'photo_unclear');
 const appeal=await post('risk/appeal',{assessment_id:a.body.assessment_id,reason:'request_human',evidence_ids:[]},f.customerBearer);assert.equal(appeal.body.status,'human_review_requested');assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_action_receipts').get()!.n,0);
})));
test('M06-G11-HTTP-SCOPE-STRICT-INPUT-AND-SAFE-LOGS',()=>usingReturns(f=>withDepthServer(f,{},async(post,app)=>{
 const q=f.quote(),input={case_id:'case_one',quote_id:q.id,model:null};assert.equal((await post('risk/assess',input,null)).status,403);
 assert.equal((await post('risk/assess',{...input,approved:true})).status,400);assert.equal((await post('risk/assess',input,f.b.bearer)).status,404);
 const a=await post('risk/assess',input);assert.equal((await post('risk/appeal',{assessment_id:a.body.assessment_id,reason:'request_human',evidence_ids:[]})).body.error,'CUSTOMER_VERIFICATION_REQUIRED');
 for(const secret of [f.a.bearer,f.customerBearer,f.order().customer_id,q.id])assert.equal(JSON.stringify(app.logs).includes(secret),false);
})));
test('M06-G12-HTTP-QUALIFIED-EVALUATION-AND-SELECTION-PURCHASE-NOTHING',()=>usingQualifiedDestinations(f=>withDepthServer(f,{fulfillmentSource:f.fulfillmentSource},async post=>{
 const e=await post('destinations/evaluate',{request_id:f.request.id});assert.equal(e.status,200);assert.equal(e.body.recommended_destination_id,'fragile-destination');assert.equal(e.body.destinations.find((d:any)=>d.destination_id==='cheap-uncontracted').eligible,false);
 const p={request_id:f.request.id,destination_id:'fragile-destination',expected_revision:0};assert.equal((await post('destinations/select',p)).status,403);const selected=await post('destinations/select',p,f.owner.bearer);assert.equal(selected.status,200);assert.equal(selected.body.route.handling_fee_estimate_minor,'150');assert.equal(selected.body.execution_authorized,false);
 const read=await post('destinations/read',{request_id:f.request.id});assert.equal(read.body.selection.revision,1);assert.equal(f.fulfillmentDb.prepare('SELECT count(*) n FROM fixture_effects').get()!.n,0);
})));
test('M06-G12-HTTP-NO-NATIVE-QUALIFICATION-ADMINISTRATION',()=>usingQualifiedDestinations(f=>withDepthServer(f,{fulfillmentSource:f.fulfillmentSource},async post=>{
 for(const op of ['destinations/qualify','destinations/record-destination','destinations/record-request'])assert.equal((await post(op,{},f.owner.bearer)).status,404);
 assert.equal((await post('destinations/select',{request_id:f.request.id,destination_id:'cheap-uncontracted',expected_revision:0},f.owner.bearer)).body.error,'DESTINATION_INELIGIBLE');
 assert.equal((await post('destinations/evaluate',{request_id:f.request.id},f.b.bearer)).status,404);
})));
test('M06-G12-HTTP-MISSING-NATIVE-SOURCE-REMAINS-UNAVAILABLE',()=>usingReturns(f=>withDepthServer(f,{},async post=>{assert.deepEqual(await post('destinations/evaluate',{request_id:'missing'}),{status:503,body:{error:'ADAPTER_UNAVAILABLE'}});})));
test('M06-G13-HTTP-CUSTOMER-CONFIRMATION-IS-SEPARATE-FROM-STAFF-APPROVAL',()=>usingPrevention(f=>withDepthServer(f,{orderEditSource:f.native},async post=>{
 f.analyze();const before=f.native.order(f.original.id),p=await post('prevention/preview',{case_id:'case_one',intent:{kind:'item',line_id:'line_one',variant_id:'equal',address:null}});assert.equal(p.status,200);assert.equal(p.body.preview.new_total_minor,'4000');
 const confirm={case_id:'case_one',quote_id:p.body.quote_id,quote_digest:p.body.quote_digest};assert.equal((await post('prevention/confirm',confirm)).body.error,'CUSTOMER_VERIFICATION_REQUIRED');
 assert.equal((await post('prevention/confirm',{...confirm,customer_confirmed:true},f.customerBearer)).status,400);
 const yes=await post('prevention/confirm',confirm,f.customerBearer);assert.equal(yes.status,200);assert.equal(yes.body.confirmed,true);assert.equal(yes.body.paid_goods_changed,false);assert.equal(JSON.stringify(yes.body).includes('session_hash'),false);assert.deepEqual(f.native.order(f.original.id),before);
 const read=await post('prevention/read',{case_id:'case_one'});assert.equal(read.body.previews[0].confirmed,true);
 assert.equal((await post('prevention/revoke',{case_id:'case_one',quote_id:p.body.quote_id},f.customerBearer)).body.revoked,true);assert.equal(f.sourceDb.prepare('SELECT count(*) n FROM edit_source_effects').get()!.n,0);
})));
test('M06-G13-HTTP-CANNOT-MANUFACTURE-NATIVE-CONSENT-OR-COHORT-OUTCOMES',()=>usingPrevention(f=>withDepthServer(f,{orderEditSource:f.native},async post=>{
 for(const op of ['prevention/native-consent','prevention/record-outcome','prevention/fixture-outcome'])assert.equal((await post(op,{confirmed:true},f.owner.bearer)).status,404);
 assert.equal((await post('prevention/read',{case_id:'case_one'},f.b.bearer)).status,404);assert.equal((await post('prevention/approve',{id:f.draft.id,version:f.draft.version,digest:f.draft.digest},f.customerBearer)).status,403);
})));
test('M06-G14-HTTP-PACK-EVALUATION-REUSES-REAL-POLICY',()=>usingPolicyPack(f=>withDepthServer(f,{},async post=>{
 const r=await post('packs/evaluate',{pack_id:f.packId,selection:f.selection(),request_id:null});assert.equal(r.status,200);assert.deepEqual(r.body.eligibility,f.evaluate().eligibility);assert.equal(r.body.action_approval,'separate_reviewer_required');assert.equal(r.body.execution_authorized,false);
 assert.equal((await post('packs/get',{pack_id:f.packId,revision:null},f.customerBearer)).status,403);assert.equal((await post('packs/get',{pack_id:f.packId,revision:1},f.b.bearer)).status,404);assert.equal((await post('packs/put',{...f.packInput,expected_revision:1})).status,403);
})));
test('M06-G99-HTTP-COST-REPORT-PRESERVES-UNKNOWN-COSTS',()=>usingReturns(f=>withDepthServer(f,{},async post=>{
 new SupportMetrics(f.kernel).freeze(f.owner.scope,{id:'http_costs',case_ids:['case_one'],starts_at:f.now(),ends_at:f.now()+60000});const r=await post('economics/report',{cohort_id:'http_costs'});assert.equal(r.status,200);assert.equal(r.body.denominator,1);assert.equal(r.body.declared_total_cost_minor,null);assert.equal(r.body.declared_contribution_minor,null);assert.equal(r.body.profitability_established,false);assert.equal((await post('economics/report',{cohort_id:'http_costs'},f.customerBearer)).status,403);
})));
