import { WorkerApi } from '../packages/commerce/worker-api.mts';
import { ExecutionStops } from '../packages/commerce/execution-stops.mts';
import { ExceptionQueue } from '../packages/commerce/exception-queue.mts';
import { DurableWork } from '../packages/commerce/durable-work.mts';
import { SyntheticJournal } from '../packages/adapters/reliability/synthetic-journal.mts';
import { SecretVault } from '../packages/commerce/secrets.mts';
import { CredentialLifecycle } from '../packages/commerce/credential-lifecycle.mts';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { CommerceKernel } from '../packages/commerce/kernel.mts';
import { Capabilities } from '../packages/commerce/capabilities.mts';
import { StoreSimulator } from '../packages/commerce/simulator.mts';
import { ReadContext } from '../packages/commerce/read-context.mts';
import { loadSkillDirectory } from '../packages/commerce/skills.mts';
import { Policies } from '../packages/commerce/policies.mts';
import { CustomerAccess } from '../packages/commerce/customer-access.mts';
import { ActionGateway } from '../packages/commerce/action-gateway.mts';
import { startCommerceServer } from '../apps/commerce-api/server.mts';

const args=process.argv.slice(2);
if(args.length>1||(args.length===1&&args[0]!=='--serve'))throw new Error('Use --serve or no arguments.');
const db=new DatabaseSync(':memory:'),sourceDB=new DatabaseSync(':memory:'),key=randomBytes(32);let temporary:string|undefined;
let server:Awaited<ReturnType<typeof startCommerceServer>>|undefined;
try{
  let now=Date.now(),live=false;
  const kernel=new CommerceKernel(db,()=>live?Date.now():now),caps=new Capabilities(kernel),simulator=new StoreSimulator(kernel,caps),reads=new ReadContext(kernel,caps);
  kernel.provisionStore('demo','store');
  const actor=(name:string,role:'owner'|'operator'|'reviewer'|'agent'|'worker')=>{
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

  const worker=actor('local-worker','agent'),api=new WorkerApi(kernel),stops=new ExecutionStops(kernel),work=new DurableWork(kernel);
  const journal=new SyntheticJournal(sourceDB,'demo','store'),queue=new ExceptionQueue(kernel,()=>journal),audience='http://127.0.0.1:9911/v1/worker';
  const grant=api.leases.issue(agent.scope,{case_id:'demo_case',lifetime_ms:120000},audience),lease=api.leases.claim(grant.token,audience,100);
  const submission=api.submit(grant.token,audience,{generation:lease.generation,envelope:api.context(grant.token,audience,lease.generation).envelope,request_key:'demo-proposal',proposal:{action:'diagnostic.resolution.set',arguments:{resolution:'refund'}}});
  const approval=gateway.approve(reviewer.scope,{preview_id:submission.preview.id,preview_digest:submission.preview.digest});
  const result=api.execute(grant.token,audience,{generation:lease.generation,envelope:api.context(grant.token,audience,lease.generation).envelope,submission_id:submission.id,approval_id:approval.id});
  work.bind(operator.scope,result.operation.id,journal);journal.arm('after_accept');await work.dispatch(operator.scope,result.operation.id,journal);
  now+=101;
  const replacement=api.leases.issue(worker.scope,{case_id:'demo_case',lifetime_ms:120000},audience),next=api.leases.claim(replacement.token,audience,30000);
  let late='UNEXPECTED_SUCCESS',blocked='UNEXPECTED_SUCCESS';
  try{api.context(grant.token,audience,lease.generation);}catch(e){late=(e as Error).message;}
  try{api.submit(replacement.token,audience,{generation:next.generation,envelope:api.context(replacement.token,audience,next.generation).envelope,request_key:'must-reconcile',proposal:{action:'diagnostic.resolution.set',arguments:{resolution:'none'}}});}catch(e){blocked=(e as Error).message;}
  const vault=new SecretVault(kernel,{activeId:'ephemeral-key',get:()=>key},{'synthetic-probe':()=>true}),credentials=new CredentialLifecycle(kernel,vault);
  credentials.configure(owner.scope,{slot_id:'demo-credential',provider:'synthetic',adapter:'synthetic-probe',value:'SYNTHETIC-NOT-A-REAL-KEY',expected_revision:0});
  const oldCall=await credentials.probe(operator.scope,'demo-credential');
  credentials.configure(owner.scope,{slot_id:'demo-credential',provider:'synthetic',adapter:'synthetic-probe',value:'SYNTHETIC-ROTATED-NOT-REAL',expected_revision:1});
  const newCall=await credentials.probe(operator.scope,'demo-credential');
  if(args[0]==='--serve'){
    live=true;server=await startCommerceServer({kernel,caps,simulator,reads,customers,reconciliationJournals:()=>journal});temporary=mkdtempSync(join(tmpdir(),'rifare-worker-controls-'));
    const path=join(temporary,'sessions.json');writeFileSync(path,JSON.stringify({operator:operator.bearer,owner:owner.bearer,worker:worker.bearer,case_id:'demo_case'},null,2),{mode:0o600});
    console.log(JSON.stringify({url:server.url+'/exceptions',private_session_file:path,external_calls:0,qualification:'ephemeral_synthetic_only'}));
    await new Promise<void>(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});
  }else{
    const before=queue.list(operator.scope);stops.setGlobal({stopped:true,expected_revision:0,reason:'incident'});
    const repaired=await queue.reconcile(operator.scope,result.operation.id);stops.setGlobal({stopped:false,expected_revision:1,reason:'reviewed_resume'});
    console.log(JSON.stringify({late_worker:late,unresolved_effect_blocks_proposal:blocked,replacement_generation:next.generation,
      before:before.items.map(i=>({state:i.state,owner:i.owner,actions:i.actions})),reconciled_state:repaired.operation.state,source_effects:journal.count(),
      credential_calls:[oldCall,newCall],external_calls:0,financial_effect:false,qualification:'synthetic_diagnostic_only',project_reviewers:'none; synthetic runtime actors only'},null,2));
  }
}finally{await server?.close();db.close();sourceDB.close();key.fill(0);if(temporary)rmSync(temporary,{recursive:true,force:true});}
