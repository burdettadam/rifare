import type {CommerceKernel,Scope,Row} from './kernel.mts';
import {exact,id,integer} from './kernel.mts';
import {AgencyAccess} from './agency-access.mts';
import {SupportMetrics} from './support-metrics.mts';
const COUNTS=Object.freeze(['denominator','attempted_cases','correct_handling','required_or_requested_handoffs','customer_confirmed_resolutions','ticket_closures','pending_cases','unavailable_cases','autonomous_financial_resolutions']);
const FOLLOWUP=Object.freeze(['mature','immature','missing_followup','recontacts']);
export class AgencyReports {
 readonly k:CommerceKernel;readonly access:AgencyAccess;readonly metrics:SupportMetrics;
 constructor(k:CommerceKernel){this.k=k;this.access=new AgencyAccess(k);this.metrics=new SupportMetrics(k);}
 report(agencyId:string,selections:readonly {scope:Scope;cohort_id:string}[]){
  id(agencyId);if(!Array.isArray(selections)||!selections.length||selections.length>20)throw new Error('AGENCY_REPORT_INPUT_INVALID');
  const total:Row=Object.fromEntries(COUNTS.map(key=>[key,0])),followup:Row=Object.fromEntries(FOLLOWUP.map(key=>[key,0])),stores=new Set<string>();let included=0,excluded=0;
  return this.k.transaction(()=>{
   for(const selection of selections){exact(selection,['scope','cohort_id']);id(selection.cohort_id);let authority:ReturnType<AgencyAccess['current']>;
    try{authority=this.access.current(selection.scope,agencyId,'support.analytics');}catch(error){if(error instanceof Error&&['ACCESS_DENIED','AGENCY_ACCESS_DENIED','WORK_SCOPE_DENIED'].includes(error.message)){excluded++;continue;}throw error;}
    const key=authority.s.tenant_id+':'+authority.s.store_id;if(stores.has(key))throw new Error('AGENCY_DUPLICATE_STORE');stores.add(key);
    const scoped=this.metrics.report(selection.scope,selection.cohort_id);for(const field of COUNTS)total[field]=integer(total[field]+integer(scoped[field]));
    for(const field of FOLLOWUP)followup[field]=integer(followup[field]+integer(scoped.repeat_contact[field]));included++;
   }
   // No case/resource/credential/source-detail projection or cached principal state.
   return {agency_id:agencyId,included_stores:included,excluded_stores:excluded,...total,correct_handling_rate:total.denominator?total.correct_handling/total.denominator:null,resolution_rate:total.denominator?total.customer_confirmed_resolutions/total.denominator:null,
    repeat_contact:{...followup,rate:followup.missing_followup||!followup.mature?null:followup.recontacts/followup.mature},refreshed_at:this.k.clock(),authority_revalidated:true,cached:false,receipt_state_not_ticket_state:true,production_qualified:false};
  });
 }
 drilldown(scope:Scope,agencyId:string,cohortId:string){this.access.current(scope,agencyId,'support.analytics');this.k.authorize(scope,'case.read');this.k.authorize(scope,'support.read');this.k.authorize(scope,'resource.read');return this.metrics.report(scope,cohortId);}
}
