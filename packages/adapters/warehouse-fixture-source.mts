import { randomUUID } from 'node:crypto';
import { exact,id,integer } from '../commerce/kernel.mts';
import type { Row } from '../commerce/kernel.mts';
import type { DatabaseSync } from 'node:sqlite';
import { canonical,contentDigest,jsonValue } from '../commerce/configuration-values.mts';

export class WarehouseFixtureSource {
 readonly db:DatabaseSync;readonly tenant:string;readonly store:string;readonly identity:string;
 fault:'none'|'before'|'after'|'hang'='none';calls={apply:0,lookup:0};
 constructor(db:DatabaseSync,config:{mode:'fixture';identity:string;tenant:string;store:string}){
  exact(config,['mode','identity','tenant','store']);if(config.mode!=='fixture')throw new Error('FIXTURE_ONLY');id(config.identity);id(config.tenant);id(config.store);
  this.db=db;this.tenant=config.tenant;this.store=config.store;db.exec('PRAGMA busy_timeout=3000;');
  db.exec(`CREATE TABLE IF NOT EXISTS warehouse_identity(singleton INTEGER PRIMARY KEY CHECK(singleton=1),label TEXT NOT NULL,tenant_id TEXT NOT NULL,store_id TEXT NOT NULL,identity TEXT NOT NULL) STRICT;
   CREATE TABLE IF NOT EXISTS warehouse_stock(variant TEXT NOT NULL,location TEXT NOT NULL,available INTEGER NOT NULL CHECK(available>=0),PRIMARY KEY(variant,location)) STRICT;
   CREATE TABLE IF NOT EXISTS warehouse_effects(operation_id TEXT PRIMARY KEY,digest TEXT NOT NULL,body TEXT NOT NULL) STRICT;
   CREATE TABLE IF NOT EXISTS warehouse_units(unit_key TEXT PRIMARY KEY,operation_id TEXT NOT NULL) STRICT;
   CREATE TABLE IF NOT EXISTS warehouse_return_events(event_id TEXT PRIMARY KEY,native_return_id TEXT NOT NULL,sequence INTEGER NOT NULL,input_digest TEXT NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL,UNIQUE(native_return_id,sequence)) STRICT;
   CREATE TABLE IF NOT EXISTS warehouse_return_units(unit_key TEXT PRIMARY KEY,event_id TEXT NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL) STRICT;`);
  db.prepare('INSERT OR IGNORE INTO warehouse_identity VALUES(1,?,?,?,?)').run(config.identity,config.tenant,config.store,'warehouse_'+randomUUID().replaceAll('-',''));
  const r=db.prepare('SELECT * FROM warehouse_identity').get() as Row;if(r.label!==config.identity||r.tenant_id!==config.tenant||r.store_id!==config.store)throw new Error('WAREHOUSE_SOURCE_MISMATCH');this.identity=r.identity;
 }
 seed(variant:string,location:string,available:number){id(variant);id(location);integer(available);this.db.prepare('INSERT INTO warehouse_stock VALUES(?,?,?)').run(variant,location,available);}
 stock(variant:string,location:string){return (this.db.prepare('SELECT available FROM warehouse_stock WHERE variant=? AND location=?').get(id(variant),id(location)) as Row)?.available??null;}
 async apply(input:unknown){this.calls.apply++;const c=exact(jsonValue(input),['operation_id','source_identity','tenant_id','store_id','request_id','resource_id','native_return_id','location_id','disposition','units']);id(c.operation_id);id(c.request_id);id(c.resource_id);id(c.location_id);
  if(c.source_identity!==this.identity||c.tenant_id!==this.tenant||c.store_id!==this.store)throw new Error('WAREHOUSE_SOURCE_MISMATCH');
  if(!['restock','quarantine','dispose','supplier_return'].includes(c.disposition)||!Array.isArray(c.units)||!c.units.length||c.units.length>100)throw new Error('INVALID_INPUT');
  const seen=new Set<string>();for(const u of c.units){exact(u,['id','line_id','ordinal','variant_id','grade']);id(u.id);id(u.line_id);integer(u.ordinal,1);id(u.variant_id);
   if(seen.has(u.id)||!['sellable','damaged','unknown'].includes(u.grade)||c.disposition==='restock'&&u.grade!=='sellable')throw new Error('DISPOSITION_DENIED');seen.add(u.id);}
  if(this.fault==='hang')return new Promise<never>(()=>{});if(this.fault==='before'){this.fault='none';throw new Error('SOURCE_UNAVAILABLE');}
  let result:Row;this.db.exec('BEGIN IMMEDIATE');try{const old=this.db.prepare('SELECT * FROM warehouse_effects WHERE operation_id=?').get(c.operation_id) as Row;
   if(old){if(old.digest!==contentDigest(c))throw new Error('OPERATION_CONFLICT');result=this.#effect(old);}
   else{for(const u of c.units){const key=contentDigest([c.native_return_id,u.line_id,u.ordinal]);if(this.db.prepare('SELECT 1 FROM warehouse_units WHERE unit_key=?').get(key))throw new Error('UNIT_ALREADY_DISPOSED');
     const observation=this.db.prepare('SELECT body,digest FROM warehouse_return_units WHERE unit_key=?').get(key) as Row;
     if(observation){const effective=JSON.parse(observation.body);if(contentDigest(effective)!==observation.digest)throw new Error('WAREHOUSE_EVENT_INTEGRITY');
      if(!effective.received||effective.variant_id!==u.variant_id||effective.grade!==u.grade||effective.location_id!==c.location_id||effective.disposition!==null)throw new Error('DISPOSITION_DENIED');}
     if(this.stock(u.variant_id,c.location_id)===null)throw new Error('WAREHOUSE_MAPPING_REQUIRED');}
    const adjustments:Row[]=[];for(const u of c.units){this.db.prepare('INSERT INTO warehouse_units VALUES(?,?)').run(contentDigest([c.native_return_id,u.line_id,u.ordinal]),c.operation_id);
     if(c.disposition==='restock'){const changed=this.db.prepare('UPDATE warehouse_stock SET available=available+1 WHERE variant=? AND location=? AND available<9007199254740991').run(u.variant_id,c.location_id);if(changed.changes!==1)throw new Error('STOCK_LIMIT');}
     adjustments.push({unit_id:u.id,variant_id:u.variant_id,location_id:c.location_id,available_delta:c.disposition==='restock'?1:0});}
    result={...c,id:'disp_'+contentDigest(c.operation_id).slice(0,36),state:'applied',adjustments,qualification:'synthetic_only'};
    this.db.prepare('INSERT INTO warehouse_effects VALUES(?,?,?)').run(c.operation_id,contentDigest(c),canonical(result));}
   this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}
  if(this.fault==='after'){this.fault='none';throw new Error('LOST_SOURCE_RESPONSE');}return result;
 }
 #effect(row:Row){
  const b=exact(JSON.parse(row.body),['operation_id','source_identity','tenant_id','store_id','request_id','resource_id','native_return_id','location_id','disposition','units','id','state','adjustments','qualification']);
  const {id:nativeId,state,adjustments,qualification,...command}=b;
  if(contentDigest(command)!==row.digest||b.operation_id!==row.operation_id||b.source_identity!==this.identity||b.tenant_id!==this.tenant||b.store_id!==this.store
   ||nativeId!=='disp_'+contentDigest(row.operation_id).slice(0,36)||state!=='applied'||qualification!=='synthetic_only'||!Array.isArray(b.units)
   ||canonical(adjustments)!==canonical(b.units.map((u:Row)=>({unit_id:u.id,variant_id:u.variant_id,location_id:b.location_id,available_delta:b.disposition==='restock'?1:0}))))throw new Error('WAREHOUSE_EFFECT_INTEGRITY');
  return b;
 }
 async lookup(ref:string){this.calls.lookup++;const r=this.db.prepare('SELECT * FROM warehouse_effects WHERE operation_id=?').get(id(ref)) as Row;return r?this.#effect(r):null;}
 effects(){return (this.db.prepare('SELECT * FROM warehouse_effects ORDER BY operation_id').all() as Row[]).map(r=>this.#effect(r));}

 // Fixture administration records observations in the independently owned warehouse.
 // Importing one of these records into commerce never calls this method again.
 recordReturnEvent(input:unknown){
  const c=exact(jsonValue(input),['event_id','request_id','resource_id','native_return_id','sequence','kind','location_id','operator_id','evidence_ids','completeness','parent_event_id','units']);
  for(const field of ['event_id','request_id','resource_id','location_id','operator_id'])id(c[field]);integer(c.sequence,1);
  if(typeof c.native_return_id!=='string'||!/^[A-Za-z0-9:/_-]{1,200}$/.test(c.native_return_id)||!['delivery','receipt','inspection','disposition','correction'].includes(c.kind)
   ||!['partial','complete'].includes(c.completeness)||!Array.isArray(c.evidence_ids)||c.evidence_ids.length>20||new Set(c.evidence_ids).size!==c.evidence_ids.length
   ||!Array.isArray(c.units)||c.units.length>500)throw new Error('INVALID_INPUT');c.evidence_ids.forEach(id);
  if(['inspection','disposition','correction'].includes(c.kind))id(c.parent_event_id);else if(c.parent_event_id!==null)throw new Error('INVALID_INPUT');
  if(c.kind==='delivery'?c.units.length!==0:c.units.length===0)throw new Error('WAREHOUSE_EVENT_UNITS_INVALID');
  const seen=new Set<string>();for(const u of c.units){exact(u,['line_id','ordinal','variant_id','grade','received','disposition']);id(u.line_id);integer(u.ordinal,1);id(u.variant_id);
   const key=contentDigest([c.native_return_id,u.line_id,u.ordinal]);if(seen.has(key)||!['sellable','damaged','unknown'].includes(u.grade)||typeof u.received!=='boolean'
    ||![null,'restock','quarantine','dispose','supplier_return'].includes(u.disposition)||!u.received&&u.disposition!==null||u.disposition==='restock'&&u.grade!=='sellable')throw new Error('WAREHOUSE_EVENT_UNITS_INVALID');seen.add(key);
   if(c.kind!=='correction'&&!u.received||c.kind==='receipt'&&u.disposition!==null||c.kind==='inspection'&&(u.grade==='unknown'||u.disposition!==null)||c.kind==='disposition'&&u.disposition===null)throw new Error('WAREHOUSE_EVENT_UNITS_INVALID');}
  const eventUnits: Row[] = c.kind === 'delivery' ? [] : c.units;
  this.db.exec('BEGIN IMMEDIATE');try{
   const existing=this.db.prepare('SELECT * FROM warehouse_return_events WHERE event_id=?').get(c.event_id) as Row;
   if(existing){if(existing.input_digest!==contentDigest(c))throw new Error('WAREHOUSE_EVENT_CONFLICT');const result=this.returnEvent(c.event_id)!;this.db.exec('COMMIT');return result;}
   const previous=this.returnEvents(c.native_return_id),last=previous.at(-1);
   if(c.sequence!==(last?.sequence??0)+1)throw new Error('WAREHOUSE_EVENT_SEQUENCE_CHANGED');
   if(previous.some(e=>e.request_id!==c.request_id||e.resource_id!==c.resource_id))throw new Error('WAREHOUSE_RETURN_MISMATCH');
   if(c.parent_event_id!==null&&!previous.some(e=>e.event_id===c.parent_event_id))throw new Error('WAREHOUSE_CORRECTION_PARENT_CHANGED');
   const adjustments:Row[]=[];
   for(const u of eventUnits){const key=contentDigest([c.native_return_id,u.line_id,u.ordinal]),row=this.db.prepare('SELECT * FROM warehouse_return_units WHERE unit_key=?').get(key) as Row;
    const old=row?JSON.parse(row.body):null;if(row&&contentDigest(old)!==row.digest)throw new Error('WAREHOUSE_EVENT_INTEGRITY');
    if(c.kind==='receipt'&&old)throw new Error('WAREHOUSE_UNIT_ALREADY_RECEIVED');
    if(c.parent_event_id!==null&&(!old||row.event_id!==c.parent_event_id))throw new Error('WAREHOUSE_CORRECTION_PARENT_CHANGED');
    if(['inspection','disposition'].includes(c.kind)&&(!old.received||old.disposition!==null||u.variant_id!==old.variant_id||c.location_id!==old.location_id
     ||c.kind==='disposition'&&u.grade!==old.grade))throw new Error('WAREHOUSE_EVENT_UNITS_INVALID');
    const fence=this.db.prepare('SELECT operation_id FROM warehouse_units WHERE unit_key=?').get(key) as Row;
    if(fence&&!previous.some(e=>e.event_id===fence.operation_id))throw new Error('WAREHOUSE_LOCAL_DISPOSITION_RECONCILIATION_REQUIRED');
    const before=old?.received&&old.disposition==='restock',after=u.received&&u.disposition==='restock';
    const same=before&&after&&old.variant_id===u.variant_id&&old.location_id===c.location_id;
    const adjust=(variant:string,location:string,delta:number)=>{
     const stock=this.stock(variant,location);if(stock===null)throw new Error('WAREHOUSE_MAPPING_REQUIRED');
     const next=stock+delta;if(!Number.isSafeInteger(next)||next<0)throw new Error('WAREHOUSE_STOCK_CORRECTION_CONFLICT');
     this.db.prepare('UPDATE warehouse_stock SET available=? WHERE variant=? AND location=?').run(next,variant,location);
     adjustments.push({unit_id:'whunit_'+key.slice(0,40),line_id:u.line_id,ordinal:u.ordinal,variant_id:variant,location_id:location,available_delta:delta,source_event_id:c.event_id,parent_event_id:c.parent_event_id});
    };
    if(!same&&before)adjust(old.variant_id,old.location_id,-1);if(!same&&after)adjust(u.variant_id,c.location_id,1);
    if(u.disposition!==null)this.db.prepare('INSERT OR IGNORE INTO warehouse_units VALUES(?,?)').run(key,c.event_id);
    const effective={...u,location_id:c.location_id};this.db.prepare('INSERT INTO warehouse_return_units VALUES(?,?,?,?) ON CONFLICT(unit_key) DO UPDATE SET event_id=excluded.event_id,body=excluded.body,digest=excluded.digest').run(key,c.event_id,canonical(effective),contentDigest(effective));
   }
   const result={...c,units:eventUnits,source_identity:this.identity,tenant_id:this.tenant,store_id:this.store,adjustments,qualification:'synthetic_only'},digest=contentDigest(result);
   this.db.prepare('INSERT INTO warehouse_return_events VALUES(?,?,?,?,?,?)').run(c.event_id,c.native_return_id,c.sequence,contentDigest(c),canonical(result),digest);
   this.db.exec('COMMIT');return {...result,digest};
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 returnEvent(eventId:string){const row=this.db.prepare('SELECT * FROM warehouse_return_events WHERE event_id=?').get(id(eventId)) as Row;if(!row)return null;
  const b=JSON.parse(row.body);if(contentDigest(b)!==row.digest||b.event_id!==row.event_id||b.native_return_id!==row.native_return_id||b.sequence!==row.sequence
   ||b.source_identity!==this.identity||b.tenant_id!==this.tenant||b.store_id!==this.store||b.qualification!=='synthetic_only')throw new Error('WAREHOUSE_EVENT_INTEGRITY');
  const {source_identity,tenant_id,store_id,adjustments,qualification,...command}=b;
  if(contentDigest(command)!==row.input_digest)throw new Error('WAREHOUSE_EVENT_INTEGRITY');return {...b,digest:row.digest};
 }
 returnEvents(nativeReturnId?:string){const rows=(nativeReturnId===undefined?this.db.prepare('SELECT event_id FROM warehouse_return_events ORDER BY native_return_id,sequence').all():
  this.db.prepare('SELECT event_id FROM warehouse_return_events WHERE native_return_id=? ORDER BY sequence').all(nativeReturnId)) as Row[];return rows.map(row=>this.returnEvent(row.event_id)!);}
}
