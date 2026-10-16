import { request } from 'node:http';
import { exact, integer } from '../commerce/kernel.mts';
import { STATUS_TOOLS } from './facts.mts';
import type { ModelRequest, ModelStep } from './providers.mts';

export type LocalModelConfig={endpoint:string;model:string;model_digest:string;cloud_disabled:boolean;timeout_ms:number;context_tokens:number};
export function localConfig(input:unknown):Readonly<LocalModelConfig> {
  const c=exact(input,['endpoint','model','model_digest','cloud_disabled','timeout_ms','context_tokens']);
  if(typeof c.endpoint!=='string'||!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(c.endpoint))throw new Error('LOCAL_ENDPOINT_REQUIRED');
  const port=Number(c.endpoint.split(':').at(-1));if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('LOCAL_ENDPOINT_REQUIRED');
  if(typeof c.model!=='string'||!/^[a-zA-Z0-9_.:-]{1,120}$/.test(c.model)||/cloud/i.test(c.model)
    ||typeof c.model_digest!=='string'||!/^sha256:[a-f0-9]{64}$/.test(c.model_digest)||c.cloud_disabled!==true)throw new Error('LOCAL_MODEL_NOT_PINNED');
  integer(c.timeout_ms,50);integer(c.context_tokens,1024);
  if(c.timeout_ms>120000||c.context_tokens>131072)throw new Error('LOCAL_LIMIT_INVALID');
  return Object.freeze({...c}) as Readonly<LocalModelConfig>;
}
export class LocalModel {
  readonly config:Readonly<LocalModelConfig>;
  constructor(input:unknown){this.config=localConfig(input);}
  async #request(path:'/api/tags'|'/api/chat',payload:unknown,deadline:number):Promise<any> {
    const remaining=deadline-Date.now();if(remaining<=0)throw new Error('LOCAL_MODEL_TIMEOUT');
    const data=payload===null?null:Buffer.from(JSON.stringify(payload));
    if(data&&data.length>128*1024)throw new Error('LOCAL_INPUT_TOO_LARGE');
    // Literal loopback address; Node HTTP does not consume proxy env vars or follow redirects.
    return await new Promise((resolve,reject)=>{
      const req=request(this.config.endpoint+path,{method:data?'POST':'GET',agent:false,
        headers:data?{'content-type':'application/json','content-length':data.length}:{}},res=>{
        if(res.statusCode!==200){res.resume();reject(new Error('LOCAL_MODEL_UNAVAILABLE'));return;}
        let size=0;const parts:Buffer[]=[];
        res.on('data',chunk=>{size+=chunk.length;if(size>128*1024){req.destroy(new Error('LOCAL_OUTPUT_TOO_LARGE'));return;}parts.push(chunk);});
        res.on('error',()=>reject(new Error('LOCAL_MODEL_UNAVAILABLE')));
        res.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(parts).toString('utf8')));}catch{reject(new Error('LOCAL_OUTPUT_INVALID'));}});
      });
      const timer=setTimeout(()=>req.destroy(new Error('LOCAL_MODEL_TIMEOUT')),remaining);
      req.on('close',()=>clearTimeout(timer));req.on('error',error=>reject(new Error(error.message==='LOCAL_MODEL_TIMEOUT'?'LOCAL_MODEL_TIMEOUT':'LOCAL_MODEL_UNAVAILABLE')));
      req.end(data);
    });
  }
  async #identity(deadline:number) {
    const tags=await this.#request('/api/tags',null,deadline);
    if(!Array.isArray(tags?.models))throw new Error('LOCAL_MODEL_NOT_INSTALLED');
    const matches=tags.models.filter((m:any)=>m.name===this.config.model);
    if(matches.length!==1||typeof matches[0].digest!=='string'||matches[0].digest.replace(/^sha256:/,'')!==this.config.model_digest.slice(7)
      ||!Number.isSafeInteger(matches[0].size)||matches[0].size<=0||matches[0].remote_host||matches[0].remote_model)throw new Error('LOCAL_MODEL_IDENTITY_MISMATCH');
    return {model:this.config.model,digest:this.config.model_digest};
  }
  async probe(){return this.#identity(Date.now()+this.config.timeout_ms);}
  async execute(input:ModelRequest):Promise<ModelStep> {
    const c=this.config;
    if(input.model!==c.model||typeof input.instruction!=='string'||!Array.isArray(input.turns)||input.turns.length>4)throw new Error('LOCAL_MODEL_IDENTITY_MISMATCH');
    integer(input.max_output_tokens,64);if(input.max_output_tokens>2048)throw new Error('LOCAL_LIMIT_INVALID');
    const deadline=Date.now()+c.timeout_ms;await this.#identity(deadline);
    const messages:any[]=[{role:'system',content:input.instruction},{role:'user',content:JSON.stringify(input.context)}];
    for(const turn of input.turns){
      if(turn.calls.length!==turn.results.length)throw new Error('LOCAL_INPUT_INVALID');
      messages.push({role:'assistant',content:'',tool_calls:turn.calls.map(x=>({function:{name:x.name,arguments:x.arguments}}))});
      for(const [i,call] of turn.calls.entries())messages.push({role:'tool',tool_name:call.name,content:JSON.stringify(turn.results[i])});
    }
    // Conservatively reject overlarge context; no silent history truncation or fallback.
    if(Buffer.byteLength(JSON.stringify(messages))+input.max_output_tokens>c.context_tokens)throw new Error('LOCAL_CONTEXT_LIMIT');
    const value=await this.#request('/api/chat',{model:c.model,messages,stream:false,
      options:{temperature:0,seed:0,num_ctx:c.context_tokens,num_predict:input.max_output_tokens},
      tools:STATUS_TOOLS.map(t=>({type:'function',function:{name:t.name,description:t.description,parameters:t.schema}}))},deadline);
    await this.#identity(deadline);
    if(value?.model!==c.model||value.remote_host||value.remote_model)throw new Error('LOCAL_MODEL_IDENTITY_MISMATCH');
    if(value.done!==true||value.done_reason!=='stop'||value.message?.role!=='assistant'
      ||value.message.content?.trim()||!Array.isArray(value.message.tool_calls)||!value.message.tool_calls.length)return {calls:[],usage:null,stop:'handoff'};
    if(value.message.tool_calls.length>4)throw new Error('LOCAL_OUTPUT_INVALID');
    const calls=value.message.tool_calls.map((call:any,i:number)=>{
      if(typeof call?.function?.name!=='string'||call.function.name.length>80||!call.function.arguments
        ||typeof call.function.arguments!=='object'||Array.isArray(call.function.arguments))throw new Error('LOCAL_OUTPUT_INVALID');
      return {id:`local_${input.turns.length}_${i}`,name:call.function.name,arguments:call.function.arguments};
    });
    let usage=null;
    if(value.prompt_eval_count!==undefined&&value.eval_count!==undefined)usage={input_tokens:integer(value.prompt_eval_count),output_tokens:integer(value.eval_count)};
    return {calls,usage,stop:'tools'};
  }
}
