import { CommerceKernel, boundedJSON, digest, exact, id, integer, resourceKey } from '../../commerce/kernel.mts';
import type { Scope, Row } from '../../commerce/kernel.mts';
import type { SecretVault, CredentialReader } from '../../commerce/secrets.mts';

export const SHOPIFY_API_VERSION = '2026-10';
export const SHOPIFY_READER = 'shopify-order-read';
export const ORDER_QUERY = `query RifareOrderStatus($id: ID!) {
  order(id:$id) {
    id name updatedAt displayFinancialStatus displayFulfillmentStatus
    currentTotalPriceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
    lineItems(first:50) { nodes { id title quantity } pageInfo { hasNextPage } }
    fulfillmentsCount { count precision }
    fulfillments(first:10) {
      id status displayStatus updatedAt deliveredAt estimatedDeliveryAt
      trackingInfo { company number url }
      fulfillmentLineItems(first:50) { nodes { quantity lineItem { id } } pageInfo { hasNextPage } }
    }
  }
}`;
function domain(value:unknown):string {
  if(typeof value!=='string'||value.length>253||!/^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\.myshopify\.com$/.test(value))throw new Error('INVALID_INPUT');
  return value;
}
function orderNumber(value:unknown):string {if(typeof value!=='string'||!/^\d{1,30}$/.test(value))throw new Error('INVALID_INPUT');return value;}
function native(value:unknown,kind:string):string {
  if(typeof value!=='string'||!new RegExp('^gid://shopify/'+kind+'/[0-9]{1,30}$').test(value))throw new Error('INVALID_SOURCE');return value;
}
function string(value:unknown,max=300):string {if(typeof value!=='string'||value.length>max)throw new Error('INVALID_SOURCE');return value;}
function timestamp(value:unknown):number {
  if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)||!Number.isSafeInteger(Date.parse(value)))throw new Error('INVALID_SOURCE');return Date.parse(value);
}
function money(value:any) {
  if(!value||typeof value.amount!=='string'||!/^\d{1,20}(?:\.\d{1,6})?$/.test(value.amount)||!/^([A-Z]{3})$/.test(value.currencyCode))throw new Error('INVALID_SOURCE');
  // Preserve decimal strings exactly; do not round or assume every currency has two decimals.
  return {amount:value.amount,currency:value.currencyCode};
}
function safeTracking(value:unknown):string|null {
  if(value===null)return null;const raw=string(value,2000);const u=new URL(raw);
  if(u.protocol!=='https:'||u.username||u.password)throw new Error('INVALID_SOURCE');return raw;
}
export function normalizeOrder(order:any,requested:string,now:number) {
  if(!order||order.id!=='gid://shopify/Order/'+requested)throw new Error('INVALID_SOURCE');
  native(order.id,'Order');const updated=timestamp(order.updatedAt);if(updated>now)throw new Error('INVALID_SOURCE');
  if(!Array.isArray(order.lineItems?.nodes)||order.lineItems.nodes.length>50||order.lineItems.pageInfo?.hasNextPage!==false
    ||!Array.isArray(order.fulfillments)||order.fulfillments.length>10||order.fulfillmentsCount?.precision!=='EXACT'
    ||order.fulfillmentsCount.count!==order.fulfillments.length)throw new Error('INCOMPLETE_SOURCE');
  const lines=order.lineItems.nodes.map((l:any)=>({source_id:native(l.id,'LineItem'),title:string(l.title),quantity:integer(l.quantity)}));
  if(new Set(lines.map((l:any)=>l.source_id)).size!==lines.length)throw new Error('INVALID_SOURCE');
  const shipments=order.fulfillments.map((f:any)=>{
    if(!Array.isArray(f.fulfillmentLineItems?.nodes)||f.fulfillmentLineItems.nodes.length>50||f.fulfillmentLineItems.pageInfo?.hasNextPage!==false
      ||!Array.isArray(f.trackingInfo)||f.trackingInfo.length>50)throw new Error('INCOMPLETE_SOURCE');
    const sourceUpdated=timestamp(f.updatedAt);if(sourceUpdated>now)throw new Error('INVALID_SOURCE');
    const items=f.fulfillmentLineItems.nodes.map((l:any)=>{
      const sourceId=native(l.lineItem?.id,'LineItem'),quantity=integer(l.quantity);
      if(!lines.some((line:any)=>line.source_id===sourceId&&quantity<=line.quantity))throw new Error('INVALID_SOURCE');
      return {line_source_id:sourceId,quantity};
    });
    const delivered=f.deliveredAt===null?null:timestamp(f.deliveredAt);
    if(delivered!==null&&delivered>now)throw new Error('INVALID_SOURCE');
    return {source_id:native(f.id,'Fulfillment'),fulfillment_state:string(f.status),delivery_state:f.displayStatus===null?'unknown':string(f.displayStatus),
      source_updated_at:sourceUpdated,delivered_at:delivered,estimated_delivery_at:f.estimatedDeliveryAt===null?null:timestamp(f.estimatedDeliveryAt),
      items,tracking:f.trackingInfo.map((t:any)=>({carrier:t.company===null?null:string(t.company),number:t.number===null?null:string(t.number),url:safeTracking(t.url)}))};
  });
  if(new Set(shipments.map((s:any)=>s.source_id)).size!==shipments.length)throw new Error('INVALID_SOURCE');
  const payload={number:string(order.name),financial_status:order.displayFinancialStatus===null?'unknown':string(order.displayFinancialStatus),
    fulfillment_status:string(order.displayFulfillmentStatus),totals:{shop:money(order.currentTotalPriceSet?.shopMoney),presentment:money(order.currentTotalPriceSet?.presentmentMoney)},
    lines,shipments,native_order_id:order.id,api_version:SHOPIFY_API_VERSION};
  boundedJSON(payload);
  return {payload,source_updated_at:Math.max(updated,...shipments.map((s:any)=>s.source_updated_at))};
}

export function shopifyCredentialReader(options:{allowLiveTest?:boolean;fixtureFetch?:(url:string,init:RequestInit)=>Promise<Response>}={}):CredentialReader {
  return {provider:'shopify',execute:async(credential,input)=>{
    const r=exact(input,['domain','native_id','mode']);domain(r.domain);orderNumber(r.native_id);
    if(r.mode==='live_test'&&!options.allowLiveTest)throw new Error('LIVE_READ_NOT_AUTHORIZED');
    if(r.mode!=='live_test'&&r.mode!=='fixture')throw new Error('INVALID_INPUT');
    if(r.mode==='fixture'&&!options.fixtureFetch)throw new Error('FIXTURE_TRANSPORT_MISSING');
    const transport=r.mode==='fixture'?options.fixtureFetch!:fetch;
    const response=await transport(`https://${r.domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),
      headers:{'Content-Type':'application/json','X-Shopify-Access-Token':credential.toString('utf8')},
      body:JSON.stringify({query:ORDER_QUERY,variables:{id:'gid://shopify/Order/'+r.native_id}})});
    const reader=response.body?.getReader();const chunks:Uint8Array[]=[];let size=0;
    if(reader)try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;
      if(size>256*1024)throw new Error('RESPONSE_TOO_LARGE');chunks.push(value);}}finally{await reader.cancel();}
    const text=Buffer.concat(chunks).toString('utf8');let json:any=null;
    try{json=JSON.parse(text);}catch{/* structured status below */}
    return {http_status:response.status,api_version:response.headers.get('x-shopify-api-version'),body:json};
  }};
}
export class ShopifyOrders {
  #kernel:CommerceKernel;#vault:SecretVault;
  constructor(kernel:CommerceKernel,vault:SecretVault){this.#kernel=kernel;this.#vault=vault;}
  configure(scope:Scope,input:unknown) {
    const s=this.#kernel.require(scope,['operator']),r=exact(input,['domain','secret_ref','granted_scopes','mode']);domain(r.domain);id(r.secret_ref);
    if(!['fixture','live_test'].includes(r.mode)||!Array.isArray(r.granted_scopes)||r.granted_scopes.length>5
      ||new Set(r.granted_scopes).size!==r.granted_scopes.length||r.granted_scopes.some((x:unknown)=>!['read_orders','read_all_orders'].includes(x as string)))throw new Error('INVALID_INPUT');
    const secret=this.#vault.list(scope).find((x:any)=>x.ref===r.secret_ref&&x.adapter===SHOPIFY_READER&&x.provider==='shopify');
    if(!secret)throw new Error('SECRET_UNAVAILABLE');
    const old=this.#kernel.db.prepare('SELECT domain FROM commerce_shopify_connections WHERE tenant_id=? AND store_id=?').get(s.tenant_id,s.store_id) as Row;
    if(old&&old.domain!==r.domain)throw new Error('STORE_REBIND_DENIED');
    this.#kernel.db.prepare(`INSERT INTO commerce_shopify_connections VALUES(?,?,?,?,?,?,1) ON CONFLICT(tenant_id,store_id)
      DO UPDATE SET secret_ref=excluded.secret_ref,granted_scopes=excluded.granted_scopes,mode=excluded.mode,revision=commerce_shopify_connections.revision+1`)
      .run(s.tenant_id,s.store_id,r.domain,r.secret_ref,JSON.stringify(r.granted_scopes),r.mode);
  }
  #connection(scope:Scope) {
    const s=this.#kernel.require(scope,['operator','worker']);
    const r=this.#kernel.db.prepare('SELECT * FROM commerce_shopify_connections WHERE tenant_id=? AND store_id=?').get(s.tenant_id,s.store_id) as Row;
    if(!r)throw new Error('ADAPTER_UNAVAILABLE');return r;
  }
  async refresh(scope:Scope,nativeId:string) {
    orderNumber(nativeId);const k=this.#kernel,s=k.require(scope,['operator','worker']),c=this.#connection(scope);
    const resource=resourceKey(s.tenant_id,s.store_id,'order','shopify',nativeId),start=k.clock();
    const startedRevision=(k.db.prepare('SELECT observation_revision FROM commerce_order_observations WHERE tenant_id=? AND store_id=? AND resource_id=?').get(s.tenant_id,s.store_id,resource) as Row)?.observation_revision??0;
    let state='unavailable',normalized:ReturnType<typeof normalizeOrder>|undefined,hash:string|null=null,retry:number|null=null;
    if(!JSON.parse(c.granted_scopes).includes('read_orders'))state='access_denied';
    else try {
      const r:any=await this.#vault.invokeReader(scope,c.secret_ref,SHOPIFY_READER,{domain:c.domain,native_id:nativeId,mode:c.mode});
      if(r.api_version!==SHOPIFY_API_VERSION)state='api_version_mismatch';
      else if(r.http_status===401||r.http_status===403)state='access_denied';
      else if(r.http_status===429||r.body?.errors?.some((e:any)=>e.extensions?.code==='THROTTLED')){state='throttled';retry=5;}
      else if(r.body?.errors?.some((e:any)=>e.extensions?.code==='ACCESS_DENIED'))state='access_denied';
      else if(r.http_status!==200||r.body?.errors?.length)state='unavailable';
      else if(r.body?.data?.order===null)state='not_found_or_inaccessible';
      else {
        normalized=normalizeOrder(r.body?.data?.order,nativeId,k.clock());hash=digest(JSON.stringify(normalized));state='fresh';
      }
    } catch(error) {state=error instanceof Error&&error.message==='INCOMPLETE_SOURCE'?'incomplete_source':
      error instanceof Error&&error.message==='INVALID_SOURCE'?'invalid_source':'unavailable';}
    k.require(scope,['operator','worker']);
    const current=this.#connection(scope);if(current.revision!==c.revision)throw new Error('CONNECTION_CHANGED');
    const previous=k.db.prepare('SELECT * FROM commerce_order_observations WHERE tenant_id=? AND store_id=? AND resource_id=?')
      .get(s.tenant_id,s.store_id,resource) as Row;
    if((previous?.observation_revision??0)!==startedRevision || (previous&&previous.attempted_at>start))throw new Error('SOURCE_VERSION_CONFLICT');
    if(state==='fresh'&&previous?.source_updated_at>normalized!.source_updated_at){state='source_regressed';normalized=undefined;}
    if(state==='fresh') {
      const previousResource=k.db.prepare('SELECT source_version,payload FROM commerce_resources WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,resource) as Row;
      const oldVersion=previousResource?.source_version??0;
      const unchanged=previous?.response_digest===hash&&previousResource?.payload===JSON.stringify(normalized!.payload);
      k.ingest(scope,{kind:'order',source_system:'shopify',external_id:nativeId,source_version:unchanged?oldVersion:oldVersion+1,
        source_updated_at:normalized!.source_updated_at,customer_id:null,payload:normalized!.payload});
    }
    k.db.prepare(`INSERT INTO commerce_order_observations VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,store_id,resource_id)
      DO UPDATE SET connection_revision=excluded.connection_revision,state=excluded.state,attempted_at=excluded.attempted_at,
      successful_at=excluded.successful_at,response_digest=excluded.response_digest,source_updated_at=excluded.source_updated_at,
      observation_revision=excluded.observation_revision,retry_after_seconds=excluded.retry_after_seconds`)
      .run(s.tenant_id,s.store_id,resource,nativeId,c.revision,state,start,state==='fresh'?k.clock():previous?.successful_at??null,
        state==='fresh'?hash:previous?.response_digest??null,state==='fresh'?normalized!.source_updated_at:previous?.source_updated_at??null,
        (previous?.observation_revision??0)+1,retry);
    return this.cached(scope,resource);
  }
  cached(scope:Scope,resourceId:string,maxAge=300000) {
    integer(maxAge,1);if(maxAge>300000)throw new Error('INVALID_INPUT');id(resourceId);
    const k=this.#kernel,s=k.require(scope,['operator','worker']),c=this.#connection(scope);
    const r=k.db.prepare('SELECT * FROM commerce_order_observations WHERE tenant_id=? AND store_id=? AND resource_id=?').get(s.tenant_id,s.store_id,resourceId) as Row;
    if(!r)throw new Error('NOT_FOUND');
    const secret=k.db.prepare('SELECT 1 FROM commerce_secrets WHERE tenant_id=? AND store_id=? AND ref=? AND revoked=0').get(s.tenant_id,s.store_id,c.secret_ref);
    let status=!JSON.parse(c.granted_scopes).includes('read_orders')||!secret?'access_denied':
      r.connection_revision!==c.revision?'connection_changed':r.state;
    if(status==='fresh'&&(r.successful_at===null||r.successful_at+maxAge<=k.clock()))status='stale';
    let facts:Row|null=null;
    if(status==='fresh') {
      const record=k.get(scope,resourceId);
      if(digest(JSON.stringify({payload:record.payload,source_updated_at:record.source_updated_at}))!==r.response_digest)status='inconsistent_snapshot';
      else facts=record.payload;
    }
    return {resource_id:resourceId,status,order:facts,
      source:{system:'shopify',native_id:'gid://shopify/Order/'+r.native_id,api_version:SHOPIFY_API_VERSION,
        revision:r.observation_revision,sha256:r.response_digest,observed_at:r.successful_at,attempted_at:r.attempted_at,
        source_updated_at:r.source_updated_at,evidence_kind:c.mode==='fixture'?'synthetic_wire_fixture':'native_read_unqualified'},
      retry_after_seconds:r.retry_after_seconds,production_qualified:false};
  }
}
