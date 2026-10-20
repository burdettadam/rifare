import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {marketingFixture} from './growth-marketing-helpers.mts';
import {installShoppingCart} from './growth-shopping-helpers.mts';
import {accrualFixture} from './loyalty-accrual-helpers.mts';
import {CommerceKernel} from '../../packages/commerce/kernel.mts';
import {CustomerAccess} from '../../packages/commerce/customer-access.mts';
import {SupportConversations} from '../../packages/commerce/support-conversations.mts';
import {SupportConsent} from '../../packages/commerce/support-consent.mts';
import {SupportTracking} from '../../packages/commerce/support-tracking.mts';
import {SupportDelivery} from '../../packages/commerce/support-delivery.mts';
import {SupportService} from '../../packages/commerce/support-service.mts';
import {SupportFixtureSource} from '../../packages/adapters/support-fixture-source.mts';
import {MarketingFixtureSource} from '../../packages/adapters/marketing-fixture-source.mts';
import {MarketingSegments} from '../../packages/commerce/marketing-segments.mts';
import {CheckoutExperiments} from '../../packages/commerce/checkout-experiments.mts';
import {GrowthMeasurement} from '../../packages/commerce/growth-measurement.mts';
import {GrowthCampaigns} from '../../packages/commerce/growth-campaigns.mts';
import {ShoppingCart} from '../../packages/commerce/shopping-cart.mts';
import {CartRecovery} from '../../packages/commerce/cart-recovery.mts';
import {LoyaltyFixtureSource} from '../../packages/adapters/loyalty-fixture-source.mts';
import {LoyaltyBalances} from '../../packages/commerce/loyalty-balances.mts';
import {LoyaltyRedemptionFixtureSource} from '../../packages/adapters/loyalty-redemption-fixture-source.mts';
import {LoyaltyRedemptions} from '../../packages/commerce/loyalty-redemptions.mts';
import {LoyaltyIncentiveFixtureSource} from '../../packages/adapters/loyalty-incentive-fixture-source.mts';
import {LoyaltyIncentives} from '../../packages/commerce/loyalty-incentives.mts';
import {LoyaltyLifecycle} from '../../packages/commerce/loyalty-lifecycle.mts';
import {LoyaltyAccrual} from '../../packages/commerce/loyalty-accrual.mts';
import {ResolutionExecution} from '../../packages/commerce/resolution-execution.mts';
import {ExchangeLineage} from '../../packages/commerce/exchange-lineage.mts';
import {ActionGateway} from '../../packages/commerce/action-gateway.mts';
import {ExceptionQueue} from '../../packages/commerce/exception-queue.mts';
import {WorkerApi} from '../../packages/commerce/worker-api.mts';
import {canonical,contentDigest} from '../../packages/commerce/configuration-values.mts';
import {createRecoverySnapshot,restoreRecoverySnapshot,suppressionCheckpoint} from '../../packages/commerce/safe-recovery.mts';

export type Value=Record<string,any>;
export const E=JSON.parse(readFileSync(new URL('../fixtures/loyalty-incentives-lifecycle/independent-values.json',import.meta.url),'utf8'));
export const QUOTE_KIND='loyalty_redemption_quote',OP_KIND='loyalty_redemption_operation';
export const COMPARISON_FIELDS=['quote','digest','execution_authorized','enrollment_authorized','send_authorized','monetary_conversion_supported','production_qualified'].sort();
export const TERMS_FIELDS=['schema_version','case_id','resource_id','cart_id','campaign_id','loyalty_quote_id','loyalty_quote_digest','points','benefit','discount','eligible_items','cart_total_minor','cart_currency','cart_digest','campaign_digest','consent_stamp','applicability_digest','source_references','created_at','expires_at','prospective_earning_supported','qualification'].sort();
export const REFERENCE_FIELDS=['loyalty_source_identity','snapshot_digest','rules_digest','benefits_digest','shopping_source_identity','marketing_source_identity','marketing_facts_digest','applicability_source_identity'].sort();
export const SOURCE_FIELDS=['schema_version','tenant_id','store_id','account_id','source_identity','marketing_source_identity','shopping_source_identity','redemption_source_identity','loyalty_account_id','balance_source_identity','revision','expires_at','combinations','digest'].sort();
export const RETAINED_FIELDS=['schema_version','mode','operations','status','reconciled','account','projection','recovery','source_effects_dispatched','execution_authorized','production_qualified'].sort();
export const count=(db:DatabaseSync,table:string)=>Number((db.prepare('SELECT count(*) n FROM '+table).get() as Value).n);
export const rows=(db:DatabaseSync,table:string)=>db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all() as Value[];
export const pick=(value:Value,keys:string[])=>Object.fromEntries(keys.map(key=>[key,value[key]]));

export function marketingConfig(f:any,revision=1,extraOffers:Value={}) {
  const {offer_id,...offer}=E.discount;
  return {revision,brand:'Rifare synthetic merchant',headlines:{welcome:'A merchant offer',reminder:'Your cart is ready'},bodies:{plain:'Review the current terms in your account.'},offers:{[offer_id]:offer,...extraOffers},expires_at:f.now()+120000};
}

/** Attach native marketing owners to the original financial fixture's kernel.
 * A separate marketingFixture would have a different authority and database. */
function attachMarketing(f:any,open:(name:string)=>DatabaseSync) {
  const sourceDb=open('incentive-support.sqlite'),source=new SupportFixtureSource(sourceDb,f.a.tenant,f.a.store,'merchant_mail',f.now),conversations=new SupportConversations(f.kernel),consent=new SupportConsent(f.kernel),tracking=new SupportTracking(f.kernel,f.reads);
  const caseId='loyalty_case',link=conversations.link(f.a.scope,f.customer,{case_id:caseId,channel:'email',account_id:source.account,external_id:'incentive_email_thread',history:'partial',source_revision:1});
  consent.configureSender(f.owner.scope,{id:'sender_one',expected_revision:0,channel:'email',address:'support@example.invalid',account_id:source.account,source_identity:source.identity,source_contract:source.contract,expires_at:f.now()+3600000,jurisdiction:'US_TEST',transactional_basis:'order_service'});
  consent.verifyContact(f.a.scope,f.customer,{link_id:link.id,address:'shopper-apparel@example.invalid'});
  const marketingDb=open('incentive-marketing.sqlite'),marketingSource=new MarketingFixtureSource(marketingDb,{tenant:f.a.tenant,store:f.a.store,account:source.account},f.now);
  marketingSource.configure(marketingConfig(f));
  const experiments=new CheckoutExperiments(f.kernel,()=>E.measurement.seed_hex),measurement=new GrowthMeasurement(f.kernel,experiments,marketingSource),segments=new MarketingSegments(f.kernel,marketingSource),campaigns=new GrowthCampaigns(f.kernel,segments,experiments),delivery=new SupportDelivery(f.kernel,tracking,[source],null,campaigns);
  const first={case_id:caseId,resource_id:f.order().id,customer_id:f.order().customer_id,customer:f.customer,link},members:Value[]=[first];
  const seedMember=(m:Value)=>marketingSource.seedMember({tenant_id:f.a.tenant,store_id:f.a.store,case_id:m.case_id,resource_id:m.resource_id,customer_id:m.customer_id,country:'US_TEST',tags:['growth'],spend_minor:'10000',available_fields:['country','tags','spend_minor']});seedMember(first);
  const ready=(extra:Value={})=>{
    const segment=segments.define(f.a.scope,{segment_id:'segment-one',expected_revision:0,definition:{country:'US_TEST',required_tag:'growth',minimum_spend_minor:'0',required_fields:['country','tags','spend_minor']},template:{headline_key:'welcome',body_key:'plain',offer_id:'offer-five'}});
    segments.approve(f.reviewer.scope,{segment_id:segment.id,expected_digest:segment.digest,expires_at:f.now()+60000});
    const draft=campaigns.draft(f.a.scope,{campaign_id:'campaign-one',expected_revision:0,segment_id:segment.id,headline_key:'welcome',body_key:'plain',offer_id:'offer-five',sender_id:'sender_one',starts_at:f.now(),ends_at:f.now()+60000,budget_minor:'12',unit_cost_minor:'3',experiment_id:null,recovery_after_ms:100,...extra});
    campaigns.approve(f.reviewer.scope,{campaign_id:draft.id,expected_digest:draft.digest,expires_at:draft.body.ends_at});campaigns.schedule(f.a.scope,draft.id);return draft;
  };
  const grant=(m=first,state='granted',version=1)=>consent.record(m.customer,{case_id:m.case_id,sender_id:'sender_one',channel:'email',purpose:'marketing',state,event_id:'incentive_consent_'+m.case_id+'_'+version,source_version:version,effective_at:f.now(),source_ref:'verified_customer_click'});
  const queue=(m=first,campaign_id='campaign-one')=>delivery.queueCampaign(f.a.scope,{campaign_id,case_id:m.case_id,link_id:m.link.id,expected_generation:f.ownership.inspect(f.a.scope,m.case_id)!.generation});
  return {...f,sourceDb,source,conversations,consent,tracking,marketingDb,marketingSource,experiments,measurement,segments,campaigns,delivery,first,members,seedMember,ready,grant,queue,link,caseId};
}

function setupMeasurement(f:any) {
  const original=f.order();f.kernel.ingest(f.a.scope,{kind:'order',source_system:'synthetic',external_id:original.external_id,source_version:original.source_version+1,source_updated_at:f.now(),customer_id:original.customer_id,payload:{...original.payload,marketing_eligibility:{eligible:true,bot:false}}});
  for(const n of [2,3,5]){
    const customerId='GROWTH-C-'+n,address='growth-'+n+'@example.invalid';
    f.kernel.ingest(f.a.scope,{kind:'customer',source_system:'synthetic',external_id:customerId,source_version:1,source_updated_at:f.now(),customer_id:null,payload:{email:address}});
    const order=f.kernel.ingest(f.a.scope,{kind:'order',source_system:'synthetic',external_id:'GROWTH-O-'+n,source_version:1,source_updated_at:f.now(),customer_id:customerId,payload:{...f.order().payload,marketing_eligibility:{eligible:true,bot:false}}});
    let delivery:Value|undefined;const access=new CustomerAccess(f.kernel,(value:Value)=>{delivery=value;}),challenge=access.request({store_id:f.a.store,order_number:order.external_id,email:address},'incentive-proof-'+n),verified=access.complete({store_id:f.a.store,challenge_id:challenge.challenge_id,proof:delivery!.proof}),customer=f.kernel.authenticate(verified.token),case_id='incentive_cohort_'+n;
    f.cases.create(customer,{case_id,resource_id:order.id,profile_id:'default',policy_id:'returns'});
    const link=f.conversations.link(f.a.scope,customer,{case_id,channel:'email',account_id:f.source.account,external_id:'incentive_cohort_thread_'+n,history:'partial',source_revision:1});f.consent.verifyContact(f.a.scope,customer,{link_id:link.id,address});
    const m={case_id,resource_id:order.id,customer_id:customerId,customer,link};f.members.push(m);f.seedMember(m);
  }
  const began=f.now(),experiment=f.experiments.configure(f.owner.scope,{experiment_id:E.measurement.experiment_id,version:1,starts_at:began,ends_at:began+1000,attribution_window_ms:1000,followup_through_at:began+2000,currency:'USD',variants:[{id:'treatment',weight:5000},{id:'holdout',weight:5000}],members:f.members.map((m:Value)=>m.case_id)});
  assert.deepEqual(experiment.denominators,E.measurement.denominators);return {began,experiment};
}

type Options={lifecycle?:boolean;consent?:boolean;experiment?:boolean;applicability_ttl_ms?:number;extraOffer?:boolean};
export async function fixture(options:Options={}) {
  const base:any=options.lifecycle?await accrualFixture():marketingFixture(),opened:DatabaseSync[]=[];
  const open=(name:string)=>{const db=new DatabaseSync(join(base.directory,name));opened.push(db);return db;};let shop:any;
  try{
    const f:any=options.lifecycle?attachMarketing(base,open):{...base,caseId:'case_one'};
    if(options.extraOffer)f.marketingSource.configure(marketingConfig(f,2,{'offer-ten':{text:'Ten dollars off an eligible purchase.',currency:'USD',discount_minor:'1000',catalog_ref:'synthetic-reviewed-second-offer'}}));
    const cohort=options.experiment?setupMeasurement(f):null;
    shop=await installShoppingCart(f);
    if(options.consent!==false)f.grant();
    const campaign=f.ready({recovery_after_ms:100,...(cohort?{experiment_id:cohort.experiment.id,ends_at:cohort.experiment.ends_at}:{})});
    const recovery=new CartRecovery(f.kernel,shop.carts,f.campaigns);f.campaigns.attachRecovery(recovery);f.advance(101);
    const proposed=recovery.propose(f.a.scope,{cart_id:shop.cart_id,campaign_id:campaign.id});
    let balanceSource=f.balanceSource,loyaltyDb=f.loyaltyDb,balances=f.balances;
    if(!balanceSource){
      loyaltyDb=open('incentive-loyalty.sqlite');balanceSource=new LoyaltyFixtureSource(loyaltyDb,{tenant_id:f.a.tenant,store_id:f.a.store,account_id:'loyalty_account',provider:'full'},f.now);
      balanceSource.publish({customer_id:E.customer_id,source_revision:1,observed_at:f.now(),expires_at:f.now()+300000,complete:true,balances:structuredClone(E.account),rules:{revision:1,unit:'points',minimum_redemption:100,maximum_redemption:800,redemption_step:50,expires_at:f.now()+600000}});
      balances=new LoyaltyBalances(f.kernel,balanceSource);
    }
    const redemptionSource=new LoyaltyRedemptionFixtureSource(balanceSource,f.now),benefits=redemptionSource.publishBenefits({revision:1,expires_at:f.now()+300000,benefits:structuredClone(E.benefits)}),anchor=redemptionSource.pinAccount(E.customer_id),redemptions=new LoyaltyRedemptions(f.kernel,{balances,source:redemptionSource});
    const source=new LoyaltyIncentiveFixtureSource({marketing:f.marketingSource,shopping:shop.source,redemption:redemptionSource});
    source.configure({revision:1,expires_at:f.now()+(options.applicability_ttl_ms??60000),combinations:structuredClone(E.combinations)});
    const incentives=new LoyaltyIncentives(f.kernel,{redemptions,carts:shop.carts,campaigns:f.campaigns,recovery,source}),lifecycle=options.lifecycle?new LoyaltyLifecycle(f.kernel,{accrual:f.projectionOwner,redemptions,incentives,campaigns:f.campaigns,measurement:f.measurement}):null;
    const loyaltyGateway=new ActionGateway(f.kernel,{loyalty:redemptions}),queueOwner=new ExceptionQueue(f.kernel,undefined,{loyalty:redemptions});
    const service=new SupportService(f.kernel,f.reads,{sources:[f.source],loyalty:balances,...(options.lifecycle?{loyaltyAccrual:f.projectionOwner}:{}),loyaltyRedemptions:redemptions,loyaltyIncentives:incentives,...(lifecycle?{loyaltyLifecycle:lifecycle}:{})});
    return {...f,scope:f.a.scope,shop,campaign,cohort,recovery,recoveryId:proposed.id,balanceSource,loyaltyDb,balances,redemptionSource,benefits,anchor,redemptions,incentiveSource:source,incentives,lifecycle,loyaltyGateway,queueOwner,service,
      cleanup:()=>{shop.cleanup();for(const db of opened.reverse())db.close();base.cleanup();}};
  }catch(error){shop?.cleanup();for(const db of opened.reverse())db.close();base.cleanup();throw error;}
}
export async function usingFixture(fn:(f:any)=>unknown,options:Options={}){const f=await fixture(options);try{return await fn(f);}finally{f.cleanup();}}
export const contextInput=(f:any,patch:Value={})=>({case_id:f.caseId,link_id:f.link.id,expected_generation:f.ownership.inspect(f.scope,f.caseId).generation,...patch});
export const quoteInput=(f:any,patch:Value={})=>({...contextInput(f),cart_id:f.shop.cart_id,campaign_id:f.campaign.id,benefit_id:'synthetic_reward_400',...patch});
export const quote=(f:any,patch:Value={},scope=f.scope,proof=f.customer)=>f.incentives.quote(scope,proof,quoteInput(f,patch));
export const bind=(f:any,q:Value)=>f.incentives.bind(f.scope,{recovery_id:f.recoveryId,quote:q});
export const reportInput=(f:any,patch:Value={})=>({...contextInput(f),campaign_id:null,experiment_id:null,...patch});
export const report=(f:any,patch:Value={},scope=f.scope,proof=f.customer)=>f.lifecycle.report(scope,proof,reportInput(f,patch));
export const quoteRows=(f:any)=>f.db.prepare('SELECT * FROM commerce_support_documents WHERE kind=? ORDER BY id').all(QUOTE_KIND) as Value[];
export const opRows=(f:any)=>f.db.prepare('SELECT * FROM commerce_support_documents WHERE kind=? ORDER BY id').all(OP_KIND) as Value[];
export const recoveryRow=(f:any)=>f.db.prepare('SELECT * FROM commerce_cart_recoveries WHERE id=?').get(f.recoveryId) as Value;
export const providerJournal=(f:any)=>rows(f.loyaltyDb,'fixture_loyalty_redemption_journal');
export const providerState=(f:any)=>({snapshots:rows(f.loyaltyDb,'fixture_loyalty_snapshots'),journal:providerJournal(f)});
export function effects(f:any) {
  const tables=['commerce_action_previews','commerce_action_approvals','commerce_action_receipts','commerce_operations','commerce_resolution_operations','commerce_support_deliveries','commerce_checkout_assignments','commerce_checkout_exposures','commerce_growth_observations'];
  return {core:Object.fromEntries(tables.map(t=>[t,count(f.db,t)])),loyalty_operations:opRows(f),provider:providerState(f),messages:rows(f.sourceDb,'support_source_effects'),cart_effects:rows(f.shop.sourceDb,'growth_source_cart_effects'),marketing_effects:rows(f.marketingDb,'marketing_source_effects')};
}
export function reserveReward(f:any,comparison:Value|null=null,points=400) {
  const input=contextInput(f),view=comparison?null:f.redemptions.context(f.scope,f.customer,input),q=comparison?{id:comparison.quote.loyalty_quote_id,digest:comparison.quote.loyalty_quote_digest}:f.redemptions.quote(f.scope,f.customer,{...input,points,unit:'points',benefit_id:points===200?'synthetic_reward_200':'synthetic_reward_400',snapshot_digest:view.snapshot_digest});
  const p=f.loyaltyGateway.prepare(f.scope,{case_id:f.caseId,action:'diagnostic.loyalty.redeem',arguments:{quote_id:q.id,quote_digest:q.digest}}),a=f.loyaltyGateway.approve(f.reviewer.scope,{preview_id:p.id,preview_digest:p.digest}),receipt=f.loyaltyGateway.execute(f.scope,{preview_id:p.id,preview_digest:p.digest,approval_id:a.id});
  assert.equal(receipt.state,'reserved');assert.equal(receipt.points.quantity,points);return {id:receipt.loyalty_operation_id,q,p,a,receipt};
}
export function assertProviderDebit(f:any,operationId:string) {
  const journal=providerJournal(f);assert.equal(journal.length,1);const row=journal[0],body=JSON.parse(row.body);
  assert.equal(row.operation_id,operationId);assert.equal(row.seq,1);assert.equal(row.account_key,f.anchor.account_key);assert.equal(contentDigest(body),row.digest);
  assert.equal(body.command.operation_id,operationId);assert.equal(body.command.points,400);assert.equal(body.command.unit,'points');assert.equal(body.command.benefit_id,'synthetic_reward_400');assert.equal(body.command.financial_effect,false);assert.equal(body.command_digest,contentDigest(body.command));
  assert.equal(body.result.operation_id,operationId);assert.equal(body.result.command_digest,body.command_digest);assert.equal(body.result.state,'redeemed');assert.equal(body.result.points,400);assert.equal(body.result.before_revision,1);assert.equal(body.result.after_revision,2);
  const snapshots=rows(f.loyaltyDb,'fixture_loyalty_snapshots');assert.equal(snapshots.length,2);assert.deepEqual(JSON.parse(snapshots[0].body).balances,E.account);assert.deepEqual(JSON.parse(snapshots[1].body).balances,E.after_redemption);assert.equal(body.result.before_digest,snapshots[0].digest);assert.equal(body.result.after_digest,snapshots[1].digest);return body.result;
}
export function assertRefund(f:any,id:string,state='settled') {
  const records=rows(f.financeDb,'fixture_resolution_effects');assert.equal(records.length,1);const row=records[0],command=JSON.parse(row.command),body=JSON.parse(row.body);
  assert.equal(row.operation_id,id);assert.equal(command.operation_id,id);assert.equal(row.digest,contentDigest(command));assert.equal(body.operation_id,id);assert.equal(body.kind,'refund');assert.equal(body.state,state);assert.equal(body.amount_minor,E.partial_refund_minor);assert.equal(body.currency,'USD');assert.equal(body.resource_id,f.order().id);assert.equal(body.customer_id,E.customer_id);assert.equal(count(f.financeDb,'fixture_payment_captures'),0);assert.equal(count(f.financeDb,'fixture_credit_accounts'),0);return body;
}
export function assertMissing(view:Value) {
  assert.equal(view.status,'needs_reconciliation');assert.equal(view.reconciled,false);assert.equal(view.source_effects_dispatched,0);assert.equal(view.execution_authorized,false);assert.equal(view.production_qualified,false);
  for(const item of E.missing_evidence)assert.ok(view.exceptions.some((value:Value)=>canonical(value)===canonical(item)),item.code);
  const {report_digest,...body}=view;assert.equal(report_digest,contentDigest(body));
}
export function assertEconomics(view:Value,targets:Value,redeemed:number) {
  assert.deepEqual(view.economics,{proposed_earned_points:targets.earned_points,proposed_reversal_points:targets.reversal_points,proposed_net_points:targets.net_points,attributed_issued_points:null,attributed_reversed_points:null,observed_redeemed_points:redeemed,expected_monetary_liability_minor:null,actual_reward_cost_minor:null,loyalty_inclusive_net_margin_minor:null,currency:null,basis:'separate_point_targets_observed_redemptions_and_unvalued_costs'});
}
export function externalWorker(f:any) {
  const api=new WorkerApi(f.kernel),audience='http://127.0.0.1:9031/v1/worker',grant=api.leases.issue(f.scope,{case_id:f.caseId,lifetime_ms:30000},audience),lease=api.leases.claim(grant.token,audience,30000),scope=api.leases.returnScoped(grant.token,audience,lease.generation).scope;
  assert.equal(f.kernel.require(scope).role,'operator');assert.equal(f.kernel.workerIdentity(scope).kind,'external_work');return {api,grant,lease,scope};
}

export function measuredEvents(f:any,missingCosts=false) {
  const {began}=f.cohort,members=f.members;
  for(const m of members.slice(0,2))f.experiments.expose(f.scope,{experiment_id:E.measurement.experiment_id,case_id:m.case_id,channel:'email',offer_shown:true,event_id:'incentive_exposure_'+m.case_id});
  const event=(m:Value,p:Value)=>f.marketingSource.observe({event_id:'unused',resource_id:m.resource_id,customer_id:m.customer_id,kind:'purchase',purchase_id:'purchase_'+m.case_id,channel:'web',at:f.now(),amount_minor:'10000',category:null,through_at:null,complete:false,cost_coverage:null,...p});
  f.advance(100);const events=[event(members[0],{event_id:'observed_treatment_purchase'}),event(members[2],{event_id:'observed_holdout_purchase'}),event(members[0],{event_id:'observed_treatment_email',channel:'email'})];
  f.advance(1200);events.push(event(members[0],{event_id:'observed_refund',kind:'refund',amount_minor:'3000'}),event(members[0],{event_id:'observed_treatment_cost',kind:'cost',amount_minor:'2000',category:'goods'}),event(members[2],{event_id:'observed_holdout_cost',kind:'cost',amount_minor:'1000',category:'goods'}));
  f.advance(began+2000-f.now());
  for(const m of members)events.push(event(m,{event_id:'observed_coverage_'+m.case_id,kind:'coverage',purchase_id:null,amount_minor:'0',through_at:began+2000,complete:true,cost_coverage:{goods:m===members[0]?(missingCosts?null:'2000'):m===members[2]?'1000':'0',shipping:'0',payment:'0',marketing:'0'}}));
  for(const e of [...events].reverse())f.measurement.importEvent(f.scope,E.measurement.experiment_id,e.event_id);
  for(const e of events)assert.equal(f.measurement.importEvent(f.scope,E.measurement.experiment_id,e.event_id).duplicate,true);
  return f.measurement.report(f.scope,E.measurement.experiment_id);
}

export const backup=(f:any)=>createRecoverySnapshot(f.kernel,join(f.directory,'incentive-backup'));
export function restoredFixture(f:any,saved:Value) {
  const suppression=suppressionCheckpoint(f.kernel),result=restoreRecoverySnapshot({snapshot:saved.directory,destination:join(f.directory,'incentive-restored'),manifest_sha256:saved.manifest_sha256,suppression,suppression_sha256:contentDigest(suppression)},f.now),db=new DatabaseSync(result.database),kernel=new CommerceKernel(db,f.now);
  try{
    const scope=kernel.authenticate(kernel.issueSession(f.a.tenant,f.a.store,'owner')),balances=new LoyaltyBalances(kernel,f.balanceSource),redemptionSource=new LoyaltyRedemptionFixtureSource(f.balanceSource,f.now),redemptions=new LoyaltyRedemptions(kernel,{balances,source:redemptionSource});
    const finance=new ResolutionExecution(kernel,f.financeSource),lineage=new ExchangeLineage(kernel,f.lineageSource),accrual=new LoyaltyAccrual(kernel,{balances,finance,lineage,accrual:f.accrualSource});
    const experiments=new CheckoutExperiments(kernel),segments=new MarketingSegments(kernel,f.marketingSource),campaigns=new GrowthCampaigns(kernel,segments,experiments),measurement=new GrowthMeasurement(kernel,experiments,f.marketingSource),carts=new ShoppingCart(kernel,f.shop.source),recovery=new CartRecovery(kernel,carts,campaigns);campaigns.attachRecovery(recovery);
    const source=new LoyaltyIncentiveFixtureSource({marketing:f.marketingSource,shopping:f.shop.source,redemption:redemptionSource}),incentives=new LoyaltyIncentives(kernel,{redemptions,carts,campaigns,recovery,source}),lifecycle=new LoyaltyLifecycle(kernel,{accrual,redemptions,incentives,campaigns,measurement});
    return {result,db,kernel,scope,balances,redemptionSource,redemptions,campaigns,recovery,incentives,lifecycle,close:()=>db.close()};
  }catch(error){db.close();throw error;}
}
