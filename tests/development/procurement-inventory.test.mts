import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,readFileSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { WarehouseFixtureSource } from '../../packages/adapters/warehouse-fixture-source.mts';
import { WarehouseInventoryFixtureSource } from '../../packages/adapters/warehouse-inventory-fixture-source.mts';
import { PurchaseReceiving } from '../../packages/commerce/purchase-receiving.mts';
import { contentDigest } from '../../packages/commerce/configuration-values.mts';
import { usingProcurementInventory,oracle,populateProcurementInventoryPrivacy } from './procurement-inventory-helpers.mts';

async function mutant(relative:string,marker:string,replacement:string,run:(module:any)=>unknown){
 const directory=mkdtempSync(join(tmpdir(),'rifare-stock-mutant-'));
 try{const url=new URL(relative,import.meta.url),original=readFileSync(url,'utf8');assert.equal(original.split(marker).length,2,'One actual implementation site');
  const modified=original.replace(marker,replacement).replace(/from '([.][^']+)'/g,(_all,path)=>"from '"+new URL(path,url).href+"'");
  const target=join(directory,'mutant.mts');writeFileSync(target,modified);await run(await import(pathToFileURL(target).href));
 }finally{rmSync(directory,{recursive:true,force:true});}
}

test('M11-G07-PREP-01',()=>usingProcurementInventory(async f=>{
 const first=await f.receive('receipt-first',oracle.purchase.first_receipt);assert.equal(first.state,'applied');
 let summary=f.receiving.summary(f.operator,f.po_ref);assert.deepEqual(summary.lines.map((line:any)=>({ordered:line.ordered,cancelled:line.cancelled,received:line.received,unknown:line.unknown,outstanding:line.outstanding})),[{ordered:10,cancelled:0,received:5,unknown:0,outstanding:5}]);
 assert.equal(f.balance('sku-a').on_hand,15);assert.equal(f.warehouse.stock('sku-a','location-a'),15);assert.equal(first.receipt.financial_effect,false);
 await f.receive('receipt-rest',5);summary=f.receiving.summary(f.operator,f.po_ref);assert.equal(summary.lines[0].outstanding,0);assert.equal(summary.lines[0].received,10);
 assert.equal(f.balance('sku-a').on_hand,oracle.purchase.complete_on_hand);assert.equal(f.receiving.receipts(f.operator,f.po_ref).length,2);assert.equal(summary.planning_blocked,false);
}));

test('M11-G07-PREP-02',()=>usingProcurementInventory(async f=>{
 const original=await f.receive('receipt-same',5),before=f.warehouse.stock('sku-a','location-a');
 const replay=f.receiving.propose(f.operator,{operation_id:'different-caller-key',...f.po_ref,receipt_id:'receipt-same'});assert.equal(replay.operation_id,original.operation_id);
 assert.equal((await f.receiving.dispatch(f.operator,replay.operation_id)).state,'applied');assert.equal(f.warehouse.stock('sku-a','location-a'),before);
 f.observeReceipt('receipt-excess',6);assert.throws(()=>f.receiving.propose(f.operator,{operation_id:'excess-operation',...f.po_ref,receipt_id:'receipt-excess'}),/EXCESS|QUANTITY/);
 f.observeReceipt('receipt-wrong-unit',1,'kg');assert.throws(()=>f.receiving.propose(f.operator,{operation_id:'unit-operation',...f.po_ref,receipt_id:'receipt-wrong-unit'}),/UNIT/);
 const detached=new PurchaseReceiving(f.kernel,f.inventory,f.source);f.observeReceipt('receipt-no-current-source',1);assert.throws(()=>detached.propose(f.operator,{operation_id:'missing-current-supplier',...f.po_ref,receipt_id:'receipt-no-current-source'}),/SOURCE_REQUIRED/);assert.equal((await detached.reconcile(f.operator,original.operation_id)).state,'applied');
 const late=f.prepareReceipt('receipt-cancelled-after-approval',1),apply=f.source.applyProcurement.bind(f.source);f.source.applyProcurement=async command=>{f.supplierSource.observeCancellation(f.po.operation_id,{event_id:'supplier-cancel-after-review',line_id:'line-a',quantity_base:1});return apply(command);};
 assert.equal((await f.receiving.dispatch(f.operator,late.operation_id)).state,'unknown');assert.equal(f.warehouse.stock('sku-a','location-a'),15);f.observeReceipt('receipt-after-unreconciled-cancellation',1);assert.throws(()=>f.receiving.propose(f.operator,{operation_id:'unreconciled-cancellation',...f.po_ref,receipt_id:'receipt-after-unreconciled-cancellation'}),/RECONCILIATION/);
 assert.equal(f.source.movements().filter((movement:any)=>movement.kind==='purchase_receive').length,1);
}));

test('M11-G07-PREP-03',async()=>{
 await usingProcurementInventory(async f=>{
  const prepared=f.prepareReceipt('receipt-lost',5);f.source.fault='after';const lost=await f.receiving.dispatch(f.operator,prepared.operation_id);assert.equal(lost.state,'unknown');assert.equal(f.warehouse.stock('sku-a','location-a'),15);
  const summary=f.receiving.summary(f.operator,f.po_ref);assert.equal(summary.lines[0].unknown,5);assert.equal(summary.planning_blocked,true);
  const restarted=f.restart();try{assert.equal(restarted.receiving.propose(restarted.operator,{operation_id:'new-after-restart',...f.po_ref,receipt_id:'receipt-lost'}).operation_id,lost.operation_id);
   assert.equal((await restarted.receiving.reconcile(restarted.operator,lost.operation_id)).state,'applied');assert.equal(restarted.balance('sku-a').on_hand,15);assert.equal(restarted.source.calls.apply,0);
  }finally{restarted.cleanup();}
 });
 await mutant('../../packages/adapters/warehouse-inventory-fixture-source.mts','result = old; // Original procurement replay has no stock effect.','for(const movement of old.movements)this.#stock(movement.variant_id,movement.location_id,movement.delta.available); result = old;',module=>usingProcurementInventory(async f=>{
  const original=await f.receive('receipt-replay-fault',5),broken=new module.WarehouseInventoryFixtureSource(f.warehouse,{clock:f.now});await broken.applyProcurement(original.command);
  assert.throws(()=>assert.equal(f.warehouse.stock('sku-a','location-a'),15,'A retried native receipt must not add stock'),assert.AssertionError);
 }));
});

test('CASE-M11-G08-01',()=>usingProcurementInventory(async f=>{
 await f.receive('receipt-return',5);const original=f.receiving.receipts(f.operator,f.po_ref)[0];
 const returned=await f.supplierEvent('return-two',{kind:'supplier_return',receipt_id:'receipt-return',quantity:2});assert.equal(returned.state,'applied');
 assert.equal(f.balance('sku-a').on_hand,oracle.purchase.after_supplier_return);const state=f.returns.receipt(f.operator,'receipt-return');
 assert.equal(state.lines[0].received,5);assert.equal(state.lines[0].returned,2);assert.equal(state.lines[0].credit_due_minor,oracle.purchase.credit_obligation_minor);
 assert.equal(f.receiving.receipts(f.operator,f.po_ref)[0].digest,original.digest);assert.equal(f.receiving.summary(f.operator,f.po_ref).lines[0].outstanding,5);
 await f.supplierEvent('credit-two',{kind:'credit',receipt_id:'receipt-return',return_event_id:'return-two',credit_minor:'200'});assert.equal(f.returns.receipt(f.operator,'receipt-return').lines[0].credit_due_minor,'0');
 assert.equal(f.warehouse.stock('sku-a','location-a'),13);
}));

test('CASE-M11-G08-02',()=>usingProcurementInventory(async f=>{
 await f.receive('receipt-cost',5);f.observeSupplier('return-excess',{kind:'supplier_return',receipt_id:'receipt-cost',quantity:6});assert.throws(()=>f.returns.propose(f.operator,{operation_id:'too-many-returned',event_id:'return-excess'}),/QUANTITY|EXCESS/);
 f.observeSupplier('cost-change',{kind:'cost_correction',receipt_id:'receipt-cost',unit_cost_minor:'120'});const proposal=f.returns.propose(f.operator,{operation_id:'cost-operation',event_id:'cost-change'});
 await assert.rejects(f.returns.dispatch(f.operator,proposal.operation_id),/APPROVAL/);assert.equal(f.returns.receipt(f.operator,'receipt-cost').lines[0].unit_cost_minor,'100');
 f.returns.approve(f.reviewer,proposal.operation_id,{expected_digest:proposal.command_digest,expires_at:f.now()+60000});await f.returns.dispatch(f.operator,proposal.operation_id);
 const corrected=f.returns.receipt(f.operator,'receipt-cost');assert.equal(corrected.lines[0].receipt_cost_minor,oracle.purchase.corrected_receipt_cost_minor);assert.equal(corrected.lines[0].cost_variance_minor,oracle.purchase.cost_variance_minor);
 assert.equal(f.po.body.lines[0].unit_cost_minor,'100');assert.equal(f.balance('sku-a').on_hand,15);
 const original=f.receiving.receipts(f.operator,f.po_ref)[0];await f.supplierEvent('receipt-count-correction',{kind:'receipt_correction',receipt_id:'receipt-cost',quantity_delta:-1});
 const revised=f.returns.receipt(f.operator,'receipt-cost');assert.equal(revised.lines[0].received,4);assert.equal(revised.lines[0].receipt_cost_minor,'480');assert.equal(revised.lines[0].cost_variance_minor,'80');assert.equal(f.balance('sku-a').on_hand,14);assert.equal(f.receiving.summary(f.operator,f.po_ref).lines[0].outstanding,6);assert.equal(f.receiving.receipts(f.operator,f.po_ref)[0].digest,original.digest);
}));

test('CASE-M11-G08-03',async()=>{
 await usingProcurementInventory(async f=>{
  await f.receive('receipt-history',5);const returned=await f.supplierEvent('return-once',{kind:'supplier_return',receipt_id:'receipt-history',quantity:2});
  const replay=f.returns.propose(f.operator,{operation_id:'return-new-key',event_id:'return-once'});assert.equal(replay.operation_id,returned.operation_id);await f.returns.dispatch(f.operator,replay.operation_id);
  await f.supplierEvent('credit-once',{kind:'credit',receipt_id:'receipt-history',return_event_id:'return-once',credit_minor:'200'});const credit=f.returns.propose(f.operator,{operation_id:'credit-new-key',event_id:'credit-once'});await f.returns.dispatch(f.operator,credit.operation_id);
  assert.equal(f.warehouse.stock('sku-a','location-a'),13);assert.equal(f.receiving.receipts(f.operator,f.po_ref).length,1);assert.equal(f.returns.receipt(f.operator,'receipt-history').lines[0].credited_minor,'200');
 });
 await mutant('../../packages/commerce/procurement-inventory-core.mts','// Keep the original receipt throughout supplier event recording.','k.db.prepare("DELETE FROM commerce_purchase_receipts WHERE tenant_id=? AND store_id=? AND receipt_id=?").run(command.tenant_id,command.store_id,command.receipt_id);',module=>usingProcurementInventory(async f=>{
  await f.receive('receipt-must-survive',5);const returned=await f.supplierEvent('return-history-fault',{kind:'supplier_return',receipt_id:'receipt-must-survive',quantity:2}),native=await f.source.lookup(returned.operation_id);
  module.recordSupplierReceiptEvent(f.kernel,returned.command,native);
  assert.throws(()=>assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_purchase_receipts WHERE receipt_id=?').get('receipt-must-survive').n,1,'A supplier return cannot delete the original receipt'),assert.AssertionError);
 }));
});

test('CASE-M11-G09-01',()=>usingProcurementInventory(f=>{
 const expanded=f.boms.expand(f.operator,{bom_id:f.bom.id,version:f.bom.version,expected_digest:f.bom.digest,quantity:4});
 assert.deepEqual(expanded.materials.map((material:any)=>({variant_id:material.variant_id,quantity:material.quantity,base_unit:material.base_unit})),[{variant_id:'buttons',quantity:10,base_unit:'each'},{variant_id:'cotton',quantity:2500,base_unit:'g'}]);
 assert.equal(expanded.gross_quantity,oracle.bom.gross_output);assert.equal(expanded.expected_scrap,oracle.bom.expected_scrap);assert.equal(expanded.total_cost_minor,oracle.bom.component_cost_minor);
 assert.equal(expanded.bom_digest,f.bom.digest);assert.equal(expanded.bom_refs.length,2);
}));

test('CASE-M11-G09-02',()=>usingProcurementInventory(f=>{
 assert.throws(()=>f.boms.define(f.owner,{...f.bomInput,bom_id:'cycle',expected_version:0,components:[{quantity:'1',unit:'each',material:null,bom:{id:'cycle',version:1,digest:'0'.repeat(64)}}]}),/CYCLE/);
 assert.throws(()=>f.boms.define(f.owner,{...f.bomInput,bom_id:'missing-component',expected_version:0,components:[{quantity:'1',unit:'each',bom:null,material:{id:'missing',version:1,digest:'0'.repeat(64)}}]}),/COMPONENT|NOT_FOUND/);
 assert.throws(()=>f.boms.define(f.owner,{...f.bomInput,bom_id:'zero-yield',expected_version:0,yield_numerator:0}),/YIELD|INVALID/);
 assert.throws(()=>f.boms.define(f.owner,{...f.bomInput,bom_id:'wrong-dimension',expected_version:0,components:[{quantity:'1',unit:'kg',bom:null,material:f.materialRefs.buttons}]}),/UNIT|DIMENSION/);
 const expensive=f.boms.material(f.owner,{material_id:'material-cost-bound',expected_version:0,resource_id:f.resource.id,variant_id:'cotton',base_unit:'g',currency_code:'USD',unit_cost_minor:'9'.repeat(24)}),priced=f.boms.define(f.owner,{...f.bomInput,bom_id:'cost-total-bound',expected_version:0,output:{material:f.materialRefs.finished,quantity:'1',unit:'each'},yield_numerator:1,yield_denominator:1,components:[{quantity:'2',unit:'g',material:{id:expensive.id,version:expensive.version,digest:expensive.digest},bom:null}]});
 assert.throws(()=>f.boms.expand(f.operator,{bom_id:priced.id,version:priced.version,expected_digest:priced.digest,quantity:1}),/COST|LIMIT/);
 assert.equal(f.source.movements().length,0);
}));

test('CASE-M11-G09-03',async()=>{
 await usingProcurementInventory(f=>{
  const job=f.createJob('original-bom-job');f.production.approveJob(f.reviewer,job.id,{expected_digest:job.digest,expires_at:f.now()+60000});
  const changed=f.boms.define(f.owner,{...f.bomInput,expected_version:1,yield_numerator:1,yield_denominator:1});assert.equal(changed.version,2);
  const saved=f.production.read(f.operator,job.id);assert.equal(saved.body.plan.bom_digest,f.bom.digest);assert.equal(saved.body.plan.materials.find((material:any)=>material.variant_id==='cotton').quantity,2500);
 });
 await mutant('../../packages/commerce/bill-of-materials.mts','return divide(required,multiply(output,ratio(yieldNumerator,yieldDenominator)));','return divide(required,output);',module=>usingProcurementInventory(f=>{
  const broken=new module.BillOfMaterials(f.kernel),expanded=broken.expand(f.operator,{bom_id:f.bom.id,version:f.bom.version,expected_digest:f.bom.digest,quantity:4});
  assert.throws(()=>assert.equal(expanded.materials.find((material:any)=>material.variant_id==='cotton').quantity,oracle.bom.cotton_g,'Nested yield loss must increase exact material requirements'),assert.AssertionError);
 }));
});

test('M11-G10-PREP-01',()=>usingProcurementInventory(async f=>{
 const job=f.approvedJob();await f.step(job.id,'reserve');assert.deepEqual(f.position('cotton'),{available:2500,on_hand:5000,reserved:2500,in_transit:0});
 await f.step(job.id,'consume');assert.deepEqual(f.position('cotton'),{available:2500,on_hand:2500,reserved:0,in_transit:0});assert.equal(f.production.read(f.operator,job.id).native.wip_cost_minor,'2600');
 const event=f.observeOutput(job.id,4,1,'output-complete');await f.step(job.id,'complete',event.event_id);const result=f.production.read(f.operator,job.id);
 assert.equal(result.native.good,4);assert.equal(result.native.scrap,1);assert.equal(result.native.wip_cost_minor,'0');assert.equal(result.native.output_cost_minor,oracle.bom.output_cost_minor);assert.equal(result.native.scrap_cost_minor,oracle.bom.scrap_cost_minor);
 assert.equal(f.balance('finished').on_hand,4);assert.equal(f.balance('buttons').on_hand,30);assert.equal(result.native.bom_digest,f.bom.digest);
 const cancelled=f.approvedJob('released-production');await f.step(cancelled.id,'reserve');await f.step(cancelled.id,'release');assert.equal(f.production.read(f.operator,cancelled.id).state,'released');assert.equal(f.position('cotton').reserved,0);assert.equal(f.balance('cotton').available,2500);assert.equal(f.balance('finished').on_hand,4);
}));

test('M11-G10-PREP-02',()=>usingProcurementInventory(async f=>{
 const job=f.approvedJob();assert.throws(()=>f.production.propose(f.operator,{production_id:job.id,operation_id:'consume-unreserved',kind:'consume',event_id:null}),/RESERV|CONSUM/);
 const early=f.observeOutput(job.id,4,1,'output-too-early');assert.throws(()=>f.production.propose(f.operator,{production_id:job.id,operation_id:'early-complete',kind:'complete',event_id:early.event_id}),/CONSUM/);
 await f.step(job.id,'reserve');await f.step(job.id,'consume');await f.step(job.id,'complete',early.event_id);
 const replay=f.production.propose(f.operator,{production_id:job.id,operation_id:'new-completion-key',kind:'complete',event_id:early.event_id});assert.equal((await f.production.dispatch(f.operator,replay.operation_id)).state,'applied');
 const excess=f.observeOutput(job.id,1,0,'excess-output');assert.throws(()=>f.production.propose(f.operator,{production_id:job.id,operation_id:'extra-complete',kind:'complete',event_id:excess.event_id}),/OUTPUT|QUANTITY/);assert.equal(f.warehouse.stock('finished','location-a'),4);
}));

test('M11-G10-PREP-03',async()=>{
 await usingProcurementInventory(async f=>{
  const job=f.approvedJob();await f.step(job.id,'reserve');await f.step(job.id,'consume');const event=f.observeOutput(job.id,4,1,'crashed-output'),op=f.prepareStep(job.id,'complete',event.event_id);
  f.source.fault='after';assert.equal((await f.production.dispatch(f.operator,op.operation_id)).state,'unknown');assert.equal(f.warehouse.stock('finished','location-a'),4);
  const restart=f.restart();try{assert.equal((await restart.production.reconcile(restart.operator,op.operation_id)).state,'applied');assert.equal(restart.balance('finished').on_hand,4);assert.equal(restart.source.calls.apply,0);}finally{restart.cleanup();}
  assert.equal(f.source.movements().filter((movement:any)=>movement.kind==='production_complete').length,1);
 });
 await mutant('../../packages/adapters/procurement-inventory-source-guards.mts','if(state.components.some((component:Row)=>component.consumed!==component.quantity))throw new Error("PRODUCTION_CONSUMPTION_REQUIRED");','if(false)throw new Error("PRODUCTION_CONSUMPTION_REQUIRED");',module=>usingProcurementInventory(async f=>{
  const job=f.approvedJob();await f.step(job.id,'reserve');const event=f.observeOutput(job.id,4,1,'unsafe-output'),state=f.source.production(job.id);
  assert.equal(state.components.reduce((sum:number,component:any)=>sum+component.consumed,0),0);
  const broken=module.productionCompletion(state,event);
  assert.throws(()=>assert.equal(broken.good,0,'Unconsumed components cannot produce finished output'),assert.AssertionError);
 }));
});

test('M11-PORT-025-PURCHASE-PARTIAL-SCAN',()=>usingProcurementInventory(async f=>{
 const receipt=f.observeReceipt('scan-original',3),same=f.receiving.facts.recordReceipt({...receipt.input});assert.equal(same.digest,receipt.digest);
 const op=f.receiving.propose(f.operator,{operation_id:'scan-operation',...f.po_ref,receipt_id:receipt.receipt_id});f.receiving.approve(f.reviewer,op.operation_id,{expected_digest:op.command_digest,expires_at:f.now()+60000});await f.receiving.dispatch(f.operator,op.operation_id);
 await f.receiving.dispatch(f.operator,op.operation_id);assert.equal(f.balance('sku-a').on_hand,13);assert.equal(f.receiving.summary(f.operator,f.po_ref).lines[0].outstanding,7);assert.equal(f.source.movements().filter((movement:any)=>movement.kind==='purchase_receive').length,1);
}));

test('M11-STOCK-CURRENT-AUTHORITY',()=>usingProcurementInventory(async f=>{
 const op=f.prepareReceipt('authority-receipt',5);assert.throws(()=>f.receiving.read(f.b.scope,op.operation_id),/NOT_FOUND|SCOPE|ACCESS_DENIED/);
 const apply=f.source.applyProcurement.bind(f.source);f.source.applyProcurement=async command=>{
  const db=new DatabaseSync(f.warehouseFile);try{const native=new WarehouseFixtureSource(db,f.warehouseOptions),reopened=new WarehouseInventoryFixtureSource(native,{clock:f.now});
   assert.ok(db.prepare('SELECT 1 FROM warehouse_procurement_bindings WHERE operation_id=?').get(command.operation_id));await assert.rejects(reopened.applyProcurement(command),/GUARD_REQUIRED/);
  }finally{db.close();}
  f.kernel.db.prepare('UPDATE commerce_members SET active=0 WHERE tenant_id=? AND store_id=? AND actor_id=?').run(f.a.tenant,f.a.store,'stock_reviewer');return apply(command);
 };
 assert.equal((await f.receiving.dispatch(f.operator,op.operation_id)).state,'unknown');assert.equal(f.warehouse.stock('sku-a','location-a'),10);assert.equal(f.source.movements().length,0);
}));

test('M11-STOCK-SOURCE-INTEGRITY',()=>usingProcurementInventory(async f=>{
 await f.receive('receipt-integrity',5);const row=f.db.prepare('SELECT * FROM commerce_purchase_receipts WHERE receipt_id=?').get('receipt-integrity'),body={...JSON.parse(row.body),unexpected_private_copy:'copied'};
 f.db.prepare('UPDATE commerce_purchase_receipts SET body=? WHERE receipt_id=?').run(JSON.stringify(body),'receipt-integrity');assert.throws(()=>f.receiving.receipts(f.operator,f.po_ref),/INTEGRITY/);
 f.db.prepare('UPDATE commerce_purchase_receipts SET body=?,digest=? WHERE receipt_id=?').run(row.body,row.digest,'receipt-integrity');
 const native=f.source.movements()[0],stored=f.source.db.prepare('SELECT * FROM warehouse_inventory_movements WHERE movement_id=?').get(native.movement_id),changed={...JSON.parse(stored.body),reference_id:'another-source-reference'};
 f.source.db.prepare('UPDATE warehouse_inventory_movements SET body=?,digest=? WHERE movement_id=?').run(JSON.stringify(changed),contentDigest(changed),native.movement_id);
 assert.throws(()=>f.receiving.summary(f.operator,f.po_ref),/INTEGRITY|SOURCE|RECONCILIATION/);
}));

test('M11-STOCK-CONSERVATION',()=>usingProcurementInventory(async f=>{
 const job=f.approvedJob();await f.step(job.id,'reserve');await f.step(job.id,'consume');const first=f.observeOutput(job.id,2,0,'partial-output');await f.step(job.id,'complete',first.event_id);
 let state=f.production.read(f.operator,job.id).native;assert.equal(state.good,2);assert.equal(state.wip_cost_minor,oracle.bom.partial_wip_cost_minor);assert.equal(f.balance('finished').on_hand,2);
 const second=f.observeOutput(job.id,2,1,'remaining-output');await f.step(job.id,'complete',second.event_id);
 const correction=f.observeOutput(job.id,-1,1,'output-correction','partial-output');await f.step(job.id,'correct_output',correction.event_id);state=f.production.read(f.operator,job.id).native;
 assert.equal(state.good,3);assert.equal(state.scrap,2);assert.equal(state.wip_cost_minor,'0');assert.equal(BigInt(state.output_cost_minor)+BigInt(state.scrap_cost_minor),2600n);assert.equal(f.balance('finished').on_hand,3);
 const privacy=await populateProcurementInventoryPrivacy(f);assert.equal(privacy.tables.length,7);assert.ok(privacy.unknown_operations.length);assert.equal(f.resource.customer_id,null);
}));
