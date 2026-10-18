import { id } from './kernel.mts';
import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { contentDigest,canonical,jsonValue } from './configuration-values.mts';
import { allocationContext,checkedBody,resolutionSettings,minor,RESOLVE_ACTION } from './resolution-ledger.mts';
import { currentResolutionQuote,resolutionQuoteRow,recordResolutionObservation } from './refund-quotes.mts';
import { ResolutionFixtureSource } from '../adapters/resolution-fixture-source.mts';
import { ActionGateway } from './action-gateway.mts';
import { permissionDecision } from './authorization.mts';
import { assertExecution } from './execution-stops.mts';
import { assertCaseWorkerScope } from './work-leases.mts';
import { assertRecoveryEgress } from './data-guards.mts';
import { bindLineageResolution } from '../adapters/exchange-lineage-source-guards.mts';
import { feeHistory } from './exchange-fees.mts';

export class ResolutionExecution {
 readonly kernel:CommerceKernel;readonly source:ResolutionFixtureSource;readonly deadlineMs:number;
 constructor(k:CommerceKernel,source:ResolutionFixtureSource,options:{deadline_ms?:number}={}){
  if(Object.keys(options).some(key=>key!=='deadline_ms')||!Number.isInteger(options.deadline_ms??1000)||(options.deadline_ms??1000)<5||(options.deadline_ms??1000)>30000)throw new Error('RESOLUTION_DEADLINE_INVALID');
  this.deadlineMs=options.deadline_ms??1000;
  if(!(source instanceof ResolutionFixtureSource)||source.db===k.db)throw new Error('SEPARATE_FIXTURE_SOURCE_REQUIRED');
  const path=(db:any)=>db.prepare('PRAGMA database_list').all().find((r:Row)=>r.name==='main')?.file;
  if(path(source.db)&&path(source.db)===path(k.db))throw new Error('SEPARATE_FIXTURE_SOURCE_REQUIRED');
  this.kernel=k;this.source=source;
 }
 async #bounded<T>(call:()=>Promise<T>):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([Promise.resolve().then(call),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('RESOLUTION_SOURCE_TIMEOUT')),this.deadlineMs);})]);}
  finally{if(timer)clearTimeout(timer);}
 }
 #context(scope:Scope,ref:string,action:string){const k=this.kernel,s=k.require(scope),op=k.db.prepare('SELECT * FROM commerce_resolution_operations WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,id(ref)) as Row;
  if(!op)throw new Error('NOT_FOUND');const c=allocationContext(k,scope,op.allocation_id,false);k.authorize(scope,action,op.resource_id);
  if(op.source_identity!==this.source.identity||s.tenant_id!==this.source.tenant||s.store_id!==this.source.store)throw new Error('RESOLUTION_SOURCE_MISMATCH');
  const command=JSON.parse(op.command);if(contentDigest(command)!==op.digest||command.operation_id!==op.id||command.allocation_id!==op.allocation_id||command.resource_id!==c.c.resource_id||command.customer_id!==c.c.customer_id||command.amount_minor!==op.amount_minor||command.currency!==op.currency||command.kind!==op.kind)throw new Error('RESOLUTION_INTEGRITY');
  return {...c,op,command};
 }
 #beforeSend(scope:Scope,opId:string){const ctx=this.#context(scope,opId,'operation.dispatch'),{op,s}=ctx,k=this.kernel;
  assertCaseWorkerScope(k,scope,op.case_id,op.id);assertRecoveryEgress(k);
  const receipt=new ActionGateway(k).receipt(scope,op.receipt_id);if(receipt.resolution_operation_id!==op.id||receipt.effect!=='synthetic_resolution_authorized')throw new Error('RESOLUTION_APPROVAL_REQUIRED');
  const approval=k.db.prepare('SELECT * FROM commerce_action_approvals WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,receipt.approval_id) as Row;
  const member=approval&&k.db.prepare('SELECT * FROM commerce_members WHERE tenant_id=? AND store_id=? AND actor_id=? AND active=1').get(s.tenant_id,s.store_id,approval.approver) as Row;
  const authority=member&&permissionDecision(k.db,member,'action.approve',op.resource_id);
  if(!approval||approval.revoked||approval.uses!==1||approval.expires_at<=k.clock()||!authority?.allowed||authority.authority_revision!==approval.authority_revision)throw new Error('APPROVAL_AUTHORITY_CHANGED');
  const q=resolutionQuoteRow(k,scope,op.quote_id);if(q.quote.expires_at<=k.clock())throw new Error('REFUND_QUOTE_EXPIRED');
  const current=currentResolutionQuote(k,scope,q.quote,op.id);
  // The current balance is checked above; unrelated reservations do not change
  // this operation's approved amount, customer, source or original quote.
  if(contentDigest({...current,remaining_before_minor:q.quote.remaining_before_minor})!==q.digest)throw new Error('REFUND_QUOTE_CHANGED');
  assertExecution(k,s,RESOLVE_ACTION,q.quote.control_stamp);
  if(resolutionSettings(k,s).source_identity!==op.source_identity)throw new Error('RESOLUTION_SOURCE_MISMATCH');return ctx;
 }
 read(scope:Scope,operationId:string){const {s,op,command}=this.#context(scope,operationId,'operation.read'),k=this.kernel;
  const observations=(k.db.prepare('SELECT stage,body,digest,observed_at FROM commerce_resolution_observations WHERE tenant_id=? AND store_id=? AND operation_id=? ORDER BY seq').all(s.tenant_id,s.store_id,op.id) as Row[]).map(r=>({stage:r.stage,body:checkedBody(r),observed_at:r.observed_at}));
  return {id:op.id,allocation_id:op.allocation_id,kind:op.kind,state:op.state,amount_minor:op.amount_minor,currency:op.currency,native_id:op.native_id,observations,
   retry_allowed:false,cash_settled:op.kind==='refund'&&op.state==='settled',credit_issued:op.kind==='store_credit'&&op.state==='issued',
   ...(op.kind==='additional_payment'?{payment_settled:op.state==='settled',payment:observations.filter(r=>r.body.payment).at(-1)?.body.payment??null}:{}),
   ...(command.money_terms?{money_terms:command.money_terms,fee_history:feeHistory(k,s,op.case_id).obligations.find((r:Row)=>r.allocation_id===op.allocation_id)??null}:{}),qualification:'synthetic_only',live_financial_effect:false};
 }
 #record(ctx:Row,input:unknown){const b=jsonValue(input),{op,s,command}=ctx,k=this.kernel;
  if(!b||typeof b!=='object'||Object.keys(b).sort().join(',')!==[...Object.keys(command),'id','state','instrument','qualification',...(op.kind==='additional_payment'?['payment']:[])].sort().join(','))throw new Error('RESOLUTION_RESULT_INVALID');
  for(const key of Object.keys(command))if(canonical(b[key])!==canonical(command[key]))throw new Error('RESOLUTION_RESULT_MISMATCH');
  id(b.id);if(b.qualification!=='synthetic_only'||!(op.kind==='refund'?['accepted','settled','rejected']:op.kind==='additional_payment'?['unpaid','partial','failed','expired','settled','rejected']:['issued','rejected']).includes(b.state))throw new Error('RESOLUTION_STAGE_INVALID');
  if(op.native_id&&op.native_id!==b.id)throw new Error('RESOLUTION_RESULT_MISMATCH');
  if(['settled','issued','rejected'].includes(op.state)&&op.state!==b.state)throw new Error('RESOLUTION_STAGE_REGRESSION');
  if(b.state==='rejected'&&op.state==='accepted')throw new Error('RESOLUTION_STAGE_REGRESSION');
  if(op.kind==='additional_payment'){
   const payment=b.payment;if(!payment||Object.keys(payment).sort().join(',')!=='amount_minor,currency,customer_id,expires_at,obligation_id,paid_minor,settled,state'||payment.obligation_id!==op.id||payment.amount_minor!==op.amount_minor||payment.currency!==op.currency||payment.customer_id!==command.customer_id||payment.expires_at!==command.payment_expires_at||payment.state!==b.state||payment.settled!==(b.state==='settled'))throw new Error('EXCHANGE_PAYMENT_MISMATCH');
   const received=minor(payment.paid_minor),amount=minor(op.amount_minor);if(received>amount||b.state==='settled'&&received!==amount||b.state==='partial'&&(received===0n||received===amount)||['unpaid','rejected'].includes(b.state)&&received!==0n)throw new Error('EXCHANGE_PAYMENT_MISMATCH');
   const previous=k.db.prepare("SELECT body,digest FROM commerce_resolution_observations WHERE tenant_id=? AND store_id=? AND operation_id=? AND stage!='authorized' AND stage!='unknown' ORDER BY seq DESC LIMIT 1").get(s.tenant_id,s.store_id,op.id) as Row;
   if(previous&&received<minor(checkedBody(previous).payment.paid_minor))throw new Error('RESOLUTION_STAGE_REGRESSION');
  }
  if(op.kind==='store_credit'&&b.state==='issued'){
   const i=b.instrument;if(!i||Object.keys(i).sort().join(',')!=='account_id,balance_minor,currency,customer_id,expires_at,type'||i.type!=='native_store_credit'||i.customer_id!==(command.credit_beneficiary_id??command.customer_id)||i.currency!==command.currency||i.expires_at!==null)throw new Error('CREDIT_INSTRUMENT_INVALID');
   id(i.account_id);minor(i.balance_minor);
  }else if(b.instrument!==null)throw new Error('RESOLUTION_RESULT_INVALID');
  const prev=k.db.prepare('SELECT body,digest FROM commerce_resolution_observations WHERE tenant_id=? AND store_id=? AND operation_id=? AND stage=? ORDER BY seq DESC LIMIT 1').get(s.tenant_id,s.store_id,op.id,b.state) as Row;
  if(prev&&op.kind==='store_credit'&&b.state==='issued'&&checkedBody(prev).instrument.account_id!==b.instrument.account_id)throw new Error('CREDIT_INSTRUMENT_CHANGED');
  if(prev&&prev.digest===contentDigest(b))return;
  k.db.prepare('UPDATE commerce_resolution_operations SET state=?,native_id=?,observed_at=? WHERE tenant_id=? AND store_id=? AND id=?').run(b.state,b.id,k.clock(),s.tenant_id,s.store_id,op.id);
  recordResolutionObservation(k,s,op.id,op.resource_id,b.state,b);
 }
 async dispatch(scope:Scope,operationId:string){const k=this.kernel,prepared=k.transaction(()=>{
   const ctx=this.#context(scope,operationId,'operation.dispatch');if(ctx.op.state!=='authorized')return null;
   const active=this.#beforeSend(scope,operationId);
   k.db.prepare("UPDATE commerce_resolution_operations SET state='unknown',observed_at=? WHERE tenant_id=? AND store_id=? AND id=? AND state='authorized'").run(k.clock(),ctx.s.tenant_id,ctx.s.store_id,operationId);
   recordResolutionObservation(k,ctx.s,operationId,ctx.op.resource_id,'unknown',{reason:'persisted_before_source_call'});return active;
  });
  if(!prepared)return this.read(scope,operationId);
  try{
   const latest=this.#beforeSend(scope,operationId);
   if(Object.hasOwn(latest.command,'gift_source_digest'))this.source.bindGiftResolution(latest.command);
   bindLineageResolution(this.source.db,latest.command,{line_id:latest.b.line_id,units:latest.b.units});
   this.source.money.bindCommand(latest.command);
   const response=await this.#bounded(()=>this.source.issue(latest.command));
   k.transaction(()=>{const current=this.#context(scope,operationId,'operation.dispatch');assertCaseWorkerScope(k,scope,current.op.case_id,current.op.id);assertExecution(k,current.s,RESOLVE_ACTION);this.#record(current,response);});
  }catch{ /* A timeout or permission change never establishes that nothing happened. */ }
  return this.read(scope,operationId);
 }
 async reconcile(scope:Scope,operationId:string){const ctx=this.#context(scope,operationId,'operation.reconcile');
  if(ctx.op.state==='authorized')throw new Error('RESOLUTION_NOT_SENT');
  let response:unknown;try{response=await this.#bounded(()=>this.source.lookup(operationId));}catch{return this.read(scope,operationId);}if(response===null)return this.read(scope,operationId);
  this.kernel.transaction(()=>{const current=this.#context(scope,operationId,'operation.reconcile');if(current.op.digest!==ctx.op.digest)throw new Error('RESOLUTION_INTEGRITY');this.#record(current,response);});
  return this.read(scope,operationId);
 }
}
