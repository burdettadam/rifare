import test from 'node:test';import assert from 'node:assert/strict';
import { usingMoney,moneyOracle } from './exchange-money-helpers.mts';
import { ResolutionFixtureSource } from '../../packages/adapters/resolution-fixture-source.mts';
import { ResolutionExecution } from '../../packages/commerce/resolution-execution.mts';
import { usingFinance } from './exchange-finance-helpers.mts';
import { usingResolution } from './resolution-helpers.mts';
import { contentDigest } from '../../packages/commerce/configuration-values.mts';

test('CASE-M06-G07-01',()=>usingMoney(async f=>{
 const q=f.moneyQuote();assert.equal(q.quote.currency,'USD');assert.equal(q.quote.amount_minor,'1940');assert.deepEqual(q.quote.money_terms.shop,{currency:'USD',minor:'1940'});assert.deepEqual(q.quote.money_terms.presentment,{currency:'EUR',minor:'1746'});
 assert.equal(q.quote.money_terms.original_components.shop.duties_minor,'10');assert.equal(q.quote.money_terms.original_components.presentment.duties_minor,'9');
 const op=f.authorize(q);assert.deepEqual(op.preview.preview.money_terms,q.quote.money_terms);assert.equal((await f.executor.dispatch(f.a.scope,op.id)).state,'accepted');f.source.settle(op.id);const result=await f.executor.reconcile(f.a.scope,op.id);
 assert.equal(result.state,'settled');assert.deepEqual(result.money_terms,q.quote.money_terms);assert.equal(f.effects(),1);assert.deepEqual((await f.source.lookup(op.id))!.money_terms.presentment,{currency:'EUR',minor:'1746'});
}));
test('CASE-M06-G07-02',()=>usingMoney(async f=>{
 const op=f.authorize(f.moneyQuote()),issue=f.source.issue.bind(f.source);f.source.issue=async command=>{const p=structuredClone(command);delete p.money_terms.rate_provenance;return issue(p);};
 assert.equal((await f.executor.dispatch(f.a.scope,op.id)).state,'unknown');assert.equal(f.effects(),0,'missing original conversion provenance must fail before any native effect');
}));
test('CASE-M06-G07-03',()=>usingMoney(f=>{
 f.update({current_conversion_rate:moneyOracle.later_rate});const q=f.moneyQuote();assert.equal(q.quote.money_terms.presentment.minor,'1746');assert.equal(q.quote.money_terms.rate_provenance.id,'original-rate-2026');assert.equal(q.quote.money_terms.conversion_performed,false);assert.notEqual(q.quote.money_terms.presentment.minor,'2134');
}));
test('TEST-015-NATIVE-PAIRED-REFUND',()=>usingMoney(async f=>{
 const op=f.authorize(f.moneyQuote()),issue=f.source.issue.bind(f.source);f.source.issue=command=>issue({...command,currency:'EUR',amount_minor:'1746'});
 assert.equal((await f.executor.dispatch(f.a.scope,op.id)).state,'unknown');assert.equal(f.effects(),0,'a presentment amount must not be substituted for the approved shop amount');
}));
test('M06-G07-DROPPED-ALL-MONEY-TERMS-NO-EFFECT',()=>usingMoney(async f=>{
 const op=f.authorize(f.moneyQuote()),issue=f.source.issue.bind(f.source);f.source.issue=command=>{const p=structuredClone(command);delete p.money_terms;return issue(p);};
 assert.equal((await f.executor.dispatch(f.a.scope,op.id)).state,'unknown');assert.equal(f.effects(),0,'source account/profile requires paired money even when the optional field disappears');assert.equal((await f.executor.reconcile(f.a.scope,op.id)).state,'unknown');
}));
test('M06-G07-WRONG-PRESENTMENT-CURRENCY-NO-EFFECT',()=>usingMoney(async f=>{
 const op=f.authorize(f.moneyQuote()),issue=f.source.issue.bind(f.source);f.source.issue=command=>{const p=structuredClone(command);p.money_terms.presentment.currency='GBP';return issue(p);};
 await f.executor.dispatch(f.a.scope,op.id);assert.equal(f.effects(),0,'native guard must reject the wrong presentment currency');
}));
test('M06-G07-WRONG-DUTIES-NO-EFFECT',()=>usingMoney(async f=>{
 const op=f.authorize(f.moneyQuote()),issue=f.source.issue.bind(f.source);f.source.issue=command=>{const p=structuredClone(command);p.money_terms.original_components.presentment.duties_minor='999';return issue(p);};
 await f.executor.dispatch(f.a.scope,op.id);assert.equal(f.effects(),0,'native duty components remain independently bound');
}));
test('M06-G07-CALLER-CANNOT-SUPPLY-QUALIFICATION-OR-MONEY',()=>usingMoney(f=>{
 assert.throws(()=>f.currency.bind(f.a.scope,{allocation_id:f.allocation.id,qualification:'connected'}),/INVALID_INPUT/);
 assert.throws(()=>f.quotes.quote(f.a.scope,{allocation_id:f.allocation.id,currency:'EUR',amount_minor:'1746'}),/INVALID_INPUT/);
 assert.throws(()=>f.source.money.qualify({...f.qualification,revision:2,qualification:'connected'}),/CURRENCY_COMBINATION_UNQUALIFIED/);assert.equal(f.effects(),0);
}));
test('M06-G07-UNSUPPORTED-CURRENCY-PRECISION-FAILS-CLOSED',()=>usingMoney(f=>{
 assert.throws(()=>f.source.money.qualify({...f.qualification,revision:2,presentment_currency:'CNY'}),/UNSUPPORTED_CURRENCY/);
 const input=f.feeInput();input.native_fee.taxAmountSet.shopMoney.amount='0.001';assert.throws(()=>f.source.money.recordFee(input),/INVALID_PRECISION/);assert.equal(f.effects(),0);
},{fees:true}));
test('M06-G07-ZERO-DECIMAL-NATIVE-CURRENCY',()=>usingMoney(f=>{
 assert.deepEqual(f.moneyQuote().quote.money_terms.presentment,{currency:'JPY',minor:'1746'});
 const input=f.feeInput('final');input.native_fee.finalizedTaxAmountSet.presentmentMoney.amount='4.1';assert.throws(()=>f.source.money.recordFee(input),/INVALID_PRECISION/);
},{presentment:'JPY'}));
test('M06-G07-THREE-DECIMAL-NATIVE-CURRENCY',()=>usingMoney(f=>{
 assert.deepEqual(f.moneyQuote().quote.money_terms.presentment,{currency:'KWD',minor:'1746'});
 const input=f.feeInput('final');input.native_fee.finalizedTaxAmountSet.presentmentMoney.amount='0.0004';assert.throws(()=>f.source.money.recordFee(input),/INVALID_PRECISION/);
},{presentment:'KWD'}));
test('M06-G07-QUALIFICATION-REFRESH-REQUIRES-NEW-PREVIEW',()=>usingMoney(f=>{
 const q=f.moneyQuote(),p=f.gateway.prepare(f.a.scope,q.proposal),a=f.gateway.approve(f.reviewer.scope,{preview_id:p.id,preview_digest:p.digest});
 f.source.money.qualify({...f.qualification,revision:2,evidence_id:'refreshed-fixture-evidence'});f.currency.bind(f.a.scope,{allocation_id:f.allocation.id});
 assert.throws(()=>f.gateway.execute(f.a.scope,{preview_id:p.id,preview_digest:p.digest,approval_id:a.id}),/REFUND_QUOTE_CHANGED/);assert.equal(f.moneyQuote().quote.money_terms.presentment.minor,'1746');assert.equal(f.effects(),0);
}));
test('M06-G07-NATIVE-REVOCATION-BLOCKS-STALE-CANONICAL-SNAPSHOT',()=>usingMoney(async f=>{
 const op=f.authorize(f.moneyQuote());f.source.money.qualify({...f.qualification,revision:2,enabled:false});await f.executor.dispatch(f.a.scope,op.id);assert.equal(f.effects(),0);assert.equal(f.executor.read(f.a.scope,op.id).state,'unknown');
}));
test('M06-G07-ORIGINAL-PROVENANCE-IMMUTABLE',()=>usingMoney(f=>{
 assert.throws(()=>f.source.money.seedOrder({...f.profile,rate_provenance:null}),/INVALID_INPUT/);
 assert.throws(()=>f.source.money.seedOrder({...f.profile,rate_provenance:{...f.profile.rate_provenance,id:'arbitrary-current-rate'}}),/ORIGINAL_MONEY_IMMUTABLE/);
}));
test('M06-G07-ORIGINAL-UNIT-NATIVE-REUSE-REJECTED',()=>usingMoney(f=>{
 const b=f.currency.read(f.a.scope,{allocation_id:f.allocation.id}).binding;
 assert.throws(()=>f.source.money.bindAllocation({allocation_id:'another-allocation',resource_id:b.resource_id,line_id:b.line_id,units:b.units,restocking_bps:b.restocking_bps,return_shipping_minor:b.return_shipping_minor,native_return_id:b.native_return_id}),/ORIGINAL_UNIT_ALREADY_RESOLVED/);
}));
test('M06-G07-CORRUPT-CANONICAL-PAIR-REJECTED',()=>usingMoney(f=>{
 assert.throws(()=>f.db.prepare('UPDATE commerce_exchange_currency_bindings SET digest=? WHERE allocation_id=?').run('0'.repeat(64),f.allocation.id),/CURRENCY_HISTORY_IMMUTABLE/);assert.equal(f.moneyQuote().quote.money_terms.binding_digest,contentDigest(f.currency.read(f.a.scope,{allocation_id:f.allocation.id}).binding));
}));
test('M06-G07-LOST-RESPONSE-RECONCILES-ORIGINAL-AFTER-EXPIRY',()=>usingMoney(async f=>{
 const op=f.authorize(f.moneyQuote()),issue=f.source.issue.bind(f.source);f.source.issue=async p=>{await issue(p);throw new Error('lost response');};
 assert.equal((await f.executor.dispatch(f.a.scope,op.id)).state,'unknown');assert.equal(f.effects(),1);f.source.settle(op.id);f.advance(300001);
 const result=await f.executor.reconcile(f.a.scope,op.id);assert.equal(result.state,'settled');assert.equal(result.money_terms.presentment.minor,'1746');assert.equal(f.effects(),1);await f.executor.dispatch(f.a.scope,op.id);assert.equal(f.effects(),1);
}));
test('M06-G07-OLD-UNKNOWN-PAYMENT-REMAINS-RECONCILABLE',()=>usingFinance(async f=>{
 const op=f.authorize(f.financeQuote()),issue=f.source.issue.bind(f.source);f.source.issue=async p=>{await issue(p);throw new Error('lost response');};await f.executor.dispatch(f.a.scope,op.id);
 const upgraded=new ResolutionFixtureSource(f.sourceDb,{mode:'fixture',identity:'source-one',tenant:f.a.tenant,store:f.a.store},f.now);upgraded.settlePayment(op.id);const result=await new ResolutionExecution(f.kernel,upgraded).reconcile(f.a.scope,op.id);assert.equal(result.state,'settled');assert.equal(result.payment_settled,true);assert.equal(upgraded.db.prepare('SELECT COUNT(*) n FROM fixture_payment_captures').get()!.n,1);
}));
test('M06-G07-OLD-UNKNOWN-REFUND-REMAINS-RECONCILABLE',()=>usingResolution(async f=>{
 const allocation=f.allocate().allocations[0],op=f.authorize(f.quote(allocation)),issue=f.source.issue.bind(f.source);f.source.issue=async p=>{await issue(p);throw new Error('lost response');};await f.executor.dispatch(f.a.scope,op.id);
 const upgraded=new ResolutionFixtureSource(f.sourceDb,{mode:'fixture',identity:'source-one',tenant:f.a.tenant,store:f.a.store},f.now);upgraded.settle(op.id);assert.equal((await new ResolutionExecution(f.kernel,upgraded).reconcile(f.a.scope,op.id)).state,'settled');assert.equal(upgraded.db.prepare('SELECT COUNT(*) n FROM fixture_resolution_effects').get()!.n,1);
}));
