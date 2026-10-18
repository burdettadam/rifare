import {DatabaseSync} from 'node:sqlite';
import {statSync} from 'node:fs';
import {exact,id,integer,resourceKey} from '../../commerce/kernel.mts';
import type {CommerceKernel,Scope,Row} from '../../commerce/kernel.mts';
import {canonical,contentDigest,jsonValue} from '../../commerce/configuration-values.mts';
import {decimalMoney,money} from '../../commerce/money.mts';
import {normalizeWooOrder} from './orders.mts';
import {WOO_RETURN_CONTRACT_DIGEST,attachWooReturnSource,assertWooReturnFacts,wooSourceBinding} from './return-contract.mts';

const native=(v:unknown)=>{if(typeof v!=='string'||! /^[1-9][0-9]{0,14}$/.test(v)||!Number.isSafeInteger(Number(v)))throw new Error('WOO_NATIVE_ID_INVALID');return v;};
function origin(v:unknown){if(typeof v!=='string')throw new Error('WOO_ORIGIN_INVALID');const u=new URL(v);if(u.protocol!=='https:'||u.port||u.username||u.password||u.pathname!=='/'||u.search||u.hash||!u.hostname.endsWith('.example.invalid'))throw new Error('WOO_ORIGIN_INVALID');return u.origin;}
function minor(v:unknown){money('USD',v as string);if(typeof v!=='string'||! /^(0|[1-9][0-9]{0,23})$/.test(v))throw new Error('WOO_MONEY_INVALID');return BigInt(v);}
function sourceFacts(input:unknown,now:number){
 const p=exact(jsonValue(input,262144),['revision','observed_at','order','refunds','fulfillment','resolution_facts','financial_contract']);integer(p.revision,1);integer(p.observed_at);
 if(p.observed_at>now||p.observed_at+300000<=now)throw new Error('WOO_SOURCE_STALE');
 const nativeId=native(String(p.order?.id)),normalized=normalizeWooOrder(p.order,p.refunds,nativeId,now),fulfill=exact(p.fulfillment,['contract','complete','delivered_at','tags','lines']);
 if(fulfill.contract!=='rifare-woo-fulfillment-fixture-v1'||fulfill.complete!==true||!Array.isArray(fulfill.lines)||!fulfill.lines.length||!Array.isArray(fulfill.tags))throw new Error('WOO_FULFILLMENT_UNVERIFIED');
 integer(fulfill.delivered_at);if(fulfill.delivered_at>p.observed_at)throw new Error('WOO_FULFILLMENT_UNVERIFIED');
 const f=p.resolution_facts,fc=exact(p.financial_contract,['gateway_id','gateway_account_id','payment_id','transaction_id','currency','original_paid_minor','prior_refunded_minor','instrument_id','history_complete']);
 for(const key of ['gateway_id','gateway_account_id','payment_id','transaction_id','instrument_id'])id(fc[key]);
 if(fc.history_complete!==true||fc.currency!=='USD'||p.order.currency!==fc.currency||p.order.payment_method!==fc.gateway_id||p.order.transaction_id!==fc.transaction_id||p.order.date_paid_gmt===null)throw new Error('WOO_PAYMENT_HISTORY_UNVERIFIED');
 if(!f||f.currency!==fc.currency||f.payment_id!==fc.payment_id||f.original_paid_minor!==fc.original_paid_minor||f.prior_refunded_minor!==fc.prior_refunded_minor||f.observed_at!==p.observed_at||f.revision!==p.revision||!Array.isArray(f.paid_lines)||!Array.isArray(f.accounted_operations))throw new Error('WOO_PAYMENT_HISTORY_UNVERIFIED');
 if(decimalMoney(fc.currency,p.order.total).minor!==fc.original_paid_minor||p.refunds.reduce((n:bigint,r:Row)=>n+BigInt(decimalMoney(fc.currency,r.amount).minor),0n)!==minor(fc.prior_refunded_minor))throw new Error('WOO_PAYMENT_TOTAL_MISMATCH');
 const lines=fulfill.lines.map((raw:unknown)=>{const l=exact(raw,['line_id','fulfilled','returned','tags']);native(l.line_id);integer(l.fulfilled);integer(l.returned);if(!Array.isArray(l.tags)||l.tags.some((v:unknown)=>typeof v!=='string'||v.length>96))throw new Error('WOO_FULFILLMENT_UNVERIFIED');
  const wire=p.order.line_items.find((x:Row)=>String(x.id)===l.line_id),paid=f.paid_lines.find((x:Row)=>x.id===l.line_id);
  if(!wire||!paid||wire.quantity!==paid.quantity||l.fulfilled>wire.quantity||l.returned>l.fulfilled||!Array.isArray(paid.resolved_units)||paid.resolved_units.length!==l.returned||new Set(paid.resolved_units).size!==paid.resolved_units.length)throw new Error('WOO_QUANTITY_HISTORY_UNVERIFIED');
  for(const unit of paid.resolved_units){integer(unit,1);if(unit>l.fulfilled)throw new Error('WOO_QUANTITY_HISTORY_UNVERIFIED');}
  for(const field of ['gross_minor','discount_minor','tax_minor','shipping_minor','duties_minor'])minor(paid[field]);
  const value=minor(paid.gross_minor)-minor(paid.discount_minor)+minor(paid.tax_minor)+minor(paid.shipping_minor)+minor(paid.duties_minor);
  if(value<0n||decimalMoney(fc.currency,wire.subtotal).minor!==paid.gross_minor||BigInt(decimalMoney(fc.currency,wire.subtotal).minor)-BigInt(decimalMoney(fc.currency,wire.total).minor)!==minor(paid.discount_minor)||decimalMoney(fc.currency,wire.total_tax).minor!==paid.tax_minor)throw new Error('WOO_PAID_LINE_MISMATCH');
  return {id:l.line_id,fulfillment_line_id:null,ordered:wire.quantity,fulfilled:l.fulfilled,returned:l.returned,unit_minor:(value/BigInt(wire.quantity)).toString(),tags:l.tags};
 });
 if(lines.length!==p.order.line_items.length||lines.length!==f.paid_lines.length||new Set(lines.map((l:Row)=>l.id)).size!==lines.length)throw new Error('WOO_QUANTITY_HISTORY_UNVERIFIED');
 const paidTotal=f.paid_lines.reduce((n:bigint,l:Row)=>n+minor(l.gross_minor)-minor(l.discount_minor)+minor(l.tax_minor)+minor(l.shipping_minor)+minor(l.duties_minor),0n);
 if(paidTotal!==minor(fc.original_paid_minor)||minor(fc.prior_refunded_minor)>paidTotal)throw new Error('WOO_PAYMENT_TOTAL_MISMATCH');
 const instruments=f.instrument_allocations;
 if(!instruments||instruments.rule!=='original_unit_proportional_v1'||!Array.isArray(instruments.instruments)||instruments.instruments.length!==1||!Array.isArray(instruments.units))throw new Error('WOO_ORIGINAL_INSTRUMENT_UNVERIFIED');
 const instrument=instruments.instruments[0];
 if(instrument.id!==fc.instrument_id||instrument.type!=='card'||instrument.supported!==true||instrument.original_paid_minor!==fc.original_paid_minor||instrument.prior_refunded_minor!==fc.prior_refunded_minor)throw new Error('WOO_ORIGINAL_INSTRUMENT_UNVERIFIED');
 const units=new Set<string>();let unitTotal=0n;
 for(const raw of instruments.units){const u=exact(raw,['line_id','unit_index','amounts']),paid=f.paid_lines.find((l:Row)=>l.id===u.line_id);integer(u.unit_index,1);
  if(!paid||u.unit_index>paid.quantity||units.has(u.line_id+':'+u.unit_index)||!Array.isArray(u.amounts)||u.amounts.length!==1)throw new Error('WOO_ORIGINAL_INSTRUMENT_UNVERIFIED');
  units.add(u.line_id+':'+u.unit_index);const a=exact(u.amounts[0],['instrument_id','amount_minor']);if(a.instrument_id!==fc.instrument_id)throw new Error('WOO_ORIGINAL_INSTRUMENT_UNVERIFIED');
  const q=BigInt(paid.quantity),at=BigInt(u.unit_index),part=(key:string)=>minor(paid[key])/q+(at<=minor(paid[key])%q?1n:0n),expected=part('gross_minor')-part('discount_minor')+part('tax_minor')+part('shipping_minor')+part('duties_minor');
  if(minor(a.amount_minor)!==expected)throw new Error('WOO_ORIGINAL_INSTRUMENT_UNVERIFIED');unitTotal+=minor(a.amount_minor);
 }
 if(units.size!==f.paid_lines.reduce((n:number,l:Row)=>n+l.quantity,0)||unitTotal!==paidTotal)throw new Error('WOO_ORIGINAL_INSTRUMENT_UNVERIFIED');
 const payload={...normalized.payload,currency:fc.currency,total_minor:fc.original_paid_minor,status:p.order.status,delivered_at:fulfill.delivered_at,tags:fulfill.tags,return_lines:lines,
  counted_return_ids:[],resolution_facts:f,woo_return_contract:WOO_RETURN_CONTRACT_DIGEST,woo_financial_contract:fc,source_facts_kind:'explicit_complete_woo_fixture',native_order_id:nativeId};
 return {input:p,native_order_id:nativeId,customer_id:normalized.customer_id,source_updated_at:normalized.source_updated_at,payload,financial_contract:fc};
}

// The independent fixture database owns native order/history observations. It has
// no return-create method because a Woo local RMA is not a native Woo return.
export class WooReturnFixtureSource {
 readonly db:DatabaseSync;readonly identity:string;readonly tenant:string;readonly store:string;readonly account_id:string;readonly origin:string;readonly contract='woocommerce-rma-fixture-v1';readonly qualification='fixture_only';readonly clock:()=>number;
 constructor(db:DatabaseSync,options:{mode:'fixture';identity:string;tenant:string;store:string;account_id:string;origin:string},clock:()=>number){
  exact(options,['mode','identity','tenant','store','account_id','origin']);if(options.mode!=='fixture'||typeof clock!=='function')throw new Error('WOO_SOURCE_UNQUALIFIED');
  this.db=db;this.identity=id(options.identity);this.tenant=id(options.tenant);this.store=id(options.store);this.account_id=id(options.account_id);this.origin=origin(options.origin);this.clock=clock;
  db.exec('CREATE TABLE IF NOT EXISTS woo_fixture_order_versions(native_order_id TEXT NOT NULL,revision INTEGER NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(native_order_id,revision)) STRICT');
  db.exec('CREATE TABLE IF NOT EXISTS woo_fixture_effect_records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL) STRICT');
 }
 seed(input:unknown){const facts=sourceFacts(input,this.clock()),old=this.db.prepare('SELECT max(revision) revision FROM woo_fixture_order_versions WHERE native_order_id=?').get(facts.native_order_id) as Row;
  if(facts.input.revision!==(old.revision??0)+1)throw new Error('WOO_SOURCE_REVISION_CONFLICT');
  this.db.prepare('INSERT INTO woo_fixture_order_versions VALUES(?,?,?,?)').run(facts.native_order_id,facts.input.revision,canonical(facts.input),contentDigest(facts.input));return this.snapshot(facts.native_order_id);}
 snapshot(nativeId:string){native(nativeId);const row=this.db.prepare('SELECT * FROM woo_fixture_order_versions WHERE native_order_id=? ORDER BY revision DESC LIMIT 1').get(nativeId) as Row;
  if(!row)throw new Error('WOO_SOURCE_UNAVAILABLE');const input=JSON.parse(row.body);if(contentDigest(input)!==row.digest)throw new Error('WOO_NATIVE_SOURCE_INTEGRITY');
  return {...sourceFacts(input,this.clock()),revision:row.revision,digest:row.digest};}
 records(){const effects=(this.db.prepare('SELECT id,kind,body,digest FROM woo_fixture_effect_records ORDER BY id').all() as Row[]).map(r=>{const body=JSON.parse(r.body);if(contentDigest(body)!==r.digest)throw new Error('WOO_NATIVE_SOURCE_INTEGRITY');return {...r,body};});
  const nativeReturns=effects.filter(r=>r.kind==='return.create');
  return {identity:this.identity,account_id:this.account_id,origin:this.origin,contract:this.contract,qualification:this.qualification,effects,native_return_records:nativeReturns,native_return_create_effects:nativeReturns.length,
  orders:(this.db.prepare('SELECT native_order_id,revision,body,digest FROM woo_fixture_order_versions ORDER BY native_order_id,revision').all() as Row[]).map(r=>({...r,body:JSON.parse(r.body)}))};}
}
export class WooReturnSources {
 readonly k:CommerceKernel;readonly source:WooReturnFixtureSource;
 constructor(k:CommerceKernel,source:WooReturnFixtureSource){
  if(!(source instanceof WooReturnFixtureSource)||source.db===k.db)throw new Error('SEPARATE_WOO_SOURCE_REQUIRED');
  const file=(db:DatabaseSync)=>(db.prepare('PRAGMA database_list').all() as Row[]).find(r=>r.name==='main')?.file;
  const sourceFile=file(source.db),coreFile=file(k.db);
  if(sourceFile&&sourceFile===coreFile)throw new Error('SEPARATE_WOO_SOURCE_REQUIRED');
  if(sourceFile&&coreFile){const a=statSync(sourceFile,{bigint:true}),b=statSync(coreFile,{bigint:true});if(a.dev===b.dev&&a.ino===b.ino)throw new Error('SEPARATE_WOO_SOURCE_REQUIRED');}
  this.k=k;this.source=source;attachWooReturnSource(k,source);}
 bind(scope:Scope,input:unknown){const p=exact(input,['native_order_id','expected_revision']);native(p.native_order_id);integer(p.expected_revision);const k=this.k,s=k.authorize(scope,'connection.manage'),source=this.source;
  if(s.tenant_id!==source.tenant||s.store_id!==source.store)throw new Error('WOO_SOURCE_TENANT_MISMATCH');const observed=source.snapshot(p.native_order_id);
  return k.transaction(()=>{k.authorize(scope,'connection.manage');const resource=resourceKey(s.tenant_id,s.store_id,'order','woocommerce',p.native_order_id),old=k.db.prepare('SELECT * FROM commerce_woo_return_sources WHERE tenant_id=? AND store_id=? AND resource_id=?').get(s.tenant_id,s.store_id,resource) as Row;
   if((old?.revision??0)!==p.expected_revision)throw new Error('WOO_BINDING_CHANGED');if(old&&(old.source_identity!==source.identity||old.account_id!==source.account_id))throw new Error('WOO_SOURCE_REBIND_DENIED');
   if(old&&observed.revision<old.source_revision)throw new Error('WOO_SOURCE_REGRESSED');
   const existing=k.db.prepare('SELECT source_version FROM commerce_resources WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,resource) as Row;
   const version=(existing?.source_version??0)+1;
   k.ingest(scope,{kind:'order',source_system:'woocommerce',external_id:p.native_order_id,source_version:version,source_updated_at:observed.source_updated_at,customer_id:observed.customer_id,payload:observed.payload});
   const body={resource_id:resource,source_identity:source.identity,account_id:source.account_id,origin:source.origin,native_order_id:p.native_order_id,customer_id:observed.customer_id,contract_digest:WOO_RETURN_CONTRACT_DIGEST,
    granted_scopes:['read'],configuration_revision:1,revision:p.expected_revision+1,source_revision:observed.revision,source_digest:observed.digest,body_digest:contentDigest(observed.payload),canonical_source_version:version,observed_at:k.clock(),financial_contract:observed.financial_contract};
   k.db.prepare('INSERT INTO commerce_woo_return_sources VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,store_id,resource_id) DO UPDATE SET revision=excluded.revision,source_revision=excluded.source_revision,source_digest=excluded.source_digest,body=excluded.body,digest=excluded.digest,observed_at=excluded.observed_at').run(s.tenant_id,s.store_id,resource,source.identity,source.account_id,p.native_order_id,body.revision,observed.revision,observed.digest,canonical(body),contentDigest(body),k.clock());
   return {...body,qualification:'fixture_only',live_write_authorized:false};});}
 refresh(scope:Scope,nativeId:string){const s=this.k.require(scope),resource=resourceKey(s.tenant_id,s.store_id,'order','woocommerce',native(nativeId)),r=this.k.db.prepare('SELECT revision FROM commerce_woo_return_sources WHERE tenant_id=? AND store_id=? AND resource_id=?').get(s.tenant_id,s.store_id,resource) as Row;
  return this.bind(scope,{native_order_id:nativeId,expected_revision:r?.revision??0});}
 cached(scope:Scope,resourceId:string){const s=this.k.authorize(scope,'resource.read',id(resourceId)),order=this.k.get(scope,resourceId),binding=assertWooReturnFacts(this.k,s,order);
  return {resource_id:resourceId,status:'fresh',order:order.payload,production_qualified:false,source:{system:'woocommerce',native_id:binding.native_order_id,api_version:'wc/v3',revision:binding.source_revision,sha256:binding.source_digest,observed_at:binding.observed_at,source_updated_at:order.source_updated_at,evidence_kind:'complete_synthetic_wire_fixture',source_identity:binding.source_identity}};}
 binding(scope:Scope,resourceId:string){const s=this.k.authorize(scope,'resource.read',id(resourceId));return wooSourceBinding(this.k,s,this.k.get(scope,resourceId));}
 capabilities(scope:Scope,resourceId:string){const s=this.k.authorize(scope,'capability.read'),b=assertWooReturnFacts(this.k,s,this.k.get(scope,resourceId));return {platform:'woocommerce',source_identity:b.source_identity,contract:b.contract_digest,api_version:'wc/v3',scopes:b.granted_scopes,qualification:'fixture_only',production_qualified:false,
  actions:[{action:'order.status',classification:'sandbox_only',available:true},{action:'return.request',classification:'composed',available:true,native_return_id:null},{action:'return.native',classification:'unavailable',available:false},{action:'return.exchange',classification:'unavailable',available:false},{action:'warehouse.receive',classification:'unavailable',available:false}]};}
}
