import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { commerceFixture } from './commerce-helpers.mts';
import { SecretVault } from '../../packages/commerce/secrets.mts';
import { DEFAULT_DECISION_CAPABILITIES, validateDecisionRequest, validateDecisionResult } from '../../packages/agent/decisions.mts';
import type { DecisionRequest, DecisionResult } from '../../packages/agent/decisions.mts';
import { WORKERS_AI_ADAPTER, WORKERS_AI_MODEL, workersAIReader } from '../../packages/agent/workers-ai.mts';

const ACCOUNT='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const PRIVATE='M13-SYNTHETIC-PRIVATE-TOKEN';
const fixture=(name:string):any=>JSON.parse(readFileSync(new URL('../fixtures/decision-model/'+name+'.json',import.meta.url),'utf8'));
const request=():DecisionRequest=>fixture('request');
const response=(value:unknown=fixture('workers-ai-success'),status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
function options(extra:any={}) {
  return {serving_configuration_ref:'decision-fixture',account_id:ACCOUNT,approved_account_ids:[ACCOUNT],
    model_id:WORKERS_AI_MODEL,approved_model_ids:[WORKERS_AI_MODEL],
    fixtureTransport:(async()=>response()) as typeof fetch,...extra};
}
const execute=(r:ReturnType<typeof workersAIReader>,input:unknown=request())=>r.execute(Buffer.from(PRIVATE),{request:input});
async function usingVault(fn:(f:ReturnType<typeof commerceFixture>,vault:SecretVault,ref:string,calls:()=>number)=>Promise<void>,transport?:typeof fetch) {
  const f=commerceFixture(),key=Buffer.alloc(32,7);let count=0;
  const reader=workersAIReader(options({fixtureTransport:(async(url:any,init:any)=>{count++;return transport?transport(url,init):response();}) as typeof fetch}));
  const vault=new SecretVault(f.kernel,{activeId:'decision-key',get:()=>Buffer.from(key)},{},{[WORKERS_AI_ADAPTER]:reader});
  const ref=vault.put(f.a.scope,{provider:'cloudflare',adapter:WORKERS_AI_ADAPTER,value:PRIVATE}).ref;
  try {await fn(f,vault,ref,()=>count);} finally {key.fill(0);f.cleanup();}
}

test('CASE-M13-G01-01',async()=>{
  const input=request(),checked=validateDecisionRequest(input),expected=fixture('normalized-success');
  assert.deepEqual(checked,input);assert.notEqual(checked,input);
  assert.equal(JSON.stringify(input).includes(WORKERS_AI_MODEL),false);
  assert.equal(JSON.stringify(input).includes(ACCOUNT),false);
  assert.equal(JSON.stringify(input).includes(PRIVATE),false);
  assert.deepEqual(validateDecisionResult(input,expected),expected);
  assert.deepEqual(await execute(workersAIReader(options())),expected);
  assert.equal(expected.evidence_kind,'synthetic_wire_fixture');
});

test('CASE-M13-G01-02',async()=>{
  const mutations=[
    (r:any)=>{delete r.answers.requests_return;},
    (r:any)=>{r.answers.unpublished={type:'noul',probability_true:0.1};},
    (r:any)=>{r.answers.reported_problem.choice='unpublished';},
    (r:any)=>{r.answers.reported_problem.probabilities.unpublished=0;},
    (r:any)=>{r.answers.requests_return.type='free_text';},
    (r:any)=>{r.answers.requests_return.probability_true=Infinity;},
    (r:any)=>{r.answers.reported_problem.probabilities.damaged=-0.1;},
    (r:any)=>{r.answers.reported_problem.probabilities.other=0.5;},
    (r:any)=>{r.answers.clarity.score=1.9;},
    (r:any)=>{r.answers.reported_problem.choice='other';}
  ];
  for(const mutate of mutations){const value=fixture('normalized-success');mutate(value);const result=validateDecisionResult(request(),value);
    assert.equal(result.status,'unusable');assert.equal(result.answers,null);assert.equal(result.reason,'DECISION_OUTPUT_INVALID');}
  const bad=await execute(workersAIReader(options({fixtureTransport:async()=>response(fixture('workers-ai-unknown-option'))})));
  assert.equal(bad.status,'unusable');assert.equal(bad.reason,'DECISION_OUTPUT_INVALID');
});

test('CASE-M13-G01-03',async()=>{
  for(const field of ['refund','permission_change','tool_calls']){
    const value=fixture('normalized-success');value[field]={authorized:true};
    assert.equal(validateDecisionResult(request(),value).status,'unusable');
    const wire=fixture('workers-ai-success');wire.result.answers.reported_problem[field]={authorized:true};
    const result=await execute(workersAIReader(options({fixtureTransport:async()=>response(wire)})));
    assert.equal(result.status,'unusable');assert.equal(result.answers,null);assert.equal(JSON.stringify(result).includes(field),false);
  }
  const input:any=request();input.authority='refund.execute';
  assert.throws(()=>validateDecisionRequest(input),/DECISION_REQUEST_INVALID/);
});

test('CASE-M13-G03-01',async()=>{
  const seen:any[]=[];
  const reader=workersAIReader(options({fixtureTransport:async(url:any,init:any)=>{seen.push({url,init});return response();}}));
  const result=await execute(reader),sent=seen[0];
  assert.equal(seen.length,1);
  assert.equal(sent.url,'https://api.cloudflare.com/client/v4/accounts/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/ai/run/@cf/cloudflare/clef-flash');
  assert.equal(sent.init.method,'POST');assert.equal(sent.init.redirect,'error');assert.ok(sent.init.signal instanceof AbortSignal);
  assert.equal(sent.init.headers.authorization,'Bearer '+PRIVATE);assert.equal(sent.init.headers['content-type'],'application/json');
  assert.deepEqual(JSON.parse(sent.init.body),{model:'clef-flash',state:request().state,questions:{
    reported_problem:{type:'choice',instructions:"Classify the customer's reported problem, without treating the claim as an inspection finding.",criteria:{damaged:'The customer reports physical damage.',other:'Another problem or insufficient information.'}},
    requests_return:{type:'noul',instructions:'Does the customer request a return?'},
    clarity:{type:'score',instructions:"Rate how explicit the customer's request is.",criteria:['Unclear','Partly explicit','Explicit']}
  }});
  assert.equal(sent.init.body.includes(PRIVATE),false);assert.equal(sent.init.body.includes('max_output_tokens'),false);
  assert.deepEqual(result.usage,{input_tokens:32,output_tokens:0});assert.deepEqual(result.serving,{reported_model:'clef-flash',revision:null});
  assert.equal(result.evidence_kind,'synthetic_wire_fixture');assert.equal(JSON.stringify(result).includes(PRIVATE),false);
});

test('CASE-M13-G03-02',()=>usingVault(async(f,vault,ref,calls)=>{
  const prepared={request:request()};vault.revoke(f.a.scope,ref);
  await assert.rejects(()=>vault.invokeReader(f.a.scope,ref,WORKERS_AI_ADAPTER,prepared),/SECRET_UNAVAILABLE/);
  assert.equal(calls(),0);assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_assistance_receipts').get()!.n,0);
}));

test('CASE-M13-G03-03',async()=>{
  const failures:[typeof fetch,string][]=[
    [(async()=>response({success:false,errors:[{message:PRIVATE}],result:null},429)) as typeof fetch,'DECISION_UNAVAILABLE'],
    [(async()=>response({success:false,errors:[{message:PRIVATE}],result:null})) as typeof fetch,'DECISION_UNAVAILABLE'],
    [(async()=>new Response('{"private":"'+PRIVATE+'"')) as typeof fetch,'DECISION_OUTPUT_INVALID'],
    [(async()=>response({success:true,result:{answers:{}}})) as typeof fetch,'DECISION_OUTPUT_INVALID'],
    [(async()=>new Response('x'.repeat(128*1024+1))) as typeof fetch,'DECISION_RESPONSE_LIMIT'],
    [((_:any,init:any)=>new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new Error(PRIVATE)),{once:true}))) as typeof fetch,'DECISION_TIMEOUT']
  ];
  for(const [transport,reason] of failures){let calls=0;
    const reader=workersAIReader(options({timeout_ms:10,fixtureTransport:async(url:any,init:any)=>{calls++;return transport(url,init);}}));
    const result=await execute(reader);assert.equal(result.status,'unusable');assert.equal(result.answers,null);assert.equal(result.reason,reason);
    assert.equal(calls,1);assert.equal(JSON.stringify(result).includes(PRIVATE),false);
  }
});

test('CASE-M13-G03-04',async()=>{
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=(async()=>{calls++;throw new Error('UNEXPECTED_NETWORK');}) as typeof fetch;
  try {
    const config=options();delete config.fixtureTransport;
    const result=await execute(workersAIReader(config));assert.equal(result.status,'unusable');assert.equal(result.reason,'DECISION_DISABLED');
    assert.equal(calls,0);
  } finally {globalThis.fetch=original;}
  assert.throws(()=>workersAIReader(options({account_id:'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'})),/DECISION_DESTINATION_UNAPPROVED/);
  assert.throws(()=>workersAIReader(options({approved_model_ids:[]})),/DECISION_DESTINATION_UNAPPROVED/);
  assert.throws(()=>workersAIReader(options({model_id:'@cf/cloudflare/clef',approved_model_ids:['@cf/cloudflare/clef']})),/DECISION_DESTINATION_UNAPPROVED/);
  assert.throws(()=>workersAIReader(options({account_id:'../unapproved'})),/DECISION_REQUEST_INVALID/);
  const caller:any=request();caller.account_id=ACCOUNT;
  assert.equal((await execute(workersAIReader(options()),caller)).status,'unusable');
});

test('M13-G01-DISTRIBUTION-ROUNDING-AND-SCORE',()=>{
  const input=request();input.questions.reported_problem={type:'choice',instructions:'Classify.',options:{one:'One',two:'Two',three:'Three'}};
  const value=fixture('normalized-success');value.answers.reported_problem={type:'choice',choice:'one',probabilities:{one:0.3333,two:0.3333,three:0.3333},confidence:{provider:'fixture',metric:'provider_reported',value:0.3333}};
  value.answers.clarity={type:'score',score:1,probabilities:{'0':0.3333,'1':0.3333,'2':0.3333},confidence:{provider:'fixture',metric:'provider_reported',value:0.3333}};
  assert.equal(validateDecisionResult(input,value).status,'usable');
  value.answers.reported_problem.probabilities.three=0.334;
  assert.equal(validateDecisionResult(input,value).status,'unusable');
  value.answers.reported_problem.probabilities.three=0.3333;value.answers.clarity.score=2.01;
  assert.equal(validateDecisionResult(input,value).status,'unusable');
});

test('M13-G01-BOUNDARIES-AND-MODALITIES',()=>{
  const mutations=[
    (r:any)=>{r.images=['data:image/png;base64,AA=='];},
    (r:any)=>{r.state={image:'https://private.invalid/signed'};},
    (r:any)=>{r.questions={};},
    (r:any)=>{r.questions=Object.fromEntries(Array.from({length:65},(_,i)=>['q'+i,{type:'noul',instructions:'Question'}]));},
    (r:any)=>{r.questions['invalid/id']=r.questions.requests_return;},
    (r:any)=>{r.questions.reported_problem.options={one:'One'};},
    (r:any)=>{r.questions.reported_problem.options=Object.fromEntries(Array.from({length:256},(_,i)=>['o'+i,'Option']));},
    (r:any)=>{r.questions.clarity.levels=Array.from({length:11},(_,i)=>'Level '+i);},
    (r:any)=>{r.questions.requests_return.type='chat';},
    (r:any)=>{r.questions.requests_return.instructions='';},
    (r:any)=>{r.serving_configuration_ref='https://unapproved.invalid';}
  ];
  for(const mutate of mutations){const input:any=request();mutate(input);assert.throws(()=>validateDecisionRequest(input),/DECISION_REQUEST_INVALID|DECISION_CAPABILITY_UNAVAILABLE/);}
  assert.throws(()=>validateDecisionRequest(request(),{...DEFAULT_DECISION_CAPABILITIES,question_types:['noul']}),/DECISION_CAPABILITY_UNAVAILABLE/);
  const input:any=request();input.questions=JSON.parse('{"__proto__":{"type":"noul","instructions":"Question"}}');
  assert.throws(()=>validateDecisionRequest(input),/DECISION_REQUEST_INVALID/);
});

test('M13-G03-REQUEST-BOUND-PREVENTS-SILENT-TRUNCATION',async()=>{
  const input=request(),limit=DEFAULT_DECISION_CAPABILITIES.max_request_bytes;
  input.state='x';input.state+='x'.repeat(limit-Buffer.byteLength(JSON.stringify(input)));
  assert.equal(Buffer.byteLength(JSON.stringify(input)),limit);
  let calls=0,sent='';const reader=workersAIReader(options({fixtureTransport:async(_url:any,init:any)=>{calls++;sent=JSON.parse(init.body).state;return response();}}));
  assert.equal((await execute(reader,input)).status,'usable');assert.equal(sent,input.state);assert.equal(calls,1);
  input.state+='x';const result=await execute(reader,input);
  assert.equal(result.status,'unusable');assert.equal(result.reason,'DECISION_CONTEXT_LIMIT');assert.equal(calls,1);
  const alternate=request();alternate.serving_configuration_ref='another-approved-name';
  assert.equal((await execute(reader,alternate)).reason,'DECISION_CONFIGURATION_CHANGED');assert.equal(calls,1);
});

test('M13-G03-REDIRECT-AND-ERROR-REDACTION',async()=>{
  for(const redirected of [true,false]){let calls=0;
    const reader=workersAIReader(options({fixtureTransport:async(_url:any,init:any)=>{
      calls++;assert.equal(init.redirect,'error');
      if(redirected)return new Response(PRIVATE,{status:302,headers:{location:'https://unapproved.invalid/'+PRIVATE}});
      throw new Error(PRIVATE);
    }}));
    const result=await execute(reader);assert.equal(result.status,'unusable');assert.equal(result.reason,'DECISION_UNAVAILABLE');
    assert.equal(result.usage,null);assert.equal(calls,1);assert.equal(JSON.stringify(result).includes(PRIVATE),false);
  }
});

test('M13-G03-CREDENTIAL-REVOKED-IN-FLIGHT',async()=>{
  let release!:(value:Response)=>void;
  await usingVault(async(f,vault,ref,calls)=>{
    const pending=vault.invokeReader(f.a.scope,ref,WORKERS_AI_ADAPTER,{request:request()});
    assert.equal(calls(),1);vault.revoke(f.a.scope,ref);release(response());
    await assert.rejects(()=>pending,/ADAPTER_UNAVAILABLE/);
    assert.equal(calls(),1);assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_assistance_receipts').get()!.n,0);
    await assert.rejects(()=>vault.invokeReader(f.b.scope,ref,WORKERS_AI_ADAPTER,{request:request()}),/SECRET_UNAVAILABLE/);
    assert.equal(JSON.stringify(vault.list(f.a.scope)).includes(PRIVATE),false);
  },((()=>new Promise<Response>(resolve=>release=resolve))) as typeof fetch);
});

test('M13-G03-CONFIGURATION-AND-USAGE-BOUNDARY',async()=>{
  let seen='';const config=options({allowLiveTest:true,capabilities:{max_request_bytes:4096},fixtureTransport:async(url:any)=>{seen=String(url);return response();}});
  const reader=workersAIReader(config),configurationDigest=reader.configuration_digest;
  assert.match(configurationDigest,/^[a-f0-9]{64}$/);assert.equal(reader.serving_configuration_ref,'decision-fixture');
  assert.equal(workersAIReader(options({allowLiveTest:true,capabilities:{max_request_bytes:4096}})).configuration_digest,configurationDigest);
  assert.notEqual(workersAIReader(options({allowLiveTest:true,capabilities:{max_request_bytes:4095}})).configuration_digest,configurationDigest);
  config.account_id='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';config.approved_account_ids.length=0;
  config.model_id='unapproved';config.capabilities.max_request_bytes=999999;config.fixtureTransport=async()=>{throw new Error('CONFIGURATION_MUTATED');};
  const result=await execute(reader);assert.equal(result.status,'usable');assert.ok(seen.includes('/'+ACCOUNT+'/'));assert.equal(reader.capabilities.max_request_bytes,4096);
  assert.equal(reader.configuration_digest,configurationDigest);
  assert.equal(reader.evidence_kind,'synthetic_wire_fixture');assert.equal(result.evidence_kind,'synthetic_wire_fixture');
  assert.throws(()=>Object.assign(reader,{evidence_kind:'live_test_unqualified'}));
  assert.throws(()=>workersAIReader(options({evidence_kind:'live_test_unqualified'})),/DECISION_REQUEST_INVALID/);
  const absent=fixture('workers-ai-success');delete absent.result.usage;delete absent.result.model;
  const unknown=await execute(workersAIReader(options({fixtureTransport:async()=>response(absent)})));
  assert.equal(unknown.status,'usable');assert.equal(unknown.usage,null);assert.deepEqual(unknown.serving,{reported_model:null,revision:null});
  const malformed=fixture('workers-ai-success');malformed.result.usage.input_tokens=-1;
  const invalid=await execute(workersAIReader(options({fixtureTransport:async()=>response(malformed)})));
  assert.equal(invalid.status,'unusable');assert.equal(invalid.usage,null);
  const wrongLegend=fixture('workers-ai-success');wrongLegend.result.answers.clarity.legend['0']='Private rewritten criterion';
  assert.equal((await execute(workersAIReader(options({fixtureTransport:async()=>response(wrongLegend)})))).status,'unusable');
  const logical:any=request();logical.evidence_kind='live_test_unqualified';
  assert.equal((await execute(reader,logical)).status,'unusable');
});
