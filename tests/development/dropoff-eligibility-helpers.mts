import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdtempSync,linkSync} from 'node:fs';
import {join} from 'node:path';
import {returnFixture} from './return-intake-helpers.mts';
import {installPartnerReadiness} from './partner-services-helpers.mts';
import {CommerceKernel} from '../../packages/commerce/kernel.mts';
import {NativeReturns} from '../../packages/commerce/native-returns.mts';
import {ShopifyReturnFixtureAdapter} from '../../packages/adapters/shopify-return-fixture.mts';
import {FulfillmentFixtureSource} from '../../packages/adapters/fulfillment-fixture-source.mts';
import {FulfillmentConfiguration} from '../../packages/commerce/return-fulfillment-core.mts';
import {QualifiedReturnDestinations} from '../../packages/commerce/qualified-return-destinations.mts';
import {PartnerFixtureSource} from '../../packages/adapters/partner-fixture-source.mts';
import {WarehouseFixtureSource} from '../../packages/adapters/warehouse-fixture-source.mts';
import {PartnerReadiness} from '../../packages/commerce/partner-readiness.mts';
import {ReverseHubs} from '../../packages/commerce/reverse-hubs.mts';
import {SupportOwnership} from '../../packages/commerce/support-core.mts';
import {SupportService} from '../../packages/commerce/support-service.mts';
import {DropoffFixtureSource} from '../../packages/adapters/dropoff-fixture-source.mts';
import {DropoffChoices} from '../../packages/commerce/dropoff-choices.mts';
import {WorkerApi} from '../../packages/commerce/worker-api.mts';
import {canonical,contentDigest} from '../../packages/commerce/configuration-values.mts';

export type Value=Record<string,any>;
export const E=JSON.parse(readFileSync(new URL('../fixtures/dropoff-eligibility/independent-values.json',import.meta.url),'utf8'));
export const TOP_FIELDS=['schema_version','request_id','case_id','items','methods','choices','state','source_digest','directory_revision','directory_digest','observed_at','expires_at','fallback','qualification','external_qualified','physical_handoff_qualified','credential_issued','execution_authorized','capacity_reserved','financial_effect'].sort();
export const SOURCE_FIELDS=['schema_version','contract','qualification','source_identity','tenant_id','store_id','fulfillment_source_identity','partner_source_identity','warehouse_source_identity','account_id','revision','observed_at','expires_at','partner_config_digest','combinations','digest'].sort();
export const ITEM_FIELDS=['line_id','item_id','category','quantity'];
export const pick=(value:Value,fields:string[])=>Object.fromEntries(fields.map(field=>[field,value[field]]));
export const key=(m:Value)=>[m.site_id,m.destination_id,m.method_id].join('/');
export const method=(view:Value,site='main-site')=>view.methods.find((m:Value)=>m.site_id===site);
export const choices=(view:Value)=>view.choices.map(key).sort();
export const quote=(f:any,scope=f.a.scope,input:Value={request_id:f.request.id})=>f.choices.quote(scope,input);
export const directoryRow=(f:any)=>f.partnerDb.prepare('SELECT * FROM fixture_dropoff_configuration WHERE singleton=1').get() as Value;
export const count=(db:DatabaseSync,table:string)=>Number((db.prepare('SELECT count(*) n FROM '+table).get() as Value).n);
export function databaseState(db:DatabaseSync){
  const names=(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Value[]).map(r=>r.name);
  return Object.fromEntries(names.map(name=>[name,(db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"').all() as Value[]).map(canonical).sort()]));
}
export const sourceState=(f:any)=>({fulfillment:databaseState(f.fulfillmentDb),partner:databaseState(f.partnerDb),warehouse:databaseState(f.warehouseDb)});
export const allState=(f:any)=>({core:databaseState(f.db),sources:sourceState(f),calls:{fulfillment:{...f.fulfillment.calls},partner:{...f.partner.calls},warehouse:{...f.warehouse.calls}}});
export function flags(view:Value){assert.equal(view.schema_version,1);assert.equal(view.qualification,'synthetic_only');assert.equal(view.fallback,'merchant_review_without_dropoff_promise');for(const field of ['external_qualified','physical_handoff_qualified','credential_issued','execution_authorized','capacity_reserved','financial_effect'])assert.equal(view[field],false);assert.match(view.source_digest,/^[a-f0-9]{64}$/);}
export function positive(f:any,view=quote(f)){
  flags(view);assert.equal(view.state,'eligible_choices');assert.deepEqual(choices(view),E.expected_choices);assert.deepEqual(view.items,E.items.map((i:Value)=>pick(i,ITEM_FIELDS)));
  const actual=[...view.methods].sort((a:Value,b:Value)=>key(a).localeCompare(key(b))).map((m:Value)=>({...pick(m,Object.keys(E.expected_methods[0]).filter(k=>k!=='items')),items:m.items.map((i:Value)=>pick(i,Object.keys(E.expected_methods[0].items[0])))}));assert.deepEqual(actual,E.expected_methods);
  for(const m of view.methods){assert.equal(m.choice_id,contentDigest([m.site_id,m.destination_id,m.method_id]));assert.equal(m.items.length,2);assert.ok(Array.isArray(m.reasons));for(const i of m.items)assert.ok(Array.isArray(i.reasons));}
  assert.ok(method(view,'accessory-site').items[0].reasons.includes('CATEGORY_UNSUPPORTED'));return view;
}

type Options={directory?:boolean;readiness?:boolean;directory_ttl_ms?:number;availability_ttl_ms?:number;line_count?:number};
export async function fixture(options:Options={}){
  const f=returnFixture(),opened:DatabaseSync[]=[];
  const open=(name:string)=>{const db=new DatabaseSync(join(f.directory,name));opened.push(db);return db;};
  try{
    // Original source facts precede every intake quote, prepared request and native binding.
    const items:Value[]=structuredClone(E.items),paid:Value[]=structuredClone(E.paid_lines);
    for(let n=3;n<=(options.line_count??2);n++){items.push({line_id:'extra-'+n,fulfillment_line_id:'gid://shopify/FulfillmentLineItem/'+(100+n),item_id:'item-'+n,category:'accessory',quantity:1,required_handling:['standard']});paid.push({id:'extra-'+n,product_id:'item-'+n,variant_id:'variant-'+n,quantity:1,gross_minor:'1000',discount_minor:'0',tax_minor:'0',shipping_minor:'0',duties_minor:'0',resolved_units:[]});}
    const original=f.order(),total=paid.reduce((sum,p)=>sum+BigInt(p.gross_minor),0n).toString(),lines=items.map((i,n)=>({id:i.line_id,fulfillment_line_id:i.fulfillment_line_id,ordered:i.quantity,fulfilled:i.quantity,returned:0,unit_minor:(BigInt(paid[n].gross_minor)/BigInt(i.quantity)).toString(),tags:[]}));
    const facts={revision:1,observed_at:f.now(),currency:'USD',payment_id:'dropoff-payment',original_paid_minor:total,prior_refunded_minor:'0',accounted_operations:[],paid_lines:paid};
    f.kernel.ingest(f.a.scope,{kind:'order',source_system:'synthetic',external_id:original.external_id,source_version:original.source_version+1,source_updated_at:f.now(),customer_id:original.customer_id,payload:{...original.payload,return_lines:lines,resolution_facts:facts,total_minor:total}});
    const intake=f.quote({lines:items.map(i=>({line_id:i.line_id,quantity:i.quantity}))}),request=f.prepare(intake);f.submit(request);
    const adapter=new ShopifyReturnFixtureAdapter({mode:'fixture',identity:'dropoff-native-return',tenant:f.a.tenant,store:f.a.store,transport:async({variables})=>({status:200,api_version:'2026-10',body:{data:{returnCreate:{userErrors:[],return:{id:'gid://shopify/Return/900',status:'OPEN',order:{id:variables.returnInput.orderId},returnLineItems:{nodes:variables.returnInput.returnLineItems.map((line:any,index:number)=>({id:'gid://shopify/ReturnLineItem/'+(901+index),quantity:line.quantity,returnReasonNote:line.returnReasonNote,fulfillmentLineItem:{id:line.fulfillmentLineItemId}})),pageInfo:{hasNextPage:false}},reverseFulfillmentOrders:{nodes:[{id:'gid://shopify/ReverseFulfillmentOrder/901'}],pageInfo:{hasNextPage:false}}}}}}})});
    assert.equal((await new NativeReturns(f.kernel,adapter).create(f.a.scope,request.id)).state,'created');
    const fulfillmentDb=open('dropoff-fulfillment.sqlite'),fulfillment=new FulfillmentFixtureSource(fulfillmentDb,{mode:'fixture',identity:'dropoff-fulfillment',tenant:f.a.tenant,store:f.a.store,clock:f.now}),native=fulfillment.destinations;
    new FulfillmentConfiguration(f.kernel).configure(f.owner.scope,{expected_revision:0,enabled:true,source_identity:fulfillment.identity,account_id:E.fulfillment_account_id,expires_at:f.now()+3600000,resolution_trigger:'manual'});
    native.qualify({account_id:E.fulfillment_account_id,revision:1,enabled:true,contract_version:E.contract_version,capabilities:E.capabilities,expires_at:f.now()+3600000});
    for(const d of E.destinations)native.recordDestination({...E.destination_defaults,...d,accepted_item_ids:items.map(i=>i.item_id),account_id:E.fulfillment_account_id,revision:1,expires_at:f.now()+3600000});
    const sourceRequest={request_id:request.id,revision:1,resource_id:f.order().id,customer_id:E.customer_id,native_return_id:'gid://shopify/Return/900',native_order_id:f.order().payload.native_order_id,account_id:E.fulfillment_account_id,region:E.region,disposition:E.disposition,items,source_record_id:'dropoff-original-return'};native.recordRequest(sourceRequest);
    const destinations=new QualifiedReturnDestinations(f.kernel,fulfillment),policy={expected_revision:0,enabled:true,source_identity:fulfillment.identity,account_id:E.fulfillment_account_id,policy_version:1,allowed_destination_ids:E.destinations.map((d:Value)=>d.destination_id),expires_at:f.now()+3600000};destinations.configure(f.owner.scope,policy);destinations.bind(f.a.scope,{request_id:request.id});
    const warehouseDb=open('dropoff-warehouse.sqlite'),warehouse=new WarehouseFixtureSource(warehouseDb,{mode:'fixture',identity:'dropoff-warehouse',tenant:f.a.tenant,store:f.a.store}),partnerDb=open('dropoff-partner.sqlite'),partner=new PartnerFixtureSource(partnerDb,{mode:'fixture',identity:'dropoff-partner',tenant:f.a.tenant,store:f.a.store},f.now),readiness=new PartnerReadiness(f.kernel),hubs=new ReverseHubs(f.kernel,partner,warehouse),ownership=new SupportOwnership(f.kernel);
    ownership.takeover(f.a.scope,{case_id:E.case_id,expected_generation:0,reason:'operator_requested'});
    const bundle:any={...f,items,paid,facts,request,fulfillmentDb,fulfillment,native,destinations,policy,sourceRequest,warehouseDb,warehouse,partnerDb,partner,readiness,hubs,ownership,options};
    configurePartner(bundle);if(options.readiness!==false)enable(bundle);
    const source=new DropoffFixtureSource({fulfillment,partner,warehouse});bundle.source=source;f.advance(10);
    const declaration=options.directory===false?null:source.configure(directoryInput(bundle)),owner=new DropoffChoices(f.kernel,{destinations,hubs,source});
    f.kernel.require(f.a.scope); // Warm only the acting staff heartbeat, never the customer proof.
    return {...bundle,declaration,choices:owner,service:new SupportService(f.kernel,f.reads,{dropoffChoices:owner}),cleanup:()=>{for(const db of opened.reverse())db.close();f.cleanup();}};
  }catch(error){for(const db of opened.reverse())db.close();f.cleanup();throw error;}
}
export async function usingFixture(fn:(f:any)=>unknown,options:Options={}){const f=await fixture(options);try{return await fn(f);}finally{f.cleanup();}}
export function configurePartner(f:any,patch:Value={}){const old=f.partner.configuration('reverse_hub');return f.partner.configure({service:'reverse_hub',account_id:E.partner_account_id,revision:(old?.body.revision??0)+1,regions:[E.region],expires_at:f.now()+300000,terms:{sites:E.sites.map((s:Value)=>({...s,warehouse_source_identity:f.warehouse.identity})),currency:'USD',fee_minor:'250',sla_ref:'synthetic-dropoff-receipt-sla'},...patch});}
export function partnerContext(f:any){const c=f.partner.configuration('reverse_hub');return {service:'reverse_hub',account_id:c.body.account_id,source_identity:f.partner.identity,source_config_digest:c.digest,region:E.region,capability:'route'};}
export const enable=(f:any,options:Value={})=>installPartnerReadiness(f.kernel,f.owner.scope,f.reviewer.scope,partnerContext(f),options);
export function directoryInput(f:any,patch:Value={}){const old=f.source.observe();return {revision:(old?.revision??0)+1,observed_at:f.now(),expires_at:f.now()+(f.options.directory_ttl_ms??E.directory_ttl_ms),partner_config_digest:f.partner.configuration('reverse_hub').digest,combinations:E.combinations.map((c:Value)=>({...structuredClone(c),availability:{state:'available',observed_at:f.now(),expires_at:f.now()+(f.options.availability_ttl_ms??E.availability_ttl_ms)}})),...patch};}
export const publish=(f:any,patch:Value={})=>f.source.configure(directoryInput(f,patch));
export function reviseDestination(f:any,id:string,patch:Value){const prior=f.native.destination(id);return f.native.recordDestination({...prior,...patch,revision:prior.revision+1});}
export function withMethod<T>(value:any,name:string,replacement:(original:Function,...args:any[])=>any,fn:()=>T):T{const proto=Object.getPrototypeOf(value),descriptor=Object.getOwnPropertyDescriptor(proto,name);assert.equal(typeof descriptor?.value,'function');Object.defineProperty(proto,name,{...descriptor,value:function(...args:any[]){return replacement(descriptor!.value.bind(this),...args);}});try{return fn();}finally{Object.defineProperty(proto,name,descriptor!);}}
export function externalWorker(f:any){const api=new WorkerApi(f.kernel),audience='http://127.0.0.1:9031/v1/worker',grant=api.leases.issue(f.a.scope,{case_id:E.case_id,lifetime_ms:30000},audience),lease=api.leases.claim(grant.token,audience,30000),scope=api.leases.returnScoped(grant.token,audience,lease.generation).scope;assert.equal(f.kernel.require(scope).role,'operator');assert.equal(f.kernel.workerIdentity(scope).kind,'external_work');return scope;}

/** Real native parents, with deliberate isolated database placement. */
export function withRawSources(f:any,options:{core?:'fulfillment'|'partner'|'warehouse';alias?:'same_handle'|'same_file'|'hardlink'}={},fn:(parents:Value)=>unknown){
  const dir=mkdtempSync(join(f.directory,'dropoff-preflight-')),opened:DatabaseSync[]=[],open=(path:string)=>{const db=new DatabaseSync(path);opened.push(db);return db;},fulfillmentPath=join(dir,'fulfillment.sqlite'),fulfillmentDb=open(fulfillmentPath),partnerDb=open(join(dir,'partner.sqlite'));
  let warehouseDb:DatabaseSync;
  if(options.alias==='same_handle')warehouseDb=fulfillmentDb;else if(options.alias==='same_file')warehouseDb=open(fulfillmentPath);else if(options.alias==='hardlink'){const alias=join(dir,'warehouse-alias.sqlite');linkSync(fulfillmentPath,alias);warehouseDb=open(alias);}else warehouseDb=open(join(dir,'warehouse.sqlite'));
  try{const dbs={fulfillment:fulfillmentDb,partner:partnerDb,warehouse:warehouseDb};if(options.core)new CommerceKernel(dbs[options.core],f.now);
    const fulfillment=new FulfillmentFixtureSource(fulfillmentDb,{mode:'fixture',identity:'raw-fulfillment',tenant:f.a.tenant,store:f.a.store,clock:f.now}),partner=new PartnerFixtureSource(partnerDb,{mode:'fixture',identity:'raw-partner',tenant:f.a.tenant,store:f.a.store},f.now),warehouse=new WarehouseFixtureSource(warehouseDb,{mode:'fixture',identity:'raw-warehouse',tenant:f.a.tenant,store:f.a.store});
    return fn({fulfillment,partner,warehouse,dbs});
  }finally{for(const db of opened.reverse())db.close();}
}
