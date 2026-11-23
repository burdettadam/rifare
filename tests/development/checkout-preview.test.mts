import test from 'node:test';
import assert from 'node:assert/strict';
import { contentDigest } from '../../packages/commerce/configuration-values.mts';
import { CheckoutPreviewComposer,checkoutSnapshot,withinDelegatedCeiling } from '../../packages/commerce/checkout-preview.mts';
import { barrier,clone,composerFixture,ledger,observation,request } from './checkout-preview-helpers.mts';

test('RCG2-COMPOSER-FIXED-SOURCE-VECTOR',async()=>{
  const f=composerFixture(),preview=await f.composer.prepare({},request);
  for(const [key,value] of Object.entries(ledger.expected_preview))assert.deepEqual((preview as any)[key],value);
  assert.deepEqual(Object.fromEntries(preview.items.map(({variant_id,...facts})=>[variant_id,facts])),ledger.expected_source_evidence.item_facts);
  assert.equal(preview.preview_digest,'c0c5b8d6ecd0202500156e0f05b4431524428e16a4b8e0f19daf70ff16372281');
  assert.equal(withinDelegatedCeiling(preview,'USD','8000'),true);
  assert.deepEqual(await f.composer.revalidate({},preview),preview);
  assert.ok(Object.isFrozen(preview.items[0]));
});

test('RCG2-COMPOSER-CAPTURED-LIFETIME',async()=>{
  const f=composerFixture();f.deps.lifetime_ms=3600000;
  assert.equal((await f.composer.prepare({},request)).expires_at,61000);
});

test('RCG2-COMPOSER-CAPTURED-DEPENDENCIES',async()=>{
  const f=composerFixture();f.deps.now=()=>NaN;f.deps.createId=()=> 'replaced_id';
  f.deps.contentDigest=()=> 'f'.repeat(64);
  f.source.observe=async()=>{throw new Error('REPLACED_SOURCE');};
  const preview=await f.composer.prepare({},request);
  for(const [key,value] of Object.entries(ledger.expected_preview))assert.deepEqual((preview as any)[key],value);
});

test('RCG2-COMPOSER-CLOCK-REWIND-AT-COMPLETION',async()=>{
  const times=[1000,1001,999];
  const composer=new CheckoutPreviewComposer({source:{observe:()=>observation()},contentDigest,
    now:()=>times.shift()!,createId:()=> 'preview_demo_1',lifetime_ms:60000});
  await assert.rejects(composer.prepare({},request),/CHECKOUT_CLOCK_INVALID|CHECKOUT_PREVIEW_EXPIRED/);
});

test('RCG2-COMPOSER-FRACTIONAL-COMPLETION-CLOCK',async()=>{
  const times=[1000,1000.25,1000.5];
  const composer=new CheckoutPreviewComposer({source:{observe:()=>observation()},contentDigest,
    now:()=>times.shift()!,createId:()=> 'preview_demo_1',lifetime_ms:60000});
  await assert.rejects(composer.prepare({},request),/CHECKOUT_CLOCK_INVALID/);
});

test('RCG2-COMPOSER-INFLIGHT-EXPIRY-MUTATION',async()=>{
  let now=1000,blocked=false;const entered=barrier(),resume=barrier();
  const composer=new CheckoutPreviewComposer({contentDigest,now:()=>now,createId:()=> 'preview_demo_1',lifetime_ms:60000,
    source:{observe:async()=>{if(blocked){entered.release();await resume.wait;}return observation();}}});
  const original=clone(await composer.prepare({},request));now=2000;blocked=true;
  const pending=composer.revalidate({},original);await entered.wait;
  (original as any).expires_at=100000;
  const {preview_digest:_,...body}=original;(original as any).preview_digest=contentDigest(body);
  now=62000;resume.release();
  await assert.rejects(pending,/CHECKOUT_PREVIEW_EXPIRED|CHECKOUT_QUOTE_UNAVAILABLE/);
});

test('RCG2-COMPOSER-REQUEST-ACCESSOR-REJECTED',async()=>{
  const f=composerFixture();let calls=0;
  const unsafe={...request,get cart_id(){calls++;return request.cart_id;}};
  await assert.rejects(f.composer.prepare({},unsafe));assert.equal(calls,0);
});

test('RCG2-COMPOSER-SOURCE-RACE',async()=>{
  let reads=0;
  const composer=new CheckoutPreviewComposer({contentDigest,now:()=>1000,createId:()=> 'preview_demo_1',lifetime_ms:60000,
    source:{observe:()=>{const o=observation();if(++reads===2)(o.fee_quote as any).source_revision='fee_changed';return o;}}});
  await assert.rejects(composer.prepare({},request),/CHECKOUT_SOURCE_CHANGED/);
});

test('RCG2-COMPOSER-QUOTE-DEADLINE-CAPS-PREVIEW',async()=>{
  const f=composerFixture();f.data.valid_until=3000;
  const preview=await f.composer.prepare({},request);assert.equal(preview.expires_at,3000);
  f.setTime(3000);await assert.rejects(f.composer.revalidate({},preview),/CHECKOUT_PREVIEW_EXPIRED/);
});

test('RCG2-COMPOSER-DEADLINE-IMMUTABLE-AFTER-QUOTE-RENEWAL',async()=>{
  const f=composerFixture(),preview=await f.composer.prepare({},request);
  f.data.valid_until=100000;f.setTime(2000);
  assert.equal((await f.composer.revalidate({},preview)).expires_at,61000);
  f.setTime(61000);await assert.rejects(f.composer.revalidate({},preview),/CHECKOUT_PREVIEW_EXPIRED/);
});

test('RCG2-COMPOSER-EXPIRY-DURING-FINAL-HASHING',async()=>{
  for(const operation of ['prepare','revalidate'] as const){
    let now=1000,hashes=0,advanceAt=Infinity;
    const composer=new CheckoutPreviewComposer({source:{observe:()=>({...observation(),valid_until:1002})},
      contentDigest:value=>{if(++hashes===advanceAt)now=1003;return contentDigest(value);},
      now:()=>now,createId:()=> 'preview_demo_1',lifetime_ms:60000});
    if(operation==='prepare'){
      advanceAt=6;await assert.rejects(composer.prepare({},request),/CHECKOUT_PREVIEW_EXPIRED|CHECKOUT_QUOTE_UNAVAILABLE/);
    }else{
      const preview=await composer.prepare({},request);hashes=0;advanceAt=4;
      await assert.rejects(composer.revalidate({},preview),/CHECKOUT_PREVIEW_EXPIRED|CHECKOUT_QUOTE_UNAVAILABLE/);
    }
  }
});

test('RCG2-COMPOSER-SPARSE-ARRAY-EXTRA-NUMERIC-KEY',()=>{
  const value=new Array(1);(value as any)['4294967295']='discarded';
  assert.throws(()=>checkoutSnapshot(value),/CHECKOUT_DATA_INVALID/);
});

test('RCG2-COMPOSER-EXACT-MONEY-BOUNDS',async()=>{
  for(const value of ['01','-1','1.0','1e3',9000,'1000000000000000000000000']){
    const f=composerFixture();(f.data.current.items[0] as any).unit_minor=value;
    await assert.rejects(f.composer.prepare({},request),/CHECKOUT_SOURCE_INVALID|CHECKOUT_AMOUNT_OUT_OF_RANGE/);
  }
  const f=composerFixture(),item=f.data.current.items[0] as any;
  item.unit_minor='999999999999999999999999';item.total_minor=item.unit_minor;
  (f.data.current as any).total_minor=item.unit_minor;
  (f.data.shipping_quote as any).amount_minor='1';(f.data.shipping_quote as any).explicit_zero=false;
  await assert.rejects(f.composer.prepare({},request),/CHECKOUT_AMOUNT_OUT_OF_RANGE/);
});

test('RCG2-COMPOSER-EXPLICIT-QUOTE-EVIDENCE',async()=>{
  for(const field of ['shipping_quote','fee_quote'] as const){
    const f=composerFixture();(f.data as any)[field]=null;
    await assert.rejects(f.composer.prepare({},request),/CHECKOUT_QUOTE_UNAVAILABLE/);
  }
  const f=composerFixture();(f.data.fee_quote as any).explicit_zero=false;
  await assert.rejects(f.composer.prepare({},request),/CHECKOUT_QUOTE_INVALID/);
  (f.data.fee_quote as any).explicit_zero=true;(f.data.fee_quote as any).currency='CAD';
  await assert.rejects(f.composer.prepare({},request),/CHECKOUT_CURRENCY_MISMATCH/);
});

test('RCG2-COMPOSER-ITEM-MEMBERSHIP-AND-ARITHMETIC',async()=>{
  for(const mutate of [(f:any)=>f.data.current.items.push(clone(f.data.current.items[0])),
    (f:any)=>{f.data.current.items[0].quantity=21;},(f:any)=>{f.data.current.items[0].total_minor='6700';}]){
    const f=composerFixture();mutate(f);await assert.rejects(f.composer.prepare({},request),/CHECKOUT_SOURCE_INVALID/);
  }
});

test('RCG2-COMPOSER-REVALIDATION-KEEPS-ORIGINAL-INPUT',async()=>{
  let blocked=false;const entered=barrier(),resume=barrier();
  const composer=new CheckoutPreviewComposer({contentDigest,now:()=>1000,createId:()=> 'preview_demo_1',lifetime_ms:60000,
    source:{observe:async()=>{if(blocked){entered.release();await resume.wait;}return observation();}}});
  const original=clone(await composer.prepare({},request));blocked=true;
  const pending=composer.revalidate({},original);await entered.wait;
  (original.items[0] as any).product_id='different_product';(original as any).expires_at=50000;
  resume.release();const result=await pending;
  assert.equal(result.items[0].product_id,'desk_lamp');assert.equal(result.expires_at,61000);
  assert.equal(result.preview_digest,ledger.expected_preview.preview_digest);
});
