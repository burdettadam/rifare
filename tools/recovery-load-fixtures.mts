// Disposable synthetic construction for the fixed local operations rehearsals.
// Existing commerce modules create the intents and perform every denial. No
// fixture records, configuration or source-system identities are imported live.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {fulfillmentFixture} from '../tests/development/fulfillment-helpers.mts';
import {executionFixture,syntheticHeaders} from '../tests/development/execution-helpers.mts';
import {CommerceKernel} from '../packages/commerce/kernel.mts';
import {Capabilities} from '../packages/commerce/capabilities.mts';
import {ReadContext} from '../packages/commerce/read-context.mts';
import {SupportConversations} from '../packages/commerce/support-conversations.mts';
import {SupportConsent} from '../packages/commerce/support-consent.mts';
import {SupportOwnership} from '../packages/commerce/support-core.mts';
import {SupportTracking} from '../packages/commerce/support-tracking.mts';
import {SupportDelivery} from '../packages/commerce/support-delivery.mts';
import {SupportFixtureSource} from '../packages/adapters/support-fixture-source.mts';
import {ResolutionExecution} from '../packages/commerce/resolution-execution.mts';
import {FulfillmentExecution} from '../packages/commerce/fulfillment-execution.mts';
import {SecretVault} from '../packages/commerce/secrets.mts';
import {WebhookInbox} from '../packages/commerce/webhook-inbox.mts';
import {LOAD_WORKLOAD} from '../packages/operations/load-envelope.mts';

export async function recoveryFixture(){
 const f=await fulfillmentFixture();let mailDb:DatabaseSync|undefined;
 try{
  const refundAllocation=f.plan.allocations.find((a:any)=>a.outcome==='refund')!,refund=f.authorize(f.quote(refundAllocation));
  const label=f.authorizeFulfillment(f.labels.quote(f.a.scope,{request_id:f.request.id,replaces:null}));
  mailDb=new DatabaseSync(join(f.directory,'rehearsal-mail.sqlite'));
  const mailSource=new SupportFixtureSource(mailDb,f.a.tenant,f.a.store,'rehearsal_mail',f.now),conversations=new SupportConversations(f.kernel),ownership=new SupportOwnership(f.kernel),consent=new SupportConsent(f.kernel),tracking=new SupportTracking(f.kernel,f.reads),delivery=new SupportDelivery(f.kernel,tracking,[mailSource]);
  const link=conversations.link(f.a.scope,f.customer,{case_id:'resolution_case',channel:'email',account_id:mailSource.account,external_id:'rehearsal_thread',history:'partial',source_revision:1});
  consent.configureSender(f.owner.scope,{id:'rehearsal_sender',expected_revision:0,channel:'email',address:'support@example.invalid',account_id:mailSource.account,source_identity:mailSource.identity,source_contract:mailSource.contract,expires_at:f.now()+3600000,jurisdiction:'US_TEST',transactional_basis:'order_service'});
  consent.verifyContact(f.a.scope,f.customer,{link_id:link.id,address:'shopper-apparel@example.invalid'});
  const message=delivery.queue(f.a.scope,{case_id:'resolution_case',link_id:link.id,sender_id:'rehearsal_sender',template_id:'tracking_status_v1',event_id:'rehearsal_message',expected_generation:ownership.inspect(f.a.scope,'resolution_case')!.generation});
  const keys={activeId:'rehearsal_key',get:()=>Buffer.alloc(32,39)},vault=new SecretVault(f.kernel,keys,{rehearsal_probe:()=>true});
  const secret=vault.put(f.owner.scope,{provider:'synthetic',adapter:'rehearsal_probe',value:'rehearsal-secret-value'}),attachment=f.kernel.attach(f.a.scope,f.order().id,{kind:'synthetic_attachment',fixture:'recovery_rehearsal'});
  const key=Buffer.alloc(32,67),inbox=new WebhookInbox(f.kernel,()=>key),route=inbox.register(f.owner.scope,{provider:'synthetic',topic:'cases/updated',shop_domain:'rehearsal.example.invalid',api_version:'2026-10',key_ref:'rehearsal_webhook_key'});
  return {...f,mailDb,mailSource,delivery,refund,label,message,keys,secret,attachment,route,webhookKey:key,cleanup:()=>{mailDb!.close();f.cleanup();}};
 }catch(error){mailDb?.close();f.cleanup();throw error;}
}
const effectRows=(f:any)=>({refunds:f.sourceDb.prepare('SELECT * FROM fixture_resolution_effects ORDER BY operation_id').all(),labels:f.fulfillmentDb.prepare('SELECT * FROM fixture_effects ORDER BY id').all(),messages:f.mailDb.prepare('SELECT * FROM support_source_effects ORDER BY operation_id').all()});
/** Reopen real services and attempt the queued paths against separate local
 * source ledgers. An unexpected success or pre-denial source call fails. */
export async function checkRestoredEffects(f:any,database:string,restarts:number){
 const effects=effectRows(f),beforeBuy=f.fulfillmentSource.calls.buy,beforeMail=f.mailSource.calls;
 let refundCalls=0,credentialCalls=0;
 const original=f.source.issue.bind(f.source);f.source.issue=async(...args:any[])=>{refundCalls++;return original(...args);};
 try{
  for(let restart=0;restart<restarts;restart++){
   const db=new DatabaseSync(database);try{
    const k=new CommerceKernel(db,f.now),scope=k.authenticate(k.issueSession(f.a.tenant,f.a.store,'owner')),reads=new ReadContext(k,new Capabilities(k));
    await assert.rejects(()=>new ResolutionExecution(k,f.source).dispatch(scope,f.refund.id),/RESTORE_WRITE_BLOCKED|RESTORE_EGRESS_BLOCKED/);
    await assert.rejects(()=>new FulfillmentExecution(k,f.fulfillmentSource).dispatch(scope,f.label.id),/RESTORE_WRITE_BLOCKED|RESTORE_EGRESS_BLOCKED/);
    await assert.rejects(()=>new SupportDelivery(k,new SupportTracking(k,reads),[f.mailSource]).dispatch(scope,f.message.operation_id),/RESTORE_WRITE_BLOCKED|RESTORE_EGRESS_BLOCKED/);
    await assert.rejects(()=>new SecretVault(k,f.keys,{rehearsal_probe:()=>{credentialCalls++;return true;}}).probe(scope,f.secret.ref,'rehearsal_probe'),/RESTORE_WRITE_BLOCKED|RESTORE_EGRESS_BLOCKED/);
    const raw=Buffer.from('{}');assert.throws(()=>new WebhookInbox(k,()=>f.webhookKey).receive(f.route.id,syntheticHeaders(f.route,raw,f.webhookKey,f.now()),raw),/WEBHOOK_ROUTE_UNAVAILABLE/);
   }finally{db.close();}
  }
  const counts={refund_calls:refundCalls,label_calls:f.fulfillmentSource.calls.buy-beforeBuy,message_calls:f.mailSource.calls-beforeMail,credential_calls:credentialCalls,restarts};
  assert.deepEqual(counts,{refund_calls:0,label_calls:0,message_calls:0,credential_calls:0,restarts});assert.deepEqual(effectRows(f),effects);return counts;
 }finally{f.source.issue=original;}
}
export function loadFixture(){
 const f=executionFixture();try{
  const key=Buffer.alloc(32,89),inbox=new WebhookInbox(f.kernel,()=>key,LOAD_WORKLOAD.capacity),route=inbox.register(f.owner.scope,{provider:'synthetic',topic:'cases/updated',shop_domain:'load.example.invalid',api_version:'2026-10',key_ref:'load_fixture_key'});
  return {input:{kernel:f.kernel,scope:f.a.scope,inbox,route_id:route.id,resource_id:f.order().id,headers:(raw:Buffer,delivery:string)=>syntheticHeaders(route,raw,key,f.now(),delivery)},cleanup:f.cleanup};
 }catch(error){f.cleanup();throw error;}
}
