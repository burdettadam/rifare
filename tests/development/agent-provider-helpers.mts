import { randomBytes } from 'node:crypto';
import { readFixture } from './read-workflow-helpers.mts';
import { SecretVault } from '../../packages/commerce/secrets.mts';
import { ReadRunner } from '../../packages/agent/runner.mts';
import { ADAPTER_NAMES,providerReader } from '../../packages/agent/providers.mts';
import type { Provider } from '../../packages/agent/providers.mts';
export function modelFixture() {
  const f=readFixture();f.reads.profiles.put(f.a.scope,f.profile());f.reads.profiles.put(f.b.scope,f.profile(f.b));
  const task=f.reads.createTask(f.a.scope,{order_id:f.order().id,profile_id:'default'}),key=randomBytes(32),requests:any[]=[];
  let mutate:((response:any,provider:Provider,body:any)=>any)|undefined;
  let before:((provider:Provider,body:any)=>unknown)|undefined;
  const wire=(provider:Provider)=>(async(url:any,init:any)=>{
    const body=JSON.parse(init.body);requests.push({url,headers:init.headers,body,provider});await before?.(provider,body);
    let catalog:any;
    if(provider==='openai'){
      const results=body.input.filter((x:any)=>x.type==='function_call_output');if(results.length)catalog=JSON.parse(results.at(-1).output);
    }else{const last=body.messages.at(-1);if(Array.isArray(last.content)&&last.content[0]?.type==='tool_result')catalog=JSON.parse(last.content[0].content);}
    const name=catalog?'finish_status':'read_order_status',args=catalog?{source_digest:catalog.digest,fact_ids:catalog.required}:{};
    const call=provider+'_'+requests.length;
    let result=provider==='openai'?{id:'private_response_do_not_store',status:'completed',output:[{type:'function_call',call_id:call,name,arguments:JSON.stringify(args)}],usage:{input_tokens:10,output_tokens:5}}:
      {id:'private_message_do_not_store',stop_reason:'tool_use',content:[{type:'tool_use',id:call,name,input:args}],usage:{input_tokens:10,output_tokens:5}};
    result=mutate?.(result,provider,body)??result;
    return new Response(JSON.stringify(result),{status:200,headers:{'content-type':'application/json'}});
  }) as typeof fetch;
  const names=['fixture-a','fixture-b'];
  const vault=new SecretVault(f.kernel,{activeId:'local-key',get:()=>Buffer.from(key)},{},
    { [ADAPTER_NAMES.openai]:providerReader('openai',{fixtureTransport:wire('openai'),approvedModels:[names[0]]}),
      [ADAPTER_NAMES.anthropic]:providerReader('anthropic',{fixtureTransport:wire('anthropic'),approvedModels:[names[1]]})});
  const configs=(['openai','anthropic'] as const).map((provider,i)=>({id:provider,tenant_id:f.a.tenant,store_id:f.a.store,provider,model:names[i],
    secret_ref:vault.put(f.a.scope,{provider,adapter:ADAPTER_NAMES[provider],value:provider+'-synthetic-key'}).ref,
    capabilities:['tool_calls','fact_selection','stateless'],max_rounds:4,max_output_tokens:512,evidence_kind:'synthetic_wire_fixture' as const}));
  const runner=new ReadRunner(f.kernel,f.reads,vault,configs);
  return {...f,task,requests,vault,configs,runner,setMutate:(fn:typeof mutate)=>mutate=fn,setBefore:(fn:typeof before)=>before=fn,
    cleanup(){key.fill(0);f.cleanup();}};
}
export async function useModel(fn:(f:ReturnType<typeof modelFixture>)=>unknown) {
  const f=modelFixture();try{return await fn(f);}finally{f.cleanup();}
}
