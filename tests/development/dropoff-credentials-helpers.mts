import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {fixture as eligibilityFixture,databaseState} from './dropoff-eligibility-helpers.mts';
import {updateResource} from './shopper-memory-helpers.mts';
import {CommerceKernel,digest} from '../../packages/commerce/kernel.mts';
import type {Keyring} from '../../packages/commerce/secrets.mts';
import {DropoffCredentialFixtureSource} from '../../packages/adapters/dropoff-credential-fixture-source.mts';
import {DropoffCredentials} from '../../packages/commerce/dropoff-credentials.mts';
import {DropoffChoices} from '../../packages/commerce/dropoff-choices.mts';
import {QualifiedReturnDestinations} from '../../packages/commerce/qualified-return-destinations.mts';
import {ReverseHubs} from '../../packages/commerce/reverse-hubs.mts';
import {ActionGateway} from '../../packages/commerce/action-gateway.mts';
import {canonical,contentDigest} from '../../packages/commerce/configuration-values.mts';
import {createRecoverySnapshot,restoreRecoverySnapshot,suppressionCheckpoint} from '../../packages/commerce/safe-recovery.mts';
import {exportMerchant,exportMerchantSuppression,importMerchant,merchantSnapshotDigest} from '../../packages/commerce/merchant-portability.mts';

export type Value=Record<string,any>;
export const E=JSON.parse(readFileSync(new URL('../fixtures/dropoff-credentials/independent-values.json',import.meta.url),'utf8'));
export const ISSUE='diagnostic.dropoff.issue',REVOKE='diagnostic.dropoff.revoke';
export const QUOTE_KIND='dropoff_credential_quote',OP_KIND='dropoff_credential_operation';
export const COMMAND_FIELDS=['schema_version','action','operation_id','tenant_id','store_id','resource_id','source_id','source_digest','source_identity','source_contract','source_account_id','directory_identity','family_ref','subject_ref','quote_id','quote_digest','items_digest','method_digest','fees_digest','site_id','destination_id','method_id','credential_kind','generation','replaces_operation_id','issue_operation_id','expires_at','credential_expires_at','financial_effect'].sort();
export const RESULT_FIELDS=['schema_version','operation_id','action','command_digest','source_identity','source_account_id','family_ref','items_digest','method_digest','generation','issue_operation_id','credential_id','credential_kind','credential_expires_at','state','reason','provider_ref','observed_at','digest'].sort();
export const STATUS_FIELDS=['schema_version','tenant_id','store_id','source_identity','source_account_id','family_ref','subject_ref','operation_id','command_digest','items_digest','method_digest','credential_id','kind','generation','expires_at','state','revoked_at','replaced_by','delivery_available','observed_at','digest'].sort();
export const pick=(v:Value,fields:string[])=>Object.fromEntries(fields.map(k=>[k,v[k]]));
export const count=(db:DatabaseSync,table:string)=>Number((db.prepare('SELECT count(*) n FROM '+table).get() as Value).n);
export function keyring(){let available=true;const key=Buffer.alloc(32,73),keys:Keyring={activeId:'dropoff-test-key',get:id=>available&&id==='dropoff-test-key'?key:undefined};return {keys,key,keyAvailable:(value:boolean)=>{available=value;}};}
export function owners(kernel:CommerceKernel,directory:any,keys:Keyring,choices?:DropoffChoices){
  const current=choices??new DropoffChoices(kernel,{destinations:new QualifiedReturnDestinations(kernel,directory.fulfillment),hubs:new ReverseHubs(kernel,directory.partner,directory.warehouse),source:directory});
  const credentialSource=new DropoffCredentialFixtureSource(directory,keys),credentials=new DropoffCredentials(kernel,{choices:current,source:credentialSource});
  return {choices:current,credentialSource,credentials,gateway:new ActionGateway(kernel,{dropoff:credentials})};
}
export async function fixture(){
  const base=await eligibilityFixture(),opened:DatabaseSync[]=[];let closed=false;
  try{
    const keys=keyring(),f:any={...base,...keys,...owners(base.kernel,base.source,keys.keys,base.choices),resourceId:base.order().id};
    f.closeCore=()=>{if(!closed){base.db.close();closed=true;}};
    f.reopen=(attach=true)=>{
      const db=new DatabaseSync(base.filename);opened.push(db);const kernel=new CommerceKernel(db,base.now),a={...base.a,scope:kernel.authenticate(base.a.bearer)},owner={...base.owner,scope:kernel.authenticate(base.owner.bearer)},reviewer={...base.reviewer,scope:kernel.authenticate(base.reviewer.bearer)};
      // Customer authentication is intentionally absent: reopening cannot renew the original proof.
      return {...f,db,kernel,a,owner,reviewer,...(attach?owners(kernel,base.source,keys.keys):{}),attach:()=>owners(kernel,base.source,keys.keys),order:()=>kernel.get(a.scope,f.resourceId)};
    };
    f.cleanup=()=>{for(const db of opened.reverse())db.close();if(!closed)base.cleanup();else{try{base.warehouseDb.close();base.partnerDb.close();base.fulfillmentDb.close();}finally{rmSync(base.directory,{recursive:true,force:true});}}};
    return f;
  }catch(error){base.cleanup();throw error;}
}
export async function usingFixture(fn:(f:any)=>unknown){const f=await fixture();try{return await fn(f);}finally{f.cleanup();}}
export function quote(f:any,replaces:string|null=null,scope=f.a.scope,patch:Value={}){
  const view=f.choices.quote(scope,{request_id:f.request.id}),choice=view.choices.find((m:Value)=>m.site_id===E.method.site_id);assert.ok(choice,'otherwise-valid native main choice');
  return f.credentials.quote(scope,{request_id:f.request.id,choice_id:choice.choice_id,expected_source_digest:view.source_digest,replaces_operation_id:replaces,...patch});
}
export function prepared(f:any,q=quote(f),scope=f.a.scope){const p=f.gateway.prepare(scope,{case_id:E.case_id,action:q.quote.action,arguments:{quote_id:q.id,quote_digest:q.digest}});return {q,p};}
export function approved(f:any,q=quote(f)){const x=prepared(f,q),a=f.gateway.approve(f.reviewer.scope,{preview_id:x.p.id,preview_digest:x.p.digest});return {...x,a};}
export function execute(f:any,x:Value,scope=f.a.scope){const receipt=f.gateway.execute(scope,{preview_id:x.p.id,preview_digest:x.p.digest,approval_id:x.a.id});assert.equal(typeof receipt.dropoff_operation_id,'string');assert.equal(receipt.state,'authorized');assert.equal(receipt.action,x.q.quote.action);assert.equal(receipt.financial_effect,false);return {...x,receipt,id:receipt.dropoff_operation_id};}
export const authorize=(f:any,replaces:string|null=null)=>execute(f,approved(f,quote(f,replaces)));
export const authorizeRevoke=(f:any,issue:string)=>execute(f,approved(f,f.credentials.quoteRevoke(f.a.scope,{issue_operation_id:issue})));
export function assertQuote(f:any,q:Value,generation=1,replaces:string|null=null){
  assert.equal(q.approval_required,true);assert.equal(q.execution_authorized,false);assert.match(q.id,/^[A-Za-z0-9_-]+$/);assert.match(q.digest,/^[a-f0-9]{64}$/);
  assert.equal(q.quote.action,ISSUE);assert.equal(q.quote.request_id,f.request.id);assert.deepEqual(q.quote.items,E.items);assert.deepEqual(pick(q.quote.method,Object.keys(E.method)),E.method);
  assert.equal(q.quote.generation,generation);assert.equal(q.quote.replaces_operation_id,replaces);assert.equal(q.quote.credential_expires_at,f.now()+E.credential_ttl_ms);
}
export const documentRows=(db:DatabaseSync)=>db.prepare("SELECT * FROM commerce_support_documents WHERE kind IN ('dropoff_credential_quote','dropoff_credential_operation') ORDER BY kind,id,version").all() as Value[];
export const operationRow=(db:DatabaseSync,id:string)=>db.prepare('SELECT * FROM commerce_support_documents WHERE kind=? AND id=? AND version=1').get(OP_KIND,id) as Value;
export const nativeOperation=(db:DatabaseSync,id:string)=>db.prepare('SELECT * FROM commerce_operations WHERE id=?').get(id) as Value;
export const nativeWork=(db:DatabaseSync,id:string)=>db.prepare('SELECT * FROM commerce_operation_work WHERE operation_id=?').get(id) as Value;
export const nativeState=(db:DatabaseSync,id:string)=>({document:operationRow(db,id),operation:nativeOperation(db,id),work:nativeWork(db,id),receipts:db.prepare('SELECT * FROM commerce_operation_receipts WHERE operation_id=? ORDER BY seq').all(id)});
export function projection(f:any,id:string,state:string,attempts:number,scope=f.a.scope){const v=f.credentials.read(scope,id);assert.equal(v.operation_id,id);assert.equal(v.state,state);assert.equal(v.attempt_count,attempts);assert.equal(v.financial_effect,false);assert.equal(nativeOperation(f.db,id).state,E.native_states[state].operation);assert.equal(nativeWork(f.db,id).state,E.native_states[state].work);assert.equal(nativeWork(f.db,id).attempts,attempts);return v;}
export const sourceRows=(f:any)=>f.partnerDb.prepare('SELECT * FROM fixture_dropoff_credential_operations ORDER BY operation_id').all() as Value[];
export const credentialRows=(f:any)=>f.partnerDb.prepare('SELECT * FROM fixture_dropoff_credentials ORDER BY generation,operation_id').all() as Value[];
export const sourceState=(f:any)=>({journal:sourceRows(f),credentials:credentialRows(f)});
export function sourceCounts(f:any,journal:number,credentials:number){assert.equal(sourceRows(f).length,journal);assert.equal(credentialRows(f).length,credentials);assert.equal(f.credentialSource.journal().length,journal);}
export function original(f:any,x:Value,state='issued'){
  const row=sourceRows(f).find(r=>r.operation_id===x.id);assert.ok(row,'original operation must exist in independent provider journal');const command=JSON.parse(row.command),result=JSON.parse(row.result);
  assert.deepEqual(Object.keys(command).sort(),COMMAND_FIELDS);assert.deepEqual(Object.keys(result).sort(),RESULT_FIELDS);assert.equal(row.command_digest,contentDigest(command));
  assert.equal(command.operation_id,x.id);assert.equal(command.action,x.q.quote.action);assert.equal(command.tenant_id,f.a.tenant);assert.equal(command.store_id,f.a.store);assert.equal(command.resource_id,f.resourceId);
  assert.equal(command.source_id,x.receipt.id);assert.equal(command.source_identity,f.credentialSource.identity);assert.equal(command.source_contract,'rifare-dropoff-credential-fixture-v1');assert.equal(command.source_account_id,E.provider_account_id);assert.equal(command.directory_identity,f.source.identity);
  assert.equal(command.quote_id,x.q.id);assert.equal(command.quote_digest,x.q.digest);assert.equal(command.family_ref,contentDigest([f.a.tenant,f.a.store,f.request.id]));assert.equal(command.financial_effect,false);
  if(command.action===ISSUE){assert.equal(command.items_digest,contentDigest(E.items));assert.equal(command.site_id,E.method.site_id);assert.equal(command.destination_id,E.method.destination_id);assert.equal(command.method_id,E.method.method_id);assert.equal(command.credential_kind,'qr');assert.equal(command.generation,x.q.quote.generation);assert.equal(command.replaces_operation_id,x.q.quote.replaces_operation_id);assert.equal(command.issue_operation_id,null);assert.equal(command.credential_expires_at,x.q.quote.credential_expires_at);}
  assert.equal(result.operation_id,x.id);assert.equal(result.action,command.action);assert.equal(result.state,state);assert.equal(result.command_digest,row.command_digest);assert.equal(result.family_ref,command.family_ref);assert.equal(result.items_digest,command.items_digest);assert.equal(result.method_digest,command.method_digest);assert.equal(result.source_identity,f.credentialSource.identity);assert.equal(result.source_account_id,E.provider_account_id);
  const {digest:hash,...body}=result;assert.equal(hash,contentDigest(body));assert.deepEqual(f.credentialSource.lookup(x.id),result);return {row,command,result};
}
export function status(f:any,id:string,state:string,generation=1){const v=f.credentialSource.credential(id);assert.ok(v);assert.deepEqual(Object.keys(v).sort(),STATUS_FIELDS);const {digest:hash,...raw}=v;assert.equal(hash,contentDigest(raw));assert.equal(v.operation_id,id);assert.equal(v.state,state);assert.equal(v.generation,generation);assert.equal(v.source_identity,f.credentialSource.identity);assert.equal(v.source_account_id,E.provider_account_id);return v;}
export function verify(f:any,payload:string,id:string,usable:boolean,state:string,generation=1){const v=f.credentialSource.verify(payload);assert.equal(v.usable,usable);assert.equal(v.state,state);assert.equal(v.operation_id,id);assert.equal(v.generation,generation);assert.equal(v.financial_effect,false);assert.equal(v.physical_handoff,false);return v;}
export function secretless(f:any,payload:string,extra:unknown=[]){assert.ok(payload.length>10);const records=[databaseState(f.db),sourceRows(f),credentialRows(f),f.credentialSource.journal(),extra];assert.equal(JSON.stringify(records).includes(payload),false,'plaintext must not enter ordinary records or provider persistence');assert.equal(JSON.stringify(records).includes(f.key.toString('base64')),false,'the injected encryption key is not persisted');assert.equal(readFileSync(join(f.directory,'dropoff-partner.sqlite')).includes(Buffer.from(payload)),false);}
export function unrelated(f:any){const core=databaseState(f.db),pattern=/^commerce_(case_effects|resolution_|payment_|fulfillment_|warehouse_|inventory_|partner_|custody_|return_destinations|destination_|support_deliveries|credit_|instant_)/;return {core:Object.fromEntries(Object.entries(core).filter(([name])=>pattern.test(name))),fulfillment:databaseState(f.fulfillmentDb),warehouse:databaseState(f.warehouseDb),partner:Object.fromEntries(Object.entries(databaseState(f.partnerDb)).filter(([name])=>!name.startsWith('fixture_dropoff_credential')))};}
export const proofRow=(f:any)=>f.db.prepare('SELECT * FROM commerce_sessions WHERE token_hash=?').get(digest(f.customerBearer)) as Value;
export function withMethod<T>(value:any,name:string,replace:(original:Function,...args:any[])=>any,fn:()=>T):T{const proto=Object.getPrototypeOf(value),descriptor=Object.getOwnPropertyDescriptor(proto,name);assert.equal(typeof descriptor?.value,'function');Object.defineProperty(proto,name,{...descriptor,value:function(...args:any[]){return this===value?replace(descriptor!.value.bind(this),...args):descriptor!.value.apply(this,args);}});try{return fn();}finally{Object.defineProperty(proto,name,descriptor!);}}
export function rehash(value:Value,patch:Value){const {digest:_digest,...raw}=value,body={...raw,...patch};return {...body,digest:contentDigest(body)};}
export function writeDocument(db:DatabaseSync,row:Value,body:Value){db.prepare('UPDATE commerce_support_documents SET body=?,digest=? WHERE tenant_id=? AND store_id=? AND kind=? AND id=? AND version=?').run(canonical(body),contentDigest(body),row.tenant_id,row.store_id,row.kind,row.id,row.version);}
export function restoreDocument(db:DatabaseSync,row:Value){db.prepare('UPDATE commerce_support_documents SET body=?,digest=? WHERE tenant_id=? AND store_id=? AND kind=? AND id=? AND version=?').run(row.body,row.digest,row.tenant_id,row.store_id,row.kind,row.id,row.version);}
export function minimized(db:DatabaseSync,id:string){const rows=documentRows(db),op=operationRow(db,id);assert.ok(op);for(const row of rows){const body=JSON.parse(row.body);assert.equal(body.minimized,true);assert.equal(body.authority_revoked,true);assert.equal(row.digest,contentDigest(body));assert.equal(body[row.kind===QUOTE_KIND?'terms':'personal'],null);}assert.equal(JSON.stringify(rows).includes(E.customer_id),false);return JSON.parse(op.body);}
export function retireSubject(f:any){const rows=f.db.prepare("SELECT * FROM commerce_resources WHERE tenant_id=? AND store_id=? AND (customer_id=? OR (kind='customer' AND external_id=?))").all(f.a.tenant,f.a.store,E.customer_id,E.customer_id) as Value[];for(const row of rows){if(row.kind==='customer')f.db.prepare('DELETE FROM commerce_resources WHERE id=?').run(row.id);else updateResource(f,{...row,payload:JSON.parse(row.payload)},JSON.parse(row.payload),'C-1002');}}
export const backup=(f:any)=>createRecoverySnapshot(f.kernel,join(f.directory,'credential-backup'));
export function restore(f:any,saved:any,label='credential-restored'){
  const cp=suppressionCheckpoint(f.kernel),result=restoreRecoverySnapshot({snapshot:saved.directory,destination:join(f.directory,label),manifest_sha256:saved.manifest_sha256,suppression:cp,suppression_sha256:contentDigest(cp)},f.now),db=new DatabaseSync(result.database),kernel=new CommerceKernel(db,f.now),scope=kernel.authenticate(kernel.issueSession(f.a.tenant,f.a.store,'owner'));
  return {...f,result,db,kernel,a:{...f.a,scope},scope,...owners(kernel,f.source,f.keys),close:()=>db.close()};
}
export const merchant=(f:any)=>exportMerchant(f.kernel,f.owner.scope,{snapshot_id:'credential-snapshot'});
export const suppression=(f:any)=>{const cp=exportMerchantSuppression(f.kernel,f.owner.scope);return {suppression:cp,suppression_sha256:merchantSnapshotDigest(cp)};};
export function target(f:any){const db=new DatabaseSync(':memory:'),kernel=new CommerceKernel(db,f.now);kernel.provisionStore(f.a.tenant,f.a.store);kernel.provisionMember(f.a.tenant,f.a.store,'destination_owner','owner');const scope=kernel.authenticate(kernel.issueSession(f.a.tenant,f.a.store,'destination_owner'));return {...f,db,kernel,a:{...f.a,scope},scope,...owners(kernel,f.source,f.keys),close:()=>db.close()};}
export const transfer=(f:any,t:any,packed:Value,cp=suppression(f))=>importMerchant(t.kernel,t.scope,packed,packed.digest,cp);
