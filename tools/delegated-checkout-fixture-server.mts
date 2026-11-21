import { launchArguments } from '../packages/development/config.mts';
import { openCheckoutFixture } from '../packages/development/delegated-checkout-fixture.mts';

let fixture: Awaited<ReturnType<typeof openCheckoutFixture>> | undefined;
let stopping = false;
const failure = { event: 'checkout_fixture_failed', code: 'CHECKOUT_FIXTURE_START_FAILED' } as const;
async function stop(failed = false): Promise<void> {
  if (stopping) return; stopping = true;
  clearTimeout(deadline);
  try { await fixture?.close(); }
  finally {
    process.exitCode = failed ? 1 : 0;
    if (process.connected && process.send) {
      if (failed) process.send(failure, () => { if (process.connected) process.disconnect?.(); });
      else process.disconnect?.();
    }
  }
}
const deadline = setTimeout(() => { void stop(true); }, 10000);
process.once('SIGINT', () => { void stop(); });
process.once('SIGTERM', () => { void stop(); });
process.once('disconnect', () => { void stop(); });
try {
  if (!process.send || !process.connected || process.argv.length !== 2) throw new Error('CHECKOUT_FIXTURE_START_FAILED');
  const args = await launchArguments();
  if (stopping || args.length !== 3 || (args[2] !== 'fresh' && args[2] !== 'history'))
    throw new Error('CHECKOUT_FIXTURE_START_FAILED');
  process.on('message', () => { void stop(true); });
  fixture = await openCheckoutFixture(args[0], args[1], args[2]);
  if (stopping || !process.connected) await fixture.close();
  else {
    clearTimeout(deadline);
    process.send!(fixture.ready, error => { if (error) void stop(true); });
  }
} catch { await stop(true); }
