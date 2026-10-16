import { SmokeStore } from '../../packages/development/store.mts';
import { launchArguments } from '../../packages/development/config.mts';
import type { Configuration } from '../../packages/development/config.mts';

const [raw] = await launchArguments();
if (!raw) throw new Error('INVALID_LAUNCH_CONFIGURATION');
const config = JSON.parse(raw) as Configuration;
const store = new SmokeStore(config);
function tick() {
  store.heartbeat();
  const job = store.claim();
  if (job) { try { store.finish(job); } catch { store.fail(job); } }
}
tick();
const timer = setInterval(tick, 100);
process.send({ service: 'worker', instance_id: config.instanceId });
let stopping = false;
function stop() {
  if (stopping) return; stopping = true;
  clearInterval(timer); store.close(); process.exit(0);
}
process.on('SIGTERM', stop); process.on('SIGINT', stop); process.on('disconnect', stop);
