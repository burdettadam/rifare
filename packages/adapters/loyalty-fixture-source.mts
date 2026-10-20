import {DatabaseSync} from 'node:sqlite';
import {statSync} from 'node:fs';
import {id} from '../commerce/kernel.mts';
import type {Row} from '../commerce/kernel.mts';
import {canonical,contentDigest} from '../commerce/configuration-values.mts';
import {LOYALTY_CONTRACT,LoyaltyScopeError,loyaltyConfig,loyaltyBinding,loyaltyCapabilities,loyaltySnapshot,loyaltyEnvelope} from '../commerce/loyalty-values.mts';

function fixtureDatabase(db:DatabaseSync) {
  if(!(db instanceof DatabaseSync)||db.prepare("SELECT 1 FROM sqlite_master WHERE name='commerce_migrations'").get())
    throw new Error('SEPARATE_LOYALTY_SOURCE_REQUIRED');
}
export function assertSeparateLoyaltyDatabases(a:DatabaseSync,b:DatabaseSync) {
  fixtureDatabase(b);
  const path=(db:DatabaseSync)=>(db.prepare('PRAGMA database_list').all() as Row[]).find(row=>row.name==='main')?.file;
  const first=path(a),second=path(b);
  if(a===b||first&&first===second)throw new Error('SEPARATE_LOYALTY_SOURCE_REQUIRED');
  if(first&&second){const x=statSync(first,{bigint:true}),y=statSync(second,{bigint:true});
    if(x.dev===y.dev&&x.ino===y.ino)throw new Error('SEPARATE_LOYALTY_SOURCE_REQUIRED');}
}

/** Disposable synthetic source: immutable observations, no points effect methods. */
export class LoyaltyFixtureSource {
  readonly db:DatabaseSync;readonly tenant:string;readonly store:string;readonly account:string;
  readonly provider:string;readonly identity:string;readonly contract=LOYALTY_CONTRACT;
  #binding:Row;
  constructor(db:DatabaseSync,config:unknown,clock:()=>number=Date.now) {
    const p=loyaltyConfig(config);fixtureDatabase(db);
    if(typeof clock!=='function')throw new Error('LOYALTY_CLOCK_INVALID');
    this.db=db;this.tenant=p.tenant_id;this.store=p.store_id;this.account=p.account_id;this.provider=p.provider;
    this.#binding=Object.freeze(loyaltyBinding(p));this.identity=this.#binding.source_identity;
    db.exec('PRAGMA busy_timeout=3000; BEGIN IMMEDIATE');
    try {
      const existed=!!db.prepare("SELECT 1 FROM sqlite_master WHERE name='fixture_loyalty_identity'").get();
      db.exec(`CREATE TABLE IF NOT EXISTS fixture_loyalty_identity(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL,digest TEXT NOT NULL) STRICT;
        CREATE TABLE IF NOT EXISTS fixture_loyalty_snapshots(customer_id TEXT NOT NULL,source_revision INTEGER NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(customer_id,source_revision)) STRICT;`);
      if(!existed){
        if(db.prepare('SELECT 1 FROM fixture_loyalty_snapshots LIMIT 1').get())throw new LoyaltyScopeError();
        db.prepare('INSERT INTO fixture_loyalty_identity VALUES(1,?,?)').run(canonical(this.#binding),contentDigest(this.#binding));
      }
      this.#assertIdentity();db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    Object.freeze(this);
  }
  #assertIdentity() {
    fixtureDatabase(this.db);
    const rows=this.db.prepare('SELECT * FROM fixture_loyalty_identity').all() as Row[];
    if(rows.length!==1||rows[0].id!==1)throw new LoyaltyScopeError();
    let body:Row;try{body=JSON.parse(rows[0].body);}catch{throw new LoyaltyScopeError();}
    if(canonical(body)!==canonical(this.#binding)||contentDigest(body)!==rows[0].digest)throw new LoyaltyScopeError();
  }
  #observe(customer:string) {
    const row=this.db.prepare('SELECT * FROM fixture_loyalty_snapshots WHERE customer_id=? ORDER BY source_revision DESC LIMIT 1').get(customer) as Row|undefined;
    if(!row)return null;
    const parsed=JSON.parse(row.body);
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||Object.hasOwn(parsed,'digest'))throw new Error('LOYALTY_SOURCE_INVALID');
    const body=loyaltyEnvelope({...parsed,digest:row.digest},this.#binding,customer);
    if(row.customer_id!==body.customer_id)throw new LoyaltyScopeError();
    if(row.source_revision!==body.source_revision)throw new Error('LOYALTY_SOURCE_INVALID');
    return body;
  }
  publish(value:unknown) {
    const p=loyaltySnapshot(value),body={schema_version:1,...this.#binding,qualification:'synthetic_only',capabilities:loyaltyCapabilities(this.provider),...p};
    const digest=contentDigest(body),db=this.db;
    db.exec('BEGIN IMMEDIATE');
    try {
      this.#assertIdentity();const previous=this.#observe(p.customer_id);
      if(previous){
        if(p.source_revision<previous.source_revision||p.source_revision===previous.source_revision&&digest!==previous.digest)
          throw new Error('LOYALTY_SOURCE_REVISION_CONFLICT');
        if(p.rules.revision<previous.rules.revision||p.rules.revision===previous.rules.revision&&contentDigest(p.rules)!==contentDigest(previous.rules))
          throw new Error('LOYALTY_RULES_REVISION_CONFLICT');
      }
      if(!previous||p.source_revision>previous.source_revision)
        db.prepare('INSERT INTO fixture_loyalty_snapshots VALUES(?,?,?,?)').run(p.customer_id,p.source_revision,canonical(body),digest);
      db.exec('COMMIT');return {...body,digest};
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  observe(customer:string) {
    id(customer);this.#assertIdentity();return this.#observe(customer);
  }
}
