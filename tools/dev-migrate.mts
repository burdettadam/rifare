import { configuration } from '../packages/development/config.mts';
import { SmokeStore } from '../packages/development/store.mts';
try {
  const config = configuration();
  const store = new SmokeStore(config, true);
  console.log(JSON.stringify({ instance_id: config.instanceId, profile: config.profile, migrations: store.state().migrations }));
  store.close();
} catch { console.error('MIGRATION_FAILED: inspect local configuration and existing migration history.'); process.exitCode = 1; }
