import type { DatabaseSync } from 'node:sqlite';
import { exact,id,integer } from '../commerce/kernel.mts';
import type { Row } from '../commerce/kernel.mts';
import { canonical,contentDigest,jsonValue } from '../commerce/configuration-values.mts';
import { money,decimalMoney } from '../commerce/money.mts';

const COMPONENTS=['gross_minor','discount_minor','tax_minor','shipping_minor','duties_minor','paid_minor'];
const FEE_PARTS=['restocking_minor','return_shipping_minor','tax_minor'];
const minor=(v:unknown)=>{if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,23})$/.test(v))throw new Error('INVALID_MONEY');return BigInt(v);};
function checked(row:Row|undefined){if(!row)throw new Error('MONEY_SOURCE_NOT_FOUND');const value=JSON.parse(row.body);if(contentDigest(value)!==row.digest)throw new Error('MONEY_SOURCE_INTEGRITY');return value;}
function components(input:unknown,currency:string){const p=exact(input,COMPONENTS);for(const key of COMPONENTS)money(currency,p[key]);
 if(minor(p.discount_minor)>minor(p.gross_minor)||minor(p.gross_minor)-minor(p.discount_minor)+minor(p.tax_minor)+minor(p.shipping_minor)+minor(p.duties_minor)!==minor(p.paid_minor))throw new Error('MONEY_COMPONENT_MISMATCH');return p;}
function sumComponents(rows:Row[],side:string){return Object.fromEntries(COMPONENTS.map(key=>[key,rows.reduce((n,r)=>n+minor(r[side][key]),0n).toString()]));}
function feeTotal(value:Row){exact(value,FEE_PARTS);return FEE_PARTS.reduce((n,key)=>n+minor(value[key]),0n);}
function defaultFees(binding:Row,side:string){const c=binding.components[side];return {restocking_minor:((minor(c.gross_minor)-minor(c.discount_minor))*BigInt(binding.restocking_bps)/10000n).toString(),return_shipping_minor:'0',tax_minor:'0'};}

/** Exact values from original source records. No exchange-rate calculation occurs here. */
export function originalMoneyTerms(binding:Row,snapshot:Row|null,command:Row){
 if(command.allocation_id!==binding.allocation_id||command.resource_id!==binding.resource_id||command.customer_id!==binding.customer_id||command.payment_id!==binding.payment_id||command.currency!==binding.shop_currency||command.source_identity!==binding.source_identity)throw new Error('CURRENCY_BINDING_MISMATCH');
 if(command.exchange_quote_id||!binding.qualification.allowed_kinds.includes(command.kind)||command.kind==='store_credit'&&binding.shop_currency!==binding.presentment_currency)throw new Error('CURRENCY_OUTCOME_UNQUALIFIED');
 if(!snapshot&&binding.return_shipping_minor!=='0')throw new Error('FEE_SOURCE_REQUIRED');
 const applied=snapshot?.final??snapshot?.estimate,fees=applied?{shop:applied.shop,presentment:applied.presentment}:{shop:defaultFees(binding,'shop'),presentment:defaultFees(binding,'presentment')};
 const shop=minor(binding.components.shop.paid_minor)-feeTotal(fees.shop),presentment=minor(binding.components.presentment.paid_minor)-feeTotal(fees.presentment);
 if(shop<=0n||presentment<=0n||shop.toString()!==command.amount_minor)throw new Error('MONEY_AMOUNT_MISMATCH');
 return {schema_version:1,allocation_id:binding.allocation_id,binding_digest:contentDigest(binding),profile_digest:binding.profile_digest,
  source_record_id:binding.source_record_id,source_identity:binding.source_identity,qualification_id:binding.qualification.qualification_id,qualification_digest:binding.qualification_digest,
  account_id:binding.qualification.account_id,api_version:binding.qualification.api_version,market:binding.qualification.market,payment_instrument:binding.qualification.payment_instrument,
  shop:money(binding.shop_currency,shop.toString()),presentment:money(binding.presentment_currency,presentment.toString()),
  original_components:{shop:{currency:binding.shop_currency,...binding.components.shop},presentment:{currency:binding.presentment_currency,...binding.components.presentment}},
  applied_fees:{shop:{currency:binding.shop_currency,...fees.shop},presentment:{currency:binding.presentment_currency,...fees.presentment}},
  fee_snapshot:snapshot,rate_provenance:binding.rate_provenance,duty_treatment:'original_paid_allocations',conversion_performed:false,
  expires_at:binding.qualification.expires_at,qualification:'synthetic_only',live_financial_authority:false};
}

export function feeSnapshot(events:Row[]){
 if(!events.length)return null;const estimates=events.filter(e=>e.phase==='estimated');if(estimates.length!==1)throw new Error('FEE_ESTIMATE_REQUIRED');
 const estimate=estimates[0],final=events.filter(e=>e.phase==='final').sort((a,b)=>b.revision-a.revision)[0]??null;
 return {estimate,estimate_digest:contentDigest(estimate),final,final_digest:final?contentDigest(final):null};
}

/** Server-local fixture administration and independent native monetary authority. */
export class ExchangeMoneyFixtureSource {
 readonly db:DatabaseSync;readonly identity:string;readonly tenant:string;readonly store:string;readonly clock:()=>number;
 constructor(db:DatabaseSync,context:{identity:string;tenant:string;store:string},clock:()=>number){
  this.db=db;this.identity=context.identity;this.tenant=context.tenant;this.store=context.store;this.clock=clock;
  db.exec(`CREATE TABLE IF NOT EXISTS fixture_exchange_money_qualifications(qualification_id TEXT NOT NULL,revision INTEGER NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(qualification_id,revision));
   CREATE TABLE IF NOT EXISTS fixture_exchange_money_orders(resource_id TEXT PRIMARY KEY,body TEXT NOT NULL,digest TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS fixture_exchange_money_allocations(allocation_id TEXT PRIMARY KEY,resource_id TEXT NOT NULL,line_id TEXT NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS fixture_exchange_money_units(resource_id TEXT NOT NULL,line_id TEXT NOT NULL,unit_index INTEGER NOT NULL,allocation_id TEXT NOT NULL,PRIMARY KEY(resource_id,line_id,unit_index));
   CREATE TABLE IF NOT EXISTS fixture_exchange_money_commands(operation_id TEXT PRIMARY KEY,allocation_id TEXT NOT NULL UNIQUE,resource_id TEXT NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS fixture_exchange_fee_events(event_id TEXT PRIMARY KEY,allocation_id TEXT NOT NULL,phase TEXT NOT NULL,revision INTEGER NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL,UNIQUE(allocation_id,phase,revision));
   CREATE UNIQUE INDEX IF NOT EXISTS fixture_exchange_one_estimate ON fixture_exchange_fee_events(allocation_id) WHERE phase='estimated';`);
 }
 qualify(input:unknown){
  const p=exact(jsonValue(input),['qualification_id','revision','account_id','api_version','market','payment_instrument','shop_currency','presentment_currency','allowed_kinds','expires_at','evidence_id','enabled','qualification']);
  for(const key of ['qualification_id','account_id','market','evidence_id'])id(p[key]);integer(p.revision,1);integer(p.expires_at);money(p.shop_currency,'0');money(p.presentment_currency,'0');
  if(p.qualification!=='synthetic_only'||p.api_version!=='2026-10'||p.payment_instrument!=='card'||typeof p.enabled!=='boolean'||!Array.isArray(p.allowed_kinds)||!p.allowed_kinds.length||new Set(p.allowed_kinds).size!==p.allowed_kinds.length||p.allowed_kinds.some((x:string)=>!['refund','store_credit'].includes(x))||p.shop_currency!==p.presentment_currency&&p.allowed_kinds.includes('store_credit'))throw new Error('CURRENCY_COMBINATION_UNQUALIFIED');
  if(p.expires_at<=this.clock()||p.expires_at>this.clock()+3600000)throw new Error('CURRENCY_QUALIFICATION_EXPIRED');
  const previous=this.db.prepare('SELECT revision FROM fixture_exchange_money_qualifications WHERE qualification_id=? ORDER BY revision DESC LIMIT 1').get(p.qualification_id) as Row;
  if(p.revision!==(previous?.revision??0)+1)throw new Error('CURRENCY_QUALIFICATION_CHANGED');
  const body={...p,source_identity:this.identity,tenant_id:this.tenant,store_id:this.store};this.db.prepare('INSERT INTO fixture_exchange_money_qualifications VALUES(?,?,?,?)').run(p.qualification_id,p.revision,canonical(body),contentDigest(body));return body;
 }
 #qualification(ref:string){const value=checked(this.db.prepare('SELECT body,digest FROM fixture_exchange_money_qualifications WHERE qualification_id=? ORDER BY revision DESC LIMIT 1').get(id(ref)) as Row);
  if(!value.enabled||value.expires_at<=this.clock())throw new Error('CURRENCY_QUALIFICATION_EXPIRED');return value;}
 seedOrder(input:unknown){
  const p=exact(jsonValue(input),['resource_id','qualification_id','source_record_id','rate_provenance','shop','presentment','units']);id(p.resource_id);id(p.qualification_id);id(p.source_record_id);
  const q=this.#qualification(p.qualification_id),account=this.db.prepare('SELECT * FROM fixture_resolution_accounts WHERE resource_id=?').get(p.resource_id) as Row;
  if(!account||account.currency!==q.shop_currency)throw new Error('CURRENCY_ACCOUNT_MISMATCH');
  const rate=exact(p.rate_provenance,['id','source_record_id','numerator','denominator','observed_at','rule','rounding']);id(rate.id);id(rate.source_record_id);integer(rate.observed_at);
  if(minor(rate.numerator)===0n||minor(rate.denominator)===0n||rate.observed_at>this.clock()||rate.rule!=='original_native_allocations'||rate.rounding!=='native_recorded')throw new Error('CONVERSION_PROVENANCE_REQUIRED');
  for(const side of ['shop','presentment']){const totals=exact(p[side],['currency','original_paid_minor','prior_refunded_minor']);money(totals.currency,totals.original_paid_minor);minor(totals.prior_refunded_minor);if(totals.currency!==q[side+'_currency']||minor(totals.prior_refunded_minor)>minor(totals.original_paid_minor))throw new Error('CURRENCY_ACCOUNT_MISMATCH');}
  if(minor(p.shop.original_paid_minor)-minor(p.shop.prior_refunded_minor)!==minor(account.available_minor))throw new Error('CURRENCY_ACCOUNT_MISMATCH');
  if(!Array.isArray(p.units)||!p.units.length||p.units.length>1000)throw new Error('MONEY_UNITS_INVALID');const seen=new Set<string>();
  for(const unit of p.units){exact(unit,['line_id','unit_index','resolved','shop','presentment']);id(unit.line_id);integer(unit.unit_index,1);const key=unit.line_id+':'+unit.unit_index;if(seen.has(key)||typeof unit.resolved!=='boolean')throw new Error('MONEY_UNITS_INVALID');seen.add(key);components(unit.shop,q.shop_currency);components(unit.presentment,q.presentment_currency);}
  for(const side of ['shop','presentment']){if(p.units.reduce((n:bigint,u:Row)=>n+minor(u[side].paid_minor),0n)!==minor(p[side].original_paid_minor)||p.units.filter((u:Row)=>u.resolved).reduce((n:bigint,u:Row)=>n+minor(u[side].paid_minor),0n)!==minor(p[side].prior_refunded_minor))throw new Error('MONEY_ORIGINAL_TOTAL_MISMATCH');}
  if(this.db.prepare('SELECT 1 FROM fixture_resolution_effects WHERE resource_id=?').get(p.resource_id))throw new Error('MONEY_HISTORY_UNQUALIFIED');
  const body={...p,customer_id:account.customer_id,payment_id:account.payment_id,account_id:q.account_id,source_identity:this.identity,tenant_id:this.tenant,store_id:this.store};
  const old=this.db.prepare('SELECT body,digest FROM fixture_exchange_money_orders WHERE resource_id=?').get(p.resource_id) as Row;if(old){if(contentDigest(body)!==old.digest)throw new Error('ORIGINAL_MONEY_IMMUTABLE');return checked(old);}
  this.db.prepare('INSERT INTO fixture_exchange_money_orders VALUES(?,?,?)').run(p.resource_id,canonical(body),contentDigest(body));return body;
 }
 required(resource:string){return !!this.db.prepare('SELECT 1 FROM fixture_exchange_money_orders WHERE resource_id=?').get(id(resource));}
 bindAllocation(input:unknown){
  const p=exact(jsonValue(input),['allocation_id','resource_id','line_id','units','restocking_bps','return_shipping_minor','native_return_id']);id(p.allocation_id);id(p.resource_id);id(p.line_id);integer(p.restocking_bps);minor(p.return_shipping_minor);
  if(p.restocking_bps>10000||!Array.isArray(p.units)||!p.units.length||new Set(p.units).size!==p.units.length||!/^gid:\/\/shopify\/Return\/[1-9][0-9]*$/.test(p.native_return_id))throw new Error('MONEY_UNITS_INVALID');p.units.forEach((u:unknown)=>integer(u,1));p.units.sort((a:number,b:number)=>a-b);
  const original=checked(this.db.prepare('SELECT body,digest FROM fixture_exchange_money_orders WHERE resource_id=?').get(p.resource_id) as Row),rows=p.units.map((n:number)=>original.units.find((u:Row)=>u.line_id===p.line_id&&u.unit_index===n));
  if(rows.some((u:Row)=>!u||u.resolved))throw new Error('ORIGINAL_UNIT_ALREADY_RESOLVED');
  const body={...p,customer_id:original.customer_id,payment_id:original.payment_id,qualification_id:original.qualification_id,account_id:original.account_id,profile_digest:contentDigest(original),source_record_id:original.source_record_id,rate_provenance:original.rate_provenance,
   shop_currency:original.shop.currency,presentment_currency:original.presentment.currency,components:{shop:sumComponents(rows,'shop'),presentment:sumComponents(rows,'presentment')},source_identity:this.identity,tenant_id:this.tenant,store_id:this.store};
  this.db.exec('BEGIN IMMEDIATE');try{
   const old=this.db.prepare('SELECT body,digest FROM fixture_exchange_money_allocations WHERE allocation_id=?').get(p.allocation_id) as Row;
   if(old){if(contentDigest(body)!==old.digest)throw new Error('CURRENCY_BINDING_MISMATCH');}
   else{for(const n of p.units)if(this.db.prepare('SELECT 1 FROM fixture_exchange_money_units WHERE resource_id=? AND line_id=? AND unit_index=?').get(p.resource_id,p.line_id,n))throw new Error('ORIGINAL_UNIT_ALREADY_RESOLVED');
    this.db.prepare('INSERT INTO fixture_exchange_money_allocations VALUES(?,?,?,?,?)').run(p.allocation_id,p.resource_id,p.line_id,canonical(body),contentDigest(body));for(const n of p.units)this.db.prepare('INSERT INTO fixture_exchange_money_units VALUES(?,?,?,?)').run(p.resource_id,p.line_id,n,p.allocation_id);}
   const result=this.allocation(p.allocation_id);this.db.exec('COMMIT');return result;
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 #originalAllocation(ref:string){return checked(this.db.prepare('SELECT body,digest FROM fixture_exchange_money_allocations WHERE allocation_id=?').get(id(ref)) as Row);}
 allocation(ref:string){const b=this.#originalAllocation(ref),q=this.#qualification(b.qualification_id);
  if(q.account_id!==b.account_id||q.shop_currency!==b.shop_currency||q.presentment_currency!==b.presentment_currency)throw new Error('CURRENCY_QUALIFICATION_CHANGED');return {...b,qualification:q,qualification_digest:contentDigest(q)};}
 recordFee(input:unknown){
  const p=exact(jsonValue(input),['allocation_id','event_id','phase','revision','observed_at','api_version','native_fee']);id(p.allocation_id);id(p.event_id);integer(p.revision,1);integer(p.observed_at);
  if(!['estimated','final'].includes(p.phase)||p.api_version!=='2026-10'||p.observed_at>this.clock())throw new Error('FEE_SOURCE_UNQUALIFIED');
  // Observing an existing native obligation survives issuance qualification expiry.
  const b=this.#originalAllocation(p.allocation_id),taxField=p.phase==='estimated'?'taxAmountSet':'finalizedTaxAmountSet',fee=exact(p.native_fee,['id','amountSet',taxField]);id(fee.id);
  if(p.phase==='final'&&fee.finalizedTaxAmountSet===null)return {recorded:false,state:'pending_finalization'};
  const bag=(value:unknown)=>{const pair=exact(value,['shopMoney','presentmentMoney']),result:Row={};for(const side of ['shop','presentment']){const m=exact(pair[side+'Money'],['amount','currencyCode']);const amount=decimalMoney(m.currencyCode,m.amount);if(amount.currency!==b[side+'_currency'])throw new Error('CURRENCY_MISMATCH');result[side]=amount.minor;}return result;};
  const shipping=bag(fee.amountSet),tax=bag(fee[taxField]);
  const body={allocation_id:b.allocation_id,resource_id:b.resource_id,customer_id:b.customer_id,payment_id:b.payment_id,native_return_id:b.native_return_id,source_identity:this.identity,tenant_id:this.tenant,store_id:this.store,
   event_id:p.event_id,phase:p.phase,revision:p.revision,observed_at:p.observed_at,api_version:p.api_version,native_fee_id:fee.id,native_digest:contentDigest(fee),
   source_fields:{amount:'amountSet',tax:taxField},shop_currency:b.shop_currency,presentment_currency:b.presentment_currency,
   shop:{...defaultFees(b,'shop'),return_shipping_minor:shipping.shop,tax_minor:tax.shop},presentment:{...defaultFees(b,'presentment'),return_shipping_minor:shipping.presentment,tax_minor:tax.presentment},qualification:'synthetic_only'};
  const old=this.db.prepare('SELECT body,digest FROM fixture_exchange_fee_events WHERE event_id=?').get(p.event_id) as Row;if(old){if(old.digest!==contentDigest(body))throw new Error('FEE_EVENT_CONFLICT');return {recorded:true,event:checked(old)};}
  const events=this.events(p.allocation_id),estimate=events.find(e=>e.phase==='estimated');
  if(p.phase==='estimated'&&(estimate||p.revision!==1||shipping.shop!==b.return_shipping_minor))throw new Error('FEE_ESTIMATE_MISMATCH');
  if(p.phase==='final'&&(!estimate||estimate.native_fee_id!==fee.id||p.revision!==Math.max(0,...events.filter(e=>e.phase==='final').map(e=>e.revision))+1))throw new Error('FEE_FINAL_UNQUALIFIED');
  for(const side of ['shop','presentment'])if(feeTotal(body[side])>=minor(b.components[side].paid_minor))throw new Error('FEE_EXCEEDS_ORIGINAL_VALUE');
  this.db.prepare('INSERT INTO fixture_exchange_fee_events VALUES(?,?,?,?,?,?)').run(p.event_id,p.allocation_id,p.phase,p.revision,canonical(body),contentDigest(body));return {recorded:true,event:body};
 }
 event(eventId:string){return checked(this.db.prepare('SELECT body,digest FROM fixture_exchange_fee_events WHERE event_id=?').get(id(eventId)) as Row);}
 events(allocationId:string){return (this.db.prepare('SELECT body,digest FROM fixture_exchange_fee_events WHERE allocation_id=? ORDER BY phase,revision').all(id(allocationId)) as Row[]).map(checked);}
 #expected(command:Row){const b=this.allocation(command.allocation_id);
  if(command.tenant_id!==this.tenant||command.store_id!==this.store||command.native_return_id!==b.native_return_id)throw new Error('CURRENCY_BINDING_MISMATCH');
  const expected=originalMoneyTerms(b,feeSnapshot(this.events(b.allocation_id)),command);
  if(canonical(command.money_terms)!==canonical(expected))throw new Error('MONEY_TERMS_CHANGED');return expected;
 }
 bindCommand(input:unknown){const p=jsonValue(input);if(!this.required(p.resource_id)){if(Object.hasOwn(p,'money_terms'))throw new Error('CURRENCY_SOURCE_UNQUALIFIED');return null;}
  this.#expected(p);id(p.operation_id);const body={operation_id:p.operation_id,allocation_id:p.allocation_id,resource_id:p.resource_id,command_digest:contentDigest(p)};
  const old=this.db.prepare('SELECT body,digest FROM fixture_exchange_money_commands WHERE operation_id=?').get(p.operation_id) as Row;
  if(old){if(old.digest!==contentDigest(body))throw new Error('MONEY_COMMAND_CHANGED');return checked(old);}
  this.db.prepare('INSERT INTO fixture_exchange_money_commands VALUES(?,?,?,?,?)').run(p.operation_id,p.allocation_id,p.resource_id,canonical(body),contentDigest(body));return body;
 }
 assertCommand(p:Row){const bound=this.db.prepare('SELECT body,digest FROM fixture_exchange_money_commands WHERE operation_id=? OR allocation_id=?').all(p.operation_id,p.allocation_id) as Row[];
  if(!this.required(p.resource_id)&&!bound.length){if(Object.hasOwn(p,'money_terms'))throw new Error('CURRENCY_SOURCE_UNQUALIFIED');return;}
  if(!bound.length||bound.some(r=>checked(r).command_digest!==contentDigest(p)))throw new Error('MONEY_COMMAND_BINDING_REQUIRED');const expected=this.#expected(p);
  const original=checked(this.db.prepare('SELECT body,digest FROM fixture_exchange_money_orders WHERE resource_id=?').get(p.resource_id) as Row);
  let spent=0n;for(const r of this.db.prepare('SELECT operation_id,body FROM fixture_resolution_effects WHERE resource_id=?').all(p.resource_id) as Row[]){const e=JSON.parse(r.body);if(r.operation_id===p.operation_id||e.state==='rejected')continue;if(!e.money_terms)throw new Error('MONEY_HISTORY_UNQUALIFIED');spent+=minor(e.money_terms.presentment.minor);}
  if(spent+minor(expected.presentment.minor)>minor(original.presentment.original_paid_minor)-minor(original.presentment.prior_refunded_minor))throw new Error('PRESENTMENT_BALANCE_EXCEEDED');
 }
}
