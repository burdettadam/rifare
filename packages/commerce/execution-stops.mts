import { assertRecoveryAction,assertRecoveredOperation } from './data-guards.mts';
import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { exact,id,integer } from './kernel.mts';
import { contentDigest } from './configuration-values.mts';

export const STOP_ACTIONS=Object.freeze(['diagnostic.instant.authorize','diagnostic.instant.reauthorize','diagnostic.instant.capture','diagnostic.instant.cancel','helpdesk.write','diagnostic.order.edit','diagnostic.warehouse.receive','diagnostic.warehouse.disposition','diagnostic.return.cancel','diagnostic.exchange.create','diagnostic.label.purchase','diagnostic.label.void','diagnostic.return.resolve','diagnostic.resolution.set','diagnostic.return.submit','diagnostic.return.create','diagnostic.projection.record','model.run','customer.message','credential.probe']);
export function controlAction(action:string){return action==='diagnostic.case.record'?'diagnostic.resolution.set':action;}
const key=(tenant:string|null,store:string|null,action:string)=>JSON.stringify([tenant,store,action]);
export function controlState(k:CommerceKernel,s:Row,action:string){
  action=controlAction(action);
  const entries=[[null,null,'*'],[s.tenant_id,s.store_id,'*'],[s.tenant_id,s.store_id,action]];
  const rows=entries.map(([t,st,a])=>k.db.prepare('SELECT revision,stopped,reason FROM commerce_execution_stops WHERE scope_key=?').get(key(t,st,a!)) as Row|undefined);
  return {action,stamp:rows.map(r=>r?.revision??0).join(':'),stopped:rows.some(r=>r?.stopped===1),reasons:rows.filter(r=>r?.stopped).map(r=>r!.reason)};
}
export function assertExecution(k:CommerceKernel,s:Row,action:string,stamp?:string){
  assertRecoveryAction(k,action);const state=controlState(k,s,action);
  if(state.stopped)throw new Error('EXECUTION_STOPPED');
  if(stamp!==undefined&&state.stamp!==stamp)throw new Error('EXECUTION_REAUTHORIZATION_REQUIRED');
  return state;
}
export function controlEvent(k:CommerceKernel,s:Row,code:string,subject:string,generation:number){
  k.db.prepare('INSERT INTO commerce_control_events(tenant_id,store_id,code,actor_id,subject_id,generation,observed_at) VALUES(?,?,?,?,?,?,?)')
    .run(s.tenant_id??null,s.store_id??null,code,s.actor_id,id(subject),generation,k.clock());
}
export function assertOperationExecution(k:CommerceKernel,s:Row,op:Row){
  assertRecoveredOperation(k,s,op.id);
  const p=k.db.prepare('SELECT stamp FROM commerce_operation_controls WHERE tenant_id=? AND store_id=? AND operation_id=?').get(s.tenant_id,s.store_id,op.id) as Row;
  if(!p)throw new Error('EXECUTION_REAUTHORIZATION_REQUIRED');
  return assertExecution(k,s,JSON.parse(op.command).action,p.stamp);
}
export class ExecutionStops {
  #k:CommerceKernel;constructor(k:CommerceKernel){this.#k=k;}
  #set(s:Row,action:string,p:Row){
    const k=this.#k,where=key(s.tenant_id,s.store_id,action);
    integer(p.expected_revision);if(typeof p.stopped!=='boolean'||!['incident','maintenance','reviewed_resume'].includes(p.reason))throw new Error('INVALID_INPUT');
    const old=k.db.prepare('SELECT * FROM commerce_execution_stops WHERE scope_key=?').get(where) as Row;
    if((old?.revision??0)!==p.expected_revision)throw new Error('CONTROL_CHANGED');
    if(old?.stopped===Number(p.stopped))throw new Error('CONTROL_UNCHANGED');
    k.db.prepare(`INSERT INTO commerce_execution_stops VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(scope_key) DO UPDATE SET revision=excluded.revision,stopped=excluded.stopped,reason=excluded.reason,changed_by=excluded.changed_by,changed_at=excluded.changed_at`)
      .run(where,s.tenant_id,s.store_id,action,p.expected_revision+1,Number(p.stopped),p.reason,s.actor_id,k.clock());
    controlEvent(k,s,p.stopped?'execution_stopped':'execution_resumed','control',p.expected_revision+1);
    return {revision:p.expected_revision+1,stopped:p.stopped,old_work_requires_reauthorization:true};
  }
  set(scope:Scope,input:unknown){const p=exact(input,['action','stopped','reason','expected_revision']);
    if(p.action!=='*'&&!STOP_ACTIONS.includes(p.action))throw new Error('INVALID_INPUT');
    return this.#k.transaction(()=>this.#set(this.#k.authorize(scope,'stop.manage'),p.action,p));}
  // Server-local deployment administration only. No tenant HTTP route exposes this method.
  setGlobal(input:unknown){const p=exact(input,['stopped','reason','expected_revision']);return this.#k.transaction(()=>this.#set({tenant_id:null,store_id:null,actor_id:'deployment_admin'},'*',p));}
  status(scope:Scope,action:string){const s=this.#k.require(scope);if(!STOP_ACTIONS.includes(action))throw new Error('INVALID_INPUT');return controlState(this.#k,s,action);}
  reauthorize(scope:Scope,operationId:string,expectedRevision:number){const k=this.#k;id(operationId);integer(expectedRevision,1);
    return k.transaction(()=>{
      const s=k.require(scope),op=k.db.prepare('SELECT * FROM commerce_operations WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,operationId) as Row;
      if(!op)throw new Error('NOT_FOUND');k.authorize(scope,'operation.reauthorize',op.resource_id);k.get(scope,op.resource_id);
      if(contentDigest(JSON.parse(op.command))!==op.payload_hash)throw new Error('OPERATION_INTEGRITY');
      const w=k.db.prepare('SELECT * FROM commerce_operation_work WHERE tenant_id=? AND store_id=? AND operation_id=?').get(s.tenant_id,s.store_id,op.id) as Row;
      if(op.revision!==expectedRevision)throw new Error('OPERATION_CHANGED');
      if(!['pending','retry_wait'].includes(w.state)||!['queued','retry_wait'].includes(op.state))throw new Error('RECONCILIATION_REQUIRED');
      const c=assertExecution(k,s,JSON.parse(op.command).action);
      k.db.prepare('UPDATE commerce_operation_controls SET stamp=?,revision=revision+1 WHERE tenant_id=? AND store_id=? AND operation_id=?').run(c.stamp,s.tenant_id,s.store_id,op.id);
      controlEvent(k,s,'operation_reauthorized',op.id,op.revision);
      return {operation_id:op.id,control_stamp:c.stamp,execution_authorized:false};
    });
  }
}
