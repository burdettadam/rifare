import type { CommerceKernel,Scope,Row,Role } from './kernel.mts';
import type { DatabaseSync } from 'node:sqlite';

const READ=['resource.read','attachment.read','knowledge.read','skill.read','profile.read','task.read','model.run','capability.read','policy.read','case.read','case.create','return.read'];
const OPERATOR=[...READ,'resource.ingest','job.enqueue','attachment.write','knowledge.write','skill.write','profile.write','secret.manage','secret.invoke','connection.manage','simulator.manage','audit.read','policy.draft','policy.test','skill.install','skill.stage','skill.evaluate','case.migrate','action.propose','action.execute','webhook.read','operation.read','event.process','operation.dispatch','operation.reconcile','audit.payload','work.claim','work.manage','exception.read','return.request','return.evidence'];
export const ROLE_ACTIONS:Readonly<Record<Role,readonly string[]>>=Object.freeze({
  owner:Object.freeze([...OPERATOR,'authority.manage','job.run','policy.review','policy.publish','policy.revoke','skill.approve','skill.review','skill.publish','skill.revoke','action.configure','action.approve','webhook.manage','audit.correct','audit.erase','stop.manage','operation.reauthorize','privacy.manage','recovery.manage','return.review']),operator:Object.freeze(OPERATOR),
  reviewer:Object.freeze([...READ.filter(a=>a!=='model.run'),'audit.read','policy.test','policy.review','skill.evaluate','skill.review','action.approve','operation.read','exception.read','return.review']),
  integration:Object.freeze([...READ.filter(a=>a!=='model.run'),'resource.ingest','job.run','attachment.write','secret.invoke','operation.read','event.process','operation.dispatch','operation.reconcile','work.claim']),
  agent:Object.freeze([...READ,'secret.invoke','policy.draft','action.propose','action.execute','operation.read','work.claim','return.request']),
  worker:Object.freeze([...READ,'resource.ingest','job.run','attachment.write','secret.invoke','operation.read','event.process','operation.dispatch','operation.reconcile','work.claim']),
  customer:Object.freeze(['case.create','case.read','resource.read','attachment.read','knowledge.read','skill.read','profile.read','task.read','capability.read','return.read','return.request','return.evidence']),
});
const RESOURCE_ACTIONS=new Set(['return.read','return.request','return.evidence','return.review','resource.read','resource.ingest','attachment.read','attachment.write','job.enqueue','job.run','case.create','case.read','case.migrate','action.propose','action.execute','action.approve','operation.read','event.process','operation.dispatch','operation.reconcile','work.claim','work.manage','operation.reauthorize']);
export function permissionDecision(db:DatabaseSync,s:Row,action:string,resourceId:string|null=null) {
  const p=db.prepare('SELECT * FROM commerce_permissions WHERE tenant_id=? AND store_id=? AND actor_id=?')
    .get(s.tenant_id,s.store_id,s.actor_id) as Row|undefined;
  const actions=p?.actions===null||!p?null:JSON.parse(p.actions),resources=p?.resource_ids===null||!p?null:JSON.parse(p.resource_ids);
  const known=typeof action==='string'&&ROLE_ACTIONS[s.role as Role]?.includes(action);
  const roleAllowed=!!known&&(actions===null||actions.includes(action));
  const resourceAllowed=!RESOURCE_ACTIONS.has(action)||(s.role!=='customer'||resourceId===s.resource_id)
    &&(resources===null||(resourceId!==null&&resources.includes(resourceId)));
  return {allowed:roleAllowed&&resourceAllowed,action:known?action:'unknown',role:s.role,authority_revision:p?.revision??0,
    resource_id:resourceId,reason:roleAllowed&&resourceAllowed?'ROLE_AND_SCOPE_ALLOW':'ROLE_OR_SCOPE_DENIED'};
}
export function recordSecurity(db:DatabaseSync,s:Row,action:string,decision:'allowed'|'denied',now:number,revision=0,target:string|null=null) {
  // Fixed operation names and identifiers only. Never record untrusted proposal text or credentials.
  db.prepare('INSERT INTO commerce_security_events(tenant_id,store_id,actor_id,target_actor,operation,decision,authority_revision,observed_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(s.tenant_id,s.store_id,s.actor_id,target,action,decision,revision,now);
}
function identifier(x:unknown){if(typeof x!=='string'||!/^[A-Za-z0-9_-]{1,96}$/.test(x))throw new Error('INVALID_INPUT');return x;}
export class Permissions {
  #k:CommerceKernel;
  constructor(kernel:CommerceKernel){this.#k=kernel;}
  preview(scope:Scope,action:string,resourceId:string|null=null) {
    const s=this.#k.require(scope);if(resourceId!==null)identifier(resourceId);
    return {...permissionDecision(this.#k.db,s,action,resourceId),preview_only:true,execution_authorized:false};
  }
  change(scope:Scope,input:unknown) {
    const k=this.#k,s=k.require(scope);
    if(!permissionDecision(k.db,s,'authority.manage').allowed){recordSecurity(k.db,s,'authority_change','denied',k.clock());throw new Error('ACCESS_DENIED');}
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).sort().join(',')!=='actions,actor_id,expected_revision,resource_ids,role')throw new Error('INVALID_INPUT');
    const r=input as Row;identifier(r.actor_id);
    if(!Object.hasOwn(ROLE_ACTIONS,r.role)||r.role==='customer'||!Number.isSafeInteger(r.expected_revision)||r.expected_revision<0)throw new Error('INVALID_INPUT');
    if(r.actions!==null&&(!Array.isArray(r.actions)||new Set(r.actions).size!==r.actions.length||r.actions.length>30
      ||r.actions.some((a:any)=>!ROLE_ACTIONS[r.role as Role].includes(a))))throw new Error('INVALID_PERMISSION');
    if(r.resource_ids!==null&&(!Array.isArray(r.resource_ids)||new Set(r.resource_ids).size!==r.resource_ids.length||r.resource_ids.length>1000))throw new Error('INVALID_PERMISSION');
    for(const resource of r.resource_ids??[])k.get(scope,identifier(resource));
    return k.transaction(()=>{
      k.require(scope);if(!permissionDecision(k.db,s,'authority.manage').allowed)throw new Error('ACCESS_DENIED');
      const target=k.db.prepare('SELECT * FROM commerce_members WHERE tenant_id=? AND store_id=? AND actor_id=? AND active=1')
        .get(s.tenant_id,s.store_id,r.actor_id) as Row;
      if(!target)throw new Error('NOT_FOUND');
      const old=k.db.prepare('SELECT revision FROM commerce_permissions WHERE tenant_id=? AND store_id=? AND actor_id=?')
        .get(s.tenant_id,s.store_id,r.actor_id) as Row;
      if((old?.revision??0)!==r.expected_revision)throw new Error('AUTHORITY_CHANGED');
      // Owners are deliberately unrestricted; transfer to another owner before demotion.
      if(r.role==='owner'&&(r.actions!==null||r.resource_ids!==null))throw new Error('INVALID_PERMISSION');
      if(target.role==='owner'&&r.role!=='owner'){
        const n=k.db.prepare("SELECT count(*) AS n FROM commerce_members WHERE tenant_id=? AND store_id=? AND role='owner' AND active=1")
          .get(s.tenant_id,s.store_id) as Row;
        if(n.n<=1)throw new Error('LAST_OWNER');
      }
      const revision=r.expected_revision+1;
      k.db.prepare('UPDATE commerce_members SET role=? WHERE tenant_id=? AND store_id=? AND actor_id=?').run(r.role,s.tenant_id,s.store_id,r.actor_id);
      k.db.prepare(`INSERT INTO commerce_permissions VALUES(?,?,?,?,?,?) ON CONFLICT(tenant_id,store_id,actor_id)
        DO UPDATE SET revision=excluded.revision,actions=excluded.actions,resource_ids=excluded.resource_ids`)
        .run(s.tenant_id,s.store_id,r.actor_id,revision,r.actions===null?null:JSON.stringify(r.actions),r.resource_ids===null?null:JSON.stringify(r.resource_ids));
      if(target.role!==r.role)k.db.prepare('UPDATE commerce_sessions SET revoked=1 WHERE tenant_id=? AND store_id=? AND actor_id=?').run(s.tenant_id,s.store_id,r.actor_id);
      recordSecurity(k.db,s,'authority_change','allowed',k.clock(),revision,r.actor_id);
      return {actor_id:r.actor_id,role:r.role,revision,old_sessions_revoked:target.role!==r.role};
    });
  }
  events(scope:Scope) {
    const s=this.#k.authorize(scope,'audit.read');
    return this.#k.db.prepare('SELECT actor_id,target_actor,operation,decision,authority_revision,observed_at FROM commerce_security_events WHERE tenant_id=? AND store_id=? ORDER BY id DESC LIMIT 100')
      .all(s.tenant_id,s.store_id);
  }
}
