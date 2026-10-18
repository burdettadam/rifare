import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { usingInventoryCycle } from './inventory-reconciliation-helpers.mts';
import { InventoryReconciliation } from '../../packages/commerce/inventory-reconciliation.mts';
import { InventoryTransfers } from '../../packages/commerce/inventory-transfers.mts';
import { PrivacyLifecycle } from '../../packages/commerce/privacy-lifecycle.mts';
import { canonical,contentDigest } from '../../packages/commerce/configuration-values.mts';
import type { Row } from '../../packages/commerce/kernel.mts';

const oracle=JSON.parse(readFileSync(new URL('../fixtures/inventory-reconciliation/partial-cycle.v1.json',import.meta.url),'utf8'));
const codes=(r:Row)=>r.discrepancies.map((d:Row)=>d.code);
const input=(f:Row)=>({resource_id:f.resource_id});
const balances=(r:Row)=>Object.fromEntries(r.positions.map((p:Row)=>[p.variant_id,p.expected.available]));

// Distinct local preparation IDs preserve the unperformed connected G10 cases.
test('M08-G10-LOCAL-SHIPMENT-PARTIAL-RETURN-CYCLE',()=>usingInventoryCycle(async f=>{
  const r=await f.complete();assert.equal(r.reconciled,true);assert.deepEqual(r.discrepancies,[]);
  assert.deepEqual(balances(r),oracle.final_available);assert.equal(r.packages.length,oracle.packages);
  assert.equal(r.packages[0].units.length,oracle.packed_units);assert.equal(r.packages[0].carrier_accepted,true);
  assert.equal(r.returns[0].received_units,oracle.received_units);assert.equal(r.returns[0].pending_units,oracle.requested_return_units_pending);
  assert.equal(r.cycle_state,'partial_return_reconciled');assert.equal(r.physical_qualified,false);assert.equal(r.formal_goal_accepted,false);
  assert.equal(f.effects().movements,oracle.native_warehouse_movements);assert.equal(f.effects().carrier_purchases,oracle.native_carrier_purchases);
}));
test('M08-G10-LOCAL-MISSING-MOVEMENT-IMPORT-REPAIRS-WITHOUT-EFFECT',()=>usingInventoryCycle(async f=>{
  const initial=await f.complete({sync:false}),before=f.effects();
  assert.equal(initial.reconciled,false);assert.ok(codes(initial).includes('MOVEMENT_NOT_IMPORTED'));
  const repaired=f.reconciliation.repair(f.a.scope,input(f));
  assert.equal(repaired.report.reconciled,true);assert.equal(repaired.source_effects_dispatched,0);
  assert.deepEqual(f.effects(),before);assert.deepEqual(balances(repaired.report),oracle.final_available);
}));
test('M08-G10-LOCAL-UNEXPLAINED-STOCK-REMAINS-UNRESOLVED',()=>usingInventoryCycle(async f=>{
  await f.complete();f.externalStock('hat-small',14);const before=f.effects();
  const r=f.reconciliation.repair(f.a.scope,input(f));
  assert.equal(r.report.reconciled,false);assert.ok(codes(r.report).includes('UNEXPLAINED_STOCK_DIFFERENCE'));
  assert.equal(r.report.positions.find((p:Row)=>p.variant_id==='hat-small').observed.available,14);
  assert.equal(r.report.positions.find((p:Row)=>p.variant_id==='hat-small').expected.available,10);
  assert.deepEqual(f.effects(),before);assert.equal(r.source_effects_dispatched,0);
}));
test('M08-G10-LOCAL-DUPLICATE-NATIVE-DEDUCTION-IS-EXPLICIT',()=>usingInventoryCycle(async f=>{
  await f.complete();f.inventorySource.recordMovement({movement_id:'duplicate-shipment',resource_id:f.resource_id,variant_id:'hat-small',location_id:'warehouse-one',kind:'shipment',quantity_delta:-1,reference_id:'cycle-accepted',linked_movement_id:null});
  f.locationInventory.sync(f.a.scope,input(f));const before=f.effects(),r=f.reconciliation.repair(f.a.scope,input(f));
  assert.equal(r.report.reconciled,false);assert.ok(codes(r.report).includes('SHIPMENT_QUANTITY_MISMATCH'));
  assert.deepEqual(f.effects(),before);
}));
test('M08-G10-LOCAL-MANIFEST-ACK-IS-NOT-CARRIER-ACCEPTANCE',()=>usingInventoryCycle(async f=>{
  await f.manifest();const before=f.effects(),r=f.reconciliation.inspect(f.a.scope,input(f));
  assert.equal(r.reconciled,false);assert.ok(codes(r).includes('CARRIER_ACCEPTANCE_MISSING'));
  assert.equal(r.packages[0].carrier_accepted,false);assert.deepEqual(before.available,[10,10]);
  assert.deepEqual(f.effects(),before);assert.equal(r.returns[0].pending_units,3);
  await f.accept();f.ship();f.locationInventory.sync(f.a.scope,input(f));
  const pending=f.reconciliation.inspect(f.a.scope,input(f));
  assert.equal(pending.reconciled,true);assert.equal(pending.cycle_state,'return_pending');
  assert.equal(pending.returns[0].received_units,0);assert.equal(pending.returns[0].pending_units,3);
}));
test('M08-G10-LOCAL-UNLINKED-SHIPMENT-CANNOT-EXPLAIN-PACKAGE',()=>usingInventoryCycle(async f=>{
  await f.manifest();await f.accept();f.ship('unrelated-event');f.receive();f.locationInventory.sync(f.a.scope,input(f));
  const r=f.reconciliation.inspect(f.a.scope,input(f));assert.equal(r.reconciled,false);
  assert.ok(codes(r).includes('SHIPMENT_QUANTITY_MISMATCH'));assert.ok(codes(r).includes('ORPHAN_SHIPMENT_MOVEMENT'));
}));
test('M08-G10-LOCAL-PACKING-NEVER-DEDUCTS-INVENTORY',()=>usingInventoryCycle(f=>{
  const p=f.pack(),before=f.effects(),r=f.reconciliation.inspect(f.a.scope,input(f));
  assert.equal(p.inventory_effect,false);assert.equal(r.inventory_effect,false);assert.deepEqual(before.available,[10,10]);
  assert.equal(r.reconciled,false);assert.equal(before.movements,0);assert.deepEqual(f.effects(),before);
}));
test('M08-G10-LOCAL-SHUFFLED-OBSERVATIONS-AND-RETRY-CONVERGE',()=>usingInventoryCycle(async f=>{
  await f.complete({sync:false,importEvents:false});const before=f.effects();
  for(const m of [...f.inventorySource.movements(f.resource_id)].reverse())f.locationInventory.importMovement(f.a.scope,m.movement_id);
  const repaired=f.reconciliation.repair(f.a.scope,input(f));assert.equal(repaired.report.reconciled,true);
  const again=f.reconciliation.repair(f.a.scope,input(f));assert.equal(again.report.reconciled,true);
  assert.deepEqual(again.report,repaired.report);assert.deepEqual(f.effects(),before);
  for(const observation of f.inventorySource.snapshots(f.resource_id))f.locationInventory.importSnapshot(f.a.scope,observation.observation_id);
  assert.deepEqual(balances(f.reconciliation.inspect(f.a.scope,input(f))),oracle.final_available);
}));
test('M08-G10-LOCAL-NATIVE-MOVEMENT-INTEGRITY-FAILS-CLOSED',()=>usingInventoryCycle(async f=>{
  await f.complete();
  const gamma=f.warehouse.recordReturnEvent(f.event({event_id:'cycle-gamma-received',sequence:3,units:[{line_id:'gamma',ordinal:1,variant_id:'shoe-small',grade:'sellable',received:true,disposition:null}]}));
  const receipt=f.returns.importEvent(f.a.scope,{request_id:f.request.id,event_id:gamma.event_id}).receipt;
  f.receiving.close(f.a.scope,{session_id:receipt.session_id,expected_revision:receipt.revision});
  const quote=f.disposition.quote(f.a.scope,{session_id:receipt.session_id,unit_ids:[receipt.units.find((u:Row)=>u.line_id==='gamma').id],disposition:'restock'}),operation=f.authorizeLife(quote);
  f.warehouse.fault='after';assert.equal((await f.disposition.dispatch(f.a.scope,operation.id)).state,'unknown');
  f.locationInventory.sync(f.a.scope,input(f));
  assert.ok(codes(f.reconciliation.inspect(f.a.scope,input(f))).includes('DISPOSITION_OPERATION_NOT_OBSERVED'));
  await f.disposition.reconcile(f.a.scope,operation.id);
  assert.equal(f.reconciliation.inspect(f.a.scope,input(f)).reconciled,true);
  // A delivery and a quarantine can both have no quantitative movement. Their
  // original request/native-return and canonical-operation links still matter.
  f.warehouse.recordReturnEvent(f.event({event_id:'orphan-delivery',request_id:'unmapped-request',native_return_id:'unmapped-native-return',sequence:1,kind:'delivery',units:[]}));
  assert.ok(codes(f.reconciliation.inspect(f.a.scope,input(f))).includes('RETURN_SOURCE_LINK_MISSING'));
  const beforeRepair=f.effects();assert.throws(()=>f.reconciliation.repair(f.a.scope,input(f)),/RETURN_BINDING_MISMATCH/);assert.deepEqual(f.effects(),beforeRepair);
  f.locationInventory.claim(f.owner.scope,{resource_id:f.resource_id,variant_id:'shirt-small',location_id:'warehouse-one',source_identity:f.warehouse.identity,fields:['available','on_hand','reserved','in_transit']});
  f.inventorySource.snapshot({observation_id:'quarantine-anchor',resource_id:f.resource_id,variant_id:'shirt-small',location_id:'warehouse-one'});
  f.locationInventory.importSnapshot(f.a.scope,'quarantine-anchor');
  await f.warehouse.apply({operation_id:'unobserved-disposition',source_identity:f.warehouse.identity,tenant_id:f.a.tenant,store_id:f.a.store,request_id:f.request.id,resource_id:f.resource_id,native_return_id:'gid://shopify/Return/900',location_id:'warehouse-one',disposition:'quarantine',units:[{id:'unobserved-alpha',line_id:'alpha',ordinal:1,variant_id:'shirt-small',grade:'damaged'}]});
  assert.ok(codes(f.reconciliation.inspect(f.a.scope,input(f))).includes('DISPOSITION_OPERATION_NOT_OBSERVED'));
  const original=f.inventorySource.movements.bind(f.inventorySource);
  f.inventorySource.movements=(ref?:string)=>original(ref).map((m:Row,i:number)=>i?m:{...m,delta:{...m.delta,available:99}});
  assert.throws(()=>f.reconciliation.inspect(f.a.scope,input(f)),/INTEGRITY|MISMATCH/);
}));
test('M08-G10-LOCAL-SCOPE-REVOCATION-AND-FORGED-LINEAGE',()=>usingInventoryCycle(async f=>{
  await f.complete();assert.throws(()=>f.reconciliation.inspect(f.b.scope,input(f)),/ACCESS_DENIED|NOT_FOUND|SCOPE_MISMATCH/);
  assert.throws(()=>f.reconciliation.inspect({},input(f)),/ACCESS_DENIED/);
  const row=f.kernel.db.prepare('SELECT * FROM commerce_shipping_manifest_packages WHERE package_id=?').get(f.package_id) as Row;
  const value=JSON.parse(row.body);value.command.native_label_id='unrelated-label';
  f.kernel.db.prepare('UPDATE commerce_shipping_manifest_packages SET body=?,digest=? WHERE package_id=?').run(canonical(value),contentDigest(value),f.package_id);
  assert.throws(()=>f.reconciliation.inspect(f.a.scope,input(f)),/INTEGRITY|BINDING|MISMATCH/);
  f.kernel.revoke(f.a.scope);assert.throws(()=>f.reconciliation.repair(f.a.scope,input(f)),/ACCESS_DENIED/);
}));
test('M08-G10-LOCAL-CORRECTED-DISPOSITION-RECONCILES-ONCE',()=>usingInventoryCycle(async f=>{
  await f.complete();const correction=f.warehouse.recordReturnEvent(f.event({event_id:'cycle-correction',sequence:3,kind:'correction',parent_event_id:'cycle-restocked',units:[{line_id:'beta',ordinal:1,variant_id:'hat-small',grade:'damaged',received:true,disposition:'quarantine'}]}));
  const before=f.effects(),r=f.reconciliation.repair(f.a.scope,input(f));assert.equal(r.report.reconciled,true);
  assert.equal(balances(r.report)['hat-small'],9);assert.equal(r.report.returns[0].received_units,1);
  f.returns.importEvent(f.a.scope,{request_id:f.request.id,event_id:correction.event_id});
  assert.equal(f.reconciliation.repair(f.a.scope,input(f)).report.reconciled,true);assert.deepEqual(f.effects(),before);
  f.warehouse.recordReturnEvent(f.event({event_id:'cycle-restock-corrected',sequence:4,kind:'correction',parent_event_id:'cycle-correction',units:[{line_id:'beta',ordinal:1,variant_id:'hat-small',grade:'sellable',received:true,disposition:'restock'}]}));
  assert.equal(f.reconciliation.repair(f.a.scope,input(f)).report.reconciled,true);
  f.warehouse.seed('hat-small','warehouse-two',0);
  f.locationInventory.claim(f.owner.scope,{resource_id:f.resource_id,variant_id:'hat-small',location_id:'warehouse-two',source_identity:f.warehouse.identity,fields:['available','on_hand','reserved','in_transit']});
  f.inventorySource.snapshot({observation_id:'correction-destination',resource_id:f.resource_id,variant_id:'hat-small',location_id:'warehouse-two'});
  f.locationInventory.importSnapshot(f.a.scope,'correction-destination');
  const moved=f.warehouse.recordReturnEvent(f.event({event_id:'cycle-location-correction',sequence:5,kind:'correction',parent_event_id:'cycle-restock-corrected',location_id:'warehouse-two',units:[{line_id:'beta',ordinal:1,variant_id:'hat-small',grade:'sellable',received:true,disposition:'restock'}]}));
  assert.equal(moved.adjustments.length,2);assert.equal(moved.adjustments[0].unit_id,moved.adjustments[1].unit_id);
  const afterMove=f.effects(),unresolved=f.reconciliation.repair(f.a.scope,input(f));
  assert.equal(unresolved.report.reconciled,false);assert.ok(codes(unresolved.report).includes('RETURN_EVENT_DISCREPANCY'));
  assert.deepEqual(f.effects(),afterMove);assert.equal(f.warehouse.stock('hat-small','warehouse-two'),1);
}));
test('M08-G10-LOCAL-SUBJECT-EXPORT-ERASURE-AND-SOURCE-COPIES',()=>usingInventoryCycle(async f=>{
  await f.complete();const privacy=new PrivacyLifecycle(f.kernel),customer=f.order().customer_id;
  f.warehouse.seed('hat-small','warehouse-two',0);
  f.locationInventory.claim(f.owner.scope,{resource_id:f.resource_id,variant_id:'hat-small',location_id:'warehouse-two',source_identity:f.warehouse.identity,fields:['available','on_hand','reserved','in_transit']});
  f.inventorySource.snapshot({observation_id:'second-location',resource_id:f.resource_id,variant_id:'hat-small',location_id:'warehouse-two'});
  f.locationInventory.importSnapshot(f.a.scope,'second-location');
  const transfers=new InventoryTransfers(f.kernel,f.locationInventory,f.inventorySource,{deadline_ms:15});
  transfers.plan(f.a.scope,{transfer_id:'privacy-transfer',resource_id:f.resource_id,variant_id:'hat-small',from_location:'warehouse-one',to_location:'warehouse-two',quantity:1});
  const op=transfers.propose(f.a.scope,'privacy-transfer',{operation_id:'privacy-reserve',kind:'reserve',quantity:1,expected_revision:1});
  transfers.approve(f.reviewer.scope,'privacy-reserve',{expected_digest:op.command_digest,expires_at:f.now()+60000});
  f.inventorySource.fault='after';assert.equal((await transfers.dispatch(f.a.scope,'privacy-reserve')).state,'unknown');
  f.locationInventory.sync(f.a.scope,input(f));
  f.locationInventory.claim(f.owner.scope,{resource_id:f.resource_id,variant_id:'hat-small',location_id:'warehouse-one',source_identity:'unapproved-owner',fields:['available']});
  const exported=privacy.export(f.owner.scope,customer),records=exported.warehouse_inventory_records as Row;
  assert.equal(Object.keys(records).length,8);assert.ok(Object.values(records).every((rows:any)=>rows.length>0));
  for(const rows of Object.values(records) as Row[][])assert.ok(rows.every(row=>row.resource_id===f.resource_id));
  const second=f.kernel.ingest(f.a.scope,{kind:'order',source_system:'synthetic',external_id:'SECOND-INVENTORY-CUSTOMER',source_version:1,source_updated_at:f.now(),customer_id:'other-stock-customer',payload:{status:'open'}});
  // Imported redacted flags cannot bypass allowlist minimization. Stock cores
  // retain their independent chain digest while arbitrary body fields disappear.
  for(const [table,rows] of Object.entries(records) as [string,Row[]][])for(const row of rows){
    const b={...JSON.parse(row.body),redacted:true,private_detail:'PRIVATE-INVENTORY-COPY'};
    const pk=(f.kernel.db.prepare('PRAGMA table_info('+table+')').all() as Row[]).filter(c=>c.pk).sort((a,b)=>a.pk-b.pk).map(c=>c.name);
    f.kernel.db.prepare(`UPDATE ${table} SET body=?,digest=? WHERE ${pk.map(c=>c+'=?').join(' AND ')}`).run(canonical(b),contentDigest(b),...pk.map(c=>row[c]));
  }
  const before=f.effects();privacy.erase(f.owner.scope,customer);
  assert.throws(()=>f.reconciliation.inspect(f.a.scope,input(f)),/SUBJECT_ERASED|NOT_FOUND/);
  assert.throws(()=>f.reconciliation.repair(f.a.scope,input(f)),/SUBJECT_ERASED|NOT_FOUND/);
  for(const table of Object.keys(records))assert.equal(JSON.stringify(f.kernel.db.prepare('SELECT body FROM '+table).all()).includes('PRIVATE-INVENTORY-COPY'),false);
  const remaining=f.locationInventory.balance(f.a.scope,{resource_id:second.id,variant_id:'hat-small',location_id:'warehouse-one'});
  assert.equal(remaining.available,9);assert.equal(remaining.on_hand,10);assert.equal(remaining.reserved,1);
  assert.equal(f.locationInventory.history(f.a.scope,{resource_id:second.id}).movements.length,0);
  const retained=JSON.parse((f.kernel.db.prepare('SELECT body FROM commerce_inventory_transfer_operations WHERE operation_id=?').get('privacy-reserve') as Row).body);
  assert.equal(retained.state,'unknown');assert.equal(retained.original_operation_id,'privacy-reserve');assert.equal(Object.hasOwn(retained,'command'),false);
  assert.equal((f.kernel.db.prepare('SELECT revoked FROM commerce_inventory_transfer_approvals WHERE operation_id=?').get('privacy-reserve') as Row).revoked,1);
  assert.deepEqual(f.effects(),before);
}));
test('M08-G10-LOCAL-NAMED-STOCK-DIFFERENCE-FAULT-IS-DETECTED',()=>usingInventoryCycle(async f=>{
  await f.complete();f.externalStock('hat-small',11);
  const rejectGreen=(r:Row)=>assert.equal(r.reconciled,false,'Unexplained source stock cannot produce a green reconciliation');
  rejectGreen(f.reconciliation.inspect(f.a.scope,input(f)));
  const url=new URL('../../packages/commerce/inventory-reconciliation.mts',import.meta.url),source=readFileSync(url,'utf8');
  const marker='reconciled: discrepancies.length === 0';assert.equal(source.split(marker).length,2);
  const changed=source.replace(marker,"reconciled: discrepancies.every(d => d.code === 'UNEXPLAINED_STOCK_DIFFERENCE')")
    .replace(/from '(\.[^']+)'/g,(_match,path)=>"from '"+new URL(path,url).href+"'");
  const directory=mkdtempSync(join(tmpdir(),'rifare-inventory-cycle-fault-'));
  try{const file=join(directory,'inventory-reconciliation.mts');writeFileSync(file,changed);
    const module=await import(pathToFileURL(file).href),broken=new module.InventoryReconciliation(f.kernel,f.locationInventory,f.returns,f.packing,f.shippingLabels,f.carrier);
    const result=broken.inspect(f.a.scope,input(f));assert.equal(result.reconciled,true);assert.throws(()=>rejectGreen(result),assert.AssertionError);
  }finally{rmSync(directory,{recursive:true,force:true});}
}));
