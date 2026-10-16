import { fork } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { configuration, ensurePrivateDirectory, childEnvironment, validateRuntimeFile } from '../packages/development/config.mts';
import { SmokeStore } from '../packages/development/store.mts';
import { authorize, listen, sameOrigin, send } from '../packages/development/http.mts';

const config = configuration();
ensurePrivateDirectory(config.dataDir, config.root);
const lockFile = join(config.dataDir, 'start.lock');
const secret = randomBytes(32).toString('hex');
validateRuntimeFile(lockFile); validateRuntimeFile(config.runFile);
try { writeFileSync(lockFile, secret, { flag: 'wx', mode: 0o600 }); }
catch { console.error('INSTANCE_ALREADY_RESERVED: use stop:smoke or inspect the previous owned instance.'); process.exit(1); }
const children: ReturnType<typeof fork>[] = [];
let stopping = false;
let controlPort = 0;
const control = createServer((req, res) => {
  try {
    sameOrigin(req, controlPort); authorize(req, secret);
    if (req.url === '/stop' && req.method === 'POST') {
      send(res, 200, { stopping: true, instance_id: config.instanceId });
      setImmediate(() => shutdown(0));
    } else send(res, 404, { error: 'NOT_FOUND' });
  } catch { send(res, 403, { error: 'CONTROL_DENIED' }); }
});
async function shutdown(code: number) {
  if (stopping) return; stopping = true;
  control.close(); control.closeAllConnections();
  await Promise.all(children.map(child => new Promise<void>(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
    const deadline = setTimeout(() => { child.kill('SIGKILL'); }, 3000);
    child.once('exit', () => { clearTimeout(deadline); resolve(); });
    child.kill('SIGTERM');
  })));
  try {
    validateRuntimeFile(config.runFile);
    if (JSON.parse(readFileSync(config.runFile, 'utf8')).secret === secret) unlinkSync(config.runFile);
  } catch {}
  try { if (readFileSync(lockFile, 'utf8') === secret) unlinkSync(lockFile); } catch {}
  process.exit(code);
}
process.on('SIGTERM', () => shutdown(0)); process.on('SIGINT', () => shutdown(0));
async function service(name: string, args: string[]): Promise<any> {
  const child = fork(join(config.root, name), [], { cwd: config.root, env: childEnvironment(),
    execArgv: ['--experimental-strip-types'], stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  children.push(child);
  child.once('exit', () => { if (!stopping) shutdown(1); });
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('SERVICE_READINESS_TIMEOUT')), 8000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('SERVICE_START_FAILED')); });
    child.on('message', message => {
      if ((message as any).awaiting_configuration === true) { child.send(args); return; }
      clearTimeout(timer);
      if ((message as any).instance_id !== config.instanceId) reject(new Error('SERVICE_IDENTITY_MISMATCH'));
      else resolve(message);
    });
  });
}
try {
  const store = new SmokeStore(config, true); store.close();
  controlPort = await listen(control, config.controlPort);
  const raw = JSON.stringify(config);
  const api = await service('apps/api/main.mts', [raw, secret]);
  await service('apps/worker/main.mts', [raw]);
  const web = await service('apps/web/server.mts', [raw, String(api.port), secret]);
  writeFileSync(config.runFile, JSON.stringify({ schema_version: 1, instance_id: config.instanceId,
    profile: config.profile, api_port: api.port, ui_port: web.port, control_port: controlPort,
    secret, pid: process.pid }) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ event: 'ready', instance_id: config.instanceId, profile: config.profile,
    api: `http://127.0.0.1:${api.port}`, ui: `http://127.0.0.1:${web.port}`, external_effects: 'denied',
    target_stack_qualified: false }));
} catch (error) {
  console.error('START_FAILED:', error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'LOCAL_RESOURCE_ERROR');
  await shutdown(1);
}
