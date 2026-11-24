import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const application = new URL('../apps/commerce-backend/', import.meta.url);
const cli = new URL('node_modules/@medusajs/cli/cli.js', application);
if (!existsSync(cli)) {
  console.error('TARGET_STACK_NOT_QUALIFIED: install the pinned commerce application with npm ci --prefix apps/commerce-backend --ignore-scripts and configure its local PostgreSQL profile.');
  console.error('See docs/DEVELOPMENT.md. Medusa is the only application runtime.');
  process.exitCode = 2;
} else {
  const child = spawn(process.execPath, [fileURLToPath(new URL('run.mjs', application)), 'develop'], {
    cwd: fileURLToPath(application), stdio: 'inherit', env: process.env,
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => child.kill(signal));
  child.once('error', () => { process.exitCode = 1; });
  child.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
}
