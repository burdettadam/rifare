import { CommerceKernel,exact,id,integer,token } from './kernel.mts';
import type { Scope,Row } from './kernel.mts';
import { SecretVault } from './secrets.mts';
import { assertExecution,controlEvent } from './execution-stops.mts';

export class CredentialLifecycle {
  #k:CommerceKernel;#vault:SecretVault;
  constructor(k:CommerceKernel,vault:SecretVault){this.#k=k;this.#vault=vault;}
  #row(s:Row,slotId:string){id(slotId);const row=this.#k.db.prepare('SELECT * FROM commerce_credential_slots WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,slotId) as Row;
    if(!row||!row.active)throw new Error('CREDENTIAL_UNAVAILABLE');return row;}
  #version(s:Row,slot:Row){const v=this.#k.db.prepare('SELECT * FROM commerce_credential_versions WHERE tenant_id=? AND store_id=? AND slot_id=? AND version=?').get(s.tenant_id,s.store_id,slot.id,slot.version) as Row;
    const secret=v&&this.#k.db.prepare('SELECT revoked FROM commerce_secrets WHERE tenant_id=? AND store_id=? AND ref=?').get(s.tenant_id,s.store_id,v.secret_ref) as Row;
    if(!v||!secret||secret.revoked)throw new Error('CREDENTIAL_UNAVAILABLE');return v;}
  configure(scope:Scope,input:unknown){const k=this.#k,p=exact(input,['slot_id','provider','adapter','value','expected_revision']);id(p.slot_id);id(p.provider);id(p.adapter);integer(p.expected_revision);
    return k.transaction(()=>{
      const s=k.authorize(scope,'secret.manage'),old=k.db.prepare('SELECT * FROM commerce_credential_slots WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,p.slot_id) as Row;
      if((old?.revision??0)!==p.expected_revision)throw new Error('CREDENTIAL_CHANGED');
      if(old&&(old.provider!==p.provider||old.adapter!==p.adapter))throw new Error('CREDENTIAL_TARGET_CHANGED');
      const secret=this.#vault.put(scope,{provider:p.provider,adapter:p.adapter,value:p.value}),version=(old?.version??0)+1,revision=p.expected_revision+1;
      if(old){k.db.prepare(`UPDATE commerce_secrets SET revoked=1 WHERE tenant_id=? AND store_id=? AND ref IN (SELECT secret_ref FROM commerce_credential_versions WHERE tenant_id=? AND store_id=? AND slot_id=?)`).run(s.tenant_id,s.store_id,s.tenant_id,s.store_id,p.slot_id);}
      k.db.prepare(`INSERT INTO commerce_credential_slots VALUES(?,?,?,?,?,?,?,1) ON CONFLICT(tenant_id,store_id,id) DO UPDATE SET version=excluded.version,revision=excluded.revision,active=1`).run(s.tenant_id,s.store_id,p.slot_id,p.provider,p.adapter,version,revision);
      k.db.prepare('INSERT INTO commerce_credential_versions VALUES(?,?,?,?,?,?)').run(s.tenant_id,s.store_id,p.slot_id,version,secret.ref,k.clock());
      controlEvent(k,s,'credential_cutover',p.slot_id,version);return {slot_id:p.slot_id,version,revision,old_versions_revoked:!!old};
    });
  }
  revoke(scope:Scope,slotId:string,expectedRevision:number){const k=this.#k;integer(expectedRevision,1);return k.transaction(()=>{
    const s=k.authorize(scope,'secret.manage'),slot=this.#row(s,slotId);if(slot.revision!==expectedRevision)throw new Error('CREDENTIAL_CHANGED');
    this.#vault.revoke(scope,this.#version(s,slot).secret_ref);
    k.db.prepare('UPDATE commerce_credential_slots SET active=0,revision=revision+1 WHERE tenant_id=? AND store_id=? AND id=?').run(s.tenant_id,s.store_id,slotId);
    controlEvent(k,s,'credential_revoked',slotId,slot.version);return {revoked:true,revision:slot.revision+1};
  });}
  rewrap(scope:Scope,slotId:string){const k=this.#k;return k.transaction(()=>{
    const s=k.authorize(scope,'secret.manage'),slot=this.#row(s,slotId),v=this.#version(s,slot);
    const result=this.#vault.rewrap(scope,v.secret_ref);return {slot_id:slotId,version:slot.version,key_id:result.key_id};
  });}
  status(scope:Scope,slotId:string){const s=this.#k.authorize(scope,'secret.manage'),slot=this.#row(s,slotId);this.#version(s,slot);
    return {slot_id:slot.id,provider:slot.provider,adapter:slot.adapter,version:slot.version,revision:slot.revision,active:true};}
  async probe(scope:Scope,slotId:string){const k=this.#k;
    const start=k.transaction(()=>{
      const s=k.authorize(scope,'secret.invoke'),slot=this.#row(s,slotId),v=this.#version(s,slot),control=assertExecution(k,s,'credential.probe'),ref='credential_call_'+token().slice(0,24);
      k.db.prepare("INSERT INTO commerce_credential_calls VALUES(?,?,?,?,?,?,'in_flight',?,NULL)").run(s.tenant_id,s.store_id,ref,slot.id,slot.version,slot.revision,k.clock());
      return {s,slot,v,control,ref};
    });
    let configured:boolean|undefined,state='unknown';
    try{
      // No decrypted cache: each request resolves the currently pinned encrypted version.
      const now=this.#row(k.authorize(scope,'secret.invoke'),slotId);if(now.revision!==start.slot.revision)throw new Error('CREDENTIAL_CHANGED');
      assertExecution(k,start.s,'credential.probe',start.control.stamp);
      let timer:ReturnType<typeof setTimeout>|undefined;
      let result:Awaited<ReturnType<SecretVault['probe']>>;
      try{result=await Promise.race([this.#vault.probe(scope,start.v.secret_ref,start.slot.adapter),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('CREDENTIAL_TIMEOUT')),1000);})]);}
      finally{if(timer)clearTimeout(timer);}
      const current=this.#row(k.authorize(scope,'secret.invoke'),slotId);this.#version(start.s,current);
      if(current.version!==start.slot.version||current.revision!==start.slot.revision)throw new Error('CREDENTIAL_CHANGED');
      assertExecution(k,start.s,'credential.probe',start.control.stamp);configured=result.configured;state='succeeded';
    }catch{/* In-flight ambiguity is recorded; upstream errors or keys are never returned. */}
    k.transaction(()=>k.db.prepare('UPDATE commerce_credential_calls SET state=?,finished_at=? WHERE tenant_id=? AND store_id=? AND id=?').run(state,k.clock(),start.s.tenant_id,start.s.store_id,start.ref));
    return {id:start.ref,slot_id:slotId,version:start.slot.version,revision:start.slot.revision,state,configured:state==='succeeded'?configured:null,automatic_retry:false,qualification:'synthetic_probe_only'};
  }
  history(scope:Scope,slotId:string){const k=this.#k,s=k.authorize(scope,'secret.manage');id(slotId);
    return k.db.prepare('SELECT id,slot_id,version,revision,state,started_at,finished_at FROM commerce_credential_calls WHERE tenant_id=? AND store_id=? AND slot_id=? ORDER BY started_at,id LIMIT 100').all(s.tenant_id,s.store_id,slotId);}
}
