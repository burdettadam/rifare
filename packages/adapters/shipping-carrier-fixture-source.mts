import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { exact,id,integer } from '../commerce/kernel.mts';
import type { Row } from '../commerce/kernel.mts';
import { canonical,contentDigest,jsonValue } from '../commerce/configuration-values.mts';
import { money } from '../commerce/money.mts';
import { CarrierQuoteFixtureSource } from './carrier-quote-fixture-source.mts';

type Fault='before'|'after'|'malformed'|'hang';
const ref=(prefix:string,value:unknown)=>prefix+'_'+contentDigest(value).slice(0,36);
const same=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
/** Independent, durable synthetic carrier ledger. No endpoint, credential or network API. */
export class ShippingCarrierFixtureSource {
  readonly db:DatabaseSync;readonly tenant_id:string;readonly store_id:string;readonly identity:string;
  readonly qualification='synthetic_only';readonly contract='rifare-outbound-carrier-fixture-v1';
  readonly calls={purchase:[] as string[],void:[] as string[],lookup:[] as string[],manifest:[] as string[],manifest_lookup:[] as string[]};
  #clock:()=>number;#quotes:CarrierQuoteFixtureSource|undefined;#faults=new Map<string,Fault>();
  constructor(db:DatabaseSync,options:{mode:'fixture';tenant_id:string;store_id:string;identity:string;quote_source?:CarrierQuoteFixtureSource;clock?:()=>number}){
    if(options.mode!=='fixture'||Object.keys(options).some(k=>!['mode','tenant_id','store_id','identity','quote_source','clock'].includes(k)))throw new Error('SYNTHETIC_SOURCE_REQUIRED');
    this.db=db;this.tenant_id=id(options.tenant_id);this.store_id=id(options.store_id);id(options.identity);this.#clock=options.clock??Date.now;
    if(options.quote_source&&(!(options.quote_source instanceof CarrierQuoteFixtureSource)||options.quote_source.tenant_id!==this.tenant_id||options.quote_source.store_id!==this.store_id))throw new Error('SOURCE_SCOPE_MISMATCH');
    this.#quotes=options.quote_source;
    db.exec(`PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS fixture_shipping_identity(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,store_id TEXT NOT NULL,label TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS fixture_shipping_purchases(purchase_id TEXT PRIMARY KEY,package_id TEXT NOT NULL UNIQUE,body TEXT NOT NULL,digest TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS fixture_shipping_voids(void_id TEXT PRIMARY KEY,purchase_id TEXT NOT NULL UNIQUE,body TEXT NOT NULL,digest TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS fixture_shipping_manifests(manifest_id TEXT PRIMARY KEY,body TEXT NOT NULL,digest TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS fixture_shipping_members(package_id TEXT PRIMARY KEY,manifest_id TEXT NOT NULL,label_id TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS fixture_shipping_events(event_id TEXT PRIMARY KEY,package_id TEXT NOT NULL,sequence INTEGER NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL,UNIQUE(package_id,sequence)) STRICT;`);
    this.identity=this.#tx(()=>{let r=db.prepare('SELECT * FROM fixture_shipping_identity').get() as Row;
      if(!r){r={id:'outbound_source_'+randomUUID().replaceAll('-',''),tenant_id:this.tenant_id,store_id:this.store_id,label:options.identity};db.prepare('INSERT INTO fixture_shipping_identity VALUES(?,?,?,?)').run(r.id,r.tenant_id,r.store_id,r.label);}
      if(r.tenant_id!==this.tenant_id||r.store_id!==this.store_id||r.label!==options.identity)throw new Error('SOURCE_SCOPE_MISMATCH');return r.id;});
  }
  #tx<T>(fn:()=>T):T{this.db.exec('BEGIN IMMEDIATE');try{const r=fn();this.db.exec('COMMIT');return r;}catch(e){this.db.exec('ROLLBACK');throw e;}}
  #body(row:Row|undefined):Row|null {if(!row)return null;const b=JSON.parse(row.body);if(contentDigest(b)!==row.digest)throw new Error('SOURCE_INTEGRITY');return b;}
  #bound(command:Row){if(command.source_identity!==this.identity||command.tenant_id!==this.tenant_id||command.store_id!==this.store_id)throw new Error('SOURCE_SCOPE_MISMATCH');}
  #purchase(ref:string){return this.#body(this.db.prepare('SELECT * FROM fixture_shipping_purchases WHERE purchase_id=?').get(id(ref)) as Row);}
  #savePurchase(body:Row){this.db.prepare('UPDATE fixture_shipping_purchases SET body=?,digest=? WHERE purchase_id=?').run(canonical(body),contentDigest(body),body.command.purchase_id);}
  #readPurchase(ref:string){const b=this.#purchase(ref);if(!b)return null;
    if(b.receipt.command_digest!==contentDigest(b.command)||b.receipt.purchase_id!==ref||b.receipt.amount_minor!==b.command.quote.amount_minor||b.receipt.currency!==b.command.quote.currency)throw new Error('SOURCE_INTEGRITY');
    return jsonValue(b.receipt);}
  setFault(kind:'purchase'|'void'|'manifest',key:string,fault:Fault){id(key);if(!['purchase','void','manifest'].includes(kind)||!['before','after','malformed','hang'].includes(fault))throw new Error('INVALID_INPUT');this.#faults.set(kind+':'+key,fault);}
  async #call(kind:string,key:string,fn:()=>Row):Promise<Row>{const fault=this.#faults.get(kind+':'+key);this.#faults.delete(kind+':'+key);
    if(fault==='before')throw new Error('FIXTURE_RESPONSE_UNKNOWN');if(fault==='hang')return new Promise(()=>{});
    const r=fn();if(fault==='after')throw new Error('FIXTURE_RESPONSE_LOST');return fault==='malformed'?{success:true}:r;}
  currentParcel(packageId:string){return this.#quotes?.package(id(packageId))??null;}
  accountCurrent(quote:Row){const account=this.#quotes?.account(id(quote.account_id));
    return !!account&&account.enabled===true&&this.#quotes!.identity===quote.source_identity&&quote.tenant_id===this.tenant_id&&quote.store_id===this.store_id
      &&account.revision===quote.account_revision&&contentDigest(account)===quote.account_digest&&account.carrier_id===quote.carrier_id
      &&account.services.includes(quote.service)&&account.currencies.includes(quote.currency);}
  #quote(command:Row){const q=command.quote;this.#bound(command);
    exact(command,['version','kind','tenant_id','store_id','resource_id','package_id','purchase_id','source_identity','quote_source_identity','quote']);
    if(command.version!==1||command.kind!=='outbound_label'||!this.#quotes||command.quote_source_identity!==this.#quotes.identity||q.source_identity!==this.#quotes.identity)throw new Error('QUOTE_SOURCE_REQUIRED');
    for(const key of ['resource_id','package_id','purchase_id'])id(command[key]);money(q.currency,q.amount_minor);
    if(q.tenant_id!==this.tenant_id||q.store_id!==this.store_id||q.package_id!==command.package_id||q.resource_id!==command.resource_id||q.expires_at<=this.#clock())throw new Error('QUOTE_EXPIRED');
    const parcel=this.#quotes.package(command.package_id),account=this.#quotes.account(q.account_id),rate=this.#quotes.rate(command.package_id,q.account_id,q.service);
    if(!parcel||parcel.resource_id!==command.resource_id||contentDigest(parcel)!==q.parcel_digest)throw new Error('PACKAGE_CHANGED');
    if(!account?.enabled||contentDigest(account)!==q.account_digest||!account.services.includes(q.service)||!account.currencies.includes(q.currency))throw new Error('ACCOUNT_CHANGED');
    if(!rate||rate.rate_digest!==q.rate_digest||rate.amount_minor!==q.amount_minor||rate.currency!==q.currency||rate.expires_at<=this.#clock())throw new Error('RATE_CHANGED');
  }
  async purchase(input:unknown){const command=jsonValue(input);this.#bound(command);id(command.purchase_id);id(command.package_id);this.calls.purchase.push(command.purchase_id);
    return this.#call('purchase',command.package_id,()=>this.#tx(()=>{
      const prior=this.#purchase(command.purchase_id);if(prior){if(!same(prior.command,command))throw new Error('PURCHASE_ID_CONFLICT');return this.#readPurchase(command.purchase_id)!;}
      if(this.db.prepare('SELECT 1 FROM fixture_shipping_purchases WHERE package_id=?').get(command.package_id))throw new Error('PACKAGE_ALREADY_CHARGED');
      this.#quote(command);const q=command.quote,now=integer(this.#clock());
      const receipt={version:1,purchase_id:command.purchase_id,source_identity:this.identity,tenant_id:this.tenant_id,store_id:this.store_id,resource_id:command.resource_id,package_id:command.package_id,
        command_digest:contentDigest(command),native_label_id:ref('label',command.purchase_id),native_charge_id:ref('charge',command.purchase_id),native_tracking_ref:ref('tracking',command.purchase_id),
        amount_minor:q.amount_minor,currency:q.currency,source_revision:1,created_at:now,valid_until:now+86400000,void_operation_id:null,void_state:'not_requested',refund_state:'not_requested',refund_amount_minor:'0',native_refund_id:null,qualification:'synthetic_only'};
      const body={command,receipt};this.db.prepare('INSERT INTO fixture_shipping_purchases VALUES(?,?,?,?)').run(command.purchase_id,command.package_id,canonical(body),contentDigest(body));return receipt;
    }));
  }
  async lookup(purchaseId:string){this.calls.lookup.push(id(purchaseId));return this.#readPurchase(purchaseId);}
  async requestVoid(input:unknown){const c=exact(jsonValue(input),['version','kind','tenant_id','store_id','source_identity','resource_id','package_id','purchase_id','void_id','native_label_id','native_charge_id']);
    this.#bound(c);if(c.version!==1||c.kind!=='outbound_void')throw new Error('INVALID_INPUT');for(const key of ['resource_id','package_id','purchase_id','void_id','native_label_id','native_charge_id'])id(c[key]);this.calls.void.push(c.void_id);
    return this.#call('void',c.package_id,()=>this.#tx(()=>{
      const prior=this.#body(this.db.prepare('SELECT * FROM fixture_shipping_voids WHERE void_id=?').get(c.void_id) as Row);
      if(prior){if(!same(prior,c))throw new Error('VOID_ID_CONFLICT');return this.#readPurchase(c.purchase_id)!;}
      const p=this.#purchase(c.purchase_id),r=p?.receipt;if(!p||r.package_id!==c.package_id||r.resource_id!==c.resource_id||r.native_label_id!==c.native_label_id||r.native_charge_id!==c.native_charge_id||r.void_state!=='not_requested')throw new Error('VOID_UNAVAILABLE');
      if(this.db.prepare('SELECT 1 FROM fixture_shipping_members WHERE package_id=?').get(c.package_id))throw new Error('LABEL_ALREADY_MANIFESTED');
      this.db.prepare('INSERT INTO fixture_shipping_voids VALUES(?,?,?,?)').run(c.void_id,c.purchase_id,canonical(c),contentDigest(c));
      r.void_operation_id=c.void_id;r.void_state='requested';r.refund_state='pending';r.source_revision++;this.#savePurchase(p);return jsonValue(r);
    }));
  }
  confirmVoid(purchaseId:string,confirmed:boolean){if(typeof confirmed!=='boolean')throw new Error('INVALID_INPUT');return this.#tx(()=>{const p=this.#purchase(purchaseId),r=p?.receipt;
    if(!p||r.void_state!=='requested')throw new Error('VOID_NOT_REQUESTED');r.void_state=confirmed?'confirmed':'rejected';r.refund_state=confirmed?'pending':'rejected';r.source_revision++;this.#savePurchase(p);return jsonValue(r);});}
  refund(purchaseId:string){return this.#tx(()=>{const p=this.#purchase(purchaseId),r=p?.receipt;if(!p||r.void_state!=='confirmed')throw new Error('VOID_NOT_CONFIRMED');
    if(r.refund_state==='refunded')return jsonValue(r);r.refund_state='refunded';r.refund_amount_minor=r.amount_minor;r.native_refund_id=ref('refund',purchaseId);r.source_revision++;this.#savePurchase(p);return jsonValue(r);});}
  #manifest(manifestId:string){return this.#body(this.db.prepare('SELECT * FROM fixture_shipping_manifests WHERE manifest_id=?').get(id(manifestId)) as Row);}
  async manifest(input:unknown){const c=exact(jsonValue(input),['version','kind','tenant_id','store_id','source_identity','manifest_id','membership_digest','packages']);
    this.#bound(c);id(c.manifest_id);if(c.version!==1||c.kind!=='outbound_manifest'||!Array.isArray(c.packages)||!c.packages.length||c.packages.length>32||contentDigest(c.packages)!==c.membership_digest)throw new Error('INVALID_MANIFEST');
    this.calls.manifest.push(c.manifest_id);return this.#call('manifest',c.manifest_id,()=>this.#tx(()=>{
      const old=this.#manifest(c.manifest_id);if(old){if(!same(old.command,c))throw new Error('MANIFEST_ID_CONFLICT');return jsonValue(old.receipt);}
      const seen=new Set(),accounts=new Set();for(const m of c.packages){exact(m,['package_id','resource_id','purchase_id','native_label_id','packing_confirmation_id','packing_revision','packing_digest','package_revision']);
        for(const key of ['package_id','resource_id','purchase_id','native_label_id','packing_confirmation_id'])id(m[key]);integer(m.packing_revision,1);integer(m.package_revision,1);
        if(seen.has(m.package_id))throw new Error('INVALID_MANIFEST');seen.add(m.package_id);
        const p=this.#purchase(m.purchase_id),r=p?.receipt;if(!p||r.package_id!==m.package_id||r.resource_id!==m.resource_id||r.native_label_id!==m.native_label_id||r.void_state!=='not_requested'||r.valid_until<=this.#clock())throw new Error('LABEL_UNQUALIFIED');
        if(!this.accountCurrent(p.command.quote))throw new Error('ACCOUNT_CHANGED');
        const parcel=this.currentParcel(m.package_id);if(!parcel||contentDigest(parcel)!==p.command.quote.parcel_digest||m.package_revision!==parcel.revision)throw new Error('PACKAGE_CHANGED');
        if(this.db.prepare('SELECT 1 FROM fixture_shipping_members WHERE package_id=?').get(m.package_id))throw new Error('PACKAGE_ALREADY_MANIFESTED');accounts.add(p.command.quote.account_id+':'+p.command.quote.carrier_id);
      }
      if(accounts.size!==1)throw new Error('MANIFEST_CARRIER_MISMATCH');
      const receipt={version:1,manifest_id:c.manifest_id,source_identity:this.identity,tenant_id:this.tenant_id,store_id:this.store_id,membership_digest:c.membership_digest,
        native_manifest_id:ref('manifest',c.manifest_id),acknowledged_at:integer(this.#clock()),qualification:'synthetic_only'};
      const b={command:c,receipt};this.db.prepare('INSERT INTO fixture_shipping_manifests VALUES(?,?,?)').run(c.manifest_id,canonical(b),contentDigest(b));
      for(const p of c.packages)this.db.prepare('INSERT INTO fixture_shipping_members VALUES(?,?,?)').run(p.package_id,c.manifest_id,p.native_label_id);return receipt;
    }));
  }
  async lookupManifest(manifestId:string){this.calls.manifest_lookup.push(id(manifestId));return this.#manifest(manifestId)?.receipt??null;}
  recordEvent(input:unknown){const p=exact(jsonValue(input),['manifest_id','package_id','event_id','sequence','stage','at']);
    for(const key of ['manifest_id','package_id','event_id'])id(p[key]);integer(p.sequence,1);integer(p.at);
    if(!['pickup','carrier_acceptance','exception'].includes(p.stage)||p.at>this.#clock())throw new Error('INVALID_INPUT');
    return this.#tx(()=>{const old=this.#body(this.db.prepare('SELECT * FROM fixture_shipping_events WHERE event_id=?').get(p.event_id) as Row);
      const member=this.db.prepare('SELECT * FROM fixture_shipping_members WHERE package_id=? AND manifest_id=?').get(p.package_id,p.manifest_id) as Row;
      if(!member)throw new Error('MANIFEST_MEMBERSHIP_REQUIRED');const body={...p,source_identity:this.identity,tenant_id:this.tenant_id,store_id:this.store_id,native_label_id:member.label_id,qualification:'synthetic_only'};
      if(old){if(!same(old,body))throw new Error('EVENT_CONFLICT');return old;}
      const last=this.db.prepare('SELECT max(sequence) AS n FROM fixture_shipping_events WHERE package_id=?').get(p.package_id) as Row;if(p.sequence<=(last.n??0))throw new Error('EVENT_CONFLICT');
      this.db.prepare('INSERT INTO fixture_shipping_events VALUES(?,?,?,?,?)').run(p.event_id,p.package_id,p.sequence,canonical(body),contentDigest(body));return body;});
  }
  async events(manifestId:string){id(manifestId);return (this.db.prepare('SELECT * FROM fixture_shipping_events ORDER BY package_id,sequence').all() as Row[]).map(r=>this.#body(r)!).filter(r=>r.manifest_id===manifestId);}
  ledger(){const purchases=(this.db.prepare('SELECT purchase_id FROM fixture_shipping_purchases ORDER BY package_id').all() as Row[]).map(r=>this.#readPurchase(r.purchase_id)!);
    const sums=new Map<string,bigint>();for(const p of purchases)sums.set(p.currency,(sums.get(p.currency)??0n)+BigInt(p.amount_minor));
    return {purchases,totals:[...sums].sort(([a],[b])=>a.localeCompare(b)).map(([currency,amount])=>({currency,amount_minor:String(amount)})),
      manifests:(this.db.prepare('SELECT * FROM fixture_shipping_manifests ORDER BY manifest_id').all() as Row[]).map(r=>this.#body(r)!.receipt),
      events:(this.db.prepare('SELECT * FROM fixture_shipping_events ORDER BY package_id,sequence').all() as Row[]).map(r=>this.#body(r)),qualification:'synthetic_only',financial_effect:false};}
}
