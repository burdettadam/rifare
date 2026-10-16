import { customizationFixture } from './customization-helpers.mts';
import { ActionGateway } from '../../packages/commerce/action-gateway.mts';
import { SkillReleases } from '../../packages/commerce/skill-releases.mts';
import { CustomerAccess } from '../../packages/commerce/customer-access.mts';
import { checkedBundle } from '../../packages/commerce/skills.mts';
import { createHmac } from 'node:crypto';
export function executionFixture(){
  const f=customizationFixture();f.publish();f.reads.profiles.put(f.a.scope,f.profile());
  const original=f.order();
  f.kernel.ingest(f.a.scope,{kind:'order',source_system:'synthetic',external_id:original.external_id,source_version:2,source_updated_at:f.now(),customer_id:original.customer_id,
    payload:{...original.payload,delivered_at:f.now()-3*86400000,tags:[],evidence_verified:true}});
  const proofs:any[]=[],customers=new CustomerAccess(f.kernel,p=>proofs.push(p));
  const challenge=customers.request({store_id:f.a.store,order_number:'ORD-1001',email:'shopper-apparel@example.invalid'},'127.0.0.1');
  const verified=customers.complete({store_id:f.a.store,challenge_id:challenge.challenge_id,proof:proofs.at(-1).proof}),customer=f.kernel.authenticate(verified.token);
  const gateway=new ActionGateway(f.kernel),cases=gateway.cases,releases=new SkillReleases(f.kernel);
  gateway.configure(f.owner.scope,{enabled:true,expected_revision:0,profile_id:'default',policy_id:'returns'});
  const create=(caseId='case_one',scope=customer)=>cases.create(scope,{case_id:caseId,resource_id:f.order().id,profile_id:'default',policy_id:'returns'});
  create();
  const proposal=(caseId='case_one',resolution='refund')=>({case_id:caseId,action:'diagnostic.resolution.set',arguments:{resolution}});
  const preview=()=>gateway.prepare(f.a.scope,proposal());
  const approve=(p:any)=>gateway.approve(f.reviewer.scope,{preview_id:p.id,preview_digest:p.digest});
  const execute=(p:any,a:any,scope=f.agent.scope)=>gateway.execute(scope,{preview_id:p.id,preview_digest:p.digest,approval_id:a.id});
  function release(percent=100){const b=f.reads.skills.describe(f.a.scope,'order-status'),r=releases.stage(f.a.scope,{skill_id:b.id,bundle_digest:b.bundle_digest,rollout_percent:percent});
    const e=releases.evaluate(f.a.scope,r.id);releases.review(f.reviewer.scope,{release_id:r.id,test_digest:e.test_digest,rollout_percent:percent});return r;}
  function changeSkill(){const files={...f.bundle.files,'SKILL.md':f.bundle.files['SKILL.md']+'\nA newly published instruction.\n'};
    const m=JSON.parse(files['commerce-manifest.json']);m.version='1.1.0';files['commerce-manifest.json']=JSON.stringify(m);const b=checkedBundle(files);
    f.reads.skills.install(f.a.scope,b);f.reads.profiles.put(f.a.scope,f.profile(f.a,{revision:2,skill_digest:b.digest}));return b;}
  return {...f,gateway,cases,releases,customers,customer,customerBearer:verified.token,create,proposal,preview,approve,execute,release,changeSkill};
}
export async function usingExecution(fn:(f:ReturnType<typeof executionFixture>)=>unknown){const f=executionFixture();try{return await fn(f);}finally{f.cleanup();}}
export function syntheticHeaders(route:any,raw:Buffer,key:Buffer,now:number,delivery='delivery-1'){
  const at=String(now),prefix=JSON.stringify([route.id,route.shop_domain,route.topic,delivery,at])+'\n';
  return ['Content-Type','application/json','X-Rifare-Shop',route.shop_domain,'X-Rifare-Topic',route.topic,'X-Rifare-Delivery',delivery,'X-Rifare-Timestamp',at,
    'X-Rifare-Signature',createHmac('sha256',key).update(Buffer.concat([Buffer.from(prefix),raw])).digest('base64')];
}
