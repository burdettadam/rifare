import {exact,id,integer,token} from './kernel.mts';
import type {CommerceKernel,Scope,Row} from './kernel.mts';
import {canonical,contentDigest,jsonValue} from './configuration-values.mts';
import type {ReadContext} from './read-context.mts';
import type {SecretVault} from './secrets.mts';
import {CaseConfigurations} from './case-configurations.mts';
import {ReturnEvidence,evidenceRows,validateEvidencePng} from './return-evidence.mts';
import {assertSupportOwner,checkedDocument,documentRow,saveDocument} from './support-core.mts';
import {assertExecution} from './execution-stops.mts';
import {ModelBudgets} from './model-budgets.mts';
import {eraseImageRecords,imageCaseHeld} from './image-privacy.mts';
import {ImageResources,IMAGE_PURPOSE,IMAGE_TRANSFORMATION,IMAGE_QUESTION_IDS} from './image-resources.mts';
import {IMAGE_ADAPTER,IMAGE_MODEL,isImageReader,verifyImageReaderResult} from '../agent/image-reader.mts';
import type {ImageReader} from '../agent/image-reader.mts';
import {unusableDecision,validateDecisionResult} from '../agent/decisions.mts';
import type {DecisionResult,DecisionFailure} from '../agent/decisions.mts';

type ServingConfiguration={id:string;tenant_id:string;store_id:string;secret_ref:string;reader:ImageReader};
type CatalogEntry=ServingConfiguration&{digest:string};
const CONFIG='image_configuration',OBSERVATION='image_observation',APPROVAL='image_approval';
const OBSERVED=new WeakSet<object>();
const SHA=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const PROTOCOL_DIGEST='07dcdda89316fa8825fdf31b311e05159a95bac326f62b608e5be6f62d47fe8f';
function freeze<T>(value:T):T{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function body(value:Row){const {receipt_digest,...core}=value;return core;}
export function verifyImageReceipt(value:unknown):Row{
  if(!value||typeof value!=='object'||!OBSERVED.has(value)||!SHA((value as Row).receipt_digest)||contentDigest(body(value as Row))!==(value as Row).receipt_digest)throw new Error('IMAGE_RECEIPT_INTEGRITY');return value as Row;
}
/** Preparation report only. No caller flag or synthetic count can qualify a
 * hosted modality; exact membership and actual inference are still absent. */
export function assessImageQualification(protocol:unknown,expectedDigest:string,observations:unknown[]){
  const p=jsonValue(protocol);
  if(expectedDigest!==PROTOCOL_DIGEST||contentDigest(p)!==PROTOCOL_DIGEST)throw new Error('IMAGE_PROTOCOL_INTEGRITY');
  if(!Array.isArray(observations)||observations.length>1000)throw new Error('INVALID_INPUT');
  const seen=new Set<string>();for(const value of observations){const r=verifyImageReceipt(value);if(seen.has(r.id))throw new Error('IMAGE_OBSERVATION_CONFLICT');seen.add(r.id);
    if(r.provenance.transport_kind!=='synthetic_wire_fixture'||r.provenance.live_inference_observed!==false)throw new Error('IMAGE_QUALIFICATION_UNAVAILABLE');}
  return freeze({protocol_id:p.id,protocol_digest:PROTOCOL_DIGEST,qualified:false,formal_acceptance:'blocked',actual_image_inference_count:0,synthetic_wire_observation_count:observations.length,measured_quality:null,
    cohort_membership:'pending_independent_freeze',individual_image_backup_erasure:'pending',audio:'disabled_deferred',video:'disabled_deferred',encoded_media_dlp_qualified:false,remaining_requirements:p.qualification_requirements});
}

export class ImageAssistance {
  readonly k:CommerceKernel;readonly reads:ReadContext;
  #vault:SecretVault;#evidence:ReturnEvidence;#catalog=new Map<string,CatalogEntry>();#prepared=new WeakMap<object,Row>();
  constructor(k:CommerceKernel,reads:ReadContext,vault:SecretVault,evidence:ReturnEvidence,configurations:ServingConfiguration[]){
    this.k=k;this.reads=reads;this.#vault=vault;this.#evidence=evidence;
    if(!Array.isArray(configurations)||configurations.length>64)throw new Error('IMAGE_CONFIGURATION_INVALID');
    for(const config of configurations){
      exact(config,['id','tenant_id','store_id','secret_ref','reader']);for(const key of ['id','tenant_id','store_id','secret_ref'] as const)id(config[key]);
      if(!isImageReader(config.reader)||config.reader.serving_configuration_ref!==config.id)throw new Error('IMAGE_CONFIGURATION_INVALID');
      const key=canonical([config.tenant_id,config.store_id,config.id]);if(this.#catalog.has(key))throw new Error('IMAGE_CONFIGURATION_INVALID');
      const descriptor={id:config.id,tenant_id:config.tenant_id,store_id:config.store_id,secret_ref:config.secret_ref,reader_configuration_digest:config.reader.configuration_digest,evidence_kind:config.reader.evidence_kind,capabilities:config.reader.capabilities};
      this.#catalog.set(key,Object.freeze({...config,digest:contentDigest(descriptor)}));
    }
  }
  #entry(s:Row,ref:string){const entry=this.#catalog.get(canonical([s.tenant_id,s.store_id,id(ref)]));if(!entry)throw new Error('NOT_FOUND');return entry;}
  configure(scope:Scope,input:unknown){
    const p=exact(jsonValue(input),['id','expected_version','enabled','expires_at','purpose','modality']);id(p.id);integer(p.expected_version);integer(p.expires_at);
    if(p.modality!=='image')throw new Error('IMAGE_MODALITY_UNAVAILABLE');
    if(p.purpose!==IMAGE_PURPOSE||typeof p.enabled!=='boolean'||p.expires_at<=this.k.clock()||p.expires_at>this.k.clock()+31*86400000)throw new Error('IMAGE_CONFIGURATION_INVALID');
    return this.k.transaction(()=>{const s=this.k.authorize(scope,'support.configure'),entry=this.#entry(s,p.id);
      const value={serving_configuration_ref:entry.id,catalog_digest:entry.digest,reader_configuration_digest:entry.reader.configuration_digest,purpose:IMAGE_PURPOSE,modality:'image',enabled:p.enabled,mode:'diagnostic',evidence_kind:entry.reader.evidence_kind,qualified:false};
      const r=saveDocument(this.k,s,CONFIG,p.id,p.expected_version,value,'active',p.expires_at);
      return {id:r.id,version:r.version,configuration_digest:r.digest,enabled:p.enabled,qualified:false,execution_authorized:false};
    });
  }
  #configuration(scope:Scope,ref:string){
    const s=this.k.require(scope),entry=this.#entry(s,ref),r=checkedDocument(this.k,s,CONFIG,ref);
    const expected={serving_configuration_ref:entry.id,catalog_digest:entry.digest,reader_configuration_digest:entry.reader.configuration_digest,purpose:IMAGE_PURPOSE,modality:'image',enabled:r.body.enabled,mode:'diagnostic',evidence_kind:entry.reader.evidence_kind,qualified:false};
    if(typeof r.body.enabled!=='boolean'||canonical(r.body)!==canonical(expected))throw new Error('IMAGE_CONFIGURATION_CHANGED');return {entry,record:r};
  }
  #enabled(scope:Scope,ref:string){const cfg=this.#configuration(scope,ref);if(!cfg.record.body.enabled)throw new Error('IMAGE_DISABLED');return cfg;}
  status(scope:Scope,ref:string){
    const s=this.k.authorize(scope,'support.read');this.#entry(s,ref);let enabled=false;
    try{enabled=this.#configuration(scope,ref).record.body.enabled;}catch(error){if(!(error instanceof Error)||!['SUPPORT_CONFIGURATION_MISSING','SUPPORT_CONFIGURATION_UNAVAILABLE'].includes(error.message))throw error;}
    return freeze({modalities:{image:{enabled,mode:'diagnostic',qualified:false,live_transport_available:false},audio:{enabled:false,reason:'deferred'},video:{enabled:false,reason:'deferred'}},purpose:IMAGE_PURPOSE,manual_workflow_available:true,encoded_media_dlp_qualified:false,individual_image_backup_erasure:'pending',gift_image_consent_available:false});
  }
  #customer(scope:Scope){const s=this.k.require(scope);if(s.role!=='customer')throw new Error('ACCESS_DENIED');return s;}
  #operator(scope:Scope){const s=this.k.authorize(scope,'model.run');if(!['owner','operator'].includes(s.role)||this.k.workerIdentity(scope))throw new Error('ACCESS_DENIED');return s;}
  upload(scope:Scope,input:unknown){
    const p=exact(jsonValue(input,400000),['configuration_id','case_id','mime','base64','note','customer_opt_in']);this.#customer(scope);
    if(p.customer_opt_in!==true)throw new Error('IMAGE_CONSENT_REQUIRED');this.#enabled(scope,id(p.configuration_id));
    return this.#evidence.upload(scope,{case_id:p.case_id,mime:p.mime,base64:p.base64,note:p.note});
  }
  #taskBinding(s:Row,c:Row,taskId:string){
    const task=this.k.db.prepare('SELECT * FROM commerce_context_tasks WHERE tenant_id=? AND store_id=? AND id=? AND expires_at>?').get(s.tenant_id,s.store_id,id(taskId),this.k.clock()) as Row|undefined;
    if(!task||task.resource_id!==c.resource_id||task.profile_id!==c.pins.profile.id||task.profile_revision!==c.pins.profile.revision||task.skill_digest!==c.pins.skill.digest)throw new Error('IMAGE_CONTEXT_CHANGED');return task;
  }
  #source(scope:Scope,caseId:string,evidenceId:string){
    const c=new CaseConfigurations(this.k).inspect(scope,caseId),s=this.k.authorize(scope,'return.read',c.resource_id),e=this.#evidence.inspect(scope,evidenceId);
    if(e.case_id!==c.id)throw new Error('IMAGE_CONTEXT_CHANGED');
    if(e.state!=='clean'||!e.scanner||e.expires_at<=this.k.clock())throw new Error('IMAGE_EVIDENCE_UNAVAILABLE');
    const [current]=evidenceRows(this.k,s,c.id,[evidenceId]);
    return {evidence_id:current.id,sha256:current.sha256,scanner:current.scanner,expires_at:current.expires_at,mime:'image/png'};
  }
  #store(s:Row,value:Row){const receipt={...value,receipt_digest:contentDigest(value)};
    this.k.db.prepare('INSERT INTO commerce_assistance_receipts VALUES(?,?,?,?,?,?)').run(s.tenant_id,s.store_id,receipt.id,receipt.task_id,receipt.observed_at,canonical(receipt));return receipt;
  }
  #stored(s:Row,ref:string,kind:string){
    const row=this.k.db.prepare('SELECT * FROM commerce_assistance_receipts WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,id(ref)) as Row|undefined;
    if(!row)throw new Error(kind===APPROVAL?'IMAGE_APPROVAL_UNAVAILABLE':'NOT_FOUND');const value=jsonValue(JSON.parse(row.body));
    if(value.kind!==kind||value.id!==row.id||value.task_id!==row.task_id||!SHA(value.receipt_digest)||contentDigest(body(value))!==value.receipt_digest)throw new Error('IMAGE_RECEIPT_INTEGRITY');return value;
  }
  approve(scope:Scope,input:unknown){
    const p=exact(jsonValue(input),['case_id','task_id','configuration_id','evidence_id','sha256','consent']);for(const key of ['case_id','task_id','configuration_id','evidence_id'])id(p[key]);
    if(p.consent!==true)throw new Error('IMAGE_CONSENT_REQUIRED');if(!SHA(p.sha256))throw new Error('INVALID_INPUT');
    return this.k.transaction(()=>{const s=this.#customer(scope),cases=new CaseConfigurations(this.k),c=cases.inspect(scope,p.case_id);cases.verified(scope,c.id);this.k.authorize(scope,'return.evidence',c.resource_id);
      const cfg=this.#enabled(scope,p.configuration_id),task=this.#taskBinding(s,c,p.task_id),source=this.#source(scope,c.id,p.evidence_id);
      if(source.sha256!==p.sha256)throw new Error('IMAGE_EVIDENCE_CHANGED');
      const expires=Math.min(this.k.clock()+60000,source.expires_at,task.expires_at,s.expires_at,cfg.record.expires_at),approval=this.#store(s,{schema_version:1,kind:APPROVAL,id:'imageconsent_'+token().slice(0,32),case_id:c.id,task_id:task.id,source,
        customer_id:s.customer_id,customer_session_hash:s.token_hash,configuration_id:p.configuration_id,configuration_version:cfg.record.version,configuration_digest:cfg.record.digest,purpose:IMAGE_PURPOSE,revoked:false,expires_at:expires,observed_at:this.k.clock()});
      return freeze({id:approval.id,case_id:c.id,source,expires_at:expires,purpose:IMAGE_PURPOSE,model_execution_approved:true,business_execution_authorized:false});
    });
  }
  revoke(scope:Scope,input:unknown){
    const p=exact(jsonValue(input),['case_id','approval_id']);return this.k.transaction(()=>{const s=this.#customer(scope),c=new CaseConfigurations(this.k).inspect(scope,id(p.case_id)),a=this.#stored(s,p.approval_id,APPROVAL);
      this.k.authorize(scope,'return.evidence',c.resource_id);if(a.case_id!==c.id||a.customer_id!==s.customer_id)throw new Error('ACCESS_DENIED');
      if(imageCaseHeld(this.k,s.tenant_id,s.store_id,c.id)){
        const changed={...body(a),revoked:true,revoked_at:this.k.clock()};this.k.db.prepare('UPDATE commerce_assistance_receipts SET body=? WHERE tenant_id=? AND store_id=? AND id=?').run(canonical({...changed,receipt_digest:contentDigest(changed)}),s.tenant_id,s.store_id,a.id);
      }else eraseImageRecords(this.k,s.tenant_id,s.store_id,{approval_ids:[a.id]});return {revoked:true,original_attempt_identity_retained:true};
    });
  }
  #approval(scope:Scope,p:Row,cfg:Row){
    const s=this.k.require(scope),a=this.#stored(s,p.approval_id,APPROVAL),c=new CaseConfigurations(this.k).inspect(scope,p.case_id);
    if(a.revoked!==false)throw new Error('IMAGE_APPROVAL_UNAVAILABLE');
    if(a.case_id!==p.case_id||a.task_id!==p.task_id||a.configuration_id!==p.configuration_id||a.customer_id!==c.customer_id)throw new Error('IMAGE_CONTEXT_CHANGED');
    this.#taskBinding(s,c,p.task_id);
    if(a.expires_at<=this.k.clock())throw new Error('IMAGE_APPROVAL_EXPIRED');
    if(a.purpose!==IMAGE_PURPOSE||a.configuration_version!==cfg.record.version||a.configuration_digest!==cfg.record.digest)throw new Error('IMAGE_CONFIGURATION_CHANGED');
    const session=this.k.db.prepare('SELECT * FROM commerce_sessions WHERE token_hash=? AND tenant_id=? AND store_id=?').get(a.customer_session_hash,s.tenant_id,s.store_id) as Row|undefined;
    if(!session||session.role!=='customer'||session.revoked||session.expires_at<=this.k.clock()||session.last_seen<=this.k.clock()-900000||session.customer_id!==a.customer_id||session.resource_id!==c.resource_id)throw new Error('IMAGE_CUSTOMER_AUTHORITY_CHANGED');
    new CaseConfigurations(this.k).verified(scope,c.id);
    const source=this.#source(scope,c.id,a.source.evidence_id);if(canonical(source)!==canonical(a.source))throw new Error('IMAGE_EVIDENCE_CHANGED');return a;
  }
  #input(input:unknown){const p=exact(jsonValue(input),['case_id','task_id','configuration_id','approval_id','request_id']);for(const v of Object.values(p))id(v);return p;}
  prepare(scope:Scope,input:unknown){
    const p=this.#input(input),s=this.#operator(scope),ownership=assertSupportOwner(this.k,scope,p.case_id),cfg=this.#enabled(scope,p.configuration_id),approval=this.#approval(scope,p,cfg);
    const snapshot=new ImageResources(this.k,this.reads).snapshot(scope,{case_id:p.case_id,task_id:p.task_id,serving_configuration_ref:p.configuration_id}),stamp=assertExecution(this.k,s,'model.run').stamp;
    const observationId='imageobs_'+contentDigest([s.tenant_id,s.store_id,p.case_id,p.request_id]).slice(0,40),invocation_digest=contentDigest(p);
    const prior=this.k.db.prepare('SELECT id FROM commerce_assistance_receipts WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,observationId);
    if(prior&&this.read(scope,p.case_id,observationId).invocation_digest!==invocation_digest)throw new Error('IMAGE_OBSERVATION_CONFLICT');
    const handle=Object.freeze({id:observationId,mode:'diagnostic',execution_authorized:false});this.#prepared.set(handle,{input:p,snapshot,entry:cfg.entry,configuration:cfg.record,approval,actor:s.actor_id,session:s.token_hash,tenant:s.tenant_id,store:s.store_id,ownership_generation:ownership.owner.generation,stamp,observation_id:observationId,invocation_digest,replay:!!prior,started:false,controller:new AbortController()});return handle;
  }
  #guard(scope:Scope,p:Row){
    if(p.controller.signal.aborted)throw new Error('IMAGE_CANCELLED');const s=this.#operator(scope);
    if(s.tenant_id!==p.tenant||s.store_id!==p.store||s.actor_id!==p.actor||s.token_hash!==p.session)throw new Error('ACCESS_DENIED');
    assertSupportOwner(this.k,scope,p.input.case_id,p.ownership_generation,p.actor);assertExecution(this.k,s,'model.run',p.stamp);
    const cfg=this.#enabled(scope,p.input.configuration_id);
    if(cfg.record.version!==p.configuration.version||cfg.record.digest!==p.configuration.digest)throw new Error('IMAGE_CONFIGURATION_CHANGED');
    const approval=this.#approval(scope,p.input,cfg);if(approval.receipt_digest!==p.approval.receipt_digest)throw new Error('IMAGE_APPROVAL_CHANGED');
    this.k.authorize(scope,'secret.invoke');
    if(!this.k.db.prepare('SELECT 1 FROM commerce_secrets WHERE tenant_id=? AND store_id=? AND ref=? AND provider=? AND adapter=? AND revoked=0').get(s.tenant_id,s.store_id,p.entry.secret_ref,'cloudflare',IMAGE_ADAPTER))throw new Error('SECRET_UNAVAILABLE');
    const current=new ImageResources(this.k,this.reads).snapshot(scope,{case_id:p.input.case_id,task_id:p.input.task_id,serving_configuration_ref:p.input.configuration_id});
    if(current.evidence_hash!==p.snapshot.evidence_hash||current.input_hash!==p.snapshot.input_hash||current.status!==p.snapshot.status)throw new Error('IMAGE_EVIDENCE_CHANGED');return s;
  }
  cancel(scope:Scope,handle:object){
    const p=this.#prepared.get(handle),s=this.k.require(scope);if(!p||s.tenant_id!==p.tenant||s.store_id!==p.store||s.actor_id!==p.actor||s.token_hash!==p.session)throw new Error('IMAGE_PREPARATION_INVALID');p.controller.abort();return {cancelled:true};
  }
  async execute(scope:Scope,handle:object){
    const p=this.#prepared.get(handle);if(!p||p.started)throw new Error('IMAGE_PREPARATION_INVALID');p.started=true;let bytes:Buffer|undefined;
    try{
      this.#guard(scope,p);if(p.replay)return this.read(scope,p.input.case_id,p.observation_id);
      if(this.k.db.prepare('SELECT id FROM commerce_model_reservations WHERE tenant_id=? AND store_id=? AND id=?').get(p.tenant,p.store,p.observation_id))throw new Error('IMAGE_OBSERVATION_IN_PROGRESS');
      const kind=p.entry.reader.evidence_kind,budgets=new ModelBudgets(this.k);let result:DecisionResult=unusableDecision('DECISION_UNAVAILABLE',kind),dispatch='not_attempted',failure_phase:string|null=null;
      if(p.snapshot.status!=='ready'){result=unusableDecision(p.snapshot.reason as DecisionFailure,kind);failure_phase='evidence';}
      else {
        let reserved=false,inputBound=0;
        try{
          // Account for the whole logical request, image's declared token upper
          // bound and markers without persisting base64 in budget metadata.
          const accountingRequest={max_output_tokens:1,decision:p.snapshot.request,image_sha256:p.approval.source.sha256,image_token_reservation:'x'.repeat(1024)};
          inputBound=Buffer.byteLength(canonical(accountingRequest))+512;
          const reservation=budgets.reserve(scope,'cloudflare',p.observation_id,accountingRequest);
          if(reservation.duplicate)throw new Error('IMAGE_OBSERVATION_IN_PROGRESS');reserved=true;
        }catch(error){if(error instanceof Error&&['IMAGE_OBSERVATION_IN_PROGRESS','BUDGET_IDEMPOTENCY_CONFLICT'].includes(error.message))throw new Error('IMAGE_OBSERVATION_IN_PROGRESS');failure_phase='budget';}
        if(reserved){
          try{
            this.#guard(scope,p);
            const signed=this.#evidence.sign(scope,p.approval.source.evidence_id);bytes=this.#evidence.content(scope,p.approval.source.evidence_id,signed.token);validateEvidencePng(bytes);
            this.#guard(scope,p);dispatch='transport_unconfirmed';
            const invocation={request:p.snapshot.request,image:{mime:'image/png',base64:bytes.toString('base64'),sha256:p.approval.source.sha256,source_sha256:p.approval.source.sha256,transformation:IMAGE_TRANSFORMATION},expected_configuration_digest:p.entry.reader.configuration_digest,guard:()=>{this.#guard(scope,p);},signal:p.controller.signal};
            const value=await this.#vault.invokeReader(scope,p.entry.secret_ref,IMAGE_ADAPTER,invocation);
            if(!verifyImageReaderResult(p.entry.reader,invocation,value)){result=unusableDecision('DECISION_OUTPUT_INVALID',kind);failure_phase='reader_identity';}
            else {
              result=validateDecisionResult(p.snapshot.request,value);
              if(result.evidence_kind!==kind)result=unusableDecision('DECISION_OUTPUT_INVALID',kind);
              // A provider report above this invocation's reservation is invalid
              // accounting evidence. Hold unknown rather than charge above it.
              if(result.usage&&(result.usage.input_tokens>inputBound||result.usage.output_tokens>1))result=unusableDecision('DECISION_OUTPUT_INVALID',kind);
              const noDispatch=['DECISION_REQUEST_INVALID','DECISION_CONTEXT_LIMIT','DECISION_CAPABILITY_UNAVAILABLE','DECISION_DESTINATION_UNAPPROVED','DECISION_CREDENTIAL_UNAVAILABLE','DECISION_CONFIGURATION_CHANGED'].includes(result.reason??'');
              dispatch=noDispatch?'not_attempted':kind;if(result.status==='unusable')failure_phase='provider';
            }
          }catch{result=unusableDecision('DECISION_UNAVAILABLE',kind);failure_phase='transport_or_current_authority';}
          finally{try{budgets.settle(scope,p.observation_id,result.usage);}catch{/* Original reservation stays held; never retry. */}}
        }
      }
      const s=this.#guard(scope,p);
      return this.k.transaction(()=>{
        this.#guard(scope,p);const snap=p.snapshot,answers=result.status==='usable'?result.answers:null;
        const cannot=!answers||Object.values(answers).some(a=>a.type!=='choice'||a.choice==='cannot_assess');
        const receipt=this.#store(s,{schema_version:1,kind:OBSERVATION,id:p.observation_id,case_id:p.input.case_id,task_id:p.input.task_id,approval_id:p.approval.id,approval_digest:p.approval.receipt_digest,invocation_digest:p.invocation_digest,
          configuration_id:p.input.configuration_id,configuration_version:p.configuration.version,configuration_digest:p.configuration.digest,catalog_digest:p.entry.digest,purpose:IMAGE_PURPOSE,
          source:p.approval.source,derivative:{sha256:p.approval.source.sha256,transformation:IMAGE_TRANSFORMATION,persistent_copy:false},
          case_configuration_digest:snap.case_configuration_digest,profile_digest:snap.profile_digest,profile_revision:snap.profile_revision,skill_digest:snap.skill_digest,question_resource_digest:snap.question_resource_digest,question_set_digest:snap.question_set_digest,
          input_hash:snap.input_hash,submitted_text_hash:snap.submitted_text_hash,evidence_hash:snap.evidence_hash,claims_digest:snap.claims_digest,preprocessing_version:snap.preprocessing_version,gaps:snap.gaps,truncated:false,
          result,handling:cannot?'cannot_assess':'review',failure_phase,provenance:{transport_kind:kind,reader_configuration_digest:p.entry.reader.configuration_digest,dispatch,live_inference_observed:false},business_effects:0,routing_changed:false,execution_authorized:false,observed_at:this.k.clock()});
        return this.read(scope,p.input.case_id,receipt.id);
      });
    }finally{bytes?.fill(0);this.#prepared.delete(handle);}
  }
  run(scope:Scope,input:unknown){return this.execute(scope,this.prepare(scope,input));}
  read(scope:Scope,caseId:string,observationId:string){
    const c=new CaseConfigurations(this.k).inspect(scope,id(caseId)),s=this.k.authorize(scope,'return.read',c.resource_id);this.k.authorize(scope,'task.read');
    const r=this.#stored(s,observationId,OBSERVATION),task=this.reads.task(scope,r.task_id);
    if(r.case_id!==c.id||task.order_id!==c.resource_id||r.business_effects!==0||r.routing_changed!==false||r.execution_authorized!==false||r.truncated!==false||r.purpose!==IMAGE_PURPOSE)throw new Error('IMAGE_RECEIPT_INTEGRITY');
    const source=this.#source(scope,c.id,r.source.evidence_id);if(canonical(source)!==canonical(r.source)||r.derivative.sha256!==source.sha256||r.derivative.transformation!==IMAGE_TRANSFORMATION||r.derivative.persistent_copy!==false)throw new Error('IMAGE_RECEIPT_INTEGRITY');
    const cfg=documentRow(this.k,s,CONFIG,r.configuration_id,r.configuration_version);
    if(cfg.digest!==r.configuration_digest||cfg.body.catalog_digest!==r.catalog_digest||cfg.body.reader_configuration_digest!==r.provenance.reader_configuration_digest||cfg.body.purpose!==IMAGE_PURPOSE||cfg.body.evidence_kind!==r.result?.evidence_kind||cfg.body.evidence_kind!==r.provenance.transport_kind||r.provenance.live_inference_observed!==false)throw new Error('IMAGE_RECEIPT_INTEGRITY');
    const questions=Object.fromEntries(IMAGE_QUESTION_IDS.map(q=>[q,{type:'choice',instructions:'Validate historical image observations.',options:{yes:'Yes.',no:'No.',cannot_assess:'Cannot assess.'}}]));
    const normalized=validateDecisionResult({task_id:'return_image_usability',question_set_id:'historical_image_receipt',question_set_digest:r.question_set_digest,serving_configuration_ref:r.configuration_id,state:'Historical typed receipt validation only.',questions},r.result);
    if(canonical(normalized)!==canonical(r.result)||![null,'clef-omni',IMAGE_MODEL].includes(r.result.serving.reported_model)||r.result.serving.revision!==null)throw new Error('IMAGE_RECEIPT_INTEGRITY');
    const cannot=r.result.status!=='usable'||Object.values(r.result.answers).some((a:any)=>a.choice==='cannot_assess');if(r.handling!==(cannot?'cannot_assess':'review'))throw new Error('IMAGE_RECEIPT_INTEGRITY');
    const result=freeze(r);OBSERVED.add(result);return result;
  }
  disagree(scope:Scope,input:unknown){
    const p=exact(jsonValue(input),['case_id','observation_id','reason']);if(!['image_unclear','wrong_item','detail_not_visible','other_review'].includes(p.reason))throw new Error('INVALID_INPUT');
    return this.k.transaction(()=>{const c=new CaseConfigurations(this.k).inspect(scope,id(p.case_id)),s=this.k.authorize(scope,'return.review',c.resource_id),r=this.read(scope,c.id,id(p.observation_id));
      return freeze(this.#store(s,{schema_version:1,kind:'image_disagreement',id:'imagedisagree_'+token().slice(0,32),case_id:c.id,task_id:r.task_id,approval_id:r.approval_id,observation_id:r.id,observation_digest:r.receipt_digest,source:r.source,reason:p.reason,reviewer_id:s.actor_id,business_effects:0,execution_authorized:false,observed_at:this.k.clock()}));
    });
  }
}
