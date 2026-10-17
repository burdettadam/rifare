import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { returnFixture } from './return-intake-helpers.mts';
import { ResolutionLedger } from '../../packages/commerce/resolution-ledger.mts';
import { RefundQuotes } from '../../packages/commerce/refund-quotes.mts';
import { StoreCredit } from '../../packages/commerce/store-credit.mts';
import { ResolutionExecution } from '../../packages/commerce/resolution-execution.mts';
import { VariantExchanges } from '../../packages/commerce/variant-exchanges.mts';
import { NativeReturns } from '../../packages/commerce/native-returns.mts';
import { ShopifyReturnFixtureAdapter } from '../../packages/adapters/shopify-return-fixture.mts';
import { ResolutionFixtureSource } from '../../packages/adapters/resolution-fixture-source.mts';

export async function resolutionFixture(options:any={}) {
 const f=returnFixture();if(options.zeroFees)f.intake.configure(f.owner.scope,{expected_revision:1,settings:{...f.settings,restocking_bps:0,shipping_minor:'0'}});f.advance(1);f.publish({expected_version:1,rules:{window_days:30,require_evidence:false,excluded_tags:['final-sale'],outcomes:['refund','exchange','store_credit']}});
 const update=(changes:any={})=>{const order=f.order();return f.kernel.ingest(f.a.scope,{kind:'order',source_system:'synthetic',external_id:order.external_id,source_version:order.source_version+1,source_updated_at:f.now(),customer_id:order.customer_id,payload:{...order.payload,...changes}});};
 const paid_lines=[{id:'alpha',product_id:'shirt',variant_id:'shirt-small',quantity:3,gross_minor:'6000',discount_minor:'600',tax_minor:'300',shipping_minor:'90',duties_minor:'30',resolved_units:[1]},
  {id:'beta',product_id:'hat',variant_id:'hat-small',quantity:2,gross_minor:'2000',discount_minor:'200',tax_minor:'100',shipping_minor:'20',duties_minor:'0',resolved_units:[]},
  {id:'gamma',product_id:'shoe',variant_id:'shoe-small',quantity:1,gross_minor:'1000',discount_minor:'0',tax_minor:'0',shipping_minor:'0',duties_minor:'0',resolved_units:[]}];
 const facts={revision:1,observed_at:f.now(),currency:'USD',payment_id:'payment-one',original_paid_minor:'8740',prior_refunded_minor:'1940',accounted_operations:[],paid_lines};
 const lines=paid_lines.map((p,i)=>({id:p.id,fulfillment_line_id:'gid://shopify/FulfillmentLineItem/'+(101+i),ordered:p.quantity,fulfilled:p.quantity,returned:p.resolved_units.length,unit_minor:i===0?'1800':i===1?'900':'1000',tags:[]}));
 update({return_lines:lines,total_minor:'8740',resolution_facts:facts});
 f.cases.create(f.customer,{case_id:'resolution_case',resource_id:f.order().id,profile_id:'default',policy_id:'returns'});
 const q=f.intake.evaluate(f.customer,{case_id:'resolution_case',lines:lines.map(l=>({line_id:l.id,quantity:1})),outcome:'refund',reason:'size',note:'',evidence_ids:[]});
 const request=f.intake.prepare(f.customer,{quote_id:q.id,quote_digest:q.digest,request_key:'resolution-request',override_id:null});f.submit(request);
 const returnAdapter=new ShopifyReturnFixtureAdapter({
  mode:'fixture',identity:'native-fixture',tenant:f.a.tenant,store:f.a.store,
  transport:async({variables})=>{
   const record={id:'gid://shopify/Return/900',status:'OPEN',order:{id:variables.returnInput.orderId},
    returnLineItems:{nodes:variables.returnInput.returnLineItems.map((l:any,i:number)=>({id:'gid://shopify/ReturnLineItem/'+(901+i),quantity:l.quantity,returnReasonNote:l.returnReasonNote,fulfillmentLineItem:{id:l.fulfillmentLineItemId}})),pageInfo:{hasNextPage:false}},
    reverseFulfillmentOrders:{nodes:[{id:'gid://shopify/ReverseFulfillmentOrder/901'}],pageInfo:{hasNextPage:false}}};
   return {status:200,api_version:'2026-10',body:{data:{returnCreate:{userErrors:[],return:record}}}};
  }
 });
 if(!options.noNative)await new NativeReturns(f.kernel,returnAdapter).create(f.a.scope,request.id);
 const sourceFilename=join(f.directory,'source.sqlite'),sourceDb=new DatabaseSync(sourceFilename),source=new ResolutionFixtureSource(sourceDb,{mode:'fixture',identity:'source-one',tenant:f.a.tenant,store:f.a.store});
 source.seed({resource_id:f.order().id,customer_id:f.order().customer_id,payment_id:'payment-one',currency:'USD',available_minor:options.sourceBalance??'6800'});
 const ledger=new ResolutionLedger(f.kernel);ledger.configure(f.owner.scope,{expected_revision:0,enabled:true,source_identity:source.identity,credit_instrument:'native_store_credit',expires_at:f.now()+3600000,inventory_buffer:2});
 const intent=(extra:any={})=>({request_id:request.id,request_key:'allocation-one',lines:[{line_id:'alpha',units:[2],outcome:'refund'},{line_id:'beta',units:[1],outcome:'store_credit'},{line_id:'gamma',units:[1],outcome:'exchange'}],...extra});
 const allocate=(i:any=intent())=>ledger.allocate(f.a.scope,i),quotes=new RefundQuotes(f.kernel),credit=new StoreCredit(f.kernel),executor=new ResolutionExecution(f.kernel,source),exchanges=new VariantExchanges(f.kernel);
 const quote=(a:any)=>quotes.quote(f.a.scope,{allocation_id:a.id??a});
 const authorize=(q:any)=>{const p=f.gateway.prepare(f.a.scope,q.proposal),a=f.gateway.approve(f.reviewer.scope,{preview_id:p.id,preview_digest:p.digest}),receipt=f.gateway.execute(f.a.scope,{preview_id:p.id,preview_digest:p.digest,approval_id:a.id});return {preview:p,approval:a,receipt,id:receipt.resolution_operation_id};};
 const catalog=(overrides:any={})=>f.kernel.ingest(f.a.scope,{kind:'catalog',source_system:'synthetic',external_id:'shoe-large',source_version:1,source_updated_at:f.now(),customer_id:null,payload:{variant_id:'shoe-large',product_id:'shoe',currency:'USD',unit_price_minor:'1000',tax_per_unit_minor:'0',shipping_minor:'0',duties_per_unit_minor:'0',available:5,discount_eligible:true,promotion_expires_at:f.now()+60000,excluded:false,...overrides}});
 return {...f,request,sourceFilename,sourceDb,source,ledger,quotes,credit,executor,exchanges,facts,paid_lines,update,intent,allocate,quote,authorize,catalog,
  cleanup:()=>{sourceDb.close();f.cleanup();}};
}
export async function usingResolution(fn:(f:Awaited<ReturnType<typeof resolutionFixture>>)=>unknown,options:any={}){const f=await resolutionFixture(options);try{return await fn(f);}finally{f.cleanup();}}
