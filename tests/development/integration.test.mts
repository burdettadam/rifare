import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fixture, git, start, api, until, command } from './helpers.mts';
import { listen } from '../../packages/development/http.mts';

test('CASE-M00-G05-01 smoke: two clean linked worktrees isolate records, queues, attachments and shutdown', async()=>{
  const f=fixture();const second=join(f.temporary,'second');git(f.root,'worktree','add','-b','second',second);
  let a:any,b:any,restarted:any;
  try {
    a=await start(f.root);b=await start(second);
    assert.notEqual(a.run.instance_id,b.run.instance_id);
    assert.equal(new Set([a.run.api_port,a.run.ui_port,a.run.control_port,b.run.api_port,b.run.ui_port,b.run.control_port]).size,6);
    for(const [instance,value] of [[a,'ALPHA'],[b,'BETA']] as const) {
      assert.equal((await api(instance.run,'/dev/markers',{id:'same-id',value})).status,201);
      assert.equal((await api(instance.run,'/dev/jobs',{id:'same-job',value})).status,202);
      await until(async()=> (await (await api(instance.run,'/dev/state')).json()).jobs[0]?.state==='completed');
      const state=await (await api(instance.run,'/dev/state')).json();
      assert.deepEqual(state.markers,[{id:'same-id',value}]);assert.equal(state.jobs[0].value,value);
      const attachment=await(await api(instance.run,'/dev/attachments/same-job')).json();
      assert.equal(attachment.value,value);assert.equal(attachment.instance_id,instance.run.instance_id);
      const disk=JSON.parse(readFileSync(join(instance.config.attachments,'same-job.json'),'utf8'));
      assert.deepEqual(disk,attachment);
      const ui=await fetch(`http://127.0.0.1:${instance.run.ui_port}/api/dev/state`);
      assert.deepEqual((await ui.json()).markers,[{id:'same-id',value}]);
    }
    await a.stop(); assert.equal(existsSync(a.config.runFile),false);
    await assert.rejects(fetch(`http://127.0.0.1:${a.run.api_port}/health`));
    assert.equal((await api(b.run,'/dev/markers',{id:'still-alive',value:'BETA'})).status,201);
    restarted=await start(f.root);
    assert.equal((await(await api(restarted.run,'/dev/state')).json()).markers[0].value,'ALPHA');
    assert.equal((await(await api(b.run,'/dev/state')).json()).markers.length,2);
  } finally {if(a)await a.forceStop();if(b)await b.forceStop();if(restarted)await restarted.forceStop();f.cleanup();}
});
test('CASE-M00-G05-02 smoke: no secrets required and a production-bound request performs no network effect',async()=>{
  const f=fixture();let runtime:any;let hits=0;const trap=createServer((_q,r)=>{hits++;r.end('unexpected effect');});const port=await listen(trap,0);
  try {
    runtime=await start(f.root);
    for(const url of [`http://127.0.0.1:${port}/payment`,'https://production.example.invalid/refund']) {
      const result=await api(runtime.run,'/dev/external-probe',{url});
      assert.equal(result.status,403);assert.equal((await result.json()).error,'EXTERNAL_EFFECT_DENIED');
    }
    await delay(100);assert.equal(hits,0);
    assert.equal((await(await api(runtime.run,'/dev/state')).json()).commerce_qualified,false);
    assert.ok(!runtime.output().includes(runtime.run.secret));
  } finally {if(runtime)await runtime.forceStop();trap.closeAllConnections();await new Promise<void>(r=>trap.close(()=>r()));f.cleanup();}
});
test('CASE-M00-G05-03 smoke: clean clone installs the dependency-free lock offline, migrates and serves',async()=>{
  const f=fixture();let runtime:any;
  try {
    const clone=join(f.temporary,'clone');git(f.root,'clone','--no-local',f.root,clone);
    const lock=readFileSync(join(clone,'package-lock.json'),'utf8');
    const cache=join(f.temporary,'empty-npm-cache');mkdirSync(cache);
    const installed=command(clone,'npm',['ci','--offline','--ignore-scripts','--cache',cache]);
    assert.equal(installed.status,0,installed.stderr);assert.equal(readFileSync(join(clone,'package-lock.json'),'utf8'),lock);
    const migrated=command(clone,process.execPath,['--experimental-strip-types','tools/dev-migrate.mts']);assert.equal(migrated.status,0,migrated.stderr);
    runtime=await start(clone);const state=await(await api(runtime.run,'/dev/state')).json();
    assert.equal(state.migrations.length,1);assert.equal(state.profile,'smoke-sqlite');assert.equal(state.database_engine,'sqlite');
    assert.equal((await fetch(`http://127.0.0.1:${runtime.run.ui_port}/`)).status,200);
  } finally {if(runtime)await runtime.forceStop();f.cleanup();}
});
test('HTTP-01 rejects missing credentials, hostile Origin, forged Host and cross-site requests',async()=>{
  const f=fixture();let runtime:any;try {
    runtime=await start(f.root);
    assert.equal((await api(runtime.run,'/dev/state',undefined,{authorization:''})).status,403);
    assert.equal((await api(runtime.run,'/dev/markers',{id:'x',value:'x'},{origin:'https://evil.example.invalid'})).status,403);
    for (const headers of [{host:'evil.example.invalid'}, {'sec-fetch-site':'cross-site'}]) {
      const status = await new Promise<number | undefined>((resolve,reject) => {
        const req=request({hostname:'127.0.0.1',port:runtime.run.api_port,path:'/dev/state',headers:{authorization:'Bearer '+runtime.run.secret,...headers}},res=>{res.resume();resolve(res.statusCode);});
        req.on('error',reject);req.end();
      });
      assert.equal(status,403);
    }
    assert.equal((await fetch(`http://127.0.0.1:${runtime.run.ui_port}/api/dev/state`,{headers:{origin:'https://evil.example.invalid'}})).status,403);
    assert.deepEqual((await(await api(runtime.run,'/dev/state')).json()).markers,[]);
  }finally{if(runtime)await runtime.forceStop();f.cleanup();}
});
test('HTTP-02 UI proxy refuses arbitrary routes and does not expose repository files or local secrets',async()=>{
  const f=fixture();let runtime:any;try{
    runtime=await start(f.root);
    for(const path of ['/package.json','/.git/config','/runtime/instance.json','/api/https://example.invalid/','/api/dev/attachments/../escape'])assert.equal((await fetch(`http://127.0.0.1:${runtime.run.ui_port}${path}`)).status,404);
    const index=await fetch(`http://127.0.0.1:${runtime.run.ui_port}/`);assert.match(index.headers.get('content-security-policy')!,/connect-src 'self'/);assert.ok(!(await index.text()).includes(runtime.run.secret));
  }finally{if(runtime)await runtime.forceStop();f.cleanup();}
});
test('HTTP-03 unknown fields and oversized requests cannot enqueue arbitrary work',async()=>{
  const f=fixture();let runtime:any;try{
    runtime=await start(f.root);
    assert.equal((await api(runtime.run,'/dev/jobs',{id:'j',value:'x',url:'https://example.invalid/'})).status,400);
    assert.equal((await api(runtime.run,'/dev/jobs',{id:'j',value:'x'.repeat(5000)})).status,400);
    assert.deepEqual((await(await api(runtime.run,'/dev/state')).json()).jobs,[]);
  }finally{if(runtime)await runtime.forceStop();f.cleanup();}
});
test('LIFE-01 a duplicate start cannot overwrite ownership or stop the first instance',async()=>{
  const f=fixture();let runtime:any;try{
    runtime=await start(f.root);const before=readFileSync(runtime.config.runFile,'utf8');
    await assert.rejects(start(f.root),/INSTANCE_ALREADY_RESERVED/);
    assert.equal(readFileSync(runtime.config.runFile,'utf8'),before);assert.equal((await api(runtime.run,'/dev/state')).status,200);
  }finally{if(runtime)await runtime.forceStop();f.cleanup();}
});
test('LIFE-02 copying another worktree stop record never authorizes stopping it',async()=>{
  const f=fixture();const second=join(f.temporary,'second');git(f.root,'worktree','add','-b','second',second);let a:any,b:any;let saved='';
  try{a=await start(f.root);b=await start(second);saved=readFileSync(a.config.runFile,'utf8');writeFileSync(a.config.runFile,readFileSync(b.config.runFile));const stopped=command(f.root,process.execPath,['--experimental-strip-types','tools/dev-stop.mts']);assert.equal(stopped.status,1);assert.equal((await api(b.run,'/dev/state')).status,200);writeFileSync(a.config.runFile,saved);}
  finally{if(a){if(saved)writeFileSync(a.config.runFile,saved);await a.forceStop();}if(b)await b.forceStop();f.cleanup();}
});
test('LIFE-03 an occupied API port fails safely without killing the unrelated listener',async()=>{
  const f=fixture();const innocent=createServer((_q,r)=>r.end('still-alive'));const port=await listen(innocent,0);
  try{await assert.rejects(start(f.root,{RIFARE_API_PORT:String(port)}),/START_FAILED|SERVICE_START_FAILED|LOCAL_RESOURCE_ERROR/);assert.equal(await(await fetch(`http://127.0.0.1:${port}`)).text(),'still-alive');}
  finally{innocent.closeAllConnections();await new Promise<void>(r=>innocent.close(()=>r()));f.cleanup();}
});
