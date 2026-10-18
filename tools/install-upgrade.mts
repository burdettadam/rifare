import { readFileSync, lstatSync } from 'node:fs';
import { resolve } from 'node:path';
import { installOffline, prepareUpgrade, rollbackUpgrade, inspectInstallation, startInstalledDiagnostic } from '../packages/operations/installation-upgrade.mts';

const [command, requestFile, ...extra] = process.argv.slice(2);
try {
  if (!['install', 'upgrade', 'rollback', 'inspect', 'serve'].includes(command) || !requestFile || extra.length) {
    throw new Error('USAGE: node --experimental-strip-types tools/install-upgrade.mts install|upgrade|rollback|inspect|serve request.json');
  }
  const file = resolve(requestFile), stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 262144) throw new Error('INSTALLATION_REQUEST_UNSAFE');
  const request = JSON.parse(readFileSync(file, 'utf8'));
  if (command === 'serve') {
    const server = await startInstalledDiagnostic(request);
    const { close, ...publicResult } = server;
    console.log(JSON.stringify(publicResult));
    process.once('SIGINT', () => void close());
    process.once('SIGTERM', () => void close());
  } else {
    const functions = { install: installOffline, upgrade: prepareUpgrade, rollback: rollbackUpgrade, inspect: inspectInstallation };
    console.log(JSON.stringify(functions[command as keyof typeof functions](request)));
  }
} catch (error) {
  const message = error instanceof Error ? error.message : 'INSTALLATION_FAILED';
  console.error(JSON.stringify({ error: /^(?:[A-Z][A-Z0-9_]+|USAGE: .+)$/.test(message) ? message : 'INSTALLATION_FAILED', ready: false }));
  process.exitCode = 1;
}
