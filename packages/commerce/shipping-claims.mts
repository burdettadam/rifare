import { exact,id } from './kernel.mts';
import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { assertExecution } from './execution-stops.mts';
import { ClaimsFixtureSource } from '../adapters/claims-fixture-source.mts';
import { PartnerReadiness } from './partner-readiness.mts';
import { claimsRow,claimsSourceScope,claimsCase,claimsCustomer,claimsCurrentCustomer,claimsAttachments,claimsResourcePin,claimsAssertResourcePin,claimsApprove,ClaimSubmissions,CLAIM_ACTIONS,CLAIMS_QUALIFICATION } from './claims-core.mts';

export class ShippingClaims {
  readonly k:CommerceKernel;readonly source:ClaimsFixtureSource;readonly readiness:PartnerReadiness;readonly submissions:ClaimSubmissions;
  constructor(k:CommerceKernel,source:ClaimsFixtureSource,readiness:PartnerReadiness){this.k=k;this.source=source;this.readiness=readiness;
    this.submissions=new ClaimSubmissions(k,source,readiness,{kind:'shipping',approvalKind:'shipping',action:CLAIM_ACTIONS.shipping,service:'shipping_claims',get:(scope,ref)=>this.row(scope,ref),current:(scope,row)=>this.current(scope,row),linked:(_scope,row,operation,state)=>{k.db.prepare('UPDATE commerce_shipping_claims SET operation_id=?,state=? WHERE tenant_id=? AND store_id=? AND id=?').run(operation,state,row.tenant_id,row.store_id,row.id);}});
  }
  row(scope:Scope,ref:string){return claimsRow(this.k,scope,'commerce_shipping_claims',ref);}
  draft(scope:Scope,customerScope:Scope,input:unknown){const p=exact(jsonValue(input),['claim_id','case_id','shipment_id','loss_type','evidence_ids']);id(p.claim_id);id(p.case_id);id(p.shipment_id);if(!['damage','loss'].includes(p.loss_type))throw new Error('CLAIM_LOSS_TYPE_UNSUPPORTED');
    return this.k.transaction(()=>{const {c,s,hash}=claimsCase(this.k,scope,p.case_id);claimsSourceScope(this.k,s,this.source);this.source.assertInterface();const proof=this.source.shipment(p.shipment_id),customer=claimsCustomer(this.k,customerScope,c.resource_id,c.customer_id);
      if(proof.resource_id!==c.resource_id||proof.customer_id!==c.customer_id||customer.tenant_id!==s.tenant_id||customer.store_id!==s.store_id)throw new Error('CLAIM_SOURCE_SCOPE');
      const shipment=this.k.get(scope,proof.shipment_resource_id);if(shipment.kind!=='shipment'||shipment.customer_id!==c.customer_id||shipment.payload.order_resource_id!==c.resource_id||shipment.source_version!==proof.shipment_version||shipment.payload.carrier!==proof.carrier)throw new Error('SHIPPING_SOURCE_CHANGED');
      const business_key=contentDigest(['shipping',this.source.identity,p.shipment_id]);if(this.k.db.prepare('SELECT 1 FROM commerce_shipping_claims WHERE tenant_id=? AND store_id=? AND (id=? OR business_key=?)').get(s.tenant_id,s.store_id,p.claim_id,business_key))throw new Error('ORIGINAL_SUBMISSION_REQUIRED');
      const evidence=claimsAttachments(this.k,s,c.id,p.evidence_ids),context=this.source.context('shipping_claims','submit'),available=this.readiness.inspect(scope,context),partner_pin=available.ready?this.readiness.assertReady(scope,context):null;
      const qualified=proof.coverage==='insured'&&proof.eligible&&proof.policy_ref!==null&&proof.deadline_at>this.k.clock()&&shipment.payload.status===(p.loss_type==='damage'?'damaged':'lost')&&partner_pin!==null;
      const controls=assertExecution(this.k,s,CLAIM_ACTIONS.shipping),body={case_id:c.id,shipment_id:p.shipment_id,loss_type:p.loss_type,source_proof:proof,source_digest:contentDigest(proof),order_pin:claimsResourcePin(c.order),shipment_pin:claimsResourcePin(shipment),evidence,evidence_hash:contentDigest(evidence),claimant_session_hash:customer.token_hash,proposed_by:s.actor_id,context,partner_pin,control_stamp:controls.stamp,route:qualified?'qualified_claim':'merchant_review',created_at:this.k.clock()};
      this.k.db.prepare('INSERT INTO commerce_shipping_claims VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,p.claim_id,c.resource_id,c.customer_id,hash,'proposed',null,null,business_key,canonical(body),contentDigest(body));return this.read(scope,p.claim_id);
    });
  }
  current(scope:Scope,row:Row){const s=this.k.require(scope);claimsSourceScope(this.k,s,this.source);this.source.assertInterface();const body=row.body,proof=this.source.shipment(body.shipment_id);
    if(contentDigest(proof)!==body.source_digest||proof.resource_id!==row.resource_id||proof.customer_id!==row.customer_id)throw new Error('EVIDENCE_SOURCE_CHANGED');
    claimsAssertResourcePin(this.k,scope,body.order_pin);const shipment=claimsAssertResourcePin(this.k,scope,body.shipment_pin);
    if(proof.coverage!=='insured'||!proof.eligible||proof.policy_ref===null||shipment.payload.status!==(body.loss_type==='damage'?'damaged':'lost'))throw new Error('SHIPPING_COVERAGE_UNCONFIRMED');
    if(proof.deadline_at<=this.k.clock())throw new Error('CLAIM_DEADLINE_ELAPSED');claimsCurrentCustomer(this.k,s,body.claimant_session_hash,row.resource_id,row.customer_id);
    const evidence=claimsAttachments(this.k,s,body.case_id,body.evidence.map((entry:Row)=>entry.id));if(contentDigest(evidence)!==body.evidence_hash)throw new Error('EVIDENCE_SOURCE_CHANGED');
    const context=this.source.context('shipping_claims','submit');if(!body.partner_pin)throw new Error('PARTNER_REVIEW_REQUIRED');const pin=this.readiness.assertReady(scope,context,body.partner_pin);assertExecution(this.k,s,CLAIM_ACTIONS.shipping,body.control_stamp);
    return {source:proof,source_record_id:proof.shipment_id,business_key:row.business_key,deadline_at:proof.deadline_at,maximum_minor:proof.amount_minor,currency:proof.currency,evidence_hash:body.evidence_hash,payload:{shipment_id:proof.shipment_id,carrier:proof.carrier,coverage:proof.coverage,policy_ref:proof.policy_ref,loss_type:body.loss_type,shipment_pin:body.shipment_pin,order_pin:body.order_pin,evidence},context,pin};
  }
  approve(scope:Scope,input:unknown){const p=exact(jsonValue(input),['claim_id','expected_digest','expires_at']);id(p.claim_id);return this.k.transaction(()=>{const row=this.row(scope,p.claim_id);this.k.authorize(scope,'action.approve',row.resource_id);if(row.operation_id!==null)throw new Error('ORIGINAL_SUBMISSION_REQUIRED');const current=this.current(scope,row),approval=claimsApprove(this.k,scope,'shipping',row,p,{deadline_at:current.deadline_at,partner_pin:current.pin,control_stamp:row.body.control_stamp,evidence_hash:current.evidence_hash});
    this.k.db.prepare("UPDATE commerce_shipping_claims SET state='approved',approval_id=? WHERE tenant_id=? AND store_id=? AND id=?").run(approval.id,row.tenant_id,row.store_id,row.id);return approval;});}
  async submit(scope:Scope,input:unknown){const p=exact(jsonValue(input),['claim_id','operation_id']);await this.submissions.submit(scope,id(p.claim_id),id(p.operation_id));return this.read(scope,p.claim_id);}
  async reconcile(scope:Scope,ref:string){await this.submissions.reconcile(scope,ref);return this.read(scope,ref);}
  read(scope:Scope,ref:string){const row=this.row(scope,ref),body=row.body,submission=row.operation_id?this.submissions.find(scope,row.id):null,result=submission?.body.result,stage=submission?.state??row.state;
    return {id:row.id,resource_id:row.resource_id,digest:row.digest,shipment_id:body.shipment_id,carrier:body.source_proof.carrier,coverage:body.source_proof.coverage,policy_ref:body.source_proof.policy_ref,deadline_at:body.source_proof.deadline_at,route:body.route,evidence:body.evidence,operation_id:row.operation_id,native_id:submission?.native_id??null,stage,compensation_guaranteed:false,compensation_paid: stage==='paid',paid_minor:stage==='paid'?result?.recovered_minor??'0':'0',currency:body.source_proof.currency,qualification:CLAIMS_QUALIFICATION,external_qualified:false};
  }
}
