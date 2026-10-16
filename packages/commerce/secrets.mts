import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { constants, openSync, closeSync, fstatSync, lstatSync, readFileSync } from 'node:fs';
import { resolve, relative, dirname, isAbsolute, sep } from 'node:path';
import { CommerceKernel, exact, id, token } from './kernel.mts';
import type { Row, Scope } from './kernel.mts';

export type Keyring = {activeId: string; get:(keyId:string)=>Buffer|undefined};
type Box = {iv:string;body:string;tag:string};
type Probe = (credential:Buffer)=>Promise<boolean>|boolean;
function box(key:Buffer,plaintext:Buffer,aad:string): Box {
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv,{authTagLength:16});
  cipher.setAAD(Buffer.from(aad));
  const encrypted=Buffer.concat([cipher.update(plaintext),cipher.final()]);
  return {iv:iv.toString('base64'),body:encrypted.toString('base64'),tag:cipher.getAuthTag().toString('base64')};
}
function base64(value:unknown):Buffer {
  if(typeof value!=='string'||value.length>24000) throw new Error('SECRET_UNAVAILABLE');
  const decoded=Buffer.from(value,'base64');if(decoded.toString('base64')!==value) throw new Error('SECRET_UNAVAILABLE');return decoded;
}
function unbox(key:Buffer,record:unknown,aad:string) {
  const r=exact(record,['iv','body','tag']);const iv=base64(r.iv),tag=base64(r.tag),body=base64(r.body);
  if(iv.length!==12||tag.length!==16) throw new Error('SECRET_UNAVAILABLE');
  const decipher=createDecipheriv('aes-256-gcm',key,iv,{authTagLength:16});
  decipher.setAAD(Buffer.from(aad));decipher.setAuthTag(tag);
  const partial=decipher.update(body);
  try {return Buffer.concat([partial,decipher.final()]);} finally {partial.fill(0);}
}
export function readWrappingKey(path:string,repositoryRoot:string):Buffer {
  let fd:number|undefined;
  try {
    const absolute=resolve(path),rel=relative(resolve(repositoryRoot),absolute);
    if(rel==='' || (rel!=='..' && !rel.startsWith('..'+sep) && !isAbsolute(rel))) throw new Error('KEY_UNAVAILABLE');
    let current=absolute;
    while(current!==dirname(current)){if(lstatSync(current).isSymbolicLink())throw new Error('KEY_UNAVAILABLE');current=dirname(current);}
    fd=openSync(absolute,constants.O_RDONLY|constants.O_NOFOLLOW);
    const st=fstatSync(fd);
    if(!st.isFile()||st.nlink!==1||st.size!==32||![0o400,0o600].includes(st.mode&0o777)
      ||(process.getuid && st.uid!==process.getuid())) throw new Error('KEY_UNAVAILABLE');
    return readFileSync(fd);
  } catch {throw new Error('KEY_UNAVAILABLE');}
  finally {if(fd!==undefined)closeSync(fd);}
}

export class SecretVault {
  #kernel: CommerceKernel;
  #keys:Keyring;
  #adapters:Map<string,Probe>;
  constructor(kernel:CommerceKernel,keys:Keyring,adapters:Record<string,Probe>) {
    this.#kernel=kernel;this.#keys=keys;this.#adapters=new Map(Object.entries(adapters));
    for(const [name,probe] of this.#adapters){id(name);if(typeof probe!=='function')throw new Error('INVALID_INPUT');}
  }
  #key(keyId:string):Buffer {
    try {id(keyId);const key=this.#keys.get(keyId);if(!Buffer.isBuffer(key)||key.length!==32)throw new Error();return Buffer.from(key);}
    catch {throw new Error('SECRET_UNAVAILABLE');}
  }
  #aad(s:Row,ref:string,provider:string,adapter:string) {return JSON.stringify(['rifare-secret-v1',s.tenant_id,s.store_id,ref,provider,adapter]);}
  #row(scope:Scope,ref:string):Row {
    const s=this.#kernel.require(scope,['operator','worker']);id(ref);
    const row=this.#kernel.db.prepare('SELECT * FROM commerce_secrets WHERE tenant_id=? AND store_id=? AND ref=? AND revoked=0')
      .get(s.tenant_id,s.store_id,ref) as Row;
    if(!row)throw new Error('SECRET_UNAVAILABLE');return row;
  }
  put(scope:Scope,input:unknown) {
    const s=this.#kernel.require(scope,['operator']),r=exact(input,['provider','adapter','value']);id(r.provider);id(r.adapter);
    if(!this.#adapters.has(r.adapter)||typeof r.value!=='string'||!r.value.length||Buffer.byteLength(r.value)>4096) throw new Error('INVALID_INPUT');
    const keyId=this.#keys.activeId, kek=this.#key(keyId),dek=randomBytes(32),plaintext=Buffer.from(r.value);
    const ref='sec_'+token(),aad=this.#aad(s,ref,r.provider,r.adapter);
    try {
      const envelope={version:1,key:box(kek,dek,aad+':key:'+keyId),data:box(dek,plaintext,aad+':data')};
      this.#kernel.db.prepare('INSERT INTO commerce_secrets VALUES(?,?,?,?,?,?,?,?,0)')
        .run(s.tenant_id,s.store_id,ref,r.provider,r.adapter,keyId,JSON.stringify(envelope),this.#kernel.clock());
      return {ref,provider:r.provider,adapter:r.adapter};
    } finally {kek.fill(0);dek.fill(0);plaintext.fill(0);}
  }
  list(scope:Scope) {
    const s=this.#kernel.require(scope,['operator']);
    return this.#kernel.db.prepare('SELECT ref,provider,adapter,created_at FROM commerce_secrets WHERE tenant_id=? AND store_id=? AND revoked=0 ORDER BY ref')
      .all(s.tenant_id,s.store_id);
  }
  revoke(scope:Scope,ref:string) {
    const s=this.#kernel.require(scope,['operator']);this.#row(scope,ref);
    this.#kernel.db.prepare('UPDATE commerce_secrets SET revoked=1 WHERE tenant_id=? AND store_id=? AND ref=?').run(s.tenant_id,s.store_id,ref);
    return {revoked:true};
  }
  async probe(scope:Scope,ref:string,adapter:string) {
    let plaintext:Buffer|undefined, dek:Buffer|undefined, kek:Buffer|undefined;
    const s=this.#kernel.require(scope,['operator','worker']);const row=this.#row(scope,ref);
    if(row.adapter!==adapter||!this.#adapters.has(adapter))throw new Error('SECRET_UNAVAILABLE');
    try {
      kek=this.#key(row.key_id);const env=exact(JSON.parse(row.envelope),['version','key','data']);
      if(env.version!==1)throw new Error('SECRET_UNAVAILABLE');
      const aad=this.#aad(s,ref,row.provider,row.adapter);
      dek=unbox(kek,env.key,aad+':key:'+row.key_id);if(dek.length!==32)throw new Error('SECRET_UNAVAILABLE');
      plaintext=unbox(dek,env.data,aad+':data');
    } catch {kek?.fill(0);dek?.fill(0);plaintext?.fill(0);throw new Error('SECRET_UNAVAILABLE');}
    try {
      const configured=await this.#adapters.get(adapter)!(plaintext!);
      this.#kernel.require(scope,['operator','worker']);this.#row(scope,ref);
      if(typeof configured!=='boolean')throw new Error('ADAPTER_UNAVAILABLE');
      return {adapter,configured,qualification:'synthetic_probe_only'};
    } catch {throw new Error('ADAPTER_UNAVAILABLE');}
    finally {kek?.fill(0);dek?.fill(0);plaintext?.fill(0);}
  }
  rewrap(scope:Scope,ref:string) {
    const s=this.#kernel.require(scope,['operator']);
    return this.#kernel.transaction(()=>{
      const row=this.#row(scope,ref),newId=this.#keys.activeId;
      let oldKey:Buffer|undefined,newKey:Buffer|undefined,dek:Buffer|undefined;
      try {
        oldKey=this.#key(row.key_id);newKey=this.#key(newId);const env=exact(JSON.parse(row.envelope),['version','key','data']);
        if(env.version!==1)throw new Error('SECRET_UNAVAILABLE');
        const aad=this.#aad(s,ref,row.provider,row.adapter);
        dek=unbox(oldKey,env.key,aad+':key:'+row.key_id);if(dek.length!==32)throw new Error('SECRET_UNAVAILABLE');
        env.key=box(newKey,dek,aad+':key:'+newId);
        this.#kernel.db.prepare('UPDATE commerce_secrets SET key_id=?,envelope=? WHERE tenant_id=? AND store_id=? AND ref=?')
          .run(newId,JSON.stringify(env),s.tenant_id,s.store_id,ref);return {ref,key_id:newId};
      } catch {throw new Error('SECRET_UNAVAILABLE');}
      finally {oldKey?.fill(0);newKey?.fill(0);dek?.fill(0);}
    });
  }
}
