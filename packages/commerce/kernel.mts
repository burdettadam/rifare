import { assertNotErased, erasedResource, assertRecoveryAction } from './data-guards.mts';
import { assertExecution } from './execution-stops.mts';
import { ROLE_ACTIONS,permissionDecision,recordSecurity } from './authorization.mts';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';

export type Scope = Readonly<object>;
export type Role = 'owner'|'operator'|'reviewer'|'integration'|'agent'|'worker'|'customer';
export type Row = Record<string, any>;
export const KINDS = ['order', 'customer', 'shipment', 'catalog', 'payment'] as const;
export const token = () => randomBytes(32).toString('base64url');
export const digest = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
export function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,96}$/.test(value)) throw new Error('INVALID_INPUT');
  return value;
}
export function exact(value: unknown, fields: string[]): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...fields].sort().join(',')) throw new Error('INVALID_INPUT');
  return value as Row;
}
export function integer(value: unknown, min = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < min) throw new Error('INVALID_INPUT');
  return value as number;
}
export function resourceKey(tenant:string,store:string,kind:string,source:string,external:string) {
  return 'res_'+digest(JSON.stringify([tenant,store,kind,source,external])).slice(0,40);
}
export function boundedJSON(value: unknown): string {
  const s = JSON.stringify(value);
  if (!s || Buffer.byteLength(s) > 16384) throw new Error('INVALID_INPUT');
  return s;
}

export class CommerceKernel {
  readonly db: DatabaseSync;
  readonly clock: () => number;
  #scopes = new WeakMap<object, string>();
  #limits = new WeakMap<object, {resource:string;actions:readonly string[];guard:()=>void;identity:Row}>();
  #depth = 0;
  constructor(db: DatabaseSync, clock: () => number = Date.now) {
    this.db = db; this.clock = clock;
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;');
    db.exec('CREATE TABLE IF NOT EXISTS commerce_migrations(version TEXT PRIMARY KEY,sha256 TEXT NOT NULL) STRICT');
    const directory = new URL('../../migrations/commerce/', import.meta.url);
    const files = readdirSync(directory).filter(f => f.endsWith('.sql')).sort();
    this.transaction(() => {
      const applied = db.prepare('SELECT * FROM commerce_migrations ORDER BY version').all() as Row[];
      if (applied.some((r,i) => files[i] !== r.version)) throw new Error('MIGRATION_HISTORY_INVALID');
      for (const name of files) {
        const bytes = readFileSync(new URL(name, directory)); const hash = digest(bytes);
        const row = applied.find(r => r.version === name);
        if (row && row.sha256 !== hash) throw new Error('MIGRATION_CHECKSUM_MISMATCH');
        if (!row) { db.exec(bytes.toString()); db.prepare('INSERT INTO commerce_migrations VALUES(?,?)').run(name, hash); }
      }
    });
  }
  transaction<T>(fn: () => T): T {
    const depth=this.#depth, savepoint='rifare_nested_'+depth;
    this.db.exec(depth===0?'BEGIN IMMEDIATE':'SAVEPOINT '+savepoint);this.#depth++;
    try {const value=fn();if(value instanceof Promise)throw new Error('ASYNC_TRANSACTION_DENIED');
      this.db.exec(depth===0?'COMMIT':'RELEASE '+savepoint);return value;}
    catch(error){this.db.exec(depth===0?'ROLLBACK':'ROLLBACK TO '+savepoint);if(depth>0)this.db.exec('RELEASE '+savepoint);throw error;}
    finally{this.#depth--;}
  }
  // Provisioning is server-local administration, never part of the public action surface.
  provisionStore(tenant: string, store: string, market = 'US') {
    id(tenant); id(store); id(market);
    this.db.prepare('INSERT INTO commerce_stores VALUES(?,?,?,1)').run(tenant,store,market);
  }
  provisionMember(tenant: string, store: string, actor: string, role: Exclude<Role,'customer'> = 'operator') {
    id(tenant); id(store); id(actor);
    if (!Object.hasOwn(ROLE_ACTIONS,role)||role==='customer') throw new Error('INVALID_INPUT');
    this.db.prepare('INSERT INTO commerce_members VALUES(?,?,?,?,1)').run(tenant,store,actor,role);
  }
  issueSession(tenant: string, store: string, actor: string, lifetime = 3600000) {
    id(tenant); id(store); id(actor); integer(lifetime,1);
    if (lifetime>3600000) throw new Error('INVALID_INPUT');
    const member = this.db.prepare(`SELECT m.role FROM commerce_members m JOIN commerce_stores s USING(tenant_id,store_id)
      WHERE m.tenant_id=? AND m.store_id=? AND m.actor_id=? AND m.active=1 AND s.active=1`).get(tenant,store,actor) as Row;
    if (!member) throw new Error('ACCESS_DENIED');
    const value = token(), now=this.clock();
    this.db.prepare('INSERT INTO commerce_sessions VALUES(?,?,?,?,?,NULL,NULL,?,?,0)')
      .run(digest(value),tenant,store,actor,member.role,now+lifetime,now);
    return value;
  }
  authenticate(value: unknown): Scope {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) throw new Error('ACCESS_DENIED');
    const scope=Object.freeze({}); this.#scopes.set(scope,digest(value)); this.require(scope); return scope;
  }
  require(scope: Scope, roles: Role[] = ['owner','operator','reviewer','integration','agent','worker','customer']): Row {
    const hash = scope && typeof scope==='object' ? this.#scopes.get(scope) : undefined;
    if (!hash) throw new Error('ACCESS_DENIED');
    this.#limits.get(scope)?.guard();
    const now=this.clock();
    const row=this.db.prepare(`SELECT ss.* FROM commerce_sessions ss JOIN commerce_stores s USING(tenant_id,store_id)
      WHERE ss.token_hash=? AND ss.revoked=0 AND s.active=1 AND ss.expires_at>? AND ss.last_seen>?`)
      .get(hash,now,now-900000) as Row;
    const compatible=row?.role==='owner'?'operator':['agent','reviewer','integration'].includes(row?.role)?'worker':row?.role;
    if (!row || (row.role!=='owner'&&!roles.includes(row.role)&&!roles.includes(compatible))) throw new Error('ACCESS_DENIED');
    if (row.role === 'customer') {
      const owner=this.db.prepare(`SELECT 1 FROM commerce_resources WHERE tenant_id=? AND store_id=? AND id=?
        AND kind='order' AND customer_id=?`).get(row.tenant_id,row.store_id,row.resource_id,row.customer_id);
      if (!owner) throw new Error('ACCESS_DENIED');
    } else {
      const member=this.db.prepare(`SELECT 1 FROM commerce_members WHERE tenant_id=? AND store_id=? AND actor_id=? AND role=? AND active=1`)
        .get(row.tenant_id,row.store_id,row.actor_id,row.role);
      if (!member) throw new Error('ACCESS_DENIED');
    }
    this.db.prepare('UPDATE commerce_sessions SET last_seen=? WHERE token_hash=?').run(now,hash);
    return row;
  }
  authorize(scope:Scope,action:string,resource:string|null=null):Row {
    const s=this.require(scope);assertRecoveryAction(this,action);if(resource!==null){id(resource);assertNotErased(this,s,resource);}
    const limits=this.#limits.get(scope);
    if(limits&&(!limits.actions.includes(action)||(resource!==null&&resource!==limits.resource)))throw new Error('WORK_SCOPE_DENIED');
    if(action==='model.run')assertExecution(this,s,'model.run');
    const decision=permissionDecision(this.db,s,action,resource);
    if(!decision.allowed){recordSecurity(this.db,s,decision.action,'denied',this.clock(),decision.authority_revision);throw new Error('ACCESS_DENIED');}
    return s;
  }
  // Trusted in-process adapters only: a hash is not a public authentication interface.
  restrictedSession(sessionHash:string,resource:string,actions:readonly string[],guard:()=>void,identity:Row):Scope {
    const scope=Object.freeze({});this.#scopes.set(scope,sessionHash);
    this.#limits.set(scope,{resource,actions:[...actions],guard,identity:Object.freeze({...identity})});this.require(scope);return scope;
  }
  workerIdentity(scope:Scope){this.require(scope);return this.#limits.get(scope)?.identity??null;}
  revoke(scope: Scope) {
    const s=this.require(scope); this.db.prepare('UPDATE commerce_sessions SET revoked=1 WHERE token_hash=?').run(s.token_hash);
  }
  audit(scope: Scope, operation: string, decision: 'allowed'|'denied') {
    const s=this.require(scope); id(operation);
    this.db.prepare('INSERT INTO commerce_audit(tenant_id,store_id,actor_id,operation,decision,observed_at) VALUES(?,?,?,?,?,?)')
      .run(s.tenant_id,s.store_id,s.actor_id,operation,decision,this.clock());
  }
  auditRows(scope: Scope) {
    const s=this.authorize(scope,'audit.read');
    return this.db.prepare('SELECT actor_id,operation,decision,observed_at FROM commerce_audit WHERE tenant_id=? AND store_id=? ORDER BY id DESC LIMIT 100')
      .all(s.tenant_id,s.store_id);
  }
  ingest(scope: Scope, input: unknown) {
    const s=this.require(scope,['operator','worker']);
    const r=exact(input,['kind','source_system','external_id','source_version','source_updated_at','customer_id','payload']);
    if (!KINDS.includes(r.kind)) throw new Error('INVALID_INPUT');
    id(r.source_system); id(r.external_id); integer(r.source_version,1); integer(r.source_updated_at);
    if (r.customer_id !== null) id(r.customer_id);
    const encoded=boundedJSON(r.payload); const now=this.clock();
    if (r.source_updated_at>now) throw new Error('INVALID_INPUT');
    const canonical=resourceKey(s.tenant_id,s.store_id,r.kind,r.source_system,r.external_id);
    this.authorize(scope,'resource.ingest',canonical);
    this.transaction(() => {
      this.authorize(scope,'resource.ingest',canonical);assertNotErased(this,s,canonical,r.customer_id??(r.kind==='customer'?r.external_id:null));
      const prev=this.db.prepare('SELECT * FROM commerce_resources WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,canonical) as Row;
      if (prev && r.source_version<=prev.source_version) {
        if (r.source_version===prev.source_version && prev.payload===encoded && prev.customer_id===r.customer_id
          && prev.source_updated_at===r.source_updated_at) return;
        throw new Error('SOURCE_VERSION_CONFLICT');
      }
      this.db.prepare(`INSERT INTO commerce_resources VALUES(?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(tenant_id,store_id,id) DO UPDATE SET source_version=excluded.source_version,source_updated_at=excluded.source_updated_at,
        observed_at=excluded.observed_at,customer_id=excluded.customer_id,payload=excluded.payload`)
        .run(s.tenant_id,s.store_id,canonical,r.kind,r.source_system,r.external_id,r.source_version,r.source_updated_at,now,r.customer_id,encoded);
    });
    return this.get(scope,canonical);
  }
  project(row: Row) {
    const {payload,...facts}=row;
    return {...facts, payload:JSON.parse(payload),freshness:{observed_at:row.observed_at,source_updated_at:row.source_updated_at}};
  }
  get(scope: Scope, resource: string) {
    const s=this.require(scope);id(resource);
    if (s.role==='customer' && s.resource_id!==resource) throw new Error('NOT_FOUND');
    this.authorize(scope,'resource.read',resource);
    const row=this.db.prepare('SELECT * FROM commerce_resources WHERE tenant_id=? AND store_id=? AND id=?')
      .get(s.tenant_id,s.store_id,resource) as Row;
    if (!row) throw new Error('NOT_FOUND');
    return this.project(row);
  }
  lookup(scope: Scope, kind: string, source: string, external: string) {
    const s=this.require(scope,['operator','worker']); id(kind);id(source);id(external);
    this.authorize(scope,'resource.read',resourceKey(s.tenant_id,s.store_id,kind,source,external));
    const row=this.db.prepare('SELECT * FROM commerce_resources WHERE tenant_id=? AND store_id=? AND kind=? AND source_system=? AND external_id=?')
      .get(s.tenant_id,s.store_id,kind,source,external) as Row;
    if (!row) throw new Error('NOT_FOUND'); assertNotErased(this,s,row.id);return this.project(row);
  }
  list(scope: Scope, kind: string, limit=50) {
    const s=this.require(scope,['operator','worker']); id(kind);integer(limit,1);
    if (!KINDS.includes(kind as any) || limit>100) throw new Error('INVALID_INPUT');
    return this.db.prepare('SELECT * FROM commerce_resources WHERE tenant_id=? AND store_id=? AND kind=? ORDER BY id LIMIT ?')
      .all(s.tenant_id,s.store_id,kind,limit).filter(r=>permissionDecision(this.db,s,'resource.read',(r as Row).id).allowed).filter(r=>!erasedResource(this,s,(r as Row).id)).map(r=>this.project(r as Row));
  }
  enqueueRead(scope: Scope, resource: string) {
    const s=this.require(scope,['operator']); this.authorize(scope,'job.enqueue',resource);this.get(scope,resource); const job='job_'+token().slice(0,32);
    this.db.prepare("INSERT INTO commerce_read_jobs VALUES(?,?,?,?,'pending',NULL)").run(s.tenant_id,s.store_id,job,resource);
    return {id:job,state:'pending'};
  }
  runRead(scope: Scope, job: string) {
    const s=this.require(scope,['worker']);id(job);
    return this.transaction(() => {
      const row=this.db.prepare('SELECT * FROM commerce_read_jobs WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,job) as Row;
      if (!row) throw new Error('NOT_FOUND');
      this.authorize(scope,'job.run',row.resource_id);
      if (row.state==='completed') return JSON.parse(row.result);
      const result=this.get(scope,row.resource_id);
      this.db.prepare("UPDATE commerce_read_jobs SET state='completed',result=? WHERE tenant_id=? AND store_id=? AND id=?")
        .run(boundedJSON(result),s.tenant_id,s.store_id,job);return result;
    });
  }
  attach(scope: Scope, resource: string, value: unknown) {
    const s=this.require(scope,['operator','worker']);this.authorize(scope,'attachment.write',resource);this.get(scope,resource); const ref='att_'+token().slice(0,32);
    this.db.prepare('INSERT INTO commerce_attachments VALUES(?,?,?,?,?)').run(s.tenant_id,s.store_id,ref,resource,boundedJSON(value));return ref;
  }
  attachment(scope: Scope, ref: string) {
    const s=this.require(scope);id(ref);
    const row=this.db.prepare('SELECT * FROM commerce_attachments WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,ref) as Row;
    if (!row || (s.role==='customer' && s.resource_id!==row.resource_id)) throw new Error('NOT_FOUND');
    this.authorize(scope,'attachment.read',row.resource_id);this.get(scope,row.resource_id); return JSON.parse(row.content);
  }
}
