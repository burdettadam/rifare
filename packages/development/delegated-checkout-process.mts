/** Disposable process demonstration. This is development composition, not a
 * provider adapter, deployment controller, sandbox or commerce authority owner. */
import assert from 'node:assert/strict';
import { fork, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnvironment } from './config.mts';
import { readCheckoutFixtureSnapshot } from './delegated-checkout-fixture.mts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CLIENT = new URL('../../clients/delegated_checkout.py', import.meta.url);
const SERVER = fileURLToPath(new URL('../../tools/delegated-checkout-fixture-server.mts', import.meta.url));
const CLIENT_OUTPUT_BYTES = 524288;
const BOOT_OUTPUT_BYTES = 16384;
const ID = /^[A-Za-z0-9_-]{1,96}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const LOOPBACK = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/;
type Pair = Readonly<{ preview_id: string; context_id: string; compact_jws: string }>;
type Credentials = Readonly<{ bearer: string; preview_request: Readonly<{
  cart_id: string; shipping_quote_id: string; fee_quote_id: string }>;
  primary: Pair; pending: Pair }>;
type Ready = Readonly<{ event: 'checkout_fixture_ready'; schema_version: 1;
  mode: 'fresh'|'history'; instance_id: string; pid: number; url: string;
  effects_digest: string; intent_count: number; credentials?: Credentials }>;
type Exit = Readonly<{ code: number|null; signal: NodeJS.Signals|null }>;
type Managed = { child: ChildProcess; exit: Promise<Exit> };
type Allocation = { directory: string; instanceId: string; credentials?: Credentials };
type Owned = Managed & { allocation: Allocation; ready?: Ready };
export type FixtureProcess = Readonly<{ ready: Ready; child: ChildProcess; directory: string }>;
export type ClientResult = Readonly<{ code: number|null; pid: number; stdout: string; stderr: string }>;
type PreparationObservation = Readonly<{ intent_id: string; created_at: number; revision: number; binding_digest: string }>;

function fail(code: string): never { throw new Error(code); }
function fields(value: unknown, expected: string[]): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === [...expected].sort().join(',');
}
function pair(value: unknown): value is Pair {
  return fields(value, ['preview_id', 'context_id', 'compact_jws']) &&
    typeof value.preview_id === 'string' && ID.test(value.preview_id) &&
    typeof value.context_id === 'string' && ID.test(value.context_id) &&
    typeof value.compact_jws === 'string' && value.compact_jws.length <= 100000 &&
    /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value.compact_jws);
}
function readiness(value: unknown, instance: Allocation, mode: Ready['mode'], pid: number): Ready {
  const names = ['event', 'schema_version', 'mode', 'instance_id', 'pid', 'url', 'effects_digest', 'intent_count'];
  if (mode === 'fresh') names.push('credentials');
  if (!fields(value, names) || value.event !== 'checkout_fixture_ready' || value.schema_version !== 1 ||
      value.mode !== mode || value.instance_id !== instance.instanceId || value.pid !== pid ||
      typeof value.url !== 'string' || !LOOPBACK.test(value.url) || Number(LOOPBACK.exec(value.url)![1]) > 65535 ||
      typeof value.effects_digest !== 'string' || !DIGEST.test(value.effects_digest) ||
      !Number.isSafeInteger(value.intent_count) || value.intent_count < 0)
    fail('CHECKOUT_PROCESS_IDENTITY_INVALID');
  if (mode === 'fresh') {
    const c = value.credentials;
    if (!fields(c, ['bearer', 'preview_request', 'primary', 'pending']) ||
        typeof c.bearer !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(c.bearer) ||
        !fields(c.preview_request, ['cart_id', 'shipping_quote_id', 'fee_quote_id']) ||
        !Object.values(c.preview_request).every(v => typeof v === 'string' && ID.test(v)) ||
        !pair(c.primary) || !pair(c.pending) || c.primary.preview_id === c.pending.preview_id ||
        c.primary.context_id === c.pending.context_id || value.intent_count !== 0)
      fail('CHECKOUT_PROCESS_BOOTSTRAP_INVALID');
  }
  return Object.freeze(value) as Ready;
}
function manage(child: ChildProcess): Managed {
  const exit = new Promise<Exit>(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  // Spawn failures are converted to finite errors by the operation's own listener.
  child.on('error', () => {});
  return { child, exit };
}
async function within<T>(promise: Promise<T>, milliseconds: number, code: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(code)), milliseconds);
  })]); } finally { clearTimeout(timer); }
}
async function stopManaged(managed: Managed, crash = false): Promise<Exit> {
  if (managed.child.exitCode === null && managed.child.signalCode === null)
    managed.child.kill(crash ? 'SIGKILL' : 'SIGTERM');
  try { return await within(managed.exit, 2500, 'CHECKOUT_PROCESS_STOP_TIMEOUT'); }
  catch {
    if (managed.child.exitCode === null && managed.child.signalCode === null) managed.child.kill('SIGKILL');
    return await within(managed.exit, 1500, 'CHECKOUT_PROCESS_STOP_TIMEOUT');
  }
}

/** Owns only processes and directories allocated by this instance. No caller-
 * supplied executable, endpoint, database or provider configuration is accepted. */
export class CheckoutProcessHarness {
  readonly directory: string;
  readonly clientDirectory: string;
  readonly clientPath: string;
  readonly clientSha256: string;
  readonly #identity: { dev: number; ino: number };
  readonly #allocations = new Map<string, Allocation>();
  readonly #handles = new Map<FixtureProcess, Owned>();
  readonly #processes = new Set<Managed>();
  readonly #extraCleanup = new Set<() => Promise<void>>();
  readonly #signal?: AbortSignal;
  readonly #abort: () => void;
  readonly #clientPids: number[] = [];
  #closing?: Promise<void>;
  #closed = false;
  #processFailure?: string;

  constructor(signal?: AbortSignal) {
    if (signal?.aborted) fail('CHECKOUT_RUN_INTERRUPTED');
    this.#signal = signal;
    this.directory = realpathSync(mkdtempSync(join(tmpdir(), 'rifare-checkout-lifecycle-')));
    const identity = lstatSync(this.directory); this.#identity = { dev: identity.dev, ino: identity.ino };
    this.clientDirectory = join(this.directory, 'caller');
    this.clientPath = join(this.clientDirectory, 'delegated_checkout.py');
    try {
      mkdirSync(this.clientDirectory, { mode: 0o700 });
      copyFileSync(CLIENT, this.clientPath);
      this.clientSha256 = createHash('sha256').update(readFileSync(this.clientPath)).digest('hex');
      if (this.clientSha256 !== createHash('sha256').update(readFileSync(CLIENT)).digest('hex'))
        fail('CHECKOUT_CLIENT_COPY_INVALID');
    } catch (error) { rmSync(this.directory, { recursive: true }); throw error; }
    this.#abort = () => { void this.close().catch(() => {}); };
    signal?.addEventListener('abort', this.#abort, { once: true });
  }
  get clientProcessIds(): readonly number[] { return [...this.#clientPids]; }
  #active(): void {
    if (this.#signal?.aborted) fail('CHECKOUT_RUN_INTERRUPTED');
    if (this.#closing || this.#closed) fail('CHECKOUT_HARNESS_CLOSED');
    if (this.#processFailure) fail(this.#processFailure);
  }
  #owned(handle: FixtureProcess): Owned {
    const owned = this.#handles.get(handle);
    if (!owned) fail('CHECKOUT_PROCESS_NOT_OWNED');
    return owned;
  }
  #containsSecret(value: string): boolean {
    return [...this.#allocations.values()].some(a => a.credentials &&
      [a.credentials.bearer, a.credentials.primary.compact_jws, a.credentials.pending.compact_jws]
        .some(secret => value.includes(secret)));
  }
  async fresh(label: string): Promise<FixtureProcess> {
    this.#active();
    if (!/^[a-z][a-z0-9-]{0,23}$/.test(label)) fail('CHECKOUT_INSTANCE_INVALID');
    if (this.#allocations.has(label)) fail('CHECKOUT_INSTANCE_EXISTS');
    const allocation: Allocation = { directory: join(this.directory, label), instanceId: randomBytes(12).toString('hex') };
    mkdirSync(allocation.directory, { mode: 0o700 }); this.#allocations.set(label, allocation);
    return await this.#start(allocation, 'fresh');
  }
  async restart(handle: FixtureProcess): Promise<FixtureProcess> {
    this.#active(); const prior = this.#owned(handle);
    if (prior.child.exitCode === null && prior.child.signalCode === null) fail('CHECKOUT_PROCESS_STILL_RUNNING');
    await prior.exit;
    return await this.#start(prior.allocation, 'history');
  }
  async #start(allocation: Allocation, mode: Ready['mode']): Promise<FixtureProcess> {
    this.#active();
    const child = fork(SERVER, [], { cwd: ROOT, env: childEnvironment(),
      execArgv: ['--experimental-strip-types'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    const managed: Owned = { ...manage(child), allocation }; this.#processes.add(managed);
    let output = '', outputBytes = 0, delivered = false, rejectBoot: (error: Error) => void = () => {};
    const collect = (bytes: Buffer) => {
      outputBytes += bytes.length;
      if (outputBytes > BOOT_OUTPUT_BYTES) {
        if (delivered) this.#processFailure = 'CHECKOUT_PROCESS_OUTPUT_LIMIT';
        child.kill('SIGKILL'); rejectBoot(new Error('CHECKOUT_PROCESS_OUTPUT_LIMIT')); return;
      }
      output += bytes.toString('utf8');
      if (this.#containsSecret(output)) {
        if (delivered) this.#processFailure = 'CHECKOUT_PROCESS_SECRET_OUTPUT';
        child.kill('SIGKILL'); rejectBoot(new Error('CHECKOUT_PROCESS_SECRET_OUTPUT'));
      }
    };
    child.stdout!.on('data', collect); child.stderr!.on('data', collect);
    try {
      const ready = await within(new Promise<Ready>((resolve, reject) => {
        rejectBoot = reject;
        let configured = false;
        child.once('error', () => reject(new Error('CHECKOUT_PROCESS_START_FAILED')));
        child.once('close', () => { if (!delivered) reject(new Error('CHECKOUT_PROCESS_START_FAILED')); });
        child.on('message', message => {
          try {
            if (!configured && fields(message, ['awaiting_configuration']) && message.awaiting_configuration === true) {
              configured = true;
              child.send([allocation.directory, allocation.instanceId, mode], error => {
                if (error) reject(new Error('CHECKOUT_PROCESS_START_FAILED'));
              }); return;
            }
            if (!configured || delivered || JSON.stringify(message).length > 16384) fail('CHECKOUT_PROCESS_MESSAGE_INVALID');
            if (fields(message, ['event', 'code']) && message.event === 'checkout_fixture_failed')
              fail('CHECKOUT_PROCESS_START_FAILED');
            const value = readiness(message, allocation, mode, child.pid!);
            if (mode === 'fresh') allocation.credentials = value.credentials;
            if (this.#containsSecret(output)) fail('CHECKOUT_PROCESS_SECRET_OUTPUT');
            delivered = true; resolve(value);
          } catch (error) {
            if (delivered) this.#processFailure = 'CHECKOUT_PROCESS_MESSAGE_INVALID';
            child.kill('SIGKILL'); reject(error);
          }
        });
      }), 10000, 'CHECKOUT_PROCESS_READY_TIMEOUT');
      this.#active(); managed.ready = ready;
      const handle = Object.freeze({ ready, child, directory: allocation.directory });
      this.#handles.set(handle, managed); return handle;
    } catch (error) { await stopManaged(managed); throw error; }
  }
  async stop(handle: FixtureProcess, crash = false): Promise<Exit> {
    return await stopManaged(this.#owned(handle), crash);
  }
  snapshot(handle: FixtureProcess) {
    const owned = this.#owned(handle);
    if (owned.child.exitCode === null && owned.child.signalCode === null) fail('CHECKOUT_PROCESS_STILL_RUNNING');
    return readCheckoutFixtureSnapshot(owned.allocation.directory, owned.allocation.instanceId);
  }
  async client(handle: FixtureProcess, args: string[], receipt = '', bearer?: string): Promise<ClientResult> {
    this.#active(); const owned = this.#owned(handle);
    return await this.#client(owned, owned.ready!.url, args, receipt, bearer ?? owned.allocation.credentials!.bearer);
  }
  async #client(owned: Owned, url: string, args: string[], receipt: string, bearer: string): Promise<ClientResult> {
    this.#active();
    if (owned.child.exitCode !== null || owned.child.signalCode !== null) fail('CHECKOUT_PROCESS_NOT_RUNNING');
    const child = spawn('python3', ['-I', this.clientPath, '--base-url', url, ...args], {
      cwd: this.clientDirectory, env: { ...childEnvironment(), RIFARE_BEARER: bearer },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const managed = manage(child); this.#processes.add(managed);
    if (child.pid) this.#clientPids.push(child.pid);
    let stdout = '', stderr = '', bytes = 0, failure: string|undefined;
    const append = (stream: 'stdout'|'stderr', chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > CLIENT_OUTPUT_BYTES) { failure = 'CHECKOUT_CLIENT_OUTPUT_LIMIT'; child.kill('SIGKILL'); return; }
      if (stream === 'stdout') stdout += chunk.toString('utf8'); else stderr += chunk.toString('utf8');
    };
    child.stdout!.on('data', chunk => append('stdout', chunk));
    child.stderr!.on('data', chunk => append('stderr', chunk));
    child.once('error', () => { failure = 'CHECKOUT_CLIENT_START_FAILED'; });
    child.stdin!.on('error', () => {});
    child.stdin!.end(receipt);
    let result: Exit;
    try { result = await within(managed.exit, 7000, 'CHECKOUT_CLIENT_DEADLINE'); }
    catch (error) { await stopManaged(managed, true); throw error; }
    this.#active();
    if (failure) fail(failure);
    if (this.#containsSecret(stdout + stderr)) fail('CHECKOUT_CLIENT_SECRET_OUTPUT');
    return { code: result.code, pid: child.pid!, stdout, stderr };
  }
  /** One fixed loopback fault: discard a completed native receipt response. */
  async loseReceiptResponse(handle: FixtureProcess, intentId: string, receipt: string) {
    const { observed_intent: _observation, ...result } = await this.#loseResponse(handle, 'receipt',
      ['receipt', '--intent-id', intentId], receipt);
    return result;
  }
  /** One fixed preparation fault. The observer retains only committed identity
   * metadata; the copied caller receives neither that metadata nor a response. */
  async losePreparationResponse(handle: FixtureProcess, original: Readonly<{ preview_id: string; context_id: string }>) {
    this.#active(); this.#owned(handle);
    if (!fields(original, ['preview_id', 'context_id']) ||
        typeof original.preview_id !== 'string' || !ID.test(original.preview_id) ||
        typeof original.context_id !== 'string' || !ID.test(original.context_id)) fail('CHECKOUT_RECOVERY_INPUT_INVALID');
    return await this.#loseResponse(handle, 'prepare',
      ['prepare', '--preview-id', original.preview_id, '--context-id', original.context_id]);
  }
  async #loseResponse(handle: FixtureProcess, operation: 'prepare'|'receipt', args: string[], receipt = ''):
    Promise<{ client: ClientResult; forwarded_requests: number; upstream_completed: boolean;
      upstream_status: number; observed_intent: PreparationObservation|null }> {
    this.#active(); const owned = this.#owned(handle), bearer = owned.allocation.credentials!.bearer;
    let forwarded = 0, completed = false, status = 0;
    let observedIntent: PreparationObservation|null = null;
    const path = '/v1/delegated-checkout/' + operation, limit = operation === 'prepare' ? 4096 : 102400;
    const requests = new Set<ReturnType<typeof request>>();
    const server = createServer((incoming, outgoing) => {
      if (forwarded || incoming.method !== 'POST' || incoming.url !== path ||
          incoming.headers.authorization !== 'Bearer ' + bearer) { outgoing.writeHead(403); outgoing.end(); return; }
      forwarded++;
      const chunks: Buffer[] = []; let length = 0;
      incoming.on('data', chunk => {
        length += chunk.length;
        if (length > limit) { incoming.destroy(); return; }
        chunks.push(chunk);
      });
      incoming.on('end', () => {
        if (length > limit) return;
        const upstream = request({ hostname: '127.0.0.1', port: Number(new URL(owned.ready!.url).port),
          method: 'POST', path, timeout: 3000,
          headers: { authorization: 'Bearer ' + bearer, 'content-type': 'application/json', connection: 'close' } }, response => {
          status = response.statusCode ?? 0; let received = 0;
          const observed: Buffer[] = [];
          response.on('data', chunk => {
            received += chunk.length;
            if (received > 262144) { upstream.destroy(); return; }
            if (operation === 'prepare') observed.push(chunk);
          });
          response.on('end', () => {
            completed = true;
            if (operation === 'prepare' && status === 200) {
              try {
                const envelope = JSON.parse(Buffer.concat(observed).toString('utf8')), value = envelope.result;
                if (envelope.execution_authorized === false && envelope.operation === 'prepare' &&
                    value.execution_authorized === false && value.state === 'prepared' && value.revision === 1 &&
                    typeof value.intent_id === 'string' && /^delegated_intent_[a-f0-9]{40}$/.test(value.intent_id) &&
                    Number.isSafeInteger(value.created_at) && value.created_at >= 0 &&
                    typeof value.binding_digest === 'string' && DIGEST.test(value.binding_digest))
                  observedIntent = { intent_id: value.intent_id, created_at: value.created_at,
                    revision: value.revision, binding_digest: value.binding_digest };
              } catch { /* No untrusted exception or response bytes escape this observer. */ }
            }
            outgoing.destroy();
          });
          response.on('error', () => outgoing.destroy());
        });
        requests.add(upstream); upstream.once('close', () => requests.delete(upstream));
        upstream.on('error', () => outgoing.destroy());
        upstream.on('timeout', () => upstream.destroy());
        upstream.end(Buffer.concat(chunks));
      });
      incoming.on('error', () => outgoing.destroy());
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    let closing: Promise<void>|undefined;
    const close = () => closing ??= new Promise<void>(resolve => {
      for (const upstream of requests) upstream.destroy();
      server.closeAllConnections(); server.close(() => resolve());
    });
    this.#extraCleanup.add(close);
    try {
      const client = await this.#client(owned, 'http://127.0.0.1:' + address.port, args, receipt, bearer);
      if (operation === 'prepare' && completed && status === 200 && !observedIntent)
        fail('CHECKOUT_PREPARE_OBSERVATION_INVALID');
      return { client, forwarded_requests: forwarded, upstream_completed: completed,
        upstream_status: status, observed_intent: observedIntent };
    } finally { await close(); this.#extraCleanup.delete(close); }
  }
  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closing = this.#close(); return this.#closing;
  }
  async #close(): Promise<void> {
    this.#signal?.removeEventListener('abort', this.#abort);
    const results = await Promise.allSettled([
      ...[...this.#extraCleanup].map(close => close()),
      ...[...this.#processes].map(child => stopManaged(child)),
    ]);
    if (results.some(result => result.status === 'rejected')) fail('CHECKOUT_CLEANUP_FAILED');
    const current = lstatSync(this.directory);
    if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== this.#identity.dev || current.ino !== this.#identity.ino)
      fail('CHECKOUT_CLEANUP_UNSAFE');
    rmSync(this.directory, { recursive: true });
    for (const allocation of this.#allocations.values()) allocation.credentials = undefined;
    this.#closed = true;
    if (this.#processFailure) fail(this.#processFailure);
  }
}

function success(result: ClientResult): Record<string, any> {
  assert.equal(result.code, 0, 'independent client failed');
  assert.equal(result.stderr, '');
  const value = JSON.parse(result.stdout);
  assert.equal(value.profile, 'commerce-sqlite-diagnostic');
  assert.equal(value.execution_authorized, false);
  assert.equal(value.evidence_status, 'historical_observation');
  return value.result;
}
function refused(result: ClientResult, code: string): void {
  assert.equal(result.code, 1); assert.equal(result.stdout, '');
  assert.deepEqual(JSON.parse(result.stderr), { error: code, execution_authorized: false });
}

export async function runCheckoutLifecycle(signal?: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const deadline = setTimeout(abort, 45000);
  let harness: CheckoutProcessHarness|undefined;
  const checks: { id: string; passed: true }[] = [];
  const pass = (id: string) => checks.push({ id, passed: true });
  try {
    harness = new CheckoutProcessHarness(controller.signal);
    const first = await harness.fresh('first'), other = await harness.fresh('second');
    const one = first.ready.credentials!, two = other.ready.credentials!;
    assert.notEqual(first.ready.pid, other.ready.pid); assert.notEqual(first.ready.pid, process.pid);
    assert.notEqual(first.directory, other.directory); assert.notEqual(first.ready.url, other.ready.url);
    assert.notEqual(one.bearer, two.bearer); pass('independent_processes');
    const call = (fixture: FixtureProcess, args: string[], receipt = '') => harness!.client(fixture, args, receipt);
    const prepare = (fixture: FixtureProcess, pair: Pair) => call(fixture,
      ['prepare', '--preview-id', pair.preview_id, '--context-id', pair.context_id]);
    const status = (fixture: FixtureProcess, id: string) => call(fixture, ['status', '--intent-id', id]);
    assert.equal(success(await call(first, ['contract'])).routes.length, 7);
    const preview = success(await call(first, ['preview', '--cart-id', one.preview_request.cart_id,
      '--shipping-quote-id', one.preview_request.shipping_quote_id, '--fee-quote-id', one.preview_request.fee_quote_id]));
    assert.equal(preview.total_payable_minor, '6800'); assert.equal(preview.currency, 'USD');
    assert.equal(success(await call(first, ['preview-status', '--preview-id', preview.preview_id])).preview_digest, preview.preview_digest);
    pass('contract_and_preview');
    const primary = success(await prepare(first, one.primary)), pending = success(await prepare(first, one.pending));
    const otherIntent = success(await prepare(other, two.primary));
    assert.equal(primary.state, 'prepared'); assert.equal(pending.state, 'prepared');
    assert.equal(primary.revision, 1); assert.notEqual(primary.intent_id, pending.intent_id);
    assert.deepEqual(success(await prepare(first, one.primary)), primary); pass('original_intents');
    refused(await harness.client(first, ['status', '--intent-id', primary.intent_id], '', two.bearer), 'REQUEST_DENIED');
    refused(await status(first, otherIntent.intent_id), 'NOT_FOUND');
    refused(await harness.client(other, ['status', '--intent-id', otherIntent.intent_id], '', one.bearer), 'REQUEST_DENIED');
    refused(await status(other, primary.intent_id), 'NOT_FOUND'); pass('cross_instance_refusal');
    const lost = await harness.loseReceiptResponse(first, primary.intent_id, one.primary.compact_jws);
    refused(lost.client, 'REQUEST_FAILED'); assert.equal(lost.forwarded_requests, 1);
    assert.equal(lost.upstream_completed, true); assert.equal(lost.upstream_status, 200);
    const captured = success(await status(first, primary.intent_id));
    assert.equal(captured.state, 'evidence_verified'); assert.equal(captured.revision, 2);
    assert.equal(captured.intent_id, primary.intent_id); pass('lost_response_same_intent');
    assert.deepEqual(success(await call(first, ['receipt', '--intent-id', primary.intent_id], one.primary.compact_jws)), captured);
    const otherCaptured = success(await call(other, ['receipt', '--intent-id', otherIntent.intent_id], two.primary.compact_jws));
    assert.equal(otherCaptured.state, 'evidence_verified'); pass('exact_receipt_retry');
    const exited = await harness.stop(first, true); assert.equal(exited.signal, 'SIGKILL');
    const beforeRestart = harness.snapshot(first);
    assert.equal(beforeRestart.effects_digest, first.ready.effects_digest); assert.equal(beforeRestart.intent_count, 2);
    const history = await harness.restart(first);
    assert.notEqual(history.ready.pid, first.ready.pid); assert.equal(history.ready.mode, 'history');
    assert.equal(history.ready.credentials, undefined); pass('process_loss');
    assert.deepEqual(success(await status(history, primary.intent_id)), captured);
    assert.deepEqual(success(await call(history, ['receipt', '--intent-id', primary.intent_id], one.primary.compact_jws)), captured);
    refused(await harness.client(history, ['status', '--intent-id', primary.intent_id], '', two.bearer), 'REQUEST_DENIED');
    pass('retained_history');
    refused(await call(history, ['receipt', '--intent-id', pending.intent_id], one.pending.compact_jws), 'UNAVAILABLE');
    refused(await prepare(history, one.pending), 'UNAVAILABLE');
    refused(await call(history, ['preview-status', '--preview-id', one.primary.preview_id]), 'UNAVAILABLE');
    assert.deepEqual(success(await status(history, pending.intent_id)), pending); pass('missing_live_provenance');
    const cancelled = success(await call(history, ['cancel', '--intent-id', primary.intent_id, '--expected-revision', '2']));
    assert.equal(cancelled.state, 'cancelled'); assert.equal(cancelled.revision, 3); assert.equal(cancelled.authority_revoked, true);
    refused(await call(history, ['cancel', '--intent-id', primary.intent_id, '--expected-revision', '2']), 'CONFLICT');
    assert.equal(success(await call(history, ['cancel', '--intent-id', pending.intent_id, '--expected-revision', '1'])).state, 'cancelled');
    assert.deepEqual(success(await status(history, primary.intent_id)), cancelled); pass('revision_bound_cancellation');
    assert.deepEqual(success(await status(other, otherIntent.intent_id)), otherCaptured); pass('other_instance_continues');
    await harness.stop(history); await harness.stop(other);
    const after = harness.snapshot(history), otherAfter = harness.snapshot(other);
    assert.equal(after.effects_digest, first.ready.effects_digest); assert.equal(after.intent_count, 2);
    assert.equal(after.session_count, beforeRestart.session_count);
    assert.equal(otherAfter.effects_digest, other.ready.effects_digest); assert.equal(otherAfter.intent_count, 1);
    pass('commerce_effects_unchanged');
    const report = { schema_version: 1, profile: 'commerce-sqlite-diagnostic',
      qualification: 'synthetic_process_demonstration', execution_authorized: false,
      provider_final_use: false, full_rcg5_complete: false, target_stack_qualified: false,
      os_sandbox_qualified: false, checks,
      server_process_ids: [first.ready.pid, other.ready.pid, history.ready.pid],
      client_process_ids: harness.clientProcessIds, client_sha256: harness.clientSha256,
      original_intent_id: primary.intent_id, retained_revision: captured.revision,
      final_revision: cancelled.revision, cleanup_complete: false };
    await harness.close(); report.cleanup_complete = true; return report;
  } finally {
    clearTimeout(deadline); signal?.removeEventListener('abort', abort);
    await harness?.close();
  }
}

/** Recover an unknown local preparation outcome without recreating live owners. */
export async function runCheckoutPreparationRecovery(signal?: AbortSignal) {
  const controller = new AbortController(), abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const deadline = setTimeout(abort, 45000);
  let harness: CheckoutProcessHarness|undefined;
  const checks: { id: string; passed: true }[] = [], pass = (id: string) => checks.push({ id, passed: true });
  try {
    harness = new CheckoutProcessHarness(controller.signal);
    const first = await harness.fresh('recovery'), other = await harness.fresh('other');
    const one = first.ready.credentials!, two = other.ready.credentials!;
    assert.notEqual(first.ready.pid, other.ready.pid); assert.notEqual(first.ready.url, other.ready.url);
    assert.notEqual(first.directory, other.directory);
    const original = { preview_id: one.primary.preview_id, context_id: one.primary.context_id };
    const args = ['lookup', '--preview-id', original.preview_id, '--context-id', original.context_id];
    const call = (handle: FixtureProcess, input: string[], receipt = '') => harness!.client(handle, input, receipt);
    assert.equal(success(await call(first, ['contract'])).routes.length, 7);
    const contract = success(await call(first, ['recovery-contract']));
    assert.equal(contract.base_path, '/v1/delegated-checkout-recovery');
    assert.deepEqual(contract.routes.map((route: any) => route.operation), ['recovery-contract', 'lookup']);
    refused(await call(first, args), 'NOT_FOUND'); pass('separate_contract_and_initial_absence');
    const lost = await harness.losePreparationResponse(first, original);
    refused(lost.client, 'REQUEST_FAILED'); assert.equal(lost.forwarded_requests, 1);
    assert.equal(lost.upstream_completed, true); assert.equal(lost.upstream_status, 200);
    const observed = lost.observed_intent; assert.ok(observed);
    assert.equal((lost.client.stdout + lost.client.stderr).includes(observed.intent_id), false);
    pass('committed_preparation_response_lost');
    const exited = await harness.stop(first, true); assert.equal(exited.signal, 'SIGKILL');
    const before = harness.snapshot(first); assert.equal(before.intent_count, 1);
    assert.equal(before.effects_digest, first.ready.effects_digest);
    const history = await harness.restart(first);
    assert.notEqual(history.ready.pid, first.ready.pid); assert.equal(history.ready.mode, 'history');
    assert.equal(history.ready.credentials, undefined); pass('actual_process_replacement');
    const recovered = success(await call(history, args));
    assert.deepEqual(recovered.original, original);
    for (const key of ['intent_id', 'created_at', 'revision', 'binding_digest'] as const)
      assert.equal(recovered.intent[key], observed[key]);
    assert.equal(recovered.intent.state, 'prepared'); assert.equal(recovered.intent.execution_authorized, false);
    assert.deepEqual(success(await call(history, ['status', '--intent-id', recovered.intent.intent_id])), recovered.intent);
    assert.deepEqual(success(await call(history, args)), recovered); pass('original_identity_recovered');
    refused(await call(history, ['prepare', '--preview-id', original.preview_id, '--context-id', original.context_id]), 'UNAVAILABLE');
    refused(await call(history, ['receipt', '--intent-id', observed.intent_id], one.primary.compact_jws), 'UNAVAILABLE');
    assert.deepEqual(success(await call(history, args)), recovered); pass('live_provenance_stays_unavailable');
    refused(await call(history, ['lookup', '--preview-id', one.pending.preview_id, '--context-id', one.pending.context_id]), 'NOT_FOUND');
    refused(await call(history, ['lookup', '--preview-id', original.preview_id, '--context-id', one.pending.context_id]), 'NOT_FOUND');
    refused(await call(other, args), 'NOT_FOUND');
    refused(await harness.client(history, args, '', two.bearer), 'REQUEST_DENIED');
    refused(await harness.client(other, args, '', one.bearer), 'REQUEST_DENIED');
    assert.deepEqual(success(await call(history, args)), recovered); pass('absence_and_cross_instance_refusal');
    const cancelled = success(await call(history, ['cancel', '--intent-id', observed.intent_id, '--expected-revision', '1']));
    assert.equal(cancelled.state, 'cancelled'); assert.equal(cancelled.revision, 2);
    assert.equal(cancelled.minimized, true); assert.equal(cancelled.purchase, null); assert.equal(cancelled.receipt, null);
    const retained = success(await call(history, args));
    assert.deepEqual(retained.original, original); assert.deepEqual(retained.intent, cancelled);
    pass('minimized_original_history');
    await harness.stop(history); await harness.stop(other);
    const after = harness.snapshot(history), otherAfter = harness.snapshot(other);
    assert.equal(after.intent_count, 1); assert.equal(after.session_count, before.session_count);
    assert.equal(after.effects_digest, first.ready.effects_digest);
    assert.equal(otherAfter.intent_count, 0); assert.equal(otherAfter.effects_digest, other.ready.effects_digest);
    pass('no_replacement_or_commerce_effects');
    const report = { schema_version: 1, profile: 'commerce-sqlite-diagnostic',
      qualification: 'synthetic_preparation_recovery', execution_authorized: false,
      provider_final_use: false, full_rcg5_complete: false, target_stack_qualified: false,
      os_sandbox_qualified: false, checks, preparation_forwards: lost.forwarded_requests,
      original_intent_id: observed.intent_id, original_created_at: observed.created_at,
      recovered_revision: recovered.intent.revision, final_revision: cancelled.revision,
      retained_intent_count: after.intent_count, replacement_intents: 0,
      server_process_ids: [first.ready.pid, other.ready.pid, history.ready.pid],
      client_process_ids: harness.clientProcessIds, client_sha256: harness.clientSha256,
      cleanup_complete: false };
    await harness.close(); report.cleanup_complete = true; return report;
  } finally {
    clearTimeout(deadline); signal?.removeEventListener('abort', abort); await harness?.close();
  }
}
