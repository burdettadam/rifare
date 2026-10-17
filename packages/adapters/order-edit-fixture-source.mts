import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { exact,id,integer } from '../commerce/kernel.mts';
import type { Row } from '../commerce/kernel.mts';
import { canonical,contentDigest,jsonValue } from '../commerce/configuration-values.mts';
import { editAddress,editMinor,lineValue,orderValue,safeOrder } from '../commerce/order-edit-core.mts';

/** A separate synthetic store/warehouse system. No live transport is implemented. */
export class OrderEditFixtureSource {
 readonly db:DatabaseSync;readonly identity:string;readonly tenant:string;readonly store:string;readonly clock:()=>number;
 fault:'none'|'before'|'after'|'hang'='none';faultStage:string|null=null;
 constructor(db:DatabaseSync,config:Row,clock=Date.now){exact(config,['mode','identity','tenant','store']);if(config.mode!=='fixture')throw new Error('FIXTURE_ONLY');for(const x of [config.identity,config.tenant,config.store])id(x);
  this.db=db;this.tenant=config.tenant;this.store=config.store;this.clock=clock;
  db.exec(`PRAGMA busy_timeout=3000;
   CREATE TABLE IF NOT EXISTS edit_source_identity(singleton INTEGER PRIMARY KEY CHECK(singleton=1),label TEXT NOT NULL,identity TEXT NOT NULL,tenant TEXT NOT NULL,store TEXT NOT NULL,revision INTEGER NOT NULL) STRICT;
   CREATE TABLE IF NOT EXISTS edit_source_orders(id TEXT PRIMARY KEY,body TEXT NOT NULL,digest TEXT NOT NULL) STRICT;
   CREATE TABLE IF NOT EXISTS edit_source_catalog(id TEXT PRIMARY KEY,body TEXT NOT NULL,digest TEXT NOT NULL) STRICT;
   CREATE TABLE IF NOT EXISTS edit_source_warehouses(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,mode TEXT NOT NULL) STRICT;
   CREATE TABLE IF NOT EXISTS edit_source_fulfillments(order_id TEXT NOT NULL,warehouse_id TEXT NOT NULL,revision INTEGER NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(order_id,warehouse_id)) STRICT;
   CREATE TABLE IF NOT EXISTS edit_source_holds(order_id TEXT NOT NULL,warehouse_id TEXT NOT NULL,owner TEXT NOT NULL,handle TEXT NOT NULL,reason TEXT NOT NULL,PRIMARY KEY(order_id,warehouse_id,owner,handle,reason)) STRICT;
   CREATE TABLE IF NOT EXISTS edit_source_effects(operation_id TEXT PRIMARY KEY,command_digest TEXT NOT NULL,result TEXT NOT NULL,result_digest TEXT NOT NULL) STRICT;
   CREATE TABLE IF NOT EXISTS edit_source_calculated(edit_id TEXT PRIMARY KEY,order_id TEXT NOT NULL,original_version INTEGER NOT NULL,body TEXT,digest TEXT) STRICT;
   CREATE TABLE IF NOT EXISTS edit_source_finance(edit_id TEXT PRIMARY KEY,order_id TEXT NOT NULL,version INTEGER NOT NULL,kind TEXT NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL) STRICT;
  `);
  db.prepare('INSERT OR IGNORE INTO edit_source_identity VALUES(1,?,?,?,?,1)').run(config.identity,'edit_source_'+randomUUID().replaceAll('-',''),config.tenant,config.store);
  const r=db.prepare('SELECT * FROM edit_source_identity').get() as Row;if(r.label!==config.identity||r.tenant!==this.tenant||r.store!==this.store)throw new Error('EDIT_SOURCE_MISMATCH');this.identity=r.identity;
 }
 revision(){return (this.db.prepare('SELECT revision FROM edit_source_identity').get() as Row).revision;}
 #tx<T>(fn:()=>T):T{this.db.exec('BEGIN IMMEDIATE');try{const r=fn();this.db.exec('COMMIT');return r;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 #read(table:string,key:string){const r=this.db.prepare(`SELECT body,digest FROM ${table} WHERE id=?`).get(key) as Row;if(!r)throw new Error('EDIT_SOURCE_MISSING');const b=JSON.parse(r.body);if(contentDigest(b)!==r.digest)throw new Error('EDIT_SOURCE_INTEGRITY');return b;}
 #put(table:string,key:string,b:Row){this.db.prepare(`INSERT INTO ${table} VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,digest=excluded.digest`).run(key,canonical(b),contentDigest(b));}
 order(resource:string){return this.#read('edit_source_orders',resource);}
 catalog(variant:string){return this.#read('edit_source_catalog',variant);}
 seed(order:Row,catalog:Row[]){const o=jsonValue(order);id(o.resource_id);if(o.tenant_id!==this.tenant||o.store_id!==this.store||o.currency!=='USD'||!Array.isArray(o.lines)||o.lines.length<1||o.lines.length>50)throw new Error('INVALID_INPUT');editAddress(o.address);integer(o.version,1);integer(o.created_at);
  for(const l of o.lines){for(const key of ['id','variant_id','product_id','warehouse_id'])id(l[key]);lineValue(l);integer(l.tax_bps);if(l.tax_bps>10000||typeof l.subscription!=='boolean'||!['unfulfilled','held','picking','shipped','cancelled'].includes(l.status))throw new Error('INVALID_INPUT');}
  if(new Set(o.lines.map((l:Row)=>l.id)).size!==o.lines.length||orderValue(o).toString()!==o.total_minor)throw new Error('EDIT_TOTAL_MISMATCH');editMinor(o.net_paid_minor);editMinor(o.balance_due_minor);
  this.#tx(()=>{if(this.db.prepare('SELECT 1 FROM edit_source_orders WHERE id=?').get(o.resource_id))throw new Error('EDIT_ORDER_EXISTS');this.#put('edit_source_orders',o.resource_id,o);
   for(const v of catalog){id(v.id);id(v.product_id);editMinor(v.unit_minor);integer(v.stock);integer(v.tax_bps);this.#put('edit_source_catalog',v.id,jsonValue(v));}
   for(const warehouse of [...new Set(o.lines.map((l:Row)=>l.warehouse_id))] as string[]){this.db.prepare("INSERT OR IGNORE INTO edit_source_warehouses VALUES(?,1,'qualified')").run(warehouse);const lines=o.lines.filter((l:Row)=>l.warehouse_id===warehouse),stage=lines.some((l:Row)=>l.status==='picking')?'picking':lines.every((l:Row)=>['shipped','cancelled'].includes(l.status))?'shipped':'unfulfilled';const b={ack_version:o.version,ack_digest:contentDigest(safeOrder(o)),cancelled:lines.every((l:Row)=>l.status==='cancelled'),stage,final_variant_ids:lines.map((l:Row)=>l.variant_id)};
    this.db.prepare('INSERT INTO edit_source_fulfillments VALUES(?,?,1,?,?)').run(o.resource_id,warehouse,canonical(b),contentDigest(b));}
  });return o.resource_id;
 }
 warehouse(order:string,warehouse:string){const r=this.db.prepare('SELECT * FROM edit_source_fulfillments WHERE order_id=? AND warehouse_id=?').get(order,warehouse) as Row;if(!r)throw new Error('EDIT_WAREHOUSE_MISSING');const b=JSON.parse(r.body);if(contentDigest(b)!==r.digest)throw new Error('EDIT_SOURCE_INTEGRITY');return {id:warehouse,revision:r.revision,...b,holds:this.db.prepare('SELECT owner,handle,reason FROM edit_source_holds WHERE order_id=? AND warehouse_id=? ORDER BY owner,handle,reason').all(order,warehouse)};}
 #warehouseSave(order:string,warehouse:string,b:Row){const {id:_id,revision,holds,...body}=b;this.db.prepare('UPDATE edit_source_fulfillments SET revision=?,body=?,digest=? WHERE order_id=? AND warehouse_id=?').run(revision+1,canonical(body),contentDigest(body),order,warehouse);}
 snapshot(resource:string){const o=this.order(resource);return {source_identity:this.identity,source_revision:this.revision(),order:o,catalog:(this.db.prepare('SELECT body FROM edit_source_catalog ORDER BY id').all() as Row[]).map(r=>JSON.parse(r.body)),warehouses:([...new Set(o.lines.map((l:Row)=>l.warehouse_id))] as string[]).sort().map(w=>this.warehouse(resource,w))};}
 configureWarehouse(warehouse:string,mode:'qualified'|'tag_only'|'offline'){if(!['qualified','tag_only','offline'].includes(mode))throw new Error('INVALID_INPUT');this.#tx(()=>{const r=this.db.prepare('UPDATE edit_source_warehouses SET mode=?,revision=revision+1 WHERE id=?').run(mode,id(warehouse));if(r.changes!==1)throw new Error('EDIT_WAREHOUSE_MISSING');this.db.prepare('UPDATE edit_source_identity SET revision=revision+1').run();});}
 #mode(warehouse:string){const r=this.db.prepare('SELECT mode FROM edit_source_warehouses WHERE id=?').get(warehouse) as Row;if(!r||r.mode==='offline')throw new Error('EDIT_WAREHOUSE_UNAVAILABLE');return r.mode;}
 #addHold(order:string,w:string,owner:string,handle:string,reason:string){const row=this.warehouse(order,w);if(['picking','shipped'].includes(row.stage))throw new Error('EDIT_WAREHOUSE_IRREVERSIBLE');if(this.#mode(w)==='tag_only')return false;
  const r=this.db.prepare('INSERT OR IGNORE INTO edit_source_holds VALUES(?,?,?,?,?)').run(order,w,owner,handle,reason);if(r.changes)this.#warehouseSave(order,w,row);return true;}
 canPick(orderId:string,w:string){const o=this.order(orderId),s=this.warehouse(orderId,w);return this.#mode(w)!=='offline'&&!s.cancelled&&s.stage==='unfulfilled'&&s.holds.length===0&&o.balance_due_minor==='0'&&s.ack_version===o.version&&s.ack_digest===contentDigest(safeOrder(o));}
 tryPick(orderId:string,w:string){return this.#tx(()=>{if(!this.canPick(orderId,w))return {picked:false};const s=this.warehouse(orderId,w);s.stage='picking';this.#warehouseSave(orderId,w,s);const o=this.order(orderId);for(const l of o.lines)if(l.warehouse_id===w&&l.status==='unfulfilled')l.status='picking';o.version++;this.#put('edit_source_orders',orderId,o);return {picked:true};});}
 probe(warehouses:string[]){if(!warehouses.length||warehouses.length>4||new Set(warehouses).size!==warehouses.length)throw new Error('INVALID_INPUT');const results:Row[]=[];
  // Exercise the actual picking and acknowledgment predicates on a temporary canary.
  this.db.exec('BEGIN IMMEDIATE');try{for(const w of warehouses){id(w);const key='probe_'+randomUUID().replaceAll('-',''),o={resource_id:key,tenant_id:this.tenant,store_id:this.store,customer_id:'probe',version:1,created_at:this.clock(),currency:'USD',shipping_minor:'0',total_minor:'0',net_paid_minor:'0',balance_due_minor:'0',financial_state:'paid',cancelled:false,address:{name:'Probe',line1:'1 Test',city:'Test',state:'UT',postal:'84601',country:'US'},lines:[]};this.#put('edit_source_orders',key,o);
    const b={ack_version:1,ack_digest:contentDigest(safeOrder(o)),cancelled:false,stage:'unfulfilled',final_variant_ids:[]};this.db.prepare('INSERT INTO edit_source_fulfillments VALUES(?,?,1,?,?)').run(key,w,canonical(b),contentDigest(b));
    const before=this.canPick(key,w),ack=this.#addHold(key,w,'rifare','probe','edit'),blocked=!this.canPick(key,w);o.version=2;this.#put('edit_source_orders',key,o);const row=this.warehouse(key,w);row.ack_version=2;row.ack_digest=contentDigest(safeOrder(o));this.#warehouseSave(key,w,row);
    results.push({warehouse_id:w,picking_before:before,hold_acknowledged:ack,picking_blocked:blocked,update_consumed:this.warehouse(key,w).ack_version===2});}
   return {source_identity:this.identity,source_revision:this.revision(),qualification:'synthetic_only',qualified:results.every(r=>r.picking_before&&r.hold_acknowledged&&r.picking_blocked&&r.update_consumed),warehouses:results};
  }finally{this.db.exec('ROLLBACK');}
 }
 foreignHold(order:string,w:string,handle:string,reason='fraud'){return this.#tx(()=>this.#addHold(order,w,'external',id(handle),id(reason)));}
 clearForeignHold(order:string,w:string,handle:string){return this.#tx(()=>{const row=this.warehouse(order,w);this.db.prepare("DELETE FROM edit_source_holds WHERE order_id=? AND warehouse_id=? AND owner='external' AND handle=?").run(order,w,handle);this.#warehouseSave(order,w,row);});}
 fixtureOrder(resource:string,patch:Row){return this.#tx(()=>{const o={...this.order(resource),...jsonValue(patch)};o.version=this.order(resource).version+1;this.#put('edit_source_orders',resource,o);return o;});}
 fixtureStock(variant:string,stock:number){integer(stock);const v=this.catalog(variant);v.stock=stock;this.#put('edit_source_catalog',variant,v);}
 #calculate(o:Row,c:Row){const next=structuredClone(o),i=c.intent;
  if(i.kind==='address'){const a=editAddress(i.address);if(a.country!==o.address.country||a.state!==o.address.state||a.postal.slice(0,3)!==o.address.postal.slice(0,3))throw new Error('EDIT_TAX_SHIPPING_UNQUALIFIED');next.address=a;}
  if(i.kind==='item'){const l=next.lines.find((x:Row)=>x.id===i.line_id),v=this.catalog(i.variant_id);if(!l||!['unfulfilled','held'].includes(l.status)||l.subscription||!v.available||v.excluded||v.subscription||v.product_id!==l.product_id||v.currency!==o.currency||v.tax_bps!==l.tax_bps)throw new Error('EDIT_VARIANT_UNSUPPORTED');
   if(v.stock-c.stock_buffer<l.quantity)throw new Error('EDIT_STOCK_UNAVAILABLE');const net=editMinor(v.unit_minor)*BigInt(l.quantity)-editMinor(l.discount_minor);if(net<0n)throw new Error('EDIT_DISCOUNT_UNSUPPORTED');const tax=net*BigInt(v.tax_bps);if(tax%10000n!==0n)throw new Error('EDIT_TAX_ROUNDING_UNQUALIFIED');l.variant_id=v.id;l.unit_minor=v.unit_minor;l.tax_minor=(tax/10000n).toString();}
  if(i.kind==='cancel')for(const line of next.lines)if(c.line_ids.includes(line.id)){if(!['unfulfilled','held'].includes(line.status))throw new Error('EDIT_LINE_IRREVERSIBLE');line.status='cancelled';}
  const total=orderValue(next),delta=total-orderValue(o);if(total.toString()!==c.new_total_minor||delta.toString()!==c.delta_minor)throw new Error('EDIT_NATIVE_TOTAL_CHANGED');
  next.total_minor=total.toString();next.version=o.version+1;next.balance_due_minor=(total>editMinor(o.net_paid_minor)?total-editMinor(o.net_paid_minor):0n).toString();next.financial_state=next.balance_due_minor==='0'?'paid':'partially_paid';next.cancelled=next.lines.every((l:Row)=>['cancelled','shipped'].includes(l.status))&&i.kind==='cancel';return next;
 }
 #guard(c:Row,o:Row){if(c.source_identity!==this.identity||c.tenant_id!==this.tenant||c.store_id!==this.store)throw new Error('EDIT_SOURCE_MISMATCH');if(c.source_revision!==this.revision())throw new Error('EDIT_READINESS_CHANGED');if(o.customer_id!==c.customer_id)throw new Error('EDIT_CUSTOMER_CHANGED');}
 #held(c:Row,o:Row,reason='edit'){for(const w of c.warehouse_ids){const row=this.warehouse(o.resource_id,w);if(this.#mode(w)!=='qualified'||row.stage!=='unfulfilled'||!row.holds.some((h:Row)=>h.owner==='rifare'&&h.handle===c.edit_id&&h.reason===reason))throw new Error('EDIT_HOLD_UNCONFIRMED');}}
 #run(c:Row){const o=this.order(c.resource_id);this.#guard(c,o);let result:Row={stage:c.stage,order_id:o.resource_id,edit_id:c.edit_id,source_identity:this.identity};
  if(c.stage.startsWith('hold:')){if(o.version!==c.original_version||contentDigest(safeOrder(o))!==c.original_digest)throw new Error('EDIT_SOURCE_CHANGED');for(const id of c.line_ids){const l=o.lines.find((l:Row)=>l.id===id);if(!l||!['unfulfilled','held'].includes(l.status))throw new Error('EDIT_LINE_IRREVERSIBLE');}const [,reason,w]=c.stage.split(':');const ok=this.#addHold(o.resource_id,w,'rifare',c.edit_id,reason);if(!ok)throw new Error('EDIT_HOLD_UNCONFIRMED');return {...result,acknowledged:true,warehouse_id:w,reason,version:o.version};}
  if(['begin','change','commit'].includes(c.stage)){
   if(o.version!==c.original_version||contentDigest(safeOrder(o))!==c.original_digest)throw new Error('EDIT_SOURCE_CHANGED');if(this.clock()>=c.commit_deadline)throw new Error('EDIT_WINDOW_CLOSED');this.#held(c,o);
   if(c.stage==='begin'){this.db.prepare('INSERT INTO edit_source_calculated VALUES(?,?,?,NULL,NULL)').run(c.edit_id,o.resource_id,o.version);return {...result,calculated_id:c.edit_id,version:o.version};}
   const row=this.db.prepare('SELECT * FROM edit_source_calculated WHERE edit_id=?').get(c.edit_id) as Row;if(!row||row.original_version!==o.version)throw new Error('EDIT_SESSION_MISSING');
   const next=this.#calculate(o,c);
   if(c.stage==='change'){this.db.prepare('UPDATE edit_source_calculated SET body=?,digest=? WHERE edit_id=?').run(canonical(next),contentDigest(next),c.edit_id);return {...result,calculated_digest:contentDigest(safeOrder(next)),version:next.version,total_minor:next.total_minor};}
   if(!row.body||row.digest!==contentDigest(next))throw new Error('EDIT_CALCULATION_CHANGED');
   if(editMinor(next.balance_due_minor)>0n)this.#held(c,o,'payment');
   if(c.intent.kind==='item'){const old=o.lines.find((l:Row)=>l.id===c.intent.line_id),v=this.catalog(c.intent.variant_id);v.stock-=old.quantity;this.#put('edit_source_catalog',v.id,v);const prev=this.catalog(old.variant_id);prev.stock+=old.quantity;this.#put('edit_source_catalog',prev.id,prev);}
   if(c.intent.kind==='cancel')for(const line of o.lines)if(c.line_ids.includes(line.id)){const v=this.catalog(line.variant_id);v.stock+=line.quantity;this.#put('edit_source_catalog',v.id,v);}
   this.#put('edit_source_orders',o.resource_id,next);return {...result,version:next.version,order_digest:contentDigest(safeOrder(next)),total_minor:next.total_minor,delta_minor:c.delta_minor,line_mapping:next.lines.map((l:Row)=>({original:l.id,current:l.id,variant:l.variant_id})),cancelled:next.cancelled};
  }
  if(o.version!==c.final_version)throw new Error('EDIT_FINAL_VERSION_CHANGED');
  if(c.stage==='invoice'||c.stage==='refund'){
   this.#held(c,o);const amount=(BigInt(c.delta_minor)<0n?-BigInt(c.delta_minor):BigInt(c.delta_minor)).toString();if(amount==='0')throw new Error('EDIT_BALANCE_INVALID');
   if(c.stage==='invoice'&&o.balance_due_minor!==amount)throw new Error('EDIT_BALANCE_INVALID');
   if(c.stage==='refund'&&(editMinor(o.net_paid_minor)<editMinor(o.total_minor)+editMinor(amount)))throw new Error('EDIT_REFUND_BALANCE');
   const value={id:'finance_'+c.edit_id,edit_id:c.edit_id,order_id:o.resource_id,order_version:o.version,source_identity:this.identity,customer_id:o.customer_id,currency:o.currency,amount_minor:amount,paid_minor:'0',state:c.stage==='invoice'?'unpaid':'accepted',kind:c.stage,version:1,expires_at:this.clock()+c.payment_ttl_ms,method:'fixture',settled:false};
   this.db.prepare('INSERT INTO edit_source_finance VALUES(?,?,?,?,?,?)').run(c.edit_id,o.resource_id,1,c.stage,canonical(value),contentDigest(value));return {...result,finance:value};
  }
  if(c.stage.startsWith('sync:')){const w=c.stage.split(':')[1];this.#held(c,o);const row=this.warehouse(o.resource_id,w);row.ack_version=o.version;row.ack_digest=contentDigest(safeOrder(o));row.final_variant_ids=o.lines.filter((l:Row)=>l.warehouse_id===w&&l.status!=='cancelled').map((l:Row)=>l.variant_id);if(c.intent.kind==='cancel')row.cancelled=o.lines.filter((l:Row)=>l.warehouse_id===w).every((l:Row)=>['cancelled','shipped'].includes(l.status));this.#warehouseSave(o.resource_id,w,row);return {...result,warehouse_id:w,ack_version:o.version,ack_digest:row.ack_digest,cancelled:row.cancelled};}
  if(c.stage.startsWith('release:')){const [,reason,w]=c.stage.split(':'),row=this.warehouse(o.resource_id,w);if(row.revision!==c.warehouse_revision)throw new Error('EDIT_WAREHOUSE_CHANGED');
   if(row.ack_version!==o.version||row.ack_digest!==contentDigest(safeOrder(o)))throw new Error('EDIT_WAREHOUSE_STALE');
   if(o.balance_due_minor!=='0')throw new Error('EDIT_PAYMENT_OUTSTANDING');
   const f=this.finance(c.edit_id);if(c.delta_minor!=='0'&&(!f||!f.settled||f.state!=='settled'||f.order_version!==o.version||f.currency!==o.currency||f.amount_minor!==(BigInt(c.delta_minor)<0n?-BigInt(c.delta_minor):BigInt(c.delta_minor)).toString()))throw new Error('EDIT_FINANCE_UNCONFIRMED');
   if(row.holds.some((h:Row)=>h.owner!=='rifare'||h.handle!==c.edit_id))throw new Error('EDIT_FOREIGN_HOLD');
   if(!['edit','payment','refund'].includes(reason))throw new Error('EDIT_HOLD_OWNERSHIP');
   const deleted=this.db.prepare("DELETE FROM edit_source_holds WHERE order_id=? AND warehouse_id=? AND owner='rifare' AND handle=? AND reason=?").run(o.resource_id,w,c.edit_id,reason);if(deleted.changes!==1)throw new Error('EDIT_HOLD_MISSING');this.#warehouseSave(o.resource_id,w,row);return {...result,warehouse_id:w,reason,released:true};
  }
  throw new Error('EDIT_STAGE_UNSUPPORTED');
 }
 async perform(input:Row){const c=jsonValue(input),hash=contentDigest(c);id(c.operation_id);if(c.source_identity!==this.identity||c.tenant_id!==this.tenant||c.store_id!==this.store)throw new Error('EDIT_SOURCE_MISMATCH');
  const fault=this.faultStage===null||c.stage===this.faultStage?this.fault:'none';if(fault==='hang')return new Promise<never>(()=>{});if(fault==='before'){this.fault='none';throw new Error('EDIT_SOURCE_UNAVAILABLE');}
  const result=this.#tx(()=>{const old=this.db.prepare('SELECT * FROM edit_source_effects WHERE operation_id=?').get(c.operation_id) as Row;if(old){if(old.command_digest!==hash)throw new Error('EDIT_OPERATION_CONFLICT');return JSON.parse(old.result);}
   const value={...this.#run(c),operation_id:c.operation_id,command_digest:hash,qualification:'synthetic_only'};this.db.prepare('INSERT INTO edit_source_effects VALUES(?,?,?,?)').run(c.operation_id,hash,canonical(value),contentDigest(value));return value;});
  if(fault==='after'){this.fault='none';throw new Error('EDIT_SOURCE_RESPONSE_LOST');}return result;
 }
 lookup(operation:string){const r=this.db.prepare('SELECT * FROM edit_source_effects WHERE operation_id=?').get(id(operation)) as Row;if(!r)return null;const b=JSON.parse(r.result);if(contentDigest(b)!==r.result_digest)throw new Error('EDIT_SOURCE_INTEGRITY');return b;}
 finance(edit:string){const r=this.db.prepare('SELECT * FROM edit_source_finance WHERE edit_id=?').get(id(edit)) as Row;if(!r)return null;const b=JSON.parse(r.body);if(contentDigest(b)!==r.digest)throw new Error('EDIT_SOURCE_INTEGRITY');if(b.kind==='invoice'&&b.state==='unpaid'&&b.expires_at<=this.clock())return {...b,state:'expired'};return b;}
 settle(edit:string,input:Row={state:'settled',paid_minor:null}){return this.#tx(()=>{const r=this.db.prepare('SELECT * FROM edit_source_finance WHERE edit_id=?').get(id(edit)) as Row;if(!r)throw new Error('NOT_FOUND');const b=JSON.parse(r.body);if(b.settled)return b;
  exact(input,['state','paid_minor']);if(!['unpaid','partial','failed','settled'].includes(input.state))throw new Error('INVALID_INPUT');const amount=input.paid_minor===null?b.amount_minor:input.paid_minor;editMinor(amount);
  if(BigInt(amount)>BigInt(b.amount_minor)||(input.state==='settled'&&amount!==b.amount_minor))throw new Error('EDIT_PAYMENT_MISMATCH');
  if(input.state==='settled'){const o=this.order(b.order_id);if(o.version!==b.order_version)throw new Error('EDIT_PAYMENT_VERSION_CHANGED');const paid=editMinor(o.net_paid_minor)+(b.kind==='invoice'?1n:-1n)*editMinor(amount);if(paid<0n)throw new Error('EDIT_REFUND_BALANCE');o.net_paid_minor=paid.toString();o.balance_due_minor=(editMinor(o.total_minor)>paid?editMinor(o.total_minor)-paid:0n).toString();o.financial_state=o.balance_due_minor==='0'?'paid':'partially_paid';this.#put('edit_source_orders',o.resource_id,o);}
  b.state=input.state;b.settled=input.state==='settled';b.paid_minor=['partial','settled'].includes(input.state)?amount:'0';b.version++;this.db.prepare('UPDATE edit_source_finance SET version=?,body=?,digest=? WHERE edit_id=?').run(b.version,canonical(b),contentDigest(b),edit);return b;
 });}
}
