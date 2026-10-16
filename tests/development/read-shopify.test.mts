import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { commerceFixture } from './commerce-helpers.mts';
import { SecretVault } from '../../packages/commerce/secrets.mts';
import { ShopifyOrders, shopifyCredentialReader, SHOPIFY_READER, SHOPIFY_API_VERSION, ORDER_QUERY } from '../../packages/adapters/shopify/orders.mts';

function setup() {
  const f=commerceFixture();const key=randomBytes(32);let payload=JSON.parse(readFileSync(new URL('../fixtures/read-workflows/shopify-order.json',import.meta.url),'utf8'));
  let status=200,version=SHOPIFY_API_VERSION,hook:undefined|(()=>Promise<void>);const calls:any[]=[];
  const reader=shopifyCredentialReader({fixtureFetch:async(url,init)=>{calls.push({url,init});const snapshot=structuredClone(payload);if(hook)await hook();
    return new Response(JSON.stringify(snapshot),{status,headers:{'x-shopify-api-version':version}});}});
  const vault=new SecretVault(f.kernel,{activeId:'key-1',get:()=>key},{},{[SHOPIFY_READER]:reader});
  const ref=vault.put(f.a.scope,{provider:'shopify',adapter:SHOPIFY_READER,value:'synthetic-shopify-read-token'}).ref;
  const shop=new ShopifyOrders(f.kernel,vault);
  const config=(extras={})=>({domain:'rifare-fixture.myshopify.com',secret_ref:ref,granted_scopes:['read_orders'],mode:'fixture',...extras});
  shop.configure(f.a.scope,config());
  return {...f,shop,vault,ref,calls,config,get:()=>payload,set:(p:any)=>{payload=p;},status:(n:number)=>{status=n;},version:(v:string)=>{version=v;},hook:(fn:any)=>{hook=fn;}};
}
async function use(fn:(f:ReturnType<typeof setup>)=>unknown){const f=setup();try{return await fn(f);}finally{f.cleanup();}}

test('CASE-M01-G06-01',()=>use(async f=>{
  const r=await f.shop.refresh(f.a.scope,'1001');
  assert.equal(r.status,'fresh');assert.equal(r.order.totals.shop.amount,'125.00');assert.equal(r.order.totals.presentment.currency,'CAD');
  assert.equal(r.order.lines.length,2);assert.deepEqual(r.order.shipments.map((x:any)=>x.delivery_state),['DELIVERED','IN_TRANSIT']);
  assert.equal(r.order.shipments[1].delivered_at,null);assert.equal(r.order.fulfillment_status,'PARTIALLY_FULFILLED');
  assert.equal(r.source.native_id,'gid://shopify/Order/1001');assert.equal(r.source.evidence_kind,'synthetic_wire_fixture');
  assert.equal(r.production_qualified,false);
}));
test('CASE-M01-G06-02',()=>use(async f=>{
  const first=await f.shop.refresh(f.a.scope,'1001');f.set({errors:[{message:'redacted',extensions:{code:'THROTTLED'}}]});
  const throttled=await f.shop.refresh(f.a.scope,'1001');assert.equal(throttled.status,'throttled');assert.equal(throttled.order,null);
  f.set({errors:[{message:'private',extensions:{code:'ACCESS_DENIED'}}]});assert.equal((await f.shop.refresh(f.a.scope,'1001')).status,'access_denied');
  f.set({data:{order:null}});const missing=await f.shop.refresh(f.a.scope,'1001');assert.equal(missing.status,'not_found_or_inaccessible');assert.equal(missing.order,null);
  assert.equal(f.shop.cached(f.a.scope,first.resource_id).order,null);
}));
test('CASE-M01-G06-03',()=>use(async f=>{
  const first=await f.shop.refresh(f.a.scope,'1001');f.advance(1000);
  const next=structuredClone(f.get());next.data.order.fulfillments[0].displayStatus='IN_TRANSIT';next.data.order.fulfillments[0].deliveredAt=null;
  next.data.order.fulfillments[0].updatedAt='2026-01-15T11:30:00Z';f.set(next);
  const second=await f.shop.refresh(f.a.scope,'1001');assert.equal(first.resource_id,second.resource_id);
  assert.equal(second.order.shipments[0].delivery_state,'IN_TRANSIT');assert.equal(second.order.shipments[0].delivered_at,null);
  assert.equal(second.source.revision,2);assert.notEqual(first.source.sha256,second.source.sha256);
}));
test('M01-G06-PINNED-READ-ONLY',()=>use(async f=>{
  await f.shop.refresh(f.a.scope,'1001');const request=f.calls[0];
  assert.equal(request.url,'https://rifare-fixture.myshopify.com/admin/api/2026-10/graphql.json');
  assert.equal(request.init.redirect,'error');assert.equal(request.init.method,'POST');
  assert.equal(request.init.headers['X-Shopify-Access-Token'],'synthetic-shopify-read-token');
  const sent=JSON.parse(request.init.body);assert.equal(sent.query,ORDER_QUERY);assert.equal(/mutation\b/.test(sent.query),false);
  assert.deepEqual(sent.variables,{id:'gid://shopify/Order/1001'});
}));
test('M01-G06-SCOPE-MISSING-NO-EGRESS',()=>use(async f=>{
  f.shop.configure(f.a.scope,f.config({granted_scopes:[]}));assert.equal((await f.shop.refresh(f.a.scope,'1001')).status,'access_denied');assert.equal(f.calls.length,0);
}));
test('M01-G06-UNSAFE-ENDPOINT',()=>use(f=>{
  for(const domain of ['localhost','127.0.0.1','good.myshopify.com.evil.invalid','https://good.myshopify.com','good.myshopify.com:443','good.myshopify.com/path','x@myshopify.com'])
    assert.throws(()=>f.shop.configure(f.a.scope,f.config({domain})),/INVALID_INPUT/);
}));
test('M01-G06-STORE-REBIND',()=>use(f=>{assert.throws(()=>f.shop.configure(f.a.scope,f.config({domain:'different.myshopify.com'})),/STORE_REBIND_DENIED/);}));
test('M01-G06-WRONG-STORE-SECRET',()=>use(f=>{assert.throws(()=>f.shop.configure(f.b.scope,f.config()),/SECRET_UNAVAILABLE/);}));
test('M01-G06-WRITE-SCOPES',()=>use(f=>{assert.throws(()=>f.shop.configure(f.a.scope,f.config({granted_scopes:['read_orders','write_orders']})),/INVALID_INPUT/);}));
test('M01-G06-API-VERSION-MISMATCH',()=>use(async f=>{f.version('2027-01');const r=await f.shop.refresh(f.a.scope,'1001');assert.equal(r.status,'api_version_mismatch');assert.equal(r.order,null);}));
test('M01-G06-STALE-NO-FACTS',()=>use(async f=>{
  const r=await f.shop.refresh(f.a.scope,'1001');f.advance(300000);const stale=f.shop.cached(f.a.scope,r.resource_id);assert.equal(stale.status,'stale');assert.equal(stale.order,null);
}));
test('M01-G06-TRUNCATED-ORDER',()=>use(async f=>{
  f.get().data.order.lineItems.pageInfo.hasNextPage=true;const r=await f.shop.refresh(f.a.scope,'1001');assert.equal(r.status,'incomplete_source');assert.equal(r.order,null);
}));
test('M01-G06-TRUNCATED-SHIPMENTS',()=>use(async f=>{
  f.get().data.order.fulfillmentsCount.count=3;assert.equal((await f.shop.refresh(f.a.scope,'1001')).status,'incomplete_source');
}));
test('M01-G06-TRUNCATED-SHIPMENT-LINES',()=>use(async f=>{
  f.get().data.order.fulfillments[0].fulfillmentLineItems.pageInfo.hasNextPage=true;assert.equal((await f.shop.refresh(f.a.scope,'1001')).status,'incomplete_source');
}));
test('M01-G06-CURRENCY-DECIMALS',()=>use(async f=>{
  f.get().data.order.currentTotalPriceSet.shopMoney={amount:'0.000125',currencyCode:'KWD'};
  assert.equal((await f.shop.refresh(f.a.scope,'1001')).order.totals.shop.amount,'0.000125');
}));
test('M01-G06-INVALID-SOURCE-ID',()=>use(async f=>{
  f.get().data.order.id='gid://shopify/Order/9999';const r=await f.shop.refresh(f.a.scope,'1001');assert.equal(r.status,'invalid_source');assert.equal(r.order,null);
}));
test('M01-G06-UNSAFE-TRACKING',()=>use(async f=>{
  f.get().data.order.fulfillments[0].trackingInfo[0].url='javascript:alert(1)';assert.equal((await f.shop.refresh(f.a.scope,'1001')).status,'invalid_source');
}));
test('M01-G06-REVOKED-SECRET-CACHED',()=>use(async f=>{
  const r=await f.shop.refresh(f.a.scope,'1001');f.vault.revoke(f.a.scope,f.ref);assert.equal(f.shop.cached(f.a.scope,r.resource_id).status,'access_denied');
}));
test('M01-G06-REVOKED-DURING-READ',()=>use(async f=>{
  f.hook(async()=>{f.vault.revoke(f.a.scope,f.ref);});const r=await f.shop.refresh(f.a.scope,'1001');assert.equal(r.order,null);
}));
test('M01-G06-CONNECTION-CHANGED',()=>use(async f=>{
  f.hook(async()=>{f.shop.configure(f.a.scope,f.config({granted_scopes:[]}));});await assert.rejects(f.shop.refresh(f.a.scope,'1001'),/CONNECTION_CHANGED/);
}));
test('M01-G06-DEFAULT-LIVE-DENIED',async()=>{
  const reader=shopifyCredentialReader();await assert.rejects(reader.execute(Buffer.from('fixture'),{domain:'test.myshopify.com',native_id:'1',mode:'live_test'}),/LIVE_READ_NOT_AUTHORIZED/);
});
test('M01-G06-READER-IDENTITY',()=>use(async f=>{
  await assert.rejects(f.vault.invokeReader(f.b.scope,f.ref,SHOPIFY_READER,{}),/SECRET_UNAVAILABLE/);
  await assert.rejects(f.vault.invokeReader(f.a.scope,f.ref,'unregistered',{}),/SECRET_UNAVAILABLE/);
}));
test('M01-G06-UNCHANGED-REFRESH',()=>use(async f=>{
  const first=await f.shop.refresh(f.a.scope,'1001');f.advance(1000);const second=await f.shop.refresh(f.a.scope,'1001');
  assert.equal(first.resource_id,second.resource_id);assert.equal(first.source.sha256,second.source.sha256);assert.equal(second.source.observed_at,f.now());
  assert.equal(f.kernel.get(f.a.scope,first.resource_id).source_version,1);
}));
test('M01-G06-SOURCE-REGRESSION',()=>use(async f=>{
  await f.shop.refresh(f.a.scope,'1001');f.get().data.order.updatedAt='2026-01-14T11:00:00Z';for(const x of f.get().data.order.fulfillments)x.updatedAt='2026-01-14T11:00:00Z';
  const r=await f.shop.refresh(f.a.scope,'1001');assert.equal(r.status,'source_regressed');assert.equal(r.order,null);
}));
test('M01-G06-REVIEW-CONCURRENT-REFRESH',()=>use(async f=>{
  let release:()=>void=()=>{};const blocked=new Promise<void>(r=>{release=r;});
  let started:()=>void=()=>{};const entered=new Promise<void>(r=>{started=r;});
  f.hook(async()=>{started();await blocked;});const first=f.shop.refresh(f.a.scope,'1001');await entered;
  f.hook(undefined);const next=structuredClone(f.get());next.data.order.fulfillments[0].displayStatus='IN_TRANSIT';
  next.data.order.fulfillments[0].deliveredAt=null;next.data.order.fulfillments[0].updatedAt='2026-01-15T11:30:00Z';f.set(next);
  const second=await f.shop.refresh(f.a.scope,'1001');release();
  await assert.rejects(first,/SOURCE_VERSION_CONFLICT/);
  assert.equal(f.shop.cached(f.a.scope,second.resource_id).status,'fresh');
  assert.equal(f.shop.cached(f.a.scope,second.resource_id).order.shipments[0].delivery_state,'IN_TRANSIT');
}));
test('M01-G06-REVIEW-TORN-SNAPSHOT',()=>use(async f=>{
  const r=await f.shop.refresh(f.a.scope,'1001');
  f.db.prepare("UPDATE commerce_resources SET payload=json_set(payload,'$.fulfillment_status','FULFILLED') WHERE id=?").run(r.resource_id);
  const cached=f.shop.cached(f.a.scope,r.resource_id);assert.equal(cached.status,'inconsistent_snapshot');assert.equal(cached.order,null);
}));
