import { readFileSync } from 'node:fs';
import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { exact,id,integer } from './kernel.mts';
import { canonical,contentDigest } from './configuration-values.mts';
import { subjectHash } from './data-guards.mts';

const MAX_RECORDS=10000;
const all=(k:CommerceKernel,table:string,t:string,s:string)=>k.db.prepare(`SELECT * FROM ${table} WHERE tenant_id=? AND store_id=?`).all(t,s) as Row[];
const where=(ids:string[])=>ids.map(()=>'?').join(',');
export function storageInventory(k:CommerceKernel) {
  const declared=JSON.parse(readFileSync(new URL('./contracts/storage-inventory.v1.json',import.meta.url),'utf8'));
  const actual=(k.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Row[])
    .map(r=>({name:r.name,columns:(k.db.prepare('PRAGMA table_info('+r.name+')').all() as Row[]).map(c=>c.name)}));
  if(contentDigest(actual)!==declared.schema_digest)throw new Error('STORAGE_INVENTORY_CHANGED');
  return declared;
}
function event(k:CommerceKernel,s:Row,hash:string,code:string,reason:string) {
  k.db.prepare('INSERT INTO commerce_privacy_events(tenant_id,store_id,subject_hash,event,reason,observed_at) VALUES(?,?,?,?,?,?)').run(s.tenant_id,s.store_id,hash,code,reason,k.clock());
}
function resources(k:CommerceKernel,s:Row,customer:string):Row[] {
  const rows=all(k,'commerce_resources',s.tenant_id,s.store_id);if(rows.length>MAX_RECORDS)throw new Error('PRIVACY_BATCH_LIMIT');
  const direct=rows.filter(r=>r.customer_id===customer||(r.kind==='customer'&&r.external_id===customer));
  const parents=direct.filter(r=>r.kind==='order');
  return rows.filter(r=>direct.includes(r)||parents.some(p=>r.source_system===p.source_system&&['shipment','payment'].includes(r.kind)&&
    [p.id,p.external_id].some(v=>[JSON.parse(r.payload).order_id,JSON.parse(r.payload).order_number].includes(v))));
}
function scrubRecord(k:CommerceKernel,table:string,t:string,s:string,keys:string[],column='id') {
  if(!keys.length)return;
  for(const row of all(k,table,t,s).filter(r=>keys.includes(r[column]))) {
    const original=row.digest??contentDigest(row.body);
    const body=canonical({redacted:true,original_digest:original});
    const suffix=Object.hasOwn(row,'digest')?',digest=?':'';
    // Each supported body table has an id or a compound case identity.
    const pk=(k.db.prepare('PRAGMA table_info('+table+')').all() as Row[]).filter(c=>c.pk).sort((a,b)=>a.pk-b.pk).map(c=>c.name);
    k.db.prepare(`UPDATE ${table} SET body=?${suffix} WHERE ${pk.map(c=>c+'=?').join(' AND ')}`).run(body,...(suffix?[contentDigest(JSON.parse(body))]:[]),...pk.map(c=>row[c]));
  }
}
// Requires caller-owned transaction and explicit resource identities. Also used to replay
// an independently retained erasure checkpoint before a restored database is exposed.
export function eraseSelected(k:CommerceKernel,s:Row,ids:string[],hash:string,at:number) {
  storageInventory(k);if(ids.length>MAX_RECORDS)throw new Error('PRIVACY_BATCH_LIMIT');
  const t=s.tenant_id,st=s.store_id,erased='{"redacted":true}';
  k.db.prepare('INSERT OR IGNORE INTO commerce_privacy_subjects VALUES(?,?,?,?)').run(t,st,hash,at);
  for(const resource of ids)k.db.prepare('INSERT OR IGNORE INTO commerce_privacy_resources VALUES(?,?,?,?,?)').run(t,st,resource,hash,at);
  if(ids.length) {
    const marks=where(ids),args=[t,st,...ids];
    for(const table of ['commerce_attachments','commerce_read_jobs','commerce_order_observations','commerce_woocommerce_observations'])
      k.db.prepare(`DELETE FROM ${table} WHERE tenant_id=? AND store_id=? AND resource_id IN (${marks})`).run(...args);
    scrubRecord(k,'commerce_edit_snapshots',t,st,ids,'resource_id');
    scrubRecord(k,'commerce_edit_inputs',t,st,ids,'resource_id');
    scrubRecord(k,'commerce_edit_quotes',t,st,ids,'resource_id');
    const tasks=all(k,'commerce_context_tasks',t,st).filter(r=>ids.includes(r.resource_id)).map(r=>r.id);
    if(tasks.length){k.db.prepare(`DELETE FROM commerce_assistance_receipts WHERE tenant_id=? AND store_id=? AND task_id IN (${where(tasks)})`).run(t,st,...tasks);
      k.db.prepare(`DELETE FROM commerce_context_tasks WHERE tenant_id=? AND store_id=? AND id IN (${where(tasks)})`).run(t,st,...tasks);}
    const cases=all(k,'commerce_cases',t,st).filter(r=>ids.includes(r.resource_id)).map(r=>r.id);
    if(cases.length) {
      const cargs=[t,st,...cases],cm=where(cases);
      k.db.prepare(`UPDATE commerce_return_evidence SET state='erased',bytes=NULL,note='',scanner=NULL WHERE tenant_id=? AND store_id=? AND case_id IN (${cm})`).run(...cargs);
      for(const table of ['commerce_inventory_reservations','commerce_return_parcels','commerce_fulfillment_quotes','commerce_return_labels','commerce_resolution_plans','commerce_resolution_allocations','commerce_resolution_quotes','commerce_exchange_quotes'])scrubRecord(k,table,t,st,cases,'case_id');
      const fulfillmentOps=all(k,'commerce_fulfillment_operations',t,st).filter(r=>cases.includes(r.case_id)).map(r=>r.id);
      scrubRecord(k,'commerce_replacement_orders',t,st,fulfillmentOps,'operation_id');
      scrubRecord(k,'commerce_lifecycle_quotes',t,st,cases,'case_id');
      scrubRecord(k,'commerce_return_quotes',t,st,cases,'case_id');scrubRecord(k,'commerce_return_requests',t,st,cases,'case_id');
      k.db.prepare(`UPDATE commerce_return_overrides SET revoked=1 WHERE tenant_id=? AND store_id=? AND quote_id IN (SELECT id FROM commerce_return_quotes WHERE tenant_id=? AND store_id=? AND case_id IN (${cm}))`).run(t,st,...cargs);
      k.db.prepare(`UPDATE commerce_worker_grants SET revoked=1 WHERE tenant_id=? AND store_id=? AND case_id IN (${cm})`).run(...cargs);
      k.db.prepare(`UPDATE commerce_case_work SET state='revoked',expires_at=0 WHERE tenant_id=? AND store_id=? AND case_id IN (${cm})`).run(...cargs);
      k.db.prepare(`UPDATE commerce_action_approvals SET revoked=1 WHERE tenant_id=? AND store_id=? AND preview_id IN (SELECT id FROM commerce_action_previews WHERE tenant_id=? AND store_id=? AND case_id IN (${cm}))`).run(t,st,...cargs);
      scrubRecord(k,'commerce_case_configurations',t,st,cases,'case_id');scrubRecord(k,'commerce_action_previews',t,st,cases,'case_id');
      scrubRecord(k,'commerce_worker_submissions',t,st,cases,'case_id');scrubRecord(k,'commerce_worker_completions',t,st,cases,'case_id');
      const submissions=all(k,'commerce_worker_submissions',t,st).filter(r=>cases.includes(r.case_id)).map(r=>r.id);
      scrubRecord(k,'commerce_worker_effects',t,st,submissions,'submission_id');
      k.db.prepare(`UPDATE commerce_cases SET customer_id=?,verification_hash=NULL WHERE tenant_id=? AND store_id=? AND id IN (${cm})`).run('erased_'+hash.slice(0,32),...cargs);
    }
    k.db.prepare(`DELETE FROM commerce_receipt_payloads WHERE tenant_id=? AND store_id=? AND receipt_id IN (SELECT r.id FROM commerce_operation_receipts r JOIN commerce_operations o ON r.tenant_id=o.tenant_id AND r.store_id=o.store_id AND r.operation_id=o.id WHERE o.tenant_id=? AND o.store_id=? AND o.resource_id IN (${marks}))`).run(t,st,...args);
    k.db.prepare(`DELETE FROM commerce_sessions WHERE tenant_id=? AND store_id=? AND resource_id IN (${marks})`).run(...args);
    k.db.prepare(`DELETE FROM commerce_challenges WHERE tenant_id=? AND store_id=? AND resource_id IN (${marks})`).run(...args);
    k.db.prepare(`UPDATE commerce_resources SET payload=?,customer_id=NULL,external_id='erased_'||id WHERE tenant_id=? AND store_id=? AND id IN (${marks})`).run(erased,...args);
  }
  // Free-text references and raw inbox bodies can be unattributed. Conservatively purge
  // the store's unbound copies rather than assert that a keyword search found all PII.
  k.db.prepare(`DELETE FROM commerce_knowledge WHERE tenant_id=? AND store_id=? AND (resource_id IS NULL${ids.length?' OR resource_id IN ('+where(ids)+')':''})`).run(t,st,...ids);
  k.db.prepare("UPDATE commerce_webhook_inbox SET body=?,metadata=?,status='quarantined' WHERE tenant_id=? AND store_id=?").run(Buffer.from(erased),erased,t,st);
  k.db.prepare('DELETE FROM commerce_simulator_receipts WHERE tenant_id=? AND store_id=?').run(t,st);
  k.db.prepare("UPDATE commerce_policy_pins SET facts=? WHERE tenant_id=? AND store_id=?").run(erased,t,st);
  event(k,s,hash,'logical_erasure','customer_request');
  return {status:'logically_erased',resource_count:ids.length,retained:'minimized_operation_audit_and_configuration_records',
    collateral_cleanup:['unbound_store_knowledge','raw_store_webhook_bodies','simulator_response_cache','policy_test_facts'],
    external_cleanup_required:['caller_memory','delivery_outboxes','logs','external_providers','older_backups'],physical_erasure:false};
}
export function suppressionCheckpoint(k:CommerceKernel) {
  storageInventory(k);const subjects=k.db.prepare('SELECT * FROM commerce_privacy_subjects ORDER BY tenant_id,store_id,subject_hash').all();
  const records=k.db.prepare('SELECT * FROM commerce_privacy_resources ORDER BY tenant_id,store_id,resource_id').all();
  return {version:1,generated_at:k.clock(),subjects,resources:records};
}
export class PrivacyLifecycle {
  #k:CommerceKernel;constructor(kernel:CommerceKernel){this.#k=kernel;}
  export(scope:Scope,customer:string) {
    const k=this.#k,s=k.authorize(scope,'privacy.manage');id(customer);storageInventory(k);
    return k.transaction(()=>{k.authorize(scope,'privacy.manage');const rs=resources(k,s,customer),ids=rs.map(r=>r.id);if(!rs.length)throw new Error('NOT_FOUND');
      const tasks=all(k,'commerce_context_tasks',s.tenant_id,s.store_id).filter(r=>ids.includes(r.resource_id));
      const cases=all(k,'commerce_cases',s.tenant_id,s.store_id).filter(r=>ids.includes(r.resource_id));
      const caseIds=cases.map(r=>r.id),operations=all(k,'commerce_operations',s.tenant_id,s.store_id).filter(r=>ids.includes(r.resource_id));
      const fulfillmentOps=all(k,'commerce_fulfillment_operations',s.tenant_id,s.store_id).filter(r=>ids.includes(r.resource_id)),fulfillmentOpIds=fulfillmentOps.map(r=>r.id),labelIds=all(k,'commerce_return_labels',s.tenant_id,s.store_id).filter(r=>ids.includes(r.resource_id)).map(r=>r.id);
      const receipts=all(k,'commerce_operation_receipts',s.tenant_id,s.store_id).filter(r=>operations.some(o=>o.id===r.operation_id));
      const returnIds=all(k,'commerce_return_requests',s.tenant_id,s.store_id).filter(r=>ids.includes(r.resource_id)).map(r=>r.id),sessionIds=all(k,'commerce_receiving_sessions',s.tenant_id,s.store_id).filter(r=>returnIds.includes(r.request_id)).map(r=>r.id);
      const editIds=all(k,'commerce_order_edits',s.tenant_id,s.store_id).filter(r=>ids.includes(r.resource_id)).map(r=>r.id);
      const order_edit_records=Object.fromEntries(['commerce_edit_snapshots','commerce_edit_inputs','commerce_edit_quotes','commerce_order_edits','commerce_edit_steps','commerce_edit_events'].map(table=>[table,all(k,table,s.tenant_id,s.store_id).filter(r=>ids.includes(r.resource_id)||editIds.includes(r.edit_id))]));
      const result={order_edit_records,schema_version:1,tenant_id:s.tenant_id,store_id:s.store_id,subject_ref:subjectHash(s.tenant_id,s.store_id,customer),
        resources:rs.map(r=>k.project(r)),attachments:all(k,'commerce_attachments',s.tenant_id,s.store_id).filter(r=>ids.includes(r.resource_id)).map(r=>({id:r.id,resource_id:r.resource_id,content:JSON.parse(r.content)})),
        knowledge:all(k,'commerce_knowledge',s.tenant_id,s.store_id).filter(r=>ids.includes(r.resource_id)),
        tasks,assistance:all(k,'commerce_assistance_receipts',s.tenant_id,s.store_id).filter(r=>tasks.some(t=>t.id===r.task_id)),
        return_evidence:all(k,'commerce_return_evidence',s.tenant_id,s.store_id).filter(r=>ids.includes(r.resource_id)).map(r=>({...r,bytes:r.bytes?Buffer.from(r.bytes).toString('base64'):null})),
        return_requests:all(k,'commerce_return_requests',s.tenant_id,s.store_id).filter(r=>ids.includes(r.resource_id)),
        resolution_records:Object.fromEntries(['commerce_resolution_plans','commerce_resolution_allocations','commerce_resolution_quotes','commerce_resolution_operations','commerce_resolution_observations','commerce_exchange_quotes'].map(table=>[table,all(k,table,s.tenant_id,s.store_id).filter(r=>ids.includes(r.resource_id))])),
        fulfillment_records:{operations:fulfillmentOps,observations:all(k,'commerce_fulfillment_observations',s.tenant_id,s.store_id).filter(r=>fulfillmentOpIds.includes(r.operation_id)),replacement_orders:all(k,'commerce_replacement_orders',s.tenant_id,s.store_id).filter(r=>fulfillmentOpIds.includes(r.operation_id)),carrier_events:all(k,'commerce_carrier_events',s.tenant_id,s.store_id).filter(r=>labelIds.includes(r.label_id)),...Object.fromEntries(['commerce_inventory_reservations','commerce_return_parcels','commerce_fulfillment_quotes','commerce_return_labels'].map(table=>[table,all(k,table,s.tenant_id,s.store_id).filter(r=>ids.includes(r.resource_id))]))},
        return_completion_records:Object.fromEntries(['commerce_receiving_sessions','commerce_receiving_scans','commerce_received_units','commerce_receiving_reviews','commerce_lifecycle_quotes','commerce_disposition_operations','commerce_lifecycle_observations','commerce_return_closures','commerce_return_lifecycle_events','commerce_native_change_snapshots','commerce_native_completed_units','commerce_native_receipts','commerce_return_workflow_pins'].map(table=>[table,all(k,table,s.tenant_id,s.store_id).filter(r=>returnIds.includes(r.request_id)||sessionIds.includes(r.session_id))])),
        return_quotes:all(k,'commerce_return_quotes',s.tenant_id,s.store_id).filter(r=>ids.includes(r.resource_id)),
        cases,configurations:all(k,'commerce_case_configurations',s.tenant_id,s.store_id).filter(r=>caseIds.includes(r.case_id)),
        previews:all(k,'commerce_action_previews',s.tenant_id,s.store_id).filter(r=>caseIds.includes(r.case_id)),operations,audit_receipts:receipts,
        customer_notes:all(k,'commerce_receipt_payloads',s.tenant_id,s.store_id).filter(r=>receipts.some(a=>a.id===r.receipt_id)),
        unbound_text_requires_manual_scope_review:true,operational_records_retained:true,credentials_included:false,generated_at:k.clock()};
      if(Buffer.byteLength(JSON.stringify(result))>4*1024*1024)throw new Error('PRIVACY_EXPORT_LIMIT');return result;});
  }
  hold(scope:Scope,input:unknown) {
    const k=this.#k,p=exact(input,['customer_id','reason','authority_ref','expires_at']);id(p.customer_id);id(p.authority_ref);integer(p.expires_at,1);
    if(!['dispute','retention_obligation','investigation'].includes(p.reason)||p.expires_at<=k.clock()||p.expires_at>k.clock()+366*86400000)throw new Error('INVALID_INPUT');
    return k.transaction(()=>{const s=k.authorize(scope,'privacy.manage');if(!resources(k,s,p.customer_id).length)throw new Error('NOT_FOUND');const hash=subjectHash(s.tenant_id,s.store_id,p.customer_id);
      k.db.prepare(`INSERT INTO commerce_privacy_holds VALUES(?,?,?,?,?,?,0) ON CONFLICT(tenant_id,store_id,subject_hash) DO UPDATE SET reason=excluded.reason,authority_ref=excluded.authority_ref,expires_at=excluded.expires_at,released=0`).run(s.tenant_id,s.store_id,hash,p.reason,p.authority_ref,p.expires_at);
      event(k,s,hash,'hold_created',p.reason);return {subject_hash:hash,expires_at:p.expires_at};});
  }
  releaseHold(scope:Scope,customer:string,authorityRef:string) {id(customer);id(authorityRef);const k=this.#k;
    return k.transaction(()=>{const s=k.authorize(scope,'privacy.manage'),hash=subjectHash(s.tenant_id,s.store_id,customer);
      const r=k.db.prepare('UPDATE commerce_privacy_holds SET released=1 WHERE tenant_id=? AND store_id=? AND subject_hash=? AND authority_ref=?').run(s.tenant_id,s.store_id,hash,authorityRef);
      if(r.changes!==1)throw new Error('HOLD_NOT_FOUND');event(k,s,hash,'hold_released','explicit_authority');return {released:true};});
  }
  erase(scope:Scope,customer:string) {id(customer);const k=this.#k;
    return k.transaction(()=>{const s=k.authorize(scope,'privacy.manage');storageInventory(k);const hash=subjectHash(s.tenant_id,s.store_id,customer);
      const hold=k.db.prepare('SELECT reason,authority_ref,expires_at FROM commerce_privacy_holds WHERE tenant_id=? AND store_id=? AND subject_hash=? AND released=0 AND expires_at>?').get(s.tenant_id,s.store_id,hash,k.clock());
      if(hold){event(k,s,hash,'erasure_held','configured_hold');return {status:'held',hold,erased:false};}
      if(k.db.prepare('SELECT 1 FROM commerce_privacy_subjects WHERE tenant_id=? AND store_id=? AND subject_hash=?').get(s.tenant_id,s.store_id,hash))return {status:'already_erased'};
      const rs=resources(k,s,customer);if(!rs.length)throw new Error('NOT_FOUND');return eraseSelected(k,s,rs.map(r=>r.id),hash,k.clock());});
  }
  uninstall(scope:Scope) {
    const k=this.#k;return k.transaction(()=>{const s=k.authorize(scope,'privacy.manage');storageInventory(k);
      const rs=all(k,'commerce_resources',s.tenant_id,s.store_id);const customers=[...new Set(rs.flatMap(r=>r.customer_id?[r.customer_id]:r.kind==='customer'?[r.external_id]:[]))];
      const results=customers.map(c=>this.erase(scope,c));
      k.db.prepare('UPDATE commerce_secrets SET revoked=1,envelope=? WHERE tenant_id=? AND store_id=?').run('{}',s.tenant_id,s.store_id);
      for(const [table,clause] of [['commerce_sessions','revoked=1'],['commerce_worker_grants','revoked=1'],['commerce_credential_slots','active=0'],['commerce_webhook_routes','enabled=0'],['commerce_execution_settings','enabled=0'],['commerce_action_readiness','revoked=1']])
        k.db.prepare(`UPDATE ${table} SET ${clause} WHERE tenant_id=? AND store_id=?`).run(s.tenant_id,s.store_id);
      k.db.prepare('UPDATE commerce_stores SET active=0 WHERE tenant_id=? AND store_id=?').run(s.tenant_id,s.store_id);
      return {status:'disconnected',results,held_records_access:'server_local_retention_administration_only',physical_deletion:false};});
  }
}
