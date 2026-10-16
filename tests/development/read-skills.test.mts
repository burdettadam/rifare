import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,cpSync,rmSync,writeFileSync,unlinkSync,symlinkSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';import { join } from 'node:path';import { fileURLToPath } from 'node:url';
import { useRead } from './read-workflow-helpers.mts';
import { loadSkillDirectory } from '../../packages/commerce/skills.mts';
import { digest } from '../../packages/commerce/kernel.mts';

test('CASE-M01-G08-01',()=>useRead(f=>{
  const tool=f.reads.skills.read(f.a.scope,'order-status','SKILL.md',f.bundle.digest);
  assert.equal(tool.content,f.bundle.files['SKILL.md']);assert.equal(tool.sha256,digest(f.bundle.files['SKILL.md']));
  assert.equal(tool.bundle_digest,f.bundle.digest);assert.equal(tool.authority,'guidance_only');
}));
test('CASE-M01-G08-02',()=>useRead(f=>{
  for(const path of ['../secrets','references/../../secret','/etc/passwd','references\\foo','%2e%2e/secret','scripts/run.sh','missing.md'])
    assert.throws(()=>f.reads.skills.read(f.a.scope,'order-status',path),/RESOURCE_DENIED/);
  f.reads.skills.remove(f.b.scope,'order-status');assert.throws(()=>f.reads.skills.read(f.b.scope,'order-status','SKILL.md'),/NOT_FOUND/);
}));
test('CASE-M01-G08-03',()=>useRead(f=>{
  const result=f.reads.action(f.a.scope,'skill.read',{skill_id:'order-status',resource:'SKILL.md',bundle_digest:f.bundle.digest});
  assert.equal(result.content.includes('order.status'),true);assert.equal(JSON.stringify(result).includes(process.cwd()),false);
  assert.equal(f.reads.action(f.a.scope,'order.status',{order_id:f.order().id}).order.number,'ORD-1001');
}));
function copied(fn:(path:string)=>void){const dir=mkdtempSync(join(tmpdir(),'rifare-skill-'));const target=join(dir,'order-status');
  cpSync(fileURLToPath(new URL('../../product-skills/order-status/',import.meta.url)),target,{recursive:true});
  try{fn(target);}finally{rmSync(dir,{recursive:true,force:true});}}
test('M01-G08-SYMLINK',()=>copied(path=>{
  const resource=join(path,'references/read-contract.md');unlinkSync(resource);symlinkSync('/etc/passwd',resource);
  assert.throws(()=>loadSkillDirectory(path),/RESOURCE_DENIED/);
}));
test('M01-G08-METADATA',()=>copied(path=>{
  writeFileSync(join(path,'SKILL.md'),'---\nname: wrong-name\ndescription: Test\n---\nBody');assert.throws(()=>loadSkillDirectory(path),/INVALID_SKILL/);
}));
test('M01-G08-UNSUPPORTED-YAML',()=>copied(path=>{
  writeFileSync(join(path,'SKILL.md'),'---\nname: order-status\ndescription: Test\nallowed-tools: All\n---\nBody');
  assert.throws(()=>loadSkillDirectory(path),/INVALID_SKILL/);
}));
test('M01-G08-DUPLICATE-RESOURCE',()=>copied(path=>{
  const p=join(path,'commerce-manifest.json');const m=JSON.parse(readFileSync(p,'utf8'));m.resources.push(m.resources[0]);writeFileSync(p,JSON.stringify(m));
  assert.throws(()=>loadSkillDirectory(path),/INVALID_SKILL/);
}));
test('M01-G08-PIN',()=>useRead(f=>{assert.throws(()=>f.reads.skills.read(f.a.scope,'order-status','SKILL.md','0'.repeat(64)),/SKILL_CHANGED/);}));
test('M01-G08-INSTALL-DIGEST',()=>useRead(f=>{
  const bad=structuredClone(f.bundle);bad.files['SKILL.md']+='\nChange';assert.throws(()=>f.reads.skills.install(f.a.scope,bad),/INVALID_SKILL/);
}));
test('M01-G08-INSTALL-REQUIRES-OPERATOR',()=>useRead(f=>{assert.throws(()=>f.reads.skills.install(f.a.worker,f.bundle),/ACCESS_DENIED/);}));
test('M01-G08-REMOVED',()=>useRead(f=>{f.reads.skills.remove(f.a.scope,'order-status');assert.throws(()=>f.reads.skills.read(f.a.scope,'order-status','SKILL.md'),/NOT_FOUND/);}));
