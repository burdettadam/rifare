import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {linkSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {CommerceKernel} from '../../packages/commerce/kernel.mts';
import {LoyaltyBalances} from '../../packages/commerce/loyalty-balances.mts';
import {LoyaltyFixtureSource} from '../../packages/adapters/loyalty-fixture-source.mts';
import {LoyaltyRedemptionFixtureSource} from '../../packages/adapters/loyalty-redemption-fixture-source.mts';
import {LoyaltyRedemptions} from '../../packages/commerce/loyalty-redemptions.mts';
import {ActionGateway} from '../../packages/commerce/action-gateway.mts';
import {BusinessOperations,queueOperation,transitionOperation} from '../../packages/commerce/operation-store.mts';
import {DurableWork} from '../../packages/commerce/durable-work.mts';
import {Reconciliation} from '../../packages/commerce/reconciliation.mts';
import {ExecutionStops} from '../../packages/commerce/execution-stops.mts';
import {ExceptionQueue} from '../../packages/commerce/exception-queue.mts';
import {WorkerApi} from '../../packages/commerce/worker-api.mts';
import {SyntheticJournal} from '../../packages/adapters/reliability/synthetic-journal.mts';
import {SupportService} from '../../packages/commerce/support-service.mts';
import {PrivacyLifecycle} from '../../packages/commerce/privacy-lifecycle.mts';
import {suppressionCheckpoint} from '../../packages/commerce/safe-recovery.mts';
import {canonical,contentDigest} from '../../packages/commerce/configuration-values.mts';
import {snapshot as balanceInput} from './loyalty-balances-helpers.mts';
import {changedMerchant,changedRecovery} from './shopper-memory-helpers.mts';
import {EXPECTED,ACTION,QUOTE_KIND,OP_KIND,COMMAND_FIELDS,RESULT_FIELDS,usingRedemption,otherCase,input,context,quote,prepared,approved,execute,reserve,
  availability,unspendable,count,documentRows,operationDocument,nativeOperation,nativeWork,writeDocument,restoreDocument,sourceJournal,sourceSnapshots,sourceState,
  assertBalances,assertDebit,projection,finances,nativeState,withSourceMethod,minimized,retireCurrentSubject,backup,restore,merchant,suppression,target,transfer,raceApprovals} from './loyalty-redemption-helpers.mts';
import type {Value} from './loyalty-redemption-helpers.mts';

// ADR-0060 tests-first freeze: exactly 20 native cases. All expected quantities
// come from the separately authored finite fixture, never a runtime calculator.
const executeInput=(p:Value)=>({preview_id:p.p.id,preview_digest:p.p.digest,approval_id:p.a.id});
const receiptRows=(db:DatabaseSync,id:string)=>db.prepare('SELECT * FROM commerce_operation_receipts WHERE operation_id=? ORDER BY seq').all(id) as Value[];
const proofRow=(f:any)=>f.db.prepare('SELECT * FROM commerce_sessions WHERE token_hash=?').get(f.kernel.require(f.customer).token_hash) as Value;

test('CASE-M19-G03-01',()=>usingRedemption(async f=>{
  const other=otherCase(f,'redemption_other_order',true);assert.notEqual(other.resource_id,f.subject.resource_id);
  const requests=[approved(f),approved(f,400,other)],results=await raceApprovals(f,requests);
  assert.equal(results.filter(r=>r.ok).length,1,'separate processes cannot reserve800 from the same600 entitlement');
  const winnerIndex=results.findIndex(r=>r.ok),loserIndex=1-winnerIndex,id=results[winnerIndex].operation_id;
  assert.equal(typeof id,'string');assert.equal(results[loserIndex].error,'LOYALTY_INSUFFICIENT_POINTS');
  assert.equal(count(f.db,'commerce_operations'),1);assert.equal(documentRows(f.db,OP_KIND).length,1);assert.equal(sourceJournal(f).length,0);
  assert.equal(f.db.prepare('SELECT uses FROM commerce_action_approvals WHERE id=?').get(requests[winnerIndex].a.id).uses,1);
  assert.equal(f.db.prepare('SELECT uses FROM commerce_action_approvals WHERE id=?').get(requests[loserIndex].a.id).uses,0);
  const unused=documentRows(f.db,QUOTE_KIND).find(r=>r.id===requests[loserIndex].q.id)!;assert.equal(JSON.parse(unused.body).consumed_by,null);
  availability(context(f),EXPECTED.availability.reserved_400);availability(context(f,other),EXPECTED.availability.reserved_400);
  f.redemptionSource.setMode('timeout_before_effect');projection(f.redemptions.dispatch(f.scope,id),'unknown');
  f.advance(EXPECTED.advance_beyond_reservation_ms);f.closeCore();const reopened=f.reopen();
  try{
    projection(reopened.redemptions.expire(reopened.scope,id),'unknown');
    const recovered=reopened.redemptions.reconcile(reopened.scope,id);assert.equal(recovered.disposition,'unconfirmed');assert.equal(recovered.command_repeated,false);projection(recovered.operation,'unknown');
    assert.equal(reopened.redemptionSource.lookup(id),null);
    availability(context(reopened),EXPECTED.availability.unknown_before_effect);
    const before=documentRows(reopened.db,QUOTE_KIND).length;
    assert.throws(()=>quote(reopened),/LOYALTY_INSUFFICIENT_POINTS/);assert.equal(documentRows(reopened.db,QUOTE_KIND).length,before);
    assert.equal(nativeWork(reopened.db,id).attempts,1);assert.equal(count(reopened.db,'commerce_operations'),1);
  }finally{reopened.close();}
  assertBalances(f,EXPECTED.baseline,1);assert.equal(sourceJournal(f).length,0);
}));

test('CASE-M19-G03-02',()=>usingRedemption(f=>{
  const p=reserve(f),beforeMoney=finances(f);f.redemptionSource.setMode('timeout_after_effect');let sends=0;
  withSourceMethod(f.redemptionSource,'redeem',(send,command)=>{
    sends++;assert.equal(command.operation_id,p.id);
    const independent=new DatabaseSync(f.filename);
    try{assert.equal(nativeOperation(independent,p.id).state,'unknown');assert.equal(nativeWork(independent,p.id).attempts,1);
      const b=JSON.parse(operationDocument(independent,p.id).body);assert.equal(b.state,'unknown');assert.equal(b.attempt_count,1);
      independent.exec('PRAGMA busy_timeout=0');assert.throws(()=>independent.prepare('UPDATE commerce_action_approvals SET revoked=1 WHERE id=?').run(p.a.id),/locked|busy/i,'a second core writer cannot revoke authority between the final check and synchronous provider call');
      assert.equal(independent.prepare('SELECT revoked FROM commerce_action_approvals WHERE id=?').get(p.a.id).revoked,0);}
    finally{independent.close();}
    return send(command);
  },()=>{projection(f.redemptions.dispatch(f.scope,p.id),'unknown');projection(f.redemptions.dispatch(f.scope,p.id),'unknown');});
  assert.equal(sends,1);const booked=assertDebit(f,p.id,EXPECTED.source_debits[0]);assertBalances(f,EXPECTED.after_400,2);
  const originalResult=structuredClone(booked.result),originalCommand=structuredClone(booked.command);
  const alias=new BusinessOperations(f.kernel).fromReceipt(f.scope,{receipt_id:p.receipt.id,idempotency_key:'different_retry_key',expected_receipt_digest:contentDigest(p.receipt)});
  assert.equal(alias.id,p.id);assert.equal(count(f.db,'commerce_operations'),1);
  f.advance(300001);projection(f.redemptions.expire(f.scope,p.id),'unknown');
  const r=f.redemptions.reconcile(f.scope,p.id);assert.equal(r.disposition,'reconciled');assert.equal(r.command_repeated,false);projection(r.operation,'redeemed');
  assert.deepEqual(f.redemptionSource.lookup(p.id),originalResult,'historical lookup preserves original timestamp and exact evidence after all quote/source terms expire');
  assert.equal(f.redemptions.reconcile(f.scope,p.id).disposition,'unchanged');
  f.redemptionSource.setMode('redeem');assert.deepEqual(f.redemptionSource.redeem(originalCommand),originalResult);
  assert.throws(()=>f.redemptionSource.redeem({...originalCommand,points:200}));
  assert.equal(sourceJournal(f).length,1);assert.equal(sourceSnapshots(f).length,2);assert.deepEqual(finances(f),beforeMoney);
  assert.equal(nativeOperation(f.db,p.id).state,'succeeded');assert.equal(nativeWork(f.db,p.id).state,'done');assert.equal(nativeWork(f.db,p.id).attempts,1);
}));

test('CASE-M19-G03-03',async()=>{
  for(const [mode,reason] of [['reject_insufficient','LOYALTY_INSUFFICIENT_POINTS'],['reject_unsupported','LOYALTY_REDEMPTION_UNSUPPORTED']])await usingRedemption(f=>{
    const p=reserve(f),before=finances(f);f.redemptionSource.setMode(mode);const r=f.redemptions.dispatch(f.scope,p.id);projection(r,'rejected');assert.equal(r.reason,reason);
    availability(context(f),EXPECTED.availability.initial);assertBalances(f,EXPECTED.baseline,1);
    const rows=sourceJournal(f);assert.equal(rows.length,1);const b=JSON.parse(rows[0].body),result=b.result;
    assert.deepEqual(Object.keys(result).sort(),RESULT_FIELDS);assert.equal(result.operation_id,p.id);assert.equal(result.points,400);assert.equal(result.state,'rejected');assert.equal(result.reason,reason);
    assert.equal(result.provider_ref,null);assert.equal(result.before_revision,1);assert.equal(result.after_revision,1);assert.equal(result.before_digest,result.after_digest);
    assert.equal(result.before_digest,sourceSnapshots(f)[0].digest);assert.deepEqual(finances(f),before);
    assert.equal(nativeOperation(f.db,p.id).state,'failed');assert.equal(nativeWork(f.db,p.id).state,'dead');assert.equal(nativeWork(f.db,p.id).attempts,1);
    const beforeReplay=nativeState(f.db,p.id),provider=sourceState(f);assert.deepEqual(f.redemptions.dispatch(f.scope,p.id),r);assert.deepEqual(nativeState(f.db,p.id),beforeReplay);assert.deepEqual(sourceState(f),provider);
  });
  await usingRedemption(f=>{
    const p=reserve(f);f.redemptionSource.setMode('timeout_before_effect');projection(f.redemptions.dispatch(f.scope,p.id),'unknown');
    f.advance(EXPECTED.advance_beyond_reservation_ms);assert.equal(f.redemptionSource.lookup(p.id),null);
    projection(f.redemptions.expire(f.scope,p.id),'unknown');assert.equal(f.redemptions.reconcile(f.scope,p.id).disposition,'unconfirmed');
    availability(context(f),EXPECTED.availability.unknown_before_effect);assert.throws(()=>quote(f),/LOYALTY_INSUFFICIENT_POINTS/);
    assert.equal(sourceJournal(f).length,0);assertBalances(f,EXPECTED.baseline,1);assert.equal(count(f.db,'commerce_operations'),1);
  });
});

test('M19-G03-EXACT-OVERLAP-AND-CUMULATIVE-DEBITS',()=>usingRedemption(f=>{
  const first=reserve(f);f.redemptionSource.setMode('timeout_after_effect');projection(f.redemptions.dispatch(f.scope,first.id),'unknown');
  availability(context(f),EXPECTED.availability.unknown_after_effect);assert.equal(f.redemptions.read(f.scope,first.id).held_points,400);
  assertDebit(f,first.id,EXPECTED.source_debits[0]);const second=reserve(f,200);availability(context(f),EXPECTED.availability.second_reserved_with_overlap);
  assert.equal(sourceJournal(f).length,1);assert.equal(f.redemptions.reconcile(f.scope,first.id).operation.state,'redeemed');
  availability(context(f),EXPECTED.availability.second_reserved_after_reconciliation);f.redemptionSource.setMode('redeem');
  projection(f.redemptions.dispatch(f.scope,second.id),'redeemed',200);
  availability(context(f),EXPECTED.availability.final);assertBalances(f,EXPECTED.after_400_and_200,3);
  assertDebit(f,first.id,EXPECTED.source_debits[0]);assertDebit(f,second.id,EXPECTED.source_debits[1]);
  assert.deepEqual(sourceJournal(f).map(row=>{const b=JSON.parse(row.body);return {seq:row.seq,points:b.result.points,benefit_id:b.result.benefit_id,before_revision:b.result.before_revision,after_revision:b.result.after_revision};}),EXPECTED.source_debits);
  assert.deepEqual(sourceSnapshots(f).map(r=>r.source_revision),[1,2,3]);assert.equal(sourceJournal(f).length,2);
  const rows=sourceState(f);for(const p of [first,second]){assert.equal(f.redemptions.reconcile(f.scope,p.id).command_repeated,false);projection(f.redemptions.dispatch(f.scope,p.id),'redeemed',p===first?400:200);}
  assert.deepEqual(sourceState(f),rows);assert.throws(()=>quote(f,200),/LOYALTY_INSUFFICIENT_POINTS/);
}));

test('M19-G03-ANCHOR-AND-COMPLETE-SOURCE-HISTORY',()=>usingRedemption(f=>{
  const p=reserve(f);f.redemptionSource.setMode('timeout_after_effect');f.redemptions.dispatch(f.scope,p.id);
  const journal=sourceJournal(f)[0],snapshots=sourceSnapshots(f),anchor=f.full.db.prepare('SELECT * FROM fixture_loyalty_redemption_anchors WHERE account_key=?').get(f.anchor.account_key) as Value;
  f.full.db.prepare('DELETE FROM fixture_loyalty_redemption_journal WHERE operation_id=?').run(p.id);
  assert.throws(()=>f.redemptionSource.observeAccount(f.anchor.account_key));unspendable(()=>context(f));assert.throws(()=>quote(f,200));
  f.full.db.prepare('INSERT INTO fixture_loyalty_redemption_journal VALUES(?,?,?,?,?)').run(journal.operation_id,journal.account_key,journal.seq,journal.body,journal.digest);
  const missing=snapshots[1];f.full.db.prepare('DELETE FROM fixture_loyalty_snapshots WHERE customer_id=? AND source_revision=?').run(EXPECTED.customer_id,2);
  assert.throws(()=>f.redemptionSource.lookup(p.id));unspendable(()=>context(f));
  f.full.db.prepare('INSERT INTO fixture_loyalty_snapshots VALUES(?,?,?,?)').run(missing.customer_id,missing.source_revision,missing.body,missing.digest);
  const gap={...JSON.parse(journal.body),seq:2};f.full.db.prepare('UPDATE fixture_loyalty_redemption_journal SET seq=2,body=?,digest=? WHERE operation_id=?').run(canonical(gap),contentDigest(gap),p.id);
  assert.throws(()=>f.redemptionSource.observeAccount(f.anchor.account_key));unspendable(()=>context(f));
  f.full.db.prepare('UPDATE fixture_loyalty_redemption_journal SET seq=?,body=?,digest=? WHERE operation_id=?').run(journal.seq,journal.body,journal.digest,p.id);
  f.full.db.prepare('DELETE FROM fixture_loyalty_redemption_anchors WHERE account_key=?').run(f.anchor.account_key);
  assert.throws(()=>f.redemptionSource.pinAccount(EXPECTED.customer_id),'the current debited balance cannot become a replacement anchor');
  f.full.db.prepare('INSERT INTO fixture_loyalty_redemption_anchors VALUES(?,?,?,?)').run(anchor.account_key,anchor.customer_id,anchor.body,anchor.digest);
  const original=f.redemptionSource.lookup(p.id);f.full.source.publish(balanceInput(f,{source_revision:3,balances:structuredClone(EXPECTED.after_400)}));
  unspendable(()=>context(f));assert.throws(()=>quote(f,200));assert.deepEqual(f.redemptionSource.lookup(p.id),original,'unexplained later snapshots cannot erase historical original-ID proof');
  assert.equal(f.redemptions.reconcile(f.scope,p.id).operation.state,'redeemed');unspendable(()=>context(f));
  assert.equal(sourceJournal(f).length,1);assert.equal(count(f.db,'commerce_operations'),1);
}));

test('M19-G03-UNSENT-EXPIRY-AND-EXACT-QUOTE-CONSUMPTION',async()=>{
 await usingRedemption(f=>{
  const first=approved(f,200),second=approved(f),firstOp=execute(f,first);
  assert.equal(context(f).effective_available_points,400,'reusing the consumed 200-point quote would otherwise fit the remaining capacity');
  assert.throws(()=>{const duplicate=f.gateway.prepare(f.scope,{case_id:f.subject.case_id,action:ACTION,arguments:{quote_id:first.q.id,quote_digest:first.q.digest}});
    const approval=f.gateway.approve(f.reviewer.scope,{preview_id:duplicate.id,preview_digest:duplicate.digest});
    f.gateway.execute(f.scope,{preview_id:duplicate.id,preview_digest:duplicate.digest,approval_id:approval.id});});
  assert.equal(documentRows(f.db,OP_KIND).length,1);const secondOp=execute(f,second);
  assert.equal(documentRows(f.db,OP_KIND).length,2,'another valid reservation must not change immutable quote terms');
  assert.equal(context(f).effective_available_points,0);assert.equal(sourceJournal(f).length,0);
  assert.throws(()=>f.gateway.execute(f.scope,executeInput(first)));f.advance(EXPECTED.advance_beyond_reservation_ms);
  for(const p of [firstOp,secondOp]){
    projection(f.redemptions.expire(f.scope,p.id),'released',p===firstOp?200:400);
    assert.equal(nativeOperation(f.db,p.id).state,'failed');assert.equal(nativeWork(f.db,p.id).state,'dead');assert.equal(nativeWork(f.db,p.id).attempts,0);
    const codes=receiptRows(f.db,p.id).map(r=>JSON.parse(r.body).code);assert.ok(codes.includes('reservation_released'));assert.equal(codes.includes('provider_rejected'),false);
    const before=nativeState(f.db,p.id);f.redemptions.expire(f.scope,p.id);projection(f.redemptions.dispatch(f.scope,p.id),'released',p===firstOp?200:400);assert.deepEqual(nativeState(f.db,p.id),before);
  }
  availability(context(f),EXPECTED.availability.initial);assertBalances(f,EXPECTED.baseline,1);assert.equal(sourceJournal(f).length,0);
 });
 await usingRedemption(f=>{
   const p=reserve(f),command=JSON.parse(nativeOperation(f.db,p.id).command);
   const evidence=f.redemptionSource.redeem(command);assert.equal(evidence.operation_id,p.id);assert.equal(evidence.state,'redeemed');assertDebit(f,p.id,EXPECTED.source_debits[0]);
   f.advance(EXPECTED.advance_beyond_reservation_ms);const before=nativeState(f.db,p.id);
   assert.throws(()=>f.redemptions.expire(f.scope,p.id),'an exact provider booking contradicts a claimed never-sent reservation');
   projection(f.redemptions.read(f.scope,p.id),'reserved');assert.deepEqual(nativeState(f.db,p.id),before);assert.equal(nativeWork(f.db,p.id).attempts,0);
   assert.equal(JSON.parse(operationDocument(f.db,p.id).body).attempt_count,0);assert.equal(sourceJournal(f).length,1);assertBalances(f,EXPECTED.after_400,2);
 });
});

test('M19-G03-CORE-AND-SOURCE-ATOMIC-CUTS',async()=>{
  await usingRedemption(f=>{
    const p=approved(f),before=count(f.db,'commerce_action_receipts');
    f.db.exec("CREATE TRIGGER loyalty_test_reject_work BEFORE INSERT ON commerce_operation_work BEGIN SELECT RAISE(ABORT,'LOYALTY_TEST_CORE_CUT');END");
    assert.throws(()=>execute(f,p),/LOYALTY_TEST_CORE_CUT/);f.db.exec('DROP TRIGGER loyalty_test_reject_work');
    assert.equal(f.db.prepare('SELECT uses FROM commerce_action_approvals WHERE id=?').get(p.a.id).uses,0);
    assert.equal(JSON.parse(documentRows(f.db,QUOTE_KIND).find(r=>r.id===p.q.id)!.body).consumed_by,null);
    assert.equal(documentRows(f.db,OP_KIND).length,0);assert.equal(count(f.db,'commerce_operations'),0);assert.equal(count(f.db,'commerce_action_receipts'),before);
    const op=execute(f,p);projection(f.redemptions.read(f.scope,op.id),'reserved');
    f.full.db.exec("CREATE TRIGGER loyalty_test_reject_journal BEFORE INSERT ON fixture_loyalty_redemption_journal BEGIN SELECT RAISE(ABORT,'LOYALTY_TEST_SOURCE_CUT');END");
    try{f.redemptions.dispatch(f.scope,op.id);}catch(error){assert.match((error as Error).message,/LOYALTY_TEST_SOURCE_CUT/);}
    f.full.db.exec('DROP TRIGGER loyalty_test_reject_journal');projection(f.redemptions.read(f.scope,op.id),'unknown');
    assertBalances(f,EXPECTED.baseline,1);assert.equal(sourceJournal(f).length,0);assert.equal(nativeWork(f.db,op.id).attempts,1);
  });
  await usingRedemption(f=>{
    const p=reserve(f);f.db.exec("CREATE TRIGGER loyalty_test_reject_completion BEFORE UPDATE ON commerce_operations WHEN NEW.state='succeeded' BEGIN SELECT RAISE(ABORT,'LOYALTY_TEST_COMPLETION_CUT');END");
    try{f.redemptions.dispatch(f.scope,p.id);}catch(error){assert.match((error as Error).message,/LOYALTY_TEST_COMPLETION_CUT/);}
    f.db.exec('DROP TRIGGER loyalty_test_reject_completion');projection(f.redemptions.read(f.scope,p.id),'unknown');
    assert.equal(nativeOperation(f.db,p.id).state,'unknown');assert.equal(nativeWork(f.db,p.id).attempts,1);assertDebit(f,p.id,EXPECTED.source_debits[0]);
    assertBalances(f,EXPECTED.after_400,2);assert.equal(f.redemptions.reconcile(f.scope,p.id).operation.state,'redeemed');assert.equal(sourceJournal(f).length,1);
  });
});

test('M19-G03-EXACT-APPROVAL-AND-SERVICE-TERMS',()=>usingRedemption(async f=>{
  const service=new SupportService(f.kernel,f.reads,{loyalty:f.balances,loyaltyRedemptions:f.redemptions}),before=finances(f),ownerBefore=f.ownership.inspect(f.scope,f.caseId);
  const view=await service.post(f.scope,'loyalty-redemption-context',{customer_token:f.customerBearer,input:input(f.subject)}) as Value;
  availability(view,EXPECTED.availability.initial);
  const q=await service.post(f.scope,'loyalty-redemption-quote',{customer_token:f.customerBearer,input:{...input(f.subject),snapshot_digest:view.snapshot_digest,points:400,unit:'points',benefit_id:'synthetic_reward_400'}}) as Value;
  assert.equal(q.digest,contentDigest(q.quote));assert.equal(q.quote.points,400);assert.equal(q.quote.unit,'points');assert.equal(q.quote.expires_at,f.now()+EXPECTED.reservation_ttl_ms);
  assert.equal(q.approval_required,true);assert.equal(q.execution_authorized,false);
  const p=f.gateway.prepare(f.scope,{case_id:f.caseId,action:ACTION,arguments:{quote_id:q.id,quote_digest:q.digest}}),proof=proofRow(f);
  f.advance(1);const a=f.gateway.approve(f.reviewer.scope,{preview_id:p.id,preview_digest:p.digest}),op=execute(f,{q,p,a,subject:f.subject});
  for(const value of [p.preview,op.receipt]){
    assert.deepEqual(value.points,{unit:'points',quantity:400});assert.deepEqual(value.benefit,EXPECTED.benefits[0]);assert.equal(value.financial_effect,false);
    for(const field of ['amount','currency','amount_ceiling','resolution','resolution_operation_id'])assert.equal(Object.hasOwn(value,field),false);
  }
  assert.equal(op.receipt.loyalty_operation_id,op.id);assert.equal(op.receipt.effect,'synthetic_loyalty_authorized');assert.equal(op.receipt.state,'reserved');
  const native=nativeOperation(f.db,op.id),command=JSON.parse(native.command);
  assert.deepEqual(Object.keys(command).sort(),COMMAND_FIELDS);assert.equal(command.source_id,op.receipt.id);assert.equal(command.source_digest,contentDigest(op.receipt));
  assert.equal(command.quote_id,q.id);assert.equal(command.quote_digest,q.digest);assert.equal(command.operation_id,op.id);assert.equal(native.source_kind,'case');assert.equal(native.source_id,op.receipt.id);
  for(const privateValue of [EXPECTED.customer_id,f.customerBearer,proof.token_hash])assert.equal(JSON.stringify(command).includes(privateValue),false);
  assert.equal(native.state,'queued');assert.equal(nativeWork(f.db,op.id).state,'pending');assert.equal(nativeWork(f.db,op.id).attempts,0);
  assert.deepEqual(f.ownership.inspect(f.scope,f.caseId),ownerBefore,'independent approval keeps the recorded operator and generation');
  const read=await service.post(f.scope,'loyalty-redemption-read',{operation_id:op.id}) as Value;projection(read,'reserved');
  const dispatched=await service.post(f.scope,'loyalty-redemption-dispatch',{operation_id:op.id}) as Value;projection(dispatched,'redeemed');
  assert.equal((await service.post(f.scope,'loyalty-redemption-reconcile',{operation_id:op.id}) as Value).disposition,'unchanged');
  projection(await service.post(f.scope,'loyalty-redemption-expire',{operation_id:op.id}) as Value,'redeemed');
  const after=f.db.prepare('SELECT * FROM commerce_sessions WHERE token_hash=?').get(proof.token_hash) as Value;
  assert.equal(after.last_seen,proof.last_seen,'approval and dispatch revalidation cannot refresh the human customer proof');assert.equal(after.expires_at,proof.expires_at);
  assertDebit(f,op.id,EXPECTED.source_debits[0]);assert.deepEqual(finances(f),before);availability(context(f),EXPECTED.availability.reconciled_400);
  const unconfigured=new SupportService(f.kernel,f.reads);
  await assert.rejects(unconfigured.post(f.scope,'loyalty-redemption-read',{operation_id:op.id}));
  await assert.rejects(service.post(f.scope,'loyalty-redemption-read',{operation_id:op.id,points:1}));
  assert.throws(()=>f.gateway.prepare(f.scope,{case_id:f.caseId,action:ACTION,arguments:{quote_id:q.id,quote_digest:q.digest,amount:'400'}}));
}));

test('M19-G03-CURRENT-AUTHORITY-AND-HUMAN-BOUNDARY',async()=>{
  const changes:[string,(f:any,p:Value)=>void][]=[
    ['revoked approval',(f,p)=>f.gateway.revokeApproval(f.reviewer.scope,p.a.id)],
    ['approver revision',(f)=>f.permissions.change(f.owner.scope,{actor_id:'reviewer',role:'reviewer',actions:null,resource_ids:null,expected_revision:0})],
    ['owner generation',(f)=>f.ownership.takeover(f.scope,{case_id:f.caseId,expected_generation:1,reason:'operator_requested'})],
    ['proof revocation',(f)=>f.kernel.revoke(f.customer)],
    ['execution permission',(f)=>f.permissions.change(f.owner.scope,{actor_id:f.kernel.require(f.scope).actor_id,role:'operator',actions:['case.read','resource.read','support.read','operation.read','operation.dispatch','operation.reconcile','work.claim'],resource_ids:null,expected_revision:0})],
    ['capability revision',(f)=>f.gateway.configure(f.owner.scope,{enabled:false,expected_revision:1,profile_id:'default',policy_id:'returns'})],
  ];
  for(const [label,change] of changes)await usingRedemption(f=>{
    const p=reserve(f),state=sourceState(f);change(f,p);let calls=0;
    withSourceMethod(f.redemptionSource,'redeem',()=>{calls++;throw new Error('UNAUTHORIZED_SOURCE_CALL');},()=>assert.throws(()=>f.redemptions.dispatch(f.scope,p.id),undefined,label));
    assert.equal(calls,0,label);assert.deepEqual(sourceState(f),state,label);
    const body=JSON.parse(operationDocument(f.db,p.id).body);assert.ok(['reserved','unknown'].includes(body.state),label+' preserves the encumbrance');assert.equal(body.points,400);
  });
  await usingRedemption(f=>{
    const p=approved(f),id=execute(f,p).id,fresh=approved(f,200),unapproved=prepared(f,200),api=new WorkerApi(f.kernel),audience='http://127.0.0.1:9019/v1/worker';
    const grant=api.leases.issue(f.scope,{case_id:f.caseId,lifetime_ms:30000},audience),lease=api.leases.claim(grant.token,audience,30000),worker=api.leases.returnScoped(grant.token,audience,lease.generation).scope;
    assert.equal(f.kernel.require(worker).role,'operator');assert.equal(f.kernel.workerIdentity(worker).kind,'external_work');
    const roles=[f.agent.scope,f.customer,worker];
    for(const role of ['integration','worker']){f.kernel.provisionMember(f.a.tenant,f.a.store,'loyalty_'+role,role);roles.push(f.kernel.authenticate(f.kernel.issueSession(f.a.tenant,f.a.store,'loyalty_'+role)));}
    for(const scope of roles){
      assert.throws(()=>context(f,f.subject,scope));assert.throws(()=>f.redemptions.quote(scope,f.customer,{...input(f.subject),points:200,unit:'points',benefit_id:'synthetic_reward_200',snapshot_digest:fresh.q.quote.snapshot_digest}));
      for(const method of ['read','dispatch','reconcile','expire'])assert.throws(()=>f.redemptions[method](scope,id));
      assert.throws(()=>f.gateway.prepare(scope,{case_id:f.caseId,action:ACTION,arguments:{quote_id:fresh.q.id,quote_digest:fresh.q.digest}}));
      assert.throws(()=>f.gateway.approve(scope,{preview_id:unapproved.p.id,preview_digest:unapproved.p.digest}));assert.throws(()=>f.gateway.execute(scope,executeInput(fresh)));
    }
    assert.equal(nativeWork(f.db,id).attempts,0);assert.equal(sourceJournal(f).length,0);assert.equal(documentRows(f.db,OP_KIND).length,1);
    assert.equal(f.db.prepare('SELECT uses FROM commerce_action_approvals WHERE id=?').get(fresh.a.id).uses,0);
    for(const q of [fresh.q,unapproved.q])assert.equal(JSON.parse(documentRows(f.db,QUOTE_KIND).find(r=>r.id===q.id)!.body).consumed_by,null);
    assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_action_approvals WHERE preview_id=?').get(unapproved.p.id).n,0);
  });
  await usingRedemption(f=>{
    f.ownership.takeover(f.owner.scope,{case_id:f.caseId,expected_generation:1,reason:'operator_requested'});
    const subject={...f.subject,expected_generation:2},q=quote(f,400,subject,{},f.owner.scope),p=f.gateway.prepare(f.owner.scope,{case_id:f.caseId,action:ACTION,arguments:{quote_id:q.id,quote_digest:q.digest}});
    assert.throws(()=>f.gateway.approve(f.owner.scope,{preview_id:p.id,preview_digest:p.digest}),/SELF_APPROVAL_DENIED/);assert.equal(count(f.db,'commerce_operations'),0);
  });
});

test('M19-G03-FINAL-TERMS-AND-NONSPENDABLE-POINTS',async()=>{
  await usingRedemption(f=>{
    availability(context(f),EXPECTED.availability.initial);const n=documentRows(f.db,QUOTE_KIND).length;
    for(const extra of [{points:900},{points:400,unit:'USD'},{points:400,benefit_id:'synthetic_reward_200'},{points:401},{points:0},{points:Number.MAX_SAFE_INTEGER+1},{points:400,snapshot_digest:'0'.repeat(64)}])assert.throws(()=>quote(f,400,f.subject,extra));
    assert.equal(documentRows(f.db,QUOTE_KIND).length,n);assert.equal(sourceJournal(f).length,0);
    const readOnly=f.balances.quote(f.scope,f.customer,{...input(f.subject),points:400,unit:'points',snapshot_digest:f.balances.context(f.scope,f.customer,input(f.subject)).snapshot_digest});
    assert.throws(()=>f.gateway.prepare(f.scope,{case_id:f.caseId,action:ACTION,arguments:{quote_id:readOnly.quote_digest,quote_digest:readOnly.quote_digest}}));
    const p=reserve(f);f.redemptionSource.publishBenefits({revision:2,expires_at:f.now()+300000,benefits:[{...EXPECTED.benefits[0],points:500},EXPECTED.benefits[1]]});
    let calls=0;withSourceMethod(f.redemptionSource,'redeem',()=>{calls++;throw new Error('STALE_BENEFIT_SENT');},()=>assert.throws(()=>f.redemptions.dispatch(f.scope,p.id)));
    assert.equal(calls,0);assert.equal(sourceJournal(f).length,0);assertBalances(f,EXPECTED.baseline,1);
  });
  await usingRedemption(f=>{
    const p=reserve(f);f.advance(EXPECTED.advance_beyond_reservation_ms);assert.throws(()=>f.redemptions.dispatch(f.scope,p.id));assert.equal(sourceJournal(f).length,0);
    assertBalances(f,EXPECTED.baseline,1);projection(f.redemptions.expire(f.scope,p.id),'released');
  });
  await usingRedemption(f=>{
    const p=reserve(f);f.full.source.publish(balanceInput(f,{source_revision:2,rules:{...balanceInput(f).rules,revision:2,minimum_redemption:200}}));
    unspendable(()=>context(f));assert.throws(()=>f.redemptions.dispatch(f.scope,p.id));assert.equal(sourceJournal(f).length,0);
  });
  await usingRedemption(f=>{unspendable(()=>context(f));assert.throws(()=>quote(f));assert.equal(documentRows(f.db,OP_KIND).length,0);assert.equal(sourceJournal(f).length,0);},{provider:'limited'});
});

test('M19-G03-NATIVE-OWNERS-PHYSICAL-AND-SCOPE-ISOLATION',()=>usingRedemption(f=>{
  assert.throws(()=>new LoyaltyRedemptionFixtureSource({...f.full.source} as any,f.now));
  assert.throws(()=>new LoyaltyRedemptions(f.kernel,{balances:{...f.balances} as any,source:f.redemptionSource}));
  assert.throws(()=>new LoyaltyRedemptions(f.kernel,{balances:f.balances,source:{...f.redemptionSource} as any}));
  assert.throws(()=>new ActionGateway(f.kernel,{loyalty:{...f.redemptions} as any}));
  assert.throws(()=>new SupportService(f.kernel,f.reads,{loyalty:new LoyaltyBalances(f.kernel,f.full.source),loyaltyRedemptions:f.redemptions}));
  const otherDb=new DatabaseSync(':memory:'),otherKernel=new CommerceKernel(otherDb,f.now);
  try{const foreign=new LoyaltyBalances(otherKernel,f.full.source),other=new LoyaltyRedemptions(otherKernel,{balances:foreign,source:f.redemptionSource});
    assert.throws(()=>new LoyaltyRedemptions(f.kernel,{balances:foreign,source:f.redemptionSource}));assert.throws(()=>new ActionGateway(f.kernel,{loyalty:other}));
    assert.throws(()=>new ExceptionQueue(f.kernel,undefined,{loyalty:other}));
  }finally{otherDb.close();}
  const duplicate=f.makeSource();duplicate.source.publish(balanceInput(f));const separate=new LoyaltyRedemptionFixtureSource(duplicate.source,f.now);
  assert.equal(duplicate.source.identity,f.full.source.identity);assert.throws(()=>new LoyaltyRedemptions(f.kernel,{balances:f.balances,source:separate}),'equal public identities do not substitute another native source object');
  const alias=join(f.directory,'core-hard-link.sqlite');linkSync(f.filename,alias);const coreAlias=new DatabaseSync(alias);
  try{
    assert.throws(()=>new LoyaltyFixtureSource(coreAlias,f.full.config,f.now));
    assert.equal(coreAlias.prepare("SELECT count(*) n FROM sqlite_master WHERE name LIKE 'fixture_loyalty%'").get().n,0);
  }finally{coreAlias.close();}
  const changedDb=new DatabaseSync(':memory:');
  try{
    const parent=new LoyaltyFixtureSource(changedDb,f.full.config,f.now);changedDb.exec('CREATE TABLE commerce_migrations(version INTEGER)');
    assert.throws(()=>new LoyaltyRedemptionFixtureSource(parent,f.now));assert.equal(changedDb.prepare("SELECT count(*) n FROM sqlite_master WHERE name LIKE 'fixture_loyalty_redemption%'").get().n,0,'constructor rejects a core marker before wrapper DDL');
  }finally{changedDb.close();}
  const p=reserve(f),command=JSON.parse(nativeOperation(f.db,p.id).command);
  for(const table of ['fixture_loyalty_identity','fixture_loyalty_redemption_identity']){
    const row=f.full.db.prepare('SELECT * FROM '+table+' WHERE id=1').get() as Value,body={...JSON.parse(row.body),store_id:'foreign_store'};
    f.full.db.prepare('UPDATE '+table+' SET body=?,digest=? WHERE id=1').run(canonical(body),contentDigest(body));
    for(const action of [()=>f.redemptionSource.pinAccount(EXPECTED.customer_id),()=>f.redemptionSource.observeAccount(f.anchor.account_key),()=>f.redemptionSource.lookup(p.id),()=>f.redemptionSource.redeem(command),()=>f.redemptionSource.publishBenefits({revision:2,expires_at:f.now()+300000,benefits:EXPECTED.benefits})])assert.throws(action);
    f.full.db.prepare('UPDATE '+table+' SET body=?,digest=? WHERE id=1').run(row.body,row.digest);
  }
  for(const scope of [f.b.scope,f.c.scope]){assert.throws(()=>context(f,f.subject,scope));assert.throws(()=>f.redemptions.read(scope,p.id));assert.throws(()=>f.redemptions.dispatch(scope,p.id));}
  assert.equal(sourceJournal(f).length,0);assertBalances(f,EXPECTED.baseline,1);projection(f.redemptions.read(f.scope,p.id),'reserved');
}));

test('M19-G03-STRICT-ORIGINAL-SOURCE-RESULTS',()=>usingRedemption(f=>{
  const p=reserve(f);f.redemptionSource.setMode('timeout_after_effect');f.redemptions.dispatch(f.scope,p.id);
  const row=sourceJournal(f)[0],before=nativeState(f.db,p.id),original=JSON.parse(row.body);
  const changes:[string,(b:Value)=>void][]=[
    ['foreign original id',b=>b.result.operation_id='op_foreign'],['foreign source',b=>b.result.source_identity='foreign_source'],
    ['foreign account',b=>b.result.account_key='account_foreign'],['wrong command digest',b=>b.result.command_digest='0'.repeat(64)],
    ['wrong quantity',b=>b.result.points=200],['monetary unit',b=>b.result.unit='USD'],['different benefit',b=>b.result.benefit_id='synthetic_reward_200'],
    ['different benefit digest',b=>b.result.benefit_digest='0'.repeat(64)],['fake reward reference',b=>b.result.provider_ref='reward_'+'0'.repeat(40)],
    ['wrong before digest',b=>b.result.before_digest=b.result.after_digest],['wrong after revision',b=>b.result.after_revision=3],
    ['rejection with debit',b=>{b.result.state='rejected';b.result.reason='LOYALTY_INSUFFICIENT_POINTS';b.result.provider_ref=null;}],
    ['extra claimed authority',b=>b.result.execution_authorized=true],['foreign command customer',b=>{b.command.subject_ref='0'.repeat(64);b.command_digest=contentDigest(b.command);b.result.command_digest=b.command_digest;b.result.provider_ref='reward_'+b.command_digest.slice(0,40);}],
  ];
  for(const [label,change] of changes){
    const body=structuredClone(original);change(body);const {digest:old,...result}=body.result;body.result={...result,digest:contentDigest(result)};
    f.full.db.prepare('UPDATE fixture_loyalty_redemption_journal SET body=?,digest=? WHERE operation_id=?').run(canonical(body),contentDigest(body),p.id);
    assert.throws(()=>f.redemptionSource.lookup(p.id),undefined,label);unspendable(()=>context(f));
    let answer:Value|undefined,failure:unknown;try{answer=f.redemptions.reconcile(f.scope,p.id);}catch(error){failure=error;}
    if(answer){assert.equal(answer.disposition,'unconfirmed',label);projection(answer.operation,'unknown');}else assert.ok(failure instanceof Error);
    assert.deepEqual(nativeState(f.db,p.id),before,label+' cannot settle or release the original hold');
    f.full.db.prepare('UPDATE fixture_loyalty_redemption_journal SET body=?,digest=? WHERE operation_id=?').run(row.body,row.digest,p.id);
  }
  const catalogRows=count(f.full.db,'fixture_loyalty_redemption_benefits');
  for(const benefits of [[],[EXPECTED.benefits[0],EXPECTED.benefits[0]],[{...EXPECTED.benefits[0],points:0}],[{...EXPECTED.benefits[0],points:1.5}],[{...EXPECTED.benefits[0],unit:'USD'}],[{...EXPECTED.benefits[0],kind:'store_credit'}],[{...EXPECTED.benefits[0],amount_minor:'400'}],Array.from({length:21},(_,i)=>({...EXPECTED.benefits[0],id:'reward_'+i}))]){
    assert.throws(()=>f.redemptionSource.publishBenefits({revision:2,expires_at:f.now()+300000,benefits}));assert.equal(count(f.full.db,'fixture_loyalty_redemption_benefits'),catalogRows);
  }
  assert.deepEqual(f.redemptionSource.publishBenefits({revision:1,expires_at:f.catalog.expires_at,benefits:EXPECTED.benefits}),f.catalog);assert.equal(count(f.full.db,'fixture_loyalty_redemption_benefits'),1);
  assert.equal(f.redemptions.reconcile(f.scope,p.id).operation.state,'redeemed');assertDebit(f,p.id,EXPECTED.source_debits[0]);assert.equal(sourceJournal(f).length,1);
  const after=sourceSnapshots(f)[1];f.full.db.prepare('DELETE FROM fixture_loyalty_redemption_journal WHERE operation_id=?').run(p.id);f.full.db.prepare('DELETE FROM fixture_loyalty_snapshots WHERE customer_id=? AND source_revision=2').run(EXPECTED.customer_id);
  assertBalances(f,EXPECTED.baseline,1);unspendable(()=>context(f));assert.throws(()=>quote(f,200),'a redeemed core claim cannot spend a provider balance whose booking disappeared');
  f.full.db.prepare('INSERT INTO fixture_loyalty_snapshots VALUES(?,?,?,?)').run(after.customer_id,after.source_revision,after.body,after.digest);
  f.full.db.prepare('INSERT INTO fixture_loyalty_redemption_journal VALUES(?,?,?,?,?)').run(row.operation_id,row.account_key,row.seq,row.body,row.digest);
  availability(context(f),EXPECTED.availability.reconciled_400);assertBalances(f,EXPECTED.after_400,2);
}));

test('M19-G03-STRICT-CORE-AND-GENERIC-MUTATION-FENCES',()=>usingRedemption(async f=>{
  const p=reserve(f),generic=new DurableWork(f.kernel),db=new DatabaseSync(':memory:'),journal=new SyntheticJournal(db,f.a.tenant,f.a.store);
  try{
    const before=nativeState(f.db,p.id);
    for(const action of [()=>generic.claim(f.scope,p.id),()=>generic.recover(f.scope,p.id),()=>generic.bind(f.scope,p.id,journal),
      ()=>generic.beginSend(f.scope,p.id,'lease_unowned'),()=>generic.finish(f.scope,p.id,'lease_unowned',{kind:'applied',operation_id:p.id,payload_hash:before.operation.payload_hash,outcome:'synthetic_recorded',provider_ref:'remote_'+'a'.repeat(40)})]){
      assert.throws(action);assert.deepEqual(nativeState(f.db,p.id),before);
    }
    await assert.rejects(generic.dispatch(f.scope,p.id,journal));await assert.rejects(new Reconciliation(f.kernel).one(f.scope,p.id,journal));
    assert.deepEqual(nativeState(f.db,p.id),before);assert.equal(count(f.db,'commerce_reconciliation_drift'),0);
    const stops=new ExecutionStops(f.kernel);stops.setGlobal({stopped:true,reason:'incident',expected_revision:0});stops.setGlobal({stopped:false,reason:'reviewed_resume',expected_revision:1});
    const stamp=f.db.prepare('SELECT * FROM commerce_operation_controls WHERE operation_id=?').get(p.id);
    assert.throws(()=>stops.reauthorize(f.owner.scope,p.id,before.operation.revision));assert.deepEqual(f.db.prepare('SELECT * FROM commerce_operation_controls WHERE operation_id=?').get(p.id),stamp);
    assert.throws(()=>f.redemptions.dispatch(f.scope,p.id));assert.equal(sourceJournal(f).length,0);
  }finally{db.close();}
  const row=operationDocument(f.db,p.id),original=JSON.parse(row.body);
  for(const [field,value] of [['id','different_operation'],['kind',QUOTE_KIND],['tenant_id','foreign_tenant'],['store_id','foreign_store'],['points',200],['unit','USD'],['state','redeemed'],['attempt_count',2],['native_revision',original.native_revision+1],['unexpected_authority',true]]){
    writeDocument(f.db,row,{...original,[field as string]:value});assert.throws(()=>f.redemptions.read(f.scope,p.id));unspendable(()=>context(f));restoreDocument(f.db,row);
  }
  const quoteRow=documentRows(f.db,QUOTE_KIND).find(r=>r.id===p.q.id)!,quoteBody=JSON.parse(quoteRow.body);
  writeDocument(f.db,quoteRow,{...quoteBody,consumed_by:'different_operation'});assert.throws(()=>f.redemptions.read(f.scope,p.id));restoreDocument(f.db,quoteRow);
  assert.equal(nativeWork(f.db,p.id).attempts,0);assert.equal(sourceJournal(f).length,0);assertBalances(f,EXPECTED.baseline,1);
}));

test('M19-G03-WORKER-REFUND-STREAM-INDEPENDENCE',()=>usingRedemption(async f=>{
  const loyalty=reserve(f);f.redemptionSource.setMode('timeout_before_effect');projection(f.redemptions.dispatch(f.scope,loyalty.id),'unknown');
  f.advance(EXPECTED.advance_beyond_reservation_ms);f.ownership.takeover(f.owner.scope,{case_id:f.caseId,expected_generation:1,reason:'provider_unavailable'});
  const allocation=f.allocate().allocations.find((a:Value)=>a.line_id==='alpha'),refund=f.quotes.quote(f.scope,{allocation_id:allocation.id}),preview=f.gateway.prepare(f.scope,refund.proposal),approval=f.gateway.approve(f.reviewer.scope,{preview_id:preview.id,preview_digest:preview.digest});
  const api=new WorkerApi(f.kernel,{resolutionExecution:f.executor}),audience='http://127.0.0.1:9020/v1/worker',grant=api.leases.issue(f.scope,{case_id:f.caseId,lifetime_ms:30000},audience),lease=api.leases.claim(grant.token,audience,30000);
  const act=(action:string,args:Value)=>{const c=api.returnContext(grant.token,audience,lease.generation);return api.returnAction(grant.token,audience,{generation:lease.generation,envelope:c.envelope,action,arguments:args});};
  const identity=f.full.db.prepare('SELECT * FROM fixture_loyalty_redemption_identity WHERE id=1').get() as Value,unavailable={...JSON.parse(identity.body),source_identity:'temporarily_unavailable'};
  f.full.db.prepare('UPDATE fixture_loyalty_redemption_identity SET body=?,digest=? WHERE id=1').run(canonical(unavailable),contentDigest(unavailable));
  let financialId:string;
  try{
    const c=api.returnContext(grant.token,audience,lease.generation);assert.deepEqual(c.blockers,[],'current loyalty issue authority and source availability are not refund blockers');
    const accepted=await act('approved-preview.execute',{preview_id:preview.id,preview_digest:preview.digest,approval_id:approval.id}) as Value;
    financialId=accepted.receipt.resolution_operation_id;assert.equal(typeof financialId,'string');assert.equal(accepted.replayed,false);
    assert.equal(f.db.prepare('SELECT uses FROM commerce_action_approvals WHERE id=?').get(approval.id).uses,1);
    const dispatched=await act('resolution.dispatch',{operation_id:financialId}) as Value;assert.equal(dispatched.operation.state,'accepted');
    f.source.settle(financialId);const settled=await act('resolution.reconcile',{operation_id:financialId}) as Value;
    assert.equal(settled.operation.state,'settled');assert.equal(settled.operation.cash_settled,true);
  }finally{f.full.db.prepare('UPDATE fixture_loyalty_redemption_identity SET body=?,digest=? WHERE id=1').run(identity.body,identity.digest);}
  const effects=f.sourceDb.prepare('SELECT * FROM fixture_resolution_effects').all() as Value[];assert.equal(effects.length,EXPECTED.worker_refund.effects);
  const effect=JSON.parse(effects[0].body),command=JSON.parse(effects[0].command);
  assert.equal(effects[0].operation_id,financialId!);assert.equal(effect.operation_id,financialId!);assert.equal(effect.kind,'refund');assert.equal(effect.state,'settled');
  assert.equal(effect.amount_minor,EXPECTED.worker_refund.amount_minor);assert.equal(effect.currency,EXPECTED.worker_refund.currency);assert.equal(effect.payment_id,EXPECTED.worker_refund.payment_id);
  assert.equal(command.amount_minor,'1940');assert.equal(contentDigest(command),effects[0].digest);const ceiling=f.sourceDb.prepare('SELECT available_minor FROM fixture_resolution_accounts WHERE resource_id=?').get(f.subject.resource_id).available_minor;
  assert.equal(ceiling,EXPECTED.worker_refund.fixed_ceiling_minor);assert.equal((BigInt(ceiling)-BigInt(effect.amount_minor)).toString(),EXPECTED.worker_refund.unspent_after_settlement_minor);
  assert.equal(count(f.sourceDb,'fixture_payment_captures'),EXPECTED.worker_refund.payment_captures);assert.equal(count(f.sourceDb,'fixture_credit_accounts'),EXPECTED.worker_refund.store_credit_instruments);
  projection(f.redemptions.read(f.scope,loyalty.id),'unknown');assert.equal(nativeWork(f.db,loyalty.id).attempts,1);assert.equal(sourceJournal(f).length,0);assertBalances(f,EXPECTED.baseline,1);
  const s=f.kernel.require(f.scope),control=f.kernel.transaction(()=>queueOperation(f.kernel,s,f.subject.resource_id,'event','original_diagnostic_control',{schema_version:1,action:'diagnostic.projection.record',resource_id:f.subject.resource_id,source_id:'original_diagnostic_control',source_digest:'a'.repeat(64),financial_effect:false}));
  assert.equal(new BusinessOperations(f.kernel).read(f.scope,control.id).work.blocked_by,null,'the generic financial/diagnostic stream is separate from valid loyalty work');
  const diagnosticDb=new DatabaseSync(':memory:');try{const diagnostic=new SyntheticJournal(diagnosticDb,f.a.tenant,f.a.store);diagnostic.arm('after_accept');
    assert.equal((await new DurableWork(f.kernel).dispatch(f.scope,control.id,diagnostic)).state,'unknown');assert.equal(diagnostic.count(),1);
  }finally{diagnosticDb.close();}
  assert.ok(api.returnContext(grant.token,audience,lease.generation).blockers.some((b:Value)=>b.id===control.id));
  await assert.rejects(async()=>act('resolution.dispatch',{operation_id:financialId!}),/RECONCILIATION_REQUIRED/);
  const malformed=f.kernel.transaction(()=>queueOperation(f.kernel,s,f.subject.resource_id,'event','malformed_loyalty_control',{schema_version:1,action:ACTION,resource_id:f.subject.resource_id,source_id:'malformed_loyalty_control',source_digest:'b'.repeat(64),points:400,unit:'points',financial_effect:false}));
  f.kernel.transaction(()=>{f.db.prepare("UPDATE commerce_operation_work SET state='unknown' WHERE operation_id=?").run(malformed.id);transitionOperation(f.kernel,s,malformed.id,'unknown','outcome_unknown');});
  let malformedContext:Value|undefined;try{malformedContext=api.returnContext(grant.token,audience,lease.generation);}catch(error){assert.ok(error instanceof Error);}
  if(malformedContext)assert.ok(malformedContext.blockers.some((b:Value)=>b.id===malformed.id),'an action string without a valid typed record never earns the loyalty exemption');
  await assert.rejects(async()=>act('resolution.dispatch',{operation_id:financialId!}));assert.equal(count(f.sourceDb,'fixture_resolution_effects'),1);assert.equal(sourceJournal(f).length,0);
},{finance:true}));

test('M19-G03-EXCEPTION-QUEUE-DEDICATED-LOOKUP',()=>usingRedemption(async f=>{
  const p=reserve(f);f.redemptionSource.setMode('timeout_after_effect');f.redemptions.dispatch(f.scope,p.id);
  const noOwner=new ExceptionQueue(f.kernel),db=new DatabaseSync(':memory:'),generic=new SyntheticJournal(db,f.a.tenant,f.a.store);
  try{
    await assert.rejects(noOwner.reconcile(f.scope,p.id));
    const misleading=new ExceptionQueue(f.kernel,()=>generic);await assert.rejects(misleading.reconcile(f.scope,p.id));
    const queue=new ExceptionQueue(f.kernel,()=>generic,{loyalty:f.redemptions}),item=queue.list(f.scope).items.find((i:Value)=>i.operation_id===p.id);
    assert.ok(item);assert.equal(item.state,'unknown');assert.equal(item.financial_effect,false);assert.equal(item.actions.find((a:Value)=>a.name==='retry').enabled,false);assert.equal(item.actions.find((a:Value)=>a.name==='reauthorize').enabled,false);assert.equal(item.actions.find((a:Value)=>a.name==='reconcile').enabled,true);
    let sends=0;const before=sourceState(f),prototype=Object.getPrototypeOf(f.redemptionSource),original=prototype.redeem;
    prototype.redeem=function(...args:any[]){if(this===f.redemptionSource){sends++;throw new Error('QUEUE_MUST_NOT_SEND');}return original.apply(this,args);};
    try{const result=await queue.reconcile(f.scope,p.id);assert.equal(result.command_repeated,false);projection(result.operation,'redeemed');}finally{prototype.redeem=original;}
    assert.equal(sends,0);assert.deepEqual(sourceState(f),before);assert.equal(queue.list(f.scope).items.some((i:Value)=>i.operation_id===p.id),false);
    assert.equal((await queue.reconcile(f.scope,p.id)).disposition,'unchanged');assertDebit(f,p.id,EXPECTED.source_debits[0]);
    f.permissions.change(f.owner.scope,{actor_id:f.kernel.require(f.scope).actor_id,role:'operator',actions:['exception.read','operation.read','resource.read','case.read'],resource_ids:null,expected_revision:0});
    await assert.rejects(queue.reconcile(f.scope,p.id),/ACCESS_DENIED/);assert.equal(sourceJournal(f).length,1);
  }finally{db.close();}
}));

test('M19-G03-ERASURE-AND-RETAINED-LATE-LOOKUP',()=>usingRedemption(f=>{
  const p=reserve(f),proof=proofRow(f),privacy=new PrivacyLifecycle(f.kernel);f.redemptionSource.setMode('timeout_after_effect');f.redemptions.dispatch(f.scope,p.id);
  const exported=privacy.export(f.owner.scope,EXPECTED.customer_id) as Value,records=exported.loyalty_redemption_records;
  assert.ok(Array.isArray(records));assert.equal(records.length,2);assert.deepEqual(new Set(records.map((r:Value)=>r.kind)),new Set([QUOTE_KIND,OP_KIND]));
  assert.ok(records.some((r:Value)=>r.id===p.q.id));assert.ok(records.some((r:Value)=>r.id===p.id));assert.equal(JSON.stringify(exported).includes(f.customerBearer),false);assert.equal(exported.credentials_included,false);
  const providerBefore=sourceState(f);assert.equal(privacy.erase(f.owner.scope,EXPECTED.customer_id).status,'logically_erased');minimized(f.db,p.id,f.customerBearer,proof.token_hash);
  assert.equal(nativeOperation(f.db,p.id).state,'unknown');assert.equal(nativeWork(f.db,p.id).attempts,1);assert.throws(()=>f.kernel.require(f.customer));
  for(const method of ['read','reconcile'])assert.throws(()=>f.redemptions[method](f.scope,p.id),'ordinary operator permission alone cannot administer erased loyalty history');
  assert.throws(()=>f.redemptions.dispatch(f.owner.scope,p.id));assert.throws(()=>new ExecutionStops(f.kernel).reauthorize(f.owner.scope,p.id,nativeOperation(f.db,p.id).revision));
  let balanceReads=0;
  withSourceMethod(f.full.source,'observe',()=>{balanceReads++;throw new Error('ERASED_CUSTOMER_BALANCE_EGRESS');},()=>{
    const retained=f.redemptions.read(f.owner.scope,p.id);projection(retained,'unknown');assert.equal(retained.authority_revoked,true);assert.equal(retained.minimized,true);
    const result=f.redemptions.reconcile(f.owner.scope,p.id);assert.equal(result.disposition,'reconciled');assert.equal(result.command_repeated,false);projection(result.operation,'redeemed');assert.equal(result.operation.minimized,true);
  });
  assert.equal(balanceReads,0);minimized(f.db,p.id,f.customerBearer,proof.token_hash);assert.deepEqual(sourceState(f),providerBefore);assertDebit(f,p.id,EXPECTED.source_debits[0]);
  assert.equal(f.redemptions.reconcile(f.owner.scope,p.id).disposition,'unchanged');assert.equal(documentRows(f.db).length,2);
}));

test('M19-G03-HISTORICAL-ONLY-HOLD-AND-SUPPRESSION',()=>usingRedemption(f=>{
  const p=reserve(f),proof=proofRow(f),privacy=new PrivacyLifecycle(f.kernel);f.redemptionSource.setMode('timeout_before_effect');f.redemptions.dispatch(f.scope,p.id);retireCurrentSubject(f);
  const order=f.kernel.get(f.scope,f.subject.resource_id);assert.equal(order.customer_id,'C-1002');
  const historical=privacy.export(f.owner.scope,EXPECTED.customer_id) as Value;assert.deepEqual(historical.resources,[]);assert.equal(historical.loyalty_redemption_records.length,2);
  const hold=privacy.hold(f.owner.scope,{customer_id:EXPECTED.customer_id,reason:'retention_obligation',authority_ref:'historical_loyalty_hold',expires_at:f.now()+600000});assert.match(hold.subject_hash,/^[a-f0-9]{64}$/);
  const before=documentRows(f.db);assert.equal(privacy.erase(f.owner.scope,EXPECTED.customer_id).status,'held');assert.deepEqual(documentRows(f.db),before);
  assert.throws(()=>privacy.releaseHold(f.owner.scope,EXPECTED.customer_id,'unrelated_hold'));privacy.releaseHold(f.owner.scope,EXPECTED.customer_id,'historical_loyalty_hold');
  assert.equal(privacy.erase(f.owner.scope,EXPECTED.customer_id).status,'logically_erased');minimized(f.db,p.id,f.customerBearer,proof.token_hash);
  const checkpoint=suppressionCheckpoint(f.kernel);assert.equal(checkpoint.subjects.some((s:Value)=>s.subject_hash===hold.subject_hash),true);assert.equal(checkpoint.resources.filter((r:Value)=>r.subject_hash===hold.subject_hash).length,0);
  assert.deepEqual(f.kernel.get(f.scope,f.subject.resource_id),order,'erasing historical customer loyalty must not erase the newly associated order customer');
  f.advance(EXPECTED.advance_beyond_reservation_ms);let expired:Value|undefined;try{expired=f.redemptions.expire(f.owner.scope,p.id);}catch(error){assert.ok(error instanceof Error);}
  if(expired)projection(expired,'unknown');projection(f.redemptions.read(f.owner.scope,p.id),'unknown');
  const result=f.redemptions.reconcile(f.owner.scope,p.id);assert.equal(result.disposition,'unconfirmed');projection(result.operation,'unknown');assert.equal(result.operation.minimized,true);assert.equal(result.command_repeated,false);
  const queue=new ExceptionQueue(f.kernel,undefined,{loyalty:f.redemptions}),item=queue.list(f.owner.scope).items.find((r:Value)=>r.operation_id===p.id);
  assert.ok(item);assert.equal(item.state,'unknown');assert.equal(item.actions.find((a:Value)=>a.name==='reconcile').enabled,true);
  assertBalances(f,EXPECTED.baseline,1);assert.equal(sourceJournal(f).length,0);assert.equal(documentRows(f.db).length,2);
}));

test('M19-G03-UNINSTALL-REVOKES-WITH-HOLD-AWARE-RETENTION',async()=>{
  await usingRedemption(f=>{
    const p=reserve(f),privacy=new PrivacyLifecycle(f.kernel);f.redemptionSource.setMode('timeout_before_effect');f.redemptions.dispatch(f.scope,p.id);
    privacy.hold(f.owner.scope,{customer_id:EXPECTED.customer_id,reason:'dispute',authority_ref:'loyalty_uninstall_hold',expires_at:f.now()+600000});
    const before=sourceState(f),otherStore=f.kernel.list(f.b.scope,'order');assert.equal(privacy.uninstall(f.owner.scope).status,'disconnected');
    const row=operationDocument(f.db,p.id),body=JSON.parse(row.body);assert.equal(body.state,'unknown');assert.equal(body.attempt_count,1);assert.equal(body.authority_revoked,true);assert.equal(body.minimized,false);assert.equal(row.state,'revoked');
    assert.equal(JSON.stringify(documentRows(f.db)).includes(EXPECTED.customer_id),true,'the configured hold retains personal loyalty history');
    assert.equal(f.db.prepare('SELECT active FROM commerce_stores WHERE tenant_id=? AND store_id=?').get(f.a.tenant,f.a.store).active,0);
    assert.throws(()=>f.redemptions.read(f.owner.scope,p.id));assert.throws(()=>f.redemptions.reconcile(f.owner.scope,p.id));assert.throws(()=>f.kernel.authenticate(f.owner.bearer));
    assert.deepEqual(sourceState(f),before);assert.deepEqual(f.kernel.list(f.b.scope,'order'),otherStore);
  });
  await usingRedemption(f=>{
    const p=reserve(f),proof=proofRow(f);f.redemptionSource.setMode('timeout_before_effect');f.redemptions.dispatch(f.scope,p.id);retireCurrentSubject(f);
    assert.equal(new PrivacyLifecycle(f.kernel).uninstall(f.owner.scope).status,'disconnected');const body=minimized(f.db,p.id,f.customerBearer,proof.token_hash);
    assert.equal(body.state,'unknown');assert.equal(body.attempt_count,1);assert.equal(nativeOperation(f.db,p.id).state,'unknown');assert.equal(sourceJournal(f).length,0);assertBalances(f,EXPECTED.baseline,1);
  });
  await usingRedemption(f=>{
    const p=reserve(f),proof=proofRow(f);assert.equal(new PrivacyLifecycle(f.kernel).erase(f.owner.scope,EXPECTED.customer_id).status,'logically_erased');
    const body=minimized(f.db,p.id,f.customerBearer,proof.token_hash);assert.equal(body.state,'released');assert.equal(body.attempt_count,0);
    projection(f.redemptions.read(f.owner.scope,p.id),'released');assert.equal(nativeWork(f.db,p.id).attempts,0);assert.equal(sourceJournal(f).length,0);assertBalances(f,EXPECTED.baseline,1);
  });
});

test('M19-G03-PHYSICAL-RESTORE-RETAINS-COPIED-UNCERTAINTY',async()=>{
  await usingRedemption(f=>{
    const p=reserve(f),proof=proofRow(f),privacy=new PrivacyLifecycle(f.kernel);
    privacy.hold(f.owner.scope,{customer_id:EXPECTED.customer_id,reason:'retention_obligation',authority_ref:'copied_loyalty_hold',expires_at:f.now()+600000});
    const saved=backup(f);f.redemptionSource.setMode('timeout_after_effect');projection(f.redemptions.dispatch(f.scope,p.id),'unknown');assertDebit(f,p.id,EXPECTED.source_debits[0]);
    privacy.releaseHold(f.owner.scope,EXPECTED.customer_id,'copied_loyalty_hold');f.advance(1);privacy.erase(f.owner.scope,EXPECTED.customer_id);const before=sourceState(f),restored=restore(f,saved);
    try{
      assert.equal(restored.result.mode,'quarantine');assert.equal(restored.result.external_effects,false);assert.throws(()=>restored.kernel.authenticate(f.a.bearer));assert.throws(()=>restored.kernel.authenticate(f.customerBearer));
      const value=restored.redemptions.read(restored.scope,p.id);projection(value,'unknown');assert.equal(value.restored,true);assert.equal(value.authority_revoked,true);assert.equal(value.minimized,true);
      const body=minimized(restored.db,p.id,f.customerBearer,proof.token_hash);assert.equal(body.attempt_count,0);assert.equal(nativeWork(restored.db,p.id).attempts,0);assert.equal(nativeOperation(restored.db,p.id).state,'unknown');
      assert.equal(restored.db.prepare('SELECT count(*) n FROM commerce_restored_operations WHERE operation_id=?').get(p.id).n,1);
      assert.equal(restored.db.prepare('SELECT released FROM commerce_privacy_holds WHERE authority_ref=?').get('copied_loyalty_hold').released,0,'current erasure overrides an obsolete copied hold without rewriting its historical row');
      f.advance(EXPECTED.advance_beyond_reservation_ms);assert.throws(()=>restored.redemptions.expire(restored.scope,p.id));projection(restored.redemptions.read(restored.scope,p.id),'unknown');assert.throws(()=>restored.redemptions.dispatch(restored.scope,p.id));
      const answer=restored.redemptions.reconcile(restored.scope,p.id);assert.equal(answer.command_repeated,false);projection(answer.operation,'redeemed');assert.equal(answer.operation.restored,true);assert.equal(answer.operation.minimized,true);
      assert.equal(restored.redemptions.reconcile(restored.scope,p.id).disposition,'unchanged');minimized(restored.db,p.id,f.customerBearer,proof.token_hash);assert.deepEqual(sourceState(f),before);
    }finally{restored.close();}
  });
  await usingRedemption(f=>{
    const p=reserve(f),privacy=new PrivacyLifecycle(f.kernel);privacy.hold(f.owner.scope,{customer_id:EXPECTED.customer_id,reason:'investigation',authority_ref:'live_restore_hold',expires_at:f.now()+600000});
    const saved=backup(f,'still_unsent');f.advance(EXPECTED.advance_beyond_reservation_ms);const restored=restore(f,saved,'still_unsent_restored');
    try{
      const before=nativeState(restored.db,p.id);assert.throws(()=>restored.redemptions.expire(restored.scope,p.id));projection(restored.redemptions.read(restored.scope,p.id),'unknown');assert.equal(restored.redemptionSource.lookup(p.id),null);
      const r=restored.redemptions.reconcile(restored.scope,p.id);assert.equal(r.disposition,'unconfirmed');projection(r.operation,'unknown');assert.equal(r.operation.restored,true);assert.equal(r.operation.authority_revoked,true);assert.equal(r.operation.minimized,false);
      assert.equal(JSON.parse(operationDocument(restored.db,p.id).body).attempt_count,0);assert.deepEqual(nativeState(restored.db,p.id),before);
      assert.throws(()=>restored.redemptions.dispatch(restored.scope,p.id));assert.equal(sourceJournal(f).length,0);assertBalances(f,EXPECTED.baseline,1);
    }finally{restored.close();}
  });
  await usingRedemption(f=>{
    const p=reserve(f),saved=backup(f,'corrupt_typed_copy'),changed=changedRecovery(saved,db=>{const row=operationDocument(db,p.id);writeDocument(db,row,{...JSON.parse(row.body),points:200});});
    new PrivacyLifecycle(f.kernel).erase(f.owner.scope,EXPECTED.customer_id);
    assert.throws(()=>restore(f,changed,'must_not_restore'));assert.equal(existsSync(join(f.directory,'must_not_restore')),false);assert.equal(sourceJournal(f).length,0);
  });
});

test('M19-G03-MERCHANT-IMPORT-AND-REPLAY-SUPPRESSION',()=>usingRedemption(f=>{
  const p=reserve(f),proof=proofRow(f),packed=merchant(f),t=target(f),privacy=new PrivacyLifecycle(f.kernel);
  f.redemptionSource.setMode('timeout_after_effect');f.redemptions.dispatch(f.scope,p.id);const provider=sourceState(f);
  try{
    const first=transfer(f,t,packed);assert.equal(first.mode,'quarantine');assert.equal(first.live_activation_supported,false);
    const imported=t.redemptions.read(t.scope,p.id);projection(imported,'unknown');assert.equal(imported.restored,true);assert.equal(imported.authority_revoked,true);
    assert.equal(JSON.parse(operationDocument(t.db,p.id).body).attempt_count,0);assert.equal(nativeWork(t.db,p.id).attempts,0);assert.throws(()=>t.kernel.authenticate(f.customerBearer));assert.throws(()=>t.redemptions.dispatch(t.scope,p.id));
    assert.equal(t.redemptions.reconcile(t.scope,p.id).operation.state,'redeemed');assert.equal(nativeOperation(t.db,p.id).state,'succeeded');const terminal=nativeState(t.db,p.id);
    assert.deepEqual(transfer(f,t,packed),first);assert.deepEqual(nativeState(t.db,p.id),terminal,'same snapshot cannot replace a destination terminal observation with copied queued work');
    f.advance(1);privacy.erase(f.owner.scope,EXPECTED.customer_id);const latest=suppression(f),replayed=transfer(f,t,packed,latest);
    assert.equal(replayed.suppression_sha256,latest.suppression_sha256);assert.equal(t.db.prepare('SELECT suppression_digest FROM commerce_recovery_state WHERE id=1').get().suppression_digest,latest.suppression_sha256);
    const body=minimized(t.db,p.id,f.customerBearer,proof.token_hash);assert.equal(body.state,'redeemed');projection(t.redemptions.read(t.scope,p.id),'redeemed');
    const once=nativeState(t.db,p.id);transfer(f,t,packed,latest);assert.deepEqual(nativeState(t.db,p.id),once);assert.equal(documentRows(t.db).length,2);
    assert.equal(t.db.prepare("SELECT count(*) n FROM commerce_support_documents WHERE kind='merchant_import'").get().n,1);assert.deepEqual(sourceState(f),provider);
    const row=operationDocument(t.db,p.id);writeDocument(t.db,row,{...JSON.parse(row.body),unexpected_personal_copy:'not_allowed'});
    assert.throws(()=>transfer(f,t,packed,latest),'reimport validates destination records before any suppression can hide corruption');restoreDocument(t.db,row);
    assert.deepEqual(nativeState(t.db,p.id),once);assert.equal(t.redemptions.reconcile(t.scope,p.id).disposition,'unchanged');
  }finally{t.close();}
  const corrupted=changedMerchant(packed,copy=>{const row=copy.rows.commerce_support_documents.find((r:Value)=>r.kind===OP_KIND&&r.id===p.id),body={...JSON.parse(row.body),points:200};row.body=canonical(body);row.digest=contentDigest(body);}),empty=target(f);
  try{assert.throws(()=>transfer(f,empty,corrupted));assert.equal(count(empty.db,'commerce_operations'),0);assert.equal(documentRows(empty.db).length,0);assert.equal(count(empty.db,'commerce_recovery_state'),0);}finally{empty.close();}
  assert.equal(sourceJournal(f).length,1);assertBalances(f,EXPECTED.after_400,2);assertDebit(f,p.id,EXPECTED.source_debits[0]);
}));
