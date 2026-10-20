import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {usingJourneys,reference,intent,count} from './commerce-journeys-helpers.mts';
import {installSupportSkills} from './support-workflow-helpers.mts';
import {installShoppingCart} from './growth-shopping-helpers.mts';
import {verifiedCustomer,recordInput} from './shopper-memory-helpers.mts';
import {CommerceKernel} from '../../packages/commerce/kernel.mts';
import {Capabilities} from '../../packages/commerce/capabilities.mts';
import {ReadContext} from '../../packages/commerce/read-context.mts';
import {CommerceJourneys} from '../../packages/commerce/commerce-journeys.mts';
import {ShopperMemory} from '../../packages/commerce/shopper-memory.mts';
import {SupportService} from '../../packages/commerce/support-service.mts';
import {SupportWorkflows} from '../../packages/commerce/support-workflows.mts';
import {FulfillmentFixtureSource} from '../../packages/adapters/fulfillment-fixture-source.mts';
import {FulfillmentExecution} from '../../packages/commerce/fulfillment-execution.mts';
export {reference,intent,count};
export {publish,job,immutableJob} from './journey-followups-helpers.mts';
export {row as readinessRow} from './journey-readiness-helpers.mts';
export type Value=Record<string,any>;

export const common=(f:any,link=f.email,generation=1)=>({case_id:f.caseId,link_id:link.id,expected_generation:generation});
export const context=(f:any,scope=f.a.scope,proof=f.customer,link=f.email,generation=1)=>f.journeys.context(scope,proof,common(f,link,generation));
export function documents(f:any,kind:string){
  return (f.db.prepare('SELECT * FROM commerce_support_documents WHERE tenant_id=? AND store_id=? AND kind=? ORDER BY id,version').all(f.a.tenant,f.a.store,kind) as Value[]).filter(r=>JSON.parse(r.body).case_id===f.caseId);
}
const countTables={previews:'commerce_action_previews',approvals:'commerce_action_approvals',receipts:'commerce_action_receipts',fulfillment:'commerce_fulfillment_operations',resolution:'commerce_resolution_operations',carts:'commerce_shopping_carts',deliveries:'commerce_support_deliveries',operations:'commerce_operations'};
export const counts=(f:any)=>Object.fromEntries(Object.entries(countTables).map(([key,table])=>[key,count(f.db,table)]));
export function prerequisites(f:any){
  const scoped=(sql:string)=>f.db.prepare(sql).all(f.a.tenant,f.a.store);
  return {
    cases:scoped('SELECT id,resource_id,customer_id FROM commerce_cases WHERE tenant_id=? AND store_id=? ORDER BY id'),
    requests:scoped('SELECT id,case_id,resource_id,state,receipt_id FROM commerce_return_requests WHERE tenant_id=? AND store_id=? ORDER BY id'),
    nativeReturns:scoped('SELECT id,request_id,state,native_id FROM commerce_native_return_operations WHERE tenant_id=? AND store_id=? ORDER BY id'),
    allocations:scoped('SELECT id,case_id,resource_id,line_id,outcome FROM commerce_resolution_allocations WHERE tenant_id=? AND store_id=? ORDER BY line_id,id'),
  };
}
function bindService(f:any,cart?:any){
  const service=new SupportService(f.kernel,f.reads,{sources:[f.supportSource],journeys:{fulfillment:f.execution,resolution:f.executor,...(cart?{cart}:{})},...(cart?{journey:{cart}}:{})});
  for(const key of ['journeys','memory','conversations','ownership','consent','tracking','delivery','rules','followups','workflows'])f[key]=(service as any)[key];
  f.service=service;return service;
}
export async function usingContinuity(fn:(f:any)=>unknown){
  return usingJourneys(async base=>{
    const f:any={...base,email:base.link},installed=installSupportSkills(f);f.digests=installed.digests;bindService(f);
    f.baseline={identities:prerequisites(f),counts:counts(f)};
    // These are disclosed native fixture prerequisites, not a new intake journey.
    assert.deepEqual(f.baseline.identities.cases.map((r:Value)=>r.id),['case_one','resolution_case']);
    assert.equal(f.baseline.identities.requests.length,1);assert.equal(f.baseline.identities.requests[0].id,f.request.id);assert.equal(f.baseline.identities.requests[0].state,'native_created');
    assert.equal(f.baseline.identities.nativeReturns.length,1);assert.equal(f.baseline.identities.nativeReturns[0].state,'created');assert.equal(f.baseline.identities.nativeReturns[0].native_id,'gid://shopify/Return/900');
    assert.deepEqual(f.baseline.identities.allocations.map((r:Value)=>[r.line_id,r.outcome]),[['alpha','refund'],['beta','store_credit'],['gamma','exchange']]);
    assert.equal(count(f.fulfillmentDb,'fixture_effects'),0);assert.equal(count(f.sourceDb,'fixture_resolution_effects'),0);assert.equal(count(f.supportDb,'support_source_effects'),0);
    try{
      f.memory.record(f.customer,recordInput(f,{...common(f),request_id:'continuity_explicit_preferences'}));f.originalMemory=documents(f,'shopper_memory');assert.equal(f.originalMemory.length,1);
      f.conversations.ingest(f.a.scope,{link_id:f.email.id,external_id:'continuity_email_status',direction:'incoming',visibility:'public',source_at:f.now(),text:'Where is my order?'});
      const opened=f.journeys.open(f.a.scope,f.customer,{...common(f),expected_version:0,request_id:'continuity_open'});assert.equal(opened.version,1);
      const linked=f.journeys.attach(f.a.scope,f.customer,{...common(f),expected_version:1,request_id:'continuity_tracking',intent_id:'tracking_one',kind:'tracking',references:[]});f.journeyId=linked.id;
      assert.equal(linked.version,2);assert.equal(intent(linked,'tracking_one').state,'available');
      return await fn(f);
    }finally{f.shopping?.cleanup();}
  },'fulfillment');
}
export function assertBaseline(f:any,delta:Value){
  assert.deepEqual(prerequisites(f),f.baseline.identities);
  for(const [key,value]of Object.entries(counts(f)))assert.equal(value,f.baseline.counts[key]+(delta[key]??0),'native '+key+' count against disclosed fixture baseline');
  assert.equal(count(f.sourceDb,'fixture_resolution_effects'),0);assert.equal(count(f.db,'commerce_model_reservations'),0);assert.equal(count(f.db,'commerce_assistance_receipts'),0);
}
export function assertTracking(view:Value){
  assert.equal(view.status,'available');assert.deepEqual(view.shipments.map((s:Value)=>[s.id,s.status]),[['SHIP-1001','in_transit']]);
  assert.equal(view.all_delivered,false);assert.equal(view.estimated_delivery,null);assert.equal(view.warehouse_received,false);assert.equal(view.production_qualified,false);
}
export function assertMemory(f:any,scope:any,proof:any,link:any,generation:number){
  const memory=f.memory.context(scope,proof,{...common(f,link,generation),purpose:'support_journey'});
  assert.equal(memory.status,'available');assert.equal(memory.version,1);assert.deepEqual(memory.preferences,{fit_preference:'regular',response_style:'concise'});assert.equal(memory.provenance.link_id,f.email.id);
  assert.equal(memory.model_thread_required,false);assert.equal(memory.execution_authorized,false);assert.equal(memory.production_qualified,false);assert.deepEqual(documents(f,'shopper_memory'),f.originalMemory);return memory;
}
export function manualStatus(f:any,scope:any,request:string,generation:number){
  const result=f.workflows.complete(scope,f.caseId,'support-reply',f.digests['support-reply'],request);
  assert.equal(result.status,'answered');assert.equal(result.generation,generation);assert.equal(result.customer_resolved,false);assert.equal(result.execution_authorized,false);assert.ok(result.citations.length>0);
  assert.match(result.text,/Shipment SHIP-1001: in_transit/);assert.match(result.text,/No delivery date is confirmed/);return result;
}
export function handover(f:any){
  manualStatus(f,f.a.scope,'continuity_manual_status',1);
  const assigned=f.ownership.assign(f.owner.scope,{case_id:f.caseId,expected_generation:1,actor_id:'agent'});assert.equal(assigned.generation,2);assert.equal(assigned.mode,'agent');
  // Local deterministic workflow handling uses the existing agent role, not a model or remote work grant.
  manualStatus(f,f.agent.scope,'continuity_agent_status',2);assert.equal(context(f,f.agent.scope,f.customer,f.email,2).id,f.journeyId);
  const taken=f.ownership.takeover(f.owner.scope,{case_id:f.caseId,expected_generation:2,reason:'operator_requested'});assert.equal(taken.generation,3);assert.equal(taken.mode,'human');return taken;
}
export function secondChannel(f:any){
  const customer=verifiedCustomer(f,{...f.a,scope:f.owner.scope});
  const web=f.conversations.link(f.owner.scope,customer.scope,{case_id:f.caseId,channel:'webchat',account_id:'widget',external_id:'continuity_webchat',history:'unavailable',source_revision:1});
  f.conversations.customerMessage(customer.scope,{link_id:web.id,request_id:'continuity_size_exchange',text:'Please continue my size exchange here.'});
  assert.equal(web.case_id,f.caseId);assert.equal(web.resource_id,f.email.resource_id);assert.equal(web.customer_id,f.email.customer_id);
  return {web,proof:customer.scope,bearer:customer.bearer};
}
export function authorizeExchange(f:any,scope:any,proof:any,link:any,generation:number){
  const current=context(f,scope,proof,link,generation),reservation=f.inventory.reserve(scope,{quote_id:f.exchange.id,quote_digest:f.exchange.digest,location_id:'warehouse-one',ttl_ms:50000});
  const quote=f.orders.quote(scope,{reservation_id:reservation.id}),prepared=f.journeys.prepare(scope,proof,{...common(f,link,generation),expected_version:current.version,request_id:'continuity_exchange_prepare',intent_id:'exchange_one',kind:'exchange',proposal:quote.proposal});
  const preview=prepared.native;assert.equal(intent(prepared.journey,'exchange_one').state,'awaiting_approval');
  const approval=f.gateway.approve(f.reviewer.scope,{preview_id:preview.id,preview_digest:preview.digest});
  const executed=f.journeys.execute(scope,proof,{...common(f,link,generation),expected_version:prepared.journey.version,request_id:'continuity_exchange_execute',intent_id:'exchange_one',preview_id:preview.id,preview_digest:preview.digest,approval_id:approval.id});
  const receipt=executed.native,id=receipt.fulfillment_operation_id,refs=[reference(f,'preview',preview.id),reference(f,'approval',approval.id),reference(f,'receipt',receipt.id),reference(f,'fulfillment',id)];
  assert.equal(receipt.preview_id,preview.id);assert.equal(receipt.approval_id,approval.id);assert.deepEqual(intent(executed.journey,'exchange_one').references,refs);assert.equal(intent(executed.journey,'exchange_one').state,'recorded');
  return {id,preview,approval,receipt,refs,journey:executed.journey};
}
export function assertReplacement(result:Value,id:string){
  assert.equal(result.id,id);assert.equal(result.state,'created');assert.ok(result.native_id);assert.equal(result.replacement.variant_id,'shoe-large');assert.equal(result.replacement.quantity,1);
  assert.equal(result.replacement.fulfillment_state,'unfulfilled');assert.equal(result.replacement.shipment_id,null);assert.equal(result.qualification,'synthetic_only');assert.equal(result.live_effect,false);
}
export async function addShopping(f:any,scope:any,proof:any,link:any,generation:number){
  assert.equal(count(f.db,'commerce_shopping_carts'),f.baseline.counts.carts);
  f.shopping=await installShoppingCart({...f,a:{...f.a,scope},customer:proof,order:()=>f.kernel.get(scope,f.email.resource_id)});bindService(f,f.shopping.carts);
  const current=context(f,scope,proof,link,generation),ref=reference(f,'cart',f.shopping.cart_id),journey=f.journeys.attach(scope,proof,{...common(f,link,generation),expected_version:current.version,request_id:'continuity_later_shopping',intent_id:'shopping_one',kind:'shopping',references:[ref]});
  const cart=f.shopping.carts.readCart(scope,f.shopping.cart_id);assert.equal(cart.cart_id,'recovery-cart');assert.equal(cart.state,'committed');assert.equal(cart.status,'active');assert.equal(cart.native_order_id,null);
  assert.equal(cart.checkout_supported,false);assert.equal(cart.payment_authorized,false);assert.equal(cart.qualification,'synthetic_only');assert.equal(count(f.shopping.sourceDb,'growth_source_cart_effects'),1);
  return {ref,journey,cart};
}

// Only persisted filenames, current bearers and public identity enter this fresh local runtime.
export function reopenContinuity(input:{filename:string;sourceFile:string;tenant:string;store:string;now:()=>number;humanBearer:string;customerBearer:string;caseId:string;linkId:string;generation:number}){
  const db=new DatabaseSync(input.filename),sourceDb=new DatabaseSync(input.sourceFile);
  try{
    const kernel=new CommerceKernel(db,input.now),caps=new Capabilities(kernel),reads=new ReadContext(kernel,caps),source=new FulfillmentFixtureSource(sourceDb,{mode:'fixture',identity:'fulfillment-one',tenant:input.tenant,store:input.store,clock:input.now});
    const execution=new FulfillmentExecution(kernel,source),journeys=new CommerceJourneys(kernel,reads,{fulfillment:execution}),human=kernel.authenticate(input.humanBearer),customer=kernel.authenticate(input.customerBearer);
    const publicInput={case_id:input.caseId,link_id:input.linkId,expected_generation:input.generation};
    return {db,sourceDb,kernel,reads,source,execution,journeys,human,customer,publicInput,memory:new ShopperMemory(kernel),workflows:new SupportWorkflows(kernel,reads),close:()=>{sourceDb.close();db.close();}};
  }catch(error){sourceDb.close();db.close();throw error;}
}
