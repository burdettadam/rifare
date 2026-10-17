import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { usingQualifiedDestinations } from './qualified-destinations-helpers.mts';

async function race(f:any,commands:any[]){const children=commands.map(command=>{
 const config={filename:f.sourceFile,tenant:f.a.tenant,store:f.a.store,now:f.now(),command},child=spawn(process.execPath,['--experimental-strip-types','tests/development/qualified-destinations-native-child.mts'],{env:{RIFARE_DESTINATION_CHILD:JSON.stringify(config)},stdio:['pipe','pipe','pipe']});
 let output='',stderr='',readyResolve:()=>void,readyReject:(error:Error)=>void;
 const ready=new Promise<void>((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
 child.stdout.on('data',data=>{output+=data;if(output.includes('"ready":true'))readyResolve();});child.stderr.on('data',data=>stderr+=data);child.on('error',error=>readyReject(error));
 const done=new Promise<any>((resolve,reject)=>{child.on('error',reject);child.on('close',code=>{if(code!==0){const error=new Error(stderr||'native child exit '+code);readyReject(error);reject(error);}else resolve(JSON.parse(output.trim().split('\n').at(-1)!));});});
 return {child,ready,done};
 });
 try{await Promise.all(children.map(c=>c.ready));for(const c of children)c.child.stdin.end('start\n');return await Promise.all(children.map(c=>c.done));}
 finally{for(const c of children)if(c.child.exitCode===null)c.child.kill();}
}

test('M06-G12-TWO-PROCESS-LAST-CAPACITY-ADMISSION',{timeout:15000},()=>usingQualifiedDestinations(async f=>{
 f.reviseDestination('fragile-destination',{capacity_units:3});f.choose();const first=f.authorizeFulfillment(f.quote());
 const second=await f.secondExchange(),secondOrder=f.kernel.get(f.a.scope,second.request.resource_id??second.allocation.resource_id);
 f.native.recordRequest({...f.sourceRequest,request_id:second.request.id,resource_id:secondOrder.id,native_order_id:'gid://shopify/Order/202',native_return_id:'gid://shopify/Return/920',items:[f.golden.items[2]],source_record_id:'routing-original-return-920'});
 f.labels.configureParcel(f.owner.scope,{...f.parcelInput,request_id:second.request.id,case_id:second.caseId});
 f.routing.bind(f.a.scope,{request_id:second.request.id});f.routing.select(f.owner.scope,{request_id:second.request.id,destination_id:'fragile-destination',expected_revision:0});
 const secondOp=f.authorizeFulfillment(f.labels.quote(f.a.scope,{request_id:second.request.id,replaces:null}));
 let finish:(value:any[])=>void,fail:(error:Error)=>void;const all=new Promise<any[]>((resolve,reject)=>{finish=resolve;fail=reject;}),pending:any[]=[];
 f.fulfillmentSource.buy=async command=>{pending.push(command);if(pending.length===2)race(f,pending).then(finish,fail);const outcomes=await all,result=outcomes[pending.findIndex(p=>p.operation_id===command.operation_id)];if(!result.ok)throw new Error(result.error);return result.result;};
 const results=await Promise.all([f.execution.dispatch(f.a.scope,first.id),f.execution.dispatch(f.a.scope,secondOp.id)]),outcomes=await all;
 assert.equal(outcomes.filter(r=>r.ok).length,1);assert.deepEqual(outcomes.filter(r=>!r.ok).map(r=>r.error),['DESTINATION_INELIGIBLE']);
 assert.deepEqual(results.map(r=>r.state).sort(),['purchased','unknown']);assert.equal(f.fulfillmentSource.effects().length,1);assert.equal(f.native.admissions().length,1);
 const admitted=f.native.admissions()[0].quantity;assert([1,3].includes(admitted));assert.equal(f.native.capacity('fragile-destination').available_units,3-admitted);
}));
test('M06-G12-TWO-PROCESS-SAME-LABEL-HAS-ONE-ADMISSION',{timeout:15000},()=>usingQualifiedDestinations(async f=>{
 f.choose();const op=f.authorizeFulfillment(f.quote());let outcomes:any[]=[];
 f.fulfillmentSource.buy=async command=>{outcomes=await race(f,[command,command]);assert(outcomes.every(r=>r.ok));assert.deepEqual(outcomes[0].result,outcomes[1].result);return outcomes[0].result;};
 assert.equal((await f.execution.dispatch(f.a.scope,op.id)).state,'purchased');assert.equal(outcomes.length,2);assert.equal(f.fulfillmentSource.effects().length,1);assert.equal(f.native.admissions().length,1);assert.equal(f.native.capacity('fragile-destination').admitted_units,3);
}));
