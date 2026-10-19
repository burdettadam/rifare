import {exact,id} from '../commerce/kernel.mts';
import type {Row} from '../commerce/kernel.mts';
import {contentDigest,jsonValue} from '../commerce/configuration-values.mts';
import {verifyDecisionReceipt} from '../commerce/decision-shadow.mts';
import {evaluate,suiteDigest} from './evaluation.mts';
import type {EvaluationSuite} from './evaluation.mts';

const STRATA=['clear','mixed','unknown','corrected','hostile','profile_specific'];
const FIELDS=['schema_version','id','preprocessing_version','evidence_kind','baseline_routing','strata','exclusions','metrics','routing_activation','qualification_status','source_evaluator','source_binding','configuration_policy','cases'];
function protocol(value:unknown,pin:string){
  if(contentDigest(value)!==pin)throw new Error('DECISION_EVALUATION_BASELINE_CHANGED');
  const p=exact(jsonValue(value),FIELDS);id(p.id);
  if(p.schema_version!==1||p.preprocessing_version!=='return_intake_text_v1'||p.baseline_routing!=='existing_manual_workflow'
    ||p.routing_activation!=='deferred_to_M14'||p.source_evaluator!=='packages/agent/evaluation.mts'
    ||!['synthetic_wire_fixture','live_test_unqualified'].includes(p.evidence_kind)
    ||JSON.stringify(p.strata)!==JSON.stringify(STRATA)||!Array.isArray(p.exclusions)||p.exclusions.length
    ||!Array.isArray(p.cases)||!p.cases.length||p.cases.length>100)throw new Error('DECISION_PROTOCOL_INVALID');
  const ids=new Set();
  for(const c of p.cases){
    exact(c,['id','role','stratum','profile_variant','customer_messages','reference_labels','expected_handling']);id(c.id);
    if(ids.has(c.id)||!['development','held_out'].includes(c.role)||!STRATA.includes(c.stratum)||!['us','gb'].includes(c.profile_variant)
      ||!['classification','review'].includes(c.expected_handling)||!Array.isArray(c.customer_messages)||!c.customer_messages.length
      ||c.customer_messages.some((m:unknown)=>typeof m!=='string'||!m.trim()||Buffer.byteLength(m)>8000))throw new Error('DECISION_PROTOCOL_INVALID');ids.add(c.id);
    exact(c.reference_labels,['reported_problem','requested_resolution']);
    if(!['damaged','size_fit','other_unclear'].includes(c.reference_labels.reported_problem)||!['refund','exchange','other_unclear'].includes(c.reference_labels.requested_resolution))throw new Error('DECISION_PROTOCOL_INVALID');
  }
  for(const role of ['development','held_out'])if(STRATA.some(s=>!p.cases.some((c:Row)=>c.role===role&&c.stratum===s)))throw new Error('DECISION_PROTOCOL_INVALID');
  return p;
}

/** A frozen synthetic cohort wrapper around the retained source evaluator.
 * Rows must be actual current-authorized reads/runs, never caller-authored
 * observations or a serialized receipt with a freshly recomputed digest. */
export function evaluateDecisionProtocol(value:unknown,expectedDigest:string,rows:unknown,claimedKind='synthetic_wire_fixture'){
  const p=protocol(value,expectedDigest);
  if(claimedKind!==p.evidence_kind)throw new Error('DECISION_EVIDENCE_KIND_MISMATCH');
  const cases=p.cases.filter((c:Row)=>c.role==='development');
  if(!Array.isArray(rows)||rows.length!==cases.length)throw new Error('INCOMPLETE_DECISION_EVALUATION');
  const observed=new Map<string,Row>(),groups=new Map<string,{cases:Row[];receipts:Row[]}>();
  for(const row of rows){
    exact(row,['case_id','receipt']);id(row.case_id);const c=cases.find((c:Row)=>c.id===row.case_id),r=verifyDecisionReceipt(row.receipt);
    if(!c||observed.has(c.id))throw new Error('INVALID_DECISION_CASE_MEMBERSHIP');
    if(r.provenance.transport_kind!==claimedKind||r.result.evidence_kind!==claimedKind)throw new Error('DECISION_EVIDENCE_KIND_MISMATCH');
    if(r.profile_variant!==c.profile_variant||r.preprocessing_version!==p.preprocessing_version)throw new Error('DECISION_CONFIGURATION_MISMATCH');
    const expectedSource=contentDigest({customer_messages:c.customer_messages,profile_variant:c.profile_variant});
    if(r.claims_digest!==expectedSource)throw new Error('DECISION_SOURCE_EVIDENCE_MISMATCH');
    const groupKey=contentDigest({configuration:r.configuration_digest,question_set:r.question_set_digest,catalog:r.catalog_digest});
    const group=groups.get(groupKey)??{cases:[],receipts:[]};group.cases.push(c);group.receipts.push(r);groups.set(groupKey,group);observed.set(c.id,r);
  }
  const configuration_groups:Row[]=[];
  for(const [key,group] of groups){
    const first=group.receipts[0],configuration_id='decision_group_'+key.slice(0,40),kind=claimedKind==='synthetic_wire_fixture'?'synthetic_fixture':'observed_unqualified';
    const suite:EvaluationSuite={version:1,id:'decision_cohort_'+key.slice(0,40),evidence_kind:kind,cases:group.cases.map(c=>({id:c.id,
      outcome:c.expected_handling==='classification'?'grounded_read':'handoff',source_digest:c.expected_handling==='classification'?contentDigest({customer_messages:c.customer_messages,profile_variant:c.profile_variant}):null,
      claims:c.expected_handling==='classification'?Object.entries(c.reference_labels).map(([id,value])=>({id,value})):[],allowed_actions:[]}))};
    const observations=group.cases.map((c,i)=>{const r=group.receipts[i],classification=r.result.status==='usable'&&r.handling==='classification';
      return {case_id:c.id,configuration_id,outcome:classification?'grounded_read':'handoff',source_digest:classification?r.claims_digest:null,
        claims:classification?Object.entries(r.result.answers).map(([id,a]:[string,any])=>({id,value:a.choice})):[],actions:[],latency_ms:null,cost_micro_usd:null};});
    const scored=evaluate(suite,suiteDigest(suite),{id:configuration_id,provider:'cloudflare',model:first.result.serving.reported_model??'reported_identity_unknown',
      model_digest:'immutable_serving_revision_unknown',skill_digest:first.skill_digest,profile_revision:first.profile_revision,evidence_kind:kind},observations);
    configuration_groups.push({configuration_digest:first.configuration_digest,question_set_digest:first.question_set_digest,reader_configuration_digest:first.provenance.reader_configuration_digest,
      profile_variant:first.profile_variant,denominator:scored.denominator,correct_classifications:scored.factual_answers,correct_review:scored.required_handoffs.correct,
      wrong_classifications:scored.results.filter(r=>r.outcome==='grounded_read'&&!r.correct).length,source_evaluation:scored});
  }
  const receipts=[...observed.values()],sum=(key:string)=>configuration_groups.reduce((n,g)=>n+g[key],0);
  return {protocol_id:p.id,protocol_digest:expectedDigest,evidence_kind:claimedKind,denominator:cases.length,reference_cohort_total:p.cases.length,
    correct_classifications:sum('correct_classifications'),correct_review:sum('correct_review'),wrong_classifications:sum('wrong_classifications'),
    unusable_observations:receipts.filter(r=>r.result.status==='unusable').length,fixture_observations:receipts.filter(r=>r.provenance.transport_kind==='synthetic_wire_fixture').length,
    live_inference_observations:receipts.filter(r=>r.provenance.live_inference_observed).length,held_out_pending:p.cases.filter((c:Row)=>c.role==='held_out').length,
    business_effects:receipts.reduce((n,r)=>n+r.business_effects,0),baseline_routing:p.baseline_routing,configuration_groups,
    strata:STRATA.map(stratum=>({stratum,denominator:cases.filter((c:Row)=>c.stratum===stratum).length})),
    total_cost_micro_usd:null,provider_latency_ms:null,model_quality_qualified:false,routing_activation:'deferred_to_M14',qualification:'observations_only_not_model_or_product_qualification'};
}

export function assessDecisionMilestone(receipts:unknown,claims:unknown={}){
  if(!claims||typeof claims!=='object'||Object.keys(claims).length)throw new Error('UNSUPPORTED_QUALIFICATION_CLAIM');
  if(!Array.isArray(receipts)||receipts.length>1000)throw new Error('INVALID_DECISION_ASSESSMENT');
  const rows=receipts.map(verifyDecisionReceipt);
  if(new Set(rows.map(r=>r.id)).size!==rows.length)throw new Error('INVALID_DECISION_ASSESSMENT');
  return {milestone:'M13',local_observations:rows.length,fixture_observations:rows.filter(r=>r.provenance.transport_kind==='synthetic_wire_fixture').length,
    live_inference_observations:rows.filter(r=>r.provenance.live_inference_observed).length,business_effects:rows.reduce((n,r)=>n+r.business_effects,0),
    formal_status:'blocked',local_integration_accepted:false,independent_review_inferred:false,
    outstanding:['connected_provider_qualification','measured_model_quality_latency_usage_and_cost','inherited_formal_product_gates','exact_candidate_independent_reviews_and_maintainer_decision'],next_milestone:'M14'};
}
