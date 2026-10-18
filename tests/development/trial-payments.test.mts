import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,readFileSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { InstantExchangeFixtureSource } from '../../packages/adapters/instant-exchange-fixture-source.mts';
import { usingTrials,oracle,captureCount,populateTrialPrivacy } from './trial-payments-helpers.mts';

async function mutant(name:string,marker:string,replacement:string,run:(broken:any,module:any)=>unknown){
 const directory=mkdtempSync(join(tmpdir(),'rifare-trial-mutant-'));
 try{const url=new URL('../../packages/adapters/delivery-trial-source-guards.mts',import.meta.url),original=readFileSync(url,'utf8');assert.equal(original.split(marker).length,2);
  const source=original.replace(marker,replacement).replace(/from '([.][^']+)'/g,(_all,path)=>"from '"+new URL(path,url).href+"'");
  const target=join(directory,'mutant.mts');writeFileSync(target,source);const module=await import(pathToFileURL(target).href);await run(module[name],module);
 }finally{rmSync(directory,{recursive:true,force:true});}
}

test('M10-G13-PREP-01',()=>usingTrials(async f=>{
 const before=f.trials.read(f.a.scope,f.trial.id);assert.equal(before.clock.started_at,null);assert.equal(before.authorization,null);assert.equal(captureCount(f),0);
 const op=await f.authorize();const authorized=f.trials.read(f.a.scope,f.trial.id);
 assert.equal(authorized.authorization.expires_at,f.startedAt+oracle.authorization_duration_ms);assert.equal(authorized.maximum_minor,'3000');assert.equal(authorized.clock.started_at,null);
 f.advance(15000);const delivered=f.delivery();const current=f.trials.observeDelivery(f.a.scope,{trial_id:f.trial.id,event_id:delivered.event_id});
 assert.equal(current.clock.started_at,f.startedAt+15000);assert.equal(current.clock.ends_at,f.startedAt+75000);assert.equal(current.clock.capture_after,f.startedAt+85000);
 assert.equal(current.authorization.expires_at,f.startedAt+600000);assert.equal(current.authorization.operation_id,op.id);assert.equal(current.currency,'USD');assert.equal(current.external_qualified,false);
 assert.equal(current.binding.native_original_order_id,f.order().payload.native_order_id);assert.equal(Object.hasOwn(current.binding,'native_return_id'),false);assert.equal(Object.hasOwn(current.binding,'exchange_quote_id'),false);assert.equal(Object.hasOwn(current.binding,'original_paid_minor'),false);
 assert.equal(captureCount(f),0);assert.equal(f.warehouse.stock('shirt-small','trial-warehouse'),10);
 assert.throws(()=>f.trials.read(f.b.scope,f.trial.id),/NOT_FOUND|ACCESS_DENIED/);
}));

test('M10-G13-PREP-02',async()=>{
 await usingTrials(async f=>{
  const q=f.instant.quoteAuthorize(f.a.scope,{trial_id:f.trial.id,consent_id:f.consent.id}),op=f.approve(q),command=JSON.parse(f.kernel.db.prepare('SELECT command FROM commerce_instant_operations WHERE id=?').get(op.id).command);
  assert.throws(()=>f.source.bindOperation(command),/TRIAL_GUARD_REQUIRED/);assert.equal(captureCount(f),0);
  const issue=f.source.issue.bind(f.source);f.source.issue=async current=>{
   const reopenedDb=new DatabaseSync(f.sourceFilename);try{const reopened=new InstantExchangeFixtureSource(reopenedDb,{mode:'fixture',tenant:f.a.tenant,store:f.a.store,identity:'delivery-trial-source',clock:f.now});
    // The canonical dispatcher has now persisted this exact original binding.
    assert.equal(reopenedDb.prepare('SELECT count(*) n FROM fixture_instant_operation_bindings WHERE id=?').get(current.operation_id).n,1);
    await assert.rejects(reopened.issue(current),/TRIAL_GUARD_REQUIRED/);const result=await issue(current);
    assert.deepEqual(await reopened.lookup(current.operation_id),result);return result;
   }finally{reopenedDb.close();}
  };
  assert.equal((await f.instant.dispatch(f.a.scope,op.id)).state,'mandate_active');f.delivery();f.advance(70001);
  f.readiness.outage(f.owner.scope,{service:'trial_payments',account_id:'trial-account',unavailable:true});assert.throws(()=>f.instant.quoteCapture(f.a.scope,{obligation_id:f.obligationId}),/PARTNER|TRIAL/);
 });
 await usingTrials(f=>{
  const current=f.facts.window('trial-account');f.facts.qualifyWindow({...f.windowInput,expected_revision:current.revision,authorization_duration_ms:60000});
  assert.throws(()=>f.trials.consent(f.customer,{trial_id:f.trial.id,consent_id:'short-consent',terms_digest:f.terms.digest,maximum_minor:'3000',confirmed:true,extension_ms:0,reauthorization_of:null}),/TRIAL|PARTNER/);assert.equal(captureCount(f),0);
 });
 await usingTrials(f=>{
  const customer=f.kernel.db.prepare("SELECT * FROM commerce_resources WHERE tenant_id=? AND store_id=? AND kind='customer' AND external_id=?").get(f.a.tenant,f.a.store,f.order().customer_id),payload=JSON.parse(customer.payload);
  f.kernel.ingest(f.a.scope,{kind:'customer',source_system:customer.source_system,external_id:customer.external_id,source_version:customer.source_version+1,source_updated_at:f.now(),customer_id:customer.customer_id,payload:{...payload,email:'changed-owner@example.invalid'}});
  assert.throws(()=>f.instant.quoteAuthorize(f.a.scope,{trial_id:f.trial.id,consent_id:f.consent.id}),/CUSTOMER|TRIAL/);assert.equal(captureCount(f),0);
 });
});

test('M10-G13-PREP-03',async()=>{
 await usingTrials(async f=>{
  await f.authorize();f.advance(10000);const first=f.delivery();const observed=f.trials.observeDelivery(f.a.scope,{trial_id:f.trial.id,event_id:first.event_id});
  assert.deepEqual(f.trials.observeDelivery(f.a.scope,{trial_id:f.trial.id,event_id:first.event_id}).clock,observed.clock);
  f.advance(20000);const corrected=f.delivery({event_id:'delivery-correction',sequence:2,correction_of:first.event_id,delivered_at:f.now()});const changed=f.trials.observeDelivery(f.a.scope,{trial_id:f.trial.id,event_id:corrected.event_id});
  assert.equal(changed.clock.started_at,f.startedAt+30000);assert.equal(changed.clock.ends_at,f.startedAt+90000);assert.equal(changed.clock.corrections,1);
  const earlier=f.delivery({event_id:'earlier-correction',sequence:3,correction_of:corrected.event_id,delivered_at:f.startedAt+5000});assert.equal(f.trials.observeDelivery(f.a.scope,{trial_id:f.trial.id,event_id:earlier.event_id}).clock.started_at,f.startedAt+30000);
  assert.equal(f.kernel.db.prepare('SELECT count(*) n FROM commerce_trial_events WHERE kind=\'delivery\'').get().n,3);
 });
 await mutant('deliveryTrialClock','const startedAt = Math.max(...delivered.map((event:Row)=>event.delivered_at));','const startedAt = binding.created_at;',broken=>usingTrials(async f=>{
  await f.authorize();f.advance(15000);f.delivery();const value=broken(f.source,f.binding,f.terms.body,0);
  assert.throws(()=>assert.equal(value.started_at,f.startedAt+15000,'The trial must start at observed delivery, never creation'),assert.AssertionError);
 }));
});

test('M10-G14-PREP-01',async()=>{
 await usingTrials(async f=>{
  await f.authorize();f.advance(1000);f.delivery();await f.returned([1],true);f.advance(oracle.trial_ms+oracle.return_grace_ms+1);
  const quote=f.instant.quoteCapture(f.a.scope,{obligation_id:f.obligationId});assert.equal(quote.quote.amount_minor,oracle.retained_after_one_return_minor);
  const op=f.approve(quote),result=await f.instant.dispatch(f.a.scope,op.id);assert.equal(result.state,'captured');assert.equal(result.source.captured_minor,oracle.captured_after_one_return_minor);
  assert.equal(captureCount(f),oracle.native_capture_count);assert.equal(f.warehouse.stock('shirt-small','trial-warehouse'),10);
  assert.equal(f.source.db.prepare('SELECT currency FROM fixture_instant_captures').get().currency,'USD');assert.throws(()=>f.instant.quoteCapture(f.a.scope,{obligation_id:f.obligationId}),/INSTANT|TRIAL/);
 });
 await usingTrials(async f=>{
  await f.authorize();f.advance(1000);f.delivery();const initial=f.trials.read(f.a.scope,f.trial.id).clock;
  f.advance(1000);const consent=f.trials.consent(f.customer,{trial_id:f.trial.id,consent_id:'extended-consent',terms_digest:f.terms.digest,maximum_minor:'3000',confirmed:true,extension_ms:30000,reauthorization_of:f.obligationId});
  const quote=f.instant.quoteReauthorize(f.a.scope,{obligation_id:f.obligationId,consent_id:consent.id});assert.equal(f.trials.read(f.a.scope,f.trial.id).clock.ends_at,initial.ends_at);
  const op=f.approve(quote);assert.equal((await f.instant.dispatch(f.a.scope,op.id)).state,'mandate_active');assert.equal(f.trials.read(f.a.scope,f.trial.id).clock.ends_at,initial.ends_at+30000);assert.equal(captureCount(f),0);
 });
 await usingTrials(async f=>{
  await f.authorize();f.delivery();await f.returned([1,2,3],true);f.advance(70001);
  assert.throws(()=>f.instant.quoteCapture(f.a.scope,{obligation_id:f.obligationId}),/INSTANT_NOT_COLLECTIBLE/);
  const op=f.approve(f.instant.quoteCancel(f.a.scope,{obligation_id:f.obligationId})),result=await f.instant.dispatch(f.a.scope,op.id);
  assert.equal(result.state,'canceled');assert.equal(result.source.remaining_minor,'0');assert.equal(captureCount(f),0);assert.equal(f.warehouse.stock('shirt-small','trial-warehouse'),10);
 });
});

test('M10-G14-PREP-02',async()=>{
 await usingTrials(async f=>{await f.authorize();f.delivery();await f.returned([1],false);f.advance(70001);assert.throws(()=>f.instant.quoteCapture(f.a.scope,{obligation_id:f.obligationId}),/TRIAL_RECEIPTS_UNCERTAIN/);assert.equal(captureCount(f),0);});
 await usingTrials(async f=>{await f.authorize();f.delivery();f.advance(oracle.authorization_duration_ms+1);assert.throws(()=>f.instant.quoteCapture(f.a.scope,{obligation_id:f.obligationId}),/EXPIRED|REAUTHORIZATION|VERIFICATION/);assert.equal(captureCount(f),0);});
 await usingTrials(async f=>{
  await f.authorize();f.delivery();assert.throws(()=>f.trials.consent(f.customer,{trial_id:f.trial.id,consent_id:'unapproved-extension',terms_digest:f.terms.digest,maximum_minor:'3000',confirmed:true,extension_ms:oracle.maximum_extension_ms+1,reauthorization_of:f.obligationId}),/TRIAL_EXTENSION/);
  f.advance(70001);const op=f.approve(f.instant.quoteCapture(f.a.scope,{obligation_id:f.obligationId})),issue=f.source.issue.bind(f.source);
  f.source.issue=async(command:any)=>{f.readiness.outage(f.owner.scope,{service:'trial_payments',account_id:'trial-account',unavailable:true});return issue(command);};
  const result=await f.instant.dispatch(f.a.scope,op.id);assert.ok(['rejected','unknown'].includes(result.state));assert.equal(captureCount(f),0);
 });
 await usingTrials(async f=>{const populated=await populateTrialPrivacy(f);assert.equal(populated.trial_id,f.trial.id);assert.equal(captureCount(f),0);});
});

test('M10-G14-PREP-03',async()=>{
 await usingTrials(async f=>{
  await f.authorize();f.delivery();f.advance(70001);const original=f.approve(f.instant.quoteCapture(f.a.scope,{obligation_id:f.obligationId})),issue=f.source.issue.bind(f.source);
  f.source.issue=async(command:any)=>{if(command.kind==='capture')await f.returned([1],true);return issue(command);};
  const first=await f.instant.dispatch(f.a.scope,original.id);assert.equal(first.state,'rejected');assert.equal(captureCount(f),0);f.source.issue=issue;
  const final=f.approve(f.instant.quoteCapture(f.a.scope,{obligation_id:f.obligationId}));f.source.fault='after';const outcomes=await Promise.all([f.instant.dispatch(f.a.scope,final.id),f.instant.dispatch(f.a.scope,final.id)]);
  assert.ok(outcomes.every(result=>result.state==='unknown'));assert.equal(captureCount(f),1);assert.equal(f.source.db.prepare('SELECT captured_minor FROM fixture_instant_captures').get().captured_minor,'2000');
  assert.throws(()=>f.instant.quoteCapture(f.a.scope,{obligation_id:f.obligationId}),/INSTANT|TRIAL/);
  f.readiness.outage(f.owner.scope,{service:'trial_payments',account_id:'trial-account',unavailable:true});const recovered=await f.instant.reconcile(f.a.scope,final.id);
  assert.equal(recovered.id,final.id);assert.equal(recovered.state,'captured');assert.equal(captureCount(f),1);assert.equal(f.warehouse.stock('shirt-small','trial-warehouse'),10);
 });
 await mutant('deliveryTrialBalance','const retained = binding.units.filter((unit:Row)=>!received.has(unit.line_id+\':\'+unit.unit_index));','const retained = binding.units;',(broken,module)=>usingTrials(async f=>{
  await f.authorize();f.delivery();await f.returned([1],true);new module.DeliveryTrialFacts(f.source).bindWarehouse(f.warehouse);const value=broken(f.source,f.binding);
  assert.equal(value.remaining.toString(),'3000');assert.throws(()=>assert.equal(value.remaining.toString(),oracle.retained_after_one_return_minor,'Returned goods cannot enter final capture'),assert.AssertionError);
 }));
});
