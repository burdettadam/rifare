import test from 'node:test';import assert from 'node:assert/strict';
import { promisify } from 'node:util';import { execFile } from 'node:child_process';
import { cpSync,readFileSync,writeFileSync,mkdirSync,rmSync } from 'node:fs';import { join } from 'node:path';import { fileURLToPath } from 'node:url';
import { useAgent } from './agent-helpers.mts';
const execute=promisify(execFile),source=fileURLToPath(new URL('../../clients/status_agent.py',import.meta.url));
async function run(f:any,transport='rest',extra:any={}) {
  const client=join(f.directory,'independent','status_agent.py');mkdirSync(join(f.directory,'independent'),{recursive:true});cpSync(source,client);
  let credential=f.a.bearer;
  if(transport==='mcp')credential=(await(await f.request('/v1/mcp-grants',{task_id:f.task.id,tools:['read_task','order_status','skill_content']})).json()).token;
  const child=await execute('python3',[client,'--base-url',f.server.url,'--task-id',f.task.id,'--transport',transport],{
    cwd:join(f.directory,'independent'),env:{PATH:process.env.PATH,[transport==='mcp'?'RIFARE_MCP_TOKEN':'RIFARE_BEARER']:credential,...extra},timeout:15000});
  assert.equal(child.stdout.includes(credential),false);return JSON.parse(child.stdout);
}
test('CASE-M01-G15-01',()=>useAgent(async f=>{const r=await run(f,'mcp');assert.equal(r.status,'grounded_read');assert.equal(r.runtime,'independent_python_deterministic');
 assert.equal(r.claims.find((c:any)=>c.id==='order.number').value,'ORD-1001');assert.equal(r.skill_digest,f.bundle.digest);assert.equal(r.model_calls,0);assert.ok(r.consumed_resources.includes('SKILL.md'));}));
test('CASE-M01-G15-02',()=>useAgent(async f=>{for(const path of ['/v1/runner/checkpoint','/v1/secrets/resolve','/v1/provider/threads'])assert.equal((await f.request(path)).status,404);
 const r=await run(f);assert.equal(JSON.stringify(r).includes('checkpoint'),false);assert.equal(r.status,'grounded_read');}));
test('CASE-M01-G15-03',()=>useAgent(async f=>{const independent=join(f.directory,'independent');mkdirSync(independent,{recursive:true});
 writeFileSync(join(independent,'runner.py'),"raise RuntimeError('built-in runner must not load')\n");
 const r=await run(f,'mcp',{PYTHONPATH:independent});assert.equal(r.status,'grounded_read');
 const imports=readFileSync(source,'utf8');assert.equal(/from (rifare|runner)|import (rifare|runner)/.test(imports),false);
 assert.equal(readFileSync(new URL('../../apps/commerce-api/server.mts',import.meta.url),'utf8').includes("from '../../packages/agent/runner.mts'"),false);}));
test('M01-G15-REST-MCP-PARITY',()=>useAgent(async f=>{const a=await run(f),b=await run(f,'mcp');assert.deepEqual(a.claims,b.claims);assert.equal(a.skill_digest,b.skill_digest);}));
test('M01-G15-REVOKED',()=>useAgent(async f=>{f.kernel.revoke(f.a.scope);await assert.rejects(()=>run(f));}));
test('M01-G15-CROSS-TENANT',()=>useAgent(async f=>{await assert.rejects(()=>run(f,'rest',{RIFARE_BEARER:f.b.bearer}));}));
test('M01-G15-CHANGED-RESOURCE',()=>useAgent(async f=>{const old=f.reads.skills.read.bind(f.reads.skills);f.reads.skills.read=(...args:any[])=>({...old(...args as Parameters<typeof old>),content:'changed'});await assert.rejects(()=>run(f));}));
test('M01-G15-CHANGED-PROFILE',()=>useAgent(async f=>{f.reads.profiles.put(f.a.scope,f.profile(f.a,{revision:2,tone:'formal'}));await assert.rejects(()=>run(f));}));
test('M01-G15-PROXY-NOT-USED',()=>useAgent(async f=>{assert.equal((await run(f,'mcp',{HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1'})).status,'grounded_read');}));
test('M01-G15-NO-PRIVATE-RUNTIME-PERSISTENCE',()=>useAgent(async f=>{const before=f.db.prepare('SELECT count(*) AS n FROM commerce_assistance_receipts').get().n;
 await run(f,'mcp');assert.equal(f.db.prepare('SELECT count(*) AS n FROM commerce_assistance_receipts').get().n,before);assert.equal(f.reads.task(f.a.scope,f.task.id).id,f.task.id);}));
test('M01-G15-PHYSICALLY-ABSENT-BUILTIN',()=>useAgent(async f=>{
 const root=join(f.directory,'isolated-server');mkdirSync(root);
 for(const dir of ['packages','apps','migrations'])cpSync(fileURLToPath(new URL('../../'+dir,import.meta.url)),join(root,dir),{recursive:true});
 for(const file of ['runner.mts','providers.mts','facts.mts'])rmSync(join(root,'packages','agent',file));
 cpSync(source,join(root,'status_agent.py'));
 writeFileSync(join(root,'start.mts'),`import {DatabaseSync} from 'node:sqlite';
 import {CommerceKernel} from './packages/commerce/kernel.mts';import {Capabilities} from './packages/commerce/capabilities.mts';
 import {StoreSimulator} from './packages/commerce/simulator.mts';import {CustomerAccess} from './packages/commerce/customer-access.mts';
 import {ReadContext} from './packages/commerce/read-context.mts';import {loadSkillDirectory} from './packages/commerce/skills.mts';
 import {startCommerceServer} from './apps/commerce-api/server.mts';
 const db=new DatabaseSync(':memory:'),k=new CommerceKernel(db),caps=new Capabilities(k),sim=new StoreSimulator(k,caps),reads=new ReadContext(k,caps);
 k.provisionStore('t','s');k.provisionMember('t','s','a');const bearer=k.issueSession('t','s','a'),scope=k.authenticate(bearer);sim.reset(scope);
 const skill=loadSkillDirectory(process.cwd()+'/packages/commerce/skill-bundles/order-status');reads.skills.install(scope,skill);
 reads.profiles.put(scope,{id:'default',revision:1,tenant_id:'t',store_id:'s',skill_id:skill.id,skill_digest:skill.digest,tone:'neutral',locale:'en-US',actions:['order.status','skill.read'],data_scope:{order:'session_or_store',knowledge:'visible_only'}});
 const task=reads.createTask(scope,{order_id:k.lookup(scope,'order','synthetic','ORD-1001').id,profile_id:'default'});
 const server=await startCommerceServer({kernel:k,caps,simulator:sim,customers:new CustomerAccess(k,()=>{}),reads});
 console.log(JSON.stringify({url:server.url,bearer,task:task.id}));process.on('SIGTERM',async()=>{await server.close();db.close();});`);
 const {spawn}=await import('node:child_process');const processChild=spawn(process.execPath,['--experimental-strip-types','start.mts'],{cwd:root,stdio:['ignore','pipe','pipe']});
 let text='',errors='';processChild.stderr.on('data',b=>errors+=b.toString());
 try {
   const details=await new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('isolated startup timeout')),8000);
     processChild.stdout.on('data',b=>{text+=b.toString();if(text.includes('\n')){clearTimeout(timer);resolve(JSON.parse(text.split('\n')[0]));}});
     processChild.on('exit',code=>{clearTimeout(timer);reject(new Error('isolated startup failed: '+code+' '+errors));});});
   const result=await execute('python3',[join(root,'status_agent.py'),'--base-url',details.url,'--task-id',details.task],{cwd:root,env:{PATH:process.env.PATH,RIFARE_BEARER:details.bearer},timeout:15000});
   assert.equal(JSON.parse(result.stdout).status,'grounded_read');assert.equal(JSON.parse(result.stdout).claims[0].value,'ORD-1001');
 } finally {processChild.kill('SIGTERM');await new Promise<void>(resolve=>processChild.once('exit',()=>resolve()));}
}));
test('M01-G15-PROVIDER-DISABLED-HTTP',()=>useAgent(async f=>{assert.equal((await f.request('/v1/read-tasks/'+f.task.id+'/assist',{configuration_id:'invented'})).status,503);
 const facts=await(await f.request('/v1/orders/'+f.order().id+'/status')).json();assert.equal(facts.order.number,'ORD-1001');}));
