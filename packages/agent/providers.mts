import { exact,integer } from '../commerce/kernel.mts';
import type { CredentialReader } from '../commerce/secrets.mts';
import { STATUS_TOOLS } from './facts.mts';

export type Provider='openai'|'anthropic';
export type Call={id:string;name:string;arguments:unknown};
export type Turn={calls:Call[];results:unknown[]};
export type ModelRequest={model:string;max_output_tokens:number;instruction:string;context:unknown;turns:Turn[]};
export type ModelStep={calls:Call[];usage:{input_tokens:number;output_tokens:number}|null;stop:'tools'|'handoff'};
const ENDPOINTS={openai:'https://api.openai.com/v1/responses',anthropic:'https://api.anthropic.com/v1/messages'};
export const ADAPTER_NAMES={openai:'openai-status-v1',anthropic:'anthropic-status-v1'};
function validRequest(input:unknown):ModelRequest {
  const r=exact(input,['model','max_output_tokens','instruction','context','turns']);
  if(typeof r.model!=='string'||!/^[a-zA-Z0-9._:-]{1,120}$/.test(r.model)||typeof r.instruction!=='string'
    ||r.instruction.length>65536||!Array.isArray(r.turns)||r.turns.length>4)throw new Error('INVALID_INPUT');
  integer(r.max_output_tokens,64);if(r.max_output_tokens>2048||Buffer.byteLength(JSON.stringify(r))>128*1024)throw new Error('INVALID_INPUT');
  for(const t of r.turns){exact(t,['calls','results']);if(!Array.isArray(t.calls)||t.calls.length!==t.results.length||t.calls.length>4)throw new Error('INVALID_INPUT');}
  return r as ModelRequest;
}
export function encodeRequest(provider:Provider,input:unknown) {
  const r=validRequest(input);
  if(provider==='openai') {
    const messages:any[]=[{role:'user',content:JSON.stringify(r.context)}];
    for(const turn of r.turns)for(const [i,c] of turn.calls.entries()){
      messages.push({type:'function_call',call_id:c.id,name:c.name,arguments:JSON.stringify(c.arguments)},
        {type:'function_call_output',call_id:c.id,output:JSON.stringify(turn.results[i])});
    }
    return {model:r.model,instructions:r.instruction,input:messages,store:false,max_output_tokens:r.max_output_tokens,
      parallel_tool_calls:false,tool_choice:'required',tools:STATUS_TOOLS.map(t=>({type:'function',name:t.name,description:t.description,parameters:t.schema,strict:true}))};
  }
  if(provider!=='anthropic')throw new Error('INVALID_PROVIDER');
  const messages:any[]=[{role:'user',content:JSON.stringify(r.context)}];
  for(const t of r.turns)messages.push({role:'assistant',content:t.calls.map(c=>({type:'tool_use',id:c.id,name:c.name,input:c.arguments}))},
    {role:'user',content:t.calls.map((c,i)=>({type:'tool_result',tool_use_id:c.id,content:JSON.stringify(t.results[i])}))});
  return {model:r.model,system:r.instruction,messages,max_tokens:r.max_output_tokens,
    tools:STATUS_TOOLS.map(t=>({name:t.name,description:t.description,input_schema:t.schema})),tool_choice:{type:'any',disable_parallel_tool_use:true}};
}
function callId(value:any) {if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,160}$/.test(value))throw new Error('INVALID_MODEL_OUTPUT');return value;}
export function decodeResponse(provider:Provider,value:any):ModelStep {
  if(!value||typeof value!=='object'||Buffer.byteLength(JSON.stringify(value))>128*1024)throw new Error('INVALID_MODEL_OUTPUT');
  let raw:any[],calls:Call[]=[];
  if(provider==='openai') {
    if(value.status!=='completed'||!Array.isArray(value.output))return {calls:[],usage:null,stop:'handoff'};
    raw=value.output;
    if(raw.some(x=>x.type!=='function_call'&&x.type!=='reasoning'))return {calls:[],usage:null,stop:'handoff'};
    calls=raw.filter(x=>x.type==='function_call').map(x=>({id:callId(x.call_id),name:x.name,arguments:JSON.parse(x.arguments)}));
  } else {
    if(value.stop_reason!=='tool_use'||!Array.isArray(value.content))return {calls:[],usage:null,stop:'handoff'};
    raw=value.content;
    if(raw.some(x=>x.type!=='tool_use'))return {calls:[],usage:null,stop:'handoff'};
    calls=raw.map(x=>({id:callId(x.id),name:x.name,arguments:x.input}));
  }
  if(!calls.length||calls.length>4||new Set(calls.map(c=>c.id)).size!==calls.length||calls.some(c=>typeof c.name!=='string'||c.name.length>80))throw new Error('INVALID_MODEL_OUTPUT');
  let usage=null;
  if(value.usage){integer(value.usage.input_tokens);integer(value.usage.output_tokens);usage={input_tokens:value.usage.input_tokens,output_tokens:value.usage.output_tokens};}
  return {calls,usage,stop:'tools'};
}
export function providerReader(provider:Provider,options:{fixtureTransport?:typeof fetch;allowLiveTest?:boolean;approvedModels?:string[]}={}):CredentialReader {
  if(!Object.hasOwn(ENDPOINTS,provider))throw new Error('INVALID_PROVIDER');
  const allowed=new Set(options.approvedModels??[]);
  return {provider,execute:async(credential,input)=>{
    const r=validRequest(input);
    if(!allowed.has(r.model))throw new Error('MODEL_NOT_APPROVED');
    if(!options.fixtureTransport&&!options.allowLiveTest)throw new Error('EXTERNAL_EFFECT_DENIED');
    const secret=credential.toString('utf8');if(!/^[\x21-\x7e]{1,4096}$/.test(secret))throw new Error('SECRET_UNAVAILABLE');
    const transport=options.fixtureTransport??fetch;
    const response=await transport(ENDPOINTS[provider],{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
      headers:{'content-type':'application/json',...(provider==='openai'?{authorization:'Bearer '+secret}:{'x-api-key':secret,'anthropic-version':'2023-06-01'})},
      body:JSON.stringify(encodeRequest(provider,r))});
    if(response.status!==200){await response.body?.cancel();throw new Error('MODEL_UNAVAILABLE');}
    const reader=response.body?.getReader();let size=0;const chunks:Uint8Array[]=[];
    if(!reader)throw new Error('INVALID_MODEL_OUTPUT');
    try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>128*1024)throw new Error('MODEL_OUTPUT_TOO_LARGE');chunks.push(value);}}
    finally{await reader.cancel();}
    return decodeResponse(provider,JSON.parse(Buffer.concat(chunks).toString('utf8')));
  }};
}
