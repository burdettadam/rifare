import { readFileSync, mkdtempSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { namespaceFor } from '../../packages/development/config.mts';
import { SmokeStore } from '../../packages/development/store.mts';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const bytes = readFileSync(join(ROOT, 'tests/fixtures/harness/seed.v1.json'));
const source = JSON.parse(bytes.toString('utf8'));
export const SEED_DIGEST = createHash('sha256').update(bytes).digest('hex');
export const EPOCH = source.frozen_epoch_ms;
export const EXPECTED = freeze(JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/harness/expected.v1.json'), 'utf8')));

function freeze(value: any): any {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
}
export function fixture(merchant: string) {
  const selected = source.merchants.find((item: any) => item.id === merchant);
  if (!selected) throw new Error('UNKNOWN_FIXTURE_MERCHANT');
  return freeze(structuredClone(selected));
}
export function merchantIds(): string[] { return source.merchants.map((m: any) => m.id); }
// Reproducible test inputs only. Never use this stream for credentials or money.
export function seeded(seed: number) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('INVALID_FIXTURE_SEED');
  let state = seed;
  return () => state = (Math.imul(1664525, state) + 1013904223) >>> 0;
}
export function frozenClock(epoch = EPOCH) {
  if (!Number.isSafeInteger(epoch) || epoch < 0) throw new Error('INVALID_FIXTURE_CLOCK');
  let now = epoch;
  return Object.freeze({ now: () => now, advance: (ms: number) => {
    if (!Number.isSafeInteger(ms) || ms < 0 || !Number.isSafeInteger(now + ms)) throw new Error('INVALID_CLOCK_ADVANCE');
    now += ms; return now;
  } });
}
export function databaseFixture(merchant: string) {
  const input = fixture(merchant);
  const root = mkdtempSync(join(tmpdir(), 'rifare-g06-db-'));
  let store: SmokeStore | undefined;
  try {
    cpSync(join(ROOT, 'migrations'), join(root, 'migrations'), { recursive: true });
    const dataDir = join(root, 'runtime'); mkdirSync(dataDir, { mode: 0o700 });
    const config = Object.freeze({ root, instanceId: namespaceFor(root), dataDir,
      database: join(dataDir, 'synthetic.sqlite'), attachments: join(dataDir, 'attachments'),
      runFile: join(dataDir, 'run.json'), apiPort: 0, uiPort: 0, controlPort: 0, profile: 'smoke-sqlite' as const });
    store = new SmokeStore(config, true);
    for (const marker of input.markers) store.marker(marker);
    for (const job of input.jobs) store.enqueue(job);
    const opened = store;
    let closed = false;
    return { store: opened, config, input, cleanup() {
      if (!closed) { opened.close(); closed = true; }
      rmSync(root, { recursive: true, force: true });
    } };
  } catch (error) {
    if (store) store.close(); rmSync(root, { recursive: true, force: true }); throw error;
  }
}
