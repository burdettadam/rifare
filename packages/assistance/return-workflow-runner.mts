import { exact } from '../commerce/kernel.mts';
import type { Scope } from '../commerce/kernel.mts';
import { ReturnWorkflows } from '../commerce/return-workflows.mts';

// Deterministic orchestration. Model output is never a settlement or shipment oracle.
export class ReturnWorkflowRunner {
 readonly workflows:ReturnWorkflows;constructor(workflows:ReturnWorkflows){this.workflows=workflows;}
 resume(scope:Scope,input:unknown){const p=exact(input,['request_id','workflow']),ctx=this.workflows.status(scope,p);
  return {request_id:ctx.request_id,source_digest:ctx.source_digest,skill_digest:ctx.pin.skill_digest,configuration_digest:ctx.configuration_digest,
   stages:ctx.stages,handoff_required:ctx.handoff_required,reason:ctx.reason,model_required:false,prose_is_authority:false};}
 quote(scope:Scope,input:unknown){return this.workflows.quote(scope,input);}
}
