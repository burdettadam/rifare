import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkerApi} from '../../packages/commerce/worker-api.mts';
import {ExecutionStops} from '../../packages/commerce/execution-stops.mts';
import {
  usingContinuity,common,context,documents,counts,assertBaseline,assertTracking,assertMemory,manualStatus,handover,secondChannel,
  authorizeExchange,assertReplacement,addShopping,reopenContinuity,intent,count,reference,publish,job,immutableJob,readinessRow,
} from './journey-continuity-helpers.mts';
import type {Value} from './journey-continuity-helpers.mts';

// ADR-0057: exactly three local diagnostics; formal G05/G99 qualification is unperformed.
const stopModel=(f:any)=>new ExecutionStops(f.kernel).set(f.owner.scope,{action:'model.run',stopped:true,reason:'maintenance',expected_revision:0});
const oneReplacement={previews:1,approvals:1,receipts:1,fulfillment:1};

test('M18-G05-LOCAL-TWO-CHANNEL-CONTINUITY',()=>usingContinuity(async f=>{
  const email=context(f);assert.equal(email.id,f.journeyId);assert.equal(email.case_id,'resolution_case');assert.equal(email.resource_id,f.email.resource_id);assert.equal(email.version,2);
  assert.equal(email.history.status,'partial');assert.equal(email.history.missing_history_is_explicit,true);assertTracking(f.tracking.read(f.a.scope,f.caseId));assertMemory(f,f.a.scope,f.customer,f.email,1);
  handover(f);const next=secondChannel(f),web=context(f,f.owner.scope,next.proof,next.web,3);
  assert.equal(web.id,email.id);assert.equal(web.version,2);assert.equal(web.ownership_generation,3);assert.equal(web.history.status,'unavailable');assert.equal(web.history.missing_history_is_explicit,true);
  const history=f.conversations.history(f.owner.scope,f.caseId);assert.equal(history.history_complete,false);
  assert.ok(history.messages.some((m:Value)=>m.text==='Where is my order?'&&m.visibility==='public'));assert.ok(history.messages.some((m:Value)=>m.text==='Please continue my size exchange here.'&&m.visibility==='public'));
  assertMemory(f,f.owner.scope,next.proof,next.web,3);

  const exchange=authorizeExchange(f,f.owner.scope,next.proof,next.web,3);assert.equal(exchange.journey.version,4);
  assert.equal(count(f.fulfillmentDb,'fixture_effects'),0);assert.equal(f.fulfillmentSource.calls.replace,0);
  const replacement=await f.execution.dispatch(f.owner.scope,exchange.id);assertReplacement(replacement,exchange.id);
  assert.equal(f.fulfillmentSource.calls.replace,1);assert.equal(f.fulfillmentSource.calls.buy,0);assert.equal(count(f.fulfillmentDb,'fixture_effects'),1);
  const nativeEffect=f.fulfillmentDb.prepare('SELECT * FROM fixture_effects WHERE id=?').get(exchange.id);assert.ok(nativeEffect);assert.equal(JSON.parse(nativeEffect.body).result.id,replacement.native_id);assert.equal(JSON.parse(nativeEffect.body).result.fulfillment_state,'unfulfilled');
  const shopping=await addShopping(f,f.owner.scope,next.proof,next.web,3),continued=context(f,f.owner.scope,next.proof,next.web,3);
  assert.equal(continued.id,email.id);assert.equal(continued.version,5);assert.equal(continued.status,'active');assert.equal(continued.case_id,'resolution_case');assert.equal(continued.resource_id,email.resource_id);
  assert.deepEqual(continued.intents.map((i:Value)=>[i.id,i.state]),[['tracking_one','available'],['exchange_one','observed'],['shopping_one','observed']]);
  assert.deepEqual(intent(continued,'exchange_one').references,exchange.refs);assert.deepEqual(intent(continued,'shopping_one').references,[shopping.ref]);
  const observation=intent(continued,'exchange_one').observations.find((o:Value)=>o.reference.id===exchange.id);assert.equal(observation.state,'created');assert.equal(observation.native_id,replacement.native_id);assert.equal(observation.qualification,'synthetic_only');
  assert.equal(continued.model_thread_required,false);assert.equal(continued.execution_authorized,false);assert.equal(continued.production_qualified,false);assert.deepEqual(continued.unresolved,[]);
  assertMemory(f,f.owner.scope,next.proof,next.web,3);assertTracking(f.tracking.read(f.owner.scope,f.caseId));
  const readiness=f.service.readiness.inspect(f.owner.scope,{...common(f,next.web,3),allocation_id:f.allocation.id,cart_id:shopping.cart.cart_id,sender_id:'sender_one'});
  assert.equal(readinessRow(readiness,'tracking.read').status,'available');assert.equal(readinessRow(readiness,'shopping.cart.context').status,'available');
  assert.equal(readinessRow(readiness,'remote.continue').status,'unsupported');assert.equal(readinessRow(readiness,'remote.continue').reason,'REMOTE_QUALIFICATION_MISSING');assert.equal(readiness.execution_authorized,false);
  assert.equal(f.supportSource.calls,0);assert.equal(count(f.supportDb,'support_source_effects'),0);assertBaseline(f,{...oneReplacement,carts:1});
}));

test('M18-G05-LOCAL-REOPEN-ORIGINAL-RECONCILIATION',()=>usingContinuity(async f=>{
  manualStatus(f,f.a.scope,'reopen_initial_manual_status',1);const exchange=authorizeExchange(f,f.a.scope,f.customer,f.email,1);
  f.fulfillmentSource.fault='after';const uncertain=await f.execution.dispatch(f.a.scope,exchange.id);assert.equal(uncertain.state,'unknown');assert.equal(f.fulfillmentSource.calls.replace,1);
  const sourceEffects=f.fulfillmentDb.prepare('SELECT * FROM fixture_effects ORDER BY id').all();assert.equal(sourceEffects.length,1);assert.equal(sourceEffects[0].id,exchange.id);
  assert.equal(count(f.db,'commerce_replacement_orders'),0);
  const assigned=f.ownership.assign(f.owner.scope,{case_id:f.caseId,expected_generation:1,actor_id:'agent'});assert.equal(assigned.generation,2);
  const visible=context(f,f.agent.scope,f.customer,f.email,2);assert.equal(intent(visible,'exchange_one').state,'unknown');assert.ok(visible.unresolved.some((r:Value)=>r.family==='fulfillment'&&r.id===exchange.id&&r.state==='unknown'));
  const api=new WorkerApi(f.kernel),audience='http://127.0.0.1:9911/v1/worker',grant=api.leases.issue(f.agent.scope,{case_id:f.caseId,lifetime_ms:120000},audience),lease=api.leases.claim(grant.token,audience,10000);
  assert.equal(lease.generation,1);const oldContext=api.context(grant.token,audience,lease.generation);
  assert.equal(oldContext.envelope.case_id,'resolution_case');assert.equal(oldContext.envelope.resource_id,f.email.resource_id);assert.equal(oldContext.envelope.generation,1);assert.equal(oldContext.execution_authorized,false);
  assert.deepEqual(oldContext.allowed_actions,['proposal.prepare','proposal.result','work.complete']);
  const worker=api.leases.scoped(grant.token,audience,lease.generation).scope;assert.throws(()=>f.kernel.authorize(worker,'support.read',f.email.resource_id),/WORK_SCOPE_DENIED/);
  const taken=f.ownership.takeover(f.owner.scope,{case_id:f.caseId,expected_generation:2,reason:'operator_requested'});assert.equal(taken.generation,3);stopModel(f);
  const beforeRefusal=counts(f),retained=documents(f,'commerce_journey');
  assert.throws(()=>api.context(grant.token,audience,lease.generation),/WORK_ACCESS_DENIED/);assert.throws(()=>api.leases.scoped(grant.token,audience,lease.generation),/WORK_ACCESS_DENIED/);
  assert.throws(()=>api.submit(grant.token,audience,{generation:lease.generation,envelope:oldContext.envelope,request_key:'late_old_worker',proposal:{action:'diagnostic.resolution.set',arguments:{resolution:'none'}}}),/WORK_ACCESS_DENIED/);
  assert.throws(()=>f.journeys.attach(f.agent.scope,f.customer,{...common(f,f.email,2),expected_version:4,request_id:'late_old_journey',intent_id:'tracking_one',kind:'tracking',references:[]}),/SUPPORT_OWNERSHIP_CHANGED|SUPPORT_TAKEN_OVER/);
  assert.throws(()=>f.delivery.queue(f.agent.scope,{...common(f,f.email,2),sender_id:'sender_one',template_id:'tracking_status_v1',event_id:'late_old_message'}),/SUPPORT_OWNERSHIP_CHANGED|SUPPORT_TAKEN_OVER/);
  assert.deepEqual(counts(f),beforeRefusal);assert.deepEqual(documents(f,'commerce_journey'),retained);assert.equal(f.supportSource.calls,0);assert.equal(f.fulfillmentSource.calls.replace,1);
  const next=secondChannel(f),originalReceipt=f.gateway.receipt(f.owner.scope,exchange.receipt.id),originalRefs=exchange.refs;
  const reopened=reopenContinuity({filename:f.filename,sourceFile:f.sourceFile,tenant:f.a.tenant,store:f.a.store,now:f.now,humanBearer:f.owner.bearer,customerBearer:next.bearer,caseId:f.caseId,linkId:next.web.id,generation:3});
  try{
    assert.notEqual(reopened.kernel,f.kernel);assert.notEqual(reopened.reads,f.reads);assert.notEqual(reopened.execution,f.execution);assert.notEqual(reopened.source,f.fulfillmentSource);
    const fresh=reopened.journeys.context(reopened.human,reopened.customer,reopened.publicInput);assert.equal(fresh.id,f.journeyId);assert.equal(fresh.version,4);assert.equal(fresh.ownership_generation,3);assert.equal(fresh.history.status,'unavailable');assert.equal(fresh.model_thread_required,false);
    const discovered=intent(fresh,'exchange_one'),original=discovered.references.find((r:Value)=>r.kind==='fulfillment');assert.ok(original);assert.equal(original.id,exchange.id);assert.deepEqual(discovered.references,originalRefs);
    assert.equal(discovered.state,'unknown');assert.ok(fresh.unresolved.some((r:Value)=>r.family==='fulfillment'&&r.id===original.id));
    const reconcileInput={...reopened.publicInput,expected_version:fresh.version,intent_id:discovered.id,reference:original};
    const result=await reopened.journeys.reconcile(reopened.human,reopened.customer,reconcileInput);assertReplacement(result.native,original.id);assert.equal(result.native.native_id,JSON.parse(sourceEffects[0].body).result.id);
    assert.equal(result.journey.id,fresh.id);assert.equal(result.journey.version,fresh.version);assert.deepEqual(result.journey.unresolved,[]);assert.equal(intent(result.journey,discovered.id).state,'observed');assert.deepEqual(intent(result.journey,discovered.id).references,originalRefs);
    const repeated=await reopened.journeys.reconcile(reopened.human,reopened.customer,reconcileInput);assert.equal(repeated.native.id,result.native.id);assert.equal(repeated.native.native_id,result.native.native_id);assert.equal(repeated.native.state,'created');
    assert.equal(reopened.source.calls.replace,0);assert.equal(reopened.source.calls.lookup,2);assert.deepEqual(reopened.sourceDb.prepare('SELECT * FROM fixture_effects ORDER BY id').all(),sourceEffects);
    assert.equal(new ExecutionStops(reopened.kernel).status(reopened.human,'model.run').stopped,true);
    const answer=reopened.workflows.complete(reopened.human,f.caseId,'support-reply',f.digests['support-reply'],'reopened_manual_status');assert.equal(answer.status,'answered');assert.equal(answer.generation,3);assert.equal(answer.customer_resolved,false);
    assert.throws(()=>new WorkerApi(reopened.kernel).context(grant.token,audience,lease.generation),/WORK_ACCESS_DENIED/);
    const memory=reopened.memory.context(reopened.human,reopened.customer,{...reopened.publicInput,purpose:'support_journey'});assert.equal(memory.status,'available');assert.equal(memory.version,1);assert.deepEqual(memory.preferences,{fit_preference:'regular',response_style:'concise'});
    assert.deepEqual(documents(f,'shopper_memory'),f.originalMemory);assert.deepEqual(documents(f,'commerce_journey'),retained);assert.deepEqual(f.gateway.receipt(f.owner.scope,exchange.receipt.id),originalReceipt);
    assert.deepEqual(reference(f,'preview',exchange.preview.id),originalRefs[0]);assert.deepEqual(reference(f,'approval',exchange.approval.id),originalRefs[1]);assert.deepEqual(reference(f,'receipt',exchange.receipt.id),originalRefs[2]);
    assert.equal(f.fulfillmentSource.calls.replace,1);assert.equal(count(f.supportDb,'support_source_effects'),0);assertBaseline(f,oneReplacement);
  }finally{reopened.close();}
}));

test('M18-G05-LOCAL-NO-MODEL-OPTOUT-FINAL-STOP',()=>usingContinuity(async f=>{
  handover(f);const next=secondChannel(f),exchange=authorizeExchange(f,f.owner.scope,next.proof,next.web,3);assertReplacement(await f.execution.dispatch(f.owner.scope,exchange.id),exchange.id);
  const shopping=await addShopping(f,f.owner.scope,next.proof,next.web,3);stopModel(f);
  assert.equal(f.service.runner,null);assert.equal(f.service.routing,null);assert.equal(new ExecutionStops(f.kernel).status(f.owner.scope,'model.run').stopped,true);
  const manual=f.service.context(f.owner.scope,f.caseId);assert.equal(manual.model_required,false);assert.equal(manual.production_qualified,false);assertTracking(manual.tracking);manualStatus(f,f.owner.scope,'no_model_manual_status',3);
  const web=context(f,f.owner.scope,next.proof,next.web,3);assert.equal(web.id,f.journeyId);assert.equal(web.model_thread_required,false);assertMemory(f,f.owner.scope,next.proof,next.web,3);
  const earlier=f.delivery.queue(f.owner.scope,{...common(f,f.email,3),sender_id:'sender_one',template_id:'tracking_status_v1',event_id:'continuity_status_before_followup'});
  const accepted=await f.delivery.dispatch(f.owner.scope,earlier.operation_id);assert.equal(accepted.state,'accepted');assert.equal(accepted.customer_delivered,false);assert.equal(f.supportSource.calls,1);assert.equal(count(f.supportDb,'support_source_effects'),1);
  const email=context(f,f.owner.scope,next.proof,f.email,3);assert.equal(email.id,web.id);assert.equal(email.version,web.version);assert.notEqual(email.context_digest,web.context_digest);
  const rule=publish(f),input={rule,journey:{id:email.id,version:email.version,context_digest:email.context_digest,intent_id:'shopping_one',reference:shopping.ref},event:{id:'continuity_followup_event',case_id:f.caseId,trigger:'message_received',channel:'email',at:f.now(),visited:[],depth:0,link_id:f.email.id,sender_id:'sender_one'},expected_generation:3,expires_at:f.now()+60000};
  assert.throws(()=>f.followups.schedule(f.owner.scope,next.proof,{...input,journey:{...input.journey,context_digest:web.context_digest}}),/JOURNEY_FOLLOWUP_CONTEXT_CHANGED/);assert.equal(count(f.db,'commerce_support_rule_jobs'),0);
  const scheduled=f.followups.schedule(f.owner.scope,next.proof,input);assert.equal(scheduled.state,'waiting');const waiting=job(f,scheduled.job_id);f.advance(waiting.due_at-f.now());
  const executed=f.rules.execute(f.owner.scope,scheduled.job_id);assert.equal(executed.state,'completed');const operationId=executed.result.operation_id;assert.ok(operationId);assert.notEqual(operationId,earlier.operation_id);
  const nativeJob=job(f,scheduled.job_id),jobPin=JSON.parse(nativeJob.result).journey_guard;
  const nativeOperation=f.db.prepare('SELECT id,command,payload_hash FROM commerce_operations WHERE id=?').get(operationId),delivery=f.db.prepare('SELECT body,digest FROM commerce_support_deliveries WHERE operation_id=?').get(operationId);
  assert.equal(JSON.parse(delivery.body).template_id,'tracking_status_v1');assert.equal(JSON.parse(delivery.body).purpose,'transactional');
  const originalJourney=documents(f,'commerce_journey'),originalMemory=documents(f,'shopper_memory'),tracking=f.tracking.read(f.owner.scope,f.caseId),cart=f.shopping.carts.readCart(f.owner.scope,shopping.cart.cart_id),cartEffects=f.shopping.sourceDb.prepare('SELECT * FROM growth_source_cart_effects ORDER BY operation_id').all();
  const messages=f.supportDb.prepare('SELECT * FROM support_source_effects ORDER BY operation_id').all();
  await assert.rejects(()=>f.delivery.dispatch(f.owner.scope,operationId,{beforeFinal:async()=>{
    f.consent.record(next.proof,{case_id:f.caseId,sender_id:'sender_one',channel:'email',purpose:'*',state:'withdrawn',event_id:'continuity_final_optout',source_version:1,effective_at:f.now(),source_ref:'verified_customer_click'});
  }}),/DELIVERY_SUPPRESSED/);
  assert.equal(f.delivery.inspect(f.owner.scope,operationId).state,'suppressed');const suppressed=f.followups.inspect(f.owner.scope,next.proof,{...common(f,f.email,3),job_id:scheduled.job_id});
  assert.equal(suppressed.state,'suppressed');assert.equal(suppressed.reason,'consent_changed');assert.equal(suppressed.operation_id,operationId);assert.equal(suppressed.customer_delivered,false);assert.equal(suppressed.manual_action_required,true);
  assert.equal(f.supportSource.calls,1);assert.deepEqual(f.supportDb.prepare('SELECT * FROM support_source_effects ORDER BY operation_id').all(),messages);assert.equal(f.delivery.inspect(f.owner.scope,earlier.operation_id).state,'accepted');
  assert.deepEqual(immutableJob(job(f,scheduled.job_id)),immutableJob(nativeJob));assert.deepEqual(JSON.parse(job(f,scheduled.job_id).result).journey_guard,jobPin);assert.equal(JSON.parse(job(f,scheduled.job_id).result).operation_id,operationId);
  assert.deepEqual(f.db.prepare('SELECT id,command,payload_hash FROM commerce_operations WHERE id=?').get(operationId),nativeOperation);assert.deepEqual(f.db.prepare('SELECT body,digest FROM commerce_support_deliveries WHERE operation_id=?').get(operationId),delivery);
  assert.deepEqual(f.followups.schedule(f.owner.scope,next.proof,input),suppressed);assert.equal(f.rules.execute(f.owner.scope,scheduled.job_id).result.operation_id,operationId);
  assert.deepEqual(documents(f,'commerce_journey'),originalJourney);assert.deepEqual(documents(f,'shopper_memory'),originalMemory);assert.equal(f.tracking.read(f.owner.scope,f.caseId).source_digest,tracking.source_digest);
  assert.deepEqual(f.shopping.carts.readCart(f.owner.scope,shopping.cart.cart_id),cart);assert.deepEqual(f.shopping.sourceDb.prepare('SELECT * FROM growth_source_cart_effects ORDER BY operation_id').all(),cartEffects);assertMemory(f,f.owner.scope,next.proof,f.email,3);
  assert.equal(count(f.fulfillmentDb,'fixture_effects'),1);assert.equal(f.fulfillmentSource.calls.replace,1);assert.equal(count(f.db,'commerce_support_rule_jobs'),1);assertBaseline(f,{...oneReplacement,carts:1,deliveries:2,operations:2});
}));
