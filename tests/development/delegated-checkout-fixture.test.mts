import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, chmodSync, readFileSync, readdirSync, rmSync, writeFileSync,
  symlinkSync, linkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fork, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { digest } from '../../packages/commerce/kernel.mts';
import { childEnvironment } from '../../packages/development/config.mts';
import { openCheckoutFixture, readCheckoutFixtureSnapshot } from '../../packages/development/delegated-checkout-fixture.mts';
import type { FixtureReady } from '../../packages/development/delegated-checkout-fixture.mts';

const entry = fileURLToPath(new URL('../../tools/delegated-checkout-fixture-server.mts', import.meta.url));
const execArgv = ['--no-warnings', '--experimental-strip-types'];
async function directory(fn: (path: string) => Promise<void>) {
  const path = mkdtempSync(join(tmpdir(), 'rifare-checkout-fixture-test-'));
  try { await fn(path); } finally { rmSync(path, { recursive: true, force: true }); }
}
async function request(ready: FixtureReady, bearer: string, operation: string, body?: unknown) {
  const response = await fetch(ready.url + '/v1/delegated-checkout/' + operation, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: 'Bearer ' + bearer, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(3000),
  });
  return { status: response.status, body: await response.json() };
}
function files(path: string) {
  return Object.fromEntries(readdirSync(path).sort().map(name => [name, digest(readFileSync(join(path, name)))]));
}
async function exit(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null || child.signalCode !== null) return child.exitCode;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('FIXTURE_CHILD_EXIT_TIMEOUT')); }, 5000);
    child.once('exit', code => { clearTimeout(timer); resolve(code); });
  });
}
function child(configuration: string[], arguments_: string[] = []) {
  const process = fork(entry, arguments_, { execArgv, env: childEnvironment(), stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let stdout = '', stderr = '';
  const messages: unknown[] = [];
  process.stdout!.on('data', value => { stdout += String(value); if (stdout.length > 4096) process.kill('SIGKILL'); });
  process.stderr!.on('data', value => { stderr += String(value); if (stderr.length > 4096) process.kill('SIGKILL'); });
  const ready = new Promise<Record<string, any>>((resolve, reject) => {
    const timer = setTimeout(() => { process.kill('SIGKILL'); reject(new Error('FIXTURE_CHILD_READY_TIMEOUT')); }, 8000);
    process.on('message', message => {
      messages.push(message);
      if ((message as any)?.awaiting_configuration === true) process.send(configuration);
      else { clearTimeout(timer); resolve(message as Record<string, any>); }
    });
    process.once('error', error => { clearTimeout(timer); reject(error); });
    process.once('exit', () => { clearTimeout(timer); reject(new Error('FIXTURE_CHILD_EARLY_EXIT')); });
  });
  return { process, ready, messages, output: () => ({ stdout, stderr }) };
}

test('RCG5A-FIXTURE-NATIVE-COMPOSITION', () => directory(async path => {
  const f = await openCheckoutFixture(path, 'fixture-a', 'fresh');
  try {
    const r = f.ready, c = r.credentials!;
    assert.equal(r.event, 'checkout_fixture_ready'); assert.equal(r.mode, 'fresh');
    assert.equal(r.pid, process.pid); assert.equal(r.instance_id, 'fixture-a'); assert.equal(r.intent_count, 0);
    assert.match(r.url, /^http:\/\/127\.0\.0\.1:\d+$/); assert.match(c.bearer, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(c.primary.preview_id, c.pending.preview_id); assert.notEqual(c.primary.context_id, c.pending.context_id);
    const preview = await request(r, c.bearer, 'preview', c.preview_request);
    assert.equal(preview.status, 200); assert.equal(preview.body.execution_authorized, false);
    assert.equal(preview.body.result.total_payable_minor, '6800'); assert.equal(preview.body.result.currency, 'USD');
  } finally { await f.close(); }
  assert.equal(readCheckoutFixtureSnapshot(path, 'fixture-a').intent_count, 0);
  await assert.rejects(fetch(f.ready.url + '/health', { signal: AbortSignal.timeout(1000) }));
}));

test('RCG5A-FIXTURE-TRANSIENT-SECRETS', () => directory(async path => {
  const f = await openCheckoutFixture(path, 'secrets', 'fresh');
  const c = f.ready.credentials!; await f.close();
  assert.deepEqual(readdirSync(path).sort(), ['commerce.sqlite', 'fixture.json', 'source.sqlite']);
  for (const name of readdirSync(path)) {
    const bytes = readFileSync(join(path, name));
    for (const secret of [c.bearer, c.primary.compact_jws, c.pending.compact_jws, 'context-primary', 'context-pending',
      'PRIVATE KEY', 'private_jwk', 'urn:rifare:synthetic:receipt-issuer']) assert.equal(bytes.includes(secret), false, name);
  }
  assert.equal(readCheckoutFixtureSnapshot(path, 'secrets').session_count, 2);
}));

test('RCG5A-FIXTURE-HISTORY-WITHOUT-LIVE-OWNERS', () => directory(async path => {
  const fresh = await openCheckoutFixture(path, 'history', 'fresh'), c = fresh.ready.credentials!;
  let first: any, pending: any;
  try {
    first = await request(fresh.ready, c.bearer, 'prepare', { preview_id: c.primary.preview_id, context_id: c.primary.context_id });
    pending = await request(fresh.ready, c.bearer, 'prepare', { preview_id: c.pending.preview_id, context_id: c.pending.context_id });
    assert.equal(first.status, 200); assert.equal(pending.status, 200);
    const capture = await request(fresh.ready, c.bearer, 'receipt', { intent_id: first.body.result.intent_id, compact_jws: c.primary.compact_jws });
    assert.equal(capture.status, 200); assert.equal(capture.body.result.state, 'evidence_verified');
  } finally { await fresh.close(); }
  const before = readCheckoutFixtureSnapshot(path, 'history');
  const history = await openCheckoutFixture(path, 'history', 'history');
  try {
    assert.equal('credentials' in history.ready, false); assert.equal(history.ready.intent_count, 2);
    assert.equal(history.ready.effects_digest, fresh.ready.effects_digest);
    const retained = await request(history.ready, c.bearer, 'status', { intent_id: first.body.result.intent_id });
    assert.equal(retained.status, 200); assert.equal(retained.body.result.state, 'evidence_verified');
    assert.equal((await request(history.ready, c.bearer, 'receipt', { intent_id: first.body.result.intent_id, compact_jws: c.primary.compact_jws })).status, 200);
    assert.equal((await request(history.ready, c.bearer, 'receipt', { intent_id: pending.body.result.intent_id, compact_jws: c.pending.compact_jws })).status, 503);
    assert.equal((await request(history.ready, c.bearer, 'preview', c.preview_request)).status, 503);
  } finally { await history.close(); }
  assert.deepEqual(readCheckoutFixtureSnapshot(path, 'history'), before);
}));

test('RCG5A-FIXTURE-REVOKED-SESSION-RESTART', () => directory(async path => {
  const fresh = await openCheckoutFixture(path, 'revoked', 'fresh'), bearer = fresh.ready.credentials!.bearer;
  await fresh.close(); const before = readCheckoutFixtureSnapshot(path, 'revoked');
  const db = new DatabaseSync(join(path, 'commerce.sqlite'));
  try { assert.equal(db.prepare('UPDATE commerce_sessions SET revoked=1 WHERE token_hash=?').run(digest(bearer)).changes, 1); }
  finally { db.close(); }
  const history = await openCheckoutFixture(path, 'revoked', 'history');
  try { assert.equal((await request(history.ready, bearer, 'contract')).status, 403); assert.equal('credentials' in history.ready, false); }
  finally { await history.close(); }
  assert.deepEqual(readCheckoutFixtureSnapshot(path, 'revoked'), before);
}));

test('RCG5A-FIXTURE-CHANGED-PROOF-RESTART', () => directory(async path => {
  const fresh = await openCheckoutFixture(path, 'proof', 'fresh'), bearer = fresh.ready.credentials!.bearer;
  await fresh.close(); const before = readCheckoutFixtureSnapshot(path, 'proof');
  const db = new DatabaseSync(join(path, 'commerce.sqlite'));
  try { db.prepare("UPDATE commerce_resources SET source_version=source_version+1 WHERE kind='customer'").run(); }
  finally { db.close(); }
  const history = await openCheckoutFixture(path, 'proof', 'history');
  try {
    const result = await request(history.ready, bearer, 'contract');
    assert.equal(result.status, 403); assert.equal(result.body.error, 'CUSTOMER_VERIFICATION_REQUIRED');
  } finally { await history.close(); }
  assert.deepEqual(readCheckoutFixtureSnapshot(path, 'proof'), before);
}));

test('RCG5A-FIXTURE-FRESH-REFUSES-EXISTING', () => directory(async path => {
  writeFileSync(join(path, 'sentinel'), 'preserve this file', { mode: 0o600 }); const before = files(path);
  await assert.rejects(openCheckoutFixture(path, 'fresh', 'fresh'), /CHECKOUT_FIXTURE_NOT_EMPTY/);
  assert.deepEqual(files(path), before);
}));

test('RCG5A-FIXTURE-PATH-AND-MODE-REFUSAL', () => directory(async path => {
  const target = join(path, 'target'); mkdirSync(target, { mode: 0o700 });
  const alias = join(path, 'alias'); symlinkSync(target, alias);
  for (const [directory, identity, mode] of [[alias, 'id', 'fresh'], ['relative', 'id', 'fresh'],
    [target, '../bad', 'fresh'], [target, 'id', 'unknown']] as const)
    await assert.rejects(openCheckoutFixture(directory, identity, mode as any));
  chmodSync(target, 0o755); await assert.rejects(openCheckoutFixture(target, 'id', 'fresh'));
  assert.deepEqual(readdirSync(target), []);
}));

test('RCG5A-FIXTURE-HISTORY-NEVER-INITIALIZES', () => directory(async path => {
  await assert.rejects(openCheckoutFixture(path, 'absent', 'history'));
  assert.deepEqual(readdirSync(path), []);
  writeFileSync(join(path, 'fixture.json'), '{}', { mode: 0o600 });
  const before = files(path); await assert.rejects(openCheckoutFixture(path, 'absent', 'history'));
  assert.deepEqual(files(path), before);
}));

test('RCG5A-FIXTURE-MARKER-IDENTITY', () => directory(async path => {
  const f = await openCheckoutFixture(path, 'original', 'fresh'); await f.close();
  const before = files(path); await assert.rejects(openCheckoutFixture(path, 'replacement', 'history'));
  assert.deepEqual(files(path), before);
  const text = readFileSync(join(path, 'fixture.json'), 'utf8'), marker = JSON.parse(text);
  writeFileSync(join(path, 'fixture.json'), text.replace('{', '{"instance_id":"wrong",'));
  const duplicate = files(path); await assert.rejects(openCheckoutFixture(path, 'original', 'history'));
  assert.deepEqual(files(path), duplicate);
  marker.extra = 'unsupported'; writeFileSync(join(path, 'fixture.json'), JSON.stringify(marker));
  const changed = files(path); await assert.rejects(openCheckoutFixture(path, 'original', 'history'));
  assert.deepEqual(files(path), changed);
}));

test('RCG5A-FIXTURE-DATABASE-REFUSAL', () => directory(async path => {
  const f = await openCheckoutFixture(path, 'database', 'fresh'); await f.close();
  writeFileSync(join(path, 'commerce.sqlite'), ''); const before = files(path);
  await assert.rejects(openCheckoutFixture(path, 'database', 'history'));
  assert.deepEqual(files(path), before);
}));

test('RCG5A-FIXTURE-LINK-REFUSAL', () => directory(async path => {
  const instance = join(path, 'instance'); mkdirSync(instance, { mode: 0o700 });
  const f = await openCheckoutFixture(instance, 'links', 'fresh'); await f.close();
  const target = join(path, 'source-copy'); writeFileSync(target, readFileSync(join(instance, 'source.sqlite')), { mode: 0o600 });
  const expected = digest(readFileSync(target)); unlinkSync(join(instance, 'source.sqlite'));
  symlinkSync(target, join(instance, 'source.sqlite'));
  await assert.rejects(openCheckoutFixture(instance, 'links', 'history'));
  unlinkSync(join(instance, 'source.sqlite')); linkSync(target, join(instance, 'source.sqlite'));
  await assert.rejects(openCheckoutFixture(instance, 'links', 'history'));
  assert.equal(digest(readFileSync(target)), expected);
}));

test('RCG5A-FIXTURE-SNAPSHOT-READ-ONLY', () => directory(async path => {
  const f = await openCheckoutFixture(path, 'snapshot', 'fresh'); await f.close();
  const before = files(path), state = readCheckoutFixtureSnapshot(path, 'snapshot');
  assert.deepEqual(Object.keys(state).sort(), ['effects_digest', 'intent_count', 'session_count']);
  assert.equal(state.effects_digest, f.ready.effects_digest); assert.equal(state.intent_count, 0);
  assert.deepEqual(files(path), before);
}));

test('RCG5A-FIXTURE-CHILD-REQUIRES-IPC', () => {
  const result = spawnSync(process.execPath, [...execArgv, entry], { env: childEnvironment(), timeout: 5000, encoding: 'utf8' });
  assert.equal(result.status, 1); assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
});

test('RCG5A-FIXTURE-CHILD-INVALID-CONFIGURATION', () => directory(async path => {
  const f = child([path, 'child', 'unsupported']);
  try {
    assert.deepEqual(await f.ready, { event: 'checkout_fixture_failed', code: 'CHECKOUT_FIXTURE_START_FAILED' });
    assert.equal(await exit(f.process), 1); assert.deepEqual(f.output(), { stdout: '', stderr: '' });
    assert.deepEqual(readdirSync(path), []);
  } finally { if (f.process.exitCode === null && f.process.signalCode === null) { f.process.kill(); await exit(f.process); } }
}));

test('RCG5A-FIXTURE-CHILD-REJECTS-CLI-ARGUMENTS', () => directory(async path => {
  const f = child([path, 'child', 'fresh'], ['--unexpected']);
  try {
    assert.deepEqual(await f.ready, { event: 'checkout_fixture_failed', code: 'CHECKOUT_FIXTURE_START_FAILED' });
    assert.equal(await exit(f.process), 1); assert.deepEqual(readdirSync(path), []);
  } finally { if (f.process.exitCode === null && f.process.signalCode === null) { f.process.kill(); await exit(f.process); } }
}));

test('RCG5A-FIXTURE-CHILD-DISCONNECT-CLOSES', () => directory(async path => {
  const f = child([path, 'child', 'fresh']);
  try {
    const ready = await f.ready; assert.equal(ready.event, 'checkout_fixture_ready');
    assert.equal(ready.pid, f.process.pid); assert.notEqual(ready.pid, process.pid);
    assert.equal((await fetch(ready.url + '/health')).status, 200);
    f.process.disconnect(); assert.equal(await exit(f.process), 0);
    await assert.rejects(fetch(ready.url + '/health', { signal: AbortSignal.timeout(1000) }));
    assert.equal(readCheckoutFixtureSnapshot(path, 'child').intent_count, 0);
    assert.equal(f.messages.filter((m: any) => m?.event === 'checkout_fixture_ready').length, 1);
    assert.deepEqual(f.output(), { stdout: '', stderr: '' });
  } finally { if (f.process.exitCode === null && f.process.signalCode === null) { f.process.kill(); await exit(f.process); } }
}));
