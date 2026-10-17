import { readFileSync } from 'node:fs';
import { resolutionFixture } from './resolution-helpers.mts';
import { ResolutionFixtureSource } from '../../packages/adapters/resolution-fixture-source.mts';
import { ResolutionExecution } from '../../packages/commerce/resolution-execution.mts';
import { ExchangeCurrency } from '../../packages/commerce/exchange-currency.mts';
import { ExchangeFees } from '../../packages/commerce/exchange-fees.mts';
import { ReturnCancellation } from '../../packages/commerce/return-cancellation.mts';

export const moneyOracle=JSON.parse(readFileSync(new URL('../fixtures/exchange-money/golden.v1.json',import.meta.url),'utf8'));
const decimal=(minor:string,currency:string)=>{const scale=currency==='JPY'?0:['KWD','BHD'].includes(currency)?3:2,n=minor.padStart(scale+1,'0');return scale?n.slice(0,-scale)+'.'+n.slice(-scale):n;};
export async function moneyFixture(options:{fees?:boolean;presentment?:string}={}){
 const f=await resolutionFixture({zeroFees:!options.fees}),presentment=options.presentment??'EUR';
 const source=new ResolutionFixtureSource(f.sourceDb,{mode:'fixture',identity:'source-one',tenant:f.a.tenant,store:f.a.store},f.now),executor=new ResolutionExecution(f.kernel,source);
 const qualification={qualification_id:'money-qualification-one',revision:1,account_id:'fixture-card-account',api_version:'2026-10',market:'US',payment_instrument:'card',shop_currency:'USD',presentment_currency:presentment,allowed_kinds:['refund'],expires_at:f.now()+3600000,evidence_id:'fixture-account-field-evidence',enabled:true,qualification:'synthetic_only'};
 source.money.qualify(qualification);
 const profile={resource_id:f.order().id,qualification_id:qualification.qualification_id,source_record_id:'original-capture-one',
  rate_provenance:{id:'original-rate-2026',source_record_id:'original-conversion-one',numerator:presentment==='JPY'?'90':'9',denominator:presentment==='JPY'?'1':['KWD','BHD'].includes(presentment)?'100':'10',observed_at:f.now(),rule:'original_native_allocations',rounding:'native_recorded'},
  shop:{currency:'USD',original_paid_minor:moneyOracle.order.shop_original_minor,prior_refunded_minor:moneyOracle.order.shop_prior_minor},
  presentment:{currency:presentment,original_paid_minor:moneyOracle.order.presentment_original_minor,prior_refunded_minor:moneyOracle.order.presentment_prior_minor},
  units:f.paid_lines.flatMap(l=>Array.from({length:l.quantity},(_,i)=>({line_id:l.id,unit_index:i+1,resolved:l.resolved_units.includes(i+1),...structuredClone(moneyOracle.unit_components[l.id])})))};
 source.money.seedOrder(profile);const plan=f.allocate(),allocation=plan.allocations.find(a=>a.line_id==='alpha')!;
 const currency=new ExchangeCurrency(f.kernel,source),fees=new ExchangeFees(f.kernel,source);currency.bind(f.a.scope,{allocation_id:allocation.id});
 const feeInput=(phase='estimated',patch:any={})=>{const values=moneyOracle.fees[phase==='estimated'?'estimate':'final'];return {allocation_id:allocation.id,event_id:phase==='estimated'?'estimate-one':'final-one',phase,revision:1,observed_at:f.now(),api_version:'2026-10',
   native_fee:{id:'return-shipping-fee-one',amountSet:{shopMoney:{amount:decimal(values.shop.return_shipping_minor,'USD'),currencyCode:'USD'},presentmentMoney:{amount:decimal(values.presentment.return_shipping_minor,presentment),currencyCode:presentment}},
    [phase==='estimated'?'taxAmountSet':'finalizedTaxAmountSet']:{shopMoney:{amount:decimal(values.shop.tax_minor,'USD'),currencyCode:'USD'},presentmentMoney:{amount:decimal(values.presentment.tax_minor,presentment),currencyCode:presentment}}},...patch};};
 const recordFee=(phase='estimated',patch:any={},refresh=true)=>{const input=feeInput(phase,patch),result=source.money.recordFee(input);if(result.recorded&&refresh)fees.refresh(f.a.scope,{allocation_id:allocation.id,event_id:input.event_id});return result;};
 if(options.fees)recordFee();
 const quote=()=>f.quotes.quote(f.a.scope,{allocation_id:allocation.id});
 const effects=()=>Number((source.db.prepare('SELECT COUNT(*) n FROM fixture_resolution_effects').get() as any).n);
 const closeReturn=()=>{const cancellation=new ReturnCancellation(f.kernel),q=cancellation.quote(f.a.scope,{request_id:f.request.id,reason:'customer_cancelled'}),preview=f.gateway.prepare(f.a.scope,q.proposal),approval=f.gateway.approve(f.reviewer.scope,{preview_id:preview.id,preview_digest:preview.digest});f.gateway.execute(f.a.scope,{preview_id:preview.id,preview_digest:preview.digest,approval_id:approval.id});return cancellation.read(f.a.scope,f.request.id);};
 return {...f,source,executor,qualification,profile,plan,allocation,currency,fees,feeInput,recordFee,moneyQuote:quote,effects,closeReturn};
}
export async function usingMoney(fn:(f:Awaited<ReturnType<typeof moneyFixture>>)=>unknown,options:{fees?:boolean;presentment?:string}={}){const f=await moneyFixture(options);try{return await fn(f);}finally{f.cleanup();}}
