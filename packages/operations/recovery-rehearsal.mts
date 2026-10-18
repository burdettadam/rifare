import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {CommerceKernel,exact,integer,digest} from '../commerce/kernel.mts';
import type {Row} from '../commerce/kernel.mts';
import {canonical,contentDigest} from '../commerce/configuration-values.mts';
import {restoreRecoverySnapshot} from '../commerce/safe-recovery.mts';
import {assertRecoveryAction,assertRecoveryEgress} from '../commerce/data-guards.mts';

export type RecoveryRehearsalInput=Parameters<typeof restoreRecoverySnapshot>[0]&{
 profile:{id:string;maximum_point_gap_ms:number;maximum_restore_ms:number;clock_basis:string};
};
const operations=['commerce_operations','commerce_resolution_operations','commerce_fulfillment_operations','commerce_native_return_operations','commerce_disposition_operations','commerce_instant_operations'];
const rows=(db:DatabaseSync,table:string)=>db.prepare('SELECT * FROM '+table).all() as Row[];
const sorted=(value:Row[])=>value.map(canonical).sort();
function equal(left:Row[],right:Row[]){const a=sorted(left),b=sorted(right);return a.length===b.length&&a.every((value,index)=>value===b[index]);}
function denied(call:()=>unknown){try{call();return false;}catch(error){return error instanceof Error&&['RESTORE_WRITE_BLOCKED','RESTORE_EGRESS_BLOCKED'].includes(error.message);}}

/** Read-only inspection; it never changes quarantine or grants activation. New
 * local read sessions may exist after restart. Copied sessions are checked
 * separately against the original snapshot during reconciliation. */
export function inspectRecoveryInterlocks(k:CommerceKernel){
 const state=k.db.prepare('SELECT * FROM commerce_recovery_state WHERE id=1').get() as Row|undefined;
 const counters:Record<string,number>={};
 for(const [table,predicate] of [
  ['commerce_secrets','revoked<>1'],['commerce_credential_slots','active<>0'],['commerce_webhook_routes','enabled<>0'],
  ['commerce_execution_settings','enabled<>0'],['commerce_action_readiness','revoked<>1'],['commerce_action_approvals','revoked<>1'],
  ['commerce_worker_grants','revoked<>1'],['commerce_case_work',"state<>'revoked' OR expires_at<>0"],
  ['commerce_gift_sessions','revoked<>1'],['commerce_gift_challenges','consumed<>1'],
  ['commerce_operation_work',"state IN ('sending','leased')"],
 ] as const)counters[table]=Number(k.db.prepare('SELECT count(*) n FROM '+table+' WHERE '+predicate).get()!.n);
 const uncovered=Number(k.db.prepare(`SELECT count(*) n FROM commerce_operations o WHERE NOT EXISTS
  (SELECT 1 FROM commerce_restored_operations r WHERE r.tenant_id=o.tenant_id AND r.store_id=o.store_id AND r.operation_id=o.id)`).get()!.n);
 const actions=['operation.dispatch','support.send','action.execute','secret.invoke','model.run','resource.ingest'];
 const blocked=actions.map(action=>({action,blocked:denied(()=>assertRecoveryAction(k,action))}));
 const egressBlocked=denied(()=>assertRecoveryEgress(k));
 const allPaused=state?.mode==='quarantine'&&Object.values(counters).every(n=>n===0)&&uncovered===0&&blocked.every(r=>r.blocked)&&egressBlocked;
 if(!allPaused)throw new Error('RECOVERY_INTERLOCK_VIOLATION');
 return {restore_id:state!.restore_id,mode:state!.mode,all_paused:allPaused,active_control_rows:counters,
  uncovered_old_operations:uncovered,blocked_actions:blocked,egress_blocked:egressBlocked,live_activation_supported:false};
}

/** A server-local, bounded rehearsal around the existing verified restoration
 * path. Snapshot/suppression pins are supplied by the caller, not re-derived as
 * authority. The declared profile records local targets only. */
export function rehearseRecovery(input:RecoveryRehearsalInput,clock:()=>number=Date.now){
 exact(input,['snapshot','destination','manifest_sha256','suppression','suppression_sha256','profile']);
 exact(input.profile,['id','maximum_point_gap_ms','maximum_restore_ms','clock_basis']);
 if(!/^[a-z0-9-]{1,80}$/.test(input.profile.id)||!['application_clock','synthetic_application_clock'].includes(input.profile.clock_basis))throw new Error('RECOVERY_PROFILE_INVALID');
 integer(input.profile.maximum_point_gap_ms);integer(input.profile.maximum_restore_ms,1);
 if(input.profile.maximum_point_gap_ms>86400000||input.profile.maximum_restore_ms>3600000)throw new Error('RECOVERY_PROFILE_INVALID');
 const start=performance.now(),startedAt=Date.now(),referenceAt=integer(clock());
 const restore=restoreRecoverySnapshot({snapshot:input.snapshot,destination:input.destination,manifest_sha256:input.manifest_sha256,suppression:input.suppression,suppression_sha256:input.suppression_sha256},clock);
 const restoreElapsed=performance.now()-start;
 const manifestBytes=readFileSync(join(input.snapshot,'manifest.json'));
 if(digest(manifestBytes)!==input.manifest_sha256)throw new Error('RECOVERY_MANIFEST_MISMATCH');
 const manifest=JSON.parse(manifestBytes.toString()),snapshotBytes=readFileSync(join(input.snapshot,'database.sqlite'));
 if(digest(snapshotBytes)!==manifest.database_sha256)throw new Error('RECOVERY_DATABASE_MISMATCH');
 if(!Number.isSafeInteger(manifest.created_at)||manifest.created_at>referenceAt)throw new Error('RECOVERY_POINT_INVALID');
 const source=new DatabaseSync(join(input.snapshot,'database.sqlite'),{readOnly:true,allowExtension:false}),target=new DatabaseSync(restore.database,{allowExtension:false});
 let reconciliation:any,interlocks:any;
 try{
  const k=new CommerceKernel(target,clock);interlocks=inspectRecoveryInterlocks(k);
  const cp=input.suppression as Row,erased=(r:Row)=>cp.resources.some((s:Row)=>s.tenant_id===r.tenant_id&&s.store_id===r.store_id&&s.resource_id===r.resource_id);
  const originalResources=rows(source,'commerce_resources'),expectedResources=originalResources.map(r=>erased({...r,resource_id:r.id})?{...r,payload:'{"redacted":true}',customer_id:null,external_id:'erased_'+r.id}:r);
  if(!equal(expectedResources,rows(target,'commerce_resources')))throw new Error('RECOVERY_RESOURCE_DIFFERENCE');
  const originalAttachments=rows(source,'commerce_attachments'),retainedAttachments=originalAttachments.filter(r=>!erased(r));
  if(!equal(retainedAttachments,rows(target,'commerce_attachments')))throw new Error('RECOVERY_ATTACHMENT_DIFFERENCE');
  const oldCredentials=rows(source,'commerce_secrets'),expectedCredentials=oldCredentials.map(r=>({...r,revoked:1}));
  if(!equal(expectedCredentials,rows(target,'commerce_secrets')))throw new Error('RECOVERY_CREDENTIAL_DIFFERENCE');
  const operationCounts:Record<string,number>={};
  for(const table of operations){const original=rows(source,table),expected=original.map(r=>table==='commerce_operations'&&r.state==='sending'?{...r,state:'unknown',revision:r.revision+1}:r);
   if(!equal(expected,rows(target,table)))throw new Error('RECOVERY_OPERATION_DIFFERENCE');operationCounts[table]=original.length;}
  const expectedWork=rows(source,'commerce_operation_work').map(r=>['sending','leased'].includes(r.state)?{...r,state:'unknown',lease_token:null,lease_until:null,last_code:'restore_uncertain'}:r);
  if(!equal(expectedWork,rows(target,'commerce_operation_work')))throw new Error('RECOVERY_QUEUE_DIFFERENCE');
  for(const session of rows(source,'commerce_sessions')){const copy=target.prepare('SELECT revoked FROM commerce_sessions WHERE token_hash=?').get(session.token_hash);if(copy&&copy.revoked!==1)throw new Error('RECOVERY_SESSION_DIFFERENCE');}
  if(target.prepare('PRAGMA foreign_key_check').all().length)throw new Error('RECOVERY_FOREIGN_KEYS_INVALID');
  reconciliation={resources:{count:originalResources.length,declared_point_matched:true,current_suppression_applied:true},attachments:{retained:retainedAttachments.length,suppressed:originalAttachments.length-retainedAttachments.length,
    retained_sha256:digest(sorted(retainedAttachments).join('\n'))},credentials:{retained:oldCredentials.length,revoked:oldCredentials.length,
    encrypted_envelopes_preserved:true,wrapping_keys_included:false},operations:operationCounts,operation_identity_and_state_matched:true,
    queue_rows:expectedWork.length,foreign_key_differences:0,suppression_sha256:input.suppression_sha256};
 }finally{source.close();target.close();}
 const pointGap=referenceAt-manifest.created_at;
 return {schema_version:1,kind:'local_recovery_rehearsal',...restore,profile:{...input.profile},
  source:{manifest_sha256:input.manifest_sha256,database_sha256:manifest.database_sha256,migrations_sha256:manifest.migrations_sha256,snapshot_created_at:manifest.created_at},
  measurements:{started_at:startedAt,completed_at:Date.now(),restore_elapsed_ms:restoreElapsed,rehearsal_elapsed_ms:performance.now()-start,
    recovery_reference_at:referenceAt,recovery_point_gap_ms:pointGap,point_clock_basis:input.profile.clock_basis,
    elapsed_clock:'monotonic_performance_now',actual_data_loss_established:false},
  targets:{point_gap_met:pointGap<=input.profile.maximum_point_gap_ms,restore_time_met:restoreElapsed<=input.profile.maximum_restore_ms,approved_deployment_qualified:false},
  reconciliation,interlocks,external_reconciliation_performed:false,independent_machine_qualified:false,production_qualified:false};
}
