import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {usingReturnPortability,withPortabilityServer,configurePortabilityAgent} from './return-portability-helpers.mts';
import {wooEventFixture} from './woocommerce-event-helpers.mts';
import {WorkerApi} from '../../packages/commerce/worker-api.mts';
import {PrivacyLifecycle,storageInventory,storageInventoryCurrent} from '../../packages/commerce/privacy-lifecycle.mts';
import {contentDigest,canonical} from '../../packages/commerce/configuration-values.mts';
import {ReturnPortabilityApi} from '../../packages/commerce/return-portability-api.mts';
const expected=JSON.parse(readFileSync(new URL('../fixtures/woocommerce/shared-lifecycle.v1.json',import.meta.url),'utf8'));
const count=(db:any,table:string)=>db.prepare('SELECT count(*) n FROM '+table).get().n;
function effects(f:any){return {return_requests:count(f.db,'commerce_return_requests'),action_receipts:count(f.db,'commerce_action_receipts'),refund_operations:count(f.db,'commerce_resolution_operations'),woo_refund_records:count(f.sourceDb,'fixture_woo_refund_records'),gateway_refunds:count(f.gatewayDb,'fixture_woo_gateway_refunds'),gateway_movements:count(f.gatewayDb,'fixture_woo_gateway_movements'),notification_effects:count(f.mailDb,'support_source_effects'),native_return_operations:count(f.db,'commerce_native_return_operations')};}
async function settle(f:any,op:any){await f.executor.dispatch(f.a.scope,op.id);f.advance(1);f.gatewaySource.settle(op.id);return f.executor.reconcile(f.a.scope,op.id);}

test('CASE-M07-G03-01',async()=>{for(const mode of ['staff_no_ai','agent_client'])await usingReturnPortability(async f=>{
 const actor=mode==='agent_client'?f.agent:f.a;if(mode==='agent_client'){f.support.ownership.assign(f.owner.scope,{case_id:f.caseId,expected_generation:1,actor_id:f.agent.actor});configurePortabilityAgent(f,'diagnostic.return.submit');}
 await withPortabilityServer(f,async post=>{
  const ok=async(path:string,body:any,bearer=actor.bearer)=>{const r=await post(path,body,bearer);assert.equal(r.status,200,JSON.stringify({path,...r}));return r.body;};
  const start=await ok('/v1/return-portability/context',{case_id:f.caseId});assert.equal(start.model_required,false);assert.equal(start.configuration.skill_id,expected.skill_id);assert.equal(start.platform,expected.platform);
  const q=await ok('/v1/returns/quote',f.selection()),request=await ok('/v1/returns/prepare',{quote_id:q.id,quote_digest:q.digest,request_key:'common_ui_return',override_id:null});
  const approval=await ok('/v1/execution/approve',{preview_id:request.preview_id,preview_digest:request.preview_digest},f.reviewer.bearer);
  assert.equal((await ok('/v1/return-portability/context',{case_id:f.caseId})).previews.find((p:any)=>p.id===request.preview_id).approval.id,approval.id);
  const rmaReceipt=await ok('/v1/execution/execute',{preview_id:request.preview_id,preview_digest:request.preview_digest,approval_id:approval.id});
  const rma=(await ok('/v1/return-portability/context',{case_id:f.caseId})).request;assert.equal(rma.native_return_id,null);assert.equal(rma.return_semantics,expected.return_semantics);
  const plan=await ok('/v1/resolutions/allocate',{request_id:rma.id,request_key:'common_ui_refund',lines:[{line_id:'71',units:[1],outcome:'refund'}]}),quote=await ok('/v1/resolutions/quote',{allocation_id:plan.allocations[0].id});
  if(mode==='agent_client')configurePortabilityAgent(f,'diagnostic.return.resolve');
  const preview=await ok('/v1/execution/preview',quote.proposal),approved=await ok('/v1/execution/approve',{preview_id:preview.id,preview_digest:preview.digest},f.reviewer.bearer),receipt=await ok('/v1/execution/execute',{preview_id:preview.id,preview_digest:preview.digest,approval_id:approved.id});
  assert.notEqual(receipt.id,rmaReceipt.id);const operationId=receipt.resolution_operation_id;
  if(mode==='agent_client')assert.equal((await post('/v1/resolutions/dispatch',{operation_id:operationId},actor.bearer)).status,403);
  // The existing operation worker, with its own authority, performs source I/O.
  const accepted=await ok('/v1/resolutions/dispatch',{operation_id:operationId},f.a.bearer);assert.equal(accepted.cash_settled,false);
  f.advance(1);f.gatewaySource.settle(operationId);const settled=await ok('/v1/resolutions/reconcile',{operation_id:operationId},f.a.bearer);assert.equal(settled.cash_settled,true);assert.equal(settled.amount_minor,expected.refund_minor);
  const message=await ok('/v1/support/refund-message-preview',{case_id:f.caseId,operation_id:operationId,template_id:'return_refund_completed_v1'});assert.match(message.text,/No live payment was made/);
  const queued=await ok('/v1/support/queue',f.message(operationId)),sent=await ok('/v1/support/dispatch',{operation_id:queued.operation_id},f.a.bearer);assert.equal(sent.customer_delivered,expected.completed.customer_delivered);
  const {customer_delivered,...counts}=expected.completed;assert.deepEqual(effects(f),counts);assert.equal(f.db.prepare("SELECT count(*) n FROM commerce_context_tasks").get()!.n,0);
  const stored=f.db.prepare('SELECT body,digest FROM commerce_support_deliveries WHERE operation_id=?').get(queued.operation_id)!;const body=JSON.parse(stored.body);assert.equal(f.mailDb.prepare('SELECT payload_hash FROM support_source_effects WHERE operation_id=?').get(queued.operation_id)!.payload_hash,stored.digest);assert.equal(body.refund_operation_id,operationId);assert.equal(body.template_id,'return_refund_completed_v1');
 });
},{deferRequest:true});});

test('CASE-M07-G03-02',()=>usingReturnPortability(f=>{
 f.returnSourceDb.prepare('DELETE FROM woo_fixture_order_versions WHERE native_order_id=?').run('17');assert.throws(()=>f.approved(),/WOO_SOURCE_UNAVAILABLE/);assert.equal(count(f.gatewayDb,'fixture_woo_gateway_refunds'),0);assert.equal(count(f.mailDb,'support_source_effects'),0);
}));
test('M07-G03-UNQUALIFIED-GATEWAY-BLOCKS-SHARED-LIFECYCLE',()=>usingReturnPortability(f=>{
 f.publish(input=>{input.financial_contract.gateway_id='unqualified_live_gateway';input.order.payment_method='unqualified_live_gateway';});f.woo.refresh(f.a.scope,'17');const request=f.prepare();f.submit(request);const plan=f.ledger.allocate(f.a.scope,{request_id:request.id,request_key:'unsupported_gateway',lines:[{line_id:'71',units:[1],outcome:'refund'}]});assert.throws(()=>f.quotes.quote(f.a.scope,{allocation_id:plan.allocations[0].id}),/WOO_/);assert.equal(count(f.gatewayDb,'fixture_woo_gateway_refunds'),0);
},{deferRequest:true}));
test('CASE-M07-G03-03',()=>usingReturnPortability(async f=>{
 const op=f.approved(),issue=f.source.issue.bind(f.source);f.source.issue=async command=>{await issue(command);throw Error('lost_finance_response');};assert.equal((await f.executor.dispatch(f.a.scope,op.id)).state,'unknown');
 const event=wooEventFixture({...f,source:f.returnSource}),received=event.receive();event.events.process(f.a.scope,received.id);assert.equal(event.receive().duplicate,true);
 const worker=new WorkerApi(f.kernel,{resolutionExecution:f.executor}),audience='http://127.0.0.1:9001/v1/worker',grant=worker.leases.issue(f.a.scope,{case_id:f.caseId,lifetime_ms:100000},audience),lease=worker.leases.claim(grant.token,audience,10000);
 f.support.ownership.takeover(f.owner.scope,{case_id:f.caseId,expected_generation:1,reason:'provider_unavailable'});assert.throws(()=>worker.returnContext(grant.token,audience,lease.generation),/WORK_ACCESS_DENIED|WORK_FENCE_REJECTED/);
 const newGrant=worker.leases.issue(f.owner.scope,{case_id:f.caseId,lifetime_ms:100000},audience),newLease=worker.leases.claim(newGrant.token,audience,10000),context=worker.returnContext(newGrant.token,audience,newLease.generation);
 assert.equal(context.operations[0].id,op.id);assert.equal(context.operations[0].receipt_id,op.receipt.id);assert.ok(context.blockers.some((b:any)=>b.id===op.id));
 await f.executor.reconcile(f.owner.scope,op.id);
 // An adversarial closed-RMA display remains unrelated to the accepted, unsettled
 // payment. This is source-state test administration, not a cancellation approval.
 const closure={state:'cancelled',reason:'adversarial_closed_rma_display'};f.db.prepare('INSERT INTO commerce_return_closures VALUES(?,?,?,?,?,?,?,?,?,?)').run(f.a.tenant,f.a.store,f.request!.id,f.caseId,f.order().id,1,'cancelled',f.intake.read(f.a.scope,f.caseId).receipt_id,canonical(closure),contentDigest(closure));
 assert.throws(()=>f.refunds.render(f.owner.scope,f.caseId,op.id,'return_refund_completed_v1'),/REFUND_NOT_SETTLED/);f.db.prepare('DELETE FROM commerce_return_closures WHERE request_id=?').run(f.request!.id);
 f.advance(1);f.gatewaySource.settle(op.id);await f.executor.reconcile(f.owner.scope,op.id);
 const queued=f.support.delivery.queue(f.owner.scope,f.message(op.id));f.mailSource.fault='after';assert.equal((await f.support.delivery.dispatch(f.owner.scope,queued.operation_id)).state,'unknown');
 f.support.ownership.takeover(f.a.scope,{case_id:f.caseId,expected_generation:2,reason:'operator_requested'});assert.equal(f.support.delivery.queue(f.a.scope,f.message(op.id)).operation_id,queued.operation_id);
 await f.support.delivery.reconcile(f.a.scope,queued.operation_id);await f.support.delivery.dispatch(f.a.scope,queued.operation_id);await f.executor.dispatch(f.a.scope,op.id);event.receive('second_delivery_same_order');
 assert.equal(count(f.gatewayDb,'fixture_woo_gateway_refunds'),1);assert.equal(count(f.mailDb,'support_source_effects'),1);assert.equal(count(f.db,'commerce_resolution_operations'),1);assert.equal(f.mailSource.calls,1);
}));
test('M07-G03-PORT-018-RMA-CLOSURE-CANNOT-CONFIRM-MANUAL-REFUND',()=>usingReturnPortability(async f=>{
 const op=f.approved();await f.executor.dispatch(f.a.scope,op.id);const closure={state:'cancelled',reason:'adversarial_closed_rma_display'};f.db.prepare('INSERT INTO commerce_return_closures VALUES(?,?,?,?,?,?,?,?,?,?)').run(f.a.tenant,f.a.store,f.request!.id,f.caseId,f.order().id,1,'cancelled',f.intake.read(f.a.scope,f.caseId).receipt_id,canonical(closure),contentDigest(closure));
 assert.equal(f.executor.read(f.a.scope,op.id).state,expected.manual.state);assert.throws(()=>f.refunds.render(f.a.scope,f.caseId,op.id,'return_refund_completed_v1'),/REFUND_NOT_SETTLED/);assert.throws(()=>f.support.delivery.queue(f.a.scope,f.message(op.id)),/REFUND_NOT_SETTLED/);
 const pending=f.refunds.render(f.a.scope,f.caseId,op.id,'return_refund_pending_v1');assert.match(pending.text,/External settlement is pending/);assert.equal(count(f.mailDb,'support_source_effects'),expected.manual.completion_messages);assert.equal(count(f.gatewayDb,'fixture_woo_gateway_movements'),0);
},{manual:true}));
test('M07-G03-COMPLETION-REQUIRES-BOTH-STORE-AND-GATEWAY-EVIDENCE',()=>usingReturnPortability(async f=>{
 const op=f.approved(),refund=f.gatewaySource.refund.bind(f.gatewaySource);f.gatewaySource.refund=async command=>{await refund(command);throw Error('store_did_not_observe_gateway_response');};await f.executor.dispatch(f.a.scope,op.id);f.gatewaySource.settle(op.id);await f.executor.reconcile(f.a.scope,op.id);
 assert.throws(()=>f.refunds.render(f.a.scope,f.caseId,op.id,'return_refund_completed_v1'),/REFUND_NOT_SETTLED/);assert.equal(count(f.sourceDb,'fixture_woo_refund_records'),0);assert.equal(count(f.gatewayDb,'fixture_woo_gateway_movements'),1);
}));
test('M07-G03-REFUND-SOURCE-RECHECKED-IMMEDIATELY-BEFORE-SEND',()=>usingReturnPortability(async f=>{
 const op=f.approved();await settle(f,op);const q=f.support.delivery.queue(f.a.scope,f.message(op.id));await assert.rejects(()=>f.support.delivery.dispatch(f.a.scope,q.operation_id,{beforeFinal:async()=>{f.gatewayDb.prepare('DELETE FROM fixture_woo_gateway_movements WHERE operation_id=?').run(op.id);}}),/WOO_GATEWAY_SOURCE_MISSING|WOO_GATEWAY_SETTLEMENT_UNVERIFIED/);assert.equal(count(f.mailDb,'support_source_effects'),0);assert.equal(f.support.delivery.inspect(f.a.scope,q.operation_id).state,'suppressed');
}));
test('M07-G03-REFUND-MESSAGE-STALE-SOURCE-AND-CROSS-TENANT-BLOCKED',()=>usingReturnPortability(async f=>{
 const op=f.approved();await settle(f,op);assert.throws(()=>f.refunds.read(f.b.scope,f.caseId,op.id),/NOT_FOUND/);f.advance(300001);assert.throws(()=>f.refunds.render(f.a.scope,f.caseId,op.id,'return_refund_completed_v1'),/REFUND_MESSAGE_STALE|WOO_SOURCE_STALE|SOURCE_STALE/);assert.equal(count(f.mailDb,'support_source_effects'),0);
}));
test('M07-G03-CUSTOMER-CONTEXT-DOES-NOT-EXPORT-STAFF-AUTHORIZATION',()=>usingReturnPortability(async f=>{
 f.approved();await withPortabilityServer(f,async post=>{const r=await post('/v1/return-portability/context',{case_id:f.caseId},f.customerBearer);assert.equal(r.status,200);assert.deepEqual(r.body.previews,[]);assert.deepEqual(r.body.operations,[]);assert.deepEqual(r.body.allocations,[]);assert.deepEqual(r.body.deliveries,[]);assert.equal((await post('/v1/return-portability/context',{case_id:f.caseId},null)).status,403);});
}));
test('M07-G03-EXPLICIT-READ-RESTRICTIONS-APPLY-WITHOUT-AN-EXECUTOR',()=>usingReturnPortability(f=>{
 const op=f.approved();f.permissions.change(f.owner.scope,{actor_id:'operator',role:'operator',expected_revision:0,actions:['case.read','resource.read','skill.read','profile.read','policy.read','return.read','support.read','capability.read'],resource_ids:null});assert.throws(()=>f.executor.read(f.a.scope,op.id),/ACCESS_DENIED/);
 for(const executor of [null,f.executor]){const result=new ReturnPortabilityApi(f.kernel,f.reads,executor,null).context(f.a.scope,{case_id:f.caseId});assert.deepEqual(result.operations,[]);assert.deepEqual(result.allocations,[]);assert.deepEqual(result.previews,[]);assert.deepEqual(result.deliveries,[]);}
}));
test('M07-G03-AGENT-ACTIONS-REQUIRE-QUALIFICATION-MODE-AND-CURRENT-REVIEW',()=>usingReturnPortability(f=>{
 f.support.ownership.assign(f.owner.scope,{case_id:f.caseId,expected_generation:1,actor_id:f.agent.actor});const quote=f.intake.evaluate(f.customer,f.selection());assert.throws(()=>f.prepare(quote,'without_mode',f.agent.scope),/SUPPORT_CONFIGURATION_MISSING/);
 const {proof}=configurePortabilityAgent(f,'diagnostic.return.submit'),request=f.prepare(quote,'qualified_agent',f.agent.scope);assert.throws(()=>f.gateway.execute(f.agent.scope,{preview_id:request.preview_id,preview_digest:request.preview_digest,approval_id:'invented'}),/APPROVAL_UNAVAILABLE/);
 const approval=f.gateway.approve(f.reviewer.scope,{preview_id:request.preview_id,preview_digest:request.preview_digest});f.support.qualification.revoke(f.owner.scope,proof.id,proof.version);assert.throws(()=>f.gateway.execute(f.agent.scope,{preview_id:request.preview_id,preview_digest:request.preview_digest,approval_id:approval.id}),/SUPPORT_CONFIGURATION_UNAVAILABLE/);assert.equal(count(f.db,'commerce_action_receipts'),0);assert.equal(count(f.gatewayDb,'fixture_woo_gateway_refunds'),0);
},{deferRequest:true}));
test('M07-G03-AGENT-COPILOT-AMOUNT-AND-WRONG-ACTION-REMAIN-BLOCKED',async()=>{for(const scenario of ['copilot','amount','wrong_action'])await usingReturnPortability(f=>{
 f.support.ownership.assign(f.owner.scope,{case_id:f.caseId,expected_generation:1,actor_id:f.agent.actor});configurePortabilityAgent(f,scenario==='wrong_action'?'diagnostic.return.resolve':'diagnostic.return.submit',{mode:scenario==='copilot'?'copilot':'approval_required',maximum_minor:scenario==='amount'?'0':'2000'});
 const quote=f.intake.evaluate(f.customer,f.selection());if(scenario==='wrong_action')assert.throws(()=>f.prepare(quote,'wrong_action',f.agent.scope),/QUALIFICATION_CASE_MISMATCH/);
 else{const r=f.prepare(quote,'bounded_agent',f.agent.scope),a=f.gateway.approve(f.reviewer.scope,{preview_id:r.preview_id,preview_digest:r.preview_digest});assert.throws(()=>f.gateway.execute(f.agent.scope,{preview_id:r.preview_id,preview_digest:r.preview_digest,approval_id:a.id}),scenario==='copilot'?/SUPPORT_MODE_DENIED/:/AUTOMATION_LIMIT/);}
 assert.equal(count(f.db,'commerce_action_receipts'),0);assert.equal(count(f.gatewayDb,'fixture_woo_gateway_refunds'),0);
 },{deferRequest:true});});
test('M07-G03-INVENTORY-HTTP-REPORTS-CURRENT-SCHEMA-TO-AUTHORIZED-OWNER',()=>usingReturnPortability(async f=>{
 await withPortabilityServer(f,async(_post,app)=>{const get=async(bearer:string)=>{const r=await fetch(app.url+'/v1/privacy/inventory',{headers:{authorization:'Bearer '+bearer}});return {status:r.status,body:await r.json()};};const owner=await get(f.owner.bearer);assert.equal(owner.status,200);assert.equal(owner.body.tables.length,178);assert.equal(owner.body.version,2);assert.equal((await get(f.a.bearer)).status,403);});
}));
test('M07-G03-PRIVACY-CURRENT-INVENTORY-INCLUDES-ALL-170-TABLES',()=>usingReturnPortability(f=>{
 const legacy=storageInventory(f.kernel),current=storageInventoryCurrent(f.kernel);assert.equal(legacy.view_version,1);assert.equal(legacy.tables.length,167);assert.equal(legacy.current_table_count,178);assert.equal(current.version,2);assert.equal(current.tables.length,178);assert.equal(current.schema_digest,'d3db27ee01179ab0b7dc38afdc890a5470b21ebae0b84ca1a72e645ad1948579');
 const actual=f.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r:any)=>({name:r.name,columns:f.db.prepare('PRAGMA table_info('+r.name+')').all().map((c:any)=>c.name)}));assert.equal(contentDigest(actual),current.schema_digest);
 f.db.exec('ALTER TABLE commerce_woo_event_observations ADD COLUMN covert_note TEXT');for(const inventory of [storageInventory,storageInventoryCurrent])assert.throws(()=>inventory(f.kernel),/STORAGE_INVENTORY_CHANGED/);
}));
test('M07-G03-PRIVACY-ERASES-WOO-CACHES-AND-REFUND-MESSAGE-COPIES',()=>usingReturnPortability(async f=>{
 const op=f.approved();await settle(f,op);const q=f.support.delivery.queue(f.a.scope,f.message(op.id)),event=wooEventFixture({...f,source:f.returnSource}),received=event.receive();event.events.process(f.a.scope,received.id);
 const p=new PrivacyLifecycle(f.kernel),customer=f.order().customer_id,exported=p.export(f.owner.scope,customer);assert.equal(exported.woocommerce_records.commerce_woo_return_sources.length,1);assert.equal(exported.woocommerce_records.commerce_woo_rma_bindings.length,1);assert.equal(exported.woocommerce_records.commerce_woo_event_observations.length,1);
 p.erase(f.owner.scope,customer);assert.equal(count(f.db,'commerce_woo_return_sources'),0);assert.equal(count(f.db,'commerce_woo_event_observations'),0);assert.equal(JSON.parse(f.db.prepare('SELECT body FROM commerce_woo_rma_bindings').get()!.body).redacted,true);assert.equal(JSON.parse(f.db.prepare('SELECT body FROM commerce_support_deliveries WHERE operation_id=?').get(q.operation_id)!.body).redacted,true);await assert.rejects(()=>f.support.delivery.dispatch(f.a.scope,q.operation_id));
 assert.equal(count(f.mailDb,'support_source_effects'),0);assert.equal(count(f.gatewayDb,'fixture_woo_gateway_movements'),1);
}));
