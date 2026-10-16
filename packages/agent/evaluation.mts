import { digest,exact,id,integer } from '../commerce/kernel.mts';
import { isDeepStrictEqual } from 'node:util';

export type EvaluationCase={id:string;outcome:'grounded_read'|'handoff';source_digest:string|null;
  claims:{id:string;value:unknown}[];allowed_actions:string[]};
export type EvaluationSuite={version:1;id:string;evidence_kind:'synthetic_fixture'|'observed_unqualified';cases:EvaluationCase[]};
const hash=(value:unknown)=>digest(JSON.stringify(value));
const allowedStates=['grounded_read','handoff','failed','pending','cancelled'];
const max=1024*1024;
function bounded(value:unknown){
  let text:string;try{text=JSON.stringify(value);if(!text||!isDeepStrictEqual(JSON.parse(text),value))throw new Error();}
  catch{throw new Error('INVALID_JSON_VALUE');}
  if(Buffer.byteLength(text)>max)throw new Error('EVALUATION_TOO_LARGE');
}
export function suiteDigest(suite:EvaluationSuite){return hash(suite);}
export function validateSuite(value:unknown):EvaluationSuite {
  bounded(value);const s=exact(value,['version','id','evidence_kind','cases']);id(s.id);
  if(s.version!==1||!['synthetic_fixture','observed_unqualified'].includes(s.evidence_kind)
    ||!Array.isArray(s.cases)||!s.cases.length||s.cases.length>1000)throw new Error('INVALID_EVALUATION');
  const seen=new Set();
  for(const c of s.cases){
    exact(c,['id','outcome','source_digest','claims','allowed_actions']);id(c.id);
    if(seen.has(c.id))throw new Error('DUPLICATE_CASE');seen.add(c.id);
    if(!['grounded_read','handoff'].includes(c.outcome)||!Array.isArray(c.claims)||!Array.isArray(c.allowed_actions)
      ||c.allowed_actions.some((x:any)=>typeof x!=='string'||x.length>96)||new Set(c.allowed_actions).size!==c.allowed_actions.length)throw new Error('INVALID_EVALUATION');
    if(c.outcome==='grounded_read'&&(!/^[a-f0-9]{64}$/.test(c.source_digest)||!c.claims.length))throw new Error('INVALID_EVALUATION');
    if(c.outcome==='handoff'&&(c.source_digest!==null||c.claims.length))throw new Error('INVALID_EVALUATION');
    for(const fact of c.claims){exact(fact,['id','value']);if(typeof fact.id!=='string'||!fact.id||fact.id.length>96)throw new Error('INVALID_EVALUATION');}
    if(new Set(c.claims.map((f:any)=>f.id)).size!==c.claims.length)throw new Error('INVALID_EVALUATION');
  }
  return structuredClone(s) as EvaluationSuite;
}
export function evaluate(value:unknown,expectedDigest:string,configuration:unknown,observations:unknown) {
  const suite=validateSuite(value);if(suiteDigest(suite)!==expectedDigest)throw new Error('EVALUATION_BASELINE_CHANGED');
  const cfg=exact(configuration,['id','provider','model','model_digest','skill_digest','profile_revision','evidence_kind']);
  id(cfg.id);for(const field of ['provider','model','model_digest','skill_digest'])if(typeof cfg[field]!=='string'||!cfg[field]||cfg[field].length>160)throw new Error('INVALID_CONFIGURATION');
  integer(cfg.profile_revision,1);if(cfg.evidence_kind!==suite.evidence_kind)throw new Error('EVIDENCE_KIND_MISMATCH');
  bounded(observations);if(!Array.isArray(observations)||observations.length!==suite.cases.length)throw new Error('INCOMPLETE_EVALUATION');
  const byId=new Map<string,any>();
  for(const o of observations){
    exact(o,['case_id','configuration_id','outcome','source_digest','claims','actions','latency_ms','cost_micro_usd']);id(o.case_id);
    if(o.configuration_id!==cfg.id)throw new Error('CONFIGURATION_MISMATCH');
    if(!suite.cases.some(c=>c.id===o.case_id)||byId.has(o.case_id))throw new Error('INVALID_CASE_MEMBERSHIP');
    if(!allowedStates.includes(o.outcome)||!Array.isArray(o.claims)||!Array.isArray(o.actions)||o.actions.some((a:any)=>typeof a!=='string'||a.length>96))throw new Error('INVALID_OBSERVATION');
    if(o.latency_ms!==null)integer(o.latency_ms);
    if(o.cost_micro_usd!==null&&(typeof o.cost_micro_usd!=='string'||!/^(0|[1-9][0-9]{0,29})$/.test(o.cost_micro_usd)))throw new Error('INVALID_COST');
    if(o.source_digest!==null&&(typeof o.source_digest!=='string'||!/^[a-f0-9]{64}$/.test(o.source_digest)))throw new Error('INVALID_OBSERVATION');
    for(const c of o.claims){exact(c,['id','value']);if(typeof c.id!=='string'||c.id.length>96)throw new Error('INVALID_OBSERVATION');}
    if(new Set(o.claims.map((c:any)=>c.id)).size!==o.claims.length)throw new Error('DUPLICATE_CLAIM');
    byId.set(o.case_id,o);
  }
  const results=suite.cases.map(c=>{
    const o=byId.get(c.id);const authority=o.actions.every((a:string)=>c.allowed_actions.includes(a));
    const facts=c.outcome==='grounded_read'&&o.outcome==='grounded_read'&&c.claims.length===o.claims.length
      &&c.claims.every(f=>o.claims.some((x:any)=>x.id===f.id&&isDeepStrictEqual(x.value,f.value)));
    const source=c.outcome==='grounded_read'&&o.source_digest===c.source_digest;
    const handoff=c.outcome==='handoff'&&o.outcome==='handoff'&&o.claims.length===0&&o.source_digest===null;
    return {id:c.id,outcome:o.outcome,correct:authority&&(handoff||(facts&&source)),fact_match:facts,
      source_match:source,authority_match:authority,required_handoff:handoff,latency_ms:o.latency_ms,
      cost_micro_usd:o.cost_micro_usd,observation_digest:hash(o)};
  });
  const total=results.length,correct=results.filter(r=>r.correct).length,needed=suite.cases.filter(c=>c.outcome==='handoff').length;
  const costs=results.every(r=>r.cost_micro_usd!==null)?results.reduce((sum,r)=>sum+BigInt(r.cost_micro_usd),0n).toString():null;
  const latency=results.every(r=>r.latency_ms!==null)?results.map(r=>r.latency_ms).sort((a,b)=>a-b):null;
  return {suite_id:suite.id,suite_digest:expectedDigest,configuration:structuredClone(cfg),configuration_digest:hash(cfg),
    evidence_kind:suite.evidence_kind,denominator:total,correct_handling:correct,correct_handling_rate:correct/total,
    factual_answers:results.filter(r=>r.correct&&r.outcome==='grounded_read').length,
    required_handoffs:{correct:results.filter(r=>r.correct&&r.required_handoff).length,total:needed},
    authority_failures:results.filter(r=>!r.authority_match).length,total_cost_micro_usd:costs,
    p95_latency_ms:latency?latency[Math.ceil(latency.length*.95)-1]:null,results,
    qualification:'observations_only_not_model_or_product_qualification'};
}
export function observationFromRun(caseId:string,configurationId:string,run:any,latencyMs:number,costMicroUsd:string|null=null) {
  return {case_id:caseId,configuration_id:configurationId,outcome:run.status,source_digest:run.source_digest??null,
    claims:(run.claims??[]).map((c:any)=>({id:c.id,value:c.value})),actions:(run.receipt?.history??[]).map((h:any)=>h.action),
    latency_ms:latencyMs,cost_micro_usd:costMicroUsd};
}
