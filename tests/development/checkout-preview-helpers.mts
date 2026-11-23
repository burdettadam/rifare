import { readFileSync } from 'node:fs';
import { contentDigest } from '../../packages/commerce/configuration-values.mts';
import { CheckoutPreviewComposer } from '../../packages/commerce/checkout-preview.mts';
import type { TrustedCheckoutObservation } from '../../packages/commerce/checkout-preview.mts';

export const ledger = JSON.parse(readFileSync(new URL('../fixtures/checkout-preview/source-ledger.v1.json', import.meta.url), 'utf8'));
export const request = Object.freeze({cart_id:'cart_demo', shipping_quote_id:'ship_demo_zero', fee_quote_id:'fee_demo_zero'});
export const clone = <T,>(value:T):T => structuredClone(value);

/** Source facts and expected values were fixed independently of the composer. */
export function observation():TrustedCheckoutObservation & {valid_until:number} {
  const {source:s,expected_source_evidence:e}=ledger;
  return clone({
    ...s.merchant,
    cart:{...s.cart,resource_id:s.merchant.resource_id,subject_id:s.merchant.customer_id,
      preview_digest:e.cart_preview_digest,committed:true,qualification:'synthetic_only'},
    current:{cart_id:s.cart.cart_id,resource_id:s.merchant.resource_id,subject_id:s.merchant.customer_id,
      source_identity:e.pricing_source_identity,currency:'USD',items:s.items,total_minor:'6800',
      catalog_digest:e.pricing_source_revision,preview_digest:e.cart_preview_digest,
      stored_preview_digest:e.cart_preview_digest,requires_new_proposal:false,committed:true,
      state:'committed',checkout_supported:false,payment_authorized:false,qualification:'synthetic_only'},
    shipping_quote:s.shipping_quote,fee_quote:s.fee_quote,valid_until:61000,
  });
}

export function composerFixture() {
  let now=1000;
  const data=observation(),source={observe:async(_scope:unknown,_input:unknown)=>clone(data)};
  const deps={source,contentDigest,now:()=>now,createId:()=> 'preview_demo_1',lifetime_ms:60000};
  const composer=new CheckoutPreviewComposer(deps);
  return {data,source,deps,composer,setTime:(value:number)=>{now=value;}};
}

export function barrier() {
  let release!:()=>void;
  const wait=new Promise<void>(resolve=>{release=resolve;});
  return {wait,release};
}
