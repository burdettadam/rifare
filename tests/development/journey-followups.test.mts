import test from 'node:test';
import assert from 'node:assert/strict';
import {CommerceJourneys} from '../../packages/commerce/commerce-journeys.mts';
import {JourneyFollowups} from '../../packages/commerce/journey-followups.mts';
import {SupportDelivery} from '../../packages/commerce/support-delivery.mts';
import {SupportRules} from '../../packages/commerce/support-rules.mts';
import {SupportService} from '../../packages/commerce/support-service.mts';
import {PrivacyLifecycle} from '../../packages/commerce/privacy-lifecycle.mts';
import {ExecutionStops} from '../../packages/commerce/execution-stops.mts';
import {ROLE_ACTIONS} from '../../packages/commerce/authorization.mts';
import {canonical,contentDigest} from '../../packages/commerce/configuration-values.mts';
import {restoreRecoverySnapshot} from '../../packages/commerce/safe-recovery.mts';
import {secondSubject,secondStore} from './shopper-memory-helpers.mts';
import {attachSupport} from './journey-readiness-helpers.mts';
import {
  usingFollowups,common,order,count,event,publish,ready,schedule,inspection,inspect,queue,job,immutableJob,guards,journeys,guard,assertProjection,assertSuppressed,assertRedacted,replaceGuard,effects,withdraw,forgetJourney,rebind,
  reference,operationReferences,verifiedCustomer,updateResource,memoryInput,snapshot,restoreInput,restored,noRestoreResidue,merchant,target,imported,changedMerchant,changedRecovery,CURRENT_FIELDS,PRIVATE_FIELDS,
} from './journey-followups-helpers.mts';
import type {Value} from './journey-followups-helpers.mts';

// Independent ADR-0056 specifications: nineteen native cases, no subtest expansion.
const customerId=(f:any)=>order(f).customer_id;
// Native permission overrides are bounded; retain the complete action set these fixtures use.
const FOLLOWUP_OPERATOR_ACTIONS:readonly string[]=[
  'support.read','support.reply','support.link','support.ingest','support.takeover','support.send','support.note','support.analytics',
  'resource.read','attachment.read','knowledge.read','skill.read','profile.read','task.read','model.run','capability.read','policy.read','case.read','case.create','return.read',
  'action.propose','action.execute','operation.read','operation.dispatch','operation.reconcile','work.claim','work.manage','audit.read','return.request','return.evidence',
];
const deny=(f:any,action:string,actor='operator',role='operator')=>{
  const baseline=role==='operator'?FOLLOWUP_OPERATOR_ACTIONS:ROLE_ACTIONS[role as keyof typeof ROLE_ACTIONS],caller=role==='operator'?f.a.scope:f.reviewer.scope,resource=order(f).id;
  assert.ok(baseline.includes(action),'the fixture deliberately removes a currently allowed action');
  for(const allowed of baseline)assert.equal(f.permissions.preview(caller,allowed,resource).allowed,true,'initial permission '+allowed);
  const changed=f.permissions.change(f.owner.scope,{actor_id:actor,role,expected_revision:0,actions:baseline.filter(a=>a!==action),resource_ids:null});
  for(const allowed of baseline)assert.equal(f.permissions.preview(caller,allowed,resource).allowed,allowed!==action,'current permission '+allowed);
  return changed;
};
const personal=(f:any)=>[f.link.id,f.customerBearer,'shopper-apparel@example.invalid'];
const due=(f:any,id:string)=>{const at=job(f,id).due_at;if(at>f.now())f.advance(at-f.now());};
const newJourney=(f:any,extra:Value={})=>f.journeys.context(f.a.scope,f.customer,common(f,extra));

test('CASE-M18-G04-01',()=>usingFollowups(f=>{
  const ref=reference(f,'cart',f.cart_id),p=ready(f,{kind:'shopping',references:[ref]}),scheduled=schedule(f,p.input);assertProjection(scheduled);assert.equal(scheduled.state,'waiting');assert.equal(scheduled.operation_id,null);assert.equal(scheduled.manual_action_required,false);
  const original=job(f,scheduled.job_id),operations=count(f.db,'commerce_operations'),cart=f.carts.readCart(f.customer,f.cart_id);assert.equal(cart.state,'committed');assert.equal(cart.status,'active');
  f.cartSource.fixturePurchase(f.cart_id,'followup_purchase_before_due');assert.equal(f.carts.readCart(f.customer,f.cart_id).status,'purchased');due(f,scheduled.job_id);
  assert.equal(f.rules.execute(f.a.scope,scheduled.job_id).state,'cancelled');const suppressed=assertSuppressed(f,scheduled.job_id,'cart_purchased');assert.equal(suppressed.operation_id,null);
  assert.equal(count(f.db,'commerce_operations'),operations);assert.equal(count(f.db,'commerce_support_deliveries'),0);assert.equal(f.messageSource.calls,0);assert.equal(count(f.cartDb,'growth_source_cart_effects'),1);
  assert.deepEqual(immutableJob(job(f,scheduled.job_id)),immutableJob(original));assert.equal(f.rules.execute(f.a.scope,scheduled.job_id).state,'cancelled');assert.deepEqual(schedule(f,p.input),suppressed);
  for(const row of guards(f))assertRedacted(row,personal(f));
},'cart'));

test('CASE-M18-G04-02',()=>usingFollowups(async f=>{
  const p=ready(f),first=schedule(f,p.input),before=effects(f);assert.deepEqual(schedule(f,structuredClone(p.input)),first);assert.deepEqual(effects(f),before);
  const original=job(f,first.job_id),changed=structuredClone(p.input);changed.event.id='later_event';assert.throws(()=>schedule(f,changed),/JOURNEY_FOLLOWUP_CONFLICT/);
  const op=queue(f,first.job_id);assert.equal((await f.delivery.dispatch(f.a.scope,op)).state,'accepted');const accepted=inspect(f,first.job_id);assert.equal(accepted.state,'accepted');assert.equal(accepted.customer_delivered,false);assert.equal(accepted.manual_action_required,false);
  assert.deepEqual(schedule(f,p.input),accepted);assert.equal(f.rules.execute(f.a.scope,first.job_id).result.operation_id,op);await f.delivery.dispatch(f.a.scope,op);
  f.advance(1);const late=structuredClone(p.input);late.event={...late.event,id:'late_after_acceptance',at:late.event.at-1};assert.throws(()=>schedule(f,late),/JOURNEY_FOLLOWUP_CONFLICT/);
  const changedRule=publish(f,{expected_version:1});assert.throws(()=>schedule(f,{...p.input,rule:changedRule}),/JOURNEY_FOLLOWUP_CONFLICT/);
  assert.equal(count(f.db,'commerce_support_rule_jobs'),1);assert.equal(count(f.db,'commerce_support_deliveries'),1);assert.equal(count(f.db,'commerce_operations'),1);assert.equal(f.messageSource.calls,1);assert.equal(count(f.messageDb,'support_source_effects'),1);
  assert.deepEqual(immutableJob(job(f,first.job_id)),immutableJob(original));assert.equal(f.db.prepare("SELECT count(*) n FROM commerce_support_events WHERE code='delivery_queued'").get().n,1);
}));

test('CASE-M18-G04-03',async()=>{
  await usingFollowups(async f=>{
    const ref=reference(f,'cart',f.cart_id),p=ready(f,{kind:'shopping',references:[ref]}),scheduled=schedule(f,p.input),op=queue(f,scheduled.job_id);
    const retained=journeys(f),memory=f.db.prepare("SELECT * FROM commerce_support_documents WHERE kind='shopper_memory'").all(),tracking=f.tracking.read(f.a.scope,f.caseId),operations=count(f.db,'commerce_operations'),payload=JSON.parse(f.db.prepare('SELECT body FROM commerce_support_deliveries WHERE operation_id=?').get(op).body);
    assert.equal(payload.template_id,'tracking_status_v1');assert.equal(payload.purpose,'transactional');assert.equal(Object.hasOwn(payload,'campaign_id'),false);assert.equal(f.delivery.campaigns,null);
    await assert.rejects(()=>f.delivery.dispatch(f.a.scope,op,{beforeFinal:async()=>{f.cartSource.fixturePurchase(f.cart_id,'followup_purchase_at_final');}}),/JOURNEY_FOLLOWUP_SUPPRESSED/);
    assert.equal(f.carts.readCart(f.customer,f.cart_id).status,'purchased');assert.equal(f.delivery.inspect(f.a.scope,op).state,'suppressed');assertSuppressed(f,scheduled.job_id,'cart_purchased');assert.equal(f.messageSource.calls,0);assert.equal(count(f.messageDb,'support_source_effects'),0);assert.equal(count(f.db,'commerce_operations'),operations);assert.equal(count(f.cartDb,'growth_source_cart_effects'),1);
    assert.deepEqual(journeys(f),retained);assert.deepEqual(f.db.prepare("SELECT * FROM commerce_support_documents WHERE kind='shopper_memory'").all(),memory);assert.equal(f.tracking.read(f.a.scope,f.caseId).source_digest,tracking.source_digest);
  },'cart');
  for(const change of ['consent','takeover','sender','permission'])await usingFollowups(async f=>{
    const p=ready(f),scheduled=schedule(f,p.input),op=queue(f,scheduled.job_id),operations=count(f.db,'commerce_operations');
    await assert.rejects(()=>f.delivery.dispatch(f.a.scope,op,{beforeFinal:async()=>{
      if(change==='consent')withdraw(f);else if(change==='takeover')f.ownership.takeover(f.owner.scope,{case_id:f.caseId,expected_generation:1,reason:'operator_requested'});
      else if(change==='sender')f.db.prepare("UPDATE commerce_support_documents SET state='revoked' WHERE kind='sender' AND id='sender_one'").run();else deny(f,'support.send');
    }}),change==='consent'?/DELIVERY_SUPPRESSED|JOURNEY_FOLLOWUP_SUPPRESSED/:change==='takeover'?/OWNERSHIP|TAKEN_OVER/:change==='sender'?/CONFIGURATION|SENDER|SUPPRESSED/:/ACCESS_DENIED/);
    assert.equal(f.messageSource.calls,0);assert.equal(count(f.db,'commerce_operations'),operations);assert.equal(f.delivery.inspect(f.a.scope,op).state,'suppressed');
    const view=change==='takeover'?inspect(f,scheduled.job_id,{expected_generation:2},f.owner.scope):inspect(f,scheduled.job_id);assert.equal(view.state,'suppressed');assert.equal(view.manual_action_required,true);assert.equal(view.customer_delivered,false);
  });
});

test('M18-G04-STRICT-INPUT-OWNERS-AND-BOUNDS',()=>usingFollowups(async f=>{
  const p=ready(f),before=effects(f);let getters=0;const poisoned={...p.input};Object.defineProperty(poisoned,'event',{get(){getters++;throw Error('GETTER_EXECUTED');}});
  assert.throws(()=>schedule(f,poisoned));assert.equal(getters,0);
  for(const input of [{...p.input,text:'x'.repeat(32769)},{...p.input,template_id:'marketing_test_v1'},{...p.input,step:'another_step'},{...p.input,expected_generation:0},{...p.input,expires_at:f.now()},{...p.input,expires_at:f.now()+7*86400000+1},{...p.input,expires_at:f.now()+1000},{...p.input,expires_at:f.now()+600001}])assert.throws(()=>schedule(f,input));
  const bad=structuredClone(p.input);bad.event.id='invalid.event';assert.throws(()=>schedule(f,bad));assert.throws(()=>schedule(f,{...p.input,journey:{...p.input.journey,extra:'authority'}}));
  assert.throws(()=>new JourneyFollowups(f.kernel,{k:f.kernel,owners:{delivery:f.delivery}} as any));assert.throws(()=>new JourneyFollowups(f.kernel,new CommerceJourneys(f.kernel,f.reads)));
  const ownerGetter={};Object.defineProperty(ownerGetter,'cart',{enumerable:true,get(){getters++;throw Error('OWNER_GETTER_EXECUTED');}});assert.throws(()=>new SupportDelivery(f.kernel,f.tracking,[f.messageSource],null,null,ownerGetter));assert.equal(getters,0);
  assert.throws(()=>new SupportDelivery(f.kernel,f.tracking,[f.messageSource],null,null,{cart:{kernel:f.kernel,readCart:()=>({status:'active'})}} as any));assert.throws(()=>new SupportDelivery(f.kernel,f.tracking,[f.messageSource],null,null,{unknown_owner:f.delivery} as any));
  await usingFollowups(g=>{assert.throws(()=>new JourneyFollowups(f.kernel,g.journeys));assert.throws(()=>new SupportDelivery(f.kernel,f.tracking,[f.messageSource],null,null,{cart:g.carts}));},'cart');
  assert.deepEqual(effects(f),before);assert.equal(f.messageSource.calls,0);
}));

test('M18-G04-EXACT-SCOPE-PROOF-LINK-AND-SOURCE',async()=>{
  await usingFollowups(f=>{
    const p=ready(f),other=verifiedCustomer(f,f.a,'ORD-1002'),before=effects(f);
    for(const scope of [f.b.scope,f.c.scope,f.customer])assert.throws(()=>schedule(f,p.input,scope));assert.throws(()=>schedule(f,p.input,f.a.scope,other.scope));assert.throws(()=>schedule(f,p.input,f.a.scope,f.a.scope));
    for(const extra of [{case_id:'foreign_case'},{link_id:'foreign_link'},{sender_id:'foreign_sender'},{channel:'webchat'}])assert.throws(()=>schedule(f,{...p.input,event:{...p.input.event,...extra}}));assert.throws(()=>schedule(f,{...p.input,expected_generation:2}));assert.deepEqual(effects(f),before);
    const scheduled=schedule(f,p.input);assert.throws(()=>inspect(f,scheduled.job_id,{},f.b.scope));assert.throws(()=>inspect(f,scheduled.job_id,{link_id:'foreign_link'}));
    const source=f.kernel.lookup(f.a.scope,'customer','synthetic',customerId(f));updateResource(f,source,{...source.payload,email:'followup-current@example.invalid'});assert.throws(()=>inspect(f,scheduled.job_id));
    const fresh=verifiedCustomer(f);f.consent.verifyContact(f.a.scope,fresh.scope,{link_id:f.link.id,address:'followup-current@example.invalid'});f.customer=fresh.scope;
    assertSuppressed(f,scheduled.job_id,'source_changed');assert.equal(count(f.db,'commerce_operations'),0);assert.equal(f.messageSource.calls,0);
  });
  for(const action of ['support.reply','operation.read','support.send'])await usingFollowups(f=>{const p=ready(f);deny(f,action);const before=effects(f);assert.throws(()=>schedule(f,p.input),/ACCESS_DENIED/);assert.deepEqual(effects(f),before);assert.equal(f.messageSource.calls,0);});
  await usingFollowups(f=>{const p=ready(f),scheduled=schedule(f,p.input);f.kernel.revoke(f.customer);assert.throws(()=>inspect(f,scheduled.job_id));assert.throws(()=>schedule(f,p.input));const fresh=verifiedCustomer(f);assert.equal(inspect(f,scheduled.job_id,{},f.a.scope,fresh.scope).job_id,scheduled.job_id);assert.equal(count(f.db,'commerce_operations'),0);});
});

test('M18-G04-NATIVE-GUARD-CANNOT-BE-BYPASSED',async()=>{
  await usingFollowups(async f=>{
    const p=ready(f),scheduled=schedule(f,p.input),message=f.message({event_id:scheduled.job_id}),initial=effects(f);assert.match(scheduled.job_id,/^sjf_[a-f0-9]{40}$/);
    assert.throws(()=>f.delivery.queue(f.a.scope,message));assert.deepEqual(effects(f),initial);assert.throws(()=>f.rules.schedule(f.a.scope,p.input.event));
    const counterpart=scheduled.job_id.replace(/^sjf_/,'sj_');assert.throws(()=>f.delivery.queue(f.a.scope,{...message,event_id:counterpart}));
    const helpdesk=f.conversations.link(f.a.scope,f.customer,{case_id:f.caseId,channel:'helpdesk',account_id:f.messageSource.account,external_id:'guarded_helpdesk',history:'partial',source_revision:1});
    assert.throws(()=>f.delivery.queueHelpdesk(f.a.scope,{case_id:f.caseId,link_id:helpdesk.id,sender_id:'sender_one',kind:'note',event_id:scheduled.job_id,expected_generation:1,assignee_id:null}),/JOURNEY_FOLLOWUP/);assert.equal(count(f.db,'commerce_operations'),0);
    due(f,scheduled.job_id);const direct=f.delivery.queue(f.a.scope,message),before=effects(f);await assert.rejects(()=>f.delivery.dispatch(f.a.scope,direct.operation_id));assert.deepEqual(effects(f),before);assert.equal(f.messageSource.calls,0);
    const op=queue(f,scheduled.job_id);assert.equal(op,direct.operation_id);assert.equal((await f.delivery.dispatch(f.a.scope,op)).state,'accepted');assert.equal(f.messageSource.calls,1);assert.equal(count(f.db,'commerce_operations'),1);
  });
  await usingFollowups(async f=>{
    const p=ready(f,{kind:'shopping',references:[reference(f,'cart',f.cart_id)]}),scheduled=schedule(f,p.input);due(f,scheduled.job_id);
    const direct=f.delivery.queue(f.a.scope,f.message({event_id:scheduled.job_id})),op=direct.operation_id,original=f.db.prepare('SELECT * FROM commerce_operations WHERE id=?').get(op),payload=f.db.prepare('SELECT * FROM commerce_support_deliveries WHERE operation_id=?').get(op),target=f.db.prepare('SELECT * FROM commerce_operation_targets WHERE operation_id=?').get(op),pin=job(f,scheduled.job_id).result;
    const work=()=>f.db.prepare('SELECT * FROM commerce_operation_work WHERE operation_id=?').get(op),receiptCodes=()=>f.db.prepare('SELECT body FROM commerce_operation_receipts WHERE operation_id=? ORDER BY seq').all(op).map((r:Value)=>JSON.parse(r.body).code);
    assert.equal(job(f,scheduled.job_id).state,'waiting');assert.equal(original.state,'queued');assert.equal(original.provider_ref,null);assert.equal(payload.observation,null);assert.equal(work().state,'pending');assert.equal(work().attempts,0);for(const key of ['lease_token','lease_until','owner'])assert.equal(work()[key],null);assert.deepEqual(receiptCodes(),['queued']);
    f.cartSource.fixturePurchase(f.cart_id,'purchase_before_pending_retirement');const suppressed=assertSuppressed(f,scheduled.job_id,'cart_purchased');assert.equal(suppressed.operation_id,op);assert.equal(job(f,scheduled.job_id).state,'cancelled');
    const retired=f.db.prepare('SELECT * FROM commerce_operations WHERE id=?').get(op);assert.equal(retired.state,'failed');assert.equal(retired.provider_ref,null);for(const key of ['id','resource_id','source_kind','source_id','command','payload_hash','created_at'])assert.equal(retired[key],original[key]);
    assert.equal(work().state,'dead');assert.equal(work().last_code,'FINAL_AUTHORIZATION_DENIED');assert.equal(work().attempts,0);for(const key of ['lease_token','lease_until','owner'])assert.equal(work()[key],null);assert.deepEqual(receiptCodes(),['queued','provider_rejected']);
    assert.deepEqual(f.db.prepare('SELECT * FROM commerce_support_deliveries WHERE operation_id=?').get(op),payload);assert.deepEqual(f.db.prepare('SELECT * FROM commerce_operation_targets WHERE operation_id=?').get(op),target);assert.equal(job(f,scheduled.job_id).result,pin);assert.equal(f.delivery.inspect(f.a.scope,op).state,'suppressed');assert.equal(f.messageSource.calls,0);assert.equal(count(f.messageDb,'support_source_effects'),0);
    const before=effects(f);assert.deepEqual(inspect(f,scheduled.job_id),suppressed);assert.deepEqual(schedule(f,p.input),suppressed);assert.equal(f.rules.execute(f.a.scope,scheduled.job_id).state,'cancelled');
    await f.delivery.dispatch(f.a.scope,op).then((view:Value)=>assert.equal(view.state,'suppressed'),(error:unknown)=>assert.match(String(error),/JOURNEY_FOLLOWUP_SUPPRESSED/));assert.deepEqual(effects(f),before);assert.equal(f.messageSource.calls,0);
    const next=f.delivery.queue(f.a.scope,f.message({event_id:'ordinary_after_guard_retirement'}));assert.notEqual(next.operation_id,op);assert.equal((await f.delivery.dispatch(f.a.scope,next.operation_id)).state,'accepted');assert.equal(f.messageSource.calls,1);assert.equal(count(f.messageDb,'support_source_effects'),1);assert.equal(f.messageDb.prepare('SELECT operation_id FROM support_source_effects').get().operation_id,next.operation_id);assert.equal(f.db.prepare('SELECT state FROM commerce_operations WHERE id=?').get(op).state,'failed');
  },'cart');
  await usingFollowups(f=>{
    const p=ready(f),legacy=f.rules.schedule(f.a.scope,p.input.event).jobs[0],before=effects(f);assert.match(legacy.id,/^sj_/);assert.throws(()=>schedule(f,p.input));assert.deepEqual(effects(f),before);assert.equal(count(f.db,'commerce_support_rule_jobs'),1);
  });
  for(const lost of ['result','job'])await usingFollowups(f=>{
    const p=ready(f),scheduled=schedule(f,p.input);due(f,scheduled.job_id);if(lost==='job')f.db.prepare('DELETE FROM commerce_support_rule_jobs WHERE id=?').run(scheduled.job_id);else f.db.prepare('UPDATE commerce_support_rule_jobs SET result=NULL WHERE id=?').run(scheduled.job_id);
    const before=effects(f);assert.throws(()=>f.delivery.queue(f.a.scope,f.message({event_id:scheduled.job_id})),/JOURNEY_FOLLOWUP_INTEGRITY/);assert.throws(()=>f.rules.schedule(f.a.scope,p.input.event));assert.deepEqual(effects(f),before);assert.equal(f.messageSource.calls,0);
  });
  await usingFollowups(f=>{
    const p=ready(f),scheduled=schedule(f,p.input),op=queue(f,scheduled.job_id),row=f.db.prepare('SELECT * FROM commerce_support_deliveries WHERE operation_id=?').get(op),payload=JSON.parse(row.body);delete payload.journey_followup;
    f.db.prepare('UPDATE commerce_support_deliveries SET body=?,digest=? WHERE operation_id=?').run(canonical(payload),contentDigest(payload),op);const before=effects(f);assert.throws(()=>f.delivery.queue(f.a.scope,f.message({event_id:scheduled.job_id})),/JOURNEY_FOLLOWUP_INTEGRITY/);assert.deepEqual(effects(f),before);assert.equal(f.messageSource.calls,0);
  });
});

test('M18-G04-CURRENT-MEMORY-VERSION-AND-FORGET',async()=>{
  for(const change of ['new','corrected','forgotten','expired','original_link'])await usingFollowups(f=>{
    let memoryLink=f.link;
    if(change==='original_link')memoryLink=f.conversations.link(f.a.scope,f.customer,{case_id:f.caseId,channel:'webchat',account_id:'widget',external_id:'memory_original_link',history:'partial',source_revision:1});
    if(change!=='new')f.memory.record(f.customer,memoryInput(f,{link_id:memoryLink.id,...(change==='expired'?{expires_at:f.now()+1500}:{})}));
    const p=ready(f),scheduled=schedule(f,p.input),original=JSON.parse(guard(f,scheduled.job_id).body);assert.deepEqual(Object.keys(original.memory).sort(),['id','version']);assert.equal(original.memory.version,change==='new'?0:1);
    assert.equal(guard(f,scheduled.job_id).body.includes('fit_preference'),false);assert.equal(guard(f,scheduled.job_id).body.includes('regular'),false);
    if(change==='new'||change==='corrected')f.memory.record(f.customer,memoryInput(f,{expected_version:change==='new'?0:1,request_id:'fit_change',preferences:{fit_preference:'relaxed'}}));
    else if(change==='forgotten')f.memory.forget(f.customer,{...common(f),purpose:'support_journey',expected_version:1,request_id:'forget_fit'});
    else if(change==='expired')f.advance(1501);
    else f.conversations.link(f.a.scope,f.customer,{case_id:f.caseId,channel:'webchat',account_id:'widget',external_id:'memory_original_link',history:'unavailable',source_revision:2});
    assertSuppressed(f,scheduled.job_id,'memory_changed');assert.equal(f.rules.execute(f.a.scope,scheduled.job_id).state,'cancelled');assert.equal(count(f.db,'commerce_operations'),0);assert.equal(f.messageSource.calls,0);
    for(const row of guards(f))assertRedacted(row,[memoryLink.id]);
  });
  await usingFollowups(async f=>{
    f.memory.record(f.customer,memoryInput(f));const p=ready(f),scheduled=schedule(f,p.input),op=queue(f,scheduled.job_id);
    await assert.rejects(()=>f.delivery.dispatch(f.a.scope,op,{beforeFinal:async()=>{f.memory.record(f.customer,memoryInput(f,{expected_version:1,request_id:'fit_change_at_final',preferences:{fit_preference:'relaxed'}}));}}),/JOURNEY_FOLLOWUP_SUPPRESSED/);
    assertSuppressed(f,scheduled.job_id,'memory_changed');assert.equal(f.messageSource.calls,0);assert.equal(count(f.db,'commerce_operations'),1);
  });
});

test('M18-G04-NATIVE-CART-STAGE-DISTINCTIONS',async()=>{
  await usingFollowups(async f=>{
    const cart=f.cart(),ref=reference(f,'cart',cart.cart_id),p=ready(f,{kind:'shopping',references:[ref]}),scheduled=schedule(f,p.input);assert.equal(cart.state,'proposed');
    for(let n=0;n<3;n++)assert.equal(inspect(f,scheduled.job_id).state,'waiting');assert.equal(f.carts.currentPreview(f.customer,cart.cart_id).state,'proposed');assert.equal(count(f.cartDb,'growth_source_cart_effects'),0);
    f.cartSource.fault='after';const unknown=await f.carts.confirm(f.customer,{cart_id:cart.cart_id,preview_digest:cart.preview_digest});assert.equal(unknown.state,'unknown');assert.equal(count(f.cartDb,'growth_source_cart_effects'),1);
    assertSuppressed(f,scheduled.job_id,'native_unknown');assert.equal(f.rules.execute(f.a.scope,scheduled.job_id).state,'cancelled');assert.equal(f.messageSource.calls,0);assert.equal(count(f.db,'commerce_operations'),0);
  },'edit');
  await usingFollowups(f=>{
    const p=ready(f,{kind:'shopping',references:[reference(f,'cart',f.cart_id)]}),scheduled=schedule(f,p.input);assert.equal(f.carts.readCart(f.customer,f.cart_id).status,'active');assert.equal(inspect(f,scheduled.job_id).state,'waiting');
    const unavailable=new SupportDelivery(f.kernel,f.tracking,[f.messageSource]),withoutOwner=new JourneyFollowups(f.kernel,new CommerceJourneys(f.kernel,f.reads,{delivery:unavailable}));
    const result=withoutOwner.inspect(f.a.scope,f.customer,inspection(f,scheduled.job_id));assert.equal(result.state,'suppressed');assert.equal(result.reason,'native_owner_unavailable');assert.equal(result.manual_action_required,true);assert.equal(count(f.cartDb,'growth_source_cart_effects'),1);assert.equal(f.messageSource.calls,0);
  },'cart');
  await usingFollowups(f=>{f.cartSource.fixturePurchase(f.cart_id,'already_purchased');const p=ready(f,{kind:'shopping',references:[reference(f,'cart',f.cart_id)]}),before=effects(f);assert.throws(()=>schedule(f,p.input),/JOURNEY_FOLLOWUP_INELIGIBLE/);assert.deepEqual(effects(f),before);assert.equal(guards(f).length,0);},'cart');
});

test('M18-G04-NATIVE-RETURN-AND-RESOLUTION-STAGES',async()=>{
  await usingFollowups(async f=>{
    const allocation=f.plan.allocations.find((x:Value)=>x.outcome==='refund'),op=f.authorize(f.quote(allocation)),accepted=await f.executor.dispatch(f.a.scope,op.id);assert.equal(accepted.state,'accepted');assert.equal(accepted.cash_settled,false);
    const p=ready(f,{kind:'return',references:operationReferences(f,op,'resolution')}),scheduled=schedule(f,p.input);assert.equal(inspect(f,scheduled.job_id).state,'waiting');
    f.source.settle(op.id);const settled=await f.executor.reconcile(f.a.scope,op.id);assert.equal(settled.id,op.id);assert.equal(settled.cash_settled,true);assert.equal(settled.state,'settled');due(f,scheduled.job_id);
    assert.equal(f.rules.execute(f.a.scope,scheduled.job_id).state,'cancelled');assertSuppressed(f,scheduled.job_id,'refund_settled');assert.equal(count(f.sourceDb,'fixture_resolution_effects'),1);assert.equal(f.messageSource.calls,0);assert.equal(count(f.db,'commerce_support_deliveries'),0);
  },'fulfillment');
  await usingFollowups(async f=>{
    const allocation=f.plan.allocations.find((x:Value)=>x.outcome==='store_credit'),op=f.authorize(f.credit.quote(f.a.scope,allocation.id)),p=ready(f,{kind:'return',references:operationReferences(f,op,'resolution')}),scheduled=schedule(f,p.input);
    assert.equal(f.executor.read(f.a.scope,op.id).credit_issued,false);const issued=await f.executor.dispatch(f.a.scope,op.id);assert.equal(issued.state,'issued');assert.equal(issued.credit_issued,true);
    due(f,scheduled.job_id);assert.equal(f.rules.execute(f.a.scope,scheduled.job_id).state,'cancelled');assertSuppressed(f,scheduled.job_id,'credit_issued');assert.equal(count(f.sourceDb,'fixture_resolution_effects'),1);assert.equal(f.messageSource.calls,0);
  },'fulfillment');
});

test('M18-G04-NATIVE-EDIT-AND-FULFILLMENT-STAGES',async()=>{
  for(const kind of ['item','cancel'])await usingFollowups(async f=>{
    const q=f.quote(kind==='cancel'?{kind:'cancel',line_id:null,variant_id:null,address:null}:{}),receipt=f.authorize(q),op={id:receipt.order_edit_id,preview:{id:receipt.preview_id},approval:{id:receipt.approval_id},receipt};
    assert.equal(f.edits.status(f.a.scope,op.id).completed,false);let native=await f.edits.dispatch(f.a.scope,op.id);
    if(kind==='cancel'){assert.equal(native.completed,false);assert.equal(native.source.finance.state,'accepted');f.native.settle(op.id);native=await f.edits.dispatch(f.a.scope,op.id);}
    assert.equal(native.state,'ready_for_release');assert.equal(native.completed,false);const p=ready(f,{kind:'edit',references:operationReferences(f,op,'edit')}),scheduled=schedule(f,p.input);assert.equal(inspect(f,scheduled.job_id).state,'waiting');
    const done=await f.edits.release(f.a.scope,op.id);assert.equal(done.state,kind==='cancel'?'cancelled':'released');assert.equal(done.completed,true);due(f,scheduled.job_id);
    assert.equal(f.rules.execute(f.a.scope,scheduled.job_id).state,'cancelled');assertSuppressed(f,scheduled.job_id,kind==='cancel'?'edit_cancelled':'edit_released');assert.equal(count(f.db,'commerce_order_edits'),1);assert.equal(f.messageSource.calls,0);
    assert.equal(f.sourceDb.prepare("SELECT count(*) n FROM edit_source_effects WHERE json_extract(result,'$.stage')='commit'").get().n,1);
  },'edit');
  await usingFollowups(async f=>{
    const op=f.replacement(),p=ready(f,{kind:'exchange',references:operationReferences(f,op)});assert.throws(()=>schedule(f,p.input));assert.equal(guards(f).length,0);
    const created=await f.execution.dispatch(f.a.scope,op.id);assert.equal(created.state,'created');assert.equal(created.replacement.fulfillment_state,'unfulfilled');const current=newJourney(f);
    assert.throws(()=>schedule(f,{...p.input,journey:{...p.input.journey,context_digest:current.context_digest}}));
    const label=await f.buy(),refs=operationReferences(f,label),next=f.journeys.attach(f.a.scope,f.customer,{...common(f),expected_version:2,request_id:'label_is_not_return_completion',intent_id:'exchange_one',kind:'exchange',references:refs});
    assert.equal(f.labels.inspect(f.a.scope,label.labelId).tracking_state,'label_created');assert.throws(()=>schedule(f,{...p.input,journey:{id:next.id,version:3,context_digest:next.context_digest,intent_id:'exchange_one',reference:refs[3]}}));
    const requestRef=reference(f,'return_request',f.request.id),last=f.journeys.attach(f.a.scope,f.customer,{...common(f),expected_version:3,request_id:'request_is_not_resolution',intent_id:'exchange_one',kind:'exchange',references:[requestRef]});
    assert.throws(()=>schedule(f,{...p.input,journey:{id:last.id,version:4,context_digest:last.context_digest,intent_id:'exchange_one',reference:requestRef}}));assert.equal(guards(f).length,0);assert.equal(count(f.db,'commerce_support_rule_jobs'),0);assert.equal(f.fulfillmentSource.calls.replace,1);assert.equal(f.fulfillmentSource.calls.buy,1);assert.equal(f.messageSource.calls,0);
  },'fulfillment');
});

test('M18-G04-DELIVERY-UNKNOWN-ACCEPTED-DELIVERED',()=>usingFollowups(async f=>{
  const p=ready(f),scheduled=schedule(f,p.input),op=queue(f,scheduled.job_id);f.messageSource.fault='after';assert.equal((await f.delivery.dispatch(f.a.scope,op)).state,'unknown');
  const unknown=inspect(f,scheduled.job_id);assert.equal(unknown.state,'unknown');assert.equal(unknown.operation_id,op);assert.equal(unknown.manual_action_required,true);assert.equal(unknown.customer_delivered,false);
  withdraw(f);forgetJourney(f);assert.equal(inspect(f,scheduled.job_id).state,'unknown');await f.delivery.dispatch(f.a.scope,op);assert.equal(f.messageSource.calls,1);
  const independentDelivery=new SupportDelivery(f.kernel,f.tracking,[f.messageSource]);assert.equal((await independentDelivery.reconcile(f.a.scope,op)).state,'accepted');const accepted=inspect(f,scheduled.job_id);assert.equal(accepted.state,'accepted');assert.equal(accepted.customer_delivered,false);assert.equal(accepted.manual_action_required,false);assert.equal(accepted.operation_id,op);
  f.advance(1);f.messageSource.observe(op,'delivered',2);assert.equal((await independentDelivery.reconcile(f.a.scope,op)).customer_delivered,true);const delivered=inspect(f,scheduled.job_id);assert.equal(delivered.state,'delivered');assert.equal(delivered.customer_delivered,true);assert.equal(delivered.operation_id,op);
  const before=effects(f);await independentDelivery.reconcile(f.a.scope,op);assert.deepEqual(effects(f),before);assert.deepEqual(schedule(f,p.input),delivered);assert.throws(()=>schedule(f,{...p.input,event:{...p.input.event,id:'late_after_delivery'}}),/JOURNEY_FOLLOWUP_CONFLICT/);
  assert.equal(count(f.db,'commerce_operations'),1);assert.equal(count(f.db,'commerce_support_rule_jobs'),1);assert.equal(count(f.messageDb,'support_source_effects'),1);assert.equal(f.messageSource.calls,1);
}));

test('M18-G04-STALE-VERSION-AND-IMMUTABLE-EVENT-PINS',async()=>{
  await usingFollowups(f=>{
    const p=ready(f),scheduled=schedule(f,p.input),row=guard(f,scheduled.job_id),body=JSON.parse(row.body),native=job(f,scheduled.job_id),pin=JSON.parse(native.result).journey_guard;
    assert.deepEqual(Object.keys(body).sort(),CURRENT_FIELDS);assert.equal(body.schema_version,1);assert.equal(body.status,'current');assert.equal(row.version,1);assert.equal(row.author,'journey_followup');assert.equal(row.reviewer,null);assert.equal(row.review_digest,null);
    assert.equal(body.logical_key,contentDigest(['rifare-journey-followup-v1',f.a.tenant,f.a.store,p.journey.id,'tracking_one','tracking_status_v1']));assert.equal(row.id,'jfg_'+body.logical_key.slice(0,40));assert.equal(body.request_hash,contentDigest(p.input));
    assert.equal(scheduled.job_id,'sjf_'+contentDigest([f.a.tenant,f.a.store,p.rule.id,p.input.event.id]).slice(0,40));assert.equal(body.job_digest,contentDigest(immutableJob(native)));assert.equal(native.event_body,canonical(p.input.event));assert.deepEqual(Object.keys(JSON.parse(native.result)),['journey_guard']);
    assert.deepEqual(pin,{guard_id:row.id,guard_version:1,guard_digest:row.digest});assert.equal(body.journey.digest,journeys(f).find(r=>r.version===2)!.digest);assert.notEqual(body.journey.digest,p.journey.context_digest);assert.deepEqual(body.journey.reference,null);assert.deepEqual(body.rule,p.rule);assert.equal(body.memory.version,0);
    assert.deepEqual(Object.keys(body.source).sort(),['customer_resource_id','customer_source_version','customer_source_digest','order_source_version','order_source_digest','observed_at'].sort());for(const value of personal(f))if(value!==f.link.id)assert.equal(row.body.includes(value),false);
    const publicJob=f.rules.job(f.a.scope,scheduled.job_id);assert.equal(JSON.stringify(publicJob).includes('journey_guard'),false);
    f.journeys.attach(f.a.scope,f.customer,{...common(f),expected_version:2,request_id:'new_journey_intent',intent_id:'handoff_one',kind:'handoff',references:[]});const suppressed=assertSuppressed(f,scheduled.job_id,'journey_changed');
    assert.deepEqual(guards(f).map(r=>r.version),[1,2]);for(const r of guards(f)){assertRedacted(r,personal(f));const b=JSON.parse(r.body);for(const key of ['case_id','resource_id','subject_ref','logical_key','request_hash','job_id'])assert.equal(b[key],body[key]);}
    assert.deepEqual(JSON.parse(job(f,scheduled.job_id).result).journey_guard,pin);assert.deepEqual(immutableJob(job(f,scheduled.job_id)),immutableJob(native));assert.deepEqual(schedule(f,p.input),suppressed);assert.equal(f.rules.execute(f.a.scope,scheduled.job_id).state,'cancelled');
    const current=newJourney(f);assert.throws(()=>schedule(f,{...p.input,journey:{...p.input.journey,version:current.version,context_digest:current.context_digest}}),/JOURNEY_FOLLOWUP_CONFLICT/);assert.equal(count(f.db,'commerce_operations'),0);
  });
  await usingFollowups(f=>{const p=ready(f);f.journeys.attach(f.a.scope,f.customer,{...common(f),expected_version:2,request_id:'stale_before_schedule',intent_id:'handoff_one',kind:'handoff',references:[]});const before=effects(f);assert.throws(()=>schedule(f,p.input));assert.deepEqual(effects(f),before);assert.equal(guards(f).length,0);});
});

test('M18-G04-MANUAL-SERVICE-AND-READ-ONLY-CONTEXT',()=>usingFollowups(async f=>{
  new ExecutionStops(f.kernel).set(f.owner.scope,{action:'model.run',stopped:true,expected_revision:0,reason:'maintenance'});
  const service=new SupportService(f.kernel,f.reads,{sources:[f.messageSource],journeys:{cart:f.carts}});assert.equal(service.runner,null);assert.equal(service.routing,null);assert.ok(service.followups instanceof JourneyFollowups);
  const p=ready(f,{kind:'shopping',references:[reference(f,'cart',f.cart_id)]}),scheduled:any=await service.post(f.a.scope,'journey-followup-schedule',{customer_token:f.customerBearer,input:p.input});assertProjection(scheduled);
  const before=effects(f);for(let n=0;n<3;n++)assert.deepEqual(await service.post(f.a.scope,'journey-followup-inspect',{customer_token:f.customerBearer,input:inspection(f,scheduled.job_id)}),scheduled);assert.deepEqual(effects(f),before);assert.equal(f.messageSource.calls,0);
  await assert.rejects(()=>service.post(f.a.scope,'journey-followup-schedule',{customer_token:f.customerBearer,input:p.input,override:true}));await assert.rejects(()=>service.post(f.a.scope,'rules-schedule',{...p.input.event,journey_guard:{}}));await assert.rejects(()=>service.post(f.a.scope,'queue',{...f.message(),journey_followup:{}}));
  const op=queue(f,scheduled.job_id),guardId=guard(f,scheduled.job_id).id;deny(f,'operation.read');let reads=0;const actual=f.carts.readCart.bind(f.carts);f.carts.readCart=(...args:any[])=>{reads++;return actual(...args);};
  for(const caller of [f.a.scope,f.customer]){
    const view:any=await service.post(caller,'journey-followup-inspect',{customer_token:f.customerBearer,input:inspection(f,scheduled.job_id)});assertProjection(view);assert.equal(view.state,'restricted');assert.equal(view.restricted,true);assert.equal(view.operation_id,null);assert.equal(view.manual_action_required,true);
    const native=[f.rules.job(caller,scheduled.job_id),f.delivery.inspect(caller,op),service.context(caller,f.caseId).deliveries];
    for(const result of [view,...native]){const text=JSON.stringify(result);for(const secret of [op,guardId,f.cart_id,f.messageSource.identity])assert.equal(text.includes(secret),false);assert.equal(text.includes('journey_guard'),false);assert.equal(text.includes('journey_followup'),false);}
  }
  assert.equal(reads,0);assert.equal(count(f.cartDb,'growth_source_cart_effects'),1);assert.equal(f.messageSource.calls,0);const restrictedBefore=effects(f);await assert.rejects(()=>service.post(f.a.scope,'journey-followup-schedule',{customer_token:f.customerBearer,input:p.input}),/ACCESS_DENIED/);assert.deepEqual(effects(f),restrictedBefore);
},'cart'));

test('M18-G04-CURRENT-RULE-AUTHORITY-AND-SCHEDULE',async()=>{
  await usingFollowups(f=>{
    const p=ready(f);publish(f,{id:'unselected_rule',priority:99});const scheduled=schedule(f,p.input);assert.equal(count(f.db,'commerce_support_rule_jobs'),1);assert.throws(()=>f.rules.execute(f.a.scope,scheduled.job_id),/NOT_DUE/);
    const newer=publish(f,{expected_version:1});assert.throws(()=>schedule(f,{...p.input,rule:newer}),/JOURNEY_FOLLOWUP_CONFLICT/);assert.equal(job(f,scheduled.job_id).version,1);assert.equal(queue(f,scheduled.job_id),inspect(f,scheduled.job_id).operation_id);assert.equal(f.messageSource.calls,0);
  });
  for(const change of ['revocation','reviewer','expiry'])await usingFollowups(f=>{
    const p=ready(f),scheduled=schedule(f,p.input);if(change==='revocation')f.rules.revoke(f.owner.scope,p.rule.id,p.rule.version);else if(change==='reviewer')deny(f,'policy.review','reviewer','reviewer');else f.advance(60001);
    due(f,scheduled.job_id);assert.equal(f.rules.execute(f.a.scope,scheduled.job_id).state,'cancelled');assertSuppressed(f,scheduled.job_id,change==='expiry'?'expired':'rule_changed');assert.equal(count(f.db,'commerce_operations'),0);assert.equal(f.messageSource.calls,0);
  });
  await usingFollowups(f=>{
    const p=ready(f),before=effects(f);for(const patch of [{trigger:'return_requested'},{visited:[p.rule.id]},{depth:4},{at:f.now()+1}])assert.throws(()=>schedule(f,{...p.input,event:{...p.input.event,...patch}}));assert.deepEqual(effects(f),before);
    const manual=publish(f,{id:'manual_rule',action:'handoff_request'});assert.throws(()=>schedule(f,{...p.input,rule:manual}));assert.equal(count(f.db,'commerce_support_rule_jobs'),0);
  });
});

test('M18-G04-HISTORY-INTEGRITY-AND-RESTORE-PREFLIGHT',()=>usingFollowups(f=>{
  const p=ready(f),scheduled=schedule(f,p.input),original=guard(f,scheduled.job_id),native=job(f,scheduled.job_id);
  for(const patch of [{digest:'0'.repeat(64)},{author:'untrusted_worker'},{reviewer:'unexpected_reviewer'}]){replaceGuard(f.db,{...original,...patch});assert.throws(()=>inspect(f,scheduled.job_id),/JOURNEY_FOLLOWUP_INTEGRITY/);replaceGuard(f.db,original);}
  const body=JSON.parse(original.body),foreign={...body,source:{...body.source,customer_resource_id:'wrong_source_customer'}};replaceGuard(f.db,{...original,body:canonical(foreign),digest:contentDigest(foreign)});assert.throws(()=>inspect(f,scheduled.job_id),/JOURNEY_FOLLOWUP_INTEGRITY/);replaceGuard(f.db,original);
  f.db.prepare('UPDATE commerce_support_rule_jobs SET event_body=? WHERE id=?').run(canonical({...p.input.event,channel:'webchat'}),scheduled.job_id);assert.throws(()=>inspect(f,scheduled.job_id),/JOURNEY_FOLLOWUP_INTEGRITY/);f.db.prepare('UPDATE commerce_support_rule_jobs SET event_body=? WHERE id=?').run(native.event_body,scheduled.job_id);
  const wrongPin=JSON.parse(native.result);wrongPin.journey_guard.guard_version=99;f.db.prepare('UPDATE commerce_support_rule_jobs SET result=? WHERE id=?').run(canonical(wrongPin),scheduled.job_id);assert.throws(()=>inspect(f,scheduled.job_id),/JOURNEY_FOLLOWUP_INTEGRITY/);f.db.prepare('UPDATE commerce_support_rule_jobs SET result=? WHERE id=?').run(native.result,scheduled.job_id);
  const malformed=(r:Value)=>{const b={...JSON.parse(r.body),unexpected_transcript:'historical body must be checked before suppression'};return {...r,body:canonical(b),digest:contentDigest(b)};};
  const transfer=changedMerchant(merchant(f),copy=>{copy.rows.commerce_support_documents=copy.rows.commerce_support_documents.map((r:Value)=>r.kind==='journey_followup'?malformed(r):r);}),backup=changedRecovery(snapshot(f,'malformed_followup_backup'),db=>replaceGuard(db,malformed(original)));
  forgetJourney(f);assertSuppressed(f,scheduled.job_id,'journey_changed');const retired=guards(f),first=retired[0],changed={...JSON.parse(first.body),request_hash:'f'.repeat(64)};
  replaceGuard(f.db,{...first,body:canonical(changed),digest:contentDigest(changed)});assert.throws(()=>inspect(f,scheduled.job_id),/JOURNEY_FOLLOWUP_INTEGRITY/);replaceGuard(f.db,first);
  f.db.prepare("UPDATE commerce_support_documents SET version=3 WHERE kind='journey_followup' AND id=? AND version=2").run(first.id);assert.throws(()=>inspect(f,scheduled.job_id),/JOURNEY_FOLLOWUP_INTEGRITY/);f.db.prepare("UPDATE commerce_support_documents SET version=2 WHERE kind='journey_followup' AND id=? AND version=3").run(first.id);
  new PrivacyLifecycle(f.kernel).erase(f.owner.scope,'C-1001');const input=restoreInput(f,backup,'bad_followup_restore');assert.throws(()=>restoreRecoverySnapshot(input,f.now),/JOURNEY_FOLLOWUP_INTEGRITY/);noRestoreResidue(f,input);
  const t=target(f);try{assert.throws(()=>imported(f,t,transfer),/JOURNEY_FOLLOWUP_INTEGRITY/);assert.equal(count(t.db,'commerce_resources'),0);assert.equal(count(t.db,'commerce_support_documents'),0);assert.equal(count(t.db,'commerce_recovery_state'),0);}finally{t.close();}
  assert.equal(f.messageSource.calls,0);
}));

test('M18-G04-SUBJECT-EXPORT-ERASURE-AND-REASSIGNMENT',()=>usingFollowups(async f=>{
  const p=ready(f),scheduled=schedule(f,p.input),op=queue(f,scheduled.job_id);await f.delivery.dispatch(f.a.scope,op);
  const other=secondSubject(f);f.consent.verifyContact(f.a.scope,other.scope,{link_id:other.link.id,address:other.source.payload.email});
  const g=rebind(f,{customer:other.scope,link:other.link,caseId:'case_other'}),otherInput=ready(g,{rule:p.rule,eventExtra:{id:'other_subject_event'}}),otherJob=schedule(g,otherInput.input),otherRows=guards(g),otherNative=job(g,otherJob.job_id);
  const merchantSubject=secondStore(f),support=attachSupport(f,{store:merchantSubject.store,caseId:'case_one',customer:merchantSubject.scope,owner:merchantSubject.owner});
  const storeReviewer=f.kernel.authenticate(f.kernel.issueSession(merchantSubject.store.tenant,merchantSubject.store.store,'memory_reviewer'));
  const second=rebind(f,{...support,a:merchantSubject.store,customer:merchantSubject.scope,owner:{scope:merchantSubject.owner},reviewer:{scope:storeReviewer},messageSource:support.supportSource,messageDb:support.supportDb});
  try{
    const storeInput=ready(second),storeJob=schedule(second,storeInput.input),storeRows=guards(second),storeNative=job(second,storeJob.job_id),privacy=new PrivacyLifecycle(f.kernel),exported:any=privacy.export(f.owner.scope,'C-1001');
    const records=exported.journey_followup_records;assert.equal(records.length,1);assert.deepEqual(Object.keys(records[0]).sort(),['id','case_id','resource_id','version','state','job_id','retained_under_hold','subject_projection'].sort());assert.equal(records[0].job_id,scheduled.job_id);assert.equal(records[0].subject_projection,true);assert.equal(records[0].retained_under_hold,false);assert.equal(records[0].state,'active');
    const text=JSON.stringify(records);for(const secret of [otherJob.job_id,storeJob.job_id,f.link.id,f.customerBearer,'shopper-apparel@example.invalid'])assert.equal(text.includes(secret),false);
    const originalOrder=order(f),operation=f.db.prepare('SELECT id,state FROM commerce_operations WHERE id=?').get(op);updateResource(f,originalOrder,originalOrder.payload,'C-1002');assert.throws(()=>inspect(f,scheduled.job_id));const reassigned=f.kernel.get(f.a.scope,originalOrder.id);
    f.db.prepare("DELETE FROM commerce_resources WHERE tenant_id=? AND store_id=? AND (customer_id='C-1001' OR (kind='customer' AND external_id='C-1001'))").run(f.a.tenant,f.a.store);
    const historical:any=privacy.export(f.owner.scope,'C-1001');assert.equal(historical.resources.length,0);assert.ok(historical.journey_followup_records.some((r:Value)=>r.job_id===scheduled.job_id));
    assert.equal(privacy.erase(f.owner.scope,'C-1001').status,'logically_erased');for(const row of guards(f))assertRedacted(row,[f.link.id]);
    const erasedDelivery=f.db.prepare('SELECT * FROM commerce_support_deliveries WHERE operation_id=?').get(op);assert.equal(erasedDelivery.erased,1);assert.equal(JSON.parse(erasedDelivery.body).redacted,true);assert.equal(erasedDelivery.body.includes('shopper-apparel@example.invalid'),false);assert.equal(job(f,scheduled.job_id).event_body,'{"redacted":true}');
    assert.deepEqual(f.db.prepare('SELECT id,state FROM commerce_operations WHERE id=?').get(op),operation);assert.deepEqual(f.kernel.get(f.a.scope,originalOrder.id),reassigned);assert.deepEqual(guards(g),otherRows);assert.deepEqual(job(g,otherJob.job_id),otherNative);assert.deepEqual(guards(second),storeRows);assert.deepEqual(job(second,storeJob.job_id),storeNative);assert.equal(f.messageSource.calls,1);
  }finally{support.closeSupport();}
}));

test('M18-G04-JOURNEY-FORGET-ALL-VERSIONS-AND-HOLDS',async()=>{
  for(const held of [false,true])await usingFollowups(f=>{
    const p=ready(f),scheduled=schedule(f,p.input),op=f.replacement(),native=f.db.prepare('SELECT * FROM commerce_fulfillment_operations').all(),receipts=f.db.prepare('SELECT * FROM commerce_action_receipts').all(),privacy=new PrivacyLifecycle(f.kernel);
    if(held)privacy.hold(f.owner.scope,{customer_id:'C-1001',reason:'retention_obligation',authority_ref:'followup_hold',expires_at:f.now()+10000});
    forgetJourney(f);const suppressed=assertSuppressed(f,scheduled.job_id,'journey_changed');assert.equal(suppressed.operation_id,null);assert.equal(f.rules.execute(f.a.scope,scheduled.job_id).state,'cancelled');assert.deepEqual(schedule(f,p.input),suppressed);assert.throws(()=>schedule(f,{...p.input,event:{...p.input.event,id:'reopen_forgotten_followup'}}),/JOURNEY_FOLLOWUP_CONFLICT/);
    const rows=guards(f);assert.deepEqual(rows.map(r=>r.version),[1,2]);assert.equal(rows.every(r=>r.state==='revoked'),true);assertRedacted(rows[1]);
    if(held){
      assert.equal(JSON.parse(rows[0].body).status,'current');const exported:any=privacy.export(f.owner.scope,'C-1001');assert.ok(exported.journey_followup_records.some((r:Value)=>r.version===1&&r.retained_under_hold));assert.equal(privacy.erase(f.owner.scope,'C-1001').status,'held');assert.deepEqual(guards(f),rows);
      privacy.releaseHold(f.owner.scope,'C-1001','followup_hold');assertSuppressed(f,scheduled.job_id,'journey_changed');
    }
    for(const row of guards(f))assertRedacted(row,personal(f));assert.deepEqual(f.db.prepare('SELECT * FROM commerce_fulfillment_operations').all(),native);assert.deepEqual(f.db.prepare('SELECT * FROM commerce_action_receipts').all(),receipts);assert.equal(f.execution.read(f.a.scope,op.id).state,'authorized');assert.equal(f.fulfillmentSource.calls.replace,0);assert.equal(f.messageSource.calls,0);assert.equal(count(f.db,'commerce_support_deliveries'),0);
  },'fulfillment');
});

test('M18-G04-UNINSTALL-NATIVE-RESTORE-AND-SUPPRESSION',async()=>{
  await usingFollowups(f=>{
    const p=ready(f),scheduled=schedule(f,p.input),op=queue(f,scheduled.job_id),backup=snapshot(f,'followup_native_backup'),ids=f.db.prepare('SELECT id FROM commerce_operations ORDER BY id').all();forgetJourney(f);assertSuppressed(f,scheduled.job_id,'journey_changed');
    restored(f,backup,({db,kernel,result})=>{for(const row of guards({...f,db}))assertRedacted(row,personal(f));assert.deepEqual(db.prepare('SELECT id FROM commerce_operations ORDER BY id').all(),ids);assert.ok(db.prepare('SELECT 1 FROM commerce_support_deliveries WHERE operation_id=?').get(op));assert.notEqual(db.prepare('SELECT state FROM commerce_support_rule_jobs WHERE id=?').get(scheduled.job_id).state,'waiting');assert.equal(result.mode,'quarantine');assert.equal(result.external_effects,false);assert.throws(()=>kernel.authenticate(f.customerBearer));},'followup_native_restored');
    assert.equal(f.messageSource.calls,0);
  });
  await usingFollowups(f=>{
    const p=ready(f),scheduled=schedule(f,p.input),other=secondSubject(f);f.consent.verifyContact(f.a.scope,other.scope,{link_id:other.link.id,address:other.source.payload.email});const g=rebind(f,{customer:other.scope,link:other.link,caseId:'case_other'}),otherInput=ready(g,{rule:p.rule,eventExtra:{id:'unheld_followup_event'}}),otherJob=schedule(g,otherInput.input);
    forgetJourney(f);assert.equal(JSON.parse(guard(f,scheduled.job_id).body).status,'current');const privacy=new PrivacyLifecycle(f.kernel);privacy.hold(f.owner.scope,{customer_id:'C-1001',reason:'dispute',authority_ref:'isolated_followup_hold',expires_at:f.now()+10000});const backup=snapshot(f,'held_followup_backup'),input=restoreInput(f,backup,'held_followup_restore'),before=guards(f);
    assert.throws(()=>restoreRecoverySnapshot(input,f.now),/JOURNEY_FOLLOWUP_RESTORE_HELD/);noRestoreResidue(f,input);assert.deepEqual(guards(f),before);
    assert.equal(privacy.uninstall(f.owner.scope).status,'disconnected');assert.ok(guards(f).every(r=>r.state==='revoked'));assert.ok(guards(f).some(r=>JSON.parse(r.body).status==='current'));for(const row of guards(g))assertRedacted(row,[g.link.id]);assert.equal(job(f,scheduled.job_id).state,'cancelled');assert.equal(job(g,otherJob.job_id).state,'cancelled');assert.throws(()=>f.kernel.require(f.customer));assert.equal(f.messageSource.calls,0);
  });
  await usingFollowups(f=>{
    const p=ready(f),scheduled=schedule(f,p.input),originalOrder=order(f);forgetJourney(f);const privacy=new PrivacyLifecycle(f.kernel);privacy.hold(f.owner.scope,{customer_id:'C-1001',reason:'dispute',authority_ref:'obsolete_followup_hold',expires_at:f.now()+10000});const backup=snapshot(f,'obsolete_followup_backup');
    privacy.releaseHold(f.owner.scope,'C-1001','obsolete_followup_hold');f.advance(1);assert.equal(privacy.erase(f.owner.scope,'C-1001').status,'logically_erased');
    restored(f,backup,({db,result})=>{for(const row of guards({...f,db}))assertRedacted(row,[f.link.id]);assert.equal(db.prepare('SELECT payload FROM commerce_resources WHERE id=?').get(originalOrder.id).payload,'{"redacted":true}');assert.equal(db.prepare('SELECT released FROM commerce_privacy_holds').get().released,0);assert.equal(db.prepare('SELECT state FROM commerce_support_rule_jobs WHERE id=?').get(scheduled.job_id).state,'cancelled');assert.equal(result.mode,'quarantine');},'obsolete_followup_restored');
  });
});

test('M18-G04-MERCHANT-REIMPORT-HELD-ATOMICITY',async()=>{
  await usingFollowups(f=>{
    const p=ready(f),scheduled=schedule(f,p.input),op=f.replacement(),originals=guards(f),transfer=merchant(f),t=target(f);forgetJourney(f);assertSuppressed(f,scheduled.job_id,'journey_changed');
    try{
      const first=imported(f,t,transfer);assert.equal(first.mode,'quarantine');assert.equal(first.live_activation_supported,false);for(const row of guards({...f,db:t.db}))assertRedacted(row,personal(f));assert.equal(t.db.prepare('SELECT state FROM commerce_support_rule_jobs WHERE id=?').get(scheduled.job_id).state,'cancelled');assert.throws(()=>t.kernel.authenticate(f.customerBearer));
      for(const original of originals)replaceGuard(t.db,original);assert.deepEqual(imported(f,t,transfer),first);for(const row of guards({...f,db:t.db}))assertRedacted(row,personal(f));
      const privacy=new PrivacyLifecycle(t.kernel);privacy.hold(t.scope,{customer_id:'C-1001',reason:'dispute',authority_ref:'destination_followup_hold',expires_at:f.now()+10000});for(const original of originals)replaceGuard(t.db,original);
      const before=guards({...f,db:t.db}),state=t.db.prepare('SELECT * FROM commerce_recovery_state').all();assert.throws(()=>imported(f,t,transfer),/JOURNEY_FOLLOWUP_RESTORE_HELD/);assert.deepEqual(guards({...f,db:t.db}),before);assert.deepEqual(t.db.prepare('SELECT * FROM commerce_recovery_state').all(),state);
      privacy.releaseHold(t.scope,'C-1001','destination_followup_hold');imported(f,t,transfer);for(const row of guards({...f,db:t.db}))assertRedacted(row,personal(f));assert.equal(t.db.prepare("SELECT count(*) n FROM commerce_support_documents WHERE kind='merchant_import'").get().n,1);assert.ok(t.db.prepare('SELECT 1 FROM commerce_fulfillment_operations WHERE id=?').get(op.id));assert.equal(f.fulfillmentSource.calls.replace,0);assert.equal(f.messageSource.calls,0);
    }finally{t.close();}
  },'fulfillment');
  await usingFollowups(f=>{
    const p=ready(f),scheduled=schedule(f,p.input);forgetJourney(f);const privacy=new PrivacyLifecycle(f.kernel);privacy.hold(f.owner.scope,{customer_id:'C-1001',reason:'retention_obligation',authority_ref:'source_followup_hold',expires_at:f.now()+10000});const transfer=merchant(f),t=target(f);
    try{
      assert.throws(()=>imported(f,t,transfer),/JOURNEY_FOLLOWUP_RESTORE_HELD/);assert.equal(count(t.db,'commerce_resources'),0);assert.equal(count(t.db,'commerce_support_documents'),0);assert.equal(count(t.db,'commerce_recovery_state'),0);
      privacy.releaseHold(f.owner.scope,'C-1001','source_followup_hold');f.advance(1);assert.equal(privacy.erase(f.owner.scope,'C-1001').status,'logically_erased');assert.equal(imported(f,t,transfer).mode,'quarantine');for(const row of guards({...f,db:t.db}))assertRedacted(row,[f.link.id]);assert.equal(t.db.prepare('SELECT released FROM commerce_privacy_holds').get().released,0);assert.equal(t.db.prepare('SELECT state FROM commerce_support_rule_jobs WHERE id=?').get(scheduled.job_id).state,'cancelled');
      const before=guards({...f,db:t.db});imported(f,t,transfer);assert.deepEqual(guards({...f,db:t.db}),before);
    }finally{t.close();}
  });
});
