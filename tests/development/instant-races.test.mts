import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { CommerceKernel } from '../../packages/commerce/kernel.mts';
import { InstantExchanges } from '../../packages/commerce/instant-exchanges.mts';
import { InstantExchangeFixtureSource } from '../../packages/adapters/instant-exchange-fixture-source.mts';
import { usingInstant,oracle,captureCount,authorizeMandate,releaseReplacement } from './instant-helpers.mts';

async function race(f:any,requests:any[]){const children=requests.map(request=>{
 const config={filename:f.sourceFilename,tenant:f.a.tenant,store:f.a.store,now:f.now(),...request},p=spawn(process.execPath,['--experimental-strip-types','tests/development/instant-native-child.mts'],{env:{...process.env,RIFARE_INSTANT_CHILD:JSON.stringify(config)},stdio:['pipe','pipe','pipe']});
 let output='',stderr='',readyResolve:()=>void,readyReject:(e:Error)=>void;
 const ready=new Promise<void>((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
 p.stdout.on('data',data=>{output+=data;if(output.includes('"ready":true'))readyResolve();});p.stderr.on('data',data=>stderr+=data);p.on('error',readyReject!);
 const done=new Promise<any>((resolve,reject)=>{p.on('error',reject);p.on('close',code=>{if(code!==0){const error=new Error(stderr||'child exit '+code);readyReject!(error);reject(error);}else resolve(JSON.parse(output.trim().split('\n').at(-1)!));});});
 return {p,ready,done};
 });
 try{await Promise.all(children.map(c=>c.ready));for(const c of children)c.p.stdin.end('start\n');return await Promise.all(children.map(c=>c.done));}
 finally{for(const c of children)if(c.p.exitCode===null)c.p.kill();}
}

test('M06-G10-TWO-PROCESS-RETURN-CAPTURE-CONTENTION',()=>usingInstant(async f=>{
 await authorizeMandate(f);await releaseReplacement(f);f.advance(oracle.trial_ms+1);
 const op=f.authorize(f.instant.quoteCapture(f.a.scope,{obligation_id:f.obligationId}));let results:any[]=[];
 f.source.issue=async command=>{results=await race(f,[{kind:'capture',input:command},{kind:'return',input:f.received('concurrent_return',[1])}]);assert(results.every(r=>r.ok));return results[0].result;};
 const done=await f.instant.dispatch(f.a.scope,op.id);assert.equal(done.state,'captured');assert.equal(captureCount(f),1);
 const native=f.source.obligation(f.obligationId);assert(['2000','3000'].includes(native.captured_minor));
 assert.equal(native.compensation_required_minor,native.captured_minor==='3000'?'1000':'0');
 assert.equal(BigInt(native.captured_minor)-BigInt(native.compensation_required_minor),2000n);
 assert.equal(native.remaining_minor,'2000');assert.equal(results.length,2);
}));

test('M06-G10-TWO-PROCESS-SAME-CAPTURE-EXACTLY-ONCE',()=>usingInstant(async f=>{
 await authorizeMandate(f);await releaseReplacement(f);f.advance(oracle.trial_ms+1);
 const op=f.authorize(f.instant.quoteCapture(f.a.scope,{obligation_id:f.obligationId}));
 f.source.issue=async command=>{const result=await race(f,[{kind:'capture',input:command},{kind:'capture',input:command}]);assert(result.every(r=>r.ok));assert.deepEqual(result[0].result,result[1].result);return result[0].result;};
 const done=await f.instant.dispatch(f.a.scope,op.id);assert.equal(done.state,'captured');assert.equal(done.source.captured_minor,'3000');assert.equal(captureCount(f),1);
}));

test('M06-G10-REOPEN-RECONCILES-ORIGINAL-CAPTURE',()=>usingInstant(async f=>{
 await authorizeMandate(f);await releaseReplacement(f);f.advance(oracle.trial_ms+1);
 const op=f.authorize(f.instant.quoteCapture(f.a.scope,{obligation_id:f.obligationId}));f.source.fault='after';
 assert.equal((await f.instant.dispatch(f.a.scope,op.id)).state,'unknown');
 const db=new DatabaseSync(f.filename),nativeDb=new DatabaseSync(f.sourceFilename);
 try{const k=new CommerceKernel(db,f.now),source=new InstantExchangeFixtureSource(nativeDb,{mode:'fixture',tenant:f.a.tenant,store:f.a.store,identity:'instant-source',clock:f.now}),instant=new InstantExchanges(k,source),scope=k.authenticate(f.a.bearer);
  assert.equal((await instant.reconcile(scope,op.id)).state,'captured');await instant.dispatch(scope,op.id);
  assert.equal(source.calls.issue,0);assert.equal(captureCount(f),1);
 }finally{db.close();nativeDb.close();}
}));

test('M06-G10-UNKNOWN-PRECALL-NOT-RESENT',()=>usingInstant(async f=>{
 await authorizeMandate(f);await releaseReplacement(f);f.advance(oracle.trial_ms+1);
 const op=f.authorize(f.instant.quoteCapture(f.a.scope,{obligation_id:f.obligationId}));f.source.fault='before';
 assert.equal((await f.instant.dispatch(f.a.scope,op.id)).state,'unknown');assert.equal((await f.instant.reconcile(f.a.scope,op.id)).state,'unknown');
 await f.instant.dispatch(f.a.scope,op.id);assert.equal(f.source.calls.issue,2); // one authorization and one uncertain capture
 assert.equal(captureCount(f),0);assert.throws(()=>f.instant.quoteCapture(f.a.scope,{obligation_id:f.obligationId}),/INSTANT_OPERATION_EXISTS/);
}));

test('M06-G10-CAPTURE-TRANSPORT-CANNOT-CHANGE-IDENTITY-OR-CEILING',()=>usingInstant(async f=>{
 await authorizeMandate(f);await releaseReplacement(f);f.advance(oracle.trial_ms+1);
 const op=f.authorize(f.instant.quoteCapture(f.a.scope,{obligation_id:f.obligationId})),issue=f.source.issue.bind(f.source);
 f.source.issue=async command=>issue({...command,operation_id:'new_capture_identity',amount_minor:'99999'});
 assert.equal((await f.instant.dispatch(f.a.scope,op.id)).state,'unknown');assert.equal(captureCount(f),0);
}));

test('M06-G10-MALFORMED-CAPTURE-RESULT-RECONCILES',()=>usingInstant(async f=>{
 await authorizeMandate(f);await releaseReplacement(f);f.advance(oracle.trial_ms+1);
 const op=f.authorize(f.instant.quoteCapture(f.a.scope,{obligation_id:f.obligationId}));f.source.fault='malformed';
 assert.equal((await f.instant.dispatch(f.a.scope,op.id)).state,'unknown');assert.equal(captureCount(f),1);
 assert.equal((await f.instant.reconcile(f.a.scope,op.id)).state,'captured');assert.equal(captureCount(f),1);
}));
