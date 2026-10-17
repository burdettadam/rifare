import { exact,id,digest } from './kernel.mts';
import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { Skills } from './skills.mts';
import { CaseConfigurations } from './case-configurations.mts';
import { returnContext,lifecycleBody,receiptSummary,closureState,assertReturnWritable } from './return-lifecycle-core.mts';
import { RefundQuotes } from './refund-quotes.mts';
import { StoreCredit } from './store-credit.mts';
import { VariantExchanges } from './variant-exchanges.mts';

export class ReturnWorkflows {
 readonly kernel:CommerceKernel;readonly skills:Skills;constructor(k:CommerceKernel){this.kernel=k;this.skills=new Skills(k);}
 open(scope:Scope,input:unknown){const p=exact(jsonValue(input),['request_id','workflow','skill_digest']);if(!['return','exchange'].includes(p.workflow)||typeof p.skill_digest!=='string'||!/^[a-f0-9]{64}$/.test(p.skill_digest))throw new Error('INVALID_INPUT');const k=this.kernel;
  return k.transaction(()=>{const {s,r,c}=returnContext(k,scope,p.request_id),name=p.workflow==='return'?'handle-return':'handle-exchange',old=k.db.prepare('SELECT * FROM commerce_return_workflow_pins WHERE tenant_id=? AND store_id=? AND request_id=? AND workflow=?').get(s.tenant_id,s.store_id,r.id,p.workflow) as Row;
   if(old){const b=lifecycleBody(old);if(b.skill_digest!==p.skill_digest)throw new Error('WORKFLOW_PIN_CHANGED');this.skills.snapshot(scope,name,b.skill_digest);return this.status(scope,{request_id:r.id,workflow:p.workflow});}
   const bundle=this.skills.snapshot(scope,name,p.skill_digest),b={request_id:r.id,case_id:r.case_id,workflow:p.workflow,skill_id:name,skill_digest:bundle.digest,skill_version:bundle.version,case_revision:c.revision,configuration_digest:c.configuration_digest,created_at:k.clock()};
   k.db.prepare('INSERT INTO commerce_return_workflow_pins VALUES(?,?,?,?,?,?)').run(s.tenant_id,s.store_id,r.id,p.workflow,canonical(b),contentDigest(b));return this.status(scope,{request_id:r.id,workflow:p.workflow});});}
 status(scope:Scope,input:unknown){const p=exact(jsonValue(input),['request_id','workflow']);if(!['return','exchange'].includes(p.workflow))throw new Error('INVALID_INPUT');const k=this.kernel,{s,r,c}=returnContext(k,scope,p.request_id),pinRow=k.db.prepare('SELECT * FROM commerce_return_workflow_pins WHERE tenant_id=? AND store_id=? AND request_id=? AND workflow=?').get(s.tenant_id,s.store_id,r.id,p.workflow) as Row;
  const pin=lifecycleBody(pinRow),bundle=this.skills.snapshot(scope,pin.skill_id,pin.skill_digest);let block:string|null=null;
  try{new CaseConfigurations(k).resume(scope,c.id);assertReturnWritable(k,s,r.id);if(pin.configuration_digest!==c.configuration_digest||pin.case_revision!==c.revision)throw new Error('WORKFLOW_CONFIGURATION_CHANGED');}catch(error){block=error instanceof Error?error.message:'WORKFLOW_UNAVAILABLE';}
  const native=k.db.prepare('SELECT * FROM commerce_native_return_operations WHERE tenant_id=? AND store_id=? AND request_id=?').get(s.tenant_id,s.store_id,r.id) as Row;let nativeRecord:any=null;if(native?.native_body){nativeRecord=JSON.parse(native.native_body);if(contentDigest(nativeRecord)!==native.native_digest)throw new Error('NATIVE_RETURN_INTEGRITY');}
  const allocations=k.db.prepare('SELECT * FROM commerce_resolution_allocations WHERE tenant_id=? AND store_id=? AND case_id=? ORDER BY id').all(s.tenant_id,s.store_id,c.id) as Row[];
  const resolutions=(k.db.prepare('SELECT * FROM commerce_resolution_operations WHERE tenant_id=? AND store_id=? AND case_id=? ORDER BY id').all(s.tenant_id,s.store_id,c.id) as Row[]).map(op=>({id:op.id,allocation_id:op.allocation_id,kind:op.kind,state:op.state,amount_minor:op.amount_minor,currency:op.currency,cash_settled:op.kind==='refund'&&op.state==='settled',credit_issued:op.kind==='store_credit'&&op.state==='issued',native_id:op.native_id}));
  const fulfillment=k.db.prepare('SELECT * FROM commerce_fulfillment_operations WHERE tenant_id=? AND store_id=? AND case_id=? ORDER BY id').all(s.tenant_id,s.store_id,c.id) as Row[];
  const replacements=fulfillment.filter(op=>op.kind==='replacement').map(op=>{const row=k.db.prepare('SELECT * FROM commerce_replacement_orders WHERE tenant_id=? AND store_id=? AND operation_id=?').get(s.tenant_id,s.store_id,op.id) as Row,b=row?lifecycleBody(row):null;return {id:op.id,allocation_id:op.obligation,state:op.state,native_id:op.native_id,fulfillment_state:b?.fulfillment_state??'not_recorded',shipment_id:b?.shipment_id??null,quantity:b?.quantity??null,variant_id:b?.variant_id??null};});
  const labels=(k.db.prepare('SELECT * FROM commerce_return_labels WHERE tenant_id=? AND store_id=? AND request_id=? ORDER BY generation').all(s.tenant_id,s.store_id,r.id) as Row[]).map(row=>{const b=lifecycleBody(row);return {id:row.id,tracking:b.tracking_state,void_state:b.void_state,reimbursement:b.reimbursement};});
  const receipt=receiptSummary(k,s,r.id),nativeReceipts=(k.db.prepare('SELECT * FROM commerce_native_receipts WHERE tenant_id=? AND store_id=? AND request_id=? ORDER BY native_id').all(s.tenant_id,s.store_id,r.id) as Row[]).map(lifecycleBody);
  const disposition=k.db.prepare('SELECT id,state,native_id FROM commerce_disposition_operations WHERE tenant_id=? AND store_id=? AND request_id=? ORDER BY id').all(s.tenant_id,s.store_id,r.id);
  const ext=k.db.prepare('SELECT * FROM commerce_native_change_snapshots WHERE tenant_id=? AND store_id=? AND request_id=?').get(s.tenant_id,s.store_id,r.id) as Row,external=ext?lifecycleBody(ext):null;
  if(receipt.requires_review&&!block)block='RECEIVING_REVIEW_REQUIRED';
  const stages={authorization:r.state,native_return:nativeRecord?{id:nativeRecord.id,status:nativeRecord.status}:null,receiving:{state:receipt.state,inspection:receipt.inspection,expected_received:receipt.expected_received,total_actual:receipt.total_actual,lines:receipt.lines,requires_review:receipt.requires_review,revision:receipt.revision},native_receipts:nativeReceipts,disposition,resolutions,replacements,labels,closure:closureState(k,s,r.id),external};
  const source={request_id:r.id,case_id:c.id,case_revision:c.revision,configuration_digest:c.configuration_digest,source_version:c.order.source_version,stages},sourceDigest=contentDigest(source);
  return {...source,workflow:p.workflow,pin,source_digest:sourceDigest,skill:{id:bundle.id,version:bundle.version,digest:bundle.digest,resources:Object.entries(bundle.files).sort(([a],[b])=>a.localeCompare(b)).map(([path,content])=>({path,sha256:digest(content),content,authority:'guidance_only'}))},
   merchant:{tone:c.pins.composition.effective['presentation.tone'],locale:c.pins.composition.effective['presentation.locale'],policy:c.pins.policy.body.rules},allocations:allocations.sort((a,b)=>a.line_id.localeCompare(b.line_id)||a.id.localeCompare(b.id)).map(a=>({id:a.id,line_id:a.line_id,outcome:a.outcome,units:lifecycleBody(a).units})),
   handoff_required:!!block||resolutions.some(o=>o.state==='unknown')||fulfillment.some(o=>o.state==='unknown'),reason:block??(resolutions.some(o=>o.state==='unknown')?'RECONCILIATION_REQUIRED':null),execution_authorized:false,qualification:'synthetic_only'};
 }
 quote(scope:Scope,input:unknown){const p=exact(jsonValue(input),['request_id','workflow','allocation_id','catalog_id']);const status=this.status(scope,{request_id:p.request_id,workflow:p.workflow});id(p.allocation_id);if(status.reason)throw new Error(status.reason);
  const a=status.allocations.find(x=>x.id===p.allocation_id);if(!a)throw new Error('NOT_FOUND');if(p.workflow==='exchange'){id(p.catalog_id);if(a.outcome!=='exchange')throw new Error('OUTCOME_UNSUPPORTED');return new VariantExchanges(this.kernel).quote(scope,{allocation_id:a.id,catalog_id:p.catalog_id});}
  if(p.catalog_id!==null||a.outcome==='exchange')throw new Error('INVALID_INPUT');return a.outcome==='store_credit'?new StoreCredit(this.kernel).quote(scope,a.id):new RefundQuotes(this.kernel).quote(scope,{allocation_id:a.id});
 }
}
