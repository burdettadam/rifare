import { DatabaseSync } from 'node:sqlite';
import { chmodSync,copyFileSync,existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,renameSync,rmSync,writeFileSync } from 'node:fs';
import { dirname,join,resolve } from 'node:path';
import { CommerceKernel,exact,id,integer,token,digest } from './kernel.mts';
import type { Scope,Row } from './kernel.mts';
import { canonical,contentDigest } from './configuration-values.mts';
import { eraseSelected,storageInventory,suppressionCheckpoint } from './privacy-lifecycle.mts';

const LIMIT=64*1024*1024;
function pathCheck(path:string,mustExist=false) {
  const full=resolve(path);let at=full;
  while(at!==dirname(at)){if(existsSync(at)&&lstatSync(at).isSymbolicLink())throw new Error('RECOVERY_PATH_UNSAFE');at=dirname(at);}
  if(mustExist&&!existsSync(full))throw new Error('RECOVERY_INPUT_MISSING');return full;
}
function regular(path:string,limit=LIMIT) {
  pathCheck(path,true);const s=lstatSync(path);
  if(!s.isFile()||s.nlink!==1||s.size>limit)throw new Error('RECOVERY_FILE_UNSAFE');return readFileSync(path);
}
function newDirectory(path:string) {pathCheck(path);if(existsSync(path))throw new Error('RECOVERY_TARGET_EXISTS');mkdirSync(path,{mode:0o700});}
function migrations(k:CommerceKernel){return k.db.prepare('SELECT * FROM commerce_migrations ORDER BY version').all();}
// Server-local deployment operation: this multi-store snapshot has no tenant API.
export function createRecoverySnapshot(k:CommerceKernel,directory:string) {
  storageInventory(k);const path=pathCheck(directory);newDirectory(path);
  try {
    const database=join(path,'database.sqlite');k.db.prepare('VACUUM main INTO ?').run(database);chmodSync(database,0o600);
    const bytes=regular(database),manifest={version:1,format:'sqlite-vacuum-snapshot',created_at:k.clock(),
      database_sha256:digest(bytes),database_bytes:bytes.length,migrations_sha256:contentDigest(migrations(k)),
      attachments:'embedded_commerce_attachments',credentials:'encrypted_values_and_references_only',wrapping_keys_included:false,
      external_paths_included:false,contains_private_data:true};
    const raw=canonical(manifest);writeFileSync(join(path,'manifest.json'),raw,{mode:0o600,flag:'wx'});
    return {directory:path,manifest_sha256:digest(raw),database_sha256:manifest.database_sha256,contains_private_data:true};
  }catch(error){rmSync(path,{recursive:true,force:true});throw error;}
}
function checkpoint(value:unknown,hash:string,minimum:number) {
  const p=exact(value,['version','generated_at','subjects','resources']);if(contentDigest(p)!==hash||p.version!==1)throw new Error('SUPPRESSION_CHECKPOINT_INVALID');
  integer(p.generated_at);if(p.generated_at<minimum)throw new Error('SUPPRESSION_CHECKPOINT_STALE');
  for(const key of ['subjects','resources'])if(!Array.isArray(p[key])||p[key].length>10000)throw new Error('SUPPRESSION_CHECKPOINT_INVALID');
  for(const r of p.subjects){exact(r,['tenant_id','store_id','subject_hash','erased_at']);id(r.tenant_id);id(r.store_id);if(!/^[a-f0-9]{64}$/.test(r.subject_hash))throw new Error('SUPPRESSION_CHECKPOINT_INVALID');integer(r.erased_at);if(r.erased_at>p.generated_at)throw new Error('SUPPRESSION_CHECKPOINT_INVALID');}
  for(const r of p.resources){exact(r,['tenant_id','store_id','resource_id','subject_hash','erased_at']);id(r.resource_id);
    if(!p.subjects.some((s:Row)=>s.tenant_id===r.tenant_id&&s.store_id===r.store_id&&s.subject_hash===r.subject_hash&&s.erased_at<=r.erased_at))throw new Error('SUPPRESSION_CHECKPOINT_INVALID');}
  return p;
}
export function restoreRecoverySnapshot(input:{snapshot:string;destination:string;manifest_sha256:string;suppression:unknown;suppression_sha256:string},clock:()=>number=Date.now) {
  const from=pathCheck(input.snapshot,true),target=pathCheck(input.destination);
  if(readdirSync(from).sort().join(',')!=='database.sqlite,manifest.json')throw new Error('RECOVERY_MEMBERSHIP_INVALID');
  const raw=regular(join(from,'manifest.json'),65536);if(digest(raw)!==input.manifest_sha256)throw new Error('RECOVERY_MANIFEST_MISMATCH');
  const m=exact(JSON.parse(raw.toString()),['version','format','created_at','database_sha256','database_bytes','migrations_sha256','attachments','credentials','wrapping_keys_included','external_paths_included','contains_private_data']);
  if(m.version!==1||m.format!=='sqlite-vacuum-snapshot'||m.wrapping_keys_included!==false||m.external_paths_included!==false)throw new Error('RECOVERY_MANIFEST_INVALID');
  const bytes=regular(join(from,'database.sqlite'));if(bytes.length!==m.database_bytes||digest(bytes)!==m.database_sha256)throw new Error('RECOVERY_DATABASE_MISMATCH');
  const cp=checkpoint(input.suppression,input.suppression_sha256,m.created_at);
  if(cp.generated_at>clock())throw new Error('SUPPRESSION_CHECKPOINT_FUTURE');
  if(existsSync(target))throw new Error('RECOVERY_TARGET_EXISTS');const staging=target+'.staging-'+token().slice(0,10);newDirectory(staging);
  let db:DatabaseSync|undefined;
  try {
    const file=join(staging,'database.sqlite');writeFileSync(file,bytes,{mode:0o600,flag:'wx'});db=new DatabaseSync(file);
    const k=new CommerceKernel(db,clock);storageInventory(k);
    if(contentDigest(migrations(k))!==m.migrations_sha256)throw new Error('RECOVERY_SCHEMA_MISMATCH');
    const restoreId='restore_'+token().slice(0,32);
    k.transaction(()=>{
      db!.prepare('INSERT OR REPLACE INTO commerce_recovery_state VALUES(1,?,?,?,?,?)').run(restoreId,'quarantine',m.database_sha256,input.suppression_sha256,clock());
      for(const [table,clause] of [['commerce_sessions','revoked=1'],['commerce_worker_grants','revoked=1'],['commerce_secrets','revoked=1'],['commerce_credential_slots','active=0'],['commerce_webhook_routes','enabled=0'],['commerce_execution_settings','enabled=0'],['commerce_action_readiness','revoked=1'],['commerce_action_approvals','revoked=1'],['commerce_case_work',"state='revoked',expires_at=0"]])db!.exec(`UPDATE ${table} SET ${clause}`);
      db!.exec('UPDATE commerce_gift_sessions SET revoked=1; UPDATE commerce_gift_challenges SET consumed=1;');
      db!.exec('INSERT OR IGNORE INTO commerce_restored_operations SELECT tenant_id,store_id,id FROM commerce_operations');
      db!.exec("UPDATE commerce_operations SET state='unknown',revision=revision+1 WHERE state='sending'");
      db!.exec("UPDATE commerce_operation_work SET state='unknown',lease_token=NULL,lease_until=NULL,last_code='restore_uncertain' WHERE state IN ('sending','leased')");
      for(const s of cp.subjects){const ids=cp.resources.filter((r:Row)=>r.tenant_id===s.tenant_id&&r.store_id===s.store_id&&r.subject_hash===s.subject_hash).map((r:Row)=>r.resource_id);
        // Replaying an erasure cannot be blocked by an obsolete hold in an old snapshot.
        eraseSelected(k,s,ids,s.subject_hash,s.erased_at);}
      if(db!.prepare('PRAGMA foreign_key_check').all().length)throw new Error('RECOVERY_FOREIGN_KEYS_INVALID');
    });
    db.close();db=undefined;renameSync(staging,target);
    return {directory:target,database:join(target,'database.sqlite'),restore_id:restoreId,mode:'quarantine',external_effects:false,credentials_revoked:true,live_activation_supported:false};
  }catch(error){db?.close();rmSync(staging,{recursive:true,force:true});throw error;}
}
export function activateDiagnosticRestore(k:CommerceKernel,scope:Scope,restoreId:string) {
  id(restoreId);return k.transaction(()=>{k.authorize(scope,'recovery.manage');storageInventory(k);
    const r=k.db.prepare('SELECT * FROM commerce_recovery_state WHERE id=1').get() as Row;
    if(!r||r.restore_id!==restoreId||r.mode!=='quarantine')throw new Error('RESTORE_IDENTITY_CHANGED');
    if(k.db.prepare("SELECT 1 FROM commerce_operations WHERE state IN ('sending','unknown') LIMIT 1").get())throw new Error('RESTORE_RECONCILIATION_REQUIRED');
    k.db.prepare("UPDATE commerce_recovery_state SET mode='diagnostic_only' WHERE id=1").run();
    return {mode:'diagnostic_only',new_approval_required:true,old_operations_replayable:false,egress_enabled:false};});
}
export { suppressionCheckpoint };
