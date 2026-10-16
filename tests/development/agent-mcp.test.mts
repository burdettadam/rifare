import test from 'node:test';import assert from 'node:assert/strict';
import { useAgent } from './agent-helpers.mts';
import { ReadMcp,MCP_VERSION } from '../../packages/agent/mcp.mts';
const tools=['read_task','order_status','skill_content','knowledge_search','knowledge_get'];
async function client(f:any,names=tools) {
  const r=await f.request('/v1/mcp-grants',{task_id:f.task.id,tools:names});assert.equal(r.status,201);const grant=await r.json();
  let next=1;
  const call=async(method:string,params:any={},extra:any={})=>{
    const response=await fetch(f.server.url+'/mcp',{method:'POST',headers:{authorization:'Bearer '+grant.token,
      'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':MCP_VERSION,...extra},
      body:JSON.stringify({jsonrpc:'2.0',id:next++,method,params})});return {response,data:await response.json()};};
  const init=await call('initialize',{protocolVersion:MCP_VERSION,capabilities:{},clientInfo:{name:'test',version:'1'}});assert.equal(init.data.result.protocolVersion,MCP_VERSION);
  return {grant,call};
}
test('CASE-M01-G11-01',()=>useAgent(async f=>{
  const c=await client(f);const result=await c.call('tools/call',{name:'order_status',arguments:{task_id:f.task.id,order_id:f.order().id}});
  const canonical=await(await f.request('/v1/orders/'+f.order().id+'/status')).json();assert.deepEqual(result.data.result.structuredContent,canonical);
  assert.equal(result.data.result.isError,false);assert.equal(JSON.stringify(result.data).includes(f.a.bearer),false);
}));
test('CASE-M01-G11-02',()=>useAgent(async f=>{
  const c=await client(f);assert.equal((await c.call('tools/list',{}, {authorization:'Bearer '+f.a.bearer})).response.status,403);
  assert.equal((await f.request('/v1/read-tasks/'+f.task.id,undefined,c.grant.token)).status,403);
  const other=new ReadMcp(f.kernel,f.reads);const wrong=other.issue(f.a.scope,{task_id:f.task.id,tools},'http://127.0.0.1:1/mcp');
  assert.throws(()=>other.authenticate(wrong.token,'http://127.0.0.1:2/mcp'),/ACCESS_DENIED/);
}));
test('CASE-M01-G11-03',()=>useAgent(async f=>{
  const c=await client(f);const listed=(await c.call('tools/list')).data.result.tools;
  assert.equal(listed.length,5);assert.ok(listed.every((t:any)=>t.annotations.readOnlyHint));
  const old=await c.call('tools/call',{name:'refund_order',arguments:{task_id:f.task.id}});assert.equal(old.data.error.code,-32602);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM commerce_audit').get().n,0);
}));
test('M01-G11-TASK-BOUND',()=>useAgent(async f=>{const c=await client(f);
  const r=await c.call('tools/call',{name:'order_status',arguments:{task_id:'other',order_id:f.order().id}});assert.equal(r.data.error.code,-32602);
  const b=await c.call('tools/call',{name:'order_status',arguments:{task_id:f.task.id,order_id:f.order(f.b).id}});assert.equal(b.data.result.isError,true);
}));
test('M01-G11-REVOKED-PARENT',()=>useAgent(async f=>{const c=await client(f);f.kernel.revoke(f.a.scope);assert.equal((await c.call('tools/list')).response.status,403);}));
test('M01-G11-EXPIRY',()=>useAgent(async f=>{const c=await client(f);f.advance(300001);assert.equal((await c.call('tools/list')).response.status,403);}));
test('M01-G11-EXACT-INPUT',()=>useAgent(async f=>{const c=await client(f);const r=await c.call('tools/call',{name:'read_task',arguments:{task_id:f.task.id,secret:true}});assert.equal(r.data.error.code,-32602);}));
test('M01-G11-SCOPED-CATALOG',()=>useAgent(async f=>{const c=await client(f,['read_task']);assert.equal((await c.call('tools/list')).data.result.tools.length,1);
  assert.equal((await c.call('tools/call',{name:'knowledge_search',arguments:{task_id:f.task.id,query:'shipping'}})).data.error.code,-32602);}));
test('M01-G11-PROFILE-RECHECK',()=>useAgent(async f=>{const c=await client(f);f.reads.profiles.put(f.a.scope,f.profile(f.a,{revision:2,actions:['order.status']}));assert.notEqual((await c.call('tools/list')).response.status,200);}));
test('M01-G11-SKILL-PARITY',()=>useAgent(async f=>{const c=await client(f);const r=await c.call('tools/call',{name:'skill_content',arguments:{task_id:f.task.id,skill_id:'order-status',resource:'SKILL.md',bundle_digest:f.bundle.digest}});
  assert.equal(r.data.result.structuredContent.content,f.bundle.files['SKILL.md']);}));
test('M01-G11-KNOWLEDGE-READ',()=>useAgent(async f=>{const c=await client(f);const r=await c.call('tools/call',{name:'knowledge_search',arguments:{task_id:f.task.id,query:'parcel'}});
  assert.equal(r.data.result.structuredContent.sources[0].id,'shipping');}));
test('M01-G11-NOTIFICATIONS',()=>useAgent(async f=>{const c=await client(f);const r=await fetch(f.server.url+'/mcp',{method:'POST',headers:{authorization:'Bearer '+c.grant.token,'content-type':'application/json',accept:'application/json, text/event-stream','mcp-protocol-version':MCP_VERSION},body:JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})});assert.equal(r.status,202);assert.equal(await r.text(),'');}));
test('M01-G11-HTTP-BOUNDARY',()=>useAgent(async f=>{const c=await client(f);assert.equal((await c.call('tools/list',{}, {origin:'https://untrusted.invalid'})).response.status,403);
 assert.equal((await c.call('tools/list',{}, {'mcp-protocol-version':'future'})).response.status,400);
 assert.equal((await c.call('tools/list',{}, {accept:'application/json'})).response.status,406);
 assert.equal((await fetch(f.server.url+'/mcp',{headers:{authorization:'Bearer '+c.grant.token}})).status,405);}));
test('M01-G11-NO-TOKEN-FORWARDING',()=>useAgent(async f=>{const c=await client(f);let observed:any[]=[];const original=f.reads.taskAction.bind(f.reads);
 f.reads.taskAction=(...args:any[])=>{observed=args;return original(...args as Parameters<typeof original>);};
 await c.call('tools/call',{name:'order_status',arguments:{task_id:f.task.id,order_id:f.order().id}});
 assert.equal(observed.length,4);assert.equal(JSON.stringify(observed).includes(c.grant.token),false);assert.equal(JSON.stringify(observed).includes(f.a.bearer),false);}));
