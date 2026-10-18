import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { devNull } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { CommerceKernel, digest, exact, id, integer } from '../commerce/kernel.mts';
import { Capabilities } from '../commerce/capabilities.mts';
import { StoreSimulator, FIXTURE_CLOCK } from '../commerce/simulator.mts';
import { canonical, contentDigest } from '../commerce/configuration-values.mts';
import { storageInventoryCurrent } from '../commerce/privacy-lifecycle.mts';
import { createRecoverySnapshot, restoreRecoverySnapshot, suppressionCheckpoint } from '../commerce/safe-recovery.mts';
import { childEnvironment } from '../development/config.mts';

export type Artifact = { bundle_path: string; bundle_sha256: string; commit: string; tree: string };
export type InstallationRef = { directory: string; manifest_sha256: string };
type PhaseObserver = (phase: 'artifact_checked' | 'database_prepared') => void;
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PROFILE = 'commerce-sqlite-diagnostic';
const CRITICAL = ['package.json', 'packages/commerce/kernel.mts', 'packages/commerce/safe-recovery.mts', 'tools/dev-target.mts'];

function fail(code: string): never { throw new Error(code); }
function hash(value: unknown, size = 64): string {
  if (typeof value !== 'string' || !new RegExp(`^[a-f0-9]{${size}}$`).test(value)) fail('ARTIFACT_PIN_INVALID');
  return value;
}
function safePath(value: string): string {
  if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value) fail('INSTALLATION_PATH_UNSAFE');
  let at = value;
  for (;;) {
    try { if (lstatSync(at).isSymbolicLink()) fail('INSTALLATION_PATH_UNSAFE'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (at === dirname(at)) break;
    at = dirname(at);
  }
  return value;
}
function regular(value: string, maximum = 128 * 1024 * 1024): Buffer {
  safePath(value);
  const s = lstatSync(value);
  if (!s.isFile() || s.nlink !== 1 || s.size > maximum) fail('INSTALLATION_FILE_UNSAFE');
  return readFileSync(value);
}
function reserve(destination: string) {
  safePath(destination);
  if (existsSync(destination)) fail('INSTALLATION_TARGET_EXISTS');
  try { mkdirSync(destination, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') fail('INSTALLATION_TARGET_EXISTS'); throw error; }
  writeFileSync(join(destination, 'preparing.json'), canonical({ profile: PROFILE, state: 'preparing', created_at: Date.now() }), { mode: 0o600, flag: 'wx' });
}
function git(...args: string[]): string {
  try {
    return execFileSync('git', ['--no-optional-locks', '-c', `core.hooksPath=${devNull}`, '-c', 'protocol.allow=never', '-c', 'protocol.file.allow=always', ...args], {
      encoding: 'utf8', timeout: 15000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...childEnvironment(), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: devNull, GIT_TERMINAL_PROMPT: '0' },
    }).trim();
  } catch { fail('ARTIFACT_GIT_COMMAND_FAILED'); }
}
function migrations(source: string) {
  const directory = join(source, 'migrations/commerce');
  safePath(directory);
  return readdirSync(directory).filter(name => name.endsWith('.sql')).sort().map(version => ({ version, sha256: digest(regular(join(directory, version), 1024 * 1024)) }));
}
function checkArtifact(value: Artifact): Buffer {
  exact(value, ['bundle_path', 'bundle_sha256', 'commit', 'tree']);
  hash(value.bundle_sha256); hash(value.commit, 40); hash(value.tree, 40);
  const bytes = regular(value.bundle_path);
  if (digest(bytes) !== value.bundle_sha256) fail('ARTIFACT_CHECKSUM_MISMATCH');
  const header = bytes.subarray(0, Math.min(bytes.length, 1024 * 1024)).toString('latin1').split('\n\n', 1)[0];
  if (!/^# v[23] git bundle\n/.test(header) || header.split('\n').some(line => line.startsWith('-'))) fail('ARTIFACT_FULL_BUNDLE_REQUIRED');
  if (git('-C', ROOT, 'rev-parse', 'HEAD') !== value.commit || git('-C', ROOT, 'rev-parse', 'HEAD^{tree}') !== value.tree
    || git('-C', ROOT, 'status', '--porcelain=v1')) fail('ARTIFACT_RUNTIME_SOURCE_MISMATCH');
  return bytes;
}
function materializeArtifact(artifact: Artifact, destination: string, bytes: Buffer) {
  writeFileSync(join(destination, 'artifact.bundle'), bytes, { mode: 0o600, flag: 'wx' });
  const source = join(destination, 'source');
  git('clone', '--no-checkout', '--no-hardlinks', '--template=', '--', join(destination, 'artifact.bundle'), source);
  git('-C', source, 'checkout', '--detach', artifact.commit);
  if (git('-C', source, 'rev-parse', 'HEAD') !== artifact.commit || git('-C', source, 'rev-parse', 'HEAD^{tree}') !== artifact.tree) fail('ARTIFACT_IDENTITY_MISMATCH');
  git('-C', source, 'bundle', 'verify', join(destination, 'artifact.bundle'));
  if (!migrations(source).length || contentDigest(migrations(source)) !== contentDigest(migrations(ROOT))) fail('ARTIFACT_RUNTIME_SCHEMA_MISMATCH');
  for (const name of CRITICAL) if (digest(regular(join(source, name))) !== digest(regular(join(ROOT, name)))) fail('ARTIFACT_RUNTIME_SOURCE_MISMATCH');
  return { bundle_sha256: artifact.bundle_sha256, commit: artifact.commit, tree: artifact.tree,
    bundle_heads: git('bundle', 'list-heads', join(destination, 'artifact.bundle')).split('\n') };
}
function history(db: DatabaseSync, source: string, complete = true) {
  const files = migrations(source);
  const rows = db.prepare('SELECT version,sha256 FROM commerce_migrations ORDER BY version').all();
  if (rows.some((row, i) => files[i]?.version !== row.version) || (complete && rows.length !== files.length)) fail('MIGRATION_HISTORY_INVALID');
  if (rows.some((row, i) => files[i].sha256 !== row.sha256)) fail('MIGRATION_CHECKSUM_MISMATCH');
  return rows;
}
function closedDatabase(file: string) {
  const bytes = regular(file, 64 * 1024 * 1024);
  for (const suffix of ['-wal', '-shm', '-journal']) if (existsSync(file + suffix)) fail('INSTALLATION_STOP_REQUIRED');
  return bytes;
}
function seed(k: CommerceKernel) {
  k.provisionStore('installation-demo', 'store');
  k.provisionMember('installation-demo', 'store', 'operator', 'owner');
  const scope = k.authenticate(k.issueSession('installation-demo', 'store', 'operator'));
  new StoreSimulator(k, new Capabilities(k)).reset(scope, { profile: 'apparel', clock: FIXTURE_CLOCK });
  k.revoke(scope);
}
function finish(destination: string, artifact: any, details: any) {
  const database = join(destination, 'data/database.sqlite');
  const db = new DatabaseSync(database, { readOnly: true, allowExtension: false });
  let rows;
  try { rows = history(db, join(destination, 'source')); }
  finally { db.close(); }
  const manifest = { version: 1, state: 'prepared', profile: PROFILE, artifact,
    migrations: rows, initial_database_sha256: digest(regular(database)), created_at: Date.now(), ...details,
    model_required: false, license_activation_required: false, live_activation_supported: false,
    public_release: false, independent_machine_qualified: false,
    observed_host: { platform: process.platform, architecture: process.arch, node: process.version },
  };
  const raw = canonical(manifest);
  writeFileSync(join(destination, 'installation.json'), raw, { mode: 0o600, flag: 'wx' });
  return { directory: destination, database, manifest_sha256: digest(raw), mode: details.mode, migration_count: rows!.length,
    model_required: false, license_activation_required: false, live_activation_supported: false, independent_machine_qualified: false };
}

/** Server-local offline administration. No public tenant route or activation service. */
export function installOffline(input: { artifact: Artifact; destination: string; profile: string; seed_demo: boolean }) {
  exact(input, ['artifact', 'destination', 'profile', 'seed_demo']);
  if (input.profile !== PROFILE) fail('TARGET_STACK_NOT_QUALIFIED');
  if (typeof input.seed_demo !== 'boolean') fail('INVALID_INPUT');
  const bytes = checkArtifact(input.artifact);
  reserve(input.destination);
  const artifact = materializeArtifact(input.artifact, input.destination, bytes);
  mkdirSync(join(input.destination, 'data'), { mode: 0o700 });
  const db = new DatabaseSync(join(input.destination, 'data/database.sqlite'), { allowExtension: false });
  try {
    chmodSync(join(input.destination, 'data/database.sqlite'), 0o600);
    const k = new CommerceKernel(db);
    storageInventoryCurrent(k);
    if (input.seed_demo) seed(k);
  } finally { db.close(); }
  return finish(input.destination, artifact, { operation: 'install', mode: 'diagnostic_only', seeded_demo: input.seed_demo, rollback: null });
}

export function inspectInstallation(input: InstallationRef) {
  exact(input, ['directory', 'manifest_sha256']); safePath(input.directory); hash(input.manifest_sha256);
  const manifestFile = join(input.directory, 'installation.json');
  if (!existsSync(manifestFile)) fail('INSTALLATION_INCOMPLETE');
  const raw = regular(manifestFile, 262144);
  if (digest(raw) !== input.manifest_sha256) fail('INSTALLATION_MANIFEST_MISMATCH');
  const m = JSON.parse(raw.toString());
  if (m.version !== 1 || m.state !== 'prepared' || m.profile !== PROFILE || m.live_activation_supported !== false || m.independent_machine_qualified !== false) fail('INSTALLATION_MANIFEST_INVALID');
  if (digest(regular(join(input.directory, 'artifact.bundle'))) !== hash(m.artifact.bundle_sha256)) fail('ARTIFACT_CHECKSUM_MISMATCH');
  const source = join(input.directory, 'source'); safePath(source);
  if (git('-C', source, 'rev-parse', 'HEAD') !== m.artifact.commit || git('-C', source, 'rev-parse', 'HEAD^{tree}') !== m.artifact.tree
    || git('-C', source, 'status', '--porcelain=v1', '--untracked-files=no')) fail('ARTIFACT_IDENTITY_MISMATCH');
  const database = join(input.directory, 'data/database.sqlite'); regular(database, 64 * 1024 * 1024);
  const db = new DatabaseSync(database, { readOnly: true, allowExtension: false });
  try {
    const rows = history(db, source);
    if (contentDigest(rows) !== contentDigest(m.migrations)) fail('MIGRATION_CHECKSUM_MISMATCH');
    if (db.prepare('PRAGMA foreign_key_check').all().length) fail('INSTALLATION_FOREIGN_KEYS_INVALID');
    const restored = db.prepare('SELECT mode FROM commerce_recovery_state WHERE id=1').get();
    return { directory: input.directory, database, manifest: m, migration_count: rows.length, mode: restored?.mode ?? 'diagnostic_only' };
  } finally { db.close(); }
}

/** Prepares a second stopped installation; it never replaces or activates the source. */
export function prepareUpgrade(input: { artifact: Artifact; destination: string; source: InstallationRef }, observe: PhaseObserver = () => {}) {
  exact(input, ['artifact', 'destination', 'source']);
  const bytes = checkArtifact(input.artifact), prior = inspectInstallation(input.source);
  if (existsSync(join(prior.directory, 'diagnostic-session.json'))) fail('INSTALLATION_STOP_REQUIRED');
  const original = closedDatabase(prior.database), originalHash = digest(original);
  reserve(input.destination);
  const artifact = materializeArtifact(input.artifact, input.destination, bytes);
  observe('artifact_checked');
  const candidate = join(input.destination, 'candidate.sqlite');
  writeFileSync(candidate, original, { mode: 0o600, flag: 'wx' });
  const db = new DatabaseSync(candidate, { allowExtension: false });
  let rollback: any = null;
  try {
    const sameSchema = contentDigest(prior.manifest.migrations) === contentDigest(migrations(ROOT));
    const k = new CommerceKernel(db); // The unchanged kernel applies all new migrations in one transaction.
    storageInventoryCurrent(k);
    if (sameSchema) {
      const snapshot = createRecoverySnapshot(k, join(input.destination, 'rollback'));
      rollback = { manifest_sha256: snapshot.manifest_sha256, database_sha256: snapshot.database_sha256,
        source_artifact: prior.manifest.artifact, same_schema: true };
    }
    const snapshot = createRecoverySnapshot(k, join(input.destination, 'upgrade-snapshot'));
    const cp = suppressionCheckpoint(k);
    writeFileSync(join(input.destination, 'suppression.json'), canonical(cp), { mode: 0o600, flag: 'wx' });
    restoreRecoverySnapshot({ snapshot: snapshot.directory, destination: join(input.destination, 'data'), manifest_sha256: snapshot.manifest_sha256,
      suppression: cp, suppression_sha256: contentDigest(cp) });
  } finally { db.close(); }
  observe('database_prepared');
  if (digest(closedDatabase(prior.database)) !== originalHash) fail('INSTALLATION_SOURCE_CHANGED');
  return finish(input.destination, artifact, { operation: 'upgrade', mode: 'quarantine', seeded_demo: prior.manifest.seeded_demo,
    source: { artifact: prior.manifest.artifact, manifest_sha256: input.source.manifest_sha256, database_sha256: originalHash }, rollback,
    rollback_limit: rollback ? null : 'Use the preserved original installation and its matching artifact; cross-schema restore is not supported.' });
}

/** Rollback is a fresh quarantine restore, with a caller-pinned current erasure checkpoint. */
export function rollbackUpgrade(input: { upgrade: InstallationRef; destination: string; suppression: unknown; suppression_sha256: string }) {
  exact(input, ['upgrade', 'destination', 'suppression', 'suppression_sha256']);
  const upgraded = inspectInstallation(input.upgrade), rollback = upgraded.manifest.rollback;
  if (upgraded.manifest.operation !== 'upgrade' || !rollback?.same_schema) fail('MIGRATION_ROLLBACK_ARTIFACT_REQUIRED');
  const artifact: Artifact = { bundle_path: join(upgraded.directory, 'artifact.bundle'), ...upgraded.manifest.artifact };
  delete (artifact as any).bundle_heads;
  const bytes = checkArtifact(artifact);
  reserve(input.destination);
  const pinned = materializeArtifact(artifact, input.destination, bytes);
  const result = restoreRecoverySnapshot({ snapshot: join(upgraded.directory, 'rollback'), destination: join(input.destination, 'data'),
    manifest_sha256: rollback.manifest_sha256, suppression: input.suppression, suppression_sha256: input.suppression_sha256 });
  return finish(input.destination, pinned, { operation: 'rollback', mode: result.mode, seeded_demo: upgraded.manifest.seeded_demo,
    rollback: null, restored_source_artifact: rollback.source_artifact, binary_selection: 'current_compatible_schema_artifact',
    restored_snapshot_sha256: rollback.database_sha256 });
}

/** Uses the existing shared HTTP/UI server with no provider, sender or vault configured. */
export async function startInstalledDiagnostic(input: InstallationRef & { tenant_id: string; store_id: string; actor_id: string; port: number }) {
  exact(input, ['directory', 'manifest_sha256', 'tenant_id', 'store_id', 'actor_id', 'port']);
  for (const value of [input.tenant_id, input.store_id, input.actor_id]) id(value);
  integer(input.port); if (input.port > 65535) fail('INVALID_PORT');
  const installed = inspectInstallation({ directory: input.directory, manifest_sha256: input.manifest_sha256 });
  const sessionFile = join(input.directory, 'diagnostic-session.json');
  writeFileSync(sessionFile, canonical({ state: 'starting', pid: process.pid }), { mode: 0o600, flag: 'wx' });
  const db = new DatabaseSync(installed.database, { allowExtension: false });
  let server: { url: string; close: () => Promise<void> } | undefined;
  let bearer: string | undefined;
  try {
    const sourceModule = (name: string) => import(pathToFileURL(join(installed.directory, 'source', name)).href);
    const { CommerceKernel: InstalledKernel } = await sourceModule('packages/commerce/kernel.mts');
    const { Capabilities: InstalledCapabilities } = await sourceModule('packages/commerce/capabilities.mts');
    const { StoreSimulator: InstalledSimulator } = await sourceModule('packages/commerce/simulator.mts');
    const k = new InstalledKernel(db), caps = new InstalledCapabilities(k), simulator = new InstalledSimulator(k, caps);
    bearer = k.issueSession(input.tenant_id, input.store_id, input.actor_id);
    const { startCommerceServer } = await sourceModule('apps/commerce-api/server.mts');
    const { CustomerAccess } = await sourceModule('packages/commerce/customer-access.mts');
    server = await startCommerceServer({ kernel: k, caps, simulator, customers: new CustomerAccess(k, () => { fail('LOCAL_DELIVERY_NOT_CONFIGURED'); }), port: input.port });
    writeFileSync(sessionFile, canonical({ state: 'ready', pid: process.pid, url: server.url, bearer, expires_in_seconds: 3600 }), { mode: 0o600 });
    let closed = false;
    return { url: server.url, private_session_file: sessionFile, model_required: false, profile: PROFILE,
      independent_machine_qualified: false, live_activation_supported: false,
      close: async () => {
        if (closed) return; closed = true;
        await server!.close();
        db.prepare('UPDATE commerce_sessions SET revoked=1 WHERE token_hash=?').run(digest(bearer!));
        db.close(); unlinkSync(sessionFile);
      } };
  } catch (error) {
    await server?.close();
    if (bearer) db.prepare('UPDATE commerce_sessions SET revoked=1 WHERE token_hash=?').run(digest(bearer));
    db.close(); unlinkSync(sessionFile); throw error;
  }
}
