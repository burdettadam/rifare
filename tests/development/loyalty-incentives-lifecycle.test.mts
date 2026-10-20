import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {CommerceKernel} from '../../packages/commerce/kernel.mts';
import {PrivacyLifecycle} from '../../packages/commerce/privacy-lifecycle.mts';
import {SupportService} from '../../packages/commerce/support-service.mts';
import {CartRecovery} from '../../packages/commerce/cart-recovery.mts';
import {LoyaltyIncentives} from '../../packages/commerce/loyalty-incentives.mts';
import {LoyaltyLifecycle} from '../../packages/commerce/loyalty-lifecycle.mts';
import {LoyaltyIncentiveFixtureSource} from '../../packages/adapters/loyalty-incentive-fixture-source.mts';
import {MarketingFixtureSource} from '../../packages/adapters/marketing-fixture-source.mts';
import {canonical,contentDigest} from '../../packages/commerce/configuration-values.mts';
import {withSourceMethod} from './loyalty-redemption-helpers.mts';
import {E,COMPARISON_FIELDS,TERMS_FIELDS,REFERENCE_FIELDS,SOURCE_FIELDS,RETAINED_FIELDS,usingFixture,quoteInput,quote,bind,reportInput,report,quoteRows,opRows,recoveryRow,providerJournal,providerState,effects,reserveReward,assertProviderDebit,assertRefund,assertMissing,assertEconomics,externalWorker,measuredEvents,backup,restoredFixture,count,pick} from './loyalty-incentives-lifecycle-helpers.mts';
import type {Value} from './loyalty-incentives-lifecycle-helpers.mts';

test('CASE-M19-G04-01',()=>usingFixture(async f=>{
  const before=effects(f),quoteCount=quoteRows(f).length,at=f.now(),view:any=await f.service.post(f.scope,'loyalty-incentive-quote',{customer_token:f.customerBearer,input:quoteInput(f)}),q=view.quote;
  assert.deepEqual(Object.keys(view).sort(),COMPARISON_FIELDS);assert.deepEqual(Object.keys(q).sort(),TERMS_FIELDS);assert.equal(view.digest,contentDigest(q));
  for(const flag of ['execution_authorized','enrollment_authorized','send_authorized','monetary_conversion_supported','production_qualified'])assert.equal(view[flag],false);
  assert.equal(q.schema_version,1);assert.equal(q.case_id,f.caseId);assert.equal(q.resource_id,f.order().id);assert.equal(q.cart_id,f.shop.cart_id);assert.equal(q.campaign_id,f.campaign.id);
  assert.deepEqual(q.points,{unit:'points',quantity:400});assert.deepEqual(q.benefit,E.benefits[0]);assert.deepEqual(q.discount,E.discount);assert.equal(q.cart_total_minor,'2000');assert.equal(q.cart_currency,'USD');assert.equal(q.prospective_earning_supported,false);assert.equal(q.qualification,'synthetic_only');
  const current=f.shop.carts.currentPreview(f.scope,f.shop.cart_id),nativeItem=current.items[0];assert.equal(current.items.length,1);assert.deepEqual(pick(nativeItem,Object.keys(E.cart)),E.cart);assert.deepEqual(q.eligible_items,current.items);assert.equal(q.cart_digest,current.preview_digest);
  const terms=JSON.parse(quoteRows(f).find((r:Value)=>r.id===q.loyalty_quote_id)!.body);assert.equal(terms.consumed_by,null);assert.equal(q.loyalty_quote_digest,terms.terms_digest);assert.equal(terms.terms.points,400);
  assert.equal(q.created_at,at);assert.equal(q.expires_at,at+E.quote_ttl_ms);assert.equal(q.expires_at,terms.terms.expires_at);
  const applicability=f.incentiveSource.observe(),{digest,...sourceBody}=applicability;assert.deepEqual(Object.keys(applicability).sort(),SOURCE_FIELDS);assert.equal(digest,contentDigest(sourceBody));assert.equal(Object.isFrozen(f.incentiveSource),true);
  assert.deepEqual(applicability.combinations,E.combinations);assert.equal(applicability.marketing_source_identity,f.marketingSource.identity);assert.equal(applicability.shopping_source_identity,f.shop.source.identity);assert.equal(applicability.redemption_source_identity,f.redemptionSource.identity);assert.equal(applicability.balance_source_identity,f.balanceSource.identity);assert.equal(applicability.loyalty_account_id,f.balanceSource.account);
  assert.deepEqual(Object.keys(q.source_references).sort(),REFERENCE_FIELDS);assert.deepEqual(q.source_references,{loyalty_source_identity:f.redemptionSource.identity,snapshot_digest:terms.terms.snapshot_digest,rules_digest:terms.terms.rules_digest,benefits_digest:f.benefits.digest,shopping_source_identity:f.shop.source.identity,marketing_source_identity:f.marketingSource.identity,marketing_facts_digest:f.marketingSource.facts().source_digest,applicability_source_identity:f.incentiveSource.identity});
  assert.equal(q.applicability_digest,applicability.digest);assert.equal(q.campaign_digest,f.campaign.digest);assert.equal(q.consent_stamp,f.consent.eligibility(f.scope,f.caseId,'sender_one','email','marketing').stamp);
  const publicText=JSON.stringify(view),proof=f.kernel.require(f.customer);for(const secret of [f.customerBearer,f.a.bearer,proof.token_hash,'shopper-apparel@example.invalid'])assert.equal(publicText.includes(secret),false);
  assert.equal(quoteRows(f).length,quoteCount+1);assert.deepEqual(effects(f),before);
  const lastSeen=f.db.prepare('SELECT last_seen FROM commerce_sessions WHERE token_hash=?').get(proof.token_hash).last_seen;f.advance(5);
  assert.deepEqual(await f.service.post(f.scope,'loyalty-incentive-validate',view),{valid:true,digest:view.digest,expires_at:q.expires_at,execution_authorized:false,send_authorized:false});
  assert.equal(f.db.prepare('SELECT last_seen FROM commerce_sessions WHERE token_hash=?').get(proof.token_hash).last_seen,lastSeen);assert.equal(JSON.parse(quoteRows(f)[0].body).terms.expires_at,q.expires_at);
}));

test('CASE-M19-G04-02',async()=>{
  await usingFixture(async f=>{
    const before=effects(f),q=quote(f),bound:any=await f.service.post(f.scope,'loyalty-incentive-bind',{recovery_id:f.recoveryId,quote:q});
    assert.deepEqual(bound,{recovery_id:f.recoveryId,quote_digest:q.digest,bound:true,execution_authorized:false,send_authorized:false});
    const recommendation=f.shop.carts.recommend(f.scope,{resource_id:f.order().id,suggestions:[{variant_id:'basic',unit_minor:'2000'}]});assert.equal(recommendation.cart_changed,false);assert.equal(recommendation.payment_authorized,false);
    const current=f.shop.carts.currentPreview(f.scope,f.shop.cart_id);assert.equal((await f.shop.carts.confirm(f.customer,{cart_id:f.shop.cart_id,preview_digest:current.preview_digest})).committed,true);
    assert.deepEqual(effects(f),before);assert.equal(opRows(f).length,0);assert.equal(providerJournal(f).length,0);assert.equal(f.source.calls,0);assert.equal(count(f.db,'commerce_checkout_assignments'),0);
    const n=quoteRows(f).length;assert.throws(()=>f.incentives.quote(f.scope,f.customer,{...quoteInput(f),points:1,discount_minor:'2000',text:'Guaranteed free purchase'}));assert.equal(quoteRows(f).length,n);assert.deepEqual(effects(f),before);
  });
  await usingFixture(async f=>{
    const before=effects(f);assert.throws(()=>quote(f));assert.equal(quoteRows(f).length,0);assert.deepEqual(effects(f),before);
    const queued=f.queue();await assert.rejects(()=>f.delivery.dispatch(f.scope,queued.operation_id),/DELIVERY_SUPPRESSED/);assert.equal(f.source.calls,0);assert.equal(providerJournal(f).length,0);assert.equal(opRows(f).length,0);
  },{consent:false});
});

test('CASE-M19-G04-03',async()=>{
  const changes:[string,(f:any)=>void,RegExp][]=[
    ['balance',f=>{const op=reserveReward(f);assert.equal(f.redemptions.dispatch(f.scope,op.id).state,'redeemed');assertProviderDebit(f,op.id);},/LOYALTY_SNAPSHOT_CHANGED|LOYALTY_INCENTIVE_CHANGED|LOYALTY_INSUFFICIENT_POINTS/],
    ['purchase',f=>{assert.equal(f.shop.purchase().status,'purchased');},/RECOVERY_PURCHASED|LOYALTY_INCENTIVE_CHANGED/],
    ['consent',f=>{f.grant(f.first,'withdrawn',2);},/DELIVERY_SUPPRESSED|LOYALTY_INCENTIVE_CHANGED/]
  ];
  for(const [label,change,error] of changes)await usingFixture(async f=>{
    const q=quote(f);bind(f,q);const queued=f.queue();assert.equal(f.source.calls,0);
    await assert.rejects(()=>f.delivery.dispatch(f.scope,queued.operation_id,{beforeFinal:async()=>{change(f);}}),error,label);
    assert.equal(f.source.calls,0,label);assert.equal(count(f.sourceDb,'support_source_effects'),0);assert.equal(f.delivery.inspect(f.scope,queued.operation_id).state,'suppressed');
    assert.equal(providerJournal(f).length,label==='balance'?1:0);assert.equal(f.campaigns.summary(f.scope,f.campaign.id).provider_accepted,0);
  });
});

test('CASE-M19-G04-04',async()=>{
  await usingFixture(f=>{
    const unchanged=f.incentiveSource.observe();for(const patch of [{revision:1},{expires_at:f.now()},{combinations:[E.combinations[0],E.combinations[0]]},{combinations:[{...E.combinations[0],eligible_variant_ids:['basic','basic']}]}])assert.throws(()=>f.incentiveSource.configure({revision:2,expires_at:f.now()+60000,combinations:E.combinations,...patch}));assert.deepEqual(f.incentiveSource.observe(),unchanged);
    f.incentiveSource.configure({revision:2,expires_at:f.now()+60000,combinations:[{benefit_id:'synthetic_reward_400',offer_id:'offer-ten',eligible_variant_ids:['basic']},{benefit_id:'synthetic_reward_200',offer_id:'offer-five',eligible_variant_ids:['basic']}]});
    const n=quoteRows(f).length;assert.throws(()=>quote(f),undefined,'two explicit pairs cannot authorize their cross-product');assert.equal(quoteRows(f).length,n);
    const lower=quote(f,{benefit_id:'synthetic_reward_200'});assert.equal(lower.quote.points.quantity,200);assert.equal(f.incentives.validate(f.scope,lower).valid,true);
    f.incentiveSource.configure({revision:3,expires_at:f.now()+60000,combinations:E.combinations});assert.throws(()=>f.incentives.validate(f.scope,lower));
    const q=quote(f),forged=structuredClone(q);forged.quote.discount.discount_minor='2000';forged.digest=contentDigest(forged.quote);assert.throws(()=>f.incentives.validate(f.scope,forged));assert.equal(providerJournal(f).length,0);
  },{extraOffer:true});
  await usingFixture(f=>{
    const q=quote(f),item=f.shop.source.item('basic');f.shop.source.fixtureListing({variant_id:'basic',expected_revision:item.listing_revision,title:item.title,description:item.description,approved_descriptions:item.approved_descriptions,terms:{id:'standard',revision:2,text:'Changed native item terms.'}});
    assert.throws(()=>f.incentives.validate(f.scope,q));assert.equal(providerJournal(f).length,0);assert.equal(f.source.calls,0);
  });
  await usingFixture(f=>{
    const q=quote(f),stored=JSON.parse(quoteRows(f)[0].body);assert.equal(q.quote.expires_at,q.quote.created_at+5000);assert.equal(stored.terms.expires_at,q.quote.created_at+10000);
    f.advance(5000);assert.throws(()=>f.incentives.validate(f.scope,q));assert.equal(JSON.parse(quoteRows(f)[0].body).terms.expires_at,stored.terms.expires_at);assert.equal(opRows(f).length,0);
  },{applicability_ttl_ms:5000});
});

test('CASE-M19-G04-05',async()=>{
  await usingFixture(f=>{
    const q=quote(f),first=bind(f,q),row=recoveryRow(f);assert.deepEqual(JSON.parse(row.body).loyalty_incentive,{quote:q.quote,digest:q.digest});assert.deepEqual(bind(f,q),first);assert.deepEqual(recoveryRow(f),row);
    const other=quote(f);assert.throws(()=>bind(f,other),/LOYALTY_INCENTIVE_BINDING_IMMUTABLE/);assert.deepEqual(recoveryRow(f),row);
    const cold=new CartRecovery(f.kernel,f.shop.carts,f.campaigns);assert.throws(()=>cold.final(f.scope,f.campaign.id,f.caseId),/LOYALTY_INCENTIVES_NOT_CONFIGURED/);
    const malformed={...JSON.parse(row.body),loyalty_incentive:null};f.db.prepare('UPDATE commerce_cart_recoveries SET body=?,digest=? WHERE id=?').run(canonical(malformed),contentDigest(malformed),row.id);
    try{assert.throws(()=>f.recovery.final(f.scope,f.campaign.id,f.caseId));assert.equal(f.source.calls,0);}finally{f.db.prepare('UPDATE commerce_cart_recoveries SET body=?,digest=? WHERE id=?').run(row.body,row.digest,row.id);}
    const op=reserveReward(f,q);assert.throws(()=>f.incentives.validate(f.scope,q));assert.equal(f.redemptions.dispatch(f.scope,op.id).state,'redeemed');assert.throws(()=>f.incentives.validate(f.scope,q));assertProviderDebit(f,op.id);
  });
  await usingFixture(f=>{
    const q=quote(f),queued=f.queue();assert.equal(queued.state,'queued');assert.throws(()=>bind(f,q));assert.equal(Object.hasOwn(JSON.parse(recoveryRow(f).body),'loyalty_incentive'),false);assert.equal(f.source.calls,0);assert.equal(opRows(f).length,0);
  });
});

test('CASE-M19-G04-06',async()=>{
  await usingFixture(async f=>{
    const q=quote(f),before=effects(f),worker=externalWorker(f);
    // This real grant omits support reads/send. Its denial proves the existing
    // grant boundary; it is not an otherwise-authorized worker-send experiment.
    for(const scope of [f.agent.scope,f.customer,worker.scope,f.b.scope]){
      assert.throws(()=>f.incentives.quote(scope,f.customer,quoteInput(f)));assert.throws(()=>f.incentives.validate(scope,q));assert.throws(()=>f.incentives.bind(scope,{recovery_id:f.recoveryId,quote:q}));
    }
    assert.equal(f.incentives.validate(f.scope,q).valid,true);assert.equal(JSON.parse(quoteRows(f)[0].body).consumed_by,null);assert.deepEqual(effects(f),before);
    bind(f,q);const queued=f.queue();await assert.rejects(()=>f.delivery.dispatch(worker.scope,queued.operation_id));assert.equal(f.source.calls,0);assert.equal(providerJournal(f).length,0);
  });
  for(const change of ['proof','generation'])await usingFixture(f=>{
    const q=quote(f),n=quoteRows(f).length;if(change==='proof')f.kernel.revoke(f.customer);else f.ownership.takeover(f.owner.scope,{case_id:f.caseId,expected_generation:1,reason:'operator_requested'});
    assert.throws(()=>f.incentives.validate(f.scope,q));assert.throws(()=>bind(f,q));assert.equal(quoteRows(f).length,n);assert.equal(providerJournal(f).length,0);assert.equal(f.source.calls,0);
  });
});

test('CASE-M19-G05-01',()=>usingFixture(async f=>{
  const q=quote(f);bind(f,q);const queued=f.queue(),sent=await f.delivery.dispatch(f.scope,queued.operation_id);assert.equal(sent.source_stage,'accepted');assert.equal(sent.customer_delivered,false);
  const redeemed=reserveReward(f,q);assert.equal(f.redemptions.dispatch(f.scope,redeemed.id).state,'redeemed');const source=assertProviderDebit(f,redeemed.id);f.shop.purchase();
  const refund=await f.refundAlpha(true),financial=assertRefund(f,refund.id);assert.equal(f.financeOwner.read(f.scope,refund.id).cash_settled,true);assert.equal(f.facts.original_paid_minor,E.original_paid_minor);
  const view:any=await f.service.post(f.scope,'loyalty-lifecycle-report',{customer_token:f.customerBearer,input:reportInput(f,{campaign_id:f.campaign.id})});assertMissing(view);
  assert.equal(view.case_id,f.caseId);assert.equal(view.resource_id,f.order().id);assert.equal(view.account.scope,'provider_account');assert.deepEqual(view.account.balances,E.after_redemption);assert.deepEqual(pick(view.account,Object.keys(E.capacity.redeemed)),E.capacity.redeemed);
  assert.equal(view.projection.status,'ready');assert.deepEqual(view.projection.totals,E.settled_targets);assert.deepEqual(view.projection.units,E.settled_units);assert.deepEqual(view.projection.events.map((e:Value)=>e.operation_id),[refund.id]);assert.equal(view.projection.events[0].amount_minor,'1000');
  const reversal=view.projection.proposals.find((p:Value)=>p.original_line_id==='alpha'&&p.unit_index===1&&p.kind==='reversal');assert.equal(reversal.points,100);assert.deepEqual(reversal.operation_ids,[refund.id]);assert.equal(reversal.eligible,true);
  assert.equal(view.redemptions.scope,'resource_operations');assert.equal(view.redemptions.operations.length,1);assert.deepEqual(view.redemptions.operations[0],{...f.redemptions.read(f.scope,redeemed.id),source_observation:source});assert.equal(view.redemptions.observed_redeemed_points,400);assertEconomics(view,E.settled_targets,400);
  assert.deepEqual(view.recovery.campaign,f.campaigns.summary(f.scope,f.campaign.id));assert.equal(view.recovery.measurement,null);assert.equal(view.recovery.campaign.provider_accepted,1);assert.equal(financial.operation_id,refund.id);assert.equal(providerJournal(f).length,1);
},{lifecycle:true}));

test('CASE-M19-G05-02',()=>usingFixture(async f=>{
  const uncertain=reserveReward(f);f.redemptionSource.setMode('timeout_before_effect');assert.equal(f.redemptions.dispatch(f.scope,uncertain.id).state,'unknown');
  const refund=await f.refundAlpha(true);assertRefund(f,refund.id);assert.equal(f.financeOwner.read(f.scope,refund.id).cash_settled,true);
  const view=report(f);assertMissing(view);assert.deepEqual(view.projection.totals,E.settled_targets);assertEconomics(view,E.settled_targets,0);assert.deepEqual(view.account.balances,E.account);assert.deepEqual(pick(view.account,Object.keys(E.capacity.reserved)),E.capacity.reserved);
  assert.ok(view.exceptions.some((e:Value)=>e.operation_id===uncertain.id&&e.code==='LOYALTY_OUTCOME_UNKNOWN'));assert.equal(view.redemptions.operations[0].state,'unknown');assert.equal(view.redemptions.operations[0].source_observation,null);assert.equal(providerJournal(f).length,0);assert.equal(opRows(f).length,1);
  assert.equal(view.exception_queue.items.find((i:Value)=>i.operation_id===uncertain.id).automatic_retry,false);assert.equal(f.source.calls,0);
},{lifecycle:true}));

test('CASE-M19-G05-03',()=>usingFixture(async f=>{
  const q=quote(f);bind(f,q);const queued=f.queue();await f.delivery.dispatch(f.scope,queued.operation_id);const redemption=reserveReward(f,q);f.redemptions.dispatch(f.scope,redemption.id);const refund=await f.refundAlpha(true);assertRefund(f,refund.id);
  const measured=measuredEvents(f),view=report(f,{campaign_id:f.campaign.id,experiment_id:E.measurement.experiment_id});assertMissing(view);assertEconomics(view,E.settled_targets,400);
  assert.deepEqual(view.recovery.measurement,measured);assert.deepEqual(view.recovery.campaign,f.campaigns.summary(f.scope,f.campaign.id));assert.deepEqual(pick(view.recovery.campaign,Object.keys(E.campaign)),E.campaign);
  for(const key of ['denominators','purchases','attributed_revenue_minor','holdout_estimated_incremental_revenue_minor','gross_revenue_minor','refunds_minor','costs_minor','net_margin_minor','incremental_margin_minor'])assert.deepEqual(measured[key],E.measurement[key],key);
  assert.equal(measured.metrics_complete,true);assert.equal(measured.clean_causal_lift,false);assert.equal(measured.qualification,'synthetic_only');assert.equal(measured.connected_qualified,false);assert.equal(measured.automatic_promotion,false);
  f.source.observe(queued.operation_id,'delivered',2);await f.delivery.reconcile(f.scope,queued.operation_id);const delivered=report(f,{campaign_id:f.campaign.id,experiment_id:E.measurement.experiment_id});assert.equal(delivered.recovery.campaign.delivered,1);assert.equal(delivered.recovery.campaign.actual_provider_cost_minor,null);assertEconomics(delivered,E.settled_targets,400);assertMissing(delivered);
  const noMeasurement=new LoyaltyLifecycle(f.kernel,{accrual:f.projectionOwner,redemptions:f.redemptions,incentives:f.incentives,campaigns:f.campaigns});assert.throws(()=>noMeasurement.report(f.scope,f.customer,reportInput(f,{campaign_id:f.campaign.id,experiment_id:E.measurement.experiment_id})),/LOYALTY_MEASUREMENT_NOT_CONFIGURED/);
  assert.throws(()=>report(f,{campaign_id:null,experiment_id:E.measurement.experiment_id}),/LOYALTY_LIFECYCLE_SCOPE_MISMATCH/);assert.throws(()=>report(f,{campaign_id:f.campaign.id,experiment_id:'another-experiment'}),/LOYALTY_LIFECYCLE_SCOPE_MISMATCH/);
},{lifecycle:true,experiment:true}));

test('CASE-M19-G05-04',()=>usingFixture(async f=>{
  const q=quote(f);bind(f,q);const op=reserveReward(f,q),privacy=new PrivacyLifecycle(f.kernel),proof=f.kernel.require(f.customer);
  privacy.hold(f.owner.scope,{customer_id:E.customer_id,reason:'retention_obligation',authority_ref:'incentive-retention',expires_at:f.now()+600000});
  const saved=backup(f);f.redemptionSource.setMode('timeout_after_effect');assert.equal(f.redemptions.dispatch(f.scope,op.id).state,'unknown');assertProviderDebit(f,op.id);
  const exported:any=privacy.export(f.owner.scope,E.customer_id),recovery=exported.growth_records.commerce_cart_recoveries.find((r:Value)=>r.id===f.recoveryId);assert.equal(JSON.parse(recovery.body).loyalty_incentive.digest,q.digest);assert.equal(exported.loyalty_redemption_records.length,2);assert.equal(JSON.stringify(exported).includes(f.customerBearer),false);
  const held=recoveryRow(f),sourceBefore=providerState(f);assert.equal(privacy.erase(f.owner.scope,E.customer_id).status,'held');assert.deepEqual(recoveryRow(f),held);
  privacy.releaseHold(f.owner.scope,E.customer_id,'incentive-retention');f.advance(1);assert.equal(privacy.erase(f.owner.scope,E.customer_id).status,'logically_erased');
  const minimized=JSON.parse(recoveryRow(f).body);assert.equal(Object.hasOwn(minimized,'loyalty_incentive'),false);assert.equal(minimized.redacted,true);assert.deepEqual(providerState(f),sourceBefore,'local erasure does not claim deletion of the separate provider journal');
  const retained:any=await f.service.post(f.owner.scope,'loyalty-lifecycle-retained',{operation_ids:[op.id]});assert.deepEqual(Object.keys(retained).sort(),RETAINED_FIELDS);assert.equal(retained.operations[0].minimized,true);assert.equal(retained.operations[0].state,'unknown');assert.equal(retained.account,null);assert.equal(retained.projection,null);assert.equal(retained.recovery,null);assert.equal(retained.reconciled,false);
  const restored=restoredFixture(f,saved);
  try{
    assert.equal(restored.result.mode,'quarantine');assert.equal(restored.result.external_effects,false);assert.throws(()=>restored.kernel.authenticate(f.customerBearer));assert.throws(()=>restored.kernel.authenticate(f.a.bearer));
    const row=restored.db.prepare('SELECT * FROM commerce_cart_recoveries WHERE id=?').get(f.recoveryId) as Value,body=JSON.parse(row.body);assert.equal(Object.hasOwn(body,'loyalty_incentive'),false);assert.equal(body.redacted,true);
    assert.throws(()=>restored.lifecycle.retained(restored.scope,{operation_ids:[op.id]}),'support.analytics does not acquire a quarantine exception');
    const old=restored.redemptions.read(restored.scope,op.id);assert.equal(old.state,'unknown');assert.equal(old.restored,true);assert.equal(old.minimized,true);assert.equal(old.held_points,400);assert.equal(restored.db.prepare('SELECT attempts FROM commerce_operation_work WHERE operation_id=?').get(op.id).attempts,0);
    const answer=restored.redemptions.reconcile(restored.scope,op.id);assert.equal(answer.disposition,'reconciled');assert.equal(answer.command_repeated,false);assert.equal(answer.operation.state,'redeemed');assert.equal(answer.operation.minimized,true);assert.equal(answer.operation.authority_revoked,true);
    const stored=JSON.stringify(restored.db.prepare("SELECT body FROM commerce_support_documents WHERE kind IN ('loyalty_redemption_quote','loyalty_redemption_operation')").all());for(const text of [f.customerBearer,proof.token_hash,E.customer_id,'shopper-apparel@example.invalid'])assert.equal(stored.includes(text),false);assert.deepEqual(providerState(f),sourceBefore);
    assert.throws(()=>restored.incentives.validate(restored.scope,q));assert.throws(()=>restored.redemptions.dispatch(restored.scope,op.id));
  }finally{restored.close();}
},{lifecycle:true}));

test('CASE-M19-G05-05',()=>usingFixture(async f=>{
  const op=await f.refundAlpha(false);assertRefund(f,op.id,'accepted');const before=report(f);assertMissing(before);assert.equal(before.projection.status,'pending');assert.equal(before.projection.totals.reversal_points,0);assertEconomics(before,E.initial_targets,0);
  f.financeSource.settle(op.id);assertRefund(f,op.id);const sourceOnly=report(f);assertMissing(sourceOnly);assert.equal(sourceOnly.projection.status,'pending');assert.equal(sourceOnly.projection.totals.reversal_points,0);assert.equal(f.financeOwner.read(f.scope,op.id).cash_settled,false);
  await f.financeOwner.reconcile(f.scope,op.id);const after=report(f);assert.deepEqual(after.projection.totals,E.settled_targets);assert.equal(after.projection.status,'ready');assert.deepEqual(after.projection.events.map((e:Value)=>e.operation_id),[op.id]);assertMissing(after);assertEconomics(after,E.settled_targets,0);
  assert.equal(providerJournal(f).length,0);assert.deepEqual(after.account.balances,E.account);assert.equal(count(f.financeDb,'fixture_resolution_effects'),1);
},{lifecycle:true}));

test('CASE-M19-G05-06',()=>usingFixture(async f=>{
  const op=reserveReward(f);f.redemptionSource.setMode('timeout_after_effect');assert.equal(f.redemptions.dispatch(f.scope,op.id).state,'unknown');const source=assertProviderDebit(f,op.id),before=effects(f),view=report(f);assertMissing(view);
  assert.deepEqual(pick(view.account,Object.keys(E.capacity.unknown_after_effect)),E.capacity.unknown_after_effect);assert.equal(view.redemptions.operations[0].state,'unknown');assert.deepEqual(view.redemptions.operations[0].source_observation,source);assert.equal(view.redemptions.observed_redeemed_points,400);assertEconomics(view,E.initial_targets,400);
  assert.deepEqual(report(f),view);assert.deepEqual(effects(f),before);assert.equal(f.redemptions.read(f.scope,op.id).state,'unknown');assert.ok(view.exception_queue.items.some((i:Value)=>i.operation_id===op.id&&i.actions.some((a:Value)=>a.name==='reconcile'&&a.enabled)));
  const reconciled=await f.queueOwner.reconcile(f.scope,op.id);assert.equal(reconciled.disposition,'reconciled');assert.equal(reconciled.command_repeated,false);assert.equal(reconciled.operation.operation_id,op.id);
  const after=report(f);assertMissing(after);assert.deepEqual(pick(after.account,Object.keys(E.capacity.redeemed)),E.capacity.redeemed);assert.equal(after.redemptions.observed_redeemed_points,400);assert.equal(after.redemptions.operations[0].state,'redeemed');assert.equal(after.exception_queue.items.some((i:Value)=>i.operation_id===op.id),false);
  assert.equal((await f.queueOwner.reconcile(f.scope,op.id)).disposition,'unchanged');assertProviderDebit(f,op.id);assert.equal(opRows(f).length,1);
},{lifecycle:true}));

test('CASE-M19-G05-07',()=>usingFixture(async f=>{
  const op=reserveReward(f);f.redemptionSource.setMode('timeout_before_effect');f.redemptions.dispatch(f.scope,op.id);const refund=await f.refundAlpha(true);assertRefund(f,refund.id);
  const before=effects(f),queue=f.queueOwner.list(f.scope),view=report(f),expected={...queue,items:queue.items.filter((i:Value)=>i.operation_id===op.id)};assertMissing(view);assert.deepEqual(view.exception_queue,expected);assert.equal(view.exception_queue.scan_limit,500);assert.equal(view.exception_queue.truncated,false);assert.deepEqual(effects(f),before);
  assert.deepEqual(report(f),view);assert.equal(f.redemptions.read(f.scope,op.id).state,'unknown');assert.equal(providerJournal(f).length,0);assert.equal(f.financeOwner.read(f.scope,refund.id).cash_settled,true);
  // A late provider booking occurs during the read. A coherent report must
  // reject, not combine the old account snapshot with the new source history.
  const command=JSON.parse(f.db.prepare('SELECT command FROM commerce_operations WHERE id=?').get(op.id).command);let changed=false;f.redemptionSource.setMode('redeem');
  withSourceMethod(f.redemptionSource,'observeAccount',(original:any,...args:any[])=>{const snapshot=original(...args);if(!changed){changed=true;f.redemptionSource.redeem(command);}return snapshot;},()=>assert.throws(()=>report(f)));
  assert.equal(changed,true);assertProviderDebit(f,op.id);assert.equal(f.redemptions.read(f.scope,op.id).state,'unknown');const current=report(f);assertMissing(current);assert.deepEqual(pick(current.account,Object.keys(E.capacity.unknown_after_effect)),E.capacity.unknown_after_effect);
},{lifecycle:true}));

test('CASE-M19-G05-08',()=>usingFixture(async f=>{
  const options={accrual:f.projectionOwner,redemptions:f.redemptions,incentives:f.incentives,campaigns:f.campaigns,measurement:f.measurement};
  assert.throws(()=>new LoyaltyLifecycle(f.kernel,{...options,accrual:{...f.projectionOwner} as any}));assert.throws(()=>new LoyaltyIncentives(f.kernel,{redemptions:f.redemptions,carts:f.shop.carts,campaigns:f.campaigns,recovery:f.recovery,source:f.incentiveSource}),'a second owner cannot replace the recovery validator');
  assert.throws(()=>new LoyaltyIncentiveFixtureSource({marketing:{...f.marketingSource} as any,shopping:f.shop.source,redemption:f.redemptionSource}));
  const otherDb=new DatabaseSync(':memory:');try{const otherKernel=new CommerceKernel(otherDb,f.now);assert.throws(()=>new LoyaltyLifecycle(otherKernel,options));}finally{otherDb.close();}
  const cohabiting=new MarketingFixtureSource(f.loyaltyDb,{tenant:f.a.tenant,store:f.a.store,account:'merchant_mail'},f.now);assert.throws(()=>new LoyaltyIncentiveFixtureSource({marketing:cohabiting,shopping:f.shop.source,redemption:f.redemptionSource}),'sources cannot share the same database');
  const identity=f.marketingDb.prepare('SELECT * FROM marketing_source_identity WHERE id=1').get() as Value,changed={...JSON.parse(identity.body),account:'another_account'};f.marketingDb.prepare('UPDATE marketing_source_identity SET body=?,digest=? WHERE id=1').run(canonical(changed),contentDigest(changed));
  try{assert.throws(()=>f.incentiveSource.observe());assert.throws(()=>f.incentiveSource.configure({revision:2,expires_at:f.now()+60000,combinations:E.combinations}));}finally{f.marketingDb.prepare('UPDATE marketing_source_identity SET body=?,digest=? WHERE id=1').run(identity.body,identity.digest);}
  const op=reserveReward(f);f.redemptionSource.setMode('timeout_before_effect');f.redemptions.dispatch(f.scope,op.id);
  assert.throws(()=>f.lifecycle.retained(f.owner.scope,{operation_ids:[op.id]}),/LOYALTY_RETAINED_EVIDENCE_REQUIRED/);assert.throws(()=>report(f,{},f.b.scope));
  const unconfigured=new SupportService(f.kernel,f.reads);await assert.rejects(()=>unconfigured.post(f.scope,'loyalty-lifecycle-report',{customer_token:f.customerBearer,input:reportInput(f)}));await assert.rejects(()=>unconfigured.post(f.scope,'loyalty-incentive-quote',{customer_token:f.customerBearer,input:quoteInput(f)}));
  const privacy=new PrivacyLifecycle(f.kernel);assert.equal(privacy.erase(f.owner.scope,E.customer_id).status,'logically_erased');const before=providerState(f),expected=f.redemptions.read(f.owner.scope,op.id);
  const guarded=[{value:f.balanceSource,method:'observe'},{value:f.redemptionSource,method:'observeAccount'},{value:f.redemptionSource,method:'lookup'},{value:f.projectionOwner,method:'project'},{value:f.incentiveSource,method:'observe'}];
  const check=(index:number):any=>index===guarded.length?f.lifecycle.retained(f.owner.scope,{operation_ids:[op.id]}):withSourceMethod(guarded[index].value,guarded[index].method,()=>{throw new Error('RETAINED_CURRENT_LOOKUP_FORBIDDEN');},()=>check(index+1));
  const retained=check(0);assert.deepEqual(Object.keys(retained).sort(),RETAINED_FIELDS);assert.deepEqual(retained,{schema_version:1,mode:'retained_operations',operations:[expected],status:'limited_retained_evidence',reconciled:false,account:null,projection:null,recovery:null,source_effects_dispatched:0,execution_authorized:false,production_qualified:false});
  assert.throws(()=>f.lifecycle.retained(f.scope,{operation_ids:[op.id]}));assert.throws(()=>f.lifecycle.retained(f.b.scope,{operation_ids:[op.id]}));assert.throws(()=>f.lifecycle.retained(f.owner.scope,{operation_ids:[op.id,op.id]}));assert.throws(()=>f.lifecycle.retained(f.owner.scope,{operation_ids:[]}));assert.deepEqual(providerState(f),before);
},{lifecycle:true}));
