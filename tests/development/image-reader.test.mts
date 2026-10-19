import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { IMAGE_ADAPTER, IMAGE_MODEL, imageReader, isImageReader, verifyImageReaderResult } from '../../packages/agent/image-reader.mts';
import type { ImageReader } from '../../packages/agent/image-reader.mts';
import { DEFAULT_DECISION_CAPABILITIES, validateDecisionRequest } from '../../packages/agent/decisions.mts';
import type { DecisionRequest, DecisionResult } from '../../packages/agent/decisions.mts';

const ACCOUNT='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const PRIVATE='M17-SYNTHETIC-IMAGE-READER-TOKEN';
const fixture=(name:string):any=>JSON.parse(readFileSync(new URL('../fixtures/image-reader/'+name+'.json',import.meta.url),'utf8'));
const request=():DecisionRequest=>fixture('request');
const response=(value:unknown=fixture('provider-clear'),status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
function options(extra:any={}) {
  return {serving_configuration_ref:'image-fixture',account_id:ACCOUNT,approved_account_ids:[ACCOUNT],
    model_id:IMAGE_MODEL,approved_model_ids:[IMAGE_MODEL],fixtureTransport:(async()=>response()) as typeof fetch,...extra};
}
function invocation(reader:ImageReader,extra:any={}) {
  return {request:request(),image:fixture('image'),expected_configuration_digest:reader.configuration_digest,
    guard:()=>{},signal:new AbortController().signal,...extra};
}
const execute=(reader:ImageReader,extra:any={})=>reader.execute(Buffer.from(PRIVATE),invocation(reader,extra));
function failure(result:DecisionResult,reason:string) {
  assert.equal(result.status,'unusable');assert.equal(result.reason,reason);assert.equal(result.answers,null);
  assert.equal(JSON.stringify(result).includes(PRIVATE),false);
}

test('M17-IMAGE-WIRE-01',async()=>{
  const seen:any[]=[];
  const reader=imageReader(options({fixtureTransport:async(url:any,init:any)=>{seen.push({url,init});return response();}}));
  const original=request(),called=invocation(reader,{request:original});
  const result=await reader.execute(Buffer.from(PRIVATE),called);
  assert.equal(IMAGE_ADAPTER,'cloudflare-image-decision-v1');assert.equal(IMAGE_MODEL,'@cf/cloudflare/clef-omni');
  assert.equal(seen.length,1);const sent=seen[0];
  assert.equal(sent.url,'https://api.cloudflare.com/client/v4/accounts/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/ai/run/@cf/cloudflare/clef-omni');
  assert.equal(sent.init.method,'POST');assert.equal(sent.init.redirect,'error');assert.ok(sent.init.signal instanceof AbortSignal);
  assert.deepEqual(sent.init.headers,{'content-type':'application/json',authorization:'Bearer '+PRIVATE});
  assert.deepEqual(JSON.parse(sent.init.body),fixture('expected-wire'));
  assert.deepEqual(original,request());assert.deepEqual(validateDecisionRequest(original),original);
  for(const forbidden of [PRIVATE,ACCOUNT,reader.configuration_digest,'expected_configuration_digest','source_sha256','transformation','guard','signal','max_output_tokens']){
    assert.equal(sent.init.body.includes(forbidden),false);
  }
  assert.deepEqual(result,fixture('normalized-clear'));
  assert.equal(reader.provider,'cloudflare');assert.equal(reader.evidence_kind,'synthetic_wire_fixture');
  assert.deepEqual(reader.capabilities.input_modalities,['text','image']);
  assert.deepEqual(reader.capabilities.image_mime_types,['image/png']);
  assert.deepEqual(DEFAULT_DECISION_CAPABILITIES.input_modalities,['text']);
  assert.equal(Object.isFrozen(reader),true);assert.equal(Object.isFrozen(reader.capabilities),true);
  assert.equal(Object.isFrozen(reader.capabilities.input_modalities),true);assert.equal(Object.isFrozen(reader.capabilities.image_mime_types),true);
  assert.equal(isImageReader(reader),true);assert.equal(isImageReader({...reader}),false);
  assert.equal(isImageReader(Object.create(reader)),false);assert.equal(isImageReader(null),false);
  const otherReader=imageReader(options());assert.equal(otherReader.configuration_digest,reader.configuration_digest);
  assert.equal(verifyImageReaderResult(reader,called,result),true);
  assert.equal(verifyImageReaderResult(otherReader,called,result),false);
  assert.equal(verifyImageReaderResult({...reader},called,result),false);
  assert.equal(verifyImageReaderResult(reader,{...called},result),false);
  assert.equal(verifyImageReaderResult(reader,invocation(reader,{request:original}),result),false);
  assert.equal(verifyImageReaderResult(reader,called,structuredClone(result)),false);
  assert.equal(verifyImageReaderResult(reader,called,Object.create(result)),false);
  assert.equal(verifyImageReaderResult(reader,called,null),false);
  assert.equal(verifyImageReaderResult(reader,null,result),false);
  assert.equal(Object.isFrozen(result),true);assert.equal(Object.isFrozen(result.answers),true);
  assert.equal(Object.isFrozen(result.serving),true);assert.equal(Object.isFrozen(result.usage),true);
  if(result.status!=='usable')throw new Error('EXPECTED_USABLE_FIXTURE');
  const visibility=result.answers.item_visibility;
  assert.equal(Object.isFrozen(visibility),true);
  if(visibility.type!=='choice')throw new Error('EXPECTED_CHOICE_FIXTURE');
  assert.equal(Object.isFrozen(visibility.probabilities),true);assert.equal(Object.isFrozen(visibility.confidence),true);
  assert.throws(()=>{visibility.probabilities.clear=0;},TypeError);
  assert.deepEqual(result,fixture('normalized-clear'));
  const deniedCall=invocation(reader),denied=await reader.execute(Buffer.alloc(0),deniedCall);
  failure(denied,'DECISION_CREDENTIAL_UNAVAILABLE');
  assert.equal(verifyImageReaderResult(reader,deniedCall,denied),true);
  assert.equal(verifyImageReaderResult(reader,called,denied),false);assert.equal(seen.length,1);
});

test('M17-IMAGE-NORMALIZE-02',async()=>{
  for(const variant of ['clear','ambiguous']){
    const reader=imageReader(options({fixtureTransport:async()=>response(fixture('provider-'+variant))}));
    assert.deepEqual(await execute(reader),fixture('normalized-'+variant));
  }
  const absent=fixture('provider-ambiguous');delete absent.result.model;delete absent.result.usage;
  const unknown=await execute(imageReader(options({fixtureTransport:async()=>response(absent)})));
  assert.equal(unknown.status,'usable');assert.deepEqual(unknown.serving,{reported_model:null,revision:null});assert.equal(unknown.usage,null);
  assert.equal(unknown.evidence_kind,'synthetic_wire_fixture');
  assert.equal(unknown.status==='usable'&&unknown.answers.item_visibility.type==='choice'&&unknown.answers.item_visibility.choice,'cannot_assess');
  assert.equal(JSON.stringify(unknown).includes('approved'),false);
});

test('M17-IMAGE-MEDIA-03',async()=>{
  let calls=0,getterCalls=0;const reader=imageReader(options({fixtureTransport:async()=>{calls++;return response();}}));
  const image=fixture('image');
  const invalid=[
    {...image,mime:'image/jpeg'},{...image,mime:'image/webp'},{...image,mime:'audio/wav'},
    {...image,base64:'https://private.invalid/image.png'},{...image,base64:'data:image/png;base64,'+image.base64},
    {...image,base64:image.base64+'\n'},{...image,sha256:'0'.repeat(64)},
    {...image,source_sha256:'0'.repeat(64)},{...image,transformation:'thumbnail'},
    {...image,remote_url:'https://private.invalid/image.png'},{...image,images:[image]},
    {...image,base64:Buffer.alloc(262145).toString('base64')},image.base64,[image],null,
    ...fixture('rejected-pngs').map((entry:any)=>entry.image)
  ];
  const accessor={...image};Object.defineProperty(accessor,'sha256',{enumerable:true,get(){getterCalls++;return image.sha256;}});invalid.push(accessor);
  for(const bad of invalid)failure(await execute(reader,{image:bad}),'DECISION_REQUEST_INVALID');
  for(const extra of [{images:[image]},{audio:['AA==']},{videos:['AA==']},{guard:'approve'},{signal:{}},{unpublished:true}]){
    failure(await execute(reader,extra),'DECISION_REQUEST_INVALID');
  }
  assert.equal(calls,0);assert.equal(getterCalls,0);
});

test('M17-IMAGE-CONTEXT-04',async()=>{
  let calls=0;const seen:string[]=[];
  const reader=imageReader(options({fixtureTransport:async(_url:any,init:any)=>{calls++;seen.push(init.body);return response();}}));
  const original=request();original.state='Complete source and correction must survive.\n'+'x'.repeat(13000)+'\nFinal correction: manual review only.';
  const large=fixture('large-image'),bytes=readFileSync(new URL('../fixtures/image-reader/large-rgba.png',import.meta.url));
  assert.equal(bytes.length,261463);assert.equal(bytes.length,large.bytes);
  const media={mime:large.mime,base64:bytes.toString('base64'),sha256:large.sha256,source_sha256:large.source_sha256,transformation:large.transformation};
  assert.equal((await execute(reader,{request:original,image:media})).status,'usable');assert.equal(calls,1);
  const sent=JSON.parse(seen[0]);assert.equal(sent.state,original.state);assert.equal(sent.images.length,1);
  assert.equal(sent.images[0],'data:image/png;base64,'+media.base64);
  assert.ok(Buffer.byteLength(seen[0])<=400000);
  const logicalWire={model:sent.model,state:sent.state,questions:sent.questions};
  assert.ok(Buffer.byteLength(JSON.stringify(logicalWire))+1024+512<=24576);
  assert.equal(reader.capabilities.max_context_tokens,24576);assert.equal(reader.capabilities.max_request_bytes,16384);
  assert.equal(reader.capabilities.max_wire_bytes,400000);assert.equal(reader.capabilities.max_images,1);
  assert.equal(reader.capabilities.max_image_bytes,262144);assert.equal(reader.capabilities.max_image_pixels,4000000);
  assert.equal(reader.capabilities.image_token_allowance,1024);assert.equal(reader.capabilities.marker_token_allowance,512);
  const oversized=request();oversized.state='x'.repeat(17000);
  failure(await execute(reader,{request:oversized}),'DECISION_CONTEXT_LIMIT');assert.equal(oversized.state.length,17000);
  const extra:any=request();extra.images=[fixture('image').base64];
  failure(await execute(reader,{request:extra}),'DECISION_REQUEST_INVALID');assert.equal(calls,1);
});

test('M17-IMAGE-CONFIG-05',async()=>{
  const originalFetch=globalThis.fetch;let networkCalls=0;
  globalThis.fetch=(async()=>{networkCalls++;throw new Error('NO_LIVE_PROVIDER');}) as typeof fetch;
  try {
    const config=options();delete config.fixtureTransport;const reader=imageReader(config);
    failure(await execute(reader),'DECISION_CAPABILITY_UNAVAILABLE');assert.equal(networkCalls,0);
    assert.equal(reader.evidence_kind,'live_test_unqualified');assert.equal(isImageReader(reader),true);
  } finally {globalThis.fetch=originalFetch;}
  for(const extra of [{allowLiveTest:true},{live_enabled:true},{timeout_ms:0},{timeout_ms:2001},{max_response_bytes:0},{max_response_bytes:131073},{capabilities:{input_modalities:['text','audio']}}]){
    assert.throws(()=>imageReader(options(extra)),/DECISION_REQUEST_INVALID/);
  }
  assert.throws(()=>imageReader(options({account_id:'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'})),/DECISION_DESTINATION_UNAPPROVED/);
  assert.throws(()=>imageReader(options({approved_model_ids:[]})),/DECISION_DESTINATION_UNAPPROVED/);
  assert.throws(()=>imageReader(options({model_id:'@cf/cloudflare/clef-flash',approved_model_ids:['@cf/cloudflare/clef-flash']})),/DECISION_DESTINATION_UNAPPROVED/);
  assert.throws(()=>imageReader(options({account_id:'../unapproved'})),/DECISION_REQUEST_INVALID/);
  let calls=0;const config=options({fixtureTransport:async()=>{calls++;return response();}}),reader=imageReader(config),binding=reader.configuration_digest;
  config.account_id='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';config.approved_account_ids.push(config.account_id);config.timeout_ms=1;
  assert.equal(reader.configuration_digest,binding);assert.equal(imageReader(options()).configuration_digest,binding);
  assert.notEqual(imageReader(options({timeout_ms:1999})).configuration_digest,binding);
  failure(await execute(reader,{expected_configuration_digest:'0'.repeat(64)}),'DECISION_CONFIGURATION_CHANGED');
  const changed=request();changed.serving_configuration_ref='some-other-configuration';
  failure(await execute(reader,{request:changed}),'DECISION_CONFIGURATION_CHANGED');
  for(const credential of [Buffer.alloc(0),Buffer.from('bad\nsecret'),Buffer.alloc(4097,65),PRIVATE]){
    failure(await reader.execute(credential as Buffer,invocation(reader)),'DECISION_CREDENTIAL_UNAVAILABLE');
  }
  assert.equal(calls,0);
});

test('M17-IMAGE-OUTPUT-06',async()=>{
  const mutations=[
    (v:any)=>{v.result.model='clef-flash';},(v:any)=>{v.result.revision='invented';},
    (v:any)=>{delete v.result.answers.clarity;},(v:any)=>{v.result.answers.unpublished={type:'noul',noul:1};},
    (v:any)=>{v.result.answers.item_visibility.choice='approved';},(v:any)=>{v.result.answers.item_visibility.probabilities.clear=0.5;},
    (v:any)=>{v.result.answers.item_visibility.probabilities.clear=-0.1;},(v:any)=>{v.result.answers.item_visibility.confidence=1.1;},
    (v:any)=>{v.result.answers.requested_detail_visible.noul=1.1;},(v:any)=>{v.result.answers.clarity.score=1.9;},
    (v:any)=>{v.result.answers.clarity.legend['0']='Authentic';},(v:any)=>{v.result.answers.clarity.tool_calls=[PRIVATE];},
    (v:any)=>{v.result.usage.input_tokens=24577;},(v:any)=>{v.result.usage.output_tokens=131073;},
    (v:any)=>{v.result.usage.input_tokens=-1;},(v:any)=>{v.result.usage.input_tokens=1.5;},
    (v:any)=>{v.result.usage.extra=PRIVATE;},(v:any)=>{v.extra=PRIVATE;},
    (v:any)=>{v.errors=[PRIVATE];},(v:any)=>{v.messages=[PRIVATE];}
  ];
  for(const mutate of mutations){const value=fixture('provider-clear');mutate(value);
    failure(await execute(imageReader(options({fixtureTransport:async()=>response(value)}))),'DECISION_OUTPUT_INVALID');}
});

test('M17-IMAGE-TRANSPORT-07',async()=>{
  const redirected=response();Object.defineProperty(redirected,'redirected',{value:true});
  const wrongSource=response();Object.defineProperty(wrongSource,'url',{value:'https://unapproved.invalid/result'});
  const failures=[
    async()=>response({private:PRIVATE},302),async()=>redirected,async()=>wrongSource,
    async()=>response({private:PRIVATE},429),async()=>response({success:false,errors:[PRIVATE],result:null}),
    async()=>{throw new Error(PRIVATE);}
  ];
  for(const transport of failures){let calls=0;
    const reader=imageReader(options({fixtureTransport:async()=>{calls++;return transport();}}));
    failure(await execute(reader),'DECISION_UNAVAILABLE');assert.equal(calls,1);
  }
});

test('M17-IMAGE-RESPONSE-LIMIT-08',async()=>{
  let cancelled=0;const transports=[
    async()=>new Response('x',{headers:{'content-length':'131073'}}),
    async()=>new Response(new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array(70000));controller.enqueue(new Uint8Array(70000));},cancel(){cancelled++;}})),
    async()=>new Response('{"private":"'+PRIVATE+'"'),
    async()=>new Response(new Uint8Array([0xff,0xfe,0x7b,0x7d]))
  ];
  for(let index=0;index<transports.length;index++){
    failure(await execute(imageReader(options({fixtureTransport:transports[index]}))),index<2?'DECISION_RESPONSE_LIMIT':'DECISION_OUTPUT_INVALID');
  }
  failure(await execute(imageReader(options({max_response_bytes:32}))),'DECISION_RESPONSE_LIMIT');
  assert.equal(cancelled,1);
});

test('M17-IMAGE-DEADLINE-09',async()=>{
  let signals:AbortSignal[]=[];
  let lateResolve!:(value:Response)=>void;
  const late=new Promise<Response>(resolve=>{lateResolve=resolve;});
  const slowHeaders=imageReader(options({timeout_ms:12,fixtureTransport:async(_url:any,init:any)=>{signals.push(init.signal);return late;}}));
  const started=Date.now();failure(await execute(slowHeaders),'DECISION_TIMEOUT');assert.ok(Date.now()-started<1000);
  assert.equal(signals[0].aborted,true);let lateCancelled=0;
  lateResolve(new Response(new ReadableStream<Uint8Array>({cancel(){lateCancelled++;}})));
  await new Promise(resolve=>setTimeout(resolve,0));assert.equal(lateCancelled,1);
  let bodyCancelled=0;
  const slowBody=imageReader(options({timeout_ms:20,fixtureTransport:async(_url:any,init:any)=>{
    signals.push(init.signal);await new Promise(resolve=>setTimeout(resolve,7));
    return new Response(new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new TextEncoder().encode('{"success":'));},cancel(){bodyCancelled++;}}));
  }}));
  failure(await execute(slowBody),'DECISION_TIMEOUT');assert.equal(signals[1].aborted,true);assert.equal(bodyCancelled,1);
});

test('M17-IMAGE-AUTHORITY-10',async()=>{
  const revoked=new Error('DECISION_AUTHORITY_CHANGED');let calls=0;
  const reader=imageReader(options({fixtureTransport:async()=>{calls++;return response();}}));
  await assert.rejects(()=>execute(reader,{guard:()=>{throw revoked;}}),error=>error===revoked);assert.equal(calls,0);
  let current=true;
  const changed=imageReader(options({fixtureTransport:async()=>{calls++;current=false;return response();}}));
  await assert.rejects(()=>execute(changed,{guard:()=>{if(!current)throw revoked;}}),error=>error===revoked);assert.equal(calls,1);
  let release!:(value?:unknown)=>void,stream!:ReadableStreamDefaultController<Uint8Array>;
  const reading=new Promise(resolve=>{release=resolve;});current=true;
  const body=imageReader(options({fixtureTransport:async()=>new Response(new ReadableStream<Uint8Array>({start(controller){stream=controller;},pull(){release();}}))}));
  const pending=execute(body,{guard:()=>{if(!current)throw revoked;}});await reading;current=false;
  stream.enqueue(new TextEncoder().encode(JSON.stringify(fixture('provider-clear'))));
  await assert.rejects(()=>pending,error=>error===revoked);
  const already=new AbortController();already.abort();
  failure(await execute(reader,{signal:already.signal}),'DECISION_AUTHORITY_CHANGED');assert.equal(calls,1);
  const caller=new AbortController();let transportSignal:AbortSignal|undefined;
  const aborted=imageReader(options({fixtureTransport:async(_url:any,init:any)=>{calls++;transportSignal=init.signal;caller.abort();return new Promise<Response>(()=>{});}}));
  failure(await execute(aborted,{signal:caller.signal}),'DECISION_AUTHORITY_CHANGED');
  assert.equal(transportSignal?.aborted,true);assert.equal(calls,2);
});
