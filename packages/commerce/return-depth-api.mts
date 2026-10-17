import {exact} from './kernel.mts';
import type {CommerceKernel,Scope} from './kernel.mts';
import type {Capabilities} from './capabilities.mts';
import type {OrderEdits} from './order-edit-execution.mts';
import type {FulfillmentFixtureSource} from '../adapters/fulfillment-fixture-source.mts';
import {RiskAssistance} from './risk-assistance.mts';
import {ReturnPrevention} from './return-prevention.mts';
import {QualifiedReturnDestinations} from './qualified-return-destinations.mts';
import {ReturnPolicyPacks} from './return-policy-packs.mts';
import {ReturnEconomics} from './return-economics.mts';

/** Authenticated transport only. Native fixture qualification and source consent
 * administration are deliberately absent from the public HTTP operation set. */
export class ReturnDepthApi {
 readonly risk:RiskAssistance;readonly prevention:ReturnPrevention;
 readonly destinations:QualifiedReturnDestinations|null;readonly packs:ReturnPolicyPacks;readonly economics:ReturnEconomics;
 constructor(k:CommerceKernel,caps:Capabilities,edits:OrderEdits,source?:FulfillmentFixtureSource){
  this.risk=new RiskAssistance(k);this.prevention=new ReturnPrevention(edits);
  this.destinations=source?new QualifiedReturnDestinations(k,source):null;
  this.packs=new ReturnPolicyPacks(k,caps,this.destinations);this.economics=new ReturnEconomics(k);
 }
 post(scope:Scope,op:string,p:unknown):unknown {
  switch(op){
   case 'risk/assess':return this.risk.assess(scope,p);
   case 'risk/read':return this.risk.read(scope,p);
   case 'risk/review':return this.risk.review(scope,p);
   case 'risk/appeal':return this.risk.appeal(scope,p);
   case 'destinations/configure':case 'destinations/bind':case 'destinations/evaluate':case 'destinations/select':case 'destinations/read':{
    if(!this.destinations)throw new Error('ADAPTER_UNAVAILABLE');
    switch(op){
     case 'destinations/configure':return this.destinations.configure(scope,p);
     case 'destinations/bind':return this.destinations.bind(scope,p);
     case 'destinations/evaluate':return this.destinations.evaluate(scope,p);
     case 'destinations/select':return this.destinations.select(scope,p);
     default:return this.destinations.read(scope,p);
    }
   }
   case 'prevention/configure':return this.prevention.configure(scope,p);
   case 'prevention/configuration':return this.prevention.configuration(scope,p);
   case 'prevention/approve':return this.prevention.approve(scope,p);
   case 'prevention/freeze':return this.prevention.freeze(scope,p);
   case 'prevention/analyze':return this.prevention.analyze(scope,p);
   case 'prevention/read':return this.prevention.read(scope,p);
   case 'prevention/preview':return this.prevention.preview(scope,p);
   case 'prevention/confirm':return this.prevention.confirm(scope,p);
   case 'prevention/revoke':return this.prevention.revoke(scope,p);
   case 'prevention/refresh-outcome':return this.prevention.refreshOutcome(scope,p);
   case 'prevention/report':return this.prevention.report(scope,p);
   case 'packs/put':return this.packs.put(scope,p);
   case 'packs/get':{const v=exact(p,['pack_id','revision']);return this.packs.get(scope,v.pack_id,v.revision===null?undefined:v.revision);}
   case 'packs/evaluate':return this.packs.evaluate(scope,p);
   case 'economics/report':return this.economics.report(scope,exact(p,['cohort_id']).cohort_id);
   default:throw new Error('NOT_FOUND');
  }
 }
}
