import type { CommerceKernel,Row } from './kernel.mts';
import { canonical,contentDigest } from './configuration-values.mts';
import { FORECAST_TABLES } from './forecast-core.mts';

export { FORECAST_TABLES };
export const FORECAST_SUBJECT_TABLES=Object.freeze([] as string[]);
export const FORECAST_STORAGE_CLASSIFICATIONS=Object.freeze(FORECAST_TABLES.map(table=>({table,classification:table==='commerce_forecast_reviews'?'merchant_review_authority':'merchant_aggregate_business_record',
  scope:['tenant_id','store_id',...(['commerce_demand_observations','commerce_inventory_forecasts','commerce_forecast_reviews'].includes(table)?['resource_id']:[])],
  resource_kind:'customer_free_catalog',customer_id_present:false,subject_export:'excluded_no_customer_facts'})));
const memberKeys=['resource_id','variant_id','location_id','unit'];
const observationKeys=[...memberKeys,'observation_id','revision','event_at','available_at','sales_units','cancellation_units','return_units','stockout','missing','source_identity','source_version','observed_at','source_digest'];
const seriesKeys=[...memberKeys,'event_at','observed_at','available_at','demand_units','retained_units','sales_units','cancellation_units','return_units','stockout','missing','source_identity','observation_id','revision','observation_digest'];
const metricKeys=['cohort_key','resource_id','variant_id','location_id','horizon_days','method','declared_count','scored_count','unscored_count','actual_units','absolute_error','signed_error','under_units','over_units','mae','wape','relative_bias','service_rate','denominator_reason','service_interpretation'];
const planKeys=['dataset_id','dataset_digest','window_start','window_end','cutoff','origins','horizons','method','reference_baseline','baseline_versions','tuning_cutoff','split','cohort_policy','metric_version','method_version','created_by','qualified_real_demand'];
const cellKeys=[...memberKeys,'origin','horizon_days','training_max_event_at','training_max_observed_at','training_declared_days','training_known_days','holdout_declared_days','actual_units','observation_digests','holdout_digests','unscored_reasons'];
const forecastKeys=[...memberKeys,'horizon_days','as_of','valid_until','dataset_id','dataset_digest','backtest_id','backtest_digest','method','requested_method','baseline','method_version','baseline_versions','quantity','lower_units','upper_units','quality','improvement_claim','limitations','history_declared_days','history_known_days','censored_days','proposed_by','proposer_authority_revision','qualification','external_qualified','execution_authorized'];
function pick(value:any,keys:readonly string[]):Row {
  const result:Row={};if(!value||typeof value!=='object'||Array.isArray(value))return result;
  for(const key of keys)if(Object.hasOwn(value,key)) {
    const item=value[key];
    if(item===null||['string','number','boolean'].includes(typeof item))result[key]=item;
    else if(Array.isArray(item)&&item.every(entry=>entry===null||['string','number','boolean'].includes(typeof entry)))result[key]=[...item];
  }
  return result;
}
const list=(value:any,project:(row:Row)=>Row)=>Array.isArray(value)?value.map(project):[];
const window=(value:any)=>pick(value,['start_at','end_at','cutoff']);
function plan(value:Row){return {...pick(value,planKeys),cohort:list(value?.cohort,row=>pick(row,memberKeys))};}
function cell(value:Row){return {...pick(value,cellKeys),training_window:window(value?.training_window),holdout_window:window(value?.holdout_window),predictions:pick(value?.predictions,['last_value_v1','seasonal_2_v1','mean_2_v1','mean_3_v1'])};}
function sanitized(table:string,b:Row):Row {
  if(table==='commerce_demand_observations')return pick(b,[...observationKeys,'imported_at']);
  if(table==='commerce_demand_snapshots')return {...pick(b,['cutoff','window_start','window_end','observation_digests','availability_basis','local_import_time_is_not_historical_availability','demand_treatment','returns_treatment','stockout_treatment','missing_treatment','created_by','qualification','external_qualified']),
    cohort:list(b.cohort,row=>pick(row,memberKeys)),observations:list(b.observations,row=>pick(row,[...observationKeys,'canonical_observation_id'])),series:list(b.series,row=>pick(row,seriesKeys)),source_provenance:list(b.source_provenance,row=>pick(row,['source_identity','source_version']))};
  if(table==='commerce_forecast_backtests')return {...pick(b,['plan_digest','qualification','external_qualified']),plan:plan(b.plan),cells:list(b.cells,cell),metrics:list(b.metrics,row=>pick(row,metricKeys))};
  if(table==='commerce_inventory_forecasts')return {...pick(b,forecastKeys),source_window:window(b.source_window),catalog_pin:pick(b.catalog_pin,['resource_id','source_system','external_id','source_version','source_digest']),
    comparison:{...pick(b.comparison,['selected_method','selection_rule']),candidate:pick(b.comparison?.candidate,metricKeys),baseline:pick(b.comparison?.baseline,metricKeys)},
    uncertainty:pick(b.uncertainty,['kind','sample_count','maximum_absolute_error','confidence_level','probabilistic_coverage_qualified','limitations'])};
  return pick(b,['forecast_id','forecast_digest','reviewer','reviewer_authority_revision','expires_at','reviewed_at','scope_digest','replay_allowed','authority_revoked']);
}
function checked(row:Row) {const body=JSON.parse(row.body);if(contentDigest(body)!==row.digest)throw new Error('FORECAST_RECORD_INTEGRITY');return body;}
/** Aggregate daily business data deliberately accepts no order/customer facts.
 * A customer export cannot disclose another SKU's merchant forecasting data. */
export function exportForecastSubject(_k:CommerceKernel,_tenant:string,_store:string,_resourceIds:readonly string[],_customer:string,_hash:string) {
  return Object.fromEntries(FORECAST_TABLES.map(table=>[table,[] as Row[]]));
}
/** Reapply explicit field allowlists even when erasure is hash-only. Normally
 * no row changes because these tables have no subject fields. Restored or
 * malformed extra fields cannot acquire permanent storage through this path. */
export function eraseForecastSubject(k:CommerceKernel,tenant:string,store:string,_resourceIds:readonly string[],_hash:string) {
  let count=0;
  for(const table of FORECAST_TABLES)for(const row of k.db.prepare('SELECT * FROM '+table+' WHERE tenant_id=? AND store_id=?').all(tenant,store) as Row[]) {
    const b=sanitized(table,checked(row)),encoded=canonical(b);if(encoded===row.body)continue;
    k.db.prepare('UPDATE '+table+' SET body=?,digest=? WHERE tenant_id=? AND store_id=? AND id=?').run(encoded,contentDigest(b),tenant,store,row.id);count++;
  }
  if(count)k.db.prepare("UPDATE commerce_forecast_reviews SET state='revoked' WHERE tenant_id=? AND store_id=?").run(tenant,store);
  return {minimized:count,customer_records_present:false,source_effects_dispatched:0,separate_source_history_erased:false};
}
/** Restore/import/uninstall require this independently of subject tombstones.
 * An explicit new authenticated review is needed after current-data checks. */
export function revokeForecastsForRestore(k:CommerceKernel,tenant?:string,store?:string) {
  if((tenant===undefined)!==(store===undefined))throw new Error('INVALID_INPUT');
  const where=tenant===undefined?'':' WHERE tenant_id=? AND store_id=?',args=tenant===undefined?[]:[tenant,store!];
  for(const table of FORECAST_TABLES)for(const row of k.db.prepare('SELECT * FROM '+table+where).all(...args) as Row[]) {
    let body=sanitized(table,checked(row));
    if(table==='commerce_forecast_reviews')body={...body,reviewer:null,reviewer_authority_revision:null,expires_at:0,replay_allowed:false,authority_revoked:true};
    const state=table==='commerce_forecast_reviews'?",state='revoked'":table==='commerce_inventory_forecasts'?",state='review_required'":'';
    k.db.prepare('UPDATE '+table+' SET body=?,digest=?'+state+' WHERE tenant_id=? AND store_id=? AND id=?').run(canonical(body),contentDigest(body),row.tenant_id,row.store_id,row.id);
  }
  return {reviews_revoked:true,restored_fields_allowlisted:true,customer_records_present:false,source_effects_dispatched:0};
}
