/** Observe original preparation recovery with disposable native processes. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const fail = (code: string) => {
  console.error(JSON.stringify({ error: code, execution_authorized: false })); process.exitCode = 1;
};
if (process.argv.length !== 2) {
  fail('CHECKOUT_RECOVERY_ARGUMENTS_DENIED');
} else {
  const controller = new AbortController(), interrupt = () => controller.abort();
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  try {
    const { runCheckoutPreparationRecovery } = await import('../packages/development/delegated-checkout-process.mts');
    const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args],
      { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const sources = ['packages/development/delegated-checkout-process.mts',
      'packages/development/delegated-checkout-fixture.mts', 'tools/delegated-checkout-fixture-server.mts',
      'packages/commerce/delegated-checkout-intents.mts', 'packages/commerce/delegated-checkout-api.mts',
      'packages/commerce/contracts/delegated-checkout-recovery.v1.json', 'apps/commerce-api/server.mts',
      'tools/demo-delegated-checkout-recovery.mts', 'clients/delegated_checkout.py'];
    const source = { candidate: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'),
      dirty: git('status', '--porcelain') !== '', sha256: Object.fromEntries(sources.map(path =>
        [path, createHash('sha256').update(readFileSync(new URL('../' + path, import.meta.url))).digest('hex')])) };
    console.log(JSON.stringify({ ...await runCheckoutPreparationRecovery(controller.signal), source }, null, 2));
  } catch {
    fail(controller.signal.aborted ? 'CHECKOUT_RUN_INTERRUPTED' : 'CHECKOUT_RECOVERY_FAILED');
  } finally {
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
  }
}
