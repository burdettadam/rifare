import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync,readFileSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ProcurementFixtureSource } from '../../packages/adapters/procurement-fixture-source.mts';
import { ForecastBacktests } from '../../packages/commerce/forecast-backtests.mts';
import { InventoryTransfers } from '../../packages/commerce/inventory-transfers.mts';
import { calculateReplenishment } from '../../packages/commerce/replenishment-planning.mts';
import { canonical,contentDigest } from '../../packages/commerce/configuration-values.mts';
import { usingProcurement,oracle,nativeSendCount } from './procurement-planning-helpers.mts';

async function mutant(file:string,marker:string,replacement:string,run:(module:any)=>unknown){
 const directory=mkdtempSync(join(tmpdir(),'rifare-procurement-mutant-'));
 try{const url=new URL('../../packages/commerce/'+file,import.meta.url),original=readFileSync(url,'utf8');assert.equal(original.split(marker).length,2);
  const source=original.replace(marker,replacement).replace(/from '([.][^']+)'/g,(_all,path)=>"from '"+new URL(path,url).href+"'");
  const target=join(directory,'mutant.mts');writeFileSync(target,source);await run(await import(pathToFileURL(target).href));
 }finally{rmSync(directory,{recursive:true,force:true});}
}

// Root's reserved integration slot; independent expected quantities are fixed
// here before the first integrated native execution. This is local preparation.
test('M11-PREP-INTEGRATION-01',t=>usingProcurement(async f=>{
 const opening=f.balance();assert.equal(opening.available,10);assert.equal(opening.on_hand,10);
 await f.openPO('demo-existing-po',6);
 const proposal=f.plan('demo-stockout-risk');
 assert.equal(proposal.assumptions.target_units,20);assert.equal(proposal.assumptions.incoming_units,6);
 assert.equal(proposal.net_required_units,4);assert.equal(proposal.quantity,4);assert.equal(proposal.purchasing_authorized,false);
 const forecast=f.forecasts.assertReviewed(f.a.scope,{forecast_id:proposal.forecast.id,expected_digest:proposal.forecast.digest});
 const backtest=new ForecastBacktests(f.kernel).read(f.a.scope,forecast.backtest_id);
 assert.deepEqual(backtest.plan.baseline_versions,['last_value_v1','seasonal_2_v1']);assert.deepEqual(backtest.plan.horizons,[5]);
 assert.equal(backtest.cells.length,2);assert.ok(backtest.cells.every((cell:any)=>cell.training_max_event_at<=cell.origin&&cell.training_max_observed_at<=cell.origin));
 const metrics=backtest.metrics.filter((row:any)=>row.cohort_key==='all');
 assert.equal(metrics.length,3);for(const row of metrics){assert.equal(row.declared_count,2);assert.equal(row.scored_count,2);assert.equal(row.actual_units,40);assert.equal(row.absolute_error,0);assert.equal(row.signed_error,0);assert.equal(row.service_rate,1);}
 const draft=f.orders.draft(f.a.scope,{...f.draftInput('demo-new-po',proposal.quantity),replenishment_id:proposal.id});
 assert.equal(draft.state,'draft');assert.equal(draft.total_minor,'1000');
 const ref={po_id:draft.id,version:draft.version,expected_digest:draft.digest};
 assert.throws(()=>f.approvals.approve(f.a.scope,{...ref,budget_id:'procurement-budget',expires_at:f.now()+60000}),/ACCESS_DENIED|SELF_APPROVAL/);
 const approval=f.approve(draft);assert.notEqual(approval.approver,draft.proposed_by);assert.equal(approval.po_digest,draft.digest);
 const sent=await f.approvals.send(f.a.scope,{...ref,operation_id:'demo-original-send'});assert.equal(sent.state,'sent');assert.equal(f.balance().on_hand,10);
 f.supplierSource.acknowledge('demo-original-send',{event_id:'demo-native-ack'});
 const acknowledged=await f.approvals.reconcile(f.a.scope,ref);assert.equal(acknowledged.state,'acknowledged');
 const receipt=await f.receive(acknowledged,2,'demo-partial-receipt');assert.equal(receipt.state,'applied');
 const summary=f.receipts.summary(f.a.scope,ref),line=summary.lines[0];
 assert.deepEqual({ordered:line.ordered,cancelled:line.cancelled,received:line.received,unknown:line.unknown,outstanding:line.outstanding},{ordered:4,cancelled:0,received:2,unknown:0,outstanding:2});
 assert.equal(f.balance().on_hand,12);assert.equal(f.warehouse.stock('sku-a','location-a'),12);
 const after=f.plan('demo-after-partial');assert.equal(after.assumptions.incoming_units,8);assert.equal(after.assumptions.available_units,12);assert.equal(after.quantity,0);
 assert.equal(acknowledged.invoice_state,'unobserved');assert.equal(acknowledged.payment_state,'unobserved');

 // Retained transfer behavior uses the same source, SKU, resource and kernel.
 f.warehouse.seed('sku-a','location-b',0);
 f.inventory.claim(f.owner,{resource_id:f.resource.id,variant_id:'sku-a',location_id:'location-b',source_identity:f.stockSource.identity,fields:['available','on_hand','reserved','in_transit']});
 f.stockSource.snapshot({observation_id:'demo-location-b-opening',resource_id:f.resource.id,variant_id:'sku-a',location_id:'location-b'});
 f.inventory.importSnapshot(f.a.scope,'demo-location-b-opening');
 const transfers=new InventoryTransfers(f.kernel,f.inventory,f.stockSource,{deadline_ms:25});
 transfers.plan(f.a.scope,{transfer_id:'demo-transfer',resource_id:f.resource.id,variant_id:'sku-a',from_location:'location-a',to_location:'location-b',quantity:3});
 for(const kind of ['reserve','dispatch','receive']) {
  const state=transfers.read(f.a.scope,'demo-transfer'),op=transfers.propose(f.a.scope,'demo-transfer',{operation_id:'demo-transfer-'+kind,kind,quantity:3,expected_revision:state.revision});
  transfers.approve(f.reviewer,op.operation_id,{expected_digest:op.command_digest,expires_at:f.now()+60000});
  assert.equal((await transfers.dispatch(f.a.scope,op.operation_id)).state,'applied');
 }
 const origin=f.inventory.balance(f.a.scope,{resource_id:f.resource.id,variant_id:'sku-a',location_id:'location-a'}),destination=f.inventory.balance(f.a.scope,{resource_id:f.resource.id,variant_id:'sku-a',location_id:'location-b'});
 assert.equal(origin.on_hand,9);assert.equal(destination.on_hand,3);assert.equal(origin.on_hand+destination.on_hand,12);
 assert.equal(origin.reserved+destination.reserved+origin.in_transit+destination.in_transit,0);
 assert.equal(f.warehouse.stock('sku-a','location-a')+f.warehouse.stock('sku-a','location-b'),12);
 t.diagnostic('M11_LOCAL_INTEGRATION_EVIDENCE '+JSON.stringify({qualification:'synthetic_local_preparation',formal_goal_accepted:false,
  forecast:{id:forecast.id,digest:forecast.digest,dataset_digest:forecast.dataset_digest,backtest_digest:forecast.backtest_digest,as_of:forecast.as_of,horizon_days:forecast.horizon_days,quantity:forecast.quantity},
  backtest:{id:backtest.id,digest:backtest.digest,baselines:backtest.plan.baseline_versions,horizons:backtest.plan.horizons,metrics},
  stockout:{target_units:20,opening_available:10,existing_incoming:6,proposed_units:proposal.quantity},
  purchase:{...ref,approval_id:approval.id,amount_minor:draft.total_minor,original_operation_id:sent.operation_id,native_id:sent.native_id},
  receipt:{operation_id:receipt.operation_id,source_identity:f.stockSource.identity,ordered:line.ordered,received:line.received,outstanding:line.outstanding},
  conservation:{after_partial_on_hand:12,incoming_after_partial:after.assumptions.incoming_units,location_a:origin.on_hand,location_b:destination.on_hand,total_on_hand:origin.on_hand+destination.on_hand}}));
}));

test('M11-G04-01',()=>usingProcurement(async f=>{
 await f.openPO('incoming',oracle.open_po_units);
 const p=f.plan('replenishment-one');
 assert.equal(p.quantity,oracle.initial_replenishment_units);assert.equal(p.base_quantity,4);
 assert.equal(p.assumptions.available_units,oracle.initial_available);assert.equal(p.assumptions.incoming_units,6);
 assert.equal(p.assumptions.target_units,20);assert.equal(p.state,'draft');assert.equal(p.purchasing_authorized,false);
 assert.equal(p.forecast.digest,f.forecast.digest);assert.equal(p.assumptions.lead_time_days,2);assert.equal(nativeSendCount(f),1);
 assert.throws(()=>f.planning.read(f.b.scope,p.id),/NOT_FOUND|ACCESS_DENIED/);
},true));

test('M11-G04-02',()=>usingProcurement(async f=>{
 assert.throws(()=>f.planning.propose(f.a.scope,{...f.planInput('forged'),forecast_id:'caller-forged',expected_forecast_digest:'0'.repeat(64)}),/NOT_FOUND|FORECAST/);
 const draft=f.plan('advisory-only');assert.equal(draft.state,'draft');assert.equal(nativeSendCount(f),0);
 await assert.rejects(f.approvals.send(f.a.scope,{po_id:draft.id,version:1,expected_digest:draft.digest,operation_id:'forecast-is-not-a-po'}),/NOT_FOUND|PURCHASE/);
 const longerLead=f.supplierSource.recordSupplierTerms({...f.termsInput,version:2,lines:f.termsInput.lines.map((line:any)=>({...line,lead_time_days:5}))});
 f.orders.importSupplier(f.a.scope,{supplier_id:'supplier-a',resource_id:f.resource.id});
 assert.equal(f.forecast.horizon_days,5);assert.ok(f.forecast.valid_until<f.now()+5*86400000);
 assert.throws(()=>f.planning.propose(f.a.scope,{...f.planInput('elapsed-forecast-window'),expected_terms_digest:longerLead.digest}),/REPLENISHMENT_HORIZON_OR_UNIT_UNSUPPORTED/);
 f.forecasts.revoke(f.reviewer,f.forecast.approval_id);
 assert.throws(()=>f.plan('revoked-forecast'),/FORECAST|APPROVAL|REVIEW/);assert.equal(nativeSendCount(f),0);
},true));

test('M11-G04-03',async()=>{
 await usingProcurement(async f=>{
  const po=await f.openPO('partial-po',6);await f.receive(po,2,'receipt-partial');
  const partial=f.plan('after-partial');assert.equal(f.balance().on_hand,oracle.available_after_partial);
  assert.equal(partial.assumptions.incoming_units,oracle.outstanding_after_partial);assert.equal(partial.quantity,oracle.replenishment_after_partial);
  f.supplierSource.observeCancellation(po.operation_id,{event_id:'supplier-cancel-two',line_id:'line-a',quantity_base:2});
  assert.throws(()=>f.plan('unreconciled-cancellation'),/SOURCE_RECONCILIATION_REQUIRED/);
  await f.approvals.reconcile(f.a.scope,{po_id:po.id,version:po.version,expected_digest:po.digest});
  const cancelled=f.plan('after-cancellation');assert.equal(cancelled.assumptions.incoming_units,oracle.outstanding_after_cancellation);
  assert.equal(cancelled.quantity,oracle.replenishment_after_cancellation);assert.equal(f.balance().on_hand,12);
  assert.equal(f.approvals.budget(f.owner,'procurement-budget').obligated_minor,'1500');
 },true);
 await mutant('replenishment-planning.mts','const incoming = integer(input.incoming_units);','const incoming = 0;',module=>{
  const broken=module.calculateReplenishment({target_units:20,available_units:10,incoming_units:6,units_per_purchase:1,minimum_quantity:1});
  assert.equal(broken.quantity,10);assert.throws(()=>assert.equal(broken.quantity,oracle.initial_replenishment_units,'Open POs must reduce a replenishment suggestion'),assert.AssertionError);
 });
});

test('M11-G05-01',()=>usingProcurement(f=>{
 const po=f.draft('five-units',5);assert.equal(po.state,'draft');assert.equal(po.source_stage,'not_sent');
 assert.equal(po.total_minor,oracle.five_units_total_minor);assert.equal(po.currency_code,oracle.currency_code);
 assert.equal(po.lines[0].ordered_base_quantity,5);assert.equal(po.lines[0].unit_cost_minor,'250');
 assert.deepEqual(po.lines[0].conversion,{numerator:1,denominator:1});assert.equal(po.warehouse_source_identity,f.inventory.source.identity);
 assert.equal(po.supplier_terms_digest,f.terms.digest);assert.equal(po.operation_id,null);assert.equal(po.native_id,null);
 assert.equal(nativeSendCount(f),0);assert.equal(f.balance().on_hand,10);
 assert.throws(()=>f.orders.current(f.b.scope,{po_id:po.id,version:po.version,expected_digest:po.digest}),/NOT_FOUND|ACCESS_DENIED/);
}));

test('M11-G05-02',async()=>{
 await usingProcurement(f=>{
 assert.throws(()=>f.orders.draft(f.a.scope,{...f.draftInput('unsupported',5),lines:[{line_id:'line-a',variant_id:'sku-a',location_id:'location-a',quantity:5,order_unit:'pallet'}]}),/UNIT|TERMS/);
 assert.throws(()=>f.supplierSource.recordSupplierTerms({...f.termsInput,version:2,currency_code:'FAKE'}),/CURRENCY/);
 f.supplierSource.recordSupplierTerms({...f.termsInput,version:2,lines:f.termsInput.lines.map((line:any)=>({...line,unit_cost_minor:'300'}))});
 assert.throws(()=>f.draft('changed-price',5),/TERMS_CHANGED/);assert.equal(nativeSendCount(f),0);
 });
 await usingProcurement(async f=>{
  const terms=f.supplierSource.recordSupplierTerms({...f.termsInput,version:2,lines:[{...f.termsInput.lines[0],order_unit:'case',conversion:{numerator:1000000,denominator:1},unit_cost_minor:'1'}]});
  f.orders.importSupplier(f.a.scope,{supplier_id:'supplier-a',resource_id:f.resource.id});
  const input=(po_id:string,quantity:number)=>({...f.draftInput(po_id,quantity),expected_terms_digest:terms.digest,lines:[{line_id:'line-a',variant_id:'sku-a',location_id:'location-a',quantity,order_unit:'case'}]});
  assert.throws(()=>f.orders.draft(f.a.scope,input('oversized-conversion',1001)),/PROCUREMENT_QUANTITY_LIMIT/);
  assert.throws(()=>calculateReplenishment({target_units:1001000000,available_units:0,incoming_units:0,units_per_purchase:1000000,minimum_quantity:1}),/REPLENISHMENT_QUANTITY_INVALID/);
  assert.equal(nativeSendCount(f),0);assert.equal(f.balance().on_hand,10);
  const maximum=f.orders.draft(f.a.scope,input('maximum-conversion',1000));assert.equal(maximum.lines[0].ordered_base_quantity,1000000000);
  f.approve(maximum);const ref={po_id:maximum.id,version:maximum.version,expected_digest:maximum.digest};
  assert.equal((await f.approvals.send(f.a.scope,{...ref,operation_id:'maximum-conversion-send'})).state,'sent');
  f.supplierSource.acknowledge('maximum-conversion-send',{event_id:'maximum-conversion-ack'});await f.approvals.reconcile(f.a.scope,ref);
  f.receipts.facts.recordReceipt({receipt_id:'maximum-partial',po_id:maximum.id,version:maximum.version,po_digest:maximum.digest,lines:[{line_id:'line-a',quantity:1,unit:'case'}],observed_at:f.now(),evidence_ref:'maximum-partial-evidence'});
  const receipt=f.receipts.propose(f.a.scope,{...ref,receipt_id:'maximum-partial',operation_id:'maximum-partial-operation'});
  f.receipts.approve(f.reviewer,receipt.operation_id,{expected_digest:receipt.command_digest,expires_at:f.now()+60000});
  assert.equal((await f.receipts.dispatch(f.a.scope,receipt.operation_id)).state,'applied');
  const line=f.receipts.summary(f.a.scope,ref).lines[0];assert.equal(line.received,1000000);assert.equal(line.outstanding,999000000);assert.equal(f.balance().on_hand,1000010);
  const receiveCases=async(po:any,quantity:number,receipt_id:string)=>{
   f.receipts.facts.recordReceipt({receipt_id,po_id:po.id,version:po.version,po_digest:po.digest,lines:[{line_id:'line-a',quantity,unit:'case'}],observed_at:f.now(),evidence_ref:receipt_id+'-evidence'});
   const op=f.receipts.propose(f.a.scope,{po_id:po.id,version:po.version,expected_digest:po.digest,receipt_id,operation_id:receipt_id+'-operation'});
   f.receipts.approve(f.reviewer,op.operation_id,{expected_digest:op.command_digest,expires_at:f.now()+60000});
   assert.equal((await f.receipts.dispatch(f.a.scope,op.operation_id)).state,'applied');
  };
  await receiveCases(maximum,999,'maximum-remainder');
  assert.equal(f.receipts.summary(f.a.scope,ref).lines[0].outstanding,0);assert.equal(f.balance().on_hand,1000000010);
  // Stock accumulated across valid effects retains the original ledger's
  // safe-integer domain; a following bounded command must remain usable.
  const next=f.orders.draft(f.a.scope,input('following-bounded-order',1)),nextRef={po_id:next.id,version:next.version,expected_digest:next.digest};f.approve(next);
  assert.equal((await f.approvals.send(f.a.scope,{...nextRef,operation_id:'following-bounded-send'})).state,'sent');
  f.supplierSource.acknowledge('following-bounded-send',{event_id:'following-bounded-ack'});await f.approvals.reconcile(f.a.scope,nextRef);
  await receiveCases(next,1,'following-bounded-receipt');assert.equal(f.balance().on_hand,1001000010);

  // Model a validly hashed historical draft from the earlier, wider domain.
  // Its actual current review must still reach a source that rejects the size.
  const old=f.orders.draft(f.a.scope,input('historical-wide-domain',1000));
  const row=f.db.prepare('SELECT * FROM commerce_purchase_order_versions WHERE tenant_id=? AND store_id=? AND po_id=? AND version=?').get(f.a.tenant,f.a.store,old.id,old.version) as any;
  const body=JSON.parse(row.body);body.total_minor='1001';Object.assign(body.lines[0],{quantity:1001,ordered_quantity:1001,ordered_base_quantity:1001000000,base_quantity:1001000000,line_total_minor:'1001'});
  f.db.prepare('UPDATE commerce_purchase_order_versions SET body=?,digest=? WHERE tenant_id=? AND store_id=? AND id=?').run(canonical(body),contentDigest(body),f.a.tenant,f.a.store,row.id);
  const historicalRef={po_id:old.id,version:old.version,expected_digest:contentDigest(body)},historical=f.orders.current(f.a.scope,historicalRef);f.approve(historical);
  let sourceError='';const send=f.supplierSource.send.bind(f.supplierSource);
  f.supplierSource.send=async command=>{try{return await send(command);}catch(error){sourceError=(error as Error).message;throw error;}};
  const blocked=await f.approvals.send(f.a.scope,{...historicalRef,operation_id:'historical-wide-domain-send'});
  assert.equal(sourceError,'PROCUREMENT_QUANTITY_LIMIT');assert.equal(blocked.state,'unknown');assert.equal(blocked.operation_id,'historical-wide-domain-send');
  assert.equal(nativeSendCount(f),2);assert.equal(f.approvals.budget(f.owner,'procurement-budget').obligated_minor,'2002');assert.equal(f.balance().on_hand,1001000010);
 });
});

test('M11-G05-03',async()=>{
 await usingProcurement(async f=>{
  const po=f.draft('edited-po',5);f.approve(po);
  const changed=f.orders.revise(f.a.scope,{po_id:po.id,expected_version:1,expected_terms_digest:f.terms.digest,lines:[{line_id:'line-a',variant_id:'sku-a',location_id:'location-a',quantity:6,order_unit:'each'}]});
  assert.equal(changed.version,2);assert.notEqual(changed.digest,po.digest);assert.equal(changed.state,'draft');assert.equal(changed.total_minor,'1500');
  await assert.rejects(f.approvals.send(f.a.scope,{po_id:changed.id,version:2,expected_digest:changed.digest,operation_id:'edited-unapproved'}),/APPROVAL/);
  assert.equal(f.approvals.budget(f.owner,'procurement-budget').obligated_minor,'0');assert.equal(nativeSendCount(f),0);
  assert.equal(f.orders.current(f.a.scope,{po_id:po.id,version:1,expected_digest:po.digest}).state,'superseded');
 });
 await mutant('procurement-core.mts',"return {state:'draft',source_stage:'not_sent'};","return {state:'acknowledged',source_stage:'acknowledged'};",module=>{
  const broken=module.initialPurchaseOrderState();assert.throws(()=>assert.deepEqual(broken,{state:'draft',source_stage:'not_sent'},'Draft creation has no supplier acknowledgment'),assert.AssertionError);
 });
});

test('M11-G06-01',()=>usingProcurement(async f=>{
 const po=f.draft('approved-po',5);const approval=f.approve(po);assert.equal(approval.po_digest,po.digest);
 const sent=await f.approvals.send(f.a.scope,{po_id:po.id,version:po.version,expected_digest:po.digest,operation_id:'original-send'});
 assert.equal(sent.state,'sent');assert.equal(sent.source_stage,'sent');assert.equal(sent.payment_state,'unobserved');assert.equal(sent.invoice_state,'unobserved');
 assert.equal(nativeSendCount(f),1);assert.equal(f.approvals.budget(f.owner,'procurement-budget').obligated_minor,'1250');
 const again=await f.approvals.send(f.a.scope,{po_id:po.id,version:po.version,expected_digest:po.digest,operation_id:'original-send'});assert.equal(again.operation_id,'original-send');assert.equal(nativeSendCount(f),1);
 f.supplierSource.acknowledge('original-send',{event_id:'supplier-acknowledged'});
 const acknowledged=await f.approvals.reconcile(f.a.scope,{po_id:po.id,version:po.version,expected_digest:po.digest});
 assert.equal(acknowledged.state,'acknowledged');assert.equal(acknowledged.native_id,sent.native_id);assert.equal(acknowledged.payment_state,'unobserved');
}));

test('M11-G06-02',async()=>{
 await usingProcurement(f=>{
  const own=f.orders.draft(f.owner,f.draftInput('owner-drafted',5));assert.throws(()=>f.approvals.approve(f.owner,{po_id:own.id,version:own.version,expected_digest:own.digest,budget_id:'procurement-budget',expires_at:f.now()+60000}),/SELF_APPROVAL/);
  const expensive=f.draft('over-budget',50);assert.throws(()=>f.approve(expensive),/BUDGET/);assert.equal(nativeSendCount(f),0);
 });
 await usingProcurement(async f=>{
  const po=f.draft('expired',5);f.approve(po);f.advance(60001);
  await assert.rejects(f.approvals.send(f.a.scope,{po_id:po.id,version:po.version,expected_digest:po.digest,operation_id:'expired-send'}),/APPROVAL_EXPIRED/);assert.equal(nativeSendCount(f),0);
 });
});

test('M11-G06-03',async()=>{
 await usingProcurement(async f=>{
  f.approvals.configureBudget(f.owner,{budget_id:'race-budget',resource_id:f.resource.id,expected_revision:0,currency_code:'USD',limit_minor:oracle.race_budget_minor,approval_limit_minor:'2000',expires_at:f.now()+600000});
  const a=f.draft('race-a',5),b=f.draft('race-b',5);
  const results=await Promise.allSettled([a,b].map(po=>Promise.resolve().then(()=>f.approve(po,'race-budget'))));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
  const budget=f.approvals.budget(f.owner,'race-budget');assert.equal(budget.obligated_minor,oracle.race_approved_total_minor);assert.equal(budget.remaining_minor,oracle.race_remaining_minor);assert.equal(nativeSendCount(f),0);
 });
 await mutant('procurement-core.mts',"if (draftedBy === approvingActor) throw new Error('PROCUREMENT_SELF_APPROVAL_DENIED');","if (false && draftedBy === approvingActor) throw new Error('PROCUREMENT_SELF_APPROVAL_DENIED');",module=>{
  assert.throws(()=>assert.throws(()=>module.assertProcurementSeparation('drafter','drafter'),/SELF_APPROVAL/),assert.AssertionError);
 });
});

test('PORT-031-M11',()=>usingProcurement(async f=>{
 const drafted=f.orders.draft(f.agent,f.draftInput('agent-drafted',5));
 assert.throws(()=>f.approvals.approve(f.agent,{po_id:drafted.id,version:drafted.version,expected_digest:drafted.digest,budget_id:'procurement-budget',expires_at:f.now()+60000}),/ACCESS_DENIED|SELF_APPROVAL/);
 f.approve(drafted);await f.approvals.send(f.a.scope,{po_id:drafted.id,version:drafted.version,expected_digest:drafted.digest,operation_id:'agent-approved-send'});
 f.supplierSource.acknowledge('agent-approved-send',{event_id:'agent-po-ack'});const po=await f.approvals.reconcile(f.a.scope,{po_id:drafted.id,version:drafted.version,expected_digest:drafted.digest});
 await f.receive(po,2,'port-partial');await f.receipts.reconcile(f.a.scope,'port-partial-operation');
 const summary=f.receipts.summary(f.a.scope,{po_id:po.id,version:po.version,expected_digest:po.digest});
 assert.equal(summary.lines[0].received,2);assert.equal(summary.lines[0].outstanding,3);assert.equal(f.balance().on_hand,12);
 assert.equal(f.inventory.source.movements(f.resource.id).filter((row:any)=>row.variant_id==='sku-a'&&row.location_id==='location-a'&&row.delta.on_hand===2).length,1);
}));

test('M11-PROCUREMENT-SOURCE-BOUNDARY',async()=>{
 await usingProcurement(async f=>{
  const po=f.draft('unknown-po',5);f.approve(po);f.supplierSource.fault='after';
  const unknown=await f.approvals.send(f.a.scope,{po_id:po.id,version:po.version,expected_digest:po.digest,operation_id:'unknown-original'});
  assert.equal(unknown.state,'unknown');assert.equal(nativeSendCount(f),1);assert.equal(f.approvals.budget(f.owner,'procurement-budget').obligated_minor,'1250');
  await assert.rejects(f.approvals.send(f.a.scope,{po_id:po.id,version:po.version,expected_digest:po.digest,operation_id:'new-key-for-same-po'}),/ORIGINAL_SEND_REQUIRED/);
  const original=await f.approvals.reconcile(f.a.scope,{po_id:po.id,version:po.version,expected_digest:po.digest});assert.equal(original.operation_id,'unknown-original');assert.equal(original.state,'sent');assert.equal(nativeSendCount(f),1);
 });
 await usingProcurement(async f=>{
  const po=f.draft('late-price-change',5);f.approve(po);const send=f.supplierSource.send.bind(f.supplierSource);
  f.supplierSource.send=async command=>{f.supplierSource.recordSupplierTerms({...f.termsInput,version:2,lines:f.termsInput.lines.map((line:any)=>({...line,unit_cost_minor:'300'}))});return send(command);};
  const unknown=await f.approvals.send(f.a.scope,{po_id:po.id,version:po.version,expected_digest:po.digest,operation_id:'changed-at-boundary'});
  assert.equal(unknown.state,'unknown');assert.equal(nativeSendCount(f),0);
  const command=f.approvals.originalCommand(f.a.scope,'changed-at-boundary');
  const db=new DatabaseSync(f.supplierFilename);try{const reopened=new ProcurementFixtureSource(db,f.supplierOptions);
   await assert.rejects(reopened.send(command),/GUARD/);assert.equal(await reopened.lookup('changed-at-boundary'),null);
  }finally{db.close();}
  assert.equal(f.approvals.budget(f.owner,'procurement-budget').obligated_minor,'1250');
 });
});
