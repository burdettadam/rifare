import test from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';
import {usingReturns} from './return-intake-helpers.mts';import {startCommerceServer} from '../../apps/commerce-api/server.mts';
async function run(scenario:string){await usingReturns(async f=>{
 let requestId:string|null=null;if(scenario==='resume')requestId=f.prepare().id;
 if(scenario==='jpy'){const order=f.order();f.kernel.ingest(f.a.scope,{kind:'order',source_system:'synthetic',external_id:order.external_id,source_version:4,source_updated_at:f.now(),customer_id:order.customer_id,payload:{...order.payload,currency:'JPY'}});f.intake.configure(f.owner.scope,{expected_revision:1,settings:{...f.settings,currency:'JPY'}});}
 const s=await startCommerceServer({kernel:f.kernel,caps:f.caps,reads:f.reads,customers:f.customers,simulator:f.simulator});try{
 const result=await new Promise<any>((resolve,reject)=>{const p=spawn('python3',['tests/browser/returns_component.py'],{env:{...process.env,RIFARE_TEST_INPUT:JSON.stringify({scenario,url:s.url,bearer:f.customerBearer,request_id:requestId,screenshot:scenario==='keyboard'?process.env.RIFARE_RETURN_SCREENSHOT:undefined})},stdio:['ignore','pipe','pipe']});let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',reject);p.on('close',code=>resolve({code,out,err}));});
 assert.equal(result.code,0,result.err);const value=JSON.parse(result.out);assert.equal(value.passed,true);assert.deepEqual(value.direct_browser_network,[]);
 assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_return_requests').get().n,scenario==='late_quote'?0:1);assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_action_receipts').get().n,0);
 }finally{await s.close();}});}
test('CASE-M03-G03-01',()=>run('keyboard'));
test('M03-G03-BROWSER-RESUME-PRESERVES-REQUEST',()=>run('resume'));
test('M03-G03-BROWSER-CURRENCY-EXPONENT',()=>run('jpy'));
test('M03-G03-BROWSER-STALE-QUOTE-CANNOT-REPAINT',()=>run('late_quote'));
