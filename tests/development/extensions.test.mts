import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync,readFileSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectExtensionArtifact,inspectPinnedExtensionArtifact } from '../../packages/commerce/extension-artifacts.mts';
import { classifyExtensionTransition,retirementImpact } from '../../packages/commerce/extension-compatibility.mts';
import { Extensions } from '../../packages/commerce/extension-lifecycle.mts';
import { SkillInstaller,decodeSkillPackage } from '../../packages/commerce/skill-installer.mts';
import { EXTENSION_TABLES,eraseExtensionSubject,exportExtensionSubject,revokeExtensionsForRestore } from '../../packages/commerce/extension-privacy.mts';
import { CommerceKernel } from '../../packages/commerce/kernel.mts';
import { ActionGateway } from '../../packages/commerce/action-gateway.mts';
import { DurableWork } from '../../packages/commerce/durable-work.mts';
import { createRecoverySnapshot,restoreRecoverySnapshot,suppressionCheckpoint } from '../../packages/commerce/safe-recovery.mts';
import { contentDigest,canonical } from '../../packages/commerce/configuration-values.mts';
import { extensionArtifact,extensionOracle as oracle,extensionRoot,artifactBytes,usingExtensions,populateExtensionPrivacy } from './extensions-helpers.mts';

async function mutant(file:string,marker:string,replacement:string,run:(module:any)=>unknown){const directory=mkdtempSync(join(tmpdir(),'rifare-extension-mutant-'));try{const url=new URL('../../packages/commerce/'+file,import.meta.url),original=readFileSync(url,'utf8');assert.equal(original.split(marker).length,2,'Exactly one actual behavior site');const source=original.replace(marker,replacement).replace(/from '([.][^']+)'/g,(_all,path)=>"from '"+new URL(path,url).href+"'");const target=join(directory,'mutant.mts');writeFileSync(target,source);await run(await import(pathToFileURL(target).href));}finally{rmSync(directory,{recursive:true,force:true});}}

test('CASE-M12-G04-01',()=>usingExtensions(f=>{const x=f.install(),current=f.extensions.installed(f.a.scope,'order-status');assert.equal(current.version,oracle.instruction.version);assert.equal(f.reads.skills.describe(f.a.scope,'order-status').authority,'guidance_only');assert.equal(x.review.conformance_scope,'instruction_contract_only');assert.deepEqual(x.a.requested_actions,oracle.instruction.actions);assert.equal(x.a.execution_authorized,false);assert.equal(f.extensions.exportArtifact(f.a.scope,x.a.id).artifact.origin.sha256,contentDigest(x.artifact.payload));assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_operations').get().n,0);}));
test('CASE-M12-G04-02',()=>usingExtensions(f=>{for(const edit of [(a:any)=>a.ownership.license='NOASSERTION',(a:any)=>a.origin.uri='http://unknown.invalid',(a:any)=>a.origin.sha256='0'.repeat(64),(a:any)=>a.contract.sdk_version='unreviewed-v2',(a:any)=>a.payload.files['scripts/install.js']='arbitrary code']){const a=extensionArtifact();edit(a);const encoded=artifactBytes(a);assert.throws(()=>f.extensions.stage(f.a.scope,{bytes:encoded.bytes,sha256:encoded.sha256}));}assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_extension_artifacts').get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_skill_approvals').get().n,0);}));
test('CASE-M12-G04-03',async()=>{await usingExtensions(f=>{const x=f.install(),old=f.reads.skills.snapshot(f.a.scope,'order-status',x.a.bundle_digest),replacement=artifactBytes(extensionArtifact('1.1.0')),original=artifactBytes(x.artifact);assert.throws(()=>inspectPinnedExtensionArtifact(replacement.bytes,original.sha256,{root:extensionRoot}),/EXTENSION_DIGEST_CHANGED/);assert.equal(f.reads.skills.snapshot(f.a.scope,'order-status',old.digest).digest,old.digest);assert.equal(f.extensions.installed(f.a.scope,'order-status').id,x.a.id);});await mutant('extension-artifacts.mts',"if(actual!==expectedSha256)throw new Error('EXTENSION_DIGEST_CHANGED');","if(false)throw new Error('EXTENSION_DIGEST_CHANGED');",module=>{const before=artifactBytes(extensionArtifact()),after=artifactBytes(extensionArtifact('1.1.0'));assert.throws(()=>assert.throws(()=>module.inspectPinnedExtensionArtifact(after.bytes,before.sha256,{root:extensionRoot}),/EXTENSION_DIGEST_CHANGED/),{name:'AssertionError'});});});
test('CASE-M12-G05-01',()=>usingExtensions(f=>{const first=f.install();f.create('extension_pending');const before=f.cases.resume(f.a.scope,'extension_pending'),preview=f.gateway.prepare(f.a.scope,f.proposal('extension_pending')),approval=f.approve(preview),next=f.next();assert.equal(next.transition.classification,'compatible');const activated=f.extensions.activate(f.a.scope,{transition_id:next.transition.id,expected_profile_revision:2});assert.equal(activated.profile.revision,3);assert.equal(activated.profile.tone,oracle.compatible.tone);assert.deepEqual(f.cases.resume(f.a.scope,'extension_pending').pins,before.pins);assert.equal(f.cases.resume(f.a.scope,'extension_pending').pins.skill.digest,first.a.bundle_digest);const receipt=f.execute(preview,approval);assert.equal(receipt.approval_consumed,true);assert.equal(f.gateway.state(f.a.scope,'extension_pending').resolution,'refund');assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_case_effects').get().n,1);}));
test('CASE-M12-G05-02',async()=>{await usingExtensions(f=>{f.install();f.create('breaking_pending');const preview=f.gateway.prepare(f.a.scope,f.proposal('breaking_pending')),approval=f.approve(preview),p=f.reads.profiles.get(f.a.scope,'default'),raw=extensionArtifact('2.0.0',{breaking:true}),staged=f.stage(raw);assert.equal(classifyExtensionTransition(extensionArtifact(),raw).classification,'breaking');assert.throws(()=>f.extensions.planTransition(f.a.scope,{id:'missing_migration',from_artifact_id:f.extensions.installed(f.a.scope,'order-status').id,to_artifact_id:staged.a.id,review_id:staged.review.id,profile_id:'default',expected_profile_revision:p.profile.revision,changes:{},strategy:null}),/EXTENSION_MIGRATION_REQUIRED/);assert.throws(()=>f.extensions.planTransition(f.a.scope,{id:'amount_override',from_artifact_id:f.extensions.installed(f.a.scope,'order-status').id,to_artifact_id:staged.a.id,review_id:staged.review.id,profile_id:'default',expected_profile_revision:p.profile.revision,changes:{amount_minor:'1'},strategy:'retain_pins_and_repreview'}));const transition=f.extensions.planTransition(f.a.scope,{id:'explicit_migration',from_artifact_id:f.extensions.installed(f.a.scope,'order-status').id,to_artifact_id:staged.a.id,review_id:staged.review.id,profile_id:'default',expected_profile_revision:2,changes:{},strategy:'retain_pins_and_repreview'});f.extensions.reviewTransition(f.reviewer.scope,{transition_id:transition.id,expected_digest:transition.digest,expires_at:f.now()+600000});f.extensions.activate(f.a.scope,{transition_id:transition.id,expected_profile_revision:2});assert.equal(f.cases.resume(f.a.scope,'breaking_pending').revision,1);const migrated=f.cases.migrate(f.a.scope,'breaking_pending',{expected_revision:1,profile_id:'default',policy_id:'returns',reason:'approved_update'});assert.equal(migrated.requires_new_preview,true);assert.throws(()=>f.execute(preview,approval),/PREVIEW_STALE/);assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_case_effects').get().n,0);});await mutant('extension-lifecycle.mts',"if(compatibility.classification==='breaking'&&p.strategy!=='retain_pins_and_repreview')throw new Error('EXTENSION_MIGRATION_REQUIRED');","if(false)throw new Error('EXTENSION_MIGRATION_REQUIRED');",module=>usingExtensions(f=>{f.install();f.create('fault_pending');const pin=f.cases.resume(f.a.scope,'fault_pending'),preview=f.gateway.prepare(f.a.scope,f.proposal('fault_pending')),staged=f.stage(extensionArtifact('2.0.0',{breaking:true})),broken=new module.Extensions(f.kernel,{root:extensionRoot});assert.throws(()=>assert.throws(()=>broken.planTransition(f.a.scope,{id:'unguarded_breaking',from_artifact_id:f.extensions.installed(f.a.scope,'order-status').id,to_artifact_id:staged.a.id,review_id:staged.review.id,profile_id:'default',expected_profile_revision:2,changes:{tone:'formal'},strategy:null}),/EXTENSION_MIGRATION_REQUIRED/),{name:'AssertionError'});assert.equal(f.cases.resume(f.a.scope,'fault_pending').configuration_digest,pin.configuration_digest);assert.equal(f.db.prepare('SELECT digest FROM commerce_action_previews WHERE id=?').get(preview.id).digest,preview.digest);}));});
test('CASE-M12-G05-03',()=>usingExtensions(f=>{
 const first=f.install();f.create('rollback_pending');f.create('rollback_migrated');const original=f.cases.resume(f.a.scope,'rollback_pending');
 const p=f.gateway.prepare(f.a.scope,f.proposal('rollback_pending')),a=f.approve(p),next=f.next();f.extensions.activate(f.a.scope,{transition_id:next.transition.id,expected_profile_revision:2});
 f.cases.migrate(f.a.scope,'rollback_migrated',{expected_revision:1,profile_id:'default',policy_id:'returns',reason:'approved_update'});
 const migrated=f.cases.resume(f.a.scope,'rollback_migrated');assert.equal(migrated.revision,2);assert.equal(migrated.pins.skill.digest,next.a.bundle_digest);
 const undone=f.extensions.rollback(f.a.scope,{transition_id:next.transition.id,expected_profile_revision:3});assert.equal(undone.profile.revision,oracle.rollback.rollback_profile_revision);assert.equal(undone.profile.skill_digest,first.a.bundle_digest);assert.equal(undone.profile.tone,'neutral');
 assert.deepEqual(f.cases.resume(f.a.scope,'rollback_pending'),original,'Original pending case retains its old archived configuration');
 assert.deepEqual(f.cases.resume(f.a.scope,'rollback_migrated'),migrated,'Partially migrated case retains its new archived configuration after rollback');
 const receipt=f.execute(p,a);assert.throws(()=>f.execute(p,a),/APPROVAL_UNAVAILABLE/);assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_operations').get().n,oracle.rollback.effect_count);assert.equal(f.gateway.receipt(f.a.scope,receipt.id).approval_consumed,true);assert.equal(f.extensions.transition(f.a.scope,next.transition.id).state,'rolled_back');
}));
test('M12-G06-PREP-01',()=>usingExtensions(f=>{const data=populateExtensionPrivacy(f),review=f.extensions.retirement(f.a.scope,data.retirement.id);assert.equal(review.state,'reviewed');assert.equal(review.body.author,f.a.scope.actor_id??'operator');assert.equal(review.body.reviewer,'reviewer');assert.deepEqual(review.body.impact.retained_tests,oracle.retained_cases);assert.equal(review.body.human_adoption,false);assert.equal(review.body.external_contribution_qualified,false);assert.equal(f.extensions.exportArtifact(f.a.scope,data.first.a.id).digest,data.retirement.body.export_digest);}));
test('M12-G06-PREP-02',()=>usingExtensions(f=>{const first=f.install(),base={id:'retire_blocked',artifact_id:first.a.id,replacement_artifact_id:null,notice:{uri:'https://extensions.example.invalid/notices/one',revision:'1',sha256:'a'.repeat(64)},effective_at:f.now()+86400000,export_digest:f.extensions.exportArtifact(f.a.scope,first.a.id).digest,reader_retained:true,retained_test_ids:[...oracle.retained_cases],strategy:'retain_pins_and_repreview'};for(const change of [{notice:null},{reader_retained:false},{retained_test_ids:[]},{export_digest:'0'.repeat(64)},{strategy:null}])assert.throws(()=>f.extensions.proposeRetirement(f.a.scope,{...base,...change}));assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_extension_retirements').get().n,0);assert.equal(f.reads.skills.snapshot(f.a.scope,'order-status',first.a.bundle_digest).digest,first.a.bundle_digest);}));
test('M12-G06-PREP-03',async()=>{const required=[...oracle.retained_cases];assert.deepEqual(retirementImpact(required,required,['FEATURE-M12-G04'],['tenant-a/store-a']).retained_tests,required);assert.throws(()=>retirementImpact(required,required.slice(1),['FEATURE-M12-G04'],['tenant-a/store-a']),/EXTENSION_TEST_RETIREMENT_BLOCKED/);await mutant('extension-compatibility.mts',"if(missing.length)throw new Error('EXTENSION_TEST_RETIREMENT_BLOCKED');","if(false)throw new Error('EXTENSION_TEST_RETIREMENT_BLOCKED');",module=>{assert.throws(()=>assert.throws(()=>module.retirementImpact(required,[],['FEATURE-M12-G04'],['tenant-a/store-a']),/EXTENSION_TEST_RETIREMENT_BLOCKED/),{name:'AssertionError'});});});
test('M12-EXT-PORT-023',()=>usingExtensions(f=>{const data=populateExtensionPrivacy(f),p=f.preview(),a=f.approve(p);f.execute(p,a);f.db.prepare("UPDATE commerce_operations SET state='sending'").run();const operation=f.db.prepare('SELECT id,command,payload_hash FROM commerce_operations').get(),snapshot=createRecoverySnapshot(f.kernel,join(f.directory,'extension_backup')),suppression=suppressionCheckpoint(f.kernel),restored=restoreRecoverySnapshot({snapshot:snapshot.directory,destination:join(f.directory,'extension_restored'),manifest_sha256:snapshot.manifest_sha256,suppression,suppression_sha256:contentDigest(suppression)},f.now),db=new DatabaseSync(restored.database);try{const k=new CommerceKernel(db,f.now),owner=k.authenticate(k.issueSession(f.a.tenant,f.a.store,'owner'));assert.equal(db.prepare('SELECT mode FROM commerce_recovery_state').get().mode,'quarantine');assert.throws(()=>new ActionGateway(k).prepare(owner,f.proposal()),/RESTORE_WRITE_BLOCKED/);assert.throws(()=>new Extensions(k).activate(owner,{transition_id:data.next.transition.id,expected_profile_revision:3}),/RESTORE_WRITE_BLOCKED/);assert.deepEqual(db.prepare('SELECT id,command,payload_hash FROM commerce_operations').get(),operation);assert.equal(db.prepare('SELECT state FROM commerce_operations').get().state,'unknown');assert.throws(()=>new DurableWork(k).claim(owner,operation.id),/RESTORE_WRITE_BLOCKED|RESTORED_OPERATION_REPLAY_BLOCKED/);for(const table of data.authority_tables)assert.equal(db.prepare('SELECT count(*) n FROM '+table+" WHERE state<>'revoked'").get().n,0);}finally{db.close();}}));
test('M12-EXT-AUTHORITY',()=>usingExtensions(f=>{const first=f.install(),other=f.install('1.0.0',f.b.scope,f.otherOwner);assert.throws(()=>f.extensions.reviewArtifact(f.a.scope,{artifact_id:first.a.id,expires_at:f.now()+60000}),/ACCESS_DENIED/);const next=f.next();f.permissions.change(f.owner.scope,{actor_id:'reviewer',role:'reviewer',actions:['skill.read'],resource_ids:null,expected_revision:0});assert.throws(()=>f.extensions.activate(f.a.scope,{transition_id:next.transition.id,expected_profile_revision:2}),/EXTENSION_REVIEW_AUTHORITY_CHANGED/);assert.equal(f.extensions.installed(f.a.scope,'order-status').id,first.a.id);f.extensions.revoke(f.owner.scope,{artifact_id:first.a.id});assert.throws(()=>f.reads.skills.snapshot(f.a.scope,'order-status',first.a.bundle_digest),/SKILL_REVOKED|SKILL_APPROVAL_REQUIRED/);assert.equal(f.reads.skills.snapshot(f.b.scope,'order-status',other.a.bundle_digest).digest,other.a.bundle_digest);assert.throws(()=>f.extensions.get(f.c.scope,first.a.id),/NOT_FOUND/);}));
test('M12-EXT-PRIVACY',async()=>{
 await usingExtensions(f=>{
  const data=populateExtensionPrivacy(f),snapshot=()=>Object.fromEntries(EXTENSION_TABLES.map(table=>[table,f.db.prepare('SELECT * FROM '+table+' ORDER BY id').all()])),before=snapshot();
  const unrelated=data.unrelated_approval_ids.map((id:string)=>f.db.prepare('SELECT * FROM commerce_skill_approvals WHERE id=?').get(id));
  assert.ok(Object.values(exportExtensionSubject(f.kernel,f.a.tenant,f.a.store,[],'unrelated','a'.repeat(64))).every((v:any)=>v.length===0));
  eraseExtensionSubject(f.kernel,f.a.tenant,f.a.store,[],'a'.repeat(64));
  assert.deepEqual(snapshot(),before,'Valid unrelated merchant records remain byte-identical');
  for(const table of EXTENSION_TABLES)for(const row of f.db.prepare('SELECT * FROM '+table+' WHERE tenant_id=? AND store_id=?').all(f.a.tenant,f.a.store)){
   const b=JSON.parse(row.body);b.unbound_copy={customer_id:'SYNTHETIC_PRIVATE',email:'private@example.invalid'};
   if(table==='commerce_extension_artifacts'){b.artifact.ownership.owner_id={nested:'SYNTHETIC_PRIVATE'};b.artifact.ownership.notice_sha256='private@example.invalid';b.requested_actions=['private@example.invalid'];}
   else {b.author={nested:'SYNTHETIC_PRIVATE'};if(table==='commerce_extension_reviews'){b.expires_at='private@example.invalid';b.skill_approval_id='private@example.invalid';}if(table==='commerce_extension_transitions')b.before_profile.tone='private@example.invalid';if(table==='commerce_extension_retirements'){b.notice.sha256='private@example.invalid';b.effective_at='private@example.invalid';b.impact.retained_tests.push('private@example.invalid');}}
   f.db.prepare('UPDATE '+table+' SET body=?,digest=? WHERE tenant_id=? AND store_id=? AND id=?').run(canonical(b),contentDigest(b),row.tenant_id,row.store_id,row.id);
  }
  eraseExtensionSubject(f.kernel,f.a.tenant,f.a.store,[],'a'.repeat(64));const cleaned=snapshot();
  eraseExtensionSubject(f.kernel,f.a.tenant,f.a.store,[],'a'.repeat(64));assert.deepEqual(snapshot(),cleaned,'Hash-only repeat minimization is stable');
  for(const table of EXTENSION_TABLES){assert.equal(cleaned[table].length,before[table].length);assert.doesNotMatch(JSON.stringify(cleaned[table]),/SYNTHETIC_PRIVATE|private@example/);}
  for(const id of data.approval_ids)assert.equal(f.db.prepare('SELECT revoked FROM commerce_skill_approvals WHERE id=?').get(id).revoked,1,'Malformed review pointer cannot spare its exact canonical approval');
  assert.deepEqual(data.unrelated_approval_ids.map((id:string)=>f.db.prepare('SELECT * FROM commerce_skill_approvals WHERE id=?').get(id)),unrelated);
  revokeExtensionsForRestore(f.kernel,f.a.tenant,f.a.store);
  for(const table of data.authority_tables)assert.equal(f.db.prepare('SELECT count(*) n FROM '+table+" WHERE state<>'revoked'").get().n,0);
  assert.deepEqual(data.unrelated_approval_ids.map((id:string)=>f.db.prepare('SELECT * FROM commerce_skill_approvals WHERE id=?').get(id)),unrelated);
  assert.throws(()=>revokeExtensionsForRestore(f.kernel,f.a.tenant),/EXTENSION_SCOPE_REQUIRED/);
 });
 await usingExtensions(f=>{
  const data=populateExtensionPrivacy(f),archive=f.db.prepare('SELECT * FROM commerce_skill_archive ORDER BY skill_id,bundle_digest').all(),artifacts=f.db.prepare('SELECT * FROM commerce_extension_artifacts ORDER BY id').all();
  for(const [index,row] of artifacts.entries()){
   const b=JSON.parse(row.body),path=index===0?'SKILL.md':'references/guide.md';b.artifact.payload.files[path]+='\nSYNTHETIC_PRIVATE private@example.invalid';
   f.db.prepare('UPDATE commerce_extension_artifacts SET body=?,digest=? WHERE tenant_id=? AND store_id=? AND id=?').run(canonical(b),contentDigest(b),row.tenant_id,row.store_id,row.id);
  }
  eraseExtensionSubject(f.kernel,f.a.tenant,f.a.store,[],'a'.repeat(64));eraseExtensionSubject(f.kernel,f.a.tenant,f.a.store,[],'a'.repeat(64));
  for(const row of f.db.prepare('SELECT * FROM commerce_extension_artifacts').all()){assert.equal(JSON.parse(row.body).artifact.redacted,true,'Changed skill or resource bytes require an inert artifact reference');assert.equal(row.state,'revoked_privacy');assert.doesNotMatch(row.body,/SYNTHETIC_PRIVATE|private@example/);}
  for(const id of data.approval_ids)assert.equal(f.db.prepare('SELECT revoked FROM commerce_skill_approvals WHERE id=?').get(id).revoked,1);
  assert.deepEqual(f.db.prepare('SELECT * FROM commerce_skill_archive ORDER BY skill_id,bundle_digest').all(),archive,'Original archived bytes and pins remain intact');
 });
 await usingExtensions(f=>{
  const data=populateExtensionPrivacy(f),other=extensionArtifact();other.payload.files['SKILL.md']+='\nSeparately retained instruction bytes.\n';
  const decoded=decodeSkillPackage(Buffer.from(canonical(other.payload)),'json'),installer=new SkillInstaller(f.kernel),unrelated=installer.approve(f.owner.scope,{origin:decoded.origin,bundle_digest:decoded.bundle.digest,skill_id:decoded.bundle.id,version:decoded.bundle.version,expires_at:f.now()+600000});
  const unrelatedBefore=f.db.prepare('SELECT * FROM commerce_skill_approvals WHERE id=?').get(unrelated.id),archive=f.db.prepare('SELECT * FROM commerce_skill_archive ORDER BY skill_id,bundle_digest').all(),installations=f.db.prepare('SELECT * FROM commerce_skill_installations ORDER BY skill_id').all();
  assert.equal(unrelatedBefore.skill_id,data.first.a.extension_id);assert.equal(unrelatedBefore.version,data.first.a.version);assert.notEqual(unrelatedBefore.bundle_digest,data.first.a.bundle_digest);
  for(const table of ['commerce_extension_artifacts','commerce_extension_reviews'])for(const row of f.db.prepare('SELECT * FROM '+table+' WHERE tenant_id=? AND store_id=?').all(f.a.tenant,f.a.store)){
   const b=JSON.parse(row.body);if(table==='commerce_extension_artifacts')assert.equal(contentDigest(b.artifact),row.id,'Original pinned artifact remains intact');b.bundle_digest='private@example.invalid';
   f.db.prepare('UPDATE '+table+' SET body=?,digest=? WHERE tenant_id=? AND store_id=? AND id=?').run(canonical(b),contentDigest(b),row.tenant_id,row.store_id,row.id);
  }
  eraseExtensionSubject(f.kernel,f.a.tenant,f.a.store,[],'a'.repeat(64));eraseExtensionSubject(f.kernel,f.a.tenant,f.a.store,[],'a'.repeat(64));
  for(const id of data.approval_ids)assert.equal(f.db.prepare('SELECT revoked FROM commerce_skill_approvals WHERE id=?').get(id).revoked,1,'Intact artifact binds canonical approvals when both copied bundle digests are poisoned');
  for(const table of EXTENSION_TABLES)assert.doesNotMatch(JSON.stringify(f.db.prepare('SELECT * FROM '+table).all()),/private@example/);
  assert.deepEqual(f.db.prepare('SELECT * FROM commerce_skill_approvals WHERE id=?').get(unrelated.id),unrelatedBefore,'Same-skill different-bundle approval remains byte-identical');
  assert.deepEqual(f.db.prepare('SELECT * FROM commerce_skill_archive ORDER BY skill_id,bundle_digest').all(),archive);assert.deepEqual(f.db.prepare('SELECT * FROM commerce_skill_installations ORDER BY skill_id').all(),installations);
 });
});
test('M12-EXT-HOST-ADAPTER',()=>usingExtensions(f=>{const artifact=extensionArtifact('1.0.0',{kind:'host_adapter'}),inspected=inspectExtensionArtifact(artifact,{root:extensionRoot});assert.equal(inspected.conformance_scope,'retained_host_source_and_test_pins');assert.equal(inspected.bundle,null);assert.equal(inspected.execution_authorized,false);const staged=f.stage(artifact);assert.throws(()=>f.extensions.install(f.a.scope,{artifact_id:staged.a.id,review_id:staged.review.id,profile_id:'default',expected_profile_revision:1}),/EXTENSION_HOST_ADAPTER_INERT/);const changed=extensionArtifact('1.0.0',{kind:'host_adapter'});changed.payload.source_pins[0].sha256='f'.repeat(64);changed.origin.sha256=contentDigest(changed.payload);assert.throws(()=>inspectExtensionArtifact(changed,{root:extensionRoot}));assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_connections').get().n,3);}));

// Root owns one reserved integrated local case after author handoff; no placeholder test.

import { usingAgency } from './agency-operations-helpers.mts';

test('M12-PREP-INTEGRATION-01',t=>usingAgency(f=>{
  const extensions=new Extensions(f.kernel,{root:extensionRoot});
  function installFirst(scope:any,owner:any) {
    const encoded=artifactBytes(extensionArtifact()),artifact=extensions.stage(scope,{bytes:encoded.bytes,sha256:encoded.sha256});
    assert.deepEqual(artifact.requested_actions,['order.status']);assert.equal(artifact.execution_authorized,false);
    const review=extensions.reviewArtifact(owner,{artifact_id:artifact.id,expires_at:f.now()+600000});
    const current=f.reads.profiles.get(scope,'default').profile;
    extensions.install(scope,{artifact_id:artifact.id,review_id:review.id,profile_id:'default',expected_profile_revision:current.revision});
    return {artifact,review};
  }
  function publish(scope:any,owner:any,reviewer:any,artifact:any,percent:number) {
    const release=f.releases.stage(scope,{skill_id:'order-status',bundle_digest:artifact.bundle_digest,rollout_percent:percent});
    const evaluated=f.releases.evaluate(scope,release.id);
    assert.equal(evaluated.model_quality_qualified,false);
    f.releases.review(reviewer,{release_id:release.id,test_digest:evaluated.test_digest,rollout_percent:percent});
    const active=f.releases.active(scope,'order-status');
    f.releases.publish(owner,{release_id:release.id,expected_revision:active?.revision??0,rollout_percent:percent});
    return release;
  }
  const a=installFirst(f.agencyA.scope,f.owner.scope),b=installFirst(f.agencyB.scope,f.ownerB.scope);
  const baseline=publish(f.agencyA.scope,f.owner.scope,f.reviewer.scope,a.artifact,100);
  f.create('ecosystem_pending');
  const pinned=f.cases.resume(f.a.scope,'ecosystem_pending'),preview=f.gateway.prepare(f.a.scope,f.proposal('ecosystem_pending')),approval=f.approve(preview);
  const encoded=artifactBytes(extensionArtifact('1.1.0')),next=extensions.stage(f.agencyA.scope,{bytes:encoded.bytes,sha256:encoded.sha256});
  const review=extensions.reviewArtifact(f.owner.scope,{artifact_id:next.id,expires_at:f.now()+600000});
  const transition=extensions.planTransition(f.agencyA.scope,{id:'ecosystem_upgrade',from_artifact_id:a.artifact.id,to_artifact_id:next.id,
    review_id:review.id,profile_id:'default',expected_profile_revision:2,changes:{},strategy:null});
  extensions.reviewTransition(f.reviewer.scope,{transition_id:transition.id,expected_digest:transition.digest,expires_at:f.now()+600000});
  extensions.activate(f.agencyA.scope,{transition_id:transition.id,expected_profile_revision:2});
  const canary=publish(f.agencyA.scope,f.owner.scope,f.reviewer.scope,next,25),selections=new Map<string,any>();
  for(let i=0;i<100&&selections.size<2;i++) {
    const selected=f.releases.select(f.agencyA.scope,'order-status','ecosystem_canary_'+i,next.bundle_digest);
    const expected=selected.activation.mode==='primary'?next.bundle_digest:a.artifact.bundle_digest;
    assert.equal(selected.bundle.digest,expected);selections.set(selected.activation.mode,selected);
  }
  assert.deepEqual([...selections.keys()].sort(),['canary_fallback','primary']);
  assert.equal(f.releases.active(f.agencyB.scope,'order-status'),undefined);
  const beforeB=f.reads.profiles.get(f.agencyB.scope,'default');
  const publication=f.publish(),offerA=f.offer(f.agencyA.scope,publication,'ecosystem_a_choice'),offerB=f.offer(f.agencyB.scope,publication,'ecosystem_b_choice');
  f.accept(f.owner,offerA);f.templates.reject(f.ownerB.scope,{offer_id:offerB.offer_id,expected_digest:offerB.digest});
  assert.equal(f.reads.profiles.get(f.agencyA.scope,'default').profile.tone,'warm');
  assert.equal(f.reads.profiles.get(f.agencyB.scope,'default').sha256,beforeB.sha256);
  f.templates.rollback(f.owner.scope,{offer_id:offerA.offer_id,expected_digest:offerA.digest,expected_profile_revision:4});
  assert.equal(f.reads.profiles.get(f.agencyA.scope,'default').profile.revision,5);
  assert.equal(f.reads.profiles.get(f.agencyA.scope,'default').profile.tone,'neutral');
  assert.deepEqual(f.cases.resume(f.a.scope,'ecosystem_pending').pins,pinned.pins);
  extensions.revoke(f.owner.scope,{artifact_id:next.id});
  assert.throws(()=>f.reads.skills.snapshot(f.a.scope,'order-status',next.bundle_digest),/SKILL_REVOKED|SKILL_APPROVAL_REQUIRED/);
  assert.equal(f.reads.skills.snapshot(f.agencyB.scope,'order-status',b.artifact.bundle_digest).digest,b.artifact.bundle_digest);
  const receipt=f.execute(preview,approval,f.agencyA.scope);
  assert.equal(receipt.configuration_digest,pinned.configuration_digest);
  assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_case_effects').get().n,1);
  f.access.revoke(f.owner.scope,{agency_id:f.agency_id,actor_id:f.actor_id,expected_revision:1});
  assert.throws(()=>f.kernel.require(f.agencyA.scope),/ACCESS_DENIED/);
  f.kernel.authorize(f.agencyB.scope,'profile.read');
  assert.equal(f.reads.profiles.get(f.agencyB.scope,'default').sha256,beforeB.sha256);
  t.diagnostic('M12_LOCAL_ECOSYSTEM_DEMO '+JSON.stringify({synthetic:true,community_contribution_qualified:false,stores:2,
    requested_actions:['order.status'],baseline_release:baseline.id,canary_release:canary.id,canary_percent:25,
    selected_modes:[...selections.keys()].sort(),template_digest:publication.publication.digest,template_a:'accepted_then_rolled_back',
    template_b:'rejected',original_configuration_digest:pinned.configuration_digest,original_effect_count:1,
    revoked_extension_digest:next.bundle_digest,agency_a_revoked:true,store_b_unchanged:true,formal_M12_accepted:false}));
}));
