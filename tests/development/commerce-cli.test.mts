import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync,readFileSync,existsSync,statSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fixture,git,command,ROOT } from './helpers.mts';
import { configuration,childEnvironment } from '../../packages/development/config.mts';
import { SmokeStore } from '../../packages/development/store.mts';
import { CommerceKernel } from '../../packages/commerce/kernel.mts';

async function launch(root:string){const child=spawn(process.execPath,['--experimental-strip-types','tools/dev-commerce.mts'],{cwd:root,env:childEnvironment(),stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);const ended=new Promise(resolve=>child.once('exit',resolve));const config=configuration(root,{}),file=join(config.dataDir,'commerce-run.json');
 const stop=async()=>{if(child.exitCode===null)child.kill('SIGTERM');await Promise.race([ended,delay(5000).then(()=>{throw new Error('STOP_TIMEOUT');})]);};
 try{for(let i=0;i<100;i++){if(child.exitCode!==null)throw new Error('START_FAILED '+output);if(existsSync(file)&&output.includes('commerce_ready')){const run=JSON.parse(readFileSync(file,'utf8'));return {run,file,config,output:()=>output,stop};}await delay(40);}throw new Error('READY_TIMEOUT');}catch(e){await stop();throw e;}}
async function order(run:any){const r=await fetch(run.url+'/v1/lookup?kind=order&external_id=ORD-1001',{headers:{authorization:'Bearer '+run.operators[0].bearer},signal:AbortSignal.timeout(3000)});assert.equal(r.status,200);return await r.json();}
test('M01-G05-CLI-01',async()=>{const f=fixture();let first:Awaited<ReturnType<typeof launch>>|undefined,second:Awaited<ReturnType<typeof launch>>|undefined,restarted:Awaited<ReturnType<typeof launch>>|undefined;
 try{cpSync(join(ROOT,'tools/dev-commerce.mts'),join(f.root,'tools/dev-commerce.mts'));git(f.root,'add','.');git(f.root,'commit','-qm','Add diagnostic commerce entrypoint to fixture');const other=join(f.temporary,'second');git(f.root,'worktree','add','-b','fixture-second',other,'HEAD');
  assert.equal(command(f.root,'npm',['ci','--offline','--ignore-scripts']).status,0);first=await launch(f.root);second=await launch(other);
  assert.notEqual(first.run.instance_id,second.run.instance_id);assert.notEqual(first.run.url,second.run.url);assert.equal(statSync(first.file).mode&0o777,0o600);assert.equal(first.output().includes(first.run.operators[0].bearer),false);
  const store=new SmokeStore(first.config),kernel=new CommerceKernel(store.db),scope=kernel.authenticate(first.run.operators[0].bearer);const old=kernel.lookup(scope,'order','synthetic','ORD-1001');kernel.ingest(scope,{kind:'order',source_system:'synthetic',external_id:'ORD-1001',source_version:2,source_updated_at:Date.now(),customer_id:'C-1001',payload:{...old.payload,total_minor:77777}});store.close();
  assert.equal((await order(first.run)).payload.total_minor,77777);assert.equal((await order(second.run)).payload.total_minor,12500);
  await first.stop();assert.equal((await order(second.run)).payload.total_minor,12500);restarted=await launch(f.root);assert.equal((await order(restarted.run)).payload.total_minor,77777);
  const stale=await fetch(restarted.run.url+'/v1/capabilities',{headers:{authorization:'Bearer '+first.run.operators[0].bearer}});assert.equal(stale.status,403);
 }finally{await restarted?.stop();await first?.stop();await second?.stop();f.cleanup();}});
