import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { realpathSync, lstatSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';

export type Configuration = Readonly<{
  root: string; instanceId: string; dataDir: string; database: string;
  attachments: string; runFile: string; apiPort: number; uiPort: number;
  controlPort: number; profile: 'smoke-sqlite';
}>;

export function worktreeRoot(cwd = process.cwd()): string {
  const root = execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000 }).trim();
  return realpathSync(root);
}

export function namespaceFor(root: string): string {
  return 'rifare_' + createHash('sha256').update(realpathSync(root)).digest('hex').slice(0, 24);
}

function port(value: string | undefined): number {
  if (value === undefined || value === '') return 0;
  if (!/^\d{1,5}$/.test(value) || Number(value) > 65535) throw new Error('INVALID_PORT');
  const n = Number(value);
  if (n !== 0 && n < 1024) throw new Error('PRIVILEGED_PORT_DENIED');
  return n;
}

export function configuration(cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env): Configuration {
  const allowed = new Set(['RIFARE_API_PORT', 'RIFARE_UI_PORT', 'RIFARE_CONTROL_PORT']);
  for (const [key, value] of Object.entries(env)) {
    if (!value) continue;
    if (key.startsWith('RIFARE_') && !allowed.has(key)) throw new Error('UNREVIEWED_CONFIGURATION');
    if (['DATABASE_URL', 'PGHOST', 'PGDATABASE', 'REDIS_URL'].includes(key)) throw new Error('EXTERNAL_CONFIGURATION_DENIED');
  }
  if (env.NODE_ENV === 'production') throw new Error('PRODUCTION_MODE_DENIED');
  const root = worktreeRoot(cwd);
  const instanceId = namespaceFor(root);
  const dataDir = join(root, 'runtime', 'instances', instanceId);
  const ports = [port(env.RIFARE_API_PORT), port(env.RIFARE_UI_PORT), port(env.RIFARE_CONTROL_PORT)];
  if (new Set(ports.filter(Boolean)).size !== ports.filter(Boolean).length) throw new Error('DUPLICATE_PORT');
  return Object.freeze({ root, instanceId, dataDir, database: join(dataDir, 'synthetic.sqlite'),
    attachments: join(dataDir, 'attachments'), runFile: join(dataDir, 'run.json'),
    apiPort: ports[0], uiPort: ports[1], controlPort: ports[2], profile: 'smoke-sqlite' });
}

export function ensurePrivateDirectory(path: string, root: string): void {
  const rel = relative(root, path);
  if (resolve(path) !== path || isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep)) throw new Error('PATH_OUTSIDE_WORKTREE');
  // The root was obtained through Git and realpath. Never follow runtime symlinks.
  let current = root;
  for (const piece of rel.split(sep).filter(Boolean)) {
    current = join(current, piece);
    if (!existsSync(current)) mkdirSync(current, { mode: 0o700 });
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('UNSAFE_RUNTIME_DIRECTORY');
  }
}

export function validateRuntimeFile(path: string): void {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('UNSAFE_RUNTIME_FILE');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export function childEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NODE_ENV: 'development' };
  for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}

export async function launchArguments(): Promise<string[]> {
  if (!process.send) throw new Error('USE_DOCUMENTED_START_COMMAND');
  const result = await new Promise<unknown>(resolve => {
    process.once('message', resolve);
    process.send!({ awaiting_configuration: true });
  });
  if (!Array.isArray(result) || !result.every(x => typeof x === 'string')) throw new Error('INVALID_LAUNCH_CONFIGURATION');
  return result;
}
