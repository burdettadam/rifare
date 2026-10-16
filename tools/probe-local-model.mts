import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { CommerceKernel } from '../packages/commerce/kernel.mts';
import { Capabilities } from '../packages/commerce/capabilities.mts';
import { StoreSimulator } from '../packages/commerce/simulator.mts';
import { ReadContext } from '../packages/commerce/read-context.mts';
import { loadSkillDirectory } from '../packages/commerce/skills.mts';
import { LocalModel } from '../packages/agent/local-model.mts';
import { ReadRunner } from '../packages/agent/runner.mts';
const args=process.argv.slice(2),settings:Record<string,string>={};
for(let i=0;i<args.length;i+=2){if(!['--endpoint','--model','--digest','--server-local-only'].includes(args[i])||!args[i+1]||settings[args[i]])throw new Error('Use --endpoint http://127.0.0.1:11434 --model NAME --digest sha256:HASH --server-local-only true');settings[args[i]]=args[i+1];}
if(Object.keys(settings).length!==4){console.log(JSON.stringify({status:'blocked',reason:'EXPLICIT_LOCAL_ENDPOINT_MODEL_AND_DIGEST_REQUIRED',qualification:false}));process.exitCode=2;}
else {
 const db=new DatabaseSync(':memory:');const started=performance.now();
 try {
  const local=new LocalModel({endpoint:settings['--endpoint'],model:settings['--model'],model_digest:settings['--digest'],cloud_disabled:settings['--server-local-only']==='true',timeout_ms:15000,context_tokens:32768});
  await local.probe();
  const k=new CommerceKernel(db),caps=new Capabilities(k),simulator=new StoreSimulator(k,caps),reads=new ReadContext(k,caps);
  k.provisionStore('compatibility','local');k.provisionMember('compatibility','local','operator');const scope=k.authenticate(k.issueSession('compatibility','local','operator'));
  simulator.reset(scope);const skill=loadSkillDirectory(fileURLToPath(new URL('../packages/commerce/skill-bundles/order-status/',import.meta.url)));reads.skills.install(scope,skill);
  reads.profiles.put(scope,{id:'local',revision:1,tenant_id:'compatibility',store_id:'local',skill_id:skill.id,skill_digest:skill.digest,tone:'neutral',locale:'en-US',
    actions:['order.status','skill.read'],data_scope:{order:'session_or_store',knowledge:'visible_only'}});
  const task=reads.createTask(scope,{order_id:k.lookup(scope,'order','synthetic','ORD-1001').id,profile_id:'local'});
  const runner=new ReadRunner(k,reads,null as any,[{id:'local',tenant_id:'compatibility',store_id:'local',provider:'ollama',model:local.config.model,secret_ref:null,
    capabilities:['tool_calls','fact_selection','stateless'],max_rounds:4,max_output_tokens:512,evidence_kind:'live_test_unqualified'}],
    {[JSON.stringify(['compatibility','local','local'])]:local});
  const result=await runner.run(scope,task.id,'local');
  console.log(JSON.stringify({status:result.status==='grounded_read'?'single_case_observed':'unsupported_in_this_configuration',
    model:local.config.model,model_digest:local.config.model_digest,skill_digest:skill.digest,latency_ms:Math.round(performance.now()-started),
    fixture:'synthetic-order-status',result,declared_support:'not_qualified_by_one_case',
    server_cloud_disabled:'operator_must_verify_on_server',host_network_isolation:'not_attested'},null,2));
  if(result.status!=='grounded_read')process.exitCode=1;
 }catch(error){console.log(JSON.stringify({status:'blocked',reason:error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'LOCAL_PROBE_FAILED',latency_ms:Math.round(performance.now()-started),qualification:false}));process.exitCode=2;}
 finally{db.close();}
}
