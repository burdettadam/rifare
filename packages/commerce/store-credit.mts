import type { CommerceKernel,Scope } from './kernel.mts';
import { allocationContext,resolutionSettings } from './resolution-ledger.mts';
import { RefundQuotes } from './refund-quotes.mts';
import { ResolutionExecution } from './resolution-execution.mts';

/** Native-instrument credit shares the refund value and execution ledger. */
export class StoreCredit {
 readonly kernel:CommerceKernel;constructor(k:CommerceKernel){this.kernel=k;}
 quote(scope:Scope,allocationId:string){const c=allocationContext(this.kernel,scope,allocationId);
  if(c.a.outcome!=='store_credit'||resolutionSettings(this.kernel,c.s).credit_instrument!=='native_store_credit')throw new Error('CREDIT_UNQUALIFIED');
  return new RefundQuotes(this.kernel).quote(scope,{allocation_id:allocationId});}
 instrument(scope:Scope,execution:ResolutionExecution,operationId:string){
  if(execution.kernel!==this.kernel)throw new Error('RESOLUTION_SOURCE_MISMATCH');const op=execution.read(scope,operationId);
  if(op.kind!=='store_credit')throw new Error('CREDIT_UNQUALIFIED');
  const issued=op.observations.filter(r=>r.stage==='issued').at(-1);
  return {operation_id:op.id,state:op.state,instrument:issued?.body.instrument??null,amount_issued_minor:issued?op.amount_minor:null,
   observed_at:issued?.observed_at??null,balance_is_last_observed:true,cash_settlement:false,qualification:'synthetic_only'};
 }
}
