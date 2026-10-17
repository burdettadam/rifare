import { exact,id } from './kernel.mts';
import type { CommerceKernel,Scope } from './kernel.mts';
import { jsonValue } from './configuration-values.mts';
import { fulfillmentValue,saveFulfillmentQuote } from './return-fulfillment-core.mts';
export class ReplacementOrders {
 readonly kernel:CommerceKernel;constructor(k:CommerceKernel){this.kernel=k;}
 quote(scope:Scope,input:unknown){const p=exact(jsonValue(input),['reservation_id']);id(p.reservation_id);
  return this.kernel.transaction(()=>saveFulfillmentQuote(this.kernel,scope,fulfillmentValue(this.kernel,scope,'replacement',p,this.kernel.clock())));}
}
