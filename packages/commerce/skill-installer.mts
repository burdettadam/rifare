import { constants,openSync,closeSync,fstatSync,lstatSync,readdirSync,readSync } from 'node:fs';
import { resolve,join,dirname } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { CommerceKernel,exact,id,integer,token } from './kernel.mts';
import type { Scope } from './kernel.mts';
import type { SkillBundle } from './skills.mts';
import { Skills,checkedBundle,resourcePath } from './skills.mts';
import { jsonValue,invalid } from './configuration-values.mts';

const MAX_BYTES=196608;
function originValue(value:unknown){
  if(typeof value!=='string'||value.length>300)invalid('origin','INVALID');
  let u:URL;try{u=new URL(value);}catch{invalid('origin','INVALID');}
  if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)invalid('origin','INVALID');
  return u.href;
}
function vetted(files:unknown):SkillBundle {
  const map=jsonValue(files,MAX_BYTES);const bundle=checkedBundle(map);
  if(JSON.parse(bundle.files['commerce-manifest.json']).schema_version!==2)throw new Error('MANIFEST_V2_REQUIRED');
  return bundle;
}
export function decodeSkillPackage(bytes:Buffer,encoding:'json'|'gzip-json'){
  if(!Buffer.isBuffer(bytes)||bytes.length>MAX_BYTES)throw new Error('PACKAGE_LIMIT');
  if(!['json','gzip-json'].includes(encoding))throw new Error('PACKAGE_FORMAT');
  let raw:Buffer;try{raw=encoding==='json'?bytes:gunzipSync(bytes,{maxOutputLength:MAX_BYTES});}catch{throw new Error('PACKAGE_LIMIT');}
  if(raw.length>MAX_BYTES)throw new Error('PACKAGE_LIMIT');
  let envelope:any;try{envelope=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(raw));}catch{throw new Error('PACKAGE_FORMAT');}
  const r=exact(envelope,['format','origin','files']);if(r.format!=='rifare-instruction-bundle-v1')throw new Error('PACKAGE_FORMAT');
  return {origin:originValue(r.origin),bundle:vetted(r.files)};
}
export function readInstructionDirectory(directory:string){
  const root=resolve(directory);let ancestor=root;
  while(true){if(lstatSync(ancestor).isSymbolicLink())throw new Error('RESOURCE_DENIED');if(ancestor===dirname(ancestor))break;ancestor=dirname(ancestor);}
  const files:Record<string,string>=Object.create(null);let bytes=0,entries=0;
  function walk(dir:string,prefix:string,depth:number){
    if(depth>4)throw new Error('PACKAGE_LIMIT');
    for(const name of readdirSync(dir).sort()){
      if(++entries>32)throw new Error('PACKAGE_LIMIT');
      const relative=resourcePath(prefix+name),path=join(dir,name),stat=lstatSync(path);
      if(stat.isSymbolicLink())throw new Error('RESOURCE_DENIED');
      if(stat.isDirectory()){walk(path,relative+'/',depth+1);continue;}
      if(!stat.isFile()||stat.nlink!==1||stat.size>65536||(stat.mode&0o111)!==0)throw new Error('RESOURCE_DENIED');
      let parent=dirname(path);while(true){if(lstatSync(parent).isSymbolicLink())throw new Error('RESOURCE_DENIED');if(parent===root)break;parent=dirname(parent);}
      const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
      try{const st=fstatSync(fd);if(!st.isFile()||st.nlink!==1||st.ino!==stat.ino||st.dev!==stat.dev||(st.mode&0o111)!==0)throw new Error('RESOURCE_DENIED');
        const raw=Buffer.alloc(65537);let length=0;
        while(length<raw.length){const count=readSync(fd,raw,length,raw.length-length,null);if(!count)break;length+=count;}
        bytes+=length;if(length>65536||bytes>MAX_BYTES)throw new Error('PACKAGE_LIMIT');
        files[relative]=new TextDecoder('utf8',{fatal:true}).decode(raw.subarray(0,length));
      }finally{closeSync(fd);}
    }
  }
  walk(root,'',0);return vetted(files);
}
export class SkillInstaller {
  #k:CommerceKernel;#skills:Skills;
  constructor(kernel:CommerceKernel,skills=new Skills(kernel)){this.#k=kernel;this.#skills=skills;}
  approve(scope:Scope,input:unknown){
    const k=this.#k,s=k.authorize(scope,'skill.approve'),r=exact(jsonValue(input),['origin','bundle_digest','skill_id','version','expires_at']);
    const origin=originValue(r.origin);id(r.skill_id);integer(r.expires_at);
    if(!/^[a-f0-9]{64}$/.test(r.bundle_digest)||typeof r.version!=='string'||!/^\d+\.\d+\.\d+$/.test(r.version))throw new Error('INVALID_INPUT');
    if(r.expires_at<=k.clock()||r.expires_at>k.clock()+30*86400000)throw new Error('INVALID_INPUT');
    const ref='approval_'+token().slice(0,32);
    k.db.prepare('INSERT INTO commerce_skill_approvals VALUES(?,?,?,?,?,?,?,?,?,0)').run(s.tenant_id,s.store_id,ref,origin,r.bundle_digest,r.skill_id,r.version,r.expires_at,s.actor_id);
    k.audit(scope,'skill_approval','allowed');return {id:ref,expires_at:r.expires_at,origin,execution_authorized:false};
  }
  install(scope:Scope,approvalId:string,input:{origin:string;bundle:SkillBundle}){
    const s=this.#k.authorize(scope,'skill.install');id(approvalId);
    const r=exact(jsonValue(input),['origin','bundle']),origin=originValue(r.origin),bundle=vetted(r.bundle.files);
    if(bundle.digest!==r.bundle.digest||bundle.id!==r.bundle.id||bundle.version!==r.bundle.version)throw new Error('INVALID_SKILL');
    const approval=this.#k.db.prepare('SELECT origin FROM commerce_skill_approvals WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,approvalId);
    if(!approval||approval.origin!==origin)throw new Error('SKILL_APPROVAL_REQUIRED');
    return this.#skills.install(scope,bundle,approvalId);
  }
  revoke(scope:Scope,approvalId:string){const k=this.#k,s=k.authorize(scope,'skill.approve');id(approvalId);
    const change=k.db.prepare('UPDATE commerce_skill_approvals SET revoked=1 WHERE tenant_id=? AND store_id=? AND id=?').run(s.tenant_id,s.store_id,approvalId);
    if(!change.changes)throw new Error('NOT_FOUND');k.audit(scope,'skill_revocation','allowed');return {revoked:true};}
}
