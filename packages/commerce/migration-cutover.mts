import {DatabaseSync} from 'node:sqlite';
import {openSync,closeSync,chmodSync} from 'node:fs';
import {resolve} from 'node:path';
import type {CommerceKernel,Scope,Row} from './kernel.mts';
import {canonical,contentDigest} from './configuration-values.mts';
import {permissionDecision} from './authorization.mts';
import {MIGRATION_BINDING_KIND,MIGRATION_BINDING_ID,MIGRATION_SENTINELS,migrationBinding,migrationId,commerceDatabaseFile,openMigrationCoordinator,lockMigrationCoordinator} from './migration-fence.mts';
import type {MigrationBinding} from './migration-fence.mts';

const HISTORY:Record<string,readonly string[]>={
 commerce_resources:['id','kind','source_system','external_id','source_version','source_updated_at','customer_id','payload'],
 commerce_cases:['id','revision','resource_id','customer_id'],
 commerce_case_configurations:['case_id','revision','body','digest'],
 commerce_action_receipts:['id','case_id','preview_id','body','digest'],
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
 return k.db.prepare('SELECT * FROM '+table+' WHERE tenant_id=? AND store_id=?').all(s.tenant_id,s.store_id) as Row[];
}
function history(k:CommerceKernel,s:Row) {
 const tables:Record<string,Row[]>={};
 for(const [table,keys] of Object.entries(HISTORY))tables[table]=scopedRows(k,s,table).map(row=>{
  // Field names are a fixed source contract. Missing fields expose schema drift.
  if(keys.some(key=>!Object.hasOwn(row,key)))throw new Error('MIGRATION_HISTORY_SCHEMA_CHANGED');
  const projected=Object.fromEntries(keys.map(key=>[key,row[key]]));
  if(projected.body&&projected.digest&&contentDigest(JSON.parse(projected.body))!==projected.digest)throw new Error('MIGRATION_RECEIPT_INTEGRITY');
  if(projected.command&&projected.digest&&contentDigest(JSON.parse(projected.command))!==projected.digest)throw new Error('MIGRATION_RECEIPT_INTEGRITY');
  return projected;
 }).sort((a,b)=>canonical(a).localeCompare(canonical(b)));
 const unresolved:Row[]=[];
 const present=new Set((k.db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all() as Row[]).map(r=>r.name));
 for(const [table,terminal] of Object.entries(EFFECT_TABLES)){
  if(!present.has(table))continue;
  for(const row of scopedRows(k,s,table))if(!terminal.includes(row.state))unresolved.push({table,id:row.id??row.operation_id,state:row.state});
 }
 return {tables,digest:contentDigest(tables),unresolved,source_ids:tables.commerce_resources.length};
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
  const first=history(old,a.s),second=history(next,b.s),matched=first.digest===second.digest;
  return {a,b,first,second,matched,digest:contentDigest({old:first.digest,next:second.digest}),source_ids:first.source_ids,
   unresolved:[...first.unresolved.map(row=>({installation_id:a.b.installation_id,...row})),...second.unresolved.map(row=>({installation_id:b.b.installation_id,...row}))]};
 }
 compare(old:CommerceKernel,oldScope:Scope,next:CommerceKernel,nextScope:Scope) {
  const {db,authority}=this.#open(true);try{const r=this.#compare(db,authority,old,oldScope,next,nextScope);return {matched:r.matched,digest:r.digest,old_digest:r.first.digest,next_digest:r.second.digest,source_ids:r.source_ids,case_ids:r.first.tables.commerce_cases.length,unresolved:r.unresolved,external_effects:false};}finally{db.close();}
 }
 #receipts(db:DatabaseSync,h:ReturnType<typeof history>) {
  for(const namespace of ['commerce_action_receipts','commerce_operation_receipts','commerce_resolution_operations','commerce_fulfillment_operations','commerce_instant_operations','commerce_disposition_operations'])for(const row of h.tables[namespace]){
   const digest=row.digest,prior=db.prepare('SELECT digest FROM migration_receipts WHERE namespace=? AND id=?').get(namespace,row.id) as Row;
   if(prior&&prior.digest!==digest)throw new Error('MIGRATION_RECEIPT_CONFLICT');
   db.prepare('INSERT OR IGNORE INTO migration_receipts VALUES(?,?,?)').run(namespace,row.id,digest);
  }
 }
 cutover(old:CommerceKernel,oldScope:Scope,next:CommerceKernel,nextScope:Scope,input:{expected_epoch:number;expected_history_digest:string}) {
  if(Object.keys(input).sort().join(',')!=='expected_epoch,expected_history_digest'||!Number.isSafeInteger(input.expected_epoch)||input.expected_epoch<0||!/^[a-f0-9]{64}$/.test(input.expected_history_digest))throw new Error('MIGRATION_INPUT_INVALID');
  return this.#transaction((db,authority)=>{
   if(authority.epoch!==input.expected_epoch)throw new Error('MIGRATION_EPOCH_CHANGED');
   const r=this.#compare(db,authority,old,oldScope,next,nextScope);
   if(authority.owner!==r.a.b.installation_id||authority.mode!=='active')throw new Error('MIGRATION_OWNER_CONFLICT');
   if(!r.matched||r.digest!==input.expected_history_digest)throw new Error('MIGRATION_HISTORY_CONFLICT');
   if(r.unresolved.length||db.prepare("SELECT 1 FROM migration_executions WHERE state='started'").get())throw new Error('MIGRATION_RECONCILIATION_REQUIRED');
   this.#receipts(db,r.first);this.#receipts(db,r.second);
   const epoch=authority.epoch+1;db.prepare("UPDATE migration_authority SET epoch=?,owner=?,mode='active' WHERE id=1").run(epoch,r.b.b.installation_id);
   db.prepare("INSERT INTO migration_transitions VALUES(?,?,?,'cutover',?,'[]')").run(epoch,authority.owner,r.b.b.installation_id,r.digest);
   return {epoch,owner:r.b.b.installation_id,mode:'active',domains:['refunds','fulfillment','customer_notifications'],replayed_operations:0,imported_work_resumed:false,live_activation_supported:false};
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
   return {epoch,owner:null,mode:'paused',outcome:unresolved.length?'paused_pending_reconciliation':r.matched?'paused_review_required':'paused_history_conflict',history_matched:r.matched,unresolved,replayed_operations:0,receipts_preserved:true,previous_installation:r.b.b.installation_id};
  });
 }
}
