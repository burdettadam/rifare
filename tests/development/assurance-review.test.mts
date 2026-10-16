import test from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {DatabaseSync} from 'node:sqlite';
import {usingExecution} from './execution-helpers.mts';import {CommerceKernel} from '../../packages/commerce/kernel.mts';
import {PrivacyLifecycle} from '../../packages/commerce/privacy-lifecycle.mts';
import {startCommerceServer} from '../../apps/commerce-api/server.mts';

test('M02-G27-REVIEW-TWO-MERCHANT-DEMO-SAME-SKILL',async()=>{
 const r=await new Promise<any>((resolve,reject)=>{const p=spawn(process.execPath,['--experimental-strip-types','tools/demo-assurance.mts'],{env:{PATH:process.env.PATH},stdio:['ignore','pipe','pipe']});let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',reject);p.on('close',code=>code===0?resolve(JSON.parse(out)):reject(new Error(err)));});
 assert.equal(r.skill.id,'return-draft');assert.equal(r.profiles[0].result,'awaiting_review');assert.equal(r.profiles[1].result,'POLICY_DENIED');assert.equal(r.resume_preserves_preview,true);assert.equal(r.restored_mode,'quarantine');assert.equal(r.restored_erased_read,'SUBJECT_ERASED');assert.equal(r.external_calls,0);assert.equal(r.financial_effect,false);
});
test('M02-G24-REVIEW-ERASURE-SURVIVES-REOPEN',()=>usingExecution(f=>{const order=f.order();new PrivacyLifecycle(f.kernel).erase(f.owner.scope,order.customer_id);const db=new DatabaseSync(f.filename);try{const k=new CommerceKernel(db,f.now),s=k.authenticate(k.issueSession(f.a.tenant,f.a.store,'owner'));assert.throws(()=>k.get(s,order.id),/SUBJECT_ERASED/);assert.throws(()=>k.ingest(s,{kind:'order',source_system:'synthetic',external_id:'NEWER-ORDER',source_version:1,source_updated_at:f.now(),customer_id:order.customer_id,payload:{note:'SYNTHETIC-PRIVATE-NAME'}}),/SUBJECT_ERASED/);}finally{db.close();}}));
test('M02-G24-REVIEW-HTTP-OWNER-BOUNDARY',()=>usingExecution(async f=>{const server=await startCommerceServer({kernel:f.kernel,caps:f.caps,reads:f.reads,customers:f.customers,simulator:f.simulator});try{
 const orderId=f.order().id,customer=f.order().customer_id,call=async(token:string,path:string)=>{const r=await fetch(server.url+path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({customer_id:customer})});return {status:r.status,body:await r.json()};};
 assert.notEqual((await call(f.a.bearer,'/v1/privacy/erase')).status,200);assert.equal((await call(f.owner.bearer,'/v1/privacy/export')).body.credentials_included,false);assert.equal((await call(f.owner.bearer,'/v1/privacy/erase')).body.status,'logically_erased');assert.throws(()=>f.kernel.get(f.a.scope,orderId),/SUBJECT_ERASED/);
 }finally{await server.close();}}));
