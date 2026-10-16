import test from 'node:test';import assert from 'node:assert/strict';import { spawn } from 'node:child_process';
import { usingControls } from './worker-controls-helpers.mts';import { startCommerceServer } from '../../apps/commerce-api/server.mts';
async function run(scenario:string){return usingControls(async f=>{const a=f.executeOperation().op;f.journal.arm('after_accept');await f.work.dispatch(f.a.scope,a.id,f.journal);const b=f.extraOperation(21);f.journal.arm('reject');await f.work.dispatch(f.a.scope,b.id,f.journal);f.claim();
  const server=await startCommerceServer({kernel:f.kernel,caps:f.caps,customers:f.customers,simulator:f.simulator,reconciliationJournals:()=>f.journal});try{
    const result=await new Promise<any>((resolve,reject)=>{const child=spawn('python3',['tests/browser/exceptions_component.py'],{env:{...process.env,RIFARE_TEST_INPUT:JSON.stringify({scenario,url:server.url,bearer:f.a.bearer,owner:f.owner.bearer,worker:f.a.workerBearer,unknown:a.id})},stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);child.on('close',c=>c===0?resolve(JSON.parse(out)):reject(new Error(err)));});
    assert.equal(result.passed,true);assert.deepEqual(result.direct_browser_network,[]);assert.equal(f.journal.count(),1);
  }finally{await server.close();}});}
test('CASE-M02-G22-01',()=>run('reconcile'));
test('CASE-M02-G22-02',()=>run('states'));
test('CASE-M02-G22-03',()=>run('owner'));
test('M02-G22-COMPONENT-TEXT-NOT-HTML',()=>run('injection'));
test('M02-G22-COMPONENT-MOBILE',()=>run('mobile'));

test('M02-G22-COMPONENT-LATE-RESULT-AFTER-SIGNOUT',()=>run('logout-race'));
