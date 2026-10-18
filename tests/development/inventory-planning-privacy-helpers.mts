import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { CommerceKernel } from '../../packages/commerce/kernel.mts';
import { PrivacyLifecycle, eraseSelected } from '../../packages/commerce/privacy-lifecycle.mts';
import { canonical, contentDigest } from '../../packages/commerce/configuration-values.mts';
import { assertRecoveryEgress } from '../../packages/commerce/data-guards.mts';
import { exportMerchant, exportMerchantSuppression, importMerchant, merchantSnapshotDigest } from '../../packages/commerce/merchant-portability.mts';
import { revokeInventoryPlanningForRestore } from '../../packages/commerce/inventory-planning-privacy.mts';
import { usingDemand, populateForecastPrivacy } from './demand-planning-helpers.mts';
import { usingProcurement, populateProcurementPrivacy } from './procurement-planning-helpers.mts';
import { usingProcurementInventory, populateProcurementInventoryPrivacy } from './procurement-inventory-helpers.mts';

// Independent table obligations fixed before the shared privacy implementation.
export const INVENTORY_PLANNING_TABLES = [
  'commerce_bom_versions','commerce_demand_observations','commerce_demand_snapshots',
  'commerce_forecast_backtests','commerce_forecast_reviews','commerce_inventory_forecasts',
  'commerce_material_items','commerce_procurement_approvals','commerce_procurement_budgets',
  'commerce_procurement_reservations','commerce_procurement_sends','commerce_procurement_suppliers',
  'commerce_production_orders','commerce_purchase_order_versions','commerce_purchase_orders',
  'commerce_purchase_receipts','commerce_replenishment_drafts','commerce_stock_approvals',
  'commerce_stock_operations','commerce_supplier_receipt_events',
];
const GROUPS = [
  {name:'forecast',using:usingDemand,populate:populateForecastPrivacy,count:5,unknown:false},
  {name:'procurement',using:usingProcurement,populate:populateProcurementPrivacy,count:8,unknown:true},
  {name:'stock',using:usingProcurementInventory,populate:populateProcurementInventoryPrivacy,count:7,unknown:true},
];
const PRIVATE_COPY = 'M11_UNEXPECTED_PRIVATE_RESTORED_COPY';
const authorityTables = ['commerce_forecast_reviews','commerce_procurement_approvals','commerce_stock_approvals'];
const owner = (f:any,x:any) => x.owner_scope ?? f.owner?.scope ?? f.owner;
function keyColumns(db:any,table:string) {
  assert.ok(/^commerce_[a-z_]+$/.test(table));
  return db.prepare('PRAGMA table_info('+table+')').all().filter((column:any)=>column.pk).sort((a:any,b:any)=>a.pk-b.pk).map((column:any)=>column.name);
}
function rows(db:any,table:string,s:any) {
  assert.ok(/^commerce_[a-z_]+$/.test(table));
  return db.prepare('SELECT * FROM '+table+' WHERE tenant_id=? AND store_id=? ORDER BY '+keyColumns(db,table).join(',')).all(s.tenant_id,s.store_id);
}
function sourceCopies(f:any) {
  const seen=new Set<any>(),copies:any[]=[];
  for(const [name,db] of Object.entries(f) as any)if(db instanceof DatabaseSync && db!==f.db && !seen.has(db)) {
    seen.add(db);
    const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    copies.push({name,sha256:createHash('sha256').update(JSON.stringify(tables.map((table:any)=>({name:table.name,rows:db.prepare('SELECT * FROM '+table.name).all()})))).digest('hex')});
  }
  assert.ok(copies.length,'Expose actual separate native source databases');return copies;
}
function populated(f:any,x:any,group:any) {
  const s=f.kernel.require(owner(f,x));
  assert.equal(x.tables.length,group.count);assert.deepEqual(x.subject_tables,[]);
  assert.ok(x.tables.every((table:string)=>INVENTORY_PLANNING_TABLES.includes(table)));
  for(const table of x.tables) {
    const records=rows(f.db,table,s);assert.ok(records.length,table+' populated through its real service');
    for(const row of records)assert.equal(Object.hasOwn(row,'customer_id'),false,table+' does not invent a customer identity');
  }
  const resource=f.db.prepare('SELECT customer_id,kind FROM commerce_resources WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,x.resource_id);
  assert.equal(resource.customer_id,null);assert.equal(resource.kind,'catalog');
  if(group.unknown)assert.ok(x.unknown_operations.length,group.name+' retains an original uncertain native operation');
  return s;
}
function identities(db:any,s:any,x:any) {
  return Object.fromEntries(x.tables.map((table:string)=>[table,rows(db,table,s).map((row:any)=>keyColumns(db,table).map((key:string)=>[key,row[key]]))]));
}
function unknowns(f:any,s:any,x:any) {
  return (x.unknown_operations??[]).map((operation:any)=>{
    const row=rows(f.db,operation.table,s).find((row:any)=>(row.id??row.operation_id)===operation.id);
    assert.ok(row);const body=JSON.parse(row.body);
    assert.equal(row.state??body.state,'unknown');
    const id=operation.operation_id??body.operation_id??body.command?.operation_id??row.id;
    assert.ok(JSON.stringify(row).includes(id));
    return {table:operation.table,keys:keyColumns(f.db,operation.table).map((key:string)=>[key,row[key]]),operation_id:id,source_identity:operation.source_identity??null};
  });
}
function assertUnknowns(db:any,s:any,originals:any[]) {
  for(const original of originals) {
    const row=rows(db,original.table,s).find((row:any)=>original.keys.every(([key,value]:any)=>row[key]===value));
    assert.ok(row,'Original uncertain operation cannot be deleted');
    assert.equal(row.state??JSON.parse(row.body).state,'unknown','Privacy cannot resolve a native outcome');
    assert.ok(JSON.stringify(row).includes(original.operation_id),'Retain the original operation identity');
    if(original.source_identity)assert.ok(JSON.stringify(row).includes(original.source_identity),'Retain the original native source identity');
  }
}
function assertRevoked(db:any,s:any) {
  for(const table of authorityTables)for(const row of rows(db,table,s))
    assert.equal(row.state,'revoked',table+' cannot retain authority without an erasure tombstone');
}
function copied(value:any):any {
  if(Array.isArray(value))return value.map(copied);
  if(value&&typeof value==='object')return {...Object.fromEntries(Object.entries(value).map(([key,item])=>[key,copied(item)])),unexpected_private_copy:PRIVATE_COPY};
  return value;
}
function injectCopies(f:any,s:any,x:any) {
  for(const table of x.tables)for(const row of rows(f.db,table,s)) {
    const body=copied(JSON.parse(row.body)),keys=keyColumns(f.db,table);
    f.db.prepare('UPDATE '+table+' SET body=?,digest=? WHERE '+keys.map((key:string)=>key+'=?').join(' AND '))
      .run(canonical(body),contentDigest(body),...keys.map((key:string)=>row[key]));
  }
}
function assertAllowlisted(db:any,s:any,x:any) {
  for(const table of x.tables)for(const row of rows(db,table,s)) {
    assert.equal(row.body.includes(PRIVATE_COPY),false,table+' removes arbitrary nested restored copies');
    assert.equal(row.digest,contentDigest(JSON.parse(row.body)),table+' retains an exact content digest');
  }
}
function subject(f:any,group:any) {return f.seed(f.a.scope,'M11_PRIVATE_UNRELATED_ORDER','M11-PRIVACY-'+group.name).customer_id;}

/** Extends the retained whole privacy case; no additional registered case. */
export async function inventoryPlanningPrivacy() {
  for(const group of GROUPS)await group.using(async(f:any)=>{
    const x=await group.populate(f),s=populated(f,x,group),customer=subject(f,group),privacy=new PrivacyLifecycle(f.kernel);
    const before=identities(f.db,s,x),source=sourceCopies(f),originals=unknowns(f,s,x);
    const exported=privacy.export(owner(f,x),customer);
    for(const table of x.tables)assert.deepEqual(exported.inventory_planning_records[table],[],table+' is merchant business data, excluded from a customer export');
    assert.equal(JSON.stringify(exported.inventory_planning_records).includes(f.kernel.require(owner(f,x)).token_hash),false);
    assert.equal(privacy.erase(owner(f,x),customer).status,'logically_erased');
    assert.deepEqual(identities(f.db,s,x),before,'Keep original merchant records');assertUnknowns(f.db,s,originals);
    injectCopies(f,s,x);
    f.kernel.transaction(()=>eraseSelected(f.kernel,s,[],exported.subject_ref,f.now()));
    assertAllowlisted(f.db,s,x);assert.deepEqual(identities(f.db,s,x),before);assertUnknowns(f.db,s,originals);
    f.kernel.transaction(()=>eraseSelected(f.kernel,s,[],exported.subject_ref,f.now()));
    assertAllowlisted(f.db,s,x);assertUnknowns(f.db,s,originals);
    assert.deepEqual(sourceCopies(f),source,'Erasure does not dispatch effects or erase separate native history');
  });
}
function importCopy(f:any,s:any,snapshot:any,suppression:any,check:(db:any,k:CommerceKernel)=>void) {
  const db=new DatabaseSync(':memory:');try {
    const k=new CommerceKernel(db,f.now);k.provisionStore(s.tenant_id,s.store_id);k.provisionMember(s.tenant_id,s.store_id,'m11_import_owner','owner');
    const scope=k.authenticate(k.issueSession(s.tenant_id,s.store_id,'m11_import_owner'));
    const result=importMerchant(k,scope,snapshot,snapshot.digest,{suppression,suppression_sha256:merchantSnapshotDigest(suppression)});
    assert.equal(result.mode,'quarantine');assert.equal(result.live_activation_supported,false);
    assert.throws(()=>assertRecoveryEgress(k),/RESTORE_EGRESS_BLOCKED/);check(db,k);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{db.close();}
}
export async function inventoryPlanningRestore() {
  for(const group of GROUPS)await group.using(async(f:any)=>{
    const x=await group.populate(f),s=populated(f,x,group),customer=subject(f,group),scope=owner(f,x);
    const originalRows=identities(f.db,s,x),source=sourceCopies(f),originals=unknowns(f,s,x);
    injectCopies(f,s,x);
    const snapshot=exportMerchant(f.kernel,scope,{snapshot_id:'m11_'+group.name+'_before'});
    importCopy(f,s,snapshot,exportMerchantSuppression(f.kernel,scope),(db,k)=>{
      assertRevoked(db,s);assertAllowlisted(db,s,x);assertUnknowns(db,s,originals);assert.deepEqual(identities(db,s,x),originalRows);
      // The same composition also supports global recovery without a subject list.
      revokeInventoryPlanningForRestore(k);assertRevoked(db,s);assertUnknowns(db,s,originals);
    });
    f.advance(1);new PrivacyLifecycle(f.kernel).erase(scope,customer);
    importCopy(f,s,snapshot,exportMerchantSuppression(f.kernel,scope),db=>{
      assertRevoked(db,s);assertAllowlisted(db,s,x);assertUnknowns(db,s,originals);assert.deepEqual(identities(db,s,x),originalRows);
    });
    assert.deepEqual(sourceCopies(f),source,'Restore never replays supplier or physical stock effects');
  });
}
export async function inventoryPlanningUninstall() {
  for(const group of GROUPS)await group.using(async(f:any)=>{
    const x=await group.populate(f),s=populated(f,x,group),source=sourceCopies(f),originals=unknowns(f,s,x),before=identities(f.db,s,x);
    // No customer resource or tombstone is needed to revoke merchant authority.
    injectCopies(f,s,x);
    const result=new PrivacyLifecycle(f.kernel).uninstall(owner(f,x));
    assert.equal(result.status,'disconnected');assert.equal(result.physical_deletion,false);
    assertRevoked(f.db,s);assertAllowlisted(f.db,s,x);assertUnknowns(f.db,s,originals);assert.deepEqual(identities(f.db,s,x),before);
    assert.throws(()=>f.kernel.require(owner(f,x)),/ACCESS_DENIED/);assert.deepEqual(sourceCopies(f),source);
  });
}
