import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { CommerceKernel } from '../commerce/kernel.mts';
import { Capabilities } from '../commerce/capabilities.mts';
import { StoreSimulator } from '../commerce/simulator.mts';
import { ReadContext } from '../commerce/read-context.mts';
import { Policies } from '../commerce/policies.mts';
import { CustomerAccess } from '../commerce/customer-access.mts';
import { ActionGateway } from '../commerce/action-gateway.mts';
import { loadSkillDirectory } from '../commerce/skills.mts';
import { ReturnIntake } from '../commerce/return-intake.mts';
import { NativeReturns } from '../commerce/native-returns.mts';
import { ShopifyReturnFixtureAdapter } from '../adapters/shopify-return-fixture.mts';

import {ResolutionFixtureSource} from '../adapters/resolution-fixture-source.mts';
import {ResolutionLedger} from '../commerce/resolution-ledger.mts';
import {FulfillmentFixtureSource} from '../adapters/fulfillment-fixture-source.mts';
import {FulfillmentConfiguration} from '../commerce/return-fulfillment-core.mts';
import {ReplacementInventory} from '../commerce/replacement-inventory.mts';
import {ReplacementOrders} from '../commerce/replacement-orders.mts';
import {ReturnLabels} from '../commerce/return-labels.mts';
import {FulfillmentExecution} from '../commerce/fulfillment-execution.mts';
import {ReturnTracking} from '../commerce/return-tracking.mts';
import {VariantExchanges} from '../commerce/variant-exchanges.mts';

import {ReturnReceiving} from '../commerce/return-receiving.mts';
import {ReturnDisposition} from '../commerce/return-disposition.mts';
import {ReturnCancellation} from '../commerce/return-cancellation.mts';
import {ReturnWorkflows} from '../commerce/return-workflows.mts';
import {RefundQuotes} from '../commerce/refund-quotes.mts';
import {StoreCredit} from '../commerce/store-credit.mts';
import {ResolutionExecution} from '../commerce/resolution-execution.mts';
import {WarehouseFixtureSource} from '../adapters/warehouse-fixture-source.mts';
import {SkillInstaller,readInstructionDirectory} from '../commerce/skill-installer.mts';
import {exact,id} from '../commerce/kernel.mts';
// Isolated synthetic setup. No source imports from tests and no external transport.
export async function createReturnCompletionDemo(options:{store?:string;inventory_buffer?:number;at?:number}={}){
 if(Object.keys(options).some(k=>!['store','inventory_buffer','at'].includes(k)))throw new Error('INVALID_INPUT');const store=options.store??'mixed';id(store);
 const db=new DatabaseSync(':memory:'),sourceDb=new DatabaseSync(':memory:'),fulfillmentDb=new DatabaseSync(':memory:'),warehouseDb=new DatabaseSync(':memory:');try {
 const at=options.at??Date.now(),kernel=new CommerceKernel(db,()=>at),caps=new Capabilities(kernel),simulator=new StoreSimulator(kernel,caps),reads=new ReadContext(kernel,caps);
 const outbox:any[]=[],customers=new CustomerAccess(kernel,m=>outbox.push(m));
 const bundle=loadSkillDirectory(fileURLToPath(new URL('../commerce/skill-bundles/return-draft/',import.meta.url)));
 const gateway=new ActionGateway(kernel),intake=new ReturnIntake(kernel),policies=new Policies(kernel);
 kernel.provisionStore('demo',store);
 const actor=(name:string,role:'owner'|'operator'|'reviewer')=>{kernel.provisionMember('demo',store,name,role);const token=kernel.issueSession('demo',store,name);return {token,scope:kernel.authenticate(token)};};
 const owner=actor('owner','owner'),operator=actor('operator','operator'),reviewer=actor('reviewer','reviewer');simulator.reset(operator.scope);
 reads.skills.install(operator.scope,bundle);reads.profiles.put(operator.scope,{id:'default',revision:1,tenant_id:'demo',store_id:store,skill_id:bundle.id,skill_digest:bundle.digest,tone:'neutral',locale:'en-US',actions:['order.status','knowledge.search','knowledge.get','skill.read'],data_scope:{order:'session_or_store',knowledge:'visible_only'}});
 const p=policies.create(operator.scope,{policy_id:'returns',expected_version:0,rules:{window_days:30,require_evidence:false,excluded_tags:['final-sale'],outcomes:['refund','exchange','store_credit']},selection:'pin_at_request',sources:[{uri:'https://merchant.example.invalid/policy',revision:'1',sha256:'a'.repeat(64)}]});
 policies.test(operator.scope,'returns',1,p.digest);policies.review(reviewer.scope,'returns',1,p.digest);policies.publish(owner.scope,{policy_id:'returns',version:1,digest:p.digest,expected_published_version:0,effective_at:at});
 const original=kernel.lookup(operator.scope,'order','synthetic','ORD-1001');
 const paid_lines=[{id:'alpha',product_id:'shirt',variant_id:'shirt-small',quantity:3,gross_minor:'6000',discount_minor:'600',tax_minor:'300',shipping_minor:'90',duties_minor:'30',resolved_units:[1]},
 {id:'beta',product_id:'hat',variant_id:'hat-small',quantity:2,gross_minor:'2000',discount_minor:'200',tax_minor:'100',shipping_minor:'20',duties_minor:'0',resolved_units:[]},
 {id:'gamma',product_id:'shoe',variant_id:'shoe-small',quantity:1,gross_minor:'1000',discount_minor:'0',tax_minor:'0',shipping_minor:'0',duties_minor:'0',resolved_units:[]}];
 const lines=paid_lines.map((x,i)=>({id:x.id,fulfillment_line_id:'gid://shopify/FulfillmentLineItem/'+(101+i),ordered:x.quantity,fulfilled:x.quantity,returned:x.resolved_units.length,unit_minor:i===0?'1800':i===1?'900':'1000',tags:[]}));
 const order=kernel.ingest(operator.scope,{kind:'order',source_system:'synthetic',external_id:original.external_id,source_version:2,source_updated_at:at,customer_id:original.customer_id,payload:{...original.payload,total_minor:'8740',delivered_at:at-3*86400000,tags:[],evidence_verified:true,native_order_id:'gid://shopify/Order/201',counted_return_ids:[],return_lines:lines,resolution_facts:{revision:1,observed_at:at,currency:'USD',payment_id:'demo-payment',original_paid_minor:'8740',prior_refunded_minor:'1940',accounted_operations:[],paid_lines}}});
 const challenge=customers.request({store_id:store,order_number:'ORD-1001',email:'shopper-apparel@example.invalid'},'127.0.0.1');const verified=customers.complete({store_id:store,challenge_id:challenge.challenge_id,proof:outbox.at(-1).proof});outbox.length=0;const customer=kernel.authenticate(verified.token);
 gateway.configure(owner.scope,{enabled:true,expected_revision:0,profile_id:'default',policy_id:'returns'});gateway.cases.create(customer,{case_id:'mixed_case',resource_id:order.id,profile_id:'default',policy_id:'returns'});
 intake.configure(owner.scope,{expected_revision:0,settings:{currency:'USD',restocking_bps:0,shipping_minor:'0',time_zone:'America/Denver',brand:'Sample apparel',contact:'support@example.invalid',override_days:7,retention_days:30}});
 const q=intake.evaluate(customer,{case_id:'mixed_case',lines:lines.map(l=>({line_id:l.id,quantity:1})),outcome:'refund',reason:'size',note:'',evidence_ids:[]});
 const request=intake.prepare(customer,{quote_id:q.id,quote_digest:q.digest,request_key:'mixed-request',override_id:null});const approve=gateway.approve(reviewer.scope,{preview_id:request.preview_id,preview_digest:request.preview_digest});gateway.execute(operator.scope,{preview_id:request.preview_id,preview_digest:request.preview_digest,approval_id:approve.id});
 const native=new NativeReturns(kernel,new ShopifyReturnFixtureAdapter({
  mode:'fixture',identity:'native-demo',tenant:'demo',store:store,
  transport:async({variables})=>{
   const record={id:'gid://shopify/Return/901',status:'OPEN',order:{id:variables.returnInput.orderId},
    returnLineItems:{nodes:variables.returnInput.returnLineItems.map((l:any,i:number)=>({id:'gid://shopify/ReturnLineItem/'+(901+i),quantity:l.quantity,returnReasonNote:l.returnReasonNote,fulfillmentLineItem:{id:l.fulfillmentLineItemId}})),pageInfo:{hasNextPage:false}},
    reverseFulfillmentOrders:{nodes:[{id:'gid://shopify/ReverseFulfillmentOrder/901'}],pageInfo:{hasNextPage:false}}};
   return {status:200,api_version:'2026-10',body:{data:{returnCreate:{userErrors:[],return:record}}}};
  }
 }));
 await native.create(operator.scope,request.id);
 const source=new ResolutionFixtureSource(sourceDb,{mode:'fixture',identity:'demo-ledger',tenant:'demo',store:store});source.seed({resource_id:order.id,customer_id:order.customer_id,payment_id:'demo-payment',currency:'USD',available_minor:'6800'});
 const ledger=new ResolutionLedger(kernel);ledger.configure(owner.scope,{expected_revision:0,enabled:true,source_identity:source.identity,credit_instrument:'native_store_credit',expires_at:at+3600000,inventory_buffer:options.inventory_buffer??2});
 const plan=ledger.allocate(operator.scope,{request_id:request.id,request_key:'mixed-allocation',lines:[{line_id:'alpha',units:[2],outcome:'refund'},{line_id:'beta',units:[1],outcome:'store_credit'},{line_id:'gamma',units:[1],outcome:'exchange'}]});
 const nativeSource=new FulfillmentFixtureSource(fulfillmentDb,{mode:'fixture',identity:'carrier-inventory-demo',tenant:'demo',store:store,clock:()=>at});
 new FulfillmentConfiguration(kernel).configure(owner.scope,{expected_revision:0,enabled:true,source_identity:nativeSource.identity,account_id:'demo-carrier-account',expires_at:at+3600000,resolution_trigger:'carrier_delivery'});
 const catalog=kernel.ingest(operator.scope,{kind:'catalog',source_system:'synthetic',external_id:'shoe-large',source_version:1,source_updated_at:at,customer_id:null,payload:{variant_id:'shoe-large',product_id:'shoe',currency:'USD',unit_price_minor:'1000',tax_per_unit_minor:'0',shipping_minor:'0',duties_per_unit_minor:'0',available:3,discount_eligible:true,promotion_expires_at:at+60000,excluded:false}});
 nativeSource.seedStock({catalog_id:catalog.id,variant_id:'shoe-large',location_id:'warehouse-one',version:1,available:3});
 nativeSource.seedRate({service:'ground',revision:1,amount_minor:'500',currency:'USD',expires_at:at+300000});
 const exchanges=new VariantExchanges(kernel),inventory=new ReplacementInventory(kernel,nativeSource),orders=new ReplacementOrders(kernel),labels=new ReturnLabels(kernel,nativeSource),execution=new FulfillmentExecution(kernel,nativeSource),tracking=new ReturnTracking(execution);

 const warehouse=new WarehouseFixtureSource(warehouseDb,{mode:'fixture',identity:'warehouse-demo',tenant:'demo',store});for(const variant of ['shirt-small','hat-small','shoe-small'])warehouse.seed(variant,'warehouse-one',0);
 const receiving=new ReturnReceiving(kernel),disposition=new ReturnDisposition(kernel,warehouse),cancellation=new ReturnCancellation(kernel),workflows=new ReturnWorkflows(kernel),moneyExecution=new ResolutionExecution(kernel,source),quotes=new RefundQuotes(kernel),credit=new StoreCredit(kernel);
 disposition.configure(owner.scope,{expected_revision:0,enabled:true,source_identity:warehouse.identity,locations:['warehouse-one'],expires_at:at+3600000});
 const skills:any={},installer=new SkillInstaller(kernel);for(const name of ['handle-return','handle-exchange']){const b=readInstructionDirectory(fileURLToPath(new URL('../commerce/skill-bundles/'+name+'/',import.meta.url))),origin='https://rifare.invalid/bundles/'+name,a=installer.approve(owner.scope,{origin,bundle_digest:b.digest,skill_id:name,version:b.version,expires_at:at+3600000});installer.install(operator.scope,a.id,{origin,bundle:b});skills[name]=b.digest;workflows.open(operator.scope,{request_id:request.id,workflow:name==='handle-return'?'return':'exchange',skill_digest:b.digest});}
 const authorize=(q:any)=>{const p=gateway.prepare(operator.scope,q.proposal),a=gateway.approve(reviewer.scope,{preview_id:p.id,preview_digest:p.digest});return gateway.execute(operator.scope,{preview_id:p.id,preview_digest:p.digest,approval_id:a.id});};
 return {kernel,db,sourceDb,fulfillmentDb,warehouseDb,warehouse,at,store,operator,reviewer,owner,customer,customerBearer:verified.token,caps,simulator,reads,customers,gateway,intake,request,order,plan,source,nativeSource,catalog,exchanges,inventory,orders,labels,execution,tracking,receiving,disposition,cancellation,workflows,moneyExecution,quotes,credit,skills,authorize,
 cleanup(){db.close();sourceDb.close();fulfillmentDb.close();warehouseDb.close();}};
 }catch(error){db.close();sourceDb.close();fulfillmentDb.close();warehouseDb.close();throw error;}}
