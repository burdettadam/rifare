import test from 'node:test';
import assert from 'node:assert/strict';
import {JourneyReadiness} from '../../packages/commerce/journey-readiness.mts';
import {SupportService} from '../../packages/commerce/support-service.mts';
import {IntegrationReadiness,DRAFT_ACTION} from '../../packages/commerce/integration-readiness.mts';
import {ExecutionStops} from '../../packages/commerce/execution-stops.mts';
import {CONTRACT_VERSION} from '../../packages/commerce/capabilities.mts';
import {
  usingReadiness,usingShoppingReadiness,usingExchangeReadiness,otherMerchant,
  input,inspect,row,effects,count,verifiedCustomer,updateResource,ACTIONS,CONTEXT_FIELDS,ROW_FIELDS,
} from './journey-readiness-helpers.mts';
import type {Value} from './journey-readiness-helpers.mts';

// Independent ADR-0054 specifications. Twenty native cases; no nested tests.
function status(view:Value,action:string,expected:string,reason?:string){
  const result=row(view,action);assert.equal(result.status,expected,action);assert.equal(result.available,expected==='available',action);
  if(reason!==undefined)assert.equal(result.reason,reason,action);return result;
}
const stop=(f:any,action:string,stopped=true,expected_revision=0)=>new ExecutionStops(f.kernel).set(f.owner.scope,{action,stopped,expected_revision,reason:stopped?'maintenance':'reviewed_resume'});

test('CASE-M18-G02-01',()=>usingReadiness(f=>{
  const before=effects(f),view=inspect(f);
  assert.deepEqual(Object.keys(view).sort(),CONTEXT_FIELDS);assert.equal(view.schema_version,1);assert.equal(view.case_id,'case_one');assert.equal(view.resource_id,f.order().id);
  assert.equal(view.ownership_generation,1);assert.equal(view.channel,'email');assert.equal(view.history.status,'partial');assert.equal(view.history.source_revision,1);
  assert.match(view.configuration_digest,/^[a-f0-9]{64}$/);assert.match(view.context_digest,/^[a-f0-9]{64}$/);
  assert.deepEqual(view.actions.map((r:Value)=>r.action).sort(),[...ACTIONS].sort());
  for(const action of view.actions){
    assert.deepEqual(Object.keys(action).sort(),ROW_FIELDS);assert.equal(typeof action.stage,'string');assert.ok(action.stage.length>0);
    assert.equal(action.execution_authorized,false);assert.equal(action.production_qualified,false);assert.ok(Array.isArray(action.alternatives));
    for(const alternative of action.alternatives)assert.ok([...ACTIONS,'request_human_review','reverify_customer','refresh_source'].includes(alternative));
    if(action.evidence_digest!==null)assert.match(action.evidence_digest,/^[a-f0-9]{64}$/);
  }
  status(view,'tracking.read','available','SYNTHETIC_READ_ONLY');status(view,'return.refund.form','available','LOCAL_FORM_AVAILABLE');status(view,'return.exchange.form','available','LOCAL_FORM_AVAILABLE');
  status(view,'followup.queue','available','CONFIGURED_PURPOSE_ALLOWED');status(view,'remote.continue','unsupported','REMOTE_QUALIFICATION_MISSING');
  assert.equal(view.model_thread_required,false);assert.equal(view.execution_authorized,false);assert.equal(view.production_qualified,false);
  assert.deepEqual(effects(f),before);assert.equal(f.supportSource.calls,0);
  const rejected=f.intake.evaluate(f.customer,f.selection({lines:[{line_id:'excluded',quantity:1}]}));
  assert.equal(rejected.quote.decision.decision,'deny','an available form cannot establish item-level eligibility');
  assert.equal(row(inspect(f),'return.refund.form').available,true);assert.equal(count(f.db,'commerce_action_approvals'),0);
}));

test('CASE-M18-G02-02',()=>usingReadiness(f=>{
  const statuses=new Set<string>(),collect=(view:Value)=>{view.actions.forEach((r:Value)=>statuses.add(r.status));return view;};
  const initial=collect(inspect(f));stop(f,'customer.message');
  status(collect(inspect(f)),'followup.queue','temporarily_unavailable','EXECUTION_STOPPED');
  assert.throws(()=>f.delivery.queue(f.a.scope,f.message()),/EXECUTION_STOPPED/);
  f.gateway.configure(f.owner.scope,{enabled:false,expected_revision:1,profile_id:'default',policy_id:'returns'});
  status(collect(inspect(f)),'return.refund.form','disabled','ACTION_DISABLED');
  f.gateway.configure(f.owner.scope,{enabled:true,expected_revision:2,profile_id:'default',policy_id:'returns'});
  new IntegrationReadiness(f.kernel).revoke(f.owner.scope,{action:DRAFT_ACTION});
  status(collect(inspect(f)),'return.refund.form','unverified','PROOF_MISSING_EXPIRED_OR_REVOKED');
  assert.deepEqual([...statuses].sort(),['available','disabled','needs_configuration','temporarily_unavailable','unsupported','unverified'].sort());
  assert.throws(()=>f.intake.evaluate(f.customer,f.selection()),/INTEGRATION_NOT_READY/);
  assert.throws(()=>f.readiness.inspect(f.a.scope,{...input(f),readiness:initial}));assert.equal(count(f.db,'commerce_return_quotes'),0);assert.equal(count(f.db,'commerce_operations'),0);
}));

test('CASE-M18-G02-03',()=>usingReadiness(async f=>{
  const other=otherMerchant(f);
  try{
    const first=inspect(f),second=other.readiness.inspect(other.store.scope,input(other));
    status(first,'return.exchange.form','available','LOCAL_FORM_AVAILABLE');status(second,'return.refund.form','available','LOCAL_FORM_AVAILABLE');
    status(second,'return.exchange.form','disabled','OUTCOME_DISABLED');assert.ok(row(second,'return.exchange.form').alternatives.includes('return.refund.form'));
    const a=f.cases.inspect(f.a.scope,'case_one'),b=f.cases.inspect(other.store.scope,'case_one');
    assert.equal(a.pins.skill.digest,b.pins.skill.digest);assert.equal(a.pins.skill.id,b.pins.skill.id);assert.notEqual(a.configuration_digest,b.configuration_digest);
    f.gateway.configure(f.owner.scope,{enabled:false,expected_revision:1,profile_id:'default',policy_id:'returns'});
    status(inspect(f),'return.refund.form','disabled','ACTION_DISABLED');status(other.readiness.inspect(other.store.scope,input(other)),'return.refund.form','available','LOCAL_FORM_AVAILABLE');
    f.ownership.assign(f.owner.scope,{case_id:'case_one',expected_generation:1,actor_id:'agent'});
    const service=new SupportService(f.kernel,f.reads,{sources:[f.supportSource]});
    const agent:any=await service.post(f.agent.scope,'journey-readiness',input(f,{expected_generation:2}));
    status(agent,'return.refund.form','disabled','ACTION_DISABLED');assert.equal(agent.execution_authorized,false);
  }finally{other.closeSupport();}
}));

test('M18-G02-STRICT-INPUT-AND-OWNER-BINDING',()=>usingReadiness(async f=>{
  const before=effects(f);
  for(const patch of [{provider_thread_id:'hidden_thread'},{available:true},{expected_generation:0},{expected_generation:1.5},{case_id:'bad case'},{allocation_id:7},{cart_id:[]},{sender_id:{}},{link_id:null}])
    assert.throws(()=>f.readiness.inspect(f.a.scope,{...input(f),...patch}));
  const missing=input(f);delete missing.cart_id;assert.throws(()=>f.readiness.inspect(f.a.scope,missing));
  const getter=input(f);Object.defineProperty(getter,'case_id',{enumerable:true,get:()=>{throw new Error('GETTER_EXECUTED');}});
  assert.throws(()=>f.readiness.inspect(f.a.scope,getter),(e:any)=>e.message!=='GETTER_EXECUTED');
  assert.throws(()=>new JourneyReadiness(f.kernel,f.reads,{delivery:{available:true} as any}),/JOURNEY_OWNER_MISMATCH/);
  await usingReadiness(other=>{
    assert.throws(()=>new JourneyReadiness(f.kernel,f.reads,{delivery:other.delivery}),/JOURNEY_OWNER_MISMATCH/);
    assert.throws(()=>new JourneyReadiness(f.kernel,other.reads,{delivery:f.delivery}),/JOURNEY_OWNER_MISMATCH/);
  });
  assert.deepEqual(effects(f),before);
}));

test('M18-G02-EXACT-CASE-CHANNEL-TENANT-AND-RESOURCE',()=>usingReadiness(f=>{
  const before=effects(f);for(const scope of [f.b.scope,f.c.scope,{}])assert.throws(()=>f.readiness.inspect(scope,input(f)));
  assert.throws(()=>inspect(f,{link_id:'thread_one'}));assert.deepEqual(effects(f),before);
  f.create('case_two');const second=f.conversations.link(f.a.scope,f.customer,{case_id:'case_two',channel:'webchat',account_id:'widget',external_id:'browser_two',history:'unavailable',source_revision:1});
  assert.throws(()=>inspect(f,{link_id:second.id}));
  const other=verifiedCustomer(f,f.a,'ORD-1002');f.cases.create(other.scope,{case_id:'other_customer_case',resource_id:other.order.id,profile_id:'default',policy_id:'returns'});
  const foreign=f.conversations.link(f.a.scope,other.scope,{case_id:'other_customer_case',channel:'email',account_id:'merchant_mail',external_id:'other_thread',history:'partial',source_revision:1});
  assert.throws(()=>f.readiness.inspect(other.scope,input(f)));assert.throws(()=>inspect(f,{link_id:foreign.id}));
  assert.throws(()=>f.readiness.inspect(f.customer,input(f,{case_id:'other_customer_case',link_id:foreign.id})));
  assert.equal(row(inspect(f),'tracking.read').available,true);
}));

test('M18-G02-CURRENT-CUSTOMER-PROOF-AND-REVOCATION',()=>usingReadiness(f=>{
  const customerView=inspect(f,{},f.customer);status(customerView,'tracking.read','available','SYNTHETIC_READ_ONLY');status(customerView,'followup.queue','disabled','ACCESS_DENIED');
  const before=effects(f);f.kernel.revoke(f.customer);assert.throws(()=>inspect(f,{},f.customer));
  const staff=inspect(f);status(staff,'return.refund.form','needs_configuration','CUSTOMER_VERIFICATION_REQUIRED');
  assert.ok(row(staff,'return.refund.form').alternatives.includes('reverify_customer'));assert.deepEqual(effects(f),before);
}));

test('M18-G02-FRESH-SESSION-CANNOT-REPLACE-CASE-PROOF',()=>usingReadiness(f=>{
  const originalProof=(f.db.prepare("SELECT verification_hash FROM commerce_cases WHERE tenant_id=? AND store_id=? AND id='case_one'").get(f.a.tenant,f.a.store) as Value).verification_hash;
  const order=f.order(),shipment=f.kernel.lookup(f.a.scope,'shipment','synthetic','SHIP-1001');f.advance(900001);
  f.a.scope=f.kernel.authenticate(f.kernel.issueSession(f.a.tenant,f.a.store,'operator'));
  f.owner.scope=f.kernel.authenticate(f.kernel.issueSession(f.a.tenant,f.a.store,'owner'));
  updateResource(f,order,order.payload);updateResource(f,shipment,shipment.payload);
  const fresh=verifiedCustomer(f),before=effects(f),view=inspect(f,{},fresh.scope);
  status(view,'tracking.read','available','SYNTHETIC_READ_ONLY');
  for(const action of ['return.refund.form','return.exchange.form'])status(view,action,'needs_configuration','CUSTOMER_VERIFICATION_REQUIRED');
  assert.equal((f.db.prepare("SELECT verification_hash FROM commerce_cases WHERE tenant_id=? AND store_id=? AND id='case_one'").get(f.a.tenant,f.a.store) as Value).verification_hash,originalProof);
  assert.deepEqual(effects(f),before);
}));

test('M18-G02-CURRENT-CONTACT-AND-CHANNEL',()=>usingReadiness(f=>{
  const web=f.conversations.link(f.a.scope,f.customer,{case_id:'case_one',channel:'webchat',account_id:'widget',external_id:'browser_one',history:'unavailable',source_revision:1});
  const webView=inspect(f,{link_id:web.id});assert.equal(row(webView,'followup.queue').available,false);assert.equal(webView.history.status,'unavailable');
  assert.notEqual(webView.context_digest,inspect(f).context_digest);
  const source=f.kernel.lookup(f.a.scope,'customer','synthetic','C-1001');updateResource(f,source,{...source.payload,email:'changed-shopper@example.invalid'});
  assert.throws(()=>inspect(f,{},f.customer));status(inspect(f),'followup.queue','needs_configuration','CONTACT_VERIFICATION_REQUIRED');
  const fresh=verifiedCustomer(f);f.consent.verifyContact(f.a.scope,fresh.scope,{link_id:f.link.id,address:'changed-shopper@example.invalid'});
  status(inspect(f),'followup.queue','available','CONFIGURED_PURPOSE_ALLOWED');
  assert.equal(JSON.stringify(inspect(f)).includes('changed-shopper@example.invalid'),false);
}));

test('M18-G02-CURRENT-PERMISSIONS',()=>usingReadiness(f=>{
  assert.equal(row(inspect(f),'followup.queue').available,true);
  f.permissions.change(f.owner.scope,{actor_id:'operator',role:'operator',expected_revision:0,actions:['case.read','resource.read','capability.read','support.read','return.read','skill.read','profile.read'],resource_ids:null});
  const view=inspect(f);status(view,'followup.queue','disabled','ACCESS_DENIED');status(view,'tracking.read','available','SYNTHETIC_READ_ONLY');
  assert.throws(()=>f.delivery.queue(f.a.scope,f.message()),/ACCESS_DENIED/);
  f.permissions.change(f.owner.scope,{actor_id:'operator',role:'operator',expected_revision:1,actions:['case.read','resource.read','support.read'],resource_ids:null});
  assert.throws(()=>inspect(f),/ACCESS_DENIED/);assert.equal(count(f.db,'commerce_operations'),0);
}));

test('M18-G02-CURRENT-OWNERSHIP-GENERATION',()=>usingReadiness(f=>{
  const first=inspect(f);f.ownership.assign(f.owner.scope,{case_id:'case_one',expected_generation:1,actor_id:'agent'});
  assert.throws(()=>inspect(f,{expected_generation:2}));assert.throws(()=>inspect(f,{},f.agent.scope));
  const agent=inspect(f,{expected_generation:2},f.agent.scope);assert.equal(agent.ownership_generation,2);assert.notEqual(agent.context_digest,first.context_digest);
  assert.equal(row(agent,'remote.continue').available,false);
  f.ownership.takeover(f.a.scope,{case_id:'case_one',expected_generation:2,reason:'provider_unavailable'});
  assert.throws(()=>inspect(f,{expected_generation:3},f.agent.scope));assert.throws(()=>inspect(f,{expected_generation:2},f.customer));
  const before=effects(f);assert.equal(inspect(f,{expected_generation:3}).ownership_generation,3);assert.deepEqual(effects(f),before);
}));

test('M18-G02-SOURCE-FRESHNESS-AND-EXPLICIT-HISTORY',()=>usingReadiness(f=>{
  const first=inspect(f);f.conversations.link(f.a.scope,f.customer,{case_id:'case_one',channel:'email',account_id:'merchant_mail',external_id:'thread_one',history:'unavailable',source_revision:2});
  const missing=inspect(f);assert.equal(missing.history.status,'unavailable');assert.equal(missing.history.source_revision,2);assert.notEqual(missing.context_digest,first.context_digest);
  assert.equal(row(missing,'tracking.read').available,true);f.advance(300001);
  const before=effects(f),stale=inspect(f);status(stale,'tracking.read','temporarily_unavailable','TRACKING_UNAVAILABLE');assert.equal(row(stale,'followup.queue').available,false);
  assert.ok(row(stale,'tracking.read').alternatives.includes('refresh_source'));assert.deepEqual(effects(f),before);assert.equal(f.supportSource.calls,0);
}));

test('M18-G02-REGISTRY-QUALIFICATION-AND-CONNECTION-REVISION',()=>usingReadiness(f=>{
  const previous=inspect(f);f.caps.configure(f.a.scope,{adapter:'simulator',contract_version:CONTRACT_VERSION,granted_scopes:['read_orders','read_shipments'],qualification:'synthetic'});
  const changed=inspect(f);status(changed,'return.refund.form','needs_configuration','CONFIGURATION_REPREVIEW_REQUIRED');assert.notEqual(changed.context_digest,previous.context_digest);
  f.caps.configure(f.a.scope,{adapter:'woocommerce',contract_version:'unqualified_v1',granted_scopes:['read_orders'],qualification:'unverified'});
  status(inspect(f),'tracking.read','unverified','ADAPTER_UNQUALIFIED');assert.throws(()=>f.caps.read(f.a.scope,'order.read',f.order().id),/CAPABILITY_UNAVAILABLE/);
  f.caps.configure(f.a.scope,{adapter:'simulator',contract_version:CONTRACT_VERSION,granted_scopes:[],qualification:'synthetic'});
  status(inspect(f),'tracking.read','unsupported','REQUIRED_SCOPE_MISSING');assert.equal(count(f.db,'commerce_action_previews'),0);
}));

test('M18-G02-REVOKED-SENDER-REFUSES-STALE-DISPLAY',()=>usingReadiness(f=>{
  const previous=inspect(f);status(previous,'followup.queue','available','CONFIGURED_PURPOSE_ALLOWED');
  f.db.prepare("UPDATE commerce_support_documents SET state='revoked' WHERE tenant_id=? AND store_id=? AND kind='sender' AND id='sender_one'").run(f.a.tenant,f.a.store);
  const before=effects(f),current=inspect(f);status(current,'followup.queue','temporarily_unavailable','SENDER_UNAVAILABLE');assert.notEqual(current.context_digest,previous.context_digest);
  assert.throws(()=>f.delivery.queue(f.a.scope,f.message()),/SUPPORT_CONFIGURATION_UNAVAILABLE/);
  assert.deepEqual(effects(f),before);assert.equal(count(f.db,'commerce_support_deliveries'),0);assert.equal(f.supportSource.calls,0);
}));

test('M18-G02-CONSENT-AND-NATIVE-FINAL-SEND',()=>usingReadiness(async f=>{
  const queued=f.delivery.queue(f.a.scope,f.message());assert.equal(queued.state,'queued');
  f.consent.record(f.customer,{case_id:'case_one',sender_id:'sender_one',channel:'email',purpose:'*',state:'withdrawn',event_id:'stop_all_followups',source_version:1,effective_at:f.now(),source_ref:'customer_click'});
  const before=effects(f),view=inspect(f);status(view,'followup.queue','disabled','WITHDRAWN');assert.deepEqual(effects(f),before);
  await assert.rejects(()=>f.delivery.dispatch(f.a.scope,queued.operation_id),/DELIVERY_SUPPRESSED/);
  assert.equal(f.delivery.inspect(f.a.scope,queued.operation_id).state,'suppressed');assert.equal(f.supportSource.calls,0);assert.equal(count(f.db,'commerce_operations'),1);
}));

test('M18-G02-MISSING-OWNERS-AND-REQUIRED-INPUT',()=>usingShoppingReadiness(f=>{
  const noOwners=new JourneyReadiness(f.kernel,f.reads),missing=noOwners.inspect(f.a.scope,input(f));
  status(missing,'order.edit.context','needs_configuration','EDIT_WORKFLOW_REQUIRED');status(missing,'shopping.cart.context','needs_configuration','SHOPPING_WORKFLOW_REQUIRED');status(missing,'followup.queue','needs_configuration','DELIVERY_WORKFLOW_REQUIRED');
  const supplied=inspect(f);status(supplied,'exchange.offers','needs_configuration','ALLOCATION_REQUIRED');status(supplied,'shopping.cart.context','needs_configuration','CART_REQUIRED');
  status(inspect(f,{sender_id:null}),'followup.queue','needs_configuration','SENDER_REQUIRED');
  status(supplied,'return.refund.form','needs_configuration','RETURN_NOT_CONFIGURED');
  const cart=f.cart(),before=effects(f),ready=inspect(f,{cart_id:cart.cart_id});
  status(ready,'order.edit.context','available');status(ready,'shopping.cart.context','available');assert.deepEqual(effects(f),before);
  assert.equal(count(f.sourceDb,'growth_source_cart_effects'),0);assert.equal(count(f.sourceDb,'edit_source_effects'),0);
}));

test('M18-G02-EDIT-SETTINGS-AND-WAREHOUSE-QUALIFICATION',()=>usingShoppingReadiness(f=>{
  status(inspect(f),'order.edit.context','available');
  f.edits.configure(f.owner.scope,{...f.settings,expected_revision:1,enabled:false});
  const disabled=inspect(f);status(disabled,'order.edit.context','disabled','EDIT_INTEGRATION_NOT_READY');
  assert.throws(()=>f.workflow.quote(f.a.scope,{case_id:'case_one',intent:{kind:'item',line_id:'line_one',variant_id:'equal',address:null}}),/EDIT_INTEGRATION_NOT_READY/);
  f.edits.configure(f.owner.scope,{...f.settings,expected_revision:2,enabled:true});status(inspect(f),'order.edit.context','available');
  f.native.configureWarehouse('warehouse_one','offline');const before=effects(f),unqualified=inspect(f);
  assert.equal(row(unqualified,'order.edit.context').available,false);assert.equal(row(unqualified,'order.edit.context').reason,'EDIT_READINESS_CHANGED');
  assert.deepEqual(effects(f),before);assert.equal(count(f.sourceDb,'edit_source_effects'),0);
}));

test('M18-G02-CART-SOURCE-CHANGES-REQUIRE-NEW-PREVIEW',()=>usingShoppingReadiness(async f=>{
  const cart=f.cart();status(inspect(f,{cart_id:cart.cart_id}),'shopping.cart.context','available');
  f.catalogSource.fixtureListing({variant_id:'basic',expected_revision:1,title:'Updated synthetic shirt',description:'Cotton shirt.',approved_descriptions:['Cotton shirt.'],terms:{id:'standard',revision:2,text:'Updated explicit terms.'}});
  const before=effects(f),view=inspect(f,{cart_id:cart.cart_id});status(view,'shopping.cart.context','temporarily_unavailable','SHOPPING_PREVIEW_CHANGED');
  assert.deepEqual(effects(f),before);await assert.rejects(()=>f.carts.confirm(f.customer,{cart_id:cart.cart_id,preview_digest:cart.preview_digest}),/SHOPPING_PREVIEW_CHANGED/);
  assert.equal(count(f.sourceDb,'growth_source_cart_effects'),0);assert.equal(f.carts.readCart(f.a.scope,cart.cart_id).state,'proposed');
}));

test('M18-G02-EXCHANGE-BROWSE-USES-EXISTING-ALLOCATION',()=>usingExchangeReadiness(f=>{
  const offer=f.exchanges.browse(f.a.scope,{allocation_id:f.allocation.id});assert.equal(offer.offers.length,1);
  const before=effects(f),view=inspect(f,{allocation_id:f.allocation.id});status(view,'exchange.offers','available');
  assert.match(row(view,'exchange.offers').evidence_digest,/^[a-f0-9]{64}$/);assert.deepEqual(effects(f),before);
  assert.equal(count(f.db,'commerce_exchange_quotes'),0,'browse readiness must not materialize a quote');
  const missing=inspect(f,{allocation_id:'unknown_allocation'});assert.equal(row(missing,'exchange.offers').available,false);
  const wrong=f.conversations.link(f.a.scope,f.customer,{case_id:'case_one',channel:'email',account_id:'merchant_mail',external_id:'another_case_thread',history:'partial',source_revision:1});
  const wrongCase=f.readiness.inspect(f.a.scope,input(f,{case_id:'case_one',link_id:wrong.id,allocation_id:f.allocation.id}));assert.equal(row(wrongCase,'exchange.offers').available,false);
}));

test('M18-G02-INTEGRITY-FAILURES-NEVER-PROMOTE-AVAILABILITY',()=>usingReadiness(f=>{
  f.db.prepare('UPDATE commerce_return_settings SET digest=? WHERE tenant_id=? AND store_id=?').run('0'.repeat(64),f.a.tenant,f.a.store);
  let before=effects(f),view=inspect(f);for(const action of ['return.refund.form','return.exchange.form'])status(view,action,'unverified','RETURN_SETTINGS_INTEGRITY');assert.deepEqual(effects(f),before);
  f.db.prepare("UPDATE commerce_support_documents SET digest=? WHERE tenant_id=? AND store_id=? AND kind='sender'").run('1'.repeat(64),f.a.tenant,f.a.store);
  before=effects(f);view=inspect(f);status(view,'followup.queue','unverified','SUPPORT_CONFIGURATION_INTEGRITY');assert.deepEqual(effects(f),before);
  f.db.prepare("UPDATE commerce_case_configurations SET digest=? WHERE tenant_id=? AND store_id=? AND case_id='case_one'").run('2'.repeat(64),f.a.tenant,f.a.store);
  assert.throws(()=>inspect(f),/CASE_PIN_INTEGRITY/);assert.equal(count(f.db,'commerce_operations'),0);
}));

test('M18-G02-QUARANTINE-EGRESS-AND-READ-ONLY-DISPATCH',()=>usingReadiness(async f=>{
  const service=new SupportService(f.kernel,f.reads,{sources:[f.supportSource]}),before=effects(f);
  const direct=inspect(f),manual:any=await service.post(f.a.scope,'journey-readiness',input(f));assert.deepEqual(manual,direct);
  assert.equal(service.runner,null);assert.equal(service.routing,null);assert.deepEqual(effects(f),before);
  f.db.prepare("INSERT INTO commerce_recovery_state VALUES(1,'readiness_restore','quarantine',?,?,?)").run('a'.repeat(64),'b'.repeat(64),f.now());
  assert.throws(()=>inspect(f),/RESTORE_WRITE_BLOCKED/);await assert.rejects(()=>service.post(f.a.scope,'journey-readiness',input(f)),/RESTORE_WRITE_BLOCKED/);
  f.db.prepare("UPDATE commerce_recovery_state SET mode='diagnostic_only' WHERE id=1").run();
  status(inspect(f),'followup.queue','disabled','RESTORE_EGRESS_BLOCKED');status(inspect(f),'remote.continue','unsupported','REMOTE_QUALIFICATION_MISSING');
  assert.deepEqual(effects(f),before);assert.equal(f.supportSource.calls,0);
}));
