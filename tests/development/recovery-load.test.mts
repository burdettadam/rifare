import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {CommerceKernel} from '../../packages/commerce/kernel.mts';
import {WebhookInbox,WebhookCapacityError} from '../../packages/commerce/webhook-inbox.mts';
import {EventProcessor} from '../../packages/commerce/event-processing.mts';
import {contentDigest} from '../../packages/commerce/configuration-values.mts';
import {createRecoverySnapshot,suppressionCheckpoint} from '../../packages/commerce/safe-recovery.mts';
import {PrivacyLifecycle} from '../../packages/commerce/privacy-lifecycle.mts';
import {startCommerceServer} from '../../apps/commerce-api/server.mts';
import {rehearseRecovery,inspectRecoveryInterlocks} from '../../packages/operations/recovery-rehearsal.mts';
import {LOAD_WORKLOAD,measureLoadEnvelope,compareLoadBaseline,validateLoadObservation} from '../../packages/operations/load-envelope.mts';
import {recoveryFixture,checkRestoredEffects,loadFixture} from '../../tools/recovery-load-fixtures.mts';
import {usingExecution,syntheticHeaders} from './execution-helpers.mts';

async function usingRecovery(fn:(f:any)=>unknown){const f=await recoveryFixture();try{return await fn(f);}finally{f.cleanup();}}
function recoveryInput(f:any){const snapshot=createRecoverySnapshot(f.kernel,join(f.directory,'snapshot')),cp=suppressionCheckpoint(f.kernel);return {snapshot:snapshot.directory,destination:join(f.directory,'restored'),manifest_sha256:snapshot.manifest_sha256,suppression:cp,suppression_sha256:contentDigest(cp),profile:{id:'sqlite-synthetic-local-v1',maximum_point_gap_ms:1000,maximum_restore_ms:10000,clock_basis:'synthetic_application_clock'}};}
function inboxSetup(f:any,limits={max_pending_events:1,max_pending_bytes:4096,retry_after_seconds:1}){
 const key=Buffer.alloc(32,83),inbox=new WebhookInbox(f.kernel,()=>key,limits),route=inbox.register(f.owner.scope,{provider:'synthetic',topic:'cases/updated',shop_domain:'local.example.invalid',api_version:'2026-10',key_ref:'load-key'});
 const input=(n:number)=>{const raw=Buffer.from(JSON.stringify({schema_version:1,event_id:'load_event_'+n,resource_id:f.order().id,source_version:n,source_updated_at:f.now(),state:'open'}));return {raw,headers:syntheticHeaders(route,raw,key,f.now(),'delivery_'+n)};};
 const receive=(n:number,other=inbox)=>{const e=input(n);return other.receive(route.id,e.headers,e.raw);};return {inbox,route,key,input,receive};
}

test('CASE-M07-G11-01',()=>usingRecovery(async f=>{
 const r=rehearseRecovery(recoveryInput(f),f.now);assert.equal(r.mode,'quarantine');assert.equal(r.reconciliation.attachments.retained,1);assert.equal(r.reconciliation.credentials.retained,1);
 assert.equal(r.reconciliation.operations.commerce_resolution_operations,1);assert.equal(r.reconciliation.operations.commerce_fulfillment_operations,1);assert.equal(r.reconciliation.operations.commerce_operations,1);
 assert.equal(r.measurements.recovery_point_gap_ms,0);assert.ok(r.measurements.restore_elapsed_ms>0);assert.ok(r.measurements.completed_at>=r.measurements.started_at);assert.equal(r.production_qualified,false);
 assert.deepEqual(await checkRestoredEffects(f,r.database,2),{refund_calls:0,label_calls:0,message_calls:0,credential_calls:0,restarts:2});
}));
test('CASE-M07-G11-02',()=>usingRecovery(async f=>{
 const r=rehearseRecovery(recoveryInput(f),f.now);assert.deepEqual(await checkRestoredEffects(f,r.database,1),{refund_calls:0,label_calls:0,message_calls:0,credential_calls:0,restarts:1});
 const db=new DatabaseSync(r.database);try{const k=new CommerceKernel(db,f.now);assert.throws(()=>k.authenticate(f.a.bearer),/ACCESS_DENIED/);assert.equal(inspectRecoveryInterlocks(k).all_paused,true);}finally{db.close();}
}));
test('CASE-M07-G11-03',()=>usingRecovery(async f=>{
 const r=rehearseRecovery(recoveryInput(f),f.now);assert.equal((await checkRestoredEffects(f,r.database,3)).restarts,3);
 const db=new DatabaseSync(r.database);try{db.exec('UPDATE commerce_execution_settings SET enabled=1');assert.throws(()=>inspectRecoveryInterlocks(new CommerceKernel(db,f.now)),/RECOVERY_INTERLOCK_VIOLATION/);}finally{db.close();}
}));
test('M07-G11-SNAPSHOT-PIN-AND-NO-OVERWRITE',()=>usingRecovery(f=>{
 const p=recoveryInput(f);assert.throws(()=>rehearseRecovery({...p,manifest_sha256:'0'.repeat(64)},f.now),/RECOVERY_MANIFEST_MISMATCH/);rehearseRecovery(p,f.now);assert.throws(()=>rehearseRecovery(p,f.now),/RECOVERY_TARGET_EXISTS/);
}));
test('M07-G11-CURRENT-ERASURE-BEFORE-ATTACHMENT-EXPOSURE',()=>usingRecovery(f=>{
 const p=recoveryInput(f);f.advance(1);new PrivacyLifecycle(f.kernel).erase(f.owner.scope,f.order().customer_id);const cp=suppressionCheckpoint(f.kernel);
 const r=rehearseRecovery({...p,suppression:cp,suppression_sha256:contentDigest(cp)},f.now);assert.equal(r.reconciliation.attachments.retained,0);assert.equal(r.reconciliation.attachments.suppressed,1);
 const db=new DatabaseSync(r.database);try{assert.equal(db.prepare('SELECT count(*) n FROM commerce_attachments').get()!.n,0);}finally{db.close();}
}));
test('M07-G11-STALE-CHECKPOINT-AND-MEASURED-TARGET-MISS',()=>usingRecovery(f=>{
 const p=recoveryInput(f),stale={...p.suppression,generated_at:f.now()-1};assert.throws(()=>rehearseRecovery({...p,suppression:stale,suppression_sha256:contentDigest(stale)},f.now),/SUPPRESSION_CHECKPOINT_STALE/);
 f.advance(2000);const cp=suppressionCheckpoint(f.kernel),r=rehearseRecovery({...p,suppression:cp,suppression_sha256:contentDigest(cp)},f.now);assert.equal(r.measurements.recovery_point_gap_ms,2000);assert.equal(r.targets.point_gap_met,false);assert.equal(r.targets.approved_deployment_qualified,false);
}));
test('M07-G11-WRAPPING-KEY-ABSENT-AND-CIPHERTEXT-PRESERVED',()=>usingRecovery(f=>{
 const p=recoveryInput(f),r=rehearseRecovery(p,f.now),before=new DatabaseSync(join(p.snapshot,'database.sqlite'),{readOnly:true}),after=new DatabaseSync(r.database);
 try{assert.equal(after.prepare('SELECT envelope FROM commerce_secrets').get()!.envelope,before.prepare('SELECT envelope FROM commerce_secrets').get()!.envelope);assert.equal(after.prepare('SELECT revoked FROM commerce_secrets').get()!.revoked,1);
 assert.equal(readFileSync(join(p.snapshot,'database.sqlite')).includes(Buffer.from('rehearsal-secret-value')),false);assert.equal(JSON.stringify(r).includes('rehearsal-secret-value'),false);}finally{before.close();after.close();}
}));
test('CASE-M07-G12-01',async()=>{const f=loadFixture();try{
 const r=await measureLoadEnvelope(f.input);validateLoadObservation(r);assert.equal(r.workload_sha256,contentDigest(LOAD_WORKLOAD));assert.equal(r.counts.unique_deliveries,20);assert.equal(r.counts.accepted,20);assert.equal(r.counts.persisted,20);assert.equal(r.counts.consumed,20);
 assert.ok(r.counts.backpressured>0);assert.equal(r.counts.unexplained_differences,0);assert.equal(new Set(r.accepted_delivery_ids).size,20);assert.equal(r.hardware.platform,process.platform);assert.ok(r.hardware.cpu_count>0);assert.ok(r.metrics.intake_ms.p95>0);assert.ok(r.metrics.retry_wait_ms.total>=900);
 assert.equal(r.external_dependency_wait_ms,null);assert.equal(r.production_qualified,false);assert.equal(r.approved_hardware_qualified,false);assert.deepEqual(compareLoadBaseline(r,r,contentDigest(r)).regressions,[]);
}finally{f.cleanup();}});
test('CASE-M07-G12-02',()=>usingExecution(f=>{const x=inboxSetup(f);const first=x.receive(1);assert.throws(()=>x.receive(2),WebhookCapacityError);assert.equal(x.receive(1).http_status,200);assert.equal(x.receive(1).id,first.id);assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_webhook_inbox').get()!.n,1);
 new EventProcessor(f.kernel).process(f.a.scope,first.id);assert.equal(x.receive(2).http_status,202);assert.equal(x.receive(2).duplicate,true);assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_webhook_inbox').get()!.n,2);
}));
test('CASE-M07-G12-03',()=>{
 const fixture={schema_version:1,workload_sha256:contentDigest(LOAD_WORKLOAD),hardware_sha256:'a'.repeat(64),runtime:{node:process.version},capacity:LOAD_WORKLOAD.capacity,accepted_delivery_ids:['one'],persisted_delivery_ids:[],consumed_delivery_ids:[],counts:{unique_deliveries:1,accepted:1,persisted:0,consumed:0,unexplained_differences:1},metrics:{intake_ms:{p95:1},processing_ms:{p95:1},queue_lag_ms:{p95:1},reconciliation_lag_ms:{p95:1}},production_qualified:false};
 assert.throws(()=>validateLoadObservation(fixture),/LOAD_RECONCILIATION_FAILED/);
 const baseline={...fixture,persisted_delivery_ids:['one'],consumed_delivery_ids:['one'],counts:{...fixture.counts,persisted:1,consumed:1,unexplained_differences:0}};const degraded={...baseline,metrics:{...baseline.metrics,intake_ms:{p95:3}}};
 assert.ok(compareLoadBaseline(degraded,baseline,contentDigest(baseline)).regressions.includes('intake_ms'));assert.throws(()=>compareLoadBaseline({...baseline,workload_sha256:'0'.repeat(64)},baseline,contentDigest(baseline)),/LOAD_BASELINE_CONTEXT_CHANGED/);assert.throws(()=>compareLoadBaseline(baseline,baseline,'0'.repeat(64)),/LOAD_BASELINE_PIN_MISMATCH/);
});
test('M07-G12-PERSISTENCE-FAILURE-NEVER-ACKNOWLEDGED',()=>usingExecution(f=>{const x=inboxSetup(f);f.db.exec("CREATE TRIGGER load_fail BEFORE INSERT ON commerce_webhook_inbox BEGIN SELECT RAISE(ABORT,'load_fault'); END");assert.throws(()=>x.receive(1),/WEBHOOK_PERSISTENCE_FAILED/);assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_webhook_inbox').get()!.n,0);f.db.exec('DROP TRIGGER load_fail');assert.equal(x.receive(1).http_status,202);}));
test('M07-G12-REOPEN-SHARES-TRANSACTIONAL-MERCHANT-CAPACITY',()=>usingExecution(async f=>{const x=inboxSetup(f),otherDB=new DatabaseSync(f.filename);try{const other=new WebhookInbox(new CommerceKernel(otherDB,f.now),()=>x.key,{max_pending_events:1,max_pending_bytes:4096,retry_after_seconds:1});x.receive(1);assert.throws(()=>x.receive(2,other),/WEBHOOK_CAPACITY_EXCEEDED/);assert.equal(x.receive(1,other).duplicate,true);assert.equal(otherDB.prepare('SELECT count(*) n FROM commerce_webhook_inbox').get()!.n,1);}finally{otherDB.close();}
 new EventProcessor(f.kernel).process(f.a.scope,x.receive(1).id);
 const concurrent=(n:number)=>new Promise<number>((resolve,reject)=>{
  const program=`import {DatabaseSync} from 'node:sqlite';import {CommerceKernel} from './packages/commerce/kernel.mts';import {WebhookInbox,WebhookCapacityError} from './packages/commerce/webhook-inbox.mts';let input='';for await(const chunk of process.stdin)input+=chunk;const p=JSON.parse(input),db=new DatabaseSync(p.filename),k=new CommerceKernel(db,()=>p.now),inbox=new WebhookInbox(k,()=>Buffer.alloc(32,83),p.limits);let status;try{status=inbox.receive(p.route,p.headers,Buffer.from(p.raw)).http_status;}catch(e){if(!(e instanceof WebhookCapacityError))throw e;status=429;}finally{db.close();}process.stdout.write(JSON.stringify(status));`;
  const child=spawn(process.execPath,['--experimental-strip-types','--input-type=module','--eval',program],{cwd:process.cwd(),stdio:['pipe','pipe','pipe']});let out='',err='';child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>err+=c);child.on('error',reject);child.on('close',code=>{try{assert.equal(code,0,err);resolve(JSON.parse(out));}catch(e){reject(e);}});
  const e=x.input(n);child.stdin.end(JSON.stringify({filename:f.filename,now:f.now(),route:x.route.id,headers:e.headers,raw:e.raw.toString(),limits:x.inbox.intakeLimits()}));
 });
 assert.deepEqual((await Promise.all([concurrent(2),concurrent(3)])).sort(),[202,429]);assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_webhook_inbox').get()!.n,2);
}));
test('M07-G12-BYTE-CAPACITY-AND-SIGNATURE-PRIORITY',()=>usingExecution(f=>{const x=inboxSetup(f,{max_pending_events:4,max_pending_bytes:1,retry_after_seconds:1}),e=x.input(1);assert.throws(()=>x.receive(1),/WEBHOOK_CAPACITY_EXCEEDED/);assert.throws(()=>x.inbox.receive(x.route.id,e.headers,Buffer.from('{}')),/WEBHOOK_SIGNATURE_INVALID/);assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_webhook_inbox').get()!.n,0);}));
test('M07-G12-CAPACITY-ACROSS-ROUTES-AND-TENANT-ISOLATION',()=>usingExecution(f=>{const x=inboxSetup(f);x.receive(1);const other=x.inbox.register(f.owner.scope,{provider:'synthetic',topic:'cases/updated',shop_domain:'local.example.invalid',api_version:'2026-10',key_ref:'load-key'}),raw=x.input(2).raw;assert.throws(()=>x.inbox.receive(other.id,syntheticHeaders(other,raw,x.key,f.now(),'two'),raw),/WEBHOOK_CAPACITY_EXCEEDED/);
 f.kernel.provisionMember(f.b.tenant,f.b.store,'owner','owner');const owner=f.kernel.authenticate(f.kernel.issueSession(f.b.tenant,f.b.store,'owner')),key=Buffer.alloc(32,94),inbox=new WebhookInbox(f.kernel,()=>key,{max_pending_events:1,max_pending_bytes:4096,retry_after_seconds:1}),route=inbox.register(owner,{provider:'synthetic',topic:'cases/updated',shop_domain:'other.example.invalid',api_version:'2026-10',key_ref:'other-key'});assert.equal(inbox.receive(route.id,syntheticHeaders(route,raw,key,f.now()),raw).http_status,202);
}));
test('M07-G12-HTTP-429-RETRY-AFTER-AND-DUPLICATE-200',()=>usingExecution(async f=>{const x=inboxSetup(f),app=await startCommerceServer({kernel:f.kernel,caps:f.caps,customers:f.customers,simulator:f.simulator,inbox:x.inbox});try{
 const post=async(n:number)=>{const e=x.input(n);return fetch(app.url+'/webhooks/'+x.route.id,{method:'POST',headers:Object.fromEntries(Array.from({length:e.headers.length/2},(_,i)=>[e.headers[i*2],e.headers[i*2+1]])),body:e.raw});};
 assert.equal((await post(1)).status,202);const denied=await post(2);assert.equal(denied.status,429);assert.equal(denied.headers.get('retry-after'),'1');assert.deepEqual(await denied.json(),{error:'WEBHOOK_CAPACITY_EXCEEDED',acknowledged:false,retry_after_seconds:1});assert.equal((await post(1)).status,200);
}finally{await app.close();}}));
test('M07-G12-UNCONFIGURED-DEFAULT-RETAINED-AND-LIMITS-FROZEN',()=>usingExecution(f=>{const x=inboxSetup(f),defaultInbox=new WebhookInbox(f.kernel,()=>x.key);x.receive(1);assert.equal(x.receive(2,defaultInbox).http_status,202);assert.equal(defaultInbox.intakeLimits(),null);assert.throws(()=>new WebhookInbox(f.kernel,()=>x.key,{max_pending_events:0,max_pending_bytes:4,retry_after_seconds:1}),/INVALID_INPUT/);const copy=x.inbox.intakeLimits()!;assert.throws(()=>{copy.max_pending_events=999;},TypeError);}));
test('M07-G12-BOUNDED-RETRY-EXHAUSTION-IS-HONEST',async()=>{const f=loadFixture();try{const original=f.input.inbox.receive.bind(f.input.inbox);let attempts=0;f.input.inbox.receive=()=>{attempts++;throw new WebhookCapacityError(1);};const r=await measureLoadEnvelope(f.input);assert.equal(r.counts.accepted,0);assert.equal(r.counts.retry_exhausted,20);assert.equal(r.counts.acknowledged_without_persistence,0);assert.equal(r.within_envelope,false);assert.equal(attempts,60);f.input.inbox.receive=original;}finally{f.cleanup();}});
test('M07-RECOVERY-LOAD-CLI-CONTRACT',async()=>{
 const run=(file:string)=>new Promise<any>((resolve,reject)=>{const child=spawn(process.execPath,['--experimental-strip-types',file,'--describe'],{cwd:process.cwd(),stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>err+=c);child.on('error',reject);child.on('close',code=>{try{assert.equal(code,0,err);resolve(JSON.parse(out));}catch(error){reject(error);}});});
 assert.equal((await run('tools/rehearse-recovery.mts')).live_activation_supported,false);assert.equal((await run('tools/measure-load.mts')).workload_sha256,contentDigest(LOAD_WORKLOAD));
});
