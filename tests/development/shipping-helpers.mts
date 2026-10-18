import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { commerceFixture } from './commerce-helpers.mts';
import { CarrierQuotes } from '../../packages/commerce/carrier-quotes.mts';
import { CarrierQuoteFixtureSource } from '../../packages/adapters/carrier-quote-fixture-source.mts';
import { ShippingCarrierFixtureSource } from '../../packages/adapters/shipping-carrier-fixture-source.mts';
import { ShippingBatchLabels } from '../../packages/commerce/shipping-batch-labels.mts';
import { ShippingManifests } from '../../packages/commerce/shipping-manifests.mts';
import { PackingSessions } from '../../packages/commerce/packing-sessions.mts';
import type { Row } from '../../packages/commerce/kernel.mts';

export function shippingFixture() {
  const f=commerceFixture(),k=f.kernel;
  k.provisionMember(f.a.tenant,f.a.store,'reviewer','reviewer');
  k.provisionMember(f.a.tenant,f.a.store,'owner','owner');
  const reviewer=k.authenticate(k.issueSession(f.a.tenant,f.a.store,'reviewer'));
  const owner=k.authenticate(k.issueSession(f.a.tenant,f.a.store,'owner'));
  const orders=['a','b'].map(key=>k.ingest(f.a.scope,{kind:'order',source_system:'synthetic',external_id:'ORDER-'+key,
    source_version:1,source_updated_at:f.now(),customer_id:'customer-'+key,
    payload:{packing:{cancelled:false,lines:[{line_id:'line-'+key,sku:'sku-'+key,quantity:2,cancelled_ordinals:[],backordered_ordinals:[],shipped_ordinals:[],return_links:[]}]}}}));
  const quoteSource=new CarrierQuoteFixtureSource({tenant_id:f.a.tenant,store_id:f.a.store},f.now);
  quoteSource.setAccount({account_id:'account-one',carrier_id:'carrier-one',revision:1,enabled:true,currencies:['USD','JPY'],services:['ground']});
  for(const [i,key] of ['a','b'].entries()){
    quoteSource.setPackage({package_id:'package-'+key,resource_id:orders[i].id,revision:1,address_revision:1,from_address_ref:'warehouse-one',to_address_ref:'destination-'+key,
      from_country:'US',to_country:'US',weight_g:400,length_mm:200,width_mm:100,height_mm:50});
    quoteSource.setRate({package_id:'package-'+key,account_id:'account-one',service:'ground',rate_id:'rate-'+key,revision:1,amount_minor:i?'900':'500',currency:'USD',expires_at:f.now()+120000});
  }
  const policy={id:'shipping-policy',revision:1,tenant_id:f.a.tenant,store_id:f.a.store,source_identity:quoteSource.identity,expires_at:f.now()+600000,rules:[{
    id:'ground',account_id:'account-one',carrier_id:'carrier-one',service:'ground',currency:'USD',max_amount_minor:'999999999999999999999999999999999999',
    from_countries:['US'],to_countries:['US'],max_weight_g:1000,max_length_mm:1000,max_width_mm:1000,max_height_mm:1000}]};
  const quotes=new CarrierQuotes(k,quoteSource,policy),sourceDB=new DatabaseSync(join(f.directory,'carrier.sqlite'));
  const sourceOptions={mode:'fixture' as const,tenant_id:f.a.tenant,store_id:f.a.store,identity:'shipping-fixture',quote_source:quoteSource,clock:f.now};
  const source=new ShippingCarrierFixtureSource(sourceDB,sourceOptions),labels=new ShippingBatchLabels(k,quotes,source,{deadline_ms:15});
  const packing=new PackingSessions(k,quoteSource),manifests=new ShippingManifests(k,packing,labels,source,{deadline_ms:15});
  const request={batch_id:'batch-one',packages:['a','b'].map((key,i)=>({package_id:'package-'+key,resource_id:orders[i].id,rule_id:'ground'}))};
  const quote=()=>quotes.quote(f.a.scope,request);
  const approved=(snapshot:Row=quote())=>{
    const prepared=labels.prepare(f.a.scope,snapshot);
    for(const p of prepared.packages.filter((p:Row)=>p.state==='proposed'))labels.approve(reviewer,p.package_id,{expected_digest:p.command_digest,expires_at:f.now()+60000});
    return snapshot;
  };
  const packed=()=>{
    for(const [i,key] of ['a','b'].entries()){
      const session_id='pack-'+key;
      packing.open(f.a.scope,{session_id,package_id:'package-'+key,resource_id:orders[i].id,units:[{line_id:'line-'+key,ordinal:1}]});
      packing.scan(f.a.scope,{session_id,scanner_id:'scanner-one',scan_id:'scan-'+key,line_id:'line-'+key,ordinal:1,sku:'sku-'+key});
      packing.confirm(f.a.scope,{session_id,expected_revision:packing.read(f.a.scope,session_id).revision});
    }
  };
  const cleanup=()=>{sourceDB.close();f.cleanup();};
  return {...f,orders,reviewer,owner,quoteSource,policy,quotes,sourceDB,sourceOptions,source,labels,packing,manifests,request,quote,approved,packed,cleanup};
}
export async function usingShipping(run:(f:ReturnType<typeof shippingFixture>)=>unknown){const f=shippingFixture();try{return await run(f);}finally{f.cleanup();}}
