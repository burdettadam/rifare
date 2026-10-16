import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { configuration, validateRuntimeFile } from '../packages/development/config.mts';
try {
  const config = configuration(); validateRuntimeFile(config.runFile);
  const run = JSON.parse(readFileSync(config.runFile, 'utf8'));
  if (run.instance_id !== config.instanceId || run.profile !== config.profile || !/^[a-f0-9]{64}$/.test(run.secret)
      || !Number.isInteger(run.control_port) || run.control_port < 1024 || run.control_port > 65535) throw new Error('RUN_IDENTITY_MISMATCH');
  await new Promise<void>((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: run.control_port, method: 'POST', path: '/stop',
      headers: { authorization: 'Bearer ' + run.secret }, timeout: 3000 }, res => {
        let raw = '';
        res.on('data', chunk => { raw += chunk; if (raw.length > 4096) req.destroy(new Error('INVALID_RESPONSE')); });
        res.on('end', () => {
          try {
            const value = JSON.parse(raw);
            if (res.statusCode !== 200 || value.instance_id !== config.instanceId || value.stopping !== true) throw new Error('STOP_REFUSED');
            resolve();
          } catch (error) { reject(error); }
        });
      });
    req.on('timeout', () => req.destroy(new Error('STOP_TIMEOUT'))); req.on('error', reject); req.end();
  });
  console.log(JSON.stringify({ stop_requested: true, instance_id: config.instanceId }));
} catch { console.error('STOP_FAILED: no matching running instance was authorized. No PID or other worktree was killed.'); process.exitCode = 1; }
