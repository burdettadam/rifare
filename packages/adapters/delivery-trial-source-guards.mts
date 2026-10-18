import { exact,id,integer } from '../commerce/kernel.mts';
import type { Row } from '../commerce/kernel.mts';
import { canonical,contentDigest,jsonValue } from '../commerce/configuration-values.mts';
import { minor } from '../commerce/resolution-ledger.mts';
import { WarehouseFixtureSource } from './warehouse-fixture-source.mts';
import type { InstantExchangeFixtureSource } from './instant-exchange-fixture-source.mts';

type Source=InstantExchangeFixtureSource;
const warehouses=new WeakMap<Source,Map<string,WarehouseFixtureSource>>();
const guards=new WeakMap<Source,Map<string,{digest:string;check:()=>unknown}>>();
const hash=(value:unknown)=>{if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))throw new Error('INSTANT_TRIAL_INTEGRITY');return value;};
const read=(row:Row|undefined,code='INSTANT_TRIAL_SOURCE_MISSING')=>{if(!row)throw new Error(code);const body=JSON.parse(row.body);if(contentDigest(body)!==row.digest)throw new Error('INSTANT_TRIAL_INTEGRITY');return body;};
export const isDeliveryTrial=(value:unknown):value is Row=>!!value&&typeof value==='object'&&(value as Row).workflow==='delivery_trial';
export const unitObligation=(unit:Row)=>minor(unit.obligation_minor??unit.paid_minor);
export const originalObligation=(binding:Row)=>binding.original_obligation_minor??binding.original_paid_minor;

export function deliveryTrialBinding(input:unknown){
 const b=exact(jsonValue(input),['workflow','trial_id','obligation_id','allocation_id','case_id','resource_id','customer_id','native_original_order_id','currency','units','original_obligation_minor','quantity','order_digest','created_at']);
 for(const field of ['trial_id','obligation_id','allocation_id','case_id','resource_id','customer_id'])id(b[field]);hash(b.order_digest);integer(b.created_at);integer(b.quantity,1);minor(b.original_obligation_minor);
 if(b.workflow!=='delivery_trial'||b.currency!=='USD'||typeof b.native_original_order_id!=='string'||!/^gid:\/\/shopify\/Order\/[1-9][0-9]*$/.test(b.native_original_order_id)||!Array.isArray(b.units)||b.units.length!==b.quantity||b.quantity>100)throw new Error('INSTANT_TRIAL_BINDING_INVALID');
 const seen=new Set<string>();for(const unit of b.units){exact(unit,['line_id','unit_index','variant_id','obligation_minor']);id(unit.line_id);id(unit.variant_id);integer(unit.unit_index,1);minor(unit.obligation_minor);const key=unit.line_id+':'+unit.unit_index;if(seen.has(key))throw new Error('INSTANT_TRIAL_BINDING_INVALID');seen.add(key);}
 if(b.original_obligation_minor!==b.units.reduce((sum:bigint,unit:Row)=>sum+unitObligation(unit),0n).toString()||b.original_obligation_minor==='0')throw new Error('INSTANT_TRIAL_BINDING_INVALID');return b;
}

/** Register only from the canonical operation dispatcher. A persisted trial
 * command never becomes executable merely because an adapter was reopened. */
export function armDeliveryTrialGuard(source:Source,command:Row,check:()=>unknown){
 if(!isDeliveryTrial(command.binding))return ()=>{};
 let entries=guards.get(source);if(!entries){entries=new Map();guards.set(source,entries);}
 const entry={digest:contentDigest(command),check};entries.set(command.operation_id,entry);
 return ()=>{if(entries.get(command.operation_id)===entry)entries.delete(command.operation_id);};
}
export function hasDeliveryTrialGuard(source:Source,command:Row){return guards.get(source)?.get(command.operation_id)?.digest===contentDigest(command);}
export function assertDeliveryTrialGuard(source:Source,command:Row){
 if(!isDeliveryTrial(command.binding))return;const guard=guards.get(source)?.get(command.operation_id);
 if(!guard||guard.digest!==contentDigest(command))throw new Error('INSTANT_TRIAL_GUARD_REQUIRED');
 try{const result=guard.check();if(result instanceof Promise)throw new Error('INSTANT_TRIAL_ASYNC_GUARD');}catch(error){if(error instanceof Error&&error.message.startsWith('INSTANT_'))throw error;throw new Error('INSTANT_TRIAL_AUTHORITY_CHANGED');}
}

function setup(source:Source){source.db.exec(`
 CREATE TABLE IF NOT EXISTS fixture_trial_windows(account_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL) STRICT;
 CREATE TABLE IF NOT EXISTS fixture_trial_deliveries(event_id TEXT PRIMARY KEY,trial_id TEXT NOT NULL,sequence INTEGER NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL,UNIQUE(trial_id,sequence)) STRICT;
 CREATE TABLE IF NOT EXISTS fixture_trial_return_links(trial_id TEXT NOT NULL,request_id TEXT NOT NULL,native_return_id TEXT NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(trial_id,request_id)) STRICT;
`);}
export function trialWindow(source:Source,accountId:string){
 const row=source.db.prepare('SELECT * FROM fixture_trial_windows WHERE account_id=?').get(id(accountId)) as Row,body=read(row,'INSTANT_TRIAL_ACCOUNT_DURATION_UNQUALIFIED'),account=source.account(accountId);
 if(body.account_digest!==account.digest||body.observed_at>source.clock()||body.expires_at<=source.clock())throw new Error('INSTANT_TRIAL_ACCOUNT_DURATION_CHANGED');return {...body,revision:row.revision,digest:row.digest};
}
export function trialSourceConfiguration(source:Source,accountId:string){const account=source.account(accountId),window=trialWindow(source,accountId);return {account,window,digest:contentDigest({source_identity:source.identity,account_digest:account.digest,window_digest:window.digest,window_revision:window.revision})};}
export function trialTerms(source:Source,termsId:string,digest?:string){
 const row=(digest===undefined?source.db.prepare('SELECT * FROM fixture_instant_terms WHERE id=? ORDER BY version DESC LIMIT 1').get(id(termsId)):source.db.prepare('SELECT * FROM fixture_instant_terms WHERE id=? AND digest=?').get(id(termsId),hash(digest))) as Row,body=read(row,'INSTANT_TRIAL_TERMS_REQUIRED');
 if(body.nonreturn_rule!=='retained_trial_goods_v1'||body.merchant_approved!==true||digest!==undefined&&digest!==row.digest)throw new Error('INSTANT_TRIAL_TERMS_CHANGED');return {...body,digest:row.digest};
}
export function trialNativeOrder(source:Source,resourceId:string){const body=read(source.db.prepare('SELECT * FROM fixture_instant_orders WHERE id=?').get(id(resourceId)) as Row);if(body.workflow!=='delivery_trial')throw new Error('INSTANT_TRIAL_ORDER_REQUIRED');return {...body,digest:contentDigest(body)};}

export function deliveryTrialClock(source:Source,binding:Row,terms:Row,extensionMs:number){
 const events=(source.db.prepare('SELECT * FROM fixture_trial_deliveries WHERE trial_id=? ORDER BY sequence').all(binding.trial_id) as Row[]).map(row=>read(row));
 for(const event of events)if(event.resource_id!==binding.resource_id||event.native_original_order_id!==binding.native_original_order_id||event.source_identity!==source.identity)throw new Error('INSTANT_TRIAL_DELIVERY_BINDING');
 if(!events.length)return {state:'awaiting_delivery',started_at:null,ends_at:null,capture_after:null,delivery_digest:contentDigest([]),event_id:null,corrections:0,extension_ms:extensionMs};
 const latest=events.at(-1)!,delivered=events.filter(event=>event.complete&&event.delivered_at!==null);
 if(!latest.complete||latest.delivered_at===null||!delivered.length)return {state:'delivery_uncertain',started_at:null,ends_at:null,capture_after:null,delivery_digest:contentDigest(events),event_id:latest.event_id,corrections:events.length-1,extension_ms:extensionMs};
 // A traceable correction can lengthen the agreed clock, never silently shorten it.
 const startedAt = Math.max(...delivered.map((event:Row)=>event.delivered_at));
 return {state:'delivery_observed',started_at:startedAt,ends_at:startedAt+terms.trial_ms+extensionMs,capture_after:startedAt+terms.trial_ms+extensionMs+terms.return_grace_ms,delivery_digest:contentDigest(events),event_id:latest.event_id,corrections:events.length-1,extension_ms:extensionMs};
}

export function deliveryTrialBalance(source:Source,binding:Row){
 const links=(source.db.prepare('SELECT * FROM fixture_trial_return_links WHERE trial_id=? ORDER BY request_id').all(binding.trial_id) as Row[]).map(row=>read(row));
 const received=new Set<string>(),references:Row[]=[];let certain=true;
 for(const link of links){
  const warehouse=warehouses.get(source)?.get(link.source_identity);if(!warehouse||warehouse.tenant!==source.tenant||warehouse.store!==source.store)throw new Error('INSTANT_TRIAL_WAREHOUSE_UNAVAILABLE');
  const events=warehouse.returnEvents(link.native_return_id);if(!events.length){certain=false;continue;}
  const effective=new Map<string,Row>();
  for(const event of events){
   if(event.request_id!==link.request_id||event.resource_id!==binding.resource_id||event.source_identity!==link.source_identity)throw new Error('INSTANT_TRIAL_RECEIPT_BINDING');
   for(const unit of event.units){const key=unit.line_id+':'+unit.ordinal,original=binding.units.find((u:Row)=>u.line_id===unit.line_id&&u.unit_index===unit.ordinal);
    if(!original||original.variant_id!==unit.variant_id||!link.expected_units.some((u:Row)=>u.line_id===unit.line_id&&u.unit_index===unit.ordinal))throw new Error('INSTANT_TRIAL_RECEIPT_UNITS');effective.set(key,unit);}
  }
  const latest=events.at(-1)!;if(latest.completeness!=='complete'||link.expected_units.some((unit:Row)=>!effective.has(unit.line_id+':'+unit.unit_index)))certain=false;
  for(const [key,unit] of effective)if(unit.received)received.add(key);
  references.push({request_id:link.request_id,native_return_id:link.native_return_id,source_identity:link.source_identity,event_digest:contentDigest(events),event_count:events.length,certain});
 }
 const retained = binding.units.filter((unit:Row)=>!received.has(unit.line_id+':'+unit.unit_index));
 return {unreturned:retained,remaining:retained.reduce((sum:bigint,unit:Row)=>sum+unitObligation(unit),0n),received,certain,receipt_digest:contentDigest(references),references};
}

export function assertTrialConsent(source:Source,consent:Row,binding:Row,terms:Row){
 const window=trialWindow(source,consent.account_id);integer(consent.extension_ms);hash(consent.window_digest);
 if(terms.nonreturn_rule!=='retained_trial_goods_v1'||consent.window_digest!==window.digest||consent.authorization_duration_ms!==window.authorization_duration_ms||consent.mandate_expires_at!==consent.confirmed_at+window.authorization_duration_ms)throw new Error('INSTANT_TRIAL_AUTHORIZATION_DURATION_CHANGED');
 if(terms.delivery_window_ms+terms.trial_ms+terms.return_grace_ms>window.authorization_duration_ms)throw new Error('INSTANT_TRIAL_AUTHORIZATION_TOO_SHORT');
 if(consent.extension_ms>terms.maximum_extension_ms)throw new Error('INSTANT_TRIAL_EXTENSION_UNAPPROVED');
 const clock=deliveryTrialClock(source,binding,terms,consent.extension_ms);
 if(consent.reauthorization_of===null){if(consent.extension_ms!==0||consent.trial_deadline_at!==null)throw new Error('INSTANT_TRIAL_CONSENT_INVALID');}
 else{const original=read(source.db.prepare('SELECT * FROM fixture_instant_obligations WHERE id=?').get(consent.reauthorization_of) as Row);
  if(original.obligation_id!==binding.obligation_id||canonical(original.binding)!==canonical(binding)||consent.confirmed_at<=original.authorized_at||consent.extension_ms<(original.trial_extension_ms??0)||consent.trial_deadline_at!==clock.ends_at)throw new Error('INSTANT_TRIAL_FRESH_CONSENT_REQUIRED');
 }
 if(clock.capture_after!==null&&clock.capture_after>=consent.mandate_expires_at)throw new Error('INSTANT_TRIAL_REAUTHORIZATION_REQUIRED');
}
export function trialPlanFields(consent:Row){return {trial_extension_ms:consent.extension_ms,authorization_duration_ms:consent.authorization_duration_ms,authorization_window_digest:consent.window_digest};}
export function trialCaptureState(source:Source,obligation:Row){
 const terms=trialTerms(source,obligation.terms_id,obligation.terms_digest),clock=deliveryTrialClock(source,obligation.binding,terms,obligation.trial_extension_ms??0),balance=deliveryTrialBalance(source,obligation.binding);
 if(clock.started_at===null)throw new Error('INSTANT_TRIAL_DELIVERY_UNCONFIRMED');if(clock.capture_after!>=obligation.expires_at)throw new Error('INSTANT_TRIAL_REAUTHORIZATION_REQUIRED');
 if(source.clock()<clock.capture_after!)throw new Error('INSTANT_TRIAL_ACTIVE');if(!balance.certain)throw new Error('INSTANT_TRIAL_RECEIPTS_UNCERTAIN');return {clock,balance};
}
export function trialCaptureGeneration(source:Source,obligationId:string){
 const rows=(source.db.prepare("SELECT * FROM fixture_instant_operations WHERE obligation_id=? AND kind='capture' ORDER BY generation").all(obligationId) as Row[]).map(row=>read(row));
 if(rows.some(row=>row.state!=='rejected'))throw new Error('INSTANT_CAPTURE_EXISTS');return rows.length+1;
}
export function trialPublicBinding(source:Source,obligation:Row){const terms=trialTerms(source,obligation.terms_id,obligation.terms_digest),clock=deliveryTrialClock(source,obligation.binding,terms,obligation.trial_extension_ms??0);
 return {workflow:'delivery_trial',trial_id:obligation.binding.trial_id,obligation_id:obligation.obligation_id,mandate_id:obligation.mandate_id,mandate_revision:obligation.mandate_revision,source_identity:source.identity,allocation_id:obligation.allocation_id,resource_id:obligation.binding.resource_id,customer_id:obligation.binding.customer_id,currency:obligation.binding.currency,maximum_minor:obligation.maximum_minor,terms_digest:obligation.terms_digest,consent_id:obligation.consent_id,expires_at:obligation.expires_at,trial_deadline_at:clock.ends_at,clock,authorization_duration_ms:obligation.authorization_duration_ms};
}

/** Synthetic observation administration only. This facade owns no money or
 * stock. Captures remain in the original InstantExchangeFixtureSource owner. */
export class DeliveryTrialFacts {
 readonly source:Source;
 constructor(source:Source){this.source=source;setup(source);}
 qualifyWindow(input:unknown){const p=exact(jsonValue(input),['account_id','expected_revision','authorization_duration_ms','observed_at','expires_at','contract_ref']);id(p.account_id);id(p.contract_ref);integer(p.expected_revision);integer(p.authorization_duration_ms,1);integer(p.observed_at);integer(p.expires_at);
  const source=this.source,account=source.account(p.account_id);if(p.authorization_duration_ms>3600000||p.observed_at>source.clock()||p.expires_at<=source.clock()||p.expires_at>account.expires_at)throw new Error('INSTANT_TRIAL_ACCOUNT_DURATION_UNQUALIFIED');
  return source.tx(()=>{const old=source.db.prepare('SELECT revision FROM fixture_trial_windows WHERE account_id=?').get(p.account_id) as Row;if((old?.revision??0)!==p.expected_revision)throw new Error('INSTANT_TRIAL_ACCOUNT_DURATION_CHANGED');
   const body={account_id:p.account_id,account_digest:account.digest,authorization_duration_ms:p.authorization_duration_ms,observed_at:p.observed_at,expires_at:p.expires_at,contract_ref:p.contract_ref,qualification:'synthetic_local_only'};
   source.db.prepare('INSERT INTO fixture_trial_windows VALUES(?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET revision=excluded.revision,body=excluded.body,digest=excluded.digest').run(p.account_id,p.expected_revision+1,canonical(body),contentDigest(body));return this.window(p.account_id);});
 }
 window(accountId:string){return trialWindow(this.source,accountId);}
 configuration(accountId:string){return trialSourceConfiguration(this.source,accountId);}
 seedOrder(input:unknown){const p=exact(jsonValue(input),['resource_id','customer_id','native_original_order_id','currency','units','created_at']);id(p.resource_id);id(p.customer_id);integer(p.created_at);
  if(!Array.isArray(p.units)||!p.units.length||p.units.length>100)throw new Error('INSTANT_TRIAL_BINDING_INVALID');
  const original=p.units.reduce((sum:bigint,unit:Row)=>sum+unitObligation(unit),0n).toString(),body={workflow:'delivery_trial',...p,original_obligation_minor:original};
  deliveryTrialBinding({...body,trial_id:'trial_seed',obligation_id:'trial_seed_obligation',allocation_id:'trial_seed_value',case_id:'trial_seed_case',quantity:p.units.length,order_digest:contentDigest(body)});
  this.source.db.prepare('INSERT INTO fixture_instant_orders VALUES(?,?,?)').run(p.resource_id,canonical(body),contentDigest(body));return {...body,digest:contentDigest(body)};
 }
 order(resourceId:string){return trialNativeOrder(this.source,resourceId);}
 publishTerms(input:Row){const p=jsonValue(input);id(p.terms_id);integer(p.version,1);const source=this.source,old=source.db.prepare('SELECT max(version) version FROM fixture_instant_terms WHERE id=?').get(p.terms_id) as Row;
  if(p.version!==(old?.version??0)+1||p.nonreturn_rule!=='retained_trial_goods_v1'||p.merchant_approved!==true)throw new Error('INSTANT_TRIAL_TERMS_UNAPPROVED');
  source.db.prepare('INSERT INTO fixture_instant_terms VALUES(?,?,?,?)').run(p.terms_id,p.version,canonical(p),contentDigest(p));return {...p,digest:contentDigest(p)};
 }
 delivery(input:unknown){const p=exact(jsonValue(input),['event_id','trial_id','resource_id','native_original_order_id','sequence','correction_of','delivered_at','observed_at','complete']);for(const key of ['event_id','trial_id','resource_id'])id(p[key]);integer(p.sequence,1);integer(p.observed_at);if(p.delivered_at!==null)integer(p.delivered_at);
  const source=this.source,order=this.order(p.resource_id);if(order.native_original_order_id!==p.native_original_order_id||typeof p.complete!=='boolean'||p.observed_at>source.clock()||p.delivered_at!==null&&(p.delivered_at>p.observed_at||p.delivered_at<order.created_at))throw new Error('INSTANT_TRIAL_DELIVERY_INVALID');
  const body={...p,source_identity:source.identity,qualification:'synthetic_local_only'};
  return source.tx(()=>{const existing=source.db.prepare('SELECT * FROM fixture_trial_deliveries WHERE event_id=?').get(p.event_id) as Row;
   if(existing){if(existing.digest!==contentDigest(body))throw new Error('INSTANT_TRIAL_DELIVERY_CONFLICT');return {...read(existing),digest:existing.digest};}
   const previous=source.db.prepare('SELECT * FROM fixture_trial_deliveries WHERE trial_id=? ORDER BY sequence DESC LIMIT 1').get(p.trial_id) as Row;
   if(p.sequence!==(previous?.sequence??0)+1||p.correction_of!==(previous?.event_id??null))throw new Error('INSTANT_TRIAL_DELIVERY_CORRECTION_REQUIRED');
   source.db.prepare('INSERT INTO fixture_trial_deliveries VALUES(?,?,?,?,?)').run(p.event_id,p.trial_id,p.sequence,canonical(body),contentDigest(body));return {...body,digest:contentDigest(body)};});
 }
 deliveryEvent(eventId:string){const row=this.source.db.prepare('SELECT * FROM fixture_trial_deliveries WHERE event_id=?').get(id(eventId)) as Row;return {...read(row),digest:row.digest};}
 bindWarehouse(warehouse:WarehouseFixtureSource){const source=this.source,path=(db:any)=>db.prepare('PRAGMA database_list').all().find((row:Row)=>row.name==='main')?.file;
  if(!(warehouse instanceof WarehouseFixtureSource)||warehouse.db===source.db||path(warehouse.db)&&path(warehouse.db)===path(source.db)||warehouse.tenant!==source.tenant||warehouse.store!==source.store)throw new Error('INSTANT_TRIAL_WAREHOUSE_UNQUALIFIED');let entries=warehouses.get(source);if(!entries){entries=new Map();warehouses.set(source,entries);}const previous=entries.get(warehouse.identity);if(previous&&previous!==warehouse&&previous.db!==warehouse.db)throw new Error('INSTANT_TRIAL_WAREHOUSE_UNQUALIFIED');entries.set(warehouse.identity,warehouse);}
 linkReturn(input:unknown){const p=exact(jsonValue(input),['trial_id','request_id','native_return_id','resource_id','source_identity','expected_units']);for(const key of ['trial_id','request_id','resource_id','source_identity'])id(p[key]);if(!warehouses.get(this.source)?.has(p.source_identity)||!Array.isArray(p.expected_units)||!p.expected_units.length)throw new Error('INSTANT_TRIAL_WAREHOUSE_UNQUALIFIED');
  const unitIds=new Set<string>();for(const unit of p.expected_units){exact(unit,['line_id','unit_index']);id(unit.line_id);integer(unit.unit_index,1);const key=unit.line_id+':'+unit.unit_index;if(unitIds.has(key))throw new Error('INSTANT_TRIAL_RECEIPT_UNITS_AMBIGUOUS');unitIds.add(key);}
  return this.source.tx(()=>{const body={...p,qualification:'synthetic_local_only'},old=this.source.db.prepare('SELECT * FROM fixture_trial_return_links WHERE trial_id=? AND request_id=?').get(p.trial_id,p.request_id) as Row;
   if(old){if(old.digest!==contentDigest(body))throw new Error('INSTANT_TRIAL_RETURN_CHANGED');return read(old);}
   const previous=(this.source.db.prepare('SELECT * FROM fixture_trial_return_links WHERE trial_id=?').all(p.trial_id) as Row[]).map(row=>read(row));
   if(previous.some(link=>link.native_return_id===p.native_return_id||link.expected_units.some((unit:Row)=>unitIds.has(unit.line_id+':'+unit.unit_index))))throw new Error('INSTANT_TRIAL_RECEIPT_UNITS_AMBIGUOUS');
   this.source.db.prepare('INSERT INTO fixture_trial_return_links VALUES(?,?,?,?,?)').run(p.trial_id,p.request_id,p.native_return_id,canonical(body),contentDigest(body));return body;});
 }
}
