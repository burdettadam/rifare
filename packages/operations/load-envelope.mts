import {readFileSync} from 'node:fs';
import {availableParallelism,cpus,platform,release,totalmem} from 'node:os';
import {performance} from 'node:perf_hooks';
import type {CommerceKernel,Scope,Row} from '../commerce/kernel.mts';
import {id,digest} from '../commerce/kernel.mts';
import {canonical,contentDigest} from '../commerce/configuration-values.mts';
import {WebhookInbox,WebhookCapacityError} from '../commerce/webhook-inbox.mts';
import {EventProcessor} from '../commerce/event-processing.mts';

function freeze<T>(value:T):T{if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;}
export const LOAD_WORKLOAD=freeze(JSON.parse(readFileSync(new URL('./contracts/load-workload.v1.json',import.meta.url),'utf8')));
type LoadInput={kernel:CommerceKernel;scope:Scope;inbox:WebhookInbox;route_id:string;resource_id:string;headers:(raw:Buffer,delivery:string)=>string[]};
function samples(values:number[]){const ordered=[...values].sort((a,b)=>a-b);return {count:values.length,total:values.reduce((a,b)=>a+b,0),p50:ordered[Math.max(0,Math.ceil(ordered.length*.5)-1)]??0,p95:ordered[Math.max(0,Math.ceil(ordered.length*.95)-1)]??0,max:ordered.at(-1)??0,samples:values};}
function readHost(path:string){try{return readFileSync(path,'utf8').trim();}catch{return null;}}
function hardware(){return {platform:platform(),os_release:release(),architecture:process.arch,cpu_count:cpus().length,
 cpu_models:[...new Set(cpus().map(c=>c.model))].sort(),available_parallelism:availableParallelism(),memory_total_bytes:totalmem(),
 cgroup_cpu_max:readHost('/sys/fs/cgroup/cpu.max'),cgroup_memory_max:readHost('/sys/fs/cgroup/memory.max'),observation:'current_local_host'};}
const sameSet=(left:unknown,right:unknown)=>Array.isArray(left)&&Array.isArray(right)&&left.every(x=>typeof x==='string')&&right.every(x=>typeof x==='string')&&new Set(left).size===left.length&&new Set(right).size===right.length&&canonical([...left].sort())===canonical([...right].sort());

/** Validate an observation's identities and denominators. This is evidence
 * consistency, not authentication of a report author or external effect. */
export function validateLoadObservation(report:any){
 const c=report?.counts;
 if(!c||![c.unique_deliveries,c.accepted,c.persisted,c.consumed,c.unexplained_differences].every(n=>Number.isSafeInteger(n)&&n>=0)
  ||c.accepted>c.unique_deliveries||c.unexplained_differences!==0
  ||!sameSet(report.accepted_delivery_ids,report.persisted_delivery_ids)||!sameSet(report.accepted_delivery_ids,report.consumed_delivery_ids)
  ||report.accepted_delivery_ids.length!==c.accepted||report.persisted_delivery_ids.length!==c.persisted||report.consumed_delivery_ids.length!==c.consumed)
  throw new Error('LOAD_RECONCILIATION_FAILED');
 for(const field of ['intake_ms','processing_ms','queue_lag_ms','reconciliation_lag_ms'])if(!Number.isFinite(report.metrics?.[field]?.p95)||report.metrics[field].p95<0)throw new Error('LOAD_MEASUREMENT_INVALID');
 return {accepted_persisted_consumed_identity_match:true,unexplained_differences:0};
}

export function compareLoadBaseline(current:any,baseline:any,expectedBaselineSha256:string){
 if(contentDigest(baseline)!==expectedBaselineSha256)throw new Error('LOAD_BASELINE_PIN_MISMATCH');
 validateLoadObservation(current);validateLoadObservation(baseline);
 for(const field of ['workload_sha256','hardware_sha256','runtime','capacity'])if(canonical(current[field])!==canonical(baseline[field]))throw new Error('LOAD_BASELINE_CONTEXT_CHANGED');
 if(current.counts.unique_deliveries!==baseline.counts.unique_deliveries||current.counts.accepted!==baseline.counts.accepted)throw new Error('LOAD_BASELINE_CONTEXT_CHANGED');
 const regressions=Object.keys(LOAD_WORKLOAD.local_targets_ms).filter(field=>current.metrics[field].p95>baseline.metrics[field].p95*LOAD_WORKLOAD.regression_multiplier);
 return {baseline_sha256:expectedBaselineSha256,workload_sha256:current.workload_sha256,regression_multiplier:LOAD_WORKLOAD.regression_multiplier,
  regressions,within_baseline:regressions.length===0,approved_gate_qualified:false};
}

/** One fixed local workload, no scheduler or arbitrary provider. All signatures,
 * persistence, processing and consumption go through the existing inbox/core.
 * Retried rejections have an actual bounded wait; no accepted delivery is resent
 * as a new identity. The output names the local host without claiming approval. */
export async function measureLoadEnvelope(input:LoadInput){
 const {kernel:k,scope,inbox}=input,s=k.authorize(scope,'webhook.read');id(input.route_id);id(input.resource_id);
 if(!(inbox instanceof WebhookInbox)||canonical(inbox.intakeLimits())!==canonical(LOAD_WORKLOAD.capacity))throw new Error('LOAD_CAPACITY_CONFIG_CHANGED');
 const route=k.db.prepare('SELECT * FROM commerce_webhook_routes WHERE id=? AND tenant_id=? AND store_id=?').get(input.route_id,s.tenant_id,s.store_id) as Row|undefined;
 if(!route||route.provider!=='synthetic'||route.topic!=='cases/updated'||!route.enabled||k.get(scope,input.resource_id).source_system!=='synthetic')throw new Error('LOAD_FIXTURE_CONTEXT_REQUIRED');
 if(k.db.prepare('SELECT 1 FROM commerce_webhook_inbox WHERE tenant_id=? AND store_id=? LIMIT 1').get(s.tenant_id,s.store_id)
   ||k.db.prepare('SELECT 1 FROM commerce_event_projections WHERE tenant_id=? AND store_id=? AND resource_id=?').get(s.tenant_id,s.store_id,input.resource_id))throw new Error('LOAD_EMPTY_INBOX_REQUIRED');
 const startedAt=Date.now(),started=performance.now(),host=hardware(),runtime={node:process.version,v8:process.versions.v8,sqlite:process.versions.sqlite??null};
 const metrics:Record<string,number[]>={intake_ms:[],processing_ms:[],queue_lag_ms:[],reconciliation_lag_ms:[],retry_wait_ms:[]};
 const observations:Row[]=[],accepted=new Map<string,{id:string;hash:string;at:number}>(),processor=new EventProcessor(k),phases:Row[]=[];
 let ordinal=0,backpressured=0,duplicateRequests=0,submissionAttempts=0;
 for(const phase of LOAD_WORKLOAD.phases){
  const phaseStart=performance.now(),beforeAccepted=accepted.size,beforePressure=backpressured;
  let pending=Array.from({length:phase.events},()=>{ordinal++;const delivery='load_'+phase.id+'_'+String(ordinal).padStart(4,'0');
   const raw=Buffer.from(canonical({schema_version:1,event_id:'load_event_'+String(ordinal).padStart(4,'0'),resource_id:input.resource_id,source_version:ordinal,source_updated_at:k.clock(),state:'open'}));return {ordinal,delivery,raw};});
  for(let attempt=1;attempt<=LOAD_WORKLOAD.maximum_attempts_per_delivery&&pending.length;attempt++){
   const next:typeof pending=[];
   for(let offset=0;offset<pending.length;offset+=phase.batch_size){
    const process:typeof pending=[];
    for(const event of pending.slice(offset,offset+phase.batch_size)){
     const begin=performance.now();submissionAttempts++;
     try{const ack=inbox.receive(input.route_id,input.headers(event.raw,event.delivery),event.raw);
      if(ack.acknowledged!==true||ack.duplicate!==false||ack.http_status!==202||accepted.has(event.delivery))throw new Error('LOAD_ACKNOWLEDGEMENT_INVALID');
      accepted.set(event.delivery,{id:ack.id,hash:digest(event.raw),at:performance.now()});process.push(event);
      observations.push({delivery_id:event.delivery,phase:phase.id,attempt,status:202,event_id:ack.id});
      if(event.ordinal%LOAD_WORKLOAD.duplicate_every===0){const duplicate=inbox.receive(input.route_id,input.headers(event.raw,event.delivery),event.raw);duplicateRequests++;
       if(duplicate.id!==ack.id||duplicate.http_status!==200||duplicate.duplicate!==true)throw new Error('LOAD_DUPLICATE_IDENTITY_CHANGED');}
     }catch(error){if(!(error instanceof WebhookCapacityError))throw error;
      if(error.retry_after_seconds!==LOAD_WORKLOAD.capacity.retry_after_seconds)throw new Error('LOAD_RETRY_CONFIG_CHANGED');
      next.push(event);backpressured++;observations.push({delivery_id:event.delivery,phase:phase.id,attempt,status:429,acknowledged:false,retry_after_seconds:error.retry_after_seconds});
     }finally{metrics.intake_ms.push(performance.now()-begin);}
    }
    for(const event of process){const receipt=accepted.get(event.delivery)!,begin=performance.now();metrics.queue_lag_ms.push(begin-receipt.at);
     const result=processor.process(scope,receipt.id);metrics.processing_ms.push(performance.now()-begin);metrics.reconciliation_lag_ms.push(performance.now()-receipt.at);
     if(result.disposition!=='applied'||!result.operation_id)throw new Error('LOAD_PROCESSING_DIFFERENCE');}
   }
   pending=next;
   if(pending.length&&attempt<LOAD_WORKLOAD.maximum_attempts_per_delivery){const begin=performance.now();await new Promise(resolve=>setTimeout(resolve,LOAD_WORKLOAD.capacity.retry_after_seconds*1000));metrics.retry_wait_ms.push(performance.now()-begin);}
  }
  phases.push({id:phase.id,offered:phase.events,accepted:accepted.size-beforeAccepted,backpressured:backpressured-beforePressure,retry_exhausted:pending.map(e=>e.delivery),elapsed_ms:performance.now()-phaseStart});
 }
 const persisted=k.db.prepare('SELECT id,delivery_id,body,sha256 FROM commerce_webhook_inbox WHERE tenant_id=? AND store_id=? AND route_id=? ORDER BY delivery_id').all(s.tenant_id,s.store_id,input.route_id) as Row[];
 const consumed=k.db.prepare(`SELECT i.delivery_id,c.disposition,c.operation_id FROM commerce_event_consumption c JOIN commerce_webhook_inbox i
  ON i.tenant_id=c.tenant_id AND i.store_id=c.store_id AND i.id=c.inbox_id WHERE i.tenant_id=? AND i.store_id=? AND i.route_id=? ORDER BY i.delivery_id`).all(s.tenant_id,s.store_id,input.route_id) as Row[];
 let differences=0;
 for(const row of persisted){const expected=accepted.get(row.delivery_id);if(!expected||expected.id!==row.id||expected.hash!==row.sha256||digest(Buffer.from(row.body))!==expected.hash)differences++;}
 for(const row of consumed)if(row.disposition!=='applied'||!row.operation_id||!k.db.prepare('SELECT id FROM commerce_operations WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,row.operation_id))differences++;
 const measured=Object.fromEntries(Object.entries(metrics).map(([name,values])=>[name,samples(values)]));
 const missedTargets=Object.entries(LOAD_WORKLOAD.local_targets_ms).filter(([key,target])=>measured[key].p95>Number(target)).map(([key])=>key);
 const report={schema_version:1,kind:'local_inbox_load_observation',workload:LOAD_WORKLOAD,workload_sha256:contentDigest(LOAD_WORKLOAD),hardware:host,hardware_sha256:contentDigest(host),runtime,
  capacity:inbox.intakeLimits(),source_clock:'application_clock',started_at:startedAt,completed_at:Date.now(),elapsed_ms:performance.now()-started,
  accepted_delivery_ids:[...accepted.keys()].sort(),persisted_delivery_ids:persisted.map(r=>r.delivery_id),consumed_delivery_ids:consumed.map(r=>r.delivery_id),
  counts:{unique_deliveries:ordinal,submission_attempts:submissionAttempts,duplicate_deliveries:duplicateRequests,accepted:accepted.size,persisted:persisted.length,consumed:consumed.length,
   backpressured,retry_exhausted:ordinal-accepted.size,acknowledged_without_persistence:[...accepted.keys()].filter(key=>!persisted.some(r=>r.delivery_id===key)).length,
   unexplained_differences:differences},
  metrics:measured,phases,observations,external_dependency_wait_ms:null,external_wait_observed:false,missed_local_targets:missedTargets,
  within_envelope:accepted.size===ordinal&&differences===0&&missedTargets.length===0,approved_hardware_qualified:false,production_qualified:false,
  connected_dependency_qualified:false,financial_or_customer_effects_executed:false,queue_scope:'unconsumed_merchant_inbox',total_database_retention_bounded:false};
 validateLoadObservation(report);return report;
}
