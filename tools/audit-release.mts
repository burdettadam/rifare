import { lstatSync, readFileSync } from 'node:fs';
import { runReleaseAudit } from '../packages/security/release-audit.mts';

try {
  const [mode, input, ...rest] = process.argv.slice(2);
  if (rest.length || !input || !['audit', 'inventory'].includes(mode)) throw new Error('Usage: audit-release.mts audit REQUEST.json | inventory STAGED_SOURCE_DIRECTORY');
  let raw: string;
  if (mode === 'inventory') raw = JSON.stringify({ artifact_root: input });
  else {
    const info = lstatSync(input);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 1024 * 1024) throw new Error('RELEASE_AUDIT_REQUEST_UNSAFE');
    raw = readFileSync(input, 'utf8');
  }
  const report = runReleaseAudit(mode as 'audit' | 'inventory', raw);
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exitCode = mode === 'inventory' && !report.error ? 0 : 1;
} catch (error) {
  process.stderr.write((error instanceof Error ? error.message : 'RELEASE_AUDIT_FAILED') + '\n');
  process.exitCode = 1;
}
