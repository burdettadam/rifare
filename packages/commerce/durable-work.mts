import { CommerceKernel,id,integer,token } from './kernel.mts';
import type { Scope,Row } from './kernel.mts';
import { operationRow,transitionOperation,BusinessOperations,blockingOperation } from './operation-store.mts';
import { SyntheticJournal,JOURNAL_CONTRACT } from '../adapters/reliability/synthetic-journal.mts';

export const MAX_OPERATION_ATTEMPTS=3;
export const retryDelay=(attempt:number)=>Math.min(1000*2**(integer(attempt,1)-1),30000);
export function verifyJournal(s:Row,journal:SyntheticJournal){
  if(!(journal instanceof SyntheticJournal)||journal.contract!==JOURNAL_CONTRACT||journal.tenant!==s.tenant_id||journal.store!==s.store_id)throw new Error('JOURNAL_SCOPE_CONFLICT');
}
export function appliedResult(input:any,op:Row){
  return !!input&&input.kind==='applied'&&input.operation_id===op.id&&input.payload_hash===op.payload_hash
    &&input.outcome==='synthetic_recorded'&&typeof input.provider_ref==='string'&&/^remote_[a-f0-9]{40}$/.test(input.provider_ref);
}
export class DurableWork {
  #k:CommerceKernel;constructor(kernel:CommerceKernel){this.#k=kernel;}
  #auth(scope:Scope,opId:string){const k=this.#k,s=k.require(scope),op=operationRow(k,s,opId);k.authorize(scope,'operation.dispatch',op.resource_id);return {s,op};}
  bind(scope:Scope,operationId:string,journal:SyntheticJournal){const k=this.#k;return k.transaction(()=>{
    const {s,op}=this.#auth(scope,operationId);verifyJournal(s,journal);
    const target=k.db.prepare('SELECT * FROM commerce_operation_targets WHERE tenant_id=? AND store_id=? AND operation_id=?').get(s.tenant_id,s.store_id,op.id) as Row;
    if(target){if(target.provider_id!==journal.providerId||target.provider_identity!==journal.identity||target.contract!==journal.contract)throw new Error('SOURCE_CHANGED');}
    else {if(this.#work(s,op.id).attempts!==0)throw new Error('SOURCE_UNBOUND');
      k.db.prepare('INSERT INTO commerce_operation_targets VALUES(?,?,?,?,?,?)').run(s.tenant_id,s.store_id,op.id,journal.providerId,journal.identity,journal.contract);}
    return {provider_id:journal.providerId,provider_identity:journal.identity,contract:journal.contract};
  });}
  #work(s:Row,opId:string){const row=this.#k.db.prepare('SELECT * FROM commerce_operation_work WHERE tenant_id=? AND store_id=? AND operation_id=?').get(s.tenant_id,s.store_id,opId) as Row;
    if(!row)throw new Error('WORK_NOT_FOUND');return row;}
  #recover(s:Row,op:Row,w:Row){const k=this.#k;
    if(['leased','sending'].includes(w.state)&&w.lease_until<=k.clock()){
      if(w.state==='sending'){
        k.db.prepare("UPDATE commerce_operation_work SET state='unknown',lease_token=NULL,lease_until=NULL,owner=NULL,last_code='LEASE_EXPIRED_AFTER_SEND' WHERE tenant_id=? AND store_id=? AND operation_id=?").run(s.tenant_id,s.store_id,op.id);
        transitionOperation(k,s,op.id,'unknown','outcome_unknown');
      }else{
        const exhausted=w.attempts>=MAX_OPERATION_ATTEMPTS;
        k.db.prepare('UPDATE commerce_operation_work SET state=?,lease_token=NULL,lease_until=NULL,owner=NULL,last_code=?,available_at=? WHERE tenant_id=? AND store_id=? AND operation_id=?')
          .run(exhausted?'dead':'pending',exhausted?'RETRY_EXHAUSTED':'LEASE_RECOVERED',k.clock(),s.tenant_id,s.store_id,op.id);
        transitionOperation(k,s,op.id,exhausted?'failed':'queued',exhausted?'retry_exhausted':'lease_recovered');
      }
    }
  }
  recover(scope:Scope,operationId:string){const k=this.#k;return k.transaction(()=>{const {s,op}=this.#auth(scope,operationId);this.#recover(s,op,this.#work(s,op.id));return new BusinessOperations(k).read(scope,op.id);});}
  claim(scope:Scope,operationId:string,leaseMs=10000){integer(leaseMs,10);if(leaseMs>30000)throw new Error('INVALID_INPUT');
    const k=this.#k;return k.transaction(()=>{const {s,op}=this.#auth(scope,operationId);this.#recover(s,op,this.#work(s,op.id));
      const w=this.#work(s,op.id);if(!['pending','retry_wait'].includes(w.state)||w.available_at>k.clock()||w.attempts>=MAX_OPERATION_ATTEMPTS||blockingOperation(k,s,op)!==null)return null;
      const lease='lease_'+token().slice(0,32),until=k.clock()+leaseMs;
      k.db.prepare("UPDATE commerce_operation_work SET state='leased',attempts=attempts+1,lease_token=?,lease_until=?,owner=? WHERE tenant_id=? AND store_id=? AND operation_id=?")
        .run(lease,until,s.actor_id,s.tenant_id,s.store_id,op.id);
      return {operation_id:op.id,lease_token:lease,lease_until:until,attempt:w.attempts+1};});}
  beginSend(scope:Scope,operationId:string,lease:string){const k=this.#k;id(lease);return k.transaction(()=>{
    const {s,op}=this.#auth(scope,operationId),w=this.#work(s,op.id);this.#lease(s,w,lease,'leased');
    k.db.prepare("UPDATE commerce_operation_work SET state='sending' WHERE tenant_id=? AND store_id=? AND operation_id=?").run(s.tenant_id,s.store_id,op.id);
    const target=k.db.prepare('SELECT provider_identity FROM commerce_operation_targets WHERE tenant_id=? AND store_id=? AND operation_id=?').get(s.tenant_id,s.store_id,op.id) as Row;
    if(!target)throw new Error('SOURCE_UNBOUND');
    transitionOperation(k,s,op.id,'sending','dispatch_started',null);
    return {tenant_id:s.tenant_id,store_id:s.store_id,operation_id:op.id,payload_hash:op.payload_hash,command:JSON.parse(op.command)};
  });}
  #lease(s:Row,w:Row,lease:string,state='sending'){
    if(w.state!==state||w.lease_token!==lease||w.owner!==s.actor_id||w.lease_until<=this.#k.clock())throw new Error('LEASE_UNAVAILABLE');
  }
  finish(scope:Scope,operationId:string,lease:string,response:unknown){const k=this.#k;id(lease);return k.transaction(()=>{
    const {s,op}=this.#auth(scope,operationId),w=this.#work(s,op.id);this.#lease(s,w,lease);
    const r=response as Row;let state='unknown',opState='unknown',code='outcome_unknown',last='OUTCOME_UNKNOWN',ref:string|null=null,at=k.clock();
    if(appliedResult(r,op)){state='done';opState='succeeded';code='source_confirmed';last='SYNTHETIC_RECORDED';ref=r.provider_ref;}
    else if(r?.kind==='not_sent'&&r.code==='synthetic_transport_unavailable'){
      const exhausted=w.attempts>=MAX_OPERATION_ATTEMPTS;state=exhausted?'dead':'retry_wait';opState=exhausted?'failed':'retry_wait';
      code=exhausted?'retry_exhausted':'retry_scheduled';last=exhausted?'RETRY_EXHAUSTED':'KNOWN_NOT_SENT';at+=retryDelay(w.attempts);
    }else if(r?.kind==='rejected'&&r.code==='synthetic_rejected'){state='dead';opState='failed';code='provider_rejected';last='PROVIDER_REJECTED';}
    k.db.prepare('UPDATE commerce_operation_work SET state=?,available_at=?,lease_token=NULL,lease_until=NULL,owner=NULL,last_code=? WHERE tenant_id=? AND store_id=? AND operation_id=?')
      .run(state,at,last,s.tenant_id,s.store_id,op.id);
    transitionOperation(k,s,op.id,opState,code,ref);return new BusinessOperations(k).read(scope,op.id);
  });}
  async dispatch(scope:Scope,operationId:string,journal:SyntheticJournal,options={lease_ms:10000,timeout_ms:1000}){
    integer(options.timeout_ms,1);integer(options.lease_ms,10);
    if(options.timeout_ms>=options.lease_ms||options.timeout_ms>5000)throw new Error('INVALID_INPUT');
    const s=this.#k.require(scope);verifyJournal(s,journal);this.bind(scope,operationId,journal);const claim=this.claim(scope,operationId,options.lease_ms);
    if(!claim)return new BusinessOperations(this.#k).read(scope,operationId);
    const command=this.beginSend(scope,operationId,claim.lease_token);let timer:ReturnType<typeof setTimeout>|undefined,response:unknown;
    try{response=await Promise.race([Promise.resolve().then(()=>journal.send(command)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('RESPONSE_TIMEOUT')),options.timeout_ms);})]);}
    catch{response={kind:'unknown'};}finally{if(timer)clearTimeout(timer);}
    return this.finish(scope,operationId,claim.lease_token,response);
  }
}
