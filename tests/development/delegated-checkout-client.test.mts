import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { usingCheckoutHttp } from './delegated-checkout-http-helpers.mts';
import { changedProof } from './delegated-checkout-helpers.mts';

const BEARER = 'b'.repeat(43);
const TOKEN = 'synthetic_header.synthetic_payload.synthetic_signature';
const statusArgs = ['status', '--intent-id', 'intent-one'];
type Run = { code: number|null; stdout: string; stderr: string };

function isolatedClient() {
  const directory = mkdtempSync(join(tmpdir(), 'rifare-checkout-client-'));
  const filename = join(directory, 'delegated_checkout.py');
  copyFileSync(new URL('../../clients/delegated_checkout.py', import.meta.url), filename);
  assert.deepEqual(readdirSync(directory), ['delegated_checkout.py']);
  const run = (base: string, args: string[], input = '', environment: Record<string, string|undefined> = {}): Promise<Run> =>
    new Promise((resolve, reject) => {
      const child = spawn(process.env.RIFARE_TEST_PYTHON || 'python3', ['-I', filename, '--base-url', base, ...args], {
        cwd: directory, env: { PATH: process.env.PATH, RIFARE_BEARER: BEARER, ...environment },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '', stderr = '';
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('isolated client deadline')); }, 8000);
      child.stdout.on('data', data => { stdout += data; });
      child.stderr.on('data', data => { stderr += data; });
      child.stdin.on('error', () => {}); // Invalid arguments may exit before stdin is consumed.
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
      child.stdin.end(input);
    });
  return { directory, run, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

async function withClient(fn: (client: ReturnType<typeof isolatedClient>) => Promise<unknown>) {
  const client = isolatedClient(); try { await fn(client); } finally { client.cleanup(); }
}

async function stub(handler: (req: IncomingMessage, res: ServerResponse, body: string) => void,
  fn: (url: string, calls: { count: number }) => Promise<unknown>) {
  const calls = { count: 0 };
  const server = createServer((req, res) => {
    calls.count++; let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => handler(req, res, body));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  try { await fn(`http://127.0.0.1:${address.port}`, calls); }
  finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}

function intent(extra: Record<string, unknown> = {}) {
  return { intent_id: 'intent-one', revision: 1, state: 'prepared', execution_authorized: false,
    qualification: 'candidate_contract_only', evidence_status: 'historical_observation', ...extra };
}
function envelope(operation = 'status', result: unknown = intent()) {
  return { profile: 'commerce-sqlite-diagnostic', qualification: 'candidate_contract_only',
    evidence_status: 'historical_observation', execution_authorized: false, operation, result };
}
function json(res: ServerResponse, value: unknown, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value));
}
function success(run: Run) {
  assert.equal(run.code, 0, run.stderr); assert.equal(run.stderr, '');
  const value = JSON.parse(run.stdout); assert.equal(value.execution_authorized, false); return value;
}
function failure(run: Run, expected: string) {
  assert.equal(run.code, 1); assert.equal(run.stdout, '');
  assert.deepEqual(JSON.parse(run.stderr), { error: expected, execution_authorized: false });
}

test('RCG4HTTP-CLIENT-NATIVE-FLOW', () => usingCheckoutHttp(async f => withClient(async client => {
  const before = f.effects(), env = { RIFARE_BEARER: f.customerBearer }, url = f.server.url;
  const invoke = (args: string[], input = '') => client.run(url, args, input, env);
  const contract = success(await invoke(['contract'])); assert.equal(contract.result.routes.length, 7);
  const preview = success(await invoke(['preview', '--cart-id', f.checkout.request.cart_id,
    '--shipping-quote-id', f.checkout.request.shipping_quote_id, '--fee-quote-id', f.checkout.request.fee_quote_id]));
  assert.equal(preview.result.total_payable_minor, '6800'); assert.equal(preview.result.qualification, 'synthetic_only');
  const readPreview = success(await invoke(['preview-status', '--preview-id', f.receiptPreview.preview_id]));
  assert.equal(readPreview.result.preview_digest, f.receiptPreview.preview_digest);
  const prepared = success(await invoke(['prepare', '--preview-id', f.intentRequest.preview_id,
    '--context-id', f.intentRequest.context_id]));
  assert.equal(prepared.result.intent_id, f.intent.intent_id);
  const args = ['status', '--intent-id', f.intent.intent_id];
  assert.equal(success(await invoke(args)).result.state, 'prepared');
  const capture = ['receipt', '--intent-id', f.intent.intent_id];
  const verifiedRun = await invoke(capture, f.token + '\n'), verified = success(verifiedRun);
  assert.equal(verified.result.state, 'evidence_verified'); assert.equal(verified.result.revision, 2);
  assert.deepEqual(success(await invoke(capture, f.token)).result, verified.result); assert.equal(f.verifyCalls, 1);
  const cancelled = success(await invoke(['cancel', '--intent-id', f.intent.intent_id, '--expected-revision', '2']));
  assert.equal(cancelled.result.state, 'cancelled'); assert.equal(cancelled.result.authority_revoked, true);
  assert.equal(success(await invoke(args)).result.state, 'cancelled');
  assert.equal(verifiedRun.stdout.includes(f.token), false); assert.equal(verifiedRun.stdout.includes(f.customerBearer), false);
  assert.deepEqual(f.effects(), before); assert.equal(JSON.stringify(f.logs).includes(f.token), false);
})));

test('RCG4HTTP-CLIENT-RESTART-RETAINED-STATUS', () => usingCheckoutHttp(async f => withClient(async client => {
  await f.restartServer(false);
  const env = { RIFARE_BEARER: f.customerBearer }, args = ['status', '--intent-id', f.intent.intent_id];
  assert.equal(success(await client.run(f.server.url, args, '', env)).result.state, 'prepared');
  failure(await client.run(f.server.url, ['prepare', '--preview-id', f.intentRequest.preview_id,
    '--context-id', f.intentRequest.context_id], '', env), 'UNAVAILABLE');
  assert.equal(success(await client.run(f.server.url, ['cancel', '--intent-id', f.intent.intent_id,
    '--expected-revision', '1'], '', env)).result.state, 'cancelled');
})));

test('RCG4HTTP-CLIENT-CURRENT-PROOF', () => usingCheckoutHttp(async f => withClient(async client => {
  changedProof(f.checkout, true);
  const response = await client.run(f.server.url, ['receipt', '--intent-id', f.intent.intent_id], f.token,
    { RIFARE_BEARER: f.customerBearer });
  assert.equal(response.code, 1); assert.equal(response.stdout, '');
  assert.equal(f.verifyCalls, 0); assert.equal(f.record().body.token_digest, null);
  assert.equal(response.stderr.includes(f.token), false); assert.equal(response.stderr.includes(f.customerBearer), false);
})));

test('RCG4HTTP-CLIENT-EXACT-LOOPBACK', () => withClient(async client => stub((_req, res) => json(res, envelope()), async (url, calls) => {
  const port = new URL(url).port;
  for (const invalid of [url + '/', url + '/path', url + '?q=1', url + '#fragment', url + ' ',
    `http://localhost:${port}`, `http://127.1:${port}`, `http://2130706433:${port}`, `http://[::1]:${port}`,
    `http://127.0.0.2:${port}`, `https://127.0.0.1:${port}`, `http://user@127.0.0.1:${port}`,
    `http://user:password@127.0.0.1:${port}`, 'http://127.0.0.1:0', 'http://127.0.0.1:65536', 'http://127.0.0.1:08080'])
    failure(await client.run(invalid, statusArgs), 'LOOPBACK_REQUIRED');
  assert.equal(calls.count, 0);
})));

test('RCG4HTTP-CLIENT-PROXY-IGNORED', () => withClient(async client => stub((req, res) => {
  assert.equal(req.headers.authorization, 'Bearer ' + BEARER); assert.equal(req.url, '/v1/delegated-checkout/status');
  json(res, envelope());
}, async (url, calls) => {
  success(await client.run(url, statusArgs, '', { HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1',
    ALL_PROXY: 'http://127.0.0.1:1', http_proxy: 'http://127.0.0.1:1', NO_PROXY: '', no_proxy: '' }));
  assert.equal(calls.count, 1);
})));

test('RCG4HTTP-CLIENT-NO-REDIRECT', () => withClient(async client => {
  let redirected = 0;
  await stub((_req, res) => { redirected++; json(res, envelope()); }, async target =>
    stub((_req, res) => { res.writeHead(307, { location: target }); res.end(); }, async (url, calls) => {
      failure(await client.run(url, statusArgs), 'REDIRECT_REFUSED'); assert.equal(calls.count, 1);
    }));
  assert.equal(redirected, 0);
}));

test('RCG4HTTP-CLIENT-NO-AUTO-RETRY', () => withClient(async client => stub((req) => {
  req.socket.destroy();
}, async (url, calls) => {
  failure(await client.run(url, ['receipt', '--intent-id', 'intent-one'], TOKEN), 'REQUEST_FAILED');
  assert.equal(calls.count, 1);
})));

test('RCG4HTTP-CLIENT-CREDENTIAL-BOUNDARY', () => withClient(async client => stub((_req, res) => json(res, envelope()), async (url, calls) => {
  for (const value of [undefined, '', 'short', BEARER + '\r\nInjected: x', ' '.repeat(43)]) {
    const response = await client.run(url, statusArgs, '', { RIFARE_BEARER: value });
    failure(response, 'CREDENTIAL_REQUIRED'); if (value) assert.equal(response.stderr.includes(value), false);
  }
  const response = await client.run(url, [...statusArgs, '--compact-jws', TOKEN]);
  failure(response, 'INVALID_ARGUMENTS'); assert.equal(response.stderr.includes(TOKEN), false); assert.equal(calls.count, 0);
})));

test('RCG4HTTP-CLIENT-ARGUMENT-BOUNDS', () => withClient(async client => stub((_req, res) => json(res, envelope()), async (url, calls) => {
  for (const args of [[], ['status'], ['status', '--intent-id', '../elsewhere'], ['status', '--intent-id', 'x'.repeat(97)],
    ['cancel', '--intent-id', 'intent-one', '--expected-revision', '0'],
    ['cancel', '--intent-id', 'intent-one', '--expected-revision', '-1'],
    ['cancel', '--intent-id', 'intent-one', '--expected-revision', '1.0'],
    ['cancel', '--intent-id', 'intent-one', '--expected-revision', '9007199254740992']])
    failure(await client.run(url, args), 'INVALID_ARGUMENTS');
  assert.equal(calls.count, 0);
})));

test('RCG4HTTP-CLIENT-RECEIPT-INPUT-BOUNDS', () => withClient(async client => stub((_req, res) => json(res, envelope('receipt')), async (url, calls) => {
  const args = ['receipt', '--intent-id', 'intent-one'];
  for (const invalid of ['', 'abc', 'a.b.c.d', 'a.b.c=', ' a.b.c', 'a.b.c\n\n', 'a.b.é'])
    failure(await client.run(url, args, invalid), 'RECEIPT_INVALID');
  failure(await client.run(url, args, 'a'.repeat(99997) + '.b.c'), 'RECEIPT_LIMIT');
  failure(await client.run(url, args, 'a'.repeat(200000)), 'RECEIPT_LIMIT'); assert.equal(calls.count, 0);
})));

test('RCG4HTTP-CLIENT-MAXIMUM-RECEIPT', () => withClient(async client => {
  const token = 'a'.repeat(99996) + '.b.c';
  await stub((req, res, raw) => {
    assert.equal(req.method, 'POST'); assert.equal(req.url, '/v1/delegated-checkout/receipt');
    assert.deepEqual(JSON.parse(raw), { intent_id: 'intent-one', compact_jws: token });
    json(res, envelope('receipt', intent({ state: 'evidence_verified', revision: 2 })));
  }, async (url, calls) => {
    success(await client.run(url, ['receipt', '--intent-id', 'intent-one'], token + '\r\n'));
    assert.equal(calls.count, 1);
  });
}));

test('RCG4HTTP-CLIENT-RESPONSE-BOUNDS', () => withClient(async client => {
  for (const announced of [true, false]) await stub((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json', ...(announced ? { 'content-length': '262145' } : {}) });
    res.write('x'.repeat(262145)); res.end();
  }, async (url, calls) => { failure(await client.run(url, statusArgs), 'RESPONSE_LIMIT'); assert.equal(calls.count, 1); });
}));

test('RCG4HTTP-CLIENT-STRICT-JSON', () => withClient(async client => {
  const valid = JSON.stringify(envelope());
  for (const raw of [valid.replace('"execution_authorized":false', '"execution_authorized":true,"execution_authorized":false'),
    valid.replace('"revision":1', '"revision":NaN'), valid.replace('"revision":1', '"revision":Infinity'),
    valid.replace('"revision":1', '"revision":1e9999')])
    await stub((_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(raw); },
      async url => failure(await client.run(url, statusArgs), 'RESPONSE_INVALID'));
  for (const raw of ['{malformed', Buffer.from([0xff, 0xfe])])
    await stub((_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(raw); },
      async url => failure(await client.run(url, statusArgs), 'REQUEST_FAILED'));
}));

test('RCG4HTTP-CLIENT-RESPONSE-AUTHORITY', () => withClient(async client => {
  const mutations = [
    { ...envelope(), execution_authorized: true },
    { ...envelope(), execution_authorized: 0 },
    envelope('status', intent({ execution_authorized: true })),
    envelope('status', intent({ receipt: { execution_authorized: true } })),
  ];
  for (const value of mutations) await stub((_req, res) => json(res, value), async url =>
    failure(await client.run(url, statusArgs), 'EXECUTION_AUTHORITY_REFUSED'));
}));

test('RCG4HTTP-CLIENT-RESPONSE-CONTEXT', () => withClient(async client => {
  for (const value of [{ ...envelope(), profile: 'production' }, { ...envelope(), qualification: 'qualified' },
    { ...envelope(), evidence_status: 'current_authority' }, envelope('receipt'),
    { ...envelope(), extra: 'unsupported' }, { ...envelope(), result: [] },
    envelope('status', intent({ revision: true })), envelope('status', intent({ state: 'executed' })),
    envelope('status', intent({ qualification: 'qualified' }))])
    await stub((_req, res) => json(res, value), async url => failure(await client.run(url, statusArgs), 'RESPONSE_INVALID'));
  await stub((_req, res) => json(res, envelope('status', intent({ intent_id: 'another-intent' }))), async url =>
    failure(await client.run(url, statusArgs), 'RESPONSE_BINDING_MISMATCH'));
}));

test('RCG4HTTP-CLIENT-SECRET-REFLECTION', () => withClient(async client => {
  for (const reflected of [BEARER, TOKEN]) await stub((_req, res) =>
    json(res, envelope('receipt', intent({ note: reflected }))), async url => {
      const response = await client.run(url, ['receipt', '--intent-id', 'intent-one'], TOKEN);
      failure(response, 'SECRET_REFLECTION_REFUSED'); assert.equal(response.stderr.includes(reflected), false);
    });
}));

test('RCG4HTTP-CLIENT-SANITIZED-HTTP-ERRORS', () => withClient(async client => {
  for (const [status, code] of [[400, 'INVALID_REQUEST'], [403, 'REQUEST_DENIED'], [404, 'NOT_FOUND'],
    [409, 'CONFLICT'], [413, 'BODY_TOO_LARGE'], [500, 'REQUEST_FAILED'], [503, 'UNAVAILABLE']] as const)
    await stub((_req, res) => json(res, { error: BEARER + TOKEN }, status), async (url, calls) => {
      const response = await client.run(url, statusArgs); failure(response, code);
      assert.equal(response.stderr.includes(BEARER), false); assert.equal(response.stderr.includes(TOKEN), false);
      assert.equal(calls.count, 1);
    });
}));

test('RCG4HTTP-CLIENT-MEDIA-TYPE', () => withClient(async client => {
  for (const headers of [{ 'content-type': 'text/html' }, { 'content-type': 'application/json', 'content-encoding': 'gzip' }])
    await stub((_req, res) => { res.writeHead(200, headers); res.end(JSON.stringify(envelope())); }, async url =>
      failure(await client.run(url, statusArgs), 'RESPONSE_INVALID'));
}));

test('RCG4HTTP-CLIENT-HELP', () => withClient(async client => {
  const response = await client.run('http://127.0.0.1:1', ['--help'], '', { RIFARE_BEARER: undefined });
  assert.equal(response.code, 0); assert.equal(response.stderr, '');
  for (const word of ['contract', 'preview-status', 'prepare', 'receipt', 'cancel', 'RIFARE_BEARER', '< receipt.jws'])
    assert.ok(response.stdout.includes(word));
}));
