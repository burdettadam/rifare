import { exact,id,integer } from './kernel.mts';
import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';

export const FORECAST_DAY=86400000;
export const FORECAST_TABLES=Object.freeze(['commerce_demand_observations','commerce_demand_snapshots','commerce_forecast_backtests','commerce_inventory_forecasts','commerce_forecast_reviews']);
export const FORECAST_BASELINES=Object.freeze(['last_value_v1','seasonal_2_v1']);
export const FORECAST_METHODS=Object.freeze(['mean_2_v1','mean_3_v1']);
export const FORECAST_MAX_UNITS=1000000;
export type ForecastMember={resource_id:string;variant_id:string;location_id:string;unit:'each'};
export function forecastHash(value:unknown){if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))throw new Error('INVALID_INPUT');return value;}
export function forecastDay(value:unknown){integer(value);if(Number(value)%FORECAST_DAY!==0)throw new Error('DEMAND_DAILY_BOUNDARY_REQUIRED');return value as number;}
export function forecastHorizon(value:unknown){const n=integer(value,1);if(n>7)throw new Error('FORECAST_HORIZON_UNSUPPORTED');return n;}
export function forecastUnits(value:unknown){const n=integer(value);if(n>FORECAST_MAX_UNITS)throw new Error('DEMAND_QUANTITY_UNSUPPORTED');return n;}
export function forecastMember(value:unknown):ForecastMember {
  const p=exact(jsonValue(value),['resource_id','variant_id','location_id','unit']);
  id(p.resource_id);id(p.variant_id);id(p.location_id);if(p.unit!=='each')throw new Error('FORECAST_UNIT_UNSUPPORTED');return p as ForecastMember;
}
export const forecastMemberKey=(p:ForecastMember)=>canonical([p.resource_id,p.variant_id,p.location_id,p.unit]);
export function forecastCatalog(k:CommerceKernel,scope:Scope,member:ForecastMember,action='resource.read') {
  const s=k.authorize(scope,action,member.resource_id),resource=k.get(scope,member.resource_id);
  if(s.role==='customer'||resource.kind!=='catalog'||resource.customer_id!==null)throw new Error('FORECAST_BUSINESS_RESOURCE_REQUIRED');
  return {resource_id:resource.id,source_system:resource.source_system,external_id:resource.external_id,source_version:resource.source_version,
    source_digest:contentDigest(resource.payload)};
}
export function forecastCohort(k:CommerceKernel,scope:Scope,value:unknown,action='resource.read') {
  if(!Array.isArray(value)||value.length<1||value.length>4)throw new Error('FORECAST_COHORT_UNSUPPORTED');
  const cohort=value.map(forecastMember).sort((a,b)=>forecastMemberKey(a).localeCompare(forecastMemberKey(b)));
  if(new Set(cohort.map(forecastMemberKey)).size!==cohort.length)throw new Error('FORECAST_COHORT_DUPLICATE');
  cohort.forEach(item=>forecastCatalog(k,scope,item,action));return cohort;
}
export function forecastBody(row:Row|undefined) {
  if(!row)throw new Error('NOT_FOUND');const body=jsonValue(JSON.parse(row.body));
  if(contentDigest(body)!==row.digest)throw new Error('FORECAST_RECORD_INTEGRITY');
  if(body.erased)throw new Error('SUBJECT_ERASED');return body as Row;
}
export function forecastStored(k:CommerceKernel,scope:Scope,table:string,ref:string) {
  if(!FORECAST_TABLES.includes(table))throw new Error('FORECAST_TABLE_DENIED');const s=k.require(scope);id(ref);
  const row=k.db.prepare('SELECT * FROM '+table+' WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,ref) as Row|undefined;
  const body=forecastBody(row);return {...row!,body};
}
export function demandObservation(value:unknown) {
  const p=exact(jsonValue(value),['observation_id','revision','resource_id','variant_id','location_id','unit','event_at','available_at','sales_units','cancellation_units','return_units','stockout','missing']);
  id(p.observation_id);integer(p.revision,1);forecastMember({resource_id:p.resource_id,variant_id:p.variant_id,location_id:p.location_id,unit:p.unit});
  forecastDay(p.event_at);integer(p.available_at);for(const name of ['sales_units','cancellation_units','return_units'])forecastUnits(p[name]);
  if(p.cancellation_units>p.sales_units||p.return_units>p.sales_units-p.cancellation_units||typeof p.stockout!=='boolean'||typeof p.missing!=='boolean')throw new Error('DEMAND_COUNTS_INVALID');
  if(p.missing&&(p.sales_units!==0||p.cancellation_units!==0||p.return_units!==0))throw new Error('DEMAND_MISSING_COUNTS_INVALID');return p;
}
/** A snapshot is a source-observed archive. Missing dates stay missing; an
 * observed zero is a separate state. Returns are exposed, not erased from demand. */
export function buildDemandSeries(snapshot:Row,item:ForecastMember,start:number,end:number,cutoff:number):Row[] {
  const key=forecastMemberKey(item),all=snapshot.observations.filter((o:Row)=>forecastMemberKey(o)===key);
  const out:Row[]=[];
  for(let date=start;date<=end;date+=FORECAST_DAY) {
    const candidates=all.filter((o:Row)=>o.event_at===date&&o.event_at<=cutoff&&o.available_at<=cutoff&&o.observed_at<=cutoff)
      .sort((a:Row,b:Row)=>b.revision-a.revision);
    const row=candidates[0];
    out.push({...item,event_at:date,observed_at:row?.observed_at??null,available_at:row?.available_at??null,
      demand_units:row&&!row.missing?row.sales_units-row.cancellation_units:null,
      retained_units:row&&!row.missing?row.sales_units-row.cancellation_units-row.return_units:null,
      sales_units:row?.sales_units??null,cancellation_units:row?.cancellation_units??null,return_units:row?.return_units??null,
      stockout:row?.stockout??false,missing:!row||row.missing,source_identity:row?.source_identity??null,
      observation_id:row?.observation_id??null,revision:row?.revision??null,observation_digest:row?.source_digest??null});
  }
  return out;
}
export function forecastPrediction(method:string,train:Row[],horizon:number):number|null {
  const width=method==='last_value_v1'?1:method==='mean_3_v1'?3:2;
  if(![...FORECAST_BASELINES,...FORECAST_METHODS].includes(method)||train.length<width)return null;
  const rows=train.slice(-width);if(rows.some(row=>row.missing||row.stockout||row.demand_units===null))return null;
  if(method==='seasonal_2_v1'){let total=0;for(let n=0;n<horizon;n++)total+=rows[n%2].demand_units;return total;}
  return rows.reduce((n,row)=>n+row.demand_units,0)/width*horizon;
}
