import { exact,id } from './kernel.mts';
import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { growthBody,growthScope,growthCustomer } from './growth-shopping-core.mts';
import { assertRecoveryEgress } from './data-guards.mts';
import { assertExecution } from './execution-stops.mts';
import { EDIT_ACTION,editMinor } from './order-edit-core.mts';
import { ShoppingCatalogFixtureSource } from '../adapters/shopping-catalog-fixture-source.mts';

/** Optional local cart capability. It cannot create checkout, payment, or a stock reservation. */
export class ShoppingCart {
 readonly kernel:CommerceKernel;readonly source:ShoppingCatalogFixtureSource|undefined;
 constructor(kernel:CommerceKernel,source?:ShoppingCatalogFixtureSource){this.kernel=kernel;this.source=source;if(source?.db===kernel.db)throw new Error('SEPARATE_FIXTURE_SOURCE_REQUIRED');}
 get available(){return !!this.source;}
 #source(s:Row){const source=this.source;if(!source)throw new Error('SHOPPING_SOURCE_UNAVAILABLE');if(source.tenant!==s.tenant_id||source.store!==s.store_id)throw new Error('SHOPPING_SOURCE_SCOPE_MISMATCH');return source;}
 #row(scope:Scope,cartId:string){const k=this.kernel,s=k.require(scope),row=k.db.prepare('SELECT * FROM commerce_shopping_carts WHERE tenant_id=? AND store_id=? AND cart_id=?').get(s.tenant_id,s.store_id,id(cartId)) as Row,b=growthBody(row);const {order}=growthScope(k,scope,row.resource_id);
  if(b.cart_id!==row.cart_id||b.resource_id!==row.resource_id||b.customer_id!==row.customer_id||order.customer_id!==row.customer_id)throw new Error('GROWTH_INTEGRITY');const source=this.#source(s);if(b.source_identity!==source.identity)throw new Error('SHOPPING_SOURCE_CHANGED');return {s,row,b,source};
 }
 recommend(scope:Scope,input:unknown){const p=exact(jsonValue(input),['resource_id','suggestions']),{s}=growthScope(this.kernel,scope,p.resource_id),source=this.#source(s);
  if(!Array.isArray(p.suggestions)||!p.suggestions.length||p.suggestions.length>30)throw new Error('INVALID_INPUT');
  const items=p.suggestions.map((value:unknown)=>{const suggestion=exact(jsonValue(value),['variant_id','unit_minor']);id(suggestion.variant_id);editMinor(suggestion.unit_minor);
   const facts = source.item(suggestion.variant_id);
   if(facts.unit_minor!==suggestion.unit_minor)throw new Error('SHOPPING_MODEL_FACT_MISMATCH');if(!facts.available||facts.excluded||facts.subscription||facts.stock<1)throw new Error('SHOPPING_ITEM_UNSUPPORTED');
   return {variant_id:suggestion.variant_id,product_id:facts.product_id,unit_minor:facts.unit_minor,currency:facts.currency,stock:facts.stock,terms:facts.terms,source_revision:facts.revision};
  });return {items,source_identity:source.identity,cart_changed:false,checkout_supported:false,payment_authorized:false,qualification:'synthetic_only'};
 }
 propose(scope:Scope,input:unknown){const p=exact(jsonValue(input),['cart_id','resource_id','items']);id(p.cart_id);const k=this.kernel;
  return k.transaction(()=>{const {s,order}=growthScope(k,scope,p.resource_id,'action.propose');assertRecoveryEgress(k);const control=assertExecution(k,s,EDIT_ACTION),source=this.#source(s),preview=source.cartPreview(order.id,p.items),digest=contentDigest(preview),old=k.db.prepare('SELECT * FROM commerce_shopping_carts WHERE tenant_id=? AND store_id=? AND cart_id=?').get(s.tenant_id,s.store_id,p.cart_id) as Row|undefined;
   if(old){const b=growthBody(old);if(b.resource_id!==p.resource_id||b.preview_digest!==digest)throw new Error('SHOPPING_CART_CONFLICT');return this.currentPreview(scope,p.cart_id);}
   const body={cart_id:p.cart_id,resource_id:order.id,customer_id:order.customer_id,source_identity:source.identity,preview,preview_digest:digest,operation_id:'cart_'+contentDigest([s.tenant_id,s.store_id,p.cart_id,digest]).slice(0,40),control_stamp:control.stamp,created_at:k.clock(),receipt:null};
   k.db.prepare("INSERT INTO commerce_shopping_carts VALUES(?,?,?,?,?,'proposed',?,?)").run(s.tenant_id,s.store_id,p.cart_id,order.id,order.customer_id,canonical(body),contentDigest(body));return this.currentPreview(scope,p.cart_id);
  });
 }
 currentPreview(scope:Scope,cartId:string){const {row,b,source}=this.#row(scope,cartId),preview=source.cartPreview(row.resource_id,b.preview.items.map((i:Row)=>({variant_id:i.variant_id,quantity:i.quantity})));
  return {cart_id:row.cart_id,...preview,preview_digest:contentDigest(preview),stored_preview_digest:b.preview_digest,requires_new_proposal:contentDigest(preview)!==b.preview_digest,committed:row.state==='committed',state:row.state};
 }
 #save(scope:Scope,cartId:string,receipt:Row){const k=this.kernel,{s,row,b,source}=this.#row(scope,cartId);
  if(receipt.operation_id!==b.operation_id||receipt.cart_id!==row.cart_id||receipt.resource_id!==row.resource_id||receipt.customer_id!==row.customer_id||receipt.source_identity!==source.identity||receipt.preview_digest!==b.preview_digest||receipt.command_digest!==contentDigest(this.#command(s,row,b))||!receipt.native_id||receipt.qualification!=='synthetic_only')throw new Error('SHOPPING_RECEIPT_MISMATCH');
  const body={...b,receipt};k.db.prepare("UPDATE commerce_shopping_carts SET state='committed',body=?,digest=? WHERE tenant_id=? AND store_id=? AND cart_id=?").run(canonical(body),contentDigest(body),s.tenant_id,s.store_id,row.cart_id);
 }
 #command(s:Row,row:Row,b:Row){return {operation_id:b.operation_id,cart_id:row.cart_id,tenant_id:s.tenant_id,store_id:s.store_id,resource_id:row.resource_id,customer_id:row.customer_id,source_identity:b.source_identity,preview_digest:b.preview_digest,items:b.preview.items.map((i:Row)=>({variant_id:i.variant_id,quantity:i.quantity}))};}
 async confirm(scope:Scope,input:unknown){const p=exact(jsonValue(input),['cart_id','preview_digest']),k=this.kernel,{s,row,b,source}=this.#row(scope,p.cart_id);growthCustomer(k,scope,row.resource_id,row.customer_id);if(p.preview_digest!==b.preview_digest)throw new Error('SHOPPING_PREVIEW_CHANGED');assertRecoveryEgress(k);assertExecution(k,s,EDIT_ACTION,b.control_stamp);
  if(row.state==='committed')return this.readCart(scope,row.cart_id);
  if(row.state==='unknown'){const receipt=source.lookupCart(b.operation_id);if(receipt)k.transaction(()=>{growthCustomer(k,scope,row.resource_id,row.customer_id);this.#save(scope,row.cart_id,receipt);});return this.readCart(scope,row.cart_id);}
  const guard=()=>{const current=this.#row(scope,row.cart_id);growthCustomer(k,scope,row.resource_id,row.customer_id);assertRecoveryEgress(k);assertExecution(k,current.s,EDIT_ACTION,b.control_stamp);if(current.b.preview_digest!==p.preview_digest||contentDigest(source.cartPreview(row.resource_id,this.#command(s,row,b).items))!==p.preview_digest)throw new Error('SHOPPING_PREVIEW_CHANGED');};
  guard();k.transaction(()=>{guard();k.db.prepare("UPDATE commerce_shopping_carts SET state='unknown' WHERE tenant_id=? AND store_id=? AND cart_id=? AND state='proposed'").run(s.tenant_id,s.store_id,row.cart_id);});
  try{const receipt=await source.commitCart(this.#command(s,row,b),guard);k.transaction(()=>{growthCustomer(k,scope,row.resource_id,row.customer_id);this.#save(scope,row.cart_id,receipt);});}catch{return this.readCart(scope,row.cart_id);}return this.readCart(scope,row.cart_id);
 }
 readCart(scope:Scope,cartId:string){const {row,b,source}=this.#row(scope,cartId),native=source.cart(row.cart_id);
  if(native&&(native.resource_id!==row.resource_id||native.subject_id!==row.customer_id||native.operation_id!==b.operation_id||native.preview_digest!==b.preview_digest))throw new Error('SHOPPING_CART_MISMATCH');
  return {cart_id:row.cart_id,resource_id:row.resource_id,subject_id:row.customer_id,status:native?.status??'active',revision:native?.revision??0,updated_at:native?.updated_at??b.created_at,native_order_id:native?.native_order_id??null,preview_digest:b.preview_digest,committed:row.state==='committed',state:row.state,operation_id:b.operation_id,native_id:native?.native_id??null,checkout_supported:false,payment_authorized:false,qualification:'synthetic_only'};
 }
}
