import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { CheckoutProcessHarness, runCheckoutLifecycle } from '../../packages/development/delegated-checkout-process.mts';

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

test('RCG5A-PROCESS-JOURNEY', async () => {
  const report = await runCheckoutLifecycle();
  assert.equal(report.profile, 'commerce-sqlite-diagnostic');
  assert.equal(report.execution_authorized, false);
  assert.equal(report.provider_final_use, false);
  assert.equal(report.full_rcg5_complete, false);
  assert.equal(report.cleanup_complete, true);
  assert.deepEqual(report.checks.map(check => check.id), [
    'independent_processes', 'contract_and_preview', 'original_intents',
    'cross_instance_refusal', 'lost_response_same_intent', 'exact_receipt_retry',
    'process_loss', 'retained_history', 'missing_live_provenance',
    'revision_bound_cancellation', 'other_instance_continues', 'commerce_effects_unchanged',
  ]);
  assert.equal(report.checks.every(check => check.passed === true), true);
  assert.equal(new Set(report.server_process_ids).size, 3);
  assert.equal(report.server_process_ids.includes(process.pid), false);
  assert.ok(report.client_process_ids.length >= 20);
  assert.equal(report.client_process_ids.some(pid => report.server_process_ids.includes(pid) || pid === process.pid), false);
  assert.equal(report.client_sha256, digest(readFileSync(new URL('../../clients/delegated_checkout.py', import.meta.url))));
  const output = JSON.stringify(report);
  for (const prohibited of ['compact_jws', 'private_jwk', 'customer_bearer', 'RIFARE_BEARER', 'proof_hash'])
    assert.equal(output.includes(prohibited), false);
});

test('RCG5A-PROCESS-COPIED-CLIENT', async () => {
  const harness = new CheckoutProcessHarness();
  const directory = harness.directory;
  try {
    assert.deepEqual(readdirSync(harness.clientDirectory), ['delegated_checkout.py']);
    assert.equal(digest(readFileSync(harness.clientPath)), digest(readFileSync(new URL('../../clients/delegated_checkout.py', import.meta.url))));
    const fixture = await harness.fresh('copied');
    const response = await harness.client(fixture, ['contract']);
    assert.equal(response.code, 0);
    assert.equal(JSON.parse(response.stdout).result.routes.length, 7);
    assert.notEqual(response.pid, fixture.ready.pid);
    assert.notEqual(response.pid, process.pid);
  } finally { await harness.close(); }
  assert.equal(existsSync(directory), false);
});

test('RCG5A-PROCESS-OWNERSHIP', async () => {
  const first = new CheckoutProcessHarness(), second = new CheckoutProcessHarness();
  try {
    const fixture = await first.fresh('owned');
    await assert.rejects(second.stop(fixture), /CHECKOUT_PROCESS_NOT_OWNED/);
    await assert.rejects(second.client(fixture, ['contract']), /CHECKOUT_PROCESS_NOT_OWNED/);
    await assert.rejects(first.restart(fixture), /CHECKOUT_PROCESS_STILL_RUNNING/);
    await assert.rejects(first.fresh('owned'), /CHECKOUT_INSTANCE_EXISTS/);
    const response = await first.client(fixture, ['contract']);
    assert.equal(response.code, 0);
    await first.close();
    assert.equal(existsSync(second.clientPath), true);
  } finally { await first.close(); await second.close(); }
});

test('RCG5A-PROCESS-ABORT-CLEANUP', async () => {
  const controller = new AbortController(), harness = new CheckoutProcessHarness(controller.signal);
  const directory = harness.directory;
  const fixture = await harness.fresh('interrupted');
  controller.abort();
  await harness.close();
  assert.equal(existsSync(directory), false);
  assert.equal(fixture.child.exitCode !== null || fixture.child.signalCode !== null, true);
  await assert.rejects(harness.client(fixture, ['contract']), /CHECKOUT_RUN_INTERRUPTED|CHECKOUT_HARNESS_CLOSED/);
});

test('RCG5A-PROCESS-STARTUP-FAILURE-CLEANUP', async () => {
  const harness = new CheckoutProcessHarness();
  const directory = harness.directory;
  try {
    await assert.rejects(harness.fresh('../outside'), /CHECKOUT_INSTANCE_INVALID/);
    assert.equal(readdirSync(directory).length, 1);
    const fixture = await harness.fresh('failure');
    await harness.stop(fixture, true);
    // Removing our own marker is an explicit startup fault, never a fallback to fresh mode.
    const { unlinkSync } = await import('node:fs');
    unlinkSync(join(fixture.directory, 'fixture.json'));
    await assert.rejects(harness.restart(fixture), /CHECKOUT_PROCESS_START_FAILED/);
    assert.equal(fixture.child.signalCode, 'SIGKILL');
  } finally { await harness.close(); }
  assert.equal(existsSync(directory), false);
});

test('RCG5A-PROCESS-COMMAND-REFUSES-INPUT', async () => {
  const result = await new Promise<{ code: number|null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ['--experimental-strip-types',
      new URL('../../tools/demo-delegated-checkout.mts', import.meta.url).pathname, '--endpoint', 'https://example.invalid/private'],
    { env: { PATH: process.env.PATH }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const deadline = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('command deadline')); }, 5000);
    child.stdout.on('data', bytes => { stdout += bytes; });
    child.stderr.on('data', bytes => { stderr += bytes; });
    child.once('error', error => { clearTimeout(deadline); reject(error); });
    child.once('close', code => { clearTimeout(deadline); resolve({ code, stdout, stderr }); });
  });
  assert.equal(result.code, 1); assert.equal(result.stdout, '');
  assert.ok(result.stderr.includes('CHECKOUT_DEMO_ARGUMENTS_DENIED'));
  assert.equal(result.stderr.includes('example.invalid'), false);
});
