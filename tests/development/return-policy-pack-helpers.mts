import {readFileSync} from 'node:fs';
import {returnFixture} from './return-intake-helpers.mts';
import {ReturnPolicyPacks} from '../../packages/commerce/return-policy-packs.mts';
import {SkillInstaller,readInstructionDirectory} from '../../packages/commerce/skill-installer.mts';
import {CustomerAccess} from '../../packages/commerce/customer-access.mts';
import {fileURLToPath} from 'node:url';

export const packOracle=JSON.parse(readFileSync(new URL('../fixtures/return-policy-packs/scenarios.v1.json',import.meta.url),'utf8'));
export function policyPackFixture(kind='apparel',packId=kind,otherStore=false){
 const f=returnFixture(),spec=packOracle.profiles.find((p:any)=>p.id===kind);
 if(!spec)throw new Error('FIXTURE_PROFILE_UNKNOWN');
 const store=otherStore?f.c:f.a;
 const role=(name:string,role:any)=>{f.kernel.provisionMember(store.tenant,store.store,name,role);const bearer=f.kernel.issueSession(store.tenant,store.store,name);return {scope:f.kernel.authenticate(bearer),bearer,actor:name};};
 const owner=otherStore?role('pack_owner','owner'):f.owner,reviewer=otherStore?role('pack_reviewer','reviewer'):f.reviewer;
 const installer=new SkillInstaller(f.kernel),bundle=readInstructionDirectory(fileURLToPath(new URL('../../packages/commerce/skill-bundles/handle-return/',import.meta.url))),origin='https://rifare.invalid/skills/handle-return';
 const approval=installer.approve(owner.scope,{origin,bundle_digest:bundle.digest,skill_id:bundle.id,version:bundle.version,expires_at:f.now()+3600000});installer.install(store.scope,approval.id,{origin,bundle});
 const policyId='pack_policy',profileId='pack_profile';
 const draft=f.policies.create(store.scope,f.input({policy_id:policyId,rules:{window_days:spec.window_days,require_evidence:spec.require_evidence,excluded_tags:spec.excluded_tags,outcomes:spec.outcomes}}));
 f.policies.test(store.scope,policyId,1,draft.digest);f.policies.review(reviewer.scope,policyId,1,draft.digest);f.policies.publish(owner.scope,{policy_id:policyId,version:1,digest:draft.digest,expected_published_version:0,effective_at:f.now()});
 f.reads.profiles.put(store.scope,f.profile(store,{id:profileId,skill_id:bundle.id,skill_digest:bundle.digest,tone:spec.tone,locale:spec.locale}));
 let customer=f.customer,customerBearer=f.customerBearer;
 if(otherStore){const base=f.order(),o=f.order(store);f.kernel.ingest(store.scope,{kind:'order',source_system:'synthetic',external_id:o.external_id,source_version:o.source_version+1,source_updated_at:f.now(),customer_id:o.customer_id,payload:base.payload});
  const messages:any[]=[],access=new CustomerAccess(f.kernel,p=>messages.push(p)),challenge=access.request({store_id:store.store,order_number:'ORD-1001',email:'shopper-apparel@example.invalid'},'127.0.0.5'),verified=access.complete({store_id:store.store,challenge_id:challenge.challenge_id,proof:messages[0].proof});customer=f.kernel.authenticate(verified.token);customerBearer=verified.token;
  f.cases.create(customer,{case_id:'case_one',resource_id:f.order(store).id,profile_id:profileId,policy_id:policyId});f.intake.configure(owner.scope,{expected_revision:0,settings:f.settings});
 }else f.cases.migrate(owner.scope,'case_one',{expected_revision:1,profile_id:profileId,policy_id:policyId,reason:'approved_update'});
 f.gateway.configure(owner.scope,{enabled:true,expected_revision:otherStore?0:1,profile_id:profileId,policy_id:policyId});
 const packs=new ReturnPolicyPacks(f.kernel,f.caps),packInput={id:packId,expected_revision:0,profile_id:profileId,policy_id:policyId,
  required_capabilities:['order.read'],routing:{required:false,allowed_destination_ids:spec.destination_ids},review:{mode:spec.review_mode,always_review:spec.always_review}};
 const installed=packs.put(owner.scope,packInput);
 const selection=(extra:any={})=>f.selection({outcome:spec.outcomes[0],...extra});
 const evaluate=(extra:any={},scope=store.scope)=>packs.evaluate(scope,{pack_id:packId,selection:selection(),request_id:null,...extra});
 function facts(days:number,tags:string[]=[]){const o=f.order(store);f.kernel.ingest(store.scope,{kind:'order',source_system:'synthetic',external_id:o.external_id,source_version:o.source_version+1,source_updated_at:f.now(),customer_id:o.customer_id,payload:{...o.payload,delivered_at:f.now()-days*86400000,tags}});}
 return {...f,a:store,owner,reviewer,customer,customerBearer,packBundle:bundle,packs,spec,packId,packInput,installed,selection,evaluate,facts};
}
export async function usingPolicyPack(fn:(f:ReturnType<typeof policyPackFixture>)=>unknown,kind='apparel',packId=kind,otherStore=false){const f=policyPackFixture(kind,packId,otherStore);try{return await fn(f);}finally{f.cleanup();}}
