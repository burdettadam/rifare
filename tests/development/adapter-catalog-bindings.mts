import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHmac} from 'node:crypto';
import {contentDigest} from '../../packages/commerce/configuration-values.mts';
import {commerceFixture} from './commerce-helpers.mts';
import {readFixture} from './read-workflow-helpers.mts';
import {CONTRACT_VERSION} from '../../packages/commerce/capabilities.mts';
import {SecretVault} from '../../packages/commerce/secrets.mts';
import {ShopifyOrders,shopifyCredentialReader,SHOPIFY_READER,SHOPIFY_API_VERSION} from '../../packages/adapters/shopify/orders.mts';
import {WooOrders,wooCredentialReader,WOO_READER,WOO_CONTRACT} from '../../packages/adapters/woocommerce/orders.mts';
import {ShopifyReturnFixtureAdapter,RETURN_API_VERSION} from '../../packages/adapters/shopify-return-fixture.mts';
import {WooOrderEvents} from '../../packages/adapters/woocommerce/events.mts';
import {WebhookInbox} from '../../packages/commerce/webhook-inbox.mts';
import {wooReturnFixture} from './woocommerce-return-helpers.mts';
import {wooRefundFixture} from './woocommerce-refund-helpers.mts';
import {resolutionFixture} from './resolution-helpers.mts';
import {fulfillmentFixture} from './fulfillment-helpers.mts';
import {lineageFixture} from './exchange-lineage-helpers.mts';
import {moneyFixture} from './exchange-money-helpers.mts';
import {instantFixture} from './instant-helpers.mts';
import {qualifiedDestinationFixture} from './qualified-destinations-helpers.mts';
import {editFixture} from './order-edit-helpers.mts';
import {localFixture} from './local-model-helpers.mts';
import {providerReader,ADAPTER_NAMES} from '../../packages/agent/providers.mts';
import {SupportFixtureSource} from '../../packages/adapters/support-fixture-source.mts';
import {ChatwootSupportSource,CHATWOOT_CONTRACT} from '../../packages/adapters/support/chatwoot.mts';
import {ResendSupportSource} from '../../packages/adapters/support/resend.mts';
import {supportReader} from '../../packages/adapters/support/transport.mts';
import {SyntheticJournal} from '../../packages/adapters/reliability/synthetic-journal.mts';
import {WarehouseFixtureSource} from '../../packages/adapters/warehouse-fixture-source.mts';
import {NativeChangeFixtureSource} from '../../packages/adapters/native-change-fixture-source.mts';
import {verifyShopifyWebhook,verifyWooCommerceWebhook,verifySyntheticWebhook} from '../../packages/adapters/webhooks/signatures.mts';
import type {Row} from '../../packages/commerce/kernel.mts';

const read=(path:string)=>JSON.parse(readFileSync(new URL('../fixtures/'+path,import.meta.url),'utf8'));
const rows=(db:DatabaseSync,sql:string,args:any[]=[])=>db.prepare(sql).all(...args).map((r:any)=>({id:String(r.id),body:JSON.parse(r.body)}));
export type NativeCatalogFixture={invoke:()=>unknown;records:()=>Row[];cleanup:()=>unknown;descriptor?:Row;response_status?:number;};
// This database represents the fixture server. Reads and effects are observed
// from its records, independently of the adapter's decoded response. Credentials
// and authorization headers are never copied into this source ledger.
function wireLedger(initial:Row[]=[]){const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE source_records(id TEXT PRIMARY KEY,body TEXT NOT NULL) STRICT;');
 const put=(id:string,body:Row)=>db.prepare('INSERT INTO source_records VALUES(?,?)').run(id,JSON.stringify(body));initial.forEach(r=>put(r.id,r.body));
 const get=(id:string)=>JSON.parse((db.prepare('SELECT body FROM source_records WHERE id=?').get(id) as any).body);
 return {db,put,get,records:()=>rows(db,'SELECT id,body FROM source_records ORDER BY id'),close:()=>db.close()};}
const wrap=(f:any,invoke:()=>unknown,records:()=>Row[],extra:any={})=>({invoke,records,cleanup:()=>f.cleanup(),...extra});

async function simulator(kind:string){const f=readFixture(),input=read('conformance/source-inputs.v1.json').simulator[kind],ledger=wireLedger([{id:'original',body:input}]);
 const grants=JSON.parse(f.db.prepare('SELECT granted_scopes FROM commerce_connections WHERE tenant_id=? AND store_id=?').get(f.a.tenant,f.a.store)!.granted_scopes as string);
 return wrap(f,()=>f.simulator.read(f.a.scope,kind,input.external_id),ledger.records,{descriptor:{version:CONTRACT_VERSION,granted_scopes:grants},cleanup:()=>{ledger.close();f.cleanup();}});}
async function shopifyRead(cached=false){const f=commerceFixture(),ledger=wireLedger([{id:'original',body:read('read-workflows/shopify-order.json')}]);
 const reader=shopifyCredentialReader({fixtureFetch:async(url,init)=>{ledger.put('request',{url,method:init.method,request:JSON.parse(init.body as string)});return new Response(JSON.stringify(ledger.get('original')),{status:200,headers:{'x-shopify-api-version':SHOPIFY_API_VERSION}});}});
 const vault=new SecretVault(f.kernel,{activeId:'catalog_key',get:()=>Buffer.alloc(32,7)},{},{[SHOPIFY_READER]:reader}),ref=vault.put(f.a.scope,{provider:'shopify',adapter:SHOPIFY_READER,value:'catalog-synthetic-token'}).ref,adapter=new ShopifyOrders(f.kernel,vault);
 adapter.configure(f.a.scope,{domain:'rifare-fixture.myshopify.com',secret_ref:ref,granted_scopes:['read_orders'],mode:'fixture'});
 const saved=cached?await adapter.refresh(f.a.scope,'1001'):null;
 return wrap(f,()=>saved?adapter.cached(f.a.scope,saved.resource_id):adapter.refresh(f.a.scope,'1001'),ledger.records,{descriptor:{version:SHOPIFY_READER,api_version:SHOPIFY_API_VERSION,granted_scopes:['read_orders']},cleanup:()=>{ledger.close();f.cleanup();}});}
async function wooRead(cached=false){const f=commerceFixture(),ledger=wireLedger([{id:'original',body:read('woocommerce/order.v1.json')},{id:'refunds',body:{items:read('woocommerce/refunds.v1.json')}}]);let sequence=0;
 const reader=wooCredentialReader({fixtureFetch:async(url,init)=>{ledger.put('request_'+(++sequence),{url,method:init.method});return new Response(JSON.stringify(url.includes('/refunds')?ledger.get('refunds').items:ledger.get('original')),{status:200,headers:{'x-wp-totalpages':'1'}});}}),vault=new SecretVault(f.kernel,{activeId:'catalog_key',get:()=>Buffer.alloc(32,8)},{},{[WOO_READER]:reader});
 const ref=vault.put(f.a.scope,{provider:'woocommerce',adapter:WOO_READER,value:JSON.stringify({consumer_key:'ck_catalog_fixture',consumer_secret:'cs_catalog_fixture'})}).ref,adapter=new WooOrders(f.kernel,vault);
 adapter.configure(f.a.scope,{origin:'https://woo.example.invalid',secret_ref:ref,granted_scopes:['read'],mode:'fixture'});
 const saved=cached?await adapter.refresh(f.a.scope,'17'):null;
 return wrap(f,()=>saved?adapter.cached(f.a.scope,saved.resource_id):adapter.refresh(f.a.scope,'17'),ledger.records,{descriptor:{version:WOO_CONTRACT,granted_scopes:['read']},cleanup:()=>{ledger.close();f.cleanup();}});}
async function shopifyReturn(){const ledger=wireLedger(),input=read('conformance/source-inputs.v1.json').shopify_return;
 const adapter=new ShopifyReturnFixtureAdapter({mode:'fixture',identity:'catalog_return',tenant:'tenant',store:'store',transport:async({query,variables})=>{
  const record={...structuredClone(input.native_record),order:{id:variables.returnInput.orderId}};ledger.put('return_900',{query,request:variables.returnInput,record});return {status:200,api_version:RETURN_API_VERSION,body:{data:{returnCreate:{userErrors:[],return:record}}}};
 }});return {invoke:()=>adapter.create(input.request),records:ledger.records,cleanup:ledger.close,descriptor:{api_version:RETURN_API_VERSION}};}
async function wooRma(){const f=wooReturnFixture();return wrap(f,()=>{const p=f.prepare();f.submit(p);return f.intake.read(f.a.scope,f.caseId);},()=>[
 ...rows(f.sourceDb,"SELECT 'a_original' id,body FROM woo_fixture_order_versions WHERE native_order_id='17'"),
 ...rows(f.db,"SELECT 'b_local_rma' id,body FROM commerce_woo_rma_bindings")]);}
async function wooEvent(topic:string){const f=wooReturnFixture(),key=Buffer.alloc(32,61),inbox=new WebhookInbox(f.kernel,()=>key),route=inbox.register(f.owner.scope,{provider:'woocommerce',topic,shop_domain:'woo.example.invalid',api_version:'wc/v3',key_ref:'catalog_webhook'}),events=new WooOrderEvents(f.kernel,inbox,f.woo);
 return wrap(f,()=>{const raw=Buffer.from(JSON.stringify(f.source.snapshot('17').input.order)),headers=['Content-Type','application/json','X-WC-Webhook-Source','https://woo.example.invalid/','X-WC-Webhook-Topic',topic,'X-WC-Webhook-Resource','order','X-WC-Webhook-Event',topic.split('.')[1],'X-WC-Webhook-ID','19','X-WC-Webhook-Delivery-ID','catalog_delivery','X-WC-Webhook-Signature',createHmac('sha256',key).update(raw).digest('base64')],event=inbox.receive(route.id,headers,raw);return events.process(f.a.scope,event.id);},()=>rows(f.sourceDb,"SELECT 'original' id,body FROM woo_fixture_order_versions WHERE native_order_id='17'"));}
async function wooRefund(manual=false,gateway=false){const f=wooRefundFixture({manual}),op=f.approved();return wrap(f,async()=>{const result=await f.executor.dispatch(f.a.scope,op.id);return gateway?await f.gatewaySource.lookup(op.id):result;},()=>gateway?rows(f.gatewayDb,'SELECT operation_id id,body FROM fixture_woo_gateway_refunds'):rows(f.sourceDb,'SELECT operation_id id,body FROM fixture_woo_refund_records'));
}
async function support(kind:string){const db=new DatabaseSync(':memory:'),source=new SupportFixtureSource(db,'tenant','store','mail',()=>1000),payload={kind,account_id:'mail',from:'support@example.invalid',to:'shopper@example.invalid',purpose:kind==='email'?'transactional':'internal',text:'Catalog source fixture',conversation_id:'12',assignee_id:'9'};
 return {invoke:()=>source.send({tenant_id:'tenant',store_id:'store',operation_id:'catalog_operation',payload_hash:contentDigest(payload),payload}),records:()=>rows(db,'SELECT operation_id id,body FROM support_source_effects'),cleanup:()=>db.close(),descriptor:{version:source.contract}};}
async function supportWire(provider:'chatwoot'|'resend',action:string){const f=commerceFixture(),ledger=wireLedger(action==='history'?[{id:'history',body:read('conformance/source-inputs.v1.json').chatwoot_history}]:[]),readerId='catalog_'+provider,account=provider==='chatwoot'?'7':'mail',origin=provider==='chatwoot'?'https://help.example.invalid':'https://api.resend.com';
 const reader=supportReader(provider,origin,account,async(url,init)=>{const request=init.body?JSON.parse(init.body as string):null;let body:any;
  if(action==='history')body=ledger.get('history');else if(provider==='chatwoot')body={id:501,account_id:7,conversation_id:12,private:true,content:request.content};else body={id:'email_501'};
  ledger.put('request',{url,method:init.method,request,response:body});return new Response(JSON.stringify(body),{status:200});});
 const vault=new SecretVault(f.kernel,{activeId:'catalog_key',get:()=>Buffer.alloc(32,9)},{},{[readerId]:reader}),secret=vault.put(f.a.scope,{provider,adapter:readerId,value:'catalog-wire-secret'}).ref;
 const source=provider==='chatwoot'?new ChatwootSupportSource(f.kernel,vault,f.a.scope,{account,origin,secret_ref:secret,reader:readerId}):new ResendSupportSource(f.kernel,vault,f.a.scope,{account,secret_ref:secret,reader:readerId,from:'support@example.invalid'}),payload={kind:provider==='chatwoot'&&action!=='customer'?'note':'email',account_id:account,conversation_id:'12',text:'Catalog source fixture',from:'support@example.invalid',to:'shopper@example.invalid',subject:'Fixture status',purpose:provider==='chatwoot'?'internal':'transactional'};
 const command={tenant_id:f.a.tenant,store_id:f.a.store,operation_id:'catalog_operation',payload_hash:contentDigest(payload),payload};
 return wrap(f,async()=>{if(action==='history')return (source as ChatwootSupportSource).history('12');if(action!=='customer')return source.send(command);
  try{await source.send(command);}catch(error){if(error instanceof Error&&error.message==='SOURCE_SCOPE_MISMATCH')return {error:error.message};throw error;}throw new Error('CUSTOMER_SEND_WAS_NOT_REJECTED');
 },ledger.records,{response_status:action==='customer'?400:200,descriptor:{version:source.contract},cleanup:()=>{ledger.close();f.cleanup();}});}
async function model(provider:'openai'|'anthropic',kind='tool'){const input=read('conformance/source-inputs.v1.json'),ledger=wireLedger([{id:'response',body:input.models[provider]}]),adapter=providerReader(provider,{approvedModels:['fixture-model'],fixtureTransport:async(url,init)=>{ledger.put('request',{url,method:init.method,request:JSON.parse(init.body as string),api_version:provider==='anthropic'?(init.headers as any)['anthropic-version']:'unversioned'});return new Response(JSON.stringify(ledger.get('response')),{status:200});}});
 const request=kind==='stateless'?{...input.model_request,turns:input.model_turns}:kind==='unapproved'?{...input.model_request,model:'unapproved-fixture'}:input.model_request;
 return {invoke:async()=>{if(kind!=='unapproved')return adapter.execute(Buffer.from('catalog-model-fixture'),request);
  try{await adapter.execute(Buffer.from('catalog-model-fixture'),request);}catch(error){if(error instanceof Error&&error.message==='MODEL_NOT_APPROVED')return {error:error.message};throw error;}throw new Error('UNAPPROVED_MODEL_WAS_NOT_REJECTED');
 },response_status:kind==='unapproved'?400:200,records:ledger.records,cleanup:ledger.close,descriptor:{version:ADAPTER_NAMES[provider]}};}
async function localModel(){const f=await localFixture(),ledger=wireLedger();let sequence=0;f.mutate((response,path,body)=>{ledger.put('reply_'+(++sequence),{path,request:body,response});return response;});
 return wrap(f,()=>f.local.execute({model:f.config.model,max_output_tokens:512,instruction:'Read the fixture order.',context:{fixture:true},turns:[]}),ledger.records,{cleanup:async()=>{ledger.close();await f.cleanup();}});}
async function journal(){const db=new DatabaseSync(':memory:'),source=new SyntheticJournal(db,'tenant','store'),command={action:'diagnostic.case.record',financial_effect:false};return {invoke:()=>source.send({tenant_id:'tenant',store_id:'store',operation_id:'catalog_operation',payload_hash:contentDigest(command),command}),records:()=>rows(db,'SELECT operation_id id,result body FROM journal_effects'),cleanup:()=>db.close(),descriptor:{version:source.contract}};}
async function resolution(){const f=await resolutionFixture({zeroFees:true}),allocation=f.allocate().allocations.find(a=>a.outcome==='refund')!,op=f.authorize(f.quote(allocation));return wrap(f,()=>f.executor.dispatch(f.a.scope,op.id),()=>rows(f.sourceDb,'SELECT operation_id id,body FROM fixture_resolution_effects'));}
async function fulfillment(kind:string){const f=await fulfillmentFixture();if(kind==='label')return wrap(f,async()=>(await f.buy()).result,()=>rows(f.fulfillmentDb,'SELECT id,body FROM fixture_effects'));
 const op=f.replacement();return wrap(f,()=>f.execution.dispatch(f.a.scope,op.id),()=>rows(f.fulfillmentDb,'SELECT id,body FROM fixture_effects'));}
async function warehouse(disposition:string){const db=new DatabaseSync(':memory:'),source=new WarehouseFixtureSource(db,{mode:'fixture',identity:'catalog_warehouse',tenant:'tenant',store:'store'});source.seed('shirt','warehouse',0);
 const command={operation_id:'catalog_operation',source_identity:source.identity,tenant_id:'tenant',store_id:'store',request_id:'request',resource_id:'order',native_return_id:'synthetic_return',location_id:'warehouse',disposition,units:[{id:'unit',line_id:'line',ordinal:1,variant_id:'shirt',grade:'sellable'}]};
 return {invoke:()=>source.apply(command),records:()=>rows(db,'SELECT operation_id id,body FROM warehouse_effects').map(r=>({...r,body:{...r.body,stock:db.prepare("SELECT available FROM warehouse_stock WHERE variant='shirt' AND location='warehouse'").get()!.available}})),cleanup:()=>db.close()};}
async function nativeChange(){const db=new DatabaseSync(':memory:'),source=new NativeChangeFixtureSource(db,{mode:'fixture',identity:'catalog_feed',tenant:'tenant',store:'store'});source.publish(read('conformance/source-inputs.v1.json').native_change);return {invoke:()=>source.lookup('request'),records:()=>rows(db,'SELECT request_id id,body FROM native_change_feed'),cleanup:()=>db.close()};}
async function orderEdit(){const f=editFixture(),op=f.authorize();return wrap(f,()=>f.edits.dispatch(f.a.scope,op.order_edit_id),()=>rows(f.sourceDb,"SELECT 'original' id,body FROM edit_source_orders WHERE id=?",[f.order.resource_id]));}
async function lineage(){const f=await lineageFixture(),exchange=await f.makeExchange(f.allocation,'1200');return wrap(f,()=>f.lineageSource.transfer(exchange.op.id),()=>rows(f.sourceDb,'SELECT operation_id id,body FROM fixture_exchange_lineage_nodes'));}
async function money(){const f=await moneyFixture({fees:true,presentment:'EUR'});return wrap(f,()=>({events:f.source.money.events(f.allocation.id)}),()=>rows(f.sourceDb,'SELECT event_id id,body FROM fixture_exchange_fee_events'));}
async function instant(){const f=await instantFixture(),op=f.authorize(f.instant.quoteAuthorize(f.a.scope,f.authorizeInput()));return wrap(f,()=>f.instant.dispatch(f.a.scope,op.id),()=>rows(f.sourceDb,'SELECT id,body FROM fixture_instant_operations'));}
async function destination(){const f=await qualifiedDestinationFixture();f.choose();return wrap(f,async()=>(await f.buy()).result,()=>rows(f.fulfillmentDb,'SELECT operation_id id,body FROM fixture_destination_admissions'));}
async function signature(provider:string){const topic=provider==='woocommerce'?'order.updated':'orders/updated',route={id:'catalog_route',topic,shop_domain:'source.example.invalid',api_version:provider==='woocommerce'?'wc/v3':'2026-10'},raw=Buffer.from('{"id":17}'),key=Buffer.alloc(32,42),at='1768478400000',delivery='catalog_delivery';
 const contracts:any={synthetic:'rifare-synthetic-route-body-hmac-v1',shopify:'shopify-raw-body-hmac-sha256',woocommerce:'woocommerce-raw-body-hmac-sha256'},ledger=wireLedger([{id:'original',body:{route,raw:raw.toString(),delivery_id:delivery,signature_contract:contracts[provider]}}]);
 const hmac=(bytes:Buffer)=>createHmac('sha256',key).update(bytes).digest('base64');
 return {records:ledger.records,cleanup:ledger.close,invoke:()=>{if(provider==='shopify')return verifyShopifyWebhook(route,{'x-shopify-hmac-sha256':hmac(raw),'x-shopify-shop-domain':route.shop_domain,'x-shopify-topic':topic,'x-shopify-api-version':route.api_version,'x-shopify-webhook-id':delivery},raw,key);
  if(provider==='woocommerce')return verifyWooCommerceWebhook(route,{'x-wc-webhook-signature':hmac(raw),'x-wc-webhook-source':'https://source.example.invalid/','x-wc-webhook-topic':topic,'x-wc-webhook-resource':'order','x-wc-webhook-event':'updated','x-wc-webhook-id':'19','x-wc-webhook-delivery-id':delivery},raw,key);
  return verifySyntheticWebhook(route,{'x-rifare-delivery':delivery,'x-rifare-timestamp':at,'x-rifare-shop':route.shop_domain,'x-rifare-topic':topic,'x-rifare-signature':hmac(Buffer.concat([Buffer.from(JSON.stringify([route.id,route.shop_domain,topic,delivery,at])+'\n'),raw]))},raw,key,Number(at));}};}

export const nativeCatalogFactories:Record<string,()=>Promise<NativeCatalogFixture>>={
 simulator:()=>simulator('order'),simulator_customer:()=>simulator('customer'),simulator_shipment:()=>simulator('shipment'),simulator_catalog:()=>simulator('catalog'),simulator_payment:()=>simulator('payment'),
 shopify_read:()=>shopifyRead(),shopify_cached:()=>shopifyRead(true),woo_read:()=>wooRead(),woo_cached:()=>wooRead(true),shopify_return:shopifyReturn,woo_rma:wooRma,woo_event:()=>wooEvent('order.updated'),woo_event_created:()=>wooEvent('order.created'),
 woo_refund:()=>wooRefund(),woo_manual:()=>wooRefund(true),woo_gateway:()=>wooRefund(false,true),support_email:()=>support('email'),support_note:()=>support('note'),support_handoff:()=>support('handoff'),
 chatwoot_note:()=>supportWire('chatwoot','note'),chatwoot_history:()=>supportWire('chatwoot','history'),chatwoot_customer:()=>supportWire('chatwoot','customer'),resend_email:()=>supportWire('resend','email'),openai:()=>model('openai'),anthropic:()=>model('anthropic'),local_model:localModel,
 openai_stateless:()=>model('openai','stateless'),anthropic_stateless:()=>model('anthropic','stateless'),openai_unapproved:()=>model('openai','unapproved'),anthropic_unapproved:()=>model('anthropic','unapproved'),
 journal,resolution,fulfillment_label:()=>fulfillment('label'),fulfillment_replacement:()=>fulfillment('replacement'),warehouse_restock:()=>warehouse('restock'),warehouse_quarantine:()=>warehouse('quarantine'),warehouse_dispose:()=>warehouse('dispose'),warehouse_supplier_return:()=>warehouse('supplier_return'),native_change:nativeChange,order_edit:orderEdit,lineage,money,instant,destination,
 signature_synthetic:()=>signature('synthetic'),signature_shopify:()=>signature('shopify'),signature_woocommerce:()=>signature('woocommerce')
};
