import { executionFixture } from './execution-helpers.mts';
import { ReturnIntake } from '../../packages/commerce/return-intake.mts';
import { ReturnReview } from '../../packages/commerce/return-intake-core.mts';
import { ReturnEvidence } from '../../packages/commerce/return-evidence.mts';
import { digest } from '../../packages/commerce/kernel.mts';
export function returnFixture(){
 const f=executionFixture(),intake=new ReturnIntake(f.kernel),review=new ReturnReview(f.kernel);
 const settings={currency:'USD',restocking_bps:1000,shipping_minor:'100',time_zone:'America/Denver',brand:'Sample apparel',contact:'support@example.invalid',override_days:7,retention_days:30};
 intake.configure(f.owner.scope,{expected_revision:0,settings});
 const lines=[{id:'one',fulfillment_line_id:'gid://shopify/FulfillmentLineItem/101',ordered:3,fulfilled:2,returned:1,unit_minor:'2000',tags:[]},
  {id:'excluded',fulfillment_line_id:'gid://shopify/FulfillmentLineItem/102',ordered:4,fulfilled:4,returned:0,unit_minor:'500',tags:['final-sale']},
  {id:'three',fulfillment_line_id:'gid://shopify/FulfillmentLineItem/103',ordered:2,fulfilled:2,returned:0,unit_minor:'1000',tags:[]}];
 const order=f.order();f.kernel.ingest(f.a.scope,{kind:'order',source_system:'synthetic',external_id:order.external_id,source_version:3,source_updated_at:f.now(),customer_id:order.customer_id,payload:{...order.payload,return_lines:lines,native_order_id:'gid://shopify/Order/201',counted_return_ids:[]}});
 const selection=(extra:any={})=>({case_id:'case_one',lines:[{line_id:'one',quantity:1}],outcome:'refund',reason:'size',note:'',evidence_ids:[],...extra});
 const quote=(extra:any={},scope=f.customer)=>intake.evaluate(scope,selection(extra));
 const prepare=(q=quote(),extra:any={},scope=f.customer)=>intake.prepare(scope,{quote_id:q.id,quote_digest:q.digest,request_key:'return-one',override_id:null,...extra});
 const submit=(p=prepare())=>{const a=f.gateway.approve(f.reviewer.scope,{preview_id:p.preview_id,preview_digest:p.preview_digest});return f.gateway.execute(f.a.scope,{preview_id:p.preview_id,preview_digest:p.preview_digest,approval_id:a.id});};
 const evidence=new ReturnEvidence(f.kernel,{identity:'fixture-hash-scan-v1',scan:async bytes=>({verdict:'clean',sha256:digest(bytes)})},Buffer.alloc(32,3));
 return {...f,intake,review,evidence,settings,lines,selection,quote,prepare,submit};
}
export async function usingReturns(fn:(f:ReturnType<typeof returnFixture>)=>unknown){const f=returnFixture();try{return await fn(f);}finally{f.cleanup();}}
