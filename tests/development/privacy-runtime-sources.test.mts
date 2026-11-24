import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { privacyRuntimeSourcePath } from '../../packages/commerce/privacy-runtime-sources.mts';

const MODULE = new URL('../../packages/commerce/privacy-runtime-sources.mts', import.meta.url);
const MODULE_PATH = 'packages/commerce/privacy-runtime-sources.mts';
const hash = (bytes: string|Buffer) => createHash('sha256').update(bytes).digest('hex');
async function usingSource(run: (f: any) => unknown) {
  const temporary = mkdtempSync(join(tmpdir(), 'rifare-privacy-sources-')), root = join(temporary, 'source');
  mkdirSync(join(root, 'apps'), {recursive: true}); mkdirSync(join(root, 'packages/commerce'), {recursive: true});
  copyFileSync(MODULE, join(root, MODULE_PATH));
  const write = (path: string, value: string|Buffer = '') => {mkdirSync(dirname(join(root, path)), {recursive: true}); writeFileSync(join(root, path), value);};
  try {const module = await import(pathToFileURL(join(root, MODULE_PATH)).href); return await run({root, temporary, write, observe: module.observePrivacyRuntimeSources});}
  finally {rmSync(temporary, {recursive: true, force: true});}
}

test('PRIVACY-SOURCE-LITERAL-PATHS', () => {
  for (const path of ['apps/backend/src/api/carts/[id]/route.ts', 'packages/commerce/a.mts']) assert.equal(privacyRuntimeSourcePath(path), true);
  for (const path of ['/apps/a.ts', 'C:/apps/a.ts', 'apps\\a.ts', 'apps//a.ts', 'apps/../a.ts', 'apps/./a.ts', 'apps/[../a.ts',
    'apps/[id]suffix/a.ts', 'apps/prefix[id]/a.ts', 'apps/[id/a.ts', 'apps/id]/a.ts', 'apps/[]/a.ts', 'apps/[*]/a.ts', 'apps/[...id]/a.ts', 'apps/[0id]/a.ts', 'apps/[a-b]/a.ts', 'apps/*.ts'])
    assert.equal(privacyRuntimeSourcePath(path), false, path);
});

test('PRIVACY-SOURCE-CACHE-DIRECTORIES-AND-LITERAL-ROUTES', () => usingSource(f => {
  for (const name of ['node_modules', '.medusa', '.cache']) f.write('apps/backend/'+name+'/oversized.ts', Buffer.alloc(2*1024*1024+1));
  for (const name of ['node_modules_extra', '.medusa-extra', '.cache-extra']) f.write('apps/backend/'+name+'/source.ts', 'export const retained = true;');
  f.write('apps/backend/.cache.ts', 'export const ordinary = true;');
  const route = 'apps/backend/src/api/carts/[id]/route.ts'; f.write(route, 'export const route = "literal";\r\n');
  const observed = f.observe(), paths = observed.map((p: any) => p.path);
  assert.deepEqual(paths, [MODULE_PATH, route, 'apps/backend/.cache.ts', ...['node_modules_extra', '.medusa-extra', '.cache-extra'].map(name => 'apps/backend/'+name+'/source.ts')].sort((a,b)=>a.localeCompare(b)));
  assert.equal(observed.find((p: any) => p.path === route).sha256, hash('export const route = "literal";\r\n'));
  assert.deepEqual(f.observe(), observed);
}));

test('PRIVACY-SOURCE-ORDINARY-ADDITION-CHANGE-AND-REMOVAL', () => usingSource(f => {
  assert.deepEqual(f.observe().map((p: any) => p.path), [MODULE_PATH]);
  const path = 'packages/new-store/customer-cache.mts'; f.write(path, 'original\r\n');
  const before = f.observe(); assert.equal(before.find((p: any) => p.path === path).sha256, hash('original\r\n'));
  f.write(path, 'original\n'); assert.notDeepEqual(f.observe(), before);
  rmSync(join(f.root, path)); assert.deepEqual(f.observe().map((p: any) => p.path), [MODULE_PATH]);
}));

test('PRIVACY-SOURCE-LINKS-REJECTED-BEFORE-CACHE-EXCLUSION', async () => {
  for (const name of ['ordinary', 'node_modules', '.medusa', '.cache']) await usingSource(f => {
    const outside = join(f.temporary, 'outside'); mkdirSync(outside); writeFileSync(join(outside, 'private.ts'), 'outside');
    symlinkSync(outside, join(f.root, 'apps', name), 'junction');
    assert.throws(f.observe, /PRIVACY_RUNTIME_SOURCE_UNSAFE/);
  });
});

test('PRIVACY-SOURCE-MALFORMED-ROUTE-DISCOVERY-REFUSED', () => usingSource(f => {
  f.write('apps/backend/[id]suffix/route.ts', 'not a literal route parameter');
  assert.throws(f.observe, /PRIVACY_RUNTIME_SOURCE_LIMIT/);
}));

test('PRIVACY-SOURCE-PER-FILE-BYTE-LIMIT', () => usingSource(f => {
  const path = 'apps/ordinary.ts'; f.write(path, Buffer.alloc(2*1024*1024)); assert.equal(f.observe().length, 2);
  f.write(path, Buffer.alloc(2*1024*1024+1)); assert.throws(f.observe, /PRIVACY_RUNTIME_SOURCE_LIMIT/);
}));

test('PRIVACY-SOURCE-FILE-COUNT-LIMIT', () => usingSource(f => {
  for (let i=0;i<1999;i++) f.write('apps/source-'+String(i).padStart(4,'0')+'.ts');
  assert.equal(f.observe().length, 2000);
  f.write('apps/extra.ts'); assert.throws(f.observe, /PRIVACY_RUNTIME_SOURCE_LIMIT/);
}));

test('PRIVACY-SOURCE-ENTRY-COUNT-LIMIT', () => usingSource(f => {
  // Two retained entries are the commerce directory and observer module.
  for (let i=0;i<9998;i++) f.write('apps/entry-'+String(i).padStart(5,'0')+'.txt');
  assert.equal(f.observe().length, 1);
  f.write('apps/extra.txt'); assert.throws(f.observe, /PRIVACY_RUNTIME_SOURCE_LIMIT/);
}));

test('PRIVACY-SOURCE-TOTAL-BYTE-LIMIT', () => usingSource(f => {
  const moduleBytes = readFileSync(join(f.root, MODULE_PATH)).length, block = 2*1024*1024;
  for (let i=0;i<15;i++) f.write('apps/source-'+i+'.ts', Buffer.alloc(block));
  f.write('apps/final.ts', Buffer.alloc(block-moduleBytes)); assert.equal(f.observe().length, 17);
  f.write('apps/final.ts', Buffer.alloc(block-moduleBytes+1)); assert.throws(f.observe, /PRIVACY_RUNTIME_SOURCE_LIMIT/);
}));
