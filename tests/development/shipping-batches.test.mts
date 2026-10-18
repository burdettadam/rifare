import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,readFileSync,writeFileSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { contentDigest,canonical } from '../../packages/commerce/configuration-values.mts';
import { CarrierQuotes } from '../../packages/commerce/carrier-quotes.mts';
import { ShippingBatchLabels } from '../../packages/commerce/shipping-batch-labels.mts';
import { ShippingCarrierFixtureSource } from '../../packages/adapters/shipping-carrier-fixture-source.mts';
import { ShippingManifests } from '../../packages/commerce/shipping-manifests.mts';
import { Permissions } from '../../packages/commerce/authorization.mts';
import { ExecutionStops } from '../../packages/commerce/execution-stops.mts';
import { PrivacyLifecycle } from '../../packages/commerce/privacy-lifecycle.mts';
import { shippingFixture,usingShipping } from './shipping-helpers.mts';
import type { Row } from '../../packages/commerce/kernel.mts';

const states=(r:Row)=>r.packages.map((p:Row)=>[p.package_id,p.state]);
const twoLabels=(r:Row)=>assert.deepEqual(states(r),[['package-a','purchased'],['package-b','purchased']]);
const manifestInput={manifest_id:'manifest-one',package_ids:['package-a','package-b']};
async function ready(f:ReturnType<typeof shippingFixture>){await f.labels.purchase(f.a.scope,f.approved());f.packed();}
async function mutant(relative:string,marker:string,replacement:string,run:(mod:Row)=>Promise<void>){
  const directory=mkdtempSync(join(tmpdir(),'rifare-shipping-mutant-')),url=new URL(relative,import.meta.url);
  try{const original=readFileSync(url,'utf8');assert.equal(original.split(marker).length,2);
    const source=original.replace(marker,replacement).replace(/from '(\.[^']+)'/g,(_m,p)=>"from '"+new URL(p,url).href+"'");
    const target=join(directory,'mutant.mts');writeFileSync(target,source);await run(await import(pathToFileURL(target).href));
  }finally{rmSync(directory,{recursive:true,force:true});}
}

test('CASE-M08-G02-01-LOCAL',()=>usingShipping(async f=>{
  const q=f.approved();f.source.setFault('purchase','package-b','after');const result=await f.labels.purchase(f.a.scope,q);
  assert.deepEqual(states(result),[['package-a','purchased'],['package-b','unknown']]);
  assert.equal(f.source.ledger().purchases.length,2);assert.equal(result.packages[0].receipt.amount_minor,'500');
  assert.equal(result.packages[0].receipt.native_label_id!==null,true);assert.equal(result.packages[1].receipt,null);
  const before=result.packages[0].purchase_id;await f.labels.reconcile(f.a.scope,'package-b');
  const repaired=f.labels.packageStatus(f.a.scope,'package-b');assert.equal(repaired.state,'purchased');assert.equal(repaired.receipt.amount_minor,'900');
  assert.equal(f.labels.packageStatus(f.a.scope,'package-a').purchase_id,before);assert.equal(f.source.calls.purchase.length,2);
}));
test('CASE-M08-G02-02-LOCAL',()=>usingShipping(async f=>{
  const q=f.approved();f.source.setFault('purchase','package-b','after');await f.labels.purchase(f.a.scope,q);
  const first=f.labels.packageStatus(f.a.scope,'package-a');
  twoLabels(await f.labels.purchase(f.a.scope,q));twoLabels(await f.labels.purchase(f.a.scope,f.quote()));
  assert.equal(f.source.ledger().purchases.length,2);assert.equal(f.source.calls.purchase.length,2);
  assert.equal(f.labels.packageStatus(f.a.scope,'package-a').receipt.native_charge_id,first.receipt.native_charge_id);
  assert.deepEqual(f.source.ledger().totals,[{currency:'USD',amount_minor:'1400'}]);
}));
test('CASE-M08-G02-03',()=>usingShipping(async f=>{
  const q=f.approved();f.source.setFault('purchase','package-b','after');await f.labels.purchase(f.a.scope,q);
  const original=f.labels.packageStatus(f.a.scope,'package-b').purchase_id;
  const freshQuotes=new CarrierQuotes(f.kernel,f.quoteSource,f.policy),restoredSource=new ShippingCarrierFixtureSource(f.sourceDB,f.sourceOptions);
  await mutant('../../packages/commerce/shipping-batch-labels.mts','    const identity=op.purchase_id;',"    const identity='buy_'+token().slice(0,32);",async mod=>{
    const broken=new mod.ShippingBatchLabels(f.kernel,freshQuotes,restoredSource,{deadline_ms:15});
    const observed=await broken.purchase(f.a.scope,q);
    assert.equal(observed.packages[1].state,'unknown');assert.notEqual(restoredSource.calls.lookup.at(-1),original);
    assert.throws(()=>twoLabels(observed),{code:'ERR_ASSERTION'});
  });
  const repaired=new ShippingBatchLabels(f.kernel,freshQuotes,restoredSource,{deadline_ms:15});
  twoLabels(await repaired.purchase(f.a.scope,q));assert.equal(restoredSource.calls.lookup.at(-1),original);
  assert.equal(f.source.ledger().purchases.length,2);assert.equal(restoredSource.calls.purchase.length,0);
  assert.notEqual(f.labels.packageStatus(f.a.scope,'package-a').receipt.native_label_id,f.labels.packageStatus(f.a.scope,'package-b').receipt.native_label_id);
}));
test('M08-G02-APPROVAL-CURRENT-AUTHORITY',()=>usingShipping(async f=>{
  const q=f.quote(),prepared=f.labels.prepare(f.a.scope,q),p=prepared.packages[0];
  assert.throws(()=>f.labels.approve(f.a.scope,p.package_id,{expected_digest:p.command_digest,expires_at:f.now()+60000}),/ACCESS_DENIED/);
  await assert.rejects(()=>f.labels.purchase(f.a.scope,q),/APPROVAL_REQUIRED/);assert.equal(f.source.ledger().purchases.length,0);
  f.approved(q);new Permissions(f.kernel).change(f.owner,{actor_id:'reviewer',role:'reviewer',actions:['resource.read','operation.read'],resource_ids:null,expected_revision:0});
  await assert.rejects(()=>f.labels.purchase(f.a.scope,q),/APPROVAL_AUTHORITY_CHANGED/);assert.equal(f.source.calls.purchase.length,0);
  assert.throws(()=>f.labels.packageStatus(f.b.scope,'package-a'),/SOURCE_SCOPE_MISMATCH|NOT_FOUND/);
}));
test('M08-G02-CURRENT-QUOTE-PACKAGE-FENCES',()=>usingShipping(async f=>{
  const q=f.approved();f.quoteSource.setRate({package_id:'package-a',account_id:'account-one',service:'ground',rate_id:'rate-a',revision:2,amount_minor:'650',currency:'USD',expires_at:f.now()+120000});
  const result=await f.labels.purchase(f.a.scope,q);assert.deepEqual(states(result),[['package-a','proposed'],['package-b','purchased']]);
  assert.deepEqual(result.packages[0].blocked_reasons,['RATE_CHANGED']);assert.equal(f.source.ledger().purchases.length,1);
  const updated=f.quote(),reprepared=f.labels.prepare(f.a.scope,updated).packages[0];
  f.labels.approve(f.reviewer,'package-a',{expected_digest:reprepared.command_digest,expires_at:f.now()+60000});
  twoLabels(await f.labels.purchase(f.a.scope,updated));assert.deepEqual(f.source.ledger().totals,[{currency:'USD',amount_minor:'1550'}]);
}));
test('M08-G02-EXACT-CURRENCY-AND-COMMAND-MONEY',()=>usingShipping(async f=>{
  f.quoteSource.setRate({package_id:'package-a',account_id:'account-one',service:'ground',rate_id:'rate-a',revision:2,amount_minor:'900719925474099312345678901234567890',currency:'USD',expires_at:f.now()+120000});
  f.quoteSource.setRate({package_id:'package-b',account_id:'account-one',service:'ground',rate_id:'rate-b',revision:2,amount_minor:'100',currency:'JPY',expires_at:f.now()+120000});
  const policy={...f.policy,rules:[...f.policy.rules,{...f.policy.rules[0],id:'jpy',currency:'JPY'}]},quotes=new CarrierQuotes(f.kernel,f.quoteSource,policy);
  const labels=new ShippingBatchLabels(f.kernel,quotes,f.source),q=quotes.quote(f.a.scope,{...f.request,packages:[f.request.packages[0],{...f.request.packages[1],rule_id:'jpy'}]});
  for(const p of labels.prepare(f.a.scope,q).packages)labels.approve(f.reviewer,p.package_id,{expected_digest:p.command_digest,expires_at:f.now()+60000});
  twoLabels(await labels.purchase(f.a.scope,q));
  assert.deepEqual(f.source.ledger().totals,[{currency:'JPY',amount_minor:'100'},{currency:'USD',amount_minor:'900719925474099312345678901234567890'}]);
  assert.equal(labels.packageStatus(f.a.scope,'package-a').receipt.amount_minor,'900719925474099312345678901234567890');
}));
test('M08-G02-RECONSTRUCTED-QUOTE-CANNOT-AUTHORIZE-UNSENT',()=>usingShipping(async f=>{
  const q=f.approved(),restarted=new ShippingBatchLabels(f.kernel,new CarrierQuotes(f.kernel,f.quoteSource,f.policy),f.source);
  await assert.rejects(()=>restarted.purchase(f.a.scope,q),/SNAPSHOT_INTEGRITY/);assert.equal(f.source.calls.purchase.length,0);
  const otherSourceDB=new (f.sourceDB.constructor as any)(':memory:');
  try{const other=new ShippingCarrierFixtureSource(otherSourceDB,f.sourceOptions),swapped=new ShippingBatchLabels(f.kernel,f.quotes,other);
    await assert.rejects(()=>swapped.purchase(f.a.scope,q),/SOURCE_IDENTITY_CHANGED/);assert.equal(other.calls.purchase.length,0);
  }finally{otherSourceDB.close();}
}));
test('M08-G02-UNKNOWN-NULL-LOOKUP-NEVER-REPURCHASES',()=>usingShipping(async f=>{
  const q=f.approved();f.source.setFault('purchase','package-a','before');await f.labels.purchase(f.a.scope,q);
  for(let i=0;i<3;i++)await f.labels.purchase(f.a.scope,q);
  assert.equal(f.labels.packageStatus(f.a.scope,'package-a').state,'unknown');assert.equal(f.source.calls.purchase.length,2);
  assert.equal(f.source.ledger().purchases.length,1);assert.equal(f.labels.packageStatus(f.a.scope,'package-a').retry_allowed,false);
}));
test('M08-G02-VOID-AND-REFUND-ARE-SEPARATE',()=>usingShipping(async f=>{
  await f.labels.purchase(f.a.scope,f.approved());const p=f.labels.packageStatus(f.a.scope,'package-a');
  await assert.rejects(()=>f.labels.requestVoid(f.a.scope,'package-a'),/APPROVAL_REQUIRED/);
  f.labels.approveVoid(f.reviewer,'package-a',{expected_receipt_digest:contentDigest(p.receipt),expires_at:f.now()+60000});
  f.source.setFault('void','package-a','after');await f.labels.requestVoid(f.a.scope,'package-a');
  assert.equal(f.labels.packageStatus(f.a.scope,'package-a').void_state,'unknown');await f.labels.reconcile(f.a.scope,'package-a');
  assert.equal(f.labels.packageStatus(f.a.scope,'package-a').void_state,'requested');assert.equal(f.labels.packageStatus(f.a.scope,'package-a').refund_state,'pending');
  f.source.confirmVoid(p.purchase_id,true);await f.labels.reconcile(f.a.scope,'package-a');
  assert.equal(f.labels.packageStatus(f.a.scope,'package-a').void_state,'confirmed');assert.equal(f.labels.packageStatus(f.a.scope,'package-a').refund_state,'pending');
  f.source.refund(p.purchase_id);await f.labels.reconcile(f.a.scope,'package-a');
  const end=f.labels.packageStatus(f.a.scope,'package-a');assert.equal(end.refund_state,'refunded');assert.equal(end.refund_amount_minor,'500');
  assert.equal(end.label_usable,false);await f.labels.requestVoid(f.a.scope,'package-a');assert.equal(f.source.calls.void.length,1);
}));
test('M08-G02-UNTRUSTED-RECEIPT-FAILS-CLOSED',()=>usingShipping(async f=>{
  const q=f.approved();f.source.setFault('purchase','package-a','malformed');await f.labels.purchase(f.a.scope,q);
  assert.equal(f.labels.packageStatus(f.a.scope,'package-a').state,'unknown');assert.equal(f.source.ledger().purchases.length,2);
  await f.labels.reconcile(f.a.scope,'package-a');assert.equal(f.labels.packageStatus(f.a.scope,'package-a').state,'purchased');
  const row=f.sourceDB.prepare('SELECT * FROM fixture_shipping_purchases WHERE package_id=?').get('package-a') as Row,b=JSON.parse(row.body);
  b.receipt.amount_minor='0';f.sourceDB.prepare('UPDATE fixture_shipping_purchases SET body=?,digest=? WHERE package_id=?').run(canonical(b),contentDigest(b),'package-a');
  await assert.rejects(()=>f.labels.reconcile(f.a.scope,'package-a'),/RECEIPT_MISMATCH|SOURCE_INTEGRITY/);
  assert.equal(f.labels.packageStatus(f.a.scope,'package-a').receipt.amount_minor,'500');
}));
test('M08-G02-STOPS-RESTORE-AND-REVOKED-APPROVAL',()=>usingShipping(async f=>{
  const q=f.approved();new ExecutionStops(f.kernel).set(f.owner,{action:'diagnostic.label.purchase',stopped:true,reason:'incident',expected_revision:0});
  await assert.rejects(()=>f.labels.purchase(f.a.scope,q),/EXECUTION_STOPPED/);assert.equal(f.source.calls.purchase.length,0);
  new ExecutionStops(f.kernel).set(f.owner,{action:'diagnostic.label.purchase',stopped:false,reason:'reviewed_resume',expected_revision:1});
  await assert.rejects(()=>f.labels.purchase(f.a.scope,q),/EXECUTION_REAUTHORIZATION_REQUIRED/);
  const r=f.labels.prepare(f.a.scope,f.quote());for(const p of r.packages)f.labels.approve(f.reviewer,p.package_id,{expected_digest:p.command_digest,expires_at:f.now()+60000});
  f.labels.revokeApproval(f.reviewer,'package-a');await assert.rejects(()=>f.labels.purchase(f.a.scope,f.quote()),/APPROVAL_REQUIRED/);assert.equal(f.source.calls.purchase.length,0);
}));
test('M08-G02-DURABLE-BODY-INTEGRITY-AND-SUBJECT-FENCE',()=>usingShipping(async f=>{
  const q=f.approved();const r=f.db.prepare('SELECT * FROM commerce_shipping_label_operations WHERE package_id=?').get('package-a') as Row;
  f.db.prepare('UPDATE commerce_shipping_label_operations SET body=? WHERE package_id=?').run('{"redacted":true}','package-a');
  await assert.rejects(()=>f.labels.purchase(f.a.scope,q),/SHIPPING_INTEGRITY/);assert.equal(f.source.calls.purchase.length,0);
  f.db.prepare('UPDATE commerce_shipping_label_operations SET body=?,digest=? WHERE package_id=?').run(r.body,r.digest,'package-a');
  f.db.prepare('INSERT INTO commerce_privacy_resources VALUES(?,?,?,?,?)').run(f.a.tenant,f.a.store,f.orders[0].id,'erasure-one',f.now());
  await assert.rejects(()=>f.labels.purchase(f.a.scope,q),/SUBJECT_ERASED|RESOURCE_UNAVAILABLE/);assert.equal(f.source.calls.purchase.length,0);
}));
test('CASE-M08-G05-01-LOCAL',()=>usingShipping(async f=>{
  await ready(f);const initial=await f.manifests.create(f.a.scope,manifestInput);
  assert.deepEqual(initial.packages.map((p:Row)=>[p.manifest_acknowledged,p.picked_up,p.carrier_accepted]),[[true,false,false],[true,false,false]]);
  f.source.recordEvent({manifest_id:'manifest-one',package_id:'package-a',event_id:'pickup-a',sequence:1,stage:'pickup',at:f.now()});
  f.source.recordEvent({manifest_id:'manifest-one',package_id:'package-a',event_id:'accepted-a',sequence:2,stage:'carrier_acceptance',at:f.now()});
  const end=await f.manifests.observe(f.a.scope,'manifest-one');
  assert.deepEqual(end.packages.map((p:Row)=>[p.package_id,p.picked_up,p.carrier_accepted]),[['package-a',true,true],['package-b',false,false]]);
  assert.deepEqual(end.outstanding_package_ids,['package-b']);assert.equal(end.all_carrier_accepted,false);
}));
test('CASE-M08-G05-02-LOCAL',()=>usingShipping(async f=>{
  await ready(f);await f.manifests.create(f.a.scope,manifestInput);f.advance(1000);const r=await f.manifests.observe(f.a.scope,'manifest-one');
  assert.deepEqual(r.outstanding_package_ids,['package-a','package-b']);assert.equal(r.packages.every((p:Row)=>p.shipped===false),true);
  assert.equal(f.source.ledger().events.length,0);assert.equal(f.source.ledger().manifests.length,1);
}));
test('CASE-M08-G05-03',()=>usingShipping(async f=>{
  await ready(f);
  const oracle=(r:Row)=>assert.equal(r.packages.every((p:Row)=>p.carrier_accepted===false),true);
  await mutant('../../packages/commerce/shipping-manifests.mts','carrier_accepted:false,shipped:false','carrier_accepted:true,shipped:true',async mod=>{
    const broken=new mod.ShippingManifests(f.kernel,f.packing,f.labels,f.source,{deadline_ms:15});
    const r=await broken.create(f.a.scope,manifestInput);assert.equal(r.packages.every((p:Row)=>p.carrier_accepted),true);assert.throws(()=>oracle(r),{code:'ERR_ASSERTION'});
  });
  // The independent mutant uses the real local/source ledger. Reset only this isolated fixture's manifest rows to exercise the repaired same source receipt.
  f.db.exec('DELETE FROM commerce_shipping_manifest_packages');
  const healthy=await f.manifests.create(f.a.scope,manifestInput);oracle(healthy);
  f.source.recordEvent({manifest_id:'manifest-one',package_id:'package-a',event_id:'accept-once',sequence:1,stage:'carrier_acceptance',at:f.now()});
  await f.manifests.observe(f.a.scope,'manifest-one');await f.manifests.observe(f.a.scope,'manifest-one');await f.manifests.create(f.a.scope,manifestInput);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM commerce_shipping_manifest_packages').get()!.n,2);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM commerce_shipping_manifest_events').get()!.n,1);assert.equal(f.source.ledger().manifests.length,1);
}));
test('M08-G05-CURRENT-PACKING-AND-LABEL-QUALIFICATION',()=>usingShipping(async f=>{
  await f.labels.purchase(f.a.scope,f.approved());await assert.rejects(()=>f.manifests.create(f.a.scope,manifestInput),/PACKING_UNQUALIFIED|PACKING_SESSION_NOT_FOUND/);
  f.packed();const status=f.labels.packageStatus(f.a.scope,'package-a');
  f.labels.approveVoid(f.reviewer,'package-a',{expected_receipt_digest:contentDigest(status.receipt),expires_at:f.now()+60000});await f.labels.requestVoid(f.a.scope,'package-a');
  await assert.rejects(()=>f.manifests.create(f.a.scope,manifestInput),/LABEL_UNQUALIFIED/);assert.equal(f.source.ledger().manifests.length,0);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM commerce_shipping_manifest_packages').get()!.n,0);
  await usingShipping(async changed=>{
    await ready(changed);changed.quoteSource.setAccount({account_id:'account-one',carrier_id:'carrier-one',revision:2,enabled:false,currencies:['USD','JPY'],services:['ground']});
    assert.equal(changed.labels.packageStatus(changed.a.scope,'package-a').account_current,false);
    await assert.rejects(()=>changed.manifests.create(changed.a.scope,manifestInput),/LABEL_UNQUALIFIED/);assert.equal(changed.source.calls.manifest.length,0);
    changed.quoteSource.setAccount({account_id:'account-one',carrier_id:'carrier-one',revision:3,enabled:true,currencies:['USD','JPY'],services:['ground']});
    await assert.rejects(()=>changed.manifests.create(changed.a.scope,manifestInput),/LABEL_UNQUALIFIED/);assert.equal(changed.source.calls.manifest.length,0);
    assert.equal((await changed.labels.reconcile(changed.a.scope,'package-a')).state,'purchased');
  });
  await usingShipping(async raced=>{
    await ready(raced);const dispatch=raced.source.manifest.bind(raced.source);
    // Change the independent account after the local final check, before the real source admission.
    raced.source.manifest=async command=>{raced.quoteSource.setAccount({account_id:'account-one',carrier_id:'carrier-one',revision:2,enabled:false,currencies:['USD','JPY'],services:['ground']});return dispatch(command);};
    const unknown=await raced.manifests.create(raced.a.scope,manifestInput);
    assert.equal(unknown.packages.every((p:Row)=>p.state==='unknown'&&!p.manifest_acknowledged),true);
    assert.equal(raced.source.ledger().manifests.length,0);assert.equal(raced.source.calls.manifest.length,1);
    await raced.manifests.observe(raced.a.scope,'manifest-one');assert.equal(raced.source.calls.manifest.length,1);
    assert.equal((await raced.labels.reconcile(raced.a.scope,'package-a')).state,'purchased');
  });
}));
test('M08-G05-UNKNOWN-MANIFEST-USES-ORIGINAL-IDENTITY',()=>usingShipping(async f=>{
  await ready(f);f.source.setFault('manifest','manifest-one','after');const unknown=await f.manifests.create(f.a.scope,manifestInput);
  assert.equal(unknown.packages.every((p:Row)=>p.state==='unknown'),true);
  assert.throws(()=>f.packing.cancel(f.a.scope,{session_id:'pack-a',expected_revision:f.packing.read(f.a.scope,'pack-a').revision}),/PACKAGE_ALREADY_MANIFESTED/);
  const restarted=new ShippingManifests(f.kernel,f.packing,f.labels,new ShippingCarrierFixtureSource(f.sourceDB,f.sourceOptions));
  const repaired=await restarted.create(f.a.scope,manifestInput);assert.equal(repaired.packages.every((p:Row)=>p.manifest_acknowledged),true);
  assert.equal(f.source.calls.manifest.length,1);assert.equal(f.source.ledger().manifests.length,1);
  await assert.rejects(()=>restarted.create(f.a.scope,{manifest_id:'replacement-key',package_ids:['package-a']}),/PACKAGE_ALREADY_MANIFESTED/);
}));
test('M08-G05-EVENT-IDENTITY-AND-STAGE-INTEGRITY',()=>usingShipping(async f=>{
  await ready(f);await f.manifests.create(f.a.scope,manifestInput);
  const event={manifest_id:'manifest-one',package_id:'package-a',event_id:'event-a',sequence:1,stage:'pickup',at:f.now()};
  f.source.recordEvent(event);f.source.recordEvent(event);
  assert.throws(()=>f.source.recordEvent({...event,stage:'carrier_acceptance'}),/EVENT_CONFLICT/);
  assert.throws(()=>f.source.recordEvent({...event,event_id:'event-b',sequence:0}),/INVALID_INPUT/);
  const r=await f.manifests.observe(f.a.scope,'manifest-one');assert.equal(r.packages[0].picked_up,true);assert.equal(r.packages[0].carrier_accepted,false);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM commerce_shipping_manifest_events').get()!.n,1);
}));
test('M08-G05-TENANT-INPUT-AND-MEMBERSHIP-FENCES',()=>usingShipping(async f=>{
  await ready(f);await assert.rejects(()=>f.manifests.create(f.b.scope,manifestInput),/SOURCE_SCOPE_MISMATCH|NOT_FOUND/);
  await assert.rejects(()=>f.manifests.create(f.a.scope,{...manifestInput,packed:true}),/INVALID_INPUT/);
  await assert.rejects(()=>f.manifests.create(f.a.scope,{...manifestInput,package_ids:['package-a','package-a']}),/INVALID_MANIFEST/);
  await f.manifests.create(f.a.scope,manifestInput);
  await assert.rejects(()=>f.manifests.create(f.a.scope,{manifest_id:'manifest-one',package_ids:['package-a']}),/MANIFEST_MEMBERSHIP_CHANGED/);
  assert.equal(f.source.ledger().manifests.length,1);
}));
test('M08-G05-SOURCE-INTEGRITY-AND-SUBJECT-PRIVACY',()=>usingShipping(async f=>{
  await ready(f);await f.manifests.create(f.a.scope,manifestInput);
  const row=f.db.prepare('SELECT * FROM commerce_shipping_manifest_packages WHERE package_id=?').get('package-a') as Row;
  const b=JSON.parse(row.body);b.command.native_label_id='fabricated-label';
  f.db.prepare('UPDATE commerce_shipping_manifest_packages SET body=? WHERE package_id=?').run(canonical(b),'package-a');
  await assert.rejects(()=>f.manifests.observe(f.a.scope,'manifest-one'),/SHIPPING_INTEGRITY/);
  f.db.prepare('UPDATE commerce_shipping_manifest_packages SET body=?,digest=? WHERE package_id=?').run(row.body,row.digest,'package-a');
  const otherDB=new (f.sourceDB.constructor as any)(':memory:');
  try{const other=new ShippingCarrierFixtureSource(otherDB,f.sourceOptions),service=new ShippingManifests(f.kernel,f.packing,f.labels,other);
    await assert.rejects(()=>service.observe(f.a.scope,'manifest-one'),/SOURCE_IDENTITY_CHANGED/);
  }finally{otherDB.close();}
  f.source.recordEvent({manifest_id:'manifest-one',package_id:'package-a',event_id:'privacy-pickup',sequence:1,stage:'pickup',at:f.now()});
  await f.manifests.observe(f.a.scope,'manifest-one');
  const privacy=new PrivacyLifecycle(f.kernel),before=privacy.export(f.owner,'customer-a');
  const tables=['commerce_shipping_label_operations','commerce_shipping_label_approvals','commerce_shipping_manifest_packages','commerce_shipping_manifest_events'];
  for(const table of tables){assert.equal(before.shipping_records[table].length,1);assert.equal(before.shipping_records[table][0].resource_id,f.orders[0].id);}
  const purchase=f.labels.packageStatus(f.a.scope,'package-a');
  const imported=f.db.prepare('SELECT * FROM commerce_shipping_label_operations WHERE package_id=?').get('package-a') as Row;
  const importedBody={...JSON.parse(imported.body),redacted:true,private_note:'fixture private note must be removed'};
  f.db.prepare('UPDATE commerce_shipping_label_operations SET body=?,digest=? WHERE package_id=?').run(canonical(importedBody),contentDigest(importedBody),'package-a');
  privacy.erase(f.owner,'customer-a');
  for(const table of tables){const row=f.db.prepare(`SELECT * FROM ${table} WHERE resource_id=?`).get(f.orders[0].id) as Row;
    const body=JSON.parse(row.body);assert.equal(body.redacted,true);assert.match(body.original_digest,/^[a-f0-9]{64}$/);assert.equal(row.package_id,'package-a');
    assert.equal(contentDigest(body),row.digest);if(table==='commerce_shipping_label_approvals')assert.equal(row.revoked,1);
  }
  const retained=f.db.prepare('SELECT * FROM commerce_shipping_label_operations WHERE package_id=?').get('package-a') as Row;
  assert.equal(retained.purchase_id,purchase.purchase_id);assert.equal(JSON.parse(retained.body).amount_minor,'500');
  assert.equal(JSON.parse(retained.body).currency,'USD');assert.equal(JSON.parse(retained.body).native_charge_id,purchase.receipt.native_charge_id);
  for(const key of ['private_note','command','native_tracking_ref'])assert.equal(Object.hasOwn(JSON.parse(retained.body),key),false);
  assert.throws(()=>f.labels.packageStatus(f.a.scope,'package-a'),/SUBJECT_ERASED/);
  assert.equal(f.labels.packageStatus(f.a.scope,'package-b').state,'purchased');assert.equal(f.source.ledger().purchases.length,2);
}));
