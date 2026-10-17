import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {contentDigest,canonical,jsonValue} from '../commerce/configuration-values.mts';
import {id,exact,integer} from '../commerce/kernel.mts';
import type {Row} from '../commerce/kernel.mts';

export interface SupportSource {
 readonly tenant:string;readonly store:string;readonly account:string;readonly identity:string;readonly contract:string;
 readonly evidence_kind:'synthetic'|'connected_unqualified';
 send(command:Row):Promise<Row>|Row;
 lookup(operationId:string,payloadHash:string):Promise<Row|null>|Row|null;
}
export class SupportFixtureSource implements SupportSource {
 readonly contract='support_fixture_v1';readonly evidence_kind='synthetic' as const;readonly identity:string;
 fault:'none'|'before'|'after'|'rejected'='none';calls=0;lookups=0;
 readonly db:DatabaseSync;readonly tenant:string;readonly store:string;readonly account:string;readonly clock:()=>number;
 constructor(db:DatabaseSync,tenant:string,store:string,account:string,clock:()=>number=Date.now) {
  this.db=db;this.tenant=tenant;this.store=store;this.account=account;this.clock=clock;
  [tenant,store,account].forEach(id);db.exec('PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS support_source_identity(id INTEGER PRIMARY KEY,body TEXT NOT NULL);CREATE TABLE IF NOT EXISTS support_source_effects(operation_id TEXT PRIMARY KEY,payload_hash TEXT NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL) STRICT;');
  const old=db.prepare('SELECT body FROM support_source_identity WHERE id=1').get() as Row;
  if(old){const b=JSON.parse(old.body);if(b.tenant!==tenant||b.store!==store||b.account!==account)throw new Error('SOURCE_SCOPE_MISMATCH');this.identity=b.identity;}
  else{this.identity='ssrc_'+randomUUID().replaceAll('-','');db.prepare('INSERT INTO support_source_identity VALUES(1,?)').run(canonical({tenant,store,account,identity:this.identity}));}
 }
 send(input:Row) {
  this.calls++;const c=exact(jsonValue(input,32768),['tenant_id','store_id','operation_id','payload_hash','payload']);
  if(c.tenant_id!==this.tenant||c.store_id!==this.store||c.payload.account_id!==this.account||contentDigest(c.payload)!==c.payload_hash)throw new Error('SOURCE_SCOPE_MISMATCH');id(c.operation_id);
  if(this.fault==='before')return {kind:'not_sent',operation_id:c.operation_id,payload_hash:c.payload_hash};
  if(this.fault==='rejected')return {kind:'rejected',operation_id:c.operation_id,payload_hash:c.payload_hash};
  this.db.exec('BEGIN IMMEDIATE');let result:Row;
  try{const old=this.db.prepare('SELECT * FROM support_source_effects WHERE operation_id=?').get(c.operation_id) as Row;
   if(old){if(old.payload_hash!==c.payload_hash)throw new Error('SOURCE_IDEMPOTENCY_CONFLICT');result=JSON.parse(old.body);}
   else{result={kind:'accepted',operation_id:c.operation_id,payload_hash:c.payload_hash,source_identity:this.identity,account_id:this.account,native_id:'sout_'+contentDigest([this.identity,c.operation_id]).slice(0,40),stage:c.payload.kind==='handoff'?'assigned':c.payload.kind==='note'?'internal_note':'accepted',purpose:c.payload.purpose,customer_delivered:false,observed_at:this.clock(),version:1};
    this.db.prepare('INSERT INTO support_source_effects VALUES(?,?,?,?)').run(c.operation_id,c.payload_hash,canonical(result),contentDigest(result));}
   this.db.exec('COMMIT');
  }catch(e){this.db.exec('ROLLBACK');throw e;}
  if(this.fault==='after')throw new Error('RESPONSE_LOST');return result;
 }
 lookup(operationId:string,payloadHash:string){this.lookups++;id(operationId);const r=this.db.prepare('SELECT * FROM support_source_effects WHERE operation_id=?').get(operationId) as Row;if(!r)return null;if(r.payload_hash!==payloadHash||contentDigest(JSON.parse(r.body))!==r.digest)throw new Error('SOURCE_IDEMPOTENCY_CONFLICT');return JSON.parse(r.body);}
 // Synthetic source-side observation only; never exposed in the merchant HTTP API.
 observe(operationId:string,stage:'delivered'|'bounced'|'failed',version:number) {integer(version,2);const r=this.db.prepare('SELECT * FROM support_source_effects WHERE operation_id=?').get(id(operationId)) as Row;if(!r)throw new Error('NOT_FOUND');const b=JSON.parse(r.body);if(version<=b.version)throw new Error('SOURCE_VERSION_CONFLICT');
  const updated={...b,stage,version,customer_delivered:stage==='delivered',observed_at:this.clock()};this.db.prepare('UPDATE support_source_effects SET body=?,digest=? WHERE operation_id=?').run(canonical(updated),contentDigest(updated),operationId);return updated;}
}
