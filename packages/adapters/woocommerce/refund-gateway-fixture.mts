import { DatabaseSync } from 'node:sqlite';
import { statSync } from 'node:fs';
import { exact,id,token,integer } from '../../commerce/kernel.mts';
import type { Row } from '../../commerce/kernel.mts';
import { canonical,contentDigest,jsonValue } from '../../commerce/configuration-values.mts';
import { money } from '../../commerce/money.mts';
import { WOO_GATEWAY_CONTRACT,WOO_GATEWAY_ID,wooMinor,wooHash,wooNative } from './refund-contract.mts';

export function assertSeparateWooDatabases(a:DatabaseSync,b:DatabaseSync){const path=(db:DatabaseSync)=>(db.prepare('PRAGMA database_list').all() as Row[]).find(r=>r.name==='main')?.file,first=path(a),second=path(b);
 if(a===b||first&&first===second)throw new Error('SEPARATE_WOO_GATEWAY_SOURCE_REQUIRED');
 if(first&&second){const x=statSync(first,{bigint:true}),y=statSync(second,{bigint:true});if(x.dev===y.dev&&x.ino===y.ino)throw new Error('SEPARATE_WOO_GATEWAY_SOURCE_REQUIRED');}}
function body(row:Row|undefined){if(!row)throw new Error('WOO_GATEWAY_SOURCE_MISSING');const value=JSON.parse(row.body);if(contentDigest(value)!==row.digest)throw new Error('WOO_GATEWAY_SOURCE_INTEGRITY');return value;}
const contextFields=['tenant_id','store_id','gateway_id','gateway_account_id','gateway_identity','gateway_contract_version','resource_id','customer_id','native_order_id','payment_id','transaction_id','instrument_id','currency'];
function checkedCharge(value:unknown){const p=exact(jsonValue(value),['resource_id','customer_id','native_order_id','payment_id','transaction_id','instrument_id','currency','original_paid_minor','prior_refunded_minor']);
 for(const key of ['resource_id','customer_id','payment_id','transaction_id','instrument_id'])id(p[key]);wooNative(p.native_order_id);money(p.currency,p.original_paid_minor);money(p.currency,p.prior_refunded_minor);
 if(wooMinor(p.original_paid_minor)<=0n||wooMinor(p.prior_refunded_minor)>wooMinor(p.original_paid_minor))throw new Error('WOO_GATEWAY_BALANCE_INVALID');return p;}
function checkedRequest(value:unknown){const p=exact(jsonValue(value),[...contextFields,'operation_id','allocation_id','amount_minor','line_id','units','command_digest']);
 for(const key of [...contextFields.filter(k=>!['native_order_id','currency','gateway_contract_version'].includes(k)),'operation_id','allocation_id'])id(p[key]);wooNative(p.native_order_id);wooNative(p.line_id);wooHash(p.command_digest);money(p.currency,p.amount_minor);
 if(wooMinor(p.amount_minor)<=0n||!Array.isArray(p.units)||!p.units.length||p.units.length>100||new Set(p.units).size!==p.units.length)throw new Error('WOO_GATEWAY_REQUEST_INVALID');p.units.forEach((u:unknown)=>integer(u,1));return p;}

/** Independent original-payment and refund-effect ledger; it never contacts a provider. */
export class WooRefundGatewayFixture {
 readonly db:DatabaseSync;readonly tenant:string;readonly store:string;readonly gatewayId=WOO_GATEWAY_ID;readonly account:string;readonly identity:string;readonly contract=WOO_GATEWAY_CONTRACT;readonly clock:()=>number;
 constructor(db:DatabaseSync,options:{mode:'fixture';identity:string;tenant:string;store:string;gateway_id:string;account_id:string},clock=Date.now){const p=exact(options,['mode','identity','tenant','store','gateway_id','account_id']);
  if(p.mode!=='fixture'||p.gateway_id!==WOO_GATEWAY_ID)throw new Error('WOO_GATEWAY_UNQUALIFIED');this.db=db;this.tenant=id(p.tenant);this.store=id(p.store);this.account=id(p.account_id);this.clock=clock;id(p.identity);
  db.exec(`PRAGMA busy_timeout=3000;
   CREATE TABLE IF NOT EXISTS fixture_woo_gateway_identity(id INTEGER PRIMARY KEY,body TEXT NOT NULL,digest TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS fixture_woo_gateway_charges(resource_id TEXT PRIMARY KEY,transaction_id TEXT NOT NULL UNIQUE,body TEXT NOT NULL,digest TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS fixture_woo_gateway_refunds(operation_id TEXT PRIMARY KEY,resource_id TEXT NOT NULL,allocation_id TEXT NOT NULL,command TEXT NOT NULL,command_digest TEXT NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL,UNIQUE(resource_id,allocation_id));
   CREATE TABLE IF NOT EXISTS fixture_woo_gateway_movements(operation_id TEXT PRIMARY KEY,body TEXT NOT NULL,digest TEXT NOT NULL);`);
  const previous=db.prepare('SELECT body,digest FROM fixture_woo_gateway_identity WHERE id=1').get() as Row,binding={label:p.identity,tenant_id:this.tenant,store_id:this.store,gateway_id:this.gatewayId,account_id:this.account,contract:this.contract};
  if(previous){const old=body(previous);for(const key of Object.keys(binding))if(old[key]!==binding[key])throw new Error('WOO_GATEWAY_SOURCE_MISMATCH');this.identity=old.identity;}
  else{this.identity='woo_gateway_'+token().slice(0,32);const record={...binding,identity:this.identity};db.prepare('INSERT INTO fixture_woo_gateway_identity VALUES(1,?,?)').run(canonical(record),contentDigest(record));}
 }
 seed(value:unknown){const p=checkedCharge(value);this.db.prepare('INSERT INTO fixture_woo_gateway_charges VALUES(?,?,?,?)').run(p.resource_id,p.transaction_id,canonical(p),contentDigest(p));return {...p,qualification:'synthetic_only'};}
 #charge(p:Row){const c=checkedCharge(body(this.db.prepare('SELECT body,digest FROM fixture_woo_gateway_charges WHERE resource_id=?').get(p.resource_id) as Row));
  for(const key of ['resource_id','customer_id','native_order_id','payment_id','transaction_id','instrument_id','currency'])if(c[key]!==p[key])throw new Error('WOO_GATEWAY_PAYMENT_MISMATCH');return c;}
 #request(value:unknown){const p=checkedRequest(value);if(p.tenant_id!==this.tenant||p.store_id!==this.store||p.gateway_id!==this.gatewayId||p.gateway_account_id!==this.account||p.gateway_identity!==this.identity||p.gateway_contract_version!==this.contract)throw new Error('WOO_GATEWAY_SOURCE_MISMATCH');this.#charge(p);return p;}
 async refund(value:unknown){const p=this.#request(value);this.db.exec('BEGIN IMMEDIATE');try{
  const previous=this.db.prepare('SELECT * FROM fixture_woo_gateway_refunds WHERE operation_id=?').get(p.operation_id) as Row;
  if(previous){if(previous.command_digest!==contentDigest(p))throw new Error('WOO_GATEWAY_IDEMPOTENCY_CONFLICT');this.db.exec('COMMIT');return this.inspect(p.operation_id);}
  const charge=this.#charge(p),rows=this.db.prepare('SELECT operation_id FROM fixture_woo_gateway_refunds WHERE resource_id=?').all(p.resource_id) as Row[],effects=rows.map(r=>this.inspect(r.operation_id)!);
  if(effects.some(e=>e.allocation_id===p.allocation_id||e.state!=='rejected'&&e.line_id===p.line_id&&e.units.some((u:number)=>p.units.includes(u))))throw new Error('WOO_GATEWAY_OBLIGATION_CONFLICT');
  const reserved=effects.filter(e=>e.state!=='rejected').reduce((sum,e)=>sum+wooMinor(e.amount_minor),0n),rejected=reserved+wooMinor(p.amount_minor)+wooMinor(charge.prior_refunded_minor)>wooMinor(charge.original_paid_minor);
  const result={...p,id:'fixture_gateway_refund_'+token().slice(0,24),state:rejected?'rejected':'accepted',settled:false,observed_at:this.clock(),qualification:'synthetic_only',live_financial_effect:false};
  this.db.prepare('INSERT INTO fixture_woo_gateway_refunds VALUES(?,?,?,?,?,?,?)').run(p.operation_id,p.resource_id,p.allocation_id,canonical(p),contentDigest(p),canonical(result),contentDigest(result));this.db.exec('COMMIT');return this.inspect(p.operation_id);
 }catch(error){this.db.exec('ROLLBACK');throw error;}}
 inspect(operationId:string){const row=this.db.prepare('SELECT * FROM fixture_woo_gateway_refunds WHERE operation_id=?').get(id(operationId)) as Row;if(!row)return null;
  const command=this.#request(JSON.parse(row.command)),b=body(row);if(contentDigest(command)!==row.command_digest||row.operation_id!==command.operation_id||row.resource_id!==command.resource_id||row.allocation_id!==command.allocation_id)throw new Error('WOO_GATEWAY_SOURCE_INTEGRITY');
  const keys=[...Object.keys(command),'id','state','settled','observed_at','qualification','live_financial_effect'];if(canonical(Object.keys(b).sort())!==canonical(keys.sort()))throw new Error('WOO_GATEWAY_SOURCE_INTEGRITY');
  for(const key of Object.keys(command))if(canonical(b[key])!==canonical(command[key]))throw new Error('WOO_GATEWAY_PAYMENT_MISMATCH');id(b.id);integer(b.observed_at);
  if(!['accepted','settled','rejected'].includes(b.state)||b.settled!==(b.state==='settled')||b.qualification!=='synthetic_only'||b.live_financial_effect!==false||b.observed_at>this.clock())throw new Error('WOO_GATEWAY_STAGE_INVALID');
  const movement=this.db.prepare('SELECT body,digest FROM fixture_woo_gateway_movements WHERE operation_id=?').get(operationId) as Row;
  if(b.state==='settled'){const m=body(movement),expected={operation_id:operationId,native_refund_id:b.id,command_digest:row.command_digest,tenant_id:this.tenant,store_id:this.store,gateway_identity:this.identity,gateway_account_id:this.account,transaction_id:b.transaction_id,payment_id:b.payment_id,instrument_id:b.instrument_id,currency:b.currency,amount_minor:b.amount_minor,observed_at:b.observed_at};
   if(canonical(m)!==canonical(expected))throw new Error('WOO_GATEWAY_SETTLEMENT_UNVERIFIED');}
  else if(movement)throw new Error('WOO_GATEWAY_STAGE_REGRESSION');return b;
 }
 async lookup(operationId:string){return this.inspect(operationId);}
 settle(operationId:string){this.db.exec('BEGIN IMMEDIATE');try{const previous=this.inspect(operationId);if(!previous||previous.state==='rejected')throw new Error('WOO_GATEWAY_NOT_ACCEPTED');if(previous.state==='settled'){this.db.exec('COMMIT');return previous;}
  const row=this.db.prepare('SELECT command_digest FROM fixture_woo_gateway_refunds WHERE operation_id=?').get(operationId) as Row,updated={...previous,state:'settled',settled:true,observed_at:this.clock()},movement={operation_id:operationId,native_refund_id:previous.id,command_digest:row.command_digest,tenant_id:this.tenant,store_id:this.store,gateway_identity:this.identity,gateway_account_id:this.account,transaction_id:previous.transaction_id,payment_id:previous.payment_id,instrument_id:previous.instrument_id,currency:previous.currency,amount_minor:previous.amount_minor,observed_at:updated.observed_at};
  this.db.prepare('INSERT INTO fixture_woo_gateway_movements VALUES(?,?,?)').run(operationId,canonical(movement),contentDigest(movement));this.db.prepare('UPDATE fixture_woo_gateway_refunds SET body=?,digest=? WHERE operation_id=?').run(canonical(updated),contentDigest(updated),operationId);this.db.exec('COMMIT');return this.inspect(operationId);
 }catch(error){this.db.exec('ROLLBACK');throw error;}}
}
