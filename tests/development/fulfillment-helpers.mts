import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { resolutionFixture } from './resolution-helpers.mts';
import { FulfillmentFixtureSource } from '../../packages/adapters/fulfillment-fixture-source.mts';
import { FulfillmentConfiguration } from '../../packages/commerce/return-fulfillment-core.mts';
import { ReplacementInventory } from '../../packages/commerce/replacement-inventory.mts';
import { ReplacementOrders } from '../../packages/commerce/replacement-orders.mts';
import { ReturnLabels } from '../../packages/commerce/return-labels.mts';
import { FulfillmentExecution } from '../../packages/commerce/fulfillment-execution.mts';
import { ReturnTracking } from '../../packages/commerce/return-tracking.mts';
import { CustomerAccess } from '../../packages/commerce/customer-access.mts';
import { NativeReturns } from '../../packages/commerce/native-returns.mts';
import { ShopifyReturnFixtureAdapter } from '../../packages/adapters/shopify-return-fixture.mts';

export async function fulfillmentFixture(options:{label_ttl_ms?:number}={}){const f=await resolutionFixture({zeroFees:true}),sourceFile=join(f.directory,'fulfillment.sqlite'),sourceDb=new DatabaseSync(sourceFile),source=new FulfillmentFixtureSource(sourceDb,{mode:'fixture',identity:'fulfillment-one',tenant:f.a.tenant,store:f.a.store,clock:f.now,...options});
 const config=new FulfillmentConfiguration(f.kernel),configInput={expected_revision:0,enabled:true,source_identity:source.identity,account_id:'carrier-one',expires_at:f.now()+3600000,resolution_trigger:'carrier_delivery'};
 config.configure(f.owner.scope,configInput);const plan=f.allocate(),allocation=plan.allocations.find(a=>a.outcome==='exchange'),catalog=f.catalog({available:3}),exchange=f.exchanges.quote(f.a.scope,{allocation_id:allocation.id,catalog_id:catalog.id});
 source.seedStock({catalog_id:catalog.id,variant_id:'shoe-large',location_id:'warehouse-one',version:1,available:3});source.seedRate({service:'ground',revision:1,amount_minor:'500',currency:'USD',expires_at:f.now()+300000});
 const inventory=new ReplacementInventory(f.kernel,source),orders=new ReplacementOrders(f.kernel),labels=new ReturnLabels(f.kernel,source),execution=new FulfillmentExecution(f.kernel,source),tracking=new ReturnTracking(execution);
 const parcelInput={case_id:'resolution_case',request_id:f.request.id,expected_revision:0,from_address_ref:'customer-address-one',to_address_ref:'warehouse-address-one',address_revision:1,package:{weight_g:500,length_mm:200,width_mm:100,height_mm:100},service:'ground'};
 labels.configureParcel(f.owner.scope,parcelInput);
 const reserve=(q=exchange,overrides:any={})=>inventory.reserve(f.a.scope,{quote_id:q.id,quote_digest:q.digest,location_id:'warehouse-one',ttl_ms:50000,...overrides});
 const authorizeFulfillment=(q:any)=>{const p=f.gateway.prepare(f.a.scope,q.proposal),a=f.gateway.approve(f.reviewer.scope,{preview_id:p.id,preview_digest:p.digest}),r=f.gateway.execute(f.a.scope,{preview_id:p.id,preview_digest:p.digest,approval_id:a.id});return {id:r.fulfillment_operation_id,preview:p,approval:a,receipt:r};};
 const replacement=()=>{const r=reserve();return {...authorizeFulfillment(orders.quote(f.a.scope,{reservation_id:r.id})),reservation:r};};
 const buy=async(replaces:string|null=null)=>{const q=labels.quote(f.a.scope,{request_id:f.request.id,replaces}),op=authorizeFulfillment(q),result=await execution.dispatch(f.a.scope,op.id);return {...op,result,labelId:result.native_id!};};
 const voidLabel=async(labelId:string)=>{const q=labels.quoteVoid(f.a.scope,{label_id:labelId}),op=authorizeFulfillment(q),result=await execution.dispatch(f.a.scope,op.id);return {...op,result};};
 async function secondExchange(){const current=f.order(),order=f.kernel.ingest(f.a.scope,{kind:'order',source_system:'synthetic',external_id:'ORD-2002',source_version:1,source_updated_at:f.now(),customer_id:current.customer_id,payload:{...current.payload,native_order_id:'gid://shopify/Order/202'}});
  const outbox:any[]=[],access=new CustomerAccess(f.kernel,p=>outbox.push(p)),challenge=access.request({store_id:f.a.store,order_number:'ORD-2002',email:'shopper-apparel@example.invalid'},'127.0.0.2'),verified=access.complete({store_id:f.a.store,challenge_id:challenge.challenge_id,proof:outbox[0].proof}),customer=f.kernel.authenticate(verified.token);
  f.cases.create(customer,{case_id:'second_case',resource_id:order.id,profile_id:'default',policy_id:'returns'});const q=f.intake.evaluate(customer,{case_id:'second_case',lines:[{line_id:'gamma',quantity:1}],outcome:'exchange',reason:'size',note:'',evidence_ids:[]});
  const req=f.intake.prepare(customer,{quote_id:q.id,quote_digest:q.digest,request_key:'second-request',override_id:null});f.submit(req);
  const adapter=new ShopifyReturnFixtureAdapter({mode:'fixture',identity:'second-native',tenant:f.a.tenant,store:f.a.store,
   transport:async({variables})=>{
    const record={id:'gid://shopify/Return/920',status:'OPEN',order:{id:variables.returnInput.orderId},
     returnLineItems:{nodes:variables.returnInput.returnLineItems.map((l:any)=>({id:'gid://shopify/ReturnLineItem/921',quantity:l.quantity,returnReasonNote:l.returnReasonNote,fulfillmentLineItem:{id:l.fulfillmentLineItemId}})),pageInfo:{hasNextPage:false}},
     reverseFulfillmentOrders:{nodes:[{id:'gid://shopify/ReverseFulfillmentOrder/921'}],pageInfo:{hasNextPage:false}}};
    return {status:200,api_version:'2026-10',body:{data:{returnCreate:{userErrors:[],return:record}}}};
   }});
  await new NativeReturns(f.kernel,adapter).create(f.a.scope,req.id);const plan=f.ledger.allocate(f.a.scope,{request_id:req.id,request_key:'second-allocation',lines:[{line_id:'gamma',units:[1],outcome:'exchange'}]}),alloc=plan.allocations[0];
  return {customer,caseId:'second_case',request:req,allocation:alloc,quote:f.exchanges.quote(f.a.scope,{allocation_id:alloc.id,catalog_id:catalog.id})};
 }
 return {...f,sourceFile,fulfillmentDb:sourceDb,fulfillmentSource:source,config,configInput,plan,allocation,catalogResource:catalog,exchange,inventory,orders,labels,execution,tracking,parcelInput,reserve,authorizeFulfillment,replacement,buy,voidLabel,secondExchange,
  cleanup:()=>{sourceDb.close();f.cleanup();}};
}
export async function usingFulfillment(fn:(f:Awaited<ReturnType<typeof fulfillmentFixture>>)=>unknown){const f=await fulfillmentFixture();try{return await fn(f);}finally{f.cleanup();}}
