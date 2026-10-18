import { exact,id,integer } from './kernel.mts';
import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { ActionGateway } from './action-gateway.mts';
import { permissionDecision } from './authorization.mts';
import { ResolutionExecution } from './resolution-execution.mts';
import { FulfillmentExecution } from './fulfillment-execution.mts';
import { resolutionQuoteRow,currentResolutionQuote } from './refund-quotes.mts';
import { resolutionSettings,RESOLVE_ACTION } from './resolution-ledger.mts';
import { fulfillmentQuoteRow,assertFulfillmentQuote,fulfillmentSettings,FULFILLMENT_ACTIONS } from './return-fulfillment-core.mts';
import { ResolutionFixtureSource } from '../adapters/resolution-fixture-source.mts';
import { assertExecution } from './execution-stops.mts';
import { assertRecoveryEgress } from './data-guards.mts';
import { ClaimsFixtureSource } from '../adapters/claims-fixture-source.mts';
import { bindWarrantySourceGuard } from '../adapters/claims-source-guards.mts';
import { PartnerReadiness } from './partner-readiness.mts';
import { WarrantyRegistration } from './warranty-registration.mts';
import { claimsRow,claimsBody,claimsSourceScope,claimsCase,claimsCustomer,claimsCurrentCustomer,claimsAttachments,claimsApprove,claimsApproval,claimsObservation,ClaimSubmissions,CLAIM_ACTIONS,CLAIMS_QUALIFICATION } from './claims-core.mts';

/** Warranty decisions reserve one registered purchased unit. Refund and replacement
 * execution remain the existing allocation, approval, source and receipt owners. */
export class WarrantyClaims {
  readonly k:CommerceKernel;readonly source:ClaimsFixtureSource;readonly readiness:PartnerReadiness;readonly registrations:WarrantyRegistration;readonly resolution:ResolutionExecution;readonly fulfillment:FulfillmentExecution;readonly repairs:ClaimSubmissions;
  constructor(k:CommerceKernel,source:ClaimsFixtureSource,readiness:PartnerReadiness,gateways:{resolution:ResolutionExecution;fulfillment:FulfillmentExecution}){
    if(!(gateways.resolution instanceof ResolutionExecution)||!(gateways.resolution.source instanceof ResolutionFixtureSource)||!(gateways.fulfillment instanceof FulfillmentExecution)||gateways.resolution.kernel!==k||gateways.fulfillment.kernel!==k)throw new Error('CANONICAL_GATEWAYS_REQUIRED');
    this.k=k;this.source=source;this.readiness=readiness;this.registrations=new WarrantyRegistration(k,source);this.resolution=gateways.resolution;this.fulfillment=gateways.fulfillment;
    this.repairs=new ClaimSubmissions(k,source,readiness,{kind:'repair',approvalKind:'warranty',action:CLAIM_ACTIONS.warranty,service:'warranty',get:(scope,ref)=>this.row(scope,ref),current:(scope,row)=>this.#repairCurrent(scope,row),linked:(_scope,row,_operation,state)=>this.#state(row,state)});
  }
  row(scope:Scope,ref:string){return claimsRow(this.k,scope,'commerce_warranty_claims',ref);}
  #native(scope:Scope,registration:Row,outcome:string,operationId:string){
    const s=this.k.require(scope),table=outcome==='refund'?'commerce_resolution_operations':'commerce_fulfillment_operations',op=this.k.db.prepare('SELECT * FROM '+table+' WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,id(operationId)) as Row|undefined;
    if(!op||op.resource_id!==registration.resource_id||op.kind!==(outcome==='refund'?'refund':'replacement'))throw new Error('WARRANTY_ORIGINAL_OPERATION_REQUIRED');
    const command=JSON.parse(op.command);if(contentDigest(command)!==op.digest||command.operation_id!==op.id||command.resource_id!==registration.resource_id||command.customer_id!==registration.customer_id||command.source_identity!==(outcome==='refund'?this.resolution.source.identity:this.fulfillment.source.identity))throw new Error('WARRANTY_OPERATION_CHANGED');
    const allocation=this.k.db.prepare('SELECT * FROM commerce_resolution_allocations WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,command.allocation_id) as Row|undefined,body=claimsBody(allocation);
    if(!allocation||allocation.resource_id!==registration.resource_id||allocation.line_id!==registration.body.line_id||body.units.length!==1||body.units[0]!==registration.body.unit_index||allocation.outcome!==(outcome==='refund'?'refund':'exchange'))throw new Error('WARRANTY_ENTITLEMENT_MISMATCH');
    if(outcome==='refund'&&(command.payment_id!==registration.body.proof.payment_id||command.currency!==registration.body.proof.currency||BigInt(command.amount_minor)>BigInt(registration.body.proof.paid_minor)))throw new Error('WARRANTY_AMOUNT_EXCEEDED');
    if(outcome==='replacement'&&command.quantity!==1)throw new Error('WARRANTY_ENTITLEMENT_MISMATCH');
    return {op,command,source:outcome==='refund'?this.resolution.source:this.fulfillment.source};
  }
  #gatewayReady(scope:Scope,native:Row,outcome:string){const k=this.k,s=k.require(scope),op=native.op,receipt=new ActionGateway(k).receipt(scope,op.receipt_id);
    if((outcome==='refund'?receipt.resolution_operation_id:receipt.fulfillment_operation_id)!==op.id||receipt.effect!==(outcome==='refund'?'synthetic_resolution_authorized':'synthetic_fulfillment_authorized'))throw new Error('WARRANTY_ORIGINAL_APPROVAL_REQUIRED');
    const approval=k.db.prepare('SELECT * FROM commerce_action_approvals WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,receipt.approval_id) as Row|undefined;
    const member=approval&&k.db.prepare('SELECT * FROM commerce_members WHERE tenant_id=? AND store_id=? AND actor_id=? AND active=1').get(s.tenant_id,s.store_id,approval.approver) as Row|undefined,authority=member&&permissionDecision(k.db,member,'action.approve',op.resource_id);
    if(!approval||approval.revoked||approval.uses!==1||approval.expires_at<=k.clock()||!authority?.allowed||authority.authority_revision!==approval.authority_revision)throw new Error('APPROVAL_AUTHORITY_CHANGED');
    if(outcome==='refund'){const q=resolutionQuoteRow(k,scope,op.quote_id);if(q.quote.expires_at<=k.clock())throw new Error('REFUND_QUOTE_EXPIRED');const current=currentResolutionQuote(k,scope,q.quote,op.id);
      if(contentDigest({...current,remaining_before_minor:q.quote.remaining_before_minor})!==q.digest)throw new Error('REFUND_QUOTE_CHANGED');assertExecution(k,s,RESOLVE_ACTION,q.quote.control_stamp);if(resolutionSettings(k,s).source_identity!==native.source.identity)throw new Error('RESOLUTION_SOURCE_MISMATCH');
    }else{const q=fulfillmentQuoteRow(k,scope,op.quote_id);assertFulfillmentQuote(k,scope,q);assertExecution(k,s,FULFILLMENT_ACTIONS.replacement,q.quote.control_stamp);if(fulfillmentSettings(k,s).source_identity!==native.source.identity)throw new Error('FIXTURE_SOURCE_MISMATCH');}
  }
  #bind(scope:Scope,row:Row,callback:()=>void){if(row.body.outcome==='repair')return;const registration=this.registrations.current(scope,row.body.registration_id),native=this.#native(scope,registration,row.body.outcome,row.operation_id);
    if(native.op.digest!==row.body.operation_digest)throw new Error('WARRANTY_OPERATION_CHANGED');bindWarrantySourceGuard(native.source.db,native.command,{claim_id:row.id,registration_id:registration.id,claim_digest:row.digest},callback);
  }
  draft(scope:Scope,customerScope:Scope,input:unknown){const p=exact(jsonValue(input),['claim_id','registration_id','case_id','outcome','operation_id','evidence_ids']);id(p.claim_id);id(p.registration_id);id(p.case_id);if(!['repair','replacement','refund'].includes(p.outcome)||p.outcome==='repair'&&p.operation_id!==null)throw new Error('WARRANTY_OUTCOME_UNSUPPORTED');
    return this.k.transaction(()=>{const {c,s,hash}=claimsCase(this.k,scope,p.case_id),registration=this.registrations.current(scope,p.registration_id);claimsSourceScope(this.k,s,this.source);
      if(registration.resource_id!==c.resource_id||registration.customer_id!==c.customer_id||!registration.body.terms.allowed_outcomes.includes(p.outcome))throw new Error('WARRANTY_OUTCOME_UNSUPPORTED');
      const customer=claimsCustomer(this.k,customerScope,c.resource_id,c.customer_id);if(customer.tenant_id!==s.tenant_id||customer.store_id!==s.store_id)throw new Error('CLAIM_SOURCE_SCOPE');
      if(this.k.db.prepare('SELECT 1 FROM commerce_warranty_claims WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,p.claim_id))throw new Error('CLAIM_ALREADY_EXISTS');
      const entitlementId = registration.id;
      if(this.k.db.prepare('SELECT 1 FROM commerce_warranty_entitlements WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,entitlementId))throw new Error('WARRANTY_ENTITLEMENT_RESERVED');
      const evidence=claimsAttachments(this.k,s,c.id,p.evidence_ids),context=this.source.context('warranty',p.outcome),partner_pin=this.readiness.assertReady(scope,context),controls=assertExecution(this.k,s,CLAIM_ACTIONS.warranty);
      const configured=this.source.configuration().body.options;if(configured.resolution_source_identity!==this.resolution.source.identity||configured.fulfillment_source_identity!==this.fulfillment.source.identity)throw new Error('WARRANTY_GATEWAY_CHANGED');
      const native=p.outcome==='repair'?null:this.#native(scope,registration,p.outcome,id(p.operation_id));if(native&&native.op.state!=='authorized')throw new Error('WARRANTY_ORIGINAL_OPERATION_REQUIRED');
      const operation_id=native?.op.id??'repair_'+contentDigest([s.tenant_id,s.store_id,p.claim_id]).slice(0,38),body={registration_id:registration.id,entitlement_id:entitlementId,registration_digest:registration.digest,case_id:c.id,outcome:p.outcome,operation_id,operation_digest:native?.op.digest??null,operation_source_identity:native?.source.identity??this.source.identity,original_receipt_id:native?.op.receipt_id??null,evidence,evidence_hash:contentDigest(evidence),claimant_session_hash:customer.token_hash,proposed_by:s.actor_id,partner_pin,context,control_stamp:controls.stamp,deadline_at:Math.min(registration.body.expires_at,this.k.clock()+60000),created_at:this.k.clock()};
      const entitlement={registration_id:registration.id,claim_id:p.claim_id,original_operation_id:operation_id,outcome:p.outcome,line_id:registration.body.line_id,unit_index:registration.body.unit_index,quantity:1};
      this.k.db.prepare('INSERT INTO commerce_warranty_entitlements VALUES(?,?,?,?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,entitlementId,c.resource_id,c.customer_id,hash,p.claim_id,'reserved',canonical(entitlement),contentDigest(entitlement));
      this.k.db.prepare('INSERT INTO commerce_warranty_claims VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,p.claim_id,c.resource_id,c.customer_id,hash,'proposed',null,operation_id,canonical(body),contentDigest(body));
      const row=this.row(scope,p.claim_id);this.#bind(scope,row,()=>{throw new Error('CLAIM_APPROVAL_REQUIRED');});return this.read(scope,p.claim_id);
    });
  }
  #current(scope:Scope,row:Row){const s=this.k.require(scope);claimsSourceScope(this.k,s,this.source);const registration=this.registrations.current(scope,row.body.registration_id);
    if(registration.digest!==row.body.registration_digest||registration.resource_id!==row.resource_id||registration.customer_id!==row.customer_id||row.body.deadline_at<=this.k.clock())throw new Error('WARRANTY_CONTEXT_CHANGED');
    const ent=this.k.db.prepare('SELECT * FROM commerce_warranty_entitlements WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,row.body.entitlement_id) as Row|undefined;
    if(!ent||ent.claim_id!==row.id||claimsBody(ent).original_operation_id!==row.operation_id)throw new Error('WARRANTY_ENTITLEMENT_RESERVED');
    claimsCurrentCustomer(this.k,s,row.body.claimant_session_hash,row.resource_id,row.customer_id);
    const evidence=claimsAttachments(this.k,s,row.body.case_id,row.body.evidence.map((entry:Row)=>entry.id));if(contentDigest(evidence)!==row.body.evidence_hash)throw new Error('EVIDENCE_SOURCE_CHANGED');
    const context=this.source.context('warranty',row.body.outcome),pin=this.readiness.assertReady(scope,context,row.body.partner_pin);assertExecution(this.k,s,CLAIM_ACTIONS.warranty,row.body.control_stamp);
    if(row.body.outcome!=='repair'){const native=this.#native(scope,registration,row.body.outcome,row.operation_id);if(native.op.digest!==row.body.operation_digest||native.op.receipt_id!==row.body.original_receipt_id)throw new Error('WARRANTY_OPERATION_CHANGED');this.#gatewayReady(scope,native,row.body.outcome);}
    return {registration,context,pin,evidence};
  }
  #before(scope:Scope,ref:string){const row=this.row(scope,ref),s=this.k.authorize(scope,'operation.dispatch',row.resource_id);this.k.authorize(scope,'action.execute',row.resource_id);assertRecoveryEgress(this.k);const current=this.#current(scope,row),approval=claimsApproval(this.k,scope,'warranty',row);assertExecution(this.k,s,CLAIM_ACTIONS.warranty,approval.body.control_stamp);
    this.readiness.assertReady(scope,current.context,approval.body.partner_pin);if(approval.id!==row.approval_id)throw new Error('CLAIM_APPROVAL_CHANGED');return row;
  }
  approve(scope:Scope,input:unknown){const p=exact(jsonValue(input),['claim_id','expected_digest','expires_at']);id(p.claim_id);return this.k.transaction(()=>{const row=this.row(scope,p.claim_id);this.k.authorize(scope,'action.approve',row.resource_id);const current=this.#current(scope,row);
      if(row.state!=='proposed')throw new Error('CLAIM_ALREADY_REVIEWED');
      if(row.body.outcome!=='repair'){const native=this.#native(scope,current.registration,row.body.outcome,row.operation_id),receipt=new ActionGateway(this.k).receipt(scope,native.op.receipt_id);if((row.body.outcome==='refund'?receipt.resolution_operation_id:receipt.fulfillment_operation_id)!==row.operation_id)throw new Error('WARRANTY_ORIGINAL_APPROVAL_REQUIRED');}
      const a=claimsApprove(this.k,scope,'warranty',row,p,{deadline_at:row.body.deadline_at,partner_pin:current.pin,control_stamp:row.body.control_stamp,original_operation_id:row.operation_id,original_operation_digest:row.body.operation_digest});
      this.k.db.prepare("UPDATE commerce_warranty_claims SET state='approved',approval_id=? WHERE tenant_id=? AND store_id=? AND id=?").run(a.id,row.tenant_id,row.store_id,row.id);return a;
    });
  }
  #repairCurrent(scope:Scope,row:Row){const current=this.#current(scope,row),purchase=this.source.purchase(current.registration.body.purchase_id);return {source:purchase,source_record_id:purchase.purchase_id,business_key:contentDigest(['warranty_entitlement',row.body.entitlement_id]),deadline_at:row.body.deadline_at,maximum_minor:'0',currency:purchase.currency,evidence_hash:row.body.evidence_hash,payload:{registration_id:current.registration.id,product_id:purchase.product_id,line_id:purchase.line_id,unit_index:purchase.unit_index,terms_digest:current.registration.body.terms_digest,evidence:row.body.evidence},context:current.context,pin:current.pin};}
  #state(row:Row,state:string){this.k.db.prepare('UPDATE commerce_warranty_claims SET state=? WHERE tenant_id=? AND store_id=? AND id=?').run(state,row.tenant_id,row.store_id,row.id);if(!['proposed','approved','unknown'].includes(state))this.k.db.prepare("UPDATE commerce_warranty_entitlements SET state='consumed' WHERE tenant_id=? AND store_id=? AND claim_id=?").run(row.tenant_id,row.store_id,row.id);}
  async dispatch(scope:Scope,ref:string){const row=this.row(scope,ref);if(!['approved','proposed'].includes(row.state))return this.read(scope,ref);this.#before(scope,ref);
    if(row.body.outcome==='repair'){await this.repairs.submit(scope,row.id,row.operation_id);return this.read(scope,ref);}
    let active=true;this.#bind(scope,row,()=>{if(!active)throw new Error('CLAIM_GUARD_UNAVAILABLE');this.#before(scope,ref);active=false;});const executor=row.body.outcome==='refund'?this.resolution:this.fulfillment;
    // Unknown belongs to the original canonical operation before any transport.
    try{this.k.transaction(()=>{this.#before(scope,ref);this.#state(row,'unknown');});const result=await executor.dispatch(scope,row.operation_id);
      this.k.transaction(()=>{const current=this.row(scope,ref);this.#state(current,result.state);claimsObservation(this.k,this.k.require(scope),current,'warranty',row.operation_id,result);});return this.read(scope,ref);
    }finally{active=false;}
  }
  async reconcile(scope:Scope,ref:string){const row=this.row(scope,ref);this.k.authorize(scope,'operation.reconcile',row.resource_id);
    if(['proposed','approved'].includes(row.state))throw new Error('CLAIM_NOT_SUBMITTED');
    if(row.body.outcome==='repair'){await this.repairs.reconcile(scope,row.id);return this.read(scope,ref);}
    const context=row.body.context;claimsSourceScope(this.k,this.k.require(scope),this.source);if(context.source_identity!==this.source.identity||context.account_id!==this.source.account_id)throw new Error('CLAIM_SOURCE_SCOPE');
    this.readiness.assertReconcile(scope,context);const native=this.#native(scope,claimsRow(this.k,scope,'commerce_warranty_registrations',row.body.registration_id),row.body.outcome,row.operation_id);
    if(native.op.digest!==row.body.operation_digest)throw new Error('WARRANTY_OPERATION_CHANGED');const result=await (row.body.outcome==='refund'?this.resolution:this.fulfillment).reconcile(scope,row.operation_id);
    this.k.transaction(()=>{const current=this.row(scope,ref);this.#state(current,result.state);claimsObservation(this.k,this.k.require(scope),current,'warranty',row.operation_id,result);});return this.read(scope,ref);
  }
  read(scope:Scope,ref:string){const row=this.row(scope,ref),body=row.body;let native_id:string|null=null,stage=row.state,replacement_fulfillable=false;
    if(body.outcome==='repair'){const result=this.k.db.prepare('SELECT * FROM commerce_claim_submissions WHERE tenant_id=? AND store_id=? AND id=?').get(row.tenant_id,row.store_id,row.operation_id) as Row|undefined;if(result){claimsBody(result);stage=result.state;native_id=result.native_id;}}
    else {const table=body.outcome==='refund'?'commerce_resolution_operations':'commerce_fulfillment_operations',op=this.k.db.prepare('SELECT * FROM '+table+' WHERE tenant_id=? AND store_id=? AND id=?').get(row.tenant_id,row.store_id,row.operation_id) as Row|undefined;
      if(!op||op.digest!==body.operation_digest||contentDigest(JSON.parse(op.command))!==op.digest)throw new Error('WARRANTY_OPERATION_CHANGED');if(!['proposed','approved'].includes(row.state))stage=op.state;native_id=op.native_id;
      if(body.outcome==='replacement'&&op.state==='created'){const replacement=this.k.db.prepare('SELECT * FROM commerce_replacement_orders WHERE tenant_id=? AND store_id=? AND operation_id=?').get(row.tenant_id,row.store_id,row.operation_id) as Row|undefined;replacement_fulfillable=!!replacement&&claimsBody(replacement).fulfillable===true;}
    }
    return {id:row.id,resource_id:row.resource_id,registration_id:body.registration_id,digest:row.digest,outcome:body.outcome,operation_id:row.operation_id,original_receipt_id:body.original_receipt_id,native_id,stage,cash_settled:body.outcome==='refund'&&stage==='settled',replacement_fulfillable,repair_completed:body.outcome==='repair'&&stage==='completed',evidence:body.evidence,entitlement_quantity:1,qualification:CLAIMS_QUALIFICATION,external_qualified:false};
  }
}
