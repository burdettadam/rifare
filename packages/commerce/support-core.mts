import type {CommerceKernel,Scope,Row} from './kernel.mts';
import {id,integer,exact} from './kernel.mts';
import {CaseConfigurations} from './case-configurations.mts';
import {canonical,contentDigest,jsonValue} from './configuration-values.mts';

export function supportCase(k:CommerceKernel,scope:Scope,caseId:string,action='support.read') {
 const c=new CaseConfigurations(k).inspect(scope,id(caseId)),s=k.authorize(scope,action,c.resource_id);
 return {s,c};
}
export function supportText(value:unknown,max=8000):string {
 if(typeof value!=='string'||!value.trim()||Buffer.byteLength(value)>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value))throw new Error('SUPPORT_INPUT_INVALID');
 return value;
}
export function supportEvent(k:CommerceKernel,s:Row,caseId:string,code:string,generation:number,ref:string) {
 id(caseId);id(code);id(ref);integer(generation);
 k.db.prepare('INSERT INTO commerce_support_events(tenant_id,store_id,case_id,code,actor_id,generation,ref,at) VALUES(?,?,?,?,?,?,?,?)')
  .run(s.tenant_id,s.store_id,caseId,code,s.actor_id,generation,ref,k.clock());
}
export function documentRow(k:CommerceKernel,s:Row,kind:string,ref:string,version?:number):any {
 id(kind);id(ref);if(version!==undefined)integer(version,1);
 const r=k.db.prepare(`SELECT * FROM commerce_support_documents WHERE tenant_id=? AND store_id=? AND kind=? AND id=? ${version===undefined?'ORDER BY version DESC LIMIT 1':'AND version=?'}`)
  .get(s.tenant_id,s.store_id,kind,ref,...(version===undefined?[]:[version])) as Row;
 if(!r)throw new Error('SUPPORT_CONFIGURATION_MISSING');const body=JSON.parse(r.body);
 if(contentDigest(body)!==r.digest)throw new Error('SUPPORT_CONFIGURATION_INTEGRITY');
 return {...r,body};
}
export function saveDocument(k:CommerceKernel,s:Row,kind:string,ref:string,expectedVersion:number,body:unknown,state='active',expires:number|null=null) {
 id(kind);id(ref);integer(expectedVersion);const b=jsonValue(body,32768);
 const prev=k.db.prepare('SELECT max(version) version FROM commerce_support_documents WHERE tenant_id=? AND store_id=? AND kind=? AND id=?').get(s.tenant_id,s.store_id,kind,ref) as Row;
 if((prev.version??0)!==expectedVersion)throw new Error('SUPPORT_CONFIGURATION_CHANGED');
 const version=expectedVersion+1;k.db.prepare('INSERT INTO commerce_support_documents VALUES(?,?,?,?,?,?,?,?,?,NULL,NULL,?,?)')
  .run(s.tenant_id,s.store_id,kind,ref,version,canonical(b),contentDigest(b),s.actor_id,state,k.clock(),expires);
 return documentRow(k,s,kind,ref,version);
}
export function checkedDocument(k:CommerceKernel,s:Row,kind:string,ref:string,version?:number) {
 const r=documentRow(k,s,kind,ref,version);
 if(r.state!=='active'||r.expires_at!==null&&r.expires_at<=k.clock())throw new Error('SUPPORT_CONFIGURATION_UNAVAILABLE');return r;
}
export function ownershipRow(k:CommerceKernel,s:Row,caseId:string) {
 return k.db.prepare('SELECT * FROM commerce_support_ownership WHERE tenant_id=? AND store_id=? AND case_id=?').get(s.tenant_id,s.store_id,caseId) as Row|undefined;
}
export function assertSupportOwner(k:CommerceKernel,scope:Scope,caseId:string,generation?:number,actor?:string) {
 const {s,c}=supportCase(k,scope,caseId),o=ownershipRow(k,s,caseId);
 if(!o||o.generation!==(generation??o.generation)||o.owner!==(actor??s.actor_id))throw new Error('SUPPORT_OWNERSHIP_CHANGED');
 if((s.role==='agent'||k.workerIdentity(scope)?.kind==='external_work')&&o.mode!=='agent')throw new Error('SUPPORT_TAKEN_OVER');
 return {s,c,owner:o};
}
export class SupportOwnership {
 readonly k:CommerceKernel;constructor(k:CommerceKernel){this.k=k;}
 inspect(scope:Scope,caseId:string) {const {s}=supportCase(this.k,scope,caseId);const row=ownershipRow(this.k,s,caseId);return row?{case_id:row.case_id,generation:row.generation,owner:row.owner,mode:row.mode,changed_at:row.changed_at}:null;}
 takeover(scope:Scope,input:unknown) {const p=exact(input,['case_id','expected_generation','reason']);integer(p.expected_generation);if(!['operator_requested','exception','provider_unavailable','budget_exhausted'].includes(p.reason))throw new Error('SUPPORT_INPUT_INVALID');
  return this.k.transaction(()=>{const {s,c}=supportCase(this.k,scope,p.case_id,'support.takeover'),old=ownershipRow(this.k,s,c.id);
   if((old?.generation??0)!==p.expected_generation)throw new Error('SUPPORT_OWNERSHIP_CHANGED');
   return this.#set(s,c,s.actor_id,'human',p.expected_generation+1,p.reason);});
 }
 assign(scope:Scope,input:unknown) {const p=exact(input,['case_id','expected_generation','actor_id']);integer(p.expected_generation);id(p.actor_id);
  return this.k.transaction(()=>{const {s,c}=supportCase(this.k,scope,p.case_id,'support.configure'),old=ownershipRow(this.k,s,c.id);
   if((old?.generation??0)!==p.expected_generation)throw new Error('SUPPORT_OWNERSHIP_CHANGED');
   const member=this.k.db.prepare("SELECT 1 FROM commerce_members WHERE tenant_id=? AND store_id=? AND actor_id=? AND role='agent' AND active=1").get(s.tenant_id,s.store_id,p.actor_id);
   if(!member)throw new Error('ACCESS_DENIED');return this.#set(s,c,p.actor_id,'agent',p.expected_generation+1,'assigned_to_agent');});
 }
 #set(s:Row,c:Row,actor:string,mode:string,generation:number,reason:string) {
  const k=this.k;k.db.prepare('INSERT INTO commerce_support_ownership VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,store_id,case_id) DO UPDATE SET generation=excluded.generation,owner=excluded.owner,mode=excluded.mode,changed_at=excluded.changed_at')
   .run(s.tenant_id,s.store_id,c.id,c.resource_id,generation,actor,mode,k.clock());
  k.db.prepare("UPDATE commerce_case_work SET state='revoked',generation=generation+1,expires_at=? WHERE tenant_id=? AND store_id=? AND case_id=?").run(k.clock(),s.tenant_id,s.store_id,c.id);
  k.db.prepare('UPDATE commerce_worker_grants SET revoked=1 WHERE tenant_id=? AND store_id=? AND case_id=?').run(s.tenant_id,s.store_id,c.id);
  supportEvent(k,s,c.id,reason,generation,actor);return {case_id:c.id,generation,owner:actor,mode,context_preserved:true,prior_worker_output_authorized:false};
 }
}
