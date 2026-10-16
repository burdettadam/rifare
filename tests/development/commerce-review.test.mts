import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { commerceFixture } from './commerce-helpers.mts';
import { CustomerAccess } from '../../packages/commerce/customer-access.mts';
import { Capabilities } from '../../packages/commerce/capabilities.mts';
import { StoreSimulator } from '../../packages/commerce/simulator.mts';
import { startCommerceServer } from '../../apps/commerce-api/server.mts';

test('M01-G02-REVIEW-01',()=>{const f=commerceFixture();try{const auth=new CustomerAccess(f.kernel,()=>{});for(let i=0;i<60;i++)auth.request({store_id:'store-a',order_number:'ORD-'+i,email:'a@example.invalid'},'same-client');assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_challenges').get().n,20);assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_challenge_rates').get().n,21);}finally{f.cleanup();}});
test('M01-G01-REVIEW-01',async()=>{const f=commerceFixture();const caps=new Capabilities(f.kernel),simulator=new StoreSimulator(f.kernel,caps);simulator.reset(f.a.scope);const customers=new CustomerAccess(f.kernel,()=>{});const server=await startCommerceServer({kernel:f.kernel,caps,simulator,customers});try{const status=await new Promise<number|undefined>((resolve,reject)=>{const req=request({hostname:'127.0.0.1',port:server.port,path:'http://foreign.invalid/v1/capabilities',headers:{authorization:'Bearer '+f.a.bearer}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end();});assert.equal(status,403);}finally{await server.close();f.cleanup();}});
test('M01-G05-REVIEW-01',()=>{const f=commerceFixture();try{const caps=new Capabilities(f.kernel),sim=new StoreSimulator(f.kernel,caps),messages:any[]=[];sim.reset(f.a.scope);const customer=new CustomerAccess(f.kernel,p=>{messages.push(p);});customer.request({store_id:'store-a',order_number:'ORD-1001',email:'shopper-apparel@example.invalid'},'client');const proof=messages[0],session=customer.complete({store_id:proof.store_id,challenge_id:proof.challenge_id,proof:proof.proof});const scope=f.kernel.authenticate(session.token);sim.reset(f.a.scope);assert.throws(()=>f.kernel.get(scope,session.resource_id),/ACCESS_DENIED/);assert.throws(()=>customer.complete({store_id:proof.store_id,challenge_id:proof.challenge_id,proof:proof.proof}),/VERIFICATION_FAILED/);}finally{f.cleanup();}});
