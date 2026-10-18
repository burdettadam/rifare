import {createHmac} from 'node:crypto';
import {WebhookInbox} from '../../packages/commerce/webhook-inbox.mts';
import {WooOrderEvents} from '../../packages/adapters/woocommerce/events.mts';

export function wooEventFixture(f:any){const key=Buffer.alloc(32,61),inbox=new WebhookInbox(f.kernel,ref=>ref==='woo_webhook_key'?key:undefined),route=inbox.register(f.owner.scope,{provider:'woocommerce',topic:'order.updated',shop_domain:'woo.example.invalid',api_version:'wc/v3',key_ref:'woo_webhook_key'}),events=new WooOrderEvents(f.kernel,inbox,f.woo);
 const headers=(raw:Buffer,delivery='woo_delivery_1')=>['Content-Type','application/json','X-WC-Webhook-Source','https://woo.example.invalid/','X-WC-Webhook-Topic','order.updated','X-WC-Webhook-Resource','order','X-WC-Webhook-Event','updated','X-WC-Webhook-ID','19','X-WC-Webhook-Delivery-ID',delivery,'X-WC-Webhook-Signature',createHmac('sha256',key).update(raw).digest('base64')];
 const receive=(delivery='woo_delivery_1',payload=f.source.snapshot('17').input.order)=>{const raw=Buffer.from(JSON.stringify(payload));return inbox.receive(route.id,headers(raw,delivery),raw);};
 return {key,inbox,route,events,headers,receive};}
