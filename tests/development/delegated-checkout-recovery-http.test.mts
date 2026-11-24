import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, request as httpRequest } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { usingCheckoutHttp } from './delegated-checkout-http-helpers.mts';
import { changedProof } from './delegated-checkout-helpers.mts';

const BASE = '/v1/delegated-checkout-recovery', LOOKUP = BASE + '/lookup';
const BEARER = 'b'.repeat(43), ORIGINAL = { preview_id: 'original-preview', context_id: 'original-context' };
const ARGS = ['lookup', '--preview-id', ORIGINAL.preview_id, '--context-id', ORIGINAL.context_id];
type Fixture = Parameters<Parameters<typeof usingCheckoutHttp>[0]>[0];
type Run = { code: number|null; stdout: string; stderr: string };

async function outcome(response: Response, operation = 'lookup') {
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  const value = await response.json();
  assert.deepEqual(Object.keys(value).sort(), ['evidence_status','execution_authorized','operation','profile','qualification','result']);
  assert.equal(value.execution_authorized, false); assert.equal(value.evidence_status, 'historical_observation');
  assert.equal(value.profile, 'commerce-sqlite-diagnostic'); assert.equal(value.qualification, 'candidate_contract_only');
  assert.equal(value.operation, operation); return value.result;
}
async function refused(response: Response, status: number, error?: string) {
  assert.equal(response.status, status); assert.equal(response.headers.get('cache-control'), 'no-store');
  const value = await response.json(); assert.deepEqual(Object.keys(value), ['error']);
  if (error) assert.equal(value.error, error);
}
function raw(f: Fixture, text: string | Buffer, options: { headers?: Record<string,string>; unfinished?: boolean; chunked?: boolean } = {}) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const req = httpRequest(f.server.url + LOOKUP, { method: 'POST', headers: {
      authorization: 'Bearer ' + f.customerBearer, 'content-type': 'application/json',
      ...(!options.chunked ? { 'content-length': String(Buffer.byteLength(text)) } : {}), ...options.headers,
    } }, response => {
      let body = ''; response.on('data', bytes => { body += bytes; });
      response.on('end', () => { try { resolve({ status: response.statusCode!, body: JSON.parse(body) }); }
        catch (error) { reject(error); } finally { req.destroy(); } });
    });
    req.on('error', reject); req.setTimeout(2000, () => req.destroy(new Error('RECOVERY_TEST_TIMEOUT')));
    if (options.unfinished) req.flushHeaders(); else req.end(text);
  });
}
async function withClient(fn: (run: (url: string, args: string[], bearer?: string) => Promise<Run>) => Promise<unknown>) {
  const directory = mkdtempSync(join(tmpdir(), 'rifare-recovery-client-')), client = join(directory, 'delegated_checkout.py');
  copyFileSync(new URL('../../clients/delegated_checkout.py', import.meta.url), client);
  const run = (url: string, args: string[], bearer = BEARER) => new Promise<Run>((resolve, reject) => {
    const child = spawn(process.env.RIFARE_TEST_PYTHON || 'python3', ['-I', client, '--base-url', url, ...args], {
      cwd: directory, env: { PATH: process.env.PATH, RIFARE_BEARER: bearer }, stdio: ['ignore','pipe','pipe'],
    });
    let stdout = '', stderr = '', length = 0;
    const deadline = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('RECOVERY_CLIENT_TIMEOUT')); }, 8000);
    const collect = (bytes: Buffer, stream: 'out'|'err') => {
      length += bytes.length; if (length > 524288) { child.kill('SIGKILL'); return; }
      if (stream === 'out') stdout += bytes; else stderr += bytes;
    };
    child.stdout.on('data', bytes => collect(bytes, 'out')); child.stderr.on('data', bytes => collect(bytes, 'err'));
    child.once('error', error => { clearTimeout(deadline); reject(error); });
    child.once('close', code => { clearTimeout(deadline); resolve({ code, stdout, stderr }); });
  });
  try { await fn(run); } finally { rmSync(directory, { recursive: true }); }
}
async function stub(handler: (req: IncomingMessage, res: ServerResponse, body: string, count: number) => void,
  fn: (url: string, calls: string[]) => Promise<unknown>) {
  const calls: string[] = [];
  const server = createServer((req, res) => {
    calls.push(req.method + ' ' + req.url); let body = '';
    req.on('data', bytes => { body += bytes; }); req.on('end', () => handler(req, res, body, calls.length));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  try { await fn('http://127.0.0.1:' + address.port, calls); }
  finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
function envelope(operation = 'lookup', result: any = { original: ORIGINAL, intent: {
  intent_id: 'original-intent', revision: 1, state: 'prepared', execution_authorized: false,
  qualification: 'candidate_contract_only', evidence_status: 'historical_observation',
} }) {
  return { profile: 'commerce-sqlite-diagnostic', qualification: 'candidate_contract_only',
    evidence_status: 'historical_observation', execution_authorized: false, operation, result };
}
function json(res: ServerResponse, value: unknown, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value));
}
function success(result: Run) {
  assert.equal(result.code, 0, result.stderr); assert.equal(result.stderr, ''); return JSON.parse(result.stdout);
}
function failure(result: Run, code: string) {
  assert.equal(result.code, 1); assert.equal(result.stdout, '');
  assert.deepEqual(JSON.parse(result.stderr), { error: code, execution_authorized: false });
}

test('RCG5B-HTTP-CONTRACT-COMPATIBILITY', () => usingCheckoutHttp(async f => {
  const old = await outcome(await f.request('contract'), 'contract');
  assert.deepEqual(old, JSON.parse(readFileSync(new URL('../../packages/commerce/contracts/delegated-checkout-api.v1.json', import.meta.url), 'utf8')));
  assert.deepEqual(old.routes.map((r: any) => r.operation), ['contract','preview','preview-status','prepare','status','receipt','cancel']);
  const recovery = await outcome(await f.request(BASE + '/contract'), 'recovery-contract');
  assert.equal(recovery.schema_version, 1); assert.equal(recovery.base_path, BASE);
  assert.deepEqual(recovery.routes, [
    { method: 'GET', path: '/contract', operation: 'recovery-contract', body: [] },
    { method: 'POST', path: '/lookup', operation: 'lookup', body: ['preview_id','context_id'] },
  ]);
  assert.equal(recovery.body_limit_bytes, 4096); assert.match(recovery.absence, /does not prove/);
}));

test('RCG5B-HTTP-RETAINED-HISTORY', () => usingCheckoutHttp(async f => {
  const before = f.effects(); await f.capture(); await f.restartServer(false);
  const expected = f.intents.read(f.customer, f.intent.intent_id);
  assert.deepEqual(await outcome(await f.request(LOOKUP, f.intentRequest)), { original: f.intentRequest, intent: expected });
  await refused(await f.request('prepare', f.intentRequest), 503, 'RECEIPT_UNAVAILABLE');
  const cancelled = await outcome(await f.request('cancel', { intent_id: f.intent.intent_id, expected_revision: 2 }), 'cancel');
  assert.equal(cancelled.minimized, true); assert.equal(cancelled.purchase, null); assert.equal(cancelled.receipt, null);
  assert.deepEqual(await outcome(await f.request(LOOKUP, f.intentRequest)), { original: f.intentRequest, intent: cancelled });
  assert.equal(f.intentRows().length, 1); assert.deepEqual(f.effects(), before); assert.equal(f.verifyCalls, 1);
}));

test('RCG5B-HTTP-AUTH-BEFORE-BODY', () => usingCheckoutHttp(async f => {
  for (const [authorization, status] of [['',403],['Bearer ' + f.owner.bearer,404]] as const) {
    const r = await raw(f, 'x'.repeat(9000), { unfinished: true, headers: { authorization } });
    assert.equal(r.status, status);
  }
  const before = f.intentRows(); changedProof(f.checkout, true);
  const r = await raw(f, 'x'.repeat(9000), { unfinished: true });
  assert.equal(r.status, 403); assert.equal(r.body.error, 'CUSTOMER_VERIFICATION_REQUIRED');
  await refused(await f.request(LOOKUP, { preview_id: 'unknown', context_id: 'unknown' }), 403);
  assert.deepEqual(f.intentRows(), before);
}));

test('RCG5B-HTTP-SCOPE-AND-ABSENCE', () => usingCheckoutHttp(async f => {
  const before = f.intentRows(), effects = f.effects();
  for (const token of [f.owner.bearer, f.a.bearer, f.agent.bearer, f.a.workerBearer])
    await refused(await f.request(LOOKUP, f.intentRequest, token), 404, 'NOT_FOUND');
  for (const input of [{ ...f.intentRequest, preview_id: 'unknown' }, { ...f.intentRequest, context_id: 'unknown' }])
    await refused(await f.request(LOOKUP, input), 404, 'NOT_FOUND');
  assert.deepEqual(f.intentRows(), before); assert.deepEqual(f.effects(), effects);
}));

test('RCG5B-HTTP-EXACT-INPUT', () => usingCheckoutHttp(async f => {
  const before = f.intentRows();
  for (const input of [null, [], {}, { preview_id: f.intentRequest.preview_id },
    { ...f.intentRequest, intent_id: f.intent.intent_id }, { ...f.intentRequest, tenant_id: 'caller-tenant' },
    { ...f.intentRequest, context_id: 1 }, { ...f.intentRequest, preview_id: 'x'.repeat(97) },
    { ...f.intentRequest, preview_id: 'https://example.invalid' }])
    await refused(await f.request(LOOKUP, input), 400);
  for (const malformed of [
    '{"preview_id":"one","preview_id":"two","context_id":"context"}',
    '{"preview_id":"one","preview_\\u0069d":"two","context_id":"context"}',
    '{"preview_id":"one","context_id":"\\ud800"}',
    Buffer.from([0x7b,0x22,0xc0,0xaf,0x22,0x3a,0x31,0x7d]),
  ]) {
    const rejected = await raw(f, malformed);
    assert.equal(rejected.status, 400); assert.equal(rejected.body.error, 'INVALID_JSON');
  }
  assert.deepEqual(f.intentRows(), before);
}));

test('RCG5B-HTTP-TRANSPORT-BOUNDS', () => usingCheckoutHttp(async f => {
  await refused(await f.request(LOOKUP), 405, 'METHOD_NOT_ALLOWED');
  await refused(await f.request(BASE + '/contract', f.intentRequest), 405, 'METHOD_NOT_ALLOWED');
  for (const suffix of ['', '/', '/look%75p', '/lookup/', '/lookup/extra'])
    await refused(await f.request(BASE + suffix, f.intentRequest), 404, 'NOT_FOUND');
  await refused(await f.request(LOOKUP + '?context=override', f.intentRequest), 400);
  assert.equal((await raw(f, JSON.stringify(f.intentRequest), { headers: { 'content-type': 'text/plain' } })).status, 415);
  for (const chunked of [false, true]) assert.equal((await raw(f, ' '.repeat(4097), { chunked })).status, 413);
  await refused(await f.request(LOOKUP, f.intentRequest, f.customerBearer, { origin: 'https://example.invalid' }), 403);
  assert.equal(f.intentRows().length, 1);
}));

test('RCG5B-HTTP-SANITIZED-FAILURE', () => usingCheckoutHttp(async f => {
  await outcome(await f.request(LOOKUP, f.intentRequest));
  f.db.prepare('UPDATE commerce_support_documents SET body=? WHERE id=?').run('sensitive-' + f.customerBearer, f.intent.intent_id);
  await refused(await f.request(LOOKUP, f.intentRequest), 500, 'INTERNAL_ERROR');
  const logs = JSON.stringify(f.logs);
  for (const value of [f.customerBearer, f.token, f.intentRequest.preview_id, f.intentRequest.context_id, 'sensitive-'])
    assert.equal(logs.includes(value), false);
}));

test('RCG5B-CLIENT-NATIVE-RECOVERY', () => usingCheckoutHttp(async f => withClient(async run => {
  await f.restartServer(false);
  const call = (args: string[]) => run(f.server.url, args, f.customerBearer);
  assert.equal(success(await call(['contract'])).result.routes.length, 7);
  assert.equal(success(await call(['recovery-contract'])).result.routes.length, 2);
  const args = ['lookup', '--preview-id', f.intentRequest.preview_id, '--context-id', f.intentRequest.context_id];
  const lookup = success(await call(args)).result;
  assert.deepEqual(lookup.original, f.intentRequest); assert.deepEqual(lookup.intent, f.intent);
  failure(await call(['prepare', ...args.slice(1)]), 'UNAVAILABLE');
  failure(await call(['lookup', '--preview-id', f.intentRequest.preview_id, '--context-id', 'absent']), 'NOT_FOUND');
  const cancelled = success(await call(['cancel', '--intent-id', lookup.intent.intent_id, '--expected-revision', '1'])).result;
  assert.deepEqual(success(await call(args)).result.intent, cancelled); assert.equal(f.intentRows().length, 1);
})));

test('RCG5B-CLIENT-ORIGINAL-BINDING', () => withClient(async run => {
  for (const bad of [null, {}, { ...ORIGINAL, preview_id: 'different' }, { ...ORIGINAL, extra: 'caller-authority' }])
    await stub((_req, res) => { const value = envelope(); value.result.original = bad; json(res, value); },
      async url => failure(await run(url, ARGS), 'RESPONSE_BINDING_MISMATCH'));
  await stub((_req, res) => { const value = envelope(); value.result.intent.revision = true; json(res, value); },
    async url => failure(await run(url, ARGS), 'RESPONSE_INVALID'));
  await stub((_req, res) => { const value = envelope(); value.result.intent.execution_authorized = true; json(res, value); },
    async url => failure(await run(url, ARGS), 'EXECUTION_AUTHORITY_REFUSED'));
}));

test('RCG5B-CLIENT-CONTRACT-BOUNDARY', () => withClient(async run => {
  const contract = JSON.parse(readFileSync(new URL('../../packages/commerce/contracts/delegated-checkout-recovery.v1.json', import.meta.url), 'utf8'));
  await stub((req, res) => {
    assert.equal(req.method, 'GET'); assert.equal(req.url, BASE + '/contract');
    json(res, envelope('recovery-contract', contract));
  }, async url => assert.equal(success(await run(url, ['recovery-contract'])).result.base_path, BASE));
  for (const modified of [{ ...contract, base_path: '/v1/delegated-checkout' },
    { ...contract, routes: [...contract.routes].reverse() }, { ...contract, routes: [...contract.routes, contract.routes[1]] }])
    await stub((_req, res) => json(res, envelope('recovery-contract', modified)),
      async url => failure(await run(url, ['recovery-contract']), 'RESPONSE_INVALID'));
}));

test('RCG5B-CLIENT-NO-RETRY-OR-FALLBACK', () => withClient(async run => {
  for (const mode of ['absent','lost']) await stub((req, res, body) => {
    assert.equal(req.headers.authorization, 'Bearer ' + BEARER); assert.deepEqual(JSON.parse(body), ORIGINAL);
    if (mode === 'lost') req.socket.destroy(); else json(res, { error: 'NOT_FOUND' }, 404);
  }, async (url, calls) => {
    failure(await run(url, ARGS), mode === 'lost' ? 'REQUEST_FAILED' : 'NOT_FOUND');
    assert.deepEqual(calls, ['POST ' + LOOKUP]);
  });
}));

test('RCG5B-CLIENT-INPUT-AND-SECRET-BOUNDARY', () => withClient(async run => {
  await stub((_req, res) => json(res, envelope()), async (url, calls) => {
    for (const args of [['lookup'], ['lookup','--preview-id','one'], [...ARGS,'--tenant-id','other'],
      ['lookup','--preview-id','x'.repeat(97),'--context-id','two'], ['recovery-contract','--context-id','other']])
      failure(await run(url, args), 'INVALID_ARGUMENTS');
    assert.equal(calls.length, 0);
  });
  await stub((_req, res) => { const value = envelope(); value.result.intent.detail = BEARER; json(res, value); },
    async url => failure(await run(url, ARGS), 'SECRET_REFLECTION_REFUSED'));
}));
