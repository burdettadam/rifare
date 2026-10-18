import test from 'node:test';
import assert from 'node:assert/strict';
import { usingDemand,demandOracle,demandMutant } from './demand-planning-helpers.mts';
import { Permissions } from '../../packages/commerce/authorization.mts';
import { contentDigest } from '../../packages/commerce/configuration-values.mts';
import { revokeForecastsForRestore,exportForecastSubject,eraseForecastSubject } from '../../packages/commerce/forecast-privacy.mts';

test('CASE-M11-G01-01',()=>usingDemand(f=>{
  const result=f.snapshot(),row=result.series.find((r:any)=>r.variant_id==='sku-alternating'&&r.event_at===f.day(2));
  assert.equal(row.demand_units,4);assert.equal(result.cohort.length,3);assert.equal(result.series.length,24);
  assert.equal(result.series.reduce((n:number,r:any)=>n+r.demand_units,0),36);
  assert.equal(result.series.filter((r:any)=>r.variant_id==='sku-zero').every((r:any)=>r.demand_units===0&&!r.missing),true);
  assert.equal(result.source_provenance[0].source_identity,'demand-source');assert.equal(result.qualification,'synthetic_local_only');
  f.archiveTime(f.day(8));f.observe(f.cohort[0],2,8,2,{cancellation_units:2,return_units:1});f.history.sync(f.a.scope,f.source);
  const adjusted=f.snapshot('corrected');const value=adjusted.series.find((r:any)=>r.variant_id==='sku-alternating'&&r.event_at===f.day(2));
  assert.equal(value.demand_units,6);assert.equal(value.retained_units,5);assert.equal(value.return_units,1);
  assert.equal(f.history.read(f.a.scope,result.id).digest,result.digest);assert.throws(()=>f.history.read(f.b.scope,result.id),/NOT_FOUND/);
}));
test('CASE-M11-G01-02',()=>usingDemand(f=>{
  f.lateCorrection();const snapshot=f.snapshot();assert.equal(snapshot.series.find((r:any)=>r.variant_id==='sku-alternating'&&r.event_at===f.day(2)).demand_units,4);
  const future=f.history.observations(f.a.scope,f.cohort[0].resource_id).find((r:any)=>r.observation_id==='sku-alternating-2'&&r.revision===2);
  assert.throws(()=>f.history.validateTraining(f.a.scope,{snapshot_id:snapshot.id,expected_digest:snapshot.digest,forecast_at:f.day(4),horizon_days:2,observation_ids:[future.id]}),/DEMAND_TEMPORAL_LEAKAGE/);
  assert.throws(()=>f.source.observe({observation_id:'future-receipt',revision:1,...f.cohort[0],event_at:f.day(10),available_at:f.day(9),sales_units:1,cancellation_units:0,return_units:0,stockout:false,missing:false}),/DEMAND_FUTURE_EVENT/);
}));
test('CASE-M11-G01-03',async()=>{
  await usingDemand(f=>{const first=f.snapshot();f.lateCorrection();const again=f.snapshot('rebuilt');assert.deepEqual(again.series,first.series);assert.deepEqual(again.observation_digests,first.observation_digests);assert.equal(f.history.read(f.a.scope,first.id).digest,first.digest);});
  await demandMutant('../../packages/commerce/demand-history.mts','DemandHistory',
    'const visible = all.filter(o => o.event_at <= p.cutoff && o.available_at <= p.cutoff && o.observed_at <= p.cutoff);',
    'const visible = all.filter(o => o.event_at <= p.cutoff);',Broken=>usingDemand(f=>{
      f.lateCorrection();const value=new Broken(f.kernel).snapshot(f.a.scope,{snapshot_id:'broken-history',cutoff:f.day(8),window_start:f.day(1),window_end:f.day(8),cohort:f.cohort});
      const observed=value.series.find((r:any)=>r.variant_id==='sku-alternating'&&r.event_at===f.day(2)).demand_units;
      assert.equal(observed,99);assert.throws(()=>assert.equal(observed,demandOracle.temporal_correction.original_day_2),assert.AssertionError);
    }));
});
test('CASE-M11-G02-01',()=>usingDemand(f=>{
  f.snapshot();const result=f.evaluate();assert.equal(result.plan.cohort.length,3);assert.deepEqual(result.plan.baseline_versions,demandOracle.baseline_versions);
  for(const horizon of [1,2]) {
    const expected=demandOracle['horizon_'+horizon],actual=result.metrics.filter((r:any)=>r.horizon_days===horizon&&r.cohort_key==='all');
    for(const metric of actual) {const oracle=expected[metric.method];assert.equal(metric.declared_count,6);assert.equal(metric.scored_count,6);assert.equal(metric.unscored_count,0);
      assert.equal(metric.actual_units,expected.actual_units);for(const key of ['absolute_error','signed_error','under_units','over_units'])assert.equal(metric[key],oracle[key]);
      assert.equal(metric.mae,oracle.absolute_error/6);assert.equal(metric.relative_bias,oracle.signed_error/expected.actual_units);assert.equal(metric.wape,oracle.absolute_error/expected.actual_units);}
  }
  assert.equal(result.cells.length,12);assert.equal(result.cells.every((r:any)=>r.training_max_event_at<=r.origin&&r.training_max_observed_at<=r.origin),true);
  const first=result.cells.find((r:any)=>r.variant_id==='sku-alternating'&&r.origin===f.day(4)&&r.horizon_days===1);
  assert.deepEqual(first.predictions,{last_value_v1:4,mean_2_v1:3,seasonal_2_v1:2});
}));
test('CASE-M11-G02-02',()=>usingDemand(f=>{
  const snapshot=f.snapshot();const input={evaluation_id:'contaminated',dataset_id:snapshot.id,expected_digest:snapshot.digest,origins:[f.day(4),f.day(6)],horizons:[1,2],method:'mean_2_v1',reference_baseline:'seasonal_2_v1',tuning_cutoff:f.day(5)};
  assert.throws(()=>f.backtests.declare(f.a.scope,input),/EVALUATION_CONTAMINATED/);
  const plan=f.backtests.declare(f.a.scope,{...input,tuning_cutoff:f.day(3)});
  assert.throws(()=>f.backtests.evaluate(f.a.scope,{evaluation_id:plan.id,expected_plan_digest:plan.plan_digest,cohort:[f.cohort[0]]}),/INVALID_INPUT/);
  const result=f.backtests.evaluate(f.a.scope,{evaluation_id:plan.id,expected_plan_digest:plan.plan_digest});
  assert.equal(result.plan.cohort.length,3);assert.ok(result.cells.some((r:any)=>r.variant_id==='sku-difficult'));assert.ok(result.cells.some((r:any)=>r.variant_id==='sku-zero'));
}));
test('CASE-M11-G02-03',async()=>{
  await usingDemand(f=>{f.snapshot();const old=f.evaluate(),next=f.evaluate('method-two','snapshot-one','mean_3_v1');assert.equal(f.backtests.read(f.a.scope,old.id).digest,old.digest);assert.deepEqual(next.plan.origins,old.plan.origins);assert.deepEqual(next.plan.baseline_versions,old.plan.baseline_versions);assert.notEqual(next.plan.method,old.plan.method);});
  await demandMutant('../../packages/commerce/forecast-backtests.mts','ForecastBacktests',
    'const train = buildDemandSeries(snapshot, item, p.window_start, origin, origin);',
    'const train = buildDemandSeries(snapshot, item, p.window_start, snapshot.window_end, snapshot.cutoff).filter((_, index) => index % 2 === 0);',Broken=>usingDemand(f=>{
      const snapshot=f.snapshot(),broken=new Broken(f.kernel),plan=broken.declare(f.a.scope,{evaluation_id:'random-split',dataset_id:snapshot.id,expected_digest:snapshot.digest,origins:[f.day(4),f.day(6)],horizons:[1,2],method:'mean_2_v1',reference_baseline:'seasonal_2_v1',tuning_cutoff:f.day(3)});
      const result=broken.evaluate(f.a.scope,{evaluation_id:plan.id,expected_plan_digest:plan.plan_digest});
      assert.ok(result.cells.some((r:any)=>r.training_max_event_at>r.origin));
      assert.throws(()=>assert.ok(result.cells.every((r:any)=>r.training_max_event_at<=r.origin)),assert.AssertionError);
    }));
});
test('CASE-M11-G03-01',()=>usingDemand(f=>{
  f.snapshot();f.evaluate();const forecast=f.forecast(),expected=demandOracle.alternating_horizon_2;
  for(const key of ['quantity','lower_units','upper_units','improvement_claim','method'])assert.equal(forecast[key],expected[key]);
  assert.equal(forecast.source_window.end_at,f.day(8));assert.equal(forecast.horizon_days,2);assert.equal(forecast.uncertainty.sample_count,2);
  assert.equal(forecast.uncertainty.kind,'historical_absolute_error_envelope');assert.equal(forecast.uncertainty.confidence_level,null);
  assert.equal(forecast.dataset_digest.length,64);assert.equal(forecast.backtest_digest.length,64);assert.equal(forecast.execution_authorized,false);
  const approval=f.forecasts.approve(f.reviewer,{forecast_id:forecast.id,expected_digest:forecast.digest,expires_at:f.now()+60000});
  const reviewed=f.forecasts.assertReviewed(f.a.scope,{forecast_id:forecast.id,expected_digest:forecast.digest});assert.equal(reviewed.approval_id,approval.id);assert.equal(reviewed.quantity,6);
}));
test('CASE-M11-G03-02',async()=>{
  for(const options of [{censored:true},{short:true}]) await usingDemand(f=>{f.snapshot();f.evaluate();const forecast=f.forecast();
    assert.equal(forecast.quality,'unsupported');assert.equal(forecast.quantity,null);assert.equal(forecast.lower_units,null);assert.equal(forecast.upper_units,null);assert.equal(forecast.improvement_claim,false);
    assert.ok(forecast.limitations.length>0);assert.throws(()=>f.forecasts.approve(f.reviewer,{forecast_id:forecast.id,expected_digest:forecast.digest,expires_at:f.now()+60000}),/FORECAST_UNSUPPORTED/);
  },options);
});
test('CASE-M11-G03-03',async()=>{
  await usingDemand(f=>{f.snapshot();f.evaluate();const forecast=f.forecast('underperforming',0,1);assert.equal(forecast.improvement_claim,false);assert.equal(forecast.method,'seasonal_2_v1');assert.equal(forecast.comparison.candidate.mae,1);assert.equal(forecast.comparison.baseline.mae,0);});
  await demandMutant('../../packages/commerce/inventory-forecasts.mts','InventoryForecasts',
    'const improvement = candidate.mae !== null && baseline.mae !== null && candidate.mae < baseline.mae;',
    'const improvement = 0.99 >= 0.9;',Broken=>usingDemand(f=>{
      f.snapshot();const backtest=f.evaluate(),forecast=new Broken(f.kernel).create(f.a.scope,{forecast_id:'confidence-only',backtest_id:backtest.id,expected_digest:backtest.digest,...f.cohort[0],horizon_days:1});
      assert.equal(forecast.improvement_claim,true);assert.throws(()=>assert.equal(forecast.improvement_claim,demandOracle.alternating_horizon_1.improvement_claim),assert.AssertionError);
    }));
});
test('PORT-030',()=>usingDemand(f=>{
  const snapshot=f.snapshot(),records=f.history.observations(f.a.scope,f.cohort[0].resource_id),future=records.find((r:any)=>r.event_at===f.day(5));
  assert.throws(()=>f.history.validateTraining(f.a.scope,{snapshot_id:snapshot.id,expected_digest:snapshot.digest,forecast_at:f.day(4),horizon_days:2,observation_ids:[future.id]}),/DEMAND_TEMPORAL_LEAKAGE/);
  const earlier=records.filter((r:any)=>r.event_at<=f.day(4)).map((r:any)=>r.id);
  const valid=f.history.validateTraining(f.a.scope,{snapshot_id:snapshot.id,expected_digest:snapshot.digest,forecast_at:f.day(4),horizon_days:2,observation_ids:earlier});
  assert.equal(valid.valid,true);assert.equal(valid.horizon_days,2);assert.deepEqual(valid.training_window,{start_at:f.day(1),end_at:f.day(4)});assert.deepEqual(valid.baselines,['last_value_v1','seasonal_2_v1']);
}));
test('M11-FORECAST-QUANTITY-01',()=>usingDemand(f=>{
  f.snapshot();const result=f.evaluate();for(const metric of result.metrics.filter((r:any)=>r.variant_id==='sku-zero')) {
    assert.equal(metric.actual_units,0);assert.equal(metric.scored_count,2);assert.equal(metric.mae,0);assert.equal(metric.wape,null);assert.equal(metric.relative_bias,null);assert.equal(metric.service_rate,null);assert.equal(metric.denominator_reason,'zero_actual_units');
  }
  const zero=f.forecast('zero-demand',1,2);assert.equal(zero.quantity,0);assert.equal(zero.lower_units,0);assert.equal(zero.upper_units,0);assert.equal(zero.uncertainty.confidence_level,null);
  const difficult=f.forecast('intermittent',2,2);assert.equal(difficult.quantity,0);assert.equal(difficult.lower_units,0);assert.equal(difficult.upper_units,6);
}));
test('M11-FORECAST-AUTHORITY-01',()=>usingDemand(f=>{
  f.snapshot();f.evaluate();const forecast=f.forecast();
  assert.throws(()=>f.forecasts.approve(f.a.scope,{forecast_id:forecast.id,expected_digest:forecast.digest,expires_at:f.now()+60000}),/ACCESS_DENIED|SELF_APPROVAL_DENIED/);
  const backtest=f.backtests.read(f.owner,'evaluation-one'),ownerDraft=f.forecasts.create(f.owner,{forecast_id:'owner-draft',backtest_id:backtest.id,expected_digest:backtest.digest,...f.cohort[0],horizon_days:2});
  assert.throws(()=>f.forecasts.approve(f.owner,{forecast_id:ownerDraft.id,expected_digest:ownerDraft.digest,expires_at:f.now()+60000}),/SELF_APPROVAL_DENIED/);
  f.forecasts.approve(f.reviewer,{forecast_id:forecast.id,expected_digest:forecast.digest,expires_at:f.now()+10});f.advance(11);
  assert.throws(()=>f.forecasts.assertReviewed(f.a.scope,{forecast_id:forecast.id,expected_digest:forecast.digest}),/FORECAST_REVIEW_EXPIRED/);
  const review=f.forecasts.approve(f.reviewer,{forecast_id:forecast.id,expected_digest:forecast.digest,expires_at:f.now()+60000});
  assert.throws(()=>f.forecasts.assertReviewed(f.b.scope,{forecast_id:forecast.id,expected_digest:forecast.digest}),/NOT_FOUND/);
  assert.throws(()=>f.forecasts.assertReviewed(f.a.scope,{forecast_id:forecast.id,expected_digest:'0'.repeat(64)}),/FORECAST_CHANGED/);
  new Permissions(f.kernel).change(f.owner,{actor_id:'forecast-reviewer',role:'reviewer',expected_revision:0,actions:['resource.read'],resource_ids:null});
  assert.throws(()=>f.forecasts.assertReviewed(f.a.scope,{forecast_id:forecast.id,expected_digest:forecast.digest}),/FORECAST_REVIEW_AUTHORITY_CHANGED/);
  assert.equal(Object.values(exportForecastSubject(f.kernel,f.a.tenant,f.a.store,[],'C-1001','a'.repeat(64))).flat().length,0);
  assert.equal(eraseForecastSubject(f.kernel,f.a.tenant,f.a.store,[],'a'.repeat(64)).minimized,0);
  const saved=JSON.parse(f.db.prepare('SELECT body FROM commerce_inventory_forecasts WHERE id=?').get(forecast.id).body),malformed={...saved,customer_email:'forbidden-restored@example.invalid',uncertainty:{...saved.uncertainty,customer_notes:'forbidden'}};
  f.db.prepare('UPDATE commerce_inventory_forecasts SET body=?,digest=? WHERE id=?').run(JSON.stringify(malformed),contentDigest(malformed),forecast.id);
  assert.equal(eraseForecastSubject(f.kernel,f.a.tenant,f.a.store,[],'a'.repeat(64)).minimized,1);
  const minimized=f.db.prepare('SELECT body FROM commerce_inventory_forecasts WHERE id=?').get(forecast.id).body;assert.equal(minimized.includes('forbidden'),false);
  assert.equal(eraseForecastSubject(f.kernel,f.a.tenant,f.a.store,[],'a'.repeat(64)).minimized,0);
  const revoked=revokeForecastsForRestore(f.kernel,f.a.tenant,f.a.store);assert.equal(revoked.reviews_revoked,true);
  assert.equal(f.db.prepare('SELECT state FROM commerce_forecast_reviews WHERE id=?').get(review.id).state,'revoked');
  assert.throws(()=>f.forecasts.assertReviewed(f.a.scope,{forecast_id:forecast.id,expected_digest:forecast.digest}),/FORECAST_REVIEW_REQUIRED/);
}));
