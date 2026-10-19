import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {returnFixture} from './return-intake-helpers.mts';
import {fulfillmentFixture} from './fulfillment-helpers.mts';
import {shoppingFixture} from './growth-shopping-helpers.mts';
import {attachSupport,otherMerchant} from './journey-readiness-helpers.mts';
import {CommerceJourneys} from '../../packages/commerce/commerce-journeys.mts';
import {BusinessOperations} from '../../packages/commerce/operation-store.mts';
import {DurableWork} from '../../packages/commerce/durable-work.mts';
import {SyntheticJournal} from '../../packages/adapters/reliability/synthetic-journal.mts';
import {NativeReturns} from '../../packages/commerce/native-returns.mts';
import {ShopifyReturnFixtureAdapter,CREATE_RETURN} from '../../packages/adapters/shopify-return-fixture.mts';
import {canonical,contentDigest} from '../../packages/commerce/configuration-values.mts';
export {verifiedCustomer,updateResource,snapshot,restoreInput,restored,target,merchant,imported,changedMerchant,changedRecovery,noRestoreResidue} from './shopper-memory-helpers.mts';
export {otherMerchant};
export type Value=Record<string,any>;

export async function usingJourneys(fn:(f:any)=>unknown,mode:'returns'|'fulfillment'|'shopping'='returns'){
  const f:any=mode==='fulfillment'?await fulfillmentFixture():mode==='shopping'?shoppingFixture():returnFixture();
  let support:ReturnType<typeof attachSupport>|undefined;
  try{
    support=attachSupport(f,{caseId:mode==='fulfillment'?'resolution_case':'case_one'});
    const journeyOwners={delivery:support.delivery,...(mode==='fulfillment'?{fulfillment:f.execution,resolution:f.executor}:{}),...(mode==='shopping'?{edits:f.edits,cart:f.carts}:{})};
    return await fn({...f,...support,journeyOwners,journeys:new CommerceJourneys(f.kernel,f.reads,journeyOwners)});
  }finally{support?.closeSupport();f.cleanup();}
}
export const common=(f:any,extra:Value={})=>({case_id:f.caseId,link_id:f.link.id,expected_generation:1,...extra});
export const openInput=(f:any,extra:Value={})=>({...common(f),expected_version:0,request_id:'journey_open',...extra});
export const open=(f:any,extra:Value={},scope=f.a.scope,proof=f.customer)=>f.journeys.open(scope,proof,openInput(f,extra));
export const context=(f:any,extra:Value={},scope=f.a.scope,proof=f.customer)=>f.journeys.context(scope,proof,common(f,extra));
export const attachInput=(f:any,version:number,kind:string,references:Value[]=[],extra:Value={})=>({...common(f),expected_version:version,request_id:'attach_'+version,intent_id:kind+'_one',kind,references,...extra});
export const attach=(f:any,version:number,kind:string,references:Value[]=[],extra:Value={},scope=f.a.scope,proof=f.customer)=>f.journeys.attach(scope,proof,attachInput(f,version,kind,references,extra));
export const prepareInput=(f:any,version:number,proposal:Value,extra:Value={})=>({...common(f),expected_version:version,request_id:'prepare_'+version,intent_id:'exchange_one',kind:'exchange',proposal,...extra});
export const prepare=(f:any,version:number,proposal:Value,extra:Value={})=>f.journeys.prepare(f.a.scope,f.customer,prepareInput(f,version,proposal,extra));
export const executeInput=(f:any,version:number,p:Value,a:Value,extra:Value={})=>({...common(f),expected_version:version,request_id:'execute_'+version,intent_id:'exchange_one',preview_id:p.id,preview_digest:p.digest,approval_id:a.id,...extra});
export const execute=(f:any,version:number,p:Value,a:Value,extra:Value={})=>f.journeys.execute(f.a.scope,f.customer,executeInput(f,version,p,a,extra));
export const reconcileInput=(f:any,version:number,reference:Value,extra:Value={})=>({...common(f),expected_version:version,intent_id:'exchange_one',reference,...extra});
export const forgetInput=(f:any,version:number,extra:Value={})=>({...common(f),expected_version:version,request_id:'forget_'+version,...extra});
export const forget=(f:any,version:number,extra:Value={})=>f.journeys.forget(f.customer,forgetInput(f,version,extra));
export const intent=(c:Value,id:string):Value=>{const value=c.intents.find((i:Value)=>i.id===id);assert.ok(value,'expected retained intent '+id);return value;};
export const currentOrder=(f:any)=>f.kernel.get(f.a.scope,f.link.resource_id);
export const count=(db:DatabaseSync,table:string)=>Number((db.prepare('SELECT count(*) n FROM '+table).get() as Value).n);
export function rows(f:any,caseId=f.caseId,store=f.a):Value[]{
  return (f.db.prepare("SELECT * FROM commerce_support_documents WHERE tenant_id=? AND store_id=? AND kind='commerce_journey' ORDER BY id,version").all(store.tenant,store.store) as Value[]).filter(r=>JSON.parse(r.body).case_id===caseId);
}
export function reference(f:any,kind:string,id:string):Value{
  const tables:Value={preview:'commerce_action_previews',approval:'commerce_action_approvals',receipt:'commerce_action_receipts',return_request:'commerce_return_requests',fulfillment:'commerce_fulfillment_operations',resolution:'commerce_resolution_operations',edit:'commerce_order_edits',cart:'commerce_shopping_carts',delivery:'commerce_support_deliveries'};
  const column=kind==='cart'?'cart_id':kind==='delivery'?'operation_id':'id';
  const row=f.db.prepare('SELECT * FROM '+tables[kind]+' WHERE tenant_id=? AND store_id=? AND '+column+'=?').get(f.a.tenant,f.a.store,id) as Value;
  assert.ok(row,'fixture must create the actual canonical '+kind+' reference');
  return {kind,id,digest:kind==='approval'?row.preview_digest:kind==='cart'?JSON.parse(row.body).preview_digest:row.digest};
}
export const operationReferences=(f:any,op:Value,family='fulfillment')=>[reference(f,'preview',op.preview.id),reference(f,'approval',op.approval.id),reference(f,'receipt',op.receipt.id),reference(f,family,op.id)];
export const labelProposal=(f:any)=>f.labels.quote(f.a.scope,{request_id:f.request.id,replaces:null}).proposal;
export const editProposal=(f:any,q=f.quote())=>({case_id:f.caseId,action:'diagnostic.order.edit',arguments:{quote_id:q.id,quote_digest:q.digest}});
export function assertSafe(c:Value){assert.equal(c.model_thread_required,false);assert.equal(c.execution_authorized,false);assert.equal(c.production_qualified,false);assert.match(c.context_digest,/^[a-f0-9]{64}$/);}
export function assertBlocker(c:Value,family:string,id:string){const b=c.unresolved.find((x:Value)=>x.family===family&&x.id===id);assert.ok(b,'expected original '+family+' unknown identity');assert.equal(b.state,'unknown');assert.equal(b.handoff_required,true);assert.equal(c.handoff_required,true);return b;}
export function assertRedacted(record:Value,privateIds:string[]=[]){
  const b=JSON.parse(record.body);assert.equal(b.status,'redacted');assert.deepEqual(b.intents,[]);assert.equal(record.state,'revoked');
  for(const field of ['link_id','link_revision','configuration_digest','ownership_generation'])assert.equal(b[field],null);
  assert.equal(record.author,'journey_coordinator');assert.equal(record.reviewer,null);assert.equal(record.review_digest,null);assert.equal(record.expires_at,null);
  assert.equal(record.digest,contentDigest(b));assert.match(b.request_hash,/^[a-f0-9]{64}$/);
  for(const value of privateIds)assert.equal(record.body.includes(value),false,'redaction removes personal reference '+value);
}
export function replaceJourneyRow(db:DatabaseSync,row:Value){
  const fields=['body','digest','author','state','reviewer','review_digest','created_at','expires_at'];
  db.prepare('UPDATE commerce_support_documents SET '+fields.map(key=>key+'=?').join(',')+" WHERE tenant_id=? AND store_id=? AND kind='commerce_journey' AND id=? AND version=?")
    .run(...fields.map(key=>row[key]),row.tenant_id,row.store_id,row.id,row.version);
}
const EFFECT_TABLES=['commerce_cases','commerce_case_configurations','commerce_action_previews','commerce_action_approvals','commerce_action_receipts','commerce_return_quotes','commerce_return_requests','commerce_native_return_operations','commerce_resolution_operations','commerce_resolution_observations','commerce_fulfillment_quotes','commerce_fulfillment_operations','commerce_fulfillment_observations','commerce_inventory_reservations','commerce_replacement_orders','commerce_return_labels','commerce_edit_quotes','commerce_order_edits','commerce_edit_steps','commerce_shopping_carts','commerce_support_documents','commerce_support_deliveries','commerce_operations','commerce_operation_work','commerce_operation_receipts','commerce_model_reservations','commerce_assistance_receipts'];
export const effects=(f:any)=>Object.fromEntries(EFFECT_TABLES.map(table=>[table,f.db.prepare('SELECT * FROM '+table).all().map((r:Value)=>canonical(r)).sort()]));
export function newCase(f:any,caseId:string,customer=f.customer,resourceId=f.link.resource_id){
  f.cases.create(customer,{case_id:caseId,resource_id:resourceId,profile_id:'default',policy_id:'returns'});
  const link=f.conversations.link(f.a.scope,customer,{case_id:caseId,channel:'email',account_id:'merchant_mail',external_id:'thread_'+caseId,history:'partial',source_revision:1});
  return {...f,caseId,customer,link};
}
export function genericOperation(f:any,caseId=f.caseId,onSending?:(op:Value)=>void){
  const p=f.gateway.prepare(f.a.scope,{case_id:caseId,action:'diagnostic.resolution.set',arguments:{resolution:'none'}}),a=f.gateway.approve(f.reviewer.scope,{preview_id:p.id,preview_digest:p.digest}),receipt=f.gateway.execute(f.a.scope,{preview_id:p.id,preview_digest:p.digest,approval_id:a.id});
  const ops=new BusinessOperations(f.kernel),work=new DurableWork(f.kernel),db=new DatabaseSync(':memory:'),journal=new SyntheticJournal(db,f.a.tenant,f.a.store);
  try{const op=ops.fromReceipt(f.a.scope,{receipt_id:receipt.id,idempotency_key:'journey_generic_'+caseId,expected_receipt_digest:contentDigest(receipt)});work.bind(f.a.scope,op.id,journal);
    const claim=work.claim(f.a.scope,op.id);assert.ok(claim);const envelope=work.beginSend(f.a.scope,op.id,claim.lease_token);onSending?.(op);journal.arm('after_accept');assert.throws(()=>journal.send(envelope),/SYNTHETIC_RESPONSE_LOST/);work.finish(f.a.scope,op.id,claim.lease_token,{kind:'unknown'});
    assert.equal(ops.read(f.a.scope,op.id).state,'unknown');return {op,ops,work,journal,db,close:()=>db.close()};
  }catch(error){db.close();throw error;}
}
export function lostNativeReturn(f:any){
  let creates=0,reads=0;const records=new Map<string,Value>();
  const adapter=new ShopifyReturnFixtureAdapter({mode:'fixture',identity:'journey-native-return',tenant:f.a.tenant,store:f.a.store,transport:async({query,variables})=>{
    if(query!==CREATE_RETURN){reads++;return {status:200,api_version:'2026-10',body:{data:{return:records.get(variables.id)??null}}};}
    creates++;const value={id:'gid://shopify/Return/701',status:'OPEN',order:{id:variables.returnInput.orderId},returnLineItems:{nodes:variables.returnInput.returnLineItems.map((l:any,i:number)=>({id:'gid://shopify/ReturnLineItem/'+(710+i),quantity:l.quantity,returnReasonNote:l.returnReasonNote,fulfillmentLineItem:{id:l.fulfillmentLineItemId}})),pageInfo:{hasNextPage:false}},reverseFulfillmentOrders:{nodes:[{id:'gid://shopify/ReverseFulfillmentOrder/720'}],pageInfo:{hasNextPage:false}}};
    records.set(value.id,value);throw new Error('JOURNEY_FIXTURE_RESPONSE_LOST');
  }});
  return {native:new NativeReturns(f.kernel,adapter),counts:()=>({creates,reads})};
}
