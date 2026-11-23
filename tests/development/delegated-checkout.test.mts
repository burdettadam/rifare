import test from 'node:test';
import assert from 'node:assert/strict';
import { usingCheckout,changedProof,customerScope,changedTerms,changedPrice } from './delegated-checkout-helpers.mts';
import { CheckoutPreviews } from '../../packages/commerce/checkout-previews.mts';
import { PrivacyLifecycle } from '../../packages/commerce/privacy-lifecycle.mts';
import type { Row } from '../../packages/commerce/kernel.mts';
import { withinDelegatedCeiling } from '../../packages/commerce/checkout-preview.mts';

test('RCG2-NATIVE-SOURCE-FACTS-AND-NO-EFFECTS',()=>usingCheckout(async f=>{
  const before=f.effects(),preview=await f.previews.prepare(f.customer,f.request),item=preview.items[0];
  assert.equal(preview.total_payable_minor,'4000');assert.equal(item.variant_id,'basic');assert.equal(item.product_id,'shirt');
  assert.equal(item.quantity,2);assert.equal(item.unit_minor,'2000');assert.equal(item.tax_minor,'0');
  assert.equal(preview.shipping_minor,'0');assert.equal(preview.fees_minor,'0');assert.equal(preview.merchant_id,f.a.store);
  assert.equal(preview.cart_operation_id,f.carts.readCart(f.customer,f.cartPreview.cart_id).operation_id);
  assert.equal(preview.qualification,'synthetic_only');assert.match(preview.preview_id,/^checkout_/);
  assert.equal(Object.hasOwn(preview,'execution_authorized'),false);
  assert.deepEqual(await f.previews.read(f.customer,preview.preview_id),preview);
  assert.deepEqual(await f.previews.revalidate(f.customer,preview.preview_id),preview);
  assert.deepEqual(f.effects(),before);assert.equal(f.carts.readCart(f.customer,f.cartPreview.cart_id).checkout_supported,false);
}));

test('RCG2-NATIVE-LAMP-CEILING-AND-EXPLICIT-COSTS',()=>usingCheckout(async f=>{
  const preview=await f.previews.prepare(f.customer,f.request);
  assert.equal(preview.items[0].product_id,'desk_lamp');assert.equal(preview.items[0].quantity,1);
  assert.equal(preview.total_payable_minor,'6800');assert.equal(withinDelegatedCeiling(preview,'USD','8000'),true);
  f.quote('shipping',{expected_revision:1,amount_minor:'1300',explicit_zero:false});
  await assert.rejects(f.previews.read(f.customer,preview.preview_id),/CHECKOUT_PREVIEW_CHANGED/);
  const next=await f.previews.prepare(f.customer,f.request);
  assert.equal(next.total_payable_minor,'8100');assert.equal(withinDelegatedCeiling(next,'USD','8000'),false);
  assert.equal(f.native.catalog('basic').stock,10);
},{lamp:true}));

test('RCG2-NATIVE-SHIPPING-FEES-AND-CURRENCY',()=>usingCheckout(async f=>{
  f.quote('shipping',{expected_revision:1,amount_minor:'500',explicit_zero:false});
  f.quote('fee',{expected_revision:1,amount_minor:'125',explicit_zero:false});
  const preview=await f.previews.prepare(f.customer,f.request);
  assert.equal(preview.subtotal_minor,'4000');assert.equal(preview.shipping_minor,'500');assert.equal(preview.fees_minor,'125');
  assert.equal(preview.total_payable_minor,'4625');
  assert.throws(()=>f.quote('fee',{expected_revision:2,currency:'CAD'}),/CURRENCY_MISMATCH/);
  assert.throws(()=>f.quote('fee',{expected_revision:2,amount_minor:'1'}),/QUOTE_INVALID/);
}));

test('RCG2-NATIVE-MISSING-AND-EXPIRED-QUOTES',()=>usingCheckout(async f=>{
  const absent=new CheckoutPreviews(f.kernel,f.carts);assert.equal(absent.available,false);
  await assert.rejects(absent.prepare(f.customer,f.request),/QUOTE_UNAVAILABLE/);absent.close();
  await assert.rejects(f.previews.prepare(f.customer,{...f.request,shipping_quote_id:'missing'}),/QUOTE_UNAVAILABLE/);
  f.quote('fee',{expected_revision:1,expires_at:f.now()+1000});
  const preview=await f.previews.prepare(f.customer,f.request);assert.equal(preview.expires_at,f.now()+1000);
  f.advance(1000);await assert.rejects(f.previews.prepare(f.customer,f.request),/QUOTE_UNAVAILABLE/);
  await assert.rejects(f.previews.read(f.customer,preview.preview_id),/NOT_FOUND|EXPIRED/);
}));

test('RCG2-NATIVE-QUOTES-BIND-EXACT-CART',()=>usingCheckout(async f=>{
  const other=f.cart('same-items-other-cart');await f.carts.confirm(f.customer,{cart_id:other.cart_id,preview_digest:other.preview_digest});
  await assert.rejects(f.previews.prepare(f.customer,{...f.request,cart_id:other.cart_id}),/QUOTE_UNAVAILABLE/);
  await assert.rejects(f.previews.prepare(f.customer,{...f.request,shipping_quote_id:'fee-quote',fee_quote_id:'shipping-quote'}),/QUOTE_UNAVAILABLE/);
}));

test('RCG2-NATIVE-SCOPE-AND-RESOURCE-ISOLATION',()=>usingCheckout(async f=>{
  const preview=await f.previews.prepare(f.customer,f.request);
  const scopes=[f.a.scope,f.agent.scope,f.b.scope,f.c.scope,
    customerScope(f,f.a.store,'ORD-1002','other-apparel@example.invalid'),
    customerScope(f,f.b.store,'ORD-1001','shopper-fragile@example.invalid'),
    customerScope(f,f.c.store,'ORD-1001','shopper-apparel@example.invalid')];
  for(const scope of scopes){
    await assert.rejects(f.previews.prepare(scope,f.request));
    await assert.rejects(f.previews.read(scope,preview.preview_id));
    await assert.rejects(f.previews.revalidate(scope,preview.preview_id));
  }
  assert.deepEqual(await f.previews.read(f.customer,preview.preview_id),preview);
}));

test('RCG2-NATIVE-SAME-CUSTOMER-DIFFERENT-ORDER',()=>usingCheckout(async f=>{
  const order=f.kernel.get(f.a.scope,f.original.id) as Row;
  f.kernel.ingest(f.a.scope,{kind:'order',source_system:order.source_system,external_id:'ORD-CHECKOUT-OTHER',
    source_version:1,source_updated_at:f.now(),customer_id:order.customer_id,payload:{...order.payload,order_number:'ORD-CHECKOUT-OTHER'}});
  const other=customerScope(f,f.a.store,'ORD-CHECKOUT-OTHER','shopper-apparel@example.invalid');
  const preview=await f.previews.prepare(f.customer,f.request);
  await assert.rejects(f.previews.read(other,preview.preview_id));await assert.rejects(f.previews.prepare(other,f.request));
  assert.deepEqual(await f.previews.read(f.customer,preview.preview_id),preview);
}));

test('RCG2-NATIVE-CURRENT-CUSTOMER-PROOF',async()=>{
  for(const emailChanged of [false,true])await usingCheckout(async f=>{
    const preview=await f.previews.prepare(f.customer,f.request);changedProof(f,emailChanged);
    await assert.rejects(f.previews.read(f.customer,preview.preview_id),/CUSTOMER_VERIFICATION_REQUIRED/);
    await assert.rejects(f.previews.revalidate(f.customer,preview.preview_id));
    await assert.rejects(f.previews.prepare(f.customer,f.request),/CUSTOMER_VERIFICATION_REQUIRED/);
  });
});

test('RCG2-NATIVE-REVOKED-SESSION-AND-ERASURE',async()=>{
  for(const erase of [false,true])await usingCheckout(async f=>{
    const preview=await f.previews.prepare(f.customer,f.request);
    if(erase)assert.equal(new PrivacyLifecycle(f.kernel).erase(f.owner.scope,f.original.customer_id).status,'logically_erased');
    else f.kernel.revoke(f.customer);
    await assert.rejects(f.previews.read(f.customer,preview.preview_id));
    await assert.rejects(f.previews.revalidate(f.customer,preview.preview_id));
    await assert.rejects(f.previews.prepare(f.customer,f.request));
  });
});

test('RCG2-NATIVE-ASYNC-AUTHORITY-LOSS',async()=>{
  for(const mutate of [(f:any)=>f.kernel.revoke(f.customer),(f:any)=>changedProof(f),
    (f:any)=>new PrivacyLifecycle(f.kernel).erase(f.owner.scope,f.original.customer_id)])await usingCheckout(async f=>{
    const pending=f.previews.prepare(f.customer,f.request);mutate(f);
    await assert.rejects(pending);
    assert.equal(f.sourceDb.prepare('SELECT count(*) n FROM growth_source_cart_effects').get()!.n,1);
  });
});

test('RCG2-NATIVE-POST-AWAIT-AUTHORITY-RECHECK',()=>usingCheckout(async f=>{
  const read=f.quotes.read.bind(f.quotes);let reads=0;
  f.quotes.read=(...args:Parameters<typeof read>)=>{const result=read(...args);if(++reads===4)queueMicrotask(()=>f.kernel.revoke(f.customer));return result;};
  const owner=f.newOwner();await assert.rejects(owner.prepare(f.customer,f.request));
  assert.equal(reads,4);
}));

test('RCG2-NATIVE-UNCONFIRMED-AND-UNKNOWN-CARTS',async()=>{
  await usingCheckout(async f=>{await assert.rejects(f.previews.prepare(f.customer,f.request));
    assert.throws(()=>f.quote('shipping'),/CART_NOT_ACTIVE/);},{confirm:false});
  await usingCheckout(async f=>{
    const cart=f.cart('unknown-cart');f.catalogSource.fault='after';
    assert.equal((await f.carts.confirm(f.customer,{cart_id:cart.cart_id,preview_digest:cart.preview_digest})).state,'unknown');
    f.quote('shipping',{quote_id:'unknown-shipping',cart_id:cart.cart_id});
    f.quote('fee',{quote_id:'unknown-fee',cart_id:cart.cart_id});
    await assert.rejects(f.previews.prepare(f.customer,{cart_id:cart.cart_id,shipping_quote_id:'unknown-shipping',fee_quote_id:'unknown-fee'}),/CART_NOT_ACTIVE/);
  });
});

test('RCG2-NATIVE-PURCHASE-AND-OWNER-CHANGE',async()=>{
  for(const mutate of [(f:any)=>f.catalogSource.fixturePurchase(f.cartPreview.cart_id,'native-purchased-order'),
    (f:any)=>f.native.fixtureOrder(f.original.id,{customer_id:'C-1002'})])await usingCheckout(async f=>{
    const preview=await f.previews.prepare(f.customer,f.request);mutate(f);
    await assert.rejects(f.previews.read(f.customer,preview.preview_id));await assert.rejects(f.previews.prepare(f.customer,f.request));
  });
});

test('RCG2-NATIVE-STOCK-PRICE-AND-TERMS-INVALIDATE',async()=>{
  for(const mutate of [(f:any)=>f.native.fixtureStock('basic',0),changedPrice,changedTerms])await usingCheckout(async f=>{
    const preview=await f.previews.prepare(f.customer,f.request);mutate(f);const afterMutation=f.effects();
    await assert.rejects(f.previews.read(f.customer,preview.preview_id));await assert.rejects(f.previews.prepare(f.customer,f.request));
    assert.equal(preview.total_payable_minor,'4000');assert.deepEqual(f.effects(),afterMutation);
  });
});

test('RCG2-NATIVE-PRICE-CHANGE-REQUIRES-NEW-CONFIRMATION',()=>usingCheckout(async f=>{
  const preview=await f.previews.prepare(f.customer,f.request);changedPrice(f);
  assert.equal(f.carts.currentPreview(f.customer,f.cartPreview.cart_id).requires_new_proposal,true);
  await assert.rejects(f.previews.prepare(f.customer,f.request));
  const newCart=f.cart('repriced-cart');assert.equal(newCart.total_minor,'4200');
  assert.throws(()=>f.quote('shipping',{quote_id:'new-shipping',cart_id:newCart.cart_id}),/CART_NOT_ACTIVE/);
  await f.carts.confirm(f.customer,{cart_id:newCart.cart_id,preview_digest:newCart.preview_digest});
  f.quote('shipping',{quote_id:'new-shipping',cart_id:newCart.cart_id});f.quote('fee',{quote_id:'new-fee',cart_id:newCart.cart_id});
  const next=await f.previews.prepare(f.customer,{cart_id:newCart.cart_id,shipping_quote_id:'new-shipping',fee_quote_id:'new-fee'});
  assert.equal(next.total_payable_minor,'4200');assert.notEqual(next.cart_operation_id,preview.cart_operation_id);
  await assert.rejects(f.previews.read(f.customer,preview.preview_id));
}));

test('RCG2-NATIVE-ASYNC-SOURCE-AND-QUOTE-CHANGE',async()=>{
  for(const mutate of [changedTerms,(f:any)=>f.quote('fee',{expected_revision:1,amount_minor:'100',explicit_zero:false}),
    (f:any)=>f.catalogSource.fixturePurchase(f.cartPreview.cart_id,'later-purchase')])await usingCheckout(async f=>{
    const pending=f.previews.prepare(f.customer,f.request);mutate(f);await assert.rejects(pending);
  });
});

test('RCG2-NATIVE-CAPACITY-INCLUDES-PENDING-WORK',()=>usingCheckout(async f=>{
  const first=f.previews.prepare(f.customer,f.request);
  await assert.rejects(f.previews.prepare(f.customer,f.request),/PREVIEW_CAPACITY/);
  const preview=await first;await assert.rejects(f.previews.prepare(f.customer,f.request),/PREVIEW_CAPACITY/);
  assert.deepEqual(await f.previews.read(f.customer,preview.preview_id),preview);
},{max_previews:1}));

test('RCG2-NATIVE-FAILED-AND-EXPIRED-SLOTS-RECLAIMED',()=>usingCheckout(async f=>{
  await assert.rejects(f.previews.prepare(f.a.scope,f.request));
  const preview=await f.previews.prepare(f.customer,f.request);f.advance(60000);
  await assert.rejects(f.previews.read(f.customer,preview.preview_id));f.quote('shipping');f.quote('fee');
  const next=await f.previews.prepare(f.customer,f.request);assert.notEqual(next.preview_id,preview.preview_id);
},{max_previews:1}));

test('RCG2-NATIVE-CLOSE-AND-RESTART-LOSE-SNAPSHOTS',()=>usingCheckout(async f=>{
  const preview=await f.previews.prepare(f.customer,f.request),fresh=f.newOwner();
  await assert.rejects(fresh.read(f.customer,preview.preview_id),/NOT_FOUND/);
  const pending=fresh.prepare(f.customer,f.request);fresh.close();await assert.rejects(pending,/UNAVAILABLE/);
  f.previews.close();await assert.rejects(f.previews.read(f.customer,preview.preview_id),/UNAVAILABLE/);
}));

test('RCG2-NATIVE-RECOVERY-FENCE-BEFORE-AND-AFTER-AWAIT',async()=>{
  for(const mode of ['quarantine','diagnostic_only'])await usingCheckout(async f=>{
    const preview=await f.previews.prepare(f.customer,f.request),pending=f.previews.prepare(f.customer,f.request);
    // Focused guard injection: no public API converts an existing live kernel to recovery.
    f.db.prepare('INSERT INTO commerce_recovery_state VALUES(1,?,?,?,?,?)').run('checkout-restore',mode,'a'.repeat(64),'b'.repeat(64),f.now());
    await assert.rejects(pending,/RESTORE_EGRESS_BLOCKED/);
    await assert.rejects(f.previews.read(f.customer,preview.preview_id),/RESTORE_EGRESS_BLOCKED/);
    await assert.rejects(f.previews.prepare(f.customer,f.request),/RESTORE_EGRESS_BLOCKED/);
  });
});

test('RCG2-NATIVE-CALLER-CANNOT-REPLACE-SNAPSHOT',()=>usingCheckout(async f=>{
  const preview=await f.previews.prepare(f.customer,f.request);
  assert.throws(()=>{(preview as any).expires_at+=60000;},TypeError);
  assert.throws(()=>{(preview.items[0] as any).unit_minor='1';},TypeError);
  await assert.rejects(f.previews.revalidate(f.customer,{...preview,expires_at:preview.expires_at+60000} as any));
  await assert.rejects(f.previews.prepare(f.customer,{...f.request,total_payable_minor:'1'} as any));
  assert.deepEqual(await f.previews.read(f.customer,preview.preview_id),preview);
}));

test('RCG2-NATIVE-CLOCK-REWIND-AND-FRACTIONAL-TIME',async()=>{
  for(const difference of [-1,0.5])await usingCheckout(async f=>{
    const preview=await f.previews.prepare(f.customer,f.request);f.advance(difference);
    await assert.rejects(f.previews.read(f.customer,preview.preview_id),/CLOCK_INVALID/);
    await assert.rejects(f.previews.prepare(f.customer,f.request),/CLOCK_INVALID/);
  });
});

test('RCG2-NATIVE-SOURCE-TAX-AND-UNQUALIFIED-ROUNDING',()=>usingCheckout(async f=>{
  f.quote('shipping',{expected_revision:1,amount_minor:'500',explicit_zero:false});
  f.quote('fee',{expected_revision:1,amount_minor:'125',explicit_zero:false});
  const preview=await f.previews.prepare(f.customer,f.request);
  assert.equal(preview.subtotal_minor,'4000');assert.equal(preview.tax_minor,'200');
  assert.equal(preview.items[0].line_total_minor,'4200');assert.equal(preview.total_payable_minor,'4825');
  f.native.seed({...f.native.order(f.original.id),resource_id:'rounding-native-order'},[{...f.native.catalog('basic'),tax_bps:1}]);
  await assert.rejects(f.previews.read(f.customer,preview.preview_id),/TAX_UNQUALIFIED/);
  await assert.rejects(f.previews.prepare(f.customer,f.request),/TAX_UNQUALIFIED/);
},{tax_bps:500}));

test('RCG2-NATIVE-QUOTE-RENEWAL-CANNOT-REFRESH-PREVIEW',()=>usingCheckout(async f=>{
  const preview=await f.previews.prepare(f.customer,f.request);f.advance(1000);
  f.quote('shipping',{expected_revision:1,expires_at:f.now()+120000});
  await assert.rejects(f.previews.revalidate(f.customer,preview.preview_id),/CHECKOUT_PREVIEW_CHANGED/);
  assert.equal(preview.expires_at,preview.created_at+60000);
  const next=await f.previews.prepare(f.customer,f.request);
  assert.notEqual(next.preview_id,preview.preview_id);assert.equal(next.expires_at,preview.expires_at);
}));

test('RCG2-NATIVE-AUTHORITY-AFTER-FINAL-SOURCE-CALL',async()=>{
  for(const operation of ['prepare','read','revalidate'] as const){
    for(const loss of ['expiry','revocation','proof','erasure','uninstall'] as const)await usingCheckout(async f=>{
      if(loss==='expiry'){
        const expires=f.kernel.require(f.customer).expires_at;
        f.advance(expires-f.now()-1000);f.quote('shipping');f.quote('fee');
      }
      const read=f.quotes.read.bind(f.quotes);let calls=0,armedAt=Infinity;
      f.quotes.read=(...args:Parameters<typeof read>)=>{
        const result=read(...args);
        if(++calls===armedAt){
          if(loss==='expiry')f.advance(1000);
          if(loss==='revocation')f.kernel.revoke(f.customer);
          if(loss==='proof')changedProof(f);
          if(loss==='erasure')new PrivacyLifecycle(f.kernel).erase(f.owner.scope,f.original.customer_id);
          if(loss==='uninstall')new PrivacyLifecycle(f.kernel).uninstall(f.owner.scope);
        }
        return result;
      };
      const owner=f.newOwner(),preview=await owner.prepare(f.customer,f.request);
      armedAt=calls+(operation==='prepare'?6:4);
      const pending=operation==='prepare'?owner.prepare(f.customer,f.request):owner[operation](f.customer,preview.preview_id);
      await assert.rejects(pending,/ACCESS_DENIED|CUSTOMER_VERIFICATION_REQUIRED|SUBJECT_ERASED|NOT_FOUND/);
      assert.equal(calls,armedAt);assert.ok(f.now()<preview.expires_at,'The preview itself is still fresh; current authority was lost.');
    });
  }
});

test('RCG2-NATIVE-READ-REVALIDATE-FINAL-ASYNC-GUARD',async()=>{
  for(const operation of ['read','revalidate'] as const)await usingCheckout(async f=>{
    const read=f.quotes.read.bind(f.quotes);let calls=0,armedAt=Infinity;
    f.quotes.read=(...args:Parameters<typeof read>)=>{
      const result=read(...args);if(++calls===armedAt)queueMicrotask(()=>f.kernel.revoke(f.customer));return result;
    };
    const owner=f.newOwner(),preview=await owner.prepare(f.customer,f.request);armedAt=calls+2;
    await assert.rejects(owner[operation](f.customer,preview.preview_id),/ACCESS_DENIED/);
  });
});
