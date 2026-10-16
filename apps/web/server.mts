import { createServer, request } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { body, listen, safeError, sameOrigin, send } from '../../packages/development/http.mts';
import { launchArguments } from '../../packages/development/config.mts';
import type { Configuration } from '../../packages/development/config.mts';

const [raw, rawPort, secret] = await launchArguments();
if (!raw || !rawPort || !secret || !process.send) throw new Error('USE_DOCUMENTED_START_COMMAND');
const config = JSON.parse(raw) as Configuration;
const apiPort = Number(rawPort);
const assets: Record<string, [string, string]> = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/smoke.js': ['smoke.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
};
let actualPort = 0;
const server = createServer(async (req, res) => {
  try {
    sameOrigin(req, actualPort);
    if (req.url === '/health' && req.method === 'GET') {
      send(res, 200, { service: 'web', instance_id: config.instanceId, profile: config.profile }); return;
    }
    if (req.method === 'GET' && req.url && assets[req.url]) {
      const [name, type] = assets[req.url];
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
        'referrer-policy': 'no-referrer' });
      res.end(readFileSync(join(config.root, 'apps', 'web', name))); return;
    }
    const route = req.url?.replace(/^\/api/, '');
    const permitted = (req.method === 'GET' && (route === '/dev/state' || /^\/dev\/attachments\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(route ?? '')))
      || (req.method === 'POST' && ['/dev/markers', '/dev/jobs', '/dev/external-probe'].includes(route ?? ''));
    if (!req.url?.startsWith('/api/') || !permitted) { send(res, 404, { error: 'NOT_FOUND' }); return; }
    const payload = req.method === 'POST' ? JSON.stringify(await body(req)) : undefined;
    const upstream = request({ hostname: '127.0.0.1', port: apiPort, path: route, method: req.method,
      headers: { authorization: 'Bearer ' + secret, 'content-type': 'application/json' }, timeout: 3000 }, response => {
        res.writeHead(response.statusCode ?? 502, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        response.pipe(res);
      });
    upstream.on('error', () => { if (!res.headersSent) send(res, 502, { error: 'API_UNAVAILABLE' }); else res.destroy(); });
    upstream.on('timeout', () => upstream.destroy());
    upstream.end(payload);
  } catch (error) { send(res, 403, { error: safeError(error) }); }
});
actualPort = await listen(server, config.uiPort);
process.send({ service: 'web', port: actualPort, instance_id: config.instanceId });
let stopping = false;
function stop() {
  if (stopping) return; stopping = true;
  server.close(() => process.exit(0)); server.closeAllConnections();
}
process.on('SIGTERM', stop); process.on('SIGINT', stop); process.on('disconnect', stop);
