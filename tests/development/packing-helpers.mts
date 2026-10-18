import { DatabaseSync } from 'node:sqlite';
import { CommerceKernel } from '../../packages/commerce/kernel.mts';
import type { Row } from '../../packages/commerce/kernel.mts';
import { CarrierQuoteFixtureSource } from '../../packages/adapters/carrier-quote-fixture-source.mts';
import { PackingSessions } from '../../packages/commerce/packing-sessions.mts';
import { commerceFixture } from './commerce-helpers.mts';

export const packingLine=(extra:Row={})=>({line_id:'line-a',sku:'sku-a',quantity:3,cancelled_ordinals:[],backordered_ordinals:[],shipped_ordinals:[],return_links:[],...extra});
export function packingFixture(lines:Row[]=[packingLine()]) {
  const f=commerceFixture();let version=1;
  const source=new CarrierQuoteFixtureSource({tenant_id:f.a.tenant,store_id:f.a.store},f.now);
  const payload={packing:{cancelled:false,lines}};
  const ingest=()=>f.kernel.ingest(f.a.scope,{kind:'order',source_system:'synthetic',external_id:'PACK-ORDER',source_version:version,
    source_updated_at:f.now(),customer_id:'C-1001',payload});
  const order=ingest();
  const addParcel=(package_id:string,resource_id=order.id)=>source.setPackage({package_id,resource_id,revision:1,address_revision:1,
    from_address_ref:'warehouse-a',to_address_ref:'destination-a',from_country:'US',to_country:'US',weight_g:500,length_mm:200,width_mm:100,height_mm:50});
  for(const name of ['package-a','package-b','package-c','package-d'])addParcel(name);
  const service=new PackingSessions(f.kernel,source);
  const open=(units=[{line_id:'line-a',ordinal:1}],session_id='session-a',package_id='package-a')=>service.open(f.a.scope,{session_id,package_id,resource_id:order.id,units});
  const scan=(ordinal:number,extra:Row={})=>service.scan(f.a.scope,{session_id:'session-a',scanner_id:'scanner-a',scan_id:'scan-'+ordinal,
    line_id:'line-a',ordinal,sku:'sku-a',...extra});
  const confirm=(session_id='session-a')=>service.confirm(f.a.scope,{session_id,expected_revision:service.read(f.a.scope,session_id).revision});
  const pack=(ordinals:number[],session_id='session-a',package_id='package-a')=>{
    open(ordinals.map(ordinal=>({line_id:'line-a',ordinal})),session_id,package_id);
    for(const ordinal of ordinals)scan(ordinal,{session_id,scan_id:session_id+'-'+ordinal});return confirm(session_id);
  };
  const restart=()=>{const db=new DatabaseSync(f.filename),kernel=new CommerceKernel(db,f.now);
    return {db,kernel,service:new PackingSessions(kernel,source),scope:kernel.authenticate(f.a.bearer)};};
  return {...f,order,payload,source,service,open,scan,confirm,pack,addParcel,restart,
    update:()=>{version++;return ingest();}};
}
export async function usingPacking(run:(f:ReturnType<typeof packingFixture>)=>unknown,lines?:Row[]) {
  const f=packingFixture(lines);try{return await run(f);}finally{f.cleanup();}
}
