import { exact,id,integer } from '../commerce/kernel.mts';
import { contentDigest } from '../commerce/configuration-values.mts';
import { editMinor } from '../commerce/order-edit-core.mts';
import { checkoutSnapshot } from '../commerce/checkout-preview.mts';
import type { CheckoutQuote } from '../commerce/checkout-preview.mts';
import { ShoppingCatalogFixtureSource } from './shopping-catalog-fixture-source.mts';

export type CheckoutQuoteBinding=Readonly<{
  tenant_id:string;store_id:string;resource_id:string;customer_id:string;
  cart_id:string;cart_preview_digest:string;currency:string;
}>;
type Kind='shipping'|'fee';
type Record=Readonly<{
  binding:CheckoutQuoteBinding;kind:Kind;revision:number;issued_at:number;
  expires_at:number;quote:CheckoutQuote;
}>;

/** Explicit synthetic observations, never a rate engine or a default-zero policy.
 * Records are process-local, bounded and lost on restart; fixture administration
 * is server-only and is not a shopper/HTTP permission. */
export class CheckoutQuoteFixtureSource {
  readonly #source:ShoppingCatalogFixtureSource;
  readonly #clock:()=>number;
  readonly #cart:ShoppingCatalogFixtureSource['cart'];
  readonly #current:ShoppingCatalogFixtureSource['cartPreview'];
  readonly #tenant:string;
  readonly #store:string;
  readonly #identity:string;
  readonly #quotes=new Map<string,Record>();
  #lastTime=0;
  #closed=false;

  constructor(source:ShoppingCatalogFixtureSource) {
    if(!(source instanceof ShoppingCatalogFixtureSource))throw new Error('CHECKOUT_SOURCE_REQUIRED');
    this.#source=source;this.#clock=source.clock.bind(source);
    this.#cart=source.cart.bind(source);this.#current=source.cartPreview.bind(source);
    this.#tenant=id(source.tenant);this.#store=id(source.store);this.#identity=id(source.identity);
  }
  boundTo(source:ShoppingCatalogFixtureSource):boolean { return !this.#closed&&source===this.#source; }
  #now():number {
    if(this.#closed)throw new Error('CHECKOUT_QUOTE_UNAVAILABLE');
    const now=this.#clock();
    if(!Number.isSafeInteger(now)||now<this.#lastTime)throw new Error('CHECKOUT_CLOCK_INVALID');
    this.#lastTime=now;
    for(const [key,record] of this.#quotes)if(record.expires_at<=now)this.#quotes.delete(key);
    return now;
  }
  #native(cartId:string) {
    const cart=this.#cart(id(cartId));
    if(!cart||cart.status!=='active'||cart.qualification!=='synthetic_only')throw new Error('CHECKOUT_CART_NOT_ACTIVE');
    const current=this.#current(cart.resource_id,cart.preview.items.map((i:any)=>({variant_id:i.variant_id,quantity:i.quantity})));
    if(current.subject_id!==cart.subject_id||contentDigest(current)!==cart.preview_digest)throw new Error('CHECKOUT_CART_CHANGED');
    return cart;
  }

  fixtureQuote(input:unknown):Readonly<{revision:number;quote:CheckoutQuote;expires_at:number}> {
    const p=exact(checkoutSnapshot(input),['quote_id','kind','cart_id','expected_revision','amount_minor','currency','explicit_zero','expires_at']);
    id(p.quote_id);id(p.cart_id);integer(p.expected_revision);
    if(p.kind!=='shipping'&&p.kind!=='fee')throw new Error('CHECKOUT_QUOTE_INVALID');
    const amount=editMinor(p.amount_minor),now=this.#now();
    if(!Number.isSafeInteger(p.expires_at)||p.expires_at<=now||p.expires_at-now>600000||
      typeof p.explicit_zero!=='boolean'||p.explicit_zero!==(amount===0n))throw new Error('CHECKOUT_QUOTE_INVALID');
    const cart=this.#native(p.cart_id);
    if(p.currency!==cart.preview.currency)throw new Error('CHECKOUT_CURRENCY_MISMATCH');
    const old=this.#quotes.get(p.quote_id);
    if((old?.revision??0)!==p.expected_revision||p.expected_revision>=Number.MAX_SAFE_INTEGER)throw new Error('CHECKOUT_QUOTE_CHANGED');
    if(!old&&this.#quotes.size>=256)throw new Error('CHECKOUT_QUOTE_CAPACITY');
    const binding:CheckoutQuoteBinding={tenant_id:this.#tenant,store_id:this.#store,
      resource_id:cart.resource_id,customer_id:cart.subject_id,cart_id:cart.cart_id,
      cart_preview_digest:cart.preview_digest,currency:p.currency};
    const revision=p.expected_revision+1;
    const source_revision=contentDigest({binding,kind:p.kind,quote_id:p.quote_id,revision,
      issued_at:now,expires_at:p.expires_at,amount_minor:p.amount_minor,explicit_zero:p.explicit_zero});
    const quote:CheckoutQuote={quote_id:p.quote_id,source_identity:this.#identity,source_revision,
      amount_minor:p.amount_minor,currency:p.currency,explicit_zero:p.explicit_zero};
    this.#quotes.set(p.quote_id,checkoutSnapshot({binding,kind:p.kind,revision,issued_at:now,expires_at:p.expires_at,quote}));
    return checkoutSnapshot({revision,quote,expires_at:p.expires_at});
  }

  read(kind:Kind,quoteId:string,input:CheckoutQuoteBinding):Readonly<{quote:CheckoutQuote;expires_at:number}>|null {
    const now=this.#now(),binding=checkoutSnapshot(input),record=this.#quotes.get(id(quoteId));
    if(!record||record.kind!==kind||now<record.issued_at||now>=record.expires_at)return null;
    if(Object.keys(binding).length!==Object.keys(record.binding).length||
      Object.entries(record.binding).some(([key,value])=>binding[key as keyof CheckoutQuoteBinding]!==value))return null;
    return checkoutSnapshot({quote:record.quote,expires_at:record.expires_at});
  }

  /** Explicit teardown for a synthetic fixture; does not delete external copies. */
  close():void { this.#quotes.clear();this.#closed=true; }
}
