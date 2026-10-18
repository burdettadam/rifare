import { exact,id,integer } from './kernel.mts';
import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { DemandFixtureSource,DEMAND_SOURCE_CONTRACT } from '../adapters/demand-fixture-source.mts';
import { FORECAST_DAY,FORECAST_BASELINES,forecastHash,forecastDay,forecastHorizon,forecastMember,forecastMemberKey,forecastCatalog,forecastCohort,forecastBody,forecastStored,demandObservation,buildDemandSeries } from './forecast-core.mts';

export class DemandHistory {
  readonly k:CommerceKernel;
  constructor(k:CommerceKernel){this.k=k;}
  sync(scope:Scope,source:DemandFixtureSource) {
    const k=this.k,s=k.require(scope);
    if(!(source instanceof DemandFixtureSource)||source.tenant!==s.tenant_id||source.store!==s.store_id||source.db===k.db)throw new Error('DEMAND_SOURCE_SCOPE');
    const filename=(db:any)=>db.prepare('PRAGMA database_list').all().find((row:Row)=>row.name==='main')?.file;
    if(filename(source.db)&&filename(source.db)===filename(k.db))throw new Error('SEPARATE_FIXTURE_SOURCE_REQUIRED');
    const rows=source.observations();if(rows.length>512)throw new Error('DEMAND_IMPORT_BOUND_EXCEEDED');
    return k.transaction(()=>{
      let imported=0;
      for(const row of rows) {
        const input=demandObservation(row.input),member=forecastMember({resource_id:input.resource_id,variant_id:input.variant_id,location_id:input.location_id,unit:input.unit});forecastCatalog(k,scope,member,'resource.ingest');
        integer(row.observed_at);if(row.tenant_id!==s.tenant_id||row.store_id!==s.store_id||row.source_identity!==source.identity||row.source_version!==DEMAND_SOURCE_CONTRACT.version||row.observed_at>k.clock()||row.available_at>row.observed_at||row.event_at>row.observed_at)throw new Error('DEMAND_SOURCE_INTEGRITY');
        if(contentDigest({...input,input,tenant_id:s.tenant_id,store_id:s.store_id,source_identity:source.identity,source_version:DEMAND_SOURCE_CONTRACT.version,observed_at:row.observed_at})!==row.digest)throw new Error('DEMAND_SOURCE_INTEGRITY');
        const ref='demand_'+contentDigest([source.identity,input.observation_id,input.revision]).slice(0,48),old=k.db.prepare('SELECT * FROM commerce_demand_observations WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,ref) as Row|undefined;
        if(old){if(forecastBody(old).source_digest!==row.digest)throw new Error('DEMAND_SOURCE_REVISION_CONFLICT');continue;}
        const body={...input,source_identity:source.identity,source_version:DEMAND_SOURCE_CONTRACT.version,observed_at:row.observed_at,imported_at:k.clock(),source_digest:row.digest};
        k.db.prepare('INSERT INTO commerce_demand_observations VALUES(?,?,?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,ref,member.resource_id,source.identity,input.observation_id,input.revision,canonical(body),contentDigest(body));imported++;
      }
      return {imported,source_effects_dispatched:0,qualification:'synthetic_local_only'};
    });
  }
  observations(scope:Scope,resourceId:string) {
    const s=this.k.authorize(scope,'resource.read',id(resourceId)),resource=this.k.get(scope,resourceId);
    if(resource.kind!=='catalog'||resource.customer_id!==null||s.role==='customer')throw new Error('FORECAST_BUSINESS_RESOURCE_REQUIRED');
    return (this.k.db.prepare('SELECT * FROM commerce_demand_observations WHERE tenant_id=? AND store_id=? AND resource_id=? ORDER BY source_identity,observation_id,revision').all(s.tenant_id,s.store_id,resourceId) as Row[]).map(row=>({id:row.id,...forecastBody(row),digest:row.digest}));
  }
  snapshot(scope:Scope,value:unknown) {
    const p=exact(jsonValue(value),['snapshot_id','cutoff','window_start','window_end','cohort']);id(p.snapshot_id);integer(p.cutoff);forecastDay(p.window_start);forecastDay(p.window_end);
    if(p.window_start>p.window_end||p.window_end>p.cutoff||p.cutoff>this.k.clock()||(p.window_end-p.window_start)/FORECAST_DAY>=32)throw new Error('DEMAND_WINDOW_INVALID');
    const k=this.k,s=k.require(scope),cohort=forecastCohort(k,scope,p.cohort,'action.propose'),keys=new Set(cohort.map(forecastMemberKey));
    return k.transaction(()=>{
      if(k.db.prepare('SELECT 1 FROM commerce_demand_snapshots WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,p.snapshot_id))throw new Error('DEMAND_SNAPSHOT_IMMUTABLE');
      const all=[...new Set(cohort.map(item=>item.resource_id))].flatMap(resource=>this.observations(scope,resource)).filter(o=>keys.has(forecastMemberKey(o as any))&&o.event_at>=p.window_start&&o.event_at<=p.window_end);
      const visible = all.filter(o => o.event_at <= p.cutoff && o.available_at <= p.cutoff && o.observed_at <= p.cutoff);
      if(visible.length>128)throw new Error('DEMAND_SNAPSHOT_BOUND_EXCEEDED');
      const observations=visible.map(({digest,id:ref,imported_at,...body})=>({...body,canonical_observation_id:ref})).sort((a,b)=>canonical([a.resource_id,a.variant_id,a.location_id,a.event_at,a.revision]).localeCompare(canonical([b.resource_id,b.variant_id,b.location_id,b.event_at,b.revision])));
      for(const member of cohort) {const sources=new Set(observations.filter(row=>forecastMemberKey(row as any)===forecastMemberKey(member)).map(row=>row.source_identity));if(sources.size>1)throw new Error('DEMAND_SOURCE_OWNER_AMBIGUOUS');}
      const archive={cutoff:p.cutoff,window_start:p.window_start,window_end:p.window_end,cohort,observations};
      // Visible rows have already passed the archive cutoff. Rechecking each
      // training origin happens in buildDemandSeries, not by latest ingest time.
      const series=cohort.flatMap(member=>buildDemandSeries(archive,member,p.window_start,p.window_end,Number.MAX_SAFE_INTEGER));
      const body={...archive,series,observation_digests:observations.map(row=>row.source_digest),
        source_provenance:[...new Map(observations.map(row=>[row.source_identity,{source_identity:row.source_identity,source_version:row.source_version}])).values()],
        availability_basis:'source_archived_observation_and_availability',local_import_time_is_not_historical_availability:true,
        demand_treatment:'sales_minus_cancellations',returns_treatment:'reported_separately_with_retained_units',stockout_treatment:'observed_sales_are_lower_bounds',missing_treatment:'explicit_null_never_zero',
        created_by:s.actor_id,qualification:'synthetic_local_only',external_qualified:false};
      k.db.prepare('INSERT INTO commerce_demand_snapshots VALUES(?,?,?,?,?)').run(s.tenant_id,s.store_id,p.snapshot_id,canonical(body),contentDigest(body));return this.read(scope,p.snapshot_id);
    });
  }
  read(scope:Scope,ref:string) {const row=forecastStored(this.k,scope,'commerce_demand_snapshots',ref);forecastCohort(this.k,scope,row.body.cohort);return {id:row.id,...row.body,digest:row.digest};}
  validateTraining(scope:Scope,value:unknown) {
    const p=exact(jsonValue(value),['snapshot_id','expected_digest','forecast_at','horizon_days','observation_ids']),snapshot=this.read(scope,id(p.snapshot_id));
    forecastHash(p.expected_digest);forecastDay(p.forecast_at);forecastHorizon(p.horizon_days);if(snapshot.digest!==p.expected_digest)throw new Error('DEMAND_SNAPSHOT_CHANGED');
    if(p.forecast_at<snapshot.window_start||p.forecast_at>snapshot.cutoff)throw new Error('DEMAND_TEMPORAL_LEAKAGE');
    if(!Array.isArray(p.observation_ids)||p.observation_ids.length<1||p.observation_ids.length>128||new Set(p.observation_ids).size!==p.observation_ids.length)throw new Error('INVALID_INPUT');
    const approved=new Set(snapshot.observations.map((o:Row)=>o.canonical_observation_id)),cohort=new Set(snapshot.cohort.map(forecastMemberKey));
    for(const ref of p.observation_ids) {
      const row=forecastStored(this.k,scope,'commerce_demand_observations',id(ref)),b=row.body;this.k.authorize(scope,'resource.read',row.resource_id);
      if(!approved.has(ref)||!cohort.has(forecastMemberKey(b as any))||b.event_at>p.forecast_at||b.available_at>p.forecast_at||b.observed_at>p.forecast_at||b.event_at<snapshot.window_start)throw new Error('DEMAND_TEMPORAL_LEAKAGE');
    }
    return {valid:true,horizon_days:p.horizon_days,training_window:{start_at:snapshot.window_start,end_at:p.forecast_at},baselines:[...FORECAST_BASELINES],dataset_digest:snapshot.digest};
  }
}
