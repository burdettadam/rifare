import { assertPreventionConfirmation } from './return-prevention-guards.mts';
import { exact,id,integer,token } from './kernel.mts';
import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { EDIT_ACTION,EDIT_CONTRACT,editBody,editContext,editSettings,editValue,editIntent,editEvent,safeOrder } from './order-edit-core.mts';
import { ActionGateway } from './action-gateway.mts';
import { assertExecution } from './execution-stops.mts';
import { assertRecoveryEgress } from './data-guards.mts';
import { assertCaseWorkerScope } from './work-leases.mts';
import { permissionDecision } from './authorization.mts';
import { OrderEditFixtureSource } from '../adapters/order-edit-fixture-source.mts';

const terminal=new Set(['released','cancelled','abandoned']);
async function bounded<T>(fn:()=>Promise<T>,ms:number):Promise<T>{let timer:ReturnType<typeof setTimeout>;try{return await Promise.race([fn(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('EDIT_SOURCE_TIMEOUT')),ms);})]);}finally{clearTimeout(timer!);}}
export class OrderEdits {
 readonly kernel:CommerceKernel;readonly gateway:ActionGateway;readonly source:OrderEditFixtureSource|undefined;readonly timeout:number;
 constructor(k:CommerceKernel,source?:OrderEditFixtureSource,timeout=1000){this.kernel=k;this.gateway=new ActionGateway(k);this.source=source;integer(timeout,10);if(timeout>10000)throw new Error('INVALID_INPUT');this.timeout=timeout;
  if(source&&(!(source instanceof OrderEditFixtureSource)||source.db===k.db))throw new Error('SEPARATE_FIXTURE_SOURCE_REQUIRED');}
 #source(s:Row,identity?:string){const x=this.source;if(!x)throw new Error('EDIT_SOURCE_UNQUALIFIED');if(x.tenant!==s.tenant_id||x.store!==s.store_id||(identity&&x.identity!==identity))throw new Error('EDIT_SOURCE_MISMATCH');return x;}
 #publish(scope:Scope,s:Row,resource:string,o:Row){const k=this.kernel; k.authorize(scope,'resource.ingest',resource);const old=k.get(scope,resource);
  if(o.resource_id!==resource||o.customer_id!==old.customer_id||o.tenant_id!==s.tenant_id||o.store_id!==s.store_id)throw new Error('EDIT_SOURCE_MISMATCH');
  const observation={source_identity:this.#source(s).identity,version:o.version,digest:contentDigest(safeOrder(o)),return_read_models_require_refresh:true};if(old.payload.order_edit_observation?.digest===observation.digest)return;
  if(old.payload.order_edit_observation&&old.payload.order_edit_observation.version>o.version)throw new Error('EDIT_SOURCE_REGRESSION');
  const {return_lines,resolution_facts,delivered_at,evidence_verified,...retained}=old.payload;
  k.ingest(scope,{kind:'order',source_system:old.source_system,external_id:old.external_id,source_version:old.source_version+1,source_updated_at:k.clock(),customer_id:old.customer_id,
   payload:{...retained,currency:o.currency,total_minor:o.total_minor,status:o.cancelled?'cancelled':o.lines.every((l:Row)=>l.status==='shipped'||l.status==='cancelled')?'shipped':'processing',items:o.lines.filter((l:Row)=>l.status!=='cancelled').map((l:Row)=>({sku:l.variant_id,quantity:l.quantity,unit_minor:l.unit_minor})),order_edit_observation:observation}});
 }
 configure(scope:Scope,input:unknown){const k=this.kernel,p=exact(jsonValue(input),['expected_revision','enabled','expires_at','max_age_ms','warehouses','rules']);integer(p.expected_revision);integer(p.expires_at);integer(p.max_age_ms,1000);
  if(typeof p.enabled!=='boolean'||p.max_age_ms>300000||!Array.isArray(p.warehouses)||!p.warehouses.length||p.warehouses.length>4||new Set(p.warehouses).size!==p.warehouses.length)throw new Error('INVALID_INPUT');for(const w of p.warehouses)id(w);
  const rules=exact(p.rules,['windows_ms','inventory_buffer','payment_ttl_ms']),win=exact(rules.windows_ms,['address','item','cancel']);for(const n of Object.values(win)){integer(n);if(n>86400000)throw new Error('INVALID_INPUT');}integer(rules.inventory_buffer);integer(rules.payment_ttl_ms,1000);if(rules.payment_ttl_ms>3600000)throw new Error('INVALID_INPUT');
  return k.transaction(()=>{const s=k.authorize(scope,'action.configure');assertRecoveryEgress(k);if(p.expires_at<=k.clock()||p.expires_at>k.clock()+3600000)throw new Error('INVALID_INPUT');const source=this.#source(s),probe=source.probe(p.warehouses);
   if(p.enabled&&!probe.qualified)throw new Error('EDIT_HOLD_PROBE_FAILED');const old=k.db.prepare('SELECT revision FROM commerce_edit_settings WHERE tenant_id=? AND store_id=?').get(s.tenant_id,s.store_id) as Row;if((old?.revision??0)!==p.expected_revision)throw new Error('EDIT_SETTINGS_CHANGED');
   const b={enabled:p.enabled,source_identity:source.identity,source_revision:source.revision(),expires_at:p.expires_at,max_age_ms:p.max_age_ms,warehouses:[...p.warehouses].sort(),rules,contract:EDIT_CONTRACT,readiness:probe};
   k.db.prepare('INSERT INTO commerce_edit_settings VALUES(?,?,?,?,?) ON CONFLICT(tenant_id,store_id) DO UPDATE SET revision=excluded.revision,body=excluded.body,digest=excluded.digest').run(s.tenant_id,s.store_id,p.expected_revision+1,canonical(b),contentDigest(b));return {revision:p.expected_revision+1,readiness:probe,live_qualified:false};});
 }
 refresh(scope:Scope,caseId:string){const k=this.kernel;return k.transaction(()=>{const {s,c}=editContext(k,scope,caseId);k.authorize(scope,'resource.ingest',c.resource_id);assertRecoveryEgress(k);const settings=editSettings(k,s),source=this.#source(s,settings.source_identity),snapshot=source.snapshot(c.resource_id);
   if(snapshot.source_revision!==settings.source_revision||snapshot.order.customer_id!==c.customer_id)throw new Error('EDIT_READINESS_CHANGED');
   const actual=[...new Set(snapshot.order.lines.map((l:Row)=>l.warehouse_id))];if(actual.some(w=>!settings.warehouses.includes(w)))throw new Error('EDIT_UNQUALIFIED_WAREHOUSE');
   k.db.prepare('INSERT INTO commerce_edit_snapshots VALUES(?,?,?,?,?,?,?) ON CONFLICT(tenant_id,store_id,resource_id) DO UPDATE SET source_identity=excluded.source_identity,observed_at=excluded.observed_at,body=excluded.body,digest=excluded.digest').run(s.tenant_id,s.store_id,c.resource_id,source.identity,k.clock(),canonical(snapshot),contentDigest(snapshot));this.#publish(scope,s,c.resource_id,snapshot.order);return {resource_id:c.resource_id,version:snapshot.order.version,observed_at:k.clock(),digest:contentDigest(snapshot)};});}
 quote(scope:Scope,input:unknown){const k=this.kernel,intent=editIntent(input);return k.transaction(()=>{const {s,c}=editContext(k,scope,intent.case_id,true);k.authorize(scope,'action.propose',c.resource_id);const q=editValue(k,scope,intent,k.clock()),ref='edit_quote_'+token().slice(0,24);
  const active=k.db.prepare("SELECT id FROM commerce_order_edits WHERE tenant_id=? AND store_id=? AND resource_id=? AND state NOT IN ('released','cancelled','abandoned')").get(s.tenant_id,s.store_id,c.resource_id);if(active)throw new Error('EDIT_ALREADY_ACTIVE');
  k.db.prepare('INSERT INTO commerce_edit_inputs VALUES(?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,ref,c.id,c.resource_id,canonical(intent),contentDigest(intent));k.db.prepare('INSERT INTO commerce_edit_quotes VALUES(?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,ref,c.id,c.resource_id,canonical(q),contentDigest(q));return {id:ref,digest:contentDigest(q),quote:q,approval_required:true,external_effects:0};});}
 prepare(scope:Scope,input:unknown){const p=exact(input,['quote_id','quote_digest']),s=this.kernel.require(scope),r=this.kernel.db.prepare('SELECT * FROM commerce_edit_quotes WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,id(p.quote_id)) as Row,q=editBody(r);return this.gateway.prepare(scope,{case_id:q.case_id,action:EDIT_ACTION,arguments:p});}
 #row(scope:Scope,editId:string,permission='case.read'){const k=this.kernel,s=k.require(scope),r=k.db.prepare('SELECT * FROM commerce_order_edits WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,id(editId)) as Row,b=editBody(r),ctx=editContext(k,scope,r.case_id);k.authorize(scope,permission,r.resource_id);const qr=k.db.prepare('SELECT * FROM commerce_edit_quotes WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,r.quote_id) as Row,q=editBody(qr);
  if(qr.digest!==b.quote_digest||q.resource_id!==r.resource_id||ctx.c.resource_id!==r.resource_id||q.case_id!==r.case_id)throw new Error('EDIT_INTEGRITY');return {s,r,b,q,c:ctx.c};}
 #guard(scope:Scope,ctx:Row){const k=this.kernel,{s,r,q}=ctx;k.authorize(scope,'operation.dispatch',r.resource_id);
  const committed=k.db.prepare("SELECT 1 FROM commerce_edit_steps WHERE tenant_id=? AND store_id=? AND edit_id=? AND stage='commit' AND state='confirmed'").get(s.tenant_id,s.store_id,r.id);
  assertPreventionConfirmation(k,s,r.quote_id,q,!!committed);assertRecoveryEgress(k);assertCaseWorkerScope(k,scope,r.case_id);assertExecution(k,s,EDIT_ACTION,q.control_stamp);
  const settings=editSettings(k,s),source=this.#source(s,q.source_identity);if(settings.digest!==q.settings_digest||source.revision()!==q.source_revision)throw new Error('EDIT_READINESS_CHANGED');const c=this.gateway.cases.resume(scope,r.case_id);if(c.configuration_digest!==q.configuration_digest)throw new Error('EDIT_CONFIGURATION_CHANGED');
  const receipt=k.db.prepare('SELECT * FROM commerce_action_receipts WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,r.receipt_id) as Row,b=editBody(receipt),a=k.db.prepare('SELECT * FROM commerce_action_approvals WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,b.approval_id) as Row;
  if(!a||a.revoked||a.uses!==1)throw new Error('EDIT_APPROVAL_CHANGED');const member=k.db.prepare('SELECT * FROM commerce_members WHERE tenant_id=? AND store_id=? AND actor_id=? AND active=1').get(s.tenant_id,s.store_id,a.approver) as Row,auth=member&&permissionDecision(k.db,member,'action.approve',r.resource_id);if(!auth?.allowed||auth.authority_revision!==a.authority_revision)throw new Error('APPROVAL_AUTHORITY_CHANGED');
  return {settings,source};
 }
 #intent(s:Row,r:Row){return editBody(this.kernel.db.prepare('SELECT * FROM commerce_edit_inputs WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,r.quote_id) as Row);}
 #command(ctx:Row,stage:string,extra:Row={}){const {s,r,q}=ctx,settings=editSettings(this.kernel,s),source=this.#source(s,q.source_identity),intent=this.#intent(s,r);
  return {operation_id:r.id+'_'+contentDigest(stage).slice(0,20),edit_id:r.id,stage,tenant_id:s.tenant_id,store_id:s.store_id,source_identity:source.identity,source_revision:q.source_revision,resource_id:r.resource_id,customer_id:q.customer_id,original_version:q.source_order_version,original_digest:q.source_order_digest,
   final_version:q.source_order_version+1,commit_deadline:q.expires_at,intent,line_ids:q.line_ids,warehouse_ids:q.warehouse_ids,new_total_minor:q.new_total_minor,delta_minor:q.delta_minor,stock_buffer:settings.rules.inventory_buffer,payment_ttl_ms:settings.rules.payment_ttl_ms,...extra};}
 #step(s:Row,edit:string,stage:string){return this.kernel.db.prepare('SELECT * FROM commerce_edit_steps WHERE tenant_id=? AND store_id=? AND edit_id=? AND stage=?').get(s.tenant_id,s.store_id,edit,stage) as Row|undefined;}
 #setState(s:Row,r:Row,state:string,event:Row={}){this.kernel.db.prepare('UPDATE commerce_order_edits SET state=?,revision=revision+1 WHERE tenant_id=? AND store_id=? AND id=?').run(state,s.tenant_id,s.store_id,r.id);editEvent(this.kernel,s,r.id,state,event);}
 #save(ctx:Row,step:Row,result:Row){const k=this.kernel,{s,r}=ctx;
  if(result.operation_id!==step.operation_id||result.edit_id!==r.id||result.source_identity!==r.source_identity||result.order_id!==r.resource_id||result.command_digest!==step.command_digest||result.stage!==step.stage||result.qualification!=='synthetic_only')throw new Error('EDIT_RESULT_MISMATCH');
  if(step.stage.startsWith('hold:')){const [,reason,warehouse]=step.stage.split(':');if(result.acknowledged!==true||result.reason!==reason||result.warehouse_id!==warehouse||result.version!==ctx.q.source_order_version)throw new Error('EDIT_RESULT_MISMATCH');}
  if(step.stage==='begin'&&(result.calculated_id!==r.id||result.version!==ctx.q.source_order_version))throw new Error('EDIT_RESULT_MISMATCH');
  if(step.stage.startsWith('sync:')){const warehouse=step.stage.split(':')[1];if(result.warehouse_id!==warehouse||result.ack_version!==ctx.q.source_order_version+1||typeof result.ack_digest!=='string'||!/^[a-f0-9]{64}$/.test(result.ack_digest))throw new Error('EDIT_RESULT_MISMATCH');}
  if(step.stage.startsWith('release:')){const [,reason,warehouse]=step.stage.split(':');if(result.released!==true||result.reason!==reason||result.warehouse_id!==warehouse)throw new Error('EDIT_RESULT_MISMATCH');}
  if(['commit','change'].includes(step.stage)&&(result.version!==ctx.q.source_order_version+1||result.total_minor!==ctx.q.new_total_minor))throw new Error('EDIT_RESULT_MISMATCH');
  if(step.stage==='invoice'||step.stage==='refund'){const f=result.finance;if(!f||f.order_version!==ctx.q.source_order_version+1||f.amount_minor!==ctx.q.amount_minor||f.currency!==ctx.q.currency||f.customer_id!==ctx.q.customer_id||f.kind!==step.stage||f.method!=='fixture')throw new Error('EDIT_PAYMENT_MISMATCH');}
  k.db.prepare("UPDATE commerce_edit_steps SET state='confirmed',result=?,result_digest=? WHERE tenant_id=? AND store_id=? AND edit_id=? AND stage=? AND state='unknown'").run(canonical(result),contentDigest(result),s.tenant_id,s.store_id,r.id,step.stage);editEvent(k,s,r.id,'step_confirmed',{stage:step.stage,operation_id:step.operation_id,result_digest:contentDigest(result)});
 }
 async #run(scope:Scope,ctx:Row,stage:string,extra:Row={}){const k=this.kernel,{s,r}=ctx;let command:Row|undefined,existing:Row|undefined;
  k.transaction(()=>{this.#guard(scope,ctx);existing=this.#step(s,r.id,stage);if(existing)return;
   if(['begin','change','commit'].includes(stage)&&ctx.q.expires_at<=k.clock())throw new Error('EDIT_QUOTE_EXPIRED');
   command=this.#command(ctx,stage,extra);k.db.prepare("INSERT INTO commerce_edit_steps VALUES(?,?,?,?,?,?,'unknown',NULL,NULL,?)").run(s.tenant_id,s.store_id,r.id,stage,command.operation_id,contentDigest(command),k.clock());this.#setState(s,r,'unknown',{stage,operation_id:command.operation_id});});
  if(existing)return existing.state==='confirmed';
  try{this.#guard(scope,ctx);const result=await bounded(()=>this.#source(s,r.source_identity).perform(command!),this.timeout);
   k.transaction(()=>{this.#guard(scope,ctx);this.#save(ctx,this.#step(s,r.id,stage)!,result);});return true;
  }catch(error){k.transaction(()=>{editEvent(k,s,r.id,'source_outcome_unknown',{stage,reason:'authoritative_lookup_required'});});return false;}
 }
 #finance(s:Row,r:Row,q:Row){const source=this.#source(s,r.source_identity),f=source.finance(r.id);if(!f)return null;
  if(f.source_identity!==r.source_identity||f.order_id!==r.resource_id||f.order_version!==q.source_order_version+1||f.kind!==q.financial_obligation||f.amount_minor!==q.amount_minor||f.currency!==q.currency||f.customer_id!==q.customer_id||f.method!=='fixture')throw new Error('EDIT_PAYMENT_MISMATCH');return f;}
 async dispatch(scope:Scope,editId:string){const ctx=this.#row(scope,editId,'operation.dispatch'),{s,r,q}=ctx,k=this.kernel;if(terminal.has(r.state))return this.status(scope,r.id);
  this.#guard(scope,ctx);
  if((k.db.prepare("SELECT count(*) n FROM commerce_edit_steps WHERE tenant_id=? AND store_id=? AND edit_id=? AND state='unknown'").get(s.tenant_id,s.store_id,r.id) as Row).n)return this.status(scope,r.id);
  const holds=q.financial_obligation==='invoice'?['edit','payment']:q.financial_obligation==='refund'?['edit','refund']:['edit'];
  for(const reason of holds)for(const w of q.warehouse_ids)if(!await this.#run(scope,ctx,'hold:'+reason+':'+w))return this.status(scope,r.id);
  for(const stage of ['begin','change','commit'])if(!await this.#run(scope,ctx,stage))return this.status(scope,r.id);
  k.transaction(()=>this.#publish(scope,s,r.resource_id,this.#source(s,r.source_identity).order(r.resource_id)));
  // Stop cancellation in every shippable system before waiting for the financial leg.
  if(q.action==='cancel')for(const w of q.warehouse_ids)if(!await this.#run(scope,ctx,'sync:'+w+':cancellation'))return this.status(scope,r.id);
  if(q.financial_obligation!=='none'){
   if(!await this.#run(scope,ctx,q.financial_obligation))return this.status(scope,r.id);
   const f=this.#finance(s,r,q);if(!f?.settled||f.state!=='settled'){k.transaction(()=>this.#setState(s,r,'awaiting_'+q.financial_obligation,{finance_state:f?.state??'missing'}));return this.status(scope,r.id);}
  }
  for(const w of q.warehouse_ids)if(!await this.#run(scope,ctx,'sync:'+w+':final'))return this.status(scope,r.id);
  k.transaction(()=>this.#setState(s,r,'ready_for_release'));return this.status(scope,r.id);
 }
 reconcile(scope:Scope,editId:string){const k=this.kernel,ctx=this.#row(scope,editId,'operation.reconcile'),{s,r,q}=ctx;assertRecoveryEgress(k);const source=this.#source(s,r.source_identity);
  const steps=k.db.prepare("SELECT * FROM commerce_edit_steps WHERE tenant_id=? AND store_id=? AND edit_id=? AND state='unknown' ORDER BY started_at,stage").all(s.tenant_id,s.store_id,r.id) as Row[];
  for(const step of steps){const result=source.lookup(step.operation_id);if(result)k.transaction(()=>{k.authorize(scope,'operation.reconcile',r.resource_id);this.#save(ctx,step,result);});}
  const f=this.#finance(s,r,q);if(f)k.transaction(()=>editEvent(k,s,r.id,'finance_observed',{kind:f.kind,state:f.state,amount_minor:f.amount_minor,currency:f.currency,source_version:f.version}));return this.status(scope,r.id);
 }
 async release(scope:Scope,editId:string){const k=this.kernel,ctx=this.#row(scope,editId,'operation.dispatch'),{s,r,q}=ctx;if(terminal.has(r.state))return this.status(scope,r.id);this.#guard(scope,ctx);
  const source=this.#source(s,r.source_identity),steps=k.db.prepare("SELECT * FROM commerce_edit_steps WHERE tenant_id=? AND store_id=? AND edit_id=? AND state='unknown'").all(s.tenant_id,s.store_id,r.id);if(steps.length)throw new Error('EDIT_RECONCILIATION_REQUIRED');
  const o=source.order(r.resource_id),f=q.financial_obligation==='none'?null:this.#finance(s,r,q);if(o.version!==q.source_order_version+1||o.total_minor!==q.new_total_minor)throw new Error('EDIT_FINAL_VERSION_CHANGED');if(o.balance_due_minor!=='0'||q.financial_obligation!=='none'&&(!f?.settled||f.state!=='settled'))throw new Error('EDIT_PAYMENT_OUTSTANDING');
  for(const w of q.warehouse_ids){const row=source.warehouse(r.resource_id,w);if(row.ack_version!==o.version||row.ack_digest!==contentDigest(safeOrder(o)))throw new Error('EDIT_WAREHOUSE_STALE');if(row.holds.some((h:Row)=>h.owner!=='rifare'||h.handle!==r.id))throw new Error('EDIT_FOREIGN_HOLD');}
  for(const w of q.warehouse_ids){for(const reason of ['payment','refund','edit']){const row=source.warehouse(r.resource_id,w);if(!row.holds.some((h:Row)=>h.owner==='rifare'&&h.handle===r.id&&h.reason===reason))continue;
    if(!await this.#run(scope,ctx,'release:'+reason+':'+w,{warehouse_revision:row.revision}))return this.status(scope,r.id);}}
  k.transaction(()=>{this.#guard(scope,ctx);const current=source.order(r.resource_id);if(current.version!==o.version)throw new Error('EDIT_FINAL_VERSION_CHANGED');for(const w of q.warehouse_ids)if(source.warehouse(r.resource_id,w).holds.some((h:Row)=>h.owner==='rifare'&&h.handle===r.id))throw new Error('EDIT_HOLD_REMAINS');
   this.#setState(s,r,q.action==='cancel'?'cancelled':'released',{version:current.version,financial_stage:f?.state??'no_balance',external_hold_release:false});});return this.status(scope,r.id);
 }
 status(scope:Scope,editId:string){const {s,r,q,c}=this.#row(scope,editId),k=this.kernel,rows=k.db.prepare('SELECT stage,state,result,result_digest,operation_id FROM commerce_edit_steps WHERE tenant_id=? AND store_id=? AND edit_id=? ORDER BY started_at,stage').all(s.tenant_id,s.store_id,r.id) as Row[];
  const stages=rows.map(row=>{if(row.result&&contentDigest(JSON.parse(row.result))!==row.result_digest)throw new Error('EDIT_INTEGRITY');return {stage:row.stage,state:row.state,operation_id:row.operation_id};});
  // Source observations are explicit reads, not evidence of completed local writes.
  let source:Row|null=null;try{const adapter=this.#source(s,r.source_identity),o=adapter.order(r.resource_id);source={version:o.version,total_minor:o.total_minor,balance_due_minor:o.balance_due_minor,cancelled:o.cancelled,finance:this.#finance(s,r,q),warehouses:q.warehouse_ids.map((w:string)=>adapter.warehouse(r.resource_id,w))};}catch{source=null;}
  const history=(k.db.prepare('SELECT event,observed_at,body,digest FROM commerce_edit_events WHERE tenant_id=? AND store_id=? AND edit_id=? ORDER BY sequence').all(s.tenant_id,s.store_id,r.id) as Row[]).map(e=>({event:e.event,observed_at:e.observed_at,details:editBody(e)}));
  return {id:r.id,case_id:r.case_id,resource_id:r.resource_id,state:r.state,revision:r.revision,action:q.action,currency:q.currency,old_total_minor:q.old_total_minor,new_total_minor:q.new_total_minor,delta_minor:q.delta_minor,configuration_digest:q.configuration_digest,stages,source,history,
   completed:terminal.has(r.state),execution_authorized:false,claim:terminal.has(r.state)?'workflow_complete_not_shipment':'not_complete',qualification:'synthetic_only',live_qualified:false};
 }
 list(scope:Scope,caseId:string){const {s,c}=editContext(this.kernel,scope,caseId);return (this.kernel.db.prepare('SELECT id FROM commerce_order_edits WHERE tenant_id=? AND store_id=? AND case_id=? ORDER BY id LIMIT 100').all(s.tenant_id,s.store_id,c.id) as Row[]).map(r=>this.status(scope,r.id));}
}
