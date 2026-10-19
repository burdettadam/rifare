import test from 'node:test';
import assert from 'node:assert/strict';
import {CommerceJourneys} from '../../packages/commerce/commerce-journeys.mts';
import {SupportService} from '../../packages/commerce/support-service.mts';
import {PrivacyLifecycle} from '../../packages/commerce/privacy-lifecycle.mts';
import {ExecutionStops} from '../../packages/commerce/execution-stops.mts';
import {IntegrationReadiness,DRAFT_ACTION} from '../../packages/commerce/integration-readiness.mts';
import {canonical,contentDigest} from '../../packages/commerce/configuration-values.mts';
import {restoreRecoverySnapshot} from '../../packages/commerce/safe-recovery.mts';
import {
  usingJourneys,common,openInput,open,context,attachInput,attach,prepareInput,prepare,executeInput,execute,reconcileInput,forgetInput,forget,
  intent,currentOrder,count,rows,reference,operationReferences,labelProposal,editProposal,assertSafe,assertBlocker,assertRedacted,replaceJourneyRow,effects,newCase,genericOperation,lostNativeReturn,
  verifiedCustomer,updateResource,otherMerchant,snapshot,restoreInput,restored,target,merchant,imported,changedMerchant,changedRecovery,noRestoreResidue,
} from './commerce-journeys-helpers.mts';
import type {Value} from './commerce-journeys-helpers.mts';

// Independent ADR-0055 specifications: exactly twenty-three native cases.
const approval=(f:any,p:Value)=>f.gateway.approve(f.reviewer.scope,{preview_id:p.id,preview_digest:p.digest});
const stop=(f:any,action:string,stopped=true,expected_revision=0)=>new ExecutionStops(f.kernel).set(f.owner.scope,{action,stopped,expected_revision,reason:stopped?'maintenance':'reviewed_resume'});
const uses=(f:any,id:string)=>f.db.prepare('SELECT uses FROM commerce_action_approvals WHERE id=?').get(id).uses;

test('CASE-M18-G03-01',()=>usingJourneys(async f=>{
  const caseCount=count(f.db,'commerce_cases');assert.equal(context(f).status,'missing');assert.equal(open(f).version,1);
  const tracking=attach(f,1,'tracking');assert.equal(intent(tracking,'tracking_one').state,'available');
  const op=f.replacement(),refs=operationReferences(f,op),linked=attach(f,2,'exchange',refs);
  assert.equal(linked.case_id,'resolution_case');assert.equal(linked.resource_id,currentOrder(f).id);assert.deepEqual(intent(linked,'exchange_one').references,refs);
  const documents=rows(f),receipt=f.gateway.receipt(f.a.scope,op.receipt.id);
  f.fulfillmentSource.fault='after';assert.equal((await f.execution.dispatch(f.a.scope,op.id)).state,'unknown');assert.equal(f.fulfillmentSource.calls.replace,1);
  assertBlocker(context(f),'fulfillment',op.id);assert.equal(intent(context(f),'exchange_one').state,'unknown');
  f.ownership.takeover(f.owner.scope,{case_id:f.caseId,expected_generation:1,reason:'provider_unavailable'});
  const web=f.conversations.link(f.owner.scope,f.customer,{case_id:f.caseId,channel:'webchat',account_id:'widget',external_id:'continued_journey',history:'unavailable',source_revision:1});
  const coordinator=new CommerceJourneys(f.kernel,f.reads,f.journeyOwners),caller=f.kernel.authenticate(f.owner.bearer),input=common(f,{link_id:web.id,expected_generation:2});
  const resumed=coordinator.context(caller,f.customer,input);assert.equal(resumed.id,linked.id);assert.equal(resumed.history.status,'unavailable');assert.equal(resumed.history.source_revision,1);
  const result=await coordinator.reconcile(caller,f.customer,{...input,expected_version:3,intent_id:'exchange_one',reference:refs[3]});
  assert.equal(result.native.id,op.id);assert.equal(result.native.state,'created');assert.equal(result.journey.id,linked.id);assert.equal(result.journey.version,3);
  assert.equal(result.journey.case_id,'resolution_case');assert.deepEqual(intent(result.journey,'exchange_one').references,refs);assert.deepEqual(result.journey.unresolved,[]);
  const observation=intent(result.journey,'exchange_one').observations.find((x:Value)=>x.reference.id===op.id);assert.ok(observation);assert.equal(observation.state,'created');
  assert.deepEqual(Object.keys(observation).sort(),['native_id','qualification','reference','state']);assert.equal(observation.qualification,'synthetic_only');
  assert.deepEqual(rows(f),documents);assert.deepEqual(f.gateway.receipt(f.owner.scope,op.receipt.id),receipt);assert.equal(uses(f,op.approval.id),1);
  assert.equal(count(f.db,'commerce_cases'),caseCount);assert.equal(count(f.db,'commerce_fulfillment_operations'),1);assert.equal(f.fulfillmentSource.calls.replace,1);assert.equal(f.fulfillmentSource.calls.buy,0);assertSafe(result.journey);
},'fulfillment'));

test('CASE-M18-G03-02',async()=>{
  for(const change of ['item','amount','order','source'])await usingJourneys(f=>{
    open(f);const reservation=f.reserve(),q=f.orders.quote(f.a.scope,{reservation_id:reservation.id}),p=prepare(f,1,q.proposal).native,a=approval(f,p);
    const before=effects(f);assert.throws(()=>execute(f,2,p,{id:'conversation_acknowledgement'}),/APPROVAL_UNAVAILABLE/);
    assert.throws(()=>execute(f,2,p,a,{acknowledgement:'Yes, please proceed'}));assert.throws(()=>execute(f,2,p,a,{amount_minor:'0'}));assert.deepEqual(effects(f),before);
    if(change==='item'||change==='amount'){
      const catalog=f.kernel.get(f.a.scope,f.catalogResource.id);updateResource(f,catalog,{...catalog.payload,...(change==='item'?{variant_id:'other-shoe'}:{unit_price_minor:'1100'})});
    }else{const order=currentOrder(f);updateResource(f,order,{...order.payload,...(change==='order'?{native_order_id:'gid://shopify/Order/999'}:{})});}
    const changed=effects(f);assert.throws(()=>execute(f,2,p,a),/CHANGED|STALE|UNAVAILABLE|MISMATCH/);assert.deepEqual(effects(f),changed);
    assert.equal(uses(f,a.id),0);assert.equal(count(f.db,'commerce_fulfillment_operations'),0);assert.equal(f.fulfillmentSource.calls.replace,0);assert.equal(f.fulfillmentSource.effects().length,0);
  },'fulfillment');
});

test('CASE-M18-G03-03',()=>usingJourneys(async f=>{
  open(f);const proposal=labelProposal(f),p=prepare(f,1,proposal).native,a=approval(f,p),op=f.replacement();
  f.fulfillmentSource.fault='after';assert.equal((await f.execution.dispatch(f.a.scope,op.id)).state,'unknown');
  const before=effects(f),view=context(f);assertBlocker(view,'fulfillment',op.id);assert.equal(view.version,2);
  assert.throws(()=>prepare(f,2,proposal,{request_id:'new_conversation_key',intent_id:'another_exchange'}),/JOURNEY_RECONCILIATION_REQUIRED/);
  assert.throws(()=>execute(f,2,p,a,{request_id:'new_execution_key'}),/JOURNEY_RECONCILIATION_REQUIRED/);
  assert.deepEqual(effects(f),before);assert.equal(uses(f,a.id),0);assert.equal(f.fulfillmentSource.calls.buy,0);assert.equal(f.fulfillmentSource.calls.replace,1);
  await f.execution.reconcile(f.a.scope,op.id);assert.deepEqual(context(f).unresolved,[]);
  const permitted=execute(f,2,p,a,{request_id:'after_original_reconciliation'});assert.equal(permitted.native.preview_id,p.id);assert.equal(permitted.native.approval_id,a.id);
  assert.equal(count(f.db,'commerce_fulfillment_operations'),2);assert.equal(f.fulfillmentSource.calls.buy,0);assert.equal(f.fulfillmentSource.calls.replace,1);
},'fulfillment'));

test('M18-G03-STRICT-INPUT-OWNERS-AND-FINITE-BOUNDS',async()=>{
  await usingJourneys(async f=>{
    const before=effects(f);for(const patch of [{provider_thread_id:'untrusted'},{available:true},{expected_generation:0},{expected_version:-1},{request_id:'bad request'},{preferences:{fit:'inferred'}},{case_id:null}])assert.throws(()=>open(f,patch));
    const getter=openInput(f);Object.defineProperty(getter,'case_id',{enumerable:true,get:()=>{throw Error('GETTER_EXECUTED');}});assert.throws(()=>f.journeys.open(f.a.scope,f.customer,getter),(e:any)=>e.message!=='GETTER_EXECUTED');
    const oversized=openInput(f,{request_id:'x'.repeat(33000)});assert.throws(()=>f.journeys.open(f.a.scope,f.customer,oversized));
    assert.throws(()=>new CommerceJourneys(f.kernel,{} as any));assert.throws(()=>new CommerceJourneys(f.kernel,f.reads,{fulfillment:{available:true} as any}));
    await usingJourneys(other=>{assert.throws(()=>new CommerceJourneys(f.kernel,f.reads,{delivery:other.delivery}));assert.throws(()=>new CommerceJourneys(f.kernel,other.reads,{delivery:f.delivery}));});assert.deepEqual(effects(f),before);
    open(f);for(let n=1;n<=10;n++)attach(f,n,'handoff',[],{intent_id:'handoff_'+n});const bounded=rows(f);
    assert.throws(()=>attach(f,11,'tracking',[],{intent_id:'eleventh_intent'}));assert.deepEqual(rows(f),bounded);
  });
  await usingJourneys(f=>{
    open(f);const proposal=labelProposal(f),refs=Array.from({length:33},()=>reference(f,'preview',f.gateway.prepare(f.a.scope,proposal).id));
    assert.equal(attach(f,1,'exchange',refs.slice(0,32)).version,2);const before=effects(f);assert.throws(()=>attach(f,2,'exchange',[refs[32]]));assert.deepEqual(effects(f),before);
  },'fulfillment');
});

test('M18-G03-EXACT-SCOPE-LINK-CUSTOMER-AND-CONTACT',()=>usingJourneys(f=>{
  open(f);attach(f,1,'tracking');const before=effects(f);
  for(const caller of [f.b.scope,f.c.scope,{}])assert.throws(()=>context(f,{},caller));
  for(const proof of [f.a.scope,f.b.scope,{}])assert.throws(()=>context(f,{},f.a.scope,proof));
  assert.throws(()=>context(f,{link_id:'thread_one'}));assert.throws(()=>context(f,{expected_generation:2}));assert.deepEqual(effects(f),before);
  const second=newCase(f,'same_order_case');assert.throws(()=>context(f,{link_id:second.link.id}));
  const other=verifiedCustomer(f,f.a,'ORD-1002'),foreign=newCase(f,'other_subject_case',other.scope,other.order.id);
  assert.throws(()=>context(f,{},f.a.scope,other.scope));assert.throws(()=>context(f,{case_id:foreign.caseId,link_id:foreign.link.id},f.customer));
  const source=f.kernel.lookup(f.a.scope,'customer','synthetic',currentOrder(f).customer_id);updateResource(f,source,{...source.payload,email:'updated-journey@example.invalid'});
  assert.throws(()=>context(f));assert.throws(()=>attach(f,2,'handoff'));
  const fresh=verifiedCustomer(f);assert.equal(context(f,{},f.a.scope,fresh.scope).id,rows(f)[0].id);assert.equal(JSON.stringify(context(f,{},f.a.scope,fresh.scope)).includes('updated-journey@example.invalid'),false);
}));

test('M18-G03-CURRENT-PROOF-PERMISSION-AND-LATE-OWNERSHIP',async()=>{
  await usingJourneys(async f=>{
    open(f);const op=f.replacement(),refs=operationReferences(f,op);attach(f,1,'exchange',refs);const proposal=labelProposal(f);
    f.permissions.change(f.owner.scope,{actor_id:'operator',role:'operator',expected_revision:0,actions:['case.read','resource.read','skill.read','profile.read','policy.read','return.read','support.read','support.reply','capability.read','action.propose','action.execute','operation.reconcile'],resource_ids:null});
    const before=effects(f);assert.equal(intent(context(f),'exchange_one').restricted,true);
    assert.throws(()=>prepare(f,2,proposal),/ACCESS_DENIED/);assert.throws(()=>execute(f,2,op.preview,op.approval),/ACCESS_DENIED/);
    await assert.rejects(()=>f.journeys.reconcile(f.a.scope,f.customer,reconcileInput(f,2,refs[3])),/ACCESS_DENIED/);assert.deepEqual(effects(f),before);
    f.ownership.takeover(f.owner.scope,{case_id:f.caseId,expected_generation:1,reason:'operator_requested'});assert.throws(()=>context(f),/OWNERSHIP|TAKEN_OVER/);
    f.fulfillmentSource.fault='after';await f.execution.dispatch(f.owner.scope,op.id);
    let release!:()=>void,started!:()=>void;const began=new Promise<void>(resolve=>{started=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;}),lookup=f.fulfillmentSource.lookup.bind(f.fulfillmentSource);
    f.fulfillmentSource.lookup=async(id:string)=>{started();await gate;return lookup(id);};
    const pending=f.journeys.reconcile(f.owner.scope,f.customer,reconcileInput(f,2,refs[3],{expected_generation:2}));await Promise.race([began,pending.then(()=>{throw Error('RECONCILIATION_SKIPPED_SOURCE_LOOKUP');})]);
    f.ownership.takeover(f.owner.scope,{case_id:f.caseId,expected_generation:2,reason:'operator_requested'});release();await assert.rejects(()=>pending,/OWNERSHIP|TAKEN_OVER/);
    assert.equal(rows(f).length,2);assert.equal(f.fulfillmentSource.calls.replace,1);assert.equal(context(f,{expected_generation:3},f.owner.scope).ownership_generation,3);
  },'fulfillment');
  await usingJourneys(f=>{
    open(f);const pending=f.prepare(),p={id:pending.preview_id,digest:pending.preview_digest},a=approval(f,p);attach(f,1,'return',[reference(f,'preview',p.id)]);
    const original=f.db.prepare('SELECT verification_hash FROM commerce_cases WHERE id=?').get(f.caseId).verification_hash;f.kernel.revoke(f.customer);
    assert.throws(()=>context(f));assert.throws(()=>attach(f,2,'handoff'));assert.throws(()=>forget(f,2));
    const fresh=verifiedCustomer(f),view=context(f,{},f.a.scope,fresh.scope);assert.equal(view.case_verification_current,false);assert.equal(view.handoff_required,true);
    assert.throws(()=>f.journeys.execute(f.a.scope,fresh.scope,executeInput(f,2,p,a,{intent_id:'return_one'})),/CUSTOMER_VERIFICATION_REQUIRED/);
    assert.equal(f.db.prepare('SELECT verification_hash FROM commerce_cases WHERE id=?').get(f.caseId).verification_hash,original);assert.equal(uses(f,a.id),0);
    f.advance(900001);const staff=f.kernel.authenticate(f.kernel.issueSession(f.a.tenant,f.a.store,'operator'));assert.throws(()=>context(f,{},staff,fresh.scope));
  });
});

test('M18-G03-CANONICAL-REFERENCE-ASSOCIATIONS',()=>usingJourneys(async f=>{
  open(f);const op=f.replacement(),refs=operationReferences(f,op),before=effects(f);
  for(const ref of [{...refs[0],digest:'0'.repeat(64)},{...refs[3],kind:'resolution'},{kind:'quote',id:op.preview.id,digest:op.preview.digest},{...refs[0],case_id:f.caseId}])assert.throws(()=>attach(f,1,'exchange',[ref]));
  assert.throws(()=>attach(f,1,'edit',refs));assert.deepEqual(effects(f),before);
  const second=newCase(f,'another_case');open(second);assert.throws(()=>attach(second,1,'exchange',refs),'same order still requires the exact canonical case');
  const correct=attach(f,1,'exchange',refs);assert.deepEqual(intent(correct,'exchange_one').references,refs);
  await assert.rejects(()=>f.journeys.reconcile(f.a.scope,f.customer,reconcileInput(f,2,{...refs[3],id:'unattached_operation'})));
  assert.throws(()=>attach(f,2,'exchange',[{kind:'delivery',id:op.id,digest:refs[3].digest}]));assert.equal(f.fulfillmentSource.calls.replace,0);
},'fulfillment'));

test('M18-G03-EXPLICIT-HANDOFF-HISTORY-AND-MISSING-OWNERS',()=>usingJourneys(async f=>{
  open(f);const op=f.replacement();attach(f,1,'exchange',operationReferences(f,op));
  const missing=new CommerceJourneys(f.kernel,f.reads,{delivery:f.delivery}),before=effects(f),view=missing.context(f.a.scope,f.customer,common(f));
  assert.equal(intent(view,'exchange_one').state,'handoff');assert.equal(view.handoff_required,true);
  await assert.rejects(()=>missing.reconcile(f.a.scope,f.customer,reconcileInput(f,2,reference(f,'fulfillment',op.id))));assert.deepEqual(effects(f),before);
  const web=f.conversations.link(f.a.scope,f.customer,{case_id:f.caseId,channel:'webchat',account_id:'widget',external_id:'missing_history',history:'unavailable',source_revision:3});
  const handoff=attach(f,2,'handoff',[],{link_id:web.id});assert.equal(intent(handoff,'handoff_one').state,'handoff');assert.equal(handoff.history.status,'unavailable');assert.equal(handoff.history.source_revision,3);
  assert.throws(()=>attach(f,3,'voice',[],{request_id:'unsupported_intent'}));assert.throws(()=>attach(f,3,'return',[]));
  for(const action of ['diagnostic.return.submit','diagnostic.resolution.set','diagnostic.instant.exchange','arbitrary.execute'])assert.throws(()=>prepare(f,3,{case_id:f.caseId,action,arguments:{}},{request_id:'unsupported_'+action}),/JOURNEY_ACTION_UNSUPPORTED/);
  assert.equal(f.fulfillmentSource.calls.replace,0);assertSafe(context(f));
},'fulfillment'));

test('M18-G03-CONTIGUOUS-VERSIONS-AND-REQUEST-REPLAY',()=>usingJourneys(f=>{
  const first=open(f),op=f.replacement(),refs=operationReferences(f,op);assert.match(first.id,/^journey_[a-f0-9]{40}$/);
  const second=attach(f,1,'exchange',[refs[0]]);assert.equal(second.version,2);
  const third=attach(f,2,'exchange',refs.slice(1));assert.equal(third.id,first.id);assert.deepEqual(intent(third,'exchange_one').references,refs);
  const saved=rows(f);assert.deepEqual(saved.map(r=>r.version),[1,2,3]);assert.deepEqual(saved.map(r=>r.state),['revoked','revoked','active']);
  assert.equal(new Set(saved.map(r=>JSON.parse(r.body).request_hash)).size,3);
  for(const row of saved){assert.equal(row.author,'journey_coordinator');assert.equal(row.reviewer,null);assert.equal(row.review_digest,null);assert.equal(row.expires_at,null);assert.equal(row.digest,contentDigest(JSON.parse(row.body)));}
  assert.throws(()=>attach(f,1,'handoff',[],{request_id:'new_stale_request'}),/JOURNEY_VERSION_CHANGED/);
  assert.throws(()=>attach(f,3,'handoff',[],{request_id:'attach_1'}),/JOURNEY_REQUEST_REPLAY/);
  assert.throws(()=>attach(f,3,'handoff',[],{request_id:'journey_open'}),/JOURNEY_REQUEST_REPLAY/);
  assert.throws(()=>attach(f,3,'handoff',[],{intent_id:'exchange_one',request_id:'change_kind'}));assert.throws(()=>open(f));assert.deepEqual(rows(f),saved);
},'fulfillment'));

test('M18-G03-NATIVE-PREPARE-AND-INTAKE-OWNER',async()=>{
  await usingJourneys(f=>{
    open(f);const proposal=labelProposal(f),beforePreviews=count(f.db,'commerce_action_previews'),beforeReceipts=count(f.db,'commerce_action_receipts'),result=prepare(f,1,proposal);
    assert.equal(result.native.approval_required,true);assert.equal(result.native.execution_authorized,false);assert.equal(result.journey.version,2);
    assert.equal(count(f.db,'commerce_action_previews'),beforePreviews+1);assert.equal(count(f.db,'commerce_action_receipts'),beforeReceipts);assert.equal(count(f.db,'commerce_fulfillment_operations'),0);
    assert.deepEqual(intent(result.journey,'exchange_one').references,[reference(f,'preview',result.native.id)]);assert.equal(intent(result.journey,'exchange_one').state,'awaiting_approval');
    const retained=f.db.prepare('SELECT body,digest FROM commerce_action_previews WHERE id=?').get(result.native.id);assert.deepEqual(JSON.parse(retained.body),result.native.preview);assert.equal(retained.digest,result.native.digest);
    assert.equal(f.fulfillmentSource.calls.buy,0);assertSafe(result.journey);
  },'fulfillment');
  await usingJourneys(f=>{
    open(f);const q=f.quote(),pending=f.prepare(q),before=effects(f);
    assert.throws(()=>prepare(f,1,{case_id:f.caseId,action:'diagnostic.return.submit',arguments:{quote_id:q.id,quote_digest:q.digest,override_id:null}},{kind:'return',intent_id:'return_one'}),/JOURNEY_ACTION_UNSUPPORTED/);
    assert.throws(()=>attach(f,1,'return',[reference(f,'return_request',pending.id)]),/JOURNEY_REFERENCE_MUTABLE/);assert.deepEqual(effects(f),before);
    const p={id:pending.preview_id,digest:pending.preview_digest};attach(f,1,'return',[reference(f,'preview',p.id)]);const a=approval(f,p),sent=execute(f,2,p,a,{intent_id:'return_one'});
    assert.equal(sent.native.return_request_id,pending.id);assert.equal(sent.native.preview_id,p.id);assert.equal(sent.native.approval_id,a.id);
    assert.ok(intent(sent.journey,'return_one').references.some((r:Value)=>r.kind==='return_request'&&r.id===pending.id));assert.equal(count(f.db,'commerce_return_requests'),1);assert.equal(count(f.db,'commerce_native_return_operations'),0);
  });
});

test('M18-G03-EXACT-APPROVAL-RECEIPT-AND-ATOMIC-EXECUTION',()=>usingJourneys(f=>{
  open(f);const p=prepare(f,1,labelProposal(f)).native,a=approval(f,p),before=effects(f);
  assert.throws(()=>execute(f,2,p,a,{intent_id:'unattached_intent'}));assert.throws(()=>execute(f,2,{...p,digest:'0'.repeat(64)},a));assert.deepEqual(effects(f),before);
  const result=execute(f,2,p,a),op=result.native.fulfillment_operation_id,refs=intent(result.journey,'exchange_one').references;
  assert.equal(result.native.preview_id,p.id);assert.equal(result.native.preview_digest,p.digest);assert.equal(result.native.approval_id,a.id);assert.equal(result.journey.version,3);
  for(const expected of [reference(f,'preview',p.id),reference(f,'approval',a.id),reference(f,'receipt',result.native.id),reference(f,'fulfillment',op)])assert.ok(refs.some((r:Value)=>canonical(r)===canonical(expected)));
  assert.deepEqual(f.gateway.receipt(f.a.scope,result.native.id),result.native);assert.equal(uses(f,a.id),1);assert.equal(count(f.db,'commerce_fulfillment_operations'),1);assert.equal(f.fulfillmentSource.calls.buy,0);
  const after=effects(f);assert.throws(()=>execute(f,3,p,a,{request_id:'execute_2'}),/JOURNEY_REQUEST_REPLAY/);assert.throws(()=>execute(f,3,p,a,{request_id:'different_duplicate'}),/APPROVAL_UNAVAILABLE/);assert.deepEqual(effects(f),after);
},'fulfillment'));

test('M18-G03-CURRENT-STOPS-READINESS-AND-APPROVAL',async()=>{
  for(const control of ['stop','readiness','approval','configuration'])await usingJourneys(f=>{
    open(f);const p=prepare(f,1,labelProposal(f)).native,a=approval(f,p),display=context(f);assert.equal(intent(display,'exchange_one').state,'awaiting_approval');
    if(control==='stop')stop(f,'diagnostic.label.purchase');else if(control==='readiness')new IntegrationReadiness(f.kernel).revoke(f.owner.scope,{action:DRAFT_ACTION});else if(control==='approval')f.gateway.revokeApproval(f.reviewer.scope,a.id);else{
      f.publish({expected_version:2,rules:{window_days:20,require_evidence:false,excluded_tags:['final-sale'],outcomes:['refund','exchange','store_credit']}});
      const current=context(f);assert.equal(current.configuration_current,false);assert.deepEqual(intent(current,'exchange_one').references,intent(display,'exchange_one').references);
    }
    const before=effects(f);assert.throws(()=>execute(f,2,p,a),control==='stop'?/EXECUTION_STOPPED/:control==='readiness'?/INTEGRATION_NOT_READY/:control==='approval'?/APPROVAL_UNAVAILABLE/:/CHANGED|REPREVIEW/);
    assert.deepEqual(effects(f),before);assert.equal(uses(f,a.id),0);assert.equal(f.fulfillmentSource.calls.buy,0);
  },'fulfillment');
});

test('M18-G03-UNKNOWN-GENERIC-RESOURCE-SCOPE',()=>usingJourneys(f=>{
  open(f);const proposal=labelProposal(f),other=verifiedCustomer(f,f.a,'ORD-1002'),unrelated=genericOperation(newCase(f,'unrelated_unknown',other.scope,other.order.id));
  try{
    assert.deepEqual(context(f).unresolved,[]);assert.equal(prepare(f,1,proposal).journey.version,2);
    const unknown=genericOperation(f,f.caseId,op=>{
      const sending=context(f).unresolved.find((x:Value)=>x.family==='generic'&&x.id===op.id);assert.ok(sending);assert.equal(sending.state,'sending');assert.equal(sending.handoff_required,true);
      assert.throws(()=>prepare(f,2,proposal,{request_id:'while_source_is_sending'}),/JOURNEY_RECONCILIATION_REQUIRED/);
    });try{
      const view=context(f);assertBlocker(view,'generic',unknown.op.id);assert.equal(view.unresolved.some((x:Value)=>x.id===unrelated.op.id),false);const before=effects(f);
      assert.throws(()=>prepare(f,2,proposal),/JOURNEY_RECONCILIATION_REQUIRED/);assert.deepEqual(effects(f),before);assert.equal(unknown.journal.count(),1);assert.equal(unrelated.journal.count(),1);assert.equal(f.fulfillmentSource.calls.buy,0);
    }finally{unknown.close();}
  }finally{unrelated.close();}
},'fulfillment'));

test('M18-G03-UNKNOWN-NATIVE-RETURN-AND-ORPHAN-GUARD',()=>usingJourneys(async f=>{
  const first=f.prepare();f.submit(first);const source=lostNativeReturn(f),unknown=await source.native.create(f.a.scope,first.id);assert.equal(unknown.state,'unknown');
  const pendingCase=newCase(f,'pending_same_order'),q=f.intake.evaluate(f.customer,f.selection({case_id:pendingCase.caseId,lines:[{line_id:'three',quantity:1}]}));
  const pending=f.intake.prepare(f.customer,{quote_id:q.id,quote_digest:q.digest,request_key:'second_actual_intake',override_id:null}),p={id:pending.preview_id,digest:pending.preview_digest},a=approval(f,p);
  open(pendingCase);attach(pendingCase,1,'return',[reference(f,'preview',p.id)]);const c=context(pendingCase);assertBlocker(c,'native_return',unknown.id);assert.equal(c.unresolved.find((x:Value)=>x.id===unknown.id).request_id,first.id);
  const before=effects(f);assert.throws(()=>execute(pendingCase,2,p,a,{intent_id:'return_one'}),/JOURNEY_RECONCILIATION_REQUIRED/);assert.deepEqual(effects(f),before);assert.equal(uses(f,a.id),0);assert.deepEqual(source.counts(),{creates:1,reads:0});
  f.db.prepare('DELETE FROM commerce_return_requests WHERE id=?').run(first.id);const orphaned=effects(f);
  assert.throws(()=>execute(pendingCase,2,p,a,{intent_id:'return_one',request_id:'orphan_cannot_be_hidden'}),/INTEGRITY/);assert.deepEqual(effects(f),orphaned);assert.equal(uses(f,a.id),0);assert.deepEqual(source.counts(),{creates:1,reads:0});
}));

test('M18-G03-UNKNOWN-RESOLUTION-PRESERVES-ORIGINAL-OPERATION',()=>usingJourneys(async f=>{
  open(f);const proposal=labelProposal(f),allocation=f.plan.allocations.find((x:Value)=>x.outcome==='refund'),op=f.authorize(f.quote(allocation));
  const issue=f.source.issue.bind(f.source);f.source.issue=async(value:Value)=>{await issue(value);throw Error('lost_resolution_response');};
  assert.equal((await f.executor.dispatch(f.a.scope,op.id)).state,'unknown');attach(f,1,'return',operationReferences(f,op,'resolution'));
  const view=context(f);assertBlocker(view,'resolution',op.id);assert.equal(intent(view,'return_one').state,'unknown');const before=effects(f);
  assert.throws(()=>prepare(f,2,proposal),/JOURNEY_RECONCILIATION_REQUIRED/);assert.deepEqual(effects(f),before);assert.equal(count(f.sourceDb,'fixture_resolution_effects'),1);
  const result=await f.journeys.reconcile(f.a.scope,f.customer,reconcileInput(f,2,reference(f,'resolution',op.id),{intent_id:'return_one'}));
  assert.equal(result.native.id,op.id);assert.equal(result.native.state,'accepted');assert.equal(result.journey.version,2);assert.equal(count(f.sourceDb,'fixture_resolution_effects'),1);assert.deepEqual(result.journey.unresolved,[]);
  assert.equal(f.gateway.receipt(f.a.scope,op.receipt.id).resolution_operation_id,op.id);
},'fulfillment'));

test('M18-G03-UNKNOWN-EDIT-CHILD-AND-PARENT-CONSERVATISM',()=>usingJourneys(async f=>{
  open(f);attach(f,1,'tracking');const cached=editProposal(f),receipt=f.authorize(),editId=receipt.order_edit_id;
  f.native.fault='after';f.native.faultStage='begin';assert.equal((await f.edits.dispatch(f.a.scope,editId)).state,'unknown');
  const blocker=assertBlocker(context(f),'edit',editId),step=f.db.prepare("SELECT operation_id,stage,state FROM commerce_edit_steps WHERE edit_id=? AND state='unknown'").get(editId);
  assert.ok(blocker.edit_steps.some((x:Value)=>x.operation_id===step.operation_id&&x.stage==='begin'&&x.state==='unknown'));
  const before=effects(f);assert.throws(()=>prepare(f,2,cached,{kind:'edit',intent_id:'edit_one'}),/JOURNEY_RECONCILIATION_REQUIRED/);assert.deepEqual(effects(f),before);
  attach(f,2,'edit',[reference(f,'edit',editId)]);const nativeCount=count(f.sourceDb,'edit_source_effects'),result=await f.journeys.reconcile(f.a.scope,f.customer,reconcileInput(f,3,reference(f,'edit',editId),{intent_id:'edit_one'}));
  assert.equal(result.native.id,editId);assert.equal(result.native.state,'unknown');assert.equal(result.native.stages.find((x:Value)=>x.operation_id===step.operation_id).state,'confirmed');
  assertBlocker(result.journey,'edit',editId);assert.equal(count(f.sourceDb,'edit_source_effects'),nativeCount);
  assert.throws(()=>prepare(f,3,cached,{kind:'edit',intent_id:'another_edit'}),/JOURNEY_RECONCILIATION_REQUIRED/);
},'shopping').then(()=>usingJourneys(async f=>{
  open(f);attach(f,1,'tracking');const cached=editProposal(f),editId=f.authorize().order_edit_id;f.native.fault='after';f.native.faultStage='begin';await f.edits.dispatch(f.a.scope,editId);
  f.db.prepare('DELETE FROM commerce_order_edits WHERE id=?').run(editId);const before=effects(f);
  assert.throws(()=>prepare(f,2,cached,{kind:'edit',intent_id:'edit_one'}),/INTEGRITY/);assert.deepEqual(effects(f),before);
},'shopping')));

test('M18-G03-UNKNOWN-CART-RECONCILIATION-NEVER-COMMITS-PROPOSED',()=>usingJourneys(async f=>{
  open(f);const cached=editProposal(f),cart=f.cart(),ref=reference(f,'cart',cart.cart_id);attach(f,1,'shopping',[ref]);
  const before=effects(f);await assert.rejects(()=>f.journeys.reconcile(f.a.scope,f.customer,reconcileInput(f,2,ref,{intent_id:'shopping_one'})),/JOURNEY_OPERATION_NOT_ATTEMPTED/);
  await assert.rejects(()=>f.journeys.reconcile(f.customer,f.customer,reconcileInput(f,2,ref,{intent_id:'shopping_one'})),/ACCESS_DENIED/);assert.deepEqual(effects(f),before);assert.equal(count(f.sourceDb,'growth_source_cart_effects'),0);
  f.catalogSource.fault='after';const native=await f.carts.confirm(f.customer,{cart_id:cart.cart_id,preview_digest:cart.preview_digest});assert.equal(native.state,'unknown');assert.equal(count(f.sourceDb,'growth_source_cart_effects'),1);
  const blocked=context(f);assertBlocker(blocked,'cart',native.operation_id);assert.equal(blocked.unresolved.find((x:Value)=>x.id===native.operation_id).cart_id,cart.cart_id);
  assert.throws(()=>prepare(f,2,cached,{kind:'edit',intent_id:'edit_one'}),/JOURNEY_RECONCILIATION_REQUIRED/);
  const docs=rows(f),result=await f.journeys.reconcile(f.a.scope,f.customer,reconcileInput(f,2,ref,{intent_id:'shopping_one'}));
  assert.equal(result.native.operation_id,native.operation_id);assert.equal(result.native.state,'committed');assert.deepEqual(rows(f),docs);assert.deepEqual(intent(result.journey,'shopping_one').references,[ref]);
  assert.equal(count(f.sourceDb,'growth_source_cart_effects'),1);assert.deepEqual(result.journey.unresolved,[]);
  await f.journeys.reconcile(f.a.scope,f.customer,reconcileInput(f,2,ref,{intent_id:'shopping_one'}));assert.equal(count(f.sourceDb,'growth_source_cart_effects'),1);
},'shopping'));

test('M18-G03-RESTRICTED-PROJECTION-AND-MANUAL-DISPATCH',()=>usingJourneys(async f=>{
  stop(f,'model.run');const service=new SupportService(f.kernel,f.reads,{sources:[f.supportSource],journeys:{fulfillment:f.execution,resolution:f.executor}});
  assert.equal(service.runner,null);assert.equal(service.routing,null);
  const started:any=await service.post(f.a.scope,'journey-open',{customer_token:f.customerBearer,input:openInput(f)});assert.equal(started.status,'active');
  const op=f.replacement(),refs=operationReferences(f,op);await service.post(f.a.scope,'journey-attach',{customer_token:f.customerBearer,input:attachInput(f,1,'exchange',refs)});
  f.fulfillmentSource.fault='after';await f.execution.dispatch(f.a.scope,op.id);
  const get=(caller:any)=>service.post(caller,'journey-context',{customer_token:f.customerBearer,input:common(f)}) as Promise<Value>;
  const before=effects(f),staff=await get(f.a.scope),customer=await get(f.customer);assertBlocker(staff,'fulfillment',op.id);
  const restricted=intent(customer,'exchange_one');assert.equal(restricted.restricted,true);assert.equal(restricted.state,'restricted');assert.deepEqual(restricted.references,[]);assert.deepEqual(restricted.observations,[]);assert.deepEqual(customer.unresolved,[]);assert.equal(customer.handoff_required,true);
  for(const id of refs.map(r=>r.id))assert.equal(JSON.stringify(customer).includes(id),false);assert.equal(JSON.stringify(staff).includes('customer-address-one'),false);assert.equal(JSON.stringify(staff).includes(f.customerBearer),false);
  assert.deepEqual(staff,service.journeys.context(f.a.scope,f.customer,common(f)));assert.deepEqual(effects(f),before);assertSafe(customer);
  await assert.rejects(()=>service.post(f.a.scope,'journey-context',{customer_token:f.customerBearer,input:common(f),preview_id:op.preview.id}));
  await assert.rejects(()=>service.post(f.a.scope,'journey-context',{customer_token:f.customerBearer,input:{...common(f),model_thread_id:'forged'}}));
  const reconciled:any=await service.post(f.a.scope,'journey-reconcile',{customer_token:f.customerBearer,input:reconcileInput(f,2,refs[3])});assert.equal(reconciled.native.id,op.id);assert.equal(f.fulfillmentSource.calls.replace,1);
  const readiness:any=await service.post(f.a.scope,'journey-readiness',{...common(f),allocation_id:null,cart_id:null,sender_id:'sender_one'});assert.equal(readiness.execution_authorized,false);
  const proposal=labelProposal(f),prepared:any=await service.post(f.a.scope,'journey-prepare',{customer_token:f.customerBearer,input:prepareInput(f,2,proposal,{intent_id:'label_followup'})}),a=approval(f,prepared.native);
  const sent:any=await service.post(f.a.scope,'journey-execute',{customer_token:f.customerBearer,input:executeInput(f,3,prepared.native,a,{intent_id:'label_followup'})});assert.equal(sent.native.approval_id,a.id);assert.equal(f.fulfillmentSource.calls.buy,0);
  const queued=f.delivery.queue(f.a.scope,f.message()),messageRef=reference(f,'delivery',queued.operation_id);
  const followed:any=await service.post(f.a.scope,'journey-attach',{customer_token:f.customerBearer,input:attachInput(f,4,'followup',[messageRef])});assert.deepEqual(intent(followed,'followup_one').references,[messageRef]);assert.equal(intent(followed,'followup_one').observations[0].state,'queued');
  await service.post(f.customer,'journey-forget',forgetInput(f,5));assert.equal((await get(f.customer)).status,'forgotten');assert.equal(count(f.db,'commerce_model_reservations'),0);assert.equal(f.supportSource.calls,0);
},'fulfillment'));

test('M18-G03-HISTORICAL-INTEGRITY-AND-RESTORE-PREFLIGHT',()=>usingJourneys(f=>{
  open(f);const op=f.replacement(),refs=operationReferences(f,op);attach(f,1,'exchange',refs);const original=rows(f),first=original[0],last=original[1];
  replaceJourneyRow(f.db,{...first,digest:'0'.repeat(64)});assert.throws(()=>context(f));replaceJourneyRow(f.db,first);
  const wrong=JSON.parse(first.body);wrong.intents=structuredClone(JSON.parse(last.body).intents);wrong.intents[0].references[0].digest='0'.repeat(64);
  replaceJourneyRow(f.db,{...first,body:canonical(wrong),digest:contentDigest(wrong)});assert.throws(()=>context(f));replaceJourneyRow(f.db,first);
  replaceJourneyRow(f.db,{...first,author:'untrusted_worker'});assert.throws(()=>context(f));replaceJourneyRow(f.db,first);
  const malformed=(r:Value)=>{const b={...JSON.parse(r.body),untrusted_transcript:'must not be concealed by suppression'};return {...r,body:canonical(b),digest:contentDigest(b)};};
  const transfer=changedMerchant(merchant(f),copy=>{copy.rows.commerce_support_documents=copy.rows.commerce_support_documents.map((r:Value)=>r.kind==='commerce_journey'&&r.version===1?malformed(r):r);});
  const backup=changedRecovery(snapshot(f),db=>replaceJourneyRow(db,malformed(first)));
  new PrivacyLifecycle(f.kernel).erase(f.owner.scope,'C-1001');const input=restoreInput(f,backup,'malformed_journey_restore');assert.throws(()=>restoreRecoverySnapshot(input,f.now),/JOURNEY|INTEGRITY/);noRestoreResidue(f,input);
  const t=target(f);try{assert.throws(()=>imported(f,t,transfer),/JOURNEY|INTEGRITY/);assert.equal(count(t.db,'commerce_resources'),0);assert.equal(count(t.db,'commerce_support_documents'),0);assert.equal(count(t.db,'commerce_recovery_state'),0);}finally{t.close();}
},'fulfillment'));

test('M18-G03-SCOPED-SUBJECT-EXPORT-ERASURE-AND-REASSIGNMENT',()=>usingJourneys(f=>{
  open(f);const op=f.replacement(),refs=operationReferences(f,op);attach(f,1,'exchange',refs);
  const other=verifiedCustomer(f,f.a,'ORD-1002'),otherCase=newCase(f,'other_subject_journey',other.scope,other.order.id);open(otherCase);attach(otherCase,1,'tracking');const otherRows=rows(otherCase);
  const merchantContext=otherMerchant(f),second={...f,...merchantContext,a:merchantContext.store,customer:merchantContext.customer.scope,journeys:new CommerceJourneys(f.kernel,f.reads,{delivery:merchantContext.delivery})};
  try{
    open(second);attach(second,1,'tracking');const storeRows=rows(second),privacy=new PrivacyLifecycle(f.kernel),exported:any=privacy.export(f.owner.scope,'C-1001');
    const record=exported.journey_records.find((r:Value)=>r.case_id===f.caseId&&r.version===2);assert.ok(record);assert.equal(record.subject_projection,true);assert.equal(record.retained_under_hold,false);assert.equal(record.state,'active');
    assert.deepEqual(record.intents.find((i:Value)=>i.id==='exchange_one').references,refs);assert.equal(Object.hasOwn(record,'body'),false);assert.equal(JSON.stringify(exported.journey_records).includes(otherRows[0].id),false);assert.equal(JSON.stringify(exported.journey_records).includes(storeRows[0].id),false);assert.equal(JSON.stringify(exported).includes(f.customerBearer),false);
    const order=currentOrder(f);updateResource(f,order,order.payload,'C-1002');assert.throws(()=>context(f));const reassigned=f.kernel.get(f.a.scope,order.id);
    f.db.prepare("DELETE FROM commerce_resources WHERE tenant_id=? AND store_id=? AND (customer_id='C-1001' OR (kind='customer' AND external_id='C-1001'))").run(f.a.tenant,f.a.store);
    const historical:any=privacy.export(f.owner.scope,'C-1001');assert.equal(historical.resources.length,0);assert.ok(historical.journey_records.some((r:Value)=>r.case_id===f.caseId&&r.version===2));
    assert.equal(privacy.erase(f.owner.scope,'C-1001').status,'logically_erased');for(const row of rows(f))assertRedacted(row,[f.link.id,...refs.map(r=>r.id)]);
    assert.deepEqual(f.kernel.get(f.a.scope,order.id),reassigned);assert.deepEqual(rows(otherCase),otherRows);assert.deepEqual(rows(second),storeRows);
  }finally{merchantContext.closeSupport();}
},'fulfillment'));

test('M18-G03-FORGET-ALL-VERSIONS-HOLDS-AND-NATIVE-LEDGERS',async()=>{
  await usingJourneys(f=>{
    open(f);const op=f.replacement(),refs=operationReferences(f,op);attach(f,1,'exchange',refs);attach(f,2,'tracking');
    const native=f.db.prepare('SELECT * FROM commerce_fulfillment_operations').all(),receipts=f.db.prepare('SELECT * FROM commerce_action_receipts').all();
    forget(f,3);const empty=context(f);assert.equal(empty.status,'forgotten');assert.deepEqual(empty.intents,[]);assert.equal(empty.version,4);
    for(const row of rows(f))assertRedacted(row,[f.link.id,...refs.map(r=>r.id)]);assert.throws(()=>open(f,{request_id:'reopen_forgotten'}));assert.throws(()=>attach(f,4,'tracking',[],{request_id:'resume_forgotten'}));
    assert.deepEqual(f.db.prepare('SELECT * FROM commerce_fulfillment_operations').all(),native);assert.deepEqual(f.db.prepare('SELECT * FROM commerce_action_receipts').all(),receipts);assert.equal(f.fulfillmentSource.calls.replace,0);
  },'fulfillment');
  await usingJourneys(f=>{
    open(f);const op=f.replacement(),refs=operationReferences(f,op);attach(f,1,'exchange',refs);const privacy=new PrivacyLifecycle(f.kernel);
    privacy.hold(f.owner.scope,{customer_id:'C-1001',reason:'retention_obligation',authority_ref:'journey_hold',expires_at:f.now()+10000});attach(f,2,'tracking');forget(f,3);
    const empty=context(f);assert.equal(empty.status,'forgotten');assert.equal(empty.retained_under_hold,true);assert.deepEqual(empty.intents,[]);for(const id of refs.map(r=>r.id))assert.equal(JSON.stringify(empty).includes(id),false);
    const retained=rows(f);assert.equal(retained.length,4);assert.ok(retained.some(r=>r.state==='revoked'&&JSON.parse(r.body).intents.length>0));assertRedacted(retained[3]);
    const exported:any=privacy.export(f.owner.scope,'C-1001');assert.ok(exported.journey_records.some((r:Value)=>r.retained_under_hold&&r.intents.some((i:Value)=>i.references.some((x:Value)=>x.id===op.id))));
    assert.equal(privacy.erase(f.owner.scope,'C-1001').status,'held');assert.deepEqual(rows(f),retained);
    privacy.releaseHold(f.owner.scope,'C-1001','journey_hold');assert.equal(context(f).retained_under_hold,false);for(const row of rows(f))assertRedacted(row,[f.link.id,...refs.map(r=>r.id)]);
    assert.equal(count(f.db,'commerce_fulfillment_operations'),1);assert.equal(f.fulfillmentSource.calls.replace,0);
  },'fulfillment');
});

test('M18-G03-UNINSTALL-AND-NATIVE-RESTORE-SUPPRESSION',async()=>{
  await usingJourneys(f=>{
    open(f);const op=f.replacement(),refs=operationReferences(f,op);attach(f,1,'exchange',refs);const operationIds=f.db.prepare('SELECT id FROM commerce_fulfillment_operations ORDER BY id').all(),receiptIds=f.db.prepare('SELECT id FROM commerce_action_receipts ORDER BY id').all(),backup=snapshot(f);
    forget(f,2);restored(f,backup,({db,kernel,result})=>{for(const row of rows({...f,db}))assertRedacted(row,[f.link.id,...refs.map(r=>r.id)]);assert.deepEqual(db.prepare('SELECT id FROM commerce_fulfillment_operations ORDER BY id').all(),operationIds);assert.deepEqual(db.prepare('SELECT id FROM commerce_action_receipts ORDER BY id').all(),receiptIds);assert.equal(result.mode,'quarantine');assert.equal(result.external_effects,false);assert.throws(()=>kernel.authenticate(f.customerBearer));assert.equal(db.prepare('SELECT count(*) n FROM commerce_action_approvals WHERE revoked=0').get().n,0);});
    assert.equal(f.fulfillmentSource.calls.replace,0);
  },'fulfillment');
  await usingJourneys(f=>{
    open(f);attach(f,1,'tracking');const other=verifiedCustomer(f,f.a,'ORD-1002'),otherCase=newCase(f,'unheld_journey',other.scope,other.order.id);open(otherCase);attach(otherCase,1,'tracking');const privacy=new PrivacyLifecycle(f.kernel);
    privacy.hold(f.owner.scope,{customer_id:'C-1001',reason:'dispute',authority_ref:'uninstall_journey_hold',expires_at:f.now()+10000});const backup=snapshot(f),input=restoreInput(f,backup,'held_journey_restore'),held=rows(f);
    assert.throws(()=>restoreRecoverySnapshot(input,f.now),/HELD/);noRestoreResidue(f,input);assert.deepEqual(rows(f),held);
    assert.equal(privacy.uninstall(f.owner.scope).status,'disconnected');assert.ok(rows(f).every(r=>r.state==='revoked'));assert.ok(rows(f).some(r=>JSON.parse(r.body).status==='current'));
    for(const row of rows(otherCase))assertRedacted(row,[otherCase.link.id]);assert.throws(()=>context(f));assert.throws(()=>f.kernel.require(f.customer));
  });
  await usingJourneys(f=>{
    open(f);attach(f,1,'tracking');const privacy=new PrivacyLifecycle(f.kernel),order=currentOrder(f);privacy.hold(f.owner.scope,{customer_id:'C-1001',reason:'dispute',authority_ref:'obsolete_journey_hold',expires_at:f.now()+10000});const backup=snapshot(f);
    privacy.releaseHold(f.owner.scope,'C-1001','obsolete_journey_hold');f.advance(1);privacy.erase(f.owner.scope,'C-1001');
    restored(f,backup,({db,result})=>{for(const row of rows({...f,db}))assertRedacted(row,[f.link.id]);assert.equal(db.prepare('SELECT payload FROM commerce_resources WHERE id=?').get(order.id).payload,'{"redacted":true}');assert.equal(db.prepare('SELECT released FROM commerce_privacy_holds').get().released,0);assert.equal(result.mode,'quarantine');});
  });
});

test('M18-G03-MERCHANT-REIMPORT-AND-HELD-ATOMICITY',async()=>{
  await usingJourneys(f=>{
    open(f);const op=f.replacement(),refs=operationReferences(f,op);attach(f,1,'exchange',refs);const originals=rows(f),transfer=merchant(f),t=target(f);forget(f,2);
    try{
      const first=imported(f,t,transfer);assert.equal(first.mode,'quarantine');assert.equal(first.live_activation_supported,false);for(const row of rows({...f,db:t.db}))assertRedacted(row,[f.link.id,...refs.map(r=>r.id)]);assert.throws(()=>t.kernel.authenticate(f.customerBearer));
      for(const original of originals)replaceJourneyRow(t.db,original);assert.deepEqual(imported(f,t,transfer),first);for(const row of rows({...f,db:t.db}))assertRedacted(row,[f.link.id,...refs.map(r=>r.id)]);
      const privacy=new PrivacyLifecycle(t.kernel);privacy.hold(t.scope,{customer_id:'C-1001',reason:'dispute',authority_ref:'destination_journey_hold',expires_at:f.now()+10000});for(const original of originals)replaceJourneyRow(t.db,original);
      const before=rows({...f,db:t.db}),state=t.db.prepare('SELECT * FROM commerce_recovery_state').all();assert.throws(()=>imported(f,t,transfer),/HELD/);assert.deepEqual(rows({...f,db:t.db}),before);assert.deepEqual(t.db.prepare('SELECT * FROM commerce_recovery_state').all(),state);
      privacy.releaseHold(t.scope,'C-1001','destination_journey_hold');imported(f,t,transfer);for(const row of rows({...f,db:t.db}))assertRedacted(row,[f.link.id,...refs.map(r=>r.id)]);assert.equal(t.db.prepare("SELECT count(*) n FROM commerce_support_documents WHERE kind='merchant_import'").get().n,1);
      assert.deepEqual(t.db.prepare('SELECT id FROM commerce_fulfillment_operations').all(),f.db.prepare('SELECT id FROM commerce_fulfillment_operations').all());assert.equal(f.fulfillmentSource.calls.replace,0);
    }finally{t.close();}
  },'fulfillment');
  await usingJourneys(f=>{
    open(f);attach(f,1,'tracking');const privacy=new PrivacyLifecycle(f.kernel);privacy.hold(f.owner.scope,{customer_id:'C-1001',reason:'retention_obligation',authority_ref:'source_journey_hold',expires_at:f.now()+10000});const transfer=merchant(f),t=target(f);
    try{
      assert.throws(()=>imported(f,t,transfer),/HELD/);assert.equal(count(t.db,'commerce_resources'),0);assert.equal(count(t.db,'commerce_support_documents'),0);assert.equal(count(t.db,'commerce_recovery_state'),0);
      privacy.releaseHold(f.owner.scope,'C-1001','source_journey_hold');f.advance(1);assert.equal(privacy.erase(f.owner.scope,'C-1001').status,'logically_erased');assert.equal(imported(f,t,transfer).mode,'quarantine');
      for(const row of rows({...f,db:t.db}))assertRedacted(row,[f.link.id]);assert.equal(t.db.prepare('SELECT released FROM commerce_privacy_holds').get().released,0);const before=rows({...f,db:t.db});imported(f,t,transfer);assert.deepEqual(rows({...f,db:t.db}),before);
    }finally{t.close();}
  });
});
