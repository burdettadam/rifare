import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,writeFileSync,mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { WarehouseFixtureSource } from '../../packages/adapters/warehouse-fixture-source.mts';
import { WarehouseReturnEvents } from '../../packages/commerce/warehouse-return-events.mts';
import { usingWarehouseReturn } from './warehouse-return-events-helpers.mts';
import type { Row } from '../../packages/commerce/kernel.mts';

test('M08-G07-LOCAL-PARTIAL-RECEIPT-PRESERVES-NATIVE-GRADES-AND-EVIDENCE',()=>usingWarehouseReturn(f=>{
 const e=f.event({units:[f.unit(),f.unit({line_id:'beta',variant_id:'hat-small',grade:'damaged'})]});
 const r=f.observe(e);assert.equal(r.receipt.total_actual,2);assert.equal(r.receipt.lines.find((l:Row)=>l.line_id==='gamma').missing,1);
 assert.deepEqual(r.receipt.units.map((u:Row)=>[u.line_id,u.grade,u.location_id]).sort(),[['alpha','sellable','warehouse-one'],['beta','damaged','warehouse-one']]);
 assert.equal(r.events[0].event.operator_id,'partner_operator_1');assert.deepEqual(r.events[0].event.evidence_ids,['partner_receipt_1']);
 assert.equal(r.events[0].event.completeness,'partial');assert.equal(r.qualification,'synthetic_only');assert.equal(f.warehouse.stock('shirt-small','warehouse-one'),0);
}));
test('M08-G07-LOCAL-DELIVERY-DOES-NOT-INVENT-RECEIPT-INSPECTION-OR-STOCK',()=>usingWarehouseReturn(f=>{
 const r=f.observe(f.event({kind:'delivery',units:[],completeness:'complete'}));
 assert.equal(r.receipt.total_actual,0);assert.equal(r.receipt.inspection,'pending');assert.equal(r.receipt.requires_review,true);
 assert.ok(r.discrepancies.includes('delivery_without_receipt'));assert.equal(f.warehouse.stock('shirt-small','warehouse-one'),0);
}));
test('M08-G07-LOCAL-PORT025-DUPLICATE-NATIVE-AND-IMPORTED-RECEIPTS-COUNT-ONCE',()=>usingWarehouseReturn(f=>{
 const e=f.event(),first=f.observe(e),again=f.observe(e);
 assert.equal(again.receipt.total_actual,1);assert.equal(again.receipt.digest,first.receipt.digest);assert.equal(again.events.length,1);
 const {source_identity,tenant_id,store_id,adjustments,digest,qualification,...input}=e;
 assert.deepEqual(f.warehouse.recordReturnEvent(input),e);assert.equal(f.warehouse.returnEvents().length,1);
 assert.throws(()=>f.warehouse.recordReturnEvent({...input,operator_id:'another_operator'}),/WAREHOUSE_EVENT_CONFLICT/);
}));
test('M08-G07-LOCAL-OUT-OF-ORDER-EVENTS-KEEP-GAP-UNTIL-ORIGINAL-IMPORT',()=>usingWarehouseReturn(f=>{
 const first=f.event({kind:'delivery',units:[]}),second=f.event();
 const gap=f.observe(second);assert.equal(gap.receipt.total_actual,0);assert.ok(gap.discrepancies.includes('missing_source_event'));
 const fixed=f.observe(first);assert.equal(fixed.receipt.total_actual,1);assert.ok(!fixed.discrepancies.includes('missing_source_event'));
 assert.equal(f.warehouse.stock('shirt-small','warehouse-one'),0);assert.equal(f.warehouse.calls.apply,0);
}));
test('M08-G07-LOCAL-WRONG-VARIANT-AND-LOCATION-REMAIN-DISCREPANCIES',()=>usingWarehouseReturn(f=>{
 f.warehouse.seed('shirt-small','warehouse-two',0);
 const r=f.observe(f.event({location_id:'warehouse-two',units:[f.unit({variant_id:'hat-small'})]}));
 assert.equal(r.receipt.total_actual,0);assert.ok(r.discrepancies.includes('warehouse_location_conflict'));assert.ok(r.discrepancies.includes('warehouse_item_mapping_conflict'));
 assert.equal(f.warehouse.stock('shirt-small','warehouse-one'),0);
}));
test('M08-G07-LOCAL-INSPECTION-IS-AN-ADDITIVE-EFFECTIVE-RECEIPT',()=>usingWarehouseReturn(f=>{
 const first=f.event({units:[f.unit({grade:'unknown'})]});f.observe(first);
 const raw=f.kernel.db.prepare('SELECT body,digest FROM commerce_received_units').get() as Row;
 const e=f.event({kind:'inspection',parent_event_id:first.event_id,units:[f.unit({grade:'damaged'})]});
 const r=f.observe(e);assert.equal(r.receipt.units[0].grade,'damaged');assert.equal(r.receipt.total_actual,1);
 assert.deepEqual(f.kernel.db.prepare('SELECT body,digest FROM commerce_received_units').get(),raw);
 assert.throws(()=>f.kernel.db.prepare("UPDATE commerce_received_units SET grade='sellable'").run(),/RECEIPT_IMMUTABLE/);
 assert.equal(r.receipt.units[0].warehouse_event_id,e.event_id);
}));
test('M08-G07-LOCAL-CORRECTION-INVALIDATES-APPROVED-DISPOSITION',()=>usingWarehouseReturn(async f=>{
 const first=f.event(),r=f.observe(first);f.receiving.close(f.a.scope,{session_id:r.receipt.session_id,expected_revision:r.receipt.revision});
 const q=f.disposition.quote(f.a.scope,{session_id:r.receipt.session_id,unit_ids:[r.receipt.units[0].id],disposition:'restock'}),op=f.authorizeLife(q);
 f.observe(f.event({kind:'correction',parent_event_id:first.event_id,units:[f.unit({grade:'damaged'})]}));
 await assert.rejects(f.disposition.dispatch(f.a.scope,op.id),/DISPOSITION_QUOTE_CHANGED/);
 assert.equal(f.warehouse.calls.apply,0);assert.equal(f.warehouse.stock('shirt-small','warehouse-one'),0);
}));
test('M08-G07-LOCAL-CORRECTED-GRADE-CONTROLS-NEW-QUOTE',()=>usingWarehouseReturn(f=>{
 const first=f.event(),before=f.observe(first);f.receiving.close(f.a.scope,{session_id:before.receipt.session_id,expected_revision:before.receipt.revision});
 const r=f.observe(f.event({kind:'correction',parent_event_id:first.event_id,units:[f.unit({grade:'damaged'})]}));
 assert.throws(()=>f.disposition.quote(f.a.scope,{session_id:r.receipt.session_id,unit_ids:[r.receipt.units[0].id],disposition:'restock'}),/DISPOSITION_DENIED/);
 const q=f.disposition.quote(f.a.scope,{session_id:r.receipt.session_id,unit_ids:[r.receipt.units[0].id],disposition:'quarantine'});
 assert.equal(q.quote.units[0].grade,'damaged');assert.equal(q.quote.receipt_digest,r.receipt.digest);
}));
test('M08-G07-LOCAL-LINKED-SOURCE-CORRECTION-REVERSES-STOCK-EXACTLY-ONCE',()=>usingWarehouseReturn(f=>{
 const receipt=f.event();f.observe(receipt);
 const restock=f.event({kind:'disposition',parent_event_id:receipt.event_id,units:[f.unit({disposition:'restock'})]});f.observe(restock);assert.equal(f.warehouse.stock('shirt-small','warehouse-one'),1);
 const correction=f.event({kind:'correction',parent_event_id:restock.event_id,units:[f.unit({received:false,disposition:null})]});
 const r=f.observe(correction);f.observe(correction);assert.equal(r.receipt.total_actual,0);assert.equal(f.warehouse.stock('shirt-small','warehouse-one'),0);
 assert.equal(correction.adjustments[0].available_delta,-1);assert.equal(correction.adjustments[0].parent_event_id,restock.event_id);
 assert.equal(f.warehouse.returnEvents().length,3);assert.equal(f.kernel.db.prepare('SELECT count(*) n FROM commerce_received_units').get()?.n,1);
}));
test('M08-G07-LOCAL-EXTERNAL-DISPOSITION-FENCES-LOCAL-RESTOCK',()=>usingWarehouseReturn(f=>{
 const receipt=f.event();f.observe(receipt);
 const r=f.observe(f.event({kind:'disposition',parent_event_id:receipt.event_id,units:[f.unit({disposition:'restock'})]}));
 f.receiving.close(f.a.scope,{session_id:r.receipt.session_id,expected_revision:r.receipt.revision});
 assert.throws(()=>f.disposition.quote(f.a.scope,{session_id:r.receipt.session_id,unit_ids:[r.receipt.units[0].id],disposition:'restock'}),/UNIT_ALREADY_DISPOSED/);
 assert.equal(f.warehouse.stock('shirt-small','warehouse-one'),1);assert.equal(f.warehouse.calls.apply,0);
}));
test('M08-G07-LOCAL-RESOURCE-SCOPE-AND-REVOKED-ACTOR-CANNOT-IMPORT',()=>usingWarehouseReturn(f=>{
 const e=f.event({resource_id:'other_order'});assert.throws(()=>f.observe(e),/WAREHOUSE_RETURN_MISMATCH/);
 assert.equal(f.kernel.db.prepare('SELECT count(*) n FROM commerce_warehouse_return_events').get()?.n,0);
 f.kernel.revoke(f.a.scope);assert.throws(()=>f.events.read(f.a.scope,f.request.id),/ACCESS_DENIED/);
}));
test('M08-G07-LOCAL-CURRENT-SOURCE-BINDING-AND-SETTINGS-ARE-REQUIRED',()=>usingWarehouseReturn(f=>{
 const e=f.event();f.disposition.configure(f.owner.scope,{expected_revision:1,enabled:true,source_identity:'different_source',locations:['warehouse-one'],expires_at:f.now()+300000});
 assert.throws(()=>f.observe(e),/WAREHOUSE_SOURCE_MISMATCH/);assert.equal(f.kernel.db.prepare('SELECT count(*) n FROM commerce_warehouse_return_events').get()?.n,0);
}));
test('M08-G07-LOCAL-NATIVE-AND-CANONICAL-EVENT-INTEGRITY-FAIL-CLOSED',()=>usingWarehouseReturn(f=>{
 const e=f.event();f.observe(e);
 f.warehouseDb.prepare("UPDATE warehouse_return_events SET body=replace(body,'partner_operator_1','partner_operator_2') WHERE event_id=?").run(e.event_id);
 assert.throws(()=>f.warehouse.returnEvent(e.event_id),/WAREHOUSE_EVENT_INTEGRITY/);
 f.kernel.db.prepare("UPDATE commerce_warehouse_return_events SET body=replace(body,'partner_operator_1','partner_operator_2')").run();
 assert.throws(()=>f.events.read(f.a.scope,f.request.id),/LIFECYCLE_INTEGRITY/);
}));
test('M08-G07-LOCAL-CORRECTION-REQUIRES-CURRENT-PARENT-AND-UNIT-IDENTITY',()=>usingWarehouseReturn(f=>{
 const receipt=f.event(),inspection=f.event({kind:'inspection',parent_event_id:receipt.event_id,units:[f.unit({grade:'damaged'})]});
 assert.throws(()=>f.event({kind:'correction',parent_event_id:receipt.event_id,units:[f.unit()]}),/WAREHOUSE_CORRECTION_PARENT_CHANGED/);
 assert.throws(()=>f.event({kind:'receipt',units:[f.unit()]}),/WAREHOUSE_UNIT_ALREADY_RECEIVED/);
 assert.equal(f.warehouse.returnEvents().length,2);assert.equal(inspection.adjustments.length,0);
}));
test('M08-G07-LOCAL-NATIVE-EVENT-IDENTITY-SURVIVES-RESTART-AND-REPLAY',()=>usingWarehouseReturn(f=>{
 const receipt=f.event(),e=f.event({kind:'disposition',parent_event_id:receipt.event_id,units:[f.unit({disposition:'restock'})]});
 const db=new DatabaseSync(f.warehouseFile);
 try{const source=new WarehouseFixtureSource(db,{mode:'fixture',identity:'warehouse-fixture',tenant:f.a.tenant,store:f.a.store});assert.equal(source.identity,f.warehouse.identity);assert.deepEqual(source.returnEvent(e.event_id),e);
  const events=new WarehouseReturnEvents(f.kernel,source);events.importEvent(f.a.scope,{request_id:f.request.id,event_id:receipt.event_id});events.importEvent(f.a.scope,{request_id:f.request.id,event_id:e.event_id});
  assert.equal(source.stock('shirt-small','warehouse-one'),1);assert.equal(events.read(f.a.scope,f.request.id).receipt.total_actual,1);
 }finally{db.close();}
}));
test('M08-G07-LOCAL-NAMED-DELIVERY-RESTOCK-SOURCE-FAULT-IS-DETECTED',()=>usingWarehouseReturn(async f=>{
 const oracle=(source:WarehouseFixtureSource)=>assert.equal(source.stock('shirt-small','warehouse-one'),0,'Parcel delivery cannot create received or restocked merchandise');
 f.event({kind:'delivery',units:[]});oracle(f.warehouse);
 const url=new URL('../../packages/adapters/warehouse-fixture-source.mts',import.meta.url),original=readFileSync(url,'utf8');
 const marker="const eventUnits: Row[] = c.kind === 'delivery' ? [] : c.units;";assert.equal(original.split(marker).length,2);
 const faulty=original.replace(marker,"const eventUnits: Row[] = c.kind === 'delivery' ? [{line_id:'alpha',ordinal:1,variant_id:'shirt-small',grade:'sellable',received:true,disposition:'restock'}] : c.units;")
  .replace(/from '(\.[^']+)'/g,(_match,path)=>"from '"+new URL(path,url).href+"'");
 const dir=mkdtempSync(join(tmpdir(),'rifare-return-event-fault-'));
 try{const file=join(dir,'warehouse-fixture-source.mts');writeFileSync(file,faulty);const {WarehouseFixtureSource:BrokenSource}=await import(pathToFileURL(file).href);
  const broken=new BrokenSource(f.warehouseDb,{mode:'fixture',identity:'warehouse-fixture',tenant:f.a.tenant,store:f.a.store});
  broken.recordReturnEvent({event_id:'fault_delivery',request_id:f.request.id,resource_id:f.order().id,native_return_id:'gid://shopify/Return/900',sequence:2,kind:'delivery',location_id:'warehouse-one',operator_id:'partner_operator_1',evidence_ids:[],completeness:'complete',parent_event_id:null,units:[]});
  assert.equal(broken.stock('shirt-small','warehouse-one'),1);assert.throws(()=>oracle(broken),assert.AssertionError);
 }finally{rmSync(dir,{recursive:true,force:true});}
}));
