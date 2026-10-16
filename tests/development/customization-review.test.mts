import test from 'node:test';import assert from 'node:assert/strict';
import { useCustomization,manifestFiles } from './customization-helpers.mts';
import { SkillInstaller } from '../../packages/commerce/skill-installer.mts';
import { checkedBundle } from '../../packages/commerce/skills.mts';

test('M02-G03-SCHEDULE-CANNOT-REACTIVATE-OLDER-RULES',()=>useCustomization(f=>{
  f.publish();const second=f.policies.create(f.a.scope,f.input({expected_version:1}));f.policies.test(f.a.scope,'returns',2,second.digest);f.policies.review(f.reviewer.scope,'returns',2,second.digest);
  f.policies.publish(f.owner.scope,{policy_id:'returns',version:2,digest:second.digest,expected_published_version:1,effective_at:f.now()+1000});
  const third=f.policies.create(f.a.scope,f.input({expected_version:2}));f.policies.test(f.a.scope,'returns',3,third.digest);f.policies.review(f.reviewer.scope,'returns',3,third.digest);
  assert.throws(()=>f.policies.publish(f.owner.scope,{policy_id:'returns',version:3,digest:third.digest,expected_published_version:2,effective_at:f.now()+1}),/ACTIVATION_ORDER/);
}));
test('M02-G07-NO-LEGACY-DOWNGRADE-AFTER-TRUSTED-INSTALL',()=>useCustomization(f=>{
  const b=manifestFiles().bundle,i=new SkillInstaller(f.kernel),origin='https://publisher.example.invalid/skills';const a=i.approve(f.owner.scope,{origin,bundle_digest:b.digest,skill_id:b.id,version:b.version,expires_at:f.now()+60000});i.install(f.a.scope,a.id,{origin,bundle:b});
  const files={'SKILL.md':b.files['SKILL.md'],'commerce-manifest.json':JSON.stringify({schema_version:1,id:b.id,version:'1.0.0',resources:[]})};
  assert.throws(()=>f.reads.skills.install(f.a.scope,checkedBundle(files)),/SKILL_DOWNGRADE_DENIED/);
}));
test('M02-G07-CURRENT-APPROVER-AUTHORITY',()=>useCustomization(f=>{
  const b=manifestFiles().bundle,i=new SkillInstaller(f.kernel),origin='https://publisher.example.invalid/skills';const a=i.approve(f.owner.scope,{origin,bundle_digest:b.digest,skill_id:b.id,version:b.version,expires_at:f.now()+60000});
  f.kernel.provisionMember(f.a.tenant,f.a.store,'second-owner','owner');f.permissions.change(f.owner.scope,{actor_id:'owner',role:'operator',actions:null,resource_ids:null,expected_revision:0});
  assert.throws(()=>i.install(f.a.scope,a.id,{origin,bundle:b}),/SKILL_APPROVAL_REQUIRED/);
}));
test('M02-G06-WORKER-CANNOT-READ-UNPUBLISHED-DRAFT',()=>useCustomization(f=>{
  f.editor.start(f.a.scope,'returns');assert.throws(()=>f.editor.get(f.a.worker,'returns'),/ACCESS_DENIED/);
}));
