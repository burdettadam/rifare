import {AsyncLocalStorage} from 'node:async_hooks';
import {DatabaseSync} from 'node:sqlite';
import {lstatSync,realpathSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {CommerceKernel,Scope,Row} from './kernel.mts';
import {contentDigest} from './configuration-values.mts';

export const MIGRATION_BINDING_KIND='migration_binding';
export const MIGRATION_BINDING_ID='installation';
export const MIGRATION_SENTINELS=Object.freeze({
 commerce_migration_binding_no_update:"CREATE TRIGGER commerce_migration_binding_no_update BEFORE UPDATE ON commerce_support_documents WHEN OLD.kind='migration_binding' OR NEW.kind='migration_binding' BEGIN SELECT RAISE(ABORT,'MIGRATION_BINDING_IMMUTABLE'); END",
 commerce_migration_binding_no_delete:"CREATE TRIGGER commerce_migration_binding_no_delete BEFORE DELETE ON commerce_support_documents WHEN OLD.kind='migration_binding' BEGIN SELECT RAISE(ABORT,'MIGRATION_BINDING_IMMUTABLE'); END",
 commerce_migration_binding_no_duplicate:"CREATE TRIGGER commerce_migration_binding_no_duplicate BEFORE INSERT ON commerce_support_documents WHEN NEW.kind='migration_binding' AND EXISTS(SELECT 1 FROM commerce_support_documents WHERE kind='migration_binding') BEGIN SELECT RAISE(ABORT,'MIGRATION_BINDING_IMMUTABLE'); END",
});
export type MigrationBinding={version:1;coordinator_id:string;coordinator_path:string;coordinator_file:string;installation_id:string;database_path:string;database_file:string;tenant_id:string;store_id:string;bound_at:number};
const seen=new WeakMap<CommerceKernel,string>();
type LiveContext={kernel:CommerceKernel;binding:MigrationBinding;db:DatabaseSync;epoch:number;mode:'write'|'reconcile';live:boolean};
const execution=new AsyncLocalStorage<LiveContext>();
const READ_ACTIONS=new Set(['support.read','resource.read','attachment.read','knowledge.read','skill.read','profile.read','task.read','capability.read','policy.read','case.read','return.read','audit.read','webhook.read','operation.read','exception.read']);
const normalizeSQL=(s:string)=>s.trim().replace(/;$/,'');

export function migrationId(value:unknown):string {
 if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,96}$/.test(value))throw new Error('MIGRATION_INPUT_INVALID');return value;
}
export function migrationFile(path:string,code='MIGRATION_COORDINATOR_UNAVAILABLE') {
 try{if(typeof path!=='string'||resolve(path)!==path||realpathSync(path)!==path)throw Error();const st=lstatSync(path);
  if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1)throw Error();return String(st.dev)+':'+String(st.ino);
 }catch{throw new Error(code);}
}
export function commerceDatabaseFile(k:CommerceKernel) {
 const path=(k.db.prepare('PRAGMA database_list').all() as Row[]).find(r=>r.name==='main')?.file;
 if(!path)throw new Error('MIGRATION_FILE_DATABASE_REQUIRED');return {path:resolve(path),file:migrationFile(resolve(path),'MIGRATION_DATABASE_CHANGED')};
}
export function migrationBinding(k:CommerceKernel):MigrationBinding|null {
 const rows=k.db.prepare("SELECT * FROM commerce_support_documents WHERE kind='migration_binding'").all() as Row[];
 const triggers=k.db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND name LIKE 'commerce_migration_binding_%'").all() as Row[];
 if(!rows.length&&!triggers.length&&!seen.has(k))return null;
 if(rows.length!==1||triggers.length!==Object.keys(MIGRATION_SENTINELS).length)throw new Error('MIGRATION_BINDING_INVALID');
 for(const [name,sql] of Object.entries(MIGRATION_SENTINELS))if(normalizeSQL(triggers.find(t=>t.name===name)?.sql??'')!==normalizeSQL(sql))throw new Error('MIGRATION_BINDING_INVALID');
 const row=rows[0];let b:MigrationBinding;
 try{b=JSON.parse(row.body);
  if(Object.keys(b).sort().join(',')!=='bound_at,coordinator_file,coordinator_id,coordinator_path,database_file,database_path,installation_id,store_id,tenant_id,version'
   ||b.version!==1||row.id!==MIGRATION_BINDING_ID||row.version!==1||row.state!=='active'||row.expires_at!==null||row.reviewer!==null||row.review_digest!==null
   ||row.tenant_id!==b.tenant_id||row.store_id!==b.store_id||row.created_at!==b.bound_at||!Number.isSafeInteger(b.bound_at)||b.bound_at<0||contentDigest(b)!==row.digest)throw Error();
  for(const name of ['coordinator_id','installation_id','tenant_id','store_id'] as const)migrationId(b[name]);
  const stores=k.db.prepare('SELECT tenant_id,store_id FROM commerce_stores').all() as Row[];
  if(stores.length!==1||stores[0].tenant_id!==b.tenant_id||stores[0].store_id!==b.store_id)throw Error();
  if(seen.has(k)&&seen.get(k)!==row.digest)throw Error();
 }catch{throw new Error('MIGRATION_BINDING_INVALID');}
 const current=commerceDatabaseFile(k);if(current.path!==b.database_path||current.file!==b.database_file)throw new Error('MIGRATION_DATABASE_CHANGED');
 seen.set(k,row.digest);return b;
}
export function openMigrationCoordinator(path:string,expectedId:string,expectedFile?:string,readOnly=false) {
 migrationId(expectedId);const file=migrationFile(path);if(expectedFile&&file!==expectedFile)throw new Error('MIGRATION_COORDINATOR_CHANGED');
 let db:DatabaseSync|undefined;
 try{db=new DatabaseSync(path,{readOnly});db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=0;');
  const authority=db.prepare('SELECT * FROM migration_authority WHERE id=1').get() as Row;
  if(migrationFile(path)!==file||!authority||authority.coordinator_id!==expectedId||authority.version!==1||!['active','paused'].includes(authority.mode)
   ||!Number.isSafeInteger(authority.epoch)||authority.epoch<0||authority.mode==='active'&&authority.owner===null)throw Error();
  return {db,authority,file};
 }catch{db?.close();throw new Error('MIGRATION_COORDINATOR_UNAVAILABLE');}
}
export function lockMigrationCoordinator(db:DatabaseSync) {
 try{db.exec('BEGIN IMMEDIATE');}catch{throw new Error('MIGRATION_COORDINATOR_BUSY');}
}
function boundAuthority(b:MigrationBinding,db:DatabaseSync) {
 const authority=db.prepare('SELECT * FROM migration_authority WHERE id=1').get() as Row;
 const member=db.prepare('SELECT * FROM migration_installations WHERE id=?').get(b.installation_id) as Row;
 if(!authority||authority.coordinator_id!==b.coordinator_id||authority.tenant_id!==b.tenant_id||authority.store_id!==b.store_id
  ||!member||member.database_path!==b.database_path||member.database_file!==b.database_file||member.binding_digest!==contentDigest(b))throw new Error('MIGRATION_BINDING_INVALID');
 return authority;
}
function checkLiveBinding(b:MigrationBinding) {
 if(migrationFile(b.coordinator_path)!==b.coordinator_file)throw new Error('MIGRATION_COORDINATOR_CHANGED');
}
export function assertMigrationAction(k:CommerceKernel,action:string) {
 const b=migrationBinding(k);if(!b)return;
 if(READ_ACTIONS.has(action))return;
 checkLiveBinding(b);
 const context=execution.getStore();
 if(!context||!context.live||context.kernel!==k||contentDigest(context.binding)!==contentDigest(b))throw new Error('MIGRATION_WRITE_CONTEXT_REQUIRED');
 const authority=boundAuthority(b,context.db);
 if(authority.epoch!==context.epoch)throw new Error('MIGRATION_EPOCH_CHANGED');
 if(context.mode==='write'){
  if(authority.mode!=='active'||authority.owner!==b.installation_id)throw new Error('MIGRATION_NOT_WRITER');
 }else if(!['operation.reconcile','migration.egress'].includes(action))throw new Error('MIGRATION_RECONCILE_ONLY');
}
export function assertMigrationEgress(k:CommerceKernel){assertMigrationAction(k,'migration.egress');}

async function runFenced<T>(k:CommerceKernel,scope:Scope,mode:'write'|'reconcile',fn:()=>T|Promise<T>):Promise<T> {
 const b=migrationBinding(k);if(!b)throw new Error('MIGRATION_BINDING_REQUIRED');
 const s=k.require(scope);if(s.tenant_id!==b.tenant_id||s.store_id!==b.store_id)throw new Error('MIGRATION_SCOPE_CONFLICT');
 if(execution.getStore()?.live)throw new Error('MIGRATION_NESTED_EXECUTION_DENIED');
 const {db}=openMigrationCoordinator(b.coordinator_path,b.coordinator_id,b.coordinator_file);let locked=false,context:LiveContext|undefined;
 try{
  lockMigrationCoordinator(db);locked=true;const authority=boundAuthority(b,db);
  if(mode==='write'&&(authority.mode!=='active'||authority.owner!==b.installation_id))throw new Error('MIGRATION_NOT_WRITER');
  if(mode==='write'&&db.prepare("SELECT 1 FROM migration_executions WHERE state='started'").get())throw new Error('MIGRATION_EXECUTION_UNRESOLVED');
  const run='execution_'+randomUUID().replaceAll('-','');
  // Persist intent before invoking existing code. A crash leaves this row started;
  // the next writer and all ownership changes refuse it until explicitly reconciled.
  db.prepare("INSERT INTO migration_executions VALUES(?,?,?,?,?,'started',NULL)").run(run,b.installation_id,authority.epoch,mode,k.clock());
  db.exec('COMMIT');locked=false;
  lockMigrationCoordinator(db);locked=true;
  const current=boundAuthority(b,db);if(current.epoch!==authority.epoch)throw new Error('MIGRATION_EPOCH_CHANGED');
  context={kernel:k,binding:b,db,epoch:authority.epoch,mode,live:true};
  let failed=false;
  try{return await execution.run(context,fn);}
  catch(error){failed=true;throw error;}
  finally{
   context.live=false;
   // Business methods retain their own transactions/unknown-state handling. Ending
   // this invocation neither asserts settlement nor makes its operations replayable.
   db.prepare('UPDATE migration_executions SET state=?,finished_at=? WHERE id=?').run(failed?'ended_with_error':'ended',k.clock(),run);
   db.exec('COMMIT');locked=false;
  }
 }finally{if(context)context.live=false;if(locked)db.exec('ROLLBACK');db.close();}
}
export function withMigrationWriter<T>(k:CommerceKernel,scope:Scope,fn:()=>T|Promise<T>){return runFenced(k,scope,'write',fn);}
export function withMigrationReconciliation<T>(k:CommerceKernel,scope:Scope,fn:()=>T|Promise<T>){return runFenced(k,scope,'reconcile',fn);}
