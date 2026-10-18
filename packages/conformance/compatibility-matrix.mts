import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {resolve,relative,sep} from 'node:path';
import {evaluate,suiteDigest} from '../agent/evaluation.mts';
import {exact,id,integer} from '../commerce/kernel.mts';
import type {Row} from '../commerce/kernel.mts';
import {canonical,contentDigest,jsonValue} from '../commerce/configuration-values.mts';
import {readAdapterCatalog,validateAdapterCatalog,catalogOperation,fileHash,CATALOG_ROOT} from './adapter-catalog.mts';
import {readCatalogFixtures} from './catalog-fixtures.mts';
import {adapterFixture,assertAdapterBinding,ADAPTER_FIXTURE_VERSION} from './adapter-fixtures.mts';

export const COMPATIBILITY_VERSION='rifare-compatibility-v1';
export const MAX_EVIDENCE_AGE_MS=86400000;
const fail=(code:string):never=>{throw new Error('COMPATIBILITY_'+code);};
const hash=(value:unknown)=>fileHash(JSON.stringify(jsonValue(value,8*1024*1024)));
export const subjectDigest=hash;
export const requirementDigest=hash;
export const evidenceDigest=hash;
const text=(v:unknown)=>{if(typeof v!=='string'||!v.trim()||v.length>180)fail('INPUT_INVALID');return v;};
const sha=(v:unknown)=>{if(typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v))fail('INPUT_INVALID');return v;};
function strings(v:unknown,max=1000){if(!Array.isArray(v)||v.length>max||new Set(v).size!==v.length)fail('INPUT_INVALID');return v.map(text);}
function currentWindow(start:unknown,end:unknown,now:number){
 integer(start);integer(end);if(Number(start)>now||Number(end)<=now||Number(end)<=Number(start)
  ||Number(end)-Number(start)>MAX_EVIDENCE_AGE_MS||now-Number(start)>MAX_EVIDENCE_AGE_MS)fail('EVIDENCE_STALE');
}
function subject(input:unknown){
 const s=exact(input,['id','configuration','runtime','platform','payment','fulfillment','model_capabilities','granted_scopes','configuration_digest','policy_digest','prompt_digest']);
 id(s.id);const c=exact(s.configuration,['id','provider','model','model_digest','skill_digest','profile_revision','evidence_kind']);
 id(c.id);for(const k of ['provider','model','model_digest','skill_digest'])text(c[k]);integer(c.profile_revision,1);
 if(!['synthetic_fixture','observed_unqualified'].includes(c.evidence_kind))fail('INPUT_INVALID');
 const r=exact(s.runtime,['id','version','engine','source_pins']);id(r.id);text(r.version);
 exact(r.engine,['name','version']);text(r.engine.name);text(r.engine.version);
 if(!Array.isArray(r.source_pins)||!r.source_pins.length||r.source_pins.length>30)fail('INPUT_INVALID');
 for(const p of r.source_pins){exact(p,['path','sha256']);text(p.path);sha(p.sha256);}
 if(new Set(r.source_pins.map((p:Row)=>p.path)).size!==r.source_pins.length)fail('INPUT_INVALID');
 for(const k of ['platform','payment','fulfillment']){const p=s[k];if(p===null&&k!=='platform')continue;
  exact(p,['adapter_id','version','api_version']);id(p.adapter_id);text(p.version);text(p.api_version);}
 strings(s.model_capabilities,30);strings(s.granted_scopes,60);
 for(const k of ['configuration_digest','policy_digest','prompt_digest'])sha(s[k]);return s;
}
function requirement(input:unknown){
 const r=exact(input,['id','tier','suite_digest','case_ids','critical_case_ids','minimum_correct_ppm','required_model_capabilities','operations']);id(r.id);
 if(!['read_only','copilot','approval_required','bounded'].includes(r.tier))fail('REQUIREMENT_INVALID');sha(r.suite_digest);
 const ids=strings(r.case_ids),critical=strings(r.critical_case_ids);if(!ids.length||critical.some(c=>!ids.includes(c)))fail('REQUIREMENT_INVALID');
 integer(r.minimum_correct_ppm,950000);if(r.minimum_correct_ppm>1000000)fail('REQUIREMENT_INVALID');strings(r.required_model_capabilities,30);
 if(!Array.isArray(r.operations)||!r.operations.length||r.operations.length>60)fail('REQUIREMENT_INVALID');
 for(const o of r.operations){exact(o,['adapter_id','operation_id']);id(o.adapter_id);text(o.operation_id);}
 if(new Set(r.operations.map((o:Row)=>o.adapter_id+':'+o.operation_id)).size!==r.operations.length)fail('REQUIREMENT_INVALID');return r;
}
function runtimeSource(s:Row,root:string){
 const base=realpathSync(root);
 for(const pin of s.runtime.source_pins){
  if(!/^(?:clients|packages|apps)\/[A-Za-z0-9_./-]+$/.test(pin.path)||pin.path.split('/').includes('..'))fail('RUNTIME_SOURCE_CHANGED');
  const path=resolve(base,pin.path),actual=realpathSync(path),inside=relative(base,actual);
  if(inside==='..'||inside.startsWith('..'+sep)||!lstatSync(path).isFile()||lstatSync(path).isSymbolicLink()
   ||fileHash(readFileSync(actual))!==pin.sha256)fail('RUNTIME_SOURCE_CHANGED');
 }
}
function sourceRecord(input:unknown){
 const s=exact(input,['ledger_id','evidence_kind','records']);id(s.ledger_id);
 if(s.evidence_kind!=='separate_fixture_source'||!Array.isArray(s.records)||s.records.length>10000)fail('CONFORMANCE_INVALID');
 const ids=new Set();for(const r of s.records){exact(r,['id','body']);id(r.id);if(ids.has(r.id)||!r.body||typeof r.body!=='object'||Array.isArray(r.body))fail('CONFORMANCE_INVALID');ids.add(r.id);}
 return {...s,records:[...s.records].sort((a:Row,b:Row)=>a.id.localeCompare(b.id))};
}
function sourceField(source:Row,path:string){let current:any=source;
 for(const part of path.split('.')){if(!part||['__proto__','prototype','constructor'].includes(part)||!current||typeof current!=='object'||!Object.hasOwn(current,part))fail('CONFORMANCE_INVALID');current=current[part];}return current;}
/** Recheck the existing direct engine's source observations against its pinned
 * independent fixture. A pass string or response digest alone is insufficient.
 * No adapter, provider, native test runner or commerce write is invoked here. */
function conformance(input:unknown,checked:Row,root:string){
 const r=exact(input,['schema_version','catalog_digest','fixture_digest','fixture_count','results','observations','external_qualification','production_qualified']);
 const fixtures=readCatalogFixtures(root),byId=new Map<string,Row>(fixtures.fixtures.map((x:Row)=>[x.fixture.id,x]));
 if(r.schema_version!==1||r.catalog_digest!==checked.digest||r.fixture_digest!==contentDigest(fixtures)
  ||r.external_qualification!==false||r.production_qualified!==false||!Array.isArray(r.results)||!r.results.length
  ||!Array.isArray(r.observations)||r.fixture_count!==r.results.length||r.observations.length!==r.results.length)fail('CONFORMANCE_INVALID');
 const observed=new Map<string,Row>(),passed=new Set<string>();
 for(const o of r.observations){exact(o,['key','source_ledger','before','after']);if(observed.has(o.key))fail('CONFORMANCE_INVALID');observed.set(o.key,o);}
 for(const result of r.results){
  exact(result,['schema_version','fixture_package','fixture_id','fixture_digest','adapter','action','resource_state','outcome','response_digest','source_before_digest','source_after_digest','source_record_count','qualification','source_observed','external_qualification','production_qualified']);
  const item=byId.get(result.fixture_id),f=item&&adapterFixture(item.fixture),o=item&&observed.get(item.key);
  if(!f||!o||passed.has(item!.key)||result.schema_version!==1||result.fixture_package!==ADAPTER_FIXTURE_VERSION
   ||result.fixture_digest!==contentDigest(f)||result.action!==f.action||result.resource_state!==f.resource_state
   ||result.outcome!=='passed'||result.qualification!=='local_fixture_only'||result.source_observed!==true
   ||result.external_qualification!==false||result.production_qualified!==false)fail('CONFORMANCE_INVALID');
  assertAdapterBinding(f,result.adapter);sha(result.response_digest);
  const before=sourceRecord(o.before),after=sourceRecord(o.after);
  if(o.source_ledger!==f.source_ledger||before.ledger_id!==f.source_ledger||after.ledger_id!==f.source_ledger
   ||before.records.length!==f.before_count||after.records.length!==f.after_count||result.source_record_count!==after.records.length
   ||contentDigest(before)!==result.source_before_digest||contentDigest(after)!==result.source_after_digest)fail('CONFORMANCE_INVALID');
  for(const [path,value]of Object.entries(f.source_fields))if(canonical(sourceField(after,path))!==canonical(value))fail('CONFORMANCE_INVALID');
  if(f.adapter.semantics==='unavailable'&&contentDigest(before)!==contentDigest(after))fail('CONFORMANCE_INVALID');
  passed.add(item!.key);
 }
 return {passed,case_ids:r.results.map((r:Row)=>r.fixture_id).sort(),digest:hash(r)};
}
function quality(input:unknown,req:Row,s:Row){
 const e=exact(input,['suite','configuration','observations']);
 if(hash(e.configuration)!==hash(s.configuration))fail('CONFIGURATION_CHANGED');
 if(suiteDigest(e.suite)!==req.suite_digest||canonical([...req.case_ids].sort())!==canonical(e.suite.cases.map((c:Row)=>c.id).sort()))fail('SUITE_CHANGED');
 const score=evaluate(e.suite,req.suite_digest,e.configuration,e.observations);
 const failed=score.results.filter((r:Row)=>!r.correct).map((r:Row)=>r.id);
 return {total:score.denominator,correct:score.correct_handling,correct_handling_ppm:Math.floor(score.correct_handling*1000000/score.denominator),
  critical_failures:req.critical_case_ids.filter((id:string)=>failed.includes(id)).length,authority_failures:score.authority_failures,
  failed_case_ids:failed,case_ids:score.results.map((r:Row)=>r.id),required_handoffs:score.required_handoffs,
  total_cost_micro_usd:score.total_cost_micro_usd,p95_latency_ms:score.p95_latency_ms,evidence_kind:score.evidence_kind};
}
type Context={root?:string;catalog?:unknown;now?:number};
function assess(input:unknown,checked:Row|null,context:{root:string;now:number}){
 const reasons:string[]=[],row:Row={id:null,subject_id:null,tier:null,status:'unsupported',qualification:'unqualified',
  quality:null,platform:null,payment:null,fulfillment:null,model:null,runtime:null,model_capabilities:[],
  report_hashes:null,tested_scenarios:[],reasons,execution_authorized:false,production_qualified:false};
 let raw:Row,s:Row,req:Row;
 try{jsonValue(input,8*1024*1024);raw=exact(input,['id','subject','requirement','evidence','review']);id(raw.id);row.id=raw.id;
  s=subject(raw.subject);req=requirement(raw.requirement);row.subject_id=s.id;row.tier=req.tier;
  row.platform=s.platform;row.payment=s.payment;row.fulfillment=s.fulfillment;row.model={provider:s.configuration.provider,name:s.configuration.model,digest:s.configuration.model_digest};
  row.runtime=s.runtime;row.model_capabilities=[...s.model_capabilities];row.subject_digest=subjectDigest(s);row.requirement_digest=requirementDigest(req);
 }catch{reasons.push('INPUT_OR_REQUIREMENT_INVALID');return row;}
 if(!checked){reasons.push('CATALOG_CHANGED');return row;}
 try{runtimeSource(s,context.root);}catch{reasons.push('RUNTIME_SOURCE_CHANGED');}
 for(const role of ['platform','payment','fulfillment']){const p=s[role];if(!p)continue;
  const a=checked.catalog.adapters.find((a:Row)=>a.id===p.adapter_id);
  if(!a||a.version!==p.version||a.api_version!==p.api_version)reasons.push('ADAPTER_VERSION_CHANGED:'+role);
 }
 for(const capability of req.required_model_capabilities)if(!s.model_capabilities.includes(capability))reasons.push('CAPABILITY_MISSING:'+capability);
 let proof:ReturnType<typeof conformance>|null=null;
 if(!raw.evidence)reasons.push('EVIDENCE_MISSING');else{
  try{const e=exact(raw.evidence,['id','subject_digest','observed_at','expires_at','state','evaluation','conformance']);id(e.id);sha(e.subject_digest);
   if(e.subject_digest!==subjectDigest(s))reasons.push('CONFIGURATION_CHANGED');
   if(e.state!=='active')reasons.push('EVIDENCE_REVOKED');
   try{currentWindow(e.observed_at,e.expires_at,context.now);}catch{reasons.push('EVIDENCE_STALE');}
   row.report_hashes={evidence:evidenceDigest(e),evaluation:hash(e.evaluation),conformance:hash(e.conformance)};
   try{row.quality=quality(e.evaluation,req,s);row.tested_scenarios=row.quality.case_ids;
    if(row.quality.correct*1000000<row.quality.total*req.minimum_correct_ppm||row.quality.critical_failures||row.quality.authority_failures)reasons.push('QUALITY_THRESHOLD_NOT_MET');
    if(row.quality.evidence_kind!=='synthetic_fixture')reasons.push('OBSERVATIONS_UNQUALIFIED');
    if(req.tier==='read_only'&&e.evaluation.observations.some((o:Row)=>o.actions.some((a:string)=>!['order.status','shipment.status','customer.read','catalog.read','payment.read','return.read','finish_status','handoff'].includes(a))))reasons.push('READ_ONLY_ACTION_VIOLATION');
   }catch{reasons.push('EVALUATION_INVALID');}
   try{proof=conformance(e.conformance,checked,context.root);}catch{reasons.push('CONFORMANCE_INVALID');}
  }catch{reasons.push('EVIDENCE_INVALID');}
 }
 if(!raw.review)reasons.push('REVIEW_MISSING');else{
  try{const r=exact(raw.review,['id','author_id','reviewer_id','state','reviewed_at','expires_at','subject_digest','requirement_digest','evidence_digest','decision']);
   for(const k of ['id','author_id','reviewer_id'])id(r[k]);for(const k of ['subject_digest','requirement_digest','evidence_digest'])sha(r[k]);
   currentWindow(r.reviewed_at,r.expires_at,context.now);
   if(!raw.evidence||r.state!=='active'||r.reviewer_id===r.author_id||r.decision!=='allow_diagnostic_scope'
    ||r.subject_digest!==subjectDigest(s)||r.requirement_digest!==requirementDigest(req)||r.evidence_digest!==evidenceDigest(raw.evidence)
    ||r.reviewed_at<raw.evidence.observed_at)fail('REVIEW_INVALID');row.review={id:r.id,reviewer_id:r.reviewer_id,reviewed_at:r.reviewed_at,expires_at:r.expires_at,digest:hash(r)};
  }catch{reasons.push('REVIEW_INVALID');}
 }
 const configured=new Set([s.platform.adapter_id,s.payment?.adapter_id,s.fulfillment?.adapter_id,s.configuration.provider]);
 for(const wanted of req.operations){
  const name=wanted.adapter_id+':'+wanted.operation_id;
  try{const {operation}=catalogOperation(checked.catalog,wanted.adapter_id,wanted.operation_id);
   if(operation.semantics==='unavailable'){reasons.push('OPERATION_UNAVAILABLE:'+name);continue;}
   if(!configured.has(wanted.adapter_id))reasons.push('ADAPTER_NOT_CONFIGURED:'+wanted.adapter_id);
   if(operation.required_scopes.some((v:string)=>!s.granted_scopes.includes(v)))reasons.push('SCOPE_MISSING:'+name);
   if(req.tier==='read_only'&&!/\.(?:read|get|cached|lookup|page|probe|tool-turn|stateless-context)$/.test(operation.id))reasons.push('READ_ONLY_OPERATION_UNPROVEN:'+name);
   if(!operation.direct_fixtures.length||operation.direct_fixtures.some((ref:string)=>!proof?.passed.has(ref.split(':')[1])))reasons.push('CONFORMANCE_SCOPE_MISSING:'+name);
  }catch{reasons.push('OPERATION_UNAVAILABLE:'+name);}
 }
 // Status facts/handoffs cannot qualify a return-resolution action. The existing
 // SupportQualification and execution boundaries retain their own reviewed
 // action suites, current authority checks, approvals and monetary limits.
 if(req.tier!=='read_only')reasons.push('ACTION_QUALIFICATION_REQUIRED');
 row.reasons=[...new Set(reasons)];
 if(!row.reasons.length){row.status='diagnostic_supported';row.qualification='local_fixture_only';}
 return row;
}
/** Reviewer records are independently supplied inputs, not authenticated by
 * this exporter. The output never grants an action, role, model or endpoint. */
export function buildCompatibilityMatrix(rows:unknown,context:Context={}){
 const root=context.root??CATALOG_ROOT,now=context.now??Date.now();integer(now);
 if(!Array.isArray(rows)||rows.length>200)fail('ROWS_INVALID');
 const ids=rows.map((r:Row)=>r?.id);if(new Set(ids).size!==ids.length)fail('DUPLICATE_ROW');
 let checked:ReturnType<typeof validateAdapterCatalog>|null=null;
 try{checked=validateAdapterCatalog(context.catalog??readAdapterCatalog(root),root);}catch{/* Every row becomes unsupported. */}
 const limits=checked?.catalog.adapters.map((a:Row)=>({id:a.id,kind:a.kind,version:a.version,api_version:a.api_version,
  source_pins:a.source_files,external_version:a.external_version,external_scopes_attested:false,
  operations:a.operations.map((o:Row)=>({id:o.id,semantics:o.semantics,declared_qualification:o.qualification,required_scopes:o.required_scopes,
   production_enabled:false,gap:o.semantics==='unavailable'?'UNAVAILABLE':'CONNECTED_QUALIFICATION_REQUIRED'}))}))??[];
 return {schema_version:1,matrix_version:COMPATIBILITY_VERSION,generated_at:now,
  catalog:checked?{digest:checked.digest,adapter_count:checked.adapter_count,operation_count:checked.operation_count,status:'source_pins_current'}:{status:'invalid',digest:null,adapter_count:0,operation_count:0},
  rows:rows.map(r=>assess(r,checked,{root,now})),adapter_limits:limits,
  known_gaps:['Synthetic fixture observations do not establish model, account, target-host or production qualification.',
   'Non-read-only tiers require the existing independently reviewed action qualification and current execution checks.',
   'Native-only operation evidence is not inferred from direct fixture coverage.',
   'Hashes and supplied reviewer identities do not authenticate external provenance.'],
  execution_authorized:false,production_qualified:false};
}
/** Recompute from current inputs at use time; do not accept a cached matrix row. */
export function compatibilityReadiness(row:unknown,context:Context={}){
 const result=buildCompatibilityMatrix([row],context).rows[0];
 return {diagnostic_ready:result.status==='diagnostic_supported',tier:result.tier,reasons:result.reasons,
  subject_digest:result.subject_digest??null,report_hashes:result.report_hashes,execution_authorized:false,production_qualified:false};
}
