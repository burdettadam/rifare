import { exact,id,integer,token } from './kernel.mts';
import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { permissionDecision } from './authorization.mts';
import { DemandHistory } from './demand-history.mts';
import { ForecastBacktests } from './forecast-backtests.mts';
import { FORECAST_DAY,forecastHash,forecastHorizon,forecastMember,forecastMemberKey,forecastCatalog,forecastBody,forecastStored,buildDemandSeries,forecastPrediction } from './forecast-core.mts';

function currentMember(k:CommerceKernel,s:Row,actor:string,action:string,resource:string) {
  const member=k.db.prepare('SELECT * FROM commerce_members WHERE tenant_id=? AND store_id=? AND actor_id=? AND active=1').get(s.tenant_id,s.store_id,actor) as Row|undefined;
  return member?permissionDecision(k.db,member,action,resource):null;
}
export class InventoryForecasts {
  readonly k:CommerceKernel;
  constructor(k:CommerceKernel){this.k=k;}
  create(scope:Scope,value:unknown) {
    const p=exact(jsonValue(value),['forecast_id','backtest_id','expected_digest','resource_id','variant_id','location_id','unit','horizon_days']);id(p.forecast_id);id(p.backtest_id);forecastHash(p.expected_digest);forecastHorizon(p.horizon_days);
    const member=forecastMember({resource_id:p.resource_id,variant_id:p.variant_id,location_id:p.location_id,unit:p.unit}),k=this.k,s=k.authorize(scope,'action.propose',member.resource_id),pin=forecastCatalog(k,scope,member,'action.propose');
    return k.transaction(()=>{
      const evaluation=new ForecastBacktests(k).read(scope,p.backtest_id),plan=evaluation.plan;
      if(evaluation.state!=='evaluated'||evaluation.digest!==p.expected_digest)throw new Error('FORECAST_BACKTEST_CHANGED');
      if(!plan.horizons.includes(p.horizon_days)||!plan.cohort.some((item:Row)=>forecastMemberKey(item as any)===forecastMemberKey(member)))throw new Error('FORECAST_SCOPE_UNEVALUATED');
      const snapshot=new DemandHistory(k).read(scope,plan.dataset_id);if(snapshot.digest!==plan.dataset_digest)throw new Error('DEMAND_SNAPSHOT_CHANGED');
      const key=forecastMemberKey(member),candidate=evaluation.metrics.find((m:Row)=>m.cohort_key===key&&m.horizon_days===p.horizon_days&&m.method===plan.method),baseline=evaluation.metrics.find((m:Row)=>m.cohort_key===key&&m.horizon_days===p.horizon_days&&m.method===plan.reference_baseline);
      if(!candidate||!baseline)throw new Error('FORECAST_SCOPE_UNEVALUATED');
      const train=buildDemandSeries(snapshot,member,snapshot.window_start,snapshot.window_end,snapshot.cutoff),known=train.filter(row=>!row.missing&&!row.stockout),censored=train.filter(row=>row.stockout).length;
      const improvement = candidate.mae !== null && baseline.mae !== null && candidate.mae < baseline.mae;
      const chosen=improvement?plan.method:plan.reference_baseline,prediction=forecastPrediction(chosen,train,p.horizon_days),selectedMetric=improvement?candidate:baseline;
      const limitations:string[]=[];
      if(known.length<4)limitations.push('insufficient_uncensored_history');
      if(censored/train.length>=0.5)limitations.push('heavily_censored_history');
      if(train.some(row=>row.missing))limitations.push('missing_historical_days');
      if(censored)limitations.push('stockout_sales_are_only_lower_bounds');
      if(prediction===null)limitations.push('recent_training_unavailable');
      if(candidate.scored_count<2||baseline.scored_count<2||candidate.unscored_count!==0||baseline.unscored_count!==0)limitations.push('incomplete_scoped_backtest');
      const unsupported=known.length<4||censored/train.length>=0.5||train.some(row=>row.missing)||prediction===null||candidate.scored_count<2||baseline.scored_count<2||candidate.unscored_count!==0||baseline.unscored_count!==0;
      const residuals=evaluation.cells.filter((cell:Row)=>forecastMemberKey(cell as any)===key&&cell.horizon_days===p.horizon_days&&cell.actual_units!==null&&cell.predictions[chosen]!==null).map((cell:Row)=>Math.abs(cell.predictions[chosen]-cell.actual_units));
      const radius=residuals.length?Math.max(...residuals):null;
      const body={...member,horizon_days:p.horizon_days,as_of:snapshot.window_end,valid_until:snapshot.window_end+p.horizon_days*FORECAST_DAY,
        source_window:{start_at:snapshot.window_start,end_at:snapshot.window_end,cutoff:snapshot.cutoff},dataset_id:snapshot.id,dataset_digest:snapshot.digest,backtest_id:evaluation.id,backtest_digest:evaluation.digest,
        method:chosen,requested_method:plan.method,baseline:plan.reference_baseline,method_version:chosen,baseline_versions:plan.baseline_versions,
        quantity:unsupported?null:Math.ceil(prediction!),lower_units:unsupported?null:Math.max(0,Math.floor(prediction!-radius!)),upper_units:unsupported?null:Math.ceil(prediction!+radius!),
        quality:unsupported?'unsupported':improvement?'evaluated':'baseline_fallback',improvement_claim:!unsupported&&improvement,
        comparison:{candidate,baseline,selected_method:chosen,selection_rule:'strictly_lower_scoped_mae_with_complete_identical_cells'},
        uncertainty:{kind:'historical_absolute_error_envelope',sample_count:residuals.length,maximum_absolute_error:radius,confidence_level:null,probabilistic_coverage_qualified:false,
          limitations:['empirical_residuals_do_not_guarantee_future_coverage','uncertainty_excludes_unobserved_stockout_demand']},
        limitations,history_declared_days:train.length,history_known_days:known.length,censored_days:censored,catalog_pin:pin,proposed_by:s.actor_id,
        proposer_authority_revision:permissionDecision(k.db,s,'action.propose',member.resource_id).authority_revision,
        qualification:'synthetic_local_only',external_qualified:false,execution_authorized:false};
      if(k.db.prepare('SELECT 1 FROM commerce_inventory_forecasts WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,p.forecast_id))throw new Error('FORECAST_IMMUTABLE');
      k.db.prepare('INSERT INTO commerce_inventory_forecasts VALUES(?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,p.forecast_id,member.resource_id,'proposed',canonical(body),contentDigest(body));return this.read(scope,p.forecast_id);
    });
  }
  read(scope:Scope,ref:string) {
    const row=forecastStored(this.k,scope,'commerce_inventory_forecasts',ref),b=row.body;
    forecastCatalog(this.k,scope,forecastMember({resource_id:row.resource_id,variant_id:b.variant_id,location_id:b.location_id,unit:b.unit}));
    if(b.resource_id!==row.resource_id)throw new Error('FORECAST_RECORD_INTEGRITY');return {id:row.id,...b,digest:row.digest};
  }
  #current(scope:Scope,forecast:Row) {
    const member=forecastMember({resource_id:forecast.resource_id,variant_id:forecast.variant_id,location_id:forecast.location_id,unit:forecast.unit});
    if(contentDigest(forecastCatalog(this.k,scope,member))!==contentDigest(forecast.catalog_pin))throw new Error('FORECAST_CATALOG_CHANGED');
    if(forecast.quality==='unsupported'||forecast.quantity===null)throw new Error('FORECAST_UNSUPPORTED');
    if(forecast.valid_until<=this.k.clock())throw new Error('FORECAST_EXPIRED');
    const s=this.k.require(scope),author=currentMember(this.k,s,forecast.proposed_by,'action.propose',forecast.resource_id);
    if(!author?.allowed||author.authority_revision!==forecast.proposer_authority_revision)throw new Error('FORECAST_AUTHOR_AUTHORITY_CHANGED');
    const data=new DemandHistory(this.k).read(scope,forecast.dataset_id),evaluation=new ForecastBacktests(this.k).read(scope,forecast.backtest_id);
    if(data.digest!==forecast.dataset_digest||evaluation.digest!==forecast.backtest_digest)throw new Error('FORECAST_BACKTEST_CHANGED');return forecast;
  }
  approve(scope:Scope,value:unknown) {
    const p=exact(jsonValue(value),['forecast_id','expected_digest','expires_at']);id(p.forecast_id);forecastHash(p.expected_digest);integer(p.expires_at);
    const k=this.k;
    return k.transaction(()=>{
      const forecast=this.read(scope,p.forecast_id),s=k.authorize(scope,'action.approve',forecast.resource_id);
      if(forecast.digest!==p.expected_digest)throw new Error('FORECAST_CHANGED');this.#current(scope,forecast);
      if(s.actor_id===forecast.proposed_by)throw new Error('SELF_APPROVAL_DENIED');if(p.expires_at<=k.clock()||p.expires_at>forecast.valid_until)throw new Error('FORECAST_REVIEW_EXPIRED');
      const ref='forecast_review_'+token().slice(0,32),body={forecast_id:forecast.id,forecast_digest:forecast.digest,reviewer:s.actor_id,
        reviewer_authority_revision:permissionDecision(k.db,s,'action.approve',forecast.resource_id).authority_revision,expires_at:p.expires_at,reviewed_at:k.clock(),scope_digest:contentDigest({resource_id:forecast.resource_id,variant_id:forecast.variant_id,location_id:forecast.location_id,unit:forecast.unit,horizon_days:forecast.horizon_days}),replay_allowed:false};
      k.db.prepare('INSERT INTO commerce_forecast_reviews VALUES(?,?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,ref,forecast.resource_id,forecast.id,'approved',canonical(body),contentDigest(body));return {id:ref,digest:contentDigest(body),expires_at:p.expires_at};
    });
  }
  assertReviewed(scope:Scope,value:unknown) {
    const p=exact(jsonValue(value),['forecast_id','expected_digest']);id(p.forecast_id);forecastHash(p.expected_digest);
    const forecast=this.read(scope,p.forecast_id);if(forecast.digest!==p.expected_digest)throw new Error('FORECAST_CHANGED');
    const k=this.k,s=k.require(scope),rows=(k.db.prepare("SELECT * FROM commerce_forecast_reviews WHERE tenant_id=? AND store_id=? AND forecast_id=? AND state='approved'").all(s.tenant_id,s.store_id,forecast.id) as Row[])
      .map(row=>({...row,body:forecastBody(row)})).filter(row=>row.body.forecast_id===forecast.id&&row.body.forecast_digest===forecast.digest).sort((a,b)=>b.body.expires_at-a.body.expires_at);
    const approval=rows[0];if(!approval)throw new Error('FORECAST_REVIEW_REQUIRED');this.#current(scope,forecast);
    if(approval.body.expires_at<=k.clock())throw new Error('FORECAST_REVIEW_EXPIRED');
    const reviewer=currentMember(k,s,approval.body.reviewer,'action.approve',forecast.resource_id);
    if(!reviewer?.allowed||reviewer.authority_revision!==approval.body.reviewer_authority_revision||approval.body.reviewer===forecast.proposed_by)throw new Error('FORECAST_REVIEW_AUTHORITY_CHANGED');
    const stamp=contentDigest({resource_id:forecast.resource_id,variant_id:forecast.variant_id,location_id:forecast.location_id,unit:forecast.unit,horizon_days:forecast.horizon_days});
    if(approval.resource_id!==forecast.resource_id||approval.body.scope_digest!==stamp)throw new Error('FORECAST_REVIEW_SCOPE_CHANGED');
    return {...forecast,expires_at:approval.body.expires_at,approval_id:approval.id,approval_digest:approval.digest};
  }
  inspect(scope:Scope,ref:string) {
    const forecast=this.read(scope,ref);try{return {...this.assertReviewed(scope,{forecast_id:ref,expected_digest:forecast.digest}),review_current:true,reasons:[]};}
    catch(error){return {...forecast,review_current:false,reasons:[(error as Error).message],execution_authorized:false};}
  }
  revoke(scope:Scope,reviewId:string) {
    const row=forecastStored(this.k,scope,'commerce_forecast_reviews',id(reviewId)),s=this.k.authorize(scope,'action.approve',row.resource_id);
    this.k.db.prepare("UPDATE commerce_forecast_reviews SET state='revoked' WHERE tenant_id=? AND store_id=? AND id=?").run(s.tenant_id,s.store_id,row.id);return {id:row.id,state:'revoked'};
  }
}
