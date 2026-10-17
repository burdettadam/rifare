import { randomUUID } from 'node:crypto';
import { exact,id,integer } from '../commerce/kernel.mts';
import type { DatabaseSync } from 'node:sqlite';
import type { Row } from '../commerce/kernel.mts';
import { canonical,contentDigest,jsonValue } from '../commerce/configuration-values.mts';

// Fixture administration is server-local. The application gets only lookup().
export class NativeChangeFixtureSource {
 readonly db:DatabaseSync;readonly tenant:string;readonly store:string;readonly identity:string;reads=0;
 constructor(db:DatabaseSync,c:{mode:'fixture';identity:string;tenant:string;store:string}){exact(c,['mode','identity','tenant','store']);if(c.mode!=='fixture')throw new Error('FIXTURE_ONLY');id(c.identity);id(c.tenant);id(c.store);this.db=db;this.tenant=c.tenant;this.store=c.store;
  db.exec('PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS native_change_identity(singleton INTEGER PRIMARY KEY CHECK(singleton=1),label TEXT NOT NULL,tenant_id TEXT NOT NULL,store_id TEXT NOT NULL,identity TEXT NOT NULL) STRICT; CREATE TABLE IF NOT EXISTS native_change_feed(request_id TEXT PRIMARY KEY,version INTEGER NOT NULL,body TEXT NOT NULL,digest TEXT NOT NULL) STRICT;');
  db.prepare('INSERT OR IGNORE INTO native_change_identity VALUES(1,?,?,?,?)').run(c.identity,c.tenant,c.store,'nativefeed_'+randomUUID().replaceAll('-',''));const r=db.prepare('SELECT * FROM native_change_identity').get() as Row;if(r.label!==c.identity||r.tenant_id!==c.tenant||r.store_id!==c.store)throw new Error('NATIVE_SOURCE_MISMATCH');this.identity=r.identity;
 }
 publish(input:Row){const b=jsonValue(input);id(b.request_id);integer(b.source_version,1);const old=this.db.prepare('SELECT * FROM native_change_feed WHERE request_id=?').get(b.request_id) as Row;if(old&&b.source_version<=old.version){if(old.version===b.source_version&&old.digest===contentDigest(b))return;throw new Error('SOURCE_VERSION_CONFLICT');}
  this.db.prepare('INSERT INTO native_change_feed VALUES(?,?,?,?) ON CONFLICT(request_id) DO UPDATE SET version=excluded.version,body=excluded.body,digest=excluded.digest').run(b.request_id,b.source_version,canonical(b),contentDigest(b));}
 async lookup(requestId:string){this.reads++;const r=this.db.prepare('SELECT * FROM native_change_feed WHERE request_id=?').get(id(requestId)) as Row;if(!r)return null;const b=JSON.parse(r.body);if(contentDigest(b)!==r.digest)throw new Error('NATIVE_SOURCE_INTEGRITY');return {source_identity:this.identity,tenant_id:this.tenant,store_id:this.store,snapshot:b};}
}
