/** Disposable local scanner/allocation demonstration; no physical or stock claim. */
import { DatabaseSync } from 'node:sqlite';
import { CommerceKernel } from '../packages/commerce/kernel.mts';
import { PackingSessions } from '../packages/commerce/packing-sessions.mts';
import { CarrierQuoteFixtureSource } from '../packages/adapters/carrier-quote-fixture-source.mts';

const description={goal_ids:['M08-G03','M08-G04'],commands:['--describe','--run-local'],qualification:'synthetic_only',
  physical_qualified:false,inventory_effect:false,financial_effect:false,formal_goal_accepted:false};
const args=process.argv.slice(2);
if(args.length!==1||!['--describe','--run-local'].includes(args[0])){
  console.error('Use --describe or --run-local. The demonstration accepts no account, credential, provider or output-path options.');process.exitCode=2;
}else if(args[0]==='--describe')console.log(JSON.stringify(description,null,2));
else{
  const db=new DatabaseSync(':memory:'),now=()=>Date.UTC(2026,0,15,12);
  try{
    const k=new CommerceKernel(db,now);k.provisionStore('demo-merchant','demo-store');k.provisionMember('demo-merchant','demo-store','operator');
    const scope=k.authenticate(k.issueSession('demo-merchant','demo-store','operator'));
    const order=k.ingest(scope,{kind:'order',source_system:'synthetic',external_id:'PACK-ORDER',source_version:1,source_updated_at:now(),customer_id:'synthetic-customer',
      payload:{packing:{cancelled:false,lines:[{line_id:'line-a',sku:'sku-a',quantity:3,cancelled_ordinals:[],backordered_ordinals:[],shipped_ordinals:[],return_links:[]}]}}});
    const source=new CarrierQuoteFixtureSource({tenant_id:'demo-merchant',store_id:'demo-store'},now);
    for(const package_id of ['package-a','package-b'])source.setPackage({package_id,resource_id:order.id,revision:1,address_revision:1,
      from_address_ref:'demo-warehouse',to_address_ref:'demo-destination',from_country:'US',to_country:'US',weight_g:500,length_mm:200,width_mm:100,height_mm:50});
    const service=new PackingSessions(k,source);
    const open=(session_id:string,package_id:string,ordinals:number[])=>service.open(scope,{session_id,package_id,resource_id:order.id,units:ordinals.map(ordinal=>({line_id:'line-a',ordinal}))});
    const scan=(session_id:string,ordinal:number)=>service.scan(scope,{session_id,scanner_id:'demo-scanner',scan_id:session_id+'-'+ordinal,line_id:'line-a',ordinal,sku:'sku-a'});
    const confirm=(session_id:string)=>service.confirm(scope,{session_id,expected_revision:service.read(scope,session_id).revision});
    open('session-a','package-a',[1,2]);scan('session-a',1);const duplicate=scan('session-a',1),partial=service.read(scope,'session-a');
    scan('session-a',2);const confirmed=confirm('session-a');
    open('session-b','package-b',[3]);scan('session-b',3);confirm('session-b');
    const shipped=service.observeShipment(scope,{session_id:'session-a',observation_id:'demo-operator-fixture-observation'});
    const cancelled=service.cancel(scope,{session_id:'session-b',expected_revision:service.read(scope,'session-b').revision});
    console.log(JSON.stringify({...description,generated_at:new Date().toISOString(),fixture_clock:'explicit_synthetic',duplicate,partial,confirmed,shipped,cancelled,
      remaining:service.remaining(scope,order.id),limitations:['Scanner input is a local API fixture, not hardware/browser qualification.',
        'The operator fixture shipping observation does not establish carrier acceptance or settle inventory.',
        'M07 prerequisite and formal M08 goal acceptance remain blocked.']},null,2));
  }finally{db.close();}
}
