import { id,exact,integer } from './kernel.mts';
import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { checkedBody,minor } from './resolution-ledger.mts';
import { fulfillmentContext,fulfillmentQuoteRow,assertFulfillmentQuote,fulfillmentSettings,FULFILLMENT_ACTIONS,recordFulfillmentObservation,labelRow,currentLabel } from './return-fulfillment-core.mts';
import { FulfillmentFixtureSource } from '../adapters/fulfillment-fixture-source.mts';
import { assertFulfillmentSource } from './replacement-inventory.mts';
import { ActionGateway } from './action-gateway.mts';
import { permissionDecision } from './authorization.mts';
import { assertExecution } from './execution-stops.mts';
import { assertCaseWorkerScope } from './work-leases.mts';
import { assertRecoveryEgress } from './data-guards.mts';

const fields={replacement:['id','state','source_version','fulfillable','inventory_committed','fulfillment_state','shipment_id','qualification'],
 label:['id','state','source_version','charge_id','tracking_code','tracking_state','carrier_sequence','event_id','event_at','void_state','reimbursement','valid_until','qualification'],
 void:['id','state','source_version','reimbursement','qualification']};
function same(a:unknown,b:unknown){return canonical(a)===canonical(b);}
function reimbursement(value:unknown,price:string,old?:Row){const p=exact(value,['state','amount_minor','reference']);if(!['not_requested','pending','refunded','rejected'].includes(p.state))throw new Error('REIMBURSEMENT_INVALID');minor(p.amount_minor);
 if(p.state==='refunded'){if(p.amount_minor!==price)throw new Error('REIMBURSEMENT_INVALID');id(p.reference);}else if(p.amount_minor!=='0'||p.reference!==null)throw new Error('REIMBURSEMENT_UNCONFIRMED');
 if(old){const allowed:Row={not_requested:['not_requested','pending'],pending:['pending','refunded','rejected'],refunded:['refunded'],rejected:['rejected']};
  if(!allowed[old.state].includes(p.state)||(old.state==='refunded'&&!same(old,p)))throw new Error('REIMBURSEMENT_REGRESSION');}return p;}

export class FulfillmentExecution {
 readonly kernel:CommerceKernel;readonly source:FulfillmentFixtureSource;readonly deadlineMs:number;
 constructor(k:CommerceKernel,source:FulfillmentFixtureSource,options:{deadline_ms?:number}={}){
  if(Object.keys(options).some(key=>key!=='deadline_ms'))throw new Error('INVALID_INPUT');integer(options.deadline_ms??1000,5);if((options.deadline_ms??1000)>30000)throw new Error('INVALID_INPUT');
  assertFulfillmentSource(k,source);this.kernel=k;this.source=source;this.deadlineMs=options.deadline_ms??1000;
 }
 async #bounded<T>(call:()=>Promise<T>){let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([Promise.resolve().then(call),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('FULFILLMENT_SOURCE_TIMEOUT')),this.deadlineMs);})]);}finally{if(timer)clearTimeout(timer);}}
 #context(scope:Scope,ref:string,action:string){const k=this.kernel,s=k.require(scope),op=k.db.prepare('SELECT * FROM commerce_fulfillment_operations WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,id(ref)) as Row;
  if(!op)throw new Error('NOT_FOUND');const command=JSON.parse(op.command);if(contentDigest(command)!==op.digest||command.operation_id!==op.id||command.kind!==op.kind||command.obligation!==op.obligation||command.case_id!==op.case_id||command.resource_id!==op.resource_id)throw new Error('FULFILLMENT_INTEGRITY');
  const ctx=fulfillmentContext(k,scope,op.case_id,command.request_id,false);k.authorize(scope,action,op.resource_id);assertFulfillmentSource(k,this.source,s);
  if(command.source_identity!==this.source.identity||command.tenant_id!==s.tenant_id||command.store_id!==s.store_id||command.customer_id!==ctx.c.customer_id)throw new Error('FIXTURE_SOURCE_MISMATCH');return {...ctx,op,command};}
 #before(scope:Scope,ref:string){const ctx=this.#context(scope,ref,'operation.dispatch'),{s,op}=ctx,k=this.kernel;assertCaseWorkerScope(k,scope,op.case_id);assertRecoveryEgress(k);
  const receipt=new ActionGateway(k).receipt(scope,op.receipt_id);if(receipt.fulfillment_operation_id!==op.id||receipt.effect!=='synthetic_fulfillment_authorized')throw new Error('FULFILLMENT_APPROVAL_REQUIRED');
  const a=k.db.prepare('SELECT * FROM commerce_action_approvals WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,receipt.approval_id) as Row;
  const m=a&&k.db.prepare('SELECT * FROM commerce_members WHERE tenant_id=? AND store_id=? AND actor_id=? AND active=1').get(s.tenant_id,s.store_id,a.approver) as Row,authority=m&&permissionDecision(k.db,m,'action.approve',op.resource_id);
  if(!a||a.revoked||a.uses!==1||a.expires_at<=k.clock()||!authority?.allowed||authority.authority_revision!==a.authority_revision)throw new Error('APPROVAL_AUTHORITY_CHANGED');
  const q=fulfillmentQuoteRow(k,scope,op.quote_id);assertFulfillmentQuote(k,scope,q);assertExecution(k,s,FULFILLMENT_ACTIONS[op.kind as keyof typeof FULFILLMENT_ACTIONS],q.quote.control_stamp);
  if(fulfillmentSettings(k,s).source_identity!==this.source.identity)throw new Error('FIXTURE_SOURCE_MISMATCH');return ctx;
 }
 #result(ctx:Row,value:unknown){const b=jsonValue(value),c=ctx.command;exact(b,[...new Set([...Object.keys(c),...fields[c.kind as keyof typeof fields]])]);
  for(const key of Object.keys(c))if(!same(b[key],c[key]))throw new Error('FULFILLMENT_RESULT_MISMATCH');
  id(b.id);integer(b.source_version,1);if(b.qualification!=='synthetic_only'||(ctx.op.native_id&&ctx.op.native_id!==b.id))throw new Error('FULFILLMENT_RESULT_MISMATCH');return b;}
 #recordReplacement(ctx:Row,b:Row){const k=this.kernel,{s,op}=ctx;
  if(b.state!=='created'||b.fulfillable!==true||b.inventory_committed!==true||!['unfulfilled','shipped'].includes(b.fulfillment_state)||b.balance_minor!=='0')throw new Error('REPLACEMENT_NOT_ESTABLISHED');
  if(b.fulfillment_state==='shipped')id(b.shipment_id);else if(b.shipment_id!==null)throw new Error('REPLACEMENT_STATE_INVALID');
  const old=k.db.prepare('SELECT * FROM commerce_replacement_orders WHERE tenant_id=? AND store_id=? AND operation_id=?').get(s.tenant_id,s.store_id,op.id) as Row;
  if(old){const previous=checkedBody(old);if(b.source_version<old.source_version)return false;if(b.source_version===old.source_version){if(!same(previous,b))throw new Error('SOURCE_VERSION_CONFLICT');return false;}
   if(previous.fulfillment_state==='shipped'&&(b.fulfillment_state!=='shipped'||b.shipment_id!==previous.shipment_id))throw new Error('FULFILLMENT_STATE_REGRESSION');}
  k.db.prepare('INSERT INTO commerce_replacement_orders VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,store_id,operation_id) DO UPDATE SET source_version=excluded.source_version,body=excluded.body,digest=excluded.digest').run(s.tenant_id,s.store_id,op.id,b.allocation_id,b.id,b.source_version,canonical(b),contentDigest(b));
  k.db.prepare("UPDATE commerce_inventory_reservations SET state='committed' WHERE tenant_id=? AND store_id=? AND id=? AND generation=?").run(s.tenant_id,s.store_id,b.reservation_id,b.generation);return true;
 }
 #recordLabel(ctx:Row,b:Row){const k=this.kernel,{s,op}=ctx;
  if(b.state!=='purchased'||b.amount_minor!==b.rate.amount_minor||b.currency!==b.rate.currency)throw new Error('LABEL_PURCHASE_NOT_ESTABLISHED');id(b.charge_id);id(b.tracking_code);integer(b.valid_until);integer(b.carrier_sequence);
  if(!['label_created','in_transit','delivered','exception','returned'].includes(b.tracking_state)||!['not_requested','requested','confirmed','rejected','expired_unused'].includes(b.void_state))throw new Error('LABEL_STATE_INVALID');
  if(b.carrier_sequence===0){if(b.event_id!==null||b.event_at!==null||b.tracking_state!=='label_created')throw new Error('TRACKING_EVENT_INVALID');}
  else{id(b.event_id);integer(b.event_at);if(b.event_at>k.clock()||b.tracking_state==='label_created')throw new Error('TRACKING_EVENT_INVALID');}
  reimbursement(b.reimbursement,b.amount_minor);
  if(b.reimbursement.state==='refunded'&&b.void_state!=='confirmed')throw new Error('REIMBURSEMENT_UNCONFIRMED');
  const old=k.db.prepare('SELECT * FROM commerce_return_labels WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,b.id) as Row;
  if(old){const previous=checkedBody(old);if(b.source_version<old.source_version)return false;
   if(b.source_version===old.source_version){if(!same(previous,b))throw new Error('SOURCE_VERSION_CONFLICT');return false;}
   if(previous.operation_id!==b.operation_id||previous.charge_id!==b.charge_id||previous.tracking_code!==b.tracking_code||previous.valid_until!==b.valid_until||b.carrier_sequence<previous.carrier_sequence)throw new Error('LABEL_IDENTITY_CHANGED');
   const sameEvent=['event_id','event_at','tracking_state'];if(b.carrier_sequence===previous.carrier_sequence&&sameEvent.some(key=>b[key]!==previous[key]))throw new Error('SOURCE_EVENT_CONFLICT');
   if(['delivered','returned'].includes(previous.tracking_state)&&!['delivered','exception','returned'].includes(b.tracking_state))throw new Error('TRACKING_REGRESSION');
   const allowed:Row={not_requested:['not_requested','requested','expired_unused'],requested:['requested','confirmed','rejected'],confirmed:['confirmed'],rejected:['rejected'],expired_unused:['expired_unused']};
   const confirmation=previous.void_state==='not_requested'&&['confirmed','rejected'].includes(b.void_state)?k.db.prepare("SELECT 1 FROM commerce_fulfillment_operations WHERE tenant_id=? AND store_id=? AND kind='void' AND obligation=? AND state=?").get(s.tenant_id,s.store_id,b.id,b.void_state==='confirmed'?'void_confirmed':'void_rejected'):null;
   if(!allowed[previous.void_state].includes(b.void_state)&&!confirmation)throw new Error('VOID_STATE_REGRESSION');
   // A correlated void receipt can fill a missed intermediate observation, never create a refund.
   reimbursement(b.reimbursement,b.amount_minor,confirmation?{state:'pending',amount_minor:'0',reference:null}:previous.reimbursement);
  }
  if(b.event_id){const event={id:b.event_id,label_id:b.id,sequence:b.carrier_sequence,status:b.tracking_state,at:b.event_at,source_identity:b.source_identity},hash=contentDigest(event);
   const seen=k.db.prepare('SELECT * FROM commerce_carrier_events WHERE tenant_id=? AND store_id=? AND event_id=?').get(s.tenant_id,s.store_id,b.event_id) as Row;
   if(seen&&seen.digest!==hash)throw new Error('TRACKING_EVENT_CONFLICT');if(!seen)k.db.prepare('INSERT INTO commerce_carrier_events VALUES(?,?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,b.event_id,b.id,b.carrier_sequence,canonical(event),hash,k.clock());}
  if(!old){const active=currentLabel(k,s,b.request_id);
   if((active?.generation??0)+1!==b.generation||(active?.current_label_id??null)!==b.replaces)throw new Error('LABEL_GENERATION_CONFLICT');
   k.db.prepare('INSERT INTO commerce_return_labels VALUES(?,?,?,?,?,?,?,?,?,NULL,?,?,?)').run(s.tenant_id,s.store_id,b.id,op.id,b.request_id,b.case_id,b.resource_id,b.generation,b.replaces,b.source_version,canonical(b),contentDigest(b));
   if(b.replaces)k.db.prepare('UPDATE commerce_return_labels SET replaced_by=? WHERE tenant_id=? AND store_id=? AND id=? AND replaced_by IS NULL').run(b.id,s.tenant_id,s.store_id,b.replaces);
   k.db.prepare('INSERT INTO commerce_return_shipments VALUES(?,?,?,?,?) ON CONFLICT(tenant_id,store_id,request_id) DO UPDATE SET generation=excluded.generation,current_label_id=excluded.current_label_id').run(s.tenant_id,s.store_id,b.request_id,b.generation,b.id);
  }else k.db.prepare('UPDATE commerce_return_labels SET source_version=?,body=?,digest=? WHERE tenant_id=? AND store_id=? AND id=?').run(b.source_version,canonical(b),contentDigest(b),s.tenant_id,s.store_id,b.id);
  return true;
 }
 #record(ctx:Row,value:unknown,scope:Scope){const b=this.#result(ctx,value),{s,op}=ctx,k=this.kernel;
  let changed=true;if(op.kind==='replacement')changed=this.#recordReplacement(ctx,b);else if(op.kind==='label')changed=this.#recordLabel(ctx,b);else{
   if(!['void_requested','void_confirmed','void_rejected'].includes(b.state))throw new Error('VOID_RESULT_INVALID');
   const label=labelRow(k,scope,b.label_id);reimbursement(b.reimbursement,label.label.amount_minor);
   const last=k.db.prepare('SELECT * FROM commerce_fulfillment_observations WHERE tenant_id=? AND store_id=? AND operation_id=? AND stage!=? ORDER BY seq DESC LIMIT 1').get(s.tenant_id,s.store_id,op.id,'unknown') as Row;
   if(last&&['void_requested','void_confirmed','void_rejected'].includes(last.stage)){const prev=checkedBody(last);if(b.source_version<prev.source_version)return;
    if(b.source_version===prev.source_version){if(!same(prev,b))throw new Error('SOURCE_VERSION_CONFLICT');return;}
    if(['void_confirmed','void_rejected'].includes(prev.state)&&prev.state!==b.state)throw new Error('VOID_STATE_REGRESSION');reimbursement(b.reimbursement,label.label.amount_minor,prev.reimbursement);}
  }
  if(!changed)return;k.db.prepare('UPDATE commerce_fulfillment_operations SET state=?,native_id=? WHERE tenant_id=? AND store_id=? AND id=?').run(b.state,b.id,s.tenant_id,s.store_id,op.id);recordFulfillmentObservation(k,s,op.id,b.state,b);
 }
 async dispatch(scope:Scope,ref:string){const k=this.kernel,ctx=k.transaction(()=>{const c=this.#context(scope,ref,'operation.dispatch');if(c.op.state!=='authorized')return null;const ready=this.#before(scope,ref);
   k.db.prepare("UPDATE commerce_fulfillment_operations SET state='unknown' WHERE tenant_id=? AND store_id=? AND id=?").run(c.s.tenant_id,c.s.store_id,ref);recordFulfillmentObservation(k,c.s,ref,'unknown',{reason:'persisted_before_source_call'});return ready;});
  if(!ctx)return this.read(scope,ref);
  try{const latest=this.#before(scope,ref),result=await this.#bounded(()=>latest.op.kind==='replacement'?this.source.replace(latest.command):latest.op.kind==='label'?this.source.buy(latest.command):this.source.voidLabel(latest.command));
   k.transaction(()=>{const current=this.#context(scope,ref,'operation.dispatch');assertCaseWorkerScope(k,scope,current.op.case_id);assertExecution(k,current.s,FULFILLMENT_ACTIONS[current.op.kind as keyof typeof FULFILLMENT_ACTIONS]);this.#record(current,result,scope);});
  }catch{/* Unknown is durable; a new key is not authorization to repeat a charge. */}
  if(ctx.op.kind==='void')await this.refreshLabel(scope,ctx.command.label_id);return this.read(scope,ref);
 }
 async reconcile(scope:Scope,ref:string){const ctx=this.#context(scope,ref,'operation.reconcile');if(ctx.op.state==='authorized')throw new Error('FULFILLMENT_NOT_SENT');
  let value:unknown;try{value=await this.#bounded(()=>this.source.lookup(ref));}catch{return this.read(scope,ref);}if(value===null)return this.read(scope,ref);
  this.kernel.transaction(()=>this.#record(this.#context(scope,ref,'operation.reconcile'),value,scope));
  if(ctx.op.kind==='void')await this.refreshLabel(scope,ctx.command.label_id);return this.read(scope,ref);
 }
 async refreshLabel(scope:Scope,ref:string){const local=labelRow(this.kernel,scope,ref),ctx=this.#context(scope,local.operation_id,'operation.reconcile');let value:unknown;
  try{value=await this.#bounded(()=>this.source.label(ref));}catch{return {observed:false,label_id:ref};}if(!value)return {observed:false,label_id:ref};
  this.kernel.transaction(()=>{const current=this.#context(scope,local.operation_id,'operation.reconcile');this.#record(current,value,scope);});return {observed:true,label_id:ref};
 }
 read(scope:Scope,ref:string){const {s,op}=this.#context(scope,ref,'operation.read'),k=this.kernel;
  const observations=(k.db.prepare('SELECT * FROM commerce_fulfillment_observations WHERE tenant_id=? AND store_id=? AND operation_id=? ORDER BY seq').all(s.tenant_id,s.store_id,ref) as Row[]).map(r=>({stage:r.stage,body:checkedBody(r),observed_at:r.observed_at}));
  let replacement=null;if(op.kind==='replacement'){const r=k.db.prepare('SELECT * FROM commerce_replacement_orders WHERE tenant_id=? AND store_id=? AND operation_id=?').get(s.tenant_id,s.store_id,ref) as Row;if(r){const b=checkedBody(r);replacement={id:b.id,allocation_id:b.allocation_id,native_return_id:b.native_return_id,original_order_id:b.original_order_id,variant_id:b.variant_id,quantity:b.quantity,location_id:b.location_id,fulfillable:b.fulfillable,fulfillment_state:b.fulfillment_state,shipment_id:b.shipment_id,inventory_committed:b.inventory_committed};}}
  return {id:op.id,kind:op.kind,state:op.state,native_id:op.native_id,replacement,observations,retry_allowed:false,qualification:'synthetic_only',live_effect:false};
 }
}
