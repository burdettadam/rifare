import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { usingSupport } from './support-helpers.mts';
import { syntheticHeaders } from './execution-helpers.mts';
import { CommerceKernel } from '../../packages/commerce/kernel.mts';
import { CustomerAccess } from '../../packages/commerce/customer-access.mts';
import { PrivacyLifecycle } from '../../packages/commerce/privacy-lifecycle.mts';
import { auditPrivacyCoverage, privacySurfaceContract, checkPrivacyRuntimeSources } from '../../packages/commerce/privacy-coverage.mts';
import { ReturnIntake } from '../../packages/commerce/return-intake.mts';
import { ReturnEvidence } from '../../packages/commerce/return-evidence.mts';
import { SupportMetrics } from '../../packages/commerce/support-metrics.mts';
import { SupportConversations } from '../../packages/commerce/support-conversations.mts';
import { WebhookInbox } from '../../packages/commerce/webhook-inbox.mts';
import { SecretVault } from '../../packages/commerce/secrets.mts';
import { activateDiagnosticRestore } from '../../packages/commerce/safe-recovery.mts';
import { assertRecoveryEgress } from '../../packages/commerce/data-guards.mts';
import { exportMerchant, exportMerchantSuppression, importMerchant, merchantSnapshotDigest } from '../../packages/commerce/merchant-portability.mts';
import { jsonValue } from '../../packages/commerce/configuration-values.mts';
import { readAdapterCatalog, validateAdapterCatalog } from '../../packages/conformance/adapter-catalog.mts';

const SENTINEL='SYNTHETIC_PRIVACY_CUSTOMER_NOTE';
const PHOTO=JSON.parse(readFileSync(new URL('../fixtures/return-intake/photo.v1.json',import.meta.url),'utf8')).base64;
const GROWTH_TABLES=[
  'commerce_cart_recoveries','commerce_catalog_approvals','commerce_catalog_changes','commerce_catalog_evaluations',
  'commerce_checkout_assignments','commerce_checkout_experiments','commerce_checkout_exposures','commerce_email_action_links',
  'commerce_growth_campaign_approvals','commerce_growth_campaign_recipients','commerce_growth_campaigns','commerce_growth_observations',
  'commerce_marketing_segments','commerce_marketing_sync_operations','commerce_optional_configurations','commerce_optional_consents',
  'commerce_optional_deletions','commerce_optional_media','commerce_optional_operations','commerce_optional_quality',
  'commerce_shopping_carts','commerce_upsell_confirmations','commerce_upsell_offers',
];
function populate(f:any){
  const order=f.order(),privacy=new PrivacyLifecycle(f.kernel),metrics=new SupportMetrics(f.kernel);
  f.conversations.ingest(f.a.scope,{link_id:f.link.id,external_id:'privacy_message',direction:'incoming',visibility:'public',text:SENTINEL,source_at:f.now()});
  f.consent.record(f.customer,f.grant({event_id:'privacy_consent'}));
  const attachment=f.kernel.attach(f.a.scope,order.id,{note:SENTINEL});
  // The support fixture's `source` is its provider ledger, not the read
  // fixture's knowledge-input builder. Populate the real knowledge API directly.
  f.reads.knowledge.put(f.a.scope,{id:'privacy_knowledge',revision:1,kind:'support',title:'Synthetic privacy note',content:SENTINEL,
    source_uri:'https://merchant.example.invalid/privacy-note',source_updated_at:f.now(),expires_at:f.now()+60000,visibility:'store',resource_id:order.id});
  f.reads.profiles.put(f.a.scope,f.profile(f.a,{id:'privacy_task'}));
  const task=f.reads.createTask(f.a.scope,{order_id:order.id,profile_id:'privacy_task'});
  new ReturnIntake(f.kernel).configure(f.owner.scope,{expected_revision:0,settings:{currency:'USD',restocking_bps:0,shipping_minor:'0',time_zone:'America/Denver',brand:'Synthetic',contact:'support@example.invalid',override_days:7,retention_days:30}});
  const evidence=new ReturnEvidence(f.kernel),media=evidence.upload(f.customer,{case_id:'case_one',mime:'image/png',base64:PHOTO,note:SENTINEL});
  metrics.freeze(f.a.scope,{id:'privacy_cohort',case_ids:['case_one'],starts_at:f.now(),ends_at:f.now()+60000});
  const key=Buffer.alloc(32,7),vault=new SecretVault(f.kernel,{activeId:'one',get:()=>Buffer.alloc(32,3)},{webhook:()=>true});
  const secret=vault.put(f.owner.scope,{provider:'synthetic',adapter:'webhook',value:key.toString('base64')});
  const inbox=new WebhookInbox(f.kernel,()=>key),route=inbox.register(f.owner.scope,{provider:'synthetic',topic:'orders/updated',shop_domain:'privacy.example.invalid',api_version:'2026-10',key_ref:secret.ref});
  const bytes=Buffer.from(JSON.stringify({note:SENTINEL}));
  const webhook=inbox.receive(route.id,syntheticHeaders(route,bytes,key,f.now(),'privacy_delivery'),bytes);
  return {order,privacy,metrics,attachment,task,evidence,media,inbox,webhook};
}
function assertErased(db:any,tenant:string,store:string,orderId:string){
  for(const table of ['commerce_attachments','commerce_knowledge','commerce_context_tasks'])assert.equal(db.prepare(`SELECT count(*) n FROM ${table} WHERE tenant_id=? AND store_id=?`).get(tenant,store).n,0,table);
  for(const table of ['commerce_support_messages','commerce_support_contacts','commerce_support_consent','commerce_support_consent_events','commerce_return_evidence']){
    const rows=db.prepare(`SELECT * FROM ${table} WHERE tenant_id=? AND store_id=?`).all(tenant,store);
    assert.ok(rows.length,table+' retained suppression/minimized row exists');
    assert.equal(JSON.stringify(rows).includes(SENTINEL),false,table);
    assert.equal(JSON.stringify(rows).includes('shopper-apparel@example.invalid'),false,table);
  }
  assert.equal(db.prepare('SELECT bytes,note FROM commerce_return_evidence WHERE tenant_id=? AND store_id=?').get(tenant,store).bytes,null);
  assert.equal(db.prepare('SELECT payload FROM commerce_resources WHERE id=?').get(orderId).payload,'{"redacted":true}');
  const webhook=db.prepare('SELECT body,status FROM commerce_webhook_inbox WHERE tenant_id=? AND store_id=?').get(tenant,store);
  assert.equal(Buffer.from(webhook.body).toString(),'{"redacted":true}');assert.equal(webhook.status,'quarantined');
  assert.equal(db.prepare('SELECT state FROM commerce_support_consent WHERE tenant_id=? AND store_id=?').get(tenant,store).state,'withdrawn');
}

test('CASE-M07-G14-01',()=>usingSupport(f=>{
  const x=populate(f),exported=x.privacy.export(f.owner.scope,x.order.customer_id);
  assert.equal(exported.support_records.commerce_support_consent.length,1);
  assert.equal(exported.support_records.commerce_support_consent_events[0].id,'privacy_consent');
  assert.equal(exported.analytics_records.metric_cohorts[0].members[0].case_id,'case_one');
  assert.equal(exported.attachments[0].content.note,SENTINEL);assert.equal(exported.return_evidence[0].bytes,PHOTO);
  assert.equal(exported.knowledge[0].content,SENTINEL);assert.equal(exported.tasks[0].id,x.task.id);
  assert.equal(exported.unbound_text_requires_manual_scope_review,true);assert.equal(exported.credentials_included,false);
  assert.equal(x.privacy.erase(f.owner.scope,x.order.customer_id).status,'logically_erased');
  assertErased(f.db,f.a.tenant,f.a.store,x.order.id);
  assert.throws(()=>f.conversations.history(f.a.scope,'case_one'),/SUBJECT_ERASED|ACCESS_DENIED/);
  assert.throws(()=>f.reads.task(f.a.scope,x.task.id),/NOT_FOUND|SUBJECT_ERASED/);
  assert.throws(()=>x.evidence.inspect(f.a.scope,x.media.id),/SUBJECT_ERASED/);
  const rebuilt=x.metrics.report(f.a.scope,'privacy_cohort');assert.equal(rebuilt.denominator,1);assert.equal(rebuilt.unavailable_cases,1);
  assert.deepEqual(rebuilt.cases,[{case_id:'case_one',state:'unavailable_still_in_denominator'}]);
}));

test('CASE-M07-G14-02',()=>usingSupport(f=>{
  f.db.exec('CREATE TABLE unregistered_agent_memory(customer_id TEXT, content TEXT)');
  assert.throws(()=>auditPrivacyCoverage(f.kernel,f.owner.scope),/STORAGE_INVENTORY_CHANGED/);
  assert.throws(()=>new PrivacyLifecycle(f.kernel).erase(f.owner.scope,f.order().customer_id),/STORAGE_INVENTORY_CHANGED/);
}));

test('CASE-M07-G14-03',()=>usingSupport(f=>{
  const x=populate(f),before=exportMerchant(f.kernel,f.owner.scope,{snapshot_id:'privacy_before_erasure'});
  f.advance(1);x.privacy.erase(f.owner.scope,x.order.customer_id);
  const cp=exportMerchantSuppression(f.kernel,f.owner.scope),db=new DatabaseSync(':memory:');
  try{
    const k=new CommerceKernel(db,f.now);k.provisionStore(f.a.tenant,f.a.store);k.provisionMember(f.a.tenant,f.a.store,'new_owner','owner');const scope=k.authenticate(k.issueSession(f.a.tenant,f.a.store,'new_owner'));
    const result=importMerchant(k,scope,before,before.digest,{suppression:cp,suppression_sha256:merchantSnapshotDigest(cp)});
    assert.equal(result.mode,'quarantine');assert.equal(result.live_activation_supported,false);
    assertErased(db,f.a.tenant,f.a.store,x.order.id);
    assert.throws(()=>k.get(scope,x.order.id),/SUBJECT_ERASED/);
    assert.throws(()=>new SupportConversations(k).history(scope,'case_one'),/SUBJECT_ERASED/);
    assert.throws(()=>new SupportMetrics(k).report(scope,'privacy_cohort'),/RESTORE_WRITE_BLOCKED/);
    const restored=db.prepare('SELECT restore_id,mode,source_digest,suppression_digest FROM commerce_recovery_state WHERE id=1').get();
    assert.equal(restored.restore_id,result.snapshot_id);assert.equal(restored.mode,'quarantine');
    assert.equal(restored.source_digest,before.digest);assert.equal(restored.suppression_digest,merchantSnapshotDigest(cp));
    // Respect the existing normal recovery lifecycle before rebuilding analytics.
    assert.equal(db.prepare("SELECT count(*) n FROM commerce_operations WHERE state IN ('sending','unknown')").get().n,0);
    const activation=activateDiagnosticRestore(k,scope,restored.restore_id);
    assert.equal(activation.mode,'diagnostic_only');assert.equal(activation.egress_enabled,false);
    assert.equal(activation.new_approval_required,true);assert.equal(activation.old_operations_replayable,false);
    assert.equal(db.prepare('SELECT mode FROM commerce_recovery_state WHERE id=1').get().mode,'diagnostic_only');
    assert.throws(()=>assertRecoveryEgress(k),/RESTORE_EGRESS_BLOCKED/);
    const rebuilt=new SupportMetrics(k).report(scope,'privacy_cohort');assert.equal(rebuilt.denominator,1);assert.equal(rebuilt.unavailable_cases,1);
    assert.equal(JSON.stringify(rebuilt).includes(SENTINEL),false);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{db.close();}
}));

test('M07-G14-ALL-170-TABLES-HAVE-EXPLICIT-SURFACES',()=>usingSupport(f=>{
  const r=auditPrivacyCoverage(f.kernel,f.owner.scope),actual=f.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((x:any)=>x.name);
  assert.equal(r.tables.length,209);assert.deepEqual(r.tables.map((t:any)=>t.name).sort(),actual);
  const baseline=JSON.parse(readFileSync(new URL('../fixtures/shipping/storage-baseline.v1.json',import.meta.url),'utf8'));
  assert.equal(baseline.tables.length,170);
  const originalNames=new Set(baseline.tables.map((t:any)=>t.name));
  const original178=JSON.parse(readFileSync(new URL('../fixtures/inventory-reconciliation/storage-baseline.v1.json',import.meta.url),'utf8'));
  assert.equal(original178.tables.length,178);assert.equal(original178.protected_base,'60bdc1fa1281ea165a4edbf815eb8a1b02004ecf');
  const original178Names=new Set(original178.tables.map((t:any)=>t.name));
  const original186=JSON.parse(readFileSync(new URL('../fixtures/growth/storage-baseline.v1.json',import.meta.url),'utf8'));
  assert.equal(original186.tables.length,186);assert.equal(original186.protected_base,'63767bbd0a1dbcc49475827afaee5402dc00a3ba');
  const original186Names=new Set(original186.tables.map((t:any)=>t.name));
  assert.deepEqual(r.tables.filter((t:any)=>original186Names.has(t.name)).map((t:any)=>({name:t.name,surface:t.surface,handling:t.handling})).sort((a:any,b:any)=>a.name.localeCompare(b.name)),original186.tables);
  assert.deepEqual(r.tables.filter((t:any)=>!original186Names.has(t.name)).map((t:any)=>t.name).sort(),GROWTH_TABLES);
  assert.deepEqual(r.tables.filter((t:any)=>original178Names.has(t.name)).map((t:any)=>({name:t.name,surface:t.surface,handling:t.handling})).sort((a:any,b:any)=>a.name.localeCompare(b.name)),original178.tables);
  assert.deepEqual(r.tables.filter((t:any)=>original186Names.has(t.name)&&!original178Names.has(t.name)).map((t:any)=>t.name).sort(),[
    'commerce_inventory_discrepancies','commerce_inventory_movements','commerce_inventory_owners','commerce_inventory_snapshots',
    'commerce_inventory_transfer_approvals','commerce_inventory_transfer_operations','commerce_inventory_transfers','commerce_warehouse_return_events',
  ]);
  assert.deepEqual(r.tables.filter((t:any)=>originalNames.has(t.name)).map((t:any)=>({name:t.name,surface:t.surface,handling:t.handling})).sort((a:any,b:any)=>a.name.localeCompare(b.name)),baseline.tables);
  assert.deepEqual(r.tables.filter((t:any)=>original178Names.has(t.name)&&!originalNames.has(t.name)).map((t:any)=>t.name).sort(),[
    'commerce_packing_allocations','commerce_packing_confirmations','commerce_packing_scans','commerce_packing_sessions',
    'commerce_shipping_label_approvals','commerce_shipping_label_operations','commerce_shipping_manifest_events','commerce_shipping_manifest_packages',
  ]);
  assert.ok(r.tables.every((t:any)=>t.surface&&t.handling));assert.equal(r.local_inventory_current,true);
  assert.equal(r.deployment_coverage_verified,false);assert.equal(r.privacy_qualified,false);assert.equal(r.physical_erasure,false);
  assert.ok(r.outstanding.some((x:any)=>x.surface==='provider_copies'));assert.ok(r.outstanding.some((x:any)=>x.surface==='recovery_files_and_database_pages'));
  // The additive catalog retains all prior obligations. Its dedicated bounded
  // decoder must not widen the generic configuration-input limit.
  const catalog=readAdapterCatalog(),checked=validateAdapterCatalog(catalog);
  assert.equal(checked.external_qualification,false);assert.equal(checked.direct_fixture_count,47);
  assert.throws(()=>jsonValue({value:'x'.repeat(131073)}),/CONFIGURATION_INVALID/);
  assert.throws(()=>validateAdapterCatalog({...catalog,fixture_administration:'x'.repeat(262145)}),/CONFIGURATION_INVALID/);
}));

test('M07-G14-MISSING-AND-UNKNOWN-SURFACES-BLOCK',()=>usingSupport(f=>{
  const surfaces=privacySurfaceContract().surfaces.map((s:any)=>s.id);
  assert.throws(()=>auditPrivacyCoverage(f.kernel,f.owner.scope,{observed_surfaces:surfaces.filter((s:string)=>s!=='agent_task_state')}),/PRIVACY_SURFACE_INVENTORY_INCOMPLETE/);
  assert.throws(()=>auditPrivacyCoverage(f.kernel,f.owner.scope,{observed_surfaces:surfaces.filter((s:string)=>s!=='analytics_readmodels')}),/PRIVACY_SURFACE_INVENTORY_INCOMPLETE/);
  assert.throws(()=>auditPrivacyCoverage(f.kernel,f.owner.scope,{observed_surfaces:[...surfaces,'unregistered_vector_cache']}),/PRIVACY_SURFACE_INVENTORY_INCOMPLETE/);
  const r=auditPrivacyCoverage(f.kernel,f.owner.scope,{observed_surfaces:surfaces});assert.equal(r.surface_declaration_matched,true);assert.equal(r.deployment_coverage_verified,false);
}));

test('M07-G14-RUNTIME-CACHE-ADDITION-OR-DRIFT-REQUIRES-REVIEW',()=>{
  const sources=privacySurfaceContract().runtime_sources;
  assert.throws(()=>checkPrivacyRuntimeSources(sources.slice(1)),/PRIVACY_RUNTIME_REVIEW_REQUIRED/);
  assert.throws(()=>checkPrivacyRuntimeSources([...sources,{path:'packages/commerce/new-vector-cache.mts',sha256:'0'.repeat(64)}]),/PRIVACY_RUNTIME_REVIEW_REQUIRED/);
  const modified=structuredClone(sources);modified.find((x:any)=>x.path==='packages/agent/runner.mts').sha256='0'.repeat(64);
  assert.throws(()=>checkPrivacyRuntimeSources(modified),/PRIVACY_RUNTIME_REVIEW_REQUIRED/);
});

test('M07-G14-EXPORT-CONSENT-AND-ANALYTICS-ARE-SUBJECT-SCOPED',()=>usingSupport(f=>{
  const x=populate(f);
  // Add a second real customer and case in the same store through the existing proof flow.
  f.kernel.ingest(f.a.scope,{kind:'customer',source_system:'synthetic',external_id:'different_customer',source_version:1,source_updated_at:f.now(),customer_id:'different_customer',payload:{email:'different@example.invalid',name:'OTHER_PRIVATE_CUSTOMER'}});
  const other=f.kernel.ingest(f.a.scope,{kind:'order',source_system:'synthetic',external_id:'OTHER-ORDER',source_version:1,source_updated_at:f.now(),customer_id:'different_customer',payload:{...x.order.payload}});
  const proofs:any[]=[],customers=new CustomerAccess(f.kernel,p=>proofs.push(p));
  const challenge=customers.request({store_id:f.a.store,order_number:'OTHER-ORDER',email:'different@example.invalid'},'127.0.0.2');
  const verified=customers.complete({store_id:f.a.store,challenge_id:challenge.challenge_id,proof:proofs.at(-1).proof}),scope=f.kernel.authenticate(verified.token);
  f.cases.create(scope,{case_id:'different_case',resource_id:other.id,profile_id:'default',policy_id:'returns'});
  f.consent.record(scope,f.grant({case_id:'different_case',event_id:'different_consent'}));
  x.metrics.freeze(f.a.scope,{id:'mixed_cohort',case_ids:['case_one','different_case'],starts_at:f.now(),ends_at:f.now()+60000});
  const foreign=f.kernel.list(f.b.scope,'order');
  const exported=x.privacy.export(f.owner.scope,x.order.customer_id),serialized=JSON.stringify(exported);
  assert.equal(serialized.includes('different_customer'),false);assert.equal(serialized.includes('OTHER_PRIVATE_CUSTOMER'),false);assert.equal(serialized.includes('OTHER-ORDER'),false);
  assert.equal(serialized.includes('different_case'),false);assert.equal(serialized.includes('different_consent'),false);
  assert.deepEqual(exported.analytics_records.metric_cohorts.find((c:any)=>c.id==='mixed_cohort').members.map((m:any)=>m.case_id),['case_one']);
  assert.equal(serialized.includes(f.b.store),false);assert.equal(serialized.includes(f.kernel.require(f.customer).token_hash),false);
  assert.throws(()=>auditPrivacyCoverage(f.kernel,f.a.scope),/ACCESS_DENIED/);
  x.privacy.erase(f.owner.scope,x.order.customer_id);assert.deepEqual(f.kernel.list(f.b.scope,'order'),foreign);
}));

test('M07-G14-HELD-COPIES-ARE-RETAINED-AND-EXPORTED',()=>usingSupport(f=>{
  const x=populate(f);x.privacy.hold(f.owner.scope,{customer_id:x.order.customer_id,reason:'dispute',authority_ref:'privacy_case_hold',expires_at:f.now()+1000});
  assert.equal(x.privacy.erase(f.owner.scope,x.order.customer_id).status,'held');
  const e=x.privacy.export(f.owner.scope,x.order.customer_id);assert.equal(e.return_evidence[0].bytes,PHOTO);assert.equal(e.support_records.commerce_support_consent[0].state,'granted');
  assert.equal(f.conversations.history(f.a.scope,'case_one').messages[0].text,SENTINEL);
  x.privacy.releaseHold(f.owner.scope,x.order.customer_id,'privacy_case_hold');assert.equal(x.privacy.erase(f.owner.scope,x.order.customer_id).status,'logically_erased');
}));

test('M07-G14-UNINSTALL-DISCONNECTS-AND-RETAINS-NAMED-LIMITS',()=>usingSupport(f=>{
  const x=populate(f),vault=new SecretVault(f.kernel,{activeId:'one',get:()=>Buffer.alloc(32,3)},{probe:()=>true});
  vault.put(f.owner.scope,{provider:'synthetic',adapter:'probe',value:'SYNTHETIC_PRIVATE_CREDENTIAL'});
  const result=x.privacy.uninstall(f.owner.scope);assert.equal(result.status,'disconnected');assert.equal(result.physical_deletion,false);
  assertErased(f.db,f.a.tenant,f.a.store,x.order.id);
  assert.equal(f.db.prepare('SELECT envelope,revoked FROM commerce_secrets').get().envelope,'{}');assert.equal(f.db.prepare('SELECT envelope,revoked FROM commerce_secrets').get().revoked,1);
  assert.throws(()=>f.kernel.require(f.owner.scope),/ACCESS_DENIED/);assert.equal(f.source.calls,0);
}));
