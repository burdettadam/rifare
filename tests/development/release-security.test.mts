import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditRelease } from '../../packages/security/release-audit.mts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const canonical = (value: any): string => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : value !== null && typeof value === 'object' ? '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}' : JSON.stringify(value);
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
function put(root: string, path: string, value: string | object) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
}
function git(root: string, ...args: string[]) {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-C', root, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
}
// Independent fixture digest: regular file bytes and exact relative membership.
function files(root: string, prefix = ''): any[] {
  return readdirSync(join(root, prefix)).sort().flatMap(name => {
    const path = prefix ? prefix + '/' + name : name;
    return statSync(join(root, path)).isDirectory() ? files(root, path)
      : [{ path, size: statSync(join(root, path)).size, sha256: hash(readFileSync(join(root, path))),
           mode: statSync(join(root, path)).mode & 0o111 ? '100755' : '100644' }];
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'rifare-release-audit-')), source = join(home, 'source'), artifact = join(home, 'stage');
  mkdirSync(source);
  const inventory = read(join(ROOT, 'planning/component-inventory.json'));
  const obligations = read(join(ROOT, 'tests/fixtures/licensing/retained-obligations.v1.json'));
  const policy = read(join(ROOT, 'planning/licensing-policy.json'));
  const wanted = new Set<string>([
    'README.md', 'planning/component-inventory.json', 'planning/licensing-policy.json',
    'tests/fixtures/licensing/expected-policy.v1.json', 'tests/fixtures/licensing/retained-obligations.v1.json',
    'tests/fixtures/development/command-manifests.v1.json', 'package.json', 'package-lock.json', '.npmrc', '.node-version',
    ...inventory.components.map((c: any) => c.files[0]), ...Object.keys(obligations.required_notice_sha256),
    ...obligations.upstream_files, ...obligations.workflow_references.map((x: any) => x.path),
    ...policy.public_examples.map((x: any) => x.path),
  ]);
  for (const name of wanted) { mkdirSync(dirname(join(source, name)), { recursive: true }); cpSync(join(ROOT, name), join(source, name)); }
  inventory.components = inventory.components.map((c: any) => ({ ...c, files: c.files.filter((p: string) => wanted.has(p)) }));
  put(source, 'planning/component-inventory.json', inventory);
  git(source, 'init', '-q', '--template=', '-b', 'main');
  function commit() { git(source, 'add', '--all'); git(source, '-c', 'user.name=Rifare synthetic fixture', '-c', 'user.email=fixture@invalid', 'commit', '--allow-empty', '-qm', 'Rifare synthetic security fixture'); }
  function stage() { rmSync(artifact, { recursive: true, force: true }); cpSync(source, artifact, { recursive: true, filter: p => p !== join(source, '.git') }); }
  function request(extra: any = {}) {
    return { version: 1 as const, source_root: source, artifact_root: artifact,
      expected_source: { commit: git(source, 'rev-parse', 'HEAD'), tree: git(source, 'rev-parse', 'HEAD^{tree}') },
      expected_artifact_sha256: hash(canonical(files(artifact))), ...extra };
  }
  function pin(name: string, value: any) { put(home, name, value); return { path: join(home, name), sha256: hash(readFileSync(join(home, name))) }; }
  function changeInventory(fn: (value: any) => void) { const value = read(join(source, 'planning/component-inventory.json')); fn(value); put(source, 'planning/component-inventory.json', value); }
  commit(); stage();
  return { home, source, artifact, commit, stage, request, pin, changeInventory, close: () => rmSync(home, { recursive: true, force: true }) };
}
function scan(report: any, kind = 'dependency_vulnerabilities', changes: any = {}) {
  const now = Date.now();
  return { version: 1, kind, scanner: { name: 'Rifare synthetic scanner', version: '1.0.0', rules_sha256: '1'.repeat(64) },
    scanned_at: now, source_commit: report.provenance.source_commit, source_tree: report.provenance.source_tree,
    artifact_sha256: report.artifact.sha256, sbom_sha256: report.sbom_sha256,
    artifact_paths: report.sbom.files.map((x: any) => x.path), package_ids: report.sbom.packages.map((x: any) => x.id).sort(),
    advisory_database: kind === 'dependency_vulnerabilities' ? { sha256: '2'.repeat(64), updated_at: now } : null,
    findings: [], ...changes };
}
function codes(report: any) { return new Set(report.findings.map((x: any) => x.code)); }

test('CASE-M07-G13-01 exact source bytes, dependency inputs, components and artifact assets form the SBOM', () => {
  const f = fixture(); try {
    const report = auditRelease(f.request());
    assert.equal(report.local_checks, 'pass');
    assert.equal(report.artifact.sha256, hash(canonical(files(f.artifact))));
    assert.deepEqual(report.sbom.files.map((x: any) => ({ path: x.path, size: x.size, sha256: x.sha256, mode: x.mode })), files(f.artifact));
    assert.deepEqual(report.sbom.packages.map((x: any) => [x.name, x.version, x.direct]), [['rifare', '0.0.0', false]]);
    assert.deepEqual(report.sbom.dependency_inputs.map((x: any) => x.path), ['package-lock.json', 'package.json']);
    assert.equal(report.sbom.components.find((x: any) => x.id === 'git-agent-adaptations').license_declared, 'MIT');
    assert.equal(report.provenance.materials.find((x: any) => x.path === 'package-lock.json').sha256, hash(readFileSync(join(f.artifact, 'package-lock.json'))));
    assert.equal(report.result, 'blocked'); assert.equal(report.release_authorized, false); assert.equal(report.vulnerability_clearance, false);
    assert.ok(codes(report).has('REQUIRED_SCAN_MISSING')); assert.ok(codes(report).has('OWNER_RELEASE_DECISION_REQUIRED'));
  } finally { f.close(); }
});

test('M07-G13-CLI actual offline command emits reviewable JSON and exits blocked without granting release', () => {
  const f = fixture(); try {
    const input = f.pin('request.json', f.request());
    const child = spawnSync(process.execPath, ['--experimental-strip-types', join(ROOT, 'tools/audit-release.mts'), 'audit', input.path], { encoding: 'utf8', timeout: 10000 });
    assert.equal(child.status, 1); const report = JSON.parse(child.stdout);
    assert.equal(report.local_checks, 'pass'); assert.equal(report.release_authorized, false);
    assert.equal(report.provenance.source_commit, git(f.source, 'rev-parse', 'HEAD'));
  } finally { f.close(); }
});

test('CASE-M07-G13-02 private profiles and a secret in ordinary source are detected without disclosing secret text', () => {
  const f = fixture(); try {
    const secret = ['-----BEGIN ', 'PRIVATE KEY-----'].join('') + '\nsynthetic-sensitive-material';
    put(f.artifact, 'merchant-profiles/shop.local.json', { customer: 'synthetic private profile' });
    put(f.artifact, 'README.md', secret);
    const report = auditRelease(f.request());
    assert.equal(report.local_checks, 'fail'); assert.ok(codes(report).has('PRIVATE_ARTIFACT_PATH'));
    assert.ok(codes(report).has('LOCAL_SECRET_PATTERN')); assert.equal(JSON.stringify(report).includes(secret), false);
    assert.ok(report.sbom.files.some((x: any) => x.path === 'merchant-profiles/shop.local.json'));
  } finally { f.close(); }
});

test('CASE-M07-G13-03 a vulnerable direct dependency hidden from reviewed SBOM remains in actual artifact inventory', () => {
  const f = fixture(); try {
    const packageJson = read(join(f.source, 'package.json')); packageJson.dependencies = { 'rifare-vulnerable-fixture': '1.0.0' };
    const lock = read(join(f.source, 'package-lock.json')); lock.packages[''].dependencies = packageJson.dependencies;
    lock.packages['node_modules/rifare-vulnerable-fixture'] = { version: '1.0.0', license: 'MIT', integrity: 'sha512-c3ludGhldGlj' };
    put(f.source, 'package.json', packageJson); put(f.source, 'package-lock.json', lock); f.commit(); f.stage();
    put(f.artifact, 'node_modules/rifare-vulnerable-fixture/package.json', { name: 'rifare-vulnerable-fixture', version: '1.0.0', license: 'MIT' });
    const first = auditRelease(f.request()), dependency = first.sbom.packages.find((x: any) => x.name === 'rifare-vulnerable-fixture');
    assert.ok(dependency); assert.equal(dependency.direct, true); assert.ok(dependency.observations.some((x: any) => x.kind === 'artifact_manifest'));
    const brokenSbom = structuredClone(first.sbom); brokenSbom.packages = brokenSbom.packages.filter((x: any) => x.id !== dependency.id);
    const evidence = scan(first, 'dependency_vulnerabilities', { findings: [{ id: 'RIFARE-SYNTHETIC-HIGH-001', severity: 'high', package_id: dependency.id, path: null, state: 'open', closure_ref: null }] });
    const report = auditRelease(f.request({ reviewed_sbom: f.pin('broken-sbom.json', brokenSbom), scan_evidence: [f.pin('vulnerabilities.json', evidence)] }));
    assert.ok(codes(report).has('REVIEWED_SBOM_MISMATCH')); assert.ok(codes(report).has('HIGH_SECURITY_FINDING'));
    assert.ok(codes(report).has('DEPENDENCY_INTAKE_REQUIRED')); assert.equal(report.release_authorized, false);
    assert.ok(report.sbom.packages.some((x: any) => x.id === dependency.id));
  } finally { f.close(); }
});

test('M07-G13-ARTIFACT-PIN post-review artifact modification invalidates both retained digest and source membership', () => {
  const f = fixture(); try {
    const request = f.request(); put(f.artifact, 'README.md', 'A changed staged artifact.\n');
    const report = auditRelease(request);
    assert.equal(report.local_checks, 'fail'); assert.ok(codes(report).has('ARTIFACT_PIN_MISMATCH')); assert.ok(codes(report).has('ARTIFACT_SOURCE_MISMATCH'));
  } finally { f.close(); }
});

test('M07-G13-DEPENDENCY-MISMATCH direct and undeclared installed dependencies cannot disappear behind an empty lock', () => {
  const f = fixture(); try {
    const p = read(join(f.source, 'package.json')); p.optionalDependencies = { 'rifare-unlocked-fixture': '^2.0.0' };
    put(f.source, 'package.json', p); f.commit(); f.stage();
    put(f.artifact, 'node_modules/rifare-hidden-fixture/package.json', { name: 'rifare-hidden-fixture', version: '3.1.0', license: 'LicenseRef-Unknown' });
    const report = auditRelease(f.request());
    assert.ok(codes(report).has('DECLARED_DEPENDENCY_NOT_LOCKED')); assert.ok(codes(report).has('ARTIFACT_PACKAGE_NOT_LOCKED'));
    assert.ok(codes(report).has('DEPENDENCY_LICENSE_UNREVIEWED'));
    assert.ok(report.sbom.packages.some((x: any) => x.name === 'rifare-unlocked-fixture' && x.version === 'NOASSERTION'));
    assert.ok(report.sbom.packages.some((x: any) => x.name === 'rifare-hidden-fixture'));
  } finally { f.close(); }
});

test('M07-G13-LICENSE unknown source license and removed notice remain mandatory distribution blockers', () => {
  const f = fixture(); try {
    f.changeInventory(x => { x.components.find((c: any) => c.id === 'git-agent-adaptations').license_declared = 'LicenseRef-Unknown'; });
    f.commit(); f.stage(); rmSync(join(f.artifact, 'THIRD-PARTY-NOTICES.md'));
    const report = auditRelease(f.request());
    assert.ok(codes(report).has('DISTRIBUTION_REVIEW_BLOCKED')); assert.ok(codes(report).has('ARTIFACT_SOURCE_MISMATCH'));
    assert.ok(codes(report).has('SOURCE_LICENSE_UNRESOLVED'));
    assert.equal(report.sbom.components.find((x: any) => x.id === 'git-agent-adaptations').license_declared, 'LicenseRef-Unknown');
  } finally { f.close(); }
});

test('M07-G13-SCAN-FRESHNESS stale scans and stale advisory databases cannot establish current security posture', () => {
  const f = fixture(); try {
    const first = auditRelease(f.request()), prior = Date.now() - 2 * 86400000;
    const report = auditRelease(f.request({ scan_evidence: [f.pin('stale.json', scan(first, 'dependency_vulnerabilities', {
      scanned_at: prior, advisory_database: { sha256: '2'.repeat(64), updated_at: prior },
    }))] }));
    assert.ok(codes(report).has('SCAN_STALE_OR_FUTURE')); assert.ok(codes(report).has('ADVISORY_DATABASE_STALE_OR_FUTURE'));
    assert.equal(report.vulnerability_clearance, false);
  } finally { f.close(); }
});

test('M07-G13-SCAN-BINDINGS stale source/artifact identity and omitted scan coverage force new evidence', () => {
  const f = fixture(); try {
    const first = auditRelease(f.request());
    const report = auditRelease(f.request({ scan_evidence: [f.pin('wrong-scope.json', scan(first, 'dependency_vulnerabilities', {
      source_commit: '0'.repeat(40), artifact_sha256: '0'.repeat(64), sbom_sha256: '0'.repeat(64), artifact_paths: [], package_ids: [],
    }))] }));
    assert.ok(codes(report).has('SCAN_SUBJECT_MISMATCH')); assert.ok(codes(report).has('SCAN_FILE_COVERAGE_MISMATCH'));
    assert.ok(codes(report).has('SCAN_PACKAGE_COVERAGE_MISMATCH'));
  } finally { f.close(); }
});

test('M07-G13-SCAN-TRUST byte pins and independently verified finding closure remain required', () => {
  const f = fixture(); try {
    const first = auditRelease(f.request());
    const evidence = scan(first, 'dependency_vulnerabilities', { findings: [{ id: 'RIFARE-SYNTHETIC-CRITICAL-002', severity: 'critical', package_id: first.sbom.packages[0].id, path: null, state: 'resolved', closure_ref: 'author-says-fixed' }] });
    const pin = f.pin('claimed-resolution.json', evidence);
    const report = auditRelease(f.request({ reviewed_sbom: f.pin('sbom.json', first.sbom), scan_evidence: [pin, f.pin('secrets.json', scan(first, 'artifact_secrets'))] }));
    assert.ok(codes(report).has('HIGH_FINDING_CLOSURE_UNVERIFIED')); assert.ok(codes(report).has('EXTERNAL_ATTESTATION_UNAUTHENTICATED'));
    assert.equal(report.scans.external.length, 2); assert.equal(report.release_authorized, false);
    put(f.home, 'claimed-resolution.json', { ...evidence, findings: [] });
    const tampered = auditRelease(f.request({ scan_evidence: [pin] }));
    assert.ok(codes(tampered).has('EVIDENCE_PIN_MISMATCH')); assert.equal(tampered.local_checks, 'fail');
  } finally { f.close(); }
});

test('M07-G13-LINKS linked artifact files are refused before reading their targets', () => {
  const f = fixture(); try {
    const request = f.request(); symlinkSync(join(f.home, 'outside-secret'), join(f.artifact, 'link.txt'));
    assert.equal(auditRelease(request).error, 'UNSAFE_ARTIFACT_ENTRY'); rmSync(join(f.artifact, 'link.txt'));
    linkSync(join(f.artifact, 'README.md'), join(f.artifact, 'hard.txt'));
    assert.equal(auditRelease(request).error, 'UNSAFE_ARTIFACT_ENTRY');
  } finally { f.close(); }
});

test('M07-G13-INPUT-FENCE dirty source, duplicate JSON dependency keys and forged source pins fail closed', () => {
  const f = fixture(); try {
    const request = f.request(); put(f.source, 'README.md', 'Uncommitted source.\n');
    put(f.artifact, 'package.json', '{"name":"rifare","name":"hidden","version":"0.0.0"}');
    request.expected_source.commit = '0'.repeat(40);
    const report = auditRelease(request);
    assert.ok(codes(report).has('SOURCE_NOT_CLEAN')); assert.ok(codes(report).has('SOURCE_PIN_MISMATCH'));
    assert.ok(codes(report).has('DEPENDENCY_MANIFEST_INVALID')); assert.equal(report.release_authorized, false);
  } finally { f.close(); }
});
