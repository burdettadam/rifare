import { exact,id } from './kernel.mts';
import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { contentDigest,jsonValue } from './configuration-values.mts';
import { assertExecution } from './execution-stops.mts';
import { ClaimsFixtureSource } from '../adapters/claims-fixture-source.mts';
import { PartnerReadiness } from './partner-readiness.mts';
import { DisputeEvidence } from './dispute-evidence.mts';
import { claimsApprove,ClaimSubmissions,CLAIM_ACTIONS,CLAIMS_QUALIFICATION } from './claims-core.mts';

export class DisputeSubmissions {
  readonly k:CommerceKernel;readonly source:ClaimsFixtureSource;readonly readiness:PartnerReadiness;readonly packets:DisputeEvidence;readonly submissions:ClaimSubmissions;
  constructor(k:CommerceKernel,source:ClaimsFixtureSource,readiness:PartnerReadiness,packets=new DisputeEvidence(k,source)){this.k=k;this.source=source;this.readiness=readiness;this.packets=packets;
    if(packets.k!==k||packets.source!==source)throw new Error('CANONICAL_EVIDENCE_REQUIRED');
    this.submissions=new ClaimSubmissions(k,source,readiness,{kind:'dispute',approvalKind:'dispute',action:CLAIM_ACTIONS.dispute,service:'dispute_submission',get:(scope,ref)=>packets.row(scope,ref),current:(scope,row)=>this.current(scope,row),linked:(_scope,row,_operation,state)=>{k.db.prepare('UPDATE commerce_dispute_packets SET state=? WHERE tenant_id=? AND store_id=? AND id=?').run(state,row.tenant_id,row.store_id,row.id);}});
  }
  current(scope:Scope,row:Row){const captured=this.packets.assertCurrent(scope,row),data=row.body.data;if(data.deadline_at<=this.k.clock())throw new Error('CLAIM_DEADLINE_ELAPSED');const context=this.source.context('dispute_submission','submit'),pin=this.readiness.assertReady(scope,context);
    return {source:captured.dispute,source_record_id:data.dispute_id,business_key:contentDigest(['dispute',this.source.identity,data.dispute_id]),deadline_at:data.deadline_at,maximum_minor:data.amount_minor,currency:data.currency,evidence_hash:data.evidence_hash,payload:{assertions:data.assertions,missing:data.missing,attachments:data.attachments,order_pin:data.order_pin},context,pin};
  }
  approve(scope:Scope,input:unknown){const p=exact(jsonValue(input),['packet_id','expected_digest','expires_at']);id(p.packet_id);return this.k.transaction(()=>{const row=this.packets.row(scope,p.packet_id);const s=this.k.authorize(scope,'action.approve',row.resource_id);if(this.submissions.find(scope,row.id))throw new Error('ORIGINAL_SUBMISSION_REQUIRED');const current=this.current(scope,row),controls=assertExecution(this.k,s,CLAIM_ACTIONS.dispute);
    return claimsApprove(this.k,scope,'dispute',row,p,{deadline_at:current.deadline_at,partner_pin:current.pin,control_stamp:controls.stamp,evidence_hash:current.evidence_hash,source_interface:this.source.configuration().body.interface_version});});
  }
  async submit(scope:Scope,input:unknown){const p=exact(jsonValue(input),['packet_id','operation_id']);await this.submissions.submit(scope,id(p.packet_id),id(p.operation_id));return this.read(scope,p.packet_id);}
  async reconcile(scope:Scope,packetId:string){await this.submissions.reconcile(scope,packetId);return this.read(scope,packetId);}
  read(scope:Scope,packetId:string){const row=this.packets.row(scope,packetId),submission=this.submissions.find(scope,row.id),result=submission?.body.result,stage=submission?.state??row.state;
    return {packet_id:row.id,packet_digest:row.digest,evidence_hash:row.body.data.evidence_hash,operation_id:submission?.id??null,native_id:submission?.native_id??null,stage,won: ['decided','recovered'].includes(stage)&&result?.decision==='won',decision:result?.decision??null,recovered_minor:stage==='recovered'?result.recovered_minor:'0',currency:row.body.data.currency,payout_ref:result?.payout_ref??null,qualification:CLAIMS_QUALIFICATION,external_qualified:false};
  }
}
