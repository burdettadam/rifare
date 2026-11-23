import { randomUUID } from 'node:crypto';
import { exact,id,integer } from './kernel.mts';
import type { CommerceKernel,Scope } from './kernel.mts';
import { contentDigest } from './configuration-values.mts';
import { growthCustomer } from './growth-shopping-core.mts';
import { assertRecoveryEgress } from './data-guards.mts';
import { ShoppingCart } from './shopping-cart.mts';
import { CheckoutPreviewComposer,checkoutSnapshot } from './checkout-preview.mts';
import type { CheckoutPreviewRequest,FrozenCheckoutPreview,TrustedCheckoutObservation } from './checkout-preview.mts';
import { CheckoutQuoteFixtureSource } from '../adapters/checkout-quote-fixture-source.mts';

type Options=Readonly<{lifetime_ms?:number;max_previews?:number}>;

/** Native owner for local synthetic previews. All public operations use opaque
 * kernel Scope; read/revalidate accept only an owner-created ID. No HTTP route,
 * payment, purchase, stock reservation or delegated execution is exposed. */
export class CheckoutPreviews {
  readonly #kernel:CommerceKernel;
  readonly #clock:()=>number;
  readonly #readCart:ShoppingCart['readCart'];
  readonly #current:ShoppingCart['currentPreview'];
  readonly #quotes:CheckoutQuoteFixtureSource|undefined;
  readonly #quoteRead:CheckoutQuoteFixtureSource['read']|undefined;
  readonly #composer:CheckoutPreviewComposer<Scope>;
  readonly #maximum:number;
  readonly #previews=new Map<string,FrozenCheckoutPreview>();
  #inFlight=0;
  #lastTime=0;
  #closed=false;

  constructor(kernel:CommerceKernel,carts:ShoppingCart,quotes?:CheckoutQuoteFixtureSource,options:Options={}) {
    const config=checkoutSnapshot(options),keys=Object.keys(config);
    if(keys.some(k=>!['lifetime_ms','max_previews'].includes(k)))throw new Error('CHECKOUT_CONFIG_INVALID');
    exact(config,keys);
    const maximum=config.max_previews??128;integer(maximum,1);
    if(maximum>128||!(carts instanceof ShoppingCart)||carts.kernel!==kernel||
      (quotes&&(!(quotes instanceof CheckoutQuoteFixtureSource)||!carts.source||!quotes.boundTo(carts.source))))throw new Error('CHECKOUT_CONFIG_INVALID');
    this.#kernel=kernel;this.#clock=kernel.clock.bind(kernel);this.#maximum=maximum;
    this.#readCart=carts.readCart.bind(carts);this.#current=carts.currentPreview.bind(carts);
    this.#quotes=quotes;this.#quoteRead=quotes?.read.bind(quotes);
    this.#composer=new CheckoutPreviewComposer({source:{observe:(scope,request)=>this.#observe(scope,request)},
      contentDigest,now:()=>this.#now(),createId:()=> 'checkout_'+randomUUID().replaceAll('-',''),lifetime_ms:config.lifetime_ms??60000});
  }
  get available():boolean { return !this.#closed&&!!this.#quoteRead; }
  /** Constructor-time owner identity check; it grants no scoped access. */
  boundTo(kernel:CommerceKernel):boolean { return this.#kernel===kernel; }
  #now():number {
    if(this.#closed)throw new Error('CHECKOUT_UNAVAILABLE');
    const now=this.#clock();
    if(!Number.isSafeInteger(now)||now<this.#lastTime)throw new Error('CHECKOUT_CLOCK_INVALID');
    this.#lastTime=now;
    for(const [key,preview] of this.#previews)if(preview.expires_at<=now)this.#previews.delete(key);
    return now;
  }
  #observe(scope:Scope,request:CheckoutPreviewRequest):TrustedCheckoutObservation {
    const k=this.#kernel;assertRecoveryEgress(k);
    const cart=this.#readCart(scope,request.cart_id),s=growthCustomer(k,scope,cart.resource_id,cart.subject_id);
    if(!this.#quoteRead||!this.#quotes)throw new Error('CHECKOUT_QUOTE_UNAVAILABLE');
    const current=this.#current(scope,request.cart_id);
    const binding={tenant_id:s.tenant_id,store_id:s.store_id,resource_id:cart.resource_id,customer_id:cart.subject_id,
      cart_id:cart.cart_id,cart_preview_digest:cart.preview_digest,currency:current.currency};
    const shipping=this.#quoteRead('shipping',request.shipping_quote_id,binding);
    const fee=this.#quoteRead('fee',request.fee_quote_id,binding);
    if(!shipping||!fee)throw new Error('CHECKOUT_QUOTE_UNAVAILABLE');
    return checkoutSnapshot({...binding,merchant_id:s.store_id,cart,current,
      shipping_quote:shipping.quote,fee_quote:fee.quote,valid_until:Math.min(shipping.expires_at,fee.expires_at)}) as TrustedCheckoutObservation;
  }
  #reserve(preparing:boolean):void {
    this.#now();
    if(this.#inFlight>=this.#maximum||(preparing&&this.#previews.size+this.#inFlight>=this.#maximum))throw new Error('CHECKOUT_PREVIEW_CAPACITY');
    this.#inFlight++;
  }
  #lookup(scope:Scope,previewId:string):FrozenCheckoutPreview {
    this.#now();
    const s=this.#kernel.require(scope),preview=this.#previews.get(id(previewId));
    if(!preview||s.tenant_id!==preview.tenant_id||s.store_id!==preview.store_id||s.role!=='customer'||
      s.resource_id!==preview.resource_id||s.customer_id!==preview.customer_id)throw new Error('NOT_FOUND');
    try{assertRecoveryEgress(this.#kernel);growthCustomer(this.#kernel,scope,preview.resource_id,preview.customer_id);}
    catch(error){this.#previews.delete(previewId);throw error;}
    return preview;
  }
  #finish(scope:Scope,preview:FrozenCheckoutPreview):void {
    // This synchronous final observation follows the composer's last await.
    // Source revocation or quote expiry in that final microtask cannot publish.
    const current=this.#observe(scope,{cart_id:preview.cart_id,shipping_quote_id:preview.shipping_quote.quote_id,fee_quote_id:preview.fee_quote.quote_id});
    this.#composer.assertObservation(preview,current);
    // Source callbacks and final hashing are complete. Recheck live authority
    // after that work, including a session that expired while facts stayed fresh.
    const session=growthCustomer(this.#kernel,scope,preview.resource_id,preview.customer_id);
    assertRecoveryEgress(this.#kernel);
    const now=this.#now();
    if(now>=preview.expires_at)throw new Error('CHECKOUT_PREVIEW_EXPIRED');
    if(now>=session.expires_at)throw new Error('ACCESS_DENIED');
  }

  async prepare(scope:Scope,input:CheckoutPreviewRequest):Promise<FrozenCheckoutPreview> {
    this.#reserve(true);
    try{
      const preview=await this.#composer.prepare(scope,input);this.#finish(scope,preview);
      if(this.#previews.size>=this.#maximum||this.#previews.has(preview.preview_id))throw new Error('CHECKOUT_PREVIEW_CAPACITY');
      this.#previews.set(preview.preview_id,preview);return preview;
    }finally{this.#inFlight--;}
  }
  /** Read is a current-source revalidation, never an unchecked cached disclosure. */
  async read(scope:Scope,previewId:string):Promise<FrozenCheckoutPreview> { return this.revalidate(scope,previewId); }
  /** A no-await final guard for local composition after asynchronous receipt work. */
  current(scope:Scope,previewId:string):FrozenCheckoutPreview {
    const preview=this.#lookup(scope,previewId);
    try{this.#finish(scope,preview);return preview;}
    catch(error){this.#previews.delete(preview.preview_id);throw error;}
  }
  async revalidate(scope:Scope,previewId:string):Promise<FrozenCheckoutPreview> {
    const preview=this.#lookup(scope,previewId);this.#reserve(false);
    try{
      const checked=await this.#composer.revalidate(scope,preview);this.#finish(scope,checked);
      return preview;
    }catch(error){this.#previews.delete(preview.preview_id);throw error;}
    finally{this.#inFlight--;}
  }
  close():void { this.#previews.clear();this.#closed=true; }
}
