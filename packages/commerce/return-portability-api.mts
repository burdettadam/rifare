import type {CommerceKernel,Scope,Row} from './kernel.mts';
import {exact,id} from './kernel.mts';
import {CaseConfigurations} from './case-configurations.mts';
import {ReturnIntake} from './return-intake.mts';
import {ReadContext} from './read-context.mts';
import {ResolutionExecution} from './resolution-execution.mts';
import {SupportService} from './support-service.mts';
import {contentDigest} from './configuration-values.mts';
import {permissionDecision} from './authorization.mts';

/** A read composition for the existing common APIs. It grants no action or approval. */
export class ReturnPortabilityApi {
 readonly k:CommerceKernel;readonly reads:ReadContext;readonly execution:ResolutionExecution|null;readonly support:SupportService|null;
 constructor(k:CommerceKernel,reads:ReadContext,execution:ResolutionExecution|null,support:SupportService|null){if(execution&&execution.kernel!==k||support&&support.k!==k)throw new Error('RESOLUTION_SOURCE_MISMATCH');this.k=k;this.reads=reads;this.execution=execution;this.support=support;}
 context(scope:Scope,input:unknown){const p=exact(input,['case_id']),k=this.k,c=new CaseConfigurations(k).resume(scope,id(p.case_id)),s=k.authorize(scope,'return.read',c.resource_id),intake=new ReturnIntake(k);
  const request=intake.read(scope,c.id),form=intake.form(scope,c.id),privateView=['owner','operator','reviewer','agent','worker','integration'].includes(s.role)&&permissionDecision(k.db,s,'operation.read',c.resource_id).allowed;
  const rows=privateView?k.db.prepare('SELECT * FROM commerce_resolution_operations WHERE tenant_id=? AND store_id=? AND case_id=? ORDER BY id LIMIT 101').all(s.tenant_id,s.store_id,c.id) as Row[]:[];
  if(rows.length>100)throw new Error('WORK_CONTEXT_LIMIT');
  const operations=rows.map(row=>this.execution?.source.identity===row.source_identity?this.execution.read(scope,row.id):{id:row.id,kind:row.kind,state:row.state,qualification:'source_unavailable',cash_settled:false,retry_allowed:false});
  const allocations=privateView?(k.db.prepare('SELECT id,plan_id,line_id,outcome,body,digest FROM commerce_resolution_allocations WHERE tenant_id=? AND store_id=? AND case_id=? ORDER BY id LIMIT 101').all(s.tenant_id,s.store_id,c.id) as Row[]).map(r=>{const b=JSON.parse(r.body);if(contentDigest(b)!==r.digest)throw new Error('RESOLUTION_INTEGRITY');return {id:r.id,plan_id:r.plan_id,line_id:r.line_id,outcome:r.outcome,units:b.units};}):[];
  if(allocations.length>100)throw new Error('WORK_CONTEXT_LIMIT');
  const previewRows=privateView?k.db.prepare('SELECT * FROM commerce_action_previews WHERE tenant_id=? AND store_id=? AND case_id=? ORDER BY rowid DESC LIMIT 101').all(s.tenant_id,s.store_id,c.id) as Row[]:[];
  if(previewRows.length>100)throw new Error('WORK_CONTEXT_LIMIT');
  const previews=previewRows.flatMap(row=>{const b=JSON.parse(row.body);if(contentDigest(b)!==row.digest||b.case_id!==c.id||b.resource_id!==c.resource_id||b.tenant_id!==s.tenant_id||b.store_id!==s.store_id)throw new Error('PREVIEW_INTEGRITY');
   if(!['diagnostic.return.submit','diagnostic.return.resolve'].includes(b.action))return [];
   const approval=k.db.prepare('SELECT * FROM commerce_action_approvals WHERE tenant_id=? AND store_id=? AND preview_id=?').get(s.tenant_id,s.store_id,row.id) as Row;
   const member=approval?k.db.prepare('SELECT * FROM commerce_members WHERE tenant_id=? AND store_id=? AND actor_id=? AND active=1').get(s.tenant_id,s.store_id,approval.approver) as Row:null;
   const decision=member?permissionDecision(k.db,member,'action.approve',c.resource_id):null;
   const usable=!!approval&&!approval.revoked&&approval.uses<approval.max_uses&&approval.expires_at>k.clock()&&approval.preview_digest===row.digest&&approval.approver!==row.proposer&&!!decision?.allowed&&decision.authority_revision===approval.authority_revision;
   return [{id:row.id,digest:row.digest,action:b.action,configuration_digest:b.configuration_digest,expires_at:b.expires_at,approval:usable?{id:approval.id,preview_id:row.id,preview_digest:row.digest}:null}];});
  const ownership=this.support?.ownership.inspect(scope,c.id)??null;
  const deliveries=privateView&&this.support?(k.db.prepare("SELECT operation_id FROM commerce_support_deliveries WHERE tenant_id=? AND store_id=? AND case_id=? AND erased=0 AND json_extract(body,'$.refund_operation_id') IS NOT NULL ORDER BY created_at,operation_id LIMIT 101").all(s.tenant_id,s.store_id,c.id) as Row[]).map(r=>this.support!.delivery.inspect(scope,r.operation_id)):[];
  if(deliveries.length>100)throw new Error('WORK_CONTEXT_LIMIT');
  const body={case_id:c.id,resource_id:c.resource_id,platform:c.order.source_system,order:this.reads.orderStatus(scope,c.resource_id),form,request,previews,allocations,operations,ownership,deliveries,
   configuration:{digest:c.configuration_digest,policy_id:c.pins.policy.policy_id,policy_version:c.pins.policy.version,skill_id:c.pins.skill.id,skill_digest:c.pins.skill.digest},
   model_required:false,execution_authorized:false,production_qualified:false,connected_qualification:'not_performed'};
  return {...body,context_digest:contentDigest(body)};
 }
}
