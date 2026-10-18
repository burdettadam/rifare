/** Disposable in-memory carrier-quote preparation. No provider access or purchase. */
import { DatabaseSync } from 'node:sqlite';
import { CommerceKernel } from '../packages/commerce/kernel.mts';
import { CarrierQuotes } from '../packages/commerce/carrier-quotes.mts';
import { CarrierQuoteFixtureSource } from '../packages/adapters/carrier-quote-fixture-source.mts';

const description={goal_id:'M08-G01',commands:['--describe','--run-local'],qualification:'synthetic_only',
  carrier_connected:false,label_purchase_supported:false,financial_effect:false,formal_goal_accepted:false};
const args=process.argv.slice(2);
if(args.length!==1||!['--describe','--run-local'].includes(args[0])){
  console.error('Use --describe or --run-local. This demonstration accepts no account, credential, provider or output-path options.');process.exitCode=2;
}else if(args[0]==='--describe')console.log(JSON.stringify(description,null,2));
else{
  const db=new DatabaseSync(':memory:');let now=Date.UTC(2026,0,15,12);
  try{
    const k=new CommerceKernel(db,()=>now);k.provisionStore('demo-merchant','demo-store');k.provisionMember('demo-merchant','demo-store','operator');
    const scope=k.authenticate(k.issueSession('demo-merchant','demo-store','operator'));
    const orders=['ORDER-A','ORDER-B'].map(external_id=>k.ingest(scope,{kind:'order',source_system:'synthetic',external_id,source_version:1,
      source_updated_at:now,customer_id:'synthetic-customer',payload:{status:'processing',total_minor:12500}}));
    const source=new CarrierQuoteFixtureSource({tenant_id:'demo-merchant',store_id:'demo-store'},()=>now);
    for(const service of ['ground','express'])source.setAccount({account_id:'account-'+service,carrier_id:'carrier-'+service,revision:1,enabled:true,currencies:['USD'],services:[service]});
    for(const [i,package_id] of ['package-a','package-b'].entries())source.setPackage({package_id,resource_id:orders[i].id,revision:1,address_revision:1,
      from_address_ref:'demo-warehouse',to_address_ref:'demo-destination-'+i,from_country:'US',to_country:'US',weight_g:i?900:400,length_mm:200,width_mm:100,height_mm:50});
    const rate=(package_id:string,service:string,amount_minor:string,revision=1)=>({package_id,account_id:'account-'+service,service,
      rate_id:'rate-'+package_id,revision,amount_minor,currency:'USD',expires_at:now+60000});
    source.setRate(rate('package-a','ground','500'));source.setRate(rate('package-b','express','900'));
    const policy={id:'demo-policy',revision:1,tenant_id:'demo-merchant',store_id:'demo-store',source_identity:source.identity,expires_at:now+300000,
      rules:['ground','express'].map(service=>({id:service,account_id:'account-'+service,carrier_id:'carrier-'+service,service,currency:'USD',max_amount_minor:'5000',
        from_countries:['US'],to_countries:['US'],max_weight_g:1000,max_length_mm:1000,max_width_mm:1000,max_height_mm:1000}))};
    const quotes=new CarrierQuotes(k,source,policy);
    const initial=quotes.quote(scope,{batch_id:'demo-batch',packages:[{package_id:'package-a',resource_id:orders[0].id,rule_id:'ground'},
      {package_id:'package-b',resource_id:orders[1].id,rule_id:'express'}]});
    now++;source.setRate(rate('package-a','ground','650',2));const revalidated=quotes.revalidate(scope,initial);
    const effect_counts=Object.fromEntries(['commerce_operations','commerce_fulfillment_operations','commerce_return_labels']
      .map(name=>[name,db.prepare('SELECT COUNT(*) n FROM '+name).get()!.n]));
    console.log(JSON.stringify({...description,generated_at:new Date().toISOString(),fixture_clock:'explicit_synthetic',initial,revalidated,effect_counts,
      limitations:['No real merchant or carrier account.','No label purchase, charge or execution approval.','M07 prerequisite and formal M08-G01 acceptance remain blocked.']},null,2));
  }finally{db.close();}
}
