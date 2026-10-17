import { exact,id,token } from './kernel.mts';
import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { allocationContext,financialFacts,resolutionSettings,checkedBody,minor,RESOLVE_ACTION,assertAllocationSource } from './resolution-ledger.mts';
import { availableValue,originalInstrumentRoutes,assertInstrumentCapacity } from './refund-quotes.mts';
import { VariantExchanges } from './variant-exchanges.mts';
import { CaseConfigurations } from './case-configurations.mts';
import { assertExecution } from './execution-stops.mts';
import { evidenceReviewState } from './return-intake-core.mts';
import { assertGiftOutcome } from './gift-proof.mts';
import { assertExchangeMoneySupported } from './exchange-currency.mts';
import { money,allocateMoney } from './money.mts';

/** Additional payment and residual value use the existing approval/operation ledger. */
export function exchangeFinanceQuote(k:CommerceKernel,scope:Scope,input:unknown,quotedAt:number,exclude:string|null=null){
 const p=exact(jsonValue(input),['exchange_quote_id','exchange_quote_digest','outcome']);id(p.exchange_quote_id);
 if(!['additional_payment','refund','store_credit'].includes(p.outcome))throw new Error('EXCHANGE_FINANCE_OUTCOME_UNSUPPORTED');
 const q=new VariantExchanges(k).validateForFinance(scope,{quote_id:p.exchange_quote_id,quote_digest:p.exchange_quote_digest},exclude??undefined),{s,a,b,c,plan}=allocationContext(k,scope,q.allocation_id),f=financialFacts(k,c),settings=resolutionSettings(k,s),proof=new CaseConfigurations(k).verified(scope,c.id);
 const gift=assertGiftOutcome(k,scope,c.id,p.outcome,[b]);
 assertExchangeMoneySupported(k,s,a.id);
 assertAllocationSource(f,b);
 if(f.bundle_allocations&&settings.bundle_policy!=='preserve_original_paid')throw new Error('BUNDLE_POLICY_UNAPPROVED');
 const delta=BigInt(q.balance_minor),amount=delta<0n?-delta:delta,original=minor(q.available_exchange_value_minor);
 if(delta===0n||delta>0n&&p.outcome!=='additional_payment'||delta<0n&&p.outcome==='additional_payment')throw new Error('EXCHANGE_FINANCE_OUTCOME_UNSUPPORTED');
 if(p.outcome!=='additional_payment'&&!c.pins.policy.body.rules.outcomes.includes(p.outcome))throw new Error('OUTCOME_UNSUPPORTED');
 if(p.outcome==='store_credit'&&settings.credit_instrument!=='native_store_credit')throw new Error('CREDIT_UNQUALIFIED');
 const old=k.db.prepare('SELECT id FROM commerce_resolution_operations WHERE tenant_id=? AND store_id=? AND allocation_id=?').get(s.tenant_id,s.store_id,a.id) as Row;
 if(old&&old.id!==exclude)throw new Error('ALLOCATION_ALREADY_AUTHORIZED');
 const native=k.db.prepare("SELECT * FROM commerce_native_return_operations WHERE tenant_id=? AND store_id=? AND request_id=? AND state='created'").get(s.tenant_id,s.store_id,plan.request_id) as Row;
 if(!native)throw new Error('NATIVE_RETURN_REQUIRED');const nativeBody=JSON.parse(native.native_body);if(contentDigest(nativeBody)!==native.native_digest)throw new Error('NATIVE_RETURN_INTEGRITY');
 if(!['OPEN','CLOSED'].includes(nativeBody.status))throw new Error('NATIVE_RETURN_UNAVAILABLE');
 const remaining=availableValue(k,s,c.resource_id,f,exclude);if(original>remaining)throw new Error('REFUND_BALANCE_EXCEEDED');
 const valueRoutes=originalInstrumentRoutes(f,b,original.toString());
 // Fees first reduce each instrument's transferable entitlement. Allocate the
 // residual within those shares so independent rounding cannot overspend one.
 const routes=delta<0n&&valueRoutes?allocateMoney(money(f.currency,amount.toString()),valueRoutes.map(r=>({id:r.instrument_id,weight:r.amount_minor}))).filter(a=>a.amount.minor!=='0').map(a=>({instrument_id:a.id,type:valueRoutes.find(r=>r.instrument_id===a.id)!.type,amount_minor:a.amount.minor})):undefined;
 assertInstrumentCapacity(k,s,c.resource_id,f,valueRoutes,exclude);
 const control=assertExecution(k,s,RESOLVE_ACTION),expiry=Math.min(q.expires_at,quotedAt+300000,proof.expires_at,settings.expires_at,f.observed_at+c.pins.composition.effective['data.max_age_seconds']*1000);
 return {schema_version:1,allocation_id:a.id,allocation_digest:a.digest,case_id:c.id,case_revision:c.revision,resource_id:c.resource_id,customer_id:c.customer_id,
  tenant_id:s.tenant_id,store_id:s.store_id,configuration_digest:c.configuration_digest,policy_digest:c.pins.policy.digest,
  source_version:c.order.source_version,source_digest:contentDigest(c.order),financial_revision:f.revision,native_return_id:native.native_id,native_return_digest:native.native_digest,
  payment_id:f.payment_id,kind:p.outcome,currency:f.currency,amount_minor:amount.toString(),original_value_minor:original.toString(),exchange_quote_id:q.quote_id,exchange_quote_digest:q.quote_digest,replacement_variant:q.replacement_variant,replacement_minor:q.replacement_minor,quantity:q.quantity,
  ...(gift?{credit_beneficiary_id:gift.recipient_customer_id,gift_source_digest:gift.source_digest}:{}),...(valueRoutes?{value_routes:valueRoutes,routes:routes??[],line_id:b.line_id,units:b.units}:{}),...(p.outcome==='additional_payment'?{payment_expires_at:expiry}:{}),
  components:{...b.components,restocking_minor:q.restocking_minor,return_shipping_minor:q.return_shipping_minor,replacement_minor:q.replacement_minor},remaining_before_minor:remaining.toString(),
  settings_digest:settings.digest,settings_revision:settings.revision,source_identity:settings.source_identity,credit_instrument:p.outcome==='store_credit'?'native_store_credit':null,
  control_stamp:control.stamp,review_revision:evidenceReviewState(k,s,c.id)?.seq??0,quoted_at:quotedAt,expires_at:expiry,qualification:'synthetic_only',tax_treatment:'original_paid_allocations_only',live_financial_authority:false};
}
export class ExchangeFinance {
 readonly kernel:CommerceKernel;constructor(k:CommerceKernel){this.kernel=k;}
 quote(scope:Scope,input:unknown){const k=this.kernel;return k.transaction(()=>{const intent=exact(jsonValue(input),['exchange_quote_id','exchange_quote_digest','outcome']),s=k.require(scope),row=k.db.prepare('SELECT * FROM commerce_exchange_quotes WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,id(intent.exchange_quote_id)) as Row;checkedBody(row);const ctx=allocationContext(k,scope,row.allocation_id);k.authorize(scope,'action.propose',ctx.c.resource_id);const q=exchangeFinanceQuote(k,scope,intent,k.clock());
  const ref='rvalue_'+token().slice(0,32),hash=contentDigest(q);k.db.prepare('INSERT INTO commerce_resolution_quotes VALUES(?,?,?,?,?,?,?,?)').run(q.tenant_id,q.store_id,ref,q.allocation_id,q.case_id,q.resource_id,canonical(q),hash);
  return {id:ref,digest:hash,quote:q,proposal:{case_id:q.case_id,action:RESOLVE_ACTION,arguments:{quote_id:ref,quote_digest:hash}},execution_authorized:false};});}
}
export function exchangeSettlement(k:CommerceKernel,scope:Scope,q:Row){
 const {s,c}=allocationContext(k,scope,q.allocation_id);k.authorize(scope,'return.read',c.resource_id);
 if(q.balance_minor==='0')return {balance_minor:'0'};
 const op=k.db.prepare('SELECT * FROM commerce_resolution_operations WHERE tenant_id=? AND store_id=? AND allocation_id=?').get(s.tenant_id,s.store_id,q.allocation_id) as Row;
 if(!op)throw new Error('EXCHANGE_PAYMENT_OUTSTANDING');const command=JSON.parse(op.command),required=BigInt(q.balance_minor),amount=(required<0n?-required:required).toString();
 if(contentDigest(command)!==op.digest||command.operation_id!==op.id||command.exchange_quote_id!==q.quote_id||command.exchange_quote_digest!==q.quote_digest||command.allocation_id!==q.allocation_id||command.resource_id!==c.resource_id||command.customer_id!==c.customer_id||command.currency!==q.currency||command.amount_minor!==amount||command.kind!==op.kind||command.source_identity!==op.source_identity||op.amount_minor!==amount||op.currency!==q.currency)throw new Error('EXCHANGE_FINANCE_MISMATCH');
 if(required>0n?op.kind!=='additional_payment':!['refund','store_credit'].includes(op.kind))throw new Error('EXCHANGE_FINANCE_MISMATCH');
 const terminal=op.kind==='store_credit'?'issued':'settled';if(op.state!==terminal||!op.native_id)throw new Error('EXCHANGE_PAYMENT_OUTSTANDING');
 const observation=k.db.prepare('SELECT * FROM commerce_resolution_observations WHERE tenant_id=? AND store_id=? AND operation_id=? AND stage=? ORDER BY seq DESC LIMIT 1').get(s.tenant_id,s.store_id,op.id,terminal) as Row,result=checkedBody(observation);
 for(const key of Object.keys(command))if(canonical(result[key])!==canonical(command[key]))throw new Error('EXCHANGE_FINANCE_MISMATCH');
 if(result.id!==op.native_id||result.state!==terminal||op.kind==='additional_payment'&&result.payment?.paid_minor!==amount)throw new Error('EXCHANGE_PAYMENT_OUTSTANDING');
 return {balance_minor:'0',original_value_minor:command.original_value_minor,exchange_finance:{operation_id:op.id,source_identity:op.source_identity,exchange_quote_id:command.exchange_quote_id,exchange_quote_digest:command.exchange_quote_digest,allocation_id:op.allocation_id,resource_id:command.resource_id,customer_id:command.customer_id,currency:command.currency,kind:command.kind,amount_minor:amount,native_id:op.native_id,state:terminal,command_digest:op.digest}};
}
