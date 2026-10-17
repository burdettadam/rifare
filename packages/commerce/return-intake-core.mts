import { exact,id,integer,token } from './kernel.mts';
import type { CommerceKernel,Scope,Row } from './kernel.mts';
import { canonical,contentDigest,jsonValue } from './configuration-values.mts';
import { CaseConfigurations } from './case-configurations.mts';
import { evaluateReturn,returnSelection,returnSettings,INTAKE_ACTION } from './return-eligibility.mts';
import { evidenceRows } from './return-evidence.mts';
import { permissionDecision } from './authorization.mts';
import { assertReady,DRAFT_ACTION } from './integration-readiness.mts';
import { assertExecution } from './execution-stops.mts';
import { money } from './money.mts';
import { assertGiftOutcome } from './gift-proof.mts';

export function intakeSettings(k:CommerceKernel,s:Row) {
 const row=k.db.prepare('SELECT * FROM commerce_return_settings WHERE tenant_id=? AND store_id=?').get(s.tenant_id,s.store_id) as Row;
 if(!row)throw new Error('RETURN_NOT_CONFIGURED');const body=returnSettings(JSON.parse(row.body));if(contentDigest(body)!==row.digest)throw new Error('RETURN_SETTINGS_INTEGRITY');return {...row,body};
}
export function reservations(k:CommerceKernel,s:Row,order:Row) {
 const counted=order.payload.counted_return_ids??[];
 if(!Array.isArray(counted)||counted.length>100||counted.some(x=>typeof x!=='string'||!/^gid:\/\/shopify\/Return\/[1-9][0-9]*$/.test(x)))throw new Error('RETURN_SOURCE_MISSING');
 const rows=k.db.prepare("SELECT r.*,n.native_id FROM commerce_return_requests r LEFT JOIN commerce_native_return_operations n ON n.tenant_id=r.tenant_id AND n.store_id=r.store_id AND n.request_id=r.id WHERE r.tenant_id=? AND r.store_id=? AND r.resource_id=? AND r.state!='awaiting_review' ORDER BY r.id").all(s.tenant_id,s.store_id,order.id) as Row[];
 const reserved:Record<string,number>={};const references:Row[]=[];
 for(const r of rows){const body=JSON.parse(r.body);if(contentDigest(body)!==r.digest||!Array.isArray(body.selection?.lines))throw new Error('RETURN_REQUEST_INTEGRITY');
  if(r.native_id&&counted.includes(r.native_id))continue;
  references.push({id:r.id,digest:r.digest,native_id:r.native_id});for(const l of body.selection.lines)reserved[l.line_id]=(reserved[l.line_id]??0)+l.quantity;
 }
 return {quantities:reserved,digest:contentDigest(references)};
}
export function evidenceReviewState(k:CommerceKernel,s:Row,caseId:string){return k.db.prepare("SELECT seq,event,reason FROM commerce_return_review_events WHERE tenant_id=? AND store_id=? AND case_id=? AND event IN ('evidence_requested','evidence_accepted') ORDER BY seq DESC LIMIT 1").get(s.tenant_id,s.store_id,caseId) as Row|undefined;}
export function intakeEvaluation(k:CommerceKernel,scope:Scope,selection:unknown,at:number,windowOverride=false) {
 const p=returnSelection(selection),cases=new CaseConfigurations(k),c=cases.resume(scope,p.case_id),s=k.authorize(scope,'return.read',c.resource_id);cases.verified(scope,c.id);
 const gift=assertGiftOutcome(k,scope,c.id,p.outcome,p.lines);
 if(gift&&p.note!=='')throw new Error('GIFT_PRIVATE_NOTE_REQUIRES_EVIDENCE');
 const settings=intakeSettings(k,s),ready=assertReady(k,s,DRAFT_ACTION);assertExecution(k,s,INTAKE_ACTION);
 const execution=k.db.prepare('SELECT profile_id,policy_id FROM commerce_execution_settings WHERE tenant_id=? AND store_id=?').get(s.tenant_id,s.store_id) as Row;
 if(execution?.profile_id!==c.pins.profile.id||execution?.policy_id!==c.pins.policy.policy_id)throw new Error('CONFIGURATION_NOT_APPROVED');
 if(c.order.source_system!=='synthetic')throw new Error('INTEGRATION_NOT_READY');
 if(c.order.observed_at>k.clock()||k.clock()-c.order.observed_at>c.pins.composition.effective['data.max_age_seconds']*1000)throw new Error('SOURCE_STALE');
 const evidence=evidenceRows(k,s,c.id,p.evidence_ids),reserved=reservations(k,s,c.order);
 const decision=evaluateReturn({order:c.order,rules:c.pins.policy.body.rules,settings:settings.body,selection:p,now:at,reserved:reserved.quantities,evidenceClean:evidence.length>0&&evidence.every(e=>e.state==='clean'),windowOverride});
 const review=evidenceReviewState(k,s,c.id);if(review?.event==='evidence_requested'){decision.reasons.push('EVIDENCE_REVIEW_REQUIRED');if(decision.decision==='allow')decision.decision='review';}
 return {review_revision:review?.seq??0,case_id:c.id,resource_id:c.resource_id,customer_id:c.customer_id,case_revision:c.revision,configuration_digest:c.configuration_digest,
  native_order_id:c.order.payload.native_order_id??null,settings_revision:settings.revision,settings_digest:settings.digest,source_version:c.order.source_version,source_digest:contentDigest(c.order),reservation_digest:reserved.digest,
  policy_digest:c.pins.policy.digest,readiness_digest:ready.evidence_digest,selection:p,evidence,decision,settings:settings.body};
}
export function quoteRow(k:CommerceKernel,scope:Scope,quoteId:string) {
 const s=k.require(scope),row=k.db.prepare('SELECT * FROM commerce_return_quotes WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,id(quoteId)) as Row;
 if(!row)throw new Error('NOT_FOUND');new CaseConfigurations(k).inspect(scope,row.case_id);k.authorize(scope,'return.read',row.resource_id);
 const body=JSON.parse(row.body);if(contentDigest(body)!==row.digest)throw new Error('RETURN_QUOTE_INTEGRITY');return {...row,quote:body};
}
export function quoteView(k:CommerceKernel,scope:Scope,quoteId:string) {
 const r=quoteRow(k,scope,quoteId);return {id:r.id,digest:r.digest,case_id:r.case_id,quote:r.quote,expires_at:r.expires_at,execution_authorized:false};
}
function overrideFor(k:CommerceKernel,s:Row,r:Row,overrideId:string|null) {
 if(overrideId===null)return null;id(overrideId);
 const o=k.db.prepare('SELECT * FROM commerce_return_overrides WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,overrideId) as Row;
 if(!o||o.revoked||o.expires_at<=k.clock()||o.quote_id!==r.id||o.quote_digest!==r.digest||o.actor_id===r.actor_id)throw new Error('RETURN_OVERRIDE_UNAVAILABLE');
 const member=k.db.prepare('SELECT * FROM commerce_members WHERE tenant_id=? AND store_id=? AND actor_id=? AND active=1').get(s.tenant_id,s.store_id,o.actor_id) as Row;
 const authority=member&&permissionDecision(k.db,member,'return.review',r.resource_id);
 if(!authority?.allowed||authority.authority_revision!==o.authority_revision)throw new Error('RETURN_OVERRIDE_REVOKED');
 if(k.clock()>r.quote.decision.deadline+r.quote.settings.override_days*86400000)throw new Error('RETURN_OVERRIDE_UNAVAILABLE');
 return {id:o.id,digest:contentDigest(o),expires_at:o.expires_at,original_reasons:r.quote.decision.reasons,reason:o.reason};
}
export function returnGatewayQuote(k:CommerceKernel,scope:Scope,p:Row,quotedAt:number) {
 const args=exact(p.arguments,['quote_id','quote_digest','override_id']);const r=quoteRow(k,scope,args.quote_id),s=k.require(scope);
 if(r.case_id!==p.case_id||r.digest!==args.quote_digest)throw new Error('RETURN_QUOTE_CHANGED');
 if(r.expires_at<=k.clock())throw new Error('RETURN_QUOTE_EXPIRED');
 const current=intakeEvaluation(k,scope,r.quote.selection,r.quote.evaluated_at);
 const original={...r.quote};delete original.evaluated_at;
 if(contentDigest(current)!==contentDigest(original))throw new Error('RETURN_QUOTE_CHANGED');
 const override=overrideFor(k,s,r,args.override_id);
 // A displayed pre-cutoff quote cannot be used to submit after the cutoff without review.
 const actual=intakeEvaluation(k,scope,r.quote.selection,k.clock(),!!override);
 if(actual.decision.decision!=='allow')throw new Error('RETURN_REVIEW_REQUIRED');
 const cases=new CaseConfigurations(k),c=cases.resume(scope,p.case_id),verified=cases.verified(scope,p.case_id);
 const effect=k.db.prepare('SELECT revision FROM commerce_case_effects WHERE tenant_id=? AND store_id=? AND case_id=?').get(s.tenant_id,s.store_id,p.case_id) as Row;
 return {schema_version:1,tenant_id:s.tenant_id,store_id:s.store_id,case_id:c.id,case_revision:c.revision,configuration_digest:c.configuration_digest,
  resource_id:c.resource_id,resource_version:c.order.source_version,source_digest:r.quote.source_digest,customer_id:verified.customer_id,
  action:INTAKE_ACTION,arguments:args,amount:money(r.quote.decision.fees.currency,r.quote.decision.fees.net_minor),amount_ceiling:money(r.quote.decision.fees.currency,r.quote.decision.fees.net_minor),
  readiness_digest:r.quote.readiness_digest,control_stamp:assertExecution(k,s,INTAKE_ACTION).stamp,capability_revision:r.quote.settings_revision,
  adapter_contract_digest:contentDigest({action:INTAKE_ACTION,version:1,effect:'local_return_request_only'}),policy_digest:c.pins.policy.digest,
  decision:{...r.quote.decision,decision:'allow'},fees:r.quote.decision.fees,lines:r.quote.decision.lines,override,
  effect_version:effect?.revision??0,quoted_at:quotedAt,expires_at:Math.min(quotedAt+300000,r.expires_at,verified.expires_at,override?.expires_at??Number.MAX_SAFE_INTEGER),max_uses:1,financial_effect:false};
}
export function commitReturnRequest(k:CommerceKernel,s:Row,preview:Row,receiptId:string) {
 const q=k.db.prepare('SELECT * FROM commerce_return_quotes WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,preview.arguments.quote_id) as Row;
 const body=JSON.parse(q.body);if(contentDigest(body)!==q.digest)throw new Error('RETURN_QUOTE_INTEGRITY');
 const request=k.db.prepare('SELECT * FROM commerce_return_requests WHERE tenant_id=? AND store_id=? AND case_id=?').get(s.tenant_id,s.store_id,preview.case_id) as Row;
 if(!request||request.preview_id!==preview.preview_id||request.state!=='awaiting_review')throw new Error('RETURN_REQUEST_CONFLICT');
 k.db.prepare("UPDATE commerce_return_requests SET state='submitted',receipt_id=? WHERE tenant_id=? AND store_id=? AND id=?").run(receiptId,s.tenant_id,s.store_id,request.id);
 k.db.prepare('INSERT INTO commerce_return_review_events(tenant_id,store_id,case_id,actor_id,event,reason,observed_at) VALUES(?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,preview.case_id,s.actor_id,'submitted','approved_preview',k.clock());
 return request.id;
}
export class ReturnReview {
 #k:CommerceKernel;constructor(k:CommerceKernel){this.#k=k;}
 requestEvidence(scope:Scope,input:unknown){const p=exact(jsonValue(input),['quote_id','reason']);if(!['photo_required','photo_unclear','description_required'].includes(p.reason))throw new Error('INVALID_INPUT');
  const k=this.#k;return k.transaction(()=>{const q=quoteRow(k,scope,p.quote_id),s=k.authorize(scope,'return.review',q.resource_id);
   if(s.actor_id===q.actor_id)throw new Error('SELF_REVIEW_DENIED');
   k.db.prepare('INSERT INTO commerce_return_review_events(tenant_id,store_id,case_id,actor_id,event,reason,observed_at) VALUES(?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,q.case_id,s.actor_id,'evidence_requested',p.reason,k.clock());return {status:'evidence_requested',reason:p.reason};});}
 resolveEvidence(scope:Scope,input:unknown){const p=exact(jsonValue(input),['quote_id','quote_digest']);const k=this.#k;
  return k.transaction(()=>{const q=quoteRow(k,scope,p.quote_id),s=k.authorize(scope,'return.review',q.resource_id),previous=evidenceReviewState(k,s,q.case_id);
   if(s.actor_id===q.actor_id)throw new Error('SELF_REVIEW_DENIED');if(!previous||previous.event!=='evidence_requested')throw new Error('RETURN_REVIEW_REQUIRED');
   if(q.digest!==p.quote_digest||q.expires_at<=k.clock())throw new Error('RETURN_QUOTE_CHANGED');
   const current=intakeEvaluation(k,scope,q.quote.selection,q.quote.evaluated_at),old={...q.quote};delete old.evaluated_at;
   if(contentDigest(current)!==contentDigest(old))throw new Error('RETURN_QUOTE_CHANGED');
   if(previous.reason==='description_required'?!q.quote.selection.note.trim():!q.quote.evidence.length||q.quote.evidence.some((e:Row)=>e.state!=='clean'))throw new Error('RETURN_REVIEW_REQUIRED');
   k.db.prepare('INSERT INTO commerce_return_review_events(tenant_id,store_id,case_id,actor_id,event,reason,observed_at) VALUES(?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,q.case_id,s.actor_id,'evidence_accepted','reviewed_evidence',k.clock());
   return {status:'evidence_accepted',requires_new_quote:true,financial_authority:false};});}
 override(scope:Scope,input:unknown){const p=exact(jsonValue(input),['quote_id','quote_digest','reason','expires_at']);integer(p.expires_at);
  if(!['shipping_delay','merchant_error'].includes(p.reason))throw new Error('INVALID_INPUT');
  const k=this.#k;return k.transaction(()=>{const r=quoteRow(k,scope,p.quote_id),s=k.authorize(scope,'return.review',r.resource_id);
   if(s.actor_id===r.actor_id)throw new Error('SELF_REVIEW_DENIED');
   if(r.digest!==p.quote_digest||r.expires_at<=k.clock()||p.expires_at<=k.clock()||p.expires_at>Math.min(r.expires_at,k.clock()+300000))throw new Error('RETURN_QUOTE_CHANGED');
   const reasons=r.quote.decision.reasons;
   if(reasons.length!==1||reasons[0]!=='RETURN_WINDOW_EXPIRED'||k.clock()>r.quote.decision.deadline+r.quote.settings.override_days*86400000)throw new Error('RETURN_OVERRIDE_DENIED');
   const current=intakeEvaluation(k,scope,r.quote.selection,r.quote.evaluated_at),original={...r.quote};delete original.evaluated_at;
   if(contentDigest(current)!==contentDigest(original))throw new Error('RETURN_QUOTE_CHANGED');
   const ref='ov_'+token().slice(0,32),revision=permissionDecision(k.db,s,'return.review',r.resource_id).authority_revision;
   k.db.prepare('INSERT INTO commerce_return_overrides VALUES(?,?,?,?,?,?,?,?,?,0)').run(s.tenant_id,s.store_id,ref,r.id,r.digest,s.actor_id,revision,p.reason,p.expires_at);
   k.db.prepare('INSERT INTO commerce_return_review_events(tenant_id,store_id,case_id,actor_id,event,reason,observed_at) VALUES(?,?,?,?,?,?,?)').run(s.tenant_id,s.store_id,r.case_id,s.actor_id,'window_override',p.reason,k.clock());
   return {id:ref,quote_id:r.id,original_reasons:reasons,reason:p.reason,actor_id:s.actor_id,expires_at:p.expires_at,financial_authority:false};});}
 revoke(scope:Scope,ref:string){const k=this.#k;return k.transaction(()=>{const s=k.require(scope),r=k.db.prepare('SELECT * FROM commerce_return_overrides WHERE tenant_id=? AND store_id=? AND id=?').get(s.tenant_id,s.store_id,id(ref)) as Row;if(!r)throw new Error('NOT_FOUND');const q=quoteRow(k,scope,r.quote_id);k.authorize(scope,'return.review',q.resource_id);
   k.db.prepare('UPDATE commerce_return_overrides SET revoked=1 WHERE tenant_id=? AND store_id=? AND id=?').run(s.tenant_id,s.store_id,ref);return {revoked:true};});}
}
