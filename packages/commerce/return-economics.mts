import {id} from './kernel.mts';
import type {CommerceKernel,Scope,Row} from './kernel.mts';
import {SupportMetrics} from './support-metrics.mts';
import {documentRow} from './support-core.mts';
import {contentDigest} from './configuration-values.mts';
import {allocationContext} from './resolution-ledger.mts';

const COSTS=['goods','shipping','platform_fees','operator_time'];
const TABLES=[['resolution','commerce_resolution_operations'],['fulfillment','commerce_fulfillment_operations'],['instant','commerce_instant_operations']] as const;

/** Merchant-level view over the existing frozen cohort, declared costs and
 * canonical operation journals. Declared contribution never proves settlement. */
export class ReturnEconomics {
 readonly k:CommerceKernel;constructor(k:CommerceKernel){this.k=k;}
 report(scope:Scope,cohortId:string){
  id(cohortId);const k=this.k,s=k.authorize(scope,'support.analytics');
  return k.transaction(()=>{
   const report=new SupportMetrics(k).report(scope,cohortId),cohort=documentRow(k,s,'metric_cohorts',cohortId);
   const incomplete:string[]=[],duplicateResources=new Set<string>(),seenResources=new Set<string>(),operations:Row[]=[],cases:Row[]=[];
   let revenue=0n,cost=0n;
   for(const member of cohort.body.members){
    if(seenResources.has(member.resource_id))duplicateResources.add(member.resource_id);seenResources.add(member.resource_id);
    const result=report.cases.find((r:Row)=>r.case_id===member.case_id)!;
    if(result.state==='unavailable_still_in_denominator'){
     incomplete.push(member.case_id);cases.push({case_id:member.case_id,available:false,costs_complete:false,retained_revenue_minor:null,total_cost_minor:null,contribution_minor:null});continue;
    }
    const rows=k.db.prepare('SELECT * FROM commerce_support_costs WHERE tenant_id=? AND store_id=? AND case_id=? AND at<=? ORDER BY id').all(s.tenant_id,s.store_id,member.case_id,k.clock()) as Row[];
    const complete=result.declared_contribution_minor!==null;
    const sum=(category:string)=>rows.filter(r=>r.category===category).reduce((n,r)=>n+BigInt(r.amount_minor??'0'),0n);
    const retained=sum('retained_revenue'),expenses=COSTS.reduce((n,category)=>n+sum(category),0n);
    if(!complete)incomplete.push(member.case_id);else{revenue+=retained;cost+=expenses;}
    cases.push({case_id:member.case_id,available:true,costs_complete:complete,retained_revenue_minor:complete?retained.toString():null,total_cost_minor:complete?expenses.toString():null,
     contribution_minor:result.declared_contribution_minor,missing_cost_categories:result.missing_cost_categories,source_refs:rows.map(r=>r.source_ref)});
    for(const [ledger,table] of TABLES){
     const ops=k.db.prepare(`SELECT * FROM ${table} WHERE tenant_id=? AND store_id=? AND case_id=? ORDER BY id`).all(s.tenant_id,s.store_id,member.case_id) as Row[];
     for(const op of ops){const command=JSON.parse(op.command);let identity=command;
      if(ledger==='resolution'){
       const allocation=allocationContext(k,scope,op.allocation_id,false);identity={case_id:allocation.c.id,resource_id:allocation.c.resource_id};
       if(command.allocation_id!==op.allocation_id||command.customer_id!==allocation.c.customer_id||command.resource_id!==identity.resource_id||command.amount_minor!==op.amount_minor||command.currency!==op.currency)throw new Error('ECONOMICS_OPERATION_INTEGRITY');
      }else if(ledger==='instant'){
       const obligation=k.db.prepare('SELECT * FROM commerce_instant_obligations WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,op.obligation_id) as Row;
       if(!obligation)throw new Error('ECONOMICS_OPERATION_INTEGRITY');const body=JSON.parse(obligation.body);identity=command.binding;
       if(contentDigest(body)!==obligation.digest||contentDigest(body.binding)!==contentDigest(identity)||command.obligation_id!==op.obligation_id)throw new Error('ECONOMICS_OPERATION_INTEGRITY');
      }
      if(contentDigest(command)!==op.digest||command.operation_id!==op.id||command.kind!==op.kind||identity.case_id!==member.case_id||identity.resource_id!==member.resource_id||command.tenant_id!==s.tenant_id||command.store_id!==s.store_id)throw new Error('ECONOMICS_OPERATION_INTEGRITY');
      operations.push({ledger,id:op.id,case_id:member.case_id,kind:op.kind,state:op.state,amount_minor:op.amount_minor??command.amount_minor??command.maximum_minor??null,currency:op.currency??command.currency??command.binding?.currency??null,native_id:op.native_id??null});
     }
    }
   }
   const complete=incomplete.length===0&&duplicateResources.size===0;
   return {cohort_id:cohortId,cohort_digest:cohort.digest,denominator:cohort.body.members.length,currency:'USD',costs_complete:complete,
    declared_retained_revenue_minor:complete?revenue.toString():null,declared_total_cost_minor:complete?cost.toString():null,declared_contribution_minor:complete?(revenue-cost).toString():null,
    incomplete_case_ids:incomplete,duplicate_resource_cost_scope:duplicateResources.size,cases,observed_operations:operations,
    uncertain_operation_ids:operations.filter(o=>o.state==='unknown').map(o=>o.id),
    basis:'declared_costs_and_canonical_operation_observations',declared_costs_verified:false,profitability_established:false,
    external_settlement_qualified:false,production_qualified:false,execution_authorized:false};
  });
 }
}
