import { closeSync, constants, fstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { runPilotProtocol, type PilotMode } from '../packages/pilot/protocol.mts';

try {
  const [mode, file, ...rest] = process.argv.slice(2);
  if (mode === '--describe' && !file && !rest.length) {
    process.stdout.write(JSON.stringify({ version: 1, commands: ['register', 'append', 'project', 'readiness'],
      input: 'One explicit local JSON request file; retain registration and head SHA-256 values independently.',
      storage: 'Caller-owned private local cohort artifacts; case references can be personal data.',
      scorer: 'Unchanged tools/check_release_benchmark.py', input_limit_bytes: 1048576,
      live_pilot_started: false, pilot_authorized: false, verified_live_observations: 0 }) + '\n');
  } else {
    if (rest.length || !file || !['register', 'append', 'project', 'readiness'].includes(mode))
      throw new Error('Usage: pilot-protocol.mts register|append|project|readiness REQUEST.json');
    const path = resolve(file);
    if (realpathSync(path) !== path) throw new Error('PILOT_PATH_UNSAFE');
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let raw: string;
    try {
      const s = fstatSync(fd);
      if (!s.isFile() || s.nlink !== 1 || s.size > 1048576) throw new Error('PILOT_INPUT_LIMIT');
      raw = readFileSync(fd, 'utf8');
    } finally { closeSync(fd); }
    const report = runPilotProtocol(mode as PilotMode, raw!);
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    process.exitCode = mode === 'readiness' ? 1 : 0;
  }
} catch (error) {
  process.stderr.write((error instanceof Error && /^PILOT_[A-Z_]+$/.test(error.message) ? error.message : 'PILOT_COMMAND_FAILED') + '\n');
  process.exitCode = 1;
}
