import { CommerceKernel, digest, exact, id, integer } from './kernel.mts';
import type { Row, Scope } from './kernel.mts';
import { jsonValue } from './configuration-values.mts';
import { storageInventoryCurrent, suppressionCheckpoint, eraseSelected } from './privacy-lifecycle.mts';
import { revokeGrowthForRestore } from './growth-privacy.mts';
import { revokeExtendedServicesForRestore } from './extended-services-privacy.mts';
import { revokeInventoryPlanningForRestore } from './inventory-planning-privacy.mts';
import { revokeEcosystemForRestore } from './ecosystem-privacy.mts';

const LIMIT=64*1024*1024, MAX_ROWS=10000;
const LOCAL_KINDS=new Set(['migration_binding','merchant_import','merchant_credential_binding']);
// Every current table appears in the manifest. These explicit exceptions contain
// installation authority, authentication material, or locally derived controls.
const EXCLUDED:Record<string,string>={
  commerce_migrations:'exact_local_migration_history',commerce_stores:'same_identity_local_bootstrap',
  commerce_members:'destination_membership',commerce_permissions:'destination_authority',
  commerce_sessions:'authentication_not_portable',commerce_challenges:'authentication_not_portable',
  commerce_challenge_rates:'authentication_not_portable',commerce_customer_proof_bindings:'authentication_not_portable',
  commerce_gift_sessions:'authentication_not_portable',commerce_gift_challenges:'authentication_not_portable',
  commerce_worker_grants:'authentication_not_portable',commerce_secrets:'opaque_metadata_only',
  commerce_recovery_state:'destination_quarantine',commerce_restored_operations:'derived_replay_deny_list',
};
const PAUSE:Record<string,string>={
  commerce_credential_slots:'active=0',commerce_webhook_routes:'enabled=0',commerce_execution_settings:'enabled=0',
  commerce_action_readiness:'revoked=1',commerce_action_approvals:'revoked=1',commerce_shipping_label_approvals:'revoked=1',commerce_inventory_transfer_approvals:'revoked=1',commerce_skill_approvals:'revoked=1',
  commerce_return_overrides:'revoked=1',commerce_prevention_confirmations:"revoked=1,session_hash='revoked'",
  commerce_case_work:"state='revoked',expires_at=0",commerce_support_documents:"state='revoked'",
};
const REF=/^sec_[A-Za-z0-9_-]{43}$/;
const SENSITIVE=/^(?:password|passwd|authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|wrapping[_-]?key|bearer[_-]?token|plaintext[_-]?(?:secret|credential)s?|secret|credentials?)$/i;
const SECRET_TEXT=/(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+\/-]{12,}|\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}|\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{12,}|\bAKIA[A-Z0-9]{16}\b)/;

/** Canonical, bounded JSON digest. A caller must obtain the expected value through
 * its trusted transfer channel; a package's own digest is not an attestation. */
export const merchantSnapshotDigest=(value:unknown)=>digest(JSON.stringify(jsonValue(value,LIMIT)));
const stable=(value:unknown)=>JSON.stringify(jsonValue(value,LIMIT));
function owner(k:CommerceKernel,scope:Scope){const s=k.authorize(scope,'recovery.manage');if(s.role!=='owner')throw new Error('ACCESS_DENIED');return s;}
function migrations(k:CommerceKernel){return k.db.prepare('SELECT version,sha256 FROM commerce_migrations ORDER BY version').all();}
function localKind(kind:unknown){return typeof kind==='string'&&(LOCAL_KINDS.has(kind)||kind.startsWith('merchant_'));}
function cell(value:any):any {
  if(value instanceof Uint8Array)return {$bytes:Buffer.from(value).toString('base64')};
  if(value===null||typeof value==='string'||typeof value==='number'&&Number.isSafeInteger(value))return value;
  throw new Error('PORTABILITY_CELL_INVALID');
}
function decode(value:any):any {
  if(value===null||typeof value==='string'||typeof value==='number'&&Number.isSafeInteger(value))return value;
  try{exact(value,['$bytes']);if(typeof value.$bytes!=='string'||value.$bytes.length>LIMIT)throw new Error();
    const bytes=Buffer.from(value.$bytes,'base64');if(bytes.toString('base64')!==value.$bytes)throw new Error();return bytes;
  }catch{throw new Error('PORTABILITY_CELL_INVALID');}
}
function encoded(rows:Row[]):Row[]{return rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,cell(value)]))).sort((a,b)=>stable(a).localeCompare(stable(b)));}
function inspect(value:any,scope:Row,refs:Set<string>,depth=0):void {
  if(depth>20)throw new Error('PORTABILITY_JSON_INVALID');
  if(typeof value==='string'){
    if(SECRET_TEXT.test(value))throw new Error('PORTABILITY_SECRET_REJECTED');
    for(const ref of value.match(/sec_[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g)??[])refs.add(ref);
    if(/^[\s]*[\[{]/.test(value)){
      // Bracket-leading prose and Markdown are valid merchant text. Recurse only
      // into a string that actually contains JSON, never reinterpret ordinary text.
      let parsed:any;try{parsed=JSON.parse(value);}catch{return;}
      inspect(jsonValue(parsed,LIMIT),scope,refs,depth+1);
    }
  }else if(Array.isArray(value)){for(const item of value)inspect(item,scope,refs,depth+1);}
  else if(value&&typeof value==='object'){
    if(Object.hasOwn(value,'$bytes')){const bytes=decode(value);inspect(bytes.toString('utf8'),scope,refs,depth+1);return;}
    for(const [key,item] of Object.entries(value)){
      if(SENSITIVE.test(key)&&item!==null&&item!=='')throw new Error('PORTABILITY_SECRET_REJECTED');
      if((key==='tenant_id'&&item!==scope.tenant_id)||(key==='store_id'&&item!==scope.store_id))throw new Error('PORTABILITY_SCOPE_MISMATCH');
      if(['secret_ref','key_ref'].includes(key)&&item!==null&&(typeof item!=='string'||!REF.test(item)))throw new Error('PORTABILITY_SECRET_REJECTED');
      inspect(item,scope,refs,depth+1);
    }
  }
}
function receipt(k:CommerceKernel,s:Row):Row|undefined {
  const list=k.db.prepare("SELECT * FROM commerce_support_documents WHERE tenant_id=? AND store_id=? AND kind='merchant_import' ORDER BY version").all(s.tenant_id,s.store_id) as Row[];
  if(!list.length)return undefined;if(list.length!==1)throw new Error('PORTABILITY_IMPORT_RECEIPT_INVALID');
  const row=list[0];let body:Row;try{body=JSON.parse(row.body);}catch{throw new Error('PORTABILITY_IMPORT_RECEIPT_INVALID');}
  if(merchantSnapshotDigest(body)!==row.digest)throw new Error('PORTABILITY_IMPORT_RECEIPT_INVALID');return body;
}
function writeDocument(k:CommerceKernel,s:Row,kind:string,ref:string,body:Row){
  k.db.prepare('INSERT INTO commerce_support_documents VALUES(?,?,?,?,?,?,?,?,?,NULL,NULL,?,NULL)')
    .run(s.tenant_id,s.store_id,kind,ref,1,stable(body),merchantSnapshotDigest(body),s.actor_id,'recorded',k.clock());
}

/** Obtain after the transfer snapshot, through the source owner's current
 * suppression channel. A checkpoint bundled only with an old snapshot is not
 * proof of later erasures. Source quiescence and trusted delivery are caller duties. */
export function exportMerchantSuppression(k:CommerceKernel,scope:Scope){
  return k.transaction(()=>{const s=owner(k,scope),p=suppressionCheckpoint(k),same=(r:Row)=>r.tenant_id===s.tenant_id&&r.store_id===s.store_id;
    return {version:1,tenant_id:s.tenant_id,store_id:s.store_id,generated_at:p.generated_at,subjects:p.subjects.filter(same),resources:p.resources.filter(same)};});
}
export type MerchantSuppression={suppression:unknown;suppression_sha256:string};
function checkedSuppression(k:CommerceKernel,s:Row,input:MerchantSuppression|undefined,minimum:number){
  if(!input)throw new Error('PORTABILITY_SUPPRESSION_REQUIRED');
  try{exact(input,['suppression','suppression_sha256']);}catch{throw new Error('PORTABILITY_SUPPRESSION_INVALID');}
  const p=jsonValue(input.suppression,LIMIT);
  try{exact(p,['version','tenant_id','store_id','generated_at','subjects','resources']);integer(p.generated_at);}catch{throw new Error('PORTABILITY_SUPPRESSION_INVALID');}
  if(p.tenant_id!==s.tenant_id||p.store_id!==s.store_id)throw new Error('PORTABILITY_SCOPE_MISMATCH');
  if(p.version!==1||typeof input.suppression_sha256!=='string'||!/^[a-f0-9]{64}$/.test(input.suppression_sha256)||merchantSnapshotDigest(p)!==input.suppression_sha256)throw new Error('PORTABILITY_SUPPRESSION_INVALID');
  if(p.generated_at<minimum||p.generated_at>k.clock())throw new Error('PORTABILITY_SUPPRESSION_STALE');
  if(!Array.isArray(p.subjects)||!Array.isArray(p.resources)||p.subjects.length>MAX_ROWS||p.resources.length>MAX_ROWS)throw new Error('PORTABILITY_SUPPRESSION_INVALID');
  const subjects=new Set<string>(),resources=new Set<string>();
  for(const row of p.subjects){
    try{exact(row,['tenant_id','store_id','subject_hash','erased_at']);integer(row.erased_at);}catch{throw new Error('PORTABILITY_SUPPRESSION_INVALID');}
    if(row.tenant_id!==s.tenant_id||row.store_id!==s.store_id)throw new Error('PORTABILITY_SCOPE_MISMATCH');
    if(!/^[a-f0-9]{64}$/.test(row.subject_hash)||row.erased_at>p.generated_at||subjects.has(row.subject_hash))throw new Error('PORTABILITY_SUPPRESSION_INVALID');subjects.add(row.subject_hash);
  }
  for(const row of p.resources){
    try{exact(row,['tenant_id','store_id','resource_id','subject_hash','erased_at']);id(row.resource_id);integer(row.erased_at);}catch{throw new Error('PORTABILITY_SUPPRESSION_INVALID');}
    if(row.tenant_id!==s.tenant_id||row.store_id!==s.store_id)throw new Error('PORTABILITY_SCOPE_MISMATCH');
    if(resources.has(row.resource_id)||row.erased_at>p.generated_at||!p.subjects.some((subject:Row)=>subject.subject_hash===row.subject_hash&&subject.erased_at<=row.erased_at))throw new Error('PORTABILITY_SUPPRESSION_INVALID');resources.add(row.resource_id);
  }
  return {checkpoint:p,digest:input.suppression_sha256};
}
function applySuppression(k:CommerceKernel,s:Row,p:Row){
  let applied=0;
  for(const subject of p.subjects){
    const resources=p.resources.filter((r:Row)=>r.subject_hash===subject.subject_hash);
    const present=k.db.prepare('SELECT 1 FROM commerce_privacy_subjects WHERE tenant_id=? AND store_id=? AND subject_hash=?').get(s.tenant_id,s.store_id,subject.subject_hash);
    const missing=resources.some((r:Row)=>!k.db.prepare('SELECT 1 FROM commerce_privacy_resources WHERE tenant_id=? AND store_id=? AND resource_id=? AND subject_hash=?').get(s.tenant_id,s.store_id,r.resource_id,subject.subject_hash));
    if(!present||missing){eraseSelected(k,s,resources.map((r:Row)=>r.resource_id),subject.subject_hash,subject.erased_at);applied++;}
  }
  return applied;
}

/** Owner-authorized single-merchant transfer, never a database dump or activation. */
export function exportMerchant(k:CommerceKernel,scope:Scope,input:{snapshot_id:string}) {
  exact(input,['snapshot_id']);id(input.snapshot_id);
  return k.transaction(()=>{
    const s=owner(k,scope),inventory=storageInventoryCurrent(k),rows:Record<string,Row[]>={},refs=new Set<string>();
    const manifestTables:Row[]=[];let total=0;
    for(const table of inventory.tables){
      if(EXCLUDED[table.name]){manifestTables.push({name:table.name,columns:table.columns,mode:'local',reason:EXCLUDED[table.name]});continue;}
      if(!table.columns.includes('tenant_id')||!table.columns.includes('store_id'))throw new Error('PORTABILITY_COVERAGE_MISMATCH');
      let data=k.db.prepare(`SELECT * FROM ${table.name} WHERE tenant_id=? AND store_id=?`).all(s.tenant_id,s.store_id) as Row[];
      if(table.name==='commerce_support_documents')data=data.filter(row=>!localKind(row.kind));
      rows[table.name]=encoded(data);total+=data.length;if(total>MAX_ROWS)throw new Error('PORTABILITY_ROW_LIMIT');
      for(const row of rows[table.name])inspect(row,s,refs);
      manifestTables.push({name:table.name,columns:table.columns,mode:'rows',count:data.length,sha256:merchantSnapshotDigest(rows[table.name])});
    }
    const credentials=k.db.prepare('SELECT ref,provider,adapter,created_at,revoked FROM commerce_secrets WHERE tenant_id=? AND store_id=? ORDER BY ref').all(s.tenant_id,s.store_id) as Row[];
    for(const credential of credentials){if(!REF.test(credential.ref))throw new Error('PORTABILITY_CREDENTIAL_INVALID');id(credential.provider);id(credential.adapter);}
    if([...refs].some(ref=>!credentials.some(c=>c.ref===ref)))throw new Error('PORTABILITY_CREDENTIAL_UNRESOLVED');
    const store=k.db.prepare('SELECT market FROM commerce_stores WHERE tenant_id=? AND store_id=?').get(s.tenant_id,s.store_id) as Row;
    const manifest={schema_version:1,format:'rifare-merchant-portable',snapshot_id:input.snapshot_id,tenant_id:s.tenant_id,store_id:s.store_id,market:store.market,
      created_at:k.clock(),schema_digest:inventory.schema_digest,migrations_sha256:merchantSnapshotDigest(migrations(k)),tables:manifestTables,
      local_document_kinds:[...LOCAL_KINDS].sort(),import_mode:'quarantine',credential_policy:'opaque_references_require_rebind',plaintext_credentials_included:false};
    const payload={manifest,rows,credentials};return {...payload,digest:merchantSnapshotDigest(payload)};
  });
}

function validate(k:CommerceKernel,s:Row,value:unknown,expected:string){
  const x=jsonValue(value,LIMIT);try{exact(x,['manifest','rows','credentials','digest']);}catch{throw new Error('PORTABILITY_PACKAGE_INVALID');}
  if(typeof expected!=='string'||!/^[a-f0-9]{64}$/.test(expected)||x.digest!==expected||merchantSnapshotDigest({manifest:x.manifest,rows:x.rows,credentials:x.credentials})!==expected)throw new Error('PORTABILITY_DIGEST_MISMATCH');
  const m=exact(x.manifest,['schema_version','format','snapshot_id','tenant_id','store_id','market','created_at','schema_digest','migrations_sha256','tables','local_document_kinds','import_mode','credential_policy','plaintext_credentials_included']);
  const inventory=storageInventoryCurrent(k);
  if(m.schema_version!==1||m.format!=='rifare-merchant-portable'||m.schema_digest!==inventory.schema_digest||m.migrations_sha256!==merchantSnapshotDigest(migrations(k)))throw new Error('PORTABILITY_SCHEMA_MISMATCH');
  id(m.snapshot_id);integer(m.created_at);if(m.created_at>k.clock())throw new Error('PORTABILITY_SNAPSHOT_FUTURE');
  const store=k.db.prepare('SELECT market FROM commerce_stores WHERE tenant_id=? AND store_id=?').get(s.tenant_id,s.store_id) as Row;
  if(m.tenant_id!==s.tenant_id||m.store_id!==s.store_id||m.market!==store.market)throw new Error('PORTABILITY_SCOPE_MISMATCH');
  if(m.import_mode!=='quarantine'||m.credential_policy!=='opaque_references_require_rebind'||m.plaintext_credentials_included!==false||stable(m.local_document_kinds)!==stable([...LOCAL_KINDS].sort()))throw new Error('PORTABILITY_PACKAGE_INVALID');
  const included=inventory.tables.filter((table:Row)=>!EXCLUDED[table.name]);
  if(!Array.isArray(m.tables)||m.tables.length!==inventory.tables.length||stable(m.tables.map((t:Row)=>t.name))!==stable(inventory.tables.map((t:Row)=>t.name))||!x.rows||Array.isArray(x.rows)||stable(Object.keys(x.rows).sort())!==stable(included.map((t:Row)=>t.name).sort()))throw new Error('PORTABILITY_COVERAGE_MISMATCH');
  const refs=new Set<string>();let total=0;
  for(let i=0;i<inventory.tables.length;i++){
    const table=inventory.tables[i],entry=m.tables[i];
    if(EXCLUDED[table.name]){
      if(stable(entry)!==stable({name:table.name,columns:table.columns,mode:'local',reason:EXCLUDED[table.name]}))throw new Error('PORTABILITY_COVERAGE_MISMATCH');continue;
    }
    try{exact(entry,['name','columns','mode','count','sha256']);}catch{throw new Error('PORTABILITY_COVERAGE_MISMATCH');}
    const data=x.rows[table.name];if(!Array.isArray(data)||entry.mode!=='rows'||stable(entry.columns)!==stable(table.columns)||entry.count!==data.length||entry.sha256!==merchantSnapshotDigest(data))throw new Error('PORTABILITY_COVERAGE_MISMATCH');
    total+=data.length;if(total>MAX_ROWS)throw new Error('PORTABILITY_ROW_LIMIT');
    const seen=new Set<string>(),primary=(k.db.prepare(`PRAGMA table_info(${table.name})`).all() as Row[]).filter(c=>c.pk).sort((a,b)=>a.pk-b.pk).map(c=>c.name);
    for(const row of data){
      try{exact(row,table.columns);}catch{throw new Error('PORTABILITY_ROW_INVALID');}
      if(row.tenant_id!==s.tenant_id||row.store_id!==s.store_id)throw new Error('PORTABILITY_SCOPE_MISMATCH');
      if(table.name==='commerce_support_documents'&&localKind(row.kind))throw new Error('PORTABILITY_LOCAL_CONTROL_DENIED');
      for(const value of Object.values(row))decode(value);
      const key=stable(primary.map(column=>row[column]));if(seen.has(key))throw new Error('PORTABILITY_DUPLICATE_ROW');seen.add(key);
      inspect(row,s,refs);
    }
  }
  if(!Array.isArray(x.credentials)||x.credentials.length>MAX_ROWS)throw new Error('PORTABILITY_CREDENTIAL_INVALID');
  const credentialRefs=new Set<string>();
  for(const c of x.credentials){
    try{exact(c,['ref','provider','adapter','created_at','revoked']);id(c.provider);id(c.adapter);integer(c.created_at);}catch{throw new Error('PORTABILITY_CREDENTIAL_INVALID');}
    if(!REF.test(c.ref)||![0,1].includes(c.revoked)||credentialRefs.has(c.ref))throw new Error('PORTABILITY_CREDENTIAL_INVALID');credentialRefs.add(c.ref);
  }
  if([...refs].some(ref=>!credentialRefs.has(ref)))throw new Error('PORTABILITY_CREDENTIAL_UNRESOLVED');
  return {x,m,included};
}

/** Import is atomic and always paused. No source identity, operation ID, financial
 * value, configuration body or content digest is rewritten to fit a destination. */
export function importMerchant(k:CommerceKernel,scope:Scope,value:unknown,expected_digest:string,suppression:MerchantSuppression){
  return k.transaction(()=>{
    const s=owner(k,scope),{x,m,included}=validate(k,s,value,expected_digest),cp=checkedSuppression(k,s,suppression,m.created_at),prior=receipt(k,s);
    if(prior){const state=k.db.prepare('SELECT * FROM commerce_recovery_state WHERE id=1').get() as Row;
      if(prior.snapshot_id!==m.snapshot_id||prior.digest!==expected_digest||!state||state.restore_id!==m.snapshot_id||state.source_digest!==expected_digest)throw new Error('PORTABILITY_IMPORT_CONFLICT');
      applySuppression(k,s,cp.checkpoint);
      k.db.prepare('UPDATE commerce_recovery_state SET suppression_digest=? WHERE id=1').run(cp.digest);
      return {...prior,suppression_sha256:cp.digest};}
    if(Number((k.db.prepare('SELECT count(*) n FROM commerce_stores').get() as Row).n)!==1||k.db.prepare('SELECT 1 FROM commerce_recovery_state').get())throw new Error('PORTABILITY_TARGET_NOT_EMPTY');
    for(const table of included){
      const existing=k.db.prepare(`SELECT * FROM ${table.name}`).all() as Row[];
      if(existing.some(row=>table.name!=='commerce_support_documents'||row.kind!=='migration_binding'))throw new Error('PORTABILITY_TARGET_NOT_EMPTY');
    }
    k.db.exec('PRAGMA defer_foreign_keys=ON');
    // Suppression triggers must see the already-redacted resource rows. Validate
    // their consistency below, then insert the tombstones last in this transaction.
    const ordered=[...included].sort((a,b)=>Number(a.name.startsWith('commerce_privacy_'))-Number(b.name.startsWith('commerce_privacy_'))||a.name.localeCompare(b.name));
    for(const table of ordered){
      const statement=k.db.prepare(`INSERT INTO ${table.name} (${table.columns.join(',')}) VALUES(${table.columns.map(()=>'?').join(',')})`);
      for(const row of x.rows[table.name])statement.run(...table.columns.map((column:string)=>decode(row[column])));
    }
    if(k.db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('PORTABILITY_FOREIGN_KEYS_INVALID');
    const erased=k.db.prepare(`SELECT r.payload,r.customer_id FROM commerce_resources r JOIN commerce_privacy_resources p USING(tenant_id,store_id) WHERE p.resource_id=r.id`).all() as Row[];
    if(erased.some(r=>r.payload!=='{"redacted":true}'||r.customer_id!==null))throw new Error('PORTABILITY_SUPPRESSION_INVALID');
    applySuppression(k,s,cp.checkpoint);
    if(k.db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('PORTABILITY_FOREIGN_KEYS_INVALID');
    k.db.prepare('INSERT INTO commerce_recovery_state VALUES(1,?,?,?,?,?)').run(m.snapshot_id,'quarantine',expected_digest,cp.digest,k.clock());
    for(const [table,clause] of Object.entries(PAUSE)){
      const controlExclusion=table==='commerce_support_documents'?" AND kind!='migration_binding' AND substr(kind,1,9)!='merchant_'":'';
      k.db.prepare(`UPDATE ${table} SET ${clause} WHERE tenant_id=? AND store_id=?${controlExclusion}`).run(s.tenant_id,s.store_id);
    }
    revokeGrowthForRestore(k,s.tenant_id,s.store_id);
    revokeExtendedServicesForRestore(k,s.tenant_id,s.store_id);
    revokeInventoryPlanningForRestore(k,s.tenant_id,s.store_id);
    revokeEcosystemForRestore(k,s.tenant_id,s.store_id);
    k.db.exec('INSERT OR IGNORE INTO commerce_restored_operations SELECT tenant_id,store_id,id FROM commerce_operations');
    k.db.exec("UPDATE commerce_operations SET state='unknown',revision=revision+1 WHERE state='sending'");
    k.db.exec("UPDATE commerce_operation_work SET state='unknown',lease_token=NULL,lease_until=NULL,last_code='merchant_import_uncertain' WHERE state IN ('sending','leased')");
    const counts=Object.fromEntries(included.map(table=>[table.name,x.rows[table.name].length]));
    const result={snapshot_id:m.snapshot_id,digest:expected_digest,suppression_sha256:cp.digest,mode:'quarantine',counts,
      credential_map:x.credentials.map((c:Row)=>({source_ref:c.ref,provider:c.provider,adapter:c.adapter,source_revoked:c.revoked===1,status:'requires_rebind',destination_ref:null})),
      transformations:{revoked_tables:Object.keys(PAUSE),uncertain_operations:'sending_to_unknown',old_operations:'replay_denied',authentication:'destination_only'},
      live_activation_supported:false};
    writeDocument(k,s,'merchant_import',m.snapshot_id,result);return result;
  });
}

/** Records a reviewed reference mapping for a future configuration. It neither
 * creates an alias in SecretVault nor changes historical pins nor permits egress. */
export function bindImportedCredential(k:CommerceKernel,scope:Scope,input:{snapshot_id:string;source_ref:string;destination_ref:string;expected_digest:string}){
  exact(input,['snapshot_id','source_ref','destination_ref','expected_digest']);
  return k.transaction(()=>{
    const s=owner(k,scope),r=receipt(k,s),state=k.db.prepare('SELECT * FROM commerce_recovery_state WHERE id=1').get() as Row;
    if(!r||r.snapshot_id!==input.snapshot_id||r.digest!==input.expected_digest||!state||state.source_digest!==r.digest)throw new Error('PORTABILITY_IMPORT_CONFLICT');
    const source=r.credential_map.find((c:Row)=>c.source_ref===input.source_ref),destination=k.db.prepare('SELECT provider,adapter FROM commerce_secrets WHERE tenant_id=? AND store_id=? AND ref=? AND revoked=0').get(s.tenant_id,s.store_id,input.destination_ref) as Row;
    if(!source||!destination||source.provider!==destination.provider||source.adapter!==destination.adapter||source.source_ref===input.destination_ref)throw new Error('PORTABILITY_CREDENTIAL_MISMATCH');
    const body={snapshot_id:r.snapshot_id,source_ref:source.source_ref,destination_ref:input.destination_ref,provider:source.provider,adapter:source.adapter,status:'bound_for_reconfiguration',execution_authorized:false,source_digest:r.digest};
    const old=k.db.prepare("SELECT body FROM commerce_support_documents WHERE tenant_id=? AND store_id=? AND kind='merchant_credential_binding' AND id=? AND version=1").get(s.tenant_id,s.store_id,source.source_ref) as Row;
    if(old){if(stable(JSON.parse(old.body))!==stable(body))throw new Error('PORTABILITY_CREDENTIAL_BINDING_CONFLICT');return body;}
    writeDocument(k,s,'merchant_credential_binding',source.source_ref,body);return body;
  });
}
