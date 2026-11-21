/**
 * Independently constructed RCG-3 adversarial fixtures. The JOSE port is a
 * controlled test double: these cases verify claim/trust/time handling, not
 * real signatures, provider routing, final use or merchant authorization.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {contentDigest as digest} from '../../packages/commerce/configuration-values.mts';
import {DelegatedReceiptBinder, ReceiptBindingDenied,
  type ExpectedReceiptBinding, type ReceiptTrustPolicy,
  type CryptographicallyVerifiedReceipt} from '../../packages/commerce/delegated-receipt-binding.mts';
import type {FrozenCheckoutPreview} from '../../packages/commerce/checkout-preview.mts';

const clone = <T,>(value:T):T => JSON.parse(JSON.stringify(value));
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');

const sha=(label:string)=>`sha256:${hash(label)}`;
const compact='dGVzdC1oZWFkZXI.dGVzdC1wYXlsb2Fk.dGVzdC1zaWduYXR1cmU';
const defaultNow=Date.parse('2026-11-19T16:00:00Z');
const denied=(error:unknown)=>error instanceof ReceiptBindingDenied;

function fixture(options:{hold?:boolean;domain?:boolean;now?:number;checkoutLifetime?:number}={}) {
  const base=options.now??defaultNow;
  const at=(offset:number)=>new Date(base+offset).toISOString();
  const body:Omit<FrozenCheckoutPreview,'preview_digest'>={
    schema_version:1,preview_id:'preview_hardening',tenant_id:'tenant_hardening',
    store_id:'store_hardening',merchant_id:'merchant_hardening',resource_id:'order_hardening',
    customer_id:'customer_hardening',cart_id:'cart_hardening',cart_operation_id:'cart_operation_hardening',
    cart_preview_digest:hash('original cart'),currency:'USD',
    items:[{variant_id:'lamp_v1',product_id:'lamp',quantity:1,unit_minor:'6800',tax_minor:'0',
      line_total_minor:'6800',currency:'USD',source_revision:hash('catalog v1'),terms_digest:hash('lamp terms')}],
    subtotal_minor:'6800',tax_minor:'0',shipping_minor:'0',fees_minor:'0',total_payable_minor:'6800',
    pricing_source_identity:'catalog_fixture',pricing_source_revision:hash('catalog snapshot'),
    shipping_quote:{quote_id:'shipping_quote',source_identity:'shipping_fixture',source_revision:'shipping_v1',
      amount_minor:'0',currency:'USD',explicit_zero:true},
    fee_quote:{quote_id:'fee_quote',source_identity:'fee_fixture',source_revision:'fee_v1',
      amount_minor:'0',currency:'USD',explicit_zero:true},
    terms_digest:hash('checkout terms'),created_at:base,expires_at:base+(options.checkoutLifetime??60_000),
    qualification:'synthetic_only',
  };
  const preview:FrozenCheckoutPreview={...body,preview_digest:digest(body)};
  const issuer={type:'SERVICE_ACCOUNT' as const,id:'urn:test:configured-issuer'};
  const evaluator={type:'SERVICE_ACCOUNT' as const,id:'urn:test:constraint-evaluator'};
  const expected:ExpectedReceiptBinding={
    preview,delegated_ceiling:{currency:'USD',maximum_minor:'8000'},
    tenant_id:body.tenant_id,store_id:body.store_id,merchant_id:body.merchant_id,customer_id:body.customer_id,
    issuer:clone(issuer),organization_id:'11111111-2222-4333-8444-555555555555',
    actor:{type:'MACHINE_IDENTITY',id:'urn:test:original-agent'},
    subject:{type:'USER',id:'urn:test:original-customer'},
    status_issuer:{type:'ORGANIZATION',id:'urn:test:status-authority'},
    binding:{method:'KEY',key_thumbprint:sha('original public key')},
    grant:{id:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',revision:2,terms_digest:sha('grant terms')},
    operation:{action:'urn:rifare:action:purchase:v1',resource_id:'urn:rifare:order:hardening',
      audience:'urn:rifare:merchant:hardening',request_profile:'urn:rifare:checkout-preview:v1'},
    policy:{id:'merchant_policy',version_digest:sha('merchant policy v1')},
    challenge:'original_nonce_12345678901234567890',
    ...(options.domain?{require_domain_evidence:true as const,domain_evaluator:clone(evaluator),
      domain_profile:'urn:test:constraint-profile',domain_document_digest:sha('constraint document')}:
      {require_domain_evidence:false as const}),
  };
  const operation={...expected.operation,request_digest:`sha256:${preview.preview_digest}`};
  const payload:any={
    profile:'urn:marty:delegated-decision-receipt:v1',id:'ffffeeee-dddd-4ccc-8bbb-aaaaaaaaaaaa',
    issuer:clone(issuer),decision:'PERMIT',
    evaluation:{profile:'urn:marty:delegated-evaluation:v1',organization_id:expected.organization_id,
      grant:clone(expected.grant),actor:clone(expected.actor),subject:clone(expected.subject),
      binding:clone(expected.binding),operation,
      approval_evidence_ref:'urn:test:approval',authority_evidence_ref:'urn:test:authority',
      proof_evidence_ref:'urn:test:proof',challenge:expected.challenge,
      proof_verified_at:at(-15_000),proof_valid_until:at(40_000),
      status:{issuer:clone(expected.status_issuer),grant:clone(expected.grant),state:'ACTIVE',
        checked_at:at(-10_000),valid_until:at(50_000),evidence_ref:'urn:test:status'},
      ...(options.domain?{domain_evidence:{evaluator:clone(evaluator),profile:expected.domain_profile,
        document_digest:expected.domain_document_digest,grant:clone(expected.grant),operation:clone(operation),
        decision:'PERMIT',checked_at:at(-6_000),valid_until:at(30_000),evidence_ref:'urn:test:constraint-evidence'}}:{}),
      evaluated_at:at(-5_000)},
    policy:clone(expected.policy),issued_at:at(-2_000),expires_at:at(20_000),
  };
  const trust:ReceiptTrustPolicy={issuer:clone(issuer),organization_id:expected.organization_id,
    allowed_algorithms:['ES256'],trusted_key_ids:['original-managed-key']};
  const signed:CryptographicallyVerifiedReceipt={
    protected_header:{typ:'mip-delegated-decision+jws',alg:'ES256',kid:'original-managed-key'},
    trusted_key:{issuer:clone(issuer),purpose:'urn:marty:delegated-decision:jws-v1',
      key_id:'original-managed-key',algorithm:'ES256'},payload,
  };
  let enter!:()=>void,release!:()=>void;
  const entered=new Promise<void>(resolve=>{enter=resolve;});
  const gate=new Promise<void>(resolve=>{release=resolve;});
  let calls=0,clock=base;
  let observedTrust:ReceiptTrustPolicy|undefined;
  const jose={async verify(token:string,policy:ReceiptTrustPolicy) {
    assert.equal(token,compact);
    calls++;observedTrust=clone(policy);enter();
    if(options.hold) await gate;
    return clone(signed);
  }};
  const binder=new DelegatedReceiptBinder({jose,trust,contentDigest:digest,now:()=>clock});
  return {expected,trust,payload,signed,binder,entered,release,base,at,
    verify:()=>binder.verifyAndBind(compact,expected),setNow:(value:number)=>{clock=value;},
    get calls(){return calls;},get observedTrust(){return observedTrust;}};
}

test('RCG3-HARDEN-01 unchanged independent receipt remains accepted',async()=>{
  for(const domain of [false,true]) {
    const f=fixture({domain});const result=await f.verify();
    assert.equal(result.checkout_preview_digest,f.expected.preview.preview_digest);
    assert.equal(result.operation_digest,`sha256:${f.expected.preview.preview_digest}`);
    assert.equal(result.execution_authorized,false);
    assert(Object.isFrozen(result));
  }
});

test('RCG3-HARDEN-02 caller edits during verification cannot rewrite captured expectation',async()=>{
  const f=fixture({hold:true});
  const originalChallenge=f.expected.challenge,originalDigest=f.expected.preview.preview_digest;
  const pending=f.verify();await f.entered;
  (f.expected as any).challenge='replacement_nonce_123456789012345';
  (f.expected.actor as any).id='urn:test:replacement-agent';
  (f.expected as any).preview={...f.expected.preview,preview_digest:hash('replacement snapshot')};
  f.release();const result=await pending;
  assert.equal(result.challenge,originalChallenge);
  assert.equal(result.checkout_preview_digest,originalDigest);
  assert.equal(result.operation_digest,`sha256:${originalDigest}`);
});

test('RCG3-HARDEN-03 receipt matching only a later actor or grant edit is denied',async()=>{
  for(const field of ['actor','grant','policy','challenge'] as const) {
    const f=fixture({hold:true});
    const pending=f.verify();await f.entered;
    if(field==='actor') {
      (f.expected.actor as any).id='urn:test:other-agent';
      f.payload.evaluation.actor.id='urn:test:other-agent';
    } else if(field==='grant') {
      (f.expected.grant as any).revision=3;
      f.payload.evaluation.grant.revision=3;f.payload.evaluation.status.grant.revision=3;
    } else if(field==='policy') {
      (f.expected.policy as any).version_digest=sha('replacement policy');
      f.payload.policy.version_digest=sha('replacement policy');
    } else {
      (f.expected as any).challenge='replacement_nonce_123456789012345';
      f.payload.evaluation.challenge='replacement_nonce_123456789012345';
    }
    f.release();await assert.rejects(pending,denied,field);
  }
});

test('RCG3-HARDEN-04 replacement preview cannot corrupt returned evidence identity',async()=>{
  const f=fixture({hold:true});const originalDigest=f.expected.preview.preview_digest;
  const pending=f.verify();await f.entered;
  (f.expected as any).preview={...f.expected.preview,preview_digest:hash('another checkout')};
  f.release();const result=await pending;
  assert.equal(result.checkout_preview_digest,originalDigest);
  assert.equal(result.operation_digest,`sha256:${result.checkout_preview_digest}`);
});

test('RCG3-HARDEN-05 trust pins cannot be loosened by caller edits after construction',async()=>{
  for(const stage of ['before','during'] as const) {
    const f=fixture({hold:stage==='during'});
    (f.signed.protected_header as any).kid='replacement-key';
    (f.signed.trusted_key as any).key_id='replacement-key';
    let pending:Promise<unknown>;
    if(stage==='before') {
      (f.trust.trusted_key_ids as string[])[0]='replacement-key';pending=f.verify();
    } else {
      pending=f.verify();await f.entered;
      (f.trust.trusted_key_ids as string[])[0]='replacement-key';f.release();
    }
    await assert.rejects(pending,denied,stage);
    assert.deepEqual(f.observedTrust?.trusted_key_ids,['original-managed-key']);
  }
});

test('RCG3-HARDEN-06 original trust remains usable after caller changes its configuration object',async()=>{
  const f=fixture();
  (f.trust.issuer as any).id='urn:test:replacement-issuer';
  (f.trust.allowed_algorithms as string[]).splice(0,1,'EdDSA');
  (f.trust.trusted_key_ids as string[]).splice(0,1,'replacement-key');
  const result=await f.verify();
  assert.equal(result.issuer_key_id,'original-managed-key');
  assert.deepEqual(f.observedTrust?.allowed_algorithms,['ES256']);
});

test('RCG3-HARDEN-07 checkout expires while JOSE is pending, before receipt expiry',async()=>{
  const f=fixture({hold:true,checkoutLifetime:1_000});
  const pending=f.verify();await f.entered;
  f.setNow(f.base+1_000);f.release();
  await assert.rejects(pending,denied);
});

test('RCG3-HARDEN-08 final clock must be safe integral milliseconds',async()=>{
  for(const finalClock of [defaultNow+0.5,Number.NaN,Number.POSITIVE_INFINITY,-1]) {
    const f=fixture({hold:true});const pending=f.verify();await f.entered;
    f.setNow(finalClock);f.release();await assert.rejects(pending,denied,String(finalClock));
  }
});

test('RCG3-HARDEN-09 domain requirement rejects missing evaluator, profile or document pins',async()=>{
  for(const key of ['domain_evaluator','domain_profile','domain_document_digest'] as const) {
    const f=fixture({domain:true});delete (f.expected as any)[key];
    await assert.rejects(f.verify(),denied,key);
    assert.equal(f.calls,0,'incomplete server expectation must fail before JOSE');
  }
});

test('RCG3-HARDEN-10 explicit no-domain mode rejects unsolicited evidence and pins',async()=>{
  const extra=fixture({domain:true});
  const evidence=fixture();evidence.payload.evaluation.domain_evidence=clone(extra.payload.evaluation.domain_evidence);
  await assert.rejects(evidence.verify(),denied);
  const pins=fixture();(pins.expected as any).domain_evaluator=extra.expected.domain_evaluator;
  await assert.rejects(pins.verify(),denied);
  assert.equal(pins.calls,0);
});

test('RCG3-HARDEN-11 null domain evidence and non-boolean requirement cannot silently mean absent',async()=>{
  const f=fixture();f.payload.evaluation.domain_evidence=null;
  await assert.rejects(f.verify(),denied);
  for(const value of [null,undefined,0,'false']) {
    const g=fixture();(g.expected as any).require_domain_evidence=value;
    await assert.rejects(g.verify(),denied,String(value));
    assert.equal(g.calls,0);
  }
});

test('RCG3-HARDEN-12 invalid calendar day must not normalize into a valid receipt time',async()=>{
  const f=fixture({now:Date.parse('2026-03-02T16:00:00Z')});
  f.payload.issued_at='2026-02-30T15:59:58.000Z';
  await assert.rejects(f.verify(),denied);
});

test('RCG3-HARDEN-13 UTC-offset spelling cannot substitute for the pinned Z timestamp profile',async()=>{
  const f=fixture();f.payload.issued_at=f.payload.issued_at.replace('Z','+00:00');
  await assert.rejects(f.verify(),denied);
});

test('RCG3-HARDEN-14 issue time one nanosecond in the future must not round down',async()=>{
  const f=fixture();f.payload.issued_at='2026-11-19T16:00:00.000000001Z';
  await assert.rejects(f.verify(),denied);
});

test('RCG3-HARDEN-15 receipt expiry cannot exceed proof validity by one nanosecond',async()=>{
  const f=fixture();
  f.payload.expires_at='2026-11-19T16:00:20.000000002Z';
  f.payload.evaluation.proof_valid_until='2026-11-19T16:00:20.000000001Z';
  await assert.rejects(f.verify(),denied);
});

test('RCG3-HARDEN-16 supported nanosecond timestamps retain exact valid ordering',async()=>{
  const f=fixture();
  f.payload.issued_at='2026-11-19T15:59:59.999999999Z';
  f.payload.expires_at='2026-11-19T16:00:20.000000001Z';
  const result=await f.verify();
  assert.equal(result.issued_at,'2026-11-19T15:59:59.999999999Z');
  assert.equal(result.expires_at,'2026-11-19T16:00:20.000000001Z');
});

test('RCG3-HARDEN-17 verifier timeout configuration is bounded and defaults safely',async()=>{
  const f=fixture();
  const deps={jose:{verify:async()=>f.signed},trust:f.trust,contentDigest:digest,now:()=>f.base};
  for(const timeout of [1,30_000,undefined]) {
    const binder=new DelegatedReceiptBinder({...deps,
      ...(timeout===undefined?{}:{verification_timeout_ms:timeout})});
    assert.equal((await binder.verifyAndBind(compact,f.expected)).execution_authorized,false);
  }
  for(const timeout of [0,-1,0.5,Number.NaN,Number.POSITIVE_INFINITY,30_001,
    Number.MAX_SAFE_INTEGER+1,'5',null]) {
    assert.throws(()=>new DelegatedReceiptBinder({...deps,verification_timeout_ms:timeout as number}),
      (error:unknown)=>error instanceof ReceiptBindingDenied && error.code==='RECEIPT_TRUST_NOT_CONFIGURED',
      String(timeout));
  }
});

test('RCG3-HARDEN-18 unresponsive JOSE times out, aborts and never retries',{timeout:2_000},async()=>{
  const f=fixture();let calls=0;let signal:AbortSignal|undefined;
  const binder=new DelegatedReceiptBinder({
    jose:{verify:async(_token,_trust,receivedSignal)=>{
      calls++;signal=receivedSignal;
      return await new Promise<CryptographicallyVerifiedReceipt>(()=>{});
    }},trust:f.trust,contentDigest:digest,now:()=>f.base,verification_timeout_ms:5,
  });
  await assert.rejects(binder.verifyAndBind(compact,f.expected),
    (error:unknown)=>error instanceof ReceiptBindingDenied && error.code==='RECEIPT_VERIFICATION_TIMEOUT');
  assert.equal(signal?.aborted,true);
  assert.equal(calls,1);
});

test('RCG3-HARDEN-19 late verifier settlement cannot revive a timed-out attempt',{timeout:2_000},async()=>{
  for(const outcome of ['resolve','reject'] as const) {
    const f=fixture();let calls=0,returnedEvidence=false;
    let resolve!:(value:CryptographicallyVerifiedReceipt)=>void,reject!:(error:Error)=>void;
    const late=new Promise<CryptographicallyVerifiedReceipt>((yes,no)=>{resolve=yes;reject=no;});
    const binder=new DelegatedReceiptBinder({jose:{verify:async()=>{calls++;return await late;}},
      trust:f.trust,contentDigest:digest,now:()=>f.base,verification_timeout_ms:5});
    const pending=binder.verifyAndBind(compact,f.expected);
    void pending.then(()=>{returnedEvidence=true;},()=>{});
    const timeout=(error:unknown)=>error instanceof ReceiptBindingDenied && error.code==='RECEIPT_VERIFICATION_TIMEOUT';
    await assert.rejects(pending,timeout);
    if(outcome==='resolve') resolve(f.signed);else reject(new Error('late verifier failure'));
    // Let the event loop observe late rejection; node:test fails unhandled ones.
    await new Promise<void>(done=>setImmediate(done));
    await assert.rejects(pending,timeout);
    assert.equal(returnedEvidence,false,outcome);
    assert.equal(calls,1,outcome);
  }
});

test('RCG3-HARDEN-20 replacing dependency methods cannot swap a constructed verifier',async()=>{
  const f=fixture();let verificationCalls=0,clockCalls=0,digestCalls=0,replacementCalls=0;
  const deps={
    jose:{verify:async()=>{verificationCalls++;return clone(f.signed);}},trust:f.trust,
    contentDigest:(value:unknown)=>{digestCalls++;return digest(value);},
    now:()=>{clockCalls++;return f.base;},
  };
  const binder=new DelegatedReceiptBinder(deps);
  deps.jose.verify=async()=>{replacementCalls++;throw new Error('replacement verifier');};
  deps.now=()=>{replacementCalls++;return f.base+120_000;};
  deps.contentDigest=()=>{replacementCalls++;return hash('replacement digest');};
  const result=await binder.verifyAndBind(compact,f.expected);
  assert.equal(result.operation_digest,`sha256:${f.expected.preview.preview_digest}`);
  assert.equal(verificationCalls,1);assert.equal(clockCalls,2);
  assert(digestCalls>=1);assert.equal(replacementCalls,0);
});

test('RCG3-HARDEN-21 expectation snapshot rejects hidden, accessor, symbol and cyclic data',async()=>{
  for(const malformed of ['getter','symbol','hidden','cycle'] as const) {
    const f=fixture();let getterCalls=0;
    const actor=f.expected.actor as any;
    if(malformed==='getter') Object.defineProperty(actor,'id',{enumerable:true,
      get(){getterCalls++;return 'urn:test:original-agent';}});
    if(malformed==='symbol') actor[Symbol('hidden')]='value';
    if(malformed==='hidden') Object.defineProperty(actor,'hidden',{value:'value',enumerable:false});
    if(malformed==='cycle') actor.self=actor;
    await assert.rejects(f.verify(),denied,malformed);
    assert.equal(getterCalls,0,malformed);assert.equal(f.calls,0,malformed);
  }
});

test('RCG3-HARDEN-22 verified result rejects hidden, accessor, symbol and cyclic data',async()=>{
  for(const malformed of ['getter','symbol','hidden','cycle'] as const) {
    const f=fixture();let getterCalls=0,verificationCalls=0;
    const actor=f.payload.evaluation.actor;
    if(malformed==='getter') Object.defineProperty(actor,'id',{enumerable:true,
      get(){getterCalls++;return 'urn:test:original-agent';}});
    if(malformed==='symbol') actor[Symbol('hidden')]='value';
    if(malformed==='hidden') Object.defineProperty(actor,'hidden',{value:'value',enumerable:false});
    if(malformed==='cycle') actor.self=actor;
    const binder=new DelegatedReceiptBinder({jose:{verify:async()=>{verificationCalls++;return f.signed;}},
      trust:f.trust,contentDigest:digest,now:()=>f.base});
    await assert.rejects(binder.verifyAndBind(compact,f.expected),denied,malformed);
    assert.equal(getterCalls,0,malformed);assert.equal(verificationCalls,1,malformed);
  }
});

test('RCG3-HARDEN-23 one completion clock sample applies to every deadline and cannot regress',async()=>{
  for(const elapsed of [0,500,-1]) {
    const f=fixture();let reads=0;
    const binder=new DelegatedReceiptBinder({jose:{verify:async()=>f.signed},trust:f.trust,
      contentDigest:digest,now:()=>{
        reads++;
        assert(reads<=2,'entry and one completion time sample only');
        return reads===1?f.base:f.base+elapsed;
      }});
    if(elapsed<0) await assert.rejects(binder.verifyAndBind(compact,f.expected),denied);
    else await binder.verifyAndBind(compact,f.expected);
    assert.equal(reads,2);
  }
});

test('RCG3-HARDEN-24 canonical UUID identifiers reject uppercase spellings',async()=>{
  const receipt=fixture();receipt.payload.id=receipt.payload.id.toUpperCase();
  await assert.rejects(receipt.verify(),denied);
  const grant=fixture();
  (grant.expected.grant as any).id=grant.expected.grant.id.toUpperCase();
  grant.payload.evaluation.grant.id=grant.expected.grant.id;
  grant.payload.evaluation.status.grant.id=grant.expected.grant.id;
  await assert.rejects(grant.verify(),denied);assert.equal(grant.calls,0);
  const f=fixture();
  assert.throws(()=>new DelegatedReceiptBinder({jose:{verify:async()=>f.signed},
    trust:{...f.trust,organization_id:'AAAAAAAA-2222-4333-8444-555555555555'},
    contentDigest:digest,now:()=>f.base}),denied);
});

test('RCG3-HARDEN-25 receipt lifetime limit preserves a one-nanosecond boundary',async()=>{
  for(const overrun of [false,true]) {
    const f=fixture();
    // Issued at base-2s: base+598s is exactly the 600-second limit.
    f.payload.expires_at=overrun?f.at(598_000).replace('.000Z','.000000001Z'):f.at(598_000);
    f.payload.evaluation.proof_valid_until=f.at(650_000);
    f.payload.evaluation.status.valid_until=f.at(650_000);
    if(overrun) await assert.rejects(f.verify(),denied);
    else assert.equal((await f.verify()).execution_authorized,false);
  }
});

test('RCG3-HARDEN-26 synchronous verifier stall cannot outrun its queued timeout',{timeout:2_000},async()=>{
  const f=fixture();let calls=0;let signal:AbortSignal|undefined;
  const binder=new DelegatedReceiptBinder({
    jose:{verify:async(_token,_trust,receivedSignal)=>{
      calls++;signal=receivedSignal;
      // Deliberately block the event loop so the 1ms timer cannot run yet.
      // A monotonic completion check must still deny the elapsed deadline.
      const finish=performance.now()+15;
      while(performance.now()<finish) { /* bounded verifier CPU stall */ }
      return f.signed;
    }},trust:f.trust,contentDigest:digest,now:()=>f.base,verification_timeout_ms:1,
  });
  await assert.rejects(binder.verifyAndBind(compact,f.expected),
    (error:unknown)=>error instanceof ReceiptBindingDenied && error.code==='RECEIPT_VERIFICATION_TIMEOUT');
  assert.equal(signal?.aborted,true);assert.equal(calls,1);
});

test('RCG3-BIND-FINAL-HASH expiry during final digest cannot return receipt evidence',async()=>{
  for(const boundary of ['receipt','checkout'] as const) {
    const f=fixture({checkoutLifetime:boundary==='checkout'?1000:60000});
    let calls=0,now=f.base;
    const binder=new DelegatedReceiptBinder({jose:{verify:async()=>f.signed},trust:f.trust,
      contentDigest:value=>{if(++calls===2)now=f.base+(boundary==='receipt'?20000:1000);return digest(value);},
      now:()=>now});
    await assert.rejects(binder.verifyAndBind(compact,f.expected),denied,boundary);
    assert.equal(calls,2);
  }
});
