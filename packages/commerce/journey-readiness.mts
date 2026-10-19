import {exact,id,integer} from './kernel.mts';
import type {CommerceKernel,Scope,Row} from './kernel.mts';
import {contentDigest,jsonValue} from './configuration-values.mts';
import {ReadContext} from './read-context.mts';
import {Capabilities} from './capabilities.mts';
import {CaseConfigurations} from './case-configurations.mts';
import {ReturnIntake} from './return-intake.mts';
import {IntegrationReadiness,DRAFT_ACTION} from './integration-readiness.mts';
import {VariantExchanges} from './variant-exchanges.mts';
import {allocationContext} from './resolution-ledger.mts';
import {OrderEditWorkflow} from './order-edit-workflow.mts';
import {editSettings,editSnapshot,EDIT_ACTION} from './order-edit-core.mts';
import {ShoppingCart} from './shopping-cart.mts';
import {SupportTracking} from './support-tracking.mts';
import {SupportDelivery} from './support-delivery.mts';
import {SupportConversations} from './support-conversations.mts';
import {supportCase,assertSupportOwner,ownershipRow,documentRow} from './support-core.mts';
import {growthCustomerProof} from './growth-shopping-core.mts';
import {controlState} from './execution-stops.mts';
import {assertRecoveryEgress,assertNotErased} from './data-guards.mts';
import {email} from './customer-access.mts';

export type JourneyReadinessOptions={delivery?:SupportDelivery;edits?:OrderEditWorkflow;cart?:ShoppingCart};
type Status='available'|'disabled'|'needs_configuration'|'unsupported'|'temporarily_unavailable'|'unverified';
const ACTIONS=['tracking.read','return.refund.form','return.exchange.form','exchange.offers','order.edit.context','shopping.cart.context','followup.queue','remote.continue'];
const DISABLED=new Set(['ACTION_DISABLED','ACCESS_DENIED','OUTCOME_DISABLED','WITHDRAWN','RESTORE_EGRESS_BLOCKED','EDIT_INTEGRATION_NOT_READY']);
const CONFIGURATION=new Set(['EDIT_WORKFLOW_REQUIRED','SHOPPING_WORKFLOW_REQUIRED','DELIVERY_WORKFLOW_REQUIRED','ALLOCATION_REQUIRED','CART_REQUIRED','SENDER_REQUIRED','RETURN_NOT_CONFIGURED','CUSTOMER_VERIFICATION_REQUIRED','CONTACT_VERIFICATION_REQUIRED','CONFIGURATION_REPREVIEW_REQUIRED','CONFIGURATION_NOT_APPROVED','SUPPORT_CONFIGURATION_MISSING','CONSENT_REQUIRED']);
const UNSUPPORTED=new Set(['REMOTE_QUALIFICATION_MISSING','CHANNEL_UNQUALIFIED','REQUIRED_SCOPE_MISSING','MARKET_UNQUALIFIED','RESOURCE_CONTEXT_MISMATCH','OUTCOME_UNSUPPORTED','SESSION_SCOPE_LIMITED','UNKNOWN_ACTION','TRACKING_UNSUPPORTED']);
const TEMPORARY=new Set(['EXECUTION_STOPPED','TRACKING_UNAVAILABLE','SOURCE_STALE','SENDER_UNAVAILABLE','EDIT_SOURCE_STALE','EDIT_READINESS_CHANGED','SHOPPING_PREVIEW_CHANGED','SHOPPING_RECONCILIATION_REQUIRED','EDIT_RECONCILIATION_REQUIRED','EXCHANGE_RECONCILIATION_REQUIRED','EXCHANGE_OFFERS_UNAVAILABLE']);
function classify(reason:string):Status {
  return DISABLED.has(reason)?'disabled':CONFIGURATION.has(reason)?'needs_configuration':UNSUPPORTED.has(reason)?'unsupported':TEMPORARY.has(reason)?'temporarily_unavailable':'unverified';
}
function fail(reason:string):never {throw new Error(reason);}
function alternatives(reason:string) {
  if(reason==='CUSTOMER_VERIFICATION_REQUIRED'||reason==='CONTACT_VERIFICATION_REQUIRED')return ['reverify_customer','request_human_review'];
  if(TEMPORARY.has(reason))return ['refresh_source','request_human_review'];
  return ['request_human_review'];
}

/** Current named-step projection. Native owners keep all execution authority. */
export class JourneyReadiness {
  readonly k:CommerceKernel;readonly reads:ReadContext;readonly owners:JourneyReadinessOptions;
  constructor(k:CommerceKernel,reads:ReadContext,options:JourneyReadinessOptions={}) {
    if(!(reads instanceof ReadContext)||Object.keys(options).some(key=>!['delivery','edits','cart'].includes(key))||
      options.delivery&&(!(options.delivery instanceof SupportDelivery)||options.delivery.k!==k||options.delivery.tracking.reads!==reads)||
      options.edits&&(!(options.edits instanceof OrderEditWorkflow)||options.edits.kernel!==k)||
      options.cart&&(!(options.cart instanceof ShoppingCart)||options.cart.kernel!==k))throw new Error('JOURNEY_OWNER_MISMATCH');
    this.k=k;this.reads=reads;this.owners=Object.freeze({...options});
  }
  inspect(scope:Scope,input:unknown) {
    const p=exact(jsonValue(input,32768),['case_id','link_id','expected_generation','allocation_id','cart_id','sender_id']);
    id(p.case_id);id(p.link_id);integer(p.expected_generation,1);
    for(const key of ['allocation_id','cart_id','sender_id'])if(p[key]!==null)id(p[key]);
    const k=this.k,{s,c}=supportCase(k,scope,p.case_id);k.authorize(scope,'capability.read');
    const owner=ownershipRow(k,s,c.id);
    if(!owner||owner.generation!==p.expected_generation)throw new Error('SUPPORT_OWNERSHIP_CHANGED');
    if(s.role==='customer')growthCustomerProof(k,s,c.resource_id,c.customer_id);
    else assertSupportOwner(k,scope,c.id,p.expected_generation);
    const link=new SupportConversations(k).linkRecord(scope,p.link_id);
    if(link.case_id!==c.id||link.resource_id!==c.resource_id||link.customer_id!==c.customer_id)throw new Error('JOURNEY_LINK_MISMATCH');
    const cases=new CaseConfigurations(k),tracking=new SupportTracking(k,this.reads);
    const registry=()=>{
      if(c.order.source_system!=='synthetic')return {owner:'native_case_configuration',platform:c.order.source_system,production_qualified:false};
      const cap=new Capabilities(k).evaluate(scope,'order.read',c.resource_id);
      if(!cap.available)fail(cap.reason);return cap;
    };
    const stopped=(action:string)=>{if(controlState(k,s,action).stopped)fail('EXECUTION_STOPPED');};
    const fresh=()=>{
      if(c.order.observed_at>k.clock()||c.order.observed_at+c.pins.composition.effective['data.max_age_seconds']*1000<k.clock())fail('SOURCE_STALE');
    };
    const proof=()=>{
      cases.verified(scope,c.id);
      const original=k.db.prepare('SELECT ss.* FROM commerce_cases c JOIN commerce_sessions ss ON ss.token_hash=c.verification_hash WHERE c.tenant_id=? AND c.store_id=? AND c.id=?').get(s.tenant_id,s.store_id,c.id) as Row;
      if(!original)fail('CUSTOMER_VERIFICATION_REQUIRED');growthCustomerProof(k,original,c.resource_id,c.customer_id);
    };
    const project=(action:string,stage:string,permission:string|null,read:()=>{reason:string;evidence:unknown;alternatives?:string[]})=>{
      try {
        if(permission)k.authorize(scope,permission,c.resource_id);
        const value=read();
        return {action,stage,status:'available',available:true,reason:value.reason,alternatives:value.alternatives??[],evidence_digest:contentDigest(value.evidence),execution_authorized:false,production_qualified:false};
      }catch(error) {
        const message=error instanceof Error?error.message:'';
        const reason=/^[A-Z][A-Z0-9_]{1,95}$/.test(message)?message:'HANDLER_UNVERIFIED';
        return {action,stage,status:classify(reason),available:false,reason,alternatives:alternatives(reason),evidence_digest:null,execution_authorized:false,production_qualified:false};
      }
    };
    const forms=(outcome:string)=>{
      cases.resume(scope,c.id);proof();
      const form=new ReturnIntake(k).form(scope,c.id);
      if(!form.outcomes.includes(outcome))fail('OUTCOME_DISABLED');
      registry();fresh();stopped('diagnostic.return.submit');
      const ready=new IntegrationReadiness(k).inspect(scope,DRAFT_ACTION);
      if(!ready.ready)fail(ready.reasons.includes('ACTION_DISABLED')?'ACTION_DISABLED':ready.reasons[0]);
      const approved=k.db.prepare('SELECT profile_id,policy_id FROM commerce_execution_settings WHERE tenant_id=? AND store_id=?').get(s.tenant_id,s.store_id) as Row;
      if(approved?.profile_id!==c.pins.profile.id||approved?.policy_id!==c.pins.policy.policy_id)fail('CONFIGURATION_NOT_APPROVED');
      return {reason:'LOCAL_FORM_AVAILABLE',evidence:{form,ready,source_version:c.order.source_version}};
    };
    const actions=[
      project(ACTIONS[0],'inspect_current_tracking','support.read',()=>{
        const cap=registry(),view=tracking.read(scope,c.id);
        if(view.status!=='available')fail(view.status==='unsupported'?'TRACKING_UNSUPPORTED':'TRACKING_UNAVAILABLE');
        return {reason:'SYNTHETIC_READ_ONLY',evidence:{cap,view}};
      }),
      project(ACTIONS[1],'inspect_refund_form','return.read',()=>forms('refund')),
      project(ACTIONS[2],'inspect_exchange_form','return.read',()=>forms('exchange')),
      project(ACTIONS[3],'browse_existing_allocation','action.propose',()=>{
        if(p.allocation_id===null)fail('ALLOCATION_REQUIRED');
        const allocation=allocationContext(k,scope,p.allocation_id);
        if(allocation.c.id!==c.id||allocation.c.resource_id!==c.resource_id)fail('JOURNEY_REFERENCE_MISMATCH');
        cases.resume(scope,c.id);proof();registry();fresh();stopped('diagnostic.return.resolve');
        if(k.db.prepare("SELECT 1 FROM commerce_resolution_operations WHERE tenant_id=? AND store_id=? AND resource_id=? AND state='unknown'").get(s.tenant_id,s.store_id,c.resource_id))fail('EXCHANGE_RECONCILIATION_REQUIRED');
        const offers=new VariantExchanges(k).browse(scope,{allocation_id:p.allocation_id});
        if(!offers.offers.length)fail('EXCHANGE_OFFERS_UNAVAILABLE');
        return {reason:'LOCAL_OFFERS_AVAILABLE',evidence:{allocation_id:p.allocation_id,offers}};
      }),
      project(ACTIONS[4],'inspect_existing_edit_workflow','case.read',()=>{
        const workflow=this.owners.edits;if(!workflow)fail('EDIT_WORKFLOW_REQUIRED');
        cases.resume(scope,c.id);registry();stopped(EDIT_ACTION);
        const exists=k.db.prepare('SELECT 1 FROM commerce_edit_workflow_pins WHERE tenant_id=? AND store_id=? AND case_id=?').get(s.tenant_id,s.store_id,c.id);
        if(!exists)fail('EDIT_WORKFLOW_REQUIRED');
        const settings=editSettings(k,s),snapshot=editSnapshot(k,s,c.resource_id,settings),source=workflow.edits.source;
        if(!source||source.tenant!==s.tenant_id||source.store!==s.store_id||source.identity!==settings.source_identity)fail('EDIT_SOURCE_UNQUALIFIED');
        if(source.revision()!==settings.source_revision)fail('EDIT_READINESS_CHANGED');
        source.assertConnectorReadiness(settings.warehouses,settings.readiness.warehouses);
        if(contentDigest(source.snapshot(c.resource_id))!==snapshot.digest)fail('EDIT_SOURCE_STALE');
        const view=workflow.status(scope,{case_id:c.id});if(view.reason)fail(view.reason);
        if(view.handoff_required)fail('EDIT_RECONCILIATION_REQUIRED');
        return {reason:'LOCAL_EDIT_CONTEXT_AVAILABLE',evidence:{settings_digest:settings.digest,snapshot_digest:snapshot.digest,view}};
      }),
      project(ACTIONS[5],'inspect_existing_cart','resource.read',()=>{
        const cart=this.owners.cart;if(!cart)fail('SHOPPING_WORKFLOW_REQUIRED');
        if(p.cart_id===null)fail('CART_REQUIRED');registry();stopped(EDIT_ACTION);
        const view=cart.readCart(scope,p.cart_id);
        if(view.resource_id!==c.resource_id||view.subject_id!==c.customer_id)fail('JOURNEY_REFERENCE_MISMATCH');
        const preview=cart.currentPreview(scope,p.cart_id);
        if(preview.requires_new_proposal)fail('SHOPPING_PREVIEW_CHANGED');
        if(view.state==='unknown')fail('SHOPPING_RECONCILIATION_REQUIRED');
        return {reason:'LOCAL_CART_CONTEXT_AVAILABLE',evidence:{view,preview}};
      }),
      project(ACTIONS[6],'queue_transactional_tracking','support.send',()=>{
        const delivery=this.owners.delivery;if(!delivery)fail('DELIVERY_WORKFLOW_REQUIRED');
        if(p.sender_id===null)fail('SENDER_REQUIRED');
        assertRecoveryEgress(k);stopped('customer.message');
        if(link.channel!=='email')fail('CHANNEL_UNQUALIFIED');
        const sender=documentRow(k,s,'sender',p.sender_id);
        if(sender.state!=='active'||sender.expires_at===null||sender.expires_at<=k.clock())fail('SENDER_UNAVAILABLE');
        const source=delivery.sources.get(sender.body.source_identity);
        if(!source||source.tenant!==s.tenant_id||source.store!==s.store_id||source.account!==sender.body.account_id||source.contract!==sender.body.source_contract)fail('SUPPORT_SOURCE_UNAVAILABLE');
        const contact=k.db.prepare('SELECT * FROM commerce_support_contacts WHERE tenant_id=? AND store_id=? AND link_id=? AND erased=0').get(s.tenant_id,s.store_id,link.id) as Row;
        const customer=k.db.prepare("SELECT * FROM commerce_resources WHERE tenant_id=? AND store_id=? AND kind='customer' AND source_system=? AND external_id=?").get(s.tenant_id,s.store_id,c.order.source_system,c.customer_id) as Row;
        if(!contact?.address||contentDigest(contact.address)!==contact.address_digest||!customer)fail('CONTACT_VERIFICATION_REQUIRED');
        assertNotErased(k,s,customer.id,c.customer_id);
        let currentAddress:string;try{currentAddress=email(JSON.parse(customer.payload).email);}catch{fail('CONTACT_VERIFICATION_REQUIRED');}
        if(contact.address!==currentAddress)fail('CONTACT_VERIFICATION_REQUIRED');
        const consent=delivery.consent.eligibility(scope,c.id,p.sender_id,link.channel,'transactional');if(!consent.allowed)fail(consent.reason);
        registry();const view=delivery.tracking.read(scope,c.id);if(view.status!=='available')fail('TRACKING_UNAVAILABLE');
        return {reason:consent.reason,evidence:{sender:sender.digest,contact_revision:contact.revision,consent,source_digest:view.source_digest}};
      }),
      project(ACTIONS[7],'independent_remote_continuation',null,()=>fail('REMOTE_QUALIFICATION_MISSING')),
    ];
    for(const index of [1,2])if(actions[index].reason==='OUTCOME_DISABLED'){
      const other=actions[index===1?2:1];if(other.available)actions[index].alternatives.unshift(other.action);
    }
    const body={schema_version:1,case_id:c.id,resource_id:c.resource_id,configuration_digest:c.configuration_digest,ownership_generation:owner.generation,
      channel:link.channel,history:{status:link.history,source_revision:link.source_revision,missing_history_is_explicit:true},
      caller:{role:s.role,kind:k.workerIdentity(scope)?.kind??(s.role==='agent'?'built_in_agent':s.role==='customer'?'verified_customer':'manual'),execution_qualification:'native_handler_required'},
      actions,model_thread_required:false,execution_authorized:false,production_qualified:false};
    return {...body,context_digest:contentDigest(body)};
  }
}
