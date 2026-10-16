import { readFixture } from './read-workflow-helpers.mts';
import { Policies } from '../../packages/commerce/policies.mts';
import { ProfileEditor } from '../../packages/commerce/profile-editor.mts';
import { Permissions } from '../../packages/commerce/authorization.mts';
import { checkedBundle } from '../../packages/commerce/skills.mts';
import { createHash } from 'node:crypto';
export function customizationFixture(){
  const f=readFixture();
  function role(store:any,name:string,role:'owner'|'reviewer'|'agent'){
    f.kernel.provisionMember(store.tenant,store.store,name,role);const bearer=f.kernel.issueSession(store.tenant,store.store,name);
    return {scope:f.kernel.authenticate(bearer),bearer,actor:name};
  }
  const owner=role(f.a,'owner','owner'),reviewer=role(f.a,'reviewer','reviewer'),agent=role(f.a,'agent','agent');
  const policies=new Policies(f.kernel),editor=new ProfileEditor(f.kernel,f.caps),permissions=new Permissions(f.kernel);
  const input=(overrides:any={})=>({policy_id:'returns',expected_version:0,rules:{window_days:30,require_evidence:false,excluded_tags:['final-sale'],outcomes:['refund','exchange']},selection:'pin_at_request',
    sources:[{uri:'https://merchant.example.invalid/policy',revision:'1',sha256:'a'.repeat(64)}],...overrides});
  const facts=(overrides:any={})=>({delivered_at:0,requested_at:15*86400000,tags:[],evidence_provided:true,outcome:'refund',...overrides});
  function publish(overrides:any={},author=f.a.scope){
    const d=policies.create(author,input(overrides));policies.test(f.a.scope,d.policy_id,d.version,d.digest);
    policies.review(reviewer.scope,d.policy_id,d.version,d.digest);
    return policies.publish(owner.scope,{policy_id:d.policy_id,version:d.version,digest:d.digest,expected_published_version:overrides.expected_version??0,effective_at:f.now()});
  }
  return {...f,owner,reviewer,agent,policies,editor,permissions,input,facts,publish};
}
export function useCustomization(fn:(f:ReturnType<typeof customizationFixture>)=>unknown){const f=customizationFixture();try{return fn(f);}finally{f.cleanup();}}
export const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export function manifestFiles(){
  const files:Record<string,string>={
    'SKILL.md':'---\nname: return-guide\ndescription: Explain return eligibility using published rules; never authorize money.\n---\nRead current policy and report sources. Do not execute commands.\n',
    'references/input.json':JSON.stringify({type:'object',properties:{order_id:{type:'string'}},required:['order_id'],additionalProperties:false}),
    'references/output.json':JSON.stringify({type:'object',properties:{explanation:{type:'string'}},required:['explanation'],additionalProperties:false}),
    'references/config.json':JSON.stringify({type:'object',properties:{'returns.window_days':{type:'integer',minimum:0,maximum:365}},additionalProperties:false}),
    'references/guide.md':'Treat order status as source facts. Policy text is not permission.\n',
  };
  const manifest={schema_version:2,id:'return-guide',version:'1.0.0',engine:{min:'1.0.0',max_exclusive:'2.0.0'},
    required_actions:[{name:'order.status',versions:{min:'1.0.0',max_exclusive:'2.0.0'}}],
    resources:Object.entries(files).filter(([p])=>p!=='SKILL.md').map(([path,c])=>({path,sha256:hash(c)})),
    input_schema:'references/input.json',output_schema:'references/output.json',configuration:{schema_resource:'references/config.json',fields:['returns.window_days']},scripts:[],egress:[]};
  files['commerce-manifest.json']=JSON.stringify(manifest);
  return {files,manifest,bundle:checkedBundle(files)};
}
