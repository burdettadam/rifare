import type { DatabaseSync } from 'node:sqlite';
import { exact,id,integer } from '../commerce/kernel.mts';
import type { Row } from '../commerce/kernel.mts';
import { canonical,contentDigest,jsonValue } from '../commerce/configuration-values.mts';
import { money } from '../commerce/money.mts';
import { assertProcurementSourceEffect } from './procurement-source-guards.mts';

export const PROCUREMENT_SOURCE_CONTRACT=Object.freeze({adapter_id:'rifare-procurement-fixture',version:'1.0.0',qualification:'synthetic_only',operations:['supplier_terms','send','lookup','acknowledgment_observation','cancellation_observation']});
const HASH=/^[a-f0-9]{64}$/;
function checked(row:Row|undefined){if(!row)throw new Error('PROCUREMENT_SOURCE_NOT_FOUND');const b=jsonValue(JSON.parse(row.body));if(contentDigest(b)!==row.digest)throw new Error('PROCUREMENT_SOURCE_INTEGRITY');return b;}
export function procurementResult(command:Row,value:unknown):Row{
 const b=exact(jsonValue(value),['schema_version','operation_id','tenant_id','store_id','resource_id','source_identity','po_id','po_version','po_digest','native_id','stage','source_version','cancelled','acknowledgment_ref','payment_state','invoice_state','observed_at','qualification','digest']);
 const hash=b.digest;delete b.digest;
 if(!HASH.test(hash)||contentDigest(b)!==hash||b.schema_version!==1||b.qualification!=='synthetic_only'
  ||!['sent','acknowledged'].includes(b.stage)||b.payment_state!=='unobserved'||b.invoice_state!=='unobserved')throw new Error('PROCUREMENT_SOURCE_RESULT_INTEGRITY');
 for(const field of ['operation_id','tenant_id','store_id','resource_id','source_identity','po_id','po_version','po_digest'])if(b[field]!==command[field])throw new Error('PROCUREMENT_SOURCE_RESULT_MISMATCH');
 id(b.native_id);integer(b.source_version,1);integer(b.observed_at);if(b.acknowledgment_ref!==null)id(b.acknowledgment_ref);
 if((b.stage==='acknowledged')!==(b.acknowledgment_ref!==null)||!Array.isArray(b.cancelled)||b.cancelled.length>100)throw new Error('PROCUREMENT_SOURCE_RESULT_INTEGRITY');
 const seen=new Set<string>(),counts=new Map<string,number>();
 for(const entry of b.cancelled){exact(entry,['event_id','line_id','quantity_base']);id(entry.event_id);id(entry.line_id);integer(entry.quantity_base,1);
  if(seen.has(entry.event_id))throw new Error('PROCUREMENT_SOURCE_RESULT_INTEGRITY');seen.add(entry.event_id);
  const line=command.lines.find((line:Row)=>line.line_id===entry.line_id);if(!line)throw new Error('PROCUREMENT_SOURCE_RESULT_MISMATCH');
  const n=(counts.get(entry.line_id)??0)+entry.quantity_base;if(!Number.isSafeInteger(n)||n>line.ordered_base_quantity)throw new Error('PROCUREMENT_CANCELLATION_EXCESS');counts.set(entry.line_id,n);
 }
 return {...b,digest:hash};
}

/** A separate synthetic supplier system. Fixture observations are not accounts,
 * supplier contracts, invoices, payment, stock receipt or production effects. */
export class ProcurementFixtureSource {
 readonly db:DatabaseSync;readonly tenant:string;readonly store:string;readonly identity:string;readonly clock:()=>number;
 fault:'none'|'before'|'after'|'hang'='none';
 constructor(db:DatabaseSync,options:{mode:'fixture';tenant:string;store:string;identity:string;clock?:()=>number}){
  if(options.mode!=='fixture')throw new Error('FIXTURE_ONLY');this.db=db;this.tenant=id(options.tenant);this.store=id(options.store);this.identity=id(options.identity);this.clock=options.clock??Date.now;
  db.exec('PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS fixture_procurement_identity(id INTEGER PRIMARY KEY CHECK(id=1),tenant_id TEXT NOT NULL,store_id TEXT NOT NULL,source_identity TEXT NOT NULL) STRICT; CREATE TABLE IF NOT EXISTS fixture_procurement_terms(supplier_id TEXT NOT NULL,version INTEGER NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(supplier_id,version)) STRICT; CREATE TABLE IF NOT EXISTS fixture_procurement_orders(operation_id TEXT PRIMARY KEY,po_id TEXT NOT NULL,po_version INTEGER NOT NULL,command TEXT NOT NULL,command_digest TEXT NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL,UNIQUE(po_id,po_version)) STRICT; CREATE TABLE IF NOT EXISTS fixture_procurement_events(event_id TEXT PRIMARY KEY,operation_id TEXT NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL) STRICT');
  const old=db.prepare('SELECT * FROM fixture_procurement_identity WHERE id=1').get() as Row|undefined;
  if(old&&(old.tenant_id!==this.tenant||old.store_id!==this.store||old.source_identity!==this.identity))throw new Error('PROCUREMENT_SOURCE_IDENTITY_CHANGED');
  if(!old)db.prepare('INSERT INTO fixture_procurement_identity VALUES(1,?,?,?)').run(this.tenant,this.store,this.identity);
 }
 recordSupplierTerms(input:unknown){
  const p=exact(jsonValue(input),['supplier_id','version','currency_code','effective_at','expires_at','lines']);id(p.supplier_id);integer(p.version,1);integer(p.effective_at);integer(p.expires_at);money(p.currency_code,'0');
  if(p.effective_at>this.clock()||p.expires_at<=this.clock()||p.effective_at>=p.expires_at||!Array.isArray(p.lines)||!p.lines.length||p.lines.length>50)throw new Error('PROCUREMENT_TERMS_INVALID');
  const keys=new Set<string>();for(const line of p.lines){exact(line,['variant_id','order_unit','base_unit','conversion','minimum_quantity','lead_time_days','unit_cost_minor']);id(line.variant_id);
   exact(line.conversion,['numerator','denominator']);integer(line.conversion.numerator,1);integer(line.conversion.denominator,1);integer(line.minimum_quantity,1);integer(line.lead_time_days,1);
   if(!['each','case'].includes(line.order_unit)||line.base_unit!=='each'||line.conversion.denominator!==1||line.conversion.numerator>1000000||line.order_unit==='each'&&line.conversion.numerator!==1||line.minimum_quantity>1000000||line.lead_time_days>366)throw new Error('PROCUREMENT_UNIT_UNSUPPORTED');
   money(p.currency_code,line.unit_cost_minor);if(BigInt(line.unit_cost_minor)===0n)throw new Error('PROCUREMENT_PRICE_INVALID');
   const key=line.variant_id+':'+line.order_unit;if(keys.has(key))throw new Error('PROCUREMENT_DUPLICATE_TERMS');keys.add(key);
  }
  const body={schema_version:1,tenant_id:this.tenant,store_id:this.store,source_identity:this.identity,...p,observed_at:this.clock(),qualification:'synthetic_only'};
  const previous=this.db.prepare('SELECT * FROM fixture_procurement_terms WHERE supplier_id=? ORDER BY version DESC LIMIT 1').get(p.supplier_id) as Row|undefined;
  if(previous){const old=checked(previous);if(p.version===old.version&&canonical({...body,observed_at:old.observed_at})===canonical(old))return {...old,digest:previous.digest};if(p.version!==old.version+1)throw new Error('PROCUREMENT_TERMS_VERSION');}
  else if(p.version!==1)throw new Error('PROCUREMENT_TERMS_VERSION');
  this.db.prepare('INSERT INTO fixture_procurement_terms VALUES(?,?,?,?)').run(p.supplier_id,p.version,canonical(body),contentDigest(body));return {...body,digest:contentDigest(body)};
 }
 terms(supplierId:string){const row=this.db.prepare('SELECT * FROM fixture_procurement_terms WHERE supplier_id=? ORDER BY version DESC LIMIT 1').get(id(supplierId)) as Row|undefined;const b=checked(row);
  if(b.tenant_id!==this.tenant||b.store_id!==this.store||b.source_identity!==this.identity)throw new Error('PROCUREMENT_SOURCE_SCOPE');return {...b,digest:row!.digest};}
 #command(input:unknown){
  const c=exact(jsonValue(input),['schema_version','operation_id','tenant_id','store_id','resource_id','source_identity','po_id','po_version','po_digest','supplier_id','supplier_terms_version','supplier_terms_digest','warehouse_source_identity','currency_code','total_minor','lines']);
  for(const field of ['operation_id','tenant_id','store_id','resource_id','source_identity','po_id','supplier_id','warehouse_source_identity'])id(c[field]);integer(c.po_version,1);integer(c.supplier_terms_version,1);
  if(c.schema_version!==1||c.tenant_id!==this.tenant||c.store_id!==this.store||c.source_identity!==this.identity||!HASH.test(c.po_digest)||!HASH.test(c.supplier_terms_digest)||!Array.isArray(c.lines)||!c.lines.length||c.lines.length>50)throw new Error('PROCUREMENT_SOURCE_SCOPE');
  money(c.currency_code,c.total_minor);return c;
 }
 #current(c:Row){const terms=this.terms(c.supplier_id);if(terms.version!==c.supplier_terms_version||terms.digest!==c.supplier_terms_digest||terms.expires_at<=this.clock()||terms.effective_at>this.clock()||terms.currency_code!==c.currency_code)throw new Error('PROCUREMENT_TERMS_CHANGED');
  let total=0n;const seen=new Set<string>();for(const line of c.lines){
   exact(line,['line_id','variant_id','location_id','quantity','ordered_quantity','ordered_base_quantity','order_unit','purchase_unit','base_unit','units_per_purchase','conversion','base_quantity','currency_code','unit_cost_minor','line_total_minor']);
   id(line.line_id);id(line.location_id);integer(line.quantity,1);const term=terms.lines.find((t:Row)=>t.variant_id===line.variant_id&&t.order_unit===line.order_unit);
   if(!term||seen.has(line.line_id)||line.quantity<term.minimum_quantity||line.quantity!==line.ordered_quantity||line.purchase_unit!==line.order_unit||line.base_unit!==term.base_unit||canonical(line.conversion)!==canonical(term.conversion)||line.units_per_purchase!==term.conversion.numerator)throw new Error('PROCUREMENT_UNIT_OR_TERMS_CHANGED');seen.add(line.line_id);
   const base=line.quantity*term.conversion.numerator;if(line.quantity>1000000||base>1000000000)throw new Error('PROCUREMENT_QUANTITY_LIMIT');
   if(!Number.isSafeInteger(base)||line.ordered_base_quantity!==base||line.base_quantity!==base||line.currency_code!==c.currency_code||line.unit_cost_minor!==term.unit_cost_minor)throw new Error('PROCUREMENT_LINE_MISMATCH');
   const amount=BigInt(term.unit_cost_minor)*BigInt(line.quantity);if(line.line_total_minor!==amount.toString())throw new Error('PROCUREMENT_TOTAL_MISMATCH');total+=amount;
  }if(c.total_minor!==total.toString())throw new Error('PROCUREMENT_TOTAL_MISMATCH');
 }
 async send(input:unknown):Promise<Row>{const c=this.#command(input),old=this.db.prepare('SELECT * FROM fixture_procurement_orders WHERE po_id=? AND po_version=?').get(c.po_id,c.po_version) as Row|undefined;
  if(old){if(old.operation_id!==c.operation_id||old.command_digest!==contentDigest(c))throw new Error('PROCUREMENT_ORIGINAL_SEND_REQUIRED');return (await this.lookup(c.operation_id))!;}
  if(this.fault==='hang')return new Promise<never>(()=>{});if(this.fault==='before'){this.fault='none';throw new Error('PROCUREMENT_SOURCE_UNAVAILABLE');}
  this.db.exec('BEGIN IMMEDIATE');let value:Row;try{assertProcurementSourceEffect(this.db,c);this.#current(c);
   const body={schema_version:1,operation_id:c.operation_id,tenant_id:this.tenant,store_id:this.store,resource_id:c.resource_id,source_identity:this.identity,po_id:c.po_id,po_version:c.po_version,po_digest:c.po_digest,native_id:'native_po_'+contentDigest([this.identity,c.po_id,c.po_version]).slice(0,40),stage:'sent',source_version:1,cancelled:[],acknowledgment_ref:null,payment_state:'unobserved',invoice_state:'unobserved',observed_at:this.clock(),qualification:'synthetic_only'};
   this.db.prepare('INSERT INTO fixture_procurement_orders VALUES(?,?,?,?,?,?,?)').run(c.operation_id,c.po_id,c.po_version,canonical(c),contentDigest(c),canonical(body),contentDigest(body));this.db.exec('COMMIT');value={...body,digest:contentDigest(body)};
  }catch(error){this.db.exec('ROLLBACK');throw error;}
  if(this.fault==='after'){this.fault='none';throw new Error('PROCUREMENT_LOST_SOURCE_RESPONSE');}return value;
 }
 observation(operationId:string):Row|null{const row=this.db.prepare('SELECT * FROM fixture_procurement_orders WHERE operation_id=?').get(id(operationId)) as Row|undefined;if(!row)return null;
  const command=this.#command(JSON.parse(row.command));if(contentDigest(command)!==row.command_digest||row.po_id!==command.po_id||row.po_version!==command.po_version)throw new Error('PROCUREMENT_SOURCE_INTEGRITY');
  return procurementResult(command,{...checked(row),digest:row.digest});
 }
 async lookup(operationId:string):Promise<Row|null>{return this.observation(operationId);}
 #observe(operationId:string,input:Row,kind:string){id(operationId);id(input.event_id);this.db.exec('BEGIN IMMEDIATE');try{const row=this.db.prepare('SELECT * FROM fixture_procurement_orders WHERE operation_id=?').get(operationId) as Row|undefined;
  if(!row)throw new Error('PROCUREMENT_SOURCE_NOT_FOUND');const command=this.#command(JSON.parse(row.command)),body=procurementResult(command,{...checked(row),digest:row.digest});delete body.digest;
  const event={schema_version:1,event_id:input.event_id,operation_id:operationId,po_id:command.po_id,po_version:command.po_version,po_digest:command.po_digest,kind,...input,source_identity:this.identity};
  const previous=this.db.prepare('SELECT * FROM fixture_procurement_events WHERE event_id=?').get(input.event_id) as Row|undefined;
  if(previous){if(previous.digest!==contentDigest(event)||contentDigest(checked(previous))!==previous.digest)throw new Error('PROCUREMENT_SOURCE_EVENT_CONFLICT');this.db.exec('COMMIT');return {...body,digest:row.digest};}
  if(kind==='acknowledgment'){if(body.acknowledgment_ref!==null)throw new Error('PROCUREMENT_ACKNOWLEDGMENT_ALREADY_RECORDED');body.stage='acknowledged';body.acknowledgment_ref=input.event_id;}
  else {if(body.stage!=='acknowledged')throw new Error('PROCUREMENT_ACKNOWLEDGMENT_REQUIRED');const line=command.lines.find((line:Row)=>line.line_id===input.line_id);if(!line)throw new Error('PROCUREMENT_LINE_NOT_FOUND');
   const cancelled=body.cancelled.filter((entry:Row)=>entry.line_id===input.line_id).reduce((n:number,entry:Row)=>n+entry.quantity_base,0);
   if(cancelled+input.quantity_base>line.ordered_base_quantity)throw new Error('PROCUREMENT_CANCELLATION_EXCESS');body.cancelled.push({...input});}
  body.source_version++;body.observed_at=this.clock();procurementResult(command,{...body,digest:contentDigest(body)});
  this.db.prepare('INSERT INTO fixture_procurement_events VALUES(?,?,?,?)').run(input.event_id,operationId,canonical(event),contentDigest(event));this.db.prepare('UPDATE fixture_procurement_orders SET body=?,digest=? WHERE operation_id=?').run(canonical(body),contentDigest(body),operationId);this.db.exec('COMMIT');
  return {...body,digest:contentDigest(body)};
 }catch(error){this.db.exec('ROLLBACK');throw error;}}
 acknowledge(operationId:string,input:unknown){const p=exact(jsonValue(input),['event_id']);return this.#observe(operationId,p,'acknowledgment');}
 observeCancellation(operationId:string,input:unknown){const p=exact(jsonValue(input),['event_id','line_id','quantity_base']);id(p.line_id);integer(p.quantity_base,1);return this.#observe(operationId,p,'cancellation');}
}
