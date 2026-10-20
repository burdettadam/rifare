import {CommerceKernel,exact,id,integer} from './kernel.mts';
import type {Scope,Row} from './kernel.mts';
import {contentDigest,jsonValue} from './configuration-values.mts';
import {supportCase} from './support-core.mts';
import {growthBody} from './growth-marketing-core.mts';
import {LoyaltyAccrual} from './loyalty-accrual.mts';
import {LoyaltyRedemptions} from './loyalty-redemptions.mts';
import {LoyaltyIncentives} from './loyalty-incentives.mts';
import {GrowthCampaigns} from './growth-campaigns.mts';
import {GrowthMeasurement} from './growth-measurement.mts';
import {ExceptionQueue} from './exception-queue.mts';
import {LOYALTY_OPERATION_KIND,redemptionHuman,redemptionPoints,redemptionResult} from './loyalty-redemption-values.mts';
import {loyaltyRecords,loyaltyOperationRecord} from './loyalty-redemption-records.mts';
import {assertSeparateLoyaltyDatabases} from '../adapters/loyalty-fixture-source.mts';

type Owners={accrual:LoyaltyAccrual;redemptions:LoyaltyRedemptions;incentives:LoyaltyIncentives;campaigns:GrowthCampaigns;measurement?:GrowthMeasurement};

/** Transient evidence composition. A financial refund never proves a loyalty reversal. */
export class LoyaltyLifecycle {
  readonly k:CommerceKernel;readonly accrual:LoyaltyAccrual;readonly redemptions:LoyaltyRedemptions;readonly incentives:LoyaltyIncentives;readonly campaigns:GrowthCampaigns;readonly measurement:GrowthMeasurement|null;
  #core:unknown;
  constructor(k:CommerceKernel,owners:Owners) {
    exact(owners,['accrual','redemptions','incentives','campaigns',...(Object.hasOwn(owners,'measurement')?['measurement']:[])]);
    if(!(k instanceof CommerceKernel)||!(owners.accrual instanceof LoyaltyAccrual)||!(owners.redemptions instanceof LoyaltyRedemptions)||!(owners.incentives instanceof LoyaltyIncentives)||!(owners.campaigns instanceof GrowthCampaigns)||owners.measurement!==undefined&&!(owners.measurement instanceof GrowthMeasurement))throw new Error('LOYALTY_SOURCE_OWNER_MISMATCH');
    this.k=k;this.accrual=owners.accrual;this.redemptions=owners.redemptions;this.incentives=owners.incentives;this.campaigns=owners.campaigns;this.measurement=owners.measurement??null;this.#core=k.db;this.#owners();Object.freeze(this);
  }
  #owners() {
    const k=this.k,i=this.incentives;
    if(k.db!==this.#core||this.accrual.k!==k||this.redemptions.k!==k||i.k!==k||this.campaigns.k!==k||this.accrual.balances!==this.redemptions.balances||i.redemptions!==this.redemptions||i.campaigns!==this.campaigns||i.source.redemption!==this.redemptions.source||i.source.marketing!==this.campaigns.segments.source||i.carts.source!==i.source.shopping||i.carts.kernel!==k||i.recovery.k!==k||i.recovery.carts!==i.carts||i.recovery.campaigns!==this.campaigns||this.measurement&&(this.measurement.k!==k||this.measurement.source!==i.source.marketing||this.measurement.experiments!==this.campaigns.experiments))throw new Error('LOYALTY_SOURCE_OWNER_MISMATCH');
  }
  #recovery(scope:Scope,s:Row,c:Row,campaignId:string|null,experimentId:string|null) {
    if(experimentId!==null&&campaignId===null)throw new Error('LOYALTY_LIFECYCLE_SCOPE_MISMATCH');
    if(campaignId===null)return {campaign:null,measurement:null};
    const campaign=this.campaigns.read(scope,campaignId),row=this.k.db.prepare('SELECT * FROM commerce_growth_campaign_recipients WHERE tenant_id=? AND store_id=? AND campaign_id=? AND resource_id=?').get(s.tenant_id,s.store_id,campaignId,c.resource_id) as Row;
    if(!row)throw new Error('LOYALTY_LIFECYCLE_SCOPE_MISMATCH');const member=growthBody(row);
    if(member.campaign_id!==campaignId||member.campaign_digest!==campaign.digest||member.case_id!==c.id||member.resource_id!==c.resource_id||member.customer_id!==c.customer_id||row.case_id!==c.id||row.customer_id!==c.customer_id)throw new Error('LOYALTY_LIFECYCLE_SCOPE_MISMATCH');
    let measurement:Row|null=null;
    if(experimentId!==null){
      if(campaign.body.experiment_id!==experimentId)throw new Error('LOYALTY_LIFECYCLE_SCOPE_MISMATCH');
      if(!this.measurement)throw new Error('LOYALTY_MEASUREMENT_NOT_CONFIGURED');
      const assignment=this.k.db.prepare('SELECT * FROM commerce_checkout_assignments WHERE tenant_id=? AND store_id=? AND experiment_id=? AND resource_id=?').get(s.tenant_id,s.store_id,experimentId,c.resource_id) as Row;
      if(!assignment)throw new Error('LOYALTY_LIFECYCLE_SCOPE_MISMATCH');const a=growthBody(assignment),experiment=this.campaigns.experiments.inspect(scope,experimentId);
      if(a.case_id!==c.id||a.resource_id!==c.resource_id||a.customer_id!==c.customer_id||a.arm!==assignment.arm||assignment.customer_id!==c.customer_id||a.state!=='assigned'||experiment.digest!==campaign.body.experiment_digest)throw new Error('LOYALTY_LIFECYCLE_SCOPE_MISMATCH');
      measurement=this.measurement.report(scope,experimentId);
    }
    return {campaign:this.campaigns.summary(scope,campaignId),measurement};
  }
  report(scope:Scope,customerProof:Scope,value:unknown) {
    const p=exact(jsonValue(value,32768),['case_id','link_id','expected_generation','campaign_id','experiment_id']);id(p.case_id);id(p.link_id);integer(p.expected_generation,1);
    if(p.campaign_id!==null)id(p.campaign_id);if(p.experiment_id!==null)id(p.experiment_id);
    return this.k.transaction(()=>{
      const k=this.k,s=redemptionHuman(k,scope);k.authorize(scope,'support.analytics');this.#owners();
      const {c}=supportCase(k,scope,p.case_id);k.authorize(scope,'support.analytics',c.resource_id);
      const applicability=this.incentives.source.observe();
      if(applicability.tenant_id!==s.tenant_id||applicability.store_id!==s.store_id)throw new Error('LOYALTY_SOURCE_SCOPE_MISMATCH');
      for(const db of [this.incentives.source.db,this.incentives.source.shopping.db,this.redemptions.source.db])assertSeparateLoyaltyDatabases(k.db,db);
      const context={case_id:p.case_id,link_id:p.link_id,expected_generation:p.expected_generation},base=this.redemptions.balances.context(scope,customerProof,context),capacity=this.redemptions.context(scope,customerProof,context),source=this.redemptions.source.observeAccount(capacity.account_key);
      if(!base.snapshot||base.snapshot_digest!==capacity.snapshot_digest||capacity.snapshot_digest!==source.current.digest)throw new Error('LOYALTY_SNAPSHOT_CHANGED');
      const projection=this.accrual.project(scope,customerProof,context);
      if(projection.context_digest!==base.context_digest)throw new Error('LOYALTY_SNAPSHOT_CHANGED');
      const records=loyaltyRecords(k,s).filter(r=>r.kind===LOYALTY_OPERATION_KIND&&r.body.resource_id===c.resource_id&&r.body.account_key===capacity.account_key).sort((a,b)=>a.id.localeCompare(b.id));
      const journal=new Map(source.journal.map((entry:Row)=>[entry.operation_id,entry]));let redeemed=0n;
      const operations=records.map(record=>{
        const native=loyaltyOperationRecord(k,s,record.id)!,view=this.redemptions.read(scope,record.id),entry=journal.get(record.id) as Row|undefined;
        if(record.body.source_identity!==source.source_identity||record.body.subject_ref!==source.subject_ref||entry&&entry.command_digest!==record.body.command_digest)throw new Error('LOYALTY_HISTORY_INVALID');
        const observed=entry?redemptionResult(entry.result,native.command):null;
        if(observed?.state==='redeemed')redeemed+=BigInt(observed.points);
        return {...view,source_observation:observed};
      });
      const observedRedeemed=redemptionPoints(redeemed),exceptions:Row[]=[{code:'LOYALTY_AWARD_EVIDENCE_MISSING',operation_id:null},{code:'LOYALTY_REVERSAL_EVIDENCE_MISSING',operation_id:null}];
      if(projection.status!=='ready')exceptions.push({code:projection.reason,operation_id:null});
      for(const op of operations)if(['reserved','unknown'].includes(op.state))exceptions.push({code:op.reason,operation_id:op.operation_id});
      const recovery=this.#recovery(scope,s,c,p.campaign_id,p.experiment_id),ids=new Set(operations.map(op=>op.operation_id)),queue=new ExceptionQueue(k,undefined,{loyalty:this.redemptions}).list(scope,100);
      const result={schema_version:1,case_id:c.id,resource_id:c.resource_id,status:'needs_reconciliation',reconciled:false,
        account:{scope:'provider_account',source_identity:base.snapshot.source_identity,snapshot_digest:base.snapshot_digest,balances:base.snapshot.balances,rules_revision:base.snapshot.rules.revision,provider_available_points:capacity.provider_available_points,held_points:capacity.held_points,accounted_held_points:capacity.accounted_held_points,effective_available_points:capacity.effective_available_points},
        projection,redemptions:{scope:'resource_operations',operations,observed_redeemed_points:observedRedeemed},exceptions,
        economics:{proposed_earned_points:projection.totals?.earned_points??null,proposed_reversal_points:projection.totals?.reversal_points??null,proposed_net_points:projection.totals?.net_points??null,attributed_issued_points:null,attributed_reversed_points:null,observed_redeemed_points:observedRedeemed,expected_monetary_liability_minor:null,actual_reward_cost_minor:null,loyalty_inclusive_net_margin_minor:null,currency:null,basis:'separate_point_targets_observed_redemptions_and_unvalued_costs'},
        recovery,exception_queue:{...queue,items:queue.items.filter(item=>ids.has(item.operation_id))},source_effects_dispatched:0,execution_authorized:false,production_qualified:false};
      // The core transaction cannot freeze the physically separate provider DB.
      // Reject a direct source booking that happened between these native reads.
      if(this.redemptions.source.observeAccount(capacity.account_key).digest!==source.digest)throw new Error('LOYALTY_SNAPSHOT_CHANGED');
      return {...result,report_digest:contentDigest(result)};
    });
  }
  retained(scope:Scope,value:unknown) {
    const p=exact(jsonValue(value,32768),['operation_ids']);
    if(!Array.isArray(p.operation_ids)||!p.operation_ids.length||p.operation_ids.length>100||new Set(p.operation_ids).size!==p.operation_ids.length)throw new Error('INVALID_INPUT');p.operation_ids.forEach(id);
    return this.k.transaction(()=>{
      redemptionHuman(this.k,scope);this.k.authorize(scope,'support.analytics');this.k.authorize(scope,'privacy.manage');this.#owners();
      const operations=p.operation_ids.map((operation:string)=>{const view=this.redemptions.read(scope,operation);if(!view.minimized)throw new Error('LOYALTY_RETAINED_EVIDENCE_REQUIRED');return view;});
      return {schema_version:1,mode:'retained_operations',operations,status:'limited_retained_evidence',reconciled:false,account:null,projection:null,recovery:null,source_effects_dispatched:0,execution_authorized:false,production_qualified:false};
    });
  }
}
