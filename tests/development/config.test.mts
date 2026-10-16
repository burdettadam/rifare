import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { configuration, ensurePrivateDirectory, childEnvironment, validateRuntimeFile } from '../../packages/development/config.mts';
import { requestExternalEffect } from '../../packages/development/egress.mts';
import { fixture, git, command } from './helpers.mts';

test('CFG-01 native linked worktrees have different data, queue and attachment namespaces', () => {
  const f = fixture(); try {
    const second = join(f.temporary, 'second'); git(f.root, 'worktree', 'add', '-b', 'second', second);
    const a = configuration(f.root, {}), b = configuration(second, {});
    assert.notEqual(a.instanceId, b.instanceId); assert.notEqual(a.database, b.database); assert.notEqual(a.attachments, b.attachments);
    assert.equal(git(second, 'rev-parse', 'HEAD'), git(f.root, 'rev-parse', 'HEAD'));
  } finally { f.cleanup(); }
});
test('CFG-02 nested current directory resolves to the same Git worktree', () => {
  const f=fixture(); try { assert.deepEqual(configuration(f.root, {}), configuration(join(f.root, 'apps'), {})); } finally { f.cleanup(); }
});
for (const [key, value] of [['DATABASE_URL','postgres://production.invalid/live'],['PGHOST','remote.invalid'],['PGDATABASE','live'],['REDIS_URL','redis://remote.invalid'],['RIFARE_MODE','production'],['RIFARE_DATABASE_PATH','/tmp/shared'],['RIFARE_ATTACHMENTS','/tmp/shared'],['NODE_ENV','production']]) {
  test(`CFG-DENY-${key} rejects external or unreviewed configuration`, () => {
    const f=fixture(); try { assert.throws(() => configuration(f.root, { [key]: value }), /DENIED|UNREVIEWED/); } finally { f.cleanup(); }
  });
}
test('CFG-03 explicit port collision and malformed ports are rejected', () => {
  const f=fixture(); try {
    assert.throws(() => configuration(f.root,{RIFARE_API_PORT:'33000',RIFARE_UI_PORT:'33000'}),/DUPLICATE_PORT/);
    for (const p of ['80','-1','65536','3.4',' 3000','abc']) assert.throws(() => configuration(f.root,{RIFARE_API_PORT:p}));
  } finally { f.cleanup(); }
});
test('CFG-04 runtime symlink cannot redirect data outside the worktree', () => {
  const f=fixture(); try {
    const outside=join(f.temporary,'outside'); mkdirSync(outside); symlinkSync(outside,join(f.root,'runtime'),'dir');
    assert.throws(() => ensurePrivateDirectory(configuration(f.root,{}).dataDir,f.root), /UNSAFE_RUNTIME_DIRECTORY/);
  } finally { f.cleanup(); }
});
test('CFG-05 child environment does not forward provider keys or injected Node options', () => {
  const keys=['OPENAI_API_KEY','ANTHROPIC_API_KEY','AWS_SECRET_ACCESS_KEY','DATABASE_URL','NODE_OPTIONS'];
  const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  try { for(const key of keys) process.env[key]='synthetic-private'; const env=childEnvironment(); for(const key of keys) assert.equal(env[key],undefined); }
  finally { for(const key of keys) { if(old[key]===undefined) delete process.env[key]; else process.env[key]=old[key]; } }
});
test('CFG-06 runtime state files cannot be symlinks', () => {
  const f=fixture();try{ const target=join(f.root,'target');writeFileSync(target,'x');const link=join(f.root,'link');symlinkSync(target,link);assert.throws(()=>validateRuntimeFile(link),/UNSAFE_RUNTIME_FILE/); } finally {f.cleanup();}
});
test('CFG-07 external effect boundary rejects local, remote, encoded and invalid targets', async () => {
  for (const url of ['https://example.invalid/refund','http://127.0.0.1:1/','http://[::1]/','file:///etc/passwd','//example.invalid/',null,{}]) await assert.rejects(requestExternalEffect(url), /External effects are disabled/);
});
test('CFG-08 target development command never silently starts the smoke substitute', () => {
  const f=fixture();try {const r=command(f.root,process.execPath,['--experimental-strip-types','tools/dev-target.mts']);assert.equal(r.status,2);assert.match(r.stderr,/TARGET_STACK_NOT_QUALIFIED/);}finally{f.cleanup();}
});
