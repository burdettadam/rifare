import { mkdtempSync, cpSync, mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { configuration, childEnvironment } from '../../packages/development/config.mts';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
export function command(cwd: string, command: string, args: string[], env = childEnvironment()) {
  return spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 15000 });
}
export function git(root: string, ...args: string[]) {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Rifare Test',
    '-c', 'user.email=fixture@example.invalid', '-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 });
}
export function fixture() {
  const temporary = mkdtempSync(join(tmpdir(), 'rifare-g05-'));
  const root = join(temporary, 'first'); mkdirSync(root);
  for (const name of ['apps', 'packages', 'migrations', 'package.json', 'package-lock.json', '.npmrc']) {
    cpSync(join(ROOT, name), join(root, name), { recursive: true });
  }
  mkdirSync(join(root, 'tools'));
  for (const name of ['dev-smoke.mts', 'dev-stop.mts', 'dev-migrate.mts', 'dev-target.mts']) cpSync(join(ROOT, 'tools', name), join(root, 'tools', name));
  cpSync(join(ROOT, '.gitignore'), join(root, '.gitignore'));
  git(root, 'init', '-q', '-b', 'main'); git(root, 'add', '.'); git(root, 'commit', '-qm', 'Synthetic runtime fixture');
  return { root, temporary, cleanup: () => rmSync(temporary, { recursive: true, force: true }) };
}
export async function start(root: string, extra: Record<string, string> = {}) {
  const process = spawn(globalThis.process.execPath, ['--experimental-strip-types', 'tools/dev-smoke.mts'], {
    cwd: root, env: { ...childEnvironment(), ...extra }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = ''; process.stdout.on('data', b => output += b); process.stderr.on('data', b => output += b);
  const exit = new Promise<number | null>(resolve => process.once('exit', resolve));
  const config = configuration(root, {});
  try {
    for (let i = 0; i < 100; i++) {
      if (process.exitCode !== null) throw new Error('START_FAILED: ' + output);
      if (existsSync(config.runFile) && output.includes('"event":"ready"')) {
        const run = JSON.parse(readFileSync(config.runFile, 'utf8'));
        return { process, run, config, exit, output: () => output,
          stop: async () => {
            const result = command(root, globalThis.process.execPath, ['--experimental-strip-types', 'tools/dev-stop.mts']);
            if (result.status !== 0) throw new Error('STOP_FAILED: ' + result.stderr);
            const code = await Promise.race([exit, delay(5000).then(() => { throw new Error('STOP_TIMEOUT'); })]);
            if (code !== 0) throw new Error('SUPERVISOR_FAILED: ' + output);
          },
          forceStop: async () => { if (process.exitCode === null) process.kill('SIGTERM'); await exit; },
        };
      }
      await delay(50);
    }
    throw new Error('READY_TIMEOUT: ' + output);
  } catch (error) { process.kill('SIGTERM'); await exit; throw error; }
}
export async function api(run: any, route: string, value?: unknown, headers: Record<string, string> = {}) {
  return await fetch(`http://127.0.0.1:${run.api_port}${route}`, {
    method: value === undefined ? 'GET' : 'POST',
    headers: { authorization: 'Bearer ' + run.secret, ...(value !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    body: value === undefined ? undefined : JSON.stringify(value), signal: AbortSignal.timeout(3000),
  });
}
export async function until(predicate: () => Promise<boolean>, message = 'CONDITION_TIMEOUT') {
  for (let i = 0; i < 80; i++) { if (await predicate()) return; await delay(50); }
  throw new Error(message);
}
