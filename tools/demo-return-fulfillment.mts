import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { CommerceKernel } from '../packages/commerce/kernel.mts';
import { Capabilities } from '../packages/commerce/capabilities.mts';
import { StoreSimulator } from '../packages/commerce/simulator.mts';
import { ReadContext } from '../packages/commerce/read-context.mts';
import { Policies } from '../packages/commerce/policies.mts';
import { CustomerAccess } from '../packages/commerce/customer-access.mts';
import { ActionGateway } from '../packages/commerce/action-gateway.mts';
import { loadSkillDirectory } from '../packages/commerce/skills.mts';
import { ReturnIntake } from '../packages/commerce/return-intake.mts';
import { NativeReturns } from '../packages/commerce/native-returns.mts';
import { ShopifyReturnFixtureAdapter } from '../packages/adapters/shopify-return-fixture.mts';

import {ResolutionFixtureSource} from '../packages/adapters/resolution-fixture-source.mts';
import {ResolutionLedger} from '../packages/commerce/resolution-ledger.mts';
import {FulfillmentFixtureSource} from '../packages/adapters/fulfillment-fixture-source.mts';
import {FulfillmentConfiguration} from '../packages/commerce/return-fulfillment-core.mts';
import {ReplacementInventory} from '../packages/commerce/replacement-inventory.mts';
import {ReplacementOrders} from '../packages/commerce/replacement-orders.mts';
import {ReturnLabels} from '../packages/commerce/return-labels.mts';
import {FulfillmentExecution} from '../packages/commerce/fulfillment-execution.mts';
import {ReturnTracking} from '../packages/commerce/return-tracking.mts';
import {VariantExchanges} from '../packages/commerce/variant-exchanges.mts';

if(process.argv.length!==2)throw new Error('This synthetic headless demonstration accepts no arguments.');
const db=new DatabaseSync(':memory:'),sourceDb=new DatabaseSync(':memory:'),fulfillmentDb=new DatabaseSync(':memory:');
try {
 const at=Date.now(),kernel=new CommerceKernel(db,()=>at),caps=new Capabilities(kernel),simulator=new StoreSimulator(kernel,caps),reads=new ReadContext(kernel,caps);
 const outbox:any[]=[],customers=new CustomerAccess(kernel,m=>outbox.push(m));
 const bundle=loadSkillDirectory(fileURLToPath(new URL('../packages/commerce/skill-bundles/return-draft/',import.meta.url)));
 const gateway=new ActionGateway(kernel),intake=new ReturnIntake(kernel),policies=new Policies(kernel);
 kernel.provisionStore('demo','mixed');
 const actor=(name:string,role:'owner'|'operator'|'reviewer')=>{kernel.provisionMember('demo','mixed',name,role);const token=kernel.issueSession('demo','mixed',name);return {token,scope:kernel.authenticate(token)};};
 const owner=actor('owner','owner'),operator=actor('operator','operator'),reviewer=actor('reviewer','reviewer');simulator.reset(operator.scope);
 reads.skills.install(operator.scope,bundle);reads.profiles.put(operator.scope,{id:'default',revision:1,tenant_id:'demo',store_id:'mixed',skill_id:bundle.id,skill_digest:bundle.digest,tone:'neutral',locale:'en-US',actions:['order.status','knowledge.search','knowledge.get','skill.read'],data_scope:{order:'session_or_store',knowledge:'visible_only'}});
 const p=policies.create(operator.scope,{policy_id:'returns',expected_version:0,rules:{window_days:30,require_evidence:false,excluded_tags:['final-sale'],outcomes:['refund','exchange','store_credit']},selection:'pin_at_request',sources:[{uri:'https://merchant.example.invalid/policy',revision:'1',sha256:'a'.repeat(64)}]});
 policies.test(operator.scope,'returns',1,p.digest);policies.review(reviewer.scope,'returns',1,p.digest);policies.publish(owner.scope,{policy_id:'returns',version:1,digest:p.digest,expected_published_version:0,effective_at:at});
 const original=kernel.lookup(operator.scope,'order','synthetic','ORD-1001');
 const paid_lines=[{id:'alpha',product_id:'shirt',variant_id:'shirt-small',quantity:3,gross_minor:'6000',discount_minor:'600',tax_minor:'300',shipping_minor:'90',duties_minor:'30',resolved_units:[1]},
 {id:'beta',product_id:'hat',variant_id:'hat-small',quantity:2,gross_minor:'2000',discount_minor:'200',tax_minor:'100',shipping_minor:'20',duties_minor:'0',resolved_units:[]},
 {id:'gamma',product_id:'shoe',variant_id:'shoe-small',quantity:1,gross_minor:'1000',discount_minor:'0',tax_minor:'0',shipping_minor:'0',duties_minor:'0',resolved_units:[]}];
 const lines=paid_lines.map((x,i)=>({id:x.id,fulfillment_line_id:'gid://shopify/FulfillmentLineItem/'+(101+i),ordered:x.quantity,fulfilled:x.quantity,returned:x.resolved_units.length,unit_minor:i===0?'1800':i===1?'900':'1000',tags:[]}));
 const order=kernel.ingest(operator.scope,{kind:'order',source_system:'synthetic',external_id:original.external_id,source_version:2,source_updated_at:at,customer_id:original.customer_id,payload:{...original.payload,total_minor:'8740',delivered_at:at-3*86400000,tags:[],evidence_verified:true,native_order_id:'gid://shopify/Order/201',counted_return_ids:[],return_lines:lines,resolution_facts:{revision:1,observed_at:at,currency:'USD',payment_id:'demo-payment',original_paid_minor:'8740',prior_refunded_minor:'1940',accounted_operations:[],paid_lines}}});
 const challenge=customers.request({store_id:'mixed',order_number:'ORD-1001',email:'shopper-apparel@example.invalid'},'127.0.0.1');const verified=customers.complete({store_id:'mixed',challenge_id:challenge.challenge_id,proof:outbox.at(-1).proof});outbox.length=0;const customer=kernel.authenticate(verified.token);
 gateway.configure(owner.scope,{enabled:true,expected_revision:0,profile_id:'default',policy_id:'returns'});gateway.cases.create(customer,{case_id:'mixed_case',resource_id:order.id,profile_id:'default',policy_id:'returns'});
 intake.configure(owner.scope,{expected_revision:0,settings:{currency:'USD',restocking_bps:0,shipping_minor:'0',time_zone:'America/Denver',brand:'Sample apparel',contact:'support@example.invalid',override_days:7,retention_days:30}});
 const q=intake.evaluate(customer,{case_id:'mixed_case',lines:lines.map(l=>({line_id:l.id,quantity:1})),outcome:'refund',reason:'size',note:'',evidence_ids:[]});
 const request=intake.prepare(customer,{quote_id:q.id,quote_digest:q.digest,request_key:'mixed-request',override_id:null});const approve=gateway.approve(reviewer.scope,{preview_id:request.preview_id,preview_digest:request.preview_digest});gateway.execute(operator.scope,{preview_id:request.preview_id,preview_digest:request.preview_digest,approval_id:approve.id});
 const native=new NativeReturns(kernel,new ShopifyReturnFixtureAdapter({
  mode:'fixture',identity:'native-demo',tenant:'demo',store:'mixed',
  transport:async({variables})=>{
   const record={id:'gid://shopify/Return/901',status:'OPEN',order:{id:variables.returnInput.orderId},
    returnLineItems:{nodes:variables.returnInput.returnLineItems.map((l:any,i:number)=>({id:'gid://shopify/ReturnLineItem/'+(901+i),quantity:l.quantity,returnReasonNote:l.returnReasonNote,fulfillmentLineItem:{id:l.fulfillmentLineItemId}})),pageInfo:{hasNextPage:false}},
    reverseFulfillmentOrders:{nodes:[{id:'gid://shopify/ReverseFulfillmentOrder/901'}],pageInfo:{hasNextPage:false}}};
   return {status:200,api_version:'2026-10',body:{data:{returnCreate:{userErrors:[],return:record}}}};
  }
 }));
 await native.create(operator.scope,request.id);
 const source=new ResolutionFixtureSource(sourceDb,{mode:'fixture',identity:'demo-ledger',tenant:'demo',store:'mixed'});source.seed({resource_id:order.id,customer_id:order.customer_id,payment_id:'demo-payment',currency:'USD',available_minor:'6800'});
 const ledger=new ResolutionLedger(kernel);ledger.configure(owner.scope,{expected_revision:0,enabled:true,source_identity:source.identity,credit_instrument:'native_store_credit',expires_at:at+3600000,inventory_buffer:2});
 const plan=ledger.allocate(operator.scope,{request_id:request.id,request_key:'mixed-allocation',lines:[{line_id:'alpha',units:[2],outcome:'refund'},{line_id:'beta',units:[1],outcome:'store_credit'},{line_id:'gamma',units:[1],outcome:'exchange'}]});
 const nativeSource=new FulfillmentFixtureSource(fulfillmentDb,{mode:'fixture',identity:'carrier-inventory-demo',tenant:'demo',store:'mixed',clock:()=>at});
 new FulfillmentConfiguration(kernel).configure(owner.scope,{expected_revision:0,enabled:true,source_identity:nativeSource.identity,account_id:'demo-carrier-account',expires_at:at+3600000,resolution_trigger:'carrier_delivery'});
 const catalog=kernel.ingest(operator.scope,{kind:'catalog',source_system:'synthetic',external_id:'shoe-large',source_version:1,source_updated_at:at,customer_id:null,payload:{variant_id:'shoe-large',product_id:'shoe',currency:'USD',unit_price_minor:'1000',tax_per_unit_minor:'0',shipping_minor:'0',duties_per_unit_minor:'0',available:3,discount_eligible:true,promotion_expires_at:at+60000,excluded:false}});
 nativeSource.seedStock({catalog_id:catalog.id,variant_id:'shoe-large',location_id:'warehouse-one',version:1,available:3});
 nativeSource.seedRate({service:'ground',revision:1,amount_minor:'500',currency:'USD',expires_at:at+300000});
 const exchanges=new VariantExchanges(kernel),inventory=new ReplacementInventory(kernel,nativeSource),orders=new ReplacementOrders(kernel),labels=new ReturnLabels(kernel,nativeSource),execution=new FulfillmentExecution(kernel,nativeSource),tracking=new ReturnTracking(execution);
 const authorize=(q:any)=>{const p=gateway.prepare(operator.scope,q.proposal),a=gateway.approve(reviewer.scope,{preview_id:p.id,preview_digest:p.digest});return gateway.execute(operator.scope,{preview_id:p.id,preview_digest:p.digest,approval_id:a.id}).fulfillment_operation_id;};
 const exchange=exchanges.quote(operator.scope,{allocation_id:plan.allocations[2].id,catalog_id:catalog.id});
 const reservation=inventory.reserve(operator.scope,{quote_id:exchange.id,quote_digest:exchange.digest,location_id:'warehouse-one',ttl_ms:50000});
 const replacementId=authorize(orders.quote(operator.scope,{reservation_id:reservation.id}));nativeSource.fault='after';
 const unknown=await execution.dispatch(operator.scope,replacementId);await execution.dispatch(operator.scope,replacementId);const replacement=await execution.reconcile(operator.scope,replacementId);
 labels.configureParcel(owner.scope,{case_id:'mixed_case',request_id:request.id,expected_revision:0,from_address_ref:'customer-address',to_address_ref:'warehouse-address',address_revision:1,package:{weight_g:500,length_mm:200,width_mm:100,height_mm:100},service:'ground'});
 const quoted=labels.quote(operator.scope,{request_id:request.id,replaces:null}),labelCallsBefore=nativeSource.calls.buy,labelOp=authorize(quoted);
 const first=await execution.dispatch(operator.scope,labelOp),voidOp=authorize(labels.quoteVoid(operator.scope,{label_id:first.native_id!}));
 await execution.dispatch(operator.scope,voidOp);const requested=labels.inspect(operator.scope,first.native_id!);
 nativeSource.confirmVoid(first.native_id!,true);await execution.reconcile(operator.scope,voidOp);
 const replacementLabelOp=authorize(labels.quote(operator.scope,{request_id:request.id,replaces:first.native_id}));const second=await execution.dispatch(operator.scope,replacementLabelOp);
 const oldBeforeReimbursement=labels.inspect(operator.scope,first.native_id!);nativeSource.reimburse(first.native_id!);await execution.reconcile(operator.scope,voidOp);
 nativeSource.carrierEvent(second.native_id!,{id:'delivered-demo',sequence:1,status:'delivered',at});const status=await tracking.refresh(operator.scope,second.native_id!);
 console.log(JSON.stringify({evidence_kind:'synthetic_return_fulfillment',reservation,replacement:{after_lost_response:unknown.state,after_reconciliation:replacement.state,create_calls:nativeSource.calls.replace,source_stock:nativeSource.stock(catalog.id),order:replacement.replacement},label_quote:{amount_minor:quoted.quote.amount_minor,currency:quoted.quote.currency,purchases_before_approval:labelCallsBefore},void_request:requested,old_label_before_reimbursement:oldBeforeReimbursement,old_label_after_reimbursement:labels.inspect(operator.scope,first.native_id!),current_label:labels.inspect(operator.scope,second.native_id!),tracking:status,source_effect_count:nativeSource.effects().length,external_calls:0,production_qualified:false},null,2));
}finally{db.close();sourceDb.close();fulfillmentDb.close();}
