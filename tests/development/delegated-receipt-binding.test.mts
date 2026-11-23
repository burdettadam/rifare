/**
 * RCG-3 isolated boundary tests. The JOSE verifier here is intentionally a
 * trusted TEST DOUBLE; these tests do NOT exercise real JWS cryptography or an
 * ElevenID HTTP route. Uses the native composer/digest; separate files exercise actual signatures and native owners.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {contentDigest} from '../../packages/commerce/configuration-values.mts';
import {CheckoutPreviewComposer, type TrustedCheckoutObservation,
  type FrozenCheckoutPreview} from '../../packages/commerce/checkout-preview.mts';
import {DelegatedReceiptBinder,ReceiptBindingDenied,
  type ExpectedReceiptBinding,type CryptographicallyVerifiedReceipt,
  type ReceiptTrustPolicy} from '../../packages/commerce/delegated-receipt-binding.mts';

const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const clone=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));
const sha=(text:string)=>`sha256:${hash(text)}`;
const ORG='11111111-2222-4333-8444-555555555555';
const GRANT='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const RECEIPT='ffffeeee-dddd-4ccc-8bbb-aaaaaaaaaaaa';
const issuer={type:'SERVICE_ACCOUNT' as const,id:'urn:elevenid:issuer:test'};
const actor={type:'MACHINE_IDENTITY' as const,id:'urn:rifare:agent:demo'};
const subject={type:'USER' as const,id:'urn:rifare:customer:demo'};
const statusIssuer={type:'ORGANIZATION' as const,id:'urn:elevenid:authority:test'};
const evaluator={type:'SERVICE_ACCOUNT' as const,id:'urn:elevenid:evaluator:test'};
const now0=Date.parse('2026-11-19T16:00:00Z');
const at=(offsetMs:number)=>new Date(now0+offsetMs).toISOString();
const fakeCompact='eyJhbGciOiJFUzI1NiJ9.eyJwcm9maWxlIjoidGVzdCJ9.ZHVtbXktc2lnbmF0dXJl';

async function checkout():Promise<FrozenCheckoutPreview> {
  const existingPreviewDigest=hash('cart_source_snapshot');
  const items=[{variant_id:'desk_lamp_basic',product_id:'desk_lamp',quantity:1,unit_minor:'6800',tax_minor:'0',
    total_minor:'6800',currency:'USD',source_revision:hash('catalog_rev_1'),terms:{id:'terms1',version:1}}];
  const source:TrustedCheckoutObservation={
    tenant_id:'tenant_demo',store_id:'store_demo',merchant_id:'merchant_demo',
    resource_id:'order_demo',customer_id:'customer_demo',valid_until:now0+60_000,
    cart:{cart_id:'cart_demo',resource_id:'order_demo',subject_id:'customer_demo',
      operation_id:'cart_op_demo',preview_digest:existingPreviewDigest,
      state:'committed',status:'active',committed:true,native_id:'native_cart_demo',qualification:'synthetic_only'},
    current:{cart_id:'cart_demo',resource_id:'order_demo',subject_id:'customer_demo',
      source_identity:'catalog_fixture_v1',currency:'USD',items,
      total_minor:'6800',catalog_digest:contentDigest(items),
      preview_digest:existingPreviewDigest,stored_preview_digest:existingPreviewDigest,
      requires_new_proposal:false,committed:true,state:'committed',checkout_supported:false,
      payment_authorized:false,qualification:'synthetic_only'},
    shipping_quote:{quote_id:'ship_demo',source_identity:'shipping_fixture',source_revision:'ship_r1',
      amount_minor:'0',currency:'USD',explicit_zero:true},
    fee_quote:{quote_id:'fee_demo',source_identity:'fee_fixture',source_revision:'fee_r1',
      amount_minor:'0',currency:'USD',explicit_zero:true},
  };
  const composer=new CheckoutPreviewComposer({source:{observe:()=>clone(source)},contentDigest,
    now:()=>now0,createId:()=> 'checkout_preview_demo',lifetime_ms:60_000});
  return await composer.prepare({tenant_id:'tenant_demo',store_id:'store_demo'},
    {cart_id:'cart_demo',shipping_quote_id:'ship_demo',fee_quote_id:'fee_demo'});
}

type Fixture=Awaited<ReturnType<typeof fixture>>;
async function fixture(options:{domain?:boolean;binding?:'KEY'|'SESSION';now?:number}={}) {
  const preview=await checkout();
  const binding=options.binding==='SESSION'
    ? {method:'SESSION' as const,session_ref:'urn:marty:session:original',
      establishment_evidence_ref:'urn:marty:session-evidence:original'}
    : {method:'KEY' as const,key_thumbprint:sha('sender-public-key')};
  const expected:ExpectedReceiptBinding={
    preview,delegated_ceiling:{currency:'USD',maximum_minor:'8000'},
    tenant_id:preview.tenant_id,store_id:preview.store_id,
    merchant_id:preview.merchant_id,customer_id:preview.customer_id,
    issuer,organization_id:ORG,actor,subject,status_issuer:statusIssuer,binding,
    grant:{id:GRANT,revision:2,terms_digest:sha('grant-terms')},
    operation:{action:'urn:rifare:action:purchase:v1',resource_id:'urn:rifare:order:order_demo',
      audience:'urn:rifare:merchant:merchant_demo',request_profile:'urn:rifare:checkout-preview:v1'},
    policy:{id:'policy_merchant_v1',version_digest:sha('cedar-policy-v1')},
    challenge:'ad04b33bccd6e449b4c99e027239d81b',
    ...(options.domain ? {
      require_domain_evidence:true as const,
      domain_evaluator:evaluator,domain_profile:'urn:marty:domain-constraint:v1',
      domain_document_digest:sha('constraint-document'),
    } : {require_domain_evidence:false as const}),
  };
  const op={...expected.operation,request_digest:'sha256:'+preview.preview_digest};
  const domain={evaluator,profile:expected.domain_profile,document_digest:sha('constraint-document'),
    grant:expected.grant,operation:op,decision:'PERMIT',checked_at:at(-5_000),
    valid_until:at(30_000),evidence_ref:'urn:marty:domain-evidence:1'};
  const evaluation={profile:'urn:marty:delegated-evaluation:v1',organization_id:ORG,
    grant:expected.grant,actor,subject,binding,operation:op,
    approval_evidence_ref:'urn:marty:approval:original',
    authority_evidence_ref:'urn:marty:authority:original',
    proof_evidence_ref:'urn:marty:proof:original',challenge:expected.challenge,
    proof_verified_at:at(-15_000),proof_valid_until:at(40_000),
    status:{issuer:statusIssuer,grant:expected.grant,state:'ACTIVE',
      checked_at:at(-10_000),valid_until:at(50_000),evidence_ref:'urn:marty:status:original'},
    ...(options.domain?{domain_evidence:domain}:{}),evaluated_at:at(-5_000)};
  const payload={profile:'urn:marty:delegated-decision-receipt:v1',id:RECEIPT,
    issuer,decision:'PERMIT',evaluation,policy:expected.policy,
    issued_at:at(-2_000),expires_at:at(20_000)};
  const trust:ReceiptTrustPolicy={issuer,organization_id:ORG,
    allowed_algorithms:['ES256'],trusted_key_ids:['managed-key-1']};
  const signed:CryptographicallyVerifiedReceipt={
    protected_header:{alg:'ES256',kid:'managed-key-1',typ:'mip-delegated-decision+jws'},
    trusted_key:{issuer:clone(issuer),purpose:'urn:marty:delegated-decision:jws-v1',
      key_id:'managed-key-1',algorithm:'ES256'},payload:clone(payload),
  };
  let calls=0; let failSignature=false;let now=options.now??now0;
  const jose={verify:async (token:string, policy:ReceiptTrustPolicy)=>{
    calls++;assert.equal(token,fakeCompact);assert.deepEqual(policy,trust);
    assert.notEqual(policy,trust);assert(Object.isFrozen(policy));
    assert(Object.isFrozen(policy.issuer));assert(Object.isFrozen(policy.trusted_key_ids));
    if(failSignature)throw new Error('bad signature');return clone(signed);
  }};
  const binder=new DelegatedReceiptBinder({jose,trust,contentDigest,now:()=>now});
  return {expected,payload:signed.payload as typeof payload,signed,binder,trust,verify:()=>binder.verifyAndBind(fakeCompact,expected),
    setSignatureBad:()=>{failSignature=true;},setNow:(n:number)=>{now=n;},get calls(){return calls;}};
}
const denied=(code:string)=>(err:unknown)=>err instanceof ReceiptBindingDenied && err.code===code;

test('RCG3-PORT-01 valid signed evidence binds one exact $68 cart; never permits execution',async()=>{
  const f=await fixture();const result=await f.verify();
  assert.equal(result.operation_digest,'sha256:'+f.expected.preview.preview_digest);
  assert.equal(result.receipt_id,RECEIPT);
  assert.equal(result.grant_revision,2);
  assert.equal(result.checkout_preview_digest,f.expected.preview.preview_digest);
  assert.equal(result.execution_authorized,false);
  assert.equal(result.qualification,'candidate_contract_only');
  assert.equal(f.calls,1);
  assert(Object.isFrozen(result));
});

test('RCG3-PORT-02 bad signature or unavailable verifier must fail closed',async()=>{
  const f=await fixture();f.setSignatureBad();
  await assert.rejects(f.verify(),denied('RECEIPT_SIGNATURE_INVALID'));
  assert.throws(()=>new DelegatedReceiptBinder({jose:null as any,trust:f.trust,contentDigest,now:()=>now0}),
    denied('RECEIPT_TRUST_NOT_CONFIGURED'));
});

test('RCG3-PORT-03 reject untrusted algorithm, kid, purpose, typ or key issuer',async()=>{
  for(const [path,value] of [
    ['protected_header.alg','none'],['protected_header.kid','other-kid'],
    ['protected_header.typ','JWT'],['trusted_key.purpose','urn:invalid'],
    ['trusted_key.issuer.id','urn:forged:issuer'],['protected_header.jku','https://attacker.invalid/jwks'],
  ] as const){
    const f=await fixture();const [section,key,field]=path.split('.');
    let target:any=(f.signed as any)[section];if(field)target=target[key];
    target[field??key]=value;
    await assert.rejects(f.verify(),denied(path.endsWith('jku')?'RECEIPT_FIELDS_INVALID':'RECEIPT_KEY_UNTRUSTED'));
  }
});

test('RCG3-PORT-04 rejects wrong receipt issuer, organization, profile and decision',async()=>{
  for(const [location,value,code] of [
    ['issuer.id','urn:attacker:issuer','RECEIPT_ISSUER_MISMATCH'],
    ['evaluation.organization_id','22222222-2222-4333-8444-555555555555','RECEIPT_ORGANIZATION_MISMATCH'],
    ['profile','urn:wrong:profile','RECEIPT_PROFILE_INVALID'],
    ['decision','DENY','RECEIPT_PROFILE_INVALID'],
  ] as const){
    const f=await fixture();const path=location.split('.');
    let t:any=f.payload;for(let i=0;i<path.length-1;i++)t=t[path[i]];
    t[path.at(-1)!]=value;
    await assert.rejects(f.verify(),denied(code));
  }
});

test('RCG3-PORT-05 actor and customer subject mismatch deny',async()=>{
  for(const key of ['actor','subject'] as const){
    const f=await fixture();(f.payload.evaluation as any)[key].id='urn:other:principal';
    await assert.rejects(f.verify(),denied(key==='actor'?'RECEIPT_ACTOR_MISMATCH':'RECEIPT_SUBJECT_MISMATCH'));
  }
});

test('RCG3-PORT-06 grant revision, ID and terms digest must match',async()=>{
  for(const [key,value] of [
    ['revision',3],['id','12345678-aaaa-4ccc-8ddd-000000000000'],
    ['terms_digest',sha('other-terms')]
  ] as const){
    const f=await fixture();(f.payload.evaluation.grant as any)[key]=value;
    await assert.rejects(f.verify(),denied('RECEIPT_GRANT_MISMATCH'));
  }
});

test('RCG3-PORT-07 exact operation action/resource/audience/profile/digest mismatch deny',async()=>{
  const changes={action:'urn:other:action',resource_id:'urn:other:resource',
    audience:'urn:other:merchant',request_profile:'urn:other:profile',request_digest:sha('wrong-cart')};
  for(const [key,value] of Object.entries(changes)){
    const f=await fixture();(f.payload.evaluation.operation as any)[key]=value;
    await assert.rejects(f.verify(),denied('RECEIPT_OPERATION_MISMATCH'));
  }
});

test('RCG3-PORT-08 missing/mismatched OID4VP challenge denies',async()=>{
  const f=await fixture();(f.payload.evaluation as any).challenge='same_length_but_wrong_nonce_001';
  await assert.rejects(f.verify(),denied('RECEIPT_CHALLENGE_MISMATCH'));
});

test('RCG3-PORT-09 key binding or session binding mismatch denies',async()=>{
  for(const method of ['KEY','SESSION'] as const){
    const f=await fixture({binding:method});
    if(method==='KEY')(f.payload.evaluation.binding as any).key_thumbprint=sha('different-key');
    else (f.payload.evaluation.binding as any).session_ref='urn:other:session';
    await assert.rejects(f.verify(),denied('RECEIPT_BINDING_MISMATCH'));
  }
});

test('RCG3-PORT-10 signed status must be ACTIVE, current, exact grant and trusted issuer',async()=>{
  for(const field of ['state','valid_until','issuer','grant'] as const){
    const f=await fixture();
    (f.payload.evaluation.status as any)[field]=
      field==='state'?'REVOKED':field==='valid_until'?at(-1_000):
      field==='issuer'?actor:{...f.expected.grant,revision:1};
    await assert.rejects(f.verify(),denied(field==='valid_until'?'RECEIPT_EXPIRED_OR_STALE':'RECEIPT_STATUS_MISMATCH'));
  }
});

test('RCG3-PORT-11 expiry, future issue, expired proof, stale evaluation deny',async()=>{
  for(const [location,value] of [
    ['expires_at',at(-1000)],['issued_at',at(1000)],
    ['evaluation.proof_valid_until',at(-1000)],
    ['evaluation.evaluated_at',at(1000)]
  ] as const){
    const f=await fixture();const path=location.split('.');
    let t:any=f.payload;for(let i=0;i<path.length-1;i++)t=t[path[i]];
    t[path.at(-1)!]=value;
    await assert.rejects(f.verify(),denied('RECEIPT_EXPIRED_OR_STALE'));
  }
});

test('RCG3-PORT-12 policy id/digest pinned to merchant configuration',async()=>{
  for(const [field,value] of [['id','other-policy'],['version_digest',sha('different-policy')]] as const){
    const f=await fixture();(f.payload.policy as any)[field]=value;
    await assert.rejects(f.verify(),denied('RECEIPT_POLICY_MISMATCH'));
  }
});

test('RCG3-PORT-13 required domain constraint evidence must be present and match',async()=>{
  const f=await fixture({domain:true});await f.verify();
  for(const path of ['domain_evidence','domain_evidence.document_digest','domain_evidence.evaluator','domain_evidence.decision','domain_evidence.operation.request_digest']){
    const g=await fixture({domain:true});
    if(path==='domain_evidence'){delete (g.payload.evaluation as any).domain_evidence;}
    else {
      let p:any=g.payload.evaluation;const ks=path.split('.');
      for(let i=0;i<ks.length-1;i++)p=p[ks[i]];
      p[ks.at(-1)!]=path.endsWith('evaluator')?actor:
        path.endsWith('decision')?'DENY':sha('different');
    }
    const code=path==='domain_evidence'?'RECEIPT_DOMAIN_MISSING':'RECEIPT_DOMAIN_MISMATCH';
    await assert.rejects(g.verify(),denied(code));
  }
});

test('RCG3-PORT-14 changed or expired checkout snapshot denies before JOSE request',async()=>{
  const f=await fixture();(f.expected as any).preview={...f.expected.preview,preview_digest:hash('forged-change')};
  await assert.rejects(f.verify(),denied('RECEIPT_CHECKOUT_CHANGED'));
  assert.equal(f.calls,0);
  const g=await fixture({now:now0+70_000});
  await assert.rejects(g.verify(),denied('RECEIPT_CHECKOUT_EXPIRED'));
  assert.equal(g.calls,0);
});

test('RCG3-PORT-15 changed trusted Rifare tenant, merchant or customer denies',async()=>{
  for(const field of ['tenant_id','store_id','merchant_id','customer_id'] as const){
    const f=await fixture();(f.expected as any)[field]='wrong_owner';
    await assert.rejects(f.verify(),denied('RECEIPT_CHECKOUT_SCOPE_MISMATCH'));
    assert.equal(f.calls,0);
  }
});

test('RCG3-PORT-16 unknown signed fields, malformed compact or disabled trust are rejected',async()=>{
  const f=await fixture();(f.payload.evaluation as any).invented_approval=true;
  await assert.rejects(f.verify(),denied('RECEIPT_FIELDS_INVALID'));
  await assert.rejects(f.binder.verifyAndBind('not a compact JWS',f.expected),denied('RECEIPT_COMPACT_INVALID'));
  assert.throws(()=>new DelegatedReceiptBinder({jose:{verify:async()=>f.signed},trust:{...f.trust,
    trusted_key_ids:[]},contentDigest,now:()=>now0}),denied('RECEIPT_TRUST_NOT_CONFIGURED'));
});

test('RCG3-PORT-17 signed receipt cannot override a Rifare-side spending ceiling',async()=>{
  const f=await fixture();
  (f.expected as any).delegated_ceiling={currency:'USD',maximum_minor:'6000'};
  await assert.rejects(f.verify(),denied('RECEIPT_LOCAL_LIMIT_EXCEEDED'));
  assert.equal(f.calls,0);
  const g=await fixture();
  (g.expected as any).delegated_ceiling={currency:'CAD',maximum_minor:'8000'};
  await assert.rejects(g.verify(),denied('RECEIPT_LOCAL_LIMIT_INVALID'));
  assert.equal(g.calls,0);
});
