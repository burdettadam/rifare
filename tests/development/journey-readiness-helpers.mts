import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {returnFixture} from './return-intake-helpers.mts';
import {shoppingFixture} from './growth-shopping-helpers.mts';
import {installEditSkill} from './order-edit-helpers.mts';
import {resolutionFixture} from './resolution-helpers.mts';
import {verifiedCustomer,updateResource} from './shopper-memory-helpers.mts';
import {JourneyReadiness} from '../../packages/commerce/journey-readiness.mts';
import {SupportConversations} from '../../packages/commerce/support-conversations.mts';
import {SupportOwnership} from '../../packages/commerce/support-core.mts';
import {SupportConsent} from '../../packages/commerce/support-consent.mts';
import {SupportTracking} from '../../packages/commerce/support-tracking.mts';
import {SupportDelivery} from '../../packages/commerce/support-delivery.mts';
import {SupportFixtureSource} from '../../packages/adapters/support-fixture-source.mts';
import {ReturnIntake} from '../../packages/commerce/return-intake.mts';
import {ActionGateway} from '../../packages/commerce/action-gateway.mts';
export {verifiedCustomer,updateResource};
export type Value=Record<string,any>;
export const ACTIONS=['tracking.read','return.refund.form','return.exchange.form','exchange.offers','order.edit.context','shopping.cart.context','followup.queue','remote.continue'];
export const CONTEXT_FIELDS=['schema_version','case_id','resource_id','configuration_digest','ownership_generation','channel','history','caller','actions','context_digest','model_thread_required','execution_authorized','production_qualified'].sort();
export const ROW_FIELDS=['action','stage','status','available','reason','alternatives','evidence_digest','execution_authorized','production_qualified'].sort();
export const row=(view:Value,action:string):Value=>{const result=view.actions.find((r:Value)=>r.action===action);if(!result)throw new Error('EXPECTED_ACTION_ABSENT:'+action);return result;};
export const input=(f:any,extra:Value={})=>({case_id:f.caseId??'case_one',link_id:f.link.id,expected_generation:1,allocation_id:null,cart_id:null,sender_id:'sender_one',...extra});
export const inspect=(f:any,extra:Value={},scope=f.a.scope)=>f.readiness.inspect(scope,input(f,extra));
export function attachSupport(f:any,options:any={}){
  const store=options.store??f.a,caseId=options.caseId??'case_one',customer=options.customer??f.customer,owner=options.owner??f.owner.scope;
  const supportDb=new DatabaseSync(join(f.directory,'journey-support-'+store.store+'-'+caseId+'.sqlite'));
  try{
    const supportSource=new SupportFixtureSource(supportDb,store.tenant,store.store,'merchant_mail',f.now),conversations=new SupportConversations(f.kernel),ownership=new SupportOwnership(f.kernel),consent=new SupportConsent(f.kernel),tracking=new SupportTracking(f.kernel,f.reads),delivery=new SupportDelivery(f.kernel,tracking,[supportSource]);
    const link=conversations.link(store.scope,customer,{case_id:caseId,channel:'email',account_id:supportSource.account,external_id:'thread_one',history:'partial',source_revision:1});
    const senderInput={id:'sender_one',expected_revision:0,channel:'email',address:'support@example.invalid',account_id:supportSource.account,source_identity:supportSource.identity,source_contract:supportSource.contract,expires_at:f.now()+3600000,jurisdiction:'US_TEST',transactional_basis:'order_service'};
    consent.configureSender(owner,senderInput);
    const c=f.kernel.get(store.scope,link.resource_id),source=f.kernel.lookup(store.scope,'customer','synthetic',c.customer_id);
    consent.verifyContact(store.scope,customer,{link_id:link.id,address:source.payload.email});
    const message=(extra:Value={})=>({case_id:caseId,link_id:link.id,sender_id:'sender_one',template_id:'tracking_status_v1',event_id:'journey_event_one',expected_generation:1,...extra});
    return {supportDb,supportSource,conversations,ownership,consent,tracking,delivery,link,senderInput,caseId,message,closeSupport:()=>supportDb.close()};
  }catch(error){supportDb.close();throw error;}
}
export async function usingReadiness(fn:(f:any)=>unknown){
  const f=returnFixture();let support:ReturnType<typeof attachSupport>|undefined;
  try{support=attachSupport(f);const readiness=new JourneyReadiness(f.kernel,f.reads,{delivery:support.delivery});return await fn({...f,...support,readiness});}
  finally{support?.closeSupport();f.cleanup();}
}
export async function usingShoppingReadiness(fn:(f:any)=>unknown){
  const f=shoppingFixture();let support:ReturnType<typeof attachSupport>|undefined;
  try{support=attachSupport(f);const {workflow}=installEditSkill(f),readiness=new JourneyReadiness(f.kernel,f.reads,{delivery:support.delivery,edits:workflow,cart:f.carts});return await fn({...f,...support,workflow,readiness});}
  finally{support?.closeSupport();f.cleanup();}
}
export async function usingExchangeReadiness(fn:(f:any)=>unknown){
  const f=await resolutionFixture({zeroFees:true});let support:ReturnType<typeof attachSupport>|undefined;
  try{support=attachSupport(f,{caseId:'resolution_case'});f.catalog();f.allocate();
    const allocation=f.db.prepare("SELECT id FROM commerce_resolution_allocations WHERE tenant_id=? AND store_id=? AND case_id='resolution_case' AND outcome='exchange'").get(f.a.tenant,f.a.store) as Value;
    const readiness=new JourneyReadiness(f.kernel,f.reads,{delivery:support.delivery});return await fn({...f,...support,allocation,readiness});}
  finally{support?.closeSupport();f.cleanup();}
}
export function otherMerchant(f:any){
  const store=f.c;f.kernel.provisionMember(store.tenant,store.store,'journey_owner','owner');f.kernel.provisionMember(store.tenant,store.store,'journey_reviewer','reviewer');
  const owner=f.kernel.authenticate(f.kernel.issueSession(store.tenant,store.store,'journey_owner')),reviewer=f.kernel.authenticate(f.kernel.issueSession(store.tenant,store.store,'journey_reviewer'));
  const p=f.policies.create(store.scope,f.input({rules:{window_days:30,require_evidence:false,excluded_tags:['final-sale'],outcomes:['refund']}}));
  f.policies.test(store.scope,p.policy_id,p.version,p.digest);f.policies.review(reviewer,p.policy_id,p.version,p.digest);
  f.policies.publish(owner,{policy_id:p.policy_id,version:p.version,digest:p.digest,expected_published_version:0,effective_at:f.now()});
  f.reads.profiles.put(store.scope,f.profile(store,{tone:'warm'}));
  const gateway=new ActionGateway(f.kernel);gateway.configure(owner,{enabled:true,expected_revision:0,profile_id:'default',policy_id:'returns'});
  const old=f.order(store);updateResource(f,old,{...old.payload,return_lines:f.lines,delivered_at:f.now()-3*86400000,evidence_verified:true,native_order_id:'gid://shopify/Order/301',counted_return_ids:[]},old.customer_id,store.scope);
  const customer=verifiedCustomer(f,store);f.cases.create(customer.scope,{case_id:'case_one',resource_id:customer.order.id,profile_id:'default',policy_id:'returns'});
  const intake=new ReturnIntake(f.kernel);intake.configure(owner,{expected_revision:0,settings:{...f.settings,brand:'Second synthetic merchant'}});
  const support=attachSupport(f,{store,caseId:'case_one',customer:customer.scope,owner}),readiness=new JourneyReadiness(f.kernel,f.reads,{delivery:support.delivery});
  return {...support,store,owner,customer,readiness};
}
const EFFECT_TABLES=['commerce_cases','commerce_case_configurations','commerce_action_previews','commerce_action_approvals','commerce_action_receipts','commerce_return_quotes','commerce_return_requests','commerce_exchange_quotes','commerce_edit_inputs','commerce_edit_quotes','commerce_edit_workflow_pins','commerce_order_edits','commerce_shopping_carts','commerce_support_documents','commerce_support_contacts','commerce_support_consent','commerce_support_consent_events','commerce_support_rule_jobs','commerce_support_deliveries','commerce_operations','commerce_operation_work','commerce_operation_receipts','commerce_model_reservations','commerce_assistance_receipts'];
export function effects(f:any){
  return Object.fromEntries(EFFECT_TABLES.map(table=>[table,f.db.prepare('SELECT * FROM '+table).all().map((r:Value)=>JSON.stringify(r)).sort()]));
}
export const count=(db:DatabaseSync,table:string)=>Number((db.prepare('SELECT count(*) n FROM '+table).get() as Value).n);
