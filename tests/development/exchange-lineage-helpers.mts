import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { resolutionFixture } from './resolution-helpers.mts';
import { configureFinance,mixedFacts } from './exchange-finance-helpers.mts';
import { ResolutionFixtureSource } from '../../packages/adapters/resolution-fixture-source.mts';
import { ResolutionExecution } from '../../packages/commerce/resolution-execution.mts';
import { ExchangeFinance } from '../../packages/commerce/exchange-finance.mts';
import { FulfillmentFixtureSource } from '../../packages/adapters/fulfillment-fixture-source.mts';
import { FulfillmentConfiguration } from '../../packages/commerce/return-fulfillment-core.mts';
import { ReplacementInventory } from '../../packages/commerce/replacement-inventory.mts';
import { ReplacementOrders } from '../../packages/commerce/replacement-orders.mts';
import { FulfillmentExecution } from '../../packages/commerce/fulfillment-execution.mts';
import { ExchangeLineageFixtureSource } from '../../packages/adapters/exchange-lineage-fixture-source.mts';
import { ExchangeLineage } from '../../packages/commerce/exchange-lineage.mts';
import { CustomerAccess } from '../../packages/commerce/customer-access.mts';
import { NativeReturns } from '../../packages/commerce/native-returns.mts';
import { ShopifyReturnFixtureAdapter } from '../../packages/adapters/shopify-return-fixture.mts';
export const lineageOracle=JSON.parse(readFileSync(new URL('../fixtures/exchange-lineage/independent-values.json',import.meta.url),'utf8'));
export async function lineageFixture(options:{mixed?:boolean,triad?:boolean,zero?:boolean,fees?:boolean,discount?:boolean,registerOriginal?:boolean}={}){
 const f=await resolutionFixture({zeroFees:true}),facts:any=options.mixed?mixedFacts(f):structuredClone(f.facts);
 if(options.triad){facts.instrument_allocations={rule:'original_unit_proportional_v1',instruments:[{id:'a_card',type:'card',original_paid_minor:'7744',prior_refunded_minor:'1940',supported:true},{id:'b_card',type:'card',original_paid_minor:'33',prior_refunded_minor:'0',supported:true},{id:'c_gift',type:'gift_card',original_paid_minor:'963',prior_refunded_minor:'0',supported:true}],units:facts.paid_lines.flatMap((l:any)=>Array.from({length:l.quantity},(_,i)=>({line_id:l.id,unit_index:i+1,amounts:l.id==='gamma'?[{instrument_id:'a_card',amount_minor:'4'},{instrument_id:'b_card',amount_minor:'33'},{instrument_id:'c_gift',amount_minor:'963'}]:[{instrument_id:'a_card',amount_minor:l.id==='alpha'?'1940':'960'}]})))};}
 if(options.zero){facts.paid_lines[2].gross_minor='1500';facts.paid_lines[2].discount_minor='1500';facts.original_paid_minor='7740';f.sourceDb.prepare('UPDATE fixture_resolution_accounts SET available_minor=? WHERE resource_id=?').run('5800',f.order().id);
  facts.bundle_allocations={treatment:'preserve_original_paid',promotion_rule:'retain_remaining_components',groups:[{id:'gift_bundle',promotion_id:'free_promo',original_paid_minor:'0',components:[{line_id:'gamma',fulfillment_line_id:'gid://shopify/FulfillmentLineItem/103',paid_minor:'0',retail_minor:'1500',promotion_role:'zero_price_gift'}]}]};
  f.ledger.configure(f.owner.scope,{expected_revision:1,enabled:true,source_identity:f.source.identity,credit_instrument:'native_store_credit',expires_at:f.now()+300000,inventory_buffer:2,bundle_policy:'preserve_original_paid'});
 }
 if(options.discount){facts.paid_lines[2].gross_minor='1200';facts.paid_lines[2].discount_minor='200';}
 if(options.fees)f.intake.configure(f.owner.scope,{expected_revision:2,settings:{...f.settings,restocking_bps:1000,shipping_minor:'0'}});
 f.update({resolution_facts:facts,total_minor:facts.original_paid_minor});configureFinance(f);
 const source=new ResolutionFixtureSource(f.sourceDb,{mode:'fixture',identity:'source-one',tenant:f.a.tenant,store:f.a.store},f.now),executor=new ResolutionExecution(f.kernel,source);
 if(facts.instrument_allocations)source.seedInstruments(f.order().id,facts.instrument_allocations.instruments,facts.instrument_allocations.units);
 const fulfillmentDb=new DatabaseSync(join(f.directory,'lineage-stock.sqlite')),fulfillmentSource=new FulfillmentFixtureSource(fulfillmentDb,{mode:'fixture',tenant:f.a.tenant,store:f.a.store,identity:'lineage-stock',clock:f.now,finance_source:source});
 new FulfillmentConfiguration(f.kernel).configure(f.owner.scope,{expected_revision:0,enabled:true,source_identity:fulfillmentSource.identity,account_id:'lineage_warehouse',expires_at:f.now()+3600000,resolution_trigger:'manual'});
 const lineageSource=new ExchangeLineageFixtureSource(source,fulfillmentSource);if(options.registerOriginal!==false)lineageSource.seedOriginal({resource_id:f.order().id,customer_id:f.order().customer_id,payment_id:facts.payment_id,currency:facts.currency,native_order_id:f.order().payload.native_order_id,original_paid_minor:facts.original_paid_minor,prior_refunded_minor:facts.prior_refunded_minor,paid_lines:facts.paid_lines,...(facts.instrument_allocations?{instrument_allocations:facts.instrument_allocations}:{}),...(facts.bundle_allocations?{bundle_allocations:facts.bundle_allocations}:{})});
 const lineage=new ExchangeLineage(f.kernel,lineageSource),inventory=new ReplacementInventory(f.kernel,fulfillmentSource),orders=new ReplacementOrders(f.kernel),execution=new FulfillmentExecution(f.kernel,fulfillmentSource),finance=new ExchangeFinance(f.kernel),plan=f.allocate(),allocation=plan.allocations.find(a=>a.outcome==='exchange')!;
 let sequence=0;
 const authorizeFulfillment=(q:any)=>{const p=f.gateway.prepare(f.a.scope,q.proposal),a=f.gateway.approve(f.reviewer.scope,{preview_id:p.id,preview_digest:p.digest}),receipt=f.gateway.execute(f.a.scope,{preview_id:p.id,preview_digest:p.digest,approval_id:a.id});return {id:receipt.fulfillment_operation_id,receipt};};
 const makeExchange=async(alloc:any,price:string,options:{settle?:boolean,deliver?:boolean,outcome?:string}={})=>{const n=++sequence,catalog=f.kernel.ingest(f.a.scope,{kind:'catalog',source_system:'synthetic',external_id:'lineage_catalog_'+n,source_version:1,source_updated_at:f.now(),customer_id:null,payload:{variant_id:'lineage_variant_'+n,product_id:'shoe',currency:'USD',unit_price_minor:price,tax_per_unit_minor:'0',shipping_minor:'0',duties_per_unit_minor:'0',available:10,discount_eligible:true,promotion_expires_at:f.now()+60000,excluded:false}});
  fulfillmentSource.seedStock({catalog_id:catalog.id,variant_id:catalog.payload.variant_id,location_id:'warehouse_one',version:1,available:10});
  const q=f.exchanges.quote(f.a.scope,{allocation_id:alloc.id,catalog_id:catalog.id});let financial:any=null;
  if(q.quote.balance_minor!=='0'&&options.settle!==false){financial=f.authorize(finance.quote(f.a.scope,{exchange_quote_id:q.id,exchange_quote_digest:q.digest,outcome:options.outcome??(BigInt(q.quote.balance_minor)>0n?'additional_payment':'refund')}));await executor.dispatch(f.a.scope,financial.id);if(BigInt(q.quote.balance_minor)>0n)source.settlePayment(financial.id);else if(options.outcome!=='store_credit')source.settle(financial.id);await executor.reconcile(f.a.scope,financial.id);}
  const reservation=inventory.reserve(f.a.scope,{quote_id:q.id,quote_digest:q.digest,location_id:'warehouse_one',ttl_ms:50000});const fq=orders.quote(f.a.scope,{reservation_id:reservation.id}),op=authorizeFulfillment(fq),result=await execution.dispatch(f.a.scope,op.id);
  if(result.state==='created'&&options.deliver!==false){fulfillmentSource.fulfillReplacement(result.replacement.id,'shipment_'+n);fulfillmentSource.deliverReplacement(result.replacement.id,{event_id:'delivery_'+n,delivered_at:f.now()});await execution.reconcile(f.a.scope,op.id);}
  return {q,catalog,reservation,op,result,financial};};
 const openChild=async(node:any,outcome='exchange')=>{const order=f.kernel.get(f.a.scope,node.resource_id),proofs:any[]=[],customers=new CustomerAccess(f.kernel,p=>proofs.push(p)),n=++sequence,challenge=customers.request({store_id:f.a.store,order_number:node.external_id,email:'shopper-apparel@example.invalid'},'lineage_client_'+n),session=customers.complete({store_id:f.a.store,challenge_id:challenge.challenge_id,proof:proofs.at(-1).proof}),customer=f.kernel.authenticate(session.token),caseId='lineage_case_'+n;
  f.cases.create(customer,{case_id:caseId,resource_id:order.id,profile_id:'default',policy_id:'returns'});const q=f.intake.evaluate(customer,{case_id:caseId,lines:[{line_id:node.line_id,quantity:1}],outcome,reason:'size',note:'',evidence_ids:[]}),request=f.intake.prepare(customer,{quote_id:q.id,quote_digest:q.digest,request_key:'lineage_request_'+n,override_id:null});f.submit(request);
  const adapter=new ShopifyReturnFixtureAdapter({mode:'fixture',identity:'lineage-return-'+n,tenant:f.a.tenant,store:f.a.store,transport:async({variables})=>{
   const returned={id:'gid://shopify/Return/'+(10000+n),status:'OPEN',order:{id:variables.returnInput.orderId},
    returnLineItems:{nodes:variables.returnInput.returnLineItems.map((l:any,i:number)=>({id:'gid://shopify/ReturnLineItem/'+(20000+n*10+i),quantity:l.quantity,returnReasonNote:l.returnReasonNote,fulfillmentLineItem:{id:l.fulfillmentLineItemId}})),pageInfo:{hasNextPage:false}},
    reverseFulfillmentOrders:{nodes:[{id:'gid://shopify/ReverseFulfillmentOrder/'+(30000+n)}],pageInfo:{hasNextPage:false}}};
   return {status:200,api_version:'2026-10',body:{data:{returnCreate:{userErrors:[],return:returned}}}};
  }});
  await new NativeReturns(f.kernel,adapter).create(f.a.scope,request.id);const plan=f.ledger.allocate(f.a.scope,{request_id:request.id,request_key:'lineage_allocation_'+n,lines:[{line_id:node.line_id,units:[1],outcome}]});return {customer,caseId,request,allocation:plan.allocations[0],order};};
 return {...f,facts,source,executor,fulfillmentDb,fulfillmentSource,lineageSource,lineage,inventory,orders,execution,finance,plan,allocation,makeExchange,openChild,authorizeFulfillment,cleanup:()=>{fulfillmentDb.close();f.cleanup();}};
}
export async function usingLineage(fn:(f:Awaited<ReturnType<typeof lineageFixture>>)=>unknown,options:Parameters<typeof lineageFixture>[0]={}){const f=await lineageFixture(options);try{return await fn(f);}finally{f.cleanup();}}
