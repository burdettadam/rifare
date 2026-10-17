import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { returnFixture } from './return-intake-helpers.mts';
import { ResolutionLedger } from '../../packages/commerce/resolution-ledger.mts';
import { NativeReturns } from '../../packages/commerce/native-returns.mts';
import { VariantExchanges } from '../../packages/commerce/variant-exchanges.mts';
import { ShopifyReturnFixtureAdapter } from '../../packages/adapters/shopify-return-fixture.mts';
import { FulfillmentFixtureSource } from '../../packages/adapters/fulfillment-fixture-source.mts';
import { InstantExchangeFixtureSource } from '../../packages/adapters/instant-exchange-fixture-source.mts';
import { InstantExchanges,instantObligationId } from '../../packages/commerce/instant-exchanges.mts';
import { contentDigest } from '../../packages/commerce/configuration-values.mts';

export const oracle=JSON.parse(readFileSync(new URL('../fixtures/instant-exchanges/independent-values.json',import.meta.url),'utf8'));
export const captureCount=(f:any)=>f.source.db.prepare('SELECT count(*) n FROM fixture_instant_captures').get().n;
export async function instantFixture(){
 const f=returnFixture();f.intake.configure(f.owner.scope,{expected_revision:1,settings:{...f.settings,restocking_bps:0,shipping_minor:'0'}});f.advance(1);
 const order=f.order(),lines=[{id:'instant_line',fulfillment_line_id:'gid://shopify/FulfillmentLineItem/301',ordered:3,fulfilled:3,returned:0,unit_minor:'1000',tags:[]}];
 const paid={id:'instant_line',product_id:'shirt',variant_id:'shirt-small',quantity:3,gross_minor:'3000',discount_minor:'0',tax_minor:'0',shipping_minor:'0',duties_minor:'0',resolved_units:[]};
 const facts={revision:1,observed_at:f.now(),currency:'USD',payment_id:'instant_payment',original_paid_minor:'3000',prior_refunded_minor:'0',accounted_operations:[],paid_lines:[paid]};
 f.kernel.ingest(f.a.scope,{kind:'order',source_system:'synthetic',external_id:order.external_id,source_version:order.source_version+1,source_updated_at:f.now(),customer_id:order.customer_id,payload:{...order.payload,total_minor:'3000',return_lines:lines,resolution_facts:facts}});
 f.cases.create(f.customer,{case_id:'instant_case',resource_id:f.order().id,profile_id:'default',policy_id:'returns'});
 const q=f.intake.evaluate(f.customer,{case_id:'instant_case',lines:[{line_id:'instant_line',quantity:3}],outcome:'exchange',reason:'size',note:'',evidence_ids:[]}),request=f.intake.prepare(f.customer,{quote_id:q.id,quote_digest:q.digest,request_key:'instant_request',override_id:null});f.submit(request);
 const adapter=new ShopifyReturnFixtureAdapter({mode:'fixture',identity:'instant-return-source',tenant:f.a.tenant,store:f.a.store,transport:async({variables})=>{
  const native={id:'gid://shopify/Return/700',status:'OPEN',order:{id:variables.returnInput.orderId},
   returnLineItems:{nodes:variables.returnInput.returnLineItems.map((l:any,i:number)=>({id:'gid://shopify/ReturnLineItem/'+(701+i),quantity:l.quantity,returnReasonNote:l.returnReasonNote,fulfillmentLineItem:{id:l.fulfillmentLineItemId}})),pageInfo:{hasNextPage:false}},
   reverseFulfillmentOrders:{nodes:[{id:'gid://shopify/ReverseFulfillmentOrder/701'}],pageInfo:{hasNextPage:false}}};
  return {status:200,api_version:'2026-10',body:{data:{returnCreate:{userErrors:[],return:native}}}};
 }});
 await new NativeReturns(f.kernel,adapter).create(f.a.scope,request.id);
 const ledger=new ResolutionLedger(f.kernel);ledger.configure(f.owner.scope,{expected_revision:0,enabled:true,source_identity:'separate_finance_fixture',credit_instrument:'none',expires_at:f.now()+3600000,inventory_buffer:0});
 const plan=ledger.allocate(f.a.scope,{request_id:request.id,request_key:'instant_allocation',lines:[{line_id:'instant_line',units:[1,2,3],outcome:'exchange'}]}),allocation=plan.allocations[0];
 const catalog=f.kernel.ingest(f.a.scope,{kind:'catalog',source_system:'synthetic',external_id:'shirt-large',source_version:1,source_updated_at:f.now(),customer_id:null,payload:{variant_id:'shirt-large',product_id:'shirt',currency:'USD',unit_price_minor:'1000',tax_per_unit_minor:'0',shipping_minor:'0',duties_per_unit_minor:'0',available:10,discount_eligible:true,promotion_expires_at:f.now()+300000,excluded:false}}),exchanges=new VariantExchanges(f.kernel),exchange=exchanges.quote(f.a.scope,{allocation_id:allocation.id,catalog_id:catalog.id});
 const sourceFilename=join(f.directory,'instant-source.sqlite'),sourceDb=new DatabaseSync(sourceFilename),source=new InstantExchangeFixtureSource(sourceDb,{mode:'fixture',tenant:f.a.tenant,store:f.a.store,identity:'instant-source',clock:f.now}),instant=new InstantExchanges(f.kernel,source);
 const startedAt=f.now(),account={account_id:'account_one',revision:1,currency:'USD',mandates:true,bounded_capture:true,reauthorization:true,authoritative_lookup:true,atomic_return_capture:true,contract_ref:'synthetic_contract',verified_at:f.now(),expires_at:f.now()+3600000};
 source.qualifyAccount(account);
 const termsInput={terms_id:'terms_one',version:1,account_id:'account_one',merchant_approved:true,merchant_approval_ref:'synthetic_merchant_approval',notice:'Synthetic agreement: return these three original items by the displayed trial deadline. One bounded charge may collect the displayed original paid value of unreturned items, within the stated ceiling and valid authorization.',nonreturn_rule:'unreturned_original_paid_v1',currency:'USD',maximum_minor:'3000',trial_ms:oracle.trial_ms,expires_at:f.now()+3600000},terms=source.publishTerms(termsInput);
 const obligationId=instantObligationId(f.a.tenant,f.a.store,allocation.id),binding={obligation_id:obligationId,allocation_id:allocation.id,case_id:'instant_case',resource_id:f.order().id,customer_id:f.order().customer_id,native_return_id:'gid://shopify/Return/700',native_original_order_id:f.order().payload.native_order_id,exchange_quote_id:exchange.id,exchange_quote_digest:exchange.digest,currency:'USD',units:oracle.units,original_paid_minor:'3000',replacement_variant:'shirt-large',quantity:3};
 source.seedOrder({resource_id:f.order().id,customer_id:f.order().customer_id,native_original_order_id:f.order().payload.native_order_id,currency:'USD',units:oracle.units});
 const consent=(patch:any={})=>source.grantConsent({id:'consent_one',account_id:'account_one',terms_id:'terms_one',terms_digest:terms.digest,binding,maximum_minor:'3000',trial_deadline_at:startedAt+oracle.trial_ms,mandate_expires_at:startedAt+oracle.mandate_lifetime_ms,confirmed_at:f.now(),consent_expires_at:startedAt+oracle.mandate_lifetime_ms,proof_ref:'synthetic_customer_agreement',reauthorization_of:null,...patch});consent();
 instant.configure(f.owner.scope,{enabled:true,expected_revision:0,source_identity:source.identity,account_id:'account_one',expires_at:f.now()+3600000});
 const fulfillmentDb=new DatabaseSync(join(f.directory,'instant-stock.sqlite')),fulfillmentSource=new FulfillmentFixtureSource(fulfillmentDb,{mode:'fixture',tenant:f.a.tenant,store:f.a.store,identity:'instant-stock-source',clock:f.now});
 fulfillmentSource.seedStock({catalog_id:catalog.id,variant_id:'shirt-large',location_id:'warehouse_one',version:1,available:10});
 const hold={id:'instant_stock_hold',allocation_id:allocation.id,generation:1,tenant_id:f.a.tenant,store_id:f.a.store,case_id:'instant_case',resource_id:f.order().id,source_identity:fulfillmentSource.identity,catalog_id:catalog.id,variant_id:'shirt-large',location_id:'warehouse_one',stock_version:1,quantity:3,buffer:0,expires_at:f.now()+300000};fulfillmentSource.reserve(hold);
 const replacementCommand=(proof:any)=>({operation_id:'instant_replacement_operation',kind:'replacement',obligation:allocation.id,reservation_id:hold.id,reservation_digest:contentDigest(hold),generation:1,allocation_id:allocation.id,case_id:'instant_case',resource_id:f.order().id,customer_id:f.order().customer_id,tenant_id:f.a.tenant,store_id:f.a.store,source_identity:fulfillmentSource.identity,original_order_id:f.order().id,native_original_order_id:f.order().payload.native_order_id,currency:'USD',variant_id:'shirt-large',location_id:'warehouse_one',quantity:3,catalog_id:catalog.id,exchange_quote_digest:exchange.digest,original_value_minor:'3000',exchange_value_minor:'3000',balance_minor:'0',instant_exchange:proof});
 const authorize=(quote:any)=>{const preview=f.gateway.prepare(f.a.scope,quote.proposal),approval=f.gateway.approve(f.reviewer.scope,{preview_id:preview.id,preview_digest:preview.digest}),receipt=f.gateway.execute(f.a.scope,{preview_id:preview.id,preview_digest:preview.digest,approval_id:approval.id});return {id:receipt.instant_operation_id,preview,approval,receipt};};
 const received=(event:string,numbers:number[])=>({obligation_id:obligationId,event_id:event,units:numbers.map(n=>({line_id:'instant_line',unit_index:n})),observed_at:f.now()});
 const refreshSessions=()=>{for(const actor of [{value:f.a,name:'operator'},{value:f.owner,name:'owner'},{value:f.reviewer,name:'reviewer'}]){actor.value.bearer=f.kernel.issueSession(f.a.tenant,f.a.store,actor.name);actor.value.scope=f.kernel.authenticate(actor.value.bearer);}};
 return {...f,source,sourceDb,sourceFilename,instant,startedAt,terms,termsInput,account,consent,obligationId,allocation,exchange,exchanges,request,fulfillmentSource,replacementCommand,authorize,received,refreshSessions,
  authorizeInput:(consentId='consent_one')=>({exchange_quote_id:exchange.id,exchange_quote_digest:exchange.digest,consent_id:consentId}),
  cleanup:()=>{fulfillmentDb.close();sourceDb.close();f.cleanup();}};
}
export async function usingInstant(fn:(f:Awaited<ReturnType<typeof instantFixture>>)=>unknown){const f=await instantFixture();try{return await fn(f);}finally{f.cleanup();}}
export async function authorizeMandate(f:any,consentId='consent_one',state='mandate_active'){const op=f.authorize(f.instant.quoteAuthorize(f.a.scope,f.authorizeInput(consentId)));assert.equal((await f.instant.dispatch(f.a.scope,op.id)).state,state);return op;}
export async function releaseReplacement(f:any,proof:any=null){const binding=(proof??f.instant.binding(f.a.scope,f.exchange.id)).instant_exchange,command=f.replacementCommand(binding);f.source.reserveReplacement(command,binding);const native=await f.fulfillmentSource.replace(command);f.source.confirmReplacement(command,binding,native);return native;}
