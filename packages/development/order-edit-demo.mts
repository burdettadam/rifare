import {DatabaseSync} from 'node:sqlite';import {fileURLToPath} from 'node:url';
import {CommerceKernel,id} from '../commerce/kernel.mts';
import {Capabilities} from '../commerce/capabilities.mts';
import {StoreSimulator} from '../commerce/simulator.mts';
import {ReadContext} from '../commerce/read-context.mts';
import {Policies} from '../commerce/policies.mts';
import {CustomerAccess} from '../commerce/customer-access.mts';
import {ActionGateway} from '../commerce/action-gateway.mts';
import {loadSkillDirectory} from '../commerce/skills.mts';
import {SkillInstaller,readInstructionDirectory} from '../commerce/skill-installer.mts';
import {OrderEdits} from '../commerce/order-edit-execution.mts';
import {OrderEditWorkflow} from '../commerce/order-edit-workflow.mts';
import {OrderEditFixtureSource} from '../adapters/order-edit-fixture-source.mts';
/** In-memory diagnostic setup, separate source system and no test imports. */
export function createOrderEditDemo(options:{store?:string;item_window_ms?:number;at?:number}={}){
 if(Object.keys(options).some(k=>!['store','item_window_ms','at'].includes(k)))throw new Error('INVALID_INPUT');const store=options.store??'edit_demo';id(store);let at=options.at??Date.now();
 const db=new DatabaseSync(':memory:'),sourceDb=new DatabaseSync(':memory:');try{
 const kernel=new CommerceKernel(db,()=>at),caps=new Capabilities(kernel),simulator=new StoreSimulator(kernel,caps),reads=new ReadContext(kernel,caps),outbox:any[]=[],customers=new CustomerAccess(kernel,m=>outbox.push(m));
 kernel.provisionStore('demo',store);const actor=(name:string,role:any)=>{kernel.provisionMember('demo',store,name,role);const token=kernel.issueSession('demo',store,name);return {token,scope:kernel.authenticate(token)};};
 const owner=actor('owner','owner'),operator=actor('operator','operator'),reviewer=actor('reviewer','reviewer');simulator.reset(operator.scope);
 const base=loadSkillDirectory(fileURLToPath(new URL('../commerce/skill-bundles/return-draft/',import.meta.url)));reads.skills.install(operator.scope,base);reads.profiles.put(operator.scope,{id:'default',revision:1,tenant_id:'demo',store_id:store,skill_id:base.id,skill_digest:base.digest,tone:'neutral',locale:'en-US',actions:['order.status','knowledge.search','knowledge.get','skill.read'],data_scope:{order:'session_or_store',knowledge:'visible_only'}});
 const policies=new Policies(kernel),p=policies.create(operator.scope,{policy_id:'returns',expected_version:0,rules:{window_days:30,require_evidence:false,excluded_tags:['final-sale'],outcomes:['refund','exchange','store_credit']},selection:'pin_at_request',sources:[{uri:'https://merchant.example.invalid/policy',revision:'1',sha256:'a'.repeat(64)}]});policies.test(operator.scope,'returns',1,p.digest);policies.review(reviewer.scope,'returns',1,p.digest);policies.publish(owner.scope,{policy_id:'returns',version:1,digest:p.digest,expected_published_version:0,effective_at:at});
 const order=kernel.lookup(operator.scope,'order','synthetic','ORD-1001'),challenge=customers.request({store_id:store,order_number:'ORD-1001',email:'shopper-apparel@example.invalid'},'127.0.0.1'),verified=customers.complete({store_id:store,challenge_id:challenge.challenge_id,proof:outbox.at(-1).proof});outbox.length=0;
 const gateway=new ActionGateway(kernel);gateway.configure(owner.scope,{enabled:true,expected_revision:0,profile_id:'default',policy_id:'returns'});gateway.cases.create(kernel.authenticate(verified.token),{case_id:'edit_case',resource_id:order.id,profile_id:'default',policy_id:'returns'});
 const source=new OrderEditFixtureSource(sourceDb,{mode:'fixture',identity:'demo_order_edit',tenant:'demo',store},()=>at);source.seed({tenant_id:'demo',store_id:store,resource_id:order.id,customer_id:order.customer_id,version:1,created_at:at-1000,currency:'USD',shipping_minor:'0',total_minor:'2000',net_paid_minor:'2000',balance_due_minor:'0',financial_state:'paid',cancelled:false,address:{name:'Synthetic Customer',line1:'1 Test Street',city:'Provo',state:'UT',postal:'84601',country:'US'},lines:[{id:'line_one',variant_id:'basic',product_id:'shirt',warehouse_id:'warehouse_one',quantity:1,unit_minor:'2000',discount_minor:'0',tax_minor:'0',tax_bps:0,status:'unfulfilled',subscription:false}]},[{id:'basic',unit_minor:'2000'},{id:'equal',unit_minor:'2000'},{id:'upgrade',unit_minor:'3000'},{id:'cheaper',unit_minor:'1000'}].map(v=>({...v,product_id:'shirt',stock:10,currency:'USD',tax_bps:0,subscription:false,excluded:false,available:true})));
 const edits=new OrderEdits(kernel,source),workflows=new OrderEditWorkflow(edits);edits.configure(owner.scope,{expected_revision:0,enabled:true,expires_at:at+3600000,max_age_ms:300000,warehouses:['warehouse_one'],rules:{windows_ms:{address:60000,item:options.item_window_ms??120000,cancel:180000},inventory_buffer:1,payment_ttl_ms:60000}});edits.refresh(operator.scope,'edit_case');
 const bundle=readInstructionDirectory(fileURLToPath(new URL('../commerce/skill-bundles/safe-order-edit/',import.meta.url))),installer=new SkillInstaller(kernel),origin='https://rifare.invalid/bundles/safe-order-edit',approval=installer.approve(owner.scope,{origin,bundle_digest:bundle.digest,skill_id:bundle.id,version:bundle.version,expires_at:at+3600000});installer.install(operator.scope,approval.id,{origin,bundle});workflows.open(operator.scope,{case_id:'edit_case',skill_digest:bundle.digest});
 const intent=(variant='upgrade')=>({case_id:'edit_case',kind:'item',line_id:'line_one',variant_id:variant,address:null});const authorize=(input=intent())=>{const q=edits.quote(operator.scope,input),p=edits.prepare(operator.scope,{quote_id:q.id,quote_digest:q.digest}),a=gateway.approve(reviewer.scope,{preview_id:p.id,preview_digest:p.digest});return gateway.execute(operator.scope,{preview_id:p.id,preview_digest:p.digest,approval_id:a.id});};
 return {db,sourceDb,kernel,caps,simulator,reads,customers,owner,operator,reviewer,order,source,edits,workflows,gateway,skill_digest:bundle.digest,intent,authorize,advance:(ms:number)=>{at+=ms;},cleanup:()=>{db.close();sourceDb.close();}};
 }catch(e){db.close();sourceDb.close();throw e;}
}
