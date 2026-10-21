import test from 'node:test';
import assert from 'node:assert/strict';
import {CommerceKernel} from '../../packages/commerce/kernel.mts';
import {canonical,contentDigest} from '../../packages/commerce/configuration-values.mts';
import {PrivacyLifecycle} from '../../packages/commerce/privacy-lifecycle.mts';
import {ExecutionStops} from '../../packages/commerce/execution-stops.mts';
import {InternationalHandoffs} from '../../packages/commerce/international-handoffs.mts';
import {DropoffHandoffFixtureSource} from '../../packages/adapters/dropoff-handoff-fixture-source.mts';
import {externalWorker} from './dropoff-eligibility-helpers.mts';
import {usingFixture as usingCredentials,authorize,authorizeRevoke,original,withMethod,rehash,proofRow,retireSubject,nativeState,documentRows} from './dropoff-credentials-helpers.mts';
import {E,ACTION,usingFixture,issue,intent,acceptance,importEvent,read,unitRef,eventUnits,sourceRows,nativeRows,nativeRow,nativeId,sourceEvent,nativeEvent,projection,unit,downstream,noDownstream,secretless,coreOnly,writeNative,restoreNative,preservedCredentialCopies,backup,restore,merchant,suppression,target,transfer} from './dropoff-handoffs-helpers.mts';
import type {Value} from './dropoff-handoffs-helpers.mts';

test('CASE-M20-G03-01',()=>usingFixture(f=>{
  const x=issue(f),before=downstream(f),credentials=preservedCredentialCopies(f),empty=projection(f,x,read(f,x),'empty',[]);for(const u of E.units)unit(f,empty,u.line_id,u.ordinal,'outstanding',null,null);
  const event=acceptance(f,x);sourceEvent(f,x,event,eventUnits(f,E.alpha_both));assert.equal(nativeRows(f).length,0);assert.equal(sourceRows(f).length,1);
  const value=projection(f,x,importEvent(f,x,event),'alpha_both',[event]);nativeEvent(f,x,event);unit(f,value,'alpha',1,'accepted','accepted',event.event_id);unit(f,value,'alpha',2,'accepted','accepted',event.event_id);unit(f,value,'beta',1,'outstanding',null,null);
  const rows=nativeRows(f);assert.deepEqual(importEvent(f,x,event),value);assert.deepEqual(nativeRows(f),rows);assert.equal(rows.length,1);assert.deepEqual(preservedCredentialCopies(f),credentials);noDownstream(f,before);secretless(f,x,value);
}));

test('CASE-M20-G03-02',()=>usingFixture(f=>{
  const x=issue(f),event=acceptance(f,x,'one-shirt',E.alpha_one);projection(f,x,importEvent(f,x,event),'alpha_one',[event]);const before=nativeRows(f),source=sourceRows(f),other=f.kernel.lookup(f.a.scope,'order','synthetic','ORD-1002');assert.equal(other.customer_id,'C-1002');
  assert.deepEqual(f.handoffSource.recordAcceptance(intent(x,event.event_id,E.alpha_one)),event);assert.throws(()=>acceptance(f,x,'same-unit-new-event',E.alpha_one));assert.throws(()=>acceptance(f,x,event.event_id,E.beta_one));assert.deepEqual(sourceRows(f),source);assert.deepEqual(nativeRows(f),before);
  const next=acceptance(f,x,'second-shirt',[{...E.alpha_one[0],ordinal:2}]),history=sourceRows(f);
  for(const patch of [{resource_id:other.id},{issue_operation_id:'wrong-original-issue'},{family_ref:'a'.repeat(64)},{subject_ref:'b'.repeat(64)}])withMethod(f.handoffSource,'event',(lookup,id)=>id===next.event_id?rehash(next,patch):lookup(id),()=>assert.throws(()=>importEvent(f,x,next)));
  assert.deepEqual(nativeRows(f),before);assert.deepEqual(sourceRows(f),history);assert.deepEqual(f.kernel.get(f.a.scope,other.id),other);projection(f,x,importEvent(f,x,next),'alpha_both',[event,next]);assert.equal(nativeRows(f).length,2);
}));

test('CASE-M20-G03-03',()=>usingFixture(f=>{
  const x=issue(f),before=downstream(f),event=acceptance(f,x,'single-unit-fault-control',E.alpha_one);sourceEvent(f,x,event,eventUnits(f,E.alpha_one));
  assert.equal(JSON.parse(sourceRows(f)[0].body).units.length,1,'independent provider admitted exactly one physical unit');const value=importEvent(f,x,event);
  // The named fault must reach this real native storage assertion with THREE accepted units.
  const materialized=nativeRows(f).flatMap(r=>JSON.parse(r.body).event.units).filter(u=>u.disposition==='accepted');assert.equal(materialized.length,1,'one source unit must not materialize all three expected units');assert.deepEqual(materialized.map(u=>u.unit_ref),[unitRef(f,'alpha',1)]);
  projection(f,x,value,'alpha_one',[event]);nativeEvent(f,x,event);unit(f,value,'alpha',2,'outstanding',null,null);unit(f,value,'beta',1,'outstanding',null,null);noDownstream(f,before);assert.equal(sourceRows(f).length,1);
}));

test('CASE-M20-G03-04',()=>usingFixture(f=>{
  const x=issue(f),before=downstream(f),a=E.alpha_one[0],invalid=[[],[a,a],[{...a,ordinal:0}],[{...a,ordinal:3}],[{...a,ordinal:1.5}],[{...a,line_id:'foreign-line'}],[{...a,disposition:'inspected'}],[{...a,reason:'damaged'}],[{...a,disposition:'rejected',reason:'free text'}],[a,{...E.beta_one[0],ordinal:2}]];
  for(const [i,units] of invalid.entries())assert.throws(()=>f.handoffSource.recordAcceptance(intent(x,'malformed-'+i,units)));
  const valid=intent(x,'caller-overrides',E.alpha_one);assert.throws(()=>f.handoffSource.recordAcceptance({...valid,observed_at:f.now()-1}));assert.throws(()=>f.handoffSource.recordAcceptance({...valid,sequence:100}));assert.throws(()=>f.handoffSource.recordAcceptance({...valid,items:[{...E.items[0],quantity:3},E.items[1]]}));assert.equal(sourceRows(f).length,0);assert.equal(nativeRows(f).length,0);
  const units=[a,{...E.beta_one[0],disposition:'rejected',reason:'wrong_item'}],event=acceptance(f,x,'mixed-handoff',units);sourceEvent(f,x,event,eventUnits(f,units));
  for(const patch of [{units:[{unit_ref:'f'.repeat(64),disposition:'accepted',reason:'accepted'}]},{units:[...event.units,event.units[0]]},{admitted_at:event.credential_expires_at},{extra:'not permitted'}])withMethod(f.handoffSource,'event',()=>rehash(event,patch),()=>assert.throws(()=>importEvent(f,x,event)));
  assert.equal(nativeRows(f).length,0);const value=projection(f,x,importEvent(f,x,event),'mixed',[event]);unit(f,value,'alpha',1,'accepted','accepted',event.event_id);unit(f,value,'alpha',2,'outstanding',null,null);unit(f,value,'beta',1,'rejected','wrong_item',event.event_id);nativeEvent(f,x,event);noDownstream(f,before);
}));

test('CASE-M20-G03-05',()=>usingFixture(f=>{
  const x=issue(f),before=downstream(f),event=acceptance(f,x),a=unitRef(f,'alpha',1),b=unitRef(f,'alpha',2);
  const first=f.handoffSource.recordCorrection({event_id:'correction-one',parent_event_id:event.event_id,units:[{unit_ref:a,disposition:'rejected',reason:'damaged'}]});sourceEvent(f,x,first,[{unit_ref:a,disposition:'rejected',reason:'damaged'}],2,event);
  const second=f.handoffSource.recordCorrection({event_id:'correction-two',parent_event_id:event.event_id,units:[{unit_ref:b,disposition:'rejected',reason:'unsupported'}]});sourceEvent(f,x,second,[{unit_ref:b,disposition:'rejected',reason:'unsupported'}],3,event);
  const source=sourceRows(f);for(const input of [{event_id:'orphan',parent_event_id:'missing-parent',units:[{unit_ref:a,disposition:'accepted',reason:'accepted'}]},{event_id:'empty',parent_event_id:first.event_id,units:[]},{event_id:'stale',parent_event_id:event.event_id,units:[{unit_ref:a,disposition:'accepted',reason:'accepted'}]},{event_id:'foreign-unit',parent_event_id:first.event_id,units:[{unit_ref:unitRef(f,'beta',1),disposition:'accepted',reason:'accepted'}]}])assert.throws(()=>f.handoffSource.recordCorrection(input));assert.deepEqual(sourceRows(f),source);
  assert.throws(()=>importEvent(f,x,first));assert.equal(nativeRows(f).length,0);projection(f,x,importEvent(f,x,event),'alpha_both',[event]);assert.throws(()=>importEvent(f,x,second));assert.equal(nativeRows(f).length,1);
  let value=projection(f,x,importEvent(f,x,first),'one_disputed',[event,first]);unit(f,value,'alpha',1,'disputed','damaged',event.event_id,first.event_id);unit(f,value,'alpha',2,'accepted','accepted',event.event_id);
  value=projection(f,x,importEvent(f,x,second),'both_disputed',[event,first,second]);unit(f,value,'alpha',2,'disputed','unsupported',event.event_id,second.event_id);
  const third=f.handoffSource.recordCorrection({event_id:'resolved-one',parent_event_id:first.event_id,units:[{unit_ref:a,disposition:'accepted',reason:'accepted'}]}),fourth=f.handoffSource.recordCorrection({event_id:'resolved-two',parent_event_id:second.event_id,units:[{unit_ref:b,disposition:'accepted',reason:'accepted'}]});
  projection(f,x,importEvent(f,x,third),'one_disputed',[event,first,second,third]);value=projection(f,x,importEvent(f,x,fourth),'alpha_both',[event,first,second,third,fourth]);unit(f,value,'alpha',1,'accepted','accepted',event.event_id,third.event_id);unit(f,value,'alpha',2,'accepted','accepted',event.event_id,fourth.event_id);
  const stored=nativeRows(f);assert.deepEqual(importEvent(f,x,fourth),value);assert.deepEqual(nativeRows(f),stored);assert.equal(stored.length,5);assert.deepEqual(f.handoffSource.event(event.event_id),event);nativeEvent(f,x,event);noDownstream(f,before);
}));

test('CASE-M20-G03-06',async()=>{
  await usingFixture(async f=>{
    const x=issue(f),event=acceptance(f,x,'integrity-control',E.alpha_one),rows=sourceRows(f);assert.ok(Object.isFrozen(f.handoffSource));assert.doesNotThrow(()=>f.handoffSource.assertAttached(f.db));assert.throws(()=>new DropoffHandoffFixtureSource({...f.credentialSource} as any));assert.throws(()=>new InternationalHandoffs(f.kernel,f.partner,{dropoff:{...f.handoffSource} as any}).importDropoff(f.a.scope,{issue_operation_id:x.id,event_id:event.event_id}));
    assert.throws(()=>f.partnerDb.prepare('UPDATE fixture_dropoff_handoff_events SET sequence=sequence+1 WHERE event_id=?').run(event.event_id));assert.throws(()=>f.partnerDb.prepare('DELETE FROM fixture_dropoff_handoff_events WHERE event_id=?').run(event.event_id));assert.deepEqual(sourceRows(f),rows);
    await usingFixture(g=>{assert.throws(()=>new InternationalHandoffs(f.kernel,g.partner,{dropoff:f.handoffSource}).importDropoff(f.a.scope,{issue_operation_id:x.id,event_id:event.event_id}));assert.throws(()=>new InternationalHandoffs(f.kernel,f.partner,{dropoff:g.handoffSource}).importDropoff(f.a.scope,{issue_operation_id:x.id,event_id:event.event_id}));});
    const identity=f.partnerDb.prepare('SELECT * FROM fixture_dropoff_credential_identity WHERE singleton=1').get(),body={...JSON.parse(identity.body),source_account_id:'foreign-account'},without={...body};delete without.source_identity;body.source_identity=contentDigest(without);
    f.partnerDb.prepare('UPDATE fixture_dropoff_credential_identity SET body=?,digest=? WHERE singleton=1').run(canonical(body),contentDigest(body));try{assert.throws(()=>f.handoffSource.event(event.event_id));assert.throws(()=>f.handoffSource.journal());assert.throws(()=>importEvent(f,x,event));}finally{f.partnerDb.prepare('UPDATE fixture_dropoff_credential_identity SET body=?,digest=? WHERE singleton=1').run(identity.body,identity.digest);}
    assert.equal(nativeRows(f).length,0);projection(f,x,importEvent(f,x,event),'alpha_one',[event]);const row=nativeRow(f,event),native=JSON.parse(row.body);assert.throws(()=>coreOnly(f).read(f.a.scope,row.id));
    for(const patch of [{kind:'plan'},{unexpected:'not permitted'},{personal:{...native.personal,request_id:'another-return'}}]){writeNative(f,row,{...native,...patch});try{assert.throws(()=>read(f,x));assert.throws(()=>coreOnly(f).read(f.a.scope,row.id));}finally{restoreNative(f,row);}}
    projection(f,x,read(f,x),'alpha_one',[event]);assert.deepEqual(sourceRows(f),rows);
  });
  await usingCredentials(f=>{assert.equal(f.partnerDb.prepare("SELECT count(*) n FROM sqlite_master WHERE name='fixture_dropoff_handoff_events'").get().n,0);new CommerceKernel(f.partnerDb,f.now);assert.throws(()=>new DropoffHandoffFixtureSource(f.credentialSource));assert.equal(f.partnerDb.prepare("SELECT count(*) n FROM sqlite_master WHERE name='fixture_dropoff_handoff_events'").get().n,0,'source separation is checked before handoff DDL');});
});

test('CASE-M20-G03-07',async()=>{
  await usingFixture(f=>{
    const x=issue(f),event=acceptance(f,x,'before-expiry',E.alpha_one),originalIntent=intent(x,event.event_id,E.alpha_one);f.advance(20001);assert.equal(f.credentialSource.verify(x.delivered.payload).state,'expired');assert.deepEqual(f.handoffSource.recordAcceptance(originalIntent),event);assert.throws(()=>acceptance(f,x,'late-new-scan',E.beta_one));assert.throws(()=>f.handoffSource.recordAcceptance({...originalIntent,payload:'wrong-historical-payload'}));
    f.keyAvailable(false);const value=withMethod(f.credentialSource,'verify',()=>{throw new Error('HISTORICAL_IMPORT_MUST_NOT_VERIFY_CURRENT_PAYLOAD');},()=>importEvent(f,x,event));projection(f,x,value,'alpha_one',[event]);f.keyAvailable(true);
    const replacement=issue(f,x.id),nextUnits=[{...E.alpha_one[0],ordinal:2},...E.beta_one],next=acceptance(f,replacement,'replacement-generation',nextUnits);sourceEvent(f,replacement,next,eventUnits(f,nextUnits),2);assert.throws(()=>acceptance(f,replacement,'replaced-unit-replay',E.alpha_one));
    projection(f,replacement,importEvent(f,replacement,next),'all',[event,next]);projection(f,x,read(f,x),'all',[event,next]);nativeEvent(f,replacement,next);
    const correction=f.handoffSource.recordCorrection({event_id:'expired-issue-correction',parent_event_id:event.event_id,units:[{unit_ref:unitRef(f,'alpha',1),disposition:'rejected',reason:'damaged'}]});sourceEvent(f,x,correction,[{unit_ref:unitRef(f,'alpha',1),disposition:'rejected',reason:'damaged'}],3,event);
    const corrected=projection(f,x,importEvent(f,x,correction),'all_one_disputed',[event,next,correction]);unit(f,corrected,'alpha',1,'disputed','damaged',event.event_id,correction.event_id);assert.equal(sourceRows(f).length,3);
  });
  await usingFixture(f=>{const x=issue(f),event=acceptance(f,x,'before-revocation',E.alpha_one),revoke=authorizeRevoke(f,x.id);assert.equal(f.credentials.dispatch(f.a.scope,revoke.id).state,'revoked');assert.equal(f.credentialSource.verify(x.delivered.payload).state,'revoked');assert.deepEqual(f.handoffSource.recordAcceptance(intent(x,event.event_id,E.alpha_one)),event);assert.throws(()=>acceptance(f,x,'revoked-new-scan',E.beta_one));projection(f,x,importEvent(f,x,event),'alpha_one',[event]);assert.equal(sourceRows(f).length,1);});
});

test('CASE-M20-G03-08',()=>usingFixture(f=>{
  const x=issue(f),event=acceptance(f,x,'authority-control',E.alpha_one),proof=proofRow(f),worker=externalWorker(f),denied=[f.customer,f.agent.scope,f.a.worker,f.b.scope,f.c.scope,worker,{...f.a.scope}];assert.ok(f.now()>proof.last_seen);
  for(const scope of denied){assert.throws(()=>importEvent(f,x,event,scope));assert.throws(()=>read(f,x,scope));}assert.throws(()=>f.handoffs.importDropoff(f.a.scope,{issue_operation_id:x.id,event_id:event.event_id,units:E.alpha_both}));assert.equal(nativeRows(f).length,0);
  const value=projection(f,x,importEvent(f,x,event),'alpha_one',[event]),stored=nativeRows(f);for(const scope of denied){assert.throws(()=>importEvent(f,x,event,scope));assert.throws(()=>read(f,x,scope));}assert.deepEqual(nativeRows(f),stored);projection(f,x,read(f,x,f.reviewer.scope),'alpha_one',[event]);secretless(f,x,[value,f.handoffSource.journal()]);assert.deepEqual(proofRow(f),proof);
  const next=acceptance(f,x,'permission-control',E.beta_one);f.permissions.change(f.owner.scope,{actor_id:f.a.actor,role:'operator',actions:['operation.read','resource.read'],resource_ids:null,expected_revision:0});assert.throws(()=>importEvent(f,x,next));projection(f,x,read(f,x),'alpha_one',[event]);projection(f,x,importEvent(f,x,next,f.owner.scope),'alpha_one_beta',[event,next]);assert.deepEqual(proofRow(f),proof);
}));

test('CASE-M20-G03-09',async()=>{
  await usingFixture(f=>{
    const x=issue(f),event=acceptance(f,x,'core-rollback',E.alpha_one),provider=sourceRows(f),credentials=preservedCredentialCopies(f),before=downstream(f);
    f.db.exec("CREATE TRIGGER handoff_commit_cut BEFORE INSERT ON commerce_international_handoffs WHEN NEW.id LIKE 'dropoff_event_%' BEGIN SELECT RAISE(ABORT,'HANDOFF_NATIVE_COMMIT_CUT'); END");
    try{assert.throws(()=>importEvent(f,x,event),/HANDOFF_NATIVE_COMMIT_CUT/);}finally{f.db.exec('DROP TRIGGER handoff_commit_cut');}
    assert.equal(nativeRows(f).length,0);assert.deepEqual(sourceRows(f),provider);assert.deepEqual(preservedCredentialCopies(f),credentials);projection(f,x,importEvent(f,x,event),'alpha_one',[event]);
    const next=acceptance(f,x,'final-source-read',E.beta_one),stored=nativeRows(f),source=sourceRows(f);let reads=0;
    withMethod(f.handoffSource,'event',(lookup,id)=>{const value=lookup(id);if(id!==next.event_id)return value;reads++;return reads===1?value:rehash(value,{units:[{unit_ref:unitRef(f,'beta',1),disposition:'rejected',reason:'wrong_item'}]});},()=>assert.throws(()=>importEvent(f,x,next)));
    assert.ok(reads>=2,'native write must reread the selected original source event');assert.deepEqual(nativeRows(f),stored);assert.deepEqual(sourceRows(f),source);projection(f,x,importEvent(f,x,next),'alpha_one_beta',[event,next]);noDownstream(f,before);
  });
  for(const change of ['permission','stop','mapping'])await usingFixture(f=>{
    const x=issue(f),event=acceptance(f,x,'final-'+change,E.alpha_one),source=sourceRows(f),credentials=preservedCredentialCopies(f),other=f.kernel.lookup(f.a.scope,'order','synthetic','ORD-1002');let lookups=0;
    withMethod(f.handoffSource,'event',(lookup,id)=>{const value=lookup(id);if(id===event.event_id&&++lookups===2){
      if(change==='permission')f.permissions.change(f.owner.scope,{actor_id:f.a.actor,role:'operator',actions:['operation.read','resource.read'],resource_ids:null,expected_revision:0});
      else if(change==='stop')new ExecutionStops(f.kernel).set(f.owner.scope,{action:ACTION,stopped:true,reason:'incident',expected_revision:0});
      else f.db.prepare('UPDATE commerce_cases SET resource_id=? WHERE tenant_id=? AND store_id=? AND id=?').run(other.id,f.a.tenant,f.a.store,E.case_id);
    }return value;},()=>assert.throws(()=>importEvent(f,x,event)));
    assert.ok(lookups>=2);assert.equal(nativeRows(f).length,0);assert.deepEqual(sourceRows(f),source);assert.deepEqual(preservedCredentialCopies(f),credentials);assert.equal(f.db.prepare('SELECT resource_id FROM commerce_cases WHERE tenant_id=? AND store_id=? AND id=?').get(f.a.tenant,f.a.store,E.case_id).resource_id,f.resourceId);
    // The failed transaction also rolls back the injected authority/control change.
    projection(f,x,importEvent(f,x,event),'alpha_one',[event]);
  });
});

test('CASE-M20-G03-10',async()=>{
  await usingFixture(f=>{
    const x=issue(f),input=intent(x,'lost-source-response',E.alpha_one);f.handoffSource.mode('timeout_after_effect');assert.throws(()=>f.handoffSource.recordAcceptance(input));assert.equal(sourceRows(f).length,1);assert.equal(nativeRows(f).length,0);
    const event=f.handoffSource.event(input.event_id);assert.ok(event);sourceEvent(f,x,event,eventUnits(f,E.alpha_one));f.handoffSource.mode('apply');assert.deepEqual(f.handoffSource.recordAcceptance(input),event);projection(f,x,importEvent(f,x,event),'alpha_one',[event]);
    const source=sourceRows(f),stored=nativeRows(f),proof=proofRow(f);f.closeCore();const reopened=f.reopen();assert.deepEqual(proofRow(reopened),proof);reopened.handoffSource.lookupAvailable(false);f.keyAvailable(false);
    withMethod(reopened.handoffSource,'event',()=>{throw new Error('RETAINED_READ_MUST_NOT_CONTACT_SOURCE');},()=>projection(reopened,x,coreOnly(reopened).readDropoff(reopened.a.scope,x.id),'alpha_one',[event]));
    assert.deepEqual(nativeRows(reopened),stored);assert.deepEqual(sourceRows(reopened),source);assert.deepEqual(proofRow(reopened),proof);assert.equal(reopened.db.prepare('SELECT count(*) n FROM commerce_received_units').get().n,0);
  });
  await usingFixture(f=>{
    const pending=authorize(f);f.credentialSource.mode('issue','timeout_after_effect');assert.equal(f.credentials.dispatch(f.a.scope,pending.id).state,'unknown');const x={...pending,issued:original(f,pending),delivered:f.credentialSource.deliver(pending.id)},event=acceptance(f,x,'source-before-issue-reconcile',E.alpha_one),state=nativeState(f.db,x.id),source=sourceRows(f);
    assert.throws(()=>importEvent(f,x,event));assert.equal(nativeRows(f).length,0);assert.deepEqual(nativeState(f.db,x.id),state);assert.deepEqual(sourceRows(f),source);assert.equal(f.credentials.reconcile(f.a.scope,x.id).disposition,'reconciled');assert.equal(f.credentials.read(f.a.scope,x.id).state,'issued');
    assert.throws(()=>f.handoffs.importDropoff(f.a.scope,{issue_operation_id:x.id,event_id:'missing-original-event'}));f.handoffSource.lookupAvailable(false);assert.throws(()=>importEvent(f,x,event));assert.equal(nativeRows(f).length,0);f.handoffSource.lookupAvailable(true);projection(f,x,importEvent(f,x,event),'alpha_one',[event]);assert.deepEqual(sourceRows(f),source);assert.equal(f.credentialSource.journal().length,1);
  });
});

test('CASE-M20-G03-11',async()=>{
  await usingFixture(f=>{
    const x=issue(f),event=acceptance(f,x);importEvent(f,x,event);const live=nativeRow(f,event),privacy=new PrivacyLifecycle(f.kernel),exported=privacy.export(f.owner.scope,E.customer_id) as Value,records=exported.extended_service_records.commerce_international_handoffs;
    assert.equal(records.length,1);assert.equal(records[0].id,nativeId(event));assert.deepEqual(JSON.parse(records[0].body).event,event);assert.equal((privacy.export(f.owner.scope,'C-1002') as Value).extended_service_records.commerce_international_handoffs.length,0);secretless(f,x,exported);
    privacy.hold(f.owner.scope,{customer_id:E.customer_id,reason:'dispute',authority_ref:'handoff-held-evidence',expires_at:f.now()+600000});projection(f,x,read(f,x),'alpha_both',[event]);const next=acceptance(f,x,'not-imported-after-retirement',E.beta_one),provider=sourceRows(f);
    assert.equal(privacy.erase(f.owner.scope,E.customer_id).status,'held');nativeEvent(f,x,event,false,true);projection(f,x,read(f,x,f.owner.scope),'alpha_both',[event],false,true);assert.throws(()=>read(f,x));assert.throws(()=>importEvent(f,x,next,f.owner.scope));assert.throws(()=>importEvent(f,x,event,f.owner.scope));
    privacy.releaseHold(f.owner.scope,E.customer_id,'handoff-held-evidence');assert.equal(privacy.erase(f.owner.scope,E.customer_id).status,'logically_erased');nativeEvent(f,x,event,true);projection(f,x,coreOnly(f).readDropoff(f.owner.scope,x.id),'alpha_both',[event],true);
    // A canonical old personal copy is repairable only by the real suppression path.
    restoreNative(f,live);assert.throws(()=>read(f,x,f.owner.scope));assert.equal(privacy.erase(f.owner.scope,E.customer_id).status,'already_erased');nativeEvent(f,x,event,true);projection(f,x,read(f,x,f.owner.scope),'alpha_both',[event],true);const once=nativeRows(f);assert.equal(privacy.erase(f.owner.scope,E.customer_id).status,'already_erased');assert.deepEqual(nativeRows(f),once);assert.deepEqual(sourceRows(f),provider);
  });
  await usingFixture(f=>{
    const x=issue(f),event=acceptance(f,x,'historical-resource',E.alpha_one);importEvent(f,x,event);const live=nativeRow(f,event),provider=sourceRows(f),subject=live.subject_hash,privacy=new PrivacyLifecycle(f.kernel);retireSubject(f);
    const exported=privacy.export(f.owner.scope,E.customer_id) as Value;assert.deepEqual(exported.resources,[]);assert.equal(exported.extended_service_records.commerce_international_handoffs.length,1);assert.equal(f.order().customer_id,'C-1002');assert.equal(privacy.erase(f.owner.scope,'C-1002').status,'logically_erased');nativeEvent(f,x,event,true);
    assert.equal(f.db.prepare("SELECT count(*) n FROM commerce_resources WHERE tenant_id=? AND store_id=? AND (customer_id='C-1002' OR (kind='customer' AND external_id='C-1002'))").get(f.a.tenant,f.a.store).n,0);const marker=f.db.prepare('SELECT * FROM commerce_privacy_resources WHERE tenant_id=? AND store_id=? AND resource_id=?').get(f.a.tenant,f.a.store,f.resourceId);assert.ok(marker);assert.notEqual(marker.subject_hash,subject);assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_privacy_subjects WHERE tenant_id=? AND store_id=? AND subject_hash=?').get(f.a.tenant,f.a.store,subject).n,0);
    restoreNative(f,live);assert.throws(()=>read(f,x,f.owner.scope));assert.equal(privacy.erase(f.owner.scope,'C-1002').status,'already_erased');nativeEvent(f,x,event,true);projection(f,x,read(f,x,f.owner.scope),'alpha_one',[event],true);assert.equal(nativeRow(f,event).subject_hash,subject);assert.deepEqual(sourceRows(f),provider);
  });
  await usingFixture(f=>{
    const x=issue(f),event=acceptance(f,x,'before-uninstall',E.alpha_one);importEvent(f,x,event);const next=acceptance(f,x,'uninstall-pending',E.beta_one),provider=sourceRows(f),privacy=new PrivacyLifecycle(f.kernel),other=f.kernel.list(f.b.scope,'order');privacy.hold(f.owner.scope,{customer_id:E.customer_id,reason:'retention_obligation',authority_ref:'handoff-uninstall-hold',expires_at:f.now()+600000});assert.equal(privacy.uninstall(f.owner.scope).status,'disconnected');
    nativeEvent(f,x,event,false,true);assert.throws(()=>importEvent(f,x,next,f.owner.scope));assert.throws(()=>importEvent(f,x,event,f.owner.scope));assert.deepEqual(f.kernel.list(f.b.scope,'order'),other);assert.deepEqual(sourceRows(f),provider);assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_received_units').get().n,0);
  });
  await usingFixture(f=>{const x=issue(f);new PrivacyLifecycle(f.kernel).erase(f.owner.scope,E.customer_id);assert.throws(()=>coreOnly(f).readDropoff(f.owner.scope,x.id),/DROPOFF_HANDOFF_NOT_FOUND/);assert.equal(sourceRows(f).length,0);assert.equal(nativeRows(f).length,0);});
});

test('CASE-M20-G03-12',async()=>{
  await usingFixture(f=>{
    const x=issue(f),event=acceptance(f,x);importEvent(f,x,event);const privacy=new PrivacyLifecycle(f.kernel),provider=sourceRows(f);privacy.hold(f.owner.scope,{customer_id:E.customer_id,reason:'retention_obligation',authority_ref:'handoff-copied-hold',expires_at:f.now()+600000});const saved=backup(f);
    privacy.releaseHold(f.owner.scope,E.customer_id,'handoff-copied-hold');f.advance(1);assert.equal(privacy.erase(f.owner.scope,E.customer_id).status,'logically_erased');const restored=restore(f,saved);
    try{
      assert.equal(restored.result.mode,'quarantine');assert.equal(restored.result.external_effects,false);assert.throws(()=>restored.kernel.authenticate(f.a.bearer));assert.throws(()=>restored.kernel.authenticate(f.customerBearer));assert.equal(restored.db.prepare('SELECT released FROM commerce_privacy_holds WHERE authority_ref=?').get('handoff-copied-hold').released,0);
      nativeEvent(restored,x,event,true);projection(restored,x,coreOnly(restored).readDropoff(restored.scope,x.id),'alpha_both',[event],true);assert.throws(()=>importEvent(restored,x,event,restored.scope));assert.equal(restored.db.prepare('SELECT count(*) n FROM commerce_received_units').get().n,0);assert.equal(restored.db.prepare('SELECT count(*) n FROM commerce_resolution_operations').get().n,0);assert.deepEqual(sourceRows(f),provider);
    }finally{restored.close();}
  });
  await usingFixture(f=>{
    const x=issue(f),event=acceptance(f,x,'case-linked-suppression',E.alpha_one);importEvent(f,x,event);const live=nativeRow(f,event),provider=sourceRows(f),privacy=new PrivacyLifecycle(f.kernel),other=f.kernel.lookup(f.a.scope,'order','synthetic','ORD-1002');assert.equal(other.customer_id,'C-1002');assert.notEqual(other.id,f.resourceId);
    privacy.hold(f.owner.scope,{customer_id:E.customer_id,reason:'retention_obligation',authority_ref:'handoff-linked-case-hold',expires_at:f.now()+600000});assert.equal(privacy.erase(f.owner.scope,'C-1002').status,'logically_erased');assert.deepEqual(nativeRow(f,event),live,'unrelated erasure preserves the original held graph');
    assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_privacy_resources WHERE tenant_id=? AND store_id=? AND resource_id=?').get(f.a.tenant,f.a.store,other.id).n,1);assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_privacy_resources WHERE tenant_id=? AND store_id=? AND resource_id=?').get(f.a.tenant,f.a.store,f.resourceId).n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_privacy_subjects WHERE tenant_id=? AND store_id=? AND subject_hash=?').get(f.a.tenant,f.a.store,live.subject_hash).n,0);
    assert.equal(f.db.prepare('UPDATE commerce_cases SET resource_id=? WHERE tenant_id=? AND store_id=? AND id=?').run(other.id,f.a.tenant,f.a.store,E.case_id).changes,1);const saved=backup(f),packed=merchant(f),latest=suppression(f),restored=restore(f,saved,'handoff-linked-restore');
    try{nativeEvent(restored,x,event,true);projection(restored,x,coreOnly(restored).readDropoff(restored.scope,x.id),'alpha_one',[event],true);assert.equal(restored.db.prepare('SELECT released FROM commerce_privacy_holds WHERE authority_ref=?').get('handoff-linked-case-hold').released,0);assert.equal(restored.db.prepare('SELECT resource_id FROM commerce_cases WHERE tenant_id=? AND store_id=? AND id=?').get(f.a.tenant,f.a.store,E.case_id).resource_id,other.id);}finally{restored.close();}
    const destination=target(f);try{
      transfer(f,destination,packed,latest);nativeEvent(destination,x,event,true);projection(destination,x,coreOnly(destination).readDropoff(destination.scope,x.id),'alpha_one',[event],true);assert.equal(destination.db.prepare('SELECT released FROM commerce_privacy_holds WHERE authority_ref=?').get('handoff-linked-case-hold').released,0);assert.equal(destination.db.prepare('SELECT resource_id FROM commerce_cases WHERE tenant_id=? AND store_id=? AND id=?').get(f.a.tenant,f.a.store,E.case_id).resource_id,other.id);assert.throws(()=>importEvent(destination,x,event,destination.scope));
      restoreNative(destination,live);assert.throws(()=>read(destination,x,destination.scope));transfer(f,destination,packed,latest);nativeEvent(destination,x,event,true);projection(destination,x,read(destination,x,destination.scope),'alpha_one',[event],true);const once=nativeRows(destination);transfer(f,destination,packed,latest);assert.deepEqual(nativeRows(destination),once);assert.equal(once.length,1);assert.equal(destination.db.prepare("SELECT count(*) n FROM commerce_support_documents WHERE kind='merchant_import'").get().n,1);assert.equal(destination.db.prepare('SELECT suppression_digest FROM commerce_recovery_state WHERE id=1').get().suppression_digest,latest.suppression_sha256);
      assert.equal(destination.db.prepare('SELECT count(*) n FROM commerce_received_units').get().n,0);assert.equal(destination.db.prepare('SELECT count(*) n FROM commerce_resolution_operations').get().n,0);assert.deepEqual(sourceRows(f),provider);
    }finally{destination.close();}
  });
});
