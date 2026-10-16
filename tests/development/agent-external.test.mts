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
