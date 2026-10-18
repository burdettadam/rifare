/** Procedural TypeScript runtime for the bounded common return continuation API.
 * Credentials arrive on stdin. No provider thread, database or saved checkpoint
 * participates in authorization; every decision starts with server facts.
 */
import { request as httpRequest } from 'node:http';
import { pathToFileURL } from 'node:url';

type Value=Record<string,any>;
const ACTIONS=['approved-preview.execute','resolution.dispatch','resolution.reconcile'];
function configuration(input:Value){
 if(!input||Array.isArray(input)||Object.keys(input).some(k=>!['base_url','grant_token','mode','max_actions'].includes(k)))throw new Error('INVALID_RUNTIME_INPUT');
 const base=new URL(input.base_url),mode=input.mode??'advance',limit=input.max_actions??8;
 if(base.protocol!=='http:'||base.hostname!=='127.0.0.1'||!base.port||base.pathname!=='/'||base.search||base.hash||base.username||base.password||input.base_url!==base.origin)throw new Error('LOCAL_ENDPOINT_REQUIRED');
 if(typeof input.grant_token!=='string'||!/^wrk_[A-Za-z0-9_-]{43}$/.test(input.grant_token)||!['inspect','advance'].includes(mode)||!Number.isInteger(limit)||limit<0||limit>20)throw new Error('INVALID_RUNTIME_INPUT');
 return {base:base.origin,token:input.grant_token,mode,limit};
}
function transport(base:string,token:string){
 return (path:string,body:Value)=>new Promise<any>((resolve,reject)=>{
  const bytes=Buffer.from(JSON.stringify(body));
  const request=httpRequest(new URL(path,base),{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json','content-length':bytes.length}},response=>{
   const chunks:Buffer[]=[];let size=0;
   response.on('data',chunk=>{size+=chunk.length;if(size>300000)request.destroy(new Error('RESPONSE_LIMIT'));else chunks.push(chunk);});
   response.on('error',reject);response.on('end',()=>{
    if(response.statusCode!==200){reject(new Error('RUNTIME_HTTP_DENIED'));return;}
    try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(new Error('INVALID_RUNTIME_RESPONSE'));}
   });
  });
  const timer=setTimeout(()=>request.destroy(new Error('RUNTIME_DEADLINE')),10000);
  request.on('close',()=>clearTimeout(timer));request.on('error',reject);request.end(bytes);
 });
}
function bindings(context:Value){return {case_id:context.envelope.case_id,configuration_digest:context.envelope.configuration_digest,
 skill_digest:context.effective_skill.digest,policy_digest:context.configuration.policy.digest,profile_digest:context.configuration.profile.sha256};}
function check(context:Value,lease:Value,base:string,pins:Value|null){
 const e=context.envelope;
 if(context.contract?.id!=='rifare-common-return-worker'||context.contract.version!=='1.0.0'||context.contract.qualification!=='local_fixture_only'||context.execution_authorized!==false||
   !e||e.audience!==base+'/v1/worker'||e.case_id!==lease.case_id||e.resource_id!==lease.resource_id||e.generation!==lease.generation||e.configuration_digest!==lease.configuration_digest||
   !Number.isSafeInteger(context.observed_at)||!Array.isArray(context.blockers)||!Array.isArray(context.previews)||!Array.isArray(context.operations)||!Array.isArray(context.receipts)||
   !Array.isArray(context.allowed_actions)||context.allowed_actions.some((a:any)=>!ACTIONS.includes(a))||typeof context.effective_skill?.files?.['SKILL.md']!=='string')throw new Error('CONTEXT_MISMATCH');
 const current=bindings(context);
 for(const field of ['configuration_digest','skill_digest','policy_digest','profile_digest'])if(!/^[a-f0-9]{64}$/.test(current[field]))throw new Error('CONTEXT_MISMATCH');
 if(pins&&JSON.stringify(current)!==JSON.stringify(pins))throw new Error('CONTEXT_CHANGED');return current;
}
function summary(context:Value){return {return_request:context.return_request,previews:context.previews,receipts:context.receipts,operations:context.operations,blockers:context.blockers};}
export async function runReturnRuntime(input:Value){
 const config=configuration(input),post=transport(config.base,config.token),lease=await post('/v1/worker/claim',{lease_ms:30000});
 let context=await post('/v1/worker/return-context',{generation:lease.generation}),pins=check(context,lease,config.base,null),stop='action_limit';
 const trace:Value[]=[],lookedUp=new Set<string>();
 if(config.mode==='inspect')stop='inspection_only';
 else for(let count=0;count<config.limit;count++){
  let action:string|null=null,args:Value={};
  if(context.blockers.length){
   const blocker=context.blockers[0],operation=context.operations.find((op:Value)=>op.id===blocker.id);
   if(!operation||!context.allowed_actions.includes('resolution.reconcile')){stop='reconciliation_requires_authorized_worker';break;}
   if(lookedUp.has(operation.id)){stop='unknown_outcome';break;}
   action='resolution.reconcile';args={operation_id:operation.id};
  }else{
   const approved=context.previews.find((p:Value)=>p.receipt_id===null&&p.configuration_digest===pins.configuration_digest&&p.policy_digest===pins.policy_digest&&p.expires_at>context.observed_at&&
     p.approval?.authority_current&&!p.approval.revoked&&p.approval.uses===0&&p.approval.max_uses===1&&p.approval.expires_at>context.observed_at);
   const ready=context.operations.find((op:Value)=>op.state==='authorized');
   const pending=context.operations.find((op:Value)=>['accepted','manual_external_settlement_pending'].includes(op.state)&&!lookedUp.has(op.id));
   if(approved){action='approved-preview.execute';args={preview_id:approved.id,preview_digest:approved.digest,approval_id:approved.approval.id};}
   else if(ready){action='resolution.dispatch';args={operation_id:ready.id};}
   else if(pending){action='resolution.reconcile';args={operation_id:pending.id};}
   else{stop=context.previews.some((p:Value)=>!p.receipt_id)?'approval_or_repreview_required':context.operations.some((op:Value)=>['accepted','manual_external_settlement_pending'].includes(op.state))?'source_pending':'no_pending_action';break;}
  }
  if(!context.allowed_actions.includes(action)){stop='current_authority_required';break;}
  const result=await post('/v1/worker/return-action',{generation:lease.generation,envelope:context.envelope,action,arguments:args});
  trace.push({action,...args,...(result.receipt?{receipt_id:result.receipt.id,replayed:result.replayed}:{state:result.operation.state})});
  if(action==='resolution.reconcile')lookedUp.add(args.operation_id);
  context=await post('/v1/worker/return-context',{generation:lease.generation});check(context,lease,config.base,pins);
 }
 return {schema_version:1,runtime_id:'rifare-typescript-procedural-v1',generation:lease.generation,...pins,stop_reason:stop,actions:trace,state:summary(context),
  execution_performed:trace.length>0,provider_thread_used:false,qualification:'local_fixture_only'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const parts:Buffer[]=[];let length=0;for await(const value of process.stdin){const part=Buffer.from(value);length+=part.length;if(length>10000)throw new Error('INPUT_LIMIT');parts.push(part);}
  process.stdout.write(JSON.stringify(await runReturnRuntime(JSON.parse(Buffer.concat(parts).toString('utf8'))))+'\n');
 }catch{process.stderr.write(JSON.stringify({error:'RETURN_RUNTIME_FAILED'})+'\n');process.exitCode=1;}
}
