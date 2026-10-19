import { exact } from '../commerce/kernel.mts';
import { ConfigurationError, jsonValue } from '../commerce/configuration-values.mts';

export type DecisionQuestionType='choice'|'noul'|'score';
export type DecisionQuestion=
  | {type:'noul';instructions:string}
  | {type:'choice';instructions:string;options:Record<string,string>}
  | {type:'score';instructions:string;levels:string[]};
export type DecisionRequest={
  task_id:string;question_set_id:string;question_set_digest:string;
  serving_configuration_ref:string;state:string;questions:Record<string,DecisionQuestion>;
};
export type DecisionCapabilities={
  readonly question_types:readonly DecisionQuestionType[];
  readonly input_modalities:readonly ['text'];
  readonly max_context_tokens:number;readonly max_request_bytes:number;
  readonly max_questions:number;readonly max_choice_options:number;readonly max_score_levels:number;
};
export type DecisionEvidenceKind='synthetic_wire_fixture'|'live_test_unqualified';
export type DecisionUsage={input_tokens:number;output_tokens:number};
export type DecisionServing={reported_model:string|null;revision:string|null};
export type ProviderConfidence={provider:string;metric:'provider_reported';value:number};
export type DecisionAnswer=
  | {type:'noul';probability_true:number}
  | {type:'choice';choice:string;probabilities:Record<string,number>;confidence:ProviderConfidence}
  | {type:'score';score:number;probabilities:Record<string,number>;confidence:ProviderConfidence};
export const DECISION_FAILURES=Object.freeze([
  'DECISION_REQUEST_INVALID','DECISION_CONTEXT_LIMIT','DECISION_CAPABILITY_UNAVAILABLE',
  'DECISION_OUTPUT_INVALID','DECISION_UNAVAILABLE','DECISION_TIMEOUT','DECISION_RESPONSE_LIMIT',
  'DECISION_DESTINATION_UNAPPROVED','DECISION_DISABLED','DECISION_CREDENTIAL_UNAVAILABLE',
  'DECISION_CONFIGURATION_CHANGED','DECISION_AUTHORITY_CHANGED','DECISION_EVIDENCE_CHANGED'
] as const);
export type DecisionFailure=typeof DECISION_FAILURES[number];
type ResultMetadata={usage:DecisionUsage|null;serving:DecisionServing;evidence_kind:DecisionEvidenceKind};
export type DecisionResult=ResultMetadata&(
  | {status:'usable';answers:Record<string,DecisionAnswer>;reason:null}
  | {status:'unusable';answers:null;reason:DecisionFailure}
);
export type DecisionModelAdapter={
  readonly capabilities:DecisionCapabilities;
  execute:(request:DecisionRequest)=>Promise<DecisionResult>;
};

// A conservative project profile, not a hosted tokenizer or quality qualification.
export const DEFAULT_DECISION_CAPABILITIES:DecisionCapabilities=Object.freeze({
  question_types:Object.freeze(['choice','noul','score'] as const),
  input_modalities:Object.freeze(['text'] as const),
  max_context_tokens:24576,max_request_bytes:16384,max_questions:64,max_choice_options:255,max_score_levels:10
});
export const DECISION_ROUNDING=Object.freeze({decimal_places:4,half_unit:0.00005,epsilon:1e-9});
const REQUEST_FIELDS=['task_id','question_set_id','question_set_digest','serving_configuration_ref','state','questions'];
const RESULT_FIELDS=['status','answers','reason','usage','serving','evidence_kind'];
const CAPABILITY_FIELDS=Object.keys(DEFAULT_DECISION_CAPABILITIES);
const UNKNOWN_SERVING:DecisionServing={reported_model:null,revision:null};
const evidence=(value:unknown):value is DecisionEvidenceKind=>value==='synthetic_wire_fixture'||value==='live_test_unqualified';
const identifier=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_.-]{1,100}$/.test(value)&&!['__proto__','constructor','prototype'].includes(value);
const text=(value:unknown):value is string=>typeof value==='string'&&value.trim().length>0&&value.length<=4096;
const probability=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1;
const record=(value:unknown):value is Record<string,any>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function fail(code:DecisionFailure):never {throw new Error(code);}
function requestError(error:unknown):never {
  if(error instanceof Error&&['DECISION_CONTEXT_LIMIT','DECISION_CAPABILITY_UNAVAILABLE'].includes(error.message))throw error;
  if(error instanceof ConfigurationError&&error.issues.some(issue=>issue.code==='TOO_LARGE'))fail('DECISION_CONTEXT_LIMIT');
  fail('DECISION_REQUEST_INVALID');
}

export function validateDecisionCapabilities(overrides:unknown={}):DecisionCapabilities {
  try {
    const v=jsonValue(overrides);
    if(!record(v)||Object.keys(v).some(key=>!CAPABILITY_FIELDS.includes(key)))fail('DECISION_REQUEST_INVALID');
    const c={...DEFAULT_DECISION_CAPABILITIES,...v};
    if(!Array.isArray(c.question_types)||new Set(c.question_types).size!==c.question_types.length
      ||c.question_types.some((type:unknown)=>!DEFAULT_DECISION_CAPABILITIES.question_types.includes(type as DecisionQuestionType))
      ||!Array.isArray(c.input_modalities)||c.input_modalities.length!==1||c.input_modalities[0]!=='text')fail('DECISION_REQUEST_INVALID');
    for(const key of ['max_context_tokens','max_request_bytes','max_questions','max_choice_options','max_score_levels'] as const){
      const minimum={max_context_tokens:1024,max_request_bytes:256,max_questions:1,max_choice_options:2,max_score_levels:2}[key];
      if(!Number.isSafeInteger(c[key])||c[key]<minimum||c[key]>DEFAULT_DECISION_CAPABILITIES[key])fail('DECISION_REQUEST_INVALID');
    }
    if(c.max_request_bytes+512>c.max_context_tokens)fail('DECISION_REQUEST_INVALID');
    return Object.freeze({...c,question_types:Object.freeze([...c.question_types]),input_modalities:Object.freeze(['text'] as const)}) as DecisionCapabilities;
  } catch {fail('DECISION_REQUEST_INVALID');}
}

export function validateDecisionRequest(input:unknown,capabilities:DecisionCapabilities=DEFAULT_DECISION_CAPABILITIES):DecisionRequest {
  try {
    const c=validateDecisionCapabilities(capabilities),r=exact(jsonValue(input),REQUEST_FIELDS);
    if(!identifier(r.task_id)||!identifier(r.question_set_id)||!identifier(r.serving_configuration_ref)
      ||typeof r.question_set_digest!=='string'||!/^[a-f0-9]{64}$/.test(r.question_set_digest)
      ||typeof r.state!=='string'||!r.state.trim()||!record(r.questions))fail('DECISION_REQUEST_INVALID');
    if(Buffer.byteLength(JSON.stringify(r))>c.max_request_bytes)fail('DECISION_CONTEXT_LIMIT');
    const entries=Object.entries(r.questions);
    if(!entries.length||entries.length>DEFAULT_DECISION_CAPABILITIES.max_questions)fail('DECISION_REQUEST_INVALID');
    if(entries.length>c.max_questions)fail('DECISION_CAPABILITY_UNAVAILABLE');
    for(const [questionId,value] of entries){
      if(!identifier(questionId)||!record(value)||!text(value.instructions))fail('DECISION_REQUEST_INVALID');
      if(!c.question_types.includes(value.type))fail('DECISION_CAPABILITY_UNAVAILABLE');
      if(value.type==='noul')exact(value,['type','instructions']);
      else if(value.type==='choice'){
        exact(value,['type','instructions','options']);
        if(!record(value.options))fail('DECISION_REQUEST_INVALID');
        const options=Object.entries(value.options);
        if(options.length<2||options.length>DEFAULT_DECISION_CAPABILITIES.max_choice_options
          ||options.some(([optionId,description])=>!identifier(optionId)||!text(description)))fail('DECISION_REQUEST_INVALID');
        if(options.length>c.max_choice_options)fail('DECISION_CAPABILITY_UNAVAILABLE');
      } else if(value.type==='score'){
        exact(value,['type','instructions','levels']);
        if(!Array.isArray(value.levels)||value.levels.length<2||value.levels.length>DEFAULT_DECISION_CAPABILITIES.max_score_levels
          ||value.levels.some((level:unknown)=>!text(level)))fail('DECISION_REQUEST_INVALID');
        if(value.levels.length>c.max_score_levels)fail('DECISION_CAPABILITY_UNAVAILABLE');
      } else fail('DECISION_CAPABILITY_UNAVAILABLE');
    }
    return r as DecisionRequest;
  } catch(error){requestError(error);}
}

function checkedUsage(value:unknown):DecisionUsage|null {
  if(value===null)return null;
  const usage=exact(value,['input_tokens','output_tokens']);
  if(!Number.isSafeInteger(usage.input_tokens)||usage.input_tokens<0||!Number.isSafeInteger(usage.output_tokens)||usage.output_tokens<0)fail('DECISION_OUTPUT_INVALID');
  return {input_tokens:usage.input_tokens,output_tokens:usage.output_tokens};
}
function checkedServing(value:unknown):DecisionServing {
  const serving=exact(value,['reported_model','revision']);
  for(const key of ['reported_model','revision'])if(serving[key]!==null&&(typeof serving[key]!=='string'||!/^[A-Za-z0-9@/_.:-]{1,160}$/.test(serving[key])))fail('DECISION_OUTPUT_INVALID');
  return {reported_model:serving.reported_model,revision:serving.revision};
}
function checkedConfidence(value:unknown):ProviderConfidence {
  const confidence=exact(value,['provider','metric','value']);
  if(!identifier(confidence.provider)||confidence.metric!=='provider_reported'||!probability(confidence.value))fail('DECISION_OUTPUT_INVALID');
  return confidence as ProviderConfidence;
}
function distribution(value:unknown,keys:string[]):Record<string,number> {
  if(!record(value)||Object.keys(value).sort().join('\0')!==[...keys].sort().join('\0'))fail('DECISION_OUTPUT_INVALID');
  const values=keys.map(key=>value[key]);
  if(values.some(p=>!probability(p)))fail('DECISION_OUTPUT_INVALID');
  const tolerance=keys.length*DECISION_ROUNDING.half_unit+DECISION_ROUNDING.epsilon;
  if(Math.abs(values.reduce((sum,p)=>sum+p,0)-1)>tolerance)fail('DECISION_OUTPUT_INVALID');
  return value as Record<string,number>;
}

export function unusableDecision(reason:DecisionFailure,evidenceKind:DecisionEvidenceKind='live_test_unqualified',
  serving:DecisionServing=UNKNOWN_SERVING,usage:DecisionUsage|null=null):DecisionResult {
  let safeServing={...UNKNOWN_SERVING},safeUsage:DecisionUsage|null=null;
  try{safeServing=checkedServing(jsonValue(serving));}catch{}
  try{safeUsage=checkedUsage(jsonValue(usage));}catch{}
  return Object.freeze({status:'unusable',answers:null,reason:DECISION_FAILURES.includes(reason)?reason:'DECISION_UNAVAILABLE',
    evidence_kind:evidence(evidenceKind)?evidenceKind:'live_test_unqualified',serving:Object.freeze(safeServing),usage:safeUsage===null?null:Object.freeze(safeUsage)});
}

export function validateDecisionResult(request:DecisionRequest,value:unknown):DecisionResult {
  let evidenceKind:DecisionEvidenceKind='live_test_unqualified',serving={...UNKNOWN_SERVING},usage:DecisionUsage|null=null;
  try {
    const r=exact(jsonValue(value),RESULT_FIELDS);
    if(!evidence(r.evidence_kind))fail('DECISION_OUTPUT_INVALID');evidenceKind=r.evidence_kind;
    serving=checkedServing(r.serving);usage=checkedUsage(r.usage);
    const input=validateDecisionRequest(request);
    if(r.status==='unusable'){
      if(r.answers!==null||!DECISION_FAILURES.includes(r.reason))fail('DECISION_OUTPUT_INVALID');
      return unusableDecision(r.reason,evidenceKind,serving,usage);
    }
    if(r.status!=='usable'||r.reason!==null||!record(r.answers)
      ||Object.keys(r.answers).sort().join('\0')!==Object.keys(input.questions).sort().join('\0'))fail('DECISION_OUTPUT_INVALID');
    for(const [questionId,question] of Object.entries(input.questions)){
      const answer=r.answers[questionId];
      if(!record(answer)||answer.type!==question.type)fail('DECISION_OUTPUT_INVALID');
      if(question.type==='noul'){
        exact(answer,['type','probability_true']);if(!probability(answer.probability_true))fail('DECISION_OUTPUT_INVALID');
      } else if(question.type==='choice'){
        exact(answer,['type','choice','probabilities','confidence']);
        if(typeof answer.choice!=='string'||!Object.hasOwn(question.options,answer.choice))fail('DECISION_OUTPUT_INVALID');
        const probabilities=distribution(answer.probabilities,Object.keys(question.options));checkedConfidence(answer.confidence);
        if(probabilities[answer.choice]+2*DECISION_ROUNDING.half_unit+DECISION_ROUNDING.epsilon<Math.max(...Object.values(probabilities)))fail('DECISION_OUTPUT_INVALID');
      } else {
        exact(answer,['type','score','probabilities','confidence']);
        const keys=question.levels.map((_,index)=>String(index)),probabilities=distribution(answer.probabilities,keys);checkedConfidence(answer.confidence);
        if(typeof answer.score!=='number'||!Number.isFinite(answer.score)||answer.score<0||answer.score>keys.length-1)fail('DECISION_OUTPUT_INVALID');
        const expected=keys.reduce((sum,key)=>sum+Number(key)*probabilities[key],0);
        const weightedTolerance=(1+keys.reduce((sum,key)=>sum+Number(key),0))*DECISION_ROUNDING.half_unit+DECISION_ROUNDING.epsilon;
        if(Math.abs(answer.score-expected)>weightedTolerance)fail('DECISION_OUTPUT_INVALID');
      }
    }
    return Object.freeze({status:'usable',answers:r.answers,reason:null,usage:usage===null?null:Object.freeze(usage),
      serving:Object.freeze(serving),evidence_kind:evidenceKind});
  } catch {return unusableDecision('DECISION_OUTPUT_INVALID',evidenceKind,serving,usage);}
}
