import {id,exact,resourceKey} from '../../commerce/kernel.mts';
import type {CommerceKernel,Scope,Row} from '../../commerce/kernel.mts';
import {canonical,contentDigest,jsonValue} from '../../commerce/configuration-values.mts';
import {WebhookInbox} from '../../commerce/webhook-inbox.mts';
import {WooReturnSources} from './return-source.mts';

export function normalizeWooOrderEvent(event:unknown){const e=exact(jsonValue(event,262144),['topic','payload']);
 if(!['order.created','order.updated'].includes(e.topic)||!Number.isSafeInteger(e.payload?.id)||e.payload.id<1||e.payload.id>999999999999999)throw new Error('WOO_EVENT_UNSUPPORTED');
 return {native_order_id:String(e.payload.id),topic:e.topic,wire_digest:contentDigest(e.payload),financial_authority:false,payload:e.payload};}
export class WooOrderEvents {
 readonly k:CommerceKernel;readonly inbox:WebhookInbox;readonly woo:WooReturnSources;
 constructor(k:CommerceKernel,inbox:WebhookInbox,woo:WooReturnSources){if(woo.k!==k)throw new Error('WOO_EVENT_SOURCE_MISMATCH');this.k=k;this.inbox=inbox;this.woo=woo;}
 process(scope:Scope,eventId:string){const k=this.k,s=k.require(scope);id(eventId);const e=this.inbox.read(scope,eventId),source=this.woo.source;
  if(s.tenant_id!==source.tenant||s.store_id!==source.store||e.metadata.provider!=='woocommerce'||e.metadata.api_version!=='wc/v3'||e.metadata.shop_domain!==new URL(source.origin).hostname||e.metadata.signature_contract!=='woocommerce-raw-body-hmac-sha256')throw new Error('WOO_EVENT_SOURCE_MISMATCH');
  const normalized=normalizeWooOrderEvent({topic:e.metadata.topic,payload:e.payload}),resource=resourceKey(s.tenant_id,s.store_id,'order','woocommerce',normalized.native_order_id);k.authorize(scope,'resource.ingest',resource);
  const native=source.snapshot(normalized.native_order_id);
  if(contentDigest(native.input.order)!==normalized.wire_digest)throw new Error('WOO_EVENT_SOURCE_CONFLICT');
  return k.transaction(()=>{const old=k.db.prepare('SELECT * FROM commerce_woo_event_observations WHERE tenant_id=? AND store_id=? AND event_id=?').get(s.tenant_id,s.store_id,eventId) as Row;
   if(old){const body=JSON.parse(old.body);if(contentDigest(body)!==old.digest||body.wire_digest!==normalized.wire_digest)throw new Error('WOO_EVENT_INTEGRITY');return {...body,duplicate:true};}
   const current=k.db.prepare('SELECT source_revision,source_digest FROM commerce_woo_return_sources WHERE tenant_id=? AND store_id=? AND resource_id=?').get(s.tenant_id,s.store_id,resource) as Row;
   if(current&&current.source_revision>native.revision)throw new Error('WOO_EVENT_SOURCE_CONFLICT');
   if(!current||current.source_revision!==native.revision||current.source_digest!==native.digest)this.woo.refresh(scope,normalized.native_order_id);
   const binding=this.woo.binding(scope,resource),body={event_id:eventId,resource_id:resource,source_identity:source.identity,account_id:source.account_id,source_revision:native.revision,source_digest:native.digest,wire_digest:normalized.wire_digest,
    native_order_id:normalized.native_order_id,topic:normalized.topic,canonical_source_version:binding.canonical_source_version,corroboration:'independent_fixture_source_snapshot',financial_authority:false,new_write_authorized:false,qualification:'fixture_only'};
   k.db.prepare('INSERT INTO commerce_woo_event_observations VALUES(?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,eventId,resource,canonical(body),contentDigest(body),k.clock());
   return {...body,duplicate:false};});}
}
