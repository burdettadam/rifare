import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { CheckoutProcessHarness, runCheckoutPreparationRecovery } from '../../packages/development/delegated-checkout-process.mts';

test('RCG5B-PROCESS-LOST-PREPARATION-RECOVERY', async () => {
  const report = await runCheckoutPreparationRecovery();
  assert.deepEqual(report.checks.map(check => check.id), [
    'separate_contract_and_initial_absence', 'committed_preparation_response_lost',
    'actual_process_replacement', 'original_identity_recovered', 'live_provenance_stays_unavailable',
    'absence_and_cross_instance_refusal', 'minimized_original_history', 'no_replacement_or_commerce_effects',
  ]);
  assert.equal(report.checks.every(check => check.passed), true);
  assert.equal(report.preparation_forwards, 1); assert.equal(report.retained_intent_count, 1);
  assert.equal(report.replacement_intents, 0); assert.equal(report.recovered_revision, 1); assert.equal(report.final_revision, 2);
  assert.equal(new Set(report.server_process_ids).size, 3);
  assert.ok(report.client_process_ids.length >= 15); assert.equal(report.cleanup_complete, true);
  for (const flag of ['execution_authorized','provider_final_use','full_rcg5_complete','target_stack_qualified','os_sandbox_qualified'] as const)
    assert.equal(report[flag], false);
  for (const name of ['compact_jws','private_jwk','customer_bearer','RIFARE_BEARER','proof_hash'])
    assert.equal(JSON.stringify(report).includes(name), false);
});

test('RCG5B-PROCESS-LOSS-PROBE-BOUNDARY', async () => {
  const owned = new CheckoutProcessHarness(), other = new CheckoutProcessHarness();
  const directory = owned.directory;
  try {
    const fixture = await owned.fresh('boundary');
    const pair = fixture.ready.credentials!.primary;
    const original = { preview_id: pair.preview_id, context_id: pair.context_id };
    await assert.rejects(other.losePreparationResponse(fixture, original), /CHECKOUT_PROCESS_NOT_OWNED/);
    await assert.rejects(owned.losePreparationResponse(fixture, { ...original, endpoint: 'https://example.invalid' } as any), /CHECKOUT_RECOVERY_INPUT_INVALID/);
    await assert.rejects(owned.losePreparationResponse(fixture, { ...original, preview_id: 'x'.repeat(97) }), /CHECKOUT_RECOVERY_INPUT_INVALID/);
    await owned.stop(fixture); assert.equal(owned.snapshot(fixture).intent_count, 0);
  } finally { await owned.close(); await other.close(); }
  assert.equal(existsSync(directory), false);
});

test('RCG5B-PROCESS-COMMAND-REFUSES-INPUT', async () => {
  const result = await new Promise<{ code: number|null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ['--experimental-strip-types',
      new URL('../../tools/demo-delegated-checkout-recovery.mts', import.meta.url).pathname,
      '--endpoint', 'https://example.invalid/private'], { env: { PATH: process.env.PATH }, stdio: ['ignore','pipe','pipe'] });
    let stdout = '', stderr = '';
    const deadline = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('RECOVERY_COMMAND_TIMEOUT')); }, 5000);
    child.stdout.on('data', bytes => { stdout += bytes; }); child.stderr.on('data', bytes => { stderr += bytes; });
    child.once('error', reject); child.once('close', code => { clearTimeout(deadline); resolve({ code, stdout, stderr }); });
  });
  assert.equal(result.code, 1); assert.equal(result.stdout, '');
  assert.deepEqual(JSON.parse(result.stderr), { error: 'CHECKOUT_RECOVERY_ARGUMENTS_DENIED', execution_authorized: false });
  assert.equal(result.stderr.includes('example.invalid'), false);
});
