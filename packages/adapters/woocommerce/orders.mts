import { CommerceKernel,exact,id,integer,resourceKey } from '../../commerce/kernel.mts';
import type { Scope,Row } from '../../commerce/kernel.mts';
import type { SecretVault,CredentialReader } from '../../commerce/secrets.mts';
import { contentDigest } from '../../commerce/configuration-values.mts';
import { decimalMoney } from '../../commerce/money.mts';

export const WOO_READER='woocommerce-order-read';
export const WOO_CONTRACT='woocommerce-v3-read-v1';
function origin(v:unknown) {if(typeof v!=='string')throw new Error('INVALID_INPUT');const u=new URL(v);
  if(u.protocol!=='https:'||u.username||u.password||u.port||u.pathname!=='/'||u.search||u.hash||!/[a-z]/.test(u.hostname)||u.hostname==='localhost')throw new Error('INVALID_INPUT');return u.origin;}
function native(v:unknown) {if(typeof v!=='string'||!/^\d{1,15}$/.test(v)||Number(v)<1||!Number.isSafeInteger(Number(v)))throw new Error('INVALID_INPUT');return v;}
function text(v:unknown,max=300) {if(typeof v!=='string'||v.length>max||v.includes('\0'))throw new Error('INVALID_SOURCE');return v;}
function timestamp(v:unknown) {if(typeof v!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ?$/.test(v))throw new Error('INVALID_SOURCE');
  const t=Date.parse(v.endsWith('Z')?v:v+'Z');if(!Number.isSafeInteger(t)||new Date(t).toISOString().slice(0,19)!==v.slice(0,19))throw new Error('INVALID_SOURCE');return t;}
function amount(v:unknown,currency:string) {text(v,32);if(!/^\d+(?:\.\d+)?$/.test(v as string))throw new Error('INVALID_SOURCE');
  // The shared money module validates precision; the read contract preserves the source decimal.
  decimalMoney(currency,v as string);return {amount:v,currency};}
export function normalizeWooOrder(order:any,refunds:any,requested:string,now:number) {
  if(!order||order.id!==Number(native(requested)))throw new Error('INVALID_SOURCE');
  if(!['pending','processing','on-hold','completed','cancelled','refunded','failed','trash'].includes(order.status))throw new Error('INVALID_SOURCE');
  const updated=timestamp(order.date_modified_gmt);if(updated>now)throw new Error('INVALID_SOURCE');
  if(!Array.isArray(order.line_items)||order.line_items.length>100||!Array.isArray(order.refunds)||order.refunds.length>100||!Array.isArray(refunds)||refunds.length>100)throw new Error('INCOMPLETE_SOURCE');
  const currency=text(order.currency,3),total=amount(order.total,currency);text(order.version,40);integer(order.customer_id);
  const expected=order.refunds.map((r:Row)=>native(String(r.id))).sort(),received=refunds.map((r:Row)=>native(String(r.id))).sort();
  if(new Set(expected).size!==expected.length||new Set(received).size!==received.length||JSON.stringify(expected)!==JSON.stringify(received))throw new Error('INCOMPLETE_SOURCE');
  const lines=order.line_items.map((l:Row)=>({source_id:native(String(l.id)),title:text(l.name),quantity:integer(l.quantity,1)}));
  if(new Set(lines.map((l:Row)=>l.source_id)).size!==lines.length)throw new Error('INVALID_SOURCE');
  const records=refunds.map((r:Row)=>{const summary=order.refunds.find((v:Row)=>v.id===r.id);
    const summaryMinor=BigInt(decimalMoney(currency,summary.total,true).minor),detailMinor=BigInt(decimalMoney(currency,r.amount).minor);
    if(summaryMinor>0n||-summaryMinor!==detailMinor)throw new Error('INCONSISTENT_REFUND');
    if(Object.hasOwn(r,'refunded_payment')&&typeof r.refunded_payment!=='boolean')throw new Error('INVALID_SOURCE');
    return {source_id:native(String(r.id)),amount:amount(r.amount,currency),payment_state:r.refunded_payment===true?'gateway_reported_refund':r.refunded_payment===false?'manual_record_only':'unverified',settlement_verified:false};});
  const paid=order.date_paid_gmt===null?null:timestamp(order.date_paid_gmt);if(paid!==null&&paid>updated)throw new Error('INVALID_SOURCE');
  const payload={number:text(order.number),fulfillment_status:order.status,financial_status:paid!==null?'payment_date_recorded':'unverified',
    totals:{shop:total,presentment:null},lines,shipments:[],shipments_status:'tracking_extension_unqualified',refunds:records,
    delivery_verified:false,native_order_id:requested,api_version:'wc/v3',source_version:order.version};
  return {payload,source_updated_at:updated,customer_id:order.customer_id?'woo_customer_'+order.customer_id:'woo_guest_order_'+requested};
}
async function responseJSON(response:Response) {
  let bytes=0;const chunks:Uint8Array[]=[];const reader=response.body?.getReader();
  try{if(reader)while(true){const r=await reader.read();if(r.done)break;bytes+=r.value.length;if(bytes>262144)throw new Error('RESPONSE_TOO_LARGE');chunks.push(r.value);}}finally{await reader?.cancel();}
  let body:any=null;try{body=JSON.parse(Buffer.concat(chunks).toString());}catch{}
  return {status:response.status,body,pages:response.headers.get('x-wp-totalpages')};
}
export function wooCredentialReader(options:{fixtureFetch:(url:string,init:RequestInit)=>Promise<Response>}):CredentialReader {
  return {provider:'woocommerce',execute:async(key,input)=>{
    const p=exact(input,['origin','native_id','mode']);const host=origin(p.origin);native(p.native_id);if(p.mode!=='fixture'||typeof options.fixtureFetch!=='function')throw new Error('LIVE_READ_NOT_AUTHORIZED');
    const c=exact(JSON.parse(key.toString('utf8')),['consumer_key','consumer_secret']);
    for(const field of ['consumer_key','consumer_secret'])if(typeof c[field]!=='string'||!/^c[ks]_[A-Za-z0-9_-]{1,128}$/.test(c[field]))throw new Error('SECRET_UNAVAILABLE');
    const init={method:'GET',redirect:'error' as const,signal:AbortSignal.timeout(8000),headers:{Authorization:'Basic '+Buffer.from(c.consumer_key+':'+c.consumer_secret).toString('base64'),Accept:'application/json'}};
    const order=await responseJSON(await options.fixtureFetch(host+'/wp-json/wc/v3/orders/'+p.native_id,init));
    if(order.status!==200)return {order,refunds:null};
    const refunds=await responseJSON(await options.fixtureFetch(host+'/wp-json/wc/v3/orders/'+p.native_id+'/refunds?per_page=100&page=1',init));
    return {order,refunds};
  }};
}
export class WooOrders {
  #k:CommerceKernel;#v:SecretVault;constructor(kernel:CommerceKernel,vault:SecretVault){this.#k=kernel;this.#v=vault;}
  configure(scope:Scope,input:unknown) {const p=exact(input,['origin','secret_ref','granted_scopes','mode']);const host=origin(p.origin);id(p.secret_ref);
    if(p.mode!=='fixture'||!Array.isArray(p.granted_scopes)||p.granted_scopes.some((a:unknown)=>a!=='read')||p.granted_scopes.length>1)throw new Error('INVALID_INPUT');
    return this.#k.transaction(()=>{const s=this.#k.authorize(scope,'connection.manage');
      if(!this.#v.list(scope).some((r:any)=>r.ref===p.secret_ref&&r.provider==='woocommerce'&&r.adapter===WOO_READER))throw new Error('SECRET_UNAVAILABLE');
      const c=this.#k.db.prepare('SELECT * FROM commerce_woocommerce_connections WHERE tenant_id=? AND store_id=?').get(s.tenant_id,s.store_id) as Row;
      if(c&&c.origin!==host)throw new Error('STORE_REBIND_DENIED');
      this.#k.db.prepare(`INSERT INTO commerce_woocommerce_connections VALUES(?,?,?,?,?,'fixture',1) ON CONFLICT(tenant_id,store_id) DO UPDATE SET secret_ref=excluded.secret_ref,granted_scopes=excluded.granted_scopes,revision=commerce_woocommerce_connections.revision+1`).run(s.tenant_id,s.store_id,host,p.secret_ref,JSON.stringify(p.granted_scopes));return {configured:true,mode:'fixture'};});
  }
  #connection(scope:Scope){const s=this.#k.require(scope,['operator','worker']),c=this.#k.db.prepare('SELECT * FROM commerce_woocommerce_connections WHERE tenant_id=? AND store_id=?').get(s.tenant_id,s.store_id) as Row;
    if(!c)throw new Error('ADAPTER_UNAVAILABLE');return c;}
  async refresh(scope:Scope,nativeId:string) {native(nativeId);const k=this.#k,s=k.require(scope),c=this.#connection(scope),resource=resourceKey(s.tenant_id,s.store_id,'order','woocommerce',nativeId);
    k.authorize(scope,'resource.ingest',resource);const before=k.db.prepare('SELECT * FROM commerce_woocommerce_observations WHERE tenant_id=? AND store_id=? AND resource_id=?').get(s.tenant_id,s.store_id,resource) as Row;
    let state='unavailable',normalized:ReturnType<typeof normalizeWooOrder>|undefined;
    if(!JSON.parse(c.granted_scopes).includes('read'))state='access_denied';else try{
      const r:any=await this.#v.invokeReader(scope,c.secret_ref,WOO_READER,{origin:c.origin,native_id:nativeId,mode:c.mode});
      if([401,403].includes(r.order.status))state='access_denied';else if(r.order.status===429||r.refunds?.status===429)state='throttled';
      else if(r.order.status===404)state='not_found_or_inaccessible';
      else if(r.order.status===200&&r.refunds?.status===200){
        if(!['0','1'].includes(r.refunds.pages))state='incomplete_source';else{normalized=normalizeWooOrder(r.order.body,r.refunds.body,nativeId,k.clock());state='fresh';}}
    }catch(e){state=e instanceof Error&&e.message==='INCOMPLETE_SOURCE'?'incomplete_source':'unavailable';}
    return k.transaction(()=>{k.authorize(scope,'resource.ingest',resource);if(this.#connection(scope).revision!==c.revision)throw new Error('CONNECTION_CHANGED');
      const current=k.db.prepare('SELECT * FROM commerce_woocommerce_observations WHERE tenant_id=? AND store_id=? AND resource_id=?').get(s.tenant_id,s.store_id,resource) as Row;
      if((before?.revision??0)!==(current?.revision??0))throw new Error('SOURCE_VERSION_CONFLICT');
      if(normalized&&before?.source_updated_at>normalized.source_updated_at){normalized=undefined;state='source_regressed';}
      const revision=(before?.revision??0)+1;
      if(normalized){const old=k.db.prepare('SELECT source_version FROM commerce_resources WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,resource) as Row;
        k.ingest(scope,{kind:'order',source_system:'woocommerce',external_id:nativeId,source_version:(old?.source_version??0)+1,source_updated_at:normalized.source_updated_at,customer_id:normalized.customer_id,payload:normalized.payload});}
      k.db.prepare(`INSERT INTO commerce_woocommerce_observations VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,store_id,resource_id) DO UPDATE SET connection_revision=excluded.connection_revision,revision=excluded.revision,state=excluded.state,observed_at=excluded.observed_at,source_updated_at=excluded.source_updated_at,payload=excluded.payload,digest=excluded.digest`)
        .run(s.tenant_id,s.store_id,resource,nativeId,c.revision,revision,state,k.clock(),normalized?.source_updated_at??null,normalized?JSON.stringify(normalized.payload):null,normalized?contentDigest(normalized.payload):null);
      return this.cached(scope,resource);});
  }
  cached(scope:Scope,resource:string,maxAge=300000) {integer(maxAge,1);if(maxAge>300000)throw new Error('INVALID_INPUT');const k=this.#k,s=k.require(scope),c=this.#connection(scope);
    k.authorize(scope,'resource.read',id(resource));const r=k.db.prepare('SELECT * FROM commerce_woocommerce_observations WHERE tenant_id=? AND store_id=? AND resource_id=?').get(s.tenant_id,s.store_id,resource) as Row;
    if(!r)throw new Error('NOT_FOUND');const key=k.db.prepare('SELECT 1 FROM commerce_secrets WHERE tenant_id=? AND store_id=? AND ref=? AND revoked=0').get(s.tenant_id,s.store_id,c.secret_ref);
    let status=!key||!JSON.parse(c.granted_scopes).includes('read')?'access_denied':r.connection_revision!==c.revision?'connection_changed':r.state;
    if(status==='fresh'&&(r.observed_at>k.clock()||r.observed_at+maxAge<=k.clock()))status='stale';
    let facts=null;if(status==='fresh'){const row=k.get(scope,resource);if(contentDigest(row.payload)!==r.digest||contentDigest(JSON.parse(r.payload))!==r.digest)status='inconsistent_snapshot';else facts=row.payload;}
    return {resource_id:resource,status,order:facts,production_qualified:false,source:{system:'woocommerce',native_id:r.native_id,api_version:'wc/v3',revision:r.revision,sha256:r.digest,observed_at:r.observed_at,source_updated_at:r.source_updated_at,evidence_kind:'synthetic_wire_fixture'}};
  }
  gaps(){return {contract:WOO_CONTRACT,order_read:'fixture_qualified',shipment_tracking:'extension_not_qualified',manual_refund_record:'not_settlement',writes:false,live_test_store:'not_run'};}
}
