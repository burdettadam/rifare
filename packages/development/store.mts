import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync, lstatSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { ensurePrivateDirectory, validateRuntimeFile } from './config.mts';
import type { Configuration } from './config.mts';

export const VALID_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
export function validateMarker(input: unknown): { id: string; value: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('INVALID_MARKER');
  const item = input as Record<string, unknown>;
  if (Object.keys(item).sort().join(',') !== 'id,value' || typeof item.id !== 'string'
    || !VALID_ID.test(item.id) || typeof item.value !== 'string' || !item.value.length
    || item.value.length > 256) throw new Error('INVALID_MARKER');
  return { id: item.id, value: item.value };
}

export class SmokeStore {
  db: DatabaseSync;
  config: Configuration;
  constructor(config: Configuration, migrate = false) {
    this.config = config;
    ensurePrivateDirectory(config.dataDir, config.root);
    ensurePrivateDirectory(config.attachments, config.root);
    for (const path of [config.database, config.database + '-wal', config.database + '-shm']) validateRuntimeFile(path);
    this.db = new DatabaseSync(config.database, { timeout: 3000, allowExtension: false });
    chmodSync(config.database, 0o600);
    try {
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000; PRAGMA foreign_keys=ON;');
      this.db.exec('BEGIN IMMEDIATE');
      try {
        this.db.exec('CREATE TABLE IF NOT EXISTS instance_owner (id INTEGER PRIMARY KEY CHECK (id=1), instance_id TEXT NOT NULL) STRICT;');
        const owner = this.db.prepare('SELECT instance_id FROM instance_owner WHERE id=1').get();
        if (owner && owner.instance_id !== config.instanceId) throw new Error('DATABASE_OWNER_MISMATCH');
        if (!owner) this.db.prepare('INSERT INTO instance_owner VALUES(1,?)').run(config.instanceId);
        this.db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, sha256 TEXT NOT NULL) STRICT;');
        const files = readdirSync(join(config.root, 'migrations', 'smoke')).filter(f => f.endsWith('.sql')).sort();
        if (!files.length) throw new Error('MIGRATIONS_MISSING');
        const applied = this.db.prepare('SELECT version,sha256 FROM schema_migrations ORDER BY version').all();
        for (const row of applied) if (!files.includes(String(row.version))) throw new Error('UNKNOWN_APPLIED_MIGRATION');
        for (let i = 0; i < files.length; i++) {
          if (!files[i].startsWith(String(i + 1).padStart(3, '0') + '_')) throw new Error('MIGRATION_SEQUENCE');
          const bytes = readFileSync(join(config.root, 'migrations', 'smoke', files[i]));
          const digest = createHash('sha256').update(bytes).digest('hex');
          const row = applied.find(r => r.version === files[i]);
          if (row && row.sha256 !== digest) throw new Error('MIGRATION_CHECKSUM_MISMATCH');
          if (!row) {
            if (!migrate) throw new Error('MIGRATION_REQUIRED');
            this.db.exec(bytes.toString('utf8'));
            this.db.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(files[i], digest);
          }
        }
        this.db.exec('COMMIT');
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    } catch (error) { this.db.close(); throw error; }
  }
  close() { this.db.close(); }
  transaction<T>(body: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = body(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  marker(input: unknown) {
    const { id, value } = validateMarker(input);
    return this.transaction(() => {
      const existing = this.db.prepare('SELECT * FROM dev_markers WHERE id=?').get(id);
      if (existing) { if (existing.value !== value) throw new Error('IDEMPOTENCY_CONFLICT'); return existing; }
      this.db.prepare('INSERT INTO dev_markers VALUES(?,?,?)').run(id, value, Date.now());
      return this.db.prepare('SELECT * FROM dev_markers WHERE id=?').get(id);
    });
  }
  enqueue(input: unknown) {
    const { id, value } = validateMarker(input);
    return this.transaction(() => {
      const existing = this.db.prepare('SELECT * FROM dev_jobs WHERE id=?').get(id);
      if (existing) { if (existing.value !== value) throw new Error('IDEMPOTENCY_CONFLICT'); return existing; }
      this.db.prepare("INSERT INTO dev_jobs(id,value,state,created_at) VALUES(?,?,'pending',?)").run(id, value, Date.now());
      return this.db.prepare('SELECT * FROM dev_jobs WHERE id=?').get(id);
    });
  }
  claim(now = Date.now(), leaseMs = 5000): Record<string, any> | undefined {
    return this.transaction(() => {
      const job = this.db.prepare("SELECT * FROM dev_jobs WHERE state='pending' OR (state='running' AND lease_until<?) ORDER BY created_at,id LIMIT 1").get(now);
      if (!job) return undefined;
      const owner = randomUUID();
      this.db.prepare("UPDATE dev_jobs SET state='running',lease_owner=?,lease_until=?,attempts=attempts+1 WHERE id=?").run(owner, now + leaseMs, job.id);
      return this.db.prepare('SELECT * FROM dev_jobs WHERE id=?').get(job.id);
    });
  }
  heartbeat() {
    this.db.prepare('INSERT INTO dev_heartbeat VALUES(1,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at').run(Date.now());
  }
  finish(job: Record<string, any>, now = Date.now()) {
    this.transaction(() => {
      const current = this.db.prepare("SELECT * FROM dev_jobs WHERE id=? AND state='running' AND lease_owner=? AND lease_until>=?").get(job.id, job.lease_owner, now);
      if (!current) throw new Error('STALE_JOB_LEASE');
      const path = this.attachmentPath(String(current.id));
      const content = JSON.stringify({ instance_id: this.config.instanceId, id: current.id, value: current.value }) + '\n';
      validateRuntimeFile(path);
      try { writeFileSync(path, content, { flag: 'wx', mode: 0o600 }); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if (readFileSync(path, 'utf8') !== content) throw new Error('ATTACHMENT_CONFLICT');
      }
      this.db.prepare("UPDATE dev_jobs SET state='completed',completed_at=?,lease_owner=NULL,lease_until=0 WHERE id=?").run(now, current.id);
    });
  }
  fail(job: Record<string, any>, now = Date.now()): boolean {
    // An expired worker no longer owns the transition, even before reclamation.
    const result = this.db.prepare("UPDATE dev_jobs SET state='failed',failure_code='LOCAL_EFFECT_FAILED',lease_owner=NULL,lease_until=0 WHERE id=? AND state='running' AND lease_owner=? AND lease_until>=?").run(job.id, job.lease_owner, now);
    return result.changes === 1;
  }
  attachmentPath(id: string) {
    if (!VALID_ID.test(id)) throw new Error('INVALID_MARKER');
    ensurePrivateDirectory(this.config.attachments, this.config.root);
    return join(this.config.attachments, id + '.json');
  }
  readAttachment(id: string) {
    const job = this.db.prepare("SELECT id FROM dev_jobs WHERE id=? AND state='completed'").get(id);
    if (!job) throw new Error('ATTACHMENT_NOT_READY');
    const path = this.attachmentPath(id);
    validateRuntimeFile(path);
    return readFileSync(path, 'utf8');
  }
  state() {
    const heartbeat = this.db.prepare('SELECT updated_at FROM dev_heartbeat WHERE id=1').get();
    return { instance_id: this.config.instanceId, profile: this.config.profile,
      database_engine: 'sqlite', commerce_qualified: false, external_effects: 'denied',
      migrations: this.db.prepare('SELECT version,sha256 FROM schema_migrations ORDER BY version').all(),
      worker_last_seen: heartbeat?.updated_at ?? null,
      markers: this.db.prepare('SELECT id,value FROM dev_markers ORDER BY id').all(),
      jobs: this.db.prepare('SELECT id,value,state,attempts,failure_code FROM dev_jobs ORDER BY id').all() };
  }
}
