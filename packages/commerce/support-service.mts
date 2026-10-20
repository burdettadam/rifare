import type {CommerceKernel,Scope,Row} from './kernel.mts';import {exact,id,integer}from'./kernel.mts';
import type{ReadContext}from'./read-context.mts';import type{ReadRunner}from'../agent/runner.mts';import type{SupportSource}from'../adapters/support-fixture-source.mts';import type{SupportProviderRouting}from'./support-provider-routing.mts';
import{SupportConversations}from'./support-conversations.mts';import{SupportConsent}from'./support-consent.mts';import{SupportTracking}from'./support-tracking.mts';import{SupportOwnership,supportCase}from'./support-core.mts';import{SupportDelivery}from'./support-delivery.mts';import{SupportRules}from'./support-rules.mts';import{SupportMetrics}from'./support-metrics.mts';import{SupportInsights}from'./support-insights.mts';import{SupportQualification}from'./support-qualification.mts';import{SupportWorkflows}from'./support-workflows.mts';import{SupportBranding}from'./support-branding.mts';import type{SupportHelpdesk}from'./support-helpdesk.mts';
import type{RefundMessageReader}from'./support-delivery.mts';
import{JourneyReadiness}from'./journey-readiness.mts';import type{JourneyReadinessOptions}from'./journey-readiness.mts';
import{ShopperMemory}from'./shopper-memory.mts';import{jsonValue}from'./configuration-values.mts';
import{CommerceJourneys}from'./commerce-journeys.mts';import type{JourneyOwners}from'./commerce-journeys.mts';
import{JourneyFollowups}from'./journey-followups.mts';
import{LoyaltyBalances}from'./loyalty-balances.mts';
import{LoyaltyAccrual}from'./loyalty-accrual.mts';
import{LoyaltyRedemptions,assertLoyaltyRedemptionOwner}from'./loyalty-redemptions.mts';
import{LoyaltyIncentives}from'./loyalty-incentives.mts';
import{LoyaltyLifecycle}from'./loyalty-lifecycle.mts';
export class SupportService {
 readonly k:CommerceKernel;readonly reads:ReadContext;readonly conversations:SupportConversations;readonly ownership:SupportOwnership;readonly consent:SupportConsent;readonly tracking:SupportTracking;readonly delivery:SupportDelivery;readonly rules:SupportRules;readonly metrics:SupportMetrics;readonly insights:SupportInsights;readonly qualification:SupportQualification;readonly workflows:SupportWorkflows;readonly branding:SupportBranding;
 readonly routing:SupportProviderRouting|null;readonly runner:ReadRunner|null;readonly helpdesk:SupportHelpdesk|null;
 readonly memory:ShopperMemory;readonly readiness:JourneyReadiness;readonly journeys:CommerceJourneys;readonly followups:JourneyFollowups;readonly loyalty:LoyaltyBalances;readonly loyaltyAccrual:LoyaltyAccrual|null;readonly loyaltyRedemptions:LoyaltyRedemptions|null;
 readonly loyaltyIncentives:LoyaltyIncentives|null;readonly loyaltyLifecycle:LoyaltyLifecycle|null;
 constructor(k:CommerceKernel,reads:ReadContext,options:{sources?:SupportSource[];routing?:SupportProviderRouting;runner?:ReadRunner;helpdesk?:SupportHelpdesk;refunds?:RefundMessageReader;journey?:Omit<JourneyReadinessOptions,'delivery'>;journeys?:Omit<JourneyOwners,'delivery'>;loyalty?:LoyaltyBalances;loyaltyAccrual?:LoyaltyAccrual;loyaltyRedemptions?:LoyaltyRedemptions;loyaltyIncentives?:LoyaltyIncentives;loyaltyLifecycle?:LoyaltyLifecycle}={}){
  if(options.loyalty!==undefined&&(!(options.loyalty instanceof LoyaltyBalances)||options.loyalty.k!==k))throw new Error('LOYALTY_SOURCE_OWNER_MISMATCH');
  this.loyalty=options.loyalty??new LoyaltyBalances(k);
  if(options.loyaltyAccrual!==undefined&&(!(options.loyaltyAccrual instanceof LoyaltyAccrual)||options.loyaltyAccrual.k!==k||options.loyaltyAccrual.balances!==this.loyalty))throw new Error('LOYALTY_SOURCE_OWNER_MISMATCH');
  this.loyaltyAccrual=options.loyaltyAccrual??null;
  this.loyaltyRedemptions=options.loyaltyRedemptions===undefined?null:assertLoyaltyRedemptionOwner(k,options.loyaltyRedemptions);
  if(this.loyaltyRedemptions&&this.loyaltyRedemptions.balances!==this.loyalty)throw new Error('LOYALTY_SOURCE_OWNER_MISMATCH');
  if(options.loyaltyIncentives!==undefined&&(!(options.loyaltyIncentives instanceof LoyaltyIncentives)||options.loyaltyIncentives.k!==k||options.loyaltyIncentives.redemptions!==this.loyaltyRedemptions))throw new Error('LOYALTY_SOURCE_OWNER_MISMATCH');
  this.loyaltyIncentives=options.loyaltyIncentives??null;
  if(options.loyaltyLifecycle!==undefined&&(!(options.loyaltyLifecycle instanceof LoyaltyLifecycle)||options.loyaltyLifecycle.k!==k||options.loyaltyLifecycle.accrual!==this.loyaltyAccrual||options.loyaltyLifecycle.redemptions!==this.loyaltyRedemptions||options.loyaltyLifecycle.incentives!==this.loyaltyIncentives))throw new Error('LOYALTY_SOURCE_OWNER_MISMATCH');
  this.loyaltyLifecycle=options.loyaltyLifecycle??null;
  const supplied=options.journeys??{},ownerDescriptors=Object.getOwnPropertyDescriptors(supplied),journeyOwners:Row={};
  for(const key of Reflect.ownKeys(ownerDescriptors)){const d=Object.getOwnPropertyDescriptor(supplied,key)!;if(typeof key!=='string'||!['cart','resolution','edits','fulfillment'].includes(key)||!Object.hasOwn(d,'value'))throw new Error('JOURNEY_FOLLOWUP_OWNER_MISMATCH');journeyOwners[key]=d.value;}
  this.k=k;this.reads=reads;this.conversations=new SupportConversations(k);this.ownership=new SupportOwnership(k);this.consent=new SupportConsent(k);this.tracking=new SupportTracking(k,reads);this.delivery=new SupportDelivery(k,this.tracking,options.sources??[],options.refunds??null,null,{cart:journeyOwners.cart,resolution:journeyOwners.resolution,edits:journeyOwners.edits});this.rules=new SupportRules(k,this.delivery);this.metrics=new SupportMetrics(k);this.insights=new SupportInsights(k);this.qualification=new SupportQualification(k);this.workflows=new SupportWorkflows(k,reads);this.branding=new SupportBranding(k);this.memory=new ShopperMemory(k);this.readiness=new JourneyReadiness(k,reads,{...options.journey,delivery:this.delivery});this.journeys=new CommerceJourneys(k,reads,{...journeyOwners,delivery:this.delivery});this.followups=new JourneyFollowups(k,this.journeys);this.routing=options.routing??null;this.runner=options.runner??null;this.helpdesk=options.helpdesk??null;}
 context(scope:Scope,caseId:string){const {s,c}=supportCase(this.k,scope,caseId),privateView=['owner','operator','reviewer'].includes(s.role),rows=this.k.db.prepare(`SELECT operation_id FROM commerce_support_deliveries WHERE tenant_id=? AND store_id=? AND case_id=? AND erased=0 ${privateView?'':"AND kind='email'"} ORDER BY created_at DESC,operation_id LIMIT 50`).all(s.tenant_id,s.store_id,c.id) as Row[];
  const senders=privateView?(this.k.db.prepare("SELECT id,max(version) version FROM commerce_support_documents WHERE tenant_id=? AND store_id=? AND kind='sender' AND state='active' AND expires_at>? GROUP BY id").all(s.tenant_id,s.store_id,this.k.clock()) as Row[]):[];
  return {case_id:c.id,viewer:{role:s.role,actor_id:s.actor_id},senders,profile:{tone:c.pins.profile.tone,locale:c.pins.profile.locale},tracking:this.tracking.read(scope,c.id),history:this.conversations.history(scope,c.id),ownership:this.ownership.inspect(scope,c.id),deliveries:rows.map(r=>this.delivery.inspect(scope,r.operation_id)),delivery_list_may_be_truncated:rows.length===50,model_required:false,production_qualified:false};}
 async post(scope:Scope,action:string,input:unknown):Promise<unknown>{switch(action){
 case 'context':{const p=exact(input,['case_id']);return this.context(scope,id(p.case_id));}
 case 'history':{const p=exact(input,['case_id','after','limit']);return this.conversations.history(scope,id(p.case_id),integer(p.after),integer(p.limit,1));}
 case 'link':{const p=exact(input,['customer_token','link']);if(typeof p.customer_token!=='string')throw new Error('CUSTOMER_VERIFICATION_REQUIRED');return this.conversations.link(scope,this.k.authenticate(p.customer_token),p.link);}
 case 'customer-message':return this.conversations.customerMessage(scope,input);
 case 'journey-readiness':return this.readiness.inspect(scope,input);
 case 'journey-open':case 'journey-context':case 'journey-attach':case 'journey-prepare':case 'journey-execute':case 'journey-reconcile':{
  const p=exact(jsonValue(input,32768),['customer_token','input']);if(typeof p.customer_token!=='string')throw new Error('CUSTOMER_VERIFICATION_REQUIRED');
  const proof=this.k.authenticate(p.customer_token),method=action.slice(8) as 'open'|'context'|'attach'|'prepare'|'execute'|'reconcile';
  return this.journeys[method](scope,proof,p.input);}
 case 'journey-followup-schedule':case 'journey-followup-inspect':{
  const p=exact(jsonValue(input,32768),['customer_token','input']);if(typeof p.customer_token!=='string')throw new Error('CUSTOMER_VERIFICATION_REQUIRED');
  const method=action==='journey-followup-schedule'?'schedule':'inspect';return this.followups[method](scope,this.k.authenticate(p.customer_token),p.input);}
 case 'journey-forget':return this.journeys.forget(scope,input);
 case 'memory-record':return this.memory.record(scope,input);
 case 'memory-forget':return this.memory.forget(scope,input);
 case 'memory-context':{const p=exact(jsonValue(input,32768),['customer_token','context']);if(typeof p.customer_token!=='string')throw new Error('CUSTOMER_VERIFICATION_REQUIRED');return this.memory.context(scope,this.k.authenticate(p.customer_token),p.context);}
 case 'loyalty-context':case 'loyalty-quote':{const p=exact(jsonValue(input,32768),['customer_token','input']);if(typeof p.customer_token!=='string')throw new Error('CUSTOMER_VERIFICATION_REQUIRED');const method=action==='loyalty-context'?'context':'quote';return this.loyalty[method](scope,this.k.authenticate(p.customer_token),p.input);}
 case 'loyalty-accrual':{const p=exact(jsonValue(input,32768),['customer_token','input']);if(typeof p.customer_token!=='string')throw new Error('CUSTOMER_VERIFICATION_REQUIRED');if(!this.loyaltyAccrual)throw new Error('LOYALTY_ACCRUAL_NOT_CONFIGURED');return this.loyaltyAccrual.project(scope,this.k.authenticate(p.customer_token),p.input);}
 case 'loyalty-redemption-context':case 'loyalty-redemption-quote':{const p=exact(jsonValue(input,32768),['customer_token','input']);if(typeof p.customer_token!=='string')throw new Error('CUSTOMER_VERIFICATION_REQUIRED');if(!this.loyaltyRedemptions)throw new Error('LOYALTY_REDEMPTION_NOT_CONFIGURED');const method=action==='loyalty-redemption-context'?'context':'quote';return this.loyaltyRedemptions[method](scope,this.k.authenticate(p.customer_token),p.input);}
 case 'loyalty-redemption-read':case 'loyalty-redemption-dispatch':case 'loyalty-redemption-reconcile':case 'loyalty-redemption-expire':{const p=exact(jsonValue(input,4096),['operation_id']);if(!this.loyaltyRedemptions)throw new Error('LOYALTY_REDEMPTION_NOT_CONFIGURED');const method=action.slice('loyalty-redemption-'.length) as 'read'|'dispatch'|'reconcile'|'expire';return this.loyaltyRedemptions[method](scope,id(p.operation_id));}
 case 'loyalty-incentive-quote':{const p=exact(jsonValue(input,32768),['customer_token','input']);if(typeof p.customer_token!=='string')throw new Error('CUSTOMER_VERIFICATION_REQUIRED');if(!this.loyaltyIncentives)throw new Error('LOYALTY_INCENTIVES_NOT_CONFIGURED');return this.loyaltyIncentives.quote(scope,this.k.authenticate(p.customer_token),p.input);}
 case 'loyalty-incentive-bind':case 'loyalty-incentive-validate':{if(!this.loyaltyIncentives)throw new Error('LOYALTY_INCENTIVES_NOT_CONFIGURED');return this.loyaltyIncentives[action==='loyalty-incentive-bind'?'bind':'validate'](scope,input);}
 case 'loyalty-lifecycle-report':{const p=exact(jsonValue(input,32768),['customer_token','input']);if(typeof p.customer_token!=='string')throw new Error('CUSTOMER_VERIFICATION_REQUIRED');if(!this.loyaltyLifecycle)throw new Error('LOYALTY_LIFECYCLE_NOT_CONFIGURED');return this.loyaltyLifecycle.report(scope,this.k.authenticate(p.customer_token),p.input);}
 case 'loyalty-lifecycle-retained':{if(!this.loyaltyLifecycle)throw new Error('LOYALTY_LIFECYCLE_NOT_CONFIGURED');return this.loyaltyLifecycle.retained(scope,input);}
 case 'takeover':return this.ownership.takeover(scope,input);
 case 'assign':return this.ownership.assign(scope,input);
 case 'consent':return this.consent.record(scope,input);
 case 'queue':return this.delivery.queue(scope,input);
 case 'refund-message-preview':{const p=exact(input,['case_id','operation_id','template_id']);if(!this.delivery.refunds)throw new Error('REFUND_MESSAGE_SOURCE_UNAVAILABLE');return this.delivery.refunds.render(scope,id(p.case_id),id(p.operation_id),p.template_id);}
 case 'helpdesk-note':return this.delivery.queueHelpdesk(scope,input);
 case 'dispatch':{const p=exact(input,['operation_id']);return this.delivery.dispatch(scope,id(p.operation_id));}
 case 'reconcile':{const p=exact(input,['operation_id']);return this.delivery.reconcile(scope,id(p.operation_id));}
 case 'helpdesk-sync':{const p=exact(input,['link_id','before']);if(!this.helpdesk)throw new Error('HELPDESK_NOT_CONFIGURED');return this.helpdesk.synchronize(scope,id(p.link_id),p.before);}
 case 'workflow-context':return this.workflows.context(scope,input);
 case 'workflow-resource':return this.workflows.resource(scope,input);
 case 'workflow-answer':return this.workflows.answer(scope,input);
 case 'model-read':{const p=exact(input,['case_id','task_id','route_id','untrusted_input']);if(!this.routing||!this.runner)throw new Error('MODEL_ROUTE_UNCONFIGURED');return this.routing.run(scope,id(p.case_id),id(p.task_id),id(p.route_id),this.runner,this.reads,p.untrusted_input);}
 case 'branding':return this.branding.configure(scope,input);
 case 'rules-draft':return this.rules.draft(scope,input);
 case 'rules-simulate':{const p=exact(input,['id','version','event']);return this.rules.simulate(scope,id(p.id),integer(p.version,1),p.event);}
 case 'rules-review':{const p=exact(input,['id','version','digest']);return this.rules.review(scope,id(p.id),integer(p.version,1),p.digest);}
 case 'rules-publish':{const p=exact(input,['id','version']);return this.rules.publish(scope,id(p.id),integer(p.version,1));}
 case 'rules-revoke':{const p=exact(input,['id','version']);return this.rules.revoke(scope,id(p.id),integer(p.version,1));}
 case 'rules-schedule':return this.rules.schedule(scope,input);
 case 'rules-execute':{const p=exact(input,['job_id']);return this.rules.execute(scope,id(p.job_id));}
 case 'qualification-freeze':return this.qualification.freeze(scope,input);
 case 'qualification-register':return this.qualification.register(scope,input);
 case 'qualification-review':{const p=exact(input,['id','version','digest']);return this.qualification.review(scope,id(p.id),integer(p.version,1),p.digest);}
 case 'qualification-revoke':{const p=exact(input,['id','version']);return this.qualification.revoke(scope,id(p.id),integer(p.version,1));}
 case 'configure-mode':return this.qualification.configureMode(scope,input);
 case 'metrics-freeze':return this.metrics.freeze(scope,input);
 case 'metrics-close':return this.metrics.close(scope,input);
 case 'metrics-confirm':return this.metrics.confirm(scope,input);
 case 'metrics-cost':return this.metrics.cost(scope,input);
 case 'metrics-followup':return this.metrics.followup(scope,input);
 case 'metrics-report':{const p=exact(input,['cohort_id']);return this.metrics.report(scope,id(p.cohort_id));}
 case 'insights-analyze':return this.insights.analyze(scope,input);
 case 'insights-draft':return this.insights.draft(scope,input);
 default:throw new Error('SUPPORT_ROUTE_UNSUPPORTED');}}
}
