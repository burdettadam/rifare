import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {existsSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {usingReturns} from './return-intake-helpers.mts';
import {usingImages,PHOTO} from './image-assistance-helpers.mts';
import {usingGift} from './gift-helpers.mts';
import {CommerceKernel,digest} from '../../packages/commerce/kernel.mts';
import {canonical,contentDigest} from '../../packages/commerce/configuration-values.mts';
import {PrivacyLifecycle,suppressionCheckpoint} from '../../packages/commerce/privacy-lifecycle.mts';
import {createRecoverySnapshot,restoreRecoverySnapshot} from '../../packages/commerce/safe-recovery.mts';
import {exportMerchant,exportMerchantSuppression,importMerchant,merchantSnapshotDigest} from '../../packages/commerce/merchant-portability.mts';

// ADR-0052 expectations use only established public entry points. No new runtime
// module is imported: the first case can demonstrate resurrection on the old code.
type Value=Record<string,any>;
const IMAGE_FIELDS=['tenant_id','store_id','evidence_id','case_id','resource_id','sha256','source_created_at'].sort();
const IMAGE_KINDS=['image_approval','image_observation','image_disagreement'];
let serial=0;
const next=(prefix:string)=>prefix+'_'+(++serial);
const picture=(f:any,caseId='case_one',scope=f.customer)=>f.evidence.upload(scope,{case_id:caseId,mime:'image/png',base64:PHOTO,note:'Synthetic private image note'});
const evidenceRow=(db:DatabaseSync,ref:string,tenant='tenant-a',store='store-a'):Value=>db.prepare('SELECT * FROM commerce_return_evidence WHERE tenant_id=? AND store_id=? AND id=?').get(tenant,store,ref) as Value;
function sourceIdentity(f:any,e:any,store=f.a){
  const row=evidenceRow(f.db,e.id,store.tenant,store.store);
  return {tenant_id:row.tenant_id,store_id:row.store_id,evidence_id:row.id,case_id:row.case_id,resource_id:row.resource_id,sha256:row.sha256,source_created_at:row.created_at};
}
const globalV2=(f:any,images:any[]=[])=>({version:2,generated_at:f.now(),subjects:[],resources:[],images});
const merchantV2=(f:any,images:any[]=[],store=f.a)=>({version:2,tenant_id:store.tenant,store_id:store.store,generated_at:f.now(),subjects:[],resources:[],images});
const packed=(suppression:any)=>({suppression,suppression_sha256:merchantSnapshotDigest(suppression)});
function restoreInput(f:any,snapshot:any,cp:any,label=next('restored')){
  return {snapshot:snapshot.directory,destination:join(f.directory,label),manifest_sha256:snapshot.manifest_sha256,suppression:cp,suppression_sha256:merchantSnapshotDigest(cp)};
}
function restored(f:any,snapshot:any,cp:any,fn:(x:any)=>void){
  const result=restoreRecoverySnapshot(restoreInput(f,snapshot,cp),f.now),db=new DatabaseSync(result.database);
  try{fn({result,db,kernel:new CommerceKernel(db,f.now)});}finally{db.close();}
  return result;
}
function target(f:any,store=f.a){
  const db=new DatabaseSync(':memory:'),kernel=new CommerceKernel(db,f.now);
  kernel.provisionStore(store.tenant,store.store);kernel.provisionMember(store.tenant,store.store,'new_owner','owner');
  const scope=kernel.authenticate(kernel.issueSession(store.tenant,store.store,'new_owner'));
  return {db,kernel,scope,close:()=>db.close()};
}
const transfer=(f:any)=>exportMerchant(f.kernel,f.owner.scope,{snapshot_id:next('merchant')});
const imported=(t:any,snapshot:any,cp:any)=>importMerchant(t.kernel,t.scope,snapshot,snapshot.digest,packed(cp));
const count=(db:DatabaseSync,table:string)=>Number((db.prepare('SELECT count(*) n FROM '+table).get() as Value).n);
const imageRecords=(db:DatabaseSync)=>db.prepare("SELECT * FROM commerce_assistance_receipts WHERE json_extract(body,'$.kind') IN ('image_approval','image_observation','image_disagreement') ORDER BY id").all();
function erased(db:DatabaseSync,e:any,store={tenant:'tenant-a',store:'store-a'}){
  const row=evidenceRow(db,e.id,store.tenant,store.store);
  assert.ok(row,'the minimized evidence identity remains present');
  assert.equal(row.bytes,null,'an earlier snapshot must not restore the erased image bytes');
  assert.equal(row.state,'erased');assert.equal(row.note,'');assert.equal(row.scanner,null);
}
function untouched(db:DatabaseSync,expected:Value){
  const row=evidenceRow(db,expected.id,expected.tenant_id,expected.store_id);
  assert.deepEqual(row,expected,'unselected evidence retains the exact original row');
}
function noRestoreResidue(f:any,input:any){
  assert.equal(existsSync(input.destination),false);
  const name=input.destination.slice(f.directory.length+1);
  assert.equal(readdirSync(f.directory).some(p=>p.startsWith(name+'.staging-')),false);
}
function controlRow(f:any,image:any,extra:Value={}){
  const body={version:1,image};
  return {tenant_id:image.tenant_id,store_id:image.store_id,kind:'image_suppression',id:image.evidence_id,version:1,body:canonical(body),digest:contentDigest(body),author:'privacy_replay',state:'recorded',reviewer:null,review_digest:null,created_at:f.now(),expires_at:null,...extra};
}
function putControl(db:DatabaseSync,row:Value){
  const fields=['tenant_id','store_id','kind','id','version','body','digest','author','state','reviewer','review_digest','created_at','expires_at'];
  db.prepare('INSERT INTO commerce_support_documents ('+fields.join(',')+') VALUES('+fields.map(()=>'?').join(',')+')').run(...fields.map(k=>row[k]));
}
function assertControl(db:DatabaseSync,image:any,appliedAt:number){
  const row=db.prepare("SELECT * FROM commerce_support_documents WHERE tenant_id=? AND store_id=? AND kind='image_suppression' AND id=?").get(image.tenant_id,image.store_id,image.evidence_id) as Value;
  assert.ok(row,'an absent-source suppression must be retained');
  const expected={version:1,image};
  assert.deepEqual(JSON.parse(row.body),expected);assert.equal(row.digest,contentDigest(expected));
  assert.equal(row.version,1);assert.equal(row.author,'privacy_replay');
  assert.equal(row.reviewer,null);assert.equal(row.review_digest,null);assert.equal(row.expires_at,null);
  assert.equal(row.created_at,appliedAt);assert.ok(['recorded','revoked'].includes(row.state));
  return row;
}
// These are explicitly historical/imported residue fixtures, not branded model
// results or evidence that any real inference occurred.
function residue(f:any,image:any,kind='image_approval'){
  const task=f.reads.createTask(f.a.scope,{order_id:image.resource_id,profile_id:'default'}),ref=next('historical_image');
  const body={schema_version:1,kind,id:ref,case_id:image.case_id,task_id:task.id,source:{evidence_id:image.evidence_id,sha256:image.sha256},observed_at:f.now()};
  f.db.prepare('INSERT INTO commerce_assistance_receipts(tenant_id,store_id,id,task_id,created_at,body) VALUES(?,?,?,?,?,?)').run(image.tenant_id,image.store_id,ref,task.id,f.now(),canonical({...body,receipt_digest:contentDigest(body)}));
  return ref;
}
function changedMerchant(snapshot:any,change:(x:any)=>void){
  const x=structuredClone(snapshot);change(x);
  for(const table of x.manifest.tables)if(table.mode==='rows'){table.count=x.rows[table.name].length;table.sha256=merchantSnapshotDigest(x.rows[table.name]);}
  x.digest=merchantSnapshotDigest({manifest:x.manifest,rows:x.rows,credentials:x.credentials});return x;
}
function changedRecovery(snapshot:any,change:(db:DatabaseSync)=>void){
  const file=join(snapshot.directory,'database.sqlite'),db=new DatabaseSync(file);
  try{change(db);}finally{db.close();}
  const bytes=readFileSync(file),manifest=JSON.parse(readFileSync(join(snapshot.directory,'manifest.json'),'utf8'));
  manifest.database_sha256=digest(bytes);manifest.database_bytes=bytes.length;
  const raw=canonical(manifest);writeFileSync(join(snapshot.directory,'manifest.json'),raw);
  return {...snapshot,manifest_sha256:digest(raw),database_sha256:manifest.database_sha256};
}

test('M17-SUPPRESSION-INDIVIDUAL-REPLAY-01',()=>usingReturns(async f=>{
  const removed=picture(f),retained=picture(f);await f.evidence.scan(f.reviewer.scope,removed.id);await f.evidence.scan(f.reviewer.scope,retained.id);
  const expected=evidenceRow(f.db,retained.id),order=f.order(),cases=f.db.prepare('SELECT * FROM commerce_cases ORDER BY id').all();
  const snapshot=createRecoverySnapshot(f.kernel,join(f.directory,'before_individual_erasure'));
  f.advance(10);assert.equal(f.evidence.erase(f.customer,removed.id).erased,true);
  const cp:any=suppressionCheckpoint(f.kernel);
  restored(f,snapshot,cp,({db,kernel})=>{
    // This is deliberately the first assertion after restore: old code restores
    // actual nonnull PNG bytes, rather than failing on an unavailable new API.
    erased(db,removed);untouched(db,expected);
    assert.deepEqual(db.prepare('SELECT * FROM commerce_cases ORDER BY id').all(),cases);
    const owner=kernel.authenticate(kernel.issueSession(f.a.tenant,f.a.store,'owner'));
    assert.deepEqual(kernel.get(owner,order.id),order);
    assert.equal(count(db,'commerce_privacy_subjects'),0);assert.equal(count(db,'commerce_privacy_resources'),0);
    assert.equal(count(db,'commerce_action_receipts'),0);assert.equal(count(db,'commerce_operations'),0);
  });
  assert.equal(cp.version,2);assert.equal(cp.images.length,1);
}));

test('M17-SUPPRESSION-VERSION-AND-MINIMIZATION-02',()=>usingReturns(f=>{
  const legacy:any=suppressionCheckpoint(f.kernel),merchantLegacy:any=exportMerchantSuppression(f.kernel,f.owner.scope);
  assert.deepEqual(Object.keys(legacy).sort(),['generated_at','resources','subjects','version']);assert.equal(legacy.version,1);
  assert.deepEqual(Object.keys(merchantLegacy).sort(),['generated_at','resources','store_id','subjects','tenant_id','version']);assert.equal(merchantLegacy.version,1);
  const e=picture(f),identity=sourceIdentity(f,e),active:any=suppressionCheckpoint(f.kernel);
  assert.equal(active.version,2);assert.deepEqual(active.images,[],'active evidence requires v2 but is never asserted erased');
  f.advance(17);assert.equal(f.evidence.erase(f.customer,e.id).erased,true);
  const cp:any=suppressionCheckpoint(f.kernel),merchant:any=exportMerchantSuppression(f.kernel,f.owner.scope);
  assert.deepEqual(Object.keys(cp).sort(),['generated_at','images','resources','subjects','version']);assert.equal(cp.version,2);
  assert.equal(cp.generated_at,f.now());assert.deepEqual(cp.images,[identity]);assert.deepEqual(Object.keys(cp.images[0]).sort(),IMAGE_FIELDS);
  assert.equal(cp.images[0].source_created_at,f.now()-17);assert.equal(Object.hasOwn(cp.images[0],'erased_at'),false);
  assert.deepEqual(merchant,{...cp,tenant_id:f.a.tenant,store_id:f.a.store});
  const raw=JSON.stringify(cp);for(const privateValue of [PHOTO,'Synthetic private image note','scanner','customer_id','uploaded_by','mime','base64'])assert.equal(raw.includes(privateValue),false,privateValue);
  for(const [column,value] of [['bytes',Buffer.from(PHOTO,'base64')],['note','residual private note'],['scanner','residual_scanner']]){
    f.db.prepare('UPDATE commerce_return_evidence SET '+column+'=? WHERE id=?').run(value as any,e.id);
    assert.throws(()=>suppressionCheckpoint(f.kernel),/IMAGE_SUPPRESSION_INVALID/,column+' inconsistent erased row');
    assert.throws(()=>exportMerchantSuppression(f.kernel,f.owner.scope),/IMAGE_SUPPRESSION_INVALID/,column+' inconsistent merchant row');
    f.db.prepare("UPDATE commerce_return_evidence SET bytes=NULL,note='',scanner=NULL WHERE id=?").run(e.id);
  }
}));

test('M17-SUPPRESSION-RETENTION-AND-GIFT-HOLDS-03',()=>usingGift(f=>{
  f.createGift();const ordinary=picture(f,'resolution_case'),gift=picture(f,'gift_case',f.a.scope),giftBefore=evidenceRow(f.db,gift.id);
  const normalIdentity=sourceIdentity(f,ordinary),giftIdentity=sourceIdentity(f,gift),privacy=new PrivacyLifecycle(f.kernel),giftOrderId=f.giftOrder.id;
  privacy.hold(f.owner.scope,{customer_id:'recipient-one',reason:'retention_obligation',authority_ref:'retained_gift_image',expires_at:f.now()+35*86400000});
  const snapshot=createRecoverySnapshot(f.kernel,join(f.directory,'before_retention'));
  f.advance(31*86400000);const owner=f.kernel.authenticate(f.kernel.issueSession(f.a.tenant,f.a.store,'owner'));
  assert.deepEqual(f.evidence.purgeExpired(owner),{erased:1,held:1,batch_limit:100,physical_erasure:false});
  const cp:any=suppressionCheckpoint(f.kernel);assert.deepEqual(cp.images,[normalIdentity]);
  restored(f,snapshot,cp,({db})=>{erased(db,ordinary);untouched(db,giftBefore);assert.equal(JSON.parse((db.prepare('SELECT payload FROM commerce_resources WHERE id=?').get(giftOrderId) as Value).payload).purchaser_name,'Private Purchaser');});
  privacy.releaseHold(owner,'recipient-one','retained_gift_image');assert.equal(f.evidence.purgeExpired(owner).erased,1);
  const later:any=suppressionCheckpoint(f.kernel);assert.deepEqual([...later.images].sort((a,b)=>a.evidence_id.localeCompare(b.evidence_id)),[normalIdentity,giftIdentity].sort((a,b)=>a.evidence_id.localeCompare(b.evidence_id)));
  restored(f,snapshot,later,({db})=>{erased(db,ordinary);erased(db,gift);assert.equal(count(db,'commerce_privacy_subjects'),0);});
}));

test('M17-SUPPRESSION-MERCHANT-MONOTONIC-REPEAT-04',()=>usingReturns(f=>{
  const one=picture(f),two=picture(f),identities=[sourceIdentity(f,one),sourceIdentity(f,two)],twoBefore=evidenceRow(f.db,two.id),snapshot=transfer(f),t=target(f);
  try{
    f.advance(1);assert.equal(f.evidence.erase(f.customer,one.id).erased,true);const first:any=exportMerchantSuppression(f.kernel,f.owner.scope);
    const result=imported(t,snapshot,first);assert.equal(result.mode,'quarantine');erased(t.db,one);untouched(t.db,twoBefore);
    const resourceBefore=t.db.prepare('SELECT * FROM commerce_resources ORDER BY id').all(),caseBefore=t.db.prepare('SELECT * FROM commerce_cases ORDER BY id').all();
    f.advance(1);assert.equal(f.evidence.erase(f.customer,two.id).erased,true);const second:any=exportMerchantSuppression(f.kernel,f.owner.scope);
    imported(t,snapshot,second);erased(t.db,one);erased(t.db,two);
    const stored=t.db.prepare("SELECT * FROM commerce_support_documents WHERE kind='image_suppression' ORDER BY id").all();assert.equal(stored.length,2);
    f.advance(1);const smaller=merchantV2(f,[]);imported(t,snapshot,smaller);imported(t,snapshot,smaller);
    erased(t.db,one);erased(t.db,two);assert.deepEqual(t.db.prepare("SELECT * FROM commerce_support_documents WHERE kind='image_suppression' ORDER BY id").all(),stored);
    const exported:any=exportMerchantSuppression(t.kernel,t.scope);assert.equal(exported.version,2);assert.deepEqual(exported.images.sort((a:any,b:any)=>a.evidence_id.localeCompare(b.evidence_id)),identities.sort((a,b)=>a.evidence_id.localeCompare(b.evidence_id)));
    assert.deepEqual(t.db.prepare('SELECT * FROM commerce_resources ORDER BY id').all(),resourceBefore);assert.deepEqual(t.db.prepare('SELECT * FROM commerce_cases ORDER BY id').all(),caseBefore);
    assert.equal(count(t.db,'commerce_privacy_subjects'),0);assert.equal(count(t.db,'commerce_privacy_resources'),0);assert.deepEqual(t.db.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{t.close();}
}));

test('M17-SUPPRESSION-ABSENT-SOURCE-PERSISTENCE-05',()=>usingReturns(f=>{
  const snapshot=createRecoverySnapshot(f.kernel,join(f.directory,'before_image_existed')),merchant=transfer(f);
  f.advance(3);const e=picture(f),identity=sourceIdentity(f,e);f.evidence.erase(f.customer,e.id);
  const cp:any=suppressionCheckpoint(f.kernel),merchantCp:any=exportMerchantSuppression(f.kernel,f.owner.scope);f.advance(7);const appliedAt=f.now();
  restored(f,snapshot,cp,({db,kernel})=>{
    assert.equal(evidenceRow(db,e.id),undefined);const row=assertControl(db,identity,appliedAt);
    assert.deepEqual((suppressionCheckpoint(kernel) as any).images,[identity]);
    db.prepare("UPDATE commerce_support_documents SET state='revoked' WHERE kind='image_suppression' AND id=?").run(e.id);
    assert.deepEqual((suppressionCheckpoint(kernel) as any).images,[identity],'revocation cannot undo retained suppression');
    assert.equal(row.created_at,appliedAt);
  });
  const t=target(f);try{
    imported(t,merchant,merchantCp);assert.equal(evidenceRow(t.db,e.id),undefined);assertControl(t.db,identity,appliedAt);
    f.advance(5);imported(t,merchant,merchantV2(f,[]));assertControl(t.db,identity,appliedAt);
    assert.deepEqual((exportMerchantSuppression(t.kernel,t.scope) as any).images,[identity]);
    const carried=exportMerchant(t.kernel,t.scope,{snapshot_id:'carried_image_suppression'}),again=target(f);
    try{
      imported(again,carried,merchantV2(f,[]));assert.equal(evidenceRow(again.db,e.id),undefined);assert.deepEqual((exportMerchantSuppression(again.kernel,again.scope) as any).images,[identity]);
      // A repeat must still merge the exact package's retained marker, even if
      // the destination marker was lost and the new checkpoint is smaller.
      again.db.exec("DELETE FROM commerce_support_documents WHERE kind='image_suppression'");
      imported(again,carried,merchantV2(f,[]));assert.deepEqual((exportMerchantSuppression(again.kernel,again.scope) as any).images,[identity]);
    }finally{again.close();}
  }finally{t.close();}
}));

test('M17-SUPPRESSION-STRICT-CHECKPOINT-VALIDATION-06',()=>usingReturns(f=>{
  const e=picture(f),identity=sourceIdentity(f,e),snapshot=createRecoverySnapshot(f.kernel,join(f.directory,'validation_source')),merchant=transfer(f),t=target(f);
  f.advance(4);f.evidence.erase(f.customer,e.id);const base=globalV2(f,[identity]);
  const invalid:any[]=[{...base,images:null},{...base,images:{}},{...base,images:['not_an_entry']},{...base,images:[identity,identity]}];
  for(const key of IMAGE_FIELDS){const row:any={...identity};delete row[key];invalid.push({...base,images:[row]});}
  invalid.push({...base,images:[{...identity,erased_at:f.now()}]});
  for(const key of ['tenant_id','store_id','evidence_id','case_id','resource_id'])for(const value of [null,7,'bad id'])invalid.push({...base,images:[{...identity,[key]:value}]});
  for(const value of ['A'.repeat(64),'a'.repeat(63),['a'.repeat(64)],{value:'a'.repeat(64)},null])invalid.push({...base,images:[{...identity,sha256:value}]});
  for(const value of [-1,1.5,Number.MAX_SAFE_INTEGER+1,f.now()+1,String(identity.source_created_at),null])invalid.push({...base,images:[{...identity,source_created_at:value}]});
  try{
    for(const [i,cp] of invalid.entries()){
      const input=restoreInput(f,snapshot,cp);assert.throws(()=>restoreRecoverySnapshot(input,f.now),/IMAGE_SUPPRESSION_INVALID/,'global malformed image '+i);noRestoreResidue(f,input);
      assert.throws(()=>imported(t,merchant,{...cp,tenant_id:f.a.tenant,store_id:f.a.store}),/IMAGE_SUPPRESSION_INVALID/,'merchant malformed image '+i);
      assert.equal(count(t.db,'commerce_resources'),0);assert.equal(count(t.db,'commerce_support_documents'),0);
    }
    const badHash=restoreInput(f,snapshot,base);badHash.suppression_sha256='0'.repeat(64);assert.throws(()=>restoreRecoverySnapshot(badHash,f.now),/SUPPRESSION_CHECKPOINT_INVALID/);
    const merchantBase=merchantV2(f,[identity]);assert.throws(()=>importMerchant(t.kernel,t.scope,merchant,merchant.digest,{suppression:merchantBase,suppression_sha256:'0'.repeat(64)}),/PORTABILITY_SUPPRESSION_INVALID/);
    const created=JSON.parse(readFileSync(join(snapshot.directory,'manifest.json'),'utf8')).created_at;
    for(const [at,error] of [[created-1,/SUPPRESSION_CHECKPOINT_STALE/],[f.now()+1,/SUPPRESSION_CHECKPOINT_FUTURE/]] as const){
      const stale={...base,generated_at:at,images:[{...identity,source_created_at:0}]};assert.throws(()=>restoreRecoverySnapshot(restoreInput(f,snapshot,stale),f.now),error);
      assert.throws(()=>imported(t,merchant,{...stale,tenant_id:f.a.tenant,store_id:f.a.store}),/PORTABILITY_SUPPRESSION_STALE/);
    }
    const many=Array.from({length:10001},(_,i)=>({...identity,evidence_id:'absent_'+i,source_created_at:0}));
    assert.throws(()=>imported(t,merchant,merchantV2(f,many)),/IMAGE_SUPPRESSION_INVALID/,'merchant images cannot exceed the existing record bound');
    const overGlobal={...base,images:many.slice(0,700)};assert.ok(Buffer.byteLength(JSON.stringify(overGlobal))>131072);
    assert.throws(()=>restoreRecoverySnapshot(restoreInput(f,snapshot,overGlobal),f.now),/IMAGE_SUPPRESSION_INVALID|CONFIGURATION_INVALID/,'global JSON size remains bounded');
    assert.equal(count(t.db,'commerce_resources'),0);assert.equal(count(t.db,'commerce_recovery_state'),0);
  }finally{t.close();}
}));

test('M17-SUPPRESSION-SCOPE-CONFLICT-AND-ROLLBACK-07',()=>usingImages(f=>{
  const one=f.upload(),identity=sourceIdentity(f,one);
  f.intake.configure(f.ownerB,{expected_revision:0,settings:f.settings});const other=picture(f,f.caseB.id,f.customerB);
  // The same evidence ID in another tenant/store is an independent identity.
  f.db.prepare('UPDATE commerce_return_evidence SET id=? WHERE tenant_id=? AND store_id=? AND id=?').run(one.id,f.b.tenant,f.b.store,other.id);
  const foreignBefore=evidenceRow(f.db,one.id,f.b.tenant,f.b.store),foreignIdentity=sourceIdentity(f,{id:one.id},f.b);
  const snapshot=createRecoverySnapshot(f.kernel,join(f.directory,'two_store_images')),merchant=transfer(f),t=target(f);f.advance(10);
  try{
    for(const patch of [{case_id:'different_case'},{resource_id:'different_resource'},{sha256:'c'.repeat(64)},{source_created_at:identity.source_created_at+1}]){
      const cp=globalV2(f,[{...identity,...patch}]),input=restoreInput(f,snapshot,cp);
      assert.throws(()=>restoreRecoverySnapshot(input,f.now),/IMAGE_SUPPRESSION_CONFLICT/);noRestoreResidue(f,input);
      assert.throws(()=>imported(t,merchant,merchantV2(f,[{...identity,...patch}])),/IMAGE_SUPPRESSION_CONFLICT/);
      assert.equal(count(t.db,'commerce_resources'),0);assert.equal(count(t.db,'commerce_support_documents'),0);assert.equal(count(t.db,'commerce_recovery_state'),0);
    }
    assert.throws(()=>imported(t,merchant,merchantV2(f,[foreignIdentity])),/PORTABILITY_SCOPE_MISMATCH/);
    assert.equal(f.evidence.erase(f.customer,one.id).erased,true);const cp:any=suppressionCheckpoint(f.kernel);assert.deepEqual(cp.images,[identity]);
    restored(f,snapshot,cp,({db})=>{erased(db,one);untouched(db,foreignBefore);});
    const merchantCp:any=exportMerchantSuppression(f.kernel,f.owner.scope),foreignCp:any=exportMerchantSuppression(f.kernel,f.ownerB);
    assert.deepEqual(merchantCp.images,[identity]);assert.deepEqual(foreignCp.images,[]);assert.equal(foreignCp.tenant_id,f.b.tenant);assert.equal(foreignCp.store_id,f.b.store);
    imported(t,merchant,merchantCp);const before=t.db.prepare("SELECT * FROM commerce_support_documents WHERE kind='image_suppression'").all(),recovery=t.db.prepare('SELECT * FROM commerce_recovery_state').all();
    assert.throws(()=>imported(t,merchant,merchantV2(f,[{...identity,sha256:'d'.repeat(64)}])),/IMAGE_SUPPRESSION_CONFLICT/);
    assert.deepEqual(t.db.prepare("SELECT * FROM commerce_support_documents WHERE kind='image_suppression'").all(),before);assert.deepEqual(t.db.prepare('SELECT * FROM commerce_recovery_state').all(),recovery);erased(t.db,one);
    putControl(f.db,controlRow(f,{...identity,sha256:'e'.repeat(64)}));
    assert.throws(()=>suppressionCheckpoint(f.kernel),/IMAGE_SUPPRESSION_CONFLICT/);assert.throws(()=>exportMerchantSuppression(f.kernel,f.owner.scope),/IMAGE_SUPPRESSION_CONFLICT/);
  }finally{t.close();}
}));

test('M17-SUPPRESSION-RETAINED-CONTROL-INTEGRITY-08',()=>usingReturns(f=>{
  const image={tenant_id:f.a.tenant,store_id:f.a.store,evidence_id:'historically_erased_image',case_id:'case_one',resource_id:f.order().id,sha256:'a'.repeat(64),source_created_at:f.now()-1};
  const valid=controlRow(f,image);putControl(f.db,valid);
  assert.deepEqual((suppressionCheckpoint(f.kernel) as any).images,[image]);
  const snapshot=createRecoverySnapshot(f.kernel,join(f.directory,'retained_control')),merchant=transfer(f);
  const fields:Value[]=[{id:'different_image'},{version:2},{author:'untrusted_author'},{state:'active'},{reviewer:'reviewer'},{review_digest:'a'.repeat(64)},{expires_at:f.now()+1},{created_at:-1},{created_at:f.now()+1},{digest:'0'.repeat(64)},{body:'{'}];
  for(const body of [{version:2,image},{version:1,image,extra:'private_text'},{version:1,image:{...image,store_id:'different_store'}},{version:1,image:{...image,source_created_at:f.now()+1}}])fields.push({body:canonical(body),digest:contentDigest(body)});
  for(const patch of fields){
    f.db.exec("DELETE FROM commerce_support_documents WHERE kind='image_suppression'");putControl(f.db,{...valid,...patch});
    assert.throws(()=>suppressionCheckpoint(f.kernel),/IMAGE_SUPPRESSION_INVALID/,'global retained field '+JSON.stringify(patch));
    assert.throws(()=>exportMerchantSuppression(f.kernel,f.owner.scope),/IMAGE_SUPPRESSION_INVALID/,'merchant retained field '+JSON.stringify(patch));
  }
  f.db.exec("DELETE FROM commerce_support_documents WHERE kind='image_suppression'");putControl(f.db,{...valid,state:'revoked'});
  assert.deepEqual((suppressionCheckpoint(f.kernel) as any).images,[image]);assert.deepEqual((exportMerchantSuppression(f.kernel,f.owner.scope) as any).images,[image]);
  restored(f,snapshot,globalV2(f,[]),({kernel})=>assert.deepEqual((suppressionCheckpoint(kernel) as any).images,[image]));
  const tampered=changedRecovery(snapshot,db=>db.prepare("UPDATE commerce_support_documents SET author='untrusted_author' WHERE kind='image_suppression'").run());
  const input=restoreInput(f,tampered,globalV2(f,[]));assert.throws(()=>restoreRecoverySnapshot(input,f.now),/IMAGE_SUPPRESSION_INVALID/);noRestoreResidue(f,input);
  const badMerchant=changedMerchant(merchant,x=>{const row=x.rows.commerce_support_documents.find((r:any)=>r.kind==='image_suppression'),body={version:1,image,extra:'private_control_text'};row.body=canonical(body);row.digest=contentDigest(body);}),t=target(f);
  try{assert.throws(()=>imported(t,badMerchant,merchantV2(f,[])),/IMAGE_SUPPRESSION_INVALID/);assert.equal(count(t.db,'commerce_resources'),0);assert.equal(count(t.db,'commerce_support_documents'),0);assert.equal(count(t.db,'commerce_recovery_state'),0);}finally{t.close();}
}));

test('M17-SUPPRESSION-LEGACY-DOWNGRADE-DENIED-09',()=>usingReturns(f=>{
  const clean=createRecoverySnapshot(f.kernel,join(f.directory,'legacy_media_free')),merchantClean=transfer(f),legacy:any=suppressionCheckpoint(f.kernel),merchantLegacy:any=exportMerchantSuppression(f.kernel,f.owner.scope),repeat=target(f);
  restored(f,clean,legacy,({db})=>assert.equal(count(db,'commerce_return_evidence'),0));
  try{
    imported(repeat,merchantClean,merchantLegacy);
    const e=picture(f),identity=sourceIdentity(f,e);
    const rejectLegacy=()=>{
      const snapshot=createRecoverySnapshot(f.kernel,join(f.directory,next('media_state'))),merchant=transfer(f),input=restoreInput(f,snapshot,{...legacy,generated_at:f.now()}),t=target(f);
      try{assert.throws(()=>restoreRecoverySnapshot(input,f.now),/IMAGE_SUPPRESSION_REQUIRED/);noRestoreResidue(f,input);assert.throws(()=>imported(t,merchant,{...merchantLegacy,generated_at:f.now()}),/IMAGE_SUPPRESSION_REQUIRED/);assert.equal(count(t.db,'commerce_resources'),0);}finally{t.close();}
    };
    rejectLegacy();f.evidence.erase(f.customer,e.id);rejectLegacy();
    f.db.prepare('DELETE FROM commerce_return_evidence WHERE id=?').run(e.id);
    for(const kind of IMAGE_KINDS){residue(f,identity,kind);rejectLegacy();f.db.exec("DELETE FROM commerce_assistance_receipts WHERE json_extract(body,'$.kind') IN ('image_approval','image_observation','image_disagreement')");}
    putControl(f.db,controlRow(f,identity));rejectLegacy();
    // The old package is media-free. Its destination acquired a retained marker
    // through the public repeat-import path, so a later v1 is still a downgrade.
    imported(repeat,merchantClean,merchantV2(f,[identity]));assert.equal(evidenceRow(repeat.db,e.id),undefined);
    assert.throws(()=>imported(repeat,merchantClean,{...merchantLegacy,generated_at:f.now()}),/IMAGE_SUPPRESSION_REQUIRED/);
    assert.deepEqual((exportMerchantSuppression(repeat.kernel,repeat.scope) as any).images,[identity]);
  }finally{repeat.close();}
}));

test('M17-SUPPRESSION-COPIED-HOLDS-AND-ATOMICITY-10',()=>usingImages(async f=>{
  const one=await f.approve(),first=await f.images.run(f.a.scope,f.imageInput(one.approval));f.images.disagree(f.reviewer.scope,{case_id:f.imageCase.id,observation_id:first.id,reason:'image_unclear'});
  const two=await f.approve();await f.images.run(f.a.scope,f.imageInput(two.approval));
  const privacy=new PrivacyLifecycle(f.kernel),customer=f.order().customer_id,resourceBefore=f.db.prepare('SELECT * FROM commerce_resources ORDER BY id').all();
  privacy.hold(f.owner.scope,{customer_id:customer,reason:'retention_obligation',authority_ref:'old_image_hold',expires_at:f.now()+86400000});
  const snapshot=createRecoverySnapshot(f.kernel,join(f.directory,'held_images')),merchant=transfer(f),t=target(f);
  privacy.releaseHold(f.owner.scope,customer,'old_image_hold');assert.equal(f.evidence.erase(f.customer,one.evidence.id).erased,true);
  const partial:any=suppressionCheckpoint(f.kernel),input=restoreInput(f,snapshot,partial);
  try{
    assert.throws(()=>restoreRecoverySnapshot(input,f.now),/IMAGE_RESTORE_HELD_CONTENT/,'a different held image receipt still blocks the restore');noRestoreResidue(f,input);
    assert.throws(()=>imported(t,merchant,exportMerchantSuppression(f.kernel,f.owner.scope)),/IMAGE_RESTORE_HELD_CONTENT/);
    assert.equal(count(t.db,'commerce_resources'),0);assert.equal(count(t.db,'commerce_return_evidence'),0);assert.equal(count(t.db,'commerce_support_documents'),0);assert.equal(count(t.db,'commerce_recovery_state'),0);
    assert.equal(f.evidence.erase(f.customer,two.evidence.id).erased,true);const all:any=suppressionCheckpoint(f.kernel);
    restored(f,snapshot,all,({db})=>{erased(db,one.evidence);erased(db,two.evidence);assert.equal(imageRecords(db).length,0);assert.deepEqual(db.prepare('SELECT * FROM commerce_resources ORDER BY id').all(),resourceBefore);assert.equal((db.prepare('SELECT released FROM commerce_privacy_holds').get() as Value).released,0,'the obsolete copied hold does not undo a current legitimate erasure');});
    imported(t,merchant,exportMerchantSuppression(f.kernel,f.owner.scope));erased(t.db,one.evidence);erased(t.db,two.evidence);assert.equal(imageRecords(t.db).length,0);assert.equal(count(t.db,'commerce_privacy_subjects'),0);
  }finally{t.close();}
}));

test('M17-SUPPRESSION-LATE-INFLIGHT-COMPLETION-11',()=>usingImages(async f=>{
  const textObservation=await f.shadow.run(f.a.scope,f.input()),{evidence,approval}=await f.approve();
  const snapshot=createRecoverySnapshot(f.kernel,join(f.directory,'before_inflight_erasure'));
  let entered!:()=>void,resume!:()=>void;
  const started=new Promise<void>(resolve=>{entered=resolve;}),pause=new Promise<void>(resolve=>{resume=resolve;});
  f.imageBefore(async()=>{entered();await pause;});
  const pending=f.images.run(f.a.scope,f.imageInput(approval)),rejected=assert.rejects(pending,/IMAGE_APPROVAL_UNAVAILABLE|IMAGE_EVIDENCE_UNAVAILABLE/);
  try{
    await started;assert.equal(f.imageRequests.length,1);assert.equal(f.evidence.erase(f.customer,evidence.id).erased,true);
    const cp=suppressionCheckpoint(f.kernel);
    restored(f,snapshot,cp,({db})=>{erased(db,evidence);assert.equal(imageRecords(db).length,0);assert.ok(db.prepare('SELECT id FROM commerce_assistance_receipts WHERE id=?').get(textObservation.id),'unrelated text observation is retained');});
  }finally{resume();await rejected;}
  assert.equal(f.imageRows().length,0);erased(f.db,evidence);assert.equal(f.imageRequests.length,1);
  assert.equal((f.db.prepare("SELECT count(*) n FROM commerce_model_reservations WHERE id LIKE 'imageobs_%'").get() as Value).n,1,'the original in-flight operation identity is not recreated');
  assert.ok(f.db.prepare('SELECT id FROM commerce_assistance_receipts WHERE id=?').get(textObservation.id));
}));

test('M17-SUPPRESSION-SUBJECT-REPLAY-AND-QUARANTINE-12',()=>usingImages(async f=>{
  const {evidence,approval}=await f.approve(),observation=await f.images.run(f.a.scope,f.imageInput(approval));f.images.disagree(f.reviewer.scope,{case_id:f.imageCase.id,observation_id:observation.id,reason:'image_unclear'});
  const privacy=new PrivacyLifecycle(f.kernel),order=f.order();privacy.hold(f.owner.scope,{customer_id:order.customer_id,reason:'retention_obligation',authority_ref:'old_subject_hold',expires_at:f.now()+86400000});
  const snapshot=createRecoverySnapshot(f.kernel,join(f.directory,'held_subject')),merchant=transfer(f);
  privacy.releaseHold(f.owner.scope,order.customer_id,'old_subject_hold');f.advance(2);assert.equal(privacy.erase(f.owner.scope,order.customer_id).status,'logically_erased');
  const cp:any=suppressionCheckpoint(f.kernel);assert.ok(cp.subjects.length>0);assert.ok(cp.images.some((r:any)=>r.evidence_id===evidence.id));
  function quarantined(db:DatabaseSync,kernel:CommerceKernel,scope:any){
    erased(db,evidence);assert.equal(imageRecords(db).length,0);
    const configs=db.prepare("SELECT state FROM commerce_support_documents WHERE kind='image_configuration'").all() as Value[];assert.ok(configs.length>0);assert.ok(configs.every(r=>r.state==='revoked'));
    assert.equal((db.prepare('SELECT mode FROM commerce_recovery_state').get() as Value).mode,'quarantine');
    assert.equal((db.prepare('SELECT payload FROM commerce_resources WHERE id=?').get(order.id) as Value).payload,'{"redacted":true}');
    assert.throws(()=>kernel.authenticate(f.customerBearer),/ACCESS_DENIED/);assert.throws(()=>kernel.authorize(scope,'model.run'),/RESTORE_EGRESS_BLOCKED|RESTORE_WRITE_BLOCKED/);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  }
  restored(f,snapshot,cp,({db,kernel})=>{
    const owner=kernel.authenticate(kernel.issueSession(f.a.tenant,f.a.store,'owner'));quarantined(db,kernel,owner);
    assert.equal((db.prepare('SELECT count(*) n FROM commerce_secrets WHERE revoked=0').get() as Value).n,0);
    assert.throws(()=>kernel.authenticate(f.a.bearer),/ACCESS_DENIED/);
  });
  const t=target(f);try{
    const result=imported(t,merchant,exportMerchantSuppression(f.kernel,f.owner.scope));quarantined(t.db,t.kernel,t.scope);
    assert.equal(result.live_activation_supported,false);assert.ok(result.credential_map.length>0);assert.ok(result.credential_map.every((r:any)=>r.status==='requires_rebind'&&r.destination_ref===null));
    assert.equal(count(t.db,'commerce_secrets'),0,'copied credential values are excluded from merchant transfer');
  }finally{t.close();}
}));
