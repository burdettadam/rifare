import { exact,id,integer,token } from './kernel.mts';
import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { allocationContext,checkedBody,financialFacts,minor,unitComponents } from './resolution-ledger.mts';
import { VariantExchanges } from './variant-exchanges.mts';
import { CaseConfigurations } from './case-configurations.mts';
import { ActionGateway } from './action-gateway.mts';
import { permissionDecision } from './authorization.mts';
import { assertExecution } from './execution-stops.mts';
import { assertCaseWorkerScope } from './work-leases.mts';
import { assertRecoveryEgress } from './data-guards.mts';
import { verifiedGiftCase } from './gift-proof.mts';
import { money } from './money.mts';
import { InstantExchangeFixtureSource } from '../adapters/instant-exchange-fixture-source.mts';
import { isDeliveryTrial,armDeliveryTrialGuard } from '../adapters/delivery-trial-source-guards.mts';
import { trialAuthorizationBinding,trialObligationContext,trialPaymentAuthority,trialReconcileAuthority } from './delivery-trial-core.mts';

export const INSTANT_ACTIONS=Object.freeze({authorize:'diagnostic.instant.authorize',reauthorize:'diagnostic.instant.reauthorize',capture:'diagnostic.instant.capture',cancel:'diagnostic.instant.cancel'});
export const INSTANT_CONTRACT=Object.freeze({id:'rifare-instant-exchange-fixture-v1',version:1,qualification:'synthetic_only',live_transport:false});
const sources=new WeakMap<CommerceKernel,InstantExchangeFixtureSource>();
export const instantObligationId=(tenant:string,store:string,allocation:string)=>'instant_obligation_'+contentDigest([tenant,store,allocation]).slice(0,40);
function sourceFor(k:CommerceKernel){const source=sources.get(k);if(!source)throw new Error('INSTANT_SOURCE_UNAVAILABLE');return source;}
function instantSettings(k:CommerceKernel,s:Row){const r=k.db.prepare('SELECT * FROM commerce_instant_settings WHERE tenant_id=? AND store_id=?').get(s.tenant_id,s.store_id) as Row;
 if(!r)throw new Error('INSTANT_DISABLED');const b=checkedBody(r,'INSTANT_INTEGRITY'),source=sourceFor(k);
 if(!b.enabled||b.expires_at<=k.clock())throw new Error('INSTANT_DISABLED');
 if(b.source_identity!==source.identity||source.tenant!==s.tenant_id||source.store!==s.store_id)throw new Error('INSTANT_SOURCE_MISMATCH');
 const account=source.account(b.account_id);if(account.digest!==b.account_digest)throw new Error('INSTANT_CONFIGURATION_CHANGED');return {...b,revision:r.revision,digest:r.digest};
}
function obligationContext(k:CommerceKernel,scope:Scope,ref:string){const s=k.require(scope),r=k.db.prepare('SELECT * FROM commerce_instant_obligations WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,id(ref)) as Row,b=checkedBody(r,'INSTANT_INTEGRITY');if(isDeliveryTrial(b.binding))return trialObligationContext(k,scope,r,b);const ctx=allocationContext(k,scope,r.allocation_id,false);
 if(r.case_id!==ctx.c.id||r.resource_id!==ctx.c.resource_id||b.binding.resource_id!==ctx.c.resource_id||b.binding.customer_id!==ctx.c.customer_id||b.binding.allocation_id!==r.allocation_id||b.binding.obligation_id!==r.id)throw new Error('INSTANT_INTEGRITY');return {...ctx,obligation:r,body:b};}
function authorizationBinding(k:CommerceKernel,scope:Scope,intent:Row){if(Object.hasOwn(intent,'trial_id'))return trialAuthorizationBinding(k,scope,intent);const q=new VariantExchanges(k).validateForReview(scope,{quote_id:intent.exchange_quote_id,quote_digest:intent.exchange_quote_digest}),ctx=allocationContext(k,scope,q.allocation_id),{s,a,b,c,plan}=ctx;
 k.authorize(scope,'return.read',c.resource_id);if(verifiedGiftCase(k,s,c.id))throw new Error('INSTANT_GIFT_UNQUALIFIED');
 const facts=financialFacts(k,c),paid=facts.paid_lines.find((l:Row)=>l.id===b.line_id);
 const native=k.db.prepare("SELECT * FROM commerce_native_return_operations WHERE tenant_id=? AND store_id=? AND request_id=? AND state='created'").get(s.tenant_id,s.store_id,plan.request_id) as Row;
 if(!native)throw new Error('NATIVE_RETURN_REQUIRED');const nativeBody=JSON.parse(native.native_body);if(contentDigest(nativeBody)!==native.native_digest||!['OPEN','CLOSED'].includes(nativeBody.status))throw new Error('NATIVE_RETURN_INTEGRITY');
 const binding={obligation_id:instantObligationId(s.tenant_id,s.store_id,a.id),allocation_id:a.id,case_id:c.id,resource_id:c.resource_id,customer_id:c.customer_id,native_return_id:native.native_id,native_original_order_id:c.order.payload.native_order_id,
  exchange_quote_id:q.quote_id,exchange_quote_digest:q.quote_digest,currency:b.currency,units:b.units.map((n:number)=>({line_id:b.line_id,unit_index:n,paid_minor:unitComponents(facts,paid,[n]).paid_minor})),original_paid_minor:b.components.paid_minor,replacement_variant:q.replacement_variant,quantity:q.quantity};
 return {...ctx,binding,q};
}
function instantValue(k:CommerceKernel,scope:Scope,kind:string,input:unknown,quotedAt:number){
 const raw=jsonValue(input),intent=exact(raw,kind==='authorize'?(raw&&Object.hasOwn(raw,'trial_id')?['trial_id','consent_id']:['exchange_quote_id','exchange_quote_digest','consent_id']):kind==='reauthorize'?['obligation_id','consent_id']:['obligation_id']);
 let ctx:Row,plan:Row;const source=sourceFor(k);
 if(kind==='authorize'){ctx=authorizationBinding(k,scope,intent);plan=source.plan(kind,{binding:ctx.binding,consent_id:intent.consent_id});}
 else{ctx=obligationContext(k,scope,intent.obligation_id);k.authorize(scope,'return.read',ctx.c.resource_id);plan=source.plan(kind,intent);if(canonical(plan.binding)!==canonical(ctx.body.binding))throw new Error('INSTANT_BINDING_CHANGED');}
 const s=ctx.s,c=ctx.c,settings=instantSettings(k,s),proof=new CaseConfigurations(k).verified(scope,c.id);
 if(settings.account_id!==(plan.account_id??source.obligation(plan.obligation_id).account_id))throw new Error('INSTANT_SOURCE_MISMATCH');
 if(kind==='cancel')plan={...plan,expires_at:Math.min(plan.expires_at,quotedAt+300000)};
 if(k.db.prepare('SELECT 1 FROM commerce_instant_operations WHERE tenant_id=? AND store_id=? AND obligation_id=? AND kind=? AND generation=?').get(s.tenant_id,s.store_id,plan.obligation_id,kind,plan.generation))throw new Error('INSTANT_OPERATION_EXISTS');
 const action=INSTANT_ACTIONS[kind as keyof typeof INSTANT_ACTIONS];if(!action)throw new Error('UNSUPPORTED_ACTION');
 const control=assertExecution(k,s,action);assertCaseWorkerScope(k,scope,c.id);
 const trialAuthority=trialPaymentAuthority(k,scope,kind,plan);
 return {kind,intent,case_id:c.id,case_revision:c.revision,resource_id:c.resource_id,customer_id:c.customer_id,configuration_digest:c.configuration_digest,policy_digest:c.pins.policy.digest,source_version:c.order.source_version,source_digest:contentDigest(c.order),
  source_identity:source.identity,settings_digest:settings.digest,settings_revision:settings.revision,plan,obligation_id:plan.obligation_id,amount_minor:plan.amount_minor,currency:plan.binding.currency,control_stamp:control.stamp,quoted_at:quotedAt,
  expires_at:Math.min(quotedAt+300000,settings.expires_at,proof.expires_at,plan.expires_at,trialAuthority?.expires_at??Number.MAX_SAFE_INTEGER),...(trialAuthority?{trial_authority:trialAuthority}:{}),qualification:'synthetic_only',live_financial_authority:false};
}
function quoteRow(k:CommerceKernel,scope:Scope,ref:string){const s=k.require(scope),r=k.db.prepare('SELECT * FROM commerce_instant_quotes WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,id(ref)) as Row,q=checkedBody(r,'INSTANT_INTEGRITY');
 new CaseConfigurations(k).inspect(scope,r.case_id);k.authorize(scope,'return.read',r.resource_id);if(q.case_id!==r.case_id||q.resource_id!==r.resource_id||q.kind!==r.kind||q.obligation_id!==r.obligation_id)throw new Error('INSTANT_INTEGRITY');return {...r,quote:q};}
function currentQuote(k:CommerceKernel,scope:Scope,row:Row,excludeOperation?:string){
 if(row.quote.expires_at<=k.clock())throw new Error('INSTANT_QUOTE_EXPIRED');
 // Existing operation uniqueness is enforced when committing. Rechecking that same approved operation does not create one.
 let current:Row;
 if(excludeOperation){const op=k.db.prepare('SELECT id FROM commerce_instant_operations WHERE tenant_id=? AND store_id=? AND id=? AND quote_id=?').get(row.tenant_id,row.store_id,excludeOperation,row.id) as Row;
  if(!op)throw new Error('INSTANT_INTEGRITY');current=instantValueExisting(k,scope,row.quote,excludeOperation);
 }else current=instantValue(k,scope,row.quote.kind,row.quote.intent,row.quote.quoted_at);
 if(contentDigest(current)!==row.digest)throw new Error('INSTANT_QUOTE_CHANGED');return current;
}
function instantValueExisting(k:CommerceKernel,scope:Scope,q:Row,operationId:string){
 const source=sourceFor(k),s=k.require(scope),settings=instantSettings(k,s),ctx=q.kind==='authorize'?authorizationBinding(k,scope,q.intent):obligationContext(k,scope,q.obligation_id),c=ctx.c,proof=new CaseConfigurations(k).verified(scope,c.id);
 k.authorize(scope,'return.read',c.resource_id);assertCaseWorkerScope(k,scope,c.id);
 let plan=source.plan(q.kind,q.kind==='authorize'?{binding:ctx.binding,consent_id:q.intent.consent_id}:q.intent);
 if(q.kind==='cancel')plan={...plan,expires_at:Math.min(plan.expires_at,q.quoted_at+300000)};
 const control=assertExecution(k,s,INSTANT_ACTIONS[q.kind as keyof typeof INSTANT_ACTIONS]);
 const trialAuthority=trialPaymentAuthority(k,scope,q.kind,plan,operationId,q.trial_authority);
 return {...q,case_id:c.id,case_revision:c.revision,resource_id:c.resource_id,customer_id:c.customer_id,configuration_digest:c.configuration_digest,policy_digest:c.pins.policy.digest,source_version:c.order.source_version,source_digest:contentDigest(c.order),source_identity:source.identity,settings_digest:settings.digest,settings_revision:settings.revision,plan,amount_minor:plan.amount_minor,currency:plan.binding.currency,control_stamp:control.stamp,...(trialAuthority?{trial_authority:trialAuthority}:{}),expires_at:Math.min(q.quoted_at+300000,settings.expires_at,proof.expires_at,plan.expires_at,trialAuthority?.expires_at??Number.MAX_SAFE_INTEGER)};
}
function observation(k:CommerceKernel,s:Row,operation:string,stage:string,value:Row){k.db.prepare('INSERT INTO commerce_instant_observations(tenant_id,store_id,operation_id,stage,body,digest,observed_at) VALUES(?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,operation,stage,canonical(value),contentDigest(value),k.clock());}

export function instantGatewayQuote(k:CommerceKernel,scope:Scope,p:Row,quotedAt:number){const args=exact(p.arguments,['quote_id','quote_digest']),r=quoteRow(k,scope,args.quote_id),q=currentQuote(k,scope,r);
 if(r.digest!==args.quote_digest||p.case_id!==q.case_id||INSTANT_ACTIONS[q.kind as keyof typeof INSTANT_ACTIONS]!==p.action)throw new Error('INSTANT_QUOTE_CHANGED');
 const s=k.require(scope);return {schema_version:1,tenant_id:s.tenant_id,store_id:s.store_id,case_id:q.case_id,case_revision:q.case_revision,configuration_digest:q.configuration_digest,resource_id:q.resource_id,resource_version:q.source_version,source_digest:q.source_digest,customer_id:q.customer_id,action:p.action,arguments:args,amount:money(q.currency,q.amount_minor),amount_ceiling:money(q.currency,q.amount_minor),readiness_digest:q.settings_digest,control_stamp:q.control_stamp,capability_revision:q.settings_revision,adapter_contract_digest:contentDigest(INSTANT_CONTRACT),policy_digest:q.policy_digest,decision:{eligible:true,reasons:['SYNTHETIC_INSTANT_EXCHANGE_ONLY']},effect_version:0,quoted_at:quotedAt,expires_at:Math.min(quotedAt+300000,q.expires_at),max_uses:1,financial_effect:false};
}
export function commitInstant(k:CommerceKernel,s:Row,preview:Row,receiptId:string){const r=k.db.prepare('SELECT * FROM commerce_instant_quotes WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,preview.arguments.quote_id) as Row,q=checkedBody(r,'INSTANT_INTEGRITY'),p=q.plan;
 const ref='instant_'+contentDigest([s.tenant_id,s.store_id,p.obligation_id,q.kind,p.generation]).slice(0,40),command={...p,operation_id:ref,tenant_id:s.tenant_id,store_id:s.store_id,source_identity:q.source_identity,dispatch_expires_at:q.expires_at};
 if(k.db.prepare('SELECT 1 FROM commerce_instant_operations WHERE tenant_id=? AND store_id=? AND obligation_id=? AND kind=? AND generation=?').get(s.tenant_id,s.store_id,q.obligation_id,q.kind,p.generation))throw new Error('INSTANT_OPERATION_EXISTS');
 if(q.kind==='authorize'){const body={binding:p.binding,source_identity:q.source_identity};k.db.prepare('INSERT INTO commerce_instant_obligations VALUES(?,?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,q.obligation_id,p.binding.allocation_id,q.case_id,q.resource_id,canonical(body),contentDigest(body));}
 k.db.prepare("INSERT INTO commerce_instant_operations VALUES(?,?,?,?,?,?,?,?,?,?,'authorized',?,?,NULL,?)").run(s.tenant_id,s.store_id,ref,q.obligation_id,q.case_id,q.resource_id,q.kind,p.generation,r.id,receiptId,canonical(command),contentDigest(command),k.clock());
 observation(k,s,ref,'authorized',{receipt_id:receiptId,quote_digest:r.digest,kind:q.kind});return ref;
}

export function instantSettlement(k:CommerceKernel,scope:Scope,exchangeQuote:Row){const s=k.require(scope),r=k.db.prepare('SELECT * FROM commerce_instant_obligations WHERE tenant_id=? AND store_id=? AND allocation_id=?').get(s.tenant_id,s.store_id,id(exchangeQuote.allocation_id)) as Row;
 if(!r)return null;const ctx=obligationContext(k,scope,r.id),b=ctx.body.binding,source=sourceFor(k);k.authorize(scope,'return.read',ctx.c.resource_id);instantSettings(k,s);
 if(b.exchange_quote_id!==exchangeQuote.quote_id||b.exchange_quote_digest!==exchangeQuote.quote_digest||b.replacement_variant!==exchangeQuote.replacement_variant||b.quantity!==exchangeQuote.quantity||b.currency!==exchangeQuote.currency||ctx.body.source_identity!==source.identity)throw new Error('INSTANT_BINDING_CHANGED');
 const ops=k.db.prepare('SELECT * FROM commerce_instant_operations WHERE tenant_id=? AND store_id=? AND obligation_id=? ORDER BY generation DESC').all(s.tenant_id,s.store_id,r.id) as Row[];
 if(ops.some(o=>['authorized','unknown'].includes(o.state)))throw new Error('INSTANT_MANDATE_UNCONFIRMED');
 const authorizations=ops.filter(o=>['authorize','reauthorize'].includes(o.kind)&&o.state==='mandate_active').sort((a,b)=>b.generation-a.generation),op=authorizations[0];if(!op)throw new Error('INSTANT_MANDATE_UNCONFIRMED');
 const observed=k.db.prepare("SELECT * FROM commerce_instant_observations WHERE tenant_id=? AND store_id=? AND operation_id=? AND stage='mandate_active' ORDER BY seq DESC LIMIT 1").get(s.tenant_id,s.store_id,op.id) as Row;
 if(!observed)throw new Error('INSTANT_MANDATE_UNCONFIRMED');const result=checkedBody(observed,'INSTANT_INTEGRITY'),binding=source.binding(r.allocation_id);
 if(!binding||contentDigest(JSON.parse(op.command))!==op.digest||result.command_digest!==op.digest||result.operation_id!==op.id||result.id!==op.native_id||canonical(result.mandate)!==canonical(binding))throw new Error('INSTANT_MANDATE_UNCONFIRMED');
 return {instant_exchange:binding};
}

export class InstantExchanges {
 readonly kernel:CommerceKernel;readonly source:InstantExchangeFixtureSource;readonly deadlineMs:number;
 constructor(k:CommerceKernel,source:InstantExchangeFixtureSource,options:{deadline_ms?:number}={}){
  const path=(db:any)=>db.prepare('PRAGMA database_list').all().find((r:Row)=>r.name==='main')?.file;
  if(!(source instanceof InstantExchangeFixtureSource)||source.db===k.db||path(source.db)&&path(source.db)===path(k.db))throw new Error('SEPARATE_FIXTURE_SOURCE_REQUIRED');
  if(Object.keys(options).some(key=>key!=='deadline_ms')||!Number.isInteger(options.deadline_ms??1000)||(options.deadline_ms??1000)<5||(options.deadline_ms??1000)>30000)throw new Error('INSTANT_DEADLINE_INVALID');
  const old=sources.get(k);if(old&&old.identity!==source.identity)throw new Error('INSTANT_SOURCE_MISMATCH');sources.set(k,source);this.kernel=k;this.source=source;this.deadlineMs=options.deadline_ms??1000;
 }
 configure(scope:Scope,input:unknown){const k=this.kernel,p=exact(jsonValue(input),['enabled','expected_revision','source_identity','account_id','expires_at']);integer(p.expected_revision);integer(p.expires_at);id(p.source_identity);id(p.account_id);if(typeof p.enabled!=='boolean')throw new Error('INVALID_INPUT');
  return k.transaction(()=>{const s=k.authorize(scope,'action.configure');if(s.tenant_id!==this.source.tenant||s.store_id!==this.source.store||p.source_identity!==this.source.identity)throw new Error('INSTANT_SOURCE_MISMATCH');
   if(p.expires_at<=k.clock()||p.expires_at>k.clock()+3600000)throw new Error('INVALID_INPUT');const account=p.enabled?this.source.account(p.account_id):null;
   const old=k.db.prepare('SELECT revision FROM commerce_instant_settings WHERE tenant_id=? AND store_id=?').get(s.tenant_id,s.store_id) as Row;if((old?.revision??0)!==p.expected_revision)throw new Error('INSTANT_CONFIGURATION_CHANGED');
   const b={enabled:p.enabled,source_identity:p.source_identity,account_id:p.account_id,expires_at:p.expires_at,account_digest:account?.digest??null};
   k.db.prepare('INSERT INTO commerce_instant_settings VALUES(?,?,?,?,?) ON CONFLICT(tenant_id,store_id) DO UPDATE SET revision=excluded.revision,body=excluded.body,digest=excluded.digest').run(s.tenant_id,s.store_id,p.expected_revision+1,canonical(b),contentDigest(b));return {revision:p.expected_revision+1,digest:contentDigest(b),qualification:'synthetic_only',connected_provider_qualified:false};
  });
 }
 #quote(scope:Scope,kind:string,input:unknown){const k=this.kernel;return k.transaction(()=>{const value=instantValue(k,scope,kind,input,k.clock()),s=k.authorize(scope,'action.propose',value.resource_id),ref='iquote_'+token().slice(0,32),hash=contentDigest(value);
  k.db.prepare('INSERT INTO commerce_instant_quotes VALUES(?,?,?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,ref,value.case_id,value.resource_id,kind,value.obligation_id,canonical(value),hash);
  return {id:ref,digest:hash,quote:value,proposal:{case_id:value.case_id,action:INSTANT_ACTIONS[kind as keyof typeof INSTANT_ACTIONS],arguments:{quote_id:ref,quote_digest:hash}},execution_authorized:false};});}
 quoteAuthorize(scope:Scope,input:unknown){return this.#quote(scope,'authorize',input);}
 quoteReauthorize(scope:Scope,input:unknown){return this.#quote(scope,'reauthorize',input);}
 quoteCapture(scope:Scope,input:unknown){return this.#quote(scope,'capture',input);}
 quoteCancel(scope:Scope,input:unknown){return this.#quote(scope,'cancel',input);}
 binding(scope:Scope,exchangeQuoteId:string){const s=this.kernel.require(scope),row=this.kernel.db.prepare('SELECT * FROM commerce_exchange_quotes WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,id(exchangeQuoteId)) as Row,q=checkedBody(row);
  return instantSettlement(this.kernel,scope,{...q,quote_id:row.id,quote_digest:row.digest});}
 #context(scope:Scope,operationId:string,action:string){const k=this.kernel,s=k.require(scope),op=k.db.prepare('SELECT * FROM commerce_instant_operations WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,id(operationId)) as Row;
  if(!op)throw new Error('NOT_FOUND');const ctx=obligationContext(k,scope,op.obligation_id);k.authorize(scope,action,op.resource_id);const command=JSON.parse(op.command);
  if(contentDigest(command)!==op.digest||command.operation_id!==op.id||command.obligation_id!==op.obligation_id||command.kind!==op.kind||command.generation!==op.generation||command.source_identity!==this.source.identity||canonical(command.binding)!==canonical(ctx.body.binding)||this.source.tenant!==s.tenant_id||this.source.store!==s.store_id)throw new Error('INSTANT_INTEGRITY');return {...ctx,op,command};}
 #beforeSend(scope:Scope,operationId:string){const k=this.kernel,ctx=this.#context(scope,operationId,'operation.dispatch'),{s,op}=ctx;assertRecoveryEgress(k);assertCaseWorkerScope(k,scope,op.case_id);
  const receipt=new ActionGateway(k).receipt(scope,op.receipt_id),approval=k.db.prepare('SELECT * FROM commerce_action_approvals WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,receipt.approval_id) as Row;
  if(receipt.effect!=='synthetic_instant_authorized'||receipt.instant_operation_id!==op.id)throw new Error('INSTANT_APPROVAL_REQUIRED');
  const member=approval&&k.db.prepare('SELECT * FROM commerce_members WHERE tenant_id=? AND store_id=? AND actor_id=? AND active=1').get(s.tenant_id,s.store_id,approval.approver) as Row,authority=member&&permissionDecision(k.db,member,'action.approve',op.resource_id);
  if(!approval||approval.revoked||approval.uses!==1||approval.expires_at<=k.clock()||!authority?.allowed||authority.authority_revision!==approval.authority_revision)throw new Error('APPROVAL_AUTHORITY_CHANGED');
  const r=quoteRow(k,scope,op.quote_id);currentQuote(k,scope,r,op.id);assertExecution(k,s,INSTANT_ACTIONS[op.kind as keyof typeof INSTANT_ACTIONS],r.quote.control_stamp);return ctx;
 }
 read(scope:Scope,operationId:string){const k=this.kernel,{s,op,command}=this.#context(scope,operationId,'operation.read'),observations=(k.db.prepare('SELECT * FROM commerce_instant_observations WHERE tenant_id=? AND store_id=? AND operation_id=? ORDER BY seq').all(s.tenant_id,s.store_id,op.id) as Row[]).map(r=>({stage:r.stage,body:checkedBody(r,'INSTANT_INTEGRITY'),observed_at:r.observed_at}));
  const latest=observations.filter(r=>r.body.command_digest===op.digest&&r.body.operation_id===op.id&&r.body.state===op.state).at(-1),source=latest&&op.state!=='rejected'?this.source.obligation(op.obligation_id):null;
  return {id:op.id,obligation_id:op.obligation_id,kind:op.kind,state:op.state,native_id:op.native_id,amount_minor:command.amount_minor,currency:command.binding.currency,source,observations,retry_allowed:false,qualification:'synthetic_only',live_financial_effect:false};}
 #record(ctx:Row,input:unknown){const b=exact(jsonValue(input),['id','operation_id','obligation_id','kind','command_digest','state','reason','mandate','captured_minor','currency','qualification']),{s,op,command}=ctx,k=this.kernel;
  if(b.operation_id!==op.id||b.obligation_id!==op.obligation_id||b.kind!==op.kind||b.command_digest!==op.digest||b.currency!==command.binding.currency||b.qualification!=='synthetic_only'||!['mandate_active','captured','canceled','rejected'].includes(b.state))throw new Error('INSTANT_RESULT_INVALID');
  id(b.id);minor(b.captured_minor);if(b.state==='captured'&&(op.kind!=='capture'||minor(b.captured_minor)>minor(command.amount_minor)||minor(b.captured_minor)>minor(command.maximum_minor))||b.state!=='captured'&&b.captured_minor!=='0')throw new Error('INSTANT_RESULT_INVALID');
  if(b.state==='mandate_active'&&!['authorize','reauthorize'].includes(op.kind)||b.state==='canceled'&&op.kind!=='cancel')throw new Error('INSTANT_RESULT_INVALID');
  if(!['authorized','unknown'].includes(op.state)&&(op.state!==b.state||op.native_id!==b.id))throw new Error('INSTANT_STAGE_REGRESSION');
  this.source.verifyResult(command,b);
  const previous=k.db.prepare('SELECT digest FROM commerce_instant_observations WHERE tenant_id=? AND store_id=? AND operation_id=? AND stage=? ORDER BY seq DESC LIMIT 1').get(s.tenant_id,s.store_id,op.id,b.state) as Row;if(previous?.digest===contentDigest(b))return;
  k.db.prepare('UPDATE commerce_instant_operations SET state=?,native_id=?,observed_at=? WHERE tenant_id=? AND store_id=? AND id=?').run(b.state,b.id,k.clock(),s.tenant_id,s.store_id,op.id);observation(k,s,op.id,b.state,b);
 }
 async #bounded<T>(call:()=>Promise<T>){let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([Promise.resolve().then(call),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('INSTANT_SOURCE_TIMEOUT')),this.deadlineMs);})]);}finally{if(timer)clearTimeout(timer);}}
 async dispatch(scope:Scope,operationId:string){const k=this.kernel,prepared=k.transaction(()=>{const ctx=this.#context(scope,operationId,'operation.dispatch');if(ctx.op.state!=='authorized')return null;this.#beforeSend(scope,operationId);
   k.db.prepare("UPDATE commerce_instant_operations SET state='unknown',observed_at=? WHERE tenant_id=? AND store_id=? AND id=? AND state='authorized'").run(k.clock(),ctx.s.tenant_id,ctx.s.store_id,operationId);observation(k,ctx.s,operationId,'unknown',{reason:'persisted_before_source_call'});return ctx;});
  if(!prepared)return this.read(scope,operationId);
  let closeTrialGuard=()=>{};
  try{const latest=this.#beforeSend(scope,operationId);closeTrialGuard=armDeliveryTrialGuard(this.source,latest.command,()=>this.#beforeSend(scope,operationId));this.source.bindOperation(latest.command);const response=await this.#bounded(()=>this.source.issue(latest.command));k.transaction(()=>{const current=this.#context(scope,operationId,'operation.dispatch');assertCaseWorkerScope(k,scope,current.op.case_id);assertExecution(k,current.s,INSTANT_ACTIONS[current.op.kind as keyof typeof INSTANT_ACTIONS]);this.#record(current,response);});}catch{/* Unknown means lookup the original operation; even a timeout before an observed effect never authorizes a new key. */}finally{closeTrialGuard();}
  return this.read(scope,operationId);
 }
 async reconcile(scope:Scope,operationId:string){const ctx=this.#context(scope,operationId,'operation.reconcile');if(ctx.op.state==='authorized')throw new Error('INSTANT_NOT_SENT');trialReconcileAuthority(this.kernel,scope,ctx.command);
  let result:unknown;try{result=await this.#bounded(()=>this.source.lookup(operationId));}catch{return this.read(scope,operationId);}if(result===null)return this.read(scope,operationId);
  this.kernel.transaction(()=>{const current=this.#context(scope,operationId,'operation.reconcile');if(current.op.digest!==ctx.op.digest)throw new Error('INSTANT_INTEGRITY');this.#record(current,result);});return this.read(scope,operationId);
 }
}

/** Current source obligations participate in ordinary cancellation and workflow digests. */
export function instantHistory(k:CommerceKernel,s:Row,caseId:string){
 const rows=k.db.prepare('SELECT * FROM commerce_instant_obligations WHERE tenant_id=? AND store_id=? AND case_id=? ORDER BY id').all(s.tenant_id,s.store_id,caseId) as Row[],source=sources.get(k);
 const obligations=rows.map(r=>{const b=checkedBody(r,'INSTANT_INTEGRITY'),ops=k.db.prepare('SELECT id,kind,state,native_id FROM commerce_instant_operations WHERE tenant_id=? AND store_id=? AND obligation_id=? ORDER BY id').all(s.tenant_id,s.store_id,r.id) as Row[];let native:Row|null=null;
  try{if(!source||source.tenant!==s.tenant_id||source.store!==s.store_id||source.identity!==b.source_identity)throw new Error('INSTANT_SOURCE_UNAVAILABLE');native=source.obligation(r.id);}catch{/* Unavailable authority remains an explicit obligation. */}
  const unknown=ops.some(o=>['authorized','unknown'].includes(o.state)),compensation=native?.compensation_required_minor??null;
  const unresolved=!native||unknown||native.release.state==='reserved'||compensation!=='0'||native.state!=='canceled'&&native.captured_minor==='0';
  return {obligation_id:r.id,allocation_id:r.allocation_id,operations:ops,state:native?.state??'source_unavailable',release_state:native?.release.state??'unknown',remaining_minor:native?.remaining_minor??null,captured_minor:native?.captured_minor??null,compensation_required_minor:compensation,currency:native?.currency??b.binding.currency,unresolved};
 });return {obligations,unresolved_count:obligations.filter(o=>o.unresolved).length,digest:contentDigest(obligations)};
}
