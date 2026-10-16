import test from 'node:test';import assert from 'node:assert/strict';
import { execFile,spawn } from 'node:child_process';import { promisify } from 'node:util';import { fileURLToPath } from 'node:url';
import { readFileSync,cpSync,existsSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fixture,git,ROOT } from './helpers.mts';
import { configuration,childEnvironment } from '../../packages/development/config.mts';
import { readFixture } from './read-workflow-helpers.mts';
import { startCommerceServer } from '../../apps/commerce-api/server.mts';
import { CustomerAccess } from '../../packages/commerce/customer-access.mts';
const execute=promisify(execFile);
async function setup(){const f=readFixture();const outbox:any[]=[];const customers=new CustomerAccess(f.kernel,p=>outbox.push(p));
  f.reads.profiles.put(f.a.scope,f.profile());f.reads.profiles.put(f.b.scope,f.profile(f.b));f.reads.knowledge.put(f.a.scope,f.source());
  const server=await startCommerceServer({kernel:f.kernel,caps:f.caps,simulator:f.simulator,customers,reads:f.reads});
  const request=(path:string,value?:unknown,bearer=f.a.bearer)=>fetch(server.url+path,{method:value===undefined?'GET':'POST',
    headers:{authorization:'Bearer '+bearer,...(value===undefined?{}:{'content-type':'application/json'})},body:value===undefined?undefined:JSON.stringify(value),signal:AbortSignal.timeout(5000)});
  return {...f,outbox,server,request};}
async function use(fn:(f:Awaited<ReturnType<typeof setup>>)=>unknown){const f=await setup();try{return await fn(f);}finally{await f.server.close();f.cleanup();}}

test('CASE-M01-G10-01',()=>use(async f=>{
  const response=await f.request('/v1/read-tasks',{order_id:f.order().id,profile_id:'default'});assert.equal(response.status,201);const task=await response.json();
  const client=fileURLToPath(new URL('../../clients/read_task.py',import.meta.url));
  const child=await execute('python3',[client,'--base-url',f.server.url,'--task-id',task.id],{env:{PATH:process.env.PATH,RIFARE_BEARER:f.a.bearer},timeout:10000});
  const received=JSON.parse(child.stdout);assert.equal(received.id,task.id);assert.equal(received.facts.order.totals.amount_minor,12500);
  assert.equal(received.facts.source.native_id,'ORD-1001');assert.equal(received.profile.skill_digest,f.bundle.digest);
  assert.equal(received.agent_runtime_required,false);assert.equal(child.stdout.includes(f.a.bearer),false);
}));
test('CASE-M01-G10-02',()=>use(async f=>{
  const task=f.reads.createTask(f.a.scope,{order_id:f.order().id,profile_id:'default'});
  assert.equal((await f.request('/v1/read-tasks/'+task.id,undefined,f.b.bearer)).status,404);
  assert.equal((await f.request('/v1/read-tasks/'+task.id,undefined,'provider-thread-123')).status,403);
  const unknown=await f.request('/v1/read-tasks/'+task.id+'/actions',{action:'order.refund',arguments:{}});
  assert.equal(unknown.status,400);assert.equal((await unknown.json()).error,'PROFILE_ACTION_DENIED');
  const bad=await f.request('/v1/read-tasks',{order_id:f.order().id,profile_id:'default',provider_thread:'123'});assert.equal(bad.status,400);
}));
test('CASE-M01-G10-03',()=>use(async f=>{
  // The server has no agent service dependency, registration, model secret, or thread table.
  const task=await(await f.request('/v1/read-tasks',{order_id:f.order().id,profile_id:'default'})).json();
  assert.equal(task.agent_runtime_required,false);
  const facts=await(await f.request('/v1/orders/'+task.order_id+'/status')).json();assert.equal(facts.order.number,'ORD-1001');
}));
test('M01-G10-CONTENT-ONLY-CLIENT',()=>use(async f=>{
  const task=await(await f.request('/v1/read-tasks',{order_id:f.order().id,profile_id:'default'})).json();
  const r=await f.request('/v1/read-tasks/'+task.id+'/actions',{action:'skill.read',arguments:{skill_id:'order-status',resource:'SKILL.md',bundle_digest:task.skill.bundle_digest}});
  assert.equal(r.status,200);const skill=await r.json();assert.equal(skill.content,f.bundle.files['SKILL.md']);
  assert.equal(JSON.stringify(skill).includes(process.cwd()),false);
}));
test('M01-G10-CUSTOMER-ORDER-LIMIT',()=>use(async f=>{
  await f.request('/v1/customer/challenges',{store_id:f.a.store,order_number:'ORD-1001',email:'shopper-apparel@example.invalid'});
  const p=f.outbox[0];const verified=await(await f.request('/v1/customer/verify',{store_id:f.a.store,challenge_id:p.challenge_id,proof:p.proof})).json();
  const good=await f.request('/v1/read-tasks',{order_id:verified.resource_id,profile_id:'default'},verified.token);assert.equal(good.status,201);
  const other=f.kernel.lookup(f.a.scope,'order','synthetic','ORD-1002');assert.equal((await f.request('/v1/read-tasks',{order_id:other.id,profile_id:'default'},verified.token)).status,404);
  const task=await good.json();assert.equal(task.facts.order.shipments[0].delivery_state,'in_transit');
}));
test('M01-G10-REVOKED-SESSION',()=>use(async f=>{
  const t=f.reads.createTask(f.a.scope,{order_id:f.order().id,profile_id:'default'});f.kernel.revoke(f.a.scope);
  assert.equal((await f.request('/v1/read-tasks/'+t.id)).status,403);
}));
test('M01-G10-PROFILE-REVISION',()=>use(async f=>{
  const t=f.reads.createTask(f.a.scope,{order_id:f.order().id,profile_id:'default'});
  f.reads.profiles.put(f.a.scope,f.profile(f.a,{revision:2,tone:'warm'}));
  const r=await f.request('/v1/read-tasks/'+t.id);assert.equal(r.status,400);assert.equal((await r.json()).error,'TASK_CONTEXT_CHANGED');
}));
test('M01-G10-CURRENT-FACTS',()=>use(async f=>{
  const t=f.reads.createTask(f.a.scope,{order_id:f.order().id,profile_id:'default'});
  f.simulator.advanceShipment(f.a.scope,{operation_id:'ship-update',shipment:'SHIP-1001',expected_version:1,to:'delivered'});
  const current=await(await f.request('/v1/read-tasks/'+t.id)).json();assert.equal(current.facts.order.shipments[0].delivery_state,'delivered');
  assert.equal(current.facts.order.shipments[0].source.revision,2);
}));
test('M01-G10-KNOWLEDGE-ROUTES',()=>use(async f=>{
  const search=await(await f.request('/v1/knowledge/search?query=parcel')).json();assert.equal(search.sources[0].id,'shipping');
  const source=await(await f.request('/v1/knowledge/shipping/revisions/1')).json();assert.equal(source.source.revision,1);
  assert.equal((await f.request('/v1/knowledge/shipping/revisions/2')).status,404);
  assert.equal((await f.request('/v1/knowledge/search?query=parcel&query=secret')).status,400);
}));
test('M01-G10-RESOURCE-TRAVERSAL',()=>use(async f=>{
  const q=new URLSearchParams({skill_id:'order-status',resource:'../../secrets',bundle_digest:f.bundle.digest});
  const r=await f.request('/v1/skill-content?'+q);assert.equal(r.status,400);assert.equal((await r.json()).error,'RESOURCE_DENIED');
}));
test('M01-G10-JSON-CONTRACT',()=>use(async f=>{
  const spec=await(await f.request('/v1/read-contract')).json();assert.equal(spec.openapi,'3.1.0');
  const task=await(await f.request('/v1/read-tasks',{order_id:f.order().id,profile_id:'default'})).json();
  for(const key of spec.components.schemas.Task.required)assert.ok(Object.hasOwn(task,key),key);
  for(const key of spec.components.schemas.OrderStatus.required)assert.ok(Object.hasOwn(task.facts,key),key);
  assert.equal(spec.security[0].bearerAuth.length,0);assert.equal(spec.components.schemas.Action.properties.action.enum.includes('order.refund'),false);
  assert.deepEqual(spec,JSON.parse(readFileSync(new URL('../../packages/commerce/contracts/read-api.openapi.json',import.meta.url),'utf8')));
}));
test('M01-G10-NO-SECRET-IN-RESPONSES',()=>use(async f=>{
  for(const path of ['/v1/read-contract','/v1/orders/'+f.order().id+'/status','/v1/profiles/default']) {
    const r=await f.request(path);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal((await r.text()).includes(f.a.bearer),false);
  }
}));
test('M01-G10-TASK-ORDER-CANNOT-CHANGE',()=>use(async f=>{
  const t=f.reads.createTask(f.a.scope,{order_id:f.order().id,profile_id:'default'});
  const other=f.kernel.lookup(f.a.scope,'order','synthetic','ORD-1002');
  const r=await f.request('/v1/read-tasks/'+t.id+'/actions',{action:'order.status',arguments:{order_id:other.id}});assert.equal(r.status,403);
}));
test('M01-G10-SHIPMENT-SCOPE',()=>use(async f=>{
  f.db.prepare("UPDATE commerce_connections SET granted_scopes='[\"read_orders\"]' WHERE store_id=?").run(f.a.store);
  const facts=await(await f.request('/v1/orders/'+f.order().id+'/status')).json();
  assert.deepEqual(facts.order.shipments,[]);assert.equal(facts.order.shipments_status,'required_scope_missing');
}));

test('M01-G10-PACKAGED-BOOTSTRAP',async()=>{
  const f=fixture();let child:ReturnType<typeof spawn>|undefined;let exited:Promise<unknown>|undefined;
  try{
    assert.equal(existsSync(join(f.root,'tests')),false);
    cpSync(join(ROOT,'tools/dev-commerce.mts'),join(f.root,'tools/dev-commerce.mts'));
    git(f.root,'add','.');git(f.root,'commit','-qm','Package diagnostic read entrypoint');
    child=spawn(process.execPath,['--experimental-strip-types','tools/dev-commerce.mts'],{cwd:f.root,env:childEnvironment(),stdio:['ignore','pipe','pipe']});
    exited=new Promise(resolve=>child!.once('exit',resolve));let output='';child.stdout!.on('data',b=>output+=b);child.stderr!.on('data',b=>output+=b);
    const runFile=join(configuration(f.root,{}).dataDir,'commerce-run.json');let ready=false;
    for(let i=0;i<100;i++){
      if(child.exitCode!==null)break;
      if(existsSync(runFile)&&output.includes('commerce_ready')){ready=true;break;}
      await delay(40);
    }
    assert.equal(ready,true,'minimal package must start without test fixtures');
    const run=JSON.parse(readFileSync(runFile,'utf8')),headers={authorization:'Bearer '+run.operators[0].bearer};
    const contractResponse=await fetch(run.url+'/v1/read-contract',{headers,signal:AbortSignal.timeout(3000)});
    assert.equal(contractResponse.status,200,'packaged runtime must serve its public contract');assert.equal((await contractResponse.json()).openapi,'3.1.0');
    const order=await(await fetch(run.url+'/v1/lookup?kind=order&external_id=ORD-1001',{headers,signal:AbortSignal.timeout(3000)})).json();
    const response=await fetch(run.url+'/v1/read-tasks',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({order_id:order.id,profile_id:'default'}),signal:AbortSignal.timeout(3000)});
    assert.equal(response.status,201);const task=await response.json();
    assert.equal(task.profile.tone,'warm');assert.equal(task.skill.id,'order-status');assert.equal(task.facts.order.number,'ORD-1001');
    assert.equal(task.agent_runtime_required,false);
  }finally{
    if(child&&child.exitCode===null){child.kill('SIGTERM');await Promise.race([exited,delay(5000)]);if(child.exitCode===null){child.kill('SIGKILL');await exited;}}
    f.cleanup();
  }
});
