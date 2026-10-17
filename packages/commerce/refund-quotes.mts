import { exact,id,token } from './kernel.mts';
import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { contentDigest,canonical,jsonValue } from './configuration-values.mts';
import { allocationContext,financialFacts,resolutionSettings,checkedBody,minor,RESOLVE_ACTION,RESOLUTION_CONTRACT } from './resolution-ledger.mts';
import { CaseConfigurations } from './case-configurations.mts';
import { assertExecution } from './execution-stops.mts';
import { money } from './money.mts';
import { intakeSettings,evidenceReviewState } from './return-intake-core.mts';

export function availableValue(k:CommerceKernel,s:Row,resource:string,f:Row,exclude:string|null=null){
 const rows=k.db.prepare("SELECT * FROM commerce_resolution_operations WHERE tenant_id=? AND store_id=? AND resource_id=? AND state!='rejected'").all(s.tenant_id,s.store_id,resource) as Row[];
 let accounted=0n;for(const ref of f.accounted_operations){const op=rows.find(r=>r.id===ref);if(!op||!['settled','issued'].includes(op.state)||op.currency!==f.currency)throw new Error('REFUND_ACCOUNTING_UNVERIFIED');accounted+=minor(op.amount_minor);}
 if(accounted>minor(f.prior_refunded_minor))throw new Error('REFUND_ACCOUNTING_UNVERIFIED');
 let reserved=0n;for(const r of rows)if(r.id!==exclude&&!f.accounted_operations.includes(r.id))reserved+=minor(r.amount_minor);
 const remaining=minor(f.original_paid_minor)-minor(f.prior_refunded_minor)-reserved;
 if(remaining<0n)throw new Error('REFUND_BALANCE_CONFLICT');return remaining;
}
export function resolutionQuote(k:CommerceKernel,scope:Scope,allocationId:string,quotedAt:number,exclude:string|null=null){
 const {s,a,b,c,plan}=allocationContext(k,scope,allocationId),f=financialFacts(k,c),settings=resolutionSettings(k,s),cases=new CaseConfigurations(k),verified=cases.verified(scope,c.id);
 if(!['refund','store_credit'].includes(a.outcome)||!c.pins.policy.body.rules.outcomes.includes(a.outcome))throw new Error('OUTCOME_UNSUPPORTED');
 if(a.outcome==='store_credit'&&settings.credit_instrument!=='native_store_credit')throw new Error('CREDIT_UNQUALIFIED');
 if(evidenceReviewState(k,s,c.id)?.event==='evidence_requested')throw new Error('RETURN_REVIEW_REQUIRED');
 const original=f.paid_lines.find((l:Row)=>l.id===b.line_id);if(!original||contentDigest({...original,resolved_units:[]})!==b.paid_line_digest)throw new Error('PAID_ALLOCATION_CHANGED');
 if(b.units.some((u:number)=>original.resolved_units.includes(u)))throw new Error('UNIT_ALREADY_RESOLVED');
 if(intakeSettings(k,s).digest!==b.fee_settings_digest)throw new Error('REFUND_FEES_CHANGED');
 const native=k.db.prepare("SELECT * FROM commerce_native_return_operations WHERE tenant_id=? AND store_id=? AND request_id=? AND state='created'").get(s.tenant_id,s.store_id,plan.request_id) as Row;
 if(!native)throw new Error('NATIVE_RETURN_REQUIRED');const nativeBody=JSON.parse(native.native_body);if(contentDigest(nativeBody)!==native.native_digest)throw new Error('NATIVE_RETURN_INTEGRITY');
 if(!['OPEN','CLOSED'].includes(nativeBody.status))throw new Error('NATIVE_RETURN_UNAVAILABLE');
 const old=k.db.prepare('SELECT * FROM commerce_resolution_operations WHERE tenant_id=? AND store_id=? AND allocation_id=?').get(s.tenant_id,s.store_id,a.id) as Row;
 if(old&&old.id!==exclude)throw new Error('ALLOCATION_ALREADY_AUTHORIZED');
 const part=b.components,restock=(minor(part.gross_minor)-minor(part.discount_minor))*BigInt(b.restocking_bps)/10000n,
  amount=minor(part.paid_minor)-restock-minor(b.return_shipping_minor);
 if(amount<=0n)throw new Error('REFUND_VALUE_UNSUPPORTED');
 const remaining=availableValue(k,s,c.resource_id,f,exclude);if(amount>remaining)throw new Error('REFUND_BALANCE_EXCEEDED');
 const control=assertExecution(k,s,RESOLVE_ACTION),expiry=Math.min(quotedAt+300000,verified.expires_at,settings.expires_at,f.observed_at+c.pins.composition.effective['data.max_age_seconds']*1000);
 return {schema_version:1,allocation_id:a.id,allocation_digest:a.digest,case_id:c.id,case_revision:c.revision,resource_id:c.resource_id,customer_id:verified.customer_id,
  tenant_id:s.tenant_id,store_id:s.store_id,configuration_digest:c.configuration_digest,policy_digest:c.pins.policy.digest,
  source_version:c.order.source_version,source_digest:contentDigest(c.order),financial_revision:f.revision,native_return_id:native.native_id,native_return_digest:native.native_digest,
  payment_id:f.payment_id,kind:a.outcome,currency:f.currency,amount_minor:amount.toString(),components:{...part,restocking_minor:restock.toString(),return_shipping_minor:b.return_shipping_minor},
  remaining_before_minor:remaining.toString(),settings_digest:settings.digest,settings_revision:settings.revision,source_identity:settings.source_identity,
  credit_instrument:a.outcome==='store_credit'?'native_store_credit':null,control_stamp:control.stamp,review_revision:evidenceReviewState(k,s,c.id)?.seq??0,
  quoted_at:quotedAt,expires_at:expiry,qualification:'synthetic_only',tax_treatment:'original_paid_allocations_only',live_financial_authority:false};
}
export function resolutionQuoteRow(k:CommerceKernel,scope:Scope,quoteId:string){const s=k.require(scope),r=k.db.prepare('SELECT * FROM commerce_resolution_quotes WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,id(quoteId)) as Row;
 const body=checkedBody(r);allocationContext(k,scope,r.allocation_id,false);return {...r,quote:body};}
export class RefundQuotes {
 readonly kernel:CommerceKernel;constructor(k:CommerceKernel){this.kernel=k;}
 quote(scope:Scope,input:unknown){const p=exact(jsonValue(input),['allocation_id']),k=this.kernel;id(p.allocation_id);
  return k.transaction(()=>{const c=allocationContext(k,scope,p.allocation_id);k.authorize(scope,'action.propose',c.c.resource_id);
   const body=resolutionQuote(k,scope,p.allocation_id,k.clock()),ref='rvalue_'+token().slice(0,32),hash=contentDigest(body);
   k.db.prepare('INSERT INTO commerce_resolution_quotes VALUES(?,?,?,?,?,?,?,?)').run(c.s.tenant_id,c.s.store_id,ref,p.allocation_id,c.c.id,c.c.resource_id,canonical(body),hash);
   return {id:ref,digest:hash,quote:body,proposal:{case_id:c.c.id,action:RESOLVE_ACTION,arguments:{quote_id:ref,quote_digest:hash}},execution_authorized:false};});}
 read(scope:Scope,id:string){const r=resolutionQuoteRow(this.kernel,scope,id);return {id:r.id,digest:r.digest,quote:r.quote,execution_authorized:false};}
}
export function resolutionGatewayQuote(k:CommerceKernel,scope:Scope,p:Row,quotedAt:number){const args=exact(p.arguments,['quote_id','quote_digest']),row=resolutionQuoteRow(k,scope,args.quote_id),q=row.quote;
 if(p.case_id!==q.case_id||row.digest!==args.quote_digest)throw new Error('REFUND_QUOTE_CHANGED');
 if(q.expires_at<=k.clock())throw new Error('REFUND_QUOTE_EXPIRED');
 const current=resolutionQuote(k,scope,q.allocation_id,q.quoted_at);if(contentDigest(current)!==row.digest)throw new Error('REFUND_QUOTE_CHANGED');
 return {schema_version:1,tenant_id:q.tenant_id,store_id:q.store_id,case_id:q.case_id,case_revision:q.case_revision,configuration_digest:q.configuration_digest,
  resource_id:q.resource_id,resource_version:q.source_version,source_digest:q.source_digest,customer_id:q.customer_id,action:RESOLVE_ACTION,arguments:args,
  amount:money(q.currency,q.amount_minor),amount_ceiling:money(q.currency,q.amount_minor),readiness_digest:q.settings_digest,control_stamp:q.control_stamp,capability_revision:q.settings_revision,
  adapter_contract_digest:contentDigest(RESOLUTION_CONTRACT),policy_digest:q.policy_digest,decision:{eligible:true,reasons:['SYNTHETIC_RESOLUTION_ONLY']},
  effect_version:0,quoted_at:quotedAt,expires_at:Math.min(quotedAt+300000,q.expires_at),max_uses:1,financial_effect:false};}
export function commitResolution(k:CommerceKernel,s:Row,preview:Row,receiptId:string){const r=k.db.prepare('SELECT * FROM commerce_resolution_quotes WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,preview.arguments.quote_id) as Row,
 q=checkedBody(r),op='resolution_'+contentDigest([s.tenant_id,s.store_id,q.allocation_id]).slice(0,40);
 const command={operation_id:op,tenant_id:s.tenant_id,store_id:s.store_id,resource_id:q.resource_id,customer_id:q.customer_id,allocation_id:q.allocation_id,
  kind:q.kind,currency:q.currency,amount_minor:q.amount_minor,payment_id:q.payment_id,native_return_id:q.native_return_id,source_identity:q.source_identity,credit_instrument:q.credit_instrument};
 k.db.prepare("INSERT INTO commerce_resolution_operations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'authorized',NULL,?)").run(s.tenant_id,s.store_id,op,q.allocation_id,q.case_id,q.resource_id,receiptId,r.id,q.kind,q.amount_minor,q.currency,q.source_identity,canonical(command),contentDigest(command),k.clock());
 recordResolutionObservation(k,s,op,q.resource_id,'authorized',{quote_digest:r.digest,receipt_id:receiptId,amount_minor:q.amount_minor,currency:q.currency});return op;}
export function recordResolutionObservation(k:CommerceKernel,s:Row,op:string,resource:string,stage:string,body:Row){k.db.prepare('INSERT INTO commerce_resolution_observations(tenant_id,store_id,operation_id,resource_id,stage,body,digest,observed_at) VALUES(?,?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,op,resource,stage,canonical(body),contentDigest(body),k.clock());}
