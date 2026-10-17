import {statusFacts} from '../agent/facts.mts';
import type {CommerceKernel,Scope,Row} from './kernel.mts';import type {ReadRunner} from '../agent/runner.mts';import type {ReadContext} from './read-context.mts';
import {exact,id,integer} from './kernel.mts';import {contentDigest,jsonValue} from './configuration-values.mts';
import {supportCase,saveDocument,checkedDocument,assertSupportOwner,supportEvent} from './support-core.mts';
export type SupportModelDestination={id:string;provider:string;model:string;region:string;configuration_digest:string};
export class SupportProviderRouting {
 readonly k:CommerceKernel;readonly catalog:ReadonlyMap<string,SupportModelDestination>;
 constructor(k:CommerceKernel,catalog:SupportModelDestination[]){this.k=k;const entries=new Map<string,SupportModelDestination>();for(const c of catalog){id(c.id);id(c.provider);id(c.region);if(typeof c.model!=='string'||c.model.length>120||!/^\w[\w.-]*$/.test(c.id)||!/^([a-f0-9]{64})$/.test(c.configuration_digest)||entries.has(c.id))throw new Error('MODEL_DESTINATION_INVALID');entries.set(c.id,Object.freeze({...c}));}this.catalog=entries;}
 configure(scope:Scope,input:unknown){const p=exact(jsonValue(input),['id','expected_version','primary','fallbacks','failure_threshold','cooldown_ms','expires_at','data_scope']);id(p.id);id(p.primary);integer(p.expected_version);integer(p.failure_threshold,1);integer(p.cooldown_ms,1000);integer(p.expires_at);
  if(!Array.isArray(p.fallbacks)||p.fallbacks.length>2||new Set([p.primary,...p.fallbacks]).size!==p.fallbacks.length+1||p.failure_threshold>5||p.cooldown_ms>3600000||p.expires_at<=this.k.clock()||p.expires_at>this.k.clock()+86400000||p.data_scope!=='current_task_minimized')throw new Error('MODEL_ROUTE_INVALID');
  const approved=[p.primary,...p.fallbacks].map(x=>{id(x);const d=this.catalog.get(x);if(!d)throw new Error('MODEL_DESTINATION_UNAPPROVED');return d;});
  return this.k.transaction(()=>{const s=this.k.authorize(scope,'support.configure');return saveDocument(this.k,s,'model_routes',p.id,p.expected_version,{...p,approved},'active',p.expires_at);});
 }
 candidates(scope:Scope,routeId:string){const s=this.k.require(scope),r=checkedDocument(this.k,s,'model_routes',routeId),destinations=r.body.approved as SupportModelDestination[];
  for(const d of destinations)if(contentDigest(d)!==contentDigest(this.catalog.get(d.id)))throw new Error('MODEL_DESTINATION_CHANGED');
  return {route:r,approved:destinations.filter(d=>{const c=this.k.db.prepare('SELECT * FROM commerce_model_circuits WHERE tenant_id=? AND store_id=? AND configuration_id=?').get(s.tenant_id,s.store_id,d.id) as Row;return !c||c.open_until<=this.k.clock();})};
 }
 record(scope:Scope,routeId:string,configurationId:string,success:boolean){return this.k.transaction(()=>{const s=this.k.require(scope),{route}=this.candidates(scope,routeId);if(!route.body.approved.some((d:any)=>d.id===configurationId))throw new Error('MODEL_DESTINATION_UNAPPROVED');const old=this.k.db.prepare('SELECT * FROM commerce_model_circuits WHERE tenant_id=? AND store_id=? AND configuration_id=?').get(s.tenant_id,s.store_id,configurationId) as Row,failures=success?0:(old?.failures??0)+1,until=success?0:failures>=route.body.failure_threshold?this.k.clock()+route.body.cooldown_ms:0;
  this.k.db.prepare('INSERT INTO commerce_model_circuits VALUES(?,?,?,?,?) ON CONFLICT(tenant_id,store_id,configuration_id) DO UPDATE SET failures=excluded.failures,open_until=excluded.open_until').run(s.tenant_id,s.store_id,configurationId,failures,until);return {failures,open_until:until};});}
 async run(scope:Scope,caseId:string,taskId:string,routeId:string,runner:Pick<ReadRunner,'run'|'configuration'>,reads:ReadContext,untrusted?:unknown) {
  const {s,c,owner}=assertSupportOwner(this.k,scope,caseId);this.k.authorize(scope,'model.run',c.resource_id);const task=reads.task(scope,taskId);if(task.order_id!==c.resource_id)throw new Error('ACCESS_DENIED');
  const initial=this.candidates(scope,routeId),attempted:string[]=[];
  for(const destination of initial.approved){assertSupportOwner(this.k,scope,caseId,owner.generation,owner.owner);const current=this.candidates(scope,routeId);if(current.route.digest!==initial.route.digest||!current.approved.some(x=>x.id===destination.id))throw new Error('MODEL_ROUTE_CHANGED');
   const native=runner.configuration(scope,destination.id);if(native.id!==destination.id||native.provider!==destination.provider||native.model!==destination.model||native.configuration_digest!==destination.configuration_digest)throw new Error('MODEL_DESTINATION_CHANGED');
   attempted.push(destination.id);let result:any;try{result=await runner.run(scope,taskId,destination.id,untrusted);}catch{result={status:'handoff',reason:'MODEL_UNAVAILABLE'};}
   // Late output is discarded; the read-only case and durable effects are never restarted.
   assertSupportOwner(this.k,scope,caseId,owner.generation,owner.owner);this.k.authorize(scope,'model.run',c.resource_id);
   if(this.candidates(scope,routeId).route.digest!==initial.route.digest)throw new Error('MODEL_ROUTE_CHANGED');
   const latest=reads.task(scope,taskId);const success=result.status==='grounded_read'&&result.source_digest===statusFacts(latest.facts).digest&&result.receipt?.configuration?.id===destination.id&&result.receipt?.configuration?.model===destination.model&&result.receipt?.skill_digest===latest.skill.bundle_digest;this.record(scope,routeId,destination.id,success);supportEvent(this.k,s,c.id,success?'model_answered':'model_handoff',owner.generation,id(destination.id));
   if(success)return {...result,attempted,route_digest:initial.route.digest};
   if(!['MODEL_UNAVAILABLE','MODEL_BUDGET_EXHAUSTED','MODEL_BUDGET_UNCONFIGURED','LOCAL_MODEL_UNAVAILABLE','MODEL_LIMIT'].includes(result.reason))break;
  }
  return {status:'handoff',reason:attempted.length?'APPROVED_PROVIDERS_UNAVAILABLE':'CIRCUIT_OPEN',attempted,manual_available:true,case_id:c.id,restart_business_actions:false};
 }
}
