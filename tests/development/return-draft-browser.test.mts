import test from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';
import {usingExecution} from './execution-helpers.mts';import {ReturnDrafts} from '../../packages/commerce/return-drafts.mts';import {startCommerceServer} from '../../apps/commerce-api/server.mts';
async function run(scenario:string){await usingExecution(async f=>{
 let caseId='case_one';if(scenario==='resume')new ReturnDrafts(f.kernel).prepare(f.a.scope,{case_id:caseId,request_key:'original-client',resolution:'refund'});
 else {f.advance(1);f.publish({expected_version:1,rules:{window_days:1,require_evidence:false,excluded_tags:[],outcomes:['refund']}});caseId='short_case';f.cases.create(f.customer,{case_id:caseId,resource_id:f.order().id,profile_id:'default',policy_id:'returns'});}
 const s=await startCommerceServer({kernel:f.kernel,caps:f.caps,reads:f.reads,customers:f.customers,simulator:f.simulator});try{
 const result=await new Promise<any>((resolve,reject)=>{const p=spawn('python3',['tests/browser/return_draft_component.py'],{env:{...process.env,RIFARE_TEST_INPUT:JSON.stringify({scenario,url:s.url,case:caseId,bearer:f.a.bearer,reviewer:f.reviewer.bearer})},stdio:['ignore','pipe','pipe']});let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',reject);p.on('close',code=>resolve({code,out,err}));});assert.equal(result.code,0,result.err);const value=JSON.parse(result.out);assert.equal(value.passed,true);assert.deepEqual(value.direct_browser_network,[]);assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_return_drafts').get().n,scenario==='resume'?1:0);assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_action_receipts').get().n,scenario==='resume'?1:0);
 }finally{await s.close();}});}
test('M02-G27-BROWSER-RESUME-APPROVE-EXACT-DRAFT',()=>run('resume'));
test('M02-G27-BROWSER-POLICY-DENIED-CLEARS',()=>run('policy'));
