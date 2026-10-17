import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { executionFixture } from './execution-helpers.mts';
import { OrderEditFixtureSource } from '../../packages/adapters/order-edit-fixture-source.mts';
import { OrderEdits } from '../../packages/commerce/order-edit-execution.mts';
export function editFixture(options:any={}){
 const f=executionFixture(),sourceFile=join(f.directory,'edit-source.sqlite'),sourceDb=new DatabaseSync(sourceFile),native=new OrderEditFixtureSource(sourceDb,{mode:'fixture',identity:'edit-fixture',tenant:f.a.tenant,store:f.a.store},f.now);
 const original=f.order(),line={id:'line_one',variant_id:'basic',product_id:'shirt',warehouse_id:'warehouse_one',quantity:1,unit_minor:'2000',discount_minor:'0',tax_minor:'0',tax_bps:0,status:'unfulfilled',subscription:false};
 const order={tenant_id:f.a.tenant,store_id:f.a.store,resource_id:original.id,customer_id:original.customer_id,version:1,created_at:f.now()-1000,currency:'USD',shipping_minor:'0',total_minor:'2000',net_paid_minor:'2000',balance_due_minor:'0',financial_state:'paid',cancelled:false,
  address:{name:'Synthetic Customer',line1:'1 Test Street',city:'Provo',state:'UT',postal:'84601',country:'US'},lines:[line],...options.order};
 const catalog=[{id:'basic',unit_minor:'2000'},{id:'equal',unit_minor:'2000'},{id:'upgrade',unit_minor:'3000'},{id:'cheaper',unit_minor:'1000'}].map(v=>({...v,product_id:'shirt',stock:10,currency:'USD',tax_bps:0,subscription:false,excluded:false,available:true}));
 native.seed(order,options.catalog??catalog);const edits=new OrderEdits(f.kernel,native,100),settings={expected_revision:0,enabled:true,expires_at:f.now()+3600000,max_age_ms:300000,warehouses:[...new Set(order.lines.map((l:any)=>l.warehouse_id))],rules:{windows_ms:{address:60000,item:120000,cancel:180000},inventory_buffer:1,payment_ttl_ms:60000}};
 edits.configure(f.owner.scope,settings);edits.refresh(f.a.scope,'case_one');
 const intent=(extras:any={})=>({case_id:'case_one',kind:'item',line_id:'line_one',variant_id:'equal',address:null,...extras});
 const quote=(extras:any={})=>edits.quote(f.a.scope,intent(extras));
 const authorize=(q=quote())=>{const p=edits.prepare(f.a.scope,{quote_id:q.id,quote_digest:q.digest}),a=f.gateway.approve(f.reviewer.scope,{preview_id:p.id,preview_digest:p.digest});return f.gateway.execute(f.a.scope,{preview_id:p.id,preview_digest:p.digest,approval_id:a.id});};
 return {...f,native,sourceDb,sourceFile,edits,settings,order,original,catalog,intent,quote,authorize,cleanup:()=>{sourceDb.close();f.cleanup();}};
}
export async function usingEdits(fn:(f:ReturnType<typeof editFixture>)=>unknown,options:any={}){const f=editFixture(options);try{return await fn(f);}finally{f.cleanup();}}
import {fileURLToPath} from 'node:url';
import {SkillInstaller,readInstructionDirectory} from '../../packages/commerce/skill-installer.mts';
import {OrderEditWorkflow} from '../../packages/commerce/order-edit-workflow.mts';
export function installEditSkill(f:ReturnType<typeof editFixture>){const installer=new SkillInstaller(f.kernel),bundle=readInstructionDirectory(fileURLToPath(new URL('../../packages/commerce/skill-bundles/safe-order-edit/',import.meta.url))),origin='https://rifare.invalid/bundles/safe-order-edit',a=installer.approve(f.owner.scope,{origin,bundle_digest:bundle.digest,skill_id:bundle.id,version:bundle.version,expires_at:f.now()+3600000});installer.install(f.a.scope,a.id,{origin,bundle});const workflow=new OrderEditWorkflow(f.edits);workflow.open(f.a.scope,{case_id:'case_one',skill_digest:bundle.digest});return {workflow,bundle,installer,approval:a};}
