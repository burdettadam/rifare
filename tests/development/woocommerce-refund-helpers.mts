import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {wooReturnFixture} from './woocommerce-return-helpers.mts';
import {WooRefundFixtureSource} from '../../packages/adapters/woocommerce/refund-fixture-source.mts';
import {WooRefundGatewayFixture} from '../../packages/adapters/woocommerce/refund-gateway-fixture.mts';
import {WOO_GATEWAY_ID,wooSourceBinding} from '../../packages/adapters/woocommerce/refund-contract.mts';
import {ResolutionLedger} from '../../packages/commerce/resolution-ledger.mts';
import {RefundQuotes} from '../../packages/commerce/refund-quotes.mts';
import {ResolutionExecution} from '../../packages/commerce/resolution-execution.mts';

export function wooRefundFixture(options:any={}){
 const f=wooReturnFixture();f.intake.configure(f.owner.scope,{expected_revision:1,settings:{...f.settings,restocking_bps:0,shipping_minor:'0'}});
 // G01's independent read fixture keeps its original gateway label. This new
 // scenario explicitly selects the one named financial fixture contract.
 f.publish(input=>{input.order.payment_method=WOO_GATEWAY_ID;input.financial_contract.gateway_id=WOO_GATEWAY_ID;});f.woo.refresh(f.a.scope,'17');
 const binding=f.woo.binding(f.a.scope,f.order().id),financial=binding.financial_contract,returnSource=f.source,returnSourceDb=f.sourceDb,
  gatewayFilename=join(f.directory,'woo-gateway.sqlite'),sourceFilename=join(f.directory,'woo-refunds.sqlite'),gatewayDb=new DatabaseSync(gatewayFilename),sourceDb=new DatabaseSync(sourceFilename),
  gatewayOptions={mode:'fixture' as const,identity:'woo_gateway_fixture',tenant:f.a.tenant,store:f.a.store,gateway_id:WOO_GATEWAY_ID,account_id:financial.gateway_account_id},
  gatewaySource=new WooRefundGatewayFixture(gatewayDb,gatewayOptions,f.now),sourceOptions={mode:'fixture' as const,identity:'woo_refund_fixture',tenant:f.a.tenant,store:f.a.store,account_id:binding.account_id,origin:binding.origin,refund_mode:options.manual?'manual' as const:'gateway' as const,granted_scopes:['read','write']},
  source=new WooRefundFixtureSource(sourceDb,gatewaySource,sourceOptions,f.now);
 gatewaySource.seed({resource_id:f.order().id,customer_id:f.order().customer_id,native_order_id:'17',payment_id:financial.payment_id,transaction_id:financial.transaction_id,instrument_id:financial.instrument_id,currency:financial.currency,
  original_paid_minor:financial.original_paid_minor,prior_refunded_minor:options.gatewayPriorRefunded??financial.prior_refunded_minor});
 source.seed({resource_id:f.order().id,customer_id:f.order().customer_id,source_binding:wooSourceBinding(binding),financial_contract:financial,
  original_units:[1,2].map(unit_index=>({line_id:'71',unit_index,amount_minor:'1000',resolved:false}))});
 const ledger=new ResolutionLedger(f.kernel);ledger.configure(f.owner.scope,{expected_revision:0,enabled:true,source_identity:source.identity,credit_instrument:'none',expires_at:f.now()+3600000,inventory_buffer:0,woo_refund:source.configuration()});
 const request=f.prepare();f.submit(request);const quotes=new RefundQuotes(f.kernel),executor=new ResolutionExecution(f.kernel,source,{deadline_ms:options.deadlineMs??1000});
 const intent=(extra:any={})=>({request_id:request.id,request_key:'woo-allocation',lines:[{line_id:'71',units:[1],outcome:'refund'}],...extra}),allocate=(input:any=intent())=>ledger.allocate(f.a.scope,input),
  quote=(allocation:any)=>quotes.quote(f.a.scope,{allocation_id:allocation.id??allocation}),authorize=(q:any)=>{const preview=f.gateway.prepare(f.a.scope,q.proposal),approval=f.gateway.approve(f.reviewer.scope,{preview_id:preview.id,preview_digest:preview.digest}),receipt=f.gateway.execute(f.a.scope,{preview_id:preview.id,preview_digest:preview.digest,approval_id:approval.id});return {id:receipt.resolution_operation_id,preview,approval,receipt};},
  approved=()=>{const plan=allocate(),allocation=plan.allocations[0],quoted=quote(allocation);return {...authorize(quoted),plan,allocation,quoted};};
 return {...f,returnSource,returnSourceDb,source,sourceDb,sourceFilename,sourceOptions,gatewaySource,gatewayDb,gatewayFilename,gatewayOptions,binding,financial,ledger,quotes,executor,request,intent,allocate,quote,authorize,approved,
  cleanup:()=>{sourceDb.close();gatewayDb.close();f.cleanup();}};
}
export async function usingWooRefund(fn:(f:ReturnType<typeof wooRefundFixture>)=>unknown,options:any={}){const f=wooRefundFixture(options);try{return await fn(f);}finally{f.cleanup();}}
