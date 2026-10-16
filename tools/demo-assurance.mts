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
import { ReturnDrafts } from '../packages/commerce/return-drafts.mts';
import { proposeReturnDraft } from '../packages/agent/return-draft.mts';
import { IntegrationReadiness,DRAFT_ACTION } from '../packages/commerce/integration-readiness.mts';
import { PrivacyLifecycle } from '../packages/commerce/privacy-lifecycle.mts';
import { createRecoverySnapshot,restoreRecoverySnapshot,suppressionCheckpoint } from '../packages/commerce/safe-recovery.mts';
import { contentDigest } from '../packages/commerce/configuration-values.mts';
import { startCommerceServer } from '../apps/commerce-api/server.mts';

const args=process.argv.slice(2);if(args.length>1||(args.length===1&&args[0]!=='--serve'))throw new Error('Use --serve or no arguments.');
const directory=mkdtempSync(join(tmpdir(),'rifare-assurance-')),db=new DatabaseSync(':memory:');
let server:Awaited<ReturnType<typeof startCommerceServer>>|undefined;
try {
 const at=Date.now();let fixed=true;
 const kernel=new CommerceKernel(db,()=>fixed?at:Date.now()),caps=new Capabilities(kernel),simulator=new StoreSimulator(kernel,caps),reads=new ReadContext(kernel,caps);
 const outbox:any[]=[],customers=new CustomerAccess(kernel,m=>outbox.push(m));
 const bundle=loadSkillDirectory(fileURLToPath(new URL('../packages/commerce/skill-bundles/return-draft/',import.meta.url)));
 const gateway=new ActionGateway(kernel),drafts=new ReturnDrafts(kernel),policies=new Policies(kernel),readiness=new IntegrationReadiness(kernel);
 const seed=(store:string,window:number)=>{
  kernel.provisionStore('demo',store);
  const actor=(name:string,role:'owner'|'operator'|'reviewer')=>{kernel.provisionMember('demo',store,name,role);const token=kernel.issueSession('demo',store,name);return {token,scope:kernel.authenticate(token)};};
  const owner=actor('owner','owner'),operator=actor('operator','operator'),reviewer=actor('reviewer','reviewer');simulator.reset(operator.scope);
  reads.skills.install(operator.scope,bundle);reads.profiles.put(operator.scope,{id:'default',revision:1,tenant_id:'demo',store_id:store,skill_id:bundle.id,skill_digest:bundle.digest,tone:'neutral',locale:'en-US',actions:['order.status','knowledge.search','knowledge.get','skill.read'],data_scope:{order:'session_or_store',knowledge:'visible_only'}});
  const p=policies.create(operator.scope,{policy_id:'returns',expected_version:0,rules:{window_days:window,require_evidence:true,excluded_tags:['final-sale'],outcomes:['refund','exchange']},selection:'pin_at_request',sources:[{uri:'https://merchant.example.invalid/policy',revision:'1',sha256:'a'.repeat(64)}]});
  policies.test(operator.scope,'returns',1,p.digest);policies.review(reviewer.scope,'returns',1,p.digest);policies.publish(owner.scope,{policy_id:'returns',version:1,digest:p.digest,expected_published_version:0,effective_at:kernel.clock()});
  const order=kernel.lookup(operator.scope,'order','synthetic','ORD-1001');kernel.ingest(operator.scope,{kind:'order',source_system:'synthetic',external_id:order.external_id,source_version:2,source_updated_at:kernel.clock(),customer_id:order.customer_id,payload:{...order.payload,delivered_at:at-3*86400000,tags:[],evidence_verified:true}});
  const challenge=customers.request({store_id:store,order_number:'ORD-1001',email:'shopper-apparel@example.invalid'},'127.0.0.1');const verified=customers.complete({store_id:store,challenge_id:challenge.challenge_id,proof:outbox.at(-1).proof});outbox.length=0;
  gateway.configure(owner.scope,{enabled:true,expected_revision:0,profile_id:'default',policy_id:'returns'});gateway.cases.create(kernel.authenticate(verified.token),{case_id:'return_case',resource_id:order.id,profile_id:'default',policy_id:'returns'});
  return {store,owner,operator,reviewer,order,window};
 };
 const long=seed('long-window',30),short=seed('short-window',1);
 if(args[0]==='--serve') {
  fixed=false;server=await startCommerceServer({kernel,caps,simulator,reads,customers});const file=join(directory,'sessions.json');
  writeFileSync(file,JSON.stringify({operator:long.operator.token,reviewer:long.reviewer.token,owner:long.owner.token,case_id:'return_case',short_window_operator:short.operator.token},null,2),{mode:0o600});
  console.log(JSON.stringify({url:server.url+'/return-draft',private_session_file:file,profile:'two_merchant_synthetic_return_draft',external_calls:0,production_qualified:false}));
  await new Promise<void>(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});
 } else {
  const intent={case_id:'return_case',request_key:'initial-draft',resolution:'refund'};
  const proposed=await proposeReturnDraft(async(path,body)=>{if(path!=='/v1/return-drafts/prepare')throw new Error('UNKNOWN_ROUTE');return drafts.prepare(long.operator.scope,body);},intent);
  let shortResult='UNEXPECTED_SUCCESS';try{drafts.prepare(short.operator.scope,intent);}catch(error){shortResult=(error as Error).message;}
  const resumed=drafts.read(long.operator.scope,'return_case');
  const backup=createRecoverySnapshot(kernel,join(directory,'backup')),privacy=new PrivacyLifecycle(kernel);
  const erasure=privacy.erase(long.owner.scope,long.order.customer_id);const cp=suppressionCheckpoint(kernel);
  const restored=restoreRecoverySnapshot({snapshot:backup.directory,destination:join(directory,'restored'),manifest_sha256:backup.manifest_sha256,suppression:cp,suppression_sha256:contentDigest(cp)},()=>kernel.clock());
  const restoredDb=new DatabaseSync(restored.database);let protectedRead='UNEXPECTED_SUCCESS';
  try{const k=new CommerceKernel(restoredDb,()=>kernel.clock()),scope=k.authenticate(k.issueSession('demo',long.store,'owner'));try{k.get(scope,long.order.id);}catch(error){protectedRead=(error as Error).message;}}finally{restoredDb.close();}
  console.log(JSON.stringify({evidence_kind:'synthetic_multi_store_demonstration',skill:{id:bundle.id,digest:bundle.digest},profiles:[{store:long.store,window_days:30,result:proposed.status},{store:short.store,window_days:1,result:shortResult}],resume_preserves_preview:resumed.id===proposed.id,financial_effect:false,unrelated_store_ready:readiness.inspect(short.operator.scope,DRAFT_ACTION).ready,erasure:erasure.status,restored_mode:restored.mode,restored_erased_read:protectedRead,external_calls:0,production_qualified:false},null,2));
 }
} finally {await server?.close();db.close();rmSync(directory,{recursive:true,force:true});}
