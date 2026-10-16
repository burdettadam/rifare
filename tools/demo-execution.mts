import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes,createHmac } from 'node:crypto';
import { CommerceKernel } from '../packages/commerce/kernel.mts';
import { Capabilities } from '../packages/commerce/capabilities.mts';
import { StoreSimulator } from '../packages/commerce/simulator.mts';
import { ReadContext } from '../packages/commerce/read-context.mts';
import { loadSkillDirectory } from '../packages/commerce/skills.mts';
import { Policies } from '../packages/commerce/policies.mts';
import { CustomerAccess } from '../packages/commerce/customer-access.mts';
import { ActionGateway } from '../packages/commerce/action-gateway.mts';
import { WebhookInbox } from '../packages/commerce/webhook-inbox.mts';
import { startCommerceServer } from '../apps/commerce-api/server.mts';

const args=process.argv.slice(2);
if(args.length>1||(args.length===1&&args[0]!=='--serve'))throw new Error('Use --serve or no arguments.');
const db=new DatabaseSync(':memory:'),key=randomBytes(32);let temporary:string|undefined;
let server:Awaited<ReturnType<typeof startCommerceServer>>|undefined;
try{
  const seedTime=Date.now();let seeding=true;
  const kernel=new CommerceKernel(db,()=>seeding?seedTime:Date.now()),caps=new Capabilities(kernel),simulator=new StoreSimulator(kernel,caps),reads=new ReadContext(kernel,caps);
  kernel.provisionStore('demo','store');
  const actor=(name:string,role:'owner'|'operator'|'reviewer'|'agent')=>{
    kernel.provisionMember('demo','store',name,role);const bearer=kernel.issueSession('demo','store',name);
    return {scope:kernel.authenticate(bearer),bearer};};
  const owner=actor('local-owner','owner'),operator=actor('local-operator','operator'),reviewer=actor('local-reviewer','reviewer'),agent=actor('local-agent','agent');
  simulator.reset(operator.scope);
  const bundle=loadSkillDirectory(fileURLToPath(new URL('../packages/commerce/skill-bundles/order-status/',import.meta.url)));
  reads.skills.install(operator.scope,bundle);
  reads.profiles.put(operator.scope,{id:'default',revision:1,tenant_id:'demo',store_id:'store',skill_id:bundle.id,skill_digest:bundle.digest,
    tone:'neutral',locale:'en-US',actions:['order.status','knowledge.search','knowledge.get','skill.read'],data_scope:{order:'session_or_store',knowledge:'visible_only'}});
  const policies=new Policies(kernel),rules={window_days:30,require_evidence:true,excluded_tags:['final-sale'],outcomes:['refund','exchange']};
  const p=policies.create(operator.scope,{policy_id:'returns',expected_version:0,rules,selection:'pin_at_request',sources:[{uri:'https://merchant.example.invalid/policy',revision:'1',sha256:'a'.repeat(64)}]});
  policies.test(operator.scope,'returns',1,p.digest);policies.review(reviewer.scope,'returns',1,p.digest);
  policies.publish(owner.scope,{policy_id:'returns',version:1,digest:p.digest,expected_published_version:0,effective_at:kernel.clock()});
  const order=kernel.lookup(operator.scope,'order','synthetic','ORD-1001');
  kernel.ingest(operator.scope,{kind:'order',source_system:'synthetic',external_id:order.external_id,source_version:2,source_updated_at:kernel.clock(),customer_id:order.customer_id,
    payload:{...order.payload,delivered_at:kernel.clock()-3*86400000,tags:[],evidence_verified:true}});
  const outbox:any[]=[],customers=new CustomerAccess(kernel,m=>outbox.push(m));
  const challenge=customers.request({store_id:'store',order_number:'ORD-1001',email:'shopper-apparel@example.invalid'},'127.0.0.1');
  const verified=customers.complete({store_id:'store',challenge_id:challenge.challenge_id,proof:outbox.at(-1).proof});outbox.length=0;
  const gateway=new ActionGateway(kernel);gateway.configure(owner.scope,{enabled:true,expected_revision:0,profile_id:'default',policy_id:'returns'});
  const pinned=gateway.cases.create(kernel.authenticate(verified.token),{case_id:'demo_case',resource_id:order.id,profile_id:'default',policy_id:'returns'});
  const inbox=new WebhookInbox(kernel,ref=>ref==='demo-key'?key:undefined);
  const route=inbox.register(owner.scope,{provider:'synthetic',topic:'orders/updated',shop_domain:'demo.example.invalid',api_version:'2026-10',key_ref:'demo-key'});
  if(args[0]==='--serve'){
    seeding=false;
    server=await startCommerceServer({kernel,caps,simulator,reads,customers,inbox});temporary=mkdtempSync(join(tmpdir(),'rifare-execution-'));
    const path=join(temporary,'sessions.json');writeFileSync(path,JSON.stringify({operator:operator.bearer,reviewer:reviewer.bearer,case_id:'demo_case'},null,2),{mode:0o600});
    console.log(JSON.stringify({profile:'ephemeral_synthetic_execution',url:server.url+'/execution',private_session_file:path,external_calls:0,production_qualified:false}));
    await new Promise<void>(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});
  }else{
    const preview=gateway.prepare(operator.scope,{case_id:'demo_case',action:'diagnostic.resolution.set',arguments:{resolution:'refund'}});
    const approval=gateway.approve(reviewer.scope,{preview_id:preview.id,preview_digest:preview.digest});
    const receipt=gateway.execute(agent.scope,{preview_id:preview.id,preview_digest:preview.digest,approval_id:approval.id});
    let replay='UNEXPECTED_SUCCESS';try{gateway.execute(agent.scope,{preview_id:preview.id,preview_digest:preview.digest,approval_id:approval.id});}catch(e){replay=(e as Error).message;}
    const undo=gateway.prepare(operator.scope,{case_id:'demo_case',action:'diagnostic.resolution.set',arguments:{resolution:'none'}}),undoApproval=gateway.approve(reviewer.scope,{preview_id:undo.id,preview_digest:undo.digest});
    gateway.execute(operator.scope,{preview_id:undo.id,preview_digest:undo.digest,approval_id:undoApproval.id});
    const raw=Buffer.from('{"order":"ORD-1001","version":3}'),at=String(kernel.clock()),delivery='demo-delivery';
    const prefix=JSON.stringify([route.id,route.shop_domain,route.topic,delivery,at])+'\n';
    const headers=['Content-Type','application/json','X-Rifare-Shop',route.shop_domain,'X-Rifare-Topic',route.topic,'X-Rifare-Delivery',delivery,'X-Rifare-Timestamp',at,
      'X-Rifare-Signature',createHmac('sha256',key).update(Buffer.concat([Buffer.from(prefix),raw])).digest('base64')];
    const event=inbox.receive(route.id,headers,raw),duplicate=inbox.receive(route.id,headers,raw);
    console.log(JSON.stringify({evidence_kind:'synthetic_in_memory_demonstration',case:pinned,preview,receipt,replay_rejected:replay,restored_plan:gateway.state(operator.scope,'demo_case'),
      webhook:{status:event.status,duplicate:duplicate.duplicate,persisted:inbox.read(operator.scope,event.id).id===event.id},external_calls:0,production_qualified:false,
      actors:'synthetic demo roles; not independent project reviewers'},null,2));
  }
}finally{await server?.close();db.close();key.fill(0);if(temporary)rmSync(temporary,{recursive:true,force:true});}
