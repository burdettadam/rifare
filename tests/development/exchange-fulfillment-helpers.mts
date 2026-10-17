import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { financeFixture } from './exchange-finance-helpers.mts';
import { FulfillmentFixtureSource } from '../../packages/adapters/fulfillment-fixture-source.mts';
import { FulfillmentConfiguration } from '../../packages/commerce/return-fulfillment-core.mts';
import { ReplacementInventory } from '../../packages/commerce/replacement-inventory.mts';
import { ReplacementOrders } from '../../packages/commerce/replacement-orders.mts';
import { FulfillmentExecution } from '../../packages/commerce/fulfillment-execution.mts';

export async function exchangeFulfillmentFixture(options:{mixed?:boolean,price?:string,financeSource?:boolean}={}){
 const f=await financeFixture(options),fulfillmentDb=new DatabaseSync(join(f.directory,'exchange-fulfillment.sqlite'));
 const fulfillmentSource=new FulfillmentFixtureSource(fulfillmentDb,{mode:'fixture',identity:'exchange-fulfillment-one',tenant:f.a.tenant,store:f.a.store,clock:f.now,...(options.financeSource===false?{}:{finance_source:f.source})});
 const config=new FulfillmentConfiguration(f.kernel);config.configure(f.owner.scope,{expected_revision:0,enabled:true,source_identity:fulfillmentSource.identity,account_id:'warehouse-account',expires_at:f.now()+3600000,resolution_trigger:'manual'});
 fulfillmentSource.seedStock({catalog_id:f.catalogResource.id,variant_id:'shoe-large',location_id:'warehouse-one',version:1,available:5});
 const inventory=new ReplacementInventory(f.kernel,fulfillmentSource),orders=new ReplacementOrders(f.kernel),execution=new FulfillmentExecution(f.kernel,fulfillmentSource);
 const reserve=()=>inventory.reserve(f.a.scope,{quote_id:f.exchange.id,quote_digest:f.exchange.digest,location_id:'warehouse-one',ttl_ms:50000});
 const replacementQuote=(reservation:any)=>orders.quote(f.a.scope,{reservation_id:reservation.id});
 const authorizeFulfillment=(q:any)=>{const preview=f.gateway.prepare(f.a.scope,q.proposal),approval=f.gateway.approve(f.reviewer.scope,{preview_id:preview.id,preview_digest:preview.digest}),receipt=f.gateway.execute(f.a.scope,{preview_id:preview.id,preview_digest:preview.digest,approval_id:approval.id});return {id:receipt.fulfillment_operation_id,preview,approval,receipt};};
 const settle=async(outcome='additional_payment')=>{const op=f.authorize(f.financeQuote(outcome));await f.executor.dispatch(f.a.scope,op.id);if(outcome==='additional_payment')f.source.settlePayment(op.id);else if(outcome==='refund')f.source.settle(op.id);await f.executor.reconcile(f.a.scope,op.id);return op;};
 const nativeCommand=(op:any)=>JSON.parse((f.db.prepare('SELECT command FROM commerce_fulfillment_operations WHERE id=?').get(op.id) as any).command);
 return {...f,fulfillmentDb,fulfillmentSource,inventory,orders,execution,reserve,replacementQuote,authorizeFulfillment,settle,nativeCommand,cleanup:()=>{fulfillmentDb.close();f.cleanup();}};
}
export async function usingExchangeFulfillment(fn:(f:Awaited<ReturnType<typeof exchangeFulfillmentFixture>>)=>unknown,options:{mixed?:boolean,price?:string,financeSource?:boolean}={}){const f=await exchangeFulfillmentFixture(options);try{return await fn(f);}finally{f.cleanup();}}
