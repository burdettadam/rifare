import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const builder = fileURLToPath(new URL('../../apps/commerce-backend/tools/build-runtime.mjs', import.meta.url));
function fixture(disabled = false) {
  const base = mkdtempSync(join(tmpdir(), 'rifare-admin-build-test-'));
  const output = join(base, '.medusa/server'), admin = join(output, 'public/admin');
  const put = (path: string, value: string) => { mkdirSync(resolve(path, '..'), { recursive: true }); writeFileSync(path, value); };
  mkdirSync(join(base, 'tools')); copyFileSync(builder, join(base, 'tools/build-runtime.mjs'));
  put(join(base, 'package.json'), JSON.stringify({ name: 'rifare-commerce-backend', private: true, scripts: { build: 'source build' } }));
  const lock = '{"name":"synthetic-lock","lockfileVersion":3}\n'; put(join(base, 'package-lock.json'), lock);
  put(join(base, 'run.mjs'), '// synthetic launcher\n');
  // This filesystem unit fixture has no application modules or env files. The
  // full Admin-enabled Medusa build and relocated browser are qualified separately.
  put(join(base, 'node_modules/@medusajs/framework/package.json'), '{"exports":{"./utils":"./utils.js"}}');
  put(join(base, 'node_modules/@medusajs/framework/utils.js'), 'exports.loadEnv=()=>{};');
  put(join(output, 'medusa-config.js'), `module.exports={admin:{disable:${disabled},path:'/app'}};`);
  put(join(output, 'src/config/local-commerce.js'), '// synthetic local config\n');
  put(join(output, 'rifare/authority-adapters.mjs'), '// synthetic adapters\n');
  const html = '<html><head><script type="module" src="/app/assets/entry.js"></script><link rel="stylesheet" href="/app/assets/entry.css"></head><body><div id="medusa"></div></body></html>';
  const complete = () => { put(join(admin, 'index.html'), html); put(join(admin, 'assets/entry.js'), 'document.body.dataset.loaded="true";'); put(join(admin, 'assets/entry.css'), 'body { color: black; }'); };
  const run = () => execFileSync(process.execPath, [join(base, 'tools/build-runtime.mjs')], { cwd: base, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const dispose = () => { assert.ok(resolve(base).startsWith(resolve(tmpdir()) + sep)); rmSync(base, { recursive: true }); };
  return { base, output, admin, lock, put, complete, run, dispose };
}

test('ADMIN-BUILD-BACKEND explicit disabled Admin preserves standalone backend and exact lock', () => {
  const f = fixture(true); try {
    f.run(); const manifest = JSON.parse(readFileSync(join(f.output, 'package.json'), 'utf8'));
    assert.equal(manifest.scripts.start, 'node run.mjs start'); assert.equal(manifest.scripts.build, undefined);
    assert.equal(readFileSync(join(f.output, 'package-lock.json'), 'utf8'), f.lock);
  } finally { f.dispose(); }
});
test('ADMIN-BUILD-COMPLETE packaged Admin entry assets preserve normal runtime commands', () => {
  const f = fixture(); try { f.complete(); f.run(); assert.equal(JSON.parse(readFileSync(join(f.output, 'package.json'), 'utf8')).scripts.user, 'node run.mjs user'); }
  finally { f.dispose(); }
});
test('ADMIN-BUILD-MISSING-INDEX enabled Admin cannot advertise a standalone runtime without its HTML', () => {
  const f = fixture(); try { assert.throws(f.run, /RIFARE_STANDALONE_ADMIN_BUILD_INCOMPLETE/); }
  finally { f.dispose(); }
});
test('ADMIN-BUILD-MISSING-ENTRY HTML alone cannot advertise a loadable Admin', () => {
  const f = fixture(); try { f.complete(); rmSync(join(f.admin, 'assets/entry.js')); assert.throws(f.run, /RIFARE_STANDALONE_ADMIN_BUILD_INCOMPLETE/); }
  finally { f.dispose(); }
});
test('ADMIN-BUILD-ASSET-PATH packaged entries cannot resolve outside the Admin output', () => {
  const f = fixture(); try { f.complete(); f.put(join(f.admin, 'index.html'), '<script type="module" src="/app/%2e%2e/run.mjs"></script>'); assert.throws(f.run, /RIFARE_STANDALONE_ADMIN_BUILD_INCOMPLETE/); }
  finally { f.dispose(); }
});
