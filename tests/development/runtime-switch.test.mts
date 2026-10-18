import test from 'node:test';
import assert from 'node:assert/strict';
import { usingResolution } from './resolution-helpers.mts';
import { WorkerApi } from '../../packages/commerce/worker-api.mts';
import { usingReturns } from './return-intake-helpers.mts';
import { runtimeHarness,runtimeClient,secondOperator } from './runtime-switch-helpers.mts';
import { readFileSync } from 'node:fs';
import { ExecutionStops } from '../../packages/commerce/execution-stops.mts';
import { DatabaseSync } from 'node:sqlite';
import { CommerceKernel } from '../../packages/commerce/kernel.mts';
import { ResolutionExecution } from '../../packages/commerce/resolution-execution.mts';
import { ResolutionFixtureSource } from '../../packages/adapters/resolution-fixture-source.mts';

const expected=JSON.parse(readFileSync(new URL('../fixtures/runtime-switch/expected.v1.json',import.meta.url),'utf8'));
function originalPins(f:any,caseId='resolution_case'){
 const c=f.cases.inspect(f.a.scope,caseId);return {configuration_digest:c.configuration_digest,skill_digest:c.pins.skill.digest,policy_digest:c.pins.policy.digest,profile_digest:c.pins.profile.sha256};
}
function checkPins(result:any,pins:any){for(const [name,value] of Object.entries(pins))assert.equal(result[name],value);assert.equal(result.provider_thread_used,expected.provider_thread_used);}
function authorizations(f:any){const plan=f.allocate(),quote=f.quote(plan.allocations[0]),preview=f.gateway.prepare(f.a.scope,quote.proposal),approval=f.gateway.approve(f.reviewer.scope,{preview_id:preview.id,preview_digest:preview.digest});return {plan,quote,preview,approval};}
function counts(f:any){return {previews:f.db.prepare('SELECT count(*) n FROM commerce_action_previews').get().n,approvals:f.db.prepare('SELECT count(*) n FROM commerce_action_approvals').get().n,
 operations:f.db.prepare('SELECT count(*) n FROM commerce_resolution_operations').get().n,effects:f.sourceDb.prepare('SELECT count(*) n FROM fixture_resolution_effects').get().n};}

test('M07-G04-UNKNOWN-FINANCIAL-OPERATION-IN-HANDOVER',()=>usingResolution(async f=>{
 const plan=f.allocate(),authorized=f.authorize(f.quote(plan.allocations[0])),issue=f.source.issue.bind(f.source);
 f.source.issue=async input=>{await issue(input);throw new Error('synthetic_lost_response');};
 assert.equal((await f.executor.dispatch(f.a.scope,authorized.id)).state,'unknown');
 const api=new WorkerApi(f.kernel),audience='http://127.0.0.1:9934/v1/worker';
 const grant=api.leases.issue(f.a.scope,{case_id:'resolution_case',lifetime_ms:100000},audience),lease=api.leases.claim(grant.token,audience,10000);
 const context=api.context(grant.token,audience,lease.generation);
 assert.deepEqual(context.blockers.map(row=>({id:row.id,state:row.state})),[{id:authorized.id,state:'unknown'}]);
 assert.equal(f.sourceDb.prepare('SELECT count(*) n FROM fixture_resolution_effects').get().n,1);
}));

test('CASE-M07-G04-01',()=>usingReturns(async f=>{
 const request=f.prepare(),approval=f.gateway.approve(f.reviewer.scope,{preview_id:request.preview_id,preview_digest:request.preview_digest}),pins=originalPins(f,'case_one'),next=secondOperator(f),server=await runtimeHarness(f,'case_one');
 try{
  const first=server.grant(),observed=await runtimeClient('typescript',server,first,{mode:'inspect'});
  assert.equal(observed.runtime_id,expected.runtime_ids[0]);assert.equal(observed.generation,expected.handover.first_generation);assert.equal(observed.state.return_request.state,expected.approved_return.before);checkPins(observed,pins);
  assert.equal(observed.state.previews[0].approval.id,approval.id);assert.equal(observed.actions.length,0);
  server.api.leases.release(f.owner.scope,'case_one');
  const second=server.grant(next.scope),continued=await runtimeClient('python',server,second);
  assert.equal(continued.runtime_id,expected.runtime_ids[1]);assert.equal(continued.generation,expected.handover.replacement_generation);checkPins(continued,pins);
  assert.equal(continued.state.return_request.id,request.id);assert.equal(continued.state.return_request.state,expected.approved_return.after);
  assert.equal(continued.actions[0].preview_id,request.preview_id);assert.equal(continued.actions[0].approval_id,approval.id);
  assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_action_receipts').get().n,expected.approved_return.new_receipts);
  assert.equal(f.db.prepare('SELECT uses FROM commerce_action_approvals WHERE id=?').get(approval.id).uses,expected.approved_return.approval_uses);
  assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_resolution_operations').get().n,expected.approved_return.financial_effects);
  assert.ok(server.trace.some(row=>row.path==='/v1/worker/return-action'));
 }finally{await server.close();}
}));

test('CASE-M07-G04-02',()=>usingResolution(async f=>{
 const prepared=authorizations(f),pins=originalPins(f),next=secondOperator(f),server=await runtimeHarness(f);
 try{
  const first=server.grant(),done=await runtimeClient('typescript',server,first,{max_actions:1}),oldEnvelope=server.context(first,done.generation).envelope;
  assert.equal(done.actions[0].approval_id,prepared.approval.id);const receipt=done.state.receipts.find((r:any)=>r.approval_id===prepared.approval.id),before=counts(f);
  server.api.leases.release(f.owner.scope,'resolution_case');
  await assert.rejects(()=>server.api.returnAction(first.token,server.audience,{generation:done.generation,envelope:oldEnvelope,action:'approved-preview.execute',arguments:{preview_id:prepared.preview.id,preview_digest:prepared.preview.digest,approval_id:prepared.approval.id}}),/WORK_ACCESS_DENIED/);
  const second=server.grant(next.scope),resumed=await runtimeClient('python',server,second,{mode:'inspect'});checkPins(resumed,pins);
  const replay=await server.action(second,resumed.generation,'approved-preview.execute',{preview_id:prepared.preview.id,preview_digest:prepared.preview.digest,approval_id:prepared.approval.id});
  assert.equal(replay.replayed,true);assert.deepEqual(replay.receipt,receipt);assert.deepEqual(counts(f),before);
  assert.equal(resumed.state.operations[0].id,receipt.resolution_operation_id);assert.equal(resumed.state.operations[0].receipt_id,receipt.id);
  assert.equal(f.db.prepare('SELECT uses FROM commerce_action_approvals WHERE id=?').get(prepared.approval.id).uses,1);
 }finally{await server.close();}
}));

test('CASE-M07-G04-03',()=>usingResolution(async f=>{
 const prepared=authorizations(f),pins=originalPins(f),next=secondOperator(f),server=await runtimeHarness(f),issue=f.source.issue.bind(f.source);let sends=0,lookups=0;
 f.source.issue=async input=>{sends++;await issue(input);throw new Error('synthetic_lost_response');};const lookup=f.source.lookup.bind(f.source);f.source.lookup=async id=>{lookups++;return lookup(id);};
 try{
  const first=server.grant(),unknown=await runtimeClient('typescript',server,first,{max_actions:2}),operation=unknown.state.operations[0];
  assert.equal(operation.state,'unknown');assert.equal(operation.amount_minor,expected.original_refund.amount_minor);assert.equal(operation.currency,expected.original_refund.currency);assert.equal(sends,1);
  const original=f.db.prepare('SELECT id,receipt_id,allocation_id FROM commerce_resolution_operations').get();
  assert.equal(operation.id,original.id);assert.equal(operation.receipt_id,original.receipt_id);assert.equal(operation.allocation_id,original.allocation_id);
  assert.equal(unknown.state.blockers[0].id,operation.id);assert.equal(lookups,0);const before=counts(f),approvalId=prepared.approval.id,receipt=unknown.state.receipts.find((r:any)=>r.approval_id===approvalId);
  server.api.leases.release(f.owner.scope,'resolution_case');const second=server.grant(next.scope);
  const lease=server.api.leases.claim(second.token,server.audience,30000),context=server.context(second,lease.generation);
  assert.equal(context.operations[0].id,operation.id);assert.equal(context.previews.find((p:any)=>p.id===prepared.preview.id).approval.id,approvalId);
  await assert.rejects(()=>server.action(second,lease.generation,'resolution.dispatch',{operation_id:operation.id}),/RECONCILIATION_REQUIRED/);
  f.source.settle(operation.id);
  const recovered=await runtimeClient('python',server,second);checkPins(recovered,pins);
  assert.equal(recovered.actions[0].action,expected.required_unknown_first_action);assert.equal(recovered.actions[0].operation_id,operation.id);
  assert.equal(recovered.state.operations[0].state,'settled');assert.equal(recovered.state.operations[0].cash_settled,true);assert.equal(recovered.state.operations[0].id,operation.id);
  assert.deepEqual(recovered.state.receipts.find((r:any)=>r.approval_id===approvalId),receipt);assert.equal(lookups,1);assert.equal(sends,1);assert.deepEqual(counts(f),before);
  const source=JSON.parse(f.sourceDb.prepare('SELECT body FROM fixture_resolution_effects WHERE operation_id=?').get(operation.id).body);
  assert.equal(source.payment_id,expected.original_refund.payment_id);assert.equal(source.amount_minor,expected.original_refund.amount_minor);
  assert.equal(f.sourceDb.prepare('SELECT count(*) n FROM fixture_resolution_effects').get().n,expected.original_refund.source_effects);
 }finally{await server.close();}
}));

test('M07-G04-TEST-027-PYTHON-TO-TYPESCRIPT',()=>usingResolution(async f=>{
 const prepared=authorizations(f),pins=originalPins(f),next=secondOperator(f),server=await runtimeHarness(f);
 try{
  const first=server.grant(),authorized=await runtimeClient('python',server,first,{max_actions:1}),id=authorized.state.operations[0].id;
  assert.equal(authorized.state.operations[0].state,'authorized');assert.equal(authorized.actions[0].approval_id,prepared.approval.id);
  server.api.leases.release(f.owner.scope,'resolution_case');const second=server.grant(next.scope),resumed=await runtimeClient('typescript',server,second);
  checkPins(resumed,pins);assert.equal(resumed.state.operations[0].id,id);assert.equal(resumed.state.operations[0].state,'accepted');assert.equal(resumed.state.operations[0].cash_settled,expected.known_pending_is_settled);
  assert.equal(f.sourceDb.prepare('SELECT count(*) n FROM fixture_resolution_effects').get().n,1);assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_resolution_operations').get().n,1);
 }finally{await server.close();}
}));

test('M07-G04-UNKNOWN-LOOKUP-DOES-NOT-SEND',()=>usingResolution(async f=>{
 const authorized=f.authorize(f.quote(f.allocate().allocations[0]));f.source.issue=async()=>{throw new Error('no_response');};await f.executor.dispatch(f.a.scope,authorized.id);
 const server=await runtimeHarness(f);try{
  const grant=server.grant(),result=await runtimeClient('python',server,grant);
  assert.equal(result.stop_reason,'unknown_outcome');assert.equal(result.actions.length,1);assert.equal(result.actions[0].action,'resolution.reconcile');
  assert.equal(result.state.operations[0].id,authorized.id);assert.equal(result.state.operations[0].state,'unknown');assert.equal(counts(f).effects,0);
 }finally{await server.close();}
}));

test('M07-G04-UNKNOWN-REFUND-BLOCKS-NEW-APPROVED-WRITE',()=>usingResolution(async f=>{
 const plan=f.allocate(),first=f.authorize(f.quote(plan.allocations[0])),secondQuote=f.credit.quote(f.a.scope,plan.allocations[1].id),pending=f.gateway.prepare(f.a.scope,secondQuote.proposal);
 const approval=f.gateway.approve(f.reviewer.scope,{preview_id:pending.id,preview_digest:pending.digest});f.source.issue=async()=>{throw new Error('unknown');};await f.executor.dispatch(f.a.scope,first.id);
 const server=await runtimeHarness(f);try{
  const grant=server.grant(),lease=server.api.leases.claim(grant.token,server.audience,30000),scope=server.api.leases.returnScoped(grant.token,server.audience,lease.generation).scope;
  assert.throws(()=>f.gateway.execute(scope,{preview_id:pending.id,preview_digest:pending.digest,approval_id:approval.id}),/RECONCILIATION_REQUIRED/);
  assert.equal(f.db.prepare('SELECT uses FROM commerce_action_approvals WHERE id=?').get(approval.id).uses,0);assert.equal(counts(f).operations,1);
 }finally{await server.close();}
}));

test('M07-G04-AGENT-ROLE-CANNOT-DISPATCH-OR-RECONCILE-MONEY',()=>usingResolution(async f=>{
 const op=f.authorize(f.quote(f.allocate().allocations[0])),server=await runtimeHarness(f);try{
  const grant=server.grant(f.agent.scope),lease=server.api.leases.claim(grant.token,server.audience,30000),context=server.context(grant,lease.generation);
  assert.deepEqual(context.allowed_actions,['approved-preview.execute']);
  await assert.rejects(()=>server.action(grant,lease.generation,'resolution.dispatch',{operation_id:op.id}),/ACCESS_DENIED/);
  await assert.rejects(()=>server.action(grant,lease.generation,'resolution.reconcile',{operation_id:op.id}),/ACCESS_DENIED/);
  assert.equal(counts(f).effects,0);assert.equal(f.executor.read(f.a.scope,op.id).state,'authorized');
 }finally{await server.close();}
}));

test('M07-G04-LEGACY-WORK-SCOPE-NOT-EXPANDED',()=>usingResolution(async f=>{
 const server=await runtimeHarness(f);try{const grant=server.grant(),lease=server.api.leases.claim(grant.token,server.audience,30000),old=server.api.leases.scoped(grant.token,server.audience,lease.generation).scope;
  for(const action of ['return.read','return.request','operation.dispatch','operation.reconcile'])assert.throws(()=>f.kernel.authorize(old,action,f.order().id),/WORK_SCOPE_DENIED/);
  assert.deepEqual(server.api.context(grant.token,server.audience,lease.generation).allowed_actions,['proposal.prepare','proposal.result','work.complete']);
 }finally{await server.close();}
}));

test('M07-G04-REVOKED-PARENT-AUTHORITY-BLOCKS-CONTINUATION',()=>usingResolution(async f=>{
 const prepared=authorizations(f),server=await runtimeHarness(f);try{
  const grant=server.grant(),lease=server.api.leases.claim(grant.token,server.audience,30000),envelope=server.context(grant,lease.generation).envelope;
  f.permissions.change(f.owner.scope,{actor_id:'operator',role:'operator',expected_revision:0,actions:['work.claim','case.read','resource.read','skill.read','policy.read','profile.read','capability.read','return.read','operation.read'],resource_ids:null});
  await assert.rejects(()=>server.api.returnAction(grant.token,server.audience,{generation:lease.generation,envelope,action:'approved-preview.execute',arguments:{preview_id:prepared.preview.id,preview_digest:prepared.preview.digest,approval_id:prepared.approval.id}}),/ACCESS_DENIED/);
  assert.equal(f.db.prepare('SELECT uses FROM commerce_action_approvals WHERE id=?').get(prepared.approval.id).uses,0);assert.equal(counts(f).operations,0);
 }finally{await server.close();}
}));

test('M07-G04-APPROVER-REVOCATION-SURVIVES-RUNTIME-SWITCH',()=>usingResolution(async f=>{
 const prepared=authorizations(f),next=secondOperator(f),server=await runtimeHarness(f);try{
  const grant=server.grant();await runtimeClient('typescript',server,grant,{mode:'inspect'});server.api.leases.release(f.owner.scope,'resolution_case');
  f.permissions.change(f.owner.scope,{actor_id:'reviewer',role:'reviewer',expected_revision:0,actions:['return.read'],resource_ids:null});
  const replacement=server.grant(next.scope),result=await runtimeClient('python',server,replacement);
  assert.equal(result.actions.length,0);assert.equal(result.stop_reason,'approval_or_repreview_required');
  await assert.rejects(()=>server.action(replacement,result.generation,'approved-preview.execute',{preview_id:prepared.preview.id,preview_digest:prepared.preview.digest,approval_id:prepared.approval.id}),/APPROVAL_AUTHORITY_CHANGED/);
  assert.equal(counts(f).operations,0);
 }finally{await server.close();}
}));

test('M07-G04-CROSS-CASE-REFERENCE-REJECTED',()=>usingResolution(async f=>{
 const prepared=authorizations(f),server=await runtimeHarness(f,'case_one');try{
  const grant=server.grant(),lease=server.api.leases.claim(grant.token,server.audience,30000);
  await assert.rejects(()=>server.action(grant,lease.generation,'approved-preview.execute',{preview_id:prepared.preview.id,preview_digest:prepared.preview.digest,approval_id:prepared.approval.id}),/NOT_FOUND/);
  const op=f.authorize(f.quote(prepared.plan.allocations[0]));
  await assert.rejects(()=>server.action(grant,lease.generation,'resolution.dispatch',{operation_id:op.id}),/NOT_FOUND/);assert.equal(counts(f).effects,0);
 }finally{await server.close();}
}));

test('M07-G04-ENVELOPE-FORGERY-CANNOT-RESET-IDENTITY',()=>usingResolution(async f=>{
 const prepared=authorizations(f),server=await runtimeHarness(f);try{
  const grant=server.grant(),lease=server.api.leases.claim(grant.token,server.audience,30000),envelope=server.context(grant,lease.generation).envelope;
  for(const field of ['case_id','configuration_digest','audience','tenant_id','store_id'])await assert.rejects(()=>server.api.returnAction(grant.token,server.audience,{generation:lease.generation,envelope:{...envelope,[field]:'changed'},action:'approved-preview.execute',arguments:{preview_id:prepared.preview.id,preview_digest:prepared.preview.digest,approval_id:prepared.approval.id}}),/WORK_ENVELOPE_REJECTED/);
  assert.equal(counts(f).operations,0);assert.equal(f.db.prepare('SELECT uses FROM commerce_action_approvals WHERE id=?').get(prepared.approval.id).uses,0);
 }finally{await server.close();}
}));

test('M07-G04-SUBSET-CANNOT-EXECUTE-CREDIT-PREVIEW',()=>usingResolution(async f=>{
 const plan=f.allocate(),quote=f.credit.quote(f.a.scope,plan.allocations[1].id),preview=f.gateway.prepare(f.a.scope,quote.proposal),approval=f.gateway.approve(f.reviewer.scope,{preview_id:preview.id,preview_digest:preview.digest}),server=await runtimeHarness(f);
 try{const grant=server.grant(),lease=server.api.leases.claim(grant.token,server.audience,30000);
  assert.equal(server.context(grant,lease.generation).previews.some((p:any)=>p.id===preview.id),false);
  await assert.rejects(()=>server.action(grant,lease.generation,'approved-preview.execute',{preview_id:preview.id,preview_digest:preview.digest,approval_id:approval.id}),/WORK_ACTION_UNAVAILABLE/);
  assert.equal(counts(f).operations,0);
 }finally{await server.close();}
}));

test('M07-G04-STOP-KEEPS-UNKNOWN-RECONCILIATION-AVAILABLE',()=>usingResolution(async f=>{
 const op=f.authorize(f.quote(f.allocate().allocations[0])),issue=f.source.issue.bind(f.source);f.source.issue=async input=>{await issue(input);throw new Error('lost');};await f.executor.dispatch(f.a.scope,op.id);
 new ExecutionStops(f.kernel).set(f.owner.scope,{action:'diagnostic.return.resolve',stopped:true,reason:'incident',expected_revision:0});
 const server=await runtimeHarness(f);try{const grant=server.grant(),result=await runtimeClient('typescript',server,grant);
  assert.equal(result.actions[0].action,'resolution.reconcile');assert.equal(result.state.operations[0].id,op.id);assert.equal(result.state.operations[0].state,'accepted');assert.equal(counts(f).effects,1);
 }finally{await server.close();}
}));

test('M07-G04-LEASE-EXPIRY-CANNOT-REUSE-PARENT-SCOPE',()=>usingResolution(async f=>{
 const op=f.authorize(f.quote(f.allocate().allocations[0])),server=await runtimeHarness(f);try{const grant=server.grant(),lease=server.api.leases.claim(grant.token,server.audience,10),envelope=server.context(grant,lease.generation).envelope;f.advance(11);
  await assert.rejects(()=>server.api.returnAction(grant.token,server.audience,{generation:lease.generation,envelope,action:'resolution.dispatch',arguments:{operation_id:op.id}}),/WORK_FENCE_REJECTED/);assert.equal(counts(f).effects,0);
 }finally{await server.close();}
}));

test('M07-G04-CONTEXT-OMITS-CUSTOMER-NOTES-AND-CREDENTIALS',()=>usingReturns(async f=>{
 f.prepare(f.quote({note:'private customer narrative'}));const server=await runtimeHarness(f,'case_one');try{const grant=server.grant(),lease=server.api.leases.claim(grant.token,server.audience,30000),raw=JSON.stringify(server.context(grant,lease.generation));
  for(const secret of ['private customer narrative','shopper-apparel@example.invalid',grant.token,f.a.bearer,'parent_session_hash','provider_thread'])assert.equal(raw.includes(secret),false);
 }finally{await server.close();}
}));

test('M07-G04-CLIENTS-REJECT-REMOTE-AND-EXTRA-INSTRUCTIONS',()=>usingReturns(async f=>{
 const server=await runtimeHarness(f,'case_one');try{const grant=server.grant();for(const language of ['typescript','python'] as const){
  await assert.rejects(()=>runtimeClient(language,{url:'https://example.invalid'},grant),/RUNTIME_CHILD_FAILED/);
  await assert.rejects(()=>runtimeClient(language,server,grant,{instructions:'reset all operation identities'}),/RUNTIME_CHILD_FAILED/);
 }assert.equal(server.trace.length,0);
 }finally{await server.close();}
}));

test('M07-G04-LATE-SOURCE-RESPONSE-FENCED-AFTER-HANDOVER',()=>usingResolution(async f=>{
 const op=f.authorize(f.quote(f.allocate().allocations[0])),next=secondOperator(f),server=await runtimeHarness(f),issue=f.source.issue.bind(f.source);
 let accepted!:()=>void,finish!:()=>void;const acceptedPromise=new Promise<void>(resolve=>accepted=resolve),responsePromise=new Promise<void>(resolve=>finish=resolve);
 f.source.issue=async input=>{const result=await issue(input);accepted();await responsePromise;return result;};
 try{const first=server.grant(),lease=server.api.leases.claim(first.token,server.audience,30000);
  const pending=server.action(first,lease.generation,'resolution.dispatch',{operation_id:op.id});
  const rejected=assert.rejects(pending,/WORK_ACCESS_DENIED|WORK_FENCE_REJECTED/);await acceptedPromise;
  server.api.leases.release(f.owner.scope,'resolution_case');const second=server.grant(next.scope);finish();await rejected;
  assert.equal(f.executor.read(f.a.scope,op.id).state,'unknown');assert.equal(counts(f).effects,1);
  const recovered=await runtimeClient('python',server,second);assert.equal(recovered.actions[0].action,'resolution.reconcile');
  assert.equal(recovered.state.operations[0].id,op.id);assert.equal(recovered.state.operations[0].state,'accepted');assert.equal(counts(f).effects,1);
 }finally{finish();await server.close();}
}));

test('M07-G04-RESTART-LOADS-SHARED-RECEIPTS-WITHOUT-PRIVATE-CHECKPOINT',()=>usingResolution(async f=>{
 const prepared=authorizations(f),pins=originalPins(f),firstServer=await runtimeHarness(f);let first:any;
 try{first=await runtimeClient('typescript',firstServer,firstServer.grant(),{max_actions:1});firstServer.api.leases.release(f.owner.scope,'resolution_case');}
 finally{await firstServer.close();}
 const db=new DatabaseSync(f.filename),sourceDb=new DatabaseSync(f.sourceFilename),kernel=new CommerceKernel(db,f.now),source=new ResolutionFixtureSource(sourceDb,{mode:'fixture',identity:'source-one',tenant:f.a.tenant,store:f.a.store});
 const executor=new ResolutionExecution(kernel,source),scope=kernel.authenticate(f.a.bearer),restored={kernel,executor,a:{...f.a,scope}},secondServer=await runtimeHarness(restored);
 try{const second=await runtimeClient('python',secondServer,secondServer.grant());checkPins(second,pins);
  assert.equal(second.state.operations[0].id,first.state.operations[0].id);assert.equal(second.state.operations[0].receipt_id,first.state.operations[0].receipt_id);
  assert.equal(second.state.previews.find((p:any)=>p.id===prepared.preview.id).approval.id,prepared.approval.id);
  assert.equal(second.state.operations[0].state,'accepted');assert.equal(counts(f).effects,1);
 }finally{await secondServer.close();sourceDb.close();db.close();}
}));

test('M07-G04-MIGRATION-REQUIRES-NEW-PREVIEW-AND-LEASE',()=>usingResolution(async f=>{
 const prepared=authorizations(f),server=await runtimeHarness(f);try{const first=server.grant(),lease=server.api.leases.claim(first.token,server.audience,30000),old=server.context(first,lease.generation).envelope;
  f.cases.migrate(f.owner.scope,'resolution_case',{expected_revision:1,profile_id:'default',policy_id:'returns',reason:'approved_update'});
  assert.throws(()=>server.context(first,lease.generation),/WORK_CONTEXT_CHANGED/);
  await assert.rejects(()=>server.api.returnAction(first.token,server.audience,{generation:lease.generation,envelope:old,action:'approved-preview.execute',arguments:{preview_id:prepared.preview.id,preview_digest:prepared.preview.digest,approval_id:prepared.approval.id}}),/WORK_CONTEXT_CHANGED/);
  server.api.leases.release(f.owner.scope,'resolution_case');const second=server.grant(),result=await runtimeClient('python',server,second);
  assert.equal(result.actions.length,0);assert.equal(result.stop_reason,'approval_or_repreview_required');assert.equal(counts(f).operations,0);
 }finally{await server.close();}
}));

test('M07-G04-REPLAY-WITH-DIFFERENT-APPROVAL-IS-NOT-A-NEW-RECEIPT',()=>usingResolution(async f=>{
 const prepared=authorizations(f),server=await runtimeHarness(f);try{const grant=server.grant(),done=await runtimeClient('typescript',server,grant,{max_actions:1}),before=counts(f);
  await assert.rejects(()=>server.action(grant,done.generation,'approved-preview.execute',{preview_id:prepared.preview.id,preview_digest:prepared.preview.digest,approval_id:'invented-approval'}),/WORK_IDEMPOTENCY_CONFLICT/);
  assert.deepEqual(counts(f),before);
 }finally{await server.close();}
}));
