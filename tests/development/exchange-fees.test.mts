import test from 'node:test';import assert from 'node:assert/strict';
import { usingMoney,moneyOracle } from './exchange-money-helpers.mts';
import { feeHistory } from '../../packages/commerce/exchange-fees.mts';

test('CASE-M06-G08-01',()=>usingMoney(async f=>{
 const estimate=f.moneyQuote();assert.equal(estimate.quote.amount_minor,'1723');assert.equal(estimate.quote.money_terms.presentment.minor,'1550');f.recordFee('final');
 const final=f.moneyQuote();assert.equal(final.quote.amount_minor,'1722');assert.equal(final.quote.money_terms.presentment.minor,'1549');
 const history=f.fees.read(f.a.scope,{allocation_id:f.allocation.id});assert.deepEqual(history.estimate.shop,moneyOracle.fees.estimate.shop);assert.deepEqual(history.final.shop,moneyOracle.fees.final.shop);assert.deepEqual(history.delta_from_estimate,{shop:'1',presentment:'1'});
 const op=f.authorize(final);assert.equal((await f.executor.dispatch(f.a.scope,op.id)).state,'accepted');f.source.settle(op.id);const result=await f.executor.reconcile(f.a.scope,op.id);assert.equal(result.state,'settled');assert.equal(result.fee_history.unresolved,false);assert.equal(f.effects(),1);
},{fees:true}));
test('CASE-M06-G08-02',()=>usingMoney(f=>{
 const q=f.moneyQuote(),p=f.gateway.prepare(f.a.scope,q.proposal),a=f.gateway.approve(f.reviewer.scope,{preview_id:p.id,preview_digest:p.digest});f.recordFee('final');
 assert.throws(()=>f.gateway.execute(f.a.scope,{preview_id:p.id,preview_digest:p.digest,approval_id:a.id}),/REFUND_QUOTE_CHANGED|PREVIEW_STALE/,'changed customer fee cannot reuse the earlier exact approval');
 assert.equal(f.effects(),0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM commerce_resolution_operations').get()!.n,0);
 const next=f.authorize(f.moneyQuote());assert.notEqual(next.approval.id,a.id);assert.equal(next.preview.preview.money_terms.applied_fees.shop.tax_minor,'4');
},{fees:true}));
test('CASE-M06-G08-03',()=>usingMoney(async f=>{
 const op=f.authorize(f.moneyQuote());await f.executor.dispatch(f.a.scope,op.id);f.source.settle(op.id);await f.executor.reconcile(f.a.scope,op.id);assert.ok(f.closeReturn().closure);
 const first=f.recordFee('final');f.recordFee('final');f.fees.refresh(f.a.scope,{allocation_id:f.allocation.id,event_id:first.event.event_id});
 const history=f.fees.read(f.a.scope,{allocation_id:f.allocation.id});assert.equal(history.events.length,2);assert.equal(history.operation_id,op.id);assert.equal(history.unresolved,true);assert.deepEqual(history.delta_from_authorized,{shop:'1',presentment:'1'});assert.equal(history.next_action,'reconcile_original_operation');
 assert.equal(f.effects(),1);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM commerce_resolution_operations').get()!.n,1);assert.equal((await f.executor.reconcile(f.a.scope,op.id)).fee_history.unresolved,true);assert.equal(f.effects(),1);
},{fees:true}));
test('TEST-016-NATIVE-FEE-FINALIZATION',()=>usingMoney(f=>{
 const first=f.fees.read(f.a.scope,{allocation_id:f.allocation.id});assert.equal(first.final,null);assert.equal(first.estimate.source_fields.tax,'taxAmountSet');f.recordFee('final');
 const last=f.fees.read(f.a.scope,{allocation_id:f.allocation.id});assert.equal(last.estimate.shop.tax_minor,'3');assert.equal(last.final.shop.tax_minor,'4');assert.equal(last.final.source_fields.tax,'finalizedTaxAmountSet');assert.equal(last.requires_new_approval,true);
},{fees:true}));
test('M06-G08-NATIVE-FINAL-CHANGED-BEFORE-CANONICAL-REFRESH',()=>usingMoney(async f=>{
 const op=f.authorize(f.moneyQuote());f.recordFee('final',{},false);const result=await f.executor.dispatch(f.a.scope,op.id);assert.equal(result.state,'unknown');assert.equal(f.effects(),0,'source must reject the old fee even when canonical history is stale');
 f.fees.refresh(f.a.scope,{allocation_id:f.allocation.id,event_id:'final-one'});assert.equal(f.executor.read(f.a.scope,op.id).fee_history.unresolved,true);
},{fees:true}));
test('M06-G08-FINAL-CHANGES-AFTER-AUTHORIZATION-RETAIN-OPERATION',()=>usingMoney(async f=>{
 const op=f.authorize(f.moneyQuote());f.recordFee('final');await assert.rejects(()=>f.executor.dispatch(f.a.scope,op.id),/REFUND_QUOTE_CHANGED/);assert.equal(f.effects(),0);
 const result=f.executor.read(f.a.scope,op.id);assert.equal(result.state,'authorized');assert.equal(result.fee_history.unresolved,true);assert.throws(()=>f.moneyQuote(),/ALLOCATION_ALREADY_AUTHORIZED/);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM commerce_resolution_operations').get()!.n,1);
},{fees:true}));
test('M06-G08-DROPPED-FINAL-BINDING-NO-NATIVE-EFFECT',()=>usingMoney(async f=>{
 f.recordFee('final');const op=f.authorize(f.moneyQuote()),issue=f.source.issue.bind(f.source);f.source.issue=command=>{const p=structuredClone(command);delete p.money_terms.fee_snapshot;return issue(p);};
 await f.executor.dispatch(f.a.scope,op.id);assert.equal(f.effects(),0,'omitting the approved native final fee must block the native effect');
},{fees:true}));
test('M06-G08-ALTERED-FINAL-TAX-NO-NATIVE-EFFECT',()=>usingMoney(async f=>{
 f.recordFee('final');const op=f.authorize(f.moneyQuote()),issue=f.source.issue.bind(f.source);f.source.issue=command=>{const p=structuredClone(command);p.money_terms.fee_snapshot.final.shop.tax_minor='3';return issue(p);};
 await f.executor.dispatch(f.a.scope,op.id);assert.equal(f.effects(),0,'native final component cannot be reduced to the old estimate');
},{fees:true}));
test('M06-G08-NULL-FINAL-TAX-IS-NOT-ZERO-OR-FINAL',()=>usingMoney(f=>{
 const input=f.feeInput('final');input.native_fee.finalizedTaxAmountSet=null;assert.deepEqual(f.source.money.recordFee(input),{recorded:false,state:'pending_finalization'});
 const result=f.fees.read(f.a.scope,{allocation_id:f.allocation.id});assert.equal(result.final,null);assert.equal(result.events.length,1);assert.equal(result.state,'awaiting_final');assert.equal(f.moneyQuote().quote.amount_minor,'1723');
},{fees:true}));
test('M06-G08-ZERO-FINAL-TAX-IS-EXPLICIT',()=>usingMoney(f=>{
 const input=f.feeInput('final');input.native_fee.finalizedTaxAmountSet.shopMoney.amount='0.00';input.native_fee.finalizedTaxAmountSet.presentmentMoney.amount='0.00';f.recordFee('final',{native_fee:input.native_fee});
 const result=f.fees.read(f.a.scope,{allocation_id:f.allocation.id});assert.equal(result.final.shop.tax_minor,'0');assert.equal(result.final.presentment.tax_minor,'0');assert.equal(f.moneyQuote().quote.amount_minor,'1726');assert.equal(f.moneyQuote().quote.money_terms.presentment.minor,'1553');
},{fees:true}));
test('M06-G08-OUT-OF-ORDER-NATIVE-EVENTS-KEEP-LATEST-FINAL',()=>usingMoney(f=>{
 f.recordFee('final',{},false);const second=f.feeInput('final');second.native_fee.finalizedTaxAmountSet.shopMoney.amount='0.05';second.native_fee.finalizedTaxAmountSet.presentmentMoney.amount='0.05';f.recordFee('final',{event_id:'final-two',revision:2,native_fee:second.native_fee},false);
 f.fees.refresh(f.a.scope,{allocation_id:f.allocation.id,event_id:'final-two'});f.fees.refresh(f.a.scope,{allocation_id:f.allocation.id,event_id:'final-one'});const result=f.fees.read(f.a.scope,{allocation_id:f.allocation.id});assert.equal(result.events.length,3);assert.equal(result.final.revision,2);assert.equal(result.final.shop.tax_minor,'5');assert.equal(result.estimate.shop.tax_minor,'3');
},{fees:true}));
test('M06-G08-CONFLICTING-WEBHOOK-ID-IS-REJECTED',()=>usingMoney(f=>{
 f.recordFee('final');const input=f.feeInput('final');input.native_fee.finalizedTaxAmountSet.shopMoney.amount='0.05';assert.throws(()=>f.recordFee('final',{native_fee:input.native_fee}),/FEE_EVENT_CONFLICT/);assert.equal(f.fees.read(f.a.scope,{allocation_id:f.allocation.id}).events.length,2);
},{fees:true}));
test('M06-G08-FINAL-BOUND-TO-EXACT-ALLOCATION',()=>usingMoney(f=>{
 f.recordFee('final');assert.throws(()=>f.fees.refresh(f.a.scope,{allocation_id:f.plan.allocations.find(a=>a.line_id==='beta')!.id,event_id:'final-one'}),/CURRENCY_BINDING_REQUIRED|FEE_EVENT_MISMATCH/);assert.equal(f.effects(),0);
},{fees:true}));
test('M06-G08-ESTIMATE-AND-FINAL-CANNOT-BE-OVERWRITTEN',()=>usingMoney(f=>{
 f.recordFee('final');assert.throws(()=>f.db.prepare('UPDATE commerce_exchange_fee_observations SET phase=? WHERE event_id=?').run('final','estimate-one'),/FEE_HISTORY_IMMUTABLE/);assert.throws(()=>f.db.prepare('DELETE FROM commerce_exchange_fee_observations WHERE event_id=?').run('estimate-one'),/FEE_HISTORY_IMMUTABLE/);assert.equal(f.fees.read(f.a.scope,{allocation_id:f.allocation.id}).estimate.shop.tax_minor,'3');
},{fees:true}));
test('M06-G08-UNKNOWN-EFFECT-WITH-LATE-FINAL-IS-NOT-REISSUED',()=>usingMoney(async f=>{
 const op=f.authorize(f.moneyQuote()),issue=f.source.issue.bind(f.source);f.source.issue=async p=>{await issue(p);throw new Error('lost response');};await f.executor.dispatch(f.a.scope,op.id);assert.equal(f.effects(),1);f.recordFee('final');
 const unknown=f.executor.read(f.a.scope,op.id);assert.equal(unknown.state,'unknown');assert.equal(unknown.fee_history.unresolved,true);f.source.settle(op.id);const result=await f.executor.reconcile(f.a.scope,op.id);assert.equal(result.state,'settled');assert.equal(result.amount_minor,'1723');assert.equal(result.money_terms.presentment.minor,'1550');assert.equal(result.fee_history.unresolved,true);await f.executor.dispatch(f.a.scope,op.id);assert.equal(f.effects(),1);
},{fees:true}));
test('M06-G08-HISTORY-DIGEST-EXPOSES-LATE-CHANGES',()=>usingMoney(f=>{
 const s=f.kernel.require(f.a.scope),before=feeHistory(f.kernel,s,'resolution_case');f.recordFee('final');const after=feeHistory(f.kernel,s,'resolution_case');assert.notEqual(before.digest,after.digest);assert.equal(after.obligations.length,1);assert.equal(after.obligations[0].events.length,2);
},{fees:true}));
test('M06-G08-WRONG-API-OR-FEE-CURRENCY-UNQUALIFIED',()=>usingMoney(f=>{
 assert.throws(()=>f.recordFee('final',{api_version:'2026-07'}),/FEE_SOURCE_UNQUALIFIED/);const input=f.feeInput('final');input.native_fee.finalizedTaxAmountSet.presentmentMoney.currencyCode='USD';assert.throws(()=>f.recordFee('final',{native_fee:input.native_fee}),/CURRENCY_MISMATCH/);assert.equal(f.effects(),0);
},{fees:true}));
test('M06-G08-LATE-FINAL-AFTER-QUALIFICATION-EXPIRY-REMAINS-VISIBLE',()=>usingMoney(async f=>{
 f.source.money.qualify({...f.qualification,revision:2,expires_at:f.now()+10});f.currency.bind(f.a.scope,{allocation_id:f.allocation.id});
 const op=f.authorize(f.moneyQuote());await f.executor.dispatch(f.a.scope,op.id);f.source.settle(op.id);await f.executor.reconcile(f.a.scope,op.id);f.advance(11);
 const late=f.recordFee('final');assert.equal(late.recorded,true,'expired issuance qualification must not discard a native final observation');f.recordFee('final');
 const history=f.fees.read(f.a.scope,{allocation_id:f.allocation.id});assert.equal(history.events.length,2);assert.equal(history.unresolved,true);assert.deepEqual(history.delta_from_authorized,{shop:'1',presentment:'1'});assert.equal(history.operation_id,op.id);
 const result=await f.executor.reconcile(f.a.scope,op.id);assert.equal(result.state,'settled');assert.equal(result.amount_minor,'1723');assert.equal(result.money_terms.presentment.minor,'1550');assert.equal(result.fee_history.unresolved,true);assert.equal(f.effects(),1);
 assert.throws(()=>f.source.money.allocation(f.allocation.id),/CURRENCY_QUALIFICATION_EXPIRED/);const command=JSON.parse(f.db.prepare('SELECT command FROM commerce_resolution_operations WHERE id=?').get(op.id)!.command);await assert.rejects(()=>f.source.issue(command),/CURRENCY_QUALIFICATION_EXPIRED/);assert.equal(f.effects(),1);
},{fees:true}));
