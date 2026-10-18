import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { commerceFixture } from './commerce-helpers.mts';
import { DemandFixtureSource } from '../../packages/adapters/demand-fixture-source.mts';
import { DemandHistory } from '../../packages/commerce/demand-history.mts';
import { ForecastBacktests } from '../../packages/commerce/forecast-backtests.mts';
import { InventoryForecasts } from '../../packages/commerce/inventory-forecasts.mts';
import type { CommerceKernel, Scope, Row } from '../../packages/commerce/kernel.mts';

export const DEMAND_DAY = 86400000;
export const demandOracle = JSON.parse(readFileSync(new URL('../fixtures/demand-planning/known-answer.v1.json',import.meta.url),'utf8'));
export function demandFixture(options: {censored?:boolean;short?:boolean} = {}) {
  const f=commerceFixture(),k=f.kernel;
  k.provisionMember(f.a.tenant,f.a.store,'forecast-owner','owner');
  k.provisionMember(f.a.tenant,f.a.store,'forecast-reviewer','reviewer');
  const owner=k.authenticate(k.issueSession(f.a.tenant,f.a.store,'forecast-owner'));
  const reviewer=k.authenticate(k.issueSession(f.a.tenant,f.a.store,'forecast-reviewer'));
  const end=Math.floor(f.now()/DEMAND_DAY)*DEMAND_DAY-DEMAND_DAY,day=(n:number)=>end+(n-8)*DEMAND_DAY;
  let archiveNow=day(1);
  const sourceDb=new DatabaseSync(':memory:'),source=new DemandFixtureSource(sourceDb,{mode:'fixture',identity:'demand-source',tenant:f.a.tenant,store:f.a.store},()=>archiveNow);
  const cohort=Object.keys(demandOracle.series).map((name,index)=>{
    const resource=k.ingest(f.a.scope,{kind:'catalog',source_system:'synthetic',external_id:'demand-'+name,source_version:1,source_updated_at:f.now(),customer_id:null,
      payload:{variants:[{id:'sku-'+name,unit:'each'}],name:'Synthetic demand '+index}});
    return {resource_id:resource.id,variant_id:'sku-'+name,location_id:'location-a',unit:'each'};
  });
  function observe(member:Row,n:number,units:number,version=1,extra:Row={}) {
    return source.observe({observation_id:member.variant_id+'-'+n,revision:version,resource_id:member.resource_id,variant_id:member.variant_id,
      location_id:member.location_id,unit:'each',event_at:day(n),available_at:archiveNow,sales_units:units,cancellation_units:0,return_units:0,
      stockout:false,missing:false,...extra});
  }
  for(let n=1;n<=8;n++) {
    archiveNow=day(n);
    if(options.short&&n<7)continue;
    for(const member of cohort) {
      const name=member.variant_id.slice(4),units=demandOracle.series[name][n-1];
      observe(member,n,units,1,{stockout:!!options.censored&&name==='alternating'&&n>=5});
    }
  }
  const history=new DemandHistory(k),backtests=new ForecastBacktests(k),forecasts=new InventoryForecasts(k);
  history.sync(f.a.scope,source);
  function snapshot(ref='snapshot-one',cutoff=day(8),members=cohort) {return history.snapshot(f.a.scope,{snapshot_id:ref,cutoff,window_start:day(1),window_end:day(8),cohort:members});}
  function evaluate(ref='evaluation-one',snapshotRef='snapshot-one',method='mean_2_v1') {
    const snap=history.read(f.a.scope,snapshotRef);
    const plan=backtests.declare(f.a.scope,{evaluation_id:ref,dataset_id:snapshotRef,expected_digest:snap.digest,
      origins:[day(4),day(6)],horizons:[1,2],method,reference_baseline:'seasonal_2_v1',tuning_cutoff:day(3)});
    return backtests.evaluate(f.a.scope,{evaluation_id:ref,expected_plan_digest:plan.plan_digest});
  }
  function forecast(ref='forecast-one',index=0,horizon=2,evaluation='evaluation-one') {
    const backtest=backtests.read(f.a.scope,evaluation);
    return forecasts.create(f.a.scope,{forecast_id:ref,backtest_id:evaluation,expected_digest:backtest.digest,...cohort[index],horizon_days:horizon});
  }
  function lateCorrection() {archiveNow=day(9);observe(cohort[0],2,99,2);history.sync(f.a.scope,source);}
  return {...f,sourceDb,source,history,backtests,forecasts,cohort,owner,reviewer,day,observe,snapshot,evaluate,forecast,lateCorrection,
    archiveTime:(value:number)=>{archiveNow=value;},cleanup:()=>{sourceDb.close();f.cleanup();}};
}
export async function usingDemand(fn:(f:ReturnType<typeof demandFixture>)=>unknown,options:{censored?:boolean;short?:boolean}={}) {
  const f=demandFixture(options);try{return await fn(f);}finally{f.cleanup();}
}
export async function demandMutant(relative:string,name:string,marker:string,replacement:string,fn:(Broken:any)=>unknown) {
  const original=new URL(relative,import.meta.url),source=readFileSync(original,'utf8');
  assert.equal(source.split(marker).length-1,1,'one exact real implementation mutation');
  const directory=mkdtempSync(join(tmpdir(),'rifare-forecast-fault-')),target=join(directory,'mutant.mts');
  const changed=source.replace(marker,replacement).replace(/from '(\.[^']+)'/g,(_match,path)=>"from '"+new URL(path,original).href+"'");
  writeFileSync(target,changed,{flag:'wx'});
  try {const module=await import(pathToFileURL(target).href);assert.equal(typeof module[name],'function');await fn(module[name]);}
  finally {rmSync(directory,{recursive:true,force:true});}
}

/** Synthetic archived source observations, native canonical records and current
 * independent review for cross-area tests. No caller-supplied forecast result. */
export function installReviewedForecast(k:CommerceKernel,scope:Scope,reviewer:Scope,options:{resource_id:string;variant_id:string;location_id:string;forecast_id?:string;daily_units?:number;horizon_days?:number}) {
  const s=k.require(scope),end=Math.floor(k.clock()/DEMAND_DAY)*DEMAND_DAY;
  let observed=end-9*DEMAND_DAY;
  const sourceDb=new DatabaseSync(':memory:'),source=new DemandFixtureSource(sourceDb,{mode:'fixture',identity:'demand-'+randomUUID(),tenant:s.tenant_id,store:s.store_id},()=>observed);
  const forecastId=options.forecast_id??'forecast-'+randomUUID(),member={resource_id:options.resource_id,variant_id:options.variant_id,location_id:options.location_id,unit:'each'};
  const horizon=options.horizon_days??2;
  for(let n=0;n<10;n++) {observed=end+(n-9)*DEMAND_DAY;source.observe({observation_id:'day-'+n,revision:1,...member,event_at:observed,available_at:observed,
    sales_units:options.daily_units??4,cancellation_units:0,return_units:0,stockout:false,missing:false});}
  const history=new DemandHistory(k),backtests=new ForecastBacktests(k),forecasts=new InventoryForecasts(k);
  history.sync(scope,source);
  const snapshot=history.snapshot(scope,{snapshot_id:forecastId+'-data',cutoff:end,window_start:end-9*DEMAND_DAY,window_end:end,cohort:[member]});
  const plan=backtests.declare(scope,{evaluation_id:forecastId+'-backtest',dataset_id:snapshot.id,expected_digest:snapshot.digest,
    origins:[end-(horizon+2)*DEMAND_DAY,end-horizon*DEMAND_DAY],horizons:[horizon],method:'mean_2_v1',reference_baseline:'seasonal_2_v1',tuning_cutoff:end-(horizon+3)*DEMAND_DAY});
  const result=backtests.evaluate(scope,{evaluation_id:plan.id,expected_plan_digest:plan.plan_digest});
  const forecast=forecasts.create(scope,{forecast_id:forecastId,backtest_id:result.id,expected_digest:result.digest,...member,horizon_days:horizon});
  forecasts.approve(reviewer,{forecast_id:forecast.id,expected_digest:forecast.digest,expires_at:Math.min(k.clock()+600000,forecast.valid_until)});
  return {forecast:forecasts.assertReviewed(scope,{forecast_id:forecast.id,expected_digest:forecast.digest}),forecasts,history,backtests,source,sourceDb,close:()=>sourceDb.close()};
}

export function populateForecastPrivacy(f:ReturnType<typeof demandFixture>) {
  f.snapshot();f.evaluate();const forecast=f.forecast();
  const review=f.forecasts.approve(f.reviewer,{forecast_id:forecast.id,expected_digest:forecast.digest,expires_at:f.now()+60000});
  return {tables:['commerce_demand_observations','commerce_demand_snapshots','commerce_forecast_backtests','commerce_inventory_forecasts','commerce_forecast_reviews'],
    subject_tables:[],forecast_id:forecast.id,forecast_digest:forecast.digest,review_id:review.id,resource_id:forecast.resource_id,
    customer_id:null,forecast_service:f.forecasts,owner_scope:f.owner,reviewer_scope:f.reviewer};
}
