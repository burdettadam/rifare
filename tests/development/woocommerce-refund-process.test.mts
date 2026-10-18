import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {usingWooRefund} from './woocommerce-refund-helpers.mts';

const childCode=`
import {readFileSync} from 'node:fs';import {DatabaseSync} from 'node:sqlite';
import {CommerceKernel} from './packages/commerce/kernel.mts';
import {WooReturnFixtureSource,WooReturnSources} from './packages/adapters/woocommerce/return-source.mts';
import {WooRefundGatewayFixture} from './packages/adapters/woocommerce/refund-gateway-fixture.mts';
import {WooRefundFixtureSource} from './packages/adapters/woocommerce/refund-fixture-source.mts';
import {ResolutionExecution} from './packages/commerce/resolution-execution.mts';
const p=JSON.parse(readFileSync(0,'utf8')),clock=()=>p.now,core=new DatabaseSync(p.core),native=new DatabaseSync(p.native),gatewayDb=new DatabaseSync(p.gateway),sourceDb=new DatabaseSync(p.source),k=new CommerceKernel(core,clock);
const readSource=new WooReturnFixtureSource(native,p.returnOptions,clock);new WooReturnSources(k,readSource);
const gateway=new WooRefundGatewayFixture(gatewayDb,p.gatewayOptions,clock),source=new WooRefundFixtureSource(sourceDb,gateway,p.sourceOptions,clock),executor=new ResolutionExecution(k,source);
if(p.mode==='crash'){const issue=source.issue.bind(source);source.issue=async command=>{await issue(command);process.exit(79);};}
try{const result=await executor[p.mode==='reconcile'?'reconcile':'dispatch'](k.authenticate(p.bearer),p.operationId);console.log(JSON.stringify({id:result.id,state:result.state,native_id:result.native_id,cash_settled:result.cash_settled}));}finally{core.close();native.close();gatewayDb.close();sourceDb.close();}
`;
function child(f:any,operationId:string,mode:string){const filename=(db:any)=>db.prepare('PRAGMA database_list').all().find((r:any)=>r.name==='main').file,payload={core:f.filename,native:filename(f.returnSourceDb),gateway:f.gatewayFilename,source:f.sourceFilename,
 gatewayOptions:f.gatewayOptions,sourceOptions:f.sourceOptions,returnOptions:{mode:'fixture',identity:f.returnSource.identity,tenant:f.a.tenant,store:f.a.store,account_id:f.returnSource.account_id,origin:f.returnSource.origin},bearer:f.a.bearer,now:f.now(),operationId,mode};
 return new Promise<{code:number|null;out:string;err:string}>((resolve,reject)=>{const process=spawn(globalThis.process.execPath,['--experimental-strip-types','--input-type=module','-e',childCode],{cwd:globalThis.process.cwd(),stdio:['pipe','pipe','pipe']}),timer=setTimeout(()=>{process.kill('SIGKILL');reject(new Error('WOO_NATIVE_PROCESS_TIMEOUT'));},15000);let out='',err='';process.stdout.on('data',chunk=>out+=chunk);process.stderr.on('data',chunk=>err+=chunk);process.on('error',error=>{clearTimeout(timer);reject(error);});process.on('close',code=>{clearTimeout(timer);resolve({code,out,err});});process.stdin.end(JSON.stringify(payload));});
}
test('M07-G02-TEST-001',()=>usingWooRefund(async f=>{const op=f.approved(),crashed=await child(f,op.id,'crash');assert.equal(crashed.code,79,crashed.err);assert.equal(f.executor.read(f.a.scope,op.id).state,'unknown');
 const retried=await child(f,op.id,'dispatch');assert.equal(retried.code,0,retried.err);assert.deepEqual(JSON.parse(retried.out),{id:op.id,state:'unknown',native_id:null,cash_settled:false});const reconciled=await child(f,op.id,'reconcile');assert.equal(reconciled.code,0,reconciled.err);assert.equal(JSON.parse(reconciled.out).state,'accepted');assert.equal(JSON.parse(reconciled.out).id,op.id);
 assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_resolution_operations').get()!.n,1);assert.equal(f.sourceDb.prepare('SELECT count(*) n FROM fixture_woo_refund_operations').get()!.n,1);assert.equal(f.sourceDb.prepare('SELECT count(*) n FROM fixture_woo_refund_records').get()!.n,1);assert.equal(f.gatewayDb.prepare('SELECT count(*) n FROM fixture_woo_gateway_refunds').get()!.n,1);assert.equal(f.gatewayDb.prepare('SELECT count(*) n FROM fixture_woo_gateway_movements').get()!.n,0);
}));
test('M07-G02-TWO-PROCESSES-ONE-ORIGINAL-OBLIGATION',()=>usingWooRefund(async f=>{const op=f.approved(),results=await Promise.all([child(f,op.id,'dispatch'),child(f,op.id,'dispatch')]);for(const r of results)assert.equal(r.code,0,r.err);await f.executor.reconcile(f.a.scope,op.id);assert.equal(f.gatewayDb.prepare('SELECT count(*) n FROM fixture_woo_gateway_refunds').get()!.n,1);assert.equal(f.sourceDb.prepare('SELECT count(*) n FROM fixture_woo_refund_records').get()!.n,1);assert.equal(f.executor.read(f.a.scope,op.id).state,'accepted');}));
