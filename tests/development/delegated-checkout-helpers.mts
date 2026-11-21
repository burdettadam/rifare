import { shoppingFixture } from './growth-shopping-helpers.mts';
import { CheckoutPreviews } from '../../packages/commerce/checkout-previews.mts';
import { CheckoutQuoteFixtureSource } from '../../packages/adapters/checkout-quote-fixture-source.mts';
import { CustomerAccess } from '../../packages/commerce/customer-access.mts';
import type { Row } from '../../packages/commerce/kernel.mts';

export async function checkoutFixture(options:{lamp?:boolean;confirm?:boolean;max_previews?:number;tax_bps?:number}={}) {
  const catalog=options.lamp||options.tax_bps!==undefined?[['basic',options.lamp?'6800':'2000'],['equal','2000'],['upgrade','3000'],['cheaper','1000']].map(([id,unit_minor])=>({id,
    product_id:id==='basic'&&options.lamp?'desk_lamp':'shirt',unit_minor,stock:10,currency:'USD',tax_bps:options.tax_bps??0,
    subscription:false,excluded:false,available:true})):undefined;
  const base=shoppingFixture(catalog?{catalog}:{}),f={...base,original:base.original as Row},owners:CheckoutPreviews[]=[];
  try{
    const cart=f.carts.propose(f.a.scope,{cart_id:'checkout-cart',resource_id:f.original.id,
      items:[{variant_id:'basic',quantity:options.lamp?1:2}]});
    if(options.confirm!==false)await f.carts.confirm(f.customer,{cart_id:cart.cart_id,preview_digest:cart.preview_digest});
    const quotes=new CheckoutQuoteFixtureSource(f.catalogSource);
    const quote=(kind:'shipping'|'fee',extra:any={})=>quotes.fixtureQuote({quote_id:kind+'-quote',kind,cart_id:cart.cart_id,
      expected_revision:0,amount_minor:'0',currency:'USD',explicit_zero:true,expires_at:f.now()+60000,...extra});
    if(options.confirm!==false){quote('shipping');quote('fee');}
    const newOwner=(config:any={})=>{const value=new CheckoutPreviews(f.kernel,f.carts,quotes,config);owners.push(value);return value;};
    const previews=newOwner(options.max_previews?{max_previews:options.max_previews}:{});
    const request={cart_id:cart.cart_id,shipping_quote_id:'shipping-quote',fee_quote_id:'fee-quote'};
    const effects=()=>({native:f.native.snapshot(f.original.id),tables:Object.fromEntries([
      'growth_source_carts','growth_source_cart_effects','edit_source_effects','edit_source_finance','edit_source_fulfillments',
    ].map(table=>[table,f.sourceDb.prepare('SELECT * FROM '+table).all()])),
      canonical:f.db.prepare('SELECT * FROM commerce_shopping_carts').all(),
      operations:f.db.prepare('SELECT * FROM commerce_operations').all()});
    return {...f,cartPreview:cart,quotes,quote,newOwner,previews,request,effects,
      cleanup:()=>{for(const o of owners)o.close();quotes.close();f.cleanup();}};
  }catch(error){for(const o of owners)o.close();f.cleanup();throw error;}
}
export async function usingCheckout(fn:(f:Awaited<ReturnType<typeof checkoutFixture>>)=>unknown,options:Parameters<typeof checkoutFixture>[0]={}) {
  const f=await checkoutFixture(options);try{await fn(f);}finally{f.cleanup();}
}

export function changedProof(f:Awaited<ReturnType<typeof checkoutFixture>>,emailChanged=false) {
  const customer=f.kernel.lookup(f.a.scope,'customer','synthetic',f.original.customer_id) as Row;
  f.kernel.ingest(f.a.scope,{kind:'customer',source_system:customer.source_system,external_id:customer.external_id,
    source_version:customer.source_version+1,source_updated_at:f.now(),customer_id:customer.customer_id,
    payload:{...customer.payload,...(emailChanged?{email:'changed-owner@example.invalid'}:{})}});
}
export function customerScope(f:Awaited<ReturnType<typeof checkoutFixture>>,store_id:string,order_number:string,email:string) {
  const messages:any[]=[],access=new CustomerAccess(f.kernel,p=>messages.push(p));
  const challenge=access.request({store_id,order_number,email},'127.0.0.1');
  return f.kernel.authenticate(access.complete({store_id,challenge_id:challenge.challenge_id,proof:messages.at(-1).proof}).token);
}
export function changedTerms(f:Awaited<ReturnType<typeof checkoutFixture>>) {
  const item=f.catalogSource.item('basic');
  f.catalogSource.fixtureListing({variant_id:'basic',expected_revision:item.listing_revision,title:item.title,
    description:item.description,approved_descriptions:item.approved_descriptions,
    terms:{...item.terms,revision:item.terms.revision+1,text:'Revised synthetic terms.'}});
}
export function changedPrice(f:Awaited<ReturnType<typeof checkoutFixture>>) {
  const order=f.native.order(f.original.id);
  f.native.seed({...order,resource_id:'second-native-order'},[{...f.native.catalog('basic'),unit_minor:'2100'}]);
}
