import { commerceFixture } from './commerce-helpers.mts';
import { Capabilities } from '../../packages/commerce/capabilities.mts';
import { StoreSimulator,FIXTURE_CLOCK } from '../../packages/commerce/simulator.mts';
import { ReadContext } from '../../packages/commerce/read-context.mts';
import { loadSkillDirectory } from '../../packages/commerce/skills.mts';
import { fileURLToPath } from 'node:url';
export function readFixture() {
  const f=commerceFixture(),caps=new Capabilities(f.kernel),simulator=new StoreSimulator(f.kernel,caps),reads=new ReadContext(f.kernel,caps);
  simulator.reset(f.a.scope);simulator.reset(f.b.scope,{profile:'fragile',clock:FIXTURE_CLOCK});simulator.reset(f.c.scope);
  const bundle=loadSkillDirectory(fileURLToPath(new URL('../../packages/commerce/skill-bundles/order-status/',import.meta.url)));
  for(const store of [f.a,f.b,f.c])reads.skills.install(store.scope,bundle);
  const profile=(store=f.a,extras={})=>({id:'default',revision:1,tenant_id:store.tenant,store_id:store.store,
    skill_id:bundle.id,skill_digest:bundle.digest,tone:'neutral',locale:'en-US',
    actions:['order.status','knowledge.search','knowledge.get','skill.read'],data_scope:{order:'session_or_store',knowledge:'visible_only'},...extras});
  const source=(extras={})=>({id:'shipping',revision:1,kind:'policy',title:'Shipping reference',content:'A parcel may arrive separately.',
    source_uri:'https://merchant.example.invalid/shipping',source_updated_at:f.now(),expires_at:f.now()+60000,visibility:'store',resource_id:null,...extras});
  const order=(store=f.a)=>f.kernel.lookup(store.scope,'order','synthetic','ORD-1001');
  return {...f,caps,simulator,reads,bundle,profile,source,order};
}
export function useRead(fn:(f:ReturnType<typeof readFixture>)=>unknown) {
  const f=readFixture();try{return fn(f);}finally{f.cleanup();}
}
