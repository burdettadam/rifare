import { exact } from '../commerce/kernel.mts';
import { ConfigurationError, contentDigest, jsonValue } from '../commerce/configuration-values.mts';
import type { CredentialReader } from '../commerce/secrets.mts';
import { validateDecisionCapabilities, validateDecisionRequest, validateDecisionResult, unusableDecision } from './decisions.mts';
import type { DecisionCapabilities, DecisionEvidenceKind, DecisionFailure, DecisionRequest, DecisionResult, DecisionServing, DecisionUsage } from './decisions.mts';

export const WORKERS_AI_ADAPTER='cloudflare-decision-v1';
export const WORKERS_AI_MODEL='@cf/cloudflare/clef-flash';
const SELECTOR='clef-flash';
const MAX_RESPONSE_BYTES=128*1024;
export type WorkersAIReaderOptions={
  serving_configuration_ref:string;account_id:string;approved_account_ids:readonly string[];
  model_id:string;approved_model_ids:readonly string[];fixtureTransport?:typeof fetch;allowLiveTest?:boolean;
  capabilities?:Partial<DecisionCapabilities>;timeout_ms?:number;max_response_bytes?:number;
};
export type WorkersAIReader=Omit<CredentialReader,'execute'>&{
  readonly capabilities:DecisionCapabilities;readonly evidence_kind:DecisionEvidenceKind;
  readonly serving_configuration_ref:string;readonly configuration_digest:string;
  execute:(credential:Buffer,input:unknown)=>Promise<DecisionResult>;
};
class TransportFailure extends Error {
  readonly code:DecisionFailure;
  constructor(code:DecisionFailure){super(code);this.code=code;}
}
function shape(value:unknown,required:string[],optional:string[]=[]):Record<string,any> {
  if(!value||typeof value!=='object'||Array.isArray(value)
    ||required.some(key=>!Object.hasOwn(value,key))||Object.keys(value).some(key=>![...required,...optional].includes(key)))throw new TransportFailure('DECISION_OUTPUT_INVALID');
  return value as Record<string,any>;
}
function nativeResult(request:DecisionRequest,wire:unknown,evidenceKind:DecisionEvidenceKind):DecisionResult {
  let usage:DecisionUsage|null=null,serving:DecisionServing={reported_model:null,revision:null};
  try {
    const envelope=shape(jsonValue(wire,MAX_RESPONSE_BYTES),['success','result'],['errors','messages']);
    if(envelope.success!==true)return unusableDecision('DECISION_UNAVAILABLE',evidenceKind);
    for(const key of ['errors','messages'])if(Object.hasOwn(envelope,key)&&(!Array.isArray(envelope[key])||envelope[key].length))throw new TransportFailure('DECISION_OUTPUT_INVALID');
    const result=shape(envelope.result,['answers'],['model','usage']);
    if(result.model!==undefined&&result.model!==null){
      if(result.model!==SELECTOR&&result.model!==WORKERS_AI_MODEL)throw new TransportFailure('DECISION_OUTPUT_INVALID');
      serving={reported_model:result.model,revision:null};
    }
    if(result.usage!==undefined&&result.usage!==null){
      const reported=exact(result.usage,['input_tokens','output_tokens']);
      if(!Number.isSafeInteger(reported.input_tokens)||reported.input_tokens<0||!Number.isSafeInteger(reported.output_tokens)||reported.output_tokens<0)throw new TransportFailure('DECISION_OUTPUT_INVALID');
      usage={input_tokens:reported.input_tokens,output_tokens:reported.output_tokens};
    }
    const answers=exact(result.answers,Object.keys(request.questions)),normalized:Record<string,any>={};
    for(const [questionId,question] of Object.entries(request.questions)){
      const answer=answers[questionId];
      if(!answer||answer.type!==question.type)throw new TransportFailure('DECISION_OUTPUT_INVALID');
      if(question.type==='noul'){
        exact(answer,['type','noul']);normalized[questionId]={type:'noul',probability_true:answer.noul};
      } else if(question.type==='choice'){
        exact(answer,['type','choice','probabilities','confidence']);
        normalized[questionId]={type:'choice',choice:answer.choice,probabilities:answer.probabilities,
          confidence:{provider:'cloudflare',metric:'provider_reported',value:answer.confidence}};
      } else {
        exact(answer,['type','score','legend','probabilities','confidence']);
        const legend=exact(answer.legend,question.levels.map((_,index)=>String(index)));
        if(question.levels.some((level,index)=>legend[String(index)]!==level))throw new TransportFailure('DECISION_OUTPUT_INVALID');
        normalized[questionId]={type:'score',score:answer.score,probabilities:answer.probabilities,
          confidence:{provider:'cloudflare',metric:'provider_reported',value:answer.confidence}};
      }
    }
    return validateDecisionResult(request,{status:'usable',answers:normalized,reason:null,usage,serving,evidence_kind:evidenceKind});
  } catch {return unusableDecision('DECISION_OUTPUT_INVALID',evidenceKind,serving,usage);}
}
function body(request:DecisionRequest) {
  const questions=Object.fromEntries(Object.entries(request.questions).map(([id,question])=>[id,
    question.type==='noul'?{type:'noul',instructions:question.instructions}:
      {type:question.type,instructions:question.instructions,criteria:question.type==='choice'?question.options:question.levels}]));
  return {model:SELECTOR,state:request.state,questions};
}
function requestFailure(error:unknown):DecisionFailure {
  if(error instanceof Error&&['DECISION_CONTEXT_LIMIT','DECISION_CAPABILITY_UNAVAILABLE'].includes(error.message))return error.message as DecisionFailure;
  if(error instanceof ConfigurationError&&error.issues.some(issue=>issue.code==='TOO_LARGE'))return 'DECISION_CONTEXT_LIMIT';
  return 'DECISION_REQUEST_INVALID';
}

export function workersAIReader(options:WorkersAIReaderOptions):WorkersAIReader {
  const allowedFields=['serving_configuration_ref','account_id','approved_account_ids','model_id','approved_model_ids',
    'fixtureTransport','allowLiveTest','capabilities','timeout_ms','max_response_bytes'];
  if(!options||typeof options!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(options))
    ||Reflect.ownKeys(options).length!==Object.keys(options).length||Object.keys(options).some(key=>!allowedFields.includes(key)
      ||!Object.hasOwn(Object.getOwnPropertyDescriptor(options,key)!,'value')))throw new Error('DECISION_REQUEST_INVALID');
  const fixtureTransport=options.fixtureTransport,liveEnabled=options.allowLiveTest===true;
  if(fixtureTransport!==undefined&&typeof fixtureTransport!=='function'
    ||options.allowLiveTest!==undefined&&typeof options.allowLiveTest!=='boolean')throw new Error('DECISION_REQUEST_INVALID');
  let config:any;
  try {
    config=jsonValue({serving_configuration_ref:options.serving_configuration_ref,account_id:options.account_id,
      approved_account_ids:options.approved_account_ids,model_id:options.model_id,approved_model_ids:options.approved_model_ids,
      timeout_ms:options.timeout_ms??10000,max_response_bytes:options.max_response_bytes??MAX_RESPONSE_BYTES});
    if(typeof config.serving_configuration_ref!=='string'||!/^[A-Za-z0-9_.-]{1,100}$/.test(config.serving_configuration_ref)
      ||['__proto__','constructor','prototype'].includes(config.serving_configuration_ref)
      ||typeof config.account_id!=='string'||!/^[a-f0-9]{32}$/.test(config.account_id)
      ||typeof config.model_id!=='string'||!Number.isSafeInteger(config.timeout_ms)||config.timeout_ms<1||config.timeout_ms>10000
      ||!Number.isSafeInteger(config.max_response_bytes)||config.max_response_bytes<256||config.max_response_bytes>MAX_RESPONSE_BYTES)throw new Error();
    for(const key of ['approved_account_ids','approved_model_ids']){
      const values=config[key];
      if(!Array.isArray(values)||values.length>64||new Set(values).size!==values.length||values.some((value:unknown)=>typeof value!=='string'
        ||(key==='approved_account_ids'?!/^[a-f0-9]{32}$/.test(value):!/^[A-Za-z0-9@/_.:-]{1,160}$/.test(value))))throw new Error();
      values.sort();
    }
  } catch {throw new Error('DECISION_REQUEST_INVALID');}
  if(config.model_id!==WORKERS_AI_MODEL||!config.approved_account_ids.includes(config.account_id)||!config.approved_model_ids.includes(config.model_id))throw new Error('DECISION_DESTINATION_UNAPPROVED');
  const capabilities=validateDecisionCapabilities(options.capabilities),evidenceKind:DecisionEvidenceKind=fixtureTransport?'synthetic_wire_fixture':'live_test_unqualified';
  const endpoint='https://api.cloudflare.com/client/v4/accounts/'+config.account_id+'/ai/run/'+WORKERS_AI_MODEL;
  const servingConfigurationRef=config.serving_configuration_ref,timeoutMs=config.timeout_ms,maxResponseBytes=config.max_response_bytes;
  const configurationDigest=contentDigest({contract:'decision-model.v1',adapter:WORKERS_AI_ADAPTER,provider:'cloudflare',...config,
    endpoint,selector:SELECTOR,capabilities,evidence_kind:evidenceKind,allow_live_test:liveEnabled});
  const transport=fixtureTransport??fetch;
  const reader:WorkersAIReader={provider:'cloudflare',capabilities,evidence_kind:evidenceKind,
    serving_configuration_ref:servingConfigurationRef,configuration_digest:configurationDigest,
    execute:async(credential,input):Promise<DecisionResult>=>{
      let request:DecisionRequest;
      try {request=validateDecisionRequest(exact(jsonValue(input),['request']).request,capabilities);}
      catch(error){return unusableDecision(requestFailure(error),evidenceKind);}
      if(request.serving_configuration_ref!==servingConfigurationRef)return unusableDecision('DECISION_CONFIGURATION_CHANGED',evidenceKind);
      if(!fixtureTransport&&!liveEnabled)return unusableDecision('DECISION_DISABLED',evidenceKind);
      if(!Buffer.isBuffer(credential)||credential.length>4096)return unusableDecision('DECISION_CREDENTIAL_UNAVAILABLE',evidenceKind);
      const secret=credential.toString('utf8');
      if(!/^[\x21-\x7e]{1,4096}$/.test(secret))return unusableDecision('DECISION_CREDENTIAL_UNAVAILABLE',evidenceKind);
      const encoded=JSON.stringify(body(request));
      if(Buffer.byteLength(encoded)>capabilities.max_request_bytes)return unusableDecision('DECISION_CONTEXT_LIMIT',evidenceKind);
      const controller=new AbortController();let timedOut=false,timer:ReturnType<typeof setTimeout>|undefined;
      let responseReader:ReadableStreamDefaultReader<Uint8Array>|undefined;
      const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{
        timedOut=true;controller.abort();reject(new TransportFailure('DECISION_TIMEOUT'));
      },timeoutMs);});
      try {
        const pending=(async()=>{
          const response=await transport(endpoint,{method:'POST',redirect:'error',signal:controller.signal,
            headers:{'content-type':'application/json',authorization:'Bearer '+secret},body:encoded});
          if(controller.signal.aborted||response.status!==200||response.redirected){
            try{void response.body?.cancel().catch(()=>{});}catch{}
            throw new TransportFailure(timedOut?'DECISION_TIMEOUT':'DECISION_UNAVAILABLE');
          }
          responseReader=response.body?.getReader();if(!responseReader)throw new TransportFailure('DECISION_OUTPUT_INVALID');
          const chunks:Uint8Array[]=[];let size=0;
          while(true){
            const {value,done}=await responseReader.read();
            if(controller.signal.aborted)throw new TransportFailure(timedOut?'DECISION_TIMEOUT':'DECISION_UNAVAILABLE');
            if(done)break;size+=value.length;if(size>maxResponseBytes)throw new TransportFailure('DECISION_RESPONSE_LIMIT');chunks.push(value);
          }
          let value:unknown;
          try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}
          catch{throw new TransportFailure('DECISION_OUTPUT_INVALID');}
          return nativeResult(request,value,evidenceKind);
        })();
        return await Promise.race([pending,timeout]);
      } catch(error){
        const code=timedOut?'DECISION_TIMEOUT':error instanceof TransportFailure?error.code:
          error instanceof Error&&error.name==='TimeoutError'?'DECISION_TIMEOUT':'DECISION_UNAVAILABLE';
        return unusableDecision(code,evidenceKind);
      } finally {
        if(timer!==undefined)clearTimeout(timer);controller.abort();
        // Cleanup cannot extend the finite request deadline, even for a stalled fixture stream.
        try{void responseReader?.cancel().catch(()=>{});}catch{}
      }
    }
  };
  return Object.freeze(reader);
}
