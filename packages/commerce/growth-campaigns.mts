import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { exact,id,integer } from './kernel.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { checkedDocument,supportCase } from './support-core.mts';
import { permissionDecision } from './authorization.mts';
import { assertRecoveryEgress } from './data-guards.mts';
import { assertExecution } from './execution-stops.mts';
import { growthBody,growthApproval,growthMinor } from './growth-marketing-core.mts';
import { CheckoutExperiments } from './checkout-experiments.mts';
import { MarketingSegments } from './marketing-segments.mts';

export interface CampaignRecoveryReader {readonly k:CommerceKernel;final(scope:Scope,campaignId:string,caseId:string):Row;}
/** Reviewable structured templates; only SupportDelivery owns actual message execution. */
export class GrowthCampaigns {
  readonly k:CommerceKernel;readonly segments:MarketingSegments;readonly experiments:CheckoutExperiments;
  private recovery:CampaignRecoveryReader|null=null;
  constructor(k:CommerceKernel,segments:MarketingSegments,experiments:CheckoutExperiments){if(segments.k!==k||experiments.k!==k)throw new Error('GROWTH_SOURCE_BOUNDARY');this.k=k;this.segments=segments;this.experiments=experiments;}
  attachRecovery(reader:CampaignRecoveryReader){if(reader.k!==this.k||this.recovery&&this.recovery!==reader)throw new Error('RECOVERY_READER_BOUNDARY');this.recovery=reader;}
  #row(s:Row,campaignId:string){return this.k.db.prepare('SELECT * FROM commerce_growth_campaigns WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,id(campaignId)) as Row;}
  read(scope:Scope,campaignId:string){const s=this.k.authorize(scope,'support.analytics'),row=this.#row(s,campaignId),body=growthBody(row);return {id:row.id,revision:row.revision,state:row.state,digest:row.digest,body,preview:body.preview,execution_authorized:false,connected_qualified:false};}
  draft(scope:Scope,input:unknown){
    const p=exact(jsonValue(input),['campaign_id','expected_revision','segment_id','headline_key','body_key','offer_id','sender_id','starts_at','ends_at','budget_minor','unit_cost_minor','experiment_id','recovery_after_ms']);
    [p.campaign_id,p.segment_id,p.headline_key,p.body_key,p.sender_id].forEach(id);if(p.offer_id!==null)id(p.offer_id);if(p.experiment_id!==null)id(p.experiment_id);
    integer(p.expected_revision);integer(p.starts_at);integer(p.ends_at);const budget=growthMinor(p.budget_minor),unit=growthMinor(p.unit_cost_minor);
    if(p.ends_at<=p.starts_at||p.ends_at<=this.k.clock()||p.ends_at-p.starts_at>86400000||budget<=0n||unit<=0n||unit>budget)throw new Error('CAMPAIGN_SCHEDULE_OR_BUDGET_INVALID');
    if(p.recovery_after_ms!==null){integer(p.recovery_after_ms,1);if(p.recovery_after_ms>30*86400000)throw new Error('RECOVERY_WINDOW_INVALID');}
    return this.k.transaction(()=>{
      const k=this.k,s=k.authorize(scope,'action.propose'),old=this.#row(s,p.campaign_id);
      if((old?.revision??0)!==p.expected_revision)throw new Error('CAMPAIGN_REVISION_CHANGED');
      if(k.db.prepare('SELECT 1 FROM commerce_growth_campaign_recipients WHERE tenant_id=? AND store_id=? AND campaign_id=? AND operation_id IS NOT NULL').get(s.tenant_id,s.store_id,p.campaign_id))throw new Error('CAMPAIGN_ALREADY_QUEUED');
      const segment=this.segments.read(scope,p.segment_id),preview=segment.preview,source=this.segments.sourceFor(s),copy=source.copy(p.headline_key,p.body_key,p.offer_id),sender=checkedDocument(k,s,'sender',p.sender_id);
      if(!preview.complete)throw new Error('SEGMENT_INCOMPLETE');
      if(sender.body.channel!=='email'||sender.body.account_id!==source.account||sender.expires_at<p.ends_at||copy.expires_at<p.ends_at)throw new Error('CAMPAIGN_SENDER_OR_TERMS_UNQUALIFIED');
      const exp=p.experiment_id?this.experiments.inspect(scope,p.experiment_id):null;
      if(exp&&(p.starts_at<exp.starts_at||p.ends_at>exp.ends_at))throw new Error('CAMPAIGN_EXPERIMENT_WINDOW');
      const body={id:p.campaign_id,revision:p.expected_revision+1,segment_id:p.segment_id,segment_digest:segment.digest,definition:segment.body.definition,audience_digest:preview.audience_digest,audience_count:preview.audience_count,
        headline_key:p.headline_key,body_key:p.body_key,offer_id:p.offer_id,source_identity:source.identity,source_facts_digest:copy.source_digest,sender_id:p.sender_id,sender_revision:sender.version,sender_digest:sender.digest,
        starts_at:p.starts_at,ends_at:p.ends_at,budget_minor:p.budget_minor,unit_cost_minor:p.unit_cost_minor,currency:'USD',experiment_id:p.experiment_id,experiment_digest:exp?.digest??null,recovery_after_ms:p.recovery_after_ms,
        preview:{subject:copy.subject,text:copy.text,brand:copy.brand,offer:copy.offer,audience_count:preview.audience_count,channel:'email',purpose:'marketing',discount_applied:false},created_at:k.clock()};
      const record={state: 'draft'};
      k.db.prepare('INSERT INTO commerce_growth_campaigns VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,store_id,id) DO UPDATE SET revision=excluded.revision,author_id=excluded.author_id,state=excluded.state,body=excluded.body,digest=excluded.digest').run(s.tenant_id,s.store_id,p.campaign_id,body.revision,s.actor_id,record.state,canonical(body),contentDigest(body));
      k.db.prepare('UPDATE commerce_growth_campaign_approvals SET revoked=1 WHERE tenant_id=? AND store_id=? AND campaign_id=?').run(s.tenant_id,s.store_id,p.campaign_id);
      k.db.prepare('DELETE FROM commerce_growth_campaign_recipients WHERE tenant_id=? AND store_id=? AND campaign_id=? AND operation_id IS NULL').run(s.tenant_id,s.store_id,p.campaign_id);
      for(const member of preview.members){const {c}=supportCase(k,scope,member.case_id);k.authorize(scope,'action.propose',c.resource_id);
        if(c.resource_id!==member.resource_id||c.customer_id!==member.customer_id)throw new Error('CAMPAIGN_RECIPIENT_SCOPE');
        const recipient={campaign_id:p.campaign_id,campaign_revision:body.revision,campaign_digest:contentDigest(body),case_id:c.id,resource_id:c.resource_id,customer_id:c.customer_id,unit_cost_minor:p.unit_cost_minor,original_operation_id:null};
        k.db.prepare('INSERT INTO commerce_growth_campaign_recipients VALUES(?,?,?,?,?,?,NULL,?,?)').run(s.tenant_id,s.store_id,p.campaign_id,c.resource_id,c.customer_id,c.id,canonical(recipient),contentDigest(recipient));
      }
      return this.read(scope,p.campaign_id);
    });
  }
  #current(scope:Scope,s:Row,row:Row,body:Row){
    const source=this.segments.sourceFor(s),copy=source.copy(body.headline_key,body.body_key,body.offer_id),segment=this.segments.approved(scope,body.segment_id),sender=checkedDocument(this.k,s,'sender',body.sender_id);
    if(source.identity!==body.source_identity||copy.source_digest!==body.source_facts_digest||segment.row.digest!==body.segment_digest||segment.body.audience_digest!==body.audience_digest||sender.version!==body.sender_revision||sender.digest!==body.sender_digest||sender.body.account_id!==source.account)throw new Error('CAMPAIGN_FACTS_CHANGED');
    if(contentDigest({subject:copy.subject,text:copy.text,brand:copy.brand,offer:copy.offer,audience_count:body.audience_count,channel:'email',purpose:'marketing',discount_applied:false})!==contentDigest(body.preview))throw new Error('CAMPAIGN_CONTENT_INTEGRITY');
    if(body.ends_at<=this.k.clock())throw new Error('CAMPAIGN_EXPIRED');
    if(body.experiment_id&&this.experiments.inspect(scope,body.experiment_id).digest!==body.experiment_digest)throw new Error('CAMPAIGN_EXPERIMENT_CHANGED');
    return {copy,segment,sender};
  }
  #approval(s:Row,row:Row,resource:string|null=null){
    const approvalRow=this.k.db.prepare('SELECT * FROM commerce_growth_campaign_approvals WHERE tenant_id=? AND store_id=? AND campaign_id=? AND revoked=0 ORDER BY id DESC LIMIT 1').get(s.tenant_id,s.store_id,row.id) as Row;
    if(!approvalRow)throw new Error('CAMPAIGN_APPROVAL_REQUIRED');const approval=growthBody(approvalRow);
    if(approval.campaign_digest!==row.digest||approval.campaign_revision!==row.revision)throw new Error('CAMPAIGN_APPROVAL_CHANGED');
    growthApproval(this.k,s,approval,resource);return {row:approvalRow,body:approval};
  }
  approve(scope:Scope,input:unknown){
    const p=exact(jsonValue(input),['campaign_id','expected_digest','expires_at']);integer(p.expires_at);
    return this.k.transaction(()=>{
      const k=this.k,s=k.authorize(scope,'action.approve'),row=this.#row(s,p.campaign_id),body=growthBody(row);
      if(row.author_id===s.actor_id||row.digest!==p.expected_digest||row.state!=='draft')throw new Error('CAMPAIGN_APPROVAL_CHANGED');
      if(p.expires_at<=k.clock()||p.expires_at>body.ends_at)throw new Error('APPROVAL_EXPIRY_INVALID');
      // Reviewers have read/approval permissions, not analytics or send authority.
      const source=this.segments.sourceFor(s),copy=source.copy(body.headline_key,body.body_key,body.offer_id),segment=this.segments.approved(scope,body.segment_id),sender=checkedDocument(k,s,'sender',body.sender_id);
      if(copy.source_digest!==body.source_facts_digest||segment.row.digest!==body.segment_digest||sender.digest!==body.sender_digest)throw new Error('CAMPAIGN_FACTS_CHANGED');
      const recipients=k.db.prepare('SELECT * FROM commerce_growth_campaign_recipients WHERE tenant_id=? AND store_id=? AND campaign_id=?').all(s.tenant_id,s.store_id,row.id) as Row[];
      for(const recipient of recipients){k.authorize(scope,'action.approve',recipient.resource_id);k.get(scope,recipient.resource_id);}
      const approval={campaign_id:row.id,campaign_revision:row.revision,campaign_digest:row.digest,approver:s.actor_id,authority_revision:permissionDecision(k.db,s,'action.approve').authority_revision,expires_at:p.expires_at,approved_at:k.clock()},ref='campaign_approval_'+contentDigest([row.id,row.digest,s.actor_id,p.expires_at]).slice(0,40);
      k.db.prepare('UPDATE commerce_growth_campaign_approvals SET revoked=1 WHERE tenant_id=? AND store_id=? AND campaign_id=?').run(s.tenant_id,s.store_id,row.id);
      k.db.prepare('INSERT INTO commerce_growth_campaign_approvals VALUES(?,?,?,?,?,?,0) ON CONFLICT(tenant_id,store_id,id) DO UPDATE SET revoked=0').run(s.tenant_id,s.store_id,row.id,ref,canonical(approval),contentDigest(approval));
      return {id:ref,campaign_id:row.id,digest:row.digest,approved:true,send_authorized:false};
    });
  }
  schedule(scope:Scope,campaignId:string){return this.k.transaction(()=>{
    const k=this.k,s=k.authorize(scope,'action.execute'),row=this.#row(s,campaignId),body=growthBody(row);assertRecoveryEgress(k);assertExecution(k,s,'customer.message');this.#current(scope,s,row,body);
    const recipients=k.db.prepare('SELECT * FROM commerce_growth_campaign_recipients WHERE tenant_id=? AND store_id=? AND campaign_id=?').all(s.tenant_id,s.store_id,row.id) as Row[];
    for(const recipient of recipients){k.authorize(scope,'action.execute',recipient.resource_id);this.#approval(s,row,recipient.resource_id);}
    if(!recipients.length)this.#approval(s,row);
    k.db.prepare("UPDATE commerce_growth_campaigns SET state='scheduled' WHERE tenant_id=? AND store_id=? AND id=?").run(s.tenant_id,s.store_id,row.id);return this.read(scope,campaignId);
  });}
  #approvedRecipient(scope:Scope,campaignId:string,caseId:string){
    const {s,c}=supportCase(this.k,scope,caseId),row=this.#row(s,campaignId),body=growthBody(row),approval=this.#approval(s,row,c.resource_id);
    if(row.state!=='scheduled')throw new Error('CAMPAIGN_NOT_SCHEDULED');
    const current=this.#current(scope,s,row,body);
    const recipient=this.k.db.prepare('SELECT * FROM commerce_growth_campaign_recipients WHERE tenant_id=? AND store_id=? AND campaign_id=? AND resource_id=?').get(s.tenant_id,s.store_id,row.id,c.resource_id) as Row,value=growthBody(recipient);
    if(value.campaign_digest!==row.digest||value.case_id!==c.id||value.customer_id!==c.customer_id)throw new Error('CAMPAIGN_RECIPIENT_SCOPE');
    return {s,c,row,body,approval,current};
  }
  approvedOffer(scope:Scope,campaignId:string,caseId:string){
    const {c,row,body,approval,current}=this.#approvedRecipient(scope,campaignId,caseId);
    return {campaign_id:row.id,campaign_digest:row.digest,case_id:c.id,resource_id:c.resource_id,sender_id:body.sender_id,offer_id:body.offer_id,offer:current.copy.offer,source_identity:current.copy.source_identity,source_facts_digest:current.copy.source_digest,starts_at:body.starts_at,ends_at:body.ends_at,approval_expires_at:approval.body.expires_at,offer_expires_at:current.copy.expires_at,recovery_after_ms:body.recovery_after_ms};
  }
  render(scope:Scope,campaignId:string,caseId:string,phase:'queue'|'send'){
    const {c,row,body,approval}=this.#approvedRecipient(scope,campaignId,caseId);
    if(phase==='send'&&this.k.clock()<body.starts_at)throw new Error('CAMPAIGN_NOT_DUE');
    if(body.experiment_id){const exp=this.experiments.inspect(scope,body.experiment_id),assignment=this.experiments.assign(scope,{experiment_id:body.experiment_id,case_id:c.id,frontend_variants:['holdout','treatment']});
      if(assignment.arm==='holdout')throw new Error('CAMPAIGN_HOLDOUT_EXCLUDED');
      if(assignment.state!=='assigned'||this.k.clock()>exp.ends_at||c.order.payload.marketing_eligibility?.bot!==false||c.order.payload.marketing_eligibility?.eligible!==true)throw new Error('CAMPAIGN_EXPERIMENT_EXCLUDED');
    }
    let recovery:Row|null=null;
    if(body.recovery_after_ms!==null){if(!this.recovery)throw new Error('RECOVERY_SOURCE_UNAVAILABLE');recovery=this.recovery.final(scope,campaignId,caseId);}
    const basis={campaign_digest:row.digest,approval_digest:approval.row.digest,source_facts_digest:body.source_facts_digest,segment_digest:body.segment_digest,recovery_digest:recovery?.digest??null};
    return {status:'available',campaign_id:row.id,campaign_revision:row.revision,campaign_approval_id:approval.row.id,sender_id:body.sender_id,subject:body.preview.subject,text:body.preview.text,source_digest:contentDigest(basis),starts_at:body.starts_at,ends_at:body.ends_at,unit_cost_minor:body.unit_cost_minor,purpose:'marketing',execution_authorized:false};
  }
  reserve(scope:Scope,campaignId:string,caseId:string,operationId:string){
    const {s,c}=supportCase(this.k,scope,caseId),row=this.#row(s,campaignId),body=growthBody(row),recipient=this.k.db.prepare('SELECT * FROM commerce_growth_campaign_recipients WHERE tenant_id=? AND store_id=? AND campaign_id=? AND resource_id=?').get(s.tenant_id,s.store_id,row.id,c.resource_id) as Row,value=growthBody(recipient);
    if(recipient.operation_id){if(recipient.operation_id!==operationId)throw new Error('CAMPAIGN_OPERATION_IDENTITY');return;}
    const reserved=this.k.db.prepare('SELECT * FROM commerce_growth_campaign_recipients WHERE tenant_id=? AND store_id=? AND campaign_id=? AND operation_id IS NOT NULL').all(s.tenant_id,s.store_id,row.id) as Row[];
    // Conservative holds survive unknown, suppression, and erasure; no timeout can
    // manufacture fresh budget for another logical send.
    const spent=reserved.reduce((sum,r)=>sum+growthMinor(JSON.parse(r.body).unit_cost_minor),0n);
    if(spent+growthMinor(body.unit_cost_minor)>growthMinor(body.budget_minor))throw new Error('CAMPAIGN_BUDGET_EXCEEDED');
    const updated={...value,original_operation_id:operationId};
    this.k.db.prepare('UPDATE commerce_growth_campaign_recipients SET operation_id=?,body=?,digest=? WHERE tenant_id=? AND store_id=? AND campaign_id=? AND resource_id=?').run(id(operationId),canonical(updated),contentDigest(updated),s.tenant_id,s.store_id,row.id,c.resource_id);
  }
  summary(scope:Scope,campaignId:string){
    const s=this.k.authorize(scope,'support.analytics'),campaign=this.read(scope,campaignId),rows=this.k.db.prepare('SELECT * FROM commerce_growth_campaign_recipients WHERE tenant_id=? AND store_id=? AND campaign_id=?').all(s.tenant_id,s.store_id,campaign.id) as Row[];
    let queued=0,unknown=0,suppressed=0,accepted=0,delivered=0,reserved=0n,estimated=0n,unavailable=0;
    for(const row of rows){if(!row.operation_id)continue;const b=JSON.parse(row.body);if(contentDigest(b)!==row.digest)throw new Error('GROWTH_RECORD_INTEGRITY');reserved+=growthMinor(b.unit_cost_minor);
      try{this.k.get(scope,row.resource_id);}catch{unavailable++;continue;}
      const op=this.k.db.prepare('SELECT * FROM commerce_operations WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,row.operation_id) as Row,delivery=this.k.db.prepare('SELECT * FROM commerce_support_deliveries WHERE tenant_id=? AND store_id=? AND operation_id=?').get(s.tenant_id,s.store_id,row.operation_id) as Row;
      if(!op||!delivery)throw new Error('CAMPAIGN_OPERATION_MISSING');
      if(op.state==='unknown')unknown++;else if(['queued','retry_wait'].includes(op.state))queued++;
      const work=this.k.db.prepare('SELECT last_code FROM commerce_operation_work WHERE tenant_id=? AND store_id=? AND operation_id=?').get(s.tenant_id,s.store_id,row.operation_id) as Row;
      if(op.state==='failed'&&work.last_code==='FINAL_AUTHORIZATION_DENIED')suppressed++;
      if(delivery.observation){const observed=JSON.parse(delivery.observation);if(contentDigest(observed)!==delivery.observation_digest||observed.operation_id!==row.operation_id||observed.payload_hash!==delivery.digest)throw new Error('CAMPAIGN_OBSERVATION_INTEGRITY');accepted++;estimated+=growthMinor(b.unit_cost_minor);if(observed.stage==='delivered'&&observed.customer_delivered===true)delivered++;}
    }
    return {campaign_id:campaign.id,audience_count:rows.length,queued,unknown,suppressed,provider_accepted:accepted,delivered,unavailable,budget_reserved_minor:reserved.toString(),estimated_accepted_cost_minor:estimated.toString(),actual_provider_cost_minor:null,cost_basis:'approved_synthetic_unit_estimate',connected_qualified:false,completed:false};
  }
}
