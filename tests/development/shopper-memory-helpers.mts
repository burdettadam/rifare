import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {existsSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {supportFixture} from './support-helpers.mts';
import {ShopperMemory} from '../../packages/commerce/shopper-memory.mts';
import {CustomerAccess} from '../../packages/commerce/customer-access.mts';
import {CommerceKernel,digest} from '../../packages/commerce/kernel.mts';
import {canonical,contentDigest} from '../../packages/commerce/configuration-values.mts';
import {createRecoverySnapshot,restoreRecoverySnapshot,suppressionCheckpoint} from '../../packages/commerce/safe-recovery.mts';
import {exportMerchant,exportMerchantSuppression,importMerchant,merchantSnapshotDigest} from '../../packages/commerce/merchant-portability.mts';

export type Value=Record<string,any>;
export const PURPOSE='support_journey';
export const CONTEXT_FIELDS=['schema_version','case_id','resource_id','purpose','version','context_digest','status','preferences','provenance','history','ownership_generation','retained_under_hold','model_thread_required','execution_authorized','production_qualified'].sort();
export const PROVENANCE_FIELDS=['kind','source','reference','link_id','source_revision','observed_at','source_digest'].sort();
export const ACTIVE_FIELDS=['schema_version','case_id','resource_id','subject_ref','purpose','request_hash','status','preferences','source','expires_at'].sort();
export const SOURCE_FIELDS=['kind','link_id','link_revision','customer_resource_id','customer_source_version','customer_source_digest','order_source_version','order_source_digest','observed_at'].sort();
export const REDACTED_FIELDS=['schema_version','case_id','resource_id','subject_ref','purpose','request_hash','status','reason','preferences','source','expires_at'].sort();

export function memoryFixture(){
  const f=supportFixture();
  try{
    const memory=new ShopperMemory(f.kernel);
    const web=f.conversations.link(f.a.scope,f.customer,{case_id:'case_one',channel:'webchat',account_id:'widget',external_id:'browser_one',history:'unavailable',source_revision:1});
    return {...f,memory,web};
  }catch(error){f.cleanup();throw error;}
}
export async function usingMemory(fn:(f:ReturnType<typeof memoryFixture>)=>unknown){const f=memoryFixture();try{return await fn(f);}finally{f.cleanup();}}
export function contextInput(f:any,overrides:Value={}){
  return {case_id:'case_one',link_id:f.link.id,expected_generation:1,purpose:PURPOSE,...overrides};
}
export function recordInput(f:any,overrides:Value={}){
  return {...contextInput(f),expected_version:0,request_id:'memory_request_one',preferences:{fit_preference:'regular',response_style:'concise'},expires_at:f.now()+600000,...overrides};
}
export function forgetInput(f:any,overrides:Value={}){
  return {...contextInput(f),expected_version:1,request_id:'forget_request_one',...overrides};
}
export const readMemory=(f:any,overrides:Value={},scope=f.customer,proof=f.customer)=>f.memory.context(scope,proof,contextInput(f,overrides));
export const memoryRows=(db:DatabaseSync,store={tenant:'tenant-a',store:'store-a'}):Value[]=>db.prepare("SELECT * FROM commerce_support_documents WHERE tenant_id=? AND store_id=? AND kind='shopper_memory' ORDER BY id,version").all(store.tenant,store.store) as Value[];
export const caseRows=(db:DatabaseSync,caseId='case_one',store={tenant:'tenant-a',store:'store-a'})=>memoryRows(db,store).filter(r=>JSON.parse(r.body).case_id===caseId);
export const count=(db:DatabaseSync,table:string)=>Number((db.prepare('SELECT count(*) n FROM '+table).get() as Value).n);
export function assertEmpty(context:Value,status:string){
  assert.equal(context.status,status);assert.deepEqual(context.preferences,{});assert.equal(context.provenance,null);
  assert.equal(context.model_thread_required,false);assert.equal(context.execution_authorized,false);assert.equal(context.production_qualified,false);
}
export function assertRedacted(row:Value,reason?:string){
  const body=JSON.parse(row.body);
  assert.deepEqual(Object.keys(body).sort(),REDACTED_FIELDS);assert.equal(body.schema_version,1);assert.equal(body.status,'redacted');
  assert.deepEqual(body.preferences,{});assert.equal(body.source,null);assert.equal(body.expires_at,null);
  if(reason!==undefined)assert.equal(body.reason,reason);
  assert.equal(row.state,'revoked');assert.equal(row.expires_at,null);assert.equal(row.author,'verified_customer');
  assert.equal(row.reviewer,null);assert.equal(row.review_digest,null);assert.equal(row.digest,contentDigest(body));
  assert.match(body.request_hash,/^[a-f0-9]{64}$/);
}
export function replaceRow(db:DatabaseSync,row:Value){
  const fields=['body','digest','author','state','reviewer','review_digest','created_at','expires_at'];
  db.prepare('UPDATE commerce_support_documents SET '+fields.map(k=>k+'=?').join(',')+" WHERE tenant_id=? AND store_id=? AND kind='shopper_memory' AND id=? AND version=?")
    .run(...fields.map(k=>row[k]),row.tenant_id,row.store_id,row.id,row.version);
}
export function updateResource(f:any,row:Value,payload:Value,customer=row.customer_id,scope=f.a.scope){
  return f.kernel.ingest(scope,{kind:row.kind,source_system:row.source_system,external_id:row.external_id,source_version:row.source_version+1,source_updated_at:f.now(),customer_id:customer,payload});
}
export function verifiedCustomer(f:any,store=f.a,external='ORD-1001'){
  const order=f.kernel.lookup(store.scope,'order','synthetic',external),source=f.kernel.lookup(store.scope,'customer','synthetic',order.customer_id),proofs:Value[]=[];
  const access=new CustomerAccess(f.kernel,p=>proofs.push(p));
  const challenge=access.request({store_id:store.store,order_number:external,email:source.payload.email},'127.0.0.1');
  assert.equal(proofs.length,1,'the synthetic current-contact fixture actually receives one proof');
  const result=access.complete({store_id:store.store,challenge_id:challenge.challenge_id,proof:proofs[0].proof});
  return {scope:f.kernel.authenticate(result.token),bearer:result.token,order,source};
}
export function secondSubject(f:any){
  const other=verifiedCustomer(f,f.a,'ORD-1002');
  f.cases.create(other.scope,{case_id:'case_other',resource_id:other.order.id,profile_id:'default',policy_id:'returns'});
  const link=f.conversations.link(f.a.scope,other.scope,{case_id:'case_other',channel:'email',account_id:'merchant_mail',external_id:'thread_other',history:'complete',source_revision:1});
  return {...other,link,input:recordInput(f,{case_id:'case_other',link_id:link.id,request_id:'other_customer_request',preferences:{response_style:'detailed'}})};
}
export function secondStore(f:any){
  const store=f.c;
  f.kernel.provisionMember(store.tenant,store.store,'memory_owner','owner');f.kernel.provisionMember(store.tenant,store.store,'memory_reviewer','reviewer');
  const owner=f.kernel.authenticate(f.kernel.issueSession(store.tenant,store.store,'memory_owner')),
    reviewer=f.kernel.authenticate(f.kernel.issueSession(store.tenant,store.store,'memory_reviewer'));
  const draft=f.policies.create(store.scope,f.input());f.policies.test(store.scope,draft.policy_id,draft.version,draft.digest);
  f.policies.review(reviewer,draft.policy_id,draft.version,draft.digest);
  f.policies.publish(owner,{policy_id:draft.policy_id,version:draft.version,digest:draft.digest,expected_published_version:0,effective_at:f.now()});
  f.reads.profiles.put(store.scope,f.profile(store));
  const customer=verifiedCustomer(f,store);
  f.cases.create(customer.scope,{case_id:'case_one',resource_id:customer.order.id,profile_id:'default',policy_id:'returns'});
  const link=f.conversations.link(store.scope,customer.scope,{case_id:'case_one',channel:'webchat',account_id:'widget',external_id:'browser_one',history:'complete',source_revision:1});
  const input=recordInput(f,{link_id:link.id,request_id:'other_store_request',preferences:{fit_preference:'relaxed'}});
  f.memory.record(customer.scope,input);
  return {...customer,store,owner,link,input};
}
export function restoreInput(f:any,snapshot:any,label='restored_memory',cp=suppressionCheckpoint(f.kernel)){
  return {snapshot:snapshot.directory,destination:join(f.directory,label),manifest_sha256:snapshot.manifest_sha256,suppression:cp,suppression_sha256:contentDigest(cp)};
}
export function restored(f:any,snapshot:any,fn:(x:any)=>void,label='restored_memory'){
  const result=restoreRecoverySnapshot(restoreInput(f,snapshot,label),f.now),db=new DatabaseSync(result.database);
  try{fn({result,db,kernel:new CommerceKernel(db,f.now)});}finally{db.close();}
}
export function noRestoreResidue(f:any,input:Value){
  assert.equal(existsSync(input.destination),false);const name=input.destination.slice(f.directory.length+1);
  assert.equal(readdirSync(f.directory).some(p=>p.startsWith(name+'.staging-')),false);
}
export const snapshot=(f:any,label='memory_backup')=>createRecoverySnapshot(f.kernel,join(f.directory,label));
export const merchant=(f:any)=>exportMerchant(f.kernel,f.owner.scope,{snapshot_id:'memory_merchant'});
export const packedSuppression=(f:any)=>{const suppression=exportMerchantSuppression(f.kernel,f.owner.scope);return {suppression,suppression_sha256:merchantSnapshotDigest(suppression)};};
export const imported=(f:any,t:any,x:any)=>importMerchant(t.kernel,t.scope,x,x.digest,packedSuppression(f));
export function target(f:any){
  const db=new DatabaseSync(':memory:'),kernel=new CommerceKernel(db,f.now);
  kernel.provisionStore(f.a.tenant,f.a.store);kernel.provisionMember(f.a.tenant,f.a.store,'destination_owner','owner');
  const scope=kernel.authenticate(kernel.issueSession(f.a.tenant,f.a.store,'destination_owner'));
  return {db,kernel,scope,close:()=>db.close()};
}
export function changedMerchant(original:any,change:(copy:Value)=>void){
  const copy=structuredClone(original);change(copy);
  for(const table of copy.manifest.tables)if(table.mode==='rows'){table.count=copy.rows[table.name].length;table.sha256=merchantSnapshotDigest(copy.rows[table.name]);}
  copy.digest=merchantSnapshotDigest({manifest:copy.manifest,rows:copy.rows,credentials:copy.credentials});return copy;
}
export function changedRecovery(original:any,change:(db:DatabaseSync)=>void){
  const file=join(original.directory,'database.sqlite'),db=new DatabaseSync(file);try{change(db);}finally{db.close();}
  const bytes=readFileSync(file),manifest=JSON.parse(readFileSync(join(original.directory,'manifest.json'),'utf8'));
  manifest.database_sha256=digest(bytes);manifest.database_bytes=bytes.length;const raw=canonical(manifest);
  writeFileSync(join(original.directory,'manifest.json'),raw);return {...original,manifest_sha256:digest(raw),database_sha256:manifest.database_sha256};
}
