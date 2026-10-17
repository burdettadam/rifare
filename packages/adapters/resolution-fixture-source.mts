import { DatabaseSync } from 'node:sqlite';
import { exact,id,token } from '../commerce/kernel.mts';
import type { Row } from '../commerce/kernel.mts';
import { canonical,contentDigest,jsonValue } from '../commerce/configuration-values.mts';
import { minor } from '../commerce/resolution-ledger.mts';
import { money } from '../commerce/money.mts';

/** A separately persisted synthetic authority, not a live payment connector. */
export class ResolutionFixtureSource {
 readonly db:DatabaseSync;readonly identity:string;readonly tenant:string;readonly store:string;readonly qualification='synthetic_only';
 constructor(db:DatabaseSync,options:{mode:'fixture';identity:string;tenant:string;store:string}){
  exact(options,['mode','identity','tenant','store']);if(options.mode!=='fixture')throw new Error('LIVE_RESOLUTION_DISABLED');
  this.db=db;const label=id(options.identity);if(label.length>48)throw new Error('INVALID_INPUT');this.tenant=id(options.tenant);this.store=id(options.store);db.exec('PRAGMA busy_timeout=3000');
  db.exec(`CREATE TABLE IF NOT EXISTS fixture_resolution_identity(id INTEGER PRIMARY KEY,label TEXT NOT NULL,identity TEXT NOT NULL,tenant TEXT NOT NULL,store TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS fixture_resolution_accounts(resource_id TEXT PRIMARY KEY,customer_id TEXT NOT NULL,payment_id TEXT NOT NULL,currency TEXT NOT NULL,available_minor TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS fixture_resolution_effects(operation_id TEXT PRIMARY KEY,resource_id TEXT NOT NULL,command TEXT NOT NULL,digest TEXT NOT NULL,body TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS fixture_credit_accounts(id TEXT PRIMARY KEY,customer_id TEXT NOT NULL,currency TEXT NOT NULL,balance_minor TEXT NOT NULL,UNIQUE(customer_id,currency));`);
  const old=db.prepare('SELECT * FROM fixture_resolution_identity WHERE id=1').get() as Row;
  if(old&&(old.label!==label||old.tenant!==this.tenant||old.store!==this.store))throw new Error('RESOLUTION_SOURCE_MISMATCH');
  this.identity=old?.identity??'source_'+contentDigest([label,token()]).slice(0,40);
  if(!old)db.prepare('INSERT INTO fixture_resolution_identity VALUES(1,?,?,?,?)').run(label,this.identity,this.tenant,this.store);
 }
 seed(input:unknown){const p=exact(jsonValue(input),['resource_id','customer_id','payment_id','currency','available_minor']);id(p.resource_id);id(p.customer_id);id(p.payment_id);money(p.currency,p.available_minor);
  this.db.prepare('INSERT INTO fixture_resolution_accounts VALUES(?,?,?,?,?)').run(p.resource_id,p.customer_id,p.payment_id,p.currency,p.available_minor);}
 async issue(value:unknown){const p=exact(jsonValue(value),['operation_id','tenant_id','store_id','resource_id','customer_id','allocation_id','kind','currency','amount_minor','payment_id','native_return_id','source_identity','credit_instrument']);
  for(const k of ['operation_id','tenant_id','store_id','resource_id','customer_id','allocation_id','payment_id','source_identity'])id(p[k]);
  if(p.tenant_id!==this.tenant||p.store_id!==this.store||p.source_identity!==this.identity||!['refund','store_credit'].includes(p.kind)||minor(p.amount_minor)<=0n)throw new Error('RESOLUTION_SOURCE_MISMATCH');
  if(p.kind==='store_credit'?p.credit_instrument!=='native_store_credit':p.credit_instrument!==null)throw new Error('CREDIT_UNQUALIFIED');
  this.db.exec('BEGIN IMMEDIATE');try{
   const old=this.db.prepare('SELECT * FROM fixture_resolution_effects WHERE operation_id=?').get(p.operation_id) as Row;
   if(old){if(old.digest!==contentDigest(p))throw new Error('SOURCE_IDEMPOTENCY_CONFLICT');this.db.exec('COMMIT');return JSON.parse(old.body);}
   const account=this.db.prepare('SELECT * FROM fixture_resolution_accounts WHERE resource_id=?').get(p.resource_id) as Row;
   if(!account||account.currency!==p.currency||account.customer_id!==p.customer_id||account.payment_id!==p.payment_id)throw new Error('RESOLUTION_SOURCE_MISMATCH');
   const spent=(this.db.prepare('SELECT body FROM fixture_resolution_effects WHERE resource_id=?').all(p.resource_id) as Row[]).map(r=>JSON.parse(r.body)).filter(r=>r.state!=='rejected').reduce((n,r)=>n+minor(r.amount_minor),0n);
   const rejected=spent+minor(p.amount_minor)>minor(account.available_minor),nativeId='fixture_'+p.kind+'_'+token().slice(0,24);
   const result:Row={...p,id:nativeId,state:rejected?'rejected':p.kind==='refund'?'accepted':'issued',instrument:null,qualification:'synthetic_only'};
   if(p.kind==='store_credit'&&!rejected){let credit=this.db.prepare('SELECT * FROM fixture_credit_accounts WHERE customer_id=? AND currency=?').get(p.customer_id,p.currency) as Row;
    if(!credit){credit={id:'credit_'+token().slice(0,24),customer_id:p.customer_id,currency:p.currency,balance_minor:'0'};this.db.prepare('INSERT INTO fixture_credit_accounts VALUES(?,?,?,?)').run(credit.id,credit.customer_id,credit.currency,'0');}
    const balance=(minor(credit.balance_minor)+minor(p.amount_minor)).toString();this.db.prepare('UPDATE fixture_credit_accounts SET balance_minor=? WHERE id=?').run(balance,credit.id);
    result.instrument={type:'native_store_credit',account_id:credit.id,customer_id:p.customer_id,currency:p.currency,balance_minor:balance,expires_at:null};
   }
   this.db.prepare('INSERT INTO fixture_resolution_effects VALUES(?,?,?,?,?)').run(p.operation_id,p.resource_id,canonical(p),contentDigest(p),canonical(result));this.db.exec('COMMIT');return result;
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 async lookup(operationId:string){const r=this.db.prepare('SELECT body FROM fixture_resolution_effects WHERE operation_id=?').get(id(operationId)) as Row;return r?JSON.parse(r.body):null;}
 // Fixture administration only, never exposed through a merchant or agent API.
 settle(operationId:string){const r=this.db.prepare('SELECT body FROM fixture_resolution_effects WHERE operation_id=?').get(id(operationId)) as Row;
  if(!r)throw new Error('NOT_FOUND');const b=JSON.parse(r.body);if(b.kind!=='refund'||!['accepted','settled'].includes(b.state))throw new Error('INVALID_STAGE');b.state='settled';this.db.prepare('UPDATE fixture_resolution_effects SET body=? WHERE operation_id=?').run(canonical(b),operationId);}
}
