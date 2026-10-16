import { CommerceKernel,exact,id,token,digest } from './kernel.mts';
import type { Scope,Row } from './kernel.mts';
import { canonical,jsonValue } from './configuration-values.mts';
import { uniqueHeaders,verifyShopifyWebhook,verifySyntheticWebhook } from '../adapters/webhooks/signatures.mts';

export const WEBHOOK_MAX_BYTES=131072;
export class WebhookInbox {
  #k:CommerceKernel;#keys:(keyRef:string)=>Buffer|undefined;
  constructor(kernel:CommerceKernel,keys:(keyRef:string)=>Buffer|undefined){this.#k=kernel;this.#keys=keys;}
  #key(ref:string,fingerprint?:string){
    let key:Buffer;try{const value=this.#keys(ref);if(!Buffer.isBuffer(value)||value.length<32||value.length>4096)throw new Error();key=Buffer.from(value);}catch{throw new Error('WEBHOOK_KEY_UNAVAILABLE');}
    if(fingerprint&&digest(key)!==fingerprint){key.fill(0);throw new Error('WEBHOOK_KEY_UNAVAILABLE');}return key;
  }
  register(scope:Scope,input:unknown){
    const k=this.#k,s=k.authorize(scope,'webhook.manage'),p=exact(jsonValue(input),['provider','topic','shop_domain','api_version','key_ref']);id(p.key_ref);
    if(!['synthetic','shopify'].includes(p.provider)||!(/^[a-z_]+\/[a-z_]+$/).test(p.topic)||p.topic.length>80||!(/^[a-z0-9-]+\.myshopify\.com$|^[a-z0-9-]+\.example\.invalid$/).test(p.shop_domain)||p.api_version!=='2026-10')throw new Error('INVALID_INPUT');
    if(p.provider==='shopify'&&!p.shop_domain.endsWith('.myshopify.com'))throw new Error('INVALID_INPUT');
    const key=this.#key(p.key_ref);try{
      const fingerprint=digest(key),existing=k.db.prepare('SELECT 1 FROM commerce_webhook_routes WHERE key_fingerprint=? AND (tenant_id<>? OR store_id<>?)').get(fingerprint,s.tenant_id,s.store_id);
      if(existing)throw new Error('WEBHOOK_KEY_SCOPE_CONFLICT');
      const ref='wh_'+token();k.db.prepare('INSERT INTO commerce_webhook_routes VALUES(?,?,?,?,?,?,?,?,?,1)').run(ref,s.tenant_id,s.store_id,p.provider,p.topic,p.shop_domain,p.api_version,p.key_ref,fingerprint);
      return {id:ref,provider:p.provider,topic:p.topic,shop_domain:p.shop_domain,api_version:p.api_version,live_qualified:false};
    }finally{key.fill(0);}
  }
  disable(scope:Scope,routeId:string){const s=this.#k.authorize(scope,'webhook.manage');id(routeId);
    const result=this.#k.db.prepare('UPDATE commerce_webhook_routes SET enabled=0 WHERE id=? AND tenant_id=? AND store_id=?').run(routeId,s.tenant_id,s.store_id);
    if(result.changes!==1)throw new Error('NOT_FOUND');return {disabled:true};}
  receive(routeId:string,rawHeaders:readonly string[],raw:Buffer){
    id(routeId);if(!Buffer.isBuffer(raw)||raw.length>WEBHOOK_MAX_BYTES)throw new Error('WEBHOOK_BODY_LIMIT');
    raw=Buffer.from(raw);
    const k=this.#k,h=uniqueHeaders(rawHeaders);
    if(h['content-type']!=='application/json'||h['content-encoding']&&h['content-encoding']!=='identity')throw new Error('WEBHOOK_CONTENT_TYPE');
    const r=k.db.prepare('SELECT r.* FROM commerce_webhook_routes r JOIN commerce_stores s USING(tenant_id,store_id) WHERE r.id=? AND r.enabled=1 AND s.active=1').get(routeId) as Row;
    if(!r)throw new Error('WEBHOOK_ROUTE_UNAVAILABLE');
    const key=this.#key(r.key_ref,r.key_fingerprint);let verified:ReturnType<typeof verifySyntheticWebhook>|ReturnType<typeof verifyShopifyWebhook>;
    try{verified=r.provider==='synthetic'?verifySyntheticWebhook(r as any,h,raw,key,k.clock()):verifyShopifyWebhook(r as any,h,raw,key);}finally{key.fill(0);}
    let decoded:unknown;try{decoded=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(raw));jsonValue(decoded,WEBHOOK_MAX_BYTES);}catch{throw new Error('WEBHOOK_PAYLOAD_INVALID');}
    if(!decoded||typeof decoded!=='object'||Array.isArray(decoded))throw new Error('WEBHOOK_PAYLOAD_INVALID');
    const hash=digest(raw);
    // Only this completed transaction authorizes the HTTP handler to acknowledge.
    try{return k.transaction(()=>{
      const active=k.db.prepare('SELECT r.* FROM commerce_webhook_routes r JOIN commerce_stores s USING(tenant_id,store_id) WHERE r.id=? AND r.enabled=1 AND s.active=1').get(routeId) as Row;
      if(!active||['tenant_id','store_id','provider','topic','shop_domain','api_version','key_ref','key_fingerprint'].some(field=>active[field]!==r[field]))throw new Error('WEBHOOK_ROUTE_UNAVAILABLE');
      const old=k.db.prepare('SELECT id,sha256,status FROM commerce_webhook_inbox WHERE route_id=? AND delivery_id=?').get(routeId,verified.delivery_id) as Row;
      if(old){if(old.sha256!==hash)throw new Error('WEBHOOK_DELIVERY_CONFLICT');return {acknowledged:true,id:old.id,duplicate:true,status:old.status,http_status:200};}
      const ref='evt_'+token().slice(0,32),metadata={provider:r.provider,topic:r.topic,shop_domain:r.shop_domain,api_version:r.api_version,
        signature_contract:verified.signature_contract,routing_verified:verified.routing_verified,reason:verified.reason,key_ref:r.key_ref,
        raw_byte_length:raw.length,sha256:hash,raw_headers_retained:false};
      k.db.prepare('INSERT INTO commerce_webhook_inbox VALUES(?,?,?,?,?,?,?,?,?,?)').run(r.tenant_id,r.store_id,ref,routeId,verified.delivery_id,raw,hash,canonical(metadata),verified.status,k.clock());
      return {acknowledged:true,id:ref,duplicate:false,status:verified.status,http_status:202};
    });}catch(error){if(error instanceof Error&&['WEBHOOK_ROUTE_UNAVAILABLE','WEBHOOK_DELIVERY_CONFLICT'].includes(error.message))throw error;throw new Error('WEBHOOK_PERSISTENCE_FAILED');}
  }
  read(scope:Scope,eventId:string){const s=this.#k.authorize(scope,'webhook.read');id(eventId);
    const r=this.#k.db.prepare('SELECT * FROM commerce_webhook_inbox WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,eventId) as Row;
    if(!r)throw new Error('NOT_FOUND');const raw=Buffer.from(r.body);
    if(digest(raw)!==r.sha256)throw new Error('WEBHOOK_INTEGRITY');
    return {id:r.id,route_id:r.route_id,delivery_id:r.delivery_id,status:r.status,metadata:JSON.parse(r.metadata),received_at:r.received_at,payload:JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(raw)),processing_authorized:false};}
}
