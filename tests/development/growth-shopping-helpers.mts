import { editFixture } from './order-edit-helpers.mts';
import { ShoppingCatalogFixtureSource } from '../../packages/adapters/shopping-catalog-fixture-source.mts';
import { ShoppingCart } from '../../packages/commerce/shopping-cart.mts';
import { PreFulfillmentUpsells } from '../../packages/commerce/pre-fulfillment-upsells.mts';
import { CatalogVisibility, ReviewedCatalogChanges } from '../../packages/commerce/catalog-growth.mts';

export function shoppingFixture(options:any={}) {
 const f=editFixture(options),catalogSource=new ShoppingCatalogFixtureSource(f.native);
 for(const v of f.catalog)catalogSource.fixtureListing({variant_id:v.id,expected_revision:0,title:'Synthetic cotton shirt',description:'Cotton shirt.',approved_descriptions:['Cotton shirt.','Cotton shirt with a crew neck.'],terms:{id:'standard',revision:1,text:'No promotional discount.'}});
 const carts=new ShoppingCart(f.kernel,catalogSource),upsells=new PreFulfillmentUpsells(f.edits),visibility=new CatalogVisibility(f.kernel,catalogSource),changes=new ReviewedCatalogChanges(f.kernel,catalogSource);
 const cart=(cart_id='cart-one')=>carts.propose(f.a.scope,{cart_id,resource_id:f.original.id,items:[{variant_id:'basic',quantity:2}]});
 const offer=(offer_id='upsell-one')=>upsells.offer(f.a.scope,{offer_id,case_id:'case_one',variant_id:'upgrade',quantity:1,warehouse_id:'warehouse_one'});
 const confirmOffer=(o:any)=>upsells.confirm(f.customer,{offer_id:o.offer_id,quote_digest:o.quote_digest});
 const authorizeOffer=(o:any)=>{confirmOffer(o);const p=f.edits.prepare(f.a.scope,{quote_id:o.quote_id,quote_digest:o.quote_digest}),a=f.gateway.approve(f.reviewer.scope,{preview_id:p.id,preview_digest:p.digest});return f.gateway.execute(f.a.scope,{preview_id:p.id,preview_digest:p.digest,approval_id:a.id}).order_edit_id;};
 const observe=(observation_id='visibility-one',extra:any={})=>catalogSource.fixtureVisibility({observation_id,interface:'permitted_fixture',prompt_set:{id:'shirts-v1',questions:[{id:'q-basic',text:'Find an in-stock cotton shirt.'}]},model:{provider:'fixture-provider',model:'fixture-model-v1',settings:{temperature:0}},answers:[{question_id:'q-basic',observed:true,mentions:[{variant_id:'basic',unit_minor:'2000',available:true}],citations:[{variant_id:'basic',source_revision:catalogSource.item('basic').revision,uri:'https://catalog.example.invalid/basic'}]}],...extra});
 const change=(change_id='catalog-one',extra:any={})=>changes.propose(f.a.scope,{change_id,resource_id:f.original.id,variant_id:'basic',expected_revision:catalogSource.item('basic').revision,description:'Cotton shirt with a crew neck.',origin:'model',...extra});
 const approveChange=(c:any)=>changes.approve(f.reviewer.scope,{change_id:c.change_id,expected_digest:c.digest,expires_at:f.now()+60000});
 return {...f,catalogSource,carts,upsells,visibility,changes,cart,offer,confirmOffer,authorizeOffer,observe,change,approveChange};
}
export async function usingShopping(fn:(f:ReturnType<typeof shoppingFixture>)=>unknown,options:any={}){const f=shoppingFixture(options);try{return await fn(f);}finally{f.cleanup();}}
/** Populates all six new canonical tables through their actual service boundaries. */
export async function populateShoppingPrivacy(f:ReturnType<typeof shoppingFixture>){
 const cart=f.cart();await f.carts.confirm(f.customer,{cart_id:cart.cart_id,preview_digest:cart.preview_digest});
 const offer=f.offer();f.confirmOffer(offer);f.observe();f.visibility.evaluate(f.a.scope,{evaluation_id:'privacy-evaluation',resource_id:f.original.id,observation_id:'visibility-one'});
 const change=f.change();f.approveChange(change);f.catalogSource.fault='after';await f.changes.dispatch(f.a.scope,change.change_id);
 return {cart_id:cart.cart_id,offer_id:offer.offer_id,quote_id:offer.quote_id,change_id:change.change_id,resource_id:f.original.id,customer_id:f.original.customer_id};
}
