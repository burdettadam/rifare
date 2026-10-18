import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { packingFixture, packingLine, usingPacking } from './packing-helpers.mts';
import { PackingSessions } from '../../packages/commerce/packing-sessions.mts';
import { CarrierQuoteFixtureSource } from '../../packages/adapters/carrier-quote-fixture-source.mts';
import { Permissions } from '../../packages/commerce/authorization.mts';
import { PrivacyLifecycle } from '../../packages/commerce/privacy-lifecycle.mts';
import { contentDigest } from '../../packages/commerce/configuration-values.mts';
import type { Row } from '../../packages/commerce/kernel.mts';

async function sourceMutant(replace:(source:string)=>string,run:(Broken:typeof PackingSessions)=>unknown) {
  const temporary=mkdtempSync(join(tmpdir(),'rifare-packing-mutant-'));
  try{
    const url=new URL('../../packages/commerce/packing-sessions.mts',import.meta.url),source=readFileSync(url,'utf8');
    const changed=replace(source);assert.notEqual(changed,source);
    const file=join(temporary,'packing-sessions.mts');
    writeFileSync(file,changed.replace(/from '(\.[^']+)'/g,(_match,path)=>"from '"+new URL(path,url).href+"'"));
    const {PackingSessions:Broken}=await import(pathToFileURL(file).href);await run(Broken);
  }finally{rmSync(temporary,{recursive:true,force:true});}
}
const unit=(ordinal:number,line_id='line-a')=>({line_id,ordinal});
const tables=['commerce_packing_sessions','commerce_packing_allocations','commerce_packing_scans','commerce_packing_confirmations'];

test('CASE-M08-G03-01',()=>usingPacking(f=>{
  f.open([unit(1),unit(2),unit(3)]);
  for(const ordinal of [1,2,3])assert.equal(f.scan(ordinal).outcome,'accepted');
  const before=f.service.read(f.a.scope,'session-a');assert.equal(before.packed_count,3);assert.equal(before.expected_count,3);
  assert.equal(f.service.qualifiedPackage(f.a.scope,'package-a').qualified,false);
  const confirmed=f.confirm();assert.equal(confirmed.state,'confirmed');assert.equal(confirmed.confirmed_by,'operator');
  const qualified=f.service.qualifiedPackage(f.a.scope,'package-a');assert.equal(qualified.qualified,true);
  assert.equal(qualified.package_revision,1);assert.equal(qualified.confirmation_id,confirmed.confirmation_id);
  assert.deepEqual(qualified.allocations,[{line_id:'line-a',quantity:3}]);assert.equal(qualified.allocation_digest,confirmed.allocation_digest);
  assert.equal(qualified.inventory_effect,false);assert.equal(qualified.physical_qualified,false);
}));

test('CASE-M08-G03-02',()=>usingPacking(f=>{
  f.open([unit(1),unit(2)]);
  assert.equal(f.scan(1,{scan_id:'wrong',sku:'other-sku'}).outcome,'wrong_sku');
  assert.equal(f.scan(3,{scan_id:'excess'}).outcome,'unexpected_unit');
  assert.equal(f.scan(1).outcome,'accepted');assert.equal(f.scan(1).replayed,true);
  assert.equal(f.scan(1,{scan_id:'second-physical-scan'}).outcome,'duplicate_unit');
  assert.throws(()=>f.scan(2,{scan_id:'scan-1'}),/SCAN_ID_CONFLICT/);
  const state=f.service.read(f.a.scope,'session-a');assert.equal(state.packed_count,1);assert.equal(state.expected_count,2);
  assert.deepEqual(state.discrepancies.map((r:Row)=>r.outcome),['wrong_sku','unexpected_unit','duplicate_unit']);
}));

test('CASE-M08-G03-03',async()=>{
  await usingPacking(f=>{
    f.open([unit(1),unit(2)]);f.scan(1);
    const restarted=f.restart();try{
      const replay=restarted.service.scan(restarted.scope,{session_id:'session-a',scanner_id:'scanner-a',scan_id:'scan-1',line_id:'line-a',ordinal:1,sku:'sku-a'});
      assert.equal(replay.replayed,true);assert.equal(restarted.service.read(restarted.scope,'session-a').packed_count,1);
      assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_packing_scans').get()!.n,1);
    }finally{restarted.db.close();}
  });
  await sourceMutant(source=>{
    const before='    // scan-deduplication-before-count';
    const after='      this.#increment(s,row.id); // scan-count-after-deduplication';
    assert.equal(source.split(before).length,2);assert.equal(source.split(after).length,2);
    return source.replace(before,before+'\n    this.#increment(s,row.id);').replace(after,'      // Deliberate named fault: count already incremented before deduplication.');
  },Broken=>usingPacking(f=>{
    f.open([unit(1),unit(2)]);const broken=new Broken(f.kernel,f.source);
    const command={session_id:'session-a',scanner_id:'scanner-a',scan_id:'fault-scan',line_id:'line-a',ordinal:1,sku:'sku-a'};
    assert.equal(broken.scan(f.a.scope,command).outcome,'accepted');
    // The genuine duplicate replay now increments the durable counter before its
    // key is checked. The stored-count reconciliation catches this behavior and
    // the transaction rolls back, rather than accepting an inflated count.
    assert.throws(()=>broken.scan(f.a.scope,command),/PACKING_COUNT_INTEGRITY/);
    assert.equal(f.service.read(f.a.scope,'session-a').packed_count,1);
    assert.equal(f.service.scan(f.a.scope,command).replayed,true);
  }));
});

test('PORT-025',()=>usingPacking(f=>{
  const before=f.db.prepare('SELECT count(*) n FROM commerce_fulfillment_operations').get()!.n;
  f.open([unit(1),unit(2),unit(3)]);f.scan(1);f.scan(1);
  const state=f.service.read(f.a.scope,'session-a');assert.equal(state.packed_count,1);assert.equal(state.missing_count,2);
  assert.deepEqual(state.lines,[{line_id:'line-a',sku:'sku-a',expected:3,packed:1,missing:2}]);
  assert.throws(()=>f.confirm(),/PACKING_INCOMPLETE/);assert.equal(state.inventory_effect,false);
  assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_fulfillment_operations').get()!.n,before);
}));

test('M08-G03-UNIT-IDENTITY-AND-SAME-SKU-LINES',()=>usingPacking(f=>{
  f.open([unit(1),unit(1,'line-b')]);
  assert.equal(f.scan(1).outcome,'accepted');
  assert.equal(f.scan(2,{scan_id:'wrong-ordinal'}).outcome,'unexpected_unit');
  assert.equal(f.scan(1,{scan_id:'line-b-scan',line_id:'line-b'}).outcome,'accepted');
  const state=f.confirm();assert.deepEqual(state.lines,[{line_id:'line-a',sku:'sku-a',expected:1,packed:1,missing:0},{line_id:'line-b',sku:'sku-a',expected:1,packed:1,missing:0}]);
  assert.equal(new Set(state.units.map((u:Row)=>u.unit_key)).size,2);
},[packingLine({quantity:2}),packingLine({line_id:'line-b',quantity:1})]));

test('M08-G03-CONFIRMATION-AUTHORITY-AND-REVISION',()=>usingPacking(f=>{
  f.open([unit(1),unit(2)]);f.scan(1);assert.throws(()=>f.confirm(),/PACKING_INCOMPLETE/);f.scan(2);
  assert.throws(()=>f.service.confirm(f.a.scope,{session_id:'session-a',expected_revision:1}),/PACKING_REVISION_CHANGED/);
  assert.throws(()=>f.service.confirm(f.a.worker,{session_id:'session-a',expected_revision:3}),/ACCESS_DENIED/);
  const confirmed=f.confirm();assert.equal(confirmed.confirmed_by,'operator');
  assert.equal(f.service.confirm(f.a.scope,{session_id:'session-a',expected_revision:confirmed.revision}).confirmation_id,confirmed.confirmation_id);
  assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_packing_confirmations').get()!.n,1);
  assert.throws(()=>f.scan(3,{scan_id:'after-confirm'}),/PACKING_SESSION_CLOSED/);
}));

test('M08-G03-CURRENT-ORDER-PARCEL-AND-SOURCE-RECHECKS',()=>usingPacking(f=>{
  f.pack([1]);const revision=f.service.qualifiedPackage(f.a.scope,'package-a').revision;
  f.source.setPackage({...f.source.package('package-a')!,revision:2,address_revision:2,to_address_ref:'new-destination'});
  const stale=f.service.qualifiedPackage(f.a.scope,'package-a');assert.equal(stale.qualified,false);assert.equal(stale.reason,'PACKAGE_CHANGED');assert.equal(stale.revision,revision);
  f.open([unit(2)],'session-b','package-b');f.scan(2,{session_id:'session-b',scan_id:'b-2'});f.payload.packing.lines[0].cancelled_ordinals=[2];f.update();
  assert.throws(()=>f.confirm('session-b'),/ORDER_CHANGED/);
  const other=new CarrierQuoteFixtureSource({tenant_id:f.a.tenant,store_id:f.a.store},f.now);other.setPackage(f.source.package('package-b'));
  assert.equal(new PackingSessions(f.kernel,other).qualifiedPackage(f.a.scope,'package-b').reason,'SOURCE_CHANGED');
}));

test('M08-G03-TENANT-RESOURCE-AND-ERASURE-GUARDS',()=>usingPacking(f=>{
  f.open([unit(1)]);assert.throws(()=>f.service.read(f.b.scope,'session-a'),/SOURCE_SCOPE_MISMATCH/);
  assert.throws(()=>f.service.read(f.c.scope,'session-a'),/SOURCE_SCOPE_MISMATCH/);assert.throws(()=>f.service.read({},'session-a'),/ACCESS_DENIED/);
  const other=f.seed(f.a.scope,'beta','OTHER');f.addParcel('wrong-order',other.id);
  assert.throws(()=>f.service.open(f.a.scope,{session_id:'wrong',package_id:'wrong-order',resource_id:f.order.id,units:[unit(2)]}),/PACKAGE_RESOURCE_MISMATCH/);
  f.db.prepare('INSERT INTO commerce_privacy_resources VALUES(?,?,?,?,?)').run(f.a.tenant,f.a.store,f.order.id,'a'.repeat(64),f.now());
  assert.throws(()=>f.scan(1),/SUBJECT_ERASED/);assert.throws(()=>f.service.qualifiedPackage(f.a.scope,'package-a'),/SUBJECT_ERASED/);
  assert.equal(f.db.prepare('SELECT packed_count FROM commerce_packing_sessions').get()!.packed_count,0);
}));

test('M08-G03-RECOVERY-AND-BOUNDED-INPUT',()=>usingPacking(f=>{
  assert.throws(()=>f.open([]),/INVALID_PACKING_UNITS/);
  assert.throws(()=>f.open([unit(1),unit(1)]),/DUPLICATE_PACKING_UNIT/);
  assert.throws(()=>f.service.open(f.a.scope,{session_id:'a',package_id:'package-a',resource_id:f.order.id,units:[unit(1)],confirmed:true}),/INVALID_INPUT/);
  assert.throws(()=>f.open(Array.from({length:129},(_,i)=>unit(i+1))),/INVALID_PACKING_UNITS/);
  f.open([unit(1)]);
  f.db.prepare("INSERT INTO commerce_recovery_state VALUES(1,'restore-packing','quarantine',?,?,?)").run('a'.repeat(64),'b'.repeat(64),f.now());
  assert.equal(f.service.read(f.a.scope,'session-a').packed_count,0);
  assert.throws(()=>f.scan(1),/RESTORE_WRITE_BLOCKED/);assert.throws(()=>f.confirm(),/RESTORE_WRITE_BLOCKED/);
  assert.throws(()=>f.service.cancel(f.a.scope,{session_id:'session-a',expected_revision:1}),/RESTORE_WRITE_BLOCKED/);
  assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_packing_scans').get()!.n,0);
}));

test('CASE-M08-G04-01',()=>usingPacking(f=>{
  f.pack([1,2]);f.pack([3],'session-b','package-b');
  const a=f.service.qualifiedPackage(f.a.scope,'package-a'),b=f.service.qualifiedPackage(f.a.scope,'package-b');
  assert.deepEqual([a.allocations,b.allocations],[[{line_id:'line-a',quantity:2}],[{line_id:'line-a',quantity:1}]]);
  assert.equal(a.qualified,true);assert.equal(b.qualified,true);
  const remaining=f.service.remaining(f.a.scope,f.order.id);assert.equal(remaining.ordered_count,3);assert.equal(remaining.available_count,0);assert.equal(remaining.allocated_count,3);
  assert.equal(f.db.prepare("SELECT count(*) n FROM commerce_packing_allocations WHERE state='allocated'").get()!.n,3);
}));

test('CASE-M08-G04-02',()=>usingPacking(f=>{
  f.open([unit(1)]);assert.throws(()=>f.open([unit(1)],'session-b','package-b'),/UNIT_NOT_AVAILABLE/);
  f.payload.packing.lines[0].cancelled_ordinals=[2];f.update();
  assert.throws(()=>f.open([unit(2)],'session-c','package-c'),/UNIT_NOT_AVAILABLE/);
  assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_packing_sessions').get()!.n,1);
  assert.equal(f.service.remaining(f.a.scope,f.order.id).available_count,1);
}));

test('CASE-M08-G04-03',async()=>{
  await usingPacking(f=>{
    f.pack([1]);f.pack([2,3],'session-b','package-b');
    f.service.observeShipment(f.a.scope,{session_id:'session-a',observation_id:'synthetic-shipment-a'});
    const cancelled=f.service.cancel(f.a.scope,{session_id:'session-b',expected_revision:f.service.read(f.a.scope,'session-b').revision});
    assert.equal(cancelled.released_count,2);assert.equal(f.service.read(f.a.scope,'session-a').state,'shipped');
    assert.throws(()=>f.service.cancel(f.a.scope,{session_id:'session-a',expected_revision:f.service.read(f.a.scope,'session-a').revision}),/SHIPPED_ALLOCATION_IMMUTABLE/);
    const remaining=f.service.remaining(f.a.scope,f.order.id);assert.equal(remaining.available_count,2);assert.equal(remaining.shipped_count,1);
    assert.deepEqual(remaining.available_units.map((u:Row)=>u.ordinal),[2,3]);
    f.open([unit(2),unit(3)],'session-c','package-c');assert.equal(f.service.remaining(f.a.scope,f.order.id).available_count,0);
  });
  await sourceMutant(source=>{
    const marker='    const available=units.filter(u=>u.eligible&&!reserved.has(u.unit_key));';assert.equal(source.split(marker).length,2);
    return source.replace(marker,'    const available=units.filter(u=>u.eligible); // Deliberate original-quantity-per-package fault.');
  },Broken=>usingPacking(f=>{
    f.open([unit(1),unit(2)]);const broken=new Broken(f.kernel,f.source);
    const oracle=(row:Row)=>assert.equal(row.available_count,1);
    oracle(f.service.remaining(f.a.scope,f.order.id));const faulty=broken.remaining(f.a.scope,f.order.id);
    assert.equal(faulty.available_count,3);assert.throws(()=>oracle(faulty),{code:'ERR_ASSERTION'});
    assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_packing_allocations').get()!.n,2);
  }));
});

test('M08-G04-BACKORDERS-CANCELLATIONS-AND-RETURN-LINKS',()=>usingPacking(f=>{
  const remaining=f.service.remaining(f.a.scope,f.order.id);assert.equal(remaining.available_count,2);assert.equal(remaining.backordered_count,1);assert.equal(remaining.cancelled_count,1);
  assert.equal(remaining.shipped_count,1);assert.deepEqual(remaining.available_units.map((u:Row)=>u.ordinal),[1,2]);
  f.open([unit(1),unit(2)]);assert.deepEqual(f.service.read(f.a.scope,'session-a').units[0].return_links,['return-original']);
  f.payload.packing.lines[0].cancelled_ordinals=[4,2];f.update();
  const cancelled=f.service.cancel(f.a.scope,{session_id:'session-a',expected_revision:1});assert.equal(cancelled.released_count,1);
  assert.equal(f.service.remaining(f.a.scope,f.order.id).available_count,1);
  f.open([unit(1)],'session-b','package-b');assert.deepEqual(f.service.read(f.a.scope,'session-b').units[0].return_links,['return-original']);
},[packingLine({quantity:5,backordered_ordinals:[3],cancelled_ordinals:[4],shipped_ordinals:[5],return_links:[{ordinal:1,return_id:'return-original'}]})]));

test('M08-G04-RESTART-ALLOCATION-AND-PACKAGE-IDEMPOTENCY',()=>usingPacking(f=>{
  f.open([unit(1),unit(2)]);const restarted=f.restart();try{
    const repeated=restarted.service.open(restarted.scope,{session_id:'session-a',package_id:'package-a',resource_id:f.order.id,units:[unit(2),unit(1)]});
    assert.equal(repeated.id,'session-a');assert.equal(restarted.service.remaining(restarted.scope,f.order.id).available_count,1);
    assert.throws(()=>restarted.service.open(restarted.scope,{session_id:'new-key',package_id:'package-a',resource_id:f.order.id,units:[unit(3)]}),/PACKAGE_ALREADY_ALLOCATED/);
    assert.throws(()=>restarted.service.open(restarted.scope,{session_id:'session-a',package_id:'package-b',resource_id:f.order.id,units:[unit(3)]}),/PACKING_SESSION_CONFLICT/);
    assert.throws(()=>restarted.service.open(restarted.scope,{session_id:'session-b',package_id:'package-b',resource_id:f.order.id,units:[unit(2)]}),/UNIT_NOT_AVAILABLE/);
  }finally{restarted.db.close();}
}));

test('M08-G04-CANCELLED-AND-SHIPPED-IDENTITIES-REMAIN-FENCED',()=>usingPacking(f=>{
  f.pack([1]);const confirmed=f.service.read(f.a.scope,'session-a');
  const cancelled=f.service.cancel(f.a.scope,{session_id:'session-a',expected_revision:confirmed.revision});
  assert.equal(cancelled.state,'cancelled');assert.equal(f.service.qualifiedPackage(f.a.scope,'package-a').qualified,false);
  assert.throws(()=>f.service.observeShipment(f.a.scope,{session_id:'session-a',observation_id:'after-cancel'}),/PACKING_CONFIRMATION_REQUIRED/);
  assert.throws(()=>f.open([unit(1)],'session-new','package-a'),/PACKAGE_ALREADY_ALLOCATED/);
  assert.equal(f.service.cancel(f.a.scope,{session_id:'session-a',expected_revision:cancelled.revision}).revision,cancelled.revision);
  assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_packing_confirmations').get()!.n,1);
}));

test('M08-G04-PERMISSIONS-AND-DURABLE-COUNT-INTEGRITY',()=>usingPacking(f=>{
  f.open([unit(1)]);f.kernel.provisionMember(f.a.tenant,f.a.store,'owner','owner');
  const owner=f.kernel.authenticate(f.kernel.issueSession(f.a.tenant,f.a.store,'owner'));
  new Permissions(f.kernel).change(owner,{actor_id:'operator',role:'operator',expected_revision:0,actions:['resource.read','operation.read'],resource_ids:[f.order.id]});
  assert.equal(f.service.read(f.a.scope,'session-a').packed_count,0);assert.throws(()=>f.scan(1),/ACCESS_DENIED/);
  assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_packing_scans').get()!.n,0);
  f.db.prepare('UPDATE commerce_packing_sessions SET packed_count=1 WHERE id=?').run('session-a');
  assert.throws(()=>f.service.read(f.a.scope,'session-a'),/PACKING_COUNT_INTEGRITY/);
  f.db.prepare('UPDATE commerce_packing_sessions SET packed_count=0,body=? WHERE id=?').run('{"tampered":true}','session-a');
  assert.throws(()=>f.service.read(f.a.scope,'session-a'),/PACKING_BODY_INTEGRITY/);
}));

test('M08-G04-POPULATED-STORAGE-EXPORT-AND-ERASURE',()=>usingPacking(f=>{
  f.pack([1,2]);f.kernel.provisionMember(f.a.tenant,f.a.store,'owner','owner');
  const owner=f.kernel.authenticate(f.kernel.issueSession(f.a.tenant,f.a.store,'owner')),privacy=new PrivacyLifecycle(f.kernel);
  const exported=privacy.export(owner,f.order.customer_id);
  for(const table of tables)assert.ok(exported.packing_records[table].length>0,table);
  const identities=Object.fromEntries(tables.map(table=>[table,f.db.prepare('SELECT id FROM '+table+' ORDER BY id').all()]));
  assert.equal(privacy.erase(owner,f.order.customer_id).status,'logically_erased');
  for(const table of tables){
    assert.deepEqual(f.db.prepare('SELECT id FROM '+table+' ORDER BY id').all(),identities[table]);
    for(const r of f.db.prepare('SELECT body,digest FROM '+table).all() as Row[]){assert.equal(JSON.parse(r.body).redacted,true);assert.equal(r.digest,contentDigest(JSON.parse(r.body)));assert.equal(r.body.includes('sku-a'),false);}
  }
  assert.throws(()=>f.service.qualifiedPackage(f.a.scope,'package-a'),/SUBJECT_ERASED/);
  assert.equal(f.db.prepare('SELECT count(*) n FROM commerce_packing_scans').get()!.n,2);
}));

test('M08-G04-CLI-SYNTHETIC-CONTRACT',()=>{
  const script=new URL('../../tools/demo-packing-sessions.mts',import.meta.url).pathname;
  const describe=JSON.parse(execFileSync(process.execPath,['--experimental-strip-types',script,'--describe'],{encoding:'utf8',timeout:10000}));
  assert.deepEqual(describe.goal_ids,['M08-G03','M08-G04']);assert.equal(describe.inventory_effect,false);assert.equal(describe.physical_qualified,false);
  const demo=JSON.parse(execFileSync(process.execPath,['--experimental-strip-types',script,'--run-local'],{encoding:'utf8',timeout:10000}));
  assert.equal(demo.partial.packed_count,1);assert.equal(demo.partial.missing_count,1);
  assert.equal(demo.shipped.state,'shipped');assert.equal(demo.cancelled.state,'cancelled');
  assert.equal(demo.remaining.available_count,1);assert.equal(demo.remaining.shipped_count,2);assert.equal(demo.formal_goal_accepted,false);
});
