import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { id } from './kernel.mts';
import { canonical,contentDigest } from './configuration-values.mts';
import { assertRecoveryEgress } from './data-guards.mts';
import { CheckoutExperiments } from './checkout-experiments.mts';
import { MarketingFixtureSource } from '../adapters/marketing-fixture-source.mts';
import { growthBody,growthMinor } from './growth-marketing-core.mts';
import { money,ratioMoney } from './money.mts';

function wilson(success:number,total:number):[number,number]|null {
  if(!total)return null;const z=1.959963984540054,p=success/total,a=1+z*z/total,c=(p+z*z/(2*total))/a,h=z*Math.sqrt(p*(1-p)/total+z*z/(4*total*total))/a;
  return [Math.max(0,c-h),Math.min(1,c+h)];
}
export class GrowthMeasurement {
  readonly k:CommerceKernel;readonly experiments:CheckoutExperiments;readonly source:MarketingFixtureSource;
  constructor(k:CommerceKernel,experiments:CheckoutExperiments,source:MarketingFixtureSource){if(experiments.k!==k||source.db===k.db)throw new Error('GROWTH_SOURCE_BOUNDARY');this.k=k;this.experiments=experiments;this.source=source;}
  #source(s:Row){if(this.source.tenant!==s.tenant_id||this.source.store!==s.store_id)throw new Error('GROWTH_SOURCE_SCOPE');return this.source;}
  importEvent(scope:Scope,experimentId:string,eventId:string){
    return this.k.transaction(()=>{
      const k=this.k,s=k.authorize(scope,'support.analytics'),exp=this.experiments.inspect(scope,id(experimentId));assertRecoveryEgress(k);
      const source=this.#source(s),event=source.event(id(eventId)),order=k.get(scope,event.resource_id);
      if(event.tenant_id!==s.tenant_id||event.store_id!==s.store_id||event.source_identity!==source.identity||event.customer_id!==order.customer_id||event.currency!==exp.currency||event.at>k.clock()||event.observed_at>k.clock()||event.qualification!=='synthetic_only')throw new Error('GROWTH_OBSERVATION_SCOPE');
      const assignment=k.db.prepare('SELECT * FROM commerce_checkout_assignments WHERE tenant_id=? AND store_id=? AND experiment_id=? AND resource_id=?').get(s.tenant_id,s.store_id,exp.id,order.id) as Row;
      const member=growthBody(assignment);if(member.customer_id!==order.customer_id||member.state!=='assigned')throw new Error('GROWTH_OBSERVATION_NOT_ENROLLED');
      const old=k.db.prepare('SELECT * FROM commerce_growth_observations WHERE tenant_id=? AND store_id=? AND experiment_id=? AND event_id=?').get(s.tenant_id,s.store_id,exp.id,eventId) as Row;
      if(old){if(old.digest!==contentDigest(event))throw new Error('GROWTH_OBSERVATION_CONFLICT');return {event_id:eventId,duplicate:true};}
      k.db.prepare('INSERT INTO commerce_growth_observations VALUES(?,?,?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,exp.id,eventId,order.id,order.customer_id,source.identity,canonical(event),contentDigest(event));
      return {event_id:eventId,duplicate:false,source_effects_dispatched:0};
    });
  }
  report(scope:Scope,experimentId:string){
    const k=this.k,s=k.authorize(scope,'support.analytics'),exp=this.experiments.inspect(scope,id(experimentId)),source=this.#source(s);
    const arms:Row={treatment:{denominator:exp.denominators.treatment,purchases:0,converting_units:0,gross:0n,refunds:0n,costs:0n},holdout:{denominator:exp.denominators.holdout,purchases:0,converting_units:0,gross:0n,refunds:0n,costs:0n}};
    const assignments=k.db.prepare('SELECT * FROM commerce_checkout_assignments WHERE tenant_id=? AND store_id=? AND experiment_id=?').all(s.tenant_id,s.store_id,exp.id) as Row[];
    let unavailable=0,contaminated=0,attributed=0n,purchases=0;const incomplete=new Set<string>(),seenPurchases=new Map<string,string>(),lineage:string[]=[],attribution:Row[]=[];
    const actualCounts={treatment:assignments.filter(r=>r.arm==='treatment').length,holdout:assignments.filter(r=>r.arm==='holdout').length};
    if(contentDigest(actualCounts)!==contentDigest(exp.denominators))throw new Error('EXPERIMENT_DENOMINATOR_INTEGRITY');
    for(const row of assignments){
      if(!row.arm)continue;const arm=arms[row.arm];if(!arm)throw new Error('EXPERIMENT_ASSIGNMENT_MISMATCH');
      let member:Row;
      try{k.get(scope,row.resource_id);member=growthBody(row);}catch(error){if(!/SUBJECT_ERASED|NOT_FOUND|ACCESS_DENIED/.test(String(error)))throw error;incomplete.add(row.subject_hash);unavailable++;continue;}
      if(member.arm!==row.arm||member.resource_id!==row.resource_id||member.customer_id!==row.customer_id)throw new Error('EXPERIMENT_ASSIGNMENT_MISMATCH');
      const events=(k.db.prepare('SELECT * FROM commerce_growth_observations WHERE tenant_id=? AND store_id=? AND experiment_id=? AND resource_id=? ORDER BY event_id').all(s.tenant_id,s.store_id,exp.id,row.resource_id) as Row[]).map(r=>{
        const e=growthBody(r);if(e.source_identity!==source.identity||e.resource_id!==row.resource_id||e.customer_id!==row.customer_id||e.tenant_id!==s.tenant_id||e.store_id!==s.store_id||e.currency!==exp.currency||e.observed_at>k.clock())throw new Error('GROWTH_OBSERVATION_SCOPE');lineage.push(r.digest);return e;
      });
      const coverage=events.filter(e=>e.kind==='coverage'&&e.complete===true&&e.through_at>=exp.followup_through_at&&e.through_at<=k.clock()).sort((a,b)=>b.through_at-a.through_at)[0];
      if(!coverage||k.clock()<exp.followup_through_at)incomplete.add(row.subject_hash);
      const observedCosts:Record<string,bigint>={goods:0n,shipping:0n,payment:0n,marketing:0n};
      const exposures=(k.db.prepare('SELECT * FROM commerce_checkout_exposures WHERE tenant_id=? AND store_id=? AND experiment_id=? AND resource_id=?').all(s.tenant_id,s.store_id,exp.id,row.resource_id) as Row[]).map(r=>{
        const e=growthBody(r);if(e.assignment_digest!==row.digest||e.arm!==row.arm||e.resource_id!==row.resource_id||e.customer_id!==row.customer_id)throw new Error('EXPOSURE_INTEGRITY');return e;
      });
      if(row.arm==='holdout'&&exposures.some(e=>e.offer_shown))contaminated++;
      const native=new Map<string,Row>();
      for(const e of events.filter(e=>e.kind==='purchase'&&e.at>=exp.starts_at&&e.at<=exp.ends_at)){
        const identity=contentDigest([e.resource_id,e.customer_id,e.purchase_id,e.at,e.amount_minor,e.currency]);
        if(seenPurchases.has(e.purchase_id)&&seenPurchases.get(e.purchase_id)!==identity)throw new Error('CONVERSION_IDENTITY_CONFLICT');seenPurchases.set(e.purchase_id,identity);
        const old=native.get(e.purchase_id);if(old&&old.identity!==identity)throw new Error('CONVERSION_IDENTITY_CONFLICT');
        if(!old)native.set(e.purchase_id,{...e,identity});
      }
      if(native.size)arm.converting_units++;
      for(const purchase of native.values()){
        const gross=growthMinor(purchase.amount_minor);let refunds=0n,costs=0n;
        const adjustmentIds=new Map<string,string>();
        for(const e of events.filter(e=>['refund','cost'].includes(e.kind)&&e.purchase_id===purchase.purchase_id&&e.at>=purchase.at&&e.at<=exp.followup_through_at)){
          const key=e.kind+':'+(e.native_event_id??e.event_id),core=contentDigest([e.kind,e.purchase_id,e.at,e.amount_minor,e.category]);
          if(adjustmentIds.has(key)){if(adjustmentIds.get(key)!==core)throw new Error('ADJUSTMENT_IDENTITY_CONFLICT');continue;}adjustmentIds.set(key,core);
          if(e.kind==='refund')refunds+=growthMinor(e.amount_minor);else {costs+=growthMinor(e.amount_minor);observedCosts[e.category]+=growthMinor(e.amount_minor);}
        }
        if(refunds>gross)throw new Error('REFUNDS_EXCEED_ORIGINAL_PURCHASE');
        arm.gross+=gross;arm.refunds+=refunds;arm.costs+=costs;arm.purchases++;purchases++;
        const touches=exposures.filter(e=>e.offer_shown&&e.at<=purchase.at&&purchase.at-e.at<=exp.attribution_window_ms).sort((a,b)=>b.at-a.at||a.channel.localeCompare(b.channel));
        if(touches.length){attributed+=gross;attribution.push({purchase_id:purchase.purchase_id,channel:touches[0].channel,revenue_minor:gross.toString(),causal_claim:false});}
      }
      if(coverage&&Object.entries(observedCosts).some(([category,total])=>coverage.cost_coverage?.[category]===null||coverage.cost_coverage?.[category]===undefined||growthMinor(coverage.cost_coverage[category])!==total))incomplete.add(row.subject_hash);
      // An adjustment whose original purchase was never observed is unresolved,
      // rather than being quietly incorporated into an apparently complete net result.
      if(events.some(e=>['refund','cost'].includes(e.kind)&&e.at<=exp.followup_through_at&&!native.has(e.purchase_id)))incomplete.add(row.subject_hash);
    }
    const t=arms.treatment,h=arms.holdout,complete=incomplete.size===0&&t.denominator>0&&h.denominator>0;
    const tMargin=t.gross-t.refunds-t.costs,hMargin=h.gross-h.refunds-h.costs;
    const revenueReference=complete?ratioMoney(money('USD',h.gross.toString()),String(t.denominator),String(h.denominator),'half_even'):null;
    const marginReference=complete?ratioMoney(money('USD',hMargin.toString(),true),String(t.denominator),String(h.denominator),'half_even'):null;
    const incremental=complete?(t.gross-BigInt(revenueReference!.money.minor)).toString():null;
    const a=wilson(t.converting_units,t.denominator),b=wilson(h.converting_units,h.denominator);
    const outputArms=Object.fromEntries(Object.entries(arms).map(([name,value]:[string,any])=>[name,{denominator:value.denominator,purchases:value.purchases,converting_units:value.converting_units,gross_revenue_minor:value.gross.toString(),refunds_minor:value.refunds.toString(),costs_minor:value.costs.toString(),net_margin_minor:complete?(value.gross-value.refunds-value.costs).toString():null,known_net_margin_minor:(value.gross-value.refunds-value.costs).toString()}]));
    return {experiment_id:exp.id,version:exp.version,source_digest:contentDigest(lineage.sort()),denominators:exp.denominators,starts_at:exp.starts_at,ends_at:exp.ends_at,attribution_window_ms:exp.attribution_window_ms,followup_through_at:exp.followup_through_at,
      purchases,attributed_revenue_minor:attributed.toString(),attribution_rule:'last_eligible_touch_one_conversion_per_native_purchase',attribution,
      holdout_estimated_incremental_revenue_minor: incremental,incremental_margin_minor:complete?(tMargin-BigInt(marginReference!.money.minor)).toString():null,
      holdout_scaling:{rounding:'half_even',revenue_residue:revenueReference?.residue??null,margin_residue:marginReference?.residue??null},
      gross_revenue_minor:(t.gross+h.gross).toString(),refunds_minor:(t.refunds+h.refunds).toString(),costs_minor:(t.costs+h.costs).toString(),net_margin_minor:complete?(tMargin+hMargin).toString():null,known_net_margin_minor:(tMargin+hMargin).toString(),arms:outputArms,
      incomplete_units:incomplete.size,unavailable_units:unavailable,metrics_complete:complete,contaminated_units:contaminated,estimate_status:!complete?'incomplete_followup':contaminated?'contaminated_synthetic_estimate':'randomized_synthetic_estimate',
      uncertainty:{method:'conservative_difference_of_wilson_intervals',confidence:0.95,conversion_rate_difference_interval:a&&b?[a[0]-b[1],a[1]-b[0]]:null,margin_uncertainty:'not_estimated',small_cohort_warning:t.denominator<30||h.denominator<30},
      clean_causal_lift:false,automatic_promotion:false,qualification:'synthetic_only',connected_qualified:false,execution_authorized:false};
  }
}
