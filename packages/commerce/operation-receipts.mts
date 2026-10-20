import { CommerceKernel,exact,id,integer,token } from './kernel.mts';
import type { Scope,Row } from './kernel.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';

export const RECEIPT_CODES=Object.freeze(['queued','dispatch_started','retry_scheduled','outcome_unknown','source_confirmed',
  'provider_rejected','retry_exhausted','lease_recovered','linked_correction','payload_attached','payload_erased','reservation_released']);
const reference=(x:unknown)=>x===null?null:id(x);
const hash=(x:unknown)=>{if(typeof x!=='string'||!/^[a-f0-9]{64}$/.test(x))throw new Error('RECEIPT_INPUT');return x;};

// Loyalty's strict audit reader has a 1000-receipt bound. Optional payload work
// must leave room for every outstanding payload's erasure and the remaining
// native transitions. Attach/erase mutate their payload in the same transaction
// before this check, so a denied append rolls that mutation back as well.
function loyaltyReceiptBudget(k:CommerceKernel,s:Row,op:Row,action:string) {
  if(action!=='diagnostic.loyalty.redeem')return;
  const remaining=({queued:2,unknown:1,succeeded:0,failed:0} as Row)[op.state];
  if(remaining===undefined)throw new Error('LOYALTY_RECEIPT_LIMIT');
  const receipts=k.db.prepare('SELECT count(*) n FROM (SELECT 1 FROM commerce_operation_receipts WHERE tenant_id=? AND store_id=? AND operation_id=? LIMIT 1001)').get(s.tenant_id,s.store_id,op.id) as Row;
  const payloads=k.db.prepare('SELECT count(*) n FROM (SELECT 1 FROM commerce_receipt_payloads p JOIN commerce_operation_receipts r ON r.tenant_id=p.tenant_id AND r.store_id=p.store_id AND r.id=p.receipt_id WHERE r.tenant_id=? AND r.store_id=? AND r.operation_id=? LIMIT 1001)').get(s.tenant_id,s.store_id,op.id) as Row;
  if(Number(receipts.n)+1+Number(payloads.n)+remaining>1000)throw new Error('LOYALTY_RECEIPT_LIMIT');
}

// Internal transaction helper. Only trusted state transitions call this; never a public append endpoint.
export function appendReceipt(k:CommerceKernel,s:Row,op:Row,input:unknown) {
  const p=exact(jsonValue(input),['code','source_ref','approval_ref','configuration_digest','policy_digest','correction_of','correction_reason','payload_ref']);
  if(p.correction_reason!==null&&!['reconciled_source','recording_reference'].includes(p.correction_reason))throw new Error('RECEIPT_INPUT');
  if(!RECEIPT_CODES.includes(p.code))throw new Error('RECEIPT_INPUT');
  for(const key of ['source_ref','approval_ref','correction_of','payload_ref'])reference(p[key]);
  for(const key of ['configuration_digest','policy_digest'])if(p[key]!==null)hash(p[key]);
  if(op.tenant_id!==s.tenant_id||op.store_id!==s.store_id)throw new Error('ACCESS_DENIED');
  const action=JSON.parse(op.command).action;loyaltyReceiptBudget(k,s,op,action);
  const previous=k.db.prepare('SELECT digest FROM commerce_operation_receipts WHERE tenant_id=? AND store_id=? AND operation_id=? ORDER BY seq DESC LIMIT 1').get(s.tenant_id,s.store_id,op.id) as Row;
  const body={id:'orc_'+token().slice(0,32),tenant_id:s.tenant_id,store_id:s.store_id,operation_id:op.id,
    actor_ref:id(s.actor_id),resource_ref:id(op.resource_id),action,payload_hash:hash(op.payload_hash),
    state:op.state,operation_revision:op.revision,...p,previous_digest:previous?.digest??null,observed_at:integer(k.clock()),financial_effect:false};
  k.db.prepare('INSERT INTO commerce_operation_receipts(tenant_id,store_id,operation_id,id,body,digest) VALUES(?,?,?,?,?,?)')
    .run(s.tenant_id,s.store_id,op.id,body.id,canonical(body),contentDigest(body));
  return body;
}
export const receiptFields=(code:string,source_ref:string|null=null)=>({code,source_ref,approval_ref:null,configuration_digest:null,policy_digest:null,correction_of:null,correction_reason:null,payload_ref:null});

export class OperationReceipts {
  #k:CommerceKernel;constructor(kernel:CommerceKernel){this.#k=kernel;}
  #row(scope:Scope,receiptId:string){const k=this.#k,s=k.authorize(scope,'audit.read');id(receiptId);
    const r=k.db.prepare('SELECT * FROM commerce_operation_receipts WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,receiptId) as Row;
    if(!r)throw new Error('NOT_FOUND');const b=JSON.parse(r.body);
    if(contentDigest(b)!==r.digest||b.id!==r.id||b.tenant_id!==r.tenant_id||b.store_id!==r.store_id||b.operation_id!==r.operation_id)throw new Error('RECEIPT_INTEGRITY');
    k.authorize(scope,'resource.read',b.resource_ref);return {...r,receipt:b};}
  read(scope:Scope,receiptId:string){const r=this.#row(scope,receiptId);return {receipt:r.receipt,digest:r.digest};}
  list(scope:Scope,operationId:string){const k=this.#k,s=k.authorize(scope,'audit.read');id(operationId);
    const op=k.db.prepare('SELECT * FROM commerce_operations WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,operationId) as Row;
    if(!op)throw new Error('NOT_FOUND');k.authorize(scope,'resource.read',op.resource_id);
    const rows=k.db.prepare('SELECT id FROM commerce_operation_receipts WHERE tenant_id=? AND store_id=? AND operation_id=? ORDER BY seq').all(s.tenant_id,s.store_id,operationId) as Row[];
    let previous:string|null=null;return rows.map(r=>{const v=this.read(scope,r.id);if(v.receipt.previous_digest!==previous)throw new Error('RECEIPT_CHAIN_INVALID');previous=v.digest;return v;});}
  correct(scope:Scope,input:unknown){const k=this.#k,p=exact(jsonValue(input),['receipt_id','replacement_receipt_id','reason']);
    if(!['reconciled_source','recording_reference'].includes(p.reason))throw new Error('RECEIPT_INPUT');
    return k.transaction(()=>{
      const s=k.authorize(scope,'audit.correct'),old=this.#row(scope,p.receipt_id),replacement=this.#row(scope,p.replacement_receipt_id);
      if(old.operation_id!==replacement.operation_id||old.seq>=replacement.seq||replacement.receipt.code!=='source_confirmed')throw new Error('CORRECTION_INVALID');
      const op=k.db.prepare('SELECT * FROM commerce_operations WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,old.operation_id) as Row;
      return appendReceipt(k,s,op,{...receiptFields('linked_correction',replacement.id),correction_of:old.id,correction_reason:p.reason});
    });}
  attach(scope:Scope,input:unknown){const k=this.#k,p=exact(jsonValue(input,8192),['receipt_id','subject_ref','kind','content','expires_at']);
    id(p.subject_ref);integer(p.expires_at);if(p.kind!=='customer_note'||typeof p.content!=='string'||p.content.length<1||p.content.length>2048
      ||/(?:bearer\s+|sk-[A-Za-z0-9_-]{8}|-----BEGIN|(?:api[_ -]?key|secret|password|token)\s*[:=])/i.test(p.content))throw new Error('SENSITIVE_PAYLOAD_REJECTED');
    return k.transaction(()=>{const s=k.authorize(scope,'audit.payload'),r=this.#row(scope,p.receipt_id);
      if(p.expires_at<=k.clock()||p.expires_at>k.clock()+30*86400000)throw new Error('RETENTION_INVALID');
      const ref='payload_'+token().slice(0,32);
      k.db.prepare('INSERT INTO commerce_receipt_payloads VALUES(?,?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,ref,r.id,p.subject_ref,p.kind,p.content,p.expires_at);
      const op=k.db.prepare('SELECT * FROM commerce_operations WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,r.operation_id) as Row;
      appendReceipt(k,s,op,{...receiptFields('payload_attached'),payload_ref:ref});return {id:ref,expires_at:p.expires_at};});}
  payload(scope:Scope,payloadId:string){const k=this.#k,s=k.authorize(scope,'audit.payload');id(payloadId);
    const row=k.db.prepare('SELECT * FROM commerce_receipt_payloads WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,payloadId) as Row;
    if(!row)throw new Error('NOT_FOUND');this.#row(scope,row.receipt_id);if(row.expires_at<=k.clock())throw new Error('PAYLOAD_EXPIRED');return {id:row.id,kind:row.kind,content:row.content,expires_at:row.expires_at};}
  erase(scope:Scope,payloadId:string){const k=this.#k;id(payloadId);return k.transaction(()=>{const s=k.authorize(scope,'audit.erase');
    const row=k.db.prepare('SELECT * FROM commerce_receipt_payloads WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,payloadId) as Row;
    if(!row)throw new Error('NOT_FOUND');const receipt=this.#row(scope,row.receipt_id);
    if(row.expires_at>k.clock())throw new Error('RETENTION_NOT_ELIGIBLE');
    const op=k.db.prepare('SELECT * FROM commerce_operations WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,receipt.operation_id) as Row;
    k.db.prepare('DELETE FROM commerce_receipt_payloads WHERE tenant_id=? AND store_id=? AND id=?').run(s.tenant_id,s.store_id,payloadId);
    appendReceipt(k,s,op,{...receiptFields('payload_erased'),payload_ref:payloadId});return {erased:true,payload_ref:payloadId,physical_media_erasure:false};});}
}
