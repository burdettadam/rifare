import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFixture } from './read-workflow-helpers.mts';
import { LocalModel } from '../../packages/agent/local-model.mts';
import { ReadRunner } from '../../packages/agent/runner.mts';
export async function localFixture() {
  const f=readFixture();f.reads.profiles.put(f.a.scope,f.profile());
  const task=f.reads.createTask(f.a.scope,{order_id:f.order().id,profile_id:'default'}),requests:any[]=[];
  const digest='sha256:'+'a'.repeat(64),model='fixture-local:1';let mutate:(x:any,path:string,body:any)=>any=x=>x;
  let responseStatus=200,delayMs=0;
  const server=createServer(async(req,res)=>{
    const chunks=[];for await(const c of req)chunks.push(c);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):null;
    requests.push({path:req.url,body,headers:req.headers});
    if(delayMs)await new Promise(r=>setTimeout(r,delayMs));
    let result:any;
    if(req.url==='/api/tags')result={models:[{name:model,digest,size:12345}]};
    else {const tool=body.messages.filter((m:any)=>m.role==='tool').at(-1),catalog=tool?JSON.parse(tool.content):null;
      result={model,done:true,done_reason:'stop',message:{role:'assistant',content:'',tool_calls:[{function:{name:catalog?'finish_status':'read_order_status',
        arguments:catalog?{source_digest:catalog.digest,fact_ids:catalog.required}:{}}}]},prompt_eval_count:100,eval_count:10};}
    res.writeHead(responseStatus,{'content-type':'application/json','location':'https://not-permitted.invalid/'});
    res.end(JSON.stringify(mutate(result,req.url!,body)));
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address() as any;
  const config={endpoint:`http://127.0.0.1:${address.port}`,model,model_digest:digest,cloud_disabled:true,timeout_ms:2000,context_tokens:32768};
  const local=new LocalModel(config),rc={id:'local',tenant_id:f.a.tenant,store_id:f.a.store,provider:'ollama' as const,model,secret_ref:null,
    capabilities:['tool_calls','fact_selection','stateless'],max_rounds:4,max_output_tokens:512,evidence_kind:'synthetic_wire_fixture' as const};
  const make=(opts={})=>new ReadRunner(f.kernel,f.reads,null as any,[rc],{[JSON.stringify([f.a.tenant,f.a.store,'local'])]:new LocalModel({...config,...opts})});
  return {...f,local,config,rc,task,requests,make,runner:make(),mutate:(fn:typeof mutate)=>mutate=fn,status:(n:number)=>responseStatus=n,delay:(n:number)=>delayMs=n,
    cleanup:async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));f.cleanup();}};
}
export async function useLocal(fn:(f:Awaited<ReturnType<typeof localFixture>>)=>unknown){const f=await localFixture();try{return await fn(f);}finally{await f.cleanup();}}
