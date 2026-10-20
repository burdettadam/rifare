import type {DatabaseSync} from 'node:sqlite';
import {exact,id,integer} from '../commerce/kernel.mts';
import type {Row} from '../commerce/kernel.mts';
import {canonical,contentDigest,jsonValue} from '../commerce/configuration-values.mts';
import {money} from '../commerce/money.mts';
import {FulfillmentFixtureSource} from './fulfillment-fixture-source.mts';
import {ReturnDestinationFixtureSource} from './return-destination-fixture-source.mts';
import {PartnerFixtureSource,PARTNER_SOURCE_VERSION} from './partner-fixture-source.mts';
import {WarehouseFixtureSource} from './warehouse-fixture-source.mts';
import {assertSeparateLoyaltyDatabases} from './loyalty-fixture-source.mts';

const CONTRACT='rifare-dropoff-fixture-v1',MAX_AGE=300000;
const CONFIG_FIELDS=['revision','observed_at','expires_at','partner_config_digest','combinations'];
type Parents={fulfillment:FulfillmentFixtureSource;partner:PartnerFixtureSource;warehouse:WarehouseFixtureSource};
function hash(value:unknown){if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))throw new Error('DROPOFF_SOURCE_INVALID');return value;}
function ids(value:unknown,max=20){
  if(!Array.isArray(value)||!value.length||value.length>max||new Set(value).size!==value.length)throw new Error('DROPOFF_SOURCE_INVALID');
  return value.map(id);
}
function declarations(value:unknown,observed:number,expires:number){
  if(!Array.isArray(value)||!value.length||value.length>20)throw new Error('DROPOFF_SOURCE_INVALID');
  const seen=new Set<string>();
  return value.map(raw=>{
    const p=exact(raw,['site_id','destination_id','method_id','item_ids','category_ids','packaging','label_required','credential_kind','instructions_ref','accessible_alternative','availability']);
    for(const key of ['site_id','destination_id','method_id','instructions_ref'])id(p[key]);
    const key=canonical([p.site_id,p.destination_id,p.method_id]);if(seen.has(key))throw new Error('DROPOFF_SOURCE_INVALID');seen.add(key);
    ids(p.item_ids);ids(p.category_ids);
    if(!['box_required','provider_packaging'].includes(p.packaging)||typeof p.label_required!=='boolean'||!['qr','code'].includes(p.credential_kind)||!['printed_code','staff_assisted_code'].includes(p.accessible_alternative))throw new Error('DROPOFF_SOURCE_INVALID');
    if(p.availability!==null){
      const a=exact(p.availability,['state','observed_at','expires_at']);integer(a.observed_at);integer(a.expires_at);
      if(!['available','unavailable'].includes(a.state)||a.observed_at>observed||a.expires_at<=a.observed_at||a.expires_at>expires||a.expires_at-a.observed_at>MAX_AGE)throw new Error('DROPOFF_SOURCE_INVALID');
    }
    return p;
  });
}
function configuration(value:unknown){
  const p=exact(value,CONFIG_FIELDS);integer(p.revision,1);integer(p.observed_at);integer(p.expires_at);hash(p.partner_config_digest);
  if(p.expires_at<=p.observed_at||p.expires_at-p.observed_at>MAX_AGE)throw new Error('DROPOFF_SOURCE_INVALID');
  declarations(p.combinations,p.observed_at,p.expires_at);return p;
}

/** Customer-free declarations; the existing native sources retain all effects. */
export class DropoffFixtureSource {
  readonly fulfillment:FulfillmentFixtureSource;readonly partner:PartnerFixtureSource;readonly warehouse:WarehouseFixtureSource;
  readonly db:DatabaseSync;readonly tenant:string;readonly store:string;readonly identity:string;readonly contract=CONTRACT;
  #refs:Row;#binding:Row;#durable:string;
  constructor(parents:Parents){
    exact(parents,['fulfillment','partner','warehouse']);const {fulfillment:f,partner:p,warehouse:w}=parents;
    if(!(f instanceof FulfillmentFixtureSource)||!(f.destinations instanceof ReturnDestinationFixtureSource)||!(p instanceof PartnerFixtureSource)||!(w instanceof WarehouseFixtureSource))throw new Error('DROPOFF_OWNER_MISMATCH');
    this.fulfillment=f;this.partner=p;this.warehouse=w;this.db=p.db;this.tenant=f.tenant;this.store=f.store;
    this.#refs=Object.freeze({fulfillment_db:f.db,partner_db:p.db,warehouse_db:w.db,destinations:f.destinations,fulfillment_clock:f.clock,partner_clock:p.clock});
    const binding={contract:CONTRACT,tenant_id:this.tenant,store_id:this.store,fulfillment_source_identity:f.identity,partner_source_identity:p.identity,warehouse_source_identity:w.identity};
    this.identity=contentDigest(binding);this.#binding=Object.freeze({...binding,source_identity:this.identity});
    // This preflight must precede even CREATE TABLE IF NOT EXISTS. The inherited
    // physical-separation helper checks its second database for core storage.
    this.#assertParents();this.#durable=this.#durableIdentity();
    this.db.exec('CREATE TABLE IF NOT EXISTS fixture_dropoff_configuration(singleton INTEGER PRIMARY KEY CHECK(singleton=1),revision INTEGER NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL) STRICT');
    this.#read();Object.freeze(this);
  }
  #assertParents(){
    const f=this.fulfillment,p=this.partner,w=this.warehouse,r=this.#refs,b=this.#binding;
    if(f.db!==r.fulfillment_db||p.db!==r.partner_db||w.db!==r.warehouse_db||f.destinations!==r.destinations||f.clock!==r.fulfillment_clock||p.clock!==r.partner_clock||typeof f.clock!=='function'||typeof p.clock!=='function')throw new Error('DROPOFF_OWNER_MISMATCH');
    for(const source of [f,p,w,f.destinations])if(source.tenant!==this.tenant||source.store!==this.store)throw new Error('DROPOFF_SOURCE_SCOPE');
    if(f.identity!==b.fulfillment_source_identity||p.identity!==b.partner_source_identity||w.identity!==b.warehouse_source_identity||f.destinations.identity!==f.identity||f.destinations.db!==f.db||f.destinations.clock!==f.clock)throw new Error('DROPOFF_SOURCE_SCOPE');
    const databases=[f.db,p.db,w.db];
    for(let i=0;i<databases.length;i++)for(let j=i+1;j<databases.length;j++){
      assertSeparateLoyaltyDatabases(databases[i],databases[j]);assertSeparateLoyaltyDatabases(databases[j],databases[i]);
    }
    const durable=this.#durableIdentity();if(this.#durable!==undefined&&durable!==this.#durable)throw new Error('DROPOFF_SOURCE_SCOPE');
  }
  #durableIdentity(){
    const rows=[
      {db:this.fulfillment.db,table:'fixture_identity',fields:['id','tenant','store','label'],identity:'id',tenant:'tenant',store:'store',expected:this.#binding.fulfillment_source_identity},
      {db:this.partner.db,table:'partner_source_identity',fields:['id','label','identity','tenant_id','store_id'],identity:'identity',tenant:'tenant_id',store:'store_id',expected:this.#binding.partner_source_identity},
      {db:this.warehouse.db,table:'warehouse_identity',fields:['singleton','label','tenant_id','store_id','identity'],identity:'identity',tenant:'tenant_id',store:'store_id',expected:this.#binding.warehouse_source_identity}
    ].map(spec=>{
      const values=spec.db.prepare('SELECT * FROM '+spec.table+' LIMIT 2').all() as Row[];
      if(values.length!==1)throw new Error('DROPOFF_SOURCE_SCOPE');const row=exact(values[0],spec.fields);id(row.label);
      if(row[spec.identity]!==spec.expected||row[spec.tenant]!==this.tenant||row[spec.store]!==this.store||spec.table==='partner_source_identity'&&row.id!==1||spec.table==='warehouse_identity'&&row.singleton!==1)throw new Error('DROPOFF_SOURCE_SCOPE');
      return row;
    });return canonical(rows);
  }
  assertIdentity(){this.#assertParents();}
  assertAttached(core:DatabaseSync){this.#assertParents();for(const db of [this.fulfillment.db,this.partner.db,this.warehouse.db])assertSeparateLoyaltyDatabases(core,db);}
  partnerConfiguration(){
    this.#assertParents();const value=this.partner.configuration('reverse_hub');if(value===null)return null;
    exact(value,['body','digest']);const b=exact(jsonValue(value.body),['service','account_id','revision','regions','expires_at','terms','source_identity','tenant_id','store_id','api_version','qualification']);
    if(contentDigest(b)!==hash(value.digest)||b.service!=='reverse_hub'||b.source_identity!==this.partner.identity||b.tenant_id!==this.tenant||b.store_id!==this.store||b.api_version!==PARTNER_SOURCE_VERSION||b.qualification!=='synthetic_local_only')throw new Error('DROPOFF_SOURCE_SCOPE');
    id(b.account_id);integer(b.revision,1);integer(b.expires_at);ids(b.regions,50);
    const terms=exact(b.terms,['sites','currency','fee_minor','sla_ref']);money(terms.currency,terms.fee_minor);id(terms.sla_ref);
    if(!Array.isArray(terms.sites)||!terms.sites.length||terms.sites.length>20)throw new Error('DROPOFF_SOURCE_INVALID');
    const seen=new Set<string>();for(const raw of terms.sites){const site=exact(raw,['site_id','warehouse_source_identity','location_id','categories']);id(site.site_id);id(site.warehouse_source_identity);id(site.location_id);ids(site.categories,50);if(seen.has(site.site_id))throw new Error('DROPOFF_SOURCE_INVALID');seen.add(site.site_id);}
    this.#assertParents();return {body:b,digest:value.digest};
  }
  #read(){
    const rows=this.db.prepare('SELECT * FROM fixture_dropoff_configuration LIMIT 2').all() as Row[];if(!rows.length)return null;
    if(rows.length!==1)throw new Error('DROPOFF_SOURCE_INVALID');const row=exact(rows[0],['singleton','revision','body','digest']);
    const body=exact(jsonValue(JSON.parse(row.body)),['schema_version','qualification',...Object.keys(this.#binding),'account_id',...CONFIG_FIELDS]);
    if(row.singleton!==1||body.schema_version!==1||body.qualification!=='synthetic_only'||body.revision!==row.revision||contentDigest(body)!==hash(row.digest)||Object.keys(this.#binding).some(key=>body[key]!==this.#binding[key]))throw new Error('DROPOFF_SOURCE_SCOPE');
    id(body.account_id);configuration(Object.fromEntries(CONFIG_FIELDS.map(key=>[key,body[key]])));
    const partner=this.partnerConfiguration();
    if(partner?.digest===body.partner_config_digest&&partner.body.account_id!==body.account_id)throw new Error('DROPOFF_SOURCE_SCOPE');
    return {...body,digest:row.digest};
  }
  observe(){this.#assertParents();return this.#read();}
  configure(value:unknown){
    const p=configuration(jsonValue(value));this.#assertParents();this.db.exec('BEGIN IMMEDIATE');
    try{
      const old=this.#read(),partner=this.partnerConfiguration(),now=integer(this.fulfillment.clock());
      if(p.revision!==(old?.revision??0)+1)throw new Error('DROPOFF_REVISION_CHANGED');
      if(p.observed_at>now||now-p.observed_at>MAX_AGE||p.expires_at<=now)throw new Error('DROPOFF_CONFIGURATION_EXPIRED');
      if(!partner||p.partner_config_digest!==partner.digest)throw new Error('DROPOFF_PARTNER_CHANGED');
      const body={schema_version:1,qualification:'synthetic_only',...this.#binding,account_id:partner.body.account_id,...p},digest=contentDigest(body);
      this.#assertParents();if(this.partnerConfiguration()?.digest!==partner.digest)throw new Error('DROPOFF_PARTNER_CHANGED');
      this.db.prepare('INSERT INTO fixture_dropoff_configuration VALUES(1,?,?,?) ON CONFLICT(singleton) DO UPDATE SET revision=excluded.revision,body=excluded.body,digest=excluded.digest').run(p.revision,canonical(body),digest);
      this.db.exec('COMMIT');return {...body,digest};
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
}
