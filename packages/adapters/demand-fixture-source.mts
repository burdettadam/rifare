import type { DatabaseSync } from 'node:sqlite';
import { exact,id,integer } from '../commerce/kernel.mts';
import type { Row } from '../commerce/kernel.mts';
import { canonical,contentDigest } from '../commerce/configuration-values.mts';
import { demandObservation,forecastMemberKey } from '../commerce/forecast-core.mts';

export const DEMAND_SOURCE_CONTRACT=Object.freeze({adapter:'demand_fixture_source',version:'demand_fixture_v1',qualification:'synthetic_archived_observations_only',external_qualified:false,
  operations:['demand.observations.read'],financial_effects:false,stock_effects:false});
/** Server-local fixture administration. Source observation time is captured on
 * append; neither clients nor canonical import can backdate an existing revision. */
export class DemandFixtureSource {
  readonly db:DatabaseSync;readonly identity:string;readonly tenant:string;readonly store:string;readonly clock:()=>number;
  constructor(db:DatabaseSync,config:unknown,clock:()=>number=Date.now) {
    const p=exact(config,['mode','identity','tenant','store']);if(p.mode!=='fixture')throw new Error('FIXTURE_MODE_REQUIRED');
    id(p.identity);id(p.tenant);id(p.store);this.db=db;this.identity=p.identity;this.tenant=p.tenant;this.store=p.store;this.clock=clock;
    db.exec('CREATE TABLE IF NOT EXISTS fixture_demand_identity(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL) STRICT;'+
      'CREATE TABLE IF NOT EXISTS fixture_demand_observations(observation_id TEXT NOT NULL,revision INTEGER NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(observation_id,revision)) STRICT;');
    const old=db.prepare('SELECT body FROM fixture_demand_identity WHERE id=1').get() as Row|undefined,binding=canonical({identity:this.identity,tenant:this.tenant,store:this.store});
    if(old&&old.body!==binding)throw new Error('DEMAND_SOURCE_SCOPE');if(!old)db.prepare('INSERT INTO fixture_demand_identity VALUES(1,?)').run(binding);
  }
  descriptor(){return {...DEMAND_SOURCE_CONTRACT,identity:this.identity,tenant_id:this.tenant,store_id:this.store};}
  observe(value:unknown) {
    const p=demandObservation(value),now=integer(this.clock());if(p.event_at>now)throw new Error('DEMAND_FUTURE_EVENT');if(p.available_at>now)throw new Error('DEMAND_FUTURE_AVAILABILITY');
    const all=this.observations(),previous=all.filter(row=>row.observation_id===p.observation_id).sort((a,b)=>b.revision-a.revision)[0];
    if(previous) {
      if(p.revision===previous.revision&&canonical(p)===canonical(previous.input))return previous;
      if(p.revision!==previous.revision+1||p.event_at!==previous.event_at||forecastMemberKey(p as any)!==forecastMemberKey(previous as any)||now<previous.observed_at||p.available_at<previous.available_at)throw new Error('DEMAND_SOURCE_REVISION_CONFLICT');
    }else if(p.revision!==1)throw new Error('DEMAND_SOURCE_REVISION_CONFLICT');
    if(all.some(row=>row.observation_id!==p.observation_id&&forecastMemberKey(row as any)===forecastMemberKey(p as any)&&row.event_at===p.event_at))throw new Error('DEMAND_BUCKET_IDENTITY_CONFLICT');
    const body={...p,input:p,tenant_id:this.tenant,store_id:this.store,source_identity:this.identity,source_version:DEMAND_SOURCE_CONTRACT.version,observed_at:now};
    this.db.prepare('INSERT INTO fixture_demand_observations VALUES(?,?,?,?)').run(p.observation_id,p.revision,canonical(body),contentDigest(body));return {...body,digest:contentDigest(body)};
  }
  observations():Row[] {
    return (this.db.prepare('SELECT * FROM fixture_demand_observations ORDER BY observation_id,revision').all() as Row[]).map(row=>{
      const body=JSON.parse(row.body);if(contentDigest(body)!==row.digest||body.observation_id!==row.observation_id||body.revision!==row.revision)throw new Error('DEMAND_SOURCE_INTEGRITY');return {...body,digest:row.digest};
    });
  }
}
