import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {CommerceKernel} from '../../packages/commerce/kernel.mts';
import {canonical,contentDigest} from '../../packages/commerce/configuration-values.mts';
import {PrivacyLifecycle} from '../../packages/commerce/privacy-lifecycle.mts';
import {DurableWork} from '../../packages/commerce/durable-work.mts';
import {Reconciliation} from '../../packages/commerce/reconciliation.mts';
import {ExecutionStops} from '../../packages/commerce/execution-stops.mts';
import {BusinessOperations,queueOperation,transitionOperation} from '../../packages/commerce/operation-store.mts';
import {OperationReceipts} from '../../packages/commerce/operation-receipts.mts';
import {unresolvedEffects} from '../../packages/commerce/work-leases.mts';
import {ExceptionQueue} from '../../packages/commerce/exception-queue.mts';
import {SyntheticJournal} from '../../packages/adapters/reliability/synthetic-journal.mts';
import {DropoffCredentialFixtureSource} from '../../packages/adapters/dropoff-credential-fixture-source.mts';
import {DropoffCredentials} from '../../packages/commerce/dropoff-credentials.mts';
import {usingFixture as usingEligibility,configurePartner,enable,publish,externalWorker} from './dropoff-eligibility-helpers.mts';
import {updateResource} from './shopper-memory-helpers.mts';
import {E,ISSUE,REVOKE,QUOTE_KIND,OP_KIND,usingFixture,keyring,quote,prepared,approved,execute,authorize,authorizeRevoke,assertQuote,projection,
  count,documentRows,operationRow,nativeOperation,nativeWork,nativeState,sourceRows,credentialRows,sourceState,sourceCounts,original,status,verify,secretless,
  unrelated,proofRow,withMethod,rehash,writeDocument,restoreDocument,minimized,retireSubject,backup,restore,merchant,suppression,target,transfer} from './dropoff-credentials-helpers.mts';
import type {Value} from './dropoff-credentials-helpers.mts';

test('CASE-M20-G02-01',()=>usingFixture(f=>{
  const before=unrelated(f),q=quote(f);assertQuote(f,q);const x=execute(f,approved(f,q));sourceCounts(f,0,0);projection(f,x.id,'authorized',0);
  f.credentialSource.mode('issue','timeout_after_effect');assert.equal(f.credentials.dispatch(f.a.scope,x.id).state,'unknown');projection(f,x.id,'unknown',1);sourceCounts(f,1,1);
  const observed=original(f,x),answer=f.credentials.reconcile(f.a.scope,x.id);assert.equal(answer.disposition,'reconciled');assert.equal(answer.command_repeated,false);projection(f,x.id,'issued',1);
  const delivered=f.credentials.deliver(f.a.scope,x.id);assert.equal(delivered.operation_id,x.id);assert.equal(delivered.kind,'qr');assert.equal(delivered.generation,1);assert.equal(delivered.expires_at,q.quote.credential_expires_at);assert.equal(delivered.qualification,'synthetic_only');assert.equal(delivered.financial_effect,false);
  verify(f,delivered.payload,x.id,true,'active');secretless(f,delivered.payload,[x,answer]);assert.equal(f.credentials.reconcile(f.a.scope,x.id).disposition,'unchanged');
  f.advance(E.after_credential_expiry_ms);assert.equal(status(f,x.id,'expired').delivery_available,false);assert.throws(()=>f.credentials.deliver(f.a.scope,x.id));verify(f,delivered.payload,x.id,false,'expired');
  assert.deepEqual(f.credentialSource.lookup(x.id),observed.result,'expiry does not rewrite the historical issued result');projection(f,x.id,'issued',1);
  f.credentialSource.mode('issue','apply');const replacementQuote=quote(f,x.id);assertQuote(f,replacementQuote,2,x.id);const replacement=execute(f,approved(f,replacementQuote));assert.equal(f.credentials.dispatch(f.a.scope,replacement.id).state,'issued');
  sourceCounts(f,2,2);original(f,replacement);const newer=f.credentials.deliver(f.a.scope,replacement.id);assert.notEqual(newer.payload,delivered.payload);assert.equal(newer.generation,2);verify(f,newer.payload,replacement.id,true,'active',2);verify(f,delivered.payload,x.id,false,'expired');
  assert.equal(status(f,x.id,'expired').replaced_by,replacement.id);assert.equal(credentialRows(f).filter(r=>f.credentialSource.credential(r.operation_id).state==='active').length,1);assert.deepEqual(unrelated(f),before);
}));

test('CASE-M20-G02-02',()=>usingFixture(f=>{
  const x=authorize(f);f.credentialSource.mode('issue','timeout_before_effect');assert.equal(f.credentials.dispatch(f.a.scope,x.id).state,'unknown');projection(f,x.id,'unknown',1);sourceCounts(f,0,0);
  let repeated=0;withMethod(f.credentialSource,'issue',()=>{repeated++;throw new Error('CREDENTIAL_REPEAT_FORBIDDEN');},()=>{f.credentials.dispatch(f.a.scope,x.id);f.credentials.dispatch(f.a.scope,x.id);});assert.equal(repeated,0);
  const noResult=f.credentials.reconcile(f.a.scope,x.id);assert.equal(noResult.disposition,'unconfirmed');assert.equal(noResult.command_repeated,false);assert.equal(f.credentialSource.lookup(x.id),null);assert.throws(()=>f.credentials.cancel(f.a.scope,{operation_id:x.id}));
  f.credentialSource.lookupAvailable(false);assert.throws(()=>f.credentials.reconcile(f.a.scope,x.id));projection(f,x.id,'unknown',1);f.credentialSource.lookupAvailable(true);
  f.advance(E.after_credential_expiry_ms);assert.ok(f.choices.quote(f.a.scope,{request_id:f.request.id}).choices.some((m:Value)=>m.site_id==='main-site'),'current G01 remains otherwise eligible after local credential expiry');assert.throws(()=>quote(f));
  const proof=proofRow(f);f.closeCore();const reopened=f.reopen();assert.deepEqual(proofRow(reopened),proof);assert.equal(reopened.credentials.dispatch(reopened.a.scope,x.id).state,'unknown');
  assert.equal(reopened.credentials.reconcile(reopened.a.scope,x.id).disposition,'unconfirmed');projection(reopened,x.id,'unknown',1);assert.throws(()=>quote(reopened));assert.throws(()=>reopened.credentials.cancel(reopened.a.scope,{operation_id:x.id}));sourceCounts(reopened,0,0);
}));

test('CASE-M20-G02-03',()=>usingFixture(f=>{
  const first=authorize(f);f.credentialSource.mode('issue','timeout_after_effect');assert.equal(f.credentials.dispatch(f.a.scope,first.id).state,'unknown');const booked=original(f,first),payload=f.credentialSource.deliver(first.id).payload;
  status(f,first.id,'active');assert.throws(()=>f.credentials.deliver(f.a.scope,first.id));f.credentialSource.mode('issue','apply');let attempted:Value|undefined,denial:unknown;
  // Continue every native stage the candidate permits. No assertion is caught here.
  // The named fault bypasses BOTH family fences and must mint a second credential.
  try{
    const current=f.choices.quote(f.a.scope,{request_id:f.request.id}),choice=current.choices.find((m:Value)=>m.site_id==='main-site');
    const q=f.credentials.quote(f.a.scope,{request_id:f.request.id,choice_id:choice.choice_id,expected_source_digest:current.source_digest,replaces_operation_id:null});
    const p=f.gateway.prepare(f.a.scope,{case_id:E.case_id,action:ISSUE,arguments:{quote_id:q.id,quote_digest:q.digest}}),a=f.gateway.approve(f.reviewer.scope,{preview_id:p.id,preview_digest:p.digest});
    const receipt=f.gateway.execute(f.a.scope,{preview_id:p.id,preview_digest:p.digest,approval_id:a.id});attempted={q,p,a,receipt};f.credentials.dispatch(f.a.scope,receipt.dropoff_operation_id);
  }catch(error){denial=error;}
  const native=credentialRows(f);assert.equal(native.length,1,'exactly one native credential may exist while the original family is unresolved');assert.equal(native[0].operation_id,first.id);assert.equal(native[0].family_ref,booked.command.family_ref);
  assert.equal(sourceRows(f).length,1);assert.equal(f.credentialSource.journal()[0].operation_id,first.id);assert.ok(denial instanceof Error,'the fresh second request must be denied');assert.equal(attempted,undefined,'denial must precede a second authorized operation');
  projection(f,first.id,'unknown',1);verify(f,payload,first.id,true,'active');secretless(f,payload,[attempted,String(denial)]);
}));

test('CASE-M20-G02-04',()=>usingFixture(f=>{
  f.ownership.takeover(f.owner.scope,{case_id:E.case_id,expected_generation:1,reason:'operator_requested'});const g={...f,a:{...f.a,scope:f.owner.scope,bearer:f.owner.bearer}},proof=proofRow(f),q=quote(g);assertQuote(g,q);
  const p=prepared(g,q);assert.throws(()=>f.gateway.approve(f.owner.scope,{preview_id:p.p.id,preview_digest:p.p.digest}),/SELF_APPROVAL_DENIED/);assert.throws(()=>f.choices.quote(f.reviewer.scope,{request_id:f.request.id}));
  assert.doesNotThrow(()=>f.choices.review(f.reviewer.scope,{quote_id:q.id}));assert.throws(()=>f.choices.review(f.reviewer.scope,{quote_id:q.id,owner_id:'owner'}));
  assert.throws(()=>f.gateway.approve(f.reviewer.scope,{preview_id:p.p.id,preview_digest:'f'.repeat(64)}));const a=f.gateway.approve(f.reviewer.scope,{preview_id:p.p.id,preview_digest:p.p.digest}),x={...p,a};
  assert.throws(()=>f.gateway.execute(f.owner.scope,{preview_id:p.p.id,preview_digest:p.p.digest,approval_id:'foreign-approval'}));sourceCounts(f,0,0);const before=count(f.db,'commerce_operations');
  f.db.exec("CREATE TRIGGER credential_test_reject_work BEFORE INSERT ON commerce_operation_work BEGIN SELECT RAISE(ABORT,'CREDENTIAL_TEST_COMMIT_CUT');END");
  try{assert.throws(()=>execute(g,x),/CREDENTIAL_TEST_COMMIT_CUT/);}finally{f.db.exec('DROP TRIGGER credential_test_reject_work');}
  assert.equal(count(f.db,'commerce_operations'),before);assert.equal(f.db.prepare('SELECT uses FROM commerce_action_approvals WHERE id=?').get(a.id).uses,0);sourceCounts(f,0,0);
  const op=execute(g,x);projection(g,op.id,'authorized',0);assert.throws(()=>execute(g,x));assert.equal(f.db.prepare('SELECT uses FROM commerce_action_approvals WHERE id=?').get(a.id).uses,1);
  f.credentialSource.lookupAvailable(false);assert.throws(()=>f.credentials.cancel(f.owner.scope,{operation_id:op.id}));projection(g,op.id,'authorized',0);f.credentialSource.lookupAvailable(true);
  assert.equal(f.credentials.cancel(f.owner.scope,{operation_id:op.id}).state,'cancelled');projection(g,op.id,'cancelled',0);assert.ok(f.db.prepare('SELECT body FROM commerce_operation_receipts WHERE operation_id=?').all(op.id).some((r:Value)=>JSON.parse(r.body).code==='credential_cancelled'));
  assertQuote(g,quote(g));sourceCounts(f,0,0);assert.deepEqual(proofRow(f),proof);
}));

test('CASE-M20-G02-05',async()=>{
  for(const change of ['items','fee','method'])await usingFixture(f=>{
    const x=authorize(f),proof=proofRow(f);assertQuote(f,x.q);
    if(change==='items'){const order=f.order(),payload=structuredClone(order.payload);payload.return_lines[0].returned=1;updateResource(f,order,payload);}
    else if(change==='fee'){const configuration=f.partner.configuration('reverse_hub');configurePartner(f,{terms:{...configuration.body.terms,fee_minor:'275'}});enable(f);publish(f);assert.equal(f.choices.quote(f.a.scope,{request_id:f.request.id}).choices.find((m:Value)=>m.site_id==='main-site').fees.partner_fee.amount_minor,'275');}
    else{const combinations=structuredClone(f.source.observe().combinations);combinations.find((m:Value)=>m.site_id==='main-site').packaging='box_required';publish(f,{combinations});assert.equal(f.choices.quote(f.a.scope,{request_id:f.request.id}).choices.find((m:Value)=>m.site_id==='main-site').packaging,'box_required');}
    assert.throws(()=>f.credentials.dispatch(f.a.scope,x.id),change+' must invalidate unsent approved terms');assert.equal(nativeOperation(f.db,x.id).state,'queued');assert.equal(nativeWork(f.db,x.id).attempts,0);sourceCounts(f,0,0);assert.deepEqual(proofRow(f),proof);assert.deepEqual(x.q.quote.method.fees,E.method.fees);
  });
});

test('CASE-M20-G02-06',async()=>{
  await usingFixture(f=>{
    const issue=authorize(f);assert.equal(f.credentials.dispatch(f.a.scope,issue.id).state,'issued');const payload=f.credentials.deliver(f.a.scope,issue.id).payload,first=original(f,issue).result,revoke=authorizeRevoke(f,issue.id);let command:Value|undefined;
    f.credentialSource.mode('revoke','timeout_before_effect');withMethod(f.credentialSource,'revoke',(send,value)=>{command=structuredClone(value);return send(value);},()=>assert.equal(f.credentials.dispatch(f.a.scope,revoke.id).state,'unknown'));
    projection(f,revoke.id,'unknown',1);status(f,issue.id,'active');sourceCounts(f,1,1);assert.throws(()=>f.credentials.deliver(f.a.scope,issue.id));assert.throws(()=>quote(f,issue.id));assert.equal(f.credentials.reconcile(f.a.scope,revoke.id).disposition,'unconfirmed');
    let repeats=0;withMethod(f.credentialSource,'revoke',()=>{repeats++;throw new Error('REVOKE_REPEAT_FORBIDDEN');},()=>f.credentials.dispatch(f.a.scope,revoke.id));assert.equal(repeats,0);
    assert.ok(command);f.credentialSource.mode('revoke','apply');assert.equal(f.credentialSource.revoke(command).state,'revoked');assert.equal(f.credentials.reconcile(f.a.scope,revoke.id).disposition,'reconciled');projection(f,revoke.id,'revoked',1);projection(f,issue.id,'issued',1);status(f,issue.id,'revoked');verify(f,payload,issue.id,false,'revoked');assert.deepEqual(f.credentialSource.lookup(issue.id),first);
    const replacement=authorize(f,issue.id);assert.equal(f.credentials.dispatch(f.a.scope,replacement.id).state,'issued');sourceCounts(f,3,2);original(f,revoke,'revoked');original(f,replacement);assert.equal(status(f,issue.id,'revoked').replaced_by,replacement.id);status(f,replacement.id,'active',2);assert.throws(()=>f.credentials.deliver(f.a.scope,issue.id));
  });
  await usingFixture(f=>{
    const issue=authorize(f);f.credentials.dispatch(f.a.scope,issue.id);const payload=f.credentials.deliver(f.a.scope,issue.id).payload,revoke=authorizeRevoke(f,issue.id);f.credentialSource.mode('revoke','reject');assert.equal(f.credentials.dispatch(f.a.scope,revoke.id).state,'rejected');projection(f,revoke.id,'rejected',1);original(f,revoke,'rejected');status(f,issue.id,'active');assert.equal(f.credentials.deliver(f.a.scope,issue.id).payload,payload);assert.throws(()=>quote(f,issue.id));sourceCounts(f,2,1);
  });
});

test('CASE-M20-G02-07',async()=>{
  await usingFixture(f=>{
    const x=authorize(f);f.credentialSource.mode('issue','timeout_after_effect');f.credentials.dispatch(f.a.scope,x.id);const booked=original(f,x),before=sourceState(f);
    for(const patch of [{state:'partial',accepted_items:['alpha']},{items_digest:'f'.repeat(64)},{operation_id:'another-original-operation'},{source_identity:'e'.repeat(64)}]){
      withMethod(f.credentialSource,'lookup',()=>rehash(booked.result,patch),()=>assert.throws(()=>f.credentials.reconcile(f.a.scope,x.id)));projection(f,x.id,'unknown',1);assert.deepEqual(sourceState(f),before);
    }
    assert.equal(f.credentials.reconcile(f.a.scope,x.id).disposition,'reconciled');const metadata=status(f,x.id,'active');for(const patch of [{credential_id:'another-credential'},{items_digest:'b'.repeat(64)},{expires_at:metadata.expires_at+1}])withMethod(f.credentialSource,'credential',()=>rehash(metadata,patch),()=>assert.throws(()=>f.credentials.deliver(f.a.scope,x.id)));
    assert.equal(f.credentials.deliver(f.a.scope,x.id).operation_id,x.id);sourceCounts(f,1,1);
  });
  await usingFixture(f=>{
    const x=authorize(f);f.db.exec("CREATE TRIGGER credential_test_reject_completion BEFORE UPDATE ON commerce_operations WHEN NEW.state='succeeded' BEGIN SELECT RAISE(ABORT,'CREDENTIAL_TEST_COMPLETION_CUT');END");
    let failure:unknown;try{f.credentials.dispatch(f.a.scope,x.id);}catch(error){failure=error;}finally{f.db.exec('DROP TRIGGER credential_test_reject_completion');}if(failure)assert.ok(failure instanceof Error);
    projection(f,x.id,'unknown',1);sourceCounts(f,1,1);original(f,x);assert.equal(f.credentials.reconcile(f.a.scope,x.id).disposition,'reconciled');projection(f,x.id,'issued',1);sourceCounts(f,1,1);
  });
});

test('CASE-M20-G02-08',async()=>{
  await usingFixture(f=>{
    const x=authorize(f);f.credentials.dispatch(f.a.scope,x.id);const delivered=f.credentials.deliver(f.a.scope,x.id),booked=original(f,x),row=credentialRows(f)[0];secretless(f,delivered.payload,[f.credentials.read(f.a.scope,x.id),status(f,x.id,'active')]);
    assert.equal(row.key_id,f.keys.activeId);for(const name of ['nonce','cipher','tag','payload_hash'])assert.ok(row[name]);assert.ok(Object.isFrozen(f.credentialSource));assert.throws(()=>new DropoffCredentials(f.kernel,{choices:f.choices,source:{...f.credentialSource} as any}));
    f.keyAvailable(false);assert.throws(()=>f.credentials.deliver(f.a.scope,x.id));assert.deepEqual(f.credentialSource.lookup(x.id),booked.result);assert.equal(status(f,x.id,'active').delivery_available,false);projection(f,x.id,'issued',1);assert.throws(()=>quote(f));f.keyAvailable(true);assert.equal(f.credentials.deliver(f.a.scope,x.id).payload,delivered.payload);
    const corrupt=typeof row.cipher==='string'?(row.cipher[0]==='A'?'B':'A')+row.cipher.slice(1):Buffer.from(row.cipher);if(typeof corrupt!=='string')corrupt[0]^=1;
    f.partnerDb.prepare('UPDATE fixture_dropoff_credentials SET cipher=? WHERE operation_id=?').run(corrupt,x.id);try{assert.throws(()=>f.credentials.deliver(f.a.scope,x.id));assert.deepEqual(f.credentialSource.lookup(x.id),booked.result);}finally{f.partnerDb.prepare('UPDATE fixture_dropoff_credentials SET cipher=? WHERE operation_id=?').run(row.cipher,x.id);}
    const identity=f.partnerDb.prepare('SELECT * FROM fixture_dropoff_credential_identity WHERE singleton=1').get(),body=JSON.parse(identity.body),changed={...body,source_account_id:'foreign-account'};const {source_identity:_old,...fields}=changed;changed.source_identity=contentDigest(fields);
    f.partnerDb.prepare('UPDATE fixture_dropoff_credential_identity SET body=?,digest=? WHERE singleton=1').run(canonical(changed),contentDigest(changed));try{assert.throws(()=>f.credentialSource.journal());assert.throws(()=>f.credentials.read(f.a.scope,x.id));}finally{f.partnerDb.prepare('UPDATE fixture_dropoff_credential_identity SET body=?,digest=? WHERE singleton=1').run(identity.body,identity.digest);}
    assert.equal(f.credentials.deliver(f.a.scope,x.id).payload,delivered.payload);sourceCounts(f,1,1);
  });
  await usingEligibility(f=>{
    assert.equal(f.partnerDb.prepare("SELECT count(*) n FROM sqlite_master WHERE name LIKE 'fixture_dropoff_credential%'").get().n,0);new CommerceKernel(f.partnerDb,f.now);
    assert.throws(()=>new DropoffCredentialFixtureSource(f.source,keyring().keys));assert.equal(f.partnerDb.prepare("SELECT count(*) n FROM sqlite_master WHERE name LIKE 'fixture_dropoff_credential%'").get().n,0,'core rejection must precede credential schema creation');
  });
});

test('CASE-M20-G02-09',async()=>{
  await usingFixture(f=>{
    const proof=proofRow(f),current=f.choices.quote(f.a.scope,{request_id:f.request.id}),choice=current.choices.find((m:Value)=>m.site_id==='main-site'),input={request_id:f.request.id,choice_id:choice.choice_id,expected_source_digest:current.source_digest,replaces_operation_id:null},q=quote(f),p=prepared(f,q),worker=externalWorker(f);
    const denied=[f.customer,f.agent.scope,f.a.worker,f.b.scope,f.c.scope,worker,{...f.a.scope}];
    for(const scope of denied){assert.throws(()=>f.credentials.quote(scope,input));assert.throws(()=>f.gateway.prepare(scope,{case_id:E.case_id,action:ISSUE,arguments:{quote_id:q.id,quote_digest:q.digest}}));assert.throws(()=>f.gateway.approve(scope,{preview_id:p.p.id,preview_digest:p.p.digest}));}
    const a=f.gateway.approve(f.reviewer.scope,{preview_id:p.p.id,preview_digest:p.p.digest}),x={...p,a};for(const scope of denied)assert.throws(()=>execute(f,x,scope));assert.equal(f.db.prepare('SELECT uses FROM commerce_action_approvals WHERE id=?').get(a.id).uses,0);
    const operation=execute(f,x);for(const scope of denied)assert.throws(()=>f.credentials.dispatch(scope,operation.id));sourceCounts(f,0,0);assert.equal(f.credentials.dispatch(f.a.scope,operation.id).state,'issued');
    for(const scope of denied){assert.throws(()=>f.credentials.deliver(scope,operation.id));assert.throws(()=>f.credentials.read(scope,operation.id));}assert.equal(f.credentials.deliver(f.a.scope,operation.id).operation_id,operation.id);assert.deepEqual(proofRow(f),proof);sourceCounts(f,1,1);
  });
  for(const changed of ['proof','ownership','approver','stop'])await usingFixture(f=>{
    const x=authorize(f);
    if(changed==='proof')f.kernel.revoke(f.customer);
    else if(changed==='ownership')f.ownership.takeover(f.owner.scope,{case_id:E.case_id,expected_generation:1,reason:'operator_requested'});
    else if(changed==='approver')f.permissions.change(f.owner.scope,{actor_id:f.reviewer.actor,role:'reviewer',actions:['support.read','operation.read'],resource_ids:null,expected_revision:0});
    else new ExecutionStops(f.kernel).set(f.owner.scope,{action:ISSUE,stopped:true,reason:'incident',expected_revision:0});
    assert.throws(()=>f.credentials.dispatch(f.a.scope,x.id),changed+' is rechecked before provider effect');assert.equal(nativeWork(f.db,x.id).attempts,0);sourceCounts(f,0,0);
  });
});

test('CASE-M20-G02-10',()=>usingFixture(f=>{
  const x=authorize(f);f.credentials.dispatch(f.a.scope,x.id);const first=f.credentials.deliver(f.a.scope,x.id),history=sourceRows(f),before=unrelated(f);f.advance(E.after_quote_expiry_ms);
  assert.ok(f.db.prepare('SELECT expires_at FROM commerce_action_approvals WHERE id=?').get(x.a.id).expires_at<f.now());assert.equal(f.db.prepare('SELECT uses FROM commerce_action_approvals WHERE id=?').get(x.a.id).uses,1);
  const delivered=f.credentials.deliver(f.a.scope,x.id);assert.deepEqual(delivered,first,'delivery neither reissues nor renews the credential');verify(f,delivered.payload,x.id,true,'active');secretless(f,delivered.payload,[x,projection(f,x.id,'issued',1)]);
  f.advance(E.after_credential_expiry_ms-E.after_quote_expiry_ms);assert.throws(()=>f.credentials.deliver(f.a.scope,x.id));assert.throws(()=>f.credentialSource.deliver(x.id));verify(f,delivered.payload,x.id,false,'expired');projection(f,x.id,'issued',1);
  assert.deepEqual(sourceRows(f),history);sourceCounts(f,1,1);assert.deepEqual(unrelated(f),before);
}));

test('CASE-M20-G02-11',()=>usingFixture(async f=>{
  const before=unrelated(f),x=authorize(f),native=nativeState(f.db,x.id),db=new DatabaseSync(':memory:'),generic=new SyntheticJournal(db,f.a.tenant,f.a.store);
  try{
    const work=new DurableWork(f.kernel);assert.throws(()=>work.claim(f.a.scope,x.id));assert.throws(()=>work.bind(f.a.scope,x.id,generic));assert.throws(()=>work.recover(f.a.scope,x.id));await assert.rejects(new Reconciliation(f.kernel).one(f.a.scope,x.id,generic));assert.throws(()=>new ExecutionStops(f.kernel).reauthorize(f.owner.scope,x.id,native.operation.revision));assert.deepEqual(nativeState(f.db,x.id),native);
    const firstReceipt=f.db.prepare('SELECT id FROM commerce_operation_receipts WHERE operation_id=? ORDER BY seq').get(x.id).id;assert.throws(()=>new OperationReceipts(f.kernel).attach(f.owner.scope,{receipt_id:firstReceipt,subject_ref:E.customer_id,kind:'customer_note',content:'Bounded credential note',expires_at:f.now()+10000}));
    f.credentialSource.mode('issue','timeout_after_effect');f.credentials.dispatch(f.a.scope,x.id);const s=f.kernel.require(f.a.scope);assert.deepEqual(unresolvedEffects(f.kernel,s,f.resourceId),[]);
    const control=f.kernel.transaction(()=>queueOperation(f.kernel,s,f.resourceId,'event','credential_stream_control',{schema_version:1,action:'diagnostic.projection.record',resource_id:f.resourceId,source_id:'credential_stream_control',source_digest:'a'.repeat(64),financial_effect:false}));assert.equal(new BusinessOperations(f.kernel).read(f.a.scope,control.id).work.blocked_by,null);
    const noOwner=new ExceptionQueue(f.kernel,()=>generic);await assert.rejects(noOwner.reconcile(f.a.scope,x.id));const queue=new ExceptionQueue(f.kernel,()=>generic,{dropoff:f.credentials}),item=queue.list(f.a.scope).items.find((r:Value)=>r.operation_id===x.id);assert.ok(item);assert.equal(item.actions.find((a:Value)=>a.name==='retry').enabled,false);assert.equal(item.actions.find((a:Value)=>a.name==='reauthorize').enabled,false);assert.equal(item.actions.find((a:Value)=>a.name==='reconcile').enabled,true);
    const provider=sourceState(f),answer=await queue.reconcile(f.a.scope,x.id);assert.equal(answer.command_repeated,false);assert.equal(answer.operation.state,'issued');assert.deepEqual(sourceState(f),provider);
    const receipts=f.db.prepare('SELECT id,body FROM commerce_operation_receipts WHERE operation_id=? ORDER BY seq').all(x.id),last=receipts.find((r:Value)=>JSON.parse(r.body).code==='source_confirmed');assert.ok(last);assert.throws(()=>new OperationReceipts(f.kernel).correct(f.owner.scope,{receipt_id:firstReceipt,replacement_receipt_id:last.id,reason:'reconciled_source'}));
    const row=operationRow(f.db,x.id);writeDocument(f.db,row,{...JSON.parse(row.body),unexpected_copy:'not permitted'});try{assert.throws(()=>f.credentials.read(f.a.scope,x.id));}finally{restoreDocument(f.db,row);}
    const bad=f.kernel.transaction(()=>queueOperation(f.kernel,s,f.resourceId,'event','credential_malformed_control',{schema_version:1,action:ISSUE,resource_id:f.resourceId,source_id:'credential_malformed_control',source_digest:'b'.repeat(64),financial_effect:false}));f.kernel.transaction(()=>{f.db.prepare("UPDATE commerce_operation_work SET state='unknown' WHERE operation_id=?").run(bad.id);transitionOperation(f.kernel,s,bad.id,'unknown','outcome_unknown');});
    let blockers:Value[]|undefined,failure:unknown;try{blockers=unresolvedEffects(f.kernel,s,f.resourceId);}catch(error){failure=error;}if(blockers)assert.ok(blockers.some(r=>r.id===bad.id),'an action string without its strict typed record gets no stream exemption');else assert.ok(failure instanceof Error);
    assert.deepEqual(unrelated(f),before);sourceCounts(f,1,1);assert.equal(generic.count(),0);
  }finally{db.close();}
}));

test('CASE-M20-G02-12',()=>usingFixture(f=>{
  const x=authorize(f);f.credentialSource.mode('issue','timeout_after_effect');f.credentials.dispatch(f.a.scope,x.id);const booked=original(f,x),proof=proofRow(f);f.closeCore();
  configurePartner(f,{account_id:'later-unrelated-account'});f.partnerDb.prepare('DELETE FROM fixture_dropoff_configuration').run();f.keyAvailable(false);const reopened=f.reopen();assert.deepEqual(proofRow(reopened),proof);assert.equal(reopened.credentialSource.account,E.provider_account_id);
  let observations=0;const answer=withMethod(reopened.source,'observe',()=>{observations++;throw new Error('HISTORICAL_LOOKUP_MUST_NOT_OBSERVE_DIRECTORY');},()=>withMethod(reopened.choices,'quote',()=>{observations++;throw new Error('HISTORICAL_LOOKUP_MUST_NOT_REQUOTE');},()=>reopened.credentials.reconcile(reopened.a.scope,x.id)));
  assert.equal(observations,0);assert.equal(answer.disposition,'reconciled');projection(reopened,x.id,'issued',1);assert.deepEqual(reopened.credentialSource.lookup(x.id),booked.result);assert.equal(status(reopened,x.id,'active').delivery_available,false);
  const revoke=withMethod(reopened.choices,'quote',()=>{throw new Error('REVOKE_MUST_NOT_REQUIRE_CURRENT_ELIGIBILITY');},()=>authorizeRevoke(reopened,x.id));assert.equal(reopened.credentials.dispatch(reopened.a.scope,revoke.id).state,'revoked');projection(reopened,x.id,'issued',1);projection(reopened,revoke.id,'revoked',1);sourceCounts(reopened,2,1);
  f.advance(E.after_credential_expiry_ms);status(reopened,x.id,'revoked');assert.deepEqual(reopened.credentialSource.lookup(x.id),booked.result);assert.equal(reopened.credentials.reconcile(reopened.a.scope,x.id).disposition,'unchanged');assert.deepEqual(proofRow(reopened),proof);
}));

test('CASE-M20-G02-13',async()=>{
  await usingFixture(f=>{
    const x=authorize(f);f.credentials.dispatch(f.a.scope,x.id);const delivered=f.credentials.deliver(f.a.scope,x.id),privacy=new PrivacyLifecycle(f.kernel),exported=privacy.export(f.owner.scope,E.customer_id) as Value;
    assert.equal(exported.credentials_included,false);assert.equal(exported.dropoff_credential_records.length,2);assert.deepEqual(new Set(exported.dropoff_credential_records.map((r:Value)=>r.kind)),new Set([QUOTE_KIND,OP_KIND]));assert.equal(JSON.stringify(exported).includes(f.customerBearer),false);secretless(f,delivered.payload,exported);
    privacy.hold(f.owner.scope,{customer_id:E.customer_id,reason:'retention_obligation',authority_ref:'credential-live-hold',expires_at:f.now()+600000});assert.equal(f.credentials.deliver(f.a.scope,x.id).payload,delivered.payload,'hold creation alone is not revocation');assert.equal(privacy.erase(f.owner.scope,E.customer_id).status,'held');
    for(const row of documentRows(f.db)){const body=JSON.parse(row.body);assert.equal(body.authority_revoked,true);assert.equal(body.minimized,false);assert.notEqual(body[row.kind===QUOTE_KIND?'terms':'personal'],null);}assert.throws(()=>f.credentials.deliver(f.a.scope,x.id));assert.equal(f.db.prepare('SELECT revoked FROM commerce_action_approvals WHERE id=?').get(x.a.id).revoked,1);
    privacy.releaseHold(f.owner.scope,E.customer_id,'credential-live-hold');assert.equal(privacy.erase(f.owner.scope,E.customer_id).status,'logically_erased');const body=minimized(f.db,x.id);assert.equal(body.source_cleanup,'forgotten');assert.equal(body.state,'issued');assert.equal(f.credentials.read(f.owner.scope,x.id).minimized,true);assert.throws(()=>f.credentials.read(f.a.scope,x.id));assert.throws(()=>f.credentials.deliver(f.owner.scope,x.id));
    const provider=credentialRows(f)[0];for(const field of ['key_id','nonce','cipher','tag'])assert.equal(provider[field],null);assert.ok(provider.payload_hash);status(f,x.id,'active');assert.equal(f.credentialSource.credential(x.id).delivery_available,false);original(f,x);sourceCounts(f,1,1);assert.equal(privacy.erase(f.owner.scope,E.customer_id).status,'already_erased');
  });
  await usingFixture(f=>{
    const x=authorize(f);f.credentialSource.mode('issue','timeout_after_effect');f.credentials.dispatch(f.a.scope,x.id);retireSubject(f);const saved=documentRows(f.db);f.closeCore();const detached=f.reopen(false),privacy=new PrivacyLifecycle(detached.kernel),exported=privacy.export(detached.owner.scope,E.customer_id) as Value;
    assert.deepEqual(exported.resources,[]);assert.equal(exported.dropoff_credential_records.length,2);privacy.hold(detached.owner.scope,{customer_id:E.customer_id,reason:'dispute',authority_ref:'credential-historical-hold',expires_at:f.now()+600000});assert.equal(privacy.erase(detached.owner.scope,E.customer_id).status,'held');privacy.releaseHold(detached.owner.scope,E.customer_id,'credential-historical-hold');
    assert.equal(privacy.erase(detached.owner.scope,E.customer_id).status,'logically_erased');assert.equal(minimized(detached.db,x.id).source_cleanup,'pending');assert.ok(credentialRows(f)[0].cipher,'detached cleanup must not falsely claim ciphertext removal');
    const attached={...detached,...detached.attach()};assert.equal(minimized(attached.db,x.id).source_cleanup,'forgotten');assert.equal(credentialRows(f)[0].cipher,null);assert.equal(attached.credentials.reconcile(attached.owner.scope,x.id).disposition,'reconciled');
    // Replay an exact pre-erasure quote copy under an existing subject tombstone.
    const quoteRow=saved.find((r:Value)=>r.kind===QUOTE_KIND)!;attached.db.prepare('UPDATE commerce_support_documents SET body=?,digest=?,state=?,expires_at=? WHERE kind=? AND id=? AND version=?').run(quoteRow.body,quoteRow.digest,quoteRow.state,quoteRow.expires_at,quoteRow.kind,quoteRow.id,quoteRow.version);
    assert.equal(privacy.erase(detached.owner.scope,E.customer_id).status,'already_erased');minimized(attached.db,x.id);assert.equal(attached.kernel.get(attached.a.scope,f.resourceId).customer_id,'C-1002');sourceCounts(f,1,1);
  });
  await usingFixture(f=>{
    const x=authorize(f);f.credentialSource.mode('issue','timeout_before_effect');f.credentials.dispatch(f.a.scope,x.id);const privacy=new PrivacyLifecycle(f.kernel),other=f.kernel.list(f.b.scope,'order');privacy.hold(f.owner.scope,{customer_id:E.customer_id,reason:'dispute',authority_ref:'credential-uninstall-hold',expires_at:f.now()+600000});assert.equal(privacy.uninstall(f.owner.scope).status,'disconnected');
    const body=JSON.parse(operationRow(f.db,x.id).body);assert.equal(body.state,'unknown');assert.equal(body.attempt_count,1);assert.equal(body.authority_revoked,true);assert.equal(body.minimized,false);assert.throws(()=>f.credentials.read(f.owner.scope,x.id));assert.throws(()=>f.credentials.deliver(f.a.scope,x.id));assert.deepEqual(f.kernel.list(f.b.scope,'order'),other);sourceCounts(f,0,0);
  });
});

test('CASE-M20-G02-14',async()=>{
  await usingFixture(f=>{
    const x=authorize(f),privacy=new PrivacyLifecycle(f.kernel);privacy.hold(f.owner.scope,{customer_id:E.customer_id,reason:'retention_obligation',authority_ref:'credential-copied-hold',expires_at:f.now()+600000});const saved=backup(f);
    f.credentialSource.mode('issue','timeout_after_effect');f.credentials.dispatch(f.a.scope,x.id);const booked=original(f,x),provider=sourceRows(f);privacy.releaseHold(f.owner.scope,E.customer_id,'credential-copied-hold');f.advance(1);privacy.erase(f.owner.scope,E.customer_id);const restored=restore(f,saved);
    try{
      assert.equal(restored.result.mode,'quarantine');assert.equal(restored.result.external_effects,false);assert.throws(()=>restored.kernel.authenticate(f.a.bearer));assert.throws(()=>restored.kernel.authenticate(f.customerBearer));const value=projection(restored,x.id,'unknown',0,restored.scope);assert.equal(value.restored,true);assert.equal(value.authority_revoked,true);assert.equal(value.minimized,true);minimized(restored.db,x.id);
      assert.equal(restored.db.prepare('SELECT released FROM commerce_privacy_holds WHERE authority_ref=?').get('credential-copied-hold').released,0);assert.throws(()=>restored.credentials.cancel(restored.scope,{operation_id:x.id}));assert.throws(()=>restored.credentials.dispatch(restored.scope,x.id));assert.throws(()=>restored.credentials.deliver(restored.scope,x.id));
      const answer=restored.credentials.reconcile(restored.scope,x.id);assert.equal(answer.disposition,'reconciled');assert.equal(answer.command_repeated,false);projection(restored,x.id,'issued',0,restored.scope);assert.deepEqual(f.credentialSource.lookup(x.id),booked.result);assert.deepEqual(sourceRows(f),provider);sourceCounts(f,1,1);
    }finally{restored.close();}
  });
  await usingFixture(f=>{
    const x=authorize(f);f.credentialSource.mode('issue','timeout_after_effect');f.credentials.dispatch(f.a.scope,x.id);const packed=merchant(f),provider=sourceRows(f),destination=target(f);
    try{
      transfer(f,destination,packed);const imported=projection(destination,x.id,'unknown',1,destination.scope);assert.equal(imported.restored,true);assert.equal(imported.authority_revoked,true);assert.throws(()=>destination.credentials.dispatch(destination.scope,x.id));assert.throws(()=>destination.credentials.cancel(destination.scope,{operation_id:x.id}));assert.throws(()=>destination.credentials.deliver(destination.scope,x.id));
      assert.equal(destination.credentials.reconcile(destination.scope,x.id).disposition,'reconciled');new PrivacyLifecycle(f.kernel).erase(f.owner.scope,E.customer_id);const latest=suppression(f);transfer(f,destination,packed,latest);assert.equal(minimized(destination.db,x.id).state,'issued');const once=nativeState(destination.db,x.id);transfer(f,destination,packed,latest);assert.deepEqual(nativeState(destination.db,x.id),once);
      assert.equal(documentRows(destination.db).length,2);assert.equal(destination.db.prepare("SELECT count(*) n FROM commerce_support_documents WHERE kind='merchant_import'").get().n,1);assert.equal(destination.db.prepare('SELECT suppression_digest FROM commerce_recovery_state WHERE id=1').get().suppression_digest,latest.suppression_sha256);assert.deepEqual(sourceRows(f),provider);sourceCounts(f,1,1);
    }finally{destination.close();}
  });
});
