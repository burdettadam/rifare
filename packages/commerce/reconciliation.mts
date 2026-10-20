import { CommerceKernel,id,integer,token } from './kernel.mts';
import type { Scope,Row } from './kernel.mts';
import { operationRow,transitionOperation,BusinessOperations } from './operation-store.mts';
import { SyntheticJournal } from '../adapters/reliability/synthetic-journal.mts';
import { appliedResult,verifyJournal } from './durable-work.mts';
import {loyaltyOperationRecord} from './loyalty-redemption-records.mts';
import {dropoffOperationRecord} from './dropoff-credential-records.mts';

export class Reconciliation {
  #k:CommerceKernel;constructor(kernel:CommerceKernel){this.#k=kernel;}
  #drift(s:Row,operationId:string,code:string,sourceRef:string){this.#k.db.prepare('INSERT OR IGNORE INTO commerce_reconciliation_drift VALUES(?,?,?,?,?,?)')
    .run(s.tenant_id,s.store_id,operationId,code,sourceRef,this.#k.clock());}
  #repair(scope:Scope,s:Row,input:Row,journal:SyntheticJournal){const k=this.#k;id(input.operation_id);
    const op=k.db.prepare('SELECT * FROM commerce_operations WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,input.operation_id) as Row;
    if(!op){this.#drift(s,input.operation_id,'UNMAPPED_SOURCE','unmapped');return 'unmapped';}
    if(loyaltyOperationRecord(k,s,op.id))throw new Error('LOYALTY_DEDICATED_OWNER_REQUIRED');if(dropoffOperationRecord(k,s,op.id))throw new Error('DROPOFF_DEDICATED_OWNER_REQUIRED');
    k.authorize(scope,'operation.reconcile',op.resource_id);operationRow(k,s,op.id);
    const target=k.db.prepare('SELECT * FROM commerce_operation_targets WHERE tenant_id=? AND store_id=? AND operation_id=?').get(s.tenant_id,s.store_id,op.id) as Row;
    if(!target||target.provider_identity!==journal.identity||target.provider_id!==journal.providerId||target.contract!==journal.contract){this.#drift(s,op.id,'SOURCE_BINDING_CONFLICT',journal.identity);return 'conflict';}
    if(!appliedResult(input,op)){this.#drift(s,op.id,'SOURCE_CONFLICT','mismatch');return 'conflict';}
    if(op.state==='succeeded'){
      if(op.provider_ref!==input.provider_ref){this.#drift(s,op.id,'SOURCE_CONFLICT','reference');return 'conflict';}
      return 'unchanged';
    }
    // A failed, definitely-unsent or never-dispatched action is a discrepancy, not permission to assert success.
    if(!['sending','unknown'].includes(op.state)){this.#drift(s,op.id,'UNEXPECTED_SOURCE_EFFECT',input.provider_ref);return 'conflict';}
    k.db.prepare("UPDATE commerce_operation_work SET state='done',lease_token=NULL,lease_until=NULL,owner=NULL,last_code='RECONCILED' WHERE tenant_id=? AND store_id=? AND operation_id=?").run(s.tenant_id,s.store_id,op.id);
    transitionOperation(k,s,op.id,'succeeded','source_confirmed',input.provider_ref);return 'repaired';
  }
  async one(scope:Scope,operationId:string,journal:SyntheticJournal){const k=this.#k,s=k.require(scope),op=operationRow(k,s,operationId);if(loyaltyOperationRecord(k,s,op.id))throw new Error('LOYALTY_DEDICATED_OWNER_REQUIRED');if(dropoffOperationRecord(k,s,op.id))throw new Error('DROPOFF_DEDICATED_OWNER_REQUIRED');k.authorize(scope,'operation.reconcile',op.resource_id);verifyJournal(s,journal);
    let response:Row;try{response=journal.lookup(operationId);}catch{response={kind:'unconfirmed'};}
    return k.transaction(()=>{k.authorize(scope,'operation.reconcile',op.resource_id);const current=operationRow(k,s,op.id);
      let result='unconfirmed';if(response.kind==='applied')result=this.#repair(scope,s,response,journal);
      else this.#drift(s,op.id,'SOURCE_UNCONFIRMED','unconfirmed');
      return {disposition:result,operation:new BusinessOperations(k).read(scope,current.id),command_repeated:false};});
  }
  start(scope:Scope,journal:SyntheticJournal){const k=this.#k,s=k.authorize(scope,'operation.reconcile');verifyJournal(s,journal);const ceiling=journal.head();integer(ceiling);
    return k.transaction(()=>{k.authorize(scope,'operation.reconcile');const ref='recon_'+token().slice(0,32);
      k.db.prepare("INSERT INTO commerce_reconciliation_runs VALUES(?,?,?,?,?,0,?,'running')").run(s.tenant_id,s.store_id,ref,journal.providerId,journal.identity,ceiling);return {id:ref,cursor:0,ceiling};});}
  read(scope:Scope,runId:string){const k=this.#k,s=k.authorize(scope,'operation.reconcile');id(runId);
    const r=k.db.prepare('SELECT * FROM commerce_reconciliation_runs WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,runId) as Row;
    if(!r)throw new Error('NOT_FOUND');return r;}
  step(scope:Scope,runId:string,journal:SyntheticJournal,limit=25){integer(limit,1);if(limit>100)throw new Error('INVALID_INPUT');
    const k=this.#k,s=k.authorize(scope,'operation.reconcile'),r=this.read(scope,runId);verifyJournal(s,journal);
    if(r.provider_id!==journal.providerId||r.provider_identity!==journal.identity)throw new Error('SOURCE_CHANGED');if(r.state==='completed')return {run:r,results:[],replayed:true};
    const page=journal.page(r.cursor,r.ceiling,limit);
    if(page.provider_id!==r.provider_id||page.provider_identity!==r.provider_identity||page.tenant_id!==s.tenant_id||page.store_id!==s.store_id||page.after!==r.cursor||page.ceiling!==r.ceiling
      ||!Array.isArray(page.entries)||page.entries.length>limit||typeof page.complete!=='boolean')throw new Error('PAGE_INVALID');
    let previous=r.cursor;const ids=new Set<string>();
    for(const entry of page.entries){integer(entry.seq,1);id(entry.result?.operation_id);
      if(entry.seq<=previous||entry.seq>r.ceiling||ids.has(entry.result.operation_id))throw new Error('PAGE_INVALID');previous=entry.seq;ids.add(entry.result.operation_id);}
    if(page.next!==(page.complete?r.ceiling:previous)||!page.complete&&page.next<=r.cursor)throw new Error('PAGE_INVALID');
    return k.transaction(()=>{k.authorize(scope,'operation.reconcile');const current=this.read(scope,runId);
      if(current.cursor!==r.cursor||current.ceiling!==r.ceiling||current.state!==r.state)throw new Error('CHECKPOINT_CHANGED');
      const results=page.entries.map(entry=>({operation_id:entry.result.operation_id,disposition:this.#repair(scope,s,entry.result,journal)}));
      // The checkpoint commits with every record on this page, never before them.
      k.db.prepare('UPDATE commerce_reconciliation_runs SET cursor=?,state=? WHERE tenant_id=? AND store_id=? AND id=?').run(page.next,page.complete?'completed':'running',s.tenant_id,s.store_id,runId);
      return {run:this.read(scope,runId),results,replayed:false};});
  }
  drift(scope:Scope,operationId:string){const k=this.#k,s=k.require(scope),op=operationRow(k,s,operationId);k.authorize(scope,'operation.read',op.resource_id);
    return k.db.prepare('SELECT code,source_ref,observed_at FROM commerce_reconciliation_drift WHERE tenant_id=? AND store_id=? AND operation_id=? ORDER BY observed_at,code').all(s.tenant_id,s.store_id,operationId);}
}
