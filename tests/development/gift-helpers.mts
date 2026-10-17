import { resolutionFixture } from './resolution-helpers.mts';
import { GiftReturns } from '../../packages/commerce/gift-returns.mts';
import { CustomerAccess } from '../../packages/commerce/customer-access.mts';
import { NativeReturns } from '../../packages/commerce/native-returns.mts';
import { ShopifyReturnFixtureAdapter } from '../../packages/adapters/shopify-return-fixture.mts';

export async function giftFixture(){
 const f=await resolutionFixture({zeroFees:true}),outbox:any[]=[],gifts=new GiftReturns(f.kernel,p=>outbox.push(p));
 const giftFacts={gift_id:'gift_receipt_one',recipient_customer_id:'recipient-one',recipient_email:'recipient@example.invalid',revision:1,observed_at:f.now(),expires_at:f.now()+3600000,lines:[{line_id:'gamma',units:[1]}],allowed_outcomes:['exchange','store_credit']};
 const original=f.order(),giftOrder=f.kernel.ingest(f.a.scope,{kind:'order',source_system:'synthetic',external_id:'GIFT-2001',source_version:1,source_updated_at:f.now(),customer_id:original.customer_id,payload:{...original.payload,native_order_id:'gid://shopify/Order/251',gift_facts:giftFacts,purchaser_name:'Private Purchaser',shipping_address:'Hidden Buyer Address'}});
 f.source.seed({resource_id:giftOrder.id,customer_id:giftOrder.customer_id,payment_id:'payment-one',currency:'USD',available_minor:'6800'});
 const challenge=gifts.request({store_id:f.a.store,gift_id:giftFacts.gift_id,email:giftFacts.recipient_email},'gift-client'),proof=outbox.at(-1),verified=gifts.complete({store_id:f.a.store,challenge_id:challenge.challenge_id,proof:proof.proof});
 const accessInput={store_id:f.a.store,token:verified.token};
 const create=(caseId='gift_case')=>gifts.createCase(f.a.scope,{gift_token:verified.token,case_id:caseId,profile_id:'default',policy_id:'returns'});
 const prepare=(patch:any={})=>gifts.prepare(f.a.scope,{gift_token:verified.token,case_id:'gift_case',lines:[{line_id:'gamma',quantity:1}],outcome:'exchange',reason:'size',request_key:'gift-request',...patch});
 const giftOrderNow=()=>f.kernel.get(f.a.scope,giftOrder.id);
 const updateGift=(patch:any)=>{const o=giftOrderNow();return f.kernel.ingest(f.a.scope,{kind:'order',source_system:'synthetic',external_id:o.external_id,source_version:o.source_version+1,source_updated_at:f.now(),customer_id:o.customer_id,payload:{...o.payload,...patch}});};
 const renewGift=()=>{const g=giftOrderNow().payload.gift_facts,q=gifts.request({store_id:f.a.store,gift_id:g.gift_id,email:g.recipient_email},'gift-renewal');return gifts.complete({store_id:f.a.store,challenge_id:q.challenge_id,proof:outbox.at(-1).proof});};
 const buyerProofs:any[]=[],buyerAccess=new CustomerAccess(f.kernel,p=>buyerProofs.push(p)),buyerChallenge=buyerAccess.request({store_id:f.a.store,order_number:'GIFT-2001',email:'shopper-apparel@example.invalid'},'buyer-client');
 const buyerVerified=buyerAccess.complete({store_id:f.a.store,challenge_id:buyerChallenge.challenge_id,proof:buyerProofs.at(-1).proof}),buyer=f.kernel.authenticate(buyerVerified.token);
 const authorizeGift=async(outcome='exchange')=>{create();prepare({outcome});const request=f.intake.read(f.a.scope,'gift_case');f.submit(request);
  const adapter=new ShopifyReturnFixtureAdapter({mode:'fixture',identity:'gift-native',tenant:f.a.tenant,store:f.a.store,transport:async({variables})=>{
   const record={id:'gid://shopify/Return/940',status:'OPEN',order:{id:variables.returnInput.orderId},
    returnLineItems:{nodes:variables.returnInput.returnLineItems.map((l:any)=>({id:'gid://shopify/ReturnLineItem/941',quantity:l.quantity,returnReasonNote:l.returnReasonNote,fulfillmentLineItem:{id:l.fulfillmentLineItemId}})),pageInfo:{hasNextPage:false}},
    reverseFulfillmentOrders:{nodes:[{id:'gid://shopify/ReverseFulfillmentOrder/941'}],pageInfo:{hasNextPage:false}}};
   return {status:200,api_version:'2026-10',body:{data:{returnCreate:{userErrors:[],return:record}}}};
  }});
  await new NativeReturns(f.kernel,adapter).create(f.a.scope,request.id!);
  return f.ledger.allocate(f.a.scope,{request_id:request.id,request_key:'gift-allocation',lines:[{line_id:'gamma',units:[1],outcome}]});
 };
 return {...f,gifts,giftFacts,giftOrder,giftOrderNow,updateGift,renewGift,outbox,challenge,proof,verified,accessInput,createGift:create,prepareGift:prepare,buyer,buyerVerified,authorizeGift};
}
export async function usingGift(fn:(f:Awaited<ReturnType<typeof giftFixture>>)=>unknown){const f=await giftFixture();try{return await fn(f);}finally{f.cleanup();}}
