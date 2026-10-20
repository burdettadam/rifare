import type {DatabaseSync} from 'node:sqlite';
import {exact,id,integer} from '../commerce/kernel.mts';
import type {Row} from '../commerce/kernel.mts';
import {canonical,contentDigest,jsonValue} from '../commerce/configuration-values.mts';
import {loyaltyBinding} from '../commerce/loyalty-values.mts';
import {LoyaltyFixtureSource} from './loyalty-fixture-source.mts';

export const LOYALTY_ACCRUAL_SOURCE='rifare-loyalty-accrual-fixture-v1';
export class LoyaltyAccrualScopeError extends Error {constructor(){super('LOYALTY_SCOPE_MISMATCH');}}
const RULE_FIELDS=['revision','currency','minor_per_point','eligibility','rounding','retained_fees','store_credit'];
const PIN_FIELDS=['resource_id','customer_id','financial_source_identity','original_digest','rules_revision'];
const META=['schema_version','source_identity','tenant_id','store_id','account_id','qualification'];
const hash=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function rules(value:unknown) {
  const p=exact(jsonValue(value,4096),RULE_FIELDS);integer(p.revision,1);
  if(typeof p.currency!=='string'||!/^[A-Z]{3}$/.test(p.currency)||typeof p.minor_per_point!=='string'||!/^[1-9][0-9]{0,23}$/.test(p.minor_per_point)||
    p.eligibility!=='original_paid_total_v1'||p.rounding!=='floor_cumulative_per_original_unit_v1'||p.retained_fees!=='remain_eligible'||p.store_credit!=='unsupported')
    throw new Error('LOYALTY_ACCRUAL_RULES_INVALID');
  return p;
}
function pin(value:unknown) {
  const p=exact(jsonValue(value,4096),PIN_FIELDS);
  for(const key of ['resource_id','customer_id','financial_source_identity'])id(p[key]);
  integer(p.rules_revision,1);if(!hash(p.original_digest))throw new Error('LOYALTY_ACCRUAL_PIN_INVALID');return p;
}

/** Historical invented rules/pins only; never a points effect or a core cache. */
export class LoyaltyAccrualFixtureSource {
  readonly source:LoyaltyFixtureSource;readonly db:DatabaseSync;readonly tenant:string;readonly store:string;
  readonly account:string;readonly identity:string;readonly contract=LOYALTY_ACCRUAL_SOURCE;
  #binding:Row;#parent:Row;
  constructor(source:LoyaltyFixtureSource) {
    if(!(source instanceof LoyaltyFixtureSource))throw new Error('LOYALTY_SOURCE_OWNER_MISMATCH');
    this.source=source;this.db=source.db;this.tenant=source.tenant;this.store=source.store;this.account=source.account;
    this.#parent=Object.freeze(loyaltyBinding({tenant_id:source.tenant,store_id:source.store,account_id:source.account,provider:source.provider}));
    this.identity=contentDigest({source_contract:this.contract,balance_source_identity:source.identity});
    this.#binding=Object.freeze({source_contract:this.contract,source_identity:this.identity,balance_source_identity:source.identity,tenant_id:this.tenant,store_id:this.store,account_id:this.account});
    this.#parentIdentity();const db=this.db;db.exec('BEGIN IMMEDIATE');
    try {
      const existed=!!db.prepare("SELECT 1 FROM sqlite_master WHERE name='fixture_loyalty_accrual_identity'").get();
      db.exec(`CREATE TABLE IF NOT EXISTS fixture_loyalty_accrual_identity(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL,digest TEXT NOT NULL) STRICT;
        CREATE TABLE IF NOT EXISTS fixture_loyalty_accrual_rules(revision INTEGER PRIMARY KEY,body TEXT NOT NULL,digest TEXT NOT NULL) STRICT;
        CREATE TABLE IF NOT EXISTS fixture_loyalty_accrual_originals(resource_id TEXT PRIMARY KEY,customer_id TEXT NOT NULL,rules_revision INTEGER NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL) STRICT;`);
      if(!existed){
        if(db.prepare('SELECT 1 FROM fixture_loyalty_accrual_rules LIMIT 1').get()||db.prepare('SELECT 1 FROM fixture_loyalty_accrual_originals LIMIT 1').get())throw new LoyaltyAccrualScopeError();
        db.prepare('INSERT INTO fixture_loyalty_accrual_identity VALUES(1,?,?)').run(canonical(this.#binding),contentDigest(this.#binding));
      }
      this.#identity();db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    Object.freeze(this);
  }
  #parentIdentity() {
    const db=this.db;
    if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='commerce_migrations'").get())throw new Error('SEPARATE_LOYALTY_SOURCE_REQUIRED');
    const rows=db.prepare('SELECT * FROM fixture_loyalty_identity').all() as Row[];
    if(rows.length!==1||rows[0].id!==1)throw new LoyaltyAccrualScopeError();
    let body:Row;try{body=JSON.parse(rows[0].body);}catch{throw new LoyaltyAccrualScopeError();}
    if(canonical(body)!==canonical(this.#parent)||contentDigest(body)!==rows[0].digest||this.source.identity!==this.#parent.source_identity)throw new LoyaltyAccrualScopeError();
  }
  #identity() {
    this.#parentIdentity();const rows=this.db.prepare('SELECT * FROM fixture_loyalty_accrual_identity').all() as Row[];
    if(rows.length!==1||rows[0].id!==1)throw new LoyaltyAccrualScopeError();
    let body:Row;try{body=JSON.parse(rows[0].body);}catch{throw new LoyaltyAccrualScopeError();}
    if(canonical(body)!==canonical(this.#binding)||contentDigest(body)!==rows[0].digest)throw new LoyaltyAccrualScopeError();
  }
  #metadata() {return {schema_version:1,source_identity:this.identity,tenant_id:this.tenant,store_id:this.store,account_id:this.account,qualification:'synthetic_only'};}
  #body(row:Row,fields:string[],customer?:string) {
    const b=jsonValue(JSON.parse(row.body),8192);
    for(const key of ['source_identity','tenant_id','store_id','account_id'])if(b?.[key]!==this.#metadata()[key])throw new LoyaltyAccrualScopeError();
    if(customer!==undefined&&b.customer_id!==customer)throw new LoyaltyAccrualScopeError();
    exact(b,[...META,...fields]);
    if(b.schema_version!==1||b.qualification!=='synthetic_only'||contentDigest(b)!==row.digest)throw new Error('LOYALTY_ACCRUAL_SOURCE_INVALID');return b;
  }
  #rules(revision:number) {
    const row=this.db.prepare('SELECT * FROM fixture_loyalty_accrual_rules WHERE revision=?').get(revision) as Row|undefined;
    if(!row)throw new Error('LOYALTY_ACCRUAL_RULES_REQUIRED');
    const b=this.#body(row,['rules']);rules(b.rules);
    if(row.revision!==b.rules.revision||revision!==row.revision)throw new Error('LOYALTY_ACCRUAL_SOURCE_INVALID');return {...b,digest:row.digest};
  }
  publishRules(value:unknown) {
    const p=rules(value),body={...this.#metadata(),rules:p},digest=contentDigest(body),db=this.db;
    db.exec('BEGIN IMMEDIATE');try {
      this.#identity();const latest=db.prepare('SELECT revision FROM fixture_loyalty_accrual_rules ORDER BY revision DESC LIMIT 1').get() as Row|undefined;
      if(latest){const old=this.#rules(latest.revision);if(p.revision<latest.revision||p.revision===latest.revision&&digest!==old.digest)throw new Error('LOYALTY_ACCRUAL_RULES_IMMUTABLE');}
      if(!latest||p.revision>latest.revision)db.prepare('INSERT INTO fixture_loyalty_accrual_rules VALUES(?,?,?)').run(p.revision,canonical(body),digest);
      db.exec('COMMIT');return {...body,digest};
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  pinOriginal(value:unknown) {
    const p=pin(value),body={...this.#metadata(),...p},digest=contentDigest(body),db=this.db;
    db.exec('BEGIN IMMEDIATE');try {
      this.#identity();this.#rules(p.rules_revision);const old=this.readOriginal(p.resource_id,p.customer_id);
      if(old&&old.pin.digest!==digest)throw new Error('LOYALTY_ACCRUAL_PIN_IMMUTABLE');
      if(!old)db.prepare('INSERT INTO fixture_loyalty_accrual_originals VALUES(?,?,?,?,?)').run(p.resource_id,p.customer_id,p.rules_revision,canonical(body),digest);
      db.exec('COMMIT');return {...body,digest};
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  readOriginal(resource:string,customer:string) {
    id(resource);id(customer);this.#identity();
    const row=this.db.prepare('SELECT * FROM fixture_loyalty_accrual_originals WHERE resource_id=?').get(resource) as Row|undefined;
    if(!row)return null;
    if(row.customer_id!==customer)throw new LoyaltyAccrualScopeError();
    const b=this.#body(row,PIN_FIELDS,customer);pin(Object.fromEntries(PIN_FIELDS.map(key=>[key,b[key]])));
    if(row.resource_id!==b.resource_id||row.rules_revision!==b.rules_revision)throw new Error('LOYALTY_ACCRUAL_SOURCE_INVALID');
    return {pin:{...b,digest:row.digest},rules:this.#rules(b.rules_revision)};
  }
}
