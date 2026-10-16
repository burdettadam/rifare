import test from 'node:test';import assert from 'node:assert/strict';
import { promisify } from 'node:util';import { execFile } from 'node:child_process';import { fileURLToPath } from 'node:url';
import { useAgent } from './agent-helpers.mts';
const execute=promisify(execFile);
const browser=fileURLToPath(new URL('../browser/manual_component.py',import.meta.url));
async function render(f:any,scenario:string){const child=await execute('python3',[browser],{env:{PATH:process.env.PATH,HOME:process.env.HOME,
  RIFARE_TEST_BROWSER:process.env.RIFARE_BROWSER_EXECUTABLE??'/usr/bin/chromium',RIFARE_TEST_INPUT:JSON.stringify({url:f.server.url,bearer:f.a.bearer,
    order:f.order().id,other:f.order(f.b).id,scenario,facts:f.reads.orderStatus(f.a.scope,f.order().id)})},timeout:20000});return JSON.parse(child.stdout);}
test('CASE-M01-G12-01',()=>useAgent(async f=>{const r=await render(f,'normal');assert.equal(r.order,'ORD-1001');assert.equal(r.model_calls,0);}));
test('CASE-M01-G12-02',()=>useAgent(async f=>{const r=await render(f,'denied');assert.equal(r.previous_facts_visible,false);}));
test('CASE-M01-G12-03',()=>useAgent(async f=>{const r=await render(f,'normal');assert.equal(r.model_calls,0);assert.equal(r.external_requests,0);}));
test('M01-G12-LOGOUT',()=>useAgent(async f=>{const r=await render(f,'logout');assert.equal(r.previous_facts_visible,false);assert.ok(r.logout_requested);}));
test('M01-G12-UNAVAILABLE',()=>useAgent(async f=>{f.reads.orderStatus=()=>({contract_version:'1.0.0',resource_id:f.order().id,status:'stale',order:null,source:{}} as any);
  const r=await render(f,'stale');assert.equal(r.previous_facts_visible,false);}));
test('M01-G12-TEXT-NOT-HTML',()=>useAgent(async f=>{const facts=f.reads.orderStatus(f.a.scope,f.order().id);
  f.reads.orderStatus=()=>({...facts,order:{...facts.order,fulfillment_status:'<img src=x onerror="window.injected=1">'}} as any);
  const r=await render(f,'injection');assert.equal(r.executed_script,false);}));
test('M01-G12-NO-PRIVATE-STORAGE',()=>useAgent(async f=>{const r=await render(f,'normal');assert.equal(r.stored_token,false);assert.equal(r.input_cleared,true);}));
