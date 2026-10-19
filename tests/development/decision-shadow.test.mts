import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {usingShadow,loadShadow,PROTOCOL_PIN} from './decision-shadow-helpers.mts';
import {contentDigest} from '../../packages/commerce/configuration-values.mts';
import {DecisionResources,resolveDecisionQuestions} from '../../packages/commerce/decision-resources.mts';
import {evaluateDecisionProtocol,assessDecisionMilestone} from '../../packages/agent/decision-evaluation.mts';
import {ExecutionStops} from '../../packages/commerce/execution-stops.mts';
import {PrivacyLifecycle,suppressionCheckpoint} from '../../packages/commerce/privacy-lifecycle.mts';
import {createRecoverySnapshot,restoreRecoverySnapshot} from '../../packages/commerce/safe-recovery.mts';
import {SupportOwnership} from '../../packages/commerce/support-core.mts';
import {DecisionShadow} from '../../packages/commerce/decision-shadow.mts';
import {WORKERS_AI_MODEL,workersAIReader} from '../../packages/agent/workers-ai.mts';

test('CASE-M13-G02-01',()=>usingShadow(f=>{
  const a=f.shadow.snapshot(f.a.scope,f.input()),b=f.shadowB.snapshot(f.b.scope,f.inputB());
  assert.equal(a.question_resource_digest,b.question_resource_digest);assert.equal(a.skill_digest,b.skill_digest);
  assert.equal(a.profile_variant,'us');assert.equal(b.profile_variant,'gb');assert.notEqual(a.question_set_digest,b.question_set_digest);
  assert.deepEqual(Object.keys(a.request.questions),['reported_problem','requested_resolution']);
  assert.throws(()=>resolveDecisionQuestions(f.bundle,{'presentation.tone':'warm','presentation.locale':'en-US',refund_threshold:0}),/INVALID|OVERRIDE/);
}));
test('CASE-M13-G02-02',()=>usingShadow(f=>{
  assert.throws(()=>f.shadow.snapshot(f.b.scope,f.input()),/NOT_FOUND|ACCESS_DENIED/);
  f.permissions.change(f.owner.scope,{actor_id:'operator',role:'operator',actions:null,resource_ids:[f.kernel.list(f.a.scope,'order').find((o:any)=>o.id!==f.order().id).id],expected_revision:0});
  assert.throws(()=>f.shadow.snapshot(f.a.scope,f.input()),/ACCESS_DENIED/);assert.equal(f.requests.length,0);
}));
test('CASE-M13-G02-03',()=>usingShadow(f=>{
  const input=f.input(),first=f.shadow.snapshot(f.a.scope,input),again=f.shadow.snapshot(f.a.scope,input);
  assert.equal(first.input_hash,again.input_hash);assert.equal(first.evidence_hash,again.evidence_hash);
  f.message('Correction: I want an exchange instead.');const changed=f.shadow.snapshot(f.a.scope,input);
  assert.notEqual(changed.input_hash,first.input_hash);assert.notEqual(changed.evidence_hash,first.evidence_hash);
  assert.equal(changed.preprocessing_version,'return_intake_text_v1');assert.equal(changed.truncated,false);
}));
test('CASE-M13-G02-04',()=>usingShadow(async f=>{
  f.message('A'.repeat(7900));f.message('B'.repeat(7800)+' Correction: there is no damage and I do not want a refund.');
  const input=f.input(),s=f.shadow.snapshot(f.a.scope,input);assert.equal(s.status,'unavailable');assert.equal(s.reason,'DECISION_CONTEXT_LIMIT');assert.equal(s.request,null);
  const r=await f.shadow.run(f.a.scope,input);assert.equal(r.result.status,'unusable');assert.equal(r.provenance.dispatch,'not_attempted');assert.equal(f.requests.length,0);assert.equal(s.truncated,false);
}));
test('CASE-M13-G04-01',()=>usingShadow(async f=>{
  const r=await f.shadow.run(f.a.scope,f.input());assert.equal(r.result.status,'usable');assert.equal(r.result.answers.reported_problem.choice,'damaged');
  assert.equal(r.result.answers.requested_resolution.choice,'refund');assert.equal(r.provenance.transport_kind,'synthetic_wire_fixture');
  const persisted=f.db.prepare('SELECT task_id,body FROM commerce_assistance_receipts WHERE id=?').get(r.id);assert.equal(persisted.task_id,f.taskA.id);
  assert.equal(persisted.body.includes('SYNTHETIC_SHADOW_SECRET'),false);assert.equal(persisted.body.includes(f.protocol.cases[0].customer_messages[0]),false);
  assert.equal(f.shadow.view(f.a.scope,f.caseA.id,r.id).requested_resolution,'refund');assert.equal(r.result.serving.revision,null);
}));
test('CASE-M13-G04-02',()=>usingShadow(async f=>{
  const before=f.business();const r=await f.shadow.run(f.a.scope,f.input());assert.deepEqual(f.business(),before);assert.equal(r.business_effects,0);
  assert.equal(r.routing_changed,false);assert.equal(r.execution_authorized,false);
  f.shadow.configure(f.owner.scope,{id:f.ref,expected_version:1,enabled:false,expires_at:f.now()+3600000});
  const q=f.intake.evaluate(f.customer,f.selection({case_id:f.caseA.id}));const p=f.intake.prepare(f.customer,{quote_id:q.id,quote_digest:q.digest,request_key:'manual_shadow_return',override_id:null});
  const a=f.gateway.approve(f.reviewer.scope,{preview_id:p.preview_id,preview_digest:p.preview_digest});
  f.gateway.execute(f.a.scope,{preview_id:p.preview_id,preview_digest:p.preview_digest,approval_id:a.id});
  assert.equal(f.intake.read(f.a.scope,f.caseA.id).state,'submitted');assert.equal(f.requests.length,1);
}));
test('CASE-M13-G04-03',()=>usingShadow(async f=>{
  const input=f.input(),r=await f.shadow.run(f.a.scope,input),replayed=await f.shadow.run(f.a.scope,input);assert.deepEqual(replayed,r);assert.equal(f.requests.length,1);
  const fresh=await f.shadow.run(f.a.scope,f.input());assert.notEqual(fresh.id,r.id);assert.equal(fresh.sequence,r.sequence+1);assert.equal(fresh.input_hash,r.input_hash);
  f.message('I am correcting my earlier request.');assert.deepEqual(f.shadow.read(f.a.scope,f.caseA.id,r.id),r);assert.equal(f.requests.length,2);
  const concurrent=f.input(),first=f.shadow.prepare(f.a.scope,concurrent),second=f.shadow.prepare(f.a.scope,concurrent);
  let release!:()=>void;f.before(()=>new Promise<void>(resolve=>release=resolve));
  const pending=f.shadow.execute(f.a.scope,first);assert.equal(f.requests.length,3);
  await assert.rejects(()=>f.shadow.execute(f.a.scope,second),/DECISION_OBSERVATION_IN_PROGRESS/);
  assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_assistance_receipts').get().n,2);
  release();const completed=await pending;assert.equal(completed.id,first.id);assert.equal(completed.result.status,'usable');
  assert.deepEqual(await f.shadow.run(f.a.scope,concurrent),completed);assert.equal(f.requests.length,3);
}));
test('CASE-M13-G04-04',()=>usingShadow(async f=>{
  const invalid=structuredClone(f.wire.clear);invalid.result.answers.reported_problem.choice='approve_refund';f.response(invalid);
  const r=await f.shadow.run(f.a.scope,f.input());assert.equal(r.result.status,'unusable');assert.equal(r.handling,'review');
  f.shadow.configure(f.owner.scope,{id:f.ref,expected_version:1,enabled:false,expires_at:f.now()+3600000});
  const disabled=await f.shadow.run(f.a.scope,f.input());assert.equal(disabled.result.reason,'DECISION_DISABLED');assert.equal(f.requests.length,1);
  assert.equal(f.intake.form(f.customer,f.caseA.id).financial_effect,false);
}));
test('CASE-M13-G05-01',()=>usingShadow(async f=>{
  const a=await f.shadow.run(f.a.scope,f.input());f.respond('profile');const b=await f.shadowB.run(f.b.scope,f.inputB());
  assert.equal(a.profile_variant,'us');assert.equal(b.profile_variant,'gb');assert.equal(a.result.evidence_kind,'synthetic_wire_fixture');assert.equal(b.result.evidence_kind,'synthetic_wire_fixture');
  assert.equal(a.business_effects+b.business_effects,0);assert.equal(f.requests.length,2);assert.equal(f.requests.every((r:any)=>r.authorization_present),true);
}));
test('CASE-M13-G05-02',()=>{
  const p=loadShadow('evaluation-protocol.v1');assert.equal(contentDigest(p),PROTOCOL_PIN);assert.equal(p.cases.filter((c:any)=>c.role==='development').length,6);assert.equal(p.cases.filter((c:any)=>c.role==='held_out').length,6);
  const changed=structuredClone(p);changed.cases[0].reference_labels.reported_problem='other_unclear';assert.throws(()=>evaluateDecisionProtocol(changed,PROTOCOL_PIN,[],'synthetic_wire_fixture'),/BASELINE_CHANGED/);
});
test('CASE-M13-G05-03',async()=>{
  const rows:any[]=[],protocol=loadShadow('evaluation-protocol.v1');
  for(const c of protocol.cases.filter((c:any)=>c.role==='development'))await usingShadow(async f=>{
    const gb=c.profile_variant==='gb',store=gb?f.b:f.a,service=gb?f.shadowB:f.shadow,link=gb?f.linkB:f.linkA;
    // Fixture input is independently replaced before inference; this mutation is
    // setup only, and stored source-message integrity remains enforced.
    f.db.prepare('DELETE FROM commerce_support_messages WHERE tenant_id=? AND store_id=? AND case_id=?').run(store.tenant,store.store,gb?f.caseB.id:f.caseA.id);
    for(const text of c.customer_messages)f.message(text,store,link);f.respond(c.id);
    const receipt=await service.run(store.scope,gb?f.inputB():f.input());rows.push({case_id:c.id,receipt});
  });
  const r=evaluateDecisionProtocol(protocol,PROTOCOL_PIN,rows,'synthetic_wire_fixture');
  assert.equal(r.denominator,6);assert.equal(r.correct_classifications,3);assert.equal(r.correct_review,3);assert.equal(r.wrong_classifications,0);
  assert.equal(r.fixture_observations,6);assert.equal(r.live_inference_observations,0);assert.equal(r.held_out_pending,6);assert.equal(r.business_effects,0);assert.equal(r.model_quality_qualified,false);
  assert.equal(r.configuration_groups.length,6,'per-run immutable secret/configuration identities are not pooled');
  assert.throws(()=>evaluateDecisionProtocol(protocol,PROTOCOL_PIN,rows.slice(1),'synthetic_wire_fixture'),/INCOMPLETE/);
  await usingShadow(async f=>{f.respond('corrected');const wrong=await f.shadow.run(f.a.scope,f.input());
    const changed=evaluateDecisionProtocol(protocol,PROTOCOL_PIN,[{case_id:'clear',receipt:wrong},...rows.slice(1)],'synthetic_wire_fixture');
    assert.equal(changed.denominator,6);assert.equal(changed.wrong_classifications,1);assert.equal(changed.correct_classifications,2);assert.equal(changed.correct_review,3);
  });
});
test('CASE-M13-G05-04',()=>usingShadow(async f=>{
  const receipt=await f.shadow.run(f.a.scope,f.input());assert.throws(()=>evaluateDecisionProtocol(f.protocol,PROTOCOL_PIN,[{case_id:'clear',receipt}],'live_test_unqualified'),/EVIDENCE_KIND/);
  const forged=structuredClone(receipt);forged.provenance.transport_kind='live_test_unqualified';assert.throws(()=>f.shadow.verifyReceipt(forged),/RECEIPT_INTEGRITY/);
  const {receipt_digest,...changed}=forged;forged.receipt_digest=contentDigest(changed);assert.throws(()=>f.shadow.verifyReceipt(forged),/RECEIPT_INTEGRITY/);
}));
test('M13-SHADOW-CURRENT-OWNERSHIP',()=>usingShadow(async f=>{
  const p=f.shadow.prepare(f.a.scope,f.input()),ownership=new SupportOwnership(f.kernel);
  ownership.assign(f.owner.scope,{case_id:f.caseA.id,expected_generation:1,actor_id:'agent'});
  await assert.rejects(()=>f.shadow.execute(f.a.scope,p),/OWNERSHIP_CHANGED/);assert.equal(f.requests.length,0);
}));
test('M13-SHADOW-CURRENT-SOURCE-AFTER-AWAIT',()=>usingShadow(async f=>{
  f.before(()=>{f.message('Late correction: no refund is requested.');});await assert.rejects(()=>f.shadow.run(f.a.scope,f.input()),/EVIDENCE_CHANGED/);
  assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_assistance_receipts').get().n,0);assert.equal(f.requests.length,1);
}));
test('M13-SHADOW-CURRENT-PROFILE-AND-SKILL',()=>usingShadow(async f=>{
  const p=f.shadow.prepare(f.a.scope,f.input());f.installer.revoke(f.owner.scope,f.approvalA.id);
  await assert.rejects(()=>f.shadow.execute(f.a.scope,p),/APPROVAL_REQUIRED/);assert.equal(f.requests.length,0);
}));
test('M13-SHADOW-STOP-RESUME-GENERATION',()=>usingShadow(async f=>{
  const stops=new ExecutionStops(f.kernel);f.before(()=>{stops.set(f.owner.scope,{action:'model.run',stopped:true,reason:'incident',expected_revision:0});stops.set(f.owner.scope,{action:'model.run',stopped:false,reason:'reviewed_resume',expected_revision:1});});
  await assert.rejects(()=>f.shadow.run(f.a.scope,f.input()),/REAUTHORIZATION_REQUIRED/);assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_assistance_receipts').get().n,0);
}));
test('M13-SHADOW-EXPORT-ERASURE-AND-OTHER-SUBJECT',()=>usingShadow(async f=>{
  const a=await f.shadow.run(f.a.scope,f.input());f.respond('profile');const b=await f.shadowB.run(f.b.scope,f.inputB());
  const privacy=new PrivacyLifecycle(f.kernel),exported=privacy.export(f.owner.scope,f.order().customer_id);
  assert.equal(exported.assistance.some((r:any)=>r.id===a.id),true);assert.equal(JSON.stringify(exported).includes(b.id),false);
  assert.equal(privacy.erase(f.owner.scope,f.order().customer_id).status,'logically_erased');
  assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_assistance_receipts WHERE id=?').get(a.id).n,0);
  assert.deepEqual(f.shadowB.read(f.b.scope,f.caseB.id,b.id),b);assert.throws(()=>f.shadow.read(f.a.scope,f.caseA.id,a.id),/ERASED|NOT_FOUND/);
}));
test('M13-SHADOW-RESTORED-ERASURE-AND-UNINSTALL',()=>usingShadow(async f=>{
  const r=await f.shadow.run(f.a.scope,f.input()),snapshot=createRecoverySnapshot(f.kernel,join(f.directory,'before-erasure')),privacy=new PrivacyLifecycle(f.kernel);
  privacy.erase(f.owner.scope,f.order().customer_id);const cp=suppressionCheckpoint(f.kernel),restored=restoreRecoverySnapshot({snapshot:snapshot.directory,destination:join(f.directory,'restored'),manifest_sha256:snapshot.manifest_sha256,suppression:cp,suppression_sha256:contentDigest(cp)},f.now);
  const db=new DatabaseSync(restored.database);try{assert.equal(db.prepare('SELECT count(*) n FROM commerce_assistance_receipts WHERE id=?').get(r.id).n,0);assert.equal(db.prepare('SELECT count(*) n FROM commerce_secrets WHERE revoked=0').get().n,0);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);}finally{db.close();}
  f.respond('profile');const b=await f.shadowB.run(f.b.scope,f.inputB());privacy.uninstall(f.ownerB);assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_assistance_receipts WHERE id=?').get(b.id).n,0);
  assert.throws(()=>f.shadowB.read(f.b.scope,f.caseB.id,b.id),/ACCESS_DENIED/);
}));
test('M13-SHADOW-UNKNOWN-USAGE-AND-BUDGET-EXHAUSTION',()=>usingShadow(async f=>{
  const reply=structuredClone(f.wire.clear);delete reply.result.usage;f.response(reply);const r=await f.shadow.run(f.a.scope,f.input());
  assert.equal(r.result.usage,null);const budget=f.budgets.inspect(f.a.scope,'cloudflare','shadow_period');assert.equal(budget.unknown_usage_count,1);assert.ok(BigInt(budget.held_micro)>0n);
  f.budgets.configure(f.owner.scope,{provider_id:'cloudflare',period_id:'shadow_period',starts_at:f.now(),ends_at:f.now()+3600000,limit_micro:budget.held_micro,input_micro:'1',output_micro:'1',max_input_bytes:40000,max_output_tokens:1,expected_revision:1});
  const denied=await f.shadow.run(f.a.scope,f.input());assert.equal(denied.result.status,'unusable');assert.equal(f.requests.length,1);assert.equal(f.intake.read(f.a.scope,f.caseA.id).state,'not_submitted');
}));
test('M13-SHADOW-PREPARED-CREDENTIAL-REVOCATION',()=>usingShadow(async f=>{
  const p=f.shadow.prepare(f.a.scope,f.input());f.vault.revoke(f.a.scope,f.secret);const r=await f.shadow.execute(f.a.scope,p);
  assert.equal(r.result.status,'unusable');assert.equal(r.result.reason,'DECISION_CREDENTIAL_UNAVAILABLE');assert.equal(f.requests.length,0);
}));
test('M13-SHADOW-ATTACHMENTS-GAPS-AND-MESSAGE-WINDOW',async()=>{
 await usingShadow(async f=>{
  assert.throws(()=>f.shadow.snapshot(f.a.scope,{...f.input(),attachments:[{url:'https://private.invalid/evidence'}]}),/INVALID_INPUT/);
  f.conversations.link(f.a.scope,f.customer,{case_id:f.caseA.id,channel:'webchat',account_id:'shadow_channel_a',external_id:'shadow_thread_a',history:'partial',source_revision:2});
  const gap=f.shadow.snapshot(f.a.scope,f.input());assert.ok(gap.gaps.includes('conversation_history_partial'));assert.equal(gap.request.state.includes('verified_absence'),false);
  for(let i=0;i<100;i++)f.message('Required message '+i);const r=await f.shadow.run(f.a.scope,f.input());assert.equal(r.result.status,'unusable');assert.equal(f.requests.length,0);
 });
 await usingShadow(async f=>{
  f.advance(301000);const snapshot=f.shadow.snapshot(f.a.scope,f.input());
  assert.equal(snapshot.status,'unavailable');assert.equal(snapshot.request,null);assert.ok(snapshot.gaps.includes('order_source_stale_or_unavailable'));
  const receipt=await f.shadow.run(f.a.scope,f.input());assert.equal(receipt.result.status,'unusable');assert.equal(receipt.provenance.dispatch,'not_attempted');assert.equal(f.requests.length,0);
 });
});
test('M13-SHADOW-CONFIGURATION-CHANGE-AFTER-AWAIT',async()=>{
 await usingShadow(async f=>{
  f.before(()=>f.shadow.configure(f.owner.scope,{id:f.ref,expected_version:1,enabled:false,expires_at:f.now()+3600000}));
  await assert.rejects(()=>f.shadow.run(f.a.scope,f.input()),/CONFIGURATION_CHANGED/);assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_assistance_receipts').get().n,0);
 });
 await usingShadow(async f=>{
  const replacement=workersAIReader({serving_configuration_ref:f.ref,account_id:'b'.repeat(32),approved_account_ids:['b'.repeat(32)],model_id:WORKERS_AI_MODEL,approved_model_ids:[WORKERS_AI_MODEL],fixtureTransport:(async()=>{throw new Error('WRONG_CATALOG_READER_DISPATCH');}) as typeof fetch});
  assert.notEqual(replacement.configuration_digest,f.reader.configuration_digest);
  const shadow=new DecisionShadow(f.kernel,f.reads,f.vault,[{id:f.ref,tenant_id:f.a.tenant,store_id:f.a.store,secret_ref:f.secret,reader:replacement}]);
  shadow.configure(f.owner.scope,{id:f.ref,expected_version:1,enabled:true,expires_at:f.now()+3600000});
  const receipt=await shadow.run(f.a.scope,f.input());assert.equal(receipt.result.status,'unusable');assert.equal(receipt.result.reason,'DECISION_CONFIGURATION_CHANGED');
  assert.equal(receipt.provenance.dispatch,'not_attempted');assert.equal(receipt.provenance.live_inference_observed,false);assert.equal(f.requests.length,0);
 });
});
test('M13-LOCAL-MILESTONE-ASSESSMENT',()=>usingShadow(async f=>{
  const r=await f.shadow.run(f.a.scope,f.input()),a=assessDecisionMilestone([r]);
  assert.equal(a.local_observations,1);assert.equal(a.formal_status,'blocked');assert.equal(a.live_inference_observations,0);assert.equal(a.business_effects,0);
  assert.ok(a.outstanding.includes('connected_provider_qualification'));assert.ok(a.outstanding.includes('inherited_formal_product_gates'));assert.equal(a.next_milestone,'M14');
  assert.throws(()=>assessDecisionMilestone([r],{connected_provider_qualified:true}),/UNSUPPORTED_QUALIFICATION/);
}));
