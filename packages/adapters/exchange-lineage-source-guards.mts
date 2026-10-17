import type { DatabaseSync } from 'node:sqlite';
import { exact,id,integer } from '../commerce/kernel.mts';
import type { Row } from '../commerce/kernel.mts';
import { canonical,contentDigest,jsonValue } from '../commerce/configuration-values.mts';

export function lineageSourceTables(db:DatabaseSync){
 db.exec(`CREATE TABLE IF NOT EXISTS fixture_exchange_lineage_nodes(operation_id TEXT PRIMARY KEY,resource_id TEXT NOT NULL UNIQUE,parent_resource_id TEXT NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS fixture_exchange_lineage_units(resource_id TEXT NOT NULL,line_id TEXT NOT NULL,unit_index INTEGER NOT NULL,operation_id TEXT NOT NULL,PRIMARY KEY(resource_id,line_id,unit_index));
 CREATE TABLE IF NOT EXISTS fixture_exchange_lineage_bindings(operation_id TEXT PRIMARY KEY,resource_id TEXT NOT NULL,allocation_id TEXT NOT NULL,native_return_id TEXT NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL);`);
}
function exists(db:DatabaseSync){return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='fixture_exchange_lineage_nodes'").get();}
function checked(row:Row|undefined){if(!row)return null;const value=JSON.parse(row.body);if(contentDigest(value)!==row.digest)throw new Error('LINEAGE_SOURCE_INTEGRITY');return value;}
function relevant(db:DatabaseSync,resource:string){return exists(db)&&!!db.prepare('SELECT 1 FROM fixture_exchange_lineage_nodes WHERE resource_id=? OR parent_resource_id=?').get(resource,resource);}
function consumed(db:DatabaseSync,resource:string,line:string,units:number[]){return units.some(n=>db.prepare('SELECT 1 FROM fixture_exchange_lineage_units WHERE resource_id=? AND line_id=? AND unit_index=?').get(resource,line,n));}

/** Server-local pretransport binding; not an API supplied assertion. */
export function bindLineageResolution(db:DatabaseSync,command:Row,input:unknown){
 if(!exists(db))return;
 const p=exact(jsonValue(input),['line_id','units']);id(p.line_id);
 if(!Array.isArray(p.units)||!p.units.length||p.units.length>100||new Set(p.units).size!==p.units.length)throw new Error('LINEAGE_UNIT_INVALID');
 p.units.forEach((n:number)=>integer(n,1));p.units.sort((a:number,b:number)=>a-b);
 const body={operation_id:command.operation_id,resource_id:command.resource_id,allocation_id:command.allocation_id,native_return_id:command.native_return_id,line_id:p.line_id,units:p.units,command_digest:contentDigest(command)};
 db.exec('BEGIN IMMEDIATE');try{
  const cached=db.prepare('SELECT digest FROM fixture_resolution_effects WHERE operation_id=?').get(command.operation_id) as Row;
  if(cached){if(cached.digest!==body.command_digest)throw new Error('LINEAGE_COMMAND_CHANGED');db.exec('COMMIT');return;}
  if(consumed(db,body.resource_id,body.line_id,body.units))throw new Error('LINEAGE_PARENT_ALREADY_CONSUMED');
  const node=checked(db.prepare('SELECT body,digest FROM fixture_exchange_lineage_nodes WHERE resource_id=?').get(body.resource_id) as Row);
  if(node&&(body.line_id!==node.line_id||body.units.some((n:number)=>n>node.quantity)))throw new Error('LINEAGE_UNIT_INVALID');
  const prior=checked(db.prepare('SELECT body,digest FROM fixture_exchange_lineage_bindings WHERE operation_id=?').get(body.operation_id) as Row);
  if(prior&&canonical(prior)!==canonical(body))throw new Error('LINEAGE_COMMAND_CHANGED');
  if(!prior)db.prepare('INSERT INTO fixture_exchange_lineage_bindings VALUES(?,?,?,?,?,?)').run(body.operation_id,body.resource_id,body.allocation_id,body.native_return_id,canonical(body),contentDigest(body));
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
}

/** Called inside the financial authority transaction, even when transport fields vanished. */
export function assertLineageResolution(db:DatabaseSync,command:Row){
 if(!exists(db))return;
 const bindings=(db.prepare('SELECT body,digest FROM fixture_exchange_lineage_bindings WHERE operation_id=? OR allocation_id=? OR native_return_id=?').all(command.operation_id,command.allocation_id,command.native_return_id) as Row[]).map(checked);
 for(const b of bindings)if((b.operation_id===command.operation_id||b.allocation_id===command.allocation_id)&&b.command_digest!==contentDigest(command))throw new Error('LINEAGE_COMMAND_CHANGED');
 const old=db.prepare('SELECT digest FROM fixture_resolution_effects WHERE operation_id=?').get(command.operation_id) as Row;
 if(old){if(old.digest!==contentDigest(command))throw new Error('LINEAGE_COMMAND_CHANGED');return;}
 if(!relevant(db,command.resource_id))return;
 const b=bindings.find(b=>b.operation_id===command.operation_id);
 if(!b||b.command_digest!==contentDigest(command)||b.resource_id!==command.resource_id)throw new Error('LINEAGE_SOURCE_BINDING_REQUIRED');
 if(consumed(db,b.resource_id,b.line_id,b.units))throw new Error('LINEAGE_PARENT_ALREADY_CONSUMED');
 const node=checked(db.prepare('SELECT body,digest FROM fixture_exchange_lineage_nodes WHERE resource_id=?').get(command.resource_id) as Row);
 if(node&&(b.line_id!==node.line_id||b.units.some((n:number)=>n>node.quantity)||command.payment_id!==node.payment_id||command.customer_id!==node.customer_id||command.currency!==node.currency))throw new Error('LINEAGE_SOURCE_MISMATCH');
}
