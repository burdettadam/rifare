import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { usingExecution } from './execution-helpers.mts';
import { usingReturns } from './return-intake-helpers.mts';
import { usingEdits, installEditSkill } from './order-edit-helpers.mts';
import { usingControls } from './worker-controls-helpers.mts';
import { createSupportDemo } from '../../packages/development/support-demo.mts';
import { startCommerceServer } from '../../apps/commerce-api/server.mts';

async function browser(input:Record<string,unknown>) {
  const result = await new Promise<{code:number|null,out:string,err:string}>((resolve,reject)=>{
    const child=spawn(process.env.RIFARE_TEST_PYTHON||'python3',['tests/browser/accessibility_workflows.py'],{
      env:{...process.env,RIFARE_TEST_INPUT:JSON.stringify(input)},stdio:['ignore','pipe','pipe']});
    let out='',err=''; const timer=setTimeout(()=>child.kill('SIGTERM'),20000);
    child.stdout.on('data',b=>out+=b); child.stderr.on('data',b=>err+=b);
    child.on('error',error=>{clearTimeout(timer);reject(error);});
    child.on('close',code=>{clearTimeout(timer);resolve({code,out,err});});
  });
  assert.equal(result.code,0,result.err); const value=JSON.parse(result.out);
  assert.equal(value.passed,true); assert.deepEqual(value.direct_browser_network,[]);
  assert.equal(value.human_assistive_technology_observed,false);
  assert.equal(value.scenario,input.scenario);
  console.log(JSON.stringify({accessibility_observation:value}));
  return value;
}
async function withServer(f:any,input:Record<string,unknown>,extra:Record<string,unknown>={}) {
  const server=await startCommerceServer({kernel:f.kernel,caps:f.caps,customers:f.customers,
    simulator:f.simulator,reads:f.reads,...extra});
  try{return await browser({...input,url:server.url,at:f.kernel.clock()});}finally{await server.close();}
}

test('CASE-M07-G15-01',()=>usingExecution(async f=>{
  const r=await withServer(f,{scenario:'execution',token:f.a.bearer,reviewer:f.reviewer.bearer});
  assert.equal(f.gateway.state(f.owner.scope,'case_one').revision,1);
  assert.equal(r.calls.filter((c:any)=>c.path==='/v1/execution/execute').length,1);
}));
test('CASE-M07-G15-02',()=>browser({scenario:'form-errors'}));
test('CASE-M07-G15-03',()=>browser({scenario:'faults'}));
test('M07-G15-STATUS-KEYBOARD',()=>usingExecution(async f=>{
  await withServer(f,{scenario:'status',token:f.a.bearer,resource:f.order().id});
  assert.equal(f.gateway.state(f.owner.scope,'case_one').revision,0);
}));
test('M07-G15-RETURN-KEYBOARD',()=>usingReturns(async f=>{
  await withServer(f,{scenario:'returns',token:f.customerBearer});
  assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_return_requests').get().n,1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_action_receipts').get().n,0);
}));
test('M07-G15-EDIT-KEYBOARD',()=>usingEdits(async f=>{
  const {bundle}=installEditSkill(f);
  await withServer(f,{scenario:'order-edits',token:f.a.bearer,reviewer:f.reviewer.bearer,skill:bundle.digest},{orderEditSource:f.native});
}));
test('M07-G15-SUPPORT-HANDOFF-KEYBOARD',async()=>{
  const f=createSupportDemo();f.stopModel();
  try{const r=await withServer(f,{scenario:'support',token:f.operator.token},{support:f.support});
    assert.equal(f.source.calls,0);assert.equal(r.calls.filter((c:any)=>c.path==='/v1/support/takeover').length,1);
  }finally{f.cleanup();}
});
test('M07-G15-RECOVERY-KEYBOARD',()=>usingControls(async f=>{
  const operation=f.executeOperation().op;f.journal.arm('after_accept');
  await f.work.dispatch(f.a.scope,operation.id,f.journal);f.claim();
  const r=await withServer(f,{scenario:'exceptions',token:f.a.bearer,operation:operation.id},
    {reconciliationJournals:()=>f.journal});
  assert.equal(f.journal.count(),1);
  assert.equal(r.calls.filter((c:any)=>c.path.endsWith('/reconcile')).length,1);
}));
