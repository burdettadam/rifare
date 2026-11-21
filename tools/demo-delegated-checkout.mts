/** Run only disposable, original synthetic fixtures and the independent client. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const fail = (code: string) => {
  console.error(JSON.stringify({ error: code, execution_authorized: false })); process.exitCode = 1;
};
if (process.argv.length !== 2) {
  fail('CHECKOUT_DEMO_ARGUMENTS_DENIED');
} else {
  const controller = new AbortController(), interrupt = () => controller.abort();
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  try {
    const { runCheckoutLifecycle } = await import('../packages/development/delegated-checkout-process.mts');
    const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args],
      { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const sources = ['packages/development/delegated-checkout-process.mts',
      'packages/development/delegated-checkout-fixture.mts', 'tools/delegated-checkout-fixture-server.mts',
      'tools/demo-delegated-checkout.mts', 'clients/delegated_checkout.py'];
    const source = { candidate: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'),
      dirty: git('status', '--porcelain') !== '',
      sha256: Object.fromEntries(sources.map(path => [path, createHash('sha256')
        .update(readFileSync(new URL('../' + path, import.meta.url))).digest('hex')])) };
    const report = await runCheckoutLifecycle(controller.signal);
    console.log(JSON.stringify({ ...report, source }, null, 2));
  } catch {
    fail(controller.signal.aborted ? 'CHECKOUT_RUN_INTERRUPTED' : 'CHECKOUT_DEMO_FAILED');
  } finally {
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
  }
}
