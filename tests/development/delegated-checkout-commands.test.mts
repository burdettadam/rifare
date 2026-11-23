import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { usingCommandHttp } from './delegated-checkout-command-helpers.mts';
import { changedProof, changedPrice, changedTerms } from './delegated-checkout-helpers.mts';
import { verifiedCustomer } from './shopper-memory-helpers.mts';
import { subjectHash } from '../../packages/commerce/data-guards.mts';

type Fixture = Parameters<Parameters<typeof usingCommandHttp>[0]>[0];
const base = '/v1/delegated-checkout-commands';
const otherId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const original = (f: Fixture) => ({ command_id: f.startRequest.command_id });
async function result(response: Response, operation: string) {
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  const envelope = await response.json();
  assert.deepEqual(Object.keys(envelope).sort(), ['evidence_status','execution_authorized','operation','profile','qualification','result']);
  assert.equal(envelope.profile, 'commerce-sqlite-diagnostic'); assert.equal(envelope.qualification, 'candidate_contract_only');
  assert.equal(envelope.execution_authorized, false); assert.equal(envelope.evidence_status, 'historical_observation');
  assert.equal(envelope.operation, 'command-' + operation); return envelope.result;
}
async function refusal(response: Response, status: number, code?: string) {
  assert.equal(response.status, status); assert.equal(response.headers.get('cache-control'), 'no-store');
  const value = await response.json(); assert.deepEqual(Object.keys(value), ['error']);
  assert.match(value.error, /^[A-Z_]+$/); if (code) assert.equal(value.error, code); return value;
}
function raw(f: Fixture, path: string, bytes: string | Buffer,
  options: { headers?: Record<string, string>; chunked?: boolean; unfinished?: boolean } = {}) {
  return new Promise<{ status: number; body: any; headers: import('node:http').IncomingHttpHeaders }>((resolve, reject) => {
    const req = httpRequest(f.server.url + path, { method: 'POST', headers: {
      authorization: 'Bearer ' + f.bearer, 'content-type': 'application/json',
      ...(!options.chunked ? { 'content-length': String(Buffer.byteLength(bytes)) } : {}), ...options.headers,
    } }, res => {
      const chunks: Buffer[] = []; res.on('data', b => chunks.push(b));
      res.on('end', () => { try { resolve({ status: res.statusCode!, body: JSON.parse(Buffer.concat(chunks).toString()), headers: res.headers }); }
        catch (error) { reject(error); } finally { req.destroy(); } });
    });
    req.on('error', reject); req.setTimeout(2000, () => req.destroy(new Error('HTTP_TEST_TIMEOUT')));
    if (options.unfinished) req.flushHeaders(); else if (options.chunked) { req.write(bytes); req.end(); } else req.end(bytes);
  });
}
async function duringBody(f: Fixture, action: () => void) {
  const session = f.kernel.require(f.customer), bytes = JSON.stringify(f.startRequest); f.advance(1);
  let req!: import('node:http').ClientRequest;
  const pending = new Promise<{ status: number; body: any }>((resolve, reject) => {
    req = httpRequest(f.server.url + base + '/start', { method: 'POST', headers: {
      authorization: 'Bearer ' + f.bearer, 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(bytes)),
    } }, res => {
      const chunks: Buffer[] = []; res.on('data', b => chunks.push(b));
      res.on('end', () => { try { resolve({ status: res.statusCode!, body: JSON.parse(Buffer.concat(chunks).toString()) }); }
        catch (error) { reject(error); } });
    });
    req.on('error', reject); req.setTimeout(2500, () => req.destroy(new Error('HTTP_TEST_TIMEOUT'))); req.write(bytes.slice(0,1));
  });
  void pending.catch(() => {});
  try {
    const deadline = Date.now() + 2000;
    while (f.db.prepare('SELECT last_seen FROM commerce_sessions WHERE token_hash=?').get(session.token_hash)!.last_seen !== f.now()) {
      assert(Date.now() < deadline, 'The server must authenticate before the incomplete body is finished');
      await new Promise(resolve => setTimeout(resolve, 1));
    }
    action(); req.end(bytes.slice(1)); return await pending;
  } finally { req.destroy(); }
}

test('RCG4BC4-HTTP-CONTRACT command routes have a separate exact local contract and preserve prior route lists', () => usingCommandHttp(async f => {
  const contract = await result(await f.request('contract'), 'contract');
  assert.equal(contract.base_path, base);
  assert.deepEqual(contract.routes.map((r: any) => [r.method,r.path,r.operation,r.body]), [
    ['GET','/contract','command-contract',[]], ['POST','/start','command-start',['command_id','preview_id']],
    ['POST','/status','command-status',['command_id']], ['POST','/recovery','command-recovery',['command_id']],
    ['POST','/cancel','command-cancel',['command_id','expected_revision']],
  ]);
  assert.equal(contract.body_limit_bytes, 4096);
  const old = await (await f.request('/v1/delegated-checkout/contract')).json();
  assert.deepEqual(old.result.routes.map((r: any) => r.operation), ['contract','preview','preview-status','prepare','status','receipt','cancel']);
  const recovery = await (await f.request('/v1/delegated-checkout-recovery/contract')).json();
  assert.deepEqual(recovery.result.routes.map((r: any) => r.operation), ['recovery-contract','lookup']);
}));

test('RCG4BC4-HTTP-START actual native purchase is retained once and returned as unverified history', () => usingCommandHttp(async f => {
  const before = f.effects(), first = await result(await f.request('start', f.startRequest), 'start');
  const request = JSON.parse(first.canonical_request);
  assert.equal(first.original_command_id, f.startRequest.command_id); assert.equal(first.command_kind, 'START_USE');
  assert.equal(request.operation.request_digest, 'sha256:' + f.preview.preview_digest);
  assert.equal(first.command_digest, 'sha256:' + createHash('sha256').update(first.canonical_request).digest('hex'));
  assert.equal(first.provider_authenticated, false); assert.equal(first.receipt_signature_verified, false);
  assert.equal(first.execution_authorized, false); assert.equal(first.evidence_status, 'historical_unverified_observation');
  assert.equal(first.observation_origin, 'local_unverified_input'); assert.equal(first.qualification, 'candidate_contract_only');
  const rows = f.claimRows(); assert.equal(rows.length, 1);
  assert.deepEqual(await result(await f.request('start', f.startRequest), 'start'), first);
  assert.deepEqual(await result(await f.request('status', original(f)), 'status'), first);
  const recovery = await result(await f.request('recovery', original(f)), 'recovery');
  assert.deepEqual(recovery.request, { profile: 'urn:marty:delegation-command:v1', command: 'RECOVER_RESULT',
    original_command_id: f.startRequest.command_id, expected_command_digest: first.command_digest });
  assert.equal(recovery.execution_authorized, false); assert.equal(recovery.provider_authenticated, false);
  assert.deepEqual(f.claimRows(), rows); assert.deepEqual(f.effects(), before);
}));

test('RCG4BC4-HTTP-CANCEL revision-bound cancellation keeps masked immutable original history', () => usingCommandHttp(async f => {
  const first = await result(await f.request('start', f.startRequest), 'start');
  const cancelled = await result(await f.request('cancel', { ...original(f), expected_revision: 1 }), 'cancel');
  assert.equal(cancelled.state, 'cancelled'); assert.equal(cancelled.retired, true); assert.equal(cancelled.minimized, true);
  assert.equal(cancelled.canonical_request, null); assert.equal(cancelled.response, null);
  assert.equal(cancelled.command_digest, first.command_digest); const rows = f.claimRows();
  assert.deepEqual(await result(await f.request('start', f.startRequest), 'start'), cancelled);
  assert.deepEqual(await result(await f.request('status', original(f)), 'status'), cancelled);
  assert.deepEqual(await result(await f.request('cancel', { ...original(f), expected_revision: 2 }), 'cancel'), cancelled);
  await refusal(await f.request('cancel', { ...original(f), expected_revision: 1 }), 409);
  await refusal(await f.request('recovery', original(f)), 409);
  assert.deepEqual(f.claimRows(), rows);
}));

test('RCG4BC4-HTTP-CONFIG fixed correlation alone retains history while absent configuration cannot choose a namespace', () => usingCommandHttp(async f => {
  const first = f.claimNative(); await f.restartServer('history');
  assert.deepEqual(await result(await f.request('status', original(f)), 'status'), first);
  await result(await f.request('recovery', original(f)), 'recovery');
  await refusal(await f.request('start', f.startRequest), 503);
  await result(await f.request('cancel', { ...original(f), expected_revision: 1 }), 'cancel');
  const rows = f.claimRows(); await f.restartServer('absent');
  await result(await f.request('contract'), 'contract');
  for (const [operation, input] of [['start',f.startRequest],['status',original(f)],['recovery',original(f)],
    ['cancel',{ ...original(f), expected_revision: 2 }]] as const) await refusal(await f.request(operation,input), 503);
  assert.deepEqual(f.claimRows(), rows);
}));

test('RCG4BC4-HTTP-SCOPE staff workers and foreign native customers cannot disclose an original command', () => usingCommandHttp(async f => {
  f.claimNative(); const rows = f.claimRows();
  for (const bearer of [f.owner.bearer, f.a.bearer, f.agent.bearer, f.a.workerBearer,
    verifiedCustomer(f, f.a, 'ORD-1002').bearer, verifiedCustomer(f, f.b).bearer, verifiedCustomer(f, f.c).bearer]) {
    await refusal(await f.request('status', original(f), bearer), 404, 'NOT_FOUND');
  }
  await refusal(await f.request('start', f.startRequest, f.owner.bearer), 404, 'NOT_FOUND');
  assert.deepEqual(f.claimRows(), rows);
}));

test('RCG4BC4-HTTP-PREBODY-CONCRETE-AUTH shadowed authorization cannot let an unauthorized oversized body reach parsing', () => usingCommandHttp(async f => {
  assert(Object.hasOwn(f.api, 'authorize'));
  // The targeted mutant captures this own no-op instead of the concrete method.
  // Its observable result is 413; correct native role refusal is 404 before input.
  const response = await raw(f, base + '/start', 'x'.repeat(4097), {
    unfinished: true, headers: { authorization: 'Bearer ' + f.owner.bearer },
  });
  assert.equal(response.status, 404); assert.deepEqual(response.body, { error: 'NOT_FOUND' });
  assert.equal(f.claimRows().length, 0);
}, { shadowAuthorize: true }));

test('RCG4BC4-HTTP-PROOF-FIRST missing bearer and changed original contact deny before oversized body collection', () => usingCommandHttp(async f => {
  const missing = await raw(f, base + '/start', 'x'.repeat(4097), { unfinished: true, headers: { authorization: '' } });
  assert.equal(missing.status, 403); assert.deepEqual(missing.body, { error: 'ACCESS_DENIED' });
  changedProof(f, true);
  const changed = await raw(f, base + '/start', 'x'.repeat(4097), { unfinished: true });
  assert.equal(changed.status, 403); assert.deepEqual(changed.body, { error: 'CUSTOMER_VERIFICATION_REQUIRED' });
  assert.equal(f.claimRows().length, 0);
}));

test('RCG4BC4-HTTP-BODY-REVOCATION native authorization is repeated after the request body arrives', async () => {
  for (const change of [(f: Fixture) => f.kernel.revoke(f.customer), (f: Fixture) => changedProof(f)])
    await usingCommandHttp(async f => {
      const response = await duringBody(f, () => change(f));
      assert.equal(response.status, 403); assert.equal(f.claimRows().length, 0);
    });
});

test('RCG4BC4-HTTP-INPUT exact reference inputs cannot provision grants operations proof or recovery digests', () => usingCommandHttp(async f => {
  for (const extra of [{ grant: f.grant }, { operation: {} }, { correlation: f.correlation },
    { context_id: 'context' }, { proof_submission_id: otherId }, { execution_authorized: true }])
    await refusal(await f.request('start', { ...f.startRequest, ...extra }), 400, 'INVALID_INPUT');
  for (const input of [{ ...f.startRequest, command_id: otherId.toUpperCase() },
    { ...f.startRequest, command_id: '00000000-0000-0000-0000-000000000000' }, { ...f.startRequest, preview_id: {} }])
    await refusal(await f.request('start', input), 400);
  await refusal(await f.request('recovery', { ...original(f), expected_command_digest: 'sha256:' + 'a'.repeat(64) }), 400);
  for (const expected_revision of [0, '1', 1.5, Number.MAX_SAFE_INTEGER + 1])
    await refusal(await f.request('cancel', { ...original(f), expected_revision }), 400);
  assert.equal(f.claimRows().length, 0);
}));

test('RCG4BC4-HTTP-STRICT-JSON duplicate members malformed Unicode and invalid UTF8 fail before command construction', () => usingCommandHttp(async f => {
  const command = JSON.stringify(f.startRequest.command_id), preview = JSON.stringify(f.startRequest.preview_id);
  const duplicate = `{"command_id":${command},"command_id":${command},"preview_id":${preview}}`;
  const escaped = `{"command_id":${command},"command_\\u0069d":${command},"preview_id":${preview}}`;
  for (const bytes of [duplicate, escaped, '{"command_id":"\\ud800","preview_id":"x"}',
    Buffer.from([0x7b,0x22,0x78,0x22,0x3a,0x22,0xc0,0xaf,0x22,0x7d]), '{', 'null', '[]']) {
    const response = await raw(f, base + '/start', bytes); assert.equal(response.status, 400);
  }
  assert.equal(f.claimRows().length, 0);
}));

test('RCG4BC4-HTTP-BODY-LIMIT announced and chunked bodies retain the strict four KiB reference bound', () => usingCommandHttp(async f => {
  for (const chunked of [false,true]) {
    const response = await raw(f, base + '/start', 'x'.repeat(4097), { chunked });
    assert.equal(response.status, 413); assert.deepEqual(response.body, { error: 'BODY_TOO_LARGE' });
  }
  assert.equal(f.claimRows().length, 0);
  const valid = JSON.stringify(f.startRequest).padEnd(4096, ' '), response = await raw(f, base + '/start', valid);
  assert.equal(response.status, 200); assert.equal(response.body.operation, 'command-start'); assert.equal(f.claimRows().length, 1);
  const media = await raw(f, base + '/status', '{}', { headers: { 'content-type': 'text/plain' } });
  assert.equal(media.status, 415);
}));

test('RCG4BC4-HTTP-ROUTING raw finalization observation queries and route aliases remain unavailable', () => usingCommandHttp(async f => {
  for (const path of ['', '/start/', '/START', '/start%2f', '/claim', '/observe', '/finalize', '/receipt'])
    await refusal(await f.request(base + path, f.startRequest), 404, 'NOT_FOUND');
  await refusal(await f.request(base + '/status?command_id=' + f.startRequest.command_id, original(f)), 400, 'INVALID_INPUT');
  const wrong = await f.request('start'); assert.equal(wrong.status, 405); assert.equal(wrong.headers.get('allow'), 'POST');
  const contract = await f.request('contract', {}); assert.equal(contract.status, 405); assert.equal(contract.headers.get('allow'), 'GET');
  assert.equal(f.claimRows().length, 0);
}));

test('RCG4BC4-HTTP-ORIGIN established loopback host origin and fetch-site guards cover the command family', () => usingCommandHttp(async f => {
  for (const headers of [{ host: 'localhost:' + f.server.port }, { origin: 'https://foreign.invalid' }, { 'sec-fetch-site': 'cross-site' }]) {
    const response = await raw(f, base + '/start', JSON.stringify(f.startRequest), { headers }); assert.equal(response.status, 403);
  }
  assert.equal(f.claimRows().length, 0);
}));

test('RCG4BC4-HTTP-SOURCE current native purchase changes and expiry still deny START at the application boundary', async () => {
  for (const change of [changedPrice, changedTerms, (f: Fixture) => f.advance(60000)]) await usingCommandHttp(async f => {
    change(f); const before = f.effects(); await refusal(await f.request('start', f.startRequest), 409);
    assert.equal(f.claimRows().length, 0); assert.deepEqual(f.effects(), before);
  });
});

test('RCG4BC4-HTTP-HELD-ERASURE the existing original-subject negative marker blocks fresh native use', () => usingCommandHttp(async f => {
  // C3's lifecycle cases exercise the privacy operation itself. This application
  // case seeds its existing authoritative marker and observes the new route.
  const p = f.preview;
  f.db.prepare('INSERT INTO commerce_privacy_events(tenant_id,store_id,subject_hash,event,reason,observed_at) VALUES(?,?,?,?,?,?)')
    .run(p.tenant_id,p.store_id,subjectHash(p.tenant_id,p.store_id,p.customer_id),'erasure_held','configured_hold',f.now());
  const before = f.effects(); await refusal(await f.request('start', f.startRequest), 409);
  assert.equal(f.claimRows().length, 0); assert.deepEqual(f.effects(), before);
}));

test('RCG4BC4-HTTP-RECOVERY-FENCE quarantine blocks active construction and unsent recovery while retaining history and cancellation', () => usingCommandHttp(async f => {
  const first = f.claimNative();
  f.db.prepare('INSERT INTO commerce_recovery_state VALUES(1,?,?,?,?,?)')
    .run('command-http-restore','quarantine','a'.repeat(64),'b'.repeat(64),f.now());
  await refusal(await f.request('start', f.startRequest), 403);
  await refusal(await f.request('recovery', original(f)), 403);
  assert.deepEqual(await result(await f.request('status', original(f)), 'status'), first);
  assert.equal((await result(await f.request('cancel', { ...original(f), expected_revision: 1 }), 'cancel')).state, 'cancelled');
  assert.equal(f.claimRows().length, 1);
}));

test('RCG4BC4-HTTP-CLOSED-SOURCE retained original history does not depend on live preview provenance', () => usingCommandHttp(async f => {
  const first = f.claimNative(); f.starts.close(); f.previews.close();
  await refusal(await f.request('start', f.startRequest), 409);
  assert.deepEqual(await result(await f.request('status', original(f)), 'status'), first);
  await result(await f.request('recovery', original(f)), 'recovery');
  assert.equal(f.claimRows().length, 1);
}));

test('RCG4BC4-HTTP-LOST-RESULT explicit original lookup survives discarded response and history-only server replacement', () => usingCommandHttp(async f => {
  const response = await f.request('start', f.startRequest); assert.equal(response.status, 200);
  await response.body!.cancel(); const rows = f.claimRows(); assert.equal(rows.length, 1);
  f.starts.close(); f.previews.close(); await f.restartServer('history');
  const historical = await result(await f.request('status', original(f)), 'status');
  assert.equal(historical.original_command_id, f.startRequest.command_id);
  const recovery = await result(await f.request('recovery', original(f)), 'recovery');
  assert.equal(recovery.request.original_command_id, historical.original_command_id);
  assert.equal(recovery.request.expected_command_digest, historical.command_digest);
  await refusal(await f.request('status', { command_id: otherId }), 404, 'NOT_FOUND');
  assert.deepEqual(f.claimRows(), rows);
}));

test('RCG4BC4-HTTP-SANITIZE finite errors and code-only logs never echo bodies references or credentials', () => usingCommandHttp(async f => {
  await result(await f.request('start', f.startRequest), 'start');
  const secret = 'private-unexpected-command-detail', clock = f.kernel.clock;
  try {
    (f.kernel as any).clock = () => { throw new Error(secret); };
    await refusal(await f.request('status', original(f)), 500, 'INTERNAL_ERROR');
  } finally { (f.kernel as any).clock = clock; }
  await refusal(await f.request('start', { ...f.startRequest, secret }), 400);
  const logs = JSON.stringify(f.logs);
  for (const value of [secret,f.bearer,f.startRequest.command_id,f.preview.preview_id,f.grant.id]) assert(!logs.includes(value));
  for (const entry of f.logs as any[]) assert.deepEqual(Object.keys(entry).sort(), ['code','event','status']);
}));

test('RCG4BC4-HTTP-CONCURRENT simultaneous original requests converge while stale cancellation revisions conflict', () => usingCommandHttp(async f => {
  const before = f.effects();
  const claims = await Promise.all([f.request('start', f.startRequest), f.request('start', f.startRequest)]);
  const views = await Promise.all(claims.map(response => result(response, 'start'))); assert.deepEqual(views[0], views[1]);
  assert.equal(f.claimRows().length, 1); assert.equal(views[0].revision, 1);
  const cancelled = await Promise.all([f.request('cancel', { ...original(f), expected_revision: 1 }),
    f.request('cancel', { ...original(f), expected_revision: 1 })]);
  assert.deepEqual(cancelled.map(response => response.status).sort(), [200,409]);
  for (const response of cancelled) await response.json();
  assert.equal(f.claimRows().length, 1); assert.deepEqual(f.effects(), before);
}));
