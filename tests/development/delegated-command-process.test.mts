import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { usingCommandClaim } from './delegated-command-claim-helpers.mts';

type Fixture = Parameters<Parameters<typeof usingCommandClaim>[0]>[0];
type Message = { phase: string; pid: number; ok?: boolean; value?: any; error?: string };

async function child(f: Fixture, input: Record<string, unknown>) {
  const processChild = fork(new URL('./delegated-command-process-child.mts', import.meta.url), [], {
    execArgv: ['--experimental-strip-types', '--import', new URL('../harness/network-deny.mts', import.meta.url).pathname],
    env: { PATH: process.env.PATH }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  const messages: Message[] = [], pending = new Set<() => void>();
  let stderr = '', failure: Error | undefined, done = false;
  processChild.stderr!.on('data', bytes => {
    stderr += bytes;
    if (stderr.length > 16384) { failure = new Error('CLAIM_PROCESS_OUTPUT_LIMIT'); processChild.kill('SIGKILL'); }
  });
  processChild.on('error', error => { failure = error; for (const notify of pending) notify(); });
  processChild.on('message', message => { messages.push(message as Message); for (const notify of pending) notify(); });
  const exit = once(processChild, 'exit').then(([code, signal]) => {
    done = true; for (const notify of pending) notify(); return { code, signal };
  });
  const receive = (phase: string) => new Promise<Message>((resolve, reject) => {
    const finish = (error?: Error, message?: Message) => {
      clearTimeout(timer); pending.delete(check); error ? reject(error) : resolve(message!);
    };
    const check = () => {
      const result = messages.find(value => value.phase === phase);
      if (result) finish(undefined, result);
      else if (failure || done || messages.some(value => value.phase === 'initialization_failed'))
        finish(new Error('CLAIM_PROCESS_UNEXPECTED_EXIT: ' + (failure?.message ?? stderr)));
    };
    const timer = setTimeout(() => {
      processChild.kill('SIGKILL'); finish(new Error('CLAIM_PROCESS_TIMEOUT'));
    }, 7000);
    pending.add(check); check();
  });
  const close = async () => {
    if (!done) processChild.kill('SIGKILL'); await exit;
  };
  processChild.send({ filename: f.filename, now: f.now(), bearer: f.bearer, correlation: f.correlation, ...input });
  try { await receive('ready'); } catch (error) { await close(); throw error; }
  return { pid: processChild.pid!, messages, receive, exit, close,
    go: () => processChild.send({ phase: 'go' }),
    result: async () => {
      const result = await receive('result'), stopped = await exit;
      assert.equal(stopped.code, 0); assert.equal(stopped.signal, null); return result;
    },
  };
}

test('RCG4BC2-PROCESS-LOST-CLAIM committed original survives SIGKILL before its result reaches the caller', () => usingCommandClaim(async f => {
  const before = f.effects(), first = await child(f, { action: 'claim_hold', request: f.start.request });
  try {
    first.go(); await first.receive('committed_without_result');
    assert.equal(first.messages.some(value => value.phase === 'result'), false);
    await first.close(); assert.equal((await first.exit).signal, 'SIGKILL');
    const stored = f.claimRows(); assert.equal(stored.length, 1);
    const next = await child(f, { action: 'read', command_id: f.start.request.command_id });
    try {
      assert.notEqual(next.pid, first.pid); next.go(); const read = await next.result();
      assert.equal(read.ok, true); assert.deepEqual(read.value, f.claims.read(f.customer, f.start.request.command_id));
      assert.equal(read.value.revision, 1); assert.equal(read.value.execution_authorized, false);
      assert.deepEqual(f.claimRows(), stored);
    } finally { await next.close(); }
    const recovery = await child(f, { action: 'recovery', command_id: f.start.request.command_id });
    try {
      recovery.go(); const result = await recovery.result(); assert.equal(result.ok, true);
      assert.deepEqual(result.value.request, f.start.recovery_request);
      assert.equal(result.value.canonical_json, f.start.recovery_canonical_json);
    } finally { await recovery.close(); }
    assert.deepEqual(f.effects(), before);
  } finally { await first.close(); }
}));

test('RCG4BC2-PROCESS-CONTENTION separate processes waiting on a real SQLite writer converge on one claim', () => usingCommandClaim(async f => {
  const before = f.effects();
  const a = await child(f, { action: 'claim', request: f.start.request });
  const b = await child(f, { action: 'claim', request: f.start.request });
  try {
    assert.notEqual(a.pid, b.pid); assert.notEqual(a.pid, process.pid);
    f.db.exec('BEGIN IMMEDIATE');
    a.go(); b.go(); await Promise.all([a.receive('entering'), b.receive('entering')]);
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(a.messages.some(value => value.phase === 'result'), false);
    assert.equal(b.messages.some(value => value.phase === 'result'), false);
    f.db.exec('COMMIT');
    const [x, y] = await Promise.all([a.result(), b.result()]);
    assert.equal(x.ok, true); assert.equal(y.ok, true); assert.deepEqual(x.value, y.value);
    assert.equal(x.value.revision, 1); assert.equal(f.claimRows().length, 1);
    assert.equal(f.record().body.command_digest, f.start.command_digest);
    assert.deepEqual(f.effects(), before);
  } finally {
    if (f.db.isTransaction) f.db.exec('ROLLBACK'); await a.close(); await b.close();
  }
}));

test('RCG4BC2-PROCESS-CONFLICT another process cannot reuse a committed UUID with changed valid intent', () => usingCommandClaim(async f => {
  f.claimStart(); const original = f.claimRows(), before = f.effects();
  const request = structuredClone(f.start.request); request.operation.request_digest = 'sha256:' + 'a'.repeat(64);
  const contender = await child(f, { action: 'claim', request });
  try {
    contender.go(); const result = await contender.result(); assert.equal(result.ok, false);
    assert.match(result.error!, /CLAIM_CONFLICT/);
    assert.deepEqual(f.claimRows(), original); assert.deepEqual(f.effects(), before);
  } finally { await contender.close(); }
}));

test('RCG4BC2-PROCESS-LOST-OBSERVATION first result survives process loss and a recovered duplicate cannot replace it', () => usingCommandClaim(async f => {
  f.claimFinal(); const before = f.effects();
  const first = await child(f, { action: 'observe_hold', command_id: f.final.request.command_id, response: f.finalResponse });
  try {
    first.go(); await first.receive('committed_without_result');
    assert.equal(first.messages.some(value => value.phase === 'result'), false); await first.close();
    assert.equal((await first.exit).signal, 'SIGKILL'); const stored = f.claimRows();
    assert.equal(f.record(f.final.request.command_id).body.revision, 2);
    const next = await child(f, { action: 'observe', command_id: f.final.request.command_id,
      response: { ...f.finalResponse, recovered: true } });
    try {
      assert.notEqual(next.pid, first.pid); next.go(); const result = await next.result();
      assert.equal(result.ok, true); assert.equal(result.value.revision, 2);
      assert.deepEqual(f.claimRows(), stored);
      assert.deepEqual(f.record(f.final.request.command_id).body.personal!.first_response, f.finalResponse);
    } finally { await next.close(); }
    assert.deepEqual(f.effects(), before);
  } finally { await first.close(); }
}));
