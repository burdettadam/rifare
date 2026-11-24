/** Real process ownership checks; these do not launch or qualify a browser. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCheckoutBrowserProbe } from './delegated-checkout-browser-process.mts';

const root = fileURLToPath(new URL('../../', import.meta.url));
interface Identity { pid: number; start_ticks: string }
interface Owned { guardian: Identity; worker: Identity; descendant: Identity }
function identities(value: unknown): Owned {
  const owned = value as Owned;
  for (const key of ['guardian', 'worker', 'descendant'] as const) {
    assert.ok(owned?.[key] && Number.isSafeInteger(owned[key].pid) && owned[key].pid > 1);
    assert.match(owned[key].start_ticks, /^\d+$/);
  }
  return owned;
}
function stateOf(identity: Identity): string | null {
  try {
    const stat = readFileSync('/proc/' + identity.pid + '/stat', 'utf8').split(') ')[1].split(' ');
    return stat[19] === identity.start_ticks ? stat[0] : null;
  } catch (error) {
    if (['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code ?? '')) return null;
    throw error;
  }
}
function running(identity: Identity): boolean {
  const state = stateOf(identity);
  return state !== null && state !== 'Z';
}
async function stopped(owned: Owned) {
  const deadline = Date.now() + 5000;
  while (Object.values(owned).some(running)) {
    if (Date.now() >= deadline) throw new Error('OWNED_PROCESS_SURVIVED');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
async function reaped(owned: Owned) {
  const deadline = Date.now() + 5000;
  while (stateOf(owned.worker) !== null || stateOf(owned.descendant) !== null || running(owned.guardian)) {
    if (Date.now() >= deadline) throw new Error('OWNED_DESCENDANT_NOT_REAPED');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
function observation() {
  const state: { value?: Owned; stdout: string; capture: (chunk: string) => void } = {
    stdout: '', capture(chunk) {
      state.stdout += chunk;
      if (state.stdout.includes('\n')) state.value = identities(JSON.parse(state.stdout).owned);
    },
  };
  return state;
}
async function cleanup(owned?: Owned) {
  if (!owned) return;
  // A pidfd keeps the target stable between identity verification and signalling.
  // This fallback can only address the three exact harmless probe identities.
  execFileSync(process.env.RIFARE_TEST_PYTHON || 'python3', ['-I', '-S', '-c', `import json, os, signal, sys
from pathlib import Path
for identity in json.loads(sys.argv[1]):
    descriptor = None
    try:
        descriptor = os.pidfd_open(identity['pid'])
        stat = Path('/proc/' + str(identity['pid']) + '/stat').read_text().rpartition(') ')[2].split()
        if stat[19] == identity['start_ticks'] and stat[0] != 'Z':
            signal.pidfd_send_signal(descriptor, signal.SIGKILL)
    except ProcessLookupError:
        pass
    except FileNotFoundError:
        pass
    finally:
        if descriptor is not None: os.close(descriptor)
`, JSON.stringify([owned.descendant, owned.worker, owned.guardian])], { stdio: 'pipe', timeout: 5000 });
  await stopped(owned);
}
test('RCG5C-PROCESS-NORMAL-REAPS-DESCENDANT', async () => {
  const observed = observation();
  try {
    const result = await runCheckoutBrowserProbe('normal', { onOutput: observed.capture });
    assert.equal(result.code, 0, result.stderr); assert.equal(result.timedOut, false);
    assert.equal(result.guard?.cleanup_complete, true); assert.equal(result.guard?.reason, 'worker_exit');
    const pids = JSON.parse(result.stdout); const owned = identities(observed.value);
    assert.equal(pids.probe, 'normal'); assert.equal(result.guard?.worker_pid, owned.worker.pid);
    assert.equal(result.guard?.guardian_pid, owned.guardian.pid);
    await reaped(owned);
  } finally { await cleanup(observed.value); }
});

test('RCG5C-PROCESS-CASE-DEADLINE', async () => {
  const observed = observation();
  try {
    const result = await runCheckoutBrowserProbe('hold', { timeoutMs: 600, onOutput: observed.capture });
    assert.equal(result.timedOut, true, result.stderr); assert.equal(result.outputOverflow, false);
    assert.equal(result.guard?.cleanup_complete, true); assert.equal(result.guard?.reason, 'parent_eof');
    assert.notEqual(result.code, 0);
    const pids = JSON.parse(result.stdout); assert.equal(pids.probe, 'hold');
    await reaped(identities(observed.value));
  } finally { await cleanup(observed.value); }
});

test('RCG5C-PROCESS-OUTER-RUNNER-DEADLINE', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'rifare-browser-deadline-'));
  let owned: Owned | undefined;
  try {
    mkdirSync(join(directory, 'planning')); mkdirSync(join(directory, 'tests/development'), { recursive: true });
    mkdirSync(join(directory, 'tests/browser'));
    for (const source of ['planning/development-test-profiles.json',
      'tests/development/delegated-checkout-browser-process.mts', 'tests/browser/checkout_review_process.py',
      'tests/browser/delegated_checkout_review.py']) copyFileSync(join(root, source), join(directory, source));
    const source = 'tests/development/outer-deadline.test.mts';
    writeFileSync(join(directory, 'planning/regression-registry.json'), JSON.stringify({ tests: [
      { id: 'runtime:RCG5C-OWNED-OUTER-FAULT', suite: 'runtime', runner_case_id: 'RCG5C-OWNED-OUTER-FAULT', source },
    ] }));
    writeFileSync(join(directory, source), `import outerDeadline from 'node:test';
import { writeFileSync } from 'node:fs';
import { runCheckoutBrowserProbe } from './delegated-checkout-browser-process.mts';
outerDeadline('RCG5C-OWNED-OUTER-FAULT', async () => {
  let stdout = '';
  const result = await runCheckoutBrowserProbe('hold', { onOutput(chunk) {
    stdout += chunk;
    if (!stdout.includes('\\n')) return;
    writeFileSync('owned-processes.json', JSON.stringify(JSON.parse(stdout).owned));
  } });
  throw new Error('GUARD_STOPPED_BEFORE_OUTER_DEADLINE: ' + result.stderr);
});
`);
    const git = (...args: string[]) => execFileSync('git', ['-C', directory, ...args], { stdio: 'pipe' });
    git('init', '-q'); git('config', 'user.name', 'Rifare test'); git('config', 'user.email', 'test@rifare.invalid');
    git('add', '.'); git('commit', '-qm', 'bounded outer deadline fixture');
    const output = join(directory, 'run');
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(process.env.RIFARE_TEST_PYTHON || 'python3', [join(root, 'tools/dev_tests.py'), '--root', directory, '--files', source,
        '--timeout', '2', '--output', output], {
        env: { PATH: process.env.PATH, RIFARE_DEV_NODE: process.execPath },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '', stderr = '';
      const timer = setTimeout(() => child.kill('SIGKILL'), 12000);
      child.stdout.on('data', bytes => { stdout += bytes; }); child.stderr.on('data', bytes => { stderr += bytes; });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    });
    const nestedLog = join(output, '01-output.log');
    assert.equal(result.code, 124, result.stderr ||
      (existsSync(nestedLog) ? readFileSync(nestedLog, 'utf8') : result.stdout));
    const report = JSON.parse(readFileSync(join(output, 'report.json'), 'utf8'));
    assert.equal(report.results[0].timed_out, true); assert.equal(report.results[0].returncode, 124);
    assert.equal(report.full_regression, false); assert.equal(report.goal_accepted, false);
    owned = identities(JSON.parse(readFileSync(join(directory, 'owned-processes.json'), 'utf8')));
    await reaped(owned);
  } finally {
    // Failing probes still stop only the exact harmless process identities they created.
    if (!owned && existsSync(join(directory, 'owned-processes.json')))
      owned = identities(JSON.parse(readFileSync(join(directory, 'owned-processes.json'), 'utf8')));
    await cleanup(owned);
    rmSync(directory, { recursive: true, force: true });
  }
});
