import { readFixture } from './read-workflow-helpers.mts';
import { CustomerAccess } from '../../packages/commerce/customer-access.mts';
import { startCommerceServer } from '../../apps/commerce-api/server.mts';
export async function setupAgent() {
  const f=readFixture(),outbox:any[]=[];
  for(const s of [f.a,f.b,f.c])f.reads.profiles.put(s.scope,f.profile(s));
  f.reads.knowledge.put(f.a.scope,f.source());
  const customers=new CustomerAccess(f.kernel,p=>outbox.push(p));
  const server=await startCommerceServer({kernel:f.kernel,caps:f.caps,customers,simulator:f.simulator,reads:f.reads});
  const request=(path:string,value?:unknown,bearer=f.a.bearer)=>fetch(server.url+path,{method:value===undefined?'GET':'POST',
    headers:{authorization:'Bearer '+bearer,...(value===undefined?{}:{'content-type':'application/json'})},
    body:value===undefined?undefined:JSON.stringify(value),signal:AbortSignal.timeout(5000)});
  const task=f.reads.createTask(f.a.scope,{order_id:f.order().id,profile_id:'default'});
  return {...f,customers,outbox,server,request,task};
}
export async function useAgent(fn:(f:Awaited<ReturnType<typeof setupAgent>>)=>unknown) {
  const f=await setupAgent();try{return await fn(f);}finally{await f.server.close();f.cleanup();}
}
