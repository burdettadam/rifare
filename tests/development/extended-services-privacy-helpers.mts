import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { CommerceKernel } from '../../packages/commerce/kernel.mts';
import { PrivacyLifecycle, eraseSelected } from '../../packages/commerce/privacy-lifecycle.mts';
import { canonical, contentDigest } from '../../packages/commerce/configuration-values.mts';
import { assertRecoveryEgress } from '../../packages/commerce/data-guards.mts';
import { exportMerchant, exportMerchantSuppression, importMerchant, merchantSnapshotDigest } from '../../packages/commerce/merchant-portability.mts';
import { usingPartnerWarehouse, populatePartnerPrivacy } from './partner-services-helpers.mts';
import { usingClaims, populateClaimsPrivacy } from './claims-helpers.mts';
import { usingTrials, populateTrialPrivacy } from './trial-payments-helpers.mts';

// Independently assigned table obligations, fixed before shared privacy wiring.
export const EXTENDED_SERVICE_TABLES = [
  'commerce_claim_approvals','commerce_claim_observations','commerce_claim_submissions',
  'commerce_delivery_trials','commerce_dispute_packets','commerce_duty_assessments',
  'commerce_hsa_fsa_eligibility','commerce_international_handoffs','commerce_network_alert_actions',
  'commerce_network_alerts','commerce_partner_approvals','commerce_partner_configurations',
  'commerce_protection_confirmations','commerce_protection_operations','commerce_protection_proposals',
  'commerce_reverse_hub_routes','commerce_shipping_claims','commerce_trial_consents','commerce_trial_events',
  'commerce_trial_term_approvals','commerce_trial_terms','commerce_warranty_claims',
  'commerce_warranty_entitlements','commerce_warranty_registrations','commerce_warranty_terms',
];
const GROUPS = [
  {name:'partners',using:usingPartnerWarehouse,populate:populatePartnerPrivacy,count:11,subjects:9},
  {name:'claims',using:usingClaims,populate:populateClaimsPrivacy,count:9,subjects:8},
  {name:'trials',using:usingTrials,populate:populateTrialPrivacy,count:5,subjects:3},
];
const PRIVATE_COPY = 'M10_UNEXPECTED_PRIVATE_RESTORED_COPY';
const owner = (f:any) => f.owner.scope ?? f.owner;
function scope(f:any) {return f.kernel.require(owner(f));}
function rows(db:any,table:string,s:any) {
  assert.ok(/^commerce_[a-z_]+$/.test(table));
  return db.prepare(`SELECT * FROM ${table} WHERE tenant_id=? AND store_id=?`).all(s.tenant_id,s.store_id);
}
function keyColumns(db:any,table:string) {
  return db.prepare('PRAGMA table_info('+table+')').all().filter((column:any)=>column.pk).sort((a:any,b:any)=>a.pk-b.pk).map((column:any)=>column.name);
}
function sourceCopies(f:any) {
  const seen=new Set<any>(),copies:any[]=[];
  for(const [name,db] of Object.entries(f) as any)if(db instanceof DatabaseSync && db!==f.db && !seen.has(db)) {
    seen.add(db);
    const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    copies.push({name,sha256:createHash('sha256').update(JSON.stringify(tables.map((table:any)=>({name:table.name,rows:db.prepare('SELECT * FROM '+table.name).all()})))).digest('hex')});
  }
  assert.ok(copies.length,'The fixture must expose an actual separate native source database');return copies;
}
function populated(f:any,x:any,group:any) {
  const s=scope(f);
  assert.equal(x.tables.length,group.count);assert.equal(x.subject_tables.length,group.subjects);
  assert.ok(x.tables.every((table:string)=>EXTENDED_SERVICE_TABLES.includes(table)));
  for(const table of x.tables)assert.ok(rows(f.db,table,s).length,table+' populated through its actual service');
  assert.ok(x.unknown_operations.length,group.name+' keeps an original uncertain native operation');
  return s;
}
function assertMinimized(db:any,s:any,x:any,hash:string) {
  const pseudonym='erased_'+hash.slice(0,32);
  for(const table of x.subject_tables) {
    const selected=rows(db,table,s).filter((row:any)=>row.resource_id===x.resource_id||row.subject_hash===hash);
    assert.ok(selected.length,table+' retains a minimized original record');
    for(const row of selected) {
      const body=JSON.parse(row.body);assert.equal(body.redacted,true,table);
      assert.equal(row.body.includes(PRIVATE_COPY),false,table+' discards arbitrary restored copies');
      assert.equal(row.body.includes(x.customer_id),false,table+' removes the original customer');
      if(Object.hasOwn(row,'customer_id'))assert.equal(row.customer_id,pseudonym,table);
      if(Object.hasOwn(row,'revoked'))assert.equal(row.revoked,1,table+' cannot retain execution authority');
      assert.equal(contentDigest(body),row.digest,table+' minimized digest');
    }
  }
}
function originalUnknowns(f:any,x:any,s:any) {
  return x.unknown_operations.map((operation:any)=>{
    const candidates=rows(f.db,operation.table,s),row=candidates.find((row:any)=>row.id===operation.id||row.operation_id===operation.id);
    assert.ok(row,operation.table+' original operation exists');
    const body=JSON.parse(row.body??row.command),state=row.state??body.state;
    assert.equal(state,'unknown',operation.table+' uncertainty is explicit');
    return {table:operation.table,keys:keyColumns(f.db,operation.table).map((key:string)=>[key,row[key]]),state,
      id:operation.operation_id??body.operation_id??body.original_operation_id??body.command?.operation_id??row.operation_id??row.id,
      source_identity:operation.source_identity??body.source_identity??body.command?.source_identity??row.source_identity??null};
  });
}
function assertOriginalUnknowns(db:any,s:any,unknowns:any[]) {
  for(const original of unknowns) {
    const row=rows(db,original.table,s).find((row:any)=>original.keys.every(([key,value]:any)=>row[key]===value));
    assert.ok(row,'Keep the original unknown operation row');const body=JSON.parse(row.body??row.command);
    assert.equal(row.state??body.state,original.state,'Erasure and restore cannot resolve an unknown outcome');
    assert.ok(JSON.stringify(row).includes(original.id),'Retain the original operation ID');
    if(original.source_identity)assert.ok(JSON.stringify(row).includes(original.source_identity),'Retain the original source identity');
  }
}
function assertRevoked(db:any,s:any) {
  for(const row of rows(db,'commerce_partner_configurations',s))assert.equal(row.enabled,0);
  for(const row of rows(db,'commerce_partner_approvals',s))assert.equal(row.state,'revoked');
  for(const row of rows(db,'commerce_claim_approvals',s))assert.equal(row.state,'revoked','Claim approvals are revoked without erasure tombstones');
  for(const table of ['commerce_trial_term_approvals','commerce_trial_consents'])
    for(const row of rows(db,table,s))assert.equal(row.revoked,1,table+' is revoked without requiring an erasure tombstone');
  for(const row of rows(db,'commerce_protection_confirmations',s))assert.notEqual(row.state,'confirmed');
}
function repeatHashOnly(f:any,x:any,s:any,hash:string) {
  for(const table of x.subject_tables)for(const row of rows(f.db,table,s).filter((row:any)=>row.resource_id===x.resource_id||row.subject_hash===hash)) {
    const body={...JSON.parse(row.body),unexpected_private_copy:PRIVATE_COPY},keys=keyColumns(f.db,table);
    f.db.prepare(`UPDATE ${table} SET body=?,digest=? WHERE ${keys.map((key:string)=>key+'=?').join(' AND ')}`)
      .run(canonical(body),contentDigest(body),...keys.map((key:string)=>row[key]));
  }
  f.kernel.transaction(()=>eraseSelected(f.kernel,s,[],hash,f.now()));assertMinimized(f.db,s,x,hash);
}

/** Called inside the retained privacy case; no additional registered test. */
export async function extendedServicesPrivacy() {
  for(const group of GROUPS)await group.using(async(f:any)=>{
    const x=await group.populate(f),s=populated(f,x,group),privacy=new PrivacyLifecycle(f.kernel);
    const exported=privacy.export(owner(f),x.customer_id),records=exported.extended_service_records;
    for(const table of x.tables)assert.ok(records[table].length,table+' belongs to the subject export');
    const serialized=JSON.stringify(records);
    for(const key of ['token_hash','session_hash','verification_hash','claimant_session_hash','proposer_session_hash','customer_session_hash','issuer_session_hash'])assert.equal(serialized.includes('"'+key+'"'),false,'Omit replay credentials '+key);
    const customerScope=f.customer?.scope??f.customer;
    if(customerScope)assert.equal(serialized.includes(f.kernel.require(customerScope).token_hash),false,'Omit the actual current customer proof credential');
    for(const key of ['other_customer_id','other_resource_id'])if(x[key])assert.equal(serialized.includes(x[key]),false,'Omit another subject '+key);
    const beforeSources=sourceCopies(f),unknowns=originalUnknowns(f,x,s);
    assert.equal(privacy.erase(owner(f),x.customer_id).status,'logically_erased');
    assertMinimized(f.db,s,x,exported.subject_ref);assertOriginalUnknowns(f.db,s,unknowns);
    repeatHashOnly(f,x,s,exported.subject_ref);assertOriginalUnknowns(f.db,s,unknowns);
    assert.deepEqual(sourceCopies(f),beforeSources,'Canonical erasure never invokes a source or claims physical source deletion');
  });
}
function importCopy(f:any,s:any,before:any,suppression:any,check:(db:any,k:CommerceKernel,scope:any)=>void) {
  const db=new DatabaseSync(':memory:');try {
    const k=new CommerceKernel(db,f.now);k.provisionStore(s.tenant_id,s.store_id);k.provisionMember(s.tenant_id,s.store_id,'m10_import_owner','owner');
    const scope=k.authenticate(k.issueSession(s.tenant_id,s.store_id,'m10_import_owner'));
    const imported=importMerchant(k,scope,before,before.digest,{suppression,suppression_sha256:merchantSnapshotDigest(suppression)});
    assert.equal(imported.mode,'quarantine');assert.equal(imported.live_activation_supported,false);
    assert.throws(()=>assertRecoveryEgress(k),/RESTORE_EGRESS_BLOCKED/);check(db,k,scope);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally {db.close();}
}
/** Observe both tombstone suppression and import of a subject never erased. */
export async function extendedServicesRestore() {
  for(const group of GROUPS)await group.using(async(f:any)=>{
    const x=await group.populate(f),s=populated(f,x,group),before=exportMerchant(f.kernel,owner(f),{snapshot_id:'m10_'+group.name+'_before'});
    const originalSources=sourceCopies(f),unknowns=originalUnknowns(f,x,s);
    importCopy(f,s,before,exportMerchantSuppression(f.kernel,owner(f)),db=>{assertRevoked(db,s);assertOriginalUnknowns(db,s,unknowns);});
    f.advance(1);const privacy=new PrivacyLifecycle(f.kernel),subject=privacy.export(owner(f),x.customer_id).subject_ref;
    privacy.erase(owner(f),x.customer_id);
    importCopy(f,s,before,exportMerchantSuppression(f.kernel,owner(f)),db=>{
      assertRevoked(db,s);assertMinimized(db,s,x,subject);assertOriginalUnknowns(db,s,unknowns);
    });
    assert.deepEqual(sourceCopies(f),originalSources,'Import/suppression never dispatches an original source effect');
  });
}
export async function extendedServicesUninstall() {
  for(const group of GROUPS)await group.using(async(f:any)=>{
    const x=await group.populate(f),s=populated(f,x,group),before=sourceCopies(f),privacy=new PrivacyLifecycle(f.kernel);
    const hash=privacy.export(owner(f),x.customer_id).subject_ref,unknowns=originalUnknowns(f,x,s);
    const result=privacy.uninstall(owner(f));assert.equal(result.status,'disconnected');assert.equal(result.physical_deletion,false);
    assertRevoked(f.db,s);assertMinimized(f.db,s,x,hash);assertOriginalUnknowns(f.db,s,unknowns);
    assert.throws(()=>f.kernel.require(owner(f)),/ACCESS_DENIED/);assert.deepEqual(sourceCopies(f),before);
  });
}
