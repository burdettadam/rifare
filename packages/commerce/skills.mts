import { permissionDecision } from './authorization.mts';
import { constants, openSync, closeSync, fstatSync, lstatSync, readFileSync } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
import { validateManifest } from './skill-contract.mts';
import { CommerceKernel, digest, exact, id } from './kernel.mts';
import type { Row, Scope } from './kernel.mts';

export type SkillBundle = {id:string; version:string; digest:string; files:Record<string,string>};
export function resourcePath(value: unknown): string {
  if (typeof value !== 'string' || value.length > 200 || !/^[a-zA-Z0-9_./-]+$/.test(value)
    || value.split('/').some(p => !p || p === '.' || p === '..') || value.startsWith('/')) throw new Error('RESOURCE_DENIED');
  return value;
}
function stableFiles(files: Record<string,string>) { return JSON.stringify(Object.keys(files).sort().map(p => [p,digest(files[p])])); }
export function checkedBundle(files: Record<string,string>): SkillBundle {
  if (!files || typeof files !== 'object' || Array.isArray(files) || Object.keys(files).length > 18) throw new Error('INVALID_SKILL');
  for (const [p,content] of Object.entries(files)) {
    resourcePath(p);
    if (typeof content !== 'string' || Buffer.byteLength(content)>65536 || content.includes('\0')) throw new Error('INVALID_SKILL');
  }
  const parsedManifest=JSON.parse(files['commerce-manifest.json']);
  const isV2=parsedManifest.schema_version===2;
  const manifest=isV2?validateManifest(parsedManifest,files).manifest:exact(parsedManifest,['schema_version','id','version','resources']);
  if (![1,2].includes(manifest.schema_version) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.id) || manifest.id.length>64
    || !/^\d+\.\d+\.\d+$/.test(manifest.version) || !Array.isArray(manifest.resources) || manifest.resources.length>16) throw new Error('INVALID_SKILL');
  const resources = manifest.resources.map((p:unknown) => resourcePath(isV2?p.path:p));
  if (new Set(resources).size !== resources.length || resources.some((p:string) => !/^(references|assets)\//.test(p))) throw new Error('INVALID_SKILL');
  const allowed = ['SKILL.md','commerce-manifest.json',...resources].sort();
  if (Object.keys(files).sort().join('\n') !== allowed.join('\n')) throw new Error('INVALID_SKILL');
  const raw = files['SKILL.md'];
  // This minimal loader intentionally supports only the two required scalar fields.
  const parsed = /^---\nname: ([a-z0-9-]+)\ndescription: ([^\n]+)\n---\n([\s\S]+)$/.exec(raw);
  if (!parsed || parsed[1] !== manifest.id || !parsed[2].trim() || parsed[2].length>1024) throw new Error('INVALID_SKILL');
  return {id:manifest.id,version:manifest.version,digest:digest(stableFiles(files)),files:{...files}};
}
function readRegular(root: string, name: string) {
  const file = join(root, resourcePath(name)); let current=file;
  while (true) { if (lstatSync(current).isSymbolicLink()) throw new Error('RESOURCE_DENIED'); if (current===dirname(current)) break; current=dirname(current); }
  const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  try { const st=fstatSync(fd); if (!st.isFile()||st.nlink!==1||st.size>65536) throw new Error('RESOURCE_DENIED'); return readFileSync(fd,'utf8'); }
  finally { closeSync(fd); }
}
export function loadSkillDirectory(directory: string): SkillBundle {
  const root=resolve(directory),manifestText=readRegular(root,'commerce-manifest.json');
  const raw=JSON.parse(manifestText);
  const manifest=raw.schema_version===2?validateManifest(raw).manifest:exact(raw,['schema_version','id','version','resources']);
  if (manifest.id!==basename(root) || !Array.isArray(manifest.resources) || manifest.resources.length>16) throw new Error('INVALID_SKILL');
  const files:Record<string,string>={'commerce-manifest.json':manifestText,'SKILL.md':readRegular(root,'SKILL.md')};
  for (const entry of manifest.resources) {
    const p=manifest.schema_version===2?entry.path:entry;
    resourcePath(p); if (!/^(references|assets)\//.test(p)) throw new Error('RESOURCE_DENIED'); files[p]=readRegular(root,p);
  }
  return checkedBundle(files);
}
export class Skills {
  #kernel:CommerceKernel;
  constructor(kernel:CommerceKernel){this.#kernel=kernel;}
  install(scope:Scope,bundle:SkillBundle,approvalId?:string) {
    this.#kernel.authorize(scope,'skill.write');
    const s=this.#kernel.require(scope,['operator']); const checked=checkedBundle(bundle.files);
    if (checked.digest!==bundle.digest || checked.id!==bundle.id || checked.version!==bundle.version) throw new Error('INVALID_SKILL');
    const v2=JSON.parse(checked.files['commerce-manifest.json']).schema_version===2;
    const previous=this.#kernel.db.prepare('SELECT 1 FROM commerce_skill_installations WHERE tenant_id=? AND store_id=? AND skill_id=?').get(s.tenant_id,s.store_id,checked.id);
    if(!v2&&previous)throw new Error('SKILL_DOWNGRADE_DENIED');
    if(v2){this.#kernel.authorize(scope,'skill.install');if(!approvalId)throw new Error('SKILL_APPROVAL_REQUIRED');this.#approval(s,checked,approvalId);}
    this.#kernel.transaction(()=>{
    this.#kernel.db.prepare(`INSERT INTO commerce_skills VALUES(?,?,?,?,?) ON CONFLICT(tenant_id,store_id,id)
      DO UPDATE SET bundle_digest=excluded.bundle_digest,bundle=excluded.bundle`)
      .run(s.tenant_id,s.store_id,checked.id,checked.digest,JSON.stringify(checked));
    this.#kernel.db.prepare('DELETE FROM commerce_skill_installations WHERE tenant_id=? AND store_id=? AND skill_id=?').run(s.tenant_id,s.store_id,checked.id);
    if(v2)this.#kernel.db.prepare('INSERT INTO commerce_skill_installations VALUES(?,?,?,?,?)').run(s.tenant_id,s.store_id,checked.id,approvalId!,checked.digest);
    });
    return this.describe(scope,checked.id);
  }
  #approval(s:Row,b:SkillBundle,approvalId:string){
    id(approvalId);const a=this.#kernel.db.prepare('SELECT * FROM commerce_skill_approvals WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,approvalId) as Row;
    if(!a||a.revoked||a.expires_at<=this.#kernel.clock()||a.bundle_digest!==b.digest||a.skill_id!==b.id||a.version!==b.version)throw new Error('SKILL_APPROVAL_REQUIRED');
    const member=this.#kernel.db.prepare('SELECT * FROM commerce_members WHERE tenant_id=? AND store_id=? AND actor_id=? AND active=1').get(s.tenant_id,s.store_id,a.approver) as Row;
    if(!member||!permissionDecision(this.#kernel.db,member,'skill.approve').allowed)throw new Error('SKILL_APPROVAL_REQUIRED');
  }
  #bundle(scope:Scope,skillId:string):SkillBundle {
    const s=this.#kernel.require(scope); id(skillId);
    const row=this.#kernel.db.prepare('SELECT * FROM commerce_skills WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,skillId) as Row;
    if(!row)throw new Error('NOT_FOUND');
    const saved=JSON.parse(row.bundle),checked=checkedBundle(saved.files);
    if(checked.id!==skillId||checked.digest!==row.bundle_digest||saved.digest!==checked.digest)throw new Error('INVALID_SKILL');
    if(JSON.parse(checked.files['commerce-manifest.json']).schema_version===2){
      const installation=this.#kernel.db.prepare('SELECT * FROM commerce_skill_installations WHERE tenant_id=? AND store_id=? AND skill_id=?').get(s.tenant_id,s.store_id,skillId) as Row;
      if(!installation||installation.bundle_digest!==checked.digest)throw new Error('SKILL_APPROVAL_REQUIRED');this.#approval(s,checked,installation.approval_id);
    }
    return checked;
  }
  describe(scope:Scope,skillId:string) {
    this.#kernel.authorize(scope,'skill.read');
    const b=this.#bundle(scope,skillId);
    return {id:b.id,version:b.version,bundle_digest:b.digest,authority:'guidance_only',
      resources:Object.keys(b.files).sort().map(path=>({path,sha256:digest(b.files[path])}))};
  }
  read(scope:Scope,skillId:string,path:string,expectedDigest?:string) {
    this.#kernel.authorize(scope,'skill.read');
    resourcePath(path); const b=this.#bundle(scope,skillId);
    if(expectedDigest!==undefined&&expectedDigest!==b.digest)throw new Error('SKILL_CHANGED');
    if(!Object.hasOwn(b.files,path))throw new Error('RESOURCE_DENIED');
    return {skill_id:b.id,bundle_digest:b.digest,path,content:b.files[path],sha256:digest(b.files[path]),authority:'guidance_only'};
  }
  remove(scope:Scope,skillId:string){this.#kernel.authorize(scope,'skill.write');const s=this.#kernel.require(scope,['operator']);id(skillId);
    this.#kernel.db.prepare('DELETE FROM commerce_skills WHERE tenant_id=? AND store_id=? AND id=?').run(s.tenant_id,s.store_id,skillId);}
}
