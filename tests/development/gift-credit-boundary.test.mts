import test from 'node:test';
import assert from 'node:assert/strict';
import { usingGift } from './gift-helpers.mts';
import { NativeReturns } from '../../packages/commerce/native-returns.mts';
import { ShopifyReturnFixtureAdapter } from '../../packages/adapters/shopify-return-fixture.mts';

async function prepareCredit(f:any){
 const plan=await f.authorizeGift('store_credit'),gift=f.cases.verified(f.a.scope,'gift_case');
 f.source.seedGiftRecipient({resource_id:f.giftOrder.id,recipient_customer_id:gift.recipient_customer_id,gift_source_digest:gift.source_digest});
 return {gift,op:f.authorize(f.credit.quote(f.a.scope,plan.allocations[0].id))};
}

async function alteredTransport(f:any,alter:(p:any)=>void){
 const {gift,op}=await prepareCredit(f),issue=f.source.issue.bind(f.source);
 f.source.seedGiftRecipient({resource_id:f.giftOrder.id,recipient_customer_id:'recipient-two',gift_source_digest:gift.source_digest});
 let sends=0;
 f.source.issue=async input=>{sends++;const changed={...input};alter(changed);return issue(changed);};
 assert.equal((await f.executor.dispatch(f.a.scope,op.id)).state,'unknown');
 assert.equal(f.sourceDb.prepare('SELECT count(*) n FROM fixture_resolution_effects').get().n,0);
 assert.equal(f.sourceDb.prepare('SELECT count(*) n FROM fixture_credit_accounts').get().n,0);
 await f.executor.dispatch(f.a.scope,op.id);
 assert.equal((await f.executor.reconcile(f.a.scope,op.id)).state,'unknown');
 assert.equal(sends,1);
}

test('M06-G05-CREDIT-DROPPED-RECIPIENT-PAIR-HAS-NO-NATIVE-EFFECT',()=>usingGift(f=>alteredTransport(f,p=>{delete p.credit_beneficiary_id;delete p.gift_source_digest;})));
test('M06-G05-CREDIT-CHANGED-OPERATION-STILL-BOUND-TO-ALLOCATION',()=>usingGift(f=>alteredTransport(f,p=>{p.operation_id='substituted-operation';p.native_return_id='gid://shopify/Return/998';delete p.credit_beneficiary_id;delete p.gift_source_digest;})));
test('M06-G05-CREDIT-CHANGED-ALLOCATION-STILL-BOUND-TO-NATIVE-RETURN',()=>usingGift(f=>alteredTransport(f,p=>{p.operation_id='substituted-operation';p.allocation_id='substituted-allocation';delete p.credit_beneficiary_id;delete p.gift_source_digest;})));
test('M06-G05-CREDIT-CHANGED-NATIVE-RETURN-STILL-BOUND-TO-OPERATION',()=>usingGift(f=>alteredTransport(f,p=>{p.allocation_id='substituted-allocation';p.native_return_id='gid://shopify/Return/998';delete p.credit_beneficiary_id;delete p.gift_source_digest;})));
test('M06-G05-CREDIT-OTHER-QUALIFIED-RECIPIENT-CANNOT-REPLACE-BENEFICIARY',()=>usingGift(f=>alteredTransport(f,p=>{p.credit_beneficiary_id='recipient-two';})));

test('M06-G05-CREDIT-OBLIGATION-CANNOT-BE-REBOUND',()=>usingGift(async f=>{
 const {gift,op}=await prepareCredit(f),command=JSON.parse(f.db.prepare('SELECT command FROM commerce_resolution_operations WHERE id=?').get(op.id).command);
 f.source.bindGiftResolution(command);f.source.bindGiftResolution(command);
 f.source.seedGiftRecipient({resource_id:f.giftOrder.id,recipient_customer_id:'recipient-two',gift_source_digest:gift.source_digest});
 assert.throws(()=>f.source.bindGiftResolution({...command,credit_beneficiary_id:'recipient-two'}),/GIFT_RECIPIENT_MISMATCH/);
 assert.equal((await f.executor.dispatch(f.a.scope,op.id)).state,'issued');
 assert.equal(f.sourceDb.prepare('SELECT count(*) n FROM fixture_gift_resolution_bindings').get().n,1);
 assert.equal(f.sourceDb.prepare('SELECT customer_id FROM fixture_credit_accounts').get().customer_id,'recipient-one');
}));

test('M06-G05-CREDIT-PURCHASER-OTHER-RETURN-ON-SAME-ORDER-STILL-WORKS',()=>usingGift(async f=>{
 const {op}=await prepareCredit(f);assert.equal((await f.executor.dispatch(f.a.scope,op.id)).state,'issued');
 f.cases.create(f.buyer,{case_id:'buyer_credit_case',resource_id:f.giftOrder.id,profile_id:'default',policy_id:'returns'});
 const quote=f.intake.evaluate(f.buyer,{case_id:'buyer_credit_case',lines:[{line_id:'alpha',quantity:1}],outcome:'store_credit',reason:'size',note:'',evidence_ids:[]});
 const request=f.intake.prepare(f.buyer,{quote_id:quote.id,quote_digest:quote.digest,request_key:'buyer-credit-return',override_id:null});f.submit(request);
 const adapter=new ShopifyReturnFixtureAdapter({mode:'fixture',identity:'buyer-native',tenant:f.a.tenant,store:f.a.store,transport:async({variables})=>({status:200,api_version:'2026-10',body:{data:{returnCreate:{userErrors:[],return:{
  id:'gid://shopify/Return/950',status:'OPEN',order:{id:variables.returnInput.orderId},
  returnLineItems:{nodes:variables.returnInput.returnLineItems.map((line:any)=>({id:'gid://shopify/ReturnLineItem/951',quantity:line.quantity,returnReasonNote:line.returnReasonNote,fulfillmentLineItem:{id:line.fulfillmentLineItemId}})),pageInfo:{hasNextPage:false}},
  reverseFulfillmentOrders:{nodes:[{id:'gid://shopify/ReverseFulfillmentOrder/951'}],pageInfo:{hasNextPage:false}}
 }}}}})});
 await new NativeReturns(f.kernel,adapter).create(f.a.scope,request.id!);
 const plan=f.ledger.allocate(f.a.scope,{request_id:request.id,request_key:'buyer-credit-allocation',lines:[{line_id:'alpha',units:[2],outcome:'store_credit'}]});
 const buyerOp=f.authorize(f.credit.quote(f.a.scope,plan.allocations[0].id));
 assert.equal((await f.executor.dispatch(f.a.scope,buyerOp.id)).state,'issued');
 assert.equal(f.sourceDb.prepare('SELECT balance_minor FROM fixture_credit_accounts WHERE customer_id=?').get(f.giftOrder.customer_id).balance_minor,'1940');
 assert.equal(f.sourceDb.prepare('SELECT balance_minor FROM fixture_credit_accounts WHERE customer_id=?').get('recipient-one').balance_minor,'1000');
 assert.equal(f.sourceDb.prepare('SELECT count(*) n FROM fixture_resolution_effects WHERE resource_id=?').get(f.giftOrder.id).n,2);
}));
