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
   CREATE TABLE IF NOT EXISTS warehouse_units(unit_key TEXT PRIMARY KEY,operation_id TEXT NOT NULL) STRICT;`);
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
   if(old){if(old.digest!==contentDigest(c))throw new Error('OPERATION_CONFLICT');result=JSON.parse(old.body);}
   else{for(const u of c.units){const key=contentDigest([c.native_return_id,u.line_id,u.ordinal]);if(this.db.prepare('SELECT 1 FROM warehouse_units WHERE unit_key=?').get(key))throw new Error('UNIT_ALREADY_DISPOSED');
     if(this.stock(u.variant_id,c.location_id)===null)throw new Error('WAREHOUSE_MAPPING_REQUIRED');}
    const adjustments:Row[]=[];for(const u of c.units){this.db.prepare('INSERT INTO warehouse_units VALUES(?,?)').run(contentDigest([c.native_return_id,u.line_id,u.ordinal]),c.operation_id);
     if(c.disposition==='restock'){const changed=this.db.prepare('UPDATE warehouse_stock SET available=available+1 WHERE variant=? AND location=? AND available<9007199254740991').run(u.variant_id,c.location_id);if(changed.changes!==1)throw new Error('STOCK_LIMIT');}
     adjustments.push({unit_id:u.id,variant_id:u.variant_id,location_id:c.location_id,available_delta:c.disposition==='restock'?1:0});}
    result={...c,id:'disp_'+contentDigest(c.operation_id).slice(0,36),state:'applied',adjustments,qualification:'synthetic_only'};
    this.db.prepare('INSERT INTO warehouse_effects VALUES(?,?,?)').run(c.operation_id,contentDigest(c),canonical(result));}
   this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}
  if(this.fault==='after'){this.fault='none';throw new Error('LOST_SOURCE_RESPONSE');}return result;
 }
 async lookup(ref:string){this.calls.lookup++;const r=this.db.prepare('SELECT body FROM warehouse_effects WHERE operation_id=?').get(id(ref)) as Row;return r?JSON.parse(r.body):null;}
 effects(){return (this.db.prepare('SELECT body FROM warehouse_effects ORDER BY operation_id').all() as Row[]).map(r=>JSON.parse(r.body));}
}
