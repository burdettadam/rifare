import { digest, exact } from '../commerce/kernel.mts';
import { ConfigurationError, contentDigest, jsonValue } from '../commerce/configuration-values.mts';
import { MAX_EVIDENCE_BYTES, validateEvidencePng } from '../commerce/return-evidence.mts';
import { DEFAULT_DECISION_CAPABILITIES, validateDecisionRequest, validateDecisionResult, unusableDecision } from './decisions.mts';
import type { DecisionEvidenceKind, DecisionFailure, DecisionQuestionType, DecisionRequest, DecisionResult, DecisionServing, DecisionUsage } from './decisions.mts';

export const IMAGE_ADAPTER='cloudflare-image-decision-v1';
export const IMAGE_MODEL='@cf/cloudflare/clef-omni';
const SELECTOR='clef-omni';
const TRANSFORMATION='restricted_png_identity_v1';
const MAX_WIRE_BYTES=400000;
const MAX_RESPONSE_BYTES=131072;
const IMAGE_TOKENS=1024;
const MARKER_TOKENS=512;
const MAX_TIMEOUT_MS=2000;

/** A separate media envelope; never pass this object as text DecisionCapabilities. */
export type ImageReaderCapabilities={
  readonly question_types:readonly DecisionQuestionType[];
  readonly input_modalities:readonly ['text','image'];readonly image_mime_types:readonly ['image/png'];
  readonly max_context_tokens:number;readonly max_request_bytes:number;readonly max_wire_bytes:number;
  readonly max_questions:number;readonly max_choice_options:number;readonly max_score_levels:number;
  readonly max_images:1;readonly max_image_bytes:number;readonly max_image_pixels:number;
  readonly image_token_allowance:number;readonly marker_token_allowance:number;
  readonly transformation:typeof TRANSFORMATION;readonly max_reported_output_tokens:number;
};
export type ImageReaderOptions={
  serving_configuration_ref:string;account_id:string;approved_account_ids:readonly string[];
  model_id:string;approved_model_ids:readonly string[];fixtureTransport?:typeof fetch;
  timeout_ms?:number;max_response_bytes?:number;
};
export type ImageReaderInput={
  request:DecisionRequest;
  image:{mime:'image/png';base64:string;sha256:string;source_sha256:string;transformation:typeof TRANSFORMATION};
  expected_configuration_digest:string;guard:()=>void;signal:AbortSignal;
};
export type ImageReader={
  readonly provider:'cloudflare';readonly capabilities:ImageReaderCapabilities;
  readonly evidence_kind:DecisionEvidenceKind;readonly configuration_digest:string;
  readonly serving_configuration_ref:string;
  execute:(credential:Buffer,input:unknown)=>Promise<DecisionResult>;
};
const capabilities:ImageReaderCapabilities=Object.freeze({
  question_types:DEFAULT_DECISION_CAPABILITIES.question_types,
  input_modalities:Object.freeze(['text','image'] as const),image_mime_types:Object.freeze(['image/png'] as const),
  max_context_tokens:DEFAULT_DECISION_CAPABILITIES.max_context_tokens,
  max_request_bytes:DEFAULT_DECISION_CAPABILITIES.max_request_bytes,max_wire_bytes:MAX_WIRE_BYTES,
  max_questions:DEFAULT_DECISION_CAPABILITIES.max_questions,max_choice_options:DEFAULT_DECISION_CAPABILITIES.max_choice_options,
  max_score_levels:DEFAULT_DECISION_CAPABILITIES.max_score_levels,
  max_images:1,max_image_bytes:MAX_EVIDENCE_BYTES,max_image_pixels:4000000,
  image_token_allowance:IMAGE_TOKENS,marker_token_allowance:MARKER_TOKENS,
  transformation:TRANSFORMATION,max_reported_output_tokens:MAX_RESPONSE_BYTES
});
const readers=new WeakSet<object>();
export function isImageReader(value:unknown):value is ImageReader {
  return !!value&&typeof value==='object'&&readers.has(value);
}
// Both identities are weak keys. Retaining a result must not retain the input's
// base64, case state, guard closure or signal through a provenance record.
const resultsByInvocation=new WeakMap<object,WeakMap<object,ImageReader>>();
export function verifyImageReaderResult(reader:ImageReader,invocation:unknown,result:unknown):boolean {
  if(!isImageReader(reader)||!invocation||typeof invocation!=='object'||!result||typeof result!=='object')return false;
  return resultsByInvocation.get(invocation)?.get(result)===reader;
}
function freezeResult<T>(value:T):T {
  if(value&&typeof value==='object'){Object.values(value).forEach(freezeResult);Object.freeze(value);}return value;
}
function issuedResult(reader:ImageReader,invocation:unknown,result:DecisionResult):DecisionResult {
  freezeResult(result);
  if(invocation&&typeof invocation==='object'){
    let issued=resultsByInvocation.get(invocation);
    if(!issued){issued=new WeakMap<object,ImageReader>();resultsByInvocation.set(invocation,issued);}
    issued.set(result,reader);
  }
  return result;
}
const identifier=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_.-]{1,100}$/.test(value)
  &&!['__proto__','constructor','prototype'].includes(value);
const sha256=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const abortedGetter=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted')!.get!;
const signalAborted=(signal:AbortSignal):boolean=>abortedGetter.call(signal);
class TransportFailure extends Error {
  readonly code:DecisionFailure;
  constructor(code:DecisionFailure){super(code);this.code=code;}
}
function dataRecord(value:unknown,required:string[],optional:string[]=[]):Record<string,any> {
  if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value))
    ||required.some(key=>!Object.hasOwn(value,key))||Reflect.ownKeys(value).length!==Object.keys(value).length
    ||Object.keys(value).some(key=>![...required,...optional].includes(key)
      ||!Object.hasOwn(Object.getOwnPropertyDescriptor(value,key)!,'value')))throw new Error('DECISION_REQUEST_INVALID');
  return value as Record<string,any>;
}
function wireRecord(value:unknown,required:string[],optional:string[]=[]):Record<string,any> {
  if(!value||typeof value!=='object'||Array.isArray(value)||required.some(key=>!Object.hasOwn(value,key))
    ||Object.keys(value).some(key=>![...required,...optional].includes(key)))throw new TransportFailure('DECISION_OUTPUT_INVALID');
  return value as Record<string,any>;
}
function requestFailure(error:unknown):DecisionFailure {
  if(error instanceof Error&&['DECISION_CONTEXT_LIMIT','DECISION_CAPABILITY_UNAVAILABLE'].includes(error.message))return error.message as DecisionFailure;
  if(error instanceof ConfigurationError&&error.issues.some(issue=>issue.code==='TOO_LARGE'))return 'DECISION_CONTEXT_LIMIT';
  return 'DECISION_REQUEST_INVALID';
}

function validatedImage(value:unknown):string {
  const image=dataRecord(value,['mime','base64','sha256','source_sha256','transformation']);
  if(image.mime!=='image/png'||image.transformation!==TRANSFORMATION||!sha256(image.sha256)||!sha256(image.source_sha256)
    ||image.sha256!==image.source_sha256||typeof image.base64!=='string'||image.base64.length>349528)throw new Error('DECISION_REQUEST_INVALID');
  const bytes=Buffer.from(image.base64,'base64');
  try {
    if(bytes.length>MAX_EVIDENCE_BYTES||bytes.toString('base64')!==image.base64||digest(bytes)!==image.sha256)throw new Error('DECISION_REQUEST_INVALID');
    validateEvidencePng(bytes);
    return image.base64;
  } finally {bytes.fill(0);}
}
function encodedBody(request:DecisionRequest,image:string):string {
  const questions=Object.fromEntries(Object.entries(request.questions).map(([id,question])=>[id,
    question.type==='noul'?{type:'noul',instructions:question.instructions}:
      {type:question.type,instructions:question.instructions,criteria:question.type==='choice'?question.options:question.levels}]));
  const logicalWire={model:SELECTOR,state:request.state,questions};
  // Count every UTF-8 byte of the complete mapped text/questions as a token.
  // This conservative profile reserves the documented image maximum and markers;
  // it is not an observed tokenizer count or a model-quality qualification.
  if(Buffer.byteLength(JSON.stringify(logicalWire))+IMAGE_TOKENS+MARKER_TOKENS>capabilities.max_context_tokens)throw new Error('DECISION_CONTEXT_LIMIT');
  const encoded=JSON.stringify({...logicalWire,images:['data:image/png;base64,'+image]});
  if(Buffer.byteLength(encoded)>MAX_WIRE_BYTES)throw new Error('DECISION_CONTEXT_LIMIT');
  return encoded;
}

function nativeResult(request:DecisionRequest,wire:unknown,evidenceKind:DecisionEvidenceKind):DecisionResult {
  let usage:DecisionUsage|null=null,serving:DecisionServing={reported_model:null,revision:null};
  try {
    const envelope=wireRecord(jsonValue(wire,MAX_RESPONSE_BYTES),['success','result'],['errors','messages']);
    if(envelope.success!==true)return unusableDecision('DECISION_UNAVAILABLE',evidenceKind);
    for(const key of ['errors','messages'])if(Object.hasOwn(envelope,key)&&(!Array.isArray(envelope[key])||envelope[key].length))throw new TransportFailure('DECISION_OUTPUT_INVALID');
    const result=wireRecord(envelope.result,['answers'],['model','usage']);
    if(result.model!==undefined&&result.model!==null){
      if(result.model!==SELECTOR&&result.model!==IMAGE_MODEL)throw new TransportFailure('DECISION_OUTPUT_INVALID');
      serving={reported_model:result.model,revision:null};
    }
    if(result.usage!==undefined&&result.usage!==null){
      const reported=exact(result.usage,['input_tokens','output_tokens']);
      if(!Number.isSafeInteger(reported.input_tokens)||reported.input_tokens<0||reported.input_tokens>capabilities.max_context_tokens
        ||!Number.isSafeInteger(reported.output_tokens)||reported.output_tokens<0||reported.output_tokens>capabilities.max_reported_output_tokens)throw new TransportFailure('DECISION_OUTPUT_INVALID');
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

export function imageReader(options:ImageReaderOptions):ImageReader {
  const supplied=dataRecord(options,['serving_configuration_ref','account_id','approved_account_ids','model_id','approved_model_ids'],
    ['fixtureTransport','timeout_ms','max_response_bytes']);
  const fixtureTransport=supplied.fixtureTransport;
  if(fixtureTransport!==undefined&&typeof fixtureTransport!=='function')throw new Error('DECISION_REQUEST_INVALID');
  let config:Record<string,any>;
  try {
    config=jsonValue({serving_configuration_ref:supplied.serving_configuration_ref,account_id:supplied.account_id,
      approved_account_ids:supplied.approved_account_ids,model_id:supplied.model_id,approved_model_ids:supplied.approved_model_ids,
      timeout_ms:supplied.timeout_ms===undefined?MAX_TIMEOUT_MS:supplied.timeout_ms,
      max_response_bytes:supplied.max_response_bytes===undefined?MAX_RESPONSE_BYTES:supplied.max_response_bytes});
    if(!identifier(config.serving_configuration_ref)||typeof config.account_id!=='string'||!/^[a-f0-9]{32}$/.test(config.account_id)
      ||typeof config.model_id!=='string'||!Number.isSafeInteger(config.timeout_ms)||config.timeout_ms<1||config.timeout_ms>MAX_TIMEOUT_MS
      ||!Number.isSafeInteger(config.max_response_bytes)||config.max_response_bytes<1||config.max_response_bytes>MAX_RESPONSE_BYTES)throw new Error();
    for(const key of ['approved_account_ids','approved_model_ids']){
      const values=config[key];
      if(!Array.isArray(values)||values.length>64||new Set(values).size!==values.length||values.some((value:unknown)=>typeof value!=='string'
        ||(key==='approved_account_ids'?!/^[a-f0-9]{32}$/.test(value):!/^[A-Za-z0-9@/_.:-]{1,160}$/.test(value))))throw new Error();
      values.sort();
    }
  } catch {throw new Error('DECISION_REQUEST_INVALID');}
  if(config.model_id!==IMAGE_MODEL||!config.approved_account_ids.includes(config.account_id)||!config.approved_model_ids.includes(config.model_id))throw new Error('DECISION_DESTINATION_UNAPPROVED');
  const evidenceKind:DecisionEvidenceKind=fixtureTransport?'synthetic_wire_fixture':'live_test_unqualified';
  const endpoint='https://api.cloudflare.com/client/v4/accounts/'+config.account_id+'/ai/run/'+IMAGE_MODEL;
  const configurationDigest=contentDigest({contract:'image-reader.v1',adapter:IMAGE_ADAPTER,provider:'cloudflare',...config,
    endpoint,selector:SELECTOR,capabilities,evidence_kind:evidenceKind,live_transport_available:false});
  const servingConfigurationRef=config.serving_configuration_ref,timeoutMs=config.timeout_ms,maxResponseBytes=config.max_response_bytes;
  const reader:ImageReader={provider:'cloudflare',capabilities,evidence_kind:evidenceKind,
    serving_configuration_ref:servingConfigurationRef,configuration_digest:configurationDigest,
    execute:async(credential,input):Promise<DecisionResult>=>{
      let boundInvocation=input;
      const issued=(result:DecisionResult)=>issuedResult(reader,boundInvocation,result);
      let request:DecisionRequest|undefined,encoded='',secret='',guard:()=>void,callerSignal:AbortSignal;
      try {
        // These are trusted process-local callbacks, not JSON. Validate every
        // own data property before separately copying the logical JSON request.
        const invocation=dataRecord(input,['request','image','expected_configuration_digest','guard','signal']);
        if(!sha256(invocation.expected_configuration_digest)||typeof invocation.guard!=='function'
          ||!(invocation.signal instanceof AbortSignal))throw new Error('DECISION_REQUEST_INVALID');
        signalAborted(invocation.signal);guard=invocation.guard;callerSignal=invocation.signal;
        if(invocation.expected_configuration_digest!==configurationDigest)return issued(unusableDecision('DECISION_CONFIGURATION_CHANGED',evidenceKind));
        request=validateDecisionRequest(invocation.request);
        if(request.serving_configuration_ref!==servingConfigurationRef)return issued(unusableDecision('DECISION_CONFIGURATION_CHANGED',evidenceKind));
        encoded=encodedBody(request,validatedImage(invocation.image));
      } catch(error){return issued(unusableDecision(requestFailure(error),evidenceKind));}
      input=undefined;
      // There is deliberately no global fetch reference, fallback or live flag.
      if(!fixtureTransport)return issued(unusableDecision('DECISION_CAPABILITY_UNAVAILABLE',evidenceKind));
      if(!Buffer.isBuffer(credential)||credential.length>4096)return issued(unusableDecision('DECISION_CREDENTIAL_UNAVAILABLE',evidenceKind));
      secret=credential.toString('utf8');
      if(!/^[\x21-\x7e]{1,4096}$/.test(secret))return issued(unusableDecision('DECISION_CREDENTIAL_UNAVAILABLE',evidenceKind));

      const controller=new AbortController(),deadline=performance.now()+timeoutMs;
      let timedOut=false,callerAborted=false,closed=false,guardFailed=false,guardError:unknown;
      let responseReader:ReadableStreamDefaultReader<Uint8Array>|undefined;
      let timer:ReturnType<typeof setTimeout>|undefined;
      const chunks:Buffer[]=[];
      const checkGuard=()=>{try{guard();}catch(error){guardFailed=true;guardError=error;throw error;}};
      const checkpoint=()=>{
        if(closed)throw new TransportFailure(callerAborted?'DECISION_AUTHORITY_CHANGED':timedOut?'DECISION_TIMEOUT':'DECISION_UNAVAILABLE');
        checkGuard();
        if(signalAborted(callerSignal)){callerAborted=true;controller.abort();throw new TransportFailure('DECISION_AUTHORITY_CHANGED');}
        if(performance.now()>=deadline){timedOut=true;controller.abort();throw new TransportFailure('DECISION_TIMEOUT');}
      };
      let rejectCancellation!:(reason:unknown)=>void;
      const cancellation=new Promise<never>((_,reject)=>{rejectCancellation=reject;});
      const onAbort=()=>{callerAborted=true;controller.abort();rejectCancellation(new TransportFailure('DECISION_AUTHORITY_CHANGED'));};
      EventTarget.prototype.addEventListener.call(callerSignal,'abort',onAbort,{once:true});
      const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{
        timedOut=true;controller.abort();reject(new TransportFailure('DECISION_TIMEOUT'));
      },timeoutMs);});
      const cancelBody=(response:Response)=>{try{void response.body?.cancel().catch(()=>{});}catch{}};
      try {
        const pending=(async()=>{
          checkpoint();
          const response:Response=await fixtureTransport(endpoint,{method:'POST',redirect:'error',signal:controller.signal,
            headers:{'content-type':'application/json',authorization:'Bearer '+secret},body:encoded});
          try {
            checkpoint();
            if(!(response instanceof Response)||response.status!==200||response.redirected||(response.url&&response.url!==endpoint))throw new TransportFailure('DECISION_UNAVAILABLE');
            const reportedSize=response.headers.get('content-length');
            if(reportedSize!==null){
              if(!/^[0-9]+$/.test(reportedSize)||!Number.isSafeInteger(Number(reportedSize)))throw new TransportFailure('DECISION_OUTPUT_INVALID');
              if(Number(reportedSize)>maxResponseBytes)throw new TransportFailure('DECISION_RESPONSE_LIMIT');
            }
            const bodyReader=response.body?.getReader();
            if(!bodyReader)throw new TransportFailure('DECISION_OUTPUT_INVALID');
            responseReader=bodyReader;let size=0;
            while(true){
              const {value,done}=await bodyReader.read();checkpoint();
              if(done)break;
              if(!(value instanceof Uint8Array))throw new TransportFailure('DECISION_OUTPUT_INVALID');
              size+=value.byteLength;if(size>maxResponseBytes)throw new TransportFailure('DECISION_RESPONSE_LIMIT');
              chunks.push(Buffer.from(value));
            }
            const joined=Buffer.concat(chunks);let wire:unknown;
            try{wire=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(joined));}
            catch{throw new TransportFailure('DECISION_OUTPUT_INVALID');}
            finally{joined.fill(0);}
            checkpoint();return nativeResult(request!,wire,evidenceKind);
          } catch(error){if(!responseReader)cancelBody(response);throw error;}
        })();
        const result=await Promise.race([pending,timeout,cancellation]);checkpoint();return issued(result);
      } catch(error){
        // Authority failures retain the exact trusted exception. Turning a
        // revoked task into an ordinary late model result would lose its fence.
        if(guardFailed)throw guardError;
        checkGuard();
        const reason=callerAborted||signalAborted(callerSignal)?'DECISION_AUTHORITY_CHANGED':timedOut?'DECISION_TIMEOUT':
          error instanceof TransportFailure?error.code:'DECISION_UNAVAILABLE';
        return issued(unusableDecision(reason,evidenceKind));
      } finally {
        closed=true;if(timer!==undefined)clearTimeout(timer);
        EventTarget.prototype.removeEventListener.call(callerSignal,'abort',onAbort);
        controller.abort();
        // A fixture that ignores cancellation cannot extend the return deadline.
        try{void responseReader?.cancel().catch(()=>{});}catch{}
        responseReader=undefined;for(const chunk of chunks)chunk.fill(0);chunks.length=0;
        request=undefined;encoded='';secret='';guard=()=>{};callerSignal=controller.signal;boundInvocation=undefined;
      }
    }
  };
  Object.freeze(reader);readers.add(reader);return reader;
}
