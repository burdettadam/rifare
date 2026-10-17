import {SupportBranding} from './support-branding.mts';
import type {CommerceKernel,Scope,Row} from './kernel.mts';
import type {ReadContext} from './read-context.mts';
import {supportCase} from './support-core.mts';
import {contentDigest} from './configuration-values.mts';
export class SupportTracking {
 readonly k:CommerceKernel;readonly reads:ReadContext;
 constructor(k:CommerceKernel,reads:ReadContext){this.k=k;this.reads=reads;}
 read(scope:Scope,caseId:string) {
  const {c}=supportCase(this.k,scope,caseId),value=this.reads.orderStatus(scope,c.resource_id),now=this.k.clock(),source=value.source;
  const fresh=(s:Row)=>s&&Number.isSafeInteger(s.observed_at)&&Number.isSafeInteger(s.source_updated_at)&&s.observed_at<=now&&s.source_updated_at<=s.observed_at&&s.observed_at+300000>now;
  if(!value.order||!fresh(source))return {case_id:c.id,resource_id:c.resource_id,brand:new SupportBranding(this.k).read(scope).name,branding:new SupportBranding(this.k).read(scope),status:'unavailable',shipments:[],all_delivered:false,estimated_delivery:null,source,production_qualified:false};
  const rows=value.order.shipments;
  if(!Array.isArray(rows)||rows.length>100)return {case_id:c.id,resource_id:c.resource_id,brand:new SupportBranding(this.k).read(scope).name,branding:new SupportBranding(this.k).read(scope),status:'unsupported',shipments:[],all_delivered:false,estimated_delivery:null,source,production_qualified:false};
  const seen=new Set<string>();const shipments=rows.map((r:any)=>{
   if(typeof r.source_id!=='string'||seen.has(r.source_id))throw new Error('TRACKING_SOURCE_CONFLICT');seen.add(r.source_id);
   const current=fresh(r.source),known=['pre_transit','in_transit','delayed','exception','delivered','returned','cancelled','unknown'].includes(r.delivery_state);
   const status=current&&known?r.delivery_state:'unknown';
   return {id:r.source_id,status,freshness:current?'current':'stale',carrier:typeof r.carrier==='string'?r.carrier:'unknown',tracking_number:typeof r.tracking_number==='string'?r.tracking_number:null,
    source:r.source,estimated_delivery:null,next_step:status==='delayed'||status==='exception'?'request_human_review':status==='delivered'?'carrier_delivery_not_warehouse_inspection':'check_source_or_contact_support'};
  });
  const complete=['scoped_fixture_snapshot','complete'].includes(value.order.shipments_status);
  const result={case_id:c.id,resource_id:c.resource_id,brand:new SupportBranding(this.k).read(scope).name,branding:new SupportBranding(this.k).read(scope),status:'available',shipments,all_delivered:complete&&shipments.length>0&&shipments.every(r=>r.status==='delivered'&&r.freshness==='current'),
   history_complete:complete,estimated_delivery:null,source,production_qualified:false};
  return {...result,source_digest:contentDigest(result),marketing_content:[],warehouse_received:false};
 }
}
