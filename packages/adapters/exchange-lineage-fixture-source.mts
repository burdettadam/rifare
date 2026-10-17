import { DatabaseSync } from 'node:sqlite';
import { exact,id,integer,resourceKey } from '../commerce/kernel.mts';
import type { Row } from '../commerce/kernel.mts';
import { canonical,contentDigest,jsonValue } from '../commerce/configuration-values.mts';
import { allocateMoney,money } from '../commerce/money.mts';
import { minor,unitComponents } from '../commerce/resolution-ledger.mts';
import { lineageSourceTables } from './exchange-lineage-source-guards.mts';
import { ResolutionFixtureSource } from './resolution-fixture-source.mts';
import { FulfillmentFixtureSource } from './fulfillment-fixture-source.mts';

const sum=(values:Row[])=>values.reduce((n,x)=>n+minor(x.amount_minor),0n);
function checked(r:Row|undefined){if(!r)return null;const b=JSON.parse(r.body);if(contentDigest(b)!==r.digest)throw new Error('LINEAGE_SOURCE_INTEGRITY');return b;}
function distribute(amount:bigint,weights:Row[]){const total=sum(weights);if(!total){if(amount)throw new Error('LINEAGE_VALUE_MISMATCH');return weights.map(x=>({...x,amount_minor:'0'}));}const shares=allocateMoney(money('USD',amount.toString()),weights.map(x=>({id:x.instrument_id,weight:x.amount_minor})));return weights.map(x=>({...x,amount_minor:shares.find(y=>y.id===x.instrument_id)!.amount.minor}));}
function aggregate(units:Row[]){const map=new Map<string,Row>();for(const u of units)for(const a of u.funding){const key=a.instrument_id,old=map.get(key);if(old&&canonical({...old,amount_minor:'0'})!==canonical({...a,amount_minor:'0'}))throw new Error('LINEAGE_INSTRUMENT_CHANGED');map.set(key,{...a,amount_minor:(minor(old?.amount_minor??'0')+minor(a.amount_minor)).toString()});}return [...map.values()].sort((a,b)=>a.instrument_id.localeCompare(b.instrument_id));}

/** Isolated fixture authority. Source balances, consumed units and child funding commit together. */
export class ExchangeLineageFixtureSource {
 readonly finance:ResolutionFixtureSource;readonly fulfillment:FulfillmentFixtureSource;readonly db:DatabaseSync;readonly identity:string;readonly tenant:string;readonly store:string;
 fault:'none'|'before'|'after'='none';calls={transfer:0,lookup:0};
 constructor(finance:ResolutionFixtureSource,fulfillment:FulfillmentFixtureSource){
  if(!(finance instanceof ResolutionFixtureSource)||!(fulfillment instanceof FulfillmentFixtureSource)||finance.db===fulfillment.db||finance.tenant!==fulfillment.tenant||finance.store!==fulfillment.store||fulfillment.financeSource!==finance)throw new Error('LINEAGE_SOURCE_UNQUALIFIED');
  this.finance=finance;this.fulfillment=fulfillment;this.db=finance.db;this.identity=finance.identity;this.tenant=finance.tenant;this.store=finance.store;
  lineageSourceTables(this.db);this.db.exec('CREATE TABLE IF NOT EXISTS fixture_exchange_lineage_originals(resource_id TEXT PRIMARY KEY,body TEXT NOT NULL,digest TEXT NOT NULL) STRICT;');
 }
 /** Fixture administration imports the native original allocation once; never called by a customer route. */
 seedOriginal(input:unknown){const raw=jsonValue(input),p=exact(raw,['resource_id','customer_id','payment_id','currency','native_order_id','original_paid_minor','prior_refunded_minor','paid_lines',...['instrument_allocations','bundle_allocations'].filter(x=>Object.hasOwn(raw,x))]);
  id(p.resource_id);id(p.customer_id);id(p.payment_id);if(!/^gid:\/\/shopify\/Order\/[1-9][0-9]*$/.test(p.native_order_id)||!Array.isArray(p.paid_lines)||!p.paid_lines.length||p.paid_lines.length>100)throw new Error('LINEAGE_SOURCE_UNQUALIFIED');
  const account=this.db.prepare('SELECT * FROM fixture_resolution_accounts WHERE resource_id=?').get(p.resource_id) as Row;
  if(!account||account.customer_id!==p.customer_id||account.payment_id!==p.payment_id||account.currency!==p.currency||minor(account.available_minor)!==minor(p.original_paid_minor)-minor(p.prior_refunded_minor))throw new Error('LINEAGE_SOURCE_MISMATCH');
  const instruments=p.instrument_allocations?.instruments??[{id:'original_'+contentDigest(p.payment_id).slice(0,24),type:'card',supported:true}],units:Row[]=[];
  for(const line of p.paid_lines){id(line.id);integer(line.quantity,1);if(line.quantity>100)throw new Error('LINEAGE_UNIT_LIMIT');for(let n=1;n<=line.quantity;n++){
   const paid=unitComponents(p,line,[n]).paid_minor,amounts=p.instrument_allocations?.units.find((u:Row)=>u.line_id===line.id&&u.unit_index===n)?.amounts??[{instrument_id:instruments[0].id,amount_minor:paid}];
   if(sum(amounts)!==minor(paid))throw new Error('LINEAGE_VALUE_MISMATCH');const funding=amounts.map((a:Row)=>{const instrument=instruments.find((i:Row)=>i.id===a.instrument_id);if(!instrument||!instrument.supported)throw new Error('LINEAGE_INSTRUMENT_UNQUALIFIED');return {...a,type:instrument.type,payment_id:p.payment_id,source_identity:this.identity,source_operation_id:null};});
   units.push({line_id:line.id,unit_index:n,paid_minor:paid,resolved:line.resolved_units.includes(n),funding});
  }}
  if(units.reduce((n,u)=>n+minor(u.paid_minor),0n)!==minor(p.original_paid_minor))throw new Error('LINEAGE_VALUE_MISMATCH');
  const body={...p,units},old=checked(this.db.prepare('SELECT body,digest FROM fixture_exchange_lineage_originals WHERE resource_id=?').get(p.resource_id) as Row);
  if(old){if(canonical(old)!==canonical(body))throw new Error('LINEAGE_ORIGINAL_IMMUTABLE');return;}if(this.db.prepare('SELECT 1 FROM fixture_resolution_effects WHERE resource_id=?').get(p.resource_id))throw new Error('LINEAGE_SEED_TOO_LATE');
  this.db.prepare('INSERT INTO fixture_exchange_lineage_originals VALUES(?,?,?)').run(p.resource_id,canonical(body),contentDigest(body));
 }
 registered(resource:string){return Boolean(this.db.prepare('SELECT resource_id FROM fixture_exchange_lineage_nodes WHERE resource_id=? UNION SELECT resource_id FROM fixture_exchange_lineage_originals WHERE resource_id=? LIMIT 1').get(id(resource),id(resource)));}
 parent(resource:string){const child=checked(this.db.prepare('SELECT body,digest FROM fixture_exchange_lineage_nodes WHERE resource_id=?').get(id(resource)) as Row);if(child)return {body:child,digest:contentDigest(child),generation:child.generation};
  const original=checked(this.db.prepare('SELECT body,digest FROM fixture_exchange_lineage_originals WHERE resource_id=?').get(resource) as Row);if(!original)throw new Error('LINEAGE_ORIGINAL_SOURCE_REQUIRED');return {body:original,digest:contentDigest(original),generation:0};}
 pin(input:Row){const p=jsonValue(input),parent=this.parent(p.parent_resource_id);if(parent.generation>=16)throw new Error('LINEAGE_GENERATION_LIMIT');
  if(p.customer_id!==parent.body.customer_id||p.payment_id!==parent.body.payment_id||p.currency!==parent.body.currency||p.native_original_order_id!==parent.body.native_order_id)throw new Error('LINEAGE_SOURCE_MISMATCH');
  if(!Array.isArray(p.units)||!p.units.length||p.units.length>100||new Set(p.units).size!==p.units.length)throw new Error('LINEAGE_UNIT_INVALID');
  const selected=p.units.map((n:number)=>{integer(n,1);const u=parent.body.units.find((u:Row)=>u.line_id===p.line_id&&u.unit_index===n);if(!u||u.resolved)throw new Error('LINEAGE_UNIT_INVALID');return u;});
  const paid=selected.reduce((n:number,u:Row)=>n+minor(u.paid_minor),0n);if(paid!==minor(p.parent_paid_minor)||minor(p.entitlement_minor)>paid)throw new Error('LINEAGE_VALUE_MISMATCH');
  return {...p,parent_digest:parent.digest,generation:parent.generation+1,lineage_source_identity:this.identity,fulfillment_source_identity:this.fulfillment.identity};
 }
 lookup(operation:string){this.calls.lookup++;return checked(this.db.prepare('SELECT body,digest FROM fixture_exchange_lineage_nodes WHERE operation_id=?').get(id(operation)) as Row);}
 transfer(operation:string){this.calls.transfer++;const fault=this.fault;this.fault='none';if(fault==='before')throw new Error('LINEAGE_SOURCE_UNAVAILABLE');
  const prior=this.lookup(operation);if(prior)return prior;
  const replacement=this.fulfillment.replacement(operation),delivery=replacement&&this.fulfillment.delivery(replacement.id);
  if(!replacement||replacement.state!=='created'||!replacement.inventory_committed||!replacement.fulfillable||replacement.fulfillment_state!=='shipped'||!delivery)throw new Error('LINEAGE_DELIVERY_REQUIRED');
  const pin=replacement.exchange_lineage;if(!pin)throw new Error('LINEAGE_SOURCE_BINDING_REQUIRED');
  if(canonical(this.pin(Object.fromEntries(Object.entries(pin).filter(([key])=>!['parent_digest','generation','lineage_source_identity','fulfillment_source_identity'].includes(key)))))!==canonical(pin))throw new Error('LINEAGE_SOURCE_CHANGED');
  const hold=this.fulfillment.reservation(replacement.reservation_id);if(!hold||canonical(hold.exchange_lineage)!==canonical(pin)||replacement.resource_id!==pin.parent_resource_id||replacement.customer_id!==pin.customer_id||replacement.allocation_id!==pin.allocation_id||replacement.exchange_quote_digest!==pin.exchange_quote_digest||replacement.exchange_value_minor!==pin.replacement_minor)throw new Error('LINEAGE_SOURCE_MISMATCH');
  if(replacement.gift_recipient_customer_id)throw new Error('LINEAGE_GIFT_QUALIFICATION_REQUIRED');
  const parent=this.parent(pin.parent_resource_id),selected=pin.units.map((n:number)=>parent.body.units.find((u:Row)=>u.line_id===pin.line_id&&u.unit_index===n)),original=aggregate(selected);
  let effect:Row|null=null,addition=0n,outflow=0n;
  if(replacement.exchange_finance){this.finance.assertExchangeSettlement(replacement);const row=this.db.prepare('SELECT * FROM fixture_resolution_effects WHERE operation_id=?').get(replacement.exchange_finance.operation_id) as Row;if(!row)throw new Error('LINEAGE_SETTLEMENT_REQUIRED');const raw=JSON.parse(row.body);effect=raw; // The source row stores the complete immutable command plus native state.
   if(effect.kind==='additional_payment')addition=minor(effect.amount_minor);else outflow=minor(effect.amount_minor);
  }else if(pin.entitlement_minor!==pin.replacement_minor)throw new Error('LINEAGE_SETTLEMENT_REQUIRED');
  const fees=minor(pin.parent_paid_minor)-minor(pin.entitlement_minor),carried=minor(pin.entitlement_minor)+addition-outflow;
  if(carried!==minor(pin.replacement_minor))throw new Error('LINEAGE_VALUE_MISMATCH');
  let funding=distribute(minor(pin.entitlement_minor),original);
  // Native routing omits a fully exhausted instrument; its retained lineage
  // slice is still an exact zero, not a changed funding identity.
  if(effect?.value_routes){for(const f of funding)if((effect.value_routes.find((r:Row)=>r.instrument_id===f.instrument_id)?.amount_minor??'0')!==f.amount_minor)throw new Error('LINEAGE_INSTRUMENT_CHANGED');}
  if(outflow){const routed=effect?.routes??distribute(outflow,funding);funding=funding.map(f=>({...f,amount_minor:(minor(f.amount_minor)-minor(routed.find((r:Row)=>r.instrument_id===f.instrument_id)?.amount_minor??'0')).toString()}));}
  if(addition)funding.push({instrument_id:'payment_'+contentDigest(effect!.operation_id).slice(0,24),type:'card',amount_minor:addition.toString(),payment_id:effect!.payment_id,source_identity:this.identity,source_operation_id:effect!.operation_id});
  if(funding.length>8||sum(funding)!==carried)throw new Error('LINEAGE_INSTRUMENT_UNQUALIFIED');
  const external='exchange_'+replacement.id,resource=resourceKey(this.tenant,this.store,'order','synthetic',external),line='exchange_line_'+contentDigest(operation).slice(0,20),payment='lineage_payment_'+contentDigest(operation).slice(0,24),quantity=replacement.quantity;
  const remaining=funding.map(f=>({...f})),base=carried/BigInt(quantity),extra=carried%BigInt(quantity),units:Row[]=[];
  for(let index=0;index<quantity;index++){const target=base+(BigInt(index)<extra?1n:0n),parts=distribute(target,remaining);units.push({line_id:line,unit_index:index+1,paid_minor:target.toString(),resolved:false,funding:parts});for(const part of parts){const left=remaining.find(f=>f.instrument_id===part.instrument_id)!;left.amount_minor=(minor(left.amount_minor)-minor(part.amount_minor)).toString();}}
  const instruments=funding.map(f=>({id:f.instrument_id,type:f.type,original_paid_minor:f.amount_minor,prior_refunded_minor:'0',supported:true}));
  const body={id:'lineage_'+contentDigest(operation).slice(0,40),operation_id:operation,tenant_id:this.tenant,store_id:this.store,source_identity:this.identity,fulfillment_source_identity:this.fulfillment.identity,
   external_id:external,resource_id:resource,parent_resource_id:pin.parent_resource_id,parent_digest:pin.parent_digest,generation:pin.generation,customer_id:pin.customer_id,currency:pin.currency,payment_id:payment,
   native_order_id:delivery.native_order_id,fulfillment_line_id:delivery.fulfillment_line_id,line_id:line,quantity,delivered_at:delivery.delivered_at,delivery_event_id:delivery.event_id,replacement_id:replacement.id,
   consumed_units:pin.units.map((unit_index:number)=>({line_id:pin.line_id,unit_index})),parent_paid_minor:pin.parent_paid_minor,fees_minor:fees.toString(),additional_paid_minor:addition.toString(),terminal_outflow_minor:outflow.toString(),terminal_outflow_kind:effect&&outflow?effect.kind:null,financial_operation_id:effect?.operation_id??null,
   carried_minor:carried.toString(),replacement_retail_minor:pin.replacement_retail_minor,configuration_digest:pin.configuration_digest,policy_digest:pin.policy_digest,parent_policy_chain:parent.body.parent_policy_chain?[...parent.body.parent_policy_chain,parent.body.policy_digest]:[],bundle_component:pin.bundle_component??null,
   funding,units,paid_lines:[{id:line,product_id:pin.replacement_product_id,variant_id:replacement.variant_id,quantity,gross_minor:carried.toString(),discount_minor:'0',tax_minor:'0',shipping_minor:'0',duties_minor:'0',resolved_units:[]}],
   instrument_allocations:{rule:'original_unit_proportional_v1',instruments,units:units.map(u=>({line_id:line,unit_index:u.unit_index,amounts:u.funding.map(f=>({instrument_id:f.instrument_id,amount_minor:f.amount_minor}))}))},qualification:'synthetic_only'};
  this.db.exec('BEGIN IMMEDIATE');try{
   const old=this.lookup(operation);if(old){this.db.exec('COMMIT');return old;}
   for(const n of pin.units)if(this.db.prepare('SELECT 1 FROM fixture_exchange_lineage_units WHERE resource_id=? AND line_id=? AND unit_index=?').get(pin.parent_resource_id,pin.line_id,n))throw new Error('LINEAGE_PARENT_ALREADY_CONSUMED');
   const bindings=(this.db.prepare('SELECT body,digest FROM fixture_exchange_lineage_bindings WHERE resource_id=?').all(pin.parent_resource_id) as Row[]).map(checked);
   for(const b of bindings)if(b.line_id===pin.line_id&&b.units.some((n:number)=>pin.units.includes(n))&&b.operation_id!==effect?.operation_id)throw new Error('LINEAGE_PARENT_FINANCIAL_OPERATION');
   const account=this.db.prepare('SELECT * FROM fixture_resolution_accounts WHERE resource_id=?').get(pin.parent_resource_id) as Row;
   const effects=(this.db.prepare("SELECT body FROM fixture_resolution_effects WHERE resource_id=?").all(pin.parent_resource_id) as Row[]).map(r=>JSON.parse(r.body)).filter(e=>e.state!=='rejected');
   const spent=effects.reduce((n,e)=>n+minor(e.original_value_minor??e.amount_minor),0n),debit=effect?fees:minor(pin.parent_paid_minor);
   if(!account||minor(account.available_minor)-spent<debit)throw new Error('LINEAGE_PARENT_BALANCE_EXCEEDED');
   this.db.prepare('UPDATE fixture_resolution_accounts SET available_minor=? WHERE resource_id=?').run((minor(account.available_minor)-debit).toString(),pin.parent_resource_id);
   for(const n of pin.units)this.db.prepare('INSERT INTO fixture_exchange_lineage_units VALUES(?,?,?,?)').run(pin.parent_resource_id,pin.line_id,n,operation);
   this.finance.seed({resource_id:resource,customer_id:body.customer_id,payment_id:payment,currency:body.currency,available_minor:body.carried_minor});
   this.finance.seedInstruments(resource,instruments,body.instrument_allocations.units);
   this.db.prepare('INSERT INTO fixture_exchange_lineage_nodes VALUES(?,?,?,?,?)').run(operation,resource,pin.parent_resource_id,canonical(body),contentDigest(body));this.db.exec('COMMIT');
  }catch(error){this.db.exec('ROLLBACK');throw error;}
  if(fault==='after')throw new Error('LINEAGE_SOURCE_RESPONSE_LOST');return body;
 }
}
