import { exact,id,integer } from './kernel.mts';
import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { money } from './money.mts';
import { ClaimsFixtureSource } from '../adapters/claims-fixture-source.mts';
import { claimsRow,claimsSourceScope,claimsCase,claimsAttachments,claimsResourcePin,CLAIMS_QUALIFICATION } from './claims-core.mts';

export class DisputeEvidence {
  readonly k:CommerceKernel;readonly source:ClaimsFixtureSource;
  constructor(k:CommerceKernel,source:ClaimsFixtureSource){this.k=k;this.source=source;}
  row(scope:Scope,ref:string){return claimsRow(this.k,scope,'commerce_dispute_packets',ref);}
  #capture(scope:Scope,caseId:string,disputeId:string,evidenceIds:string[]){const {c,s,hash}=claimsCase(this.k,scope,caseId,'resource.read');claimsSourceScope(this.k,s,this.source);this.source.assertInterface();const dispute=this.source.dispute(disputeId);
    if(dispute.resource_id!==c.resource_id||dispute.customer_id!==c.customer_id)throw new Error('CLAIM_SOURCE_SCOPE');
    const original=c.order.payload.resolution_facts;if(!original||original.currency!==c.order.payload.currency)throw new Error('DISPUTE_PAYMENT_SOURCE_MISSING');money(original.currency,original.original_paid_minor);
    const order_pin=claimsResourcePin(c.order),source_ref=this.source.identity+':dispute:'+dispute.dispute_id,source_digest=contentDigest(dispute),assertions:Row[]=[
      {key:'order_number',value:c.order.external_id,source_ref:c.order.id,source_version:c.order.source_version,source_digest:order_pin.digest},
      {key:'original_paid_minor',value:original.original_paid_minor,source_ref:c.order.id,source_version:c.order.source_version,source_digest:order_pin.digest},
      {key:'currency',value:original.currency,source_ref:c.order.id,source_version:c.order.source_version,source_digest:order_pin.digest},
      {key:'disputed_minor',value:dispute.amount_minor,source_ref,source_version:dispute.version,source_digest},
      {key:'dispute_reason',value:dispute.reason,source_ref,source_version:dispute.version,source_digest}
    ];
    if(Number.isSafeInteger(c.order.payload.delivered_at))assertions.push({key:'recorded_delivery_at',value:c.order.payload.delivered_at,source_ref:c.order.id,source_version:c.order.source_version,source_digest:order_pin.digest});
    const missing:string[]=[];
    if (dispute.acknowledgement === null) missing.push('customer_acknowledgement');
    else assertions.push({key:'customer_acknowledgement',value:dispute.acknowledgement.value,source_ref:this.source.identity+':'+dispute.acknowledgement.record_id,source_version:dispute.acknowledgement.version,source_digest:contentDigest(dispute.acknowledgement)});
    for(const key of ['purchase_consent','communication']){const record=dispute[key];if(record===null)missing.push(key);else assertions.push({key,value:record.value,source_ref:this.source.identity+':'+record.record_id,source_version:record.version,source_digest:contentDigest(record)});}
    const attachments=claimsAttachments(this.k,s,c.id,evidenceIds),evidence_hash=contentDigest({assertions,missing,attachments});
    // Retrieved notes never enter the factual projection or grant approval.
    const data={case_id:c.id,case_configuration_digest:c.configuration_digest,dispute_id:dispute.dispute_id,source_identity:this.source.identity,source_config_digest:this.source.configuration().digest,account_id:this.source.account_id,region:this.source.region,dispute_version:dispute.version,source_digest,order_pin,deadline_at:dispute.deadline_at,amount_minor:dispute.amount_minor,currency:dispute.currency,assertions,missing,attachments,evidence_hash,untrusted_note_included:false};
    return {c,s,hash,dispute,data};
  }
  draft(scope:Scope,input:unknown){const p=exact(jsonValue(input),['packet_id','expected_revision','case_id','dispute_id','evidence_ids']);id(p.packet_id);id(p.case_id);id(p.dispute_id);integer(p.expected_revision);
    return this.k.transaction(()=>{const captured=this.#capture(scope,p.case_id,p.dispute_id,p.evidence_ids),{c,s,hash}=captured;this.k.authorize(scope,'action.propose',c.resource_id);
      const business_key=contentDigest(['dispute',this.source.identity,p.dispute_id]);if(this.k.db.prepare("SELECT 1 FROM commerce_claim_submissions WHERE tenant_id=? AND store_id=? AND kind='dispute' AND business_key=?").get(s.tenant_id,s.store_id,business_key))throw new Error('ORIGINAL_SUBMISSION_REQUIRED');
      const old=this.k.db.prepare('SELECT * FROM commerce_dispute_packets WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,p.packet_id) as Row|undefined;
      if((old?.revision??0)!==p.expected_revision||old&&(old.resource_id!==c.resource_id||old.customer_id!==c.customer_id))throw new Error('DISPUTE_PACKET_CHANGED');
      const revision=p.expected_revision+1,body={data:captured.data,proposed_by:s.actor_id,created_at:this.k.clock()};
      this.k.db.prepare("INSERT INTO commerce_dispute_packets VALUES(?,?,?,?,?,?,?, ?,?,?) ON CONFLICT(tenant_id,store_id,id) DO UPDATE SET state='draft',revision=excluded.revision,body=excluded.body,digest=excluded.digest").run(s.tenant_id,s.store_id,p.packet_id,c.resource_id,c.customer_id,hash,'draft',revision,canonical(body),contentDigest(body));return this.read(scope,p.packet_id);
    });
  }
  assertCurrent(scope:Scope,row:Row){const body=row.body,captured=this.#capture(scope,body.data.case_id,body.data.dispute_id,body.data.attachments.map((entry:Row)=>entry.id));
    if(contentDigest(captured.data)!==contentDigest(body.data))throw new Error('EVIDENCE_SOURCE_CHANGED');return captured;
  }
  read(scope:Scope,ref:string){const row=this.row(scope,ref),data=row.body.data;return {id:row.id,resource_id:row.resource_id,digest:row.digest,revision:row.revision,state:row.state,dispute_id:data.dispute_id,deadline_at:data.deadline_at,assertions:data.assertions,missing:data.missing,attachments:data.attachments,evidence_hash:data.evidence_hash,source_identity:data.source_identity,source_version:data.dispute_version,redacted:true,untrusted_note_included:false,qualification:CLAIMS_QUALIFICATION,external_qualified:false};}
}
