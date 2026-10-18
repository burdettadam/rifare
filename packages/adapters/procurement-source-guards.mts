import type { DatabaseSync } from 'node:sqlite';
import type { Row } from '../commerce/kernel.mts';
import { canonical,contentDigest } from '../commerce/configuration-values.mts';

const activeGuards=new WeakMap<DatabaseSync,Map<string,()=>void>>();
/** Durable binding is source-owned. Losing an in-process grant denies new effects;
 * lookup of a previously committed original operation remains available. */
export function bindProcurementSourceGuard(db:DatabaseSync,command:Row,authorize:()=>void){
 db.exec('CREATE TABLE IF NOT EXISTS fixture_procurement_guards(operation_id TEXT PRIMARY KEY,po_id TEXT NOT NULL,po_version INTEGER NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL,UNIQUE(po_id,po_version)) STRICT');
 const body={operation_id:command.operation_id,po_id:command.po_id,po_version:command.po_version,tenant_id:command.tenant_id,store_id:command.store_id,
  source_identity:command.source_identity,resource_id:command.resource_id,command_digest:contentDigest(command)};
 const old=db.prepare('SELECT * FROM fixture_procurement_guards WHERE po_id=? AND po_version=?').get(command.po_id,command.po_version) as Row|undefined;
 if(old){if(contentDigest(JSON.parse(old.body))!==old.digest||old.operation_id!==command.operation_id||old.digest!==contentDigest(body))throw new Error('PROCUREMENT_GUARD_ORIGINAL_REQUIRED');}
 else db.prepare('INSERT INTO fixture_procurement_guards VALUES(?,?,?,?,?)').run(command.operation_id,command.po_id,command.po_version,canonical(body),contentDigest(body));
 let map=activeGuards.get(db);if(!map){map=new Map();activeGuards.set(db,map);}map.set(command.operation_id,authorize);
 return ()=>{if(map!.get(command.operation_id)===authorize)map!.delete(command.operation_id);};
}
export function assertProcurementSourceEffect(db:DatabaseSync,command:Row){
 const exists=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='fixture_procurement_guards'").get();
 const row=exists?db.prepare('SELECT * FROM fixture_procurement_guards WHERE operation_id=?').get(command.operation_id) as Row|undefined:undefined;
 if(!row)throw new Error('PROCUREMENT_GUARD_REQUIRED');
 const binding=JSON.parse(row.body);
 if(contentDigest(binding)!==row.digest||binding.command_digest!==contentDigest(command)||binding.source_identity!==command.source_identity
  ||binding.po_id!==command.po_id||binding.po_version!==command.po_version)throw new Error('PROCUREMENT_GUARD_BINDING_CHANGED');
 const guard=activeGuards.get(db)?.get(command.operation_id);if(!guard)throw new Error('PROCUREMENT_GUARD_REQUIRED');guard();
}
