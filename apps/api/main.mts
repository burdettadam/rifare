import { createServer } from 'node:http';
import { SmokeStore } from '../../packages/development/store.mts';
import { authorize, body, listen, safeError, sameOrigin, send } from '../../packages/development/http.mts';
import { requestExternalEffect } from '../../packages/development/egress.mts';
import { launchArguments } from '../../packages/development/config.mts';
import type { Configuration } from '../../packages/development/config.mts';

const [raw, secret] = await launchArguments();
if (!raw || !secret || !process.send) throw new Error('USE_DOCUMENTED_START_COMMAND');
const config = JSON.parse(raw) as Configuration;
const store = new SmokeStore(config);
let actualPort = 0;
const server = createServer(async (req, res) => {
  try {
    sameOrigin(req, actualPort);
    if (req.url === '/health' && req.method === 'GET') {
      send(res, 200, { service: 'api', instance_id: config.instanceId, profile: config.profile, ready: true }); return;
    }
    authorize(req, secret);
    if (req.url === '/dev/state' && req.method === 'GET') send(res, 200, store.state());
    else if (req.url === '/dev/markers' && req.method === 'POST') send(res, 201, store.marker(await body(req)));
    else if (req.url === '/dev/jobs' && req.method === 'POST') send(res, 202, store.enqueue(await body(req)));
    else if (req.url === '/dev/external-probe' && req.method === 'POST') {
      const input = await body(req);
      await requestExternalEffect(input.url);
      send(res, 200, { unexpected_external_success: true });
    } else if (req.url?.startsWith('/dev/attachments/') && req.method === 'GET') {
      const id = req.url.slice('/dev/attachments/'.length);
      send(res, 200, JSON.parse(store.readAttachment(id)));
    } else send(res, 404, { error: 'NOT_FOUND' });
  } catch (error) {
    const code = safeError(error);
    const status = ['AUTHORIZATION_REQUIRED', 'HOST_DENIED', 'ORIGIN_DENIED', 'EXTERNAL_EFFECT_DENIED'].includes(code) ? 403
      : code === 'IDEMPOTENCY_CONFLICT' ? 409 : code === 'INTERNAL_ERROR' ? 500 : 400;
    send(res, status, { error: code });
  }
});
actualPort = await listen(server, config.apiPort);
process.send({ service: 'api', port: actualPort, instance_id: config.instanceId });
let stopping = false;
function stop() {
  if (stopping) return; stopping = true;
  server.close(() => { store.close(); process.exit(0); });
  server.closeAllConnections();
}
process.on('SIGTERM', stop); process.on('SIGINT', stop); process.on('disconnect', stop);
