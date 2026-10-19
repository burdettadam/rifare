import {exact,id,digest} from './kernel.mts';
import type {CommerceKernel,Scope,Row} from './kernel.mts';
import {canonical,contentDigest,jsonValue} from './configuration-values.mts';
import {DecisionResources} from './decision-resources.mts';
import {CaseConfigurations} from './case-configurations.mts';
import type {ReadContext} from './read-context.mts';
import {validateDecisionRequest} from '../agent/decisions.mts';

export const IMAGE_QUESTION_IDS=Object.freeze(['relevant_item_visible','usable_clarity','requested_detail_visible']);
export const IMAGE_PURPOSE='return_evidence_usability';
export const IMAGE_TRANSFORMATION='restricted_png_identity_v1';
const RESOURCE='references/image-evidence-questions.v1.json';
export function imageQuestions(bundle:Row){
  const manifest=JSON.parse(bundle.files['commerce-manifest.json']),raw=bundle.files[RESOURCE],declared=manifest.resources.find((r:Row)=>r.path===RESOURCE);
  if(!declared||typeof raw!=='string')throw new Error('IMAGE_RESOURCE_UNAVAILABLE');
  if(manifest.schema_version!==2||digest(raw)!==declared.sha256)throw new Error('IMAGE_RESOURCE_INTEGRITY');
  const resource=exact(jsonValue(JSON.parse(raw)),['schema_version','id','logical_task_id','purpose','questions']);
  if(resource.schema_version!==1||resource.purpose!==IMAGE_PURPOSE||resource.logical_task_id!=='return_image_usability')throw new Error('IMAGE_RESOURCE_INTEGRITY');
  id(resource.id);exact(resource.questions,[...IMAGE_QUESTION_IDS]);
  for(const question of Object.values(resource.questions) as Row[])if(question.type!=='choice'||Object.keys(question.options).sort().join(',')!=='cannot_assess,no,yes')throw new Error('IMAGE_RESOURCE_INTEGRITY');
  const question_set_digest=contentDigest({resource_digest:declared.sha256,questions:resource.questions});
  validateDecisionRequest({task_id:resource.logical_task_id,question_set_id:resource.id,question_set_digest,serving_configuration_ref:'image_resource_validation',state:'Validate published image vocabulary.',questions:resource.questions});
  return {...resource,question_resource_digest:declared.sha256,question_set_digest};
}

/** The original text snapshot remains the authority for complete case evidence.
 * Its text-only capability validator is deliberately not given media fields. */
export class ImageResources {
  readonly k:CommerceKernel;readonly reads:ReadContext;
  constructor(k:CommerceKernel,reads:ReadContext){this.k=k;this.reads=reads;}
  snapshot(scope:Scope,input:unknown){
    const p=exact(jsonValue(input),['case_id','task_id','serving_configuration_ref']);for(const v of Object.values(p))id(v);
    const c=new CaseConfigurations(this.k).resume(scope,p.case_id),bundle=this.reads.skills.snapshot(scope,c.pins.skill.id,c.pins.skill.digest),questions=imageQuestions(bundle);
    const text=new DecisionResources(this.k,this.reads).snapshot(scope,p);
    const common={...text,text_question_resource_digest:text.question_resource_digest,question_resource_digest:questions.question_resource_digest,question_set_digest:questions.question_set_digest,
      preprocessing_version:'return_image_usability_v1',evidence_hash:contentDigest({text_evidence_hash:text.evidence_hash,image_question_digest:questions.question_set_digest,transformation:IMAGE_TRANSFORMATION})};
    if(text.status!=='ready')return {...common,request:null};
    const request={...text.request,task_id:questions.logical_task_id,question_set_id:questions.id,question_set_digest:questions.question_set_digest,questions:questions.questions};
    const encoded_request_bytes=Buffer.byteLength(JSON.stringify(request)),input_hash=contentDigest(request);
    try{
      const normalized=validateDecisionRequest(request);
      // Conservatively count each UTF-8 byte as a text token, plus the declared
      // maximum image allowance and transport markers. No prefix truncation.
      if(encoded_request_bytes+1024+512>24576)throw new Error('DECISION_CONTEXT_LIMIT');
      return {...common,input_hash,encoded_request_bytes,status:'ready' as const,reason:null,request:normalized};
    }catch(error){if(error instanceof Error&&['DECISION_CONTEXT_LIMIT','DECISION_CAPABILITY_UNAVAILABLE'].includes(error.message))return {...common,input_hash,encoded_request_bytes,status:'unavailable' as const,reason:error.message,request:null};throw error;}
  }
}
