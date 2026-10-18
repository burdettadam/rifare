import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {usingReturnPortability,withPortabilityServer} from './return-portability-helpers.mts';
async function component(f:any,app:any,phase:string){
 const input={url:app.url,staff_token:f.a.bearer,reviewer_token:f.reviewer.bearer,case_id:f.caseId,link_id:f.link.id,phase,screenshot:process.env.RIFARE_PORTABILITY_CAPTURE_DIR?process.env.RIFARE_PORTABILITY_CAPTURE_DIR+'/'+phase+'.png':null};
 const result=await new Promise<any>((resolve,reject)=>{const p=spawn('python3',['tests/browser/return_portability_component.py'],{env:{...process.env,RIFARE_TEST_INPUT:JSON.stringify(input)},stdio:['ignore','pipe','pipe']});let out='',err='';p.stdout.on('data',v=>out+=v);p.stderr.on('data',v=>err+=v);p.on('error',reject);p.on('close',code=>resolve({code,out,err}));});
 assert.equal(result.code,0,result.err);const r=JSON.parse(result.out);assert.equal(r.passed,true);assert.deepEqual(r.direct_browser_network,[]);return r;
}
test('M07-G03-BROWSER-COMMON-RETURN-REFUND-AND-NOTIFICATION',()=>usingReturnPortability(async f=>{await withPortabilityServer(f,async(_post,app)=>{
 const request=await component(f,app,'request');assert.ok(request.requests.includes('/v1/returns/prepare'));assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_action_receipts').get()!.n,2);
 const op=f.db.prepare('SELECT id FROM commerce_resolution_operations').get()!;assert.equal(f.executor.read(f.a.scope,op.id).cash_settled,false);assert.equal(f.gatewayDb.prepare('SELECT count(*) n FROM fixture_woo_gateway_movements').get()!.n,0);
 f.advance(1);f.gatewaySource.settle(op.id);await f.executor.reconcile(f.a.scope,op.id);
 await component(f,app,'notification');assert.equal(f.mailDb.prepare('SELECT count(*) n FROM support_source_effects').get()!.n,1);assert.equal(f.gatewayDb.prepare('SELECT count(*) n FROM fixture_woo_gateway_refunds').get()!.n,1);assert.equal(f.gatewayDb.prepare('SELECT count(*) n FROM fixture_woo_gateway_movements').get()!.n,1);assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_native_return_operations').get()!.n,0);
 });},{deferRequest:true}));
test('M07-G03-BROWSER-LATE-CONTEXT-CANNOT-REPOPULATE-A-CHANGED-CASE',()=>usingReturnPortability(async f=>{await withPortabilityServer(f,async(_post,app)=>{await component(f,app,'late');assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_resolution_operations').get()!.n,0);assert.equal(f.mailDb.prepare('SELECT count(*) n FROM support_source_effects').get()!.n,0);});},{deferRequest:true}));
