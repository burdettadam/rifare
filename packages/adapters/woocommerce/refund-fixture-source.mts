import { DatabaseSync } from 'node:sqlite';
import { exact,id,integer,token } from '../../commerce/kernel.mts';
import type { Row } from '../../commerce/kernel.mts';
import { canonical,contentDigest,jsonValue } from '../../commerce/configuration-values.mts';
import { money,decimalString,decimalMoney } from '../../commerce/money.mts';
import { WooRefundGatewayFixture,assertSeparateWooDatabases } from './refund-gateway-fixture.mts';
import { WOO_REFUND_CONTRACT,WOO_REFUND_CONTRACT_DIGEST,WOO_MANUAL_PENDING,checkedWooConfig,checkedWooCommand,checkedWooFinancialContract,checkedWooSourceBinding,wooHash,wooNative,wooMinor,wooOrigin } from './refund-contract.mts';

function body(row:Row|undefined){if(!row)throw new Error('WOO_REFUND_SOURCE_MISSING');const value=JSON.parse(row.body);if(contentDigest(value)!==row.digest)throw new Error('WOO_REFUND_SOURCE_INTEGRITY');return value;}
function same(a:unknown,b:unknown,code='WOO_FINANCIAL_SOURCE_MISMATCH'){if(canonical(a)!==canonical(b))throw new Error(code);}
function nativeGatewayRequest(p:Row){const t=p.woo_refund,f=t.financial_contract;return {operation_id:p.operation_id,allocation_id:p.allocation_id,tenant_id:p.tenant_id,store_id:p.store_id,resource_id:p.resource_id,customer_id:p.customer_id,
 gateway_id:t.gateway_id,gateway_account_id:t.gateway_account_id,gateway_identity:t.gateway_identity,gateway_contract_version:t.gateway_contract_version,native_order_id:t.native_order_id,payment_id:p.payment_id,transaction_id:f.transaction_id,instrument_id:f.instrument_id,
 currency:p.currency,amount_minor:p.amount_minor,line_id:p.line_id,units:p.units,command_digest:contentDigest(p)};}

/** Persisted Woo-shaped records and a separate named gateway fixture, with no provider transport. */
export class WooRefundFixtureSource {
 readonly db:DatabaseSync;readonly gateway:WooRefundGatewayFixture;readonly identity:string;readonly tenant:string;readonly store:string;readonly clock:()=>number;readonly qualification='synthetic_only';
 readonly config:Row;
 constructor(db:DatabaseSync,gateway:WooRefundGatewayFixture,options:{mode:'fixture';identity:string;tenant:string;store:string;account_id:string;origin:string;refund_mode:'gateway'|'manual';granted_scopes:string[]},clock=Date.now){const p=exact(options,['mode','identity','tenant','store','account_id','origin','refund_mode','granted_scopes']);
  if(p.mode!=='fixture'||!(gateway instanceof WooRefundGatewayFixture))throw new Error('LIVE_WOO_REFUND_DISABLED');assertSeparateWooDatabases(db,gateway.db);this.db=db;this.gateway=gateway;this.tenant=id(p.tenant);this.store=id(p.store);id(p.identity);this.clock=clock;
  if(gateway.tenant!==this.tenant||gateway.store!==this.store)throw new Error('WOO_GATEWAY_SOURCE_MISMATCH');
  this.config=Object.freeze(checkedWooConfig({contract_id:WOO_REFUND_CONTRACT.id,contract_digest:WOO_REFUND_CONTRACT_DIGEST,api_version:'wc/v3',account_id:id(p.account_id),origin:wooOrigin(p.origin),refund_mode:p.refund_mode,granted_scopes:p.granted_scopes,
   gateway_id:gateway.gatewayId,gateway_account_id:gateway.account,gateway_identity:gateway.identity,gateway_contract_version:gateway.contract}));
  db.exec(`PRAGMA busy_timeout=3000;
   CREATE TABLE IF NOT EXISTS fixture_woo_refund_identity(id INTEGER PRIMARY KEY,body TEXT NOT NULL,digest TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS fixture_woo_financial_orders(resource_id TEXT PRIMARY KEY,body TEXT NOT NULL,digest TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS fixture_woo_refund_operations(operation_id TEXT PRIMARY KEY,resource_id TEXT NOT NULL,allocation_id TEXT NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL,observed_at INTEGER NOT NULL,UNIQUE(resource_id,allocation_id));
   CREATE TABLE IF NOT EXISTS fixture_woo_refund_records(id INTEGER PRIMARY KEY AUTOINCREMENT,operation_id TEXT NOT NULL UNIQUE,resource_id TEXT NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL,observed_at INTEGER NOT NULL);`);
  const prior=db.prepare('SELECT body,digest FROM fixture_woo_refund_identity WHERE id=1').get() as Row,binding={label:p.identity,tenant_id:this.tenant,store_id:this.store,config:this.config};
  if(prior){const old=body(prior);for(const key of Object.keys(binding))same(old[key],binding[key]);this.identity=old.identity;}
  else{this.identity='woo_refund_source_'+token().slice(0,32);const record={...binding,identity:this.identity};db.prepare('INSERT INTO fixture_woo_refund_identity VALUES(1,?,?)').run(canonical(record),contentDigest(record));}
 }
 configuration(){return jsonValue(this.config);}
 seed(value:unknown){const p=exact(jsonValue(value),['resource_id','customer_id','source_binding','financial_contract','original_units']);id(p.resource_id);id(p.customer_id);const source=checkedWooSourceBinding(p.source_binding),financial=checkedWooFinancialContract(p.financial_contract);
  if(source.account_id!==this.config.account_id||source.origin!==this.config.origin||financial.gateway_id!==this.config.gateway_id||financial.gateway_account_id!==this.config.gateway_account_id)throw new Error('WOO_FINANCIAL_SOURCE_MISMATCH');
  if(!Array.isArray(p.original_units)||!p.original_units.length||p.original_units.length>1000)throw new Error('WOO_ORIGINAL_UNITS_INVALID');const units=new Set<string>();let total=0n;
  for(const u of p.original_units){exact(u,['line_id','unit_index','amount_minor','resolved']);wooNative(u.line_id);integer(u.unit_index,1);money(financial.currency,u.amount_minor);if(typeof u.resolved!=='boolean'||units.has(u.line_id+':'+u.unit_index))throw new Error('WOO_ORIGINAL_UNITS_INVALID');units.add(u.line_id+':'+u.unit_index);total+=wooMinor(u.amount_minor);}
  if(total!==wooMinor(financial.original_paid_minor))throw new Error('WOO_ORIGINAL_UNITS_INVALID');this.db.prepare('INSERT INTO fixture_woo_financial_orders VALUES(?,?,?)').run(p.resource_id,canonical(p),contentDigest(p));return {...p,qualification:'synthetic_only'};
 }
 #order(command:Row){const order=body(this.db.prepare('SELECT body,digest FROM fixture_woo_financial_orders WHERE resource_id=?').get(command.resource_id) as Row);
  if(order.resource_id!==command.resource_id||order.customer_id!==command.customer_id)throw new Error('WOO_FINANCIAL_SOURCE_MISMATCH');same(order.source_binding,command.woo_refund.source_binding);same(order.financial_contract,command.woo_refund.financial_contract);return order;}
 #command(value:unknown){const p=checkedWooCommand(value);if(p.tenant_id!==this.tenant||p.store_id!==this.store||p.source_identity!==this.identity)throw new Error('WOO_FINANCIAL_SOURCE_MISMATCH');
  for(const key of Object.keys(this.config))same(p.woo_refund[key],this.config[key]);this.#order(p);return p;}
 #operation(operationId:string){const row=this.db.prepare('SELECT * FROM fixture_woo_refund_operations WHERE operation_id=?').get(id(operationId)) as Row;if(!row)return null;const command=this.#command(body(row));
  if(row.operation_id!==command.operation_id||row.resource_id!==command.resource_id||row.allocation_id!==command.allocation_id)throw new Error('WOO_REFUND_SOURCE_INTEGRITY');return {row,command};}
 #record(p:Row,refundedPayment:boolean){this.db.exec('BEGIN IMMEDIATE');try{const old=this.db.prepare('SELECT * FROM fixture_woo_refund_records WHERE operation_id=?').get(p.operation_id) as Row;
  if(old){this.db.exec('COMMIT');return;}const inserted=this.db.prepare("INSERT INTO fixture_woo_refund_records(operation_id,resource_id,body,digest,observed_at) VALUES(?,?,'{}',?,?)").run(p.operation_id,p.resource_id,contentDigest({}),this.clock()),nativeId=Number(inserted.lastInsertRowid);
  const record={id:nativeId,parent_id:Number(p.woo_refund.native_order_id),amount:decimalString(money(p.currency,p.amount_minor)),refunded_payment:refundedPayment,
   api_refund:p.woo_refund.refund_mode==='gateway',api_restock:false,line_items:[{id:Number(p.line_id),quantity:p.units.length}],operation_id:p.operation_id,command_digest:contentDigest(p),api_version:'wc/v3',source_account_id:p.woo_refund.account_id,source_origin:p.woo_refund.origin,qualification:'synthetic_wire_fixture'};
  this.db.prepare('UPDATE fixture_woo_refund_records SET body=?,digest=? WHERE id=?').run(canonical(record),contentDigest(record),nativeId);this.db.exec('COMMIT');
 }catch(error){this.db.exec('ROLLBACK');throw error;}}
 async issue(value:unknown){const p=this.#command(value);let created=false;this.db.exec('BEGIN IMMEDIATE');try{
  const previous=this.#operation(p.operation_id);if(previous){same(previous.command,p,'WOO_REFUND_IDEMPOTENCY_CONFLICT');}
  else{const original=this.#order(p),prior=(this.db.prepare('SELECT operation_id FROM fixture_woo_refund_operations WHERE resource_id=?').all(p.resource_id) as Row[]).map(r=>this.inspect(r.operation_id)!);
   if(prior.some(r=>r.command.allocation_id===p.allocation_id||r.state!=='rejected'&&r.command.line_id===p.line_id&&r.command.units.some((u:number)=>p.units.includes(u))))throw new Error('WOO_REFUND_OBLIGATION_CONFLICT');
   let selected=0n;for(const index of p.units){const unit=original.original_units.find((u:Row)=>u.line_id===p.line_id&&u.unit_index===index);if(!unit||unit.resolved)throw new Error('WOO_ORIGINAL_UNIT_UNAVAILABLE');selected+=wooMinor(unit.amount_minor);}
   const reserved=prior.filter(r=>r.state!=='rejected').reduce((n,r)=>n+wooMinor(r.command.amount_minor),0n);
   if(wooMinor(p.amount_minor)>selected||reserved+wooMinor(p.amount_minor)+wooMinor(original.financial_contract.prior_refunded_minor)>wooMinor(original.financial_contract.original_paid_minor))throw new Error('WOO_REFUND_BALANCE_EXCEEDED');
   this.db.prepare('INSERT INTO fixture_woo_refund_operations VALUES(?,?,?,?,?,?)').run(p.operation_id,p.resource_id,p.allocation_id,canonical(p),contentDigest(p),this.clock());created=true;}
  this.db.exec('COMMIT');
 }catch(error){this.db.exec('ROLLBACK');throw error;}
  // The durable obligation is written before crossing the independent gateway boundary.
  // Neither repeat issue nor lookup creates another gateway refund after uncertainty.
  if(created){if(p.woo_refund.refund_mode==='manual')this.#record(p,false);
   else{const result=await this.gateway.refund(nativeGatewayRequest(p));if(result?.state!=='rejected')this.#record(p,true);}}
  return this.result(p.operation_id);
 }
 inspect(operationId:string){const operation=this.#operation(operationId);if(!operation)return null;const {row,command}=operation,r=this.db.prepare('SELECT * FROM fixture_woo_refund_records WHERE operation_id=?').get(operationId) as Row,record=r?body(r):null,gateway=this.gateway.inspect(operationId);
  if(record){const expected={id:r.id,parent_id:Number(command.woo_refund.native_order_id),amount:decimalString(money(command.currency,command.amount_minor)),refunded_payment:command.woo_refund.refund_mode==='gateway',api_refund:command.woo_refund.refund_mode==='gateway',api_restock:false,
   line_items:[{id:Number(command.line_id),quantity:command.units.length}],operation_id:command.operation_id,command_digest:row.digest,api_version:'wc/v3',source_account_id:command.woo_refund.account_id,source_origin:command.woo_refund.origin,qualification:'synthetic_wire_fixture'};
   same(record,expected,'WOO_REFUND_RECORD_MISMATCH');if(r.resource_id!==command.resource_id||decimalMoney(command.currency,record.amount).minor!==command.amount_minor)throw new Error('WOO_REFUND_RECORD_MISMATCH');}
  if(gateway){const expected=nativeGatewayRequest(command);for(const key of Object.keys(expected))same(gateway[key],expected[key],'WOO_GATEWAY_PAYMENT_MISMATCH');}
  if(command.woo_refund.refund_mode==='manual'&&gateway||record?.refunded_payment===true&&!gateway||gateway?.state==='rejected'&&record)throw new Error('WOO_REFUND_EFFECT_CONFLICT');
  const state=command.woo_refund.refund_mode==='manual'?(record?WOO_MANUAL_PENDING:'unknown'):gateway?.state==='rejected'?'rejected':gateway?.state==='settled'&&record?'settled':gateway?'accepted':'unknown';
  return {command,command_digest:row.digest,refund_record:record,refund_record_digest:r?.digest??null,gateway_effect:gateway,gateway_effect_digest:gateway?contentDigest(gateway):null,state,
   observed_at:Math.max(row.observed_at,r?.observed_at??0,gateway?.observed_at??0),qualification:'synthetic_only',live_financial_effect:false};
 }
 result(operationId:string){const proof=this.inspect(operationId);if(!proof)return null;const p=proof.command;
  return {...p,id:'woo_fixture_receipt_'+contentDigest([this.identity,operationId]).slice(0,32),state:proof.state,instrument:null,qualification:'synthetic_only',
   woo_evidence:{refund_record_id:proof.refund_record?String(proof.refund_record.id):null,refund_record_digest:proof.refund_record_digest,refunded_payment:proof.refund_record?.refunded_payment??null,
    gateway_refund_id:proof.gateway_effect?.id??null,gateway_effect_digest:proof.gateway_effect_digest,gateway_state:proof.gateway_effect?.state??null,gateway_settled:proof.gateway_effect?.settled??false,
    financial_stage:proof.state===WOO_MANUAL_PENDING?WOO_MANUAL_PENDING:proof.state==='settled'?'fixture_gateway_settled':proof.gateway_effect&&!proof.refund_record?'gateway_effect_store_record_missing':proof.state,
    source_record_digest:contentDigest(proof),observed_at:proof.observed_at,contract_digest:WOO_REFUND_CONTRACT_DIGEST,live_financial_effect:false}};
 }
 async lookup(operationId:string){return this.result(operationId);}
 assertResult(command:Row,value:unknown){const p=this.#command(command),expected=this.result(p.operation_id);if(!expected)throw new Error('WOO_REFUND_SOURCE_MISSING');same(value,expected,'WOO_REFUND_RESULT_UNVERIFIED');return expected.woo_evidence.refund_record_id;}
}
