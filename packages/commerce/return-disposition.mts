import { exact,id,integer,token } from './kernel.mts';
import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { returnContext,lifecycleBody,receiptSummary,assertReturnWritable,lifecycleObservation,LIFECYCLE_ACTIONS } from './return-lifecycle-core.mts';
import { assertReady,DRAFT_ACTION } from './integration-readiness.mts';
import { assertExecution } from './execution-stops.mts';
import { assertCaseWorkerScope } from './work-leases.mts';
import { assertRecoveryEgress } from './data-guards.mts';
import { permissionDecision } from './authorization.mts';
import { WarehouseFixtureSource } from '../adapters/warehouse-fixture-source.mts';

export function warehouseSettings(k:CommerceKernel,s:Row){const r=k.db.prepare('SELECT * FROM commerce_warehouse_settings WHERE tenant_id=? AND store_id=?').get(s.tenant_id,s.store_id) as Row,b=lifecycleBody(r);
 if(!b.enabled||b.expires_at<=k.clock())throw new Error('WAREHOUSE_NOT_READY');assertReady(k,s,DRAFT_ACTION);return {...b,revision:r.revision,digest:r.digest};}
export function dispositionValue(k:CommerceKernel,scope:Scope,intent:Row,quotedAt:number){const p=exact(intent,['session_id','unit_ids','disposition']);id(p.session_id);
 if(!Array.isArray(p.unit_ids)||!p.unit_ids.length||p.unit_ids.length>100||new Set(p.unit_ids).size!==p.unit_ids.length||!['restock','quarantine','dispose','supplier_return'].includes(p.disposition))throw new Error('INVALID_INPUT');p.unit_ids.forEach(id);
 const s=k.require(scope),session=k.db.prepare('SELECT * FROM commerce_receiving_sessions WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,p.session_id) as Row,config=lifecycleBody(session),ctx=returnContext(k,scope,session.request_id,'return.read',true),settings=warehouseSettings(k,s);
 if(!settings.locations.includes(config.location_id))throw new Error('WAREHOUSE_MAPPING_REQUIRED');
 const summary=receiptSummary(k,s,session.request_id);if(session.state!=='closed')throw new Error('RECEIVING_NOT_CLOSED');
 const units=p.unit_ids.map((ref:string)=>{const r=k.db.prepare('SELECT * FROM commerce_received_units WHERE tenant_id=? AND store_id=? AND id=? AND session_id=?').get(s.tenant_id,s.store_id,ref,session.id) as Row,b=lifecycleBody(r);
  if(b.line_id===null||p.disposition==='restock'&&b.grade!=='sellable')throw new Error('DISPOSITION_DENIED');
  if(k.db.prepare('SELECT 1 FROM commerce_disposition_units WHERE tenant_id=? AND store_id=? AND unit_id=?').get(s.tenant_id,s.store_id,ref))throw new Error('UNIT_ALREADY_DISPOSED');
  const external=k.db.prepare('SELECT body,digest FROM commerce_native_receipts WHERE tenant_id=? AND store_id=? AND request_id=? AND line_id=? AND ordinal=?').get(s.tenant_id,s.store_id,session.request_id,b.line_id,b.ordinal) as Row;
  if(external&&lifecycleBody(external).disposition!==null)throw new Error('UNIT_ALREADY_DISPOSED');
  return {id:ref,line_id:b.line_id,ordinal:b.ordinal,variant_id:b.variant_id,grade:b.grade};}).sort((a:Row,b:Row)=>a.id.localeCompare(b.id));
 const control=assertExecution(k,s,LIFECYCLE_ACTIONS.disposition);assertCaseWorkerScope(k,scope,ctx.c.id);
 return {kind:'disposition',intent:{...p,unit_ids:[...p.unit_ids].sort()},case_id:ctx.c.id,request_id:session.request_id,resource_id:ctx.c.resource_id,customer_id:ctx.c.customer_id,tenant_id:s.tenant_id,store_id:s.store_id,
  case_revision:ctx.c.revision,configuration_digest:ctx.c.configuration_digest,policy_digest:ctx.c.pins.policy.digest,source_version:ctx.c.order.source_version,source_digest:contentDigest(ctx.c.order),receipt_digest:summary.digest,
  native_return_id:config.native_return_id,location_id:config.location_id,units,source_identity:settings.source_identity,settings_revision:settings.revision,settings_digest:settings.digest,control_stamp:control.stamp,
  quoted_at:quotedAt,expires_at:Math.min(quotedAt+300000,settings.expires_at),qualification:'synthetic_only'};
}
export class ReturnDisposition {
 readonly kernel:CommerceKernel;readonly source:WarehouseFixtureSource|null;readonly deadlineMs:number;
 constructor(k:CommerceKernel,source:WarehouseFixtureSource|null=null,options:{deadline_ms?:number}={}){const ms=options.deadline_ms??1000;integer(ms,5);if(ms>30000||Object.keys(options).some(x=>x!=='deadline_ms'))throw new Error('INVALID_INPUT');this.kernel=k;this.source=source;this.deadlineMs=ms;
  if(source){if(!(source instanceof WarehouseFixtureSource)||source.db===k.db)throw new Error('SEPARATE_FIXTURE_SOURCE_REQUIRED');const path=(db:any)=>db.prepare('PRAGMA database_list').all().find((r:Row)=>r.name==='main')?.file;if(path(source.db)&&path(source.db)===path(k.db))throw new Error('SEPARATE_FIXTURE_SOURCE_REQUIRED');}}
 configure(scope:Scope,input:unknown){const p=exact(jsonValue(input),['expected_revision','enabled','source_identity','locations','expires_at']);integer(p.expected_revision);integer(p.expires_at);id(p.source_identity);
  if(typeof p.enabled!=='boolean'||!Array.isArray(p.locations)||!p.locations.length||p.locations.length>20||new Set(p.locations).size!==p.locations.length)throw new Error('INVALID_INPUT');p.locations.forEach(id);
  const k=this.kernel;return k.transaction(()=>{const s=k.authorize(scope,'action.configure');assertReady(k,s,DRAFT_ACTION);if(p.expires_at<=k.clock()||p.expires_at>k.clock()+3600000)throw new Error('INVALID_INPUT');const old=k.db.prepare('SELECT revision FROM commerce_warehouse_settings WHERE tenant_id=? AND store_id=?').get(s.tenant_id,s.store_id) as Row;
   if((old?.revision??0)!==p.expected_revision)throw new Error('WAREHOUSE_SETTINGS_CHANGED');const b={...p};delete b.expected_revision;k.db.prepare('INSERT INTO commerce_warehouse_settings VALUES(?,?,?,?,?) ON CONFLICT(tenant_id,store_id) DO UPDATE SET revision=excluded.revision,body=excluded.body,digest=excluded.digest').run(s.tenant_id,s.store_id,p.expected_revision+1,canonical(b),contentDigest(b));return {revision:p.expected_revision+1,qualification:'synthetic_only'};});}
 quote(scope:Scope,input:unknown){const k=this.kernel,p=jsonValue(input);return k.transaction(()=>{const q=dispositionValue(k,scope,p,k.clock()),s=k.authorize(scope,'action.propose',q.resource_id),ref='lifequote_'+token().slice(0,32),hash=contentDigest(q);
  k.db.prepare('INSERT INTO commerce_lifecycle_quotes VALUES(?,?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,ref,q.request_id,q.case_id,'disposition',canonical(q),hash);
  return {id:ref,digest:hash,quote:q,proposal:{case_id:q.case_id,action:LIFECYCLE_ACTIONS.disposition,arguments:{quote_id:ref,quote_digest:hash}},execution_authorized:false};});}
 #context(scope:Scope,ref:string,action:string){const k=this.kernel,s=k.require(scope),op=k.db.prepare('SELECT * FROM commerce_disposition_operations WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,id(ref)) as Row;
  if(!op)throw new Error('NOT_FOUND');const ctx=returnContext(k,scope,op.request_id,action),command=JSON.parse(op.command);if(contentDigest(command)!==op.digest||command.operation_id!==op.id||command.resource_id!==ctx.r.resource_id)throw new Error('LIFECYCLE_INTEGRITY');return {...ctx,op,command};}
 #source(ctx:Row){if(!this.source)throw new Error('ADAPTER_UNAVAILABLE');if(this.source.tenant!==ctx.s.tenant_id||this.source.store!==ctx.s.store_id||this.source.identity!==ctx.command.source_identity)throw new Error('WAREHOUSE_SOURCE_MISMATCH');return this.source;}
 #before(scope:Scope,ref:string){const ctx=this.#context(scope,ref,'operation.dispatch'),k=this.kernel,qrow=k.db.prepare('SELECT * FROM commerce_lifecycle_quotes WHERE tenant_id=? AND store_id=? AND id=?').get(ctx.s.tenant_id,ctx.s.store_id,ctx.op.quote_id) as Row,q=lifecycleBody(qrow);
  returnContext(k,scope,ctx.r.id,'operation.dispatch',true);assertReturnWritable(k,ctx.s,ctx.r.id);
  // Check the immutable quote without counting this operation's own claimed units twice.
  const owned=k.db.prepare('SELECT unit_id FROM commerce_disposition_units WHERE tenant_id=? AND store_id=? AND operation_id=? ORDER BY unit_id').all(ctx.s.tenant_id,ctx.s.store_id,ref) as Row[];
  if(canonical(owned.map(x=>x.unit_id))!==canonical(q.intent.unit_ids))throw new Error('LIFECYCLE_INTEGRITY');
  const summary=receiptSummary(k,ctx.s,ctx.r.id),settings=warehouseSettings(k,ctx.s);if(summary.digest!==q.receipt_digest||settings.digest!==q.settings_digest||q.expires_at<=k.clock())throw new Error('DISPOSITION_QUOTE_CHANGED');
  if(ctx.c.configuration_digest!==q.configuration_digest||ctx.c.order.source_version!==q.source_version||contentDigest(ctx.c.order)!==q.source_digest)throw new Error('DISPOSITION_QUOTE_CHANGED');
  const receipt=k.db.prepare('SELECT * FROM commerce_action_receipts WHERE tenant_id=? AND store_id=? AND id=?').get(ctx.s.tenant_id,ctx.s.store_id,ctx.op.receipt_id) as Row,b=lifecycleBody(receipt);
  if(b.lifecycle_operation_id!==ref)throw new Error('APPROVAL_UNAVAILABLE');const a=k.db.prepare('SELECT * FROM commerce_action_approvals WHERE tenant_id=? AND store_id=? AND id=?').get(ctx.s.tenant_id,ctx.s.store_id,b.approval_id) as Row;
  const m=a&&k.db.prepare('SELECT * FROM commerce_members WHERE tenant_id=? AND store_id=? AND actor_id=? AND active=1').get(ctx.s.tenant_id,ctx.s.store_id,a.approver) as Row,auth=m&&permissionDecision(k.db,m,'action.approve',ctx.r.resource_id);
  if(!a||a.revoked||a.uses!==1||a.expires_at<=k.clock()||!auth?.allowed||auth.authority_revision!==a.authority_revision)throw new Error('APPROVAL_AUTHORITY_CHANGED');
  assertCaseWorkerScope(k,scope,ctx.c.id);assertExecution(k,ctx.s,LIFECYCLE_ACTIONS.disposition,q.control_stamp);assertRecoveryEgress(k);this.#source(ctx);return ctx;
 }
 async #bounded<T>(call:()=>Promise<T>){let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([Promise.resolve().then(call),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('WAREHOUSE_TIMEOUT')),this.deadlineMs);})]);}finally{if(timer)clearTimeout(timer);}}
 #record(ctx:Row,value:unknown){const b=exact(jsonValue(value),[...Object.keys(ctx.command),'id','state','adjustments','qualification']);for(const key of Object.keys(ctx.command))if(canonical(b[key])!==canonical(ctx.command[key]))throw new Error('DISPOSITION_RESULT_MISMATCH');id(b.id);
  if(b.state!=='applied'||b.qualification!=='synthetic_only'||!Array.isArray(b.adjustments)||b.adjustments.length!==ctx.command.units.length)throw new Error('DISPOSITION_RESULT_INVALID');
  const expected=ctx.command.units.map((u:Row)=>({unit_id:u.id,variant_id:u.variant_id,location_id:ctx.command.location_id,available_delta:ctx.command.disposition==='restock'?1:0}));if(canonical(b.adjustments)!==canonical(expected)||ctx.op.native_id&&ctx.op.native_id!==b.id)throw new Error('DISPOSITION_RESULT_MISMATCH');
  if(ctx.op.state==='applied')return;const k=this.kernel;k.db.prepare("UPDATE commerce_disposition_operations SET state='applied',native_id=? WHERE tenant_id=? AND store_id=? AND id=?").run(b.id,ctx.s.tenant_id,ctx.s.store_id,ctx.op.id);lifecycleObservation(k,ctx.s,ctx.r.id,ctx.op.id,'applied',b);
 }
 read(scope:Scope,ref:string){const ctx=this.#context(scope,ref,'return.read'),rows=this.kernel.db.prepare('SELECT * FROM commerce_lifecycle_observations WHERE tenant_id=? AND store_id=? AND operation_id=? ORDER BY seq').all(ctx.s.tenant_id,ctx.s.store_id,ref) as Row[];
  return {id:ref,state:ctx.op.state,native_id:ctx.op.native_id,disposition:ctx.command.disposition,request_id:ctx.r.id,units:ctx.command.units,location_id:ctx.command.location_id,observations:rows.map(r=>({stage:r.stage,body:lifecycleBody(r)})),retry_allowed:false,qualification:'synthetic_only'};}
 async dispatch(scope:Scope,ref:string){const k=this.kernel,ready=k.transaction(()=>{const ctx=this.#context(scope,ref,'operation.dispatch');if(ctx.op.state!=='authorized')return false;this.#before(scope,ref);
   k.db.prepare("UPDATE commerce_disposition_operations SET state='unknown' WHERE tenant_id=? AND store_id=? AND id=?").run(ctx.s.tenant_id,ctx.s.store_id,ref);lifecycleObservation(k,ctx.s,ctx.r.id,ref,'unknown',{reason:'persisted_before_source_call'});return true;});
  if(ready)try{const ctx=this.#before(scope,ref),result=await this.#bounded(()=>this.#source(ctx).apply(ctx.command));k.transaction(()=>{const current=this.#context(scope,ref,'operation.dispatch');assertCaseWorkerScope(k,scope,current.c.id);assertExecution(k,current.s,LIFECYCLE_ACTIONS.disposition);this.#record(current,result);});}catch{/* An uncertain adjustment requires a source lookup, never another send. */}
  return this.read(scope,ref);
 }
 async reconcile(scope:Scope,ref:string){const ctx=this.#context(scope,ref,'operation.reconcile');if(ctx.op.state==='authorized')throw new Error('DISPOSITION_NOT_SENT');let result:unknown;try{result=await this.#bounded(()=>this.#source(ctx).lookup(ref));}catch{return this.read(scope,ref);}if(result)this.kernel.transaction(()=>this.#record(this.#context(scope,ref,'operation.reconcile'),result));return this.read(scope,ref);}
}
