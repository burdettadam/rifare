import test from 'node:test';
import assert from 'node:assert/strict';
import { usingExchangeFulfillment } from './exchange-fulfillment-helpers.mts';
import { oracle } from './exchange-finance-helpers.mts';
import { availableValue } from '../../packages/commerce/refund-quotes.mts';
import { canonical,contentDigest } from '../../packages/commerce/configuration-values.mts';
const captures=(f:any)=>f.sourceDb.prepare('SELECT count(*) n FROM fixture_payment_captures').get().n;
const replacements=(f:any)=>f.fulfillmentDb.prepare('SELECT count(*) n FROM fixture_replacements').get().n;

test('M06-G02-FULFILLMENT-WAITS-FOR-EXACT-NATIVE-SETTLEMENT',()=>usingExchangeFulfillment(async f=>{
 const reservation=f.reserve(),op=f.authorize(f.financeQuote());assert.equal(reservation.state,'active');
 assert.throws(()=>f.replacementQuote(reservation),/EXCHANGE_PAYMENT_OUTSTANDING/);
 await f.executor.dispatch(f.a.scope,op.id);assert.throws(()=>f.replacementQuote(reservation),/EXCHANGE_PAYMENT_OUTSTANDING/);
 f.source.settlePayment(op.id,{state:'partial',paid_minor:oracle.higher.partial_payment_minor});await f.executor.reconcile(f.a.scope,op.id);
 assert.throws(()=>f.replacementQuote(reservation),/EXCHANGE_PAYMENT_OUTSTANDING/);assert.equal(replacements(f),0);assert.equal(captures(f),0);
 f.source.settlePayment(op.id);await f.executor.reconcile(f.a.scope,op.id);const quote=f.replacementQuote(reservation),replacement=f.authorizeFulfillment(quote);
 assert.equal(quote.quote.details.exchange_finance.amount_minor,oracle.higher.additional_payment_minor);assert.equal(quote.quote.details.balance_minor,'0');
 assert.equal((await f.execution.dispatch(f.a.scope,replacement.id)).state,'created');await f.execution.dispatch(f.a.scope,replacement.id);
 assert.equal(replacements(f),1);assert.equal(captures(f),1);assert.equal(f.fulfillmentSource.stock(f.catalogResource.id).available,4);
 assert.equal(availableValue(f.kernel,f.kernel.require(f.a.scope),f.order().id,f.facts).toString(),'5800');
}));
test('M06-G02-FULFILLMENT-UNKNOWN-PAYMENT-CANNOT-RELEASE-STOCK',()=>usingExchangeFulfillment(async f=>{
 const reservation=f.reserve(),op=f.authorize(f.financeQuote()),issue=f.source.issue.bind(f.source);f.source.issue=async command=>{await issue(command);f.source.settlePayment(op.id);throw new Error('lost settlement response');};
 assert.equal((await f.executor.dispatch(f.a.scope,op.id)).state,'unknown');assert.throws(()=>f.replacementQuote(reservation),/EXCHANGE_PAYMENT_OUTSTANDING/);
 assert.equal(replacements(f),0);await f.executor.reconcile(f.a.scope,op.id);const replacement=f.authorizeFulfillment(f.replacementQuote(reservation));
 f.fulfillmentSource.fault='after';assert.equal((await f.execution.dispatch(f.a.scope,replacement.id)).state,'unknown');await f.execution.dispatch(f.a.scope,replacement.id);
 assert.equal((await f.execution.reconcile(f.a.scope,replacement.id)).state,'created');assert.equal(f.fulfillmentSource.calls.replace,1);assert.equal(replacements(f),1);assert.equal(captures(f),1);
}));
test('M06-G02-NATIVE-HOLD-REJECTS-DROPPED-PAYMENT-BINDING',()=>usingExchangeFulfillment(async f=>{
 const reservation=f.reserve();await f.settle();const replacement=f.authorizeFulfillment(f.replacementQuote(reservation)),send=f.fulfillmentSource.replace.bind(f.fulfillmentSource);
 f.fulfillmentSource.replace=async command=>{const altered={...command};delete altered.exchange_finance;return send(altered);};
 assert.equal((await f.execution.dispatch(f.a.scope,replacement.id)).state,'unknown');
 assert.equal(replacements(f),0,'dropping the binding must not create a native replacement');assert.equal(f.fulfillmentSource.stock(f.catalogResource.id).available,5,'dropping the binding must not move native stock');
 await f.execution.dispatch(f.a.scope,replacement.id);await f.execution.reconcile(f.a.scope,replacement.id);
 assert.equal(replacements(f),0);assert.equal(captures(f),1);assert.equal(f.fulfillmentSource.stock(f.catalogResource.id).available,5);assert.equal(f.fulfillmentSource.calls.replace,1);
}));
test('M06-G02-NATIVE-REPLACEMENT-REJECTS-FORGED-SETTLED-LOCAL-RECEIPT',()=>usingExchangeFulfillment(async f=>{
 const reservation=f.reserve(),op=f.authorize(f.financeQuote());await f.executor.dispatch(f.a.scope,op.id);
 const native=await f.source.lookup(op.id),forged={...native,state:'settled',payment:{...native.payment,paid_minor:native.amount_minor,state:'settled',settled:true}};
 f.db.prepare("UPDATE commerce_resolution_operations SET state='settled' WHERE id=?").run(op.id);
 f.db.prepare('INSERT INTO commerce_resolution_observations(tenant_id,store_id,operation_id,resource_id,stage,body,digest,observed_at) VALUES(?,?,?,?,?,?,?,?)').run(f.a.tenant,f.a.store,op.id,f.order().id,'settled',canonical(forged),contentDigest(forged),f.now());
 const replacement=f.authorizeFulfillment(f.replacementQuote(reservation));assert.equal((await f.execution.dispatch(f.a.scope,replacement.id)).state,'unknown');
 assert.equal(replacements(f),0);assert.equal(captures(f),0);assert.equal(f.fulfillmentSource.stock(f.catalogResource.id).available,5);
}));
test('M06-G02-NATIVE-REPLACEMENT-REJECTS-OTHER-ALLOCATION-AND-AMOUNT',()=>usingExchangeFulfillment(async f=>{
 const reservation=f.reserve();await f.settle();const replacement=f.authorizeFulfillment(f.replacementQuote(reservation)),command=f.nativeCommand(replacement);
 for(const patch of [{allocation_id:'other-allocation'},{amount_minor:'1'},{source_identity:'other-source'},{native_id:'other-capture'}]){
  await assert.rejects(()=>f.fulfillmentSource.replace({...command,exchange_finance:{...command.exchange_finance,...patch}}),/EXCHANGE_FINANCE_MISMATCH|EXCHANGE_PAYMENT_OUTSTANDING/);
 }
 assert.equal(replacements(f),0);assert.equal(f.fulfillmentSource.stock(f.catalogResource.id).available,5);
 assert.equal((await f.execution.dispatch(f.a.scope,replacement.id)).state,'created');assert.equal(captures(f),1);
}));
test('M06-G02-RESERVATION-REQUIRES-INDEPENDENT-FINANCE-SOURCE',()=>usingExchangeFulfillment(f=>{
 assert.throws(f.reserve,/EXCHANGE_FINANCE_SOURCE_REQUIRED/);assert.equal(f.fulfillmentDb.prepare('SELECT count(*) n FROM fixture_holds').get().n,0);
 assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_inventory_reservations').get().n,0);
},{financeSource:false}));
test('M06-G02-SETTLEMENT-DOES-NOT-OVERRIDE-CHANGED-STOCK',()=>usingExchangeFulfillment(async f=>{
 const reservation=f.reserve();await f.settle();const replacement=f.authorizeFulfillment(f.replacementQuote(reservation));
 f.fulfillmentDb.prepare('UPDATE fixture_stock SET version=2 WHERE catalog_id=?').run(f.catalogResource.id);
 assert.equal((await f.execution.dispatch(f.a.scope,replacement.id)).state,'unknown');assert.equal(replacements(f),0);assert.equal(captures(f),1);
 assert.equal((await f.execution.reconcile(f.a.scope,replacement.id)).state,'unknown');assert.equal(f.fulfillmentSource.calls.replace,1);
}));
test('M06-G03-REFUND-RESIDUAL-SETTLES-BEFORE-REPLACEMENT',()=>usingExchangeFulfillment(async f=>{
 const reservation=f.reserve(),op=f.authorize(f.financeQuote('refund'));assert.equal((await f.executor.dispatch(f.a.scope,op.id)).state,'accepted');
 assert.throws(()=>f.replacementQuote(reservation),/EXCHANGE_PAYMENT_OUTSTANDING/);f.source.settle(op.id);await f.executor.reconcile(f.a.scope,op.id);
 const quote=f.replacementQuote(reservation),replacement=f.authorizeFulfillment(quote);assert.equal(quote.quote.details.exchange_finance.amount_minor,oracle.mixed.residual_minor);
 assert.equal((await f.execution.dispatch(f.a.scope,replacement.id)).state,'created');assert.equal(replacements(f),1);assert.equal(captures(f),0);
 assert.equal(availableValue(f.kernel,f.kernel.require(f.a.scope),f.order().id,f.facts).toString(),oracle.mixed.remaining_original_minor);
},{mixed:true,price:'600'}));
test('M06-G03-CREDIT-RESIDUAL-AND-REPLACEMENT-KEEP-ONE-VALUE-RESERVATION',()=>usingExchangeFulfillment(async f=>{
 const reservation=f.reserve(),op=await f.settle('store_credit'),replacement=f.authorizeFulfillment(f.replacementQuote(reservation));
 assert.equal((await f.execution.dispatch(f.a.scope,replacement.id)).state,'created');assert.equal(replacements(f),1);
 const credit=await f.source.lookup(op.id);assert.equal(credit.instrument.balance_minor,oracle.mixed.residual_minor);
 assert.equal(availableValue(f.kernel,f.kernel.require(f.a.scope),f.order().id,f.facts).toString(),oracle.mixed.remaining_original_minor);
 await f.execution.reconcile(f.a.scope,replacement.id);await f.executor.dispatch(f.a.scope,op.id);assert.equal(replacements(f),1);
},{mixed:true,price:'600'}));
test('M06-G02-EQUAL-PRICE-REPLACEMENT-PRESERVES-LEGACY-COMMAND',()=>usingExchangeFulfillment(async f=>{
 const reservation=f.reserve(),quote=f.replacementQuote(reservation),replacement=f.authorizeFulfillment(quote),command=f.nativeCommand(replacement);
 assert.equal(Object.hasOwn(command,'exchange_finance'),false);assert.equal(Object.hasOwn(command,'original_value_minor'),false);
 assert.equal(Object.hasOwn(f.fulfillmentSource.reservation(reservation.id),'exchange_balance_minor'),false);
 assert.equal((await f.execution.dispatch(f.a.scope,replacement.id)).state,'created');assert.equal(captures(f),0);
},{price:'1000',financeSource:false}));
test('M06-G05-INDEPENDENT-GIFT-GRANT-BINDS-ORIGINAL-AND-RECIPIENT',()=>usingExchangeFulfillment(f=>{
 const resource_id=f.order().id,customer_id=f.order().customer_id,recipient_customer_id='verified-gift-recipient',gift_source_digest='a'.repeat(64),binding={resource_id,customer_id,recipient_customer_id,gift_source_digest};
 assert.throws(()=>f.source.assertGiftRecipient(binding),/GIFT_RECIPIENT_UNQUALIFIED/);f.source.seedGiftRecipient({resource_id,recipient_customer_id,gift_source_digest});
 assert.equal(f.source.assertGiftRecipient(binding).qualified,true);
 assert.throws(()=>f.source.assertGiftRecipient({...binding,customer_id:'other-purchaser'}),/GIFT_RECIPIENT_MISMATCH/);
 assert.throws(()=>f.source.assertGiftRecipient({...binding,recipient_customer_id:'other-recipient'}),/GIFT_RECIPIENT_UNQUALIFIED/);
 assert.throws(()=>f.source.assertGiftRecipient({...binding,gift_source_digest:'b'.repeat(64)}),/GIFT_RECIPIENT_UNQUALIFIED/);
}));
test('M06-G03-NATIVE-ORIGINAL-UNIT-CANNOT-REUSE-ANOTHER-ALLOCATION',()=>usingExchangeFulfillment(async f=>{
 const op=await f.settle('refund'),row=f.sourceDb.prepare('SELECT command FROM fixture_resolution_effects WHERE operation_id=?').get(op.id) as any,command=JSON.parse(row.command);
 await assert.rejects(()=>f.source.issue({...command,operation_id:'duplicate-source-operation',allocation_id:'duplicate-source-allocation'}),/ORIGINAL_UNIT_ALREADY_RESOLVED/);
 assert.equal(f.sourceDb.prepare('SELECT count(*) n FROM fixture_resolution_effects').get().n,1);
},{mixed:true,price:'600'}));
