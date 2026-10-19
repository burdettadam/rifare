import {exact,id} from '../commerce/kernel.mts';
import type {Row} from '../commerce/kernel.mts';
import {canonical,contentDigest,jsonValue} from '../commerce/configuration-values.mts';

const STRATA=['clear','mixed','unknown','corrected','hostile','profile'];
const VOCABULARY={reported_problem:['damaged','size_fit','other_unclear'],requested_resolution:['refund','exchange','other_unclear']};
const ROUTES=[{labels:{reported_problem:'damaged',requested_resolution:'refund'},action:'draft_return'},{labels:{reported_problem:'size_fit',requested_resolution:'exchange'},action:'draft_return'}];
const METRICS={role_denominator:'all_enrolled_cases_in_the_declared_role',wrong_route_rate:'wrongly_routed_divided_by_all_routed',incorrect_review_rate:'incorrectly_reviewed_divided_by_role_denominator',route_coverage:'all_routed_divided_by_role_denominator',unavailable_and_malformed:'separate_counts_retained_in_role_denominator',calibration_selection:'first_ascending_candidate_passing_calibration_without_held_out_tuning',confidence:'minimum_selected_option_probability_is_configuration_specific_not_provider_confidence'};
const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function labels(value:unknown){const p=exact(value,['reported_problem','requested_resolution']);for(const key of Object.keys(VOCABULARY) as (keyof typeof VOCABULARY)[])if(!VOCABULARY[key].includes(p[key]))throw new Error('ROUTING_PROTOCOL_INVALID');return p;}

/** A protocol is a frozen task definition, never an authorization token. */
export function validateRoutingProtocol(input:unknown):Row{
 try{
  const p=exact(jsonValue(input,32768),['schema_version','id','task_id','locale','profile_variant','preprocessing_version','baseline','required_sources','vocabulary','permitted_routes','review_action','calibration','canary','cases','metric_definitions']);id(p.id);
  if(p.schema_version!==1||p.task_id!=='return_intake_shadow'||!['en-US','en-GB'].includes(p.locale)||p.profile_variant!==(p.locale==='en-US'?'us':'gb')||p.preprocessing_version!=='return_intake_text_v1'||p.baseline!=='manual_review'
   ||canonical(p.required_sources)!==canonical(['customer_messages','order_status'])||canonical(p.vocabulary)!==canonical(VOCABULARY)||canonical(p.permitted_routes)!==canonical(ROUTES)||canonical(p.metric_definitions)!==canonical(METRICS)||p.review_action!=='handoff_request')throw new Error();
  const c=exact(p.calibration,['selection','metric','candidates','diagnostic_threshold','minimum_calibration','minimum_held_out','minimum_held_out_routed','maximum_wrong_route_rate','maximum_wrong_route_upper','maximum_incorrect_review_rate','minimum_route_coverage','confidence_z']);
  if(c.selection!=='lowest_passing_threshold'||c.metric!=='minimum_selected_option_probability'||c.diagnostic_threshold!==0.95||c.minimum_calibration!==60||c.minimum_held_out!==60||c.minimum_held_out_routed!==30
   ||c.maximum_wrong_route_rate!==0.05||c.maximum_wrong_route_upper!==0.1||c.maximum_incorrect_review_rate!==0.1||c.minimum_route_coverage!==0.5||c.confidence_z!==1.6448536269514722
   ||!Array.isArray(c.candidates)||!c.candidates.length||c.candidates.length>3||c.candidates.some((v:any,i:number)=>![0.8,0.9,0.95].includes(v)||i>0&&v<=c.candidates[i-1]))throw new Error();
  const seen=new Set<string>(),sources=new Set<string>(),groups=new Set<string>();
  if(!Array.isArray(p.cases)||p.cases.length<12||p.cases.length>120)throw new Error();
  for(const row of p.cases){exact(row,['id','role','stratum','source_text_hash','labels','expected_handling']);id(row.id);labels(row.labels);
   if(seen.has(row.id)||sources.has(row.source_text_hash)||!hash(row.source_text_hash)||!['calibration','held_out'].includes(row.role)||!STRATA.includes(row.stratum)||!['route','review'].includes(row.expected_handling))throw new Error();
   const routable=ROUTES.some(r=>canonical(r.labels)===canonical(row.labels));if((row.expected_handling==='route')!==routable)throw new Error();
   seen.add(row.id);sources.add(row.source_text_hash);groups.add(row.role+':'+row.stratum);
  }
  if(groups.size!==12)throw new Error();
  const canary=exact(p.canary,['case_ids','maximum_age_ms','required_when_revision_unknown','expected','threshold_reuse']);
  if(!Array.isArray(canary.case_ids)||canary.case_ids.length!==6||new Set(canary.case_ids).size!==6||canary.maximum_age_ms!==86400000||canary.required_when_revision_unknown!==true||canary.expected!=='exact_predeclared_handling_and_labels'||canary.threshold_reuse!==false)throw new Error();
  const canaryRows=canary.case_ids.map((ref:string)=>p.cases.find((r:Row)=>r.id===ref&&r.role==='held_out'));if(canaryRows.some((r:any)=>!r)||new Set(canaryRows.map((r:Row)=>r.stratum)).size!==6)throw new Error();
  return p;
 }catch{throw new Error('ROUTING_PROTOCOL_INVALID');}
}
export function routingIdentity(pins:unknown,protocol:unknown){return contentDigest({contract:'decision-routing.v1',pins,protocol});}

export function decisionHandling(protocol:Row,result:Row,threshold:number|null){
 if(result.status!=='usable'||threshold===null)return {handling:'review',action:protocol.review_action,labels:null,probability:null};
 const answers=result.answers??{},selected:Row={};let probability=1;
 for(const key of Object.keys(VOCABULARY)){
  const a=answers[key];if(!a||a.type!=='choice'||!Object.hasOwn(a.probabilities??{},a.choice))return {handling:'review',action:protocol.review_action,labels:null,probability:null};
  selected[key]=a.choice;probability=Math.min(probability,a.probabilities[a.choice]);
 }
 const route=protocol.permitted_routes.find((r:Row)=>canonical(r.labels)===canonical(selected));
 return {handling:route&&probability>=threshold?'route':'review',action:route&&probability>=threshold?route.action:protocol.review_action,labels:selected,probability};
}
function intervalUpper(wrong:number,total:number,z:number){if(!total)return 1;const p=wrong/total,z2=z*z;return (p+z2/(2*total)+z*Math.sqrt(p*(1-p)/total+z2/(4*total*total)))/(1+z2/total);}
function score(p:Row,rows:Map<string,Row>,role:string,threshold:number|null){
 const out:Row={denominator:0,correctly_routed:0,wrongly_routed:0,correctly_reviewed:0,incorrectly_reviewed:0,unavailable:0,malformed:0,routed:0,reviewed:0};
 for(const expected of p.cases.filter((r:Row)=>r.role===role)){
  out.denominator++;const row=rows.get(expected.id);
  if(!row||row.status==='unavailable'){out.unavailable++;continue;}if(row.status==='malformed'){out.malformed++;continue;}
  const routable=p.permitted_routes.some((r:Row)=>canonical(r.labels)===canonical(row.labels)),route=threshold!==null&&row.probability>=threshold&&routable;
  if(route){out.routed++;out[expected.expected_handling==='route'&&canonical(expected.labels)===canonical(row.labels)?'correctly_routed':'wrongly_routed']++;}
  else{out.reviewed++;out[expected.expected_handling==='review'?'correctly_reviewed':'incorrectly_reviewed']++;}
 }
 out.wrong_route_rate=out.routed?out.wrongly_routed/out.routed:1;out.wrong_route_upper=intervalUpper(out.wrongly_routed,out.routed,p.calibration.confidence_z);
 out.incorrect_review_rate=out.incorrectly_reviewed/out.denominator;out.route_coverage=out.routed/out.denominator;return out;
}
/** Numeric analysis has no provenance authority. Only canonical server reads in
 * DecisionRouting can bind these numbers to a reviewed qualification record. */
export function scoreRoutingProtocol(input:unknown,observations:unknown){
 const p=validateRoutingProtocol(input),rows=new Map<string,Row>(),ids=new Set(p.cases.map((r:Row)=>r.id));
 if(!Array.isArray(observations)||observations.length>120)throw new Error('ROUTING_OBSERVATIONS_INVALID');
 for(const value of observations){const row=exact(jsonValue(value),['id','status','labels','probability']);
  if(!ids.has(row.id)||rows.has(row.id)||!['usable','unavailable','malformed'].includes(row.status))throw new Error('ROUTING_OBSERVATIONS_INVALID');
  if(row.status==='usable'){labels(row.labels);if(typeof row.probability!=='number'||!Number.isFinite(row.probability)||row.probability<0||row.probability>1)throw new Error('ROUTING_OBSERVATIONS_INVALID');}
  else if(row.labels!==null||row.probability!==null)throw new Error('ROUTING_OBSERVATIONS_INVALID');rows.set(row.id,row);
 }
 const c=p.calibration,passesCalibration=(r:Row)=>r.denominator>=c.minimum_calibration&&!r.unavailable&&!r.malformed&&r.wrong_route_rate<=c.maximum_wrong_route_rate&&r.incorrect_review_rate<=c.maximum_incorrect_review_rate&&r.route_coverage>=c.minimum_route_coverage;
 const selected=c.candidates.find((threshold:number)=>passesCalibration(score(p,rows,'calibration',threshold)))??null;
 const calibration=score(p,rows,'calibration',selected),held_out=score(p,rows,'held_out',selected),missing_cases=p.cases.length-rows.size;
 const numeric_passed=selected!==null&&!missing_cases&&held_out.denominator>=c.minimum_held_out&&held_out.routed>=c.minimum_held_out_routed&&!held_out.unavailable&&!held_out.malformed&&held_out.wrong_route_rate<=c.maximum_wrong_route_rate&&held_out.wrong_route_upper<=c.maximum_wrong_route_upper&&held_out.incorrect_review_rate<=c.maximum_incorrect_review_rate&&held_out.route_coverage>=c.minimum_route_coverage;
 const cohort_complete=calibration.denominator>=c.minimum_calibration&&held_out.denominator>=c.minimum_held_out&&!missing_cases;
 return {protocol_digest:contentDigest(p),total_denominator:p.cases.length,observed:rows.size,missing_cases,cohort_complete,numeric_status:!cohort_complete?'pending':numeric_passed?'passed':'measured_failure',selected_threshold:selected,calibration,held_out,numeric_passed,authorizes_routing:false,confidence_semantics:'configuration_specific_selected_option_statistic',uncertainty:'one_sided_95_percent_Wilson_upper'};
}
export function assessRoutingMilestone(claims:unknown={}){
 if(!claims||typeof claims!=='object'||Array.isArray(claims)||Object.keys(claims).length)throw new Error('UNSUPPORTED_QUALIFICATION');
 return {milestone:'M14',formal_status:'blocked',formal_cases_executed:0,connected_routing_qualified:false,backend_portability_qualified:false,self_hosted_qualified:false,
  outstanding:['approved_live_backend_observations','adequate_frozen_cohort','independent_scoped_publication','two_actual_backend_comparison','optional_self_hosted_observation','inherited_formal_product_gates'],next_milestone:'M15'};
}
