import { DatabaseSync } from 'node:sqlite';
import { CommerceKernel } from '../../packages/commerce/kernel.mts';
import { DelegatedCommandClaims, CommandClaimDenied } from '../../packages/commerce/delegated-command-claims.mts';

// Disposable local test child. IPC input is synthetic fixture data, never a
// product transport or a public command endpoint. No environment credentials.
if (!process.send || process.argv.length !== 2) throw new Error('CLAIM_PROCESS_INPUT');
let db: DatabaseSync | undefined;
const send = (value: unknown) => new Promise<void>((resolve, reject) =>
  process.send!(value as object, error => error ? reject(error) : resolve()));
process.once('message', async (input: any) => {
  try {
    if (!input || Buffer.byteLength(JSON.stringify(input)) > 32768 ||
      !['claim', 'read', 'recovery', 'observe', 'claim_hold', 'observe_hold'].includes(input.action))
      throw new Error('CLAIM_PROCESS_INPUT');
    db = new DatabaseSync(input.filename);
    const kernel = new CommerceKernel(db, () => input.now);
    const scope = kernel.authenticate(input.bearer);
    const claims = new DelegatedCommandClaims(kernel, input.correlation);
    await send({ phase: 'ready', pid: process.pid });
    process.once('message', async (go: any) => {
      try {
        if (go?.phase !== 'go') throw new Error('CLAIM_PROCESS_INPUT');
        await send({ phase: 'entering', pid: process.pid });
        let value: unknown;
        if (input.action.startsWith('claim')) value = claims.claim(scope, input.request);
        else if (input.action.startsWith('observe')) value = claims.observe(scope, input.command_id, input.response);
        else if (input.action === 'recovery') value = claims.recovery(scope, input.command_id);
        else value = claims.read(scope, input.command_id);
        if (input.action.endsWith('_hold')) {
          // A test-only commit barrier confirms durable completion to the
          // fault injector without delivering the application result.
          process.on('message', () => {}); // Keep only this disposable fault target alive.
          await send({ phase: 'committed_without_result', pid: process.pid });
          return;
        }
        await send({ phase: 'result', pid: process.pid, ok: true, value });
      } catch (error) {
        await send({ phase: 'result', pid: process.pid, ok: false,
          error: error instanceof CommandClaimDenied ? error.message : 'CLAIM_PROCESS_FAILURE' });
      }
      db?.close(); process.disconnect();
    });
  } catch {
    await send({ phase: 'initialization_failed', pid: process.pid });
    db?.close(); process.exitCode = 1; process.disconnect();
  }
});
