import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {returnFixture} from './return-intake-helpers.mts';
import {loadSkillDirectory} from '../../packages/commerce/skills.mts';
import {SkillInstaller} from '../../packages/commerce/skill-installer.mts';
import {CustomerAccess} from '../../packages/commerce/customer-access.mts';
import {SupportConversations} from '../../packages/commerce/support-conversations.mts';
import {ModelBudgets} from '../../packages/commerce/model-budgets.mts';
import {SecretVault} from '../../packages/commerce/secrets.mts';
import {DecisionShadow} from '../../packages/commerce/decision-shadow.mts';
import {WORKERS_AI_ADAPTER,WORKERS_AI_MODEL,workersAIReader} from '../../packages/agent/workers-ai.mts';

export const loadShadow=(name:string)=>JSON.parse(readFileSync(new URL('../fixtures/decision-shadow/'+name+'.json',import.meta.url),'utf8'));
export const PROTOCOL_PIN='48aae019e34ae478044834c46946046b0fcab016076e0d1f75c6bd1dab49c6b8';
export function shadowFixture(){
  const f=returnFixture(),key=randomBytes(32),requests:any[]=[],protocol=loadShadow('evaluation-protocol.v1'),wire=loadShadow('wire-responses.v1');
  const bundle=loadSkillDirectory(fileURLToPath(new URL('../../packages/commerce/skill-bundles/return-intake-shadow/',import.meta.url)));
  const installer=new SkillInstaller(f.kernel,f.reads.skills),conversations=new SupportConversations(f.kernel),budgets=new ModelBudgets(f.kernel);
  let before:(()=>unknown)|undefined,reply:any=wire.clear,counter=0;
  function role(store:any,name:string,kind:'owner'|'reviewer'){
    f.kernel.provisionMember(store.tenant,store.store,name,kind);return f.kernel.authenticate(f.kernel.issueSession(store.tenant,store.store,name));
  }
  const ownerB=role(f.b,'owner','owner'),reviewerB=role(f.b,'reviewer','reviewer');
  const draft=f.policies.create(f.b.scope,f.input());f.policies.test(f.b.scope,draft.policy_id,draft.version,draft.digest);
  f.policies.review(reviewerB,draft.policy_id,draft.version,draft.digest);
  f.policies.publish(ownerB,{policy_id:draft.policy_id,version:draft.version,digest:draft.digest,expected_published_version:0,effective_at:f.now()});
  function install(store:any,owner:any,variant:'us'|'gb'){
    const origin='https://rifare.invalid/skills/return-intake-shadow';
    const approval=installer.approve(owner,{origin,bundle_digest:bundle.digest,skill_id:bundle.id,version:bundle.version,expires_at:f.now()+3600000});
    installer.install(store.scope,approval.id,{origin,bundle});
    f.reads.profiles.put(store.scope,f.profile(store,{id:'shadow',skill_id:bundle.id,skill_digest:bundle.digest,tone:variant==='us'?'warm':'formal',locale:variant==='us'?'en-US':'en-GB'}));
    return approval;
  }
  const approvalA=install(f.a,f.owner.scope,'us'),approvalB=install(f.b,ownerB,'gb');
  const proofs:any[]=[],customers=new CustomerAccess(f.kernel,p=>proofs.push(p)),orderB=f.order(f.b),customerBRow=f.kernel.lookup(f.b.scope,'customer','synthetic',orderB.customer_id);
  const challenge=customers.request({store_id:f.b.store,order_number:orderB.external_id,email:customerBRow.payload.email},'127.0.0.2');
  const customerB=f.kernel.authenticate(customers.complete({store_id:f.b.store,challenge_id:challenge.challenge_id,proof:proofs.at(-1).proof}).token);
  const caseA=f.cases.create(f.customer,{case_id:'shadow_case_a',resource_id:f.order().id,profile_id:'shadow',policy_id:'returns'});
  const caseB=f.cases.create(customerB,{case_id:'shadow_case_b',resource_id:orderB.id,profile_id:'shadow',policy_id:'returns'});
  f.gateway.configure(f.owner.scope,{enabled:true,expected_revision:1,profile_id:'shadow',policy_id:'returns'});
  const linkA=conversations.link(f.a.scope,f.customer,{case_id:caseA.id,channel:'webchat',account_id:'shadow_channel_a',external_id:'shadow_thread_a',history:'complete',source_revision:1});
  const linkB=conversations.link(f.b.scope,customerB,{case_id:caseB.id,channel:'webchat',account_id:'shadow_channel_b',external_id:'shadow_thread_b',history:'complete',source_revision:1});
  function message(text:string,store=f.a,link=linkA){return conversations.ingest(store.scope,{link_id:link.id,external_id:'message_'+(++counter),direction:'incoming',visibility:'public',text,source_at:f.now()});}
  message(protocol.cases[0].customer_messages[0]);message(protocol.cases[5].customer_messages[0],f.b,linkB);
  const taskA=f.reads.createTask(f.a.scope,{order_id:f.order().id,profile_id:'shadow'}),taskB=f.reads.createTask(f.b.scope,{order_id:orderB.id,profile_id:'shadow'});
  function service(store:any,owner:any,suffix:string){
    const ref='shadow_'+suffix,reader=workersAIReader({serving_configuration_ref:ref,account_id:'a'.repeat(32),approved_account_ids:['a'.repeat(32)],model_id:WORKERS_AI_MODEL,approved_model_ids:[WORKERS_AI_MODEL],fixtureTransport:(async(_url:any,init:any)=>{
      requests.push({configuration:ref,body:JSON.parse(init.body),authorization_present:typeof init.headers.Authorization==='string'});
      await before?.();if(reply instanceof Error)throw reply;return new Response(JSON.stringify(reply));
    }) as typeof fetch});
    const vault=new SecretVault(f.kernel,{activeId:'shadow_fixture_key',get:()=>Buffer.from(key)},{},{[WORKERS_AI_ADAPTER]:reader});
    const secret=vault.put(store.scope,{provider:'cloudflare',adapter:WORKERS_AI_ADAPTER,value:'SYNTHETIC_SHADOW_SECRET'}).ref;
    const shadow=new DecisionShadow(f.kernel,f.reads,vault,[{id:ref,tenant_id:store.tenant,store_id:store.store,secret_ref:secret,reader}]);
    budgets.configure(owner,{provider_id:'cloudflare',period_id:'shadow_period',starts_at:f.now(),ends_at:f.now()+3600000,limit_micro:'10000000',input_micro:'1',output_micro:'1',max_input_bytes:40000,max_output_tokens:1,expected_revision:0});
    shadow.configure(owner,{id:ref,expected_version:0,enabled:true,expires_at:f.now()+3600000});
    return {shadow,vault,secret,reader,ref};
  }
  const aService=service(f.a,f.owner.scope,'a'),bService=service(f.b,ownerB,'b');
  const input=(extra:any={})=>({case_id:caseA.id,task_id:taskA.id,configuration_id:aService.ref,request_id:'observation_'+(++counter),...extra});
  const inputB=(extra:any={})=>({case_id:caseB.id,task_id:taskB.id,configuration_id:bService.ref,request_id:'observation_'+(++counter),...extra});
  const business=()=>Object.fromEntries(['commerce_support_ownership','commerce_cases','commerce_case_effects','commerce_action_approvals','commerce_action_receipts','commerce_operations','commerce_return_requests','commerce_resources'].map(table=>[table,f.db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()]));
  return {...f,...aService,shadowB:bService.shadow,serviceB:bService,ownerB,customerB,bundle,installer,approvalA,approvalB,caseA,caseB,linkA,linkB,taskA,taskB,conversations,budgets,protocol,wire,requests,input,inputB,message,business,
    respond:(name:string)=>{reply=structuredClone(wire[name]);},response:(value:any)=>{reply=value;},before:(fn:typeof before)=>{before=fn;},
    cleanup:()=>{key.fill(0);f.cleanup();}};
}
export async function usingShadow(fn:(f:ReturnType<typeof shadowFixture>)=>unknown){const f=shadowFixture();try{return await fn(f);}finally{f.cleanup();}}
