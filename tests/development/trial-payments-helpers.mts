import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { returnFixture } from './return-intake-helpers.mts';
import { installPartnerReadiness } from './partner-services-helpers.mts';
import { DeliveryTrials } from '../../packages/commerce/delivery-trials.mts';
import { InstantExchangeFixtureSource } from '../../packages/adapters/instant-exchange-fixture-source.mts';
import { WarehouseFixtureSource } from '../../packages/adapters/warehouse-fixture-source.mts';
import { NativeReturns } from '../../packages/commerce/native-returns.mts';
import { ShopifyReturnFixtureAdapter } from '../../packages/adapters/shopify-return-fixture.mts';
import { contentDigest } from '../../packages/commerce/configuration-values.mts';

export const oracle=JSON.parse(readFileSync(new URL('../fixtures/delivery-trials/independent-values.json',import.meta.url),'utf8'));
export const trialTables=['commerce_trial_terms','commerce_trial_term_approvals','commerce_delivery_trials','commerce_trial_consents','commerce_trial_events'];
export const trialSubjectTables=['commerce_delivery_trials','commerce_trial_consents','commerce_trial_events'];
export const captureCount=(f:any)=>f.source.db.prepare('SELECT count(*) n FROM fixture_instant_captures').get().n;
export function trialFixture(){
 const f=returnFixture(),startedAt=f.now(),order=f.order();
 f.kernel.ingest(f.a.scope,{kind:'order',source_system:'synthetic',external_id:order.external_id,source_version:order.source_version+1,source_updated_at:f.now(),customer_id:order.customer_id,payload:{...order.payload,total_minor:'3000',return_lines:[{id:'trial_line',fulfillment_line_id:'gid://shopify/FulfillmentLineItem/781',ordered:3,fulfilled:3,returned:0,unit_minor:'1000',tags:[]}]}});
 f.cases.create(f.customer,{case_id:'delivery_trial_case',resource_id:f.order().id,profile_id:'default',policy_id:'returns'});
 const sourceFilename=join(f.directory,'delivery-trial-source.sqlite'),sourceDb=new DatabaseSync(sourceFilename),source=new InstantExchangeFixtureSource(sourceDb,{mode:'fixture',tenant:f.a.tenant,store:f.a.store,identity:'delivery-trial-source',clock:f.now});
 const warehouseDb=new DatabaseSync(join(f.directory,'trial-warehouse.sqlite')),warehouse=new WarehouseFixtureSource(warehouseDb,{mode:'fixture',tenant:f.a.tenant,store:f.a.store,identity:'trial-warehouse'});warehouse.seed('shirt-small','trial-warehouse',10);
 const trials=new DeliveryTrials(f.kernel,source,warehouse),facts=trials.facts,instant=trials.instant;
 const account={account_id:'trial-account',revision:1,currency:'USD',mandates:true,bounded_capture:true,reauthorization:true,authoritative_lookup:true,atomic_return_capture:true,contract_ref:'synthetic_trial_contract',verified_at:f.now(),expires_at:f.now()+3600000};source.qualifyAccount(account);
 const windowInput={account_id:'trial-account',expected_revision:0,authorization_duration_ms:oracle.authorization_duration_ms,observed_at:f.now(),expires_at:f.now()+3600000,contract_ref:'synthetic_duration_observation'};facts.qualifyWindow(windowInput);
 facts.seedOrder({resource_id:f.order().id,customer_id:f.order().customer_id,native_original_order_id:f.order().payload.native_order_id,currency:'USD',units:oracle.units,created_at:f.now()});
 const context={service:'trial_payments',account_id:'trial-account',source_identity:source.identity,source_config_digest:facts.configuration('trial-account').digest,region:'US_TEST',capability:'authorization'};
 const readiness=installPartnerReadiness(f.kernel,f.owner.scope,f.reviewer.scope,context,{expires_at:f.now()+3600000,capabilities:['authorization','reauthorization','capture','cancel']}).readiness;
 const terms=trials.terms(f.owner.scope,{terms_id:'delivery-trial-terms',expected_version:0,account_id:'trial-account',region:'US_TEST',notice:'Synthetic trial terms: a verified complete delivery starts sixty seconds. Corrections can extend but never shorten the clock. Only the stated original retained unit obligations may be captured once, within the processor authorization and the explicitly consented maximum. Partial or uncertain receipts require reconciliation.',currency:'USD',maximum_minor:'3000',trial_ms:oracle.trial_ms,delivery_window_ms:oracle.delivery_window_ms,return_grace_ms:oracle.return_grace_ms,maximum_extension_ms:oracle.maximum_extension_ms,expires_at:f.now()+3600000});
 trials.approveTerms(f.reviewer.scope,{terms_id:terms.id,version:terms.version,terms_digest:terms.digest,approval_id:'trial-terms-review',expires_at:f.now()+3600000});
 const trial=trials.create(f.a.scope,{trial_id:'delivery-trial-one',case_id:'delivery_trial_case',terms_id:terms.id,terms_digest:terms.digest}),binding=trial.body.binding,obligationId=binding.obligation_id;
 const consent=trials.consent(f.customer,{trial_id:trial.id,consent_id:'trial-consent-one',terms_digest:terms.digest,maximum_minor:'3000',confirmed:true,extension_ms:0,reauthorization_of:null});
 instant.configure(f.owner.scope,{enabled:true,expected_revision:0,source_identity:source.identity,account_id:'trial-account',expires_at:f.now()+3600000});
 const approve=(quote:any)=>{const preview=f.gateway.prepare(f.a.scope,quote.proposal),approval=f.gateway.approve(f.reviewer.scope,{preview_id:preview.id,preview_digest:preview.digest}),receipt=f.gateway.execute(f.a.scope,{preview_id:preview.id,preview_digest:preview.digest,approval_id:approval.id});return {id:receipt.instant_operation_id,preview,approval,receipt};};
 const authorize=async()=>{const op=approve(instant.quoteAuthorize(f.a.scope,{trial_id:trial.id,consent_id:consent.id}));assert.equal((await instant.dispatch(f.a.scope,op.id)).state,'mandate_active');return op;};
 const delivery=(patch:any={})=>{const previous=source.db.prepare('SELECT * FROM fixture_trial_deliveries WHERE trial_id=? ORDER BY sequence DESC LIMIT 1').get(trial.id);return facts.delivery({event_id:'trial-delivery-'+((previous?.sequence??0)+1),trial_id:trial.id,resource_id:f.order().id,native_original_order_id:f.order().payload.native_order_id,sequence:(previous?.sequence??0)+1,correction_of:previous?.event_id??null,delivered_at:f.now(),observed_at:f.now(),complete:true,...patch});};
 let request:any=null;
 const returned=async(numbers:number[],complete=true)=>{
  if(!request){
   f.cases.create(f.customer,{case_id:'trial_return_case',resource_id:f.order().id,profile_id:'default',policy_id:'returns'});
   const q=f.intake.evaluate(f.customer,{case_id:'trial_return_case',lines:[{line_id:'trial_line',quantity:numbers.length}],outcome:'refund',reason:'size',note:'',evidence_ids:[]});request=f.intake.prepare(f.customer,{quote_id:q.id,quote_digest:q.digest,request_key:'trial-native-return',override_id:null});f.submit(request);
   const adapter=new ShopifyReturnFixtureAdapter({mode:'fixture',identity:'trial-return-source',tenant:f.a.tenant,store:f.a.store,transport:async({variables})=>({status:200,api_version:'2026-10',body:{data:{returnCreate:{userErrors:[],return:{id:'gid://shopify/Return/780',status:'OPEN',order:{id:variables.returnInput.orderId},returnLineItems:{nodes:variables.returnInput.returnLineItems.map((line:any,index:number)=>({id:'gid://shopify/ReturnLineItem/'+(781+index),quantity:line.quantity,returnReasonNote:line.returnReasonNote,fulfillmentLineItem:{id:line.fulfillmentLineItemId}})),pageInfo:{hasNextPage:false}},reverseFulfillmentOrders:{nodes:[{id:'gid://shopify/ReverseFulfillmentOrder/780'}],pageInfo:{hasNextPage:false}}}}}}})});
   await new NativeReturns(f.kernel,adapter).create(f.a.scope,request.id);
   trials.linkReturn(f.a.scope,{trial_id:trial.id,request_id:request.id,warehouse_source_identity:warehouse.identity});
  }
  const events=warehouse.returnEvents('gid://shopify/Return/780'),sequence=events.length+1;
  return warehouse.recordReturnEvent({event_id:'trial-warehouse-event-'+sequence,request_id:request.id,resource_id:f.order().id,native_return_id:'gid://shopify/Return/780',sequence,kind:sequence===1?'receipt':'inspection',location_id:'trial-warehouse',operator_id:'synthetic_receiver',evidence_ids:['synthetic_receipt'],completeness:complete?'complete':'partial',parent_event_id:events.at(-1)?.event_id??null,units:numbers.map(number=>({line_id:'trial_line',ordinal:number,variant_id:'shirt-small',grade:'sellable',received:true,disposition:null}))});
 };
 return {...f,k:f.kernel,db:f.kernel.db,source,sourceDb,sourceFilename,warehouse,warehouseDb,trials,facts,instant,account,windowInput,readiness,terms,trial,binding,obligationId,consent,startedAt,approve,authorize,delivery,returned,cleanup:()=>{warehouseDb.close();sourceDb.close();f.cleanup();}};
}
export async function usingTrials(fn:(f:ReturnType<typeof trialFixture>)=>unknown){const f=trialFixture();try{return await fn(f);}finally{f.cleanup();}}
export async function populateTrialPrivacy(f:ReturnType<typeof trialFixture>){
 f.source.fault='after';const op=f.approve(f.instant.quoteAuthorize(f.a.scope,{trial_id:f.trial.id,consent_id:f.consent.id}));assert.equal((await f.instant.dispatch(f.a.scope,op.id)).state,'unknown');
 f.advance(1000);const delivery=f.delivery();f.trials.observeDelivery(f.a.scope,{trial_id:f.trial.id,event_id:delivery.event_id});await f.returned([1],true);
 return {trial_id:f.trial.id,customer_id:f.order().customer_id,resource_id:f.order().id,tables:trialTables,subject_tables:trialSubjectTables,unknown_operations:[{table:'commerce_instant_operations',id:op.id,operation_id:op.id,source_identity:f.source.identity}],operation_id:op.id,obligation_id:f.obligationId,source_identity:f.source.identity};
}
