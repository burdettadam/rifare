import { exact,id } from './kernel.mts';
import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { DemandHistory } from './demand-history.mts';
import { FORECAST_DAY,FORECAST_BASELINES,FORECAST_METHODS,forecastHash,forecastDay,forecastHorizon,forecastMemberKey,forecastCohort,forecastStored,buildDemandSeries,forecastPrediction } from './forecast-core.mts';

function metric(cells:Row[],method:string,horizon:number,cohortKey:string,item:Row|null) {
  const declared=cells.filter(row=>row.horizon_days===horizon&&(cohortKey==='all'||forecastMemberKey(row as any)===cohortKey));
  const scored=declared.filter(row=>row.actual_units!==null&&row.predictions[method]!==null),error=scored.map(row=>row.predictions[method]-row.actual_units);
  const actual=scored.reduce((sum,row)=>sum+row.actual_units,0),absolute=error.reduce((sum,e)=>sum+Math.abs(e),0),signed=error.reduce((sum,e)=>sum+e,0),under=error.reduce((sum,e)=>sum+Math.max(0,-e),0),over=error.reduce((sum,e)=>sum+Math.max(0,e),0);
  return {cohort_key:cohortKey,resource_id:item?.resource_id??null,variant_id:item?.variant_id??null,location_id:item?.location_id??null,
    horizon_days:horizon,method,declared_count:declared.length,scored_count:scored.length,unscored_count:declared.length-scored.length,
    actual_units:actual,absolute_error:absolute,signed_error:signed,under_units:under,over_units:over,
    mae:scored.length?absolute/scored.length:null,wape:actual?absolute/actual:null,relative_bias:actual?signed/actual:null,
    service_rate:actual?(actual-under)/actual:null,denominator_reason:!scored.length?'no_scored_cells':!actual?'zero_actual_units':null,
    service_interpretation:'counterfactual_units_covered_by_forecast_without_inventory_or_lead_time_effects'};
}
export class ForecastBacktests {
  readonly k:CommerceKernel;
  constructor(k:CommerceKernel){this.k=k;}
  declare(scope:Scope,value:unknown) {
    const p=exact(jsonValue(value),['evaluation_id','dataset_id','expected_digest','origins','horizons','method','reference_baseline','tuning_cutoff']);id(p.evaluation_id);id(p.dataset_id);forecastHash(p.expected_digest);
    const k=this.k,s=k.require(scope),snapshot=new DemandHistory(k).read(scope,p.dataset_id),cohort=forecastCohort(k,scope,snapshot.cohort,'action.propose');
    if(snapshot.digest!==p.expected_digest)throw new Error('DEMAND_SNAPSHOT_CHANGED');
    if(!FORECAST_METHODS.includes(p.method)||!FORECAST_BASELINES.includes(p.reference_baseline))throw new Error('FORECAST_METHOD_UNSUPPORTED');
    if(!Array.isArray(p.origins)||p.origins.length<1||p.origins.length>8||new Set(p.origins).size!==p.origins.length||!Array.isArray(p.horizons)||p.horizons.length<1||p.horizons.length>3||new Set(p.horizons).size!==p.horizons.length)throw new Error('INVALID_INPUT');
    p.origins.forEach(forecastDay);p.horizons.forEach(forecastHorizon);forecastDay(p.tuning_cutoff);
    const origins=[...p.origins].sort((a,b)=>a-b),horizons=[...p.horizons].sort((a,b)=>a-b);
    if(canonical(origins)!==canonical(p.origins)||canonical(horizons)!==canonical(p.horizons)||p.tuning_cutoff>=origins[0]||p.tuning_cutoff<snapshot.window_start||origins[0]<snapshot.window_start||origins.at(-1)+horizons.at(-1)*FORECAST_DAY>snapshot.window_end)throw new Error('EVALUATION_CONTAMINATED');
    const plan={dataset_id:snapshot.id,dataset_digest:snapshot.digest,window_start:snapshot.window_start,window_end:snapshot.window_end,cutoff:snapshot.cutoff,
      cohort,origins,horizons,method:p.method,reference_baseline:p.reference_baseline,baseline_versions:[...FORECAST_BASELINES],tuning_cutoff:p.tuning_cutoff,
      split:'rolling_temporal_v1',cohort_policy:'all_predeclared_members_retained',metric_version:'absolute_signed_and_service_v1',
      method_version:p.method,created_by:s.actor_id,qualified_real_demand:false};
    return k.transaction(()=>{
      if(k.db.prepare('SELECT 1 FROM commerce_forecast_backtests WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,p.evaluation_id))throw new Error('EVALUATION_PLAN_IMMUTABLE');
      const body={plan,plan_digest:contentDigest(plan),cells:[],metrics:[],qualification:'synthetic_local_only',external_qualified:false};
      k.db.prepare('INSERT INTO commerce_forecast_backtests VALUES(?,?,?,?,?,?)').run(s.tenant_id,s.store_id,p.evaluation_id,'declared',canonical(body),contentDigest(body));return this.read(scope,p.evaluation_id);
    });
  }
  read(scope:Scope,ref:string) {
    const row=forecastStored(this.k,scope,'commerce_forecast_backtests',ref),body=row.body;
    if(contentDigest(body.plan)!==body.plan_digest)throw new Error('EVALUATION_PLAN_INTEGRITY');forecastCohort(this.k,scope,body.plan.cohort);
    return {id:row.id,state:row.state,...body,digest:row.digest};
  }
  evaluate(scope:Scope,value:unknown) {
    const request=exact(jsonValue(value),['evaluation_id','expected_plan_digest']);id(request.evaluation_id);forecastHash(request.expected_plan_digest);
    const k=this.k,s=k.require(scope);
    return k.transaction(()=>{
      const row=this.read(scope,request.evaluation_id),p=row.plan;
      forecastCohort(k,scope,p.cohort,'action.propose');if(row.plan_digest!==request.expected_plan_digest)throw new Error('EVALUATION_PLAN_CHANGED');
      if(row.state==='evaluated')return row;
      const snapshot=new DemandHistory(k).read(scope,p.dataset_id);if(snapshot.digest!==p.dataset_digest)throw new Error('DEMAND_SNAPSHOT_CHANGED');
      const cells:Row[]=[],methods=[...FORECAST_BASELINES,p.method];
      for(const item of p.cohort)for(const origin of p.origins) {
        const train = buildDemandSeries(snapshot, item, p.window_start, origin, origin);
        for(const horizon of p.horizons) {
          const holdout=buildDemandSeries(snapshot,item,origin+FORECAST_DAY,origin+horizon*FORECAST_DAY,snapshot.cutoff);
          const unavailable=holdout.some(row=>row.missing||row.stockout||row.demand_units===null),actual=unavailable?null:holdout.reduce((sum,row)=>sum+row.demand_units,0);
          const observed=train.filter(row=>row.observed_at!==null),known=train.filter(row=>!row.missing&&!row.stockout),predictions=Object.fromEntries(methods.map(method=>[method,forecastPrediction(method,train,horizon)]));
          cells.push({...item,origin,horizon_days:horizon,training_window:{start_at:p.window_start,end_at:origin},holdout_window:{start_at:origin+FORECAST_DAY,end_at:origin+horizon*FORECAST_DAY},
            training_max_event_at:observed.length?Math.max(...observed.map(row=>row.event_at)):null,training_max_observed_at:observed.length?Math.max(...observed.map(row=>row.observed_at)):null,
            training_declared_days:train.length,training_known_days:known.length,holdout_declared_days:holdout.length,actual_units:actual,predictions,
            observation_digests:observed.map(row=>row.observation_digest),holdout_digests:holdout.map(row=>row.observation_digest),
            unscored_reasons:[...(unavailable?['missing_or_censored_holdout']:[]),...(Object.values(predictions).some(value=>value===null)?['insufficient_or_censored_training']:[])]});
        }
      }
      const metrics:Row[]=[];
      for(const horizon of p.horizons)for(const method of methods) {
        metrics.push(metric(cells,method,horizon,'all',null));for(const item of p.cohort)metrics.push(metric(cells,method,horizon,forecastMemberKey(item),item));
      }
      const body={plan:p,plan_digest:row.plan_digest,cells,metrics,qualification:'synthetic_local_only',external_qualified:false};
      k.db.prepare("UPDATE commerce_forecast_backtests SET state='evaluated',body=?,digest=? WHERE tenant_id=? AND store_id=? AND id=? AND state='declared'").run(canonical(body),contentDigest(body),s.tenant_id,s.store_id,row.id);
      return this.read(scope,row.id);
    });
  }
}
