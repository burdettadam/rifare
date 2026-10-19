import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {usingImages,imageFixture,PHOTO} from './image-assistance-helpers.mts';
import {usingGift} from './gift-helpers.mts';
import {CommerceKernel,digest} from '../../packages/commerce/kernel.mts';
import {canonical,contentDigest} from '../../packages/commerce/configuration-values.mts';
import {ImageAssistance,assessImageQualification,verifyImageReceipt} from '../../packages/commerce/image-assistance.mts';
import {ImageResources} from '../../packages/commerce/image-resources.mts';
import {verifyDecisionReceipt} from '../../packages/commerce/decision-shadow.mts';
import {PrivacyLifecycle,suppressionCheckpoint} from '../../packages/commerce/privacy-lifecycle.mts';
import {createRecoverySnapshot,restoreRecoverySnapshot} from '../../packages/commerce/safe-recovery.mts';
import {exportMerchant,exportMerchantSuppression,importMerchant,merchantSnapshotDigest} from '../../packages/commerce/merchant-portability.mts';
import {SupportOwnership} from '../../packages/commerce/support-core.mts';
import {ExecutionStops} from '../../packages/commerce/execution-stops.mts';
import {SecretVault} from '../../packages/commerce/secrets.mts';
import {IMAGE_ADAPTER} from '../../packages/agent/image-reader.mts';

test('M17-IMAGES-DEFAULT-MANUAL-01',()=>usingImages(async f=>{
  f.images.configure(f.owner.scope,f.configuration({expected_version:1,enabled:false}));
  assert.equal(f.images.status(f.a.scope,f.imageRef).modalities.image.enabled,false);
  assert.equal(f.images.status(f.a.scope,f.imageRef).manual_workflow_available,true);
  assert.throws(()=>f.upload(),/IMAGE_DISABLED/);
  const manual=f.evidence.upload(f.customer,{case_id:f.imageCase.id,mime:'image/png',base64:PHOTO,note:'Manual return photo'});
  await f.evidence.scan(f.reviewer.scope,manual.id);assert.equal(f.evidence.sign(f.customer,manual.id).model_access,false);
  assert.throws(()=>f.images.approve(f.customer,f.approvalInput(manual)),/IMAGE_DISABLED/);assert.equal(f.imageRequests.length,0);
}));
test('M17-IMAGES-INTAKE-QUARANTINE-02',()=>usingImages(async f=>{
  assert.throws(()=>f.upload({customer_opt_in:false}),/IMAGE_CONSENT_REQUIRED/);
  for(const mime of ['audio/wav','video/mp4','image/jpeg','image/svg+xml'])assert.throws(()=>f.upload({mime}),/EVIDENCE_TYPE_REJECTED/);
  assert.throws(()=>f.upload({base64:Buffer.alloc(262145).toString('base64')}),/EVIDENCE_TYPE_REJECTED|INVALID_INPUT/);
  const e=f.upload();assert.equal(e.status,'quarantined');assert.equal(e.model_access,false);
  assert.throws(()=>f.images.approve(f.customer,f.approvalInput(e)),/IMAGE_EVIDENCE_UNAVAILABLE/);
  await f.evidence.scan(f.reviewer.scope,e.id);
  assert.throws(()=>f.images.approve(f.customer,f.approvalInput(e,{consent:false})),/IMAGE_CONSENT_REQUIRED/);
  assert.throws(()=>f.images.prepare(f.a.scope,f.imageInput({id:'invented'})),/IMAGE_APPROVAL_UNAVAILABLE/);assert.equal(f.imageRequests.length,0);
}));
test('M17-IMAGES-EXACT-PNG-ADVISORY-03',()=>usingImages(async f=>{
  const {evidence,approval}=await f.approve(),business=f.business(),r=await f.images.run(f.a.scope,f.imageInput(approval));
  assert.equal(f.imageRequests.length,1);const wire=f.imageRequests[0];assert.deepEqual(wire.body.images,['data:image/png;base64,'+PHOTO]);assert.equal(wire.body.model,'clef-omni');assert.equal(wire.authorization_present,true);
  assert.deepEqual(Object.keys(wire.body.questions).sort(),imageFixture('evaluation-protocol.v1').questions.slice().sort());
  assert.equal(r.source.evidence_id,evidence.id);assert.equal(r.source.sha256,digest(Buffer.from(PHOTO,'base64')));assert.equal(r.derivative.sha256,r.source.sha256);assert.equal(r.derivative.transformation,'restricted_png_identity_v1');
  assert.equal(r.result.status,'usable');assert.equal(r.handling,'review');assert.equal(r.provenance.live_inference_observed,false);
  assert.deepEqual([r.business_effects,r.routing_changed,r.execution_authorized,r.truncated],[0,false,false,false]);assert.deepEqual(f.business(),business);
  assert.equal(JSON.stringify(f.imageRows()).includes(PHOTO),false);assert.equal(JSON.stringify(f.imageRows()).includes('SYNTHETIC_IMAGE_SECRET'),false);assert.equal(JSON.stringify(f.imageRows()).includes('SYNTHETIC_IMAGE_NOTE'),false);
}));
test('M17-IMAGES-PRINCIPAL-BOUNDARIES-04',()=>usingImages(async f=>{
  const {evidence,approval}=await f.approve();
  for(const scope of [f.owner.scope,f.a.scope,f.reviewer.scope])assert.throws(()=>f.images.approve(scope,f.approvalInput(evidence)),/ACCESS_DENIED/);
  for(const scope of [f.customer,f.reviewer.scope,f.b.scope])assert.throws(()=>f.images.prepare(scope,f.imageInput(approval)),/ACCESS_DENIED|NOT_FOUND|SUPPORT_OWNERSHIP_CHANGED/);
  const p=f.images.prepare(f.a.scope,f.imageInput(approval));await assert.rejects(()=>f.images.execute(f.b.scope,p),/ACCESS_DENIED|NOT_FOUND/);
  await assert.rejects(()=>f.images.execute(f.a.scope,{}),/IMAGE_PREPARATION_INVALID/);
  assert.throws(()=>new ImageAssistance(f.kernel,f.reads,f.imageVault,f.evidence,[{...f.imageConfigurations[0],reader:Object.freeze({...f.imageReader})}]),/IMAGE_CONFIGURATION_INVALID/);
  assert.equal(f.imageRequests.length,0);
  const genuine=await f.images.run(f.a.scope,f.imageInput(approval));
  const divergentVault=new SecretVault(f.kernel,{activeId:'image_fixture_key',get:()=>Buffer.alloc(32,6)},{},{[IMAGE_ADAPTER]:{provider:'cloudflare',execute:async()=>structuredClone(genuine.result)}});
  const divergent=new ImageAssistance(f.kernel,f.reads,divergentVault,f.evidence,f.imageConfigurations),untrusted=await divergent.run(f.a.scope,f.imageInput(approval));
  assert.equal(untrusted.result.status,'unusable');assert.equal(untrusted.result.reason,'DECISION_OUTPUT_INVALID');assert.equal(untrusted.provenance.dispatch,'transport_unconfirmed');assert.equal(f.imageRequests.length,1);
}));
test('M17-IMAGES-EXACT-SOURCE-BINDING-05',async()=>{
  await usingImages(async f=>{const {evidence,approval}=await f.approve();
    assert.throws(()=>f.images.approve(f.customer,f.approvalInput(evidence,{case_id:f.caseA.id})),/IMAGE_CONTEXT_CHANGED/);
    assert.throws(()=>f.images.approve(f.customer,f.approvalInput(evidence,{sha256:'0'.repeat(64)})),/IMAGE_EVIDENCE_CHANGED/);
    assert.throws(()=>f.images.prepare(f.a.scope,f.imageInput(approval,{task_id:f.taskA.id})),/IMAGE_CONTEXT_CHANGED/);
    const p=f.images.prepare(f.a.scope,f.imageInput(approval));f.db.prepare('UPDATE commerce_return_evidence SET bytes=? WHERE id=?').run(Buffer.from('substituted'),evidence.id);
    await assert.rejects(()=>f.images.execute(f.a.scope,p),/EVIDENCE_INTEGRITY|IMAGE_EVIDENCE_CHANGED/);assert.equal(f.imageRequests.length,0);
  });
  await usingImages(async f=>{const {evidence,approval}=await f.approve(),other=f.upload();await f.evidence.scan(f.reviewer.scope,other.id);
    const p=f.images.prepare(f.a.scope,f.imageInput(approval));f.evidence.erase(f.customer,evidence.id);
    await assert.rejects(()=>f.images.execute(f.a.scope,p),/IMAGE_APPROVAL_UNAVAILABLE|IMAGE_EVIDENCE_UNAVAILABLE/);assert.equal(f.imageRequests.length,0);assert.equal(f.evidence.inspect(f.customer,other.id).state,'clean');
  });
});
test('M17-IMAGES-PREPARED-REVOCATION-06',async()=>{
  for(const kind of ['configuration','customer_session','credential','approval','expiry'])await usingImages(async f=>{
    const {approval}=await f.approve(),p=f.images.prepare(f.a.scope,f.imageInput(approval));
    if(kind==='configuration')f.images.configure(f.owner.scope,f.configuration({expected_version:1,enabled:false}));
    if(kind==='customer_session')f.db.prepare('UPDATE commerce_sessions SET revoked=1 WHERE token_hash=?').run(f.kernel.require(f.customer).token_hash);
    if(kind==='credential')f.imageVault.revoke(f.a.scope,f.imageSecret);
    if(kind==='approval')f.images.revoke(f.customer,{case_id:f.imageCase.id,approval_id:approval.id});
    if(kind==='expiry')f.advance(60001);
    await assert.rejects(()=>f.images.execute(f.a.scope,p),/IMAGE_.*CHANGED|IMAGE_.*UNAVAILABLE|IMAGE_APPROVAL_EXPIRED|IMAGE_DISABLED|SECRET_UNAVAILABLE/);assert.equal(f.imageRequests.length,0,kind);
  });
});
test('M17-IMAGES-COMPLETE-CORRECTIONS-07',async()=>{
  await usingImages(async f=>{const {approval}=await f.approve();f.imageMessage('Correction: inspect the sleeve, not the seam. I now request an exchange.');const r=await f.images.run(f.a.scope,f.imageInput(approval));
    const state=JSON.parse(f.imageRequests[0].body.state);assert.equal(state.customer_claims.messages.length,2);assert.match(state.customer_claims.messages[0],/seam/);assert.match(state.customer_claims.messages[1],/Correction: inspect the sleeve/);assert.equal(r.truncated,false);
  });
  await usingImages(async f=>{const {approval}=await f.approve(),p=f.images.prepare(f.a.scope,f.imageInput(approval));f.imageMessage('Correction: it is the other item.');
    await assert.rejects(()=>f.images.execute(f.a.scope,p),/IMAGE_EVIDENCE_CHANGED/);assert.equal(f.imageRequests.length,0);
  });
  await usingImages(async f=>{const {approval}=await f.approve();f.imageBefore(()=>f.imageMessage('Correction received while the model waits.'));
    await assert.rejects(()=>f.images.run(f.a.scope,f.imageInput(approval)),/IMAGE_EVIDENCE_CHANGED/);assert.equal(f.imageRequests.length,1);assert.equal(f.imageRows().length,1);
  });
});
test('M17-IMAGES-LATE-CONTROL-CHANGES-08',async()=>{
  for(const kind of ['configuration','ownership','stop','credential'])await usingImages(async f=>{const {approval}=await f.approve();f.imageBefore(()=>{
    if(kind==='configuration')f.images.configure(f.owner.scope,f.configuration({expected_version:1,enabled:false}));
    if(kind==='ownership')new SupportOwnership(f.kernel).takeover(f.owner.scope,{case_id:f.imageCase.id,expected_generation:1,reason:'operator_requested'});
    if(kind==='stop')new ExecutionStops(f.kernel).set(f.owner.scope,{action:'model.run',stopped:true,reason:'incident',expected_revision:0});
    if(kind==='credential')f.imageVault.revoke(f.a.scope,f.imageSecret);
  });await assert.rejects(()=>f.images.run(f.a.scope,f.imageInput(approval)),/IMAGE_.*CHANGED|IMAGE_DISABLED|SUPPORT_OWNERSHIP_CHANGED|EXECUTION_STOPPED|SECRET_UNAVAILABLE/);assert.equal(f.imageRequests.length,1);assert.equal(f.imageRows().length,1,kind);});
});
test('M17-IMAGES-CANCEL-AND-SESSION-09',async()=>{
  await usingImages(async f=>{const {approval}=await f.approve(),p=f.images.prepare(f.a.scope,f.imageInput(approval));f.imageBefore(()=>f.images.cancel(f.a.scope,p));
    await assert.rejects(()=>f.images.execute(f.a.scope,p),/IMAGE_CANCELLED/);assert.equal(f.imageRows().length,1);assert.equal(f.imageRequests.length,1);
  });
  await usingImages(async f=>{const {approval}=await f.approve();f.imageBefore(()=>f.db.prepare('UPDATE commerce_sessions SET revoked=1 WHERE token_hash=?').run(f.kernel.require(f.a.scope).token_hash));
    await assert.rejects(()=>f.images.run(f.a.scope,f.imageInput(approval)),/ACCESS_DENIED/);assert.equal(f.imageRows().length,1);
  });
});
test('M17-IMAGES-IDEMPOTENCY-UNKNOWN-10',()=>usingImages(async f=>{
  const {approval}=await f.approve(),input=f.imageInput(approval),reply=structuredClone(f.imageWire.clear);delete reply.result.usage;f.imageResponse(reply);
  const r=await f.images.run(f.a.scope,input);assert.equal(r.result.usage,null);assert.deepEqual(await f.images.run(f.a.scope,input),r);assert.equal(f.imageRequests.length,1);
  const budget=f.budgets.inspect(f.a.scope,'cloudflare','shadow_period');assert.equal(budget.unknown_usage_count,1);assert.ok(BigInt(budget.held_micro)>0n);
  f.images.revoke(f.customer,{case_id:f.imageCase.id,approval_id:approval.id});assert.equal(f.imageRows().length,0);
  const {approval:next}=await f.approve();await assert.rejects(()=>f.images.run(f.a.scope,{...input,approval_id:next.id}),/IMAGE_OBSERVATION_IN_PROGRESS/);assert.equal(f.imageRequests.length,1);
}));
test('M17-IMAGES-ERASURE-AND-LATE-RESULT-11',async()=>{
  await usingImages(async f=>{const {evidence,approval}=await f.approve(),r=await f.images.run(f.a.scope,f.imageInput(approval));f.images.disagree(f.reviewer.scope,{case_id:f.imageCase.id,observation_id:r.id,reason:'image_unclear'});
    assert.equal(f.imageRows().length,3);assert.equal(f.evidence.erase(f.customer,evidence.id).erased,true);assert.equal(f.imageRows().length,0);assert.throws(()=>f.images.read(f.a.scope,f.imageCase.id,r.id),/NOT_FOUND/);
  });
  await usingImages(async f=>{const {evidence,approval}=await f.approve();f.imageBefore(()=>f.evidence.erase(f.customer,evidence.id));
    await assert.rejects(()=>f.images.run(f.a.scope,f.imageInput(approval)),/IMAGE_APPROVAL_UNAVAILABLE|IMAGE_EVIDENCE_UNAVAILABLE/);assert.equal(f.imageRows().length,0);assert.equal(f.db.prepare('SELECT bytes FROM commerce_return_evidence WHERE id=?').get(evidence.id).bytes,null);
    assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_model_reservations WHERE id LIKE ?').get('imageobs_%').n,1);
  });
});
test('M17-IMAGES-RETENTION-AND-HOLDS-12',()=>usingImages(async f=>{
  const {evidence,approval}=await f.approve();await f.images.run(f.a.scope,f.imageInput(approval));const privacy=new PrivacyLifecycle(f.kernel),customer=f.order().customer_id;
  privacy.hold(f.owner.scope,{customer_id:customer,reason:'retention_obligation',authority_ref:'image_hold',expires_at:f.now()+35*86400000});assert.equal(f.evidence.erase(f.customer,evidence.id).held,true);assert.equal(f.imageRows().length,2);
  f.images.revoke(f.customer,{case_id:f.imageCase.id,approval_id:approval.id});assert.equal(f.imageRows().length,2,'withdrawal revokes authority while preserving held evidence');assert.throws(()=>f.images.prepare(f.a.scope,f.imageInput(approval)),/IMAGE_APPROVAL_UNAVAILABLE/);
  f.advance(31*86400000);const owner=f.kernel.authenticate(f.kernel.issueSession(f.a.tenant,f.a.store,'owner'));assert.equal(f.evidence.purgeExpired(owner).erased,0);assert.equal(f.imageRows().length,2);
  privacy.releaseHold(owner,customer,'image_hold');assert.equal(f.evidence.purgeExpired(owner).erased,1);assert.equal(f.imageRows().length,0);
}));
test('M17-IMAGES-SUBJECT-EXPORT-ERASURE-13',()=>usingImages(async f=>{
  const {approval}=await f.approve(),r=await f.images.run(f.a.scope,f.imageInput(approval)),other=await f.shadowB.run(f.b.scope,f.inputB()),privacy=new PrivacyLifecycle(f.kernel),exported=privacy.export(f.owner.scope,f.order().customer_id);
  assert.equal(exported.image_assistance_records.length,2);assert.equal(JSON.stringify(exported.image_assistance_records).includes('session_hash'),false);assert.equal(JSON.stringify(exported).includes(f.kernel.require(f.customer).token_hash),false);assert.equal(JSON.stringify(exported).includes(other.id),false);
  assert.equal(exported.assistance.some((x:any)=>x.id===r.id),false);assert.equal(privacy.erase(f.owner.scope,f.order().customer_id).status,'logically_erased');assert.equal(f.imageRows().length,0);assert.deepEqual(f.shadowB.read(f.b.scope,f.caseB.id,other.id),other);
}));
test('M17-IMAGES-GIFT-RESIDUE-PRIVACY-14',()=>usingGift(f=>{
  // Canonical gift creation plus independently seeded imported residue. This
  // does not represent an enabled gift-recipient image consent/inference path.
  f.createGift();const task=f.reads.createTask(f.a.scope,{order_id:f.giftOrder.id,profile_id:'default'}),evidence=f.evidence.upload(f.a.scope,{case_id:'gift_case',mime:'image/png',base64:PHOTO,note:'Synthetic imported gift image'});
  for(const kind of ['image_approval','image_observation','image_disagreement']){
    const body={schema_version:1,kind,id:'seed_'+kind,case_id:'gift_case',task_id:task.id,source:{evidence_id:evidence.id,sha256:evidence.sha256},customer_session_hash:'SYNTHETIC_PRIVATE_SESSION',observed_at:f.now()};
    f.db.prepare('INSERT INTO commerce_assistance_receipts VALUES(?,?,?,?,?,?)').run(f.a.tenant,f.a.store,body.id,task.id,f.now(),canonical({...body,receipt_digest:contentDigest(body)}));
  }
  const privacy=new PrivacyLifecycle(f.kernel),recipient=privacy.export(f.owner.scope,'recipient-one'),buyer=privacy.export(f.owner.scope,f.giftOrder.customer_id);
  assert.equal(recipient.image_assistance_records.length,3);assert.equal(JSON.stringify(recipient.image_assistance_records).includes('session_hash'),false);assert.equal(JSON.stringify(recipient).includes('Private Purchaser'),false);assert.equal(buyer.image_assistance_records.length,0);assert.equal(JSON.stringify(buyer.assistance).includes('seed_image'),false);
  assert.equal(privacy.erase(f.owner.scope,'recipient-one').status,'logically_erased');assert.equal(f.db.prepare("SELECT count(*) n FROM commerce_assistance_receipts WHERE id LIKE 'seed_image_%'").get().n,0);assert.equal(f.db.prepare('SELECT bytes FROM commerce_return_evidence WHERE id=?').get(evidence.id).bytes,null);assert.equal(f.kernel.get(f.buyer,f.giftOrder.id).payload.purchaser_name,'Private Purchaser');assert.ok(f.reads.task(f.a.scope,task.id));
}));
test('M17-IMAGES-SNAPSHOT-SUPPRESSION-15',()=>usingImages(async f=>{
  const {evidence,approval}=await f.approve();await f.images.run(f.a.scope,f.imageInput(approval));const snapshot=createRecoverySnapshot(f.kernel,join(f.directory,'image-before-erasure'));
  for(const erased of [false,true]){
    if(erased)new PrivacyLifecycle(f.kernel).erase(f.owner.scope,f.order().customer_id);
    const cp=suppressionCheckpoint(f.kernel),r=restoreRecoverySnapshot({snapshot:snapshot.directory,destination:join(f.directory,erased?'image-erased-restore':'image-authority-restore'),manifest_sha256:snapshot.manifest_sha256,suppression:cp,suppression_sha256:contentDigest(cp)},f.now),db=new DatabaseSync(r.database);
    try{assert.equal(db.prepare("SELECT count(*) n FROM commerce_assistance_receipts WHERE json_extract(body,'$.kind') LIKE 'image_%'").get().n,0);assert.equal(db.prepare("SELECT count(*) n FROM commerce_support_documents WHERE kind='image_configuration' AND state='active'").get().n,0);assert.equal(db.prepare('SELECT count(*) n FROM commerce_secrets WHERE revoked=0').get().n,0);assert.equal(db.prepare('SELECT state FROM commerce_return_evidence WHERE id=?').get(evidence.id).state,erased?'erased':'clean');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);}finally{db.close();}
  }
}));
test('M17-IMAGES-IMPORT-AND-HELD-UNINSTALL-16',()=>usingImages(async f=>{
  const {approval}=await f.approve();await f.images.run(f.a.scope,f.imageInput(approval));const before=exportMerchant(f.kernel,f.owner.scope,{snapshot_id:'image_transfer'}),cp=exportMerchantSuppression(f.kernel,f.owner.scope),db=new DatabaseSync(':memory:');
  try{const k=new CommerceKernel(db,f.now);k.provisionStore(f.a.tenant,f.a.store);k.provisionMember(f.a.tenant,f.a.store,'image-import-owner','owner');const owner=k.authenticate(k.issueSession(f.a.tenant,f.a.store,'image-import-owner'));
    assert.equal(importMerchant(k,owner,before,before.digest,{suppression:cp,suppression_sha256:merchantSnapshotDigest(cp)}).mode,'quarantine');assert.equal(db.prepare("SELECT count(*) n FROM commerce_assistance_receipts WHERE json_extract(body,'$.kind') LIKE 'image_%'").get().n,0);assert.equal(db.prepare("SELECT count(*) n FROM commerce_support_documents WHERE kind='image_configuration' AND state='active'").get().n,0);
  }finally{db.close();}
  const privacy=new PrivacyLifecycle(f.kernel);privacy.hold(f.owner.scope,{customer_id:f.order().customer_id,reason:'retention_obligation',authority_ref:'image_uninstall_hold',expires_at:f.now()+86400000});
  const heldSnapshot=createRecoverySnapshot(f.kernel,join(f.directory,'held-image-copy')),heldCp=suppressionCheckpoint(f.kernel);
  assert.throws(()=>restoreRecoverySnapshot({snapshot:heldSnapshot.directory,destination:join(f.directory,'held-image-restore'),manifest_sha256:heldSnapshot.manifest_sha256,suppression:heldCp,suppression_sha256:contentDigest(heldCp)},f.now),/IMAGE_RESTORE_HELD_CONTENT/);
  assert.equal(privacy.uninstall(f.owner.scope).status,'disconnected');assert.equal(f.imageRows().length,2,'held observations and consent evidence retained for local retention administration');assert.equal(f.db.prepare("SELECT count(*) n FROM commerce_support_documents WHERE kind='image_configuration' AND state='active'").get().n,0);assert.throws(()=>f.images.status(f.a.scope,f.imageRef),/ACCESS_DENIED/);
}));
test('M17-IMAGES-CONTEXT-AND-OPTIONAL-RESOURCE-17',()=>usingImages(async f=>{
  const old=f.reads.skills.snapshot(f.a.scope,f.bundle.id,f.bundle.digest),text=f.bundle.files['references/return-intake-questions.v1.json'];assert.equal(f.imageBundle.files['references/return-intake-questions.v1.json'],text);assert.equal(old.version,'1.0.0');assert.equal(f.imageBundle.id,f.bundle.id);
  assert.throws(()=>new ImageResources(f.kernel,f.reads).snapshot(f.a.scope,{case_id:f.caseA.id,task_id:f.taskA.id,serving_configuration_ref:f.imageRef}),/IMAGE_RESOURCE_UNAVAILABLE/);
  const {approval}=await f.approve();f.imageMessage('a'.repeat(7500));f.imageMessage('b'.repeat(7500));f.imageMessage('Critical final correction: the item is different.');const r=await f.images.run(f.a.scope,f.imageInput(approval));assert.equal(r.result.status,'unusable');assert.equal(r.result.reason,'DECISION_CONTEXT_LIMIT');assert.equal(r.handling,'cannot_assess');assert.equal(r.truncated,false);assert.equal(f.imageRequests.length,0);assert.equal(f.conversations.history(f.a.scope,f.imageCase.id).messages.at(-1).text,'Critical final correction: the item is different.');
}));
test('M17-IMAGES-AMBIGUITY-REVIEW-BRANDING-18',()=>usingImages(async f=>{
  const {approval}=await f.approve();f.imageRespond('ambiguous');const r=await f.images.run(f.a.scope,f.imageInput(approval));assert.equal(r.handling,'cannot_assess');assert.equal(r.result.answers.requested_detail_visible.choice,'cannot_assess');assert.equal(verifyImageReceipt(r),r);assert.throws(()=>verifyImageReceipt(structuredClone(r)),/IMAGE_RECEIPT_INTEGRITY/);assert.throws(()=>verifyDecisionReceipt(r),/DECISION_RECEIPT_INTEGRITY/);
  const business=f.business();assert.throws(()=>f.images.disagree(f.customer,{case_id:f.imageCase.id,observation_id:r.id,reason:'wrong_item'}),/ACCESS_DENIED/);assert.throws(()=>f.images.disagree(f.reviewer.scope,{case_id:f.imageCase.id,observation_id:r.id,reason:'fraud_confirmed'}),/INVALID_INPUT/);
  const d=f.images.disagree(f.reviewer.scope,{case_id:f.imageCase.id,observation_id:r.id,reason:'wrong_item'});assert.equal(d.observation_id,r.id);assert.equal(d.source.sha256,r.source.sha256);assert.deepEqual(f.business(),business);assert.equal(Object.isFrozen(r.result.answers),true);
}));
test('M17-IMAGES-QUALIFICATION-AND-MODALITIES-19',()=>usingImages(async f=>{
  const {approval}=await f.approve(),r=await f.images.run(f.a.scope,f.imageInput(approval)),protocol=imageFixture('evaluation-protocol.v1');
  const report=assessImageQualification(protocol,contentDigest(protocol),[r]);assert.equal(report.qualified,false);assert.equal(report.actual_image_inference_count,0);assert.equal(report.synthetic_wire_observation_count,1);assert.equal(report.measured_quality,null);assert.equal(report.formal_acceptance,'blocked');assert.equal(report.individual_image_backup_erasure,'pending');
  assert.throws(()=>assessImageQualification(protocol,'0'.repeat(64),[r]),/IMAGE_PROTOCOL_INTEGRITY/);const changed={...protocol,status:'qualified'};assert.throws(()=>assessImageQualification(changed,contentDigest(changed),[r]),/IMAGE_PROTOCOL_INTEGRITY/);assert.throws(()=>assessImageQualification(protocol,contentDigest(protocol),[{...r,provenance:{...r.provenance,live_inference_observed:true}}]),/IMAGE_RECEIPT_INTEGRITY/);
  for(const modality of ['audio','video'])assert.throws(()=>f.images.configure(f.owner.scope,f.configuration({expected_version:1,modality})),/IMAGE_MODALITY_UNAVAILABLE/);
  assert.throws(()=>f.images.configure(f.owner.scope,f.configuration({expected_version:1,qualified:true})),/INVALID_INPUT/);const state=f.images.status(f.a.scope,f.imageRef);assert.equal(state.modalities.image.qualified,false);assert.equal(state.modalities.audio.enabled,false);assert.equal(state.modalities.video.enabled,false);assert.equal(state.encoded_media_dlp_qualified,false);
}));
test('M17-IMAGES-TASK-PINS-AND-MALFORMED-OUTPUT-20',async()=>{
  await usingImages(async f=>{const {approval}=await f.approve(),p=f.images.prepare(f.a.scope,f.imageInput(approval));f.reads.profiles.put(f.a.scope,f.profile(f.a,{id:'images',revision:2,skill_id:f.imageBundle.id,skill_digest:f.imageBundle.digest,tone:'formal',locale:'en-US'}));
    await assert.rejects(()=>f.images.execute(f.a.scope,p),/TASK_CONTEXT_CHANGED|IMAGE_CONTEXT_CHANGED/);assert.equal(f.imageRequests.length,0);
  });
  await usingImages(async f=>{const {approval}=await f.approve(),reply=structuredClone(f.imageWire.clear);reply.result.answers.requested_detail_visible.choice='refund_approved';f.imageResponse(reply);const business=f.business(),r=await f.images.run(f.a.scope,f.imageInput(approval));assert.equal(r.result.status,'unusable');assert.equal(r.result.answers,null);assert.equal(r.handling,'cannot_assess');assert.deepEqual(f.business(),business);});
  for(const usage of [{input_tokens:24576,output_tokens:0},{input_tokens:1200,output_tokens:2}])await usingImages(async f=>{const {approval}=await f.approve(),reply=structuredClone(f.imageWire.clear);reply.result.usage=usage;f.imageResponse(reply);const r=await f.images.run(f.a.scope,f.imageInput(approval));assert.equal(r.result.status,'unusable');assert.equal(r.result.reason,'DECISION_OUTPUT_INVALID');assert.equal(r.result.usage,null);const budget=f.budgets.inspect(f.a.scope,'cloudflare','shadow_period');assert.equal(budget.unknown_usage_count,1);assert.equal(budget.charged_micro,'0');assert.ok(BigInt(budget.held_micro)>0n);});
});
