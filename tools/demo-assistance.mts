import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { CommerceKernel } from '../packages/commerce/kernel.mts';
import { Capabilities } from '../packages/commerce/capabilities.mts';
import { StoreSimulator } from '../packages/commerce/simulator.mts';
import { ReadContext } from '../packages/commerce/read-context.mts';
import { loadSkillDirectory } from '../packages/commerce/skills.mts';
import { SecretVault } from '../packages/commerce/secrets.mts';
import { ReadRunner } from '../packages/agent/runner.mts';
import { providerReader,ADAPTER_NAMES } from '../packages/agent/providers.mts';
import type { Provider } from '../packages/agent/providers.mts';

const provider=(process.argv[2]??'openai') as Provider;
if(!['openai','anthropic'].includes(provider)||process.argv.length>3)throw new Error('Use openai or anthropic only. This demonstration never calls a model.');
const db=new DatabaseSync(':memory:'),key=randomBytes(32);
try {
  const k=new CommerceKernel(db),caps=new Capabilities(k),simulator=new StoreSimulator(k,caps),reads=new ReadContext(k,caps);
  k.provisionStore('demo','store');k.provisionMember('demo','store','operator');const scope=k.authenticate(k.issueSession('demo','store','operator'));
  simulator.reset(scope);
  const skill=loadSkillDirectory(fileURLToPath(new URL('../packages/commerce/skill-bundles/order-status/',import.meta.url)));reads.skills.install(scope,skill);
  reads.profiles.put(scope,{id:'default',revision:1,tenant_id:'demo',store_id:'store',skill_id:skill.id,skill_digest:skill.digest,tone:'neutral',locale:'en-US',
    actions:['order.status','skill.read'],data_scope:{order:'session_or_store',knowledge:'visible_only'}});
  let step=0;
  const fixtureTransport=(async(_url:any,options:any)=>{
    const body=JSON.parse(options.body);let catalog:any;
    if(provider==='openai'){const result=body.input.filter((x:any)=>x.type==='function_call_output').at(-1);if(result)catalog=JSON.parse(result.output);}
    else {const blocks=body.messages.at(-1).content;if(Array.isArray(blocks))catalog=JSON.parse(blocks[0].content);}
    const name=catalog?'finish_status':'read_order_status',input=catalog?{source_digest:catalog.digest,fact_ids:catalog.required}:{};
    const id='fixture_'+(++step);
    return new Response(JSON.stringify(provider==='openai'?{status:'completed',output:[{type:'function_call',call_id:id,name,arguments:JSON.stringify(input)}]}:
      {stop_reason:'tool_use',content:[{type:'tool_use',id,name,input}]}),{status:200});
  }) as typeof fetch;
  const vault=new SecretVault(k,{activeId:'memory-only',get:()=>Buffer.from(key)},{},{[ADAPTER_NAMES[provider]]:providerReader(provider,{fixtureTransport,approvedModels:['synthetic-demo']})});
  const secret=vault.put(scope,{provider,adapter:ADAPTER_NAMES[provider],value:'synthetic-key-never-sent'});
  const runner=new ReadRunner(k,reads,vault,[{id:'demo',tenant_id:'demo',store_id:'store',provider,model:'synthetic-demo',secret_ref:secret.ref,
    capabilities:['tool_calls','fact_selection','stateless'],max_rounds:4,max_output_tokens:512,evidence_kind:'synthetic_wire_fixture'}]);
  const task=reads.createTask(scope,{order_id:k.lookup(scope,'order','synthetic','ORD-1001').id,profile_id:'default'});
  console.log(JSON.stringify({demonstration:'synthetic-wire-only',external_calls:0,result:await runner.run(scope,task.id,'demo')},null,2));
} finally {db.close();key.fill(0);}
