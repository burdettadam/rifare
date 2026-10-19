import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { commerceFixture } from './commerce-helpers.mts';
import { SecretVault } from '../../packages/commerce/secrets.mts';
import { validateDecisionRequest } from '../../packages/agent/decisions.mts';
import type { DecisionRequest, DecisionResult } from '../../packages/agent/decisions.mts';
import { WORKERS_AI_MODEL, workersAIReader } from '../../packages/agent/workers-ai.mts';
import { SYSTEMONE_ADAPTER, assessSystemOneReadiness, systemOneReader } from '../../packages/agent/systemone.mts';

const ENDPOINT='https://decision-fixture.invalid/v1/systemone';
const MODEL='Cloudflare/clef';
const PRIVATE='M14-SYNTHETIC-PRIVATE-TOKEN';
const fixture=(name:string):any=>JSON.parse(readFileSync(new URL('../fixtures/decision-systemone/'+name+'.json',import.meta.url),'utf8'));
const request=():DecisionRequest=>fixture('request');
const response=(value:unknown=fixture('systemone-success'),status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
function options(extra:any={}) {
  return {serving_configuration_ref:'systemone-fixture',endpoint:ENDPOINT,approved_endpoints:[ENDPOINT],
    model_id:MODEL,approved_model_ids:[MODEL],model_revision:'1'.repeat(40),serving_revision:'2'.repeat(40),
    effective_context_tokens:16384,confidence_profile:'sglang_systemone_adapter_v1',
    self_hosted_attestation:fixture('artifact-attestation'),fixtureTransport:(async()=>response()) as typeof fetch,...extra};
}
const execute=(reader:ReturnType<typeof systemOneReader>,input:unknown=request())=>reader.execute(Buffer.from(PRIVATE),{request:input,expected_configuration_digest:reader.configuration_digest});
function readiness(attestation:unknown=fixture('artifact-attestation'),extra:any={}) {
  return assessSystemOneReadiness({model_id:MODEL,model_revision:'1'.repeat(40),serving_revision:'2'.repeat(40),
    effective_context_tokens:16384,self_hosted_attestation:attestation,...extra});
}

test('CASE-M14-G04-01',async()=>{
  const input=request(),before=JSON.stringify(input),seen:any[]=[];
  const reader=systemOneReader(options({fixtureTransport:async(url:any,init:any)=>{seen.push({url,init});return response();}}));
  const account='a'.repeat(32),cloudflare=workersAIReader({serving_configuration_ref:input.serving_configuration_ref,
    account_id:account,approved_account_ids:[account],model_id:WORKERS_AI_MODEL,approved_model_ids:[WORKERS_AI_MODEL],
    fixtureTransport:(async()=>response(fixture('workers-ai-success'))) as typeof fetch});
  const systemone=await execute(reader,input),hosted=await cloudflare.execute(Buffer.from(PRIVATE),{request:input,expected_configuration_digest:cloudflare.configuration_digest});
  assert.deepEqual(systemone,fixture('normalized-success'));assert.equal(hosted.status,'usable');
  assert.deepEqual(validateDecisionRequest(input),input);assert.equal(JSON.stringify(input),before);
  assert.deepEqual(Object.keys(systemone),Object.keys(hosted));assert.equal(systemone.answers!.intent.type,'choice');
  assert.equal((systemone.answers!.intent as any).choice,(hosted.answers!.intent as any).choice);
  assert.equal(seen.length,1);assert.equal(seen[0].url,ENDPOINT);assert.equal(seen[0].init.method,'POST');
  assert.equal(seen[0].init.redirect,'error');assert.ok(seen[0].init.signal instanceof AbortSignal);
  assert.equal(new Headers(seen[0].init.headers).get('authorization'),'Bearer '+PRIVATE);
  assert.deepEqual(JSON.parse(seen[0].init.body),fixture('systemone-request'));
  for(const field of ['task_id','question_set_digest','serving_configuration_ref','expected_configuration_digest','max_output_tokens',PRIVATE])assert.equal(seen[0].init.body.includes(field),false);
  assert.equal(reader.metadata.adapter,SYSTEMONE_ADAPTER);assert.equal(reader.metadata.provider,'systemone');
  assert.equal(reader.metadata.model_id,MODEL);assert.equal(systemone.serving.revision,null);
});

test('CASE-M14-G04-02',()=>{
  const missing=readiness({model_repository:'Qwen/Qwen3.8-27B',backbone_loaded:true,backbone_sha256:'3'.repeat(64)});
  assert.equal(missing.status,'missing_evidence');assert.equal(missing.qualified,false);assert.equal(missing.observed_runtime,false);
  assert.ok(missing.missing.includes('joint_head_sha256'));assert.ok(missing.missing.includes('joint_head_loaded'));
  for(const key of ['backbone_sha256','joint_head_sha256','joint_head_config_sha256','tokenizer_sha256','serving_artifact_sha256',
    'loader_observation_sha256','model_revision','serving_revision','effective_context_tokens','backbone_loaded','joint_head_loaded']){
    const partial=fixture('artifact-attestation');delete partial[key];const result=readiness(partial);
    assert.equal(result.status,'missing_evidence');assert.ok(result.missing.includes(key));assert.equal(result.qualified,false);
  }
  const complete=readiness();assert.equal(complete.status,'attestation_supplied');assert.deepEqual(complete.missing,[]);
  assert.equal(complete.qualified,false);assert.equal(complete.observed_runtime,false);assert.equal(complete.evidence_basis,'supplied_configuration');
  assert.equal(readiness(undefined,{effective_context_tokens:null}).status,'missing_evidence');
  assert.equal(readiness(undefined,{model_revision:'9'.repeat(40)}).status,'missing_evidence');
  assert.throws(()=>systemOneReader(options({effective_context_tokens:undefined})),/DECISION_REQUEST_INVALID/);
  assert.throws(()=>systemOneReader(options({endpoint:'https://decision-fixture.invalid/v1/decisions',approved_endpoints:['https://decision-fixture.invalid/v1/decisions']})),/DECISION_DESTINATION_UNAPPROVED/);
  assert.throws(()=>systemOneReader(options({self_hosted_attestation:{...fixture('artifact-attestation'),qualified:true}})),/DECISION_REQUEST_INVALID/);
});

test('CASE-M14-G04-03',async()=>{
  const backboneOnly=fixture('artifact-attestation');delete backboneOnly.joint_head_sha256;delete backboneOnly.joint_head_loaded;
  const rejected=readiness(backboneOnly);assert.equal(rejected.status,'missing_evidence');assert.equal(rejected.qualified,false);
  const reader=systemOneReader(options()),result=await execute(reader);
  assert.equal(result.status,'usable');assert.equal((result.answers!.intent as any).confidence.value,0.6);
  assert.deepEqual((result.answers!.intent as any).probabilities,{'return':0.8,other:0.2});
  assert.equal((result.answers!.clarity as any).confidence.value,0);assert.equal((result.answers!.clarity as any).score,1);
  assert.equal(reader.metadata.confidence_profile,'sglang_systemone_adapter_v1');
  const alternate=fixture('systemone-success');alternate.answers.intent.confidence=0.8;alternate.answers.clarity.confidence=0.5;
  const reference=systemOneReader(options({confidence_profile:'clef_reference_top_probability_v1',fixtureTransport:async()=>response(alternate)}));
  const referenceResult=await execute(reference);
  assert.equal(referenceResult.status,'usable');assert.equal((referenceResult.answers!.intent as any).confidence.value,0.8);
  assert.equal((referenceResult.answers!.clarity as any).confidence.value,0.5);
  assert.notEqual(reader.configuration_digest,reference.configuration_digest);
  assert.deepEqual((referenceResult.answers!.intent as any).probabilities,(result.answers!.intent as any).probabilities);
  assert.equal(result.answers!.requires_review.type,'noul');assert.equal(JSON.stringify(result).includes('calibrated'),false);
});

test('CASE-M14-G04-04',async()=>{
  const synthetic=systemOneReader(options({allowLiveTest:true}));
  assert.equal(synthetic.evidence_kind,'synthetic_wire_fixture');assert.equal((await execute(synthetic)).evidence_kind,'synthetic_wire_fixture');
  assert.equal(synthetic.metadata.context_qualification,'declared_unverified');assert.equal(synthetic.metadata.self_hosted_readiness.qualified,false);
  assert.equal(synthetic.metadata.self_hosted_readiness.observed_runtime,false);
  assert.throws(()=>Object.assign(synthetic,{evidence_kind:'live_test_unqualified'}));
  assert.throws(()=>Object.assign(synthetic.metadata.self_hosted_readiness,{qualified:true}));
  assert.throws(()=>systemOneReader(options({evidence_kind:'live_test_unqualified'})),/DECISION_REQUEST_INVALID/);
  const original=globalThis.fetch;let calls=0;globalThis.fetch=(async()=>{calls++;throw new Error('UNEXPECTED_NETWORK');}) as typeof fetch;
  try {const config=options();delete config.fixtureTransport;const live=systemOneReader(config),result=await execute(live);
    assert.equal(result.reason,'DECISION_DISABLED');assert.equal(result.evidence_kind,'live_test_unqualified');assert.equal(calls,0);
    assert.equal(live.metadata.self_hosted_readiness.qualified,false);
  } finally {globalThis.fetch=original;}
  const untrusted:any=request();untrusted.self_hosted_qualified=true;
  assert.equal((await execute(synthetic,untrusted)).reason,'DECISION_REQUEST_INVALID');
});

test('M14-G04-DESTINATION-CONFIGURATION-AND-REQUEST-BOUNDS',async()=>{
  let calls=0,sent='';const configured=options({fixtureTransport:async(url:any,init:any)=>{calls++;sent=init.body;assert.equal(url,ENDPOINT);return response();}});
  const reader=systemOneReader(configured),digest=reader.configuration_digest;
  configured.endpoint='https://changed.invalid/v1/systemone';configured.approved_endpoints.length=0;configured.model_id='changed';
  configured.self_hosted_attestation.joint_head_sha256='9'.repeat(64);configured.fixtureTransport=async()=>{throw new Error('MUTATED_TRANSPORT');};
  assert.equal(reader.configuration_digest,digest);assert.equal(reader.metadata.model_id,MODEL);
  const differentEndpoint='https://other-fixture.invalid/v1/systemone';
  for(const approved of [systemOneReader(options({endpoint:differentEndpoint,approved_endpoints:[differentEndpoint]})),systemOneReader(options({capabilities:{max_request_bytes:4096}}))]){
    assert.equal(approved.serving_configuration_ref,reader.serving_configuration_ref);assert.notEqual(approved.configuration_digest,digest);
    const result=await reader.execute(Buffer.from(PRIVATE),{request:request(),expected_configuration_digest:approved.configuration_digest});
    assert.equal(result.reason,'DECISION_CONFIGURATION_CHANGED');assert.equal(calls,0);
  }
  assert.equal((await reader.execute(Buffer.from(PRIVATE),{request:request()})).reason,'DECISION_REQUEST_INVALID');assert.equal(calls,0);
  const full=request(),limit=reader.capabilities.max_request_bytes;full.state='x';full.state+='x'.repeat(limit-Buffer.byteLength(JSON.stringify(full)));
  assert.equal((await execute(reader,full)).status,'usable');assert.equal(JSON.parse(sent).state,full.state);assert.equal(calls,1);
  full.state+='x';assert.equal((await execute(reader,full)).reason,'DECISION_CONTEXT_LIMIT');assert.equal(calls,1);
  for(const endpoint of ['https://unapproved.invalid/v1/systemone',ENDPOINT+'?secret=value',ENDPOINT+'#fragment','http://decision-fixture.invalid/v1/systemone']){
    assert.throws(()=>systemOneReader(options({endpoint})),/DECISION_DESTINATION_UNAPPROVED/);
  }
  assert.throws(()=>systemOneReader(options({model_id:'Qwen/backbone-only'})),/DECISION_DESTINATION_UNAPPROVED/);
  assert.throws(()=>systemOneReader(options({capabilities:{max_context_tokens:20000}})),/DECISION_REQUEST_INVALID/);
  const narrow=systemOneReader(options({capabilities:{question_types:['noul']},fixtureTransport:async()=>{throw new Error('UNEXPECTED_DISPATCH');}}));
  assert.equal((await execute(narrow)).reason,'DECISION_CAPABILITY_UNAVAILABLE');
});

test('M14-G04-STRICT-NATIVE-RESULT-AND-UNKNOWN-USAGE',async()=>{
  const mutations=[
    (r:any)=>{delete r.answers.requires_review;},
    (r:any)=>{r.answers.extra={type:'noul',noul:0.5};},
    (r:any)=>{r.answers.intent.choice='unpublished';},
    (r:any)=>{r.answers.intent.probabilities.other=0.4;},
    (r:any)=>{r.answers.requires_review.noul=1.1;},
    (r:any)=>{r.answers.intent.permission_change=true;},
    (r:any)=>{r.answers.clarity.legend['0']='Changed rubric';},
    (r:any)=>{r.answers.clarity.score=1.5;},
    (r:any)=>{r.model='Qwen/backbone-only';},
    (r:any)=>{r.usage.input_tokens=-1;},
    (r:any)=>{r.refund={authorized:true};}
  ];
  for(const mutate of mutations){const wire=fixture('systemone-success');mutate(wire);
    const result=await execute(systemOneReader(options({fixtureTransport:async()=>response(wire)})));
    assert.equal(result.status,'unusable');assert.equal(result.answers,null);assert.equal(result.reason,'DECISION_OUTPUT_INVALID');
    assert.equal(JSON.stringify(result).includes('permission_change'),false);assert.equal(JSON.stringify(result).includes('refund'),false);
  }
  for(const usage of [undefined,null,{input_tokens:null,output_tokens:0},{output_tokens:0}]){
    const wire=fixture('systemone-success');wire.usage=usage;
    const result=await execute(systemOneReader(options({fixtureTransport:async()=>response(wire)})));
    assert.equal(result.status,'usable');assert.equal(result.usage,null);assert.equal(result.serving.revision,null);
  }
  assert.equal((await execute(systemOneReader(options({fixtureTransport:async()=>response(fixture('workers-ai-success'))})))).reason,'DECISION_OUTPUT_INVALID');
});

test('M14-G04-BOUNDED-TRANSPORT-AND-SAFE-FAILURE',{timeout:2000},async()=>{
  const failures:[typeof fetch,string][]=[
    [(async()=>new Response(PRIVATE,{status:429,headers:{'retry-after':'1'}})) as typeof fetch,'DECISION_UNAVAILABLE'],
    [(async()=>new Response(PRIVATE,{status:302,headers:{location:'https://unapproved.invalid/'+PRIVATE}})) as typeof fetch,'DECISION_UNAVAILABLE'],
    [(async()=>{throw new Error(PRIVATE);}) as typeof fetch,'DECISION_UNAVAILABLE'],
    [(async()=>new Response('{"private":"'+PRIVATE+'"')) as typeof fetch,'DECISION_OUTPUT_INVALID'],
    [(async()=>new Response('x'.repeat(128*1024+1))) as typeof fetch,'DECISION_RESPONSE_LIMIT'],
    [((()=>new Promise<Response>(()=>{}))) as typeof fetch,'DECISION_TIMEOUT'],
    [(async()=>new Response(new ReadableStream({pull:()=>new Promise(()=>{}),cancel:()=>new Promise(()=>{})}))) as typeof fetch,'DECISION_TIMEOUT']
  ];
  for(const [transport,reason] of failures){let calls=0;
    const reader=systemOneReader(options({timeout_ms:5,fixtureTransport:async(url:any,init:any)=>{calls++;assert.equal(init.redirect,'error');return transport(url,init);}}));
    const result=await execute(reader);assert.equal(result.status,'unusable');assert.equal(result.reason,reason);assert.equal(result.answers,null);
    assert.equal(calls,1);assert.equal(JSON.stringify(result).includes(PRIVATE),false);
  }
});

test('M14-G04-CURRENT-VAULT-CREDENTIAL-AND-SCOPE',async()=>{
  const f=commerceFixture(),key=Buffer.alloc(32,9);let calls=0,release!:(value:Response)=>void;
  const reader=systemOneReader(options({fixtureTransport:(()=>{calls++;return new Promise<Response>(resolve=>release=resolve);}) as typeof fetch}));
  const vault=new SecretVault(f.kernel,{activeId:'systemone-key',get:()=>Buffer.from(key)},{},{[SYSTEMONE_ADAPTER]:reader});
  const invocation={request:request(),expected_configuration_digest:reader.configuration_digest};
  try {
    const revoked=vault.put(f.a.scope,{provider:'systemone',adapter:SYSTEMONE_ADAPTER,value:PRIVATE}).ref;
    vault.revoke(f.a.scope,revoked);await assert.rejects(()=>vault.invokeReader(f.a.scope,revoked,SYSTEMONE_ADAPTER,invocation),/SECRET_UNAVAILABLE/);assert.equal(calls,0);
    const ref=vault.put(f.a.scope,{provider:'systemone',adapter:SYSTEMONE_ADAPTER,value:PRIVATE}).ref;
    await assert.rejects(()=>vault.invokeReader(f.b.scope,ref,SYSTEMONE_ADAPTER,invocation),/SECRET_UNAVAILABLE/);assert.equal(calls,0);
    const pending=vault.invokeReader(f.a.scope,ref,SYSTEMONE_ADAPTER,invocation);assert.equal(calls,1);
    vault.revoke(f.a.scope,ref);release(response());await assert.rejects(()=>pending,/ADAPTER_UNAVAILABLE/);assert.equal(calls,1);
    assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_assistance_receipts').get()!.n,0);
    assert.equal(JSON.stringify(vault.list(f.a.scope)).includes(PRIVATE),false);
  } finally {key.fill(0);f.cleanup();}
});
