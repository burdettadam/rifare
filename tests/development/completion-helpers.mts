import {DatabaseSync} from 'node:sqlite';
import {join,resolve} from 'node:path';
import {fulfillmentFixture} from './fulfillment-helpers.mts';
import {ReturnReceiving} from '../../packages/commerce/return-receiving.mts';
import {ReturnDisposition} from '../../packages/commerce/return-disposition.mts';
import {ReturnCancellation} from '../../packages/commerce/return-cancellation.mts';
import {ReturnWorkflows} from '../../packages/commerce/return-workflows.mts';
import {NativeChangeReconciliation} from '../../packages/commerce/native-change-reconciliation.mts';
import {WarehouseFixtureSource} from '../../packages/adapters/warehouse-fixture-source.mts';
import {NativeChangeFixtureSource} from '../../packages/adapters/native-change-fixture-source.mts';
import {SkillInstaller,readInstructionDirectory} from '../../packages/commerce/skill-installer.mts';
export async function completionFixture(){const f=await fulfillmentFixture(),warehouseFile=join(f.directory,'warehouse.sqlite'),warehouseDb=new DatabaseSync(warehouseFile),feedFile=join(f.directory,'changes.sqlite'),feedDb=new DatabaseSync(feedFile);
 const warehouse=new WarehouseFixtureSource(warehouseDb,{mode:'fixture',identity:'warehouse-fixture',tenant:f.a.tenant,store:f.a.store}),feed=new NativeChangeFixtureSource(feedDb,{mode:'fixture',identity:'changes-fixture',tenant:f.a.tenant,store:f.a.store});
 const receiving=new ReturnReceiving(f.kernel),disposition=new ReturnDisposition(f.kernel,warehouse),cancellation=new ReturnCancellation(f.kernel),workflows=new ReturnWorkflows(f.kernel),changes=new NativeChangeReconciliation(f.kernel,feed);
 for(const variant of ['shirt-small','hat-small','shoe-small'])warehouse.seed(variant,'warehouse-one',0);
 disposition.configure(f.owner.scope,{expected_revision:0,enabled:true,source_identity:warehouse.identity,locations:['warehouse-one'],expires_at:f.now()+3600000});
 const installer=new SkillInstaller(f.kernel),bundles:any={};
 for(const name of ['handle-return','handle-exchange']){const bundle=readInstructionDirectory(resolve('packages/commerce/skill-bundles',name)),origin='https://rifare.invalid/skills/'+name,approval=installer.approve(f.owner.scope,{origin,bundle_digest:bundle.digest,skill_id:bundle.id,version:bundle.version,expires_at:f.now()+3600000});installer.install(f.a.scope,approval.id,{origin,bundle});bundles[name]={...bundle,approval_id:approval.id};}
 const authorizeLife=(q:any)=>{const p=f.gateway.prepare(f.a.scope,q.proposal),a=f.gateway.approve(f.reviewer.scope,{preview_id:p.id,preview_digest:p.digest}),receipt=f.gateway.execute(f.a.scope,{preview_id:p.id,preview_digest:p.digest,approval_id:a.id});return {id:receipt.lifecycle_operation_id,receipt,preview:p,approval:a};};
 const open=()=>receiving.open(f.a.scope,{request_id:f.request.id,location_id:'warehouse-one'});
 const item=(line='alpha',grade='sellable',quantity=1)=>({line_id:line,observed_variant:({alpha:'shirt-small',beta:'hat-small',gamma:'shoe-small'} as any)[line]??'wrong-item',quantity,grade,evidence_ids:[]});
 const scan=(items:any[],scanId='scan_one',revision?:number)=>{const s=open();return receiving.scan(f.a.scope,{session_id:s.session_id,scan_id:scanId,expected_revision:revision??s.revision,items});};
 const full=(damage=false)=>{const s=scan([item(),item('beta',damage?'damaged':'sellable'),item('gamma')]);return receiving.close(f.a.scope,{session_id:s.session_id,expected_revision:s.revision});};
 const snapshot=(overrides:any={})=>({request_id:f.request.id,resource_id:f.order().id,native_return_id:'gid://shopify/Return/900',source_version:1,observed_at:f.now(),exists:true,return_status:'OPEN',payment_id:f.order().payload.resolution_facts.payment_id,currency:'USD',base_refunded_minor:'1940',refunds:[],completed_units:[],receipts:[],replacements:[],...overrides});
 const enableFeed=()=>changes.configure(f.owner.scope,{expected_revision:0,enabled:true,source_identity:feed.identity,expires_at:f.now()+3600000,max_age_ms:300000});
 return {...f,warehouseFile,warehouseDb,warehouse,feedFile,feedDb,feed,receiving,disposition,cancellation,workflows,changes,installer,bundles,authorizeLife,open,item,scan,full,snapshot,enableFeed,
  cleanup(){warehouseDb.close();feedDb.close();f.cleanup();}};
}
export async function usingCompletion(fn:(f:Awaited<ReturnType<typeof completionFixture>>)=>unknown){const f=await completionFixture();try{return await fn(f);}finally{f.cleanup();}}
