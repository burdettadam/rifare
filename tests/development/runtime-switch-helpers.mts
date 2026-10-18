import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { exact } from '../../packages/commerce/kernel.mts';
import { WorkerApi } from '../../packages/commerce/worker-api.mts';

/** A real loopback HTTP contract harness around the canonical WorkerApi.
 * It is separate from served commerce-app/browser qualification.
 */
export async function runtimeHarness(f:any,caseId='resolution_case'){
 const api=new WorkerApi(f.kernel,{resolutionExecution:f.executor??null}),trace:any[]=[];let audience='';
 const server=createServer(async(req,res)=>{
  const reply=(status:number,body:any)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(body));};
  try{
   if(req.method!=='POST')throw new Error('METHOD_NOT_ALLOWED');
   const auth=req.headers.authorization;if(typeof auth!=='string'||!auth.startsWith('Bearer '))throw new Error('ACCESS_DENIED');
   const value=auth.slice(7);api.leases.authenticate(value,audience);
   let raw='';for await(const data of req){raw+=data;if(Buffer.byteLength(raw)>10000)throw new Error('BODY_LIMIT');}
   const input=JSON.parse(raw);trace.push({path:req.url,generation:input.generation??null,action:input.action??null,operation_id:input.arguments?.operation_id??null});
   let result:any;
   if(req.url==='/v1/worker/claim')result=api.leases.claim(value,audience,exact(input,['lease_ms']).lease_ms);
   else if(req.url==='/v1/worker/return-context')result=api.returnContext(value,audience,exact(input,['generation']).generation);
   else if(req.url==='/v1/worker/return-action')result=await api.returnAction(value,audience,input);
   else throw new Error('NOT_FOUND');
   reply(200,result);
  }catch(error){reply(403,{error:error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'REQUEST_REJECTED'});}
 });
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve());});
 const address=server.address();if(!address||typeof address==='string')throw new Error('ADDRESS_UNAVAILABLE');
 const url='http://127.0.0.1:'+address.port;audience=url+'/v1/worker';
 const grant=(scope=f.a.scope)=>api.leases.issue(scope,{case_id:caseId,lifetime_ms:100000},audience);
 const close=()=>new Promise<void>((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections();});
 const context=(g:any,generation:number)=>api.returnContext(g.token,audience,generation);
 const action=(g:any,generation:number,action:string,args:any)=>api.returnAction(g.token,audience,{generation,envelope:context(g,generation).envelope,action,arguments:args});
 return {api,url,audience,trace,grant,context,action,close};
}

export async function runtimeClient(language:'typescript'|'python',server:any,grant:any,extra:any={}){
 const command=language==='typescript'?process.execPath:'python3',args=language==='typescript'?['--experimental-strip-types','clients/return_runtime.mts']:['-I','clients/return_runtime.py'];
 return new Promise<any>((resolve,reject)=>{
  const child=spawn(command,args,{cwd:process.cwd(),stdio:['pipe','pipe','pipe'],env:{PATH:process.env.PATH}});let out='',err='';
  const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('RUNTIME_CHILD_DEADLINE'));},20000);
  child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',e=>{clearTimeout(timer);reject(e);});
  child.on('close',code=>{clearTimeout(timer);if(code!==0){reject(new Error('RUNTIME_CHILD_FAILED '+err));return;}try{const result=JSON.parse(out);if(out.includes(grant.token))throw new Error('CREDENTIAL_EXPOSED');resolve(result);}catch(error){reject(error);}});
  child.stdin.end(JSON.stringify({base_url:server.url,grant_token:grant.token,...extra}));
 });
}

export function secondOperator(f:any){
 f.kernel.provisionMember(f.a.tenant,f.a.store,'second-runtime-operator','operator');
 const bearer=f.kernel.issueSession(f.a.tenant,f.a.store,'second-runtime-operator');return {scope:f.kernel.authenticate(bearer),bearer};
}
