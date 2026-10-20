import {DatabaseSync} from 'node:sqlite';
import {id,integer} from '../commerce/kernel.mts';
import type {Row} from '../commerce/kernel.mts';
import {canonical,contentDigest} from '../commerce/configuration-values.mts';
import {subjectHash} from '../commerce/data-guards.mts';
import {LoyaltyFixtureSource} from './loyalty-fixture-source.mts';
import {loyaltyBinding,loyaltyEnvelope,loyaltyFreshness} from '../commerce/loyalty-values.mts';
import {LOYALTY_REDEMPTION_CONTRACT,LOYALTY_REDEMPTION_LIMIT,REDEMPTION_BINDING_FIELDS,redemptionShape,redemptionHash,redemptionBinding,redemptionBound,redemptionAccount,redemptionBenefits,redemptionCatalog,redemptionCommand,redemptionResult,redemptionPoints,redemptionHistoryDigest} from '../commerce/loyalty-redemption-values.mts';

const MODES=['redeem','reject_insufficient','reject_unsupported','timeout_before_effect','timeout_after_effect'];
const ANCHOR_FIELDS=['schema_version',...REDEMPTION_BINDING_FIELDS,'account_key','subject_ref','customer_id','snapshot'];
const JOURNAL_FIELDS=['schema_version',...REDEMPTION_BINDING_FIELDS,'operation_id','account_key','seq','command','command_digest','result'];
function database(db:DatabaseSync) {
  if(!(db instanceof DatabaseSync)||db.prepare("SELECT 1 FROM sqlite_master WHERE name='commerce_migrations'").get())throw new Error('SEPARATE_LOYALTY_SOURCE_REQUIRED');
}

/** Disposable synthetic provider. Its journal and immutable G01 balance update
 * share one source transaction; core reservations live in a different database. */
export class LoyaltyRedemptionFixtureSource {
  readonly balanceSource:LoyaltyFixtureSource;readonly db:DatabaseSync;readonly tenant:string;readonly store:string;readonly account:string;readonly identity:string;readonly contract=LOYALTY_REDEMPTION_CONTRACT;
  #parent:Row;#binding:Row;#clock:()=>number;#mode='redeem';
  constructor(balanceSource:LoyaltyFixtureSource,clock:()=>number=Date.now) {
    if(!(balanceSource instanceof LoyaltyFixtureSource)||typeof clock!=='function')throw new Error('LOYALTY_SOURCE_OWNER_MISMATCH');
    database(balanceSource.db);this.balanceSource=balanceSource;this.db=balanceSource.db;this.tenant=balanceSource.tenant;this.store=balanceSource.store;this.account=balanceSource.account;this.#clock=clock;
    this.#parent=loyaltyBinding({tenant_id:this.tenant,store_id:this.store,account_id:this.account,provider:balanceSource.provider});this.#binding=redemptionBinding(this.#parent);this.identity=this.#binding.source_identity;
    this.#assertParent();const db=this.db;db.exec('BEGIN IMMEDIATE');
    try {
      const existed=!!db.prepare("SELECT 1 FROM sqlite_master WHERE name='fixture_loyalty_redemption_identity'").get();
      db.exec('CREATE TABLE IF NOT EXISTS fixture_loyalty_redemption_identity(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL,digest TEXT NOT NULL) STRICT;'+
        'CREATE TABLE IF NOT EXISTS fixture_loyalty_redemption_benefits(revision INTEGER PRIMARY KEY,body TEXT NOT NULL,digest TEXT NOT NULL) STRICT;'+
        'CREATE TABLE IF NOT EXISTS fixture_loyalty_redemption_anchors(account_key TEXT PRIMARY KEY,customer_id TEXT NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL) STRICT;'+
        'CREATE TABLE IF NOT EXISTS fixture_loyalty_redemption_journal(operation_id TEXT PRIMARY KEY,account_key TEXT NOT NULL,seq INTEGER NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL,UNIQUE(account_key,seq)) STRICT;');
      if(!existed){for(const table of ['fixture_loyalty_redemption_benefits','fixture_loyalty_redemption_anchors','fixture_loyalty_redemption_journal'])if(db.prepare('SELECT 1 FROM '+table+' LIMIT 1').get())throw new Error('LOYALTY_SOURCE_SCOPE_MISMATCH');
        db.prepare('INSERT INTO fixture_loyalty_redemption_identity VALUES(1,?,?)').run(canonical(this.#binding),contentDigest(this.#binding));}
      this.#assertIdentity();db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    Object.freeze(this);
  }
  #identity(table:string,expected:Row) {
    const rows=this.db.prepare('SELECT * FROM '+table+' LIMIT 2').all() as Row[];
    if(rows.length!==1||rows[0].id!==1)throw new Error('LOYALTY_SOURCE_SCOPE_MISMATCH');
    const body=JSON.parse(rows[0].body);
    if(canonical(body)!==canonical(expected)||contentDigest(body)!==rows[0].digest)throw new Error('LOYALTY_SOURCE_SCOPE_MISMATCH');
  }
  #assertParent(){database(this.db);this.#identity('fixture_loyalty_identity',this.#parent);}
  #assertIdentity(){this.#assertParent();this.#identity('fixture_loyalty_redemption_identity',this.#binding);}
  #snapshot(row:Row|undefined,customer:string) {
    if(!row)throw new Error('LOYALTY_HISTORY_INCOMPLETE');const raw=JSON.parse(row.body);
    if(Object.hasOwn(raw,'digest'))throw new Error('LOYALTY_SOURCE_INVALID');const value=loyaltyEnvelope({...raw,digest:row.digest},this.#parent,customer);
    if(row.customer_id!==customer||row.source_revision!==value.source_revision||!value.complete)throw new Error('LOYALTY_HISTORY_INCOMPLETE');return value;
  }
  #catalog(revision?:number) {
    const row=this.db.prepare('SELECT * FROM fixture_loyalty_redemption_benefits '+(revision===undefined?'ORDER BY revision DESC LIMIT 1':'WHERE revision=?')).get(...(revision===undefined?[]:[revision])) as Row;
    if(!row)throw new Error('LOYALTY_BENEFITS_UNAVAILABLE');const raw=JSON.parse(row.body);if(Object.hasOwn(raw,'digest'))throw new Error('LOYALTY_BENEFIT_INVALID');
    const result=redemptionCatalog({...raw,digest:row.digest},this.#binding);if(result.revision!==row.revision)throw new Error('LOYALTY_BENEFIT_INVALID');return result;
  }
  #anchor(account:string) {
    const row=this.db.prepare('SELECT * FROM fixture_loyalty_redemption_anchors WHERE account_key=?').get(id(account)) as Row;
    if(!row)throw new Error('LOYALTY_ANCHOR_MISSING');const body=redemptionShape(JSON.parse(row.body),ANCHOR_FIELDS);redemptionBound(body,this.#binding);id(body.customer_id);redemptionHash(body.subject_ref);
    if(body.schema_version!==1||body.account_key!==account||row.account_key!==account||body.customer_id!==row.customer_id||body.subject_ref!==subjectHash(this.tenant,this.store,body.customer_id)||redemptionAccount(this.#binding,body.subject_ref)!==account||contentDigest(body)!==row.digest)throw new Error('LOYALTY_ANCHOR_INVALID');
    const snapshot=loyaltyEnvelope(body.snapshot,this.#parent,body.customer_id),original=this.#snapshot(this.db.prepare('SELECT * FROM fixture_loyalty_snapshots WHERE customer_id=? AND source_revision=?').get(body.customer_id,snapshot.source_revision) as Row,body.customer_id);
    if(!snapshot.complete||snapshot.digest!==original.digest)throw new Error('LOYALTY_ANCHOR_INVALID');return {...body,digest:row.digest};
  }
  #history(account:string,through?:number) {
    this.#assertIdentity();const anchor=this.#anchor(account),rows=this.db.prepare('SELECT * FROM fixture_loyalty_redemption_journal WHERE account_key=? '+(through===undefined?'':'AND seq<=? ')+'ORDER BY seq LIMIT ?')
      .all(account,...(through===undefined?[]:[through]),LOYALTY_REDEMPTION_LIMIT+1) as Row[];
    if(rows.length>LOYALTY_REDEMPTION_LIMIT||through!==undefined&&rows.length!==through)throw new Error('LOYALTY_HISTORY_INCOMPLETE');
    let current=anchor.snapshot;const journal:Row[]=[];let revision=current.source_revision;
    for(let i=0;i<rows.length;i++){
      const row=rows[i],body=redemptionShape(JSON.parse(row.body),JOURNAL_FIELDS);redemptionBound(body,this.#binding);
      const command=redemptionCommand(body.command),result=redemptionResult(body.result,command);
      if(body.schema_version!==1||body.seq!==i+1||row.seq!==body.seq||row.operation_id!==body.operation_id||body.operation_id!==command.operation_id||row.account_key!==account||body.account_key!==account||contentDigest(body)!==row.digest||body.command_digest!==contentDigest(command))throw new Error('LOYALTY_HISTORY_INVALID');
      for(const field of ['tenant_id','store_id','source_account_id','source_identity'])if(command[field]!==this.#binding[field])throw new Error('LOYALTY_HISTORY_INVALID');
      if(command.account_key!==account||command.subject_ref!==anchor.subject_ref||result.before_revision!==revision||result.before_digest!==current.digest)throw new Error('LOYALTY_HISTORY_INVALID');
      if(result.state==='redeemed'){
        const catalog=this.#catalog(command.benefits_revision),benefit=catalog.benefits.find((b:Row)=>b.id===command.benefit_id);
        if(catalog.digest!==command.benefits_digest||!benefit||benefit.points!==command.points||contentDigest(benefit)!==command.benefit_digest||command.rules_revision!==current.rules.revision||command.rules_digest!==contentDigest(current.rules)||!current.capabilities.reserve||!current.capabilities.redeem||!current.capabilities.lookup||command.points<current.rules.minimum_redemption||command.points>current.rules.maximum_redemption||BigInt(command.points)%BigInt(current.rules.redemption_step)!==0n||result.observed_at>=Math.min(command.expires_at,catalog.expires_at,current.expires_at,current.rules.expires_at)||loyaltyFreshness(current,result.observed_at))throw new Error('LOYALTY_HISTORY_INVALID');
        const next=this.#snapshot(this.db.prepare('SELECT * FROM fixture_loyalty_snapshots WHERE customer_id=? AND source_revision=?').get(anchor.customer_id,result.after_revision) as Row,anchor.customer_id);
        const {digest:oldDigest,...before}=current,{digest:nextDigest,...after}=next;
        const expected={...before,source_revision:redemptionPoints(BigInt(before.source_revision)+1n),balances:{...before.balances,redeemed:redemptionPoints(BigInt(before.balances.redeemed)+BigInt(command.points)),available:redemptionPoints(BigInt(before.balances.available)-BigInt(command.points))}};
        if(contentDigest(expected)!==nextDigest||contentDigest(after)!==result.after_digest)throw new Error('LOYALTY_HISTORY_INVALID');current=next;revision=next.source_revision;
      }
      journal.push({...body,digest:row.digest});
    }
    const snapshots=this.db.prepare('SELECT * FROM fixture_loyalty_snapshots WHERE customer_id=? AND source_revision>=? '+(through===undefined?'':'AND source_revision<=? ')+'ORDER BY source_revision LIMIT ?')
      .all(anchor.customer_id,anchor.snapshot.source_revision,...(through===undefined?[]:[revision]),LOYALTY_REDEMPTION_LIMIT+2) as Row[];
    if(snapshots.length!==revision-anchor.snapshot.source_revision+1||snapshots.some((r,i)=>r.source_revision!==anchor.snapshot.source_revision+i))throw new Error('LOYALTY_HISTORY_INCOMPLETE');
    for(const row of snapshots)this.#snapshot(row,anchor.customer_id);
    return {anchor,current,journal};
  }
  publishBenefits(value:unknown) {
    const p=redemptionShape(value,['revision','expires_at','benefits']);integer(p.revision,1);integer(p.expires_at,1);const benefits=redemptionBenefits(p.benefits),now=integer(this.#clock());
    this.#assertIdentity();const db=this.db;db.exec('BEGIN IMMEDIATE');
    try{
      this.#assertIdentity();const body={schema_version:1,...this.#binding,revision:p.revision,expires_at:p.expires_at,benefits},hash=contentDigest(body),last=db.prepare('SELECT revision FROM fixture_loyalty_redemption_benefits ORDER BY revision DESC LIMIT 1').get() as Row;
      if(last){const old=this.#catalog();if(p.revision<old.revision||p.revision===old.revision&&old.digest!==hash)throw new Error('LOYALTY_BENEFIT_REVISION_CONFLICT');if(p.revision===old.revision){db.exec('COMMIT');return old;}}
      if(p.expires_at<=now)throw new Error('LOYALTY_TERMS_EXPIRED');
      db.prepare('INSERT INTO fixture_loyalty_redemption_benefits VALUES(?,?,?)').run(p.revision,canonical(body),hash);db.exec('COMMIT');return {...body,digest:hash};
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  pinAccount(customer:string) {
    id(customer);this.#assertIdentity();const subject=subjectHash(this.tenant,this.store,customer),account=redemptionAccount(this.#binding,subject),db=this.db;db.exec('BEGIN IMMEDIATE');
    try{
      this.#assertIdentity();if(db.prepare('SELECT 1 FROM fixture_loyalty_redemption_anchors WHERE account_key=?').get(account)){const old=this.#history(account).anchor;db.exec('COMMIT');return old;}
      if(db.prepare('SELECT 1 FROM fixture_loyalty_redemption_journal WHERE account_key=? LIMIT 1').get(account))throw new Error('LOYALTY_ANCHOR_MISSING');
      const snapshot=this.#snapshot(db.prepare('SELECT * FROM fixture_loyalty_snapshots WHERE customer_id=? ORDER BY source_revision DESC LIMIT 1').get(customer) as Row,customer);
      if(loyaltyFreshness(snapshot,integer(this.#clock())))throw new Error('LOYALTY_TERMS_EXPIRED');
      const body={schema_version:1,...this.#binding,account_key:account,subject_ref:subject,customer_id:customer,snapshot},hash=contentDigest(body);
      db.prepare('INSERT INTO fixture_loyalty_redemption_anchors VALUES(?,?,?,?)').run(account,customer,canonical(body),hash);db.exec('COMMIT');return {...body,digest:hash};
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  observeAccount(account:string) {
    id(account);const history=this.#history(account),body={schema_version:1,...this.#binding,account_key:account,subject_ref:history.anchor.subject_ref,...history,benefits:this.#catalog()};
    return {...body,digest:redemptionHistoryDigest(body)};
  }
  lookup(operation:string) {
    id(operation);this.#assertIdentity();const row=this.db.prepare('SELECT * FROM fixture_loyalty_redemption_journal WHERE operation_id=?').get(operation) as Row;
    if(!row)return null;integer(row.seq,1);const history=this.#history(row.account_key,row.seq),entry=history.journal.at(-1)!;
    if(entry.operation_id!==operation)throw new Error('LOYALTY_HISTORY_INVALID');return entry.result;
  }
  setMode(mode:string) {this.#assertIdentity();if(!MODES.includes(mode))throw new Error('LOYALTY_MODE_INVALID');this.#mode=mode;}
  redeem(value:unknown) {
    this.#assertIdentity();const command=redemptionCommand(value),hash=contentDigest(command);
    for(const field of ['tenant_id','store_id','source_identity','source_account_id'])if(command[field]!==this.#binding[field])throw new Error('LOYALTY_SOURCE_SCOPE_MISMATCH');
    const old=this.lookup(command.operation_id);if(old){if(old.command_digest!==hash)throw new Error('LOYALTY_IDEMPOTENCY_CONFLICT');return old;}
    const db=this.db;db.exec('BEGIN IMMEDIATE');let result:Row;
    try{
      this.#assertIdentity();const replay=this.lookup(command.operation_id);if(replay){if(replay.command_digest!==hash)throw new Error('LOYALTY_IDEMPOTENCY_CONFLICT');db.exec('COMMIT');return replay;}
      const h=this.#history(command.account_key),before=h.current,catalog=this.#catalog(),now=integer(this.#clock());
      if(command.subject_ref!==h.anchor.subject_ref||h.journal.length>=LOYALTY_REDEMPTION_LIMIT)throw new Error('LOYALTY_HISTORY_INVALID');
      const benefit=catalog.benefits.find((b:Row)=>b.id===command.benefit_id);let reason='LOYALTY_REDEEMED';
      if(command.expires_at<=now||catalog.expires_at<=now||loyaltyFreshness(before,now))reason='LOYALTY_TERMS_EXPIRED';
      else if(command.source_revision!==before.source_revision||command.snapshot_digest!==before.digest)reason='LOYALTY_SNAPSHOT_CHANGED';
      else if(command.rules_revision!==before.rules.revision||command.rules_digest!==contentDigest(before.rules)||command.points<before.rules.minimum_redemption||command.points>before.rules.maximum_redemption||BigInt(command.points)%BigInt(before.rules.redemption_step)!==0n)reason='LOYALTY_RULES_CHANGED';
      else if(command.benefits_revision!==catalog.revision||command.benefits_digest!==catalog.digest||!benefit||benefit.points!==command.points||command.benefit_digest!==contentDigest(benefit))reason='LOYALTY_BENEFIT_CHANGED';
      else if(!before.capabilities.reserve||!before.capabilities.redeem||!before.capabilities.lookup||this.#mode==='reject_unsupported')reason='LOYALTY_REDEMPTION_UNSUPPORTED';
      else if(command.points>before.balances.available||this.#mode==='reject_insufficient')reason='LOYALTY_INSUFFICIENT_POINTS';
      if(this.#mode==='timeout_before_effect')throw new Error('LOYALTY_TIMEOUT_BEFORE_EFFECT');
      let after=before;
      if(reason==='LOYALTY_REDEEMED'){
        const {digest:oldDigest,...body}=before,next={...body,source_revision:redemptionPoints(BigInt(body.source_revision)+1n),balances:{...body.balances,redeemed:redemptionPoints(BigInt(body.balances.redeemed)+BigInt(command.points)),available:redemptionPoints(BigInt(body.balances.available)-BigInt(command.points))}};
        after=loyaltyEnvelope({...next,digest:contentDigest(next)},this.#parent,h.anchor.customer_id);
        db.prepare('INSERT INTO fixture_loyalty_snapshots VALUES(?,?,?,?)').run(h.anchor.customer_id,after.source_revision,canonical(next),after.digest);
      }
      const body={schema_version:1,source_identity:this.identity,source_account_id:this.account,account_key:command.account_key,operation_id:command.operation_id,command_digest:hash,points:command.points,unit:'points',benefit_id:command.benefit_id,benefit_digest:command.benefit_digest,state:reason==='LOYALTY_REDEEMED'?'redeemed':'rejected',reason,provider_ref:reason==='LOYALTY_REDEEMED'?'reward_'+hash.slice(0,40):null,before_revision:before.source_revision,before_digest:before.digest,after_revision:after.source_revision,after_digest:after.digest,observed_at:now};
      result=redemptionResult({...body,digest:contentDigest(body)},command);const entry={schema_version:1,...this.#binding,operation_id:command.operation_id,account_key:command.account_key,seq:h.journal.length+1,command,command_digest:hash,result};
      db.prepare('INSERT INTO fixture_loyalty_redemption_journal VALUES(?,?,?,?,?)').run(command.operation_id,command.account_key,entry.seq,canonical(entry),contentDigest(entry));this.#history(command.account_key);db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    if(this.#mode==='timeout_after_effect')throw new Error('LOYALTY_TIMEOUT_AFTER_EFFECT');return result;
  }
}
