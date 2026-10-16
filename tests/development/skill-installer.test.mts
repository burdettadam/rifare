import test from 'node:test';import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync,linkSync,chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';import { join,dirname } from 'node:path';import { gzipSync } from 'node:zlib';
import { useCustomization,manifestFiles } from './customization-helpers.mts';
import { SkillInstaller,decodeSkillPackage,readInstructionDirectory } from '../../packages/commerce/skill-installer.mts';
const origin='https://publisher.example.invalid/skills';
function approval(f:any,installer:SkillInstaller,b:any){return installer.approve(f.owner.scope,{origin,bundle_digest:b.digest,skill_id:b.id,version:b.version,expires_at:f.now()+60000});}
function packageBytes(files:any){return Buffer.from(JSON.stringify({format:'rifare-instruction-bundle-v1',origin,files}));}
function directory(fn:(root:string)=>unknown){const root=mkdtempSync(join(tmpdir(),'rifare-bundle-'));const f=manifestFiles();for(const [p,c] of Object.entries(f.files)){mkdirSync(dirname(join(root,p)),{recursive:true});writeFileSync(join(root,p),c,{mode:0o600});}try{return fn(root);}finally{rmSync(root,{recursive:true,force:true});}}
test('CASE-M02-G07-01',()=>useCustomization(f=>{const b=manifestFiles().bundle,installer=new SkillInstaller(f.kernel),a=approval(f,installer,b);const r=installer.install(f.a.scope,a.id,{origin,bundle:b});assert.equal(r.bundle_digest,b.digest);assert.deepEqual(r.resources.map(x=>x.path),Object.keys(b.files).sort());assert.equal(r.authority,'guidance_only');}));
test('CASE-M02-G07-02',()=>directory(root=>{const outside=mkdtempSync(join(tmpdir(),'rifare-outside-'));writeFileSync(join(outside,'secret.txt'),'private');try{symlinkSync(join(outside,'secret.txt'),join(root,'assets-link.txt'));assert.throws(()=>readInstructionDirectory(root),/RESOURCE_DENIED/);}finally{rmSync(outside,{recursive:true,force:true});}}));
test('CASE-M02-G07-03',()=>useCustomization(f=>{const b=manifestFiles().bundle,i=new SkillInstaller(f.kernel),a=approval(f,i,b);i.install(f.a.scope,a.id,{origin,bundle:b});const saved=JSON.parse(f.db.prepare('SELECT bundle FROM commerce_skills WHERE tenant_id=? AND store_id=? AND id=?').get(f.a.tenant,f.a.store,b.id).bundle as string);saved.files['references/guide.md']='tampered';f.db.prepare('UPDATE commerce_skills SET bundle=? WHERE tenant_id=? AND store_id=? AND id=?').run(JSON.stringify(saved),f.a.tenant,f.a.store,b.id);assert.throws(()=>f.reads.skills.read(f.a.scope,b.id,'SKILL.md'));}));
test('M02-G07-UNAPPROVED-V2-BLOCKED',()=>useCustomization(f=>{assert.throws(()=>f.reads.skills.install(f.a.scope,manifestFiles().bundle),/SKILL_APPROVAL_REQUIRED/);}));
test('M02-G07-ORIGIN-REQUIRES-EXACT-APPROVAL',()=>useCustomization(f=>{const b=manifestFiles().bundle,i=new SkillInstaller(f.kernel),a=approval(f,i,b);assert.throws(()=>i.install(f.a.scope,a.id,{origin:'https://other.invalid/skills',bundle:b}),/SKILL_APPROVAL_REQUIRED/);}));
test('M02-G07-EXPIRED-APPROVAL',()=>useCustomization(f=>{const b=manifestFiles().bundle,i=new SkillInstaller(f.kernel),a=approval(f,i,b);f.advance(60001);assert.throws(()=>i.install(f.a.scope,a.id,{origin,bundle:b}),/SKILL_APPROVAL_REQUIRED/);}));
test('M02-G07-REVOKED-INSTALLED-CONTENT-BLOCKED',()=>useCustomization(f=>{const b=manifestFiles().bundle,i=new SkillInstaller(f.kernel),a=approval(f,i,b);i.install(f.a.scope,a.id,{origin,bundle:b});i.revoke(f.owner.scope,a.id);assert.throws(()=>f.reads.skills.describe(f.a.scope,b.id),/SKILL_APPROVAL_REQUIRED/);}));
test('M02-G07-AGENT-CANNOT-APPROVE',()=>useCustomization(f=>{assert.throws(()=>new SkillInstaller(f.kernel).approve(f.agent.scope,{}),/ACCESS_DENIED/);}));
test('M02-G07-OPERATOR-CANNOT-SELF-APPROVE',()=>useCustomization(f=>{assert.throws(()=>new SkillInstaller(f.kernel).approve(f.a.scope,{}),/ACCESS_DENIED/);}));
test('M02-G07-CROSS-TENANT-APPROVAL',()=>useCustomization(f=>{const b=manifestFiles().bundle,i=new SkillInstaller(f.kernel),a=approval(f,i,b);assert.throws(()=>i.install(f.b.scope,a.id,{origin,bundle:b}),/SKILL_APPROVAL_REQUIRED/);}));
test('M02-G07-GZIP-JSON-ROUNDTRIP',()=>{const f=manifestFiles(),r=decodeSkillPackage(gzipSync(packageBytes(f.files)),'gzip-json');assert.equal(r.bundle.digest,f.bundle.digest);assert.equal(r.origin,origin);});
test('M02-G07-EXPANSION-LIMIT',()=>{const data=gzipSync(Buffer.from('x'.repeat(300000)));assert.throws(()=>decodeSkillPackage(data,'gzip-json'),/PACKAGE_LIMIT/);});
test('M02-G07-NO-TAR-OR-ZIP-EXTRACTOR',()=>{assert.throws(()=>decodeSkillPackage(Buffer.from('PK'),'zip' as any),/PACKAGE_FORMAT/);});
test('M02-G07-PACKAGE-TRAVERSAL-NOT-WRITTEN',()=>{const f=manifestFiles();f.files['../outside.txt']='untrusted';assert.throws(()=>decodeSkillPackage(packageBytes(f.files),'json'));});
test('M02-G07-PACKAGE-SCRIPT-NOT-EXECUTED',()=>{const f=manifestFiles();f.files['scripts/install.js']='throw new Error("executed")';assert.throws(()=>decodeSkillPackage(packageBytes(f.files),'json'));});
test('M02-G07-DIRECTORY-SNAPSHOT-DIGEST',()=>directory(root=>{const b=readInstructionDirectory(root);assert.equal(b.digest,manifestFiles().bundle.digest);}));
test('M02-G07-DIRECTORY-EXTRA-FILE',()=>directory(root=>{writeFileSync(join(root,'extra.txt'),'unlisted');assert.throws(()=>readInstructionDirectory(root));}));
test('M02-G07-HARDLINK-REJECTED',()=>directory(root=>{linkSync(join(root,'SKILL.md'),join(root,'hardlink.md'));assert.throws(()=>readInstructionDirectory(root),/RESOURCE_DENIED/);}));
test('M02-G07-EXECUTABLE-RESOURCE-REJECTED',()=>directory(root=>{chmodSync(join(root,'references/guide.md'),0o700);assert.throws(()=>readInstructionDirectory(root),/RESOURCE_DENIED/);}));
test('M02-G07-SYMLINKED-DIRECTORY-REJECTED',()=>directory(root=>{const parent=mkdtempSync(join(tmpdir(),'rifare-link-'));try{const alias=join(parent,'alias');symlinkSync(root,alias);assert.throws(()=>readInstructionDirectory(alias),/RESOURCE_DENIED/);}finally{rmSync(parent,{recursive:true,force:true});}}));
test('M02-G07-NO-ACCESSOR-PACKAGE',()=>useCustomization(f=>{const b=manifestFiles().bundle,i=new SkillInstaller(f.kernel),a=approval(f,i,b);let accessed=false;Object.defineProperty(b.files,'assets/exfil.txt',{get(){accessed=true;return 'private';},enumerable:true});assert.throws(()=>i.install(f.a.scope,a.id,{origin,bundle:b}));assert.equal(accessed,false);}));
test('M02-G07-DECLARED-RESOURCE-SYMLINK-BLOCKED',()=>directory(root=>{
  const outside=mkdtempSync(join(tmpdir(),'rifare-declared-link-'));
  try{const target=join(outside,'guide.md');writeFileSync(target,manifestFiles().files['references/guide.md']);rmSync(join(root,'references/guide.md'));symlinkSync(target,join(root,'references/guide.md'));assert.throws(()=>readInstructionDirectory(root),/RESOURCE_DENIED/);}
  finally{rmSync(outside,{recursive:true,force:true});}
}));
