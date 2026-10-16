import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CommerceKernel } from '../packages/commerce/kernel.mts';
import { Capabilities } from '../packages/commerce/capabilities.mts';
import { StoreSimulator } from '../packages/commerce/simulator.mts';
import { ReadContext } from '../packages/commerce/read-context.mts';
import { Policies } from '../packages/commerce/policies.mts';
import { CustomerAccess } from '../packages/commerce/customer-access.mts';
import { ActionGateway } from '../packages/commerce/action-gateway.mts';
import { loadSkillDirectory } from '../packages/commerce/skills.mts';
import { ReturnIntake } from '../packages/commerce/return-intake.mts';
import { NativeReturns } from '../packages/commerce/native-returns.mts';
import { ShopifyReturnFixtureAdapter,CREATE_RETURN } from '../packages/adapters/shopify-return-fixture.mts';
import { IntegrationReadiness,DRAFT_ACTION } from '../packages/commerce/integration-readiness.mts';
import { startCommerceServer } from '../apps/commerce-api/server.mts';

const args=process.argv.slice(2);if(args.length>1||(args.length===1&&args[0]!=='--serve'))throw new Error('Use --serve or no arguments.');
const directory=mkdtempSync(join(tmpdir(),'rifare-returns-')),db=new DatabaseSync(':memory:');
let server:Awaited<ReturnType<typeof startCommerceServer>>|undefined;
try {
 const at=Date.now();let fixed=true;
 const kernel=new CommerceKernel(db,()=>fixed?at:Date.now()),caps=new Capabilities(kernel),simulator=new StoreSimulator(kernel,caps),reads=new ReadContext(kernel,caps);
 const outbox:any[]=[],customers=new CustomerAccess(kernel,m=>outbox.push(m));
 const bundle=loadSkillDirectory(fileURLToPath(new URL('../packages/commerce/skill-bundles/return-draft/',import.meta.url)));
 const gateway=new ActionGateway(kernel),intake=new ReturnIntake(kernel),policies=new Policies(kernel),readiness=new IntegrationReadiness(kernel);
 const seed=(store:string,window:number)=>{
  kernel.provisionStore('demo',store);
  const actor=(name:string,role:'owner'|'operator'|'reviewer')=>{kernel.provisionMember('demo',store,name,role);const token=kernel.issueSession('demo',store,name);return {token,scope:kernel.authenticate(token)};};
  const owner=actor('owner','owner'),operator=actor('operator','operator'),reviewer=actor('reviewer','reviewer');simulator.reset(operator.scope);
  reads.skills.install(operator.scope,bundle);reads.profiles.put(operator.scope,{id:'default',revision:1,tenant_id:'demo',store_id:store,skill_id:bundle.id,skill_digest:bundle.digest,tone:'neutral',locale:'en-US',actions:['order.status','knowledge.search','knowledge.get','skill.read'],data_scope:{order:'session_or_store',knowledge:'visible_only'}});
  const p=policies.create(operator.scope,{policy_id:'returns',expected_version:0,rules:{window_days:window,require_evidence:false,excluded_tags:['final-sale'],outcomes:['refund','exchange']},selection:'pin_at_request',sources:[{uri:'https://merchant.example.invalid/policy',revision:'1',sha256:'a'.repeat(64)}]});
  policies.test(operator.scope,'returns',1,p.digest);policies.review(reviewer.scope,'returns',1,p.digest);policies.publish(owner.scope,{policy_id:'returns',version:1,digest:p.digest,expected_published_version:0,effective_at:kernel.clock()});
  const order=kernel.lookup(operator.scope,'order','synthetic','ORD-1001');kernel.ingest(operator.scope,{kind:'order',source_system:'synthetic',external_id:order.external_id,source_version:2,source_updated_at:kernel.clock(),customer_id:order.customer_id,payload:{...order.payload,delivered_at:at-3*86400000,tags:[],evidence_verified:true,native_order_id:'gid://shopify/Order/201',counted_return_ids:[],return_lines:[{id:'shirt',fulfillment_line_id:'gid://shopify/FulfillmentLineItem/101',ordered:3,fulfilled:2,returned:1,unit_minor:'2000',tags:[]},{id:'clearance',fulfillment_line_id:'gid://shopify/FulfillmentLineItem/102',ordered:1,fulfilled:1,returned:0,unit_minor:'500',tags:['final-sale']}]}});
  const challenge=customers.request({store_id:store,order_number:'ORD-1001',email:'shopper-apparel@example.invalid'},'127.0.0.1');const verified=customers.complete({store_id:store,challenge_id:challenge.challenge_id,proof:outbox.at(-1).proof});outbox.length=0;
  gateway.configure(owner.scope,{enabled:true,expected_revision:0,profile_id:'default',policy_id:'returns'});gateway.cases.create(kernel.authenticate(verified.token),{case_id:'return_case',resource_id:order.id,profile_id:'default',policy_id:'returns'});
  intake.configure(owner.scope,{expected_revision:0,settings:{currency:'USD',restocking_bps:1000,shipping_minor:'100',time_zone:'America/Denver',brand:'Sample apparel',contact:'support@example.invalid',override_days:7,retention_days:30}});
  return {store,owner,operator,reviewer,order,window,customer:{token:verified.token,scope:kernel.authenticate(verified.token)}};
 };
 const long=seed('long-window',30),short=seed('short-window',1);
 if(args[0]==='--serve') {
  fixed=false;server=await startCommerceServer({kernel,caps,simulator,reads,customers});const file=join(directory,'sessions.json');
  writeFileSync(file,JSON.stringify({customer:long.customer.token,operator:long.operator.token,reviewer:long.reviewer.token,owner:long.owner.token,case_id:'return_case',short_window_operator:short.operator.token},null,2),{mode:0o600});
  console.log(JSON.stringify({url:server.url+'/returns',private_session_file:file,profile:'verified_item_return_intake',external_calls:0,production_qualified:false}));
  await new Promise<void>(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});
 } else {
  const selection={case_id:'return_case',lines:[{line_id:'shirt',quantity:1}],outcome:'refund',reason:'size',note:'',evidence_ids:[]};
  const q=intake.evaluate(long.customer.scope,selection),denied=intake.evaluate(short.customer.scope,selection);
  const p=intake.prepare(long.customer.scope,{quote_id:q.id,quote_digest:q.digest,request_key:'first-return',override_id:null});
  const a=gateway.approve(long.reviewer.scope,{preview_id:p.preview_id,preview_digest:p.preview_digest});
  gateway.execute(long.operator.scope,{preview_id:p.preview_id,preview_digest:p.preview_digest,approval_id:a.id});
  const source=new DatabaseSync(':memory:');source.exec('CREATE TABLE journal(id TEXT PRIMARY KEY,body TEXT)');let creates=0,lookups=0;
  try {
   const adapter=new ShopifyReturnFixtureAdapter({mode:'fixture',identity:'demo-fixture-journal',tenant:'demo',store:long.store,transport:async({query,variables})=>{
    if(query===CREATE_RETURN){creates++;const input=variables.returnInput,record={id:'gid://shopify/Return/301',status:'OPEN',order:{id:input.orderId},returnLineItems:{nodes:input.returnLineItems.map((l:any,i:number)=>({id:'gid://shopify/ReturnLineItem/'+(401+i),quantity:l.quantity,returnReasonNote:l.returnReasonNote,fulfillmentLineItem:{id:l.fulfillmentLineItemId}})),pageInfo:{hasNextPage:false}},reverseFulfillmentOrders:{nodes:[{id:'gid://shopify/ReverseFulfillmentOrder/501'}],pageInfo:{hasNextPage:false}}};source.prepare('INSERT INTO journal VALUES(?,?)').run(record.id,JSON.stringify(record));throw new Error('RESPONSE_LOST_AFTER_SOURCE_COMMIT');}
    lookups++;const row=source.prepare('SELECT body FROM journal WHERE id=?').get(variables.id) as any;return {status:200,api_version:'2026-10',body:{data:{return:row?JSON.parse(row.body):null}}};
   }});
   const native=new NativeReturns(kernel,adapter),uncertain=await native.create(long.operator.scope,p.id);
   await native.create(long.operator.scope,p.id);const reconciled=await native.reconcile(long.operator.scope,p.id,'gid://shopify/Return/301');
   console.log(JSON.stringify({evidence_kind:'synthetic_item_return_demonstration',shared_pinned_skill:bundle.id,profiles:[{window_days:30,decision:q.quote.decision.decision},{window_days:1,decision:denied.quote.decision.decision}],eligible_quantity:q.quote.decision.lines[0].remaining,fees:q.quote.decision.fees,request_id:p.id,unknown_before_reconciliation:uncertain.state,native_state:reconciled.state,native_reverse_fulfillment:reconciled.native?.reverse_fulfillment_ids,creates,lookups,source_effect_count:source.prepare('SELECT count(*) n FROM journal').get()!.n,financial_effect:false,external_calls:0,production_qualified:false},null,2));
  }finally{source.close();}
 }
} finally {await server?.close();db.close();rmSync(directory,{recursive:true,force:true});}
