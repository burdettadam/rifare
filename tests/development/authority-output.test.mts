import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { authorityOutput } from '../../apps/commerce-backend/tools/authority-output.mjs';

function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'rifare-authority-output-'));
  const application = join(base, 'app'), outside = join(base, 'outside');
  mkdirSync(application); mkdirSync(outside);
  return { application, outside, output: join(application, '.medusa/server/rifare'), close() { rmSync(base, { recursive: true }); } };
}
test('builder refuses a linked ancestor before creating or changing outside files', () => {
  const f = fixture(); const link = join(f.application, '.medusa'); const sentinel = join(f.outside, 'sentinel');
  try {
    writeFileSync(sentinel, 'keep'); symlinkSync(f.outside, link, 'junction');
    assert.throws(() => authorityOutput(f.application, f.output), /Linked/);
    assert.equal(readFileSync(sentinel, 'utf8'), 'keep'); assert.equal(existsSync(join(f.outside, 'server')), false);
  } finally { if (existsSync(link)) unlinkSync(link); f.close(); }
});
test('builder refuses linked descendants and hardlinked leaves without modifying targets', () => {
  const f = fixture(); const sentinel = join(f.outside, 'source.mjs'); const link = join(f.output, 'shared');
  try {
    mkdirSync(f.output, { recursive: true }); writeFileSync(sentinel, 'keep'); symlinkSync(f.outside, link, 'junction');
    assert.throws(() => authorityOutput(f.application, f.output), /Linked/); unlinkSync(link);
    linkSync(sentinel, join(f.output, 'authority-adapters.mjs'));
    assert.throws(() => authorityOutput(f.application, f.output), /multiply linked/);
    assert.equal(readFileSync(sentinel, 'utf8'), 'keep');
  } finally { f.close(); }
});
test('builder rechecks an expected write leaf and preserves unknown local files', () => {
  const f = fixture(); const sentinel = join(f.outside, 'source.mjs');
  try {
    const writer = authorityOutput(f.application, f.output); mkdirSync(f.output, { recursive: true });
    writeFileSync(sentinel, 'keep'); linkSync(sentinel, join(f.output, 'new.mjs'));
    assert.throws(() => writer.write(join(f.output, 'new.mjs'), 'overwrite'), /Linked/);
    unlinkSync(join(f.output, 'new.mjs')); writeFileSync(join(f.output, '.env'), 'private');
    assert.throws(() => authorityOutput(f.application, f.output), /Unexpected/);
    assert.equal(readFileSync(sentinel, 'utf8'), 'keep'); assert.equal(readFileSync(join(f.output, '.env'), 'utf8'), 'private');
  } finally { f.close(); }
});
test('builder removes stale generated modules and refuses escaping destinations', () => {
  const f = fixture();
  try {
    const writer = authorityOutput(f.application, f.output); const live = join(f.output, 'live.mjs'), old = join(f.output, 'old.mjs');
    writer.write(old, 'old'); writer.write(live, 'live'); writer.prune(new Set([live]));
    assert.equal(existsSync(old), false); assert.equal(readFileSync(live, 'utf8'), 'live');
    assert.throws(() => writer.write(join(f.outside, 'escape.mjs'), 'bad'), /Unsafe/);
  } finally { f.close(); }
});
test('builder refuses cross-drive and UNC destinations before filesystem access', () => {
  const f = fixture();
  try {
    const writer = authorityOutput(f.application, f.output);
    const drive = f.application[0].toUpperCase() === 'Z' ? 'Y' : 'Z';
    for (const path of [drive + ':\\rifare-no-io\\escape.mjs', '\\\\rifare.invalid\\no-io\\escape.mjs'])
      assert.throws(() => writer.write(path, 'bad'), /Unsafe authority build path/);
    assert.equal(existsSync(join(f.application, '.medusa')), false);
  } finally { f.close(); }
});
