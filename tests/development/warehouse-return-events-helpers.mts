import { completionFixture } from './completion-helpers.mts';
import { WarehouseReturnEvents } from '../../packages/commerce/warehouse-return-events.mts';
import type { Row } from '../../packages/commerce/kernel.mts';

export async function warehouseReturnFixture() {
 const f=await completionFixture(),events=new WarehouseReturnEvents(f.kernel,f.warehouse);
 const unit=(overrides:Row={})=>({line_id:'alpha',ordinal:1,variant_id:'shirt-small',grade:'sellable',received:true,disposition:null,...overrides});
 const event=(overrides:Row={})=>f.warehouse.recordReturnEvent({event_id:'warehouse_event_'+(f.warehouse.returnEvents().length+1),request_id:f.request.id,resource_id:f.order().id,native_return_id:'gid://shopify/Return/900',sequence:f.warehouse.returnEvents().length+1,kind:'receipt',location_id:'warehouse-one',operator_id:'partner_operator_1',evidence_ids:['partner_receipt_1'],completeness:'partial',parent_event_id:null,units:[unit()],...overrides});
 const observe=(e:Row)=>events.importEvent(f.a.scope,{request_id:f.request.id,event_id:e.event_id});
 return {...f,events,unit,event,observe};
}
export async function usingWarehouseReturn(fn:(f:Awaited<ReturnType<typeof warehouseReturnFixture>>)=>unknown) {
 const f=await warehouseReturnFixture();try{return await fn(f);}finally{f.cleanup();}
}
