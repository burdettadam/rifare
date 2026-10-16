import { CommerceKernel,id,integer } from './kernel.mts';
import type { Scope,Row } from './kernel.mts';
import { permissionDecision } from './authorization.mts';
import { BusinessOperations,operationRow } from './operation-store.mts';
import { OperationReceipts } from './operation-receipts.mts';
import { Reconciliation } from './reconciliation.mts';
import { ExecutionStops,controlState } from './execution-stops.mts';
import type { SyntheticJournal } from '../adapters/reliability/synthetic-journal.mts';
export type JournalResolver=(tenant:string,store:string,identity:string)=>SyntheticJournal|undefined;

export class ExceptionQueue {
  #k:CommerceKernel;#resolve?:JournalResolver;
  constructor(k:CommerceKernel,resolve?:JournalResolver){this.#k=k;this.#resolve=resolve;}
  #source(s:Row,op:Row){const t=this.#k.db.prepare('SELECT provider_identity FROM commerce_operation_targets WHERE tenant_id=? AND store_id=? AND operation_id=?').get(s.tenant_id,s.store_id,op.id) as Row;
    return t?this.#resolve?.(s.tenant_id,s.store_id,t.provider_identity):undefined;}
  list(scope:Scope,limit=50){integer(limit,1);if(limit>100)throw new Error('INVALID_INPUT');const k=this.#k,s=k.authorize(scope,'exception.read');
    const rows=k.db.prepare("SELECT * FROM commerce_operations WHERE tenant_id=? AND store_id=? AND state<>'succeeded' ORDER BY created_at,id LIMIT 501").all(s.tenant_id,s.store_id) as Row[];
    const items=[] as Row[];
    for(const op of rows.slice(0,500)){
      if(items.length>=limit)break;if(!permissionDecision(k.db,s,'operation.read',op.resource_id).allowed||!permissionDecision(k.db,s,'resource.read',op.resource_id).allowed)continue;
      const value=new BusinessOperations(k).read(scope,op.id),control=controlState(k,s,JSON.parse(op.command).action),stamp=k.db.prepare('SELECT stamp FROM commerce_operation_controls WHERE tenant_id=? AND store_id=? AND operation_id=?').get(s.tenant_id,s.store_id,op.id) as Row;
      const caseRow=op.source_kind==='case'?k.db.prepare('SELECT c.id FROM commerce_action_receipts r JOIN commerce_cases c ON c.tenant_id=r.tenant_id AND c.store_id=r.store_id AND c.id=r.case_id WHERE r.tenant_id=? AND r.store_id=? AND r.id=? AND c.resource_id=?').get(s.tenant_id,s.store_id,op.source_id,op.resource_id) as Row:null;
      const lease=caseRow?k.db.prepare('SELECT owner,state,expires_at,generation FROM commerce_case_work WHERE tenant_id=? AND store_id=? AND case_id=?').get(s.tenant_id,s.store_id,caseRow.id) as Row:null;
      const expired=value.work.lease_until!==null&&value.work.lease_until<=k.clock();
      const state=op.state==='unknown'||op.state==='sending'&&expired?'unknown':op.state;
      const reason=state==='unknown'?'outcome_unknown':state==='failed'?'known_failure':control.stopped?'execution_stopped':stamp?.stamp!==control.stamp?'reauthorization_required':value.work.blocked_by?'prior_operation_unresolved':lease?.state==='active'&&lease.expires_at<=k.clock()?'worker_lease_expired':state;
      const canReconcile=['unknown','sending'].includes(state)&&!!this.#source(s,op)&&permissionDecision(k.db,s,'operation.reconcile',op.resource_id).allowed;
      const canReauthorize=!control.stopped&&stamp?.stamp!==control.stamp&&['pending','retry_wait'].includes(value.work.state)&&permissionDecision(k.db,s,'operation.reauthorize',op.resource_id).allowed;
      const actions=[{name:'reconcile',enabled:canReconcile},{name:'reauthorize',enabled:canReauthorize},{name:'retry',enabled:false}];
      const timeline=new OperationReceipts(k).list(scope,op.id).map(r=>({code:r.receipt.code,state:r.receipt.state,observed_at:r.receipt.observed_at,receipt_id:r.receipt.id}));
      const events=k.db.prepare('SELECT code,actor_id,generation,observed_at FROM commerce_control_events WHERE tenant_id=? AND store_id=? AND subject_id IN (?,?) ORDER BY seq').all(s.tenant_id,s.store_id,op.id,caseRow?.id??'none');
      items.push({operation_id:op.id,case_id:caseRow?.id??null,resource_id:op.resource_id,state,reason,operation_revision:op.revision,
        owner:lease?.state==='active'&&lease.expires_at>k.clock()?lease.owner:null,previous_owner:lease?.owner??null,generation:lease?.generation??null,
        controls:control,actions,timeline:[...timeline,...events].sort((a,b)=>a.observed_at-b.observed_at),source_state:value.state,automatic_retry:false,financial_effect:false});
    }
    // Include blocked or stale cases even when no outgoing operation has been created.
    const work=k.db.prepare('SELECT * FROM commerce_case_work WHERE tenant_id=? AND store_id=? ORDER BY case_id LIMIT 501').all(s.tenant_id,s.store_id) as Row[];
    for(const w of work.slice(0,500)){if(items.length>=limit)break;if(items.some(i=>i.case_id===w.case_id)||!permissionDecision(k.db,s,'case.read',w.resource_id).allowed)continue;
      const control=controlState(k,s,'diagnostic.resolution.set');const reason=control.stopped?'execution_stopped':w.state==='active'&&w.expires_at<=k.clock()?'worker_lease_expired':w.state==='revoked'?'owner_handoff':null;
      if(!reason)continue;items.push({operation_id:null,case_id:w.case_id,resource_id:w.resource_id,state:'blocked',reason,owner:null,previous_owner:w.owner,generation:w.generation,controls:control,
        actions:[],timeline:k.db.prepare('SELECT code,actor_id,generation,observed_at FROM commerce_control_events WHERE tenant_id=? AND store_id=? AND subject_id=? ORDER BY seq').all(s.tenant_id,s.store_id,w.case_id),automatic_retry:false,financial_effect:false});
    }
    return {items,scan_limit:500,truncated:rows.length>500||work.length>500||items.length>=limit,qualification:'synthetic_operations_only',refreshed_at:k.clock(),execution_authorized:false};
  }
  async reconcile(scope:Scope,operationId:string){const s=this.#k.authorize(scope,'exception.read'),op=operationRow(this.#k,s,id(operationId));
    this.#k.authorize(scope,'operation.reconcile',op.resource_id);const journal=this.#source(s,op);if(!journal)throw new Error('SOURCE_UNAVAILABLE');
    return new Reconciliation(this.#k).one(scope,operationId,journal);
  }
  reauthorize(scope:Scope,operationId:string,revision:number){this.#k.authorize(scope,'exception.read');return new ExecutionStops(this.#k).reauthorize(scope,operationId,revision);}
}
