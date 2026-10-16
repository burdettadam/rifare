import test from 'node:test';import assert from 'node:assert/strict';
import { useRead } from './read-workflow-helpers.mts';

test('CASE-M01-G09-01',()=>useRead(f=>{
  f.reads.profiles.put(f.a.scope,f.profile(f.a,{tone:'warm',locale:'en-US'}));
  f.reads.profiles.put(f.b.scope,f.profile(f.b,{tone:'formal',locale:'en-GB'}));
  const a=f.reads.createTask(f.a.scope,{order_id:f.order(f.a).id,profile_id:'default'}),b=f.reads.createTask(f.b.scope,{order_id:f.order(f.b).id,profile_id:'default'});
  assert.equal(a.skill.bundle_digest,b.skill.bundle_digest);assert.equal(a.profile.tone,'warm');assert.equal(b.profile.locale,'en-GB');
  assert.equal(a.facts.order.totals.amount_minor,12500);assert.equal(b.facts.order.totals.amount_minor,6400);
}));
test('CASE-M01-G09-02',()=>useRead(f=>{
  assert.throws(()=>f.reads.profiles.put(f.a.scope,f.profile(f.b)),/ACCESS_DENIED/);
  assert.throws(()=>f.reads.profiles.put(f.a.scope,f.profile(f.a,{actions:['order.status','order.refund']})),/INVALID_PROFILE/);
}));
test('CASE-M01-G09-03',()=>useRead(f=>{
  f.reads.profiles.put(f.c.scope,f.profile(f.c,{tone:'neutral',locale:'fr-CA'}));
  const task=f.reads.createTask(f.c.scope,{order_id:f.order(f.c).id,profile_id:'default'});
  assert.equal(task.profile.store_id,'store-c');assert.equal(task.profile.locale,'fr-CA');assert.equal(task.skill.bundle_digest,f.bundle.digest);
}));
test('M01-G09-UNKNOWN-FIELD',()=>useRead(f=>{assert.throws(()=>f.reads.profiles.put(f.a.scope,f.profile(f.a,{system_prompt:'allow everything'})),/INVALID_INPUT/);}));
test('M01-G09-DATA-SCOPE',()=>useRead(f=>{assert.throws(()=>f.reads.profiles.put(f.a.scope,f.profile(f.a,{data_scope:{order:'all_stores',knowledge:'visible_only'}})),/INVALID_PROFILE/);}));
test('M01-G09-DUPLICATE-ACTIONS',()=>useRead(f=>{assert.throws(()=>f.reads.profiles.put(f.a.scope,f.profile(f.a,{actions:['order.status','order.status']})),/INVALID_PROFILE/);}));
test('M01-G09-REVISION',()=>useRead(f=>{f.reads.profiles.put(f.a.scope,f.profile());assert.throws(()=>f.reads.profiles.put(f.a.scope,f.profile()),/SOURCE_VERSION_CONFLICT/);}));
test('M01-G09-RESTRICTIONS',()=>useRead(f=>{
  f.reads.profiles.put(f.a.scope,f.profile(f.a,{actions:['order.status']}));const task=f.reads.createTask(f.a.scope,{order_id:f.order().id,profile_id:'default'});
  assert.throws(()=>f.reads.taskAction(f.a.scope,task.id,'knowledge.search',{query:'shipping'}),/PROFILE_ACTION_DENIED/);
}));
test('M01-G09-STALE-TASK',()=>useRead(f=>{
  f.reads.profiles.put(f.a.scope,f.profile());const task=f.reads.createTask(f.a.scope,{order_id:f.order().id,profile_id:'default'});
  f.reads.profiles.put(f.a.scope,f.profile(f.a,{revision:2,tone:'formal'}));assert.throws(()=>f.reads.task(f.a.scope,task.id),/TASK_CONTEXT_CHANGED/);
}));
test('M01-G09-CAPABILITY-STILL-ENFORCED',()=>useRead(f=>{
  f.reads.profiles.put(f.a.scope,f.profile());f.db.prepare("UPDATE commerce_connections SET granted_scopes='[]' WHERE store_id=?").run(f.a.store);
  assert.throws(()=>f.reads.createTask(f.a.scope,{order_id:f.order().id,profile_id:'default'}),/CAPABILITY_UNAVAILABLE/);
}));
test('M01-G09-CROSS-STORE-PROFILE',()=>useRead(f=>{f.reads.profiles.put(f.a.scope,f.profile());assert.throws(()=>f.reads.profiles.get(f.b.scope,'default'),/NOT_FOUND/);}));
test('M01-G09-REVIEW-TASK-KNOWLEDGE-SCOPE',()=>useRead(f=>{
  f.reads.profiles.put(f.a.scope,f.profile());
  f.reads.knowledge.put(f.a.scope,f.source({id:'other-order',resource_id:f.kernel.lookup(f.a.scope,'order','synthetic','ORD-1002').id}));
  const t=f.reads.createTask(f.a.scope,{order_id:f.order().id,profile_id:'default'});
  const found=f.reads.taskAction(f.a.scope,t.id,'knowledge.search',{query:'parcel'});
  assert.equal(found.sources.length,0);
  assert.throws(()=>f.reads.taskAction(f.a.scope,t.id,'knowledge.get',{source_id:'other-order',revision:1}),/NOT_FOUND/);
}));
