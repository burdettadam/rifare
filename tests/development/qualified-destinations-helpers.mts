import { readFileSync } from 'node:fs';
import { fulfillmentFixture } from './fulfillment-helpers.mts';
import { QualifiedReturnDestinations } from '../../packages/commerce/qualified-return-destinations.mts';

export const destinationFixture = JSON.parse(readFileSync(new URL('../fixtures/qualified-destinations/routing.v1.json', import.meta.url), 'utf8'));

export async function qualifiedDestinationFixture() {
 const f = await fulfillmentFixture(), golden = structuredClone(destinationFixture), native = f.fulfillmentSource.destinations;
 const qualification = {account_id:golden.account_id,revision:1,enabled:true,contract_version:golden.contract_version,capabilities:golden.capabilities,expires_at:f.now()+3600000};
 native.qualify(qualification);
 const destinations = golden.destinations.map((d:any)=>({...golden.destination_defaults,...d,account_id:golden.account_id,revision:1,expires_at:f.now()+3600000}));
 destinations.forEach((d:any)=>native.recordDestination(d));
 const sourceRequest = {request_id:f.request.id,revision:1,resource_id:f.order().id,customer_id:f.order().customer_id,native_return_id:'gid://shopify/Return/900',native_order_id:f.order().payload.native_order_id,
  account_id:golden.account_id,region:golden.region,disposition:golden.disposition,items:golden.items,source_record_id:'routing-original-return-900'};
 native.recordRequest(sourceRequest);
 const routing = new QualifiedReturnDestinations(f.kernel,f.fulfillmentSource);
 const policy = {expected_revision:0,enabled:true,source_identity:f.fulfillmentSource.identity,account_id:golden.account_id,policy_version:1,allowed_destination_ids:destinations.map((d:any)=>d.destination_id),expires_at:f.now()+3600000};
 routing.configure(f.owner.scope,policy); routing.bind(f.a.scope,{request_id:f.request.id});
 const choose = (destination_id=golden.expected.recommended_destination_id,expected_revision=0)=>routing.select(f.owner.scope,{request_id:f.request.id,destination_id,expected_revision});
 const quote = ()=>f.labels.quote(f.a.scope,{request_id:f.request.id,replaces:null});
 const reviseDestination = (destination_id:string,changes:any)=>{const old=native.destination(destination_id);return native.recordDestination({...old,...changes,revision:old.revision+1});};
 const command = (operation_id:string)=>JSON.parse(f.db.prepare('SELECT command FROM commerce_fulfillment_operations WHERE id=?').get(operation_id).command);
 return {...f,golden,native,routing,qualification,destinations,sourceRequest,policy,choose,quote,reviseDestination,command};
}
export async function usingQualifiedDestinations(fn:(f:Awaited<ReturnType<typeof qualifiedDestinationFixture>>)=>unknown) {
 const f=await qualifiedDestinationFixture();try{return await fn(f);}finally{f.cleanup();}
}
