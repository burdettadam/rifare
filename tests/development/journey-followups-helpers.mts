import assert from 'node:assert/strict';
import {supportFixture} from './support-helpers.mts';
import {fulfillmentFixture} from './fulfillment-helpers.mts';
import {shoppingFixture,installShoppingCart} from './growth-shopping-helpers.mts';
import {attachSupport} from './journey-readiness-helpers.mts';
import {CommerceJourneys} from '../../packages/commerce/commerce-journeys.mts';
import {JourneyFollowups} from '../../packages/commerce/journey-followups.mts';
import {SupportDelivery} from '../../packages/commerce/support-delivery.mts';
import {SupportRules} from '../../packages/commerce/support-rules.mts';
import {ShopperMemory} from '../../packages/commerce/shopper-memory.mts';
import {canonical,contentDigest} from '../../packages/commerce/configuration-values.mts';
export {verifiedCustomer,updateResource,snapshot,restoreInput,restored,noRestoreResidue,merchant,target,imported,changedMerchant,changedRecovery,recordInput as memoryInput} from './shopper-memory-helpers.mts';
export {reference,operationReferences} from './commerce-journeys-helpers.mts';
export type Value=Record<string,any>;
export const PROJECTION_FIELDS=['job_id','case_id','state','reason','operation_id','customer_delivered','restricted','manual_action_required','execution_authorized','production_qualified'].sort();
export const CURRENT_FIELDS=['schema_version','case_id','resource_id','subject_ref','logical_key','request_hash','status','job_id','job_digest','journey','memory','source','link_id','link_revision','rule','sender_id','generation','due_at','expires_at'].sort();
export const PRIVATE_FIELDS=['job_digest','journey','memory','source','link_id','link_revision','rule','sender_id','generation','due_at','expires_at'];

export async function usingFollowups(fn:(f:any)=>unknown,mode:'support'|'cart'|'fulfillment'|'edit'='support'){
  const base:any=mode==='fulfillment'?await fulfillmentFixture():mode==='edit'?shoppingFixture():supportFixture();
  let support:ReturnType<typeof attachSupport>|undefined,shop:Awaited<ReturnType<typeof installShoppingCart>>|undefined;
  try{
    if(mode==='fulfillment'||mode==='edit')support=attachSupport(base,{caseId:mode==='fulfillment'?'resolution_case':'case_one'});
    if(mode==='cart')shop=await installShoppingCart(base);
    const f:any={...base,...support,caseId:mode==='fulfillment'?'resolution_case':'case_one',messageSource:support?.supportSource??base.source,messageDb:support?.supportDb??base.sourceDb,
      ...(shop?{carts:shop.carts,cart_id:shop.cart_id,cartSource:shop.source,cartDb:shop.sourceDb}:{}),...(mode==='edit'?{cartSource:base.catalogSource,cartDb:base.sourceDb}:{})};
    const guardOwners={...(f.carts?{cart:f.carts}:{}),...(f.executor?{resolution:f.executor}:{}),...(f.edits?{edits:f.edits}:{})};
    f.delivery=new SupportDelivery(f.kernel,f.tracking,[f.messageSource],null,null,guardOwners);
    f.journeyOwners={delivery:f.delivery,...guardOwners,...(f.execution?{fulfillment:f.execution}:{})};
    f.journeys=new CommerceJourneys(f.kernel,f.reads,f.journeyOwners);f.followups=new JourneyFollowups(f.kernel,f.journeys);f.rules=new SupportRules(f.kernel,f.delivery);f.memory=new ShopperMemory(f.kernel);f.guardOwners=guardOwners;
    return await fn(f);
  }finally{shop?.cleanup();support?.closeSupport();base.cleanup();}
}
export const common=(f:any,extra:Value={})=>({case_id:f.caseId,link_id:f.link.id,expected_generation:1,...extra});
export const order=(f:any)=>f.kernel.get(f.a.scope,f.link.resource_id);
export const count=(db:any,table:string)=>Number(db.prepare('SELECT count(*) n FROM '+table).get().n);
export const event=(f:any,extra:Value={})=>({id:'followup_event',case_id:f.caseId,trigger:'message_received',channel:'email',at:f.now(),visited:[],depth:0,link_id:f.link.id,sender_id:'sender_one',...extra});
export const ruleInput=(f:any,extra:Value={})=>({id:'followup_rule',expected_version:0,trigger:'message_received',conditions:{channel:'email',requires_verified_case:true},priority:5,wait_ms:1000,calendar:{timezone:'UTC',weekdays:[0,1,2,3,4,5,6],start_minute:0,end_minute:1440},action:'queue_tracking',expires_at:f.now()+600000,...extra});
export function publish(f:any,extra:Value={}){const r=f.rules.draft(f.owner.scope,ruleInput(f,extra));f.rules.review(f.reviewer.scope,r.id,r.version,r.digest);f.rules.publish(f.owner.scope,r.id,r.version);return {id:r.id,version:r.version,digest:r.digest};}
export function ready(f:any,options:Value={}){
  const kind=options.kind??'tracking',intent_id=options.intent_id??kind+'_one',references=options.references??[],selected=Object.hasOwn(options,'reference')?options.reference:references.at(-1)??null;
  f.journeys.open(f.a.scope,f.customer,{...common(f),expected_version:0,request_id:'followup_journey_open'});
  const journey=f.journeys.attach(f.a.scope,f.customer,{...common(f),expected_version:1,request_id:'followup_journey_attach',intent_id,kind,references});
  const rule=options.rule??publish(f,options.ruleExtra),input={rule,journey:{id:journey.id,version:journey.version,context_digest:journey.context_digest,intent_id,reference:selected},event:event(f,options.eventExtra),expected_generation:1,expires_at:f.now()+60000,...options.inputExtra};
  return {journey,rule,input};
}
export const schedule=(f:any,input:Value,scope=f.a.scope,proof=f.customer)=>f.followups.schedule(scope,proof,input);
export const inspection=(f:any,job_id:string,extra:Value={})=>({...common(f),job_id,...extra});
export const inspect=(f:any,job_id:string,extra:Value={},scope=f.a.scope,proof=f.customer)=>f.followups.inspect(scope,proof,inspection(f,job_id,extra));
export function queue(f:any,job_id:string){const row=job(f,job_id);if(row.due_at>f.now())f.advance(row.due_at-f.now());const out=f.rules.execute(f.a.scope,job_id);assert.equal(out.state,'completed');assert.ok(out.result.operation_id);return out.result.operation_id;}
export function job(f:any,job_id:string):Value{const row=f.db.prepare('SELECT * FROM commerce_support_rule_jobs WHERE tenant_id=? AND store_id=? AND id=?').get(f.a.tenant,f.a.store,job_id);assert.ok(row);return row;}
export const immutableJob=(row:Value)=>Object.fromEntries(Object.entries(row).filter(([key])=>!['state','result'].includes(key)));
export const guards=(f:any,caseId=f.caseId,store=f.a):Value[]=>f.db.prepare("SELECT * FROM commerce_support_documents WHERE tenant_id=? AND store_id=? AND kind='journey_followup' ORDER BY id,version").all(store.tenant,store.store).filter((r:Value)=>JSON.parse(r.body).case_id===caseId);
export const journeys=(f:any):Value[]=>f.db.prepare("SELECT * FROM commerce_support_documents WHERE tenant_id=? AND store_id=? AND kind='commerce_journey' ORDER BY id,version").all(f.a.tenant,f.a.store).filter((r:Value)=>JSON.parse(r.body).case_id===f.caseId);
export function guard(f:any,job_id:string){const rows=guards(f).filter(r=>JSON.parse(r.body).job_id===job_id);assert.ok(rows.length);return rows.at(-1)!;}
export function assertProjection(result:Value){assert.deepEqual(Object.keys(result).sort(),PROJECTION_FIELDS);assert.equal(result.execution_authorized,false);assert.equal(result.production_qualified,false);}
export function assertSuppressed(f:any,job_id:string,reason:string){const result=inspect(f,job_id);assertProjection(result);assert.equal(result.state,'suppressed');assert.equal(result.reason,reason);assert.equal(result.customer_delivered,false);assert.equal(result.manual_action_required,!['cart_purchased','refund_settled','credit_issued','edit_released','edit_cancelled','edit_abandoned'].includes(reason));return result;}
export function assertRedacted(row:Value,privateIds:string[]=[]){const b=JSON.parse(row.body);assert.deepEqual(Object.keys(b).sort(),[...CURRENT_FIELDS,'reason'].sort());assert.equal(b.status,'redacted');assert.equal(row.state,'revoked');assert.equal(row.author,'journey_followup');assert.equal(row.reviewer,null);assert.equal(row.review_digest,null);for(const key of PRIVATE_FIELDS)assert.equal(b[key],null);assert.match(b.logical_key,/^[a-f0-9]{64}$/);assert.match(b.request_hash,/^[a-f0-9]{64}$/);assert.equal(row.digest,contentDigest(b));for(const value of privateIds)assert.equal(row.body.includes(value),false);}
export function replaceGuard(db:any,row:Value){const keys=['body','digest','author','state','reviewer','review_digest','created_at','expires_at'];db.prepare('UPDATE commerce_support_documents SET '+keys.map(k=>k+'=?').join(',')+" WHERE tenant_id=? AND store_id=? AND kind='journey_followup' AND id=? AND version=?").run(...keys.map(k=>row[k]),row.tenant_id,row.store_id,row.id,row.version);}
const EFFECT_TABLES=['commerce_support_documents','commerce_support_rule_jobs','commerce_support_deliveries','commerce_support_events','commerce_operations','commerce_operation_work','commerce_operation_receipts','commerce_action_previews','commerce_action_approvals','commerce_action_receipts','commerce_shopping_carts','commerce_order_edits','commerce_fulfillment_operations','commerce_resolution_operations','commerce_model_reservations','commerce_assistance_receipts'];
export const effects=(f:any)=>Object.fromEntries(EFFECT_TABLES.map(table=>[table,f.db.prepare('SELECT * FROM '+table).all().map((r:Value)=>canonical(r)).sort()]));
export function withdraw(f:any,extra:Value={}){return f.consent.record(f.customer,{case_id:f.caseId,sender_id:'sender_one',channel:'email',purpose:'*',state:'withdrawn',event_id:'followup_optout',source_version:1,effective_at:f.now(),source_ref:'verified_customer_click',...extra});}
export function forgetJourney(f:any,version=2,extra:Value={}){return f.journeys.forget(f.customer,{...common(f),expected_version:version,request_id:'forget_followup_journey',...extra});}
export function rebind(f:any,extra:Value){const g={...f,...extra},guardOwners={...(g.carts?{cart:g.carts}:{}),...(g.executor?{resolution:g.executor}:{}),...(g.edits?{edits:g.edits}:{})};g.delivery=new SupportDelivery(g.kernel,g.tracking,[g.messageSource],null,null,guardOwners);g.journeys=new CommerceJourneys(g.kernel,g.reads,{delivery:g.delivery,...guardOwners});g.followups=new JourneyFollowups(g.kernel,g.journeys);g.rules=new SupportRules(g.kernel,g.delivery);g.memory=new ShopperMemory(g.kernel);return g;}
