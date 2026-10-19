import {CommerceKernel,exact,id,integer} from './kernel.mts';
import type {Scope,Row,Role} from './kernel.mts';
import {Permissions,ROLE_ACTIONS,permissionDecision} from './authorization.mts';
import {canonical,contentDigest,jsonValue} from './configuration-values.mts';

/** A subset of existing permissions, never another role or execution policy. */
export const AGENCY_DELEGABLE_ACTIONS=Object.freeze(['resource.read','attachment.read','knowledge.read','skill.read','profile.read','task.read','capability.read','policy.read','case.read','case.create','support.read','support.reply','support.send','support.note','support.takeover','support.analytics','profile.write','action.propose','action.execute','action.approve','operation.read','operation.dispatch','operation.reconcile','secret.invoke','skill.install','skill.stage','skill.evaluate','skill.write']);
export const AGENCY_ROLES=Object.freeze(['operator','reviewer']);
export function agencyOwner(k:CommerceKernel,scope:Scope){const s=k.authorize(scope,'authority.manage');if(s.role!=='owner')throw new Error('ACCESS_DENIED');return s;}
function delegation(role:unknown,actions:unknown,resources:unknown){
 if(!AGENCY_ROLES.includes(role as string)||!Array.isArray(actions)||actions.length>30||new Set(actions).size!==actions.length||actions.some(a=>typeof a!=='string'||!AGENCY_DELEGABLE_ACTIONS.includes(a)||!ROLE_ACTIONS[role as Role].includes(a)))throw new Error('AGENCY_PERMISSION_DENIED');
 if(resources!==null&&(!Array.isArray(resources)||resources.length>1000||new Set(resources).size!==resources.length))throw new Error('AGENCY_PERMISSION_DENIED');
 for(const resource of resources??[])id(resource);
}
export function agencyGrantBody(row:Row):Row {
 const b=exact(JSON.parse(row.body),['agency_id','actor_id','role','actions','resource_ids','revision','permission_revision','granted_by','updated_at','authority_revoked']);
 if(contentDigest(b)!==row.digest)throw new Error('AGENCY_RECORD_INTEGRITY');
 id(b.agency_id);id(b.actor_id);id(b.granted_by);integer(b.revision,1);integer(b.permission_revision,1);integer(b.updated_at);delegation(b.role,b.actions,b.resource_ids);
 if(b.actor_id!==row.id||b.revision!==row.revision||typeof b.authority_revoked!=='boolean')throw new Error('AGENCY_RECORD_INTEGRITY');return b;
}
export class AgencyAccess {
 readonly k:CommerceKernel;constructor(k:CommerceKernel){this.k=k;}
 #row(s:Row,actor:string){return this.k.db.prepare('SELECT * FROM commerce_agency_grants WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,actor) as Row|undefined;}
 current(scope:Scope,agencyId?:string,action?:string){
  const k=this.k,s=k.require(scope);if(agencyId!==undefined)id(agencyId);
  const row=this.#row(s,s.actor_id);if(!row)throw new Error('AGENCY_ACCESS_DENIED');const grant=agencyGrantBody(row);
  const p=k.db.prepare('SELECT * FROM commerce_permissions WHERE tenant_id=? AND store_id=? AND actor_id=?').get(s.tenant_id,s.store_id,s.actor_id) as Row;
  if(row.state!=='active'||grant.authority_revoked||grant.role!==s.role||agencyId!==undefined&&grant.agency_id!==agencyId||!p||p.revision!==grant.permission_revision||p.actions===null||canonical(JSON.parse(p.actions))!==canonical(grant.actions)||canonical(p.resource_ids===null?null:JSON.parse(p.resource_ids))!==canonical(grant.resource_ids))throw new Error('AGENCY_ACCESS_DENIED');
  if(action!==undefined)k.authorize(scope,action);return {s,grant,state:row.state};
 }
 /** Read current canonical authority for a queued proposal without creating a session. */
 assertMember(scope:Scope,actor:string,agencyId:string,permissionRevision:number,action:string){
  const owner=agencyOwner(this.k,scope),tenant=owner.tenant_id,store=owner.store_id;id(actor);id(agencyId);integer(permissionRevision,1);
  const member=this.k.db.prepare('SELECT * FROM commerce_members WHERE tenant_id=? AND store_id=? AND actor_id=? AND active=1').get(tenant,store,actor) as Row;
  const row=this.#row({tenant_id:tenant,store_id:store},actor);if(!member||!row)throw new Error('AGENCY_ACCESS_DENIED');const b=agencyGrantBody(row);
  const p=this.k.db.prepare('SELECT * FROM commerce_permissions WHERE tenant_id=? AND store_id=? AND actor_id=?').get(tenant,store,actor) as Row;
  const decision=permissionDecision(this.k.db,member,action);
  if(row.state!=='active'||b.authority_revoked||b.agency_id!==agencyId||b.role!==member.role||b.permission_revision!==permissionRevision||!decision.allowed||decision.authority_revision!==permissionRevision||!p||p.actions===null||canonical(JSON.parse(p.actions))!==canonical(b.actions)||canonical(p.resource_ids===null?null:JSON.parse(p.resource_ids))!==canonical(b.resource_ids))throw new Error('AGENCY_ACCESS_DENIED');return b;
 }
 grant(scope:Scope,input:unknown){
  const k=this.k;agencyOwner(k,scope);const p=exact(jsonValue(input),['agency_id','actor_id','role','actions','resource_ids','expected_revision']);
  id(p.agency_id);id(p.actor_id);integer(p.expected_revision);delegation(p.role,p.actions,p.resource_ids);
  return k.transaction(()=>{
   const s=agencyOwner(k,scope),old=this.#row(s,p.actor_id),member=k.db.prepare('SELECT * FROM commerce_members WHERE tenant_id=? AND store_id=? AND actor_id=?').get(s.tenant_id,s.store_id,p.actor_id) as Row;
   if((old?.revision??0)!==p.expected_revision)throw new Error('AGENCY_CHANGED');
   const prior=old?agencyGrantBody(old):null;
   if(member&&!old||member&&!AGENCY_ROLES.includes(member.role)||prior&&prior.agency_id!==p.agency_id)throw new Error('AGENCY_MEMBER_COLLISION');
   for(const resource of p.resource_ids??[])k.get(scope,resource);
   if(!member)k.provisionMember(s.tenant_id,s.store_id,p.actor_id,p.role);
   else if(!member.active)k.db.prepare('UPDATE commerce_members SET active=1 WHERE tenant_id=? AND store_id=? AND actor_id=?').run(s.tenant_id,s.store_id,p.actor_id);
   const permission=k.db.prepare('SELECT revision FROM commerce_permissions WHERE tenant_id=? AND store_id=? AND actor_id=?').get(s.tenant_id,s.store_id,p.actor_id) as Row;
   // Existing sessions must never gain a renewed or broader delegation silently.
   if(old)k.db.prepare('UPDATE commerce_sessions SET revoked=1 WHERE tenant_id=? AND store_id=? AND actor_id=?').run(s.tenant_id,s.store_id,p.actor_id);
   const changed=new Permissions(k).change(scope,{actor_id:p.actor_id,role:p.role,actions:p.actions,resource_ids:p.resource_ids,expected_revision:permission?.revision??0});
   const revision=p.expected_revision+1,body={agency_id:p.agency_id,actor_id:p.actor_id,role:p.role,actions:p.actions,resource_ids:p.resource_ids,revision,permission_revision:changed.revision,granted_by:s.actor_id,updated_at:k.clock(),authority_revoked:false};
   k.db.prepare("INSERT INTO commerce_agency_grants VALUES(?,?,?,?,'active',?,?) ON CONFLICT(tenant_id,store_id,id) DO UPDATE SET revision=excluded.revision,state='active',body=excluded.body,digest=excluded.digest").run(s.tenant_id,s.store_id,p.actor_id,revision,canonical(body),contentDigest(body));
   k.audit(scope,'agency_grant','allowed');return {agency_id:p.agency_id,actor_id:p.actor_id,revision,permission_revision:changed.revision,role:p.role,state:'active',global_authority:false};
  });
 }
 revoke(scope:Scope,input:unknown){
  const k=this.k;agencyOwner(k,scope);const p=exact(jsonValue(input),['agency_id','actor_id','expected_revision']);id(p.agency_id);id(p.actor_id);integer(p.expected_revision,1);
  return k.transaction(()=>{
   const s=agencyOwner(k,scope),row=this.#row(s,p.actor_id);if(!row)throw new Error('NOT_FOUND');const b=agencyGrantBody(row);
   if(row.revision!==p.expected_revision||b.agency_id!==p.agency_id)throw new Error('AGENCY_CHANGED');
   if(row.state==='revoked')return {agency_id:p.agency_id,actor_id:p.actor_id,revision:row.revision,state:'revoked',old_sessions_revoked:true};
   const member=k.db.prepare('SELECT * FROM commerce_members WHERE tenant_id=? AND store_id=? AND actor_id=?').get(s.tenant_id,s.store_id,p.actor_id) as Row;
   if(member&&!AGENCY_ROLES.includes(member.role))throw new Error('AGENCY_MEMBER_COLLISION');
   const permission=k.db.prepare('SELECT revision FROM commerce_permissions WHERE tenant_id=? AND store_id=? AND actor_id=?').get(s.tenant_id,s.store_id,p.actor_id) as Row;
   let permissionRevision=permission?.revision??b.permission_revision;
   if(member?.active)permissionRevision=new Permissions(k).change(scope,{actor_id:p.actor_id,role:member.role,actions:[],resource_ids:[],expected_revision:permission?.revision??0}).revision;
   k.db.prepare('UPDATE commerce_members SET active=0 WHERE tenant_id=? AND store_id=? AND actor_id=?').run(s.tenant_id,s.store_id,p.actor_id);
   k.db.prepare('UPDATE commerce_sessions SET revoked=1 WHERE tenant_id=? AND store_id=? AND actor_id=?').run(s.tenant_id,s.store_id,p.actor_id);
   const revision=p.expected_revision+1,body={...b,revision,permission_revision:permissionRevision,updated_at:k.clock(),actions:[],resource_ids:[],authority_revoked:true};
   k.db.prepare("UPDATE commerce_agency_grants SET revision=?,state='revoked',body=?,digest=? WHERE tenant_id=? AND store_id=? AND id=?").run(revision,canonical(body),contentDigest(body),s.tenant_id,s.store_id,p.actor_id);
   k.audit(scope,'agency_revoke','allowed');return {agency_id:p.agency_id,actor_id:p.actor_id,revision,state:'revoked',old_sessions_revoked:true,other_stores_changed:false};
  });
 }
 inspect(scope:Scope,actorId?:string){const s=this.k.require(scope),actor=actorId??s.actor_id;id(actor);if(actor!==s.actor_id)agencyOwner(this.k,scope);const row=this.#row(s,actor);if(!row)throw new Error('NOT_FOUND');return {state:row.state,grant:agencyGrantBody(row),global_authority:false};}
}
