import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { usingCommandHttp } from './delegated-checkout-command-helpers.mts';
import { changedProof } from './delegated-checkout-helpers.mts';

const BEARER = 'b'.repeat(43);
const OTHER_ID = 'fedcba98-7654-3210-fedc-ba9876543210';
const FAMILY = '/v1/delegated-checkout-commands/';
type Run = { code: number | null; stdout: string; stderr: string };
type Fixture = Parameters<Parameters<typeof usingCommandHttp>[0]>[0];

/** Copy only the standard-library caller. It cannot import the native oracle,
 * source owners, package dependencies or repository-relative Python modules. */
function isolatedClient() {
  const directory = mkdtempSync(join(tmpdir(), 'rifare-command-client-'));
  const filename = join(directory, 'delegated_checkout.py');
  copyFileSync(new URL('../../clients/delegated_checkout.py', import.meta.url), filename);
  assert.deepEqual(readdirSync(directory), ['delegated_checkout.py']);
  const run = (url: string, args: string[], environment: Record<string, string | undefined> = {}): Promise<Run> =>
    new Promise((resolve, reject) => {
      const child = spawn('python3', ['-I', filename, '--base-url', url, ...args], {
        cwd: directory, env: { PATH: process.env.PATH, RIFARE_BEARER: BEARER, ...environment },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '', stderr = '';
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('command client deadline')); }, 8000);
      child.stdout.on('data', data => { stdout += data; });
      child.stderr.on('data', data => { stderr += data; });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    });
  return { run, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}
async function withClient(fn: (client: ReturnType<typeof isolatedClient>) => Promise<unknown>) {
  const client = isolatedClient(); try { await fn(client); } finally { client.cleanup(); }
}
async function stub(handler: (req: IncomingMessage, res: ServerResponse, body: string) => void | Promise<void>,
  fn: (url: string, calls: { count: number }) => Promise<unknown>) {
  const calls = { count: 0 }; let callbackError: unknown;
  const server = createServer((req, res) => {
    calls.count++; let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => { Promise.resolve().then(() => handler(req, res, body)).catch(error => {
      callbackError = error; res.destroy();
    }); });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  try { await fn(`http://127.0.0.1:${address.port}`, calls); if (callbackError) throw callbackError; }
  finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
function envelope(operation: string, result: unknown) {
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
function failure(run: Run, expected?: string) {
  assert.equal(run.code, 1, run.stdout); assert.equal(run.stdout, '');
  const value = JSON.parse(run.stderr);
  assert.deepEqual(Object.keys(value).sort(), ['error', 'execution_authorized']);
  assert.equal(value.execution_authorized, false); assert.match(value.error, /^[A-Z][A-Z_]{1,79}$/);
  if (expected) assert.equal(value.error, expected);
}
const statusArgs = (id: string) => ['command-status', '--command-id', id];
const startArgs = (f: Fixture) => ['command-start', '--command-id', f.startRequest.command_id,
  '--preview-id', f.preview.preview_id];
const recoveryArgs = (id: string) => ['command-recovery', '--command-id', id];
const cancelArgs = (id: string, revision: number) => ['command-cancel', '--command-id', id,
  '--expected-revision', String(revision)];
const hash = (text: string) => 'sha256:' + createHash('sha256').update(text).digest('hex');
function unverified(value: any) {
  assert.equal(value.execution_authorized, false); assert.equal(value.provider_authenticated, false);
  assert.equal(value.receipt_signature_verified, false); assert.equal(value.qualification, 'candidate_contract_only');
  assert.equal(value.observation_origin, 'local_unverified_input');
  assert.equal(value.evidence_status, 'historical_unverified_observation');
}

test('RCG4BC4-CLIENT-NATIVE independent caller retains the full native original and explicitly cancels it', () => usingCommandHttp(async f => withClient(async client => {
  const before = f.effects(), env = { RIFARE_BEARER: f.bearer }, id = f.startRequest.command_id;
  const invoke = (args: string[]) => client.run(f.server.url, args, env);
  const contract = success(await invoke(['command-contract']));
  assert.equal(contract.operation, 'command-contract'); assert.equal(contract.result.routes.length, 5);
  const firstRun = await invoke(startArgs(f)), first = success(firstRun);
  assert.equal(first.operation, 'command-start'); unverified(first.result);
  assert.equal(first.result.original_command_id, id); assert.equal(first.result.state, 'claimed');
  const original = JSON.parse(first.result.canonical_request);
  assert.equal(original.command_id, id); assert.equal(original.command, 'START_USE');
  assert.deepEqual(original.operation, { action: 'urn:rifare:action:purchase:v1',
    audience: 'urn:rifare:store:' + f.preview.store_id, request_digest: 'sha256:' + f.preview.preview_digest,
    request_profile: 'urn:rifare:checkout-preview:v1', resource_id: 'urn:rifare:resource:' + f.preview.resource_id });
  assert.equal(first.result.command_digest, hash(first.result.canonical_request));
  assert.deepEqual(success(await invoke(startArgs(f))).result, first.result); assert.equal(f.claimRows().length, 1);
  assert.deepEqual(success(await invoke(statusArgs(id))).result, first.result);
  const recovery = success(await invoke(recoveryArgs(id))); unverified(recovery.result);
  assert.equal(recovery.operation, 'command-recovery');
  assert.deepEqual(recovery.result.request, { profile: 'urn:marty:delegation-command:v1', command: 'RECOVER_RESULT',
    original_command_id: id, expected_command_digest: first.result.command_digest });
  assert.deepEqual(JSON.parse(recovery.result.canonical_json), recovery.result.request);
  failure(await invoke(cancelArgs(id, 2)), 'CONFLICT');
  const cancelled = success(await invoke(cancelArgs(id, 1))).result;
  assert.equal(cancelled.revision, 2); assert.equal(cancelled.state, 'cancelled');
  assert.equal(cancelled.retired, true); assert.equal(cancelled.minimized, true);
  assert.equal(cancelled.canonical_request, null); assert.equal(cancelled.response, null);
  assert.deepEqual(success(await invoke(statusArgs(id))).result, cancelled);
  failure(await invoke(recoveryArgs(id)), 'CONFLICT');
  assert.deepEqual(f.effects(), before); assert.equal(f.claimRows().length, 1);
  for (const secret of [f.bearer, id, f.preview.preview_id]) assert.equal(JSON.stringify(f.logs).includes(secret), false);
  assert.equal(firstRun.stdout.includes(f.bearer), false);
})));

test('RCG4BC4-CLIENT-HISTORY explicit original history remains available without live START configuration', () => usingCommandHttp(async f => withClient(async client => {
  const view = f.claimNative(), id = f.startRequest.command_id, env = { RIFARE_BEARER: f.bearer };
  f.starts.close(); f.previews.close(); await f.restartServer('history');
  assert.deepEqual(success(await client.run(f.server.url, statusArgs(id), env)).result, view);
  assert.equal(success(await client.run(f.server.url, recoveryArgs(id), env)).result.original_command_id, id);
  failure(await client.run(f.server.url, startArgs(f), env), 'UNAVAILABLE');
  assert.equal(success(await client.run(f.server.url, cancelArgs(id, 1), env)).result.state, 'cancelled');
  await f.restartServer('absent');
  success(await client.run(f.server.url, ['command-contract'], env));
  failure(await client.run(f.server.url, statusArgs(id), env), 'UNAVAILABLE');
  assert.equal(f.claimRows().length, 1);
})));

test('RCG4BC4-CLIENT-LOST-RESPONSE a lost committed HTTP result causes no automatic second mutation', () => usingCommandHttp(async f => withClient(async client => {
  const env = { RIFARE_BEARER: f.bearer }, id = f.startRequest.command_id;
  await stub(async (req, _res, body) => {
    assert.equal(req.url, FAMILY + 'start'); assert.equal(req.method, 'POST');
    const committed = await fetch(f.server.url + FAMILY + 'start', { method: 'POST',
      headers: { authorization: req.headers.authorization!, 'content-type': 'application/json' }, body });
    assert.equal(committed.status, 200); assert.equal((await committed.json()).result.original_command_id, id);
    assert.equal(f.claimRows().length, 1); req.socket.destroy();
  }, async (url, calls) => { failure(await client.run(url, startArgs(f), env), 'REQUEST_FAILED'); assert.equal(calls.count, 1); });
  assert.equal(f.claimRows().length, 1);
  f.starts.close(); f.previews.close(); await f.restartServer('history');
  const status = success(await client.run(f.server.url, statusArgs(id), env)).result;
  assert.equal(status.original_command_id, id); assert.equal(status.revision, 1); assert.equal(status.state, 'claimed');
  assert.equal(success(await client.run(f.server.url, recoveryArgs(id), env)).result.command_digest, status.command_digest);
  assert.equal(f.claimRows().length, 1);
})));

test('RCG4BC4-CLIENT-ORIGINAL-ID a valid different original must not satisfy this caller identity', () => usingCommandHttp(async f => withClient(async client => {
  const id = f.startRequest.command_id; f.claimNative(); assert.notEqual(OTHER_ID, id);
  const other = f.nativeClaims.claimCheckoutStart(f.customer, { ...f.startRequest, command_id: OTHER_ID });
  assert.equal(other.original_command_id, OTHER_ID); assert.equal(other.command_digest, hash(other.canonical_request!));
  await stub((req, res, body) => {
    assert.equal(req.url, FAMILY + 'status'); assert.equal(JSON.parse(body).command_id, id);
    json(res, envelope('command-status', other));
  }, async (url, calls) => {
    // The isolated fault removes only the request-to-original UUID comparison;
    // this complete, self-consistent second native claim passes the other checks.
    failure(await client.run(url, statusArgs(id)), 'RESPONSE_BINDING_MISMATCH'); assert.equal(calls.count, 1);
  });
})));

test('RCG4BC4-CLIENT-RECOVERY-BINDING unsent recovery must retain its original UUID digest and canonical request', () => usingCommandHttp(async f => withClient(async client => {
  f.claimNative(); const id = f.startRequest.command_id, good = f.nativeClaims.recovery(f.customer, id);
  await stub((_req, res) => json(res, envelope('command-recovery', good)), async url =>
    success(await client.run(url, recoveryArgs(id))));
  const mutations = [
    { ...good, original_command_id: OTHER_ID },
    { ...good, command_digest: 'sha256:' + '0'.repeat(64) },
    { ...good, canonical_json: good.canonical_json + '\n' },
    { ...good, request: { ...good.request, original_command_id: OTHER_ID } },
    { ...good, request: { ...good.request, expected_command_digest: 'sha256:' + '0'.repeat(64) } },
    { ...good, request: { ...good.request, command: 'START_USE' } },
    { ...good, request: { ...good.request, command_id: OTHER_ID } },
  ];
  for (const value of mutations) await stub((_req, res) => json(res, envelope('command-recovery', value)),
    async url => failure(await client.run(url, recoveryArgs(id))));
})));

test('RCG4BC4-CLIENT-VIEW-BINDING malformed original digests canonical bytes and historical states are refused', () => usingCommandHttp(async f => withClient(async client => {
  const good = f.claimNative(), id = f.startRequest.command_id;
  const mutations = [
    { ...good, command_digest: 'sha256:' + '0'.repeat(64) },
    { ...good, canonical_request: good.canonical_request! + '\n' },
    { ...good, canonical_request: good.canonical_request!.replace('"command_id":', '"command_id":"' + OTHER_ID + '","command_id":') },
    { ...good, namespace_digest: 'sha256:' + '0'.repeat(64) },
    { ...good, claim_id: 'forged-claim-id' },
    { ...good, command_kind: 'RECOVER_RESULT' },
    { ...good, revision: true },
    { ...good, state: 'observed' },
    { ...good, minimized: true },
    { ...good, retired: true },
    { ...good, canonical_request: null },
  ];
  for (const value of mutations) await stub((_req, res) => json(res, envelope('command-status', value)),
    async url => failure(await client.run(url, statusArgs(id))));
})));

test('RCG4BC4-CLIENT-AUTHORITY command data cannot become provider authentication or execution authority', () => usingCommandHttp(async f => withClient(async client => {
  const view = f.claimNative(), id = f.startRequest.command_id, good = envelope('command-status', view);
  const mutations = [
    { ...good, execution_authorized: true }, { ...good, execution_authorized: 0 },
    { ...good, profile: 'production' }, { ...good, qualification: 'qualified' },
    { ...good, evidence_status: 'current_authority' }, { ...good, operation: 'command-start' },
    ...[ { execution_authorized: true }, { provider_authenticated: true }, { receipt_signature_verified: true },
      { observation_origin: 'authenticated_provider' }, { evidence_status: 'verified_evidence' },
      { qualification: 'qualified' } ].map(fields => envelope('command-status', { ...view, ...fields })),
  ];
  for (const value of mutations) await stub((_req, res) => json(res, value),
    async url => failure(await client.run(url, statusArgs(id))));
})));

test('RCG4BC4-CLIENT-STRICT-RESPONSE command responses retain strict JSON UTF8 and bounded transport parsing', () => usingCommandHttp(async f => withClient(async client => {
  const view = f.claimNative(), id = f.startRequest.command_id, valid = JSON.stringify(envelope('command-status', view));
  const bad: (string | Buffer)[] = [valid.replace('"execution_authorized":false', '"execution_authorized":true,"execution_authorized":false'),
    valid.replace('"revision":1', '"revision":NaN'), valid.replace('"revision":1', '"revision":1e9999'),
    '{malformed', Buffer.from([0xff, 0xfe])];
  for (const body of bad) await stub((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(body);
  }, async url => failure(await client.run(url, statusArgs(id))));
  for (const headers of [{ 'content-type': 'text/plain' },
    { 'content-type': 'application/json', 'content-encoding': 'gzip' },
    { 'content-type': 'application/json', 'content-length': '262145' }]) await stub((_req, res) => {
      res.writeHead(200, headers); res.end(valid);
    }, async url => failure(await client.run(url, statusArgs(id))));
})));

test('RCG4BC4-CLIENT-INPUT closed command arguments retain explicit lower-case original identity and revision', () => withClient(async client => stub((_req, res) => json(res, {}), async (url, calls) => {
  const id = OTHER_ID;
  for (const args of [ ['command-start'], ['command-start', '--command-id', id],
    ['command-start', '--command-id', id, '--preview-id', '../preview'],
    statusArgs(id.toUpperCase()), statusArgs('00000000-0000-0000-0000-000000000000'), statusArgs('new-command'),
    ['command-cancel', '--command-id', id, '--expected-revision', '0'],
    ['command-cancel', '--command-id', id, '--expected-revision', '1.0'],
    ['command-cancel', '--command-id', id, '--expected-revision', '9007199254740992'],
    [...statusArgs(id), '--grant', BEARER], [...recoveryArgs(id), '--expected-command-digest', 'sha256:' + '0'.repeat(64)],
    ['command-observe', '--command-id', id], ['command-finalize', '--command-id', id] ]) {
    const response = await client.run(url, args); failure(response, 'INVALID_ARGUMENTS');
    assert.equal(response.stderr.includes(BEARER), false);
  }
  failure(await client.run(url, statusArgs(id), { RIFARE_BEARER: undefined }), 'CREDENTIAL_REQUIRED');
  assert.equal(calls.count, 0);
})));

test('RCG4BC4-CLIENT-TRANSPORT new commands use literal loopback without proxies redirects or retry', () => usingCommandHttp(async f => withClient(async client => {
  const view = f.claimNative(), id = f.startRequest.command_id;
  await stub((req, res) => {
    assert.equal(req.headers.authorization, 'Bearer ' + BEARER); assert.equal(req.headers.cookie, undefined);
    json(res, envelope('command-status', view));
  }, async (url, calls) => {
    for (const invalid of [url + '/', url + '?q=1', url.replace('127.0.0.1', 'localhost'), url.replace('http:', 'https:')])
      failure(await client.run(invalid, statusArgs(id)), 'LOOPBACK_REQUIRED');
    assert.equal(calls.count, 0);
    success(await client.run(url, statusArgs(id), { HTTP_PROXY: 'http://127.0.0.1:1',
      ALL_PROXY: 'http://127.0.0.1:1', http_proxy: 'http://127.0.0.1:1', NO_PROXY: '', no_proxy: '' }));
    assert.equal(calls.count, 1);
  });
  let redirected = 0;
  await stub((_req, res) => { redirected++; json(res, envelope('command-status', view)); }, async target =>
    stub((_req, res) => { res.writeHead(307, { location: target }); res.end(); }, async (url, calls) => {
      failure(await client.run(url, statusArgs(id)), 'REDIRECT_REFUSED'); assert.equal(calls.count, 1);
    }));
  assert.equal(redirected, 0);
})));

test('RCG4BC4-CLIENT-SECRET-PROOF current native proof and secret-free failures remain mandatory', () => usingCommandHttp(async f => withClient(async client => {
  const id = f.startRequest.command_id, env = { RIFARE_BEARER: f.bearer };
  f.claimNative(); const rows = f.claimRows();
  failure(await client.run(f.server.url, statusArgs(id), { RIFARE_BEARER: f.owner.bearer }), 'NOT_FOUND');
  changedProof(f, true);
  failure(await client.run(f.server.url, statusArgs(id), env), 'REQUEST_DENIED'); assert.deepEqual(f.claimRows(), rows);
  // Build a valid native raw journal claim whose allowed URI contains the exact
  // bearer. Secret refusal is exercised independently of malformed view fields.
  await usingCommandHttp(async other => {
    const request = structuredClone(other.start.request); request.operation.resource_id = 'urn:secret:' + BEARER;
    const reflected = other.claims.claim(other.customer, request);
    await stub((_req, res) => json(res, envelope('command-status', reflected)), async url => {
      const response = await client.run(url, statusArgs(request.command_id)); failure(response);
      assert.equal(response.stdout.includes(BEARER), false); assert.equal(response.stderr.includes(BEARER), false);
    });
  });
  await stub((_req, res) => json(res, { error: BEARER }, 503), async url => {
    const response = await client.run(url, statusArgs(id)); failure(response, 'UNAVAILABLE');
    assert.equal(response.stderr.includes(BEARER), false);
  });
})));

test('RCG4BC4-CLIENT-OBSERVATIONS historical START and FINALIZE responses retain original binding without trust', () => usingCommandHttp(async f => withClient(async client => {
  f.claimStart(); const observed = f.observeStart(), id = f.start.request.command_id;
  await stub((_req, res) => json(res, envelope('command-status', observed)), async url => {
    const value = success(await client.run(url, statusArgs(id))); unverified(value.result);
    assert.equal(value.result.state, 'observed'); assert.equal(value.result.response.result.kind, 'CHALLENGE');
  });
  f.claimFinal(); const final = f.observeFinal();
  await stub((_req, res) => json(res, envelope('command-status', final)), async url => {
    const value = success(await client.run(url, statusArgs(f.final.request.command_id))); unverified(value.result);
    assert.equal(value.result.response.result.kind, 'FINAL_USE');
  });
  for (const response of [ { ...observed.response, original_command_id: OTHER_ID },
    { ...observed.response, command_digest: 'sha256:' + '0'.repeat(64) },
    { ...observed.response, recovered: 'false' }, { ...observed.response, result: {} } ])
    await stub((_req, res) => json(res, envelope('command-status', { ...observed, response })),
      async url => failure(await client.run(url, statusArgs(id))));
})));
