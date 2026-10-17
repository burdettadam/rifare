import { createReturnCompletionDemo } from './return-completion-demo.mts';
import { GiftReturns } from '../commerce/gift-returns.mts';
import { ExchangeFinance } from '../commerce/exchange-finance.mts';
import { giftSource } from '../commerce/gift-proof.mts';
/** One disposable fixture behind the normal HTTP and approval boundaries. */
export async function createExchangeDepthDemo(onProof?:(proof:unknown)=>void){
 const f=await createReturnCompletionDemo(),outbox:any[]=[],gifts=new GiftReturns(f.kernel,p=>{outbox.push(p);onProof?.(p);});
 try{
  f.exchanges.configure(f.owner.scope,{expected_revision:0,enabled:true,catalog_wide:true,price_differences:true,allowed_product_ids:[],excluded_product_ids:[],excluded_categories:['final-sale'],incentive_bps:1000,incentive_cap_minor:'200',minimum_margin_bps:2000,expires_at:f.at+300000});
  const catalog=f.kernel.ingest(f.operator.scope,{kind:'catalog',source_system:'synthetic',external_id:'coat-medium',source_version:1,source_updated_at:f.at,customer_id:null,payload:{variant_id:'coat-medium',product_id:'coat',category:'outerwear',active:true,fulfillment_qualified:true,currency:'USD',unit_price_minor:'1200',tax_per_unit_minor:'0',shipping_minor:'0',duties_per_unit_minor:'0',available:8,discount_eligible:true,promotion_expires_at:f.at+300000,excluded:false,cost_minor:'600',exchange_incentive_eligible:true}});
  const giftFacts={gift_id:'gift_receipt_demo',recipient_customer_id:'gift-recipient-demo',recipient_email:'recipient@example.invalid',revision:1,observed_at:f.at,expires_at:f.at+3600000,lines:[{line_id:'gamma',units:[1]}],allowed_outcomes:['exchange','store_credit']};
  const giftOrder=f.kernel.ingest(f.operator.scope,{kind:'order',source_system:'synthetic',external_id:'GIFT-DEMO-1001',source_version:1,source_updated_at:f.at,customer_id:f.order.customer_id,payload:{...f.order.payload,native_order_id:'gid://shopify/Order/9011',gift_facts:giftFacts}});
  f.source.seed({resource_id:giftOrder.id,customer_id:giftOrder.customer_id,payment_id:'demo-payment',currency:'USD',available_minor:'6800'});
  f.source.seedGiftRecipient({resource_id:giftOrder.id,recipient_customer_id:giftFacts.recipient_customer_id,gift_source_digest:giftSource(f.kernel,'demo',f.store,giftOrder.id).source_digest});
  return {...f,gifts,giftFacts,giftOrder,outbox,catalog,exchangeFinance:new ExchangeFinance(f.kernel),exchangeAllocation:f.plan.allocations.find(a=>a.outcome==='exchange')};
 }catch(error){f.cleanup();throw error;}
}
