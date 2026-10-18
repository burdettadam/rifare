import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { usingExecution } from './execution-helpers.mts';
import { usingReturnPortability, configurePortabilityAgent } from './return-portability-helpers.mts';
import { CommerceKernel } from '../../packages/commerce/kernel.mts';
import { SecretVault } from '../../packages/commerce/secrets.mts';
import { ActionGateway } from '../../packages/commerce/action-gateway.mts';
import { DurableWork } from '../../packages/commerce/durable-work.mts';
import { PrivacyLifecycle } from '../../packages/commerce/privacy-lifecycle.mts';
import { activateDiagnosticRestore } from '../../packages/commerce/safe-recovery.mts';
import { exportMerchant, exportMerchantSuppression, importMerchant, merchantSnapshotDigest, bindImportedCredential } from '../../packages/commerce/merchant-portability.mts';

function target(f:any,tenant='tenant-a',store='store-a') {
  const db=new DatabaseSync(':memory:'),kernel=new CommerceKernel(db,f.now);
  kernel.provisionStore(tenant,store);kernel.provisionMember(tenant,store,'new_owner','owner');
  const bearer=kernel.issueSession(tenant,store,'new_owner'),scope=kernel.authenticate(bearer);
  return {db,kernel,scope,bearer,close:()=>db.close()};
}
function snapshot(f:any){return exportMerchant(f.kernel,f.owner.scope,{snapshot_id:'merchant_one'});}
function suppression(f:any){const p=exportMerchantSuppression(f.kernel,f.owner.scope);return {suppression:p,suppression_sha256:merchantSnapshotDigest(p)};}
function changed(x:any,fn:(x:any)=>void){const c=structuredClone(x);fn(c);for(const table of c.manifest.tables)if(table.mode==='rows'){
  table.count=c.rows[table.name].length;table.sha256=merchantSnapshotDigest(c.rows[table.name]);}
  c.digest=merchantSnapshotDigest({manifest:c.manifest,rows:c.rows,credentials:c.credentials});return c;}
const count=(db:any,table:string)=>Number(db.prepare(`SELECT count(*) n FROM ${table}`).get().n);

test('CASE-M07-G07-01',()=>usingExecution(f=>{
  const preview=f.preview(),approval=f.approve(preview);f.execute(preview,approval);
  const x=snapshot(f),t=target(f);try{
    const r=importMerchant(t.kernel,t.scope,x,x.digest,suppression(f));
    assert.equal(r.mode,'quarantine');assert.equal(r.live_activation_supported,false);
    for(const table of x.manifest.tables.filter((r:any)=>r.mode==='rows')){
      const actual=table.name==='commerce_support_documents'?Number(t.db.prepare("SELECT count(*) n FROM commerce_support_documents WHERE kind!='merchant_import'").get().n):count(t.db,table.name);
      assert.equal(actual,table.count,table.name);
    }
    assert.equal(t.db.prepare("SELECT count(*) n FROM commerce_support_documents WHERE kind='merchant_import'").get().n,1);
    for(const table of ['commerce_resources','commerce_profiles','commerce_policy_versions','commerce_cases','commerce_case_configurations','commerce_action_receipts']){
      assert.ok(x.rows[table]?.length,table+' has actual fixture records');
      const rows=t.db.prepare(`SELECT * FROM ${table}`).all();
      assert.equal(merchantSnapshotDigest(rows.sort((a:any,b:any)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))),merchantSnapshotDigest(x.rows[table].sort((a:any,b:any)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))),table);
    }
    assert.deepEqual(t.db.prepare('PRAGMA foreign_key_check').all(),[]);
    assert.equal(count(t.db,'commerce_members'),1);assert.equal(t.db.prepare('SELECT actor_id FROM commerce_members').get().actor_id,'new_owner');
    assert.throws(()=>t.kernel.authenticate(f.owner.bearer),/ACCESS_DENIED/);
  }finally{t.close();}
}));

test('CASE-M07-G07-02',()=>usingExecution(f=>{
  const x=snapshot(f),t=target(f);try{
    const foreign=changed(x,c=>{c.rows.commerce_resources[0].tenant_id='tenant-b';});
    assert.throws(()=>importMerchant(t.kernel,t.scope,foreign,foreign.digest,suppression(f)),/PORTABILITY_SCOPE_MISMATCH/);
    const wrongSchema=changed(x,c=>{c.manifest.schema_version=99;});
    assert.throws(()=>importMerchant(t.kernel,t.scope,wrongSchema,wrongSchema.digest,suppression(f)),/PORTABILITY_SCHEMA_MISMATCH/);
    const credential=changed(x,c=>{c.rows.commerce_resources[0].payload=JSON.stringify({api_key:'PLAINTEXT-CREDENTIAL'});});
    assert.throws(()=>importMerchant(t.kernel,t.scope,credential,credential.digest,suppression(f)),/PORTABILITY_SECRET_REJECTED/);
    assert.equal(count(t.db,'commerce_resources'),0);assert.equal(count(t.db,'commerce_recovery_state'),0);
  }finally{t.close();}
}));

test('CASE-M07-G07-03',()=>usingExecution(f=>{
  const p=f.preview(),a=f.approve(p);f.execute(p,a);const x=snapshot(f),t=target(f);try{
    const first=importMerchant(t.kernel,t.scope,x,x.digest,suppression(f)),before=t.db.prepare('SELECT * FROM commerce_operations').all();
    assert.deepEqual(importMerchant(t.kernel,t.scope,x,x.digest,suppression(f)),first);
    assert.deepEqual(t.db.prepare('SELECT * FROM commerce_operations').all(),before);
    assert.throws(()=>new ActionGateway(t.kernel).prepare(t.scope,f.proposal()),/RESTORE_WRITE_BLOCKED/);
    const op=before[0] as any;assert.ok(op);
    activateDiagnosticRestore(t.kernel,t.scope,'merchant_one');
    assert.throws(()=>new DurableWork(t.kernel).claim(t.scope,op.id),/RESTORED_OPERATION_REPLAY_BLOCKED/);
    assert.equal(count(t.db,'commerce_operations'),before.length);
  }finally{t.close();}
}));

test('PORT-020',()=>usingExecution(f=>{
  const o=f.order();f.kernel.ingest(f.owner.scope,{kind:o.kind,source_system:o.source_system,external_id:o.external_id,source_version:o.source_version+1,source_updated_at:f.now(),customer_id:o.customer_id,payload:{...o.payload,amount_minor:'900719925474099312345',currency:'USD'}});
  const attachment=f.kernel.attach(f.owner.scope,o.id,{note:'[Customer note] Box arrived dented. [Policy](https://merchant.example.invalid/returns)'}),x=snapshot(f),t=target(f);try{
    importMerchant(t.kernel,t.scope,x,x.digest,suppression(f));
    const imported=t.kernel.lookup(t.scope,'order','synthetic',o.external_id);
    assert.equal(imported.id,o.id);assert.equal(imported.payload.amount_minor,'900719925474099312345');assert.equal(imported.payload.currency,'USD');
    assert.deepEqual(t.kernel.attachment(t.scope,attachment),{note:'[Customer note] Box arrived dented. [Policy](https://merchant.example.invalid/returns)'});
    assert.deepEqual(t.db.prepare('SELECT source_system,external_id,id FROM commerce_resources ORDER BY id').all(),f.db.prepare('SELECT source_system,external_id,id FROM commerce_resources WHERE tenant_id=? AND store_id=? ORDER BY id').all(f.a.tenant,f.a.store));
  }finally{t.close();}
}));

test('M07-G07-SECRETS-REFERENCES-REQUIRE-EXPLICIT-REBIND',()=>usingExecution(async f=>{
  let calls=0;const keys={activeId:'one',get:()=>Buffer.alloc(32,3)},adapters={probe:()=>{calls++;return true;}};
  const sourceVault=new SecretVault(f.kernel,keys,adapters),source=sourceVault.put(f.owner.scope,{provider:'synthetic',adapter:'probe',value:'SYNTHETIC-PRIVATE-SOURCE-KEY'});
  const x=snapshot(f),t=target(f);try{
    const destinationVault=new SecretVault(t.kernel,keys,adapters),destination=destinationVault.put(t.scope,{provider:'synthetic',adapter:'probe',value:'SYNTHETIC-PRIVATE-DESTINATION-KEY'});
    const r=importMerchant(t.kernel,t.scope,x,x.digest,suppression(f));
    assert.equal(JSON.stringify(x).includes('SYNTHETIC-PRIVATE-SOURCE-KEY'),false);
    assert.equal(x.rows.commerce_secrets,undefined);
    assert.deepEqual(Object.keys(x.credentials[0]).sort(),['adapter','created_at','provider','ref','revoked']);
    assert.equal(r.credential_map[0].source_ref,source.ref);assert.equal(r.credential_map[0].status,'requires_rebind');
    assert.equal(t.db.prepare('SELECT ref FROM commerce_secrets').get().ref,destination.ref);
    const binding=bindImportedCredential(t.kernel,t.scope,{snapshot_id:x.manifest.snapshot_id,source_ref:source.ref,destination_ref:destination.ref,expected_digest:x.digest});
    assert.equal(binding.status,'bound_for_reconfiguration');assert.equal(binding.execution_authorized,false);
    await assert.rejects(()=>destinationVault.probe(t.scope,destination.ref,'probe'),/RESTORE_WRITE_BLOCKED|RESTORE_EGRESS_BLOCKED/);assert.equal(calls,0);
  }finally{t.close();}
}));

test('M07-G07-INDEPENDENT-DIGEST-AND-EXACT-COVERAGE',()=>usingExecution(f=>{
  const x=snapshot(f),t=target(f);try{
    assert.throws(()=>importMerchant(t.kernel,t.scope,x,'0'.repeat(64),suppression(f)),/PORTABILITY_DIGEST_MISMATCH/);
    const missing=changed(x,c=>{delete c.rows.commerce_resources;c.manifest.tables=c.manifest.tables.filter((r:any)=>r.name!=='commerce_resources');});
    assert.throws(()=>importMerchant(t.kernel,t.scope,missing,missing.digest,suppression(f)),/PORTABILITY_COVERAGE_MISMATCH/);
    const extra=changed(x,c=>{c.rows.arbitrary_sql=[];});assert.throws(()=>importMerchant(t.kernel,t.scope,extra,extra.digest,suppression(f)),/PORTABILITY_COVERAGE_MISMATCH/);
    const column=changed(x,c=>{c.rows.commerce_resources[0].extra_column='no';});assert.throws(()=>importMerchant(t.kernel,t.scope,column,column.digest,suppression(f)),/PORTABILITY_ROW_INVALID/);
    assert.equal(count(t.db,'commerce_resources'),0);
  }finally{t.close();}
}));

test('M07-G07-RELATIONSHIP-FAILURE-ROLLS-BACK-ALL-ROWS',()=>usingExecution(f=>{
  const x=changed(snapshot(f),c=>{c.rows.commerce_cases[0].resource_id='missing_resource';}),t=target(f);try{
    assert.throws(()=>importMerchant(t.kernel,t.scope,x,x.digest,suppression(f)),/PORTABILITY_FOREIGN_KEYS_INVALID|FOREIGN KEY/);
    assert.equal(count(t.db,'commerce_resources'),0);assert.equal(count(t.db,'commerce_support_documents'),0);assert.equal(count(t.db,'commerce_recovery_state'),0);
  }finally{t.close();}
}));

test('M07-G07-NONEMPTY-AND-FOREIGN-DESTINATIONS-ARE-REJECTED',()=>usingExecution(f=>{
  const x=snapshot(f),t=target(f),foreign=target(f,'tenant-b','store-b');try{
    assert.throws(()=>importMerchant(f.kernel,f.owner.scope,x,x.digest,suppression(f)),/PORTABILITY_TARGET_NOT_EMPTY/);
    assert.throws(()=>importMerchant(foreign.kernel,foreign.scope,x,x.digest,suppression(f)),/PORTABILITY_SCOPE_MISMATCH/);
    t.kernel.provisionStore('tenant-b','store-b');assert.throws(()=>importMerchant(t.kernel,t.scope,x,x.digest,suppression(f)),/PORTABILITY_TARGET_NOT_EMPTY/);
  }finally{t.close();foreign.close();}
}));

test('M07-G07-ERASURE-SUPPRESSION-SURVIVES-IMPORT',()=>usingExecution(f=>{
  const order=f.order();new PrivacyLifecycle(f.kernel).erase(f.owner.scope,order.customer_id);
  const x=snapshot(f),t=target(f);try{
    importMerchant(t.kernel,t.scope,x,x.digest,suppression(f));
    assert.ok(count(t.db,'commerce_privacy_subjects')>0);assert.ok(count(t.db,'commerce_privacy_resources')>0);
    const row=t.db.prepare('SELECT payload,customer_id FROM commerce_resources WHERE id=?').get(order.id);
    assert.equal(row.payload,'{"redacted":true}');assert.equal(row.customer_id,null);
    assert.throws(()=>t.kernel.lookup(t.scope,'order','synthetic',order.external_id),/SUBJECT_ERASED|NOT_FOUND/);
  }finally{t.close();}
}));

test('M07-G07-LOCAL-CONTROL-AND-DUPLICATE-ROWS-DENIED',()=>usingExecution(f=>{
  const x=snapshot(f),t=target(f);try{
    const duplicate=changed(x,c=>{c.rows.commerce_resources.push(c.rows.commerce_resources[0]);});
    assert.throws(()=>importMerchant(t.kernel,t.scope,duplicate,duplicate.digest,suppression(f)),/PORTABILITY_DUPLICATE_ROW/);
    const local=changed(x,c=>{c.rows.commerce_support_documents.push({tenant_id:'tenant-a',store_id:'store-a',kind:'migration_binding',id:'installation',version:1,body:'{}',digest:'0'.repeat(64),author:'owner',state:'active',reviewer:null,review_digest:null,created_at:f.now(),expires_at:null});});
    assert.throws(()=>importMerchant(t.kernel,t.scope,local,local.digest,suppression(f)),/PORTABILITY_LOCAL_CONTROL_DENIED/);
  }finally{t.close();}
}));

test('M07-G07-ONLY-MERCHANT-OWNER-CAN-TRANSFER',()=>usingExecution(f=>{
  assert.throws(()=>exportMerchant(f.kernel,f.agent.scope,{snapshot_id:'not_allowed'}),/ACCESS_DENIED/);
  const x=snapshot(f),t=target(f);try{
    t.kernel.provisionMember('tenant-a','store-a','ordinary','operator');const s=t.kernel.authenticate(t.kernel.issueSession('tenant-a','store-a','ordinary'));
    assert.throws(()=>importMerchant(t.kernel,s,x,x.digest,suppression(f)),/ACCESS_DENIED/);assert.equal(count(t.db,'commerce_resources'),0);
  }finally{t.close();}
}));

test('M07-G07-NO-IMPLICIT-CREDENTIAL-ALIAS-OR-SNAPSHOT-REPLACEMENT',()=>usingExecution(f=>{
  const keys={activeId:'one',get:()=>Buffer.alloc(32,3)},vault=new SecretVault(f.kernel,keys,{probe:()=>true});const ref=vault.put(f.owner.scope,{provider:'synthetic',adapter:'probe',value:'fixture'});
  const x=snapshot(f),t=target(f);try{
    const targetVault=new SecretVault(t.kernel,keys,{other:()=>true}),other=targetVault.put(t.scope,{provider:'different',adapter:'other',value:'fixture'});
    importMerchant(t.kernel,t.scope,x,x.digest,suppression(f));
    assert.throws(()=>bindImportedCredential(t.kernel,t.scope,{snapshot_id:'merchant_one',source_ref:ref.ref,destination_ref:other.ref,expected_digest:x.digest}),/PORTABILITY_CREDENTIAL_MISMATCH/);
    const different=changed(x,c=>{c.manifest.snapshot_id='second_snapshot';});
    assert.throws(()=>importMerchant(t.kernel,t.scope,different,different.digest,suppression(f)),/PORTABILITY_IMPORT_CONFLICT/);
  }finally{t.close();}
}));

test('M07-G07-CONSENT-EVALUATION-AND-SETTLED-SOURCE-ROUNDTRIP',()=>usingReturnPortability(async f=>{
  const op=f.approved();await f.executor.dispatch(f.a.scope,op.id);f.advance(1);f.gatewaySource.settle(op.id);await f.executor.reconcile(f.a.scope,op.id);
  const q=configurePortabilityAgent(f,'diagnostic.return.resolve');
  f.support.consent.record(f.customer,{case_id:f.caseId,sender_id:'woo_sender',channel:'email',purpose:'marketing',state:'withdrawn',event_id:'merchant_opt_out',source_version:1,effective_at:f.now(),source_ref:'verified_customer_request'});
  const x=exportMerchant(f.kernel,f.owner.scope,{snapshot_id:'merchant_woo'}),t=target(f);try{
    const sourceEffects=count(f.gatewayDb,'fixture_woo_gateway_refunds'),sourceMovements=count(f.gatewayDb,'fixture_woo_gateway_movements');
    importMerchant(t.kernel,t.scope,x,x.digest,suppression(f));
    for(const table of ['commerce_support_consent','commerce_support_consent_events','commerce_case_configurations','commerce_resolution_operations','commerce_resolution_observations','commerce_woo_return_sources']){
      assert.ok(x.rows[table]?.length,table+' has actual fixture records');
      const actual=t.db.prepare(`SELECT * FROM ${table}`).all().sort((a:any,b:any)=>merchantSnapshotDigest(a).localeCompare(merchantSnapshotDigest(b)));
      const expected=[...x.rows[table]].sort((a:any,b:any)=>merchantSnapshotDigest(a).localeCompare(merchantSnapshotDigest(b)));
      assert.equal(merchantSnapshotDigest(actual),merchantSnapshotDigest(expected),table);
    }
    const evaluation=t.db.prepare("SELECT body,digest,state FROM commerce_support_documents WHERE kind='qualifications' AND id=? AND version=?").get(q.proof.id,q.proof.version);
    assert.equal(evaluation.digest,q.proof.digest);assert.equal(evaluation.state,'revoked');
    assert.equal(t.db.prepare('SELECT state FROM commerce_support_consent').get().state,'withdrawn');
    const money=t.db.prepare('SELECT amount_minor,currency,state,native_id FROM commerce_resolution_operations WHERE id=?').get(op.id);
    assert.equal(money.amount_minor,'1000');assert.equal(money.currency,'USD');assert.equal(money.state,'settled');assert.ok(money.native_id);
    assert.equal(count(f.gatewayDb,'fixture_woo_gateway_refunds'),sourceEffects);assert.equal(sourceEffects,1);
    assert.equal(count(f.gatewayDb,'fixture_woo_gateway_movements'),sourceMovements);assert.equal(sourceMovements,1);
  }finally{t.close();}
}));

test('M07-G07-LATER-ERASURE-CHECKPOINT-PREVENTS-RESURRECTION',()=>usingExecution(f=>{
  const order=f.order();f.kernel.attach(f.owner.scope,order.id,{note:'private customer content'});
  const x=snapshot(f);f.advance(1000);new PrivacyLifecycle(f.kernel).erase(f.owner.scope,order.customer_id);
  const latest=suppression(f),t=target(f);try{
    assert.throws(()=>importMerchant(t.kernel,t.scope,x,x.digest,undefined as any),/PORTABILITY_SUPPRESSION_REQUIRED/);
    const bad=structuredClone(latest);bad.suppression.resources=[];
    assert.throws(()=>importMerchant(t.kernel,t.scope,x,x.digest,bad),/PORTABILITY_SUPPRESSION_INVALID/);
    const stale=structuredClone(latest);stale.suppression.generated_at=x.manifest.created_at-1;stale.suppression_sha256=merchantSnapshotDigest(stale.suppression);
    assert.throws(()=>importMerchant(t.kernel,t.scope,x,x.digest,stale),/PORTABILITY_SUPPRESSION_STALE/);
    const foreign={suppression:{version:1,tenant_id:'tenant-b',store_id:'store-b',generated_at:f.now(),subjects:[],resources:[]},suppression_sha256:''};foreign.suppression_sha256=merchantSnapshotDigest(foreign.suppression);
    assert.throws(()=>importMerchant(t.kernel,t.scope,x,x.digest,foreign),/PORTABILITY_SCOPE_MISMATCH/);
    assert.equal(count(t.db,'commerce_resources'),0);
    const r=importMerchant(t.kernel,t.scope,x,x.digest,latest);
    assert.equal(r.suppression_sha256,latest.suppression_sha256);
    assert.throws(()=>t.kernel.authorize(t.scope,'resource.read',order.id),/SUBJECT_ERASED/);
    assert.equal(t.db.prepare('SELECT payload FROM commerce_resources WHERE id=?').get(order.id).payload,'{"redacted":true}');
    assert.equal(count(t.db,'commerce_attachments'),0);assert.equal(count(t.db,'commerce_privacy_subjects'),1);
    const events=count(t.db,'commerce_privacy_events');assert.deepEqual(importMerchant(t.kernel,t.scope,x,x.digest,latest),r);
    assert.equal(count(t.db,'commerce_privacy_events'),events);
  }finally{t.close();}
}));
