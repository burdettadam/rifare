import { CommerceKernel,exact,id,integer } from './kernel.mts';
import type { Scope,Row } from './kernel.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { appendReceipt,receiptFields } from './operation-receipts.mts';

export function operationRow(k:CommerceKernel,s:Row,operationId:string):Row {
  id(operationId);const r=k.db.prepare('SELECT * FROM commerce_operations WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,operationId) as Row;
  if(!r)throw new Error('NOT_FOUND');if(contentDigest(JSON.parse(r.command))!==r.payload_hash)throw new Error('OPERATION_INTEGRITY');return r;
}
// Called inside the state-change transaction, never from an untrusted command endpoint.
export function queueOperation(k:CommerceKernel,s:Row,resourceId:string,kind:'case'|'event',sourceId:string,command:Row,refs:Row={}) {
  id(resourceId);id(sourceId);const input=canonical(command),hash=contentDigest(command),ref='op_'+contentDigest([s.tenant_id,s.store_id,kind,sourceId]).slice(0,40);
  const old=k.db.prepare('SELECT * FROM commerce_operations WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,ref) as Row;
  if(old){if(old.payload_hash!==hash||old.resource_id!==resourceId)throw new Error('IDEMPOTENCY_CONFLICT');return old;}
  const now=k.clock();k.db.prepare(`INSERT INTO commerce_operations VALUES(?,?,?,?,?,?,?,?, 'queued',1,NULL,?,?)`)
    .run(s.tenant_id,s.store_id,ref,resourceId,kind,sourceId,input,hash,now,now);
  k.db.prepare("INSERT INTO commerce_operation_work VALUES(?,?,?,'pending',0,?,NULL,NULL,NULL,NULL)").run(s.tenant_id,s.store_id,ref,now);
  const op=operationRow(k,s,ref);appendReceipt(k,s,op,{...receiptFields('queued',sourceId),...refs});return op;
}
export function recordCaseExecution(k:CommerceKernel,s:Row,receipt:Row,preview:Row) {
  return queueOperation(k,s,preview.resource_id,'case',receipt.id,{schema_version:1,action:'diagnostic.case.record',
    resource_id:preview.resource_id,source_id:receipt.id,source_digest:contentDigest(receipt),resolution:receipt.resolution,
    amount:receipt.amount,effect_revision:receipt.effect_revision,financial_effect:false},
    {configuration_digest:receipt.configuration_digest,policy_digest:preview.policy_digest,approval_ref:receipt.approval_id});
}
export function transitionOperation(k:CommerceKernel,s:Row,operationId:string,state:string,code:string,providerRef:string|null=null) {
  const op=operationRow(k,s,operationId);
  k.db.prepare('UPDATE commerce_operations SET state=?,revision=revision+1,provider_ref=?,updated_at=? WHERE tenant_id=? AND store_id=? AND id=?')
    .run(state,providerRef??op.provider_ref,k.clock(),s.tenant_id,s.store_id,operationId);
  const current=operationRow(k,s,operationId);appendReceipt(k,s,current,receiptFields(code,providerRef));return current;
}
export function blockingOperation(k:CommerceKernel,s:Row,op:Row):string|null {
  const r=k.db.prepare(`SELECT earlier.id FROM commerce_operations earlier
    JOIN commerce_operation_work w ON w.tenant_id=earlier.tenant_id AND w.store_id=earlier.store_id AND w.operation_id=earlier.id
    WHERE earlier.tenant_id=? AND earlier.store_id=? AND earlier.resource_id=? AND earlier.id<>?
    AND w.state NOT IN ('done','dead') AND (
      w.state IN ('leased','sending') OR
      (SELECT min(seq) FROM commerce_operation_receipts WHERE tenant_id=earlier.tenant_id AND store_id=earlier.store_id AND operation_id=earlier.id)
       < (SELECT min(seq) FROM commerce_operation_receipts WHERE tenant_id=? AND store_id=? AND operation_id=?))
    ORDER BY earlier.created_at,earlier.id LIMIT 1`).get(s.tenant_id,s.store_id,op.resource_id,op.id,s.tenant_id,s.store_id,op.id) as Row;
  return r?.id??null;
}
export class BusinessOperations {
  #k:CommerceKernel;constructor(kernel:CommerceKernel){this.#k=kernel;}
  read(scope:Scope,operationId:string){const k=this.#k,s=k.require(scope),op=operationRow(k,s,operationId);k.authorize(scope,'operation.read',op.resource_id);
    const work=k.db.prepare('SELECT state,attempts,available_at,lease_until,last_code FROM commerce_operation_work WHERE tenant_id=? AND store_id=? AND operation_id=?').get(s.tenant_id,s.store_id,op.id);
    return {id:op.id,resource_id:op.resource_id,source_kind:op.source_kind,source_id:op.source_id,payload_hash:op.payload_hash,state:op.state,revision:op.revision,
      provider_ref:op.provider_ref,created_at:op.created_at,updated_at:op.updated_at,work:{...work,blocked_by:blockingOperation(k,s,op)},financial_effect:false,execution_authorized:false};}
  fromReceipt(scope:Scope,input:unknown){const k=this.#k,p=exact(jsonValue(input),['receipt_id','idempotency_key','expected_receipt_digest']);id(p.receipt_id);id(p.idempotency_key);
    return k.transaction(()=>{const s=k.require(scope),receipt=k.db.prepare('SELECT * FROM commerce_action_receipts WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,p.receipt_id) as Row;
      if(!receipt)throw new Error('NOT_FOUND');const b=JSON.parse(receipt.body);
      if(contentDigest(b)!==receipt.digest||receipt.digest!==p.expected_receipt_digest)throw new Error('IDEMPOTENCY_CONFLICT');
      const c=k.db.prepare('SELECT resource_id FROM commerce_cases WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,receipt.case_id) as Row;
      k.authorize(scope,'operation.read',c.resource_id);
      // Binding aliases can only reference a gateway-created operation; this never grants an effect.
      const op=k.db.prepare("SELECT * FROM commerce_operations WHERE tenant_id=? AND store_id=? AND source_kind='case' AND source_id=?").get(s.tenant_id,s.store_id,receipt.id) as Row;
      if(!op)throw new Error('OPERATION_NOT_REGISTERED');operationRow(k,s,op.id);
      if(JSON.parse(op.command).source_digest!==receipt.digest)throw new Error('OPERATION_INTEGRITY');
      const old=k.db.prepare('SELECT * FROM commerce_operation_keys WHERE tenant_id=? AND store_id=? AND key=?').get(s.tenant_id,s.store_id,p.idempotency_key) as Row;
      if(old&&(old.operation_id!==op.id||old.payload_hash!==op.payload_hash))throw new Error('IDEMPOTENCY_CONFLICT');
      if(!old)k.db.prepare('INSERT INTO commerce_operation_keys VALUES(?,?,?,?,?)').run(s.tenant_id,s.store_id,p.idempotency_key,op.id,op.payload_hash);
      return this.read(scope,op.id);});}
  list(scope:Scope,resourceId:string,limit=50){const k=this.#k,s=k.authorize(scope,'operation.read',id(resourceId));integer(limit,1);if(limit>100)throw new Error('INVALID_INPUT');
    return (k.db.prepare('SELECT id FROM commerce_operations WHERE tenant_id=? AND store_id=? AND resource_id=? ORDER BY created_at,id LIMIT ?').all(s.tenant_id,s.store_id,resourceId,limit) as Row[]).map(r=>this.read(scope,r.id));}
}
