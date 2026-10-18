import {DatabaseSync} from 'node:sqlite';
import {openSync,closeSync,chmodSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import type {CommerceKernel,Scope,Row} from './kernel.mts';
import {canonical,contentDigest,jsonValue} from './configuration-values.mts';
import {merchantSnapshotDigest} from './merchant-portability.mts';
import {nativeReturnRequest,nativeGid} from '../adapters/shopify-return-fixture.mts';
import {permissionDecision} from './authorization.mts';
import {MIGRATION_BINDING_KIND,MIGRATION_BINDING_ID,MIGRATION_SENTINELS,migrationBinding,migrationId,commerceDatabaseFile,openMigrationCoordinator,lockMigrationCoordinator} from './migration-fence.mts';
import type {MigrationBinding} from './migration-fence.mts';

const HISTORY:Record<string,readonly string[]>={
 commerce_resources:['id','kind','source_system','external_id','source_version','source_updated_at','customer_id','payload'],
 commerce_cases:['id','revision','resource_id','customer_id'],
 commerce_case_configurations:['case_id','revision','body','digest'],
 commerce_action_receipts:['id','case_id','preview_id','body','digest'],
 commerce_action_previews:['id','case_id','body','digest','proposer'],
 commerce_return_quotes:['id','case_id','resource_id','actor_id','body','digest','expires_at'],
 commerce_return_requests:['id','case_id','resource_id','actor_id','request_key','quote_id','preview_id','state','body','digest','receipt_id','created_at'],
 commerce_native_return_operations:['id','request_id','source_identity','state','request_digest','native_id','native_body','native_digest','observed_at'],
 commerce_operations:['id','resource_id','source_kind','source_id','payload_hash','command','state','provider_ref'],
 commerce_operation_receipts:['id','operation_id','body','digest'],
 commerce_resolution_operations:['id','allocation_id','case_id','resource_id','receipt_id','kind','amount_minor','currency','source_identity','command','digest','state','native_id'],
 commerce_resolution_observations:['operation_id','stage','body','digest'],
 commerce_fulfillment_operations:['id','case_id','resource_id','kind','obligation','receipt_id','state','command','digest','native_id'],
 commerce_fulfillment_observations:['operation_id','stage','body','digest'],
 commerce_support_deliveries:['operation_id','case_id','source_identity','source_contract','account_id','body','digest','observation','observation_digest'],
 commerce_instant_operations:['id','obligation_id','case_id','resource_id','kind','generation','receipt_id','state','command','digest','native_id'],
 commerce_inventory_reservations:['id','allocation_id','case_id','resource_id','generation','state','body','digest'],
 commerce_disposition_operations:['id','request_id','case_id','resource_id','receipt_id','state','command','digest','native_id'],
 commerce_order_edits:['id','case_id','resource_id','receipt_id','state','source_identity','body','digest'],
 commerce_edit_steps:['edit_id','stage','operation_id','command_digest','state','result','result_digest'],
};
// Current final-effect authority is separate from immutable operation history.
// Compare every column of these finite, reviewed tables; a new authority table
// needs an explicit addition. Incidental access/audit bookkeeping is not authority.
const AUTHORITY_TABLES=[
 'commerce_stores','commerce_members','commerce_permissions','commerce_sessions','commerce_worker_grants','commerce_gift_sessions',
 'commerce_case_work','commerce_credential_slots','commerce_credential_versions',
 'commerce_connections','commerce_shopify_connections','commerce_woocommerce_connections',
 'commerce_webhook_routes','commerce_operation_controls','commerce_execution_stops','commerce_control_events',
 'commerce_skills','commerce_profiles','commerce_skill_archive','commerce_skill_approvals',
 'commerce_skill_installations','commerce_skill_revocations','commerce_skill_releases','commerce_skill_activation','commerce_skill_activation_log',
 'commerce_policy_versions','commerce_policy_pins','commerce_execution_settings','commerce_action_readiness','commerce_action_approvals','commerce_case_effects',
 'commerce_return_settings','commerce_return_overrides','commerce_return_review_events','commerce_return_policy_packs','commerce_return_evidence','commerce_gift_cases',
 'commerce_resolution_settings','commerce_resolution_plans','commerce_resolution_allocations','commerce_resolution_units','commerce_resolution_quotes',
 'commerce_fulfillment_settings','commerce_return_parcels','commerce_fulfillment_quotes','commerce_return_labels','commerce_return_shipments','commerce_replacement_orders',
 'commerce_exchange_settings','commerce_exchange_quotes','commerce_exchange_currency_bindings','commerce_exchange_fee_observations','commerce_exchange_lineage_nodes','commerce_exchange_lineage_imports',
 'commerce_instant_settings','commerce_instant_obligations','commerce_instant_quotes','commerce_instant_observations',
 'commerce_edit_settings','commerce_edit_snapshots','commerce_edit_inputs','commerce_edit_quotes','commerce_edit_workflow_pins',
 'commerce_warehouse_settings','commerce_receiving_sessions','commerce_receiving_scans','commerce_received_units','commerce_receiving_reviews','commerce_disposition_units',
 'commerce_return_closures','commerce_return_lifecycle_events','commerce_return_workflow_pins','commerce_native_change_settings','commerce_native_change_snapshots','commerce_native_completed_units','commerce_native_receipts',
 'commerce_destination_policies','commerce_destination_bindings','commerce_destination_selections',
 'commerce_risk_assessments','commerce_risk_reviews','commerce_prevention_configurations','commerce_prevention_experiments','commerce_prevention_members','commerce_prevention_exposures','commerce_prevention_previews','commerce_prevention_confirmations','commerce_prevention_outcomes',
 'commerce_support_documents','commerce_support_ownership','commerce_support_links','commerce_support_contacts','commerce_support_consent','commerce_support_consent_events','commerce_support_rule_jobs',
 'commerce_model_budgets','commerce_model_reservations','commerce_model_circuits',
 'commerce_privacy_subjects','commerce_privacy_resources','commerce_privacy_holds','commerce_privacy_events',
 'commerce_woo_return_sources','commerce_woo_rma_bindings','commerce_woo_event_observations',
] as const;
// Only an actual, receipt-bound merchant import may differ in these local roles.
const IMPORT_LOCAL_AUTHORITY=new Set(['commerce_stores','commerce_members','commerce_permissions','commerce_sessions','commerce_worker_grants','commerce_gift_sessions','commerce_customer_proof_bindings','commerce_secrets']);
const IMPORT_PAUSE:Record<string,Record<string,string|number>>={
 commerce_credential_slots:{active:0},commerce_webhook_routes:{enabled:0},commerce_execution_settings:{enabled:0},
 commerce_action_readiness:{revoked:1},commerce_action_approvals:{revoked:1},commerce_skill_approvals:{revoked:1},commerce_return_overrides:{revoked:1},
 commerce_prevention_confirmations:{revoked:1,session_hash:'revoked'},commerce_case_work:{state:'revoked',expires_at:0},commerce_support_documents:{state:'revoked'},
};
const HASH=/^[a-f0-9]{64}$/;
const stableHistory=(value:unknown)=>JSON.stringify(jsonValue(value,64*1024*1024));
const historyDigest=(value:unknown)=>createHash('sha256').update(stableHistory(value)).digest('hex');
const localDocument=(row:Row)=>row.kind==='migration_binding'||row.kind.startsWith('merchant_');
const binaryValue=(value:any)=>value instanceof Uint8Array?{bytes_sha256:createHash('sha256').update(value).digest('hex'),byte_length:value.byteLength}:value;
const EFFECT_TABLES:Record<string,readonly string[]>={
 commerce_operations:['succeeded','failed'],
 commerce_resolution_operations:['settled','issued','rejected','failed','expired'],
 commerce_fulfillment_operations:['created','purchased','voided','cancelled','released','rejected','succeeded'],
 commerce_native_return_operations:['created','rejected'],
 commerce_instant_operations:['captured','canceled','rejected'],
 commerce_disposition_operations:['applied','rejected'],
 commerce_inventory_reservations:['expired','released','committed','unavailable'],
 commerce_order_edits:['released','cancelled','abandoned'],
 commerce_edit_steps:['confirmed'],
};
function owner(k:CommerceKernel,scope:Scope) {
 const s=k.require(scope);if(s.role!=='owner'||!permissionDecision(k.db,s,'recovery.manage').allowed)throw new Error('ACCESS_DENIED');return s;
}
function scopedRows(k:CommerceKernel,s:Row,table:string) {
 if(table==='commerce_execution_stops'||table==='commerce_control_events')return k.db.prepare('SELECT * FROM '+table+' WHERE (tenant_id=? AND store_id=?) OR (tenant_id IS NULL AND store_id IS NULL)').all(s.tenant_id,s.store_id) as Row[];
 return k.db.prepare('SELECT * FROM '+table+' WHERE tenant_id=? AND store_id=?').all(s.tenant_id,s.store_id) as Row[];
}
function checkedJSON(body:unknown,digest:unknown,code='MIGRATION_RECEIPT_INTEGRITY'):Row {
 try{if(typeof body!=='string'||typeof digest!=='string'||!HASH.test(digest))throw Error();const value=JSON.parse(body);if(contentDigest(value)!==digest)throw Error();return value;}
 catch{throw new Error(code);}
}
function validateRow(row:Row) {
 for(const [body,digest] of [['body','digest'],['command','digest'],['observation','observation_digest'],['result','result_digest'],['native_body','native_digest']]){
  if(!Object.hasOwn(row,body)||!Object.hasOwn(row,digest))continue;
  if(row[body]===null&&row[digest]===null)continue;checkedJSON(row[body],row[digest]);
 }
}
function importedQuarantine(k:CommerceKernel,s:Row) {
 const state=k.db.prepare('SELECT * FROM commerce_recovery_state WHERE id=1').get() as Row|undefined;
 const receipts=scopedRows(k,s,'commerce_support_documents').filter(row=>row.kind==='merchant_import');
 if(!state&&!receipts.length)return false;
 if(!state||state.mode!=='quarantine'||receipts.length!==1)throw new Error('MIGRATION_IMPORT_QUARANTINE_INVALID');
 const row=receipts[0];let body:Row;
 try{body=JSON.parse(row.body);
  if(row.version!==1||row.state!=='recorded'||row.id!==body.snapshot_id||row.reviewer!==null||row.review_digest!==null||row.expires_at!==null
   ||!Number.isSafeInteger(state.created_at)||!Number.isSafeInteger(row.created_at)||state.created_at<0||row.created_at<state.created_at||row.created_at>k.clock()
   ||merchantSnapshotDigest(body)!==row.digest||body.mode!=='quarantine'||body.live_activation_supported!==false||body.snapshot_id!==state.restore_id
   ||!HASH.test(body.digest)||body.digest!==state.source_digest||!HASH.test(body.suppression_sha256)||!HASH.test(state.suppression_digest)
   ||!body.counts||typeof body.counts!=='object'||Array.isArray(body.counts)||Object.values(body.counts).some(n=>!Number.isSafeInteger(n)||Number(n)<0)
   ||!Array.isArray(body.credential_map)||stableHistory(body.transformations)!==stableHistory({revoked_tables:Object.keys(IMPORT_PAUSE),uncertain_operations:'sending_to_unknown',old_operations:'replay_denied',authentication:'destination_only'}))throw Error();
 }catch{throw new Error('MIGRATION_IMPORT_QUARANTINE_INVALID');}
 // A supported idempotent import may apply a later erasure checkpoint without
 // rewriting the original receipt. Current tombstones are validated and compared
 // below; the two checkpoint digests need not represent the same checkpoint.
 // Verify the actual destination remains disabled; the receipt is not enough.
 for(const [table,fields] of Object.entries(IMPORT_PAUSE))for(const row of scopedRows(k,s,table)){
  if(table==='commerce_support_documents'&&localDocument(row))continue;
  if(Object.entries(fields).some(([key,value])=>row[key]!==value))throw new Error('MIGRATION_IMPORT_PAUSE_CHANGED');
 }
 return true;
}
function nativeHistory(tables:Record<string,Row[]>,s:Row,unresolved:Row[]) {
 const requests=new Map(tables.commerce_return_requests.map(row=>[row.id,row]));
 const quotes=new Map(tables.commerce_return_quotes.map(row=>[row.id,row]));
 const previews=new Map(tables.commerce_action_previews.map(row=>[row.id,row]));
 const receipts=new Map(tables.commerce_action_receipts.map(row=>[row.id,row]));
 const operations=new Map(tables.commerce_native_return_operations.map(row=>[row.request_id,row]));
 for(const r of requests.values()){
  const q=quotes.get(r.quote_id),p=previews.get(r.preview_id),c=tables.commerce_cases.find(row=>row.id===r.case_id);
  if(!q||!p||!c||q.case_id!==r.case_id||q.resource_id!==r.resource_id||p.case_id!==r.case_id||c.resource_id!==r.resource_id)throw new Error('MIGRATION_NATIVE_RETURN_INTEGRITY');
  const body=checkedJSON(r.body,r.digest),quote=checkedJSON(q.body,q.digest),preview=checkedJSON(p.body,p.digest);
  if(body.redacted||quote.redacted||preview.redacted){
   if(!tables.commerce_privacy_resources.some(row=>row.resource_id===r.resource_id))throw new Error('MIGRATION_NATIVE_RETURN_INTEGRITY');
   unresolved.push({table:'commerce_return_requests',id:r.id,state:'erased_original_evidence_requires_review'});continue;
  }
  if(body.quote_digest!==q.digest||body.configuration_digest!==quote.configuration_digest||body.configuration_digest!==preview.configuration_digest
   ||contentDigest(body.selection)!==contentDigest(quote.selection)||body.selection.case_id!==r.case_id
   ||quote.case_id!==r.case_id||quote.resource_id!==r.resource_id||preview.case_id!==r.case_id||preview.resource_id!==r.resource_id
   ||preview.tenant_id!==s.tenant_id||preview.store_id!==s.store_id||preview.arguments?.quote_id!==q.id||preview.arguments.quote_digest!==q.digest
   ||!HASH.test(quote.source_digest)||quote.source_digest!==preview.source_digest||quote.source_version!==preview.resource_version)throw new Error('MIGRATION_NATIVE_RETURN_INTEGRITY');
  const receipt=r.receipt_id&&receipts.get(r.receipt_id),approval=receipt&&checkedJSON(receipt.body,receipt.digest);
  if(r.state==='awaiting_review'){
   if(r.receipt_id!==null||operations.has(r.id))throw new Error('MIGRATION_NATIVE_RETURN_INTEGRITY');
  }else if(!receipt||receipt.case_id!==r.case_id||receipt.preview_id!==p.id||approval.id!==receipt.id||approval.return_request_id!==r.id||approval.effect!=='local_return_request_only'
   ||approval.preview_id!==p.id||approval.preview_digest!==p.digest||approval.configuration_digest!==preview.configuration_digest)throw new Error('MIGRATION_NATIVE_RETURN_INTEGRITY');
  if((r.state==='native_unknown'||r.state==='native_created')!==operations.has(r.id))throw new Error('MIGRATION_NATIVE_RETURN_INTEGRITY');
 }
 for(const op of operations.values()){
  const r=requests.get(op.request_id);if(!r||!HASH.test(op.request_digest)||typeof op.source_identity!=='string'||!/^[A-Za-z0-9_.:-]{1,96}$/.test(op.source_identity)
   ||op.id!=='nret_'+contentDigest([s.tenant_id,s.store_id,r.id]).slice(0,40)||!Number.isSafeInteger(op.observed_at)||op.observed_at<0)throw new Error('MIGRATION_NATIVE_RETURN_INTEGRITY');
  if(!['created','unknown','rejected'].includes(op.state)||(op.state==='created'?'native_created':'native_unknown')!==r.state)throw new Error('MIGRATION_NATIVE_RETURN_INTEGRITY');
  const quote=checkedJSON(quotes.get(r.quote_id)!.body,quotes.get(r.quote_id)!.digest),preview=checkedJSON(previews.get(r.preview_id)!.body,previews.get(r.preview_id)!.digest);
  if(quote.redacted||preview.redacted)continue; // Above: still unresolved, never transferable.
  let input:Row;try{input=nativeReturnRequest(quote.native_order_id,preview.lines,r.id);}catch{throw new Error('MIGRATION_NATIVE_RETURN_INTEGRITY');}
  const receipt=receipts.get(r.receipt_id),approved=receipt&&checkedJSON(receipt.body,receipt.digest);
  if(!approved||op.request_digest!==contentDigest({input,receipt:r.receipt_id,configuration:approved.configuration_digest,source:op.source_identity}))throw new Error('MIGRATION_NATIVE_RETURN_INTEGRITY');
  if(op.state!=='created'){
   if(op.native_id!==null||op.native_body!==null||op.native_digest!==null)throw new Error('MIGRATION_NATIVE_RETURN_INTEGRITY');continue;
  }
  const native=checkedJSON(op.native_body,op.native_digest);try{
   nativeGid(op.native_id,'Return');
   if(Object.keys(native).sort().join(',')!=='financial_effect,id,lines,order_id,reverse_fulfillment_ids,status'||native.id!==op.native_id||native.order_id!==input.orderId
    ||!['OPEN','CLOSED','CANCELED','DECLINED','REQUESTED'].includes(native.status)||native.financial_effect!==false||!Array.isArray(native.lines)||native.lines.length!==input.returnLineItems.length
    ||!Array.isArray(native.reverse_fulfillment_ids)||!native.reverse_fulfillment_ids.length||new Set(native.reverse_fulfillment_ids).size!==native.reverse_fulfillment_ids.length)throw Error();
   const ids=new Set(),lines=new Set();for(const line of native.lines){nativeGid(line.id,'ReturnLineItem');nativeGid(line.fulfillment_line_id,'FulfillmentLineItem');
    const expected=input.returnLineItems.find((item:Row)=>item.fulfillmentLineItemId===line.fulfillment_line_id);
    if(!expected||line.quantity!==expected.quantity||ids.has(line.id)||lines.has(line.fulfillment_line_id))throw Error();ids.add(line.id);lines.add(line.fulfillment_line_id);
   }
   for(const id of native.reverse_fulfillment_ids)nativeGid(id,'ReverseFulfillmentOrder');
  }catch{throw new Error('MIGRATION_NATIVE_RETURN_INTEGRITY');}
 }
}
function consentAndErasureHistory(tables:Record<string,Row[]>) {
 const subjects=new Map(tables.commerce_privacy_subjects.map(row=>[row.subject_hash,row]));
 for(const row of subjects.values())if(!HASH.test(row.subject_hash)||!Number.isSafeInteger(row.erased_at)||row.erased_at<0)throw new Error('MIGRATION_SUPPRESSION_INTEGRITY');
 for(const row of tables.commerce_privacy_resources){const subject=subjects.get(row.subject_hash),resource=tables.commerce_resources.find(r=>r.id===row.resource_id);
  if(!subject||!Number.isSafeInteger(row.erased_at)||row.erased_at<subject.erased_at||resource&&(resource.payload!=='{"redacted":true}'||resource.customer_id!==null))throw new Error('MIGRATION_SUPPRESSION_INTEGRITY');
 }
 const erasedCustomer=(value:string)=>[...subjects.keys()].some(hash=>value==='erased_'+hash.slice(0,32));
 const events=tables.commerce_support_consent_events.map(row=>({row,body:checkedJSON(row.body,row.digest)}));
 for(const {row,body} of events){
  if(body.redacted){if(!erasedCustomer(row.customer_id))throw new Error('MIGRATION_CONSENT_INTEGRITY');continue;}
  if(row.id!==body.event_id||row.customer_id!==body.customer_id)throw new Error('MIGRATION_CONSENT_INTEGRITY');
 }
 for(const row of tables.commerce_support_consent){
  if(!HASH.test(row.digest))throw new Error('MIGRATION_CONSENT_INTEGRITY');
  if(erasedCustomer(row.customer_id)){if(row.state!=='withdrawn')throw new Error('MIGRATION_CONSENT_INTEGRITY');continue;}
  const event=events.find(event=>event.row.digest===row.digest&&event.row.customer_id===row.customer_id),body=event?.body;
  if(!body||body.sender_id!==row.sender_id||body.channel!==row.channel||body.purpose!==row.purpose||body.state!==row.state||body.source_ref!==row.source_id
   ||body.source_version!==row.source_version||body.effective_at!==row.effective_at||event.row.observed_at!==row.observed_at)throw new Error('MIGRATION_CONSENT_INTEGRITY');
 }
 for(const row of tables.commerce_support_contacts){const link=tables.commerce_support_links.find(link=>link.id===row.link_id);
  if(!link||link.channel!==row.channel||!HASH.test(row.address_digest)||row.erased===1&&row.address!==null||row.erased===0&&(typeof row.address!=='string'||contentDigest(row.address)!==row.address_digest))throw new Error('MIGRATION_CONTACT_INTEGRITY');
 }
}
function history(k:CommerceKernel,s:Row,pause=false,imported=false) {
 const tables:Record<string,Row[]>={};
 for(const [table,keys] of Object.entries(HISTORY))tables[table]=scopedRows(k,s,table).map(row=>{
  // Field names are a fixed source contract. Missing fields expose schema drift.
  if(keys.some(key=>!Object.hasOwn(row,key)))throw new Error('MIGRATION_HISTORY_SCHEMA_CHANGED');
  const projected=Object.fromEntries(keys.map(key=>[key,row[key]]));
  validateRow(projected);
  return projected;
 }).sort((a,b)=>canonical(a).localeCompare(canonical(b)));
 for(const table of AUTHORITY_TABLES){
  if(pause&&IMPORT_LOCAL_AUTHORITY.has(table)){tables[table]=[];continue;}
  tables[table]=scopedRows(k,s,table).filter(row=>table!=='commerce_support_documents'||!localDocument(row)).map(row=>{
   validateRow(row);const copy=Object.fromEntries(Object.entries(row).map(([key,value])=>[key,binaryValue(value)]));
   if(table==='commerce_sessions')delete copy.last_seen;
   // Only named disabling fields normalize. All other configuration, identity,
   // revision, expiry and body/digest bytes remain exact. Destination was checked.
   if(pause&&IMPORT_PAUSE[table])Object.assign(copy,IMPORT_PAUSE[table]);
   return copy;
  }).sort((a,b)=>stableHistory(a).localeCompare(stableHistory(b)));
 }
 tables.commerce_customer_proof_bindings=pause?[]:k.db.prepare('SELECT p.* FROM commerce_customer_proof_bindings p JOIN commerce_sessions s ON s.token_hash=p.token_hash WHERE s.tenant_id=? AND s.store_id=? ORDER BY p.token_hash').all(s.tenant_id,s.store_id) as Row[];
 tables.commerce_secrets=pause?[]:scopedRows(k,s,'commerce_secrets').map(({tenant_id,store_id,ref,provider,adapter,created_at,revoked,envelope})=>({tenant_id,store_id,ref,provider,adapter,created_at,revoked,envelope_sha256:createHash('sha256').update(envelope).digest('hex')})).sort((a,b)=>a.ref.localeCompare(b.ref));
 const unresolved:Row[]=[];
 nativeHistory(tables,s,unresolved);consentAndErasureHistory(tables);
 for(const row of tables.commerce_native_change_snapshots){const body=checkedJSON(row.body,row.digest);
  if(!body.exists||!['OPEN','CLOSED'].includes(body.return_status)||body.conflicts?.length)unresolved.push({table:'commerce_native_change_snapshots',id:row.request_id,state:'native_conflict_requires_review'});
 }
 const present=new Set((k.db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all() as Row[]).map(r=>r.name));
 for(const [table,terminal] of Object.entries(EFFECT_TABLES)){
  if(!present.has(table))continue;
  for(const row of scopedRows(k,s,table))if(!terminal.includes(row.state))unresolved.push({table,id:row.id??row.operation_id,state:row.state});
 }
 return {tables,digest:historyDigest(tables),unresolved,source_ids:tables.commerce_resources.length,imported};
}

/** Server-local administration. This is one deployment fence for all three effect
 * domains; it intentionally does not allow split ownership within a merchant. */
export class MigrationCutover {
 readonly path:string;readonly id:string;readonly file:string;
 constructor(path:string,coordinatorId:string) {
  this.path=resolve(path);this.id=migrationId(coordinatorId);
  const opened=openMigrationCoordinator(this.path,this.id);this.file=opened.file;opened.db.close();
 }
 static create(path:string,input:{coordinator_id:string;tenant_id:string;store_id:string}) {
  if(Object.keys(input).sort().join(',')!=='coordinator_id,store_id,tenant_id')throw new Error('MIGRATION_INPUT_INVALID');
  for(const value of Object.values(input))migrationId(value);path=resolve(path);
  let fd:number;try{fd=openSync(path,'wx',0o600);}catch{throw new Error('MIGRATION_COORDINATOR_TARGET_EXISTS');}closeSync(fd);chmodSync(path,0o600);
  const db=new DatabaseSync(path);
  try{db.exec(`PRAGMA foreign_keys=ON;
   CREATE TABLE migration_installations(id TEXT PRIMARY KEY,database_path TEXT NOT NULL UNIQUE,database_file TEXT NOT NULL UNIQUE,binding_digest TEXT NOT NULL) STRICT;
   CREATE TABLE migration_authority(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL CHECK(version=1),coordinator_id TEXT NOT NULL,tenant_id TEXT NOT NULL,store_id TEXT NOT NULL,epoch INTEGER NOT NULL,owner TEXT REFERENCES migration_installations(id),mode TEXT NOT NULL CHECK(mode IN ('active','paused'))) STRICT;
   CREATE TABLE migration_executions(id TEXT PRIMARY KEY,installation_id TEXT NOT NULL REFERENCES migration_installations(id),epoch INTEGER NOT NULL,mode TEXT NOT NULL,started_at INTEGER NOT NULL,state TEXT NOT NULL,finished_at INTEGER) STRICT;
   CREATE TABLE migration_receipts(namespace TEXT NOT NULL,id TEXT NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(namespace,id)) STRICT;
   CREATE TABLE migration_transitions(epoch INTEGER PRIMARY KEY,previous_owner TEXT,next_owner TEXT,kind TEXT NOT NULL,history_digest TEXT,unresolved TEXT NOT NULL) STRICT;
   CREATE TRIGGER migration_receipts_no_update BEFORE UPDATE ON migration_receipts BEGIN SELECT RAISE(ABORT,'MIGRATION_RECEIPT_IMMUTABLE'); END;
   CREATE TRIGGER migration_receipts_no_delete BEFORE DELETE ON migration_receipts BEGIN SELECT RAISE(ABORT,'MIGRATION_RECEIPT_IMMUTABLE'); END;`);
   db.prepare("INSERT INTO migration_authority VALUES(1,1,?,?,?,0,NULL,'paused')").run(input.coordinator_id,input.tenant_id,input.store_id);
  }finally{db.close();}
  return new MigrationCutover(path,input.coordinator_id);
 }
 #open(readOnly=false){return openMigrationCoordinator(this.path,this.id,this.file,readOnly);}
 #transaction<T>(fn:(db:DatabaseSync,authority:Row)=>T):T {
  const {db}=this.#open();let locked=false;
  try{lockMigrationCoordinator(db);locked=true;const result=fn(db,db.prepare('SELECT * FROM migration_authority WHERE id=1').get() as Row);db.exec('COMMIT');locked=false;return result;}
  finally{if(locked)db.exec('ROLLBACK');db.close();}
 }
 #scope(k:CommerceKernel,scope:Scope,authority:Row) {
  const s=owner(k,scope);if(s.tenant_id!==authority.tenant_id||s.store_id!==authority.store_id)throw new Error('MIGRATION_SCOPE_CONFLICT');return s;
 }
 #binding(k:CommerceKernel,scope:Scope,authority:Row,db:DatabaseSync) {
  const s=this.#scope(k,scope,authority),b=migrationBinding(k);
  if(!b||b.coordinator_id!==this.id||b.coordinator_path!==this.path||b.coordinator_file!==this.file||b.tenant_id!==s.tenant_id||b.store_id!==s.store_id)throw new Error('MIGRATION_BINDING_INVALID');
  const member=db.prepare('SELECT * FROM migration_installations WHERE id=?').get(b.installation_id) as Row;
  if(!member||member.binding_digest!==contentDigest(b)||member.database_path!==b.database_path||member.database_file!==b.database_file)throw new Error('MIGRATION_BINDING_INVALID');return {s,b};
 }
 bind(k:CommerceKernel,scope:Scope,installationId:string,options:{initial_owner?:boolean}={}) {
  migrationId(installationId);if(Object.keys(options).some(key=>key!=='initial_owner')||options.initial_owner!==undefined&&typeof options.initial_owner!=='boolean')throw new Error('MIGRATION_INPUT_INVALID');
  if(migrationBinding(k))throw new Error('MIGRATION_ALREADY_BOUND');
  return this.#transaction((db,authority)=>{
   const s=this.#scope(k,scope,authority),database=commerceDatabaseFile(k);
   const stores=k.db.prepare('SELECT tenant_id,store_id FROM commerce_stores').all() as Row[];
   if(stores.length!==1||stores[0].tenant_id!==s.tenant_id||stores[0].store_id!==s.store_id)throw new Error('MIGRATION_SINGLE_MERCHANT_REQUIRED');
   if(database.path===this.path||database.file===this.file)throw new Error('MIGRATION_SEPARATE_COORDINATOR_REQUIRED');
   if(db.prepare('SELECT 1 FROM migration_installations WHERE id=? OR database_path=? OR database_file=?').get(installationId,database.path,database.file))throw new Error('MIGRATION_INSTALLATION_CONFLICT');
   if((db.prepare('SELECT count(*) n FROM migration_installations').get() as Row).n>=2)throw new Error('MIGRATION_TWO_INSTALLATIONS_ONLY');
   if(options.initial_owner&&(authority.epoch!==0||authority.owner!==null))throw new Error('MIGRATION_OWNER_CONFLICT');
   const binding:MigrationBinding={version:1,coordinator_id:this.id,coordinator_path:this.path,coordinator_file:this.file,installation_id:installationId,database_path:database.path,database_file:database.file,tenant_id:s.tenant_id,store_id:s.store_id,bound_at:k.clock()};
   db.prepare('INSERT INTO migration_installations VALUES(?,?,?,?)').run(installationId,database.path,database.file,contentDigest(binding));
   k.transaction(()=>{
    // This reserved local-control kind is never accepted by product document APIs
    // or merchant import. The immutable triggers persist across ordinary restarts.
    k.db.prepare("INSERT INTO commerce_support_documents VALUES(?,?,?,?,1,?,?,?,'active',NULL,NULL,?,NULL)")
     .run(s.tenant_id,s.store_id,MIGRATION_BINDING_KIND,MIGRATION_BINDING_ID,canonical(binding),contentDigest(binding),s.actor_id,binding.bound_at);
    for(const sql of Object.values(MIGRATION_SENTINELS))k.db.exec(sql);
   });
   if(options.initial_owner){db.prepare("UPDATE migration_authority SET owner=?,mode='active',epoch=1 WHERE id=1").run(installationId);
    db.prepare("INSERT INTO migration_transitions VALUES(1,NULL,?,'initial_owner',NULL,'[]')").run(installationId);}
   return {installation_id:installationId,coordinator_id:this.id,whole_database_fenced:true,live_activation_supported:false};
  });
 }
 inspect() {
  const {db,authority}=this.#open(true);
  try{return {...authority,installations:db.prepare('SELECT id FROM migration_installations ORDER BY id').all(),unfinished_executions:db.prepare("SELECT id,installation_id,epoch,mode FROM migration_executions WHERE state='started' ORDER BY id").all(),receipt_count:(db.prepare('SELECT count(*) n FROM migration_receipts').get() as Row).n};}
  finally{db.close();}
 }
 #compare(db:DatabaseSync,authority:Row,old:CommerceKernel,oldScope:Scope,next:CommerceKernel,nextScope:Scope) {
  const a=this.#binding(old,oldScope,authority,db),b=this.#binding(next,nextScope,authority,db);
  if(a.b.installation_id===b.b.installation_id)throw new Error('MIGRATION_INSTALLATION_CONFLICT');
  const oldImported=importedQuarantine(old,a.s),nextImported=importedQuarantine(next,b.s);
  if(oldImported&&nextImported)throw new Error('MIGRATION_IMPORT_QUARANTINE_INVALID');
  const paused=oldImported||nextImported,comparison_mode=paused?'quarantined_import_history_only':'exact_writable_authority';
  const first=history(old,a.s,paused,oldImported),second=history(next,b.s,paused,nextImported),matched=first.digest===second.digest;
  return {a,b,first,second,matched,comparison_mode,digest:contentDigest({old:first.digest,next:second.digest,comparison_mode}),source_ids:first.source_ids,
   unresolved:[...first.unresolved.map(row=>({installation_id:a.b.installation_id,...row})),...second.unresolved.map(row=>({installation_id:b.b.installation_id,...row}))]};
 }
 compare(old:CommerceKernel,oldScope:Scope,next:CommerceKernel,nextScope:Scope) {
  const {db,authority}=this.#open(true);try{const r=this.#compare(db,authority,old,oldScope,next,nextScope);return {matched:r.matched,digest:r.digest,old_digest:r.first.digest,next_digest:r.second.digest,comparison_mode:r.comparison_mode,live_activation_supported:false,source_ids:r.source_ids,case_ids:r.first.tables.commerce_cases.length,unresolved:r.unresolved,external_effects:false};}finally{db.close();}
 }
 #receipts(db:DatabaseSync,h:ReturnType<typeof history>) {
  const retain=(namespace:string,id:string,digest:string)=>{
   const prior=db.prepare('SELECT digest FROM migration_receipts WHERE namespace=? AND id=?').get(namespace,id) as Row;
   if(prior&&prior.digest!==digest)throw new Error('MIGRATION_RECEIPT_CONFLICT');
   db.prepare('INSERT OR IGNORE INTO migration_receipts VALUES(?,?,?)').run(namespace,id,digest);
  };
  for(const namespace of ['commerce_action_receipts','commerce_operation_receipts','commerce_resolution_operations','commerce_fulfillment_operations','commerce_instant_operations','commerce_disposition_operations'])for(const row of h.tables[namespace])retain(namespace,row.id,row.digest);
  for(const row of h.tables.commerce_native_return_operations){
   const binding={id:row.id,request_id:row.request_id,source_identity:row.source_identity,request_digest:row.request_digest};
   retain('commerce_native_return_operations',row.id,contentDigest(binding));
   // Status observations may advance; an already-known native ID may not change.
   if(row.native_id!==null)retain('commerce_native_return_ids',row.id,contentDigest({...binding,native_id:row.native_id}));
  }
 }
 cutover(old:CommerceKernel,oldScope:Scope,next:CommerceKernel,nextScope:Scope,input:{expected_epoch:number;expected_history_digest:string}) {
  if(Object.keys(input).sort().join(',')!=='expected_epoch,expected_history_digest'||!Number.isSafeInteger(input.expected_epoch)||input.expected_epoch<0||!/^[a-f0-9]{64}$/.test(input.expected_history_digest))throw new Error('MIGRATION_INPUT_INVALID');
  return this.#transaction((db,authority)=>{
   if(authority.epoch!==input.expected_epoch)throw new Error('MIGRATION_EPOCH_CHANGED');
   const r=this.#compare(db,authority,old,oldScope,next,nextScope);
   if(r.first.imported)throw new Error('MIGRATION_IMPORT_CANNOT_ACTIVATE');
   if(authority.owner!==r.a.b.installation_id||authority.mode!=='active')throw new Error('MIGRATION_OWNER_CONFLICT');
   if(!r.matched||r.digest!==input.expected_history_digest)throw new Error('MIGRATION_HISTORY_CONFLICT');
   if(r.unresolved.length||db.prepare("SELECT 1 FROM migration_executions WHERE state='started'").get())throw new Error('MIGRATION_RECONCILIATION_REQUIRED');
   this.#receipts(db,r.first);this.#receipts(db,r.second);
   const epoch=authority.epoch+1;db.prepare("UPDATE migration_authority SET epoch=?,owner=?,mode='active' WHERE id=1").run(epoch,r.b.b.installation_id);
   db.prepare("INSERT INTO migration_transitions VALUES(?,?,?,'cutover',?,'[]')").run(epoch,authority.owner,r.b.b.installation_id,r.digest);
   return {epoch,owner:r.b.b.installation_id,mode:'active',comparison_mode:r.comparison_mode,domains:['refunds','fulfillment','customer_notifications'],replayed_operations:0,imported_work_resumed:false,live_activation_supported:false};
  });
 }
 rollback(current:CommerceKernel,currentScope:Scope,previous:CommerceKernel,previousScope:Scope,input:{expected_epoch:number}) {
  if(Object.keys(input).join(',')!=='expected_epoch'||!Number.isSafeInteger(input.expected_epoch)||input.expected_epoch<1)throw new Error('MIGRATION_INPUT_INVALID');
  return this.#transaction((db,authority)=>{
   if(authority.epoch!==input.expected_epoch)throw new Error('MIGRATION_EPOCH_CHANGED');
   const r=this.#compare(db,authority,current,currentScope,previous,previousScope);
   if(authority.owner!==r.a.b.installation_id&&authority.owner!==null)throw new Error('MIGRATION_OWNER_CONFLICT');
   // Rollback first removes both writers. Pending work and divergent histories
   // remain stopped; no queue, approval, receipt, amount or provider ID is reset.
   const epoch=authority.epoch+1,unresolved=[...r.unresolved,...db.prepare("SELECT id,installation_id,state FROM migration_executions WHERE state='started'").all() as Row[]];
   this.#receipts(db,r.first);this.#receipts(db,r.second);
   db.prepare("UPDATE migration_authority SET epoch=?,owner=NULL,mode='paused' WHERE id=1").run(epoch);
   db.prepare("INSERT INTO migration_transitions VALUES(?,?,NULL,'rollback_pause',?,?)").run(epoch,authority.owner,r.digest,canonical(unresolved));
   return {epoch,owner:null,mode:'paused',comparison_mode:r.comparison_mode,outcome:unresolved.length?'paused_pending_reconciliation':r.matched?'paused_review_required':'paused_history_conflict',history_matched:r.matched,unresolved,replayed_operations:0,receipts_preserved:true,previous_installation:r.b.b.installation_id};
  });
 }
}
