import type { DatabaseSync } from 'node:sqlite';
import type { Row } from '../commerce/kernel.mts';
import { id } from '../commerce/kernel.mts';
import { canonical, contentDigest } from '../commerce/configuration-values.mts';

const guards=new WeakMap<DatabaseSync,Map<string,()=>void>>();
/** A durable original-source obligation is independent of an adapter instance.
 * Losing its in-process authorization callback disables new effects. */
export function bindWarrantySourceGuard(db:DatabaseSync,command:Row,binding:Row,authorize:()=>void){
  id(command.operation_id);id(binding.claim_id);id(binding.registration_id);
  db.exec('CREATE TABLE IF NOT EXISTS fixture_warranty_guards(operation_id TEXT PRIMARY KEY,body TEXT NOT NULL,digest TEXT NOT NULL)');
  const body={operation_id:command.operation_id,tenant_id:command.tenant_id,store_id:command.store_id,resource_id:command.resource_id,customer_id:command.customer_id,source_identity:command.source_identity,command_digest:contentDigest(command),claim_id:binding.claim_id,registration_id:binding.registration_id,claim_digest:binding.claim_digest};
  const old=db.prepare('SELECT body,digest FROM fixture_warranty_guards WHERE operation_id=?').get(command.operation_id) as Row|undefined;
  if(old){if(contentDigest(JSON.parse(old.body))!==old.digest||old.digest!==contentDigest(body))throw new Error('CLAIM_GUARD_BINDING_CHANGED');}
  else db.prepare('INSERT INTO fixture_warranty_guards VALUES(?,?,?)').run(command.operation_id,canonical(body),contentDigest(body));
  let map=guards.get(db);if(!map){map=new Map();guards.set(db,map);}map.set(command.operation_id,authorize);
}
export function assertWarrantySourceEffect(db:DatabaseSync,command:Row){
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='fixture_warranty_guards'").get())return;
  const row=db.prepare('SELECT body,digest FROM fixture_warranty_guards WHERE operation_id=?').get(command.operation_id) as Row|undefined;
  if(!row)return;
  const binding=JSON.parse(row.body);
  if(contentDigest(binding)!==row.digest||binding.command_digest!==contentDigest(command)||binding.resource_id!==command.resource_id||binding.customer_id!==command.customer_id||binding.source_identity!==command.source_identity)throw new Error('CLAIM_GUARD_BINDING_CHANGED');
  const guard=guards.get(db)?.get(command.operation_id);if(!guard)throw new Error('CLAIM_GUARD_UNAVAILABLE');guard();
}
