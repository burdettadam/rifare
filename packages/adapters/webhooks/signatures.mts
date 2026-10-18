import { createHmac,timingSafeEqual } from 'node:crypto';

export type WebhookRoute={id:string;topic:string;shop_domain:string;api_version:string};
export function uniqueHeaders(raw:readonly string[]):Record<string,string>{
  if(!Array.isArray(raw)||raw.length%2||raw.length>128)throw new Error('WEBHOOK_HEADERS_INVALID');
  const result:Record<string,string>=Object.create(null);
  for(let i=0;i<raw.length;i+=2){
    const name=raw[i],value=raw[i+1];
    if(typeof name!=='string'||typeof value!=='string'||value.length>2048||/[\r\n]/.test(value))throw new Error('WEBHOOK_HEADERS_INVALID');
    const key=name.toLowerCase();if(Object.hasOwn(result,key))throw new Error('WEBHOOK_HEADERS_INVALID');result[key]=value;
  }
  return result;
}
function signature(value:string|undefined,bytes:Buffer,key:Buffer){
  if(typeof value!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(value))throw new Error('WEBHOOK_SIGNATURE_INVALID');
  const supplied=Buffer.from(value,'base64'),expected=createHmac('sha256',key).update(bytes).digest();
  if(supplied.length!==expected.length||supplied.toString('base64')!==value||!timingSafeEqual(supplied,expected))throw new Error('WEBHOOK_SIGNATURE_INVALID');
}
export function verifyShopifyWebhook(route:WebhookRoute,headers:Record<string,string>,raw:Buffer,key:Buffer){
  signature(headers['x-shopify-hmac-sha256'],raw,key);
  if(headers['x-shopify-shop-domain']!==route.shop_domain||headers['x-shopify-topic']!==route.topic||headers['x-shopify-api-version']!==route.api_version)throw new Error('WEBHOOK_ROUTE_MISMATCH');
  const delivery=headers['x-shopify-webhook-id'];if(!delivery||!(/^[A-Za-z0-9_-]{1,128}$/).test(delivery))throw new Error('WEBHOOK_HEADERS_INVALID');
  return {delivery_id:delivery,signature_contract:'shopify-raw-body-hmac-sha256',routing_verified:false,
    status:'quarantined',reason:'SHOP_OWNERSHIP_CONFIRMATION_REQUIRED'} as const;
}
export function verifyWooCommerceWebhook(route:WebhookRoute,h:Record<string,string>,raw:Buffer,key:Buffer){
  signature(h['x-wc-webhook-signature'],raw,key);
  const source=h['x-wc-webhook-source'];let parsed:URL;try{parsed=new URL(source);}catch{throw new Error('WEBHOOK_ROUTE_MISMATCH');}
  if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.port||parsed.pathname!=='/'||parsed.search||parsed.hash||parsed.hostname!==route.shop_domain||h['x-wc-webhook-topic']!==route.topic||h['x-wc-webhook-resource']!=='order'||h['x-wc-webhook-event']!==route.topic.split('.')[1])throw new Error('WEBHOOK_ROUTE_MISMATCH');
  const delivery=h['x-wc-webhook-delivery-id'],webhook=h['x-wc-webhook-id'];
  if(!delivery||! /^[A-Za-z0-9_-]{1,128}$/.test(delivery)||!webhook||! /^[1-9][0-9]{0,14}$/.test(webhook))throw new Error('WEBHOOK_HEADERS_INVALID');
  // Woo HMAC authenticates raw body only, not routing or delivery headers. An
  // attached account/source must independently corroborate a quarantined event.
  return {delivery_id:delivery,signature_contract:'woocommerce-raw-body-hmac-sha256',routing_verified:false,status:'quarantined',reason:'WOO_SOURCE_CORROBORATION_REQUIRED'} as const;
}
export function verifySyntheticWebhook(route:WebhookRoute,h:Record<string,string>,raw:Buffer,key:Buffer,now:number){
  const delivery=h['x-rifare-delivery'],at=h['x-rifare-timestamp'];
  if(!delivery||!(/^[A-Za-z0-9_-]{1,128}$/).test(delivery)||!at||!/^\d{10,13}$/.test(at)||!Number.isSafeInteger(Number(at)))throw new Error('WEBHOOK_HEADERS_INVALID');
  if(h['x-rifare-shop']!==route.shop_domain||h['x-rifare-topic']!==route.topic)throw new Error('WEBHOOK_ROUTE_MISMATCH');
  if(Math.abs(now-Number(at))>300000)throw new Error('WEBHOOK_EXPIRED');
  const prefix=Buffer.from(JSON.stringify([route.id,route.shop_domain,route.topic,delivery,at])+'\n');
  signature(h['x-rifare-signature'],Buffer.concat([prefix,raw]),key);
  return {delivery_id:delivery,signature_contract:'rifare-synthetic-route-body-hmac-v1',routing_verified:true,status:'pending',reason:'SYNTHETIC_ROUTE_AND_BODY_VERIFIED'} as const;
}
