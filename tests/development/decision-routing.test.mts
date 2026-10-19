import test from 'node:test';
import assert from 'node:assert/strict';
import {usingRouting,routingFixtureFile,numericCohort} from './decision-routing-helpers.mts';
import {contentDigest} from '../../packages/commerce/configuration-values.mts';
import {validateRoutingProtocol,routingIdentity,scoreRoutingProtocol,assessRoutingMilestone} from '../../packages/agent/decision-calibration.mts';
import {SupportOwnership} from '../../packages/commerce/support-core.mts';
import {ExecutionStops} from '../../packages/commerce/execution-stops.mts';
import {PrivacyLifecycle} from '../../packages/commerce/privacy-lifecycle.mts';
import {verifyDecisionReceipt} from '../../packages/commerce/decision-shadow.mts';

test('CASE-M14-G01-01',()=>usingRouting(f=>{
 const p=f.freeze();assert.equal(p.body.protocol.baseline,'manual_review');assert.equal(p.body.protocol.calibration.minimum_calibration,60);
 assert.equal(p.body.protocol.calibration.minimum_held_out,60);assert.equal(p.body.protocol.canary.required_when_revision_unknown,true);
 assert.equal(p.body.protocol.cases.length,12);assert.equal(p.body.qualification_identity,routingIdentity(p.body.pins,p.body.protocol));assert.equal(f.requests.length,0);
 const full=f.freeze(f.ref,{protocol:numericCohort().protocol}),stored=f.db.prepare("SELECT body FROM commerce_support_documents WHERE kind='decision_protocols' AND id=?").get(full.id);
 assert.equal(full.body.protocol.cases.length,120);assert.ok(Buffer.byteLength(stored.body)<32768);assert.equal(full.body.protocol_digest,contentDigest(full.body.protocol));
}));
test('CASE-M14-G01-02',()=>usingRouting(f=>{
 const p=f.freeze(),identity=p.body.qualification_identity;
 for(const key of ['question_set_digest','question_resource_digest','profile_digest','preprocessing_version','reader_configuration_digest','confidence_semantics','model_revision']){
  const pins={...p.body.pins,[key]:key.endsWith('digest')?'b'.repeat(64):'material_change'};assert.notEqual(routingIdentity(pins,p.body.protocol),identity,key);
 }
 const changed=structuredClone(p.body.protocol);changed.calibration.candidates=[0.9,0.95];assert.notEqual(routingIdentity(p.body.pins,changed),identity);
}));
test('CASE-M14-G01-03',()=>usingRouting(f=>{
 const p=f.protocol();p.vocabulary.reported_problem.push('approve_refund');assert.throws(()=>f.freeze(f.ref,{protocol:p}),/ROUTING_PROTOCOL_INVALID/);
 const q=f.qualification();f.shadow.configure(f.owner.scope,{id:f.ref,expected_version:2,enabled:true,expires_at:f.now()+3600000});
 assert.throws(()=>f.stage(q),/ROUTING_CONFIGURATION_CHANGED/);assert.equal(f.requests.length,0);
}));
test('CASE-M14-G01-04',()=>{
 const {protocol,rows}=numericCohort(),r=scoreRoutingProtocol(protocol,rows),oracle=routingFixtureFile('oracles.v1').adequate_numeric_cohort;
 assert.equal(r.calibration.denominator,oracle.calibration);assert.equal(r.held_out.denominator,oracle.held_out);assert.equal(r.selected_threshold,oracle.selected_threshold);
 assert.equal(r.held_out.correctly_routed,30);assert.equal(r.held_out.correctly_reviewed,30);assert.equal(r.held_out.wrongly_routed,0);assert.ok(r.held_out.wrong_route_upper<oracle.maximum_wrong_route_upper);assert.equal(r.numeric_passed,true);assert.equal(r.authorizes_routing,false);assert.equal(r.cohort_complete,true);assert.equal(r.numeric_status,'passed');
 const short=scoreRoutingProtocol(routingFixtureFile('protocol.v1'),[]);assert.equal(short.calibration.denominator,6);assert.equal(short.held_out.denominator,6);assert.equal(short.numeric_passed,false);assert.equal(short.missing_cases,12);assert.equal(short.cohort_complete,false);assert.equal(short.numeric_status,'pending');
 assert.throws(()=>scoreRoutingProtocol(protocol,[...rows,rows[0]]),/ROUTING_OBSERVATIONS_INVALID/);
 const constants=routingFixtureFile('oracles.v1').wilson_one_sided_95;assert.ok(Math.abs(r.held_out.wrong_route_upper-constants.zero_wrong_of_30)<1e-12);
 const wrong=structuredClone(rows),heldClear=protocol.cases.find((x:any)=>x.role==='held_out'&&x.stratum==='clear');wrong.find((x:any)=>x.id===heldClear.id).labels={reported_problem:'size_fit',requested_resolution:'exchange'};
 const error=scoreRoutingProtocol(protocol,wrong);assert.equal(error.held_out.wrongly_routed,1);assert.ok(Math.abs(error.held_out.wrong_route_upper-constants.one_wrong_of_30)<1e-12);assert.equal(error.numeric_passed,false);assert.ok(error.held_out.wrong_route_rate<0.05);assert.equal(error.cohort_complete,true);assert.equal(error.numeric_status,'measured_failure');
 const select=structuredClone(rows);for(const stratum of ['mixed','unknown']){const ref=protocol.cases.find((x:any)=>x.role==='calibration'&&x.stratum===stratum).id;Object.assign(select.find((x:any)=>x.id===ref),{labels:{reported_problem:'damaged',requested_resolution:'refund'},probability:0.85});}
 assert.equal(scoreRoutingProtocol(protocol,select).selected_threshold,0.9);
 const missing=scoreRoutingProtocol(protocol,rows.slice(0,-1));assert.equal(missing.held_out.denominator,60);assert.equal(missing.held_out.unavailable,1);assert.equal(missing.numeric_passed,false);assert.equal(missing.cohort_complete,false);assert.equal(missing.numeric_status,'pending');
 const malformed=structuredClone(rows);Object.assign(malformed.find((x:any)=>x.id===heldClear.id),{status:'malformed',labels:null,probability:null});const broken=scoreRoutingProtocol(protocol,malformed);assert.equal(broken.held_out.malformed,1);assert.equal(broken.held_out.denominator,60);assert.equal(broken.numeric_passed,false);

});
test('M14-G02-PREP-01',()=>usingRouting(async f=>{
 const p=f.freeze();f.advance(1);const observed=await f.shadow.run(f.a.scope,f.input());
 const q=f.routing.measure(f.owner.scope,{id:'measured_fixture',expected_version:0,protocol_id:p.id,protocol_version:1,observations:[{id:'calibration_clear',case_id:f.caseA.id,observation_id:observed.id}]});
 assert.equal(q.body.report.fixture_observations,1);assert.equal(q.body.report.live_observations,0);assert.equal(q.body.report.status,'pending');assert.equal(q.body.report.missing_cases,11);
 assert.equal(q.body.report.eligible_for_scoped_routing,false);assert.equal(q.body.report.measured_cost,null);assert.equal(q.body.report.measured_latency,null);
 assert.equal(JSON.stringify(q.body).includes(f.caseA.id),false);assert.equal(JSON.stringify(q.body).includes(observed.id),false);
}));
test('M14-G02-PREP-02',()=>usingRouting(async f=>{
 const old=await f.shadow.run(f.a.scope,f.input()),p=f.freeze(),input={id:'invalid_measurement',expected_version:0,protocol_id:p.id,protocol_version:1,observations:[{id:'calibration_clear',case_id:f.caseA.id,observation_id:old.id}]};
 assert.throws(()=>f.routing.measure(f.owner.scope,input),/ROUTING_PROTOCOL_NOT_FROZEN/);
 f.advance(1);const r=await f.shadow.run(f.a.scope,f.input());input.observations[0].observation_id=r.id;
 assert.throws(()=>f.routing.measure(f.owner.scope,{...input,observations:[...input.observations,...input.observations]}),/ROUTING_OBSERVATIONS_INVALID/);
 assert.throws(()=>f.routing.measure(f.owner.scope,{...input,observations:[...input.observations,{...input.observations[0],id:'calibration_mixed'}]}),/ROUTING_OBSERVATIONS_INVALID/);
 assert.throws(()=>f.routing.measure(f.owner.scope,{...input,evidence_kind:'live_test_unqualified'}),/INVALID_INPUT/);
 f.message('Source correction after the frozen cohort.');const changed=await f.shadow.run(f.a.scope,f.input());input.observations[0].observation_id=changed.id;
 assert.throws(()=>f.routing.measure(f.owner.scope,input),/ROUTING_COHORT_MISMATCH/);
 f.conversations.link(f.a.scope,f.customer,{case_id:f.caseA.id,channel:'webchat',account_id:'shadow_channel_a',external_id:'shadow_thread_a',history:'partial',source_revision:2});
 const partial=f.freeze();f.advance(1);const partialObservation=await f.shadow.run(f.a.scope,f.input());assert.equal(partialObservation.result.status,'usable');assert.ok(partialObservation.gaps.includes('conversation_history_partial'));
 const partialReport=f.routing.measure(f.owner.scope,{id:'partial_measurement',expected_version:0,protocol_id:partial.id,protocol_version:partial.version,observations:[{id:'calibration_clear',case_id:f.caseA.id,observation_id:partialObservation.id}]}).body.report;
 assert.equal(partialReport.calibration.denominator,6);assert.equal(partialReport.calibration.unavailable,6);assert.equal(partialReport.calibration.routed,0);assert.equal(partialReport.distributions.reported_problem.samples,0);
 const canaryProtocol=f.protocol();canaryProtocol.cases[0].source_text_hash=contentDigest(['independent_partial_calibration']);canaryProtocol.cases.find((r:any)=>r.id==='held_out_clear').source_text_hash=partialObservation.submitted_text_hash;
 const canaryFrozen=f.freeze(f.ref,{protocol:canaryProtocol}),canaryQualification=f.qualification(f.ref,[],canaryFrozen);f.advance(1);const canaryObservation=await f.shadow.run(f.a.scope,f.input());
 const canary=f.routing.recordCanary(f.owner.scope,{qualification_id:canaryQualification.id,qualification_version:canaryQualification.version,expected_version:0,observations:[{id:'held_out_clear',case_id:f.caseA.id,observation_id:canaryObservation.id}]});
 assert.equal(canary.body.passed,false);assert.equal(canary.body.unavailable_observations,1);
}));
test('M14-G02-PREP-03',()=>usingRouting(f=>{
 const q=f.qualification();assert.equal(q.body.report.eligible_for_scoped_routing,false);
 q.body.report.eligible_for_scoped_routing=true;q.body.report.live_observations=120;q.body.report.fixture_observations=0;
 assert.throws(()=>f.stage(q,{mode:'scoped'}),/ROUTING_QUALIFICATION_PENDING/);assert.equal(f.db.prepare("SELECT count(*) n FROM commerce_support_documents WHERE kind='decision_active'").get().n,0);
 assert.equal(f.intake.form(f.customer,f.caseA.id).financial_effect,false);
}));
test('M14-G02-PREP-04',()=>usingRouting(f=>{
 const q=f.qualification();assert.equal(q.body.report.missing_cases,12);assert.ok(q.body.report.pending.includes('approved_live_backend_observations'));
 const p=f.stage(q);assert.equal(p.body.mode,'diagnostic');assert.equal(f.requests.length,0);assert.equal(f.systemRequests.length,0);
}));
test('CASE-M14-G03-01',()=>usingRouting(async f=>{
 const {p}=f.bootstrap(),unrelated=f.publishedRule('queue_tracking'),before=f.business(),r=await f.routing.run(f.a.scope,f.routeInput());
 const oracle=routingFixtureFile('oracles.v1').route;assert.equal(r.outcome,oracle.outcome);assert.equal(r.action,oracle.action);assert.equal(r.mode,oracle.mode);assert.equal(r.business_effects,0);assert.equal(r.case_resolution_qualified,false);
 assert.deepEqual(f.business(),before);assert.equal(r.publication_version,p.version);assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_support_rule_jobs WHERE rule_id=?').get(unrelated.id).n,0);
 assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_support_rule_jobs').get().n,1);assert.equal(f.rules.job(f.a.scope,r.rule_job_id).state,'completed');assert.equal(f.requests.length,1);
}));
test('CASE-M14-G03-02',async()=>{
 for(const cause of ['qualification','stop','source','activation'])await usingRouting(async f=>{
  const {q,p}=f.bootstrap();f.before(()=>{if(cause==='qualification')f.routing.revokeQualification(f.owner.scope,q.id,q.version);else if(cause==='stop')new ExecutionStops(f.kernel).set(f.owner.scope,{action:'model.run',stopped:true,reason:'incident',expected_revision:0});else if(cause==='activation'){f.routing.disable(f.owner.scope,'return_route',1);f.routing.publish(f.owner.scope,{id:p.id,version:p.version,expected_revision:1,case_id:f.caseA.id,task_id:f.taskA.id});}else f.message('Late evidence correction.');});
  await assert.rejects(()=>f.routing.run(f.a.scope,f.routeInput()),/CONFIGURATION_UNAVAILABLE|EXECUTION_STOPPED|EVIDENCE_CHANGED|ROUTING_PUBLICATION_CHANGED/);
  if(cause==='activation')assert.equal(f.routing.active(f.owner.scope,'return_route').revision,2);
  assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_support_rule_jobs').get().n,0);assert.equal(f.intake.form(f.customer,f.caseA.id).financial_effect,false);
 });
});
test('CASE-M14-G03-03',()=>usingRouting(async f=>{
 f.bootstrap();const ownership=new SupportOwnership(f.kernel),generation=ownership.inspect(f.a.scope,f.caseA.id).generation;
 f.before(()=>ownership.takeover(f.a.scope,{case_id:f.caseA.id,expected_generation:generation,reason:'operator_requested'}));
 await assert.rejects(()=>f.routing.run(f.a.scope,f.routeInput()),/OWNERSHIP_CHANGED/);assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_support_rule_jobs').get().n,0);
 assert.equal(ownership.inspect(f.a.scope,f.caseA.id).generation,generation+1);assert.equal(f.intake.form(f.customer,f.caseA.id).financial_effect,false);
}));
test('CASE-M14-G03-04',()=>usingRouting(async f=>{
 f.bootstrap();const input=f.routeInput(),r=await f.routing.run(f.a.scope,input);assert.notEqual(r.id,r.observation_id);assert.deepEqual(await f.routing.run(f.a.scope,input),r);assert.equal(f.requests.length,1);
 const observed=f.shadow.read(f.a.scope,f.caseA.id,r.observation_id);assert.equal(r.observation_digest,observed.receipt_digest);assert.equal(r.rule_digest,f.routeRules.draft_return.digest);assert.equal(observed.routing_changed,false);
 const generation=new SupportOwnership(f.kernel).inspect(f.a.scope,f.caseA.id).generation,job=f.rules.job(f.a.scope,r.rule_job_id),selected=f.routeRules.draft_return;
 assert.deepEqual(f.rules.applySelected(f.a.scope,{rule_id:selected.id,rule_version:selected.version,rule_digest:selected.digest,case_id:f.caseA.id,event_id:r.id,expected_generation:generation}),job);assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_support_rule_jobs').get().n,1);
 f.respond('unknown');const review=await f.routing.run(f.a.scope,f.routeInput());assert.equal(review.outcome,'review');assert.equal(review.action,'handoff_request');
 f.response(new Error('FIXTURE_PROVIDER_UNAVAILABLE'));const unavailable=await f.routing.run(f.a.scope,f.routeInput());assert.equal(unavailable.outcome,'review');assert.equal(unavailable.manual_workflow_available,true);
 f.respond('clear');f.conversations.link(f.a.scope,f.customer,{case_id:f.caseA.id,channel:'webchat',account_id:'shadow_channel_a',external_id:'shadow_thread_a',history:'partial',source_revision:2});
 const partial=await f.routing.run(f.a.scope,f.routeInput());assert.equal(partial.outcome,'review');assert.equal(partial.action,'handoff_request');assert.equal(f.shadow.read(f.a.scope,f.caseA.id,partial.observation_id).result.status,'usable');
}));
test('M14-G05-LOCAL-01',()=>usingRouting(async f=>{
 const first=f.bootstrap(),initial=await f.routing.run(f.a.scope,f.routeInput()),before=f.business(),q=f.qualification(f.systemRef),p=f.stage(q,{expected_version:1});f.publish(p,1);
 const replaced=await f.routing.run(f.a.scope,f.routeInput());assert.equal(replaced.configuration_id,f.systemRef);assert.equal(replaced.mode,'diagnostic');assert.equal(f.systemRequests.length,1);
 const rolled=f.routing.rollback(f.owner.scope,{id:'return_route',publication_version:first.p.version,expected_revision:2,case_id:f.caseA.id,task_id:f.taskA.id});assert.equal(rolled.revision,3);
 const again=await f.routing.run(f.a.scope,f.routeInput());assert.equal(again.configuration_id,f.ref);assert.deepEqual(f.business(),before);assert.deepEqual(f.routing.read(f.a.scope,f.caseA.id,initial.id),initial);
 assert.notEqual(replaced.observation_id,initial.observation_id);assert.equal(f.shadow.read(f.a.scope,f.caseA.id,replaced.observation_id).result.serving.reported_model,'clef_fixture');
 assert.throws(()=>verifyDecisionReceipt(f.shadow.read(f.a.scope,f.caseA.id,replaced.observation_id)),/DECISION_RECEIPT_SCOPE/);
}));
test('M14-G05-LOCAL-02',()=>usingRouting(f=>{
 const a=f.qualification(),b=f.qualification(f.systemRef),report=f.routing.compatibility(f.owner.scope,[{id:a.id,version:a.version},{id:b.id,version:b.version}]);
 assert.equal(report.implemented_transports.length,2);assert.equal(report.one_backend_scoped_routing.qualified,false);assert.equal(report.backend_portability.qualified,false);assert.equal(report.self_hosted.qualified,false);
 assert.ok(report.backend_portability.pending.includes('two_actual_backend_comparison'));assert.notEqual(report.implemented_transports[0].confidence_semantics,report.implemented_transports[1].confidence_semantics);
 const system=report.implemented_transports.find((r:any)=>r.provider==='systemone');assert.equal(system.model_revision,'supplied_model_revision');assert.equal(system.serving_revision,'supplied_serving_revision');assert.equal(system.observed_serving_revision,null);assert.equal(system.revision_monitoring,'pending');
},{model_revision:'supplied_model_revision',serving_revision:'supplied_serving_revision'}));
test('M14-G05-LOCAL-03',()=>usingRouting(async f=>{
 const first=f.bootstrap();assert.throws(()=>f.stage(first.q,{expected_version:1,configuration_id:f.systemRef}),/ROUTING_CONFIGURATION_CHANGED/);
 assert.equal(f.routing.active(f.owner.scope,'return_route').revision,1);assert.equal((await f.routing.run(f.a.scope,f.routeInput())).configuration_id,f.ref);
}));
test('M14-G05-LOCAL-04',()=>usingRouting(f=>{
 const {q,p}=f.bootstrap();assert.equal(q.body.pins.model_revision,null);assert.equal(q.body.pins.serving_revision,null);
 const canary=f.routing.recordCanary(f.owner.scope,{qualification_id:q.id,qualification_version:q.version,expected_version:0,observations:[]});assert.equal(canary.body.passed,false);assert.equal(canary.body.live_observations,0);
 assert.equal(f.routing.compatibility(f.owner.scope,[{id:q.id,version:q.version}]).implemented_transports[0].revision_monitoring,'pending');
 const next=f.stage(q,{expected_version:1,rollout_percent:25});f.publish(next,1);assert.equal(f.routing.active(f.owner.scope,'return_route').body.fallback.version,p.version);
 const another=f.stage(q,{expected_version:2,rollout_percent:25});f.publish(another,2);assert.equal(f.routing.active(f.owner.scope,'return_route').body.fallback.version,p.version);
 assert.throws(()=>f.routing.rollback(f.owner.scope,{id:'return_route',publication_version:next.version,expected_revision:3,case_id:f.caseA.id,task_id:f.taskA.id}),/ROUTING_ROLLOUT_INVALID/);assert.equal(f.routing.active(f.owner.scope,'return_route').revision,3);
 f.shadow.configure(f.owner.scope,{id:f.ref,expected_version:2,enabled:false,expires_at:f.now()+3600000});assert.throws(()=>f.routing.rollback(f.owner.scope,{id:'return_route',publication_version:p.version,expected_revision:3,case_id:f.caseA.id,task_id:f.taskA.id}),/ROUTING_CONFIGURATION_CHANGED/);
 assert.equal(f.intake.form(f.customer,f.caseA.id).financial_effect,false);
}));
test('M14-LOCAL-MILESTONE-ASSESSMENT',()=>{
 const r=assessRoutingMilestone();assert.equal(r.formal_status,'blocked');assert.equal(r.formal_cases_executed,0);assert.equal(r.next_milestone,'M15');assert.ok(r.outstanding.includes('two_actual_backend_comparison'));
 assert.throws(()=>assessRoutingMilestone({connected_provider_qualified:true}),/UNSUPPORTED_QUALIFICATION/);assert.throws(()=>assessRoutingMilestone({target_host_qualified:true}),/UNSUPPORTED_QUALIFICATION/);
});
test('M14-ROUTING-CURRENT-AUTHORITY',()=>usingRouting(async f=>{
 f.bootstrap();assert.throws(()=>f.routing.prepare(f.b.scope,f.routeInput()),/NOT_FOUND|ACCESS_DENIED|CONFIGURATION_MISSING/);
 f.before(()=>f.permissions.change(f.owner.scope,{actor_id:f.reviewer.actor,role:'reviewer',actions:['case.read','support.read'],resource_ids:null,expected_revision:0}));
 await assert.rejects(()=>f.routing.run(f.a.scope,f.routeInput()),/ROUTING_REVIEW_CHANGED/);assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_support_rule_jobs').get().n,0);
}));
test('M14-ROUTING-SELECTED-RULE-BOUNDARY',()=>usingRouting(f=>{
 const q=f.qualification(),send=f.publishedRule('queue_tracking'),delayed=f.publishedRule('draft_return',{wait_ms:1000});
 assert.throws(()=>f.stage(q,{rules:{...f.routeRules,draft_return:send}}),/ROUTING_RULE_UNSUPPORTED|RULE_SELECTION_INVALID/);
 assert.throws(()=>f.stage(q,{rules:{...f.routeRules,draft_return:delayed}}),/ROUTING_RULE_UNSUPPORTED|RULE_SELECTION_INVALID/);
 assert.throws(()=>f.stage(q,{approve_refund:true}),/INVALID_INPUT/);assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_support_rule_jobs').get().n,0);
}));
test('M14-ROUTING-PRIVACY-AND-REPLAY-STOP',()=>usingRouting(async f=>{
 f.bootstrap();const input=f.routeInput(),r=await f.routing.run(f.a.scope,input),privacy=new PrivacyLifecycle(f.kernel);
 assert.equal(privacy.export(f.owner.scope,f.order().customer_id).assistance.some((x:any)=>x.id===r.id),true);assert.throws(()=>f.routing.read(f.b.scope,f.caseA.id,r.id),/ACCESS_DENIED|NOT_FOUND/);
 new ExecutionStops(f.kernel).set(f.owner.scope,{action:'model.run',stopped:true,reason:'incident',expected_revision:0});await assert.rejects(()=>f.routing.run(f.a.scope,input),/EXECUTION_STOPPED/);assert.equal(f.requests.length,1);
 privacy.erase(f.owner.scope,f.order().customer_id);assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_assistance_receipts WHERE id IN (?,?)').get(r.id,r.observation_id).n,0);
 const documents=f.db.prepare("SELECT body FROM commerce_support_documents WHERE kind LIKE 'decision_%'").all();assert.equal(JSON.stringify(documents).includes(f.caseA.id),false);
}));
