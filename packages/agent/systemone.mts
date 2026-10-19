import { exact } from '../commerce/kernel.mts';
import { ConfigurationError, contentDigest, jsonValue } from '../commerce/configuration-values.mts';
import { validateDecisionCapabilities, validateDecisionRequest, validateDecisionResult, unusableDecision } from './decisions.mts';
import type { DecisionCapabilities, DecisionEvidenceKind, DecisionFailure, DecisionRequest, DecisionResult, DecisionServing, DecisionUsage } from './decisions.mts';
import type { WorkersAIReader } from './workers-ai.mts';

export const SYSTEMONE_ADAPTER='systemone-decision-v1';
const MAX_CONTEXT_TOKENS=16384;
const MAX_REQUEST_BYTES=8192;
const MAX_RESPONSE_BYTES=128*1024;
export type SystemOneConfidenceProfile='sglang_systemone_adapter_v1'|'clef_reference_top_probability_v1';
export type SystemOneArtifactAttestation={
  model_repository?:string;model_revision?:string;serving_revision?:string;effective_context_tokens?:number;
  backbone_sha256?:string;joint_head_sha256?:string;joint_head_config_sha256?:string;tokenizer_sha256?:string;
  serving_artifact_sha256?:string;loader_observation_sha256?:string;backbone_loaded?:boolean;joint_head_loaded?:boolean;
};
export type SystemOneReadiness={
  readonly status:'missing_evidence'|'attestation_supplied';readonly qualified:false;readonly observed_runtime:false;
  readonly evidence_basis:'supplied_configuration';readonly missing:readonly string[];readonly attestation_digest:string|null;
};
export type SystemOneMetadata={
  readonly adapter:typeof SYSTEMONE_ADAPTER;readonly provider:'systemone';readonly protocol:'systemone.v1';
  readonly model_id:string;readonly model_revision:string|null;readonly serving_revision:string|null;
  readonly effective_context_tokens:number;readonly confidence_profile:SystemOneConfidenceProfile;
  readonly input_modalities:readonly ['text'];readonly context_qualification:'declared_unverified';
  readonly self_hosted_readiness:SystemOneReadiness;
};
export type SystemOneReader=WorkersAIReader&{readonly provider:'systemone';readonly metadata:SystemOneMetadata};
export type SystemOneReaderOptions={
  serving_configuration_ref:string;endpoint:string;approved_endpoints:readonly string[];
  model_id:string;approved_model_ids:readonly string[];model_revision:string|null;serving_revision:string|null;
  effective_context_tokens:number;confidence_profile:SystemOneConfidenceProfile;
  fixtureTransport?:typeof fetch;allowLiveTest?:boolean;capabilities?:Partial<DecisionCapabilities>;
  timeout_ms?:number;max_response_bytes?:number;self_hosted_attestation?:SystemOneArtifactAttestation;
};
const ATTESTATION_FIELDS=['model_repository','model_revision','serving_revision','effective_context_tokens',
  'backbone_sha256','joint_head_sha256','joint_head_config_sha256','tokenizer_sha256','serving_artifact_sha256',
  'loader_observation_sha256','backbone_loaded','joint_head_loaded'];
const HASH_FIELDS=['backbone_sha256','joint_head_sha256','joint_head_config_sha256','tokenizer_sha256',
  'serving_artifact_sha256','loader_observation_sha256'];
const identifier=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_.-]{1,100}$/.test(value)
  &&!['__proto__','constructor','prototype'].includes(value);
const modelId=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9@/_.-]{1,128}$/.test(value);
const revision=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(value);
const digest=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const context=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>=1024&&Number(value)<=MAX_CONTEXT_TOKENS;
function freeze<T>(value:T):T {if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
class TransportFailure extends Error {
  readonly code:DecisionFailure;
  constructor(code:DecisionFailure){super(code);this.code=code;}
}
function shape(value:unknown,required:string[],optional:string[]=[]):Record<string,any> {
  if(!value||typeof value!=='object'||Array.isArray(value)||required.some(key=>!Object.hasOwn(value,key))
    ||Object.keys(value).some(key=>![...required,...optional].includes(key)))throw new Error('DECISION_REQUEST_INVALID');
  return value as Record<string,any>;
}

/** Checks supplied evidence completeness only. No input can create an observed
 * runtime fact, authenticated attestation or self-hosted qualification. */
export function assessSystemOneReadiness(input:unknown):SystemOneReadiness {
  let r:Record<string,any>,attestation:Record<string,any>|null;
  try {
    r=shape(jsonValue(input),['model_id','model_revision','serving_revision','effective_context_tokens'],['self_hosted_attestation']);
    attestation=r.self_hosted_attestation===undefined?null:shape(r.self_hosted_attestation,[],ATTESTATION_FIELDS);
  } catch {throw new Error('DECISION_REQUEST_INVALID');}
  const a=attestation??{},missing:string[]=[];
  if(!['Cloudflare/clef','Cloudflare/clef-flash'].includes(a.model_repository)||a.model_repository!==r.model_id)missing.push('model_repository');
  for(const key of ['model_revision','serving_revision'])if(!revision(r[key])||!revision(a[key])||a[key]!==r[key])missing.push(key);
  if(!context(r.effective_context_tokens)||!context(a.effective_context_tokens)||a.effective_context_tokens!==r.effective_context_tokens)missing.push('effective_context_tokens');
  for(const key of HASH_FIELDS)if(!digest(a[key]))missing.push(key);
  for(const key of ['backbone_loaded','joint_head_loaded'])if(a[key]!==true)missing.push(key);
  return freeze({status:missing.length?'missing_evidence':'attestation_supplied',qualified:false,observed_runtime:false,
    evidence_basis:'supplied_configuration',missing,attestation_digest:attestation===null?null:contentDigest(attestation)} as SystemOneReadiness);
}

function approvedEndpoint(value:unknown):value is string {
  if(typeof value!=='string'||value.length>2048)return false;
  try {const url=new URL(value);return url.protocol==='https:'&&!!url.hostname&&!url.username&&!url.password
    &&url.pathname==='/v1/systemone'&&value===url.origin+'/v1/systemone';}catch{return false;}
}
function requestFailure(error:unknown):DecisionFailure {
  if(error instanceof Error&&['DECISION_CONTEXT_LIMIT','DECISION_CAPABILITY_UNAVAILABLE'].includes(error.message))return error.message as DecisionFailure;
  if(error instanceof ConfigurationError&&error.issues.some(issue=>issue.code==='TOO_LARGE'))return 'DECISION_CONTEXT_LIMIT';
  return 'DECISION_REQUEST_INVALID';
}
function nativeResult(request:DecisionRequest,wire:unknown,model:string,evidenceKind:DecisionEvidenceKind):DecisionResult {
  let serving:DecisionServing={reported_model:null,revision:null},usage:DecisionUsage|null=null;
  try {
    const value=shape(jsonValue(wire,MAX_RESPONSE_BYTES),['model','answers'],['usage']);
    if(value.model!==model)throw new Error('DECISION_OUTPUT_INVALID');
    serving={reported_model:model,revision:null};
    if(value.usage!==undefined&&value.usage!==null){
      const reported=shape(value.usage,[],['input_tokens','output_tokens']);
      for(const key of ['input_tokens','output_tokens'])if(reported[key]!==undefined&&reported[key]!==null
        &&(!Number.isSafeInteger(reported[key])||reported[key]<0))throw new Error('DECISION_OUTPUT_INVALID');
      if(reported.input_tokens!==undefined&&reported.input_tokens!==null&&reported.output_tokens!==undefined&&reported.output_tokens!==null)
        usage={input_tokens:reported.input_tokens,output_tokens:reported.output_tokens};
    }
    const answers=exact(value.answers,Object.keys(request.questions)),normalized:Record<string,any>={};
    for(const [questionId,question] of Object.entries(request.questions)){
      const answer=answers[questionId];
      if(!answer||answer.type!==question.type)throw new Error('DECISION_OUTPUT_INVALID');
      if(question.type==='noul'){
        exact(answer,['type','noul']);normalized[questionId]={type:'noul',probability_true:answer.noul};
      } else if(question.type==='choice'){
        exact(answer,['type','choice','probabilities','confidence']);
        normalized[questionId]={type:'choice',choice:answer.choice,probabilities:answer.probabilities,
          confidence:{provider:'systemone',metric:'provider_reported',value:answer.confidence}};
      } else {
        exact(answer,['type','score','legend','probabilities','confidence']);
        const legend=exact(answer.legend,question.levels.map((_,index)=>String(index)));
        if(question.levels.some((level,index)=>legend[String(index)]!==level))throw new Error('DECISION_OUTPUT_INVALID');
        normalized[questionId]={type:'score',score:answer.score,probabilities:answer.probabilities,
          confidence:{provider:'systemone',metric:'provider_reported',value:answer.confidence}};
      }
    }
    return validateDecisionResult(request,{status:'usable',answers:normalized,reason:null,usage,serving,evidence_kind:evidenceKind});
  } catch {return unusableDecision('DECISION_OUTPUT_INVALID',evidenceKind,serving,usage);}
}
function body(request:DecisionRequest,model:string){
  const questions=Object.fromEntries(Object.entries(request.questions).map(([id,question])=>[id,
    question.type==='noul'?{type:'noul',instructions:question.instructions}:
      {type:question.type,instructions:question.instructions,criteria:question.type==='choice'?question.options:question.levels}]));
  return {model,state:request.state,questions};
}

export function systemOneReader(options:SystemOneReaderOptions):SystemOneReader {
  const allowedFields=['serving_configuration_ref','endpoint','approved_endpoints','model_id','approved_model_ids',
    'model_revision','serving_revision','effective_context_tokens','confidence_profile','fixtureTransport','allowLiveTest',
    'capabilities','timeout_ms','max_response_bytes','self_hosted_attestation'];
  if(!options||typeof options!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(options))
    ||Reflect.ownKeys(options).length!==Object.keys(options).length||Object.keys(options).some(key=>!allowedFields.includes(key)
      ||!Object.hasOwn(Object.getOwnPropertyDescriptor(options,key)!,'value')))throw new Error('DECISION_REQUEST_INVALID');
  const fixtureTransport=options.fixtureTransport,liveEnabled=options.allowLiveTest===true;
  if(fixtureTransport!==undefined&&typeof fixtureTransport!=='function'
    ||options.allowLiveTest!==undefined&&typeof options.allowLiveTest!=='boolean')throw new Error('DECISION_REQUEST_INVALID');
  let config:Record<string,any>;
  try {
    config=jsonValue({serving_configuration_ref:options.serving_configuration_ref,endpoint:options.endpoint,
      approved_endpoints:options.approved_endpoints,model_id:options.model_id,approved_model_ids:options.approved_model_ids,
      model_revision:options.model_revision,serving_revision:options.serving_revision,effective_context_tokens:options.effective_context_tokens,
      confidence_profile:options.confidence_profile,timeout_ms:options.timeout_ms??10000,max_response_bytes:options.max_response_bytes??MAX_RESPONSE_BYTES,
      ...(options.self_hosted_attestation===undefined?{}:{self_hosted_attestation:options.self_hosted_attestation})}) as Record<string,any>;
    if(!identifier(config.serving_configuration_ref)||!modelId(config.model_id)||!context(config.effective_context_tokens)
      ||(config.model_revision!==null&&!revision(config.model_revision))
      ||(config.serving_revision!==null&&!revision(config.serving_revision))
      ||!['sglang_systemone_adapter_v1','clef_reference_top_probability_v1'].includes(config.confidence_profile)
      ||!Number.isSafeInteger(config.timeout_ms)||config.timeout_ms<1||config.timeout_ms>10000
      ||!Number.isSafeInteger(config.max_response_bytes)||config.max_response_bytes<256||config.max_response_bytes>MAX_RESPONSE_BYTES)throw new Error();
    for(const key of ['approved_endpoints','approved_model_ids']){
      const list=config[key];if(!Array.isArray(list)||list.length>64||new Set(list).size!==list.length
        ||list.some((value:unknown)=>typeof value!=='string'||(key==='approved_model_ids'&&!modelId(value))))throw new Error();
      list.sort();
    }
  } catch {throw new Error('DECISION_REQUEST_INVALID');}
  if(!approvedEndpoint(config.endpoint)||!config.approved_endpoints.every(approvedEndpoint)
    ||!config.approved_endpoints.includes(config.endpoint)||!config.approved_model_ids.includes(config.model_id))throw new Error('DECISION_DESTINATION_UNAPPROVED');
  let capabilities:DecisionCapabilities;
  try {
    const overrides=jsonValue(options.capabilities===undefined?{}:options.capabilities);
    if(!overrides||typeof overrides!=='object'||Array.isArray(overrides))throw new Error();
    capabilities=validateDecisionCapabilities({max_context_tokens:config.effective_context_tokens,
      max_request_bytes:Math.min(MAX_REQUEST_BYTES,config.effective_context_tokens-512),...overrides});
    if(capabilities.max_context_tokens>config.effective_context_tokens||capabilities.max_request_bytes>MAX_REQUEST_BYTES)throw new Error();
  } catch {throw new Error('DECISION_REQUEST_INVALID');}
  const readiness=assessSystemOneReadiness({model_id:config.model_id,model_revision:config.model_revision,
    serving_revision:config.serving_revision,effective_context_tokens:config.effective_context_tokens,
    ...(config.self_hosted_attestation===undefined?{}:{self_hosted_attestation:config.self_hosted_attestation})});
  const evidenceKind:DecisionEvidenceKind=fixtureTransport?'synthetic_wire_fixture':'live_test_unqualified';
  const metadata=freeze({adapter:SYSTEMONE_ADAPTER,provider:'systemone',protocol:'systemone.v1',model_id:config.model_id,
    model_revision:config.model_revision,serving_revision:config.serving_revision,effective_context_tokens:config.effective_context_tokens,
    confidence_profile:config.confidence_profile,input_modalities:['text'],context_qualification:'declared_unverified',self_hosted_readiness:readiness} as SystemOneMetadata);
  const configurationDigest=contentDigest({contract:'systemone-decision.v1',adapter:SYSTEMONE_ADAPTER,provider:'systemone',
    ...config,capabilities,metadata,evidence_kind:evidenceKind,allow_live_test:liveEnabled});
  const endpoint=config.endpoint,model=config.model_id,servingConfigurationRef=config.serving_configuration_ref,
    timeoutMs=config.timeout_ms,maxResponseBytes=config.max_response_bytes,transport=fixtureTransport??fetch;
  const reader:SystemOneReader={provider:'systemone',capabilities,evidence_kind:evidenceKind,metadata,
    serving_configuration_ref:servingConfigurationRef,configuration_digest:configurationDigest,
    execute:async(credential,input):Promise<DecisionResult>=>{
      let request:DecisionRequest;
      try {
        const invocation=exact(jsonValue(input),['request','expected_configuration_digest']);
        if(!digest(invocation.expected_configuration_digest))throw new Error('DECISION_REQUEST_INVALID');
        if(invocation.expected_configuration_digest!==configurationDigest)return unusableDecision('DECISION_CONFIGURATION_CHANGED',evidenceKind);
        request=validateDecisionRequest(invocation.request,capabilities);
      } catch(error){return unusableDecision(requestFailure(error),evidenceKind);}
      if(request.serving_configuration_ref!==servingConfigurationRef)return unusableDecision('DECISION_CONFIGURATION_CHANGED',evidenceKind);
      if(!fixtureTransport&&!liveEnabled)return unusableDecision('DECISION_DISABLED',evidenceKind);
      if(!Buffer.isBuffer(credential)||credential.length>4096)return unusableDecision('DECISION_CREDENTIAL_UNAVAILABLE',evidenceKind);
      const secret=credential.toString('utf8');
      if(!/^[\x21-\x7e]{1,4096}$/.test(secret))return unusableDecision('DECISION_CREDENTIAL_UNAVAILABLE',evidenceKind);
      const encoded=JSON.stringify(body(request,model));
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
          return nativeResult(request,value,model,evidenceKind);
        })();
        return await Promise.race([pending,timeout]);
      } catch(error){
        const code=timedOut?'DECISION_TIMEOUT':error instanceof TransportFailure?error.code:
          error instanceof Error&&error.name==='TimeoutError'?'DECISION_TIMEOUT':'DECISION_UNAVAILABLE';
        return unusableDecision(code,evidenceKind);
      } finally {
        if(timer!==undefined)clearTimeout(timer);controller.abort();
        // A stalled upstream or fixture cancellation cannot extend the deadline.
        try{void responseReader?.cancel().catch(()=>{});}catch{}
      }
    }
  };
  return Object.freeze(reader);
}
