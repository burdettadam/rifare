import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { CommerceKernel } from '../../packages/commerce/kernel.mts';
import { PrivacyLifecycle, eraseSelected } from '../../packages/commerce/privacy-lifecycle.mts';
import { canonical, contentDigest } from '../../packages/commerce/configuration-values.mts';
import { assertRecoveryEgress } from '../../packages/commerce/data-guards.mts';
import { exportMerchant, exportMerchantSuppression, importMerchant, merchantSnapshotDigest } from '../../packages/commerce/merchant-portability.mts';
import { revokeEcosystemForRestore } from '../../packages/commerce/ecosystem-privacy.mts';
import { usingAgency, populateAgencyPrivacy } from './agency-operations-helpers.mts';
import { usingExtensions, populateExtensionPrivacy } from './extensions-helpers.mts';

// Independent new-table obligations fixed from the author interface before the
// shared implementation; the earlier 254-table projection is independently frozen.
export const ECOSYSTEM_TABLES = [
  'commerce_agency_grants','commerce_extension_artifacts','commerce_extension_retirements',
  'commerce_extension_reviews','commerce_extension_transitions','commerce_shared_templates',
  'commerce_template_decisions','commerce_template_offers',
];
const AUTHORITY_TABLES = [
  'commerce_agency_grants','commerce_extension_retirements','commerce_extension_reviews',
  'commerce_extension_transitions','commerce_template_decisions','commerce_template_offers',
];
const GROUPS = [
  {name:'agency',using:usingAgency,populate:populateAgencyPrivacy},
  {name:'extensions',using:usingExtensions,populate:populateExtensionPrivacy},
];
const PRIVATE_COPY='M12_UNEXPECTED_RESTORED_CUSTOMER_COPY';
function keys(db:any,table:string) {
  assert.ok(ECOSYSTEM_TABLES.includes(table));
  return db.prepare('PRAGMA table_info('+table+')').all().filter((c:any)=>c.pk).sort((a:any,b:any)=>a.pk-b.pk).map((c:any)=>c.name);
}
function rows(db:any,table:string,s:any) {
  return db.prepare('SELECT * FROM '+table+' WHERE tenant_id=? AND store_id=? ORDER BY '+keys(db,table).join(',')).all(s.tenant_id,s.store_id);
}
function originalRows(db:any,s:any,x:any) {
  return Object.fromEntries(x.tables.map((table:string)=>[table,rows(db,table,s)]));
}
function otherStores(db:any,s:any) {
  return Object.fromEntries(ECOSYSTEM_TABLES.map(table=>[table,db.prepare('SELECT * FROM '+table+' WHERE NOT (tenant_id=? AND store_id=?) ORDER BY '+keys(db,table).join(',')).all(s.tenant_id,s.store_id)]));
}
function identities(db:any,s:any,x:any) {
  return Object.fromEntries(x.tables.map((table:string)=>[table,rows(db,table,s).map((row:any)=>keys(db,table).map((key:string)=>[key,row[key]]))]));
}
function sourceCopies(f:any) {
  const copies:any[]=[],seen=new Set<any>();
  for(const [name,db] of Object.entries(f) as any)if(db instanceof DatabaseSync&&db!==f.kernel.db&&!seen.has(db)) {
    seen.add(db);
    const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    copies.push({name,sha256:createHash('sha256').update(JSON.stringify(tables.map((t:any)=>({name:t.name,rows:db.prepare('SELECT * FROM '+t.name).all()})))).digest('hex')});
  }
  return copies;
}
function populated(f:any,x:any) {
  const s=f.kernel.require(x.owner_scope);
  assert.equal(x.tables.length,4);assert.deepEqual(x.subject_tables,[]);
  assert.ok(x.tables.every((table:string)=>ECOSYSTEM_TABLES.includes(table)));
  for(const table of x.tables) {
    const records=rows(f.kernel.db,table,s);assert.ok(records.length,table+' populated through real services');
    for(const row of records)assert.equal(Object.hasOwn(row,'customer_id'),false,table+' does not invent customer ownership');
  }
  return s;
}
function seedCustomer(f:any,x:any,group:any) {
  const customer='m12_privacy_'+group.name;
  f.kernel.ingest(x.owner_scope,{kind:'customer',source_system:'synthetic',external_id:customer,source_version:1,
    source_updated_at:f.kernel.clock(),customer_id:customer,payload:{name:'M12_PRIVATE_UNRELATED_CUSTOMER',email:customer+'@example.invalid'}});
  return customer;
}
function copied(value:any):any {
  if(Array.isArray(value))return value.map(copied);
  if(value&&typeof value==='object')return {...Object.fromEntries(Object.entries(value).map(([k,v])=>[k,copied(v)])),unexpected_private_copy:PRIVATE_COPY};
  return value;
}
function injectCopies(db:any,s:any,x:any) {
  for(const table of x.tables)for(const row of rows(db,table,s)) {
    const body=copied(JSON.parse(row.body)),columns=keys(db,table);
    // A permitted scalar field cannot become a container for restored private
    // material. Each new table exercises this independently of extra-key cleanup.
    const field=Object.keys(body).find(key=>key!=='unexpected_private_copy'&&typeof body[key]==='string');
    assert.ok(field,table+' has a typed scalar business field');
    body[field!]={unexpected_private_copy:PRIVATE_COPY,nested:[PRIVATE_COPY]};
    db.prepare('UPDATE '+table+' SET body=?,digest=? WHERE '+columns.map((key:string)=>key+'=?').join(' AND '))
      .run(canonical(body),contentDigest(body),...columns.map((key:string)=>row[key]));
  }
}
function assertMinimized(db:any,s:any,x:any) {
  for(const table of x.tables)for(const row of rows(db,table,s)) {
    assert.equal(row.body.includes(PRIVATE_COPY),false,table+' strips arbitrary nested/scalar copies');
    assert.equal(row.digest,contentDigest(JSON.parse(row.body)),table+' retains exact minimized content digest');
  }
}
function assertRevoked(db:any,s:any,x:any) {
  for(const table of x.tables.filter((table:string)=>AUTHORITY_TABLES.includes(table)))for(const row of rows(db,table,s))
    assert.equal(row.state,'revoked',table+' cannot retain authority without a subject tombstone');
  if(x.agency_actor_id) {
    const member=db.prepare('SELECT active FROM commerce_members WHERE tenant_id=? AND store_id=? AND actor_id=?').get(s.tenant_id,s.store_id,x.agency_actor_id);
    if(member)assert.equal(member.active,0);
    const sessions=db.prepare('SELECT revoked FROM commerce_sessions WHERE tenant_id=? AND store_id=? AND actor_id=?').all(s.tenant_id,s.store_id,x.agency_actor_id);
    for(const session of sessions)assert.equal(session.revoked,1);
  }
  for(const id of x.approval_ids??[]) {
    const approval=db.prepare('SELECT revoked FROM commerce_skill_approvals WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,id);
    if(approval)assert.equal(approval.revoked,1,'Restored extension reviews cannot authorize canonical installation');
  }
}

/** Extends the retained privacy case, without registering extra native cases. */
export async function ecosystemPrivacy() {
  for(const group of GROUPS)await group.using(async(f:any)=>{
    const x=await group.populate(f),s=populated(f,x),customer=seedCustomer(f,x,group),db=f.kernel.db,privacy=new PrivacyLifecycle(f.kernel);
    const before=originalRows(db,s,x),ids=identities(db,s,x),source=sourceCopies(f),other=otherStores(db,s);
    const exported=privacy.export(x.owner_scope,customer);
    for(const table of x.tables)assert.deepEqual(exported.ecosystem_records[table],[],table+' excluded from unrelated customer export');
    assert.equal(JSON.stringify(exported.ecosystem_records).includes(f.kernel.require(x.owner_scope).token_hash),false);
    assert.equal(privacy.erase(x.owner_scope,customer).status,'logically_erased');
    assert.deepEqual(originalRows(db,s,x),before,'Unrelated customer erasure retains valid merchant history');
    injectCopies(db,s,x);
    f.kernel.transaction(()=>eraseSelected(f.kernel,s,[],exported.subject_ref,f.kernel.clock()));
    assertMinimized(db,s,x);assert.deepEqual(identities(db,s,x),ids);
    f.kernel.transaction(()=>eraseSelected(f.kernel,s,[],exported.subject_ref,f.kernel.clock()));
    assertMinimized(db,s,x);assert.deepEqual(identities(db,s,x),ids);
    assert.deepEqual(sourceCopies(f),source,'Minimization dispatches no source effects');
    assert.deepEqual(otherStores(db,s),other,'Scoped erasure preserves every other store');
  });
}
function importCopy(f:any,s:any,snapshot:any,suppression:any,check:(db:any,k:CommerceKernel)=>void) {
  const db=new DatabaseSync(':memory:');try {
    const k=new CommerceKernel(db,f.kernel.clock);k.provisionStore(s.tenant_id,s.store_id);k.provisionMember(s.tenant_id,s.store_id,'m12_import_owner','owner');
    const scope=k.authenticate(k.issueSession(s.tenant_id,s.store_id,'m12_import_owner'));
    const result=importMerchant(k,scope,snapshot,snapshot.digest,{suppression,suppression_sha256:merchantSnapshotDigest(suppression)});
    assert.equal(result.mode,'quarantine');assert.equal(result.live_activation_supported,false);
    assert.throws(()=>assertRecoveryEgress(k),/RESTORE_EGRESS_BLOCKED/);check(db,k);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{db.close();}
}
export async function ecosystemRestore() {
  for(const group of GROUPS)await group.using(async(f:any)=>{
    const x=await group.populate(f),s=populated(f,x),customer=seedCustomer(f,x,group),db=f.kernel.db,ids=identities(db,s,x),source=sourceCopies(f);
    injectCopies(db,s,x);
    const snapshot=exportMerchant(f.kernel,x.owner_scope,{snapshot_id:'m12_'+group.name+'_before'});
    importCopy(f,s,snapshot,exportMerchantSuppression(f.kernel,x.owner_scope),(restored,k)=>{
      assertRevoked(restored,s,x);assertMinimized(restored,s,x);assert.deepEqual(identities(restored,s,x),ids);
      revokeEcosystemForRestore(k);assertRevoked(restored,s,x);assertMinimized(restored,s,x);
    });
    new PrivacyLifecycle(f.kernel).erase(x.owner_scope,customer);
    importCopy(f,s,snapshot,exportMerchantSuppression(f.kernel,x.owner_scope),restored=>{
      assertRevoked(restored,s,x);assertMinimized(restored,s,x);assert.deepEqual(identities(restored,s,x),ids);
    });
    assert.deepEqual(sourceCopies(f),source,'Import and restore do not replay original native effects');
  });
}
export async function ecosystemUninstall() {
  for(const group of GROUPS)await group.using(async(f:any)=>{
    const x=await group.populate(f),s=populated(f,x),db=f.kernel.db,ids=identities(db,s,x),source=sourceCopies(f),other=otherStores(db,s);
    injectCopies(db,s,x);
    const result=new PrivacyLifecycle(f.kernel).uninstall(x.owner_scope);
    assert.equal(result.status,'disconnected');assert.equal(result.physical_deletion,false);
    assertRevoked(db,s,x);assertMinimized(db,s,x);assert.deepEqual(identities(db,s,x),ids);
    assert.throws(()=>f.kernel.require(x.owner_scope),/ACCESS_DENIED/);
    if(x.agency_scope)assert.throws(()=>f.kernel.require(x.agency_scope),/ACCESS_DENIED/);
    assert.deepEqual(sourceCopies(f),source);
    assert.deepEqual(otherStores(db,s),other,'Scoped uninstall preserves every other store');
  });
}
