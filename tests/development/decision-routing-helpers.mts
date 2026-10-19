import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {shadowFixture} from './decision-shadow-helpers.mts';
import {SecretVault} from '../../packages/commerce/secrets.mts';
import {DecisionShadow} from '../../packages/commerce/decision-shadow.mts';
import {SupportRules} from '../../packages/commerce/support-rules.mts';
import {DecisionRouting} from '../../packages/commerce/decision-routing.mts';
import {SYSTEMONE_ADAPTER,systemOneReader} from '../../packages/agent/systemone.mts';
import {WORKERS_AI_ADAPTER} from '../../packages/agent/workers-ai.mts';
import {contentDigest} from '../../packages/commerce/configuration-values.mts';

export const routingFixtureFile=(name:string)=>JSON.parse(readFileSync(new URL('../fixtures/decision-routing/'+name+'.json',import.meta.url),'utf8'));
export function routingFixture(){
 const f=shadowFixture(),key=randomBytes(32),systemRef='systemone_a',systemRequests:any[]=[];
 const systemReader=systemOneReader({serving_configuration_ref:systemRef,endpoint:'https://systemone.example/v1/systemone',approved_endpoints:['https://systemone.example/v1/systemone'],model_id:'clef_fixture',approved_model_ids:['clef_fixture'],model_revision:null,serving_revision:null,effective_context_tokens:8192,confidence_profile:'sglang_systemone_adapter_v1',fixtureTransport:(async(_url:any,init:any)=>{
  systemRequests.push(JSON.parse(init.body));const r=structuredClone(f.wire.clear.result);r.model='clef_fixture';
  for(const a of Object.values(r.answers) as any[]){a.confidence=0.71;for(const option of Object.keys(a.probabilities))a.probabilities[option]=option===a.choice?0.96:0.02;}
  return new Response(JSON.stringify(r));
 }) as typeof fetch});
 const vault=new SecretVault(f.kernel,{activeId:'routing_fixture_key',get:()=>Buffer.from(key)},{},{[WORKERS_AI_ADAPTER]:f.reader,[SYSTEMONE_ADAPTER]:systemReader});
 const secret=vault.put(f.a.scope,{provider:'cloudflare',adapter:WORKERS_AI_ADAPTER,value:'ROUTING_CF_FIXTURE_SECRET'}).ref;
 const systemSecret=vault.put(f.a.scope,{provider:'systemone',adapter:SYSTEMONE_ADAPTER,value:'ROUTING_SYSTEM_FIXTURE_SECRET'}).ref;
 const shadow=new DecisionShadow(f.kernel,f.reads,vault,[{id:f.ref,tenant_id:f.a.tenant,store_id:f.a.store,secret_ref:secret,reader:f.reader},{id:systemRef,tenant_id:f.a.tenant,store_id:f.a.store,secret_ref:systemSecret,reader:systemReader}]);
 shadow.configure(f.owner.scope,{id:f.ref,expected_version:1,enabled:true,expires_at:f.now()+3600000});
 shadow.configure(f.owner.scope,{id:systemRef,expected_version:0,enabled:true,expires_at:f.now()+3600000});
 f.budgets.configure(f.owner.scope,{provider_id:'systemone',period_id:'systemone_period',starts_at:f.now(),ends_at:f.now()+3600000,limit_micro:'10000000',input_micro:'1',output_micro:'1',max_input_bytes:20000,max_output_tokens:1,expected_revision:0});
 const rules=new SupportRules(f.kernel,{queue(){throw new Error('UNEXPECTED_MESSAGE_ACTION');}} as any),routing=new DecisionRouting(f.kernel,shadow,rules);
 let counter=0;
 function publishedRule(action='draft_return',extra:any={}){
  const d=rules.draft(f.owner.scope,{id:'routing_rule_'+(++counter),expected_version:0,trigger:'return_requested',conditions:{channel:'any',requires_verified_case:true},priority:1,wait_ms:0,calendar:{timezone:'UTC',weekdays:[0,1,2,3,4,5,6],start_minute:0,end_minute:1440},action,expires_at:f.now()+3600000,...extra});
  rules.review(f.reviewer.scope,d.id,d.version,d.digest);rules.publish(f.owner.scope,d.id,d.version);return {id:d.id,version:d.version,digest:d.digest};
 }
 const routeRules={draft_return:publishedRule(),handoff_request:publishedRule('handoff_request')};
 function protocol(configuration_id=f.ref){
  const p=routingFixtureFile('protocol.v1'),snapshot=shadow.snapshot(f.a.scope,f.input({configuration_id}));
  p.cases[0].source_text_hash=snapshot.submitted_text_hash;return p;
 }
 function freeze(configuration_id=f.ref,extra:any={}){return routing.freeze(f.owner.scope,{id:'protocol_'+(++counter),expected_version:0,case_id:f.caseA.id,task_id:f.taskA.id,configuration_id,protocol:protocol(configuration_id),expires_at:f.now()+3600000,...extra});}
 function qualification(configuration_id=f.ref,observations:any[]=[],frozen:any=undefined){
  const p=frozen??freeze(configuration_id);f.advance(1);
  const q=routing.measure(f.owner.scope,{id:'measurement_'+(++counter),expected_version:0,protocol_id:p.id,protocol_version:p.version,observations});
  routing.reviewQualification(f.reviewer.scope,q.id,q.version,q.digest);return q;
 }
 function stage(q:any,extra:any={}){return routing.stage(f.owner.scope,{id:'return_route',expected_version:0,case_id:f.caseA.id,task_id:f.taskA.id,configuration_id:q.body.pins.configuration_id,qualification_id:q.id,qualification_version:q.version,mode:'diagnostic',rules:routeRules,rollout_percent:100,expires_at:f.now()+3600000,...extra});}
 function publish(p:any,expected_revision=0){routing.review(f.reviewer.scope,p.id,p.version,p.digest);return routing.publish(f.owner.scope,{id:p.id,version:p.version,expected_revision,case_id:f.caseA.id,task_id:f.taskA.id});}
 function bootstrap(configuration_id=f.ref,extra:any={}){const q=qualification(configuration_id),p=stage(q,extra),active=publish(p,extra.expected_revision??0);return {q,p,active};}
 const routeInput=(extra:any={})=>({publication_id:'return_route',case_id:f.caseA.id,task_id:f.taskA.id,request_id:'route_request_'+(++counter),...extra});
 return {...f,shadow,vault,secret,systemReader,systemRef,systemRequests,rules,routing,routeRules,publishedRule,protocol,freeze,qualification,stage,publish,bootstrap,routeInput,cleanup:()=>{key.fill(0);f.cleanup();}};
}
export async function usingRouting(fn:(f:ReturnType<typeof routingFixture>)=>unknown){const f=routingFixture();try{return await fn(f);}finally{f.cleanup();}}
export function numericCohort(){
 const p=routingFixtureFile('protocol.v1'),base=p.cases;p.cases=[];
 for(const row of base)for(let i=0;i<10;i++)p.cases.push({...structuredClone(row),id:row.id+'_'+i,source_text_hash:contentDigest(['independent_numeric_source',row.id,i])});
 p.canary.case_ids=base.filter((r:any)=>r.role==='held_out').map((r:any)=>r.id+'_0');
 const rows=p.cases.map((r:any)=>({id:r.id,status:'usable',labels:r.labels,probability:0.98}));return {protocol:p,rows};
}
