import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync, existsSync, symlinkSync, linkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { CommerceKernel, digest } from '../../packages/commerce/kernel.mts';
import { Capabilities } from '../../packages/commerce/capabilities.mts';
import { ReadContext } from '../../packages/commerce/read-context.mts';
import { contentDigest } from '../../packages/commerce/configuration-values.mts';
import { suppressionCheckpoint } from '../../packages/commerce/safe-recovery.mts';
import { exportMerchant, exportMerchantSuppression, importMerchant, merchantSnapshotDigest } from '../../packages/commerce/merchant-portability.mts';
import { installOffline, prepareUpgrade, rollbackUpgrade, inspectInstallation, startInstalledDiagnostic } from '../../packages/operations/installation-upgrade.mts';

const root = resolve(import.meta.dirname, '../..');
let directory: string;
let artifact: { bundle_path: string; bundle_sha256: string; commit: string; tree: string };
let serial = 0;
const place = (label: string) => join(directory, `${++serial}-${label}`);
const current = (installation: any) => ({ directory: installation.directory, manifest_sha256: installation.manifest_sha256 });
const install = () => installOffline({ artifact, destination: place('installed'), profile: 'commerce-sqlite-diagnostic', seed_demo: true });
function withKernel<T>(installation: any, fn: (k: CommerceKernel) => T): T {
  const db = new DatabaseSync(installation.database);
  try { return fn(new CommerceKernel(db)); } finally { db.close(); }
}
function status(k: CommerceKernel) {
  const scope = k.authenticate(k.issueSession('installation-demo', 'store', 'operator'));
  const order = k.lookup(scope, 'order', 'synthetic', 'ORD-1001');
  return new ReadContext(k, new Capabilities(k)).orderStatus(scope, order.id);
}
before(() => {
  directory = mkdtempSync(join(tmpdir(), 'rifare-installation-'));
  const bundle_path = join(directory, 'source.bundle');
  execFileSync('git', ['-C', root, 'bundle', 'create', bundle_path, 'HEAD'], { stdio: 'pipe' });
  artifact = { bundle_path, bundle_sha256: digest(readFileSync(bundle_path)),
    commit: execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    tree: execFileSync('git', ['-C', root, 'rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim() };
});
after(() => rmSync(directory, { recursive: true, force: true }));

test('CASE-M07-G10-01 clean install, seed and staged upgrade preserve the shared deterministic workflow', () => {
  const request = place('request.json');
  writeFileSync(request, JSON.stringify({ artifact, destination: place('cli-installed'), profile: 'commerce-sqlite-diagnostic', seed_demo: true }));
  const run = spawnSync(process.execPath, ['--experimental-strip-types', join(root, 'tools/install-upgrade.mts'), 'install', request], { encoding: 'utf8', timeout: 10000 });
  assert.equal(run.status, 0, run.stderr);
  const installed = JSON.parse(run.stdout);
  const before = withKernel(installed, k => {
    assert.equal(k.db.prepare('SELECT count(*) AS n FROM commerce_migrations').get()!.n, 35);
    assert.equal(k.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get()!.n, 186);
    const observed = status(k);
    assert.equal(observed.order.number, 'ORD-1001');
    assert.deepEqual(observed.order.totals, { amount_minor: 12500, currency: 'USD' });
    return observed.order;
  });
  const sourceHash = digest(readFileSync(installed.database));
  const upgraded = prepareUpgrade({ artifact, destination: place('upgrade'), source: current(installed) });
  assert.equal(digest(readFileSync(installed.database)), sourceHash);
  assert.equal(upgraded.mode, 'quarantine');
  assert.deepEqual(withKernel(upgraded, k => status(k).order), before);
  assert.equal(inspectInstallation(current(upgraded)).migration_count, 35);
  assert.equal(digest(readFileSync(join(upgraded.directory, 'artifact.bundle'))), artifact.bundle_sha256);
});

test('CASE-M07-G10-02 missing proprietary activation and model services do not prevent local installation', () => {
  const request = place('offline.json');
  writeFileSync(request, JSON.stringify({ artifact, destination: place('offline'), profile: 'commerce-sqlite-diagnostic', seed_demo: true }));
  const env = { PATH: process.env.PATH, NODE_ENV: 'development' };
  const run = spawnSync(process.execPath, ['--experimental-strip-types', join(root, 'tools/install-upgrade.mts'), 'install', request], { encoding: 'utf8', env, timeout: 10000 });
  assert.equal(run.status, 0, run.stderr);
  const installed = JSON.parse(run.stdout);
  assert.equal(withKernel(installed, k => status(k).order.fulfillment_status), 'shipped');
  assert.equal(installed.model_required, false);
  assert.equal(installed.license_activation_required, false);
  const target = spawnSync(process.execPath, ['--experimental-strip-types', join(installed.directory, 'source/tools/dev-target.mts')], { encoding: 'utf8', env });
  assert.equal(target.status, 2);
  assert.match(target.stderr, /TARGET_STACK_NOT_QUALIFIED/);
});

test('CASE-M07-G10-03 interrupted preparation leaves the original usable and documented rollback stays quarantined', () => {
  const installed = install();
  const sourceHash = digest(readFileSync(installed.database));
  const interrupted = place('interrupted');
  assert.throws(() => prepareUpgrade({ artifact, destination: interrupted, source: current(installed) }, phase => {
    if (phase === 'database_prepared') throw new Error('DRILL_INTERRUPTED_BEFORE_READY');
  }), /DRILL_INTERRUPTED_BEFORE_READY/);
  assert.equal(digest(readFileSync(installed.database)), sourceHash);
  assert.equal(existsSync(join(interrupted, 'installation.json')), false);
  assert.throws(() => inspectInstallation({ directory: interrupted, manifest_sha256: '0'.repeat(64) }), /INSTALLATION_INCOMPLETE/);
  const upgraded = prepareUpgrade({ artifact, destination: place('upgrade'), source: current(installed) });
  const cp = withKernel(installed, k => suppressionCheckpoint(k));
  const restored = rollbackUpgrade({ upgrade: current(upgraded), destination: place('rollback'), suppression: cp, suppression_sha256: contentDigest(cp) });
  assert.equal(restored.mode, 'quarantine');
  assert.equal(withKernel(restored, k => status(k).order.number), 'ORD-1001');
  withKernel(restored, k => {
    const scope = k.authenticate(k.issueSession('installation-demo', 'store', 'operator'));
    assert.throws(() => k.authorize(scope, 'model.run'), /RESTORE_WRITE_BLOCKED/);
    assert.equal(k.db.prepare('SELECT mode FROM commerce_recovery_state WHERE id=1').get()!.mode, 'quarantine');
  });
});

test('M07-G10-PORT-003 operators retain the served deterministic status UI and HTTP read after model credentials disappear', async () => {
  const installed = install();
  const server = await startInstalledDiagnostic({ ...current(installed), tenant_id: 'installation-demo', store_id: 'store', actor_id: 'operator', port: 0 });
  const credentials = JSON.parse(readFileSync(server.private_session_file, 'utf8'));
  const envNames = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'RIFARE_MODEL_KEY'];
  const saved = envNames.map(name => process.env[name]);
  try {
    for (const name of envNames) delete process.env[name];
    const ui = await fetch(server.url + '/status');
    assert.equal(ui.status, 200);
    assert.match(await ui.text(), /Order status/i);
    const observed = await fetch(server.url + '/v1/lookup?kind=order&external_id=ORD-1001', { headers: { authorization: `Bearer ${credentials.bearer}` } });
    assert.equal(observed.status, 200);
    const order = await observed.json();
    assert.equal(order.payload.total_minor, 12500);
    const unauthenticated = await fetch(server.url + '/v1/lookup?kind=order&external_id=ORD-1001');
    assert.equal(unauthenticated.status, 403);
    assert.equal(server.model_required, false);
  } finally {
    envNames.forEach((name, i) => saved[i] === undefined ? delete process.env[name] : process.env[name] = saved[i]);
    await server.close();
  }
});

test('M07-G10-ARTIFACT-PINS checksum, commit, tree and runtime-source mismatches fail before readiness', () => {
  for (const patch of [{ bundle_sha256: '0'.repeat(64) }, { commit: '0'.repeat(40) }, { tree: '0'.repeat(40) }]) {
    const destination = place('bad-artifact');
    assert.throws(() => installOffline({ artifact: { ...artifact, ...patch }, destination, profile: 'commerce-sqlite-diagnostic', seed_demo: true }), /ARTIFACT_/);
    assert.equal(existsSync(join(destination, 'installation.json')), false);
  }
  const source = place('modified-installer');
  execFileSync('git', ['clone', '--no-checkout', '--template=', '--', artifact.bundle_path, source], { stdio: 'pipe' });
  execFileSync('git', ['-C', source, 'checkout', '--detach', artifact.commit], { stdio: 'pipe' });
  const transitive = join(source, 'packages/commerce/configuration-values.mts');
  writeFileSync(transitive, readFileSync(transitive, 'utf8') + '\n// Changed transitive runtime fixture.\n');
  const destination = place('mixed-runtime'), request = place('mixed-runtime.json');
  writeFileSync(request, JSON.stringify({ artifact, destination, profile: 'commerce-sqlite-diagnostic', seed_demo: true }));
  const mixed = spawnSync(process.execPath, ['--experimental-strip-types', join(source, 'tools/install-upgrade.mts'), 'install', request], { encoding: 'utf8', timeout: 10000 });
  assert.equal(mixed.status, 1);
  assert.match(mixed.stderr, /ARTIFACT_RUNTIME_SOURCE_MISMATCH/);
  assert.equal(existsSync(destination), false);
});

test('M07-G10-UNSAFE-DESTINATIONS existing directories, symlink parents and linked input artifacts are refused', () => {
  const existing = place('existing'); mkdirSync(existing); writeFileSync(join(existing, 'keep'), 'original');
  assert.throws(() => installOffline({ artifact, destination: existing, profile: 'commerce-sqlite-diagnostic', seed_demo: true }), /INSTALLATION_TARGET_EXISTS/);
  assert.equal(readFileSync(join(existing, 'keep'), 'utf8'), 'original');
  const alias = place('alias'); symlinkSync(existing, alias);
  assert.throws(() => installOffline({ artifact, destination: join(alias, 'child'), profile: 'commerce-sqlite-diagnostic', seed_demo: true }), /INSTALLATION_PATH_UNSAFE/);
  const hard = place('hard.bundle'); linkSync(artifact.bundle_path, hard);
  try { assert.throws(() => installOffline({ artifact: { ...artifact, bundle_path: hard }, destination: place('hard-install'), profile: 'commerce-sqlite-diagnostic', seed_demo: true }), /INSTALLATION_FILE_UNSAFE/); }
  finally { rmSync(hard); }
});

test('M07-G10-MIGRATION-GUARDS modified checksums and missing history remain fatal without changing the source database', () => {
  for (const sql of ["UPDATE commerce_migrations SET sha256='invalid' WHERE version=(SELECT min(version) FROM commerce_migrations)", 'DELETE FROM commerce_migrations WHERE version=(SELECT min(version) FROM commerce_migrations)']) {
    const installed = install();
    const db = new DatabaseSync(installed.database); db.exec(sql); db.close();
    const before = digest(readFileSync(installed.database));
    assert.throws(() => prepareUpgrade({ artifact, destination: place('bad-schema'), source: current(installed) }), /MIGRATION_CHECKSUM_MISMATCH|MIGRATION_HISTORY_INVALID/);
    assert.equal(digest(readFileSync(installed.database)), before);
  }
});

test('M07-G10-ROLLBACK-PINS backup corruption and stale suppression cannot produce a ready rollback', () => {
  const installed = install();
  const stale = withKernel(installed, k => suppressionCheckpoint(k));
  stale.generated_at = 0;
  const upgraded = prepareUpgrade({ artifact, destination: place('upgrade'), source: current(installed) });
  assert.throws(() => rollbackUpgrade({ upgrade: current(upgraded), destination: place('stale-rollback'), suppression: stale, suppression_sha256: contentDigest(stale) }), /SUPPRESSION_CHECKPOINT_STALE/);
  const path = join(upgraded.directory, 'rollback/database.sqlite');
  writeFileSync(path, Buffer.concat([readFileSync(path), Buffer.from('corruption')]));
  const cp = withKernel(installed, k => suppressionCheckpoint(k));
  assert.throws(() => rollbackUpgrade({ upgrade: current(upgraded), destination: place('bad-rollback'), suppression: cp, suppression_sha256: contentDigest(cp) }), /RECOVERY_DATABASE_MISMATCH/);
});

test('M07-G10-TRANSACTIONAL-MIGRATION a real failed migration rolls back its prior DDL before a repaired retry', () => {
  const db = new DatabaseSync(place('prior-schema.sqlite'));
  try {
    db.exec('PRAGMA foreign_keys=ON; CREATE TABLE commerce_migrations(version TEXT PRIMARY KEY,sha256 TEXT NOT NULL) STRICT');
    const files = readdirSync(join(root, 'migrations/commerce')).filter(x => x.endsWith('.sql')).sort();
    assert.equal(files.length, 35);
    for (const version of files.slice(0, 30)) {
      const bytes = readFileSync(join(root, 'migrations/commerce', version));
      db.exec(bytes.toString());
      db.prepare('INSERT INTO commerce_migrations VALUES(?,?)').run(version, digest(bytes));
    }
    // Migration 031 drops an index before renaming this table. A collision must
    // roll that DROP back as well as withholding the migration history record.
    db.exec('CREATE TABLE commerce_resolution_operations_before_woo(collision TEXT) STRICT');
    assert.throws(() => new CommerceKernel(db), /already another table|already exists/);
    assert.equal(db.prepare('SELECT count(*) n FROM commerce_migrations').get()!.n, 30);
    assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='index' AND name='commerce_resolution_operations_order'").get()!.n, 1);
    db.exec('DROP TABLE commerce_resolution_operations_before_woo');
    const k = new CommerceKernel(db);
    assert.equal(k.db.prepare('SELECT count(*) n FROM commerce_migrations').get()!.n, 35);
    assert.equal(k.db.prepare('PRAGMA foreign_key_check').all().length, 0);
  } finally { db.close(); }
});

test('M07-G10-MERCHANT-IMPORT a clean empty installation accepts a pinned merchant snapshot and retains quarantine', () => {
  const origin = install();
  const snapshot = withKernel(origin, k => {
    const scope = k.authenticate(k.issueSession('installation-demo', 'store', 'operator'));
    return exportMerchant(k, scope, { snapshot_id: 'installation_transfer' });
  });
  const target = installOffline({ artifact, destination: place('import-target'), profile: 'commerce-sqlite-diagnostic', seed_demo: false });
  withKernel(target, k => {
    k.provisionStore('installation-demo', 'store');
    k.provisionMember('installation-demo', 'store', 'operator', 'owner');
    const scope = k.authenticate(k.issueSession('installation-demo', 'store', 'operator'));
    const suppression = withKernel(origin, source => {
      const owner = source.authenticate(source.issueSession('installation-demo', 'store', 'operator'));
      return exportMerchantSuppression(source, owner);
    });
    const imported = importMerchant(k, scope, snapshot, snapshot.digest,
      { suppression, suppression_sha256: merchantSnapshotDigest(suppression) });
    assert.equal(imported.mode, 'quarantine');
    assert.equal(imported.live_activation_supported, false);
    assert.equal(k.db.prepare('SELECT count(*) n FROM commerce_resources').get()!.n, 7);
    assert.deepEqual(status(k).order.totals, { amount_minor: 12500, currency: 'USD' });
    assert.throws(() => k.authorize(scope, 'model.run'), /RESTORE_WRITE_BLOCKED/);
    assert.equal(k.db.prepare('SELECT count(*) n FROM commerce_members').get()!.n, 1);
  });
});
