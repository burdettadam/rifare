import { reliabilityFixture } from './reliability-helpers.mts';
import { WorkerApi } from '../../packages/commerce/worker-api.mts';
import { ExecutionStops } from '../../packages/commerce/execution-stops.mts';
import { ExceptionQueue } from '../../packages/commerce/exception-queue.mts';
import { SecretVault } from '../../packages/commerce/secrets.mts';
import { CredentialLifecycle } from '../../packages/commerce/credential-lifecycle.mts';
import { spawn } from 'node:child_process';
export function controlsFixture(){const f=reliabilityFixture(),api=new WorkerApi(f.kernel),stops=new ExecutionStops(f.kernel),audience='http://127.0.0.1:9911/v1/worker';
  const queue=new ExceptionQueue(f.kernel,(t,s,i)=>t===f.a.tenant&&s===f.a.store&&i===f.journal.identity?f.journal:undefined);
  const grant=(scope=f.agent.scope)=>api.leases.issue(scope,{case_id:'case_one',lifetime_ms:120000},audience);
  function claim(scope=f.agent.scope,leaseMs=1000){const g=grant(scope),lease=api.leases.claim(g.token,audience,leaseMs);return {g,lease,context:()=>api.context(g.token,audience,lease.generation)};}
  const submission=(w:ReturnType<typeof claim>,extra={})=>({generation:w.lease.generation,envelope:w.context().envelope,request_key:'proposal-one',proposal:{action:'diagnostic.resolution.set',arguments:{resolution:'refund'}},...extra});
  return {...f,api,stops,audience,grant,claim,submission,queue};
}
export async function usingControls(fn:(f:ReturnType<typeof controlsFixture>)=>unknown){const f=controlsFixture();try{return await fn(f);}finally{f.cleanup();}}
export function credentials(f:ReturnType<typeof controlsFixture>,probe?:(b:Buffer)=>boolean|Promise<boolean>){const one=Buffer.alloc(32,31),two=Buffer.alloc(32,41),seen:string[]=[];
  const keys={activeId:'one',get:(id:string)=>id==='one'?one:id==='two'?two:undefined};
  const vault=new SecretVault(f.kernel,keys,{'local-probe':probe??(b=>{seen.push(b.toString());return true;})});const service=new CredentialLifecycle(f.kernel,vault);
  const put=(value='SYNTHETIC-KEY-ONE',expected_revision=0)=>service.configure(f.owner.scope,{slot_id:'test-model',provider:'synthetic',adapter:'local-probe',value,expected_revision});
  return {vault,keys,one,two,service,seen,put};
}
export async function childJSON(source:string,environment:Record<string,string>){return new Promise<any>((resolve,reject)=>{const p=spawn(process.execPath,['--experimental-strip-types','--input-type=module','-e',source],{cwd:process.cwd(),env:{PATH:process.env.PATH,...environment},stdio:['ignore','pipe','pipe']});let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',reject);p.on('close',c=>{if(c!==0)reject(new Error('CHILD_FAILED '+err));else{try{resolve(JSON.parse(out));}catch(error){reject(error);}}});});}
