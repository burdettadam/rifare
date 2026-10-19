import {exact,id,integer} from './kernel.mts';
import type {CommerceKernel,Scope,Row} from './kernel.mts';
import {canonical,contentDigest,jsonValue} from './configuration-values.mts';
import {ReadContext} from './read-context.mts';
import {SecretVault} from './secrets.mts';
import {CaseConfigurations} from './case-configurations.mts';
import {assertSupportOwner,checkedDocument,documentRow,saveDocument} from './support-core.mts';
import {assertExecution} from './execution-stops.mts';
import {ModelBudgets} from './model-budgets.mts';
import {DecisionResources} from './decision-resources.mts';
import {unusableDecision,validateDecisionResult} from '../agent/decisions.mts';
import type {DecisionResult,DecisionFailure} from '../agent/decisions.mts';
import {WORKERS_AI_ADAPTER,WORKERS_AI_MODEL} from '../agent/workers-ai.mts';
import type {WorkersAIReader} from '../agent/workers-ai.mts';

type ServingConfiguration={id:string;tenant_id:string;store_id:string;secret_ref:string;reader:WorkersAIReader};
type CatalogEntry=ServingConfiguration&{digest:string};
const KIND='decision_shadow';
const PURPOSE='authorized_return_intake_text';
const OBSERVED=new WeakSet<object>();
const hash=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function freeze<T>(value:T):T{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function core(value:Row){const {receipt_digest,...body}=value;return body;}

/** Only a current-authorized canonical read/run can brand a receipt. A caller
 * cannot authenticate fixture/live provenance by recomputing a public hash. */
export function verifyDecisionReceipt(value:unknown):Row{
  if(!value||typeof value!=='object'||!OBSERVED.has(value)||!hash((value as Row).receipt_digest)
    ||contentDigest(core(value as Row))!==(value as Row).receipt_digest)throw new Error('DECISION_RECEIPT_INTEGRITY');
  return value as Row;
}

export class DecisionShadow {
  readonly k:CommerceKernel;readonly reads:ReadContext;
  #vault:SecretVault;#catalog=new Map<string,CatalogEntry>();#prepared=new WeakMap<object,Row>();
  constructor(k:CommerceKernel,reads:ReadContext,vault:SecretVault,configurations:ServingConfiguration[]){
    this.k=k;this.reads=reads;this.#vault=vault;
    if(!Array.isArray(configurations)||configurations.length>64)throw new Error('DECISION_CONFIGURATION_INVALID');
    for(const config of configurations){
      exact(config,['id','tenant_id','store_id','secret_ref','reader']);
      for(const key of ['id','tenant_id','store_id','secret_ref'] as const)id(config[key]);
      const reader=config.reader;
      if(!reader||reader.provider!=='cloudflare'||reader.serving_configuration_ref!==config.id||!hash(reader.configuration_digest)
        ||!Object.isFrozen(reader)||!['synthetic_wire_fixture','live_test_unqualified'].includes(reader.evidence_kind))throw new Error('DECISION_CONFIGURATION_INVALID');
      const key=canonical([config.tenant_id,config.store_id,config.id]);if(this.#catalog.has(key))throw new Error('DECISION_CONFIGURATION_INVALID');
      const descriptor={id:config.id,tenant_id:config.tenant_id,store_id:config.store_id,secret_ref:config.secret_ref,
        reader_configuration_digest:reader.configuration_digest,evidence_kind:reader.evidence_kind,capabilities:reader.capabilities};
      this.#catalog.set(key,Object.freeze({...config,digest:contentDigest(descriptor)}));
    }
  }
  #entry(s:Row,ref:string){const entry=this.#catalog.get(canonical([s.tenant_id,s.store_id,id(ref)]));if(!entry)throw new Error('NOT_FOUND');return entry;}
  configure(scope:Scope,input:unknown){
    const p=exact(jsonValue(input),['id','expected_version','enabled','expires_at']);id(p.id);integer(p.expected_version);integer(p.expires_at);
    if(typeof p.enabled!=='boolean'||p.expires_at<=this.k.clock()||p.expires_at>this.k.clock()+31*86400000)throw new Error('DECISION_CONFIGURATION_INVALID');
    return this.k.transaction(()=>{const s=this.k.authorize(scope,'support.configure'),entry=this.#entry(s,p.id);
      const body={serving_configuration_ref:entry.id,catalog_digest:entry.digest,reader_configuration_digest:entry.reader.configuration_digest,
        evidence_kind:entry.reader.evidence_kind,mode:'shadow',purpose:PURPOSE,enabled:p.enabled};
      const r=saveDocument(this.k,s,KIND,p.id,p.expected_version,body,'active',p.expires_at);
      return {id:r.id,version:r.version,configuration_digest:r.digest,enabled:p.enabled,mode:'shadow',execution_authorized:false};});
  }
  #configuration(scope:Scope,ref:string){
    const s=this.k.require(scope),entry=this.#entry(s,ref),r=checkedDocument(this.k,s,KIND,ref);
    exact(r.body,['serving_configuration_ref','catalog_digest','reader_configuration_digest','evidence_kind','mode','purpose','enabled']);
    if(r.body.serving_configuration_ref!==entry.id||r.body.catalog_digest!==entry.digest||r.body.reader_configuration_digest!==entry.reader.configuration_digest
      ||r.body.evidence_kind!==entry.reader.evidence_kind||r.body.mode!=='shadow'||r.body.purpose!==PURPOSE||typeof r.body.enabled!=='boolean')throw new Error('DECISION_CONFIGURATION_CHANGED');
    return {entry,record:r};
  }
  #input(input:unknown){const p=exact(jsonValue(input),['case_id','task_id','configuration_id','request_id']);for(const v of Object.values(p))id(v);return p;}
  snapshot(scope:Scope,input:unknown){
    const p=this.#input(input),{entry}=this.#configuration(scope,p.configuration_id);
    this.k.authorize(scope,'model.run');assertSupportOwner(this.k,scope,p.case_id);
    return new DecisionResources(this.k,this.reads,entry.reader.capabilities).snapshot(scope,{case_id:p.case_id,task_id:p.task_id,serving_configuration_ref:p.configuration_id});
  }
  prepare(scope:Scope,input:unknown){
    const p=this.#input(input),k=this.k,s=k.authorize(scope,'model.run'),ownership=assertSupportOwner(k,scope,p.case_id);
    const cfg=this.#configuration(scope,p.configuration_id),snapshot=this.snapshot(scope,p),stamp=assertExecution(k,s,'model.run').stamp;
    const observationId='decision_'+contentDigest([s.tenant_id,s.store_id,p.case_id,p.request_id]).slice(0,40),invocation_digest=contentDigest(p);
    const previous=k.db.prepare('SELECT body FROM commerce_assistance_receipts WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,observationId) as Row|undefined;
    if(previous){const r=this.read(scope,p.case_id,observationId);if(r.invocation_digest!==invocation_digest)throw new Error('DECISION_OBSERVATION_CONFLICT');}
    const handle=Object.freeze({id:observationId,mode:'shadow',execution_authorized:false});
    this.#prepared.set(handle,{input:p,snapshot,entry:cfg.entry,configuration:cfg.record,actor:s.actor_id,session:s.token_hash,tenant:s.tenant_id,store:s.store_id,
      ownership_generation:ownership.owner.generation,stamp,observation_id:observationId,invocation_digest,replay:!!previous,consumed:false});
    return handle;
  }
  #guard(scope:Scope,p:Row){
    const k=this.k,s=k.authorize(scope,'model.run');
    if(s.tenant_id!==p.tenant||s.store_id!==p.store||s.actor_id!==p.actor||s.token_hash!==p.session)throw new Error('ACCESS_DENIED');
    assertSupportOwner(k,scope,p.input.case_id,p.ownership_generation,p.actor);assertExecution(k,s,'model.run',p.stamp);
    const cfg=this.#configuration(scope,p.input.configuration_id);
    if(cfg.record.version!==p.configuration.version||cfg.record.digest!==p.configuration.digest)throw new Error('DECISION_CONFIGURATION_CHANGED');
    const current=this.snapshot(scope,p.input);
    if(current.evidence_hash!==p.snapshot.evidence_hash||current.input_hash!==p.snapshot.input_hash||current.status!==p.snapshot.status)throw new Error('DECISION_EVIDENCE_CHANGED');
    return s;
  }
  async execute(scope:Scope,handle:object){
    const p=this.#prepared.get(handle);if(!p||p.consumed)throw new Error('DECISION_PREPARATION_INVALID');
    p.consumed=true;this.#prepared.delete(handle);this.#guard(scope,p);
    if(p.replay)return this.read(scope,p.input.case_id,p.observation_id);
    const kind=p.entry.reader.evidence_kind,budgets=new ModelBudgets(this.k);let result:DecisionResult;
    let dispatch='not_attempted',failure_phase:string|null=null,reserved=false;
    if(!p.configuration.body.enabled){result=unusableDecision('DECISION_DISABLED',kind);failure_phase='configuration';}
    else if(p.snapshot.status!=='ready'){result=unusableDecision(p.snapshot.reason as DecisionFailure,kind);failure_phase='evidence';}
    else {
      try {
        // The existing budget API needs an internal positive output bound. This
        // field is never added to the Clef wire body; actual zero usage is valid.
        const reservation=budgets.reserve(scope,'cloudflare',p.observation_id,{max_output_tokens:1,decision:p.snapshot.request});
        if(reservation.duplicate)throw new Error('DECISION_OBSERVATION_IN_PROGRESS');reserved=true;
      }catch(error){
        // An earlier attempt owns this identity, including its held budget and
        // eventual receipt. A concurrent preparation cannot replace that result.
        if(error instanceof Error&&['DECISION_OBSERVATION_IN_PROGRESS','BUDGET_IDEMPOTENCY_CONFLICT'].includes(error.message))throw new Error('DECISION_OBSERVATION_IN_PROGRESS');
        result=unusableDecision('DECISION_UNAVAILABLE',kind);failure_phase='budget';
      }
      if(reserved){
        this.#guard(scope,p);
        try{
          this.k.authorize(scope,'secret.invoke');
          dispatch='transport_unconfirmed';
          const value=await this.#vault.invokeReader(scope,p.entry.secret_ref,WORKERS_AI_ADAPTER,
            {request:p.snapshot.request,expected_configuration_digest:p.entry.reader.configuration_digest});
          result=validateDecisionResult(p.snapshot.request,value);
          if(result.evidence_kind!==kind)result=unusableDecision('DECISION_OUTPUT_INVALID',kind);
          dispatch=['DECISION_DISABLED','DECISION_REQUEST_INVALID','DECISION_CONTEXT_LIMIT','DECISION_CAPABILITY_UNAVAILABLE','DECISION_DESTINATION_UNAPPROVED','DECISION_CREDENTIAL_UNAVAILABLE','DECISION_CONFIGURATION_CHANGED'].includes(result.reason??'')?'not_attempted':kind;
          if(result.status==='unusable')failure_phase='provider';
        }catch(error){
          const credential=error instanceof Error&&error.message==='SECRET_UNAVAILABLE';
          if(credential)dispatch='not_attempted';
          result=unusableDecision(credential?'DECISION_CREDENTIAL_UNAVAILABLE':'DECISION_UNAVAILABLE',kind);failure_phase='credential_or_current_authority';
        }
        // Revocation can make settlement unavailable; leaving the existing
        // reservation held is conservative and never triggers another call.
        try{budgets.settle(scope,p.observation_id,result!.usage);}catch{}
      }
    }
    const s=this.#guard(scope,p);
    return this.k.transaction(()=>{
      this.#guard(scope,p);
      const snap=p.snapshot,previous=this.k.db.prepare(`SELECT count(*) n FROM commerce_assistance_receipts a JOIN commerce_context_tasks t
        ON a.tenant_id=t.tenant_id AND a.store_id=t.store_id AND a.task_id=t.id WHERE a.tenant_id=? AND a.store_id=? AND t.resource_id=? AND json_extract(a.body,'$.kind')=? AND json_extract(a.body,'$.case_id')=?`)
        .get(s.tenant_id,s.store_id,snap.resource_id,KIND,p.input.case_id) as Row;
      const labels=result!.status==='usable'?Object.fromEntries(Object.entries(result!.answers).map(([q,a])=>[q,a.type==='choice'?a.choice:null])):{};
      const receipt={schema_version:1,kind:KIND,id:p.observation_id,case_id:p.input.case_id,task_id:p.input.task_id,sequence:previous.n+1,invocation_digest:p.invocation_digest,
        configuration_id:p.input.configuration_id,configuration_version:p.configuration.version,configuration_digest:p.configuration.digest,catalog_digest:p.entry.digest,
        case_configuration_digest:snap.case_configuration_digest,profile_digest:snap.profile_digest,profile_revision:snap.profile_revision,skill_digest:snap.skill_digest,
        question_resource_digest:snap.question_resource_digest,question_set_digest:snap.question_set_digest,profile_variant:snap.profile_variant,
        input_hash:snap.input_hash,submitted_text_hash:snap.submitted_text_hash,evidence_hash:snap.evidence_hash,claims_digest:snap.claims_digest,
        preprocessing_version:snap.preprocessing_version,gaps:snap.gaps,truncated:false,result:result!,handling:result!.status==='usable'&&!Object.values(labels).includes('other_unclear')?'classification':'review',failure_phase,
        provenance:{transport_kind:kind,reader_configuration_digest:p.entry.reader.configuration_digest,dispatch,live_inference_observed:kind==='live_test_unqualified'&&result!.status==='usable'},
        business_effects:0,routing_changed:false,execution_authorized:false,observed_at:this.k.clock()};
      const value={...receipt,receipt_digest:contentDigest(receipt)};
      this.k.db.prepare('INSERT INTO commerce_assistance_receipts VALUES(?,?,?,?,?,?)').run(s.tenant_id,s.store_id,value.id,value.task_id,value.observed_at,canonical(value));
      return this.read(scope,p.input.case_id,value.id);
    });
  }
  async run(scope:Scope,input:unknown){return this.execute(scope,this.prepare(scope,input));}
  read(scope:Scope,caseId:string,observationId:string){
    const k=this.k,c=new CaseConfigurations(k).inspect(scope,id(caseId)),s=k.authorize(scope,'return.read',c.resource_id);k.authorize(scope,'task.read');
    const row=k.db.prepare(`SELECT a.body,a.task_id,t.resource_id FROM commerce_assistance_receipts a JOIN commerce_context_tasks t
      ON a.tenant_id=t.tenant_id AND a.store_id=t.store_id AND a.task_id=t.id WHERE a.tenant_id=? AND a.store_id=? AND a.id=?`).get(s.tenant_id,s.store_id,id(observationId)) as Row|undefined;
    if(!row||row.resource_id!==c.resource_id)throw new Error('NOT_FOUND');
    const value=jsonValue(JSON.parse(row.body));
    if(value.kind!==KIND||value.schema_version!==1||value.case_id!==c.id||value.task_id!==row.task_id||value.id!==observationId
      ||!hash(value.receipt_digest)||contentDigest(core(value))!==value.receipt_digest||value.business_effects!==0||value.routing_changed!==false||value.execution_authorized!==false||value.truncated!==false)throw new Error('DECISION_RECEIPT_INTEGRITY');
    const cfg=documentRow(k,s,KIND,value.configuration_id,value.configuration_version);
    if(cfg.digest!==value.configuration_digest||cfg.body.catalog_digest!==value.catalog_digest||cfg.body.reader_configuration_digest!==value.provenance?.reader_configuration_digest
      ||cfg.body.mode!=='shadow'||cfg.body.purpose!==PURPOSE||cfg.body.evidence_kind!==value.provenance?.transport_kind||value.result?.evidence_kind!==cfg.body.evidence_kind
      ||value.provenance.live_inference_observed!==(cfg.body.evidence_kind==='live_test_unqualified'&&value.result?.status==='usable'))throw new Error('DECISION_RECEIPT_INTEGRITY');
    const normalized=validateDecisionResult({task_id:'return_intake_shadow',question_set_id:'historical_receipt',question_set_digest:value.question_set_digest,serving_configuration_ref:value.configuration_id,state:'Historical receipt validation only.',questions:{
      reported_problem:{type:'choice',instructions:'Validate stored labels.',options:{damaged:'Damaged.',size_fit:'Size or fit.',other_unclear:'Other or unclear.'}},
      requested_resolution:{type:'choice',instructions:'Validate stored labels.',options:{refund:'Refund.',exchange:'Exchange.',other_unclear:'Other or unclear.'}}}},value.result);
    if(canonical(normalized)!==canonical(value.result)||![null,'clef-flash',WORKERS_AI_MODEL].includes(value.result.serving.reported_model)||value.result.serving.revision!==null)throw new Error('DECISION_RECEIPT_INTEGRITY');
    const result=freeze(value);OBSERVED.add(result);return result;
  }
  verifyReceipt(value:unknown){return verifyDecisionReceipt(value);}
  view(scope:Scope,caseId:string,observationId:string){
    const r=this.read(scope,caseId,observationId),answers=r.result.status==='usable'?r.result.answers:null;
    return {observation_id:r.id,mode:'shadow',status:r.result.status,reported_problem:answers?.reported_problem.choice??null,requested_resolution:answers?.requested_resolution.choice??null,
      handling:r.handling,reason:r.result.reason,gaps:r.gaps,evidence_kind:r.provenance.transport_kind,execution_authorized:false,manual_workflow_available:true};
  }
}
