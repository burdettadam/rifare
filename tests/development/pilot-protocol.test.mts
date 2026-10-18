import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerPilot, appendPilotEvents, projectPilot, assessPilotReadiness, runPilotProtocol } from '../../packages/pilot/protocol.mts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FIX = join(ROOT, 'tests/fixtures/release-benchmark');
const hash = (raw: string | Buffer) => createHash('sha256').update(raw).digest('hex');
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const clone = (v: any) => structuredClone(v);
const AT = '2026-10-15T00:00:00Z';
const H = 'a'.repeat(64);
const original = read(join(FIX, 'cohort.results.SYNTHETIC.json')).results;
const expected = read(join(FIX, 'expected-cohort.v1.json'));
const materials = Object.fromEntries(['profile', 'skill', 'policy', 'runtime', 'model', 'adapter'].map(k => [k, H]));
const event = (kind: string, case_id: string, payload: any, suffix = '', happened_at = AT) => ({
  id: `${case_id}-${kind}${suffix}`, kind, case_id, evidence_ref: `synthetic:${case_id}:${kind}${suffix}`, evidence_sha256: H, happened_at, payload,
});
function events(rows = original) {
  return rows.flatMap((r: any) => [
    event('observation', r.case_id, { disposition: r.disposition, actor: r.actor, agent_attempted: r.agent_attempted, completed_at: r.completed_at }),
    event('adjudication', r.case_id, { oracle_verdict: r.oracle_verdict, oracle_ref: r.oracle_ref, autonomous_resolution: r.autonomous_resolution, supersedes: null }),
    event('cost', r.case_id, { minor: r.cost_minor, operator_seconds: r.operator_seconds }),
    ...(r.followup_through ? [event('followup', r.case_id, { through: r.followup_through, repeat_contact: r.repeat_contact, repeat_ref: r.repeat_ref })] : []),
    ...(r.severity !== 'none' ? [event('exception', r.case_id, { code: 'outcome_incorrect', severity: r.severity })] : []),
  ]);
}
function fixture(change?: (manifest: any) => void) {
  const home = mkdtempSync(join(tmpdir(), 'rifare-pilot-'));
  const manifest = read(join(FIX, 'cohort.manifest.SYNTHETIC.json'));
  if (change) change(manifest);
  const manifestPath = join(home, 'manifest.json');
  // Preserve the independent fixture bytes for the known-answer run.
  writeFileSync(manifestPath, change ? JSON.stringify(manifest) : readFileSync(join(FIX, 'cohort.manifest.SYNTHETIC.json')));
  const request: any = { version: 1, directory: join(home, 'cohort'),
    manifest: { path: manifestPath, sha256: hash(readFileSync(manifestPath)) },
    benchmark_sha256: hash(readFileSync(join(ROOT, 'planning/release-benchmark.json'))),
    source: { commit: '1'.repeat(40), tree: '2'.repeat(40), artifact_sha256: H },
    configurations: manifest.strata.map((s: any) => ({ stratum_id: s.id, materials: clone(materials) })),
    authority_refs: { owner_ref: 'synthetic:owner', consent_ref: 'synthetic:consent', privacy_review_ref: 'synthetic:privacy', retention_ref: 'synthetic:retention' } };
  let ref: any;
  function register() { const r = registerPilot(request); ref = { version: 1, directory: request.directory, registration_sha256: r.registration_sha256, head: r.head }; return r; }
  function append(rows: any[]) { const r = appendPilotEvents({ ...ref, events: rows }); ref = { ...ref, head: r.head }; return r; }
  function pin(name: string, value: any) { const path = join(home, name); writeFileSync(path, JSON.stringify(value)); return { path, sha256: hash(readFileSync(path)) }; }
  function readiness(registerValue?: any, protocols = ref ? [ref] : []) {
    const v = registerValue ?? read(join(ROOT, 'work/qualification/M07-real-observations.json'));
    return assessPilotReadiness({ version: 1, register: pin('real-register.json', v), protocols, assessed_at: AT });
  }
  return { home, manifest, request, register, append, pin, readiness, ref: () => clone(ref), project: () => projectPilot(ref), close: () => rmSync(home, { recursive: true, force: true }) };
}
const using = (fn: (f: ReturnType<typeof fixture>) => void, change?: (m: any) => void) => { const f = fixture(change); try { fn(f); } finally { f.close(); } };
const aggregate = (p: any) => p.score.by_source[0].aggregate;

test('CASE-M07-G17-01 stored synthetic events reproduce the retained hand-calculated twelve-case oracle', () => using(f => {
  f.register(); f.append(events()); const p = f.project();
  assert.deepEqual(aggregate(p), expected.aggregate);
  for (const s of p.score.by_source[0].strata) for (const [group, values] of Object.entries(expected.strata[s.stratum_id]))
    for (const [key, value] of Object.entries(values as any)) assert.deepEqual(s[group][key], value);
  assert.equal(p.score.manifest_sha256, f.request.manifest.sha256);
  assert.equal(p.verified_live_observations, 0); assert.equal(p.pilot_authorized, false);
}));

test('CASE-M07-G17-02 pending censored and synthetic members retain denominators without live completion', () => using(f => {
  f.register(); f.append(events()); f.append([event('exception', 'CASE-005', { code: 'censored', severity: 'none' })]);
  const p = f.project(); assert.equal(aggregate(p).counts.enrolled, 12); assert.equal(aggregate(p).counts.in_scope, 10);
  assert.equal(aggregate(p).counts.dispositions.pending, 1); assert.equal(p.case_status.find((c: any) => c.case_id === 'CASE-005').censored, true);
  assert.equal(p.verified_live_observations, 0); assert.equal(f.readiness().qualified, false);
}));

test('CASE-M07-G17-03 seven-day reopen and late provider adjustment change metrics without dropping hard cases', () => using(f => {
  f.register(); f.append(events()); const before = f.ref();
  f.append([event('reopen', 'CASE-001', { related: true, occurred_at: '2026-10-08T12:00:00Z' }),
    event('cost_adjustment', 'CASE-004', { category: 'model', delta_minor: 40, incurred_at: '2026-10-03T00:00:00Z', base_cost_event_id: 'CASE-004-cost' }, '', '2026-10-16T00:00:00Z')]);
  const p = f.project(); assert.deepEqual(aggregate(p).metrics.repeat_contact_7d, { numerator: 2, denominator: 4, ratio: '0.500000' });
  assert.deepEqual(aggregate(p).metrics.cost_minor_per_correct_resolution, { numerator: 1040, denominator: 4, ratio: '260.000000' });
  assert.equal(aggregate(p).counts.in_scope, 10); assert.equal(p.late_adjustments, 1); assert.equal(p.head.sequence, before.head.sequence + 1);
  assert.deepEqual(f.project(), p);
}));

test('M07-G17-ENROLLMENT-AND-CONFIGURATION-PINS explicit source benchmark and every configuration pin are required', () => using(f => {
  f.request.configurations[0].materials.model = 'unknown'; assert.throws(() => f.register(), /PILOT_PIN_INVALID/);
  f.request.configurations[0].materials.model = H; f.request.benchmark_sha256 = '0'.repeat(64); assert.throws(() => f.register(), /PILOT_BENCHMARK_PIN/);
  f.request.benchmark_sha256 = hash(readFileSync(join(ROOT, 'planning/release-benchmark.json')));
  f.request.manifest.sha256 = '0'.repeat(64); assert.throws(() => f.register(), /PILOT_FILE_PIN/);
}));

test('M07-G17-FROZEN-DENOMINATOR no events still yields all pending cases and extra identities cannot enter', () => using(f => {
  f.register(); const p = f.project(); assert.equal(aggregate(p).counts.enrolled, 12); assert.equal(aggregate(p).counts.dispositions.pending, 10);
  assert.deepEqual(aggregate(p).metrics.correct_handling, { numerator: 0, denominator: 10, ratio: '0.000000' });
  assert.throws(() => f.append([event('observation', 'NEW-CASE', { disposition: 'pending', actor: 'none', agent_attempted: false, completed_at: null })]), /PILOT_UNKNOWN_CASE/);
  const mutant = f.manifest; mutant.cases = mutant.cases.filter((x: any) => x.id !== 'CASE-004');
  writeFileSync(join(f.request.directory, 'manifest.json'), JSON.stringify(mutant)); assert.throws(() => f.project(), /PILOT_FILE_PIN/);
}));

test('M07-G17-APPEND-INTEGRITY altered or truncated event history cannot satisfy a retained head pin', () => using(f => {
  f.register(); f.append(events()); const path = join(f.request.directory, 'events', '00000001.json'); const raw = readFileSync(path);
  const altered = JSON.parse(raw.toString()); altered.events.pop(); writeFileSync(path, JSON.stringify(altered));
  assert.throws(() => f.project(), /PILOT_HEAD_PIN/); writeFileSync(path, raw); rmSync(path);
  assert.throws(() => f.project(), /PILOT_HEAD_PIN/);
}));

test('M07-G17-CONCURRENT-APPEND stale heads and duplicate events fail without replacing history', () => using(f => {
  f.register(); const stale = f.ref(); f.append(events()); const before = readFileSync(join(f.request.directory, 'events', '00000001.json'));
  assert.throws(() => appendPilotEvents({ ...stale, events: [event('exception', 'CASE-001', { code: 'appeal', severity: 'none' })] }), /PILOT_HEAD_PIN/);
  assert.throws(() => f.append([events()[0]]), /PILOT_EVENT_DUPLICATE/);
  assert.deepEqual(readFileSync(join(f.request.directory, 'events', '00000001.json')), before);
  writeFileSync(join(f.request.directory, '.writer.lock'), 'interrupted writer', { mode: 0o600 });
  assert.throws(() => f.project(), /PILOT_STORE_BUSY/);
}));

test('M07-G17-ADJUDICATION-LINEAGE corrected verdicts retain their predecessor and cannot rewrite completion', () => using(f => {
  f.register(); f.append(events());
  assert.throws(() => f.append([event('adjudication', 'CASE-001', { oracle_verdict: 'incorrect', oracle_ref: 'synthetic:review2', autonomous_resolution: false, supersedes: null }, '-2')]), /PILOT_ADJUDICATION_LINEAGE/);
  f.append([event('adjudication', 'CASE-001', { oracle_verdict: 'incorrect', oracle_ref: 'synthetic:review2', autonomous_resolution: false, supersedes: 'CASE-001-adjudication' }, '-2')]);
  assert.equal(aggregate(f.project()).counts.correct_handled, 5); assert.equal(aggregate(f.project()).counts.mature_resolutions, 4);
  assert.throws(() => f.append([event('observation', 'CASE-001', { disposition: 'pending', actor: 'none', agent_attempted: false, completed_at: null }, '-2')]), /PILOT_TERMINAL_IMMUTABLE/);
}));

test('M07-G17-FOLLOWUP-WINDOW missing mature follow-up remains unavailable and late unrelated reopen cannot improve it', () => using(f => {
  f.register(); f.append(events().filter((e: any) => e.id !== 'CASE-002-followup'));
  const p = f.project(); assert.deepEqual(aggregate(p).metrics.repeat_contact_7d, { numerator: null, denominator: 4, ratio: null });
  assert.equal(aggregate(p).counts.immature_resolutions, 1);
  f.append([event('reopen', 'CASE-001', { related: true, occurred_at: '2026-10-09T12:00:00Z' })]);
  assert.equal(aggregate(f.project()).counts.observed_mature_repeat_contacts, 0);
  assert.throws(() => f.append([event('followup', 'CASE-001', { through: '2026-10-02T00:00:00Z', repeat_contact: false, repeat_ref: 'synthetic:retreat' }, '-2')]), /PILOT_FOLLOWUP_RETREAT/);
}));

test('M07-G17-MISSING-COST costs are never zero-filled and adjustment requires a known original charge', () => using(f => {
  f.register(); f.append(events().filter((e: any) => e.id !== 'CASE-004-cost'));
  assert.deepEqual(aggregate(f.project()).metrics.cost_minor_per_correct_resolution, { numerator: null, denominator: 4, ratio: null });
  assert.throws(() => f.append([event('cost_adjustment', 'CASE-004', { category: 'model', delta_minor: 2, incurred_at: '2026-10-03T00:00:00Z', base_cost_event_id: 'CASE-004-cost' })]), /PILOT_COST_BASE/);
  f.append([event('cost', 'CASE-004', { minor: { model: 10, messaging: 5, shipping: 0, hosting: 5, operator: 80 }, operator_seconds: 60 })]);
  assert.equal(aggregate(f.project()).metrics.cost_minor_per_correct_resolution.numerator, 1000);
  assert.throws(() => f.append([event('cost_adjustment', 'CASE-004', { category: 'model', delta_minor: -11, incurred_at: '2026-10-03T00:00:00Z', base_cost_event_id: 'CASE-004-cost' })]), /PILOT_COST_RANGE/);
}));

test('M07-G17-EXCEPTIONS excluded safety findings and withdrawal remain visible without reducing enrollment', () => using(f => {
  f.register(); f.append(events()); f.append([event('exception', 'CASE-011', { code: 'appeal', severity: 'none' }, '-appeal'), event('exception', 'CASE-001', { code: 'withdrawn', severity: 'none' })]);
  const p = f.project(); assert.equal(aggregate(p).counts.severity_all_enrolled.SEV0, 1);
  assert.equal(aggregate(p).counts.enrolled, 12); assert.equal(p.case_status.find((c: any) => c.case_id === 'CASE-001').withdrawn, true);
  assert.equal(p.events_count, events().length + 2); assert.equal(p.authorization_refs_authenticated, false);
  assert.throws(() => f.append([event('exception', 'CASE-011', { code: 'unauthorized_action', severity: 'none' }, '-unsafe')]), /PILOT_EXCEPTION_INVALID/);
}));

test('M07-G17-SOURCE-AND-MODE-SEPARATION connected declarations remain separate and approval mode cannot claim autonomy', () => {
  using(f => { f.register(); const p = f.project(); assert.deepEqual(p.score.by_source.map((s: any) => s.source_kind).sort(), ['connected_test', 'synthetic']); assert.equal(p.verified_live_observations, 0); }, m => {
    m.purpose = 'declared_observations'; m.sources.push({ id: 'CONNECTED', kind: 'connected_test', provenance_ref: 'synthetic:connected-declaration' });
    for (const c of m.cases) if (c.stratum_id === 'STRATUM-B') c.source_id = 'CONNECTED';
  });
  using(f => { f.register(); assert.throws(() => f.append(events()), /PILOT_SCORER_REJECTED/); }, m => { m.strata[0].mode = 'approval_gated'; });
});

test('M07-G17-INPUT-BOUNDS duplicate JSON keys nonfinite values unknown fields and oversized inputs fail closed', () => using(f => {
  assert.throws(() => runPilotProtocol('register', '{"version":1,"version":1}'), /PILOT_JSON_INVALID/);
  assert.throws(() => runPilotProtocol('register', '{"version":NaN}'), /PILOT_JSON_INVALID/);
  assert.throws(() => runPilotProtocol('register', ' '.repeat(1048577)), /PILOT_INPUT_LIMIT/);
  f.request.customer_email = 'not-allowed'; assert.throws(() => f.register(), /PILOT_SHAPE/); delete f.request.customer_email;
  f.register(); const e: any = events()[0]; e.source_kind = 'live'; assert.throws(() => f.append([e]), /PILOT_SHAPE/);
}));

test('M07-G17-ARTIFACT-PATHS private directories no overwrite links and unexpected files are enforced', () => using(f => {
  f.register(); assert.equal(statSync(f.request.directory).mode & 0o777, 0o700);
  assert.equal(statSync(join(f.request.directory, 'registration.json')).mode & 0o777, 0o600);
  assert.throws(() => f.register(), /PILOT_NO_OVERWRITE/);
  const link = join(f.home, 'linked'); symlinkSync(f.request.directory, link); assert.throws(() => projectPilot({ ...f.ref(), directory: link }), /PILOT_PATH_UNSAFE/);
  linkSync(join(f.request.directory, 'manifest.json'), join(f.home, 'hard')); assert.throws(() => f.project(), /PILOT_PATH_UNSAFE/); rmSync(join(f.home, 'hard'));
  writeFileSync(join(f.request.directory, 'unexpected.json'), '{}'); assert.throws(() => f.project(), /PILOT_STORE_MEMBERSHIP/);
}));

test('M07-G17-CLI ordinary offline commands emit bounded JSON with no provider or release authorization', () => using(f => {
  const input = f.pin('request.json', f.request);
  const child = spawnSync(process.execPath, ['--experimental-strip-types', join(ROOT, 'tools/pilot-protocol.mts'), 'register', input.path], { encoding: 'utf8', timeout: 10000 });
  assert.equal(child.status, 0, child.stderr); const out = JSON.parse(child.stdout);
  assert.equal(out.ok, true); assert.equal(out.pilot_authorized, false); assert.equal(out.verified_live_observations, 0);
  const describe = spawnSync(process.execPath, ['--experimental-strip-types', join(ROOT, 'tools/pilot-protocol.mts'), '--describe'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(describe.status, 0); assert.equal(JSON.parse(describe.stdout).live_pilot_started, false);
}));

test('M07-G18-PREP-EMPTY-REGISTER the actual empty register blocks qualification and preserves missing observations', () => using(f => {
  const r = f.readiness(); assert.equal(r.qualified, false); assert.equal(r.status, 'blocked');
  assert.equal(r.declared_live_observations, 0); assert.equal(r.verified_live_observations, 0);
  for (const code of ['LIVE_OBSERVATIONS_MISSING', 'MERCHANT_APPROVALS_MISSING', 'ELAPSED_EXPOSURE_MISSING', 'INDEPENDENT_REVIEW_REQUIRED']) assert.ok(r.blockers.includes(code), code);
}));

test('M07-G18-PREP-SIMULATED-SUBSTITUTION synthetic register entries and relabeled cohort sources cannot qualify', () => using(f => {
  f.register(); f.append(events()); const r = read(join(ROOT, 'work/qualification/M07-real-observations.json'));
  r.observations.push({ id: 'OBS-1', merchant_id: 'MERCHANT-A', cohort_id: f.manifest.cohort_id, case_id: 'CASE-001', source_kind: 'synthetic', source_ref: 'synthetic:CASE-001:observation', source_sha256: H, adjudication_ref: 'HAND-CALCULATION.md#case-001', adjudication_sha256: H, completed_at: '2026-10-01T12:00:00Z', followup_through: AT });
  const p = f.readiness(r); assert.ok(p.blockers.includes('SIMULATED_OBSERVATION_SUBSTITUTION')); assert.equal(p.verified_live_observations, 0);
  r.observations[0].source_kind = 'live'; assert.ok(f.readiness(r).blockers.includes('OBSERVATION_SOURCE_MISMATCH'));
}));

test('M07-G18-PREP-MISSING-EVIDENCE live labels alone cannot supply source approval or thirty elapsed days', () => using(f => {
  f.register(); f.append(events()); const r = read(join(ROOT, 'work/qualification/M07-real-observations.json'));
  r.merchant_profiles.push({ id: 'MERCHANT-A', independence_ref: 'declared:independent', consent_ref: 'declared:consent' });
  r.observations.push({ id: 'OBS-1', merchant_id: 'MERCHANT-A', cohort_id: f.manifest.cohort_id, case_id: 'CASE-001', source_kind: 'live', source_ref: null, source_sha256: null, adjudication_ref: null, adjudication_sha256: null, completed_at: '2026-10-01T12:00:00Z', followup_through: null });
  const p = f.readiness(r); for (const code of ['SOURCE_EVIDENCE_MISSING', 'MERCHANT_APPROVALS_MISSING', 'ELAPSED_EXPOSURE_MISSING', 'FOLLOWUP_INCOMPLETE']) assert.ok(p.blockers.includes(code), code);
  assert.equal(p.status, 'blocked');
}, m => { m.purpose = 'declared_observations'; m.sources[0].kind = 'live'; m.sources[0].provenance_ref = 'declared:unverified-source'; }));

test('M07-G18-PREP-REPRODUCIBILITY pinned minimized inputs reproduce and changed registration or future exposure is rejected', () => using(f => {
  f.register(); f.append(events()); const first = f.readiness(); assert.deepEqual(f.readiness(), first);
  assert.throws(() => projectPilot({ ...f.ref(), registration_sha256: '0'.repeat(64) }), /PILOT_REGISTRATION_PIN/);
  const r = read(join(ROOT, 'work/qualification/M07-real-observations.json'));
  r.exposure_days.push({ merchant_id: 'MERCHANT-A', date: '2099-01-01', source_ref: 'claimed:future', sha256: H });
  assert.ok(f.readiness(r).blockers.includes('EXPOSURE_NOT_ELAPSED'));
}));

test('M07-G17-RETAINED-CONTROLS benchmark and scorer pins bind unchanged governance rather than author-selected gates', () => using(f => {
  const contract = read(join(ROOT, 'packages/pilot/contracts/protocol.v1.json'));
  for (const pin of contract.controls) assert.equal(hash(readFileSync(join(ROOT, pin.path))), pin.sha256);
  assert.equal(contract.benchmark_sha256, '4b53de08f4af8b915eead29394fa0467d257beb30047347f8fd793648fd9d5ed');
  f.register(); const p = f.project(); assert.deepEqual(p.controls, contract.controls);
  assert.equal(p.score.release_qualified, false); assert.equal(p.source_pins_authenticated, false);
  assert.equal(read(join(ROOT, 'work/qualification/M07-real-observations.json')).qualification, 'unperformed');
}));
