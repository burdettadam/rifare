import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { checkedBody } from './resolution-ledger.mts';
import { labelRow,fulfillmentSettings,fulfillmentContext } from './return-fulfillment-core.mts';
import { FulfillmentExecution } from './fulfillment-execution.mts';
export class ReturnTracking {
 readonly kernel:CommerceKernel;readonly execution:FulfillmentExecution;
 constructor(execution:FulfillmentExecution){this.execution=execution;this.kernel=execution.kernel;}
 async refresh(scope:Scope,ref:string){await this.execution.refreshLabel(scope,ref);return this.read(scope,ref);}
 read(scope:Scope,ref:string){const k=this.kernel,r=labelRow(k,scope,ref),s=k.require(scope);
  const events=(k.db.prepare('SELECT * FROM commerce_carrier_events WHERE tenant_id=? AND store_id=? AND label_id=? ORDER BY source_version,event_id').all(s.tenant_id,s.store_id,ref) as Row[]).map(checked=>checkedBody(checked));
  const delivered=events.some(e=>e.status==='delivered'),transit=delivered||events.some(e=>e.status==='in_transit'),exception=r.label.tracking_state==='exception'||r.label.tracking_state==='returned';
  let settings:Row|null=null;try{fulfillmentContext(k,scope,r.case_id,r.request_id);settings=fulfillmentSettings(k,s);}catch{/* Unavailable policy is not permission for a resolution trigger. */}
  const trigger=r.label.resolution_trigger??'manual',configurationCurrent=settings?.digest===r.label.settings_digest,eligible=configurationCurrent&&!exception&&((trigger==='carrier_transit'&&transit)||(trigger==='carrier_delivery'&&delivered));
  return {label_id:ref,request_id:r.request_id,carrier:{status:r.label.tracking_state,in_transit_observed:transit,delivered_observed:delivered,exception,sequence:r.label.carrier_sequence},
   warehouse:{receipt:'pending',inspection:'pending',inventory_disposition:'not_recorded'},events,
   resolution_trigger:{policy:trigger,settings_digest:r.label.settings_digest,configuration_current:configurationCurrent,eligible,execution_authorized:false,reason:eligible?'REQUIRES_SEPARATE_APPROVED_RESOLUTION':'TRIGGER_NOT_SATISFIED'},
   qualification:'synthetic_only',carrier_delivery_is_warehouse_receipt:false};}
}
