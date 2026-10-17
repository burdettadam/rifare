import { readFileSync } from 'node:fs';
import { resolutionFixture } from './resolution-helpers.mts';
import { ExchangeFinance,exchangeSettlement } from '../../packages/commerce/exchange-finance.mts';
import { ResolutionFixtureSource } from '../../packages/adapters/resolution-fixture-source.mts';
import { ResolutionExecution } from '../../packages/commerce/resolution-execution.mts';
export const oracle=JSON.parse(readFileSync(new URL('../fixtures/exchange-finance/independent-values.json',import.meta.url),'utf8'));
export function configureFinance(f:any,patch:any={}){f.exchanges.configure(f.owner.scope,{expected_revision:0,enabled:true,catalog_wide:true,price_differences:true,allowed_product_ids:[],excluded_product_ids:[],excluded_categories:[],incentive_bps:0,incentive_cap_minor:'0',minimum_margin_bps:0,expires_at:f.now()+300000,...patch});}
export function mixedFacts(f:any){const facts=structuredClone(f.facts);facts.instrument_allocations={rule:'original_unit_proportional_v1',instruments:[{id:'card-original',type:'card',original_paid_minor:'5244',prior_refunded_minor:'1164',supported:true},{id:'gift-original',type:'gift_card',original_paid_minor:'3496',prior_refunded_minor:'776',supported:true}],units:[]};
 for(const line of facts.paid_lines)for(let n=1;n<=line.quantity;n++){const shares=line.id==='alpha'?['1164','776']:line.id==='beta'?['576','384']:['600','400'];facts.instrument_allocations.units.push({line_id:line.id,unit_index:n,amounts:[{instrument_id:'card-original',amount_minor:shares[0]},{instrument_id:'gift-original',amount_minor:shares[1]}]});}return facts;}
export async function financeFixture(options:{mixed?:boolean,price?:string}={}){const f=await resolutionFixture({zeroFees:true}),source=new ResolutionFixtureSource(f.sourceDb,{mode:'fixture',identity:'source-one',tenant:f.a.tenant,store:f.a.store},f.now),executor=new ResolutionExecution(f.kernel,source);
 configureFinance(f);const facts=options.mixed?mixedFacts(f):f.facts;if(options.mixed){f.update({resolution_facts:facts});source.seedInstruments(f.order().id,facts.instrument_allocations.instruments,facts.instrument_allocations.units);}
 const plan=f.allocate(),allocation=plan.allocations.find(a=>a.outcome==='exchange')!,catalog=f.catalog({unit_price_minor:options.price??'1250'}),exchange=f.exchanges.quote(f.a.scope,{allocation_id:allocation.id,catalog_id:catalog.id}),finance=new ExchangeFinance(f.kernel);
 const quote=(outcome='additional_payment')=>finance.quote(f.a.scope,{exchange_quote_id:exchange.id,exchange_quote_digest:exchange.digest,outcome});
 const current=()=>f.exchanges.validateForReview(f.a.scope,{quote_id:exchange.id,quote_digest:exchange.digest});
 const settlement=()=>exchangeSettlement(f.kernel,f.a.scope,current());
 return {...f,facts,source,executor,plan,allocation,catalogResource:catalog,exchange,finance,financeQuote:quote,current,settlement};
}
export async function usingFinance(fn:(f:Awaited<ReturnType<typeof financeFixture>>)=>unknown,options:{mixed?:boolean,price?:string}={}){const f=await financeFixture(options);try{return await fn(f);}finally{f.cleanup();}}
