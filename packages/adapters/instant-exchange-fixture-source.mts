import { FulfillmentFixtureSource } from './fulfillment-fixture-source.mts';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { exact,id,integer } from '../commerce/kernel.mts';
import type { Row } from '../commerce/kernel.mts';
import { canonical,contentDigest,jsonValue } from '../commerce/configuration-values.mts';
import { minor } from '../commerce/resolution-ledger.mts';
import * as trials from './delivery-trial-source-guards.mts';

const hash=(x:unknown)=>{if(typeof x!=='string'||!/^[a-f0-9]{64}$/.test(x))throw new Error('INVALID_INPUT');return x;};
const minimum=(a:bigint,b:bigint)=>a<b?a:b;
const bindingFields=['obligation_id','allocation_id','case_id','resource_id','customer_id','native_return_id','native_original_order_id','exchange_quote_id','exchange_quote_digest','currency','units','original_paid_minor','replacement_variant','quantity'];
function units(value:unknown){
 if(!Array.isArray(value)||!value.length||value.length>100)throw new Error('INSTANT_UNITS_INVALID');
 const keys=new Set<string>();
 for(const u of value){exact(u,['line_id','unit_index','paid_minor']);id(u.line_id);integer(u.unit_index,1);minor(u.paid_minor);const key=u.line_id+':'+u.unit_index;if(keys.has(key))throw new Error('INSTANT_UNITS_INVALID');keys.add(key);}
 return value as Row[];
}
function nativeBinding(value:unknown){
 if(trials.isDeliveryTrial(value))return trials.deliveryTrialBinding(value);
 const b=exact(jsonValue(value),bindingFields);
 for(const key of ['obligation_id','allocation_id','case_id','resource_id','customer_id','exchange_quote_id','replacement_variant'])id(b[key]);
 hash(b.exchange_quote_digest);integer(b.quantity,1);minor(b.original_paid_minor);units(b.units);
 if(b.currency!=='USD'||b.quantity!==b.units.length||b.original_paid_minor!==b.units.reduce((n:bigint,u:Row)=>n+minor(u.paid_minor),0n).toString())throw new Error('INSTANT_COMBINATION_UNQUALIFIED');
 if(!/^gid:\/\/shopify\/Return\/[1-9][0-9]*$/.test(b.native_return_id)||!/^gid:\/\/shopify\/Order\/[1-9][0-9]*$/.test(b.native_original_order_id))throw new Error('INSTANT_SOURCE_BINDING_INVALID');
 return b;
}

/** Separate synthetic native authority. There is no network, card input or live provider mode. */
export class InstantExchangeFixtureSource {
 #fulfillments=new Map<string,FulfillmentFixtureSource>();
 readonly db:DatabaseSync;readonly tenant:string;readonly store:string;readonly identity:string;readonly clock:()=>number;
 readonly qualification='synthetic_only';readonly mode='fixture_native';
 fault:'none'|'before'|'after'|'hang'|'malformed'='none';calls={issue:0,lookup:0};
 constructor(db:DatabaseSync,options:{mode:'fixture';tenant:string;store:string;identity:string;clock?:()=>number}){
  if(options.mode!=='fixture'||Object.keys(options).some(k=>!['mode','tenant','store','identity','clock'].includes(k)))throw new Error('FIXTURE_ONLY');
  this.db=db;this.tenant=id(options.tenant);this.store=id(options.store);id(options.identity);this.clock=options.clock??Date.now;
  db.exec('PRAGMA busy_timeout=5000;'+
   'CREATE TABLE IF NOT EXISTS fixture_instant_identity(id TEXT PRIMARY KEY,tenant TEXT NOT NULL,store TEXT NOT NULL,label TEXT NOT NULL) STRICT;'+
   'CREATE TABLE IF NOT EXISTS fixture_instant_accounts(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL) STRICT;'+
   'CREATE TABLE IF NOT EXISTS fixture_instant_terms(id TEXT NOT NULL,version INTEGER NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(id,version)) STRICT;'+
   'CREATE TABLE IF NOT EXISTS fixture_instant_orders(id TEXT PRIMARY KEY,body TEXT NOT NULL,digest TEXT NOT NULL) STRICT;'+
   'CREATE TABLE IF NOT EXISTS fixture_instant_consents(id TEXT PRIMARY KEY,used_by TEXT,revoked INTEGER NOT NULL DEFAULT 0,body TEXT NOT NULL,digest TEXT NOT NULL) STRICT;'+
   'CREATE TABLE IF NOT EXISTS fixture_instant_obligations(id TEXT PRIMARY KEY,allocation_id TEXT NOT NULL UNIQUE,body TEXT NOT NULL,digest TEXT NOT NULL) STRICT;'+
   'CREATE TABLE IF NOT EXISTS fixture_instant_unit_claims(resource_id TEXT NOT NULL,line_id TEXT NOT NULL,unit_index INTEGER NOT NULL,obligation_id TEXT NOT NULL,PRIMARY KEY(resource_id,line_id,unit_index)) STRICT;'+
   'CREATE TABLE IF NOT EXISTS fixture_instant_operation_bindings(id TEXT PRIMARY KEY,obligation_id TEXT NOT NULL,kind TEXT NOT NULL,generation INTEGER NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL,UNIQUE(obligation_id,kind,generation)) STRICT;'+
   'CREATE TABLE IF NOT EXISTS fixture_instant_operations(id TEXT PRIMARY KEY,obligation_id TEXT NOT NULL,kind TEXT NOT NULL,generation INTEGER NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL,UNIQUE(obligation_id,kind,generation)) STRICT;'+
   'CREATE TABLE IF NOT EXISTS fixture_instant_releases(obligation_id TEXT PRIMARY KEY,operation_id TEXT NOT NULL UNIQUE,state TEXT NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL) STRICT;'+
   'CREATE TABLE IF NOT EXISTS fixture_instant_returns(event_id TEXT PRIMARY KEY,obligation_id TEXT NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL) STRICT;'+
   'CREATE TABLE IF NOT EXISTS fixture_instant_captures(obligation_id TEXT PRIMARY KEY,operation_id TEXT NOT NULL UNIQUE,captured_minor TEXT NOT NULL,currency TEXT NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL) STRICT;');
  this.identity=this.tx(()=>{let r=db.prepare('SELECT * FROM fixture_instant_identity').get() as Row;
   if(!r){r={id:'isource_'+randomUUID().replaceAll('-',''),tenant:this.tenant,store:this.store,label:options.identity};db.prepare('INSERT INTO fixture_instant_identity VALUES(?,?,?,?)').run(r.id,r.tenant,r.store,r.label);}
   if(r.tenant!==this.tenant||r.store!==this.store||r.label!==options.identity)throw new Error('INSTANT_SOURCE_MISMATCH');return r.id;});
 }
 tx<T>(fn:()=>T):T{this.db.exec('BEGIN IMMEDIATE');try{const result=fn();if(result instanceof Promise)throw new Error('ASYNC_TRANSACTION_DENIED');this.db.exec('COMMIT');return result;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 #read(row:Row|undefined,code='INSTANT_SOURCE_NOT_FOUND'){if(!row)throw new Error(code);const b=JSON.parse(row.body);if(contentDigest(b)!==row.digest)throw new Error('INSTANT_SOURCE_INTEGRITY');return b;}
 #saveObligation(b:Row){this.db.prepare('INSERT INTO fixture_instant_obligations VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,digest=excluded.digest').run(b.obligation_id,b.allocation_id,canonical(b),contentDigest(b));}
 #scope(command:Row){if(command.source_identity!==this.identity||command.tenant_id!==this.tenant||command.store_id!==this.store)throw new Error('INSTANT_SOURCE_MISMATCH');}
 // All provision/seed/receive methods below are fixture administration. No merchant API exposes them.
 qualifyAccount(input:unknown){const p=exact(jsonValue(input),['account_id','revision','currency','mandates','bounded_capture','reauthorization','authoritative_lookup','atomic_return_capture','contract_ref','verified_at','expires_at']);
  id(p.account_id);id(p.contract_ref);integer(p.revision,1);integer(p.verified_at);integer(p.expires_at);
  for(const key of ['mandates','bounded_capture','reauthorization','authoritative_lookup','atomic_return_capture'])if(typeof p[key]!=='boolean')throw new Error('INVALID_INPUT');
  if(p.currency!=='USD'||p.verified_at>this.clock()||p.expires_at<=this.clock())throw new Error('INSTANT_ACCOUNT_UNQUALIFIED');
  return this.tx(()=>{const old=this.db.prepare('SELECT revision FROM fixture_instant_accounts WHERE id=?').get(p.account_id) as Row;
   if(p.revision!==(old?.revision??0)+1)throw new Error('INSTANT_ACCOUNT_REVISION');this.db.prepare('INSERT INTO fixture_instant_accounts VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,body=excluded.body,digest=excluded.digest').run(p.account_id,p.revision,canonical(p),contentDigest(p));return {...p,digest:contentDigest(p),qualification:this.qualification};});
 }
 account(accountId:string){const p=this.#read(this.db.prepare('SELECT * FROM fixture_instant_accounts WHERE id=?').get(id(accountId)) as Row,'INSTANT_ACCOUNT_UNQUALIFIED');
  if(p.currency!=='USD'||p.verified_at>this.clock()||p.expires_at<=this.clock()||['mandates','bounded_capture','reauthorization','authoritative_lookup','atomic_return_capture'].some(key=>p[key]!==true))throw new Error('INSTANT_ACCOUNT_UNQUALIFIED');return {...p,digest:contentDigest(p),qualification:this.qualification};}
 publishTerms(input:unknown){const p=exact(jsonValue(input),['terms_id','version','account_id','merchant_approved','merchant_approval_ref','notice','nonreturn_rule','currency','maximum_minor','trial_ms','expires_at']);
  id(p.terms_id);id(p.account_id);id(p.merchant_approval_ref);integer(p.version,1);integer(p.trial_ms,1);integer(p.expires_at);minor(p.maximum_minor);
  if(p.merchant_approved!==true||typeof p.notice!=='string'||p.notice.length<20||p.notice.length>2000||p.nonreturn_rule!=='unreturned_original_paid_v1'||p.currency!=='USD'||p.trial_ms>3600000||p.expires_at<=this.clock())throw new Error('INSTANT_TERMS_UNQUALIFIED');
  this.account(p.account_id);return this.tx(()=>{const old=this.db.prepare('SELECT max(version) version FROM fixture_instant_terms WHERE id=?').get(p.terms_id) as Row;
   if(p.version!==(old?.version??0)+1)throw new Error('INSTANT_TERMS_REVISION');this.db.prepare('INSERT INTO fixture_instant_terms VALUES(?,?,?,?)').run(p.terms_id,p.version,canonical(p),contentDigest(p));return {...p,digest:contentDigest(p)};});}
 #terms(termsId:string,digest?:string){const p=this.#read(this.db.prepare('SELECT * FROM fixture_instant_terms WHERE id=? ORDER BY version DESC LIMIT 1').get(id(termsId)) as Row,'INSTANT_TERMS_UNQUALIFIED');
  if(digest&&contentDigest(p)!==digest)throw new Error('INSTANT_TERMS_CHANGED');if(p.expires_at<=this.clock()||p.merchant_approved!==true)throw new Error('INSTANT_TERMS_UNQUALIFIED');return {...p,digest:contentDigest(p)};}
 seedOrder(input:unknown){const p=exact(jsonValue(input),['resource_id','customer_id','native_original_order_id','currency','units']);id(p.resource_id);id(p.customer_id);units(p.units);
  if(p.currency!=='USD'||!/^gid:\/\/shopify\/Order\/[1-9][0-9]*$/.test(p.native_original_order_id))throw new Error('INSTANT_COMBINATION_UNQUALIFIED');this.db.prepare('INSERT INTO fixture_instant_orders VALUES(?,?,?)').run(p.resource_id,canonical(p),contentDigest(p));}
 #order(binding:Row){const order=this.#read(this.db.prepare('SELECT * FROM fixture_instant_orders WHERE id=?').get(binding.resource_id) as Row);
  if(trials.isDeliveryTrial(binding)&&contentDigest(order)!==binding.order_digest)throw new Error('INSTANT_TRIAL_ORDER_CHANGED');
  for(const key of ['resource_id','customer_id','native_original_order_id','currency'])if(order[key]!==binding[key])throw new Error('INSTANT_SOURCE_BINDING_INVALID');
  for(const u of binding.units){const original=order.units.find((v:Row)=>v.line_id===u.line_id&&v.unit_index===u.unit_index);if(!original||canonical(original)!==canonical(u))throw new Error('INSTANT_ORIGINAL_AMOUNT_CHANGED');}return order;}
 grantConsent(input:unknown){const raw=jsonValue(input),isTrial=trials.isDeliveryTrial(raw.binding),p=exact(raw,['id','account_id','terms_id','terms_digest','binding','maximum_minor','trial_deadline_at','mandate_expires_at','confirmed_at','consent_expires_at','proof_ref','reauthorization_of',...(isTrial?['extension_ms','window_digest','authorization_duration_ms']:[])]);
  id(p.id);id(p.account_id);id(p.terms_id);id(p.proof_ref);hash(p.terms_digest);minor(p.maximum_minor);const b=nativeBinding(p.binding);this.#order(b);
  for(const key of ['trial_deadline_at','mandate_expires_at','confirmed_at','consent_expires_at'])if(!(isTrial&&key==='trial_deadline_at'&&p[key]===null))integer(p[key]);
  const terms=this.#terms(p.terms_id,p.terms_digest),account=this.account(p.account_id);
  if(terms.account_id!==p.account_id||p.confirmed_at>this.clock()||p.consent_expires_at<=this.clock()||p.mandate_expires_at<=this.clock()||p.mandate_expires_at>this.clock()+3600000||p.mandate_expires_at>terms.expires_at||p.mandate_expires_at>account.expires_at||p.consent_expires_at>p.mandate_expires_at||minor(p.maximum_minor)>minor(terms.maximum_minor)||minor(p.maximum_minor)>minor(trials.originalObligation(b)))throw new Error('INSTANT_CONSENT_UNQUALIFIED');
  if(isTrial)trials.assertTrialConsent(this,p,b,terms);
  else if(p.reauthorization_of===null){if(p.trial_deadline_at!==p.confirmed_at+terms.trial_ms||p.trial_deadline_at>=p.mandate_expires_at)throw new Error('INSTANT_CONSENT_UNQUALIFIED');}
  else{const original=this.#obligation(id(p.reauthorization_of));if(original.obligation_id!==b.obligation_id||p.trial_deadline_at!==original.trial_deadline_at||canonical(original.binding)!==canonical(b))throw new Error('INSTANT_CONSENT_BINDING_CHANGED');}
  this.db.prepare('INSERT INTO fixture_instant_consents VALUES(?,NULL,0,?,?)').run(p.id,canonical(p),contentDigest(p));return {id:p.id,digest:contentDigest(p),qualification:this.qualification};
 }
 revokeConsent(consentId:string){const r=this.db.prepare('UPDATE fixture_instant_consents SET revoked=1 WHERE id=?').run(id(consentId));if(r.changes!==1)throw new Error('INSTANT_CONSENT_REQUIRED');return {revoked:true};}
 #consent(consentId:string,binding:Row,usedBy:string|null=null){const row=this.db.prepare('SELECT * FROM fixture_instant_consents WHERE id=?').get(id(consentId)) as Row,c=this.#read(row,'INSTANT_CONSENT_REQUIRED');
  if(row.revoked)throw new Error('INSTANT_CONSENT_REVOKED');if(c.consent_expires_at<=this.clock())throw new Error('INSTANT_CONSENT_EXPIRED');
  if(row.used_by!==null&&row.used_by!==usedBy)throw new Error('INSTANT_CONSENT_USED');if(canonical(c.binding)!==canonical(binding))throw new Error('INSTANT_CONSENT_BINDING_CHANGED');
  const a=this.account(c.account_id),t=this.#terms(c.terms_id,c.terms_digest);this.#order(binding);
  if(c.mandate_expires_at<=this.clock())throw new Error('INSTANT_MANDATE_EXPIRED');
  if(t.account_id!==c.account_id||minor(c.maximum_minor)>minor(t.maximum_minor)||minor(c.maximum_minor)>minor(trials.originalObligation(binding))||c.mandate_expires_at>Math.min(t.expires_at,a.expires_at))throw new Error('INSTANT_CONSENT_UNQUALIFIED');
  if(trials.isDeliveryTrial(binding)){const window=trials.trialWindow(this,c.account_id);if(c.window_digest!==window.digest||c.authorization_duration_ms!==window.authorization_duration_ms||c.mandate_expires_at!==c.confirmed_at+window.authorization_duration_ms)throw new Error('INSTANT_TRIAL_AUTHORIZATION_DURATION_CHANGED');}
  return {consent:c,account:a,terms:t,digest:contentDigest(c)};
 }
 #obligation(ref:string){return this.#read(this.db.prepare('SELECT * FROM fixture_instant_obligations WHERE id=?').get(id(ref)) as Row);}
 #returns(obligation:Row){return (this.db.prepare('SELECT * FROM fixture_instant_returns WHERE obligation_id=?').all(obligation.obligation_id) as Row[]).map(r=>this.#read(r));}
 #balance(obligation:Row){if(trials.isDeliveryTrial(obligation.binding))return trials.deliveryTrialBalance(this,obligation.binding);const received=new Set(this.#returns(obligation).flatMap(r=>r.units.map((u:Row)=>u.line_id+':'+u.unit_index))),unreturned=obligation.binding.units.filter((u:Row)=>!received.has(u.line_id+':'+u.unit_index));
  return {unreturned,remaining:unreturned.reduce((n:bigint,u:Row)=>n+minor(u.paid_minor),0n),received};}
 #release(ref:string){const row=this.db.prepare('SELECT * FROM fixture_instant_releases WHERE obligation_id=?').get(ref) as Row;return row?{...this.#read(row),state:row.state}:{state:'none'};}
 #capture(ref:string){const row=this.db.prepare('SELECT * FROM fixture_instant_captures WHERE obligation_id=?').get(ref) as Row;return row?this.#read(row):null;}
 #active(obligation:Row){if(obligation.state!=='mandate_active')throw new Error('INSTANT_MANDATE_INACTIVE');
  // Authorization expiry is a source fact and is checked again in the capture transaction.
  if(obligation.expires_at<=this.clock())throw new Error('INSTANT_REAUTHORIZATION_REQUIRED');
  const p=this.#consent(obligation.consent_id,obligation.binding,obligation.obligation_id);
  if(p.account.digest!==obligation.account_digest||p.terms.digest!==obligation.terms_digest||p.digest!==obligation.consent_digest)throw new Error('INSTANT_TERMS_CHANGED');return p;
 }
 #publicBinding(o:Row){if(trials.isDeliveryTrial(o.binding))return trials.trialPublicBinding(this,o);return {obligation_id:o.obligation_id,mandate_id:o.mandate_id,mandate_revision:o.mandate_revision,source_identity:this.identity,exchange_quote_id:o.binding.exchange_quote_id,exchange_quote_digest:o.binding.exchange_quote_digest,allocation_id:o.allocation_id,resource_id:o.binding.resource_id,customer_id:o.binding.customer_id,currency:o.binding.currency,maximum_minor:o.maximum_minor,terms_digest:o.terms_digest,consent_id:o.consent_id,expires_at:o.expires_at,trial_deadline_at:o.trial_deadline_at};}
 binding(allocationId:string){const row=this.db.prepare('SELECT * FROM fixture_instant_obligations WHERE allocation_id=?').get(id(allocationId)) as Row;if(!row)return null;const o=this.#read(row);this.#active(o);return this.#publicBinding(o);}
 obligation(ref:string){const o=this.#obligation(ref),balance=this.#balance(o),capture=this.#capture(ref),release=this.#release(ref);
  const compensation=capture?(capture.units as Row[]).filter(u=>balance.received.has(u.line_id+':'+u.unit_index)).reduce((n,u)=>n+minor(u.captured_minor),0n):0n;
  return {...this.#publicBinding(o),state:o.state,account_id:o.account_id,...(trials.isDeliveryTrial(o.binding)?{original_obligation_minor:o.binding.original_obligation_minor,receipt_certain:balance.certain}:{original_paid_minor:o.binding.original_paid_minor}),remaining_minor:o.state==='canceled'?'0':balance.remaining.toString(),captured_minor:capture?.captured_minor??'0',compensation_required_minor:compensation.toString(),release:trials.isDeliveryTrial(o.binding)?{state:'not_required'}:release,qualification:this.qualification};}
 plan(kind:string,input:unknown){
  if(kind==='authorize'){const p=exact(jsonValue(input),['binding','consent_id']),b=nativeBinding(p.binding),v=this.#consent(p.consent_id,b);
   if(v.consent.reauthorization_of!==null)throw new Error('INSTANT_CONSENT_BINDING_CHANGED');
   if(trials.isDeliveryTrial(b))trials.assertTrialConsent(this,v.consent,b,v.terms);
   if(this.db.prepare('SELECT 1 FROM fixture_instant_obligations WHERE id=? OR allocation_id=?').get(b.obligation_id,b.allocation_id))throw new Error('INSTANT_OBLIGATION_EXISTS');
   if(b.units.some((u:Row)=>this.db.prepare('SELECT 1 FROM fixture_instant_unit_claims WHERE resource_id=? AND line_id=? AND unit_index=?').get(b.resource_id,u.line_id,u.unit_index)))throw new Error('INSTANT_UNIT_ALREADY_CLAIMED');
   return {kind,binding:b,obligation_id:b.obligation_id,generation:1,account_id:v.account.account_id,account_digest:v.account.digest,terms_id:v.terms.terms_id,terms_digest:v.terms.digest,consent_id:v.consent.id,consent_digest:v.digest,maximum_minor:v.consent.maximum_minor,amount_minor:v.consent.maximum_minor,trial_deadline_at:v.consent.trial_deadline_at,expires_at:v.consent.mandate_expires_at,mandate_revision:1,...(trials.isDeliveryTrial(b)?trials.trialPlanFields(v.consent):{})};
  }
  const p=exact(jsonValue(input),kind==='reauthorize'?['obligation_id','consent_id']:['obligation_id']),o=this.#obligation(p.obligation_id),capture=this.#capture(o.obligation_id),release=this.#release(o.obligation_id);
  if(o.state!=='mandate_active'||capture)throw new Error('INSTANT_MANDATE_INACTIVE');
  if(kind==='reauthorize'){if(release.state==='reserved')throw new Error('INSTANT_RELEASE_UNRESOLVED');const v=this.#consent(p.consent_id,o.binding);
   if(v.consent.reauthorization_of!==o.obligation_id||v.consent.id===o.consent_id||v.consent.confirmed_at<=o.authorized_at||!trials.isDeliveryTrial(o.binding)&&v.consent.trial_deadline_at!==o.trial_deadline_at)throw new Error('INSTANT_FRESH_CONSENT_REQUIRED');
   if(trials.isDeliveryTrial(o.binding))trials.assertTrialConsent(this,v.consent,o.binding,v.terms);
   return {kind,binding:o.binding,obligation_id:o.obligation_id,generation:o.mandate_revision+1,account_id:v.account.account_id,account_digest:v.account.digest,terms_id:v.terms.terms_id,terms_digest:v.terms.digest,consent_id:v.consent.id,consent_digest:v.digest,maximum_minor:v.consent.maximum_minor,amount_minor:v.consent.maximum_minor,trial_deadline_at:trials.isDeliveryTrial(o.binding)?v.consent.trial_deadline_at:o.trial_deadline_at,expires_at:v.consent.mandate_expires_at,mandate_revision:o.mandate_revision+1,...(trials.isDeliveryTrial(o.binding)?trials.trialPlanFields(v.consent):{})};
  }
  if(kind==='cancel'){if(release.state==='reserved')throw new Error('INSTANT_RELEASE_UNRESOLVED');return {kind,binding:o.binding,obligation_id:o.obligation_id,generation:1,mandate_revision:o.mandate_revision,amount_minor:'0',expires_at:this.clock()+300000};}
  if(kind!=='capture')throw new Error('UNSUPPORTED_ACTION');this.#active(o);
  const trialState=trials.isDeliveryTrial(o.binding)?trials.trialCaptureState(this,o):null;if(!trialState){if(release.state!=='confirmed')throw new Error('INSTANT_RELEASE_UNCONFIRMED');if(this.clock()<o.trial_deadline_at)throw new Error('INSTANT_TRIAL_ACTIVE');}
  const balance=this.#balance(o),amount=minimum(balance.remaining,minor(o.maximum_minor));if(amount===0n)throw new Error('INSTANT_NOT_COLLECTIBLE');
  return {kind,binding:o.binding,obligation_id:o.obligation_id,generation:trialState?trials.trialCaptureGeneration(this,o.obligation_id):1,mandate_revision:o.mandate_revision,consent_id:o.consent_id,terms_digest:o.terms_digest,maximum_minor:o.maximum_minor,amount_minor:amount.toString(),trial_deadline_at:trialState?trialState.clock.ends_at:o.trial_deadline_at,expires_at:o.expires_at,...(trialState?{trial_delivery_digest:trialState.clock.delivery_digest,trial_receipt_digest:trialState.balance.receipt_digest}:{})};
 }
 // Persist the exact approved command before a replaceable transport can alter it.
 bindOperation(input:unknown){const c=jsonValue(input);this.#scope(c);id(c.operation_id);integer(c.generation,1);trials.assertDeliveryTrialGuard(this,c);
  return this.tx(()=>{const rows=this.db.prepare('SELECT * FROM fixture_instant_operation_bindings WHERE id=? OR (obligation_id=? AND kind=? AND generation=?)').all(c.operation_id,c.obligation_id,c.kind,c.generation) as Row[];
   if(rows.length){if(rows.length!==1||rows[0].id!==c.operation_id||rows[0].digest!==contentDigest(c))throw new Error('INSTANT_COMMAND_BINDING_CHANGED');return;}
   const plan=this.plan(c.kind,c.kind==='authorize'?{binding:c.binding,consent_id:c.consent_id}:c.kind==='reauthorize'?{obligation_id:c.obligation_id,consent_id:c.consent_id}:{obligation_id:c.obligation_id});
   for(const key of Object.keys(plan))if(key!=='expires_at'&&canonical(c[key])!==canonical(plan[key]))throw new Error('INSTANT_COMMAND_BINDING_CHANGED');
   if(c.kind!=='cancel'&&c.expires_at!==plan.expires_at)throw new Error('INSTANT_COMMAND_BINDING_CHANGED');
   this.db.prepare('INSERT INTO fixture_instant_operation_bindings VALUES(?,?,?,?,?,?)').run(c.operation_id,c.obligation_id,c.kind,c.generation,canonical(c),contentDigest(c));
  });
 }
 async issue(input:Row){this.calls.issue++;const fault=this.fault;this.fault='none';if(fault==='before')throw new Error('FIXTURE_TRANSPORT_FAILURE');if(fault==='hang')return new Promise<Row>(()=>{});
  const c=jsonValue(input);this.#scope(c);
  const result=this.tx(()=>{
   const rows=this.db.prepare('SELECT * FROM fixture_instant_operation_bindings WHERE id=? OR (obligation_id=? AND kind=? AND generation=?)').all(c.operation_id,c.obligation_id,c.kind,c.generation) as Row[];
   if(rows.length!==1||rows[0].id!==c.operation_id||rows[0].digest!==contentDigest(c))throw new Error('INSTANT_COMMAND_BINDING_CHANGED');
   const old=this.db.prepare('SELECT * FROM fixture_instant_operations WHERE id=?').get(c.operation_id) as Row;if(old)return this.#read(old);
   if(trials.isDeliveryTrial(c.binding)&&!trials.hasDeliveryTrialGuard(this,c))throw new Error('INSTANT_TRIAL_GUARD_REQUIRED');
   let state='rejected',reason:string|null=null,mandate:Row|null=null,captured='0';
   try{
    trials.assertDeliveryTrialGuard(this,c);
    if(!Number.isSafeInteger(c.dispatch_expires_at)||c.dispatch_expires_at<=this.clock())throw new Error('INSTANT_OPERATION_EXPIRED');
    if(c.kind==='authorize'||c.kind==='reauthorize'){
     const plan=this.plan(c.kind,c.kind==='authorize'?{binding:c.binding,consent_id:c.consent_id}:{obligation_id:c.obligation_id,consent_id:c.consent_id});
     for(const key of Object.keys(plan))if(canonical(c[key])!==canonical(plan[key]))throw new Error('INSTANT_COMMAND_BINDING_CHANGED');
     const o={...plan,allocation_id:c.binding.allocation_id,state:'mandate_active',mandate_id:'mandate_'+contentDigest([c.obligation_id,c.generation]).slice(0,32),authorized_at:this.clock()};
     this.#saveObligation(o);if(c.kind==='authorize')for(const u of c.binding.units)this.db.prepare('INSERT INTO fixture_instant_unit_claims VALUES(?,?,?,?)').run(c.binding.resource_id,u.line_id,u.unit_index,c.obligation_id);
     this.db.prepare('UPDATE fixture_instant_consents SET used_by=? WHERE id=? AND used_by IS NULL AND revoked=0').run(c.obligation_id,c.consent_id);state='mandate_active';mandate=this.#publicBinding(o);
    }else if(c.kind==='cancel'){
     const o=this.#obligation(c.obligation_id);if(this.#release(c.obligation_id).state==='reserved')throw new Error('INSTANT_RELEASE_UNRESOLVED');
     if(this.#capture(c.obligation_id)||o.state!=='mandate_active'||o.mandate_revision!==c.mandate_revision)throw new Error('INSTANT_MANDATE_INACTIVE');
     o.state='canceled';this.#saveObligation(o);state='canceled';mandate=this.#publicBinding(o);
    }else if(c.kind==='capture'){
     const o=this.#obligation(c.obligation_id);this.#active(o);
     if(o.mandate_revision!==c.mandate_revision||o.consent_id!==c.consent_id||o.terms_digest!==c.terms_digest||o.maximum_minor!==c.maximum_minor)throw new Error('INSTANT_BINDING_CHANGED');
     if(trials.isDeliveryTrial(o.binding))trials.trialCaptureState(this,o);else{if(this.#release(o.obligation_id).state!=='confirmed')throw new Error('INSTANT_RELEASE_UNCONFIRMED');if(this.clock()<o.trial_deadline_at)throw new Error('INSTANT_TRIAL_ACTIVE');}
     if(this.#capture(o.obligation_id))throw new Error('INSTANT_CAPTURE_EXISTS');
     const balance=this.#balance(o),amount=minimum(minimum(balance.remaining,minor(o.maximum_minor)),minor(c.amount_minor));
     if(amount===0n)throw new Error('INSTANT_NOT_COLLECTIBLE');
     let left=amount;const chargedUnits=balance.unreturned.map((u:Row)=>{const share=minimum(trials.unitObligation(u),left);left-=share;return {...u,captured_minor:share.toString()};});
     const effect={obligation_id:o.obligation_id,operation_id:c.operation_id,captured_minor:amount.toString(),currency:o.binding.currency,mandate_id:o.mandate_id,mandate_revision:o.mandate_revision,units:chargedUnits,observed_at:this.clock(),qualification:this.qualification};
     this.db.prepare('INSERT INTO fixture_instant_captures VALUES(?,?,?,?,?,?)').run(o.obligation_id,c.operation_id,effect.captured_minor,effect.currency,canonical(effect),contentDigest(effect));
     captured=effect.captured_minor;state='captured';mandate=this.#publicBinding(o);
    }else throw new Error('UNSUPPORTED_ACTION');
   }catch(error){if(!(error instanceof Error)||!error.message.startsWith('INSTANT_'))throw error;reason=error.message;}
   const r={id:'ieffect_'+contentDigest([c.operation_id,contentDigest(c)]).slice(0,32),operation_id:c.operation_id,obligation_id:c.obligation_id,kind:c.kind,command_digest:contentDigest(c),state,reason,mandate,captured_minor:captured,currency:c.binding.currency,qualification:this.qualification};
   this.db.prepare('INSERT INTO fixture_instant_operations VALUES(?,?,?,?,?,?)').run(c.operation_id,c.obligation_id,c.kind,c.generation,canonical(r),contentDigest(r));return r;
  });
  if(fault==='after')throw new Error('FIXTURE_RESPONSE_LOST');return fault==='malformed'?{success:true}:result;
 }
 async lookup(operationId:string){this.calls.lookup++;const r=this.db.prepare('SELECT * FROM fixture_instant_operations WHERE id=?').get(id(operationId)) as Row;return r?this.#read(r):null;}
 verifyResult(command:Row,result:Row){const row=this.db.prepare('SELECT * FROM fixture_instant_operations WHERE id=?').get(id(command.operation_id)) as Row,native=this.#read(row);
  if(native.command_digest!==contentDigest(command)||canonical(native)!==canonical(result))throw new Error('INSTANT_RESULT_MISMATCH');return true;}
 bindFulfillmentSource(source:FulfillmentFixtureSource){
  const path=(db:any)=>db.prepare('PRAGMA database_list').all().find((r:Row)=>r.name==='main')?.file;
  if(!(source instanceof FulfillmentFixtureSource)||source.instantSource!==this||source.db===this.db||path(source.db)&&path(source.db)===path(this.db)||source.tenant!==this.tenant||source.store!==this.store)throw new Error('INSTANT_STOCK_SOURCE_UNQUALIFIED');
  const old=this.#fulfillments.get(source.identity);if(old&&old!==source&&path(old.db)!==path(source.db))throw new Error('INSTANT_STOCK_SOURCE_UNQUALIFIED');this.#fulfillments.set(source.identity,source);
 }
 assertReplacement(command:Row,proof:unknown){
  const row=this.db.prepare('SELECT * FROM fixture_instant_obligations WHERE allocation_id=?').get(id(command.allocation_id)) as Row;
  if(!row){if(proof!==null&&proof!==undefined)throw new Error('INSTANT_SOURCE_NOT_FOUND');return null;}
  const o=this.#read(row);this.#active(o);const expected=this.#publicBinding(o);
  if(canonical(proof)!==canonical(expected))throw new Error('INSTANT_BINDING_CHANGED');
  for(const key of ['tenant_id','store_id'])if(command[key]!==({tenant_id:this.tenant,store_id:this.store})[key])throw new Error('INSTANT_SOURCE_MISMATCH');
  for(const key of ['allocation_id','resource_id','customer_id','currency','exchange_quote_digest'])if(command[key]!==expected[key])throw new Error('INSTANT_BINDING_CHANGED');
  if(command.variant_id!==o.binding.replacement_variant||command.quantity!==o.binding.quantity||command.native_original_order_id!==o.binding.native_original_order_id)throw new Error('INSTANT_BINDING_CHANGED');
  return expected;
 }
 reserveReplacement(command:Row,proof:unknown){return this.tx(()=>{
  const binding=this.assertReplacement(command,proof);if(!binding)return null;if(!this.#fulfillments.has(command.source_identity))throw new Error('INSTANT_STOCK_SOURCE_UNQUALIFIED');const o=this.#obligation(binding.obligation_id),old=this.db.prepare('SELECT * FROM fixture_instant_releases WHERE obligation_id=?').get(o.obligation_id) as Row;
  const body={obligation_id:o.obligation_id,operation_id:id(command.operation_id),reservation_id:id(command.reservation_id),command_digest:contentDigest(command),binding_digest:contentDigest(binding)};
  if(old){const b=this.#read(old);if(canonical(b)!==canonical(body))throw new Error('INSTANT_RELEASE_CONFLICT');return {...b,state:old.state};}
  if(this.clock()>=o.trial_deadline_at)throw new Error('INSTANT_TRIAL_ENDED');
  this.db.prepare('INSERT INTO fixture_instant_releases VALUES(?,?,?, ?,?)').run(o.obligation_id,body.operation_id,'reserved',canonical(body),contentDigest(body));return {...body,state:'reserved'};
 });}
 confirmReplacement(command:Row,proof:unknown,nativeResult:Row){return this.tx(()=>{
  // Completion may be observed after expiry. It confirms the original reservation, never grants a new release.
  const row=this.db.prepare('SELECT * FROM fixture_instant_obligations WHERE allocation_id=?').get(id(command.allocation_id)) as Row;if(!row){if(proof)throw new Error('INSTANT_SOURCE_NOT_FOUND');return null;}
  const o=this.#read(row),release=this.db.prepare('SELECT * FROM fixture_instant_releases WHERE obligation_id=?').get(o.obligation_id) as Row,b=this.#read(release,'INSTANT_RELEASE_UNCONFIRMED');
  if(canonical(proof)!==canonical(this.#publicBinding(o))||b.operation_id!==command.operation_id||b.reservation_id!==command.reservation_id||b.command_digest!==contentDigest(command)||b.binding_digest!==contentDigest(proof))throw new Error('INSTANT_RELEASE_CONFLICT');
  const stock=this.#fulfillments.get(command.source_identity),durable=stock?.replacement(command.operation_id),hold=stock?.reservation(command.reservation_id);
  if(!stock||!durable||!hold||hold.state!=='committed'||canonical(durable)!==canonical(nativeResult))throw new Error('INSTANT_RELEASE_UNCONFIRMED');
  if(nativeResult.state!=='created'||nativeResult.fulfillable!==true||nativeResult.inventory_committed!==true||nativeResult.operation_id!==command.operation_id)throw new Error('INSTANT_RELEASE_UNCONFIRMED');
  id(nativeResult.id);for(const key of Object.keys(command))if(canonical(nativeResult[key])!==canonical(command[key]))throw new Error('INSTANT_RELEASE_CONFLICT');
  this.db.prepare("UPDATE fixture_instant_releases SET state='confirmed' WHERE obligation_id=?").run(o.obligation_id);return {...b,state:'confirmed',native_id:nativeResult.id};
 });}
 confirmReceived(input:unknown){const p=exact(jsonValue(input),['obligation_id','event_id','units','observed_at']);id(p.obligation_id);id(p.event_id);integer(p.observed_at);
  if(p.observed_at>this.clock()||!Array.isArray(p.units)||!p.units.length||p.units.length>100)throw new Error('INSTANT_RECEIPT_INVALID');
  const seen=new Set<string>();for(const u of p.units){exact(u,['line_id','unit_index']);id(u.line_id);integer(u.unit_index,1);const key=u.line_id+':'+u.unit_index;if(seen.has(key))throw new Error('INSTANT_RECEIPT_INVALID');seen.add(key);}
  return this.tx(()=>{const o=this.#obligation(p.obligation_id),old=this.db.prepare('SELECT * FROM fixture_instant_returns WHERE event_id=?').get(p.event_id) as Row;
   if(old){if(old.digest!==contentDigest(p))throw new Error('INSTANT_RECEIPT_CONFLICT');return this.obligation(o.obligation_id);}
   if(p.units.some((u:Row)=>!o.binding.units.some((v:Row)=>v.line_id===u.line_id&&v.unit_index===u.unit_index)))throw new Error('INSTANT_RECEIPT_INVALID');
   this.db.prepare('INSERT INTO fixture_instant_returns VALUES(?,?,?,?)').run(p.event_id,p.obligation_id,canonical(p),contentDigest(p));return this.obligation(o.obligation_id);
  });
 }
}
