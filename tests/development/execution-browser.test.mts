import test from 'node:test';import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { usingExecution } from './execution-helpers.mts';
import { startCommerceServer } from '../../apps/commerce-api/server.mts';
async function run(scenario:string){return usingExecution(async f=>{const s=await startCommerceServer({kernel:f.kernel,caps:f.caps,customers:f.customers,simulator:f.simulator,reads:f.reads});try{
  const output=await new Promise<string>((resolve,reject)=>{const child=spawn('python3',['tests/browser/execution_component.py'],{env:{...process.env,RIFARE_TEST_INPUT:JSON.stringify({scenario,url:s.url,bearer:f.a.bearer,reviewer:f.reviewer.bearer,owner:f.owner.bearer})},stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);child.on('close',code=>code===0?resolve(out):reject(new Error(err)));});
  const r=JSON.parse(output);assert.equal(r.passed,true);assert.equal(r.scenario,scenario);assert.deepEqual(r.direct_browser_network,[]);
  assert.equal(f.gateway.state(f.owner.scope,'case_one').revision,scenario==='stale'?0:1);
}finally{await s.close();}});}
test('M02-G10-MANUAL-COMPONENT-PREVIEW-APPROVE-EXECUTE',()=>run('success'));
test('M02-G10-MANUAL-COMPONENT-STALE-CLEARS',()=>run('stale'));
test('M02-G10-MANUAL-COMPONENT-TEXT-NOT-HTML',()=>run('injection'));
test('M02-G10-MANUAL-COMPONENT-MOBILE',()=>run('mobile'));
