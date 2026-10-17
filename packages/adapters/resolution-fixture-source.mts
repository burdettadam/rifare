import { DatabaseSync } from 'node:sqlite';
import { exact,id,token,integer } from '../commerce/kernel.mts';
import type { Row } from '../commerce/kernel.mts';
import { canonical,contentDigest,jsonValue } from '../commerce/configuration-values.mts';
import { minor } from '../commerce/resolution-ledger.mts';
import { money,allocateMoney } from '../commerce/money.mts';
import { ExchangeMoneyFixtureSource } from './exchange-money-fixture-source.mts';
import { assertLineageResolution } from './exchange-lineage-source-guards.mts';

/** A separately persisted synthetic authority, not a live payment connector. */
export class ResolutionFixtureSource {
 readonly db:DatabaseSync;readonly identity:string;readonly tenant:string;readonly store:string;readonly qualification='synthetic_only';
 readonly clock:()=>number;readonly money:ExchangeMoneyFixtureSource;
 constructor(db:DatabaseSync,options:{mode:'fixture';identity:string;tenant:string;store:string},clock=Date.now){
  exact(options,['mode','identity','tenant','store']);if(options.mode!=='fixture')throw new Error('LIVE_RESOLUTION_DISABLED');
  this.db=db;this.clock=clock;const label=id(options.identity);if(label.length>48)throw new Error('INVALID_INPUT');this.tenant=id(options.tenant);this.store=id(options.store);db.exec('PRAGMA busy_timeout=3000');
  db.exec(`CREATE TABLE IF NOT EXISTS fixture_resolution_identity(id INTEGER PRIMARY KEY,label TEXT NOT NULL,identity TEXT NOT NULL,tenant TEXT NOT NULL,store TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS fixture_resolution_accounts(resource_id TEXT PRIMARY KEY,customer_id TEXT NOT NULL,payment_id TEXT NOT NULL,currency TEXT NOT NULL,available_minor TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS fixture_resolution_effects(operation_id TEXT PRIMARY KEY,resource_id TEXT NOT NULL,command TEXT NOT NULL,digest TEXT NOT NULL,body TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS fixture_credit_accounts(id TEXT PRIMARY KEY,customer_id TEXT NOT NULL,currency TEXT NOT NULL,balance_minor TEXT NOT NULL,UNIQUE(customer_id,currency));
   CREATE TABLE IF NOT EXISTS fixture_resolution_instruments(resource_id TEXT PRIMARY KEY,body TEXT NOT NULL,digest TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS fixture_gift_recipients(resource_id TEXT NOT NULL,recipient_customer_id TEXT NOT NULL,gift_source_digest TEXT NOT NULL,PRIMARY KEY(resource_id,recipient_customer_id));
   CREATE TABLE IF NOT EXISTS fixture_gift_resolution_bindings(operation_id TEXT PRIMARY KEY,allocation_id TEXT NOT NULL UNIQUE,native_return_id TEXT NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS fixture_payment_captures(operation_id TEXT PRIMARY KEY,resource_id TEXT NOT NULL,allocation_id TEXT NOT NULL,amount_minor TEXT NOT NULL,currency TEXT NOT NULL,UNIQUE(resource_id,allocation_id));
   CREATE UNIQUE INDEX IF NOT EXISTS fixture_resolution_one_allocation ON fixture_resolution_effects(resource_id,json_extract(command,'$.allocation_id'));`);
  const old=db.prepare('SELECT * FROM fixture_resolution_identity WHERE id=1').get() as Row;
  if(old&&(old.label!==label||old.tenant!==this.tenant||old.store!==this.store))throw new Error('RESOLUTION_SOURCE_MISMATCH');
  this.identity=old?.identity??'source_'+contentDigest([label,token()]).slice(0,40);
  if(!old)db.prepare('INSERT INTO fixture_resolution_identity VALUES(1,?,?,?,?)').run(label,this.identity,this.tenant,this.store);
  this.money=new ExchangeMoneyFixtureSource(db,{identity:this.identity,tenant:this.tenant,store:this.store},this.clock);
 }
 seed(input:unknown){const p=exact(jsonValue(input),['resource_id','customer_id','payment_id','currency','available_minor']);id(p.resource_id);id(p.customer_id);id(p.payment_id);money(p.currency,p.available_minor);
  this.db.prepare('INSERT INTO fixture_resolution_accounts VALUES(?,?,?,?,?)').run(p.resource_id,p.customer_id,p.payment_id,p.currency,p.available_minor);}
 seedGiftRecipient(input:unknown){const p=exact(jsonValue(input),['resource_id','recipient_customer_id','gift_source_digest']);id(p.resource_id);id(p.recipient_customer_id);if(typeof p.gift_source_digest!=='string'||!/^[a-f0-9]{64}$/.test(p.gift_source_digest))throw new Error('GIFT_SOURCE_INVALID');
  const original=this.db.prepare('SELECT * FROM fixture_resolution_accounts WHERE resource_id=?').get(p.resource_id) as Row;if(!original||original.customer_id===p.recipient_customer_id)throw new Error('GIFT_RECIPIENT_MISMATCH');
  this.db.prepare('INSERT INTO fixture_gift_recipients VALUES(?,?,?) ON CONFLICT(resource_id,recipient_customer_id) DO UPDATE SET gift_source_digest=excluded.gift_source_digest').run(p.resource_id,p.recipient_customer_id,p.gift_source_digest);
 }
 assertGiftRecipient(input:unknown){const p=exact(jsonValue(input),['resource_id','customer_id','recipient_customer_id','gift_source_digest']);id(p.resource_id);id(p.customer_id);id(p.recipient_customer_id);
  const original=this.db.prepare('SELECT * FROM fixture_resolution_accounts WHERE resource_id=?').get(p.resource_id) as Row;
  if(!original||original.customer_id!==p.customer_id||p.customer_id===p.recipient_customer_id)throw new Error('GIFT_RECIPIENT_MISMATCH');
  const grant=this.db.prepare('SELECT * FROM fixture_gift_recipients WHERE resource_id=? AND recipient_customer_id=?').get(p.resource_id,p.recipient_customer_id) as Row;
  if(!grant||grant.gift_source_digest!==p.gift_source_digest)throw new Error('GIFT_RECIPIENT_UNQUALIFIED');
  return {qualified:true,recipient_customer_id:p.recipient_customer_id,gift_source_digest:grant.gift_source_digest};
 }
 #giftBindings(p:Row){return (this.db.prepare('SELECT body,digest FROM fixture_gift_resolution_bindings WHERE operation_id=? OR allocation_id=? OR native_return_id=?').all(p.operation_id,p.allocation_id,p.native_return_id) as Row[]).map(row=>{const body=JSON.parse(row.body);if(contentDigest(body)!==row.digest)throw new Error('RESOLUTION_SOURCE_INTEGRITY');return body;});}
 // Save the approved gift obligation before the replaceable issuance transport.
 // The source can then recognize it even if both optional recipient fields vanish.
 bindGiftResolution(value:unknown){const p=jsonValue(value);for(const key of ['operation_id','allocation_id','resource_id','customer_id','credit_beneficiary_id'])id(p[key]);
  if(p.tenant_id!==this.tenant||p.store_id!==this.store||p.source_identity!==this.identity||p.kind!=='store_credit'||typeof p.native_return_id!=='string'||!/^gid:\/\/shopify\/Return\/[1-9][0-9]*$/.test(p.native_return_id))throw new Error('GIFT_RECIPIENT_MISMATCH');
  this.assertGiftRecipient({resource_id:p.resource_id,customer_id:p.customer_id,recipient_customer_id:p.credit_beneficiary_id,gift_source_digest:p.gift_source_digest});
  const body={operation_id:p.operation_id,allocation_id:p.allocation_id,native_return_id:p.native_return_id,resource_id:p.resource_id,customer_id:p.customer_id,credit_beneficiary_id:p.credit_beneficiary_id,gift_source_digest:p.gift_source_digest,command_digest:contentDigest(p)};
  this.db.exec('BEGIN IMMEDIATE');try{
   this.#assertGiftBinding(p);
   const old=this.db.prepare('SELECT digest FROM fixture_gift_resolution_bindings WHERE operation_id=?').get(p.operation_id) as Row;
   if(old){if(old.digest!==contentDigest(body))throw new Error('GIFT_RECIPIENT_MISMATCH');}
   else this.db.prepare('INSERT INTO fixture_gift_resolution_bindings VALUES(?,?,?,?,?)').run(p.operation_id,p.allocation_id,p.native_return_id,canonical(body),contentDigest(body));
   this.db.exec('COMMIT');return {bound:true,operation_id:p.operation_id,qualification:'synthetic_only'};
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 #assertGiftBinding(p:Row){for(const bound of this.#giftBindings(p)){
   if(p.kind!=='store_credit'||!Object.hasOwn(p,'credit_beneficiary_id')||!Object.hasOwn(p,'gift_source_digest')||p.resource_id!==bound.resource_id||p.customer_id!==bound.customer_id||p.credit_beneficiary_id!==bound.credit_beneficiary_id)throw new Error('GIFT_RECIPIENT_MISMATCH');
   if((p.operation_id===bound.operation_id||p.allocation_id===bound.allocation_id)&&contentDigest(p)!==bound.command_digest)throw new Error('GIFT_RECIPIENT_MISMATCH');
  }}
 #beneficiary(p:Row){this.#assertGiftBinding(p);const fields=['credit_beneficiary_id','gift_source_digest'],count=fields.filter(key=>Object.hasOwn(p,key)).length;if(!count)return p.customer_id;
  if(count!==2||p.kind!=='store_credit')throw new Error('GIFT_RECIPIENT_MISMATCH');id(p.credit_beneficiary_id);
  this.assertGiftRecipient({resource_id:p.resource_id,customer_id:p.customer_id,recipient_customer_id:p.credit_beneficiary_id,gift_source_digest:p.gift_source_digest});return p.credit_beneficiary_id;
 }
 seedInstruments(resourceId:string,input:unknown,originalUnits:unknown){id(resourceId);if(!Array.isArray(input)||!input.length||input.length>8||!Array.isArray(originalUnits)||!originalUnits.length||originalUnits.length>1000)throw new Error('INSTRUMENT_ALLOCATION_INVALID');const values=jsonValue(input),units=jsonValue(originalUnits),seen=new Set<string>();let available=0n;
  for(const i of values){exact(i,['id','type','original_paid_minor','prior_refunded_minor','supported']);id(i.id);if(seen.has(i.id)||!['card','gift_card'].includes(i.type)||typeof i.supported!=='boolean')throw new Error('INSTRUMENT_ALLOCATION_INVALID');seen.add(i.id);const paid=minor(i.original_paid_minor),prior=minor(i.prior_refunded_minor);if(prior>paid)throw new Error('INSTRUMENT_BALANCE_EXCEEDED');available+=paid-prior;}
  const account=this.db.prepare('SELECT * FROM fixture_resolution_accounts WHERE resource_id=?').get(resourceId) as Row;if(!account||available!==minor(account.available_minor))throw new Error('INSTRUMENT_TOTAL_MISMATCH');
  const unitKeys=new Set<string>(),sums=new Map<string,bigint>();for(const unit of units){exact(unit,['line_id','unit_index','amounts']);id(unit.line_id);integer(unit.unit_index,1);const key=unit.line_id+':'+unit.unit_index;if(unitKeys.has(key)||!Array.isArray(unit.amounts)||unit.amounts.length>8)throw new Error('INSTRUMENT_ALLOCATION_INVALID');unitKeys.add(key);const instruments=new Set<string>();
   for(const amount of unit.amounts){exact(amount,['instrument_id','amount_minor']);id(amount.instrument_id);if(!seen.has(amount.instrument_id)||instruments.has(amount.instrument_id))throw new Error('INSTRUMENT_ALLOCATION_INVALID');instruments.add(amount.instrument_id);sums.set(amount.instrument_id,(sums.get(amount.instrument_id)??0n)+minor(amount.amount_minor));}}
  for(const instrument of values)if((sums.get(instrument.id)??0n)!==minor(instrument.original_paid_minor))throw new Error('INSTRUMENT_TOTAL_MISMATCH');
  if(this.db.prepare('SELECT 1 FROM fixture_resolution_effects WHERE resource_id=?').get(resourceId))throw new Error('INSTRUMENT_HISTORY_UNVERIFIED');
  const body={rule:'original_unit_proportional_v1',instruments:values,units};this.db.prepare('INSERT INTO fixture_resolution_instruments VALUES(?,?,?)').run(resourceId,canonical(body),contentDigest(body));
 }
 #instruments(resource:string){const r=this.db.prepare('SELECT body,digest FROM fixture_resolution_instruments WHERE resource_id=?').get(resource) as Row;if(!r)return null;const b=JSON.parse(r.body);if(contentDigest(b)!==r.digest)throw new Error('RESOLUTION_SOURCE_INTEGRITY');return b;}
 #routes(p:Row,effects:Row[]){const facts=this.#instruments(p.resource_id);
  if(!facts){if(p.routes!==undefined||p.value_routes!==undefined||p.line_id!==undefined||p.units!==undefined)throw new Error('INSTRUMENT_SOURCE_UNQUALIFIED');return;}const instruments=facts.instruments;
  id(p.line_id);if(!Array.isArray(p.units)||!p.units.length||new Set(p.units).size!==p.units.length)throw new Error('INSTRUMENT_ALLOCATION_INVALID');const weights=new Map<string,bigint>();for(const n of p.units){integer(n,1);const unit=facts.units.find((u:Row)=>u.line_id===p.line_id&&u.unit_index===n);if(!unit)throw new Error('INSTRUMENT_ALLOCATION_INVALID');for(const a of unit.amounts)weights.set(a.instrument_id,(weights.get(a.instrument_id)??0n)+minor(a.amount_minor));}
  if(effects.some(prior=>prior.line_id===p.line_id&&Array.isArray(prior.units)&&prior.units.some((n:number)=>p.units.includes(n))))throw new Error('ORIGINAL_UNIT_ALREADY_RESOLVED');
  const sharesFor=(value:string,basis:Map<string,bigint>)=>value==='0'?[]:allocateMoney(money(p.currency,value),[...basis].filter(([,amount])=>amount>0n).sort(([a],[b])=>a.localeCompare(b)).map(([id,weight])=>({id,weight:weight.toString()}))).filter(a=>a.amount.minor!=='0').map(a=>({instrument_id:a.id,type:instruments.find((i:Row)=>i.id===a.id).type,amount_minor:a.amount.minor}));
  const nativeValueShares=sharesFor(p.original_value_minor??p.amount_minor,weights);
  for(const key of ['routes','value_routes']){const routes=p[key];if(!Array.isArray(routes)||routes.length>8)throw new Error('INSTRUMENT_ROUTING_UNSUPPORTED');let total=0n;const seen=new Set<string>();
   for(const route of routes){exact(route,['instrument_id','type','amount_minor']);id(route.instrument_id);const i=instruments.find((i:Row)=>i.id===route.instrument_id);
    if(!i||!i.supported||i.type!==route.type||seen.has(i.id))throw new Error('INSTRUMENT_ROUTING_UNSUPPORTED');seen.add(i.id);total+=minor(route.amount_minor);
   }
   const expected=key==='value_routes'?(p.original_value_minor??p.amount_minor):p.kind==='additional_payment'?'0':p.amount_minor;if(total!==minor(expected))throw new Error('INSTRUMENT_TOTAL_MISMATCH');
   const basis=key==='routes'&&p.exchange_quote_id?new Map<string,bigint>(nativeValueShares.map(r=>[r.instrument_id,minor(r.amount_minor)])):weights;
   if(minor(expected)>[...basis.values()].reduce((n,v)=>n+v,0n))throw new Error('INSTRUMENT_BALANCE_EXCEEDED');
   const shares=sharesFor(expected,basis);
   if(canonical(shares)!==canonical(routes))throw new Error('INSTRUMENT_ROUTING_UNSUPPORTED');
  }
  for(const route of p.value_routes){const i=instruments.find((i:Row)=>i.id===route.instrument_id);let spent=minor(i.prior_refunded_minor);
   for(const prior of effects){if(!Array.isArray(prior.value_routes))throw new Error('INSTRUMENT_HISTORY_UNVERIFIED');for(const r of prior.value_routes)if(r.instrument_id===i.id)spent+=minor(r.amount_minor);}
   if(spent+minor(route.amount_minor)>minor(i.original_paid_minor))throw new Error('INSTRUMENT_BALANCE_EXCEEDED');
  }
 }
 async issue(value:unknown){const raw=jsonValue(value),optional=['exchange_quote_id','exchange_quote_digest','original_value_minor','replacement_variant','replacement_minor','quantity','routes','value_routes','payment_expires_at','credit_beneficiary_id','gift_source_digest','line_id','units','money_terms'].filter(key=>Object.hasOwn(raw,key));
  const p=exact(raw,['operation_id','tenant_id','store_id','resource_id','customer_id','allocation_id','kind','currency','amount_minor','payment_id','native_return_id','source_identity','credit_instrument',...optional]);
  for(const k of ['operation_id','tenant_id','store_id','resource_id','customer_id','allocation_id','payment_id','source_identity'])id(p[k]);
  if(p.tenant_id!==this.tenant||p.store_id!==this.store||p.source_identity!==this.identity||!['refund','store_credit','additional_payment'].includes(p.kind)||minor(p.amount_minor)<=0n)throw new Error('RESOLUTION_SOURCE_MISMATCH');
  if(p.kind==='store_credit'?p.credit_instrument!=='native_store_credit':p.credit_instrument!==null)throw new Error('CREDIT_UNQUALIFIED');
  const exchangeFields=['exchange_quote_id','exchange_quote_digest','original_value_minor','replacement_variant','replacement_minor','quantity'],count=exchangeFields.filter(key=>Object.hasOwn(p,key)).length;
  if(count!==0&&count!==exchangeFields.length)throw new Error('EXCHANGE_FINANCE_MISMATCH');
  if(count){id(p.exchange_quote_id);id(p.replacement_variant);integer(p.quantity,1);if(p.quantity>1000||typeof p.exchange_quote_digest!=='string'||!/^[a-f0-9]{64}$/.test(p.exchange_quote_digest))throw new Error('EXCHANGE_FINANCE_MISMATCH');minor(p.original_value_minor);minor(p.replacement_minor);if(p.kind!=='additional_payment'&&minor(p.amount_minor)>minor(p.original_value_minor))throw new Error('EXCHANGE_FINANCE_MISMATCH');
   if(minor(p.original_value_minor)+(p.kind==='additional_payment'?1n:-1n)*minor(p.amount_minor)!==minor(p.replacement_minor))throw new Error('EXCHANGE_FINANCE_MISMATCH');}
  if(p.kind==='additional_payment'){if(!p.exchange_quote_id)throw new Error('EXCHANGE_FINANCE_MISMATCH');integer(p.payment_expires_at);}
  else if(Object.hasOwn(p,'payment_expires_at'))throw new Error('EXCHANGE_FINANCE_MISMATCH');
  this.db.exec('BEGIN IMMEDIATE');try{
   assertLineageResolution(this.db,p);this.money.assertCommand(p);
   const beneficiary=this.#beneficiary(p);
   const old=this.db.prepare('SELECT * FROM fixture_resolution_effects WHERE operation_id=?').get(p.operation_id) as Row;
   if(old){if(old.digest!==contentDigest(p))throw new Error('SOURCE_IDEMPOTENCY_CONFLICT');this.db.exec('COMMIT');return JSON.parse(old.body);}
   const account=this.db.prepare('SELECT * FROM fixture_resolution_accounts WHERE resource_id=?').get(p.resource_id) as Row;
   if(!account||account.currency!==p.currency||account.customer_id!==p.customer_id||account.payment_id!==p.payment_id)throw new Error('RESOLUTION_SOURCE_MISMATCH');
   const effects=(this.db.prepare('SELECT body FROM fixture_resolution_effects WHERE resource_id=?').all(p.resource_id) as Row[]).map(r=>JSON.parse(r.body)).filter(r=>r.state!=='rejected'),spent=effects.reduce((n,r)=>n+minor(r.original_value_minor??r.amount_minor),0n);
   this.#routes(p,effects);
   const rejected=spent+minor(p.original_value_minor??p.amount_minor)>minor(account.available_minor),nativeId='fixture_'+p.kind+'_'+token().slice(0,24);
   const result:Row={...p,id:nativeId,state:rejected?'rejected':p.kind==='refund'?'accepted':p.kind==='additional_payment'?'unpaid':'issued',instrument:null,qualification:'synthetic_only'};
   if(p.kind==='additional_payment')result.payment={obligation_id:p.operation_id,amount_minor:p.amount_minor,paid_minor:'0',currency:p.currency,customer_id:p.customer_id,expires_at:p.payment_expires_at,state:result.state,settled:false};
   if(p.kind==='store_credit'&&!rejected){let credit=this.db.prepare('SELECT * FROM fixture_credit_accounts WHERE customer_id=? AND currency=?').get(beneficiary,p.currency) as Row;
    if(!credit){credit={id:'credit_'+token().slice(0,24),customer_id:beneficiary,currency:p.currency,balance_minor:'0'};this.db.prepare('INSERT INTO fixture_credit_accounts VALUES(?,?,?,?)').run(credit.id,credit.customer_id,credit.currency,'0');}
    const balance=(minor(credit.balance_minor)+minor(p.amount_minor)).toString();this.db.prepare('UPDATE fixture_credit_accounts SET balance_minor=? WHERE id=?').run(balance,credit.id);
    result.instrument={type:'native_store_credit',account_id:credit.id,customer_id:beneficiary,currency:p.currency,balance_minor:balance,expires_at:null};
   }
   this.db.prepare('INSERT INTO fixture_resolution_effects VALUES(?,?,?,?,?)').run(p.operation_id,p.resource_id,canonical(p),contentDigest(p),canonical(result));this.db.exec('COMMIT');return result;
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 async lookup(operationId:string){const r=this.db.prepare('SELECT body FROM fixture_resolution_effects WHERE operation_id=?').get(id(operationId)) as Row;if(!r)return null;const b=JSON.parse(r.body);
  if(b.kind==='additional_payment'&&['unpaid','partial'].includes(b.state)&&b.payment.expires_at<=this.clock())return {...b,state:'expired',payment:{...b.payment,state:'expired'}};
  if(b.kind==='store_credit'&&b.state==='issued'){const account=this.db.prepare('SELECT balance_minor FROM fixture_credit_accounts WHERE id=?').get(b.instrument.account_id) as Row;if(!account)throw new Error('CREDIT_INSTRUMENT_INVALID');b.instrument.balance_minor=account.balance_minor;}return b;}
 // Fixture administration only, never exposed through a merchant or agent API.
 settle(operationId:string){const r=this.db.prepare('SELECT body FROM fixture_resolution_effects WHERE operation_id=?').get(id(operationId)) as Row;
  if(!r)throw new Error('NOT_FOUND');const b=JSON.parse(r.body);if(b.kind==='additional_payment')return this.settlePayment(operationId);if(b.kind!=='refund'||!['accepted','settled'].includes(b.state))throw new Error('INVALID_STAGE');b.state='settled';this.db.prepare('UPDATE fixture_resolution_effects SET body=? WHERE operation_id=?').run(canonical(b),operationId);}
 settlePayment(operationId:string,input:Row={state:'settled',paid_minor:null}){id(operationId);exact(input,['state','paid_minor']);if(!['unpaid','partial','failed','expired','settled'].includes(input.state))throw new Error('INVALID_STAGE');
  this.db.exec('BEGIN IMMEDIATE');try{const r=this.db.prepare('SELECT * FROM fixture_resolution_effects WHERE operation_id=?').get(operationId) as Row;if(!r)throw new Error('NOT_FOUND');const b=JSON.parse(r.body);
   if(b.kind!=='additional_payment'||b.state==='rejected')throw new Error('INVALID_STAGE');if(b.state==='settled'){this.db.exec('COMMIT');return b;}
   const amount=input.paid_minor===null?input.state==='settled'?b.amount_minor:b.payment.paid_minor:input.paid_minor;minor(amount);
   if(minor(amount)>minor(b.amount_minor)||minor(amount)<minor(b.payment.paid_minor)||input.state==='settled'&&amount!==b.amount_minor||input.state==='partial'&&(amount==='0'||amount===b.amount_minor)||input.state==='unpaid'&&amount!=='0')throw new Error('EXCHANGE_PAYMENT_MISMATCH');
   b.state=input.state;b.payment={...b.payment,state:input.state,paid_minor:amount,settled:input.state==='settled'};
   if(input.state==='settled')this.db.prepare('INSERT INTO fixture_payment_captures VALUES(?,?,?,?,?)').run(operationId,b.resource_id,b.allocation_id,b.amount_minor,b.currency);
   this.db.prepare('UPDATE fixture_resolution_effects SET body=? WHERE operation_id=?').run(canonical(b),operationId);this.db.exec('COMMIT');return b;
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 redeemCredit(operationId:string,amount:string){id(operationId);const value=minor(amount);this.db.exec('BEGIN IMMEDIATE');try{const row=this.db.prepare('SELECT body FROM fixture_resolution_effects WHERE operation_id=?').get(operationId) as Row;if(!row)throw new Error('NOT_FOUND');const b=JSON.parse(row.body);if(b.kind!=='store_credit'||b.state!=='issued')throw new Error('CREDIT_UNQUALIFIED');
   const account=this.db.prepare('SELECT * FROM fixture_credit_accounts WHERE id=?').get(b.instrument.account_id) as Row;if(!account||minor(account.balance_minor)<value)throw new Error('CREDIT_BALANCE_EXCEEDED');const balance=(minor(account.balance_minor)-value).toString();this.db.prepare('UPDATE fixture_credit_accounts SET balance_minor=? WHERE id=?').run(balance,account.id);this.db.exec('COMMIT');return {account_id:account.id,balance_minor:balance};
  }catch(error){this.db.exec('ROLLBACK');throw error;}}
 assertExchangeSettlement(command:Row){const proof=exact(command.exchange_finance,['operation_id','source_identity','exchange_quote_id','exchange_quote_digest','allocation_id','resource_id','customer_id','currency','kind','amount_minor','native_id','state','command_digest']);
  if(command.balance_minor!=='0'||proof.source_identity!==this.identity||command.tenant_id!==this.tenant||command.store_id!==this.store)throw new Error('EXCHANGE_PAYMENT_OUTSTANDING');
  const row=this.db.prepare('SELECT * FROM fixture_resolution_effects WHERE operation_id=?').get(id(proof.operation_id)) as Row;if(!row)throw new Error('EXCHANGE_PAYMENT_OUTSTANDING');
  const original=JSON.parse(row.command),result=JSON.parse(row.body);if(contentDigest(original)!==row.digest||row.digest!==proof.command_digest||result.id!==proof.native_id)throw new Error('EXCHANGE_FINANCE_MISMATCH');
  for(const key of ['operation_id','source_identity','exchange_quote_id','exchange_quote_digest','allocation_id','resource_id','customer_id','currency','kind','amount_minor'])if(original[key]!==proof[key]||result[key]!==proof[key])throw new Error('EXCHANGE_FINANCE_MISMATCH');
  for(const key of ['allocation_id','resource_id','customer_id','currency','exchange_quote_digest'])if(command[key]!==original[key])throw new Error('EXCHANGE_FINANCE_MISMATCH');
  if(command.variant_id!==original.replacement_variant||command.quantity!==original.quantity||command.exchange_value_minor!==original.replacement_minor||command.original_value_minor!==original.original_value_minor)throw new Error('EXCHANGE_FINANCE_MISMATCH');
  const terminal=original.kind==='store_credit'?'issued':'settled';if(result.state!==terminal||proof.state!==terminal)throw new Error('EXCHANGE_PAYMENT_OUTSTANDING');
  if(original.kind==='store_credit'&&result.instrument?.customer_id!==this.#beneficiary(original))throw new Error('GIFT_RECIPIENT_MISMATCH');
  if(original.kind==='additional_payment'){
   const capture=this.db.prepare('SELECT * FROM fixture_payment_captures WHERE operation_id=?').get(proof.operation_id) as Row;
   if(!capture||capture.resource_id!==original.resource_id||capture.allocation_id!==original.allocation_id||capture.currency!==original.currency||capture.amount_minor!==original.amount_minor||result.payment?.paid_minor!==original.amount_minor||result.payment?.settled!==true)throw new Error('EXCHANGE_PAYMENT_OUTSTANDING');
  }
  return {settled:true,operation_id:proof.operation_id,qualification:'synthetic_only'};
 }
}
