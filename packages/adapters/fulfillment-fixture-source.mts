import { InstantExchangeFixtureSource } from './instant-exchange-fixture-source.mts';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { exact,id,integer } from '../commerce/kernel.mts';
import type { Row } from '../commerce/kernel.mts';
import { canonical,contentDigest,jsonValue } from '../commerce/configuration-values.mts';
import { minor } from '../commerce/resolution-ledger.mts';
import { ResolutionFixtureSource } from './resolution-fixture-source.mts';

/** Separate synthetic authority. It cannot connect to a store or carrier. */
export class FulfillmentFixtureSource {
 readonly db:DatabaseSync;readonly identity:string;readonly tenant:string;readonly store:string;readonly clock:()=>number;
 readonly financeSource:ResolutionFixtureSource|undefined;readonly instantSource:InstantExchangeFixtureSource|undefined;
 readonly labelTtl:number;readonly qualification='synthetic_only'; readonly mode='fixture_native';
 fault:'none'|'before'|'after'|'malformed'|'hang'='none';
 calls={reserve:0,replace:0,rate:0,buy:0,void:0,lookup:0};
 constructor(db:DatabaseSync,options:{mode:'fixture';tenant:string;store:string;identity:string;clock?:()=>number;label_ttl_ms?:number;finance_source?:ResolutionFixtureSource;instant_source?:InstantExchangeFixtureSource}){
  integer(options.label_ttl_ms??1800000,10);if((options.label_ttl_ms??1800000)>1800000)throw new Error('INVALID_INPUT');this.labelTtl=options.label_ttl_ms??1800000;
  if(options.mode!=='fixture')throw new Error('FIXTURE_ONLY');this.db=db;this.tenant=id(options.tenant);this.store=id(options.store);id(options.identity);this.clock=options.clock??Date.now;
  this.financeSource=options.finance_source;if(this.financeSource){const path=(db:DatabaseSync)=>db.prepare('PRAGMA database_list').all().find((r:Row)=>r.name==='main')?.file;
   if(!(this.financeSource instanceof ResolutionFixtureSource)||this.financeSource.db===db||path(db)&&path(db)===path(this.financeSource.db)||this.financeSource.tenant!==this.tenant||this.financeSource.store!==this.store)throw new Error('EXCHANGE_FINANCE_SOURCE_REQUIRED');}
  this.instantSource=options.instant_source;if(this.instantSource){const path=(db:DatabaseSync)=>db.prepare('PRAGMA database_list').all().find((r:Row)=>r.name==='main')?.file;if(!(this.instantSource instanceof InstantExchangeFixtureSource)||this.instantSource.db===db||path(db)&&path(db)===path(this.instantSource.db)||this.financeSource&&(this.instantSource.db===this.financeSource.db||path(this.instantSource.db)&&path(this.instantSource.db)===path(this.financeSource.db))||this.instantSource.tenant!==this.tenant||this.instantSource.store!==this.store)throw new Error('INSTANT_SOURCE_MISMATCH');}
  db.exec(`PRAGMA busy_timeout=3000;
   CREATE TABLE IF NOT EXISTS fixture_identity (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, store TEXT NOT NULL, label TEXT NOT NULL) STRICT;
   CREATE TABLE IF NOT EXISTS fixture_stock (catalog_id TEXT PRIMARY KEY, variant_id TEXT NOT NULL, location_id TEXT NOT NULL, version INTEGER NOT NULL, available INTEGER NOT NULL CHECK(available>=0)) STRICT;
   CREATE TABLE IF NOT EXISTS fixture_holds (id TEXT PRIMARY KEY, allocation_id TEXT NOT NULL, generation INTEGER NOT NULL, state TEXT NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL) STRICT;
   CREATE TABLE IF NOT EXISTS fixture_effects (id TEXT PRIMARY KEY, kind TEXT NOT NULL, obligation TEXT NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL, UNIQUE(kind,obligation)) STRICT;
   CREATE TABLE IF NOT EXISTS fixture_rates (service TEXT PRIMARY KEY, revision INTEGER NOT NULL, amount_minor TEXT NOT NULL, currency TEXT NOT NULL, expires_at INTEGER NOT NULL) STRICT;
   CREATE TABLE IF NOT EXISTS fixture_labels (id TEXT PRIMARY KEY, body TEXT NOT NULL, digest TEXT NOT NULL) STRICT;
   CREATE TABLE IF NOT EXISTS fixture_replacement_deliveries (id TEXT PRIMARY KEY, body TEXT NOT NULL,digest TEXT NOT NULL) STRICT;
   CREATE TABLE IF NOT EXISTS fixture_replacements (id TEXT PRIMARY KEY, body TEXT NOT NULL, digest TEXT NOT NULL) STRICT;`);
  this.identity=this.tx(()=>{let r=db.prepare('SELECT * FROM fixture_identity').get() as Row;
   if(!r){r={id:'fsource_'+randomUUID().replaceAll('-',''),tenant:this.tenant,store:this.store,label:options.identity};db.prepare('INSERT INTO fixture_identity VALUES(?,?,?,?)').run(r.id,r.tenant,r.store,r.label);}
   if(r.tenant!==this.tenant||r.store!==this.store||r.label!==options.identity)throw new Error('FIXTURE_SOURCE_MISMATCH');return r.id;});
  this.instantSource?.bindFulfillmentSource(this);
 }
 tx<T>(fn:()=>T):T{this.db.exec('BEGIN IMMEDIATE');try{const r=fn();this.db.exec('COMMIT');return r;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 #read(row:Row|undefined){if(!row)return null;const b=JSON.parse(row.body);if(contentDigest(b)!==row.digest)throw new Error('SOURCE_INTEGRITY');return b;}
 #bound(b:Row){if(b.source_identity!==this.identity||b.tenant_id!==this.tenant||b.store_id!==this.store)throw new Error('FIXTURE_SOURCE_MISMATCH');}
 #save(table:string,b:Row){this.db.prepare(`INSERT INTO ${table} VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,digest=excluded.digest`).run(b.id,canonical(b),contentDigest(b));}
 seedStock(input:unknown){const p=exact(jsonValue(input),['catalog_id','variant_id','location_id','version','available']);id(p.catalog_id);id(p.variant_id);id(p.location_id);integer(p.version,1);integer(p.available);
  this.tx(()=>this.db.prepare('INSERT INTO fixture_stock VALUES(?,?,?,?,?)').run(p.catalog_id,p.variant_id,p.location_id,p.version,p.available));}
 stock(catalogId:string){const s=this.db.prepare('SELECT * FROM fixture_stock WHERE catalog_id=?').get(id(catalogId)) as Row;if(!s)throw new Error('STOCK_UNKNOWN');
  const holds=(this.db.prepare("SELECT * FROM fixture_holds WHERE state='active'").all() as Row[]).map(r=>this.#read(r)).filter(b=>b.catalog_id===catalogId&&b.expires_at>this.clock());
  return {...s,reserved:holds.reduce((n,b)=>n+b.quantity,0),scope:'fixture_native',live_inventory:false};}
 reserve(command:Row){this.calls.reserve++;this.#bound(command);const cmd=jsonValue(command);id(cmd.id);id(cmd.allocation_id);integer(cmd.generation,1);integer(cmd.quantity,1);integer(cmd.buffer);integer(cmd.expires_at);
  const financialFields=['exchange_balance_minor','original_exchange_value_minor','replacement_minor','finance_source_identity'],financialCount=financialFields.filter(key=>Object.hasOwn(cmd,key)).length;
  if(financialCount){if(financialCount!==financialFields.length||typeof cmd.exchange_balance_minor!=='string'||!/^(-?[1-9][0-9]{0,23})$/.test(cmd.exchange_balance_minor)||!this.financeSource||this.financeSource.identity!==cmd.finance_source_identity)throw new Error('EXCHANGE_FINANCE_SOURCE_REQUIRED');
   if(minor(cmd.original_exchange_value_minor)+BigInt(cmd.exchange_balance_minor)!==minor(cmd.replacement_minor))throw new Error('EXCHANGE_FINANCE_MISMATCH');}
  const giftFields=['gift_recipient_customer_id','gift_source_digest','gift_source_identity','original_customer_id','original_native_order_id'],giftCount=giftFields.filter(key=>Object.hasOwn(cmd,key)).length;
  if(giftCount){if(giftCount!==giftFields.length||!/^gid:\/\/shopify\/Order\/[1-9][0-9]*$/.test(cmd.original_native_order_id)||!this.financeSource||this.financeSource.identity!==cmd.gift_source_identity)throw new Error('GIFT_RECIPIENT_UNQUALIFIED');this.financeSource.assertGiftRecipient({resource_id:cmd.resource_id,customer_id:cmd.original_customer_id,recipient_customer_id:cmd.gift_recipient_customer_id,gift_source_digest:cmd.gift_source_digest});}
  if(cmd.instant_exchange){if(!this.instantSource||canonical(this.instantSource.binding(cmd.allocation_id))!==canonical(cmd.instant_exchange))throw new Error('INSTANT_BINDING_CHANGED');}
  return this.tx(()=>{const old=this.db.prepare('SELECT * FROM fixture_holds WHERE id=?').get(cmd.id) as Row;
   if(old){if(old.digest!==contentDigest(cmd))throw new Error('RESERVATION_CONFLICT');return this.#reservation(old);}
   if(cmd.expires_at<=this.clock()||cmd.expires_at>this.clock()+300000)throw new Error('RESERVATION_EXPIRED');
   const prior=(this.db.prepare("SELECT * FROM fixture_holds WHERE allocation_id=? AND state IN ('active','committed')").all(cmd.allocation_id) as Row[]).map(r=>({r,b:this.#read(r)}));
   if(prior.some(({r,b})=>r.state==='committed'||b.expires_at>this.clock()))throw new Error('ALLOCATION_ALREADY_RESERVED');
   const stock=this.stock(cmd.catalog_id);if(stock.variant_id!==cmd.variant_id||stock.location_id!==cmd.location_id||stock.version!==cmd.stock_version)throw new Error('STOCK_CHANGED');
   if(stock.available-stock.reserved-cmd.buffer<cmd.quantity)throw new Error('STOCK_UNAVAILABLE');
   this.db.prepare("INSERT INTO fixture_holds VALUES(?,?,?,'active',?,?)").run(cmd.id,cmd.allocation_id,cmd.generation,canonical(cmd),contentDigest(cmd));
   return this.#reservation(this.db.prepare('SELECT * FROM fixture_holds WHERE id=?').get(cmd.id) as Row);
  });}
 #reservation(r:Row){const b=this.#read(r);return {...b,state:r.state==='active'&&b.expires_at<=this.clock()?'expired':r.state,native_reserved:r.state==='active'&&b.expires_at>this.clock(),qualification:'synthetic_only'};}
 reservation(ref:string){this.calls.lookup++;const r=this.db.prepare('SELECT * FROM fixture_holds WHERE id=?').get(id(ref)) as Row;return r?this.#reservation(r):null;}
 release(ref:string,generation:number){integer(generation,1);return this.tx(()=>{const r=this.db.prepare('SELECT * FROM fixture_holds WHERE id=?').get(id(ref)) as Row;if(!r||r.generation!==generation)throw new Error('RESERVATION_CHANGED');
   if(r.state==='committed')throw new Error('RESERVATION_COMMITTED');this.db.prepare("UPDATE fixture_holds SET state='released' WHERE id=?").run(ref);return this.#reservation(this.db.prepare('SELECT * FROM fixture_holds WHERE id=?').get(ref) as Row);});}
 seedRate(input:unknown){const p=exact(jsonValue(input),['service','revision','amount_minor','currency','expires_at']);id(p.service);integer(p.revision,1);integer(p.expires_at);minor(p.amount_minor);if(p.currency!=='USD')throw new Error('RATE_CURRENCY_UNSUPPORTED');
  this.db.prepare('INSERT INTO fixture_rates VALUES(?,?,?,?,?)').run(p.service,p.revision,p.amount_minor,p.currency,p.expires_at);}
 rate(input:Row){this.calls.rate++;this.#bound(input);const r=this.db.prepare('SELECT * FROM fixture_rates WHERE service=?').get(id(input.service)) as Row;
  if(!r||r.expires_at<=this.clock())throw new Error('RATE_UNAVAILABLE');const b={...input,rate_revision:r.revision,amount_minor:r.amount_minor,currency:r.currency,expires_at:Math.min(r.expires_at,this.clock()+300000),qualification:'synthetic_only'};
  return {...b,rate_id:'rate_'+contentDigest(b).slice(0,40)};}
 #effect(command:Row,kind:string,make:()=>Row){this.#bound(command);if(command.kind!==kind)throw new Error('SOURCE_COMMAND_INVALID');
  return this.tx(()=>{const old=this.db.prepare('SELECT * FROM fixture_effects WHERE id=?').get(id(command.operation_id)) as Row;
   if(old){if(old.digest!==contentDigest(command))throw new Error('OPERATION_CONFLICT');const b=this.#readEffect(old);return b;}
   if(this.db.prepare('SELECT 1 FROM fixture_effects WHERE kind=? AND obligation=?').get(kind,command.obligation))throw new Error('OBLIGATION_ALREADY_COMMITTED');
   const result=make();this.db.prepare('INSERT INTO fixture_effects VALUES(?,?,?,?,?)').run(command.operation_id,kind,command.obligation,canonical({command,result}),contentDigest(command));return result;
  });}
 #readEffect(r:Row){const b=JSON.parse(r.body);if(contentDigest(b.command)!==r.digest)throw new Error('SOURCE_INTEGRITY');
  if(r.kind==='replacement')return this.#read(this.db.prepare('SELECT * FROM fixture_replacements WHERE id=?').get(b.result.id) as Row);
  if(r.kind==='label')return this.#read(this.db.prepare('SELECT * FROM fixture_labels WHERE id=?').get(b.result.id) as Row);
  const label=this.#read(this.db.prepare('SELECT * FROM fixture_labels WHERE id=?').get(b.result.label_id) as Row);
  return {...b.result,state:label.void_state==='confirmed'?'void_confirmed':label.void_state==='rejected'?'void_rejected':'void_requested',source_version:label.source_version,reimbursement:label.reimbursement};}
 async #call(fn:()=>Row):Promise<Row>{const fault=this.fault;this.fault='none';if(fault==='before')throw new Error('FIXTURE_TRANSPORT_FAILURE');if(fault==='hang')return new Promise(()=>{});
  const result=fn();if(fault==='after')throw new Error('FIXTURE_RESPONSE_LOST');return fault==='malformed'?{success:true,amount_minor:'0'}:result;}
 async replace(command:Row){this.calls.replace++;return this.#call(()=>{
  const existing=this.replacement(command.operation_id);if(!existing){const h=this.#read(this.db.prepare('SELECT * FROM fixture_holds WHERE id=?').get(command.reservation_id) as Row);
   if(h?.instant_exchange&&canonical(h.instant_exchange)!==canonical(command.instant_exchange??null))throw new Error('INSTANT_BINDING_CHANGED');
   if(this.instantSource)this.instantSource.reserveReplacement(command,command.instant_exchange??null);else if(command.instant_exchange||h?.instant_exchange)throw new Error('INSTANT_SOURCE_UNAVAILABLE');}
  const result=this.#effect(command,'replacement',()=>{
  if(this.financeSource?.money.required(command.resource_id))throw new Error('EXCHANGE_CURRENCY_UNQUALIFIED');
  const r=this.db.prepare('SELECT * FROM fixture_holds WHERE id=?').get(command.reservation_id) as Row,b=this.#read(r);
  if(!r||r.state!=='active'||b.generation!==command.generation||b.expires_at<=this.clock()||contentDigest(b)!==command.reservation_digest)throw new Error('RESERVATION_EXPIRED');
  if(b.allocation_id!==command.allocation_id||b.variant_id!==command.variant_id||b.quantity!==command.quantity||b.location_id!==command.location_id)throw new Error('RESERVATION_CHANGED');
  if(b.instant_exchange&&canonical(b.instant_exchange)!==canonical(command.instant_exchange??null))throw new Error('INSTANT_BINDING_CHANGED');
  if(this.instantSource)this.instantSource.assertReplacement(command,command.instant_exchange??null);else if(command.instant_exchange||b.instant_exchange)throw new Error('INSTANT_SOURCE_UNAVAILABLE');
  if(canonical(command.exchange_lineage??null)!==canonical(b.exchange_lineage??null))throw new Error('LINEAGE_SOURCE_BINDING_REQUIRED');
  if(Object.hasOwn(b,'gift_recipient_customer_id')){
   if(!this.financeSource||this.financeSource.identity!==b.gift_source_identity||command.resource_id!==b.resource_id||command.original_order_id!==b.resource_id||command.native_original_order_id!==b.original_native_order_id||command.customer_id!==b.original_customer_id||command.gift_recipient_customer_id!==b.gift_recipient_customer_id||command.gift_source_digest!==b.gift_source_digest||command.gift_source_identity!==b.gift_source_identity)throw new Error('GIFT_RECIPIENT_MISMATCH');
   this.financeSource.assertGiftRecipient({resource_id:b.resource_id,customer_id:command.customer_id,recipient_customer_id:command.gift_recipient_customer_id,gift_source_digest:command.gift_source_digest});
  }else if(['gift_recipient_customer_id','gift_source_digest','gift_source_identity'].some(key=>Object.hasOwn(command,key)))throw new Error('GIFT_RECIPIENT_MISMATCH');
  if(Object.hasOwn(b,'exchange_balance_minor')){
   if(!command.exchange_finance||!this.financeSource||this.financeSource.identity!==b.finance_source_identity)throw new Error('EXCHANGE_PAYMENT_OUTSTANDING');
   if(command.exchange_quote_digest!==b.exchange_quote_digest||command.exchange_finance.exchange_quote_id!==b.exchange_quote_id||command.original_value_minor!==b.original_exchange_value_minor||command.exchange_value_minor!==b.replacement_minor)throw new Error('EXCHANGE_FINANCE_MISMATCH');
   this.financeSource.assertExchangeSettlement(command);
  }else if(command.exchange_finance!==undefined||command.balance_minor!=='0')throw new Error('EXCHANGE_FINANCE_MISMATCH');
  const stock=this.stock(b.catalog_id);if(stock.version!==b.stock_version||stock.available<stock.reserved+b.buffer)throw new Error('STOCK_CHANGED');
  this.db.prepare('UPDATE fixture_stock SET available=available-? WHERE catalog_id=?').run(b.quantity,b.catalog_id);
  this.db.prepare("UPDATE fixture_holds SET state='committed' WHERE id=?").run(r.id);
  const result={...command,id:'replacement_'+contentDigest(command).slice(0,32),state:'created',source_version:1,fulfillable:true,inventory_committed:true,fulfillment_state:'unfulfilled',shipment_id:null,qualification:'synthetic_only'};
  this.#save('fixture_replacements',result);return result;
 });
  if(this.instantSource)this.instantSource.confirmReplacement(command,command.instant_exchange??null,result);return result;
 });}
 async buy(command:Row){this.calls.buy++;return this.#call(()=>this.#effect(command,'label',()=>{
  const rate=command.rate,r=this.db.prepare('SELECT * FROM fixture_rates WHERE service=?').get(rate.service) as Row;
  if(!r||rate.expires_at<=this.clock()||r.expires_at<=this.clock()||r.revision!==rate.rate_revision||r.amount_minor!==rate.amount_minor||r.currency!==rate.currency)throw new Error('RATE_EXPIRED');
  const {rate_id,...value}=rate;if(rate_id!=='rate_'+contentDigest(value).slice(0,40)||rate.parcel_digest!==command.parcel_digest||rate.account_id!==command.account_id||rate.source_identity!==this.identity||rate.tenant_id!==this.tenant||rate.store_id!==this.store)throw new Error('RATE_CHANGED');
  if(command.replaces){const old=this.#read(this.db.prepare('SELECT * FROM fixture_labels WHERE id=?').get(command.replaces) as Row);
   if(!old||old.request_id!==command.request_id||old.generation+1!==command.generation||!['confirmed','expired_unused'].includes(old.void_state))throw new Error('LABEL_REPLACEMENT_BLOCKED');}
  const result={...command,id:'label_'+contentDigest(command).slice(0,32),state:'purchased',source_version:1,charge_id:'charge_'+contentDigest(command).slice(0,32),amount_minor:rate.amount_minor,currency:rate.currency,
   tracking_code:'track_'+contentDigest(command).slice(0,24),tracking_state:'label_created',carrier_sequence:0,event_id:null,event_at:null,void_state:'not_requested',reimbursement:{state:'not_requested',amount_minor:'0',reference:null},valid_until:this.clock()+this.labelTtl,qualification:'synthetic_only'};
  this.#save('fixture_labels',result);return result;
 }));}
 async voidLabel(command:Row){this.calls.void++;return this.#call(()=>this.#effect(command,'void',()=>{
  const label=this.#read(this.db.prepare('SELECT * FROM fixture_labels WHERE id=?').get(command.label_id) as Row);
  if(!label||label.charge_id!==command.charge_id||label.request_id!==command.request_id||label.source_version!==command.label_version||label.tracking_state!=='label_created'||label.void_state!=='not_requested')throw new Error('VOID_UNAVAILABLE');
  label.void_state='requested';label.reimbursement={state:'pending',amount_minor:'0',reference:null};label.source_version++;
  this.#save('fixture_labels',label);return {...command,id:'void_'+contentDigest(command).slice(0,32),state:'void_requested',source_version:label.source_version,reimbursement:label.reimbursement,qualification:'synthetic_only'};
 }));}
 async lookup(operationId:string){this.calls.lookup++;const r=this.db.prepare('SELECT * FROM fixture_effects WHERE id=?').get(id(operationId)) as Row;if(!r)return null;const result=this.#readEffect(r);if(r.kind==='replacement'&&this.instantSource){const command=JSON.parse(r.body).command;this.instantSource.confirmReplacement(command,command.instant_exchange??null,result);}return result;}
 async label(labelId:string){this.calls.lookup++;return this.#read(this.db.prepare('SELECT * FROM fixture_labels WHERE id=?').get(id(labelId)) as Row);}
 confirmVoid(labelId:string,approved:boolean){if(typeof approved!=='boolean')throw new Error('INVALID_INPUT');return this.tx(()=>{const b=this.#read(this.db.prepare('SELECT * FROM fixture_labels WHERE id=?').get(id(labelId)) as Row);
  if(!b||b.void_state!=='requested')throw new Error('VOID_NOT_REQUESTED');if(approved&&b.tracking_state!=='label_created')throw new Error('VOID_UNAVAILABLE');
  b.void_state=approved?'confirmed':'rejected';b.reimbursement.state=approved?'pending':'rejected';b.source_version++;this.#save('fixture_labels',b);return b;});}
 reimburse(labelId:string){return this.tx(()=>{const b=this.#read(this.db.prepare('SELECT * FROM fixture_labels WHERE id=?').get(id(labelId)) as Row);
  if(!b||b.void_state!=='confirmed')throw new Error('VOID_NOT_CONFIRMED');if(b.reimbursement.state==='refunded')return b;
  b.reimbursement={state:'refunded',amount_minor:b.amount_minor,reference:'reimbursement_'+b.id};b.source_version++;this.#save('fixture_labels',b);return b;});}
 expireLabel(labelId:string){return this.tx(()=>{const b=this.#read(this.db.prepare('SELECT * FROM fixture_labels WHERE id=?').get(id(labelId)) as Row);
  if(!b||b.valid_until>this.clock()||b.void_state!=='not_requested'||b.tracking_state!=='label_created')throw new Error('LABEL_NOT_EXPIRABLE');
  b.void_state='expired_unused';b.source_version++;this.#save('fixture_labels',b);return b;});}
 carrierEvent(labelId:string,input:unknown){const p=exact(jsonValue(input),['id','sequence','status','at']);id(p.id);integer(p.sequence,1);integer(p.at);
  if(!['in_transit','delivered','exception','returned'].includes(p.status)||p.at>this.clock())throw new Error('TRACKING_EVENT_INVALID');
  return this.tx(()=>{const b=this.#read(this.db.prepare('SELECT * FROM fixture_labels WHERE id=?').get(id(labelId)) as Row);if(!b)throw new Error('NOT_FOUND');
   if(p.sequence<=b.carrier_sequence)throw new Error('STALE_SOURCE_EVENT');if(['confirmed','expired_unused'].includes(b.void_state))throw new Error('LABEL_INACTIVE');
   if(b.tracking_state==='delivered'&&!['delivered','exception','returned'].includes(p.status))throw new Error('TRACKING_REGRESSION');
   b.carrier_sequence=p.sequence;b.event_id=p.id;b.event_at=p.at;b.tracking_state=p.status;b.source_version++;this.#save('fixture_labels',b);return b;});}
 fulfillReplacement(ref:string,shipmentId:string){id(ref);id(shipmentId);return this.tx(()=>{const b=this.#read(this.db.prepare('SELECT * FROM fixture_replacements WHERE id=?').get(ref) as Row);if(!b)throw new Error('NOT_FOUND');
  if(b.shipment_id&&b.shipment_id!==shipmentId)throw new Error('SHIPMENT_CONFLICT');if(b.shipment_id)return b;b.fulfillment_state='shipped';b.shipment_id=shipmentId;b.source_version++;this.#save('fixture_replacements',b);return b;});}
 replacement(operation:string){const row=this.db.prepare("SELECT * FROM fixture_effects WHERE id=? AND kind='replacement'").get(id(operation)) as Row;return row?this.#readEffect(row):null;}
 delivery(replacement:string){return this.#read(this.db.prepare('SELECT * FROM fixture_replacement_deliveries WHERE id=?').get(id(replacement)) as Row);}
 deliverReplacement(ref:string,input:unknown){const p=exact(jsonValue(input),['event_id','delivered_at']);id(p.event_id);integer(p.delivered_at);if(p.delivered_at>this.clock())throw new Error('DELIVERY_EVENT_INVALID');return this.tx(()=>{const b=this.#read(this.db.prepare('SELECT * FROM fixture_replacements WHERE id=?').get(id(ref)) as Row);if(!b||b.fulfillment_state!=='shipped'||!b.shipment_id)throw new Error('LINEAGE_DELIVERY_REQUIRED');
  const value={id:ref,event_id:p.event_id,delivered_at:p.delivered_at,native_order_id:'gid://shopify/Order/'+(BigInt('0x'+contentDigest(ref).slice(0,14))+1n).toString(),fulfillment_line_id:'gid://shopify/FulfillmentLineItem/'+(BigInt('0x'+contentDigest([ref,'line']).slice(0,14))+1n).toString(),shipment_id:b.shipment_id,qualification:'synthetic_only'},old=this.delivery(ref);if(old&&canonical(old)!==canonical(value))throw new Error('DELIVERY_EVENT_CONFLICT');if(!old)this.#save('fixture_replacement_deliveries',value);return value;});}
 effects(){return this.db.prepare('SELECT id,kind,obligation FROM fixture_effects ORDER BY id').all();}
}
