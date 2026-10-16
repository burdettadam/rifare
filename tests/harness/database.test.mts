import { declarations } from './cases.mts';
const { test, register } = declarations();
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { databaseFixture, EPOCH, EXPECTED, merchantIds } from './fixtures.mts';

function snapshot(f:any) { const s=f.store.state();return JSON.parse(JSON.stringify({markers:s.markers,jobs:s.jobs,database_engine:s.database_engine,commerce_qualified:s.commerce_qualified})); }
test('CASE-M00-G06-01/database clean SQLite seeds reproduce asserted facts twice', t => {
  t.mock.timers.enable({apis:['Date'],now:EPOCH});let before;
  for(let i=0;i<2;i++) {const f=databaseFixture('merchant-alpha');try{
    const s=snapshot(f);assert.equal(s.markers.length,EXPECTED.initial_markers_per_merchant);assert.equal(s.jobs.length,EXPECTED.initial_jobs_per_merchant);
    assert.deepEqual(s.markers,[{id:'shared-order',value:'ALPHA'}]);assert.equal(s.jobs[0].state,'pending');assert.equal(s.database_engine,'sqlite');assert.equal(s.commerce_qualified,false);
    if(before)assert.deepEqual(s,before);before=s;
    assert.equal(f.store.db.prepare('SELECT created_at FROM dev_markers').get()?.created_at,EPOCH);
  }finally{f.cleanup();assert.equal(existsSync(f.config.root),false);}}
});
test('DB-01 same fixture IDs use independent merchant stores and attachments', t=>{
  t.mock.timers.enable({apis:['Date'],now:EPOCH});const a=databaseFixture('merchant-alpha'),b=databaseFixture('merchant-beta');
  try{assert.notEqual(a.config.database,b.config.database);assert.notEqual(a.config.instanceId,b.config.instanceId);
    const job=a.store.claim(EPOCH)!;a.store.finish(job,EPOCH);
    assert.equal(JSON.parse(a.store.readAttachment('shared-job')).value,'ALPHA');assert.equal(b.store.state().jobs[0].state,'pending');
    assert.throws(()=>b.store.readAttachment('shared-job'),/ATTACHMENT_NOT_READY/);
  }finally{a.cleanup();b.cleanup();}
});
test('CASE-M00-G06-03/database reversing merchant order cannot change fixture facts',t=>{
  t.mock.timers.enable({apis:['Date'],now:EPOCH});const runs=[];
  for(const ids of [merchantIds(),merchantIds().reverse()]) {const out:any={};for(const id of ids){const f=databaseFixture(id);try{out[id]=snapshot(f);}finally{f.cleanup();}}runs.push(out);}
  assert.deepEqual(runs[0],runs[1]);
});
test('DB-02 cleanup removes only the owned fixture and preserves another live store',()=>{
  const a=databaseFixture('merchant-alpha'),b=databaseFixture('merchant-beta');try{a.cleanup();assert.equal(existsSync(a.config.root),false);assert.equal(b.store.state().markers[0].value,'BETA');}finally{a.cleanup();b.cleanup();}
});
test('DB-03 lease expiration and stale completion use explicit clock values',t=>{
  t.mock.timers.enable({apis:['Date'],now:EPOCH});const f=databaseFixture('merchant-alpha');try{
    const old=f.store.claim(EPOCH,1000)!;assert.equal(f.store.claim(EPOCH+500),undefined);
    const next=f.store.claim(EPOCH+1001,1000)!;assert.notEqual(old.lease_owner,next.lease_owner);
    assert.throws(()=>f.store.finish(old,EPOCH+1001),/STALE_JOB_LEASE/);f.store.finish(next,EPOCH+1001);assert.equal(f.store.state().jobs[0].attempts,2);
  }finally{f.cleanup();}
});
test('DB-04 deterministic rollback cannot contaminate a fresh seed',()=>{
  const f=databaseFixture('merchant-alpha');try{
    assert.throws(()=>f.store.transaction(()=>{f.store.db.prepare('UPDATE dev_markers SET value=?').run('changed');throw Error('forced');}),/forced/);
    assert.equal(f.store.state().markers[0].value,'ALPHA');
  }finally{f.cleanup();}
});
test('DB-05 seeded job identity preserves duplicate protection',()=>{
  const f=databaseFixture('merchant-alpha');try{
    f.store.enqueue({id:'shared-job',value:'ALPHA'});assert.equal(f.store.state().jobs.length,1);
    assert.throws(()=>f.store.enqueue({id:'shared-job',value:'BETA'}),/IDEMPOTENCY_CONFLICT/);assert.equal(f.store.state().jobs[0].value,'ALPHA');
  }finally{f.cleanup();}
});

register();
